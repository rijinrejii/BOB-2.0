/**
 * tests/support/fixture-repository.ts — In-memory repository for tests.
 * Never accesses real filesystem or Git.
 */
import { randomUUID } from "crypto";
import type { RepositoryPort, EvidencePort } from "../../src/ports/repository.js";
import type { RepositorySnapshot, FileEntry, EvidenceRecord } from "../../src/contracts/index.js";
import { createHash } from "crypto";

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface FixtureFile {
  path: string;
  changeKind: "added" | "modified" | "deleted" | "renamed";
  content?: string;
  diff?: string;
}

export function makeFixtureSnapshot(
  runId: string,
  files: FixtureFile[],
  baseCommit = "abc1234",
  headCommit = "def5678",
): RepositorySnapshot {
  const changedFiles: FileEntry[] = files.map((f) => {
    const addedLines = f.diff ? (f.diff.match(/^\+[^+]/gm) ?? []).length : 0;
    const removedLines = f.diff ? (f.diff.match(/^-[^-]/gm) ?? []).length : 0;
    return {
      path: f.path,
      changeKind: f.changeKind,
      headContentHash: f.content ? sha256(f.content) as `${string}` : null,
      baseContentHash: null,
      headSizeBytes: f.content ? Buffer.byteLength(f.content) : null,
      linesAdded: addedLines,
      linesRemoved: removedLines,
    };
  });

  const digest = sha256(JSON.stringify(changedFiles));

  return {
    schemaVersion: "1.0.0",
    snapshotId: randomUUID(),
    runId,
    createdAt: nowISO(),
    provenance: { source: "fixture", runId, createdAt: nowISO() },
    repositoryPath: "/fixture/repo",
    baseCommit,
    headCommit,
    changedFiles,
    totalChangedFiles: changedFiles.length,
    totalLinesAdded: changedFiles.reduce((s, f) => s + f.linesAdded, 0),
    totalLinesRemoved: changedFiles.reduce((s, f) => s + f.linesRemoved, 0),
    immutable: true,
    snapshotDigest: digest as `${string}`,
  };
}

export class FixtureRepositoryAdapter implements RepositoryPort {
  private readonly files: Map<string, FixtureFile>;
  private readonly snapshot: RepositorySnapshot;

  constructor(snapshot: RepositorySnapshot, files: FixtureFile[]) {
    this.snapshot = snapshot;
    this.files = new Map(files.map((f) => [f.path, f]));
  }

  async getSnapshot(_runId: string): Promise<RepositorySnapshot> {
    return this.snapshot;
  }

  async readFile(_snapshotId: string, path: string): Promise<string | null> {
    return this.files.get(path)?.content ?? null;
  }

  async getFileDiff(_snapshotId: string, path: string): Promise<string | null> {
    return this.files.get(path)?.diff ?? null;
  }

  async getChangedFiles(_snapshotId: string): Promise<FileEntry[]> {
    return this.snapshot.changedFiles;
  }

  async readFileAtBase(_snapshotId: string, _path: string): Promise<string | null> {
    return null;
  }
}

export class FixtureEvidenceAdapter implements EvidencePort {
  private readonly store = new Map<string, EvidenceRecord>();

  async storeEvidence(record: EvidenceRecord): Promise<void> {
    this.store.set(record.evidenceId, record);
  }

  async getEvidence(evidenceId: string): Promise<EvidenceRecord | null> {
    return this.store.get(evidenceId) ?? null;
  }

  async getEvidenceForRun(runId: string): Promise<EvidenceRecord[]> {
    return Array.from(this.store.values()).filter((e) => e.runId === runId);
  }
}

export function makeFixtureCapabilities() {
  return {
    schemaVersion: "1.0.0" as const,
    reportId: randomUUID(),
    generatedAt: nowISO(),
    provenance: { source: "fixture", createdAt: nowISO() },
    nodeVersion: process.version,
    platform: process.platform,
    gitAvailable: false,
    modelStatus: "unavailable" as const,
    permittedModelIds: [] as string[],
    externalTransmissionAllowed: false,
    verificationStatus: "unavailable" as const,
    allowedCheckIds: [] as string[],
    documentParsers: [] as string[],
    storageAvailable: true,
    limitations: ["fixture mode: no live model, no git, no verification"],
  };
}

export function makeFixturePolicy() {
  return {
    schemaVersion: "1.0.0" as const,
    policyId: randomUUID(),
    loadedAt: nowISO(),
    provenance: { source: "fixture", createdAt: nowISO() },
    contentHash: sha256("fixture-policy") as `${string}`,
    externalTransmissionAllowed: false,
    permittedModelIds: [] as string[],
    allowedCheckIds: [] as string[],
    maxContextFiles: 50,
    maxFileSizeBytes: 100_000,
    maxDependencyDepth: 2,
    patchProposalsEnabled: false,
    incrementalReuseEnabled: false,
    additionalMandatoryRiskPatterns: [] as string[],
  };
}
