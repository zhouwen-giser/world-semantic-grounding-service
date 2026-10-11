import type {
  HistoricalExecutionSelection,
  HistoricalFindingComparison,
  HistoricalFollowupDecision,
  HistoricalPhaseScope,
  HistoricalQueryKind,
  HistoricalTraceConfiguration,
  HistoricalTraceFinding,
  HistoricalTraceIntent,
  PriorHistoricalResult
} from "./types.js";
import { hasUnsupportedHistoricalTimeWindow } from "./constraints.js";

const intervalPattern = /(?:什么时候(?:开始|结束|开始执行)|执行了多久|是否仍在执行|暂停过几次|实际?(?:执行|运行)时段|执行区间|执行记录)/u;
const trajectoryPattern = /(?:任务轨迹|执行轨迹|走过哪里|行驶路径|经过的位置|历史轨迹|轨迹是什么|轨迹是什麼)/u;
const completenessPattern = /(?:轨迹.*(?:完整|连续)|有没有缺失)/u;
const gapsPattern = /(?:(?:哪些|什么)时间.*没有轨迹|轨迹.*缺失时段|定位中断时间|有哪些缺失)/u;
const activeOnlyPattern = /(?:排除暂停|只看运行阶段|有效执行时段)/u;
const allPattern = /(?:所有执行(?:记录|轨迹)|历次执行)/u;
const latestPattern = /(?:本次|最近一次|这次)/u;
const taskPattern = /任务\s*(?:(?:ID|编号|引用)\s*[:：]?\s*|[:：]\s*)?[A-Za-z0-9_-]+/iu;
const subjectPattern = /(?:[A-Za-z0-9]+|[一二三四五六七八九十百千]+)号车/u;
const sourceKeyPattern = /\bsourceKey\s*[:：=]\s*([A-Za-z0-9._:/-]+)/iu;
const trackerSessionPattern = /\btrackerSessionKey\s*[:：=]\s*([A-Za-z0-9._:/-]+)/iu;

export function chineseInteger(value: string): number | null {
  if (/^[1-9][0-9]*$/u.test(value)) {
    const result = Number(value);
    return Number.isSafeInteger(result) && result <= 1_000_000 ? result : null;
  }
  const digits: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === "十") return 10;
  if (value.includes("十")) {
    const [tens, units] = value.split("十");
    const tensValue = tens ? digits[tens] : 1;
    const unitsValue = units ? digits[units] : 0;
    if (tensValue === undefined || unitsValue === undefined) return null;
    const result = tensValue * 10 + unitsValue;
    return Number.isSafeInteger(result) && result > 0 ? result : null;
  }
  return digits[value] ?? null;
}

export function executionSelection(text: string, allLimit: number): HistoricalExecutionSelection {
  if (allPattern.test(text)) return { kind: "ALL", limit: allLimit };
  const numbered = /第\s*([1-9][0-9]*|[一二三四五六七八九十]+)\s*(?:次|回)/u.exec(text);
  if (numbered?.[1]) {
    const executionNo = chineseInteger(numbered[1]);
    if (executionNo !== null) return { kind: "EXECUTION_NO", executionNo };
    throw new Error("HISTORICAL_EXECUTION_NUMBER_INVALID");
  }
  return { kind: "LATEST" };
}

function queryKind(text: string): HistoricalQueryKind | null {
  if (gapsPattern.test(text)) return "TRAJECTORY_GAPS";
  if (completenessPattern.test(text)) return "TRAJECTORY_COMPLETENESS";
  if (trajectoryPattern.test(text)) return "HISTORICAL_TRAJECTORY";
  if (intervalPattern.test(text)) return "EXECUTION_INTERVAL";
  return null;
}

export function projectHistoricalTraceIntent(
  text: string,
  configuration: Pick<HistoricalTraceConfiguration, "maximumInlinePoints" | "allIntervalsLimit">,
  temporalConstraints?: Parameters<typeof hasUnsupportedHistoricalTimeWindow>[1]
): HistoricalTraceIntent | null {
  const kind = queryKind(text);
  if (!kind) return null;
  const selection = executionSelection(text, configuration.allIntervalsLimit);
  const phaseScope: HistoricalPhaseScope = activeOnlyPattern.test(text)
    ? "ACTIVE_PHASES_ONLY"
    : "EXECUTION_ENVELOPE";
  const sourceKey = sourceKeyPattern.exec(text)?.[1];
  const trackerSessionKey = trackerSessionPattern.exec(text)?.[1];
  const unsupportedReason = hasUnsupportedHistoricalTimeWindow(text, temporalConstraints) ? "HISTORICAL_TIME_WINDOW_UNSUPPORTED" :
    !sourceKey && /sourceKey|trackerSessionKey|数据源|轨迹来源|切换来源|更换来源/iu.test(text) ? "HISTORICAL_SOURCE_SELECTION_UNSUPPORTED" : undefined;
  return {
    queryKind: kind,
    ...(unsupportedReason ? { unsupportedReason } : {}),
    ...(subjectPattern.exec(text)?.[0] ? { subjectMention: subjectPattern.exec(text)![0] } : {}),
    ...(taskPattern.exec(text)?.[0] ? { taskMention: taskPattern.exec(text)![0] } : {}),
    executionSelection: selection,
    phaseScope,
    sourceSelection: sourceKey ? { mode: "EXPLICIT_SOURCE", sourceKey, ...(trackerSessionKey ? { trackerSessionKey } : {}) } : { mode: "ONLY_CANDIDATE" },
    maximumInlinePoints: configuration.maximumInlinePoints
  };
}

export function resolveHistoricalFollowup(
  text: string,
  prior: PriorHistoricalResult | undefined,
  configuration: Pick<HistoricalTraceConfiguration, "maximumInlinePoints" | "allIntervalsLimit">,
  now: Date = new Date()
): HistoricalFollowupDecision {
  const projected = projectHistoricalTraceIntent(text, configuration);
  const updateRequested = /(?:现在更新了吗|更新了吗|有更新吗)/u.test(text);
  const activeOnlyRequested = activeOnlyPattern.test(text);
  if (!projected && !updateRequested && !activeOnlyRequested) return { mode: "NOT_HISTORICAL" };
  if (!prior) return projected ? { mode: "REQUERY", intent: projected, compareWithPrior: false } : { mode: "NOT_HISTORICAL" };
  const intent = projected ?? projectHistoricalTraceIntent(`${text} 历史轨迹`, configuration)!;
  const explicitExecution = allPattern.test(text) || latestPattern.test(text) || /第\s*[一二三四五六七八九十\d]+\s*(?:次|回)/u.test(text);
  const envelopeRequested = /(?:包含暂停|包括暂停|整个执行|完整执行时段)/u.test(text);
  const subjectChanged = Boolean(intent?.subjectMention && intent.subjectMention !== prior.intent?.subjectMention);
  const taskChanged = Boolean(intent?.taskMention && intent.taskMention !== prior.intent?.taskMention);
  const explicitSource = sourceKeyPattern.test(text) || trackerSessionPattern.test(text);
  const requeryIntent: HistoricalTraceIntent = {
    ...intent,
    ...(!explicitExecution && prior.intent ? { executionSelection: prior.intent.executionSelection } : {}),
    phaseScope: activeOnlyRequested ? "ACTIVE_PHASES_ONLY" : envelopeRequested ? "EXECUTION_ENVELOPE" : prior.phaseScope,
    sourceSelection: explicitSource && intent ? intent.sourceSelection : prior.intent?.sourceSelection ?? { mode: "ONLY_CANDIDATE" },
    ...(!taskChanged && !subjectChanged && prior.taskReferenceKey ? { taskReferenceKey: prior.taskReferenceKey } : {}),
    ...(!subjectChanged && !taskChanged && prior.subjectReferenceKey ? { subjectReferenceKey: prior.subjectReferenceKey } : {})
  };
  const expired = prior.reference?.validUntil !== undefined
    ? !Number.isFinite(Date.parse(prior.reference.validUntil)) || Date.parse(prior.reference.validUntil) <= now.getTime()
    : prior.reference?.revalidationRequired === true;
  const scopeChanged = subjectChanged || taskChanged || requeryIntent.phaseScope !== prior.phaseScope ||
    (explicitSource && (!prior.intent || JSON.stringify(requeryIntent.sourceSelection) !== JSON.stringify(prior.intent.sourceSelection))) ||
    (explicitExecution && (!prior.intent || JSON.stringify(requeryIntent.executionSelection) !== JSON.stringify(prior.intent.executionSelection)));
  if (!expired && !updateRequested && !scopeChanged && !requeryIntent.unsupportedReason && intent &&
      (intent.queryKind === "TRAJECTORY_COMPLETENESS" || intent.queryKind === "TRAJECTORY_GAPS")) {
    return { mode: "REUSE", queryKind: intent.queryKind, intent: requeryIntent, finding: structuredClone(prior.finding) };
  }
  return {
    mode: "REQUERY",
    intent: requeryIntent,
    compareWithPrior: updateRequested || expired
  };
}

export function compareHistoricalFindings(
  prior: HistoricalTraceFinding,
  current: HistoricalTraceFinding
): HistoricalFindingComparison {
  const priorInterval = prior.executionInterval;
  const currentInterval = current.executionInterval;
  const priorTrajectory = prior.trajectory;
  const currentTrajectory = current.trajectory;
  const values: Array<readonly [string, unknown, unknown]> = [
    ["status", prior.status, current.status],
    ["reasonCode", prior.reasonCode, current.reasonCode],
    ["executionInterval.version", priorInterval?.executionIntervalReferenceKey.version, currentInterval?.executionIntervalReferenceKey.version],
    ["executionInterval.revisionNo", priorInterval?.revisionNo, currentInterval?.revisionNo],
    ["trajectory.version", priorTrajectory?.trajectoryReferenceKey?.version, currentTrajectory?.trajectoryReferenceKey?.version],
    ["trajectory.finalization", priorTrajectory?.finalization.state, currentTrajectory?.finalization.state],
    ["trajectory.inputTrackletVersions", priorTrajectory?.inputTrackletVersions, currentTrajectory?.inputTrackletVersions]
  ];
  const changedFields = values
    .filter(([, left, right]) => JSON.stringify(left) !== JSON.stringify(right))
    .map(([field]) => field);
  return { changed: changedFields.length > 0, changedFields };
}

export function isExplicitLatestSelection(text: string): boolean {
  return latestPattern.test(text);
}
