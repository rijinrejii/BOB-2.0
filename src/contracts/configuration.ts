/**
 * configuration.ts — ReviewConfiguration passed to the review engine at startup.
 */
import { z } from "zod";
import { SemVer } from "./common.js";

export const ReviewConfiguration = z.object({
  schemaVersion: SemVer,
  configId: z.string().uuid(),

  repositoryPath: z.string(),
  baseCommit: z.string(),
  headCommit: z.string(),
  prMetadataPath: z.string().optional(),

  fixtureMode: z.boolean().default(false),

  modelProvider: z.string().optional(),
  modelId: z.string().optional(),
  promptVersion: z.string().default("1.0.0"),

  maxContextFiles: z.number().int().positive().default(50),
  maxFileSizeBytes: z.number().int().positive().default(100_000),
  maxDependencyDepth: z.number().int().nonnegative().default(2),

  patchProposalsEnabled: z.boolean().default(false),
  incrementalReuseEnabled: z.boolean().default(false),

  timeoutMs: z.number().int().positive().default(120_000),
});
export type ReviewConfiguration = z.infer<typeof ReviewConfiguration>;
