import { createHash } from "node:crypto";
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

const nonEntitySurfaces = new Set([
  "附近", "内", "哪里", "哪儿", "何处", "有哪些", "有什么", "什么", "哪些", "设备", "车辆", "道路", "道路要素"
]);
const canonicalReferenceKinds = new Set([
  "WORLD_OBJECT", "SPATIAL_OBJECT", "DATA_SCOPE", "DATASET", "LAYER", "LAYER_FEATURE",
  "QUERY_RESULT", "DERIVED_REFERENCE", "REFERENCE_SET", "OPERATIONAL_TASK"
]);

function stableIdentifier(prefix: string, value: unknown): string {
  return `${prefix}-${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex").slice(0, 24)}`;
}

function normalizedKind(raw: string): string | null {
  const value = raw.trim().toUpperCase().replace(/[ .-]+/gu, "_");
  if (canonicalReferenceKinds.has(value)) return value;
  if (["VEHICLE", "DEVICE", "SENSOR", "CAMERA", "TARGET", "OBJECT", "ENTITY"].includes(value)) return "WORLD_OBJECT";
  if (["ROAD", "STREET", "ZONE", "AREA", "REGION", "LOCATION", "PLACE", "FEATURE"].includes(value)) return "LAYER_FEATURE";
  return null;
}

function inferredKind(surfaceText: string): string[] {
  if (/号车$/u.test(surfaceText)) return ["WORLD_OBJECT"];
  if (/[路区]$/u.test(surfaceText)) return ["LAYER_FEATURE"];
  return [];
}

function namedEntityCandidates(sourceText: string): Array<{ surfaceText: string; start: number; end: number; expectedKinds: string[] }> {
  const patterns: Array<{ expression: RegExp; expectedKinds: string[] }> = [
    // Vehicle identifiers are bounded labels, not arbitrary preceding prose;
    // e.g. "为什么2号车..." must anchor "2号车", never "为什么2号车".
    { expression: /(?:[A-Za-z0-9]+|[一二三四五六七八九十百千]+)号车/gu, expectedKinds: ["WORLD_OBJECT"] },
    { expression: /[\p{L}\p{N}]+(?:大道|路|街)(?:东段|西段|南段|北段)?/gu, expectedKinds: ["LAYER_FEATURE"] },
    { expression: /[A-Za-z0-9一二三四五六七八九十]+区/gu, expectedKinds: ["LAYER_FEATURE"] }
  ];
  const values: Array<{ surfaceText: string; start: number; end: number; expectedKinds: string[] }> = [];
  for (const { expression, expectedKinds } of patterns) {
    for (const match of sourceText.matchAll(expression)) {
      let start = match.index;
      if (start === undefined || !match[0]) continue;
      let surfaceText = match[0];
      if (expectedKinds.includes("LAYER_FEATURE") && /(?:大道|路|街)(?:东段|西段|南段|北段)?$/u.test(surfaceText)) {
        const boundary = Math.max(...["与", "沿", "在", "从", "到", "的"].map((marker) => surfaceText.lastIndexOf(marker)));
        if (boundary >= 0) {
          start += boundary + 1;
          surfaceText = surfaceText.slice(boundary + 1);
        }
        const leadingAction = /^(?:请)?(?:查找|判断|获取|寻找|查询)/u.exec(surfaceText)?.[0] ?? "";
        start += leadingAction.length;
        surfaceText = surfaceText.slice(leadingAction.length);
        if (nonEntitySurfaces.has(surfaceText)) continue;
      }
      values.push({ surfaceText, start, end: start + surfaceText.length, expectedKinds });
    }
  }
  return values.sort((left, right) => left.start - right.start || right.end - left.end)
    .filter((value, index, all) => !all.slice(0, index).some((prior) => prior.start === value.start && prior.end === value.end));
}

/** Projects an untrusted model proposal into source-anchored, referentially closed semantics. */
export function stabilizeSemanticFrame(frame: WorldSemanticFrame, originalText: string): WorldSemanticFrame {
  const proposed = frame.mentions.filter((mention) =>
    originalText.slice(mention.span.start, mention.span.end) === mention.surfaceText &&
    !nonEntitySurfaces.has(mention.surfaceText.trim()) &&
    !/^[\p{P}\p{S}\s]+$/u.test(mention.surfaceText) &&
    !/^\d+(?:\.\d+)?\s*(?:公里|千米|km|米|m)$/iu.test(mention.surfaceText.trim())
  );
  const proposedCandidates = proposed.map((mention) => {
    const expectedKinds = [...new Set((mention.expectedKinds ?? []).flatMap((kind) => {
      const normalized = normalizedKind(kind);
      return normalized ? [normalized] : [];
    }))];
    return {
      surfaceText: mention.surfaceText,
      start: mention.span.start,
      end: mention.span.end,
      expectedKinds: expectedKinds.length > 0 ? expectedKinds : inferredKind(mention.surfaceText)
    };
  }).filter((mention) => mention.expectedKinds.length > 0);
  // Deterministic source forms are authoritative for reference kind. A model
  // proposal for the same span cannot reclassify a vehicle, road, or area.
  const candidates = [...namedEntityCandidates(originalText), ...proposedCandidates]
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .filter((value, index, all) => !all.slice(0, index).some((prior) => prior.start === value.start && prior.end === value.end));

  const mentions: WorldSemanticFrame["mentions"] = candidates.map((candidate) => ({
    mentionId: stableIdentifier("mention", [candidate.start, candidate.end, candidate.surfaceText]),
    surfaceText: candidate.surfaceText,
    span: { encoding: "UTF16_CODE_UNIT", start: candidate.start, end: candidate.end },
    expectedKinds: candidate.expectedKinds.length > 0 ? candidate.expectedKinds : inferredKind(candidate.surfaceText)
  }));
  const mentionBySpan = new Map(mentions.map((mention) => [`${mention.span.start}:${mention.span.end}`, mention]));
  const oldMentionIds = new Map<string, string>();
  for (const mention of proposed) {
    const stable = mentionBySpan.get(`${mention.span.start}:${mention.span.end}`);
    if (stable && !oldMentionIds.has(mention.mentionId)) oldMentionIds.set(mention.mentionId, stable.mentionId);
  }
  const rewriteArguments = (values: readonly string[]): string[] => [...new Set(values.flatMap((value) => {
    const rewritten = oldMentionIds.get(value);
    return rewritten ? [rewritten] : [];
  }))];

  const distance = /(?<value>\d+(?:\.\d+)?)\s*(?<unit>公里|千米|km|米|m)/iu.exec(originalText);
  const distanceM = distance?.groups
    ? Number(distance.groups["value"]) * (/^(?:公里|千米|km)$/iu.test(distance.groups["unit"] ?? "") ? 1_000 : 1)
    : undefined;
  const explicitSpatial: WorldSemanticFrame["spatialExpressions"] = [];
  for (const mention of mentions) {
    const suffix = originalText.slice(mention.span.end);
    const areaMention = (mention.expectedKinds ?? []).includes("LAYER_FEATURE");
    const operator = /^\s*附近/u.test(suffix) ? "NEAR"
      : /^\s*内/u.test(suffix) || (areaMention && /^\s*(?:有哪些|有什么)/u.test(suffix)) ? "WITHIN" : null;
    if (!operator) continue;
    explicitSpatial.push({
      expressionId: stableIdentifier("spatial", [operator, mention.mentionId, distanceM ?? null]),
      operator, arguments: [mention.mentionId],
      ...(distanceM !== undefined && Number.isFinite(distanceM) && distanceM > 0 ? { distanceM } : {}),
      approximate: false
    });
  }
  const proposedSpatial = frame.spatialExpressions.flatMap((expression) => {
    const arguments_ = rewriteArguments(expression.arguments);
    if (arguments_.length === 0) return [];
    return [{
      ...expression,
      expressionId: stableIdentifier("spatial", [expression.operator, arguments_, expression.distanceM ?? null]),
      arguments: arguments_
    }];
  });
  const sourceClaimsSpatialMeaning = /(?:附近|相交|穿过|\bnear\b|\bwithin\b|\bintersects?\b|\bbuffer\b)/iu.test(originalText);
  const spatialExpressions = explicitSpatial.length > 0 ? explicitSpatial : sourceClaimsSpatialMeaning ? proposedSpatial : [];

  const explicitRelations: WorldSemanticFrame["relationExpressions"] = [];
  if (/(?:在哪里|位置|当前状态)/u.test(originalText)) {
    for (const mention of mentions.slice(0, 1)) {
      explicitRelations.push({
        expressionId: stableIdentifier("relation", ["CURRENT_STATE", mention.mentionId]),
        relationType: "CURRENT_STATE", subjectMentionId: mention.mentionId
      });
    }
  }
  const semanticSubject = mentions[0]?.mentionId;
  const addSemanticRelation = (relationType: string): void => {
    if (!semanticSubject) return;
    explicitRelations.push({
      expressionId: stableIdentifier("relation", [relationType, semanticSubject]),
      relationType,
      subjectMentionId: semanticSubject
    });
  };
  if (/(?:地表覆盖|土地覆盖|land\s*cover)/iu.test(originalText)) addSemanticRelation("LAND_COVER_AT_LOCATION");
  if (/(?:湿地|wetlands?)/iu.test(originalText)) addSemanticRelation("FIND_WETLANDS");
  if (/(?:障碍物|obstacles?)/iu.test(originalText)) addSemanticRelation("FIND_OBSTACLES");
  if (/(?:不可通行区域|阻塞区域|blocked\s+areas?)/iu.test(originalText)) addSemanticRelation("FIND_BLOCKED_AREAS");
  if (/(?:高地|high\s+ground)/iu.test(originalText)) addSemanticRelation("FIND_HIGH_GROUND");
  if (/(?:高程|海拔|elevation)/iu.test(originalText)) addSemanticRelation("ELEVATION_AT_LOCATION");
  if (/(?:为什么.*通行性|通行性.*为什么|explain.*traversability)/iu.test(originalText)) {
    addSemanticRelation("EXPLAIN_TRAVERSABILITY");
  }
  if (/(?:可见性|视域|visibility|line\s+of\s+sight)/iu.test(originalText)) addSemanticRelation("VISIBILITY");
  if (/(?:洪水风险|淹没风险|flood\s+risk)/iu.test(originalText)) addSemanticRelation("FLOOD_RISK");
  if (/(?:地表材质|surface\s+material)/iu.test(originalText)) addSemanticRelation("SURFACE_MATERIAL");
  if (/(?:水体|surface\s+water)/iu.test(originalText)) addSemanticRelation("FIND_WATER");
  if (/(?:建筑物|buildings?)/iu.test(originalText)) addSemanticRelation("FIND_BUILDINGS");
  if (/(?:地形类别|terrain\s+class)/iu.test(originalText)) addSemanticRelation("TERRAIN_CLASS");
  const productPreference = /(?:使用|采用|use)\s*([a-z][a-z0-9-]{2,63})\s*(?:数据|data)?/iu.exec(originalText);
  if (productPreference?.[1]) addSemanticRelation(`EXPLICIT_PRODUCT_PREFERENCE:${productPreference[1].toLowerCase()}`);
  const proposedRelations = frame.relationExpressions.flatMap((expression) => {
    const subjectMentionId = oldMentionIds.get(expression.subjectMentionId);
    const objectMentionId = expression.objectMentionId ? oldMentionIds.get(expression.objectMentionId) : undefined;
    if (!subjectMentionId || (expression.objectMentionId && !objectMentionId)) return [];
    return [{
      ...expression,
      expressionId: stableIdentifier("relation", [expression.relationType, subjectMentionId, objectMentionId ?? null]),
      subjectMentionId,
      ...(objectMentionId ? { objectMentionId } : {})
    }];
  });
  const relationExpressions = explicitRelations.length > 0
    ? [...explicitRelations, ...proposedRelations]
      .filter((entry, index, values) => values.findIndex((candidate) => candidate.expressionId === entry.expressionId) === index)
    : proposedRelations;

  return validateSemanticFrame({
    schemaVersion: "1.0", mentions, spatialExpressions, relationExpressions,
    temporalConstraints: frame.temporalConstraints.map((entry, index) => ({
      ...entry, constraintId: stableIdentifier("temporal", [index, entry])
    })),
    aggregationExpressions: frame.aggregationExpressions.map((entry, index) => ({
      expressionId: stableIdentifier("aggregation", [index, entry]), operator: entry.operator
    })),
    rankingExpressions: frame.rankingExpressions.map((entry, index) => ({
      ...entry, expressionId: stableIdentifier("ranking", [index, entry])
    }))
  }, originalText);
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
