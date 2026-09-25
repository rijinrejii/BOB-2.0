/**
 * review/reviewers/tests.ts — Tests specialist reviewer.
 *
 * Maps changed behavior to assertions. Identifies missing negative cases.
 * Stubs, skipped tests, and assertion-free tests are NOT coverage.
 */
import type { ReviewerInput, ReviewerOutput } from "./types.js";
import { makeCandidate, evidenceIdsForPath, headCommitFromEvidence } from "./base.js";
import { invokeModelReviewer } from "./model-invocation.js";
import type { ReviewBrief } from "../../contracts/index.js";

export async function testsReviewer(input: ReviewerInput): Promise<ReviewerOutput> {
  const { assignment, brief, diffs, contents, evidence, fixtureMode, model } = input;
  const candidates = [];
  const coverageNotes: string[] = [];
  const missingCapabilities: string[] = [];

  const headCommit = headCommitFromEvidence(evidence);

  // Identify changed source files (non-test)
  const changedSourceFiles = brief.affectedModules
    .filter((m) => !isTestFile(m.path))
    .map((m) => m.path);

  // Identify test files
  const testFiles = brief.affectedModules
    .filter((m) => isTestFile(m.path))
    .map((m) => m.path);

  // Check for source changes without corresponding test changes
  for (const sourcePath of changedSourceFiles) {
    const diff = diffs[sourcePath];
    if (!diff) continue;

    const addedFunctions = extractAddedFunctionNames(diff);
    const hasTestForPath = testFiles.some((tp) =>
      tp.includes(sourceFileBaseName(sourcePath)) || tp.includes("index"),
    );

    if (addedFunctions.length > 0 && !hasTestForPath) {
      const evIds = evidenceIdsForPath(sourcePath, evidence);
      candidates.push(
        makeCandidate(
          {
            claim: `New functions added to ${sourcePath} without corresponding test file changes`,
            affectedPath: sourcePath,
            headCommit,
            failureScenario: "New behavior is untested; defects in new code go undetected",
            preconditions: "Test suite run after merge",
            observedBehavior: `Functions added: ${addedFunctions.join(", ")}; no test file changes detected`,
            expectedBehavior: "Every new behavior should have meaningful assertions",
            expectedBehaviorSource: "Tests review: behavior coverage requirement",
            evidenceIds: evIds,
            severity: "medium",
            severityRationale: "Untested new behavior can regress silently",
            confidence: "medium",
            confidenceRationale: "No matching test file found in snapshot; may exist elsewhere",
            categories: ["tests"],
            mergeImpact: "non_blocking",
            recommendedNextStep: "Add tests covering new functions and their edge cases",
            unresolvedAssumptions: ["Test files outside this snapshot may exist"],
            underlyingCause: "missing_test_coverage",
            affectedBehavior: `New functions in ${sourcePath}`,
          },
          input,
        ),
      );
    }
  }

  // Check existing test files for problematic patterns
  for (const testPath of testFiles) {
    const content = contents[testPath] ?? "";
    const diff = diffs[testPath] ?? "";
    const combinedText = content + diff;

    const problems = detectTestProblems(combinedText, testPath);
    for (const problem of problems) {
      const evIds = evidenceIdsForPath(testPath, evidence);
      candidates.push(
        makeCandidate(
          {
            claim: problem.claim,
            affectedPath: testPath,
            headCommit,
            failureScenario: problem.scenario,
            preconditions: "Test suite is run",
            observedBehavior: problem.observed,
            expectedBehavior: "Tests should make meaningful assertions on observable behavior",
            expectedBehaviorSource: "Tests review: assertion quality requirement",
            evidenceIds: evIds,
            severity: "low",
            severityRationale: "Weak tests provide false confidence but do not directly break behavior",
            confidence: "medium",
            confidenceRationale: `Pattern detected in test file: ${problem.pattern}`,
            categories: ["tests"],
            mergeImpact: "informational",
            recommendedNextStep: problem.recommendation,
            unresolvedAssumptions: [],
            underlyingCause: problem.cause,
            affectedBehavior: `Test coverage quality in ${testPath}`,
          },
          input,
        ),
      );
    }
  }

  if (!fixtureMode && model !== null && model.isAvailable()) {
    const modelResult = await invokeModelReviewer(input, "tests", buildTestsPrompt(brief, diffs, contents));
    candidates.push(...modelResult.candidates);
    coverageNotes.push(...modelResult.coverageNotes);
    missingCapabilities.push(...modelResult.missingCapabilities);
  } else if (!fixtureMode && (model === null || !model.isAvailable())) {
    missingCapabilities.push("model: live model unavailable for tests review");
    coverageNotes.push("Test semantic coverage analysis unavailable without model.");
  }

  if (changedSourceFiles.length > 0 && testFiles.length === 0) {
    coverageNotes.push("No test files found in snapshot for changed source files.");
  }

  return { assignmentId: assignment.assignmentId, candidates, coverageNotes, missingCapabilities };
}

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(path) || /\/__tests__\//.test(path);
}

function sourceFileBaseName(path: string): string {
  return path.replace(/\.[^.]+$/, "").replace(/.*\//, "");
}

function extractAddedFunctionNames(diff: string): string[] {
  const pattern = /^\+.*(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?\()/gm;
  const names: string[] = [];
  for (const match of diff.matchAll(pattern)) {
    const name = match[1] ?? match[2];
    if (name) names.push(name);
  }
  return names;
}

interface TestProblem {
  claim: string;
  scenario: string;
  observed: string;
  pattern: string;
  cause: string;
  recommendation: string;
}

function detectTestProblems(text: string, path: string): TestProblem[] {
  const problems: TestProblem[] = [];

  // Skipped tests
  if (/it\.skip|test\.skip|xit|xdescribe|\.skip\(/.test(text)) {
    problems.push({
      claim: `Skipped test(s) detected in ${path}`,
      scenario: "Skipped tests provide no coverage; defects they would catch are invisible",
      observed: "it.skip / test.skip / xit / xdescribe pattern found",
      pattern: "skip markers",
      cause: "skipped_test",
      recommendation: "Remove skip markers or document why the test is intentionally skipped",
    });
  }

  // Assertion-free tests (no expect/assert)
  const testBlocks = text.match(/it\(|test\(/g) ?? [];
  const assertions = text.match(/expect\(|assert\.|should\./g) ?? [];
  if (testBlocks.length > 0 && assertions.length === 0) {
    problems.push({
      claim: `Test file has test blocks but no assertions in ${path}`,
      scenario: "Tests with no assertions always pass, providing false coverage",
      observed: `${testBlocks.length} test block(s) found but 0 assertions`,
      pattern: "assertion-free tests",
      cause: "assertion_free_test",
      recommendation: "Add meaningful assertions to each test block",
    });
  }

  // Only stub/mock assertions
  if (/expect.*toHaveBeenCalled|expect.*toBeCalled/.test(text) &&
      !/expect.*toEqual|expect.*toBe[^C]|expect.*toMatch|expect.*toContain/.test(text)) {
    problems.push({
      claim: `Tests only assert on mocks/spies, not on observable behavior in ${path}`,
      scenario: "Mock-only assertions confirm invocation but not correctness of behavior",
      observed: "Only toHaveBeenCalled/toBeCalled assertions found",
      pattern: "stub-only assertions",
      cause: "stub_only_assertions",
      recommendation: "Add assertions on actual return values or observable side effects",
    });
  }

  return problems;
}

function buildTestsPrompt(
  brief: ReviewBrief,
  diffs: Record<string, string>,
  contents: Record<string, string>,
): string {
  const testPaths = Object.keys(contents).filter(isTestFile);
  const testContent = testPaths
    .slice(0, 3)
    .map((p) => `### ${p}\n${(contents[p] ?? "").slice(0, 1500)}`)
    .join("\n\n");

  return `Review test coverage for the following code changes.

## Changed Behavior
${brief.changedBehavior}

## Test Files
${testContent || "No test files found."}

Identify: missing test cases for new behavior, skipped tests, assertion-free tests,
tests that only assert on stubs. Return JSON array with standard finding fields.
Never claim a test catches a defect without supporting analysis.`;
}
