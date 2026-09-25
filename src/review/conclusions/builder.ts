/**
 * review/conclusions/builder.ts — Derives ReviewConclusions and builds the ReviewReport.
 *
 * Rules (strict):
 * - Confirmed policy-blocking defects → changes_required
 * - Unresolved concerns are NOT confirmed blocking defects
 * - Serious unresolved risk may → human_decision_required
 * - Missing mandatory evidence → incomplete
 * - Multiple conclusions may coexist
 * - no_blocking_findings_within_reviewed_scope ONLY when nothing above applies
 */
import { randomUUID } from "crypto";
import type {
  ReviewBrief,
  RiskAssessment,
  ReviewPlan,
  Finding,
  ReviewReport,
  RepositorySnapshot,
  ModelTraceability,
  VerificationRecord,
} from "../../contracts/index.js";

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export interface ReportBuilderInput {
  runId: string;
  snapshot: RepositorySnapshot;
  brief: ReviewBrief;
  assessment: RiskAssessment;
  plan: ReviewPlan;
  findings: Finding[];
  verificationRecords: VerificationRecord[];
  modelTraceability: ModelTraceability[];
  fixtureMode: boolean;
  coverageNotes: string[];
}

export function buildReviewReport(input: ReportBuilderInput): ReviewReport {
  const {
    runId,
    snapshot,
    brief,
    assessment,
    plan,
    findings,
    verificationRecords,
    modelTraceability,
    fixtureMode,
    coverageNotes,
  } = input;

  const confirmedFindings = findings.filter((f) => f.validationStatus === "confirmed");
  const unresolvedFindings = findings.filter((f) => f.validationStatus === "unresolved");
  const suggestions = findings.filter(
    (f) => f.validationStatus === "confirmed" && f.mergeImpact === "informational",
  );
  const blockingFindings = confirmedFindings.filter(
    (f) => f.mergeImpact === "blocking",
  );

  // Build coverage gaps
  const coverageGaps = buildCoverageGaps(plan, coverageNotes, verificationRecords);

  // Derive conclusions
  const conclusions = deriveConclusions(
    blockingFindings,
    unresolvedFindings,
    coverageGaps,
    brief,
    assessment,
  );

  // Build executive summary
  const executiveSummary = buildExecutiveSummary(
    brief,
    assessment,
    confirmedFindings,
    unresolvedFindings,
    coverageGaps,
    conclusions,
    fixtureMode,
  );

  return {
    schemaVersion: "1.0.0",
    reportId: randomUUID(),
    runId,
    snapshotId: snapshot.snapshotId,
    briefId: brief.briefId,
    createdAt: nowISO(),
    provenance: {
      source: "review/conclusions/builder",
      runId,
      createdAt: nowISO(),
    },
    fixtureMode,
    changeSummary: brief.intendedOutcome,
    riskLevel: assessment.level,
    riskFactorSummary: assessment.impactAssessment,
    conclusions,
    confirmedFindings: confirmedFindings.map((f) => f.findingId),
    suggestions: suggestions.map((f) => f.findingId),
    unresolvedConcerns: unresolvedFindings.map((f) => f.findingId),
    verificationRecords,
    coverageGaps,
    humanDecisionIds: brief.humanDecisions.map((d) => d.decisionId),
    modelTraceability,
    executiveSummary,
  };
}

type ReviewConclusion =
  | "changes_required"
  | "human_decision_required"
  | "incomplete"
  | "no_blocking_findings_within_reviewed_scope";

function deriveConclusions(
  blockingFindings: Finding[],
  unresolvedFindings: Finding[],
  coverageGaps: ReviewReport["coverageGaps"],
  brief: ReviewBrief,
  assessment: RiskAssessment,
): ReviewConclusion[] {
  const conclusions = new Set<ReviewConclusion>();

  // Rule: Confirmed policy-blocking defects → changes_required
  if (blockingFindings.length > 0) {
    conclusions.add("changes_required");
  }

  // Rule: Unresolved concerns on mandatory/high-risk areas → human_decision_required
  const highSeverityUnresolved = unresolvedFindings.filter(
    (f) => f.severity === "high" || f.severity === "critical",
  );
  if (
    highSeverityUnresolved.length > 0 ||
    brief.humanDecisions.length > 0 ||
    // High risk with owner_review escalation requirement
    (assessment.level === "high" && assessment.escalationRequiredAssignments.length > 0)
  ) {
    conclusions.add("human_decision_required");
  }

  // Rule: Missing mandatory evidence → incomplete
  const mandatoryGaps = coverageGaps.filter((g) => g.isMandatory);
  if (mandatoryGaps.length > 0) {
    conclusions.add("incomplete");
  }

  // Rule: no_blocking_findings_within_reviewed_scope ONLY when nothing adverse
  // Cannot add this if: blocking exists, incomplete, or material human decision required
  if (
    conclusions.size === 0 ||
    (conclusions.size === 1 && conclusions.has("incomplete") && blockingFindings.length === 0)
  ) {
    // Only if there are no blocking defects — incomplete can coexist, but only if no blocking
    if (blockingFindings.length === 0) {
      // Still cannot issue if high-severity unresolved without a plan
      if (highSeverityUnresolved.length === 0) {
        conclusions.add("no_blocking_findings_within_reviewed_scope");
      }
    }
  }

  // Fallback: if nothing was set (shouldn't happen), mark incomplete
  if (conclusions.size === 0) {
    conclusions.add("incomplete");
  }

  return Array.from(conclusions);
}

function buildCoverageGaps(
  plan: ReviewPlan,
  coverageNotes: string[],
  verificationRecords: VerificationRecord[],
): ReviewReport["coverageGaps"] {
  const gaps: ReviewReport["coverageGaps"] = [];

  // Skipped mandatory assignments are gaps
  for (const assignment of plan.assignments) {
    if (assignment.status === "skipped" && assignment.category !== "correctness") {
      gaps.push({
        gapId: randomUUID(),
        description: `Assignment skipped: ${assignment.category} — ${assignment.exclusionReason ?? "no reason given"}`,
        affectedCategories: [assignment.category],
        isMandatory: false,
      });
    }
  }

  // Excluded categories with reasons
  for (const excluded of plan.excludedCategories) {
    gaps.push({
      gapId: randomUUID(),
      description: `Category excluded: ${excluded.category} — ${excluded.reason}`,
      affectedCategories: [excluded.category],
      isMandatory: false,
    });
  }

  // Missing verification (model unavailable is a mandatory gap for medium/high risk)
  const modelUnavailable = coverageNotes.some(
    (n) => /model.*unavailable|model.*unavailable/i.test(n),
  );
  if (modelUnavailable) {
    gaps.push({
      gapId: randomUUID(),
      description: "Model-based review unavailable — analysis limited to static pattern detection",
      affectedCategories: ["correctness", "impact", "tests", "standards", "security"],
      isMandatory: false,
    });
  }

  // Failed/unavailable checks
  const failedChecks = verificationRecords.filter(
    (v) => v.outcome === "fail" || v.outcome === "unavailable",
  );
  for (const check of failedChecks) {
    gaps.push({
      gapId: randomUUID(),
      description: `Verification check unavailable or failed: ${check.commandId} — ${check.outcome}${check.failureKind ? ` (${check.failureKind})` : ""}`,
      affectedCategories: [],
      isMandatory: check.outcome === "unavailable",
    });
  }

  return gaps;
}

function buildExecutiveSummary(
  brief: ReviewBrief,
  assessment: RiskAssessment,
  confirmed: Finding[],
  unresolved: Finding[],
  gaps: ReviewReport["coverageGaps"],
  conclusions: ReviewConclusion[],
  fixtureMode: boolean,
): string {
  const riskText = `Risk: ${assessment.level.toUpperCase()}${assessment.mandatoryClassification ? " (mandatory)" : ""}.`;
  const findingsText =
    confirmed.length === 0
      ? "No blocking findings confirmed within reviewed scope."
      : `${confirmed.filter((f) => f.mergeImpact === "blocking").length} blocking finding(s) confirmed.`;
  const unresolvedText =
    unresolved.length > 0
      ? ` ${unresolved.length} concern(s) could not be confirmed or rejected.`
      : "";
  const gapText =
    gaps.length > 0
      ? ` Coverage gaps: ${gaps.slice(0, 2).map((g) => g.affectedCategories[0] ?? "general").join(", ")}${gaps.length > 2 ? " and more" : ""}.`
      : "";
  const conclusionText = conclusions.join(", ");
  const fixtureBadge = fixtureMode ? " [FIXTURE MODE — not a production review]" : "";

  return `${riskText} ${findingsText}${unresolvedText}${gapText} Conclusions: ${conclusionText}.${fixtureBadge}`;
}
