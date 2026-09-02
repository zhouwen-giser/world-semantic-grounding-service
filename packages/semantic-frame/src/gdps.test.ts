import { describe, expect, it } from "vitest";
import type { WorldSemanticFrame } from "@wsgs/contracts";
import { stabilizeSemanticFrame } from "./index.js";

const empty: WorldSemanticFrame = {
  schemaVersion: "1.0",
  mentions: [],
  spatialExpressions: [],
  relationExpressions: [],
  temporalConstraints: [],
  aggregationExpressions: [],
  rankingExpressions: []
};

describe("GDPS semantic frame vocabulary", () => {
  it.each([
    ["2号车当前位置的通行性为什么受限？", "2号车", "LAYER_FEATURE", "WORLD_OBJECT"],
    ["A区内有哪些湿地？", "A区", "WORLD_OBJECT", "LAYER_FEATURE"]
  ] as const)("keeps deterministic kind authority for %s", (text, surfaceText, proposedKind, expectedKind) => {
    const start = text.indexOf(surfaceText);
    const frame = stabilizeSemanticFrame({
      ...empty,
      mentions: [{
        mentionId: "model-wrong-kind",
        surfaceText,
        span: { encoding: "UTF16_CODE_UNIT", start, end: start + surfaceText.length },
        expectedKinds: [proposedKind]
      }]
    }, text);
    expect(frame.mentions.find((mention) => mention.surfaceText === surfaceText)?.expectedKinds).toEqual([expectedKind]);
  });

  it("does not absorb leading question words into a vehicle mention", () => {
    const frame = stabilizeSemanticFrame(empty, "为什么2号车当前位置的通行性受限？");
    expect(frame.mentions.map((mention) => mention.surfaceText)).toEqual(["2号车"]);
  });

  it.each(["相交", "穿过"])("retains model-backed Chinese %s spatial semantics", (operatorText) => {
    const text = `查找与滨河路东段${operatorText}的道路要素。`;
    const reference = "滨河路东段";
    const product = "道路要素";
    const referenceStart = text.indexOf(reference);
    const productStart = text.indexOf(product);
    const frame = stabilizeSemanticFrame({
      ...empty,
      mentions: [
        {
          mentionId: "reference",
          surfaceText: reference,
          span: { encoding: "UTF16_CODE_UNIT", start: referenceStart, end: referenceStart + reference.length }
        },
        {
          mentionId: "product",
          surfaceText: product,
          span: { encoding: "UTF16_CODE_UNIT", start: productStart, end: productStart + product.length }
        }
      ],
      spatialExpressions: [{ expressionId: "intersection", operator: "INTERSECTS", arguments: ["reference", "product"] }]
    }, text);
    expect(frame.spatialExpressions).toEqual([expect.objectContaining({ operator: "INTERSECTS" })]);
    expect(frame.spatialExpressions[0]?.arguments).toHaveLength(1);
    expect(frame.spatialExpressions[0]?.arguments.every((id) =>
      frame.mentions.some((mention) => mention.mentionId === id))).toBe(true);
  });

  it.each([
    ["2号车当前位置是什么地表覆盖？", "LAND_COVER_AT_LOCATION"],
    ["A区内有哪些湿地？", "FIND_WETLANDS"],
    ["2号车附近500米有哪些障碍物？", "FIND_OBSTACLES"],
    ["A区内有哪些不可通行区域？", "FIND_BLOCKED_AREAS"],
    ["2号车当前位置的高程是多少？", "ELEVATION_AT_LOCATION"],
    ["2号车当前位置为什么属于该通行性等级？", "EXPLAIN_TRAVERSABILITY"]
  ])("stabilizes %s as %s", (text, relationType) => {
    const frame = stabilizeSemanticFrame(empty, text);
    expect(frame.relationExpressions.map((entry) => entry.relationType)).toContain(relationType);
  });

  it("records only an explicit user product preference", () => {
    const explicit = stabilizeSemanticFrame(empty, "使用 terrain-main 数据，A区有哪些高地？");
    expect(explicit.relationExpressions.map((entry) => entry.relationType)).toContain(
      "EXPLICIT_PRODUCT_PREFERENCE:terrain-main"
    );
    expect(explicit.spatialExpressions).toEqual([
      expect.objectContaining({ operator: "WITHIN" })
    ]);
    const implicit = stabilizeSemanticFrame(empty, "A区有哪些高地？");
    expect(JSON.stringify(implicit)).not.toContain("terrain-main");
  });

  it("keeps unsupported visibility and flood-risk semantics explicit", () => {
    const frame = stabilizeSemanticFrame(empty, "A区有哪些高地并说明可见性和洪水风险？");
    expect(frame.relationExpressions.map((entry) => entry.relationType)).toEqual(expect.arrayContaining([
      "FIND_HIGH_GROUND", "VISIBILITY", "FLOOD_RISK"
    ]));
  });
});
