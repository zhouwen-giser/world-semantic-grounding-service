/* Generated from the locked WSGS v0.2 GDPS JSON Schemas. Do not edit directly. */

export interface UrnWsgsGdpsDescriptorResolution10 {
  schemaVersion: "wsgs-gdps-descriptor-resolution/1.0";
  status:
    | "MATCHED"
    | "AMBIGUOUS"
    | "DESCRIPTOR_NOT_FOUND"
    | "QUERY_PROFILE_UNSUPPORTED"
    | "CLASS_CODE_UNSUPPORTED"
    | "VALUE_RANGE_INVALID"
    | "UNIT_MISMATCH"
    | "PROPERTY_FILTER_UNSUPPORTED"
    | "PLATFORM_PROFILE_REQUIRED"
    | "PLATFORM_PROFILE_FORBIDDEN"
    | "DESCRIPTOR_LOCK_DRIFT";
  intent?: UrnWsgsGroundedGeospatialProductIntent10;
  candidateDescriptorIds?: string[];
  evidence: {};
}
export interface UrnWsgsGroundedGeospatialProductIntent10 {
  schemaVersion: "wsgs-grounded-geospatial-product-intent/1.0";
  intentId: string;
  descriptorId: string;
  descriptorHash: string;
  productType:
    | "ELEVATION_DTM"
    | "ELEVATION_DSM"
    | "LAND_COVER"
    | "TERRAIN_FORM"
    | "SURFACE_WATER"
    | "WETLAND"
    | "SURFACE_MATERIAL"
    | "BUILDING"
    | "OBSTACLE"
    | "UGV_TRAVERSABILITY"
    | "VEGETATION_STRUCTURE"
    | "DRAINAGE_NETWORK"
    | "FLOOD_RISK"
    | "ROBOT_DOG_TRAVERSABILITY"
    | "GROUND_BEARING_CAPACITY"
    | "UAV_RESTRICTION"
    | "LANDING_ZONE_SUITABILITY"
    | "VISIBILITY_COVERAGE"
    | "OBSERVATION_SITE_SUITABILITY"
    | "COMMUNICATION_COVERAGE"
    | "ASSEMBLY_AREA_SUITABILITY"
    | "SLOPE"
    | "ASPECT"
    | "TERRAIN_ROUGHNESS"
    | "SOIL_TYPE"
    | "SOIL_MOISTURE_CLASS"
    | "GROUND_STABILITY"
    | "ROAD_SOURCE"
    | "BRIDGE"
    | "TUNNEL"
    | "FORD"
    | "CULVERT"
    | "BUILDING_HEIGHT"
    | "OBSTACLE_HEIGHT";
  productProfile: string;
  representation: "RASTER_CONTINUOUS" | "RASTER_CATEGORICAL" | "VECTOR_FEATURE";
  queryProfile:
    | "SAMPLE_VALUE"
    | "PROFILE_VALUE"
    | "FIND_VALUE_RANGE"
    | "SAMPLE_CLASS"
    | "FIND_CLASS"
    | "VECTOR_IN_AREA"
    | "VECTOR_NEARBY"
    | "VECTOR_INTERSECTS";
  explicitProductId?: string;
  classCodes?: string[];
  ranges?: {}[];
  propertyFilters?: {};
  platformProfile?: string;
  spatialConstraint?: {
    relation?: "AT" | "WITHIN" | "NEAR" | "INTERSECTS";
    distanceM?: number;
  };
  /**
   * @minItems 1
   */
  sourceNodeIds: string[];
  sourceSpans?: {
    sourceNodeId: string;
    encoding: "UTF16_CODE_UNIT";
    start: number;
    end: number;
  }[];
}
