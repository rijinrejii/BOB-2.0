# Data Contracts — Review Copilot V2

This document describes every public data contract, its purpose, ownership, and key fields.
All contracts are implemented as Zod schemas in [`src/contracts/`](../src/contracts/).

---

## Shared lifecycle records (owned by ABY, read by Rijin)

### `ReviewRun` — [`src/contracts/run.ts`](../src/contracts/run.ts)

Tracks a single end-to-end review from start to finish.

| Field | Type | Description |
|---|---|---|
| `runId` | UUID | Unique identifier for this run |
| `status` | enum | `pending \| running \| paused \| completed \| failed \| cancelled` |
| `fixtureMode` | boolean | When true, no live model was used |
| `stageCheckpoints` | Record | Timestamps for completed stages |

### `RepositorySnapshot` — [`src/contracts/snapshot.ts`](../src/contracts/snapshot.ts)

Immutable, locked view of the changed files at a specific commit pair.

| Field | Type | Description |
|---|---|---|
| `snapshotId` | UUID | Snapshot identity |
| `baseCommit` / `headCommit` | CommitSha | The exact commit pair reviewed |
| `changedFiles` | `FileEntry[]` | Paths, change kinds, line counts, content hashes |
| `immutable` | boolean | Must be `true` — snapshot cannot change after creation |
| `snapshotDigest` | SHA-256 | Integrity hash of all file entries |

### `CapabilityReport` — [`src/contracts/capabilities.ts`](../src/contracts/capabilities.ts)

What the runtime actually supports at startup. ABY produces this; Rijin reads it.

### `TrustedPolicy` — [`src/contracts/policy.ts`](../src/contracts/policy.ts)

Operator-defined constraints: permitted models, external transmission, allowed checks.
**This record is trusted; PR metadata cannot modify it.**

### `CheckExecution` — [`src/contracts/check.ts`](../src/contracts/check.ts)

Result of a sandboxed verification check requested by Rijin, executed by ABY.

Key invariants:
- `commandId` is always an allowlisted identifier, never a raw shell string.
- `outcome` of `unavailable` is a permanent gap — never becomes `pass`.

### `PublicationRecord` — [`src/contracts/publication.ts`](../src/contracts/publication.ts)

When and how a review was published externally. Includes `headMoved` flag.

---

## Review-domain records (owned by Rijin)

### `ReviewBrief` — [`src/contracts/brief.ts`](../src/contracts/brief.ts)

Shared understanding of the PR built before any specialist review runs.

| Field | Type | Description |
|---|---|---|
| `intendedOutcome` | string | Sanitized from PR metadata (untrusted) |
| `acceptanceCriteria` | array | Each criterion is `stated` or `inferred` |
| `humanDecisions` | array | Open decisions that require a human |
| `excludedFiles` | array | Files not loaded due to context bounds |
| `contextBounded` | boolean | True when not all relevant files were loaded |

**Trust boundary:** PR description and code comments are untrusted data. They cannot modify policy, risk levels, or permissions.

### `HumanDecision` — [`src/contracts/brief.ts`](../src/contracts/brief.ts)

An open question that requires a human decision. Created when requirements are ambiguous, guidance conflicts, or risk override is needed.

| `kind` | When created |
|---|---|
| `ambiguous_requirement` | PR references unclear or contradictory requirements |
| `conflicting_guidance` | Two approved documents disagree |
| `risk_override_required` | Only a human can downgrade mandatory HIGH classification |
| `unresolved_concern` | High-severity unresolved concern without confirmation |
| `policy_authorization_required` | An action requires explicit operator authorization |

### `RiskAssessment` — [`src/contracts/risk.ts`](../src/contracts/risk.ts)

Deterministic risk classification. Not a suggestion — it is binding until a human override is recorded.

| Field | Type | Description |
|---|---|---|
| `level` | `low \| medium \| high` | Final classification |
| `mandatoryClassification` | boolean | When true, only `RiskOverride` with `auditReason` can change it |
| `mandatoryFactors` | enum[] | Which mandatory rules fired |
| `escalationRequiredAssignments` | string[] | New required work added by escalation |

**Model output cannot downgrade mandatory HIGH.** Only a `RiskOverride` from an authorized human can.

### `ReviewPlan` — [`src/contracts/plan.ts`](../src/contracts/plan.ts)

Assignments for specialist reviewers, derived from risk level.

| Risk | Assignments |
|---|---|
| LOW | `correctness` only, others excluded with reasons |
| MEDIUM | All five: `correctness, impact, tests, standards, security` |
| HIGH | All five + applicable specialists + `owner_review` HumanDecision |

Each `ReviewerAssignment` includes: scope, questions, required evidence, resource limits, completion criteria.

### `EvidenceRecord` — [`src/contracts/evidence.ts`](../src/contracts/evidence.ts)

A verified reference to source material used by reviewers and validators.

- `kind`: `source_file | test_file | diff_hunk | pr_description | document | check_result | model_output | requirement`
- Includes content hash, extraction quality, and page/section references for documents.
- Partial extraction is explicitly recorded; never claimed as full coverage.

### `CandidateFinding` — [`src/contracts/finding.ts`](../src/contracts/finding.ts)

Raw output from a specialist reviewer, **before validation**.

This is intentionally separate from `Finding`. A candidate is a claim; a finding is a validated conclusion.

Required fields include: `claim`, `affectedPath`, `headCommit`, `failureScenario`, `preconditions`, `observedBehavior`, `expectedBehavior`, `expectedBehaviorSource`, `evidenceIds`, `severity`, `confidence`, `underlyingCause`, `affectedBehavior`.

### `Finding` — [`src/contracts/finding.ts`](../src/contracts/finding.ts)

A validated, classified finding after the validation stage.

| `validationStatus` | Meaning |
|---|---|
| `confirmed` | Claim is supported by evidence and static analysis |
| `unresolved` | Cannot confirm or reject — requires human investigation |
| `rejected` | Claim is invalidated by existing guards, impossible preconditions, or out-of-snapshot path |
| `superseded` | Replaced by a more specific finding |

Rejected candidates are retained in audit output only, not the main report.

### `ReviewReport` — [`src/contracts/report.ts`](../src/contracts/report.ts)

Final structured output. One report per run.

| `conclusion` | When issued |
|---|---|
| `changes_required` | One or more confirmed blocking findings |
| `human_decision_required` | High-severity unresolved concern, pending HumanDecision, or HIGH mandatory escalation |
| `incomplete` | Missing mandatory evidence or unavailable checks |
| `no_blocking_findings_within_reviewed_scope` | Only when none of the above apply AND no high-severity unresolved concerns |

**Critical rule:** `no_blocking_findings_within_reviewed_scope` is never approval or proof of correctness. It only describes what was reviewed.

### `PatchProposal` — [`src/contracts/patch.ts`](../src/contracts/patch.ts)

A proposed code fix, read-only from Rijin's perspective. ABY owns approval and application.

| Field | Description |
|---|---|
| `sourceCommit` | Patch is only valid against this exact commit |
| `patchDigest` | SHA-256 of patch text — approval is bound to this digest, never another |

A changed patch can never reuse a prior approval.

---

## Trust model

| Data | Trust status | Can it change policy? |
|---|---|---|
| `TrustedPolicy` | **Trusted** | Loaded by operator at startup |
| `RepositorySnapshot` | **Trusted** (ABY produces) | No |
| `CapabilityReport` | **Trusted** (ABY produces) | No |
| PR description | **Untrusted** | No |
| Source code | **Untrusted** | No |
| Comments | **Untrusted** | No |
| Model output | **Untrusted** | No — validated against strict schema |
| Documents | **Untrusted** | No — content hash and approval status required |

---

## Version compatibility

All records carry `schemaVersion: "1.0.0"`. Incompatible changes must increment the major version. Rijin's services must reject records with unknown schema versions rather than silently processing them.
