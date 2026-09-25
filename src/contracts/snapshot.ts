/**
 * snapshot.ts — RepositorySnapshot: the immutable read-only view of the
 * repository at a specific commit pair. ABY produces this; Rijin reads it.
 */
import { z } from "zod";
import { ISOTimestamp, SemVer, CommitSha, FilePath, ContentHash, Provenance } from "./common.js";

export const FileChangeKind = z.enum(["added", "modified", "deleted", "renamed"]);
export type FileChangeKind = z.infer<typeof FileChangeKind>;

export const FileEntry = z.object({
  path: FilePath,
  changeKind: FileChangeKind,
  /** Null for deletions */
  headContentHash: ContentHash.nullable(),
  /** Null for additions */
  baseContentHash: ContentHash.nullable(),
  /** Size in bytes at head; null for deletions */
  headSizeBytes: z.number().int().nonnegative().nullable(),
  linesAdded: z.number().int().nonnegative(),
  linesRemoved: z.number().int().nonnegative(),
});
export type FileEntry = z.infer<typeof FileEntry>;

export const RepositorySnapshot = z.object({
  schemaVersion: SemVer,
  snapshotId: z.string().uuid(),
  runId: z.string().uuid(),
  createdAt: ISOTimestamp,
  provenance: Provenance,

  repositoryPath: z.string(),
  baseCommit: CommitSha,
  headCommit: CommitSha,

  changedFiles: z.array(FileEntry),
  totalChangedFiles: z.number().int().nonnegative(),
  totalLinesAdded: z.number().int().nonnegative(),
  totalLinesRemoved: z.number().int().nonnegative(),

  /** True when the snapshot is locked and will not change */
  immutable: z.boolean(),
  snapshotDigest: ContentHash,
});
export type RepositorySnapshot = z.infer<typeof RepositorySnapshot>;
