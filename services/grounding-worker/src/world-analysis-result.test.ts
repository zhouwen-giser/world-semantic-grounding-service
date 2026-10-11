import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createWorldAnalysisValidator, worldAnalysisResultHash, worldAnalysisFindingSetHash } from "@wsgs/contracts";
import { assembleProductionWorldAnalysis, worldAnalysisValidUntil } from "./world-analysis-result.js";

const example = (name: string) => JSON.parse(readFileSync(new URL(`../../../contracts/wsgs-v0.2.4-world-analysis/examples/${name}.json`, import.meta.url), "utf8"));
const validate = createWorldAnalysisValidator();
function assemble(base: Record<string, unknown>) {
  return assembleProductionWorldAnalysis({ base, runFingerprint: `sha256:${"b".repeat(64)}`,
    validUntil: "2026-09-06T00:01:00Z", maxResultBytes: 1048576, foundationEvidenceIds: [] });
}

describe("production world-analysis consumer boundary", () => {
  it("issues a 60-second choice lease after slow processing, bounded by source leases", () => {
    const started = Date.parse("2026-10-11T00:00:00.000Z");
    const issued = new Date(started + 72_000).toISOString();
    expect(worldAnalysisValidUntil(issued, [])).toBe("2026-10-11T00:02:12.000Z");
    expect(worldAnalysisValidUntil(issued, [{ validUntil: "2026-10-11T00:01:30.000Z" }])).toBe("2026-10-11T00:01:30.000Z");
    expect(worldAnalysisValidUntil(issued, [{ validUntil: "invalid" }])).toBe(issued);
  });
  it("does not publish an already-expired reference choice", () => {
    const base = example("empty");
    base.status = "AMBIGUOUS";
    base.referenceProducts = base.referenceProducts.slice(0, 2).map((product: Record<string, unknown>, index: number) => ({ ...product, productId: `product-${index}`, validUntil: "2026-09-06T00:00:00Z" }));
    base.ambiguities = [{ ambiguityId: "ambiguity-1", mentionId: "mention-1", surfaceText: "object", candidateProductIds: ["product-0", "product-1"], reason: "MULTIPLE_EXACT_MATCHES" }];
    const result = assembleProductionWorldAnalysis({ base, issuedAt: "2026-09-06T00:00:01Z", validUntil: "2026-09-06T00:01:01Z", maxResultBytes: 1048576, runFingerprint: `sha256:${"b".repeat(64)}`, foundationEvidenceIds: [] });
    expect(result.worldAnalysisFindings.choices).toEqual([]);
    expect(result.worldAnalysisFindings.gaps).toContainEqual(expect.objectContaining({ gapKind: "REFERENCE_MISSING", detail: { reasonCode: "SOURCE_REFERENCE_EXPIRED" } }));
    expect(validate("result", result)).toEqual({ valid: true, errors: [] });
  });
  it.each(["PROJECTION_PENDING", "HISTORICAL_PROJECTION_PENDING"])("exposes %s without a trajectory foundation", reasonCode => {
    const base = example("empty"); base.status = "PARTIAL";
    const input = { base, historicalExecution: { status: "PENDING" as const, reasonCode },
      runFingerprint: `sha256:${"b".repeat(64)}`, validUntil: "2026-09-06T00:01:00Z",
      maxResultBytes: 1048576, foundationEvidenceIds: [] };
    const result = assembleProductionWorldAnalysis(input);
    expect(result.status).toBe("PARTIAL");
    expect(result.worldAnalysisFindings.gaps).toEqual([expect.objectContaining({
      gapKind: "HISTORICAL_PROJECTION_PENDING", messageCode: "HISTORICAL_PROJECTION_PENDING", severity: "BLOCKING"
    })]);
    expect(result.worldAnalysisFindings.findings).toEqual([]);
    expect(result.worldAnalysisFindings.choices).toEqual([]);
    expect(result.referenceProducts).toEqual(base.referenceProducts);
    expect(validate("result", result)).toEqual({ valid: true, errors: [] });
    expect(result.resultHash).toBe(worldAnalysisResultHash(result));
    expect(result.worldAnalysisFindings.findingSetHash).toBe(worldAnalysisFindingSetHash(result.worldAnalysisFindings));
    expect(assembleProductionWorldAnalysis(input)).toEqual(result);
  });
  it.each(["COMPLETED", "PARTIAL"] as const)("does not invent a pending gap for %s history", status => {
    const base = example("empty"); base.status = status;
    const result = assembleProductionWorldAnalysis({ base, historicalExecution: { status, reasonCode: "PROVISIONAL" },
      runFingerprint: `sha256:${"b".repeat(64)}`, validUntil: "2026-09-06T00:01:00Z",
      maxResultBytes: 1048576, foundationEvidenceIds: [] });
    expect(result.worldAnalysisFindings.gaps).toEqual([]);
    expect(result.status).toBe(status);
  });
  it("retains historical capability gaps and existing failure precedence", () => {
    const base = example("empty"); base.status = "PARTIAL";
    const input = { base, historicalExecution: { status: "CAPABILITY_GAP" as const, reasonCode: "TASK_CONTEXT_REQUIRED" },
      runFingerprint: `sha256:${"b".repeat(64)}`, validUntil: "2026-09-06T00:01:00Z",
      maxResultBytes: 1048576, foundationEvidenceIds: [] };
    expect(assembleProductionWorldAnalysis(input).worldAnalysisFindings.gaps.map(g => g.gapKind)).toEqual(["TASK_CONTEXT_REQUIRED"]);
    expect(assembleProductionWorldAnalysis({ ...input, failureReasonCode: "SELECTION_EXPIRED" })
      .worldAnalysisFindings.gaps.map(g => g.gapKind)).toEqual(["SELECTION_EXPIRED"]);
  });
  it.each([
    ["ADVANCED_HISTORY_DISABLED", "CAPABILITY_UNAVAILABLE"],
    ["ADVANCED_HISTORY_REQUIRES_HISTORY", "CAPABILITY_UNAVAILABLE"],
    ["REFERENCE_MISSING", "REFERENCE_MISSING"],
    ["SELECTION_EXPIRED", "SELECTION_EXPIRED"],
    ["SELECTION_INVALID", "SELECTION_INVALID"],
    ["SELECTION_AMBIGUOUS", "SELECTION_AMBIGUOUS"],
    ["HISTORICAL_TIME_WINDOW_UNSUPPORTED", "CAPABILITY_UNAVAILABLE"], ["MULTI_ANALYSIS_NOT_SUPPORTED", "CAPABILITY_UNAVAILABLE"]
  ])("preserves pre-execution %s as a typed public gap", (failureReasonCode, gapKind) => {
    const base = example("empty"); base.status = "UNRESOLVED";
    const result = assembleProductionWorldAnalysis({ base, failureReasonCode, runFingerprint: `sha256:${"b".repeat(64)}`,
      validUntil: "2026-09-06T00:01:00Z", maxResultBytes: 1048576, foundationEvidenceIds: [] });
    expect(result.worldAnalysisFindings.gaps).toEqual([expect.objectContaining({ gapKind, severity: "BLOCKING" })]);
    expect(result.status).not.toBe("COMPLETED");
    expect(validate("result", result)).toEqual({ valid: true, errors: [] });
  });
  it.each(["WORLD_OBJECT", "OPERATIONAL_TASK"])("turns existing %s ambiguities into real-reference Choices", kind => {
    const base = example("empty");
    base.status = "AMBIGUOUS";
    base.referenceProducts = base.referenceProducts.slice(0, 2).map((product: Record<string, unknown>, index: number) => ({ ...product,
      productId: `product-${index}`, referenceType: kind, referenceKey: { ...(product["referenceKey"] as Record<string, unknown>), kind } }));
    base.ambiguities = [{ ambiguityId: "ambiguity-1", mentionId: "mention-1", surfaceText: "ambiguous object",
      candidateProductIds: base.referenceProducts.map((product: { productId: string }) => product.productId), reason: "MULTIPLE_EXACT_MATCHES" }];
    const result = assemble(base);
    const choice = result.worldAnalysisFindings.choices[0]!;
    expect(choice.choiceKind).toBe(kind === "OPERATIONAL_TASK" ? "TASK_SELECTION" : "REFERENCE_SELECTION");
    expect(choice.candidates).toHaveLength(base.referenceProducts.length);
    expect(choice.candidates[0]).toMatchObject({ referenceProductId: base.referenceProducts[0].productId });
    expect(validate("result", result)).toEqual({ valid: true, errors: [] });
  });
  it.each(["COMPLETED", "PARTIAL", "AMBIGUOUS", "UNRESOLVED", "FAILED", "CANCELLED"])("retains ordinary %s status with an empty analysis component", status => {
    const base = example("empty");
    base.status = status;
    const result = assemble(base);
    expect(result.status).toBe(status);
    expect(result.worldAnalysisFindings.findings).toEqual([]);
    expect(validate("result", result)).toEqual({ valid: true, errors: [] });
    expect(result.resultHash).toBe(worldAnalysisResultHash(result));
    expect(result.execution.runFingerprint).toBe(`sha256:${"b".repeat(64)}`);
  });

  it("exposes only approved reference and evidence fields, with hashed snapshots", () => {
    const base = example("trace");
    for (const reference of base.referenceProducts) reference.safeSummary = { privateField: "never-public" };
    for (const evidence of base.evidenceItems) {
      evidence.safePayload = { originalText: "never-public" };
      evidence.payloadRef = "private://never-public";
      evidence.dataSnapshot = { privateToken: "never-public", capturedAt: "2026-09-06T00:00:00Z" };
    }
    const result = assemble(base);
    expect(JSON.stringify(result)).not.toContain("never-public");
    expect(result.evidenceItems[0]?.dataSnapshot?.snapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(validate("result", result)).toEqual({ valid: true, errors: [] });
    expect(base.evidenceItems[0].safePayload).toEqual({ originalText: "never-public" });
  });
});
