import { describe, expect, it } from "vitest";
import { defaultGowmConsumerSchemaRegistry } from "@wsgs/gowm-contract-intake";
import type { WorldQueryPlanV2 } from "./types.js";
import { TypedWorldQueryCompiler, validateCompiledPlan } from "./index.js";
import { authorizeGdpsCurrentness, compileInput } from "./test-fixtures.js";

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

  it("compiles prior GDPS evidence to the single exact currentness operation", () => {
    const input = authorizeGdpsCurrentness(compileInput("PRIOR_RESULT_REVALIDATION"));
    const result = compiler.compile(input);
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(result.submission.plan.nodes).toHaveLength(1);
    expect(result.submission.plan.nodes[0]).toMatchObject({
      operation: { operationId: "geo-product.check-current", operationVersion: "1.0" },
      inputs: {
        productId: { kind: "LITERAL", value: "gdps-slope-prior", targetPath: "/productId" },
        contentHash: { kind: "LITERAL", value: input.parameterValues?.["contentHash"], targetPath: "/contentHash" }
      }
    });
    expect(Object.keys(result.submission.plan.nodes[0]!.inputs).sort()).toEqual(["contentHash", "productId"]);
    expect(result.submission.snapshotPolicy).toEqual({ mode: "LATEST_AT_START", allowDowngrade: false });
    expect(input.operationLocks.find((entry) => entry.operationId === "geo-product.check-current")?.snapshotSupport)
      .toBe("CONSISTENT_AT_START");
    expect(JSON.stringify(result)).not.toMatch(/geo-raster\.(?:sample|find-by-range)/u);
  });

  it("keeps BEST_EFFORT selection on the same currentness-only plan", () => {
    const input = authorizeGdpsCurrentness(compileInput("PRIOR_RESULT_REVALIDATION"));
    input.parameterValues = { ...input.parameterValues, replayMode: "BEST_EFFORT" };
    const result = compiler.compile(input);
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(result.submission.plan.nodes.map((entry) => entry.operation.operationId))
      .toEqual(["geo-product.check-current"]);
    expect(result.submission.parameters).toMatchObject({
      productId: "gdps-slope-prior",
      contentHash: input.parameterValues["contentHash"],
      replayMode: "BEST_EFFORT"
    });
    expect(result.submission.snapshotPolicy).toEqual({ mode: "LATEST_AT_START", allowDowngrade: false });
  });

  it("accepts the full locked GDPS product-id length for currentness", () => {
    const input = authorizeGdpsCurrentness(compileInput("PRIOR_RESULT_REVALIDATION"));
    const productId = `g${"d".repeat(127)}`;
    input.parameterValues = { ...input.parameterValues, productId };
    const result = compiler.compile(input);
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(result.submission.parameters["productId"]).toBe(productId);
  });

  it("fails closed when currentness recipe or operation authority drifts", () => {
    const recipeDrift = authorizeGdpsCurrentness(compileInput("PRIOR_RESULT_REVALIDATION"));
    recipeDrift.trustedGdpsProviderRecipeLockHash = `sha256:${"f".repeat(64)}`;
    expect(compiler.compile(recipeDrift)).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "RECIPE_LOCK_DRIFT" }
    });

    const operationDrift = authorizeGdpsCurrentness(compileInput("PRIOR_RESULT_REVALIDATION"));
    operationDrift.operationLocks.find((entry) => entry.operationId === "geo-product.check-current")!.outputSchemaHash =
      `sha256:${"e".repeat(64)}`;
    expect(compiler.compile(operationDrift)).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "RECIPE_LOCK_DRIFT" }
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
