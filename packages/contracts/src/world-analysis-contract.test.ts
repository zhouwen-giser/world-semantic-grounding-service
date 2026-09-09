import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPublicValidator, findingSetHash, resultHash, canonicalJson } from "./world-analysis-contract.js";
import type { GroundingResult12 } from "./world-analysis/generated/grounding-result-1.2.js";

const example = (): GroundingResult12 => JSON.parse(readFileSync(new URL("../../../contracts/wsgs-v0.2.4-world-analysis/examples/action.json", import.meta.url), "utf8")) as GroundingResult12;

describe("frozen world analysis runtime contract", () => {
  const validate = createPublicValidator();
  it("validates the complete result through the copied public validator", () => {
    const result = example();
    expect(validate("result", result)).toEqual({ valid: true, errors: [] });
    expect(findingSetHash(result.worldAnalysisFindings)).toBe(result.worldAnalysisFindings.findingSetHash);
    expect(resultHash(result)).toBe(result.resultHash);
  });
  it("does not accept an action position that differs from its source, even after rehash", () => {
    const result = example();
    const action = result.worldAnalysisFindings.findings.find(finding => finding.findingKind === "ACTION_TARGET_CANDIDATE");
    expect(action).toBeDefined();
    if (!action || action.findingKind !== "ACTION_TARGET_CANDIDATE") throw new Error("Missing test action");
    action.target = { type: "Point", coordinates: [1, 2] };
    result.worldAnalysisFindings.findingSetHash = findingSetHash(result.worldAnalysisFindings);
    result.resultHash = resultHash(result);
    expect(validate("result", result).errors).toContainEqual(expect.objectContaining({ code: "ACTION_SOURCE_MISMATCH" }));
  });
  it("preserves fixed coordinate tuples and forbids non-JSON canonical values", () => {
    expect(canonicalJson({ b: -0, a: [3, 2, 1] })).toBe('{"a":[3,2,1],"b":0}');
    expect(() => canonicalJson({ value: Infinity })).toThrow();
    const result = example();
    expect(validate("result", result, { maxResultBytes: 1024 }).errors).toContainEqual({ code: "RESULT_TOO_LARGE", path: "" });
  });
});
