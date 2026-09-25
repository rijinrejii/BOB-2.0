/**
 * review/reviewers/impact.ts — Impact specialist reviewer.
 *
 * Traces observed callers, interfaces, configuration, storage, and
 * deployment dependencies. Separates observed from speculation.
 */
import type { ReviewerInput, ReviewerOutput } from "./types.js";
import { makeCandidate, evidenceIdsForPath, headCommitFromEvidence } from "./base.js";
import { invokeModelReviewer } from "./model-invocation.js";
import type { ReviewBrief } from "../../contracts/index.js";

export async function impactReviewer(input: ReviewerInput): Promise<ReviewerOutput> {
  const { assignment, brief, diffs, evidence, fixtureMode, model } = input;
  const candidates = [];
  const coverageNotes: string[] = [];
  const missingCapabilities: string[] = [];

  const headCommit = headCommitFromEvidence(evidence);

  // Check for exported symbol changes (public API surface changes)
  for (const module of brief.affectedModules) {
    const diff = diffs[module.path];
    if (!diff) continue;

    const exportChanges = detectExportChanges(diff);
    if (exportChanges.length > 0) {
      const evIds = evidenceIdsForPath(module.path, evidence);
      for (const exportChange of exportChanges) {
        candidates.push(
          makeCandidate(
            {
              claim: `Public export changed: ${exportChange}`,
              affectedPath: module.path,
              headCommit,
              failureScenario: "Callers of this export receive a different API without expecting it",
              preconditions: "Existing callers import this symbol",
              observedBehavior: `Export signature changed in diff: ${exportChange}`,
              expectedBehavior: "Public API changes require caller analysis and version coordination",
              expectedBehaviorSource: "Impact review: public interface stability",
              evidenceIds: evIds,
              severity: "medium",
              severityRationale: "Public API change without caller analysis risks breaking consumers",
              confidence: "medium",
              confidenceRationale: "Export change confirmed in diff; caller impact requires broader codebase view",
              categories: ["impact"],
              mergeImpact: "non_blocking",
              recommendedNextStep: "Search for callers of this export and verify compatibility",
              unresolvedAssumptions: ["Callers not visible in this snapshot — requires codebase search"],
              underlyingCause: "public_api_surface_change",
              affectedBehavior: `Public interface of ${module.path}`,
            },
            input,
          ),
        );
      }
    }

    // Detect configuration-affecting changes
    if (isConfigurationFile(module.path)) {
      const evIds = evidenceIdsForPath(module.path, evidence);
      candidates.push(
        makeCandidate(
          {
            claim: `Configuration file changed: ${module.path}`,
            affectedPath: module.path,
            headCommit,
            failureScenario: "Deployment with new config fails or changes runtime behavior",
            preconditions: "Application loads this configuration",
            observedBehavior: "Configuration file modified in diff",
            expectedBehavior: "Configuration changes require deployment impact analysis",
            expectedBehaviorSource: "Impact review: deployment configuration",
            evidenceIds: evIds,
            severity: "medium",
            severityRationale: "Configuration changes can silently alter runtime behavior across environments",
            confidence: "high",
            confidenceRationale: "Configuration file identified by path and diff",
            categories: ["impact"],
            mergeImpact: "non_blocking",
            recommendedNextStep: "Review deployment configuration change impact across environments",
            unresolvedAssumptions: [],
            underlyingCause: "configuration_change",
            affectedBehavior: `Runtime configuration via ${module.path}`,
          },
          input,
        ),
      );
    }
  }

  if (!fixtureMode && model !== null && model.isAvailable()) {
    const modelResult = await invokeModelReviewer(input, "impact", buildImpactPrompt(brief, diffs));
    candidates.push(...modelResult.candidates);
    coverageNotes.push(...modelResult.coverageNotes);
    missingCapabilities.push(...modelResult.missingCapabilities);
  } else if (!fixtureMode && (model === null || !model.isAvailable())) {
    missingCapabilities.push("model: live model unavailable for impact review");
    coverageNotes.push("Caller graph analysis unavailable without model — static pattern detection only.");
  }

  coverageNotes.push("Caller analysis is limited to visible diff exports; full codebase graph not available.");

  return { assignmentId: assignment.assignmentId, candidates, coverageNotes, missingCapabilities };
}

/** Detect changed export names from a diff */
function detectExportChanges(diff: string): string[] {
  const exportPattern = /^\+.*\bexport\s+(const|function|class|interface|type|enum|default)\s+(\w+)/gm;
  const removed = /^-.*\bexport\s+(const|function|class|interface|type|enum|default)\s+(\w+)/gm;

  const added = new Set<string>();
  const deletedExports = new Set<string>();

  for (const match of diff.matchAll(exportPattern)) {
    added.add(match[2] ?? "unknown");
  }
  for (const match of diff.matchAll(removed)) {
    deletedExports.add(match[2] ?? "unknown");
  }

  // Changed = in added AND deleted (rename/signature change) OR removed only
  const changed: string[] = [];
  for (const name of deletedExports) {
    changed.push(name);
  }
  return changed;
}

function isConfigurationFile(path: string): boolean {
  return /\.(json|yaml|yml|toml|ini|conf|env)$/i.test(path) &&
    !/node_modules/.test(path) &&
    !/(test|spec)\.(ts|js)/.test(path);
}

function buildImpactPrompt(brief: ReviewBrief, diffs: Record<string, string>): string {
  const diffText = Object.entries(diffs)
    .slice(0, 5)
    .map(([path, diff]) => `### ${path}\n${diff.slice(0, 2000)}`)
    .join("\n\n");

  return `Review the following code changes for impact on callers, interfaces, and dependencies.

## Affected Modules
${brief.affectedModules.map((m) => `- ${m.path} (${m.role})`).join("\n")}

## Trust Boundaries
${brief.trustBoundaries.join("\n") || "None identified."}

## Diffs
${diffText}

Identify changes to public interfaces, configuration, or deployment dependencies.
Return JSON array with fields: claim, affectedPath, failureScenario, preconditions,
observedBehavior, expectedBehavior, expectedBehaviorSource, severity, confidence,
mergeImpact, recommendedNextStep, underlyingCause, affectedBehavior.
Separate observed facts from speculation.`;
}
