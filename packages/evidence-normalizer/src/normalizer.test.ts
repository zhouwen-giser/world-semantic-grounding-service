import { describe, expect, it } from "vitest";
import { EvidenceNormalizationError, GowmEvidenceNormalizer } from "./index.js";

const expected = {
  operationId: "world.get-current-state",
  operationVersion: "1.0",
  providerId: "gowm.world-evidence",
  outputSchemaUri: "urn:gowm:v0.4:world-fact-result",
  outputSchemaHash: `sha256:${"a".repeat(64)}` as const
};

function computeSnapshot(): Record<string, unknown> {
  return {
    provider: { providerId: expected.providerId, providerVersion: "1.0.0" },
    operation: { operationId: expected.operationId, operationVersion: expected.operationVersion },
    engine: { name: "evidence", version: "1" },
    policy: { version: "1", digest: `sha256:${"b".repeat(64)}` },
    schemas: { inputSchemaHash: `sha256:${"c".repeat(64)}`, outputSchemaHash: expected.outputSchemaHash }
  };
}

function receipt(): Record<string, unknown> {
  return {
    receiptId: "receipt-1",
    operationId: expected.operationId,
    operationVersion: expected.operationVersion,
    providerId: expected.providerId,
    providerVersion: "1.0.0"
  };
}

function evidenceReference(): Record<string, unknown> {
  return {
    evidenceId: "world-evidence-1",
    authority: "gowm.world-snapshot",
    evidenceType: "OBSERVATION",
    referenceKey: { namespace: "gowm", kind: "WORLD_OBJECT", id: "wrf_1", version: "v1" },
    schemaUri: "urn:evidence",
    schemaHash: `sha256:${"d".repeat(64)}`,
    payloadRef: "https://evidence.invalid/artifact-1"
  };
}

function envelope(status = "COMPLETED", value: unknown = { state: "ACTIVE" }): Record<string, unknown> {
  return {
    providerProtocolVersion: "1.0",
    requestId: "request-1",
    operation: { operationId: expected.operationId, operationVersion: expected.operationVersion },
    status,
    ...(status === "NO_DATA" || status === "FAILED" ? {} : {
      output: { schemaUri: expected.outputSchemaUri, schemaHash: expected.outputSchemaHash, value }
    }),
    dataSnapshot: {
      consistency: "PINNED",
      capturedAt: "2026-08-25T00:00:00Z",
      scopeDigest: `sha256:${"e".repeat(64)}`,
      resources: [{ referenceKey: { namespace: "gowm", kind: "WORLD_OBJECT", id: "wrf_1", version: "v1" }, authority: "gowm", pinning: "PINNED" }]
    },
    computeSnapshot: computeSnapshot(),
    receipts: [receipt()],
    evidenceReferences: [evidenceReference()],
    warnings: ["upstream-warning"],
    consumption: { outputBytes: 1 },
    execution: { providerId: expected.providerId, providerVersion: "1.0.0", elapsedMs: 1, resultHash: `sha256:${"f".repeat(64)}` },
    ...(status === "FAILED" ? { error: { code: "UPSTREAM", message: "redacted", retryable: false } } : {})
  };
}

describe("GowmEvidenceNormalizer", () => {
  it("keeps execution receipts separate from authoritative evidence references", () => {
    const result = new GowmEvidenceNormalizer().normalize({ envelope: envelope(), expected });
    expect(result.status).toBe("EVIDENCE");
    if (result.status !== "EVIDENCE") return;
    expect(result.item.receiptIds).toEqual(["receipt-1"]);
    expect(result.item.evidenceIds).toEqual(["world-evidence-1"]);
    expect(result.item.receiptIds).not.toEqual(result.item.evidenceIds);
  });

  it("preserves NO_DATA as unknown and never converts it to false", () => {
    const result = new GowmEvidenceNormalizer().normalize({ envelope: envelope("NO_DATA"), expected });
    expect(result).toMatchObject({
      status: "EVIDENCE",
      item: { upstreamStatus: "NO_DATA", unknowns: ["NO_DATA"], safePayload: { noData: true } }
    });
    expect(JSON.stringify(result)).not.toContain('"false"');
  });

  it("preserves INDETERMINATE and PARTIAL as non-negative unknown states", () => {
    const indeterminate = new GowmEvidenceNormalizer().normalize({ envelope: envelope("INDETERMINATE"), expected });
    expect(indeterminate).toMatchObject({
      status: "EVIDENCE",
      item: { upstreamStatus: "INDETERMINATE", unknowns: ["INDETERMINATE"] }
    });
    const partial = new GowmEvidenceNormalizer().normalize({ envelope: envelope("PARTIAL", { available: [1] }), expected });
    expect(partial).toMatchObject({
      status: "EVIDENCE",
      item: { upstreamStatus: "PARTIAL", safePayload: { available: [1] }, unknowns: ["PARTIAL_RESULT"] }
    });
  });

  it("preserves GOWM authority, payload schema, separate snapshots, and warnings", () => {
    const result = new GowmEvidenceNormalizer().normalize({
      envelope: envelope(),
      expected,
      sourceQueryId: "query-1",
      sourceNodeId: "Node_1"
    });
    if (result.status !== "EVIDENCE") throw new Error("expected evidence");
    expect(result.item).toMatchObject({
      productKind: "WORLD_FACT",
      authority: "gowm.world-snapshot",
      sourceProvider: expected.providerId,
      sourceQueryId: "query-1",
      sourceNodeId: "Node_1",
      payloadSchemaUri: expected.outputSchemaUri,
      payloadSchemaHash: expected.outputSchemaHash,
      warnings: ["upstream-warning"]
    });
    expect(result.item.dataSnapshot).not.toEqual(result.item.computeSnapshot);
    expect((result.item.dataSnapshot as Record<string, unknown>)["scopeDigest"]).toBe(`sha256:${"e".repeat(64)}`);
    expect((result.item.computeSnapshot as Record<string, unknown>)["provider"]).toEqual({ providerId: expected.providerId, providerVersion: "1.0.0" });
  });

  it("replaces large payloads with a bounded hash summary and payload reference", () => {
    const large = { rows: Array.from({ length: 200 }, (_, index) => ({ index, value: "x".repeat(40) })) };
    const result = new GowmEvidenceNormalizer(256).normalize({ envelope: envelope("COMPLETED", large), expected });
    if (result.status !== "EVIDENCE") throw new Error("expected evidence");
    expect(result.item.safePayload).toMatchObject({ summarized: true, keys: ["rows"] });
    expect(result.item.payloadRef).toBe("https://evidence.invalid/artifact-1");
    expect(JSON.stringify(result.item.safePayload)).not.toContain("x".repeat(40));
  });

  it("cannot turn model receipts or unknown envelope fields into evidence", () => {
    const injected = { ...envelope(), modelReceiptIds: ["model-receipt-1"] };
    expect(() => new GowmEvidenceNormalizer().normalize({ envelope: injected, expected }))
      .toThrowError(EvidenceNormalizationError);
    const result = new GowmEvidenceNormalizer().normalize({ envelope: envelope(), expected });
    expect(JSON.stringify(result)).not.toContain("model-receipt");
  });

  it("fails closed on provider, operation, receipt, compute, or schema drift", () => {
    const drift = envelope();
    (drift["output"] as Record<string, unknown>)["schemaHash"] = `sha256:${"0".repeat(64)}`;
    expect(() => new GowmEvidenceNormalizer().normalize({ envelope: drift, expected })).toThrow(/OUTPUT_SCHEMA_MISMATCH/u);
    const badReceipt = envelope();
    ((badReceipt["receipts"] as Record<string, unknown>[])[0]!)["providerId"] = "wrong.provider";
    expect(() => new GowmEvidenceNormalizer().normalize({ envelope: badReceipt, expected })).toThrow(/RECEIPT_AUTHORITY_MISMATCH/u);
  });

  it("preserves FAILED as a failed normalization result without fabricating evidence", () => {
    const result = new GowmEvidenceNormalizer().normalize({ envelope: envelope("FAILED"), expected });
    expect(result).toEqual({ status: "FAILED", errorCode: "UPSTREAM_FAILED", warnings: ["upstream-warning"] });
    expect(result).not.toHaveProperty("item");
  });
});
