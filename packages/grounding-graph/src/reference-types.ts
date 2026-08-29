import type { GatewayRequestContext, OperationLock } from "@wsgs/gowm-gateway-client";
import type { MergedMention } from "./types.js";

export interface GatewayOperationExecutor {
  executeOperation(
    lock: OperationLock,
    request: Record<string, unknown>,
    context?: GatewayRequestContext
  ): Promise<{ status: number; value: unknown }>;
  pollJob(jobId: string, context?: GatewayRequestContext, intervalMs?: number): Promise<Record<string, unknown>>;
}

export interface ReferenceProduct {
  productId: string;
  productKind: "RESOLVED_REFERENCE";
  referenceKey: { namespace: "gowm"; kind: string; id: string; version: string };
  referenceType: string;
  displayName: string;
  matchedBy: string;
  matchScore: number;
  stateConfidence?: number;
  sourceOperation: "reference.resolve" | "VALIDATE_REFERENCES";
  sourceWorldVersion: number;
  validUntil?: string;
  revalidationRequired: boolean;
  safeSummary: Record<string, unknown>;
}

export interface GroundedMentionProduct extends MergedMention {
  status: "RESOLVED_EXACT" | "SUGGESTED_UNIQUE" | "AMBIGUOUS" | "UNRESOLVED" | "INVALID";
  candidateProductIds: string[];
}

export interface GroundingAmbiguityProduct {
  ambiguityId: string;
  mentionId: string;
  surfaceText: string;
  candidateProductIds: string[];
  reason: "MULTIPLE_EXACT_MATCHES" | "MULTIPLE_PLAUSIBLE_MATCHES";
}

export interface ReferenceValidationProduct {
  referenceKey: ReferenceProduct["referenceKey"];
  status: "VALID" | "STALE" | "EXPIRED" | "NOT_FOUND" | "TYPE_MISMATCH" | "VERSION_CONFLICT" | "SCOPE_DENIED";
  revalidationRequired: boolean;
  warnings: string[];
}

export interface ReferenceGroundingResult {
  mentions: GroundedMentionProduct[];
  referenceProducts: ReferenceProduct[];
  ambiguities: GroundingAmbiguityProduct[];
  unresolvedMentions: Array<{ mentionId: string; surfaceText: string; reason: string }>;
  validationResults: ReferenceValidationProduct[];
  worldVersion: number;
  resolverVersion: string;
}
