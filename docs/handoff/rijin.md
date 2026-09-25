# Handoff — Rijin (Review Quality & Reasoning)

This document describes the public interface, verified behavior, limitations, and next integration steps for Rijin's review services.

---

## Public service signatures

All services implement [`ReviewServicesPort`](../../src/ports/review-services.ts):

```typescript
interface ReviewServicesPort {
  buildBrief(context: ReviewContext, prMetadataRaw: unknown): Promise<ReviewBrief>;
  assessRisk(context: ReviewContext, brief: ReviewBrief): Promise<RiskAssessment>;
  planReview(context: ReviewContext, brief: ReviewBrief, assessment: RiskAssessment): Promise<ReviewPlan>;
  runReviewers(context: ReviewContext, brief: ReviewBrief, plan: ReviewPlan): Promise<CandidateFinding[]>;
  validateFindings(context: ReviewContext, brief: ReviewBrief, candidates: CandidateFinding[]): Promise<Finding[]>;
  buildReport(context: ReviewContext, brief: ReviewBrief, assessment: RiskAssessment, plan: ReviewPlan, findings: Finding[]): Promise<ReviewReport>;
}
```

Implementation: [`src/review/service.ts`](../../src/review/service.ts)

---

## Required inputs

| Input | Type | Source |
|---|---|---|
| `ReviewContext` | Snapshot, capabilities, policy, runId, fixtureMode | ABY provides via coordinator |
| `prMetadataRaw` | `unknown` | ABY loads from metadata file; Rijin validates it |
| `RepositoryPort` | Interface | ABY provides implementation |
| `EvidencePort` | Interface | ABY provides implementation |
| `ModelPort \| null` | Interface | Rijin's `OpenAIModelAdapter` or `UnavailableModelAdapter` |
| `VerificationPort \| null` | Interface | ABY provides implementation (or null) |

---

## Returned records

All returned types are Zod-validated. See [`docs/contracts.md`](../contracts.md) for full schemas.

| Stage | Returns | Schema location |
|---|---|---|
| `buildBrief` | `ReviewBrief` | `src/contracts/brief.ts` |
| `assessRisk` | `RiskAssessment` | `src/contracts/risk.ts` |
| `planReview` | `ReviewPlan` | `src/contracts/plan.ts` |
| `runReviewers` | `CandidateFinding[]` | `src/contracts/finding.ts` |
| `validateFindings` | `Finding[]` | `src/contracts/finding.ts` |
| `buildReport` | `ReviewReport` | `src/contracts/report.ts` |

---

## Model configuration requirements

| Requirement | Details |
|---|---|
| `TrustedPolicy.externalTransmissionAllowed` | Must be `true` for any live model use |
| `TrustedPolicy.permittedModelIds` | Must include `"openai/gpt-4o"` or another `"openai/*"` model |
| `OPENAI_API_KEY` | Environment variable — must be set |
| `OPENAI_BASE_URL` | Optional — defaults to `https://api.openai.com/v1` |

If any condition fails, `UnavailableModelAdapter` is returned. **The service never silently falls back or uses an unpermitted model.**

Without a live model, all five reviewers run in static-analysis-only mode. Findings are produced from deterministic pattern detection. This is the default for fixture mode.

---

## Implemented

- [x] All Zod schemas for review-domain contracts (`src/contracts/`)
- [x] Ports for model, repository, evidence, verification, review-services (`src/ports/`)
- [x] Deterministic mandatory risk rules (authentication, authorization, secrets, payments, sensitive data, schema migration, public API, dependencies, concurrency, deployment config, destructive ops, blast radius)
- [x] Risk assessor with: mandatory classification, human override support, escalation assignments
- [x] Review planner: LOW → correctness only; MEDIUM → all five; HIGH → all five + specialists + HumanDecision
- [x] All five specialist reviewers: correctness, impact, tests, standards, security
- [x] Model invocation with strict Zod schema validation (JSON extraction, repair attempt, failure recording)
- [x] Provider-neutral model adapter interface + OpenAI implementation
- [x] `UnavailableModelAdapter` — explicit policy denial, no silent fallback
- [x] Finding validator: path-in-snapshot check, evidence reference check, guard invalidation, precondition check, deduplication by (underlyingCause, affectedBehavior)
- [x] Conclusion builder with strict gating rules
- [x] ReviewReport with fixture-mode labeling
- [x] `ReviewService` wiring all stages together
- [x] Fixture repository/evidence adapters for testing
- [x] Evaluation directory with labeled development and held-out cases

---

## Actually verified (commands and outcomes)

```
$ npm test

 ✓ tests/unit/review/planning.test.ts   (5 tests)
 ✓ tests/unit/review/risk.test.ts       (10 tests)
 ✓ tests/adversarial/review.test.ts     (8 tests)
 ✓ tests/unit/review/validation.test.ts (23 tests)
 ✓ tests/contracts/schemas.test.ts      (13 tests)

 Test Files  5 passed (5)
       Tests 59 passed (59)
    Duration 376ms
```

All 59 tests pass. No live model was invoked during testing. All tests use deterministic fixtures.

---

## Not run / not verified

- Live model integration: `OpenAIModelAdapter.complete()` has not been invoked against the real API. The interface is implemented and the error handling paths are verified structurally, but end-to-end model output validation has not been tested against a real endpoint.
- PDF/Word document parsing: not implemented. `docs/contracts.md` documents this as a known gap.
- Sandboxed check execution: `VerificationPort` interface defined; no implementation provided (ABY owns this).
- GitHub publication: `PublicationPort` interface defined; no implementation provided (ABY owns this).
- SQLite storage: `StorePort` interface defined; no implementation provided (ABY owns this).

---

## Unsupported (by design)

- Automatic PR approval or merge
- Bypassing branch protections
- Generating executable shell commands from review code
- Applying patches autonomously (Rijin only generates proposals; ABY owns approval and application)
- Claiming comprehensive security assurance
- Re-using a patch approval on a modified patch or different commit

---

## Operator configuration required

Before production use:

1. Set `OPENAI_API_KEY` in the runtime environment (if using OpenAI models).
2. Configure `TrustedPolicy` with `externalTransmissionAllowed: true` and a permitted model ID.
3. Confirm data privacy policy permits sending code to the model provider.
4. If external transmission is not permitted, no configuration is needed — static-only mode works without any model.

---

## Known limitations

1. **No live model tested**: Static analysis produces findings without a model. Model-based review adds semantic analysis but requires operator configuration.
2. **No full codebase caller graph**: Impact analysis is limited to exported symbol detection in the diff. Identifying all callers requires a codebase-wide index (not available in this static-first path).
3. **Pattern-based secret detection has false positives**: Long random-looking strings trigger the hardcoded-secret rule. Test fixtures with fake keys may produce false positives — the validator partially mitigates this for fixture-path files.
4. **Context is bounded**: Up to `maxContextFiles` files are loaded. Excluded files are recorded in `ReviewBrief.excludedFiles` and `contextBounded = true` is set.
5. **Model output validation discards invalid responses**: If a model returns malformed JSON or fails schema validation, all candidates from that response are discarded and recorded as a coverage gap.
6. **No incremental reuse**: The `incrementalReuseEnabled` flag is accepted by policy but conservative invalidation logic is not yet implemented.
7. **Mandatory risk cannot be model-downgraded**: This is intentional, not a limitation.

---

## Next integration step for ABY

1. **Provide `RepositoryPort` and `EvidencePort` implementations** — Rijin's `ReviewService` calls these ports. ABY needs to implement them using the Git adapter and SQLite storage.
2. **Provide a `CapabilityReport`** at startup that accurately reflects available models and allowed checks.
3. **Provide a `TrustedPolicy`** loaded from the operator's configuration file.
4. **Wire `ReviewService` into the coordinator** — ABY's coordinator calls the six stages in order: `buildBrief → assessRisk → planReview → runReviewers → validateFindings → buildReport`.
5. **Pass `VerificationPort`** if verification is available. Rijin's report builder records `VerificationRecord`s and marks unavailable checks as coverage gaps.
6. **Render and persist the `ReviewReport`** — ABY's reporting layer renders JSON and Markdown from the `ReviewReport` struct returned by `buildReport`.
7. **Joint end-to-end test** — Run a real local review from a Git repository before declaring Milestone 3 complete.

---

## Files owned by Rijin

```
src/review/              — All review logic
src/adapters/models/     — Model adapters (OpenAI, Unavailable)
src/contracts/brief.ts   — ReviewBrief, HumanDecision
src/contracts/risk.ts    — RiskAssessment, RiskFactor
src/contracts/plan.ts    — ReviewPlan, ReviewerAssignment
src/contracts/evidence.ts— EvidenceRecord
src/contracts/finding.ts — CandidateFinding, Finding
src/contracts/report.ts  — ReviewReport
src/contracts/patch.ts   — PatchProposal
tests/unit/review/       — Unit tests for review logic
tests/adversarial/       — Adversarial trust-boundary tests
tests/contracts/         — Schema validation tests
evaluation/              — Labeled evaluation cases
docs/contracts.md        — Contract documentation
docs/handoff/rijin.md    — This file
```

## Co-owned with ABY

```
src/contracts/common.ts        — Shared primitives
src/contracts/capabilities.ts  — CapabilityReport
src/contracts/configuration.ts — ReviewConfiguration
src/contracts/policy.ts        — TrustedPolicy
src/contracts/run.ts           — ReviewRun
src/contracts/snapshot.ts      — RepositorySnapshot
src/contracts/check.ts         — CheckExecution
src/contracts/publication.ts   — PublicationRecord
src/ports/                     — All port interfaces
```
