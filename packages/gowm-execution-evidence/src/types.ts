export type Sha256Digest = `sha256:${string}`;
export type ExecutionKind = "DIRECT_OPERATION" | "WORLD_QUERY" | "WORLD_QUERY_NODE";
export type NormalizedExecutionStatus =
  | "COMPLETED"
  | "PARTIAL"
  | "NO_DATA"
  | "AMBIGUOUS"
  | "INDETERMINATE"
  | "NO_FEASIBLE_RESULT"
  | "STALE"
  | "FAILED"
  | "CANCELLED";

export type SnapshotMode = "LATEST_AT_START" | "PINNED" | "AT_LEAST_WORLD_VERSION" | "BEST_EFFORT";
export type SnapshotConsistency = "PINNED" | "CONSISTENT_AT_START" | "BEST_EFFORT";
export type SnapshotAdherenceStatus =
  | "MATCHED"
  | "ADVANCED_COMPATIBLE"
  | "MISMATCHED"
  | "UNSUPPORTED"
  | "NOT_APPLICABLE";
export type OperationAvailabilityStatus = "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "DISABLED";

export interface QuerySnapshotManifest {
  readonly querySnapshotId: string;
  readonly mode: SnapshotMode;
  readonly consistency: SnapshotConsistency;
  readonly capturedAt: string;
  readonly resources: readonly Readonly<Record<string, unknown>>[];
  readonly minimumWorldVersion?: number;
  readonly manifestHash: Sha256Digest;
}

export interface QuerySnapshotAdherence {
  readonly nodeId: string;
  readonly status: SnapshotAdherenceStatus;
  readonly checkedResources: number;
  readonly mismatches?: readonly Readonly<Record<string, unknown>>[];
}

/** Exact shape of the task package's gowm-execution-record schema. */
export interface GowmExecutionRecord {
  readonly executionId: string;
  readonly groundingId: string;
  readonly executionKind: ExecutionKind;
  readonly operationId?: string;
  readonly operationVersion?: string;
  readonly gatewayQueryId?: string;
  readonly gatewayJobId?: string;
  readonly requestHash: Sha256Digest;
  readonly resultHash?: Sha256Digest;
  readonly normalizedStatus: NormalizedExecutionStatus;
  readonly upstreamStatus: string;
  readonly dataSnapshot?: Readonly<Record<string, unknown>>;
  readonly computeSnapshot?: Readonly<Record<string, unknown>>;
  /** An object by contract; world-query node entries are wrapped in { nodes }. */
  readonly snapshotAdherence?: Readonly<Record<string, unknown>>;
  readonly receiptIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface OperationAvailabilityObservation {
  readonly availability: OperationAvailabilityStatus;
  readonly checkedAt: string;
  readonly reasonCodes: readonly string[];
}

export interface OperationExecutionContractTrace {
  readonly nodeId?: string;
  readonly operationId: string;
  readonly operationVersion: string;
  readonly inputSchemaHash: Sha256Digest;
  readonly outputSchemaUri: string;
  readonly outputSchemaHash: Sha256Digest;
  readonly semanticProfileHash: Sha256Digest;
  readonly negativeEvidencePolicy: string;
  readonly availability: OperationAvailabilityObservation;
}

export interface ExecutionContractTrace {
  readonly contractCatalogRevision: Sha256Digest;
  readonly bindingRevision: Sha256Digest;
  readonly authorizationContextHash: Sha256Digest;
  readonly delegatedIdentityHash: Sha256Digest;
  readonly operations: readonly OperationExecutionContractTrace[];
  readonly querySnapshotManifestHash?: Sha256Digest;
  readonly availabilityObservedAt: readonly string[];
}

export interface AuthoritativePayloadObjectReference {
  readonly payloadRef: string;
  readonly byteCount: number;
  readonly payloadHash: Sha256Digest;
}

export interface InlinePayloadStorage {
  readonly kind: "INLINE";
  readonly byteCount: number;
  readonly payloadHash: Sha256Digest;
  readonly value: unknown;
}

export interface ObjectReferencePayloadStorage {
  readonly kind: "OBJECT_REFERENCE";
  readonly byteCount: number;
  readonly payloadHash: Sha256Digest;
  readonly boundedSummary: Readonly<Record<string, unknown>>;
  readonly payloadRef: string;
}

export interface NoPayloadStorage {
  readonly kind: "NONE";
  readonly reason: "NO_DATA" | "INDETERMINATE" | "FAILED" | "CANCELLED" | "NO_OUTPUT";
}

export type PayloadStorage = InlinePayloadStorage | ObjectReferencePayloadStorage | NoPayloadStorage;

export type EvidenceProductKind =
  | "WORLD_FACT"
  | "WORLD_GEOMETRY"
  | "PROVENANCE"
  | "EVENT_TIMELINE"
  | "OPERATIONAL_TASK"
  | "CORRELATION_FINDING"
  | "PREDICATE_EVALUATION"
  | "OBSERVABILITY_ASSESSMENT"
  | "CAPABILITY_RESULT";

export interface NormalizedExecutionEvidenceItem {
  readonly evidenceProductId: string;
  readonly productKind: EvidenceProductKind;
  readonly executionId: string;
  readonly sourceOperation: string;
  readonly sourceNodeId?: string;
  readonly upstreamStatus: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
  readonly payloadSchemaUri: string;
  readonly payloadSchemaHash: Sha256Digest;
  readonly payload: PayloadStorage;
  readonly dataSnapshot?: Readonly<Record<string, unknown>>;
  readonly computeSnapshot: Readonly<Record<string, unknown>>;
  readonly receiptIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly unknowns: readonly string[];
  readonly warnings: readonly string[];
  readonly contractTrace: OperationExecutionContractTrace;
}

export type EvidenceRequestedProduct =
  | "WORLD_EVIDENCE"
  | "OPERATIONAL_TASKS"
  | "EVENT_TIMELINES"
  | "CORRELATION_FINDINGS"
  | "PREDICATE_EVALUATIONS";

export interface RequestedProductGap {
  readonly requestedProduct: EvidenceRequestedProduct;
  readonly reason: "NO_MATCHING_EVIDENCE";
  readonly blocking: boolean;
  readonly substituted: false;
}

export interface SnapshotGap {
  readonly code: "SNAPSHOT_MODE_DOWNGRADED" | "SNAPSHOT_ADHERENCE_FAILED" | "DIRECT_SNAPSHOT_UNSATISFIED";
  readonly nodeId?: string;
  readonly expected: string;
  readonly actual: string;
}

export interface GatewayTransportTrace {
  readonly mode: "SYNC" | "ASYNC";
  readonly responseStatus: 200 | 202;
  readonly gatewayJobId?: string;
  readonly terminalJobStatus?: string;
}

export interface ExecutionEvidenceProductBody {
  readonly record: GowmExecutionRecord;
  readonly nodeRecords: readonly GowmExecutionRecord[];
  readonly evidenceItems: readonly NormalizedExecutionEvidenceItem[];
  readonly gowmReceipts: readonly Readonly<Record<string, unknown>>[];
  readonly modelReceiptIds: readonly string[];
  readonly evidenceReferences: readonly Readonly<Record<string, unknown>>[];
  readonly contractTrace: ExecutionContractTrace;
  readonly snapshotManifest?: QuerySnapshotManifest;
  readonly snapshotAdherence: readonly QuerySnapshotAdherence[];
  readonly snapshotGaps: readonly SnapshotGap[];
  readonly resultPayload?: PayloadStorage;
  readonly requestedProductGaps: readonly RequestedProductGap[];
  readonly warnings: readonly string[];
  readonly unknowns: readonly string[];
  readonly transport: GatewayTransportTrace;
}

export interface ExecutionEvidenceProduct extends ExecutionEvidenceProductBody {
  readonly productHash: Sha256Digest;
}

export interface ExecutionNormalizationContext {
  readonly executionId: string;
  readonly groundingId: string;
  readonly requestPayload: unknown;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly contractCatalogRevision: Sha256Digest;
  readonly bindingRevision: Sha256Digest;
  readonly authorizationContextHash: Sha256Digest;
  readonly delegatedIdentityHash: Sha256Digest;
  readonly modelReceiptIds?: readonly string[];
  readonly requestedProducts: readonly EvidenceRequestedProduct[];
  readonly maximumInlinePayloadBytes?: number;
  /** Keys are DIRECT_RESULT, WORLD_QUERY_OUTPUTS, or a world-query nodeId. */
  readonly payloadObjectReferences?: Readonly<Record<string, AuthoritativePayloadObjectReference>>;
}

export interface DirectSnapshotExpectation {
  readonly consistency: SnapshotConsistency;
  readonly allowDowngrade: boolean;
}

export interface WorldSnapshotExpectation {
  readonly mode: SnapshotMode;
  readonly allowDowngrade: boolean;
}

export interface DirectExecutionNormalizationInput {
  readonly context: ExecutionNormalizationContext;
  readonly operation: OperationExecutionContractTrace;
  readonly snapshotExpectation: DirectSnapshotExpectation;
  readonly outcome:
    | { readonly mode: "SYNC"; readonly status: 200; readonly result: unknown }
    | {
        readonly mode: "ASYNC";
        readonly status: 202;
        readonly acceptedJob: unknown;
        readonly terminalJob: unknown;
      };
}

export interface WorldQueryExecutionNormalizationInput {
  readonly context: ExecutionNormalizationContext;
  readonly operationsByNode: Readonly<Record<string, OperationExecutionContractTrace>>;
  readonly nodeRequestHashes: Readonly<Record<string, Sha256Digest>>;
  readonly snapshotExpectation: WorldSnapshotExpectation;
  readonly outcome:
    | { readonly mode: "SYNC"; readonly status: 200; readonly result: unknown }
    | {
        readonly mode: "ASYNC";
        readonly status: 202;
        readonly acceptedJob: unknown;
        readonly terminalJob: unknown;
      };
}

export type ExecutionEvidenceErrorCode =
  | "INVALID_IDENTIFIER"
  | "INVALID_DIGEST"
  | "INVALID_TIMESTAMP"
  | "INVALID_TIME_RANGE"
  | "INVALID_REQUESTED_PRODUCTS"
  | "INVALID_MAXIMUM_INLINE_BYTES"
  | "INVALID_GATEWAY_ENVELOPE"
  | "UNKNOWN_GATEWAY_ENVELOPE_FIELD"
  | "INVALID_UPSTREAM_STATUS"
  | "OUTPUT_REQUIRED"
  | "OUTPUT_FORBIDDEN"
  | "INVALID_GATEWAY_JOB"
  | "GATEWAY_JOB_ID_MISMATCH"
  | "GATEWAY_JOB_KIND_MISMATCH"
  | "GATEWAY_JOB_NOT_TERMINAL"
  | "GATEWAY_JOB_RESULT_MISSING"
  | "GATEWAY_JOB_RESULT_STATUS_MISMATCH"
  | "OPERATION_IDENTITY_MISMATCH"
  | "OUTPUT_SCHEMA_MISMATCH"
  | "COMPUTE_SNAPSHOT_MISMATCH"
  | "UPSTREAM_RESULT_HASH_MISMATCH"
  | "WORLD_QUERY_OUTPUT_HASH_MISMATCH"
  | "RECEIPT_REQUIRED"
  | "INVALID_RECEIPT"
  | "RECEIPT_HASH_MISMATCH"
  | "DUPLICATE_RECEIPT_ID"
  | "INVALID_EVIDENCE_REFERENCE"
  | "DUPLICATE_EVIDENCE_ID"
  | "RECEIPT_EVIDENCE_ID_COLLISION"
  | "MODEL_RECEIPT_COLLISION"
  | "LARGE_PAYLOAD_REFERENCE_REQUIRED"
  | "PAYLOAD_REFERENCE_MISMATCH"
  | "INVALID_PAYLOAD_REFERENCE"
  | "INVALID_WORLD_QUERY_RESULT"
  | "WORLD_QUERY_IDENTITY_MISMATCH"
  | "WORLD_QUERY_NODE_TRACE_MISSING"
  | "WORLD_QUERY_NODE_REQUEST_HASH_MISSING"
  | "WORLD_QUERY_NODE_INPUT_HASH_MISMATCH"
  | "DUPLICATE_WORLD_QUERY_NODE"
  | "WORLD_QUERY_NODE_RESULT_STATUS_MISMATCH"
  | "SNAPSHOT_MANIFEST_HASH_MISMATCH"
  | "SNAPSHOT_ADHERENCE_DUPLICATE"
  | "SNAPSHOT_ADHERENCE_MISSING"
  | "SNAPSHOT_ADHERENCE_UNKNOWN_NODE";
