/**
 * app/run-identity.ts
 *
 * Derives stable run identity from canonical immutable inputs.
 * The same inputs always produce the same runId, enabling idempotent resume.
 *
 * Identity inputs:
 * - Repository canonical path
 * - Base commit (full 40-char SHA)
 * - Head commit (full 40-char SHA)
 * - Comparison strategy ("merge-base" | "direct")
 * - Trusted policy content hash
 * - Engine version (from package.json)
 *
 * Model and prompt versions are recorded separately in stage records,
 * not in the run identity.
 */
import { createHash } from "crypto";

export interface RunIdentityInputs {
  repositoryPath: string;
  baseCommit: string;
  headCommit: string;
  comparisonStrategy: "merge-base" | "direct";
  policyContentHash: string;
  engineVersion: string;
}

/**
 * Derive a stable UUIDv5-like run identifier from canonical inputs.
 * Returns a deterministic lowercase hex string (64 chars) usable as a UUID.
 *
 * Note: this is SHA-256 of a canonical JSON representation, not a true UUIDv5.
 * We format it as a UUID string for compatibility with uuid fields.
 */
export function deriveRunId(inputs: RunIdentityInputs): string {
  const canonical = JSON.stringify({
    repositoryPath: inputs.repositoryPath,
    baseCommit: inputs.baseCommit,
    headCommit: inputs.headCommit,
    comparisonStrategy: inputs.comparisonStrategy,
    policyContentHash: inputs.policyContentHash,
    engineVersion: inputs.engineVersion,
  });

  const hash = createHash("sha256").update(canonical).digest("hex");

  // Format as UUID: 8-4-4-4-12
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    // Set version bits to 5 (SHA-based UUID style)
    "5" + hash.slice(13, 16),
    // Set variant bits
    "8" + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join("-");
}
