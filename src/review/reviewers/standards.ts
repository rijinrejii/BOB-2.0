/**
 * review/reviewers/standards.ts — Standards specialist reviewer.
 *
 * Applies approved, applicable rules with exact source/version references.
 * Separates mandatory rules from preferences.
 */
import type { ReviewerInput, ReviewerOutput } from "./types.js";
import { makeCandidate, evidenceIdsForPath, headCommitFromEvidence } from "./base.js";
import { invokeModelReviewer } from "./model-invocation.js";
import type { ReviewBrief } from "../../contracts/index.js";

export async function standardsReviewer(input: ReviewerInput): Promise<ReviewerOutput> {
  const { assignment, brief, diffs, evidence, fixtureMode, model } = input;
  const candidates = [];
  const coverageNotes: string[] = [];
  const missingCapabilities: string[] = [];

  const headCommit = headCommitFromEvidence(evidence);

  for (const module of brief.affectedModules) {
    const diff = diffs[module.path];
    if (!diff) continue;

    const violations = detectStandardsViolations(diff, module.path);
    for (const violation of violations) {
      const evIds = evidenceIdsForPath(module.path, evidence);
      candidates.push(
        makeCandidate(
          {
            claim: violation.claim,
            affectedPath: module.path,
            headCommit,
            failureScenario: violation.scenario,
            preconditions: "Code is deployed or reviewed",
            observedBehavior: violation.observed,
            expectedBehavior: violation.expected,
            expectedBehaviorSource: violation.ruleRef,
            evidenceIds: evIds,
            severity: violation.mandatory ? "medium" : "low",
            severityRationale: violation.mandatory
              ? "Mandatory rule violation"
              : "Preference-level style issue",
            confidence: "high",
            confidenceRationale: `Static pattern match: ${violation.pattern}`,
            categories: ["standards"],
            mergeImpact: violation.mandatory ? "non_blocking" : "informational",
            recommendedNextStep: violation.recommendation,
            unresolvedAssumptions: [],
            underlyingCause: violation.cause,
            affectedBehavior: `Standards compliance in ${module.path}`,
          },
          input,
        ),
      );
    }
  }

  if (!fixtureMode && model !== null && model.isAvailable()) {
    const modelResult = await invokeModelReviewer(input, "standards", buildStandardsPrompt(brief, diffs));
    candidates.push(...modelResult.candidates);
    coverageNotes.push(...modelResult.coverageNotes);
    missingCapabilities.push(...modelResult.missingCapabilities);
  } else if (!fixtureMode && (model === null || !model.isAvailable())) {
    missingCapabilities.push("model: live model unavailable for standards review");
    coverageNotes.push("Standards review limited to static pattern matching; model-based analysis unavailable.");
  }

  coverageNotes.push("Standards check applies built-in patterns only. No external standards document provided.");

  return { assignmentId: assignment.assignmentId, candidates, coverageNotes, missingCapabilities };
}

interface StandardsViolation {
  claim: string;
  scenario: string;
  observed: string;
  expected: string;
  ruleRef: string;
  pattern: string;
  cause: string;
  recommendation: string;
  mandatory: boolean;
}

function detectStandardsViolations(diff: string, path: string): StandardsViolation[] {
  const violations: StandardsViolation[] = [];
  const addedLines = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));

  // Mandatory: console.log in non-test production code
  if (!/(test|spec)\.(ts|js)$/.test(path)) {
    const consoleLines = addedLines.filter((l) => /console\.(log|debug|warn|error)\s*\(/.test(l));
    if (consoleLines.length > 0) {
      violations.push({
        claim: `console.log/debug/warn calls added in production code`,
        scenario: "Debug output leaks to production logs",
        observed: `${consoleLines.length} console.* call(s) added`,
        expected: "Use structured logging instead of console.*",
        ruleRef: "Standards: no console.* in production code (TypeScript strict conventions)",
        pattern: "console.log|debug|warn|error",
        cause: "debug_logging_in_production",
        recommendation: "Replace console.* with structured logger",
        mandatory: true,
      });
    }
  }

  // Mandatory: TODO/FIXME left in committed code
  const todoLines = addedLines.filter((l) => /TODO:|FIXME:|HACK:|XXX:/i.test(l));
  if (todoLines.length > 0) {
    violations.push({
      claim: `TODO/FIXME comment(s) committed in ${path}`,
      scenario: "Known incomplete or broken code is merged",
      observed: `${todoLines.length} TODO/FIXME marker(s) added`,
      expected: "TODO/FIXME items should be tracked as issues, not committed",
      ruleRef: "Standards: no TODO/FIXME in merged code without issue reference",
      pattern: "TODO/FIXME/HACK/XXX",
      cause: "todo_in_committed_code",
      recommendation: "Create an issue for each TODO/FIXME and remove the inline marker, or resolve it",
      mandatory: true,
    });
  }

  // Preference: any/unknown casts in TypeScript
  if (/\.(ts|tsx)$/.test(path)) {
    const anyLines = addedLines.filter((l) => /:\s*any\b|as\s+any\b/.test(l));
    if (anyLines.length > 0) {
      violations.push({
        claim: `TypeScript 'any' type annotation or cast added in ${path}`,
        scenario: "Type safety bypassed; runtime errors not caught at compile time",
        observed: `${anyLines.length} 'any' annotation(s) added`,
        expected: "Use specific types or 'unknown' with narrowing",
        ruleRef: "TypeScript strict mode: @typescript-eslint/no-explicit-any",
        pattern: ": any | as any",
        cause: "typescript_any_usage",
        recommendation: "Replace 'any' with a specific type or 'unknown' with explicit narrowing",
        mandatory: false,
      });
    }
  }

  return violations;
}

function buildStandardsPrompt(brief: ReviewBrief, diffs: Record<string, string>): string {
  const diffText = Object.entries(diffs)
    .slice(0, 5)
    .map(([path, diff]) => `### ${path}\n${diff.slice(0, 2000)}`)
    .join("\n\n");

  return `Review the following code changes for standards compliance.

## Diffs
${diffText}

Apply mandatory rules (must fix) and preference rules (should fix) separately.
Cite the exact rule reference for each finding.
Return JSON array with fields: claim, affectedPath, failureScenario, preconditions,
observedBehavior, expectedBehavior, expectedBehaviorSource, severity, confidence,
mergeImpact, recommendedNextStep, underlyingCause, affectedBehavior.`;
}
