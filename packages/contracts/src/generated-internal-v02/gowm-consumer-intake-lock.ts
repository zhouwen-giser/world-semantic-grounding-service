/* Generated from the locked WSGS v0.2 internal JSON Schemas. Do not edit directly. */

export interface GowmConsumerIntakeLock {
  schemaVersion: "1.0";
  wsgsSource: {
    repository: string;
    commit: string;
    version: string;
  };
  gowmSource: {
    repository: string;
    commit: string;
    version: "0.6.4";
  };
  consumerPackage: {
    name: "@gowm/world-gateway-contracts";
    version: "0.6.3";
    integrity: string;
    contractCatalogRevision: string;
    semanticCatalogHash: string;
    availabilityContractHash: string;
    snapshotContractHash: string;
    delegationContractHash: string;
    southboundLockSha256: string;
  };
  northboundContractVersion: "sacs-wsgs-grounding/1.0";
  targetVersion: "0.2.1";
}
