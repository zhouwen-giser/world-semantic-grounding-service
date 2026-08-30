/* Generated from the locked WSGS v0.2 GDPS JSON Schemas. Do not edit directly. */

export interface UrnWsgsGeospatialProductIntent10 {
  schemaVersion: "wsgs-geospatial-product-intent/1.0";
  intentId: string;
  targetConcept: string;
  querySemantics:
    | "READ_VALUE"
    | "READ_PROFILE"
    | "FIND_CLASS_AREAS"
    | "FIND_VALUE_RANGE_AREAS"
    | "FIND_FEATURES_IN_AREA"
    | "FIND_FEATURES_NEARBY"
    | "FIND_INTERSECTIONS";
  /**
   * @minItems 1
   */
  subjectMentionIds: string[];
  classSemantics?: string[];
  numericConstraint?: {
    /**
     * @minItems 1
     */
    ranges?: {}[];
    unit?: string;
  };
  spatialConstraint?: {
    relation?: "AT" | "WITHIN" | "NEAR" | "INTERSECTS";
    distanceM?: number;
  };
  explicitProductPreference?: string;
  platformProfile?: string;
  propertyFilters?: {};
  sourceNodeIds?: string[];
  sourceSpans?: {
    sourceNodeId: string;
    encoding: "UTF16_CODE_UNIT";
    start: number;
    end: number;
  }[];
}
