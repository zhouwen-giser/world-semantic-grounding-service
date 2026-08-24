import type { WorldSemanticFrame } from "@wsgs/contracts";
import { describe, expect, it } from "vitest";
import { SemanticFrameValidationError, validateSemanticFrame } from "./index.js";

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
  it("accepts bounded mentions, spatial, temporal, and ranking semantics", () => {
    expect(validateSemanticFrame(validFrame, text)).toBe(validFrame);
  });

  it("rejects non-exact UTF-16 spans", () => {
    const invalid: WorldSemanticFrame = {
      ...validFrame,
      mentions: [{ ...validFrame.mentions[0]!, surfaceText: "fake" }, validFrame.mentions[1]!]
    };
    expect(() => validateSemanticFrame(invalid, text)).toThrowError(SemanticFrameValidationError);
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
  });
});
