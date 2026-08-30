import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GDPS_V021_DRIVER_BINDINGS,
  GdpsV021RuntimePreflightError,
  runGdpsV021AuthorityPreflightBeforeMutation,
  runGdpsV021PreflightBeforeMutation,
  verifyGdpsV021RuntimePreflight,
  type GdpsV021RuntimePreflightPaths,
} from "../validation/scripts/gdps-v021-runtime-preflight.js";
import {
  GDPS_V021_HANDOFF_FILES,
  WSGS_GROUNDING_CORE_OPERATION_KEYS,
  canonicalHash,
  sha256,
  stableJsonBytes,
  type JsonObject,
} from "../validation/scripts/live-gdps-operation-lock-projector.js";

const createdRoots: string[] = [];
const sourceCommit = "a".repeat(40);
const gdpsCommit = "b".repeat(40);
const gowmCommit = "c".repeat(40);

interface Fixture {
  readonly root: string;
  readonly paths: GdpsV021RuntimePreflightPaths;
  readonly operationLockPath: string;
  readonly provenancePath: string;
  readonly handoffDirectory: string;
  readonly driverManifestPath: string;
}

function writeBytes(path: string, bytes: Uint8Array | string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

function writeJson(path: string, value: unknown): void {
  writeBytes(path, stableJsonBytes(value));
}

function readJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function operation(
  key: string,
  maturity: "STABLE" | "PREVIEW",
): JsonObject {
  const [operationId, operationVersion] = key.split("@");
  return {
    operationId,
    operationVersion,
    inputSchemaHash: sha256(`${key}:input`),
    outputSchemaHash: sha256(`${key}:output`),
    semanticProfileHash: sha256(`${key}:semantic`),
    maturity,
    requiredPermissions: ["data:read"],
    snapshotSupport: "CONSISTENT_AT_START",
  };
}

function buildFixture(): Fixture {
  const root = mkdtempSync(resolve(tmpdir(), "wsgs-gdps-preflight-"));
  createdRoots.push(root);
  const handoffDirectory = resolve(
    root,
    "contracts",
    "upstream",
    "gdps-v0.2.1",
  );
  const generatedDirectory = resolve(
    root,
    "contracts",
    "generated",
    "gdps-v0.2.1",
  );
  const operationLockPath = resolve(
    generatedDirectory,
    "wsgs-southbound-operation-lock-v2.json",
  );
  const provenancePath = resolve(
    generatedDirectory,
    "wsgs-southbound-operation-lock-v2.provenance.json",
  );
  const driverManifestPath = resolve(
    root,
    "reports",
    "wsgs-v0.2-gdps-v0.2.1",
    "driver-manifest.json",
  );

  const contractCatalogRevision = sha256("contract-catalog");
  const semanticCatalogHash = sha256("semantic-catalog");
  const bindingRevision = sha256("binding-revision");
  const registryRevision = sha256("registry-revision");
  const providerManifestHash = sha256("provider-manifest");
  const gateway = {
    contractCatalogRevision,
    semanticCatalogHash,
    bindingRevision,
    instanceFingerprint: sha256("gateway-instance"),
  };
  const provider = {
    providerId: "gdps.geospatial-products",
    providerVersion: "0.2.1",
    providerManifestHash,
  };
  const previewKeys = Array.from(
    { length: 30 },
    (_, index) => `gdps.operation-${String(index).padStart(2, "0")}@1.0`,
  );
  const defaultOperations = WSGS_GROUNDING_CORE_OPERATION_KEYS.map((key) =>
    operation(key, "STABLE"),
  );
  const previewOperations = previewKeys.map((key) => operation(key, "PREVIEW"));
  const capabilityOperations = previewOperations.map((entry) => ({
    operationId: entry["operationId"],
    operationVersion: entry["operationVersion"],
    inputSchemaHash: entry["inputSchemaHash"],
    outputSchemaHash: entry["outputSchemaHash"],
    semanticProfileHash: entry["semanticProfileHash"],
    maturity: "PREVIEW",
    availability: "AVAILABLE",
  }));
  const capabilityLock = {
    schemaVersion: "gdps-v021-capability-lock/1.0",
    providerId: "gdps.geospatial-products",
    providerManifestHash,
    operations: capabilityOperations,
  };
  const consumerLock = {
    schemaVersion: "wsgs-gdps-consumer-lock/1.0",
    sources: {
      wsgsSha: sourceCommit,
      gdpsSha: gdpsCommit,
      gowmSha: gowmCommit,
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
  const handoffDocuments: Record<string, unknown> = Object.fromEntries(
    GDPS_V021_HANDOFF_FILES.map((name) => [
      name,
      { schemaVersion: "fixture/1.0", name },
    ]),
  );
  handoffDocuments["GDPS_CAPABILITY_LOCK.json"] = capabilityLock;
  handoffDocuments["GDPS_CONSUMER_LOCK.json"] = consumerLock;
  handoffDocuments["GOWM_GATEWAY_BINDING_LOCK.json"] = gatewayBindingLock;
  const handoffBytes = Object.fromEntries(
    Object.entries(handoffDocuments).map(([name, value]) => [
      name,
      stableJsonBytes(value),
    ]),
  );
  for (const [name, bytes] of Object.entries(handoffBytes)) {
    writeBytes(resolve(handoffDirectory, name), bytes);
  }
  const handoffFileHashes = Object.fromEntries(
    Object.entries(handoffBytes).map(([name, bytes]) => [name, sha256(bytes)]),
  );
  const checksums = {
    schemaVersion: "wsgs-gdps-v021-checksums/1.0",
    algorithm: "SHA-256",
    files: Object.entries(handoffFileHashes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, hash]) => ({ path, sha256: hash })),
    bundleHash: canonicalHash(handoffFileHashes),
  };
  const checksumsBytes = stableJsonBytes(checksums);
  writeBytes(resolve(handoffDirectory, "CHECKSUMS.json"), checksumsBytes);

  const operationLock = {
    schemaVersion: "2.0",
    gatewayContractVersion: "0.6.3",
    consumerContractPackage: {
      name: "@gowm/world-gateway-contracts",
      version: "0.6.3",
      integrity: "sha512-dGVzdA==",
    },
    contractCatalogRevision,
    semanticCatalogHash,
    availabilityContractHash: sha256("availability-contract"),
    snapshotContractHash: sha256("snapshot-contract"),
    delegationContractHash: sha256("delegation-contract"),
    defaultOperations,
    previewOperations,
  };
  const operationLockBytes = stableJsonBytes(operationLock);
  writeBytes(operationLockPath, operationLockBytes);
  const provenance = {
    schemaVersion: "wsgs-gdps-live-operation-lock-provenance/1.0",
    sourceCommit,
    provider,
    handoff: {
      checksumFileHash: sha256(checksumsBytes),
      bundleHash: checksums.bundleHash,
      capabilityFileHash: handoffFileHashes["GDPS_CAPABILITY_LOCK.json"],
      capabilityCanonicalHash: canonicalHash(capabilityLock),
      consumerFileHash: handoffFileHashes["GDPS_CONSUMER_LOCK.json"],
      gatewayBindingFileHash:
        handoffFileHashes["GOWM_GATEWAY_BINDING_LOCK.json"],
      contractBasisCanonicalHash: sha256("contract-basis"),
    },
    gateway: {
      registryRevision,
      contractCatalogRevision,
      semanticCatalogHash,
      bindingRevision,
    },
    liveEvidence: {
      selectedOperationCount: 42,
      availableOperationCount: 42,
      catalogProjectionHash: sha256("catalog-projection"),
      semanticCatalogHash,
      availabilityProjectionHash: sha256("availability-projection"),
    },
    operationLockHash: sha256(operationLockBytes),
  };
  const provenanceBytes = stableJsonBytes(provenance);
  writeBytes(provenancePath, provenanceBytes);

  const runtimeIdentityHash = sha256("isolated-runtime-identity");
  const sharedRuntimeHash = sha256("shared-runtime-unchanged");
  const driverEntries: JsonObject[] = [];
  for (const [index, binding] of GDPS_V021_DRIVER_BINDINGS.entries()) {
    const implementationPath = `validation/drivers/${binding.caseId.toLowerCase()}.ts`;
    const evidencePath =
      `reports/wsgs-v0.2-gdps-v0.2.1/driver-evidence/${binding.caseId}/evidence.json`;
    const attestationPath =
      `reports/wsgs-v0.2-gdps-v0.2.1/driver-evidence/${binding.caseId}/attestation.json`;
    const implementationBytes = Buffer.from(
      `export const driver${index} = ${JSON.stringify(binding.caseId)};\n`,
      "utf8",
    );
    const evidenceBytes = stableJsonBytes({
      schemaVersion: "wsgs-gdps-driver-evidence/1.0",
      caseId: binding.caseId,
      observationHash: sha256(`observation-${binding.caseId}`),
    });
    writeBytes(resolve(root, ...implementationPath.split("/")), implementationBytes);
    writeBytes(resolve(root, ...evidencePath.split("/")), evidenceBytes);
    const implementationHash = sha256(implementationBytes);
    const evidenceHash = sha256(evidenceBytes);
    const precondition = {
      caseId: binding.caseId,
      driverKind: binding.driverKind,
      observationHash: sha256(`precondition-${binding.caseId}`),
    };
    const attestation = {
      schemaVersion: "wsgs-gdps-e2e-driver-attestation/2.0",
      caseId: binding.caseId,
      driverKind: binding.driverKind,
      sourceCommit,
      handoffBundleHash: checksums.bundleHash,
      operationLockHash: sha256(operationLockBytes),
      provenanceHash: sha256(provenanceBytes),
      runtimeIdentityHash,
      sharedRuntimeBeforeHash: sharedRuntimeHash,
      sharedRuntimeAfterHash: sharedRuntimeHash,
      executionEnvironment: "ISOLATED_REAL_RUNTIME",
      requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY",
      realExternalDependencies: true,
      mockTransportUsed: false,
      sharedRuntimeMutated: false,
      precondition,
      preconditionHash: canonicalHash(precondition),
      driverImplementationHash: implementationHash,
      evidenceHash,
    };
    const attestationBytes = stableJsonBytes(attestation);
    writeBytes(resolve(root, ...attestationPath.split("/")), attestationBytes);
    driverEntries.push({
      caseId: binding.caseId,
      driverKind: binding.driverKind,
      attestationPath,
      attestationHash: sha256(attestationBytes),
      implementationPath,
      implementationHash,
      evidencePath,
      evidenceHash,
    });
  }
  writeJson(driverManifestPath, {
    schemaVersion: "wsgs-gdps-e2e-driver-manifest/1.0",
    sourceCommit,
    handoffBundleHash: checksums.bundleHash,
    operationLockHash: sha256(operationLockBytes),
    provenanceHash: sha256(provenanceBytes),
    runtimeIdentityHash,
    drivers: driverEntries,
  });
  return {
    root,
    paths: {
      repositoryRoot: root,
      operationLockPath,
      handoffDirectory,
      driverManifestPath,
      expectedSourceCommit: sourceCommit,
    },
    operationLockPath,
    provenancePath,
    handoffDirectory,
    driverManifestPath,
  };
}

function expectBeforeMutationFailure(
  paths: GdpsV021RuntimePreflightPaths,
  code: string,
): void {
  let mutationCalls = 0;
  try {
    runGdpsV021PreflightBeforeMutation(paths, () => {
      mutationCalls += 1;
    });
    throw new Error("expected preflight failure");
  } catch (error) {
    expect(error).toBeInstanceOf(GdpsV021RuntimePreflightError);
    expect((error as GdpsV021RuntimePreflightError).code).toBe(code);
  }
  expect(mutationCalls).toBe(0);
}

afterEach(() => {
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("GDPS v0.2.1 runtime preflight", () => {
  it("verifies immutable authority before mutation without requiring post-run driver evidence", () => {
    const fixture = buildFixture();
    unlinkSync(fixture.driverManifestPath);
    let mutationCalls = 0;
    const verified = runGdpsV021AuthorityPreflightBeforeMutation(
      {
        repositoryRoot: fixture.paths.repositoryRoot,
        operationLockPath: fixture.paths.operationLockPath,
        handoffDirectory: fixture.paths.handoffDirectory,
        expectedSourceCommit: fixture.paths.expectedSourceCommit,
      },
      (record) => {
        mutationCalls += 1;
        return record;
      },
    );
    expect(mutationCalls).toBe(1);
    expect(verified.sourceCommit).toBe(sourceCommit);
    expect(Object.keys(verified)).not.toContain("driverManifest");
  });

  it("returns typed lock, handoff, provider, source, and four-driver records before invoking mutation", () => {
    const fixture = buildFixture();
    let mutationCalls = 0;
    const verified = runGdpsV021PreflightBeforeMutation(
      fixture.paths,
      (record) => {
        mutationCalls += 1;
        return record;
      },
    );
    expect(mutationCalls).toBe(1);
    expect(verified).toMatchObject({
      schemaVersion: "wsgs-gdps-v021-runtime-preflight/1.0",
      sourceCommit,
      gdpsCommit,
      gowmCommit,
      provider: {
        providerId: "gdps.geospatial-products",
        providerVersion: "0.2.1",
        capabilityCount: 30,
      },
    });
    expect(verified.operationLock.stableOperationKeys).toEqual(
      WSGS_GROUNDING_CORE_OPERATION_KEYS,
    );
    expect(verified.operationLock.previewOperationKeys).toHaveLength(30);
    expect(verified.driverManifest.drivers.map((entry) => entry.caseId)).toEqual(
      GDPS_V021_DRIVER_BINDINGS.map((entry) => entry.caseId),
    );
    expect(verified.driverManifest.drivers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attestation: expect.objectContaining({
            schemaVersion: "wsgs-gdps-e2e-driver-attestation/2.0",
            sourceCommit,
            sharedRuntimeMutated: false,
          }),
          attestationByteLength: expect.any(Number),
          implementationByteLength: expect.any(Number),
          evidenceByteLength: expect.any(Number),
        }),
      ]),
    );
    expect(verified.driverManifest.drivers.every((entry) =>
      entry.attestationByteLength > 0 &&
      entry.implementationByteLength > 0 &&
      entry.evidenceByteLength > 0 &&
      entry.attestation.preconditionHash === entry.preconditionHash &&
      entry.attestation.driverImplementationHash === entry.implementationHash &&
      entry.attestation.evidenceHash === entry.evidenceHash,
    )).toBe(true);
  });

  it("rejects an arbitrary digest instead of trusting manifest text", () => {
    const fixture = buildFixture();
    const manifest = readJson(fixture.driverManifestPath);
    const drivers = manifest["drivers"] as JsonObject[];
    drivers[0]!["evidenceHash"] = sha256("arbitrary-digest");
    writeJson(fixture.driverManifestPath, manifest);
    expectBeforeMutationFailure(
      fixture.paths,
      "DRIVER_NEG-DATA-GAP_EVIDENCE_HASH_DRIFT",
    );
  });

  it("rejects missing adjacent provenance before mutation", () => {
    const fixture = buildFixture();
    unlinkSync(fixture.provenancePath);
    expectBeforeMutationFailure(
      fixture.paths,
      "OPERATION_LOCK_PROVENANCE_MISSING",
    );
  });

  it("rejects operation-lock and handoff byte drift before mutation", () => {
    const lockDrift = buildFixture();
    writeJson(lockDrift.operationLockPath, { drift: true });
    expectBeforeMutationFailure(
      lockDrift.paths,
      "OPERATION_LOCK_PROVENANCE_HASH_DRIFT",
    );

    const handoffDrift = buildFixture();
    writeJson(resolve(handoffDrift.handoffDirectory, "WSGS_QUERY_CORPUS.json"), {
      drift: true,
    });
    expectBeforeMutationFailure(
      handoffDrift.paths,
      "HANDOFF_FILE_HASH_DRIFT_WSGS_QUERY_CORPUS.json",
    );
  });

  it("rejects path escape and legacy report artifacts before mutation", () => {
    const escaped = buildFixture();
    const escapedManifest = readJson(escaped.driverManifestPath);
    (escapedManifest["drivers"] as JsonObject[])[0]!["evidencePath"] =
      "../outside.json";
    writeJson(escaped.driverManifestPath, escapedManifest);
    expectBeforeMutationFailure(
      escaped.paths,
      "DRIVER_NEG-DATA-GAP_EVIDENCE_PATH_NOT_REPOSITORY_RELATIVE",
    );

    const legacy = buildFixture();
    const legacyManifest = readJson(legacy.driverManifestPath);
    (legacyManifest["drivers"] as JsonObject[])[0]!["evidencePath"] =
      "reports/wsgs-v0.2-gdps/evidence.json";
    writeJson(legacy.driverManifestPath, legacyManifest);
    expectBeforeMutationFailure(
      legacy.paths,
      "DRIVER_NEG-DATA-GAP_EVIDENCE_PATH_IN_LEGACY_REPORT",
    );
  });

  it("rejects reused cases and source drift before mutation", () => {
    const reused = buildFixture();
    const reusedManifest = readJson(reused.driverManifestPath);
    const reusedDrivers = reusedManifest["drivers"] as JsonObject[];
    reusedDrivers[1]!["caseId"] = reusedDrivers[0]!["caseId"];
    writeJson(reused.driverManifestPath, reusedManifest);
    expectBeforeMutationFailure(reused.paths, "DRIVER_MANIFEST_CASE_REUSED");

    const sourceDrift = buildFixture();
    const sourceManifest = readJson(sourceDrift.driverManifestPath);
    sourceManifest["sourceCommit"] = "d".repeat(40);
    writeJson(sourceDrift.driverManifestPath, sourceManifest);
    expectBeforeMutationFailure(
      sourceDrift.paths,
      "DRIVER_MANIFEST_SOURCE_DRIFT",
    );
  });

  it("rejects file-hash reuse across cases and canonical precondition drift", () => {
    const reusedHash = buildFixture();
    const manifest = readJson(reusedHash.driverManifestPath);
    const drivers = manifest["drivers"] as JsonObject[];
    const first = drivers[0]!;
    const second = drivers[1]!;
    const firstEvidencePath = resolve(
      reusedHash.root,
      ...String(first["evidencePath"]).split("/"),
    );
    const secondEvidencePath = resolve(
      reusedHash.root,
      ...String(second["evidencePath"]).split("/"),
    );
    const sharedEvidenceBytes = readFileSync(firstEvidencePath);
    writeBytes(secondEvidencePath, sharedEvidenceBytes);
    second["evidenceHash"] = first["evidenceHash"];
    const secondAttestationPath = resolve(
      reusedHash.root,
      ...String(second["attestationPath"]).split("/"),
    );
    const secondAttestation = readJson(secondAttestationPath);
    secondAttestation["evidenceHash"] = first["evidenceHash"];
    writeJson(secondAttestationPath, secondAttestation);
    second["attestationHash"] = sha256(readFileSync(secondAttestationPath));
    writeJson(reusedHash.driverManifestPath, manifest);
    expectBeforeMutationFailure(
      reusedHash.paths,
      "DRIVER_ARTIFACT_HASH_REUSED",
    );

    const preconditionDrift = buildFixture();
    const preconditionManifest = readJson(preconditionDrift.driverManifestPath);
    const target = (preconditionManifest["drivers"] as JsonObject[])[0]!;
    const attestationPath = resolve(
      preconditionDrift.root,
      ...String(target["attestationPath"]).split("/"),
    );
    const attestation = readJson(attestationPath);
    attestation["preconditionHash"] = sha256("not-the-precondition");
    writeJson(attestationPath, attestation);
    target["attestationHash"] = sha256(readFileSync(attestationPath));
    writeJson(preconditionDrift.driverManifestPath, preconditionManifest);
    expectBeforeMutationFailure(
      preconditionDrift.paths,
      "DRIVER_NEG-DATA-GAP_PRECONDITION_HASH_DRIFT",
    );
  });

  it("does not expose a success marker or mutate when verification is called directly", () => {
    const fixture = buildFixture();
    const verified = verifyGdpsV021RuntimePreflight(fixture.paths);
    expect(Object.keys(verified)).not.toContain("status");
    expect(Object.keys(verified)).not.toContain("marker");
  });
});
