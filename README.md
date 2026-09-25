# BOB-2.0
AI-powered PR review tool using IBM Bob 2.0 agent mode. Parallel subagents check correctness, impact, tests, standards &amp; security on a diff, validate findings before posting, and produce a risk-tiered, evidence-backed review report for the human reviewer to act on.



# Review Copilot

**An evidence-backed, risk-aware pull request review system built with IBM Bob 2.0**

---

## The problem

Reviewing a pull request properly takes real time — typically 20 to 40 minutes, even for an experienced developer on a codebase they know well. That time goes into four separate, sequential tasks:

1. **Understanding the change** — what the diff actually does and why, beyond what the PR title says
2. **Checking downstream impact** — whether the change breaks callers, interfaces, or systems elsewhere in the codebase
3. **Checking test coverage** — whether the new behavior is actually tested, not just touched
4. **Checking conventions** — whether the change follows the team's coding standards, security practices, and architectural patterns

Under deadline pressure, teams typically do one of two things, and both are costly:

- **They skip the rigor.** Reviews get rubber-stamped. Bugs, missing tests, and convention drift make it into the main branch, and the cost shows up later as production incidents or accumulating tech debt.
- **They do the rigor anyway.** The review becomes the bottleneck. A PR sits for a day or more waiting for a reviewer with enough free attention to do all four checks properly.

Neither outcome is acceptable at scale, and the underlying cause isn't reviewer skill — it's that all four checks are manual, sequential, and compete for the same scarce resource: a senior developer's uninterrupted attention.

## The proposed solution

Review Copilot is a custom Bob mode that automates the mechanical parts of this process while keeping a human reviewer in control of every consequential decision. It does not approve merges, bypass branch protections, or claim to prove a change is correct — it produces a fast, organized, evidence-backed starting point so the human reviewer's time goes toward judgment calls instead of information-gathering.

### How it works, step by step

**1. Understand intent, not just the diff.**
Before checking anything, Review Copilot reads the PR description, the changed files, relevant surrounding code, and any linked requirements or team documentation. It builds a shared "review brief" — what the change is trying to achieve, what should and shouldn't change as a result, and which assumptions need verifying. If the intent is unclear, it says so explicitly rather than guessing, because a change can pass every downstream check and still solve the wrong problem.

**2. Match the depth of review to the risk of the change.**
Not every PR deserves the same scrutiny. A one-line documentation fix and a change to authentication logic are not the same review. Review Copilot classifies each change by risk and scope — considering what behavior is being touched, not just how many lines changed — and scales the review accordingly:
- **Low risk** → lightweight, targeted checks
- **Medium risk** → the full standard review (correctness, impact, tests, standards, security)
- **High risk** → the full review plus specialist checks and mandatory human sign-off from a code owner

**3. Run specialist checks in parallel using Bob's subagents.**
This is where Bob 2.0's architecture does the actual work. Instead of one reviewer working through four checks sequentially, Review Copilot dispatches multiple subagents at once, each with a clean, isolated context and a narrow job:
- **Correctness reviewer** — does the implementation actually do what it claims to, including edge cases and error handling?
- **Impact reviewer** — what else in the codebase calls or depends on this code, and does the change break it?
- **Test reviewer** — is the new behavior meaningfully tested, or just touched by a test that doesn't actually assert anything useful?
- **Standards reviewer** — does the change follow the team's actual coding standards document (read natively as a PDF or Word file), with the specific rule cited?
- **Security reviewer** — are there hardcoded secrets, injection risks, or authorization gaps?

Because these run in parallel instead of one after another, the review is faster on Bob's end as well as easier on the human's end.

**4. Validate findings before they're shown to anyone.**
A subagent's suspicion is not automatically a review comment. Before anything is reported, each finding is checked against the actual code and, where possible, against real evidence — running the relevant tests, linter, or type checker rather than trusting the model's claim on its own. Findings that can't be verified are marked as unresolved, not silently dropped and not presented as passing. The system never reports "not checked" as "checked and fine" — if something couldn't be verified, that gap is stated plainly.

**5. Fix the trivial stuff, flag the rest.**
Small, deterministic, low-risk issues (a missing test stub, a formatting violation) can be fixed automatically. Anything that involves a judgment call — a behavioral change, a generated test, an ambiguous requirement — is proposed as a separate, explicit patch that a human has to approve. Review Copilot never silently changes business logic, weakens a test, or relaxes a security check to make a review pass.

**6. Deliver a decision-ready report.**
The final output isn't a wall of every observation every subagent made. It's organized around what the human reviewer actually needs to decide next:
- What changed and why, and the assessed risk level
- Blocking findings — confirmed issues, with evidence, that need fixing before merge
- Non-blocking suggestions, kept clearly separate from defects
- A verification record — what was actually checked, what passed, what couldn't be checked and why
- Open questions that need a human's judgment, not the tool's

### The net effect

A review that would normally take 20–40 minutes of focused human attention becomes a 3–5 minute check of an already-organized, evidence-backed summary — with the confidence that nothing was silently skipped, because the system is explicit about the difference between "checked and clean" and "not checked."

---

## Project structure

The prototype is a standalone TypeScript CLI tool that runs the review engine independently of Bob, integrating with it through an adapter — so the core logic isn't locked to one host. Scope for the hackathon build is the vertical slice that can run and demo end to end (git diff intake → risk tiering → parallel reviewers → validation → report); the remainder of the structure below reflects the fuller design the prototype is built toward.

```
review-copilot/
├── package.json, tsconfig.json, vitest.config.ts   — project config
├── README.md
├── docs/                    — architecture notes, threat model, known limitations
├── config/                  — trusted policy, review config, allowlisted commands
├── examples/local-run/      — a runnable example with an expected report
├── src/
│   ├── cli/                 — command-line entry point (review, capabilities, resume, report, patch)
│   ├── contracts/           — typed schemas for every object the system passes around
│   │                          (review run, risk assessment, finding, patch, report, etc.)
│   ├── core/                — the coordinator, workflow state machine, run identity, budgets
│   ├── stages/               — the pipeline stages: intake, context, risk, planning,
│   │                          review, validation, verification, reporting, completion
│   ├── discovery/            — checks what the Bob environment actually supports
│   ├── git/                  — diff and snapshot handling
│   ├── policy/                — loading and applying the team's trusted review policy
│   ├── reviewers/              — the specialist subagents: correctness, impact, tests,
│   │                          standards, security (plus optional specialists)
│   ├── evidence/               — collecting and storing supporting evidence for findings
│   ├── findings/               — validating, deduplicating, and scoring findings
│   ├── execution/               — safely running tests/linters to verify findings
│   ├── patches/                — proposing and applying approved auto-fixes
│   ├── documents/               — reading team standards docs (Markdown first, PDF/Word later)
│   ├── model/                   — the model adapter, including a mock adapter for testing
│   ├── persistence/              — storing review state so runs can resume
│   ├── publication/              — posting the final report
│   └── adapters/                 — the Bob integration and PR-provider integration
└── tests/
    ├── unit/, integration/, adversarial/, e2e/, fixtures/
```

The design separates the review engine from Bob itself — Bob is the orchestration and execution layer (agent mode, subagents, document parsing), while the engine defines what gets checked, how findings are validated, and what "done" means, so the same core logic could run through a different host if needed.




<img width="2720" height="2240" alt="review_copilot_pipeline" src="https://github.com/user-attachments/assets/6561f869-c319-4fea-9722-d1b8b4b905ff" />


