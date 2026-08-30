/* Generated from the authoritative WSGS v0.2.1 SACS geospatial JSON Schemas. Do not edit directly. */

export type Sha256 = string;

export interface WSGSCapabilitiesResponseForGroundingContract11 {
  service: "world-semantic-grounding-service";
  version: "0.2.1";
  contractVersion: "sacs-wsgs-grounding/1.1";
  /**
   * @minItems 6
   * @maxItems 6
   */
  supportedOperations: (
    | "GROUND_REFERENCES"
    | "COMPILE_WORLD_QUERY"
    | "EXECUTE_WORLD_QUERY"
    | "VALIDATE_REFERENCES"
    | "RESOLVE_WORLD_SELECTION"
    | "VALIDATE_SOURCE_CURRENTNESS"
  )[];
  /**
   * @maxItems 256
   */
  supportedProducts: string[];
  /**
   * @minItems 1
   * @maxItems 1
   */
  supportedResultProfiles: "sacs-wsgs-geospatial-findings/1.0"[];
  geospatialTransportMode: "RESULT_EXTENSION";
  currentness: {
    mode: "DEDICATED_OPERATION";
    operation: "VALIDATE_SOURCE_CURRENTNESS";
  };
  gowmContract: {
    softwareVersion: string;
    gatewayContractVersion: string;
    commit: string;
    sourcePackageArtifacts: number;
    contractCatalogRevision: Sha256;
    semanticCatalogHash: Sha256;
    operationLockHash: Sha256;
  };
  requiredCapabilitiesReady: boolean;
  /**
   * @maxItems 128
   */
  optionalCapabilities: {
    operationId: string;
    available: boolean;
    reason?: string;
  }[];
}
