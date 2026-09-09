import { historicalQueryFixture } from "./query-test-support.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { AnalysisProviderContracts, analysisHash, type AnalysisOperationId, type SpatialEventTarget } from "@wsgs/gowm-contract-intake";
import { advancedCompileFixture } from "../../query-compiler/src/advanced-test-fixtures.js";
import { historicalTraceConfigurationFromEnvironment } from "./config.js";
import { advancedHistoryConfigurationFromEnvironment } from "./advanced-config.js";
import { parseAdvancedHistoricalIntent } from "./advanced-intent.js";
import { MetricSemanticCatalog } from "./metric-semantic-catalog.js";
import { executeAdvancedHistoricalAnalysis, canReuseAdvancedFoundation, type AdvancedExecutionInput } from "./advanced-executor.js";
import { boundAdvancedSafePayload, normalizeMetricRanking, normalizeRoadAssociation, normalizeTemporalEvent } from "./advanced-normalizer.js";
import { decodeStoredAdvancedHistory, resolveAdvancedFollowup } from "./advanced-followup.js";
import type { AdvancedHistoricalFoundation, AdvancedHistoricalIntent, AdvancedHistoryConfiguration } from "./advanced-types.js";
import { createHash } from "node:crypto";

const config = advancedHistoryConfigurationFromEnvironment({ WSGS_ADVANCED_HISTORY_ENABLED: "YES" });
const history = historicalTraceConfigurationFromEnvironment({ WSGS_HISTORY_TRACE_ENABLED: "YES" });
const catalog = new MetricSemanticCatalog();
const contracts = new AnalysisProviderContracts(new URL("../../../contracts/upstream/gowm-analysis-providers-current", import.meta.url).pathname);
const fixture = (name: string): Record<string, unknown> => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../validation/fixtures/advanced-history/${name}.json`, import.meta.url)), "utf8")) as Record<string, unknown>;
const parse = (text: string, prior?: AdvancedHistoricalIntent) => {
  const parsed = parseAdvancedHistoricalIntent(text, catalog, config, prior);
  if (parsed.status !== "PARSED") throw new Error(JSON.stringify(parsed));
  return parsed.intent;
};
function foundation(name: string, intent: AdvancedHistoricalIntent): AdvancedHistoricalFoundation {
  const envelope = fixture(name);
  const payload = (envelope["output"] as { value: Record<string, unknown> }).value;
  const source = payload["source"] as Record<string, unknown> | undefined;
  const reference = (source?.["trajectoryReferenceKey"] ?? payload["trajectoryReferenceKey"]) as AdvancedHistoricalFoundation["reference"]["referenceKey"];
  return { intent: { ...intent.historicalScope, taskReferenceKey: { namespace: "gowm", kind: "OPERATIONAL_TASK", id: "wrf_task", version: "1" },
    subjectReferenceKey: { namespace: "gowm", kind: "WORLD_OBJECT", id: "wrf_vehicle", version: "1" } },
    reference: { referenceKey: reference, referenceType: "HISTORICAL_TRAJECTORY", revalidationRequired: false },
    finding: { findingKind: "HISTORICAL_TRAJECTORY", status: "COMPLETED", reasonCode: "TRAJECTORY_AVAILABLE", warnings: [],
      trajectory: { trajectoryReferenceKey: reference, requestedPeriods: [], definedPeriods: [], excludedPeriods: [], gaps: [], inputTrackletVersions: [],
        completeness: { temporalCoverageRatio: 1, sampleCount: 10, sequenceCount: 1, gapCount: 0, prefixComplete: true, suffixComplete: true },
        finalization: { state: "SEALED" }, inlineSamples: { mode: "BOUNDED_PREVIEW", points: [], truncated: true } } } };
}
function executionInput(text: string, name: string): AdvancedExecutionInput {
  const intent = parse(text);
  return { intent, configuration: config, history, contracts, catalog,
    compileContext: advancedCompileFixture(), deadlineAt: new Date(Date.now() + 30000), reusableFoundation: foundation(name, intent),
    foundationGateway: { executeQuery(request) { return historicalQueryFixture(this, request); }, execute: vi.fn(async () => { throw new Error("unexpected foundation query"); }) },
    gateway: { execute: vi.fn(async (id: AnalysisOperationId, request) => {
      const envelope = fixture(id === "trajectory.map-match" ? "map-match" : name);
      for (const receipt of envelope["receipts"] as Array<Record<string, unknown>>) receipt["inputHash"] = analysisHash(request);
      return envelope;
    }) },
    resolveTarget: vi.fn(async () => contracts.validateTarget(fixture("target"))) };
}

describe("advanced deterministic historical intent", () => {
  it.each([
    ["2号车本次任务经过了哪些道路？", "ROAD_ASSOCIATION"], ["2号车最后确认在哪条道路上？", "ROAD_ASSOCIATION"],
    ["2号车是否驶离已有路网？", "ROAD_ASSOCIATION"], ["哪些轨迹片段无法关联到道路？", "ROAD_ASSOCIATION"],
    ["是否存在疑似路网数据问题？", "ROAD_ASSOCIATION"], ["2号车什么时候进入A区？", "TEMPORAL_EVENT"],
    ["2号车什么时候离开A区？", "TEMPORAL_EVENT"], ["2号车在A区停留了多久？", "TEMPORAL_EVENT"],
    ["2号车任务期间在哪里停车？", "TEMPORAL_EVENT"], ["2号车是否经过门岗附近？", "TEMPORAL_EVENT"],
    ["2号车最后一次经过哪个路口？", "TEMPORAL_EVENT"], ["通信最好的三个位置在哪里？", "METRIC_RANKING"],
    ["任务期间哪些位置时延最低？", "METRIC_RANKING"], ["哪些经过位置的丢包率最低？", "METRIC_RANKING"]
  ])("parses %s", (text, kind) => { expect(parse(text).analysis.kind).toBe(kind); });
  it.each(["当前信号最好在哪里", "规划去信号好的地方", "2号车现在在哪条路"])("leaves current request out: %s", text => {
    expect(parseAdvancedHistoricalIntent(text, catalog, config).status).toBe("NOT_ADVANCED");
  });
  it.each(["历次任务中信号最好的位置", "所有执行记录经过的道路"])("rejects multiple executions: %s", text => {
    expect(parseAdvancedHistoricalIntent(text, catalog, config)).toMatchObject({ reasonCode: "MULTI_EXECUTION_ADVANCED_ANALYSIS_NOT_SUPPORTED" });
  });
  it("separates event FIRST from execution batch and preserves phase and mentions", () => {
    expect(parse("2号车第一次进入A区是什么时候？")).toMatchObject({ historicalScope: { executionSelection: { kind: "LATEST" }, subjectMention: "2号车" }, analysis: { eventType: "ENTER", selection: { kind: "FIRST" }, targetMention: "A区" } });
    expect(parse("任务T1第十次任务2号车经过哪些道路，排除暂停阶段").historicalScope).toMatchObject({ taskMention: "任务T1", executionSelection: { kind: "EXECUTION_NO", executionNo: 10 }, phaseScope: "ACTIVE_PHASES_ONLY" });
  });
  it("bounds top K and resolves Arabic/Chinese ranks", () => {
    expect(parse("通信最好的三个位置在哪里？").analysis).toMatchObject({ topK: 3 });
    expect(parse("返回刚才第二个信号较好的位置").analysis).toMatchObject({ selectedRank: 2, actionTargetRequested: true });
    expect(parseAdvancedHistoricalIntent("信号最好的1000个位置", catalog, config)).toMatchObject({ reasonCode: "METRIC_RANK_OUT_OF_RANGE" });
  });
});
describe("metric catalog", () => {
  it("uses collected native units without conversion; stable canonical hash", () => {
    expect(catalog.resolve("丢包率最好")).toMatchObject({ selector: { observedProperty: "PACKET_LOSS_RATE", measurementStage: "PARSED_NATIVE", valueUnit: "percent", optimizationDirection: "MINIMIZE" } });
    expect(catalog.resolve("RSSI最高")).toMatchObject({ selector: { optimizationDirection: "MAXIMIZE" } });
    expect(catalog.resolve("RSSI最低")).toMatchObject({ selector: { optimizationDirection: "MINIMIZE" } });
    expect(new MetricSemanticCatalog(structuredClone(catalog.document)).hash).toBe(catalog.hash);
  });
  it("returns ambiguity rather than combined scores", () => { expect(catalog.resolve("信号和丢包率最好")).toEqual({ reasonCode: "METRIC_CONCEPT_AMBIGUOUS" }); });
  it("does not invent missing vibration or GNSS metric identifiers", () => {
    expect(catalog.resolve("定位质量最好")).toEqual({ reasonCode: "METRIC_CONCEPT_UNSUPPORTED" });
    expect(catalog.resolve("震动最小")).toEqual({ reasonCode: "METRIC_CONCEPT_UNSUPPORTED" });
  });
  it.each(["schema", "duplicate", "alias", "range"])("rejects invalid %s", kind => {
    const document = structuredClone(catalog.document);
    if (kind === "schema") (document as unknown as Record<string, unknown>)["unexpected"] = true;
    if (kind === "duplicate") document.concepts.push(structuredClone(document.concepts[0]!));
    if (kind === "alias") document.concepts[1]!.aliases.push("RSSI");
    if (kind === "range") document.concepts[0]!.validValueRange = { minimum: 1, maximum: 0 };
    expect(() => new MetricSemanticCatalog(document)).toThrow();
  });
});
describe("real provider fixture envelopes, offline", () => {
  it.each(["COMPLETED", "PARTIAL", "NO_DATA", "INDETERMINATE"] as const)("retains T2 status %s without interpreting off-network as invalid", status => {
    const original = contracts.validateEnvelope("trajectory.map-match", fixture("map-match")).output.value;
    const finding = normalizeRoadAssociation({ ...original, status } as typeof original);
    expect(finding).toMatchObject({ status, offNetworkSegments: original.offNetworkSegments,
      ambiguousSegments: original.ambiguousSegments, networkDataIssueCandidates: original.networkDataIssueCandidates,
      associationCompleteness: original.associationCompleteness, upstreamGaps: original.upstreamGaps });
    if (["NO_DATA", "INDETERMINATE"].includes(status)) expect(finding).not.toHaveProperty("lastConfirmedRoad");
  });
  it.each(["enter", "exit", "dwell", "stop", "pass_near", "cross-last"])("normalizes T3 %s losslessly", name => {
    const original = contracts.validateEnvelope("temporal-spatial.find-events", fixture(name)).output.value;
    expect(normalizeTemporalEvent(original)).toMatchObject({ status: original.status, events: original.events,
      completeness: original.completeness, summary: original.summary, reasonCode: original.reasonCode });
  });
  it.each([ ["FIRST", true], ["FIRST", false], ["LAST", true], ["LAST", false] ] as const)("preserves %s confirmed=%s", (kind, confirmed) => {
    const original = contracts.validateEnvelope("temporal-spatial.find-events", fixture("cross-last")).output.value;
    const selection = { ...original.selectionResult!, kind, confirmed };
    const finding = normalizeTemporalEvent({ ...original, selectionResult: selection });
    expect(finding["selection"]).toEqual(selection);
    expect(finding["blockingPeriods"]).toEqual(original.completeness.blockingPeriods);
  });
  it("retains NO_EVENT_FOUND and source incompleteness without inferring absence", () => {
    const original = contracts.validateEnvelope("temporal-spatial.find-events", fixture("cross-last")).output.value;
    const finding = normalizeTemporalEvent({ ...original, events: [], reasonCode: "NO_EVENT_FOUND",
      summary: { ...original.summary, truncated: true }, completeness: { ...original.completeness, sourcePrefixComplete: false, sourceSuffixComplete: false } });
    expect(finding).toMatchObject({ reasonCode: "NO_EVENT_FOUND", truncated: true,
      completeness: { sourcePrefixComplete: false, sourceSuffixComplete: false } });
  });
  it.each([
    ["COMPLETED", "RANKING_AVAILABLE"], ["PARTIAL", "RANKING_AVAILABLE_WITH_INCOMPLETE_COVERAGE"],
    ["NO_DATA", "TRAJECTORY_NOT_FOUND"], ["NO_DATA", "TRAJECTORY_EMPTY"], ["NO_DATA", "NO_METRIC_SAMPLES"],
    ["NO_DATA", "NO_ALIGNED_METRIC_SAMPLES"], ["NO_DATA", "NO_QUALIFIED_LOCATIONS"],
    ["INDETERMINATE", "TRAJECTORY_CONFLICTED"], ["INDETERMINATE", "METRIC_SERIES_AMBIGUOUS"], ["INDETERMINATE", "METRIC_UNIT_CONFLICT"]
  ] as const)("retains T4 %s/%s", (status, reasonCode) => {
    const intent = parse("让2号车回到通信信号最好的位置").analysis;
    if (intent.kind !== "METRIC_RANKING") throw new Error("expected metric");
    const original = contracts.validateEnvelope("spatiotemporal-metric.rank-locations", fixture("metric-shared-campus")).output.value;
    // Normalizer-only mutation: transport and schema validation are covered by
    // the untouched real-provider envelope cases below.
    const result = { ...original, status, reasonCode } as typeof original;
    const normalized = normalizeMetricRanking(result, intent);
    expect(normalized[0]).toMatchObject({ upstreamReasonCode: reasonCode, metricTemporalCompletenessKnown: false,
      status: reasonCode === "METRIC_SERIES_AMBIGUOUS" ? "AMBIGUOUS" : status });
    if (["NO_DATA", "INDETERMINATE"].includes(status)) expect(normalized).toHaveLength(1);
  });
  it.each([
    ["map-match", "trajectory.map-match"], ["map-no-data", "trajectory.map-match"], ["cross-last", "temporal-spatial.find-events"],
    ["enter", "temporal-spatial.find-events"], ["exit", "temporal-spatial.find-events"], ["dwell", "temporal-spatial.find-events"],
    ["stop", "temporal-spatial.find-events"], ["pass_near", "temporal-spatial.find-events"], ["metric-shared-campus", "spatiotemporal-metric.rank-locations"],
    ["metric-ambiguous-series", "spatiotemporal-metric.rank-locations"], ["metric-minimize-metric", "spatiotemporal-metric.rank-locations"]
  ])("verifies schema, envelope and receipts for %s", (name, id) => {
    expect(() => contracts.validateEnvelope(id as AnalysisOperationId, fixture(name))).not.toThrow();
  });
  it("preserves off-network as valid motion and last road uncertainty", () => {
    const result = contracts.validateEnvelope("trajectory.map-match", fixture("map-match")).output.value;
    const finding = normalizeRoadAssociation(result);
    expect(finding["offNetworkSegments"]).toEqual(result.offNetworkSegments);
    expect(finding["lastConfirmedRoad"]).toMatchObject({ absoluteFinalRoadClaimed: false });
  });
  it("preserves unconfirmed LAST and blocking periods", () => {
    const result = contracts.validateEnvelope("temporal-spatial.find-events", fixture("cross-last")).output.value;
    expect(normalizeTemporalEvent(result)).toMatchObject({ selection: { confirmed: false }, blockingPeriods: result.completeness.blockingPeriods });
  });
  it("uses observed position for action target, never H3 center", () => {
    const intent = parse("让2号车回到通信信号最好的位置").analysis;
    if (intent.kind !== "METRIC_RANKING") throw new Error("metric expected");
    const result = contracts.validateEnvelope("spatiotemporal-metric.rank-locations", fixture("metric-shared-campus")).output.value;
    const normalized = normalizeMetricRanking(result, intent);
    expect(normalized[0]).toMatchObject({ candidateDomain: "PAST_OBSERVED_LOCATIONS", metricTemporalCompletenessKnown: false });
    expect(normalized[1]).toMatchObject({ position: result.candidates[0]!.representativeVisitedPosition, currentValidationRequired: true, routePlanningRequired: true, executionAuthorized: false });
    expect(normalized[1]!["position"]).not.toEqual(result.candidates[0]!.spatialUnit.cellCenter);
  });
  it("caps collections and payload bytes with explicit truncation", () => {
    const small = { ...config, maximumEvents: 2, maximumSafePayloadBytes: 2048 };
    expect(boundAdvancedSafePayload({ findingKind: "HISTORICAL_TEMPORAL_EVENT", events: Array(50).fill({ eventId: "event" }), warnings: [] }, small)).toMatchObject({ truncated: true, events: [{ eventId: "event" }, { eventId: "event" }] });
    const bounded = boundAdvancedSafePayload({ findingKind: "HISTORICAL_TEMPORAL_EVENT", events: Array(100).fill({ body: "x".repeat(10000) }) }, small);
    expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(2048);
    expect(bounded).toMatchObject({ truncated: true });
  });
});
describe("advanced execution through a mock Gateway", () => {
  it("keeps an incomplete final road partial", async () => {
    const input = executionInput("2号车最后确认在哪条道路上", "map-match");
    expect(await executeAdvancedHistoricalAnalysis(input)).toMatchObject({ status: "PARTIAL", reasonCode: "ASSOCIATION_SUFFIX_INCOMPLETE" });
  });
  it("rejects a returned metric series outside explicit selection", async () => {
    const input = executionInput("2号车通信信号最好的位置", "metric-shared-campus");
    if (input.intent.analysis.kind !== "METRIC_RANKING") throw new Error("expected metric");
    input.intent.analysis.metricSeriesSelection = { mode: "EXPLICIT_SERIES", sourceKey: "different-source" };
    expect(await executeAdvancedHistoricalAnalysis(input)).toMatchObject({ status: "FAILED", reasonCode: "ADVANCED_HISTORY_RESULT_INVALID" });
  });
  it("preserves Gateway deadline and cancellation semantics", async () => {
    const input = executionInput("2号车经过哪些道路", "map-match");
    input.gateway.execute = vi.fn(async () => { throw Object.assign(new Error("transport deadline"), { code: "DEADLINE_EXCEEDED" }); });
    expect(await executeAdvancedHistoricalAnalysis(input)).toMatchObject({ status: "PARTIAL", reasonCode: "ADVANCED_HISTORY_DEADLINE_EXCEEDED" });
    input.gateway.execute = vi.fn(async () => { throw Object.assign(new Error("cancelled"), { code: "ABORTED" }); });
    await expect(executeAdvancedHistoricalAnalysis(input)).rejects.toMatchObject({ code: "ABORTED" });
  });
  it.each(["TRANSPORT_FAILURE", "GATEWAY_CIRCUIT_OPEN", "HTTP_503", "HTTP_502_PROVIDER_DOWN", "HTTP_403_FORBIDDEN"])("classifies %s separately from contract mismatch", async code => {
    const input = executionInput("2号车经过哪些道路", "map-match");
    input.gateway.execute = vi.fn(async () => { throw Object.assign(new Error("private upstream details"), { code }); });
    const result = await executeAdvancedHistoricalAnalysis(input);
    expect(result).toMatchObject({ status: "FAILED", reasonCode: "ADVANCED_HISTORY_UPSTREAM_FAILURE" });
    expect(JSON.stringify(result)).not.toContain("private upstream details");
    expect(result.foundation).toBeDefined();
  });
  it("diagnoses a foundation circuit failure without claiming analysis ran or disclosing error text", async () => {
    const input = executionInput("2号车经过哪些道路", "map-match");
    const old = input.reusableFoundation!;
    delete input.reusableFoundation;
    input.intent.historicalScope.taskReferenceKey = old.intent.taskReferenceKey!;
    input.subjectReferenceKeys = [old.intent.subjectReferenceKey!];
    const onFailure = vi.fn();
    input.onFailure = onFailure;
    input.foundationGateway.execute = vi.fn(async () => { throw Object.assign(new Error("private credential and request"), { code: "GATEWAY_CIRCUIT_OPEN" }); });
    const result = await executeAdvancedHistoricalAnalysis(input);
    expect(result).toMatchObject({ status: "FAILED", reasonCode: "ADVANCED_HISTORY_UPSTREAM_FAILURE", analysisEvidence: [] });
    expect(onFailure).toHaveBeenCalledWith({ phase: "FOUNDATION", code: "GATEWAY_CIRCUIT_OPEN", classification: "ADVANCED_HISTORY_UPSTREAM_FAILURE",
      lastOperation: result.operations.at(-1), attemptedOperations: 1, analysisEvidenceCount: 0 });
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain("private");
  });
  it.each(["RESPONSE_SCHEMA_MISMATCH", "INVALID_JSON_RESPONSE", "HTTP_503garbage"])("keeps %s fail-closed as contract mismatch", async code => {
    const input = executionInput("2号车经过哪些道路", "map-match");
    input.gateway.execute = vi.fn(async () => { throw Object.assign(new Error("invalid output"), { code }); });
    expect(await executeAdvancedHistoricalAnalysis(input)).toMatchObject({ status: "FAILED", reasonCode: "ADVANCED_HISTORY_RESULT_INVALID" });
  });
  it.each([
    ["2号车经过哪些道路", "map-match", ["trajectory.map-match"]],
    ["2号车最后经过哪个路口", "cross-last", ["trajectory.map-match", "temporal-spatial.find-events"]],
    ["2号车什么时候进入A区", "enter", ["temporal-spatial.find-events"]],
    ["2号车任务期间在哪里停车", "stop", ["temporal-spatial.find-events"]],
    ["2号车通信信号最好的位置", "metric-shared-campus", ["spatiotemporal-metric.rank-locations"]]
  ])("executes %s", async (text, name, ids) => {
    const input = executionInput(text, name);
    const result = await executeAdvancedHistoricalAnalysis(input);
    expect(result.reasonCode).not.toBe("ADVANCED_HISTORY_RESULT_INVALID");
    expect(result.operations).toEqual(ids);
    expect(result.analysisEvidence).toHaveLength(ids.length);
    expect(input.foundationGateway.execute).not.toHaveBeenCalled();
    if (name === "cross-last") {
      const request = vi.mocked(input.gateway.execute).mock.calls[1]![1];
      expect(request["source"]).toEqual({ kind: "MAP_MATCH_RESULT", mapMatchResult: (fixture("map-match")["output"] as { value: unknown }).value });
    }
    if (name === "stop") expect(input.resolveTarget).not.toHaveBeenCalled();
  });
  it.each(["advanced", "history", "deadline", "multiple"])("does not query when %s blocks", async kind => {
    const input = executionInput("2号车经过哪些道路", "map-match");
    if (kind === "advanced") input.configuration = { ...config, enabled: false };
    if (kind === "history") input.history = { ...history, enabled: false };
    if (kind === "deadline") input.deadlineAt = new Date(0);
    if (kind === "multiple") input.intent.historicalScope.executionSelection = { kind: "ALL", limit: 10 };
    const result = await executeAdvancedHistoricalAnalysis(input);
    expect(result.operations).toEqual([]); expect(input.gateway.execute).not.toHaveBeenCalled();
  });
  it("rejects a mismatched or modified result", async () => {
    const input = executionInput("2号车经过哪些道路", "map-match");
    const envelope = fixture("map-match"); (envelope["execution"] as Record<string, unknown>)["resultHash"] = `sha256:${"f".repeat(64)}`;
    input.gateway.execute = vi.fn(async () => envelope);
    expect(await executeAdvancedHistoricalAnalysis(input)).toMatchObject({ status: "FAILED", reasonCode: "ADVANCED_HISTORY_RESULT_INVALID" });
  });
  it("rejects target ambiguity and CRS without calling analysis", async () => {
    const input = executionInput("2号车什么时候进入A区", "enter");
    input.resolveTarget = vi.fn(async () => ({ reasonCode: "TARGET_CONTEXT_AMBIGUOUS" }));
    expect(await executeAdvancedHistoricalAnalysis(input)).toMatchObject({ status: "AMBIGUOUS" });
    expect(input.gateway.execute).not.toHaveBeenCalled();
  });
  it("does not reuse expired, phase-changed or context-changed trajectory", () => {
    const input = executionInput("2号车经过哪些道路", "map-match");
    const prior = input.reusableFoundation!;
    expect(canReuseAdvancedFoundation(prior, input.intent, Date.now())).toBe(true);
    expect(canReuseAdvancedFoundation(prior, { ...input.intent, historicalScope: {
      ...input.intent.historicalScope, subjectReferenceKey: { ...prior.intent.subjectReferenceKey!, version: "9000" }
    } }, Date.now())).toBe(true);
    expect(canReuseAdvancedFoundation({ ...prior, reference: { ...prior.reference, validUntil: "2000-01-01T00:00:00Z" } }, input.intent, Date.now())).toBe(false);
    expect(canReuseAdvancedFoundation(prior, { ...input.intent, historicalScope: { ...input.intent.historicalScope, phaseScope: "ACTIVE_PHASES_ONLY" } }, Date.now())).toBe(false);
    expect(canReuseAdvancedFoundation(prior, { ...input.intent, historicalScope: { ...input.intent.historicalScope, subjectMention: "3号车" } }, Date.now())).toBe(false);
  });
  it.each(["PROJECTION_PENDING", "NO_DATA", "CONFLICTED", "SUBJECT_TASK_MISMATCH"])("stops foundation state %s before analysis", async reason => {
    const input = executionInput("2号车本次任务经过哪些道路", "map-match");
    const old = input.reusableFoundation!;
    delete input.reusableFoundation;
    input.intent.historicalScope.taskReferenceKey = old.intent.taskReferenceKey!;
    input.subjectReferenceKeys = [old.intent.subjectReferenceKey!];
    input.foundationGateway.execute = vi.fn(async id => {
      if (id === "operational-task.get") return { referenceKey: old.intent.taskReferenceKey,
        actorReferenceKeys: reason === "SUBJECT_TASK_MISMATCH" ? [{ ...old.intent.subjectReferenceKey!, id: "different-subject" }] : [old.intent.subjectReferenceKey], activityState: "ACTIVE" };
      return { status: reason === "PROJECTION_PENDING" ? "INDETERMINATE" : reason === "CONFLICTED" ? "INDETERMINATE" : "NO_DATA",
        reasonCode: reason, intervals: [] };
    });
    const result = await executeAdvancedHistoricalAnalysis(input);
    expect(input.gateway.execute).not.toHaveBeenCalled();
    expect(result.status).not.toBe("COMPLETED");
    if (reason === "PROJECTION_PENDING") expect(result.reasonCode).toBe("HISTORICAL_PROJECTION_PENDING");
    if (reason === "NO_DATA") expect(result.reasonCode).toBe("HISTORICAL_TRAJECTORY_NO_DATA");
    if (reason === "SUBJECT_TASK_MISMATCH") expect(result.reasonCode).toBe("SUBJECT_TASK_MISMATCH");
  });
  it("reuses executeHistoricalTrace for interval and trajectory with active phase scope", async () => {
    const input = executionInput("2号车本次任务经过哪些道路，排除暂停阶段", "map-match");
    const old = input.reusableFoundation!;
    delete input.reusableFoundation;
    input.intent.historicalScope.taskReferenceKey = old.intent.taskReferenceKey!;
    input.subjectReferenceKeys = [old.intent.subjectReferenceKey!];
    input.foundationGateway.execute = vi.fn(async id => {
      if (id === "operational-task.get") return { referenceKey: old.intent.taskReferenceKey, actorReferenceKeys: [old.intent.subjectReferenceKey], activityState: "ACTIVE" };
      if (id === "operational-task.get-execution-intervals") return { status: "COMPLETED", reasonCode: "INTERVAL_AVAILABLE", intervals: [{
        executionIntervalReferenceKey: { namespace: "gowm", kind: "TASK_EXECUTION_INTERVAL", id: "interval", version: "1" },
        executionNo: 1, revisionNo: 1, lifecycleState: "CLOSED", stabilityState: "SEALED", derivationKind: "FIXTURE",
        selectedPeriods: [], activePeriods: [], pausedPeriods: [] }] };
      return { status: "COMPLETED", reasonCode: "TRAJECTORY_AVAILABLE", subjectReferenceKey: old.intent.subjectReferenceKey,
        ...old.finding.trajectory, preview: [], finalization: { state: "SEALED" } };
    });
    const result = await executeAdvancedHistoricalAnalysis(input);
    expect(result.operations).toEqual(["operational-task.get", "operational-task.get-execution-intervals", "history.get-trajectory", "trajectory.map-match"]);
    expect(vi.mocked(input.foundationGateway.execute).mock.calls[2]![1]).toMatchObject({ phaseScope: "ACTIVE_PHASES_ONLY" });
    expect(result.analysisEvidence).toHaveLength(1);
  });
});

describe("trusted advanced multi-turn", () => {
  function priorRanking() {
    const intent = parse("2号车通信最好的三个位置在哪里");
    if (intent.analysis.kind !== "METRIC_RANKING") throw new Error("expected metric");
    const result = contracts.validateEnvelope("spatiotemporal-metric.rank-locations", fixture("metric-shared-campus")).output.value;
    const payload = normalizeMetricRanking(result, intent.analysis)[0]!;
    const stored = { groundingId: "stored-grounding", evidenceItems: [{ evidenceProductId: "metric", productKind: "CAPABILITY_RESULT", safePayload: {
      ...payload, queryContext: { intent, foundation: foundation("metric-shared-campus", intent), foundationHash: analysisHash(foundation("metric-shared-campus", intent)) }
    } }] };
    const bytes = Buffer.from(JSON.stringify(stored));
    const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    return { bytes, hash, prior: decodeStoredAdvancedHistory(bytes, hash, hash, ["metric"])! };
  }
  it("rejects modified prior bytes even if client submits a safePayload", () => {
    const { bytes, hash } = priorRanking();
    expect(() => decodeStoredAdvancedHistory(Buffer.concat([bytes, Buffer.from(" ")]), hash, hash, ["metric"])).toThrow("HISTORICAL_PRIOR_RESULT_HASH_MISMATCH");
  });
  it("does not reuse a stored but truncated foundation even with a valid result hash", () => {
    const { bytes } = priorRanking();
    const stored = JSON.parse(bytes.toString("utf8"));
    stored.evidenceItems[0].safePayload.queryContext.foundation.finding.trajectory.completeness.sampleCount = 0;
    const changed = Buffer.from(JSON.stringify(stored));
    const hash = `sha256:${createHash("sha256").update(changed).digest("hex")}`;
    expect(decodeStoredAdvancedHistory(changed, hash, hash, ["metric"])).toBeUndefined();
  });
  it("reuses rank 2 and creates an unauthorized action candidate", () => {
    const { prior } = priorRanking();
    const next = resolveAdvancedFollowup("让2号车回到第二个位置", prior, catalog, config);
    expect(next.reuse?.findings[1]).toMatchObject({ findingKind: "HISTORICAL_ACTION_TARGET_CANDIDATE", sourceRank: 2, currentValidationRequired: true, routePlanningRequired: true, executionAuthorized: false });
  });
  it("requeries missing rank, changed metric, changed phase and updates", () => {
    const { prior } = priorRanking();
    expect(resolveAdvancedFollowup("第四个位置呢", prior, catalog, config).reuse).toBeUndefined();
    expect(resolveAdvancedFollowup("那丢包率最低的位置呢", prior, catalog, config)).toMatchObject({ reusableFoundation: prior.foundation });
    expect(resolveAdvancedFollowup("排除暂停阶段再看", prior, catalog, config).reusableFoundation).toBeUndefined();
    expect(resolveAdvancedFollowup("现在更新了吗", prior, catalog, config)).toMatchObject({ compare: true });
  });
  it("resolves series only from the exact trusted candidate and rejects unknown selections", () => {
    const { prior } = priorRanking();
    const metric = contracts.validateEnvelope("spatiotemporal-metric.rank-locations", fixture("metric-ambiguous-series")).output.value;
    const payload = prior.evidenceItems[0]!["safePayload"] as Record<string, unknown>;
    payload["metricSeriesCandidates"] = metric.metricSeriesCandidates;
    const next = resolveAdvancedFollowup("使用 wifi-rssi", prior, catalog, config);
    expect(next.resolution).toMatchObject({ intent: { analysis: { metricSeriesSelection: { mode: "EXPLICIT_SERIES", sourceKey: "wifi-radio", datastreamKey: "wifi-rssi", measurementKey: "rssi" } } } });
    expect(resolveAdvancedFollowup("使用 wifi0", prior, catalog, config).resolution).toMatchObject({ reasonCode: "METRIC_SERIES_AMBIGUOUS" });
  });
  it("requeries an unconfirmed LAST and never reuses CROSS for ENTER", () => {
    const { prior } = priorRanking();
    prior.intent = parse("2号车经过哪些路口");
    prior.foundation.intent = { ...prior.foundation.intent, ...prior.intent.historicalScope };
    const events = normalizeTemporalEvent(contracts.validateEnvelope("temporal-spatial.find-events", fixture("cross-last")).output.value);
    prior.evidenceItems[0]!["safePayload"] = events;
    expect(resolveAdvancedFollowup("最后一个呢", prior, catalog, config).reuse).toBeUndefined();
    events["completeness"] = { sourceSuffixComplete: true, completeForAllEvents: true };
    events["summary"] = { truncated: false }; events["truncated"] = false;
    expect(resolveAdvancedFollowup("最后一个呢", prior, catalog, config).reuse?.findings[0]).toMatchObject({ selection: { confirmed: true } });
    expect(resolveAdvancedFollowup("最后一次进入A区", prior, catalog, config).reuse).toBeUndefined();
  });
});

describe("execution availability observations", () => {
  it.each(["fresh", "stale", "unavailable", "absent"])("handles %s observation after admission expires", async mode => {
    const input = executionInput("2号车任务期间在哪里停车", "stop");
    input.compileContext.availability.forEach(entry => { entry.validUntil = new Date(Date.now() - 1).toISOString(); });
    const frozen = structuredClone(input.compileContext);
    if (mode !== "absent") input.observeAvailability = async ids => ({
      schemaVersion: "1.0", kind: "EXECUTION_AVAILABILITY", requestId: "probe",
      observedAt: new Date().toISOString(), authorityHash: analysisHash(frozen),
      principalHash: analysisHash("principal"), delegationHash: analysisHash("delegation"), observationHash: analysisHash(mode),
      operations: frozen.availability.filter(entry => ids.includes(entry.operationId)).map(entry => ({
        ...entry, checkedAt: new Date().toISOString(),
        validUntil: new Date(Date.now() + (mode === "stale" ? -1 : 5000)).toISOString(),
        availability: mode === "unavailable" ? "UNAVAILABLE" : "AVAILABLE"
      }))
    });
    const result = await executeAdvancedHistoricalAnalysis(input);
    expect(input.compileContext).toEqual(frozen);
    if (mode === "fresh") {
      expect(result.analysisEvidence).toHaveLength(1);
      expect(result.executionAvailabilityObservations).toHaveLength(1);
    } else expect(input.gateway.execute).not.toHaveBeenCalled();
  });
  it("reobserves the second CROSS node after the first node outlives the health TTL", async () => {
    const input = executionInput("2号车最后经过哪个路口", "cross-last");
    let clock = Date.now();
    input.now = () => clock;
    const observe = vi.fn(async (ids: readonly string[]) => ({
      schemaVersion: "1.0" as const, kind: "EXECUTION_AVAILABILITY" as const, requestId: "probe",
      observedAt: new Date(clock).toISOString(), authorityHash: analysisHash("authority"),
      principalHash: analysisHash("principal"), delegationHash: analysisHash("delegation"), observationHash: analysisHash(clock),
      operations: input.compileContext.availability.filter(entry => ids.includes(entry.operationId)).map(entry => ({
        ...entry, checkedAt: new Date(clock).toISOString(), validUntil: new Date(clock + 5000).toISOString()
      }))
    }));
    input.observeAvailability = observe;
    const execute = input.gateway.execute;
    input.gateway.execute = vi.fn(async (id, request, options) => { const result = await execute(id, request, options); clock += 6000; return result; });
    const result = await executeAdvancedHistoricalAnalysis(input);
    expect(result.analysisEvidence).toHaveLength(2);
    expect(observe.mock.calls.map(call => call[0])).toEqual([
      ["trajectory.map-match", "temporal-spatial.find-events"], ["temporal-spatial.find-events"]
    ]);
    expect(result.executionAvailabilityObservations).toHaveLength(2);
  });
});
