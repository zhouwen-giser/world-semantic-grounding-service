import type { GroundingGraph } from "@wsgs/contracts";
import { describe, expect, it } from "vitest";

import {
  WSGS_V02_INTERNAL_NODE_KINDS,
  canonicalInternalGroundingGraphHash,
  toInternalGroundingGraphV2,
  validateGroundingGraph,
  validateInternalGroundingGraphV2,
  type InternalGraphNodeV2
} from "./index.js";

const frozenGraph: GroundingGraph = {
  schemaVersion: "1.0",
  nodes: [{ nodeId: "mention", kind: "MENTION", payload: { mentionId: "m1" } }],
  edges: []
};

const internalNodes: InternalGraphNodeV2[] = WSGS_V02_INTERNAL_NODE_KINDS.map((kind, index) => ({
  nodeId: `internal-${index}`,
  kind,
  payload: { sequence: index }
}));

describe("internal grounding graph v0.2", () => {
  it("accepts all v0.2 node kinds in a separate internal graph", () => {
    const graph = toInternalGroundingGraphV2(frozenGraph, { nodes: internalNodes });
    expect(validateInternalGroundingGraphV2(graph)).toBe(graph);
    expect(new Set(graph.nodes.map((node) => node.kind))).toEqual(new Set(["MENTION", ...WSGS_V02_INTERNAL_NODE_KINDS]));
  });

  it("does not widen the frozen v0.1 northbound validator", () => {
    const invalidFrozen = {
      ...frozenGraph,
      nodes: [{ nodeId: "requirement", kind: "QUERY_REQUIREMENT", payload: {} }]
    } as unknown as GroundingGraph;
    expect(() => validateGroundingGraph(invalidFrozen)).toThrow(/INVALID_NODE/u);
    expect(validateGroundingGraph(frozenGraph)).toBe(frozenGraph);
  });

  it("sorts extensions and produces a retry-stable canonical internal hash", () => {
    const first = toInternalGroundingGraphV2(frozenGraph, { nodes: internalNodes });
    const second = toInternalGroundingGraphV2(structuredClone(frozenGraph), { nodes: [...internalNodes].reverse() });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(canonicalInternalGroundingGraphHash(first)).toBe(canonicalInternalGroundingGraphHash(second));
  });
});
