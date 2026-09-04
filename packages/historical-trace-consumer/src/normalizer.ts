import type {
  HistoricalReferenceProjection,
  HistoricalTraceFinding,
  HistoricalTrajectoryValue,
  NormalizedExecutionInterval,
  TimeRange
} from "./types.js";

type JsonObject = Record<string, unknown>;

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonObject;
}

function string(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function integer(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(code);
  return value as number;
}

function reference(value: unknown, expectedKind: string): { namespace: string; kind: string; id: string; version: string } {
  const key = object(value, "HISTORICAL_REFERENCE_INVALID");
  const kind = string(key["kind"], "HISTORICAL_REFERENCE_KIND_INVALID");
  if (kind !== expectedKind) throw new Error("HISTORICAL_REFERENCE_KIND_MISMATCH");
  return {
    namespace: string(key["namespace"], "HISTORICAL_REFERENCE_NAMESPACE_INVALID"),
    kind,
    id: string(key["id"], "HISTORICAL_REFERENCE_ID_INVALID"),
    version: string(key["version"], "HISTORICAL_REFERENCE_VERSION_INVALID")
  };
}

function ranges(value: unknown): TimeRange[] {
  if (!Array.isArray(value)) throw new Error("HISTORICAL_PERIODS_INVALID");
  return value.map((raw) => {
    const range = object(raw, "HISTORICAL_PERIOD_INVALID");
    const start = string(range["start"], "HISTORICAL_PERIOD_START_INVALID");
    const end = string(range["end"], "HISTORICAL_PERIOD_END_INVALID");
    if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) < Date.parse(start)) {
      throw new Error("HISTORICAL_PERIOD_ORDER_INVALID");
    }
    return { start, end, ...(range["bounds"] === "[)" ? { bounds: "[)" as const } : {}) };
  });
}

function duration(periods: readonly TimeRange[]): number {
  return periods.reduce((sum, period) => sum + Date.parse(period.end) - Date.parse(period.start), 0);
}

function normalizeInterval(raw: unknown): NormalizedExecutionInterval {
  const value = object(raw, "HISTORICAL_INTERVAL_INVALID");
  const selectedPeriods = ranges(value["selectedPeriods"]);
  const activePeriods = ranges(value["activePeriods"]);
  const pausedPeriods = ranges(value["pausedPeriods"]);
  const end = typeof value["end"] === "string" ? value["end"] : undefined;
  const durationAsOf = [...selectedPeriods.map((entry) => entry.end), ...(end ? [end] : [])].sort().at(-1);
  return {
    executionIntervalReferenceKey: reference(value["executionIntervalReferenceKey"], "TASK_EXECUTION_INTERVAL"),
    executionNo: integer(value["executionNo"], "HISTORICAL_EXECUTION_NO_INVALID"),
    revisionNo: integer(value["revisionNo"], "HISTORICAL_REVISION_NO_INVALID"),
    ...(typeof value["start"] === "string" ? { start: value["start"] } : {}),
    ...(end ? { end } : {}),
    lifecycleState: string(value["lifecycleState"], "HISTORICAL_LIFECYCLE_INVALID"),
    selectedPeriods,
    activePeriods,
    pausedPeriods,
    derivationKind: string(value["derivationKind"], "HISTORICAL_DERIVATION_INVALID"),
    stabilityState: string(value["stabilityState"], "HISTORICAL_STABILITY_INVALID"),
    ...(typeof value["confidence"] === "number" ? { confidence: value["confidence"] } : {}),
    envelopeDurationMs: duration(selectedPeriods),
    activeDurationMs: duration(activePeriods),
    pausedDurationMs: duration(pausedPeriods),
    ...(durationAsOf ? { durationAsOf } : {})
  };
}

function mappedStatus(status: unknown, reasonCode: string): HistoricalTraceFinding["status"] {
  if (reasonCode === "PROJECTION_PENDING") return "PENDING";
  if (status === "COMPLETED" || status === "PARTIAL" || status === "NO_DATA") return status;
  return "INDETERMINATE";
}

export function normalizeExecutionIntervalResult(raw: unknown): HistoricalTraceFinding {
  const value = object(raw, "HISTORICAL_INTERVAL_RESULT_INVALID");
  const reasonCode = string(value["reasonCode"], "HISTORICAL_REASON_INVALID");
  const intervals = Array.isArray(value["intervals"]) ? value["intervals"].map(normalizeInterval) : [];
  const conflicted = intervals.some((interval) => interval.lifecycleState === "CONFLICTED" || interval.stabilityState === "CONFLICTED");
  const status = conflicted ? "INDETERMINATE" : mappedStatus(value["status"], reasonCode);
  return {
    findingKind: "TASK_EXECUTION_INTERVAL",
    status,
    reasonCode: conflicted ? "EXECUTION_INTERVAL_CONFLICTED" : reasonCode,
    executionIntervals: intervals,
    ...(intervals.length === 1 ? { executionInterval: intervals[0] } : {}),
    warnings: [
      ...(value["truncated"] === true ? ["EXECUTION_INTERVAL_LIST_TRUNCATED"] : []),
      ...(conflicted ? ["CONFLICTED_INTERVAL_NOT_USABLE_FOR_TRAJECTORY"] : [])
    ]
  };
}

export function normalizeHistoricalTrajectoryResult(raw: unknown): HistoricalTraceFinding {
  const value = object(raw, "HISTORICAL_TRAJECTORY_RESULT_INVALID");
  const reasonCode = string(value["reasonCode"], "HISTORICAL_REASON_INVALID");
  const status = mappedStatus(value["status"], reasonCode);
  const finalization = object(value["finalization"], "HISTORICAL_FINALIZATION_INVALID");
  const completeness = object(value["completeness"], "HISTORICAL_COMPLETENESS_INVALID");
  const preview = Array.isArray(value["preview"]) ? structuredClone(value["preview"]) : [];
  const sampleCount = integer(completeness["sampleCount"], "HISTORICAL_SAMPLE_COUNT_INVALID");
  const temporalCoverageRatio = Number(completeness["temporalCoverageRatio"]);
  if (!Number.isFinite(temporalCoverageRatio) || temporalCoverageRatio < 0 || temporalCoverageRatio > 1) {
    throw new Error("HISTORICAL_COVERAGE_INVALID");
  }
  const full = status === "COMPLETED" && temporalCoverageRatio === 1 && completeness["prefixComplete"] === true &&
    completeness["suffixComplete"] === true && preview.length === sampleCount;
  const trajectory: HistoricalTrajectoryValue = {
    ...(value["trajectoryReferenceKey"] === undefined
      ? {}
      : { trajectoryReferenceKey: reference(value["trajectoryReferenceKey"], "HISTORICAL_TRAJECTORY") }),
    requestedPeriods: ranges(value["requestedPeriods"]),
    definedPeriods: ranges(value["definedPeriods"]),
    excludedPeriods: Array.isArray(value["excludedPeriods"]) ? structuredClone(value["excludedPeriods"]) : [],
    gaps: Array.isArray(value["gaps"]) ? structuredClone(value["gaps"]) : [],
    inputTrackletVersions: Array.isArray(value["inputTrackletVersions"]) ? structuredClone(value["inputTrackletVersions"]) : [],
    completeness: {
      temporalCoverageRatio,
      sampleCount,
      sequenceCount: integer(completeness["sequenceCount"], "HISTORICAL_SEQUENCE_COUNT_INVALID"),
      gapCount: integer(completeness["gapCount"], "HISTORICAL_GAP_COUNT_INVALID"),
      prefixComplete: completeness["prefixComplete"] === true,
      suffixComplete: completeness["suffixComplete"] === true
    },
    finalization: {
      state: string(finalization["state"], "HISTORICAL_FINALIZATION_STATE_INVALID"),
      ...(typeof finalization["observedThrough"] === "string" ? { observedThrough: finalization["observedThrough"] } : {})
    },
    inlineSamples: { mode: full ? "FULL" : "BOUNDED_PREVIEW", points: preview, truncated: !full }
  };
  const conflicted = trajectory.finalization.state === "CONFLICTED";
  return {
    findingKind: "HISTORICAL_TRAJECTORY",
    status: conflicted ? "INDETERMINATE" : status,
    reasonCode: conflicted ? "TRAJECTORY_CONFLICTED" : reasonCode,
    subjectReferenceKey: reference(value["subjectReferenceKey"], string(object(value["subjectReferenceKey"], "SUBJECT_REFERENCE_INVALID")["kind"], "SUBJECT_KIND_INVALID")),
    trajectory,
    warnings: [
      ...(Array.isArray(value["warnings"]) ? value["warnings"].filter((entry): entry is string => typeof entry === "string") : []),
      ...(!full && preview.length > 0 ? ["INLINE_SAMPLES_ARE_BOUNDED_PREVIEW"] : []),
      ...(trajectory.gaps.length > 0 ? ["TRAJECTORY_GAPS_DO_NOT_IMPLY_STOP"] : []),
      ...(trajectory.excludedPeriods.length > 0 ? ["PAUSED_PERIODS_ARE_EXCLUDED_NOT_MISSING"] : [])
    ]
  };
}

export function projectHistoricalReference(
  finding: HistoricalTraceFinding,
  provisionalTtlMs: number,
  now: Date = new Date()
): HistoricalReferenceProjection | null {
  const interval = finding.executionInterval;
  if (finding.findingKind === "TASK_EXECUTION_INTERVAL" && interval && interval.lifecycleState !== "CONFLICTED") {
    const revalidationRequired = interval.lifecycleState === "OPEN" || interval.stabilityState !== "SEALED";
    return {
      referenceKey: interval.executionIntervalReferenceKey,
      referenceType: "TASK_EXECUTION_INTERVAL",
      revalidationRequired,
      ...(revalidationRequired ? { validUntil: new Date(now.getTime() + provisionalTtlMs).toISOString() } : {})
    };
  }
  const trajectory = finding.trajectory;
  if (finding.findingKind === "HISTORICAL_TRAJECTORY" && trajectory?.trajectoryReferenceKey &&
      trajectory.finalization.state !== "CONFLICTED" && finding.status !== "PENDING") {
    const revalidationRequired = trajectory.finalization.state !== "SEALED";
    return {
      referenceKey: trajectory.trajectoryReferenceKey,
      referenceType: "HISTORICAL_TRAJECTORY",
      revalidationRequired,
      ...(revalidationRequired ? { validUntil: new Date(now.getTime() + provisionalTtlMs).toISOString() } : {})
    };
  }
  return null;
}
