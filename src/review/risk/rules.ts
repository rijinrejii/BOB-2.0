/**
 * review/risk/rules.ts — Deterministic mandatory risk rules.
 *
 * Each rule checks evidence patterns and returns a matched factor when triggered.
 * Mandatory rules always produce HIGH risk; only a human override can change that.
 */
import type { ReviewBrief } from "../../contracts/index.js";
import { MandatoryRiskFactor } from "../../contracts/index.js";
import type { z } from "zod";

type MandatoryRiskFactorValue = z.infer<typeof MandatoryRiskFactor>;

export interface RuleMatch {
  mandatory: boolean;
  mandatoryCategory?: MandatoryRiskFactorValue;
  factorId: string;
  description: string;
  evidence: string[];
  certainty: "certain" | "probable" | "possible";
}

/** File path patterns that trigger mandatory rules */
const MANDATORY_PATTERNS: Array<{
  category: MandatoryRiskFactorValue;
  pathPatterns: RegExp[];
  contentPatterns: RegExp[];
  description: string;
}> = [
  {
    category: "authentication",
    pathPatterns: [/auth/i, /login/i, /session/i, /token/i, /jwt/i, /oauth/i, /credential/i],
    contentPatterns: [/authenticate|authorization|verify.*token|login|logout|session/i],
    description: "Change touches authentication logic",
  },
  {
    category: "authorization",
    pathPatterns: [/authz/i, /permission/i, /role/i, /access-control/i, /policy/i, /acl/i, /guard/i],
    contentPatterns: [/isAuthorized|hasRole|canAccess|checkPermission|requireRole/i],
    description: "Change touches authorization or access control",
  },
  {
    category: "secrets",
    pathPatterns: [/secret/i, /credential/i, /key/i, /password/i, /\.env/i, /config.*prod/i],
    contentPatterns: [/apiKey|secret|password|token|credential|private.*key/i],
    description: "Change touches secrets, credentials, or keys",
  },
  {
    category: "payments",
    pathPatterns: [/payment/i, /billing/i, /invoice/i, /stripe/i, /paypal/i, /charge/i, /checkout/i],
    contentPatterns: [/charge|payment|billing|invoice|refund|stripe|paypal/i],
    description: "Change touches payment or billing logic",
  },
  {
    category: "sensitive_data",
    pathPatterns: [/pii/i, /gdpr/i, /personal/i, /privacy/i, /health/i, /financial/i],
    contentPatterns: [/ssn|passport|dateOfBirth|healthRecord|personalData/i],
    description: "Change touches sensitive or personally identifiable data",
  },
  {
    category: "schema_migration",
    pathPatterns: [/migration/i, /migrate/i, /schema/i, /database/i, /db\/schema/i, /knex/i, /sequelize/i],
    contentPatterns: [/ALTER TABLE|DROP TABLE|CREATE TABLE|addColumn|removeColumn|renameTable/i],
    description: "Change includes database schema migration",
  },
  {
    category: "public_api",
    pathPatterns: [/routes/i, /api/i, /endpoint/i, /controller/i, /handler/i, /router/i],
    contentPatterns: [/router\.(get|post|put|delete|patch)|app\.(get|post|put|delete)|@(Get|Post|Put|Delete)/i],
    description: "Change modifies a public API endpoint",
  },
  {
    category: "dependencies",
    pathPatterns: [/package\.json$/, /package-lock\.json$/, /yarn\.lock$/, /requirements\.txt$/, /go\.mod$/],
    contentPatterns: [],
    description: "Change modifies external dependencies",
  },
  {
    category: "destructive_operation",
    pathPatterns: [/delete/i, /remove/i, /purge/i, /drop/i, /truncate/i],
    contentPatterns: [/\.delete\(|\.remove\(|\.destroy\(|\.drop\(|\.truncate\(|DELETE FROM|DROP TABLE/i],
    description: "Change includes destructive data operations",
  },
];

interface FileEvidence {
  path: string;
  diff: string | undefined;
  content: string | undefined;
}

/** Check if a file path matches any of the regex patterns */
function matchesPathPatterns(path: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(path));
}

/** Check if text content matches any content patterns */
function matchesContentPatterns(content: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(content));
}

/** Estimate blast radius from changed file count and line changes */
function assessBlastRadius(brief: ReviewBrief): RuleMatch | null {
  const fileCount = brief.affectedModules.length;
  // High blast radius: >20 files affected or core-looking modules
  const hasCoreModules = brief.affectedModules.some((m) =>
    /index|main|app|server|core|bootstrap/i.test(m.path),
  );

  if (fileCount > 20 || hasCoreModules) {
    return {
      mandatory: true,
      mandatoryCategory: "blast_radius",
      factorId: "blast-radius",
      description: `Large blast radius: ${fileCount} modules affected${hasCoreModules ? ", includes core modules" : ""}`,
      evidence: brief.affectedModules.slice(0, 5).map((m) => m.path),
      certainty: fileCount > 20 ? "certain" : "probable",
    };
  }
  return null;
}

/** Assess concurrency risk from diff/content */
function assessConcurrency(files: FileEvidence[]): RuleMatch | null {
  const concurrencyPatterns = /mutex|lock|semaphore|atomic|race|concurrent|synchronized|async.*await|Promise\.all/i;
  const matches: string[] = [];
  for (const f of files) {
    const text = (f.diff ?? "") + (f.content ?? "");
    if (concurrencyPatterns.test(text)) {
      matches.push(f.path);
    }
  }
  if (matches.length > 0) {
    return {
      mandatory: true,
      mandatoryCategory: "concurrency",
      factorId: "concurrency-patterns",
      description: "Change involves concurrency primitives or async coordination",
      evidence: matches.slice(0, 3),
      certainty: "probable",
    };
  }
  return null;
}

/**
 * Run all mandatory risk rules against the brief and file evidence.
 * Returns an array of matched factors.
 */
export function applyMandatoryRules(brief: ReviewBrief, files: FileEvidence[]): RuleMatch[] {
  const matches: RuleMatch[] = [];
  const seenCategories = new Set<string>();

  for (const rule of MANDATORY_PATTERNS) {
    const evidence: string[] = [];

    for (const file of files) {
      const pathMatch = matchesPathPatterns(file.path, rule.pathPatterns);
      const contentText = (file.diff ?? "") + (file.content ?? "");
      const contentMatch =
        rule.contentPatterns.length > 0
          ? matchesContentPatterns(contentText, rule.contentPatterns)
          : false;

      if (pathMatch || contentMatch) {
        evidence.push(
          pathMatch ? `path: ${file.path}` : `content pattern in ${file.path}`,
        );
      }
    }

    if (evidence.length > 0 && !seenCategories.has(rule.category)) {
      seenCategories.add(rule.category);
      matches.push({
        mandatory: true,
        mandatoryCategory: rule.category,
        factorId: `mandatory-${rule.category}`,
        description: rule.description,
        evidence,
        certainty: "certain",
      });
    }
  }

  // Blast radius check
  const blastMatch = assessBlastRadius(brief);
  if (blastMatch && !seenCategories.has("blast_radius")) {
    matches.push(blastMatch);
  }

  // Concurrency check
  const concurrencyMatch = assessConcurrency(files);
  if (concurrencyMatch && !seenCategories.has("concurrency")) {
    matches.push(concurrencyMatch);
  }

  return matches;
}

/**
 * Assess non-mandatory risk signals that may raise from LOW to MEDIUM.
 */
export function assessInformationalRisk(brief: ReviewBrief, files: FileEvidence[]): RuleMatch[] {
  const signals: RuleMatch[] = [];

  // Missing acceptance criteria is a signal of uncertainty
  if (brief.acceptanceCriteria.length === 0) {
    signals.push({
      mandatory: false,
      factorId: "missing-acceptance-criteria",
      description: "No acceptance criteria found — cannot confirm intended behavior",
      evidence: ["Brief has no acceptance criteria"],
      certainty: "certain",
    });
  }

  // Ambiguous or contradicted assumptions
  const contradicted = brief.assumptions.filter((a) => a.contradicted);
  if (contradicted.length > 0) {
    signals.push({
      mandatory: false,
      factorId: "contradicted-assumptions",
      description: `${contradicted.length} assumption(s) are contradicted by other evidence`,
      evidence: contradicted.map((a) => a.id),
      certainty: "probable",
    });
  }

  // Missing information
  if (brief.missingInformation.length > 0) {
    signals.push({
      mandatory: false,
      factorId: "missing-information",
      description: "Review brief has missing information that limits analysis",
      evidence: brief.missingInformation.slice(0, 3),
      certainty: "certain",
    });
  }

  // Configuration file changes
  const configFiles = files.filter((f) => /\.json$|\.yaml$|\.yml$|\.toml$|\.ini$|\.conf$/i.test(f.path));
  if (configFiles.length > 0) {
    signals.push({
      mandatory: false,
      factorId: "configuration-changes",
      description: "Change includes configuration file modifications",
      evidence: configFiles.slice(0, 3).map((f) => f.path),
      certainty: "certain",
    });
  }

  return signals;
}
