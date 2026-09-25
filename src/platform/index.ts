/**
 * platform/index.ts — Public exports for the platform layer.
 */
export { loadPolicy, PolicyLoadError } from "./policy.js";
export { discoverCapabilities } from "./capabilities.js";
export { redactSecrets } from "./redaction.js";
