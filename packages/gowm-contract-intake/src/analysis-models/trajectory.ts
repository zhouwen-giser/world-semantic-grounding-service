// Generated type-only projection of packages/trajectory-model/src/index.ts; source bytes recorded in intake.
export interface ReferenceKey {
  namespace: string;
  kind: string;
  id: string;
  version: string;
}

export type GeoJsonPosition = [number, number];
export type GeoJsonLinearRing = GeoJsonPosition[];
export interface GeoJsonPoint { type: "Point"; coordinates: GeoJsonPosition }
export interface GeoJsonLineString { type: "LineString"; coordinates: GeoJsonPosition[] }
export interface GeoJsonMultiLineString { type: "MultiLineString"; coordinates: GeoJsonPosition[][] }
export interface GeoJsonPolygon { type: "Polygon"; coordinates: GeoJsonLinearRing[] }
export interface GeoJsonMultiPolygon { type: "MultiPolygon"; coordinates: GeoJsonLinearRing[][] }
export type GeoJsonGeometry =
  | GeoJsonPoint
  | GeoJsonLineString
  | GeoJsonMultiLineString
  | GeoJsonPolygon
  | GeoJsonMultiPolygon;
export interface TimeRange { start: string; end: string }

export interface TrajectorySample {
  sampleId: string;
  sequenceNo: number;
  sampleNo: number;
  observedAt: string;
  position: GeoJsonPoint;
  accuracyM?: number;
  qualityScore?: number;
  qualityFlags?: string[];
}

export interface TrajectorySequence { sequenceNo: number; samples: TrajectorySample[] }

export interface TrajectoryGap extends TimeRange {
  gapNo: number;
  gapKind: string;
  reasonCodes: string[];
}

export interface TrajectoryExcludedPeriod extends TimeRange {
  excludedNo: number;
  exclusionKind: "EXCLUDED_PAUSED_PHASE";
}

export interface TrajectorySeries {
  trajectoryReferenceKey: ReferenceKey;
  subjectReferenceKey: ReferenceKey;
  revisionId: string;
  contentHash: string;
  worldVersion?: number;
  requestedPeriods: TimeRange[];
  definedPeriods: TimeRange[];
  gaps: TrajectoryGap[];
  excludedPeriods: TrajectoryExcludedPeriod[];
  sequences: TrajectorySequence[];
  completeness: {
    temporalCoverageRatio: number;
    sampleCount: number;
    sequenceCount: number;
    gapCount: number;
    prefixComplete: boolean;
    suffixComplete: boolean;
  };
  finalizationState: "PROVISIONAL" | "SEALED" | "CONFLICTED";
}

export interface NetworkContext {
  graphKey: string;
  graphVersionId: string;
  graphVersion: string;
  topologyHash: string;
  contentHash: string;
  datasetReferenceKey?: ReferenceKey;
}

export interface RoadCandidate {
  sampleId: string;
  edgeId: string;
  edgeKey: string;
  arcKey: string;
  sourceNodeKey: string;
  targetNodeKey: string;
  sourceFeatureReferenceId: string;
  roadDisplayName?: string;
  distanceM: number;
  snappedPosition: GeoJsonPoint;
  direction: "FORWARD" | "REVERSE";
  headingDifferenceDegrees?: number;
  directionConflict?: boolean;
}

export interface JunctionNode {
  nodeKey: string;
  position: GeoJsonPoint;
  incidentEdgeCount: number;
  distinctRoadFeatureCount: number;
}

export interface MapMatchingDataset {
  trajectory: TrajectorySeries;
  network: NetworkContext;
  candidatesBySampleId: Map<string, RoadCandidate[]>;
  junctionNodes: Map<string, JunctionNode>;
  rowsRead: number;
  candidatesRead: number;
  capturedAt: string;
}

export interface MapMatchRequestV01 {
  schemaVersion: "0.1";
  trajectoryReferenceKey: ReferenceKey & { kind: "HISTORICAL_TRAJECTORY" };
  network?: { graphKey?: string; graphVersion?: string };
  profile?: "CAMPUS_TASK_DEFAULT";
  output?: {
    maximumPointPreview?: number;
    maximumRejectedSamplePreview?: number;
    maximumOffNetworkPathPreviewPoints?: number;
  };
}

export type PointAssociationStatus = "ON_NETWORK" | "OFF_NETWORK_VALID" | "NETWORK_AMBIGUOUS" | "REJECTED_OUTLIER";

export interface QualityBreak extends TimeRange {
  sequenceNo: number;
  reasonCode: "DUPLICATE_TIME_POSITION_CONFLICT" | "UNEXPECTED_TIME_DISCONTINUITY" | "PLAUSIBILITY_BREAK" | "TIME_ORDER_VIOLATION";
}

export interface RejectedSample {
  sample: TrajectorySample;
  reasonCode: "INVALID_TIMESTAMP" | "INVALID_COORDINATE" | "NON_FINITE_COORDINATE" | "TIME_ORDER_VIOLATION" | "DUPLICATE_SAMPLE" | "DUPLICATE_TIME_POSITION_CONFLICT" | "ISOLATED_POSITION_SPIKE";
}

export interface FilteredSequence { sequenceNo: number; blockNo: number; samples: TrajectorySample[] }

export interface SanityFilterResult {
  sequences: FilteredSequence[];
  rejectedSamples: RejectedSample[];
  qualityBreaks: QualityBreak[];
  summary: { sourceSampleCount: number; acceptedSampleCount: number; rejectedSampleCount: number };
}

export interface PointAssociation {
  sample: TrajectorySample;
  status: Exclude<PointAssociationStatus, "REJECTED_OUTLIER">;
  candidate?: RoadCandidate;
  alternatives: RoadCandidate[];
  confidence: number;
  reasonCodes: string[];
  blockNo: number;
}

export interface RoadVisit {
  sequenceNo: number; visitNo: number; sourceFeatureReferenceId: string; roadDisplayName?: string; edgeKeys: string[];
  startTime: string; endTime: string; entryPosition: GeoJsonPoint; exitPosition: GeoJsonPoint;
  matchedSampleCount: number; bridgedAmbiguousSampleCount: number; confidence: number;
}

export interface OffNetworkSegment {
  sequenceNo: number; segmentNo: number; startTime: string; endTime: string; sampleCount: number; estimatedLengthM: number;
  entryPosition: GeoJsonPoint; exitPosition: GeoJsonPoint; precedingRoadVisitNo?: number; followingRoadVisitNo?: number;
  pathPreview: GeoJsonLineString;
  interpretationHint: "UNMAPPED_PATH_CANDIDATE" | "OPEN_AREA_MOVEMENT" | "NETWORK_GEOMETRY_OFFSET_CANDIDATE" | "TEMPORARY_PATH_CANDIDATE" | "UNKNOWN";
  confidence: number; reasonCodes: string[];
}

export interface AmbiguousAssociationSegment extends TimeRange {
  sequenceNo: number; segmentNo: number; sampleCount: number; candidateRoadFeatureReferenceIds: string[]; confidence: number;
}

export interface JunctionPassCandidate {
  sequenceNo: number; transitionNo: number; fromEdgeKey: string; toEdgeKey: string;
  fromSourceFeatureReferenceId: string; toSourceFeatureReferenceId: string; viaNodeKey: string;
  incidentEdgeCount: number; distinctRoadFeatureCount: number; eventTimeEstimate: string; eventTimeWindow: TimeRange;
  position: GeoJsonPoint; confidence: number; reasonCodes: string[];
}

export type NetworkDataIssueType = "MISSING_PATH_CANDIDATE" | "MISSING_TOPOLOGY_CONNECTION_CANDIDATE" | "ROAD_GEOMETRY_OFFSET_CANDIDATE" | "DIRECTION_CONFLICT_CANDIDATE";
export interface NetworkDataIssueCandidate {
  issueType: NetworkDataIssueType; observedPeriod: TimeRange; geometryPreview?: GeoJsonLineString | GeoJsonPoint;
  relatedRoadFeatureReferenceIds: string[]; observationCount: number; confidence: number; reasonCodes: string[];
}

export interface AssociationCompleteness {
  inputPrefixComplete: boolean; inputSuffixComplete: boolean; associationPrefixComplete: boolean; associationSuffixComplete: boolean;
  offNetworkPeriods: TimeRange[]; ambiguousPeriods: TimeRange[]; qualityBreakPeriods: TimeRange[]; upstreamGapPeriods: TimeRange[];
}

export interface MapMatchResultV01 {
  schemaVersion: "0.1";
  status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
  reasonCode: string;
  matchingLevel: "TASK_LEVEL_APPROXIMATE";
  algorithm: "CAMPUS_NEAREST_TOPOLOGY_V1";
  networkRole: "REFERENCE_MODEL_NOT_PHYSICAL_TRUTH";
  analysisId: string;
  trajectoryReferenceKey: ReferenceKey;
  subjectReferenceKey: ReferenceKey;
  networkContext: NetworkContext & { timeBasis: "CURRENT_ACTIVE_TOPOLOGY" };
  inputCompleteness: TrajectorySeries["completeness"] & { finalizationState: TrajectorySeries["finalizationState"] };
  roadVisits: RoadVisit[];
  offNetworkSegments: OffNetworkSegment[];
  ambiguousSegments: AmbiguousAssociationSegment[];
  junctionPassCandidates: JunctionPassCandidate[];
  networkDataIssueCandidates: NetworkDataIssueCandidate[];
  qualityBreaks: QualityBreak[];
  upstreamGaps: TrajectoryGap[];
  associationCompleteness: AssociationCompleteness;
  summary: {
    sourceSampleCount: number; acceptedSampleCount: number; rejectedSampleCount: number;
    onNetworkSampleCount: number; offNetworkSampleCount: number; ambiguousSampleCount: number;
    acceptedRatio: number; onNetworkAcceptedRatio: number; roadVisitCount: number; offNetworkSegmentCount: number;
    ambiguousSegmentCount: number; junctionPassCandidateCount: number;
  };
  pointAssociationPreview: Array<{ sampleId: string; sequenceNo: number; observedAt: string; position: GeoJsonPoint; status: PointAssociationStatus; edgeKey?: string; sourceFeatureReferenceId?: string; distanceM?: number; confidence: number; reasonCodes: string[] }>;
  rejectedSamplePreview: Array<{ sampleId: string; sequenceNo: number; observedAt: string; position: GeoJsonPoint; status: "REJECTED_OUTLIER"; reasonCode: string }>;
  warnings: string[];
}

/**
 * Provider-level terminal result used when the requested trajectory or graph
 * cannot be resolved. Fields that would require inventing world identity are
 * deliberately absent, while the operation still returns a schema-valid
 * non-failed output as required by Provider Protocol 1.0 semantics.
 */
export interface MapMatchUnavailableResultV01 extends Omit<
  MapMatchResultV01,
  "status" | "subjectReferenceKey" | "networkContext" | "inputCompleteness"
> {
  status: "NO_DATA" | "INDETERMINATE";
  subjectReferenceKey?: never;
  networkContext?: never;
  inputCompleteness?: never;
}

export type MapMatchProviderResultV01 = MapMatchResultV01 | MapMatchUnavailableResultV01;

