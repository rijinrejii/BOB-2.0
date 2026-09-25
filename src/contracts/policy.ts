/**
 * policy.ts — TrustedPolicy: operator-defined review policy loaded at startup.
 */
import { z } from "zod";
import { ISOTimestamp, SemVer, ContentHash, Provenance } from "./common.js";

export const TrustedPolicy = z.object({
  schemaVersion: SemVer,
  policyId: z.string().uuid(),
  loadedAt: ISOTimestamp,
  provenance: Provenance,
  contentHash: ContentHash,

  /** Whether external model transmission is allowed */
  externalTransmissionAllowed: z.boolean(),

  /** Permitted model identifiers */
  permittedModelIds: z.array(z.string()),

  /** Allowlisted check command identifiers for verification */
  allowedCheckIds: z.array(z.string()),

  /** Maximum files to load into context */
  maxContextFiles: z.number().int().positive(),

  /** Maximum bytes per file */
  maxFileSizeBytes: z.number().int().positive(),

  /** Maximum dependency traversal depth for context selection */
  maxDependencyDepth: z.number().int().nonnegative(),

  /** Whether patch proposals are enabled */
  patchProposalsEnabled: z.boolean(),

  /** Whether incremental reuse of previous review is enabled */
  incrementalReuseEnabled: z.boolean(),

  /** Custom mandatory risk patterns (regex strings) */
  additionalMandatoryRiskPatterns: z.array(z.string()),
});
export type TrustedPolicy = z.infer<typeof TrustedPolicy>;
