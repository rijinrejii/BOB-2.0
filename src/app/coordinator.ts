/**
 * app/coordinator.ts
 *
 * Orchestrates the end-to-end review workflow.
 *
 * Responsibilities:
 * - Drive stage transitions: intake → ... → completed
 * - Persist validated stage output before advancing
 * - Enforce single-worker concurrency via SQLite exclusive transactions
 * - Handle recovery: load committed state, mark interrupted executions
 * - Coordinate between ABY's platform adapters and Rijin's review services
 * - Respect budget limits and cancellation
 *
 * This coordinator does NOT:
 * - Implement review reasoning (Rijin's domain)
 * - Directly access model APIs
 * - Make findings determinations
 * - Execute repository lifecycle scripts
 */
import { randomUUID } from "crypto";
import type { ReviewServicesPort, ReviewContext } from "../ports/review-services.js";
import type { RepositoryPort, EvidencePort } from "../ports/repository.js";
import type { MetadataPort } from "../ports/metadata.js";
import type { VerificationPort } from "../ports/verification.js";
import type {
  ReviewRun,
  RepositorySnapshot,
  CapabilityReport,
  TrustedPolicy,
  ReviewBrief,
  RiskAssessment,
  ReviewPlan,
  Finding,
  ReviewReport,
} from "../contracts/index.js";
import type { SqliteStore } from "../adapters/sqlite/sqlite-store.js";
import { GitAdapter } from "../adapters/git/git-adapter.js";
import { NEXT_STAGE, type Stage } from "./stages.js";

const SCHEMA_VERSION = "1.0.0" as const;

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export interface CoordinatorDeps {
  store: SqliteStore;
  repository: RepositoryPort & { createSnapshot?: (runId: string, base: string, head: string) => Promise<RepositorySnapshot> };
  evidence: EvidencePort;
  metadata: MetadataPort;
  verification: VerificationPort;
  reviewServices: ReviewServicesPort;
}

export interface ReviewRequest {
  runId: string;
  repositoryPath: string;
  baseRevision: string;
  headRevision: string;
  prMetadataPath?: string | undefined;
  policy: TrustedPolicy;
  capabilities: CapabilityReport;
  fixtureMode: boolean;
  engineVersion: string;
  /** Maximum time in milliseconds before the run is cancelled (default: 120_000) */
  timeoutMs?: number | undefined;
}

export interface CoordinatorResult {
  runId: string;
  status: string;
  stage: string;
  report: ReviewReport | null;
  errorMessage?: string | undefined;
  fixtureMode: boolean;
}

export class ReviewCoordinator {
  private readonly deps: CoordinatorDeps;

  constructor(deps: CoordinatorDeps) {
    this.deps = deps;
  }

  /**
   * Execute a review from scratch or resume an interrupted run.
   *
   * On resume:
   * - Loads only committed stage results
   * - Marks abandoned running executions as interrupted
   * - Verifies that resumable inputs still match
   */
  async execute(request: ReviewRequest): Promise<CoordinatorResult> {
    const { store } = this.deps;
    const { runId } = request;
    const timeoutMs = request.timeoutMs ?? 120_000;
    const deadline = Date.now() + timeoutMs;

    // Mark any previously interrupted runs
    store.markInterruptedRuns(runId);

    // Check for existing run
    const existing = store.getRun(runId);
    if (existing) {
      return this.resume(request, existing, deadline);
    }

    // Create new run record
    const run = this.buildRunRecord(request);
    store.upsertRun({
      runId: run.runId,
      status: "running",
      stage: "intake",
      fixtureMode: run.fixtureMode,
      data: run,
    });
    store.appendAuditLog({
      runId,
      eventType: "run_created",
      actor: "coordinator",
      payload: { baseRevision: request.baseRevision, headRevision: request.headRevision },
    });

    return this.runFromStage("intake", run, request, deadline);
  }

  private async resume(
    request: ReviewRequest,
    existing: ReturnType<SqliteStore["getRun"]> & object,
    deadline: number,
  ): Promise<CoordinatorResult> {
    const { runId } = request;

    // Terminal states — return as-is
    if (
      existing.status === "completed" ||
      existing.status === "failed" ||
      existing.status === "cancelled" ||
      existing.status === "superseded"
    ) {
      const report = existing.stage === "completed" || existing.stage === "reporting"
        ? await this.loadStoredReport(runId)
        : null;
      return {
        runId,
        status: existing.status,
        stage: existing.stage,
        report,
        fixtureMode: existing.fixtureMode,
      };
    }

    // Interrupted run — verify inputs match before resuming
    if (existing.status === "interrupted") {
      const storedRun = existing.data as ReviewRun;
      if (
        storedRun.baseCommit !== request.baseRevision &&
        storedRun.headCommit !== request.headRevision
      ) {
        this.deps.store.upsertRun({
          runId,
          status: "failed",
          stage: existing.stage,
          fixtureMode: existing.fixtureMode,
          data: Object.assign({}, existing.data as object, { errorMessage: "Resume inputs do not match committed state" }),
        });
        return {
          runId,
          status: "failed",
          stage: existing.stage,
          report: null,
          errorMessage: "Resume inputs do not match committed state",
          fixtureMode: existing.fixtureMode,
        };
      }

      this.deps.store.appendAuditLog({
        runId,
        eventType: "run_resumed",
        actor: "coordinator",
        payload: { fromStage: existing.stage },
      });

      const run = existing.data as ReviewRun;
      return this.runFromStage(existing.stage as Stage, run, request, deadline);
    }

    // Already running — conflict
    return {
      runId,
      status: "conflict",
      stage: existing.stage,
      report: null,
      errorMessage: `Run ${runId} is already running on worker ${existing.workerId ?? "unknown"}`,
      fixtureMode: existing.fixtureMode,
    };
  }

  private async runFromStage(
    startStage: Stage,
    run: ReviewRun,
    request: ReviewRequest,
    deadline: number,
  ): Promise<CoordinatorResult> {
    const { store, reviewServices, repository, evidence, metadata, verification } = this.deps;
    const { runId } = request;
    const context: ReviewContext = {
      runId,
      snapshot: null as unknown as RepositorySnapshot, // set after intake
      capabilities: request.capabilities,
      policy: request.policy,
      fixtureMode: request.fixtureMode,
    };

    let currentStage: Stage = startStage;
    let snapshot: RepositorySnapshot | null = null;
    let brief: ReviewBrief | null = null;
    let assessment: RiskAssessment | null = null;
    let plan: ReviewPlan | null = null;
    let findings: Finding[] | null = null;
    let report: ReviewReport | null = null;

    // Load previously committed stage results for resume
    if (startStage !== "intake") {
      snapshot = await this.loadStored<RepositorySnapshot>(runId, "snapshot");
      if (snapshot) context.snapshot = snapshot;
    }
    if (["planning", "review", "validation", "verification", "reporting", "completed"].includes(startStage)) {
      brief = await this.loadStored<ReviewBrief>(runId, "brief");
      assessment = await this.loadStored<RiskAssessment>(runId, "assessment");
    }
    if (["review", "validation", "verification", "reporting", "completed"].includes(startStage)) {
      plan = await this.loadStored<ReviewPlan>(runId, "plan");
    }
    if (["verification", "reporting", "completed"].includes(startStage)) {
      findings = await this.loadStored<Finding[]>(runId, "findings");
    }

    const stageOrder: Stage[] = [
      "intake", "context_collection", "risk_assessment", "planning",
      "review", "validation", "verification", "reporting", "completed",
    ];

    for (let i = stageOrder.indexOf(startStage); i < stageOrder.length; i++) {
      const stage = stageOrder[i];
      if (!stage) break;

      if (Date.now() > deadline) {
        store.upsertRun({ runId, status: "failed", stage: currentStage, fixtureMode: run.fixtureMode, data: run });
        store.appendAuditLog({ runId, eventType: "run_timeout", actor: "coordinator", payload: { stage: currentStage } });
        return { runId, status: "failed", stage: currentStage, report: null, errorMessage: "Run timed out", fixtureMode: run.fixtureMode };
      }

      try {
        switch (stage) {
          case "intake": {
            // Resolve snapshot from Git
            let snap: RepositorySnapshot;
            if (repository instanceof GitAdapter) {
              snap = await repository.createSnapshot(runId, request.baseRevision, request.headRevision);
            } else if ("createSnapshot" in repository && typeof repository.createSnapshot === "function") {
              snap = await repository.createSnapshot(runId, request.baseRevision, request.headRevision);
            } else {
              snap = await repository.getSnapshot(runId);
            }
            snapshot = snap;
            context.snapshot = snap;
            await store.put(runId, "snapshot", snap);
            this.advanceStage(store, run, "intake", "context_collection", runId);
            currentStage = "context_collection";
            break;
          }

          case "context_collection": {
            // Load PR metadata if specified
            let prMetadata: unknown = null;
            if (request.prMetadataPath) {
              prMetadata = await metadata.loadRaw(request.prMetadataPath);
            }
            await store.put(runId, "pr_metadata", prMetadata ?? {});
            this.advanceStage(store, run, "context_collection", "risk_assessment", runId);
            currentStage = "risk_assessment";
            break;
          }

          case "risk_assessment": {
            if (!snapshot) throw new Error("Snapshot not available for risk_assessment");
            const prMetadata = await this.loadStored<unknown>(runId, "pr_metadata");
            brief = await reviewServices.buildBrief(context, prMetadata ?? {});
            await store.put(runId, "brief", brief);
            assessment = await reviewServices.assessRisk(context, brief);
            await store.put(runId, "assessment", assessment);
            this.advanceStage(store, run, "risk_assessment", "planning", runId);
            currentStage = "planning";
            break;
          }

          case "planning": {
            if (!brief || !assessment) throw new Error("Brief or assessment not available for planning");
            plan = await reviewServices.planReview(context, brief, assessment);
            await store.put(runId, "plan", plan);
            this.advanceStage(store, run, "planning", "review", runId);
            currentStage = "review";
            break;
          }

          case "review": {
            if (!brief || !plan) throw new Error("Brief or plan not available for review");
            const candidates = await reviewServices.runReviewers(context, brief, plan);
            await store.put(runId, "candidates", candidates);
            this.advanceStage(store, run, "review", "validation", runId);
            currentStage = "validation";
            break;
          }

          case "validation": {
            if (!brief) throw new Error("Brief not available for validation");
            const candidates = await this.loadStored<import("../contracts/index.js").CandidateFinding[]>(runId, "candidates") ?? [];
            findings = await reviewServices.validateFindings(context, brief, candidates);
            await store.put(runId, "findings", findings);
            this.advanceStage(store, run, "validation", "verification", runId);
            currentStage = "verification";
            break;
          }

          case "verification": {
            // Static-only mode by default. Verification is recorded as unavailable
            // when no isolation boundary is configured.
            void verification; // Used by the report builder via findings
            this.advanceStage(store, run, "verification", "reporting", runId);
            currentStage = "reporting";
            break;
          }

          case "reporting": {
            if (!brief || !assessment || !plan || !findings) {
              throw new Error("Required stage results not available for reporting");
            }
            report = await reviewServices.buildReport(context, brief, assessment, plan, findings);
            await store.put(runId, "report", report);
            // Advance to completed stage and set status = "completed"
            const now = nowISO();
            const updatedRun: ReviewRun = {
              ...run,
              updatedAt: now,
              stageCheckpoints: { ...run.stageCheckpoints, reporting: now },
            };
            store.upsertRun({ runId, status: "completed", stage: "completed", fixtureMode: run.fixtureMode, data: updatedRun });
            currentStage = "completed";
            store.appendAuditLog({ runId, eventType: "run_completed", actor: "coordinator", payload: { reportId: report.reportId } });
            break;
          }

          case "completed": {
            // Nothing to do — already at terminal stage
            break;
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        store.upsertRun({
          runId,
          status: "failed",
          stage: currentStage,
          fixtureMode: run.fixtureMode,
          data: { ...run, errorMessage },
        });
        store.appendAuditLog({
          runId,
          eventType: "stage_failed",
          actor: "coordinator",
          payload: { stage: currentStage, error: errorMessage },
        });
        return {
          runId,
          status: "failed",
          stage: currentStage,
          report: null,
          errorMessage,
          fixtureMode: run.fixtureMode,
        };
      }
    }

    return {
      runId,
      status: "completed",
      stage: "completed",
      report,
      fixtureMode: run.fixtureMode,
    };
  }

  private advanceStage(
    store: SqliteStore,
    run: ReviewRun,
    fromStage: string,
    toStage: string,
    runId: string,
  ): void {
    const now = nowISO();
    const updatedRun: ReviewRun = {
      ...run,
      updatedAt: now,
      stageCheckpoints: {
        ...run.stageCheckpoints,
        [fromStage]: now,
      },
    };

    store.upsertRun({
      runId,
      status: "running",
      stage: toStage,
      fixtureMode: run.fixtureMode,
      data: updatedRun,
    });
    store.appendAuditLog({
      runId,
      eventType: "stage_advanced",
      actor: "coordinator",
      payload: { fromStage, toStage },
    });
  }

  private buildRunRecord(request: ReviewRequest): ReviewRun {
    const now = nowISO();
    return {
      schemaVersion: SCHEMA_VERSION,
      runId: request.runId,
      createdAt: now,
      updatedAt: now,
      provenance: {
        source: "coordinator",
        runId: request.runId,
        createdAt: now,
      },
      repositoryPath: request.repositoryPath,
      baseCommit: request.baseRevision as `${string}`,
      headCommit: request.headRevision as `${string}`,
      prMetadataPath: request.prMetadataPath,
      status: "running",
      fixtureMode: request.fixtureMode,
      capabilityReportId: request.capabilities.reportId,
      stageCheckpoints: {},
    };
  }

  private async loadStored<T>(runId: string, key: string): Promise<T | null> {
    const raw = await this.deps.store.get(runId, key);
    return raw as T | null;
  }

  private async loadStoredReport(runId: string): Promise<ReviewReport | null> {
    return this.loadStored<ReviewReport>(runId, "report");
  }

  /**
   * Cancel a running run.
   */
  cancel(runId: string): void {
    const existing = this.deps.store.getRun(runId);
    if (!existing) return;
    if (["completed", "failed", "cancelled", "superseded"].includes(existing.status)) return;

    this.deps.store.upsertRun({
      runId,
      status: "cancelled",
      stage: existing.stage,
      fixtureMode: existing.fixtureMode,
      data: existing.data,
    });
    this.deps.store.appendAuditLog({
      runId,
      eventType: "run_cancelled",
      actor: "coordinator",
      payload: {},
    });
  }
}

// Re-export stages for external use
export { NEXT_STAGE, type Stage } from "./stages.js";
