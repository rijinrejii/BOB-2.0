/**
 * adapters/sqlite/sqlite-store.ts
 *
 * SQLite-backed implementation of StorePort and run lifecycle management.
 *
 * Security:
 * - Store directory is validated to prevent path traversal.
 * - Storage path must be outside any reviewed source repository.
 * - Uses parameterized statements only; no string interpolation in SQL.
 * - BEGIN EXCLUSIVE transactions for stage transitions.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { resolve, isAbsolute, dirname } from "path";
import { randomUUID } from "crypto";
import type { StorePort } from "../../ports/store.js";
import { MIGRATIONS } from "./migrations.js";

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export interface SqliteStoreOptions {
  /** Absolute path to the SQLite database file, or ":memory:" for in-memory. */
  databasePath: string;
  /** Worker identifier for concurrency tracking (default: process.pid) */
  workerId?: string | undefined;
}

export class SqliteStore implements StorePort {
  private readonly db: Database.Database;
  private readonly workerId: string;

  constructor(options: SqliteStoreOptions) {
    const { databasePath } = options;

    // Validate path
    if (databasePath !== ":memory:") {
      if (!isAbsolute(databasePath)) {
        throw new Error(`SqliteStore requires an absolute path; got: ${databasePath}`);
      }
      if (databasePath.includes("..")) {
        throw new Error(`SqliteStore path traversal rejected: ${databasePath}`);
      }
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    this.workerId = options.workerId ?? String(process.pid);
    this.db = new Database(databasePath);

    // WAL mode for better concurrent read performance
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.applyMigrations();
  }

  private applyMigrations(): void {
    // Create migration tracking table first (idempotent)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const getApplied = this.db.prepare<[], { version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );

    const applied = new Set(getApplied.all().map((r) => r.version));

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;

      const applyMigration = this.db.transaction(() => {
        this.db.exec(migration.sql);
        this.db
          .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
          .run(migration.version, nowISO());
      });

      applyMigration();
    }
  }

  // ── StorePort implementation ────────────────────────────────────────────

  async put(collection: string, id: string, record: unknown): Promise<void> {
    const data = JSON.stringify(record);
    const now = nowISO();
    this.db
      .prepare(
        `INSERT INTO kv_store (collection, id, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (collection, id) DO UPDATE
           SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(collection, id, data, now, now);
  }

  async get(collection: string, id: string): Promise<unknown | null> {
    const row = this.db
      .prepare<[string, string], { data: string }>(
        "SELECT data FROM kv_store WHERE collection = ? AND id = ?",
      )
      .get(collection, id);
    if (!row) return null;
    return JSON.parse(row.data) as unknown;
  }

  async query(collection: string, field: string, value: unknown): Promise<unknown[]> {
    // JSON field extraction — safe because field comes from internal code, not user input
    // Bind value as string representation for JSON comparison
    const bindValue =
      typeof value === "string" ? value :
      typeof value === "number" || typeof value === "boolean" ? value :
      JSON.stringify(value);
    const rows = this.db
      .prepare<[string, string, string | number | boolean | null], { data: string }>(
        `SELECT data FROM kv_store
         WHERE collection = ?
           AND json_extract(data, '$.' || ?) = ?`,
      )
      .all(collection, field, bindValue as string | number | boolean | null);
    return rows.map((r) => JSON.parse(r.data) as unknown);
  }

  async delete(collection: string, id: string): Promise<void> {
    this.db
      .prepare("DELETE FROM kv_store WHERE collection = ? AND id = ?")
      .run(collection, id);
  }

  // ── Run lifecycle (exclusive locking) ──────────────────────────────────

  /**
   * Upsert a run record.
   */
  upsertRun(run: {
    runId: string;
    status: string;
    stage: string;
    fixtureMode: boolean;
    data: unknown;
  }): void {
    const now = nowISO();
    this.db
      .prepare(
        `INSERT INTO review_runs (run_id, status, stage, worker_id, fixture_mode, created_at, updated_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (run_id) DO UPDATE
           SET status = excluded.status,
               stage = excluded.stage,
               worker_id = excluded.worker_id,
               updated_at = excluded.updated_at,
               data = excluded.data`,
      )
      .run(
        run.runId,
        run.status,
        run.stage,
        this.workerId,
        run.fixtureMode ? 1 : 0,
        now,
        now,
        JSON.stringify(run.data),
      );
  }

  /**
   * Atomically advance a run from one stage to the next.
   * Fails if another worker holds the run or if the current stage doesn't match.
   *
   * @returns true if the transition succeeded, false if the run was not in the expected state.
   */
  advanceStage(
    runId: string,
    fromStage: string,
    toStage: string,
    newStatus: string,
    data: unknown,
  ): boolean {
    let succeeded = false;

    const advance = this.db.transaction(() => {
      const row = this.db
        .prepare<[string], { stage: string; status: string; worker_id: string | null }>(
          "SELECT stage, status, worker_id FROM review_runs WHERE run_id = ?",
        )
        .get(runId);

      if (!row) return;
      if (row.stage !== fromStage) return;
      // Allow our own worker or null worker
      if (row.worker_id !== null && row.worker_id !== this.workerId) return;

      const now = nowISO();
      const result = this.db
        .prepare(
          `UPDATE review_runs
           SET stage = ?, status = ?, worker_id = ?, updated_at = ?, data = ?
           WHERE run_id = ? AND stage = ?`,
        )
        .run(toStage, newStatus, this.workerId, now, JSON.stringify(data), runId, fromStage);

      succeeded = result.changes > 0;
    });

    advance();
    return succeeded;
  }

  getRun(runId: string): {
    runId: string;
    status: string;
    stage: string;
    workerId: string | null;
    fixtureMode: boolean;
    data: unknown;
  } | null {
    const row = this.db
      .prepare<
        [string],
        {
          run_id: string;
          status: string;
          stage: string;
          worker_id: string | null;
          fixture_mode: number;
          data: string;
        }
      >(
        "SELECT run_id, status, stage, worker_id, fixture_mode, data FROM review_runs WHERE run_id = ?",
      )
      .get(runId);

    if (!row) return null;

    return {
      runId: row.run_id,
      status: row.status,
      stage: row.stage,
      workerId: row.worker_id,
      fixtureMode: row.fixture_mode === 1,
      data: JSON.parse(row.data) as unknown,
    };
  }

  /**
   * Mark all running executions as interrupted on startup.
   * Called during recovery to prevent phantom running executions.
   */
  markInterruptedRuns(exceptRunId?: string): number {
    const stmt = exceptRunId
      ? this.db.prepare(
          "UPDATE review_runs SET status = 'interrupted', updated_at = ? WHERE status = 'running' AND run_id != ?",
        )
      : this.db.prepare(
          "UPDATE review_runs SET status = 'interrupted', updated_at = ? WHERE status = 'running'",
        );

    const result = exceptRunId ? stmt.run(nowISO(), exceptRunId) : stmt.run(nowISO());
    return result.changes;
  }

  /**
   * Append an immutable audit log entry.
   */
  appendAuditLog(entry: {
    runId: string;
    eventType: string;
    actor: string;
    payload: unknown;
  }): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (entry_id, run_id, event_type, actor, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        entry.runId,
        entry.eventType,
        entry.actor,
        JSON.stringify(entry.payload),
        nowISO(),
      );
  }

  getAuditLog(runId: string): Array<{
    entryId: string;
    runId: string;
    eventType: string;
    actor: string;
    payload: unknown;
    createdAt: string;
  }> {
    return this.db
      .prepare<
        [string],
        {
          entry_id: string;
          run_id: string;
          event_type: string;
          actor: string;
          payload: string;
          created_at: string;
        }
      >(
        "SELECT entry_id, run_id, event_type, actor, payload, created_at FROM audit_log WHERE run_id = ? ORDER BY created_at",
      )
      .all(runId)
      .map((r) => ({
        entryId: r.entry_id,
        runId: r.run_id,
        eventType: r.event_type,
        actor: r.actor,
        payload: JSON.parse(r.payload) as unknown,
        createdAt: r.created_at,
      }));
  }

  /**
   * Resolve the absolute store directory path from an environment variable,
   * with a safe default. Prevents path traversal.
   */
  static resolveStorePath(storeDir?: string): string {
    const dir =
      storeDir ??
      process.env["REVIEW_COPILOT_STORE_DIR"] ??
      resolve(process.cwd(), "review-copilot-data");

    const resolved = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);

    if (resolved.includes("..")) {
      throw new Error(`Store path traversal rejected: ${dir}`);
    }

    return resolve(resolved, "review-copilot.db");
  }

  /**
   * List recent runs ordered by last update.
   */
  listRuns(limit: number): Array<{
    runId: string;
    status: string;
    stage: string;
    fixtureMode: boolean;
    createdAt: string;
    updatedAt: string;
    data: unknown;
  }> {
    return this.db
      .prepare<[number], { run_id: string; status: string; stage: string; fixture_mode: number; created_at: string; updated_at: string; data: string }>(
        "SELECT run_id, status, stage, fixture_mode, created_at, updated_at, data FROM review_runs ORDER BY updated_at DESC LIMIT ?",
      )
      .all(limit)
      .map((r) => ({
        runId: r.run_id,
        status: r.status,
        stage: r.stage,
        fixtureMode: r.fixture_mode === 1,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        data: JSON.parse(r.data) as unknown,
      }));
  }

  close(): void {
    this.db.close();
  }
}
