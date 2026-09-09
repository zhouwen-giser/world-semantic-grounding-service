/* Generated from public JSON Schema. Do not edit. */

export type GroundingJob12 =
  | GroundingJob12ACCEPTED
  | GroundingJob12RUNNING
  | GroundingJob12COMPLETED
  | GroundingJob12PARTIAL
  | GroundingJob12AMBIGUOUS
  | GroundingJob12UNRESOLVED
  | GroundingJob12FAILED
  | GroundingJob12CANCELLED;
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
export type HistoricalTrace =
  HistoricalTraceCOMPLETED | HistoricalTracePARTIAL | HistoricalTraceNO_DATA | HistoricalTraceINDETERMINATE;
export type RoadAssociation =
  RoadAssociationCOMPLETED | RoadAssociationPARTIAL | RoadAssociationNO_DATA | RoadAssociationINDETERMINATE;
export type TemporalEvent =
  TemporalEventCOMPLETED | TemporalEventPARTIAL | TemporalEventNO_DATA | TemporalEventINDETERMINATE;
export type MetricRanking =
  MetricRankingCOMPLETED | MetricRankingPARTIAL | MetricRankingNO_DATA | MetricRankingINDETERMINATE;
export type ActionTargetCandidate = ActionTargetCandidateCOMPLETED | ActionTargetCandidatePARTIAL;
export type Choice =
  | {
      choiceId: string;
      choiceKind: "REFERENCE_SELECTION";
      promptCode: string;
      sourceFindingId?: string;
      validUntil: string;
      /**
       * @minItems 1
       * @maxItems 100
       */
      candidates: {
        candidateId: string;
        displayName: string;
        referenceProductId: string;
      }[];
    }
  | {
      choiceId: string;
      choiceKind: "TASK_SELECTION";
      promptCode: string;
      sourceFindingId?: string;
      validUntil: string;
      /**
       * @minItems 1
       * @maxItems 100
       */
      candidates: {
        candidateId: string;
        displayName: string;
        referenceProductId: string;
      }[];
    }
  | {
      choiceId: string;
      choiceKind: "METRIC_SERIES_SELECTION";
      promptCode: string;
      sourceFindingId?: string;
      validUntil: string;
      /**
       * @minItems 1
       * @maxItems 100
       */
      candidates: {
        candidateId: string;
        displayName: string;
        series: Series;
      }[];
    }
  | {
      choiceId: string;
      choiceKind: "RANKED_LOCATION_SELECTION";
      promptCode: string;
      sourceFindingId?: string;
      validUntil: string;
      /**
       * @minItems 1
       * @maxItems 100
       */
      candidates: {
        candidateId: string;
        displayName: string;
        findingId: string;
        rank: number;
      }[];
    }
  | {
      choiceId: string;
      choiceKind: "EVENT_SELECTION";
      promptCode: string;
      sourceFindingId?: string;
      validUntil: string;
      /**
       * @minItems 1
       * @maxItems 100
       */
      candidates: {
        candidateId: string;
        displayName: string;
        findingId: string;
        eventId: string;
      }[];
    };

export interface GroundingJob12ACCEPTED {
  schemaVersion: "1.0";
  jobId: string;
  groundingId: string;
  requestId: string;
  status: "ACCEPTED";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: Error;
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
export interface GroundingJob12RUNNING {
  schemaVersion: "1.0";
  jobId: string;
  groundingId: string;
  requestId: string;
  status: "RUNNING";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: Error;
}
export interface GroundingJob12COMPLETED {
  schemaVersion: "1.0";
  jobId: string;
  groundingId: string;
  requestId: string;
  status: "COMPLETED";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  result: GroundingResult12;
  error?: Error;
}
export interface GroundingResult12 {
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
  referenceProducts: ReferenceProduct12[];
  /**
   * @maxItems 1000
   */
  evidenceItems: GroundingEvidence12[];
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
    runFingerprint: string;
  };
  validUntil?: string;
  resultHash: string;
  error?: Error;
  worldAnalysisFindings: WorldAnalysisFindings;
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
export interface WorldAnalysisFindings {
  profile: "wsgs-world-analysis-findings/1.0";
  /**
   * @minItems 0
   * @maxItems 32
   */
  findings: (HistoricalTrace | RoadAssociation | TemporalEvent | MetricRanking | ActionTargetCandidate)[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  choices: Choice[];
  /**
   * @minItems 0
   * @maxItems 64
   */
  gaps: Gap[];
  findingSetHash: string;
}
export interface HistoricalTraceCOMPLETED {
  findingId: string;
  findingKind: "HISTORICAL_TRACE";
  semanticConcept: string;
  status: "COMPLETED";
  /**
   * @minItems 1
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 1
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  taskReferenceProductId: string;
  executionIntervalReferenceProductId?: string;
  trajectoryReferenceProductId: string;
  executionNo?: number;
  lifecycleState?: string;
  phaseScope: "EXECUTION_ENVELOPE" | "ACTIVE_PHASES_ONLY";
  /**
   * @minItems 0
   * @maxItems 100
   */
  selectedPeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  activePeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  pausedPeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  requestedPeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  definedPeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  excludedPeriods: PeriodIssue[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  trajectoryGaps: PeriodIssue[];
  coverage: Coverage;
}
export interface Display {
  truncated: boolean;
  returnedCount: number;
  sourceCount?: number;
}
export interface TimeRange {
  start: string;
  end: string;
  bounds: "[)" | "[]" | "(]" | "()" | "UNSPECIFIED";
}
export interface PeriodIssue {
  period: TimeRange;
  kind: string;
  /**
   * @minItems 0
   * @maxItems 100
   */
  reasonCodes: string[];
}
export interface Coverage {
  prefixComplete?: boolean;
  suffixComplete?: boolean;
  temporalCoverageRatio?: number;
  finalizationState?: "PROVISIONAL" | "SEALED" | "CONFLICTED";
  sampleCount?: number;
}
export interface HistoricalTracePARTIAL {
  findingId: string;
  findingKind: "HISTORICAL_TRACE";
  semanticConcept: string;
  status: "PARTIAL";
  /**
   * @minItems 1
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 1
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  taskReferenceProductId: string;
  executionIntervalReferenceProductId?: string;
  trajectoryReferenceProductId: string;
  executionNo?: number;
  lifecycleState?: string;
  phaseScope: "EXECUTION_ENVELOPE" | "ACTIVE_PHASES_ONLY";
  /**
   * @minItems 0
   * @maxItems 100
   */
  selectedPeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  activePeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  pausedPeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  requestedPeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  definedPeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  excludedPeriods: PeriodIssue[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  trajectoryGaps: PeriodIssue[];
  coverage: Coverage;
}
export interface HistoricalTraceNO_DATA {
  findingId: string;
  findingKind: "HISTORICAL_TRACE";
  semanticConcept: string;
  status: "NO_DATA";
  /**
   * @minItems 0
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  taskReferenceProductId?: string;
  executionIntervalReferenceProductId?: string;
  trajectoryReferenceProductId?: string;
  executionNo?: number;
  lifecycleState?: string;
  phaseScope: "EXECUTION_ENVELOPE" | "ACTIVE_PHASES_ONLY";
  /**
   * @minItems 0
   * @maxItems 100
   */
  selectedPeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  activePeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  pausedPeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  requestedPeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  definedPeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  excludedPeriods: PeriodIssue[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  trajectoryGaps: PeriodIssue[];
  coverage: Coverage;
}
export interface HistoricalTraceINDETERMINATE {
  findingId: string;
  findingKind: "HISTORICAL_TRACE";
  semanticConcept: string;
  status: "INDETERMINATE";
  /**
   * @minItems 0
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  taskReferenceProductId?: string;
  executionIntervalReferenceProductId?: string;
  trajectoryReferenceProductId?: string;
  executionNo?: number;
  lifecycleState?: string;
  phaseScope: "EXECUTION_ENVELOPE" | "ACTIVE_PHASES_ONLY";
  /**
   * @minItems 0
   * @maxItems 100
   */
  selectedPeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  activePeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  pausedPeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  requestedPeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  definedPeriods: TimeRange[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  excludedPeriods: PeriodIssue[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  trajectoryGaps: PeriodIssue[];
  coverage: Coverage;
}
export interface RoadAssociationCOMPLETED {
  findingId: string;
  findingKind: "ROAD_ASSOCIATION";
  semanticConcept: string;
  status: "COMPLETED";
  /**
   * @minItems 1
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 1
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  trajectoryReferenceProductId: string;
  networkRole: "REFERENCE_MODEL_NOT_PHYSICAL_TRUTH";
  network: Network;
  /**
   * @minItems 0
   * @maxItems 100
   */
  roadVisits: RoadVisit[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  offNetworkSegments: OffNetwork[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  ambiguousSegments: Ambiguity[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  networkDataIssues: NetworkIssue[];
  associationPrefixComplete: boolean;
  associationSuffixComplete: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
  lastConfirmedRoad?: {
    visitId: string;
    confirmationScope: "CONFIRMED_IN_AVAILABLE_DATA";
    absoluteFinalRoadClaimed: false;
  };
}
export interface Network {
  graphVersionId: string;
  graphVersion: string;
  topologyHash: string;
  timeBasis: "CURRENT_ACTIVE_TOPOLOGY";
}
export interface RoadVisit {
  visitId: string;
  sourceFeatureId: string;
  displayName?: string;
  period: TimeRange;
  entryPosition?: Point;
  exitPosition?: Point;
  sampleCount: number;
  confidence?: number;
}
export interface Point {
  type: "Point";
  /**
   * @minItems 2
   * @maxItems 2
   */
  coordinates: [number, number];
}
export interface OffNetwork {
  segmentId: string;
  period: TimeRange;
  sampleCount: number;
  entryPosition?: Point;
  exitPosition?: Point;
  /**
   * @minItems 2
   * @maxItems 256
   */
  pathPreview?: Point[];
  interpretationHint:
    | "UNMAPPED_PATH_CANDIDATE"
    | "OPEN_AREA_MOVEMENT"
    | "NETWORK_GEOMETRY_OFFSET_CANDIDATE"
    | "TEMPORARY_PATH_CANDIDATE"
    | "UNKNOWN";
  confidence?: number;
  /**
   * @minItems 0
   * @maxItems 100
   */
  reasonCodes: string[];
}
export interface Ambiguity {
  segmentId: string;
  period: TimeRange;
  /**
   * @minItems 0
   * @maxItems 32
   */
  candidateFeatureIds: string[];
  confidence?: number;
}
export interface NetworkIssue {
  issueKind:
    | "MISSING_PATH_CANDIDATE"
    | "MISSING_TOPOLOGY_CONNECTION_CANDIDATE"
    | "ROAD_GEOMETRY_OFFSET_CANDIDATE"
    | "DIRECTION_CONFLICT_CANDIDATE";
  period: TimeRange;
  /**
   * @minItems 0
   * @maxItems 32
   */
  relatedFeatureIds: string[];
  observationCount: number;
  confidence?: number;
  /**
   * @minItems 0
   * @maxItems 100
   */
  reasonCodes: string[];
}
export interface RoadAssociationPARTIAL {
  findingId: string;
  findingKind: "ROAD_ASSOCIATION";
  semanticConcept: string;
  status: "PARTIAL";
  /**
   * @minItems 1
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 1
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  trajectoryReferenceProductId: string;
  networkRole: "REFERENCE_MODEL_NOT_PHYSICAL_TRUTH";
  network: Network;
  /**
   * @minItems 0
   * @maxItems 100
   */
  roadVisits: RoadVisit[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  offNetworkSegments: OffNetwork[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  ambiguousSegments: Ambiguity[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  networkDataIssues: NetworkIssue[];
  associationPrefixComplete: boolean;
  associationSuffixComplete: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
  lastConfirmedRoad?: {
    visitId: string;
    confirmationScope: "CONFIRMED_IN_AVAILABLE_DATA";
    absoluteFinalRoadClaimed: false;
  };
}
export interface RoadAssociationNO_DATA {
  findingId: string;
  findingKind: "ROAD_ASSOCIATION";
  semanticConcept: string;
  status: "NO_DATA";
  /**
   * @minItems 0
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  trajectoryReferenceProductId?: string;
  networkRole: "REFERENCE_MODEL_NOT_PHYSICAL_TRUTH";
  network?: Network;
  /**
   * @minItems 0
   * @maxItems 100
   */
  roadVisits: RoadVisit[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  offNetworkSegments: OffNetwork[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  ambiguousSegments: Ambiguity[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  networkDataIssues: NetworkIssue[];
  associationPrefixComplete: boolean;
  associationSuffixComplete: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
  lastConfirmedRoad?: {
    visitId: string;
    confirmationScope: "CONFIRMED_IN_AVAILABLE_DATA";
    absoluteFinalRoadClaimed: false;
  };
}
export interface RoadAssociationINDETERMINATE {
  findingId: string;
  findingKind: "ROAD_ASSOCIATION";
  semanticConcept: string;
  status: "INDETERMINATE";
  /**
   * @minItems 0
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  trajectoryReferenceProductId?: string;
  networkRole: "REFERENCE_MODEL_NOT_PHYSICAL_TRUTH";
  network?: Network;
  /**
   * @minItems 0
   * @maxItems 100
   */
  roadVisits: RoadVisit[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  offNetworkSegments: OffNetwork[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  ambiguousSegments: Ambiguity[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  networkDataIssues: NetworkIssue[];
  associationPrefixComplete: boolean;
  associationSuffixComplete: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
  lastConfirmedRoad?: {
    visitId: string;
    confirmationScope: "CONFIRMED_IN_AVAILABLE_DATA";
    absoluteFinalRoadClaimed: false;
  };
}
export interface TemporalEventCOMPLETED {
  findingId: string;
  findingKind: "TEMPORAL_EVENT";
  semanticConcept: string;
  status: "COMPLETED";
  /**
   * @minItems 1
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 1
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  trajectoryReferenceProductId: string;
  /**
   * @minItems 1
   * @maxItems 6
   */
  eventTypes: ("ENTER" | "EXIT" | "DWELL" | "STOP" | "PASS_NEAR" | "CROSS")[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  events: Event[];
  selection?: EventSelection;
  sourcePrefixComplete: boolean;
  sourceSuffixComplete: boolean;
  completeForAllEvents: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
}
export interface Event {
  eventId: string;
  eventType: "ENTER" | "EXIT" | "DWELL" | "STOP" | "PASS_NEAR" | "CROSS";
  extent:
    | {
        kind: "INSTANT";
        timeWindow: TimeRange;
        estimatedAt?: string;
      }
    | {
        kind: "INTERVAL";
        period: TimeRange;
        durationSeconds: number;
        startTimeWindow?: TimeRange;
        endTimeWindow?: TimeRange;
      };
  position?: Point;
  target?:
    | {
        kind: "SPATIAL_TARGET";
        sourceTargetId: string;
        referenceProductId?: string;
        displayName?: string;
        targetType: "AREA" | "POINT" | "LINE";
      }
    | {
        kind: "NETWORK_JUNCTION";
        graphVersionId: string;
        graphVersion: string;
        nodeId: string;
        position: Point;
        incomingFeatureId: string;
        outgoingFeatureId: string;
      };
  certainty: "CONFIRMED_IN_AVAILABLE_DATA" | "APPROXIMATED" | "CLIPPED_TO_INPUT";
  confidence?: number;
  /**
   * @minItems 0
   * @maxItems 100
   */
  reasonCodes: string[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  evidenceIds: string[];
}
export interface EventSelection {
  kind: "FIRST" | "LAST";
  selectedEventId?: string;
  confirmed: boolean;
  confirmationScope: "REQUESTED_SCOPE_PROVEN" | "CONFIRMED_IN_AVAILABLE_DATA" | "NOT_CONFIRMED";
  reasonCode:
    | "FIRST_EVENT_CONFIRMED"
    | "FIRST_EVENT_NOT_CERTAIN"
    | "LAST_EVENT_CONFIRMED"
    | "LAST_EVENT_NOT_CERTAIN"
    | "NO_EVENT_FOUND";
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
}
export interface TemporalEventPARTIAL {
  findingId: string;
  findingKind: "TEMPORAL_EVENT";
  semanticConcept: string;
  status: "PARTIAL";
  /**
   * @minItems 1
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 1
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  trajectoryReferenceProductId: string;
  /**
   * @minItems 1
   * @maxItems 6
   */
  eventTypes: ("ENTER" | "EXIT" | "DWELL" | "STOP" | "PASS_NEAR" | "CROSS")[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  events: Event[];
  selection?: EventSelection;
  sourcePrefixComplete: boolean;
  sourceSuffixComplete: boolean;
  completeForAllEvents: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
}
export interface TemporalEventNO_DATA {
  findingId: string;
  findingKind: "TEMPORAL_EVENT";
  semanticConcept: string;
  status: "NO_DATA";
  /**
   * @minItems 0
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  trajectoryReferenceProductId?: string;
  /**
   * @minItems 1
   * @maxItems 6
   */
  eventTypes: ("ENTER" | "EXIT" | "DWELL" | "STOP" | "PASS_NEAR" | "CROSS")[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  events: Event[];
  selection?: EventSelection;
  sourcePrefixComplete: boolean;
  sourceSuffixComplete: boolean;
  completeForAllEvents: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
}
export interface TemporalEventINDETERMINATE {
  findingId: string;
  findingKind: "TEMPORAL_EVENT";
  semanticConcept: string;
  status: "INDETERMINATE";
  /**
   * @minItems 0
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  trajectoryReferenceProductId?: string;
  /**
   * @minItems 1
   * @maxItems 6
   */
  eventTypes: ("ENTER" | "EXIT" | "DWELL" | "STOP" | "PASS_NEAR" | "CROSS")[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  events: Event[];
  selection?: EventSelection;
  sourcePrefixComplete: boolean;
  sourceSuffixComplete: boolean;
  completeForAllEvents: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
}
export interface MetricRankingCOMPLETED {
  findingId: string;
  findingKind: "METRIC_RANKING";
  semanticConcept: string;
  status: "COMPLETED";
  /**
   * @minItems 1
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 1
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  trajectoryReferenceProductId: string;
  candidateDomain: "PAST_OBSERVED_LOCATIONS";
  metric: Metric;
  selectedSeries: Series;
  /**
   * @minItems 0
   * @maxItems 100
   */
  candidates: RankedLocation[];
  coverage: MetricCoverage;
}
export interface Metric {
  conceptId: string;
  observedProperty: string;
  measurementStage: "NORMALIZED" | "PARSED_NATIVE" | "FUSED_DERIVED";
  unit?: string;
  optimizationDirection: "MAXIMIZE" | "MINIMIZE";
}
export interface Series {
  sourceKey: string;
  datastreamKey: string;
  measurementKey: string;
  observedProperty: string;
  measurementStage: "NORMALIZED" | "PARSED_NATIVE" | "FUSED_DERIVED";
  valueUnit?: string;
}
export interface RankedLocation {
  candidateId: string;
  rank: number;
  representativeVisitedPosition: Point;
  representativeObservedAt: string;
  representativeMeasurementId: string;
  representativeValue: number;
  sampleCount: number;
  statistics: Statistics;
  rankingBasis: RankingBasis;
  h3Index?: string;
  /**
   * @minItems 0
   * @maxItems 100
   */
  reasonCodes: string[];
}
export interface Statistics {
  sampleCount: number;
  minimum: number;
  maximum: number;
  mean: number;
  median: number;
  p25?: number;
  p75?: number;
  medianAbsoluteDeviation?: number;
  firstObservedAt?: string;
  lastObservedAt?: string;
}
export interface RankingBasis {
  primaryStatistic: "MEDIAN";
  optimizationDirection: "MAXIMIZE" | "MINIMIZE";
  rankingValue: number;
  /**
   * @minItems 0
   * @maxItems 16
   */
  tieBreakers: string[];
}
export interface MetricCoverage {
  metricTemporalCompletenessKnown: false;
  trajectory: Coverage;
  /**
   * @minItems 0
   * @maxItems 100
   */
  trajectoryGaps: PeriodIssue[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  excludedPeriods: PeriodIssue[];
  sourceMetricSampleCount?: number;
  acceptedMetricSampleCount?: number;
  rejectedMetricSampleCount?: number;
  alignedMetricSampleCount?: number;
  unalignedMetricSampleCount?: number;
  alignmentRatio?: number;
}
export interface MetricRankingPARTIAL {
  findingId: string;
  findingKind: "METRIC_RANKING";
  semanticConcept: string;
  status: "PARTIAL";
  /**
   * @minItems 1
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 1
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  trajectoryReferenceProductId: string;
  candidateDomain: "PAST_OBSERVED_LOCATIONS";
  metric: Metric;
  selectedSeries: Series;
  /**
   * @minItems 0
   * @maxItems 100
   */
  candidates: RankedLocation[];
  coverage: MetricCoverage;
}
export interface MetricRankingNO_DATA {
  findingId: string;
  findingKind: "METRIC_RANKING";
  semanticConcept: string;
  status: "NO_DATA";
  /**
   * @minItems 0
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  trajectoryReferenceProductId?: string;
  candidateDomain: "PAST_OBSERVED_LOCATIONS";
  metric: Metric;
  selectedSeries?: Series;
  /**
   * @minItems 0
   * @maxItems 100
   */
  candidates: RankedLocation[];
  coverage: MetricCoverage;
}
export interface MetricRankingINDETERMINATE {
  findingId: string;
  findingKind: "METRIC_RANKING";
  semanticConcept: string;
  status: "INDETERMINATE";
  /**
   * @minItems 0
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  trajectoryReferenceProductId?: string;
  candidateDomain: "PAST_OBSERVED_LOCATIONS";
  metric: Metric;
  selectedSeries?: Series;
  /**
   * @minItems 0
   * @maxItems 100
   */
  candidates: RankedLocation[];
  coverage: MetricCoverage;
}
export interface ActionTargetCandidateCOMPLETED {
  findingId: string;
  findingKind: "ACTION_TARGET_CANDIDATE";
  semanticConcept: string;
  status: "COMPLETED";
  /**
   * @minItems 1
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 1
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  actionKind: "MOVE_TO_LOCATION";
  sourceKind: "HISTORICAL_METRIC_CANDIDATE";
  target: Point;
  crs: "EPSG:4326";
  axisOrder: "LONGITUDE_LATITUDE";
  sourceFindingId: string;
  sourceCandidateId: string;
  sourceRank: number;
  representativeObservedAt: string;
  representativeMeasurementId: string;
  requirements: {
    currentValidationRequired: true;
    routePlanningRequired: true;
    executionConfirmationRequired: true;
  };
  executionAuthorized: false;
}
export interface ActionTargetCandidatePARTIAL {
  findingId: string;
  findingKind: "ACTION_TARGET_CANDIDATE";
  semanticConcept: string;
  status: "PARTIAL";
  /**
   * @minItems 1
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 1
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  actionKind: "MOVE_TO_LOCATION";
  sourceKind: "HISTORICAL_METRIC_CANDIDATE";
  target: Point;
  crs: "EPSG:4326";
  axisOrder: "LONGITUDE_LATITUDE";
  sourceFindingId: string;
  sourceCandidateId: string;
  sourceRank: number;
  representativeObservedAt: string;
  representativeMeasurementId: string;
  requirements: {
    currentValidationRequired: true;
    routePlanningRequired: true;
    executionConfirmationRequired: true;
  };
  executionAuthorized: false;
}
export interface Gap {
  gapId: string;
  gapKind:
    | "CAPABILITY_UNAVAILABLE"
    | "REFERENCE_MISSING"
    | "REFERENCE_AMBIGUOUS"
    | "TASK_CONTEXT_REQUIRED"
    | "SUBJECT_CONTEXT_REQUIRED"
    | "TARGET_CONTEXT_REQUIRED"
    | "METRIC_UNSUPPORTED"
    | "METRIC_SERIES_AMBIGUOUS"
    | "HISTORICAL_PROJECTION_PENDING"
    | "HISTORICAL_DATA_INCOMPLETE"
    | "ANALYSIS_INCOMPLETE"
    | "RESULT_TRUNCATED"
    | "SELECTION_INVALID"
    | "SELECTION_EXPIRED"
    | "SELECTION_SCOPE_MISMATCH"
    | "SELECTION_AMBIGUOUS"
    | "UPSTREAM_CONTRACT_MISMATCH"
    | "UPSTREAM_TIMEOUT"
    | "UPSTREAM_FAILURE"
    | "CURRENT_VALIDATION_REQUIRED"
    | "ROUTE_PLANNING_REQUIRED"
    | "EXECUTION_CONFIRMATION_REQUIRED"
    | "EXECUTION_NOT_AUTHORIZED"
    | "MULTI_EXECUTION_UNSUPPORTED";
  severity: "INFO" | "WARNING" | "BLOCKING";
  messageCode:
    | "CAPABILITY_UNAVAILABLE"
    | "REFERENCE_MISSING"
    | "REFERENCE_AMBIGUOUS"
    | "TASK_CONTEXT_REQUIRED"
    | "SUBJECT_CONTEXT_REQUIRED"
    | "TARGET_CONTEXT_REQUIRED"
    | "METRIC_UNSUPPORTED"
    | "METRIC_SERIES_AMBIGUOUS"
    | "HISTORICAL_PROJECTION_PENDING"
    | "HISTORICAL_DATA_INCOMPLETE"
    | "ANALYSIS_INCOMPLETE"
    | "RESULT_TRUNCATED"
    | "SELECTION_INVALID"
    | "SELECTION_EXPIRED"
    | "SELECTION_SCOPE_MISMATCH"
    | "SELECTION_AMBIGUOUS"
    | "UPSTREAM_CONTRACT_MISMATCH"
    | "UPSTREAM_TIMEOUT"
    | "UPSTREAM_FAILURE"
    | "CURRENT_VALIDATION_REQUIRED"
    | "ROUTE_PLANNING_REQUIRED"
    | "EXECUTION_CONFIRMATION_REQUIRED"
    | "EXECUTION_NOT_AUTHORIZED"
    | "MULTI_EXECUTION_UNSUPPORTED";
  /**
   * @minItems 0
   * @maxItems 32
   */
  findingIds: string[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  evidenceIds: string[];
  detail: {
    reasonCode?: string;
    sourceStatus?: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE" | "FAILED" | "CANCELLED";
    returnedCount?: number;
    sourceCount?: number;
  };
}
export interface GroundingJob12PARTIAL {
  schemaVersion: "1.0";
  jobId: string;
  groundingId: string;
  requestId: string;
  status: "PARTIAL";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  result: GroundingResult12;
  error?: Error;
}
export interface GroundingJob12AMBIGUOUS {
  schemaVersion: "1.0";
  jobId: string;
  groundingId: string;
  requestId: string;
  status: "AMBIGUOUS";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  result: GroundingResult12;
  error?: Error;
}
export interface GroundingJob12UNRESOLVED {
  schemaVersion: "1.0";
  jobId: string;
  groundingId: string;
  requestId: string;
  status: "UNRESOLVED";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  result: GroundingResult12;
  error?: Error;
}
export interface GroundingJob12FAILED {
  schemaVersion: "1.0";
  jobId: string;
  groundingId: string;
  requestId: string;
  status: "FAILED";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: GroundingResult12;
  error?: Error;
}
export interface GroundingJob12CANCELLED {
  schemaVersion: "1.0";
  jobId: string;
  groundingId: string;
  requestId: string;
  status: "CANCELLED";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: GroundingResult12;
  error?: Error;
}
