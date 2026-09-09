export interface HistoricalReferenceKey {
  namespace: string;
  kind: string;
  id: string;
  version: string;
}

export type HistoricalQueryKind =
  | "EXECUTION_INTERVAL"
  | "HISTORICAL_TRAJECTORY"
  | "TRAJECTORY_COMPLETENESS"
  | "TRAJECTORY_GAPS";

export type HistoricalExecutionSelection =
  | { kind: "LATEST" }
  | { kind: "EXECUTION_NO"; executionNo: number }
  | { kind: "ALL"; limit: number };

export type HistoricalPhaseScope = "EXECUTION_ENVELOPE" | "ACTIVE_PHASES_ONLY";

export type HistoricalSourceSelection =
  | { mode: "ONLY_CANDIDATE" }
  | { mode: "EXPLICIT_SOURCE"; sourceKey: string; trackerSessionKey?: string };

export interface HistoricalTraceIntent {
  queryKind: HistoricalQueryKind;
  subjectMention?: string;
  taskMention?: string;
  subjectReferenceKey?: HistoricalReferenceKey;
  taskReferenceKey?: HistoricalReferenceKey;
  executionSelection: HistoricalExecutionSelection;
  phaseScope: HistoricalPhaseScope;
  sourceSelection: HistoricalSourceSelection;
  maximumInlinePoints: number;
}

export interface OperationalTaskSnapshot {
  referenceKey: HistoricalReferenceKey;
  actorReferenceKeys: HistoricalReferenceKey[];
  activityState: string;
  controlState?: string;
}

export type HistoricalContextFailure =
  | "TASK_CONTEXT_REQUIRED"
  | "TASK_CONTEXT_AMBIGUOUS"
  | "SUBJECT_CONTEXT_REQUIRED"
  | "SUBJECT_CONTEXT_AMBIGUOUS"
  | "SUBJECT_TASK_MISMATCH";

export type HistoricalContextResolution =
  | {
      status: "RESOLVED";
      taskReferenceKey: HistoricalReferenceKey;
      subjectReferenceKey?: HistoricalReferenceKey;
      taskSnapshot?: OperationalTaskSnapshot;
      taskSource: "EXPLICIT" | "KNOWN_CONTEXT" | "PRIOR_SELECTION" | "ACTIVE_TASK_DISCOVERY";
    }
  | { status: "CONTEXT_GAP"; reason: HistoricalContextFailure; candidateCount: number };

export type HistoricalRequirementType =
  | "FIND_RELEVANT_OPERATIONAL_TASK"
  | "READ_OPERATIONAL_TASK"
  | "READ_TASK_EXECUTION_INTERVAL"
  | "READ_HISTORICAL_TRAJECTORY"
  | "READ_TRAJECTORY_COMPLETENESS"
  | "READ_TRAJECTORY_GAPS";

export interface HistoricalRequirementPlan {
  status: "PLANNED" | "PROJECTION_ONLY" | "CAPABILITY_GAP";
  requirements: HistoricalRequirementType[];
  reason?: HistoricalContextFailure | "MULTI_EXECUTION_TRAJECTORY_NOT_SUPPORTED" | "HISTORY_CAPABILITY_DISABLED";
}

export interface HistoricalTraceConfiguration {
  enabled: boolean;
  sourceSelectionProfileReferenceKey: HistoricalReferenceKey;
  maximumInlinePoints: number;
  analysisSpaceReferenceKey?: HistoricalReferenceKey;
  provisionalReferenceTtlMs: number;
  allIntervalsLimit: number;
  pendingRetryMs: number;
}

export interface TimeRange {
  start: string;
  end: string;
  bounds?: "[)";
}

export interface NormalizedExecutionInterval {
  executionIntervalReferenceKey: HistoricalReferenceKey;
  executionNo: number;
  revisionNo: number;
  start?: string;
  end?: string;
  lifecycleState: string;
  selectedPeriods: TimeRange[];
  activePeriods: TimeRange[];
  pausedPeriods: TimeRange[];
  derivationKind: string;
  stabilityState: string;
  confidence?: number;
  envelopeDurationMs: number;
  activeDurationMs: number;
  pausedDurationMs: number;
  durationAsOf?: string;
}

export interface HistoricalTrajectoryValue {
  trajectoryReferenceKey?: HistoricalReferenceKey;
  requestedPeriods: TimeRange[];
  definedPeriods: TimeRange[];
  excludedPeriods: unknown[];
  gaps: unknown[];
  inputTrackletVersions: unknown[];
  completeness: {
    temporalCoverageRatio: number;
    sampleCount: number;
    sequenceCount: number;
    gapCount: number;
    prefixComplete: boolean;
    suffixComplete: boolean;
  };
  finalization: { state: string; observedThrough?: string };
  inlineSamples: { mode: "FULL" | "BOUNDED_PREVIEW"; points: unknown[]; truncated: boolean };
}

export interface HistoricalTraceFinding {
  findingKind: "TASK_EXECUTION_INTERVAL" | "HISTORICAL_TRAJECTORY";
  status: "COMPLETED" | "PARTIAL" | "PENDING" | "NO_DATA" | "INDETERMINATE";
  reasonCode: string;
  taskReferenceKey?: HistoricalReferenceKey;
  subjectReferenceKey?: HistoricalReferenceKey;
  executionIntervals?: NormalizedExecutionInterval[];
  executionInterval?: NormalizedExecutionInterval;
  trajectory?: HistoricalTrajectoryValue;
  warnings: string[];
}

export interface HistoricalReferenceProjection {
  referenceKey: HistoricalReferenceKey;
  referenceType: "TASK_EXECUTION_INTERVAL" | "HISTORICAL_TRAJECTORY";
  revalidationRequired: boolean;
  validUntil?: string;
}

export interface PriorHistoricalResult {
  finding: HistoricalTraceFinding;
  taskReferenceKey?: HistoricalReferenceKey;
  subjectReferenceKey?: HistoricalReferenceKey;
  phaseScope: HistoricalPhaseScope;
  reference?: HistoricalReferenceProjection;
}

export type HistoricalFollowupDecision =
  | { mode: "REUSE"; queryKind: "TRAJECTORY_COMPLETENESS" | "TRAJECTORY_GAPS"; finding: HistoricalTraceFinding }
  | { mode: "REQUERY"; intent: HistoricalTraceIntent; compareWithPrior: boolean }
  | { mode: "NOT_HISTORICAL" };

export interface HistoricalFindingComparison {
  changed: boolean;
  changedFields: string[];
}
