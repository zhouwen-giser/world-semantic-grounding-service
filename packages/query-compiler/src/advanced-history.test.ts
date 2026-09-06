import { describe, expect, it } from "vitest";
import { TypedWorldQueryCompiler } from "./compiler.js";
import { advancedCompileFixture } from "./advanced-test-fixtures.js";
import type { CompileInput, QuerySemanticPattern } from "./types.js";
describe("advanced exact PREVIEW compilation", () => {
  it.each(["HISTORICAL_ROAD_ASSOCIATION", "HISTORICAL_TEMPORAL_EVENT", "HISTORICAL_METRIC_RANKING"] as QuerySemanticPattern[])("compiles %s as one exact 0.1 node without global PREVIEW", pattern => {
    const result = new TypedWorldQueryCompiler().compile(advancedCompileFixture(pattern));
    expect(result.status).toBe("COMPILED");
    if (result.status === "COMPILED") { expect(result.submission.plan.nodes).toHaveLength(1); expect(result.submission.plan.nodes[0]!.operation.operationVersion).toBe("0.1"); }
  });
  it("binds the full map-match result at /source/mapMatchResult and gates T3", () => {
    const input = advancedCompileFixture("HISTORICAL_CROSS_EVENT"); input.parameterValues = { selection: { kind: "LAST" } };
    const result = new TypedWorldQueryCompiler().compile(input);
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    const nodes = result.submission.plan.nodes;
    expect(nodes).toHaveLength(2);
    expect(nodes[1]!.inputs["mapMatchResult"]).toMatchObject({ kind: "NODE_OUTPUT", nodeId: nodes[0]!.nodeId, outputPort: "result", targetPath: "/source/mapMatchResult" });
    expect(nodes[1]!.inputs["mapMatchResult"]).not.toHaveProperty("path");
    expect(nodes[1]!.preconditions).toContainEqual({ kind: "NODE_STATUS", nodeId: nodes[0]!.nodeId, statuses: ["COMPLETED", "PARTIAL"] });
  });
  const mutations: Array<[string, (input: CompileInput) => void]> = [
    ["disabled", input => { input.advancedHistoryEnabled = false; }],
    ["client invented authorization", input => { input.analysisProviderAuthorizations = input.analysisProviderAuthorizations!.map(a => ({ ...a })); }],
    ["version", input => { input.operationLocks[0]!.operationVersion = "1.0"; }],
    ["input hash", input => { input.operationLocks[0]!.inputSchemaHash = `sha256:${"f".repeat(64)}`; }],
    ["output hash", input => { input.operationLocks[0]!.outputSchemaHash = `sha256:${"f".repeat(64)}`; }],
    ["semantic hash", input => { input.operationLocks[0]!.semanticProfileHash = `sha256:${"f".repeat(64)}`; }],
    ["not registered", input => { input.capabilities = []; }],
    ["unavailable", input => { input.availability[0]!.availability = "UNAVAILABLE"; }],
    ["degraded", input => { input.availability[0]!.availability = "DEGRADED"; }],
    ["stale", input => { input.availability[0]!.validUntil = "2020-01-01T00:00:00Z"; }],
    ["permissions", input => { input.grantedPermissions = []; }],
    ["snapshot", input => { input.operationLocks[0]!.snapshotSupport = "NONE"; }],
    ["budget", input => { input.budgets.maximumNodes = 0; }]
  ];
  it.each(mutations)("rejects %s", (_name, mutate) => {
    const input = advancedCompileFixture(); mutate(input);
    expect(new TypedWorldQueryCompiler().compile(input).status).toBe("CAPABILITY_GAP");
  });
  it("does not authorize unrelated PREVIEW", () => {
    const input = advancedCompileFixture("HISTORICAL_TRAJECTORY");
    expect(new TypedWorldQueryCompiler().compile(input).status).toBe("CAPABILITY_GAP");
  });
});
