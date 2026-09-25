/**
 * plan.ts — ReviewPlan and ReviewerAssignment.
 * Rijin builds this from the RiskAssessment.
 */
import { z } from "zod";
import { ISOTimestamp, SemVer, FilePath, Provenance } from "./common.js";

export const ReviewCategory = z.enum([
  "correctness",
  "impact",
  "tests",
  "standards",
  "security",
]);
export type ReviewCategory = z.infer<typeof ReviewCategory>;

export const SpecialistCategory = z.enum([
  "dependency_audit",
  "cryptography",
  "concurrency",
]);
export type SpecialistCategory = z.infer<typeof SpecialistCategory>;

export const AnyCategory = z.union([ReviewCategory, SpecialistCategory]);
export type AnyCategory = z.infer<typeof AnyCategory>;

export const AssignmentStatus = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "skipped",
]);
export type AssignmentStatus = z.infer<typeof AssignmentStatus>;

export const ResourceLimits = z.object({
  maxContextTokens: z.number().int().positive(),
  maxResponseTokens: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().nonnegative(),
});
export type ResourceLimits = z.infer<typeof ResourceLimits>;

export const ReviewerAssignment = z.object({
  assignmentId: z.string().uuid(),
  planId: z.string().uuid(),
  runId: z.string().uuid(),

  category: AnyCategory,
  scope: z.string(),
  questions: z.array(z.string()),
  requiredEvidence: z.array(z.string()),
  allowedCapabilities: z.array(z.string()),
  dependencies: z.array(z.string().uuid()),

  resourceLimits: ResourceLimits,
  completionCriteria: z.string(),

  status: AssignmentStatus,
  /** File paths this assignment focuses on */
  focusedPaths: z.array(FilePath),
  /** Reason if excluded/skipped */
  exclusionReason: z.string().optional(),

  startedAt: ISOTimestamp.optional(),
  completedAt: ISOTimestamp.optional(),
});
export type ReviewerAssignment = z.infer<typeof ReviewerAssignment>;

export const ReviewPlan = z.object({
  schemaVersion: SemVer,
  planId: z.string().uuid(),
  runId: z.string().uuid(),
  assessmentId: z.string().uuid(),
  createdAt: ISOTimestamp,
  provenance: Provenance,

  assignments: z.array(ReviewerAssignment),

  /** Assignments that may run concurrently (no dependencies between them) */
  concurrentGroups: z.array(z.array(z.string().uuid())),

  /** Reviewer categories explicitly excluded and why */
  excludedCategories: z.array(z.object({
    category: AnyCategory,
    reason: z.string(),
  })),
});
export type ReviewPlan = z.infer<typeof ReviewPlan>;
