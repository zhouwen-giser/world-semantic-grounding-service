/* Generated from the authoritative WSGS v0.2.1 SACS geospatial JSON Schemas. Do not edit directly. */

export interface UrnWsgsV021SacsGeospatialSourceProduct10 {
  sourceProductId: string;
  authority: "GDPS_CURRENT_PRODUCT";
  productId: string;
  productType: string;
  productProfile: string;
  contentHash: string;
  descriptorId: string;
  descriptorHash: string;
  dataTime?: string;
  qualitySummary?: {
    qualityClass?: string;
    valueAccuracyDegree?: number;
    horizontalAccuracyM?: number;
    verticalAccuracyM?: number;
    completenessRatio?: number;
  };
  /**
   * @minItems 1
   * @maxItems 128
   */
  evidenceItemIds: string[];
}
