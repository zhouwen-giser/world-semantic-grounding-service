import { describe, expect, it } from "vitest";

import {
  GDPS_V021_HANDOFF_FILES,
  LiveOperationLockProjectionError,
  WSGS_GROUNDING_CORE_OPERATION_KEYS,
  canonicalHash,
  canonicalJson,
  projectLiveGdpsOperationLock,
  sha256,
  stableJsonBytes,
  type JsonObject,
  type LiveOperationLockProjectionInput,
} from "../validation/scripts/live-gdps-operation-lock-projector.js";

const commit = "a".repeat(40);
const observedAt = "2026-08-29T12:00:01.000Z";

function hash(label: string): `sha256:${string}` {
  return sha256(label);
}

function operation(
  key: string,
  maturity: "STABLE" | "PREVIEW",
  index: number,
): JsonObject {
  const [operationId, operationVersion] = key.split("@");
  return {
    operationId,
    operationVersion,
    inputSchemaHash: hash(`${key}:input`),
    outputSchemaHash: hash(`${key}:output`),
    maturity,
    scopePolicy:
      index % 3 === 0
        ? "DATASET_SCOPE_REQUIRED"
        : index % 3 === 1
          ? "DATA_SCOPE_REQUIRED"
          : "REQUEST_CONTEXT",
    snapshotPolicy: {
      dataSnapshot:
        index % 3 === 0 ? "REQUIRED" : index % 3 === 1 ? "OPTIONAL" : "NONE",
      computeSnapshot: "REQUIRED",
    },
  };
}

function fixture(): LiveOperationLockProjectionInput {
  const gdpsKeys = Array.from(
    { length: 30 },
    (_, index) => `gdps.operation-${String(index).padStart(2, "0")}@1.0`,
  );
  const keys = [...WSGS_GROUNDING_CORE_OPERATION_KEYS, ...gdpsKeys];
  const capabilities = keys.map((key, index) =>
    operation(key, index < 12 ? "STABLE" : "PREVIEW", index),
  );
  const profiles = capabilities
    .map((entry) => {
      const semanticProfile = {
        role: `${entry["operationId"]}-role`,
        ordinal: keys.indexOf(
          `${entry["operationId"]}@${entry["operationVersion"]}`,
        ),
      };
      return {
        operationId: entry["operationId"],
        operationVersion: entry["operationVersion"],
        semanticProfile,
        semanticProfileHash: canonicalHash(semanticProfile),
      };
    })
    .sort((left, right) =>
      `${left.operationId}@${left.operationVersion}`.localeCompare(
        `${right.operationId}@${right.operationVersion}`,
      ),
    );
  const revisions = {
    contractCatalogRevision: hash("contract"),
    semanticCatalogHash: canonicalHash(profiles),
    bindingRevision: hash("binding"),
  };
  const gdpsOperations = capabilities.slice(12).map((entry) => {
    const profile = profiles.find(
      (candidate) => candidate.operationId === entry["operationId"],
    );
    return {
      operationId: entry["operationId"],
      operationVersion: entry["operationVersion"],
      inputSchemaHash: entry["inputSchemaHash"],
      outputSchemaHash: entry["outputSchemaHash"],
      semanticProfileHash: profile?.semanticProfileHash,
      maturity: "PREVIEW",
      availability: "AVAILABLE",
    };
  });
  const capabilityLock: JsonObject = {
    schemaVersion: "gdps-v021-capability-lock/1.0",
    providerId: "gdps.geospatial-products",
    providerManifestHash: hash("manifest"),
    operations: gdpsOperations,
  };
  const gateway = { ...revisions, instanceFingerprint: hash("instance") };
  const provider = {
    providerId: "gdps.geospatial-products",
    providerVersion: "0.2.1",
    providerManifestHash: hash("manifest"),
  };
  const consumerLock: JsonObject = {
    schemaVersion: "wsgs-gdps-consumer-lock/1.0",
    sources: {
      wsgsSha: commit,
      gdpsSha: "b".repeat(40),
      gowmSha: "c".repeat(40),
    },
    gateway,
    provider,
    capabilityLockHash: canonicalHash(capabilityLock),
  };
  const gatewayBindingLock = {
    schemaVersion: "gowm-gateway-binding-lock/1.0",
    gateway,
    provider,
  };
  const fileValues: Record<string, unknown> = Object.fromEntries(
    GDPS_V021_HANDOFF_FILES.map((name) => [name, { name }]),
  );
  fileValues["GDPS_CAPABILITY_LOCK.json"] = capabilityLock;
  fileValues["GDPS_CONSUMER_LOCK.json"] = consumerLock;
  fileValues["GOWM_GATEWAY_BINDING_LOCK.json"] = gatewayBindingLock;
  const handoffFiles = Object.fromEntries(
    Object.entries(fileValues).map(([name, value]) => [
      name,
      stableJsonBytes(value),
    ]),
  );
  const fileHashes = Object.fromEntries(
    Object.entries(handoffFiles).map(([name, bytes]) => [name, sha256(bytes)]),
  );
  const checksums = {
    schemaVersion: "wsgs-gdps-v021-checksums/1.0",
    algorithm: "SHA-256",
    files: Object.entries(fileHashes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, digest]) => ({ path, sha256: digest })),
    bundleHash: canonicalHash(fileHashes),
  };
  return {
    catalog: {
      registryVersion: hash("registry"),
      registryRevision: hash("registry"),
      contractCatalogRevision: revisions.contractCatalogRevision,
      bindingRevision: revisions.bindingRevision,
      capabilities,
    },
    semantics: {
      schemaVersion: "1.1",
      registryRevision: revisions.contractCatalogRevision,
      contractCatalogRevision: revisions.contractCatalogRevision,
      bindingRevision: revisions.bindingRevision,
      profiles,
      catalogHash: revisions.semanticCatalogHash,
    },
    availability: {
      schemaVersion: "1.0",
      checkedAt: "2026-08-29T12:00:00.000Z",
      operations: capabilities.map((entry) => ({
        operationId: entry["operationId"],
        operationVersion: entry["operationVersion"],
        maturity: entry["maturity"],
        availability: "AVAILABLE",
        reasonCodes: ["READY"],
        checkedAt: "2026-08-29T12:00:00.000Z",
        validUntil: "2026-08-29T12:00:05.000Z",
        contractCatalogRevision: revisions.contractCatalogRevision,
        bindingRevision: revisions.bindingRevision,
      })),
    },
    gatewayBindingLock,
    gdpsCapabilityLock: capabilityLock,
    consumerLock,
    checksums,
    handoffFiles,
    checksumsBytes: stableJsonBytes(checksums),
    contractBasis: {
      schemaVersion: "2.0",
      gatewayContractVersion: "0.6.3",
      consumerContractPackage: {
        name: "@gowm/world-gateway-contracts",
        version: "0.6.3",
        integrity: "sha512-dGVzdA==",
      },
      availabilityContractHash: hash("availability-contract"),
      snapshotContractHash: hash("snapshot-contract"),
      delegationContractHash: hash("delegation-contract"),
    },
    sourceCommit: commit,
    observedAt,
  };
}

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error("expected projection failure");
  } catch (error) {
    expect(error).toBeInstanceOf(LiveOperationLockProjectionError);
    expect((error as LiveOperationLockProjectionError).code).toBe(code);
  }
}

describe("live GDPS operation-lock projector", () => {
  it("uses GOWM runtime and JSON canonical code-point key ordering", () => {
    expect(canonicalJson({ a: 1, B: 2, z: { y: 3, A: 4 } })).toBe(
      '{"B":2,"a":1,"z":{"A":4,"y":3}}',
    );
  });

  it("projects exact 12 stable plus 30 locked preview operations from canonical live policies", () => {
    const result = projectLiveGdpsOperationLock(fixture());
    expect(result.operationLock["defaultOperations"]).toHaveLength(12);
    expect(result.operationLock["previewOperations"]).toHaveLength(30);
    const operations = [
      ...(result.operationLock["defaultOperations"] as JsonObject[]),
      ...(result.operationLock["previewOperations"] as JsonObject[]),
    ];
    expect(operations[0]).toMatchObject({
      requiredPermissions: ["dataset:read"],
      snapshotSupport: "CONSISTENT_AT_START",
    });
    expect(operations[1]).toMatchObject({
      requiredPermissions: ["data:read"],
      snapshotSupport: "BEST_EFFORT",
    });
    expect(operations[2]).toMatchObject({
      requiredPermissions: ["gateway:execute"],
      snapshotSupport: "NONE",
    });
    expect(result.provenance).toMatchObject({
      schemaVersion: "wsgs-gdps-live-operation-lock-provenance/1.0",
      sourceCommit: commit,
      liveEvidence: { selectedOperationCount: 42, availableOperationCount: 42 },
      operationLockHash: result.operationLockHash,
    });
    expect(result.operationLockHash).toBe(sha256(result.operationLockBytes));
  });

  it("fails closed on an exact GDPS schema hash drift", () => {
    const input = fixture();
    const live = (input.catalog as JsonObject)["capabilities"] as JsonObject[];
    const target = live[12]!;
    target["inputSchemaHash"] = hash("drift");
    expectCode(
      () => projectLiveGdpsOperationLock(input),
      `GDPS_CAPABILITY_DRIFT_${target["operationId"]}@1.0_inputSchemaHash`,
    );
  });

  it("fails closed on Gateway revision drift", () => {
    const input = fixture();
    (input.catalog as JsonObject)["bindingRevision"] = hash("drift");
    expectCode(
      () => projectLiveGdpsOperationLock(input),
      "LIVE_GATEWAY_REVISION_DRIFT",
    );
  });

  it("recomputes every semantic profile hash", () => {
    const input = fixture();
    const profiles = (input.semantics as JsonObject)[
      "profiles"
    ] as JsonObject[];
    profiles[0]!["semanticProfileHash"] = hash("drift");
    expectCode(
      () => projectLiveGdpsOperationLock(input),
      `LIVE_SEMANTIC_HASH_DRIFT_${profiles[0]!["operationId"]}@1.0`,
    );
  });

  it("requires live availability and an unexpired observation", () => {
    const unavailable = fixture();
    const unavailableEntries = (unavailable.availability as JsonObject)[
      "operations"
    ] as JsonObject[];
    unavailableEntries[0]!["availability"] = "DEGRADED";
    expectCode(
      () => projectLiveGdpsOperationLock(unavailable),
      `LIVE_OPERATION_UNAVAILABLE_${unavailableEntries[0]!["operationId"]}@1.0`,
    );

    const expired = fixture();
    const expiredEntries = (expired.availability as JsonObject)[
      "operations"
    ] as JsonObject[];
    expiredEntries[0]!["validUntil"] = "2026-08-29T12:00:00.500Z";
    expectCode(
      () => projectLiveGdpsOperationLock(expired),
      `LIVE_AVAILABILITY_EXPIRED_${expiredEntries[0]!["operationId"]}@1.0`,
    );
  });

  it("rejects non-canonical scope and snapshot policies", () => {
    const scopeDrift = fixture();
    const scopeCapabilities = (scopeDrift.catalog as JsonObject)[
      "capabilities"
    ] as JsonObject[];
    scopeCapabilities[0]!["scopePolicy"] = "CUSTOM_SCOPE";
    expectCode(
      () => projectLiveGdpsOperationLock(scopeDrift),
      "SCOPE_POLICY_UNSUPPORTED",
    );

    const snapshotDrift = fixture();
    const snapshotCapabilities = (snapshotDrift.catalog as JsonObject)[
      "capabilities"
    ] as JsonObject[];
    (snapshotCapabilities[0]!["snapshotPolicy"] as JsonObject)[
      "computeSnapshot"
    ] = "OPTIONAL";
    expectCode(
      () => projectLiveGdpsOperationLock(snapshotDrift),
      "COMPUTE_SNAPSHOT_POLICY_UNSUPPORTED",
    );
  });

  it("binds the exact handoff bytes, canonical capability hash, and source commit", () => {
    const bytesDrift = fixture();
    (bytesDrift.handoffFiles as Record<string, Uint8Array>)[
      "WSGS_QUERY_CORPUS.json"
    ] = stableJsonBytes({ drift: true });
    expectCode(
      () => projectLiveGdpsOperationLock(bytesDrift),
      "HANDOFF_FILE_DRIFT_WSGS_QUERY_CORPUS.json",
    );

    const sourceDrift = fixture();
    sourceDrift.sourceCommit = "d".repeat(40);
    expectCode(
      () => projectLiveGdpsOperationLock(sourceDrift),
      "SOURCE_COMMIT_DRIFT",
    );

    const parsedDrift = fixture();
    (parsedDrift.gatewayBindingLock as JsonObject)["schemaVersion"] = "changed";
    expectCode(
      () => projectLiveGdpsOperationLock(parsedDrift),
      "HANDOFF_PARSED_CONTENT_DRIFT",
    );
  });

  it("rejects duplicate live entries instead of choosing one", () => {
    const input = fixture();
    const catalog = input.catalog as JsonObject;
    const capabilities = catalog["capabilities"] as JsonObject[];
    capabilities.push(structuredClone(capabilities[0]!));
    expectCode(
      () => projectLiveGdpsOperationLock(input),
      `LIVE_CATALOG_DUPLICATE_${capabilities[0]!["operationId"]}@1.0`,
    );
  });
});
