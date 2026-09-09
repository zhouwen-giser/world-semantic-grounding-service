/* Generated from public JSON Schema. Do not edit. */

export interface ReferenceProduct12 {
  productId: string;
  productKind: "RESOLVED_REFERENCE" | "DERIVED_REFERENCE" | "REFERENCE_SET" | "QUERY_RESULT";
  referenceKey: ReferenceKey;
  referenceType: string;
  displayName: string;
  matchedBy?: string;
  matchScore?: number;
  stateConfidence?: number;
  sourceOperation: string;
  sourceWorldVersion: number;
  validUntil?: string;
  revalidationRequired?: boolean;
}
export interface ReferenceKey {
  namespace: "gowm";
  kind: string;
  id: string;
  version: string;
}
