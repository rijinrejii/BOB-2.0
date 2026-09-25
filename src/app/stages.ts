/**
 * app/stages.ts
 *
 * Stage definitions and transition rules for the review workflow.
 *
 * Enforced stage sequence:
 *   intake → context_collection → risk_assessment → planning
 *   → review → validation → verification → reporting → completed
 *
 * Terminal statuses: completed, failed, cancelled, superseded
 * Waiting statuses: needs_input
 */

export const STAGES = [
  "intake",
  "context_collection",
  "risk_assessment",
  "planning",
  "review",
  "validation",
  "verification",
  "reporting",
  "completed",
] as const;

export type Stage = (typeof STAGES)[number];

export const TERMINAL_STATUSES = ["completed", "failed", "cancelled", "superseded"] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export const ACTIVE_STATUSES = ["running", "needs_input", "interrupted"] as const;
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

export type RunStatus = TerminalStatus | ActiveStatus;

/** Valid status values at each stage */
export const VALID_STATUSES_FOR_STAGE: Record<Stage, RunStatus[]> = {
  intake: ["running", "needs_input", "failed", "cancelled"],
  context_collection: ["running", "needs_input", "failed", "cancelled"],
  risk_assessment: ["running", "needs_input", "failed", "cancelled"],
  planning: ["running", "needs_input", "failed", "cancelled"],
  review: ["running", "needs_input", "failed", "cancelled"],
  validation: ["running", "needs_input", "failed", "cancelled"],
  verification: ["running", "needs_input", "failed", "cancelled"],
  reporting: ["running", "needs_input", "failed", "cancelled"],
  completed: ["completed", "failed", "cancelled", "superseded"],
};

/** Allowed next stages from each stage */
export const NEXT_STAGE: Record<Stage, Stage | null> = {
  intake: "context_collection",
  context_collection: "risk_assessment",
  risk_assessment: "planning",
  planning: "review",
  review: "validation",
  validation: "verification",
  verification: "reporting",
  reporting: "completed",
  completed: null,
};

/**
 * Check whether a stage transition is valid.
 * Only forward transitions (to the next stage in sequence) are allowed
 * automatically. Backward transitions require explicit recovery.
 */
export function isValidTransition(from: Stage, to: Stage): boolean {
  return NEXT_STAGE[from] === to;
}

/**
 * Get the index of a stage in the pipeline.
 */
export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}
