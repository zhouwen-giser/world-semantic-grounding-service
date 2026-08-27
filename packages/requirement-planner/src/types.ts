import type { GroundingGraph } from "@wsgs/contracts";

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
  "PRIOR_RESULT_REVALIDATION"
] as const;

export type StableRecipeId = (typeof stableRecipeIds)[number];

export interface StableRequirementRecipe {
  recipeId: StableRecipeId;
  maturity: "STABLE";
  requirements: readonly RequirementType[];
  requestedProducts: readonly RequestedProduct[];
  defaultSnapshotPolicy: SnapshotPolicy;
  allowApproximation: boolean;
}

export type PlannerCapabilityGapReason =
  | "UNSUPPORTED_EXPRESSION"
  | "TERRAIN_CAPABILITY_REQUIRED"
  | "VISIBILITY_CAPABILITY_REQUIRED";

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
  requestedProducts: readonly string[];
  executionPolicy: WorldQueryExecutionPolicy;
}

export interface RequirementPlanningResult {
  status: "PLANNED" | "CAPABILITY_GAP" | "NO_WORLD_QUERY_REQUIRED";
  graph: WorldQueryRequirementGraph | null;
  selectedRecipeIds: StableRecipeId[];
  capabilityGaps: PlannerCapabilityGap[];
}
