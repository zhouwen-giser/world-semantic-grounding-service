import { describe, expect, it } from "vitest";

import {
  assertValidUtf16Span,
  excludeOverlappingModelMentions,
  parseDeterministicReferences
} from "./parser.js";
import type { ReferenceKey, TextSpan } from "./types.js";

const referenceKey: ReferenceKey = {
  namespace: "gowm",
  kind: "vehicle",
  id: `wrf_${"a".repeat(32)}`,
  version: "world-7"
};

function span(text: string, surface: string): TextSpan {
  const start = text.indexOf(surface);
  return { encoding: "UTF16_CODE_UNIT", start, end: start + surface.length };
}

describe("deterministic reference parser", () => {
  it("binds a supplied known reference without generating a ReferenceKey", () => {
    const originalText = "查询2号车的当前位置";
    const result = parseDeterministicReferences({
      originalText,
      knownWorldReferences: [{ alias: "2号车", referenceKey, referenceType: "vehicle", sourceMessageId: "message-1" }]
    });
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]).toMatchObject({
      surfaceText: "2号车",
      extractionSource: "KNOWN_REFERENCE",
      candidate: { kind: "KNOWN_REFERENCE", referenceKey, requiresUpstreamValidation: true }
    });
  });

  it("gives a client map selection priority and retains equal-priority conflict", () => {
    const originalText = "查询我标注区域内的车辆";
    const result = parseDeterministicReferences({
      originalText,
      mapSelections: [
        { selectionId: "map-a", label: "标注区域", kind: "AREA", revision: 1, geometry: { type: "Polygon" } },
        { selectionId: "map-b", label: "标注区域", kind: "AREA", revision: 2, geometry: { type: "Polygon" } }
      ]
    });
    expect(result.mentions[0]).toMatchObject({ extractionSource: "CLIENT_MAP", candidate: { kind: "MAP_SELECTION" } });
    expect(result.ambiguities[0]?.reason).toBe("MAP_TEXT_CONFLICT");
  });

  it("extracts only valid H3 cells and leaves them approximate pending upstream validation", () => {
    const result = parseDeterministicReferences({ originalText: "H3 892f5a32d97ffff，忽略 8ffffffffffffff" });
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]).toMatchObject({
      surfaceText: "892f5a32d97ffff",
      candidate: { kind: "H3_CELL_CANDIDATE", approximate: true, requiresUpstreamValidation: true }
    });
  });

  it("parses explicit lon/lat but not dates or version numbers", () => {
    const explicit = parseDeterministicReferences({ originalText: "查询坐标 112.9812, 28.1915 附近设备" });
    expect(explicit.mentions[0]).toMatchObject({
      surfaceText: "112.9812, 28.1915",
      candidate: { kind: "COORDINATE_CANDIDATE", value: { longitude: 112.9812, latitude: 28.1915 } }
    });
    expect(parseDeterministicReferences({ originalText: "日期 2026-08-24，版本 1.2.3" }).mentions).toEqual([]);
  });

  it("parses bounded GeoJSON and WKT only from explicit focus spans", () => {
    const geoJson = '{"type":"Point","coordinates":[112.9,28.1]}';
    const text = `focus ${geoJson}`;
    const parsed = parseDeterministicReferences({ originalText: text, focusSpans: [span(text, geoJson)] });
    expect(parsed.mentions[0]?.candidate.kind).toBe("GEOMETRY_CANDIDATE");

    const wkt = "POINT (112.9 28.1)";
    const wktText = `focus ${wkt}`;
    expect(parseDeterministicReferences({ originalText: wktText, focusSpans: [span(wktText, wkt)] }).mentions[0]?.candidate.kind).toBe("GEOMETRY_CANDIDATE");
  });

  it("uses exact UTF-16 code-unit spans for Chinese and surrogate pairs", () => {
    const text = "查找🚗A附近的道路";
    const result = parseDeterministicReferences({
      originalText: text,
      knownWorldReferences: [{ alias: "🚗A", referenceKey, referenceType: "vehicle", sourceMessageId: "message-1" }]
    });
    const parsed = result.mentions[0]!;
    expect(parsed.span).toEqual({ encoding: "UTF16_CODE_UNIT", start: 2, end: 5 });
    expect(assertValidUtf16Span(text, parsed.span, parsed.surfaceText)).toBe("🚗A");
    expect(() => assertValidUtf16Span(text, { ...parsed.span, end: 4 }, "🚗A")).toThrow(/does not match/u);
    expect(() => assertValidUtf16Span(text, { encoding: "UTF16_CODE_UNIT", start: 2, end: 3 })).toThrow(/surrogate/u);
  });

  it("normalizes Chinese and English distance literals to exact integer millimetres", () => {
    const originalText = "🚗半径1公里、200米，then 3 km and 500 m";
    const result = parseDeterministicReferences({ originalText });
    expect(result.distances?.map(({ surfaceText, millimetres, sourceUnit }) => ({ surfaceText, millimetres, sourceUnit }))).toEqual([
      { surfaceText: "1公里", millimetres: 1_000_000, sourceUnit: "公里" },
      { surfaceText: "200米", millimetres: 200_000, sourceUnit: "米" },
      { surfaceText: "3 km", millimetres: 3_000_000, sourceUnit: "km" },
      { surfaceText: "500 m", millimetres: 500_000, sourceUnit: "m" }
    ]);
    expect(result.distances?.every((entry) =>
      originalText.slice(entry.span.start, entry.span.end) === entry.surfaceText && Number.isSafeInteger(entry.millimetres)
    )).toBe(true);
  });

  it("parses only valid explicit ISO timestamps and absolute start/end ranges", () => {
    const instant = "2026-08-27T09:00:00Z";
    const from = "2026-08-27T10:00:00+08:00";
    const to = "2026-08-27T12:30:00+08:00";
    const originalText = `at ${instant}, window ${from}/${to}; ignore 2026-02-30T09:00:00Z and 2026-08-27`;
    const result = parseDeterministicReferences({ originalText });
    expect(result.absoluteTimeConstraints).toMatchObject([
      { kind: "INSTANT", surfaceText: instant, from: instant },
      { kind: "RANGE", surfaceText: `${from}/${to}`, from, to }
    ]);
    expect(result.absoluteTimeConstraints).toHaveLength(2);
    expect(result.absoluteTimeConstraints?.every((entry) =>
      originalText.slice(entry.span.start, entry.span.end) === entry.surfaceText
    )).toBe(true);
  });

  it("lets deterministic spans win over overlapping model spans", () => {
    const text = "设备code DEV-77在区域内";
    const deterministic = parseDeterministicReferences({ originalText: text }).mentions;
    const kept = excludeOverlappingModelMentions(text, deterministic, [
      { mentionId: "model-overlap", surfaceText: "DEV-77", span: span(text, "DEV-77") },
      { mentionId: "model-other", surfaceText: "区域", span: span(text, "区域") }
    ]);
    expect(kept.map((entry) => entry.mentionId)).toEqual(["model-other"]);
  });

  it("applies Map > KnownReference > Deterministic precedence for overlapping text", () => {
    const text = "查询目标code DEV-77";
    const result = parseDeterministicReferences({
      originalText: text,
      knownWorldReferences: [
        { alias: "目标", referenceKey, referenceType: "vehicle", sourceMessageId: "message-1" },
        { alias: "DEV-77", referenceKey, referenceType: "vehicle", sourceMessageId: "message-1" }
      ],
      mapSelections: [{ selectionId: "selection", label: "目标", kind: "FEATURE", revision: 1 }]
    });
    expect(result.mentions.map((entry) => [entry.surfaceText, entry.extractionSource])).toEqual([
      ["目标", "CLIENT_MAP"],
      ["DEV-77", "KNOWN_REFERENCE"]
    ]);
  });

  it("accepts explicit GOWM ReferenceKey objects and prior pointers without inventing contents", () => {
    const encoded = JSON.stringify(referenceKey);
    const result = parseDeterministicReferences({
      originalText: encoded,
      focusSpans: [{ encoding: "UTF16_CODE_UNIT", start: 0, end: encoded.length }],
      priorGroundings: [{ groundingId: "grounding-old", resultHash: `sha256:${"b".repeat(64)}`, selectedProductIds: ["product-1"] }]
    });
    expect(result.mentions[0]?.candidate).toMatchObject({ kind: "REFERENCE_KEY_OBJECT", referenceKey });
    expect(result.priorGroundings).toEqual([{
      groundingId: "grounding-old",
      resultHash: `sha256:${"b".repeat(64)}`,
      selectedProductIds: ["product-1"]
    }]);
  });

  it("rejects ReferenceKey literals outside the complete frozen shape", () => {
    const invalid = JSON.stringify({ ...referenceKey, providerId: "forbidden" });
    const result = parseDeterministicReferences({
      originalText: invalid,
      focusSpans: [{ encoding: "UTF16_CODE_UNIT", start: 0, end: invalid.length }]
    });
    expect(result.mentions).toEqual([]);
    expect(result.warnings).toEqual([`UNRECOGNIZED_FOCUS_SPAN:0:${invalid.length}`]);
    expect(() => parseDeterministicReferences({
      originalText: "2号车",
      knownWorldReferences: [{
        alias: "2号车",
        referenceKey: { ...referenceKey, version: "" },
        referenceType: "vehicle",
        sourceMessageId: "message-1"
      }]
    })).toThrow(/frozen northbound contract/u);
  });

  it("never fabricates ReferenceKey values for deterministic candidates", () => {
    const result = parseDeterministicReferences({
      originalText: "设备code DEV-77，坐标 112.9, 28.1，H3 892f5a32d97ffff"
    });
    expect(result.mentions.map((entry) => entry.candidate.kind).sort()).toEqual([
      "CODE_HINT",
      "COORDINATE_CANDIDATE",
      "H3_CELL_CANDIDATE"
    ]);
    expect(result.mentions.every((entry) => entry.candidate.referenceKey === undefined)).toBe(true);
  });
});
