/**
 * common.ts — Shared primitive types used across all contracts.
 */
import { z } from "zod";

/** ISO-8601 UTC timestamp string */
export const ISOTimestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, "Expected ISO-8601 UTC timestamp");

/** Semantic version string */
export const SemVer = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "Expected semver x.y.z");

/** SHA-1 or SHA-256 hex commit hash */
export const CommitSha = z
  .string()
  .regex(/^[0-9a-f]{7,64}$/, "Expected hex commit SHA");

/** SHA-256 hex content hash */
export const ContentHash = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Expected 64-char hex SHA-256");

/** Relative file path within a repository */
export const FilePath = z.string().min(1).max(4096);

/** Line range (1-indexed, inclusive) */
export const LineRange = z.object({
  start: z.number().int().positive(),
  end: z.number().int().positive(),
}).refine((r) => r.end >= r.start, "end must be >= start");

/** Severity classification */
export const Severity = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof Severity>;

/** Confidence classification */
export const Confidence = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof Confidence>;

/** Risk level */
export const RiskLevel = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

/** Provenance records the origin of a piece of data */
export const Provenance = z.object({
  source: z.string(),
  runId: z.string().uuid().optional(),
  createdAt: ISOTimestamp,
  contentHash: ContentHash.optional(),
});
export type Provenance = z.infer<typeof Provenance>;

export type LineRange = z.infer<typeof LineRange>;
