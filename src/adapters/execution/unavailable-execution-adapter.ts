/**
 * adapters/execution/unavailable-execution-adapter.ts
 *
 * Verification adapter that always returns `unavailable`.
 *
 * Sandboxed execution requires:
 * - Ephemeral execution environment
 * - Restricted filesystem
 * - No host credentials
 * - No privileged execution
 * - No host container socket
 * - Resource and time limits
 * - Networking disabled by default
 *
 * None of these restrictions can be enforced in the current environment.
 * This adapter returns `unavailable` with a recorded reason instead of
 * silently executing in an unsandboxed context.
 *
 * Operator path: replace this adapter with a verified sandboxed runner
 * (e.g., Docker with --no-new-privileges, --read-only, --network=none)
 * once the isolation boundary has been established and verified.
 */
import { randomUUID } from "crypto";
import type { VerificationPort, VerificationRequest } from "../../ports/verification.js";
import type { CheckExecution } from "../../contracts/index.js";

const SCHEMA_VERSION = "1.0.0" as const;
const UNAVAILABLE_REASON =
  "Sandboxed execution is not available: no verified isolation boundary " +
  "(ephemeral environment, restricted filesystem, no host credentials, " +
  "no privileged execution, no host container socket, resource limits, " +
  "and disabled networking) has been configured. " +
  "Operator action required to enable verification.";

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export class UnavailableExecutionAdapter implements VerificationPort {
  isCheckAllowed(_commandId: string): boolean {
    // No checks are allowed when isolation is unavailable.
    return false;
  }

  async requestCheck(request: VerificationRequest): Promise<CheckExecution> {
    const now = nowISO();
    return {
      schemaVersion: SCHEMA_VERSION,
      checkId: randomUUID(),
      runId: request.runId,
      assignmentId: request.assignmentId,
      createdAt: now,
      completedAt: now,
      provenance: {
        source: "unavailable-execution-adapter",
        runId: request.runId,
        createdAt: now,
      },
      commandId: request.commandId,
      commit: request.commit,
      outcome: "unavailable",
      failureKind: "unavailable_execution",
      durationMs: 0,
    };
  }

  async getCheck(_checkId: string): Promise<CheckExecution | null> {
    return null;
  }

  /** Human-readable explanation for why verification is unavailable. */
  get unavailableReason(): string {
    return UNAVAILABLE_REASON;
  }
}
