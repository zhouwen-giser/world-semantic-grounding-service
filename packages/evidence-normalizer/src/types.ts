export interface GroundingEvidenceItem {
  evidenceProductId: string;
  productKind:
    | "WORLD_FACT" | "WORLD_GEOMETRY" | "PROVENANCE" | "EVENT_TIMELINE" | "OPERATIONAL_TASK"
    | "CORRELATION_FINDING" | "PREDICATE_EVALUATION" | "OBSERVABILITY_ASSESSMENT" | "CAPABILITY_RESULT";
  authority: string;
  sourceOperation: string;
  sourceProvider?: string;
  sourceQueryId?: string;
  sourceNodeId?: string;
  upstreamStatus: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
  payloadSchemaUri: string;
  payloadSchemaHash: `sha256:${string}`;
  safePayload?: unknown;
  payloadRef?: string;
  dataSnapshot?: Record<string, unknown>;
  computeSnapshot?: Record<string, unknown>;
  receiptIds: string[];
  evidenceIds: string[];
  unknowns: string[];
  warnings: string[];
}

export interface EvidenceNormalizationInput {
  envelope: unknown;
  expected: {
    operationId: string;
    operationVersion: string;
    providerId: string;
    outputSchemaUri: string;
    outputSchemaHash: `sha256:${string}`;
  };
  sourceQueryId?: string;
  sourceNodeId?: string;
}

export type EvidenceNormalizationResult =
  | { status: "EVIDENCE"; item: GroundingEvidenceItem }
  | { status: "FAILED"; errorCode: string; warnings: string[] };

