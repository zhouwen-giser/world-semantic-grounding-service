import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { hashCanonicalJson } from "./canonical.js";

export interface GdpsSnapshotCapability {
  operationId: string;
  operationVersion: string;
  inputSchemaHash: `sha256:${string}`;
  outputSchemaHash: `sha256:${string}`;
  semanticProfileHash: `sha256:${string}`;
  maturity: "PREVIEW";
  availability: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
  snapshotSupport: "CONSISTENT_AT_START";
  providerBinding: string;
}

export interface GdpsLockedOperation {
  operationId: string;
  operationVersion: string;
  inputSchemaHash: `sha256:${string}`;
  outputSchemaHash: `sha256:${string}`;
  semanticProfileHash: `sha256:${string}`;
}

export interface GdpsLockedRecipe {
  schemaVersion: "wsgs-locked-gdps-recipe/2.0";
  recipeId: string;
  semanticPattern: string;
  requirementType: string;
  descriptorConstraint: {
    descriptorId: string;
    descriptorHash: `sha256:${string}`;
  } | null;
  queryProfile: string | null;
  allowedOperations: readonly GdpsLockedOperation[];
  maturityPolicy: {
    allowed: "PREVIEW";
    requiresExactHashes: true;
  };
  productIdPolicy: "UNBOUND_UNLESS_EXPLICIT" | "FORBIDDEN" | "REQUIRED";
  inputBindings: Readonly<Record<string, unknown>>;
  outputSemantics: Readonly<Record<string, unknown>>;
  previewAuthorizationRequired: true;
}

export interface GdpsRecipeLock {
  schemaVersion: "wsgs-gdps-recipe-lock/2.0";
  providerId: "gdps.geospatial-products";
  providerVersion: string;
  descriptorRegistryHash: `sha256:${string}`;
  productTypeCount: 34;
  profileCount: 35;
  capabilityLockHash: `sha256:${string}`;
  recipes: GdpsLockedRecipe[];
}

export interface LoadedGdpsRecipeLock {
  lock: GdpsRecipeLock;
  lockHash: `sha256:${string}`;
}

export interface GdpsConsumerSnapshotExtension {
  schemaVersion: "wsgs-gdps-consumer-snapshot/2.0";
  providerId: "gdps.geospatial-products";
  providerVersion: string;
  consumerLockHash: `sha256:${string}`;
  capabilityLockHash: `sha256:${string}`;
  descriptorLockHash: `sha256:${string}`;
  recipeLockHash: `sha256:${string}`;
  productTypeCount: 34;
  descriptorProfileCount: 35;
  capabilityKeys: string[];
  capabilitySnapshotHash: `sha256:${string}`;
}

export interface GdpsCapabilitySnapshot {
  schemaVersion: "wsgs-gdps-capability-snapshot/2.0";
  sourceCommit: string;
  providerId: "gdps.geospatial-products";
  providerVersion: string;
  manifestHash: `sha256:${string}`;
  consumerLockHash: `sha256:${string}`;
  capabilityLockHash: `sha256:${string}`;
  descriptorLockHash: `sha256:${string}`;
  recipeLockHash: `sha256:${string}`;
  productTypeCount: 34;
  profileCount: 35;
  capturedAt: string;
  capabilities: GdpsSnapshotCapability[];
  recipeLocks: GdpsLockedRecipe[];
  snapshotHash: `sha256:${string}`;
}

export interface GdpsCapabilitySnapshotInput {
  sourceCommit: string;
  providerId: string;
  providerVersion: string;
  manifestHash: string;
  consumerLockHash: string;
  capabilityLockHash: string;
  descriptorLockHash: string;
  recipeLockHash: string;
  productTypeCount: number;
  profileCount: number;
  capturedAt: string;
  capabilities: readonly GdpsSnapshotCapability[];
  recipes: readonly GdpsLockedRecipe[];
}

export class GdpsCapabilitySnapshotError extends Error {
  constructor(readonly code: string) {
    super(`GDPS capability snapshot is invalid: ${code}`);
  }
}

const digest = /^sha256:[0-9a-f]{64}$/u;
const operation = /^[a-z][a-z0-9.-]{2,127}$/u;
const recipeId = /^recipe-gdps-[a-z0-9-]{3,96}$/u;
const semanticPattern = /^GDPS_[A-Z0-9_]{3,120}$/u;
const requirementType = /^[A-Z][A-Z0-9_]{2,127}$/u;
const queryProfile = /^[A-Z][A-Z0-9_]{2,127}$/u;
const descriptor = /^[A-Z0-9][A-Z0-9._\/-]{1,127}$/u;
export const GDPS_RUNTIME_SEMANTIC_PATTERNS = Object.freeze([
  "GDPS_LAND_COVER_AT_REFERENCE",
  "GDPS_WETLANDS_IN_AREA",
  "GDPS_OBSTACLES_NEAR_REFERENCE",
  "GDPS_BLOCKED_AREAS_IN_AREA",
  "GDPS_HIGH_GROUND_IN_AREA",
  "GDPS_ELEVATION_AT_REFERENCE",
  "GDPS_TRAVERSABILITY_EXPLAIN_AT_REFERENCE",
  "GDPS_GENERIC_SAMPLE_VALUE",
  "GDPS_GENERIC_PROFILE_VALUE",
  "GDPS_GENERIC_FIND_CLASS",
  "GDPS_GENERIC_FIND_RANGE",
  "GDPS_GENERIC_VECTOR_IN_AREA",
  "GDPS_GENERIC_VECTOR_NEARBY",
  "GDPS_GENERIC_VECTOR_INTERSECTS"
] as const);
const exactRuntimePatterns = new Set<string>(GDPS_RUNTIME_SEMANTIC_PATTERNS);
const expectedRecipeIdByPattern: Readonly<Record<string, string>> = Object.freeze({
  GDPS_LAND_COVER_AT_REFERENCE: "recipe-gdps-land-cover-at-reference",
  GDPS_WETLANDS_IN_AREA: "recipe-gdps-wetlands-in-area",
  GDPS_OBSTACLES_NEAR_REFERENCE: "recipe-gdps-obstacles-near-reference",
  GDPS_BLOCKED_AREAS_IN_AREA: "recipe-gdps-blocked-areas-in-area",
  GDPS_HIGH_GROUND_IN_AREA: "recipe-gdps-high-ground-in-area",
  GDPS_ELEVATION_AT_REFERENCE: "recipe-gdps-elevation-at-reference",
  GDPS_TRAVERSABILITY_EXPLAIN_AT_REFERENCE: "recipe-gdps-traversability-explain-at-reference",
  GDPS_GENERIC_SAMPLE_VALUE: "recipe-gdps-generic-sample-value",
  GDPS_GENERIC_PROFILE_VALUE: "recipe-gdps-generic-profile-value",
  GDPS_GENERIC_FIND_CLASS: "recipe-gdps-generic-find-class",
  GDPS_GENERIC_FIND_RANGE: "recipe-gdps-generic-find-range",
  GDPS_GENERIC_VECTOR_IN_AREA: "recipe-gdps-generic-vector-in-area",
  GDPS_GENERIC_VECTOR_NEARBY: "recipe-gdps-generic-vector-nearby",
  GDPS_GENERIC_VECTOR_INTERSECTS: "recipe-gdps-generic-vector-intersects"
});
const consumerSnapshotKeys = [
  "schemaVersion", "providerId", "providerVersion", "consumerLockHash", "capabilityLockHash",
  "descriptorLockHash", "recipeLockHash", "productTypeCount", "descriptorProfileCount",
  "capabilityKeys", "capabilitySnapshotHash"
] as const;

function operationKey(value: Pick<GdpsSnapshotCapability, "operationId" | "operationVersion">): string {
  return `${value.operationId}@${value.operationVersion}`;
}

export function buildGdpsConsumerSnapshotExtension(input: Omit<
  GdpsConsumerSnapshotExtension,
  "schemaVersion" | "providerId" | "productTypeCount" | "descriptorProfileCount" | "capabilitySnapshotHash"
>): GdpsConsumerSnapshotExtension {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(input.providerVersion)) {
    throw new GdpsCapabilitySnapshotError("PROVIDER_IDENTITY_INVALID");
  }
  if (![input.consumerLockHash, input.capabilityLockHash, input.descriptorLockHash, input.recipeLockHash]
      .every((value) => digest.test(value))) {
    throw new GdpsCapabilitySnapshotError("SOURCE_LOCK_HASH_INVALID");
  }
  if (input.capabilityKeys.length !== 30 || new Set(input.capabilityKeys).size !== 30 ||
      input.capabilityKeys.some((key) => !/^[a-z][a-z0-9.-]{2,127}@\d+\.\d+$/u.test(key))) {
    throw new GdpsCapabilitySnapshotError("CAPABILITY_COUNT_INVALID");
  }
  const body = {
    schemaVersion: "wsgs-gdps-consumer-snapshot/2.0" as const,
    providerId: "gdps.geospatial-products" as const,
    providerVersion: input.providerVersion,
    consumerLockHash: input.consumerLockHash,
    capabilityLockHash: input.capabilityLockHash,
    descriptorLockHash: input.descriptorLockHash,
    recipeLockHash: input.recipeLockHash,
    productTypeCount: 34 as const,
    descriptorProfileCount: 35 as const,
    capabilityKeys: [...input.capabilityKeys].sort()
  };
  return { ...body, capabilitySnapshotHash: hashCanonicalJson(body) };
}

export function verifyGdpsConsumerSnapshotExtension(value: GdpsConsumerSnapshotExtension): GdpsConsumerSnapshotExtension {
  if (!value || typeof value !== "object" ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...consumerSnapshotKeys].sort())) {
    throw new GdpsCapabilitySnapshotError("CONSUMER_SNAPSHOT_CONTRACT_INVALID");
  }
  const rebuilt = buildGdpsConsumerSnapshotExtension({
    providerVersion: value.providerVersion,
    consumerLockHash: value.consumerLockHash,
    capabilityLockHash: value.capabilityLockHash,
    descriptorLockHash: value.descriptorLockHash,
    recipeLockHash: value.recipeLockHash,
    capabilityKeys: value.capabilityKeys
  });
  if (value.schemaVersion !== rebuilt.schemaVersion || value.providerId !== rebuilt.providerId ||
      value.productTypeCount !== 34 || value.descriptorProfileCount !== 35 ||
      value.capabilitySnapshotHash !== rebuilt.capabilitySnapshotHash ||
      JSON.stringify(value.capabilityKeys) !== JSON.stringify(rebuilt.capabilityKeys)) {
    throw new GdpsCapabilitySnapshotError("CONSUMER_SNAPSHOT_INTEGRITY_MISMATCH");
  }
  return structuredClone(value);
}

export function loadGdpsConsumerSnapshotExtension(options: {
  snapshotPath: string;
  expectedSha256: `sha256:${string}`;
}): GdpsConsumerSnapshotExtension {
  if (!digest.test(options.expectedSha256)) {
    throw new GdpsCapabilitySnapshotError("CONSUMER_SNAPSHOT_EXPECTED_HASH_INVALID");
  }
  const bytes = readFileSync(options.snapshotPath);
  const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
  if (actual !== options.expectedSha256) {
    throw new GdpsCapabilitySnapshotError("CONSUMER_SNAPSHOT_FILE_INTEGRITY_MISMATCH");
  }
  try {
    return verifyGdpsConsumerSnapshotExtension(JSON.parse(bytes.toString("utf8")) as GdpsConsumerSnapshotExtension);
  } catch (error) {
    if (error instanceof GdpsCapabilitySnapshotError) throw error;
    throw new GdpsCapabilitySnapshotError("CONSUMER_SNAPSHOT_JSON_INVALID");
  }
}

function validateLockedRecipe(entry: GdpsLockedRecipe, capabilityByKey?: ReadonlyMap<string, GdpsSnapshotCapability>): GdpsLockedRecipe {
  if (entry.schemaVersion !== "wsgs-locked-gdps-recipe/2.0" || !recipeId.test(entry.recipeId) ||
      !semanticPattern.test(entry.semanticPattern) || !requirementType.test(entry.requirementType) ||
      (entry.queryProfile !== null && !queryProfile.test(entry.queryProfile))) {
    throw new GdpsCapabilitySnapshotError("RECIPE_ID_INVALID");
  }
  if (expectedRecipeIdByPattern[entry.semanticPattern] !== entry.recipeId) {
    throw new GdpsCapabilitySnapshotError("RECIPE_BINDING_INVALID");
  }
  if (entry.descriptorConstraint && (!descriptor.test(entry.descriptorConstraint.descriptorId) ||
      !digest.test(entry.descriptorConstraint.descriptorHash))) {
    throw new GdpsCapabilitySnapshotError("DESCRIPTOR_BINDING_INVALID");
  }
  if (entry.previewAuthorizationRequired !== true || entry.maturityPolicy?.allowed !== "PREVIEW" ||
      entry.maturityPolicy.requiresExactHashes !== true ||
      !["UNBOUND_UNLESS_EXPLICIT", "FORBIDDEN", "REQUIRED"].includes(entry.productIdPolicy) ||
      entry.allowedOperations.length === 0 || !entry.inputBindings || typeof entry.inputBindings !== "object" ||
      Array.isArray(entry.inputBindings) || !entry.outputSemantics || typeof entry.outputSemantics !== "object" ||
      Array.isArray(entry.outputSemantics)) {
    throw new GdpsCapabilitySnapshotError("RECIPE_POLICY_INVALID");
  }
  const allowedByKey = new Map<string, GdpsLockedOperation>();
  for (const allowed of entry.allowedOperations) {
    const key = operationKey(allowed);
    if (!operation.test(allowed.operationId) || !/^\d+\.\d+$/u.test(allowed.operationVersion) ||
        ![allowed.inputSchemaHash, allowed.outputSchemaHash, allowed.semanticProfileHash].every((value) => digest.test(value))) {
      throw new GdpsCapabilitySnapshotError("RECIPE_OPERATION_LOCK_INVALID");
    }
    if (allowedByKey.has(key)) throw new GdpsCapabilitySnapshotError("DUPLICATE_RECIPE_OPERATION_LOCK");
    allowedByKey.set(key, allowed);
  }
  for (const [key, allowed] of allowedByKey) {
    const capability = capabilityByKey?.get(key);
    if (capabilityByKey && !capability) {
      throw new GdpsCapabilitySnapshotError("RECIPE_OPERATION_MISSING");
    }
    if (capability && (capability.inputSchemaHash !== allowed.inputSchemaHash ||
        capability.outputSchemaHash !== allowed.outputSchemaHash ||
        capability.semanticProfileHash !== allowed.semanticProfileHash)) {
      throw new GdpsCapabilitySnapshotError("RECIPE_OPERATION_HASH_DRIFT");
    }
  }
  return structuredClone(entry);
}

export function loadGdpsRecipeLock(options: {
  lockPath: string;
  expectedSha256: `sha256:${string}`;
}): LoadedGdpsRecipeLock {
  if (!digest.test(options.expectedSha256)) throw new GdpsCapabilitySnapshotError("RECIPE_LOCK_EXPECTED_HASH_INVALID");
  const bytes = readFileSync(options.lockPath);
  const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
  if (actual !== options.expectedSha256) throw new GdpsCapabilitySnapshotError("RECIPE_LOCK_INTEGRITY_MISMATCH");
  let lock: GdpsRecipeLock;
  try {
    lock = JSON.parse(bytes.toString("utf8")) as GdpsRecipeLock;
  } catch {
    throw new GdpsCapabilitySnapshotError("RECIPE_LOCK_JSON_INVALID");
  }
  if (lock.schemaVersion !== "wsgs-gdps-recipe-lock/2.0" || lock.providerId !== "gdps.geospatial-products" ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(lock.providerVersion) ||
      !digest.test(lock.descriptorRegistryHash) || !digest.test(lock.capabilityLockHash) ||
      lock.productTypeCount !== 34 || lock.profileCount !== 35 || lock.recipes.length !== 14) {
    throw new GdpsCapabilitySnapshotError("RECIPE_LOCK_CONTRACT_INVALID");
  }
  const ids = new Set<string>();
  const patterns = new Set<string>();
  const recipes = lock.recipes.map((entry) => {
    if (ids.has(entry.recipeId) || patterns.has(entry.semanticPattern)) {
      throw new GdpsCapabilitySnapshotError("DUPLICATE_RECIPE");
    }
    ids.add(entry.recipeId);
    patterns.add(entry.semanticPattern);
    return validateLockedRecipe(entry);
  }).sort((left, right) => left.recipeId.localeCompare(right.recipeId));
  if (patterns.size !== exactRuntimePatterns.size ||
      [...patterns].some((pattern) => !exactRuntimePatterns.has(pattern))) {
    throw new GdpsCapabilitySnapshotError("RECIPE_PATTERN_SET_INVALID");
  }
  return { lock: { ...lock, recipes }, lockHash: actual };
}

export function buildGdpsCapabilitySnapshot(input: GdpsCapabilitySnapshotInput): GdpsCapabilitySnapshot {
  if (!/^[0-9a-f]{40}$/u.test(input.sourceCommit)) throw new GdpsCapabilitySnapshotError("SOURCE_COMMIT_INVALID");
  if (input.providerId !== "gdps.geospatial-products" ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(input.providerVersion)) {
    throw new GdpsCapabilitySnapshotError("PROVIDER_IDENTITY_INVALID");
  }
  if (![input.manifestHash, input.consumerLockHash, input.capabilityLockHash, input.descriptorLockHash, input.recipeLockHash]
      .every((value) => digest.test(value))) {
    throw new GdpsCapabilitySnapshotError("SOURCE_LOCK_HASH_INVALID");
  }
  if (input.productTypeCount !== 34 || input.profileCount !== 35) {
    throw new GdpsCapabilitySnapshotError("DESCRIPTOR_COUNT_INVALID");
  }
  if (!Number.isFinite(Date.parse(input.capturedAt))) throw new GdpsCapabilitySnapshotError("CAPTURE_TIME_INVALID");
  if (input.capabilities.length !== 30) throw new GdpsCapabilitySnapshotError("CAPABILITY_COUNT_INVALID");
  const keys = new Set<string>();
  const capabilities = input.capabilities.map((entry) => {
    if (!operation.test(entry.operationId) || !/^\d+\.\d+$/u.test(entry.operationVersion)) {
      throw new GdpsCapabilitySnapshotError("OPERATION_KEY_INVALID");
    }
    const key = operationKey(entry);
    if (keys.has(key)) throw new GdpsCapabilitySnapshotError("DUPLICATE_OPERATION");
    keys.add(key);
    if (![entry.inputSchemaHash, entry.outputSchemaHash, entry.semanticProfileHash].every((value) => digest.test(value))) {
      throw new GdpsCapabilitySnapshotError("CAPABILITY_HASH_INVALID");
    }
    if (entry.maturity !== "PREVIEW" || entry.snapshotSupport !== "CONSISTENT_AT_START") {
      throw new GdpsCapabilitySnapshotError("CAPABILITY_POLICY_INVALID");
    }
    if (entry.providerBinding !== input.providerId) throw new GdpsCapabilitySnapshotError("PROVIDER_BINDING_INVALID");
    return structuredClone(entry);
  }).sort((left, right) => operationKey(left).localeCompare(operationKey(right)));
  const capabilityByKey = new Map(capabilities.map((entry) => [operationKey(entry), entry]));
  if (input.recipes.length !== 14) throw new GdpsCapabilitySnapshotError("RECIPE_COUNT_INVALID");
  const recipeIds = new Set<string>();
  const patterns = new Set<string>();
  const recipeLocks = input.recipes.map((entry) => {
    if (recipeIds.has(entry.recipeId) || patterns.has(entry.semanticPattern)) {
      throw new GdpsCapabilitySnapshotError("DUPLICATE_RECIPE");
    }
    recipeIds.add(entry.recipeId);
    patterns.add(entry.semanticPattern);
    return validateLockedRecipe(entry, capabilityByKey);
  }).sort((left, right) => left.recipeId.localeCompare(right.recipeId));
  if (patterns.size !== exactRuntimePatterns.size ||
      [...patterns].some((pattern) => !exactRuntimePatterns.has(pattern))) {
    throw new GdpsCapabilitySnapshotError("RECIPE_PATTERN_SET_INVALID");
  }
  const body = {
    schemaVersion: "wsgs-gdps-capability-snapshot/2.0" as const,
    sourceCommit: input.sourceCommit,
    providerId: input.providerId as "gdps.geospatial-products",
    providerVersion: input.providerVersion,
    manifestHash: input.manifestHash as `sha256:${string}`,
    consumerLockHash: input.consumerLockHash as `sha256:${string}`,
    capabilityLockHash: input.capabilityLockHash as `sha256:${string}`,
    descriptorLockHash: input.descriptorLockHash as `sha256:${string}`,
    recipeLockHash: input.recipeLockHash as `sha256:${string}`,
    productTypeCount: 34 as const,
    profileCount: 35 as const,
    capturedAt: new Date(input.capturedAt).toISOString(),
    capabilities,
    recipeLocks
  };
  if (/productVersion|product_version|versionId|version_id/u.test(JSON.stringify(body))) {
    throw new GdpsCapabilitySnapshotError("PRODUCT_VERSION_SEMANTICS_FORBIDDEN");
  }
  return { ...body, snapshotHash: hashCanonicalJson(body) };
}
