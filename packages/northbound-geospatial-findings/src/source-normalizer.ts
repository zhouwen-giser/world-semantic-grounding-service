import {
  defaultSacsGeospatialSchemaRegistry,
  type SacsGeospatialSourceProduct
} from "@wsgs/contracts";
import {
  createGdpsV021FinalBFindingAuthority,
  readGdpsFindingOperationAuthority,
  resolveGdpsFindingOperationAuthority,
  type GdpsFindingOperationProjection
} from "@wsgs/gdps-descriptor-consumer";
import {
  readValidatedGowmFindingResult,
  type GowmFindingResultStatus,
  type ValidatedGowmFindingResult
} from "@wsgs/gowm-execution-evidence";

import { canonicalJson, canonicalSha256, compareCodePoints, deterministicId } from "./canonical.js";
import type { Sha256Digest } from "./types.js";

export interface SourceGroundingIdentity {
  readonly servicePrincipalId: string;
  readonly actorId: string;
  readonly dataScopes: readonly string[];
  readonly datasetScopes: readonly string[];
  readonly permissions: readonly string[];
  readonly authorizationContextHash: Sha256Digest;
}

interface TrustedSourceContextProjection {
  readonly servicePrincipalId: string;
  readonly actorId: string;
  readonly authorizationContextHash: Sha256Digest;
  readonly dataScope: string;
  readonly scopeDigest: Sha256Digest;
}

/** Opaque runtime-authentication token. */
export interface TrustedSourceRuntimeContext {
  readonly authorizationBindingHash: Sha256Digest;
}

export interface SafeDataSnapshotResource {
  readonly referenceKeyHash: Sha256Digest;
  readonly authority: string;
  readonly pinning: "PINNED" | "AT_LEAST" | "BEST_EFFORT";
  readonly digest?: Sha256Digest;
}

export interface SafeDataSnapshotProjection {
  readonly consistency: "PINNED" | "CONSISTENT_AT_START" | "BEST_EFFORT";
  readonly capturedAt: string;
  readonly scopeDigest: Sha256Digest;
  readonly resources: readonly SafeDataSnapshotResource[];
}

export interface SafeComputeSnapshotProjection {
  readonly provider: {
    readonly providerId: string;
    readonly providerVersion: string;
    readonly implementationDigest?: Sha256Digest;
  };
  readonly operation: {
    readonly operationId: string;
    readonly operationVersion: string;
  };
  readonly engine: {
    readonly name: string;
    readonly version: string;
    readonly digest?: Sha256Digest;
  };
  readonly policy: {
    readonly version: string;
    readonly digest: Sha256Digest;
  };
  readonly schemas: {
    readonly inputSchemaHash: Sha256Digest;
    readonly outputSchemaHash: Sha256Digest;
  };
}

export interface SafeReceiptReference {
  readonly receiptId: string;
  readonly inputHash: Sha256Digest;
  readonly outputHash: Sha256Digest;
  readonly computeSnapshotHash: Sha256Digest;
}

export interface SafeEvidenceReference {
  readonly evidenceId: string;
  readonly authority: string;
  readonly evidenceType: string;
  readonly referenceKeyHash: Sha256Digest;
  readonly schemaHash: Sha256Digest;
  readonly observedAt?: string;
  readonly worldVersion?: number;
}

export interface WsgsLocalSourceEvidenceItem {
  readonly evidenceItemId: string;
  readonly evidenceKind: "GOWM_GDPS_EXECUTION_PROVENANCE";
  readonly authorityClosureHash: Sha256Digest;
  readonly sourceOperation: string;
  readonly upstreamStatus: GowmFindingResultStatus;
  readonly outputSchemaHash: Sha256Digest;
  readonly outputHash?: Sha256Digest;
  readonly dataSnapshotHash: Sha256Digest;
  readonly computeSnapshotHash: Sha256Digest;
  readonly receiptSetHash: Sha256Digest;
  readonly receiptIds: readonly string[];
  readonly upstreamEvidenceIds: readonly string[];
  readonly evidenceHash: Sha256Digest;
}

export type SourceProvenanceRejectionReason =
  | "EVIDENCE_INCOMPLETE"
  | "UNSUPPORTED_FINDING_SCHEMA"
  | "SOURCE_CHANGED";

export type SourceEnvelopeQualification =
  | Readonly<{ status: "QUALIFIED" }>
  | Readonly<{
      status: "REJECTED";
      reason: SourceProvenanceRejectionReason;
    }>;

export interface SourceEnvelopeBinding {
  readonly envelopeHash: Sha256Digest;
  readonly operationId: string;
  readonly operationVersion: string;
  readonly status: GowmFindingResultStatus;
  readonly sourceProductIds: readonly string[];
  readonly evidenceItemIds: readonly string[];
  readonly receiptIds: readonly string[];
  readonly authorizationBindingHash: Sha256Digest;
  readonly qualification: SourceEnvelopeQualification;
  readonly localEvidenceItem?: WsgsLocalSourceEvidenceItem;
  readonly dataSnapshot?: SafeDataSnapshotProjection;
  readonly computeSnapshot: SafeComputeSnapshotProjection;
  readonly receiptReferences: readonly SafeReceiptReference[];
  readonly evidenceReferences: readonly SafeEvidenceReference[];
  readonly provenanceHash: Sha256Digest;
}

/** Opaque, module-minted token. Its public fields are diagnostic, not authority. */
export interface NormalizedSourceProductBinding {
  readonly sourceProductSetHash: Sha256Digest;
  readonly sourceProductCount: number;
  readonly envelopeBindingCount: number;
}

export interface NormalizedSourceProductProjection {
  readonly sourceProducts: readonly SacsGeospatialSourceProduct[];
  readonly sourceProductSetHash: Sha256Digest;
  readonly envelopeBindings: readonly SourceEnvelopeBinding[];
}

export interface NormalizeSourceProductsInput {
  /** Opaque context minted from the authenticated, server-owned scoped identity. */
  readonly trustedContext: TrustedSourceRuntimeContext;
  readonly validatedResults: readonly ValidatedGowmFindingResult[];
}

export class SourceProductNormalizationError extends Error {
  constructor(readonly code: string) {
    super(`Geospatial source product normalization failed: ${code}`);
    this.name = "SourceProductNormalizationError";
  }
}

interface SourceIdentity {
  readonly productId: string;
  readonly productType: string;
  readonly productProfile: string;
  readonly contentHash: Sha256Digest;
  readonly descriptorId: string;
  readonly descriptorHash: Sha256Digest;
  readonly dataTime?: string;
  readonly qualitySummary?: SacsGeospatialSourceProduct["qualitySummary"];
}

interface MutableSourceProduct {
  identity: SourceIdentity;
  readonly sourceProductId: string;
  readonly evidenceItemIds: Set<string>;
}

interface NormalizedBindingState {
  readonly projection: NormalizedSourceProductProjection;
  readonly semanticHash: Sha256Digest;
}

const normalizedBindings = new WeakMap<object, NormalizedBindingState>();
const trustedSourceContexts = new WeakMap<object, TrustedSourceContextProjection>();
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const identifierPattern = /^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u;
const authorityIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const productIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const safeCodePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const forbiddenSensitiveKey = /(?:url|uri|path|asset|bucket|database|table|row|token|authorization|credential|secret|password|privatekey)/iu;
const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

const descriptorProbeOperations = [
  "geo-raster.sample",
  "geo-raster.find-by-class",
  "geo-raster.find-by-range",
  "geo-raster.profile",
  "geo-vector.find-in-area",
  "geo-vector.find-nearby",
  "geo-vector.find-intersections"
] as const;

let finalAuthority: ReturnType<typeof createGdpsV021FinalBFindingAuthority> | undefined;

function fail(code: string): never {
  throw new SourceProductNormalizationError(code);
}

function exactFinalAuthority(): ReturnType<typeof createGdpsV021FinalBFindingAuthority> {
  finalAuthority ??= createGdpsV021FinalBFindingAuthority();
  return finalAuthority;
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function text(value: unknown, code: string, maximum = 256): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) fail(code);
  return value;
}

function safeProjectionText(value: unknown, code: string, maximum: number): string {
  const parsed = text(value, code, maximum);
  if (parsed.includes("://")
    || parsed.includes("\\")
    || /^(?:[A-Za-z]:\/|\/)/u.test(parsed)
    || parsed.includes("../")
    || /(?:Bearer\s+|-----BEGIN |\b(?:password|secret|token)=)/iu.test(parsed)) {
    fail(code);
  }
  return parsed;
}

function identifier(value: unknown, code: string): string {
  const parsed = text(value, code);
  if (!identifierPattern.test(parsed)) fail(code);
  return parsed;
}

function authorityIdentifier(value: unknown, code: string): string {
  const parsed = text(value, code);
  if (!authorityIdentifierPattern.test(parsed)) fail(code);
  return parsed;
}

function productId(value: unknown): string {
  const parsed = text(value, "SOURCE_PRODUCT_ID_INVALID");
  if (!productIdPattern.test(parsed)) fail("SOURCE_PRODUCT_ID_INVALID");
  return parsed;
}

function digest(value: unknown, code: string): Sha256Digest {
  if (typeof value !== "string" || !digestPattern.test(value)) fail(code);
  return value as Sha256Digest;
}

function dateTime(value: unknown, code: string): string {
  const parsed = text(value, code, 128);
  if (!isoDateTimePattern.test(parsed) || !Number.isFinite(Date.parse(parsed))) fail(code);
  return parsed;
}

function nonNegativeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(code);
  return value as number;
}

function finiteNonNegative(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(code);
  return Object.is(value, -0) ? 0 : value;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function uniqueSorted(values: readonly string[], code: string): string[] {
  if (values.some((value) => !identifierPattern.test(value))) fail(code);
  const unique = [...new Set(values)].sort(compareCodePoints);
  if (unique.length !== values.length) fail(code);
  return unique;
}

function normalizedAuthorityList(
  values: readonly string[],
  code: string,
  allowEmpty: boolean,
  maximum: number
): string[] {
  if (!Array.isArray(values) || values.length > maximum || (!allowEmpty && values.length < 1)) fail(code);
  const normalized = values.map((value) => authorityIdentifier(value, code)).sort(compareCodePoints);
  if (new Set(normalized).size !== normalized.length) fail(`${code}_DUPLICATE`);
  return normalized;
}

function contextFromScopedIdentity(
  value: SourceGroundingIdentity,
  selectedDataScope: string
): TrustedSourceContextProjection {
  const servicePrincipalId = authorityIdentifier(value.servicePrincipalId, "SOURCE_TRUSTED_PRINCIPAL_INVALID");
  const actorId = authorityIdentifier(value.actorId, "SOURCE_TRUSTED_ACTOR_INVALID");
  const dataScopes = normalizedAuthorityList(value.dataScopes, "SOURCE_TRUSTED_DATA_SCOPES_INVALID", false, 32);
  const datasetScopes = normalizedAuthorityList(
    value.datasetScopes,
    "SOURCE_TRUSTED_DATASET_SCOPES_INVALID",
    true,
    32
  );
  const permissions = normalizedAuthorityList(
    value.permissions,
    "SOURCE_TRUSTED_PERMISSIONS_INVALID",
    false,
    64
  );
  const dataScope = authorityIdentifier(selectedDataScope, "SOURCE_TRUSTED_SCOPE_INVALID");
  if (!dataScopes.includes(dataScope)) fail("SOURCE_TRUSTED_SCOPE_NOT_AUTHORIZED");
  const authorizationContextHash = digest(
    value.authorizationContextHash,
    "SOURCE_AUTHORIZATION_CONTEXT_HASH_INVALID"
  );
  const expectedAuthorizationContextHash = canonicalSha256({
    servicePrincipalId,
    actorId,
    dataScopes,
    datasetScopes,
    permissions
  });
  if (authorizationContextHash !== expectedAuthorizationContextHash) {
    fail("SOURCE_AUTHORIZATION_CONTEXT_HASH_MISMATCH");
  }
  return freeze({
    servicePrincipalId,
    actorId,
    authorizationContextHash,
    dataScope,
    scopeDigest: canonicalSha256({ dataScopeKey: dataScope })
  });
}

function requireTrustedContext(value: TrustedSourceRuntimeContext): TrustedSourceContextProjection {
  if (value === null || typeof value !== "object") fail("SOURCE_TRUSTED_CONTEXT_REQUIRED");
  const context = trustedSourceContexts.get(value);
  if (context === undefined) fail("SOURCE_TRUSTED_CONTEXT_FORGED");
  return context;
}

function snapshotProductIdentity(
  value: unknown
): Readonly<{ productId: string; contentHash: Sha256Digest }> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const hasProductId = candidate["productId"] !== undefined;
  const hasContentHash = candidate["contentHash"] !== undefined;
  if (!hasProductId && !hasContentHash) return undefined;
  if (!hasProductId || !hasContentHash) fail("SOURCE_SNAPSHOT_OUTPUT_IDENTITY_INCOMPLETE");
  return freeze({
    productId: productId(candidate["productId"]),
    contentHash: digest(candidate["contentHash"], "SOURCE_CONTENT_HASH_REQUIRED")
  });
}

function safeDataSnapshot(
  value: unknown,
  context: TrustedSourceContextProjection,
  operation: GdpsFindingOperationProjection,
  identities: readonly SourceIdentity[],
  outputValue: unknown
): SafeDataSnapshotProjection {
  const snapshot = record(value, "SOURCE_DATA_SNAPSHOT_REQUIRED");
  const consistency = snapshot["consistency"];
  if (consistency !== "CONSISTENT_AT_START") {
    fail("SOURCE_DATA_SNAPSHOT_CONSISTENCY_INVALID");
  }
  const capturedAt = dateTime(snapshot["capturedAt"], "SOURCE_DATA_SNAPSHOT_TIME_INVALID");
  const scopeDigest = digest(snapshot["scopeDigest"], "SOURCE_DATA_SNAPSHOT_SCOPE_INVALID");
  if (scopeDigest !== context.scopeDigest) fail("SOURCE_DATA_SCOPE_MISMATCH");
  if (!Array.isArray(snapshot["resources"]) || snapshot["resources"].length !== 1) {
    fail("SOURCE_DATA_SNAPSHOT_RESOURCE_CARDINALITY");
  }
  const resources = snapshot["resources"].map((candidate): SafeDataSnapshotResource => {
    const resource = record(candidate, "SOURCE_DATA_SNAPSHOT_RESOURCE_INVALID");
    const authority = safeProjectionText(
      resource["authority"],
      "SOURCE_DATA_SNAPSHOT_AUTHORITY_INVALID",
      128
    );
    if (authority !== operation.provider.providerId) fail("SOURCE_DATA_SNAPSHOT_AUTHORITY_MISMATCH");
    const pinning = resource["pinning"];
    if (pinning !== "PINNED") {
      fail("SOURCE_DATA_SNAPSHOT_PINNING_INVALID");
    }
    const referenceKey = record(resource["referenceKey"], "SOURCE_DATA_SNAPSHOT_REFERENCE_INVALID");
    if (referenceKey["namespace"] !== "gdps" || referenceKey["kind"] !== "DATASET") {
      fail("SOURCE_DATA_SNAPSHOT_REFERENCE_AUTHORITY_MISMATCH");
    }
    const referenceId = text(referenceKey["id"], "SOURCE_DATA_SNAPSHOT_REFERENCE_INVALID");
    const referenceVersion = digest(
      referenceKey["version"],
      "SOURCE_DATA_SNAPSHOT_REFERENCE_VERSION_INVALID"
    );
    const resourceDigest = digest(resource["digest"], "SOURCE_DATA_SNAPSHOT_DIGEST_INVALID");
    if (operation.authorityKind === "CATALOG") {
      const catalogDigest = outputValue === undefined ? resourceDigest : canonicalSha256(outputValue);
      if (referenceId !== `catalog:${context.dataScope}`
        || referenceVersion !== catalogDigest
        || resourceDigest !== catalogDigest) {
        fail("SOURCE_CATALOG_SNAPSHOT_BINDING_MISMATCH");
      }
    } else if (identities.length > 0) {
      if (identities.length !== 1) fail("SOURCE_PRODUCT_SNAPSHOT_CARDINALITY_MISMATCH");
      const identity = identities[0]!;
      if (referenceId !== `${context.dataScope}:${identity.productId}`
        || referenceVersion !== identity.contentHash
        || resourceDigest !== identity.contentHash) {
        fail("SOURCE_PRODUCT_SNAPSHOT_BINDING_MISMATCH");
      }
    } else {
      const outputIdentity = snapshotProductIdentity(outputValue);
      if (outputIdentity !== undefined) {
        if (referenceId !== `${context.dataScope}:${outputIdentity.productId}`
          || referenceVersion !== outputIdentity.contentHash
          || resourceDigest !== outputIdentity.contentHash) {
          fail("SOURCE_PRODUCT_SNAPSHOT_BINDING_MISMATCH");
        }
      } else if (referenceId !== `catalog:${context.dataScope}`
        || referenceVersion !== resourceDigest) {
        fail("SOURCE_UNBOUND_SNAPSHOT_BINDING_MISMATCH");
      }
    }
    const referenceKeyHash = canonicalSha256(referenceKey);
    return freeze({
      referenceKeyHash,
      authority,
      pinning,
      digest: resourceDigest
    });
  }).sort((left, right) => compareCodePoints(left.referenceKeyHash, right.referenceKeyHash));
  return freeze({ consistency, capturedAt, scopeDigest, resources });
}

function safeComputeSnapshot(value: unknown): SafeComputeSnapshotProjection {
  const snapshot = record(value, "SOURCE_COMPUTE_SNAPSHOT_INVALID");
  const provider = record(snapshot["provider"], "SOURCE_COMPUTE_PROVIDER_INVALID");
  const operation = record(snapshot["operation"], "SOURCE_COMPUTE_OPERATION_INVALID");
  const engine = record(snapshot["engine"], "SOURCE_COMPUTE_ENGINE_INVALID");
  const policy = record(snapshot["policy"], "SOURCE_COMPUTE_POLICY_INVALID");
  const schemas = record(snapshot["schemas"], "SOURCE_COMPUTE_SCHEMAS_INVALID");
  return freeze({
    provider: {
      providerId: identifier(provider["providerId"], "SOURCE_COMPUTE_PROVIDER_INVALID"),
      providerVersion: safeProjectionText(provider["providerVersion"], "SOURCE_COMPUTE_PROVIDER_INVALID", 64),
      ...(provider["implementationDigest"] === undefined
        ? {}
        : { implementationDigest: digest(provider["implementationDigest"], "SOURCE_COMPUTE_PROVIDER_INVALID") })
    },
    operation: {
      operationId: safeProjectionText(operation["operationId"], "SOURCE_COMPUTE_OPERATION_INVALID", 128),
      operationVersion: safeProjectionText(operation["operationVersion"], "SOURCE_COMPUTE_OPERATION_INVALID", 32)
    },
    engine: {
      name: safeProjectionText(engine["name"], "SOURCE_COMPUTE_ENGINE_INVALID", 128),
      version: safeProjectionText(engine["version"], "SOURCE_COMPUTE_ENGINE_INVALID", 128),
      ...(engine["digest"] === undefined
        ? {}
        : { digest: digest(engine["digest"], "SOURCE_COMPUTE_ENGINE_INVALID") })
    },
    policy: {
      version: safeProjectionText(policy["version"], "SOURCE_COMPUTE_POLICY_INVALID", 128),
      digest: digest(policy["digest"], "SOURCE_COMPUTE_POLICY_INVALID")
    },
    schemas: {
      inputSchemaHash: digest(schemas["inputSchemaHash"], "SOURCE_COMPUTE_SCHEMAS_INVALID"),
      outputSchemaHash: digest(schemas["outputSchemaHash"], "SOURCE_COMPUTE_SCHEMAS_INVALID")
    }
  });
}

function safeReceiptReferences(values: readonly Readonly<Record<string, unknown>>[]): SafeReceiptReference[] {
  return values.map((candidate): SafeReceiptReference => {
    const receipt = record(candidate, "SOURCE_RECEIPT_INVALID");
    return freeze({
      receiptId: identifier(receipt["receiptId"], "SOURCE_RECEIPT_ID_INVALID"),
      inputHash: digest(receipt["inputHash"], "SOURCE_RECEIPT_HASH_INVALID"),
      outputHash: digest(receipt["outputHash"], "SOURCE_RECEIPT_HASH_INVALID"),
      computeSnapshotHash: digest(receipt["computeSnapshotHash"], "SOURCE_RECEIPT_HASH_INVALID")
    });
  }).sort((left, right) => compareCodePoints(left.receiptId, right.receiptId));
}

function safeEvidenceReferences(
  values: readonly Readonly<Record<string, unknown>>[],
  context: TrustedSourceContextProjection,
  operation: GdpsFindingOperationProjection,
  identities: readonly SourceIdentity[],
  outputValue: unknown
): SafeEvidenceReference[] {
  return values.map((candidate): SafeEvidenceReference => {
    const evidence = record(candidate, "SOURCE_EVIDENCE_REFERENCE_INVALID");
    const authority = safeProjectionText(
      evidence["authority"],
      "SOURCE_EVIDENCE_AUTHORITY_INVALID",
      128
    );
    if (authority !== operation.provider.providerId) fail("SOURCE_EVIDENCE_AUTHORITY_MISMATCH");
    const referenceKey = record(evidence["referenceKey"], "SOURCE_EVIDENCE_REFERENCE_KEY_INVALID");
    if (referenceKey["namespace"] !== "gdps" || referenceKey["kind"] !== "DATASET") {
      fail("SOURCE_EVIDENCE_REFERENCE_AUTHORITY_MISMATCH");
    }
    const referenceId = text(referenceKey["id"], "SOURCE_EVIDENCE_REFERENCE_KEY_INVALID");
    const referenceVersion = digest(
      referenceKey["version"],
      "SOURCE_EVIDENCE_REFERENCE_VERSION_INVALID"
    );
    if (operation.authorityKind === "CATALOG") {
      const expectedVersion = outputValue === undefined ? referenceVersion : canonicalSha256(outputValue);
      if (referenceId !== `catalog:${context.dataScope}` || referenceVersion !== expectedVersion) {
        fail("SOURCE_EVIDENCE_CATALOG_BINDING_MISMATCH");
      }
    } else if (identities.length > 0) {
      if (identities.length !== 1) fail("SOURCE_EVIDENCE_PRODUCT_CARDINALITY_MISMATCH");
      const identity = identities[0]!;
      if (referenceId !== `${context.dataScope}:${identity.productId}`
        || referenceVersion !== identity.contentHash) {
        fail("SOURCE_EVIDENCE_PRODUCT_BINDING_MISMATCH");
      }
    } else {
      const outputIdentity = snapshotProductIdentity(outputValue);
      if (outputIdentity !== undefined) {
        if (referenceId !== `${context.dataScope}:${outputIdentity.productId}`
          || referenceVersion !== outputIdentity.contentHash) {
          fail("SOURCE_EVIDENCE_PRODUCT_BINDING_MISMATCH");
        }
      } else if (referenceId !== `catalog:${context.dataScope}`) {
        fail("SOURCE_EVIDENCE_UNBOUND_BINDING_MISMATCH");
      }
    }
    const projection: SafeEvidenceReference = {
      evidenceId: identifier(evidence["evidenceId"], "SOURCE_EVIDENCE_ID_INVALID"),
      authority,
      evidenceType: safeProjectionText(evidence["evidenceType"], "SOURCE_EVIDENCE_TYPE_INVALID", 64),
      referenceKeyHash: canonicalSha256(referenceKey),
      schemaHash: digest(evidence["schemaHash"], "SOURCE_EVIDENCE_SCHEMA_HASH_INVALID"),
      ...(evidence["observedAt"] === undefined
        ? {}
        : { observedAt: dateTime(evidence["observedAt"], "SOURCE_EVIDENCE_TIME_INVALID") }),
      ...(evidence["worldVersion"] === undefined
        ? {}
        : { worldVersion: nonNegativeInteger(evidence["worldVersion"], "SOURCE_EVIDENCE_VERSION_INVALID") })
    };
    return freeze(projection);
  }).sort((left, right) => compareCodePoints(left.evidenceId, right.evidenceId));
}

function stableEvidenceOutput(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => stableEvidenceOutput(item));
    return parentKey === "features" || parentKey === "products"
      ? normalized.sort((left, right) => compareCodePoints(canonicalJson(left), canonicalJson(right)))
      : normalized;
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([key, item]) => [key, stableEvidenceOutput(item, key)]));
}

function localEvidenceItem(
  operation: GdpsFindingOperationProjection,
  upstreamStatus: GowmFindingResultStatus,
  outputValue: unknown,
  dataSnapshot: SafeDataSnapshotProjection | undefined,
  rawDataSnapshot: unknown,
  computeSnapshot: SafeComputeSnapshotProjection,
  rawComputeSnapshot: unknown,
  receiptReferences: readonly SafeReceiptReference[],
  upstreamEvidenceIds: readonly string[]
): WsgsLocalSourceEvidenceItem | undefined {
  if (dataSnapshot === undefined || receiptReferences.length < 1) return undefined;
  const receiptIds = receiptReferences.map(({ receiptId }) => receiptId);
  const outputHash = outputValue === undefined
    ? undefined
    : canonicalSha256(stableEvidenceOutput(outputValue));
  const receiptBinding = receiptReferences.map((receipt) => ({
    ...receipt,
    ...(outputHash === undefined ? {} : { outputHash })
  }));
  const body = {
    evidenceKind: "GOWM_GDPS_EXECUTION_PROVENANCE" as const,
    authorityClosureHash: operation.closureHash,
    sourceOperation: `${operation.operationId}@${operation.operationVersion}`,
    upstreamStatus,
    outputSchemaHash: operation.outputSchemaHash,
    ...(outputHash === undefined ? {} : { outputHash }),
    dataSnapshotHash: canonicalSha256(rawDataSnapshot),
    computeSnapshotHash: canonicalSha256(rawComputeSnapshot),
    receiptSetHash: canonicalSha256(receiptBinding),
    receiptIds: [...receiptIds],
    upstreamEvidenceIds: [...upstreamEvidenceIds]
  };
  const semanticIdentity = {
    evidenceKind: body.evidenceKind,
    authorityClosureHash: body.authorityClosureHash,
    sourceOperation: body.sourceOperation,
    upstreamStatus: body.upstreamStatus,
    outputSchemaHash: body.outputSchemaHash,
    ...(outputHash === undefined ? {} : { outputHash }),
    dataSnapshot: {
      consistency: dataSnapshot.consistency,
      scopeDigest: dataSnapshot.scopeDigest,
      resources: dataSnapshot.resources
    },
    computeSnapshot
  };
  const evidenceItemId = deterministicId("evidence", semanticIdentity);
  return freeze({ evidenceItemId, ...body, evidenceHash: canonicalSha256(body) });
}

function qualitySummary(value: unknown): SacsGeospatialSourceProduct["qualitySummary"] | undefined {
  if (value === undefined) return undefined;
  const quality = record(value, "SOURCE_QUALITY_INVALID");
  const summary: NonNullable<SacsGeospatialSourceProduct["qualitySummary"]> = {};
  if (quality["qualityClass"] !== undefined) {
    const code = text(quality["qualityClass"], "SOURCE_QUALITY_CLASS_INVALID", 64);
    if (!safeCodePattern.test(code)) fail("SOURCE_QUALITY_CLASS_INVALID");
    summary.qualityClass = code;
  }
  if (quality["valueAccuracyDegree"] !== undefined) {
    summary.valueAccuracyDegree = finiteNonNegative(
      quality["valueAccuracyDegree"],
      "SOURCE_QUALITY_VALUE_ACCURACY_INVALID"
    );
  }
  if (quality["horizontalAccuracyM"] !== undefined) {
    summary.horizontalAccuracyM = finiteNonNegative(
      quality["horizontalAccuracyM"],
      "SOURCE_QUALITY_HORIZONTAL_ACCURACY_INVALID"
    );
  }
  if (quality["verticalAccuracyM"] !== undefined) {
    summary.verticalAccuracyM = finiteNonNegative(
      quality["verticalAccuracyM"],
      "SOURCE_QUALITY_VERTICAL_ACCURACY_INVALID"
    );
  }
  const completeness = quality["completenessRatio"] ?? quality["completeness"];
  if (completeness !== undefined) {
    const parsed = finiteNonNegative(completeness, "SOURCE_QUALITY_COMPLETENESS_INVALID");
    if (parsed > 1) fail("SOURCE_QUALITY_COMPLETENESS_INVALID");
    summary.completenessRatio = parsed;
  }
  return Object.keys(summary).length === 0 ? undefined : freeze(summary);
}

function assertNoSensitiveProjection(value: unknown): void {
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (candidate === null || typeof candidate !== "object") return;
    for (const [key, child] of Object.entries(candidate as Record<string, unknown>)) {
      if (key !== "authorizationBindingHash" && forbiddenSensitiveKey.test(key)) {
        fail("SOURCE_PROJECTION_SENSITIVE_FIELD");
      }
      visit(child);
    }
  };
  visit(value);
}

function sourceIdentity(
  product: Record<string, unknown>,
  descriptor: NonNullable<GdpsFindingOperationProjection["descriptor"]>,
  nestedResult?: Record<string, unknown>
): SourceIdentity {
  const actualProductId = productId(product["productId"]);
  const actualContentHash = digest(product["contentHash"], "SOURCE_CONTENT_HASH_REQUIRED");
  if (nestedResult !== undefined
    && (nestedResult["productId"] !== actualProductId || nestedResult["contentHash"] !== actualContentHash)) {
    fail("SOURCE_WRAPPED_PRODUCT_IDENTITY_MISMATCH");
  }
  if (product["descriptorId"] !== undefined && product["descriptorId"] !== descriptor.descriptorId) {
    fail("SOURCE_DESCRIPTOR_ID_MISMATCH");
  }
  if (product["descriptorHash"] !== undefined && product["descriptorHash"] !== descriptor.descriptorHash) {
    fail("SOURCE_DESCRIPTOR_HASH_MISMATCH");
  }
  if (product["productType"] !== undefined && product["productType"] !== descriptor.productType) {
    fail("SOURCE_PRODUCT_TYPE_MISMATCH");
  }
  if (product["productProfile"] !== undefined && product["productProfile"] !== descriptor.productProfile) {
    fail("SOURCE_PRODUCT_PROFILE_MISMATCH");
  }
  const safeQuality = qualitySummary(product["quality"]);
  return freeze({
    productId: actualProductId,
    productType: descriptor.productType,
    productProfile: descriptor.productProfile,
    contentHash: actualContentHash,
    descriptorId: descriptor.descriptorId,
    descriptorHash: descriptor.descriptorHash,
    ...(product["dataTime"] === undefined
      ? {}
      : { dataTime: dateTime(product["dataTime"], "SOURCE_DATA_TIME_INVALID") }),
    ...(safeQuality === undefined ? {} : { qualitySummary: safeQuality })
  });
}

function catalogDescriptor(product: Record<string, unknown>): NonNullable<GdpsFindingOperationProjection["descriptor"]> {
  const metadata = record(product["metadata"], "SOURCE_CATALOG_METADATA_REQUIRED");
  const gdpsDescriptor = record(metadata["gdpsDescriptor"], "SOURCE_CATALOG_DESCRIPTOR_REQUIRED");
  const descriptorId = text(gdpsDescriptor["descriptorId"], "SOURCE_DESCRIPTOR_ID_REQUIRED");
  const descriptorHash = digest(gdpsDescriptor["descriptorHash"], "SOURCE_DESCRIPTOR_HASH_REQUIRED");
  const expectedProductType = text(product["productType"], "SOURCE_PRODUCT_TYPE_REQUIRED", 128);
  const expectedProductProfile = text(metadata["productProfile"], "SOURCE_PRODUCT_PROFILE_REQUIRED", 128);
  const matches: NonNullable<GdpsFindingOperationProjection["descriptor"]>[] = [];
  for (const operationId of descriptorProbeOperations) {
    try {
      const authority = resolveGdpsFindingOperationAuthority(exactFinalAuthority(), {
        operationId,
        operationVersion: "1.0",
        semanticConcept: "SOURCE_PRODUCT_AUTHORITY",
        descriptorId
      });
      const descriptor = readGdpsFindingOperationAuthority(authority).descriptor;
      if (descriptor !== undefined
        && !matches.some((candidate) => candidate.descriptorHash === descriptor.descriptorHash)) {
        matches.push(descriptor);
      }
    } catch {
      // Exact closure lookup is intentionally attempted across the finite generic operation set.
    }
  }
  if (matches.length !== 1) fail("SOURCE_CATALOG_DESCRIPTOR_NOT_LOCKED");
  const descriptor = matches[0]!;
  if (descriptor.descriptorHash !== descriptorHash) fail("SOURCE_DESCRIPTOR_HASH_MISMATCH");
  if (descriptor.productType !== expectedProductType) fail("SOURCE_PRODUCT_TYPE_MISMATCH");
  if (descriptor.productProfile !== expectedProductProfile) fail("SOURCE_PRODUCT_PROFILE_MISMATCH");
  return descriptor;
}

function currentProductIdentity(
  value: unknown,
  context: TrustedSourceContextProjection
): SourceIdentity {
  const product = record(value, "SOURCE_CURRENT_PRODUCT_INVALID");
  if (product["dataScopeKey"] !== context.dataScope) fail("SOURCE_CATALOG_DATA_SCOPE_MISMATCH");
  return sourceIdentity(product, catalogDescriptor(product));
}

function identitiesForResult(
  validated: ReturnType<typeof readValidatedGowmFindingResult>,
  context: TrustedSourceContextProjection
): SourceIdentity[] {
  const { envelope, operation } = validated;
  if (envelope.status !== "COMPLETED" && envelope.status !== "PARTIAL") return [];
  const output = envelope.output;
  if (output === undefined) fail("SOURCE_RESULT_OUTPUT_REQUIRED");
  const value = record(output.value, "SOURCE_RESULT_VALUE_INVALID");
  if (operation.authorityKind === "CATALOG") {
    if (operation.operationId === "geo-product.get") return [currentProductIdentity(value, context)];
    if (operation.operationId !== "geo-product.search") fail("SOURCE_CATALOG_OPERATION_UNSUPPORTED");
    if (!Array.isArray(value["products"])) fail("SOURCE_CATALOG_PRODUCTS_INVALID");
    return value["products"].map((product) => currentProductIdentity(product, context));
  }
  const descriptor = operation.descriptor;
  if (descriptor === undefined) fail("SOURCE_OPERATION_DESCRIPTOR_REQUIRED");
  const nestedResult = value["result"] === undefined
    ? undefined
    : record(value["result"], "SOURCE_WRAPPED_RESULT_INVALID");
  return [sourceIdentity(value, descriptor, nestedResult)];
}

function coreSourceIdentity(identity: SourceIdentity): Readonly<Record<string, string>> {
  return freeze({
    productId: identity.productId,
    productType: identity.productType,
    productProfile: identity.productProfile,
    contentHash: identity.contentHash,
    descriptorId: identity.descriptorId,
    descriptorHash: identity.descriptorHash
  });
}

function productIdentityKey(identity: SourceIdentity): string {
  return canonicalSha256(coreSourceIdentity(identity));
}

function sameCoreSourceIdentity(left: SourceIdentity, right: SourceIdentity): boolean {
  return productIdentityKey(left) === productIdentityKey(right);
}

function mergeQualitySummary(
  left: SacsGeospatialSourceProduct["qualitySummary"],
  right: SacsGeospatialSourceProduct["qualitySummary"]
): SacsGeospatialSourceProduct["qualitySummary"] | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  const keys = [
    "qualityClass",
    "valueAccuracyDegree",
    "horizontalAccuracyM",
    "verticalAccuracyM",
    "completenessRatio"
  ] as const;
  const merged: NonNullable<SacsGeospatialSourceProduct["qualitySummary"]> = {};
  for (const key of keys) {
    const leftValue = left[key];
    const rightValue = right[key];
    if (leftValue !== undefined && rightValue !== undefined && leftValue !== rightValue) {
      fail("SOURCE_CHANGED");
    }
    const selected = leftValue ?? rightValue;
    if (selected !== undefined) {
      (merged as Record<string, unknown>)[key] = selected;
    }
  }
  return freeze(merged);
}

function mergeSourceIdentity(left: SourceIdentity, right: SourceIdentity): SourceIdentity {
  if (!sameCoreSourceIdentity(left, right)) fail("SOURCE_CHANGED");
  if (left.dataTime !== undefined && right.dataTime !== undefined && left.dataTime !== right.dataTime) {
    fail("SOURCE_CHANGED");
  }
  const dataTime = left.dataTime ?? right.dataTime;
  const mergedQuality = mergeQualitySummary(left.qualitySummary, right.qualitySummary);
  return freeze({
    ...coreSourceIdentity(left),
    ...(dataTime === undefined ? {} : { dataTime }),
    ...(mergedQuality === undefined ? {} : { qualitySummary: mergedQuality })
  }) as SourceIdentity;
}

function publicSourceProduct(value: MutableSourceProduct): SacsGeospatialSourceProduct {
  const evidenceItemIds = [...value.evidenceItemIds].sort(compareCodePoints);
  if (evidenceItemIds.length < 1) fail("SOURCE_EVIDENCE_REQUIRED");
  if (evidenceItemIds.length > 128) fail("SOURCE_EVIDENCE_LIMIT_EXCEEDED");
  const identity = value.identity;
  const product = freeze({
    sourceProductId: value.sourceProductId,
    authority: "GDPS_CURRENT_PRODUCT" as const,
    productId: identity.productId,
    productType: identity.productType,
    productProfile: identity.productProfile,
    contentHash: identity.contentHash,
    descriptorId: identity.descriptorId,
    descriptorHash: identity.descriptorHash,
    ...(identity.dataTime === undefined ? {} : { dataTime: identity.dataTime }),
    ...(identity.qualitySummary === undefined ? {} : { qualitySummary: identity.qualitySummary }),
    evidenceItemIds
  });
  defaultSacsGeospatialSchemaRegistry().validate("source-product.schema.json", product);
  return product;
}

type ValidatedSourceProjection = ReturnType<typeof readValidatedGowmFindingResult>;

interface PreparedSourceEnvelope {
  readonly validated: ValidatedSourceProjection;
  readonly identities: readonly SourceIdentity[];
  readonly dataSnapshot?: SafeDataSnapshotProjection;
  readonly computeSnapshot: SafeComputeSnapshotProjection;
  readonly receiptReferences: readonly SafeReceiptReference[];
  readonly evidenceReferences: readonly SafeEvidenceReference[];
  readonly receiptIds: readonly string[];
  readonly localEvidence?: WsgsLocalSourceEvidenceItem;
  readonly evidenceItemIds: readonly string[];
}

function recoverableRejectionReason(error: unknown): SourceProvenanceRejectionReason | undefined {
  if (!(error instanceof SourceProductNormalizationError)) return undefined;
  if (error.code === "SOURCE_DATA_SNAPSHOT_REQUIRED"
    || error.code === "SOURCE_LOCAL_EVIDENCE_REQUIRED") {
    return "EVIDENCE_INCOMPLETE";
  }
  if (error.code === "SOURCE_CATALOG_METADATA_REQUIRED"
    || error.code === "SOURCE_CATALOG_DESCRIPTOR_REQUIRED"
    || error.code === "SOURCE_CATALOG_DESCRIPTOR_NOT_LOCKED"
    || error.code === "SOURCE_DESCRIPTOR_ID_REQUIRED"
    || error.code === "SOURCE_DESCRIPTOR_HASH_REQUIRED"
    || error.code === "SOURCE_PRODUCT_TYPE_REQUIRED"
    || error.code === "SOURCE_PRODUCT_PROFILE_REQUIRED") {
    return "UNSUPPORTED_FINDING_SCHEMA";
  }
  return undefined;
}

function prepareSourceEnvelope(
  validated: ValidatedSourceProjection,
  context: TrustedSourceContextProjection
): PreparedSourceEnvelope {
  const identities = identitiesForResult(validated, context);
  const dataSnapshot = validated.envelope["dataSnapshot"] === undefined
    ? undefined
    : safeDataSnapshot(
        validated.envelope["dataSnapshot"],
        context,
        validated.operation,
        identities,
        validated.envelope.output?.value
      );
  if (identities.length > 0 && dataSnapshot === undefined) fail("SOURCE_DATA_SNAPSHOT_REQUIRED");
  const receiptReferences = safeReceiptReferences(validated.envelope.receipts);
  const evidenceReferences = safeEvidenceReferences(
    validated.envelope.evidenceReferences,
    context,
    validated.operation,
    identities,
    validated.envelope.output?.value
  );
  const receiptIds = uniqueSorted(
    receiptReferences.map((receipt) => receipt.receiptId),
    "SOURCE_RECEIPT_ID_DUPLICATE"
  );
  const upstreamEvidenceIds = uniqueSorted(
    evidenceReferences.map((evidence) => evidence.evidenceId),
    "SOURCE_EVIDENCE_ID_DUPLICATE"
  );
  const computeSnapshot = safeComputeSnapshot(validated.envelope.computeSnapshot);
  const localEvidence = localEvidenceItem(
    validated.operation,
    validated.envelope.status,
    validated.envelope.output?.value,
    dataSnapshot,
    validated.envelope["dataSnapshot"],
    computeSnapshot,
    validated.envelope.computeSnapshot,
    receiptReferences,
    upstreamEvidenceIds
  );
  if (identities.length > 0 && localEvidence === undefined) fail("SOURCE_LOCAL_EVIDENCE_REQUIRED");
  return {
    validated,
    identities,
    ...(dataSnapshot === undefined ? {} : { dataSnapshot }),
    computeSnapshot,
    receiptReferences,
    evidenceReferences,
    receiptIds,
    ...(localEvidence === undefined ? {} : { localEvidence }),
    evidenceItemIds: localEvidence === undefined ? [] : [localEvidence.evidenceItemId]
  };
}

function rejectedEnvelopeBinding(
  validated: ValidatedSourceProjection,
  context: TrustedSourceContextProjection,
  authorizationBindingHash: Sha256Digest,
  reason: SourceProvenanceRejectionReason
): SourceEnvelopeBinding {
  const outputValue = validated.envelope.output?.value;
  const dataSnapshot = validated.envelope["dataSnapshot"] === undefined
    ? undefined
    : safeDataSnapshot(
        validated.envelope["dataSnapshot"],
        context,
        validated.operation,
        [],
        outputValue
      );
  const computeSnapshot = safeComputeSnapshot(validated.envelope.computeSnapshot);
  const receiptReferences = safeReceiptReferences(validated.envelope.receipts);
  const evidenceReferences = safeEvidenceReferences(
    validated.envelope.evidenceReferences,
    context,
    validated.operation,
    [],
    outputValue
  );
  const receiptIds = uniqueSorted(
    receiptReferences.map(({ receiptId }) => receiptId),
    "SOURCE_RECEIPT_ID_DUPLICATE"
  );
  const bindingBody = {
    envelopeHash: validated.envelopeHash,
    operationId: validated.operation.operationId,
    operationVersion: validated.operation.operationVersion,
    status: validated.envelope.status,
    sourceProductIds: [] as readonly string[],
    evidenceItemIds: [] as readonly string[],
    receiptIds,
    authorizationBindingHash,
    qualification: freeze({ status: "REJECTED" as const, reason }),
    ...(dataSnapshot === undefined ? {} : { dataSnapshot }),
    computeSnapshot,
    receiptReferences,
    evidenceReferences
  };
  assertNoSensitiveProjection(bindingBody);
  return freeze({ ...bindingBody, provenanceHash: canonicalSha256(bindingBody) });
}

function mintNormalizedBinding(
  sourceProducts: readonly SacsGeospatialSourceProduct[],
  envelopeBindings: readonly SourceEnvelopeBinding[]
): NormalizedSourceProductBinding {
  const sortedEnvelopeBindings = [...envelopeBindings].sort(
    (left, right) => compareCodePoints(left.envelopeHash, right.envelopeHash)
  );
  const sourceProductSetHash = canonicalSha256(sourceProducts);
  const semanticHash = canonicalSha256({ sourceProducts, envelopeBindings: sortedEnvelopeBindings });
  const token = freeze({
    sourceProductSetHash,
    sourceProductCount: sourceProducts.length,
    envelopeBindingCount: sortedEnvelopeBindings.length
  });
  const projection = freeze({
    sourceProducts: [...sourceProducts],
    sourceProductSetHash,
    envelopeBindings: sortedEnvelopeBindings
  });
  normalizedBindings.set(token, freeze({ projection, semanticHash }));
  return token;
}

function normalizeSourceProductsWithContext(
  input: NormalizeSourceProductsInput,
  context: TrustedSourceContextProjection
): NormalizedSourceProductBinding {
  const authorizationBindingHash = canonicalSha256(context);
  const productsByIdentity = new Map<string, MutableSourceProduct>();
  const productVersionById = new Map<string, SourceIdentity>();
  const envelopeBindings: SourceEnvelopeBinding[] = [];
  const seenEnvelopeHashes = new Set<string>();
  let localEvidenceCount = 0;

  for (const result of input.validatedResults) {
    const validated = readValidatedGowmFindingResult(result);
    if (validated.operation.closureHash !== exactFinalAuthority().closureHash) {
      fail("SOURCE_AUTHORITY_CLOSURE_MISMATCH");
    }
    if (seenEnvelopeHashes.has(validated.envelopeHash)) fail("SOURCE_DUPLICATE_ENVELOPE");
    seenEnvelopeHashes.add(validated.envelopeHash);
    let prepared: PreparedSourceEnvelope;
    try {
      prepared = prepareSourceEnvelope(validated, context);
    } catch (error) {
      const reason = recoverableRejectionReason(error);
      if (reason === undefined) throw error;
      envelopeBindings.push(rejectedEnvelopeBinding(
        validated,
        context,
        authorizationBindingHash,
        reason
      ));
      continue;
    }
    const {
      identities,
      dataSnapshot,
      computeSnapshot,
      receiptReferences,
      evidenceReferences,
      receiptIds,
      localEvidence,
      evidenceItemIds
    } = prepared;
    if (localEvidence !== undefined && ++localEvidenceCount > 128) {
      fail("SOURCE_EVIDENCE_SET_LIMIT_EXCEEDED");
    }
    const sourceProductIds: string[] = [];
    for (const observedIdentity of identities) {
      let identity = observedIdentity;
      const priorVersion = productVersionById.get(identity.productId);
      if (priorVersion !== undefined) {
        identity = mergeSourceIdentity(priorVersion, identity);
      }
      productVersionById.set(identity.productId, identity);
      const key = productIdentityKey(identity);
      let product = productsByIdentity.get(key);
      if (product === undefined) {
        product = {
          identity,
          sourceProductId: deterministicId("source", {
            sourceAuthority: "GDPS_CURRENT_PRODUCT",
            authorityClosureHash: validated.operation.closureHash,
            productId: identity.productId,
            productType: identity.productType,
            productProfile: identity.productProfile,
            contentHash: identity.contentHash,
            descriptorId: identity.descriptorId,
            descriptorHash: identity.descriptorHash
          }),
          evidenceItemIds: new Set<string>()
        };
        productsByIdentity.set(key, product);
      } else {
        product.identity = mergeSourceIdentity(product.identity, identity);
      }
      evidenceItemIds.forEach((id) => product!.evidenceItemIds.add(id));
      sourceProductIds.push(product.sourceProductId);
    }
    const bindingBody = {
      envelopeHash: validated.envelopeHash,
      operationId: validated.operation.operationId,
      operationVersion: validated.operation.operationVersion,
      status: validated.envelope.status,
      sourceProductIds: [...new Set(sourceProductIds)].sort(compareCodePoints),
      evidenceItemIds,
      receiptIds,
      authorizationBindingHash,
      qualification: freeze({ status: "QUALIFIED" as const }),
      ...(localEvidence === undefined ? {} : { localEvidenceItem: localEvidence }),
      ...(dataSnapshot === undefined ? {} : { dataSnapshot }),
      computeSnapshot,
      receiptReferences,
      evidenceReferences
    };
    assertNoSensitiveProjection(bindingBody);
    envelopeBindings.push(freeze({ ...bindingBody, provenanceHash: canonicalSha256(bindingBody) }));
  }

  const sourceProducts = [...productsByIdentity.values()]
    .map(publicSourceProduct)
    .sort((left, right) => compareCodePoints(left.sourceProductId, right.sourceProductId));
  if (sourceProducts.length > 64) fail("SOURCE_PRODUCT_SET_LIMIT_EXCEEDED");
  return mintNormalizedBinding(sourceProducts, envelopeBindings);
}

function sourceChangedBinding(
  input: NormalizeSourceProductsInput,
  context: TrustedSourceContextProjection
): NormalizedSourceProductBinding {
  const authorizationBindingHash = canonicalSha256(context);
  const seenEnvelopeHashes = new Set<string>();
  const envelopeBindings = input.validatedResults.map((result) => {
    const validated = readValidatedGowmFindingResult(result);
    if (validated.operation.closureHash !== exactFinalAuthority().closureHash) {
      fail("SOURCE_AUTHORITY_CLOSURE_MISMATCH");
    }
    if (seenEnvelopeHashes.has(validated.envelopeHash)) fail("SOURCE_DUPLICATE_ENVELOPE");
    seenEnvelopeHashes.add(validated.envelopeHash);
    return rejectedEnvelopeBinding(
      validated,
      context,
      authorizationBindingHash,
      "SOURCE_CHANGED"
    );
  });
  return mintNormalizedBinding([], envelopeBindings);
}

export function normalizeSourceProducts(
  input: NormalizeSourceProductsInput
): NormalizedSourceProductBinding {
  if (input === null || typeof input !== "object") fail("SOURCE_NORMALIZATION_INPUT_INVALID");
  const context = requireTrustedContext(input.trustedContext);
  if (!Array.isArray(input.validatedResults) || input.validatedResults.length < 1) {
    fail("SOURCE_VALIDATED_RESULTS_REQUIRED");
  }
  try {
    return normalizeSourceProductsWithContext(input, context);
  } catch (error) {
    if (!(error instanceof SourceProductNormalizationError) || error.code !== "SOURCE_CHANGED") {
      throw error;
    }
    return sourceChangedBinding(input, context);
  }
}

/**
 * Internal runtime bridge. The package root must not re-export this minting
 * function: only the authenticated admission path may turn a verified identity
 * into an opaque normalization context.
 *
 * @internal
 */
export function createTrustedSourceContext(
  identity: SourceGroundingIdentity,
  selectedDataScope: string
): TrustedSourceRuntimeContext {
  const context = contextFromScopedIdentity(identity, selectedDataScope);
  const token = freeze({ authorizationBindingHash: canonicalSha256(context) });
  trustedSourceContexts.set(token, context);
  return token;
}

export function readNormalizedSourceProductBinding(
  binding: NormalizedSourceProductBinding
): NormalizedSourceProductProjection {
  if (binding === null || typeof binding !== "object") fail("SOURCE_PROVENANCE_BINDING_FORGED");
  const state = normalizedBindings.get(binding);
  if (state === undefined) fail("SOURCE_PROVENANCE_BINDING_FORGED");
  if (canonicalSha256({
    sourceProducts: state.projection.sourceProducts,
    envelopeBindings: state.projection.envelopeBindings
  }) !== state.semanticHash
    || canonicalSha256(state.projection.sourceProducts) !== state.projection.sourceProductSetHash) {
    fail("SOURCE_PROVENANCE_BINDING_MUTATED");
  }
  return state.projection;
}
