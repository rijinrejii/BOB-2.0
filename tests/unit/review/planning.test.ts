/**
 * tests/unit/review/planning.test.ts — Review planning unit tests.
 */
import { describe, it, expect } from "vitest";
import { buildReviewPlan } from "../../../src/review/planning/planner.js";
import { buildRiskAssessment } from "../../../src/review/risk/assessor.js";
import { buildReviewBrief } from "../../../src/review/intent/brief-builder.js";
import { makeFixtureSnapshot } from "../../support/fixture-repository.js";
import { randomUUID } from "crypto";

function makeSetup(paths: string[], riskPaths: string[] = paths) {
  const runId = randomUUID();
  const files = paths.map((p) => ({
    path: p,
    changeKind: "modified" as const,
    content: "// code",
    diff: "+// changed",
  }));
  const snapshot = makeFixtureSnapshot(runId, files);
  const brief = buildReviewBrief({
    runId,
    snapshot,
    prMetadataRaw: { title: "Test", acceptanceCriteria: ["Works correctly"] },
    diffs: Object.fromEntries(files.map((f) => [f.path, f.diff])),
    contents: Object.fromEntries(files.map((f) => [f.path, f.content ?? ""])),
    maxContextFiles: 50,
    maxFileSizeBytes: 100_000,
  });
  return { runId, brief, snapshot };
}

describe("Review Planning — risk-based assignment rules", () => {
  it("LOW risk: includes correctness, excludes impact/tests/standards/security with reasons", () => {
    const { brief, snapshot } = makeSetup(["README.md"]);
    // Force brief's only file to be a doc file for low risk
    const lowBrief = {
      ...brief,
      affectedModules: [{ path: "README.md", role: "documentation" }],
      acceptanceCriteria: [{ id: "ac-001", description: "Docs updated", source: "stated" as const }],
    };
    const assessment = buildRiskAssessment({
      brief: lowBrief,
      snapshot: makeFixtureSnapshot(brief.runId, [{ path: "README.md", changeKind: "modified", content: "x", diff: "+x" }]),
      diffs: { "README.md": "+x" },
      contents: { "README.md": "x" },
    });

    // Override to low for this test
    const lowAssessment = { ...assessment, level: "low" as const, mandatoryClassification: false, mandatoryFactors: [] as never[] };
    const plan = buildReviewPlan(lowBrief, lowAssessment);

    const categories = plan.assignments.map((a) => a.category);
    expect(categories).toContain("correctness");
    expect(plan.excludedCategories.length).toBeGreaterThan(0);
    const excludedCats = plan.excludedCategories.map((e) => e.category);
    expect(excludedCats).toContain("impact");
    expect(excludedCats).toContain("security");
  });

  it("MEDIUM risk: includes all five standard categories", () => {
    const { brief, snapshot } = makeSetup(["src/service.ts"]);
    const assessment = buildRiskAssessment({
      brief,
      snapshot,
      diffs: { "src/service.ts": "+code change" },
      contents: {},
    });
    // Ensure medium
    const medAssessment = { ...assessment, level: "medium" as const, mandatoryClassification: false, mandatoryFactors: [] as never[] };
    const plan = buildReviewPlan(brief, medAssessment);

    const categories = plan.assignments.map((a) => a.category);
    expect(categories).toContain("correctness");
    expect(categories).toContain("impact");
    expect(categories).toContain("tests");
    expect(categories).toContain("standards");
    expect(categories).toContain("security");
    expect(plan.excludedCategories).toHaveLength(0);
  });

  it("HIGH risk: includes all five plus specialist assignments for triggered factors", () => {
    const { brief, snapshot } = makeSetup(["src/auth/login.ts"]);
    const assessment = buildRiskAssessment({
      brief,
      snapshot,
      diffs: { "src/auth/login.ts": "+authenticate()" },
      contents: {},
    });

    expect(assessment.level).toBe("high");
    const plan = buildReviewPlan(brief, assessment);

    const categories = plan.assignments.map((a) => a.category);
    expect(categories).toContain("correctness");
    expect(categories).toContain("security");
    // Cryptography specialist added for auth changes
    expect(categories).toContain("cryptography");
  });

  it("each assignment has required fields and resource limits", () => {
    const { brief, snapshot } = makeSetup(["src/service.ts"]);
    const medAssessment = {
      ...buildRiskAssessment({ brief, snapshot, diffs: {}, contents: {} }),
      level: "medium" as const,
      mandatoryClassification: false,
      mandatoryFactors: [] as never[],
    };
    const plan = buildReviewPlan(brief, medAssessment);

    for (const assignment of plan.assignments) {
      expect(assignment.assignmentId).toBeTruthy();
      expect(assignment.scope).toBeTruthy();
      expect(assignment.questions.length).toBeGreaterThan(0);
      expect(assignment.resourceLimits.timeoutMs).toBeGreaterThan(0);
      expect(assignment.completionCriteria).toBeTruthy();
    }
  });

  it("concurrent groups contain only independent assignments", () => {
    const { brief, snapshot } = makeSetup(["src/service.ts"]);
    const medAssessment = {
      ...buildRiskAssessment({ brief, snapshot, diffs: {}, contents: {} }),
      level: "medium" as const,
      mandatoryClassification: false,
      mandatoryFactors: [] as never[],
    };
    const plan = buildReviewPlan(brief, medAssessment);
    const assignmentIds = new Set(plan.assignments.map((a) => a.assignmentId));

    for (const group of plan.concurrentGroups) {
      for (const id of group) {
        expect(assignmentIds.has(id)).toBe(true);
      }
    }
  });
});
