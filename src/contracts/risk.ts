/**
 * risk.ts — RiskAssessment: deterministic risk classification for a PR.
 * Rijin builds this using mandatory risk rules.
 */
import { z } from "zod";
import { ISOTimestamp, SemVer, RiskLevel, Provenance } from "./common.js";

export const MandatoryRiskFactor = z.enum([
  "authentication",
  "authorization",
  "secrets",
  "payments",
  "sensitive_data",
  "schema_migration",
  "public_api",
  "dependencies",
  "concurrency",
  "deployment_configuration",
  "destructive_operation",
  "blast_radius",
]);
export type MandatoryRiskFactor = z.infer<typeof MandatoryRiskFactor>;

export const RiskFactor = z.object({
  factorId: z.string(),
  /** Whether this factor triggers mandatory high-risk classification */
  mandatory: z.boolean(),
  mandatoryCategory: MandatoryRiskFactor.optional(),
  description: z.string(),
  /** Evidence that supports this risk factor */
  evidence: z.array(z.string()),
  /** How certain we are about this factor */
  certainty: z.enum(["certain", "probable", "possible"]),
});
export type RiskFactor = z.infer<typeof RiskFactor>;

export const RiskOverride = z.object({
  overrideId: z.string().uuid(),
  originalLevel: RiskLevel,
  overriddenLevel: RiskLevel,
  authorizedBy: z.string(),
  auditReason: z.string(),
  authorizedAt: ISOTimestamp,
});
export type RiskOverride = z.infer<typeof RiskOverride>;

export const RiskAssessment = z.object({
  schemaVersion: SemVer,
  assessmentId: z.string().uuid(),
  runId: z.string().uuid(),
  briefId: z.string().uuid(),
  createdAt: ISOTimestamp,
  provenance: Provenance,

  level: RiskLevel,
  /** When true, level was determined by a mandatory rule — only a human override can change it */
  mandatoryClassification: z.boolean(),
  mandatoryFactors: z.array(MandatoryRiskFactor),

  impactAssessment: z.string(),
  uncertaintyAssessment: z.string(),

  factors: z.array(RiskFactor),

  /** Human override, if applied */
  override: RiskOverride.optional(),

  /** If risk escalated from a lower estimate, list newly required reviewer categories */
  escalationRequiredAssignments: z.array(z.string()),
});
export type RiskAssessment = z.infer<typeof RiskAssessment>;
