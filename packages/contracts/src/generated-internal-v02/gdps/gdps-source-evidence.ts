/* Generated from the locked WSGS v0.2 GDPS JSON Schemas. Do not edit directly. */

export interface UrnWsgsGdpsSourceEvidence10 {
  schemaVersion: "wsgs-gdps-source-evidence/1.0";
  authority: "gdps-current-product";
  operationId: string;
  operationVersion: string;
  recipeId: string;
  recipeLockHash: string;
  descriptorId: string;
  descriptorHash: string;
  productId: string;
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
  contentHash: string;
  queryProfile: string;
  truncated?: boolean;
  quality?: {};
  dataSnapshot?: {};
  computeSnapshot?: {};
  receiptIds?: string[];
  evidenceIds?: string[];
}
