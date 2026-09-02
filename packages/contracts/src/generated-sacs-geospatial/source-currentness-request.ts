/* Generated from the authoritative WSGS v0.2.1 SACS geospatial JSON Schemas. Do not edit directly. */

export type Identifier = string;
export type Sha256 = string;

export interface ValidateSourceCurrentnessRequest10 {
  schemaVersion: "wsgs-source-currentness-request/1.0";
  sourceProductId: Identifier;
  productId: Identifier;
  previousContentHash: Sha256;
}
