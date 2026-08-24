/* Generated from the frozen WSGS JSON Schemas. Do not edit directly. */

export interface GroundingRequest {
  schemaVersion: "1.0";
  requestId: string;
  operation: "GROUND_REFERENCES" | "COMPILE_WORLD_QUERY" | "EXECUTE_WORLD_QUERY" | "VALIDATE_REFERENCES";
  source: {
    conversationRef: string;
    messageId: string;
    originalText: string;
    originalTextSha256: string;
    locale: string;
    createdAt: string;
    /**
     * @maxItems 32
     */
    focusSpans?: TextSpan[];
  };
  /**
   * @minItems 1
   * @maxItems 16
   */
  requestedProducts: (
    | "MENTIONS"
    | "RESOLVED_REFERENCES"
    | "DERIVED_REFERENCES"
    | "REFERENCE_SETS"
    | "GROUNDING_GRAPH"
    | "WORLD_QUERY"
    | "WORLD_EVIDENCE"
    | "OPERATIONAL_TASKS"
    | "EVENT_TIMELINES"
    | "CORRELATION_FINDINGS"
    | "PREDICATE_EVALUATIONS"
  )[];
  contextCapsule: GroundingContextCapsule;
  hints?: {
    /**
     * @maxItems 32
     */
    mentionHints?: {
      surfaceText: string;
      span?: TextSpan;
      /**
       * @maxItems 32
       */
      expectedKinds?: string[];
      semanticRole?: string;
    }[];
  };
  executionPolicy: {
    readOnly: true;
    deadlineMs: number;
    maxQueryOperations: number;
    maxCandidatesPerMention: number;
    maxResultBytes: number;
    allowApproximation: boolean;
  };
}
export interface TextSpan {
  encoding: "UTF16_CODE_UNIT";
  start: number;
  end: number;
}
export interface GroundingContextCapsule {
  /**
   * @maxItems 64
   */
  knownWorldReferences: KnownWorldReference[];
  /**
   * @maxItems 16
   */
  priorGroundings: PriorGroundingReference[];
  /**
   * @maxItems 32
   */
  mapSelections: MapSelection[];
  /**
   * @maxItems 32
   */
  externalCorrelationHints: ExternalCorrelationHint[];
  /**
   * @maxItems 32
   */
  externalPredicates: ExternalPredicateCapsule[];
}
export interface KnownWorldReference {
  alias?: string;
  referenceKey: ReferenceKey;
  referenceType: string;
  sourceMessageId: string;
  sourceGroundingId?: string;
  validUntil?: string;
}
export interface ReferenceKey {
  namespace: "gowm";
  kind: string;
  id: string;
  version: string;
}
export interface PriorGroundingReference {
  groundingId: string;
  resultHash: string;
  /**
   * @maxItems 64
   */
  selectedProductIds?: string[];
}
export interface MapSelection {
  selectionId: string;
  label?: string;
  kind: "POINT" | "LINE" | "AREA" | "FEATURE" | "ANNOTATION";
  revision: number;
  referenceKey?: ReferenceKey;
  geometry?: {};
  geometryHash?: string;
}
export interface ExternalCorrelationHint {
  hintId: string;
  externalAuthority: string;
  kind: "EXECUTION_INTENT" | "OPERATION_CORRELATION" | "EXTERNAL_TASK" | "EXTERNAL_STEP" | "EXTERNAL_COMMAND";
  value: string;
  relationHint?: "REPORTS_EXECUTION_OF" | "REALIZES" | "RELATED_TO";
  declarationConfidence?: number;
}
/**
 * Opaque, schema-locked GOWM external predicate input.
 */
export interface ExternalPredicateCapsule {
  schemaUri: "urn:gowm:v0.4:external-predicate";
  schemaHash: string;
  value: {};
}
