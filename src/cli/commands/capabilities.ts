/**
 * cli/commands/capabilities.ts
 *
 * `review-copilot capabilities` — Inspect and report actual runtime capabilities.
 */
import { Command } from "commander";
import { discoverCapabilities } from "../../platform/capabilities.js";
import { loadPolicy, defaultFixturePolicy } from "../../platform/policy.js";

export function capabilitiesCommand(): Command {
  const cmd = new Command("capabilities");
  cmd.description("Inspect and report actual runtime capabilities");
  cmd.option("--json", "Output as JSON");
  cmd.option("--policy <path>", "Path to trusted policy JSON file");

  cmd.action((options: { json?: boolean; policy?: string }) => {
    let policy;
    if (options.policy) {
      try {
        policy = loadPolicy(options.policy);
      } catch (err) {
        process.stderr.write(`Policy load failed: ${(err as Error).message}\n`);
        process.exit(1);
      }
    } else {
      policy = defaultFixturePolicy();
      if (!options.json) {
        process.stdout.write(
          "Note: No policy specified — using fixture defaults. " +
            "Pass --policy <path> for production capability discovery.\n\n",
        );
      }
    }

    const report = discoverCapabilities(policy);

    if (options.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      return;
    }

    // Human-readable output
    process.stdout.write("# Runtime Capabilities\n\n");
    process.stdout.write(`Node.js:     ${report.nodeVersion}\n`);
    process.stdout.write(`Platform:    ${report.platform}\n`);
    process.stdout.write(`Git:         ${report.gitAvailable ? `available (${report.gitVersion ?? "unknown version"})` : "UNAVAILABLE"}\n`);
    process.stdout.write(`Model:       ${report.modelStatus}\n`);
    process.stdout.write(`Storage:     ${report.storageAvailable ? "available (SQLite)" : "unavailable"}\n`);
    process.stdout.write(`Verification: ${report.verificationStatus}\n`);

    if (report.limitations.length > 0) {
      process.stdout.write("\nLimitations:\n");
      for (const lim of report.limitations) {
        process.stdout.write(`  - ${lim}\n`);
      }
    }

    if (report.permittedModelIds.length > 0) {
      process.stdout.write(`\nPermitted models: ${report.permittedModelIds.join(", ")}\n`);
    }

    if (report.allowedCheckIds.length > 0) {
      process.stdout.write(`Allowed checks: ${report.allowedCheckIds.join(", ")}\n`);
    }
  });

  return cmd;
}
