import type {
  CapabilityDescriptor,
  CapabilityPort,
  CapabilitySemanticEntry,
  CapabilitySemanticProfile,
  OperationAvailability,
  OperationLock,
  SnapshotSupport
} from "@wsgs/gowm-gateway-client";

export type QuerySemanticPattern =
  | "REFERENCE_IDENTITY"
  | "REFERENCE_CURRENT_STATE"
  | "REFERENCE_GEOMETRY"
  | "REFERENCE_PROVENANCE"
  | "CATALOG_SEARCH"
  | "REFERENCE_NEARBY"
  | "REFERENCE_IN_AREA"
  | "REFERENCE_INTERSECTIONS"
  | "PRIOR_RESULT_REVALIDATION"
  | "REFERENCE_EVENT_TIMELINE"
  | "REFERENCE_CONTAINING_AREA"
  | "H3_NEIGHBORHOOD"
  | "H3_EXACT_VERIFY"
  | "EXTERNAL_CORRELATION_TIMELINE"
  | "EXTERNAL_PREDICATE_EVALUATION"
  | "GDPS_LAND_COVER_AT_REFERENCE"
  | "GDPS_WETLANDS_IN_AREA"
  | "GDPS_OBSTACLES_NEAR_REFERENCE"
  | "GDPS_BLOCKED_AREAS_IN_AREA"
  | "GDPS_HIGH_GROUND_IN_AREA"
  | "GDPS_ELEVATION_AT_REFERENCE"
  | "GDPS_TRAVERSABILITY_EXPLAIN_AT_REFERENCE"
  | "GDPS_GENERIC_SAMPLE_VALUE"
  | "GDPS_GENERIC_PROFILE_VALUE"
  | "GDPS_GENERIC_FIND_CLASS"
  | "GDPS_GENERIC_FIND_RANGE"
  | "GDPS_GENERIC_VECTOR_IN_AREA"
  | "GDPS_GENERIC_VECTOR_NEARBY"
  | "GDPS_GENERIC_VECTOR_INTERSECTS"
  | "HISTORICAL_EXECUTION_INTERVAL"
  | "HISTORICAL_TRAJECTORY"
  | "TERRAIN_VISIBILITY";

export interface GdpsRecipeAuthorization {
  recipeId: string;
  semanticPattern: QuerySemanticPattern;
  recipeLockHash: `sha256:${string}`;
  descriptorId: string;
  descriptorHash: `sha256:${string}`;
  previewAuthorizationRequired: true;
  allowedOperations: ReadonlyArray<{
    operationId: string;
    operationVersion: string;
    inputSchemaHash: `sha256:${string}`;
    outputSchemaHash: `sha256:${string}`;
    semanticProfileHash: `sha256:${string}`;
  }>;
}

export interface ExecutionBudgets {
  maximumNodes: number;
  maximumDepth: number;
  maximumRows: number;
  maximumCandidates: number;
  maximumOutputBytes: number;
  maximumExecutionMs: number;
}

export type SnapshotMode = "LATEST_AT_START" | "PINNED" | "BEST_EFFORT";

export type QuerySnapshotPolicy =
  | { mode: "LATEST_AT_START"; allowDowngrade: false }
  | { mode: "BEST_EFFORT"; allowDowngrade: false }
  | { mode: "PINNED"; pinnedSnapshot: Record<string, unknown>; allowDowngrade: false };

export interface MaturityPolicy {
  allowPreview: boolean;
}

export interface CompileInput {
  requestId: string;
  idempotencyKey: string;
  pattern: QuerySemanticPattern;
  requiredForProduct: string;
  operationInput: Record<string, unknown>;
  /** Additional registered world-query parameters used by typed request bindings. */
  parameterValues?: Record<string, unknown>;
  capabilities: CapabilityDescriptor[];
  semanticProfiles: CapabilitySemanticEntry[];
  operationLocks: OperationLock[];
  availability: OperationAvailability[];
  maturityPolicy: MaturityPolicy;
  /** @deprecated Use gdpsRecipeAuthorization; names alone do not authorize PREVIEW operations. */
  previewRecipeIds?: readonly QuerySemanticPattern[];
  /** Exact descriptor and recipe lock entry authorizing a GDPS PREVIEW compilation. */
  gdpsRecipeAuthorization?: GdpsRecipeAuthorization;
  /** Independently loaded exact-byte hash of the trusted GDPS recipe-lock artifact. */
  trustedGdpsRecipeLockHash?: `sha256:${string}`;
  /** Canonical hash loaded through the verified GOWM consumer package. */
  parameterSchemaHash: `sha256:${string}`;
  degradedPolicy?: "ALLOW" | "REJECT";
  snapshotPolicy?: QuerySnapshotPolicy;
  observedAt?: string;
  budgets: ExecutionBudgets;
}

export type SchemaPort = Pick<
  CapabilityPort,
  "schemaUri" | "schemaHash" | "valueKind" | "unitSemantics"
>;

export type WorldQueryInputBinding =
  | { kind: "LITERAL"; port: SchemaPort; value: unknown; targetPath?: string }
  | { kind: "REQUEST_PATH"; port: SchemaPort; path: string; targetPath?: string }
  | {
      kind: "NODE_OUTPUT";
      port: SchemaPort;
      nodeId: string;
      outputPort: string;
      path?: string;
      targetPath?: string;
    };

export interface WorldQueryNode {
  nodeId: string;
  operation: {
    operationId: string;
    operationVersion: string;
    inputSchemaHash: string;
    outputSchemaHash: string;
  };
  inputs: Record<string, WorldQueryInputBinding>;
  failurePolicy: "FAIL_FAST" | "ALLOW_PARTIAL" | "SKIP_IF_PRECONDITION_FALSE";
  preconditions?: Array<
    | { kind: "NODE_STATUS"; nodeId: string; statuses: Array<"COMPLETED" | "PARTIAL" | "NO_DATA"> }
    | { kind: "VALUE_PRESENT"; binding: Extract<WorldQueryInputBinding, { kind: "NODE_OUTPUT" }> }
  >;
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
      path?: string;
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
  snapshotPolicy: QuerySnapshotPolicy;
}

export type CapabilityGapReason =
  | "NOT_REGISTERED"
  | "MATURITY_NOT_ALLOWED"
  | "SCHEMA_MISMATCH"
  | "SEMANTIC_MISMATCH"
  | "PORT_MISMATCH"
  | "OPERATION_UNAVAILABLE"
  | "OPERATION_DEGRADED"
  | "AVAILABILITY_STALE"
  | "AMBIGUOUS_MATCH"
  | "SNAPSHOT_UNSUPPORTED"
  | "EXACT_VERIFIER_REQUIRED"
  | "EXACT_VERIFIER_UNAVAILABLE"
  | "UNSUPPORTED_EXPRESSION"
  | "RECIPE_LOCK_DRIFT"
  | "DESCRIPTOR_LOCK_DRIFT"
  | "BUDGET_EXCEEDED";

export interface CapabilityGap {
  gapId: string;
  semanticCapability: string;
  reason: CapabilityGapReason;
  requiredForProduct: string;
  blocking: boolean;
  details: Record<string, unknown>;
}

export interface PortRequirement {
  name: string;
  valueKind: CapabilityPort["valueKind"];
  unitSemantics: CapabilityPort["unitSemantics"];
  schemaHash?: CapabilityPort["schemaHash"];
}

export interface SemanticCapabilityRequirement {
  requirementId: string;
  semanticCapability: string;
  requiredForProduct: string;
  domain: string;
  relationSemantics: readonly string[];
  acceptedReferenceKinds: readonly string[];
  producedReferenceKinds: readonly string[];
  spatialSemantics: string;
  timeSemantics: string;
  resultNature: string;
  inputPorts: readonly PortRequirement[];
  outputPorts: readonly PortRequirement[];
  snapshotMode: SnapshotMode;
  allowCandidateWithExactVerification?: boolean;
  allowedOperationKeys?: readonly string[];
  selectionPriority?: readonly string[];
}

export interface CapabilityBinding {
  requirementId: string;
  operationId: string;
  operationVersion: string;
  inputSchemaHash: string;
  outputSchemaHash: string;
  semanticProfileHash: string;
  maturity: "STABLE" | "PREVIEW";
  availability: "AVAILABLE" | "DEGRADED";
  snapshotSupport: SnapshotSupport;
  requiredPermissions: string[];
  matchEvidence: Record<string, unknown>;
  selectionPolicy: string;
}

export interface CapabilityMatchInput {
  requirement: SemanticCapabilityRequirement;
  capabilities: readonly CapabilityDescriptor[];
  semanticProfiles: readonly CapabilitySemanticEntry[];
  operationLocks: readonly OperationLock[];
  availability: readonly OperationAvailability[];
  maturityPolicy: MaturityPolicy;
  degradedPolicy: "ALLOW" | "REJECT";
  observedAt: string;
}

export interface MatchedCapability {
  descriptor: CapabilityDescriptor;
  lock: OperationLock;
  semanticProfile: CapabilitySemanticProfile;
  availability: OperationAvailability;
  binding: CapabilityBinding;
}

export type CapabilityMatchResult =
  | {
      status: "MATCHED";
      primary: MatchedCapability;
      exactVerification?: MatchedCapability;
    }
  | { status: "CAPABILITY_GAP"; gap: CapabilityGap };

export type CompileResult =
  | {
      status: "COMPILED";
      templateId: string;
      bindings: CapabilityBinding[];
      submission: WorldQuerySubmission;
      planHash: `sha256:${string}`;
      policy: {
        approximateInput: boolean;
        exactVerificationRequired: boolean;
        snapshotMode: SnapshotMode;
      };
    }
  | { status: "CAPABILITY_GAP"; gap: CapabilityGap };

export interface ResolvedPlanCapability {
  descriptor: CapabilityDescriptor;
  semanticProfile: CapabilitySemanticProfile;
  lock: OperationLock;
  availability: OperationAvailability;
}

export type {
  CapabilityDescriptor,
  CapabilityPort,
  CapabilitySemanticEntry,
  CapabilitySemanticProfile,
  OperationAvailability,
  OperationLock
};
