/**
 * check.ts — CheckExecution: result of a sandboxed verification command.
 * ABY produces these; Rijin reads them for validation.
 */
import { z } from "zod";
import { ISOTimestamp, SemVer, CommitSha, Provenance } from "./common.js";

export const CheckOutcome = z.enum([
  "pass",
  "fail",
  "error",
  "timeout",
  "unavailable",
  "policy_denied",
]);
export type CheckOutcome = z.infer<typeof CheckOutcome>;

export const CheckFailureKind = z.enum([
  "code_failure",
  "infrastructure_failure",
  "dependency_failure",
  "policy_denial",
  "timeout",
  "unavailable_execution",
]);
export type CheckFailureKind = z.infer<typeof CheckFailureKind>;

export const CheckExecution = z.object({
  schemaVersion: SemVer,
  checkId: z.string().uuid(),
  runId: z.string().uuid(),
  assignmentId: z.string().uuid().optional(),
  createdAt: ISOTimestamp,
  completedAt: ISOTimestamp.optional(),
  provenance: Provenance,

  /** Allowlisted command identifier, never a raw shell string */
  commandId: z.string(),
  commit: CommitSha,

  outcome: CheckOutcome,
  failureKind: CheckFailureKind.optional(),
  exitCode: z.number().int().optional(),
  stdoutDigest: z.string().optional(),
  stderrDigest: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),

  /** Base-commit equivalent execution ID for regression comparison */
  baselineCheckId: z.string().uuid().optional(),

  /** Attribution certainty when comparing to baseline */
  regressionAttribution: z.enum(["confirmed_regression", "possible_regression", "pre_existing", "unknown"]).optional(),
});
export type CheckExecution = z.infer<typeof CheckExecution>;
