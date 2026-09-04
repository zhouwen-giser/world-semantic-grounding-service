import { describe, expect, it } from "vitest";
import { defaultGowmConsumerSchemaRegistry } from "@wsgs/gowm-contract-intake";
import type { WorldQueryPlanV2 } from "./types.js";
import { TypedWorldQueryCompiler, validateCompiledPlan } from "./index.js";
import { compileInput, historicalCompileInput } from "./test-fixtures.js";

describe("TypedWorldQueryCompiler v2", () => {
  const compiler = new TypedWorldQueryCompiler();

  it.each([
    ["REFERENCE_IDENTITY", ["reference.resolve", "reference.validate"]],
    ["REFERENCE_CURRENT_STATE", ["reference.resolve", "world.get-current-state"]],
    ["REFERENCE_GEOMETRY", ["reference.resolve", "world.get-geometry"]],
    ["REFERENCE_PROVENANCE", ["reference.resolve", "world.get-provenance"]],
    ["CATALOG_SEARCH", ["catalog.search"]],
    ["REFERENCE_NEARBY", ["reference.resolve", "world.get-current-state", "spatial.find-nearby"]],
    ["REFERENCE_IN_AREA", ["reference.resolve", "world.get-geometry", "spatial.find-in-area"]],
    ["REFERENCE_INTERSECTIONS", ["reference.resolve", "world.get-geometry", "spatial.find-intersections"]]
  ] as const)("compiles stable recipe %s to its frozen typed DAG", (pattern, expectedOperations) => {
    const result = compiler.compile(compileInput(pattern));
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(result.submission.plan.nodes.map((node) => node.operation.operationId)).toEqual(expectedOperations);
    expect(result.bindings.map((binding) =>
      `${binding.operationId}@${binding.operationVersion}`)).toEqual(
        expectedOperations.map((operationId) => `${operationId}@1.0`)
      );
    expect(result.submission.snapshotPolicy).toEqual({
      mode: "LATEST_AT_START",
      allowDowngrade: false
    });
    expect(JSON.stringify(result)).not.toContain("providerId");
  });

  it("requires explicit preview opt-in and then compiles the preview operation", () => {
    const rejected = compiler.compile(compileInput("H3_NEIGHBORHOOD"));
    expect(rejected).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "MATURITY_NOT_ALLOWED" }
    });

    const allowed = compileInput("H3_NEIGHBORHOOD");
    allowed.maturityPolicy.allowPreview = true;
    const result = compiler.compile(allowed);
    expect(result).toMatchObject({
      status: "COMPILED",
      policy: { approximateInput: true, exactVerificationRequired: false }
    });
  });

  it("compiles interval and trajectory DAGs with a fail-closed interval precondition", () => {
    const interval = compiler.compile(historicalCompileInput("HISTORICAL_EXECUTION_INTERVAL"));
    expect(interval).toMatchObject({
      status: "COMPILED",
      submission: { plan: { nodes: [{ operation: { operationId: "operational-task.get-execution-intervals" } }] } }
    });

    const trajectory = compiler.compile(historicalCompileInput("HISTORICAL_TRAJECTORY"));
    expect(trajectory.status).toBe("COMPILED");
    if (trajectory.status !== "COMPILED") return;
    expect(trajectory.submission.plan.nodes.map((node) => node.operation.operationId)).toEqual([
      "operational-task.get-execution-intervals", "history.get-trajectory"
    ]);
    expect(trajectory.submission.plan.nodes[1]).toMatchObject({
      failurePolicy: "SKIP_IF_PRECONDITION_FALSE",
      preconditions: [
        { kind: "NODE_STATUS", nodeId: "Node_1", statuses: ["COMPLETED", "PARTIAL"] },
        { kind: "VALUE_PRESENT", binding: { kind: "NODE_OUTPUT", nodeId: "Node_1", outputPort: "executionIntervalReferenceKey" } }
      ]
    });
    expect(trajectory.submission.plan.nodes[1]?.inputs).toMatchObject({
      executionIntervalReferenceKey: { kind: "NODE_OUTPUT", nodeId: "Node_1", targetPath: "/executionIntervalReferenceKey" },
      subjectReferenceKey: { kind: "LITERAL", targetPath: "/subjectReferenceKey" },
      sourceSelection: { kind: "LITERAL", value: { mode: "ONLY_CANDIDATE" } }
    });
    expect(() => validateCompiledPlan(trajectory.submission.plan, historicalCompileInput("HISTORICAL_TRAJECTORY").capabilities)).not.toThrow();
  });

  it("adds the locked exact verifier after a candidate-only H3 cover", () => {
    const input = compileInput("H3_EXACT_VERIFY");
    input.maturityPolicy.allowPreview = true;
    const result = compiler.compile(input);
    expect(result).toMatchObject({
      status: "COMPILED",
      policy: { approximateInput: true, exactVerificationRequired: true }
    });
    if (result.status !== "COMPILED") return;
    expect(result.submission.plan.nodes.map((node) => node.operation.operationId)).toEqual([
      "h3.geometry.cover",
      "spatial.find-intersections"
    ]);
    expect(result.bindings[1]?.selectionPolicy).toBe(
      "EXACT_VERIFIER:spatial.find-intersections@1.0"
    );
    expect(result.submission.plan.nodes[1]?.inputs["candidateReferences"]).toMatchObject({
      kind: "NODE_OUTPUT",
      nodeId: "Node_1",
      outputPort: "cells",
      targetPath: "/candidateReferences",
      port: { valueKind: "H3_CELL_SET", unitSemantics: "DISCRETE" }
    });
  });

  it("returns a typed gap for terrain/visibility and never substitutes nearby", () => {
    const result = compiler.compile(compileInput("TERRAIN_VISIBILITY"));
    expect(result).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: {
        reason: "UNSUPPORTED_EXPRESSION",
        blocking: true,
        details: { substituted: false }
      }
    });
    expect(JSON.stringify(result)).not.toContain("spatial.find-nearby");
  });

  it("allocates budgets by recipe weight and cost class while respecting aggregate caller limits", () => {
    const result = compiler.compile(compileInput("REFERENCE_NEARBY"));
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    const [resolve, geometry, nearby] = result.submission.plan.nodes;
    expect(resolve!.budget.maximumExecutionMs).toBeLessThan(geometry!.budget.maximumExecutionMs);
    expect(geometry!.budget.maximumExecutionMs).toBeLessThan(nearby!.budget.maximumExecutionMs);
    for (const name of [
      "maximumRows",
      "maximumCandidates",
      "maximumOutputBytes",
      "maximumExecutionMs"
    ] as const) {
      expect(result.submission.plan.nodes.reduce((sum, node) => sum + node.budget[name], 0))
        .toBeLessThanOrEqual(result.submission.plan.budgets[name]);
    }
  });

  it("preserves the 1 km metre parameter and validates every operation/port endpoint", () => {
    const input = compileInput("REFERENCE_NEARBY");
    input.operationInput = {
      schemaVersion: "1.0",
      mentions: [{ mentionId: "m1", surfaceText: "2号车" }],
      context: { anchorReferenceKeys: [] },
      limitPerMention: 5
    };
    input.parameterValues = { distanceM: 1_000 };
    const result = compiler.compile(input);
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(result.submission.parameters).toEqual({
      operationInput: {
        schemaVersion: "1.0",
        mentions: [{ mentionId: "m1", surfaceText: "2号车" }],
        context: { anchorReferenceKeys: [] },
        limitPerMention: 5
      },
      distanceM: 1_000
    });
    expect(result.submission.parameterSchemaHash).toBe(input.parameterSchemaHash);
    expect(result.submission.plan.nodes.at(-1)?.inputs["radiusM"]).toMatchObject({
      kind: "REQUEST_PATH",
      path: "/distanceM",
      targetPath: "/radiusM",
      port: {
        schemaUri: "urn:gowm:v0.2:value:number",
        schemaHash: "sha256:f0bbdee8d99cf6777316260a88948dcb4290389c3a80268ae3cbbc4835970348"
      }
    });
    expect(result.submission.plan.nodes.at(-1)?.inputs["location"]).toMatchObject({
      kind: "NODE_OUTPUT",
      nodeId: "Node_2",
      outputPort: "positionCoordinates",
      targetPath: "/location",
      port: { valueKind: "ANY", unitSemantics: "ANGULAR_DEGREES" }
    });
    expect(result.submission.plan.nodes[1]?.inputs["schemaVersion"]).toEqual({
      kind: "LITERAL",
      value: "1.0",
      targetPath: "/schemaVersion",
      port: {
        schemaUri: "urn:gowm:v0.2:value:string",
        schemaHash: "sha256:a71d355802de7ff21b9c9d9214a1ba71b3648866bcf1b7c0f4ff3b656485c6d5",
        valueKind: "ANY",
        unitSemantics: "UNSPECIFIED"
      }
    });
    expect(() => defaultGowmConsumerSchemaRegistry().validate(
      "platform/world-query-submission.schema.json",
      result.submission
    )).not.toThrow();
    expect(() => validateCompiledPlan(result.submission.plan, input.capabilities)).not.toThrow();
  });

  it("uses an explicit pinned manifest for prior-result revalidation", () => {
    const input = compileInput("PRIOR_RESULT_REVALIDATION");
    for (const operationId of ["reference.validate", "snapshot.validate"]) {
      input.operationLocks.find((lock) => lock.operationId === operationId)!.snapshotSupport = "PINNED";
    }
    input.snapshotPolicy = {
      mode: "PINNED",
      allowDowngrade: false,
      pinnedSnapshot: {
        manifestVersion: "1.0",
        queryId: "prior-query",
        snapshotId: "snapshot-1"
      }
    };
    const result = compiler.compile(input);
    expect(result).toMatchObject({
      status: "COMPILED",
      submission: { snapshotPolicy: { mode: "PINNED", allowDowngrade: false } }
    });
  });

  it("rejects an insufficient caller budget before producing a plan", () => {
    const input = compileInput("REFERENCE_NEARBY");
    input.budgets.maximumNodes = 2;
    expect(compiler.compile(input)).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "BUDGET_EXCEEDED" }
    });
  });

  it("produces a byte-stable canonical plan hash for equivalent inputs", () => {
    const firstInput = compileInput("REFERENCE_CURRENT_STATE");
    firstInput.operationInput = { beta: 2, alpha: { zeta: true, gamma: false } };
    const secondInput = compileInput("REFERENCE_CURRENT_STATE");
    secondInput.operationInput = { alpha: { gamma: false, zeta: true }, beta: 2 };
    const first = compiler.compile(firstInput);
    const second = compiler.compile(secondInput);
    expect(first.status).toBe("COMPILED");
    expect(second.status).toBe("COMPILED");
    if (first.status !== "COMPILED" || second.status !== "COMPILED") return;
    expect(first.planHash).toBe(second.planHash);
    expect(first.submission.plan).toEqual(second.submission.plan);
  });

  it("rejects a cyclic plan even when every referenced node exists", () => {
    const compiled = compiler.compile(compileInput("REFERENCE_CURRENT_STATE"));
    expect(compiled.status).toBe("COMPILED");
    if (compiled.status !== "COMPILED") return;
    const plan = structuredClone(compiled.submission.plan) as WorldQueryPlanV2;
    const secondOutput = plan.outputs[0]!.binding;
    plan.nodes[0]!.inputs = {
      cycle: {
        kind: "NODE_OUTPUT",
        port: secondOutput.port,
        nodeId: "Node_2",
        outputPort: secondOutput.outputPort,
        targetPath: "/referenceKey"
      }
    };
    expect(() => validateCompiledPlan(plan)).toThrow("CYCLIC_PLAN");
  });
});
