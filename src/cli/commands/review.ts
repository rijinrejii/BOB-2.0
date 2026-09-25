/**
 * cli/commands/review.ts
 *
 * `review-copilot review <base> <head>` — Run or resume a review.
 *
 * Accepts explicit local Git revisions and structured PR metadata.
 * Resolves immutable snapshots. Saves evidence and stages results transactionally.
 * Resumes interrupted runs safely.
 */
import { Command } from "commander";
import { resolve } from "path";
import { loadPolicy, defaultFixturePolicy } from "../../platform/policy.js";
import { discoverCapabilities } from "../../platform/capabilities.js";
import { GitAdapter } from "../../adapters/git/git-adapter.js";
import { UnavailableExecutionAdapter } from "../../adapters/execution/unavailable-execution-adapter.js";
import { FileMetadataAdapter } from "../../adapters/metadata/file-metadata-adapter.js";
import { SqliteStore } from "../../adapters/sqlite/sqlite-store.js";
import { SqliteEvidenceAdapter } from "../../adapters/sqlite/sqlite-evidence-adapter.js";
import { ReviewCoordinator } from "../../app/coordinator.js";
import { deriveRunId } from "../../app/run-identity.js";
import { renderReportJson, renderReportMarkdown } from "../../app/report-renderer.js";
import { ReviewService } from "../../review/service.js";
import { UnavailableModelAdapter } from "../../adapters/models/unavailable.js";

const ENGINE_VERSION = "0.1.0";

export function reviewCommand(): Command {
  const cmd = new Command("review");
  cmd.description("Run or resume a review for a Git commit range");
  cmd.argument("<base>", "Base revision (commit SHA, branch, or tag)");
  cmd.argument("<head>", "Head revision (commit SHA, branch, or tag)");
  cmd.option("--repo <path>", "Path to the Git repository (default: cwd)");
  cmd.option("--metadata <path>", "Path to PR metadata JSON file");
  cmd.option("--policy <path>", "Path to trusted policy JSON file");
  cmd.option("--store-dir <dir>", "Override the store directory");
  cmd.option("--fixture-mode", "Run in fixture mode (labeled output, no live model)", false);
  cmd.option("--json", "Output report as JSON (default: Markdown)");
  cmd.option("--timeout <ms>", "Run timeout in milliseconds (default: 120000)", "120000");

  cmd.action(
    async (
      baseRev: string,
      headRev: string,
      options: {
        repo?: string;
        metadata?: string;
        policy?: string;
        storeDir?: string;
        fixtureMode?: boolean;
        json?: boolean;
        timeout?: string;
      },
    ) => {
      const repoPath = resolve(options.repo ?? process.cwd());
      const fixtureMode = options.fixtureMode ?? false;

      // Load policy (fail closed if invalid)
      let policy;
      if (options.policy) {
        try {
          policy = loadPolicy(options.policy);
        } catch (err) {
          process.stderr.write(`Policy load failed: ${(err as Error).message}\n`);
          process.exit(1);
        }
      } else if (fixtureMode) {
        policy = defaultFixturePolicy();
        process.stderr.write("Warning: No policy specified. Using fixture defaults (fixture mode only).\n");
      } else {
        process.stderr.write(
          "Error: --policy <path> is required for production reviews. " +
            "Pass --fixture-mode to run without a policy file.\n",
        );
        process.exit(1);
      }

      const capabilities = discoverCapabilities(policy);

      // Set up adapters
      const dbPath = SqliteStore.resolveStorePath(options.storeDir);
      let store: SqliteStore;
      try {
        store = new SqliteStore({ databasePath: dbPath });
      } catch (err) {
        process.stderr.write(`Store initialization failed: ${(err as Error).message}\n`);
        process.exit(1);
      }

      const gitAdapter = new GitAdapter({
        repoPath,
        maxFileSizeBytes: policy.maxFileSizeBytes,
      });

      const evidenceAdapter = new SqliteEvidenceAdapter(store);
      const metadataAdapter = new FileMetadataAdapter();
      const executionAdapter = new UnavailableExecutionAdapter();

      // Determine model adapter — never silently falls back
      const modelAdapter = capabilities.modelStatus === "available"
        ? null // Would load OpenAI adapter here when live
        : new UnavailableModelAdapter();

      const reviewService = new ReviewService({
        repository: gitAdapter,
        evidence: evidenceAdapter,
        model: modelAdapter,
        verification: executionAdapter,
      });

      // Derive stable run ID
      const runId = deriveRunId({
        repositoryPath: repoPath,
        baseCommit: baseRev,
        headCommit: headRev,
        comparisonStrategy: "merge-base",
        policyContentHash: policy.contentHash,
        engineVersion: ENGINE_VERSION,
      });

      const timeoutMs = parseInt(options.timeout ?? "120000", 10);

      if (!options.json) {
        process.stdout.write(`Starting review (run: ${runId})\n`);
        process.stdout.write(`  Repository: ${repoPath}\n`);
        process.stdout.write(`  Base: ${baseRev} → Head: ${headRev}\n`);
        if (fixtureMode) process.stdout.write("  Mode: FIXTURE (no live model)\n");
        process.stdout.write("\n");
      }

      const coordinator = new ReviewCoordinator({
        store,
        repository: gitAdapter,
        evidence: evidenceAdapter,
        metadata: metadataAdapter,
        verification: executionAdapter,
        reviewServices: reviewService,
      });

      let result;
      try {
        result = await coordinator.execute({
          runId,
          repositoryPath: repoPath,
          baseRevision: baseRev,
          headRevision: headRev,
          prMetadataPath: options.metadata,
          policy,
          capabilities,
          fixtureMode,
          engineVersion: ENGINE_VERSION,
          timeoutMs,
        });
      } catch (err) {
        process.stderr.write(`Review execution failed: ${(err as Error).message}\n`);
        store.close();
        process.exit(1);
      } finally {
        store.close();
      }

      if (result.status === "failed") {
        process.stderr.write(`Review failed at stage ${result.stage}: ${result.errorMessage ?? "unknown error"}\n`);
        process.exit(1);
      }

      if (!result.report) {
        process.stderr.write(`Review did not produce a report (status: ${result.status}, stage: ${result.stage})\n`);
        process.exit(1);
      }

      if (options.json) {
        process.stdout.write(renderReportJson(result.report) + "\n");
      } else {
        process.stdout.write(renderReportMarkdown(result.report));
      }
    },
  );

  return cmd;
}
