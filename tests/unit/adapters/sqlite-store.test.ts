/**
 * tests/unit/adapters/sqlite-store.test.ts
 *
 * Tests for SQLite persistence:
 * - Snapshot consistency
 * - Interrupted run recovery
 * - Concurrent resume protection
 * - Stage transition invariants
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../../../src/adapters/sqlite/sqlite-store.js";

function makeStore(): SqliteStore {
  return new SqliteStore({ databasePath: ":memory:" });
}

describe("SqliteStore — kv operations", () => {
  let store: SqliteStore;
  beforeEach(() => { store = makeStore(); });
  afterEach(() => { store.close(); });

  it("puts and gets a record", async () => {
    await store.put("test", "id1", { value: 42 });
    const result = await store.get("test", "id1");
    expect(result).toEqual({ value: 42 });
  });

  it("returns null for missing record", async () => {
    const result = await store.get("test", "missing");
    expect(result).toBeNull();
  });

  it("overwrites on duplicate put", async () => {
    await store.put("test", "id1", { value: 1 });
    await store.put("test", "id1", { value: 2 });
    const result = await store.get("test", "id1");
    expect(result).toEqual({ value: 2 });
  });

  it("queries by field", async () => {
    await store.put("runs", "r1", { runId: "r1", status: "running" });
    await store.put("runs", "r2", { runId: "r2", status: "completed" });
    const running = await store.query("runs", "status", "running");
    expect(running).toHaveLength(1);
    expect((running[0] as { runId: string }).runId).toBe("r1");
  });

  it("deletes a record", async () => {
    await store.put("test", "id1", { value: 1 });
    await store.delete("test", "id1");
    const result = await store.get("test", "id1");
    expect(result).toBeNull();
  });
});

describe("SqliteStore — run lifecycle", () => {
  let store: SqliteStore;
  beforeEach(() => { store = makeStore(); });
  afterEach(() => { store.close(); });

  it("upserts and retrieves a run", () => {
    store.upsertRun({
      runId: "run-1",
      status: "running",
      stage: "intake",
      fixtureMode: true,
      data: { note: "test" },
    });
    const run = store.getRun("run-1");
    expect(run).not.toBeNull();
    expect(run?.status).toBe("running");
    expect(run?.stage).toBe("intake");
    expect(run?.fixtureMode).toBe(true);
  });

  it("returns null for missing run", () => {
    expect(store.getRun("nonexistent")).toBeNull();
  });

  it("advances stage successfully when preconditions match", () => {
    store.upsertRun({ runId: "run-2", status: "running", stage: "intake", fixtureMode: false, data: {} });
    const ok = store.advanceStage("run-2", "intake", "context_collection", "running", { stage: "context_collection" });
    expect(ok).toBe(true);
    expect(store.getRun("run-2")?.stage).toBe("context_collection");
  });

  it("refuses stage advance when current stage does not match", () => {
    store.upsertRun({ runId: "run-3", status: "running", stage: "planning", fixtureMode: false, data: {} });
    const ok = store.advanceStage("run-3", "intake", "context_collection", "running", {});
    expect(ok).toBe(false);
    // Stage unchanged
    expect(store.getRun("run-3")?.stage).toBe("planning");
  });

  it("marks interrupted runs", () => {
    store.upsertRun({ runId: "run-a", status: "running", stage: "review", fixtureMode: false, data: {} });
    store.upsertRun({ runId: "run-b", status: "running", stage: "planning", fixtureMode: false, data: {} });
    const count = store.markInterruptedRuns();
    expect(count).toBe(2);
    expect(store.getRun("run-a")?.status).toBe("interrupted");
    expect(store.getRun("run-b")?.status).toBe("interrupted");
  });

  it("marks interrupted runs except current", () => {
    store.upsertRun({ runId: "run-a", status: "running", stage: "review", fixtureMode: false, data: {} });
    store.upsertRun({ runId: "run-b", status: "running", stage: "planning", fixtureMode: false, data: {} });
    store.markInterruptedRuns("run-a");
    expect(store.getRun("run-a")?.status).toBe("running");
    expect(store.getRun("run-b")?.status).toBe("interrupted");
  });

  it("appends and retrieves audit log entries", () => {
    store.upsertRun({ runId: "run-audit", status: "running", stage: "intake", fixtureMode: false, data: {} });
    store.appendAuditLog({ runId: "run-audit", eventType: "stage_advanced", actor: "coordinator", payload: { from: "intake" } });
    store.appendAuditLog({ runId: "run-audit", eventType: "stage_advanced", actor: "coordinator", payload: { from: "context_collection" } });
    const log = store.getAuditLog("run-audit");
    expect(log).toHaveLength(2);
    expect(log[0]?.eventType).toBe("stage_advanced");
  });

  it("listRuns returns recent runs with correct fields", () => {
    store.upsertRun({ runId: "run-list-1", status: "completed", stage: "completed", fixtureMode: false, data: {} });
    store.upsertRun({ runId: "run-list-2", status: "running", stage: "review", fixtureMode: true, data: {} });
    const runs = store.listRuns(10);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    // Both runs should appear
    const ids = runs.map((r) => r.runId);
    expect(ids).toContain("run-list-1");
    expect(ids).toContain("run-list-2");
  });
});

describe("SqliteStore — path validation", () => {
  it("rejects non-absolute database paths", () => {
    expect(() => new SqliteStore({ databasePath: "relative/path.db" })).toThrow();
  });

  it("rejects path traversal in database path", () => {
    expect(() => new SqliteStore({ databasePath: "/valid/../traversal.db" })).toThrow();
  });

  it("resolveStorePath appends db filename to a valid path", () => {
    // resolveStorePath resolves relative paths to absolute; it only rejects
    // paths where the resolved absolute path still contains '..'
    const path = SqliteStore.resolveStorePath(undefined);
    expect(path).toMatch(/review-copilot\.db$/);
  });
});
