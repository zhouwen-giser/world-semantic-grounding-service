import { hashCanonicalJson } from "./canonical.js";
import type {
  NewJobSnapshotReadiness,
  SchemaValidatedAvailability,
  SchemaValidatedCapability,
  SchemaValidatedSemanticProfile,
  Sha256Digest,
  SouthboundOperationLockEntry,
  TrustedCapabilitySnapshot,
  TrustedCapabilitySnapshotAvailability,
  TrustedCapabilitySnapshotBody,
  TrustedCapabilitySnapshotCapability,
  TrustedCapabilitySnapshotErrorCode,
  TrustedCapabilitySnapshotInput
} from "./types.js";

const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const sha512IntegrityPattern = /^sha512-[A-Za-z0-9+/=]+$/u;
const operationIdPattern = /^[a-z][a-z0-9.-]{2,127}$/u;
const operationVersionPattern = /^[0-9]+\.[0-9]+$/u;
const maximumSnapshotOperations = 256;
const maximumSupportedFutureClockSkewMs = 1_000;

export class TrustedCapabilitySnapshotError extends Error {
  constructor(
    readonly code: TrustedCapabilitySnapshotErrorCode,
    message: string = code
  ) {
    super(message);
    this.name = "TrustedCapabilitySnapshotError";
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function operationKey(entry: { readonly operationId: string; readonly operationVersion: string }): string {
  if (!operationIdPattern.test(entry.operationId) || !operationVersionPattern.test(entry.operationVersion)) {
    throw new TrustedCapabilitySnapshotError(
      "INVALID_OPERATION_KEY",
      `Invalid operation key ${entry.operationId}@${entry.operationVersion}`
    );
  }
  return `${entry.operationId}@${entry.operationVersion}`;
}

function compareOperations(
  left: { readonly operationId: string; readonly operationVersion: string },
  right: { readonly operationId: string; readonly operationVersion: string }
): number {
  return compareText(operationKey(left), operationKey(right));
}

function assertSha256(value: string, field: string): asserts value is Sha256Digest {
  if (!sha256Pattern.test(value)) {
    throw new TrustedCapabilitySnapshotError("INVALID_DIGEST", `${field} is not a canonical SHA-256 digest`);
  }
}

function assertInputMetadata(input: TrustedCapabilitySnapshotInput): void {
  const lock = input.southboundLock;
  if (lock.gatewayContractVersion !== "0.6.3" || lock.schemaVersion !== "2.0") {
    throw new TrustedCapabilitySnapshotError(
      "GATEWAY_CONTRACT_VERSION_MISMATCH",
      "Trusted snapshots require the GOWM 0.6.3 southbound lock"
    );
  }
  if (lock.consumerContractPackage.name !== "@gowm/world-gateway-contracts"
    || lock.consumerContractPackage.version !== "0.6.3") {
    throw new TrustedCapabilitySnapshotError(
      "CONSUMER_CONTRACT_PACKAGE_MISMATCH",
      "Southbound lock does not identify the GOWM 0.6.3 consumer contract package"
    );
  }
  if (!sha512IntegrityPattern.test(lock.consumerContractPackage.integrity)) {
    throw new TrustedCapabilitySnapshotError("INVALID_PACKAGE_INTEGRITY");
  }
  const digests: ReadonlyArray<readonly [string, string]> = [
    ["southboundLockHash", input.southboundLockHash],
    ["lock.contractCatalogRevision", lock.contractCatalogRevision],
    ["lock.semanticCatalogHash", lock.semanticCatalogHash],
    ["lock.availabilityContractHash", lock.availabilityContractHash],
    ["lock.snapshotContractHash", lock.snapshotContractHash],
    ["lock.delegationContractHash", lock.delegationContractHash],
    ["catalog.contractCatalogRevision", input.catalog.contractCatalogRevision],
    ["catalog.bindingRevision", input.catalog.bindingRevision],
    ["semantics.contractCatalogRevision", input.semantics.contractCatalogRevision],
    ["semantics.bindingRevision", input.semantics.bindingRevision],
    ["semantics.catalogHash", input.semantics.catalogHash]
  ];
  for (const [field, value] of digests) assertSha256(value, field);
}

function toTimestamp(value: string, code: "AVAILABILITY_TIME_INVALID" | "INVALID_CAPTURE_TIME", field: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new TrustedCapabilitySnapshotError(code, `${field} is not a valid timestamp`);
  }
  return timestamp;
}

function capturedAt(input: TrustedCapabilitySnapshotInput): Date {
  const value = input.capturedAt === undefined ? new Date() : new Date(input.capturedAt.getTime());
  if (!Number.isFinite(value.getTime())) throw new TrustedCapabilitySnapshotError("INVALID_CAPTURE_TIME");
  return value;
}

function maximumFutureClockSkewMs(input: TrustedCapabilitySnapshotInput): number {
  const value = input.maximumFutureClockSkewMs ?? 0;
  if (!Number.isInteger(value) || value < 0 || value > maximumSupportedFutureClockSkewMs) {
    throw new TrustedCapabilitySnapshotError(
      "INVALID_FUTURE_CLOCK_SKEW",
      `maximumFutureClockSkewMs must be an integer between 0 and ${maximumSupportedFutureClockSkewMs}`
    );
  }
  return value;
}

function indexUnique<T extends { readonly operationId: string; readonly operationVersion: string }>(
  entries: readonly T[],
  duplicateCode: "DUPLICATE_LOCKED_OPERATION" | "DUPLICATE_CAPABILITY" | "DUPLICATE_SEMANTIC_PROFILE" | "DUPLICATE_AVAILABILITY"
): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const entry of entries) {
    const key = operationKey(entry);
    if (indexed.has(key)) {
      throw new TrustedCapabilitySnapshotError(duplicateCode, `Duplicate ${key}`);
    }
    indexed.set(key, entry);
  }
  return indexed;
}

function lockedOperations(input: TrustedCapabilitySnapshotInput): readonly SouthboundOperationLockEntry[] {
  const entries = [...input.southboundLock.defaultOperations, ...input.southboundLock.previewOperations];
  if (entries.length > maximumSnapshotOperations) {
    throw new TrustedCapabilitySnapshotError(
      "SNAPSHOT_LIMIT_EXCEEDED",
      `Trusted capability snapshot has ${entries.length} operations; maximum is ${maximumSnapshotOperations}`
    );
  }
  indexUnique(entries, "DUPLICATE_LOCKED_OPERATION");
  return entries;
}

function availabilityReadiness(
  entry: SchemaValidatedAvailability | undefined,
  key: string,
  input: TrustedCapabilitySnapshotInput,
  at: number,
  maximumClockSkewMs: number
): NewJobSnapshotReadiness {
  if (entry === undefined) return { status: "REFRESH_AVAILABILITY", code: "AVAILABILITY_MISSING", operationKey: key };
  assertSha256(entry.contractCatalogRevision, `${key}.availability.contractCatalogRevision`);
  assertSha256(entry.bindingRevision, `${key}.availability.bindingRevision`);
  if (entry.contractCatalogRevision !== input.catalog.contractCatalogRevision) {
    return { status: "REFRESH_AVAILABILITY", code: "AVAILABILITY_CONTRACT_REVISION_MISMATCH", operationKey: key };
  }
  if (entry.bindingRevision !== input.catalog.bindingRevision) {
    return { status: "REFRESH_AVAILABILITY", code: "AVAILABILITY_REFRESH_REQUIRED", operationKey: key };
  }
  const observedAt = toTimestamp(entry.checkedAt, "AVAILABILITY_TIME_INVALID", `${key}.checkedAt`);
  const validUntil = toTimestamp(entry.validUntil, "AVAILABILITY_TIME_INVALID", `${key}.validUntil`);
  if (validUntil < observedAt) {
    throw new TrustedCapabilitySnapshotError(
      "AVAILABILITY_TIME_INVALID",
      `${key} availability expires before it was observed`
    );
  }
  if (observedAt > at + maximumClockSkewMs) {
    throw new TrustedCapabilitySnapshotError(
      "AVAILABILITY_OBSERVED_IN_FUTURE",
      `${key} availability observation is later than snapshot capture time`
    );
  }
  if (validUntil <= Math.max(at, observedAt)) {
    return { status: "REFRESH_AVAILABILITY", code: "AVAILABILITY_EXPIRED", operationKey: key };
  }
  return { status: "READY" };
}

/**
 * Evaluates whether live, schema-validated GOWM metadata can be captured for a
 * new job. Catalog or semantic drift is terminal; stale binding observations
 * explicitly request an Availability refresh instead of becoming contract drift.
 */
export function evaluateNewJobSnapshotReadiness(input: TrustedCapabilitySnapshotInput): NewJobSnapshotReadiness {
  assertInputMetadata(input);
  const at = capturedAt(input).getTime();
  const maximumClockSkewMs = maximumFutureClockSkewMs(input);
  const lockEntries = lockedOperations(input);
  indexUnique(input.catalog.capabilities, "DUPLICATE_CAPABILITY");
  indexUnique(input.semantics.profiles, "DUPLICATE_SEMANTIC_PROFILE");
  const availability = indexUnique(input.availability.operations, "DUPLICATE_AVAILABILITY");

  if (input.catalog.contractCatalogRevision !== input.southboundLock.contractCatalogRevision
    || input.semantics.contractCatalogRevision !== input.southboundLock.contractCatalogRevision) {
    return { status: "FAIL_CLOSED", code: "CONTRACT_CATALOG_DRIFT" };
  }
  if (input.semantics.catalogHash !== input.southboundLock.semanticCatalogHash) {
    return { status: "FAIL_CLOSED", code: "SEMANTIC_CATALOG_DRIFT" };
  }
  if (hashCanonicalJson(input.semantics.profiles) !== input.semantics.catalogHash) {
    return { status: "FAIL_CLOSED", code: "SEMANTIC_CATALOG_CONTENT_MISMATCH" };
  }
  if (input.catalog.contractCatalogRevision !== input.semantics.contractCatalogRevision) {
    return { status: "FAIL_CLOSED", code: "CATALOG_SEMANTIC_REVISION_MISMATCH" };
  }
  if (input.catalog.bindingRevision !== input.semantics.bindingRevision) {
    return { status: "FAIL_CLOSED", code: "BINDING_METADATA_MISMATCH" };
  }

  for (const entry of lockEntries) {
    const readiness = availabilityReadiness(
      availability.get(operationKey(entry)),
      operationKey(entry),
      input,
      at,
      maximumClockSkewMs
    );
    if (readiness.status !== "READY") return readiness;
  }
  return { status: "READY" };
}

function throwForReadiness(readiness: Exclude<NewJobSnapshotReadiness, { readonly status: "READY" }>): never {
  throw new TrustedCapabilitySnapshotError(
    readiness.code,
    readiness.status === "REFRESH_AVAILABILITY" && readiness.operationKey !== undefined
      ? `${readiness.code}: ${readiness.operationKey}`
      : readiness.code
  );
}

function assertCapabilityMatchesLock(
  lock: SouthboundOperationLockEntry,
  capability: SchemaValidatedCapability | undefined,
  profile: SchemaValidatedSemanticProfile | undefined
): void {
  const key = operationKey(lock);
  if (capability === undefined) {
    throw new TrustedCapabilitySnapshotError("CAPABILITY_MISSING", key);
  }
  if (capability.inputSchemaHash !== lock.inputSchemaHash
    || capability.outputSchemaHash !== lock.outputSchemaHash
    || capability.maturity !== lock.maturity) {
    throw new TrustedCapabilitySnapshotError("CAPABILITY_LOCK_MISMATCH", key);
  }
  if (profile === undefined) {
    throw new TrustedCapabilitySnapshotError("SEMANTIC_PROFILE_MISSING", key);
  }
  if (profile.semanticProfileHash !== lock.semanticProfileHash
    || hashCanonicalJson(profile.semanticProfile) !== lock.semanticProfileHash
    || hashCanonicalJson(capability.semanticProfile) !== lock.semanticProfileHash) {
    throw new TrustedCapabilitySnapshotError("SEMANTIC_PROFILE_LOCK_MISMATCH", key);
  }
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareText);
}

function snapshotCapability(entry: SouthboundOperationLockEntry): TrustedCapabilitySnapshotCapability {
  return {
    operationId: entry.operationId,
    operationVersion: entry.operationVersion,
    inputSchemaHash: entry.inputSchemaHash,
    outputSchemaHash: entry.outputSchemaHash,
    semanticProfileHash: entry.semanticProfileHash,
    maturity: entry.maturity,
    snapshotSupport: entry.snapshotSupport,
    requiredPermissions: sortedUnique(entry.requiredPermissions)
  };
}

function snapshotAvailability(entry: SchemaValidatedAvailability): TrustedCapabilitySnapshotAvailability {
  return {
    operationId: entry.operationId,
    operationVersion: entry.operationVersion,
    availability: entry.availability,
    checkedAt: new Date(entry.checkedAt).toISOString(),
    validUntil: new Date(entry.validUntil).toISOString(),
    reasonCodes: sortedUnique(entry.reasonCodes)
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

function immutableClone(snapshot: TrustedCapabilitySnapshot): TrustedCapabilitySnapshot {
  return deepFreeze(structuredClone(snapshot));
}

/** Builds a canonical snapshot after every live value has passed the lock checks. */
export function buildTrustedCapabilitySnapshot(input: TrustedCapabilitySnapshotInput): TrustedCapabilitySnapshot {
  const requestedCaptureTime = capturedAt(input);
  const normalizedInput: TrustedCapabilitySnapshotInput = { ...input, capturedAt: requestedCaptureTime };
  const readiness = evaluateNewJobSnapshotReadiness(normalizedInput);
  if (readiness.status !== "READY") throwForReadiness(readiness);

  const locked = lockedOperations(normalizedInput);
  const capabilities = indexUnique(normalizedInput.catalog.capabilities, "DUPLICATE_CAPABILITY");
  const profiles = indexUnique(normalizedInput.semantics.profiles, "DUPLICATE_SEMANTIC_PROFILE");
  const availability = indexUnique(normalizedInput.availability.operations, "DUPLICATE_AVAILABILITY");
  const captureTime = new Date(Math.max(
    requestedCaptureTime.getTime(),
    ...locked.map((entry) => {
      const observed = availability.get(operationKey(entry));
      if (observed === undefined) {
        throw new TrustedCapabilitySnapshotError("AVAILABILITY_MISSING", operationKey(entry));
      }
      return toTimestamp(observed.checkedAt, "AVAILABILITY_TIME_INVALID", `${operationKey(entry)}.checkedAt`);
    })
  ));

  for (const entry of locked) {
    const key = operationKey(entry);
    assertCapabilityMatchesLock(entry, capabilities.get(key), profiles.get(key));
  }

  const body: TrustedCapabilitySnapshotBody = {
    capturedAt: captureTime.toISOString(),
    gatewayContractVersion: "0.6.3",
    contractCatalogRevision: normalizedInput.catalog.contractCatalogRevision,
    semanticCatalogHash: normalizedInput.semantics.catalogHash,
    bindingRevision: normalizedInput.catalog.bindingRevision,
    consumerPackageIntegrity: normalizedInput.southboundLock.consumerContractPackage.integrity,
    southboundLockHash: normalizedInput.southboundLockHash,
    capabilities: locked.map(snapshotCapability).sort(compareOperations),
    availability: locked
      .map((entry) => {
        const observed = availability.get(operationKey(entry));
        if (observed === undefined) throw new TrustedCapabilitySnapshotError("AVAILABILITY_MISSING", operationKey(entry));
        return snapshotAvailability(observed);
      })
      .sort(compareOperations)
  };
  return immutableClone({ ...body, snapshotHash: hashCanonicalJson(body) });
}

/**
 * Verifies persisted bytes without consulting current GOWM metadata. This is
 * deliberately freshness-neutral so recovery cannot silently replace an old
 * job's captured authority with a new catalog.
 */
export function verifyPersistedTrustedCapabilitySnapshot(snapshot: TrustedCapabilitySnapshot): TrustedCapabilitySnapshot {
  assertSha256(snapshot.snapshotHash, "snapshot.snapshotHash");
  const { snapshotHash, ...body } = snapshot;
  const expected = hashCanonicalJson(body);
  if (snapshotHash !== expected) {
    throw new TrustedCapabilitySnapshotError(
      "SNAPSHOT_INTEGRITY_MISMATCH",
      `Persisted snapshot hash ${snapshotHash} does not match ${expected}`
    );
  }
  return immutableClone(snapshot);
}
