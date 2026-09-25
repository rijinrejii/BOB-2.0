/**
 * tests/security/platform-security.test.ts
 *
 * Security-focused tests for the platform layer.
 * Required:
 * - Hostile revision/path inputs rejected
 * - Policy changes in PR cannot relax controls
 * - Unsafe dependency installation is denied
 * - Unavailable isolation remains unavailable
 */
import { describe, it, expect } from "vitest";
import { GitAdapter, GitInputError } from "../../src/adapters/git/git-adapter.js";
import { UnavailableExecutionAdapter } from "../../src/adapters/execution/unavailable-execution-adapter.js";
import { loadPolicy, PolicyLoadError } from "../../src/platform/policy.js";
import { resolve } from "path";

describe("Hostile revision inputs are rejected", () => {
  const adapter = new GitAdapter({ repoPath: resolve(process.cwd()) });

  it("rejects option-like revision (--option)", async () => {
    await expect(adapter.createSnapshot("r1", "--option", "HEAD")).rejects.toThrow(GitInputError);
  });

  it("rejects revision with shell special chars ($)", async () => {
    await expect(adapter.createSnapshot("r1", "$HOME", "HEAD")).rejects.toThrow(GitInputError);
  });

  it("rejects revision with command substitution", async () => {
    await expect(adapter.createSnapshot("r1", "$(id)", "HEAD")).rejects.toThrow(GitInputError);
  });

  it("rejects revision with semicolon injection", async () => {
    await expect(adapter.createSnapshot("r1", "HEAD;ls", "HEAD")).rejects.toThrow(GitInputError);
  });

  it("rejects revision with backtick injection", async () => {
    await expect(adapter.createSnapshot("r1", "`id`", "HEAD")).rejects.toThrow(GitInputError);
  });

  it("rejects empty revision", async () => {
    await expect(adapter.createSnapshot("r1", "", "HEAD")).rejects.toThrow(GitInputError);
  });

  it("rejects overly long revision (>256 chars)", async () => {
    await expect(adapter.createSnapshot("r1", "a".repeat(257), "HEAD")).rejects.toThrow(GitInputError);
  });
});

describe("Hostile path inputs are rejected", () => {
  const adapter = new GitAdapter({ repoPath: resolve(process.cwd()) });

  it("rejects absolute path starting with /", async () => {
    const snap = await adapter.createSnapshot("path-test-1", "HEAD", "HEAD");
    await expect(adapter.readFile(snap.snapshotId, "/etc/passwd")).rejects.toThrow(GitInputError);
  });

  it("rejects Windows absolute path with drive letter", async () => {
    const snap = await adapter.createSnapshot("path-test-2", "HEAD", "HEAD");
    await expect(adapter.readFile(snap.snapshotId, "C:/Windows/system.ini")).rejects.toThrow(GitInputError);
  });

  it("rejects path traversal with ..", async () => {
    const snap = await adapter.createSnapshot("path-test-3", "HEAD", "HEAD");
    await expect(adapter.readFile(snap.snapshotId, "../../etc/hosts")).rejects.toThrow(GitInputError);
  });

  it("rejects path with NUL byte", async () => {
    const snap = await adapter.createSnapshot("path-test-4", "HEAD", "HEAD");
    await expect(adapter.readFile(snap.snapshotId, "file\0injected")).rejects.toThrow(GitInputError);
  });
});

describe("Policy cannot be supplied by PR content", () => {
  it("policy load fails closed for untrusted paths without valid content", () => {
    // Attempt to load a policy from a non-existent path — must fail closed
    expect(() => loadPolicy("/nonexistent/policy.json")).toThrow(PolicyLoadError);
  });

  it("policy with missing required fields fails closed", () => {
    const { writeFileSync, unlinkSync } = require("fs");
    const { tmpdir } = require("os");
    const { join } = require("path");
    const tmpPath = join(tmpdir(), "bad-pr-policy.json");
    try {
      // Simulate PR-supplied policy that attempts to enable external transmission
      // but is missing required fields — must fail closed
      writeFileSync(tmpPath, JSON.stringify({
        schemaVersion: "1.0.0",
        externalTransmissionAllowed: true,
        // Missing: permittedModelIds, allowedCheckIds, etc.
      }));
      expect(() => loadPolicy(tmpPath)).toThrow(PolicyLoadError);
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  });
});

describe("Unsafe dependency installation is denied", () => {
  it("UnavailableExecutionAdapter never executes commands", async () => {
    const adapter = new UnavailableExecutionAdapter();
    // Even if someone tries to run npm install via the verification adapter
    const result = await adapter.requestCheck({
      runId: "security-test",
      commandId: "npm:install",
      commit: "a".repeat(40),
    });
    expect(result.outcome).toBe("unavailable");
  });

  it("no check commands are allowed when isolation is unverified", () => {
    const adapter = new UnavailableExecutionAdapter();
    // Common injection attempts via commandId
    const malicious = [
      "npm install && rm -rf /",
      "; cat /etc/passwd",
      "../../../bin/sh",
      "$(whoami)",
    ];
    for (const cmd of malicious) {
      expect(adapter.isCheckAllowed(cmd)).toBe(false);
    }
  });
});

describe("Metadata path traversal is rejected", () => {
  it("FileMetadataAdapter rejects path with traversal", async () => {
    const { FileMetadataAdapter } = await import("../../src/adapters/metadata/file-metadata-adapter.js");
    const adapter = new FileMetadataAdapter();
    await expect(adapter.loadRaw("/safe/../../etc/passwd")).rejects.toThrow();
  });
});
