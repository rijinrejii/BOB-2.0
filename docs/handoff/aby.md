# Handoff — ABY (Platform & Reliability)

This document describes the public interfaces implemented by ABY, actual commands and results,
integration points for Rijin, blocked capabilities, and next steps.

---

## Implemented

### Platform layer (`src/platform/`)

- [`loadPolicy(path)`](../../src/platform/policy.ts) — Loads and validates `TrustedPolicy` from an operator-controlled JSON file. Fails closed on any validation error.
- [`defaultFixturePolicy()`](../../src/platform/policy.ts) — Returns a test-only fixture policy (external transmission disabled, no models, no checks). Must not be used in production.
- [`discoverCapabilities(policy, verificationIsolated?)`](../../src/platform/capabilities.ts) — Probes actual runtime capabilities and returns a validated `CapabilityReport`.
- [`redactSecrets(text)`](../../src/platform/redaction.ts) — Pattern-based secret redaction. Not exhaustive; documented limitation.

### Git adapter (`src/adapters/git/`)

`GitAdapter` implements both `RepositoryPort` and `EvidencePort`.

```typescript
const adapter = new GitAdapter({ repoPath: "/path/to/repo" });

// Create an immutable snapshot (resolves revisions to full SHAs first)
const snapshot = await adapter.createSnapshot(runId, "main", "feature-branch");

// Read via RepositoryPort
const content = await adapter.readFile(snapshot.snapshotId, "src/index.ts");
const diff = await adapter.getFileDiff(snapshot.snapshotId, "src/index.ts");
const files = await adapter.getChangedFiles(snapshot.snapshotId);

// Store evidence via EvidencePort
await adapter.storeEvidence(evidenceRecord);
```

Security invariants: revision validation, path traversal rejection, no shell interpolation,
hooks disabled, binary detection, bounded output. See [`docs/capabilities.md`](../capabilities.md).

### Metadata adapter (`src/adapters/metadata/`)

```typescript
const adapter = new FileMetadataAdapter();
const raw = await adapter.loadRaw("/path/to/pr-metadata.json");
// raw is `unknown` — pass to Rijin's ReviewService for validation
```

Returns `null` if file does not exist. Rejects path traversal.

### Execution adapter (`src/adapters/execution/`)

```typescript
const adapter = new UnavailableExecutionAdapter();
adapter.isCheckAllowed("npm:test"); // → false
const result = await adapter.requestCheck({ runId, commandId: "npm:test", commit: sha });
// result.outcome === "unavailable"
// result.failureKind === "unavailable_execution"
```

Always returns `unavailable`. No commands are executed. Replace with a verified sandboxed runner when an isolation boundary is established.

### SQLite adapter (`src/adapters/sqlite/`)

```typescript
const store = new SqliteStore({
  databasePath: SqliteStore.resolveStorePath(), // uses REVIEW_COPILOT_STORE_DIR or ./review-copilot-data
});

// StorePort operations
await store.put("collection", "id", record);
const record = await store.get("collection", "id");
const records = await store.query("collection", "field", value);

// Run lifecycle
store.upsertRun({ runId, status, stage, fixtureMode, data });
store.advanceStage(runId, fromStage, toStage, newStatus, data); // returns boolean
const run = store.getRun(runId);
store.markInterruptedRuns(exceptRunId?); // recovery: marks running → interrupted
store.appendAuditLog({ runId, eventType, actor, payload });
store.listRuns(limit);
store.close();

// SQLiteEvidenceAdapter wraps StorePort with EvidencePort interface
const evidence = new SqliteEvidenceAdapter(store);
```

Migrations are applied automatically on `new SqliteStore(...)`.

### App layer (`src/app/`)

```typescript
// Derive stable run ID from canonical inputs
const runId = deriveRunId({
  repositoryPath, baseCommit, headCommit,
  comparisonStrategy: "merge-base",
  policyContentHash: policy.contentHash,
  engineVersion: "0.1.0",
});

// Coordinate a full review workflow
const coordinator = new ReviewCoordinator({
  store, repository, evidence, metadata, verification, reviewServices,
});
const result = await coordinator.execute({
  runId, repositoryPath, baseRevision, headRevision,
  prMetadataPath, policy, capabilities, fixtureMode, engineVersion,
  timeoutMs: 120_000,
});
// result.status: "completed" | "failed" | "conflict"
// result.report: ReviewReport | null

// Render the report
const json = renderReportJson(result.report);
const md = renderReportMarkdown(result.report);
```

### CLI (`src/cli/`)

Commands are implemented and can be invoked after `npm run build`:

```
node dist/cli/main.js capabilities [--policy <path>] [--json]
node dist/cli/main.js review <base> <head> [--repo <path>] [--fixture-mode] [--policy <path>] [--json]
node dist/cli/main.js report <run-id> [--json]
node dist/cli/main.js runs [--limit <n>] [--json]
```

---

## Actually verified (commands and outcomes)

```
$ npm test

 ✓ tests/unit/platform/redaction.test.ts          (5 tests)
 ✓ tests/unit/app/run-identity.test.ts             (4 tests)
 ✓ tests/unit/app/report-renderer.test.ts          (7 tests)
 ✓ tests/unit/adapters/execution-adapter.test.ts   (4 tests)
 ✓ tests/unit/review/planning.test.ts              (5 tests)
 ✓ tests/unit/review/risk.test.ts                  (10 tests)
 ✓ tests/unit/adapters/sqlite-store.test.ts        (16 tests)
 ✓ tests/adversarial/review.test.ts                (8 tests)
 ✓ tests/unit/review/validation.test.ts            (23 tests)
 ✓ tests/unit/app/coordinator.test.ts              (6 tests)
 ✓ tests/contracts/schemas.test.ts                 (13 tests)
 ✓ tests/unit/platform/policy.test.ts              (7 tests)
 ✓ tests/unit/platform/capabilities.test.ts        (4 tests)
 ✓ tests/security/platform-security.test.ts        (16 tests)
 ✓ tests/unit/adapters/git-adapter.test.ts         (13 tests)

 Test Files  15 passed (15)
       Tests 141 passed (141)
    Duration ~3.7s
```

All 141 tests pass. 59 are Rijin's pre-existing tests (unchanged). 82 are new platform tests.

```
$ npm run typecheck

(no output — clean)
```

TypeScript strict mode passes with zero errors.

---

## Not run / not verified

- **CLI commands against a live repository**: The CLI code exists and compiles. It has not been run against a real repository in this session. The Git adapter tests use this repository itself (HEAD) successfully.
- **Live model invocation**: `OpenAIModelAdapter` (Rijin's code) has not been tested against the real API. ABY's platform code does not call it.
- **GitHub publication**: Adapter not yet implemented. Capability is gated.
- **Build output** (`npm run build`): TypeScript compilation to `dist/` has not been run. The CLI uses the TypeScript source via vitest; a `build` step is required before using the `bin` entrypoint.

---

## Unsupported (by design)

- Bob integration — no verified integration documentation
- Automatic PR approval or merge
- Sandboxed code execution — returns `unavailable` until an operator provides a verified container runtime
- Applying patches autonomously
- Web server, dashboard, or multi-tenant service
- Claiming comprehensive security assurance

---

## Operator configuration required before production use

1. **`--policy <path>`**: Provide a valid policy JSON file. See [`example-policy.json`](../../example-policy.json) for format. Without `--policy`, only `--fixture-mode` works.
2. **`REVIEW_COPILOT_STORE_DIR`**: Set to a directory outside any reviewed repository. Default: `./review-copilot-data`.
3. **`OPENAI_API_KEY`** (if using live models): Rijin's reviewers require this and `externalTransmissionAllowed: true` in policy.
4. **Verified sandbox** (for verification checks): Replace `UnavailableExecutionAdapter` with a sandboxed runner once an isolation boundary is established.

---

## Integration points available to Rijin

ABY provides these implementations that Rijin's `ReviewService` expects:

| Port | Implementation | Location |
|---|---|---|
| `RepositoryPort` | `GitAdapter` | `src/adapters/git/` |
| `EvidencePort` | `SqliteEvidenceAdapter` or `GitAdapter` (in-memory) | `src/adapters/sqlite/` |
| `VerificationPort` | `UnavailableExecutionAdapter` | `src/adapters/execution/` |
| `StorePort` | `SqliteStore` | `src/adapters/sqlite/` |
| `MetadataPort` | `FileMetadataAdapter` | `src/adapters/metadata/` |

`ReviewService` is wired in `src/cli/commands/review.ts`. ABY's coordinator calls all six `ReviewServicesPort` stages in order.

The `ReviewContext` passed to each stage includes the `CapabilityReport` so Rijin's code can gate model usage on `capabilities.modelStatus === "available"`.

---

## Schema changes

No changes to Rijin's schema files. All `src/contracts/` files are unchanged from Rijin's implementation.

The `ReviewRun.status` field uses the same enum values as before. The coordinator now correctly sets `status: "completed"` (not `"running"`) when the run reaches the `completed` stage.

---

## Next concrete integration step

1. **Run `npm run build`** to produce `dist/` output, then test:
   ```
   node dist/cli/main.js capabilities --fixture-mode
   ```
2. **Wire a real Git repository**: Create a policy file (see `example-policy.json`) and run:
   ```
   node dist/cli/main.js review HEAD~1 HEAD --repo /path/to/repo --fixture-mode --policy ./policy.json
   ```
3. **Joint end-to-end test**: Both contributors run a real review against a test PR. Verify the evidence trail, fixture labeling, and report content.
4. **Add OpenAI key**: Configure `OPENAI_API_KEY` and update policy with `externalTransmissionAllowed: true` and a permitted model ID. Run again without `--fixture-mode`.
5. **Implement GitHub adapter**: After the local workflow is confirmed stable, implement `src/adapters/github/` behind the `PublicationPort`.

---

## Files owned by ABY

```
src/platform/                — Policy, capabilities, redaction
src/adapters/git/            — Immutable Git access
src/adapters/metadata/       — PR metadata file reader
src/adapters/execution/      — Verification adapter (unavailable)
src/adapters/sqlite/         — SQLite store, migrations, evidence adapter
src/app/                     — Coordinator, run identity, stages, report renderer
src/cli/                     — CLI commands
tests/unit/platform/         — Platform unit tests
tests/unit/adapters/         — Adapter unit tests
tests/unit/app/              — App layer unit tests
tests/security/              — Security / hostile-input tests
docs/capabilities.md         — Capability status document
docs/architecture.md         — Architecture record
docs/handoff/aby.md          — This file
```

## Co-owned with Rijin

```
src/contracts/               — Zod schemas (all existing files unchanged)
src/ports/                   — Port interfaces (all existing files unchanged)
tests/contracts/             — Schema validation tests (Rijin's)
tests/adversarial/           — Trust boundary tests (Rijin's)
tests/support/               — Fixture helpers (shared)
```
