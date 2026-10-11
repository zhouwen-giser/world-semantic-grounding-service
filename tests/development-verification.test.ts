import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { verifyDevelopmentRuntime } from "../validation/scripts/verify-development-runtime.mjs";
import { evaluateLiveBusinessCase } from "../validation/scripts/live-business-assertions.mjs";

describe("development deployment readiness probe", () => {
  const now = Date.parse("2026-10-11T00:00:00Z");
  function capabilities() {
    const value = JSON.parse(readFileSync(new URL("../contracts/wsgs-v0.2.4-world-analysis/examples/capabilities.json", import.meta.url), "utf8"));
    value.requiredCapabilitiesReady = true;
    value.worldAnalysis.checkedAt = new Date(now).toISOString();
    value.worldAnalysis.validUntil = new Date(now + 5_000).toISOString();
    value.worldAnalysis.capabilities = value.worldAnalysis.capabilities.map((entry: any) => ({ ...entry, supported: true, available: true, reasonCodes: ["AVAILABLE"] }));
    return value;
  }
  function probe(value = capabilities()) {
    const fetcher = vi.fn(async (_url: string, init: any) => new Response(JSON.stringify(init.headers["WSGS-Contract-Version"] ? value : { requiredCapabilitiesReady: true }), { status: 200 }));
    return { fetcher, run: () => verifyDevelopmentRuntime({ environment: { PORT: "8080", WSGS_ADVANCED_HISTORY_ENABLED: "YES" }, fetcher, now: () => now }) };
  }
  it("negotiates anonymous 1.2 capabilities and labels business acceptance NOT_RUN", async () => {
    const { run, fetcher } = probe();
    expect(await run()).toEqual({ serviceReady: true, advancedCapabilities: "READY", businessAcceptance: "NOT_RUN" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2]?.[1].headers).toEqual({ "WSGS-Contract-Version": "sacs-wsgs-grounding/1.2", "WSGS-Result-Profile": "wsgs-world-analysis-findings/1.0" });
  });
  it.each(["unavailable", "expired", "invalid"])("rejects HTTP 200 with %s advanced capability state", async mode => {
    const value = capabilities();
    if (mode === "unavailable") Object.assign(value.worldAnalysis.capabilities.find((entry: any) => entry.capability === "CROSS"), { available: false, reasonCodes: ["DEPENDENCY_UNAVAILABLE"] });
    if (mode === "expired") value.worldAnalysis.validUntil = new Date(now).toISOString();
    if (mode === "invalid") delete value.worldAnalysis;
    await expect(probe(value).run()).rejects.toThrow(/DEVELOPMENT_ANALYSIS_/u);
  });
});

describe("live business assertions", () => {
  const trace = { findingKind: "HISTORICAL_TRACE", status: "PARTIAL", subjectReferenceProductIds: ["subject"], coverage: { sampleCount: 3 } };
  const evidence = (sourceOperation: string, upstreamStatus = "COMPLETED") => ({ sourceOperation, upstreamStatus });
  it.each(["TRACE", "MAP", "STOP", "CROSS", "RANK"])("does not accept transport evidence without %s business findings", name => {
    const result = { status: "COMPLETED", evidenceItems: ["history.get-trajectory", "trajectory.map-match", "temporal-spatial.find-events", "spatiotemporal-metric.rank-locations"].map(id => evidence(id)), worldAnalysisFindings: { findings: [], gaps: [] } };
    expect(evaluateLiveBusinessCase(name, result).passed).toBe(false);
  });
  it("requires nonempty ranking candidates and preserves partial status", () => {
    const result = { status: "PARTIAL", evidenceItems: [evidence("spatiotemporal-metric.rank-locations")], worldAnalysisFindings: { findings: [trace, { findingKind: "METRIC_RANKING", status: "PARTIAL", candidateDomain: "PAST_OBSERVED_LOCATIONS", candidates: [] as object[] }], gaps: [] } };
    expect(evaluateLiveBusinessCase("RANK", result).passed).toBe(false);
    result.worldAnalysisFindings.findings[1]!.candidates!.push({ rank: 1 });
    expect(evaluateLiveBusinessCase("RANK", result)).toMatchObject({ passed: true, businessStatus: "PARTIAL" });
  });
  it("requires both CROSS operations, a road finding and an event", () => {
    const result = { status: "PARTIAL", evidenceItems: [evidence("temporal-spatial.find-events")], worldAnalysisFindings: { findings: [trace, { findingKind: "TEMPORAL_EVENT", status: "PARTIAL", events: [{ eventType: "CROSS" }] }], gaps: [] } };
    expect(evaluateLiveBusinessCase("CROSS", result).passed).toBe(false);
    result.evidenceItems.push(evidence("trajectory.map-match"));
    result.worldAnalysisFindings.findings.push({ findingKind: "ROAD_ASSOCIATION", status: "PARTIAL" } as any);
    expect(evaluateLiveBusinessCase("CROSS", result)).toMatchObject({ passed: true, businessStatus: "PARTIAL" });
  });
  it("never promotes successful NO_DATA propagation into positive GDPS acceptance", () => {
    const result = { status: "PARTIAL", evidenceItems: [{ ...evidence("landcover.get-class", "NO_DATA"), receiptIds: ["receipt"], unknowns: ["NO_DATA"] }] };
    const executions = [{ operation_id: "landcover.get-class", upstream_status: "NO_DATA", receipt_count: 1 }];
    expect(evaluateLiveBusinessCase("GDPS", result, executions).passed).toBe(false);
    expect(evaluateLiveBusinessCase("GDPS", result, executions, "NO_DATA_PROPAGATION")).toMatchObject({ passed: true, businessStatus: "NOT_PROVEN" });
  });
});
