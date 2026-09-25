/**
 * platform/policy.ts
 *
 * Load and runtime-validate TrustedPolicy from an administrator-controlled
 * path. Fails closed on any validation error — no partial or defaulted policy.
 *
 * Security invariants:
 * - Policy is loaded from an explicit operator-provided path only.
 * - PR content and head-commit content cannot supply or modify policy.
 * - Invalid policy causes an immediate hard failure.
 * - Policy loaded from this module is always fully validated.
 */
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { randomUUID } from "crypto";
import { z } from "zod";
import { TrustedPolicy } from "../contracts/index.js";

const SCHEMA_VERSION = "1.0.0" as const;

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export class PolicyLoadError extends Error {
  override name = "PolicyLoadError";
}

/**
 * Policy file on disk (raw, before injecting computed fields).
 * The `schemaVersion` in the file must be "1.0.0".
 */
const PolicyFileSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  externalTransmissionAllowed: z.boolean(),
  permittedModelIds: z.array(z.string()),
  allowedCheckIds: z.array(z.string()),
  maxContextFiles: z.number().int().positive(),
  maxFileSizeBytes: z.number().int().positive(),
  maxDependencyDepth: z.number().int().nonnegative(),
  patchProposalsEnabled: z.boolean(),
  incrementalReuseEnabled: z.boolean(),
  additionalMandatoryRiskPatterns: z.array(z.string()),
});

/**
 * Load TrustedPolicy from a JSON file at `policyPath`.
 *
 * Hard failures:
 * - File not found or unreadable.
 * - File is not valid JSON.
 * - File fails schema validation.
 *
 * Returns a fully validated TrustedPolicy record with computed fields
 * (policyId, loadedAt, contentHash, provenance).
 */
export function loadPolicy(policyPath: string): TrustedPolicy {
  let raw: string;
  try {
    raw = readFileSync(policyPath, "utf8");
  } catch (err) {
    throw new PolicyLoadError(
      `Policy file unreadable at ${policyPath}: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PolicyLoadError(`Policy file is not valid JSON: ${policyPath}`);
  }

  const result = PolicyFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new PolicyLoadError(
      `Policy file failed validation at ${policyPath}:\n${issues}`,
    );
  }

  const data = result.data;
  const contentHash = createHash("sha256").update(raw).digest("hex");
  const now = nowISO();

  const policy: TrustedPolicy = {
    schemaVersion: SCHEMA_VERSION,
    policyId: randomUUID(),
    loadedAt: now,
    provenance: {
      source: policyPath,
      createdAt: now,
    },
    contentHash: contentHash as `${string}`,
    externalTransmissionAllowed: data.externalTransmissionAllowed,
    permittedModelIds: data.permittedModelIds,
    allowedCheckIds: data.allowedCheckIds,
    maxContextFiles: data.maxContextFiles,
    maxFileSizeBytes: data.maxFileSizeBytes,
    maxDependencyDepth: data.maxDependencyDepth,
    patchProposalsEnabled: data.patchProposalsEnabled,
    incrementalReuseEnabled: data.incrementalReuseEnabled,
    additionalMandatoryRiskPatterns: data.additionalMandatoryRiskPatterns,
  };

  // Final validation of the complete record
  const final = TrustedPolicy.safeParse(policy);
  if (!final.success) {
    throw new PolicyLoadError(
      `Assembled TrustedPolicy failed contract validation: ${final.error.message}`,
    );
  }

  return final.data;
}

/**
 * Default policy for use in fixture/test mode only.
 * Must not be used in production — it disables all external capabilities.
 */
export function defaultFixturePolicy(): TrustedPolicy {
  const raw = JSON.stringify({
    schemaVersion: "1.0.0",
    externalTransmissionAllowed: false,
    permittedModelIds: [],
    allowedCheckIds: [],
    maxContextFiles: 50,
    maxFileSizeBytes: 100_000,
    maxDependencyDepth: 2,
    patchProposalsEnabled: false,
    incrementalReuseEnabled: false,
    additionalMandatoryRiskPatterns: [],
  });

  const contentHash = createHash("sha256").update(raw).digest("hex");
  const now = nowISO();

  return {
    schemaVersion: SCHEMA_VERSION,
    policyId: randomUUID(),
    loadedAt: now,
    provenance: {
      source: "fixture-default",
      createdAt: now,
    },
    contentHash: contentHash as `${string}`,
    externalTransmissionAllowed: false,
    permittedModelIds: [],
    allowedCheckIds: [],
    maxContextFiles: 50,
    maxFileSizeBytes: 100_000,
    maxDependencyDepth: 2,
    patchProposalsEnabled: false,
    incrementalReuseEnabled: false,
    additionalMandatoryRiskPatterns: [],
  };
}
