/**
 * tests/unit/adapters/git-adapter.test.ts
 *
 * Tests for Git adapter security and correctness.
 * Required: hostile revision inputs, path traversal rejection.
 * Uses this repository as a test fixture for real git operations.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { GitAdapter, GitInputError } from "../../../src/adapters/git/git-adapter.js";

// Use the review-copilot repository itself for real git tests
const REPO_PATH = resolve(process.cwd());

describe("GitAdapter — revision input validation", () => {
  it("rejects empty revision", async () => {
    const adapter = new GitAdapter({ repoPath: REPO_PATH });
    await expect(adapter.createSnapshot("run-1", "", "HEAD")).rejects.toThrow(GitInputError);
  });

  it("rejects revision starting with dash (option injection)", async () => {
    const adapter = new GitAdapter({ repoPath: REPO_PATH });
    await expect(adapter.createSnapshot("run-1", "--evil", "HEAD")).rejects.toThrow(GitInputError);
  });

  it("rejects revision with disallowed special characters", async () => {
    const adapter = new GitAdapter({ repoPath: REPO_PATH });
    await expect(adapter.createSnapshot("run-1", "HEAD; rm -rf /", "HEAD")).rejects.toThrow(GitInputError);
  });

  it("rejects revision with shell metacharacters", async () => {
    const adapter = new GitAdapter({ repoPath: REPO_PATH });
    await expect(adapter.createSnapshot("run-1", "$(whoami)", "HEAD")).rejects.toThrow(GitInputError);
  });
});

describe("GitAdapter — path validation", () => {
  it("rejects absolute path in readFile", async () => {
    const adapter = new GitAdapter({ repoPath: REPO_PATH });
    // Create a fake snapshot to test path validation
    const snap = await adapter.createSnapshot("run-1", "HEAD", "HEAD");
    await expect(adapter.readFile(snap.snapshotId, "/etc/passwd")).rejects.toThrow(GitInputError);
  });

  it("rejects path traversal in readFile", async () => {
    const adapter = new GitAdapter({ repoPath: REPO_PATH });
    const snap = await adapter.createSnapshot("run-2", "HEAD", "HEAD");
    await expect(adapter.readFile(snap.snapshotId, "../../../etc/passwd")).rejects.toThrow(GitInputError);
  });

  it("rejects path with NUL byte", async () => {
    const adapter = new GitAdapter({ repoPath: REPO_PATH });
    const snap = await adapter.createSnapshot("run-3", "HEAD", "HEAD");
    await expect(adapter.readFile(snap.snapshotId, "file\0.txt")).rejects.toThrow(GitInputError);
  });
});

describe("GitAdapter — snapshot creation", () => {
  it("resolves HEAD to a full 40-char commit SHA", async () => {
    const adapter = new GitAdapter({ repoPath: REPO_PATH });
    const snapshot = await adapter.createSnapshot("run-snap-1", "HEAD", "HEAD");
    expect(snapshot.baseCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(snapshot.headCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(snapshot.immutable).toBe(true);
    expect(snapshot.snapshotDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the cached snapshot via getSnapshot", async () => {
    const adapter = new GitAdapter({ repoPath: REPO_PATH });
    const snap1 = await adapter.createSnapshot("run-snap-2", "HEAD", "HEAD");
    const snap2 = await adapter.getSnapshot("run-snap-2");
    expect(snap1.snapshotId).toBe(snap2.snapshotId);
  });

  it("throws for unknown runId in getSnapshot", async () => {
    const adapter = new GitAdapter({ repoPath: REPO_PATH });
    await expect(adapter.getSnapshot("nonexistent-run")).rejects.toThrow();
  });
});

describe("GitAdapter — evidence port", () => {
  it("stores and retrieves evidence", async () => {
    const adapter = new GitAdapter({ repoPath: REPO_PATH });
    const record = {
      schemaVersion: "1.0.0" as const,
      evidenceId: "ev-1",
      runId: "run-ev-1",
      snapshotId: "snap-1",
      createdAt: "2024-01-01T00:00:00.000Z",
      provenance: { source: "test", createdAt: "2024-01-01T00:00:00.000Z" },
      kind: "source_file" as const,
      summary: "Test evidence",
    };
    await adapter.storeEvidence(record);
    const retrieved = await adapter.getEvidence("ev-1");
    expect(retrieved?.evidenceId).toBe("ev-1");
  });

  it("returns null for missing evidence", async () => {
    const adapter = new GitAdapter({ repoPath: REPO_PATH });
    expect(await adapter.getEvidence("nonexistent")).toBeNull();
  });

  it("retrieves all evidence for a run", async () => {
    const adapter = new GitAdapter({ repoPath: REPO_PATH });
    const makeRec = (id: string, runId: string) => ({
      schemaVersion: "1.0.0" as const,
      evidenceId: id,
      runId,
      snapshotId: "snap-1",
      createdAt: "2024-01-01T00:00:00.000Z",
      provenance: { source: "test", createdAt: "2024-01-01T00:00:00.000Z" },
      kind: "diff_hunk" as const,
      summary: "test",
    });
    await adapter.storeEvidence(makeRec("ev-a", "run-multi"));
    await adapter.storeEvidence(makeRec("ev-b", "run-multi"));
    await adapter.storeEvidence(makeRec("ev-c", "run-other"));
    const result = await adapter.getEvidenceForRun("run-multi");
    expect(result).toHaveLength(2);
  });
});
