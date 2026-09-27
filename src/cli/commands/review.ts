import { Command } from "commander";
import {
  mkdirSync,
  realpathSync,
} from "node:fs";
import {
  resolve,
  relative,
  isAbsolute,
  join,
} from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

import {
  loadPolicy,
  defaultFixturePolicy,
} from "../../platform/policy.js";
import { discoverCapabilities } from "../../platform/capabilities.js";
import { GitAdapter } from "../../adapters/git/git-adapter.js";
import { UnavailableExecutionAdapter } from "../../adapters/execution/unavailable-execution-adapter.js";
import { FileMetadataAdapter } from "../../adapters/metadata/file-metadata-adapter.js";
import { SqliteStore } from "../../adapters/sqlite/sqlite-store.js";
import { SqliteEvidenceAdapter } from "../../adapters/sqlite/sqlite-evidence-adapter.js";
import { ReviewCoordinator } from "../../app/coordinator.js";
import { acquireLocalRunLock } from "../../app/local-run-lock.js";
import { deriveRunId } from "../../app/run-identity.js";
import { renderReportMarkdown } from "../../app/report-renderer.js";
import { ReviewService } from "../../review/service.js";
import {
  Finding,
  ReviewReport,
} from "../../contracts/index.js";

const ENGINE_VERSION = "0.2.0-static";

interface Options {
  repo?: string;
  metadata?: string;
  policy?: string;
  storeDir?: string;
  fixtureMode?: boolean;
  staticOnly?: boolean;
  json?: boolean;
  timeout?: string;
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
}

function parseTimeout(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("--timeout must be a positive integer");
  }

  const timeout = Number(value);

  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new Error("--timeout must be a positive integer");
  }

  return timeout;
}

export function reviewCommand(): Command {
  const command = new Command("review")
    .description("Run a bounded local static review")
    .argument("<base>", "Base revision")
    .argument("<head>", "Head revision")
    .option("--repo <path>", "Repository path")
    .option("--metadata <path>", "PR metadata JSON")
    .option("--policy <path>", "Trusted policy JSON")
    .option("--store-dir <dir>", "Store directory outside the repository")
    .option("--fixture-mode", "Label this run as a fixture", false)
    .option("--static-only", "Explicitly accept static-only review", false)
    .option("--json", "Output report and finding records as JSON")
    .option("--timeout <ms>", "Stage-boundary deadline", "120000");

  command.action(async (
    baseRevision: string,
    headRevision: string,
    options: Options,
  ) => {
    if (!options.fixtureMode && !options.staticOnly) {
      throw new Error(
        "Live AI review is disabled. Use --static-only or --fixture-mode.",
      );
    }

    const fixtureMode = Boolean(options.fixtureMode);

    if (!fixtureMode && !options.policy) {
      throw new Error("--policy is required outside fixture mode");
    }

    const policy = options.policy
      ? loadPolicy(options.policy)
      : defaultFixturePolicy();

    const repositoryPath = realpathSync(resolve(options.repo ?? process.cwd()));

    const repository = new GitAdapter({
      repoPath: repositoryPath,
      maxFileSizeBytes: policy.maxFileSizeBytes,
    });

    const resolved = repository.resolveRevisions(baseRevision, headRevision);
    const timeoutMs = parseTimeout(options.timeout ?? "120000");

    const metadataAdapter = new FileMetadataAdapter();
    const metadataValue = options.metadata
      ? await metadataAdapter.loadRaw(resolve(options.metadata))
      : {};

    const metadataDigest = createHash("sha256")
      .update(JSON.stringify(metadataValue ?? {}))
      .digest("hex");

    // Include review mode and metadata content, not just Git commits.
    const effectiveInputHash = createHash("sha256")
      .update(JSON.stringify({
        policyHash: policy.contentHash,
        metadataDigest,
        fixtureMode,
        mode: "static-only",
      }))
      .digest("hex");

    const runId = deriveRunId({
      repositoryPath: resolved.repositoryPath,
      baseCommit: resolved.baseCommit,
      headCommit: resolved.headCommit,
      comparisonStrategy: "merge-base",
      policyContentHash: effectiveInputHash,
      engineVersion: ENGINE_VERSION,
    });

    const requestedStoreDir = resolve(
      options.storeDir ??
      process.env["REVIEW_COPILOT_STORE_DIR"] ??
      join(homedir(), ".review-copilot"),
    );

    // Reject the obvious unsafe path before creating directories.
    if (isWithin(repositoryPath, requestedStoreDir)) {
      throw new Error("Review storage must be outside the reviewed repository");
    }

    mkdirSync(requestedStoreDir, { recursive: true, mode: 0o700 });
    const storeDirectory = realpathSync(requestedStoreDir);

    // Check again after resolving filesystem symlinks.
    if (isWithin(repositoryPath, storeDirectory)) {
      throw new Error("Review storage resolves inside the reviewed repository");
    }

    const databasePath = join(storeDirectory, "review-copilot.db");
    const releaseLock = acquireLocalRunLock(databasePath);

    let store: SqliteStore | undefined;

    try {
      store = new SqliteStore({ databasePath });

      const evidence = new SqliteEvidenceAdapter(store);
      const verification = new UnavailableExecutionAdapter();

      const capabilities = discoverCapabilities(policy);
      capabilities.modelStatus = policy.externalTransmissionAllowed
        ? "unavailable"
        : "prohibited_by_policy";
      capabilities.storageAvailable = true;
      capabilities.limitations.push(
        "Live model invocation is disabled in the static-only milestone.",
      );

      const service = new ReviewService({
        repository,
        evidence,
        verification,
        model: null,
        store,
      });

      const coordinator = new ReviewCoordinator({
        store,
        repository,
        evidence,
        verification,
        // Use the exact metadata already hashed for run identity.
        metadata: {
          loadRaw: async () => structuredClone(metadataValue),
        },
        reviewServices: service,
      });

      const result = await coordinator.execute({
        runId,
        repositoryPath: resolved.repositoryPath,
        baseRevision: resolved.baseCommit,
        headRevision: resolved.headCommit,
        ...(options.metadata ? { prMetadataPath: resolve(options.metadata) } : {}),
        policy,
        capabilities,
        fixtureMode,
        engineVersion: ENGINE_VERSION,
        timeoutMs,
      });

      if (result.status !== "completed" || !result.report) {
        throw new Error(
          result.errorMessage ?? `Review ended with status ${result.status}`,
        );
      }

      const report = ReviewReport.parse(result.report);
      const findings = Finding.array().parse(
        await store.get(runId, "findings") ?? [],
      );

      if (options.json) {
        process.stdout.write(JSON.stringify({ report, findings }, null, 2) + "\n");
      } else {
        process.stdout.write(renderReportMarkdown(report, findings));
      }

      // Distinguish an executed but incomplete review from a clean result.
      process.exitCode = report.conclusions.includes("changes_required")
        ? 2
        : report.conclusions.includes("incomplete") ||
            report.conclusions.includes("human_decision_required")
          ? 3
          : 0;
    } finally {
      try {
        store?.close();
      } finally {
        releaseLock();
      }
    }
  });

  return command;
}
