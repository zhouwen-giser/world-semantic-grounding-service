import { readFileSync } from "node:fs";

import {
  gdpsV021FindingContractClosure
} from "@wsgs/gowm-contract-intake";
import {
  createGdpsV021FinalBFindingAuthority,
  resolveGdpsFindingOperationAuthority
} from "@wsgs/gdps-descriptor-consumer";
import { validateGowmFindingResultEnvelope } from "@wsgs/gowm-execution-evidence";
import { describe, expect, it } from "vitest";

import {
  FINDING_DECODER_PATTERNS,
  TRUSTED_PROVENANCE_BINDING_MARKER,
  FindingDecoderRegistry,
  canonicalJson,
  canonicalSha256,
  createFindingDecoderInput,
  standardDecoderRegistrations,
  type DecoderCoverageCandidate,
  type FindingDecoderInput,
  type FindingDecoderPattern,
  type FindingDecoderRegistration,
  type GowmResultEnvelope,
  type GowmResultStatus,
  type Sha256Digest
} from "./index.js";

type TestVectorDocument = {
  fixtureClass: string;
  sourceAuthority: {
    implementationSourceSha: string;
    deliveryEvidenceSha: string;
    schemas: string[];
  };
  payloads: Record<string, unknown>;
};

type CoverageFixture = {
  counts: {
    total: number;
    supported: number;
    intentionallyGap: number;
    unsupportedSchema: number;
    notApplicable: number;
  };
  rows: Array<{
    capabilityId: string;
    operationId: string;
    version: string;
    outputSchemaUri: string;
    outputSchemaHash: Sha256Digest;
    semanticProfileHash: Sha256Digest;
    classification: "SUPPORTED" | "NOT_APPLICABLE";
    decoderPattern: string | null;
    queryProfile: FindingDecoderPattern | "SAMPLE_VALUE_OR_CLASS" | null;
  }>;
};

type ClosureFindingBinding = {
  readonly applicability: "FINDING" | "CATALOG" | "NOT_APPLICABLE";
  readonly descriptorConstraint: {
    readonly descriptorId: string;
    readonly descriptorHash: Sha256Digest;
  } | null;
  readonly queryProfile: FindingDecoderPattern | "SAMPLE_VALUE_OR_CLASS" | null;
  readonly querySemantics: string;
  readonly decoderPattern: FindingDecoderPattern | null;
};

type ClosureOperation = {
  readonly operationId: string;
  readonly operationVersion: string;
  readonly outputSchemaUri: string;
  readonly outputSchemaHash: Sha256Digest;
  readonly semanticProfileHash: Sha256Digest;
  readonly findingBinding: ClosureFindingBinding;
};

type ClosureDescriptor = {
  readonly descriptorId: string;
  readonly productType: string;
  readonly productProfile: string;
};

const testVectors = JSON.parse(readFileSync(
  new URL("../fixtures/gdps-real-result-shapes.json", import.meta.url),
  "utf8"
)) as TestVectorDocument;
const coverageFixture = JSON.parse(readFileSync(
  new URL("../fixtures/gdps-v021-capability-decoder-coverage.json", import.meta.url),
  "utf8"
)) as CoverageFixture;
const finalBFindingAuthority = createGdpsV021FinalBFindingAuthority();

function schemaForOperation(operationId: string): { uri: string; hash: Sha256Digest } {
  const row = coverageFixture.rows.find((candidate) => candidate.operationId === operationId);
  if (row === undefined) throw new Error(`missing coverage fixture row for ${operationId}`);
  return { uri: row.outputSchemaUri, hash: row.outputSchemaHash };
}

const digest = (character: string): Sha256Digest => `sha256:${character.repeat(64)}`;

const operationByPattern: Readonly<Record<FindingDecoderPattern, string>> = {
  SAMPLE_VALUE: "elevation.sample",
  SAMPLE_CLASS: "geo-raster.sample",
  FIND_CLASS: "terrain.find-high-ground",
  FIND_VALUE_RANGE: "geo-raster.find-by-range",
  PROFILE_VALUE: "elevation.profile",
  VECTOR_IN_AREA: "geo-vector.find-in-area",
  VECTOR_NEARBY: "geo-vector.find-nearby",
  VECTOR_INTERSECTS: "geo-vector.find-intersections",
  CATALOG: "geo-product.search",
  QUALIFIED_EXPLANATION: "traversability.explain"
};

const schemaByPattern: Readonly<Record<FindingDecoderPattern, {
  uri: string;
  hash: Sha256Digest;
}>> = {
  SAMPLE_VALUE: {
    uri: "urn:gdps:operation:elevation.sample:output:1.0",
    hash: "sha256:03b2019c95ac57880d4453d78188a2f9b9ea51f1d7bd2f5de65b194cae8f2a58"
  },
  SAMPLE_CLASS: {
    uri: "urn:gdps:geo-raster.sample:output:1.0",
    hash: "sha256:da086a0ab6c1a48ffeac7633acef50b0385851dbf4e9191c24a21f5cd414ecf0"
  },
  FIND_CLASS: {
    uri: "urn:gdps:operation:terrain.find-high-ground:output:1.0",
    hash: "sha256:b71c4881c6f4b8107dd287f3608230b75cbe23073f1ab674fad0397240525f19"
  },
  FIND_VALUE_RANGE: {
    uri: "urn:gdps:geo-raster.find-by-range:output:1.0",
    hash: "sha256:e9af4d388195493a247cf3691c2a15d984fd555178c79a84fa4f23261ee9546c"
  },
  PROFILE_VALUE: {
    uri: "urn:gdps:operation:elevation.profile:output:1.0",
    hash: "sha256:fe3d09fa23e62cbb9b8fd07861367a53950c0cfab5c225484394fea5b95999ba"
  },
  VECTOR_IN_AREA: {
    uri: "urn:gdps:geo-vector.find-in-area:output:1.0",
    hash: "sha256:6f5bf35c10ddc6abad03063ed907a2852708daf2405c5e7956ca6f33e6bb1651"
  },
  VECTOR_NEARBY: {
    uri: "urn:gdps:geo-vector.find-nearby:output:1.0",
    hash: "sha256:a1df3608bf76e11b79b291db197be30638896a5f56a1395c555a4250233a6d7d"
  },
  VECTOR_INTERSECTS: {
    uri: "urn:gdps:geo-vector.find-intersections:output:1.0",
    hash: "sha256:b9955d7e09a5dc5a007c87bdc2f6cd2dabf3a1ffd6df7d37d2df75b20b00dff9"
  },
  CATALOG: {
    uri: "urn:gdps:operation:geo-product.search:output:1.0",
    hash: "sha256:bac750f1d3772e12cab7894794f61bd75a70e6de0d8aeadcfe2c0efd864d6d86"
  },
  QUALIFIED_EXPLANATION: {
    uri: "urn:gdps:operation:traversability.explain:output:1.0",
    hash: "sha256:681ad9732de478d69c1a227e0b586666e32d107fbe848435593036c5d5370d3c"
  }
};

function fullEnvelope(
  pattern: FindingDecoderPattern,
  payload: unknown,
  status: GowmResultStatus = "COMPLETED",
  operationId = operationByPattern[pattern],
  schema = schemaByPattern[pattern]
): GowmResultEnvelope {
  const operation = { operationId, operationVersion: "1.0" };
  const operationLock = gdpsV021FindingContractClosure.operations.find((candidate) =>
    candidate.operationId === operationId && candidate.operationVersion === operation.operationVersion);
  if (operationLock === undefined) throw new Error(`missing FINAL_B operation ${operationId}`);
  const computeSnapshot = {
    provider: {
      providerId: "gdps.geospatial-products",
      providerVersion: "0.2.1",
      implementationDigest: gdpsV021FindingContractClosure.provider.implementationDigest
    },
    operation,
    engine: { name: "gdps-python", version: "0.2.1", digest: digest("2") },
    policy: { version: "gdps-budget/1.0", digest: digest("3") },
    schemas: { inputSchemaHash: operationLock.inputSchemaHash, outputSchemaHash: schema.hash }
  };
  const outputHash = canonicalSha256(payload);
  return {
    providerProtocolVersion: "1.0",
    requestId: "request.n02.test-vector",
    operation,
    status,
    output: { schemaUri: schema.uri, schemaHash: schema.hash, value: payload },
    computeSnapshot,
    receipts: [{
      receiptId: "receipt.n02.test-vector",
      operationId,
      operationVersion: "1.0",
      providerId: "gdps.geospatial-products",
      providerVersion: "0.2.1",
      inputHash: digest("5"),
      outputHash,
      computeSnapshotHash: canonicalSha256(computeSnapshot),
      generatedAt: "2026-08-30T00:00:00Z",
      durationMs: 12.5,
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
      evidenceId: "evidence.n02.test-vector",
      authority: "gdps.geospatial-products",
      evidenceType: "CURRENT_PROJECTION_SOURCE",
      referenceKey: {
        namespace: "gdps",
        kind: "DATASET",
        id: "scope-gdps-v021-baseline:gdps-baseline-product",
        version: digest("6")
      },
      schemaUri: "urn:gdps:current-product:1.0",
      schemaHash: digest("7"),
      observedAt: "2026-08-30T00:00:00Z"
    }],
    warnings: [],
    consumption: { inputBytes: 128, outputBytes: 512, rows: 1 },
    execution: {
      providerId: "gdps.geospatial-products",
      providerVersion: "0.2.1",
      elapsedMs: 12.5,
      resultHash: outputHash
    }
  };
}

function decoderInput(
  pattern: FindingDecoderPattern,
  payload: unknown,
  options: {
    status?: GowmResultStatus;
    operationId?: string;
    schema?: { uri: string; hash: Sha256Digest };
    productType?: string;
    productProfile?: string;
    unit?: string;
    allowedClassCodes?: readonly string[];
    queryProfile?: FindingDecoderPattern;
    evidenceItemIds?: readonly string[];
    sourceProductIds?: readonly string[];
    subjectReferenceProductIds?: readonly string[];
  } = {}
): FindingDecoderInput {
  const schema = options.schema ?? schemaByPattern[pattern];
  const envelope = fullEnvelope(
    pattern,
    payload,
    options.status,
    options.operationId ?? operationByPattern[pattern],
    schema
  );
  const productType = options.productType ?? {
    SAMPLE_VALUE: "ELEVATION_DTM",
    SAMPLE_CLASS: "UGV_TRAVERSABILITY",
    FIND_CLASS: "TERRAIN_FORM",
    FIND_VALUE_RANGE: "SLOPE",
    PROFILE_VALUE: "ELEVATION_DTM",
    VECTOR_IN_AREA: "BUILDING",
    VECTOR_NEARBY: "OBSTACLE",
    VECTOR_INTERSECTS: "OBSTACLE",
    QUALIFIED_EXPLANATION: "UGV_TRAVERSABILITY",
    CATALOG: ""
  }[pattern];
  const productProfile = options.productProfile ?? "DEFAULT";
  const operationAuthority = resolveGdpsFindingOperationAuthority(finalBFindingAuthority, {
    operationId: envelope.operation.operationId,
    operationVersion: envelope.operation.operationVersion,
    semanticConcept: `TEST_${pattern}`,
    ...(pattern === "CATALOG" ? {} : { descriptorId: `${productType}/${productProfile}` })
  });
  const validatedResult = validateGowmFindingResultEnvelope(operationAuthority, envelope);
  return createFindingDecoderInput({
    validatedResult,
    trustedProvenance: {
      marker: TRUSTED_PROVENANCE_BINDING_MARKER,
      evidenceItemIds: options.evidenceItemIds ?? ["evidence.n02.test-vector"],
      sourceProductIds: options.sourceProductIds ?? ["source.gdps.test-vector"],
      subjectReferenceProductIds: options.subjectReferenceProductIds ?? ["reference.test-vector"]
    }
  });
}

function exactRegistration(
  input: FindingDecoderInput,
  id = "exact.test",
  decoderPattern: FindingDecoderPattern = input.descriptor.decoderPattern
): FindingDecoderRegistration {
  const output = input.envelope.output;
  if (output === undefined) throw new Error("test envelope output missing");
  return standardDecoderRegistrations([{
    decoderId: id,
    priority: "EXACT_OPERATION_SCHEMA",
    pattern: decoderPattern,
    matchQueryProfile: input.descriptor.queryProfile,
    operationId: input.envelope.operation.operationId,
    operationVersion: input.envelope.operation.operationVersion,
    payloadSchemaUri: output.schemaUri,
    payloadSchemaHash: output.schemaHash
  }])[0]!;
}

function expectErrorCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("expected action to throw");
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
  }
}

describe("descriptor/profile finding decoder registry", () => {
  it("uses TEST_VECTOR payloads copied in the authoritative GDPS shared-schema shapes", () => {
    expect(testVectors.fixtureClass).toBe("TEST_VECTOR");
    expect(testVectors.sourceAuthority.implementationSourceSha)
      .toBe("42e06e7341250aa230ac01d201effafe92ce4af5");
    expect(testVectors.sourceAuthority.deliveryEvidenceSha)
      .toBe("712abb35c6c11fe96a3ff1f4c990d26bb5fb06d6");
    expect(testVectors.sourceAuthority.schemas).toHaveLength(5);
  });

  it("mints operation authority only from the pinned FINAL_B closure and rejects forged tuple drift", () => {
    expect(createGdpsV021FinalBFindingAuthority).toHaveLength(0);
    expect(Object.isFrozen(gdpsV021FindingContractClosure)).toBe(true);
    expect(Object.isFrozen(gdpsV021FindingContractClosure.gateway)).toBe(true);
    const forgedClosure = structuredClone(gdpsV021FindingContractClosure) as unknown as {
      gateway: { bindingRevision: Sha256Digest };
    };
    forgedClosure.gateway.bindingRevision = digest("f");
    expectErrorCode(
      () => resolveGdpsFindingOperationAuthority(
        forgedClosure as unknown as Parameters<typeof resolveGdpsFindingOperationAuthority>[0],
        {
        operationId: "elevation.sample",
        operationVersion: "1.0",
        semanticConcept: "TEST_SAMPLE",
        descriptorId: "ELEVATION_DTM/DEFAULT"
        }
      ),
      "GDPS_FINDING_AUTHORITY_FORGED"
    );
  });

  it("freezes descriptor/vocabulary authority and rejects caller-forged drift", () => {
    const authority = structuredClone(gdpsV021FindingContractClosure.descriptorAuthority) as unknown as {
      registry: { descriptors: Array<{ valueSemantics: { unit: string | null } }> };
      vocabularyRegistry: { vocabularies: Record<string, string[]> };
    };
    expect(Object.isFrozen(gdpsV021FindingContractClosure.descriptorAuthority)).toBe(true);
    expect(Object.isFrozen(gdpsV021FindingContractClosure.descriptorAuthority.registry.descriptors[0]))
      .toBe(true);
    authority.registry.descriptors[0]!.valueSemantics.unit = "forged-unit";
    Object.values(authority.vocabularyRegistry.vocabularies)[0]!.push("FORGED_CODE");
    const forgedAuthority = {
      closureHash: gdpsV021FindingContractClosure.closureHash,
      descriptorAuthority: authority
    } as unknown as Parameters<typeof resolveGdpsFindingOperationAuthority>[0];
    expectErrorCode(
      () => resolveGdpsFindingOperationAuthority(forgedAuthority, {
        operationId: "elevation.sample",
        operationVersion: "1.0",
        semanticConcept: "TEST_SAMPLE",
        descriptorId: "ELEVATION_DTM/DEFAULT"
      }),
      "GDPS_FINDING_AUTHORITY_FORGED"
    );
  });

  it("rejects operation-version drift and a fake descriptor on catalog authority", () => {
    expectErrorCode(
      () => resolveGdpsFindingOperationAuthority(finalBFindingAuthority, {
        operationId: "elevation.sample",
        operationVersion: "1.1",
        semanticConcept: "TEST_SAMPLE",
        descriptorId: "ELEVATION_DTM/DEFAULT"
      }),
      "GDPS_FINDING_OPERATION_NOT_LOCKED"
    );
    expectErrorCode(
      () => resolveGdpsFindingOperationAuthority(finalBFindingAuthority, {
        operationId: "geo-product.get",
        operationVersion: "1.0",
        semanticConcept: "TEST_CATALOG",
        descriptorId: "ELEVATION_DTM/DEFAULT"
      }),
      "GDPS_CATALOG_DESCRIPTOR_FORBIDDEN"
    );
  });

  it("uses the actual envelope validator and rejects forged tokens, incomplete envelopes and receipt drift", () => {
    const operationAuthority = resolveGdpsFindingOperationAuthority(finalBFindingAuthority, {
      operationId: "elevation.sample",
      operationVersion: "1.0",
      semanticConcept: "TEST_SAMPLE_VALUE",
      descriptorId: "ELEVATION_DTM/DEFAULT"
    });
    const envelope = fullEnvelope(
      "SAMPLE_VALUE",
      testVectors.payloads["pointMeasurement"]
    );
    expectErrorCode(
      () => validateGowmFindingResultEnvelope(
        { ...operationAuthority },
        envelope
      ),
      "GDPS_FINDING_OPERATION_AUTHORITY_FORGED"
    );

    const incomplete = structuredClone(envelope) as unknown as Record<string, unknown>;
    delete incomplete["computeSnapshot"];
    expectErrorCode(
      () => validateGowmFindingResultEnvelope(operationAuthority, incomplete),
      "GOWM_CONSUMER_SCHEMA_MISMATCH"
    );

    const versionDrift = structuredClone(envelope);
    (versionDrift.operation as { operationVersion: string }).operationVersion = "1.1";
    expectErrorCode(
      () => validateGowmFindingResultEnvelope(operationAuthority, versionDrift),
      "OPERATION_IDENTITY_MISMATCH"
    );

    const receiptDrift = structuredClone(envelope);
    (receiptDrift.receipts[0] as Record<string, unknown>)["outputHash"] = digest("e");
    expectErrorCode(
      () => validateGowmFindingResultEnvelope(operationAuthority, receiptDrift),
      "RECEIPT_HASH_MISMATCH"
    );
  });

  it.each([
    ["SAMPLE_VALUE", "pointMeasurement", "POINT_MEASUREMENT", { unit: "metre" }],
    ["SAMPLE_CLASS", "pointClassificationGeneric", "POINT_CLASSIFICATION", {
      productType: "UGV_TRAVERSABILITY",
      productProfile: "DEFAULT",
      allowedClassCodes: ["CONDITIONALLY_PASSABLE"]
    }],
    ["FIND_CLASS", "spatialFeatures", "SPATIAL_FEATURE_COLLECTION", {
      allowedClassCodes: ["HIGH_GROUND"]
    }],
    ["PROFILE_VALUE", "profile", "PROFILE", { unit: "metre" }],
    ["QUALIFIED_EXPLANATION", "qualifiedExplanation", "QUALIFIED_EXPLANATION", {
      queryProfile: "SAMPLE_CLASS",
      allowedClassCodes: ["CONDITIONALLY_PASSABLE"]
    }],
    ["CATALOG", "catalog", "CATALOG", {}]
  ] as const)("decodes actual %s payload shape to %s", (pattern, fixtureName, findingKind, options) => {
    const input = decoderInput(pattern, testVectors.payloads[fixtureName], options);
    const result = new FindingDecoderRegistry([exactRegistration(input, "exact.test", pattern)]).decode(input);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.findingKind).toBe(findingKind);
    expect(result.findingSetHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("maps distanceMetres to distanceM and takes unit only from the locked descriptor", () => {
    const input = decoderInput("PROFILE_VALUE", testVectors.payloads["profile"], { unit: "metre" });
    const finding = new FindingDecoderRegistry([exactRegistration(input)]).decode(input).findings[0];
    expect(finding?.findingKind).toBe("PROFILE");
    if (finding?.findingKind !== "PROFILE") throw new Error("profile finding expected");
    expect(finding.samples.map(({ distanceM }) => distanceM)).toEqual([0, 100]);
    expect(finding.unit).toBe("metre");
    expect(finding.truncated).toBe(false);
  });

  it.each([
    ["SAMPLE_VALUE", "pointMeasurementGenericService", "geo-raster.sample", "POINT_MEASUREMENT", {
      productType: "ELEVATION_DTM",
      productProfile: "DEFAULT",
      unit: "metre"
    }],
    ["PROFILE_VALUE", "profileGenericService", "geo-raster.profile", "PROFILE", {
      productType: "ELEVATION_DTM",
      productProfile: "DEFAULT",
      unit: "metre"
    }],
    ["FIND_VALUE_RANGE", "valueRangeGenericService", "geo-raster.find-by-range", "SPATIAL_FEATURE_COLLECTION", {
      productType: "SLOPE",
      productProfile: "DEGREE",
      unit: "degree"
    }]
  ] as const)(
    "decodes the actual generic service shape for %s with descriptor-bound nested unit",
    (pattern, fixtureName, operationId, findingKind, options) => {
      const input = decoderInput(pattern, testVectors.payloads[fixtureName], {
        ...options,
        operationId,
        schema: schemaForOperation(operationId)
      });
      const result = new FindingDecoderRegistry([exactRegistration(input)]).decode(input);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.findingKind).toBe(findingKind);
      expect(JSON.stringify(result.findings[0])).not.toContain("ranges");
    }
  );

  it("decodes the direct geo-product.get current-product shape with public metadata", () => {
    const input = decoderInput("CATALOG", testVectors.payloads["currentProductGet"], {
      operationId: "geo-product.get",
      schema: schemaForOperation("geo-product.get")
    });
    const result = new FindingDecoderRegistry([exactRegistration(input)]).decode(input);
    const finding = result.findings[0];
    expect(finding?.findingKind).toBe("CATALOG");
    if (finding?.findingKind !== "CATALOG") throw new Error("catalog finding expected");
    expect(finding.returnedCount).toBe(1);
    expect(finding.items).toEqual([{
      productId: "gdps-baseline-dtm",
      productType: "ELEVATION_DTM",
      displayName: "Baseline terrain model"
    }]);
    expect(JSON.stringify(finding)).not.toContain("productProfile");
  });

  it("matches traversability.explain by its real SAMPLE_CLASS descriptor profile", () => {
    const input = decoderInput(
      "QUALIFIED_EXPLANATION",
      testVectors.payloads["qualifiedExplanation"],
      { queryProfile: "SAMPLE_CLASS", allowedClassCodes: ["CONDITIONALLY_PASSABLE"] }
    );
    const registry = new FindingDecoderRegistry([
      exactRegistration(input, "exact.traversability-explain", "QUALIFIED_EXPLANATION")
    ]);
    const result = registry.decode(input);
    expect(result.selection).toEqual({
      decoderId: "exact.traversability-explain",
      priority: "EXACT_OPERATION_SCHEMA",
      pattern: "QUALIFIED_EXPLANATION"
    });
    expect(input.descriptor.queryProfile).toBe("SAMPLE_CLASS");
  });

  it("derives returnedCount, emits PARTIAL and TRUNCATED gaps only from upstream truth", () => {
    const input = decoderInput("FIND_CLASS", testVectors.payloads["spatialFeatures"], {
      allowedClassCodes: ["HIGH_GROUND"]
    });
    const result = new FindingDecoderRegistry([exactRegistration(input)]).decode(input);
    const finding = result.findings[0];
    expect(finding?.findingKind).toBe("SPATIAL_FEATURE_COLLECTION");
    if (finding?.findingKind !== "SPATIAL_FEATURE_COLLECTION") throw new Error("spatial finding expected");
    expect(finding.returnedCount).toBe(finding.features.length);
    expect(finding.status).toBe("PARTIAL");
    expect(result.status).toBe("PARTIAL");
    expect(result.gaps.map(({ gapKind }) => gapKind)).toEqual(["TRUNCATED"]);
  });

  it("preserves an upstream PARTIAL outcome even when it is not a truncation", () => {
    const payload = structuredClone(testVectors.payloads["spatialFeatures"]) as { truncated: boolean };
    payload.truncated = false;
    const input = decoderInput("FIND_CLASS", payload, {
      status: "PARTIAL",
      allowedClassCodes: ["HIGH_GROUND"]
    });
    const result = new FindingDecoderRegistry([exactRegistration(input)]).decode(input);
    expect(result.status).toBe("PARTIAL");
    expect(result.gaps.map(({ gapKind }) => gapKind)).toEqual(["DATA_GAP"]);
  });

  it.each(["NO_DATA", "INDETERMINATE"] as const)("returns zero findings for %s", (status) => {
    const noDataPayload = {
      schemaVersion: "gdps-raster-sample-result/1.0",
      productId: "gdps-baseline-dtm",
      contentHash: digest("8"),
      point: { type: "Point", coordinates: [116.391, 39.907] },
      value: null,
      noData: true
    };
    const input = decoderInput("SAMPLE_VALUE", noDataPayload, { status, unit: "metre" });
    const result = new FindingDecoderRegistry([exactRegistration(input)]).decode(input);
    expect(result.findings).toEqual([]);
    expect(result.gaps).toHaveLength(1);
  });

  it("fails closed on an unknown schema and never copies safePayload", () => {
    const input = decoderInput(
      "SAMPLE_VALUE",
      testVectors.payloads["pointMeasurement"],
      { unit: "metre" }
    );
    const result = new FindingDecoderRegistry([]).decode(input);
    expect(result.findings).toEqual([]);
    expect(result.gaps[0]?.gapKind).toBe("UNSUPPORTED_FINDING_SCHEMA");
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
    const forged = {
      ...input,
      safePayload: { credential: "must-not-escape" }
    } as unknown as FindingDecoderInput;
    expectErrorCode(() => new FindingDecoderRegistry([]).decode(forged), "SAFE_PAYLOAD_INPUT_FORBIDDEN");
  });

  it("selects exact operation+schema before semantic profile before generic pattern", () => {
    const input = decoderInput("SAMPLE_VALUE", testVectors.payloads["pointMeasurement"], { unit: "metre" });
    const output = input.envelope.output!;
    const registrations = standardDecoderRegistrations([
      {
        decoderId: "generic",
        priority: "GENERIC_PATTERN",
        pattern: "SAMPLE_VALUE",
        payloadSchemaUri: output.schemaUri,
        payloadSchemaHash: output.schemaHash
      },
      {
        decoderId: "semantic",
        priority: "SEMANTIC_PROFILE",
        pattern: "SAMPLE_VALUE",
        semanticProfileHash: input.descriptor.semanticProfileHash,
        payloadSchemaUri: output.schemaUri,
        payloadSchemaHash: output.schemaHash
      },
      {
        decoderId: "exact",
        priority: "EXACT_OPERATION_SCHEMA",
        pattern: "SAMPLE_VALUE",
        operationId: input.envelope.operation.operationId,
        operationVersion: input.envelope.operation.operationVersion,
        payloadSchemaUri: output.schemaUri,
        payloadSchemaHash: output.schemaHash
      }
    ]);
    const registry = new FindingDecoderRegistry(registrations);
    expect(registry.decode(input).selection?.decoderId).toBe("exact");
    expect(new FindingDecoderRegistry(registrations.slice(0, 2)).decode(input).selection?.decoderId)
      .toBe("semantic");
  });

  it("is byte deterministic and insensitive to feature input order", () => {
    const payload = structuredClone(testVectors.payloads["spatialFeatures"]) as {
      features: unknown[];
      truncated: boolean;
    };
    payload.truncated = false;
    const reversed = structuredClone(payload);
    reversed.features.reverse();
    const leftInput = decoderInput("FIND_CLASS", payload, { allowedClassCodes: ["HIGH_GROUND"] });
    const rightInput = decoderInput("FIND_CLASS", reversed, { allowedClassCodes: ["HIGH_GROUND"] });
    const registry = new FindingDecoderRegistry([exactRegistration(leftInput)]);
    const left = registry.decode(leftInput);
    const right = registry.decode(rightInput);
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(left.findingSetHash).toBe(right.findingSetHash);
  });

  it("rejects forged decoder inputs and post-validation mutation", () => {
    const complete = decoderInput("SAMPLE_VALUE", testVectors.payloads["pointMeasurement"], { unit: "metre" });
    const incompleteEnvelope = structuredClone(complete.envelope) as unknown as Record<string, unknown>;
    delete incompleteEnvelope["computeSnapshot"];
    const incomplete: FindingDecoderInput = {
      ...complete,
      envelope: incompleteEnvelope as unknown as GowmResultEnvelope
    };
    expectErrorCode(
      () => new FindingDecoderRegistry([exactRegistration(complete)]).decode(incomplete),
      "UNVALIDATED_RESULT_ENVELOPE"
    );

    const mutated = structuredClone(complete);
    const outputValue = mutated.envelope.output?.value as { value: number };
    outputValue.value += 1;
    expectErrorCode(
      () => new FindingDecoderRegistry([exactRegistration(complete)]).decode(mutated),
      "UNVALIDATED_RESULT_ENVELOPE"
    );
  });

  it("strictly rejects generic nested drift and noData/value contradictions", () => {
    const withUnit = structuredClone(testVectors.payloads["pointClassificationGeneric"]) as {
      result: Record<string, unknown>;
    };
    withUnit.result["unit"] = "class";
    const unitInput = decoderInput("SAMPLE_CLASS", withUnit, {
      productType: "UGV_TRAVERSABILITY",
      productProfile: "DEFAULT",
      allowedClassCodes: ["CONDITIONALLY_PASSABLE"]
    });
    expectErrorCode(
      () => new FindingDecoderRegistry([exactRegistration(unitInput)]).decode(unitInput),
      "GENERIC_RESULT_UNIT_MISMATCH"
    );

    const contradiction = structuredClone(testVectors.payloads["pointMeasurement"]) as Record<string, unknown>;
    contradiction["noData"] = true;
    const noDataInput = decoderInput("SAMPLE_VALUE", contradiction, { unit: "metre" });
    expectErrorCode(
      () => new FindingDecoderRegistry([exactRegistration(noDataInput)]).decode(noDataInput),
      "NO_DATA_VALUE_CONTRADICTION"
    );
  });

  it("requires every FIND_CLASS feature to bind a frozen vocabulary class", () => {
    const payload = structuredClone(testVectors.payloads["spatialFeatures"]) as {
      features: Array<{ properties: Record<string, unknown> }>;
      truncated: boolean;
    };
    payload.truncated = false;
    delete payload.features[0]!.properties["classCode"];
    const input = decoderInput("FIND_CLASS", payload, { allowedClassCodes: ["HIGH_GROUND"] });
    expectErrorCode(
      () => new FindingDecoderRegistry([exactRegistration(input)]).decode(input),
      "FEATURE_CLASS_CODE_REQUIRED"
    );
  });

  it("normalizes a generic COMPLETED noData sample to NO_DATA with no finding", () => {
    const payload = structuredClone(testVectors.payloads["pointMeasurementGenericService"]) as {
      result: Record<string, unknown>;
    };
    payload.result["value"] = null;
    payload.result["noData"] = true;
    const input = decoderInput("SAMPLE_VALUE", payload, {
      operationId: "geo-raster.sample",
      schema: schemaForOperation("geo-raster.sample"),
      productType: "ELEVATION_DTM",
      productProfile: "DEFAULT",
      unit: "metre"
    });
    const result = new FindingDecoderRegistry([exactRegistration(input)]).decode(input);
    expect(result.status).toBe("NO_DATA");
    expect(result.selection?.pattern).toBe("SAMPLE_VALUE");
    expect(result.findings).toEqual([]);
    expect(result.gaps.map(({ gapKind }) => gapKind)).toEqual(["DATA_GAP"]);
  });

  it("rejects generic sample truncation instead of silently dropping it", () => {
    const payload = structuredClone(testVectors.payloads["pointMeasurementGenericService"]) as Record<string, unknown>;
    payload["truncated"] = true;
    const input = decoderInput("SAMPLE_VALUE", payload, {
      operationId: "geo-raster.sample",
      schema: schemaForOperation("geo-raster.sample"),
      productType: "ELEVATION_DTM",
      productProfile: "DEFAULT",
      unit: "metre"
    });
    expectErrorCode(
      () => new FindingDecoderRegistry([exactRegistration(input)]).decode(input),
      "SAMPLE_RESULT_TRUNCATION_FORBIDDEN"
    );
  });

  it.each([
    ["pointMeasurement", "SAMPLE_VALUE", "unit"],
    ["profile", "PROFILE_VALUE", "unit"],
    ["spatialFeatures", "FIND_CLASS", "unit"]
  ] as const)("keeps dedicated %s shared payload closed to injected %s", (fixtureName, pattern, key) => {
    expectErrorCode(() => {
      const payload = structuredClone(testVectors.payloads[fixtureName]) as Record<string, unknown>;
      payload[key] = "metre";
      decoderInput(pattern, payload, {
        ...(pattern === "PROFILE_VALUE" || pattern === "SAMPLE_VALUE" ? { unit: "metre" } : {}),
        ...(pattern === "FIND_CLASS" ? { allowedClassCodes: ["HIGH_GROUND"] } : {})
      });
    }, "GDPS_OUTPUT_VALUE_SCHEMA_MISMATCH");
  });

  it("normalizes empty feature and catalog results without inferring a negative fact", () => {
    const featurePayload = structuredClone(testVectors.payloads["spatialFeatures"]) as {
      features: unknown[];
      truncated: boolean;
    };
    featurePayload.features = [];
    featurePayload.truncated = false;
    const featureInput = decoderInput("FIND_CLASS", featurePayload, {
      allowedClassCodes: ["HIGH_GROUND"]
    });
    const featureResult = new FindingDecoderRegistry([exactRegistration(featureInput)]).decode(featureInput);
    expect(featureResult.status).toBe("NO_DATA");
    expect(featureResult.findings).toEqual([]);

    const catalogPayload = structuredClone(testVectors.payloads["catalog"]) as {
      products: unknown[];
      truncated: boolean;
    };
    catalogPayload.products = [];
    const catalogInput = decoderInput("CATALOG", catalogPayload);
    const catalogResult = new FindingDecoderRegistry([exactRegistration(catalogInput)]).decode(catalogInput);
    expect(catalogResult.status).toBe("NO_DATA");
    expect(catalogResult.findings).toEqual([]);
  });

  it("preserves PARTIAL when an incomplete empty result cannot establish NO_DATA", () => {
    const payload = structuredClone(testVectors.payloads["spatialFeatures"]) as {
      features: unknown[];
      truncated: boolean;
    };
    payload.features = [];
    payload.truncated = false;
    const input = decoderInput("FIND_CLASS", payload, {
      status: "PARTIAL",
      allowedClassCodes: ["HIGH_GROUND"]
    });
    const result = new FindingDecoderRegistry([exactRegistration(input)]).decode(input);
    expect(result.status).toBe("PARTIAL");
    expect(result.findings).toEqual([]);
    expect(result.gaps).toMatchObject([{
      gapKind: "DATA_GAP",
      severity: "WARNING",
      messageCode: "WSGS_UPSTREAM_PARTIAL_RESULT"
    }]);
  });

  it.each(["spatialFeatures", "catalog"] as const)(
    "rejects an empty but truncated %s result",
    (fixtureName) => {
      const payload = structuredClone(testVectors.payloads[fixtureName]) as {
        features?: unknown[];
        products?: unknown[];
        truncated: boolean;
      };
      if (payload.features !== undefined) payload.features = [];
      if (payload.products !== undefined) payload.products = [];
      payload.truncated = true;
      const pattern = fixtureName === "catalog" ? "CATALOG" : "FIND_CLASS";
      const input = decoderInput(pattern, payload, {
        ...(pattern === "FIND_CLASS" ? { allowedClassCodes: ["HIGH_GROUND"] } : {})
      });
      expectErrorCode(
        () => new FindingDecoderRegistry([exactRegistration(input)]).decode(input),
        "EMPTY_TRUNCATED_RESULT_CONTRADICTION"
      );
    }
  );

  it("omits mixed profile noData samples and emits a PARTIAL DATA_GAP", () => {
    const payload = structuredClone(testVectors.payloads["profile"]) as {
      samples: Array<Record<string, unknown>>;
    };
    payload.samples[0]!["value"] = null;
    payload.samples[0]!["noData"] = true;
    const input = decoderInput("PROFILE_VALUE", payload, { unit: "metre" });
    const result = new FindingDecoderRegistry([exactRegistration(input)]).decode(input);
    const finding = result.findings[0];
    expect(finding?.findingKind).toBe("PROFILE");
    if (finding?.findingKind !== "PROFILE") throw new Error("profile finding expected");
    expect(finding.status).toBe("PARTIAL");
    expect(finding.samples).toHaveLength(1);
    expect(finding.unknowns).toEqual(["PROFILE_NO_DATA_SAMPLES_OMITTED"]);
    expect(result.gaps.map(({ gapKind }) => gapKind)).toEqual(["DATA_GAP"]);
  });

  it("normalizes an all-noData profile to zero findings", () => {
    const payload = structuredClone(testVectors.payloads["profile"]) as {
      samples: Array<Record<string, unknown>>;
    };
    for (const sample of payload.samples) {
      sample["value"] = null;
      sample["noData"] = true;
    }
    const input = decoderInput("PROFILE_VALUE", payload, { unit: "metre" });
    const result = new FindingDecoderRegistry([exactRegistration(input)]).decode(input);
    expect(result.status).toBe("NO_DATA");
    expect(result.findings).toEqual([]);
    expect(result.gaps.map(({ gapKind }) => gapKind)).toEqual(["DATA_GAP"]);
  });

  it("validates noData profile sample distances and flag/value consistency before omission", () => {
    const contradictory = structuredClone(testVectors.payloads["profile"]) as {
      samples: Array<Record<string, unknown>>;
    };
    contradictory.samples[0]!["noData"] = true;
    const contradictionInput = decoderInput("PROFILE_VALUE", contradictory, { unit: "metre" });
    expectErrorCode(
      () => new FindingDecoderRegistry([exactRegistration(contradictionInput)]).decode(contradictionInput),
      "PROFILE_NO_DATA_VALUE_CONTRADICTION"
    );

    const nonMonotonic = structuredClone(testVectors.payloads["profile"]) as {
      samples: Array<Record<string, unknown>>;
    };
    nonMonotonic.samples[0]!["distanceMetres"] = 90;
    nonMonotonic.samples[0]!["value"] = null;
    nonMonotonic.samples[0]!["noData"] = true;
    nonMonotonic.samples[1]!["distanceMetres"] = 80;
    const nonMonotonicInput = decoderInput("PROFILE_VALUE", nonMonotonic, { unit: "metre" });
    expectErrorCode(
      () => new FindingDecoderRegistry([exactRegistration(nonMonotonicInput)]).decode(nonMonotonicInput),
      "PROFILE_DISTANCE_NOT_MONOTONIC"
    );
  });

  it("strictly validates FIND_VALUE_RANGE service ranges without publishing them northbound", () => {
    type RangePayload = {
      result: {
        unit?: unknown;
        features: Array<{ properties: Record<string, unknown>; geometry: unknown }>;
      };
    };
    const base = testVectors.payloads["valueRangeGenericService"];
    const cases: Array<{
      code: string;
      mutate: (payload: RangePayload) => void;
    }> = [
      {
        code: "INVALID_FEATURE_VALUE_RANGES",
        mutate: (payload) => { payload.result.features[0]!.properties["ranges"] = []; }
      },
      {
        code: "INVALID_FEATURE_VALUE_RANGES",
        mutate: (payload) => {
          payload.result.features[0]!.properties["ranges"] = Array.from(
            { length: 257 },
            () => ({ minimumInclusive: 1 })
          );
        }
      },
      {
        code: "UNKNOWN_FEATURE_VALUE_RANGE_FIELD",
        mutate: (payload) => {
          payload.result.features[0]!.properties["ranges"] = [{ minimumInclusive: 1, unsafe: 2 }];
        }
      },
      {
        code: "NON_FINITE_CANONICAL_NUMBER",
        mutate: (payload) => {
          payload.result.features[0]!.properties["ranges"] = [{ minimumInclusive: Number.POSITIVE_INFINITY }];
        }
      },
      {
        code: "AMBIGUOUS_FEATURE_VALUE_RANGE",
        mutate: (payload) => {
          payload.result.features[0]!.properties["ranges"] = [
            { minimumInclusive: 1, minimumExclusive: 2 }
          ];
        }
      },
      {
        code: "FEATURE_VALUE_RANGE_REVERSED",
        mutate: (payload) => {
          payload.result.features[0]!.properties["ranges"] = [
            { minimumInclusive: 30, maximumInclusive: 15 }
          ];
        }
      },
      {
        code: "INVALID_RESULT_FEATURE_PROPERTIES",
        mutate: (payload) => { payload.result.features[0]!.properties["unsafe"] = ["not-scalar"]; }
      },
      {
        code: "GENERIC_RESULT_UNIT_MISMATCH",
        mutate: (payload) => { payload.result.unit = "metre"; }
      }
    ];
    for (const { code, mutate } of cases) {
      const action = (): unknown => {
        const payload = structuredClone(base) as RangePayload;
        mutate(payload);
        const input = decoderInput("FIND_VALUE_RANGE", payload, {
          operationId: "geo-raster.find-by-range",
          schema: schemaForOperation("geo-raster.find-by-range"),
          productType: "SLOPE",
          productProfile: "DEGREE",
          unit: "degree"
        });
        return new FindingDecoderRegistry([exactRegistration(input)]).decode(input);
      };
      if (code === "NON_FINITE_CANONICAL_NUMBER") expect(action).toThrow(code);
      else expectErrorCode(action, code);
    }
  });

  it.each([
    [{ type: "Point", coordinates: [116.38, 39.9, 10] }],
    [{ type: "MultiPoint", coordinates: [[116.38, 39.9]] }],
    [{ type: "MultiLineString", coordinates: [[[116.38, 39.9], [116.39, 39.91]]] }]
  ] as const)("rejects unsupported or non-2D GDPS source geometry %#", (sourceGeometry) => {
    expectErrorCode(() => {
      const payload = structuredClone(testVectors.payloads["spatialFeatures"]) as {
        features: Array<{ geometry: unknown }>;
        truncated: boolean;
      };
      payload.truncated = false;
      payload.features[0]!.geometry = sourceGeometry;
      decoderInput("FIND_CLASS", payload, { allowedClassCodes: ["HIGH_GROUND"] });
    }, "GDPS_OUTPUT_VALUE_SCHEMA_MISMATCH");
  });

  it("keeps finding and gap IDs collision-resistant across batch dimensions", () => {
    const payload = testVectors.payloads["pointMeasurementGenericService"];
    const genericOptions = {
      operationId: "geo-raster.sample",
      schema: schemaForOperation("geo-raster.sample")
    } as const;
    const left = decoderInput("SAMPLE_VALUE", payload, {
      ...genericOptions,
      productType: "ELEVATION_DTM",
      productProfile: "DEFAULT",
      unit: "metre",
      subjectReferenceProductIds: ["reference.b", "reference.a"]
    });
    const reordered = decoderInput("SAMPLE_VALUE", payload, {
      ...genericOptions,
      productType: "ELEVATION_DTM",
      productProfile: "DEFAULT",
      unit: "metre",
      subjectReferenceProductIds: ["reference.a", "reference.b"]
    });
    const otherPayload = structuredClone(payload) as Record<string, unknown>;
    otherPayload["productType"] = "ELEVATION_DSM";
    otherPayload["descriptorId"] = "ELEVATION_DSM/DEFAULT";
    otherPayload["descriptorHash"] =
      "sha256:0cb51b27447449e8ce3337002d88f20eb8700b163a43243414ace14abbab08db";
    const otherDescriptor = decoderInput("SAMPLE_VALUE", otherPayload, {
      ...genericOptions,
      productType: "ELEVATION_DSM",
      productProfile: "DEFAULT",
      unit: "metre",
      subjectReferenceProductIds: ["reference.a", "reference.b"]
    });
    const partial = decoderInput("SAMPLE_VALUE", payload, {
      ...genericOptions,
      status: "PARTIAL",
      productType: "ELEVATION_DTM",
      productProfile: "DEFAULT",
      unit: "metre",
      subjectReferenceProductIds: ["reference.a", "reference.b"]
    });
    const registry = new FindingDecoderRegistry([exactRegistration(left)]);
    expect(registry.decode(left).findings[0]?.findingId)
      .toBe(registry.decode(reordered).findings[0]?.findingId);
    const batch = registry.decodeAll([left, otherDescriptor, partial]);
    expect(batch.findings).toHaveLength(3);
    expect(new Set(batch.findings.map(({ findingId }) => findingId)).size).toBe(3);

    const noDataPayload = structuredClone(payload) as Record<string, unknown>;
    const noDataResult = noDataPayload["result"] as Record<string, unknown>;
    noDataResult["value"] = null;
    noDataResult["noData"] = true;
    const noDataLeft = decoderInput("SAMPLE_VALUE", noDataPayload, {
      ...genericOptions,
      productType: "ELEVATION_DTM",
      productProfile: "DEFAULT",
      unit: "metre"
    });
    const otherNoDataPayload = structuredClone(noDataPayload) as Record<string, unknown>;
    otherNoDataPayload["productType"] = "ELEVATION_DSM";
    otherNoDataPayload["descriptorId"] = "ELEVATION_DSM/DEFAULT";
    otherNoDataPayload["descriptorHash"] =
      "sha256:0cb51b27447449e8ce3337002d88f20eb8700b163a43243414ace14abbab08db";
    const noDataRight = decoderInput("SAMPLE_VALUE", otherNoDataPayload, {
      ...genericOptions,
      productType: "ELEVATION_DSM",
      productProfile: "DEFAULT",
      unit: "metre"
    });
    const gapBatch = registry.decodeAll([noDataLeft, noDataRight]);
    expect(gapBatch.gaps).toHaveLength(2);
    expect(new Set(gapBatch.gaps.map(({ gapId }) => gapId)).size).toBe(2);

    const alternateRegistry = new FindingDecoderRegistry([
      exactRegistration(left, "exact.alternate")
    ]);
    expect(alternateRegistry.decode(left).findings[0]?.findingId)
      .not.toBe(registry.decode(left).findings[0]?.findingId);
  });

  it("fails rather than silently slicing catalog items beyond the northbound schema limit", () => {
    const catalog = structuredClone(testVectors.payloads["catalog"]) as { products: unknown[] };
    const item = catalog.products[0];
    catalog.products = Array.from({ length: 257 }, (_unused, index) => ({
      ...(item as Record<string, unknown>),
      productId: `product-${index}`
    }));
    const input = decoderInput("CATALOG", catalog);
    expectErrorCode(
      () => new FindingDecoderRegistry([exactRegistration(input)]).decode(input),
      "CATALOG_RESULT_LIMIT_EXCEEDED"
    );
  });

  it("validates every custom decoder result with the authoritative WorldFinding schema", () => {
    const input = decoderInput("SAMPLE_VALUE", testVectors.payloads["pointMeasurement"], { unit: "metre" });
    const invalid: FindingDecoderRegistration = {
      ...exactRegistration(input),
      decode: () => ({ findingId: "invalid", safePayload: true }) as never
    };
    expectErrorCode(
      () => new FindingDecoderRegistry([invalid]).decode(input),
      "WSGS_SACS_GEOSPATIAL_SCHEMA_MISMATCH"
    );
  });

  it("classifies all 30 FINAL_B capability locks without double-counting dynamic raster sample", () => {
    const closureOperations = (
      gdpsV021FindingContractClosure.operations
    ) as unknown as readonly ClosureOperation[];
    const closureDescriptors = (
      gdpsV021FindingContractClosure.descriptorAuthority.registry.descriptors
    ) as unknown as readonly ClosureDescriptor[];
    const descriptorById = new Map(
      closureDescriptors.map((descriptor) => [descriptor.descriptorId, descriptor] as const)
    );
    const supportedOperations = closureOperations.filter(
      ({ findingBinding }) => findingBinding.applicability !== "NOT_APPLICABLE"
    );
    const bindings = supportedOperations.flatMap((operation) => {
      const patterns: FindingDecoderPattern[] = operation.operationId === "geo-raster.sample"
        ? ["SAMPLE_VALUE", "SAMPLE_CLASS"]
        : operation.findingBinding.decoderPattern === null
          ? []
          : [operation.findingBinding.decoderPattern];
      return patterns.map((pattern) => ({
        decoderId: `final-b.${operation.operationId}@${operation.operationVersion}.${pattern}`,
        priority: "EXACT_OPERATION_SCHEMA" as const,
        pattern,
        ...(operation.operationId === "traversability.explain"
          ? { matchQueryProfile: "SAMPLE_CLASS" as const }
          : {}),
        operationId: operation.operationId,
        operationVersion: operation.operationVersion,
        payloadSchemaUri: operation.outputSchemaUri,
        payloadSchemaHash: operation.outputSchemaHash
      }));
    });
    const candidates: DecoderCoverageCandidate[] = closureOperations.map((operation) => {
      const binding = operation.findingBinding;
      const descriptor = binding.descriptorConstraint === null
        ? undefined
        : descriptorById.get(binding.descriptorConstraint.descriptorId);
      if (binding.descriptorConstraint !== null && descriptor === undefined) {
        throw new Error(`missing locked descriptor ${binding.descriptorConstraint.descriptorId}`);
      }
      const queryProfile: FindingDecoderPattern | undefined = binding.applicability === "CATALOG"
        ? "CATALOG"
        : binding.queryProfile === null || binding.queryProfile === "SAMPLE_VALUE_OR_CLASS"
          ? undefined
          : binding.queryProfile;
      return {
        capabilityId: `${operation.operationId}@${operation.operationVersion}`,
        operationId: operation.operationId,
        operationVersion: operation.operationVersion,
        payloadSchemaUri: operation.outputSchemaUri,
        payloadSchemaHash: operation.outputSchemaHash,
        semanticProfileHash: operation.semanticProfileHash,
        ...(descriptor === undefined ? {} : {
          productType: descriptor.productType,
          productProfile: descriptor.productProfile
        }),
        querySemantics: binding.querySemantics,
        ...(queryProfile === undefined ? {} : { queryProfile }),
        ...(binding.applicability === "NOT_APPLICABLE"
          ? { applicability: "NOT_APPLICABLE" as const }
          : {})
      };
    });
    const registry = new FindingDecoderRegistry(standardDecoderRegistrations(bindings));
    const summary = registry.coverage(candidates);
    expect(summary.counts).toEqual(coverageFixture.counts);
    const dynamic = summary.rows.find(({ operationId }) => operationId === "geo-raster.sample");
    expect(dynamic?.findingKindOptions).toEqual(["POINT_CLASSIFICATION", "POINT_MEASUREMENT"]);
    expect(candidates.find(({ operationId }) => operationId === "geo-product.get"))
      .not.toHaveProperty("productType");
    expect(candidates.find(({ operationId }) => operationId === "elevation.sample"))
      .toMatchObject({
        productType: "ELEVATION_DTM",
        productProfile: "DEFAULT",
        querySemantics: "READ_VALUE",
        queryProfile: "SAMPLE_VALUE"
      });
    expect(candidates.find(({ operationId }) => operationId === "geo-raster.sample"))
      .not.toHaveProperty("productType");
    expect(new Set(bindings.map(({ pattern }) => pattern))).toEqual(new Set(FINDING_DECODER_PATTERNS));
  });
});
