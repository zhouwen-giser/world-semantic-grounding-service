import type { GroundingGraph, WorldSemanticFrame } from "@wsgs/contracts";
import type { DeterministicParseResult, ParsedMention } from "@wsgs/deterministic-parser";
import { describe, expect, it } from "vitest";
import {
  buildGroundingGraph,
  buildGroundingGraphWithDegradation,
  canonicalGraphHash,
  resolveReferenceClaimConflict,
  validateGroundingGraph
} from "./index.js";

const text = "滨河路附近设备";
const deterministicMention: ParsedMention = {
  mentionId: "map-road",
  surfaceText: "滨河路",
  span: { encoding: "UTF16_CODE_UNIT", start: 0, end: 3 },
  expectedKinds: ["AREA"],
  extractionSource: "CLIENT_MAP",
  priority: 500,
  candidate: {
    kind: "MAP_SELECTION",
    value: { selectionId: "selection-1", revision: 1 },
    approximate: false,
    requiresUpstreamValidation: false
  }
};
const deterministic: DeterministicParseResult = {
  parserVersion: "deterministic-parser/1.0",
  mentions: [deterministicMention],
  ambiguities: [],
  priorGroundings: [],
  warnings: []
};
const modelFrame: WorldSemanticFrame = {
  schemaVersion: "1.0",
  mentions: [
    {
      mentionId: "model-road",
      surfaceText: "滨河路",
      span: { encoding: "UTF16_CODE_UNIT", start: 0, end: 3 },
      expectedKinds: ["ROAD"]
    },
    {
      mentionId: "model-device",
      surfaceText: "设备",
      span: { encoding: "UTF16_CODE_UNIT", start: 5, end: 7 },
      expectedKinds: ["DEVICE"]
    }
  ],
  spatialExpressions: [{
    expressionId: "near",
    operator: "NEAR",
    arguments: ["model-road", "model-device"],
    distanceM: 500,
    approximate: true
  }],
  relationExpressions: [],
  temporalConstraints: [{ constraintId: "current", relativeExpression: "current" }],
  aggregationExpressions: [],
  rankingExpressions: [{ expressionId: "nearest", metric: "distance", direction: "ASC", limit: 5 }]
};

describe("buildGroundingGraph", () => {
  it("builds an internally valid typed graph with bounded semantic operations", () => {
    const result = buildGroundingGraph(text, deterministic, modelFrame);
    expect(validateGroundingGraph(result.graph)).toBe(result.graph);
    expect(result.graph.nodes.some((node) => node.kind === "SEMANTIC_OPERATION")).toBe(true);
    expect(result.graph.edges.every((edge) =>
      result.graph.nodes.some((node) => node.nodeId === edge.from) &&
      result.graph.nodes.some((node) => node.nodeId === edge.to)
    )).toBe(true);
  });

  it("keeps conflicting map and model interpretations visible as ambiguity", () => {
    const result = buildGroundingGraph(text, deterministic, modelFrame);
    expect(result.ambiguities).toHaveLength(1);
    expect(result.ambiguities[0]).toMatchObject({ mentionId: "map-road", reason: "MAP_TEXT_CONFLICT" });
    expect(result.ambiguities[0]?.alternatives.map((entry) => entry.source)).toEqual(["CLIENT_MAP", "DOMAIN_MODEL"]);
    expect(result.graph.nodes.some((node) =>
      node.kind === "UNKNOWN" && (node.payload as Record<string, unknown>)["reason"] === "MAP_TEXT_CONFLICT"
    )).toBe(true);
  });

  it("never promotes a model-only mention or expression to a world fact", () => {
    const result = buildGroundingGraph(text, { ...deterministic, mentions: [] }, modelFrame);
    const modelNodes = result.graph.nodes.filter((node) =>
      JSON.stringify(node.payload).includes("DOMAIN_MODEL")
    );
    expect(modelNodes.length).toBeGreaterThan(0);
    expect(modelNodes.every((node) => node.kind === "MENTION" || node.kind === "SEMANTIC_OPERATION")).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === "FINDING" || node.kind === "RESOLVED_REFERENCE")).toBe(false);
  });

  it("merges compatible exact spans without allowing model overwrite", () => {
    const compatibleFrame: WorldSemanticFrame = {
      ...modelFrame,
      mentions: [{ ...modelFrame.mentions[0]!, expectedKinds: ["AREA"] }, modelFrame.mentions[1]!]
    };
    const result = buildGroundingGraph(text, deterministic, compatibleFrame);
    const merged = result.mergedMentions.find((mention) => mention.mentionId === "map-road");
    expect(merged?.extractionSources).toEqual(["CLIENT_MAP", "DOMAIN_MODEL"]);
    expect(result.mergedMentions.some((mention) => mention.mentionId === "model-road")).toBe(false);
    expect(result.ambiguities).toHaveLength(0);
  });

  it("is byte-stable across retries and has a canonical deterministic hash", () => {
    const first = buildGroundingGraph(text, deterministic, modelFrame);
    const second = buildGroundingGraph(text, structuredClone(deterministic), structuredClone(modelFrame));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.graphHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(canonicalGraphHash(first.graph)).toBe(first.graphHash);
  });

  it("retains different reference namespaces as ambiguity", () => {
    const decision = resolveReferenceClaimConflict([
      { claimId: "known", source: "KNOWN_REFERENCE", namespace: "gowm", referenceType: "ROAD", priority: 400 },
      { claimId: "other", source: "DOMAIN_MODEL", namespace: "external", referenceType: "ROAD", priority: 100 }
    ]);
    expect(decision).toMatchObject({ status: "AMBIGUOUS", reason: "NAMESPACE_CONFLICT" });
    expect(decision.alternatives).toHaveLength(2);
  });

  it("keeps explicit deterministic products and returns Partial when the model is down", () => {
    const degraded = buildGroundingGraphWithDegradation(text, deterministic, {
      status: "UNAVAILABLE",
      failureCode: "MODEL_DEADLINE_EXCEEDED"
    });
    expect(degraded.completionStatus).toBe("PARTIAL");
    expect(degraded.warnings).toEqual(["DOMAIN_MODEL_UNAVAILABLE:MODEL_DEADLINE_EXCEEDED"]);
    expect(degraded.graph.nodes.some((node) =>
      node.kind === "UNKNOWN" && (node.payload as Record<string, unknown>)["candidateKind"] === "MAP_SELECTION"
    )).toBe(true);
    expect(degraded.graph.nodes.some((node) => node.kind === "FINDING")).toBe(false);
  });

  it("enforces node and edge limits plus endpoint integrity", () => {
    const tooManyNodes: GroundingGraph = {
      schemaVersion: "1.0",
      nodes: Array.from({ length: 257 }, (_, index) => ({ nodeId: `node-${index}`, kind: "UNKNOWN", payload: {} })),
      edges: []
    };
    expect(() => validateGroundingGraph(tooManyNodes)).toThrow(/NODE_LIMIT/u);
    const invalidEndpoint: GroundingGraph = {
      schemaVersion: "1.0",
      nodes: [{ nodeId: "node-1", kind: "UNKNOWN", payload: {} }],
      edges: [{ edgeId: "edge-1", from: "node-1", to: "missing", relation: "RELATES_TO" }]
    };
    expect(() => validateGroundingGraph(invalidEndpoint)).toThrow(/INVALID_EDGE/u);
  });
});
