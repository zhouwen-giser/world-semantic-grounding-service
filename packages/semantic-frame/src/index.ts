import type { WorldSemanticFrame } from "@wsgs/contracts";

export const SEMANTIC_FRAME_VERSION = "world-semantic-frame/1.0" as const;

export class SemanticFrameValidationError extends Error {
  constructor(readonly code: string) {
    super(`WorldSemanticFrame is invalid: ${code}`);
  }
}

const isoTimestampParts = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:[Zz]|([+\-])(\d{2}):(\d{2}))$/u;

export function isExplicitIsoTimestamp(value: string): boolean {
  const match = isoTimestampParts.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  return day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59 && second <= 59 &&
    offsetHour <= 23 && offsetMinute <= 59 && Number.isFinite(Date.parse(value));
}

function splitsSurrogatePair(value: string, offset: number): boolean {
  if (offset <= 0 || offset >= value.length) return false;
  const previous = value.charCodeAt(offset - 1);
  const next = value.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

function assertUnique(values: readonly string[], code: string): void {
  if (new Set(values).size !== values.length) throw new SemanticFrameValidationError(code);
}

function assertExactSpan(originalText: string, mention: WorldSemanticFrame["mentions"][number]): void {
  const { start, end, encoding } = mention.span;
  if (
    encoding !== "UTF16_CODE_UNIT" || !Number.isInteger(start) || !Number.isInteger(end) ||
    start < 0 || end <= start || end > originalText.length ||
    splitsSurrogatePair(originalText, start) || splitsSurrogatePair(originalText, end) ||
    originalText.slice(start, end) !== mention.surfaceText
  ) {
    throw new SemanticFrameValidationError("MENTION_SPAN_MISMATCH");
  }
}

export function validateSemanticFrame(frame: WorldSemanticFrame, originalText: string): WorldSemanticFrame {
  if (frame.schemaVersion !== "1.0") throw new SemanticFrameValidationError("SCHEMA_VERSION");
  for (const mention of frame.mentions) assertExactSpan(originalText, mention);
  const mentionIds = frame.mentions.map((mention) => mention.mentionId);
  assertUnique(mentionIds, "DUPLICATE_MENTION_ID");
  const mentionIdSet = new Set(mentionIds);
  for (const mention of frame.mentions) {
    if (mention.anchorMentionId && !mentionIdSet.has(mention.anchorMentionId)) {
      throw new SemanticFrameValidationError("UNKNOWN_ANCHOR_MENTION");
    }
  }

  const expressionIds = [
    ...frame.spatialExpressions.map((entry) => entry.expressionId),
    ...frame.relationExpressions.map((entry) => entry.expressionId),
    ...frame.aggregationExpressions.map((entry) => entry.expressionId),
    ...frame.rankingExpressions.map((entry) => entry.expressionId),
    ...frame.temporalConstraints.map((entry) => entry.constraintId)
  ];
  assertUnique(expressionIds, "DUPLICATE_EXPRESSION_ID");
  const referableIds = new Set([...mentionIds, ...expressionIds]);
  for (const expression of frame.spatialExpressions) {
    if (!Number.isFinite(expression.distanceM ?? 1) || (expression.distanceM !== undefined && expression.distanceM <= 0) ||
      expression.arguments.some((id) => !referableIds.has(id))) {
      throw new SemanticFrameValidationError("INVALID_SPATIAL_EXPRESSION");
    }
  }
  for (const expression of frame.relationExpressions) {
    if (!mentionIdSet.has(expression.subjectMentionId) ||
      (expression.objectMentionId !== undefined && !mentionIdSet.has(expression.objectMentionId))) {
      throw new SemanticFrameValidationError("INVALID_RELATION_EXPRESSION");
    }
  }
  for (const constraint of frame.temporalConstraints) {
    if (!constraint.from && !constraint.to && !constraint.relativeExpression) {
      throw new SemanticFrameValidationError("EMPTY_TEMPORAL_CONSTRAINT");
    }
    if ((constraint.from && !isExplicitIsoTimestamp(constraint.from)) ||
      (constraint.to && !isExplicitIsoTimestamp(constraint.to))) {
      throw new SemanticFrameValidationError("INVALID_ABSOLUTE_TIME");
    }
    if (constraint.from && constraint.to && Date.parse(constraint.from) > Date.parse(constraint.to)) {
      throw new SemanticFrameValidationError("REVERSED_TEMPORAL_CONSTRAINT");
    }
  }
  for (const expression of frame.aggregationExpressions) {
    if (expression.targetExpressionId !== undefined && !referableIds.has(expression.targetExpressionId)) {
      throw new SemanticFrameValidationError("UNKNOWN_AGGREGATION_TARGET");
    }
  }
  return frame;
}
