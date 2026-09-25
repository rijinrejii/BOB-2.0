/**
 * ports/review-services.ts — Public interface for the review engine (Rijin's services).
 * ABY's coordinator calls these to execute each review stage.
 */
import type {
  ReviewBrief,
  RiskAssessment,
  ReviewPlan,
  CandidateFinding,
  Finding,
  ReviewReport,
  RepositorySnapshot,
  CapabilityReport,
  TrustedPolicy,
} from "../contracts/index.js";

export interface ReviewContext {
  runId: string;
  snapshot: RepositorySnapshot;
  capabilities: CapabilityReport;
  policy: TrustedPolicy;
  fixtureMode: boolean;
}

export interface ReviewServicesPort {
  /**
   * Stage 1: Build shared review brief from snapshot and PR metadata.
   */
  buildBrief(context: ReviewContext, prMetadataRaw: unknown): Promise<ReviewBrief>;

  /**
   * Stage 2: Assess risk using deterministic rules.
   * Cannot silently downgrade mandatory classification.
   */
  assessRisk(context: ReviewContext, brief: ReviewBrief): Promise<RiskAssessment>;

  /**
   * Stage 3: Plan reviewer assignments based on risk.
   */
  planReview(context: ReviewContext, brief: ReviewBrief, assessment: RiskAssessment): Promise<ReviewPlan>;

  /**
   * Stage 4: Execute specialist reviewers and collect candidate findings.
   * Returns raw candidates before validation.
   */
  runReviewers(context: ReviewContext, brief: ReviewBrief, plan: ReviewPlan): Promise<CandidateFinding[]>;

  /**
   * Stage 5: Validate, deduplicate, and classify candidate findings.
   */
  validateFindings(context: ReviewContext, brief: ReviewBrief, candidates: CandidateFinding[]): Promise<Finding[]>;

  /**
   * Stage 6: Build the final ReviewReport from validated findings.
   */
  buildReport(
    context: ReviewContext,
    brief: ReviewBrief,
    assessment: RiskAssessment,
    plan: ReviewPlan,
    findings: Finding[],
  ): Promise<ReviewReport>;
}
