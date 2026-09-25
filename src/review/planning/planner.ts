/**
 * review/planning/planner.ts — Builds ReviewPlan from a RiskAssessment.
 *
 * Risk → Plan rules:
 * - LOW:    Correctness + relevant categories; others excluded with reasons.
 * - MEDIUM: All five standard categories.
 * - HIGH:   All five + applicable specialists + owner_review HumanDecision.
 */
import { randomUUID } from "crypto";
import type {
  ReviewBrief,
  RiskAssessment,
  ReviewPlan,
  ReviewerAssignment,
  ResourceLimits,
} from "../../contracts/index.js";
import type { ReviewCategory, SpecialistCategory } from "../../contracts/plan.js";

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

const DEFAULT_LIMITS: ResourceLimits = {
  maxContextTokens: 8000,
  maxResponseTokens: 2000,
  timeoutMs: 60_000,
  maxRetries: 2,
};

const HIGH_RISK_LIMITS: ResourceLimits = {
  maxContextTokens: 12000,
  maxResponseTokens: 3000,
  timeoutMs: 90_000,
  maxRetries: 2,
};

function makeAssignment(
  planId: string,
  runId: string,
  category: ReviewCategory | SpecialistCategory,
  scope: string,
  questions: string[],
  requiredEvidence: string[],
  focusedPaths: string[],
  limits: ResourceLimits,
  dependencies: string[] = [],
): ReviewerAssignment {
  return {
    assignmentId: randomUUID(),
    planId,
    runId,
    category,
    scope,
    questions,
    requiredEvidence,
    allowedCapabilities: ["read_evidence", "read_brief", "read_snapshot"],
    dependencies,
    resourceLimits: limits,
    completionCriteria: `Return structured findings for ${category} review with evidence references.`,
    status: "pending",
    focusedPaths,
  };
}

export function buildReviewPlan(
  brief: ReviewBrief,
  assessment: RiskAssessment,
): ReviewPlan {
  const planId = randomUUID();
  const runId = brief.runId;
  const paths = brief.affectedModules.map((m) => m.path);
  const limits = assessment.level === "high" ? HIGH_RISK_LIMITS : DEFAULT_LIMITS;

  const assignments: ReviewerAssignment[] = [];

  const correctnessAssignment = makeAssignment(
    planId, runId, "correctness",
    "Verify implementation matches acceptance criteria; check edge cases, error handling, and state transitions.",
    [
      "Does the implementation fulfill each acceptance criterion?",
      "Are edge cases and error conditions handled correctly?",
      "Are there state transitions or retries that could fail?",
    ],
    ["acceptance_criteria", "changed_source", "diff"],
    paths,
    limits,
  );
  assignments.push(correctnessAssignment);

  const excludedCategories: ReviewPlan["excludedCategories"] = [];

  if (assessment.level === "low") {
    // Low risk: correctness only; exclude others with explicit reasons
    excludedCategories.push(
      { category: "impact", reason: "Low risk: limited scope with positive evidence; impact check skipped." },
      { category: "tests", reason: "Low risk: focused change; test mapping skipped unless test files changed." },
      { category: "standards", reason: "Low risk: standards check skipped to limit review overhead." },
      { category: "security", reason: "Low risk: no mandatory security patterns detected." },
    );

    return {
      schemaVersion: "1.0.0",
      planId,
      runId,
      assessmentId: assessment.assessmentId,
      createdAt: nowISO(),
      provenance: {
        source: "review/planning/planner",
        runId,
        createdAt: nowISO(),
      },
      assignments,
      concurrentGroups: [[correctnessAssignment.assignmentId]],
      excludedCategories,
    };
  }

  // Medium and High: all five standard categories
  const impactAssignment = makeAssignment(
    planId, runId, "impact",
    "Trace observed callers, interfaces, configuration, storage, and deployment dependencies.",
    [
      "What callers or interfaces depend on the changed code?",
      "Could this change break existing downstream behavior?",
      "Are there configuration, storage, or deployment dependencies?",
    ],
    ["changed_source", "diff", "caller_evidence"],
    paths,
    limits,
  );

  const testsAssignment = makeAssignment(
    planId, runId, "tests",
    "Map changed behavior to meaningful assertions. Identify missing negative and boundary cases.",
    [
      "Is each changed behavior covered by a meaningful assertion?",
      "Are there missing negative or boundary test cases?",
      "Do any tests rely on stubs, skip markers, or assertion-free patterns?",
    ],
    ["changed_source", "test_files", "diff"],
    paths,
    limits,
  );

  const standardsAssignment = makeAssignment(
    planId, runId, "standards",
    "Apply approved rules with exact source/version references. Separate mandatory from preferences.",
    [
      "Which approved standards apply to this change?",
      "Are any mandatory rules violated?",
      "Are there preference-level style issues that should be noted separately?",
    ],
    ["changed_source", "diff", "standards_documents"],
    paths,
    limits,
  );

  const securityAssignment = makeAssignment(
    planId, runId, "security",
    "Investigate trust boundaries, authorization, validation, injection, secrets, data exposure, and abuse cases.",
    [
      "Are trust boundaries correctly enforced?",
      "Is input validation complete and consistent?",
      "Could secrets or sensitive data be exposed?",
      "Are there injection or privilege escalation risks?",
    ],
    ["changed_source", "diff", "auth_evidence"],
    paths,
    limits,
  );

  assignments.push(impactAssignment, testsAssignment, standardsAssignment, securityAssignment);

  // All five are independent — they can run concurrently
  const concurrentGroups: string[][] = [
    assignments.map((a) => a.assignmentId),
  ];

  if (assessment.level === "high") {
    // Add specialist assignments for triggered mandatory factors
    const specialistAssignments: ReviewerAssignment[] = [];

    if (assessment.mandatoryFactors.includes("dependencies")) {
      const depAudit = makeAssignment(
        planId, runId, "dependency_audit" as SpecialistCategory,
        "Audit changed dependencies for known vulnerabilities and supply-chain risks.",
        [
          "Are any newly added or updated dependencies known to have vulnerabilities?",
          "Is the dependency change minimal and justified?",
        ],
        ["package_manifest", "diff"],
        paths,
        limits,
      );
      specialistAssignments.push(depAudit);
    }

    if (
      assessment.mandatoryFactors.includes("authentication") ||
      assessment.mandatoryFactors.includes("authorization")
    ) {
      const cryptoAssignment = makeAssignment(
        planId, runId, "cryptography" as SpecialistCategory,
        "Review cryptographic patterns and secure token handling.",
        [
          "Are cryptographic primitives used correctly?",
          "Is token storage and transmission secure?",
        ],
        ["changed_source", "diff"],
        paths,
        limits,
      );
      specialistAssignments.push(cryptoAssignment);
    }

    if (assignment_hasConcurrency(assessment)) {
      const concurrencyAssignment = makeAssignment(
        planId, runId, "concurrency" as SpecialistCategory,
        "Review concurrent access patterns for race conditions and deadlocks.",
        [
          "Could concurrent access to shared state cause races?",
          "Are locks acquired and released correctly?",
        ],
        ["changed_source", "diff"],
        paths,
        limits,
      );
      specialistAssignments.push(concurrencyAssignment);
    }

    assignments.push(...specialistAssignments);
    if (specialistAssignments.length > 0) {
      concurrentGroups.push(specialistAssignments.map((a) => a.assignmentId));
    }
  }

  return {
    schemaVersion: "1.0.0",
    planId,
    runId,
    assessmentId: assessment.assessmentId,
    createdAt: nowISO(),
    provenance: {
      source: "review/planning/planner",
      runId,
      createdAt: nowISO(),
    },
    assignments,
    concurrentGroups,
    excludedCategories,
  };
}

function assignment_hasConcurrency(assessment: RiskAssessment): boolean {
  return assessment.mandatoryFactors.includes("concurrency");
}
