/**
 * brief.ts — ReviewBrief: shared understanding of the PR built before review.
 * Rijin builds this from snapshot + metadata.
 */
import { z } from "zod";
import { ISOTimestamp, SemVer, Provenance, FilePath } from "./common.js";

export const RequirementSource = z.enum(["stated", "inferred"]);
export type RequirementSource = z.infer<typeof RequirementSource>;

export const AcceptanceCriterion = z.object({
  id: z.string(),
  description: z.string(),
  source: RequirementSource,
  /** Where this criterion came from (document path, PR description, etc.) */
  sourceRef: z.string().optional(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;

export const BriefAssumption = z.object({
  id: z.string(),
  description: z.string(),
  /** True if the assumption is potentially contradicted by other evidence */
  contradicted: z.boolean(),
  contradictionNote: z.string().optional(),
});
export type BriefAssumption = z.infer<typeof BriefAssumption>;

export const HumanDecisionKind = z.enum([
  "ambiguous_requirement",
  "conflicting_guidance",
  "risk_override_required",
  "unresolved_concern",
  "policy_authorization_required",
]);
export type HumanDecisionKind = z.infer<typeof HumanDecisionKind>;

export const HumanDecision = z.object({
  schemaVersion: SemVer,
  decisionId: z.string().uuid(),
  runId: z.string().uuid(),
  createdAt: ISOTimestamp,
  provenance: Provenance,

  kind: HumanDecisionKind,
  title: z.string(),
  description: z.string(),
  /** Competing options or interpretations, if applicable */
  options: z.array(z.string()).optional(),
  /** Resolved decision text, set by a human */
  resolution: z.string().optional(),
  resolvedAt: ISOTimestamp.optional(),
  resolvedBy: z.string().optional(),
});
export type HumanDecision = z.infer<typeof HumanDecision>;

export const ReviewBrief = z.object({
  schemaVersion: SemVer,
  briefId: z.string().uuid(),
  runId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  createdAt: ISOTimestamp,
  provenance: Provenance,

  /** Summary of the PR's intended outcome */
  intendedOutcome: z.string(),

  /** What behavior is being changed */
  changedBehavior: z.string(),

  /** What behavior is explicitly expected to remain unchanged */
  unchangedBehavior: z.string(),

  acceptanceCriteria: z.array(AcceptanceCriterion),

  affectedModules: z.array(z.object({
    path: FilePath,
    role: z.string(),
  })),

  dataFlows: z.array(z.string()),
  trustBoundaries: z.array(z.string()),

  compatibilityNotes: z.string().optional(),
  migrationNotes: z.string().optional(),

  assumptions: z.array(BriefAssumption),

  /** Open items that block complete analysis */
  missingInformation: z.array(z.string()),

  humanDecisions: z.array(HumanDecision),

  /** Files not included in context due to bounds */
  excludedFiles: z.array(z.object({
    path: FilePath,
    reason: z.string(),
  })),

  /** True if context was bounded (not all relevant files loaded) */
  contextBounded: z.boolean(),
});
export type ReviewBrief = z.infer<typeof ReviewBrief>;
