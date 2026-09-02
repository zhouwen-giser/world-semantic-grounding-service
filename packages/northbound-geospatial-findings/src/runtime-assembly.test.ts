import { readFileSync } from "node:fs";

import { gdpsV021FindingContractClosure } from "@wsgs/gowm-contract-intake";
import type { GowmCapabilityResultEnvelope } from "@wsgs/gowm-execution-evidence";
import { describe, expect, it } from "vitest";

import { canonicalSha256 } from "./canonical.js";
import { ResultNormalizationError } from "./result-normalizer.js";
import { assembleRuntimeGeospatialFindings } from "./runtime-assembly.js";

type TestVectors = {
  readonly payloads: {
    readonly pointMeasurement: Record<string, unknown>;
  };
};

const testVectors = JSON.parse(readFileSync(
  new URL("../fixtures/gdps-real-result-shapes.json", import.meta.url),
  "utf8"
)) as TestVectors;
const dataScope = "scope-gdps-v021-baseline";
const digest = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;

function identity() {
  const projection = {
    servicePrincipalId: "principal.n03.runtime-test",
    actorId: "actor.n03.runtime-test",
    dataScopes: [dataScope],
    datasetScopes: ["wsgs-demo-main"],
    permissions: ["wsgs.grounding.execute"]
  };
  return {
    ...projection,
    authorizationContextHash: canonicalSha256(projection)
  };
}

function elevationSampleEnvelope(): GowmCapabilityResultEnvelope {
  const operation = { operationId: "elevation.sample", operationVersion: "1.0" } as const;
  const lock = gdpsV021FindingContractClosure.operations.find((candidate) =>
    candidate.operationId === operation.operationId
      && candidate.operationVersion === operation.operationVersion)!;
  const payload = testVectors.payloads.pointMeasurement;
  const contentHash = payload["contentHash"] as `sha256:${string}`;
  const outputHash = canonicalSha256(payload);
  const computeSnapshot = {
    provider: {
      providerId: gdpsV021FindingContractClosure.provider.providerId,
      providerVersion: gdpsV021FindingContractClosure.provider.providerVersion,
      implementationDigest: gdpsV021FindingContractClosure.provider.implementationDigest
    },
    operation,
    engine: { name: "gdps-python", version: "0.2.1", digest: digest("b") },
    policy: { version: "gdps-budget/1.0", digest: digest("c") },
    schemas: {
      inputSchemaHash: lock.inputSchemaHash,
      outputSchemaHash: lock.outputSchemaHash
    }
  };
  const referenceId = `${dataScope}:${String(payload["productId"])}`;
  return {
    providerProtocolVersion: "1.0",
    requestId: "request.n03.runtime-assembly",
    operation,
    status: "COMPLETED",
    output: {
      schemaUri: lock.outputSchemaUri,
      schemaHash: lock.outputSchemaHash,
      value: payload
    },
    dataSnapshot: {
      consistency: "CONSISTENT_AT_START",
      capturedAt: "2026-08-31T00:00:00Z",
      scopeDigest: canonicalSha256({ dataScopeKey: dataScope }),
      resources: [{
        referenceKey: {
          namespace: "gdps",
          kind: "DATASET",
          id: referenceId,
          version: contentHash
        },
        authority: gdpsV021FindingContractClosure.provider.providerId,
        pinning: "PINNED",
        digest: contentHash
      }]
    },
    computeSnapshot,
    receipts: [{
      receiptId: "receipt.n03.runtime-assembly",
      operationId: operation.operationId,
      operationVersion: operation.operationVersion,
      providerId: gdpsV021FindingContractClosure.provider.providerId,
      providerVersion: gdpsV021FindingContractClosure.provider.providerVersion,
      inputHash: digest("f"),
      outputHash,
      computeSnapshotHash: canonicalSha256(computeSnapshot),
      generatedAt: "2026-08-31T00:00:00Z",
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
    evidenceReferences: [],
    warnings: [],
    consumption: { inputBytes: 1, outputBytes: 1, rows: 1 },
    execution: {
      providerId: gdpsV021FindingContractClosure.provider.providerId,
      providerVersion: gdpsV021FindingContractClosure.provider.providerVersion,
      elapsedMs: 1,
      resultHash: outputHash
    }
  };
}

function applicableEnvelope(subjectReferenceProductIds: readonly string[] = []) {
  return {
    operationId: "elevation.sample",
    operationVersion: "1.0",
    semanticConcept: "terrain.elevation",
    descriptorId: "ELEVATION_DTM/DEFAULT",
    ...(subjectReferenceProductIds.length === 0 ? {} : { subjectReferenceProductIds }),
    envelope: elevationSampleEnvelope()
  };
}

function expectResultCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("EXPECTED_RESULT_NORMALIZATION_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(ResultNormalizationError);
    expect((error as ResultNormalizationError).code).toBe(code);
  }
}

describe("assembleRuntimeGeospatialFindings trusted bridge", () => {
  it("builds a public profile and evidence through the real FINAL_B authority path", () => {
    const assembly = assembleRuntimeGeospatialFindings({
      identity: identity(),
      selectedDataScope: dataScope,
      envelopes: [applicableEnvelope()]
    });
    expect(assembly).not.toBeNull();
    expect(assembly?.geospatialFindings).toMatchObject({
      profile: "sacs-wsgs-geospatial-findings/1.0",
      findings: [expect.objectContaining({
        findingKind: "POINT_MEASUREMENT",
        status: "COMPLETED"
      })],
      sourceProducts: [expect.objectContaining({ authority: "GDPS_CURRENT_PRODUCT" })],
      gaps: []
    });
    expect(assembly?.evidenceItems).toEqual([
      expect.objectContaining({
        productKind: "CAPABILITY_RESULT",
        authority: "GOWM_WORLD_CAPABILITY_GATEWAY",
        sourceOperation: "elevation.sample@1.0"
      })
    ]);
  });

  it("skips a NOT_APPLICABLE operation without inspecting its envelope", () => {
    const assembly = assembleRuntimeGeospatialFindings({
      identity: identity(),
      selectedDataScope: dataScope,
      envelopes: [{
        operationId: "geo-product.check-current",
        operationVersion: "1.0",
        semanticConcept: "product.currentness",
        envelope: { untrusted: "ignored" }
      }]
    });
    expect(assembly).toBeNull();
  });

  it("fails closed for an operation outside the exact FINAL_B closure", () => {
    expect(() => assembleRuntimeGeospatialFindings({
      identity: identity(),
      selectedDataScope: dataScope,
      envelopes: [{
        operationId: "unlocked.operation",
        operationVersion: "1.0",
        semanticConcept: "terrain.elevation",
        envelope: { untrusted: "must-not-be-ignored" }
      }]
    })).toThrow("Runtime finding operation is not in the locked GDPS closure");
  });

  it("fails closed instead of silently dropping a catalog descriptor identity", () => {
    expect(() => assembleRuntimeGeospatialFindings({
      identity: identity(),
      selectedDataScope: dataScope,
      envelopes: [{
        operationId: "geo-product.search",
        operationVersion: "1.0",
        semanticConcept: "geospatial.product.catalog",
        descriptorId: "ELEVATION_DTM/DEFAULT",
        envelope: { untrusted: "must-not-be-inspected" }
      }]
    })).toThrow("Catalog finding operation must not carry a descriptor identity");
  });

  it("projects subject ReferenceProduct IDs when the authority set contains them", () => {
    const assembly = assembleRuntimeGeospatialFindings({
      identity: identity(),
      selectedDataScope: dataScope,
      envelopes: [applicableEnvelope(["reference-product.vehicle-2"])],
      referenceProductIds: ["reference-product.vehicle-2"]
    });
    expect(assembly?.geospatialFindings.findings[0]?.subjectReferenceProductIds)
      .toEqual(["reference-product.vehicle-2"]);
  });

  it("accepts the frozen Result contract's full ReferenceProduct authority scale", () => {
    const referenceProductIds = Array.from(
      { length: 704 },
      (_, index) => `reference-product.${String(index).padStart(3, "0")}`
    );
    const assembly = assembleRuntimeGeospatialFindings({
      identity: identity(),
      selectedDataScope: dataScope,
      envelopes: [applicableEnvelope([referenceProductIds[703]!])],
      referenceProductIds
    });
    expect(assembly?.geospatialFindings.findings[0]?.subjectReferenceProductIds)
      .toEqual([referenceProductIds[703]]);
  });

  it("fails closed when a subject ReferenceProduct is absent from the authority set", () => {
    expectResultCode(() => assembleRuntimeGeospatialFindings({
      identity: identity(),
      selectedDataScope: dataScope,
      envelopes: [applicableEnvelope(["reference-product.vehicle-2"])],
      referenceProductIds: ["reference-product.area-a"]
    }), "SUBJECT_REFERENCE_PRODUCT_FK_MISSING");
  });
});
