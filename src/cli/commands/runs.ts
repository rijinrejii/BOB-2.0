/**
 * cli/commands/runs.ts
 *
 * `review-copilot runs` — List recent runs and their status.
 */
import { Command } from "commander";
import { SqliteStore } from "../../adapters/sqlite/sqlite-store.js";
import type { ReviewRun } from "../../contracts/index.js";

export function runsCommand(): Command {
  const cmd = new Command("runs");
  cmd.description("List recent runs and their status");
  cmd.option("--store-dir <dir>", "Override the store directory");
  cmd.option("--json", "Output as JSON");
  cmd.option("--limit <n>", "Maximum number of runs to show (default: 20)", "20");

  cmd.action(
    async (options: { storeDir?: string; json?: boolean; limit?: string }) => {
      const dbPath = SqliteStore.resolveStorePath(options.storeDir);
      let store: SqliteStore;
      try {
        store = new SqliteStore({ databasePath: dbPath });
      } catch (err) {
        process.stderr.write(`Store initialization failed: ${(err as Error).message}\n`);
        process.exit(1);
      }

      try {
        const rows = store.listRuns(parseInt(options.limit ?? "20", 10));

        if (options.json) {
          process.stdout.write(JSON.stringify(rows.map((r) => ({
            runId: r.runId,
            status: r.status,
            stage: r.stage,
            fixtureMode: r.fixtureMode,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          })), null, 2) + "\n");
          return;
        }

        if (rows.length === 0) {
          process.stdout.write("No runs found.\n");
          return;
        }

        process.stdout.write(`${"Run ID".padEnd(40)} ${"Status".padEnd(12)} ${"Stage".padEnd(20)} ${"Fixture".padEnd(8)} Updated\n`);
        process.stdout.write(`${"-".repeat(40)} ${"-".repeat(12)} ${"-".repeat(20)} ${"-".repeat(8)} ${"-".repeat(24)}\n`);

        for (const row of rows) {
          const data = row.data as ReviewRun;
          const repo = (data.repositoryPath ?? "").slice(-30);
          const fixture = row.fixtureMode ? "yes" : "no";
          process.stdout.write(
            `${row.runId.padEnd(40)} ${row.status.padEnd(12)} ${row.stage.padEnd(20)} ${fixture.padEnd(8)} ${row.updatedAt}\n`,
          );
          if (repo) {
            process.stdout.write(`  repo: ${repo}\n`);
          }
        }
      } finally {
        store.close();
      }
    },
  );

  return cmd;
}
