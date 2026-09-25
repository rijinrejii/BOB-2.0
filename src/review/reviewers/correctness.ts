/**
 * review/reviewers/correctness.ts — Correctness specialist reviewer.
 *
 * Compares behavior to accepted criteria, checks edge cases, error handling,
 * state transitions, retries, and concurrency.
 */
import type { ReviewerInput, ReviewerOutput } from "./types.js";
import { makeCandidate, evidenceIdsForPath, headCommitFromEvidence } from "./base.js";
import { invokeModelReviewer } from "./model-invocation.js";

export async function correctnessReviewer(input: ReviewerInput): Promise<ReviewerOutput> {
  const { assignment, brief, diffs, evidence, fixtureMode, model } = input;
  const candidates = [];
  const coverageNotes: string[] = [];
  const missingCapabilities: string[] = [];

  const headCommit = headCommitFromEvidence(evidence);

  // Check: any acceptance criterion has no corresponding changed behavior evidence
  if (brief.acceptanceCriteria.length === 0) {
    coverageNotes.push("No acceptance criteria available — correctness check is limited to pattern analysis.");
  }

  for (const module of brief.affectedModules) {
    const diff = diffs[module.path];
    if (!diff) continue;

    // Detect error handling patterns — absence is a signal
    const hasErrorHandling = /catch|\.catch|try\s*\{|onError|handleError|reject/i.test(diff);
    const addedLines = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const hasNewPaths = addedLines.length > 3;

    if (hasNewPaths && !hasErrorHandling) {
      const evIds = evidenceIdsForPath(module.path, evidence);
      candidates.push(
        makeCandidate(
          {
            claim: "New code paths added without visible error handling",
            affectedPath: module.path,
            headCommit,
            failureScenario: "An unexpected error in the new code path propagates unhandled",
            preconditions: "New code path is exercised with unexpected input or failure",
            observedBehavior: `${addedLines.length} lines added with no observable catch/error handler in diff`,
            expectedBehavior: "All new code paths should handle errors explicitly",
            expectedBehaviorSource: "Engineering standards: error handling requirement",
            evidenceIds: evIds,
            severity: "medium",
            severityRationale: "Unhandled errors typically surface as uncaught exceptions or silent failures",
            confidence: "low",
            confidenceRationale: "Error handling may exist in surrounding code not shown in diff",
            categories: ["correctness"],
            mergeImpact: "non_blocking",
            recommendedNextStep: "Review surrounding context for error handling coverage",
            unresolvedAssumptions: ["Surrounding code not in diff may handle errors"],
            underlyingCause: "missing_error_handling",
            affectedBehavior: `Error propagation in ${module.path}`,
          },
          input,
        ),
      );
    }
  }

  // If model available and not fixture mode, invoke model review
  if (!fixtureMode && model !== null && model.isAvailable()) {
    const modelCandidates = await invokeModelReviewer(input, "correctness", buildCorrectnessPrompt(brief, diffs));
    candidates.push(...modelCandidates.candidates);
    coverageNotes.push(...modelCandidates.coverageNotes);
    missingCapabilities.push(...modelCandidates.missingCapabilities);
  } else if (!fixtureMode && (model === null || !model.isAvailable())) {
    missingCapabilities.push("model: live model unavailable for correctness review");
    coverageNotes.push("Model-based correctness review unavailable — fixture/static analysis only.");
  }

  return { assignmentId: assignment.assignmentId, candidates, coverageNotes, missingCapabilities };
}

function buildCorrectnessPrompt(brief: ReviewBrief, diffs: Record<string, string>): string {
  const criteriaText = brief.acceptanceCriteria
    .map((c) => `- [${c.source}] ${c.description}`)
    .join("\n");
  const diffText = Object.entries(diffs)
    .slice(0, 5)
    .map(([path, diff]) => `### ${path}\n${diff.slice(0, 2000)}`)
    .join("\n\n");

  return `Review the following code changes for correctness.

## Acceptance Criteria
${criteriaText || "None provided."}

## Changed Behavior
${brief.changedBehavior}

## Diffs
${diffText}

Respond with a JSON array of findings. Each finding must include:
- claim (string)
- affectedPath (string)  
- failureScenario (string)
- preconditions (string)
- observedBehavior (string)
- expectedBehavior (string)
- expectedBehaviorSource (string)
- severity: "low" | "medium" | "high" | "critical"
- confidence: "low" | "medium" | "high"
- mergeImpact: "blocking" | "non_blocking" | "informational"
- recommendedNextStep (string)
- underlyingCause (string)
- affectedBehavior (string)

Only report findings with actual evidence. Do not speculate.`;
}

import type { ReviewBrief } from "../../contracts/index.js";
