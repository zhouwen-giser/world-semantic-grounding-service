import type { GroundingGraph } from "@wsgs/contracts";
import { describe, expect, it } from "vitest";
import { SemanticRequirementPlanner, type WorldQueryExecutionPolicy } from "./index.js";
import type { GroundedGeospatialProductIntent } from "@wsgs/gdps-descriptor-consumer";

const policy: WorldQueryExecutionPolicy = {
  readOnly: true,
  deadlineMs: 30_000,
  maxQueryOperations: 16,
  maxCandidatesPerMention: 20,
  maxResultBytes: 1_048_576,
  allowApproximation: false
};

function operation(nodeId: string, expression: Record<string, unknown>): GroundingGraph["nodes"][number] {
  return { nodeId, kind: "SEMANTIC_OPERATION", payload: { category: "RELATION", expression, source: "DOMAIN_MODEL" } };
}

function plan(...operations: GroundingGraph["nodes"]): ReturnType<SemanticRequirementPlanner["plan"]> {
  return new SemanticRequirementPlanner().plan({
    groundingGraph: {
      schemaVersion: "1.0",
      nodes: [{ nodeId: "mention-area", kind: "MENTION", payload: { mentionId: "area", expectedKinds: ["LAYER_FEATURE"] } }, ...operations],
      edges: []
    },
    requestedProducts: ["WORLD_EVIDENCE"],
    executionPolicy: policy
  });
}

describe("GDPS semantic requirement planning", () => {
  it.each([
    ["LAND_COVER_AT_LOCATION", "GDPS_LAND_COVER_AT_REFERENCE", "READ_LAND_COVER"],
    ["FIND_WETLANDS", "GDPS_WETLANDS_IN_AREA", "FIND_WETLANDS"],
    ["FIND_OBSTACLES", "GDPS_OBSTACLES_NEAR_REFERENCE", "FIND_OBSTACLES"],
    ["FIND_BLOCKED_AREAS", "GDPS_BLOCKED_AREAS_IN_AREA", "FIND_BLOCKED_AREAS"],
    ["FIND_HIGH_GROUND", "GDPS_HIGH_GROUND_IN_AREA", "FIND_HIGH_GROUND"],
    ["ELEVATION_AT_LOCATION", "GDPS_ELEVATION_AT_REFERENCE", "READ_ELEVATION"],
    ["EXPLAIN_TRAVERSABILITY", "GDPS_TRAVERSABILITY_EXPLAIN_AT_REFERENCE", "EXPLAIN_TRAVERSABILITY"]
  ])("maps %s to semantic recipe %s", (relationType, recipeId, requirementType) => {
    const spatial = ["FIND_WETLANDS", "FIND_BLOCKED_AREAS", "FIND_HIGH_GROUND"].includes(relationType)
      ? [operation("within", { operator: "WITHIN", arguments: ["area"] })]
      : relationType === "FIND_OBSTACLES"
        ? [operation("near", { operator: "NEAR", arguments: ["area"], distanceMm: 500_000 })]
        : [];
    const result = plan(operation("domain", { relationType }), ...spatial);
    expect(result.selectedRecipeIds).toEqual([recipeId]);
    expect(result.graph?.requirements.map((entry) => entry.requirementType)).toContain(requirementType);
    expect(JSON.stringify(result.graph)).not.toMatch(/operationId|providerId|providerUrl|https?:\/\//u);
  });

  it("carries an explicit product preference but never fabricates one", () => {
    const explicit = plan(
      operation("domain", { relationType: "FIND_HIGH_GROUND" }),
      operation("within", { operator: "WITHIN", arguments: ["area"] }),
      operation("product", { relationType: "EXPLICIT_PRODUCT_PREFERENCE:terrain-main" })
    );
    const requirement = explicit.graph?.requirements.find((entry) => entry.requirementType === "FIND_HIGH_GROUND");
    expect(requirement?.inputs["explicitProductIds"]).toEqual(["terrain-main"]);
    const implicit = plan(operation("domain", { relationType: "FIND_HIGH_GROUND" }),
      operation("within", { operator: "WITHIN", arguments: ["area"] }));
    expect(JSON.stringify(implicit.graph)).not.toContain("terrain-main");
  });

  it.each([
    ["SAMPLE_VALUE", "GDPS_GENERIC_SAMPLE_VALUE", "READ_GEO_PRODUCT_VALUE"],
    ["PROFILE_VALUE", "GDPS_GENERIC_PROFILE_VALUE", "READ_GEO_PRODUCT_PROFILE"],
    ["FIND_CLASS", "GDPS_GENERIC_FIND_CLASS", "FIND_GEO_PRODUCT_CLASS_AREAS"],
    ["FIND_VALUE_RANGE", "GDPS_GENERIC_FIND_RANGE", "FIND_GEO_PRODUCT_VALUE_RANGE_AREAS"],
    ["VECTOR_IN_AREA", "GDPS_GENERIC_VECTOR_IN_AREA", "FIND_GEO_VECTOR_FEATURES_IN_AREA"],
    ["VECTOR_NEARBY", "GDPS_GENERIC_VECTOR_NEARBY", "FIND_GEO_VECTOR_FEATURES_NEARBY"],
    ["VECTOR_INTERSECTS", "GDPS_GENERIC_VECTOR_INTERSECTS", "FIND_GEO_VECTOR_INTERSECTIONS"]
  ] as const)("plans descriptor-bound %s without concrete operation ids", (queryProfile, recipeId, requirementType) => {
    const representation = queryProfile.startsWith("VECTOR_") ? "VECTOR_FEATURE"
      : queryProfile === "FIND_CLASS" ? "RASTER_CATEGORICAL" : "RASTER_CONTINUOUS";
    const grounded: GroundedGeospatialProductIntent = {
      schemaVersion: "wsgs-grounded-geospatial-product-intent/1.0",
      intentId: `intent-${queryProfile.toLowerCase()}`,
      descriptorId: queryProfile.startsWith("VECTOR_") ? "DRAINAGE_NETWORK/DRAINAGE_FEATURES" : "SLOPE/DEGREE",
      descriptorHash: `sha256:${"a".repeat(64)}`,
      productType: queryProfile.startsWith("VECTOR_") ? "DRAINAGE_NETWORK" : "SLOPE",
      productProfile: queryProfile.startsWith("VECTOR_") ? "DRAINAGE_FEATURES" : "DEGREE",
      representation,
      queryProfile,
      sourceNodeIds: ["domain"]
    };
    const result = new SemanticRequirementPlanner().plan({
      groundingGraph: {
        schemaVersion: "1.0",
        nodes: [
          { nodeId: "mention-area", kind: "MENTION", payload: { mentionId: "area", expectedKinds: ["LAYER_FEATURE"] } },
          operation("domain", { relationType: queryProfile.startsWith("VECTOR_") ? "DRAINAGE_NETWORK" : "SLOPE" })
        ],
        edges: []
      },
      groundedProductIntents: [grounded],
      requestedProducts: ["WORLD_EVIDENCE"],
      executionPolicy: policy
    });
    expect(result.status).toBe("PLANNED");
    expect(result.selectedRecipeIds).toEqual([recipeId]);
    expect(result.graph?.requirements.map((entry) => entry.requirementType)).toContain(requirementType);
    const descriptorRequirement = result.graph?.requirements.find((entry) => entry.requirementType === requirementType);
    expect(descriptorRequirement?.inputs).toMatchObject({
      descriptorIntents: [expect.objectContaining({ descriptorId: grounded.descriptorId, descriptorHash: grounded.descriptorHash })]
    });
    expect(JSON.stringify(result.graph)).not.toMatch(/operationId|providerId|geo-raster\.|geo-vector\./u);
  });

  it("prefers an exact specialized recipe without also selecting its generic fallback", () => {
    const grounded: GroundedGeospatialProductIntent = {
      schemaVersion: "wsgs-grounded-geospatial-product-intent/1.0",
      intentId: "intent-land-cover",
      descriptorId: "LAND_COVER/DEFAULT",
      descriptorHash: `sha256:${"b".repeat(64)}`,
      productType: "LAND_COVER",
      productProfile: "DEFAULT",
      representation: "RASTER_CATEGORICAL",
      queryProfile: "SAMPLE_CLASS",
      sourceNodeIds: ["domain"]
    };
    const result = new SemanticRequirementPlanner().plan({
      groundingGraph: {
        schemaVersion: "1.0",
        nodes: [
          { nodeId: "mention-area", kind: "MENTION", payload: { mentionId: "area", expectedKinds: ["LAYER_FEATURE"] } },
          operation("domain", { relationType: "LAND_COVER_AT_LOCATION" })
        ],
        edges: []
      },
      groundedProductIntents: [grounded],
      requestedProducts: ["WORLD_EVIDENCE"],
      executionPolicy: policy
    });

    expect(result.status).toBe("PLANNED");
    expect(result.selectedRecipeIds).toEqual(["GDPS_LAND_COVER_AT_REFERENCE"]);
    expect(result.selectedRecipeIds).not.toContain("GDPS_GENERIC_SAMPLE_VALUE");
    expect(result.graph?.requirements.map((entry) => entry.requirementType)).toContain("READ_LAND_COVER");
    expect(result.graph?.requirements.map((entry) => entry.requirementType)).not.toContain("READ_GEO_PRODUCT_VALUE");
  });
});
