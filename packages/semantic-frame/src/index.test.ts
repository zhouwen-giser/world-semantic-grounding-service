import type { WorldSemanticFrame } from "@wsgs/contracts";
import { describe, expect, it } from "vitest";
import { SemanticFrameValidationError, stabilizeSemanticFrame, validateSemanticFrame } from "./index.js";

const text = "road near device today";
const validFrame: WorldSemanticFrame = {
  schemaVersion: "1.0",
  mentions: [
    { mentionId: "road", surfaceText: "road", span: { encoding: "UTF16_CODE_UNIT", start: 0, end: 4 }, expectedKinds: ["ROAD"] },
    { mentionId: "device", surfaceText: "device", span: { encoding: "UTF16_CODE_UNIT", start: 10, end: 16 }, expectedKinds: ["DEVICE"] }
  ],
  spatialExpressions: [{ expressionId: "near", operator: "NEAR", arguments: ["road", "device"], distanceM: 500 }],
  relationExpressions: [],
  temporalConstraints: [{ constraintId: "time", relativeExpression: "today" }],
  aggregationExpressions: [],
  rankingExpressions: [{ expressionId: "rank", metric: "distance", direction: "ASC", limit: 5 }]
};

describe("validateSemanticFrame", () => {
  it.each([
    ["2号车在哪里？", "2号车", "CURRENT_STATE", undefined, undefined],
    ["滨河路附近有哪些设备？", "滨河路", undefined, "NEAR", undefined],
    ["A区内有哪些车辆？", "A区", undefined, "WITHIN", undefined],
    ["2号车附近1公里有什么？", "2号车", undefined, "NEAR", 1_000]
  ] as const)("stabilizes explicit recipe semantics for %s", (sourceText, surface, relation, spatial, distanceM) => {
    const frame = stabilizeSemanticFrame({
      schemaVersion: "1.0",
      mentions: [],
      spatialExpressions: [{ expressionId: "bad", operator: "NEAR", arguments: ["missing"] }],
      relationExpressions: [], temporalConstraints: [], aggregationExpressions: [], rankingExpressions: []
    }, sourceText);
    expect(frame.mentions.map((mention) => mention.surfaceText)).toContain(surface);
    if (relation) expect(frame.relationExpressions).toEqual([expect.objectContaining({ relationType: relation })]);
    if (spatial) {
      expect(frame.spatialExpressions).toEqual([
        expect.objectContaining({ operator: spatial, ...(distanceM ? { distanceM } : {}) })
      ]);
    } else expect(frame.spatialExpressions).toEqual([]);
    for (const expression of frame.spatialExpressions) {
      expect(expression.arguments.every((id) => frame.mentions.some((mention) => mention.mentionId === id))).toBe(true);
    }
  });

  it("accepts bounded mentions, spatial, temporal, and ranking semantics", () => {
    expect(validateSemanticFrame(validFrame, text)).toBe(validFrame);
  });

  it("rejects non-exact UTF-16 spans", () => {
    const invalid: WorldSemanticFrame = {
      ...validFrame,
      mentions: [{ ...validFrame.mentions[0]!, surfaceText: "fake" }, validFrame.mentions[1]!]
    };
    expect(() => validateSemanticFrame(invalid, text)).toThrowError(SemanticFrameValidationError);
    const emojiText = "🚗 road";
    expect(() => validateSemanticFrame({
      ...validFrame,
      mentions: [{ mentionId: "half", surfaceText: emojiText.slice(0, 1), span: { encoding: "UTF16_CODE_UNIT", start: 0, end: 1 } }],
      spatialExpressions: [],
      relationExpressions: [],
      temporalConstraints: [],
      aggregationExpressions: [],
      rankingExpressions: []
    }, emojiText)).toThrow(/MENTION_SPAN_MISMATCH/u);
  });

  it("rejects duplicate or dangling semantic identifiers", () => {
    const duplicate: WorldSemanticFrame = {
      ...validFrame,
      rankingExpressions: [{ expressionId: "near", direction: "ASC" }]
    };
    expect(() => validateSemanticFrame(duplicate, text)).toThrow(/DUPLICATE_EXPRESSION_ID/u);
    const dangling: WorldSemanticFrame = {
      ...validFrame,
      spatialExpressions: [{ expressionId: "near", operator: "NEAR", arguments: ["missing"] }]
    };
    expect(() => validateSemanticFrame(dangling, text)).toThrow(/INVALID_SPATIAL_EXPRESSION/u);
  });

  it("rejects empty or reversed time constraints", () => {
    expect(() => validateSemanticFrame({
      ...validFrame,
      temporalConstraints: [{ constraintId: "empty" }]
    }, text)).toThrow(/EMPTY_TEMPORAL_CONSTRAINT/u);
    expect(() => validateSemanticFrame({
      ...validFrame,
      temporalConstraints: [{ constraintId: "reversed", from: "2026-08-25T10:00:00Z", to: "2026-08-25T09:00:00Z" }]
    }, text)).toThrow(/REVERSED_TEMPORAL_CONSTRAINT/u);
    expect(() => validateSemanticFrame({
      ...validFrame,
      temporalConstraints: [{ constraintId: "invalid-date", from: "2026-02-30T09:00:00Z" }]
    }, text)).toThrow(/INVALID_ABSOLUTE_TIME/u);
    expect(() => validateSemanticFrame({
      ...validFrame,
      temporalConstraints: [{ constraintId: "date-only", from: "2026-08-27" }]
    }, text)).toThrow(/INVALID_ABSOLUTE_TIME/u);
  });

  it("requires positive finite distances exactly as the frozen schema does", () => {
    expect(() => validateSemanticFrame({
      ...validFrame,
      spatialExpressions: [{ ...validFrame.spatialExpressions[0]!, distanceM: 0 }]
    }, text)).toThrow(/INVALID_SPATIAL_EXPRESSION/u);
  });
});
