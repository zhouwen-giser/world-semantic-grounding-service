import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type JsonObject = Record<string, unknown>;
type Sha256Digest = `sha256:${string}`;

const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const writeMode = process.argv.includes("--write");
const unsupportedArguments = process.argv.slice(2).filter((argument) => argument !== "--write");
if (unsupportedArguments.length > 0) {
  throw new Error(`GDPS_OPERATION_LOCK_ARGUMENT_UNSUPPORTED:${unsupportedArguments.join(",")}`);
}

const paths = {
  baseLock: resolve(
    repositoryRoot,
    "contracts/upstream/gowm-0.6.3/extracted/package/bundle/locks/wsgs-southbound-operation-lock-v2.json"
  ),
  capabilityLock: resolve(repositoryRoot, "contracts/upstream/gdps-v0.2.1/GDPS_CAPABILITY_LOCK.json"),
  gatewayBindingLock: resolve(repositoryRoot, "contracts/upstream/gdps-v0.2.1/GOWM_GATEWAY_BINDING_LOCK.json"),
  output: resolve(repositoryRoot, "contracts/generated/gdps-v0.2.1/wsgs-southbound-operation-lock-v2.json")
} as const;

const stableOperationIds = [
  "reference.get",
  "reference.resolve",
  "world.get-current-state",
  "world.get-geometry",
  "world.get-provenance",
  "catalog.get",
  "catalog.search",
  "spatial.find-nearby",
  "spatial.find-in-area",
  "spatial.find-intersections",
  "reference.validate",
  "result.validate"
] as const;

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonObject;
}

function array(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(code);
  return value;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) throw new Error(code);
  return value;
}

function digest(value: unknown, code: string): Sha256Digest {
  const candidate = text(value, code);
  if (!/^sha256:[0-9a-f]{64}$/u.test(candidate)) throw new Error(code);
  return candidate as Sha256Digest;
}

function exactKeys(value: JsonObject, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((entry, index) => entry !== required[index])) {
    throw new Error(code);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as JsonObject;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("GDPS_OPERATION_LOCK_CANONICAL_VALUE_UNSUPPORTED");
  return encoded;
}

function sha256(value: string | Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalSha256(value: unknown): Sha256Digest {
  return sha256(canonical(value));
}

function json(path: string, code: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error(code);
  }
  return object(value, code);
}

function operationKey(value: JsonObject): string {
  return `${text(value["operationId"], "GDPS_OPERATION_ID_INVALID")}@${
    text(value["operationVersion"], "GDPS_OPERATION_VERSION_INVALID")}`;
}

function exactOperation(
  collection: readonly JsonObject[],
  operationId: string,
  operationVersion = "1.0"
): JsonObject {
  const matches = collection.filter((entry) =>
    entry["operationId"] === operationId && entry["operationVersion"] === operationVersion);
  if (matches.length !== 1) throw new Error(`GDPS_LIVE_OPERATION_CARDINALITY_INVALID:${operationId}@${operationVersion}`);
  return matches[0]!;
}

function exactStrings(value: unknown, code: string): string[] {
  const entries = array(value, code).map((entry) => text(entry, code));
  if (entries.length === 0 || new Set(entries).size !== entries.length ||
      entries.some((entry) => !/^[a-z][a-z0-9._:-]*$/u.test(entry))) {
    throw new Error(code);
  }
  return entries;
}

async function get(baseUrl: URL, path: string): Promise<JsonObject> {
  let response: Response;
  try {
    response = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error(`GDPS_LIVE_DISCOVERY_UNAVAILABLE:${path}`);
  }
  if (!response.ok) throw new Error(`GDPS_LIVE_DISCOVERY_HTTP_${response.status}:${path}`);
  try {
    return object(await response.json() as unknown, `GDPS_LIVE_DISCOVERY_BODY_INVALID:${path}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("GDPS_")) throw error;
    throw new Error(`GDPS_LIVE_DISCOVERY_BODY_INVALID:${path}`);
  }
}

const configuredBaseUrl = process.env["GOWM_GATEWAY_BASE_URL"]?.trim() || "http://127.0.0.1:18063";
const baseUrl = new URL(configuredBaseUrl);
if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || !["", "/"].includes(baseUrl.pathname)) {
  throw new Error("GDPS_GATEWAY_BASE_URL_INVALID");
}
if (baseUrl.protocol !== "https:" &&
    !(baseUrl.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname))) {
  throw new Error("GDPS_INSECURE_REMOTE_GATEWAY_FORBIDDEN");
}

const baseLock = json(paths.baseLock, "GDPS_BASE_OPERATION_LOCK_INVALID");
exactKeys(baseLock, [
  "schemaVersion",
  "gatewayContractVersion",
  "consumerContractPackage",
  "contractCatalogRevision",
  "semanticCatalogHash",
  "availabilityContractHash",
  "snapshotContractHash",
  "delegationContractHash",
  "defaultOperations",
  "previewOperations"
], "GDPS_BASE_OPERATION_LOCK_KEYS_INVALID");
if (baseLock["schemaVersion"] !== "2.0" || baseLock["gatewayContractVersion"] !== "0.6.3") {
  throw new Error("GDPS_BASE_OPERATION_LOCK_VERSION_INVALID");
}
const consumerContractPackage = object(
  baseLock["consumerContractPackage"],
  "GDPS_BASE_CONSUMER_CONTRACT_PACKAGE_INVALID"
);
exactKeys(consumerContractPackage, ["name", "version", "integrity"], "GDPS_BASE_CONSUMER_CONTRACT_PACKAGE_KEYS_INVALID");
if (consumerContractPackage["name"] !== "@gowm/world-gateway-contracts" ||
    consumerContractPackage["version"] !== "0.6.3" ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(text(
      consumerContractPackage["integrity"],
      "GDPS_BASE_CONSUMER_CONTRACT_PACKAGE_INTEGRITY_INVALID"
    ))) {
  throw new Error("GDPS_BASE_CONSUMER_CONTRACT_PACKAGE_INVALID");
}
for (const field of ["availabilityContractHash", "snapshotContractHash", "delegationContractHash"] as const) {
  digest(baseLock[field], `GDPS_BASE_${field.toUpperCase()}_INVALID`);
}

const capabilityLock = json(paths.capabilityLock, "GDPS_CAPABILITY_LOCK_INVALID");
exactKeys(capabilityLock, [
  "schemaVersion",
  "providerId",
  "providerManifestHash",
  "descriptorRegistryHash",
  "operations"
], "GDPS_CAPABILITY_LOCK_KEYS_INVALID");
if (capabilityLock["schemaVersion"] !== "gdps-v021-capability-lock/1.0" ||
    capabilityLock["providerId"] !== "gdps.geospatial-products") {
  throw new Error("GDPS_CAPABILITY_LOCK_IDENTITY_INVALID");
}
const providerManifestHash = digest(capabilityLock["providerManifestHash"], "GDPS_PROVIDER_MANIFEST_HASH_INVALID");
digest(capabilityLock["descriptorRegistryHash"], "GDPS_DESCRIPTOR_REGISTRY_HASH_INVALID");
const gdpsOperations = array(capabilityLock["operations"], "GDPS_CAPABILITY_OPERATIONS_INVALID")
  .map((entry) => object(entry, "GDPS_CAPABILITY_OPERATION_INVALID"));
if (gdpsOperations.length !== 30 || new Set(gdpsOperations.map(operationKey)).size !== 30) {
  throw new Error("GDPS_CAPABILITY_OPERATION_SET_INVALID");
}
for (const operation of gdpsOperations) {
  exactKeys(operation, [
    "operationId",
    "operationVersion",
    "inputSchemaHash",
    "outputSchemaHash",
    "semanticProfileHash",
    "maturity",
    "availability"
  ], `GDPS_CAPABILITY_OPERATION_KEYS_INVALID:${operationKey(operation)}`);
  if (operation["operationVersion"] !== "1.0" || operation["maturity"] !== "PREVIEW" ||
      operation["availability"] !== "AVAILABLE") {
    throw new Error(`GDPS_CAPABILITY_OPERATION_POLICY_INVALID:${operationKey(operation)}`);
  }
  digest(operation["inputSchemaHash"], `GDPS_INPUT_SCHEMA_HASH_INVALID:${operationKey(operation)}`);
  digest(operation["outputSchemaHash"], `GDPS_OUTPUT_SCHEMA_HASH_INVALID:${operationKey(operation)}`);
  digest(operation["semanticProfileHash"], `GDPS_SEMANTIC_PROFILE_HASH_INVALID:${operationKey(operation)}`);
}

const gatewayBindingDocument = json(paths.gatewayBindingLock, "GDPS_GATEWAY_BINDING_LOCK_INVALID");
exactKeys(gatewayBindingDocument, ["schemaVersion", "gateway", "provider"], "GDPS_GATEWAY_BINDING_LOCK_KEYS_INVALID");
if (gatewayBindingDocument["schemaVersion"] !== "gowm-gateway-binding-lock/1.0") {
  throw new Error("GDPS_GATEWAY_BINDING_LOCK_VERSION_INVALID");
}
const gatewayBinding = object(gatewayBindingDocument["gateway"], "GDPS_GATEWAY_BINDING_INVALID");
const providerBinding = object(gatewayBindingDocument["provider"], "GDPS_PROVIDER_BINDING_INVALID");
for (const field of ["contractCatalogRevision", "semanticCatalogHash", "bindingRevision"] as const) {
  digest(gatewayBinding[field], `GDPS_GATEWAY_BINDING_${field.toUpperCase()}_INVALID`);
}
if (providerBinding["providerId"] !== capabilityLock["providerId"] ||
    providerBinding["providerVersion"] !== "0.2.1" ||
    providerBinding["providerManifestHash"] !== providerManifestHash) {
  throw new Error("GDPS_PROVIDER_BINDING_MISMATCH");
}

const [catalog, semantics] = await Promise.all([
  get(baseUrl, "/v1/capabilities"),
  get(baseUrl, "/v1/capability-semantics")
]);
const liveCapabilities = array(catalog["capabilities"], "GDPS_LIVE_CAPABILITIES_INVALID")
  .map((entry) => object(entry, "GDPS_LIVE_CAPABILITY_INVALID"));
const liveProfiles = array(semantics["profiles"], "GDPS_LIVE_SEMANTIC_PROFILES_INVALID")
  .map((entry) => object(entry, "GDPS_LIVE_SEMANTIC_PROFILE_INVALID"));
if (catalog["contractCatalogRevision"] !== gatewayBinding["contractCatalogRevision"] ||
    semantics["contractCatalogRevision"] !== gatewayBinding["contractCatalogRevision"] ||
    catalog["bindingRevision"] !== gatewayBinding["bindingRevision"] ||
    semantics["bindingRevision"] !== gatewayBinding["bindingRevision"] ||
    semantics["catalogHash"] !== gatewayBinding["semanticCatalogHash"]) {
  throw new Error("GDPS_LIVE_GATEWAY_BINDING_DRIFT");
}
if (canonicalSha256(liveProfiles) !== semantics["catalogHash"]) {
  throw new Error("GDPS_LIVE_SEMANTIC_CATALOG_SELF_HASH_INVALID");
}

const baseOperations = [
  ...array(baseLock["defaultOperations"], "GDPS_BASE_DEFAULT_OPERATIONS_INVALID"),
  ...array(baseLock["previewOperations"], "GDPS_BASE_PREVIEW_OPERATIONS_INVALID")
].map((entry) => object(entry, "GDPS_BASE_OPERATION_INVALID"));

function liveSemanticHash(operationId: string): Sha256Digest {
  const profile = exactOperation(liveProfiles, operationId);
  const profileHash = digest(profile["semanticProfileHash"], `GDPS_LIVE_SEMANTIC_HASH_INVALID:${operationId}@1.0`);
  if (canonicalSha256(profile["semanticProfile"]) !== profileHash) {
    throw new Error(`GDPS_LIVE_SEMANTIC_PROFILE_SELF_HASH_INVALID:${operationId}@1.0`);
  }
  return profileHash;
}

const stableOperations = stableOperationIds.map((operationId) => {
  const authoritative = exactOperation(baseOperations, operationId);
  const live = exactOperation(liveCapabilities, operationId);
  const key = `${operationId}@1.0`;
  if (authoritative["maturity"] !== "STABLE" || live["maturity"] !== "STABLE" ||
      live["inputSchemaHash"] !== authoritative["inputSchemaHash"] ||
      live["outputSchemaHash"] !== authoritative["outputSchemaHash"] ||
      liveSemanticHash(operationId) !== authoritative["semanticProfileHash"]) {
    throw new Error(`GDPS_STABLE_OPERATION_DRIFT:${key}`);
  }
  exactStrings(authoritative["requiredPermissions"], `GDPS_STABLE_PERMISSIONS_INVALID:${key}`);
  if (!["NONE", "BEST_EFFORT", "CONSISTENT_AT_START", "PINNED"].includes(
    text(authoritative["snapshotSupport"], `GDPS_STABLE_SNAPSHOT_SUPPORT_INVALID:${key}`)
  )) {
    throw new Error(`GDPS_STABLE_SNAPSHOT_SUPPORT_INVALID:${key}`);
  }
  return authoritative;
});

const previewOperations = [...gdpsOperations]
  .sort((left, right) => {
    const leftKey = operationKey(left);
    const rightKey = operationKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  })
  .map((authority) => {
    const operationId = text(authority["operationId"], "GDPS_PREVIEW_OPERATION_ID_INVALID");
    const key = operationKey(authority);
    const live = exactOperation(liveCapabilities, operationId);
    if (live["maturity"] !== "PREVIEW" || live["inputSchemaHash"] !== authority["inputSchemaHash"] ||
        live["outputSchemaHash"] !== authority["outputSchemaHash"] ||
        liveSemanticHash(operationId) !== authority["semanticProfileHash"]) {
      throw new Error(`GDPS_PREVIEW_OPERATION_DRIFT:${key}`);
    }
    if (live["scopePolicy"] !== "DATA_SCOPE_REQUIRED") {
      throw new Error(`GDPS_PREVIEW_SCOPE_POLICY_INVALID:${key}`);
    }
    const snapshotPolicy = object(live["snapshotPolicy"], `GDPS_PREVIEW_SNAPSHOT_POLICY_INVALID:${key}`);
    if (snapshotPolicy["dataSnapshot"] !== "REQUIRED" || snapshotPolicy["computeSnapshot"] !== "REQUIRED") {
      throw new Error(`GDPS_PREVIEW_SNAPSHOT_POLICY_INVALID:${key}`);
    }
    return {
      operationId,
      operationVersion: "1.0",
      inputSchemaHash: authority["inputSchemaHash"],
      outputSchemaHash: authority["outputSchemaHash"],
      semanticProfileHash: authority["semanticProfileHash"],
      maturity: "PREVIEW",
      requiredPermissions: ["data:read"],
      snapshotSupport: "CONSISTENT_AT_START"
    };
  });

const combinedOperationKeys = [...stableOperations, ...previewOperations].map(operationKey);
if (stableOperations.length !== 12 || previewOperations.length !== 30 ||
    combinedOperationKeys.length !== 42 || new Set(combinedOperationKeys).size !== 42) {
  throw new Error("GDPS_COMBINED_OPERATION_SET_INVALID");
}

const output = {
  schemaVersion: "2.0",
  gatewayContractVersion: "0.6.3",
  consumerContractPackage,
  contractCatalogRevision: gatewayBinding["contractCatalogRevision"],
  semanticCatalogHash: gatewayBinding["semanticCatalogHash"],
  availabilityContractHash: baseLock["availabilityContractHash"],
  snapshotContractHash: baseLock["snapshotContractHash"],
  delegationContractHash: baseLock["delegationContractHash"],
  defaultOperations: stableOperations,
  previewOperations
};
const outputBytes = Buffer.from(`${JSON.stringify(output, null, 2)}\n`, "utf8");
if (writeMode) {
  mkdirSync(dirname(paths.output), { recursive: true });
  writeFileSync(paths.output, outputBytes);
  if (!readFileSync(paths.output).equals(outputBytes)) throw new Error("GDPS_OPERATION_LOCK_WRITE_FAILED");
} else {
  if (!existsSync(paths.output)) throw new Error("GDPS_OPERATION_LOCK_MISSING");
  if (!readFileSync(paths.output).equals(outputBytes)) throw new Error("GDPS_OPERATION_LOCK_DRIFT");
}

process.stdout.write(`${JSON.stringify({
  marker: "WSGS_GDPS_V021_LIVE_OPERATION_LOCK_PASS",
  mode: writeMode ? "write" : "check",
  gatewayBaseUrlHash: sha256(baseUrl.origin),
  liveCapabilityCount: liveCapabilities.length,
  selectedStableOperations: stableOperations.length,
  selectedPreviewOperations: previewOperations.length,
  contractCatalogRevision: output.contractCatalogRevision,
  semanticCatalogHash: output.semanticCatalogHash,
  bindingRevision: gatewayBinding["bindingRevision"],
  exactOperationLockHash: sha256(outputBytes)
}, null, 2)}\n`);
