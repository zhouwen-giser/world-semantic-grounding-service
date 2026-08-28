export type Sha256 = `sha256:${string}`;

export interface PriorGroundingPointer {
  groundingId: string;
  resultHash: Sha256;
  selectedProductIds: string[];
}

export interface PriorGroundingIdentity {
  servicePrincipalId: string;
  actorId: string;
  dataScopes: string[];
  datasetScopes: string[];
  permissions: string[];
  authorizationContextHash: Sha256;
}

export interface QuerySnapshotResource {
  resourceKind: string;
  resourceId: string;
  version: string;
  contentHash?: Sha256;
  worldVersion?: number;
  pinning: "PINNED" | "AT_LEAST" | "BEST_EFFORT";
}

export interface QuerySnapshotManifest {
  querySnapshotId: string;
  mode: "PINNED" | "LATEST_AT_START" | "AT_LEAST_WORLD_VERSION" | "BEST_EFFORT";
  consistency: "PINNED" | "CONSISTENT_AT_START" | "BEST_EFFORT";
  capturedAt: string;
  resources: QuerySnapshotResource[];
  minimumWorldVersion?: number;
  manifestHash: Sha256;
}

export interface StoredPriorGrounding {
  groundingId: string;
  servicePrincipalId: string;
  actorId: string;
  dataScope: string;
  datasetScopes: string[];
  authorizationContextHash: Sha256;
  resultBytes: Uint8Array;
  querySnapshotManifest: QuerySnapshotManifest;
}

export interface PriorGroundingStore {
  read(input: {
    groundingId: string;
    actorId: string;
    dataScope: string;
  }): Promise<StoredPriorGrounding | null>;
}

export interface ValidationOperationLock {
  operationId: "reference.validate" | "result.validate";
  operationVersion: string;
  maturity: "STABLE";
  inputSchemaHash: Sha256;
  outputSchemaHash: Sha256;
  semanticProfileHash: Sha256;
  snapshotSupport: "PINNED" | "CONSISTENT_AT_START" | "NONE";
  requiredPermissions: string[];
}

export interface GowmReferenceKey {
  namespace: "gowm";
  kind: string;
  id: string;
  version: string;
}

export interface PriorValidationGatewayRequest {
  operation: ValidationOperationLock;
  requestId: string;
  idempotencyKey: string;
  input: {
    schemaVersion: "1.0";
    references: Array<{
      referenceKey: GowmReferenceKey;
      requireCurrentSnapshot: true;
    }>;
  };
  snapshotPolicy: {
    mode: "PINNED";
    pinnedSnapshot: QuerySnapshotManifest;
    allowDowngrade: false;
  };
  identity: PriorGroundingIdentity;
  dataScope: string;
  deadlineAt: string;
  maximumResultBytes: number;
}

export type SnapshotAdherenceStatus =
  | "MATCHED"
  | "ADVANCED_COMPATIBLE"
  | "MISMATCHED"
  | "UNSUPPORTED"
  | "NOT_APPLICABLE";

export interface PriorValidationGatewayResponse {
  operationId: string;
  operationVersion: string;
  status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "FAILED";
  value?: unknown;
  snapshotManifest?: QuerySnapshotManifest;
  snapshotAdherence?: Array<{
    resourceKind: string;
    resourceId: string;
    status: SnapshotAdherenceStatus;
  }>;
}

export interface PriorValidationGateway {
  execute(
    request: PriorValidationGatewayRequest,
  ): Promise<PriorValidationGatewayResponse>;
}

export type RevalidationStatus =
  | "VALID"
  | "STALE"
  | "EXPIRED"
  | "NOT_FOUND"
  | "TYPE_MISMATCH"
  | "VERSION_CONFLICT"
  | "SCOPE_DENIED";

export interface ProductValidationObservation {
  operationId: "reference.validate" | "result.validate";
  operationVersion: string;
  status: RevalidationStatus;
}

export interface RevalidatedPriorProduct {
  productId: string;
  referenceKey: GowmReferenceKey;
  product: Readonly<Record<string, unknown>>;
  usable: boolean;
  validations: ProductValidationObservation[];
}

export interface PriorGroundingResult {
  groundingId: string;
  sourceResultHash: Sha256;
  dataScope: string;
  datasetScopes: string[];
  snapshotManifest: QuerySnapshotManifest;
  status: "REVALIDATED" | "REVALIDATION_REQUIRED";
  products: RevalidatedPriorProduct[];
  revalidationHash: Sha256;
}

export interface PriorGroundingValidatorOptions {
  store: PriorGroundingStore;
  gateway: PriorValidationGateway;
  operationLocks: ValidationOperationLock[];
  maximumStoredResultBytes?: number;
  maximumSelectedProducts?: number;
  maximumValidationResultBytes?: number;
  now?: () => Date;
  deadlineMs?: number;
}
