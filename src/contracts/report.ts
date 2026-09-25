/**
 * report.ts — ReviewReport: final structured output of a review.
 */
import { z } from "zod";
import { ISOTimestamp, SemVer, RiskLevel, Provenance } from "./common.js";

export const ReviewConclusion = z.enum([
  "changes_required",
  "human_decision_required",
  "incomplete",
  "no_blocking_findings_within_reviewed_scope",
]);
export type ReviewConclusion = z.infer<typeof ReviewConclusion>;

export const CoverageGap = z.object({
  gapId: z.string(),
  description: z.string(),
  affectedCategories: z.array(z.string()),
  isMandatory: z.boolean(),
});
export type CoverageGap = z.infer<typeof CoverageGap>;

export const VerificationRecord = z.object({
  checkId: z.string().uuid().optional(),
  commandId: z.string(),
  outcome: z.string(),
  failureKind: z.string().optional(),
  attributionNote: z.string().optional(),
});
export type VerificationRecord = z.infer<typeof VerificationRecord>;

export const ModelTraceability = z.object({
  provider: z.string(),
  modelId: z.string(),
  promptVersion: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  usageTokens: z.object({
    prompt: z.number().int().nonnegative().optional(),
    completion: z.number().int().nonnegative().optional(),
  }).optional(),
  fixtureMode: z.boolean(),
});
export type ModelTraceability = z.infer<typeof ModelTraceability>;

export const ReviewReport = z.object({
  schemaVersion: SemVer,
  reportId: z.string().uuid(),
  runId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  briefId: z.string().uuid(),
  createdAt: ISOTimestamp,
  provenance: Provenance,

  fixtureMode: z.boolean(),

  /** Summary of the PR's intended change */
  changeSummary: z.string(),
  riskLevel: RiskLevel,
  riskFactorSummary: z.string(),

  conclusions: z.array(ReviewConclusion).min(1),

  /** Confirmed, blocking findings */
  confirmedFindings: z.array(z.string().uuid()),
  /** Non-blocking suggestions */
  suggestions: z.array(z.string().uuid()),
  /** Unresolved concerns that could not be confirmed or rejected */
  unresolvedConcerns: z.array(z.string().uuid()),

  verificationRecords: z.array(VerificationRecord),
  coverageGaps: z.array(CoverageGap),

  /** Pending human decisions */
  humanDecisionIds: z.array(z.string().uuid()),

  modelTraceability: z.array(ModelTraceability),

  /** Concise, actionable summary (3–5 sentences max) */
  executiveSummary: z.string(),
});
export type ReviewReport = z.infer<typeof ReviewReport>;
