/**
 * ports/verification.ts — Interface to request checks via trusted command IDs.
 * Rijin requests; ABY's adapter runs them in an isolated sandbox.
 */
import type { CheckExecution } from "../contracts/index.js";

export interface VerificationRequest {
  runId: string;
  assignmentId?: string;
  /** Allowlisted command identifier — never a raw shell string */
  commandId: string;
  commit: string;
  /** Optional baseline commit for regression comparison */
  baseCommit?: string;
}

export interface VerificationPort {
  /** Returns true if a given check command ID is on the allowlist */
  isCheckAllowed(commandId: string): boolean;

  /** Request execution of an allowlisted check */
  requestCheck(request: VerificationRequest): Promise<CheckExecution>;

  /** Retrieve a previously-run check result */
  getCheck(checkId: string): Promise<CheckExecution | null>;
}
