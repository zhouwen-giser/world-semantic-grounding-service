import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { OperationLock, Sha256Digest } from "@wsgs/gowm-gateway-client";

type JsonObject = Record<string, unknown>;

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const scopePattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const runtimeInstanceIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const exactGdpsBusinessInventory = Object.freeze([
  "GDPS_CAPABILITY_LOCK.json",
  "GDPS_CONSUMER_LOCK.json",
  "GDPS_PRODUCT_DESCRIPTOR_LOCK.json",
  "GDPS_RECIPE_LOCK.json",
  "GDPS_SAMPLE_DATASET_LOCK.json",
  "GOWM_GATEWAY_BINDING_LOCK.json",
  "WSGS_QUERY_CORPUS.json",
  "WSGS_TEST_BASELINE.json"
] as const);
const loadedAuthorities = new WeakSet<object>();

export class SegmentedScopeAuthorityError extends Error {
  constructor(readonly code: string) {
    super(`Segmented scope authority rejected: ${code}`);
  }
}

interface TrustedOperationScopeSource {
  readonly role: "FOUNDATION" | "SELECTED_DATASET";
  readonly dataScope: string;
  readonly sourceLockHash: Sha256Digest;
  readonly operations: readonly OperationLock[];
}

export interface SegmentedOperationScopeBinding {
  readonly role: TrustedOperationScopeSource["role"];
  readonly dataScope: string;
  readonly sourceLockHash: Sha256Digest;
  readonly operation: Readonly<OperationLock>;
}

export interface SegmentedScopeAuthority {
  readonly schemaVersion: "wsgs-segmented-scope-authority/1.0";
  readonly authorityHash: Sha256Digest;
  readonly foundationInstanceBindingHash: Sha256Digest;
  readonly gdpsChecksumsHash: Sha256Digest;
  readonly requiredDataScopes: readonly string[];
  readonly bindings: Readonly<Record<string, SegmentedOperationScopeBinding>>;
}

export interface LoadSegmentedScopeAuthorityInput {
  readonly foundationHandoffDirectory: string;
  readonly gdpsHandoffDirectory: string;
  readonly foundationOperations: readonly OperationLock[];
  readonly selectedDatasetOperations: readonly OperationLock[];
  readonly additionalFoundationSources?: readonly {
    readonly sourceLockHash: Sha256Digest;
    readonly operations: readonly OperationLock[];
  }[];
}

export interface LoadedSegmentedScopeAuthority {
  readonly authority: SegmentedScopeAuthority;
  readonly foundationDataScope: string;
  readonly selectedDatasetDataScope: string;
  readonly foundationInstanceBindingHash: Sha256Digest;
  readonly gdpsChecksumsHash: Sha256Digest;
}

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SegmentedScopeAuthorityError(code);
  return value as JsonObject;
}

function array(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) throw new SegmentedScopeAuthorityError(code);
  return value;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new SegmentedScopeAuthorityError(code);
  return value;
}

function digest(value: unknown, code: string): Sha256Digest {
  const result = text(value, code);
  if (!digestPattern.test(result)) throw new SegmentedScopeAuthorityError(code);
  return result as Sha256Digest;
}

function dataScope(value: unknown, code: string): string {
  const result = text(value, code);
  if (!scopePattern.test(result) || result.includes("*")) throw new SegmentedScopeAuthorityError(code);
  return result;
}

function runtimeInstanceId(value: unknown, code: string): string {
  const result = text(value, code);
  if (!runtimeInstanceIdPattern.test(result)) throw new SegmentedScopeAuthorityError(code);
  return result;
}

function sha256(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function jsonFile(path: string, code: string): { readonly bytes: Buffer; readonly value: JsonObject } {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new SegmentedScopeAuthorityError(`${code}_MISSING`);
  }
  try {
    return { bytes, value: object(JSON.parse(bytes.toString("utf8")) as unknown, `${code}_INVALID`) };
  } catch (error) {
    if (error instanceof SegmentedScopeAuthorityError) throw error;
    throw new SegmentedScopeAuthorityError(`${code}_INVALID`);
  }
}

function operationKey(value: { operationId: string; operationVersion: string }): string {
  return `${value.operationId}@${value.operationVersion}`;
}

function lockProjection(value: OperationLock): JsonObject {
  return {
    operationId: value.operationId,
    operationVersion: value.operationVersion,
    inputSchemaHash: value.inputSchemaHash,
    outputSchemaHash: value.outputSchemaHash,
    semanticProfileHash: value.semanticProfileHash,
    maturity: value.maturity
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as JsonObject)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
  return Object.freeze(value);
}

function assertExactOperationLocks(
  actualValues: unknown,
  expected: readonly OperationLock[],
  code: string,
  availabilityAllowed: boolean
): void {
  const actual = array(actualValues, code).map((entry) => {
    const value = object(entry, code);
    const projection: JsonObject = {
      operationId: text(value["operationId"], code),
      operationVersion: text(value["operationVersion"], code),
      inputSchemaHash: digest(value["inputSchemaHash"], code),
      outputSchemaHash: digest(value["outputSchemaHash"], code),
      semanticProfileHash: digest(value["semanticProfileHash"], code),
      maturity: text(value["maturity"], code)
    };
    if (availabilityAllowed && value["availability"] !== "AVAILABLE") {
      throw new SegmentedScopeAuthorityError(code);
    }
    return projection;
  });
  const expectedProjection = expected.map(lockProjection);
  const byKey = (values: JsonObject[]) => values.sort((left, right) =>
    operationKey(left as { operationId: string; operationVersion: string }).localeCompare(
      operationKey(right as { operationId: string; operationVersion: string })
    ));
  if (canonical(byKey(actual)) !== canonical(byKey(expectedProjection))) {
    throw new SegmentedScopeAuthorityError(code);
  }
}

function checksumMap(value: JsonObject): ReadonlyMap<string, Sha256Digest> {
  if (value["schemaVersion"] !== "wsgs-gdps-v021-checksums/1.0" || value["algorithm"] !== "SHA-256") {
    throw new SegmentedScopeAuthorityError("GDPS_CHECKSUMS_INVALID");
  }
  const result = new Map<string, Sha256Digest>();
  for (const raw of array(value["files"], "GDPS_CHECKSUMS_INVALID")) {
    const entry = object(raw, "GDPS_CHECKSUMS_INVALID");
    const path = text(entry["path"], "GDPS_CHECKSUMS_INVALID");
    if (path.includes("/") || path.includes("\\") || result.has(path)) {
      throw new SegmentedScopeAuthorityError("GDPS_CHECKSUMS_INVALID");
    }
    result.set(path, digest(entry["sha256"], "GDPS_CHECKSUMS_INVALID"));
  }
  if (canonical([...result.keys()].sort()) !== canonical([...exactGdpsBusinessInventory].sort())) {
    throw new SegmentedScopeAuthorityError("GDPS_CHECKSUMS_INVENTORY_MISMATCH");
  }
  return result;
}

function createLoadedSegmentedScopeAuthority(
  sources: readonly TrustedOperationScopeSource[],
  provenance: {
    readonly foundationInstanceBindingHash: Sha256Digest;
    readonly gdpsChecksumsHash: Sha256Digest;
  }
): SegmentedScopeAuthority {
  if (sources.length < 2 ||
      !sources.some((source) => source.role === "FOUNDATION") ||
      !sources.some((source) => source.role === "SELECTED_DATASET")) {
    throw new SegmentedScopeAuthorityError("TRUSTED_SCOPE_SOURCES_REQUIRED");
  }
  const requiredDataScopes = new Set<string>();
  const bindings: Record<string, SegmentedOperationScopeBinding> = Object.create(null) as Record<
    string,
    SegmentedOperationScopeBinding
  >;
  for (const source of sources) {
    const verifiedScope = dataScope(source.dataScope, "INVALID_TRUSTED_DATA_SCOPE");
    digest(source.sourceLockHash, "INVALID_TRUSTED_SOURCE_LOCK_HASH");
    if (source.operations.length === 0) {
      throw new SegmentedScopeAuthorityError("TRUSTED_OPERATION_LOCKS_REQUIRED");
    }
    requiredDataScopes.add(verifiedScope);
    for (const raw of source.operations) {
      const projection = lockProjection(raw);
      digest(projection["inputSchemaHash"], "INVALID_TRUSTED_OPERATION_HASH");
      digest(projection["outputSchemaHash"], "INVALID_TRUSTED_OPERATION_HASH");
      digest(projection["semanticProfileHash"], "INVALID_TRUSTED_OPERATION_HASH");
      if (projection["maturity"] !== "STABLE" && projection["maturity"] !== "PREVIEW") {
        throw new SegmentedScopeAuthorityError("INVALID_TRUSTED_OPERATION_MATURITY");
      }
      const operation = deepFreeze(structuredClone(raw));
      const key = operationKey(operation);
      if (Object.hasOwn(bindings, key)) {
        throw new SegmentedScopeAuthorityError("AMBIGUOUS_OPERATION_SCOPE_AUTHORITY");
      }
      bindings[key] = Object.freeze({
        role: source.role,
        dataScope: verifiedScope,
        sourceLockHash: source.sourceLockHash,
        operation
      });
    }
  }
  if (requiredDataScopes.size !== 2) {
    throw new SegmentedScopeAuthorityError("SEGMENTED_DATA_SCOPES_NOT_DISTINCT");
  }
  const foundationInstanceBindingHash = digest(
    provenance.foundationInstanceBindingHash,
    "GOWM_INSTANCE_BINDING_HASH_INVALID"
  );
  const gdpsChecksumsHash = digest(provenance.gdpsChecksumsHash, "GDPS_CHECKSUMS_HASH_INVALID");
  const required = Object.freeze([...requiredDataScopes].sort());
  const stableBindings = Object.freeze(Object.fromEntries(Object.entries(bindings)
    .sort(([left], [right]) => left.localeCompare(right))));
  const hashPayload = {
    schemaVersion: "wsgs-segmented-scope-authority/1.0" as const,
    foundationInstanceBindingHash,
    gdpsChecksumsHash,
    requiredDataScopes: required,
    bindings: stableBindings
  };
  const authority = Object.freeze({
    ...hashPayload,
    authorityHash: sha256(Buffer.from(canonical(hashPayload), "utf8"))
  });
  loadedAuthorities.add(authority);
  return authority;
}

export function assertLoadedSegmentedScopeAuthority(authority: SegmentedScopeAuthority): void {
  if (!loadedAuthorities.has(authority)) {
    throw new SegmentedScopeAuthorityError("SEGMENTED_SCOPE_AUTHORITY_NOT_LOADED");
  }
  const expected = sha256(Buffer.from(canonical({
    schemaVersion: authority.schemaVersion,
    foundationInstanceBindingHash: authority.foundationInstanceBindingHash,
    gdpsChecksumsHash: authority.gdpsChecksumsHash,
    requiredDataScopes: authority.requiredDataScopes,
    bindings: authority.bindings
  }), "utf8"));
  if (authority.schemaVersion !== "wsgs-segmented-scope-authority/1.0" ||
      authority.authorityHash !== expected) {
    throw new SegmentedScopeAuthorityError("SEGMENTED_SCOPE_AUTHORITY_HASH_DRIFT");
  }
}

/**
 * Loads the two data-scope authorities only from locked server-side handoffs.
 * No caller request field or free-form operation mapping participates.
 */
export function loadSegmentedScopeAuthority(
  input: LoadSegmentedScopeAuthorityInput
): LoadedSegmentedScopeAuthority {
  if (input.foundationOperations.length === 0 || input.selectedDatasetOperations.length === 0) {
    throw new SegmentedScopeAuthorityError("SEGMENTED_OPERATION_LOCKS_REQUIRED");
  }

  const manifestFile = jsonFile(join(input.foundationHandoffDirectory, "INSTANCE_MANIFEST.json"), "GOWM_INSTANCE_MANIFEST");
  const bindingFile = jsonFile(join(input.foundationHandoffDirectory, "INSTANCE_BINDING.json"), "GOWM_INSTANCE_BINDING");
  const manifest = manifestFile.value;
  const binding = bindingFile.value;
  const manifestRuntimeInstanceId = runtimeInstanceId(
    manifest["runtimeInstanceId"],
    "GOWM_RUNTIME_INSTANCE_ID_INVALID"
  );
  const bindingRuntimeInstanceId = runtimeInstanceId(
    binding["runtimeInstanceId"],
    "GOWM_RUNTIME_INSTANCE_ID_INVALID"
  );
  if (manifest["schemaVersion"] !== "1.0" || binding["schemaVersion"] !== "1.0" ||
      manifest["authMode"] !== "SIGNED_DELEGATION_V1" ||
      manifestRuntimeInstanceId !== bindingRuntimeInstanceId ||
      manifest["instanceId"] !== binding["instanceId"] ||
      manifest["fixtureId"] !== binding["fixtureId"] ||
      manifest["fixtureVersion"] !== binding["fixtureVersion"]) {
    throw new SegmentedScopeAuthorityError("GOWM_INSTANCE_HANDOFF_BINDING_MISMATCH");
  }
  const foundationDataScope = dataScope(manifest["dataScope"], "GOWM_INSTANCE_DATA_SCOPE_INVALID");
  const foundationSourceHash = digest(manifest["operationLockHash"], "GOWM_INSTANCE_OPERATION_LOCK_HASH_INVALID");
  const stableOperations = array(manifest["stableOperations"], "GOWM_INSTANCE_OPERATIONS_INVALID")
    .map((entry) => text(entry, "GOWM_INSTANCE_OPERATIONS_INVALID")).sort();
  const expectedFoundationKeys = input.foundationOperations.map(operationKey).sort();
  if (canonical(stableOperations) !== canonical(expectedFoundationKeys)) {
    throw new SegmentedScopeAuthorityError("GOWM_INSTANCE_OPERATIONS_INVALID");
  }
  assertExactOperationLocks(binding["operationContracts"], input.foundationOperations, "GOWM_INSTANCE_OPERATION_LOCK_DRIFT", false);

  const checksumsFile = jsonFile(join(input.gdpsHandoffDirectory, "CHECKSUMS.json"), "GDPS_CHECKSUMS");
  const checksums = checksumMap(checksumsFile.value);
  const datasetFile = jsonFile(join(input.gdpsHandoffDirectory, "GDPS_SAMPLE_DATASET_LOCK.json"), "GDPS_SAMPLE_DATASET_LOCK");
  const capabilityFile = jsonFile(join(input.gdpsHandoffDirectory, "GDPS_CAPABILITY_LOCK.json"), "GDPS_CAPABILITY_LOCK");
  if (checksums.get("GDPS_SAMPLE_DATASET_LOCK.json") !== sha256(datasetFile.bytes) ||
      checksums.get("GDPS_CAPABILITY_LOCK.json") !== sha256(capabilityFile.bytes)) {
    throw new SegmentedScopeAuthorityError("GDPS_HANDOFF_CHECKSUM_MISMATCH");
  }
  const dataset = datasetFile.value;
  const capability = capabilityFile.value;
  if (dataset["schemaVersion"] !== "gdps-v021-sample-dataset-lock/1.0" ||
      capability["schemaVersion"] !== "gdps-v021-capability-lock/1.0" ||
      capability["providerId"] !== "gdps.geospatial-products") {
    throw new SegmentedScopeAuthorityError("GDPS_SCOPE_AUTHORITY_INVALID");
  }
  const selectedDatasetDataScope = dataScope(dataset["scope"], "GDPS_SAMPLE_DATA_SCOPE_INVALID");
  if (selectedDatasetDataScope === foundationDataScope) {
    throw new SegmentedScopeAuthorityError("SEGMENTED_DATA_SCOPES_NOT_DISTINCT");
  }
  const selectedKeys = new Set(input.selectedDatasetOperations.map(operationKey));
  const selectedCapabilityLocks = array(capability["operations"], "GDPS_CAPABILITY_LOCK_INVALID")
    .filter((raw) => {
      const entry = object(raw, "GDPS_CAPABILITY_LOCK_INVALID");
      return selectedKeys.has(operationKey({
        operationId: text(entry["operationId"], "GDPS_CAPABILITY_LOCK_INVALID"),
        operationVersion: text(entry["operationVersion"], "GDPS_CAPABILITY_LOCK_INVALID")
      }));
    });
  assertExactOperationLocks(
    selectedCapabilityLocks,
    input.selectedDatasetOperations,
    "GDPS_CAPABILITY_OPERATION_LOCK_DRIFT",
    true
  );
  const gdpsCapabilityHash = checksums.get("GDPS_CAPABILITY_LOCK.json");
  if (!gdpsCapabilityHash) throw new SegmentedScopeAuthorityError("GDPS_CAPABILITY_CHECKSUM_MISSING");
  const foundationInstanceBindingHash = sha256(bindingFile.bytes);
  const gdpsChecksumsHash = sha256(checksumsFile.bytes);

  const additionalFoundationSources: readonly TrustedOperationScopeSource[] =
    (input.additionalFoundationSources ?? []).map((source) => {
      if (source.operations.length === 0) {
        throw new SegmentedScopeAuthorityError("ADDITIONAL_FOUNDATION_OPERATIONS_REQUIRED");
      }
      return {
        role: "FOUNDATION" as const,
        dataScope: foundationDataScope,
        sourceLockHash: digest(source.sourceLockHash, "ADDITIONAL_FOUNDATION_SOURCE_HASH_INVALID"),
        operations: source.operations
      };
    });
  const sources: readonly TrustedOperationScopeSource[] = [{
      role: "FOUNDATION",
      dataScope: foundationDataScope,
      sourceLockHash: foundationSourceHash,
      operations: input.foundationOperations
    }, {
      role: "SELECTED_DATASET",
      dataScope: selectedDatasetDataScope,
      sourceLockHash: gdpsCapabilityHash,
      operations: input.selectedDatasetOperations
    }, ...additionalFoundationSources];
  return Object.freeze({
    authority: createLoadedSegmentedScopeAuthority(sources, {
      foundationInstanceBindingHash,
      gdpsChecksumsHash
    }),
    foundationDataScope,
    selectedDatasetDataScope,
    foundationInstanceBindingHash,
    gdpsChecksumsHash
  });
}
