/**
 * adapters/sqlite/migrations.ts
 *
 * Schema migrations for the review-copilot SQLite database.
 * Each migration has a monotonically increasing version number.
 * Migrations are applied in order and are idempotent.
 *
 * Convention: each migration is a single SQL string executed in a transaction.
 * Never modify an existing migration — add a new one.
 */

export interface Migration {
  version: number;
  description: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Initial schema: migration tracking, kv store, run lifecycle",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version   INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      -- Generic key-value store backing StorePort
      -- collection: logical grouping (e.g. 'review_runs', 'evidence')
      -- id: record identifier within collection
      -- data: JSON-serialized record
      -- created_at / updated_at: UTC ISO timestamps
      CREATE TABLE IF NOT EXISTS kv_store (
        collection  TEXT NOT NULL,
        id          TEXT NOT NULL,
        data        TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );

      -- Run lifecycle table for concurrency-safe stage transitions
      -- Separate from kv_store so we can use SQL-level locking
      CREATE TABLE IF NOT EXISTS review_runs (
        run_id          TEXT PRIMARY KEY,
        status          TEXT NOT NULL,
        stage           TEXT NOT NULL,
        worker_id       TEXT,
        fixture_mode    INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        data            TEXT NOT NULL
      );

      -- Audit log: append-only record of state transitions and actions
      CREATE TABLE IF NOT EXISTS audit_log (
        entry_id    TEXT PRIMARY KEY,
        run_id      TEXT NOT NULL,
        event_type  TEXT NOT NULL,
        actor       TEXT NOT NULL,
        payload     TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_log_run_id ON audit_log(run_id);
      CREATE INDEX IF NOT EXISTS idx_kv_store_collection ON kv_store(collection);
    `,
  },
];
