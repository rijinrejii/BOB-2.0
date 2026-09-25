/**
 * run.ts — ReviewRun: lifecycle record for a single end-to-end review.
 * ABY writes and owns this; Rijin's services read the runId and status.
 */
import { z } from "zod";
import { ISOTimestamp, SemVer, CommitSha, Provenance } from "./common.js";

export const ReviewRunStatus = z.enum([
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export type ReviewRunStatus = z.infer<typeof ReviewRunStatus>;

export const ReviewRun = z.object({
  schemaVersion: SemVer,
  runId: z.string().uuid(),
  createdAt: ISOTimestamp,
  updatedAt: ISOTimestamp,
  provenance: Provenance,

  repositoryPath: z.string(),
  baseCommit: CommitSha,
  headCommit: CommitSha,
  prMetadataPath: z.string().optional(),

  status: ReviewRunStatus,
  fixtureMode: z.boolean(),
  capabilityReportId: z.string().uuid().optional(),

  stageCheckpoints: z.record(z.string(), ISOTimestamp),
  errorMessage: z.string().optional(),
});
export type ReviewRun = z.infer<typeof ReviewRun>;
