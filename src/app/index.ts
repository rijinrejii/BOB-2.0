/**
 * app/index.ts — Public exports for the app layer.
 */
export { ReviewCoordinator, type CoordinatorDeps, type ReviewRequest, type CoordinatorResult } from "./coordinator.js";
export { deriveRunId, type RunIdentityInputs } from "./run-identity.js";
export { renderReportJson, renderReportMarkdown } from "./report-renderer.js";
export { STAGES, NEXT_STAGE, type Stage, type RunStatus } from "./stages.js";
