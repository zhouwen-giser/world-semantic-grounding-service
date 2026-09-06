import { createHash } from "node:crypto";
import type { GroundingResult12 } from "@wsgs/contracts";
import { analysisHash, type MetricSeriesIdentity } from "@wsgs/gowm-contract-intake";
import { canReuseAdvancedFoundation } from "./advanced-executor.js";
import { publicWorldAnalysisEventId } from "./public-world-analysis.js";
import { advancedSelectionRank, parseAdvancedHistoricalIntent } from "./advanced-intent.js";
import type { MetricSemanticCatalog } from "./metric-semantic-catalog.js";
import type { AdvancedHistoricalExecutionResult, AdvancedHistoricalFoundation, AdvancedHistoricalIntent, AdvancedHistoryConfiguration, AdvancedIntentResolution } from "./advanced-types.js";

type Json = Record<string, unknown>;
export interface PriorAdvancedHistory {
  intent: AdvancedHistoricalIntent; foundation: AdvancedHistoricalFoundation;
  evidenceItems: Json[]; sourceGroundingId: string; sourceResultHash: string;
}
export interface AdvancedFollowup {
  resolution: AdvancedIntentResolution; reusableFoundation?: AdvancedHistoricalFoundation;
  reuse?: { findings: Json[]; source: PriorAdvancedHistory }; compare: boolean;
  prior?: PriorAdvancedHistory;
  publicReuse?: AdvancedHistoricalExecutionResult;
}

/** Called only after the stored Choice and its private checkpoint have been authorized. */
export function resolvePublicAdvancedFollowup(text: string, result: GroundingResult12, choiceId: string, candidateId: string,
  prior: AdvancedHistoricalExecutionResult, catalog: MetricSemanticCatalog, config: AdvancedHistoryConfiguration, now = Date.now()): AdvancedFollowup {
  const reject = (reasonCode: string): AdvancedFollowup => ({ resolution: { status: "UNRESOLVED", reasonCode }, compare: false });
  const choice = result.worldAnalysisFindings.choices.find(value => value.choiceId === choiceId);
  const candidate = choice?.candidates.find(value => value.candidateId === candidateId);
  if (!choice || !candidate) return reject("SELECTION_INVALID");
  const ordinals = (text.match(/第\s*(?:[1-9][0-9]*|[一二三四五六七八九十]+)\s*个/gu) ?? []).map(advancedSelectionRank);
  if (new Set(ordinals).size > 1) return reject("SELECTION_AMBIGUOUS");
  const parsed = parseAdvancedHistoricalIntent(text, catalog, config, prior.intent);
  if (parsed.status === "UNRESOLVED") return { resolution: parsed, compare: false };
  if (parsed.status === "NOT_ADVANCED" && !/选择|选中|就这个|这个位置|使用|第.*个|^use\b|^select\b|回到|返回|前往/iu.test(text)) return reject("SELECTION_AMBIGUOUS");
  const intent = structuredClone(parsed.status === "PARSED" ? parsed.intent : prior.intent);
  if ("referenceProductId" in candidate) {
    const product = result.referenceProducts.find(value => value.productId === candidate.referenceProductId);
    if (!product) return reject("SELECTION_INVALID");
    const targetAnalysis = intent.analysis.kind === "TEMPORAL_EVENT" && ["ENTER", "EXIT", "PASS_NEAR", "DWELL"].includes(intent.analysis.eventType) ? intent.analysis : undefined;
    const targetRole = targetAnalysis && (result.ambiguities.some(ambiguity => ambiguity.surfaceText === targetAnalysis.targetMention && ambiguity.candidateProductIds.includes(product.productId)) ||
      result.worldAnalysisFindings.findings.some(finding => finding.findingKind === "TEMPORAL_EVENT" && finding.events.some(event => event.target?.kind === "SPATIAL_TARGET" && event.target.referenceProductId === product.productId)));
    if (product.referenceKey.kind === "OPERATIONAL_TASK") {
      intent.historicalScope.taskReferenceKey = product.referenceKey;
      delete intent.historicalScope.taskMention;
    } else if (targetRole && targetAnalysis) {
      targetAnalysis.targetReferenceKey = product.referenceKey;
      targetAnalysis.targetMention = product.displayName;
    } else if (["ENTITY", "WORLD_OBJECT"].includes(product.referenceKey.kind)) {
      intent.historicalScope.subjectReferenceKey = product.referenceKey;
      delete intent.historicalScope.subjectMention;
    } else if (targetAnalysis) {
      targetAnalysis.targetReferenceKey = product.referenceKey;
      targetAnalysis.targetMention = product.displayName;
    } else return reject("SELECTION_AMBIGUOUS");
    if (intent.analysis.kind === "METRIC_RANKING") {
      delete intent.analysis.selectedRank;
      intent.analysis.actionTargetRequested = /回到|返回|前往|^去|让.*去/iu.test(text);
    }
    return { resolution: { status: "PARSED", intent }, compare: false };
  }
  if (!prior.foundation) return reject("SELECTION_INVALID");
  const compare = /更新|重查|重新|最新|最近一次|本次|第.*次(?:任务|执行)|refresh|recompute/iu.test(text);
  const ordinal = advancedSelectionRank(text);
  if (ordinal !== undefined && ("rank" in candidate ? ordinal !== candidate.rank : choice.candidates.findIndex(value => value.candidateId === candidateId) + 1 !== ordinal)) return reject("SELECTION_AMBIGUOUS");
  if (choice.choiceKind === "EVENT_SELECTION" && "eventId" in candidate && intent.analysis.kind === "TEMPORAL_EVENT" && prior.intent.analysis.kind === "TEMPORAL_EVENT") {
    const reusable = !compare && canReuseAdvancedFoundation(prior.foundation, intent, now);
    const followup: AdvancedFollowup = { resolution: { status: "PARSED", intent }, compare, ...(reusable ? { reusableFoundation: prior.foundation } : {}) };
    if (!reusable || analysisHash(intent.analysis) !== analysisHash(prior.intent.analysis)) return followup;
    const sourceFinding = result.worldAnalysisFindings.findings.find(value => value.findingId === candidate.findingId);
    if (sourceFinding?.findingKind !== "TEMPORAL_EVENT" || !sourceFinding.events.some(event => event.eventId === candidate.eventId)) return reject("SELECTION_INVALID");
    for (const source of prior.analysisEvidence) {
      if (source.operationId !== "temporal-spatial.find-events" || !("events" in source.envelope.output.value)) continue;
      const sourceHash = source.envelope.execution.resultHash;
      const selected = source.envelope.output.value.events.find(event => publicWorldAnalysisEventId(result.groundingId, sourceHash, event.eventId) === candidate.eventId);
      if (selected) {
        followup.publicReuse = { ...structuredClone(prior), intent, publicEventSelection: { sourceResultHash: sourceHash, eventId: selected.eventId } };
        return followup;
      }
    }
    return reject("SELECTION_INVALID");
  }
  if (intent.analysis.kind !== "METRIC_RANKING" || prior.intent.analysis.kind !== "METRIC_RANKING") return reject("SELECTION_AMBIGUOUS");
  intent.analysis.actionTargetRequested = /回到|返回|前往|^去|让.*去/iu.test(text);
  const sameMetric = intent.analysis.metricConceptId === prior.intent.analysis.metricConceptId && analysisHash(intent.analysis.metricSelector) === analysisHash(prior.intent.analysis.metricSelector);
  const catalogChanged = prior.findings.some(finding => object(finding["metricCatalog"]) && finding["metricCatalog"]["hash"] !== catalog.hash);
  const reusable = !compare && canReuseAdvancedFoundation(prior.foundation, intent, now);
  const followup: AdvancedFollowup = { resolution: { status: "PARSED", intent }, compare,
    ...(reusable ? { reusableFoundation: prior.foundation } : {}) };
  if (choice.choiceKind === "METRIC_SERIES_SELECTION" && "series" in candidate) {
    intent.analysis.metricSeriesSelection = { mode: "EXPLICIT_SERIES", sourceKey: candidate.series.sourceKey, datastreamKey: candidate.series.datastreamKey, measurementKey: candidate.series.measurementKey };
    delete intent.analysis.selectedRank;
    return followup;
  }
  if (choice.choiceKind !== "RANKED_LOCATION_SELECTION" || !("rank" in candidate)) return reject("SELECTION_AMBIGUOUS");
  if (!sameMetric || !reusable || catalogChanged || analysisHash(intent.analysis.metricSeriesSelection) !== analysisHash(prior.intent.analysis.metricSeriesSelection)) {
    if (ordinal === undefined) delete intent.analysis.selectedRank;
    else intent.analysis.selectedRank = ordinal;
    return followup;
  }
  intent.analysis.selectedRank = candidate.rank;
  const ranking = result.worldAnalysisFindings.findings.find(value => value.findingId === candidate.findingId);
  if (ranking?.findingKind !== "METRIC_RANKING" || !ranking.candidates.some(value => value.candidateId === candidateId && value.rank === candidate.rank)) return reject("SELECTION_INVALID");
  followup.publicReuse = { ...structuredClone(prior), intent };
  return followup;
}
function object(value: unknown): value is Json { return !!value && typeof value === "object" && !Array.isArray(value); }

// Only invoke on server-owned result_bytes after an actor/data-scope restricted
// lookup. Client context payloads are never accepted by this decoder.
export function decodeStoredAdvancedHistory(bytes: Buffer, storedHash: string, expectedHash: string,
  selectedProductIds: readonly string[]): PriorAdvancedHistory | undefined {
  const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (storedHash !== expectedHash || actual !== expectedHash) throw new Error("HISTORICAL_PRIOR_RESULT_HASH_MISMATCH");
  const result: unknown = JSON.parse(bytes.toString("utf8"));
  if (!object(result) || !Array.isArray(result["evidenceItems"])) return undefined;
  const items = result["evidenceItems"].filter(object).filter(item => item["productKind"] === "CAPABILITY_RESULT" &&
    selectedProductIds.includes(String(item["evidenceProductId"])) && object(item["safePayload"]) &&
    typeof item["safePayload"]["findingKind"] === "string" && String(item["safePayload"]["findingKind"]).startsWith("HISTORICAL_"));
  const contexts = items.map(item => (item["safePayload"] as Json)["queryContext"]).filter(object)
    .filter(ctx => object(ctx["intent"]) && object(ctx["foundation"]));
  if (!contexts.length) return undefined;
  if (new Set(contexts.map(ctx => analysisHash(ctx["intent"]))).size !== 1) throw new Error("HISTORICAL_PRIOR_RESULT_AMBIGUOUS");
  const context = contexts[0]!;
  const foundation = context["foundation"] as unknown as AdvancedHistoricalFoundation;
  if (context["foundationHash"] !== analysisHash(foundation)) return undefined;
  if (!foundation.reference?.referenceKey || !foundation.intent || !foundation.finding?.trajectory ||
      !["COMPLETED", "PARTIAL"].includes(foundation.finding.status) || foundation.finding.trajectory.finalization.state === "CONFLICTED" ||
      analysisHash(foundation.reference.referenceKey) !== analysisHash(foundation.finding.trajectory.trajectoryReferenceKey)) return undefined;
  return { intent: context["intent"] as unknown as AdvancedHistoricalIntent, foundation,
    evidenceItems: items, sourceGroundingId: String(result["groundingId"]), sourceResultHash: actual };
}

export function resolveAdvancedFollowup(text: string, prior: PriorAdvancedHistory, catalog: MetricSemanticCatalog,
  config: AdvancedHistoryConfiguration, now = Date.now()): AdvancedFollowup {
  const resolution = parseAdvancedHistoricalIntent(text, catalog, config, { ...prior.intent,
    historicalScope: { ...prior.intent.historicalScope, ...prior.foundation.intent } });
  const compare = /更新了吗|有更新/u.test(text);
  if (resolution.status !== "PARSED") return { resolution, compare };
  const intent = resolution.intent;
  const reusable = !compare && canReuseAdvancedFoundation(prior.foundation, intent, now);
  const result: AdvancedFollowup = { resolution, compare, prior, ...(reusable ? { reusableFoundation: prior.foundation } : {}) };
  const payloads = prior.evidenceItems.map(item => item["safePayload"]).filter(object);
  const rank = payloads.find(payload => payload["findingKind"] === "HISTORICAL_METRIC_RANKING");
  if (rank && object(rank["metricCatalog"]) && rank["metricCatalog"]["hash"] !== catalog.hash) {
    return { resolution: { status: "UNRESOLVED", reasonCode: "METRIC_CATALOG_CHANGED" }, compare: false };
  }
  if (intent.analysis.kind === "METRIC_RANKING" && rank && /使用\s*\S+/u.test(text)) {
    const selected = /使用\s*([^\s。？?]+)/u.exec(text)?.[1];
    const candidates = Array.isArray(rank["metricSeriesCandidates"]) ? rank["metricSeriesCandidates"].filter(object) : [];
    const matches = candidates.filter(candidate => {
      const identity = candidate["identity"];
      return object(identity) && ["sourceKey", "datastreamKey", "measurementKey"].some(key => identity[key] === selected);
    });
    if (matches.length !== 1) return { resolution: { status: "UNRESOLVED", reasonCode: "METRIC_SERIES_AMBIGUOUS" }, compare: false };
    const identity = matches[0]!["identity"] as unknown as MetricSeriesIdentity;
    intent.analysis.metricSeriesSelection = { mode: "EXPLICIT_SERIES", sourceKey: identity.sourceKey,
      datastreamKey: identity.datastreamKey, measurementKey: identity.measurementKey };
    return result;
  }
  if (!reusable) return result;
  if (intent.analysis.kind === "METRIC_RANKING" && rank && prior.intent.analysis.kind === "METRIC_RANKING" &&
    analysisHash(intent.analysis.metricSelector) === analysisHash(prior.intent.analysis.metricSelector) &&
    analysisHash(intent.analysis.metricSeriesSelection) === analysisHash(prior.intent.analysis.metricSeriesSelection) &&
    intent.analysis.selectedRank && Array.isArray(rank["candidates"])) {
    const selectedRank = intent.analysis.selectedRank;
    const selected = rank["candidates"].filter(object).find(candidate => candidate["rank"] === selectedRank);
    if (!selected || !["COMPLETED", "PARTIAL"].includes(String(rank["status"]))) return result;
    const findings: Json[] = [{ ...rank, candidates: [selected], queryContext: { intent, foundation: prior.foundation, foundationHash: analysisHash(prior.foundation) } }];
    if (intent.analysis.actionTargetRequested) {
      findings.push({ findingKind: "HISTORICAL_ACTION_TARGET_CANDIDATE", status: rank["status"], candidateDomain: "PAST_OBSERVED_LOCATIONS",
        position: selected["position"], sourceRank: selected["rank"], metric: { conceptId: intent.analysis.metricConceptId,
          observedProperty: intent.analysis.metricSelector.observedProperty, value: selected["representativeValue"],
          ...(intent.analysis.metricSelector.valueUnit ? { unit: intent.analysis.metricSelector.valueUnit } : {}),
          optimizationDirection: intent.analysis.metricSelector.optimizationDirection },
        sourceAnalysisId: rank["analysisId"], sourceTrajectoryReferenceKey: prior.foundation.reference.referenceKey,
        representativeMeasurementId: selected["representativeMeasurementId"], representativeObservedAt: selected["observedAt"],
        currentValidationRequired: true, routePlanningRequired: true, executionAuthorized: false,
        warnings: ["CURRENT_VALIDATION_REQUIRED", "ROUTE_PLANNING_REQUIRED", "EXECUTION_NOT_AUTHORIZED"],
        queryContext: { intent, foundation: prior.foundation, foundationHash: analysisHash(prior.foundation) } });
    }
    result.reuse = { findings, source: prior };
  }
  const events = payloads.find(payload => payload["findingKind"] === "HISTORICAL_TEMPORAL_EVENT");
  if (intent.analysis.kind === "TEMPORAL_EVENT" && intent.analysis.selection.kind === "LAST" && events &&
    prior.intent.analysis.kind === "TEMPORAL_EVENT" && intent.analysis.eventType === prior.intent.analysis.eventType &&
    intent.analysis.targetMention === prior.intent.analysis.targetMention &&
    events["truncated"] !== true && object(events["summary"]) && events["summary"]["truncated"] === false &&
    object(events["completeness"]) && events["completeness"]["sourceSuffixComplete"] === true &&
    events["completeness"]["completeForAllEvents"] === true && Array.isArray(events["events"]) && events["events"].length > 0) {
    const selected = events["events"].at(-1) as Json;
    result.reuse = { source: prior, findings: [{ ...events, events: [selected],
      selection: { kind: "LAST", selectedEventId: selected["eventId"], confirmed: true, reasonCode: "LAST_EVENT_CONFIRMED", blockingPeriods: [] },
      queryContext: { intent, foundation: prior.foundation, foundationHash: analysisHash(prior.foundation) } }] };
  }
  return result;
}
