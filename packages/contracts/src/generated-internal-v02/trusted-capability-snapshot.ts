/* Generated from the locked WSGS v0.2 internal JSON Schemas. Do not edit directly. */

export interface TrustedCapabilitySnapshot {
  capturedAt: string;
  gatewayContractVersion: "0.6.3";
  contractCatalogRevision: string;
  semanticCatalogHash: string;
  bindingRevision: string;
  consumerPackageIntegrity: string;
  southboundLockHash: string;
  /**
   * @maxItems 256
   */
  capabilities: {
    operationId: string;
    operationVersion: string;
    inputSchemaHash: string;
    outputSchemaHash: string;
    semanticProfileHash: string;
    maturity: "STABLE" | "PREVIEW";
    snapshotSupport: "NONE" | "BEST_EFFORT" | "CONSISTENT_AT_START" | "PINNED";
    requiredPermissions: string[];
  }[];
  /**
   * @maxItems 256
   */
  availability: {
    operationId: string;
    operationVersion: string;
    availability: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "DISABLED";
    checkedAt: string;
    validUntil?: string;
    /**
     * @maxItems 16
     */
    reasonCodes?: string[];
  }[];
  snapshotHash: string;
}
