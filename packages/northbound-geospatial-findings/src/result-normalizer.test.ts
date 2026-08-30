import { readFileSync } from "node:fs";

import {
  defaultSacsGeospatialSchemaRegistry,
  type SACSGeospatialFindingsProfile10
} from "@wsgs/contracts";
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
  assembleGeospatialFindingsProfile,
  assembleGeospatialFindingsResult,
  assertGeospatialFindingsProfileIntegrity,
  ResultNormalizationError
} from "./result-normalizer.js";
import {
  createTrustedSourceContext,
  normalizeSourceProducts,
  readNormalizedSourceProductBinding,
  type NormalizedSourceProductBinding
} from "./source-normalizer.js";

type TestVectors = {
  payloads: {
    pointMeasurement: unknown;
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
  readonly requestId?: string;
  readonly payload?: unknown;
  readonly operationId?: "elevation.sample" | "geo-product.get" | "geo-product.search";
  readonly includeDataSnapshot?: boolean;
  readonly includeReceipt?: boolean;
  readonly receiptId?: string;
  readonly snapshotCapturedAt?: string;
}

interface RuntimeTokens {
  readonly validatedResult: ValidatedGowmFindingResult;
  readonly sourceBinding: NormalizedSourceProductBinding;
  readonly trustedContext: ReturnType<typeof createTrustedSourceContext>;
}

function runtime(options: RuntimeOptions = {}): RuntimeTokens {
  const status = options.status ?? "COMPLETED";
  const operationId = options.operationId ?? "elevation.sample";
  const operation = { operationId, operationVersion: "1.0" } as const;
  const lock = gdpsV021FindingContractClosure.operations.find((candidate) =>
    candidate.operationId === operation.operationId && candidate.operationVersion === "1.0")!;
  const authority = resolveGdpsFindingOperationAuthority(finalAuthority, {
    ...operation,
    semanticConcept: operationId.startsWith("geo-product.") ? "geospatial.product.catalog" : "terrain.elevation",
    ...(operationId.startsWith("geo-product.") ? {} : { descriptorId: "ELEVATION_DTM/DEFAULT" })
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
  const unbound = output === undefined;
  const payloadRecord = payload as Record<string, unknown>;
  const catalogSnapshot = operationId.startsWith("geo-product.");
  const referenceVersion = catalogSnapshot
    ? canonicalSha256(payload)
    : typeof payloadRecord["contentHash"] === "string"
      ? payloadRecord["contentHash"] as `sha256:${string}`
      : digest("1");
  const referenceId = catalogSnapshot
    ? `catalog:${dataScope}`
    : unbound ? `catalog:${dataScope}` : `${dataScope}:gdps-baseline-dtm`;
  const requestId = options.requestId ?? `request.n03.result.${status.toLowerCase()}`;
  const envelope: GowmCapabilityResultEnvelope = {
    providerProtocolVersion: "1.0",
    requestId,
    operation,
    status,
    ...(output === undefined ? {} : { output }),
    ...(options.code === undefined ? {} : {
      error: {
        schemaVersion: "1.0",
        requestId,
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
        capturedAt: options.snapshotCapturedAt ?? "2026-08-30T00:00:00Z",
        scopeDigest,
        resources: [{
          referenceKey: { namespace: "gdps", kind: "DATASET", id: referenceId, version: referenceVersion },
          authority: gdpsV021FindingContractClosure.provider.providerId,
          pinning: "PINNED",
          digest: referenceVersion
        }]
      }
    }),
    computeSnapshot,
    receipts: outputHash === undefined || options.includeReceipt === false ? [] : [{
      receiptId: options.receiptId ?? `receipt.n03.result.${status.toLowerCase()}`,
      operationId: operation.operationId,
      operationVersion: "1.0",
      providerId: gdpsV021FindingContractClosure.provider.providerId,
      providerVersion: gdpsV021FindingContractClosure.provider.providerVersion,
      inputHash: digest("f"),
      outputHash,
      computeSnapshotHash: canonicalSha256(computeSnapshot),
      generatedAt: "2026-08-30T00:00:00Z",
      durationMs: 1,
      method: { engine: "gdps-python", engineVersion: "0.2.1", methodId: "descriptor-query", methodVersion: "1.0" },
      changes: { repairApplied: false, typeChanged: false },
      warnings: []
    }],
    evidenceReferences: [{
      evidenceId: `evidence.n03.result.${status.toLowerCase()}`,
      authority: gdpsV021FindingContractClosure.provider.providerId,
      evidenceType: "CURRENT_PROJECTION_SOURCE",
      referenceKey: { namespace: "gdps", kind: "DATASET", id: referenceId, version: referenceVersion },
      schemaUri: "urn:gdps:current-product:1.0",
      schemaHash: digest("2"),
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
    servicePrincipalId: "principal.n03.result",
    actorId: "actor.n03.result",
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

function evidenceIds(tokens: RuntimeTokens): string[] {
  return readNormalizedSourceProductBinding(tokens.sourceBinding)
    .envelopeBindings.flatMap((binding) => [...binding.evidenceItemIds]);
}

function mutable(profile: SACSGeospatialFindingsProfile10): SACSGeospatialFindingsProfile10 {
  return structuredClone(profile);
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("EXPECTED_RESULT_NORMALIZATION_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(ResultNormalizationError);
    expect((error as ResultNormalizationError).code).toBe(code);
  }
}

describe("assembleGeospatialFindingsProfile", () => {
  it("uses the real decoder registry and emits a complete locked profile", () => {
    const tokens = runtime();
    const profile = assembleGeospatialFindingsProfile({
      sourceBinding: tokens.sourceBinding,
      validatedResults: [tokens.validatedResult]
    });
    expect(profile.profile).toBe("sacs-wsgs-geospatial-findings/1.0");
    expect(profile.findings).toHaveLength(1);
    expect(profile.findings[0]).toMatchObject({ findingKind: "POINT_MEASUREMENT", status: "COMPLETED" });
    expect(profile.sourceProducts).toHaveLength(1);
    expect(profile.findingSetHash).toBe(canonicalSha256(profile.findings));
    expect(profile.sourceProductSetHash).toBe(canonicalSha256(profile.sourceProducts));
    defaultSacsGeospatialSchemaRegistry().validate("geospatial-findings.schema.json", profile);
  });

  it("materializes the opaque local provenance as actual v0.1 evidence wire", () => {
    const tokens = runtime();
    const assembly = assembleGeospatialFindingsResult({
      sourceBinding: tokens.sourceBinding,
      validatedResults: [tokens.validatedResult]
    });
    expect(assembly.evidenceItems).toHaveLength(1);
    expect(assembly.evidenceItems[0]).toMatchObject({
      productKind: "CAPABILITY_RESULT",
      authority: "GOWM_WORLD_CAPABILITY_GATEWAY",
      sourceOperation: "elevation.sample@1.0",
      upstreamStatus: "COMPLETED"
    });
    const lockedOperation = gdpsV021FindingContractClosure.operations.find(
      ({ operationId, operationVersion }) => operationId === "elevation.sample" && operationVersion === "1.0"
    )!;
    expect(assembly.evidenceItems[0]).toMatchObject({
      payloadSchemaUri: lockedOperation.outputSchemaUri,
      payloadSchemaHash: lockedOperation.outputSchemaHash
    });
    expect(assembly.evidenceItems[0]).not.toHaveProperty("safePayload");
    const evidenceId = assembly.evidenceItems[0]!.evidenceProductId;
    expect(assembly.geospatialFindings.sourceProducts[0]!.evidenceItemIds).toEqual([evidenceId]);
    expect(assembly.geospatialFindings.findings[0]!.evidenceItemIds).toEqual([evidenceId]);
    expect(assembly.evidenceItemSetHash).toBe(canonicalSha256(assembly.evidenceItems));
    expect(assembly.assemblyHash).toBe(canonicalSha256({
      profile: assembly.geospatialFindings,
      evidenceItems: assembly.evidenceItems
    }));
  });

  it("keeps finding/source semantic hashes stable while replay evidence retains each receipt", () => {
    const left = runtime({
      requestId: "request.n03.semantic-replay-a",
      receiptId: "receipt.n03.semantic-random-a",
      snapshotCapturedAt: "2026-08-30T00:00:00Z"
    });
    const right = runtime({
      requestId: "request.n03.semantic-replay-b",
      receiptId: "receipt.n03.semantic-random-b",
      snapshotCapturedAt: "2026-08-30T00:00:01Z"
    });
    const leftAssembly = assembleGeospatialFindingsResult({
      sourceBinding: left.sourceBinding,
      validatedResults: [left.validatedResult]
    });
    const rightAssembly = assembleGeospatialFindingsResult({
      sourceBinding: right.sourceBinding,
      validatedResults: [right.validatedResult]
    });

    expect(leftAssembly.geospatialFindings.findingSetHash)
      .toBe(rightAssembly.geospatialFindings.findingSetHash);
    expect(leftAssembly.geospatialFindings.sourceProductSetHash)
      .toBe(rightAssembly.geospatialFindings.sourceProductSetHash);
    expect(leftAssembly.geospatialFindings.findings[0]?.findingId)
      .toBe(rightAssembly.geospatialFindings.findings[0]?.findingId);
    expect(leftAssembly.evidenceItems[0]?.receiptIds)
      .toEqual(["receipt.n03.semantic-random-a"]);
    expect(rightAssembly.evidenceItems[0]?.receiptIds)
      .toEqual(["receipt.n03.semantic-random-b"]);
    expect(leftAssembly.evidenceItemSetHash).not.toBe(rightAssembly.evidenceItemSetHash);
  });

  it("is deterministic and never projects envelope, receipt, upstream evidence, or scope values", () => {
    const tokens = runtime();
    const first = assembleGeospatialFindingsProfile({ sourceBinding: tokens.sourceBinding, validatedResults: [tokens.validatedResult] });
    const second = assembleGeospatialFindingsProfile({ sourceBinding: tokens.sourceBinding, validatedResults: [tokens.validatedResult] });
    expect(second).toEqual(first);
    const projection = readNormalizedSourceProductBinding(tokens.sourceBinding);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain(projection.envelopeBindings[0]!.envelopeHash);
    expect(serialized).not.toContain(projection.envelopeBindings[0]!.receiptIds[0]);
    expect(serialized).not.toContain(projection.envelopeBindings[0]!.evidenceReferences[0]!.evidenceId);
    expect(serialized).not.toContain(dataScope);
  });

  it("normalizes FAILED before decoder selection and never calls it a data gap", () => {
    const tokens = runtime({ status: "FAILED", code: "ASSET_UNAVAILABLE" });
    const profile = assembleGeospatialFindingsProfile({ sourceBinding: tokens.sourceBinding, validatedResults: [tokens.validatedResult] });
    expect(profile.findings).toEqual([]);
    expect(profile.gaps).toHaveLength(1);
    expect(profile.gaps[0]).toMatchObject({ gapKind: "UPSTREAM_FAILURE", severity: "BLOCKING" });
  });

  it.each([
    ["INDETERMINATE", "INTEGRITY", "UPSTREAM_FAILURE"],
    ["INDETERMINATE", "SOURCE_CHANGED_DURING_QUERY", "SOURCE_CHANGED"],
    ["NO_DATA", "PRODUCT_NOT_AVAILABLE", "DATA_GAP"]
  ] as const)("does not publish a finding when %s/%s normalizes to %s", (status, code, gapKind) => {
    const tokens = runtime({ status, code });
    const profile = assembleGeospatialFindingsProfile({
      sourceBinding: tokens.sourceBinding,
      validatedResults: [tokens.validatedResult]
    });
    expect(profile.findings).toEqual([]);
    expect(profile.gaps[0]).toMatchObject({ gapKind });
  });

  it("assembles an evidence-incomplete rejected binding as only a blocking gap", () => {
    const tokens = runtime({ includeDataSnapshot: false });
    const assembly = assembleGeospatialFindingsResult({
      sourceBinding: tokens.sourceBinding,
      validatedResults: [tokens.validatedResult]
    });
    expect(assembly.geospatialFindings).toMatchObject({
      findings: [],
      sourceProducts: [],
      gaps: [expect.objectContaining({
        gapKind: "EVIDENCE_INCOMPLETE",
        severity: "BLOCKING"
      })]
    });
    expect(assembly.evidenceItems).toEqual([]);
  });

  it("assembles a receipt-missing result as only an evidence-incomplete blocking gap", () => {
    const tokens = runtime({ includeReceipt: false });
    const assembly = assembleGeospatialFindingsResult({
      sourceBinding: tokens.sourceBinding,
      validatedResults: [tokens.validatedResult]
    });
    expect(assembly.geospatialFindings).toMatchObject({
      findings: [],
      sourceProducts: [],
      gaps: [expect.objectContaining({
        gapKind: "EVIDENCE_INCOMPLETE",
        severity: "BLOCKING"
      })]
    });
    expect(assembly.evidenceItems).toEqual([]);
  });

  it("assembles a partial empty catalog as no facts plus a warning gap", () => {
    const tokens = runtime({
      status: "PARTIAL",
      operationId: "geo-product.search",
      payload: {
        schemaVersion: "gdps-product-search-result/1.0",
        products: [],
        truncated: false
      }
    });
    const assembly = assembleGeospatialFindingsResult({
      sourceBinding: tokens.sourceBinding,
      validatedResults: [tokens.validatedResult]
    });
    expect(assembly.geospatialFindings).toMatchObject({
      findings: [],
      sourceProducts: [],
      gaps: [expect.objectContaining({ gapKind: "DATA_GAP", severity: "WARNING" })]
    });
    expect(assembly.evidenceItems).toHaveLength(1);
  });

  it("never sends an unsupported-schema rejected binding into the decoder", () => {
    const payload = structuredClone(testVectors.payloads.currentProductGet);
    delete payload["metadata"];
    const tokens = runtime({ operationId: "geo-product.get", payload });
    const assembly = assembleGeospatialFindingsResult({
      sourceBinding: tokens.sourceBinding,
      validatedResults: [tokens.validatedResult]
    });
    expect(assembly.geospatialFindings).toMatchObject({
      findings: [],
      sourceProducts: [],
      gaps: [expect.objectContaining({
        gapKind: "UNSUPPORTED_FINDING_SCHEMA",
        severity: "BLOCKING"
      })]
    });
    expect(assembly.evidenceItems).toEqual([]);
  });

  it("assembles a source-changed aggregate with zero facts and one blocking gap per envelope", () => {
    const first = runtime({ requestId: "request.n03.result.source-a" });
    const changedPayload = structuredClone(
      testVectors.payloads.pointMeasurement as Record<string, unknown>
    );
    changedPayload["contentHash"] = digest("2");
    const changed = runtime({
      requestId: "request.n03.result.source-b",
      payload: changedPayload
    });
    const sourceBinding = normalizeSourceProducts({
      trustedContext: first.trustedContext,
      validatedResults: [first.validatedResult, changed.validatedResult]
    });
    const projection = readNormalizedSourceProductBinding(sourceBinding);
    expect(projection.sourceProducts).toEqual([]);
    expect(projection.envelopeBindings.every(({ qualification }) =>
      qualification.status === "REJECTED" && qualification.reason === "SOURCE_CHANGED")).toBe(true);
    const assembly = assembleGeospatialFindingsResult({
      sourceBinding,
      validatedResults: [first.validatedResult, changed.validatedResult]
    });
    expect(assembly.geospatialFindings.findings).toEqual([]);
    expect(assembly.geospatialFindings.sourceProducts).toEqual([]);
    expect(assembly.evidenceItems).toEqual([]);
    expect(assembly.geospatialFindings.gaps).toHaveLength(2);
    expect(assembly.geospatialFindings.gaps.every(({ gapKind, severity }) =>
      gapKind === "SOURCE_CHANGED" && severity === "BLOCKING")).toBe(true);
  });

  it("rejects missing, duplicate, and forged validated result sets", () => {
    const tokens = runtime();
    expectCode(() => assembleGeospatialFindingsProfile({ sourceBinding: tokens.sourceBinding, validatedResults: [] }), "VALIDATED_RESULTS_REQUIRED");
    expectCode(() => assembleGeospatialFindingsProfile({
      sourceBinding: tokens.sourceBinding,
      validatedResults: [tokens.validatedResult, tokens.validatedResult]
    }), "DUPLICATE_VALIDATED_RESULT");
    expect(() => assembleGeospatialFindingsProfile({
      sourceBinding: structuredClone(tokens.sourceBinding),
      validatedResults: [tokens.validatedResult]
    })).toThrow(/SOURCE_PROVENANCE_BINDING_FORGED/u);
  });

  it("rejects caller-supplied raw envelope, provenance, or authority fields", () => {
    const tokens = runtime();
    for (const extra of [
      { envelope: { requestId: "request.raw" } },
      { trustedProvenance: { evidenceItemIds: ["evidence.forged"] } },
      { dataScope: "foreign-scope" },
      { receiptIds: ["receipt.forged"] }
    ]) {
      expectCode(() => assembleGeospatialFindingsResult({
        sourceBinding: tokens.sourceBinding,
        validatedResults: [tokens.validatedResult],
        ...extra
      }), "UNKNOWN_ASSEMBLY_FIELD");
    }
  });

  it.each([
    ["finding source", "FINDING_SOURCE_PRODUCT_FK_MISSING", (profile: SACSGeospatialFindingsProfile10) => {
      profile.findings[0]!.sourceProductIds = ["source.missing"];
    }],
    ["finding evidence", "FINDING_EVIDENCE_FK_MISSING", (profile: SACSGeospatialFindingsProfile10) => {
      profile.findings[0]!.evidenceItemIds = ["evidence.missing"];
    }],
    ["source evidence", "SOURCE_PRODUCT_EVIDENCE_FK_MISSING", (profile: SACSGeospatialFindingsProfile10) => {
      profile.sourceProducts[0]!.evidenceItemIds = ["evidence.missing"];
    }]
  ] as const)("rejects an orphan %s FK", (_label, code, mutate) => {
    const tokens = runtime();
    const profile = mutable(assembleGeospatialFindingsProfile({ sourceBinding: tokens.sourceBinding, validatedResults: [tokens.validatedResult] }));
    mutate(profile);
    expectCode(() => assertGeospatialFindingsProfileIntegrity(profile, evidenceIds(tokens)), code);
  });

  it.each([
    ["finding", "GAP_FINDING_FK_MISSING", { findingIds: ["finding.missing"] }],
    ["evidence", "GAP_EVIDENCE_FK_MISSING", { evidenceItemIds: ["evidence.missing"] }]
  ] as const)("rejects an orphan gap %s FK", (_label, code, references) => {
    const tokens = runtime();
    const profile = mutable(assembleGeospatialFindingsProfile({ sourceBinding: tokens.sourceBinding, validatedResults: [tokens.validatedResult] }));
    profile.gaps = [{
      gapId: "gap.orphan",
      gapKind: "TRUNCATED",
      severity: "WARNING",
      messageCode: "WSGS_RESULT_TRUNCATED",
      ...("findingIds" in references
        ? { findingIds: [...references.findingIds] }
        : { evidenceItemIds: [...references.evidenceItemIds] })
    }];
    expectCode(() => assertGeospatialFindingsProfileIntegrity(profile, evidenceIds(tokens)), code);
  });

  it("fails closed on same finding identity with different values", () => {
    const tokens = runtime();
    const profile = mutable(assembleGeospatialFindingsProfile({ sourceBinding: tokens.sourceBinding, validatedResults: [tokens.validatedResult] }));
    const changed = structuredClone(profile.findings[0]!);
    if (changed.findingKind !== "POINT_MEASUREMENT") throw new Error("unexpected finding kind");
    changed.value += 1;
    profile.findings = [profile.findings[0]!, changed];
    expectCode(() => assertGeospatialFindingsProfileIntegrity(profile, evidenceIds(tokens)), "FINDING_ID_COLLISION");
  });

  it("fails closed on same source or gap identity with different values", () => {
    const tokens = runtime();
    const sourceCollision = mutable(assembleGeospatialFindingsProfile({ sourceBinding: tokens.sourceBinding, validatedResults: [tokens.validatedResult] }));
    sourceCollision.sourceProducts = [
      sourceCollision.sourceProducts[0]!,
      { ...sourceCollision.sourceProducts[0]!, productProfile: "OTHER" }
    ];
    expectCode(() => assertGeospatialFindingsProfileIntegrity(sourceCollision, evidenceIds(tokens)), "SOURCE_PRODUCT_ID_COLLISION");

    const gapCollision = mutable(assembleGeospatialFindingsProfile({ sourceBinding: tokens.sourceBinding, validatedResults: [tokens.validatedResult] }));
    gapCollision.gaps = [
      { gapId: "gap.collision", gapKind: "TRUNCATED", severity: "WARNING", messageCode: "FIRST" },
      { gapId: "gap.collision", gapKind: "TRUNCATED", severity: "WARNING", messageCode: "SECOND" }
    ];
    expectCode(() => assertGeospatialFindingsProfileIntegrity(gapCollision, evidenceIds(tokens)), "GAP_ID_COLLISION");
  });

  it("rejects hash drift and allowlisted-field sensitive value leakage", () => {
    const tokens = runtime();
    const hashDrift = mutable(assembleGeospatialFindingsProfile({ sourceBinding: tokens.sourceBinding, validatedResults: [tokens.validatedResult] }));
    hashDrift.findingSetHash = digest("9");
    expectCode(() => assertGeospatialFindingsProfileIntegrity(hashDrift, evidenceIds(tokens)), "FINDING_SET_HASH_MISMATCH");

    const sensitive = mutable(assembleGeospatialFindingsProfile({ sourceBinding: tokens.sourceBinding, validatedResults: [tokens.validatedResult] }));
    sensitive.sourceProducts[0]!.productProfile = "https://internal.example/product";
    sensitive.sourceProductSetHash = canonicalSha256(sensitive.sourceProducts);
    expectCode(() => assertGeospatialFindingsProfileIntegrity(sensitive, evidenceIds(tokens)), "SENSITIVE_RESULT_PROJECTION_FORBIDDEN");
  });
});
