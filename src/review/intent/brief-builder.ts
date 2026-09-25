/**
 * review/intent/brief-builder.ts — Builds a ReviewBrief from PR metadata and snapshot.
 *
 * PR metadata is untrusted data. It can never grant permissions or change policy.
 * Inferred intent is labelled as "inferred", not "stated".
 */
import { randomUUID } from "crypto";
import { z } from "zod";
import type { ReviewBrief, RepositorySnapshot } from "../../contracts/index.js";

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

/** Raw PR metadata schema — all fields optional since it's untrusted input */
const RawPRMetadata = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  baseBranch: z.string().optional(),
  headBranch: z.string().optional(),
  linkedRequirements: z.array(z.string()).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  authorNote: z.string().optional(),
});
type RawPRMetadata = z.infer<typeof RawPRMetadata>;

export interface BriefBuilderInput {
  runId: string;
  snapshot: RepositorySnapshot;
  /** Raw, untrusted PR metadata — must be validated before use */
  prMetadataRaw: unknown;
  /** File diffs keyed by path */
  diffs: Record<string, string>;
  /** File contents keyed by path */
  contents: Record<string, string>;
  /** Max files to include in context */
  maxContextFiles: number;
  /** Max bytes per file */
  maxFileSizeBytes: number;
}

export function buildReviewBrief(input: BriefBuilderInput): ReviewBrief {
  const { runId, snapshot, prMetadataRaw, diffs, contents, maxContextFiles, maxFileSizeBytes } = input;

  // Validate and sanitize PR metadata — treat it as untrusted data
  const parseResult = RawPRMetadata.safeParse(prMetadataRaw ?? {});
  const meta: RawPRMetadata = parseResult.success ? parseResult.data : {};

  const excludedFiles: ReviewBrief["excludedFiles"] = [];

  // Select context-bounded affected modules
  const allFiles = snapshot.changedFiles;
  const includedFiles = allFiles.slice(0, maxContextFiles);
  if (allFiles.length > maxContextFiles) {
    for (const f of allFiles.slice(maxContextFiles)) {
      excludedFiles.push({ path: f.path, reason: "Exceeded maxContextFiles limit" });
    }
  }

  // Check for oversized files
  const sizedFiles = includedFiles.filter((f) => {
    if (f.headSizeBytes !== null && f.headSizeBytes > maxFileSizeBytes) {
      excludedFiles.push({ path: f.path, reason: `File size ${f.headSizeBytes} exceeds maxFileSizeBytes ${maxFileSizeBytes}` });
      return false;
    }
    return true;
  });

  const affectedModules = sizedFiles.map((f) => ({
    path: f.path,
    role: inferFileRole(f.path),
  }));

  // Build acceptance criteria from PR metadata (stated) and infer from title
  const acceptanceCriteria: ReviewBrief["acceptanceCriteria"] = [];

  if (meta.acceptanceCriteria && meta.acceptanceCriteria.length > 0) {
    for (const [i, criterion] of meta.acceptanceCriteria.entries()) {
      acceptanceCriteria.push({
        id: `ac-${String(i + 1).padStart(3, "0")}`,
        description: criterion,
        source: "stated",
        sourceRef: "pr_metadata.acceptanceCriteria",
      });
    }
  } else if (meta.title) {
    // Infer a single acceptance criterion from title — clearly labelled as inferred
    acceptanceCriteria.push({
      id: "ac-001-inferred",
      description: `Inferred from PR title: "${meta.title}"`,
      source: "inferred",
      sourceRef: "pr_metadata.title",
    });
  }

  // Detect contradictions: if linked requirements conflict with stated criteria
  const assumptions: ReviewBrief["assumptions"] = [];
  if (!meta.acceptanceCriteria || meta.acceptanceCriteria.length === 0) {
    assumptions.push({
      id: "assume-001",
      description: "No explicit acceptance criteria provided; inferred from PR title only.",
      contradicted: false,
    });
  }

  const missingInformation: string[] = [];
  if (!meta.description || meta.description.trim().length === 0) {
    missingInformation.push("PR description is empty — intent cannot be confirmed from metadata.");
  }
  if (!meta.linkedRequirements || meta.linkedRequirements.length === 0) {
    missingInformation.push("No linked requirements — acceptance criteria cannot be traced to requirements.");
  }

  // Build trust boundary notes from file patterns
  const trustBoundaries: string[] = [];
  const dataFlows: string[] = [];

  for (const f of sizedFiles) {
    if (/api|route|handler|controller/i.test(f.path)) {
      trustBoundaries.push(`Public API boundary at ${f.path}`);
    }
    if (/middleware|auth|validation/i.test(f.path)) {
      trustBoundaries.push(`Trust enforcement point at ${f.path}`);
    }
    if (/database|db|repository|storage/i.test(f.path)) {
      dataFlows.push(`Data persistence layer: ${f.path}`);
    }
  }

  const intendedOutcome =
    meta.title
      ? `${meta.title}${meta.description ? `: ${meta.description.slice(0, 300)}` : ""}`
      : "Intended outcome not specified in PR metadata.";

  const changedBehavior = describeChangedBehavior(sizedFiles.map((f) => f.path), diffs);
  const unchangedBehavior = "Behavior of unchanged modules should remain unaffected.";

  const contextBounded = excludedFiles.length > 0;

  return {
    schemaVersion: "1.0.0",
    briefId: randomUUID(),
    runId,
    snapshotId: snapshot.snapshotId,
    createdAt: nowISO(),
    provenance: {
      source: "review/intent/brief-builder",
      runId,
      createdAt: nowISO(),
    },
    intendedOutcome,
    changedBehavior,
    unchangedBehavior,
    acceptanceCriteria,
    affectedModules,
    dataFlows,
    trustBoundaries,
    assumptions,
    missingInformation,
    humanDecisions: [],
    excludedFiles,
    contextBounded,
  };
}

/** Infer a simple role label from a file path */
function inferFileRole(path: string): string {
  if (/\.test\.(ts|js)$|\.spec\.(ts|js)$/.test(path)) return "test";
  if (/\.md$/.test(path)) return "documentation";
  if (/migration/i.test(path)) return "migration";
  if (/schema/i.test(path)) return "schema";
  if (/route|controller|handler/i.test(path)) return "api";
  if (/service/i.test(path)) return "service";
  if (/repository|store|db/i.test(path)) return "data";
  if (/config|settings/i.test(path)) return "configuration";
  if (/util|helper/i.test(path)) return "utility";
  return "source";
}

/** Build a human-readable summary of changed behavior from file paths and diffs */
function describeChangedBehavior(paths: string[], diffs: Record<string, string>): string {
  if (paths.length === 0) return "No files changed.";
  const summary = paths
    .slice(0, 5)
    .map((p) => {
      const diff = diffs[p];
      const addedLines = diff ? (diff.match(/^\+[^+]/gm) ?? []).length : 0;
      const removedLines = diff ? (diff.match(/^-[^-]/gm) ?? []).length : 0;
      return `${p} (+${addedLines}/-${removedLines})`;
    })
    .join(", ");

  const more = paths.length > 5 ? ` and ${paths.length - 5} more` : "";
  return `Changed files: ${summary}${more}.`;
}
