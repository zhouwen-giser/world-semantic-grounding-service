/* Generated from public JSON Schema. Do not edit. */

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
