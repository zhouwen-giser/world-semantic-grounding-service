/* Generated from the locked WSGS v0.2 internal JSON Schemas. Do not edit directly. */

export interface GowmExecutionRecord {
  executionId: string;
  groundingId: string;
  executionKind: "DIRECT_OPERATION" | "WORLD_QUERY" | "WORLD_QUERY_NODE";
  operationId?: string;
  operationVersion?: string;
  gatewayQueryId?: string;
  gatewayJobId?: string;
  requestHash: string;
  resultHash?: string;
  normalizedStatus:
    | "COMPLETED"
    | "PARTIAL"
    | "NO_DATA"
    | "AMBIGUOUS"
    | "INDETERMINATE"
    | "NO_FEASIBLE_RESULT"
    | "STALE"
    | "FAILED"
    | "CANCELLED";
  upstreamStatus: string;
  dataSnapshot?: {};
  computeSnapshot?: {};
  snapshotAdherence?: {};
  receiptIds: string[];
  evidenceIds: string[];
  startedAt: string;
  finishedAt: string;
}
