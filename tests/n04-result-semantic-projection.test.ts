import { describe, expect, it } from "vitest";

import { n04ResultSemanticProjection } from "../validation/lib/n04-result-semantic-projection.js";

type JsonObject = Record<string, unknown>;

function result(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    schemaVersion: "wsgs-grounding-result/1.1",
    status: "COMPLETED",
    source: { originalTextSha256: `sha256:${"a".repeat(64)}` },
    mentions: [],
    referenceProducts: [{
      productId: "reference-1",
      safeSummary: {
        validationStatus: "VALID",
        validationEvaluatedAt: "2026-09-01T00:00:00.000Z"
      }
    }],
    evidenceItems: [
      {
        evidenceProductId: "runtime-product-a",
        productKind: "WORLD_FACT",
        sourceOperation: "world.get-current-state",
        sourceNodeId: "Node_2",
        safePayload: { facts: [{ kind: "CURRENT_STATE", value: 42, freshnessMs: 10 }] },
        dataSnapshot: {
          capturedAt: "2026-09-01T00:00:00.000Z",
          consistency: "PINNED",
          resources: [{ authority: "gowm", pinning: "PINNED", referenceKeyHash: "world-1", digest: "runtime-a" }]
        },
        receiptIds: ["receipt-a"]
      },
      {
        evidenceProductId: "runtime-product-b",
        productKind: "CAPABILITY_RESULT",
        sourceOperation: "geo-raster.sample",
        sourceNodeId: "Node_3",
        safePayload: { value: 7 },
        dataSnapshot: {
          capturedAt: "2026-09-01T00:00:00.000Z",
          consistency: "CONSISTENT_AT_START",
          resources: [{ authority: "gdps", pinning: "PINNED", referenceKeyHash: "product-1", digest: "runtime-b" }]
        },
        evidenceIds: ["evidence-a"]
      }
    ],
    geospatialFindings: { findings: [{ class: "slope", value: 7 }] },
    ambiguities: [],
    unresolvedMentions: [],
    capabilityGaps: [],
    warnings: [],
    execution: { mode: "SYNC", elapsedMs: 12, semanticModelReceiptIds: ["model-a"] },
    ...overrides
  };
}

describe("N04 sync/async result semantic projection", () => {
  it("ignores runtime timestamps, snapshot digests and evidence completion order", () => {
    const sync = result();
    const async = result({
      referenceProducts: [{
        productId: "reference-1",
        safeSummary: {
          validationStatus: "VALID",
          validationEvaluatedAt: "2026-09-01T00:00:05.000Z"
        }
      }],
      evidenceItems: [...(sync["evidenceItems"] as unknown[])].reverse().map((entry) => ({
        ...(entry as JsonObject),
        evidenceProductId: "runtime-product-c",
        receiptIds: ["receipt-b"],
        evidenceIds: ["evidence-b"],
        dataSnapshot: {
          ...((entry as JsonObject)["dataSnapshot"] as JsonObject),
          capturedAt: "2026-09-01T00:00:05.000Z",
          resources: (((entry as JsonObject)["dataSnapshot"] as JsonObject)["resources"] as JsonObject[])
            .map((resource) => ({ ...resource, digest: "runtime-c" }))
        },
        safePayload: (entry as JsonObject)["sourceOperation"] === "world.get-current-state"
          ? { facts: [{ kind: "CURRENT_STATE", value: 42, freshnessMs: 5010 }] }
          : (entry as JsonObject)["safePayload"]
      })),
      execution: { mode: "SYNC", elapsedMs: 55, semanticModelReceiptIds: ["model-b"] }
    });

    expect(n04ResultSemanticProjection(async)).toEqual(n04ResultSemanticProjection(sync));
  });

  it("keeps business payload changes observable", () => {
    const baseline = result();
    const changed = structuredClone(baseline);
    const world = (changed["evidenceItems"] as JsonObject[])[0]!;
    world["safePayload"] = { facts: [{ kind: "CURRENT_STATE", value: 43, freshnessMs: 10 }] };

    expect(n04ResultSemanticProjection(changed)).not.toEqual(n04ResultSemanticProjection(baseline));
  });

  it("keeps snapshot authority changes observable", () => {
    const baseline = result();
    const changed = structuredClone(baseline);
    const snapshot = ((changed["evidenceItems"] as JsonObject[])[1]!["dataSnapshot"] as JsonObject);
    (snapshot["resources"] as JsonObject[])[0]!["authority"] = "foreign";

    expect(n04ResultSemanticProjection(changed)).not.toEqual(n04ResultSemanticProjection(baseline));
  });
});
