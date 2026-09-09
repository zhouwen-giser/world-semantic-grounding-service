/* Generated from public JSON Schema. Do not edit. */

export type HistoricalTrace =
  HistoricalTraceCOMPLETED | HistoricalTracePARTIAL | HistoricalTraceNO_DATA | HistoricalTraceINDETERMINATE;

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
