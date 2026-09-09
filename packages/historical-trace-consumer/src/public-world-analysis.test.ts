import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { AnalysisProviderContracts, analysisHash, type AnalysisOperationId, type ValidatedAnalysisEnvelope, type AnalysisProviderResultTypes } from "@wsgs/gowm-contract-intake";
import { createWorldAnalysisValidator, worldAnalysisCanonicalHash, worldAnalysisFindingSetHash, worldAnalysisResultHash, type GroundingResult12 } from "@wsgs/contracts";
import { projectPublicWorldAnalysis, assemblePublicWorldAnalysisResult, boundPublicWorldAnalysisResult, WorldAnalysisResultTooLargeError, type PublicWorldAnalysisContext } from "./public-world-analysis.js";
import type { AdvancedHistoricalExecutionResult, AdvancedHistoricalFoundation } from "./advanced-types.js";
import type { HistoricalReferenceKey } from "./types.js";
import { MetricSemanticCatalog } from "./metric-semantic-catalog.js";
import { resolvePublicAdvancedFollowup, resolvePublicAdvancedFollowups } from "./advanced-followup.js";
import { advancedHistoryConfigurationFromEnvironment } from "./advanced-config.js";

const contracts = new AnalysisProviderContracts(fileURLToPath(new URL("../../../contracts/upstream/gowm-analysis-providers-current", import.meta.url)));
const catalog = new MetricSemanticCatalog();
const validate = createWorldAnalysisValidator();
const fixtureRoot = new URL("../../../validation/fixtures/advanced-history/", import.meta.url);
const validUntil = "2026-09-06T12:01:00.000Z";
const baseResult = (): GroundingResult12 => JSON.parse(readFileSync(new URL("../../../contracts/wsgs-v0.2.4-world-analysis/examples/empty.json", import.meta.url), "utf8")) as GroundingResult12;
const key = (kind: string, id: string): HistoricalReferenceKey => ({ namespace: "gowm", kind, id: `wrf_${analysisHash(id).slice(7, 39)}`, version: "1" });
function reseal(envelope: ValidatedAnalysisEnvelope<AnalysisProviderResultTypes[AnalysisOperationId]>): void {
  envelope.status = envelope.output.value.status;
  envelope.execution.resultHash = analysisHash(envelope.output.value);
  for (const receipt of envelope.receipts) receipt.outputHash = envelope.execution.resultHash;
}

// Explicit controlled projection of repository Provider fixtures, not live data.
function fixture(name: string): ValidatedAnalysisEnvelope<AnalysisProviderResultTypes[AnalysisOperationId]> {
  const envelope = JSON.parse(readFileSync(new URL(`${name}.json`, fixtureRoot), "utf8"));
  function rewrite(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    // The Provider's generic latency demo is projected onto the actual catalog
    // identity. This is controlled fixture data, never a claimed live mapping.
    if (name === "metric-minimize-metric") {
      if (record["observedProperty"] === "network.latency") record["observedProperty"] = "AVERAGE_ROUND_TRIP_TIME";
      if (record["measurementStage"] === "NORMALIZED") record["measurementStage"] = "PARSED_NATIVE";
    }
    if (record["namespace"] === "gowm" && typeof record["kind"] === "string" && typeof record["id"] === "string") record["id"] = key(record["kind"], record["id"]).id;
    for (const child of Object.values(value)) rewrite(child);
  }
  rewrite(envelope);
  if (name === "cross-last") envelope.output.value.source.mapMatchResultHash = analysisHash(fixture("map-match").output.value);
  envelope.execution.resultHash = analysisHash(envelope.output.value);
  for (const receipt of envelope.receipts) {
    receipt.outputHash = envelope.execution.resultHash;
    receipt.computeSnapshotHash = analysisHash(envelope.computeSnapshot);
  }
  return contracts.validateEnvelope(envelope.operation.operationId, envelope);
}
function setup(name: string, action = false) {
  const envelope = fixture(name);
  const operationId = envelope.operation.operationId as AnalysisOperationId;
  const output = envelope.output.value;
  const trajectoryKey = "trajectoryReferenceKey" in output ? output.trajectoryReferenceKey : output.source.trajectoryReferenceKey;
  const subjectKey = output.subjectReferenceKey ?? key("ENTITY", "ugv1");
  const taskKey = key("OPERATIONAL_TASK", "task-1");
  const intervalKey = key("TASK_EXECUTION_INTERVAL", "interval-1");
  const knownKeys = [subjectKey, taskKey, intervalKey, trajectoryKey];
  if ("events" in output) for (const event of output.events) if (event.target?.kind === "SPATIAL_TARGET" && event.target.referenceKey) knownKeys.push(event.target.referenceKey);
  const referenceProducts: GroundingResult12["referenceProducts"] = knownKeys.map((referenceKey, index) => ({ productId: index === 0 ? "ugv1" : `product-${index}`, productKind: "RESOLVED_REFERENCE", referenceKey: { ...referenceKey, namespace: "gowm" }, referenceType: referenceKey.kind, displayName: referenceKey.kind, sourceOperation: "history.get-trajectory", sourceWorldVersion: 1, validUntil }));
  const interval = { start: "2026-09-01T08:00:00.000Z", end: "2026-09-01T08:10:00.000Z", bounds: "[)" as const };
  const foundation: AdvancedHistoricalFoundation = { intent: { taskReferenceKey: taskKey, subjectReferenceKey: subjectKey, executionSelection: { kind: "LATEST" }, phaseScope: "ACTIVE_PHASES_ONLY", sourceSelection: { mode: "ONLY_CANDIDATE" } }, reference: { referenceKey: trajectoryKey, referenceType: "HISTORICAL_TRAJECTORY", revalidationRequired: false }, finding: {
    findingKind: "HISTORICAL_TRAJECTORY", status: "COMPLETED", reasonCode: "TRAJECTORY_AVAILABLE", warnings: [], taskReferenceKey: taskKey, subjectReferenceKey: subjectKey,
    executionInterval: { executionIntervalReferenceKey: intervalKey, executionNo: 2, revisionNo: 1, lifecycleState: "COMPLETED", selectedPeriods: [interval], activePeriods: [interval], pausedPeriods: [], derivationKind: "EXPLICIT", stabilityState: "SEALED", envelopeDurationMs: 600000, activeDurationMs: 600000, pausedDurationMs: 0 },
    trajectory: { trajectoryReferenceKey: trajectoryKey, requestedPeriods: [interval], definedPeriods: [interval], excludedPeriods: [], gaps: [], inputTrackletVersions: [], completeness: { temporalCoverageRatio: 1, sampleCount: 3, sequenceCount: 1, gapCount: 0, prefixComplete: true, suffixComplete: true }, finalization: { state: "SEALED" }, inlineSamples: { mode: "BOUNDED_PREVIEW", points: [], truncated: true } }
  } };
  const base = baseResult();
  base.referenceProducts = referenceProducts;
  const context: PublicWorldAnalysisContext = { groundingId: base.groundingId, referenceProducts, evidenceItems: base.evidenceItems, foundationEvidenceIds: [base.evidenceItems[0]!.evidenceProductId], validUntil };
  const eventResult = operationId === "temporal-spatial.find-events" ? contracts.validateResult(operationId, output) : undefined;
  const analysis = operationId === "trajectory.map-match" ? { kind: "ROAD_ASSOCIATION" as const, output: "ROAD_VISITS" as const } : eventResult ? { kind: "TEMPORAL_EVENT" as const, eventType: eventResult.requestedEventTypes[0]!, selection: eventResult.selectionResult ? { kind: eventResult.selectionResult.kind } : { kind: "ALL" as const } } : { kind: "METRIC_RANKING" as const, metricConceptId: name === "metric-minimize-metric" ? "NETWORK_LATENCY" : "COMMUNICATION_RSSI", metricSelector: { ...contracts.validateResult("spatiotemporal-metric.rank-locations", output).metric }, metricSeriesSelection: { mode: "ONLY_CANDIDATE" as const }, topK: 3, actionTargetRequested: action };
  const advanced: AdvancedHistoricalExecutionResult = { status: "COMPLETED", reasonCode: output.reasonCode, intent: { historicalScope: foundation.intent, analysis }, foundation, analysisEvidence: [{ operationId, envelope }], findings: [], operations: [operationId] };
  if (name === "cross-last") advanced.analysisEvidence.unshift({ operationId: "trajectory.map-match", envelope: fixture("map-match") });
  return { context, contracts, catalog, advanced, base };
}

describe("public world analysis projection", () => {
  it.each([false, true])("combines independently selected subject and task without old target reuse (reverse=%s)", reverse => {
    const input = setup("metric-shared-campus", true);
    const first = assemblePublicWorldAnalysisResult(input.base, projectPublicWorldAnalysis(input));
    const choices = first.referenceProducts.slice(0, 2).map((product, index) => ({ choiceId: `combined-${index}`,
      choiceKind: index === 0 ? "REFERENCE_SELECTION" as const : "TASK_SELECTION" as const,
      promptCode: "REFERENCE_AMBIGUOUS", validUntil, candidates: [{ candidateId: `candidate-${index}`, displayName: product.displayName, referenceProductId: product.productId }] }));
    first.worldAnalysisFindings.choices.push(...choices);
    first.worldAnalysisFindings.findingSetHash = worldAnalysisFindingSetHash(first.worldAnalysisFindings); first.resultHash = worldAnalysisResultHash(first);
    expect(validate("result", first).valid).toBe(true);
    const selections = choices.map(choice => ({ choiceId: choice.choiceId, candidateId: choice.candidates[0]!.candidateId }));
    const followup = resolvePublicAdvancedFollowups("选择这些对象", first, reverse ? selections.reverse() : selections, input.advanced, catalog,
      advancedHistoryConfigurationFromEnvironment({ WSGS_ADVANCED_HISTORY_ENABLED: "YES" }), Date.parse("2026-09-06T12:00:00Z"));
    expect(followup.resolution).toMatchObject({ status: "PARSED", intent: { historicalScope: {
      subjectReferenceKey: first.referenceProducts[0]!.referenceKey, taskReferenceKey: first.referenceProducts[1]!.referenceKey } } });
    expect(followup.publicReuse).toBeUndefined(); expect(followup.reusableFoundation).toBeUndefined();
  });
  it.each(["ordinal", "same-role", "duplicate-choice"])("rejects ambiguous combined selections: %s", mode => {
    const input = setup("metric-shared-campus");
    const first = assemblePublicWorldAnalysisResult(input.base, projectPublicWorldAnalysis(input));
    const product = first.referenceProducts[0]!;
    const choices = [0, 1].map(index => ({ choiceId: `combined-${index}`, choiceKind: "REFERENCE_SELECTION" as const,
      promptCode: "REFERENCE_AMBIGUOUS", validUntil, candidates: [{ candidateId: `candidate-${index}`, displayName: product.displayName, referenceProductId: product.productId }] }));
    first.worldAnalysisFindings.choices.push(...choices);
    const selections = choices.map(choice => ({ choiceId: choice.choiceId, candidateId: choice.candidates[0]!.candidateId }));
    if (mode === "duplicate-choice") selections[1] = selections[0]!;
    const followup = resolvePublicAdvancedFollowups(mode === "ordinal" ? "选择第一个" : "选择这些对象", first, selections, input.advanced, catalog,
      advancedHistoryConfigurationFromEnvironment({ WSGS_ADVANCED_HISTORY_ENABLED: "YES" }), Date.parse("2026-09-06T12:00:00Z"));
    expect(followup.resolution).toEqual({ status: "UNRESOLVED", reasonCode: "SELECTION_AMBIGUOUS" });
  });
  it("does not carry an old rank or action result across a combined reference selection", () => {
    const input = setup("metric-shared-campus", true);
    const first = assemblePublicWorldAnalysisResult(input.base, projectPublicWorldAnalysis(input));
    const ranking = first.worldAnalysisFindings.choices.find(choice => choice.choiceKind === "RANKED_LOCATION_SELECTION")!;
    const product = first.referenceProducts[0]!;
    const reference = { choiceId: "combined-subject", choiceKind: "REFERENCE_SELECTION" as const, promptCode: "REFERENCE_AMBIGUOUS", validUntil,
      candidates: [{ candidateId: "combined-subject-candidate", displayName: product.displayName, referenceProductId: product.productId }] };
    first.worldAnalysisFindings.choices.push(reference);
    const followup = resolvePublicAdvancedFollowups("回到这个位置", first, [
      { choiceId: ranking.choiceId, candidateId: ranking.candidates[0]!.candidateId },
      { choiceId: reference.choiceId, candidateId: reference.candidates[0]!.candidateId }
    ], input.advanced, catalog, advancedHistoryConfigurationFromEnvironment({ WSGS_ADVANCED_HISTORY_ENABLED: "YES" }), Date.parse("2026-09-06T12:00:00Z"));
    expect(followup.resolution.status).toBe("PARSED");
    if (followup.resolution.status !== "PARSED") throw new Error("expected parsed combined selection");
    expect(followup.resolution.intent.analysis).toMatchObject({ kind: "METRIC_RANKING", actionTargetRequested: true });
    expect(followup.resolution.intent.analysis).not.toHaveProperty("selectedRank");
    expect(followup.publicReuse).toBeUndefined(); expect(followup.reusableFoundation).toBeUndefined();
  });
  it("keeps a WORLD_OBJECT event target distinct from the historical subject", () => {
    const input = setup("enter");
    const first = assemblePublicWorldAnalysisResult(input.base, projectPublicWorldAnalysis(input));
    const product = first.referenceProducts.at(-1)!;
    first.worldAnalysisFindings.choices.push({ choiceId: "target-choice", choiceKind: "REFERENCE_SELECTION", promptCode: "REFERENCE_AMBIGUOUS", validUntil,
      candidates: [{ candidateId: "target-candidate", displayName: product.displayName, referenceProductId: product.productId }] });
    first.worldAnalysisFindings.findingSetHash = worldAnalysisFindingSetHash(first.worldAnalysisFindings);
    first.resultHash = worldAnalysisResultHash(first);
    expect(validate("result", first)).toEqual({ valid: true, errors: [] });
    const followup = resolvePublicAdvancedFollowup("选择这个对象", first, "target-choice", "target-candidate", input.advanced, catalog,
      advancedHistoryConfigurationFromEnvironment({ WSGS_ADVANCED_HISTORY_ENABLED: "YES" }), Date.parse("2026-09-06T12:00:00Z"));
    expect(followup.resolution).toMatchObject({ status: "PARSED", intent: { analysis: { targetReferenceKey: product.referenceKey }, historicalScope: { subjectReferenceKey: input.advanced.intent.historicalScope.subjectReferenceKey } } });
    expect(followup.publicReuse).toBeUndefined();
  });
  it.each(["TASK_SELECTION", "REFERENCE_SELECTION"] as const)("requeries a selected real %s without reusing the old action", choiceKind => {
    const input = setup("metric-shared-campus", true);
    const first = assemblePublicWorldAnalysisResult(input.base, projectPublicWorldAnalysis(input));
    const product = first.referenceProducts[choiceKind === "TASK_SELECTION" ? 1 : 0]!;
    const choice = { choiceId: "reference-choice", choiceKind, promptCode: "REFERENCE_AMBIGUOUS", validUntil,
      candidates: [{ candidateId: "reference-candidate", displayName: product.displayName, referenceProductId: product.productId }] };
    first.worldAnalysisFindings.choices.push(choice);
    first.worldAnalysisFindings.findingSetHash = worldAnalysisFindingSetHash(first.worldAnalysisFindings);
    first.resultHash = worldAnalysisResultHash(first);
    expect(validate("result", first)).toEqual({ valid: true, errors: [] });
    const followup = resolvePublicAdvancedFollowup("选择这个对象", first, choice.choiceId, choice.candidates[0]!.candidateId, input.advanced, catalog,
      advancedHistoryConfigurationFromEnvironment({ WSGS_ADVANCED_HISTORY_ENABLED: "YES" }), Date.parse("2026-09-06T12:00:00Z"));
    expect(followup.publicReuse).toBeUndefined();
    expect(followup.reusableFoundation).toBeUndefined();
    expect(followup.resolution.status).toBe("PARSED");
    if (followup.resolution.status !== "PARSED") throw new Error("expected parsed choice");
    expect(followup.resolution.intent.historicalScope[choiceKind === "TASK_SELECTION" ? "taskReferenceKey" : "subjectReferenceKey"]).toEqual(product.referenceKey);
    expect(followup.resolution.intent.analysis).toMatchObject({ actionTargetRequested: false });
    if (choiceKind === "REFERENCE_SELECTION") expect(product.productId).toBe("ugv1");
  });
  it("selects a saved event from its complete source without inventing FIRST/LAST proof", () => {
    const input = setup("stop");
    const first = assemblePublicWorldAnalysisResult(input.base, projectPublicWorldAnalysis(input));
    const choice = first.worldAnalysisFindings.choices.find(value => value.choiceKind === "EVENT_SELECTION")!;
    const candidate = choice.candidates[0]!;
    const followup = resolvePublicAdvancedFollowup("选择这个事件", first, choice.choiceId, candidate.candidateId, input.advanced, catalog,
      advancedHistoryConfigurationFromEnvironment({ WSGS_ADVANCED_HISTORY_ENABLED: "YES" }), Date.parse("2026-09-06T12:00:00Z"));
    expect(followup.publicReuse?.publicEventSelection).toBeDefined();
    const second = assemblePublicWorldAnalysisResult(input.base, projectPublicWorldAnalysis({ ...input, advanced: followup.publicReuse! }));
    const selected = second.worldAnalysisFindings.findings.find(value => value.findingKind === "TEMPORAL_EVENT")!;
    const original = first.worldAnalysisFindings.findings.find(value => value.findingKind === "TEMPORAL_EVENT")!;
    expect(selected.events).toEqual([original.events[0]]);
    expect(selected.selection).toEqual(original.selection);
    expect(validate("result", second)).toEqual({ valid: true, errors: [] });
    expect(followup.publicReuse!.analysisEvidence).toEqual(input.advanced.analysisEvidence);
    const forged = structuredClone(followup.publicReuse!);
    forged.publicEventSelection!.eventId = "missing-event";
    expect(projectPublicWorldAnalysis({ ...input, advanced: forged }).component.gaps).toEqual(expect.arrayContaining([expect.objectContaining({ gapKind: "SELECTION_INVALID" })]));
  });
  it("reuses the exact selected visited candidate for an explicit two-turn action", () => {
    const input = setup("metric-shared-campus");
    const first = assemblePublicWorldAnalysisResult(input.base, projectPublicWorldAnalysis(input));
    const choice = first.worldAnalysisFindings.choices.find(value => value.choiceKind === "RANKED_LOCATION_SELECTION")!;
    const candidate = choice.candidates[1]!;
    const followup = resolvePublicAdvancedFollowup("回到第二个位置", first, choice.choiceId, candidate.candidateId, input.advanced, catalog,
      advancedHistoryConfigurationFromEnvironment({ WSGS_ADVANCED_HISTORY_ENABLED: "YES" }), Date.parse("2026-09-06T12:00:00Z"));
    expect(followup.publicReuse).toBeDefined();
    const second = assemblePublicWorldAnalysisResult(input.base, projectPublicWorldAnalysis({ ...input, advanced: followup.publicReuse! }));
    const action = second.worldAnalysisFindings.findings.find(value => value.findingKind === "ACTION_TARGET_CANDIDATE")!;
    const rank = first.worldAnalysisFindings.findings.find(value => value.findingKind === "METRIC_RANKING")!;
    expect(action.target).toEqual(rank.candidates[1]!.representativeVisitedPosition);
    expect(action.sourceRank).toBe(2);
    expect(action.executionAuthorized).toBe(false);
    expect(validate("result", second)).toEqual({ valid: true, errors: [] });
  });
  it.each(["时延最低的位置", "最近一次任务通信最好的位置", "更新了吗"])("requeries instead of reusing the old selected target for %s", text => {
    const input = setup("metric-shared-campus");
    const first = assemblePublicWorldAnalysisResult(input.base, projectPublicWorldAnalysis(input));
    const choice = first.worldAnalysisFindings.choices.find(value => value.choiceKind === "RANKED_LOCATION_SELECTION")!;
    const followup = resolvePublicAdvancedFollowup(text, first, choice.choiceId, choice.candidates[0]!.candidateId, input.advanced, catalog,
      advancedHistoryConfigurationFromEnvironment({ WSGS_ADVANCED_HISTORY_ENABLED: "YES" }), Date.parse("2026-09-06T12:00:00Z"));
    expect(followup.publicReuse).toBeUndefined();
  });
  it("rejects text/structured rank conflicts and never inherits an earlier action request", () => {
    const input = setup("metric-shared-campus", true);
    const first = assemblePublicWorldAnalysisResult(input.base, projectPublicWorldAnalysis(input));
    const choice = first.worldAnalysisFindings.choices.find(value => value.choiceKind === "RANKED_LOCATION_SELECTION")!;
    const config = advancedHistoryConfigurationFromEnvironment({ WSGS_ADVANCED_HISTORY_ENABLED: "YES" });
    const conflict = resolvePublicAdvancedFollowup("第二个位置", first, choice.choiceId, choice.candidates[0]!.candidateId, input.advanced, catalog, config, Date.parse("2026-09-06T12:00:00Z"));
    expect(conflict.resolution).toMatchObject({ status: "UNRESOLVED", reasonCode: "SELECTION_AMBIGUOUS" });
    const multiple = resolvePublicAdvancedFollowup("第一个，还是第二个位置", first, choice.choiceId, choice.candidates[0]!.candidateId, input.advanced, catalog, config, Date.parse("2026-09-06T12:00:00Z"));
    expect(multiple.resolution).toMatchObject({ status: "UNRESOLVED", reasonCode: "SELECTION_AMBIGUOUS" });
    const query = resolvePublicAdvancedFollowup("第一个位置", first, choice.choiceId, choice.candidates[0]!.candidateId, input.advanced, catalog, config, Date.parse("2026-09-06T12:00:00Z"));
    expect(query.publicReuse?.intent.analysis).toMatchObject({ actionTargetRequested: false });
    const unrelated = resolvePublicAdvancedFollowup("现在在哪里", first, choice.choiceId, choice.candidates[0]!.candidateId, input.advanced, catalog, config, Date.parse("2026-09-06T12:00:00Z"));
    expect(unrelated.resolution).toMatchObject({ status: "UNRESOLVED", reasonCode: "SELECTION_AMBIGUOUS" });
    input.advanced.findings.push({ metricCatalog: { hash: "stale-catalog" } });
    expect(resolvePublicAdvancedFollowup("第一个位置", first, choice.choiceId, choice.candidates[0]!.candidateId, input.advanced, catalog, config, Date.parse("2026-09-06T12:00:00Z")).publicReuse).toBeUndefined();
  });
  it.each(["map-match", "cross-last", "enter", "exit", "dwell", "stop", "pass_near", "metric-shared-campus", "metric-minimize-metric"])("maps validated %s through the full public result", name => {
    const input = setup(name, name.startsWith("metric-"));
    const projection = projectPublicWorldAnalysis(input);
    expect(projection.component.gaps, JSON.stringify(projection.component)).toEqual([]);
    const result = assemblePublicWorldAnalysisResult(input.base, projection);
    expect(validate("result", result)).toEqual({ valid: true, errors: [] });
    expect(result.worldAnalysisFindings.findings.length).toBeGreaterThanOrEqual(2);
    expect(projectPublicWorldAnalysis(input)).toEqual(projection);
    expect({ profileHash: result.worldAnalysisFindings.findingSetHash, resultHash: result.resultHash, kinds: result.worldAnalysisFindings.findings.map(finding => finding.findingKind) }).toMatchSnapshot();
  });
  it.each([["HISTORICAL_UPSTREAM_CONTRACT_MISMATCH", "UPSTREAM_CONTRACT_MISMATCH"], ["HISTORICAL_UPSTREAM_UNAVAILABLE", "UPSTREAM_FAILURE"]])("publishes a blocking gap for historical query failure %s", (reason, gapKind) => {
    const { advanced: _advanced, ...input } = setup("metric-shared-campus");
    const projection = projectPublicWorldAnalysis({ ...input, failureReasonCode: reason });
    expect(projection.component.gaps).toEqual(expect.arrayContaining([expect.objectContaining({ gapKind, severity: "BLOCKING" })]));
    expect(assemblePublicWorldAnalysisResult(input.base, projection).status).toBe("PARTIAL");
  });
  it("keeps independent history but rejects a tampered Provider result", () => {
    const input = setup("metric-shared-campus");
    input.advanced.analysisEvidence[0]!.envelope.execution.resultHash = `sha256:${"0".repeat(64)}`;
    const projection = projectPublicWorldAnalysis(input);
    expect(projection.component.findings.map(finding => finding.findingKind)).toEqual(["HISTORICAL_TRACE"]);
    expect(projection.component.gaps[0]?.gapKind).toBe("UPSTREAM_CONTRACT_MISMATCH");
    expect(assemblePublicWorldAnalysisResult(input.base, projection).status).toBe("PARTIAL");
  });
  it("does not fabricate missing authoritative reference products", () => {
    const input = setup("metric-shared-campus");
    input.context.referenceProducts = [];
    const projection = projectPublicWorldAnalysis(input);
    expect(projection.component.findings).toEqual([]);
    expect(projection.component.gaps.every(gap => gap.gapKind === "REFERENCE_MISSING")).toBe(true);
    expect(projection.evidenceItems).toEqual(input.context.evidenceItems);
  });
  it("uses median as the ranking score and visited Point as the action source", () => {
    const input = setup("metric-shared-campus", true);
    const projection = projectPublicWorldAnalysis(input);
    const ranking = projection.component.findings.find(finding => finding.findingKind === "METRIC_RANKING");
    const action = projection.component.findings.find(finding => finding.findingKind === "ACTION_TARGET_CANDIDATE");
    expect(ranking?.findingKind).toBe("METRIC_RANKING");
    expect(action?.findingKind).toBe("ACTION_TARGET_CANDIDATE");
    if (ranking?.findingKind !== "METRIC_RANKING" || action?.findingKind !== "ACTION_TARGET_CANDIDATE") throw new Error("Missing projections");
    const candidate = ranking.candidates.find(item => item.candidateId === action.sourceCandidateId)!;
    expect(candidate.rankingBasis.rankingValue).toBe(candidate.statistics.median);
    expect(action.target).toEqual(candidate.representativeVisitedPosition);
    expect(action.requirements).toEqual({ currentValidationRequired: true, routePlanningRequired: true, executionConfirmationRequired: true });
    expect(action.executionAuthorized).toBe(false);
    expect(worldAnalysisCanonicalHash(projection.component)).toBe(worldAnalysisCanonicalHash(projectPublicWorldAnalysis(input).component));
  });
  it("does not treat optional Top-K follow-up choices as an unresolved required choice", () => {
    const input = setup("metric-shared-campus");
    const projection = projectPublicWorldAnalysis(input);
    expect(projection.component.choices[0]?.choiceKind).toBe("RANKED_LOCATION_SELECTION");
    expect(projection.status).not.toBe("AMBIGUOUS");
    expect(projection.component.findings.some(finding => finding.findingKind === "ACTION_TARGET_CANDIDATE")).toBe(false);
  });
  it("rejects CROSS without its validated complete map-match predecessor", () => {
    const input = setup("cross-last");
    input.advanced.analysisEvidence.shift();
    const projection = projectPublicWorldAnalysis(input);
    expect(projection.component.findings.some(finding => finding.findingKind === "TEMPORAL_EVENT")).toBe(false);
    expect(projection.component.gaps[0]?.gapKind).toBe("UPSTREAM_CONTRACT_MISMATCH");
  });
  it("retains selected ranking source and exact action geometry within a smaller byte budget", () => {
    const input = setup("metric-shared-campus", true);
    const full = assemblePublicWorldAnalysisResult(input.base, projectPublicWorldAnalysis(input));
    const ranking = full.worldAnalysisFindings.findings.find(finding => finding.findingKind === "METRIC_RANKING");
    if (ranking?.findingKind !== "METRIC_RANKING") throw new Error("Missing ranking");
    const sourceCandidate = ranking.candidates[0]!;
    ranking.candidates = Array.from({ length: 60 }, (_, index) => ({ ...structuredClone(sourceCandidate), candidateId: index ? `extra-${index}` : sourceCandidate.candidateId, rank: index + 1 }));
    ranking.display = { returnedCount: 60, sourceCount: 60, truncated: false };
    // Remove the artificial source fixture menu; this test pins the action source.
    full.worldAnalysisFindings.choices = [];
    full.worldAnalysisFindings.findingSetHash = worldAnalysisFindingSetHash(full.worldAnalysisFindings);
    full.resultHash = worldAnalysisResultHash(full);
    expect(validate("result", full)).toEqual({ valid: true, errors: [] });
    const budget = Math.floor(Buffer.byteLength(JSON.stringify(full)) / 2);
    const bounded = boundPublicWorldAnalysisResult(full, { maxResultBytes: budget });
    expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(budget);
    expect(validate("result", bounded)).toEqual({ valid: true, errors: [] });
    const action = bounded.worldAnalysisFindings.findings.find(finding => finding.findingKind === "ACTION_TARGET_CANDIDATE");
    expect(action?.findingKind).toBe("ACTION_TARGET_CANDIDATE");
    if (action?.findingKind !== "ACTION_TARGET_CANDIDATE") throw new Error("Lost action");
    expect(action.target).toEqual(sourceCandidate.representativeVisitedPosition);
    expect(bounded.worldAnalysisFindings.findings.find(finding => finding.findingKind === "METRIC_RANKING")?.display.truncated).toBe(true);
    expect(full.worldAnalysisFindings.findings.find(finding => finding.findingKind === "METRIC_RANKING")?.display.truncated).toBe(false);
  });
  it("uses a compact valid gap when dependencies cannot fit, and an explicit error below that floor", () => {
    const input = setup("metric-shared-campus", true);
    const full = assemblePublicWorldAnalysisResult(input.base, projectPublicWorldAnalysis(input));
    const bounded = boundPublicWorldAnalysisResult(full, { maxResultBytes: 1600 });
    expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(1600);
    expect(bounded.worldAnalysisFindings.findings).toEqual([]);
    expect(bounded.worldAnalysisFindings.gaps[0]?.gapKind).toBe("RESULT_TRUNCATED");
    expect(validate("result", bounded).valid).toBe(true);
    expect(() => boundPublicWorldAnalysisResult(full, { maxResultBytes: 100 })).toThrow(WorldAnalysisResultTooLargeError);
  });
  it("preserves subrange, gaps, pause exclusions and provisional finalization without interpolation", () => {
    const input = setup("metric-shared-campus");
    const foundation = input.advanced.foundation!;
    const period = { start: "2026-09-01T08:03:00.000Z", end: "2026-09-01T08:04:00.000Z", bounds: "[)" as const };
    foundation.finding.status = "PARTIAL";
    foundation.finding.executionInterval!.pausedPeriods = [period];
    foundation.finding.trajectory!.excludedPeriods = [{ ...period, exclusionKind: "EXCLUDED_PAUSED_PHASE" }];
    foundation.finding.trajectory!.gaps = [{ ...period, gapKind: "UNKNOWN_GAP", reasonCodes: ["SOURCE_UNAVAILABLE"] }];
    foundation.finding.trajectory!.finalization.state = "PROVISIONAL";
    const projection = projectPublicWorldAnalysis({ context: input.context, contracts, foundation });
    const trace = projection.component.findings[0];
    expect(trace?.findingKind).toBe("HISTORICAL_TRACE");
    if (trace?.findingKind !== "HISTORICAL_TRACE") throw new Error("Missing trace");
    expect(trace.pausedPeriods).toEqual([period]);
    expect(trace.excludedPeriods[0]?.period).toEqual(period);
    expect(trace.trajectoryGaps[0]?.kind).toBe("UNKNOWN_GAP");
    expect(trace.coverage.finalizationState).toBe("PROVISIONAL");
    expect(projection.status).toBe("PARTIAL");
  });
  it("preserves off-network interpretation and does not manufacture road ReferenceProducts", () => {
    const input = setup("map-match");
    const projection = projectPublicWorldAnalysis(input);
    const road = projection.component.findings.find(finding => finding.findingKind === "ROAD_ASSOCIATION");
    if (road?.findingKind !== "ROAD_ASSOCIATION") throw new Error("Missing road");
    expect(road.networkRole).toBe("REFERENCE_MODEL_NOT_PHYSICAL_TRUTH");
    expect(road.offNetworkSegments.length).toBeGreaterThan(0);
    expect(road.lastConfirmedRoad?.absoluteFinalRoadClaimed).toBe(false);
    expect(input.context.referenceProducts.some(product => road.roadVisits.some(visit => visit.sourceFeatureId === product.productId))).toBe(false);
    const upstream = contracts.validateResult("trajectory.map-match", input.advanced.analysisEvidence[0]!.envelope.output.value);
    expect(road.offNetworkSegments.map(segment => segment.interpretationHint)).toEqual(upstream.offNetworkSegments.map(segment => segment.interpretationHint));
  });
  it("keeps series ambiguity explicit rather than merging measurements", () => {
    const input = setup("metric-ambiguous-series");
    const projection = projectPublicWorldAnalysis(input);
    expect(projection.status).toBe("AMBIGUOUS");
    expect(projection.component.choices[0]?.choiceKind).toBe("METRIC_SERIES_SELECTION");
    expect(projection.component.findings.some(finding => finding.findingKind === "ACTION_TARGET_CANDIDATE")).toBe(false);
    expect(validate("result", assemblePublicWorldAnalysisResult(input.base, projection)).valid).toBe(true);
  });
  it("retains FIRST uncertainty and its prefix blocker", () => {
    const input = setup("enter");
    const envelope = input.advanced.analysisEvidence[0]!.envelope;
    const events = contracts.validateResult("temporal-spatial.find-events", envelope.output.value);
    if (input.advanced.intent.analysis.kind !== "TEMPORAL_EVENT") throw new Error("Wrong fixture");
    input.advanced.intent.analysis.selection = { kind: "FIRST" };
    Object.assign(events, { status: "PARTIAL" });
    events.completeness.sourcePrefixComplete = false;
    events.completeness.completeForAllEvents = false;
    const blocker = { kind: "UPSTREAM_GAP" as const, range: { start: "2026-09-01T08:00:00Z", end: "2026-09-01T08:01:00Z" }, reasonCodes: ["SOURCE_PREFIX_INCOMPLETE"] };
    events.completeness.blockingPeriods = [blocker];
    events.selectionResult = { kind: "FIRST", selectedEventId: events.events[0]!.eventId, confirmed: false, reasonCode: "FIRST_EVENT_NOT_CERTAIN", blockingPeriods: [blocker] };
    reseal(envelope);
    const projection = projectPublicWorldAnalysis(input);
    const finding = projection.component.findings.find(item => item.findingKind === "TEMPORAL_EVENT");
    if (finding?.findingKind !== "TEMPORAL_EVENT") throw new Error(JSON.stringify(projection.component.gaps));
    expect(finding.selection?.confirmed).toBe(false);
    expect(finding.selection?.confirmationScope).toBe("NOT_CONFIRMED");
    expect(finding.selection?.blockingPeriods[0]?.kind).toBe("UPSTREAM_GAP");
    expect(projection.status).toBe("PARTIAL");
    expect(validate("result", assemblePublicWorldAnalysisResult(input.base, projection)).valid).toBe(true);
  });
  it("retains the selected LAST event and proof when only unrelated display entries exceed limits", () => {
    const input = setup("enter");
    const envelope = input.advanced.analysisEvidence[0]!.envelope;
    const events = contracts.validateResult("temporal-spatial.find-events", envelope.output.value);
    if (input.advanced.intent.analysis.kind !== "TEMPORAL_EVENT") throw new Error("Wrong fixture");
    input.advanced.intent.analysis.selection = { kind: "LAST" };
    const first = events.events[0]!;
    events.events = Array.from({ length: 120 }, (_, index) => ({ ...structuredClone(first), eventId: `tse_${analysisHash(index).slice(7, 39)}`, sequenceNo: index + 1 }));
    events.selectionResult = { kind: "LAST", selectedEventId: events.events[119]!.eventId, confirmed: true, reasonCode: "LAST_EVENT_CONFIRMED", blockingPeriods: [] };
    events.summary.detectedEventCount = 120;
    events.summary.returnedEventCount = 120;
    reseal(envelope);
    contracts.validateEnvelope("temporal-spatial.find-events", envelope);
    const projection = projectPublicWorldAnalysis(input);
    const finding = projection.component.findings.find(item => item.findingKind === "TEMPORAL_EVENT");
    if (finding?.findingKind !== "TEMPORAL_EVENT") throw new Error(JSON.stringify(projection.component.gaps));
    expect(finding.events).toHaveLength(100);
    expect(finding.events.some(event => event.eventId === finding.selection?.selectedEventId)).toBe(true);
    expect(finding.selection?.confirmed).toBe(true);
    expect(finding.display.truncated).toBe(true);
    expect(projection.status).toBe("COMPLETED");
    expect(validate("result", assemblePublicWorldAnalysisResult(input.base, projection)).valid).toBe(true);
  });
  it("changes both public hashes when a validated representative position changes", () => {
    const input = setup("metric-shared-campus", true);
    const before = assemblePublicWorldAnalysisResult(input.base, projectPublicWorldAnalysis(input));
    const envelope = input.advanced.analysisEvidence[0]!.envelope;
    const ranking = contracts.validateResult("spatiotemporal-metric.rank-locations", envelope.output.value);
    ranking.candidates[0]!.representativeVisitedPosition.coordinates[0] += 0.0001;
    reseal(envelope);
    const after = assemblePublicWorldAnalysisResult(input.base, projectPublicWorldAnalysis(input));
    expect(after.worldAnalysisFindings.findingSetHash).not.toBe(before.worldAnalysisFindings.findingSetHash);
    expect(after.resultHash).not.toBe(before.resultHash);
  });
  it("retains ambiguous network association as uncertainty, not an authoritative road reference", () => {
    const input = setup("map-match");
    const envelope = input.advanced.analysisEvidence[0]!.envelope;
    const map = contracts.validateResult("trajectory.map-match", envelope.output.value);
    const visit = map.roadVisits[0]!;
    const period = { start: visit.startTime, end: visit.endTime };
    map.ambiguousSegments.push({ ...period, sequenceNo: 1, segmentNo: 1, sampleCount: 1, candidateRoadFeatureReferenceIds: ["road-A", "road-B"], confidence: 0.4 });
    map.associationCompleteness.ambiguousPeriods.push(period);
    reseal(envelope);
    const projection = projectPublicWorldAnalysis(input);
    const finding = projection.component.findings.find(item => item.findingKind === "ROAD_ASSOCIATION");
    if (finding?.findingKind !== "ROAD_ASSOCIATION") throw new Error(JSON.stringify(projection.component.gaps));
    expect(finding.ambiguousSegments[0]?.candidateFeatureIds).toEqual(["road-A", "road-B"]);
    expect(finding.blockingPeriods.some(item => item.kind === "AMBIGUOUS_ASSOCIATION_PERIOD")).toBe(true);
    expect(validate("result", assemblePublicWorldAnalysisResult(input.base, projection)).valid).toBe(true);
  });
  it("does not project derived analysis from a conflicted foundation", () => {
    const input = setup("metric-shared-campus", true);
    input.advanced.foundation!.finding.status = "INDETERMINATE";
    input.advanced.foundation!.finding.trajectory!.finalization.state = "CONFLICTED";
    const projection = projectPublicWorldAnalysis(input);
    expect(projection.component.findings.map(finding => finding.findingKind)).toEqual(["HISTORICAL_TRACE"]);
    expect(projection.component.gaps[0]?.gapKind).toBe("HISTORICAL_DATA_INCOMPLETE");
    expect(projection.status).toBe("PARTIAL");
  });
  it.each(["ALL", "MULTIPLE_INTERVALS"])("rejects %s rather than merging execution scopes", mode => {
    const input = setup("metric-shared-campus", true);
    const foundation = input.advanced.foundation!;
    if (mode === "ALL") foundation.intent.executionSelection = { kind: "ALL", limit: 2 };
    else foundation.finding.executionIntervals = [foundation.finding.executionInterval!, { ...foundation.finding.executionInterval!, executionNo: 3 }];
    const projection = projectPublicWorldAnalysis(input);
    expect(projection.component.findings).toEqual([]);
    expect(projection.component.gaps[0]?.gapKind).toBe("MULTI_EXECUTION_UNSUPPORTED");
    expect(projection.evidenceItems).toEqual(input.context.evidenceItems);
  });
  it("rejects a metric concept not present in the trusted catalog", () => {
    const input = setup("metric-shared-campus", true);
    if (input.advanced.intent.analysis.kind !== "METRIC_RANKING") throw new Error("Wrong fixture");
    input.advanced.intent.analysis.metricConceptId = "MODEL_INVENTED_SCORE";
    const projection = projectPublicWorldAnalysis(input);
    expect(projection.component.gaps[0]?.gapKind).toBe("METRIC_UNSUPPORTED");
    expect(projection.component.findings.map(finding => finding.findingKind)).toEqual(["HISTORICAL_TRACE"]);
  });
  it("rejects Provider units that contradict the trusted metric catalog", () => {
    const input = setup("metric-shared-campus", true);
    const envelope = input.advanced.analysisEvidence[0]!.envelope;
    const ranking = contracts.validateResult("spatiotemporal-metric.rank-locations", envelope.output.value);
    ranking.metric.valueUnit = "percent";
    reseal(envelope);
    const projection = projectPublicWorldAnalysis(input);
    expect(projection.component.gaps[0]?.gapKind).toBe("UPSTREAM_CONTRACT_MISMATCH");
    expect(projection.component.findings.map(finding => finding.findingKind)).toEqual(["HISTORICAL_TRACE"]);
  });
});

describe("stable device identity across GOWM versions", () => {
  it.each(["map-match", "stop", "metric-shared-campus"])("projects %s across current and frozen device versions without rewriting evidence", name => {
    const input = setup(name);
    const before = structuredClone(input.advanced.analysisEvidence);
    const current = { ...input.advanced.foundation!.intent.subjectReferenceKey!, version: "9000" };
    input.advanced.foundation!.intent.subjectReferenceKey = current;
    const device = input.context.referenceProducts.find(p => p.referenceKey.id === current.id)!;
    device.referenceKey = { ...device.referenceKey, version: current.version };
    const result = projectPublicWorldAnalysis(input);
    expect(result.component.gaps.some(g => g.gapKind === "UPSTREAM_CONTRACT_MISMATCH" || g.gapKind === "REFERENCE_MISSING")).toBe(false);
    expect(result.component.findings.some(f => f.findingKind !== "HISTORICAL_TRACE")).toBe(true);
    expect(result.component.findings.every(f => f.subjectReferenceProductIds.includes(device.productId))).toBe(true);
    expect(input.advanced.analysisEvidence).toEqual(before);
    expect(device.referenceKey.version).toBe("9000");
  });
  it.each(["different_device", "trajectory_version", "lineage_device"])("retains %s consistency checks", kind => {
    const input = setup("stop");
    if (kind === "different_device") input.advanced.foundation!.intent.subjectReferenceKey = key("WORLD_OBJECT", "different-device");
    if (kind === "trajectory_version") input.advanced.foundation!.reference.referenceKey = {
      ...input.advanced.foundation!.reference.referenceKey, version: "999"
    };
    if (kind === "lineage_device") input.advanced.foundation!.finding.subjectReferenceKey = key("WORLD_OBJECT", "other-lineage-device");
    const result = projectPublicWorldAnalysis(input);
    expect(result.component.findings.some(f => f.findingKind === "TEMPORAL_EVENT")).toBe(false);
    expect(result.component.gaps.some(g => g.gapKind === "UPSTREAM_CONTRACT_MISMATCH")).toBe(true);
  });
});
