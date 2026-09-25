/**
 * tests/contracts/schemas.test.ts — Validates all Zod contract schemas.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import {
  ReviewBrief,
  RiskAssessment,
  ReviewPlan,
  CandidateFinding,
  Finding,
  ReviewReport,
  RepositorySnapshot,
  CapabilityReport,
  TrustedPolicy,
  ReviewerAssignment,
  EvidenceRecord,
  CheckExecution,
  PatchProposal,
  HumanDecision,
  ReviewRun,
  PublicationRecord,
} from "../../src/contracts/index.js";

function nowISO() { return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z"); }
function sha256hex() { return "a".repeat(64); }

describe("Contract schemas parse valid data", () => {
  it("ReviewBrief", () => {
    const result = ReviewBrief.safeParse({
      schemaVersion: "1.0.0",
      briefId: randomUUID(),
      runId: randomUUID(),
      snapshotId: randomUUID(),
      createdAt: nowISO(),
      provenance: { source: "test", createdAt: nowISO() },
      intendedOutcome: "Fix the login flow",
      changedBehavior: "Changed auth logic",
      unchangedBehavior: "Unchanged modules remain stable",
      acceptanceCriteria: [],
      affectedModules: [],
      dataFlows: [],
      trustBoundaries: [],
      assumptions: [],
      missingInformation: [],
      humanDecisions: [],
      excludedFiles: [],
      contextBounded: false,
    });
    expect(result.success).toBe(true);
  });

  it("RiskAssessment", () => {
    const result = RiskAssessment.safeParse({
      schemaVersion: "1.0.0",
      assessmentId: randomUUID(),
      runId: randomUUID(),
      briefId: randomUUID(),
      createdAt: nowISO(),
      provenance: { source: "test", createdAt: nowISO() },
      level: "medium",
      mandatoryClassification: false,
      mandatoryFactors: [],
      impactAssessment: "moderate",
      uncertaintyAssessment: "moderate",
      factors: [],
      escalationRequiredAssignments: [],
    });
    expect(result.success).toBe(true);
  });

  it("RepositorySnapshot", () => {
    const result = RepositorySnapshot.safeParse({
      schemaVersion: "1.0.0",
      snapshotId: randomUUID(),
      runId: randomUUID(),
      createdAt: nowISO(),
      provenance: { source: "test", createdAt: nowISO() },
      repositoryPath: "/repo",
      baseCommit: "abc1234",
      headCommit: "def5678",
      changedFiles: [],
      totalChangedFiles: 0,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
      immutable: true,
      snapshotDigest: sha256hex(),
    });
    expect(result.success).toBe(true);
  });

  it("CapabilityReport", () => {
    const result = CapabilityReport.safeParse({
      schemaVersion: "1.0.0",
      reportId: randomUUID(),
      generatedAt: nowISO(),
      provenance: { source: "test", createdAt: nowISO() },
      nodeVersion: "20.0.0",
      platform: "linux",
      gitAvailable: false,
      modelStatus: "unavailable",
      permittedModelIds: [],
      externalTransmissionAllowed: false,
      verificationStatus: "unavailable",
      allowedCheckIds: [],
      documentParsers: [],
      storageAvailable: false,
      limitations: [],
    });
    expect(result.success).toBe(true);
  });

  it("EvidenceRecord", () => {
    const result = EvidenceRecord.safeParse({
      schemaVersion: "1.0.0",
      evidenceId: randomUUID(),
      runId: randomUUID(),
      snapshotId: randomUUID(),
      createdAt: nowISO(),
      provenance: { source: "test", createdAt: nowISO() },
      kind: "diff_hunk",
      path: "src/service.ts",
      commit: "abc1234",
      summary: "Diff for src/service.ts",
    });
    expect(result.success).toBe(true);
  });

  it("CheckExecution", () => {
    const result = CheckExecution.safeParse({
      schemaVersion: "1.0.0",
      checkId: randomUUID(),
      runId: randomUUID(),
      createdAt: nowISO(),
      provenance: { source: "test", createdAt: nowISO() },
      commandId: "test:unit",
      commit: "abc1234",
      outcome: "unavailable",
      failureKind: "unavailable_execution",
    });
    expect(result.success).toBe(true);
  });

  it("HumanDecision", () => {
    const result = HumanDecision.safeParse({
      schemaVersion: "1.0.0",
      decisionId: randomUUID(),
      runId: randomUUID(),
      createdAt: nowISO(),
      provenance: { source: "test", createdAt: nowISO() },
      kind: "ambiguous_requirement",
      title: "Which auth method to use?",
      description: "PR references two incompatible auth methods",
    });
    expect(result.success).toBe(true);
  });

  it("ReviewReport", () => {
    const result = ReviewReport.safeParse({
      schemaVersion: "1.0.0",
      reportId: randomUUID(),
      runId: randomUUID(),
      snapshotId: randomUUID(),
      briefId: randomUUID(),
      createdAt: nowISO(),
      provenance: { source: "test", createdAt: nowISO() },
      fixtureMode: true,
      changeSummary: "Auth refactor",
      riskLevel: "high",
      riskFactorSummary: "Authentication touched",
      conclusions: ["changes_required"],
      confirmedFindings: [],
      suggestions: [],
      unresolvedConcerns: [],
      verificationRecords: [],
      coverageGaps: [],
      humanDecisionIds: [],
      modelTraceability: [],
      executiveSummary: "One blocking finding confirmed.",
    });
    expect(result.success).toBe(true);
  });

  it("PatchProposal", () => {
    const result = PatchProposal.safeParse({
      schemaVersion: "1.0.0",
      proposalId: randomUUID(),
      runId: randomUUID(),
      findingId: randomUUID(),
      createdAt: nowISO(),
      provenance: { source: "test", createdAt: nowISO() },
      sourceCommit: "abc1234",
      patchDigest: sha256hex(),
      affectedPath: "src/service.ts",
      patchDescription: "Add null check",
      unifiedDiff: "--- a\n+++ b\n@@ -1 +1 @@\n+if (!x) return;\n",
      status: "proposed",
    });
    expect(result.success).toBe(true);
  });

  it("TrustedPolicy", () => {
    const result = TrustedPolicy.safeParse({
      schemaVersion: "1.0.0",
      policyId: randomUUID(),
      loadedAt: nowISO(),
      provenance: { source: "test", createdAt: nowISO() },
      contentHash: sha256hex(),
      externalTransmissionAllowed: false,
      permittedModelIds: [],
      allowedCheckIds: [],
      maxContextFiles: 50,
      maxFileSizeBytes: 100_000,
      maxDependencyDepth: 2,
      patchProposalsEnabled: false,
      incrementalReuseEnabled: false,
      additionalMandatoryRiskPatterns: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("Contract schemas reject invalid data", () => {
  it("ReviewBrief rejects missing required fields", () => {
    const result = ReviewBrief.safeParse({ briefId: randomUUID() });
    expect(result.success).toBe(false);
  });

  it("RiskAssessment rejects invalid risk level", () => {
    const result = RiskAssessment.safeParse({
      schemaVersion: "1.0.0",
      assessmentId: randomUUID(),
      level: "ultra-high", // invalid
    });
    expect(result.success).toBe(false);
  });

  it("ReviewReport requires at least one conclusion", () => {
    const result = ReviewReport.safeParse({
      schemaVersion: "1.0.0",
      reportId: randomUUID(),
      runId: randomUUID(),
      snapshotId: randomUUID(),
      briefId: randomUUID(),
      createdAt: nowISO(),
      provenance: { source: "test", createdAt: nowISO() },
      fixtureMode: false,
      changeSummary: "x",
      riskLevel: "low",
      riskFactorSummary: "x",
      conclusions: [], // Empty — should fail
      confirmedFindings: [],
      suggestions: [],
      unresolvedConcerns: [],
      verificationRecords: [],
      coverageGaps: [],
      humanDecisionIds: [],
      modelTraceability: [],
      executiveSummary: "x",
    });
    expect(result.success).toBe(false);
  });
});
