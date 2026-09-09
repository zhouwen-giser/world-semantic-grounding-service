/* Generated from public JSON Schema. Do not edit. */

export type MetricRanking =
  MetricRankingCOMPLETED | MetricRankingPARTIAL | MetricRankingNO_DATA | MetricRankingINDETERMINATE;

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
export interface Display {
  truncated: boolean;
  returnedCount: number;
  sourceCount?: number;
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
export interface Point {
  type: "Point";
  /**
   * @minItems 2
   * @maxItems 2
   */
  coordinates: [number, number];
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
export interface Coverage {
  prefixComplete?: boolean;
  suffixComplete?: boolean;
  temporalCoverageRatio?: number;
  finalizationState?: "PROVISIONAL" | "SEALED" | "CONFLICTED";
  sampleCount?: number;
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
export interface TimeRange {
  start: string;
  end: string;
  bounds: "[)" | "[]" | "(]" | "()" | "UNSPECIFIED";
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
