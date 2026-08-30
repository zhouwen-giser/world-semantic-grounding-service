export const REQUIREMENT_PLANNER_VERSION = "wsgs-requirement-planner/2.0" as const;

export { stableRecipeCatalog } from "./catalog.js";
export { RequirementPlanningError, SemanticRequirementPlanner } from "./planner.js";
export {
  canonicalRequirementGraphHash,
  RequirementGraphValidationError,
  validateWorldQueryRequirementGraph
} from "./validation.js";
export {
  requestedProducts,
  requirementTypes,
  stableRecipeIds
} from "./types.js";
export type {
  PlannerCapabilityGap,
  PlannerCapabilityGapReason,
  PlannerJson,
  RequestedProduct,
  RequirementDependency,
  RequirementPlannerInput,
  RequirementPlanningResult,
  RequirementType,
  SnapshotPolicy,
  StableRecipeId,
  StableRequirementRecipe,
  WorldQueryExecutionPolicy,
  WorldQueryRequirement,
  WorldQueryRequirementGraph
} from "./types.js";
export type { GroundedGeospatialProductIntent } from "@wsgs/gdps-descriptor-consumer";
