import { createHash } from "node:crypto";
import type { GroundingGraph } from "@wsgs/contracts";

const nodeKinds = new Set([
  "MENTION", "KNOWN_REFERENCE", "RESOLVED_REFERENCE", "DERIVED_REFERENCE", "REFERENCE_SET",
  "SEMANTIC_OPERATION", "WORLD_QUERY", "FINDING", "UNKNOWN"
]);
const edgeRelations = new Set([
  "RESOLVES_TO", "DERIVED_FROM", "SCOPED_BY", "FILTERS", "RELATES_TO", "OBSERVER_OF",
  "TARGET_OF", "PRODUCES", "SUPPORTED_BY", "CONTRADICTED_BY"
]);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function validateGroundingGraph(graph: GroundingGraph): GroundingGraph {
  if (graph.schemaVersion !== "1.0") throw new Error("GROUNDING_GRAPH_SCHEMA_VERSION");
  if (graph.nodes.length > 256) throw new Error("GROUNDING_GRAPH_NODE_LIMIT");
  if (graph.edges.length > 512) throw new Error("GROUNDING_GRAPH_EDGE_LIMIT");
  const nodeIds = graph.nodes.map((node) => node.nodeId);
  if (new Set(nodeIds).size !== nodeIds.length) throw new Error("GROUNDING_GRAPH_DUPLICATE_NODE");
  const nodeSet = new Set(nodeIds);
  for (const node of graph.nodes) {
    if (!nodeKinds.has(node.kind) || !node.payload || typeof node.payload !== "object" || Array.isArray(node.payload)) {
      throw new Error("GROUNDING_GRAPH_INVALID_NODE");
    }
  }
  const edgeIds = graph.edges.map((edge) => edge.edgeId);
  if (new Set(edgeIds).size !== edgeIds.length) throw new Error("GROUNDING_GRAPH_DUPLICATE_EDGE");
  for (const edge of graph.edges) {
    if (!edgeRelations.has(edge.relation) || !nodeSet.has(edge.from) || !nodeSet.has(edge.to) || edge.from === edge.to) {
      throw new Error("GROUNDING_GRAPH_INVALID_EDGE");
    }
  }
  return graph;
}

export function canonicalGraphHash(graph: GroundingGraph): `sha256:${string}` {
  validateGroundingGraph(graph);
  return `sha256:${createHash("sha256").update(canonical(graph), "utf8").digest("hex")}`;
}
