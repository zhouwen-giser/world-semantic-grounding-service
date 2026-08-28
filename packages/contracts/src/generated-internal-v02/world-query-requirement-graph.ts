/* Generated from the locked WSGS v0.2 internal JSON Schemas. Do not edit directly. */

export interface WorldQueryRequirementGraph {
  schemaVersion: "1.0";
  graphId: string;
  /**
   * @minItems 1
   * @maxItems 64
   */
  requirements: {
    requirementId: string;
    requirementType:
      | "RESOLVE_REFERENCE"
      | "VALIDATE_REFERENCE"
      | "READ_CURRENT_STATE"
      | "READ_GEOMETRY"
      | "READ_PROVENANCE"
      | "SEARCH_CATALOG"
      | "SPATIAL_NEARBY"
      | "SPATIAL_IN_AREA"
      | "SPATIAL_INTERSECTS"
      | "EXACT_VERIFY"
      | "VALIDATE_RESULT";
    requiredForProduct: string;
    required: boolean;
    allowApproximation: boolean;
    inputs: {};
    outputs: string[];
  }[];
  /**
   * @maxItems 128
   */
  dependencies: {
    fromRequirementId: string;
    toRequirementId: string;
    outputName?: string;
    targetPath?: string;
  }[];
  graphHash: string;
}
