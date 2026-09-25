/**
 * review/reviewers/base.ts — Shared utilities for building candidate findings.
 */
import { randomUUID } from "crypto";
import type { CandidateFinding, EvidenceRecord } from "../../contracts/index.js";
import type { ReviewerInput } from "./types.js";

export function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export interface CandidateSpec {
  claim: string;
  affectedPath: string;
  headCommit: string;
  lineRange?: { start: number; end: number };
  surroundingContext?: string;
  failureScenario: string;
  preconditions: string;
  observedBehavior: string;
  expectedBehavior: string;
  expectedBehaviorSource: string;
  evidenceIds: string[];
  severity: "low" | "medium" | "high" | "critical";
  severityRationale: string;
  confidence: "low" | "medium" | "high";
  confidenceRationale: string;
  categories: Array<"correctness" | "impact" | "tests" | "standards" | "security" | "dependency_audit" | "cryptography" | "concurrency">;
  mergeImpact: "blocking" | "non_blocking" | "informational";
  recommendedNextStep: string;
  unresolvedAssumptions: string[];
  underlyingCause: string;
  affectedBehavior: string;
}

export function makeCandidate(
  spec: CandidateSpec,
  input: ReviewerInput,
): CandidateFinding {
  return {
    schemaVersion: "1.0.0",
    candidateId: randomUUID(),
    assignmentId: input.assignment.assignmentId,
    runId: input.assignment.runId,
    createdAt: nowISO(),
    provenance: {
      source: `review/reviewers/${input.assignment.category}`,
      runId: input.assignment.runId,
      createdAt: nowISO(),
    },
    claim: spec.claim,
    affectedPath: spec.affectedPath,
    headCommit: spec.headCommit,
    lineRange: spec.lineRange,
    surroundingContext: spec.surroundingContext,
    failureScenario: spec.failureScenario,
    preconditions: spec.preconditions,
    observedBehavior: spec.observedBehavior,
    expectedBehavior: spec.expectedBehavior,
    expectedBehaviorSource: spec.expectedBehaviorSource,
    evidenceIds: spec.evidenceIds,
    severity: spec.severity,
    severityRationale: spec.severityRationale,
    confidence: spec.confidence,
    confidenceRationale: spec.confidenceRationale,
    categories: spec.categories,
    mergeImpact: spec.mergeImpact,
    recommendedNextStep: spec.recommendedNextStep,
    unresolvedAssumptions: spec.unresolvedAssumptions,
    underlyingCause: spec.underlyingCause,
    affectedBehavior: spec.affectedBehavior,
  };
}

/** Extract evidence IDs relevant to a given path */
export function evidenceIdsForPath(path: string, evidence: EvidenceRecord[]): string[] {
  return evidence
    .filter((e) => e.path === path || e.summary.includes(path))
    .map((e) => e.evidenceId);
}

/** Find head commit from evidence records */
export function headCommitFromEvidence(evidence: EvidenceRecord[]): string {
  for (const e of evidence) {
    if (e.commit) return e.commit;
  }
  return "unknown";
}
