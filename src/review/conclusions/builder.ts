import { randomUUID } from "node:crypto";
import {
  ReviewReport,
  type ReviewBrief,
  type RiskAssessment,
  type ReviewPlan,
  type Finding,
  type RepositorySnapshot,
  type ModelTraceability,
  type VerificationRecord,
  type ReviewConclusion,
} from "../../contracts/index.js";

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
  const blocking = input.findings.filter(
    (finding) =>
      finding.validationStatus === "confirmed" &&
      finding.mergeImpact === "blocking",
  );

  const suggestions = input.findings.filter(
    (finding) =>
      finding.validationStatus === "confirmed" &&
      finding.mergeImpact !== "blocking",
  );

  const unresolved = input.findings.filter(
    (finding) => finding.validationStatus === "unresolved",
  );

  const pendingDecisions = input.brief.humanDecisions.filter(
    (decision) => !decision.resolvedAt || !decision.resolution,
  );

  const notes = new Set(input.coverageNotes);

  for (const assignment of input.plan.assignments) {
    if (assignment.status !== "completed") {
      notes.add(
        `Required assignment ${assignment.category} is ${assignment.status}.`,
      );
    }
  }

  if (input.brief.contextBounded) {
    notes.add("Review context is incomplete or bounded.");
  }

  for (const record of input.verificationRecords) {
    if (record.outcome !== "pass" && record.outcome !== "fail") {
      notes.add(
        `Verification ${record.commandId}: ${record.outcome}.`,
      );
    }
  }

  const coverageGaps = [...notes].map((description) => ({
    gapId: randomUUID(),
    description,
    affectedCategories: [],
    isMandatory: true,
  }));

  const conclusions: ReviewConclusion[] = [];

  if (blocking.length > 0) {
    conclusions.push("changes_required");
  }

  if (
    pendingDecisions.length > 0 ||
    unresolved.some((finding) =>
      finding.severity === "high" || finding.severity === "critical"
    ) ||
    input.assessment.level === "high"
  ) {
    conclusions.push("human_decision_required");
  }

  if (coverageGaps.length > 0) {
    conclusions.push("incomplete");
  }

  if (conclusions.length === 0) {
    conclusions.push("no_blocking_findings_within_reviewed_scope");
  }

  const timestamp = new Date().toISOString();

  return ReviewReport.parse({
    schemaVersion: "1.0.0",
    reportId: randomUUID(),
    runId: input.runId,
    snapshotId: input.snapshot.snapshotId,
    briefId: input.brief.briefId,
    createdAt: timestamp,
    provenance: {
      source: "review/conclusions/builder",
      runId: input.runId,
      createdAt: timestamp,
    },
    fixtureMode: input.fixtureMode,
    changeSummary: input.brief.intendedOutcome,
    riskLevel: input.assessment.level,
    riskFactorSummary: input.assessment.impactAssessment,
    conclusions,
    confirmedFindings: blocking.map((finding) => finding.findingId),
    suggestions: suggestions.map((finding) => finding.findingId),
    unresolvedConcerns: unresolved.map((finding) => finding.findingId),
    verificationRecords: input.verificationRecords,
    coverageGaps,
    humanDecisionIds: pendingDecisions.map((decision) => decision.decisionId),
    modelTraceability: input.modelTraceability,
    executiveSummary:
      `Risk: ${input.assessment.level.toUpperCase()}. ` +
      `${blocking.length} confirmed blocking finding(s), ` +
      `${unresolved.length} unresolved concern(s). ` +
      `${coverageGaps.length} coverage limitation(s). ` +
      `Conclusions: ${conclusions.join(", ")}.` +
      (input.fixtureMode ? " [FIXTURE MODE]" : ""),
  });
}
