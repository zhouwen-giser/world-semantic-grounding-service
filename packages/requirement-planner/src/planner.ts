import { createHash } from "node:crypto";

import type { GroundingGraph } from "@wsgs/contracts";
import type { GroundedGeospatialProductIntent } from "@wsgs/gdps-descriptor-consumer";

import { stableRecipeCatalog } from "./catalog.js";
import {
  requestedProducts,
  requirementTypes,
  type PlannerCapabilityGap,
  type PlannerCapabilityGapReason,
  type PlannerJson,
  type RequestedProduct,
  type RequirementDependency,
  type RequirementPlannerInput,
  type RequirementPlanningResult,
  type RequirementType,
  type StableRecipeId,
  type StableRequirementRecipe,
  type WorldQueryExecutionPolicy,
  type WorldQueryRequirement,
  type WorldQueryRequirementGraph
} from "./types.js";
import { canonicalRequirementGraphHash, validateWorldQueryRequirementGraph } from "./validation.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const semanticTokenPattern = /^[A-Z][A-Z0-9_:-]{0,127}$/u;
const requestedProductSet = new Set<string>(requestedProducts);
const groundingNodeKinds = new Set([
  "MENTION", "KNOWN_REFERENCE", "RESOLVED_REFERENCE", "DERIVED_REFERENCE", "REFERENCE_SET",
  "SEMANTIC_OPERATION", "WORLD_QUERY", "FINDING", "UNKNOWN"
]);
const groundingEdgeRelations = new Set([
  "RESOLVES_TO", "DERIVED_FROM", "SCOPED_BY", "FILTERS", "RELATES_TO", "OBSERVER_OF",
  "TARGET_OF", "PRODUCES", "SUPPORTED_BY", "CONTRADICTED_BY"
]);
const spatialOperators = new Set(["NEAR", "WITHIN", "CONTAINS", "INTERSECTS"]);
const unsupportedSpatialOperators = new Set(["ALONG", "BUFFER", "NORTH_OF", "SOUTH_OF", "EAST_OF", "WEST_OF"]);
const currentStateTokens = new Set(["CURRENT_STATE", "LOCATION", "POSITION", "STATE", "READ_CURRENT_STATE"]);
const geometryTokens = new Set(["GEOMETRY", "SHAPE", "FOOTPRINT", "READ_GEOMETRY"]);
const provenanceTokens = new Set(["PROVENANCE", "SOURCE_PROVENANCE", "READ_PROVENANCE"]);
const catalogTokens = new Set(["CATALOG_SEARCH", "SEARCH_CATALOG"]);
const terrainTokens = new Set(["TERRAIN", "SLOPE", "RELIEF", "TERRAIN_ANALYSIS"]);
const visibilityTokens = new Set(["VISIBILITY", "VISIBLE", "VISIBLE_FROM", "LINE_OF_SIGHT", "OBSERVABILITY", "CAN_OBSERVE"]);
const landCoverTokens = new Set(["LAND_COVER", "LAND_COVER_AT_LOCATION"]);
const wetlandTokens = new Set(["WETLAND", "WETLANDS", "FIND_WETLANDS"]);
const obstacleTokens = new Set(["OBSTACLE", "OBSTACLES", "FIND_OBSTACLES"]);
const blockedAreaTokens = new Set(["BLOCKED_AREA", "BLOCKED_AREAS", "FIND_BLOCKED_AREAS"]);
const highGroundTokens = new Set(["HIGH_GROUND", "FIND_HIGH_GROUND"]);
const elevationTokens = new Set(["ELEVATION", "ELEVATION_AT_LOCATION"]);
const traversabilityExplainTokens = new Set(["TRAVERSABILITY_EXPLAIN", "EXPLAIN_TRAVERSABILITY"]);
const floodRiskTokens = new Set(["FLOOD_RISK"]);
const localProducts = new Set<RequestedProduct>(["MENTIONS", "GROUNDING_GRAPH"]);
const previewOnlyProducts = new Set<RequestedProduct>([
  "DERIVED_REFERENCES",
  "OPERATIONAL_TASKS",
  "EVENT_TIMELINES",
  "CORRELATION_FINDINGS",
  "PREDICATE_EVALUATIONS"
]);
const recipeById = new Map(stableRecipeCatalog.map((recipe) => [recipe.recipeId, recipe]));

const outputByRequirement: Record<RequirementType, string> = {
  RESOLVE_REFERENCE: "referenceCandidates",
  VALIDATE_REFERENCE: "validatedReferences",
  READ_CURRENT_STATE: "currentState",
  READ_GEOMETRY: "geometry",
  READ_PROVENANCE: "provenance",
  SEARCH_CATALOG: "referenceSet",
  SPATIAL_NEARBY: "nearbyCandidates",
  SPATIAL_IN_AREA: "areaCandidates",
  SPATIAL_INTERSECTS: "intersectionCandidates",
  READ_LAND_COVER: "landCover",
  READ_TERRAIN_CLASS: "terrainClass",
  READ_ELEVATION: "elevation",
  READ_SURFACE_MATERIAL: "surfaceMaterial",
  READ_TRAVERSABILITY: "traversability",
  FIND_HIGH_GROUND: "highGround",
  FIND_WATER: "waterFeatures",
  FIND_WETLANDS: "wetlandFeatures",
  FIND_BUILDINGS: "buildings",
  FIND_OBSTACLES: "obstacles",
  FIND_BLOCKED_AREAS: "blockedAreas",
  EXPLAIN_TRAVERSABILITY: "traversabilityExplanation",
  READ_GEO_PRODUCT_VALUE: "geospatialProductValue",
  READ_GEO_PRODUCT_PROFILE: "geospatialProductProfile",
  FIND_GEO_PRODUCT_CLASS_AREAS: "geospatialProductClassAreas",
  FIND_GEO_PRODUCT_VALUE_RANGE_AREAS: "geospatialProductRangeAreas",
  FIND_GEO_VECTOR_FEATURES_IN_AREA: "geospatialVectorFeatures",
  FIND_GEO_VECTOR_FEATURES_NEARBY: "geospatialVectorFeatures",
  FIND_GEO_VECTOR_INTERSECTIONS: "geospatialVectorIntersections",
  EXACT_VERIFY: "verifiedReferences",
  VALIDATE_RESULT: "validatedResult"
};

const targetByRequirement: Record<RequirementType, string> = {
  RESOLVE_REFERENCE: "/mentions",
  VALIDATE_REFERENCE: "/references",
  READ_CURRENT_STATE: "/references",
  READ_GEOMETRY: "/references",
  READ_PROVENANCE: "/references",
  SEARCH_CATALOG: "/criteria",
  SPATIAL_NEARBY: "/anchorReferences",
  SPATIAL_IN_AREA: "/areaReferences",
  SPATIAL_INTERSECTS: "/references",
  READ_LAND_COVER: "/point",
  READ_TERRAIN_CLASS: "/point",
  READ_ELEVATION: "/point",
  READ_SURFACE_MATERIAL: "/point",
  READ_TRAVERSABILITY: "/point",
  FIND_HIGH_GROUND: "/selector",
  FIND_WATER: "/selector",
  FIND_WETLANDS: "/selector",
  FIND_BUILDINGS: "/selector",
  FIND_OBSTACLES: "/point",
  FIND_BLOCKED_AREAS: "/selector",
  EXPLAIN_TRAVERSABILITY: "/point",
  READ_GEO_PRODUCT_VALUE: "/point",
  READ_GEO_PRODUCT_PROFILE: "/line",
  FIND_GEO_PRODUCT_CLASS_AREAS: "/selector",
  FIND_GEO_PRODUCT_VALUE_RANGE_AREAS: "/selector",
  FIND_GEO_VECTOR_FEATURES_IN_AREA: "/selector",
  FIND_GEO_VECTOR_FEATURES_NEARBY: "/point",
  FIND_GEO_VECTOR_INTERSECTIONS: "/geometry",
  EXACT_VERIFY: "/candidates",
  VALIDATE_RESULT: "/result"
};

interface SpatialConstraint {
  sourceNodeId: string;
  operator: "NEAR" | "WITHIN" | "CONTAINS" | "INTERSECTS";
  approximate: boolean;
  distanceMm?: number;
}

interface GraphSignals {
  mentionNodeIds: string[];
  referenceNodeIds: string[];
  priorResultNodeIds: string[];
  expectedReferenceKinds: string[];
  spatialConstraints: SpatialConstraint[];
  semanticTokens: Set<string>;
  tokenSourceNodeIds: Map<string, Set<string>>;
  unsupportedSpatialNodeIds: string[];
  hasApproximateCandidate: boolean;
  explicitProductIds: string[];
}

interface SelectedRecipe {
  recipe: StableRequirementRecipe;
  requiredForProduct: RequestedProduct;
  sourceNodeIds: Set<string>;
}

interface RequirementAccumulator {
  requirementType: RequirementType;
  requiredForProduct: RequestedProduct;
  allowApproximation: boolean;
  sourceNodeIds: Set<string>;
}

interface DependencyAccumulator {
  fromKey: string;
  toKey: string;
  outputName: string;
  targetPath: string;
}

export class RequirementPlanningError extends Error {
  constructor(readonly code: string) {
    super(`Semantic requirement planning failed: ${code}`);
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}-${digest(value).slice(0, 24)}`;
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return null;
  const normalized = value.trim().toUpperCase().replace(/[ .-]+/gu, "_");
  return semanticTokenPattern.test(normalized) ? normalized : null;
}

function validateGroundingGraphInput(graph: GroundingGraph): void {
  if (graph.schemaVersion !== "1.0") throw new RequirementPlanningError("GROUNDING_GRAPH_SCHEMA_VERSION");
  if (!Array.isArray(graph.nodes) || graph.nodes.length > 256) throw new RequirementPlanningError("GROUNDING_GRAPH_NODE_LIMIT");
  if (!Array.isArray(graph.edges) || graph.edges.length > 512) throw new RequirementPlanningError("GROUNDING_GRAPH_EDGE_LIMIT");
  const nodeIds = graph.nodes.map((node) => node.nodeId);
  if (nodeIds.some((id) => !identifierPattern.test(id)) || new Set(nodeIds).size !== nodeIds.length) {
    throw new RequirementPlanningError("GROUNDING_GRAPH_INVALID_NODE_ID");
  }
  const nodeSet = new Set(nodeIds);
  const edgeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (!groundingNodeKinds.has(node.kind) || !plainObject(node.payload)) {
      throw new RequirementPlanningError("GROUNDING_GRAPH_INVALID_PAYLOAD");
    }
  }
  for (const edge of graph.edges) {
    if (
      !identifierPattern.test(edge.edgeId) || edgeIds.has(edge.edgeId) || !nodeSet.has(edge.from) ||
      !nodeSet.has(edge.to) || edge.from === edge.to || !groundingEdgeRelations.has(edge.relation)
    ) throw new RequirementPlanningError("GROUNDING_GRAPH_INVALID_EDGE");
    edgeIds.add(edge.edgeId);
  }
}

function validateExecutionPolicy(policy: WorldQueryExecutionPolicy): void {
  const allowedKeys = new Set([
    "readOnly", "deadlineMs", "maxQueryOperations", "maxCandidatesPerMention", "maxResultBytes", "allowApproximation"
  ]);
  if (!plainObject(policy) || Object.keys(policy).some((key) => !allowedKeys.has(key))) {
    throw new RequirementPlanningError("INVALID_EXECUTION_POLICY");
  }
  if (
    policy.readOnly !== true || typeof policy.allowApproximation !== "boolean" ||
    !Number.isSafeInteger(policy.deadlineMs) || policy.deadlineMs < 100 || policy.deadlineMs > 120_000 ||
    !Number.isSafeInteger(policy.maxQueryOperations) || policy.maxQueryOperations < 1 || policy.maxQueryOperations > 64 ||
    !Number.isSafeInteger(policy.maxCandidatesPerMention) || policy.maxCandidatesPerMention < 1 || policy.maxCandidatesPerMention > 20 ||
    !Number.isSafeInteger(policy.maxResultBytes) || policy.maxResultBytes < 1_024 || policy.maxResultBytes > 67_108_864
  ) throw new RequirementPlanningError("INVALID_EXECUTION_POLICY");
}

function normalizeRequestedProducts(values: readonly string[]): RequestedProduct[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 16 || new Set(values).size !== values.length) {
    throw new RequirementPlanningError("INVALID_REQUESTED_PRODUCTS");
  }
  if (values.some((value) => !requestedProductSet.has(value))) throw new RequirementPlanningError("UNKNOWN_REQUESTED_PRODUCT");
  return [...values] as RequestedProduct[];
}

function addToken(signals: GraphSignals, raw: unknown, sourceNodeId: string): void {
  const token = normalizeToken(raw);
  if (!token) return;
  signals.semanticTokens.add(token);
  const sources = signals.tokenSourceNodeIds.get(token) ?? new Set<string>();
  sources.add(sourceNodeId);
  signals.tokenSourceNodeIds.set(token, sources);
}

function collectSignals(graph: GroundingGraph): GraphSignals {
  const signals: GraphSignals = {
    mentionNodeIds: [],
    referenceNodeIds: [],
    priorResultNodeIds: [],
    expectedReferenceKinds: [],
    spatialConstraints: [],
    semanticTokens: new Set(),
    tokenSourceNodeIds: new Map(),
    unsupportedSpatialNodeIds: [],
    hasApproximateCandidate: false,
    explicitProductIds: []
  };
  const expectedKinds = new Set<string>();
  for (const node of [...graph.nodes].sort((left, right) => left.nodeId.localeCompare(right.nodeId))) {
    const payload = node.payload as Record<string, unknown>;
    if (node.kind === "MENTION") {
      signals.mentionNodeIds.push(node.nodeId);
      if (Array.isArray(payload["expectedKinds"])) {
        for (const kind of payload["expectedKinds"]) {
          const token = normalizeToken(kind);
          if (token) expectedKinds.add(token);
        }
      }
    }
    if (["KNOWN_REFERENCE", "RESOLVED_REFERENCE", "DERIVED_REFERENCE", "REFERENCE_SET"].includes(node.kind)) {
      signals.referenceNodeIds.push(node.nodeId);
    }
    if (payload["approximate"] === true) signals.hasApproximateCandidate = true;
    if (
      (node.kind === "WORLD_QUERY" || node.kind === "FINDING") &&
      ["sourceGroundingId", "sourceResultHash", "priorGroundingId", "revalidationRequired"].some((key) => key in payload)
    ) signals.priorResultNodeIds.push(node.nodeId);
    if (node.kind !== "SEMANTIC_OPERATION") continue;
    addToken(signals, payload["category"], node.nodeId);
    const expression = plainObject(payload["expression"]) ? payload["expression"] : {};
    const relationType = expression["relationType"];
    if (typeof relationType === "string") {
      const preference = /^EXPLICIT_PRODUCT_PREFERENCE:(?<productId>[a-z][a-z0-9-]{2,63})$/u.exec(relationType);
      if (preference?.groups?.["productId"]) signals.explicitProductIds.push(preference.groups["productId"]);
    }
    for (const key of ["relationType", "semanticCapability", "resultNature"]) addToken(signals, expression[key], node.nodeId);
    if (Array.isArray(expression["capabilityRequirements"])) {
      for (const value of expression["capabilityRequirements"]) addToken(signals, value, node.nodeId);
    }
    const operator = normalizeToken(expression["operator"]);
    if (!operator) continue;
    addToken(signals, operator, node.nodeId);
    if (unsupportedSpatialOperators.has(operator)) {
      signals.unsupportedSpatialNodeIds.push(node.nodeId);
      continue;
    }
    if (!spatialOperators.has(operator)) continue;
    let distanceMm: number | undefined;
    if (expression["distanceMm"] !== undefined) {
      if (!Number.isSafeInteger(expression["distanceMm"]) || (expression["distanceMm"] as number) <= 0) {
        throw new RequirementPlanningError("INVALID_SPATIAL_DISTANCE");
      }
      distanceMm = expression["distanceMm"] as number;
    } else if (expression["distanceM"] !== undefined) {
      const distanceM = expression["distanceM"];
      if (typeof distanceM !== "number" || !Number.isFinite(distanceM) || distanceM <= 0) {
        throw new RequirementPlanningError("INVALID_SPATIAL_DISTANCE");
      }
      distanceMm = Math.round(distanceM * 1_000);
      if (!Number.isSafeInteger(distanceMm) || distanceMm <= 0) throw new RequirementPlanningError("INVALID_SPATIAL_DISTANCE");
    }
    signals.spatialConstraints.push({
      sourceNodeId: node.nodeId,
      operator: operator as SpatialConstraint["operator"],
      approximate: expression["approximate"] === true,
      ...(distanceMm === undefined ? {} : { distanceMm })
    });
  }
  signals.expectedReferenceKinds = [...expectedKinds].sort();
  signals.spatialConstraints.sort((left, right) => left.sourceNodeId.localeCompare(right.sourceNodeId));
  signals.unsupportedSpatialNodeIds.sort();
  signals.explicitProductIds = [...new Set(signals.explicitProductIds)].sort();
  return signals;
}

function tokenSources(signals: GraphSignals, vocabulary: ReadonlySet<string>): string[] {
  const sources = new Set<string>();
  for (const token of vocabulary) {
    for (const source of signals.tokenSourceNodeIds.get(token) ?? []) sources.add(source);
  }
  return [...sources].sort();
}

function firstRequestedProduct(products: readonly RequestedProduct[], preferred: readonly RequestedProduct[]): RequestedProduct {
  return preferred.find((product) => products.includes(product)) ?? products[0]!;
}

function makeGap(
  reason: PlannerCapabilityGapReason,
  semanticCapability: string,
  requiredForProduct: RequestedProduct,
  sourceNodeIds: readonly string[]
): PlannerCapabilityGap {
  const sortedSources = [...new Set(sourceNodeIds)].sort();
  return {
    gapId: stableId("gap", { reason, semanticCapability, requiredForProduct, sourceNodeIds: sortedSources }),
    semanticCapability,
    reason,
    requiredForProduct,
    blocking: true,
    details: {
      sourceNodeIds: sortedSources,
      substitution: "FORBIDDEN",
      fabricatedQuery: false
    }
  };
}

function recipe(id: StableRecipeId): StableRequirementRecipe {
  const value = recipeById.get(id);
  if (!value) throw new RequirementPlanningError(`UNKNOWN_STABLE_RECIPE:${id}`);
  return value;
}

function requirementKey(type: RequirementType, product: RequestedProduct): string {
  return `${type}:${product}`;
}

function dependencyKey(dependency: DependencyAccumulator): string {
  return `${dependency.fromKey}>${dependency.toKey}:${dependency.outputName}:${dependency.targetPath}`;
}

function inputsForRequirement(
  accumulator: RequirementAccumulator,
  signals: GraphSignals,
  groundedProductIntents: readonly GroundedGeospatialProductIntent[]
): Record<string, PlannerJson> {
  const sourceNodeIds = [...accumulator.sourceNodeIds].sort();
  const common = sourceNodeIds.length === 0 ? {} : { sourceNodeIds };
  switch (accumulator.requirementType) {
    case "RESOLVE_REFERENCE":
      return {
        ...common,
        mentionNodeIds: signals.mentionNodeIds,
        expectedReferenceKinds: signals.expectedReferenceKinds
      };
    case "VALIDATE_REFERENCE":
      return { ...common, referenceNodeIds: signals.referenceNodeIds };
    case "READ_CURRENT_STATE":
    case "READ_GEOMETRY":
    case "READ_PROVENANCE":
      return { ...common, referenceNodeIds: signals.referenceNodeIds };
    case "READ_LAND_COVER":
    case "READ_TERRAIN_CLASS":
    case "READ_ELEVATION":
    case "READ_SURFACE_MATERIAL":
    case "READ_TRAVERSABILITY":
    case "FIND_HIGH_GROUND":
    case "FIND_WATER":
    case "FIND_WETLANDS":
    case "FIND_BUILDINGS":
    case "FIND_OBSTACLES":
    case "FIND_BLOCKED_AREAS":
    case "EXPLAIN_TRAVERSABILITY":
      return {
        ...common,
        referenceNodeIds: signals.referenceNodeIds,
        spatialConstraints: signals.spatialConstraints.map((constraint) => ({
          sourceNodeId: constraint.sourceNodeId,
          operator: constraint.operator,
          approximate: constraint.approximate,
          ...(constraint.distanceMm === undefined ? {} : { distanceMm: constraint.distanceMm })
        })),
        explicitProductIds: signals.explicitProductIds
      };
    case "READ_GEO_PRODUCT_VALUE":
    case "READ_GEO_PRODUCT_PROFILE":
    case "FIND_GEO_PRODUCT_CLASS_AREAS":
    case "FIND_GEO_PRODUCT_VALUE_RANGE_AREAS":
    case "FIND_GEO_VECTOR_FEATURES_IN_AREA":
    case "FIND_GEO_VECTOR_FEATURES_NEARBY":
    case "FIND_GEO_VECTOR_INTERSECTIONS": {
      const sourceSet = new Set(sourceNodeIds);
      const intents = groundedProductIntents.filter((intent) =>
        intent.sourceNodeIds.some((source) => sourceSet.has(source))
      );
      return {
        ...common,
        referenceNodeIds: signals.referenceNodeIds,
        descriptorIntents: intents.map((intent) => ({
          intentId: intent.intentId,
          descriptorId: intent.descriptorId,
          descriptorHash: intent.descriptorHash,
          productType: intent.productType,
          productProfile: intent.productProfile,
          representation: intent.representation,
          queryProfile: intent.queryProfile,
          ...(intent.explicitProductId ? { explicitProductId: intent.explicitProductId } : {}),
          ...(intent.classCodes ? { classCodes: intent.classCodes } : {}),
          ...(intent.ranges ? { ranges: intent.ranges as PlannerJson } : {}),
          ...(intent.propertyFilters ? { propertyFilters: intent.propertyFilters as PlannerJson } : {}),
          ...(intent.platformProfile ? { platformProfile: intent.platformProfile } : {}),
          ...(intent.spatialConstraint ? { spatialConstraint: intent.spatialConstraint as PlannerJson } : {})
        }))
      };
    }
    case "SEARCH_CATALOG":
      return {
        ...common,
        mentionNodeIds: signals.mentionNodeIds,
        expectedReferenceKinds: signals.expectedReferenceKinds
      };
    case "SPATIAL_NEARBY":
    case "SPATIAL_IN_AREA":
    case "SPATIAL_INTERSECTS": {
      const acceptedOperators: ReadonlySet<SpatialConstraint["operator"]> = accumulator.requirementType === "SPATIAL_NEARBY"
        ? new Set(["NEAR"])
        : accumulator.requirementType === "SPATIAL_IN_AREA" ? new Set(["WITHIN", "CONTAINS"]) : new Set(["INTERSECTS"]);
      const constraints = signals.spatialConstraints
        .filter((constraint) => acceptedOperators.has(constraint.operator))
        .map((constraint) => ({
          sourceNodeId: constraint.sourceNodeId,
          operator: constraint.operator,
          approximate: constraint.approximate,
          ...(constraint.distanceMm === undefined ? {} : { distanceMm: constraint.distanceMm })
        }));
      return { ...common, referenceNodeIds: signals.referenceNodeIds, spatialConstraints: constraints };
    }
    case "EXACT_VERIFY":
      return { ...common, exactness: "EXACT" };
    case "VALIDATE_RESULT":
      return { ...common, resultNodeIds: signals.priorResultNodeIds };
  }
}

function normalizedInputGraph(graph: GroundingGraph): GroundingGraph {
  return {
    schemaVersion: graph.schemaVersion,
    nodes: [...graph.nodes]
      .map((node) => ({ ...node, payload: structuredClone(node.payload) }))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    edges: [...graph.edges]
      .map((edge) => ({ ...edge }))
      .sort((left, right) => left.edgeId.localeCompare(right.edgeId))
  };
}

export class SemanticRequirementPlanner {
  plan(input: RequirementPlannerInput): RequirementPlanningResult {
    validateGroundingGraphInput(input.groundingGraph);
    validateExecutionPolicy(input.executionPolicy);
    const products = normalizeRequestedProducts(input.requestedProducts);
    const signals = collectSignals(input.groundingGraph);
    const groundedProductIntents = [...(input.groundedProductIntents ?? [])]
      .sort((left, right) => left.intentId.localeCompare(right.intentId));
    const worldPlanningRequested = products.some((product) => !localProducts.has(product));
    if (!worldPlanningRequested) {
      return { status: "NO_WORLD_QUERY_REQUIRED", graph: null, selectedRecipeIds: [], capabilityGaps: [] };
    }

    const primaryProduct = firstRequestedProduct(products, ["WORLD_QUERY", "WORLD_EVIDENCE", "REFERENCE_SETS", "RESOLVED_REFERENCES"]);
    const gaps: PlannerCapabilityGap[] = [];
    const terrainSources = tokenSources(signals, terrainTokens);
    const visibilitySources = tokenSources(signals, visibilityTokens);
    if (terrainSources.length > 0 && !groundedProductIntents.some((intent) => ["SLOPE", "ASPECT", "TERRAIN_ROUGHNESS"].includes(intent.productType))) {
      gaps.push(makeGap("TERRAIN_CAPABILITY_REQUIRED", "TERRAIN", primaryProduct, terrainSources));
    }
    if (visibilitySources.length > 0) gaps.push(makeGap("VISIBILITY_CAPABILITY_REQUIRED", "VISIBILITY", primaryProduct, visibilitySources));
    if (signals.unsupportedSpatialNodeIds.length > 0) {
      gaps.push(makeGap("UNSUPPORTED_EXPRESSION", "UNSUPPORTED_SPATIAL_RELATION", primaryProduct, signals.unsupportedSpatialNodeIds));
    }
    const floodSources = tokenSources(signals, floodRiskTokens);
    if (floodSources.length > 0 && !groundedProductIntents.some((intent) => intent.productType === "FLOOD_RISK")) {
      gaps.push(makeGap("UNSUPPORTED_EXPRESSION", "FLOOD_RISK", primaryProduct, floodSources));
    }
    for (const product of products.filter((value) => previewOnlyProducts.has(value))) {
      gaps.push(makeGap("UNSUPPORTED_EXPRESSION", product, product, []));
    }

    const selected = new Map<StableRecipeId, SelectedRecipe>();
    const addRecipe = (id: StableRecipeId, requiredForProduct: RequestedProduct, sourceNodeIds: readonly string[]): void => {
      const existing = selected.get(id);
      if (existing) {
        sourceNodeIds.forEach((source) => existing.sourceNodeIds.add(source));
        return;
      }
      selected.set(id, { recipe: recipe(id), requiredForProduct, sourceNodeIds: new Set(sourceNodeIds) });
    };

    const needsQuery = products.includes("WORLD_QUERY") || products.includes("WORLD_EVIDENCE");
    const needsReferenceSet = products.includes("REFERENCE_SETS");
    const queryProduct = products.includes("WORLD_QUERY") ? "WORLD_QUERY" : products.includes("WORLD_EVIDENCE") ? "WORLD_EVIDENCE" : "REFERENCE_SETS";
    const nearbySources = signals.spatialConstraints.filter((entry) => entry.operator === "NEAR").map((entry) => entry.sourceNodeId);
    const inAreaSources = signals.spatialConstraints.filter((entry) => entry.operator === "WITHIN" || entry.operator === "CONTAINS").map((entry) => entry.sourceNodeId);
    const intersectionSources = signals.spatialConstraints.filter((entry) => entry.operator === "INTERSECTS").map((entry) => entry.sourceNodeId);
    const gdpsSelections: Array<readonly [StableRecipeId, readonly string[]]> = [
      ["GDPS_LAND_COVER_AT_REFERENCE", tokenSources(signals, landCoverTokens)],
      ["GDPS_WETLANDS_IN_AREA", tokenSources(signals, wetlandTokens)],
      ["GDPS_OBSTACLES_NEAR_REFERENCE", tokenSources(signals, obstacleTokens)],
      ["GDPS_BLOCKED_AREAS_IN_AREA", tokenSources(signals, blockedAreaTokens)],
      ["GDPS_ELEVATION_AT_REFERENCE", tokenSources(signals, elevationTokens)],
      ["GDPS_TRAVERSABILITY_EXPLAIN_AT_REFERENCE", tokenSources(signals, traversabilityExplainTokens)]
    ];
    for (const [recipeId, sources] of gdpsSelections) {
      if (sources.length > 0 && needsQuery) addRecipe(recipeId, queryProduct, sources);
    }
    const genericRecipeByProfile: Readonly<Record<GroundedGeospatialProductIntent["queryProfile"], StableRecipeId>> = {
      SAMPLE_VALUE: "GDPS_GENERIC_SAMPLE_VALUE",
      SAMPLE_CLASS: "GDPS_GENERIC_SAMPLE_VALUE",
      PROFILE_VALUE: "GDPS_GENERIC_PROFILE_VALUE",
      FIND_CLASS: "GDPS_GENERIC_FIND_CLASS",
      FIND_VALUE_RANGE: "GDPS_GENERIC_FIND_RANGE",
      VECTOR_IN_AREA: "GDPS_GENERIC_VECTOR_IN_AREA",
      VECTOR_NEARBY: "GDPS_GENERIC_VECTOR_NEARBY",
      VECTOR_INTERSECTS: "GDPS_GENERIC_VECTOR_INTERSECTS"
    };
    for (const intent of groundedProductIntents) {
      if (needsQuery) addRecipe(genericRecipeByProfile[intent.queryProfile], queryProduct, intent.sourceNodeIds);
    }
    const highGroundSources = tokenSources(signals, highGroundTokens);
    if (highGroundSources.length > 0 && needsQuery) {
      if (nearbySources.length > 0) {
        gaps.push(makeGap("GOWM_GEOMETRY_BUFFER_CAPABILITY_REQUIRED", "METRE_GEOMETRY_BUFFER", queryProduct, highGroundSources));
      } else if (inAreaSources.length > 0) {
        addRecipe("GDPS_HIGH_GROUND_IN_AREA", queryProduct, highGroundSources);
      }
    }
    const gdpsRecipeIds = new Set<StableRecipeId>([
      ...gdpsSelections.map(([id]) => id), "GDPS_HIGH_GROUND_IN_AREA",
      ...Object.values(genericRecipeByProfile)
    ]);
    const gdpsRecipeSelected = [...selected.keys()].some((id) => gdpsRecipeIds.has(id)) || highGroundSources.length > 0;
    if (needsQuery || needsReferenceSet) {
      if (!gdpsRecipeSelected && nearbySources.length > 0) addRecipe("REFERENCE_NEARBY", queryProduct, nearbySources);
      if (!gdpsRecipeSelected && inAreaSources.length > 0) addRecipe("REFERENCE_IN_AREA", queryProduct, inAreaSources);
      if (!gdpsRecipeSelected && intersectionSources.length > 0) addRecipe("REFERENCE_INTERSECTIONS", queryProduct, intersectionSources);
    }

    if (signals.priorResultNodeIds.length > 0 && (needsQuery || products.includes("RESOLVED_REFERENCES"))) {
      addRecipe("PRIOR_RESULT_REVALIDATION", products.includes("RESOLVED_REFERENCES") ? "RESOLVED_REFERENCES" : queryProduct, signals.priorResultNodeIds);
    }

    const spatialRecipeSelected = ["REFERENCE_NEARBY", "REFERENCE_IN_AREA", "REFERENCE_INTERSECTIONS",
      "GDPS_LAND_COVER_AT_REFERENCE", "GDPS_WETLANDS_IN_AREA", "GDPS_OBSTACLES_NEAR_REFERENCE",
      "GDPS_BLOCKED_AREAS_IN_AREA", "GDPS_HIGH_GROUND_IN_AREA", "GDPS_ELEVATION_AT_REFERENCE",
      "GDPS_TRAVERSABILITY_EXPLAIN_AT_REFERENCE"]
      .some((id) => selected.has(id as StableRecipeId));
    if (needsReferenceSet && !spatialRecipeSelected && !gdpsRecipeSelected) {
      addRecipe("CATALOG_SEARCH", "REFERENCE_SETS", tokenSources(signals, catalogTokens));
    }

    if (needsQuery && !spatialRecipeSelected && !gdpsRecipeSelected) {
      const currentSources = tokenSources(signals, currentStateTokens);
      const geometrySources = tokenSources(signals, geometryTokens);
      const provenanceSources = tokenSources(signals, provenanceTokens);
      if (currentSources.length > 0) addRecipe("REFERENCE_CURRENT_STATE", queryProduct, currentSources);
      if (geometrySources.length > 0) addRecipe("REFERENCE_GEOMETRY", queryProduct, geometrySources);
      if (provenanceSources.length > 0) addRecipe("REFERENCE_PROVENANCE", queryProduct, provenanceSources);
      const hasExplicitStableMeaning = currentSources.length + geometrySources.length + provenanceSources.length > 0;
      if (!hasExplicitStableMeaning && signals.priorResultNodeIds.length === 0 && gaps.length === 0) {
        gaps.push(makeGap("UNSUPPORTED_EXPRESSION", "WORLD_QUERY_SEMANTICS_REQUIRED", queryProduct, []));
      }
    }

    const selectedCoversReferences = [...selected.values()].some((entry) =>
      entry.recipe.requestedProducts.includes("RESOLVED_REFERENCES")
    );
    if (products.includes("RESOLVED_REFERENCES") && !selectedCoversReferences) {
      addRecipe("REFERENCE_IDENTITY", "RESOLVED_REFERENCES", []);
    }

    if (selected.size === 0) {
      return {
        status: gaps.length > 0 ? "CAPABILITY_GAP" : "NO_WORLD_QUERY_REQUIRED",
        graph: null,
        selectedRecipeIds: [],
        capabilityGaps: gaps.sort((left, right) => left.gapId.localeCompare(right.gapId))
      };
    }

    const normalizedGraph = normalizedInputGraph(input.groundingGraph);
    const graphId = stableId("requirement-graph", {
      groundingGraph: normalizedGraph,
      requestedProducts: [...products].sort(),
      executionPolicy: input.executionPolicy,
      groundedProductIntents
    });
    const accumulators = new Map<string, RequirementAccumulator>();
    const dependencyAccumulators = new Map<string, DependencyAccumulator>();
    const addRequirement = (
      requirementType: RequirementType,
      requiredForProduct: RequestedProduct,
      allowApproximation: boolean,
      sourceNodeIds: ReadonlySet<string>
    ): string => {
      const key = requirementKey(requirementType, requiredForProduct);
      const existing = accumulators.get(key);
      if (existing) {
        sourceNodeIds.forEach((source) => existing.sourceNodeIds.add(source));
        existing.allowApproximation = existing.allowApproximation && allowApproximation;
      } else {
        accumulators.set(key, {
          requirementType,
          requiredForProduct,
          allowApproximation,
          sourceNodeIds: new Set(sourceNodeIds)
        });
      }
      return key;
    };
    const addDependency = (fromKey: string, toKey: string): void => {
      const fromType = accumulators.get(fromKey)!.requirementType;
      const toType = accumulators.get(toKey)!.requirementType;
      const dependency: DependencyAccumulator = {
        fromKey,
        toKey,
        outputName: outputByRequirement[fromType],
        targetPath: targetByRequirement[toType]
      };
      dependencyAccumulators.set(dependencyKey(dependency), dependency);
    };

    for (const entry of [...selected.values()].sort((left, right) => left.recipe.recipeId.localeCompare(right.recipe.recipeId))) {
      const keys = entry.recipe.requirements.map((type) =>
        addRequirement(type, entry.requiredForProduct, input.executionPolicy.allowApproximation && entry.recipe.allowApproximation, entry.sourceNodeIds)
      );
      for (let index = 1; index < keys.length; index += 1) addDependency(keys[index - 1]!, keys[index]!);
      const spatialType = entry.recipe.requirements.find((type) => type.startsWith("SPATIAL_"));
      if (spatialType) {
        const relevantConstraints = signals.spatialConstraints.filter((constraint) => entry.sourceNodeIds.has(constraint.sourceNodeId));
        const exactVerificationRequired = signals.hasApproximateCandidate || relevantConstraints.some((constraint) => constraint.approximate);
        if (exactVerificationRequired && (!input.executionPolicy.allowApproximation || !entry.recipe.allowApproximation)) {
          const spatialKey = requirementKey(spatialType, entry.requiredForProduct);
          const exactKey = addRequirement("EXACT_VERIFY", entry.requiredForProduct, false, entry.sourceNodeIds);
          addDependency(spatialKey, exactKey);
        }
      }
    }

    if (accumulators.size > input.executionPolicy.maxQueryOperations) {
      throw new RequirementPlanningError("REQUIREMENT_BUDGET_EXCEEDED");
    }

    const requirementIdByKey = new Map<string, string>();
    for (const key of accumulators.keys()) requirementIdByKey.set(key, stableId("requirement", { graphId, key }));
    const requirements: WorldQueryRequirement[] = [...accumulators.entries()].map(([key, accumulator]) => ({
      requirementId: requirementIdByKey.get(key)!,
      requirementType: accumulator.requirementType,
      requiredForProduct: accumulator.requiredForProduct,
      required: true,
      allowApproximation: accumulator.allowApproximation,
      inputs: inputsForRequirement(accumulator, signals, groundedProductIntents),
      outputs: [outputByRequirement[accumulator.requirementType]]
    })).sort((left, right) =>
      requirementTypes.indexOf(left.requirementType) - requirementTypes.indexOf(right.requirementType) ||
      left.requirementId.localeCompare(right.requirementId)
    );
    const dependencies: RequirementDependency[] = [...dependencyAccumulators.values()].map((dependency) => ({
      fromRequirementId: requirementIdByKey.get(dependency.fromKey)!,
      toRequirementId: requirementIdByKey.get(dependency.toKey)!,
      outputName: dependency.outputName,
      targetPath: dependency.targetPath
    })).sort((left, right) =>
      left.fromRequirementId.localeCompare(right.fromRequirementId) || left.toRequirementId.localeCompare(right.toRequirementId)
    );
    const graph: WorldQueryRequirementGraph = {
      schemaVersion: "1.0",
      graphId,
      requirements,
      dependencies,
      graphHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    };
    graph.graphHash = canonicalRequirementGraphHash(graph);
    validateWorldQueryRequirementGraph(graph);
    return {
      status: gaps.length > 0 ? "CAPABILITY_GAP" : "PLANNED",
      graph,
      selectedRecipeIds: [...selected.keys()].sort(),
      capabilityGaps: gaps.sort((left, right) => left.gapId.localeCompare(right.gapId))
    };
  }
}
