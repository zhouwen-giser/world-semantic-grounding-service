import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  buildGdpsConsumerSnapshotExtension,
  buildGdpsCapabilitySnapshot,
  GDPS_RUNTIME_SEMANTIC_PATTERNS,
  loadGdpsConsumerSnapshotExtension,
  loadGdpsRecipeLock,
  type GdpsLockedRecipe,
  type GdpsSnapshotCapability
} from "./gdps.js";
import { hashExactBytes } from "./canonical.js";

const digest = (seed: number): `sha256:${string}` => `sha256:${seed.toString(16).padStart(64, "0")}`;
const genericOperations = [
  "geo-raster.sample", "geo-raster.profile", "geo-raster.find-by-class", "geo-raster.find-by-range",
  "geo-vector.find-in-area", "geo-vector.find-nearby", "geo-vector.find-intersections"
];
const operationIds = [
  "geo-product.get", "geo-product.search", "geo-product.check-current", "elevation.sample", "elevation.profile",
  "elevation.sample-surface", "terrain.get-class", "terrain.find-by-class", "terrain.find-high-ground",
  "terrain.find-depressions", "landcover.get-class", "landcover.find-by-class", "hydrology.find-water",
  "hydrology.find-wetlands", "surface-material.get", "surface-material.find-by-class", "obstacle.find-buildings",
  "obstacle.find-nearby", "obstacle.find-intersections", "traversability.get", "traversability.find-passable",
  "traversability.find-blocked", "traversability.explain", ...genericOperations
];

function capabilities(): GdpsSnapshotCapability[] {
  return operationIds.map((operationId, index) => ({
    operationId,
    operationVersion: "1.0",
    inputSchemaHash: digest(index * 3 + 1),
    outputSchemaHash: digest(index * 3 + 2),
    semanticProfileHash: digest(index * 3 + 3),
    maturity: "PREVIEW",
    availability: index === 29 ? "UNAVAILABLE" : "AVAILABLE",
    snapshotSupport: "CONSISTENT_AT_START",
    providerBinding: "gdps.geospatial-products"
  }));
}

function recipes(entries = capabilities()): GdpsLockedRecipe[] {
  return operationIds.slice(0, 7).concat(genericOperations).map((operationId, index) => {
    const capability = entries.find((entry) => entry.operationId === operationId)!;
    const pattern = GDPS_RUNTIME_SEMANTIC_PATTERNS[index]!;
    return {
      schemaVersion: "wsgs-locked-gdps-recipe/2.0",
      recipeId: `recipe-${pattern.toLowerCase().replaceAll("_", "-")}`,
      semanticPattern: pattern,
      requirementType: `READ_GDPS_TEST_${index + 1}`,
      descriptorConstraint: index < 7 ? {
        descriptorId: `PRODUCT_${index + 1}/DEFAULT`,
        descriptorHash: digest(500 + index)
      } : null,
      queryProfile: index < 7 ? null : `QUERY_PROFILE_${index + 1}`,
      previewAuthorizationRequired: true,
      maturityPolicy: { allowed: "PREVIEW", requiresExactHashes: true },
      productIdPolicy: "UNBOUND_UNLESS_EXPLICIT",
      inputBindings: { operationId },
      outputSemantics: { currentOnly: true },
      allowedOperations: [{
        operationId,
        operationVersion: "1.0",
        inputSchemaHash: capability.inputSchemaHash,
        outputSchemaHash: capability.outputSchemaHash,
        semanticProfileHash: capability.semanticProfileHash
      }]
    };
  });
}

function input() {
  return {
    sourceCommit: "a".repeat(40),
    providerId: "gdps.geospatial-products",
    providerVersion: "0.2.1",
    manifestHash: digest(900),
    consumerLockHash: digest(901),
    capabilityLockHash: digest(902),
    descriptorLockHash: digest(903),
    recipeLockHash: digest(904),
    productTypeCount: 34,
    profileCount: 35,
    capturedAt: "2026-08-29T00:00:00.000Z",
    capabilities: capabilities(),
    recipes: recipes()
  };
}

describe("GDPS trusted capability snapshot", () => {
  it("builds and byte-locks the exact 30-key consumer snapshot extension", () => {
    const extension = buildGdpsConsumerSnapshotExtension({
      providerVersion: "0.2.1",
      consumerLockHash: digest(901),
      capabilityLockHash: digest(902),
      descriptorLockHash: digest(903),
      recipeLockHash: digest(904),
      capabilityKeys: capabilities().map((entry) => `${entry.operationId}@${entry.operationVersion}`).reverse()
    });
    expect(extension.capabilityKeys).toHaveLength(30);
    expect(extension.capabilityKeys).toEqual([...extension.capabilityKeys].sort());
    expect(extension.capabilitySnapshotHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const bytes = Buffer.from(`${JSON.stringify(extension, null, 2)}\n`, "utf8");
    const directory = mkdtempSync(join(tmpdir(), "wsgs-gdps-consumer-snapshot-"));
    const path = join(directory, "snapshot.json");
    writeFileSync(path, bytes);
    expect(loadGdpsConsumerSnapshotExtension({ snapshotPath: path, expectedSha256: hashExactBytes(bytes) }))
      .toEqual(extension);
    expect(() => loadGdpsConsumerSnapshotExtension({ snapshotPath: path, expectedSha256: digest(999) }))
      .toThrow("CONSUMER_SNAPSHOT_FILE_INTEGRITY_MISMATCH");
  });

  it("locks 30 contracts and fourteen descriptor-driven recipes without conflating availability", () => {
    const snapshot = buildGdpsCapabilitySnapshot(input());
    expect(snapshot.capabilities).toHaveLength(30);
    expect(snapshot.recipeLocks).toHaveLength(14);
    expect(snapshot.capabilities.filter((entry) => entry.availability === "UNAVAILABLE")).toHaveLength(1);
    expect(snapshot.snapshotHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(snapshot)).not.toMatch(/productVersion|product_version|versionId|version_id/u);
  });

  it("fails closed on recipe hash drift", () => {
    const value = input();
    const first = value.recipes[0]!;
    value.recipes[0] = {
      ...first,
      allowedOperations: [{ ...first.allowedOperations[0]!, inputSchemaHash: digest(999) }]
    };
    expect(() => buildGdpsCapabilitySnapshot(value)).toThrow("RECIPE_OPERATION_HASH_DRIFT");
  });

  it("verifies an exact external recipe-lock byte hash", () => {
    const value = input();
    const lock = {
      schemaVersion: "wsgs-gdps-recipe-lock/2.0",
      providerId: "gdps.geospatial-products",
      providerVersion: "0.2.1",
      descriptorRegistryHash: value.descriptorLockHash,
      productTypeCount: 34,
      profileCount: 35,
      capabilityLockHash: value.capabilityLockHash,
      recipes: value.recipes
    };
    const bytes = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, "utf8");
    const directory = mkdtempSync(join(tmpdir(), "wsgs-gdps-lock-"));
    const path = join(directory, "recipe-lock.json");
    writeFileSync(path, bytes);
    const loaded = loadGdpsRecipeLock({ lockPath: path, expectedSha256: hashExactBytes(bytes) });
    expect(loaded.lock.recipes).toHaveLength(14);
    expect(loaded.lockHash).toBe(hashExactBytes(bytes));
    expect(() => loadGdpsRecipeLock({ lockPath: path, expectedSha256: digest(999) }))
      .toThrow("RECIPE_LOCK_INTEGRITY_MISMATCH");
  });

  it("rejects a fourteen-entry lock with a substituted semantic pattern", () => {
    const value = input();
    value.recipes[0] = { ...value.recipes[0]!, semanticPattern: "GDPS_UNAUTHORIZED_PATTERN" };
    const lock = {
      schemaVersion: "wsgs-gdps-recipe-lock/2.0",
      providerId: "gdps.geospatial-products",
      providerVersion: "0.2.1",
      descriptorRegistryHash: value.descriptorLockHash,
      productTypeCount: 34,
      profileCount: 35,
      capabilityLockHash: value.capabilityLockHash,
      recipes: value.recipes
    };
    const bytes = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, "utf8");
    const directory = mkdtempSync(join(tmpdir(), "wsgs-gdps-pattern-lock-"));
    const path = join(directory, "recipe-lock.json");
    writeFileSync(path, bytes);
    expect(() => loadGdpsRecipeLock({ lockPath: path, expectedSha256: hashExactBytes(bytes) }))
      .toThrow("RECIPE_BINDING_INVALID");
  });
});
