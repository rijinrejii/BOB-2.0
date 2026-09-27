import { createHash, randomUUID } from "node:crypto";
import {
  ReviewBrief,
  RiskAssessment,
  ReviewPlan,
  CandidateFinding,
  Finding,
  EvidenceRecord,
  type ReviewReport,
} from "../contracts/index.js";
import type {
  ReviewServicesPort,
  ReviewContext,
} from "../ports/review-services.js";
import type {
  RepositoryPort,
  EvidencePort,
} from "../ports/repository.js";
import type { ModelPort } from "../ports/model.js";
import type { VerificationPort } from "../ports/verification.js";
import type { StorePort } from "../ports/store.js";
import { redactSecrets } from "../platform/redaction.js";

import { buildReviewBrief } from "./intent/brief-builder.js";
import { buildRiskAssessment } from "./risk/assessor.js";
import { buildReviewPlan } from "./planning/planner.js";
import { correctnessReviewer } from "./reviewers/correctness.js";
import { impactReviewer } from "./reviewers/impact.js";
import { testsReviewer } from "./reviewers/tests.js";
import { standardsReviewer } from "./reviewers/standards.js";
import { securityReviewer } from "./reviewers/security.js";
import type {
  ReviewerOutput,
  SpecialistReviewer,
} from "./reviewers/types.js";
import { validateFindings } from "./validation/validator.js";
import { buildReviewReport } from "./conclusions/builder.js";

export interface ReviewServiceDeps {
  repository: RepositoryPort;
  evidence: EvidencePort;
  model: ModelPort | null;
  verification: VerificationPort | null;
  store: StorePort;
}

interface ContextData {
  contents: Record<string, string>;
  diffs: Record<string, string>;
  unavailable: string[];
}

const reviewers: Partial<Record<string, SpecialistReviewer>> = {
  correctness: correctnessReviewer,
  impact: impactReviewer,
  tests: testsReviewer,
  standards: standardsReviewer,
  security: securityReviewer,
};

export class ReviewService implements ReviewServicesPort {
  constructor(private readonly deps: ReviewServiceDeps) {}

  private async loadContext(context: ReviewContext): Promise<ContextData> {
    const contents: Record<string, string> = {};
    const diffs: Record<string, string> = {};
    const unavailable: string[] = [];

    const selected = context.snapshot.changedFiles.slice(
      0,
      context.policy.maxContextFiles,
    );

    for (const file of selected) {
      try {
        if (file.changeKind !== "deleted") {
          const content = await this.deps.repository.readFile(
            context.snapshot.snapshotId,
            file.path,
          );

          if (content === null) {
            unavailable.push(`${file.path}: text content unavailable`);
          } else {
            contents[file.path] = content;
          }
        }

        const diff = await this.deps.repository.getFileDiff(
          context.snapshot.snapshotId,
          file.path,
        );

        if (diff === null) {
          unavailable.push(`${file.path}: diff unavailable`);
        } else {
          diffs[file.path] = diff;
        }
      } catch {
        unavailable.push(`${file.path}: repository read failed`);
      }
    }

    return { contents, diffs, unavailable };
  }

  async buildBrief(
    context: ReviewContext,
    prMetadataRaw: unknown,
  ): Promise<ReviewBrief> {
    const data = await this.loadContext(context);

    const brief = buildReviewBrief({
      runId: context.runId,
      snapshot: context.snapshot,
      prMetadataRaw,
      diffs: data.diffs,
      contents: data.contents,
      maxContextFiles: context.policy.maxContextFiles,
      maxFileSizeBytes: context.policy.maxFileSizeBytes,
    });

    brief.missingInformation.push(...data.unavailable);

    if (data.unavailable.length > 0) {
      brief.contextBounded = true;
    }

    if (brief.acceptanceCriteria.every((criterion) => criterion.source !== "stated")) {
      const createdAt = new Date().toISOString();

      brief.humanDecisions.push({
        schemaVersion: "1.0.0",
        decisionId: randomUUID(),
        runId: context.runId,
        createdAt,
        provenance: {
          source: "review/service",
          runId: context.runId,
          createdAt,
        },
        kind: "ambiguous_requirement",
        title: "Confirm acceptance criteria",
        description:
          "No explicit acceptance criteria were provided. Confirm the expected " +
          "behavior before treating correctness review as complete.",
      });
    }

    return ReviewBrief.parse(brief);
  }

  async assessRisk(
    context: ReviewContext,
    brief: ReviewBrief,
  ): Promise<RiskAssessment> {
    const data = await this.loadContext(context);

    const assessment = buildRiskAssessment({
      brief,
      snapshot: context.snapshot,
      diffs: data.diffs,
      contents: data.contents,
    });

    // Do not permit LOW when relevant source was omitted or unreadable.
    if (
      assessment.level === "low" &&
      (
        brief.contextBounded ||
        data.unavailable.length > 0 ||
        context.snapshot.totalChangedFiles !== context.snapshot.changedFiles.length
      )
    ) {
      assessment.level = "medium";
      assessment.uncertaintyAssessment =
        "Context is incomplete; low-risk classification is not justified.";
    }

    // Fail explicitly rather than silently ignore configured mandatory rules.
    if (context.policy.additionalMandatoryRiskPatterns.length > 0) {
      throw new Error(
        "Custom mandatory risk patterns are not implemented in this static milestone",
      );
    }

    return RiskAssessment.parse(assessment);
  }

  async planReview(
    _context: ReviewContext,
    brief: ReviewBrief,
    assessment: RiskAssessment,
  ): Promise<ReviewPlan> {
    return ReviewPlan.parse(buildReviewPlan(brief, assessment));
  }

  async runReviewers(
    context: ReviewContext,
    brief: ReviewBrief,
    plan: ReviewPlan,
  ): Promise<CandidateFinding[]> {
    const data = await this.loadContext(context);
    const evidence: EvidenceRecord[] = [];

    for (const file of context.snapshot.changedFiles) {
      const diff = data.diffs[file.path];
      if (diff === undefined) continue;

      const timestamp = new Date().toISOString();
      const redacted = redactSecrets(diff);

      const record = EvidenceRecord.parse({
        schemaVersion: "1.0.0",
        evidenceId: randomUUID(),
        runId: context.runId,
        snapshotId: context.snapshot.snapshotId,
        createdAt: timestamp,
        provenance: {
          source: "review/service",
          runId: context.runId,
          createdAt: timestamp,
        },
        kind: "diff_hunk",
        path: file.path,
        commit: context.snapshot.headCommit,
        excerpt: redacted,
        contentHash: createHash("sha256").update(diff).digest("hex"),
        extractionQuality: redacted === diff ? "full" : "partial",
        summary: redacted === diff
          ? `Changed-file diff: ${file.path}`
          : `Changed-file diff with secret-like text redacted: ${file.path}`,
      });

      await this.deps.evidence.storeEvidence(record);
      evidence.push(record);
    }

    const outputs = await Promise.all(
      plan.assignments.map(async (assignment): Promise<ReviewerOutput> => {
        const reviewer = reviewers[assignment.category];

        if (!reviewer) {
          assignment.status = "skipped";
          assignment.exclusionReason = "Specialist is not implemented";

          return {
            assignmentId: assignment.assignmentId,
            candidates: [],
            coverageNotes: [
              `${assignment.category}: specialist not implemented`,
            ],
            missingCapabilities: [assignment.category],
          };
        }

        assignment.status = "running";
        assignment.startedAt = new Date().toISOString();

        try {
          const output = await reviewer({
            assignment,
            brief,
            contents: data.contents,
            diffs: data.diffs,
            evidence,
            model: null,
            fixtureMode: context.fixtureMode,
          });

          assignment.status = "completed";
          assignment.completedAt = new Date().toISOString();

          return {
            ...output,
            candidates: CandidateFinding.array().parse(output.candidates),
          };
        } catch {
          assignment.status = "failed";
          assignment.completedAt = new Date().toISOString();

          return {
            assignmentId: assignment.assignmentId,
            candidates: [],
            coverageNotes: [
              `${assignment.category}: reviewer failed`,
            ],
            missingCapabilities: [assignment.category],
          };
        }
      }),
    );

    await this.deps.store.put(context.runId, "reviewer_outputs", outputs);
    await this.deps.store.put(context.runId, "context_gaps", data.unavailable);

    return outputs.flatMap((output) => output.candidates);
  }

  async validateFindings(
    context: ReviewContext,
    brief: ReviewBrief,
    candidates: CandidateFinding[],
  ): Promise<Finding[]> {
    const data = await this.loadContext(context);

    const result = validateFindings({
      candidates,
      evidence: await this.deps.evidence.getEvidenceForRun(context.runId),
      snapshot: context.snapshot,
      brief,
      contents: data.contents,
    });

    await this.deps.store.put(
      context.runId,
      "rejected_candidates",
      result.rejected,
    );

    return Finding.array().parse(result.findings);
  }

  async buildReport(
    context: ReviewContext,
    brief: ReviewBrief,
    assessment: RiskAssessment,
    plan: ReviewPlan,
    findings: Finding[],
  ): Promise<ReviewReport> {
    const notes = [
      "Live model review is disabled in this static milestone.",
      "Static pattern matches are investigation leads, not confirmed defects.",
      "Caller tracing and approved standards-document loading are unavailable.",
      ...brief.missingInformation,
      ...brief.excludedFiles.map((file) => `${file.path}: ${file.reason}`),
    ];

    for (const assignment of plan.assignments) {
      if (assignment.status !== "completed") {
        notes.push(
          `${assignment.category}: ${assignment.status}` +
          (assignment.exclusionReason ? ` - ${assignment.exclusionReason}` : ""),
        );
      }
    }

    return buildReviewReport({
      runId: context.runId,
      snapshot: context.snapshot,
      brief,
      assessment,
      plan,
      findings,
      verificationRecords: [{
        commandId: "sandbox-verification",
        outcome: "unavailable",
        failureKind: "unavailable_execution",
        attributionNote: "No reviewed code was executed",
      }],
      modelTraceability: [],
      fixtureMode: context.fixtureMode,
      coverageNotes: notes,
    });
  }
}
