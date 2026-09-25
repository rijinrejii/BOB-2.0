/**
 * review/reviewers/types.ts — Shared types for specialist reviewers.
 */
import type { ReviewBrief, ReviewerAssignment, EvidenceRecord, CandidateFinding } from "../../contracts/index.js";
import type { ModelPort } from "../../ports/index.js";

export interface ReviewerInput {
  assignment: ReviewerAssignment;
  brief: ReviewBrief;
  /** Source file contents keyed by path */
  contents: Record<string, string>;
  /** Diffs keyed by path */
  diffs: Record<string, string>;
  evidence: EvidenceRecord[];
  model: ModelPort | null;
  /** True when running in deterministic fixture mode (no live model) */
  fixtureMode: boolean;
}

export interface ReviewerOutput {
  assignmentId: string;
  candidates: CandidateFinding[];
  coverageNotes: string[];
  /** Capabilities the reviewer needed but were unavailable */
  missingCapabilities: string[];
}

export type SpecialistReviewer = (input: ReviewerInput) => Promise<ReviewerOutput>;
