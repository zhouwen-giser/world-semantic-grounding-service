/* Generated from the authoritative WSGS v0.2.1 SACS geospatial JSON Schemas. Do not edit directly. */

export type UrnWsgsV021SacsGeospatialWorldFinding10 =
  | {
      findingId: string;
      findingKind: "POINT_MEASUREMENT";
      semanticConcept: string;
      querySemantics: string;
      status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
      /**
       * @maxItems 32
       */
      subjectReferenceProductIds?: string[];
      /**
       * @minItems 1
       * @maxItems 256
       */
      evidenceItemIds: string[];
      /**
       * @minItems 1
       * @maxItems 64
       */
      sourceProductIds: string[];
      confidence?: number;
      /**
       * @maxItems 64
       */
      unknowns?: string[];
      /**
       * @maxItems 64
       */
      warnings?: string[];
      point: GeoJsonPoint;
      value: number;
      unit: string;
    }
  | {
      findingId: string;
      findingKind: "POINT_CLASSIFICATION";
      semanticConcept: string;
      querySemantics: string;
      status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
      /**
       * @maxItems 32
       */
      subjectReferenceProductIds?: string[];
      /**
       * @minItems 1
       * @maxItems 256
       */
      evidenceItemIds: string[];
      /**
       * @minItems 1
       * @maxItems 64
       */
      sourceProductIds: string[];
      confidence?: number;
      /**
       * @maxItems 64
       */
      unknowns?: string[];
      /**
       * @maxItems 64
       */
      warnings?: string[];
      point: GeoJsonPoint;
      classCode: string;
      classLabel?: string;
    }
  | {
      findingId: string;
      findingKind: "SPATIAL_FEATURE_COLLECTION";
      semanticConcept: string;
      querySemantics: string;
      status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
      /**
       * @maxItems 32
       */
      subjectReferenceProductIds?: string[];
      /**
       * @minItems 1
       * @maxItems 256
       */
      evidenceItemIds: string[];
      /**
       * @minItems 1
       * @maxItems 64
       */
      sourceProductIds: string[];
      confidence?: number;
      /**
       * @maxItems 64
       */
      unknowns?: string[];
      /**
       * @maxItems 64
       */
      warnings?: string[];
      returnedCount: number;
      truncated: boolean;
      /**
       * @maxItems 1000
       */
      features: SpatialFeature[];
    }
  | {
      findingId: string;
      findingKind: "PROFILE";
      semanticConcept: string;
      querySemantics: string;
      status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
      /**
       * @maxItems 32
       */
      subjectReferenceProductIds?: string[];
      /**
       * @minItems 1
       * @maxItems 256
       */
      evidenceItemIds: string[];
      /**
       * @minItems 1
       * @maxItems 64
       */
      sourceProductIds: string[];
      confidence?: number;
      /**
       * @maxItems 64
       */
      unknowns?: string[];
      /**
       * @maxItems 64
       */
      warnings?: string[];
      unit: string;
      /**
       * @maxItems 10000
       */
      samples: {
        distanceM: number;
        value: number;
        point?: GeoJsonPoint;
      }[];
      truncated: boolean;
    }
  | {
      findingId: string;
      findingKind: "QUALIFIED_EXPLANATION";
      semanticConcept: string;
      querySemantics: string;
      status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
      /**
       * @maxItems 32
       */
      subjectReferenceProductIds?: string[];
      /**
       * @minItems 1
       * @maxItems 256
       */
      evidenceItemIds: string[];
      /**
       * @minItems 1
       * @maxItems 64
       */
      sourceProductIds: string[];
      confidence?: number;
      /**
       * @maxItems 64
       */
      unknowns?: string[];
      /**
       * @maxItems 64
       */
      warnings?: string[];
      explanationCode: string;
      summary: string;
      /**
       * @maxItems 32
       */
      reasonCodes: string[];
      publishedFacts?: {
        slopeDegrees?: number;
        landcoverClass?: string;
        classCode?: string;
        classLabel?: string;
        riskClass?: string;
        traversabilityClass?: string;
      };
    }
  | {
      findingId: string;
      findingKind: "CATALOG";
      semanticConcept: string;
      querySemantics: string;
      status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
      /**
       * @maxItems 32
       */
      subjectReferenceProductIds?: string[];
      /**
       * @minItems 1
       * @maxItems 256
       */
      evidenceItemIds: string[];
      /**
       * @minItems 1
       * @maxItems 64
       */
      sourceProductIds: string[];
      confidence?: number;
      /**
       * @maxItems 64
       */
      unknowns?: string[];
      /**
       * @maxItems 64
       */
      warnings?: string[];
      returnedCount: number;
      truncated: boolean;
      /**
       * @maxItems 256
       */
      items: {
        itemId?: string;
        productId?: string;
        productType: string;
        productProfile?: string;
        displayName?: string;
        classCode?: string;
        classLabel?: string;
      }[];
    };
/**
 * @minItems 2
 * @maxItems 3
 */
export type Position = number[];
/**
 * @minItems 2
 * @maxItems 10000
 */
export type LineStringCoordinates = Position[];
/**
 * @minItems 4
 * @maxItems 10000
 */
export type LinearRingCoordinates = Position[];
/**
 * @minItems 1
 * @maxItems 256
 */
export type PolygonCoordinates = LinearRingCoordinates[];

export interface GroundingResult11WithSACSGeospatialFindings {
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
  geospatialFindings?: SACSGeospatialFindingsProfile10;
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
export interface SACSGeospatialFindingsProfile10 {
  profile: "sacs-wsgs-geospatial-findings/1.0";
  profileSchemaHash: string;
  /**
   * @maxItems 128
   */
  findings: UrnWsgsV021SacsGeospatialWorldFinding10[];
  /**
   * @maxItems 64
   */
  sourceProducts: UrnWsgsV021SacsGeospatialSourceProduct10[];
  /**
   * @maxItems 128
   */
  gaps: SACSGeospatialTypedGap10[];
  findingSetHash: string;
  sourceProductSetHash: string;
}
export interface GeoJsonPoint {
  type: "Point";
  coordinates: Position;
}
export interface SpatialFeature {
  featureId: string;
  displayName?: string;
  referenceKey?: ReferenceKey1;
  geometry?:
    | GeoJsonPoint
    | GeoJsonMultiPoint
    | GeoJsonLineString
    | GeoJsonMultiLineString
    | GeoJsonPolygon
    | GeoJsonMultiPolygon;
  payloadRef?: string;
  classCode?: string;
  classLabel?: string;
  areaM2?: number;
  lengthM?: number;
  distanceM?: number;
  confidence?: number;
  publishedAttributes?: PublishedAttributes;
}
export interface ReferenceKey1 {
  namespace: "gowm";
  kind: string;
  id: string;
  version: string;
}
export interface GeoJsonMultiPoint {
  type: "MultiPoint";
  /**
   * @minItems 1
   * @maxItems 10000
   */
  coordinates: Position[];
}
export interface GeoJsonLineString {
  type: "LineString";
  coordinates: LineStringCoordinates;
}
export interface GeoJsonMultiLineString {
  type: "MultiLineString";
  /**
   * @minItems 1
   * @maxItems 256
   */
  coordinates: LineStringCoordinates[];
}
export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: PolygonCoordinates;
}
export interface GeoJsonMultiPolygon {
  type: "MultiPolygon";
  /**
   * @minItems 1
   * @maxItems 256
   */
  coordinates: PolygonCoordinates[];
}
export interface PublishedAttributes {
  objectClass?: string;
  objectType?: string;
  categoryCode?: string;
  categoryLabel?: string;
  operationalStatus?: string;
}
export interface UrnWsgsV021SacsGeospatialSourceProduct10 {
  sourceProductId: string;
  authority: "GDPS_CURRENT_PRODUCT";
  productId: string;
  productType: string;
  productProfile: string;
  contentHash: string;
  descriptorId: string;
  descriptorHash: string;
  dataTime?: string;
  qualitySummary?: {
    qualityClass?: string;
    valueAccuracyDegree?: number;
    horizontalAccuracyM?: number;
    verticalAccuracyM?: number;
    completenessRatio?: number;
  };
  /**
   * @minItems 1
   * @maxItems 128
   */
  evidenceItemIds: string[];
}
export interface SACSGeospatialTypedGap10 {
  gapId: string;
  gapKind:
    | "DATA_GAP"
    | "COVERAGE_GAP"
    | "CAPABILITY_GAP"
    | "REFERENCE_AMBIGUITY"
    | "PRODUCT_SELECTION_AMBIGUITY"
    | "SOURCE_CHANGED"
    | "TRUNCATED"
    | "UNSUPPORTED_FINDING_SCHEMA"
    | "EVIDENCE_INCOMPLETE"
    | "UPSTREAM_FAILURE"
    | "CURRENTNESS_UNAVAILABLE";
  severity: "INFO" | "WARNING" | "BLOCKING";
  messageCode: string;
  semanticConcept?: string;
  /**
   * @maxItems 64
   */
  findingIds?: string[];
  /**
   * @maxItems 128
   */
  evidenceItemIds?: string[];
  safeDetail?: string;
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
