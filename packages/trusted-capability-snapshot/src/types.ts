export type Sha256Digest = `sha256:${string}`;
export type Sha512Integrity = `sha512-${string}`;

export type LockedCapabilityMaturity = "STABLE" | "PREVIEW";
export type SnapshotSupport = "NONE" | "BEST_EFFORT" | "CONSISTENT_AT_START" | "PINNED";
export type OperationAvailabilityStatus = "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "DISABLED";

export interface SouthboundOperationLockEntry {
  readonly operationId: string;
  readonly operationVersion: string;
  readonly inputSchemaHash: Sha256Digest;
  readonly outputSchemaHash: Sha256Digest;
  readonly semanticProfileHash: Sha256Digest;
  readonly maturity: LockedCapabilityMaturity;
  readonly requiredPermissions: readonly string[];
  readonly snapshotSupport: SnapshotSupport;
}

/**
 * A southbound lock which the contract-intake boundary has already validated
 * against the GOWM 0.6.3 schema and consumer artifact.
 */
export interface SchemaValidatedSouthboundLock {
  readonly schemaVersion: "2.0";
  readonly gatewayContractVersion: "0.6.3";
  readonly consumerContractPackage: {
    readonly name: "@gowm/world-gateway-contracts";
    readonly version: "0.6.3";
    readonly integrity: Sha512Integrity;
  };
  readonly contractCatalogRevision: Sha256Digest;
  readonly semanticCatalogHash: Sha256Digest;
  readonly availabilityContractHash: Sha256Digest;
  readonly snapshotContractHash: Sha256Digest;
  readonly delegationContractHash: Sha256Digest;
  readonly defaultOperations: readonly SouthboundOperationLockEntry[];
  readonly previewOperations: readonly SouthboundOperationLockEntry[];
}

export interface SchemaValidatedCapability {
  readonly operationId: string;
  readonly operationVersion: string;
  readonly maturity: string;
  readonly inputSchemaHash: Sha256Digest;
  readonly outputSchemaHash: Sha256Digest;
  readonly semanticProfile: Readonly<Record<string, unknown>>;
}

export interface SchemaValidatedCapabilityCatalog {
  readonly contractCatalogRevision: Sha256Digest;
  readonly bindingRevision: Sha256Digest;
  readonly capabilities: readonly SchemaValidatedCapability[];
}

export interface SchemaValidatedSemanticProfile {
  readonly operationId: string;
  readonly operationVersion: string;
  readonly semanticProfile: Readonly<Record<string, unknown>>;
  readonly semanticProfileHash: Sha256Digest;
}

export interface SchemaValidatedSemanticCatalog {
  readonly schemaVersion: "1.1";
  readonly contractCatalogRevision: Sha256Digest;
  readonly bindingRevision: Sha256Digest;
  readonly profiles: readonly SchemaValidatedSemanticProfile[];
  readonly catalogHash: Sha256Digest;
}

export interface SchemaValidatedAvailability {
  readonly operationId: string;
  readonly operationVersion: string;
  readonly availability: OperationAvailabilityStatus;
  readonly checkedAt: string;
  readonly validUntil: string;
  readonly reasonCodes: readonly string[];
  readonly contractCatalogRevision: Sha256Digest;
  readonly bindingRevision: Sha256Digest;
}

export interface SchemaValidatedAvailabilityList {
  readonly schemaVersion: "1.0";
  readonly checkedAt: string;
  readonly operations: readonly SchemaValidatedAvailability[];
}

export interface TrustedCapabilitySnapshotCapability {
  readonly operationId: string;
  readonly operationVersion: string;
  readonly inputSchemaHash: Sha256Digest;
  readonly outputSchemaHash: Sha256Digest;
  readonly semanticProfileHash: Sha256Digest;
  readonly maturity: LockedCapabilityMaturity;
  readonly snapshotSupport: SnapshotSupport;
  readonly requiredPermissions: readonly string[];
}

export interface TrustedCapabilitySnapshotAvailability {
  readonly operationId: string;
  readonly operationVersion: string;
  readonly availability: OperationAvailabilityStatus;
  readonly checkedAt: string;
  readonly validUntil?: string;
  readonly reasonCodes?: readonly string[];
}

export interface TrustedCapabilitySnapshotBody {
  readonly capturedAt: string;
  readonly gatewayContractVersion: "0.6.3";
  readonly contractCatalogRevision: Sha256Digest;
  readonly semanticCatalogHash: Sha256Digest;
  readonly bindingRevision: Sha256Digest;
  readonly consumerPackageIntegrity: Sha512Integrity;
  readonly southboundLockHash: Sha256Digest;
  readonly capabilities: readonly TrustedCapabilitySnapshotCapability[];
  readonly availability: readonly TrustedCapabilitySnapshotAvailability[];
}

export interface TrustedCapabilitySnapshot extends TrustedCapabilitySnapshotBody {
  readonly snapshotHash: Sha256Digest;
}

export interface TrustedCapabilitySnapshotInput {
  readonly catalog: SchemaValidatedCapabilityCatalog;
  readonly semantics: SchemaValidatedSemanticCatalog;
  readonly availability: SchemaValidatedAvailabilityList;
  readonly southboundLock: SchemaValidatedSouthboundLock;
  /** SHA-256 of the exact locked file bytes, established by contract intake. */
  readonly southboundLockHash: Sha256Digest;
  readonly capturedAt?: Date;
}

export type SnapshotReadinessFailureCode =
  | "CONTRACT_CATALOG_DRIFT"
  | "SEMANTIC_CATALOG_DRIFT"
  | "SEMANTIC_CATALOG_CONTENT_MISMATCH"
  | "CATALOG_SEMANTIC_REVISION_MISMATCH"
  | "BINDING_METADATA_MISMATCH";

export type SnapshotAvailabilityRefreshCode =
  | "AVAILABILITY_MISSING"
  | "AVAILABILITY_CONTRACT_REVISION_MISMATCH"
  | "AVAILABILITY_REFRESH_REQUIRED"
  | "AVAILABILITY_EXPIRED";

export type NewJobSnapshotReadiness =
  | { readonly status: "READY" }
  | { readonly status: "REFRESH_AVAILABILITY"; readonly code: SnapshotAvailabilityRefreshCode; readonly operationKey?: string }
  | { readonly status: "FAIL_CLOSED"; readonly code: SnapshotReadinessFailureCode };

export type TrustedCapabilitySnapshotErrorCode =
  | SnapshotReadinessFailureCode
  | SnapshotAvailabilityRefreshCode
  | "GATEWAY_CONTRACT_VERSION_MISMATCH"
  | "CONSUMER_CONTRACT_PACKAGE_MISMATCH"
  | "INVALID_CAPTURE_TIME"
  | "INVALID_DIGEST"
  | "INVALID_PACKAGE_INTEGRITY"
  | "INVALID_OPERATION_KEY"
  | "DUPLICATE_LOCKED_OPERATION"
  | "DUPLICATE_CAPABILITY"
  | "DUPLICATE_SEMANTIC_PROFILE"
  | "DUPLICATE_AVAILABILITY"
  | "SNAPSHOT_LIMIT_EXCEEDED"
  | "CAPABILITY_MISSING"
  | "CAPABILITY_LOCK_MISMATCH"
  | "SEMANTIC_PROFILE_MISSING"
  | "SEMANTIC_PROFILE_LOCK_MISMATCH"
  | "AVAILABILITY_TIME_INVALID"
  | "AVAILABILITY_OBSERVED_IN_FUTURE"
  | "SNAPSHOT_INTEGRITY_MISMATCH"
  | "JOB_SNAPSHOT_MISSING"
  | "JOB_SNAPSHOT_CONFLICT"
  | "INVALID_JOB_ID";

export interface TrustedCapabilitySnapshotInsertResult {
  readonly inserted: boolean;
  readonly snapshot: TrustedCapabilitySnapshot;
}

/** Implementations must make insertIfAbsent atomic for a job identifier. */
export interface TrustedCapabilitySnapshotStore {
  load(jobId: string): Promise<TrustedCapabilitySnapshot | null>;
  insertIfAbsent(jobId: string, snapshot: TrustedCapabilitySnapshot): Promise<TrustedCapabilitySnapshotInsertResult>;
}
