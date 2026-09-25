/**
 * cli/index.ts — Entry point for the review-copilot CLI.
 *
 * Commands:
 *   capabilities            Report what the runtime actually supports
 *   review <base> <head>    Run or resume a review for a commit range
 *   report <run-id>         Show the report for a completed run
 *   runs                    List recent runs
 *   cancel <run-id>         Cancel a running or interrupted run
 *
 * IMPORTANT: Only documents commands after they are implemented.
 * Does not invent capabilities or claim successful runs.
 */
import { Command } from "commander";
import { capabilitiesCommand } from "./commands/capabilities.js";
import { reviewCommand } from "./commands/review.js";
import { reportCommand } from "./commands/report.js";
import { runsCommand } from "./commands/runs.js";

export function buildCli(): Command {
  const program = new Command();

  program
    .name("review-copilot")
    .description("Evidence-backed, risk-aware pull request review system")
    .version("0.1.0")
    .option("--store-dir <dir>", "Override the store directory (default: ./review-copilot-data)")
    .option("--policy <path>", "Path to the trusted policy JSON file")
    .option("--fixture-mode", "Run in fixture mode (no live model, labeled output)", false);

  program.addCommand(capabilitiesCommand());
  program.addCommand(reviewCommand());
  program.addCommand(reportCommand());
  program.addCommand(runsCommand());

  return program;
}
