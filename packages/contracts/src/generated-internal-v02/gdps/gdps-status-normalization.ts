/* Generated from the locked WSGS v0.2 GDPS JSON Schemas. Do not edit directly. */

export interface UrnWsgsGdpsStatusNormalization10 {
  schemaVersion: "wsgs-gdps-status-normalization/1.0";
  upstreamCondition: string;
  wsgsStatus: "COMPLETED" | "PARTIAL" | "UNRESOLVED" | "AMBIGUOUS" | "INDETERMINATE" | "FAILED";
  semanticCode: string;
  retryPolicy?: "NONE" | "ONCE" | "CALLER_EXPLICIT";
}
