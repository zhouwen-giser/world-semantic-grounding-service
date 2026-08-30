import { createHash } from "node:crypto";

export type JsonObject = Record<string, unknown>;
export type Sha256Digest = `sha256:${string}`;

export const WSGS_GROUNDING_CORE_OPERATION_KEYS = Object.freeze([
  "catalog.get@1.0",
  "catalog.search@1.0",
  "reference.get@1.0",
  "reference.resolve@1.0",
  "reference.validate@1.0",
  "result.validate@1.0",
  "spatial.find-in-area@1.0",
  "spatial.find-intersections@1.0",
  "spatial.find-nearby@1.0",
  "world.get-current-state@1.0",
  "world.get-geometry@1.0",
  "world.get-provenance@1.0",
] as const);

export const GDPS_V021_HANDOFF_FILES = Object.freeze([
  "GDPS_CAPABILITY_LOCK.json",
  "GDPS_CONSUMER_LOCK.json",
  "GDPS_PRODUCT_DESCRIPTOR_LOCK.json",
  "GDPS_RECIPE_LOCK.json",
  "GDPS_SAMPLE_DATASET_LOCK.json",
  "GOWM_GATEWAY_BINDING_LOCK.json",
  "WSGS_QUERY_CORPUS.json",
  "WSGS_TEST_BASELINE.json",
] as const);

export class LiveOperationLockProjectionError extends Error {
  constructor(readonly code: string) {
    super(`GDPS live operation-lock projection failed: ${code}`);
  }
}

export interface LiveOperationLockProjectionInput {
  catalog: unknown;
  semantics: unknown;
  availability: unknown;
  gatewayBindingLock: unknown;
  gdpsCapabilityLock: unknown;
  consumerLock: unknown;
  checksums: unknown;
  handoffFiles: Readonly<Record<string, Uint8Array>>;
  checksumsBytes: Uint8Array;
  contractBasis: unknown;
  sourceCommit: string;
  observedAt: string;
}

export interface OperationLockProjectionResult {
  operationLock: JsonObject;
  provenance: JsonObject;
  operationLockBytes: Uint8Array;
  provenanceBytes: Uint8Array;
  operationLockHash: Sha256Digest;
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const operationKeyPattern = /^[a-z][a-z0-9.-]{2,127}@[0-9]+\.[0-9]+$/u;

function fail(code: string): never {
  throw new LiveOperationLockProjectionError(code);
}

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as JsonObject;
}

function array(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) fail(code);
  return value;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}

function digest(value: unknown, code: string): Sha256Digest {
  const candidate = text(value, code);
  if (!digestPattern.test(candidate)) fail(code);
  return candidate as Sha256Digest;
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function parseJsonBytes(bytes: Uint8Array | undefined, code: string): unknown {
  if (bytes === undefined) fail(code);
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    return fail(code);
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as JsonObject;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail("NON_JSON_VALUE");
  return encoded;
}

export function sha256(value: Uint8Array | string): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalHash(value: unknown): Sha256Digest {
  return sha256(canonicalJson(value));
}

export function stableJsonBytes(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function operationKey(value: JsonObject): string {
  const key = `${text(value["operationId"], "OPERATION_ID_INVALID")}@${text(value["operationVersion"], "OPERATION_VERSION_INVALID")}`;
  if (!operationKeyPattern.test(key)) fail("OPERATION_KEY_INVALID");
  return key;
}

function uniqueIndex(
  values: unknown[],
  collection: string,
): Map<string, JsonObject> {
  const result = new Map<string, JsonObject>();
  for (const value of values) {
    const entry = object(value, `${collection}_ENTRY_INVALID`);
    const key = operationKey(entry);
    if (result.has(key)) fail(`${collection}_DUPLICATE_${key}`);
    result.set(key, entry);
  }
  return result;
}

export function requiredPermissionsForScopePolicy(
  scopePolicy: unknown,
): readonly string[] {
  switch (scopePolicy) {
    case "DATASET_SCOPE_REQUIRED":
      return ["dataset:read"];
    case "DATA_SCOPE_REQUIRED":
      return ["data:read"];
    case "IDENTITY_ONLY":
    case "REQUEST_CONTEXT":
      return ["gateway:execute"];
    default:
      return fail("SCOPE_POLICY_UNSUPPORTED");
  }
}

export function snapshotSupportForPolicy(
  snapshotPolicy: unknown,
): "NONE" | "BEST_EFFORT" | "CONSISTENT_AT_START" {
  const policy = object(snapshotPolicy, "SNAPSHOT_POLICY_INVALID");
  if (policy["computeSnapshot"] !== "REQUIRED")
    fail("COMPUTE_SNAPSHOT_POLICY_UNSUPPORTED");
  switch (policy["dataSnapshot"]) {
    case "NONE":
      return "NONE";
    case "OPTIONAL":
      return "BEST_EFFORT";
    case "REQUIRED":
      return "CONSISTENT_AT_START";
    default:
      return fail("DATA_SNAPSHOT_POLICY_UNSUPPORTED");
  }
}

function verifyHandoff(input: LiveOperationLockProjectionInput): {
  checksumFileHash: Sha256Digest;
  bundleHash: Sha256Digest;
  capabilityFileHash: Sha256Digest;
  capabilityCanonicalHash: Sha256Digest;
  consumerFileHash: Sha256Digest;
  gatewayBindingFileHash: Sha256Digest;
} {
  const checksums = object(input.checksums, "HANDOFF_CHECKSUMS_INVALID");
  if (
    !equal(
      parseJsonBytes(input.checksumsBytes, "HANDOFF_CHECKSUMS_BYTES_INVALID"),
      checksums,
    )
  ) {
    fail("HANDOFF_CHECKSUMS_BYTES_DRIFT");
  }
  if (
    checksums["schemaVersion"] !== "wsgs-gdps-v021-checksums/1.0" ||
    checksums["algorithm"] !== "SHA-256"
  ) {
    fail("HANDOFF_CHECKSUMS_CONTRACT_INVALID");
  }
  const entries = array(checksums["files"], "HANDOFF_CHECKSUM_ENTRIES_INVALID");
  const expectedNames: string[] = [...GDPS_V021_HANDOFF_FILES].sort();
  if (entries.length !== expectedNames.length)
    fail("HANDOFF_CHECKSUM_INVENTORY_INVALID");
  const expectedHashes: Record<string, Sha256Digest> = {};
  for (const raw of entries) {
    const entry = object(raw, "HANDOFF_CHECKSUM_ENTRY_INVALID");
    const path = text(entry["path"], "HANDOFF_CHECKSUM_PATH_INVALID");
    if (!expectedNames.includes(path) || expectedHashes[path] !== undefined)
      fail("HANDOFF_CHECKSUM_PATH_INVALID");
    const expected = digest(entry["sha256"], "HANDOFF_CHECKSUM_DIGEST_INVALID");
    const bytes = input.handoffFiles[path];
    if (bytes === undefined || sha256(bytes) !== expected)
      fail(`HANDOFF_FILE_DRIFT_${path}`);
    expectedHashes[path] = expected;
  }
  if (
    Object.keys(input.handoffFiles).sort().join("\n") !==
    expectedNames.join("\n")
  )
    fail("HANDOFF_FILE_SET_INVALID");
  const bundleHash = digest(
    checksums["bundleHash"],
    "HANDOFF_BUNDLE_HASH_INVALID",
  );
  if (canonicalHash(expectedHashes) !== bundleHash)
    fail("HANDOFF_BUNDLE_HASH_DRIFT");
  const capabilityBytes = input.handoffFiles["GDPS_CAPABILITY_LOCK.json"];
  if (capabilityBytes === undefined) fail("GDPS_CAPABILITY_FILE_MISSING");
  if (
    !equal(
      parseJsonBytes(capabilityBytes, "GDPS_CAPABILITY_FILE_INVALID"),
      input.gdpsCapabilityLock,
    ) ||
    !equal(
      parseJsonBytes(
        input.handoffFiles["GDPS_CONSUMER_LOCK.json"],
        "CONSUMER_LOCK_FILE_INVALID",
      ),
      input.consumerLock,
    ) ||
    !equal(
      parseJsonBytes(
        input.handoffFiles["GOWM_GATEWAY_BINDING_LOCK.json"],
        "GATEWAY_BINDING_FILE_INVALID",
      ),
      input.gatewayBindingLock,
    )
  ) {
    fail("HANDOFF_PARSED_CONTENT_DRIFT");
  }
  return {
    checksumFileHash: sha256(input.checksumsBytes),
    bundleHash,
    capabilityFileHash: sha256(capabilityBytes),
    capabilityCanonicalHash: canonicalHash(input.gdpsCapabilityLock),
    consumerFileHash: sha256(input.handoffFiles["GDPS_CONSUMER_LOCK.json"]!),
    gatewayBindingFileHash: sha256(
      input.handoffFiles["GOWM_GATEWAY_BINDING_LOCK.json"]!,
    ),
  };
}

function expectedGatewayBinding(input: LiveOperationLockProjectionInput): {
  contractCatalogRevision: Sha256Digest;
  semanticCatalogHash: Sha256Digest;
  bindingRevision: Sha256Digest;
  providerVersion: string;
  providerManifestHash: Sha256Digest;
} {
  const gatewayDocument = object(
    input.gatewayBindingLock,
    "GATEWAY_BINDING_LOCK_INVALID",
  );
  if (gatewayDocument["schemaVersion"] !== "gowm-gateway-binding-lock/1.0")
    fail("GATEWAY_BINDING_SCHEMA_INVALID");
  const gateway = object(gatewayDocument["gateway"], "GATEWAY_BINDING_MISSING");
  const consumer = object(input.consumerLock, "CONSUMER_LOCK_INVALID");
  const consumerGateway = object(
    consumer["gateway"],
    "CONSUMER_GATEWAY_BINDING_MISSING",
  );
  if (!equal(gateway, consumerGateway)) fail("CONSUMER_GATEWAY_BINDING_DRIFT");
  const provider = object(
    gatewayDocument["provider"],
    "GATEWAY_PROVIDER_BINDING_MISSING",
  );
  const consumerProvider = object(
    consumer["provider"],
    "CONSUMER_PROVIDER_BINDING_MISSING",
  );
  if (
    !equal(provider, consumerProvider) ||
    provider["providerId"] !== "gdps.geospatial-products"
  ) {
    fail("GDPS_PROVIDER_BINDING_DRIFT");
  }
  const providerVersion = text(
    provider["providerVersion"],
    "GDPS_PROVIDER_VERSION_INVALID",
  );
  if (providerVersion !== "0.2.1") fail("GDPS_PROVIDER_VERSION_INVALID");
  return {
    contractCatalogRevision: digest(
      gateway["contractCatalogRevision"],
      "GATEWAY_CONTRACT_REVISION_INVALID",
    ),
    semanticCatalogHash: digest(
      gateway["semanticCatalogHash"],
      "GATEWAY_SEMANTIC_REVISION_INVALID",
    ),
    bindingRevision: digest(
      gateway["bindingRevision"],
      "GATEWAY_BINDING_REVISION_INVALID",
    ),
    providerVersion,
    providerManifestHash: digest(
      provider["providerManifestHash"],
      "GDPS_PROVIDER_MANIFEST_HASH_INVALID",
    ),
  };
}

function projectOperation(
  key: string,
  expectedMaturity: "STABLE" | "PREVIEW",
  catalogByKey: ReadonlyMap<string, JsonObject>,
  semanticByKey: ReadonlyMap<string, JsonObject>,
  availabilityByKey: ReadonlyMap<string, JsonObject>,
  revisions: ReturnType<typeof expectedGatewayBinding>,
  observedAt: number,
  locked?: JsonObject,
): JsonObject {
  const descriptor = catalogByKey.get(key);
  const semantic = semanticByKey.get(key);
  const availability = availabilityByKey.get(key);
  if (!descriptor || !semantic || !availability)
    fail(`LIVE_OPERATION_MISSING_${key}`);
  const maturity = text(descriptor["maturity"], `LIVE_MATURITY_INVALID_${key}`);
  if (
    maturity !== expectedMaturity ||
    availability["maturity"] !== expectedMaturity
  )
    fail(`LIVE_MATURITY_DRIFT_${key}`);
  const inputSchemaHash = digest(
    descriptor["inputSchemaHash"],
    `LIVE_INPUT_HASH_INVALID_${key}`,
  );
  const outputSchemaHash = digest(
    descriptor["outputSchemaHash"],
    `LIVE_OUTPUT_HASH_INVALID_${key}`,
  );
  const semanticProfileHash = digest(
    semantic["semanticProfileHash"],
    `LIVE_SEMANTIC_HASH_INVALID_${key}`,
  );
  if (canonicalHash(semantic["semanticProfile"]) !== semanticProfileHash)
    fail(`LIVE_SEMANTIC_HASH_DRIFT_${key}`);
  if (locked) {
    for (const [field, actual] of Object.entries({
      inputSchemaHash,
      outputSchemaHash,
      semanticProfileHash,
      maturity,
    })) {
      if (locked[field] !== actual)
        fail(`GDPS_CAPABILITY_DRIFT_${key}_${field}`);
    }
  }
  if (availability["availability"] !== "AVAILABLE")
    fail(`LIVE_OPERATION_UNAVAILABLE_${key}`);
  if (
    availability["contractCatalogRevision"] !==
      revisions.contractCatalogRevision ||
    availability["bindingRevision"] !== revisions.bindingRevision
  )
    fail(`LIVE_AVAILABILITY_REVISION_DRIFT_${key}`);
  const checkedAt = Date.parse(
    text(availability["checkedAt"], `LIVE_AVAILABILITY_TIME_INVALID_${key}`),
  );
  const validUntil = Date.parse(
    text(availability["validUntil"], `LIVE_AVAILABILITY_TIME_INVALID_${key}`),
  );
  if (
    !Number.isFinite(checkedAt) ||
    !Number.isFinite(validUntil) ||
    checkedAt > observedAt ||
    validUntil < observedAt ||
    validUntil < checkedAt
  )
    fail(`LIVE_AVAILABILITY_EXPIRED_${key}`);
  return {
    operationId: text(descriptor["operationId"], "OPERATION_ID_INVALID"),
    operationVersion: text(
      descriptor["operationVersion"],
      "OPERATION_VERSION_INVALID",
    ),
    inputSchemaHash,
    outputSchemaHash,
    semanticProfileHash,
    maturity,
    requiredPermissions: [
      ...requiredPermissionsForScopePolicy(descriptor["scopePolicy"]),
    ],
    snapshotSupport: snapshotSupportForPolicy(descriptor["snapshotPolicy"]),
  };
}

export function projectLiveGdpsOperationLock(
  input: LiveOperationLockProjectionInput,
): OperationLockProjectionResult {
  if (!commitPattern.test(input.sourceCommit)) fail("SOURCE_COMMIT_INVALID");
  const observedAt = Date.parse(input.observedAt);
  if (!Number.isFinite(observedAt)) fail("OBSERVED_AT_INVALID");

  const handoff = verifyHandoff(input);
  const revisions = expectedGatewayBinding(input);
  const consumer = object(input.consumerLock, "CONSUMER_LOCK_INVALID");
  const consumerSources = object(
    consumer["sources"],
    "CONSUMER_SOURCES_INVALID",
  );
  if (consumerSources["wsgsSha"] !== input.sourceCommit)
    fail("SOURCE_COMMIT_DRIFT");
  if (consumer["capabilityLockHash"] !== handoff.capabilityCanonicalHash)
    fail("CONSUMER_CAPABILITY_HASH_DRIFT");

  const capabilityLock = object(
    input.gdpsCapabilityLock,
    "GDPS_CAPABILITY_LOCK_INVALID",
  );
  if (
    capabilityLock["schemaVersion"] !== "gdps-v021-capability-lock/1.0" ||
    capabilityLock["providerId"] !== "gdps.geospatial-products" ||
    capabilityLock["providerManifestHash"] !== revisions.providerManifestHash
  ) {
    fail("GDPS_CAPABILITY_LOCK_CONTRACT_INVALID");
  }
  const gdpsOperations = array(
    capabilityLock["operations"],
    "GDPS_CAPABILITY_OPERATIONS_INVALID",
  );
  if (gdpsOperations.length !== 30) fail("GDPS_CAPABILITY_COUNT_INVALID");
  const gdpsByKey = uniqueIndex(gdpsOperations, "GDPS_CAPABILITY");
  for (const [key, operation] of gdpsByKey) {
    if (
      operation["maturity"] !== "PREVIEW" ||
      operation["availability"] !== "AVAILABLE"
    )
      fail(`GDPS_CAPABILITY_NOT_READY_${key}`);
    digest(operation["inputSchemaHash"], `GDPS_INPUT_HASH_INVALID_${key}`);
    digest(operation["outputSchemaHash"], `GDPS_OUTPUT_HASH_INVALID_${key}`);
    digest(
      operation["semanticProfileHash"],
      `GDPS_SEMANTIC_HASH_INVALID_${key}`,
    );
  }

  const catalog = object(input.catalog, "LIVE_CATALOG_INVALID");
  const semantics = object(input.semantics, "LIVE_SEMANTICS_INVALID");
  const availability = object(input.availability, "LIVE_AVAILABILITY_INVALID");
  if (
    semantics["schemaVersion"] !== "1.1" ||
    availability["schemaVersion"] !== "1.0"
  ) {
    fail("LIVE_DISCOVERY_SCHEMA_VERSION_INVALID");
  }
  if (
    catalog["contractCatalogRevision"] !== revisions.contractCatalogRevision ||
    semantics["contractCatalogRevision"] !==
      revisions.contractCatalogRevision ||
    semantics["catalogHash"] !== revisions.semanticCatalogHash ||
    catalog["bindingRevision"] !== revisions.bindingRevision ||
    semantics["bindingRevision"] !== revisions.bindingRevision
  )
    fail("LIVE_GATEWAY_REVISION_DRIFT");
  const registryRevision = digest(
    catalog["registryRevision"],
    "LIVE_REGISTRY_REVISION_INVALID",
  );
  if (catalog["registryVersion"] !== registryRevision)
    fail("LIVE_REGISTRY_VERSION_DRIFT");
  if (semantics["registryRevision"] !== revisions.contractCatalogRevision)
    fail("LIVE_SEMANTIC_REGISTRY_REVISION_DRIFT");
  const availabilityCheckedAt = Date.parse(
    text(availability["checkedAt"], "LIVE_AVAILABILITY_LIST_TIME_INVALID"),
  );
  if (
    !Number.isFinite(availabilityCheckedAt) ||
    availabilityCheckedAt > observedAt
  ) {
    fail("LIVE_AVAILABILITY_LIST_TIME_INVALID");
  }
  const catalogEntries = array(
    catalog["capabilities"],
    "LIVE_CATALOG_ENTRIES_INVALID",
  );
  const semanticEntries = array(
    semantics["profiles"],
    "LIVE_SEMANTIC_PROFILES_INVALID",
  );
  const availabilityEntries = array(
    availability["operations"],
    "LIVE_AVAILABILITY_ENTRIES_INVALID",
  );
  const catalogByKey = uniqueIndex(catalogEntries, "LIVE_CATALOG");
  const semanticByKey = uniqueIndex(semanticEntries, "LIVE_SEMANTICS");
  const availabilityByKey = uniqueIndex(
    availabilityEntries,
    "LIVE_AVAILABILITY",
  );
  for (const [key, entry] of semanticByKey) {
    const semanticProfileHash = digest(
      entry["semanticProfileHash"],
      `LIVE_SEMANTIC_HASH_INVALID_${key}`,
    );
    if (canonicalHash(entry["semanticProfile"]) !== semanticProfileHash)
      fail(`LIVE_SEMANTIC_HASH_DRIFT_${key}`);
  }
  const sortedSemanticEntries = [...semanticEntries].sort((left, right) =>
    operationKey(object(left, "LIVE_SEMANTIC_ENTRY_INVALID")).localeCompare(
      operationKey(object(right, "LIVE_SEMANTIC_ENTRY_INVALID")),
    ),
  );
  if (canonicalHash(sortedSemanticEntries) !== revisions.semanticCatalogHash)
    fail("LIVE_SEMANTIC_CATALOG_HASH_DRIFT");

  const stableKeys = [...WSGS_GROUNDING_CORE_OPERATION_KEYS];
  const gdpsKeys = [...gdpsByKey.keys()].sort();
  const selectedKeys = [...stableKeys, ...gdpsKeys];
  if (new Set(selectedKeys).size !== 42) fail("SELECTED_OPERATION_SET_OVERLAP");
  const defaultOperations = stableKeys.map((key) =>
    projectOperation(
      key,
      "STABLE",
      catalogByKey,
      semanticByKey,
      availabilityByKey,
      revisions,
      observedAt,
    ),
  );
  const previewOperations = gdpsKeys.map((key) =>
    projectOperation(
      key,
      "PREVIEW",
      catalogByKey,
      semanticByKey,
      availabilityByKey,
      revisions,
      observedAt,
      gdpsByKey.get(key),
    ),
  );

  const basis = object(input.contractBasis, "CONTRACT_BASIS_INVALID");
  if (
    basis["schemaVersion"] !== "2.0" ||
    basis["gatewayContractVersion"] !== "0.6.3"
  )
    fail("CONTRACT_BASIS_VERSION_INVALID");
  const consumerContractPackage = object(
    basis["consumerContractPackage"],
    "CONSUMER_CONTRACT_PACKAGE_INVALID",
  );
  if (
    consumerContractPackage["name"] !== "@gowm/world-gateway-contracts" ||
    consumerContractPackage["version"] !== "0.6.3" ||
    typeof consumerContractPackage["integrity"] !== "string" ||
    !/^sha512-[A-Za-z0-9+/=]+$/u.test(consumerContractPackage["integrity"]) ||
    Object.keys(consumerContractPackage).sort().join(",") !==
      "integrity,name,version"
  )
    fail("CONSUMER_CONTRACT_PACKAGE_INVALID");
  const operationLock: JsonObject = {
    schemaVersion: "2.0",
    gatewayContractVersion: "0.6.3",
    consumerContractPackage: structuredClone(consumerContractPackage),
    contractCatalogRevision: revisions.contractCatalogRevision,
    semanticCatalogHash: revisions.semanticCatalogHash,
    availabilityContractHash: digest(
      basis["availabilityContractHash"],
      "AVAILABILITY_CONTRACT_HASH_INVALID",
    ),
    snapshotContractHash: digest(
      basis["snapshotContractHash"],
      "SNAPSHOT_CONTRACT_HASH_INVALID",
    ),
    delegationContractHash: digest(
      basis["delegationContractHash"],
      "DELEGATION_CONTRACT_HASH_INVALID",
    ),
    defaultOperations,
    previewOperations,
  };
  const operationLockBytes = stableJsonBytes(operationLock);
  const operationLockHash = sha256(operationLockBytes);

  const selectedCatalogProjection = selectedKeys.map((key) => {
    const descriptor = catalogByKey.get(key)!;
    return {
      operationId: descriptor["operationId"],
      operationVersion: descriptor["operationVersion"],
      inputSchemaHash: descriptor["inputSchemaHash"],
      outputSchemaHash: descriptor["outputSchemaHash"],
      maturity: descriptor["maturity"],
      scopePolicy: descriptor["scopePolicy"],
      snapshotPolicy: descriptor["snapshotPolicy"],
    };
  });
  const selectedAvailabilityProjection = selectedKeys.map((key) => {
    const entry = availabilityByKey.get(key)!;
    return {
      operationId: entry["operationId"],
      operationVersion: entry["operationVersion"],
      maturity: entry["maturity"],
      availability: entry["availability"],
      contractCatalogRevision: entry["contractCatalogRevision"],
      bindingRevision: entry["bindingRevision"],
    };
  });
  const provenance: JsonObject = {
    schemaVersion: "wsgs-gdps-live-operation-lock-provenance/1.0",
    sourceCommit: input.sourceCommit,
    provider: {
      providerId: "gdps.geospatial-products",
      providerVersion: revisions.providerVersion,
      providerManifestHash: revisions.providerManifestHash,
    },
    handoff: {
      checksumFileHash: handoff.checksumFileHash,
      bundleHash: handoff.bundleHash,
      capabilityFileHash: handoff.capabilityFileHash,
      capabilityCanonicalHash: handoff.capabilityCanonicalHash,
      consumerFileHash: handoff.consumerFileHash,
      gatewayBindingFileHash: handoff.gatewayBindingFileHash,
      contractBasisCanonicalHash: canonicalHash(basis),
    },
    gateway: {
      registryRevision,
      contractCatalogRevision: revisions.contractCatalogRevision,
      semanticCatalogHash: revisions.semanticCatalogHash,
      bindingRevision: revisions.bindingRevision,
    },
    liveEvidence: {
      selectedOperationCount: 42,
      availableOperationCount: 42,
      catalogProjectionHash: canonicalHash(selectedCatalogProjection),
      semanticCatalogHash: revisions.semanticCatalogHash,
      availabilityProjectionHash: canonicalHash(selectedAvailabilityProjection),
    },
    operationLockHash,
  };
  const provenanceBytes = stableJsonBytes(provenance);
  return {
    operationLock,
    provenance,
    operationLockBytes,
    provenanceBytes,
    operationLockHash,
  };
}
