import {
  ReviewReport,
  Finding,
} from "../contracts/index.js";
import { redactSecrets } from "../platform/redaction.js";

function safeText(value: string): string {
  return redactSecrets(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_[\]{}])/g, "\\$1");
}

export function renderReportJson(report: ReviewReport): string {
  return JSON.stringify(ReviewReport.parse(report), null, 2);
}

export function renderReportMarkdown(
  rawReport: ReviewReport,
  rawFindings: Finding[] = [],
): string {
  const report = ReviewReport.parse(rawReport);
  const findings = Finding.array().parse(rawFindings);
  const byId = new Map(findings.map((finding) => [finding.findingId, finding]));

  const lines: string[] = [
    "# Review Report",
    "",
    ...(report.fixtureMode
      ? ["> **FIXTURE MODE** - not a production review.", ""]
      : []),
    safeText(report.executiveSummary),
    "",
    "## Change",
    "",
    safeText(report.changeSummary),
    "",
    `Risk: **${report.riskLevel.toUpperCase()}**`,
    "",
    safeText(report.riskFactorSummary),
    "",
    "## Conclusions",
    "",
    ...report.conclusions.map((conclusion) => `- ${conclusion}`),
    "",
  ];

  const sections: Array<[string, string[]]> = [
    ["Confirmed blocking findings", report.confirmedFindings],
    ["Non-blocking suggestions", report.suggestions],
    ["Unresolved concerns", report.unresolvedConcerns],
  ];

  for (const [title, ids] of sections) {
    lines.push(`## ${title}`, "");

    if (ids.length === 0) {
      lines.push("None recorded.", "");
      continue;
    }

    for (const id of ids) {
      const finding = byId.get(id);

      if (!finding) {
        lines.push("Finding details were not supplied to the renderer.", "");
        continue;
      }

      lines.push(
        `### ${safeText(finding.claim)}`,
        "",
        `Path: ${safeText(finding.affectedPath)}`,
        "",
        `Status: **${finding.validationStatus}**; severity: ${finding.severity}.`,
        "",
        `Observed: ${safeText(finding.observedBehavior)}`,
        "",
        `Expected: ${safeText(finding.expectedBehavior)}`,
        "",
        `Validation: ${safeText(finding.validationRationale)}`,
        "",
        `Next action: ${safeText(finding.recommendedNextStep)}`,
        "",
        `Evidence references: ${finding.evidenceIds.length}.`,
        "",
      );
    }
  }

  lines.push("## Coverage limitations", "");

  if (report.coverageGaps.length === 0) {
    lines.push("No limitations recorded.", "");
  } else {
    lines.push(
      ...report.coverageGaps.map((gap) =>
        `- ${safeText(gap.description)}`
      ),
      "",
    );
  }

  lines.push("## Verification", "");

  if (report.verificationRecords.length === 0) {
    lines.push("No execution results recorded.", "");
  } else {
    for (const check of report.verificationRecords) {
      lines.push(
        `- ${safeText(check.commandId)}: **${safeText(check.outcome)}**`,
      );
    }
    lines.push("");
  }

  lines.push(
    "---",
    "",
    "> This report does not constitute proof of correctness, security " +
      "assurance, or approval to merge.",
    "",
  );

  return lines.join("\n");
}
