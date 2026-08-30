/* Generated from the locked WSGS v0.2 GDPS JSON Schemas. Do not edit directly. */

export interface UrnWsgsGdpsConsumerSnapshotExtension20 {
  schemaVersion: "wsgs-gdps-consumer-snapshot/2.0";
  providerId: "gdps.geospatial-products";
  providerVersion: string;
  consumerLockHash: string;
  capabilityLockHash: string;
  descriptorLockHash: string;
  recipeLockHash: string;
  productTypeCount: 34;
  descriptorProfileCount: 35;
  /**
   * @minItems 30
   * @maxItems 30
   */
  capabilityKeys: string[];
  capabilitySnapshotHash: string;
}
