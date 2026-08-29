import { createHash } from "node:crypto";

import { isValidCell } from "h3-js";

import type {
  DeterministicParseResult,
  DistanceSourceUnit,
  MapSelectionInput,
  ParseAmbiguity,
  ParseInput,
  ParsedAbsoluteTimeConstraint,
  ParsedCandidate,
  ParsedDistance,
  ParsedMention,
  ReferenceKey,
  ModelSpanMention,
  TextSpan
} from "./types.js";

const h3Pattern = /(?<![0-9a-f])8[0-9a-f]{14}(?![0-9a-f])/giu;
const coordinatePattern = /(?:坐标|coordinates?)\s*[:：]?\s*\(?\s*(-?\d{1,3}(?:\.\d+)?)\s*[,，]\s*(-?\d{1,2}(?:\.\d+)?)\s*\)?/giu;
const codePattern = /(?:设备|对象|device|object)?\s*(?:编码|编号|code)\s*[:：#]?\s*([A-Za-z][A-Za-z0-9._-]{1,63})/giu;
const distancePattern = /(?<![A-Za-z0-9.+\-])(\d{1,9}(?:\.\d{1,6})?)\s*(公里|千米|kilometres?|kilometers?|km|米|metres?|meters?|m)(?![A-Za-z])/giu;
const isoTimestampSource = "(?:\\d{4}-\\d{2}-\\d{2}[Tt]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:[Zz]|[+\\-]\\d{2}:\\d{2}))";
const isoTimestampParts = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:[Zz]|([+\-])(\d{2}):(\d{2}))$/u;
const wktPattern = /^(?:POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON)\s*\(/iu;
const referenceIdPattern = /^wrf_[0-9a-f]{32}$/u;

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function assertValidUtf16Span(originalText: string, span: TextSpan, surfaceText?: string): string {
  if (span.encoding !== "UTF16_CODE_UNIT") throw new Error("Text span encoding must be UTF16_CODE_UNIT");
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > originalText.length) {
    throw new Error("Text span is outside the UTF-16 source bounds");
  }
  if (splitsSurrogatePair(originalText, span.start) || splitsSurrogatePair(originalText, span.end)) {
    throw new Error("Text span splits a UTF-16 surrogate pair");
  }
  const slice = originalText.slice(span.start, span.end);
  if (surfaceText !== undefined && slice !== surfaceText) throw new Error("Text span does not match surfaceText");
  return slice;
}

function splitsSurrogatePair(value: string, offset: number): boolean {
  if (offset <= 0 || offset >= value.length) return false;
  const previous = value.charCodeAt(offset - 1);
  const next = value.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

function isReferenceKey(value: unknown): value is ReferenceKey {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 4 &&
    candidate["namespace"] === "gowm" &&
    typeof candidate["kind"] === "string" &&
    candidate["kind"].length >= 1 && candidate["kind"].length <= 64 &&
    typeof candidate["id"] === "string" &&
    referenceIdPattern.test(candidate["id"]) &&
    typeof candidate["version"] === "string" &&
    candidate["version"].length >= 1 && candidate["version"].length <= 128
  );
}

function assertReferenceKey(value: unknown): asserts value is ReferenceKey {
  if (!isReferenceKey(value)) throw new Error("ReferenceKey does not satisfy the frozen northbound contract");
}

function normalizeDistanceUnit(unit: string): DistanceSourceUnit {
  if (unit === "公里" || unit === "千米") return "公里";
  if (unit === "米") return "米";
  return unit.toLowerCase().startsWith("k") ? "km" : "m";
}

function distanceMillimetres(decimal: string, unit: DistanceSourceUnit): number | null {
  const [whole = "", fraction = ""] = decimal.split(".");
  const scaleDigits = unit === "km" || unit === "公里" ? 6 : 3;
  if (fraction.replace(/0+$/u, "").length > scaleDigits) return null;
  const multiplier = 10n ** BigInt(scaleDigits);
  const fractionValue = BigInt((fraction + "0".repeat(scaleDigits)).slice(0, scaleDigits) || "0");
  const value = BigInt(whole) * multiplier + fractionValue;
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

function parseDistances(originalText: string): ParsedDistance[] {
  const values: ParsedDistance[] = [];
  for (const match of originalText.matchAll(distancePattern)) {
    const decimal = match[1];
    const rawUnit = match[2];
    if (!decimal || !rawUnit) continue;
    const sourceUnit = normalizeDistanceUnit(rawUnit);
    const millimetres = distanceMillimetres(decimal, sourceUnit);
    if (millimetres === null) continue;
    const span: TextSpan = { encoding: "UTF16_CODE_UNIT", start: match.index, end: match.index + match[0].length };
    const surfaceText = assertValidUtf16Span(originalText, span);
    values.push({
      distanceId: stableId("distance", `${span.start}:${span.end}:${millimetres}`),
      surfaceText,
      span,
      millimetres,
      sourceUnit
    });
  }
  if (values.length > 32) throw new Error("Deterministic distance limit exceeded");
  return values;
}

function isValidIsoTimestamp(value: string): boolean {
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

function parseAbsoluteTimeConstraints(originalText: string): ParsedAbsoluteTimeConstraint[] {
  const ranges = new RegExp(`(${isoTimestampSource})\\s*\\/\\s*(${isoTimestampSource})`, "giu");
  const instants = new RegExp(isoTimestampSource, "giu");
  const values: ParsedAbsoluteTimeConstraint[] = [];
  const occupied: TextSpan[] = [];
  for (const match of originalText.matchAll(ranges)) {
    const from = match[1];
    const to = match[2];
    if (!from || !to || !isValidIsoTimestamp(from) || !isValidIsoTimestamp(to) || Date.parse(from) > Date.parse(to)) continue;
    const span: TextSpan = { encoding: "UTF16_CODE_UNIT", start: match.index, end: match.index + match[0].length };
    const surfaceText = assertValidUtf16Span(originalText, span);
    occupied.push(span);
    values.push({
      constraintId: stableId("time", `${span.start}:${span.end}:${from}:${to}`),
      surfaceText,
      span,
      kind: "RANGE",
      from,
      to
    });
  }
  for (const match of originalText.matchAll(instants)) {
    if (!isValidIsoTimestamp(match[0])) continue;
    const span: TextSpan = { encoding: "UTF16_CODE_UNIT", start: match.index, end: match.index + match[0].length };
    if (occupied.some((range) => span.start < range.end && range.start < span.end)) continue;
    const surfaceText = assertValidUtf16Span(originalText, span);
    values.push({
      constraintId: stableId("time", `${span.start}:${span.end}:${match[0]}`),
      surfaceText,
      span,
      kind: "INSTANT",
      from: match[0]
    });
  }
  if (values.length > 16) throw new Error("Deterministic absolute-time limit exceeded");
  return values.sort((left, right) => left.span.start - right.span.start || right.span.end - left.span.end);
}

function mention(
  originalText: string,
  start: number,
  end: number,
  expectedKinds: string[],
  extractionSource: ParsedMention["extractionSource"],
  priority: number,
  candidate: ParsedCandidate
): ParsedMention {
  const span: TextSpan = { encoding: "UTF16_CODE_UNIT", start, end };
  const surfaceText = assertValidUtf16Span(originalText, span);
  return {
    // The candidate identity is part of the mention identity. Two same-span
    // references may have the same alias and kind while naming different
    // immutable world objects; collapsing their IDs makes the ambiguity graph
    // emit duplicate edges and loses the distinction between candidates.
    mentionId: stableId("mention", `${start}:${end}:${surfaceText}:${stableJson(candidate)}`),
    surfaceText,
    span,
    expectedKinds,
    extractionSource,
    priority,
    candidate
  };
}

function findMapSurface(originalText: string, selection: MapSelectionInput): { start: number; end: number } | null {
  const candidates = [selection.label, "标注区域", "选择区域", "selected area", "map selection"].filter(
    (value): value is string => Boolean(value)
  );
  for (const value of candidates) {
    const start = originalText.indexOf(value);
    if (start >= 0) return { start, end: start + value.length };
  }
  return null;
}

function parseFocusSpan(originalText: string, span: TextSpan): ParsedMention | null {
  const surface = assertValidUtf16Span(originalText, span).trim();
  const trimOffset = assertValidUtf16Span(originalText, span).indexOf(surface);
  const start = span.start + trimOffset;
  const end = start + surface.length;
  try {
    const parsed = JSON.parse(surface) as unknown;
    if (isReferenceKey(parsed)) {
      return mention(originalText, start, end, [parsed.kind], "DETERMINISTIC", 200, {
        kind: "REFERENCE_KEY_OBJECT",
        value: parsed,
        approximate: false,
        requiresUpstreamValidation: true,
        referenceKey: parsed
      });
    }
    if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>)["type"] === "string" && "coordinates" in parsed) {
      return mention(originalText, start, end, ["GEOMETRY"], "DETERMINISTIC", 200, {
        kind: "GEOMETRY_CANDIDATE",
        value: parsed,
        approximate: false,
        requiresUpstreamValidation: true
      });
    }
  } catch {
    if (wktPattern.test(surface)) {
      return mention(originalText, start, end, ["GEOMETRY"], "DETERMINISTIC", 200, {
        kind: "GEOMETRY_CANDIDATE",
        value: { format: "WKT", text: surface },
        approximate: false,
        requiresUpstreamValidation: true
      });
    }
  }
  return null;
}

function overlaps(left: ParsedMention, right: ParsedMention): boolean {
  return left.span.start < right.span.end && right.span.start < left.span.end;
}

function selectMentions(candidates: ParsedMention[]): { mentions: ParsedMention[]; ambiguities: ParseAmbiguity[] } {
  const ordered = [...candidates].sort(
    (left, right) => right.priority - left.priority || (right.span.end - right.span.start) - (left.span.end - left.span.start) || left.span.start - right.span.start
  );
  const mentions: ParsedMention[] = [];
  const ambiguities: ParseAmbiguity[] = [];
  for (const candidate of ordered) {
    const conflicting = mentions.find((accepted) => overlaps(candidate, accepted));
    if (!conflicting) {
      mentions.push(candidate);
      continue;
    }
    if (
      candidate.span.start === conflicting.span.start &&
      candidate.span.end === conflicting.span.end &&
      JSON.stringify(candidate.candidate) === JSON.stringify(conflicting.candidate)
    ) continue;
    if (candidate.priority === conflicting.priority) {
      ambiguities.push({
        ambiguityId: stableId("ambiguity", `${candidate.mentionId}:${conflicting.mentionId}`),
        reason: candidate.extractionSource === "CLIENT_MAP" || conflicting.extractionSource === "CLIENT_MAP"
          ? "MAP_TEXT_CONFLICT"
          : "OVERLAPPING_DETERMINISTIC_CANDIDATES",
        mentionIds: [conflicting.mentionId, candidate.mentionId]
      });
    }
  }
  return { mentions: mentions.sort((left, right) => left.span.start - right.span.start), ambiguities };
}

export function parseDeterministicReferences(input: ParseInput): DeterministicParseResult {
  const { originalText } = input;
  if (originalText.length === 0 || originalText.length > 32768) throw new Error("Source text length is outside contract bounds");
  const candidates: ParsedMention[] = [];
  const warnings: string[] = [];

  for (const known of input.knownWorldReferences ?? []) {
    assertReferenceKey(known.referenceKey);
    if (!known.alias) continue;
    let from = 0;
    while (from < originalText.length) {
      const start = originalText.indexOf(known.alias, from);
      if (start < 0) break;
      candidates.push(mention(originalText, start, start + known.alias.length, [known.referenceType], "KNOWN_REFERENCE", 400, {
        kind: "KNOWN_REFERENCE",
        value: { alias: known.alias, validUntil: known.validUntil },
        approximate: false,
        requiresUpstreamValidation: true,
        referenceKey: known.referenceKey
      }));
      from = start + known.alias.length;
    }
  }

  for (const selection of input.mapSelections ?? []) {
    if (selection.referenceKey) assertReferenceKey(selection.referenceKey);
    const surface = findMapSurface(originalText, selection);
    if (!surface) continue;
    candidates.push(mention(originalText, surface.start, surface.end, [selection.kind], "CLIENT_MAP", 500, {
      kind: "MAP_SELECTION",
      value: {
        selectionId: selection.selectionId,
        revision: selection.revision,
        geometry: selection.geometry,
        geometryHash: selection.geometryHash
      },
      approximate: false,
      requiresUpstreamValidation: Boolean(selection.referenceKey),
      ...(selection.referenceKey ? { referenceKey: selection.referenceKey } : {})
    }));
  }

  for (const span of input.focusSpans ?? []) {
    const parsed = parseFocusSpan(originalText, span);
    if (parsed) candidates.push(parsed);
    else warnings.push(`UNRECOGNIZED_FOCUS_SPAN:${span.start}:${span.end}`);
  }

  for (const match of originalText.matchAll(h3Pattern)) {
    const token = match[0];
    if (!isValidCell(token.toLowerCase())) continue;
    candidates.push(mention(originalText, match.index, match.index + token.length, ["H3_CELL"], "DETERMINISTIC", 200, {
      kind: "H3_CELL_CANDIDATE",
      value: token.toLowerCase(),
      approximate: true,
      requiresUpstreamValidation: true
    }));
  }

  for (const match of originalText.matchAll(coordinatePattern)) {
    const longitudeText = match[1];
    const latitudeText = match[2];
    if (!longitudeText || !latitudeText) continue;
    const longitude = Number(longitudeText);
    const latitude = Number(latitudeText);
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) continue;
    const relativeStart = match[0].indexOf(longitudeText);
    const relativeEnd = match[0].lastIndexOf(latitudeText) + latitudeText.length;
    candidates.push(mention(originalText, match.index + relativeStart, match.index + relativeEnd, ["POSITION"], "DETERMINISTIC", 200, {
      kind: "COORDINATE_CANDIDATE",
      value: { longitude, latitude, crs: "CRS84_CANDIDATE" },
      approximate: false,
      requiresUpstreamValidation: true
    }));
  }

  for (const match of originalText.matchAll(codePattern)) {
    const code = match[1];
    if (!code) continue;
    const start = match.index + match[0].lastIndexOf(code);
    candidates.push(mention(originalText, start, start + code.length, ["DEVICE", "OBJECT"], "DETERMINISTIC", 200, {
      kind: "CODE_HINT",
      value: code,
      approximate: false,
      requiresUpstreamValidation: true
    }));
  }

  const selected = selectMentions(candidates);
  if (selected.mentions.length > 32) throw new Error("Deterministic mention limit exceeded");
  for (const parsed of selected.mentions) assertValidUtf16Span(originalText, parsed.span, parsed.surfaceText);
  return {
    parserVersion: "deterministic-parser/1.0",
    mentions: selected.mentions,
    ambiguities: selected.ambiguities,
    priorGroundings: (input.priorGroundings ?? []).map((prior) => ({
      groundingId: prior.groundingId,
      resultHash: prior.resultHash,
      selectedProductIds: prior.selectedProductIds ?? []
    })),
    warnings,
    distances: parseDistances(originalText),
    absoluteTimeConstraints: parseAbsoluteTimeConstraints(originalText)
  };
}

export function excludeOverlappingModelMentions(
  originalText: string,
  deterministic: ParsedMention[],
  modelMentions: ModelSpanMention[]
): ModelSpanMention[] {
  return modelMentions.filter((modelMention) => {
    assertValidUtf16Span(originalText, modelMention.span, modelMention.surfaceText);
    return !deterministic.some(
      (parsed) => parsed.span.start < modelMention.span.end && modelMention.span.start < parsed.span.end
    );
  });
}
