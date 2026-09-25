/**
 * evidence.ts — EvidenceRecord: a verified reference to source material.
 */
import { z } from "zod";
import { ISOTimestamp, SemVer, CommitSha, FilePath, ContentHash, LineRange, Provenance } from "./common.js";

export const EvidenceKind = z.enum([
  "source_file",
  "test_file",
  "diff_hunk",
  "pr_description",
  "document",
  "check_result",
  "model_output",
  "requirement",
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const ExtractionQuality = z.enum([
  "full",
  "partial",
  "failed",
]);
export type ExtractionQuality = z.infer<typeof ExtractionQuality>;

export const EvidenceRecord = z.object({
  schemaVersion: SemVer,
  evidenceId: z.string().uuid(),
  runId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  createdAt: ISOTimestamp,
  provenance: Provenance,

  kind: EvidenceKind,
  path: FilePath.optional(),
  commit: CommitSha.optional(),
  lineRange: LineRange.optional(),

  /** Exact text excerpt, if applicable */
  excerpt: z.string().optional(),
  contentHash: ContentHash.optional(),

  /** For documents: approval status and extraction quality */
  documentApproved: z.boolean().optional(),
  extractionQuality: ExtractionQuality.optional(),
  pageRef: z.string().optional(),

  /** Summary of what this evidence shows */
  summary: z.string(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecord>;
