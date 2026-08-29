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
  },
  {
    recipeId: "GDPS_LAND_COVER_AT_REFERENCE",
    maturity: "PREVIEW",
    requirements: ["RESOLVE_REFERENCE", "READ_CURRENT_STATE", "READ_LAND_COVER"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "BEST_EFFORT",
    allowApproximation: false
  },
  {
    recipeId: "GDPS_WETLANDS_IN_AREA",
    maturity: "PREVIEW",
    requirements: ["RESOLVE_REFERENCE", "READ_GEOMETRY", "FIND_WETLANDS"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "BEST_EFFORT",
    allowApproximation: false
  },
  {
    recipeId: "GDPS_OBSTACLES_NEAR_REFERENCE",
    maturity: "PREVIEW",
    requirements: ["RESOLVE_REFERENCE", "READ_CURRENT_STATE", "FIND_OBSTACLES"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "BEST_EFFORT",
    allowApproximation: false
  },
  {
    recipeId: "GDPS_BLOCKED_AREAS_IN_AREA",
    maturity: "PREVIEW",
    requirements: ["RESOLVE_REFERENCE", "READ_GEOMETRY", "FIND_BLOCKED_AREAS"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "BEST_EFFORT",
    allowApproximation: false
  },
  {
    recipeId: "GDPS_HIGH_GROUND_IN_AREA",
    maturity: "PREVIEW",
    requirements: ["RESOLVE_REFERENCE", "READ_GEOMETRY", "FIND_HIGH_GROUND"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "BEST_EFFORT",
    allowApproximation: false
  },
  {
    recipeId: "GDPS_ELEVATION_AT_REFERENCE",
    maturity: "PREVIEW",
    requirements: ["RESOLVE_REFERENCE", "READ_CURRENT_STATE", "READ_ELEVATION"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "BEST_EFFORT",
    allowApproximation: false
  },
  {
    recipeId: "GDPS_TRAVERSABILITY_EXPLAIN_AT_REFERENCE",
    maturity: "PREVIEW",
    requirements: ["RESOLVE_REFERENCE", "READ_CURRENT_STATE", "EXPLAIN_TRAVERSABILITY"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "BEST_EFFORT",
    allowApproximation: false
  },
  {
    recipeId: "GDPS_GENERIC_SAMPLE_VALUE",
    maturity: "PREVIEW",
    requirements: ["RESOLVE_REFERENCE", "READ_CURRENT_STATE", "READ_GEO_PRODUCT_VALUE"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "BEST_EFFORT",
    allowApproximation: false
  },
  {
    recipeId: "GDPS_GENERIC_PROFILE_VALUE",
    maturity: "PREVIEW",
    requirements: ["RESOLVE_REFERENCE", "READ_GEOMETRY", "READ_GEO_PRODUCT_PROFILE"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "BEST_EFFORT",
    allowApproximation: false
  },
  {
    recipeId: "GDPS_GENERIC_FIND_CLASS",
    maturity: "PREVIEW",
    requirements: ["RESOLVE_REFERENCE", "READ_GEOMETRY", "FIND_GEO_PRODUCT_CLASS_AREAS"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "BEST_EFFORT",
    allowApproximation: false
  },
  {
    recipeId: "GDPS_GENERIC_FIND_RANGE",
    maturity: "PREVIEW",
    requirements: ["RESOLVE_REFERENCE", "READ_GEOMETRY", "FIND_GEO_PRODUCT_VALUE_RANGE_AREAS"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "BEST_EFFORT",
    allowApproximation: false
  },
  {
    recipeId: "GDPS_GENERIC_VECTOR_IN_AREA",
    maturity: "PREVIEW",
    requirements: ["RESOLVE_REFERENCE", "READ_GEOMETRY", "FIND_GEO_VECTOR_FEATURES_IN_AREA"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "BEST_EFFORT",
    allowApproximation: false
  },
  {
    recipeId: "GDPS_GENERIC_VECTOR_NEARBY",
    maturity: "PREVIEW",
    requirements: ["RESOLVE_REFERENCE", "READ_CURRENT_STATE", "FIND_GEO_VECTOR_FEATURES_NEARBY"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "BEST_EFFORT",
    allowApproximation: false
  },
  {
    recipeId: "GDPS_GENERIC_VECTOR_INTERSECTS",
    maturity: "PREVIEW",
    requirements: ["RESOLVE_REFERENCE", "READ_GEOMETRY", "FIND_GEO_VECTOR_INTERSECTIONS"],
    requestedProducts: ["RESOLVED_REFERENCES", "WORLD_EVIDENCE"],
    defaultSnapshotPolicy: "BEST_EFFORT",
    allowApproximation: false
  }
] as const satisfies readonly StableRequirementRecipe[];
