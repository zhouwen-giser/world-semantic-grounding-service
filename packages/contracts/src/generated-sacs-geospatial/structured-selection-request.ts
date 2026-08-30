/* Generated from the authoritative WSGS v0.2.1 SACS geospatial JSON Schemas. Do not edit directly. */

export type Identifier = string;
export type Sha256 = string;

export interface ResolveWorldSelectionRequest10 {
  schemaVersion: "wsgs-structured-selection-request/1.0";
  priorGroundingId: Identifier;
  priorResultHash: Sha256;
  findingId: Identifier;
  featureId: Identifier;
  selectionRevision: number;
  sourceHash: Sha256;
}
