/**
 * tests/unit/app/report-renderer.test.ts
 *
 * Tests for report rendering.
 * Required: fixture mode is labeled, no approval signal is printed.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { renderReportJson, renderReportMarkdown } from "../../../src/app/report-renderer.js";
import type { ReviewReport } from "../../../src/contracts/index.js";

function nowISO() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

function makeReport(fixtureMode: boolean): ReviewReport {
  return {
    schemaVersion: "1.0.0",
    reportId: randomUUID(),
    runId: randomUUID(),
    snapshotId: randomUUID(),
    briefId: randomUUID(),
    createdAt: nowISO(),
    provenance: { source: "test", createdAt: nowISO() },
    fixtureMode,
    changeSummary: "Test change",
    riskLevel: "low",
    riskFactorSummary: "Low risk",
    conclusions: ["no_blocking_findings_within_reviewed_scope"],
    confirmedFindings: [],
    suggestions: [],
    unresolvedConcerns: [],
    verificationRecords: [],
    coverageGaps: [],
    humanDecisionIds: [],
    modelTraceability: [],
    executiveSummary: "No blocking findings within reviewed scope.",
  };
}

describe("renderReportJson", () => {
  it("serializes the report as valid JSON", () => {
    const report = makeReport(false);
    const json = renderReportJson(report);
    const parsed = JSON.parse(json) as ReviewReport;
    expect(parsed.reportId).toBe(report.reportId);
  });

  it("includes the fixtureMode field", () => {
    const json = renderReportJson(makeReport(true));
    expect(JSON.parse(json)).toMatchObject({ fixtureMode: true });
  });
});

describe("renderReportMarkdown", () => {
  it("labels fixture mode prominently", () => {
    const md = renderReportMarkdown(makeReport(true));
    expect(md).toContain("FIXTURE MODE");
  });

  it("does not label fixture mode when false", () => {
    const md = renderReportMarkdown(makeReport(false));
    expect(md).not.toContain("FIXTURE MODE");
  });

  it("never contains an approval signal", () => {
    const md = renderReportMarkdown(makeReport(false));
    expect(md).not.toMatch(/\bapproved\b/i);
    expect(md).not.toMatch(/\bapprove to merge\b/i);
    expect(md).not.toMatch(/\bsafe to merge\b/i);
  });

  it("includes the non-approval disclaimer", () => {
    const md = renderReportMarkdown(makeReport(false));
    expect(md).toContain("does not constitute proof of correctness");
  });

  it("includes risk level and conclusions", () => {
    const md = renderReportMarkdown(makeReport(false));
    expect(md).toContain("LOW");
    expect(md).toContain("no_blocking_findings_within_reviewed_scope");
  });
});
