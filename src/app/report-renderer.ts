/**
 * app/report-renderer.ts
 *
 * Renders a ReviewReport to JSON and Markdown.
 *
 * Serializes from the validated ReviewReport struct only.
 * Does NOT independently recompute findings.
 *
 * Output rules:
 * - Never prints an approval signal or claims proof of correctness.
 * - Fixture mode is prominently labeled.
 * - Coverage limitations are listed.
 * - Check states and outcomes are reported as-is.
 */
import type { ReviewReport } from "../contracts/index.js";

/**
 * Render a ReviewReport to a JSON string.
 * The report is serialized exactly — no recomputation.
 */
export function renderReportJson(report: ReviewReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Render a ReviewReport to a Markdown string.
 * Human-readable format for CLI output and local documentation.
 */
export function renderReportMarkdown(report: ReviewReport): string {
  const lines: string[] = [];

  // Header
  lines.push("# Review Report");
  lines.push("");

  if (report.fixtureMode) {
    lines.push(
      "> ⚠️ **FIXTURE MODE** — This report was generated without a live model. " +
        "Findings are from static pattern analysis only. This is NOT a production review.",
    );
    lines.push("");
  }

  lines.push(`**Report ID:** \`${report.reportId}\``);
  lines.push(`**Run ID:** \`${report.runId}\``);
  lines.push(`**Generated:** ${report.createdAt}`);
  lines.push(`**Schema Version:** ${report.schemaVersion}`);
  lines.push("");

  // Summary
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(report.executiveSummary);
  lines.push("");

  // Risk
  lines.push("## Risk Assessment");
  lines.push("");
  lines.push(`**Risk Level:** ${report.riskLevel.toUpperCase()}`);
  lines.push(`**Summary:** ${report.riskFactorSummary}`);
  lines.push("");

  // Conclusions
  lines.push("## Conclusions");
  lines.push("");
  for (const conclusion of report.conclusions) {
    lines.push(`- \`${conclusion}\``);
  }
  lines.push("");

  // Findings summary
  lines.push("## Findings");
  lines.push("");
  lines.push(`- **Confirmed (blocking):** ${report.confirmedFindings.length}`);
  lines.push(`- **Suggestions (non-blocking):** ${report.suggestions.length}`);
  lines.push(`- **Unresolved concerns:** ${report.unresolvedConcerns.length}`);
  lines.push(`- **Pending human decisions:** ${report.humanDecisionIds.length}`);
  lines.push("");

  // Coverage gaps
  if (report.coverageGaps.length > 0) {
    lines.push("## Coverage Gaps");
    lines.push("");
    for (const gap of report.coverageGaps) {
      const mandatory = gap.isMandatory ? " **(mandatory)**" : "";
      lines.push(`- **${gap.gapId}**${mandatory}: ${gap.description}`);
    }
    lines.push("");
  }

  // Verification
  if (report.verificationRecords.length > 0) {
    lines.push("## Verification Checks");
    lines.push("");
    for (const check of report.verificationRecords) {
      lines.push(`- \`${check.commandId}\`: **${check.outcome}**${check.failureKind ? ` (${check.failureKind})` : ""}${check.attributionNote ? ` — ${check.attributionNote}` : ""}`);
    }
    lines.push("");
  }

  // Model traceability
  if (report.modelTraceability.length > 0) {
    lines.push("## Model Traceability");
    lines.push("");
    for (const trace of report.modelTraceability) {
      const mode = trace.fixtureMode ? " [fixture]" : " [live]";
      lines.push(`- \`${trace.provider}/${trace.modelId}\`${mode} — prompt: \`${trace.promptVersion}\``);
    }
    lines.push("");
  }

  // Footer: explicit non-approval statement
  lines.push("---");
  lines.push("");
  lines.push(
    "> **Note:** This report describes what was reviewed within the defined scope. " +
      "It does not constitute proof of correctness, security assurance, or approval to merge. " +
      "Human judgment is required before acting on these findings.",
  );
  lines.push("");

  return lines.join("\n");
}
