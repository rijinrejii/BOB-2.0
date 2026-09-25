# Work Split: ABY and Rijin

This document explains, in detail, who builds what for Review Copilot V2 and why the work is divided this way.

> This is a proposed split for planning purposes — it isn't a statement about either person's existing skills, just a sensible way to divide a large project into two halves that can move in parallel.

---

## 1. The one-sentence version

**ABY builds the machine that runs reliably. Rijin builds the reviewer that thinks clearly.**

If you only remember one thing: ABY makes sure the system doesn't crash, lose data, or do something twice by accident. Rijin makes sure the findings the system produces are actually true, useful, and fair.

---

## 2. Why split it this way at all?

Review Copilot V2 is really two different kinds of hard problem stacked on top of each other:

1. **A reliability problem** — running a multi-step process safely, saving progress, resuming after a crash, talking to GitHub without duplicating comments, running code in a sandbox without letting it escape. This is *infrastructure* work. Get it wrong and the whole system is unsafe to use, regardless of how smart the AI reviewers are.

2. **A judgment problem** — deciding what counts as a real bug versus a guess, how much scrutiny a change deserves, whether a test actually proves anything, and how to write a report a human will trust. This is *review-quality* work. Get it wrong and the system might run perfectly and still give bad advice.

These two problems require different instincts, and mixing them across both people for every task adds coordination overhead for no benefit. So we split along that seam: **ABY = the plumbing and platform. Rijin = the reasoning and content.**

They still meet in the middle constantly — every stage below has ABY building the container and Rijin filling it — but each person always knows which half is theirs to decide.

---

## 3. What each person owns, in plain terms

### ABY — Platform & Reliability

Think of ABY as building the **factory floor**: the conveyor belts, the safety guards, the systems that make sure nothing falls through the cracks or happens twice.

Concretely, ABY is responsible for:

- **Talking to the outside world safely** — Git, GitHub, CI, and (eventually) Bob. Making sure we read commits correctly, don't accidentally run untrusted code, and don't post the same comment on GitHub twice.
- **Keeping track of where every review is** — has it started, is it stuck, did it crash halfway through, can it pick back up without redoing work or losing evidence.
- **The database and storage layer** — saving every review's evidence, findings, and decisions in a way that survives a crash and can be audited later.
- **The sandbox** — the isolated environment where tests and linters actually run, built so that a malicious pull request can't use it to access real systems or credentials.
- **The command-line tool itself** — what commands exist, what output they produce, how a person actually runs this thing.

**The test for "is this ABY's job?"**: if it's broken, does the *system* fail (crash, hang, duplicate an action, lose data) — regardless of whether any AI reviewer said anything smart? If yes, it's ABY's.

### Rijin — Review Quality & Reasoning

Think of Rijin as building the **inspectors on the factory floor**: the people who actually look at the product and decide if it's good, and who get to say "wait, I'm not sure about this part."

Concretely, Rijin is responsible for:

- **Understanding what a pull request is trying to do** — reading the description, the code, and any linked requirements, and writing a clear summary of intent before any checking starts.
- **Deciding how risky a change is** — is this a one-line typo fix or a change to how authentication works, and what level of scrutiny does that deserve.
- **The five specialist reviewers** — correctness, impact, tests, standards, and security. Rijin designs what each one looks for and how it's instructed.
- **Deciding whether a finding is actually true** — checking an AI reviewer's claim against the real code and real evidence, not just trusting it because it sounds plausible.
- **Writing the report content** — what goes in the "blocking findings" section versus "suggestions," and making sure nothing overstates what was actually checked.

**The test for "is this Rijin's job?"**: does it involve a judgment call about whether the *code being reviewed* is actually correct, risky, or well-tested? If yes, it's Rijin's.

---

## 4. Detailed responsibility table

This is the full breakdown, area by area, matching how the system is actually built.

| Area | ABY builds... | Rijin builds... |
|---|---|---|
| **Environment discovery** | Checks what the runtime, Git, CI, and storage actually support. Checks whether Bob can really do what we'd need it to do — never assumes a feature exists without confirming it. | Checks what AI models are available, what format standards documents come in, and what real review work is actually possible given those constraints. |
| **Data contracts** (the shared "shapes" of data both people's code depends on) | Defines the shapes for a review run, a repository snapshot, and a check result — the "did this actually happen, and how" records. | Defines the shapes for a review brief, a reviewer's assignment, a piece of evidence, and a finding — the "what did we conclude, and why" records. |
| **Core engine** | Builds the coordinator: the piece that tracks what stage a review is in and moves it to the next stage only when it's safe to. | Builds the planning logic: given a risk level, which reviewers get assigned, and what follow-up work gets triggered if they disagree. |
| **Intake** (reading in the PR) | Builds the adapters that read Git commits and a PR's metadata file safely. | Decides which parts of the surrounding code actually matter for understanding this specific change, and writes up what the change is trying to do. |
| **Risk assessment** | Makes sure a risk decision, once made, gets saved and actually causes the right follow-up work to happen. | Writes the actual rules: which kinds of changes are automatically treated as high-risk (auth, payments, migrations), and explains why in the report. |
| **Review execution** | Builds the scheduler: runs independent reviewers in parallel, enforces time/resource limits, and can cancel work cleanly if needed. | Builds and tunes the five specialist reviewers themselves, and the connection to whichever AI model they use. |
| **Validation** (checking findings) | Makes sure every finding can be traced back to the exact commit and file it came from — no stale or mismatched evidence. | Decides whether a finding is actually confirmed, needs more digging, or should be thrown out — and merges duplicate findings that are really the same issue. |
| **Verification** (running real checks) | Builds the sandboxed runner that actually executes tests/linters, and captures exactly what happened (pass, fail, timeout, crash). | Decides *which* checks are worth running for a given change, and reasons about whether a test failure is a new problem or a pre-existing one. |
| **Reporting** | Builds the CLI output and makes sure results get saved properly. | Writes what actually goes into the report — the wording, the structure, and the rule that "not checked" never gets described as "passed." |
| **Integrations** | Builds the connection to GitHub (and later Bob), including retry logic that won't double-post a comment if something fails partway. | Maps the internal findings into whatever format GitHub (or Bob) expects, and checks that the mapping doesn't lose important nuance. |
| **Testing** | Tests that the system survives a crash mid-review, doesn't lose evidence, and doesn't duplicate external actions like GitHub comments. | Tests that the *findings* are good — catches real bugs, handles ambiguous requirements sensibly, and holds up against deliberately tricky or misleading PRs. |
| **Documentation** | Writes the setup guide and day-to-day operating instructions. | Writes the architecture explanation, what the system's limitations are, and how we evaluated whether it actually works well. |

---

## 5. Shared responsibilities — things both people always do together

Some things are too important to split, because a mistake in either half can undermine the whole system:

- **Agreeing on data contracts before building separately.** If ABY and Rijin's code disagrees about what a "finding" looks like, nothing will fit together later. These shapes get agreed on *first*, before either person builds against them.
- **Reviewing each other's security-sensitive changes.** Anything touching code execution, publishing to GitHub, or applying a patch gets a second set of eyes from the other person before it ships — this is the part of the system where a small mistake has real consequences.
- **Doing a joint end-to-end test.** Before calling a milestone done, both people sit down together and run a real review, start to finish, and check that the evidence trail actually makes sense.
- **Keeping test data honest.** The fixtures used *while building* a feature must stay separate from the cases used *to judge* whether it actually works — otherwise it's easy to accidentally tune the system to pass its own test.

---

## 6. How this plays out across the build, milestone by milestone

Each milestone below is a working slice of the system — not just new files, but something that actually runs and gets tested.

| Milestone | ABY's part | Rijin's part | Done when... |
|---|---|---|---|
| **1. Foundation** | Set up environment discovery, the CLI skeleton, snapshotting, and storage. | Define the review-related data shapes, the risk rules, and a first set of test PR examples. | The system can read real Git commits, save a run, and produce a report on what the environment actually supports. |
| **2. Fixture workflow** | Build the coordinator, checkpointing, resuming after interruption, and the report output format. | Build fake ("mock") reviewers for testing, plus the logic that combines their fake findings into a report. | A clearly-labeled test run completes start to finish and can resume after being interrupted — but it does **not** claim to be a real review yet. |
| **3. Real static review** | Add proper limits, cancellation, privacy controls, and version tracking to the AI adapter. | Connect a real AI model, build the shared briefs, wire up the five specialist reviewers, and build finding validation. | A real code change produces real, traceable findings — or an honest "we couldn't fully check this" — without running any code yet. |
| **4. Sandboxed verification** | Build and test the actual execution sandbox and the list of allowed commands. | Decide which checks are worth running for a given change, and figure out how to tell a new bug from a pre-existing one. | Checks either run safely inside the sandbox, or are clearly marked as unavailable — never silently skipped. |
| **5. Integrations & patches** | Build GitHub publishing (with retry safety), caching for repeat reviews, and safe patch application. | Build the logic for which old findings are still valid after new commits, and how a patch gets proposed for approval. | Publishing never creates duplicate comments or stale results. A changed patch can never reuse an old approval. |
| **6. Hardening & evaluation** | Test failure scenarios, data retention, and audit logging. Set up CI. | Run adversarial tests (deliberately tricky PRs), evaluate against real held-out examples, and measure quality. | We can honestly report what works, what doesn't, and how confident we are — with real numbers, not guesses. |

---

## 7. A quick way to settle "whose job is this?"

If a task comes up that doesn't obviously fit the table above, ask:

> **"If this breaks, does the *system* fail, or does the *review* give bad advice?"**

- System fails (crash, hang, data loss, duplicate action, security hole) → **ABY**
- Review gives bad advice (wrong finding, missed bug, unfair risk call, confusing report) → **Rijin**

And if it's genuinely both — for example, a finding gets lost because of a storage bug — that's a sign the two halves need to talk, not a sign the split is wrong.
