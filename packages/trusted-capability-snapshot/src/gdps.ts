import { hashCanonicalJson } from "./canonical.js";

export const GDPS_PREVIEW_RECIPE_OPERATION_KEYS = Object.freeze({
  GDPS_LAND_COVER_AT_REFERENCE: ["reference.resolve@1.0", "world.get-current-state@1.0", "landcover.get-class@1.0"],
  GDPS_WETLANDS_IN_AREA: ["reference.resolve@1.0", "world.get-geometry@1.0", "hydrology.find-wetlands@1.0"],
  GDPS_OBSTACLES_NEAR_REFERENCE: ["reference.resolve@1.0", "world.get-current-state@1.0", "obstacle.find-nearby@1.0"],
  GDPS_BLOCKED_AREAS_IN_AREA: ["reference.resolve@1.0", "world.get-geometry@1.0", "traversability.find-blocked@1.0"],
  GDPS_HIGH_GROUND_IN_AREA: ["reference.resolve@1.0", "world.get-geometry@1.0", "terrain.find-high-ground@1.0"],
  GDPS_ELEVATION_AT_REFERENCE: ["reference.resolve@1.0", "world.get-current-state@1.0", "elevation.sample@1.0"],
  GDPS_TRAVERSABILITY_EXPLAIN_AT_REFERENCE: ["reference.resolve@1.0", "world.get-current-state@1.0", "traversability.explain@1.0"]
} as const);

export type GdpsPreviewRecipeId = keyof typeof GDPS_PREVIEW_RECIPE_OPERATION_KEYS;

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

export interface GdpsCapabilitySnapshot {
  schemaVersion: "wsgs-gdps-capability-snapshot/1.0";
  sourceCommit: string;
  providerId: "gdps.geospatial-products";
  providerVersion: "0.1.0";
  manifestHash: `sha256:${string}`;
  capturedAt: string;
  capabilities: GdpsSnapshotCapability[];
  recipeLocks: Array<{ recipeId: GdpsPreviewRecipeId; operationKeys: readonly string[]; maturity: "PREVIEW" }>;
  recipeLockHash: `sha256:${string}`;
  snapshotHash: `sha256:${string}`;
}

export interface GdpsCapabilitySnapshotInput {
  sourceCommit: string;
  providerId: string;
  providerVersion: string;
  manifestHash: string;
  capturedAt: string;
  capabilities: readonly GdpsSnapshotCapability[];
  enabledRecipeIds: readonly GdpsPreviewRecipeId[];
}

export class GdpsCapabilitySnapshotError extends Error {
  constructor(readonly code: string) {
    super(`GDPS capability snapshot is invalid: ${code}`);
  }
}

const digest = /^sha256:[0-9a-f]{64}$/u;
const operation = /^[a-z][a-z0-9.-]{2,127}$/u;

function operationKey(value: Pick<GdpsSnapshotCapability, "operationId" | "operationVersion">): string {
  return `${value.operationId}@${value.operationVersion}`;
}

export function buildGdpsCapabilitySnapshot(input: GdpsCapabilitySnapshotInput): GdpsCapabilitySnapshot {
  if (!/^[0-9a-f]{40}$/u.test(input.sourceCommit)) throw new GdpsCapabilitySnapshotError("SOURCE_COMMIT_INVALID");
  if (input.providerId !== "gdps.geospatial-products" || input.providerVersion !== "0.1.0") {
    throw new GdpsCapabilitySnapshotError("PROVIDER_IDENTITY_INVALID");
  }
  if (!digest.test(input.manifestHash)) throw new GdpsCapabilitySnapshotError("MANIFEST_HASH_INVALID");
  if (!Number.isFinite(Date.parse(input.capturedAt))) throw new GdpsCapabilitySnapshotError("CAPTURE_TIME_INVALID");
  if (input.capabilities.length !== 23) throw new GdpsCapabilitySnapshotError("CAPABILITY_COUNT_INVALID");
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
  }).sort((left, right) => operationKey(left) < operationKey(right) ? -1 : 1);
  const enabled = [...new Set(input.enabledRecipeIds)].sort();
  if (enabled.length !== input.enabledRecipeIds.length) throw new GdpsCapabilitySnapshotError("DUPLICATE_RECIPE");
  const recipeLocks = enabled.map((recipeId) => {
    const operationKeys = GDPS_PREVIEW_RECIPE_OPERATION_KEYS[recipeId];
    if (!operationKeys) throw new GdpsCapabilitySnapshotError("UNKNOWN_RECIPE");
    const gdpsKeys = operationKeys.filter((key) => !key.startsWith("reference.") && !key.startsWith("world."));
    if (gdpsKeys.some((key) => !keys.has(key))) throw new GdpsCapabilitySnapshotError("RECIPE_OPERATION_MISSING");
    return { recipeId, operationKeys, maturity: "PREVIEW" as const };
  });
  const recipeLockHash = hashCanonicalJson(recipeLocks);
  const body = {
    schemaVersion: "wsgs-gdps-capability-snapshot/1.0" as const,
    sourceCommit: input.sourceCommit,
    providerId: input.providerId as "gdps.geospatial-products",
    providerVersion: input.providerVersion as "0.1.0",
    manifestHash: input.manifestHash as `sha256:${string}`,
    capturedAt: new Date(input.capturedAt).toISOString(),
    capabilities,
    recipeLocks,
    recipeLockHash
  };
  if (/productVersion|product_version|versionId|version_id/u.test(JSON.stringify(body))) {
    throw new GdpsCapabilitySnapshotError("PRODUCT_VERSION_SEMANTICS_FORBIDDEN");
  }
  return { ...body, snapshotHash: hashCanonicalJson(body) };
}
