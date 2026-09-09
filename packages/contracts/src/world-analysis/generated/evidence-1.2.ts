/* Generated from public JSON Schema. Do not edit. */

export interface GroundingEvidence12 {
  evidenceProductId: string;
  productKind:
    | "WORLD_FACT"
    | "WORLD_GEOMETRY"
    | "PROVENANCE"
    | "EVENT_TIMELINE"
    | "OPERATIONAL_TASK"
    | "CORRELATION_FINDING"
    | "PREDICATE_EVALUATION"
    | "OBSERVABILITY_ASSESSMENT"
    | "CAPABILITY_RESULT";
  authority: string;
  sourceOperation: string;
  sourceProvider?: string;
  sourceQueryId?: string;
  sourceNodeId?: string;
  upstreamStatus: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
  payloadSchemaUri: string;
  payloadSchemaHash: string;
  dataSnapshot?: SnapshotSummary;
  computeSnapshot?: SnapshotSummary;
  /**
   * @maxItems 256
   */
  receiptIds: string[];
  /**
   * @maxItems 1000
   */
  evidenceIds: string[];
  /**
   * @maxItems 128
   */
  unknowns: string[];
  /**
   * @maxItems 128
   */
  warnings: string[];
}
export interface SnapshotSummary {
  snapshotHash: string;
  capturedAt?: string;
  worldVersion?: number;
}
