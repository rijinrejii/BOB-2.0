/**
 * tests/unit/platform/policy.test.ts
 *
 * Tests for the trusted policy loader.
 * Required: invalid configuration fails closed.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadPolicy, PolicyLoadError, defaultFixturePolicy } from "../../../src/platform/policy.js";

const TMP = join(tmpdir(), "review-copilot-tests");
mkdirSync(TMP, { recursive: true });

function writeTmpFile(name: string, content: string): string {
  const path = join(TMP, name);
  writeFileSync(path, content, "utf8");
  return path;
}

function removeTmpFile(path: string): void {
  try { unlinkSync(path); } catch { /* ignore */ }
}

describe("loadPolicy", () => {
  it("loads a valid policy file", () => {
    const content = JSON.stringify({
      schemaVersion: "1.0.0",
      externalTransmissionAllowed: false,
      permittedModelIds: [],
      allowedCheckIds: [],
      maxContextFiles: 10,
      maxFileSizeBytes: 50000,
      maxDependencyDepth: 1,
      patchProposalsEnabled: false,
      incrementalReuseEnabled: false,
      additionalMandatoryRiskPatterns: [],
    });
    const path = writeTmpFile("valid-policy.json", content);
    try {
      const policy = loadPolicy(path);
      expect(policy.schemaVersion).toBe("1.0.0");
      expect(policy.externalTransmissionAllowed).toBe(false);
      expect(policy.maxContextFiles).toBe(10);
      expect(policy.contentHash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      removeTmpFile(path);
    }
  });

  it("fails closed when file does not exist", () => {
    expect(() => loadPolicy("/nonexistent/path/policy.json")).toThrow(PolicyLoadError);
  });

  it("fails closed when file is not valid JSON", () => {
    const path = writeTmpFile("bad-policy.json", "{ this is not json }");
    try {
      expect(() => loadPolicy(path)).toThrow(PolicyLoadError);
    } finally {
      removeTmpFile(path);
    }
  });

  it("fails closed when required fields are missing", () => {
    const path = writeTmpFile("incomplete-policy.json", JSON.stringify({
      schemaVersion: "1.0.0",
      // missing externalTransmissionAllowed and others
    }));
    try {
      expect(() => loadPolicy(path)).toThrow(PolicyLoadError);
    } finally {
      removeTmpFile(path);
    }
  });

  it("fails closed when schemaVersion is wrong", () => {
    const path = writeTmpFile("wrong-version-policy.json", JSON.stringify({
      schemaVersion: "2.0.0",
      externalTransmissionAllowed: false,
      permittedModelIds: [],
      allowedCheckIds: [],
      maxContextFiles: 10,
      maxFileSizeBytes: 50000,
      maxDependencyDepth: 1,
      patchProposalsEnabled: false,
      incrementalReuseEnabled: false,
      additionalMandatoryRiskPatterns: [],
    }));
    try {
      expect(() => loadPolicy(path)).toThrow(PolicyLoadError);
    } finally {
      removeTmpFile(path);
    }
  });

  it("does not allow negative maxContextFiles", () => {
    const path = writeTmpFile("negative-files-policy.json", JSON.stringify({
      schemaVersion: "1.0.0",
      externalTransmissionAllowed: false,
      permittedModelIds: [],
      allowedCheckIds: [],
      maxContextFiles: -5,
      maxFileSizeBytes: 50000,
      maxDependencyDepth: 1,
      patchProposalsEnabled: false,
      incrementalReuseEnabled: false,
      additionalMandatoryRiskPatterns: [],
    }));
    try {
      expect(() => loadPolicy(path)).toThrow(PolicyLoadError);
    } finally {
      removeTmpFile(path);
    }
  });
});

describe("defaultFixturePolicy", () => {
  it("returns a valid policy with no external transmission", () => {
    const policy = defaultFixturePolicy();
    expect(policy.externalTransmissionAllowed).toBe(false);
    expect(policy.permittedModelIds).toHaveLength(0);
    expect(policy.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
