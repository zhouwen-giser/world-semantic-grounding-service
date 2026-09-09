import type { GroundingGraph } from "@wsgs/contracts";
import type { GroundedGeospatialProductIntent } from "@wsgs/gdps-descriptor-consumer";
import type { HistoricalRequirementPlan, HistoricalTraceIntent } from "@wsgs/historical-trace-consumer";

export const requirementTypes = [
  "RESOLVE_REFERENCE",
  "VALIDATE_REFERENCE",
  "READ_CURRENT_STATE",
  "READ_GEOMETRY",
  "READ_PROVENANCE",
  "SEARCH_CATALOG",
  "SPATIAL_NEARBY",
  "SPATIAL_IN_AREA",
  "SPATIAL_INTERSECTS",
  "READ_LAND_COVER",
  "READ_TERRAIN_CLASS",
  "READ_ELEVATION",
  "READ_SURFACE_MATERIAL",
  "READ_TRAVERSABILITY",
  "FIND_HIGH_GROUND",
  "FIND_WATER",
  "FIND_WETLANDS",
  "FIND_BUILDINGS",
  "FIND_OBSTACLES",
  "FIND_BLOCKED_AREAS",
  "EXPLAIN_TRAVERSABILITY",
  "READ_GEO_PRODUCT_VALUE",
  "READ_GEO_PRODUCT_PROFILE",
  "FIND_GEO_PRODUCT_CLASS_AREAS",
  "FIND_GEO_PRODUCT_VALUE_RANGE_AREAS",
  "FIND_GEO_VECTOR_FEATURES_IN_AREA",
  "FIND_GEO_VECTOR_FEATURES_NEARBY",
  "FIND_GEO_VECTOR_INTERSECTIONS",
  "FIND_RELEVANT_OPERATIONAL_TASK",
  "READ_OPERATIONAL_TASK",
  "READ_TASK_EXECUTION_INTERVAL",
  "READ_HISTORICAL_TRAJECTORY",
  "READ_TRAJECTORY_COMPLETENESS",
  "READ_TRAJECTORY_GAPS",
  "EXACT_VERIFY",
  "VALIDATE_RESULT"
] as const;

export type RequirementType = (typeof requirementTypes)[number];

export const requestedProducts = [
  "MENTIONS",
  "RESOLVED_REFERENCES",
  "DERIVED_REFERENCES",
  "REFERENCE_SETS",
  "GROUNDING_GRAPH",
  "WORLD_QUERY",
  "WORLD_EVIDENCE",
  "OPERATIONAL_TASKS",
  "EVENT_TIMELINES",
  "CORRELATION_FINDINGS",
  "PREDICATE_EVALUATIONS"
] as const;

export type RequestedProduct = (typeof requestedProducts)[number];
export type SnapshotPolicy = "LATEST_AT_START" | "PINNED" | "BEST_EFFORT";

export type PlannerJson =
  | null
  | boolean
  | number
  | string
  | PlannerJson[]
  | { [key: string]: PlannerJson };

export interface WorldQueryExecutionPolicy {
  readOnly: true;
  deadlineMs: number;
  maxQueryOperations: number;
  maxCandidatesPerMention: number;
  maxResultBytes: number;
  allowApproximation: boolean;
}

export interface WorldQueryRequirement {
  requirementId: string;
  requirementType: RequirementType;
  requiredForProduct: RequestedProduct;
  required: boolean;
  allowApproximation: boolean;
  inputs: Record<string, PlannerJson>;
  outputs: string[];
}

export interface RequirementDependency {
  fromRequirementId: string;
  toRequirementId: string;
  outputName?: string;
  targetPath?: string;
}

export interface WorldQueryRequirementGraph {
  schemaVersion: "1.0";
  graphId: string;
  requirements: WorldQueryRequirement[];
  dependencies: RequirementDependency[];
  graphHash: `sha256:${string}`;
}

export const stableRecipeIds = [
  "REFERENCE_IDENTITY",
  "REFERENCE_CURRENT_STATE",
  "REFERENCE_GEOMETRY",
  "REFERENCE_PROVENANCE",
  "CATALOG_SEARCH",
  "REFERENCE_NEARBY",
  "REFERENCE_IN_AREA",
  "REFERENCE_INTERSECTIONS",
  "PRIOR_RESULT_REVALIDATION",
  "GDPS_LAND_COVER_AT_REFERENCE",
  "GDPS_WETLANDS_IN_AREA",
  "GDPS_OBSTACLES_NEAR_REFERENCE",
  "GDPS_BLOCKED_AREAS_IN_AREA",
  "GDPS_HIGH_GROUND_IN_AREA",
  "GDPS_ELEVATION_AT_REFERENCE",
  "GDPS_TRAVERSABILITY_EXPLAIN_AT_REFERENCE",
  "GDPS_GENERIC_SAMPLE_VALUE",
  "GDPS_GENERIC_PROFILE_VALUE",
  "GDPS_GENERIC_FIND_CLASS",
  "GDPS_GENERIC_FIND_RANGE",
  "GDPS_GENERIC_VECTOR_IN_AREA",
  "GDPS_GENERIC_VECTOR_NEARBY",
  "GDPS_GENERIC_VECTOR_INTERSECTS",
  "HISTORICAL_EXECUTION_INTERVAL",
  "HISTORICAL_TRAJECTORY"
] as const;

export type StableRecipeId = (typeof stableRecipeIds)[number];

export interface StableRequirementRecipe {
  recipeId: StableRecipeId;
  maturity: "STABLE" | "PREVIEW";
  requirements: readonly RequirementType[];
  requestedProducts: readonly RequestedProduct[];
  defaultSnapshotPolicy: SnapshotPolicy;
  allowApproximation: boolean;
}

export type PlannerCapabilityGapReason =
  | "UNSUPPORTED_EXPRESSION"
  | "TERRAIN_CAPABILITY_REQUIRED"
  | "VISIBILITY_CAPABILITY_REQUIRED"
  | "GOWM_GEOMETRY_BUFFER_CAPABILITY_REQUIRED"
  | "AMBIGUOUS"
  | "DESCRIPTOR_NOT_FOUND"
  | "QUERY_PROFILE_UNSUPPORTED"
  | "CLASS_CODE_UNSUPPORTED"
  | "VALUE_RANGE_INVALID"
  | "UNIT_MISMATCH"
  | "PROPERTY_FILTER_UNSUPPORTED"
  | "PLATFORM_PROFILE_REQUIRED"
  | "PLATFORM_PROFILE_FORBIDDEN"
  | "DESCRIPTOR_LOCK_DRIFT"
  | "RECIPE_NOT_FOUND"
  | "AMBIGUOUS_RECIPE";

export interface PlannerCapabilityGap {
  gapId: string;
  semanticCapability: string;
  reason: PlannerCapabilityGapReason;
  requiredForProduct: RequestedProduct;
  blocking: true;
  details: Record<string, PlannerJson>;
}

export interface RequirementPlannerInput {
  groundingGraph: GroundingGraph;
  groundedProductIntents?: readonly GroundedGeospatialProductIntent[];
  requestedProducts: readonly string[];
  executionPolicy: WorldQueryExecutionPolicy;
  historicalTrace?: {
    intent: HistoricalTraceIntent;
    enabled: boolean;
    priorFindingReusable?: boolean;
  };
}

export interface RequirementPlanningResult {
  status: "PLANNED" | "CAPABILITY_GAP" | "NO_WORLD_QUERY_REQUIRED";
  graph: WorldQueryRequirementGraph | null;
  selectedRecipeIds: StableRecipeId[];
  capabilityGaps: PlannerCapabilityGap[];
  historicalIntent?: HistoricalTraceIntent;
  historicalPlan?: HistoricalRequirementPlan;
}
