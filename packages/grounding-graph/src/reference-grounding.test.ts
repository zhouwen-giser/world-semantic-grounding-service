import type { OperationLock } from "@wsgs/gowm-gateway-client";
import { describe, expect, it, vi } from "vitest";
import type { MergedMention } from "./types.js";
import type { GatewayOperationExecutor } from "./reference-types.js";
import { GowmReferenceGrounder, ReferenceGroundingError } from "./index.js";

const resolveLock: OperationLock = {
  operationId: "reference.resolve",
  operationVersion: "1.0",
  providerId: "gowm.reference-catalog",
  maturity: "PREVIEW",
  inputSchemaHash: "sha256:16d73c457ce186f12557fe52bbebca65e757754ed6d00671faad7e3c65b46a0a",
  outputSchemaHash: "sha256:d8cfb0673f90abd2c88b60522b3df0158f8035f69daf9b760a649566acf27749"
};
const validateLock: OperationLock = {
  operationId: "reference.validate",
  operationVersion: "1.0",
  providerId: "gowm.reference-catalog",
  maturity: "PREVIEW",
  inputSchemaHash: "sha256:cc82bb4d811e91972d022d9742e20d66dfb00a4d00c02e5b7433c51fd252b19e",
  outputSchemaHash: "sha256:db667246c3347ae334e49609df2ffada4fbae620d6812c187d50d3d260362384"
};
const mention: MergedMention = {
  mentionId: "mention-1",
  surfaceText: "滨河路",
  span: { encoding: "UTF16_CODE_UNIT", start: 0, end: 3 },
  expectedKinds: ["ROAD"],
  extractionSources: ["DOMAIN_MODEL"]
};

function descriptor(seed: string, name = `滨河路-${seed}`): Record<string, unknown> {
  return {
    referenceKey: { namespace: "gowm", kind: "SPATIAL_OBJECT", id: `wrf_${seed.repeat(32)}`, version: "v1" },
    referenceType: "ROAD",
    displayName: name,
    stateQuality: { stateConfidence: 0.72, freshnessMs: 20, stale: false },
    version: { referenceVersion: "v1", worldVersion: 42 },
    revalidationRequired: false,
    provenance: []
  };
}

function envelope(lock: OperationLock, value: unknown, status = "COMPLETED"): Record<string, unknown> {
  return {
    providerProtocolVersion: "1.0",
    requestId: "request-1",
    operation: { operationId: lock.operationId, operationVersion: lock.operationVersion },
    status,
    output: { schemaUri: "urn:test", schemaHash: lock.outputSchemaHash, value },
    computeSnapshot: {},
    receipts: [],
    evidenceReferences: [],
    warnings: [],
    consumption: { outputBytes: 1 },
    execution: { providerId: lock.providerId, providerVersion: "1.0.0", elapsedMs: 1 }
  };
}

function resolveResult(status: string, candidates: unknown[]): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    worldVersion: 40,
    resolverVersion: "resolver-1",
    resolutions: [{ mentionId: mention.mentionId, status, candidates }]
  };
}

function candidate(seed: string, matchedBy: string, matchScore: number): Record<string, unknown> {
  return { candidate: descriptor(seed), matchedBy, matchScore };
}

function validateResult(entries: Array<{ seed: string; status?: string; revalidationRequired?: boolean }>): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    results: entries.map((entry) => ({
      referenceKey: { namespace: "gowm", kind: "SPATIAL_OBJECT", id: `wrf_${entry.seed.repeat(32)}`, version: "v1" },
      status: entry.status ?? "VALID",
      revalidationRequired: entry.revalidationRequired ?? false,
      warnings: []
    }))
  };
}

function grounder(
  resolve: unknown,
  validation: unknown = validateResult([{ seed: "a" }]),
  capture?: Array<{ lock: OperationLock; request: Record<string, unknown> }>
): GowmReferenceGrounder {
  const gateway: GatewayOperationExecutor = {
    executeOperation: vi.fn(async (lock, request) => {
      capture?.push({ lock, request });
      return { status: 200, value: envelope(lock, lock.operationId === "reference.resolve" ? resolve : validation) };
    }),
    pollJob: vi.fn(async () => ({}))
  };
  return new GowmReferenceGrounder({ gateway, resolveLock, validateLock, now: () => new Date("2026-08-25T00:00:00Z") });
}

const options = { deadlineAt: new Date("2026-08-25T00:01:00Z"), language: "zh-CN" };

describe("GowmReferenceGrounder", () => {
  it("preserves SUGGESTED_UNIQUE, match/state scores, upstream rank, and world version", async () => {
    const capture: Array<{ lock: OperationLock; request: Record<string, unknown> }> = [];
    const result = await grounder(
      resolveResult("SUGGESTED_UNIQUE", [candidate("a", "EXACT_ALIAS", 0.91)]),
      validateResult([{ seed: "a" }]),
      capture
    ).ground("request-1", "idem-1", [mention], options);
    expect(result.mentions[0]).toMatchObject({ status: "SUGGESTED_UNIQUE" });
    expect(result.referenceProducts[0]).toMatchObject({
      matchedBy: "EXACT_ALIAS",
      matchScore: 0.91,
      stateConfidence: 0.72,
      sourceWorldVersion: 42,
      safeSummary: { providerRank: 0 }
    });
    const resolveInput = capture[0]?.request["input"] as Record<string, unknown>;
    expect(resolveInput).not.toHaveProperty("dataScope");
    expect(capture[0]?.request).toMatchObject({
      operationVersion: resolveLock.operationVersion,
      inputSchemaHash: resolveLock.inputSchemaHash,
      outputSchemaHash: resolveLock.outputSchemaHash
    });
  });

  it("keeps all ambiguous candidates in provider order and confirms none", async () => {
    const result = await grounder(
      resolveResult("AMBIGUOUS", [candidate("a", "EXACT_CANONICAL_NAME", 0.95), candidate("b", "EXACT_ALIAS", 0.93)]),
      validateResult([{ seed: "a" }, { seed: "b" }])
    ).ground("request-1", "idem-1", [mention], options);
    expect(result.mentions[0]).toMatchObject({ status: "AMBIGUOUS" });
    expect(result.mentions[0]?.candidateProductIds).toEqual(result.referenceProducts.map((product) => product.productId));
    expect(result.ambiguities[0]).toMatchObject({ reason: "MULTIPLE_EXACT_MATCHES" });
    expect(JSON.stringify(result)).not.toContain("CONFIRMED");
    expect(JSON.stringify(result)).not.toContain("selectedCandidate");
  });

  it("normalizes NO_DATA and zero candidates to UNRESOLVED rather than FAILED", async () => {
    const noCandidate = await grounder(resolveResult("UNRESOLVED", [])).ground("request-1", "idem-1", [mention], options);
    expect(noCandidate.mentions[0]).toMatchObject({ status: "UNRESOLVED", candidateProductIds: [] });
    expect(noCandidate.unresolvedMentions[0]).toMatchObject({ reason: "UNRESOLVED" });

    const gateway: GatewayOperationExecutor = {
      executeOperation: vi.fn(async (lock) => ({
        status: 200,
        value: { ...envelope(lock, null, "NO_DATA"), output: undefined }
      })),
      pollJob: vi.fn(async () => ({}))
    };
    const noData = await new GowmReferenceGrounder({ gateway, resolveLock, validateLock })
      .ground("request-1", "idem-1", [mention], { deadlineAt: new Date(Date.now() + 10_000) });
    expect(noData.mentions[0]?.status).toBe("UNRESOLVED");
  });

  it("preserves stale/expired validation as explicit revalidation state", async () => {
    const result = await grounder(
      resolveResult("RESOLVED_EXACT", [candidate("a", "EXACT_CODE", 1)]),
      validateResult([{ seed: "a", status: "EXPIRED", revalidationRequired: true }])
    ).ground("request-1", "idem-1", [mention], options);
    expect(result.validationResults[0]).toMatchObject({ status: "EXPIRED", revalidationRequired: true });
    expect(result.referenceProducts[0]).toMatchObject({
      revalidationRequired: true,
      safeSummary: { providerRank: 0, validationStatus: "EXPIRED" }
    });
  });

  it("enforces mention and candidate bounds", async () => {
    const tooManyMentions = Array.from({ length: 33 }, (_, index) => ({ ...mention, mentionId: `mention-${index}` }));
    await expect(grounder(resolveResult("UNRESOLVED", [])).ground("request-1", "idem-1", tooManyMentions, options))
      .rejects.toMatchObject({ code: "MENTION_BATCH_LIMIT" });
    const tooManyCandidates = Array.from({ length: 21 }, (_, index) => candidate(index.toString(16).slice(-1), "FUZZY_NAME", 0.5));
    await expect(grounder(resolveResult("AMBIGUOUS", tooManyCandidates)).ground("request-1", "idem-1", [mention], options))
      .rejects.toMatchObject({ code: "INVALID_RESOLUTION_STATUS_OR_LIMIT" });
  });

  it("fails closed on provider or output-schema authority drift", async () => {
    const gateway: GatewayOperationExecutor = {
      executeOperation: vi.fn(async (lock) => ({
        status: 200,
        value: {
          ...envelope(lock, resolveResult("UNRESOLVED", [])),
          execution: { providerId: "wrong.provider", providerVersion: "1", elapsedMs: 1 }
        }
      })),
      pollJob: vi.fn(async () => ({}))
    };
    await expect(new GowmReferenceGrounder({ gateway, resolveLock, validateLock })
      .ground("request-1", "idem-1", [mention], { deadlineAt: new Date(Date.now() + 10_000) }))
      .rejects.toMatchObject({ code: "GATEWAY_AUTHORITY_MISMATCH" });
  });

  it("accepts only terminal successful async jobs", async () => {
    const gateway: GatewayOperationExecutor = {
      executeOperation: vi.fn(async () => ({ status: 202, value: { jobId: "job-1" } })),
      pollJob: vi.fn(async (_jobId, _context) => ({
        status: "COMPLETED",
        result: envelope(resolveLock, resolveResult("UNRESOLVED", []))
      }))
    };
    const result = await new GowmReferenceGrounder({ gateway, resolveLock, validateLock })
      .ground("request-1", "idem-1", [mention], { deadlineAt: new Date(Date.now() + 10_000) });
    expect(result.mentions[0]?.status).toBe("UNRESOLVED");
    expect(gateway.pollJob).toHaveBeenCalledWith("job-1", expect.objectContaining({ deadlineAt: expect.any(Date) }));
  });

  it("rejects expired caller deadlines before transport", async () => {
    const gateway: GatewayOperationExecutor = {
      executeOperation: vi.fn(async () => { throw new Error("must not call"); }),
      pollJob: vi.fn(async () => ({}))
    };
    const service = new GowmReferenceGrounder({ gateway, resolveLock, validateLock, now: () => new Date("2026-08-25T01:00:00Z") });
    const error = await service.ground("request-1", "idem-1", [mention], {
      deadlineAt: new Date("2026-08-25T00:00:00Z")
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ReferenceGroundingError);
    expect((error as ReferenceGroundingError).code).toBe("DEADLINE_EXCEEDED");
    expect(gateway.executeOperation).not.toHaveBeenCalled();
  });
});
