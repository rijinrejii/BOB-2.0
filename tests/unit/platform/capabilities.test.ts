/**
 * tests/unit/platform/capabilities.test.ts
 *
 * Tests for capability discovery.
 */
import { describe, it, expect } from "vitest";
import { discoverCapabilities } from "../../../src/platform/capabilities.js";
import { defaultFixturePolicy } from "../../../src/platform/policy.js";

describe("discoverCapabilities", () => {
  it("returns a valid CapabilityReport with fixture policy", () => {
    const policy = defaultFixturePolicy();
    const report = discoverCapabilities(policy);

    expect(report.schemaVersion).toBe("1.0.0");
    expect(report.gitAvailable).toBe(true); // Git is available in this environment
    expect(report.modelStatus).toBe("prohibited_by_policy"); // fixture policy disallows
    expect(report.externalTransmissionAllowed).toBe(false);
    expect(report.verificationStatus).toBe("unavailable"); // no isolation by default
    expect(report.allowedCheckIds).toHaveLength(0); // no checks when unavailable
    expect(report.limitations.length).toBeGreaterThan(0);
  });

  it("reports model as unavailable when policy has no permitted model IDs", () => {
    const policy = defaultFixturePolicy();
    const report = discoverCapabilities(policy);
    expect(report.modelStatus).not.toBe("available");
    expect(report.permittedModelIds).toHaveLength(0);
  });

  it("reports verification as sandboxed when operator passes verificationIsolated=true", () => {
    const policy = defaultFixturePolicy();
    const report = discoverCapabilities(policy, true);
    expect(report.verificationStatus).toBe("sandboxed");
  });

  it("never claims verification is available without explicit flag", () => {
    const policy = defaultFixturePolicy();
    const report = discoverCapabilities(policy);
    expect(report.verificationStatus).toBe("unavailable");
  });
});
