import type { GroundingGraph } from "@wsgs/contracts";
import { describe, expect, it } from "vitest";
import { SemanticRequirementPlanner, type WorldQueryExecutionPolicy } from "./index.js";

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
});
