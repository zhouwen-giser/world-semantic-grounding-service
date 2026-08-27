import { describe, expect, it } from "vitest";

import { hashCanonicalJson } from "./canonical.js";
import { TrustedCapabilitySnapshotCoordinator } from "./coordinator.js";
import {
  buildTrustedCapabilitySnapshot,
  evaluateNewJobSnapshotReadiness,
  TrustedCapabilitySnapshotError,
  verifyPersistedTrustedCapabilitySnapshot
} from "./snapshot.js";
import type {
  SchemaValidatedSemanticProfile,
  Sha256Digest,
  SouthboundOperationLockEntry,
  TrustedCapabilitySnapshot,
  TrustedCapabilitySnapshotInput,
  TrustedCapabilitySnapshotInsertResult,
  TrustedCapabilitySnapshotStore
} from "./types.js";

function digest(character: string): Sha256Digest {
  return `sha256:${character.repeat(64)}`;
}

function fixture(): TrustedCapabilitySnapshotInput {
  const alphaProfile = {
    domain: "REFERENCE",
    relationSemantics: ["RESOLVE"],
    timeSemantics: "LATEST_AT_START"
  };
  const betaProfile = {
    domain: "SPATIAL",
    relationSemantics: ["NEARBY"],
    timeSemantics: "LATEST_AT_START"
  };
  const alphaLock: SouthboundOperationLockEntry = {
    operationId: "reference.resolve",
    operationVersion: "1.0",
    inputSchemaHash: digest("1"),
    outputSchemaHash: digest("2"),
    semanticProfileHash: hashCanonicalJson(alphaProfile),
    maturity: "STABLE",
    requiredPermissions: ["reference:read", "data:read"],
    snapshotSupport: "CONSISTENT_AT_START"
  };
  const betaLock: SouthboundOperationLockEntry = {
    operationId: "spatial.find-nearby",
    operationVersion: "1.0",
    inputSchemaHash: digest("3"),
    outputSchemaHash: digest("4"),
    semanticProfileHash: hashCanonicalJson(betaProfile),
    maturity: "PREVIEW",
    requiredPermissions: ["data:read"],
    snapshotSupport: "BEST_EFFORT"
  };
  const profiles: readonly SchemaValidatedSemanticProfile[] = [
    {
      operationId: betaLock.operationId,
      operationVersion: betaLock.operationVersion,
      semanticProfile: betaProfile,
      semanticProfileHash: betaLock.semanticProfileHash
    },
    {
      operationId: alphaLock.operationId,
      operationVersion: alphaLock.operationVersion,
      semanticProfile: alphaProfile,
      semanticProfileHash: alphaLock.semanticProfileHash
    }
  ];
  const contractRevision = digest("a");
  const bindingRevision = digest("b");
  const semanticCatalogHash = hashCanonicalJson(profiles);

  return {
    capturedAt: new Date("2026-08-27T09:01:00.000Z"),
    southboundLockHash: digest("c"),
    southboundLock: {
      schemaVersion: "2.0",
      gatewayContractVersion: "0.6.3",
      consumerContractPackage: {
        name: "@gowm/world-gateway-contracts",
        version: "0.6.3",
        integrity: "sha512-UVFPTQ=="
      },
      contractCatalogRevision: contractRevision,
      semanticCatalogHash,
      availabilityContractHash: digest("d"),
      snapshotContractHash: digest("e"),
      delegationContractHash: digest("f"),
      defaultOperations: [alphaLock],
      previewOperations: [betaLock]
    },
    catalog: {
      contractCatalogRevision: contractRevision,
      bindingRevision,
      capabilities: [
        {
          operationId: betaLock.operationId,
          operationVersion: betaLock.operationVersion,
          maturity: betaLock.maturity,
          inputSchemaHash: betaLock.inputSchemaHash,
          outputSchemaHash: betaLock.outputSchemaHash,
          semanticProfile: betaProfile
        },
        {
          operationId: alphaLock.operationId,
          operationVersion: alphaLock.operationVersion,
          maturity: alphaLock.maturity,
          inputSchemaHash: alphaLock.inputSchemaHash,
          outputSchemaHash: alphaLock.outputSchemaHash,
          semanticProfile: alphaProfile
        }
      ]
    },
    semantics: {
      schemaVersion: "1.1",
      contractCatalogRevision: contractRevision,
      bindingRevision,
      profiles,
      catalogHash: semanticCatalogHash
    },
    availability: {
      schemaVersion: "1.0",
      checkedAt: "2026-08-27T09:00:00.000Z",
      operations: [
        {
          operationId: betaLock.operationId,
          operationVersion: betaLock.operationVersion,
          availability: "DEGRADED",
          checkedAt: "2026-08-27T09:00:00.000Z",
          validUntil: "2026-08-27T09:05:00.000Z",
          reasonCodes: ["CAPACITY_LIMITED", "READY"],
          contractCatalogRevision: contractRevision,
          bindingRevision
        },
        {
          operationId: alphaLock.operationId,
          operationVersion: alphaLock.operationVersion,
          availability: "AVAILABLE",
          checkedAt: "2026-08-27T09:00:30.000Z",
          validUntil: "2026-08-27T09:05:30.000Z",
          reasonCodes: ["READY"],
          contractCatalogRevision: contractRevision,
          bindingRevision
        }
      ]
    }
  };
}

function expectSnapshotError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(TrustedCapabilitySnapshotError);
    expect(error).toMatchObject({ code });
  }
}

class MemorySnapshotStore implements TrustedCapabilitySnapshotStore {
  readonly snapshots = new Map<string, TrustedCapabilitySnapshot>();

  async load(jobId: string): Promise<TrustedCapabilitySnapshot | null> {
    return this.snapshots.get(jobId) ?? null;
  }

  async insertIfAbsent(
    jobId: string,
    snapshot: TrustedCapabilitySnapshot
  ): Promise<TrustedCapabilitySnapshotInsertResult> {
    const existing = this.snapshots.get(jobId);
    if (existing !== undefined) return { inserted: false, snapshot: existing };
    this.snapshots.set(jobId, snapshot);
    return { inserted: true, snapshot };
  }
}

describe("trusted capability snapshot", () => {
  it("builds the v0.2 schema shape with deterministic operation ordering and hash", () => {
    const input = fixture();
    const first = buildTrustedCapabilitySnapshot(input);
    const second = buildTrustedCapabilitySnapshot(input);
    const { snapshotHash, ...body } = first;

    expect(first).toEqual(second);
    expect(snapshotHash).toBe(hashCanonicalJson(body));
    expect(first.capabilities.map((entry) => entry.operationId)).toEqual([
      "reference.resolve",
      "spatial.find-nearby"
    ]);
    expect(first.availability.map((entry) => entry.operationId)).toEqual([
      "reference.resolve",
      "spatial.find-nearby"
    ]);
    expect(first.capabilities[0]?.requiredPermissions).toEqual(["data:read", "reference:read"]);
    expect(Object.keys(first).sort()).toEqual([
      "availability",
      "bindingRevision",
      "capabilities",
      "capturedAt",
      "consumerPackageIntegrity",
      "contractCatalogRevision",
      "gatewayContractVersion",
      "semanticCatalogHash",
      "snapshotHash",
      "southboundLockHash"
    ]);
    expect(first).not.toHaveProperty("semanticProfiles");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.capabilities)).toBe(true);
  });

  it("fails readiness closed when a new job observes catalog drift", () => {
    const input = fixture();
    const drifted: TrustedCapabilitySnapshotInput = {
      ...input,
      catalog: { ...input.catalog, contractCatalogRevision: digest("9") }
    };
    expect(evaluateNewJobSnapshotReadiness(drifted)).toEqual({
      status: "FAIL_CLOSED",
      code: "CONTRACT_CATALOG_DRIFT"
    });
    expectSnapshotError(() => buildTrustedCapabilitySnapshot(drifted), "CONTRACT_CATALOG_DRIFT");
  });

  it("fails readiness closed when a new job observes semantic catalog drift", () => {
    const input = fixture();
    const drifted: TrustedCapabilitySnapshotInput = {
      ...input,
      semantics: { ...input.semantics, catalogHash: digest("9") }
    };
    expect(evaluateNewJobSnapshotReadiness(drifted)).toEqual({
      status: "FAIL_CLOSED",
      code: "SEMANTIC_CATALOG_DRIFT"
    });
    expectSnapshotError(() => buildTrustedCapabilitySnapshot(drifted), "SEMANTIC_CATALOG_DRIFT");
  });

  it("detects semantic content whose advertised hash was not produced by the content", () => {
    const input = fixture();
    const changedProfiles = input.semantics.profiles.map((profile, index) => index === 0
      ? { ...profile, semanticProfile: { ...profile.semanticProfile, domain: "CHANGED" } }
      : profile);
    const inconsistent: TrustedCapabilitySnapshotInput = {
      ...input,
      semantics: { ...input.semantics, profiles: changedProfiles }
    };
    expect(evaluateNewJobSnapshotReadiness(inconsistent)).toEqual({
      status: "FAIL_CLOSED",
      code: "SEMANTIC_CATALOG_CONTENT_MISMATCH"
    });
  });

  it("classifies binding drift as an Availability refresh and accepts it after refresh", () => {
    const input = fixture();
    const newBinding = digest("8");
    const staleAvailability: TrustedCapabilitySnapshotInput = {
      ...input,
      catalog: { ...input.catalog, bindingRevision: newBinding },
      semantics: { ...input.semantics, bindingRevision: newBinding }
    };
    expect(evaluateNewJobSnapshotReadiness(staleAvailability)).toMatchObject({
      status: "REFRESH_AVAILABILITY",
      code: "AVAILABILITY_REFRESH_REQUIRED"
    });
    expectSnapshotError(
      () => buildTrustedCapabilitySnapshot(staleAvailability),
      "AVAILABILITY_REFRESH_REQUIRED"
    );

    const refreshed: TrustedCapabilitySnapshotInput = {
      ...staleAvailability,
      availability: {
        ...input.availability,
        operations: input.availability.operations.map((entry) => ({ ...entry, bindingRevision: newBinding }))
      }
    };
    expect(evaluateNewJobSnapshotReadiness(refreshed)).toEqual({ status: "READY" });
    expect(buildTrustedCapabilitySnapshot(refreshed).bindingRevision).toBe(newBinding);
  });

  it("rejects expired Availability observations for new jobs", () => {
    const input = fixture();
    const expired: TrustedCapabilitySnapshotInput = {
      ...input,
      availability: {
        ...input.availability,
        operations: input.availability.operations.map((entry) => ({
          ...entry,
          validUntil: "2026-08-27T09:01:00.000Z"
        }))
      }
    };
    expect(evaluateNewJobSnapshotReadiness(expired)).toMatchObject({
      status: "REFRESH_AVAILABILITY",
      code: "AVAILABILITY_EXPIRED"
    });
    expectSnapshotError(() => buildTrustedCapabilitySnapshot(expired), "AVAILABILITY_EXPIRED");
  });

  it("rejects locked schema and embedded semantic-profile mismatches", () => {
    const input = fixture();
    const schemaMismatch: TrustedCapabilitySnapshotInput = {
      ...input,
      catalog: {
        ...input.catalog,
        capabilities: input.catalog.capabilities.map((entry, index) => index === 0
          ? { ...entry, outputSchemaHash: digest("9") }
          : entry)
      }
    };
    expectSnapshotError(() => buildTrustedCapabilitySnapshot(schemaMismatch), "CAPABILITY_LOCK_MISMATCH");

    const profileMismatch: TrustedCapabilitySnapshotInput = {
      ...input,
      catalog: {
        ...input.catalog,
        capabilities: input.catalog.capabilities.map((entry, index) => index === 0
          ? { ...entry, semanticProfile: { ...entry.semanticProfile, domain: "INJECTED" } }
          : entry)
      }
    };
    expectSnapshotError(() => buildTrustedCapabilitySnapshot(profileMismatch), "SEMANTIC_PROFILE_LOCK_MISMATCH");
  });

  it("persists a snapshot with the job and recovery only loads that stored snapshot", async () => {
    const store = new MemorySnapshotStore();
    const coordinator = new TrustedCapabilitySnapshotCoordinator(store);
    const captured = await coordinator.captureForNewJob("job-001", fixture());

    const recovered = await coordinator.loadForRestart("job-001");
    expect(recovered).toEqual(captured);
    expect(recovered.snapshotHash).toBe(store.snapshots.get("job-001")?.snapshotHash);
    expect(recovered.bindingRevision).toBe(digest("b"));
  });

  it("does not re-check expired live Availability while verifying an old job snapshot", async () => {
    const store = new MemorySnapshotStore();
    const coordinator = new TrustedCapabilitySnapshotCoordinator(store);
    const captured = await coordinator.captureForNewJob("job-old", fixture());

    expect(() => verifyPersistedTrustedCapabilitySnapshot(captured)).not.toThrow();
    await expect(coordinator.loadForRestart("job-old")).resolves.toEqual(captured);
  });

  it("fails recovery when the stored snapshot is missing, conflicting, or corrupted", async () => {
    const store = new MemorySnapshotStore();
    const coordinator = new TrustedCapabilitySnapshotCoordinator(store);
    await expect(coordinator.loadForRestart("job-missing")).rejects.toMatchObject({
      code: "JOB_SNAPSHOT_MISSING"
    });

    const earlier = buildTrustedCapabilitySnapshot({
      ...fixture(),
      capturedAt: new Date("2026-08-27T09:00:45.000Z")
    });
    store.snapshots.set("job-conflict", earlier);
    await expect(coordinator.captureForNewJob("job-conflict", fixture())).rejects.toMatchObject({
      code: "JOB_SNAPSHOT_CONFLICT"
    });

    const valid = buildTrustedCapabilitySnapshot(fixture());
    store.snapshots.set("job-corrupt", { ...valid, bindingRevision: digest("7") });
    await expect(coordinator.loadForRestart("job-corrupt")).rejects.toMatchObject({
      code: "SNAPSHOT_INTEGRITY_MISMATCH"
    });
  });
});
