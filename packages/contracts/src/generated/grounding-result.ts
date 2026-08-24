/* Generated from the frozen WSGS JSON Schemas. Do not edit directly. */

export interface GroundingResult {
  schemaVersion: "1.0";
  requestId: string;
  groundingId: string;
  status: "COMPLETED" | "PARTIAL" | "AMBIGUOUS" | "UNRESOLVED" | "FAILED" | "CANCELLED";
  source: {
    messageId: string;
    originalTextSha256: string;
  };
  /**
   * @maxItems 32
   */
  mentions: GroundedMention[];
  semanticFrame?: WorldSemanticFrame;
  groundingGraph?: GroundingGraph;
  /**
   * @maxItems 1000
   */
  referenceProducts: ReferenceProduct[];
  /**
   * @maxItems 1000
   */
  evidenceItems: GroundingEvidenceItem[];
  /**
   * @maxItems 64
   */
  gowmQueries?: {
    queryId: string;
    status: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
    resultHash: string;
  }[];
  /**
   * @maxItems 32
   */
  ambiguities: GroundingAmbiguity[];
  /**
   * @maxItems 32
   */
  unresolvedMentions: {
    mentionId: string;
    surfaceText: string;
    reason: string;
  }[];
  /**
   * @maxItems 64
   */
  capabilityGaps: CapabilityGap[];
  /**
   * @maxItems 256
   */
  warnings: string[];
  execution: {
    parserVersion: string;
    /**
     * @maxItems 16
     */
    semanticModelReceiptIds: string[];
    queryCompilerVersion: string;
    normalizerVersion: string;
    elapsedMs: number;
  };
  validUntil?: string;
  resultHash: string;
  error?: Error;
}
export interface GroundedMention {
  mentionId: string;
  surfaceText: string;
  span: TextSpan;
  /**
   * @maxItems 32
   */
  expectedKinds?: string[];
  semanticRole?: string;
  /**
   * @minItems 1
   */
  extractionSources: ("CLIENT_HINT" | "CLIENT_MAP" | "KNOWN_REFERENCE" | "DETERMINISTIC" | "DOMAIN_MODEL")[];
  status: "RESOLVED_EXACT" | "SUGGESTED_UNIQUE" | "AMBIGUOUS" | "UNRESOLVED" | "INVALID";
  /**
   * @maxItems 20
   */
  candidateProductIds: string[];
}
export interface TextSpan {
  encoding: "UTF16_CODE_UNIT";
  start: number;
  end: number;
}
export interface WorldSemanticFrame {
  schemaVersion: "1.0";
  /**
   * @maxItems 32
   */
  mentions: {
    mentionId: string;
    surfaceText: string;
    span: TextSpan;
    /**
     * @maxItems 32
     */
    expectedKinds?: string[];
    semanticRole?: string;
    anchorMentionId?: string;
  }[];
  /**
   * @maxItems 32
   */
  spatialExpressions: {
    expressionId: string;
    operator:
      | "NEAR"
      | "WITHIN"
      | "CONTAINS"
      | "INTERSECTS"
      | "ALONG"
      | "BUFFER"
      | "NORTH_OF"
      | "SOUTH_OF"
      | "EAST_OF"
      | "WEST_OF";
    /**
     * @minItems 1
     * @maxItems 4
     */
    arguments: string[];
    distanceM?: number;
    approximate?: boolean;
  }[];
  /**
   * @maxItems 32
   */
  relationExpressions: {
    expressionId: string;
    relationType: string;
    subjectMentionId: string;
    objectMentionId?: string;
  }[];
  /**
   * @maxItems 16
   */
  temporalConstraints: {
    constraintId: string;
    from?: string;
    to?: string;
    relativeExpression?: string;
  }[];
  /**
   * @maxItems 16
   */
  aggregationExpressions: {
    expressionId: string;
    operator: "COUNT" | "GROUP" | "SUMMARIZE" | "COMPARE";
    targetExpressionId?: string;
  }[];
  /**
   * @maxItems 16
   */
  rankingExpressions: {
    expressionId: string;
    metric?: string;
    direction: "ASC" | "DESC";
    limit?: number;
  }[];
}
export interface GroundingGraph {
  schemaVersion: "1.0";
  /**
   * @maxItems 256
   */
  nodes: {
    nodeId: string;
    kind:
      | "MENTION"
      | "KNOWN_REFERENCE"
      | "RESOLVED_REFERENCE"
      | "DERIVED_REFERENCE"
      | "REFERENCE_SET"
      | "SEMANTIC_OPERATION"
      | "WORLD_QUERY"
      | "FINDING"
      | "UNKNOWN";
    payload: {};
  }[];
  /**
   * @maxItems 512
   */
  edges: {
    edgeId: string;
    from: string;
    to: string;
    relation:
      | "RESOLVES_TO"
      | "DERIVED_FROM"
      | "SCOPED_BY"
      | "FILTERS"
      | "RELATES_TO"
      | "OBSERVER_OF"
      | "TARGET_OF"
      | "PRODUCES"
      | "SUPPORTED_BY"
      | "CONTRADICTED_BY";
  }[];
}
export interface ReferenceProduct {
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
  safeSummary?: {};
}
export interface ReferenceKey {
  namespace: "gowm";
  kind: string;
  id: string;
  version: string;
}
export interface GroundingEvidenceItem {
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
  safePayload?: unknown;
  payloadRef?: string;
  dataSnapshot?: {};
  computeSnapshot?: {};
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
export interface GroundingAmbiguity {
  ambiguityId: string;
  mentionId: string;
  surfaceText: string;
  /**
   * @minItems 2
   * @maxItems 20
   */
  candidateProductIds: string[];
  reason:
    | "MULTIPLE_EXACT_MATCHES"
    | "MULTIPLE_PLAUSIBLE_MATCHES"
    | "NAMESPACE_CONFLICT"
    | "CONTEXT_CONFLICT"
    | "MAP_TEXT_CONFLICT";
}
export interface CapabilityGap {
  gapId: string;
  semanticCapability: string;
  reason:
    | "NOT_REGISTERED"
    | "MATURITY_NOT_ALLOWED"
    | "SCHEMA_MISMATCH"
    | "PROVIDER_UNAVAILABLE"
    | "UNSUPPORTED_EXPRESSION"
    | "BUDGET_EXCEEDED";
  requiredForProduct: string;
  blocking: boolean;
  details?: {};
}
export interface Error {
  code: string;
  message: string;
  retryable: boolean;
  stage:
    | "REQUEST_VALIDATION"
    | "CONTEXT_LOADING"
    | "DETERMINISTIC_PARSING"
    | "SEMANTIC_MODEL"
    | "SEMANTIC_MERGE"
    | "REFERENCE_GROUNDING"
    | "QUERY_COMPILATION"
    | "GOWM_EXECUTION"
    | "RESULT_NORMALIZATION"
    | "PERSISTENCE";
  details?: {};
}
