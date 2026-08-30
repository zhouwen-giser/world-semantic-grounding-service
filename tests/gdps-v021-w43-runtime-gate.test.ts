import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  GDPS_V021_W43_RUNTIME_SCENARIO_IDS,
  runGdpsV021W43RuntimeGate,
} from "../validation/scripts/gdps-v021-w43-runtime-gate.js";

const digest = (value: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("GDPS v0.2.1 W43 executable runtime gate", () => {
  it("owns the exact six-scenario inventory and emits no W43 or W44 manifest without the barrier sidecar", async () => {
    expect(GDPS_V021_W43_RUNTIME_SCENARIO_IDS).toEqual([
      "CURRENT_STRICT", "CHANGED_STRICT", "NOT_AVAILABLE_STRICT",
      "CHANGED_BEST_EFFORT", "SOURCE_CHANGED_ONCE", "SOURCE_CHANGED_TWICE",
    ]);
    const root = mkdtempSync(resolve(tmpdir(), "wsgs-w43-gate-"));
    const manifestPath = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/runtime-manifest.json";
    try {
      await expect(runGdpsV021W43RuntimeGate({
        repositoryRoot: root,
        binding: {
          candidateSha: "a".repeat(40), gateRunId: "wsgs-gdps-v021-focused-0001",
          runtimeIdentityHash: digest("runtime"), gowmGatewayIdentityHash: digest("gateway"),
          wsgsRuntimeIdentityHash: digest("wsgs"), databaseIdentityHash: digest("database"),
          handoffBundleHash: digest("handoff"), operationLockHash: digest("operations"),
          providerRecipeLockHash: digest("recipes"), providerId: "gdps.geospatial-products",
          providerVersion: "0.2.1", capabilityCount: 30,
          requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY", gatewayOnly: true,
          directProviderCalls: 0, mockTransportUsed: false, databaseClass: "REAL_ISOLATED_POSTGRESQL",
          sharedRuntimeMutated: false,
        },
        authority: {
          dataScope: "scope-gdps-v021-baseline", actorId: "actor", principalId: "principal",
          datasetScopes: ["dataset"], authorizationContextHash: digest("auth"),
          operationLockHash: digest("operations"),
        },
        pool: { connect: async () => { throw new Error("DATABASE_MUST_NOT_BE_TOUCHED"); } },
        generatedAt: "2026-08-30T00:00:00.000Z",
        currentnessReceiptPath: "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/currentness.json",
        postgresReceiptPath: "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/postgres.json",
        barrierAttestationPath: "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/barrier-attestation.json",
        replayBarrierArmAttestationPath:
          "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/source-changed-twice-arm.json",
        manifestPath,
        executeNaturalLanguageCase: async () => { throw new Error("NL_MUST_NOT_RUN"); },
        advanceBarrier: async () => { throw new Error("W43_SIDECAR_UNAVAILABLE_NOT_RUN"); },
        armReplayBarrier: async () => { throw new Error("ARM_MUST_NOT_RUN"); },
        readBarrierAttestation: async () => { throw new Error("READ_MUST_NOT_RUN"); },
        openPersistedRequest: async () => { throw new Error("OPEN_MUST_NOT_RUN"); },
      })).rejects.toThrow("W43_SIDECAR_UNAVAILABLE_NOT_RUN");
      expect(existsSync(resolve(root, manifestPath))).toBe(false);
      expect(existsSync(resolve(root,
        "reports/wsgs-v0.2-gdps-v0.2.1/drivers/driver-manifest.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
