import type { StableRequirementRecipe } from "./types.js";

export const stableRecipeCatalog = [
  {
    recipeId: "REFERENCE_IDENTITY",
    maturity: "STABLE",
    requirements: ["RESOLVE_REFERENCE", "VALIDATE_REFERENCE"],
    requestedProducts: ["RESOLVED_REFERENCES"],
    defaultSnapshotPolicy: "LATEST_AT_START",
    allowApproximation: false
  },
  {
    recipeId: "REFERENCE_CURRENT_STATE",
    maturity: "STABLE",
    requirements: ["RESOLVE_REFERENCE", "READ_CURRENT_STATE"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "LATEST_AT_START",
    allowApproximation: false
  },
  {
    recipeId: "REFERENCE_GEOMETRY",
    maturity: "STABLE",
    requirements: ["RESOLVE_REFERENCE", "READ_GEOMETRY"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "LATEST_AT_START",
    allowApproximation: false
  },
  {
    recipeId: "REFERENCE_PROVENANCE",
    maturity: "STABLE",
    requirements: ["RESOLVE_REFERENCE", "READ_PROVENANCE"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "LATEST_AT_START",
    allowApproximation: false
  },
  {
    recipeId: "CATALOG_SEARCH",
    maturity: "STABLE",
    requirements: ["SEARCH_CATALOG"],
    requestedProducts: ["REFERENCE_SETS"],
    defaultSnapshotPolicy: "LATEST_AT_START",
    allowApproximation: false
  },
  {
    recipeId: "REFERENCE_NEARBY",
    maturity: "STABLE",
    requirements: ["RESOLVE_REFERENCE", "SPATIAL_NEARBY"],
    requestedProducts: ["RESOLVED_REFERENCES", "REFERENCE_SETS", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "LATEST_AT_START",
    allowApproximation: false
  },
  {
    recipeId: "REFERENCE_IN_AREA",
    maturity: "STABLE",
    requirements: ["RESOLVE_REFERENCE", "SPATIAL_IN_AREA"],
    requestedProducts: ["RESOLVED_REFERENCES", "REFERENCE_SETS", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "LATEST_AT_START",
    allowApproximation: false
  },
  {
    recipeId: "REFERENCE_INTERSECTIONS",
    maturity: "STABLE",
    requirements: ["RESOLVE_REFERENCE", "SPATIAL_INTERSECTS"],
    requestedProducts: ["RESOLVED_REFERENCES", "REFERENCE_SETS", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "LATEST_AT_START",
    allowApproximation: false
  },
  {
    recipeId: "PRIOR_RESULT_REVALIDATION",
    maturity: "STABLE",
    requirements: ["VALIDATE_REFERENCE", "VALIDATE_RESULT"],
    requestedProducts: ["RESOLVED_REFERENCES"],
    defaultSnapshotPolicy: "PINNED",
    allowApproximation: false
  }
] as const satisfies readonly StableRequirementRecipe[];
