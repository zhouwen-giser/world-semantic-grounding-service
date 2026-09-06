import {
  createWorldAnalysisValidator, worldAnalysisCanonicalHash as hash,
  worldAnalysisFindingSetHash, worldAnalysisResultHash, aggregateAnalysisStatus,
  WORLD_ANALYSIS_RESULT_PROFILE,
  type GroundingResult12, type WorldAnalysisFindings, type WorldAnalysisGap
} from "@wsgs/contracts";
import {
  AnalysisProviderContracts, analysisHash, type AnalysisOperationId,
  type ValidatedAnalysisEnvelope, type MapMatchProviderResultV01,
  type TemporalSpatialEventResultV01, type MetricLocationRankingResultV01
} from "@wsgs/gowm-contract-intake";
import type { AdvancedHistoricalExecutionResult, AdvancedHistoricalFoundation } from "./advanced-types.js";
import type { HistoricalReferenceKey, TimeRange } from "./types.js";
import type { MetricSemanticCatalog } from "./metric-semantic-catalog.js";

type Json = Record<string, unknown>;
type Finding = WorldAnalysisFindings["findings"][number];
type Choice = WorldAnalysisFindings["choices"][number];
type Evidence = GroundingResult12["evidenceItems"][number];
type GapKind = WorldAnalysisGap["gapKind"];
const validate = createWorldAnalysisValidator();
const codePattern = /^[A-Z][A-Z0-9_:.@/-]{0,255}$/u;
const codes = (values: readonly string[]) => [...new Set(values.filter(value => codePattern.test(value)))].slice(0, 100);
const range = (value: TimeRange) => ({ start: value.start, end: value.end, bounds: value.bounds ?? "UNSPECIFIED" });
const stableId = (prefix: string, value: unknown) => `${prefix}-${hash(value).slice(7, 39)}`;

class ProjectionError extends Error {
  constructor(readonly gapKind: GapKind) { super(gapKind); }
}
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
  return value as Json;
}
function periodIssue(value: unknown, fallback: string): Json {
  const item = object(value);
  const source = object(item["range"] ?? item["period"] ?? item);
  if (typeof source["start"] !== "string" || typeof source["end"] !== "string") throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
  const kind = item["kind"] ?? item["gapKind"] ?? item["exclusionKind"] ?? fallback;
  if (typeof kind !== "string" || !codePattern.test(kind)) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
  const reasons = item["reasonCodes"] ?? [];
  if (!Array.isArray(reasons) || reasons.some(reason => typeof reason !== "string")) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
  return { period: range({ start: source["start"], end: source["end"], ...(source["bounds"] === "[)" ? { bounds: "[)" as const } : {}) }), kind, reasonCodes: codes(reasons as string[]) };
}

export interface PublicWorldAnalysisContext {
  groundingId: string;
  referenceProducts: GroundingResult12["referenceProducts"];
  evidenceItems: GroundingResult12["evidenceItems"];
  foundationEvidenceIds: string[];
  validUntil: string;
}
export interface PublicWorldAnalysisProjection {
  component: WorldAnalysisFindings;
  evidenceItems: GroundingResult12["evidenceItems"];
  status: GroundingResult12["status"];
}

/** This mapper only consumes server-validated history and revalidates Provider envelopes. */
export function projectPublicWorldAnalysis(input: {
  context: PublicWorldAnalysisContext;
  contracts: AnalysisProviderContracts;
  catalog?: MetricSemanticCatalog;
  advanced?: AdvancedHistoricalExecutionResult;
  foundation?: AdvancedHistoricalFoundation;
}): PublicWorldAnalysisProjection {
  const { context } = input;
  const findings: Finding[] = [];
  const choices: Choice[] = [];
  const gaps: WorldAnalysisGap[] = [];
  const evidenceItems: Evidence[] = [...context.evidenceItems];
  const validatedMaps = new Map<string, MapMatchProviderResultV01>();
  const foundation = input.foundation ?? input.advanced?.foundation;
  const id = (prefix: string, source: unknown) => stableId(prefix, { groundingId: context.groundingId, source });
  const gap = (gapKind: GapKind, source: unknown, severity: WorldAnalysisGap["severity"] = "BLOCKING") => {
    gaps.push({ gapId: id("gap", { gapKind, source }), gapKind, severity, messageCode: gapKind, findingIds: [], evidenceIds: [], detail: {} });
  };
  function reference(key: HistoricalReferenceKey | undefined, required = false): string | undefined {
    if (!key) { if (required) throw new ProjectionError("REFERENCE_MISSING"); return undefined; }
    const matched = context.referenceProducts.filter(product => hash(product.referenceKey) === hash(key));
    if (matched.length !== 1 || !validate("reference-product", matched[0]).valid) throw new ProjectionError("REFERENCE_MISSING");
    return matched[0]!.productId;
  }
  function base(kind: Finding["findingKind"], source: unknown, status: Finding["status"], subject: HistoricalReferenceKey | undefined, evidenceIds: string[], warnings: string[], count: number): Json {
    const product = reference(subject, status === "COMPLETED" || status === "PARTIAL");
    if (evidenceIds.some(key => !evidenceItems.some(item => item.evidenceProductId === key))) throw new ProjectionError("REFERENCE_MISSING");
    return { findingId: id("finding", { kind, source }), findingKind: kind, semanticConcept: kind, status,
      subjectReferenceProductIds: product ? [product] : [], evidenceIds, unknowns: [], warnings: codes(warnings),
      display: { returnedCount: count, truncated: false }, validUntil: context.validUntil };
  }
  function accept(value: Json, schema: string): Finding {
    const bounded = boundPublicFinding(value, input.advanced?.intent.analysis.kind === "METRIC_RANKING" ? input.advanced.intent.analysis.selectedRank : undefined);
    if (bounded.truncated) gap("RESULT_TRUNCATED", value["findingId"], bounded.proofRetained ? "INFO" : "WARNING");
    value = bounded.value;
    const result = validate(`urn:wsgs:world-analysis:1.0:${schema}`, value);
    if (!result.valid) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
    return value as unknown as Finding;
  }
  function optionalReference(name: string, key: HistoricalReferenceKey | undefined): Json {
    const productId = reference(key);
    return productId ? { [name]: productId } : {};
  }
  if (foundation) {
    try {
      if (foundation.intent.executionSelection.kind === "ALL" || (foundation.finding.executionIntervals?.length ?? 0) > 1) throw new ProjectionError("MULTI_EXECUTION_UNSUPPORTED");
      const history = foundation.finding;
      if (history.status === "PENDING") gap("HISTORICAL_PROJECTION_PENDING", "foundation");
      else {
        const interval = history.executionInterval;
        const trajectory = history.trajectory;
        const projected = {
          ...base("HISTORICAL_TRACE", { task: foundation.intent.taskReferenceKey, execution: interval?.executionNo }, history.status, history.subjectReferenceKey ?? foundation.intent.subjectReferenceKey, context.foundationEvidenceIds, history.warnings, trajectory?.definedPeriods.length ?? 0),
          ...optionalReference("taskReferenceProductId", history.taskReferenceKey ?? foundation.intent.taskReferenceKey),
          ...optionalReference("executionIntervalReferenceProductId", interval?.executionIntervalReferenceKey),
          ...optionalReference("trajectoryReferenceProductId", trajectory?.trajectoryReferenceKey),
          ...(interval ? { executionNo: interval.executionNo, lifecycleState: interval.lifecycleState } : {}),
          phaseScope: foundation.intent.phaseScope,
          selectedPeriods: (interval?.selectedPeriods ?? []).map(range), activePeriods: (interval?.activePeriods ?? []).map(range), pausedPeriods: (interval?.pausedPeriods ?? []).map(range),
          requestedPeriods: (trajectory?.requestedPeriods ?? []).map(range), definedPeriods: (trajectory?.definedPeriods ?? []).map(range),
          excludedPeriods: (trajectory?.excludedPeriods ?? []).map(item => periodIssue(item, "EXCLUDED_PAUSED_PHASE")),
          trajectoryGaps: (trajectory?.gaps ?? []).map(item => periodIssue(item, "UPSTREAM_GAP")),
          coverage: trajectory ? { prefixComplete: trajectory.completeness.prefixComplete, suffixComplete: trajectory.completeness.suffixComplete, temporalCoverageRatio: trajectory.completeness.temporalCoverageRatio, sampleCount: trajectory.completeness.sampleCount, finalizationState: trajectory.finalization.state } : {}
        };
        findings.push(accept(projected, "historical-trace"));
      }
    } catch (error) { gap(error instanceof ProjectionError ? error.gapKind : "UPSTREAM_CONTRACT_MISMATCH", "foundation"); }
  }
  if (foundation?.intent.executionSelection.kind === "ALL" || (foundation?.finding.executionIntervals?.length ?? 0) > 1) return finish();
  if (foundation?.finding.trajectory?.finalization.state === "CONFLICTED") {
    gap("HISTORICAL_DATA_INCOMPLETE", "conflicted-foundation");
    return finish();
  }
  for (const source of input.advanced?.analysisEvidence ?? []) {
    const startEvidenceCount = evidenceItems.length;
    const startFindingCount = findings.length;
    const startChoiceCount = choices.length;
    const startGapCount = gaps.length;
    try {
      const envelope = input.contracts.validateEnvelope(source.operationId, source.envelope);
      const evidenceId = id("evidence", { operation: source.operationId, resultHash: envelope.execution.resultHash });
      const evidence = projectEvidence(envelope, source.operationId, evidenceId);
      if (!validate("evidence", evidence).valid) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
      evidenceItems.push(evidence);
      const sourceId = envelope.execution.resultHash;
      if (source.operationId === "trajectory.map-match") {
        const result = input.contracts.validateResult(source.operationId, envelope.output.value);
        assertScope(result.trajectoryReferenceKey, result.subjectReferenceKey);
        validatedMaps.set(analysisHash(result), result);
        const value = {
          ...base("ROAD_ASSOCIATION", sourceId, result.status, result.subjectReferenceKey, [evidenceId], [...result.warnings, result.reasonCode], result.roadVisits.length),
          ...optionalReference("trajectoryReferenceProductId", result.trajectoryReferenceKey),
          ...projectRoad(result, visit => id("visit", { sourceId, sequence: visit.sequenceNo, visit: visit.visitNo }))
        };
        findings.push(accept(value, "road-association"));
      } else if (source.operationId === "temporal-spatial.find-events") {
        const result = input.contracts.validateResult(source.operationId, envelope.output.value);
        assertScope(result.source.trajectoryReferenceKey, result.subjectReferenceKey);
        const intent = input.advanced!.intent.analysis;
        if (intent.kind !== "TEMPORAL_EVENT" || analysisHash(result.requestedEventTypes) !== analysisHash([intent.eventType]) || (intent.selection.kind !== "ALL" && result.selectionResult?.kind !== intent.selection.kind)) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
        if (intent.eventType === "CROSS" && (result.source.kind !== "MAP_MATCH_RESULT" || !validatedMaps.has(result.source.mapMatchResultHash))) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
        if (intent.eventType === "CROSS" && result.source.kind === "MAP_MATCH_RESULT") {
          const map = validatedMaps.get(result.source.mapMatchResultHash)!;
          if (!["COMPLETED", "PARTIAL"].includes(map.status) || !map.networkContext || analysisHash(result.source.networkContext) !== analysisHash({ graphVersionId: map.networkContext.graphVersionId, graphVersion: map.networkContext.graphVersion, topologyHash: map.networkContext.topologyHash })) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
        }
        const value = {
          ...base("TEMPORAL_EVENT", sourceId, result.status, result.subjectReferenceKey, [evidenceId], [...result.warnings, result.reasonCode], result.events.length),
          ...optionalReference("trajectoryReferenceProductId", result.source.trajectoryReferenceKey),
          ...projectEvents(result, eventId => id("event", { sourceId, eventId }), reference, evidenceId)
        };
        findings.push(accept(value, "temporal-event"));
      } else {
        const result = input.contracts.validateResult(source.operationId, envelope.output.value);
        assertScope(result.trajectoryReferenceKey, result.subjectReferenceKey);
        const intent = input.advanced!.intent.analysis;
        const concept = intent.kind === "METRIC_RANKING" ? input.catalog?.document.concepts.find(entry => entry.conceptId === intent.metricConceptId) : undefined;
        if (!concept) throw new ProjectionError("METRIC_UNSUPPORTED");
        if (concept.observedProperty !== result.metric.observedProperty || concept.measurementStage !== result.metric.measurementStage || concept.valueUnit !== result.metric.valueUnit) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
        if (intent.kind !== "METRIC_RANKING" || result.metric.observedProperty !== intent.metricSelector.observedProperty || result.metric.optimizationDirection !== intent.metricSelector.optimizationDirection || (intent.metricSelector.valueUnit && result.metric.valueUnit !== intent.metricSelector.valueUnit) || (intent.metricSelector.measurementStage && result.metric.measurementStage !== intent.metricSelector.measurementStage)) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
        if (intent.metricSeriesSelection.mode === "EXPLICIT_SERIES" && result.selectedMetricSeries) {
          for (const name of ["sourceKey", "datastreamKey", "measurementKey"] as const) if (intent.metricSeriesSelection[name] && intent.metricSeriesSelection[name] !== result.selectedMetricSeries[name]) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
        }
        const value = {
          ...base("METRIC_RANKING", sourceId, result.status, result.subjectReferenceKey, [evidenceId], [...result.warnings, result.reasonCode, "METRIC_TEMPORAL_COMPLETENESS_UNKNOWN"], result.candidates.length),
          ...optionalReference("trajectoryReferenceProductId", result.trajectoryReferenceKey),
          ...projectRanking(result, intent.metricConceptId, candidate => id("candidate", { sourceId, measurementId: candidate.representativeMeasurementId, rank: candidate.rank }))
        };
        const ranking = accept(value, "metric-ranking");
        findings.push(ranking);
        if (ranking.findingKind !== "METRIC_RANKING") throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
        if (result.reasonCode === "METRIC_SERIES_AMBIGUOUS") {
          choices.push({ choiceId: id("choice", { sourceId, kind: "series" }), choiceKind: "METRIC_SERIES_SELECTION", promptCode: "METRIC_SERIES_AMBIGUOUS", validUntil: context.validUntil, sourceFindingId: ranking.findingId,
            candidates: result.metricSeriesCandidates.map(candidate => ({ candidateId: id("series", { sourceId, identity: candidate.identity }), displayName: candidate.identity.datastreamKey, series: { ...candidate.identity } })) });
        } else if (ranking.candidates.length) {
          choices.push({ choiceId: id("choice", { sourceId, kind: "rank" }), choiceKind: "RANKED_LOCATION_SELECTION", promptCode: "RANKED_LOCATION_SELECTION", validUntil: context.validUntil, sourceFindingId: ranking.findingId,
            candidates: ranking.candidates.map(candidate => ({ candidateId: candidate.candidateId, displayName: `Rank ${candidate.rank}`, findingId: ranking.findingId, rank: candidate.rank })) });
          if (intent.actionTargetRequested && ["COMPLETED", "PARTIAL"].includes(result.status)) {
            const candidate = ranking.candidates.find(item => item.rank === (intent.selectedRank ?? 1));
            if (!candidate) gap("SELECTION_INVALID", "action-rank");
            else {
              findings.push(accept({ ...base("ACTION_TARGET_CANDIDATE", { sourceId, candidate: candidate.candidateId }, result.status === "COMPLETED" ? "COMPLETED" : "PARTIAL", result.subjectReferenceKey, [evidenceId], result.warnings, 1),
                actionKind: "MOVE_TO_LOCATION", sourceKind: "HISTORICAL_METRIC_CANDIDATE", target: candidate.representativeVisitedPosition, crs: "EPSG:4326", axisOrder: "LONGITUDE_LATITUDE", sourceFindingId: ranking.findingId, sourceCandidateId: candidate.candidateId, sourceRank: candidate.rank,
                representativeObservedAt: candidate.representativeObservedAt, representativeMeasurementId: candidate.representativeMeasurementId,
                requirements: { currentValidationRequired: true, routePlanningRequired: true, executionConfirmationRequired: true }, executionAuthorized: false }, "action-target-candidate"));
            }
          }
        }
      }
    } catch (error) {
      evidenceItems.splice(startEvidenceCount);
      findings.splice(startFindingCount);
      choices.splice(startChoiceCount);
      gaps.splice(startGapCount);
      gap(error instanceof ProjectionError ? error.gapKind : "UPSTREAM_CONTRACT_MISMATCH", source.operationId);
    }
  }
  if (input.advanced && !input.advanced.analysisEvidence.length) {
    const reason = input.advanced.reasonCode;
    const reasons: Record<string, GapKind> = {
      HISTORICAL_PROJECTION_PENDING: "HISTORICAL_PROJECTION_PENDING",
      HISTORICAL_TRAJECTORY_NO_DATA: "HISTORICAL_DATA_INCOMPLETE",
      HISTORICAL_TRAJECTORY_CONFLICTED: "HISTORICAL_DATA_INCOMPLETE",
      HISTORICAL_TRAJECTORY_REFERENCE_MISSING: "REFERENCE_MISSING",
      SUBJECT_CONTEXT_REQUIRED: "SUBJECT_CONTEXT_REQUIRED", SUBJECT_CONTEXT_AMBIGUOUS: "REFERENCE_AMBIGUOUS",
      TASK_CONTEXT_REQUIRED: "TASK_CONTEXT_REQUIRED", TASK_CONTEXT_AMBIGUOUS: "REFERENCE_AMBIGUOUS",
      TARGET_CONTEXT_REQUIRED: "TARGET_CONTEXT_REQUIRED", TARGET_CONTEXT_AMBIGUOUS: "REFERENCE_AMBIGUOUS",
      TARGET_REFERENCE_UNRESOLVED: "REFERENCE_MISSING", SUBJECT_TASK_MISMATCH: "REFERENCE_MISSING",
      METRIC_CONCEPT_UNSUPPORTED: "METRIC_UNSUPPORTED", METRIC_UNIT_CONFLICT: "METRIC_UNSUPPORTED",
      MULTI_EXECUTION_ADVANCED_ANALYSIS_NOT_SUPPORTED: "MULTI_EXECUTION_UNSUPPORTED",
      ADVANCED_HISTORY_DEADLINE_EXCEEDED: "UPSTREAM_TIMEOUT", ADVANCED_HISTORY_RESULT_INVALID: "UPSTREAM_CONTRACT_MISMATCH",
      ANALYSIS_PROVIDER_CONTRACT_INVALID: "UPSTREAM_CONTRACT_MISMATCH", ANALYSIS_PROVIDER_CONTRACT_DRIFT: "UPSTREAM_CONTRACT_MISMATCH"
    };
    gap(reasons[reason] ?? (input.advanced.status === "FAILED" ? "UPSTREAM_FAILURE" : "CAPABILITY_UNAVAILABLE"), reason);
  }
  return finish();

  function assertScope(key: HistoricalReferenceKey, subject: HistoricalReferenceKey | undefined): void {
    if (foundation && analysisHash(key) !== analysisHash(foundation.reference.referenceKey)) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
    if (foundation?.intent.subjectReferenceKey && subject && analysisHash(subject) !== analysisHash(foundation.intent.subjectReferenceKey)) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
  }
  function finish(): PublicWorldAnalysisProjection {
    const component: WorldAnalysisFindings = { profile: WORLD_ANALYSIS_RESULT_PROFILE, findings, choices, gaps, findingSetHash: "" };
    component.findingSetHash = worldAnalysisFindingSetHash(component);
    if (!validate("urn:wsgs:world-analysis:1.0:world-analysis-findings", component).valid) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
    // Rank/event menus are optional follow-up affordances, not unresolved inputs.
    const requiredChoices = choices.filter(choice => choice.choiceKind === "METRIC_SERIES_SELECTION" || choice.choiceKind === "TASK_SELECTION" || choice.choiceKind === "REFERENCE_SELECTION");
    return { component, evidenceItems, status: aggregateAnalysisStatus({ ...component, choices: requiredChoices }) };
  }
}

function boundPublicFinding(source: Json, selectedRank?: number): { value: Json; truncated: boolean; proofRetained: boolean } {
  const value = structuredClone(source);
  const changedPaths: string[] = [];
  const selectedEventId = value["selection"] && object(value["selection"])["selectedEventId"];
  const lastVisitId = value["lastConfirmedRoad"] && object(value["lastConfirmedRoad"])["visitId"];
  function bound(item: unknown, path: string, key: string): unknown {
    if (Array.isArray(item)) {
      // Source tuples are already validated; never truncate a coordinate tuple.
      if (key === "coordinates") return item;
      const maximum = key === "pathPreview" ? 256 : ["evidenceIds", "subjectReferenceProductIds", "candidateFeatureIds", "relatedFeatureIds"].includes(key) ? 32 : key === "tieBreakers" ? 16 : 100;
      let retained = item;
      if (item.length > maximum) {
        const pinned = item.findIndex(entry => entry && typeof entry === "object" && (key === "events" && entry.eventId === selectedEventId || key === "roadVisits" && entry.visitId === lastVisitId || key === "candidates" && entry.rank === selectedRank));
        const indices = new Set(Array.from({ length: maximum }, (_, index) => index));
        if (pinned >= maximum) { indices.delete(maximum - 1); indices.add(pinned); }
        retained = item.filter((_, index) => indices.has(index));
        changedPaths.push(path);
      }
      return retained.map((entry, index) => bound(entry, `${path}/${index}`, key));
    }
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([name, child]) => [name, bound(child, `${path}/${name}`, name)]));
    return item;
  }
  const bounded = object(bound(value, "", ""));
  const proofRetained = value["findingKind"] === "TEMPORAL_EVENT" && object(value["selection"] ?? {})["confirmed"] === true && changedPaths.every(path => path === "/events");
  if (changedPaths.length) {
    const primary = value["findingKind"] === "ROAD_ASSOCIATION" ? "roadVisits" : value["findingKind"] === "TEMPORAL_EVENT" ? "events" : value["findingKind"] === "METRIC_RANKING" ? "candidates" : "definedPeriods";
    const display = object(value["display"]);
    bounded["display"] = { ...display, returnedCount: Array.isArray(bounded[primary]) ? (bounded[primary] as unknown[]).length : display["returnedCount"], sourceCount: display["sourceCount"] ?? display["returnedCount"], truncated: true };
    if (!proofRetained && bounded["status"] === "COMPLETED") bounded["status"] = "PARTIAL";
  }
  return { value: bounded, truncated: changedPaths.length > 0, proofRetained };
}

function projectEvidence(envelope: ValidatedAnalysisEnvelope<unknown>, operation: AnalysisOperationId, evidenceProductId: string): Evidence {
  return { evidenceProductId, productKind: "CAPABILITY_RESULT", authority: "GOWM", sourceOperation: operation, sourceProvider: envelope.execution.providerId,
    upstreamStatus: envelope.status as Evidence["upstreamStatus"], payloadSchemaUri: envelope.output.schemaUri, payloadSchemaHash: envelope.output.schemaHash,
    receiptIds: envelope.receipts.map(receipt => receipt.receiptId), evidenceIds: envelope.evidenceReferences.map(item => item.evidenceId), unknowns: [], warnings: codes(envelope.warnings),
    dataSnapshot: { snapshotHash: hash(envelope.dataSnapshot), ...(typeof envelope.dataSnapshot["capturedAt"] === "string" ? { capturedAt: envelope.dataSnapshot["capturedAt"] } : {}) },
    computeSnapshot: { snapshotHash: hash(envelope.computeSnapshot), ...(typeof envelope.computeSnapshot["capturedAt"] === "string" ? { capturedAt: envelope.computeSnapshot["capturedAt"] } : {}) } };
}
function projectRoad(result: MapMatchProviderResultV01, visitId: (visit: MapMatchProviderResultV01["roadVisits"][number]) => string): Json {
  const complete = result.associationCompleteness;
  const last = result.roadVisits.at(-1);
  return { networkRole: "REFERENCE_MODEL_NOT_PHYSICAL_TRUTH",
    ...(result.networkContext ? { network: { graphVersionId: result.networkContext.graphVersionId, graphVersion: result.networkContext.graphVersion, topologyHash: result.networkContext.topologyHash, timeBasis: result.networkContext.timeBasis } } : {}),
    roadVisits: result.roadVisits.map(visit => ({ visitId: visitId(visit), sourceFeatureId: visit.sourceFeatureReferenceId, ...(visit.roadDisplayName ? { displayName: visit.roadDisplayName } : {}), period: range({ start: visit.startTime, end: visit.endTime }), entryPosition: visit.entryPosition, exitPosition: visit.exitPosition, sampleCount: visit.matchedSampleCount, confidence: visit.confidence })),
    offNetworkSegments: result.offNetworkSegments.map(segment => ({ segmentId: stableId("off-network", { analysis: result.analysisId, sequence: segment.sequenceNo, segment: segment.segmentNo }), period: range({ start: segment.startTime, end: segment.endTime }), sampleCount: segment.sampleCount, entryPosition: segment.entryPosition, exitPosition: segment.exitPosition, pathPreview: segment.pathPreview.coordinates.map(coordinates => ({ type: "Point", coordinates })), interpretationHint: segment.interpretationHint, confidence: segment.confidence, reasonCodes: codes(segment.reasonCodes) })),
    ambiguousSegments: result.ambiguousSegments.map(segment => ({ segmentId: stableId("ambiguous", { analysis: result.analysisId, sequence: segment.sequenceNo, segment: segment.segmentNo }), period: range(segment), candidateFeatureIds: segment.candidateRoadFeatureReferenceIds, confidence: segment.confidence })),
    networkDataIssues: result.networkDataIssueCandidates.map(issue => ({ issueKind: issue.issueType, period: range(issue.observedPeriod), relatedFeatureIds: issue.relatedRoadFeatureReferenceIds, observationCount: issue.observationCount, confidence: issue.confidence, reasonCodes: codes(issue.reasonCodes) })),
    associationPrefixComplete: complete.associationPrefixComplete, associationSuffixComplete: complete.associationSuffixComplete,
    blockingPeriods: [...complete.upstreamGapPeriods.map(period => periodIssue(period, "UPSTREAM_GAP")), ...complete.qualityBreakPeriods.map(period => periodIssue(period, "QUALITY_BREAK")), ...complete.offNetworkPeriods.map(period => periodIssue(period, "OFF_NETWORK_PERIOD")), ...complete.ambiguousPeriods.map(period => periodIssue(period, "AMBIGUOUS_ASSOCIATION_PERIOD"))],
    ...(last && ["COMPLETED", "PARTIAL"].includes(result.status) ? { lastConfirmedRoad: { visitId: visitId(last), confirmationScope: "CONFIRMED_IN_AVAILABLE_DATA", absoluteFinalRoadClaimed: false } } : {}) };
}
function projectEvents(result: TemporalSpatialEventResultV01, eventId: (sourceId: string) => string, reference: (key: HistoricalReferenceKey | undefined) => string | undefined, evidenceId: string): Json {
  const sourceIds = new Set(result.events.map(event => event.eventId));
  if (sourceIds.size !== result.events.length || result.selectionResult?.selectedEventId && !sourceIds.has(result.selectionResult.selectedEventId)) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
  return { eventTypes: result.requestedEventTypes,
    events: result.events.map(event => {
      const extent = event.temporalExtent;
      const target = event.target;
      return { eventId: eventId(event.eventId), eventType: event.eventType,
        extent: extent.kind === "INSTANT" ? { kind: "INSTANT", timeWindow: range(extent.eventTimeWindow), ...(extent.eventTimeEstimate ? { estimatedAt: extent.eventTimeEstimate } : {}) } : { kind: "INTERVAL", period: range({ start: extent.startTime, end: extent.endTime }), durationSeconds: extent.durationSeconds, ...(extent.startTimeWindow ? { startTimeWindow: range(extent.startTimeWindow) } : {}), ...(extent.endTimeWindow ? { endTimeWindow: range(extent.endTimeWindow) } : {}) },
        ...(event.position ? { position: event.position } : {}),
        ...(target ? { target: target.kind === "NETWORK_JUNCTION" ? { kind: "NETWORK_JUNCTION", graphVersionId: target.junction.graphVersionId, graphVersion: target.junction.graphVersion, nodeId: target.junction.viaNodeKey, position: target.junction.position, incomingFeatureId: target.junction.incomingRoad.sourceFeatureReferenceId, outgoingFeatureId: target.junction.outgoingRoad.sourceFeatureReferenceId } : { kind: "SPATIAL_TARGET", sourceTargetId: target.targetId, targetType: target.targetType, ...(target.displayName ? { displayName: target.displayName } : {}), ...(target.referenceKey ? { referenceProductId: reference(target.referenceKey) } : {}) } } : {}),
        certainty: event.certainty, confidence: event.confidence, reasonCodes: codes(event.reasonCodes), evidenceIds: [evidenceId] };
    }), sourcePrefixComplete: result.completeness.sourcePrefixComplete, sourceSuffixComplete: result.completeness.sourceSuffixComplete, completeForAllEvents: result.completeness.completeForAllEvents,
    blockingPeriods: result.completeness.blockingPeriods.map(period => periodIssue(period, period.kind)),
    display: { returnedCount: result.events.length, ...(result.summary.truncated ? { sourceCount: result.summary.detectedEventCount } : {}), truncated: result.summary.truncated },
    ...(result.selectionResult ? { selection: { kind: result.selectionResult.kind, ...(result.selectionResult.selectedEventId ? { selectedEventId: eventId(result.selectionResult.selectedEventId) } : {}), confirmed: result.selectionResult.confirmed, confirmationScope: result.selectionResult.confirmed ? "REQUESTED_SCOPE_PROVEN" : "NOT_CONFIRMED", reasonCode: result.selectionResult.reasonCode, blockingPeriods: result.selectionResult.blockingPeriods.map(period => periodIssue(period, period.kind)) } } : {}) };
}
function projectRanking(result: MetricLocationRankingResultV01, conceptId: string, candidateId: (candidate: MetricLocationRankingResultV01["candidates"][number]) => string): Json {
  let previous: MetricLocationRankingResultV01["candidates"][number] | undefined;
  for (const candidate of result.candidates) {
    const stats = candidate.statistics;
    if (stats.minimum > stats.maximum || [stats.mean, stats.median, candidate.representativeValue].some(value => value < stats.minimum || value > stats.maximum) || candidate.rankingBasis.optimizationDirection !== result.metric.optimizationDirection || (previous && (candidate.rank <= previous.rank || (result.metric.optimizationDirection === "MAXIMIZE" ? stats.median > previous.statistics.median : stats.median < previous.statistics.median)))) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
    previous = candidate;
  }
  const complete = result.completeness;
  return { candidateDomain: "PAST_OBSERVED_LOCATIONS", metric: { conceptId, observedProperty: result.metric.observedProperty, measurementStage: result.metric.measurementStage, ...(result.metric.valueUnit ? { unit: result.metric.valueUnit } : {}), optimizationDirection: result.metric.optimizationDirection },
    ...(result.selectedMetricSeries ? { selectedSeries: { ...result.selectedMetricSeries } } : {}),
    candidates: result.candidates.map(candidate => ({ candidateId: candidateId(candidate), rank: candidate.rank, representativeVisitedPosition: candidate.representativeVisitedPosition, representativeObservedAt: candidate.representativeObservedAt, representativeMeasurementId: candidate.representativeMeasurementId, representativeValue: candidate.representativeValue, sampleCount: candidate.statistics.sampleCount, h3Index: candidate.spatialUnit.h3Index,
      statistics: { sampleCount: candidate.statistics.sampleCount, minimum: candidate.statistics.minimum, maximum: candidate.statistics.maximum, mean: candidate.statistics.mean, median: candidate.statistics.median, p25: candidate.statistics.p25, p75: candidate.statistics.p75, medianAbsoluteDeviation: candidate.statistics.medianAbsoluteDeviation, firstObservedAt: candidate.statistics.firstObservedAt, lastObservedAt: candidate.statistics.lastObservedAt },
      rankingBasis: { primaryStatistic: candidate.rankingBasis.primaryStatistic, optimizationDirection: candidate.rankingBasis.optimizationDirection, rankingValue: candidate.statistics.median, tieBreakers: candidate.rankingBasis.tieBreakers }, reasonCodes: codes(candidate.reasonCodes) })),
    coverage: { metricTemporalCompletenessKnown: false, trajectory: { temporalCoverageRatio: complete.trajectoryTemporalCoverageRatio, prefixComplete: complete.trajectoryPrefixComplete, suffixComplete: complete.trajectorySuffixComplete },
      trajectoryGaps: [...complete.trajectoryGapPeriods.map(period => periodIssue(period, "UPSTREAM_GAP")), ...complete.trajectoryQualityBreakPeriods.map(period => periodIssue(period, "QUALITY_BREAK"))], excludedPeriods: complete.excludedPeriods.map(period => periodIssue(period, period.exclusionKind)),
      sourceMetricSampleCount: complete.sourceMetricSampleCount, acceptedMetricSampleCount: complete.acceptedMetricSampleCount, rejectedMetricSampleCount: complete.rejectedMetricSampleCount, alignedMetricSampleCount: complete.alignedMetricSampleCount, unalignedMetricSampleCount: complete.unalignedMetricSampleCount, alignmentRatio: complete.alignmentRatio },
    display: { returnedCount: result.candidates.length, ...(result.summary.truncated ? { sourceCount: result.summary.qualifiedLocationCount } : {}), truncated: result.summary.truncated } };
}

export function assemblePublicWorldAnalysisResult(base: GroundingResult12, projection: PublicWorldAnalysisProjection, options: { maxResultBytes?: number; selectedCandidateIds?: readonly string[] } = {}): GroundingResult12 {
  const result: GroundingResult12 = { ...base, status: projection.status, evidenceItems: projection.evidenceItems, worldAnalysisFindings: projection.component };
  result.resultHash = worldAnalysisResultHash(result);
  const checked = validate("result", result);
  if (checked.errors.some(issue => issue.code !== "RESULT_TOO_LARGE")) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
  return boundPublicWorldAnalysisResult(result, options);
}

export class WorldAnalysisResultTooLargeError extends Error {
  readonly code = "RESULT_TOO_LARGE";
  constructor() { super("World analysis result does not fit the output budget"); }
}

/** Trim display entries, never source coordinates or retained action dependencies. */
export function boundPublicWorldAnalysisResult(source: GroundingResult12, options: { maxResultBytes?: number; selectedCandidateIds?: readonly string[] } = {}): GroundingResult12 {
  const maximum = Math.min(options.maxResultBytes ?? 1048576, 1048576);
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new WorldAnalysisResultTooLargeError();
  const before = validate("result", source);
  if (before.errors.some(issue => issue.code !== "RESULT_TOO_LARGE")) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
  const result = structuredClone(source);
  const component = result.worldAnalysisFindings;
  const pinned = new Set(options.selectedCandidateIds ?? []);
  for (const finding of component.findings) if (finding.findingKind === "ACTION_TARGET_CANDIDATE") pinned.add(finding.sourceCandidateId);
  const size = () => Buffer.byteLength(JSON.stringify(result));
  const seal = () => { component.findingSetHash = worldAnalysisFindingSetHash(component); result.resultHash = worldAnalysisResultHash(result); };
  const truncatedGapId = stableId("gap", { groundingId: result.groundingId, reason: "RESULT_TRUNCATED" });
  function markTruncated(finding: Finding): void {
    const proof = finding.findingKind === "TEMPORAL_EVENT" && finding.selection?.confirmed;
    if (!proof && finding.status === "COMPLETED") Object.assign(finding, { status: "PARTIAL" as const });
    if (!proof && result.status === "COMPLETED") result.status = "PARTIAL";
    if (!component.gaps.some(gap => gap.gapId === truncatedGapId)) component.gaps.push({ gapId: truncatedGapId, gapKind: "RESULT_TRUNCATED", severity: proof ? "INFO" : "WARNING", messageCode: "RESULT_TRUNCATED", findingIds: [], evidenceIds: [], detail: {} });
    else if (!proof) component.gaps.find(gap => gap.gapId === truncatedGapId)!.severity = "WARNING";
    finding.display.sourceCount ??= finding.display.returnedCount;
    finding.display.truncated = true;
  }
  while (size() > maximum) {
    let removed = false;
    for (const finding of component.findings) {
      if (finding.findingKind === "METRIC_RANKING") {
        const index = finding.candidates.findLastIndex(candidate => !pinned.has(candidate.candidateId));
        if (index < 0) continue;
        const candidate = finding.candidates[index]!;
        markTruncated(finding);
        finding.candidates.splice(index, 1);
        finding.display.returnedCount = finding.candidates.length;
        for (const choice of component.choices) if (choice.choiceKind === "RANKED_LOCATION_SELECTION") choice.candidates = choice.candidates.filter(item => item.findingId !== finding.findingId || item.candidateId !== candidate.candidateId);
        removed = true;
      } else if (finding.findingKind === "TEMPORAL_EVENT") {
        const index = finding.events.findLastIndex(event => event.eventId !== finding.selection?.selectedEventId);
        if (index < 0) continue;
        const event = finding.events[index]!;
        markTruncated(finding);
        finding.events.splice(index, 1);
        finding.display.returnedCount = finding.events.length;
        for (const choice of component.choices) if (choice.choiceKind === "EVENT_SELECTION") choice.candidates = choice.candidates.filter(item => item.findingId !== finding.findingId || item.eventId !== event.eventId);
        removed = true;
      } else if (finding.findingKind === "ROAD_ASSOCIATION") {
        const index = finding.roadVisits.findLastIndex(visit => visit.visitId !== finding.lastConfirmedRoad?.visitId);
        if (index < 0) continue;
        markTruncated(finding);
        finding.roadVisits.splice(index, 1);
        finding.display.returnedCount = finding.roadVisits.length;
        removed = true;
      }
      if (removed) break;
    }
    component.choices = component.choices.filter(choice => choice.candidates.length);
    seal();
    if (!removed) break;
  }
  if (size() > maximum || component.gaps.length > 64) {
    // No dependency-complete preview fits. Replace the lost semantic material
    // with an explicit bounded gap rather than returning a dangling target.
    component.findings = [];
    component.choices = [];
    component.gaps = [{ gapId: truncatedGapId, gapKind: "RESULT_TRUNCATED", severity: "WARNING", messageCode: "RESULT_TRUNCATED", findingIds: [], evidenceIds: [], detail: {} }];
    result.referenceProducts = [];
    result.evidenceItems = [];
    result.mentions = [];
    result.ambiguities = [];
    result.unresolvedMentions = [];
    result.capabilityGaps = [];
    result.warnings = [];
    delete result.geospatialFindings;
    delete result.groundingGraph;
    delete result.semanticFrame;
    delete result.gowmQueries;
    if (result.status === "COMPLETED") result.status = "PARTIAL";
    seal();
  }
  if (size() > maximum) throw new WorldAnalysisResultTooLargeError();
  if (!validate("result", result, { maxResultBytes: maximum }).valid) throw new ProjectionError("UPSTREAM_CONTRACT_MISMATCH");
  return result;
}
