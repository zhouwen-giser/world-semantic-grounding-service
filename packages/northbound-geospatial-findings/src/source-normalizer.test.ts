import { defaultSacsGeospatialSchemaRegistry } from "@wsgs/contracts";
import {
  createGdpsV021FinalBFindingAuthority,
  readGdpsFindingOperationAuthority,
  resolveGdpsFindingOperationAuthority,
  type GdpsFindingOperationAuthority
} from "@wsgs/gdps-descriptor-consumer";
import {
  validateGowmFindingResultEnvelope,
  type GowmCapabilityResultEnvelope,
  type ValidatedGowmFindingResult
} from "@wsgs/gowm-execution-evidence";
import { describe, expect, it } from "vitest";

import { canonicalSha256 } from "./canonical.js";
import {
  createTrustedSourceContext,
  normalizeSourceProducts,
  readNormalizedSourceProductBinding,
  type NormalizedSourceProductBinding,
  type SourceGroundingIdentity,
  type TrustedSourceRuntimeContext
} from "./source-normalizer.js";
import type { Sha256Digest } from "./types.js";

const digest = (character: string): Sha256Digest => `sha256:${character.repeat(64)}`;
const finalAuthority = createGdpsV021FinalBFindingAuthority();

function trustedContext(
  overrides: Partial<Omit<SourceGroundingIdentity, "authorizationContextHash">> = {},
  selectedDataScope = "scope-gdps-v021-baseline"
): TrustedSourceRuntimeContext {
  const identity = {
    servicePrincipalId: "wsgs-runtime",
    actorId: "sacs-service",
    dataScopes: ["scope-gdps-v021-baseline"],
    datasetScopes: ["wsgs-demo-main"],
    permissions: ["wsgs.grounding.execute"],
    ...overrides
  };
  return createTrustedSourceContext(
    { ...identity, authorizationContextHash: canonicalSha256(identity) },
    selectedDataScope
  );
}

function operationAuthority(operationId: string, descriptorId?: string): GdpsFindingOperationAuthority {
  return resolveGdpsFindingOperationAuthority(finalAuthority, {
    operationId,
    operationVersion: "1.0",
    semanticConcept: "N03_SOURCE_PRODUCT_TEST",
    ...(descriptorId === undefined ? {} : { descriptorId })
  });
}

interface EnvelopeOptions {
  readonly requestId?: string;
  readonly status?: GowmCapabilityResultEnvelope["status"];
  readonly includeOutput?: boolean;
  readonly includeReceipt?: boolean;
  readonly evidenceId?: string;
  readonly receiptId?: string;
  readonly snapshotCapturedAt?: string;
  readonly snapshotDataScope?: string;
  readonly snapshotScopeDigest?: Sha256Digest;
  readonly snapshotReferenceId?: string;
  readonly snapshotVersion?: Sha256Digest;
  readonly snapshotDigest?: Sha256Digest;
  readonly evidenceReferenceId?: string;
  readonly evidenceReferenceVersion?: Sha256Digest;
  readonly evidenceAuthority?: string;
  readonly extraSnapshotResource?: boolean;
  readonly includeDataSnapshot?: boolean;
  readonly includeEvidence?: boolean;
  readonly includeSensitiveFields?: boolean;
}

function validatedResult(
  authority: GdpsFindingOperationAuthority,
  payload: unknown,
  options: EnvelopeOptions = {}
): ValidatedGowmFindingResult {
  const operation = readGdpsFindingOperationAuthority(authority);
  const computeSnapshot = {
    provider: {
      providerId: operation.provider.providerId,
      providerVersion: operation.provider.providerVersion,
      implementationDigest: operation.provider.implementationDigest
    },
    operation: { operationId: operation.operationId, operationVersion: operation.operationVersion },
    engine: { name: "gdps-engine", version: "0.2.1", digest: digest("c") },
    policy: { version: "gdps-policy/1.0", digest: digest("d") },
    schemas: {
      inputSchemaHash: operation.inputSchemaHash,
      outputSchemaHash: operation.outputSchemaHash
    },
    ...(options.includeSensitiveFields === true
      ? { artifacts: [{ kind: "DATABASE", name: "internal-private-db", version: "1" }] }
      : {})
  };
  const outputHash = canonicalSha256(payload);
  const includeOutput = options.includeOutput !== false;
  const payloadRecord = payload as Record<string, unknown>;
  const snapshotDataScope = options.snapshotDataScope ?? "scope-gdps-v021-baseline";
  const catalogSnapshot = operation.authorityKind === "CATALOG";
  const productContentHash = payloadRecord["contentHash"] as Sha256Digest | undefined;
  const snapshotDigest = options.snapshotDigest
    ?? (catalogSnapshot ? outputHash : productContentHash ?? digest("0"));
  const snapshotReferenceId = options.snapshotReferenceId
    ?? (catalogSnapshot
      ? `catalog:${snapshotDataScope}`
      : `${snapshotDataScope}:${String(payloadRecord["productId"])}`);
  const snapshotResource = {
    referenceKey: {
      namespace: "gdps",
      kind: "DATASET",
      id: snapshotReferenceId,
      version: options.snapshotVersion ?? snapshotDigest
    },
    authority: operation.provider.providerId,
    pinning: "PINNED",
    digest: snapshotDigest
  };
  const receiptId = options.receiptId ?? "receipt.n03.source";
  const evidenceId = options.evidenceId ?? "evidence.n03.source";
  const envelope: GowmCapabilityResultEnvelope = {
    providerProtocolVersion: "1.0",
    requestId: options.requestId ?? "request.n03.source",
    operation: { operationId: operation.operationId, operationVersion: operation.operationVersion },
    status: options.status ?? "COMPLETED",
    ...(includeOutput
      ? { output: { schemaUri: operation.outputSchemaUri, schemaHash: operation.outputSchemaHash, value: payload } }
      : {}),
    ...(options.includeDataSnapshot === false
      ? {}
      : {
          dataSnapshot: {
            consistency: "CONSISTENT_AT_START",
            capturedAt: options.snapshotCapturedAt ?? "2026-08-31T00:00:00Z",
            scopeDigest: options.snapshotScopeDigest
              ?? canonicalSha256({ dataScopeKey: snapshotDataScope }),
            resources: options.extraSnapshotResource === true
              ? [snapshotResource, { ...snapshotResource, referenceKey: {
                  ...snapshotResource.referenceKey,
                  id: `${snapshotReferenceId}:foreign`
                } }]
              : [snapshotResource]
          }
        }),
    computeSnapshot,
    receipts: options.includeReceipt === false ? [] : [{
      receiptId,
      operationId: operation.operationId,
      operationVersion: operation.operationVersion,
      providerId: operation.provider.providerId,
      providerVersion: operation.provider.providerVersion,
      inputHash: digest("f"),
      outputHash,
      computeSnapshotHash: canonicalSha256(computeSnapshot),
      generatedAt: "2026-08-31T00:00:00Z",
      durationMs: 4,
      method: {
        engine: "gdps-engine",
        engineVersion: "0.2.1",
        methodId: "descriptor-query",
        methodVersion: "1.0"
      },
      changes: { repairApplied: false, typeChanged: false },
      warnings: []
    }],
    evidenceReferences: options.includeEvidence === true
      ? [{
          evidenceId,
          authority: options.evidenceAuthority ?? operation.provider.providerId,
          evidenceType: "CURRENT_PROJECTION_SOURCE",
          referenceKey: {
            namespace: "gdps",
            kind: "DATASET",
            id: options.evidenceReferenceId ?? snapshotReferenceId,
            version: options.evidenceReferenceVersion ?? snapshotDigest
          },
          schemaUri: options.includeSensitiveFields === true
            ? "https://internal-provider.invalid/private/path"
            : "urn:gdps:current-product:1.0",
          schemaHash: digest("1"),
          ...(options.includeSensitiveFields === true
            ? { payloadRef: "https://internal-provider.invalid/private/asset/7" }
            : {}),
          observedAt: "2026-08-31T00:00:00Z"
        }]
      : [],
    warnings: [],
    consumption: { inputBytes: 10, outputBytes: 100 },
    execution: {
      providerId: operation.provider.providerId,
      providerVersion: operation.provider.providerVersion,
      elapsedMs: 4,
      ...(includeOutput ? { resultHash: outputHash } : {})
    }
  };
  return validateGowmFindingResultEnvelope(authority, envelope);
}

function elevationSample(
  productId = "gdps-baseline-dtm",
  contentHash: Sha256Digest = digest("2")
): Record<string, unknown> {
  return {
    schemaVersion: "gdps-raster-sample-result/1.0",
    productId,
    contentHash,
    point: { type: "Point", coordinates: [116.391, 39.907] },
    value: 53.25,
    noData: false
  };
}

function elevationProfile(
  productId = "gdps-baseline-dtm",
  contentHash: Sha256Digest = digest("2")
): Record<string, unknown> {
  return {
    schemaVersion: "gdps-elevation-profile/1.0",
    productId,
    contentHash,
    lengthMetres: 10,
    samples: [
      {
        distanceMetres: 0,
        point: { type: "Point", coordinates: [116.391, 39.907] },
        value: 53.25,
        noData: false
      },
      {
        distanceMetres: 10,
        point: { type: "Point", coordinates: [116.392, 39.908] },
        value: 53.5,
        noData: false
      }
    ]
  };
}

function genericRasterSample(
  descriptorHash: Sha256Digest,
  innerContentHash: Sha256Digest = digest("2")
): Record<string, unknown> {
  return {
    schemaVersion: "gdps-geo-raster-sample-result/1.0",
    productId: "gdps-baseline-dtm",
    productType: "ELEVATION_DTM",
    productProfile: "DEFAULT",
    contentHash: digest("2"),
    descriptorId: "ELEVATION_DTM/DEFAULT",
    descriptorHash,
    result: {
      ...elevationSample("gdps-baseline-dtm", innerContentHash),
      unit: "metre"
    }
  };
}

function currentProduct(
  descriptorHash: Sha256Digest,
  dataScopeKey = "scope-gdps-v021-baseline"
): Record<string, unknown> {
  return {
    schemaVersion: "gdps-current-product/1.0",
    productId: "gdps-baseline-dtm",
    productType: "ELEVATION_DTM",
    dataScopeKey,
    name: "Baseline terrain model",
    contentHash: digest("9"),
    loadedAt: "2026-08-29T00:00:00Z",
    dataTime: "2026-08-28T12:00:00Z",
    enabled: true,
    extent: {},
    storageKind: "RASTER_FILE",
    quality: {
      qualityClass: "VERIFIED",
      verticalAccuracyM: 0.5,
      completeness: 0.99,
      providerPrivateMetric: "not-projected"
    },
    metadata: {
      gdpsDescriptor: {
        descriptorId: "ELEVATION_DTM/DEFAULT",
        descriptorHash,
        representation: "RASTER_CONTINUOUS",
        queryProfiles: ["SAMPLE_VALUE", "PROFILE_VALUE"],
        unit: "metre"
      },
      productProfile: "DEFAULT",
      internalAssetPath: "C:/private/product.tif"
    }
  };
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("expected action to throw");
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
  }
}

describe("N03 authoritative SourceProduct normalization", () => {
  it("extracts an exact current product identity and safe receipt/evidence/snapshot projections", () => {
    const authority = operationAuthority("elevation.sample");
    const operation = readGdpsFindingOperationAuthority(authority);
    const result = validatedResult(authority, elevationSample(), {
      includeSensitiveFields: true,
      includeEvidence: true
    });
    const binding = normalizeSourceProducts({ trustedContext: trustedContext(), validatedResults: [result] });
    const projection = readNormalizedSourceProductBinding(binding);
    const envelopeBinding = projection.envelopeBindings[0]!;
    const localEvidenceId = envelopeBinding.localEvidenceItem!.evidenceItemId;

    expect(projection.sourceProducts).toHaveLength(1);
    expect(projection.sourceProducts[0]).toMatchObject({
      authority: "GDPS_CURRENT_PRODUCT",
      productId: "gdps-baseline-dtm",
      productType: "ELEVATION_DTM",
      productProfile: "DEFAULT",
      contentHash: digest("2"),
      descriptorId: "ELEVATION_DTM/DEFAULT",
      descriptorHash: operation.descriptor?.descriptorHash,
      evidenceItemIds: [localEvidenceId]
    });
    defaultSacsGeospatialSchemaRegistry().validate(
      "source-product.schema.json",
      projection.sourceProducts[0]
    );
    expect(envelopeBinding.sourceProductIds).toEqual([
      projection.sourceProducts[0]?.sourceProductId
    ]);
    expect(envelopeBinding.evidenceItemIds).toEqual([localEvidenceId]);
    expect(envelopeBinding.receiptIds).toEqual(["receipt.n03.source"]);
    expect(envelopeBinding.evidenceReferences.map((value) => value.evidenceId)).toEqual([
      "evidence.n03.source"
    ]);
    expect(envelopeBinding.localEvidenceItem).toMatchObject({
      evidenceKind: "GOWM_GDPS_EXECUTION_PROVENANCE",
      receiptIds: ["receipt.n03.source"],
      upstreamEvidenceIds: ["evidence.n03.source"]
    });
    const encoded = JSON.stringify(projection);
    expect(encoded).not.toContain("internal-private-db");
    expect(encoded).not.toContain("internal-provider.invalid");
    expect(encoded).not.toContain("private-product-row-7");
    expect(encoded).not.toContain("payloadRef");
    expect(encoded).not.toContain("artifacts");
    expect(encoded).not.toContain("servicePrincipalId");
    expect(encoded).not.toContain("actorId");
    expect(encoded).not.toContain("scope-gdps-v021-baseline");
  });

  it("deduplicates exact identities result-locally, merges evidence FKs, and is order deterministic", () => {
    const sample = operationAuthority("elevation.sample");
    const profile = operationAuthority("elevation.profile");
    const first = validatedResult(sample, elevationSample(), {
      requestId: "request.n03.sample",
      receiptId: "receipt.n03.sample",
      evidenceId: "evidence.n03.sample"
    });
    const second = validatedResult(profile, elevationProfile(), {
      requestId: "request.n03.profile",
      receiptId: "receipt.n03.profile",
      evidenceId: "evidence.n03.profile"
    });
    const context = trustedContext();
    const forward = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: context,
      validatedResults: [first, second]
    }));
    const reverse = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: context,
      validatedResults: [second, first]
    }));

    expect(forward.sourceProducts).toHaveLength(1);
    const localEvidenceIds = forward.envelopeBindings
      .flatMap((binding) => binding.evidenceItemIds)
      .sort();
    expect(localEvidenceIds).toHaveLength(2);
    expect(forward.sourceProducts[0]?.evidenceItemIds).toEqual(localEvidenceIds);
    expect(forward).toEqual(reverse);
    expect(forward.sourceProductSetHash).toBe(reverse.sourceProductSetHash);
  });

  it("keeps source and local evidence identity stable across request-id-only drift", () => {
    const authority = operationAuthority("elevation.sample");
    const leftResult = validatedResult(authority, elevationSample(), {
      requestId: "request.n03.retry-a"
    });
    const rightResult = validatedResult(authority, elevationSample(), {
      requestId: "request.n03.retry-b"
    });
    const context = trustedContext();
    const left = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: context,
      validatedResults: [leftResult]
    }));
    const right = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: context,
      validatedResults: [rightResult]
    }));

    expect(left.envelopeBindings[0]?.envelopeHash).not.toBe(right.envelopeBindings[0]?.envelopeHash);
    expect(left.envelopeBindings[0]?.localEvidenceItem)
      .toEqual(right.envelopeBindings[0]?.localEvidenceItem);
    expect(left.sourceProducts).toEqual(right.sourceProducts);
    expect(left.sourceProductSetHash).toBe(right.sourceProductSetHash);
  });

  it("keeps semantic source identity stable across snapshot-time and random-receipt drift", () => {
    const authority = operationAuthority("elevation.sample");
    const leftResult = validatedResult(authority, elevationSample(), {
      requestId: "request.n03.replay-a",
      receiptId: "receipt.n03.replay-random-a",
      snapshotCapturedAt: "2026-08-31T00:00:00Z"
    });
    const rightResult = validatedResult(authority, elevationSample(), {
      requestId: "request.n03.replay-b",
      receiptId: "receipt.n03.replay-random-b",
      snapshotCapturedAt: "2026-08-31T00:00:01Z"
    });
    const context = trustedContext();
    const left = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: context,
      validatedResults: [leftResult]
    }));
    const right = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: context,
      validatedResults: [rightResult]
    }));

    expect(left.envelopeBindings[0]?.localEvidenceItem?.evidenceItemId)
      .toBe(right.envelopeBindings[0]?.localEvidenceItem?.evidenceItemId);
    expect(left.envelopeBindings[0]?.localEvidenceItem?.evidenceHash)
      .not.toBe(right.envelopeBindings[0]?.localEvidenceItem?.evidenceHash);
    expect(left.envelopeBindings[0]?.localEvidenceItem?.receiptIds)
      .toEqual(["receipt.n03.replay-random-a"]);
    expect(right.envelopeBindings[0]?.localEvidenceItem?.receiptIds)
      .toEqual(["receipt.n03.replay-random-b"]);
    expect(left.sourceProducts).toEqual(right.sourceProducts);
    expect(left.sourceProductSetHash).toBe(right.sourceProductSetHash);
  });

  it("changes local evidence identity when the authoritative upstream status changes", () => {
    const authority = operationAuthority("elevation.sample");
    const completed = validatedResult(authority, elevationSample(), {
      requestId: "request.n03.status-completed"
    });
    const partial = validatedResult(authority, elevationSample(), {
      requestId: "request.n03.status-partial",
      status: "PARTIAL"
    });
    const context = trustedContext();
    const completedProjection = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: context,
      validatedResults: [completed]
    }));
    const partialProjection = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: context,
      validatedResults: [partial]
    }));

    expect(completedProjection.envelopeBindings[0]?.localEvidenceItem?.upstreamStatus).toBe("COMPLETED");
    expect(partialProjection.envelopeBindings[0]?.localEvidenceItem?.upstreamStatus).toBe("PARTIAL");
    expect(completedProjection.envelopeBindings[0]?.evidenceItemIds)
      .not.toEqual(partialProjection.envelopeBindings[0]?.evidenceItemIds);
  });

  it("binds generic wrapper descriptor/content identities to the exact operation authority", () => {
    const authority = operationAuthority("geo-raster.sample", "ELEVATION_DTM/DEFAULT");
    const descriptorHash = readGdpsFindingOperationAuthority(authority).descriptor!.descriptorHash;
    const good = validatedResult(authority, genericRasterSample(descriptorHash));
    const product = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: [good]
    })).sourceProducts[0];
    expect(product?.descriptorHash).toBe(descriptorHash);

    const wrongDescriptor = validatedResult(authority, genericRasterSample(digest("8")), {
      requestId: "request.n03.wrong-descriptor"
    });
    expectCode(() => normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: [wrongDescriptor]
    }), "SOURCE_DESCRIPTOR_HASH_MISMATCH");

    const mismatchedInner = validatedResult(authority, genericRasterSample(descriptorHash, digest("7")), {
      requestId: "request.n03.wrong-content"
    });
    expectCode(() => normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: [mismatchedInner]
    }), "SOURCE_WRAPPED_PRODUCT_IDENTITY_MISMATCH");
  });

  it("resolves catalog metadata against the exact FINAL_B descriptor closure", () => {
    const descriptorAuthority = operationAuthority("geo-raster.sample", "ELEVATION_DTM/DEFAULT");
    const descriptorHash = readGdpsFindingOperationAuthority(descriptorAuthority).descriptor!.descriptorHash;
    const catalogAuthority = operationAuthority("geo-product.get");
    const good = validatedResult(catalogAuthority, currentProduct(descriptorHash));
    const product = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: [good]
    })).sourceProducts[0];
    expect(product).toMatchObject({
      productId: "gdps-baseline-dtm",
      descriptorHash,
      dataTime: "2026-08-28T12:00:00Z",
      qualitySummary: {
        qualityClass: "VERIFIED",
        verticalAccuracyM: 0.5,
        completenessRatio: 0.99
      }
    });
    expect(JSON.stringify(product)).not.toContain("product.tif");
    expect(JSON.stringify(product)).not.toContain("internalAssetPath");

    const missingMetadataValue = currentProduct(descriptorHash);
    delete missingMetadataValue["metadata"];
    const missingMetadata = validatedResult(catalogAuthority, missingMetadataValue, {
      requestId: "request.n03.catalog-metadata"
    });
    const missingMetadataProjection = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: [missingMetadata]
    }));
    expect(missingMetadataProjection.sourceProducts).toEqual([]);
    expect(missingMetadataProjection.envelopeBindings[0]?.qualification).toEqual({
      status: "REJECTED",
      reason: "UNSUPPORTED_FINDING_SCHEMA"
    });

    const wrongHash = validatedResult(catalogAuthority, currentProduct(digest("7")), {
      requestId: "request.n03.catalog-hash"
    });
    expectCode(() => normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: [wrongHash]
    }), "SOURCE_DESCRIPTOR_HASH_MISMATCH");

    const foreignScope = validatedResult(
      catalogAuthority,
      currentProduct(descriptorHash, "foreign-scope"),
      { requestId: "request.n03.catalog-scope" }
    );
    expectCode(() => normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: [foreignScope]
    }), "SOURCE_CATALOG_DATA_SCOPE_MISMATCH");
  });

  it("merges optional catalog provenance onto the same specialized core identity", () => {
    const sampleAuthority = operationAuthority("elevation.sample");
    const descriptorHash = readGdpsFindingOperationAuthority(sampleAuthority).descriptor!.descriptorHash;
    const catalogAuthority = operationAuthority("geo-product.get");
    const catalogValue = currentProduct(descriptorHash);
    catalogValue["contentHash"] = digest("2");
    const sample = validatedResult(sampleAuthority, elevationSample(), {
      requestId: "request.n03.merge-sample",
      receiptId: "receipt.n03.merge-sample"
    });
    const catalog = validatedResult(catalogAuthority, catalogValue, {
      requestId: "request.n03.merge-catalog",
      receiptId: "receipt.n03.merge-catalog"
    });
    const context = trustedContext();
    const forward = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: context,
      validatedResults: [sample, catalog]
    }));
    const reverse = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: context,
      validatedResults: [catalog, sample]
    }));

    expect(forward).toEqual(reverse);
    expect(forward.sourceProducts).toHaveLength(1);
    expect(forward.sourceProducts[0]).toMatchObject({
      contentHash: digest("2"),
      dataTime: "2026-08-28T12:00:00Z",
      qualitySummary: {
        qualityClass: "VERIFIED",
        verticalAccuracyM: 0.5,
        completenessRatio: 0.99
      }
    });

    const changedQualityValue = currentProduct(descriptorHash);
    changedQualityValue["contentHash"] = digest("2");
    changedQualityValue["quality"] = {
      qualityClass: "VERIFIED",
      verticalAccuracyM: 4,
      completeness: 0.99
    };
    const changedQuality = validatedResult(catalogAuthority, changedQualityValue, {
      requestId: "request.n03.changed-quality",
      receiptId: "receipt.n03.changed-quality"
    });
    const changedProjection = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: context,
      validatedResults: [catalog, changedQuality]
    }));
    expect(changedProjection.sourceProducts).toEqual([]);
    expect(changedProjection.envelopeBindings).toHaveLength(2);
    expect(changedProjection.envelopeBindings.every(({ qualification }) =>
      qualification.status === "REJECTED" && qualification.reason === "SOURCE_CHANGED")).toBe(true);
  });

  it("preserves safe bindings for failed catalog and no-data product envelopes", () => {
    const catalogAuthority = operationAuthority("geo-product.get");
    const failedCatalog = validatedResult(catalogAuthority, {}, {
      requestId: "request.n03.failed-catalog",
      status: "FAILED",
      includeOutput: false,
      includeReceipt: false,
      snapshotReferenceId: "catalog:scope-gdps-v021-baseline",
      snapshotVersion: digest("4"),
      snapshotDigest: digest("4")
    });
    const failedProjection = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: [failedCatalog]
    }));
    expect(failedProjection.sourceProducts).toEqual([]);
    expect(failedProjection.envelopeBindings[0]).toMatchObject({
      status: "FAILED",
      sourceProductIds: [],
      evidenceItemIds: [],
      receiptIds: []
    });

    const sampleAuthority = operationAuthority("elevation.sample");
    const noData = validatedResult(sampleAuthority, elevationSample(), {
      requestId: "request.n03.no-data",
      status: "NO_DATA"
    });
    const noDataProjection = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: [noData]
    }));
    expect(noDataProjection.sourceProducts).toEqual([]);
    expect(noDataProjection.envelopeBindings[0]).toMatchObject({
      status: "NO_DATA",
      sourceProductIds: []
    });
  });

  it("derives local evidence when upstream evidence references are empty", () => {
    const sample = operationAuthority("elevation.sample");
    const withoutUpstreamEvidence = validatedResult(sample, elevationSample(), {
      requestId: "request.n03.no-upstream-evidence",
      includeEvidence: false
    });
    const projection = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: [withoutUpstreamEvidence]
    }));
    const envelopeBinding = projection.envelopeBindings[0]!;

    expect(envelopeBinding.evidenceReferences).toEqual([]);
    expect(envelopeBinding.localEvidenceItem?.upstreamEvidenceIds).toEqual([]);
    expect(projection.sourceProducts[0]?.evidenceItemIds).toEqual(envelopeBinding.evidenceItemIds);
    expect(envelopeBinding.evidenceItemIds).toHaveLength(1);
  });

  it("blocks mixed scope, missing snapshot, and full-identity source changes", () => {
    const sample = operationAuthority("elevation.sample");
    const profile = operationAuthority("elevation.profile");
    const foreignSnapshot = validatedResult(sample, elevationSample(), {
      requestId: "request.n03.foreign-snapshot",
      snapshotScopeDigest: digest("7")
    });
    expectCode(() => normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: [foreignSnapshot]
    }), "SOURCE_DATA_SCOPE_MISMATCH");

    const missingSnapshot = validatedResult(sample, elevationSample(), {
      requestId: "request.n03.no-snapshot",
      includeDataSnapshot: false
    });
    const missingSnapshotProjection = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: [missingSnapshot]
    }));
    expect(missingSnapshotProjection.sourceProducts).toEqual([]);
    expect(missingSnapshotProjection.envelopeBindings[0]?.qualification).toEqual({
      status: "REJECTED",
      reason: "EVIDENCE_INCOMPLETE"
    });

    const missingReceipt = validatedResult(sample, elevationSample(), {
      requestId: "request.n03.no-receipt",
      includeReceipt: false
    });
    const missingReceiptProjection = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: [missingReceipt]
    }));
    expect(missingReceiptProjection.sourceProducts).toEqual([]);
    expect(missingReceiptProjection.envelopeBindings[0]).toMatchObject({
      qualification: { status: "REJECTED", reason: "EVIDENCE_INCOMPLETE" },
      sourceProductIds: [],
      evidenceItemIds: [],
      receiptIds: []
    });

    const first = validatedResult(sample, elevationSample(), {
      requestId: "request.n03.current-a",
      evidenceId: "evidence.n03.current-a",
      receiptId: "receipt.n03.current-a"
    });
    const changed = validatedResult(profile, elevationProfile("gdps-baseline-dtm", digest("3")), {
      requestId: "request.n03.current-b",
      evidenceId: "evidence.n03.current-b",
      receiptId: "receipt.n03.current-b"
    });
    const changedProjection = readNormalizedSourceProductBinding(normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: [first, changed]
    }));
    expect(changedProjection.sourceProducts).toEqual([]);
    expect(changedProjection.envelopeBindings.every(({ qualification }) =>
      qualification.status === "REJECTED" && qualification.reason === "SOURCE_CHANGED")).toBe(true);
  });

  it("requires exact GDPS product snapshot and optional evidence bindings", () => {
    const sample = operationAuthority("elevation.sample");
    const cases = [
      {
        requestId: "request.n03.snapshot-id",
        options: { snapshotReferenceId: "scope-gdps-v021-baseline:foreign-product" },
        code: "SOURCE_PRODUCT_SNAPSHOT_BINDING_MISMATCH"
      },
      {
        requestId: "request.n03.snapshot-version",
        options: { snapshotVersion: digest("7") },
        code: "SOURCE_PRODUCT_SNAPSHOT_BINDING_MISMATCH"
      },
      {
        requestId: "request.n03.snapshot-digest",
        options: { snapshotDigest: digest("7") },
        code: "SOURCE_PRODUCT_SNAPSHOT_BINDING_MISMATCH"
      },
      {
        requestId: "request.n03.snapshot-cardinality",
        options: { extraSnapshotResource: true },
        code: "SOURCE_DATA_SNAPSHOT_RESOURCE_CARDINALITY"
      }
    ] as const;
    for (const testCase of cases) {
      const result = validatedResult(sample, elevationSample(), {
        requestId: testCase.requestId,
        ...testCase.options
      });
      expectCode(() => normalizeSourceProducts({
        trustedContext: trustedContext(),
        validatedResults: [result]
      }), testCase.code);
    }

    const foreignEvidence = validatedResult(sample, elevationSample(), {
      requestId: "request.n03.foreign-evidence",
      includeEvidence: true,
      evidenceReferenceId: "scope-gdps-v021-baseline:foreign-product"
    });
    expectCode(() => normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: [foreignEvidence]
    }), "SOURCE_EVIDENCE_PRODUCT_BINDING_MISMATCH");
  });

  it("fails closed before emitting schema-invalid product or evidence cardinalities", () => {
    const descriptorAuthority = operationAuthority("geo-raster.sample", "ELEVATION_DTM/DEFAULT");
    const descriptorHash = readGdpsFindingOperationAuthority(descriptorAuthority).descriptor!.descriptorHash;
    const searchAuthority = operationAuthority("geo-product.search");
    const products = Array.from({ length: 65 }, (_unused, index) => ({
      ...currentProduct(descriptorHash),
      productId: `gdps-product-${String(index).padStart(3, "0")}`,
      name: `Product ${index}`
    }));
    const searchResult = validatedResult(searchAuthority, {
      schemaVersion: "gdps-product-search-result/1.0",
      products,
      truncated: false
    }, { requestId: "request.n03.catalog-overflow" });
    expectCode(() => normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: [searchResult]
    }), "SOURCE_PRODUCT_SET_LIMIT_EXCEEDED");

    const sample = operationAuthority("elevation.sample");
    const evidenceOverflow = Array.from({ length: 129 }, (_unused, index) => validatedResult(
      sample,
      elevationSample(),
      {
        requestId: `request.n03.evidence-${index}`,
        receiptId: `receipt.n03.evidence-${index}`
      }
    ));
    expectCode(() => normalizeSourceProducts({
      trustedContext: trustedContext(),
      validatedResults: evidenceOverflow
    }), "SOURCE_EVIDENCE_SET_LIMIT_EXCEEDED");
  });

  it("does not accept request-shaped trust contexts or forged provenance bindings", () => {
    const result = validatedResult(operationAuthority("elevation.sample"), elevationSample());
    expectCode(() => normalizeSourceProducts({
      trustedContext: { authorizationBindingHash: digest("7") } as TrustedSourceRuntimeContext,
      validatedResults: [result]
    }), "SOURCE_TRUSTED_CONTEXT_FORGED");

    const identity = {
      servicePrincipalId: "wsgs-runtime",
      actorId: "sacs-service",
      dataScopes: ["scope-gdps-v021-baseline"],
      datasetScopes: ["wsgs-demo-main"],
      permissions: ["wsgs.grounding.execute"]
    };
    expectCode(() => createTrustedSourceContext({
      ...identity,
      authorizationContextHash: digest("7")
    }, "scope-gdps-v021-baseline"), "SOURCE_AUTHORIZATION_CONTEXT_HASH_MISMATCH");
    expectCode(() => createTrustedSourceContext({
      ...identity,
      authorizationContextHash: canonicalSha256(identity)
    }, "foreign-scope"), "SOURCE_TRUSTED_SCOPE_NOT_AUTHORIZED");

    const real = normalizeSourceProducts({ trustedContext: trustedContext(), validatedResults: [result] });
    const forged = {
      sourceProductSetHash: real.sourceProductSetHash,
      sourceProductCount: real.sourceProductCount,
      envelopeBindingCount: real.envelopeBindingCount
    } as NormalizedSourceProductBinding;
    expectCode(
      () => readNormalizedSourceProductBinding(forged),
      "SOURCE_PROVENANCE_BINDING_FORGED"
    );
  });
});
