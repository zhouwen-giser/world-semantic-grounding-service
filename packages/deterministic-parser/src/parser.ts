import { createHash } from "node:crypto";

import { isValidCell } from "h3-js";

import type {
  DeterministicParseResult,
  MapSelectionInput,
  ParseAmbiguity,
  ParseInput,
  ParsedCandidate,
  ParsedMention,
  ReferenceKey,
  ModelSpanMention,
  TextSpan
} from "./types.js";

const h3Pattern = /(?<![0-9a-f])8[0-9a-f]{14}(?![0-9a-f])/giu;
const coordinatePattern = /(?:坐标|coordinates?)\s*[:：]?\s*\(?\s*(-?\d{1,3}(?:\.\d+)?)\s*[,，]\s*(-?\d{1,2}(?:\.\d+)?)\s*\)?/giu;
const codePattern = /(?:设备|对象|device|object)?\s*(?:编码|编号|code)\s*[:：#]?\s*([A-Za-z][A-Za-z0-9._-]{1,63})/giu;
const wktPattern = /^(?:POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON)\s*\(/iu;
const referenceIdPattern = /^wrf_[0-9a-f]{32}$/u;

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

export function assertValidUtf16Span(originalText: string, span: TextSpan, surfaceText?: string): string {
  if (span.encoding !== "UTF16_CODE_UNIT") throw new Error("Text span encoding must be UTF16_CODE_UNIT");
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > originalText.length) {
    throw new Error("Text span is outside the UTF-16 source bounds");
  }
  const slice = originalText.slice(span.start, span.end);
  if (surfaceText !== undefined && slice !== surfaceText) throw new Error("Text span does not match surfaceText");
  return slice;
}

function isReferenceKey(value: unknown): value is ReferenceKey {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate["namespace"] === "gowm" &&
    typeof candidate["kind"] === "string" &&
    typeof candidate["id"] === "string" &&
    referenceIdPattern.test(candidate["id"]) &&
    typeof candidate["version"] === "string"
  );
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
    mentionId: stableId("mention", `${start}:${end}:${candidate.kind}:${surfaceText}`),
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
    warnings
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
