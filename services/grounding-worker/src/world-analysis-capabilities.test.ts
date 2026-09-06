import { describe, expect, it } from "vitest";
import { analysisHash } from "@wsgs/gowm-contract-intake";
import { groundingCapabilitiesForSelection } from "../../grounding-api/src/production.js";
import { WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION } from "@wsgs/grounding-pipeline";
import { createWorldAnalysisValidator } from "@wsgs/contracts";
import { projectWorldAnalysisAvailability, type WorldAnalysisDiscoveryInput } from "./world-analysis-capabilities.js";

const now = new Date("2026-09-07T12:00:00.000Z");
const hash = analysisHash({});
function fixture(): WorldAnalysisDiscoveryInput {
  const ids = ["operational-task.find", "operational-task.get", "operational-task.get-execution-intervals", "history.get-trajectory",
    "trajectory.map-match", "temporal-spatial.find-events", "spatiotemporal-metric.rank-locations"];
  const keys = ids.map((operationId, index) => ({ operationId, operationVersion: index < 4 ? "1.0" : "0.1" }));
  return { now, historyEnabled: true, advancedEnabled: true, expectedCatalogRevision: hash, expectedSemanticHash: hash,
    locks: keys.map(key => ({ ...key, maturity: "PREVIEW", inputSchemaHash: hash, outputSchemaHash: hash, semanticProfileHash: hash })),
    catalog: { registryVersion: "1.0", contractCatalogRevision: hash, bindingRevision: hash,
      capabilities: keys.map(key => ({ ...key, maturity: "PREVIEW", inputSchemaHash: hash, outputSchemaHash: hash })) } as WorldAnalysisDiscoveryInput["catalog"],
    semantics: { schemaVersion: "1.1", contractCatalogRevision: hash, bindingRevision: hash, catalogHash: hash,
      profiles: keys.map(key => ({ ...key, semanticProfile: {}, semanticProfileHash: hash })) } as WorldAnalysisDiscoveryInput["semantics"],
    availability: { schemaVersion: "1.0", checkedAt: now.toISOString(), operations: keys.map(key => ({ ...key, maturity: "PREVIEW",
      availability: "AVAILABLE", reasonCodes: [], checkedAt: now.toISOString(), validUntil: new Date(now.getTime() + 2_000).toISOString(),
      contractCatalogRevision: hash, bindingRevision: hash })) }
  };
}
function status(input: WorldAnalysisDiscoveryInput, capability: string) {
  return projectWorldAnalysisAvailability(input).capabilities.find(value => value.capability === capability)!;
}

describe("caller-filtered public world analysis discovery", () => {
  it("keeps implemented support when both opt-in flags are disabled", () => {
    const input = fixture(); input.historyEnabled = false; input.advancedEnabled = false;
    expect(projectWorldAnalysisAvailability(input).capabilities.every(value => value.supported && !value.available && value.reasonCodes[0] === "FEATURE_DISABLED")).toBe(true);
  });
  it("advertises all six only with matching contracts, semantics, fresh grants and dependencies", () => {
    const result = projectWorldAnalysisAvailability(fixture());
    expect(result.capabilities.every(value => value.available && value.reasonCodes.join() === "AVAILABLE")).toBe(true);
    expect(result.validUntil).toBe("2026-09-07T12:00:02.000Z");
  });
  it.each([
    ["missing", "CAPABILITY_NOT_REGISTERED"], ["version", "CAPABILITY_NOT_REGISTERED"],
    ["schema", "CONTRACT_MISMATCH"], ["semantic", "SEMANTIC_MISMATCH"],
    ["permission", "PERMISSION_DENIED"], ["expired", "SNAPSHOT_EXPIRED"],
    ["future", "SNAPSHOT_EXPIRED"], ["degraded", "OPERATION_DEGRADED"],
    ["unavailable", "OPERATION_UNAVAILABLE"], ["binding", "CONTRACT_MISMATCH"]
  ])("isolates T2 %s and disables CROSS without affecting T3, T4 or history", (change, reason) => {
    const input = fixture();
    const index = 4;
    if (change === "missing") input.catalog!.capabilities.splice(index, 1);
    if (change === "version") input.catalog!.capabilities[index]!.operationVersion = "0.2";
    if (change === "schema") input.catalog!.capabilities[index]!.inputSchemaHash = analysisHash("drift");
    if (change === "semantic") input.semantics!.profiles[index]!.semanticProfile = { forged: true } as never;
    if (change === "permission") input.availability!.operations.splice(index, 1);
    if (change === "expired") input.availability!.operations[index]!.validUntil = now.toISOString();
    if (change === "future") input.availability!.operations[index]!.checkedAt = new Date(now.getTime() + 1).toISOString();
    if (change === "degraded") input.availability!.operations[index]!.availability = "DEGRADED";
    if (change === "unavailable") input.availability!.operations[index]!.availability = "UNAVAILABLE";
    if (change === "binding") input.availability!.operations[index]!.bindingRevision = analysisHash("drift");
    expect(status(input, "ROAD_ASSOCIATION")).toMatchObject({ available: false, reasonCodes: [reason] });
    expect(status(input, "CROSS")).toMatchObject({ available: false, reasonCodes: ["DEPENDENCY_UNAVAILABLE"] });
    for (const capability of ["HISTORICAL_TRACE", "TEMPORAL_EVENT", "METRIC_RANKING", "ACTION_TARGET_CANDIDATE"]) expect(status(input, capability).available).toBe(true);
  });
  it("requires T4 for action targets and trace for every advanced capability", () => {
    const input = fixture(); input.availability!.operations[6]!.availability = "UNAVAILABLE";
    expect(status(input, "ACTION_TARGET_CANDIDATE").available).toBe(false);
    expect(status(input, "CROSS").available).toBe(true);
    input.historyEnabled = false;
    expect(projectWorldAnalysisAvailability(input).capabilities.every(value => !value.available)).toBe(true);
  });
  it("requires T3 for CROSS but not road or metric findings", () => {
    const input = fixture(); input.availability!.operations[5]!.availability = "DISABLED";
    expect(status(input, "CROSS").available).toBe(false);
    expect(status(input, "ROAD_ASSOCIATION").available).toBe(true);
    expect(status(input, "ACTION_TARGET_CANDIDATE").available).toBe(true);
  });
  it("keeps trace available with the separate advanced flag disabled", () => {
    const input = fixture(); input.advancedEnabled = false;
    expect(status(input, "HISTORICAL_TRACE").available).toBe(true);
    expect(status(input, "ROAD_ASSOCIATION").reasonCodes).toEqual(["FEATURE_DISABLED"]);
  });
  it("does not allow duplicates, catalog drift or a semantic hash label to establish trust", () => {
    const input = fixture(); input.catalog!.capabilities.push(input.catalog!.capabilities[4]!);
    expect(status(input, "ROAD_ASSOCIATION").available).toBe(false);
    input.catalog!.contractCatalogRevision = analysisHash("different-root");
    expect(status(input, "HISTORICAL_TRACE").reasonCodes).toEqual(["CONTRACT_MISMATCH"]);
    input.catalog!.contractCatalogRevision = hash;
    input.semantics!.catalogHash = analysisHash("different-semantics");
    expect(status(input, "HISTORICAL_TRACE").reasonCodes).toEqual(["SEMANTIC_MISMATCH"]);
  });
  it("does not publish arbitrary upstream reason strings", () => {
    const input = fixture(); input.availability!.operations[4]!.availability = "UNAVAILABLE";
    input.availability!.operations[4]!.reasonCodes = ["internal-provider-diagnostic"];
    expect(status(input, "ROAD_ASSOCIATION").reasonCodes).toEqual(["OPERATION_UNAVAILABLE"]);
  });
  it("reports a bounded unavailable snapshot without leaking upstream text", () => {
    const input = fixture(); delete input.availability;
    expect(status(input, "HISTORICAL_TRACE").reasonCodes).toEqual(["SNAPSHOT_UNAVAILABLE"]);
    expect(status(input, "METRIC_RANKING").available).toBe(false);
  });
  it("produces the complete public schema, independent from model/database readiness", () => {
    const input = fixture(); input.now = new Date();
    for (const entry of input.availability!.operations) {
      entry.checkedAt = input.now.toISOString(); entry.validUntil = new Date(input.now.getTime() + 10_000).toISOString();
    }
    input.availability!.checkedAt = input.now.toISOString();
    const document = groundingCapabilitiesForSelection(WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION,
      { ready: false, reasons: ["MODEL_UNAVAILABLE"] }, projectWorldAnalysisAvailability(input));
    expect(createWorldAnalysisValidator()("capabilities", document).valid).toBe(true);
    expect(document["requiredCapabilitiesReady"]).toBe(false);
    expect((document["worldAnalysis"] as { capabilities: { available: boolean }[] }).capabilities.every(value => value.available)).toBe(true);
  });
});
