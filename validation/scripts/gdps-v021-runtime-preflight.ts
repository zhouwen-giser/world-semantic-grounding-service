import { readFileSync, realpathSync, statSync } from "node:fs";
import {
  basename,
  isAbsolute,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  GDPS_V021_HANDOFF_FILES,
  WSGS_GROUNDING_CORE_OPERATION_KEYS,
  canonicalHash,
  canonicalJson,
  sha256,
  type JsonObject,
  type Sha256Digest,
} from "./live-gdps-operation-lock-projector.js";

export const GDPS_V021_DRIVER_BINDINGS = Object.freeze([
  {
    caseId: "NEG-DATA-GAP",
    driverKind: "CURRENT_PRODUCT_ABSENT",
  },
  {
    caseId: "NEG-RECIPE-DRIFT",
    driverKind: "RECIPE_SEMANTIC_HASH_ALTERED",
  },
  {
    caseId: "NEG-TRUNCATED",
    driverKind: "UPSTREAM_TRUNCATED_TRUE",
  },
  {
    caseId: "NEG-CURRENTNESS",
    driverKind: "STORED_HASH_DIFFERS_FROM_CURRENT",
  },
] as const);

export type GdpsV021DriverCaseId =
  (typeof GDPS_V021_DRIVER_BINDINGS)[number]["caseId"];
export type GdpsV021DriverKind =
  (typeof GDPS_V021_DRIVER_BINDINGS)[number]["driverKind"];

export interface VerifiedGdpsV021DriverAttestation {
  readonly schemaVersion: "wsgs-gdps-e2e-driver-attestation/2.0";
  readonly caseId: GdpsV021DriverCaseId;
  readonly driverKind: GdpsV021DriverKind;
  readonly sourceCommit: string;
  readonly handoffBundleHash: Sha256Digest;
  readonly operationLockHash: Sha256Digest;
  readonly provenanceHash: Sha256Digest;
  readonly runtimeIdentityHash: Sha256Digest;
  readonly sharedRuntimeBeforeHash: Sha256Digest;
  readonly sharedRuntimeAfterHash: Sha256Digest;
  readonly executionEnvironment: "ISOLATED_REAL_RUNTIME";
  readonly requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY";
  readonly realExternalDependencies: true;
  readonly mockTransportUsed: false;
  readonly sharedRuntimeMutated: false;
  readonly precondition: JsonObject;
  readonly preconditionHash: Sha256Digest;
  readonly driverImplementationHash: Sha256Digest;
  readonly evidenceHash: Sha256Digest;
}

export interface GdpsV021RuntimePreflightPaths {
  readonly repositoryRoot: string;
  readonly operationLockPath: string;
  readonly handoffDirectory: string;
  readonly driverManifestPath: string;
  readonly expectedSourceCommit: string;
}

export type GdpsV021RuntimeAuthorityPreflightPaths = Omit<
  GdpsV021RuntimePreflightPaths,
  "driverManifestPath"
>;

export interface VerifiedGdpsV021DriverRecord {
  readonly caseId: GdpsV021DriverCaseId;
  readonly driverKind: GdpsV021DriverKind;
  /** Parsed only after the exact attestation bytes and every binding were verified. */
  readonly attestation: VerifiedGdpsV021DriverAttestation;
  readonly attestationPath: string;
  readonly attestationHash: Sha256Digest;
  readonly attestationByteLength: number;
  readonly implementationPath: string;
  readonly implementationHash: Sha256Digest;
  readonly implementationByteLength: number;
  readonly evidencePath: string;
  readonly evidenceHash: Sha256Digest;
  readonly evidenceByteLength: number;
  readonly precondition: JsonObject;
  readonly preconditionHash: Sha256Digest;
  readonly runtimeIdentityHash: Sha256Digest;
  readonly sharedRuntimeBeforeHash: Sha256Digest;
  readonly sharedRuntimeAfterHash: Sha256Digest;
}

export interface VerifiedGdpsV021RuntimePreflight {
  readonly schemaVersion: "wsgs-gdps-v021-runtime-preflight/1.0";
  readonly sourceCommit: string;
  readonly gdpsCommit: string;
  readonly gowmCommit: string;
  readonly provider: {
    readonly providerId: "gdps.geospatial-products";
    readonly providerVersion: "0.2.1";
    readonly providerManifestHash: Sha256Digest;
    readonly capabilityCount: 30;
  };
  readonly operationLock: {
    readonly path: string;
    readonly hash: Sha256Digest;
    readonly provenancePath: string;
    readonly provenanceHash: Sha256Digest;
    readonly stableOperationKeys: readonly string[];
    readonly previewOperationKeys: readonly string[];
    readonly contractCatalogRevision: Sha256Digest;
    readonly semanticCatalogHash: Sha256Digest;
    readonly bindingRevision: Sha256Digest;
  };
  readonly handoff: {
    readonly directory: string;
    readonly checksumsHash: Sha256Digest;
    readonly bundleHash: Sha256Digest;
    readonly fileHashes: Readonly<Record<string, Sha256Digest>>;
  };
  readonly driverManifest: {
    readonly path: string;
    readonly hash: Sha256Digest;
    readonly runtimeIdentityHash: Sha256Digest;
    readonly drivers: readonly VerifiedGdpsV021DriverRecord[];
  };
}

export type VerifiedGdpsV021RuntimeAuthorityPreflight = Omit<
  VerifiedGdpsV021RuntimePreflight,
  "driverManifest"
>;

export class GdpsV021RuntimePreflightError extends Error {
  constructor(readonly code: string) {
    super(`GDPS v0.2.1 runtime preflight failed: ${code}`);
  }
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const operationKeyPattern =
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+@[0-9]+\.[0-9]+$/u;
const operationLockFilename = "wsgs-southbound-operation-lock-v2.json";
const operationLockProvenanceFilename =
  "wsgs-southbound-operation-lock-v2.provenance.json";
const legacyArtifactRoots = Object.freeze([
  "reports/wsgs-v0.1",
  "reports/wsgs-v0.2",
  "reports/wsgs-v0.2-gdps",
]);

function fail(code: string): never {
  throw new GdpsV021RuntimePreflightError(code);
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

function commit(value: unknown, code: string): string {
  const candidate = text(value, code);
  if (!commitPattern.test(candidate)) fail(code);
  return candidate;
}

function exactKeys(
  value: JsonObject,
  expected: readonly string[],
  code: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((entry, index) => entry !== sortedExpected[index])
  ) {
    fail(code);
  }
}

function exactStrings(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index])
  );
}

function parseJson(bytes: Uint8Array, code: string): JsonObject {
  try {
    return object(JSON.parse(Buffer.from(bytes).toString("utf8")), code);
  } catch (error) {
    if (error instanceof GdpsV021RuntimePreflightError) throw error;
    return fail(code);
  }
}

function inside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  );
}

function existingPathWithinRoot(
  root: string,
  input: string,
  expectedType: "file" | "directory",
  code: string,
): string {
  let candidate: string;
  let realCandidate: string;
  try {
    candidate = resolve(root, input);
    if (!inside(root, candidate)) fail(`${code}_ESCAPES_REPOSITORY`);
    realCandidate = realpathSync(candidate);
  } catch (error) {
    if (error instanceof GdpsV021RuntimePreflightError) throw error;
    return fail(`${code}_MISSING`);
  }
  if (!inside(root, realCandidate)) fail(`${code}_REALPATH_ESCAPES_REPOSITORY`);
  const stats = statSync(realCandidate);
  if (
    (expectedType === "file" && !stats.isFile()) ||
    (expectedType === "directory" && !stats.isDirectory())
  ) {
    fail(`${code}_TYPE_INVALID`);
  }
  return realCandidate;
}

function repositoryRelativeArtifact(
  repositoryRoot: string,
  value: unknown,
  code: string,
): { logicalPath: string; realPath: string; bytes: Uint8Array } {
  const logicalPath = text(value, `${code}_PATH_INVALID`);
  if (
    logicalPath.includes("\\") ||
    logicalPath.startsWith("/") ||
    /^[A-Za-z]:/u.test(logicalPath) ||
    posix.normalize(logicalPath) !== logicalPath ||
    logicalPath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    fail(`${code}_PATH_NOT_REPOSITORY_RELATIVE`);
  }
  if (
    legacyArtifactRoots.some(
      (root) => logicalPath === root || logicalPath.startsWith(`${root}/`),
    )
  ) {
    fail(`${code}_PATH_IN_LEGACY_REPORT`);
  }
  const realPath = existingPathWithinRoot(
    repositoryRoot,
    logicalPath,
    "file",
    `${code}_ARTIFACT`,
  );
  return { logicalPath, realPath, bytes: readFileSync(realPath) };
}

function operationKey(value: JsonObject, code: string): string {
  const key = `${text(value["operationId"], `${code}_ID_INVALID`)}@${text(
    value["operationVersion"],
    `${code}_VERSION_INVALID`,
  )}`;
  if (!operationKeyPattern.test(key)) fail(`${code}_KEY_INVALID`);
  return key;
}

function uniqueOperationIndex(
  entries: unknown[],
  code: string,
): Map<string, JsonObject> {
  const result = new Map<string, JsonObject>();
  for (const entry of entries) {
    const operation = object(entry, `${code}_ENTRY_INVALID`);
    const key = operationKey(operation, code);
    if (result.has(key)) fail(`${code}_DUPLICATE_OPERATION`);
    result.set(key, operation);
  }
  return result;
}

function validateProjectedOperation(
  operation: JsonObject,
  expectedMaturity: "STABLE" | "PREVIEW",
  code: string,
): void {
  if (operation["maturity"] !== expectedMaturity) {
    fail(`${code}_MATURITY_DRIFT`);
  }
  digest(operation["inputSchemaHash"], `${code}_INPUT_HASH_INVALID`);
  digest(operation["outputSchemaHash"], `${code}_OUTPUT_HASH_INVALID`);
  digest(operation["semanticProfileHash"], `${code}_SEMANTIC_HASH_INVALID`);
  const requiredPermissions = array(
    operation["requiredPermissions"],
    `${code}_PERMISSIONS_INVALID`,
  );
  if (
    requiredPermissions.length === 0 ||
    !requiredPermissions.every(
      (entry) =>
        typeof entry === "string" && /^[a-z][a-z0-9._:-]*$/u.test(entry),
    ) ||
    new Set(requiredPermissions).size !== requiredPermissions.length
  ) {
    fail(`${code}_PERMISSIONS_INVALID`);
  }
  if (
    !["NONE", "BEST_EFFORT", "CONSISTENT_AT_START", "PINNED"].includes(
      String(operation["snapshotSupport"]),
    )
  ) {
    fail(`${code}_SNAPSHOT_SUPPORT_INVALID`);
  }
}

interface VerifiedHandoff {
  readonly checksumsHash: Sha256Digest;
  readonly bundleHash: Sha256Digest;
  readonly fileHashes: Readonly<Record<string, Sha256Digest>>;
  readonly documents: Readonly<Record<string, JsonObject>>;
  readonly fileBytes: Readonly<Record<string, Uint8Array>>;
}

function verifyHandoff(directory: string): VerifiedHandoff {
  const fileBytes: Record<string, Uint8Array> = {};
  const documents: Record<string, JsonObject> = {};
  for (const name of GDPS_V021_HANDOFF_FILES) {
    const path = existingPathWithinRoot(directory, name, "file", `HANDOFF_${name}`);
    const bytes = readFileSync(path);
    fileBytes[name] = bytes;
    documents[name] = parseJson(bytes, `HANDOFF_${name}_JSON_INVALID`);
  }
  const checksumsPath = existingPathWithinRoot(
    directory,
    "CHECKSUMS.json",
    "file",
    "HANDOFF_CHECKSUMS",
  );
  const checksumsBytes = readFileSync(checksumsPath);
  const checksums = parseJson(checksumsBytes, "HANDOFF_CHECKSUMS_JSON_INVALID");
  exactKeys(
    checksums,
    ["schemaVersion", "algorithm", "files", "bundleHash"],
    "HANDOFF_CHECKSUMS_FIELDS_INVALID",
  );
  if (
    checksums["schemaVersion"] !== "wsgs-gdps-v021-checksums/1.0" ||
    checksums["algorithm"] !== "SHA-256"
  ) {
    fail("HANDOFF_CHECKSUMS_CONTRACT_INVALID");
  }
  const entries = array(checksums["files"], "HANDOFF_CHECKSUM_ENTRIES_INVALID");
  if (entries.length !== GDPS_V021_HANDOFF_FILES.length) {
    fail("HANDOFF_CHECKSUM_INVENTORY_INVALID");
  }
  const expectedNames: string[] = [...GDPS_V021_HANDOFF_FILES].sort();
  const fileHashes: Record<string, Sha256Digest> = {};
  for (const entry of entries) {
    const item = object(entry, "HANDOFF_CHECKSUM_ENTRY_INVALID");
    exactKeys(item, ["path", "sha256"], "HANDOFF_CHECKSUM_ENTRY_FIELDS_INVALID");
    const name = text(item["path"], "HANDOFF_CHECKSUM_PATH_INVALID");
    if (!expectedNames.includes(name) || fileHashes[name] !== undefined) {
      fail("HANDOFF_CHECKSUM_PATH_INVALID");
    }
    const expectedHash = digest(item["sha256"], "HANDOFF_CHECKSUM_HASH_INVALID");
    if (sha256(fileBytes[name]!) !== expectedHash) {
      fail(`HANDOFF_FILE_HASH_DRIFT_${name}`);
    }
    fileHashes[name] = expectedHash;
  }
  if (!exactStrings(Object.keys(fileHashes).sort(), expectedNames)) {
    fail("HANDOFF_CHECKSUM_INVENTORY_INVALID");
  }
  const bundleHash = digest(
    checksums["bundleHash"],
    "HANDOFF_BUNDLE_HASH_INVALID",
  );
  if (canonicalHash(fileHashes) !== bundleHash) {
    fail("HANDOFF_BUNDLE_HASH_DRIFT");
  }
  return {
    checksumsHash: sha256(checksumsBytes),
    bundleHash,
    fileHashes: Object.freeze({ ...fileHashes }),
    documents: Object.freeze({ ...documents }),
    fileBytes: Object.freeze({ ...fileBytes }),
  };
}

interface VerifiedLockBinding {
  readonly sourceCommit: string;
  readonly gdpsCommit: string;
  readonly gowmCommit: string;
  readonly providerManifestHash: Sha256Digest;
  readonly operationLockHash: Sha256Digest;
  readonly provenanceHash: Sha256Digest;
  readonly stableOperationKeys: readonly string[];
  readonly previewOperationKeys: readonly string[];
  readonly contractCatalogRevision: Sha256Digest;
  readonly semanticCatalogHash: Sha256Digest;
  readonly bindingRevision: Sha256Digest;
}

function verifyLockBinding(
  operationLockBytes: Uint8Array,
  provenanceBytes: Uint8Array,
  handoff: VerifiedHandoff,
  expectedSourceCommit: string,
): VerifiedLockBinding {
  const operationLock = parseJson(operationLockBytes, "OPERATION_LOCK_JSON_INVALID");
  const provenance = parseJson(provenanceBytes, "OPERATION_LOCK_PROVENANCE_JSON_INVALID");
  const operationLockHash = sha256(operationLockBytes);
  const provenanceHash = sha256(provenanceBytes);
  if (
    provenance["schemaVersion"] !==
      "wsgs-gdps-live-operation-lock-provenance/1.0"
  ) {
    fail("OPERATION_LOCK_PROVENANCE_SCHEMA_INVALID");
  }
  if (provenance["sourceCommit"] !== expectedSourceCommit) {
    fail("OPERATION_LOCK_PROVENANCE_SOURCE_DRIFT");
  }
  if (provenance["operationLockHash"] !== operationLockHash) {
    fail("OPERATION_LOCK_PROVENANCE_HASH_DRIFT");
  }

  const provenanceProvider = object(
    provenance["provider"],
    "OPERATION_LOCK_PROVENANCE_PROVIDER_INVALID",
  );
  if (
    provenanceProvider["providerId"] !== "gdps.geospatial-products" ||
    provenanceProvider["providerVersion"] !== "0.2.1"
  ) {
    fail("OPERATION_LOCK_PROVENANCE_PROVIDER_DRIFT");
  }
  const providerManifestHash = digest(
    provenanceProvider["providerManifestHash"],
    "OPERATION_LOCK_PROVENANCE_PROVIDER_HASH_INVALID",
  );
  const provenanceHandoff = object(
    provenance["handoff"],
    "OPERATION_LOCK_PROVENANCE_HANDOFF_INVALID",
  );
  const expectedProvenanceHandoff: Readonly<Record<string, Sha256Digest>> = {
    checksumFileHash: handoff.checksumsHash,
    bundleHash: handoff.bundleHash,
    capabilityFileHash: handoff.fileHashes["GDPS_CAPABILITY_LOCK.json"]!,
    capabilityCanonicalHash: canonicalHash(
      handoff.documents["GDPS_CAPABILITY_LOCK.json"],
    ),
    consumerFileHash: handoff.fileHashes["GDPS_CONSUMER_LOCK.json"]!,
    gatewayBindingFileHash:
      handoff.fileHashes["GOWM_GATEWAY_BINDING_LOCK.json"]!,
  };
  for (const [field, expected] of Object.entries(expectedProvenanceHandoff)) {
    if (provenanceHandoff[field] !== expected) {
      fail(`OPERATION_LOCK_PROVENANCE_HANDOFF_DRIFT_${field}`);
    }
  }
  digest(
    provenanceHandoff["contractBasisCanonicalHash"],
    "OPERATION_LOCK_PROVENANCE_CONTRACT_BASIS_HASH_INVALID",
  );

  const liveEvidence = object(
    provenance["liveEvidence"],
    "OPERATION_LOCK_PROVENANCE_LIVE_EVIDENCE_INVALID",
  );
  if (
    liveEvidence["selectedOperationCount"] !== 42 ||
    liveEvidence["availableOperationCount"] !== 42
  ) {
    fail("OPERATION_LOCK_PROVENANCE_OPERATION_COUNT_DRIFT");
  }
  digest(
    liveEvidence["catalogProjectionHash"],
    "OPERATION_LOCK_PROVENANCE_catalogProjectionHash_INVALID",
  );
  const liveSemanticCatalogHash = digest(
    liveEvidence["semanticCatalogHash"],
    "OPERATION_LOCK_PROVENANCE_semanticCatalogHash_INVALID",
  );
  digest(
    liveEvidence["availabilityProjectionHash"],
    "OPERATION_LOCK_PROVENANCE_availabilityProjectionHash_INVALID",
  );

  const consumerContractPackage = object(
    operationLock["consumerContractPackage"],
    "OPERATION_LOCK_CONSUMER_PACKAGE_INVALID",
  );
  if (
    operationLock["schemaVersion"] !== "2.0" ||
    operationLock["gatewayContractVersion"] !== "0.6.3" ||
    consumerContractPackage["name"] !== "@gowm/world-gateway-contracts" ||
    consumerContractPackage["version"] !== "0.6.3"
  ) {
    fail("OPERATION_LOCK_SCHEMA_INVALID");
  }
  const defaultOperations = array(
    operationLock["defaultOperations"],
    "OPERATION_LOCK_STABLE_OPERATIONS_INVALID",
  );
  const previewOperations = array(
    operationLock["previewOperations"],
    "OPERATION_LOCK_PREVIEW_OPERATIONS_INVALID",
  );
  if (defaultOperations.length !== 12 || previewOperations.length !== 30) {
    fail("OPERATION_LOCK_OPERATION_COUNT_DRIFT");
  }
  const defaultByKey = uniqueOperationIndex(
    defaultOperations,
    "OPERATION_LOCK_STABLE",
  );
  const previewByKey = uniqueOperationIndex(
    previewOperations,
    "OPERATION_LOCK_PREVIEW",
  );
  if (
    [...defaultByKey.keys()].some((key) => previewByKey.has(key)) ||
    defaultByKey.size + previewByKey.size !== 42
  ) {
    fail("OPERATION_LOCK_OPERATION_SET_INVALID");
  }
  const stableOperationKeys = [...defaultByKey.keys()];
  if (!exactStrings(stableOperationKeys, WSGS_GROUNDING_CORE_OPERATION_KEYS)) {
    fail("OPERATION_LOCK_STABLE_OPERATION_SET_DRIFT");
  }
  for (const [key, operation] of defaultByKey) {
    validateProjectedOperation(operation, "STABLE", `OPERATION_LOCK_${key}`);
  }
  for (const [key, operation] of previewByKey) {
    validateProjectedOperation(operation, "PREVIEW", `OPERATION_LOCK_${key}`);
  }

  const capabilityLock = handoff.documents["GDPS_CAPABILITY_LOCK.json"]!;
  if (
    capabilityLock["schemaVersion"] !== "gdps-v021-capability-lock/1.0" ||
    capabilityLock["providerId"] !== "gdps.geospatial-products" ||
    capabilityLock["providerManifestHash"] !== providerManifestHash
  ) {
    fail("HANDOFF_CAPABILITY_LOCK_IDENTITY_DRIFT");
  }
  const capabilityOperations = array(
    capabilityLock["operations"],
    "HANDOFF_CAPABILITY_OPERATIONS_INVALID",
  );
  if (capabilityOperations.length !== 30) {
    fail("HANDOFF_CAPABILITY_OPERATION_COUNT_DRIFT");
  }
  const capabilityByKey = uniqueOperationIndex(
    capabilityOperations,
    "HANDOFF_CAPABILITY",
  );
  const previewOperationKeys = [...previewByKey.keys()];
  if (
    !exactStrings(previewOperationKeys, [...capabilityByKey.keys()].sort())
  ) {
    fail("OPERATION_LOCK_PREVIEW_OPERATION_SET_DRIFT");
  }
  for (const [key, capability] of capabilityByKey) {
    const projected = previewByKey.get(key);
    if (!projected) fail("OPERATION_LOCK_PREVIEW_OPERATION_SET_DRIFT");
    if (
      capability["maturity"] !== "PREVIEW" ||
      capability["availability"] !== "AVAILABLE"
    ) {
      fail(`HANDOFF_CAPABILITY_NOT_AVAILABLE_${key}`);
    }
    for (const field of [
      "inputSchemaHash",
      "outputSchemaHash",
      "semanticProfileHash",
      "maturity",
    ]) {
      if (projected[field] !== capability[field]) {
        fail(`OPERATION_LOCK_CAPABILITY_DRIFT_${field}`);
      }
    }
  }

  const consumer = handoff.documents["GDPS_CONSUMER_LOCK.json"]!;
  const binding = handoff.documents["GOWM_GATEWAY_BINDING_LOCK.json"]!;
  if (
    consumer["schemaVersion"] !== "wsgs-gdps-consumer-lock/1.0" ||
    binding["schemaVersion"] !== "gowm-gateway-binding-lock/1.0"
  ) {
    fail("HANDOFF_BINDING_SCHEMA_DRIFT");
  }
  const sources = object(consumer["sources"], "HANDOFF_CONSUMER_SOURCES_INVALID");
  const sourceCommit = commit(
    sources["wsgsSha"],
    "HANDOFF_CONSUMER_WSGS_SOURCE_INVALID",
  );
  const gdpsCommit = commit(
    sources["gdpsSha"],
    "HANDOFF_CONSUMER_GDPS_SOURCE_INVALID",
  );
  const gowmCommit = commit(
    sources["gowmSha"],
    "HANDOFF_CONSUMER_GOWM_SOURCE_INVALID",
  );
  if (sourceCommit !== expectedSourceCommit) {
    fail("HANDOFF_CONSUMER_SOURCE_DRIFT");
  }
  if (consumer["capabilityLockHash"] !== canonicalHash(capabilityLock)) {
    fail("HANDOFF_CONSUMER_CAPABILITY_HASH_DRIFT");
  }
  const consumerProvider = object(
    consumer["provider"],
    "HANDOFF_CONSUMER_PROVIDER_INVALID",
  );
  const bindingProvider = object(
    binding["provider"],
    "HANDOFF_BINDING_PROVIDER_INVALID",
  );
  if (
    canonicalJson(consumerProvider) !== canonicalJson(bindingProvider) ||
    bindingProvider["providerId"] !== "gdps.geospatial-products" ||
    bindingProvider["providerVersion"] !== "0.2.1" ||
    bindingProvider["providerManifestHash"] !== providerManifestHash
  ) {
    fail("HANDOFF_PROVIDER_BINDING_DRIFT");
  }
  const consumerGateway = object(
    consumer["gateway"],
    "HANDOFF_CONSUMER_GATEWAY_INVALID",
  );
  const bindingGateway = object(
    binding["gateway"],
    "HANDOFF_BINDING_GATEWAY_INVALID",
  );
  if (canonicalJson(consumerGateway) !== canonicalJson(bindingGateway)) {
    fail("HANDOFF_GATEWAY_BINDING_DRIFT");
  }
  const contractCatalogRevision = digest(
    bindingGateway["contractCatalogRevision"],
    "HANDOFF_GATEWAY_CONTRACT_REVISION_INVALID",
  );
  const semanticCatalogHash = digest(
    bindingGateway["semanticCatalogHash"],
    "HANDOFF_GATEWAY_SEMANTIC_HASH_INVALID",
  );
  const bindingRevision = digest(
    bindingGateway["bindingRevision"],
    "HANDOFF_GATEWAY_BINDING_REVISION_INVALID",
  );
  const provenanceGateway = object(
    provenance["gateway"],
    "OPERATION_LOCK_PROVENANCE_GATEWAY_INVALID",
  );
  if (
    provenanceGateway["contractCatalogRevision"] !== contractCatalogRevision ||
    provenanceGateway["semanticCatalogHash"] !== semanticCatalogHash ||
    provenanceGateway["bindingRevision"] !== bindingRevision ||
    liveSemanticCatalogHash !== semanticCatalogHash ||
    operationLock["contractCatalogRevision"] !== contractCatalogRevision ||
    operationLock["semanticCatalogHash"] !== semanticCatalogHash
  ) {
    fail("OPERATION_LOCK_GATEWAY_BINDING_DRIFT");
  }
  digest(
    provenanceGateway["registryRevision"],
    "OPERATION_LOCK_PROVENANCE_REGISTRY_REVISION_INVALID",
  );
  return {
    sourceCommit,
    gdpsCommit,
    gowmCommit,
    providerManifestHash,
    operationLockHash,
    provenanceHash,
    stableOperationKeys: Object.freeze(stableOperationKeys),
    previewOperationKeys: Object.freeze(previewOperationKeys),
    contractCatalogRevision,
    semanticCatalogHash,
    bindingRevision,
  };
}

function expectedDriverKind(caseId: string): GdpsV021DriverKind | undefined {
  return GDPS_V021_DRIVER_BINDINGS.find((entry) => entry.caseId === caseId)
    ?.driverKind;
}

function verifyDriverManifest(
  repositoryRoot: string,
  manifestPath: string,
  manifestBytes: Uint8Array,
  lock: VerifiedLockBinding,
  handoff: VerifiedHandoff,
): VerifiedGdpsV021RuntimePreflight["driverManifest"] {
  const manifest = parseJson(manifestBytes, "DRIVER_MANIFEST_JSON_INVALID");
  exactKeys(
    manifest,
    [
      "schemaVersion",
      "sourceCommit",
      "handoffBundleHash",
      "operationLockHash",
      "provenanceHash",
      "runtimeIdentityHash",
      "drivers",
    ],
    "DRIVER_MANIFEST_FIELDS_INVALID",
  );
  if (manifest["schemaVersion"] !== "wsgs-gdps-e2e-driver-manifest/1.0") {
    fail("DRIVER_MANIFEST_SCHEMA_INVALID");
  }
  if (manifest["sourceCommit"] !== lock.sourceCommit) {
    fail("DRIVER_MANIFEST_SOURCE_DRIFT");
  }
  if (manifest["handoffBundleHash"] !== handoff.bundleHash) {
    fail("DRIVER_MANIFEST_HANDOFF_DRIFT");
  }
  if (manifest["operationLockHash"] !== lock.operationLockHash) {
    fail("DRIVER_MANIFEST_OPERATION_LOCK_DRIFT");
  }
  if (manifest["provenanceHash"] !== lock.provenanceHash) {
    fail("DRIVER_MANIFEST_PROVENANCE_DRIFT");
  }
  const runtimeIdentityHash = digest(
    manifest["runtimeIdentityHash"],
    "DRIVER_MANIFEST_RUNTIME_IDENTITY_INVALID",
  );
  const drivers = array(manifest["drivers"], "DRIVER_MANIFEST_DRIVERS_INVALID");
  if (drivers.length !== GDPS_V021_DRIVER_BINDINGS.length) {
    fail("DRIVER_MANIFEST_CASE_COUNT_INVALID");
  }

  const byCase = new Map<string, JsonObject>();
  for (const raw of drivers) {
    const entry = object(raw, "DRIVER_MANIFEST_ENTRY_INVALID");
    exactKeys(
      entry,
      [
        "caseId",
        "driverKind",
        "attestationPath",
        "attestationHash",
        "implementationPath",
        "implementationHash",
        "evidencePath",
        "evidenceHash",
      ],
      "DRIVER_MANIFEST_ENTRY_FIELDS_INVALID",
    );
    const caseId = text(entry["caseId"], "DRIVER_MANIFEST_CASE_ID_INVALID");
    if (!expectedDriverKind(caseId)) fail("DRIVER_MANIFEST_CASE_ID_INVALID");
    if (byCase.has(caseId)) fail("DRIVER_MANIFEST_CASE_REUSED");
    byCase.set(caseId, entry);
  }

  const usedPaths = new Set<string>();
  const usedFileHashes = new Set<Sha256Digest>();
  const verified: VerifiedGdpsV021DriverRecord[] = [];
  for (const binding of GDPS_V021_DRIVER_BINDINGS) {
    const entry = byCase.get(binding.caseId);
    if (!entry) fail(`DRIVER_MANIFEST_CASE_MISSING_${binding.caseId}`);
    if (entry["driverKind"] !== binding.driverKind) {
      fail(`DRIVER_MANIFEST_KIND_DRIFT_${binding.caseId}`);
    }
    const attestationArtifact = repositoryRelativeArtifact(
      repositoryRoot,
      entry["attestationPath"],
      `DRIVER_${binding.caseId}_ATTESTATION`,
    );
    const implementationArtifact = repositoryRelativeArtifact(
      repositoryRoot,
      entry["implementationPath"],
      `DRIVER_${binding.caseId}_IMPLEMENTATION`,
    );
    const evidenceArtifact = repositoryRelativeArtifact(
      repositoryRoot,
      entry["evidencePath"],
      `DRIVER_${binding.caseId}_EVIDENCE`,
    );
    const artifacts = [
      {
        kind: "ATTESTATION",
        artifact: attestationArtifact,
        expected: digest(
          entry["attestationHash"],
          `DRIVER_${binding.caseId}_ATTESTATION_HASH_INVALID`,
        ),
      },
      {
        kind: "IMPLEMENTATION",
        artifact: implementationArtifact,
        expected: digest(
          entry["implementationHash"],
          `DRIVER_${binding.caseId}_IMPLEMENTATION_HASH_INVALID`,
        ),
      },
      {
        kind: "EVIDENCE",
        artifact: evidenceArtifact,
        expected: digest(
          entry["evidenceHash"],
          `DRIVER_${binding.caseId}_EVIDENCE_HASH_INVALID`,
        ),
      },
    ] as const;
    for (const item of artifacts) {
      if (usedPaths.has(item.artifact.logicalPath)) {
        fail("DRIVER_ARTIFACT_PATH_REUSED");
      }
      usedPaths.add(item.artifact.logicalPath);
      if (usedFileHashes.has(item.expected)) {
        fail("DRIVER_ARTIFACT_HASH_REUSED");
      }
      usedFileHashes.add(item.expected);
      if (sha256(item.artifact.bytes) !== item.expected) {
        fail(`DRIVER_${binding.caseId}_${item.kind}_HASH_DRIFT`);
      }
    }

    const attestation = parseJson(
      attestationArtifact.bytes,
      `DRIVER_${binding.caseId}_ATTESTATION_JSON_INVALID`,
    );
    exactKeys(
      attestation,
      [
        "schemaVersion",
        "caseId",
        "driverKind",
        "sourceCommit",
        "handoffBundleHash",
        "operationLockHash",
        "provenanceHash",
        "runtimeIdentityHash",
        "sharedRuntimeBeforeHash",
        "sharedRuntimeAfterHash",
        "executionEnvironment",
        "requiredExecutionPath",
        "realExternalDependencies",
        "mockTransportUsed",
        "sharedRuntimeMutated",
        "precondition",
        "preconditionHash",
        "driverImplementationHash",
        "evidenceHash",
      ],
      `DRIVER_${binding.caseId}_ATTESTATION_FIELDS_INVALID`,
    );
    if (
      attestation["schemaVersion"] !==
        "wsgs-gdps-e2e-driver-attestation/2.0" ||
      attestation["caseId"] !== binding.caseId ||
      attestation["driverKind"] !== binding.driverKind
    ) {
      fail(`DRIVER_${binding.caseId}_ATTESTATION_IDENTITY_DRIFT`);
    }
    if (
      attestation["sourceCommit"] !== lock.sourceCommit ||
      attestation["handoffBundleHash"] !== handoff.bundleHash ||
      attestation["operationLockHash"] !== lock.operationLockHash ||
      attestation["provenanceHash"] !== lock.provenanceHash ||
      attestation["runtimeIdentityHash"] !== runtimeIdentityHash
    ) {
      fail(`DRIVER_${binding.caseId}_ATTESTATION_SOURCE_DRIFT`);
    }
    if (
      attestation["executionEnvironment"] !== "ISOLATED_REAL_RUNTIME" ||
      attestation["requiredExecutionPath"] !==
        "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" ||
      attestation["realExternalDependencies"] !== true ||
      attestation["mockTransportUsed"] !== false ||
      attestation["sharedRuntimeMutated"] !== false
    ) {
      fail(`DRIVER_${binding.caseId}_ATTESTATION_RUNTIME_POLICY_INVALID`);
    }
    const sharedRuntimeBeforeHash = digest(
      attestation["sharedRuntimeBeforeHash"],
      `DRIVER_${binding.caseId}_SHARED_BEFORE_HASH_INVALID`,
    );
    const sharedRuntimeAfterHash = digest(
      attestation["sharedRuntimeAfterHash"],
      `DRIVER_${binding.caseId}_SHARED_AFTER_HASH_INVALID`,
    );
    if (sharedRuntimeBeforeHash !== sharedRuntimeAfterHash) {
      fail(`DRIVER_${binding.caseId}_SHARED_RUNTIME_CHANGED`);
    }
    const precondition = object(
      attestation["precondition"],
      `DRIVER_${binding.caseId}_PRECONDITION_INVALID`,
    );
    if (
      Object.keys(precondition).length < 3 ||
      precondition["caseId"] !== binding.caseId ||
      precondition["driverKind"] !== binding.driverKind
    ) {
      fail(`DRIVER_${binding.caseId}_PRECONDITION_IDENTITY_DRIFT`);
    }
    const preconditionHash = digest(
      attestation["preconditionHash"],
      `DRIVER_${binding.caseId}_PRECONDITION_HASH_INVALID`,
    );
    if (canonicalHash(precondition) !== preconditionHash) {
      fail(`DRIVER_${binding.caseId}_PRECONDITION_HASH_DRIFT`);
    }
    if (
      attestation["driverImplementationHash"] !== artifacts[1].expected ||
      attestation["evidenceHash"] !== artifacts[2].expected
    ) {
      fail(`DRIVER_${binding.caseId}_ATTESTATION_ARTIFACT_BINDING_DRIFT`);
    }
    verified.push(
      Object.freeze({
        caseId: binding.caseId,
        driverKind: binding.driverKind,
        attestation: Object.freeze({
          schemaVersion: "wsgs-gdps-e2e-driver-attestation/2.0",
          caseId: binding.caseId,
          driverKind: binding.driverKind,
          sourceCommit: lock.sourceCommit,
          handoffBundleHash: handoff.bundleHash,
          operationLockHash: lock.operationLockHash,
          provenanceHash: lock.provenanceHash,
          runtimeIdentityHash,
          sharedRuntimeBeforeHash,
          sharedRuntimeAfterHash,
          executionEnvironment: "ISOLATED_REAL_RUNTIME",
          requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY",
          realExternalDependencies: true,
          mockTransportUsed: false,
          sharedRuntimeMutated: false,
          precondition: structuredClone(precondition),
          preconditionHash,
          driverImplementationHash: artifacts[1].expected,
          evidenceHash: artifacts[2].expected,
        }),
        attestationPath: attestationArtifact.logicalPath,
        attestationHash: artifacts[0].expected,
        attestationByteLength: attestationArtifact.bytes.byteLength,
        implementationPath: implementationArtifact.logicalPath,
        implementationHash: artifacts[1].expected,
        implementationByteLength: implementationArtifact.bytes.byteLength,
        evidencePath: evidenceArtifact.logicalPath,
        evidenceHash: artifacts[2].expected,
        evidenceByteLength: evidenceArtifact.bytes.byteLength,
        precondition: structuredClone(precondition),
        preconditionHash,
        runtimeIdentityHash,
        sharedRuntimeBeforeHash,
        sharedRuntimeAfterHash,
      }),
    );
  }
  return Object.freeze({
    path: manifestPath,
    hash: sha256(manifestBytes),
    runtimeIdentityHash,
    drivers: Object.freeze(verified),
  });
}

interface VerifiedRuntimeAuthorityInternal {
  readonly repositoryRoot: string;
  readonly handoff: VerifiedHandoff;
  readonly handoffDirectory: string;
  readonly lock: VerifiedLockBinding;
  readonly publicRecord: VerifiedGdpsV021RuntimeAuthorityPreflight;
}

function verifyRuntimeAuthority(
  paths: GdpsV021RuntimeAuthorityPreflightPaths,
): VerifiedRuntimeAuthorityInternal {
  let repositoryRoot: string;
  try {
    repositoryRoot = realpathSync(resolve(paths.repositoryRoot));
  } catch {
    return fail("REPOSITORY_ROOT_MISSING");
  }
  if (!statSync(repositoryRoot).isDirectory()) fail("REPOSITORY_ROOT_INVALID");
  const expectedSourceCommit = commit(
    paths.expectedSourceCommit,
    "EXPECTED_SOURCE_COMMIT_INVALID",
  );
  const operationLockPath = existingPathWithinRoot(
    repositoryRoot,
    paths.operationLockPath,
    "file",
    "OPERATION_LOCK",
  );
  if (basename(operationLockPath) !== operationLockFilename) {
    fail("OPERATION_LOCK_FILENAME_INVALID");
  }
  const provenancePath = existingPathWithinRoot(
    repositoryRoot,
    resolve(operationLockPath, "..", operationLockProvenanceFilename),
    "file",
    "OPERATION_LOCK_PROVENANCE",
  );
  const handoffDirectory = existingPathWithinRoot(
    repositoryRoot,
    paths.handoffDirectory,
    "directory",
    "HANDOFF_DIRECTORY",
  );
  const handoff = verifyHandoff(handoffDirectory);
  const lock = verifyLockBinding(
    readFileSync(operationLockPath),
    readFileSync(provenancePath),
    handoff,
    expectedSourceCommit,
  );
  const publicRecord: VerifiedGdpsV021RuntimeAuthorityPreflight = Object.freeze({
    schemaVersion: "wsgs-gdps-v021-runtime-preflight/1.0",
    sourceCommit: lock.sourceCommit,
    gdpsCommit: lock.gdpsCommit,
    gowmCommit: lock.gowmCommit,
    provider: Object.freeze({
      providerId: "gdps.geospatial-products",
      providerVersion: "0.2.1",
      providerManifestHash: lock.providerManifestHash,
      capabilityCount: 30,
    }),
    operationLock: Object.freeze({
      path: operationLockPath,
      hash: lock.operationLockHash,
      provenancePath,
      provenanceHash: lock.provenanceHash,
      stableOperationKeys: lock.stableOperationKeys,
      previewOperationKeys: lock.previewOperationKeys,
      contractCatalogRevision: lock.contractCatalogRevision,
      semanticCatalogHash: lock.semanticCatalogHash,
      bindingRevision: lock.bindingRevision,
    }),
    handoff: Object.freeze({
      directory: handoffDirectory,
      checksumsHash: handoff.checksumsHash,
      bundleHash: handoff.bundleHash,
      fileHashes: handoff.fileHashes,
    }),
  });
  return { repositoryRoot, handoff, handoffDirectory, lock, publicRecord };
}

/**
 * Verifies immutable source, handoff, live operation-lock, and provenance
 * authority before an isolated runtime is created or mutated. Runtime driver
 * evidence deliberately is not required here because it can only exist after
 * the run it attests.
 */
export function verifyGdpsV021RuntimeAuthorityPreflight(
  paths: GdpsV021RuntimeAuthorityPreflightPaths,
): VerifiedGdpsV021RuntimeAuthorityPreflight {
  return verifyRuntimeAuthority(paths).publicRecord;
}

/**
 * Full post-run verification. In addition to the immutable authority
 * preflight, this validates the four real driver attestations and their bytes.
 */
export function verifyGdpsV021RuntimePreflight(
  paths: GdpsV021RuntimePreflightPaths,
): VerifiedGdpsV021RuntimePreflight {
  const authority = verifyRuntimeAuthority(paths);
  const driverManifestPath = existingPathWithinRoot(
    authority.repositoryRoot,
    paths.driverManifestPath,
    "file",
    "DRIVER_MANIFEST",
  );
  const driverManifest = verifyDriverManifest(
    authority.repositoryRoot,
    driverManifestPath,
    readFileSync(driverManifestPath),
    authority.lock,
    authority.handoff,
  );
  return Object.freeze({ ...authority.publicRecord, driverManifest });
}

export function runGdpsV021AuthorityPreflightBeforeMutation<T>(
  paths: GdpsV021RuntimeAuthorityPreflightPaths,
  mutation: (verified: VerifiedGdpsV021RuntimeAuthorityPreflight) => T,
): T {
  const verified = verifyGdpsV021RuntimeAuthorityPreflight(paths);
  return mutation(verified);
}

/** @deprecated Use authority preflight before mutation and full verification after the run. */
export function runGdpsV021PreflightBeforeMutation<T>(
  paths: GdpsV021RuntimePreflightPaths,
  mutation: (verified: VerifiedGdpsV021RuntimePreflight) => T,
): T {
  const verified = verifyGdpsV021RuntimePreflight(paths);
  return mutation(verified);
}
