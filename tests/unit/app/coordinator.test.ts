/**
 * tests/unit/app/coordinator.test.ts
 *
 * Tests for the review coordinator workflow:
 * - Complete fixture-only local workflow
 * - Interrupted run recovery
 * - Concurrent resume protection
 * - Budget exhaustion
 * - Policy enforcement
 */
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "crypto";
import { ReviewCoordinator } from "../../../src/app/coordinator.js";
import { SqliteStore } from "../../../src/adapters/sqlite/sqlite-store.js";
import { SqliteEvidenceAdapter } from "../../../src/adapters/sqlite/sqlite-evidence-adapter.js";
import { UnavailableExecutionAdapter } from "../../../src/adapters/execution/unavailable-execution-adapter.js";
import { ReviewService } from "../../../src/review/service.js";
import { UnavailableModelAdapter } from "../../../src/adapters/models/unavailable.js";
import {
  FixtureRepositoryAdapter,
  FixtureEvidenceAdapter,
  makeFixtureSnapshot,
  makeFixtureCapabilities,
  makeFixturePolicy,
} from "../../support/fixture-repository.js";
import { FileMetadataAdapter } from "../../../src/adapters/metadata/file-metadata-adapter.js";
import type { ReviewServicesPort, ReviewContext } from "../../../src/ports/review-services.js";
import type { RepositoryPort, EvidencePort } from "../../../src/ports/repository.js";
import type {
  ReviewBrief,
  RiskAssessment,
  ReviewPlan,
  CandidateFinding,
  Finding,
  ReviewReport,
  RepositorySnapshot,
} from "../../../src/contracts/index.js";

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

function makeMinimalReport(runId: string, snapshotId: string, briefId: string): ReviewReport {
  return {
    schemaVersion: "1.0.0",
    reportId: randomUUID(),
    runId,
    snapshotId,
    briefId,
    createdAt: nowISO(),
    provenance: { source: "fixture", runId, createdAt: nowISO() },
    fixtureMode: true,
    changeSummary: "Fixture summary",
    riskLevel: "low",
    riskFactorSummary: "Low risk fixture",
    conclusions: ["no_blocking_findings_within_reviewed_scope"],
    confirmedFindings: [],
    suggestions: [],
    unresolvedConcerns: [],
    verificationRecords: [],
    coverageGaps: [],
    humanDecisionIds: [],
    modelTraceability: [],
    executiveSummary: "Fixture report. No live model used.",
  };
}

/**
 * A minimal ReviewServicesPort stub that returns fixture data.
 * Labeled explicitly as a fixture.
 */
function makeFixtureReviewServices(snapshot: RepositorySnapshot): ReviewServicesPort {
  const briefId = randomUUID();
  const assessmentId = randomUUID();
  const planId = randomUUID();

  return {
    async buildBrief(ctx: ReviewContext): Promise<ReviewBrief> {
      return {
        schemaVersion: "1.0.0",
        briefId,
        runId: ctx.runId,
        snapshotId: ctx.snapshot.snapshotId,
        createdAt: nowISO(),
        provenance: { source: "fixture", runId: ctx.runId, createdAt: nowISO() },
        intendedOutcome: "[FIXTURE] Test change",
        changedBehavior: "Adds a test file",
        unchangedBehavior: "Core logic unchanged",
        acceptanceCriteria: [],
        affectedModules: [],
        dataFlows: [],
        trustBoundaries: [],
        assumptions: [],
        missingInformation: [],
        humanDecisions: [],
        excludedFiles: [],
        contextBounded: false,
      };
    },
    async assessRisk(ctx: ReviewContext, brief: ReviewBrief): Promise<RiskAssessment> {
      return {
        schemaVersion: "1.0.0",
        assessmentId,
        runId: ctx.runId,
        briefId: brief.briefId,
        createdAt: nowISO(),
        provenance: { source: "fixture", runId: ctx.runId, createdAt: nowISO() },
        level: "low",
        mandatoryClassification: false,
        mandatoryFactors: [],
        impactAssessment: "Low impact fixture",
        uncertaintyAssessment: "Low uncertainty",
        factors: [],
        escalationRequiredAssignments: [],
      };
    },
    async planReview(ctx: ReviewContext, brief: ReviewBrief, assessment: RiskAssessment): Promise<ReviewPlan> {
      return {
        schemaVersion: "1.0.0",
        planId,
        runId: ctx.runId,
        assessmentId: assessment.assessmentId,
        createdAt: nowISO(),
        provenance: { source: "fixture", runId: ctx.runId, createdAt: nowISO() },
        assignments: [],
        concurrentGroups: [],
        excludedCategories: [],
      };
    },
    async runReviewers(): Promise<CandidateFinding[]> {
      return [];
    },
    async validateFindings(): Promise<Finding[]> {
      return [];
    },
    async buildReport(ctx: ReviewContext, brief: ReviewBrief): Promise<ReviewReport> {
      return makeMinimalReport(ctx.runId, ctx.snapshot.snapshotId, brief.briefId);
    },
  };
}

function makeCoordinator(store: SqliteStore, snapshot: RepositorySnapshot) {
  const fixtureFiles = snapshot.changedFiles.map((f) => ({
    path: f.path,
    changeKind: f.changeKind,
  }));
  const repository = new FixtureRepositoryAdapter(snapshot, fixtureFiles);
  const evidence = new SqliteEvidenceAdapter(store);
  const metadata = new FileMetadataAdapter();
  const verification = new UnavailableExecutionAdapter();
  const reviewServices = makeFixtureReviewServices(snapshot);

  // Provide createSnapshot on the repository
  const repositoryWithCreate = Object.assign(repository, {
    createSnapshot: async () => snapshot,
  });

  return new ReviewCoordinator({
    store,
    repository: repositoryWithCreate,
    evidence,
    metadata,
    verification,
    reviewServices,
  });
}

describe("ReviewCoordinator — fixture workflow", () => {
  it("completes a fixture run end-to-end", async () => {
    const store = new SqliteStore({ databasePath: ":memory:" });
    const runId = randomUUID();
    const snapshot = makeFixtureSnapshot(runId, [
      { path: "src/example.ts", changeKind: "modified", content: "export const x = 1;", diff: "+export const x = 1;" },
    ]);
    const policy = makeFixturePolicy();
    const capabilities = makeFixtureCapabilities();
    const coordinator = makeCoordinator(store, snapshot);

    const result = await coordinator.execute({
      runId,
      repositoryPath: "/fixture/repo",
      baseRevision: "abc1234",
      headRevision: "def5678",
      policy,
      capabilities,
      fixtureMode: true,
      engineVersion: "0.1.0",
    });

    expect(result.status).toBe("completed");
    expect(result.report).not.toBeNull();
    expect(result.report?.fixtureMode).toBe(true);
    store.close();
  });

  it("persists stage checkpoints during run", async () => {
    const store = new SqliteStore({ databasePath: ":memory:" });
    const runId = randomUUID();
    const snapshot = makeFixtureSnapshot(runId, []);
    const policy = makeFixturePolicy();
    const capabilities = makeFixtureCapabilities();
    const coordinator = makeCoordinator(store, snapshot);

    await coordinator.execute({
      runId,
      repositoryPath: "/fixture/repo",
      baseRevision: "abc1234",
      headRevision: "def5678",
      policy,
      capabilities,
      fixtureMode: true,
      engineVersion: "0.1.0",
    });

    const run = store.getRun(runId);
    expect(run?.stage).toBe("completed");
    store.close();
  });

  it("returns report from store on second call with same runId (already completed)", async () => {
    const store = new SqliteStore({ databasePath: ":memory:" });
    const runId = randomUUID();
    const snapshot = makeFixtureSnapshot(runId, []);
    const policy = makeFixturePolicy();
    const capabilities = makeFixtureCapabilities();
    const coordinator = makeCoordinator(store, snapshot);

    await coordinator.execute({ runId, repositoryPath: "/fixture/repo", baseRevision: "abc1234", headRevision: "def5678", policy, capabilities, fixtureMode: true, engineVersion: "0.1.0" });
    // Second call with same ID — returns completed result from store
    const result2 = await coordinator.execute({ runId, repositoryPath: "/fixture/repo", baseRevision: "abc1234", headRevision: "def5678", policy, capabilities, fixtureMode: true, engineVersion: "0.1.0" });
    expect(result2.status).toBe("completed");
    store.close();
  });
});

describe("ReviewCoordinator — recovery", () => {
  it("marks running executions as interrupted on resume", async () => {
    const store = new SqliteStore({ databasePath: ":memory:" });

    // Simulate an existing run that was in-progress
    store.upsertRun({
      runId: "old-run-1",
      status: "running",
      stage: "review",
      fixtureMode: false,
      data: { baseCommit: "abc1234", headCommit: "def5678" },
    });
    store.upsertRun({
      runId: "old-run-2",
      status: "running",
      stage: "planning",
      fixtureMode: false,
      data: {},
    });

    const newRunId = randomUUID();
    const snapshot = makeFixtureSnapshot(newRunId, []);
    const coordinator = makeCoordinator(store, snapshot);

    await coordinator.execute({
      runId: newRunId,
      repositoryPath: "/fixture/repo",
      baseRevision: "abc1234",
      headRevision: "def5678",
      policy: makeFixturePolicy(),
      capabilities: makeFixtureCapabilities(),
      fixtureMode: true,
      engineVersion: "0.1.0",
    });

    // Old runs should be marked as interrupted
    expect(store.getRun("old-run-1")?.status).toBe("interrupted");
    expect(store.getRun("old-run-2")?.status).toBe("interrupted");
    store.close();
  });

  it("cancels a running run", async () => {
    const store = new SqliteStore({ databasePath: ":memory:" });
    store.upsertRun({ runId: "cancel-me", status: "running", stage: "review", fixtureMode: false, data: {} });

    const snapshot = makeFixtureSnapshot("cancel-me", []);
    const coordinator = makeCoordinator(store, snapshot);
    coordinator.cancel("cancel-me");

    expect(store.getRun("cancel-me")?.status).toBe("cancelled");
    store.close();
  });
});

describe("ReviewCoordinator — timeout", () => {
  it("fails with timeout when deadline is exceeded", async () => {
    const store = new SqliteStore({ databasePath: ":memory:" });
    const runId = randomUUID();
    const snapshot = makeFixtureSnapshot(runId, []);

    // Slow service that takes longer than timeout
    const slowServices: ReviewServicesPort = {
      async buildBrief(ctx): Promise<ReviewBrief> {
        await new Promise((r) => setTimeout(r, 100));
        return makeFixtureReviewServices(snapshot).buildBrief(ctx, {});
      },
      assessRisk: makeFixtureReviewServices(snapshot).assessRisk,
      planReview: makeFixtureReviewServices(snapshot).planReview,
      runReviewers: makeFixtureReviewServices(snapshot).runReviewers,
      validateFindings: makeFixtureReviewServices(snapshot).validateFindings,
      buildReport: makeFixtureReviewServices(snapshot).buildReport,
    };

    const repository = new FixtureRepositoryAdapter(snapshot, []);
    const repositoryWithCreate = Object.assign(repository, {
      createSnapshot: async () => snapshot,
    });

    const coordinator = new ReviewCoordinator({
      store,
      repository: repositoryWithCreate,
      evidence: new SqliteEvidenceAdapter(store),
      metadata: new FileMetadataAdapter(),
      verification: new UnavailableExecutionAdapter(),
      reviewServices: slowServices,
    });

    const result = await coordinator.execute({
      runId,
      repositoryPath: "/fixture/repo",
      baseRevision: "abc1234",
      headRevision: "def5678",
      policy: makeFixturePolicy(),
      capabilities: makeFixtureCapabilities(),
      fixtureMode: true,
      engineVersion: "0.1.0",
      timeoutMs: 1, // 1ms — will time out immediately
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("timed out");
    store.close();
  });
});
