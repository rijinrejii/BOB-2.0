/**
 * publication.ts — PublicationRecord: when and how a review was published externally.
 */
import { z } from "zod";
import { ISOTimestamp, SemVer, CommitSha, Provenance } from "./common.js";

export const PublicationStatus = z.enum([
  "published",
  "skipped",
  "failed",
]);
export type PublicationStatus = z.infer<typeof PublicationStatus>;

export const PublicationRecord = z.object({
  schemaVersion: SemVer,
  publicationId: z.string().uuid(),
  runId: z.string().uuid(),
  reportId: z.string().uuid(),
  createdAt: ISOTimestamp,
  provenance: Provenance,

  status: PublicationStatus,
  skipReason: z.string().optional(),
  failureReason: z.string().optional(),

  /** The commit the publication is bound to — stale if head has moved */
  boundToCommit: CommitSha,
  /** True if head moved between report generation and publication */
  headMoved: z.boolean(),

  destination: z.string().optional(),
  externalId: z.string().optional(),
});
export type PublicationRecord = z.infer<typeof PublicationRecord>;
