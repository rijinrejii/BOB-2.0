import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import type {
  RepositoryPort,
  EvidencePort,
} from "../../ports/repository.js";
import {
  RepositorySnapshot,
  type EvidenceRecord,
  type FileEntry,
  type FileChangeKind,
} from "../../contracts/index.js";

const TIMEOUT_MS = 30_000;
const MAX_DIFF_BYTES = 1_000_000;

const nowISO = (): string => new Date().toISOString();
const digest = (data: Buffer | string): string =>
  createHash("sha256").update(data).digest("hex");

export class GitInputError extends Error {
  override name = "GitInputError";
}

export class GitExecutionError extends Error {
  override name = "GitExecutionError";

  constructor(
    message: string,
    public readonly stderr = "",
    public readonly exitCode: number | null = null,
  ) {
    super(message);
  }
}

export interface GitAdapterOptions {
  repoPath: string;
  maxFileSizeBytes?: number | undefined;
  maxChangedFiles?: number | undefined;
}

interface Change {
  status: string;
  path: string;
  oldPath?: string;
}

function validateRevision(value: string): void {
  if (
    !value ||
    value.length > 256 ||
    value.startsWith("-") ||
    !/^[A-Za-z0-9_./~^@{}-]+$/.test(value)
  ) {
    throw new GitInputError("Invalid Git revision");
  }
}

function validatePath(value: string): void {
  if (
    !value ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:/.test(value) ||
    value.split(/[\\/]/).some((part) => part === "..")
  ) {
    throw new GitInputError("Invalid repository-relative path");
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new GitInputError(`${name} must be a positive integer`);
  }
  return value;
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  // Do not inherit Git repository/configuration overrides from the caller.
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }

  return {
    ...env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_LITERAL_PATHSPECS: "1",
    GIT_PAGER: "cat",
  };
}

function runGit(
  repoPath: string,
  args: string[],
  maxBytes = MAX_DIFF_BYTES,
): Buffer {
  const result = spawnSync(
    "git",
    [
      "--no-pager",
      "-c", "core.hooksPath=",
      "-c", "core.fsmonitor=false",
      "-c", "diff.external=",
      "-c", "protocol.allow=never",
      "-c", "submodule.recurse=false",
      ...args,
    ],
    {
      cwd: repoPath,
      env: gitEnvironment(),
      shell: false,
      timeout: TIMEOUT_MS,
      maxBuffer: maxBytes + 4096,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.error || result.status !== 0) {
    throw new GitExecutionError(
      result.error
        ? `Git operation failed: ${result.error.message}`
        : `Git operation exited with status ${result.status}`,
      "",
      result.status,
    );
  }

  if (!Buffer.isBuffer(result.stdout) || result.stdout.length > maxBytes) {
    throw new GitExecutionError("Git output exceeded its configured bound");
  }

  return result.stdout;
}

function resolveCommit(repoPath: string, revision: string): string {
  validateRevision(revision);

  const sha = runGit(
    repoPath,
    ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`],
    1024,
  ).toString("utf8").trim();

  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) {
    throw new GitExecutionError("Git did not return a full commit hash");
  }

  return sha;
}

function comparisonBase(
  repoPath: string,
  baseCommit: string,
  headCommit: string,
): string {
  const values = runGit(
    repoPath,
    ["merge-base", "--all", baseCommit, headCommit],
    4096,
  ).toString("utf8").trim().split(/\s+/);

  if (
    values.length !== 1 ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(values[0] ?? "")
  ) {
    throw new GitExecutionError(
      "A single merge base is required; missing or ambiguous history",
    );
  }

  return values[0]!;
}

function parseChanges(output: Buffer): Change[] {
  const fields = output.toString("utf8").split("\0");
  if (fields.at(-1) === "") fields.pop();

  const changes: Change[] = [];
  let index = 0;

  while (index < fields.length) {
    const status = fields[index++];
    const firstPath = fields[index++];

    if (!status || firstPath === undefined) {
      throw new GitExecutionError("Malformed Git name-status output");
    }

    validatePath(firstPath);

    if (/^[RC]\d+$/.test(status)) {
      const newPath = fields[index++];

      if (newPath === undefined) {
        throw new GitExecutionError("Malformed Git rename/copy output");
      }

      validatePath(newPath);
      changes.push({ status, path: newPath, oldPath: firstPath });
    } else {
      if (!/^[AMDTUXB]$/.test(status)) {
        throw new GitExecutionError("Unsupported Git change status");
      }

      changes.push({ status, path: firstPath });
    }
  }

  return changes;
}

function kind(status: string): FileChangeKind {
  if (status.startsWith("R")) return "renamed";
  if (status.startsWith("A") || status.startsWith("C")) return "added";
  if (status.startsWith("D")) return "deleted";
  return "modified";
}

function countLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  let inHunk = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("@@ ")) {
      inHunk = true;
      continue;
    }

    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }

    if (!inHunk) continue;
    if (line.startsWith("+")) added++;
    if (line.startsWith("-")) removed++;
  }

  return { added, removed };
}

export class GitAdapter implements RepositoryPort, EvidencePort {
  private readonly repoPath: string;
  private readonly maxFileSizeBytes: number;
  private readonly maxChangedFiles: number;

  private readonly snapshots = new Map<string, RepositorySnapshot>();
  private readonly changes = new Map<string, Change[]>();
  private readonly evidence = new Map<string, EvidenceRecord>();

  constructor(options: GitAdapterOptions) {
    this.repoPath = realpathSync(options.repoPath);
    this.maxFileSizeBytes = positiveInteger(
      options.maxFileSizeBytes ?? 500_000,
      "maxFileSizeBytes",
    );
    this.maxChangedFiles = positiveInteger(
      options.maxChangedFiles ?? 500,
      "maxChangedFiles",
    );
  }

  resolveRevisions(
    baseRevision: string,
    headRevision: string,
  ): { baseCommit: string; headCommit: string; repositoryPath: string } {
    return {
      baseCommit: resolveCommit(this.repoPath, baseRevision),
      headCommit: resolveCommit(this.repoPath, headRevision),
      repositoryPath: this.repoPath,
    };
  }

  private listChanges(base: string, head: string): Change[] {
    return parseChanges(runGit(this.repoPath, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--ignore-submodules=all",
      "--name-status",
      "-z",
      "--find-renames",
      base,
      head,
      "--",
    ]));
  }

  private readBlob(commit: string, path: string): Buffer | null {
    validatePath(path);

    const spec = `${commit}:${path}`;
    const type = runGit(
      this.repoPath,
      ["cat-file", "-t", spec],
      1024,
    ).toString("utf8").trim();

    if (type !== "blob") return null;

    const size = Number(
      runGit(this.repoPath, ["cat-file", "-s", spec], 1024)
        .toString("utf8")
        .trim(),
    );

    if (!Number.isSafeInteger(size) || size < 0) {
      throw new GitExecutionError("Invalid Git object size");
    }

    if (size > this.maxFileSizeBytes) return null;

    const content = runGit(
      this.repoPath,
      ["cat-file", "blob", spec],
      this.maxFileSizeBytes,
    );

    if (content.subarray(0, 8192).includes(0)) return null;
    return content;
  }

  private diff(base: string, head: string, paths: string[]): string {
    for (const path of paths) validatePath(path);

    return runGit(this.repoPath, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--ignore-submodules=all",
      "--find-renames",
      "--unified=3",
      base,
      head,
      "--",
      ...paths,
    ]).toString("utf8");
  }

  async createSnapshot(
    runId: string,
    baseRevision: string,
    headRevision: string,
  ): Promise<RepositorySnapshot> {
    const { baseCommit, headCommit } =
      this.resolveRevisions(baseRevision, headRevision);

    const mergeBase = comparisonBase(
      this.repoPath,
      baseCommit,
      headCommit,
    );

    const changes = this.listChanges(mergeBase, headCommit);

    if (changes.length > this.maxChangedFiles) {
      throw new GitExecutionError(
        `Changed-file count exceeds the limit of ${this.maxChangedFiles}`,
      );
    }

    const changedFiles: FileEntry[] = changes.map((change) => {
      const changeKind = kind(change.status);

      const head = changeKind === "deleted"
        ? null
        : this.readBlob(headCommit, change.path);

      const base = changeKind === "added"
        ? null
        : this.readBlob(mergeBase, change.oldPath ?? change.path);

      const paths = change.oldPath
        ? [change.oldPath, change.path]
        : [change.path];

      const counts = countLines(this.diff(mergeBase, headCommit, paths));

      return {
        path: change.path,
        changeKind,
        headContentHash: head === null ? null : digest(head),
        baseContentHash: base === null ? null : digest(base),
        headSizeBytes: head === null ? null : head.length,
        linesAdded: counts.added,
        linesRemoved: counts.removed,
      };
    });

    const snapshot = RepositorySnapshot.parse({
      schemaVersion: "1.0.0",
      snapshotId: randomUUID(),
      runId,
      createdAt: nowISO(),
      provenance: {
        source: "git-adapter",
        runId,
        createdAt: nowISO(),
      },
      repositoryPath: this.repoPath,
      baseCommit,
      headCommit,
      changedFiles,
      totalChangedFiles: changedFiles.length,
      totalLinesAdded: changedFiles.reduce((sum, file) => sum + file.linesAdded, 0),
      totalLinesRemoved: changedFiles.reduce((sum, file) => sum + file.linesRemoved, 0),
      immutable: true,
      snapshotDigest: digest(JSON.stringify({
        baseCommit,
        headCommit,
        mergeBase,
        changedFiles,
      })),
    });

    this.snapshots.set(snapshot.snapshotId, snapshot);
    this.changes.set(snapshot.snapshotId, changes);

    return structuredClone(snapshot);
  }

  async restoreSnapshot(value: RepositorySnapshot): Promise<void> {
    const snapshot = RepositorySnapshot.parse(value);

    if (realpathSync(snapshot.repositoryPath) !== this.repoPath) {
      throw new GitInputError("Stored snapshot belongs to another repository");
    }

    const mergeBase = comparisonBase(
      this.repoPath,
      snapshot.baseCommit,
      snapshot.headCommit,
    );

    const expectedDigest = digest(JSON.stringify({
      baseCommit: snapshot.baseCommit,
      headCommit: snapshot.headCommit,
      mergeBase,
      changedFiles: snapshot.changedFiles,
    }));

    if (expectedDigest !== snapshot.snapshotDigest) {
      throw new GitInputError("Stored snapshot digest does not match");
    }

    this.snapshots.set(snapshot.snapshotId, structuredClone(snapshot));
    this.changes.set(
      snapshot.snapshotId,
      this.listChanges(mergeBase, snapshot.headCommit),
    );
  }

  private requireSnapshot(snapshotId: string): RepositorySnapshot {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) throw new GitInputError("Snapshot is not loaded");
    return snapshot;
  }

  async getSnapshot(runId: string): Promise<RepositorySnapshot> {
    const snapshot = [...this.snapshots.values()]
      .find((entry) => entry.runId === runId);

    if (!snapshot) throw new GitInputError("Run snapshot is not loaded");
    return structuredClone(snapshot);
  }

  async readFile(snapshotId: string, path: string): Promise<string | null> {
    const snapshot = this.requireSnapshot(snapshotId);
    const content = this.readBlob(snapshot.headCommit, path);
    return content === null ? null : content.toString("utf8");
  }

  async readFileAtBase(
    snapshotId: string,
    path: string,
  ): Promise<string | null> {
    const snapshot = this.requireSnapshot(snapshotId);
    const change = this.changes.get(snapshotId)?.find((entry) => entry.path === path);

    if (change && kind(change.status) === "added") return null;

    const base = comparisonBase(
      this.repoPath,
      snapshot.baseCommit,
      snapshot.headCommit,
    );

    const content = this.readBlob(base, change?.oldPath ?? path);
    return content === null ? null : content.toString("utf8");
  }

  async getFileDiff(snapshotId: string, path: string): Promise<string | null> {
    const snapshot = this.requireSnapshot(snapshotId);
    const change = this.changes.get(snapshotId)?.find((entry) => entry.path === path);

    if (!change) return null;

    const base = comparisonBase(
      this.repoPath,
      snapshot.baseCommit,
      snapshot.headCommit,
    );

    return this.diff(
      base,
      snapshot.headCommit,
      change.oldPath ? [change.oldPath, path] : [path],
    );
  }

  async getChangedFiles(snapshotId: string): Promise<FileEntry[]> {
    return structuredClone(this.requireSnapshot(snapshotId).changedFiles);
  }

  async storeEvidence(record: EvidenceRecord): Promise<void> {
    this.evidence.set(record.evidenceId, structuredClone(record));
  }

  async getEvidence(evidenceId: string): Promise<EvidenceRecord | null> {
    const value = this.evidence.get(evidenceId);
    return value ? structuredClone(value) : null;
  }

  async getEvidenceForRun(runId: string): Promise<EvidenceRecord[]> {
    return structuredClone(
      [...this.evidence.values()].filter((record) => record.runId === runId),
    );
  }
}
