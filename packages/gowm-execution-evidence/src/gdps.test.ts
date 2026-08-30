import { describe, expect, it } from "vitest";

import { evaluateGdpsCurrentOnlyReplay, normalizeGdpsSourceEvidence } from "./gdps.js";

const priorHash = `sha256:${"a".repeat(64)}` as const;
const currentHash = `sha256:${"b".repeat(64)}` as const;

function envelope(
  value: Record<string, unknown>,
  status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE" | "FAILED" = "COMPLETED"
): Record<string, unknown> {
  return {
    providerProtocolVersion: "1.0",
    requestId: "gdps-evidence-test",
    operation: { operationId: "terrain.find-high-ground", operationVersion: "1.0" },
    status,
    output: {
      schemaUri: "urn:gdps:operation:terrain.find-high-ground:output:1.0",
      schemaHash: `sha256:${"c".repeat(64)}`,
      value
    },
    dataSnapshot: { resources: [{ referenceKey: { kind: "DATASET", id: "terrain-main" }, digest: priorHash }] },
    computeSnapshot: { providerBuildHash: currentHash },
    receipts: [{ receiptId: "gdps-receipt-1" }],
    evidenceReferences: [{ evidenceId: "gdps-evidence-1" }],
    warnings: []
  };
}

describe("GDPS current-only execution evidence", () => {
  it("preserves productId and contentHash while treating an empty collection as a completed observation", () => {
    const result = normalizeGdpsSourceEvidence(envelope({
      schemaVersion: "gdps-patch-query-result/1.0",
      productId: "terrain-main",
      contentHash: priorHash,
      type: "FeatureCollection",
      features: [],
      truncated: false
    }));

    expect(result).toMatchObject({
      normalizedStatus: "COMPLETED",
      productId: "terrain-main",
      contentHash: priorHash,
      emptyCurrentResult: true,
      truncated: false
    });
    expect(JSON.stringify(result)).not.toMatch(/productVersion|product_version/u);
  });

  it("maps truncation to PARTIAL even when the Provider envelope completed", () => {
    expect(normalizeGdpsSourceEvidence(envelope({
      productId: "terrain-main",
      contentHash: priorHash,
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: null, properties: {} }],
      truncated: true
    }))).toMatchObject({ normalizedStatus: "PARTIAL", truncated: true });
  });

  it("attaches exact recipe and descriptor authority without inventing product versions", () => {
    const result = normalizeGdpsSourceEvidence(envelope({
      productId: "terrain-main",
      contentHash: priorHash,
      truncated: false,
      evidence: { evidenceId: "ev-1" },
      quality: { completeness: 0.9 }
    }), {
      recipeId: "recipe-gdps-generic-sample-value",
      recipeLockHash: currentHash,
      descriptorId: "SLOPE/DEGREE",
      descriptorHash: priorHash,
      productType: "SLOPE",
      productProfile: "DEGREE",
      queryProfile: "SAMPLE_VALUE"
    });
    expect(result).toMatchObject({
      recipeId: "recipe-gdps-generic-sample-value",
      recipeLockHash: currentHash,
      descriptorId: "SLOPE/DEGREE",
      descriptorHash: priorHash,
      productType: "SLOPE",
      productProfile: "DEGREE",
      queryProfile: "SAMPLE_VALUE",
      computeSnapshot: { providerBuildHash: currentHash },
      receiptIds: ["gdps-receipt-1"],
      evidenceIds: ["gdps-evidence-1"],
      evidence: { evidenceId: "ev-1" },
      quality: { completeness: 0.9 }
    });
    expect(JSON.stringify(result)).not.toMatch(/productVersion|product_version/u);
  });

  it.each([
    ["PRODUCT_NOT_AVAILABLE", "UNRESOLVED", "DATA_GAP"],
    ["PRODUCT_COVERAGE_INSUFFICIENT", "UNRESOLVED", "COVERAGE_GAP"],
    ["OPERATION_UNAVAILABLE", "UNRESOLVED", "CAPABILITY_GAP"],
    ["AMBIGUOUS_PRODUCT_SELECTION", "AMBIGUOUS", undefined],
    ["PRODUCT_COVERAGE_AMBIGUOUS", "AMBIGUOUS", undefined],
    ["SOURCE_CHANGED_DURING_QUERY", "INDETERMINATE", undefined]
  ] as const)("maps %s without inventing a negative world fact", (code, normalizedStatus, gapKind) => {
    const result = normalizeGdpsSourceEvidence(envelope({ code }, code === "SOURCE_CHANGED_DURING_QUERY" ? "INDETERMINATE" : "NO_DATA"));
    expect(result).toMatchObject({ normalizedStatus, reasonCode: code, ...(gapKind ? { gapKind } : {}) });
    expect(result.emptyCurrentResult).toBe(false);
    expect(result).not.toHaveProperty("worldFact", false);
  });

  it("rejects product-version semantics at any nesting level", () => {
    expect(() => normalizeGdpsSourceEvidence(envelope({
      productId: "terrain-main",
      contentHash: priorHash,
      truncated: false,
      metadata: { productVersion: "v2" }
    }))).toThrow("GDPS_PRODUCT_VERSION_SEMANTICS_FORBIDDEN");
  });
});

describe("GDPS current-only replay", () => {
  const prior = { productId: "terrain-main", contentHash: priorHash };

  it("allows an exact current source under strict replay", () => {
    expect(evaluateGdpsCurrentOnlyReplay("STRICT", prior, {
      productId: "terrain-main",
      currentness: "CURRENT",
      currentContentHash: priorHash
    })).toEqual({ status: "REPLAY_ALLOWED", mode: "STRICT", source: prior, warnings: [] });
  });

  it("blocks strict and PINNED replay when the current source changed", () => {
    for (const mode of ["STRICT", "PINNED"] as const) {
      expect(evaluateGdpsCurrentOnlyReplay(mode, prior, {
        productId: "terrain-main",
        currentness: "CHANGED",
        currentContentHash: currentHash
      })).toMatchObject({
        status: "SNAPSHOT_MISMATCHED",
        mode,
        executionBlocked: true,
        actualContentHash: currentHash,
        warnings: ["SOURCE_CHANGED"]
      });
    }
  });

  it("allows BEST_EFFORT source advance only with an explicit warning and actual hash", () => {
    expect(evaluateGdpsCurrentOnlyReplay("BEST_EFFORT", prior, {
      productId: "terrain-main",
      currentness: "CHANGED",
      currentContentHash: currentHash
    })).toEqual({
      status: "REPLAY_ALLOWED",
      mode: "BEST_EFFORT",
      source: { productId: "terrain-main", contentHash: currentHash },
      priorContentHash: priorHash,
      warnings: ["SOURCE_ADVANCED"]
    });
  });

  it("does not reinterpret a missing current product as a replayable negative fact", () => {
    expect(evaluateGdpsCurrentOnlyReplay("BEST_EFFORT", prior, {
      productId: "terrain-main",
      currentness: "NOT_AVAILABLE"
    })).toMatchObject({
      status: "UNRESOLVED",
      gapKind: "DATA_GAP",
      executionBlocked: true,
      warnings: ["SOURCE_NOT_AVAILABLE"]
    });
  });
});

