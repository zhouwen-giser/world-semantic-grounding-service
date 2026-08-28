import { describe, expect, it } from "vitest";
import { buildGdpsCapabilitySnapshot, GDPS_PREVIEW_RECIPE_OPERATION_KEYS, type GdpsSnapshotCapability } from "./gdps.js";

const digest = (seed: number): `sha256:${string}` => `sha256:${seed.toString(16).padStart(64, "0")}`;
const operationIds = [
  "geo-product.get", "geo-product.search", "geo-product.check-current", "elevation.sample", "elevation.profile",
  "elevation.sample-surface", "terrain.get-class", "terrain.find-by-class", "terrain.find-high-ground",
  "terrain.find-depressions", "landcover.get-class", "landcover.find-by-class", "hydrology.find-water",
  "hydrology.find-wetlands", "surface-material.get", "surface-material.find-by-class", "obstacle.find-buildings",
  "obstacle.find-nearby", "obstacle.find-intersections", "traversability.get", "traversability.find-passable",
  "traversability.find-blocked", "traversability.explain"
];

function capabilities(): GdpsSnapshotCapability[] {
  return operationIds.map((operationId, index) => ({
    operationId,
    operationVersion: "1.0",
    inputSchemaHash: digest(index * 3 + 1),
    outputSchemaHash: digest(index * 3 + 2),
    semanticProfileHash: digest(index * 3 + 3),
    maturity: "PREVIEW",
    availability: "AVAILABLE",
    snapshotSupport: "CONSISTENT_AT_START",
    providerBinding: "gdps.geospatial-products"
  }));
}

describe("GDPS trusted capability snapshot", () => {
  it("locks all 23 contracts and seven explicit recipes", () => {
    const snapshot = buildGdpsCapabilitySnapshot({
      sourceCommit: "a".repeat(40),
      providerId: "gdps.geospatial-products",
      providerVersion: "0.1.0",
      manifestHash: digest(999),
      capturedAt: "2026-08-28T00:00:00.000Z",
      capabilities: capabilities(),
      enabledRecipeIds: Object.keys(GDPS_PREVIEW_RECIPE_OPERATION_KEYS) as Array<keyof typeof GDPS_PREVIEW_RECIPE_OPERATION_KEYS>
    });
    expect(snapshot.capabilities).toHaveLength(23);
    expect(snapshot.recipeLocks).toHaveLength(7);
    expect(snapshot.snapshotHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(snapshot)).not.toMatch(/productVersion|product_version|versionId|version_id/u);
  });

  it("fails closed on a missing recipe operation", () => {
    expect(() => buildGdpsCapabilitySnapshot({
      sourceCommit: "a".repeat(40),
      providerId: "gdps.geospatial-products",
      providerVersion: "0.1.0",
      manifestHash: digest(999),
      capturedAt: "2026-08-28T00:00:00.000Z",
      capabilities: capabilities().map((entry) => entry.operationId === "terrain.find-high-ground"
        ? { ...entry, operationId: "terrain.missing-high-ground" } : entry),
      enabledRecipeIds: ["GDPS_HIGH_GROUND_IN_AREA"]
    })).toThrow("RECIPE_OPERATION_MISSING");
  });
});
