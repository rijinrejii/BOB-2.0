/**
 * cli/commands/report.ts
 *
 * `review-copilot report <run-id>` — Show the report for a completed run.
 */
import { Command } from "commander";
import { SqliteStore } from "../../adapters/sqlite/sqlite-store.js";
import { renderReportJson, renderReportMarkdown } from "../../app/report-renderer.js";
import type { ReviewReport } from "../../contracts/index.js";

export function reportCommand(): Command {
  const cmd = new Command("report");
  cmd.description("Show the report for a completed run");
  cmd.argument("<run-id>", "Run ID (UUID)");
  cmd.option("--store-dir <dir>", "Override the store directory");
  cmd.option("--json", "Output as JSON (default: Markdown)");

  cmd.action(
    async (
      runId: string,
      options: { storeDir?: string; json?: boolean },
    ) => {
      const dbPath = SqliteStore.resolveStorePath(options.storeDir);
      let store: SqliteStore;
      try {
        store = new SqliteStore({ databasePath: dbPath });
      } catch (err) {
        process.stderr.write(`Store initialization failed: ${(err as Error).message}\n`);
        process.exit(1);
      }

      try {
        const run = store.getRun(runId);
        if (!run) {
          process.stderr.write(`No run found with ID: ${runId}\n`);
          process.exit(1);
        }

        const report = await store.get(runId, "report") as ReviewReport | null;
        if (!report) {
          process.stderr.write(`No report available for run ${runId} (status: ${run.status}, stage: ${run.stage})\n`);
          process.exit(1);
        }

        if (options.json) {
          process.stdout.write(renderReportJson(report) + "\n");
        } else {
          process.stdout.write(renderReportMarkdown(report));
        }
      } finally {
        store.close();
      }
    },
  );

  return cmd;
}
