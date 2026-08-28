import { createHash } from "node:crypto";

import type { GroundingGraph } from "@wsgs/contracts";

export const WSGS_V02_INTERNAL_NODE_KINDS = [
  "QUERY_REQUIREMENT",
  "CAPABILITY_BINDING",
  "WORLD_QUERY",
  "WORLD_QUERY_RESULT",
  "DERIVED_REFERENCE",
  "REFERENCE_SET",
  "VALIDATION_RESULT"
] as const;

export type WsgsV02InternalNodeKind =
  | GroundingGraph["nodes"][number]["kind"]
  | (typeof WSGS_V02_INTERNAL_NODE_KINDS)[number];

export interface InternalGraphNodeV2 {
  nodeId: string;
  kind: WsgsV02InternalNodeKind;
  payload: Record<string, unknown>;
}

export interface InternalGraphEdgeV2 {
  edgeId: string;
  from: string;
  to: string;
  relation: GroundingGraph["edges"][number]["relation"];
}

export interface InternalGroundingGraphV2 {
  schemaVersion: "2.0";
  nodes: InternalGraphNodeV2[];
  edges: InternalGraphEdgeV2[];
}

export interface InternalGroundingGraphV2Extension {
  nodes?: readonly InternalGraphNodeV2[];
  edges?: readonly InternalGraphEdgeV2[];
}

const allowedNodeKinds = new Set<WsgsV02InternalNodeKind>([
  "MENTION", "KNOWN_REFERENCE", "RESOLVED_REFERENCE", "DERIVED_REFERENCE", "REFERENCE_SET",
  "SEMANTIC_OPERATION", "WORLD_QUERY", "FINDING", "UNKNOWN",
  ...WSGS_V02_INTERNAL_NODE_KINDS
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

export function validateInternalGroundingGraphV2(graph: InternalGroundingGraphV2): InternalGroundingGraphV2 {
  if (graph.schemaVersion !== "2.0") throw new Error("INTERNAL_GROUNDING_GRAPH_SCHEMA_VERSION");
  if (graph.nodes.length > 256) throw new Error("INTERNAL_GROUNDING_GRAPH_NODE_LIMIT");
  if (graph.edges.length > 512) throw new Error("INTERNAL_GROUNDING_GRAPH_EDGE_LIMIT");
  const nodeIds = graph.nodes.map((node) => node.nodeId);
  if (new Set(nodeIds).size !== nodeIds.length) throw new Error("INTERNAL_GROUNDING_GRAPH_DUPLICATE_NODE");
  const nodeSet = new Set(nodeIds);
  for (const node of graph.nodes) {
    if (!allowedNodeKinds.has(node.kind) || !node.payload || typeof node.payload !== "object" || Array.isArray(node.payload)) {
      throw new Error("INTERNAL_GROUNDING_GRAPH_INVALID_NODE");
    }
  }
  const edgeIds = graph.edges.map((edge) => edge.edgeId);
  if (new Set(edgeIds).size !== edgeIds.length) throw new Error("INTERNAL_GROUNDING_GRAPH_DUPLICATE_EDGE");
  for (const edge of graph.edges) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to) || edge.from === edge.to) {
      throw new Error("INTERNAL_GROUNDING_GRAPH_INVALID_EDGE");
    }
  }
  return graph;
}

/** Creates an internal v0.2 view without widening the frozen northbound graph. */
export function toInternalGroundingGraphV2(
  graph: GroundingGraph,
  extension: InternalGroundingGraphV2Extension = {}
): InternalGroundingGraphV2 {
  const nodes: InternalGraphNodeV2[] = [
    ...graph.nodes.map((node) => ({
      nodeId: node.nodeId,
      kind: node.kind,
      payload: structuredClone(node.payload) as Record<string, unknown>
    })),
    ...(extension.nodes ?? []).map((node) => structuredClone(node))
  ].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const edges: InternalGraphEdgeV2[] = [
    ...graph.edges.map((edge) => ({ ...edge })),
    ...(extension.edges ?? []).map((edge) => ({ ...edge }))
  ].sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  return validateInternalGroundingGraphV2({ schemaVersion: "2.0", nodes, edges });
}

export function canonicalInternalGroundingGraphHash(graph: InternalGroundingGraphV2): `sha256:${string}` {
  validateInternalGroundingGraphV2(graph);
  return `sha256:${createHash("sha256").update(canonical(graph), "utf8").digest("hex")}`;
}
