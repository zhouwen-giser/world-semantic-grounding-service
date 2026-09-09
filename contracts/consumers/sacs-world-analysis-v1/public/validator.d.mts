import type { GroundingResult12 } from "./generated/grounding-result-1.2.js";
import type { WorldAnalysisFindings } from "./generated/world-analysis-findings.js";

export const contractVersion: "sacs-wsgs-grounding/1.2";
export const resultProfile: "wsgs-world-analysis-findings/1.0";
export interface PublicValidationError { code: string; path: string; keyword?: string; }
export interface PublicValidationResult { valid: boolean; errors: PublicValidationError[]; }
export function createPublicValidator(): (kind: string, value: unknown, options?: { maxResultBytes?: number }) => PublicValidationResult;
export function canonicalJson(value: unknown): string;
export function canonicalHash(value: unknown): `sha256:${string}`;
export function findingSetHash(component: Omit<WorldAnalysisFindings, "findingSetHash"> | WorldAnalysisFindings): `sha256:${string}`;
export function resultHash(result: GroundingResult12): `sha256:${string}`;
export function isWorldAnalysisTransport(version: unknown, profile: unknown, authorized: boolean): boolean;
export function aggregateAnalysisStatus(component: WorldAnalysisFindings, cancelled?: boolean): "COMPLETED" | "PARTIAL" | "AMBIGUOUS" | "UNRESOLVED" | "FAILED" | "CANCELLED";
