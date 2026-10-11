/** GOWM selects task execution periods; arbitrary clipping has no admitted recipe. */
export function hasUnsupportedHistoricalTimeWindow(text: string, constraints: readonly {
  from?: string; to?: string; relativeExpression?: string;
}[] = []): boolean {
  const window = /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年|\d{1,2}月\d{1,2}[日号]|\d{1,2}[:：]\d{2}|\d{1,2}[点时](?:\d{1,2}分)?|今天|昨天|前天|明天|上午|下午|今晚|昨晚|凌晨|(?:过去|最近|近|前|后)\s*[一二三四五六七八九十百\d]+\s*(?:秒|分钟|小时|天|周|个月)|\b(?:since|until|between|today|yesterday|last\s+\d+\s+(?:minutes?|hours?|days?))\b/iu;
  if (window.test(text)) return true;
  return constraints.some(constraint => Boolean(constraint.from || constraint.to) ||
    Boolean(constraint.relativeExpression && !/^(?:(?:本次|这次|最近一次|第\s*[一二三四五六七八九十\d]+\s*次)?(?:任务|执行)(?:期间|时段)?|历史|刚才)$/u.test(constraint.relativeExpression.trim())));
}
