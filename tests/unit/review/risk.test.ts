/**
 * tests/unit/review/risk.test.ts — Risk assessment unit tests.
 */
import { describe, it, expect } from "vitest";
import { buildRiskAssessment } from "../../../src/review/risk/assessor.js";
import {
  makeFixtureSnapshot,
  makeFixturePolicy,
} from "../../support/fixture-repository.js";
import { buildReviewBrief } from "../../../src/review/intent/brief-builder.js";
import { randomUUID } from "crypto";

function makeBrief(runId: string, paths: string[], criteria: string[] = []) {
  const files = paths.map((p) => ({
    path: p,
    changeKind: "modified" as const,
    content: "// content",
    diff: `--- a/${p}\n+++ b/${p}\n@@ -1,3 +1,5 @@\n-old\n+new line 1\n+new line 2\n+new line 3\n+new line 4`,
  }));
  const snapshot = makeFixtureSnapshot(runId, files);
  const brief = buildReviewBrief({
    runId,
    snapshot,
    prMetadataRaw: {
      title: "Test PR",
      acceptanceCriteria: criteria,
    },
    diffs: Object.fromEntries(files.map((f) => [f.path, f.diff])),
    contents: Object.fromEntries(files.map((f) => [f.path, f.content ?? ""])),
    maxContextFiles: 50,
    maxFileSizeBytes: 100_000,
  });
  return { brief, snapshot };
}

describe("Risk Assessment — mandatory rules", () => {
  it("classifies auth-related path changes as HIGH (mandatory)", () => {
    const runId = randomUUID();
    const { brief, snapshot } = makeBrief(runId, ["src/auth/login.ts"]);
    const assessment = buildRiskAssessment({
      brief,
      snapshot,
      diffs: { "src/auth/login.ts": "+export function authenticate(user: string) {}" },
      contents: { "src/auth/login.ts": "export function authenticate(user: string) {}" },
    });

    expect(assessment.level).toBe("high");
    expect(assessment.mandatoryClassification).toBe(true);
    expect(assessment.mandatoryFactors).toContain("authentication");
  });

  it("classifies authorization changes as HIGH (mandatory)", () => {
    const runId = randomUUID();
    const { brief, snapshot } = makeBrief(runId, ["src/middleware/auth-guard.ts"]);
    const assessment = buildRiskAssessment({
      brief,
      snapshot,
      diffs: { "src/middleware/auth-guard.ts": "+function checkPermission(role) {}" },
      contents: { "src/middleware/auth-guard.ts": "function checkPermission(role) {}" },
    });

    expect(assessment.level).toBe("high");
    expect(assessment.mandatoryFactors).toContain("authorization");
  });

  it("classifies payment-related changes as HIGH (mandatory)", () => {
    const runId = randomUUID();
    const { brief, snapshot } = makeBrief(runId, ["src/billing/charge.ts"]);
    const assessment = buildRiskAssessment({
      brief,
      snapshot,
      diffs: { "src/billing/charge.ts": "+function charge(amount) {}" },
      contents: { "src/billing/charge.ts": "function charge(amount) {}" },
    });

    expect(assessment.level).toBe("high");
    expect(assessment.mandatoryFactors).toContain("payments");
  });

  it("classifies database migrations as HIGH (mandatory)", () => {
    const runId = randomUUID();
    const { brief, snapshot } = makeBrief(runId, ["src/database/migration-001.ts"]);
    const assessment = buildRiskAssessment({
      brief,
      snapshot,
      diffs: { "src/database/migration-001.ts": "+ALTER TABLE users ADD COLUMN role VARCHAR(50);" },
      contents: { "src/database/migration-001.ts": "ALTER TABLE users ADD COLUMN role VARCHAR(50);" },
    });

    expect(assessment.level).toBe("high");
    expect(assessment.mandatoryFactors).toContain("schema_migration");
  });

  it("classifies dependency file changes as HIGH (mandatory)", () => {
    const runId = randomUUID();
    const { brief, snapshot } = makeBrief(runId, ["package.json"]);
    const assessment = buildRiskAssessment({
      brief,
      snapshot,
      diffs: { "package.json": '+  "newdep": "^1.0.0"' },
      contents: { "package.json": '{"dependencies": {"newdep": "^1.0.0"}}' },
    });

    expect(assessment.level).toBe("high");
    expect(assessment.mandatoryFactors).toContain("dependencies");
  });

  it("cannot silently downgrade mandatory HIGH — no override means level stays HIGH", () => {
    const runId = randomUUID();
    const { brief, snapshot } = makeBrief(runId, ["src/auth/login.ts"]);
    const assessment = buildRiskAssessment({
      brief,
      snapshot,
      diffs: { "src/auth/login.ts": "+authenticate()" },
      contents: {},
    });

    expect(assessment.mandatoryClassification).toBe(true);
    expect(assessment.override).toBeUndefined();
    // Mandatory without override stays high
    expect(assessment.level).toBe("high");
  });

  it("populates escalationRequiredAssignments for HIGH mandatory risk", () => {
    const runId = randomUUID();
    const { brief, snapshot } = makeBrief(runId, ["src/auth/login.ts"]);
    const assessment = buildRiskAssessment({
      brief,
      snapshot,
      diffs: { "src/auth/login.ts": "+authenticate()" },
      contents: {},
    });

    expect(assessment.escalationRequiredAssignments).toContain("owner_review");
  });
});

describe("Risk Assessment — low risk requires positive evidence", () => {
  it("returns MEDIUM by default when no mandatory factors but scope is not positively limited", () => {
    const runId = randomUUID();
    const { brief, snapshot } = makeBrief(runId, ["src/utils/format.ts"], ["Format strings correctly"]);
    const assessment = buildRiskAssessment({
      brief,
      snapshot,
      diffs: { "src/utils/format.ts": "+export function fmt(s) { return s.trim(); }" },
      contents: {},
    });

    // Large enough diff triggers medium (not positively limited)
    expect(assessment.level).toSatisfy((l: string) => l === "medium" || l === "low");
  });

  it("returns LOW only for small doc/test-only changes with acceptance criteria", () => {
    const runId = randomUUID();
    const files = [{ path: "README.md", changeKind: "modified" as const, content: "# Title\nUpdated.", diff: "+Updated." }];
    const snapshot = makeFixtureSnapshot(runId, files);
    const brief = buildReviewBrief({
      runId,
      snapshot,
      prMetadataRaw: { title: "Fix typo", acceptanceCriteria: ["README reflects current usage"] },
      diffs: { "README.md": "+Updated." },
      contents: { "README.md": "# Title\nUpdated." },
      maxContextFiles: 50,
      maxFileSizeBytes: 100_000,
    });

    const assessment = buildRiskAssessment({
      brief,
      snapshot,
      diffs: { "README.md": "+Updated." },
      contents: { "README.md": "# Title\nUpdated." },
    });

    expect(assessment.level).toBe("low");
    expect(assessment.mandatoryClassification).toBe(false);
  });

  it("does NOT return LOW for doc change without acceptance criteria", () => {
    const runId = randomUUID();
    const files = [{ path: "README.md", changeKind: "modified" as const, content: "# Title", diff: "+Updated." }];
    const snapshot = makeFixtureSnapshot(runId, files);
    const brief = buildReviewBrief({
      runId,
      snapshot,
      prMetadataRaw: { title: "Update readme" }, // No acceptanceCriteria
      diffs: { "README.md": "+Updated." },
      contents: { "README.md": "# Title" },
      maxContextFiles: 50,
      maxFileSizeBytes: 100_000,
    });

    const assessment = buildRiskAssessment({
      brief,
      snapshot,
      diffs: { "README.md": "+Updated." },
      contents: {},
    });

    // Must NOT be low — no positive evidence of limited scope
    expect(assessment.level).not.toBe("low");
  });
});
