/* Generated from the frozen WSGS JSON Schemas. Do not edit directly. */

export interface WSGSCapabilitiesResponse {
  service: "world-semantic-grounding-service";
  version: "0.1.0";
  contractVersion: "sacs-wsgs-grounding/1.0";
  supportedOperations: string[];
  supportedProducts: string[];
  gowmContract: {
    softwareVersion: "0.4.0";
    commit: "db575f79c874a69f65a2043a7e463338524b713d";
    sourcePackageArtifacts: 33;
  };
  requiredCapabilitiesReady: boolean;
  optionalCapabilities: {
    operationId: string;
    available: boolean;
    reason?: string;
  }[];
}
