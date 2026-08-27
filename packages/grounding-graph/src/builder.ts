import { createHash } from "node:crypto";
import type { GroundingGraph, WorldSemanticFrame } from "@wsgs/contracts";
import type { DeterministicParseResult, ParsedMention } from "@wsgs/deterministic-parser";
import { validateSemanticFrame } from "@wsgs/semantic-frame";
import type {
  DegradedGroundingGraphResult,
  GraphAmbiguity,
  GroundingGraphBuildResult,
  MergedMention,
  ReferenceMergeClaim,
  ReferenceMergeDecision
} from "./types.js";
import { canonicalGraphHash, validateGroundingGraph } from "./validation.js";

type GraphNode = GroundingGraph["nodes"][number];
type GraphEdge = GroundingGraph["edges"][number];
type EdgeRelation = GraphEdge["relation"];

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}-${createHash("sha256").update(stableJson(value), "utf8").digest("hex").slice(0, 24)}`;
}

function jsonPayload(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function overlaps(
  left: { span: { start: number; end: number } },
  right: { span: { start: number; end: number } }
): boolean {
  return left.span.start < right.span.end && right.span.start < left.span.end;
}

function compatibleKinds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) return true;
  return left.some((kind) => right.includes(kind));
}

function expectedNamespaces(expectedKinds: readonly string[]): string[] {
  return expectedKinds.flatMap((kind) => {
    const match = /^([a-z][a-z0-9._-]{0,31}):/u.exec(kind);
    return match?.[1] ? [match[1]] : [];
  });
}

function ambiguityReason(deterministic: ParsedMention, model: WorldSemanticFrame["mentions"][number]): GraphAmbiguity["reason"] {
  const suppliedNamespace = deterministic.candidate.referenceKey?.namespace;
  const modelNamespaces = expectedNamespaces(model.expectedKinds ?? []);
  if (suppliedNamespace && modelNamespaces.some((namespace) => namespace !== suppliedNamespace)) return "NAMESPACE_CONFLICT";
  if (deterministic.extractionSource === "CLIENT_MAP") return "MAP_TEXT_CONFLICT";
  return "CONTEXT_CONFLICT";
}

export function resolveReferenceClaimConflict(claims: readonly ReferenceMergeClaim[]): ReferenceMergeDecision {
  if (claims.length === 0) throw new Error("At least one reference merge claim is required");
  const alternatives = [...claims].sort(
    (left, right) => right.priority - left.priority || left.source.localeCompare(right.source) || left.claimId.localeCompare(right.claimId)
  );
  if (new Set(alternatives.map((claim) => claim.namespace)).size > 1) {
    return { status: "AMBIGUOUS", reason: "NAMESPACE_CONFLICT", alternatives };
  }
  if (new Set(alternatives.map((claim) => claim.referenceType)).size > 1) {
    return { status: "AMBIGUOUS", reason: "CONTEXT_CONFLICT", alternatives };
  }
  return { status: "MERGED", selected: alternatives[0]!, alternatives };
}

function modelMention(value: WorldSemanticFrame["mentions"][number]): MergedMention {
  return {
    mentionId: value.mentionId,
    surfaceText: value.surfaceText,
    span: value.span,
    expectedKinds: [...(value.expectedKinds ?? [])].sort(),
    extractionSources: ["DOMAIN_MODEL"]
  };
}

function deterministicMention(value: ParsedMention): MergedMention {
  return {
    mentionId: value.mentionId,
    surfaceText: value.surfaceText,
    span: value.span,
    expectedKinds: [...value.expectedKinds].sort(),
    extractionSources: [value.extractionSource]
  };
}

export function buildGroundingGraph(
  originalText: string,
  deterministic: DeterministicParseResult,
  modelFrame: WorldSemanticFrame
): GroundingGraphBuildResult {
  validateSemanticFrame(modelFrame, originalText);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Map<string, string>();
  const merged = deterministic.mentions.map(deterministicMention);
  const ambiguities: GraphAmbiguity[] = [];

  const addNode = (node: GraphNode): void => {
    if (nodes.some((existing) => existing.nodeId === node.nodeId)) return;
    nodes.push(node);
  };
  const addEdge = (from: string, to: string, relation: EdgeRelation, identity: unknown): void => {
    if (from === to) return;
    edges.push({ edgeId: stableId("edge", { from, to, relation, identity }), from, to, relation });
  };

  for (const mention of deterministic.mentions) {
    const nodeId = stableId("node-mention", mention.mentionId);
    nodeIds.set(mention.mentionId, nodeId);
    addNode({
      nodeId,
      kind: "MENTION",
      payload: jsonPayload({
        mentionId: mention.mentionId,
        surfaceText: mention.surfaceText,
        span: mention.span,
        expectedKinds: [...mention.expectedKinds].sort(),
        extractionSources: [mention.extractionSource]
      })
    });
    const candidateNodeId = stableId("node-candidate", { mentionId: mention.mentionId, candidate: mention.candidate });
    addNode({
      nodeId: candidateNodeId,
      kind: mention.candidate.referenceKey ? "KNOWN_REFERENCE" : "UNKNOWN",
      payload: jsonPayload({
        candidateKind: mention.candidate.kind,
        value: mention.candidate.value,
        approximate: mention.candidate.approximate,
        requiresUpstreamValidation: mention.candidate.requiresUpstreamValidation,
        ...(mention.candidate.referenceKey ? { referenceKey: mention.candidate.referenceKey } : {})
      })
    });
    addEdge(nodeId, candidateNodeId, "RELATES_TO", mention.candidate.kind);
  }

  for (const mention of modelFrame.mentions) {
    const conflict = deterministic.mentions.find((entry) => overlaps(entry, mention));
    if (!conflict) {
      const value = modelMention(mention);
      merged.push(value);
      const nodeId = stableId("node-mention", mention.mentionId);
      nodeIds.set(mention.mentionId, nodeId);
      addNode({ nodeId, kind: "MENTION", payload: jsonPayload(value as unknown as Record<string, unknown>) });
      continue;
    }
    const sameSpan = conflict.span.start === mention.span.start && conflict.span.end === mention.span.end;
    if (sameSpan && conflict.surfaceText === mention.surfaceText && compatibleKinds(conflict.expectedKinds, mention.expectedKinds ?? [])) {
      const existing = merged.find((entry) => entry.mentionId === conflict.mentionId)!;
      existing.expectedKinds = [...new Set([...existing.expectedKinds, ...(mention.expectedKinds ?? [])])].sort();
      if (!existing.extractionSources.includes("DOMAIN_MODEL")) existing.extractionSources.push("DOMAIN_MODEL");
      nodeIds.set(mention.mentionId, nodeIds.get(conflict.mentionId)!);
      const node = nodes.find((entry) => entry.nodeId === nodeIds.get(conflict.mentionId));
      if (node) node.payload = jsonPayload(existing as unknown as Record<string, unknown>);
      continue;
    }
    const reason = ambiguityReason(conflict, mention);
    const ambiguity: GraphAmbiguity = {
      ambiguityId: stableId("ambiguity", { deterministic: conflict.mentionId, model: mention.mentionId, reason }),
      mentionId: conflict.mentionId,
      reason,
      alternatives: [
        {
          source: conflict.extractionSource,
          namespace: conflict.candidate.referenceKey?.namespace ?? conflict.candidate.kind,
          referenceType: conflict.expectedKinds.join("|")
        },
        {
          source: "DOMAIN_MODEL",
          namespace: expectedNamespaces(mention.expectedKinds ?? [])[0] ?? "semantic",
          referenceType: (mention.expectedKinds ?? []).join("|")
        }
      ]
    };
    ambiguities.push(ambiguity);
    const ambiguityNodeId = stableId("node-ambiguity", ambiguity.ambiguityId);
    nodeIds.set(mention.mentionId, ambiguityNodeId);
    addNode({ nodeId: ambiguityNodeId, kind: "UNKNOWN", payload: jsonPayload(ambiguity as unknown as Record<string, unknown>) });
    addEdge(nodeIds.get(conflict.mentionId)!, ambiguityNodeId, "CONTRADICTED_BY", reason);
  }

  for (const parsedAmbiguity of deterministic.ambiguities) {
    const reason = parsedAmbiguity.reason === "MAP_TEXT_CONFLICT" ? "MAP_TEXT_CONFLICT" : "CONTEXT_CONFLICT";
    const ambiguity: GraphAmbiguity = {
      ambiguityId: parsedAmbiguity.ambiguityId,
      mentionId: parsedAmbiguity.mentionIds[0] ?? parsedAmbiguity.ambiguityId,
      reason,
      alternatives: parsedAmbiguity.mentionIds.map((mentionId) => ({
        source: "DETERMINISTIC",
        namespace: "deterministic",
        referenceType: mentionId
      }))
    };
    ambiguities.push(ambiguity);
    const ambiguityNodeId = stableId("node-ambiguity", ambiguity.ambiguityId);
    addNode({ nodeId: ambiguityNodeId, kind: "UNKNOWN", payload: jsonPayload(ambiguity as unknown as Record<string, unknown>) });
    for (const mentionId of parsedAmbiguity.mentionIds) {
      const sourceNode = nodeIds.get(mentionId);
      if (sourceNode) addEdge(sourceNode, ambiguityNodeId, "CONTRADICTED_BY", ambiguity.ambiguityId);
    }
  }

  const operations: Array<{
    id: string;
    category: string;
    value: Record<string, unknown>;
    targets: string[];
    source: "DETERMINISTIC" | "DOMAIN_MODEL";
  }> = [
    ...(deterministic.distances ?? []).map((value) => ({
      id: value.distanceId,
      category: "DISTANCE_LITERAL",
      value: value as unknown as Record<string, unknown>,
      targets: [],
      source: "DETERMINISTIC" as const
    })),
    ...(deterministic.absoluteTimeConstraints ?? []).map((value) => ({
      id: value.constraintId,
      category: "ABSOLUTE_TIME_LITERAL",
      value: value as unknown as Record<string, unknown>,
      targets: [],
      source: "DETERMINISTIC" as const
    })),
    ...modelFrame.spatialExpressions.map((value) => ({
      id: value.expressionId, category: "SPATIAL", value: value as unknown as Record<string, unknown>, targets: value.arguments,
      source: "DOMAIN_MODEL" as const
    })),
    ...modelFrame.relationExpressions.map((value) => ({
      id: value.expressionId,
      category: "RELATION",
      value: value as unknown as Record<string, unknown>,
      targets: [value.subjectMentionId, ...(value.objectMentionId ? [value.objectMentionId] : [])],
      source: "DOMAIN_MODEL" as const
    })),
    ...modelFrame.temporalConstraints.map((value) => ({
      id: value.constraintId, category: "TEMPORAL", value: value as unknown as Record<string, unknown>, targets: [],
      source: "DOMAIN_MODEL" as const
    })),
    ...modelFrame.aggregationExpressions.map((value) => ({
      id: value.expressionId,
      category: "AGGREGATION",
      value: value as unknown as Record<string, unknown>,
      targets: value.targetExpressionId ? [value.targetExpressionId] : [],
      source: "DOMAIN_MODEL" as const
    })),
    ...modelFrame.rankingExpressions.map((value) => ({
      id: value.expressionId, category: "RANKING", value: value as unknown as Record<string, unknown>, targets: [],
      source: "DOMAIN_MODEL" as const
    }))
  ];
  for (const operation of operations) {
    const nodeId = stableId("node-operation", { category: operation.category, id: operation.id });
    nodeIds.set(operation.id, nodeId);
    addNode({
      nodeId,
      kind: "SEMANTIC_OPERATION",
      payload: jsonPayload({ category: operation.category, expression: operation.value, source: operation.source })
    });
  }
  for (const operation of operations) {
    const from = nodeIds.get(operation.id)!;
    for (const target of operation.targets) {
      const to = nodeIds.get(target);
      if (!to) throw new Error(`GROUNDING_GRAPH_UNKNOWN_OPERATION_TARGET:${target}`);
      addEdge(from, to, "TARGET_OF", target);
    }
  }

  const graph: GroundingGraph = {
    schemaVersion: "1.0",
    nodes: nodes.sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    edges: edges.sort((left, right) => left.edgeId.localeCompare(right.edgeId))
  };
  validateGroundingGraph(graph);
  return {
    graph,
    graphHash: canonicalGraphHash(graph),
    mergedMentions: merged.sort((left, right) => left.span.start - right.span.start || left.mentionId.localeCompare(right.mentionId)),
    ambiguities: ambiguities.sort((left, right) => left.ambiguityId.localeCompare(right.ambiguityId))
  };
}

export function buildGroundingGraphWithDegradation(
  originalText: string,
  deterministic: DeterministicParseResult,
  model: { status: "AVAILABLE"; frame: WorldSemanticFrame } | { status: "UNAVAILABLE"; failureCode: string }
): DegradedGroundingGraphResult {
  const frame: WorldSemanticFrame = model.status === "AVAILABLE" ? model.frame : {
    schemaVersion: "1.0",
    mentions: [],
    spatialExpressions: [],
    relationExpressions: [],
    temporalConstraints: [],
    aggregationExpressions: [],
    rankingExpressions: []
  };
  const result = buildGroundingGraph(originalText, deterministic, frame);
  return {
    ...result,
    completionStatus: model.status === "AVAILABLE" ? "COMPLETE" : "PARTIAL",
    warnings: model.status === "AVAILABLE" ? [] : [`DOMAIN_MODEL_UNAVAILABLE:${model.failureCode}`]
  };
}
