/**
 * adapters/git/git-adapter.ts
 *
 * Immutable Git access. Reads Git objects directly; never checks out
 * repository content to the working tree.
 *
 * Security invariants:
 * - All revision inputs are validated before use.
 * - Process argument arrays only; no shell interpolation.
 * - Git hooks, text conv, and external diffs are disabled.
 * - Output is bounded; processes are time-limited.
 * - Binary files and oversized files are explicitly excluded.
 * - Symlinks in paths are not followed via the host filesystem.
 * - Submodule traversal is not performed.
 */
import { spawnSync, SpawnSyncOptions } from "child_process";
import { createHash } from "crypto";
import { randomUUID } from "crypto";

import type { RepositoryPort, EvidencePort } from "../../ports/repository.js";
import type {
  RepositorySnapshot,
  FileEntry,
  EvidenceRecord,
  FileChangeKind,
} from "../../contracts/index.js";

const SCHEMA_VERSION = "1.0.0" as const;

/** Maximum bytes read from a single git-show output */
const MAX_FILE_BYTES = 500_000;
/** Maximum bytes read from a diff output */
const MAX_DIFF_BYTES = 1_000_000;
/** Process timeout in milliseconds */
const GIT_TIMEOUT_MS = 30_000;
/** Maximum characters for a revision segment (not a full SHA) */
const MAX_REV_LENGTH = 256;

/**
 * Validate a revision string. Accepts full or abbreviated commit SHAs and
 * branch/tag names (no leading dashes to prevent option injection).
 */
function validateRevision(rev: string): void {
  if (!rev || rev.length > MAX_REV_LENGTH) {
    throw new GitInputError(`Revision is empty or too long: ${JSON.stringify(rev)}`);
  }
  if (rev.startsWith("-")) {
    throw new GitInputError(`Revision looks like a flag (starts with '-'): ${JSON.stringify(rev)}`);
  }
  // Accept hex SHAs, and typical ref names (letters, digits, /, ., -, _)
  if (!/^[0-9a-fA-F]{7,64}$/.test(rev) && !/^[a-zA-Z0-9_.\-/~^@{}]+$/.test(rev)) {
    throw new GitInputError(`Revision contains disallowed characters: ${JSON.stringify(rev)}`);
  }
}

/**
 * Validate a relative file path. Rejects absolute paths, traversal sequences,
 * and NUL bytes.
 */
function validatePath(p: string): void {
  if (!p || p.includes("\0")) {
    throw new GitInputError(`Path contains NUL byte or is empty: ${JSON.stringify(p)}`);
  }
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) {
    throw new GitInputError(`Absolute path rejected: ${JSON.stringify(p)}`);
  }
  if (p.includes("..")) {
    throw new GitInputError(`Path traversal rejected: ${JSON.stringify(p)}`);
  }
}

export class GitInputError extends Error {
  override name = "GitInputError";
}

export class GitExecutionError extends Error {
  override name = "GitExecutionError";
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number | null,
  ) {
    super(message);
  }
}

export interface GitAdapterOptions {
  repoPath: string;
  /** Maximum file size in bytes to include in context (default: 500_000) */
  maxFileSizeBytes?: number | undefined;
  /** Maximum number of changed files to record (default: 500) */
  maxChangedFiles?: number | undefined;
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

/**
 * Environment for git subprocess: disables credential prompts, hooks,
 * terminal interaction, and external network access where possible.
 */
function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ASKPASS: "true",
    GIT_SSH_COMMAND: "ssh -oBatchMode=yes",
    // Disable text conversion / filters
    GIT_NO_REPLACE_OBJECTS: "1",
  };
}

/**
 * Run a git command. Never uses shell interpolation.
 * Returns stdout buffer or throws.
 */
function runGit(
  repoPath: string,
  args: string[],
  maxBytes = MAX_FILE_BYTES,
): Buffer {
  const opts: SpawnSyncOptions = {
    cwd: repoPath,
    env: gitEnv(),
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: maxBytes + 1024,
    // Important: no `shell` option (defaults to false)
  };

  // Disable hooks path by passing an explicit config override
  const fullArgs = [
    "-c", "core.hooksPath=",
    "-c", "core.autocrlf=false",
    "-c", "diff.external=",
    "-c", "diff.textconv=",
    ...args,
  ];

  const result = spawnSync("git", fullArgs, opts);

  if (result.error) {
    throw new GitExecutionError(
      `git command failed: ${result.error.message}`,
      "",
      null,
    );
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.toString("utf8") ?? "";
    throw new GitExecutionError(
      `git exited with code ${result.status ?? "null"}`,
      stderr,
      result.status,
    );
  }

  const stdout = result.stdout;
  if (!Buffer.isBuffer(stdout)) {
    throw new GitExecutionError("git stdout was not a Buffer", "", null);
  }
  return stdout;
}

/**
 * Resolve a revision to a full 40-char commit SHA.
 */
function resolveRevision(repoPath: string, rev: string): string {
  validateRevision(rev);
  const out = runGit(repoPath, ["rev-parse", "--verify", `${rev}^{commit}`], 1024);
  const sha = out.toString("utf8").trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new GitExecutionError(`Unexpected rev-parse output: ${sha}`, "", null);
  }
  return sha;
}

/**
 * Compute the merge base of two commits.
 * Throws if the merge base cannot be found (e.g., shallow clone).
 */
function getMergeBase(repoPath: string, base: string, head: string): string {
  validateRevision(base);
  validateRevision(head);
  const out = runGit(repoPath, ["merge-base", base, head], 1024);
  const sha = out.toString("utf8").trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new GitExecutionError(`Unexpected merge-base output: ${sha}`, "", null);
  }
  return sha;
}

interface RawFileChange {
  path: string;
  oldPath?: string | undefined;
  status: string;
}

/**
 * Parse the output of `git diff --name-status` into structured entries.
 */
function parseDiffNameStatus(output: string): RawFileChange[] {
  const changes: RawFileChange[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    const statusCode = parts[0] ?? "";

    if (statusCode.startsWith("R") || statusCode.startsWith("C")) {
      // Rename or copy: R100\told-path\tnew-path
      const oldPath = parts[1] ?? "";
      const newPath = parts[2] ?? "";
      if (oldPath && newPath) {
        changes.push({ path: newPath, oldPath, status: statusCode[0] ?? "R" });
      }
    } else {
      const filePath = parts[1] ?? "";
      if (filePath) {
        changes.push({ path: filePath, status: statusCode });
      }
    }
  }
  return changes;
}

/**
 * Determine FileChangeKind from git status code.
 */
function toChangeKind(status: string): FileChangeKind {
  const first = status[0] ?? "";
  switch (first) {
    case "A": return "added";
    case "D": return "deleted";
    case "R": return "renamed";
    case "C": return "added"; // copy treated as add for review purposes
    default: return "modified";
  }
}

/**
 * Check whether an object is binary (null byte in first 8 KB).
 */
function isBinary(buf: Buffer): boolean {
  const check = buf.slice(0, 8192);
  return check.includes(0);
}

/**
 * Get file size at a commit (0 if deleted, -1 if unresolvable).
 */
function getObjectSize(repoPath: string, commit: string, filePath: string): number {
  try {
    validatePath(filePath);
    const out = runGit(
      repoPath,
      ["cat-file", "-s", `${commit}:${filePath}`],
      256,
    );
    return parseInt(out.toString("utf8").trim(), 10);
  } catch {
    return -1;
  }
}

/**
 * Get line counts from a diff output.
 */
function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}

interface GitAdapterConfig {
  repoPath: string;
  maxFileSizeBytes: number;
  maxChangedFiles: number;
}

export class GitAdapter implements RepositoryPort, EvidencePort {
  private readonly opts: GitAdapterConfig;
  private evidenceStore = new Map<string, EvidenceRecord>();
  private snapshotCache = new Map<string, RepositorySnapshot>();

  constructor(options: GitAdapterOptions) {
    this.opts = {
      maxFileSizeBytes: options.maxFileSizeBytes ?? MAX_FILE_BYTES,
      maxChangedFiles: options.maxChangedFiles ?? 500,
      repoPath: options.repoPath,
    };
  }

  /**
   * Create an immutable snapshot for a given base and head revision.
   * Resolves both to full commit SHAs before any data collection.
   */
  async createSnapshot(
    runId: string,
    baseRev: string,
    headRev: string,
  ): Promise<RepositorySnapshot> {
    const { repoPath } = this.opts;

    // Resolve to full SHAs first
    const baseCommit = resolveRevision(repoPath, baseRev);
    const headCommit = resolveRevision(repoPath, headRev);

    // Compute merge base (may throw for shallow clones)
    let mergeBase: string;
    try {
      mergeBase = getMergeBase(repoPath, baseCommit, headCommit);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new GitExecutionError(
        `Cannot compute merge base for ${baseCommit}..${headCommit}: ${msg}`,
        "",
        null,
      );
    }

    // Get changed files between merge base and head
    const diffOutput = runGit(
      repoPath,
      ["diff", "--name-status", "-z", mergeBase, headCommit],
      MAX_DIFF_BYTES,
    );

    // -z separates with NUL; parse both NUL-separated and tab-separated
    const rawText = diffOutput.toString("utf8").replace(/\0/g, "\t").replace(/\t\t/g, "\n");
    const rawChanges = parseDiffNameStatus(rawText);

    const limitedChanges = rawChanges.slice(0, this.opts.maxChangedFiles);
    const truncated = rawChanges.length > this.opts.maxChangedFiles;

    const fileEntries: FileEntry[] = [];

    for (const raw of limitedChanges) {
      try {
        validatePath(raw.path);
      } catch {
        // Skip unsafe paths
        continue;
      }

      const changeKind = toChangeKind(raw.status);

      // Get head content hash (skip for deletions)
      let headContentHash: string | null = null;
      let headSizeBytes: number | null = null;

      if (changeKind !== "deleted") {
        const size = getObjectSize(repoPath, headCommit, raw.path);
        if (size > 0 && size <= this.opts.maxFileSizeBytes) {
          try {
            const content = runGit(
              repoPath,
              ["show", `${headCommit}:${raw.path}`],
              this.opts.maxFileSizeBytes + 1024,
            );
            if (!isBinary(content)) {
              headContentHash = sha256(content);
            }
            headSizeBytes = content.length;
          } catch {
            // File unreadable — record without hash
            headSizeBytes = size;
          }
        } else if (size > 0) {
          headSizeBytes = size;
        }
      }

      // Get base content hash (skip for additions)
      let baseContentHash: string | null = null;
      if (changeKind !== "added") {
        const oldPath = changeKind === "renamed" ? (raw.oldPath ?? raw.path) : raw.path;
        const size = getObjectSize(repoPath, mergeBase, oldPath);
        if (size > 0 && size <= this.opts.maxFileSizeBytes) {
          try {
            const content = runGit(
              repoPath,
              ["show", `${mergeBase}:${oldPath}`],
              this.opts.maxFileSizeBytes + 1024,
            );
            if (!isBinary(content)) {
              baseContentHash = sha256(content);
            }
          } catch {
            // base unreadable
          }
        }
      }

      // Get diff for line counts
      let linesAdded = 0;
      let linesRemoved = 0;
      try {
        const diffArgs = ["diff", "--unified=0", `${mergeBase}`, `${headCommit}`, "--", raw.path];
        const fileDiff = runGit(repoPath, diffArgs, MAX_DIFF_BYTES);
        const counts = countDiffLines(fileDiff.toString("utf8"));
        linesAdded = counts.added;
        linesRemoved = counts.removed;
      } catch {
        // Line counts unavailable
      }

      fileEntries.push({
        path: raw.path,
        changeKind,
        headContentHash: headContentHash as `${string}` | null,
        baseContentHash: baseContentHash as `${string}` | null,
        headSizeBytes,
        linesAdded,
        linesRemoved,
      });
    }

    const digest = sha256(JSON.stringify({ fileEntries, baseCommit, headCommit, mergeBase }));

    const snapshot: RepositorySnapshot = {
      schemaVersion: SCHEMA_VERSION,
      snapshotId: randomUUID(),
      runId,
      createdAt: nowISO(),
      provenance: {
        source: "git-adapter",
        runId,
        createdAt: nowISO(),
      },
      repositoryPath: repoPath,
      baseCommit: baseCommit as `${string}`,
      headCommit: headCommit as `${string}`,
      changedFiles: fileEntries,
      totalChangedFiles: fileEntries.length + (truncated ? rawChanges.length - this.opts.maxChangedFiles : 0) as number,
      totalLinesAdded: fileEntries.reduce((s, f) => s + f.linesAdded, 0),
      totalLinesRemoved: fileEntries.reduce((s, f) => s + f.linesRemoved, 0),
      immutable: true,
      snapshotDigest: digest as `${string}`,
    };

    this.snapshotCache.set(runId, snapshot);
    return snapshot;
  }

  // RepositoryPort implementation

  async getSnapshot(runId: string): Promise<RepositorySnapshot> {
    const cached = this.snapshotCache.get(runId);
    if (!cached) {
      throw new Error(`No snapshot for runId ${runId}. Call createSnapshot() first.`);
    }
    return cached;
  }

  async readFile(snapshotId: string, filePath: string): Promise<string | null> {
    validatePath(filePath);

    const snapshot = this.findSnapshotById(snapshotId);
    if (!snapshot) return null;

    const entry = snapshot.changedFiles.find((f) => f.path === filePath);
    if (!entry || entry.changeKind === "deleted") return null;

    if (entry.headSizeBytes !== null && entry.headSizeBytes > this.opts.maxFileSizeBytes) {
      return null; // Oversized
    }

    try {
      const content = runGit(
        this.opts.repoPath,
        ["show", `${snapshot.headCommit}:${filePath}`],
        this.opts.maxFileSizeBytes + 1024,
      );
      if (isBinary(content)) return null;
      return content.toString("utf8");
    } catch {
      return null;
    }
  }

  async readFileAtBase(snapshotId: string, filePath: string): Promise<string | null> {
    validatePath(filePath);

    const snapshot = this.findSnapshotById(snapshotId);
    if (!snapshot) return null;

    const entry = snapshot.changedFiles.find((f) => f.path === filePath);
    if (!entry || entry.changeKind === "added") return null;

    try {
      const content = runGit(
        this.opts.repoPath,
        ["show", `${snapshot.baseCommit}:${filePath}`],
        this.opts.maxFileSizeBytes + 1024,
      );
      if (isBinary(content)) return null;
      return content.toString("utf8");
    } catch {
      return null;
    }
  }

  async getFileDiff(snapshotId: string, filePath: string): Promise<string | null> {
    validatePath(filePath);

    const snapshot = this.findSnapshotById(snapshotId);
    if (!snapshot) return null;

    try {
      const diff = runGit(
        this.opts.repoPath,
        ["diff", `${snapshot.baseCommit}`, `${snapshot.headCommit}`, "--", filePath],
        MAX_DIFF_BYTES,
      );
      return diff.toString("utf8").slice(0, MAX_DIFF_BYTES);
    } catch {
      return null;
    }
  }

  async getChangedFiles(snapshotId: string): Promise<FileEntry[]> {
    const snapshot = this.findSnapshotById(snapshotId);
    if (!snapshot) return [];
    return snapshot.changedFiles;
  }

  // EvidencePort implementation

  async storeEvidence(record: EvidenceRecord): Promise<void> {
    this.evidenceStore.set(record.evidenceId, record);
  }

  async getEvidence(evidenceId: string): Promise<EvidenceRecord | null> {
    return this.evidenceStore.get(evidenceId) ?? null;
  }

  async getEvidenceForRun(runId: string): Promise<EvidenceRecord[]> {
    return Array.from(this.evidenceStore.values()).filter((e) => e.runId === runId);
  }

  private findSnapshotById(snapshotId: string): RepositorySnapshot | undefined {
    for (const snap of this.snapshotCache.values()) {
      if (snap.snapshotId === snapshotId) return snap;
    }
    return undefined;
  }
}
