# Architecture — Review Copilot V2 (ABY — Platform & Reliability)

This document records implemented architecture, conservative defaults used, and decisions deferred.
It is a factual record of what exists — not a proposal.

---

## Overall structure

```
src/
  adapters/
    git/           — Immutable Git access (ABY)
    metadata/      — PR metadata file reader (ABY)
    execution/     — Verification adapter; returns unavailable (ABY)
    sqlite/        — SQLite persistence (ABY)
    models/        — Model adapters (Rijin); OpenAI + unavailable stubs
  platform/
    policy.ts      — Trusted policy loader (ABY)
    capabilities.ts— Runtime capability discovery (ABY)
    redaction.ts   — Pattern-based secret redaction (ABY)
  app/
    coordinator.ts — Stage orchestration (ABY)
    run-identity.ts— Stable run ID derivation (ABY)
    stages.ts      — Stage definitions and transition rules (ABY)
    report-renderer.ts — JSON and Markdown rendering (ABY)
  contracts/       — Zod schemas for all shared data (co-owned)
  ports/           — TypeScript interfaces (co-owned)
  review/          — Review reasoning and finding quality (Rijin)
  cli/
    main.ts        — Entry point
    commands/      — capabilities, review, report, runs
```

---

## Conservative defaults

The following defaults were chosen conservatively and recorded here.

| Decision | Default | Rationale |
|---|---|---|
| Verification isolation | `unavailable` | No verified sandbox boundary exists; always returns unavailable rather than running unsandboxed |
| Model adapter | `UnavailableModelAdapter` | No live model tested; static-only mode by default |
| Store location | `./review-copilot-data/review-copilot.db` | Relative to cwd, outside any reviewed source; configurable via `REVIEW_COPILOT_STORE_DIR` |
| Comparison strategy | `merge-base` | More accurate than direct diff; records the strategy in run identity |
| Max changed files | 500 | Above this, files are recorded as excluded in the snapshot |
| Max file size | 500,000 bytes | Files over this limit are excluded from context |
| Run timeout | 120,000 ms | Applies to the entire run; individual stages do not have separate timeouts |
| Git timeout | 30,000 ms | Per git subprocess invocation |

---

## Stage machine

```
intake
  → context_collection
    → risk_assessment
      → planning
        → review
          → validation
            → verification
              → reporting
                → completed

Also: needs_input, failed, cancelled, superseded
```

Transitions are stored in SQLite with `BEGIN EXCLUSIVE` semantics.
Only forward transitions are automatic. Recovery loads the last committed checkpoint.
A run may only have one active worker at a time (enforced by `worker_id` column + exclusive transaction).

---

## Run identity

Run identity is a deterministic UUID derived from:
- Repository canonical path
- Base commit SHA (full 40 chars)
- Head commit SHA (full 40 chars)
- Comparison strategy
- Trusted policy content hash (SHA-256 of policy file bytes)
- Engine version

Model versions and prompt versions are recorded in stage results, not in run identity.

This means the same inputs always attempt the same run ID, enabling safe idempotent resume.

---

## Git adapter security

- All revision inputs validated before use; option-like (`-…`) inputs rejected
- Process argument arrays only; `shell: false` (spawnSync default)
- `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_ASKPASS=true`
- `core.hooksPath=` (empty — disables hook path) passed via `-c`
- `core.autocrlf=false`, `diff.external=`, `diff.textconv=` disabled
- Output bounded per process: `maxBuffer` set to max file size + 1024 bytes
- Binary files detected by null byte scan of first 8 KB; excluded from context
- Oversized files noted in snapshot but content not loaded
- No `git checkout`; only `git show <sha>:<path>` and `git diff <sha>..<sha>`
- Submodule content is not traversed

---

## Persistence

SQLite via `better-sqlite3`. Single-file database.

**Schema migrations** are in [`src/adapters/sqlite/migrations.ts`](../src/adapters/sqlite/migrations.ts).
Applied atomically on each `SqliteStore` open. Migration tracking in `schema_migrations` table.

**Tables:**
- `kv_store` — generic JSON key-value store for stage results (collection + id)
- `review_runs` — run lifecycle with `worker_id` and stage tracking
- `audit_log` — append-only event log; not truncated by normal operation
- `schema_migrations` — applied migration versions

**WAL mode** enabled for better read concurrency.

**Path safety:**
- Absolute paths required for database file
- Path traversal sequences (`..`) rejected
- Store directory created with `mkdirSync({ recursive: true })`

---

## Privacy and redaction

[`src/platform/redaction.ts`](../src/platform/redaction.ts) implements pattern-based redaction.

**Covered patterns:** Bearer tokens, OpenAI API keys (`sk-`), GitHub tokens (`gh[pousr]_`), AWS access key IDs (`AKIA…`), generic `api_key`/`password`/`secret` k=v patterns, connection strings with embedded credentials.

**Limitation documented:** Pattern-based redaction is not exhaustive. Custom secret formats may appear in logs. Operators must treat log files as potentially sensitive.

---

## Publication adapters

Not yet implemented. The `PublicationPort` interface is defined.
Bob integration is unsupported until verified documentation establishes the integration behavior.
GitHub adapter will be implemented capability-gated after local workflow is confirmed stable.

---

## What is not implemented (and why)

| Feature | Status | Reason |
|---|---|---|
| Sandboxed execution | Unavailable | No verified isolation boundary (container socket, seccomp, etc.) |
| GitHub publication | Not implemented | Requires live API test; gated behind capability check |
| Bob integration | Unsupported | No verified Bob publication API documented |
| Patch application | Not implemented | Requires approval gate; initial product is read-only |
| Incremental reuse | Not implemented | Policy flag accepted; conservative invalidation not yet built |
| Web server / dashboard | Will not implement | Out of scope by design |
| Automatic merge / approval | Will not implement | Never |
