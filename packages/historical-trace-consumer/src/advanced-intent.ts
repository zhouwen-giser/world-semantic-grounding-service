import { chineseInteger, projectHistoricalTraceIntent } from "./intent.js";
import { analysisHash } from "@wsgs/gowm-contract-intake";
import { MAXIMUM_ADVANCED_ANALYSES } from "./advanced-types.js";
import type { MetricSemanticCatalog } from "./metric-semantic-catalog.js";
import type { AdvancedAnalysisIntent, AdvancedHistoricalIntent, AdvancedHistoryConfiguration, AdvancedIntentResolution } from "./advanced-types.js";

const number = "([1-9][0-9]*|[一二三四五六七八九十]+)";
export function advancedSelectionRank(text: string): number | undefined {
  const value = new RegExp(`第\\s*${number}\\s*个(?:位置)?`, "u").exec(text)?.[1];
  return value ? chineseInteger(value) ?? undefined : undefined;
}
export function parseAdvancedHistoricalIntent(text: string, catalog: MetricSemanticCatalog, config: AdvancedHistoryConfiguration,
  prior?: AdvancedHistoricalIntent): AdvancedIntentResolution {
  const explicitHistory = /任务|历史|经过|走过|驶离|离网|刚才|本次|最近一次|轨迹|路口|回到|返回/u.test(text);
  if (/(?:当前|现在|此刻).*(?:在哪|哪里|哪条|最好)|规划去/u.test(text) && !explicitHistory) return { status: "NOT_ADVANCED" };
  const all = /历次|所有执行|所有任务|全部任务/u.test(text);
  if (all) return { status: "UNRESOLVED", reasonCode: "MULTI_EXECUTION_ADVANCED_ANALYSIS_NOT_SUPPORTED" };
  const scopeText = text.replace(/第\s*(?:[1-9][0-9]*|[一二三四五六七八九十]+)\s*次(?!任务|执行)/gu, "");
  const projected = projectHistoricalTraceIntent(`${scopeText} 历史轨迹`, { maximumInlinePoints: 0, allIntervalsLimit: 1 })!;
  const { queryKind: _kind, maximumInlinePoints: _points, ...scope } = projected;
  const active = /排除暂停|只看(?:实际)?运行阶段|只看实际执行/u.test(text);
  const clauses = text.split(/[,，;；。？！!?、]|以及|并且|同时|(?:并|和)(?=\s*(?:第|最|道路|哪|路口|停|进入|离开|靠近|在|通信|信号|RSSI|排名|回到|返回|前往))/gu).map(value => value.trim()).filter(Boolean);
  const analyses: AdvancedAnalysisIntent[] = [];
  for (const clause of clauses) {
    const parsed = parseAnalysisClause(clause, catalog, config);
    if (typeof parsed === "string") return { status: "UNRESOLVED", reasonCode: parsed };
    if (parsed && !analyses.some(value => analysisHash(value) === analysisHash(parsed))) analyses.push(parsed);
  }
  if (analyses.length > MAXIMUM_ADVANCED_ANALYSES) return { status: "UNRESOLVED", reasonCode: "ADVANCED_ANALYSIS_LIMIT_EXCEEDED" };
  if (analyses.length === 1 && /第一|首次|最早/u.test(text) && /最后/u.test(text)) return { status: "UNRESOLVED", reasonCode: "MULTI_ANALYSIS_NOT_SUPPORTED" };
  if (analyses.length > 1) {
    const scopes = clauses.map(clause => projectHistoricalTraceIntent(`${clause.replace(/第\s*(?:[1-9][0-9]*|[一二三四五六七八九十]+)\s*次(?!任务|执行)/gu, "")} 历史轨迹`, { maximumInlinePoints: 0, allIntervalsLimit: 1 })!);
    const distinct = (values: unknown[]) => new Set(values.filter(value => value !== undefined).map(analysisHash)).size > 1;
    if (distinct(scopes.map(value => value.subjectMention)) || distinct(scopes.map(value => value.taskMention?.replace(/\s/gu, ""))) ||
        distinct(scopes.map((value, index) => /第.*次(?:任务|执行)|本次|最近一次/u.test(clauses[index]!) ? value.executionSelection : undefined)) ||
        distinct(scopes.map(value => value.sourceSelection.mode === "EXPLICIT_SOURCE" ? value.sourceSelection : undefined)) ||
        /排除暂停|只看(?:实际)?运行阶段/u.test(text) && /包含暂停|包括暂停|整个执行时段/u.test(text)) {
      return { status: "UNRESOLVED", reasonCode: "MULTI_ANALYSIS_SCOPE_MISMATCH" };
    }
  }
  let analysis = analyses[0];
  if (!analysis && prior && /第.*个|最后一个|排除暂停|只看.*运行|更新了吗|使用\s*\S+/u.test(text)) {
    if (prior.additionalAnalyses?.length) return { status: "UNRESOLVED", reasonCode: "SELECTION_CONTEXT_REQUIRED" };
    analysis = structuredClone(prior.analysis);
    const rank = advancedSelectionRank(text);
    if (analysis.kind === "METRIC_RANKING" && rank) {
      if (rank > config.metricTopKMax) return { status: "UNRESOLVED", reasonCode: "METRIC_RANK_OUT_OF_RANGE" };
      analysis.selectedRank = rank; analysis.topK = Math.max(rank, analysis.topK);
      analysis.actionTargetRequested = /回到|返回|前往|^去|让.*去/u.test(text);
    }
    if (analysis.kind === "TEMPORAL_EVENT" && /最后一个/u.test(text)) analysis.selection = { kind: "LAST" };
  }
  if (!analysis) return { status: "NOT_ADVANCED" };
  if (projected.unsupportedReason) return { status: "UNRESOLVED", reasonCode: projected.unsupportedReason };
  const historicalScope = { ...(prior?.historicalScope ?? scope),
      ...(scope.subjectMention ? { subjectMention: scope.subjectMention } : {}),
      ...(scope.taskMention ? { taskMention: scope.taskMention } : {}),
      ...(scope.sourceSelection.mode === "EXPLICIT_SOURCE" ? { sourceSelection: scope.sourceSelection } : {}),
      ...(/第.*次(?:任务|执行)|本次|最近一次/u.test(text) ? { executionSelection: scope.executionSelection } : {}),
      ...(active ? { phaseScope: "ACTIVE_PHASES_ONLY" as const } : {}) };
  if (scope.subjectMention && prior?.historicalScope.subjectMention !== scope.subjectMention) delete historicalScope.subjectReferenceKey;
  if (scope.taskMention && prior?.historicalScope.taskMention !== scope.taskMention) delete historicalScope.taskReferenceKey;
  return { status: "PARSED", intent: { historicalScope, analysis, ...(analyses.length > 1 ? { additionalAnalyses: analyses.slice(1) } : {}) } };
}

function parseAnalysisClause(text: string, catalog: MetricSemanticCatalog, config: AdvancedHistoryConfiguration): AdvancedAnalysisIntent | string | undefined {
  let analysis: AdvancedAnalysisIntent | undefined;
  const ranking = /最好|最高|最低|最小|最大|排名|较好/u.test(text) && /位置|哪里|哪些|信号|通信|RSSI|丢包|时延|延迟|震动|定位质量/iu.test(text);
  const requested = [ranking, /路口/u.test(text), /道路|哪条路|离开路网|离网|驶离.*路网|没有.*小道|路网.*问题/u.test(text),
    /停车|停下/u.test(text), /停留/u.test(text), /进入/u.test(text), /离开(?!路网)/u.test(text), /靠近|附近/u.test(text)].filter(Boolean).length;
  // Do not guess the boundaries of clauses which have no explicit separator.
  if (requested > 1 || /第一|首次|最早/u.test(text) && /最后/u.test(text)) return "MULTI_ANALYSIS_NOT_SUPPORTED";
  if (ranking) {
    const resolved = catalog.resolve(text);
    if ("reasonCode" in resolved) return resolved.reasonCode;
    const top = new RegExp(`(?:前\\s*)?${number}\\s*个位置`, "u").exec(text)?.[1] ?? new RegExp(`前\\s*${number}\\s*个`, "u").exec(text)?.[1];
    const selectedRank = advancedSelectionRank(text);
    const topK = selectedRank ?? (top ? chineseInteger(top) : config.metricTopK);
    if (!topK || topK > config.metricTopKMax) return "METRIC_RANK_OUT_OF_RANGE";
    analysis = { kind: "METRIC_RANKING", metricConceptId: resolved.concept.conceptId, metricSelector: resolved.selector,
      metricSeriesSelection: { mode: "ONLY_CANDIDATE" }, topK,
      ...(selectedRank ? { selectedRank } : {}), actionTargetRequested: /回到|返回|前往|^去|让.*去/u.test(text) };
  } else if (/路口/u.test(text)) {
    analysis = { kind: "TEMPORAL_EVENT", eventType: "CROSS", selection: /最后/u.test(text) ? { kind: "LAST" } : /第一|首次|最早/u.test(text) ? { kind: "FIRST" } : { kind: "ALL", limit: config.maximumEvents } };
  } else if (/道路|哪条路|离开路网|离网|驶离.*路网|没有.*小道|路网.*问题/u.test(text)) {
    analysis = { kind: "ROAD_ASSOCIATION", output: /问题/u.test(text) ? "NETWORK_DATA_ISSUES" : /离网|离开路网|驶离|没有|无法|小道/u.test(text) ? "OFF_NETWORK_SEGMENTS" : /最后/u.test(text) ? "LAST_CONFIRMED_ROAD" : "ROAD_VISITS" };
  } else {
    const eventType = /停车|停下/u.test(text) ? "STOP" : /停留/u.test(text) ? "DWELL" : /进入/u.test(text) ? "ENTER" : /离开/u.test(text) ? "EXIT" : /靠近|附近/u.test(text) ? "PASS_NEAR" : undefined;
    if (eventType) {
      const targetMention = /(?:进入|离开|在|靠近|经过)\s*([A-Za-z0-9\u4e00-\u9fff_-]+?)(?:区|附近|停留)/u.exec(text)?.[1];
      analysis = { kind: "TEMPORAL_EVENT", eventType, selection: /最后/u.test(text) ? { kind: "LAST" } : /第一|首次|最早/u.test(text) ? { kind: "FIRST" } : { kind: "ALL", limit: config.maximumEvents },
        ...(eventType !== "STOP" && targetMention ? { targetMention: text.includes(`${targetMention}区`) ? `${targetMention}区` : targetMention } : {}) };
    }
  }
  return analysis;
}
