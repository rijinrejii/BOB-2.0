/**
 * review/reviewers/security.ts — Security specialist reviewer.
 *
 * Investigates trust boundaries, authorization, validation, injection,
 * secrets, data exposure, dependencies, and abuse cases.
 * Never claims comprehensive security assurance.
 */
import type { ReviewerInput, ReviewerOutput } from "./types.js";
import { makeCandidate, evidenceIdsForPath, headCommitFromEvidence } from "./base.js";
import { invokeModelReviewer } from "./model-invocation.js";
import type { ReviewBrief } from "../../contracts/index.js";

export async function securityReviewer(input: ReviewerInput): Promise<ReviewerOutput> {
  const { assignment, brief, diffs, evidence, fixtureMode, model } = input;
  const candidates = [];
  const coverageNotes: string[] = [];
  const missingCapabilities: string[] = [];

  const headCommit = headCommitFromEvidence(evidence);

  for (const module of brief.affectedModules) {
    const diff = diffs[module.path];
    if (!diff) continue;

    const issues = detectSecurityIssues(diff, module.path);
    for (const issue of issues) {
      const evIds = evidenceIdsForPath(module.path, evidence);
      candidates.push(
        makeCandidate(
          {
            claim: issue.claim,
            affectedPath: module.path,
            headCommit,
            failureScenario: issue.scenario,
            preconditions: issue.preconditions,
            observedBehavior: issue.observed,
            expectedBehavior: issue.expected,
            expectedBehaviorSource: issue.sourceRef,
            evidenceIds: evIds,
            severity: issue.severity,
            severityRationale: issue.severityRationale,
            confidence: issue.confidence,
            confidenceRationale: `Security pattern: ${issue.pattern}`,
            categories: ["security"],
            mergeImpact: issue.severity === "critical" || issue.severity === "high" ? "blocking" : "non_blocking",
            recommendedNextStep: issue.recommendation,
            unresolvedAssumptions: issue.unresolvedAssumptions,
            underlyingCause: issue.cause,
            affectedBehavior: issue.affectedBehavior,
          },
          input,
        ),
      );
    }
  }

  if (!fixtureMode && model !== null && model.isAvailable()) {
    const modelResult = await invokeModelReviewer(input, "security", buildSecurityPrompt(brief, diffs));
    candidates.push(...modelResult.candidates);
    coverageNotes.push(...modelResult.coverageNotes);
    missingCapabilities.push(...modelResult.missingCapabilities);
  } else if (!fixtureMode && (model === null || !model.isAvailable())) {
    missingCapabilities.push("model: live model unavailable for security review");
    coverageNotes.push("Security review limited to static pattern detection; comprehensive analysis unavailable.");
  }

  coverageNotes.push("Security review does NOT claim comprehensive assurance. Static pattern analysis only.");

  return { assignmentId: assignment.assignmentId, candidates, coverageNotes, missingCapabilities };
}

interface SecurityIssue {
  claim: string;
  scenario: string;
  preconditions: string;
  observed: string;
  expected: string;
  sourceRef: string;
  severity: "low" | "medium" | "high" | "critical";
  severityRationale: string;
  confidence: "low" | "medium" | "high";
  pattern: string;
  cause: string;
  recommendation: string;
  unresolvedAssumptions: string[];
  affectedBehavior: string;
}

function detectSecurityIssues(diff: string, path: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const addedLines = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const addedText = addedLines.join("\n");

  // Hardcoded secrets / credentials
  const secretPatterns = [
    /(?:api[_-]?key|apikey|secret|password|passwd|token|credential|private[_-]?key)\s*[=:]\s*["'][^"']{8,}["']/i,
    /(?:Bearer|Basic)\s+[A-Za-z0-9+/=]{20,}/,
    /sk-[A-Za-z0-9]{20,}/, // OpenAI key pattern
    /[A-Za-z0-9]{32,40}/, // generic long tokens
  ];
  for (const pattern of secretPatterns.slice(0, 3)) { // skip generic long token
    if (pattern.test(addedText)) {
      issues.push({
        claim: `Possible hardcoded secret or credential added in ${path}`,
        scenario: "Credential committed to version control is leaked to anyone with repository access",
        preconditions: "File is committed and pushed to version control",
        observed: "Secret-like pattern detected in added lines",
        expected: "Secrets must never be hardcoded; use environment variables or a secrets manager",
        sourceRef: "Security: OWASP A02 Cryptographic Failures / hardcoded credentials",
        severity: "critical",
        severityRationale: "Hardcoded secrets are a critical vulnerability; immediate rotation required",
        confidence: "medium",
        pattern: pattern.toString().slice(0, 60),
        cause: "hardcoded_secret",
        recommendation: "Remove the secret, rotate it immediately, and use environment variables",
        unresolvedAssumptions: ["Pattern match may be a false positive; review exact line"],
        affectedBehavior: `Secret exposure in ${path}`,
      });
      break;
    }
  }

  // SQL injection risk — string concatenation with user input into SQL
  if (/query\s*\+|execute\s*\(.*\+|raw\s*`[^`]*\$\{/.test(addedText)) {
    issues.push({
      claim: `Possible SQL injection via string concatenation in ${path}`,
      scenario: "User input directly concatenated into SQL query is injectable",
      preconditions: "User-controlled input reaches this query construction",
      observed: "String concatenation or template literal in SQL query detected",
      expected: "All SQL queries must use parameterized queries or ORM methods",
      sourceRef: "Security: OWASP A03 Injection",
      severity: "high",
      severityRationale: "SQL injection can lead to data extraction, modification, or complete database compromise",
      confidence: "medium",
      pattern: "query concatenation",
      cause: "sql_injection_risk",
      recommendation: "Replace string concatenation with parameterized queries",
      unresolvedAssumptions: ["Input source may be controlled; requires caller trace"],
      affectedBehavior: `Data query integrity in ${path}`,
    });
  }

  // Missing authorization check in new route handler
  if (/router\.(get|post|put|delete|patch)\s*\(/i.test(addedText)) {
    const hasAuthCheck = /middleware|auth|require.*auth|isAuthenticated|authorize|guard|permission/i.test(addedText);
    if (!hasAuthCheck) {
      issues.push({
        claim: `New route handler added without visible authorization check in ${path}`,
        scenario: "Unauthenticated users can access the new endpoint",
        preconditions: "Route is reachable from the network",
        observed: "Route handler added without auth middleware in diff",
        expected: "All routes must apply appropriate authorization checks",
        sourceRef: "Security: OWASP A01 Broken Access Control",
        severity: "high",
        severityRationale: "Missing authorization check on route enables unauthorized access",
        confidence: "low",
        pattern: "router.get/post/put/delete without auth",
        cause: "missing_authorization",
        recommendation: "Add authorization middleware or document why this route is intentionally public",
        unresolvedAssumptions: ["Auth middleware may be applied at router/app level, not visible in diff"],
        affectedBehavior: `Route authorization in ${path}`,
      });
    }
  }

  // Unsafe deserialization / eval
  if (/\beval\s*\(|new Function\s*\(|JSON\.parse.*req\.|deserialize\s*\(/i.test(addedText)) {
    issues.push({
      claim: `Potentially unsafe deserialization or eval in ${path}`,
      scenario: "Attacker-controlled input passed to eval or unsafe deserialization",
      preconditions: "Input reaches the unsafe operation",
      observed: "eval / new Function / JSON.parse on request data detected",
      expected: "Never deserialize or eval untrusted input without strict schema validation",
      sourceRef: "Security: OWASP A08 Software and Data Integrity Failures",
      severity: "high",
      severityRationale: "eval-based code execution can lead to remote code execution",
      confidence: "medium",
      pattern: "eval/new Function/JSON.parse",
      cause: "unsafe_deserialization",
      recommendation: "Remove eval usage; validate all input with strict schemas before use",
      unresolvedAssumptions: ["Input source may be internal/trusted; requires caller trace"],
      affectedBehavior: `Data integrity and code execution in ${path}`,
    });
  }

  return issues;
}

function buildSecurityPrompt(brief: ReviewBrief, diffs: Record<string, string>): string {
  const boundaries = brief.trustBoundaries.join("\n") || "None identified.";
  const diffText = Object.entries(diffs)
    .slice(0, 5)
    .map(([path, diff]) => `### ${path}\n${diff.slice(0, 2000)}`)
    .join("\n\n");

  return `Review the following code changes for security issues.

## Trust Boundaries
${boundaries}

## Diffs
${diffText}

Investigate: authorization gaps, input validation, injection risks, secret exposure,
data leakage, and abuse cases.
NEVER claim comprehensive security assurance.
Return JSON array with fields: claim, affectedPath, failureScenario, preconditions,
observedBehavior, expectedBehavior, expectedBehaviorSource, severity, confidence,
mergeImpact, recommendedNextStep, underlyingCause, affectedBehavior.`;
}
