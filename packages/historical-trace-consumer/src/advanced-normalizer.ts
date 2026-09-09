import type { MapMatchProviderResultV01, TemporalSpatialEventResultV01, MetricLocationRankingResultV01 } from "@wsgs/gowm-contract-intake";
import type { AdvancedAnalysisIntent, AdvancedHistoryConfiguration } from "./advanced-types.js";

type Json = Record<string, unknown>;
export function normalizeRoadAssociation(result: MapMatchProviderResultV01): Json {
  const last = result.roadVisits.at(-1);
  return {
    findingKind: "HISTORICAL_ROAD_ASSOCIATION", status: result.status, reasonCode: result.reasonCode, upstreamReasonCode: result.reasonCode,
    trajectoryReferenceKey: result.trajectoryReferenceKey, analysisId: result.analysisId,
    networkRole: result.networkRole, ...(result.networkContext ? { networkContext: result.networkContext } : {}),
    roadVisits: result.roadVisits, offNetworkSegments: result.offNetworkSegments,
    ambiguousSegments: result.ambiguousSegments, networkDataIssueCandidates: result.networkDataIssueCandidates,
    qualityBreaks: result.qualityBreaks, upstreamGaps: result.upstreamGaps,
    associationCompleteness: result.associationCompleteness, inputCompleteness: result.inputCompleteness,
    associationSuffixComplete: result.associationCompleteness.associationSuffixComplete,
    ...(last && (result.status === "COMPLETED" || result.status === "PARTIAL") ? {
      lastConfirmedRoad: { sourceFeatureReferenceId: last.sourceFeatureReferenceId,
        ...(last.roadDisplayName ? { roadDisplayName: last.roadDisplayName } : {}),
        confirmationScope: "CONFIRMED_IN_AVAILABLE_DATA", absoluteFinalRoadClaimed: false }
    } : {}),
    summary: result.summary, warnings: [...result.warnings,
      ...(!result.associationCompleteness.associationSuffixComplete ? ["ASSOCIATION_SUFFIX_INCOMPLETE"] : [])]
  };
}
export function normalizeTemporalEvent(result: TemporalSpatialEventResultV01): Json {
  return {
    findingKind: "HISTORICAL_TEMPORAL_EVENT", status: result.status, reasonCode: result.reasonCode, upstreamReasonCode: result.reasonCode,
    analysisId: result.analysisId, source: result.source, events: result.events, eventTypes: result.requestedEventTypes,
    ...(result.selectionResult ? { selection: result.selectionResult } : {}),
    completeness: result.completeness, blockingPeriods: result.completeness.blockingPeriods,
    summary: result.summary, truncated: result.summary.truncated,
    warnings: [...result.warnings, ...(result.selectionResult?.confirmed === false ? ["SELECTION_NOT_ABSOLUTELY_CONFIRMED"] : [])]
  };
}
export function normalizeMetricRanking(result: MetricLocationRankingResultV01, intent: Extract<AdvancedAnalysisIntent, { kind: "METRIC_RANKING" }>): Json[] {
  const finding: Json = {
    findingKind: "HISTORICAL_METRIC_RANKING", status: result.reasonCode === "METRIC_SERIES_AMBIGUOUS" ? "AMBIGUOUS" : result.status,
    reasonCode: result.reasonCode, upstreamReasonCode: result.reasonCode, analysisId: result.analysisId,
    trajectoryReferenceKey: result.trajectoryReferenceKey, candidateDomain: result.candidateDomain,
    metricConceptId: intent.metricConceptId, metric: result.metric,
    selectedMetricSeries: result.selectedMetricSeries, metricSeriesCandidates: result.metricSeriesCandidates,
    candidates: result.candidates.map(candidate => ({
      rank: candidate.rank, position: candidate.representativeVisitedPosition,
      observedAt: candidate.representativeObservedAt, representativeMeasurementId: candidate.representativeMeasurementId,
      representativeValue: candidate.representativeValue, ...(result.metric.valueUnit ? { unit: result.metric.valueUnit } : {}),
      sampleCount: candidate.statistics.sampleCount, h3Index: candidate.spatialUnit.h3Index,
      statistics: candidate.statistics, rankingBasis: candidate.rankingBasis, reasonCodes: candidate.reasonCodes
    })),
    metricTemporalCompletenessKnown: false, completeness: result.completeness, summary: result.summary,
    truncated: result.summary.truncated, warnings: [...result.warnings, "METRIC_TEMPORAL_COMPLETENESS_UNKNOWN"]
  };
  if (!intent.actionTargetRequested) return [finding];
  const selected = result.candidates.find(candidate => candidate.rank === (intent.selectedRank ?? 1));
  if (!selected || (result.status !== "COMPLETED" && result.status !== "PARTIAL")) return [finding];
  return [finding, {
    findingKind: "HISTORICAL_ACTION_TARGET_CANDIDATE", status: result.status,
    candidateDomain: "PAST_OBSERVED_LOCATIONS", position: selected.representativeVisitedPosition,
    sourceRank: selected.rank, metric: { conceptId: intent.metricConceptId, observedProperty: result.metric.observedProperty,
      value: selected.representativeValue, ...(result.metric.valueUnit ? { unit: result.metric.valueUnit } : {}),
      optimizationDirection: result.metric.optimizationDirection },
    sourceAnalysisId: result.analysisId, sourceTrajectoryReferenceKey: result.trajectoryReferenceKey,
    representativeMeasurementId: selected.representativeMeasurementId, representativeObservedAt: selected.representativeObservedAt,
    currentValidationRequired: true, routePlanningRequired: true, executionAuthorized: false,
    warnings: ["CURRENT_VALIDATION_REQUIRED", "ROUTE_PLANNING_REQUIRED", "EXECUTION_NOT_AUTHORIZED", ...result.warnings]
  }];
}

export function boundAdvancedSafePayload(payload: Json, configuration: AdvancedHistoryConfiguration): Json {
  let truncated = false;
  const limits: Record<string, number> = {
    roadVisits: configuration.maximumRoadVisits, offNetworkSegments: configuration.maximumSegments,
    ambiguousSegments: configuration.maximumSegments, networkDataIssueCandidates: configuration.maximumSegments,
    events: configuration.maximumEvents, candidates: configuration.metricTopKMax,
    metricSeriesCandidates: configuration.maximumSeriesCandidates, warnings: configuration.maximumWarnings
  };
  const bound = (value: unknown, key: string, depth: number): unknown => {
    if (depth > 24) { truncated = true; return null; }
    if (typeof value === "string" && value.length > 2048) { truncated = true; return value.slice(0, 2048); }
    if (Array.isArray(value)) {
      const maximum = key === "coordinates" ? 1000 : limits[key] ?? configuration.maximumSegments;
      if (value.length > maximum) truncated = true;
      return value.slice(0, maximum).map(entry => bound(entry, key, depth + 1));
    }
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Json)
      .filter(([, entry]) => entry !== undefined).map(([k, entry]) => [k, bound(entry, k, depth + 1)]));
    return value;
  };
  const result = bound(payload, "", 0) as Json;
  if (truncated) {
    result["truncated"] = true;
    result["warnings"] = [...new Set([...(result["warnings"] as string[] ?? []), "TRUNCATED"])].slice(-configuration.maximumWarnings);
  }
  if (Buffer.byteLength(JSON.stringify(result)) <= configuration.maximumSafePayloadBytes) return result;
  // Never partially crop a candidate geometry or quietly omit completeness. A
  // compact explicit gap is safer when metadata alone exceeds the byte budget.
  return { findingKind: payload["findingKind"], status: "PARTIAL", reasonCode: "ADVANCED_HISTORY_RESULT_TOO_LARGE",
    upstreamReasonCode: payload["upstreamReasonCode"], truncated: true,
    warnings: ["TRUNCATED", "ADVANCED_HISTORY_RESULT_TOO_LARGE"], executionAuthorized: false };
}
