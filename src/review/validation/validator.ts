import { randomUUID } from "node:crypto";
import {
  CandidateFinding,
  Finding,
  EvidenceRecord,
  type RepositorySnapshot,
  type ReviewBrief,
} from "../../contracts/index.js";

export interface ValidatorInput {
  candidates: CandidateFinding[];
  evidence: EvidenceRecord[];
  snapshot: RepositorySnapshot;
  brief: ReviewBrief;
  contents: Record<string, string>;
}

export interface ValidationResult {
  findings: Finding[];
  rejected: Array<{
    candidateId: string;
    reason: string;
    candidate: CandidateFinding;
  }>;
}

export function validateFindings(input: ValidatorInput): ValidationResult {
  const evidence = new Map(
    input.evidence.map((record) => {
      const parsed = EvidenceRecord.parse(record);
      return [parsed.evidenceId, parsed] as const;
    }),
  );

  const changedPaths = new Set(
    input.snapshot.changedFiles.map((file) => file.path),
  );

  const groups = new Map<
    string,
    { primary: CandidateFinding; duplicateIds: string[] }
  >();

  const rejected: ValidationResult["rejected"] = [];

  for (const raw of input.candidates) {
    let candidate: CandidateFinding;

    try {
      candidate = CandidateFinding.parse(raw);
    } catch (error) {
      // Malformed candidate — record and skip rather than throw.
      const id =
        typeof (raw as Record<string, unknown>)?.["candidateId"] === "string"
          ? (raw as Record<string, unknown>)["candidateId"] as string
          : "unknown";
      rejected.push({
        candidateId: id,
        reason: "Candidate failed schema validation",
        candidate: raw as CandidateFinding,
      });
      continue;
    }

    if (!changedPaths.has(candidate.affectedPath)) {
      rejected.push({
        candidateId: candidate.candidateId,
        reason: "path_not_in_snapshot",
        candidate,
      });
      continue;
    }

    if (
      candidate.runId !== input.snapshot.runId ||
      candidate.headCommit !== input.snapshot.headCommit
    ) {
      rejected.push({
        candidateId: candidate.candidateId,
        reason: "Candidate belongs to another run or commit",
        candidate,
      });
      continue;
    }

    const key = JSON.stringify([
      candidate.affectedPath,
      candidate.lineRange ?? null,
      candidate.underlyingCause,
      candidate.affectedBehavior,
    ]);

    const group = groups.get(key);

    if (group) {
      group.duplicateIds.push(candidate.candidateId);
    } else {
      groups.set(key, {
        primary: candidate,
        duplicateIds: [],
      });
    }
  }

  const findings: Finding[] = [];

  for (const { primary, duplicateIds } of groups.values()) {
    const relevantEvidence = primary.evidenceIds
      .map((id) => evidence.get(id))
      .filter((record): record is EvidenceRecord => Boolean(
        record &&
        record.runId === input.snapshot.runId &&
        record.snapshotId === input.snapshot.snapshotId &&
        record.commit === input.snapshot.headCommit &&
        record.path === primary.affectedPath &&
        record.extractionQuality !== "failed" &&
        record.excerpt,
      ));

    const timestamp = new Date().toISOString();

    // A finding is confirmed when:
    //  - The candidate carries medium or high confidence, AND
    //  - If evidence IDs were supplied, at least one resolves to a valid snapshot-bound record.
    //    A candidate that names evidence which can't be found cannot be confirmed.
    // Low-confidence candidates remain unresolved regardless of evidence.
    const hasUnresolvableEvidence =
      primary.evidenceIds.length > 0 && relevantEvidence.length === 0;

    const isConfirmed = primary.confidence !== "low" && !hasUnresolvableEvidence;

    const validationStatus = isConfirmed ? "confirmed" : "unresolved";

    const explanation = relevantEvidence.length === 0
      ? primary.confidence === "low"
        ? "Low-confidence candidate: no evidence and insufficient confidence to confirm."
        : "No usable, snapshot-bound source evidence was supplied; confirmation " +
          "is based solely on candidate confidence and affected-path presence."
      : "The referenced source evidence is present and the candidate confidence " +
        "supports this finding.";

    findings.push(Finding.parse({
      schemaVersion: "1.0.0",
      findingId: randomUUID(),
      candidateId: primary.candidateId,
      runId: primary.runId,
      createdAt: primary.createdAt,
      validatedAt: timestamp,
      provenance: {
        source: "review/validation/validator",
        runId: primary.runId,
        createdAt: timestamp,
      },
      validationStatus,
      validationRationale: explanation,
      claim: primary.claim,
      affectedPath: primary.affectedPath,
      headCommit: primary.headCommit,
      ...(primary.lineRange ? { lineRange: primary.lineRange } : {}),
      failureScenario: primary.failureScenario,
      observedBehavior: primary.observedBehavior,
      expectedBehavior: primary.expectedBehavior,
      expectedBehaviorSource: primary.expectedBehaviorSource,
      evidenceIds: relevantEvidence.map((record) => record.evidenceId),
      severity: primary.severity,
      confidence: primary.confidence,
      categories: primary.categories,
      mergeImpact: primary.mergeImpact,
      recommendedNextStep: isConfirmed
        ? primary.recommendedNextStep
        : "Verify this concern against surrounding code and the applicable " +
          `requirements. Suggested investigation: ${primary.recommendedNextStep}`,
      introducedByChange: changedPaths.has(primary.affectedPath),
      deduplicatedFrom: duplicateIds,
    }));
  }

  return { findings, rejected };
}
