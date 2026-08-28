export type CapabilityMaturity = "PLANNED" | "EXPERIMENTAL" | "PREVIEW" | "STABLE" | "DEPRECATED" | "RETIRED";
export type OperationAvailabilityStatus = "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "DISABLED";
export type SnapshotSupport = "NONE" | "BEST_EFFORT" | "CONSISTENT_AT_START" | "PINNED";
export type Sha256Digest = `sha256:${string}`;
export type CapabilitySemanticRole =
  | "FOUNDATION_PRIMITIVE"
  | "FOUNDATION_DATA_QUERY"
  | "GENERIC_ANALYSIS"
  | "DOMAIN_ANALYSIS"
  | "PROJECTION_QUERY";
export type CapabilityDataBinding =
  | "WORLD_INDEPENDENT"
  | "CALLER_DATA_BOUND"
  | "WORLD_SNAPSHOT_BOUND"
  | "DATASET_VERSION_BOUND";
export type CapabilityResultSemantics =
  | "TRANSFORMATION"
  | "VALIDATION"
  | "DERIVED_INDEX"
  | "DATA_QUERY"
  | "DERIVED_ANALYSIS"
  | "WORLD_PROJECTION";
export type CapabilityExecutionBinding =
  | "EMBEDDED_SDK"
  | "LOCAL_SIDECAR"
  | "SYNC_HTTP"
  | "ASYNC_JOB"
  | "VERSIONED_SQL_CONTRACT";
export type CapabilityCriticalPathPolicy =
  | "EMBEDDED_REQUIRED"
  | "LOCAL_PREFERRED"
  | "REMOTE_ALLOWED"
  | "REMOTE_ONLY";
export type CapabilityScopePolicy =
  | "IDENTITY_ONLY"
  | "REQUEST_CONTEXT"
  | "DATA_SCOPE_REQUIRED"
  | "DATASET_SCOPE_REQUIRED";

export interface CapabilityPort {
  name: string;
  schemaUri: string;
  schemaHash: Sha256Digest;
  valueKind:
    | "ANY"
    | "SCALAR"
    | "POSITION"
    | "POSITIONS"
    | "GEOMETRY"
    | "FEATURE"
    | "FEATURE_COLLECTION"
    | "H3_CELL"
    | "H3_CELL_SET"
    | "REFERENCE_KEY"
    | "DATASET_VERSION"
    | "ROW_SET"
    | "ARTIFACT_REFERENCE";
  unitSemantics: "UNSPECIFIED" | "DIMENSIONLESS" | "ANGULAR_DEGREES" | "LINEAR_METERS" | "DISCRETE";
  path?: string;
}

export interface CapabilitySemanticProfile {
  profileVersion: string;
  domain: string;
  relationSemantics: string[];
  acceptedReferenceKinds: string[];
  producedReferenceKinds: string[];
  spatialSemantics: string;
  timeSemantics: string;
  freshnessSemantics: string;
  resultNature: string;
  negativeEvidencePolicy: string;
  exactVerification?: { operationId: string; operationVersion: string };
  [key: string]: unknown;
}

export interface CapabilityDescriptor {
  operationId: string;
  operationVersion: string;
  semanticRole: CapabilitySemanticRole;
  dataBinding: CapabilityDataBinding;
  resultSemantics: CapabilityResultSemantics;
  executionBindings: CapabilityExecutionBinding[];
  criticalPathPolicy: CapabilityCriticalPathPolicy;
  maturity: CapabilityMaturity;
  inputSchemaUri: string;
  inputSchemaHash: Sha256Digest;
  outputSchemaUri: string;
  outputSchemaHash: Sha256Digest;
  scopePolicy: CapabilityScopePolicy;
  ports: { inputs: CapabilityPort[]; outputs: CapabilityPort[] };
  semanticProfile?: CapabilitySemanticProfile;
  execution: {
    costClass: "LOW" | "MEDIUM" | "HIGH";
    mode: "SYNC" | "ASYNC" | "SYNC_OR_ASYNC";
    defaultTimeoutMs: number;
    maximumTimeoutMs: number;
  };
  limits: {
    maximumInputBytes?: number;
    maximumOutputBytes?: number;
    maximumRows?: number;
    maximumVertices?: number;
    maximumCells?: number;
    maximumCandidates?: number;
    maximumBatchItems?: number;
    maximumQueueDepth?: number;
  };
  snapshotPolicy: { dataSnapshot: "NONE" | "OPTIONAL" | "REQUIRED"; computeSnapshot: "REQUIRED" };
  [key: string]: unknown;
}

export interface CapabilityCatalog {
  registryVersion: string;
  registryRevision?: string;
  contractCatalogRevision: Sha256Digest;
  bindingRevision: Sha256Digest;
  capabilities: CapabilityDescriptor[];
}

export interface CapabilitySemanticEntry {
  operationId: string;
  operationVersion: string;
  semanticProfile: CapabilitySemanticProfile;
  semanticProfileHash: Sha256Digest;
}

export interface CapabilitySemanticCatalog {
  schemaVersion: "1.1";
  registryRevision?: string;
  contractCatalogRevision: Sha256Digest;
  bindingRevision: Sha256Digest;
  profiles: CapabilitySemanticEntry[];
  catalogHash: Sha256Digest;
}

export interface OperationAvailability {
  operationId: string;
  operationVersion: string;
  maturity: CapabilityMaturity;
  availability: OperationAvailabilityStatus;
  reasonCodes: string[];
  checkedAt: string;
  validUntil: string;
  retryAfterMs?: number;
  contractCatalogRevision: Sha256Digest;
  bindingRevision: Sha256Digest;
}

export interface OperationAvailabilityList {
  schemaVersion: "1.0";
  checkedAt: string;
  operations: OperationAvailability[];
}

export interface OperationLock {
  operationId: string;
  operationVersion: string;
  maturity: "PREVIEW" | "STABLE";
  inputSchemaHash: Sha256Digest;
  outputSchemaHash: Sha256Digest;
  semanticProfileHash: Sha256Digest;
  snapshotSupport?: SnapshotSupport;
  requiredPermissions?: string[];
}

export interface OptionalOperationLock {
  operationId: string;
  operationVersion: string;
}

export interface CapabilityMismatch {
  operationId: string;
  reason:
    | "NOT_REGISTERED"
    | "MATURITY_NOT_ALLOWED"
    | "SCHEMA_MISMATCH"
    | "PORTS_MISSING"
    | "SEMANTIC_PROFILE_MISSING"
    | "SEMANTIC_PROFILE_MISMATCH"
    | "AVAILABILITY_MISSING"
    | "UNAVAILABLE"
    | "DISABLED";
  expected?: string;
  actual?: string;
}

export interface CatalogValidation {
  contractCatalogRevision: Sha256Digest;
  bindingRevision: Sha256Digest;
  requiredReady: boolean;
  requiredMismatches: CapabilityMismatch[];
  optionalCapabilities: Array<{ operationId: string; available: boolean; reason?: string }>;
}

export interface GatewayRequestContext {
  signal?: AbortSignal;
  deadlineAt?: Date;
  traceparent?: string;
  requestId?: string;
  delegationToken?: string;
  preferAsync?: boolean;
}

export interface TrustedGatewayContractInput {
  catalog: CapabilityCatalog;
  semantics: CapabilitySemanticCatalog;
  availability: OperationAvailabilityList;
  required: OperationLock[];
  optional?: OptionalOperationLock[];
  expectedContractCatalogRevision: Sha256Digest;
  expectedSemanticCatalogHash: Sha256Digest;
}

export type GatewayJson = null | boolean | number | string | GatewayJson[] | { [key: string]: GatewayJson };
