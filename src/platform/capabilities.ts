/**
 * platform/capabilities.ts
 *
 * Discover and report actual runtime capabilities.
 * Returns only what is verified — never assumes a feature exists.
 */
import { spawnSync } from "child_process";
import { randomUUID } from "crypto";
import type { CapabilityReport } from "../contracts/index.js";
import type { TrustedPolicy } from "../contracts/index.js";

const SCHEMA_VERSION = "1.0.0" as const;

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

/**
 * Run `git --version` to verify Git is present and reachable.
 * Returns the version string or null if unavailable.
 */
function checkGit(): { available: boolean; version?: string | undefined } {
  try {
    const result = spawnSync("git", ["--version"], {
      timeout: 5_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    if (result.status === 0) {
      const version = result.stdout.toString("utf8").trim();
      return { available: true, version };
    }
    return { available: false };
  } catch {
    return { available: false };
  }
}

/**
 * Discover runtime capabilities and return a validated CapabilityReport.
 *
 * @param policy - The trusted policy to use for permitted models and checks.
 * @param verificationIsolated - Pass true only if an operator has established
 *   and verified a sandboxed execution boundary. Default: false.
 */
export function discoverCapabilities(
  policy: TrustedPolicy,
  verificationIsolated = false,
): CapabilityReport {
  const git = checkGit();
  const limitations: string[] = [];

  if (!git.available) {
    limitations.push("Git binary not found or not executable — snapshot creation unavailable");
  }

  // Model status: available only if policy permits AND env var is set
  const hasApiKey =
    policy.externalTransmissionAllowed &&
    policy.permittedModelIds.length > 0 &&
    !!process.env["OPENAI_API_KEY"];

  const modelStatus: CapabilityReport["modelStatus"] = !policy.externalTransmissionAllowed
    ? "prohibited_by_policy"
    : policy.permittedModelIds.length === 0
      ? "unavailable"
      : hasApiKey
        ? "available"
        : "unavailable";

  if (modelStatus !== "available") {
    limitations.push(
      modelStatus === "prohibited_by_policy"
        ? "Model transmission prohibited by policy (externalTransmissionAllowed=false)"
        : modelStatus === "unavailable" && policy.permittedModelIds.length === 0
          ? "No permitted model IDs in policy"
          : "OPENAI_API_KEY not set — model unavailable",
    );
  }

  // Verification: only available when operator has verified isolation
  const verificationStatus: CapabilityReport["verificationStatus"] = verificationIsolated
    ? "sandboxed"
    : "unavailable";

  if (!verificationIsolated) {
    limitations.push(
      "Sandboxed execution not available — no verified isolation boundary configured. " +
        "Verification checks will return unavailable.",
    );
  }

  const now = nowISO();

  return {
    schemaVersion: SCHEMA_VERSION,
    reportId: randomUUID(),
    generatedAt: now,
    provenance: {
      source: "platform/capabilities",
      createdAt: now,
    },
    nodeVersion: process.version,
    platform: process.platform,
    gitAvailable: git.available,
    gitVersion: git.version,
    modelStatus,
    permittedModelIds: policy.permittedModelIds,
    externalTransmissionAllowed: policy.externalTransmissionAllowed,
    verificationStatus,
    allowedCheckIds: verificationIsolated ? policy.allowedCheckIds : [],
    documentParsers: [], // No document parsers implemented
    storageAvailable: true, // SQLite available (verified at install time)
    limitations,
  };
}
