/**
 * review/risk/index.ts
 */
export { buildRiskAssessment } from "./assessor.js";
export type { RiskAssessorInput } from "./assessor.js";
export { applyMandatoryRules, assessInformationalRisk } from "./rules.js";
export type { RuleMatch } from "./rules.js";
