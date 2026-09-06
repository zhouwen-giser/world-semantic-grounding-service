// Generated type-only projection of packages/temporal-events-model/src/index.ts; source bytes recorded in intake.
import type {
  GeoJsonLineString,
  GeoJsonMultiLineString,
  GeoJsonMultiPolygon,
  GeoJsonPoint,
  GeoJsonPolygon,
  MapMatchProviderResultV01,
  ReferenceKey,
  TimeRange
} from "./trajectory.js";

export type TemporalEventType = "ENTER" | "EXIT" | "DWELL" | "STOP" | "PASS_NEAR" | "CROSS";
export type HistoricalTemporalEventType = Exclude<TemporalEventType, "CROSS">;

export type EventSelection =
  | { kind: "ALL"; limit?: number }
  | { kind: "FIRST" }
  | { kind: "LAST" };

export interface HistoricalTrajectoryEventSource {
  kind: "HISTORICAL_TRAJECTORY";
  trajectoryReferenceKey: ReferenceKey & { kind: "HISTORICAL_TRAJECTORY" };
}

export interface MapMatchResultEventSource {
  kind: "MAP_MATCH_RESULT";
  mapMatchResult: MapMatchProviderResultV01;
}

export type TemporalEventSource = HistoricalTrajectoryEventSource | MapMatchResultEventSource;

interface SpatialEventTargetBase {
  targetId: string;
  referenceKey?: ReferenceKey;
  displayName?: string;
  crs: "EPSG:4326";
  geometryContentHash?: string;
  distanceThresholdM?: number;
}

export type SpatialEventTarget =
  | (SpatialEventTargetBase & { targetType: "AREA"; geometry: GeoJsonPolygon | GeoJsonMultiPolygon })
  | (SpatialEventTargetBase & { targetType: "POINT"; geometry: GeoJsonPoint })
  | (SpatialEventTargetBase & { targetType: "LINE"; geometry: GeoJsonLineString | GeoJsonMultiLineString });

export interface TemporalEventCriteria {
  minimumDwellSeconds?: number;
  minimumStopSeconds?: number;
  passNearDistanceM?: number;
}

export interface CrossTargetSelector {
  kind: "ROAD_INTERSECTION";
  viaNodeKeys?: string[];
  roadFeatureReferenceIds?: string[];
}

export interface TemporalSpatialEventRequestV01 {
  schemaVersion: "0.1";
  source: TemporalEventSource;
  eventTypes: TemporalEventType[];
  targets?: SpatialEventTarget[];
  crossTargetSelector?: CrossTargetSelector;
  criteria?: TemporalEventCriteria;
  selection?: EventSelection;
  profile?: "CAMPUS_TASK_DEFAULT";
}

export type HistoricalTemporalSpatialEventRequestV01 = Omit<TemporalSpatialEventRequestV01, "source" | "eventTypes" | "crossTargetSelector"> & {
  source: HistoricalTrajectoryEventSource;
  eventTypes: HistoricalTemporalEventType[];
  crossTargetSelector?: never;
};

export type MapMatchTemporalSpatialEventRequestV01 = Omit<TemporalSpatialEventRequestV01, "source" | "eventTypes" | "targets"> & {
  source: MapMatchResultEventSource;
  eventTypes: ["CROSS"];
  targets?: never;
};

export type EventSearchBlockingPeriodKind =
  | "UPSTREAM_GAP"
  | "QUALITY_BREAK"
  | "OFF_NETWORK_PERIOD"
  | "AMBIGUOUS_ASSOCIATION_PERIOD";

export interface EventSearchBlockingPeriod {
  kind: EventSearchBlockingPeriodKind;
  range: TimeRange;
  reasonCodes: string[];
}

export interface NetworkJunctionTarget {
  identityKind: "NETWORK_LOCAL_IDENTITY";
  graphVersionId: string;
  graphVersion: string;
  viaNodeKey: string;
  position: GeoJsonPoint;
  incidentEdgeCount: number;
  distinctRoadFeatureCount: number;
  incomingRoad: { sourceFeatureReferenceId: string; displayName?: string };
  outgoingRoad: { sourceFeatureReferenceId: string; displayName?: string };
}

export type TemporalSpatialEventTarget =
  | {
      kind: "SPATIAL_TARGET";
      targetId: string;
      referenceKey?: ReferenceKey;
      displayName?: string;
      targetType: "AREA" | "POINT" | "LINE";
    }
  | { kind: "NETWORK_JUNCTION"; junction: NetworkJunctionTarget };

export type TemporalEventExtent =
  | { kind: "INSTANT"; eventTimeEstimate: string; eventTimeWindow: TimeRange }
  | {
      kind: "INTERVAL";
      startTime: string;
      endTime: string;
      durationSeconds: number;
      startTimeWindow?: TimeRange;
      endTimeWindow?: TimeRange;
    };

export interface TemporalEventMetrics {
  sampleCount?: number;
  minimumDistanceM?: number;
  closestObservedAt?: string;
  clusterRadiusM?: number;
  netDisplacementM?: number;
}

export interface TemporalSpatialEventFinding {
  eventId: string;
  eventType: TemporalEventType;
  sequenceNo: number;
  blockNo?: number;
  target?: TemporalSpatialEventTarget;
  temporalExtent: TemporalEventExtent;
  position?: GeoJsonPoint;
  metrics?: TemporalEventMetrics;
  confidence: number;
  certainty: "CONFIRMED_IN_AVAILABLE_DATA" | "APPROXIMATED" | "CLIPPED_TO_INPUT";
  reasonCodes: string[];
}

export type HistoricalTrajectoryFinalizationState = "PROVISIONAL" | "SEALED" | "CONFLICTED";

export interface HistoricalTemporalSpatialEventResultSource {
  kind: "HISTORICAL_TRAJECTORY";
  trajectoryReferenceKey: ReferenceKey;
  finalizationState?: HistoricalTrajectoryFinalizationState;
  mapMatchAnalysisId?: never;
  mapMatchResultHash?: never;
  networkContext?: never;
}

export interface FinalizedHistoricalTemporalSpatialEventResultSource extends HistoricalTemporalSpatialEventResultSource {
  finalizationState: HistoricalTrajectoryFinalizationState;
}

export interface TemporalEventsNetworkContext {
  graphVersionId: string;
  graphVersion: string;
  topologyHash: string;
}

export interface MapMatchTemporalSpatialEventResultSource {
  kind: "MAP_MATCH_RESULT";
  mapMatchAnalysisId: string;
  mapMatchResultHash: string;
  trajectoryReferenceKey: ReferenceKey;
  networkContext?: TemporalEventsNetworkContext;
  finalizationState?: never;
}

export interface NetworkedMapMatchTemporalSpatialEventResultSource extends MapMatchTemporalSpatialEventResultSource {
  networkContext: TemporalEventsNetworkContext;
}

export type TemporalSpatialEventResultSource =
  | HistoricalTemporalSpatialEventResultSource
  | MapMatchTemporalSpatialEventResultSource;

export interface TemporalEventSelectionResult {
  kind: "FIRST" | "LAST";
  selectedEventId?: string;
  confirmed: boolean;
  reasonCode:
    | "FIRST_EVENT_CONFIRMED"
    | "FIRST_EVENT_NOT_CERTAIN"
    | "LAST_EVENT_CONFIRMED"
    | "LAST_EVENT_NOT_CERTAIN"
    | "NO_EVENT_FOUND";
  blockingPeriods: EventSearchBlockingPeriod[];
}

export interface TemporalEventCompleteness {
  sourcePrefixComplete: boolean;
  sourceSuffixComplete: boolean;
  completeForAllEvents: boolean;
  upstreamGapPeriods: TimeRange[];
  qualityBreakPeriods: TimeRange[];
  offNetworkPeriods: TimeRange[];
  ambiguousAssociationPeriods: TimeRange[];
  blockingPeriods: EventSearchBlockingPeriod[];
}

export interface TemporalEventSummary {
  sourceSampleCount?: number;
  targetCount: number;
  detectedEventCount: number;
  returnedEventCount: number;
  enterCount: number;
  exitCount: number;
  dwellCount: number;
  stopCount: number;
  passNearCount: number;
  crossCount: number;
  truncated: boolean;
}

export interface TemporalSpatialEventResultBaseV01 {
  schemaVersion: "0.1";
  reasonCode: string;
  analysisLevel: "TASK_LEVEL_APPROXIMATE";
  algorithm: "CAMPUS_TEMPORAL_EVENTS_V1";
  analysisId: string;
  requestedEventTypes: TemporalEventType[];
  events: TemporalSpatialEventFinding[];
  selectionResult?: TemporalEventSelectionResult;
  completeness: TemporalEventCompleteness;
  summary: TemporalEventSummary;
  warnings: string[];
}

export type TemporalSpatialEventResultWithRequiredContextV01 = TemporalSpatialEventResultBaseV01 & {
  status: "COMPLETED" | "PARTIAL";
  subjectReferenceKey: ReferenceKey;
} & (
  | { source: FinalizedHistoricalTemporalSpatialEventResultSource }
  | { source: NetworkedMapMatchTemporalSpatialEventResultSource }
);

export type IndeterminateTemporalSpatialEventResultV01 = TemporalSpatialEventResultBaseV01 & {
  status: "INDETERMINATE";
  subjectReferenceKey?: ReferenceKey;
} & (
  | { source: FinalizedHistoricalTemporalSpatialEventResultSource }
  | { source: MapMatchTemporalSpatialEventResultSource }
);

export type NoDataTemporalSpatialEventResultV01 = TemporalSpatialEventResultBaseV01 & {
  status: "NO_DATA";
  subjectReferenceKey?: ReferenceKey;
  source: TemporalSpatialEventResultSource;
};

export type TemporalSpatialEventResultV01 =
  | TemporalSpatialEventResultWithRequiredContextV01
  | IndeterminateTemporalSpatialEventResultV01
  | NoDataTemporalSpatialEventResultV01;
