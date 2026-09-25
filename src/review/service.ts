/**
 * review/service.ts — ReviewServicesPort implementation.
 *
 * This is the entry point that ABY's coordinator calls.
 * It wires together: brief, risk, planning, reviewers, validation, reporting.
 */
import type {
  ReviewBrief,
  RiskAssessment,
  ReviewPlan,
  CandidateFinding,
  Finding,
  ReviewReport,
  EvidenceRecord,
} from "../contracts/index.js";
import type { ReviewServicesPort, ReviewContext } from "../ports/review-services.js";
import type { RepositoryPort, EvidencePort } from "../ports/repository.js";
import type { ModelPort } from "../ports/model.js";
import type { VerificationPort } from "../ports/verification.js";

import { buildReviewBrief } from "./intent/brief-builder.js";
import { buildRiskAssessment } from "./risk/assessor.js";
import { buildReviewPlan } from "./planning/planner.js";
import { correctnessReviewer } from "./reviewers/correctness.js";
import { impactReviewer } from "./reviewers/impact.js";
import { testsReviewer } from "./reviewers/tests.js";
import { standardsReviewer } from "./reviewers/standards.js";
import { securityReviewer } from "./reviewers/security.js";
import type { ReviewerInput } from "./reviewers/types.js";
import { validateFindings } from "./validation/validator.js";
import { buildReviewReport } from "./conclusions/builder.js";
import { randomUUID } from "crypto";

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export interface ReviewServiceDeps {
  repository: RepositoryPort;
  evidence: EvidencePort;
  model: ModelPort | null;
  verification: VerificationPort | null;
}

export class ReviewService implements ReviewServicesPort {
  private readonly deps: ReviewServiceDeps;

  constructor(deps: ReviewServiceDeps) {
    this.deps = deps;
  }

  async buildBrief(context: ReviewContext, prMetadataRaw: unknown): Promise<ReviewBrief> {
    const { snapshot, policy } = context;

    // Load file contents and diffs for context-bounded files
    const contents: Record<string, string> = {};
    const diffs: Record<string, string> = {};

    for (const file of snapshot.changedFiles.slice(0, policy.maxContextFiles)) {
      const [content, diff] = await Promise.all([
        this.deps.repository.readFile(snapshot.snapshotId, file.path),
        this.deps.repository.getFileDiff(snapshot.snapshotId, file.path),
      ]);
      if (content !== null) contents[file.path] = content;
      if (diff !== null) diffs[file.path] = diff;
    }

    return buildReviewBrief({
      runId: context.runId,
      snapshot,
      prMetadataRaw,
      diffs,
      contents,
      maxContextFiles: policy.maxContextFiles,
      maxFileSizeBytes: policy.maxFileSizeBytes,
    });
  }

  async assessRisk(context: ReviewContext, brief: ReviewBrief): Promise<RiskAssessment> {
    const { snapshot } = context;

    const diffs: Record<string, string> = {};
    const contents: Record<string, string> = {};

    for (const file of snapshot.changedFiles) {
      const [content, diff] = await Promise.all([
        this.deps.repository.readFile(snapshot.snapshotId, file.path),
        this.deps.repository.getFileDiff(snapshot.snapshotId, file.path),
      ]);
      if (content !== null) contents[file.path] = content;
      if (diff !== null) diffs[file.path] = diff;
    }

    return buildRiskAssessment({ brief, snapshot, diffs, contents });
  }

  async planReview(
    _context: ReviewContext,
    brief: ReviewBrief,
    assessment: RiskAssessment,
  ): Promise<ReviewPlan> {
    return buildReviewPlan(brief, assessment);
  }

  async runReviewers(
    context: ReviewContext,
    brief: ReviewBrief,
    plan: ReviewPlan,
  ): Promise<CandidateFinding[]> {
    const { snapshot } = context;

    // Load evidence and file data once
    const evidence = await this.deps.evidence.getEvidenceForRun(context.runId);

    // Build or augment evidence from snapshot
    const augmentedEvidence = await this.buildEvidenceFromSnapshot(context, snapshot, evidence);

    const contents: Record<string, string> = {};
    const diffs: Record<string, string> = {};
    for (const file of snapshot.changedFiles) {
      const [content, diff] = await Promise.all([
        this.deps.repository.readFile(snapshot.snapshotId, file.path),
        this.deps.repository.getFileDiff(snapshot.snapshotId, file.path),
      ]);
      if (content !== null) contents[file.path] = content;
      if (diff !== null) diffs[file.path] = diff;
    }

    const allCandidates: CandidateFinding[] = [];

    for (const assignment of plan.assignments) {
      if (assignment.status === "skipped" || assignment.status === "cancelled") continue;

      const reviewerInput: ReviewerInput = {
        assignment,
        brief,
        contents,
        diffs,
        evidence: augmentedEvidence,
        model: this.deps.model,
        fixtureMode: context.fixtureMode,
      };

      let output;
      switch (assignment.category) {
        case "correctness":
          output = await correctnessReviewer(reviewerInput);
          break;
        case "impact":
          output = await impactReviewer(reviewerInput);
          break;
        case "tests":
          output = await testsReviewer(reviewerInput);
          break;
        case "standards":
          output = await standardsReviewer(reviewerInput);
          break;
        case "security":
          output = await securityReviewer(reviewerInput);
          break;
        default:
          // Specialist categories — currently unsupported in fixture mode
          continue;
      }

      allCandidates.push(...output.candidates);
    }

    return allCandidates;
  }

  async validateFindings(
    context: ReviewContext,
    brief: ReviewBrief,
    candidates: CandidateFinding[],
  ): Promise<Finding[]> {
    const { snapshot } = context;

    const evidence = await this.deps.evidence.getEvidenceForRun(context.runId);
    const contents: Record<string, string> = {};
    for (const file of snapshot.changedFiles) {
      const content = await this.deps.repository.readFile(snapshot.snapshotId, file.path);
      if (content !== null) contents[file.path] = content;
    }

    const result = validateFindings({
      candidates,
      evidence,
      snapshot,
      brief,
      contents,
    });

    return result.findings;
  }

  async buildReport(
    context: ReviewContext,
    brief: ReviewBrief,
    assessment: RiskAssessment,
    plan: ReviewPlan,
    findings: Finding[],
  ): Promise<ReviewReport> {
    return buildReviewReport({
      runId: context.runId,
      snapshot: context.snapshot,
      brief,
      assessment,
      plan,
      findings,
      verificationRecords: [],
      modelTraceability: [],
      fixtureMode: context.fixtureMode,
      coverageNotes: [],
    });
  }

  private async buildEvidenceFromSnapshot(
    context: ReviewContext,
    snapshot: typeof context.snapshot,
    existing: EvidenceRecord[],
  ): Promise<EvidenceRecord[]> {
    const augmented = [...existing];

    for (const file of snapshot.changedFiles) {
      const hasEvidence = existing.some((e) => e.path === file.path);
      if (!hasEvidence) {
        const diff = await this.deps.repository.getFileDiff(snapshot.snapshotId, file.path);
        const ev: EvidenceRecord = {
          schemaVersion: "1.0.0",
          evidenceId: randomUUID(),
          runId: context.runId,
          snapshotId: snapshot.snapshotId,
          createdAt: nowISO(),
          provenance: {
            source: "review/service",
            runId: context.runId,
            createdAt: nowISO(),
          },
          kind: "diff_hunk",
          path: file.path,
          commit: snapshot.headCommit,
          excerpt: diff?.slice(0, 500),
          summary: `Diff for ${file.path} (+${file.linesAdded}/-${file.linesRemoved})`,
        };
        augmented.push(ev);
        await this.deps.evidence.storeEvidence(ev);
      }
    }

    return augmented;
  }
}
