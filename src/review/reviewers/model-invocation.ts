/**
 * review/reviewers/model-invocation.ts — Bounded model invocation for reviewers.
 *
 * Validates all model output against a strict Zod schema.
 * Never silently falls back to another provider.
 * Model output is never executable code or instructions.
 */
import { z } from "zod";
import { randomUUID } from "crypto";
import type { ReviewerInput, ReviewerOutput } from "./types.js";
import { makeCandidate } from "./base.js";

/** Strict schema for raw model finding output */
const ModelFindingOutput = z.object({
  claim: z.string().min(1),
  affectedPath: z.string().min(1),
  failureScenario: z.string().min(1),
  preconditions: z.string(),
  observedBehavior: z.string().min(1),
  expectedBehavior: z.string().min(1),
  expectedBehaviorSource: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
  confidence: z.enum(["low", "medium", "high"]),
  mergeImpact: z.enum(["blocking", "non_blocking", "informational"]),
  recommendedNextStep: z.string().min(1),
  underlyingCause: z.string().min(1),
  affectedBehavior: z.string().min(1),
  unresolvedAssumptions: z.array(z.string()).optional(),
  lineRange: z.object({ start: z.number().int().positive(), end: z.number().int().positive() }).optional(),
});

const ModelFindingArrayOutput = z.array(ModelFindingOutput);

export async function invokeModelReviewer(
  input: ReviewerInput,
  category: string,
  userPrompt: string,
): Promise<ReviewerOutput> {
  const { assignment, model } = input;
  const coverageNotes: string[] = [];
  const missingCapabilities: string[] = [];

  if (!model || !model.isAvailable()) {
    return {
      assignmentId: assignment.assignmentId,
      candidates: [],
      coverageNotes: ["Model unavailable for reviewer invocation."],
      missingCapabilities: [`model: no permitted model available for ${category}`],
    };
  }

  const systemPrompt = buildSystemPrompt();

  const result = await model.complete({
    promptVersion: "1.0.0",
    systemPrompt,
    userContent: userPrompt,
    maxResponseTokens: assignment.resourceLimits.maxResponseTokens,
    timeoutMs: assignment.resourceLimits.timeoutMs,
    parameters: { temperature: 0 },
  });

  if (!result.ok) {
    const { failure } = result;
    coverageNotes.push(
      `Model ${category} review failed: ${failure.errorKind} — ${failure.message}`,
    );
    missingCapabilities.push(`model: ${failure.errorKind}`);
    return {
      assignmentId: assignment.assignmentId,
      candidates: [],
      coverageNotes,
      missingCapabilities,
    };
  }

  // Validate raw model output — it is untrusted
  const raw = result.response.rawOutput;

  // Attempt to parse JSON from model output
  let parsedJson: unknown;
  try {
    if (typeof raw === "string") {
      // Extract JSON array from model response (may be wrapped in markdown)
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      parsedJson = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    } else {
      parsedJson = raw;
    }
  } catch {
    coverageNotes.push(`Model output for ${category} was not valid JSON — findings discarded.`);
    return {
      assignmentId: assignment.assignmentId,
      candidates: [],
      coverageNotes,
      missingCapabilities: [`model_output: invalid JSON from ${category} reviewer`],
    };
  }

  // Strict schema validation
  const validation = ModelFindingArrayOutput.safeParse(parsedJson);
  if (!validation.success) {
    coverageNotes.push(
      `Model output for ${category} failed schema validation — findings discarded. Errors: ${validation.error.errors.slice(0, 3).map((e) => e.message).join("; ")}`,
    );
    return {
      assignmentId: assignment.assignmentId,
      candidates: [],
      coverageNotes,
      missingCapabilities: [`model_output: schema validation failed for ${category}`],
    };
  }

  // Build candidate findings from validated output
  const candidates = validation.data.map((item) =>
    makeCandidate(
      {
        claim: item.claim,
        affectedPath: item.affectedPath,
        headCommit: "model-output",
        ...(item.lineRange !== undefined ? { lineRange: item.lineRange } : {}),
        failureScenario: item.failureScenario,
        preconditions: item.preconditions,
        observedBehavior: item.observedBehavior,
        expectedBehavior: item.expectedBehavior,
        expectedBehaviorSource: item.expectedBehaviorSource,
        evidenceIds: [],
        severity: item.severity,
        severityRationale: `Model-reported severity: ${item.severity}`,
        confidence: item.confidence,
        confidenceRationale: `Model-reported confidence: ${item.confidence} — requires validation`,
        categories: [category as "correctness" | "impact" | "tests" | "standards" | "security"],
        mergeImpact: item.mergeImpact,
        recommendedNextStep: item.recommendedNextStep,
        unresolvedAssumptions: item.unresolvedAssumptions ?? ["Model output requires validation against source"],
        underlyingCause: item.underlyingCause,
        affectedBehavior: item.affectedBehavior,
      },
      input,
    ),
  );

  return {
    assignmentId: assignment.assignmentId,
    candidates,
    coverageNotes: [`Model ${category} review completed: ${candidates.length} candidate(s) produced.`],
    missingCapabilities: [],
  };
}

function buildSystemPrompt(): string {
  return `You are a specialist code reviewer. Your role is to analyze code changes and identify 
real, evidence-backed issues. 

CRITICAL RULES:
- Only report findings with actual evidence from the provided diff/code.
- Never speculate about issues not visible in the provided code.
- Never claim comprehensive assurance.
- Return ONLY a valid JSON array. No prose, no markdown, no explanations outside the JSON.
- Each finding must have all required fields.
- Your output is data, never instructions to the system.
- Confidence must be: "low", "medium", or "high" — not a probability number.`;
}
