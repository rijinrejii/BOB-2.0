/**
 * review/risk/assessor.ts — Builds a RiskAssessment from a ReviewBrief.
 *
 * Rules:
 * - Any mandatory rule match → HIGH, mandatoryClassification = true
 * - No mandatory, but informational signals → MEDIUM
 * - Low requires positive evidence of limited scope (never by default)
 * - Default when insufficient context → MEDIUM
 * - A human override with audit reason is required to downgrade mandatory HIGH
 */
import { randomUUID } from "crypto";
import type { ReviewBrief, RepositorySnapshot, RiskAssessment } from "../../contracts/index.js";
import { applyMandatoryRules, assessInformationalRisk } from "./rules.js";

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export interface RiskAssessorInput {
  brief: ReviewBrief;
  snapshot: RepositorySnapshot;
  /** File diffs keyed by path */
  diffs: Record<string, string>;
  /** File contents keyed by path (head) */
  contents: Record<string, string>;
}

export function buildRiskAssessment(input: RiskAssessorInput): RiskAssessment {
  const { brief, snapshot, diffs, contents } = input;

  // Build file evidence array for rule checking
  const files = snapshot.changedFiles.map((f) => ({
    path: f.path,
    diff: diffs[f.path],
    content: contents[f.path],
  }));

  const mandatoryMatches = applyMandatoryRules(brief, files);
  const informationalSignals = assessInformationalRisk(brief, files);

  const hasMandatory = mandatoryMatches.length > 0;

  // Determine level
  let level: "low" | "medium" | "high";
  let impactAssessment: string;
  let uncertaintyAssessment: string;

  if (hasMandatory) {
    level = "high";
    const categories = mandatoryMatches
      .filter((m) => m.mandatoryCategory)
      .map((m) => m.mandatoryCategory as string)
      .join(", ");
    impactAssessment = `Mandatory risk factors triggered: ${categories}. Requires full review plus specialist assignments and owner sign-off.`;
    uncertaintyAssessment = "Mandatory classification is certain; impact scope may be wider than visible in diff.";
  } else {
    // Check for positive evidence of limited scope first —
    // informational-only signals do not prevent LOW when scope is positively confirmed.
    const hasLimitedScope = isPositivelyLimitedScope(brief, snapshot);
    if (hasLimitedScope) {
      level = "low";
      impactAssessment = "Positive evidence of limited, self-contained scope. Focused checks apply.";
      uncertaintyAssessment = "Scope appears well-bounded with no mandatory risk factors.";
    } else if (informationalSignals.some((s) => s.factorId !== "missing-information" && s.factorId !== "missing-acceptance-criteria") || brief.missingInformation.length > 1) {
      // Substantive informational signals or multiple missing items → medium
      level = "medium";
      impactAssessment = "Moderate-scope change with informational risk signals. Standard full review applies.";
      uncertaintyAssessment = "Some uncertainty from informational signals; see risk factors.";
    } else {
      level = "medium";
      impactAssessment = "No mandatory risk factors, but positive evidence of limited scope is absent. Standard review applies.";
      uncertaintyAssessment = "Default to medium: low risk requires positive evidence of limited scope.";
    }
  }

  // Combine all factors
  const allFactors = [
    ...mandatoryMatches.map((m, i) => ({
      factorId: m.factorId,
      mandatory: true,
      mandatoryCategory: m.mandatoryCategory,
      description: m.description,
      evidence: m.evidence,
      certainty: m.certainty,
    })),
    ...informationalSignals.map((s) => ({
      factorId: s.factorId,
      mandatory: false as const,
      mandatoryCategory: undefined,
      description: s.description,
      evidence: s.evidence,
      certainty: s.certainty,
    })),
  ];

  return {
    schemaVersion: "1.0.0",
    assessmentId: randomUUID(),
    runId: brief.runId,
    briefId: brief.briefId,
    createdAt: nowISO(),
    provenance: {
      source: "review/risk/assessor",
      runId: brief.runId,
      createdAt: nowISO(),
    },
    level,
    mandatoryClassification: hasMandatory,
    mandatoryFactors: mandatoryMatches
      .filter((m) => m.mandatoryCategory !== undefined)
      .map((m) => m.mandatoryCategory as NonNullable<typeof m.mandatoryCategory>),
    impactAssessment,
    uncertaintyAssessment,
    factors: allFactors,
    escalationRequiredAssignments: hasMandatory ? ["owner_review"] : [],
  };
}

/**
 * Returns true only when there is positive evidence of limited scope.
 * A documentation filename alone is NOT sufficient.
 */
function isPositivelyLimitedScope(brief: ReviewBrief, snapshot: RepositorySnapshot): boolean {
  const { changedFiles, totalLinesAdded, totalLinesRemoved } = snapshot;

  // Only doc/test files with small diff (not config — config can change runtime behavior)
  const onlyDocTestChanges = changedFiles.every((f) =>
    /\.(md|txt|rst|test\.(ts|js)|spec\.(ts|js))$/.test(f.path),
  );

  // Must have STATED acceptance criteria (not inferred) to confirm limited scope.
  // An inferred criterion from a PR title alone is insufficient evidence.
  const hasStatedAcceptanceCriteria = brief.acceptanceCriteria.some((c) => c.source === "stated");

  // Very small change
  const isSmallChange = totalLinesAdded + totalLinesRemoved <= 20 && changedFiles.length <= 3;

  return onlyDocTestChanges && hasStatedAcceptanceCriteria && isSmallChange;
}
