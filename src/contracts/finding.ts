/**
 * finding.ts — CandidateFinding and Finding.
 * Separate pre-validation from post-validation records.
 */
import { z } from "zod";
import { ISOTimestamp, SemVer, CommitSha, FilePath, LineRange, Severity, Confidence, Provenance } from "./common.js";
import { ReviewCategory, SpecialistCategory } from "./plan.js";

export const FindingValidationStatus = z.enum([
  "confirmed",
  "unresolved",
  "rejected",
  "superseded",
]);
export type FindingValidationStatus = z.infer<typeof FindingValidationStatus>;

export const FindingCategory = z.union([ReviewCategory, SpecialistCategory]);
export type FindingCategory = z.infer<typeof FindingCategory>;

/** Raw output from a reviewer before validation */
export const CandidateFinding = z.object({
  schemaVersion: SemVer,
  candidateId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  runId: z.string().uuid(),
  createdAt: ISOTimestamp,
  provenance: Provenance,

  claim: z.string(),
  affectedPath: FilePath,
  headCommit: CommitSha,
  lineRange: LineRange.optional(),
  surroundingContext: z.string().optional(),

  failureScenario: z.string(),
  preconditions: z.string(),
  observedBehavior: z.string(),
  expectedBehavior: z.string(),
  expectedBehaviorSource: z.string(),

  evidenceIds: z.array(z.string().uuid()),
  severity: Severity,
  severityRationale: z.string(),
  confidence: Confidence,
  confidenceRationale: z.string(),

  categories: z.array(FindingCategory),
  mergeImpact: z.enum(["blocking", "non_blocking", "informational"]),
  recommendedNextStep: z.string(),
  unresolvedAssumptions: z.array(z.string()),

  /** Proposed underlying cause for deduplication */
  underlyingCause: z.string(),
  /** Affected behavior summary for deduplication */
  affectedBehavior: z.string(),
});
export type CandidateFinding = z.infer<typeof CandidateFinding>;

/** Validated and classified finding */
export const Finding = z.object({
  schemaVersion: SemVer,
  findingId: z.string().uuid(),
  candidateId: z.string().uuid(),
  runId: z.string().uuid(),
  createdAt: ISOTimestamp,
  validatedAt: ISOTimestamp,
  provenance: Provenance,

  validationStatus: FindingValidationStatus,
  validationRationale: z.string(),
  rejectionReason: z.string().optional(),

  claim: z.string(),
  affectedPath: FilePath,
  headCommit: CommitSha,
  lineRange: LineRange.optional(),

  failureScenario: z.string(),
  observedBehavior: z.string(),
  expectedBehavior: z.string(),
  expectedBehaviorSource: z.string(),

  evidenceIds: z.array(z.string().uuid()),
  severity: Severity,
  confidence: Confidence,

  categories: z.array(FindingCategory),
  mergeImpact: z.enum(["blocking", "non_blocking", "informational"]),
  recommendedNextStep: z.string(),

  /** True if this finding was introduced by the current change (vs pre-existing) */
  introducedByChange: z.boolean().nullable(),

  /** Deduplicated from another candidate ID */
  deduplicatedFrom: z.array(z.string().uuid()),
});
export type Finding = z.infer<typeof Finding>;
