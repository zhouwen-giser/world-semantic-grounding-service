import { createHash } from "node:crypto";
import type { CapabilityDescriptor, CapabilityPort, OperationLock } from "@wsgs/gowm-gateway-client";
import { describe, expect, it } from "vitest";
import type { CompileInput, QuerySemanticPattern } from "./types.js";
import { TypedWorldQueryCompiler, validateCompiledPlan } from "./index.js";

const operationProviders: Record<string, string> = {
  "reference.resolve": "gowm.reference-catalog",
  "world.get-current-state": "gowm.world-evidence",
  "world.get-geometry": "gowm.world-evidence",
  "world.get-provenance": "gowm.world-evidence",
  "world.get-event-timeline": "gowm.world-evidence",
  "spatial.find-nearby": "gowm.spatial-analysis.bridge",
  "spatial.find-in-area": "gowm.spatial-analysis.bridge",
  "spatial.find-containing-area": "gowm.spatial-analysis.bridge",
  "h3.neighborhood.disk": "gowm.h3.interactive",
  "correlation.resolve": "gowm.operational-reality",
  "operational-task.get-timeline": "gowm.operational-reality",
  "predicate.evaluate": "gowm.operational-reality"
};

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function port(name: string, operationId: string, direction: string, valueKind = "ANY", unitSemantics = "UNSPECIFIED"): CapabilityPort {
  return {
    name,
    schemaUri: `urn:test:${operationId}:${direction}`,
    schemaHash: digest(`${operationId}:${direction}:${name}`),
    valueKind,
    unitSemantics
  };
}

function operation(operationId: string): { lock: OperationLock; descriptor: CapabilityDescriptor } {
  const inputSchemaHash = digest(`${operationId}:input`);
  const outputSchemaHash = digest(`${operationId}:output`);
  const providerId = operationProviders[operationId]!;
  const outputPorts = operationId === "reference.resolve"
    ? [port("result", operationId, "out"), port("candidateReferenceKey", operationId, "ref", "REFERENCE_KEY")]
    : operationId === "correlation.resolve"
      ? [port("result", operationId, "out"), port("operationalTaskReferenceKey", operationId, "ref", "REFERENCE_KEY")]
      : operationId === "h3.neighborhood.disk"
        ? [port("result", operationId, "out", "H3_CELL_SET", "DISCRETE")]
        : [port("result", operationId, "out", "ROW_SET")];
  return {
    lock: { operationId, operationVersion: "1.0", providerId, maturity: "PREVIEW", inputSchemaHash, outputSchemaHash },
    descriptor: {
      operationId,
      operationVersion: "1.0",
      providerId,
      maturity: "PREVIEW",
      inputSchemaHash,
      outputSchemaHash,
      ports: { inputs: [port("request", operationId, "in")], outputs: outputPorts }
    }
  };
}

const all = Object.keys(operationProviders).map(operation);
const capabilities = all.map((entry) => entry.descriptor);
const operationLocks = all.map((entry) => entry.lock);
const budgets = {
  maximumNodes: 16,
  maximumDepth: 16,
  maximumRows: 100,
  maximumCandidates: 100,
  maximumOutputBytes: 1_000_000,
  maximumExecutionMs: 10_000
};

function input(pattern: QuerySemanticPattern): CompileInput {
  return {
    requestId: "request-1",
    idempotencyKey: "idem-1",
    pattern,
    requiredForProduct: "WORLD_EVIDENCE",
    operationInput: { mentions: [{ mentionId: "m1", surfaceText: "road" }], distanceM: 500 },
    capabilities,
    operationLocks,
    budgets
  };
}

describe("TypedWorldQueryCompiler", () => {
  const compiler = new TypedWorldQueryCompiler();

  it.each([
    ["REFERENCE_CURRENT_STATE", ["reference.resolve", "world.get-current-state"]],
    ["REFERENCE_GEOMETRY", ["reference.resolve", "world.get-geometry"]],
    ["REFERENCE_EVENT_TIMELINE", ["reference.resolve", "world.get-event-timeline"]],
    ["REFERENCE_NEARBY", ["reference.resolve", "spatial.find-nearby"]],
    ["REFERENCE_IN_AREA", ["reference.resolve", "spatial.find-in-area"]],
    ["EXTERNAL_CORRELATION_TIMELINE", ["correlation.resolve", "operational-task.get-timeline"]],
    ["EXTERNAL_PREDICATE_EVALUATION", ["predicate.evaluate"]]
  ] as const)("compiles only the approved %s operation mapping", (pattern, expected) => {
    const result = compiler.compile(input(pattern));
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(result.submission.plan.nodes.map((node) => node.operation.operationId)).toEqual(expected);
    expect(() => validateCompiledPlan(result.submission.plan)).not.toThrow();
    expect(result.submission.plan.nodes.every((node) =>
      node.operation.inputSchemaHash.startsWith("sha256:") && node.operation.outputSchemaHash.startsWith("sha256:")
    )).toBe(true);
  });

  it("keeps H3 approximate and requires an exact Spatial node for boundary-sensitive use", () => {
    const approximate = compiler.compile(input("H3_NEIGHBORHOOD"));
    expect(approximate).toMatchObject({
      status: "COMPILED",
      policy: { approximateInput: true, exactVerificationRequired: false }
    });
    const exact = compiler.compile(input("H3_EXACT_VERIFY"));
    expect(exact).toMatchObject({
      status: "COMPILED",
      policy: { approximateInput: true, exactVerificationRequired: true }
    });
    if (exact.status === "COMPILED") {
      expect(exact.submission.plan.nodes.map((node) => node.operation.operationId)).toEqual([
        "h3.neighborhood.disk", "spatial.find-nearby"
      ]);
    }
  });

  it("returns a blocking gap for visibility and never substitutes a similar operation", () => {
    const result = compiler.compile(input("TERRAIN_VISIBILITY"));
    expect(result).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "UNSUPPORTED_EXPRESSION", blocking: true, details: { substituted: false } }
    });
    expect(JSON.stringify(result)).not.toContain("spatial.find-nearby");
  });

  it("fails before Gateway when an exact operation, provider, schema, or port drifts", () => {
    const missing = input("REFERENCE_CURRENT_STATE");
    missing.capabilities = missing.capabilities.filter((entry) => entry.operationId !== "world.get-current-state");
    expect(compiler.compile(missing)).toMatchObject({ status: "CAPABILITY_GAP", gap: { reason: "NOT_REGISTERED" } });

    const drift = input("REFERENCE_CURRENT_STATE");
    drift.capabilities = drift.capabilities.map((entry) => entry.operationId === "world.get-current-state"
      ? { ...entry, outputSchemaHash: digest("drift") }
      : entry);
    expect(compiler.compile(drift)).toMatchObject({ status: "CAPABILITY_GAP", gap: { reason: "SCHEMA_MISMATCH" } });

    const missingPort = input("REFERENCE_CURRENT_STATE");
    missingPort.capabilities = missingPort.capabilities.map((entry) => entry.operationId === "reference.resolve"
      ? { ...entry, ports: { ...entry.ports, outputs: entry.ports.outputs.filter((portValue) => portValue.name !== "candidateReferenceKey") } }
      : entry);
    expect(compiler.compile(missingPort)).toMatchObject({ status: "CAPABILITY_GAP", gap: { reason: "SCHEMA_MISMATCH" } });
  });

  it("rejects H3 unit drift instead of mixing angular, linear, and discrete units", () => {
    const drift = input("H3_EXACT_VERIFY");
    drift.capabilities = drift.capabilities.map((entry) => entry.operationId === "h3.neighborhood.disk"
      ? {
          ...entry,
          ports: {
            ...entry.ports,
            outputs: entry.ports.outputs.map((output) => output.name === "result"
              ? { ...output, unitSemantics: "LINEAR_METERS" }
              : output)
          }
        }
      : entry);
    expect(compiler.compile(drift)).toMatchObject({ status: "CAPABILITY_GAP", gap: { reason: "SCHEMA_MISMATCH" } });
  });

  it("enforces aggregate budgets and never accepts a direct public plan", () => {
    const bounded = input("REFERENCE_CURRENT_STATE");
    bounded.budgets = { ...budgets, maximumNodes: 1 };
    expect(compiler.compile(bounded)).toMatchObject({ status: "CAPABILITY_GAP", gap: { reason: "BUDGET_EXCEEDED" } });
    const publicOperationInput = JSON.stringify(input("REFERENCE_CURRENT_STATE").operationInput);
    expect(publicOperationInput).not.toContain("queryPlanVersion");
    expect(publicOperationInput).not.toContain("operationId");
  });

  it("produces a byte-stable canonical plan hash", () => {
    const first = compiler.compile(input("REFERENCE_CURRENT_STATE"));
    const second = compiler.compile(structuredClone(input("REFERENCE_CURRENT_STATE")));
    expect(first).toEqual(second);
    expect(first.status === "COMPILED" ? first.planHash : "").toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
});
