/* Generated from the locked WSGS v0.2 GDPS JSON Schemas. Do not edit directly. */

export interface UrnWsgsLockedGdpsRecipe20 {
  schemaVersion: "wsgs-locked-gdps-recipe/2.0";
  recipeId: string;
  semanticPattern:
    | "GDPS_LAND_COVER_AT_REFERENCE"
    | "GDPS_WETLANDS_IN_AREA"
    | "GDPS_OBSTACLES_NEAR_REFERENCE"
    | "GDPS_BLOCKED_AREAS_IN_AREA"
    | "GDPS_HIGH_GROUND_IN_AREA"
    | "GDPS_ELEVATION_AT_REFERENCE"
    | "GDPS_TRAVERSABILITY_EXPLAIN_AT_REFERENCE"
    | "GDPS_GENERIC_SAMPLE_VALUE"
    | "GDPS_GENERIC_PROFILE_VALUE"
    | "GDPS_GENERIC_FIND_CLASS"
    | "GDPS_GENERIC_FIND_RANGE"
    | "GDPS_GENERIC_VECTOR_IN_AREA"
    | "GDPS_GENERIC_VECTOR_NEARBY"
    | "GDPS_GENERIC_VECTOR_INTERSECTS";
  requirementType: string;
  descriptorConstraint?: {} | null;
  queryProfile: string | null;
  /**
   * @minItems 1
   */
  allowedOperations: {}[];
  maturityPolicy: {
    allowed: "PREVIEW";
    requiresExactHashes: true;
  };
  productIdPolicy: "UNBOUND_UNLESS_EXPLICIT" | "FORBIDDEN" | "REQUIRED";
  inputBindings: {};
  outputSemantics: {};
  previewAuthorizationRequired?: true;
}
