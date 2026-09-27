import type {
  ReviewServicesPort,
  ReviewContext,
} from "../ports/review-services.js";
import type {
  RepositoryPort,
  EvidencePort,
} from "../ports/repository.js";
import type { MetadataPort } from "../ports/metadata.js";
import type { VerificationPort } from "../ports/verification.js";
import type { SqliteStore } from "../adapters/sqlite/sqlite-store.js";
import {
  ReviewRun,
  RepositorySnapshot,
  CapabilityReport,
  TrustedPolicy,
  ReviewBrief,
  RiskAssessment,
  ReviewPlan,
  CandidateFinding,
  Finding,
  ReviewReport,
} from "../contracts/index.js";
import type { Stage } from "./stages.js";

const nowISO = (): string => new Date().toISOString();

export interface CoordinatorDeps {
  store: SqliteStore;
  repository: RepositoryPort & {
    createSnapshot?: (
      runId: string,
      base: string,
      head: string,
    ) => Promise<RepositorySnapshot>;
  };
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
  private readonly active = new Set<string>();
  private readonly cancelled = new Set<string>();

  constructor(private readonly deps: CoordinatorDeps) {}

  async execute(request: ReviewRequest): Promise<CoordinatorResult> {
    const { runId, fixtureMode } = request;
    const { store, repository, reviewServices } = this.deps;

    if (this.active.has(runId)) {
      return {
        runId,
        status: "conflict",
        stage: "intake",
        report: null,
        fixtureMode,
        errorMessage: "This coordinator is already processing the run",
      };
    }

    const timeoutMs = request.timeoutMs ?? 120_000;

    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive integer");
    }

    if (
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(request.baseRevision) ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(request.headRevision)
    ) {
      throw new Error("Coordinator requires resolved full commit hashes");
    }

    TrustedPolicy.parse(request.policy);
    CapabilityReport.parse(request.capabilities);

    const identity = {
      repositoryPath: request.repositoryPath,
      baseCommit: request.baseRevision,
      headCommit: request.headRevision,
      policyContentHash: request.policy.contentHash,
      fixtureMode,
      engineVersion: request.engineVersion,
    };

    const existing = store.getRun(runId);

    if (existing) {
      const storedIdentity = await store.get(runId, "identity");

      if (JSON.stringify(storedIdentity) !== JSON.stringify(identity)) {
        throw new Error("Run identity does not match the requested inputs");
      }

      if (existing.status === "completed") {
        return {
          runId,
          status: "completed",
          stage: "completed",
          report: ReviewReport.parse(await store.get(runId, "report")),
          fixtureMode: existing.fixtureMode,
        };
      }

      if (existing.status === "cancelled") {
        return {
          runId,
          status: "cancelled",
          stage: existing.stage,
          report: null,
          fixtureMode: existing.fixtureMode,
          errorMessage: "Cancelled runs are not automatically restarted",
        };
      }
    }

    this.active.add(runId);
    this.cancelled.delete(runId);

    const deadline = Date.now() + timeoutMs;
    let stage: Stage = "intake";
    const createdAt = nowISO();

    let run = ReviewRun.parse({
      schemaVersion: "1.0.0",
      runId,
      createdAt,
      updatedAt: createdAt,
      provenance: {
        source: "coordinator",
        runId,
        createdAt,
      },
      repositoryPath: request.repositoryPath,
      baseCommit: request.baseRevision,
      headCommit: request.headRevision,
      ...(request.prMetadataPath
        ? { prMetadataPath: request.prMetadataPath }
        : {}),
      status: "running",
      fixtureMode,
      capabilityReportId: request.capabilities.reportId,
      stageCheckpoints: {},
    });

    const guard = (): void => {
      if (this.cancelled.has(runId)) {
        throw new Error("Run cancelled");
      }

      if (Date.now() >= deadline) {
        throw new Error("Run timed out");
      }
    };

    const checkpoint = (completed: Stage, next: Stage): void => {
      guard();
      const timestamp = nowISO();

      run = ReviewRun.parse({
        ...run,
        updatedAt: timestamp,
        stageCheckpoints: {
          ...run.stageCheckpoints,
          [completed]: timestamp,
        },
      });

      stage = next;

      store.upsertRun({
        runId,
        status: "running",
        stage,
        fixtureMode,
        data: run,
      });
    };

    try {
      await store.put(runId, "identity", identity);
      await store.delete(runId, "report");

      store.upsertRun({
        runId,
        status: "running",
        stage,
        fixtureMode,
        data: run,
      });

      // Mark any runs that were left in "running" state (from a previous crashed
      // session) as "interrupted", excluding the current run.
      store.markInterruptedRuns(runId);

      store.appendAuditLog({
        runId,
        eventType: existing ? "run_restarted" : "run_created",
        actor: "coordinator",
        payload: {
          recovery: existing
            ? "Restart from immutable inputs; no partial-stage reuse"
            : "New run",
        },
      });

      guard();

      const snapshot = RepositorySnapshot.parse(
        repository.createSnapshot
          ? await repository.createSnapshot(
              runId,
              request.baseRevision,
              request.headRevision,
            )
          : await repository.getSnapshot(runId),
      );

      if (
        snapshot.runId !== runId ||
        snapshot.baseCommit !== request.baseRevision ||
        snapshot.headCommit !== request.headRevision
      ) {
        throw new Error("Snapshot identity mismatch");
      }

      await store.put(runId, "snapshot", snapshot);
      checkpoint("intake", "context_collection");

      const context: ReviewContext = {
        runId,
        snapshot,
        policy: request.policy,
        capabilities: request.capabilities,
        fixtureMode,
      };

      const metadata = request.prMetadataPath
        ? await this.deps.metadata.loadRaw(request.prMetadataPath)
        : {};

      await store.put(runId, "pr_metadata", metadata ?? {});
      checkpoint("context_collection", "risk_assessment");

      const brief = ReviewBrief.parse(
        await reviewServices.buildBrief(context, metadata ?? {}),
      );
      guard();

      const assessment = RiskAssessment.parse(
        await reviewServices.assessRisk(context, brief),
      );

      await store.put(runId, "brief", brief);
      await store.put(runId, "assessment", assessment);
      checkpoint("risk_assessment", "planning");

      const plan = ReviewPlan.parse(
        await reviewServices.planReview(context, brief, assessment),
      );

      await store.put(runId, "plan", plan);
      checkpoint("planning", "review");

      const candidates = CandidateFinding.array().parse(
        await reviewServices.runReviewers(context, brief, plan),
      );

      await store.put(runId, "candidates", candidates);
      // ReviewService updates assignment states.
      await store.put(runId, "plan", ReviewPlan.parse(plan));
      checkpoint("review", "validation");

      const findings = Finding.array().parse(
        await reviewServices.validateFindings(context, brief, candidates),
      );

      await store.put(runId, "findings", findings);
      checkpoint("validation", "verification");

      // No code execution is attempted in the static milestone.
      await store.put(runId, "verification_status", {
        outcome: "unavailable",
        reason: "Static-only review; no verified execution boundary",
      });
      checkpoint("verification", "reporting");

      const report = ReviewReport.parse(
        await reviewServices.buildReport(
          context,
          brief,
          assessment,
          plan,
          findings,
        ),
      );

      guard();

      await store.put(runId, "report", report);

      run = ReviewRun.parse({
        ...run,
        status: "completed",
        updatedAt: nowISO(),
        stageCheckpoints: {
          ...run.stageCheckpoints,
          reporting: nowISO(),
        },
      });

      store.upsertRun({
        runId,
        status: "completed",
        stage: "completed",
        fixtureMode,
        data: run,
      });

      return {
        runId,
        status: "completed",
        stage: "completed",
        report,
        fixtureMode,
      };
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : "Unknown review failure";

      const status = this.cancelled.has(runId) ? "cancelled" : "failed";

      run = ReviewRun.parse({
        ...run,
        status,
        updatedAt: nowISO(),
        errorMessage,
      });

      store.upsertRun({
        runId,
        status,
        stage,
        fixtureMode,
        data: run,
      });

      return {
        runId,
        status,
        stage,
        report: null,
        errorMessage,
        fixtureMode,
      };
    } finally {
      this.active.delete(runId);
      this.cancelled.delete(runId);
    }
  }

  cancel(runId: string): void {
    this.cancelled.add(runId);

    if (this.active.has(runId)) return;

    const existing = this.deps.store.getRun(runId);
    if (!existing || existing.status === "completed") return;

    this.deps.store.upsertRun({
      runId,
      status: "cancelled",
      stage: existing.stage,
      fixtureMode: existing.fixtureMode,
      data: existing.data,
    });
  }
}

export { NEXT_STAGE, type Stage } from "./stages.js";
