import type { GroundingGraph } from "@wsgs/contracts";
import { describe, expect, it } from "vitest";

import {
  canonicalRequirementGraphHash,
  requestedProducts,
  requirementTypes,
  SemanticRequirementPlanner,
  stableRecipeCatalog,
  validateWorldQueryRequirementGraph,
  type RequirementPlanningResult,
  type WorldQueryExecutionPolicy,
  type WorldQueryRequirementGraph
} from "./index.js";

const policy: WorldQueryExecutionPolicy = {
  readOnly: true,
  deadlineMs: 30_000,
  maxQueryOperations: 64,
  maxCandidatesPerMention: 20,
  maxResultBytes: 1_048_576,
  allowApproximation: false
};

function graph(...nodes: GroundingGraph["nodes"]): GroundingGraph {
  return { schemaVersion: "1.0", nodes, edges: [] };
}

function mention(nodeId = "mention-vehicle"): GroundingGraph["nodes"][number] {
  return {
    nodeId,
    kind: "MENTION",
    payload: { mentionId: nodeId, expectedKinds: ["VEHICLE"] }
  };
}

function semanticOperation(
  nodeId: string,
  expression: Record<string, unknown>,
  extraPayload: Record<string, unknown> = {}
): GroundingGraph["nodes"][number] {
  return {
    nodeId,
    kind: "SEMANTIC_OPERATION",
    payload: { category: "RELATION", expression, source: "DOMAIN_MODEL", ...extraPayload }
  };
}

function plan(
  groundingGraph: GroundingGraph,
  products: string[] = ["WORLD_EVIDENCE"],
  executionPolicy: WorldQueryExecutionPolicy = policy
): RequirementPlanningResult {
  return new SemanticRequirementPlanner().plan({ groundingGraph, requestedProducts: products, executionPolicy });
}

function plannedGraph(result: RequirementPlanningResult): WorldQueryRequirementGraph {
  expect(result.graph).not.toBeNull();
  return result.graph!;
}

describe("SemanticRequirementPlanner", () => {
  it("AC-Q001 emits only operation/provider/URL/SQL-neutral requirements", () => {
    const result = plan(graph(
      mention(),
      semanticOperation("semantic-current", { relationType: "CURRENT_STATE" }, {
        operationId: "forbidden.operation",
        providerId: "forbidden-provider",
        providerUrl: "https://provider.invalid",
        sql: "SELECT * FROM private_world"
      })
    ));

    expect(result.status).toBe("PLANNED");
    expect(result.selectedRecipeIds).toEqual(["REFERENCE_CURRENT_STATE"]);
    expect(plannedGraph(result).requirements.map((entry) => entry.requirementType)).toEqual([
      "RESOLVE_REFERENCE",
      "READ_CURRENT_STATE"
    ]);
    expect(JSON.stringify(result.graph)).not.toMatch(/operationId|providerId|providerUrl|https?:\/\/|\bSELECT\b/iu);
    expect(validateWorldQueryRequirementGraph(plannedGraph(result))).toBe(result.graph);
  });

  it("AC-Q002 produces the same canonical graph and hash for equivalent input ordering", () => {
    const nodes = [mention(), semanticOperation("semantic-geometry", { relationType: "GEOMETRY" })] as GroundingGraph["nodes"];
    const first = plan(graph(...nodes));
    const second = plan(graph(...[...nodes].reverse()));

    expect(second.graph).toEqual(first.graph);
    expect(plannedGraph(first).graphHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(canonicalRequirementGraphHash(plannedGraph(first))).toBe(plannedGraph(first).graphHash);
  });

  it("AC-Q003 reports the missing metre-buffer capability without substituting nearby", () => {
    const result = plan(graph(
      mention(),
      semanticOperation("semantic-nearby", { operator: "NEAR", arguments: ["vehicle", "target"], distanceMm: 1_000_000 }),
      semanticOperation("semantic-terrain", { relationType: "HIGH_GROUND" })
    ), ["REFERENCE_SETS", "WORLD_EVIDENCE"]);

    expect(result.status).toBe("CAPABILITY_GAP");
    expect(result.capabilityGaps).toEqual([
      expect.objectContaining({
        semanticCapability: "METRE_GEOMETRY_BUFFER",
        reason: "GOWM_GEOMETRY_BUFFER_CAPABILITY_REQUIRED",
        blocking: true,
        details: expect.objectContaining({ substitution: "FORBIDDEN", fabricatedQuery: false })
      })
    ]);
    expect(result.graph).toBeNull();
    expect(result.selectedRecipeIds).toEqual([]);
  });

  it("AC-Q004 reports visibility as a typed capability gap and fabricates no query", () => {
    const result = plan(graph(mention(), semanticOperation("semantic-visibility", { relationType: "LINE_OF_SIGHT" })));

    expect(result.status).toBe("CAPABILITY_GAP");
    expect(result.graph).toBeNull();
    expect(result.selectedRecipeIds).toEqual([]);
    expect(result.capabilityGaps).toEqual([
      expect.objectContaining({
        semanticCapability: "VISIBILITY",
        reason: "VISIBILITY_CAPABILITY_REQUIRED",
        details: expect.objectContaining({ substitution: "FORBIDDEN", fabricatedQuery: false })
      })
    ]);
  });

  it("preserves coverage of the original eleven requirement kinds", () => {
    const cases: Array<[GroundingGraph, string[]]> = [
      [graph(mention()), ["RESOLVED_REFERENCES"]],
      [graph(mention(), semanticOperation("current", { relationType: "CURRENT_STATE" })), ["WORLD_EVIDENCE"]],
      [graph(mention(), semanticOperation("geometry", { relationType: "GEOMETRY" })), ["WORLD_EVIDENCE"]],
      [graph(mention(), semanticOperation("provenance", { relationType: "PROVENANCE" })), ["WORLD_EVIDENCE"]],
      [graph(mention()), ["REFERENCE_SETS"]],
      [graph(mention(), semanticOperation("near", { operator: "NEAR", arguments: ["a", "b"], approximate: true })), ["REFERENCE_SETS"]],
      [graph(mention(), semanticOperation("within", { operator: "WITHIN", arguments: ["a", "b"] })), ["REFERENCE_SETS"]],
      [graph(mention(), semanticOperation("intersects", { operator: "INTERSECTS", arguments: ["a", "b"] })), ["REFERENCE_SETS"]],
      [graph(
        mention(),
        { nodeId: "prior-result", kind: "WORLD_QUERY", payload: { sourceGroundingId: "grounding-prior", sourceResultHash: `sha256:${"a".repeat(64)}` } }
      ), ["RESOLVED_REFERENCES"]]
    ];
    const observed = new Set(cases.flatMap(([inputGraph, products]) =>
      plannedGraph(plan(inputGraph, products)).requirements.map((entry) => entry.requirementType)
    ));

    const originalKinds = [
      "RESOLVE_REFERENCE", "VALIDATE_REFERENCE", "READ_CURRENT_STATE", "READ_GEOMETRY", "READ_PROVENANCE",
      "SEARCH_CATALOG", "SPATIAL_NEARBY", "SPATIAL_IN_AREA", "SPATIAL_INTERSECTS", "EXACT_VERIFY", "VALIDATE_RESULT"
    ];
    expect([...observed].sort()).toEqual([...originalKinds].sort());
    expect(stableRecipeCatalog.filter((entry) => entry.maturity === "STABLE")).toHaveLength(9);
    expect(stableRecipeCatalog.filter((entry) => entry.maturity === "PREVIEW")).toHaveLength(16);
  });

  it("creates typed dependencies and rejects a dependency cycle", () => {
    const valid = plannedGraph(plan(graph(mention()), ["RESOLVED_REFERENCES"]));
    expect(valid.dependencies).toHaveLength(1);
    const dependency = valid.dependencies[0]!;
    const cyclic = structuredClone(valid);
    cyclic.dependencies.push({
      fromRequirementId: dependency.toRequirementId,
      toRequirementId: dependency.fromRequirementId,
      outputName: "validatedReferences",
      targetPath: "/mentions"
    });
    expect(() => validateWorldQueryRequirementGraph(cyclic)).toThrow(/DEPENDENCY_CYCLE/u);
  });

  it("plans historical interval and trajectory requirements without changing northbound products", () => {
    const historicalConfiguration = { maximumInlinePoints: 128, allIntervalsLimit: 50 };
    const intervalIntent = {
      queryKind: "EXECUTION_INTERVAL" as const,
      executionSelection: { kind: "ALL" as const, limit: 50 },
      phaseScope: "EXECUTION_ENVELOPE" as const,
      sourceSelection: { mode: "ONLY_CANDIDATE" as const },
      maximumInlinePoints: 128
    };
    const interval = new SemanticRequirementPlanner().plan({
      groundingGraph: graph(mention()), requestedProducts: ["WORLD_EVIDENCE"], executionPolicy: policy,
      historicalTrace: { intent: intervalIntent, enabled: true }
    });
    expect(interval.selectedRecipeIds).toEqual(["HISTORICAL_EXECUTION_INTERVAL"]);
    expect(plannedGraph(interval).requirements.map((entry) => entry.requirementType)).toEqual(["READ_TASK_EXECUTION_INTERVAL"]);

    const trajectory = new SemanticRequirementPlanner().plan({
      groundingGraph: graph(mention()), requestedProducts: ["WORLD_EVIDENCE"], executionPolicy: policy,
      historicalTrace: {
        intent: { ...intervalIntent, queryKind: "HISTORICAL_TRAJECTORY", executionSelection: { kind: "LATEST" } },
        enabled: true
      }
    });
    expect(trajectory.selectedRecipeIds).toEqual(["HISTORICAL_TRAJECTORY"]);
    expect(plannedGraph(trajectory).requirements.map((entry) => entry.requirementType)).toEqual([
      "READ_OPERATIONAL_TASK", "READ_TASK_EXECUTION_INTERVAL", "READ_HISTORICAL_TRAJECTORY"
    ]);
    expect(requestedProducts).not.toContain("HISTORICAL_TRAJECTORY");
    expect(historicalConfiguration).toEqual({ maximumInlinePoints: 128, allIntervalsLimit: 50 });
  });

  it("rejects unknown products, duplicates, and requirement budget overflow", () => {
    expect(() => plan(graph(mention()), ["NOT_A_PRODUCT"])).toThrow(/UNKNOWN_REQUESTED_PRODUCT/u);
    expect(() => plan(graph(mention()), ["RESOLVED_REFERENCES", "RESOLVED_REFERENCES"])).toThrow(/INVALID_REQUESTED_PRODUCTS/u);
    expect(() => plan(graph(mention()), ["RESOLVED_REFERENCES"], { ...policy, maxQueryOperations: 1 })).toThrow(
      /REQUIREMENT_BUDGET_EXCEEDED/u
    );
  });

  it("returns no world-query graph for local-only products and gaps preview-only products", () => {
    const local = plan(graph(mention()), ["MENTIONS", "GROUNDING_GRAPH"]);
    expect(local).toEqual({
      status: "NO_WORLD_QUERY_REQUIRED",
      graph: null,
      selectedRecipeIds: [],
      capabilityGaps: []
    });

    const preview = plan(graph(mention()), ["DERIVED_REFERENCES"]);
    expect(preview.status).toBe("CAPABILITY_GAP");
    expect(preview.graph).toBeNull();
    expect(preview.capabilityGaps[0]).toMatchObject({ reason: "UNSUPPORTED_EXPRESSION", semanticCapability: "DERIVED_REFERENCES" });
    expect(requestedProducts).toContain("DERIVED_REFERENCES");

    const unspecifiedQuery = plan(graph(mention()), ["WORLD_QUERY"]);
    expect(unspecifiedQuery.status).toBe("CAPABILITY_GAP");
    expect(unspecifiedQuery.graph).toBeNull();
    expect(unspecifiedQuery.capabilityGaps[0]).toMatchObject({
      reason: "UNSUPPORTED_EXPRESSION",
      semanticCapability: "WORLD_QUERY_SEMANTICS_REQUIRED"
    });
  });

  it("rejects non-neutral requirement input even when the hash is recomputed", () => {
    const valid = plannedGraph(plan(graph(mention()), ["RESOLVED_REFERENCES"]));
    const invalid = structuredClone(valid);
    invalid.requirements[0]!.inputs["providerId"] = "provider-secret";
    expect(() => canonicalRequirementGraphHash(invalid)).toThrow(/NON_NEUTRAL_FIELD/u);
  });
});
