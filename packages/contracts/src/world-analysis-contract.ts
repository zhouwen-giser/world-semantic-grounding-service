import * as contract from "./world-analysis/validator.mjs";
import type { WorldAnalysisFindings } from "./world-analysis/generated/world-analysis-findings.js";
import type { GroundingResult12 } from "./world-analysis/generated/grounding-result-1.2.js";

export const contractVersion = "sacs-wsgs-grounding/1.2" as const;
export const resultProfile = "wsgs-world-analysis-findings/1.0" as const;
export interface WorldAnalysisValidationIssue { code: string; path: string; keyword?: string }
export interface WorldAnalysisValidationResult { valid: boolean; errors: WorldAnalysisValidationIssue[] }
export type WorldAnalysisPublicValidator = (kind: string, value: unknown, options?: { maxResultBytes?: number }) => WorldAnalysisValidationResult;
export function createPublicValidator(): WorldAnalysisPublicValidator {
  return contract.createPublicValidator();
}
export function canonicalJson(value: unknown): string { return contract.canonicalJson(value); }
export function canonicalHash(value: unknown): `sha256:${string}` { return contract.canonicalHash(value) as `sha256:${string}`; }
export function findingSetHash(component: Omit<WorldAnalysisFindings, "findingSetHash">): `sha256:${string}` {
  return contract.findingSetHash(component) as `sha256:${string}`;
}
export function resultHash(result: GroundingResult12): `sha256:${string}` { return contract.resultHash(result) as `sha256:${string}`; }
export function aggregateAnalysisStatus(component: WorldAnalysisFindings, cancelled = false): GroundingResult12["status"] {
  return contract.aggregateAnalysisStatus(component, cancelled);
}
