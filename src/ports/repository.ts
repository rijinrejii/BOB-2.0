/**
 * ports/repository.ts — Interface for reading snapshot data and file contents.
 * ABY provides the implementation; Rijin consumes this port.
 */
import type { RepositorySnapshot, FileEntry, EvidenceRecord } from "../contracts/index.js";

export interface RepositoryPort {
  /** Return the immutable snapshot for this run */
  getSnapshot(runId: string): Promise<RepositorySnapshot>;

  /** Return raw text content of a file at head commit */
  readFile(snapshotId: string, path: string): Promise<string | null>;

  /** Return the unified diff for a specific file */
  getFileDiff(snapshotId: string, path: string): Promise<string | null>;

  /** Return file entries for changed files in the snapshot */
  getChangedFiles(snapshotId: string): Promise<FileEntry[]>;

  /** Return raw text content at the base commit (pre-change) */
  readFileAtBase(snapshotId: string, path: string): Promise<string | null>;
}

export interface EvidencePort {
  /** Store an evidence record */
  storeEvidence(record: EvidenceRecord): Promise<void>;

  /** Retrieve evidence by ID */
  getEvidence(evidenceId: string): Promise<EvidenceRecord | null>;

  /** Retrieve all evidence for a run */
  getEvidenceForRun(runId: string): Promise<EvidenceRecord[]>;
}
