import type { OperationAvailability } from "@wsgs/gowm-gateway-client";
import type {
  AnalysisOperationId, AnalysisProviderResultTypes, EventSelection, MetricSelector, MetricSeriesSelection,
  TemporalEventType, ValidatedAnalysisEnvelope, SpatialEventTarget
} from "@wsgs/gowm-contract-intake";
import type { HistoricalTraceIntent, HistoricalTraceFinding, HistoricalReferenceProjection, HistoricalReferenceKey } from "./types.js";

export type HistoricalScopeIntent = Omit<HistoricalTraceIntent, "queryKind" | "maximumInlinePoints">;
export type AdvancedAnalysisIntent =
  | { kind: "ROAD_ASSOCIATION"; output: "ROAD_VISITS" | "LAST_CONFIRMED_ROAD" | "OFF_NETWORK_SEGMENTS" | "NETWORK_DATA_ISSUES" }
  | { kind: "TEMPORAL_EVENT"; eventType: TemporalEventType; selection: EventSelection; targetMention?: string; targetReferenceKey?: HistoricalReferenceKey }
  | { kind: "METRIC_RANKING"; metricConceptId: string; metricSelector: MetricSelector; metricSeriesSelection: MetricSeriesSelection; topK: number; selectedRank?: number; actionTargetRequested: boolean };
export interface AdvancedHistoricalIntent { historicalScope: HistoricalScopeIntent; analysis: AdvancedAnalysisIntent }
export type AdvancedIntentResolution = { status: "PARSED"; intent: AdvancedHistoricalIntent } | { status: "UNRESOLVED"; reasonCode: string } | { status: "NOT_ADVANCED" };
export interface AdvancedHistoryConfiguration {
  enabled: boolean; contractRoot?: string; metricCatalogPath?: string;
  maximumEvents: number; maximumRoadVisits: number; maximumSegments: number;
  metricTopK: number; metricTopKMax: number; maximumWarnings: number; maximumSeriesCandidates: number;
  maximumSafePayloadBytes: number;
}
export interface AdvancedHistoricalFoundation {
  intent: HistoricalScopeIntent;
  finding: HistoricalTraceFinding;
  reference: HistoricalReferenceProjection;
}
export type AdvancedEnvelope = ValidatedAnalysisEnvelope<AnalysisProviderResultTypes[AnalysisOperationId]>;
export interface AdvancedAnalysisEvidence {
  operationId: AnalysisOperationId;
  envelope: AdvancedEnvelope;
}
export interface AdvancedAvailabilityObservation {
  schemaVersion: "1.0"; kind: "EXECUTION_AVAILABILITY"; requestId: string; observedAt: string;
  authorityHash: string; principalHash: string; delegationHash: string; observationHash: string;
  operations: OperationAvailability[];
}

export interface AdvancedHistoricalExecutionResult {
  status: "COMPLETED" | "PARTIAL" | "PENDING" | "AMBIGUOUS" | "UNRESOLVED" | "CAPABILITY_GAP" | "FAILED";
  reasonCode: string;
  intent: AdvancedHistoricalIntent;
  foundation?: AdvancedHistoricalFoundation;
  target?: SpatialEventTarget;
  analysisEvidence: AdvancedAnalysisEvidence[];
  findings: Record<string, unknown>[];
  operations: string[];
  planHash?: string;
  executionAvailabilityObservations?: AdvancedAvailabilityObservation[];
  publicEventSelection?: { sourceResultHash: string; eventId: string };
  comparison?: { changed: boolean; changedFields: string[] };
}
