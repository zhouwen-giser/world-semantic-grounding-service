import { describe, expect, it } from "vitest";

import {
  calculateManifestHash,
  PriorGroundingValidator,
  sha256Bytes,
  type PriorGroundingIdentity,
  type PriorGroundingStore,
  type PriorValidationGateway,
  type PriorValidationGatewayRequest,
  type PriorValidationGatewayResponse,
  type QuerySnapshotManifest,
  type StoredPriorGrounding,
  type ValidationOperationLock,
} from "./index.js";

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

const identity: PriorGroundingIdentity = {
  servicePrincipalId: "wsgs-runtime",
  actorId: "actor-1",
  dataScopes: ["tenant-a"],
  datasetScopes: ["dataset-roads", "dataset-world"],
  permissions: ["data:read"],
  authorizationContextHash: digest("a"),
};

const referenceKey = {
  namespace: "gowm" as const,
  kind: "QUERY_RESULT",
  id: `wrf_${"1".repeat(32)}`,
  version: "result-v1",
};

function snapshot(
  overrides: Partial<Omit<QuerySnapshotManifest, "manifestHash">> = {},
): QuerySnapshotManifest {
  const unsigned: Omit<QuerySnapshotManifest, "manifestHash"> = {
    querySnapshotId: "snapshot-source-1",
    mode: "LATEST_AT_START",
    consistency: "CONSISTENT_AT_START",
    capturedAt: "2026-08-27T01:00:00.000Z",
    resources: [{
      resourceKind: "DATASET",
      resourceId: "roads",
      version: "roads-v7",
      contentHash: digest("b"),
      worldVersion: 42,
      pinning: "PINNED",
    }],
    minimumWorldVersion: 42,
    ...overrides,
  };
  return { ...unsigned, manifestHash: calculateManifestHash(unsigned) };
}

function locks(snapshotSupport: ValidationOperationLock["snapshotSupport"] = "PINNED"): ValidationOperationLock[] {
  return (["reference.validate", "result.validate"] as const).map((operationId, index) => ({
    operationId,
    operationVersion: "1.0",
    maturity: "STABLE",
    inputSchemaHash: digest(index === 0 ? "1" : "2"),
    outputSchemaHash: digest(index === 0 ? "3" : "4"),
    semanticProfileHash: digest(index === 0 ? "5" : "6"),
    snapshotSupport,
    requiredPermissions: ["data:read"],
  }));
}

function storedResult(overrides: Partial<StoredPriorGrounding> = {}): StoredPriorGrounding {
  const document = {
    schemaVersion: "1.0",
    groundingId: "grounding-previous-1",
    referenceProducts: [{
      productId: "product-1",
      productKind: "QUERY_RESULT",
      referenceKey,
      referenceType: "QUERY_RESULT",
    }],
    evidenceItems: [],
  };
  return {
    groundingId: "grounding-previous-1",
    servicePrincipalId: identity.servicePrincipalId,
    actorId: identity.actorId,
    dataScope: "tenant-a",
    datasetScopes: [...identity.datasetScopes],
    authorizationContextHash: identity.authorizationContextHash,
    resultBytes: Buffer.from(JSON.stringify(document), "utf8"),
    querySnapshotManifest: snapshot(),
    ...overrides,
  };
}

function pointer(stored: StoredPriorGrounding): Record<string, unknown> {
  return {
    groundingId: stored.groundingId,
    resultHash: sha256Bytes(stored.resultBytes),
    selectedProductIds: ["product-1"],
  };
}

function validationResult(
  request: PriorValidationGatewayRequest,
  resultOverrides: Record<string, unknown> = {},
  responseOverrides: Partial<PriorValidationGatewayResponse> = {},
): PriorValidationGatewayResponse {
  const pinned = request.snapshotPolicy.pinnedSnapshot;
  return {
    operationId: request.operation.operationId,
    operationVersion: request.operation.operationVersion,
    status: "COMPLETED",
    value: {
      schemaVersion: "1.0",
      results: request.input.references.map(({ referenceKey: key }) => ({
        schemaVersion: "1.0",
        referenceKey: key,
        existence: "AVAILABLE",
        freshness: "CURRENT",
        snapshot: "CURRENT",
        usable: "YES",
        reasons: [],
        ...resultOverrides,
      })),
    },
    snapshotManifest: pinned,
    snapshotAdherence: pinned.resources.map(({ resourceKind, resourceId }) => ({
      resourceKind,
      resourceId,
      status: "MATCHED" as const,
    })),
    ...responseOverrides,
  };
}

function harness(options: {
  stored?: StoredPriorGrounding | null;
  gatewayResponse?: (
    request: PriorValidationGatewayRequest,
    call: number,
  ) => PriorValidationGatewayResponse | Promise<PriorValidationGatewayResponse>;
  operationLocks?: ValidationOperationLock[];
} = {}): {
  validator: PriorGroundingValidator;
  stored: StoredPriorGrounding;
  calls: PriorValidationGatewayRequest[];
  reads: Array<{ groundingId: string; actorId: string; dataScope: string }>;
} {
  const stored = options.stored === undefined ? storedResult() : options.stored ?? storedResult();
  const reads: Array<{ groundingId: string; actorId: string; dataScope: string }> = [];
  const store: PriorGroundingStore = {
    async read(input) {
      reads.push(input);
      return options.stored === null ? null : stored;
    },
  };
  const calls: PriorValidationGatewayRequest[] = [];
  const gateway: PriorValidationGateway = {
    async execute(request) {
      calls.push(request);
      return options.gatewayResponse?.(request, calls.length) ?? validationResult(request);
    },
  };
  return {
    validator: new PriorGroundingValidator({
      store,
      gateway,
      operationLocks: options.operationLocks ?? locks(),
      now: () => new Date("2026-08-27T02:00:00.000Z"),
    }),
    stored,
    calls,
    reads,
  };
}

describe("Prior Grounding revalidation boundary", () => {
  it("loads only trusted historical bytes and revalidates every selection with both exact operations at a pinned snapshot", async () => {
    const test = harness();
    const result = await test.validator.revalidate({
      identity,
      dataScope: "tenant-a",
      pointer: pointer(test.stored),
    });

    expect(test.reads).toEqual([{
      groundingId: "grounding-previous-1",
      actorId: "actor-1",
      dataScope: "tenant-a",
    }]);
    expect(test.calls.map(({ operation }) => `${operation.operationId}@${operation.operationVersion}`)).toEqual([
      "reference.validate@1.0",
      "result.validate@1.0",
    ]);
    for (const call of test.calls) {
      expect(call.snapshotPolicy).toMatchObject({ mode: "PINNED", allowDowngrade: false });
      expect(call.snapshotPolicy.pinnedSnapshot).toMatchObject({
        mode: "PINNED",
        consistency: "PINNED",
        capturedAt: test.stored.querySnapshotManifest.capturedAt,
      });
      expect(call.input).toEqual({
        schemaVersion: "1.0",
        references: [{ referenceKey, requireCurrentSnapshot: true }],
      });
      expect(call.identity).toEqual(identity);
      expect(call.deadlineAt).toBe("2026-08-27T02:00:30.000Z");
    }
    expect(result).toMatchObject({
      groundingId: "grounding-previous-1",
      dataScope: "tenant-a",
      datasetScopes: ["dataset-roads", "dataset-world"],
      status: "REVALIDATED",
      products: [{
        productId: "product-1",
        usable: true,
        validations: [
          { operationId: "reference.validate", operationVersion: "1.0", status: "VALID" },
          { operationId: "result.validate", operationVersion: "1.0", status: "VALID" },
        ],
      }],
    });
    expect(result.sourceResultHash).toBe(pointer(test.stored)["resultHash"]);
    expect(result.revalidationHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("keeps an already pinned, hash-valid historical manifest unchanged and produces a stable result hash", async () => {
    const pinned = snapshot({ mode: "PINNED", consistency: "PINNED" });
    const test = harness({ stored: storedResult({ querySnapshotManifest: pinned }) });
    const first = await test.validator.revalidate({ identity, dataScope: "tenant-a", pointer: pointer(test.stored) });
    const second = await test.validator.revalidate({ identity, dataScope: "tenant-a", pointer: pointer(test.stored) });

    expect(first.snapshotManifest).toEqual(pinned);
    expect(second.revalidationHash).toBe(first.revalidationHash);
    expect(test.calls[0]?.requestId).toBe(test.calls[2]?.requestId);
    expect(test.calls[1]?.idempotencyKey).toBe(test.calls[3]?.idempotencyKey);
  });

  it("rejects caller-supplied historical content before reading storage", async () => {
    const test = harness();
    await expect(test.validator.revalidate({
      identity,
      dataScope: "tenant-a",
      pointer: { ...pointer(test.stored), result: { forged: true } },
    })).rejects.toMatchObject({ code: "PRIOR_CONTENT_SUBSTITUTION_FORBIDDEN", httpStatus: 400 });
    expect(test.reads).toHaveLength(0);
    expect(test.calls).toHaveLength(0);
  });

  it("checks the exact original bytes rather than parsed JSON equivalence", async () => {
    const test = harness();
    await expect(test.validator.revalidate({
      identity,
      dataScope: "tenant-a",
      pointer: { ...pointer(test.stored), resultHash: digest("0") },
    })).rejects.toMatchObject({ code: "PRIOR_RESULT_HASH_MISMATCH", httpStatus: 409 });
    expect(test.calls).toHaveLength(0);
  });

  it.each([
    ["servicePrincipalId", "other-service"],
    ["actorId", "other-actor"],
    ["dataScope", "tenant-b"],
    ["datasetScopes", ["dataset-roads"]],
    ["authorizationContextHash", digest("f")],
  ] as const)("hides a stored %s scope mismatch behind the same not-found boundary", async (field, value) => {
    const test = harness({ stored: storedResult({ [field]: value }) });
    await expect(test.validator.revalidate({
      identity,
      dataScope: "tenant-a",
      pointer: pointer(test.stored),
    })).rejects.toMatchObject({ code: "PRIOR_RESULT_NOT_FOUND_IN_SCOPE", httpStatus: 404 });
    expect(test.calls).toHaveLength(0);
  });

  it("does not reveal whether a cross-actor scoped record exists", async () => {
    const test = harness({ stored: null });
    await expect(test.validator.revalidate({
      identity,
      dataScope: "tenant-a",
      pointer: pointer(test.stored),
    })).rejects.toMatchObject({ code: "PRIOR_RESULT_NOT_FOUND_IN_SCOPE", httpStatus: 404 });
  });

  it("fails when a selected product is missing or cannot supply a locked GOWM ReferenceKey", async () => {
    const missing = harness();
    await expect(missing.validator.revalidate({
      identity,
      dataScope: "tenant-a",
      pointer: { ...pointer(missing.stored), selectedProductIds: ["missing"] },
    })).rejects.toMatchObject({ code: "SELECTED_PRIOR_PRODUCT_NOT_FOUND", httpStatus: 409 });

    const document = {
      groundingId: "grounding-previous-1",
      referenceProducts: [{ productId: "product-1", productKind: "QUERY_RESULT" }],
      evidenceItems: [],
    };
    const notRevalidatable = harness({
      stored: storedResult({ resultBytes: Buffer.from(JSON.stringify(document), "utf8") }),
    });
    await expect(notRevalidatable.validator.revalidate({
      identity,
      dataScope: "tenant-a",
      pointer: pointer(notRevalidatable.stored),
    })).rejects.toMatchObject({ code: "PRIOR_PRODUCT_NOT_REVALIDATABLE", httpStatus: 409 });
  });

  it("fails closed when the stored snapshot hash or resource pin cannot be replayed", async () => {
    const hashMismatch = harness({
      stored: storedResult({ querySnapshotManifest: { ...snapshot(), manifestHash: digest("0") } }),
    });
    await expect(hashMismatch.validator.revalidate({
      identity,
      dataScope: "tenant-a",
      pointer: pointer(hashMismatch.stored),
    })).rejects.toMatchObject({ code: "PRIOR_SNAPSHOT_MANIFEST_HASH_MISMATCH", httpStatus: 409 });

    const weak = snapshot({
      resources: [{ resourceKind: "DATASET", resourceId: "roads", version: "v7", pinning: "AT_LEAST" }],
    });
    const weakPin = harness({ stored: storedResult({ querySnapshotManifest: weak }) });
    await expect(weakPin.validator.revalidate({
      identity,
      dataScope: "tenant-a",
      pointer: pointer(weakPin.stored),
    })).rejects.toMatchObject({ code: "PRIOR_SNAPSHOT_NOT_REPLAYABLE", httpStatus: 409 });
  });

  it.each([
    ["missing proof", (request: PriorValidationGatewayRequest) => {
      const response = validationResult(request);
      delete response.snapshotManifest;
      return response;
    }],
    ["partial result", (request: PriorValidationGatewayRequest) => validationResult(request, {}, { status: "PARTIAL" })],
    ["mismatched adherence", (request: PriorValidationGatewayRequest) => validationResult(request, {}, {
      snapshotAdherence: [{ resourceKind: "DATASET", resourceId: "roads", status: "MISMATCHED" }],
    })],
  ] as const)("rejects a validation response with %s", async (_label, response) => {
    const test = harness({ gatewayResponse: response });
    await expect(test.validator.revalidate({
      identity,
      dataScope: "tenant-a",
      pointer: pointer(test.stored),
    })).rejects.toBeInstanceOf(Error);
  });

  it("does not downgrade when the provider returns a different valid snapshot", async () => {
    const test = harness({
      gatewayResponse(request) {
        const different = snapshot({
          mode: "PINNED",
          consistency: "PINNED",
          resources: [{ resourceKind: "DATASET", resourceId: "roads", version: "roads-v8", pinning: "PINNED" }],
        });
        return validationResult(request, {}, { snapshotManifest: different });
      },
    });
    await expect(test.validator.revalidate({
      identity,
      dataScope: "tenant-a",
      pointer: pointer(test.stored),
    })).rejects.toMatchObject({ code: "PINNED_SNAPSHOT_MISMATCH", httpStatus: 409 });
  });

  it("maps stale validation to an unusable product instead of recycling it", async () => {
    const test = harness({
      gatewayResponse(request) {
        return validationResult(request, { freshness: "STALE", snapshot: "STALE", usable: "REVALIDATE" });
      },
    });
    const result = await test.validator.revalidate({ identity, dataScope: "tenant-a", pointer: pointer(test.stored) });
    expect(result.status).toBe("REVALIDATION_REQUIRED");
    expect(result.products[0]).toMatchObject({
      usable: false,
      validations: [{ status: "STALE" }, { status: "STALE" }],
    });
  });

  it("turns upstream scope denial into the same non-enumerating 404", async () => {
    const test = harness({
      gatewayResponse(request) {
        return validationResult(request, { existence: "SCOPE_DENIED", freshness: "UNKNOWN", snapshot: "UNKNOWN", usable: "NO" });
      },
    });
    await expect(test.validator.revalidate({
      identity,
      dataScope: "tenant-a",
      pointer: pointer(test.stored),
    })).rejects.toMatchObject({ code: "PRIOR_RESULT_NOT_FOUND_IN_SCOPE", httpStatus: 404 });
  });

  it("rejects operation locks or identities that cannot preserve the pinned and permission invariants", async () => {
    expect(() => harness({ operationLocks: locks("CONSISTENT_AT_START") })).toThrowError(expect.objectContaining({
      code: "PINNED_VALIDATION_OPERATION_UNAVAILABLE",
      httpStatus: 503,
    }));

    const test = harness();
    await expect(test.validator.revalidate({
      identity: { ...identity, permissions: [] },
      dataScope: "tenant-a",
      pointer: pointer(test.stored),
    })).rejects.toMatchObject({ code: "VALIDATION_PERMISSION_REQUIRED", httpStatus: 403 });
    expect(test.calls).toHaveLength(0);
  });
});
