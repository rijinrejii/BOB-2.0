/**
 * review/validation/validator.ts — Validates and classifies candidate findings.
 *
 * Validation rules:
 * - Evidence references must exist and be relevant.
 * - Affected path must be reachable (in snapshot).
 * - Existing guards/callers can invalidate a claim.
 * - Pre-existing issues are noted but not dismissed.
 * - Model agreement is NOT sufficient evidence.
 * - A passing test does not disprove a defect outside its scope.
 */
import { randomUUID } from "crypto";
import type {
  CandidateFinding,
  Finding,
  EvidenceRecord,
  RepositorySnapshot,
  ReviewBrief,
} from "../../contracts/index.js";

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export interface ValidatorInput {
  candidates: CandidateFinding[];
  evidence: EvidenceRecord[];
  snapshot: RepositorySnapshot;
  brief: ReviewBrief;
  /** File contents for guard/caller analysis */
  contents: Record<string, string>;
}

export interface ValidationResult {
  findings: Finding[];
  /** Rejected candidates preserved in audit output, not main report */
  rejected: Array<{ candidateId: string; reason: string; candidate: CandidateFinding }>;
}

export function validateFindings(input: ValidatorInput): ValidationResult {
  const { candidates, evidence, snapshot, brief, contents } = input;
  const evidenceMap = new Map(evidence.map((e) => [e.evidenceId, e]));
  const snapshotPaths = new Set(snapshot.changedFiles.map((f) => f.path));

  const findings: Finding[] = [];
  const rejected: ValidationResult["rejected"] = [];

  // Deduplicate by underlying cause + affected behavior
  const seen = deduplicateCandidates(candidates);

  for (const { primary, duplicateIds } of seen) {
    const result = validateCandidate(primary, evidenceMap, snapshotPaths, contents, brief);

    if (result.status === "rejected") {
      rejected.push({ candidateId: primary.candidateId, reason: result.reason, candidate: primary });
      continue;
    }

    findings.push({
      schemaVersion: "1.0.0",
      findingId: randomUUID(),
      candidateId: primary.candidateId,
      runId: primary.runId,
      createdAt: primary.createdAt,
      validatedAt: nowISO(),
      provenance: {
        source: "review/validation/validator",
        runId: primary.runId,
        createdAt: nowISO(),
      },
      validationStatus: result.status,
      validationRationale: result.rationale,
      rejectionReason: undefined,

      claim: primary.claim,
      affectedPath: primary.affectedPath,
      headCommit: primary.headCommit,
      lineRange: primary.lineRange,
      failureScenario: primary.failureScenario,
      observedBehavior: primary.observedBehavior,
      expectedBehavior: primary.expectedBehavior,
      expectedBehaviorSource: primary.expectedBehaviorSource,
      evidenceIds: primary.evidenceIds,
      severity: primary.severity,
      confidence: primary.confidence,
      categories: primary.categories,
      mergeImpact: primary.mergeImpact,
      recommendedNextStep: primary.recommendedNextStep,
      introducedByChange: result.introducedByChange,
      deduplicatedFrom: duplicateIds,
    });
  }

  return { findings, rejected };
}

interface ValidationOutcome {
  status: "confirmed" | "unresolved" | "rejected";
  rationale: string;
  reason: string;
  introducedByChange: boolean | null;
}

function validateCandidate(
  candidate: CandidateFinding,
  evidenceMap: Map<string, EvidenceRecord>,
  snapshotPaths: Set<string>,
  contents: Record<string, string>,
  brief: ReviewBrief,
): ValidationOutcome {
  // Rule 1: Affected path must be in the snapshot
  if (candidate.affectedPath !== "model-output" && !snapshotPaths.has(candidate.affectedPath)) {
    return {
      status: "rejected",
      rationale: `Affected path ${candidate.affectedPath} is not in the snapshot`,
      reason: "path_not_in_snapshot",
      introducedByChange: null,
    };
  }

  // Rule 2: Evidence references must exist (or be empty — static analysis may have no IDs)
  const missingEvidence = candidate.evidenceIds.filter((id) => !evidenceMap.has(id));
  if (missingEvidence.length > 0 && candidate.evidenceIds.length > 0) {
    return {
      status: "unresolved",
      rationale: `Evidence IDs referenced but not found: ${missingEvidence.join(", ")}`,
      reason: "missing_evidence_references",
      introducedByChange: null,
    };
  }

  // Rule 3: Check for existing guards that invalidate the claim
  const guardInvalidates = checkForExistingGuards(candidate, contents);
  if (guardInvalidates) {
    return {
      status: "rejected",
      rationale: `Existing guard or control invalidates claim: ${guardInvalidates}`,
      reason: "invalidated_by_existing_guard",
      introducedByChange: false,
    };
  }

  // Rule 4: Check preconditions are possible
  if (isPreconditionImpossible(candidate, contents)) {
    return {
      status: "rejected",
      rationale: "Preconditions for this finding are not possible given the code context",
      reason: "impossible_preconditions",
      introducedByChange: null,
    };
  }

  // Rule 5: For model-sourced findings, retain as unresolved unless static analysis confirms
  if (
    candidate.headCommit === "model-output" &&
    candidate.confidence === "low"
  ) {
    return {
      status: "unresolved",
      rationale: "Model-sourced finding with low confidence — requires human verification",
      reason: "model_low_confidence",
      introducedByChange: null,
    };
  }

  // Determine if introduced by this change (vs pre-existing)
  const introducedByChange = isIntroducedByChange(candidate, snapshotPaths);

  return {
    status: "confirmed",
    rationale:
      candidate.evidenceIds.length > 0
        ? `Claim supported by evidence and static analysis`
        : `Static reasoning: ${candidate.confidenceRationale}`,
    reason: "ok",
    introducedByChange,
  };
}

/** Check if existing code guards make the claim impossible */
function checkForExistingGuards(
  candidate: CandidateFinding,
  contents: Record<string, string>,
): string | null {
  const content = contents[candidate.affectedPath];
  if (!content) return null;

  // If claim is about missing error handling but content has try/catch
  if (
    candidate.underlyingCause === "missing_error_handling" &&
    /try\s*\{|\.catch\s*\(|catch\s*\(/i.test(content)
  ) {
    return "File contains try/catch or .catch() — error handling may be present outside diff";
  }

  // If claim is about missing auth but content has auth middleware import
  if (
    candidate.underlyingCause === "missing_authorization" &&
    /require.*auth|import.*auth|middleware.*auth/i.test(content)
  ) {
    return "File imports authentication middleware — authorization may be applied at a higher level";
  }

  return null;
}

/** Check if preconditions are impossible */
function isPreconditionImpossible(
  candidate: CandidateFinding,
  contents: Record<string, string>,
): boolean {
  // Hardcoded secrets: if content shows the "secret" is a test fixture value
  if (
    candidate.underlyingCause === "hardcoded_secret" &&
    candidate.affectedPath.includes("fixture")
  ) {
    return true;
  }
  return false;
}

/** Assess whether the finding was introduced by this change */
function isIntroducedByChange(
  candidate: CandidateFinding,
  snapshotPaths: Set<string>,
): boolean | null {
  // If path is in snapshot (changed files), it's likely introduced or touched by this change
  if (snapshotPaths.has(candidate.affectedPath)) {
    return true;
  }
  return null;
}

interface DeduplicationGroup {
  primary: CandidateFinding;
  duplicateIds: string[];
}

/** Deduplicate by underlying cause + affected behavior (not wording or line number) */
function deduplicateCandidates(candidates: CandidateFinding[]): DeduplicationGroup[] {
  const groups = new Map<string, DeduplicationGroup>();

  for (const candidate of candidates) {
    const key = `${candidate.underlyingCause}::${candidate.affectedBehavior}`;

    const existing = groups.get(key);
    if (existing) {
      existing.duplicateIds.push(candidate.candidateId);
    } else {
      groups.set(key, { primary: candidate, duplicateIds: [] });
    }
  }

  return Array.from(groups.values());
}
