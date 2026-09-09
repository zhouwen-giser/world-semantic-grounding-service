// Generated type-only projection of packages/metric-ranking-model/src/index.ts; source bytes recorded in intake.
import type {
  GeoJsonPoint,
  GeoJsonPolygon,
  ReferenceKey,
  TimeRange,
  TrajectoryExcludedPeriod,
  TrajectorySeries
} from "./trajectory.js";

export type MetricMeasurementStage = "NORMALIZED" | "PARSED_NATIVE" | "FUSED_DERIVED";
export type MetricOptimizationDirection = "MAXIMIZE" | "MINIMIZE";

export interface MetricSelector {
  observedProperty: string;
  valueUnit?: string;
  measurementStage?: MetricMeasurementStage;
  optimizationDirection: MetricOptimizationDirection;
  validValueRange?: { minimum?: number; maximum?: number };
  minimumQualityScore?: number;
}

type ExplicitMetricSeriesConstraint =
  | { sourceKey: string; datastreamKey?: string; measurementKey?: string }
  | { sourceKey?: string; datastreamKey: string; measurementKey?: string }
  | { sourceKey?: string; datastreamKey?: string; measurementKey: string };

export type MetricSeriesSelection =
  | { mode: "ONLY_CANDIDATE"; sourceKey?: never; datastreamKey?: never; measurementKey?: never }
  | ({ mode: "EXPLICIT_SERIES" } & ExplicitMetricSeriesConstraint);

export interface MetricAlignmentOptions {
  maximumTimeDeltaMs?: number;
  maximumInterpolationSpanMs?: number;
  maximumTimeUncertaintySeconds?: number;
}

export interface MetricAggregationOptions {
  mode: "H3";
  resolution?: number;
}

export interface MetricRankingOptions {
  topK?: number;
  minimumSamplesPerLocation?: number;
  minimumObservationSpanSeconds?: number;
}

export interface MetricRankingOutputOptions {
  includeCellBoundary?: boolean;
  maximumAlignedSamplePreview?: number;
  maximumUnalignedSamplePreview?: number;
  maximumRejectedMetricSamplePreview?: number;
  maximumSeriesCandidatePreview?: number;
}

export interface MetricLocationRankingRequestV01 {
  schemaVersion: "0.1";
  trajectoryReferenceKey: ReferenceKey & { kind: "HISTORICAL_TRAJECTORY" };
  metricSelector: MetricSelector;
  metricSeriesSelection?: MetricSeriesSelection;
  alignment?: MetricAlignmentOptions;
  aggregation?: MetricAggregationOptions;
  ranking?: MetricRankingOptions;
  output?: MetricRankingOutputOptions;
  profile?: "CAMPUS_TASK_DEFAULT";
}

export interface MetricSample {
  measurementId: string;
  observationId: string;
  timeSolutionId: string;
  sourceKey: string;
  datastreamKey: string;
  measurementKey: string;
  measurementStage: MetricMeasurementStage;
  observedProperty: string;
  observedAt: string;
  phenomenonTimeWindow?: TimeRange;
  timeUncertaintySeconds?: number;
  value: number;
  unit?: string;
  qualityScore?: number;
  qualityFlags: string[];
  measurementModel: string;
  measurementModelVersion: string;
}

export interface MetricSeriesIdentity {
  sourceKey: string;
  datastreamKey: string;
  measurementKey: string;
  measurementStage: MetricMeasurementStage;
  observedProperty: string;
  valueUnit?: string;
}

export interface MetricSeriesCandidate {
  seriesId: string;
  identity: MetricSeriesIdentity;
  sampleCount: number;
  observedPeriod: TimeRange;
  measurementModels: string[];
  measurementModelVersions: string[];
  qualityScoreAvailableCount: number;
}

export interface HistoricalMetricReadRequest {
  trajectory: TrajectorySeries;
  metricSelector: MetricSelector;
  metricSeriesSelection: MetricSeriesSelection;
  capturedAt: string;
  dataScopeKey: string;
}

export interface HistoricalMetricReadResult {
  seriesCandidates: MetricSeriesCandidate[];
  selectedSeries?: MetricSeriesIdentity;
  samples: MetricSample[];
  sampleSetDigest?: string;
  rowsRead: number;
}

export interface HistoricalMetricDataSource {
  loadMetricSeries(request: HistoricalMetricReadRequest): Promise<HistoricalMetricReadResult>;
  readiness(): Promise<{ ready: boolean; reasons: string[] }>;
  close?(): Promise<void>;
}

export type MetricRejectionReason =
  | "INVALID_OBSERVED_AT"
  | "NON_FINITE_VALUE"
  | "INVALID_QUALITY_SCORE"
  | "VALUE_BELOW_MINIMUM"
  | "VALUE_ABOVE_MAXIMUM"
  | "QUALITY_SCORE_UNAVAILABLE"
  | "QUALITY_SCORE_BELOW_MINIMUM";

export type MetricUnalignedReason =
  | "OUTSIDE_REQUESTED_PERIOD"
  | "EXCLUDED_PAUSED_PERIOD"
  | "UPSTREAM_TRAJECTORY_GAP"
  | "TRAJECTORY_QUALITY_BREAK"
  | "OUTSIDE_DEFINED_TRAJECTORY"
  | "TIME_DELTA_EXCEEDED"
  | "TIME_UNCERTAINTY_TOO_LARGE";

export type MetricAlignmentMethod =
  | "EXACT_TRAJECTORY_SAMPLE"
  | "INTERPOLATED_WITHIN_BLOCK"
  | "NEAREST_TRAJECTORY_SAMPLE";

export interface AlignedMetricSample {
  metricSample: MetricSample;
  position: GeoJsonPoint;
  alignmentMethod: MetricAlignmentMethod;
  trajectorySequenceNo: number;
  trajectoryBlockNo: number;
  trajectoryTimeDeltaMs: number;
  alignmentConfidence: number;
}

export interface UnalignedMetricSample {
  metricSample: MetricSample;
  reasonCode: MetricUnalignedReason;
}

export interface RejectedMetricSample {
  metricSample: MetricSample;
  reasonCode: MetricRejectionReason;
}

export interface AlignedMetricSamplePreview {
  measurementId: string;
  observationId: string;
  observedAt: string;
  value: number;
  valueUnit?: string;
  qualityScore?: number;
  position: GeoJsonPoint;
  h3Index: string;
  alignmentMethod: MetricAlignmentMethod;
  trajectorySequenceNo: number;
  trajectoryBlockNo: number;
  trajectoryTimeDeltaMs: number;
  alignmentConfidence: number;
}

export interface UnalignedMetricSamplePreview {
  measurementId: string;
  observationId: string;
  observedAt: string;
  value: number;
  valueUnit?: string;
  reasonCode: MetricUnalignedReason;
}

export interface RejectedMetricSamplePreview {
  measurementId: string;
  observationId: string;
  observedAt?: string;
  value?: number;
  valueUnit?: string;
  qualityScore?: number;
  reasonCode: MetricRejectionReason;
}

export interface MetricCellStatistics {
  sampleCount: number;
  distinctObservationCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
  observationSpanSeconds: number;
  minimum: number;
  maximum: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
  medianAbsoluteDeviation: number;
  meanQualityScore?: number;
  exactAlignmentCount: number;
  interpolatedAlignmentCount: number;
  nearestAlignmentCount: number;
  meanAlignmentConfidence: number;
}

export interface RankedMetricLocation {
  rank: number;
  spatialUnit: {
    kind: "H3_CELL";
    h3Index: string;
    resolution: number;
    cellCenter: GeoJsonPoint;
    boundary?: GeoJsonPolygon;
  };
  representativeVisitedPosition: GeoJsonPoint;
  representativeObservedAt: string;
  representativeMeasurementId: string;
  observedPeriod: TimeRange;
  statistics: MetricCellStatistics;
  representativeValue: number;
  rankingBasis: {
    primaryStatistic: "MEDIAN";
    optimizationDirection: MetricOptimizationDirection;
    tieBreakers: string[];
  };
  reasonCodes: string[];
}

export interface MetricRankingCompleteness {
  trajectoryTemporalCoverageRatio: number;
  trajectoryPrefixComplete: boolean;
  trajectorySuffixComplete: boolean;
  trajectoryGapPeriods: TimeRange[];
  trajectoryQualityBreakPeriods: TimeRange[];
  excludedPeriods: TrajectoryExcludedPeriod[];
  sourceMetricSampleCount: number;
  acceptedMetricSampleCount: number;
  rejectedMetricSampleCount: number;
  alignedMetricSampleCount: number;
  unalignedMetricSampleCount: number;
  alignmentRatio: number;
  unalignedReasonCounts: Partial<Record<MetricUnalignedReason, number>>;
  metricTemporalCompletenessKnown: false;
}

export interface MetricRankingSummary {
  metricSeriesCandidateCount: number;
  sourceMetricSampleCount: number;
  acceptedMetricSampleCount: number;
  rejectedMetricSampleCount: number;
  rejectedReasonCounts: Partial<Record<MetricRejectionReason, number>>;
  alignedMetricSampleCount: number;
  unalignedMetricSampleCount: number;
  aggregatedCellCount: number;
  qualifiedLocationCount: number;
  unqualifiedLocationCount: number;
  returnedLocationCount: number;
  truncated: boolean;
}

export type MetricRankingReasonCode =
  | "RANKING_AVAILABLE"
  | "RANKING_AVAILABLE_WITH_INCOMPLETE_COVERAGE"
  | "TRAJECTORY_NOT_FOUND"
  | "TRAJECTORY_EMPTY"
  | "NO_METRIC_SAMPLES"
  | "NO_ALIGNED_METRIC_SAMPLES"
  | "NO_QUALIFIED_LOCATIONS"
  | "TRAJECTORY_CONFLICTED"
  | "SUBJECT_REFERENCE_UNRESOLVED"
  | "METRIC_SERIES_AMBIGUOUS"
  | "METRIC_UNIT_CONFLICT"
  | "METRIC_SERIES_INVALID"
  | "ANALYSIS_UNUSABLE";

export type MetricRankingNoDataReasonCode = Extract<MetricRankingReasonCode,
  "TRAJECTORY_NOT_FOUND" | "TRAJECTORY_EMPTY" | "NO_METRIC_SAMPLES" | "NO_ALIGNED_METRIC_SAMPLES" | "NO_QUALIFIED_LOCATIONS">;

export type MetricRankingIndeterminateReasonCode = Extract<MetricRankingReasonCode,
  "TRAJECTORY_CONFLICTED" | "SUBJECT_REFERENCE_UNRESOLVED" | "METRIC_SERIES_AMBIGUOUS" | "METRIC_UNIT_CONFLICT" | "METRIC_SERIES_INVALID" | "ANALYSIS_UNUSABLE">;

export interface MetricLocationRankingResultCommonV01 {
  schemaVersion: "0.1";
  reasonCode: MetricRankingReasonCode;
  analysisLevel: "TASK_LEVEL_APPROXIMATE";
  algorithm: "CAMPUS_H3_ROBUST_RANKING_V1";
  candidateDomain: "PAST_OBSERVED_LOCATIONS";
  analysisId: string;
  trajectoryReferenceKey: ReferenceKey;
  analysisPeriods: TimeRange[];
  excludedPeriods: TrajectoryExcludedPeriod[];
  metric: {
    observedProperty: string;
    valueUnit?: string;
    measurementStage: MetricMeasurementStage;
    optimizationDirection: MetricOptimizationDirection;
  };
  metricSeriesCandidates: MetricSeriesCandidate[];
  aggregation: { mode: "H3"; resolution: number };
  candidates: RankedMetricLocation[];
  completeness: MetricRankingCompleteness;
  summary: MetricRankingSummary;
  alignedSamplePreview: AlignedMetricSamplePreview[];
  unalignedSamplePreview: UnalignedMetricSamplePreview[];
  rejectedMetricSamplePreview: RejectedMetricSamplePreview[];
  warnings: string[];
}

type MetricLocationRankingResultPayloadV01 = Omit<MetricLocationRankingResultCommonV01, "reasonCode">;

export type MetricLocationRankingAvailableResultV01 = MetricLocationRankingResultPayloadV01 & (
  | { status: "COMPLETED"; reasonCode: "RANKING_AVAILABLE"; subjectReferenceKey: ReferenceKey; selectedMetricSeries: MetricSeriesIdentity }
  | { status: "PARTIAL"; reasonCode: "RANKING_AVAILABLE_WITH_INCOMPLETE_COVERAGE"; subjectReferenceKey: ReferenceKey; selectedMetricSeries: MetricSeriesIdentity }
);

export type MetricLocationRankingNoDataResultV01 = MetricLocationRankingResultPayloadV01 & {
  status: "NO_DATA";
  reasonCode: MetricRankingNoDataReasonCode;
  subjectReferenceKey?: ReferenceKey;
  selectedMetricSeries?: MetricSeriesIdentity;
};

export type MetricLocationRankingIndeterminateResultV01 = MetricLocationRankingResultPayloadV01 & {
  status: "INDETERMINATE";
  reasonCode: MetricRankingIndeterminateReasonCode;
  subjectReferenceKey?: ReferenceKey;
  selectedMetricSeries?: MetricSeriesIdentity;
};

export type MetricLocationRankingResultV01 =
  | MetricLocationRankingAvailableResultV01
  | MetricLocationRankingNoDataResultV01
  | MetricLocationRankingIndeterminateResultV01;
