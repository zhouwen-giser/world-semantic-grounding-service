import type { CapabilityDescriptor, OperationLock } from "@wsgs/gowm-gateway-client";

export type QuerySemanticPattern =
  | "REFERENCE_CURRENT_STATE"
  | "REFERENCE_GEOMETRY"
  | "REFERENCE_PROVENANCE"
  | "REFERENCE_EVENT_TIMELINE"
  | "REFERENCE_NEARBY"
  | "REFERENCE_IN_AREA"
  | "REFERENCE_CONTAINING_AREA"
  | "H3_NEIGHBORHOOD"
  | "H3_EXACT_VERIFY"
  | "EXTERNAL_CORRELATION_TIMELINE"
  | "EXTERNAL_PREDICATE_EVALUATION"
  | "TERRAIN_VISIBILITY";

export interface ExecutionBudgets {
  maximumNodes: number;
  maximumDepth: number;
  maximumRows: number;
  maximumCandidates: number;
  maximumOutputBytes: number;
  maximumExecutionMs: number;
}

export interface CompileInput {
  requestId: string;
  idempotencyKey: string;
  pattern: QuerySemanticPattern;
  requiredForProduct: string;
  operationInput: Record<string, unknown>;
  capabilities: CapabilityDescriptor[];
  operationLocks: OperationLock[];
  budgets: ExecutionBudgets;
}

export interface SchemaPort {
  schemaUri: string;
  schemaHash: string;
  valueKind: string;
  unitSemantics: string;
}

export interface WorldQueryNode {
  nodeId: string;
  operation: {
    operationId: string;
    operationVersion: string;
    inputSchemaHash: string;
    outputSchemaHash: string;
  };
  inputs: Record<string, {
    kind: "REQUEST_PATH" | "NODE_OUTPUT";
    port: SchemaPort;
    path?: string;
    nodeId?: string;
    outputPort?: string;
    targetPath?: string;
  }>;
  failurePolicy: "FAIL_FAST" | "ALLOW_PARTIAL";
  budget: {
    maximumRows: number;
    maximumCandidates: number;
    maximumOutputBytes: number;
    maximumExecutionMs: number;
  };
}

export interface WorldQueryPlanV2 {
  queryPlanVersion: "2.0";
  queryId: string;
  nodes: WorldQueryNode[];
  outputs: Array<{
    name: string;
    binding: {
      kind: "NODE_OUTPUT";
      port: SchemaPort;
      nodeId: string;
      outputPort: string;
    };
  }>;
  budgets: ExecutionBudgets;
}

export interface WorldQuerySubmission {
  requestId: string;
  idempotencyKey: string;
  plan: WorldQueryPlanV2;
  parameters: Record<string, unknown>;
  parameterSchemaHash: `sha256:${string}`;
}

export interface CapabilityGap {
  gapId: string;
  semanticCapability: string;
  reason: "NOT_REGISTERED" | "MATURITY_NOT_ALLOWED" | "SCHEMA_MISMATCH" | "PROVIDER_UNAVAILABLE" | "UNSUPPORTED_EXPRESSION" | "BUDGET_EXCEEDED";
  requiredForProduct: string;
  blocking: boolean;
  details: Record<string, unknown>;
}

export type CompileResult =
  | {
      status: "COMPILED";
      templateId: string;
      submission: WorldQuerySubmission;
      planHash: `sha256:${string}`;
      policy: { approximateInput: boolean; exactVerificationRequired: boolean };
    }
  | { status: "CAPABILITY_GAP"; gap: CapabilityGap };
