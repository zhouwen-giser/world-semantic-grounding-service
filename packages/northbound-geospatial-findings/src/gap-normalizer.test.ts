import { readFileSync } from "node:fs";

import { defaultSacsGeospatialSchemaRegistry } from "@wsgs/contracts";
import {
  createGdpsV021FinalBFindingAuthority,
  resolveGdpsFindingOperationAuthority
} from "@wsgs/gdps-descriptor-consumer";
import { gdpsV021FindingContractClosure } from "@wsgs/gowm-contract-intake";
import {
  validateGowmFindingResultEnvelope,
  type GowmCapabilityResultEnvelope,
  type GowmFindingResultStatus,
  type ValidatedGowmFindingResult
} from "@wsgs/gowm-execution-evidence";
import { describe, expect, it } from "vitest";

import { canonicalSha256 } from "./canonical.js";
import {
  GapNormalizationError,
  normalizeGeospatialGaps,
  type GapNormalizationInput
} from "./gap-normalizer.js";
import {
  createTrustedSourceContext,
  normalizeSourceProducts,
  readNormalizedSourceProductBinding,
  type NormalizedSourceProductBinding
} from "./source-normalizer.js";

type TestVectors = {
  payloads: {
    pointMeasurement: unknown;
    pointMeasurementGenericService: Record<string, unknown>;
    currentProductGet: Record<string, unknown>;
  };
};

const testVectors = JSON.parse(readFileSync(
  new URL("../fixtures/gdps-real-result-shapes.json", import.meta.url),
  "utf8"
)) as TestVectors;
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const dataScope = "scope-gdps-v021-baseline";
const scopeDigest = canonicalSha256({ dataScopeKey: dataScope });
const finalAuthority = createGdpsV021FinalBFindingAuthority();

interface RuntimeOptions {
  readonly status?: GowmFindingResultStatus;
  readonly code?: string;
  readonly operationId?: "elevation.sample" | "geo-raster.sample" | "geo-product.get" | "geo-product.search";
  readonly descriptorId?: "ELEVATION_DTM/DEFAULT";
  readonly payload?: unknown;
  readonly includeReceipt?: boolean;
  readonly includeDataSnapshot?: boolean;
}

interface RuntimeTokens {
  readonly validatedResult: ValidatedGowmFindingResult;
  readonly sourceBinding: NormalizedSourceProductBinding;
  readonly trustedContext: ReturnType<typeof createTrustedSourceContext>;
}

function runtime(options: RuntimeOptions = {}): RuntimeTokens {
  const status = options.status ?? "COMPLETED";
  const operationId = options.operationId ?? "elevation.sample";
  const descriptorId = operationId.startsWith("geo-product.")
    ? undefined
    : options.descriptorId ?? "ELEVATION_DTM/DEFAULT";
  const operation = { operationId, operationVersion: "1.0" };
  const lock = gdpsV021FindingContractClosure.operations.find((candidate) =>
    candidate.operationId === operationId && candidate.operationVersion === "1.0")!;
  const authority = resolveGdpsFindingOperationAuthority(finalAuthority, {
    ...operation,
    semanticConcept: operationId.startsWith("geo-product.") ? "geospatial.product.catalog" : "terrain.elevation",
    ...(descriptorId === undefined ? {} : { descriptorId })
  });
  const computeSnapshot = {
    provider: {
      providerId: gdpsV021FindingContractClosure.provider.providerId,
      providerVersion: gdpsV021FindingContractClosure.provider.providerVersion,
      implementationDigest: gdpsV021FindingContractClosure.provider.implementationDigest
    },
    operation,
    engine: { name: "gdps-python", version: "0.2.1", digest: digest("b") },
    policy: { version: "gdps-budget/1.0", digest: digest("c") },
    schemas: { inputSchemaHash: lock.inputSchemaHash, outputSchemaHash: lock.outputSchemaHash }
  };
  const payload = options.payload ?? testVectors.payloads.pointMeasurement;
  const output = status === "FAILED"
    ? undefined
    : { schemaUri: lock.outputSchemaUri, schemaHash: lock.outputSchemaHash, value: payload };
  const outputHash = output === undefined ? undefined : canonicalSha256(output.value);
  const payloadRecord = payload as Record<string, unknown>;
  const nestedPayload = payloadRecord["result"] as Record<string, unknown> | undefined;
  const payloadProductId = payloadRecord["productId"] ?? nestedPayload?.["productId"];
  const payloadContentHash = payloadRecord["contentHash"] ?? nestedPayload?.["contentHash"];
  const catalogSnapshot = operationId.startsWith("geo-product.");
  const snapshotDigest = catalogSnapshot && output !== undefined
    ? canonicalSha256(payload)
    : typeof payloadContentHash === "string" ? payloadContentHash as `sha256:${string}` : digest("1");
  const snapshotReferenceId = output === undefined
    || catalogSnapshot
    || typeof payloadProductId !== "string"
    ? `catalog:${dataScope}`
    : `${dataScope}:${payloadProductId}`;
  const envelope: GowmCapabilityResultEnvelope = {
    providerProtocolVersion: "1.0",
    requestId: `request.n03.gap.${status.toLowerCase()}`,
    operation,
    status,
    ...(output === undefined ? {} : { output }),
    ...(options.code === undefined ? {} : {
      error: {
        schemaVersion: "1.0",
        requestId: `request.n03.gap.${status.toLowerCase()}`,
        error: {
          code: options.code,
          message: "Public contract error",
          retryable: false,
          stage: "PROVIDER_EXECUTION"
        }
      }
    }),
    ...(options.includeDataSnapshot === false ? {} : {
      dataSnapshot: {
        consistency: "CONSISTENT_AT_START",
        capturedAt: "2026-08-30T00:00:00Z",
        scopeDigest,
        resources: [{
          referenceKey: {
            namespace: "gdps",
            kind: "DATASET",
            id: snapshotReferenceId,
            version: snapshotDigest
          },
          authority: gdpsV021FindingContractClosure.provider.providerId,
          pinning: "PINNED",
          digest: snapshotDigest
        }]
      }
    }),
    computeSnapshot,
    receipts: outputHash === undefined || options.includeReceipt === false ? [] : [{
      receiptId: `receipt.n03.gap.${status.toLowerCase()}`,
      operationId,
      operationVersion: "1.0",
      providerId: gdpsV021FindingContractClosure.provider.providerId,
      providerVersion: gdpsV021FindingContractClosure.provider.providerVersion,
      inputHash: digest("f"),
      outputHash,
      computeSnapshotHash: canonicalSha256(computeSnapshot),
      generatedAt: "2026-08-30T00:00:00Z",
      durationMs: 1,
      method: {
        engine: "gdps-python",
        engineVersion: "0.2.1",
        methodId: "descriptor-query",
        methodVersion: "1.0"
      },
      changes: { repairApplied: false, typeChanged: false },
      warnings: []
    }],
    evidenceReferences: [{
      evidenceId: `evidence.n03.gap.${status.toLowerCase()}`,
      authority: gdpsV021FindingContractClosure.provider.providerId,
      evidenceType: "CURRENT_PROJECTION_SOURCE",
      referenceKey: {
        namespace: "gdps",
        kind: "DATASET",
        id: snapshotReferenceId,
        version: snapshotDigest
      },
      schemaUri: "urn:gdps:current-product:1.0",
      schemaHash: digest("1"),
      observedAt: "2026-08-30T00:00:00Z"
    }],
    warnings: [],
    consumption: { inputBytes: 1, outputBytes: output === undefined ? 0 : 1, rows: 1 },
    execution: {
      providerId: gdpsV021FindingContractClosure.provider.providerId,
      providerVersion: gdpsV021FindingContractClosure.provider.providerVersion,
      elapsedMs: 1,
      ...(outputHash === undefined ? {} : { resultHash: outputHash })
    }
  };
  const validatedResult = validateGowmFindingResultEnvelope(authority, envelope);
  const identity = {
    servicePrincipalId: "principal.n03.test",
    actorId: "actor.n03.test",
    dataScopes: [dataScope],
    datasetScopes: ["wsgs-demo-main"],
    permissions: ["wsgs.grounding.execute"]
  };
  const trustedContext = createTrustedSourceContext({
    ...identity,
    authorizationContextHash: canonicalSha256(identity)
  }, dataScope);
  const tokens = {
    validatedResult,
    sourceBinding: normalizeSourceProducts({ trustedContext, validatedResults: [validatedResult] })
  } as RuntimeTokens;
  Object.defineProperty(tokens, "trustedContext", { value: trustedContext, enumerable: false });
  return tokens;
}

function input(
  options: RuntimeOptions = {},
  findingIds: readonly string[] = []
): GapNormalizationInput {
  return { ...runtime(options), findingIds };
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("EXPECTED_GAP_NORMALIZATION_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(GapNormalizationError);
    expect((error as GapNormalizationError).code).toBe(code);
  }
}

describe("normalizeGeospatialGaps opaque authority boundary", () => {
  it("preserves a completed result without inventing a gap", () => {
    const result = normalizeGeospatialGaps(input());
    expect(result.status).toBe("COMPLETED");
    expect(result.gaps).toEqual([]);
  });

  it("keeps a partial empty catalog partial instead of claiming authoritative no-data", () => {
    const result = normalizeGeospatialGaps(input({
      status: "PARTIAL",
      operationId: "geo-product.search",
      payload: {
        schemaVersion: "gdps-product-search-result/1.0",
        products: [],
        truncated: false
      }
    }));
    expect(result.status).toBe("PARTIAL");
    expect(result.gaps).toEqual([
      expect.objectContaining({ gapKind: "DATA_GAP", severity: "WARNING" })
    ]);
  });

  it.each([
    ["PRODUCT_NOT_AVAILABLE", "DATA_GAP", "NO_DATA"],
    ["NO_DATA_AT_LOCATION", "DATA_GAP", "NO_DATA"],
    ["PRODUCT_COVERAGE_INSUFFICIENT", "COVERAGE_GAP", "NO_DATA"],
    ["QUERY_PROFILE_UNSUPPORTED", "CAPABILITY_GAP", "INDETERMINATE"],
    ["OPERATION_UNAVAILABLE", "CAPABILITY_GAP", "INDETERMINATE"],
    ["PRODUCT_COVERAGE_AMBIGUOUS", "PRODUCT_SELECTION_AMBIGUITY", "INDETERMINATE"],
    ["AMBIGUOUS_PRODUCT_SELECTION", "PRODUCT_SELECTION_AMBIGUITY", "INDETERMINATE"]
  ] as const)("derives %s without accepting a caller outcome", (code, gapKind, status) => {
    const result = normalizeGeospatialGaps(input({ status: "NO_DATA", code }));
    expect(result.status).toBe(status);
    expect(result.gaps[0]?.gapKind).toBe(gapKind);
  });

  it("keeps FAILED and INDETERMINATE blocking and never converts them to DATA_GAP", () => {
    const failed = normalizeGeospatialGaps(input({ status: "FAILED", code: "PRODUCT_NOT_AVAILABLE" }));
    const indeterminate = normalizeGeospatialGaps(input({ status: "INDETERMINATE" }));
    for (const result of [failed, indeterminate]) {
      expect(result.status).toBe("INDETERMINATE");
      expect(result.gaps[0]).toMatchObject({ gapKind: "UPSTREAM_FAILURE", severity: "BLOCKING" });
    }
  });

  it("derives SOURCE_CHANGED from an indeterminate contract code", () => {
    const result = normalizeGeospatialGaps(input({
      status: "INDETERMINATE",
      code: "SOURCE_CHANGED_DURING_QUERY"
    }));
    expect(result.status).toBe("INDETERMINATE");
    expect(result.gaps[0]).toMatchObject({ gapKind: "SOURCE_CHANGED", severity: "BLOCKING" });
  });

  it.each([
    ["FAILED", "QUERY_PROFILE_UNSUPPORTED", "CAPABILITY_GAP"],
    ["FAILED", "OPERATION_UNAVAILABLE", "CAPABILITY_GAP"],
    ["INDETERMINATE", "PRODUCT_COVERAGE_AMBIGUOUS", "PRODUCT_SELECTION_AMBIGUITY"],
    ["INDETERMINATE", "AMBIGUOUS_PRODUCT_SELECTION", "PRODUCT_SELECTION_AMBIGUITY"],
    ["FAILED", "RECIPE_LOCK_DRIFT", "UPSTREAM_FAILURE"],
    ["FAILED", "DESCRIPTOR_LOCK_DRIFT", "UPSTREAM_FAILURE"]
  ] as const)("keeps terminal %s/%s blocking as %s", (status, code, gapKind) => {
    const result = normalizeGeospatialGaps(input({ status, code }));
    expect(result.status).toBe("INDETERMINATE");
    expect(result.gaps[0]).toMatchObject({ gapKind, severity: "BLOCKING" });
  });

  it("gives the platform terminal error priority over an untrusted payload code", () => {
    const payload = { code: "QUERY_PROFILE_UNSUPPORTED", message: "Unsupported query profile" };
    const result = normalizeGeospatialGaps(input({
      status: "INDETERMINATE",
      code: "INTEGRITY",
      payload
    }));
    expect(result.status).toBe("INDETERMINATE");
    expect(result.gaps[0]).toMatchObject({ gapKind: "UPSTREAM_FAILURE", severity: "BLOCKING" });
  });

  it("rejects an empty/no-data result which simultaneously claims truncation", () => {
    const payload = {
      schemaVersion: "gdps-product-search-result/1.0",
      products: [],
      truncated: true
    };
    expectCode(() => normalizeGeospatialGaps(input({
      operationId: "geo-product.search",
      payload
    })), "EMPTY_TRUNCATED_RESULT_CONTRADICTION");
  });

  it.each(["NO_DATA", "INDETERMINATE"] as const)(
    "emits blocking evidence gap when %s has no local evidence",
    (status) => {
      const result = normalizeGeospatialGaps(input({ status, includeDataSnapshot: false }));
      expect(result.status).toBe("INDETERMINATE");
      expect(result.gaps).toEqual(expect.arrayContaining([
        expect.objectContaining({ gapKind: "EVIDENCE_INCOMPLETE", severity: "BLOCKING" })
      ]));
    }
  );

  it("derives a blocking EVIDENCE_INCOMPLETE gap from a rejected opaque binding", () => {
    const tokens = runtime({ includeDataSnapshot: false });
    expect(readNormalizedSourceProductBinding(tokens.sourceBinding).envelopeBindings[0]?.qualification)
      .toEqual({ status: "REJECTED", reason: "EVIDENCE_INCOMPLETE" });
    const result = normalizeGeospatialGaps(tokens);
    expect(result.status).toBe("INDETERMINATE");
    expect(result.gaps).toEqual([
      expect.objectContaining({
        gapKind: "EVIDENCE_INCOMPLETE",
        severity: "BLOCKING",
        messageCode: "WSGS_EVIDENCE_INCOMPLETE"
      })
    ]);
    expect(result.gaps[0]).not.toHaveProperty("findingIds");
    expect(result.gaps[0]).not.toHaveProperty("evidenceItemIds");
  });

  it("derives a blocking UNSUPPORTED_FINDING_SCHEMA gap without publishing rejected facts", () => {
    const payload = structuredClone(testVectors.payloads.currentProductGet);
    delete payload["metadata"];
    const tokens = runtime({ operationId: "geo-product.get", payload });
    expect(readNormalizedSourceProductBinding(tokens.sourceBinding)).toMatchObject({
      sourceProducts: [],
      envelopeBindings: [{
        qualification: { status: "REJECTED", reason: "UNSUPPORTED_FINDING_SCHEMA" },
        sourceProductIds: [],
        evidenceItemIds: []
      }]
    });
    const result = normalizeGeospatialGaps(tokens);
    expect(result.status).toBe("INDETERMINATE");
    expect(result.gaps).toEqual([
      expect.objectContaining({
        gapKind: "UNSUPPORTED_FINDING_SCHEMA",
        severity: "BLOCKING",
        messageCode: "WSGS_UNSUPPORTED_FINDING_SCHEMA"
      })
    ]);
  });

  it("derives SOURCE_CHANGED from an all-rejected aggregate and keeps FK sets empty", () => {
    const first = runtime();
    const changedPayload = structuredClone(
      testVectors.payloads.pointMeasurement as Record<string, unknown>
    );
    changedPayload["contentHash"] = digest("2");
    const changed = runtime({ payload: changedPayload });
    const sourceBinding = normalizeSourceProducts({
      trustedContext: first.trustedContext,
      validatedResults: [first.validatedResult, changed.validatedResult]
    });
    const projection = readNormalizedSourceProductBinding(sourceBinding);
    expect(projection.sourceProducts).toEqual([]);
    expect(projection.envelopeBindings.every(({ qualification, sourceProductIds, evidenceItemIds }) =>
      qualification.status === "REJECTED"
        && qualification.reason === "SOURCE_CHANGED"
        && sourceProductIds.length === 0
        && evidenceItemIds.length === 0)).toBe(true);
    const result = normalizeGeospatialGaps({
      sourceBinding,
      validatedResult: first.validatedResult
    });
    expect(result.status).toBe("INDETERMINATE");
    expect(result.gaps).toEqual([
      expect.objectContaining({ gapKind: "SOURCE_CHANGED", severity: "BLOCKING" })
    ]);
  });

  it("never lets a batch SOURCE_CHANGED rejection weaken a terminal upstream failure", () => {
    const first = runtime();
    const changedPayload = structuredClone(
      testVectors.payloads.pointMeasurement as Record<string, unknown>
    );
    changedPayload["contentHash"] = digest("2");
    const changed = runtime({ payload: changedPayload });
    const failed = runtime({ status: "FAILED", code: "ASSET_UNAVAILABLE" });
    const sourceBinding = normalizeSourceProducts({
      trustedContext: first.trustedContext,
      validatedResults: [first.validatedResult, changed.validatedResult, failed.validatedResult]
    });
    const result = normalizeGeospatialGaps({
      sourceBinding,
      validatedResult: failed.validatedResult
    });
    expect(result.status).toBe("INDETERMINATE");
    expect(result.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ gapKind: "UPSTREAM_FAILURE", severity: "BLOCKING" }),
      expect.objectContaining({ gapKind: "SOURCE_CHANGED", severity: "BLOCKING" })
    ]));
  });

  it("derives truncation from the validated payload and cannot be told to hide it", () => {
    const payload = { ...testVectors.payloads.pointMeasurementGenericService, truncated: true };
    const result = normalizeGeospatialGaps(input({
      operationId: "geo-raster.sample",
      payload
    }, ["finding.n03.test"]));
    expect(result.status).toBe("PARTIAL");
    expect(result.gaps.map(({ gapKind }) => gapKind)).toContain("TRUNCATED");
  });

  it("rejects a data-gap payload that claims published findings", () => {
    expectCode(() => normalizeGeospatialGaps(input({
      status: "NO_DATA",
      code: "PRODUCT_NOT_AVAILABLE"
    }, ["finding.n03.test"])), "NO_DATA_FINDINGS_FORBIDDEN");
  });

  it("derives evidence and semantic identity from opaque runtime bindings", () => {
    const result = normalizeGeospatialGaps(input({
      status: "NO_DATA",
      code: "PRODUCT_COVERAGE_INSUFFICIENT"
    }));
    expect(result.gaps[0]?.semanticConcept).toBe("terrain.elevation");
    const tokens = runtime({ status: "NO_DATA", code: "PRODUCT_COVERAGE_INSUFFICIENT" });
    const evidenceItemIds = readNormalizedSourceProductBinding(tokens.sourceBinding)
      .envelopeBindings[0]!.evidenceItemIds;
    const normalized = normalizeGeospatialGaps(tokens);
    expect(normalized.gaps[0]?.semanticConcept).toBe("terrain.elevation");
    expect(normalized.gaps[0]?.evidenceItemIds).toEqual(evidenceItemIds);
  });

  it("is deterministic and validates every emitted typed gap", () => {
    const tokens = runtime({ status: "NO_DATA", code: "PRODUCT_COVERAGE_INSUFFICIENT" });
    const first = normalizeGeospatialGaps(tokens);
    const second = normalizeGeospatialGaps(tokens);
    expect(second).toEqual(first);
    expect(second.gapSetHash).toBe(first.gapSetHash);
    expect(second.normalizationHash).toBe(first.normalizationHash);
    for (const gap of first.gaps) {
      defaultSacsGeospatialSchemaRegistry().validate("typed-gap.schema.json", gap);
    }
  });

  it("rejects raw authority, outcome, evidence, truncation, and detail fields", () => {
    const tokens = runtime();
    for (const extra of [
      { upstreamOutcome: "NO_DATA" },
      { upstreamStatus: "NO_DATA" },
      { evidenceItemIds: ["forged.evidence"] },
      { truncated: false },
      { scopeBinding: { expectedDataScopeHash: digest("3"), observedDataScopeHash: digest("3") } },
      { safeDetail: "postgres://internal token=secret" }
    ]) {
      expectCode(() => normalizeGeospatialGaps({ ...tokens, ...extra }),
        "UNKNOWN_GAP_NORMALIZATION_FIELD");
    }
  });

  it("rejects a cloned source binding", () => {
    const tokens = runtime();
    expect(() => normalizeGeospatialGaps({
      ...tokens,
      sourceBinding: structuredClone(tokens.sourceBinding)
    })).toThrow(/SOURCE_PROVENANCE_BINDING_FORGED/u);
  });
});
