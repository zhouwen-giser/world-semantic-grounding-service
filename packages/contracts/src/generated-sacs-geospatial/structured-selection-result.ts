/* Generated from the authoritative WSGS v0.2.1 SACS geospatial JSON Schemas. Do not edit directly. */

export type ResolveWorldSelectionResult10 = {
  schemaVersion: "wsgs-structured-selection-result/1.0";
  selectionId: Identifier;
  selectionKind: "FINDING_FEATURE";
  priorGroundingId: Identifier;
  priorResultHash: Sha256;
  findingId: Identifier;
  featureId: Identifier;
  referenceKey?: ReferenceKey;
  upstreamSelectionToken?: string;
  selectionRevision: number;
  sourceHash: Sha256;
  selectedAt: string;
  expiresAt: string;
} & (
  | {
      referenceKey: unknown;
    }
  | {
      upstreamSelectionToken: unknown;
    }
);
export type Identifier = string;
export type Sha256 = string;

export interface ReferenceKey {
  namespace: "gowm";
  kind: string;
  id: string;
  version: string;
}
