/**
 * capabilities.ts — CapabilityReport: what the runtime actually supports.
 * ABY populates this at startup; review services read it to decide what is possible.
 */
import { z } from "zod";
import { ISOTimestamp, SemVer, Provenance } from "./common.js";

export const ModelCapabilityStatus = z.enum([
  "available",
  "unavailable",
  "prohibited_by_policy",
  "unchecked",
]);
export type ModelCapabilityStatus = z.infer<typeof ModelCapabilityStatus>;

export const VerificationCapabilityStatus = z.enum([
  "available",
  "unavailable",
  "sandboxed",
  "unchecked",
]);
export type VerificationCapabilityStatus = z.infer<typeof VerificationCapabilityStatus>;

export const CapabilityReport = z.object({
  schemaVersion: SemVer,
  reportId: z.string().uuid(),
  generatedAt: ISOTimestamp,
  provenance: Provenance,

  nodeVersion: z.string(),
  platform: z.string(),

  gitAvailable: z.boolean(),
  gitVersion: z.string().optional(),

  modelStatus: ModelCapabilityStatus,
  permittedModelIds: z.array(z.string()),
  externalTransmissionAllowed: z.boolean(),

  verificationStatus: VerificationCapabilityStatus,
  allowedCheckIds: z.array(z.string()),

  documentParsers: z.array(z.string()),
  storageAvailable: z.boolean(),

  limitations: z.array(z.string()),
});
export type CapabilityReport = z.infer<typeof CapabilityReport>;
