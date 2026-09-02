import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildSourceCurrentnessEvidence,
  currentnessOperationInput,
  loadSourceCurrentnessRecipeAuthorization,
  normalizeSourceCurrentness,
  parseSourceCurrentnessRequest,
  sourceCurrentnessReuseDecision
} from "./index.js";

const request = {
  schemaVersion: "wsgs-source-currentness-request/1.0" as const,
  sourceProductId: "source-product.current.1",
  productId: "gdps-baseline-dtm",
  previousContentHash: `sha256:${"a".repeat(64)}` as const
};
const context = { request, validationGroundingId: "grounding.currentness.001", checkedAt: "2026-09-01T00:00:00Z" };

describe("source currentness", () => {
  it("validates the exact request and builds only the GDPS operation input", () => {
    expect(parseSourceCurrentnessRequest(request)).toEqual(request);
    expect(currentnessOperationInput(request)).toEqual({ productId: request.productId, contentHash: request.previousContentHash });
    expect(() => parseSourceCurrentnessRequest({ ...request, dataScope: "foreign" })).toThrowError(/Source currentness/u);
  });

  it.each([
    ["CURRENT", `sha256:${"a".repeat(64)}`, "CURRENT"],
    ["CHANGED", `sha256:${"b".repeat(64)}`, "CHANGED"],
    ["NOT_AVAILABLE", undefined, "NOT_AVAILABLE"]
  ] as const)("normalizes authoritative %s", (currentness, currentContentHash, expected) => {
    const result = normalizeSourceCurrentness({
      ...context,
      upstream: {
        schemaVersion: "gdps-check-current-result/1.0",
        productId: request.productId,
        currentness,
        ...(currentContentHash ? { currentContentHash } : {})
      }
    });
    expect(result.status).toBe(expected);
    expect(result).not.toHaveProperty("sourceProduct");
    expect(result).not.toHaveProperty("content");
  });

  it("maps missing or contradictory authority to UNKNOWN, never CURRENT", () => {
    expect(normalizeSourceCurrentness({ ...context, upstream: null }).status).toBe("UNKNOWN");
    expect(normalizeSourceCurrentness({
      ...context,
      upstream: {
        schemaVersion: "gdps-check-current-result/1.0",
        productId: request.productId,
        currentness: "CURRENT",
        currentContentHash: `sha256:${"b".repeat(64)}`
      }
    }).status).toBe("UNKNOWN");
  });

  it("fails closed for strict reuse and requires a new query for best effort", () => {
    for (const status of ["CHANGED", "NOT_AVAILABLE", "UNKNOWN"] as const) {
      expect(sourceCurrentnessReuseDecision(status, "STRICT_REUSE")).toBe("FAIL_CLOSED");
      expect(sourceCurrentnessReuseDecision(status, "BEST_EFFORT")).toBe("REQUERY_REQUIRED");
    }
    expect(sourceCurrentnessReuseDecision("CURRENT", "STRICT_REUSE")).toBe("REUSE_CURRENT");
  });

  it("locks the exact provider recipe and produces deterministic gateway-only evidence", () => {
    const lock = loadSourceCurrentnessRecipeAuthorization(resolve(
      import.meta.dirname, "..", "..", "..", "contracts", "upstream", "gdps-v0.2.1", "GDPS_RECIPE_LOCK.json"
    ));
    expect(lock.allowedOperations[0].operationId).toBe("geo-product.check-current");
    const evidence = buildSourceCurrentnessEvidence({
      queryId: "query-currentness-1",
      upstreamResultHash: `sha256:${"c".repeat(64)}`,
      receiptIds: ["receipt-2", "receipt-1", "receipt-1"]
    });
    expect(evidence).toMatchObject({ gatewayOnly: true, directProviderCalls: 0, receiptIds: ["receipt-1", "receipt-2"] });
    expect(buildSourceCurrentnessEvidence({
      queryId: "query-currentness-1",
      upstreamResultHash: `sha256:${"c".repeat(64)}`,
      receiptIds: ["receipt-1", "receipt-2"]
    }).evidenceHash).toBe(evidence.evidenceHash);
  });
});
