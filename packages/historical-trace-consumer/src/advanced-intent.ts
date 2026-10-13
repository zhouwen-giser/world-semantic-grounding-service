import { chineseInteger, projectHistoricalTraceIntent, explicitHistoricalPhaseScope, conflictingHistoricalPhaseScopes,
  historicalRefreshRequested, historicalScopeMentions, historicalAnalysisText } from "./intent.js";
import { analysisHash } from "@wsgs/gowm-contract-intake";
import { MAXIMUM_ADVANCED_ANALYSES } from "./advanced-types.js";
import type { MetricSemanticCatalog } from "./metric-semantic-catalog.js";
import type { AdvancedAnalysisIntent, AdvancedHistoricalIntent, AdvancedHistoryConfiguration, AdvancedIntentResolution } from "./advanced-types.js";

const number = "([1-9][0-9]*|[一二三四五六七八九十]+)";
interface SpatialMention { start: number; end: number; targetMention: string }
interface AnalysisClause { text: string; actions: string; targets: SpatialMention[] }

/** Source-anchored target names must not be interpreted as analysis verbs. */
function spatialMentions(text: string): SpatialMention[] {
  const targets: SpatialMention[] = [];
  for (const match of text.matchAll(/(?:进入|离开|在|靠近|经过)\s*([A-Za-z0-9\u4e00-\u9fff_-]+?)(区域|区|附近|停留)/gu)) {
    const name = match[1]!;
    // An interrogative or another clause is not an entity name.
    if (/哪里|哪些|哪个|什么时候|是什么|是否|有没有|.(?:并|和|以及|然后)(?:进入|离开|停车|停留|经过)/u.test(name)) continue;
    const targetMention = name + (["区域", "区"].includes(match[2]!) ? match[2] : "");
    const start = match.index! + match[0].indexOf(name, match[0].length - name.length - match[2]!.length);
    targets.push({ start, end: start + targetMention.length, targetMention });
  }
  for (const match of text.matchAll(/(?:进入|离开|在|靠近|经过)\s*[“"「]([^”"」\r\n]{1,128})[”"」]/gu)) {
    const name = match[1]!;
    const start = match.index! + match[0].lastIndexOf(name);
    targets.push({ start, end: start + name.length, targetMention: name });
  }
  return targets.sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((target, index, all) => !all.slice(0, index).some(old => old.start <= target.start && old.end >= target.end));
}

function analysisClauses(text: string, actions: string, targets: SpatialMention[]): AnalysisClause[] {
  const separator = /[,，;；。？！!?、]|以及|并且|同时|(?:并|和)(?=\s*(?:第|最|道路|哪|路口|停|进入|离开|靠近|在|通信|信号|RSSI|排名|回到|返回|前往|是否|有没有|能否|查询|统计|计算|检查))/gu;
  const clauses: AnalysisClause[] = [];
  let start = 0;
  const add = (end: number) => {
    if (text.slice(start, end).trim()) clauses.push({ text: text.slice(start, end).trim(), actions: actions.slice(start, end).trim(),
      targets: targets.filter(target => target.start >= start && target.end <= end) });
  };
  for (const match of actions.matchAll(separator)) { add(match.index!); start = match.index! + match[0].length; }
  add(text.length);
  return clauses;
}

function independentUnsupportedRequest(clause: string): boolean {
  // The shared foundation already supplies an explicitly requested trajectory.
  if (/^(?:[_\s]|请|先|再|同时|也|查询|查看|获取|给出|展示|显示|看看|的|本次|这次|最近一次)*(?:历史轨迹|任务轨迹|执行轨迹|行驶路径|走过哪里|经过的位置|轨迹是什么|轨迹是什麼)(?:是否|是不是|有没有|有哪些)?(?:完整|连续|缺失|缺失时段|缺口)?(?:[_\s]|呢|吗)*$/u.test(clause)) return false;
  const remainder = clause
    .replace(/\b(?:sourceKey|trackerSessionKey)\s*[:：=]\s*[A-Za-z0-9._:/-]+/giu, "")
    .replace(/(?:排除暂停|只看(?:实际)?(?:运行|执行)阶段|只看实际执行|有效执行时段|包含暂停|包括暂停|整个执行(?:时段)?|完整执行时段)/gu, "")
    .replace(/(?:现在)?(?:更新了吗|有更新吗|更新|重查|重新查询|重新|刷新)|\b(?:refresh|recompute)\b/giu, "")
    .replace(/本次|这次|最近一次|历史|刚才|任务|执行|期间|阶段|时段|之后|以后|然后|再看|看看|看一下|查一下|查询|查看|获取|给出|展示|显示|请问|麻烦|帮我|谢谢|你好|您好|请|先|再|也|的|后|呢/gu, "");
  // Only known scope/modifier text may disappear. Other clauses need a recipe
  // or a gap, even when an independent request uses a short imperative.
  return /[^_\s,:：;；。?？!！、“”"「」]/u.test(remainder);
}
export function advancedSelectionRank(text: string): number | undefined {
  const value = new RegExp(`第\\s*${number}\\s*个(?:位置)?`, "u").exec(text)?.[1];
  return value ? chineseInteger(value) ?? undefined : undefined;
}
export function parseAdvancedHistoricalIntent(text: string, catalog: MetricSemanticCatalog, config: AdvancedHistoryConfiguration,
  prior?: AdvancedHistoricalIntent): AdvancedIntentResolution {
  const explicitHistory = /任务|历史|经过|走过|驶离|离网|刚才|本次|最近一次|轨迹|路口|回到|返回/u.test(text);
  if (/(?:当前|现在|此刻).*(?:在哪|哪里|哪条|最好)|规划去/u.test(text) && !explicitHistory) return { status: "NOT_ADVANCED" };
  const targets = spatialMentions(text);
  let actions = text;
  for (const target of [...targets].reverse()) actions = actions.slice(0, target.start) + "_".repeat(target.end - target.start) + actions.slice(target.end);
  const all = /历次|所有执行|所有任务|全部任务/u.test(actions);
  if (all) return { status: "UNRESOLVED", reasonCode: "MULTI_EXECUTION_ADVANCED_ANALYSIS_NOT_SUPPORTED" };
  const scopeText = actions.replace(/第\s*(?:[1-9][0-9]*|[一二三四五六七八九十]+)\s*次(?!\s*(?:任务|执行))/gu, "");
  const projected = projectHistoricalTraceIntent(`${scopeText} 历史轨迹`, { maximumInlinePoints: 0, allIntervalsLimit: 1 })!;
  const { queryKind: _kind, maximumInlinePoints: _points, ...scope } = projected;
  const requestedPhase = explicitHistoricalPhaseScope(scopeText);
  actions = historicalAnalysisText(actions);
  const clauses = analysisClauses(text, actions, targets);
  const analyses: AdvancedAnalysisIntent[] = [];
  const unmatched: AnalysisClause[] = [];
  for (const clause of clauses) {
    const parsed = parseAnalysisClause(clause, catalog, config);
    if (typeof parsed === "string") return { status: "UNRESOLVED", reasonCode: parsed };
    if (parsed && !analyses.some(value => analysisHash(value) === analysisHash(parsed))) analyses.push(parsed);
    if (!parsed) unmatched.push(clause);
  }
  if (analyses.length > MAXIMUM_ADVANCED_ANALYSES) return { status: "UNRESOLVED", reasonCode: "ADVANCED_ANALYSIS_LIMIT_EXCEEDED" };
  if (analyses.length === 1 && /第一|首次|最早/u.test(actions) && /最后/u.test(actions)) return { status: "UNRESOLVED", reasonCode: "MULTI_ANALYSIS_NOT_SUPPORTED" };
  let analysis = analyses[0];
  if (!analysis && prior && (/第.*个|最后一个|使用\s*\S+/u.test(actions) || requestedPhase || historicalRefreshRequested(actions, true))) {
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
  const mentions = historicalScopeMentions(scopeText);
  if (Object.values(mentions).some(values => new Set(values.map(analysisHash)).size > 1) || conflictingHistoricalPhaseScopes(scopeText)) {
    return { status: "UNRESOLVED", reasonCode: "MULTI_ANALYSIS_SCOPE_MISMATCH" };
  }
  if (projected.unsupportedReason) return { status: "UNRESOLVED", reasonCode: projected.unsupportedReason };
  if (analyses.length && unmatched.some(clause => independentUnsupportedRequest(clause.actions))) {
    return { status: "UNRESOLVED", reasonCode: "ANALYSIS_CLAUSE_UNSUPPORTED" };
  }
  const historicalScope = { ...(prior?.historicalScope ?? scope),
      ...(scope.subjectMention ? { subjectMention: scope.subjectMention } : {}),
      ...(scope.taskMention ? { taskMention: scope.taskMention } : {}),
      ...(scope.sourceSelection.mode === "EXPLICIT_SOURCE" ? { sourceSelection: scope.sourceSelection } : {}),
      ...(mentions.executions.length ? { executionSelection: scope.executionSelection } : {}),
      ...(requestedPhase ? { phaseScope: requestedPhase } : {}) };
  const subjectChanged = scope.subjectMention && prior?.historicalScope.subjectMention !== scope.subjectMention;
  const taskChanged = scope.taskMention && prior?.historicalScope.taskMention !== scope.taskMention;
  if (subjectChanged || taskChanged) {
    delete historicalScope.subjectReferenceKey; delete historicalScope.taskReferenceKey;
    if (taskChanged && !scope.subjectMention) delete historicalScope.subjectMention;
    if (subjectChanged && !scope.taskMention) delete historicalScope.taskMention;
  }
  return { status: "PARSED", intent: { historicalScope, analysis, ...(analyses.length > 1 ? { additionalAnalyses: analyses.slice(1) } : {}) } };
}

function parseAnalysisClause(clause: AnalysisClause, catalog: MetricSemanticCatalog, config: AdvancedHistoryConfiguration): AdvancedAnalysisIntent | string | undefined {
  const text = clause.actions;
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
      const targetMention = clause.targets[0]?.targetMention;
      analysis = { kind: "TEMPORAL_EVENT", eventType, selection: /最后/u.test(text) ? { kind: "LAST" } : /第一|首次|最早/u.test(text) ? { kind: "FIRST" } : { kind: "ALL", limit: config.maximumEvents },
        ...(eventType !== "STOP" && targetMention ? { targetMention } : {}) };
    }
  }
  return analysis;
}
