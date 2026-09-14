import { afterEach, expect, it, vi } from "vitest";
import { createGroundingIdentity } from "@wsgs/delegated-identity";
import { PostgresProductionGroundingStore, WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION } from "@wsgs/grounding-pipeline";
import { createWorldAnalysisValidator, type GroundingCapabilities12 } from "@wsgs/contracts";
import { createProductionBackendFromEnvironment } from "./production.js";
import { worldAnalysisCapabilities } from "./world-analysis-capabilities.js";

function discovery() {
  const now = Date.now();
  return {
    capabilities: (["HISTORICAL_TRACE", "ROAD_ASSOCIATION", "TEMPORAL_EVENT", "CROSS", "METRIC_RANKING", "ACTION_TARGET_CANDIDATE"] as const)
      .map(capability => ({ capability, supported: true, available: true, reasonCodes: ["AVAILABLE" as const] })),
    checkedAt: new Date(now).toISOString(), validUntil: new Date(now + 5000).toISOString()
  };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it.each([true, false])("captures fresh capability availability after a 15-second readiness check (ready=%s)", async ready => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T00:00:00Z"));
  vi.stubEnv("DATABASE_URL", "postgresql://unused/unused");
  vi.stubEnv("WSGS_REQUEST_ENCRYPTION_KEY_BASE64", Buffer.alloc(32, 1).toString("base64"));
  vi.spyOn(PostgresProductionGroundingStore.prototype, "readiness").mockResolvedValue({ ready: true, reasons: [] });
  const resources = createProductionBackendFromEnvironment({ readinessProbe: {
    checkReadiness: async () => { await new Promise(resolve => setTimeout(resolve, 15000)); return { ready, reasons: ready ? [] : ["MODEL_UNAVAILABLE"] }; },
    discoverWorldAnalysis: async () => discovery(),
    captureAdmissionSnapshot: async () => { throw new Error("capability discovery must not admit a job"); }
  } });
  try {
    const identity = createGroundingIdentity({ servicePrincipalId: "consumer", actorId: "actor", dataScopes: ["scope"], datasetScopes: [], permissions: ["grounding.read"] });
    const pending = resources.backend.capabilities(identity, WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION);
    await vi.advanceTimersByTimeAsync(15000);
    const response = await pending as GroundingCapabilities12;
    expect(response.requiredCapabilitiesReady).toBe(ready);
    expect(response.worldAnalysis.capabilities.every(item => item.available)).toBe(true);
    expect(Date.parse(response.worldAnalysis.validUntil)).toBeGreaterThan(Date.now());
    expect(createWorldAnalysisValidator()("capabilities", response).valid).toBe(true);
  } finally { await resources.close(); }
});

it("reports an actually expired snapshot distinctly without extending its availability", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T00:00:00Z"));
  const snapshot = discovery();
  vi.setSystemTime(new Date("2026-09-09T00:00:06Z"));
  const result = worldAnalysisCapabilities(true, snapshot);
  expect(result.worldAnalysis.capabilities.every(item => !item.available && item.reasonCodes.includes("SNAPSHOT_EXPIRED"))).toBe(true);
  expect(createWorldAnalysisValidator()("capabilities", result).valid).toBe(true);
  expect(worldAnalysisCapabilities(true).worldAnalysis.capabilities.every(item => item.reasonCodes.includes("SNAPSHOT_UNAVAILABLE"))).toBe(true);
});
