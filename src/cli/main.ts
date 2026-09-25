#!/usr/bin/env node
/**
 * cli/main.ts — CLI entry point.
 * Parsed by Commander; exits with code 1 on error.
 */
import { buildCli } from "./index.js";

const program = buildCli();

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
