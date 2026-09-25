/**
 * tests/unit/app/run-identity.test.ts
 *
 * Tests for stable run identity derivation.
 */
import { describe, it, expect } from "vitest";
import { deriveRunId } from "../../../src/app/run-identity.js";

describe("deriveRunId", () => {
  it("produces a UUID-formatted string", () => {
    const id = deriveRunId({
      repositoryPath: "/repo",
      baseCommit: "a".repeat(40),
      headCommit: "b".repeat(40),
      comparisonStrategy: "merge-base",
      policyContentHash: "c".repeat(64),
      engineVersion: "0.1.0",
    });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("is deterministic — same inputs produce same ID", () => {
    const inputs = {
      repositoryPath: "/my/repo",
      baseCommit: "0".repeat(40),
      headCommit: "1".repeat(40),
      comparisonStrategy: "merge-base" as const,
      policyContentHash: "a".repeat(64),
      engineVersion: "0.1.0",
    };
    expect(deriveRunId(inputs)).toBe(deriveRunId(inputs));
  });

  it("different inputs produce different IDs", () => {
    const base = {
      repositoryPath: "/repo",
      baseCommit: "0".repeat(40),
      headCommit: "1".repeat(40),
      comparisonStrategy: "merge-base" as const,
      policyContentHash: "a".repeat(64),
      engineVersion: "0.1.0",
    };
    const other = { ...base, headCommit: "2".repeat(40) };
    expect(deriveRunId(base)).not.toBe(deriveRunId(other));
  });

  it("different policy hashes produce different IDs", () => {
    const base = {
      repositoryPath: "/repo",
      baseCommit: "0".repeat(40),
      headCommit: "1".repeat(40),
      comparisonStrategy: "merge-base" as const,
      policyContentHash: "a".repeat(64),
      engineVersion: "0.1.0",
    };
    const other = { ...base, policyContentHash: "b".repeat(64) };
    expect(deriveRunId(base)).not.toBe(deriveRunId(other));
  });
});
