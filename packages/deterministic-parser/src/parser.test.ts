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
