/**
 * patch.ts — PatchProposal: a proposed code fix that requires human approval.
 * ABY owns approval and application; Rijin generates proposals read-only.
 */
import { z } from "zod";
import { ISOTimestamp, SemVer, CommitSha, FilePath, ContentHash, Provenance } from "./common.js";

export const PatchProposalStatus = z.enum([
  "proposed",
  "approved",
  "rejected",
  "applied",
  "expired",
]);
export type PatchProposalStatus = z.infer<typeof PatchProposalStatus>;

export const PatchProposal = z.object({
  schemaVersion: SemVer,
  proposalId: z.string().uuid(),
  runId: z.string().uuid(),
  findingId: z.string().uuid(),
  createdAt: ISOTimestamp,
  provenance: Provenance,

  /** The commit this patch is valid against */
  sourceCommit: CommitSha,
  /** SHA-256 of the exact patch text — approval is only valid for this digest */
  patchDigest: ContentHash,

  affectedPath: FilePath,
  patchDescription: z.string(),
  /** Unified diff text */
  unifiedDiff: z.string(),

  status: PatchProposalStatus,
  approvedBy: z.string().optional(),
  approvedAt: ISOTimestamp.optional(),
  rejectionReason: z.string().optional(),
});
export type PatchProposal = z.infer<typeof PatchProposal>;
