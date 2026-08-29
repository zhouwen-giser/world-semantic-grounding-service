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
  recipeId: string;
  semanticPattern: string;
  descriptorConstraint: {
    descriptorId: string;
    descriptorHash: `sha256:${string}`;
  } | null;
  previewAuthorizationRequired: true;
  maturity: "PREVIEW";
  operationKeys: readonly string[];
  allowedOperations: readonly GdpsLockedOperation[];
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
const descriptor = /^[A-Z0-9][A-Z0-9._\/-]{1,127}$/u;

function operationKey(value: Pick<GdpsSnapshotCapability, "operationId" | "operationVersion">): string {
  return `${value.operationId}@${value.operationVersion}`;
}

function validateLockedRecipe(entry: GdpsLockedRecipe, capabilityByKey?: ReadonlyMap<string, GdpsSnapshotCapability>): GdpsLockedRecipe {
  if (!recipeId.test(entry.recipeId) || !semanticPattern.test(entry.semanticPattern)) {
    throw new GdpsCapabilitySnapshotError("RECIPE_ID_INVALID");
  }
  if (entry.descriptorConstraint && (!descriptor.test(entry.descriptorConstraint.descriptorId) ||
      !digest.test(entry.descriptorConstraint.descriptorHash))) {
    throw new GdpsCapabilitySnapshotError("DESCRIPTOR_BINDING_INVALID");
  }
  if (entry.previewAuthorizationRequired !== true || entry.maturity !== "PREVIEW" || entry.operationKeys.length === 0) {
    throw new GdpsCapabilitySnapshotError("RECIPE_POLICY_INVALID");
  }
  if (new Set(entry.operationKeys).size !== entry.operationKeys.length) {
    throw new GdpsCapabilitySnapshotError("DUPLICATE_RECIPE_OPERATION");
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
  for (const key of entry.operationKeys) {
    if (key.startsWith("reference.") || key.startsWith("world.")) continue;
    const allowed = allowedByKey.get(key);
    const capability = capabilityByKey?.get(key);
    if (!allowed || (capabilityByKey && !capability)) {
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
