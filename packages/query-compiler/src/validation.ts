import { createHash } from "node:crypto";
import type { CapabilityDescriptor, CapabilityPort } from "@wsgs/gowm-gateway-client";
import type { SchemaPort, WorldQueryInputBinding, WorldQueryPlanV2 } from "./types.js";

const unsafeTargetSegments = new Set(["__proto__", "prototype", "constructor"]);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function operationKey(value: { operationId: string; operationVersion: string }): string {
  return `${value.operationId}@${value.operationVersion}`;
}

function samePort(actual: SchemaPort, expected: CapabilityPort): boolean {
  return actual.schemaUri === expected.schemaUri &&
    actual.schemaHash === expected.schemaHash &&
    actual.valueKind === expected.valueKind &&
    actual.unitSemantics === expected.unitSemantics;
}

function targetSegments(path: string): string[] {
  if (!/^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/u.test(path)) {
    throw new Error("INVALID_TARGET_PATH");
  }
  const segments = path.slice(1).split("/").map((segment) =>
    segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (segments.length > 8 || segments.some((segment) => unsafeTargetSegments.has(segment.toLowerCase()))) {
    throw new Error("UNSAFE_TARGET_PATH");
  }
  return segments;
}

function isPrefix(left: readonly string[], right: readonly string[]): boolean {
  return left.length <= right.length && left.every((segment, index) => right[index] === segment);
}

function validSourcePath(portPath: string | undefined, bindingPath: string | undefined): boolean {
  if (bindingPath === undefined) return portPath === undefined;
  let bindingSegments: string[];
  try {
    bindingSegments = targetSegments(bindingPath);
  } catch {
    return false;
  }
  if (portPath === undefined) return true;
  try {
    return isPrefix(targetSegments(portPath), bindingSegments);
  } catch {
    return false;
  }
}

function validateTargetPaths(bindings: readonly WorldQueryInputBinding[]): void {
  const targets = bindings
    .filter((binding) => binding.targetPath !== undefined)
    .map((binding) => targetSegments(binding.targetPath!));
  for (let left = 0; left < targets.length; left += 1) {
    for (let right = left + 1; right < targets.length; right += 1) {
      if (isPrefix(targets[left]!, targets[right]!) || isPrefix(targets[right]!, targets[left]!)) {
        throw new Error("CONFLICTING_TARGET_PATH");
      }
    }
  }
}

function dependencies(plan: WorldQueryPlanV2): Map<string, Set<string>> {
  const nodeIds = new Set(plan.nodes.map((node) => node.nodeId));
  const result = new Map<string, Set<string>>();
  for (const node of plan.nodes) {
    const dependencies = new Set<string>();
    for (const binding of Object.values(node.inputs)) {
      if (binding.kind === "REQUEST_PATH") {
        if (!binding.path.startsWith("/")) throw new Error("INVALID_REQUEST_PATH");
        continue;
      }
      if (binding.kind === "LITERAL") {
        continue;
      }
      if (!nodeIds.has(binding.nodeId)) {
        throw new Error("DANGLING_PLAN_BINDING");
      }
      dependencies.add(binding.nodeId);
    }
    result.set(node.nodeId, dependencies);
  }
  return result;
}

function maximumDepth(graph: ReadonlyMap<string, ReadonlySet<string>>): number {
  const visiting = new Set<string>();
  const memo = new Map<string, number>();
  const visit = (nodeId: string): number => {
    const cached = memo.get(nodeId);
    if (cached !== undefined) return cached;
    if (visiting.has(nodeId)) throw new Error("CYCLIC_PLAN");
    visiting.add(nodeId);
    const dependencies = graph.get(nodeId);
    if (!dependencies) throw new Error("DANGLING_PLAN_BINDING");
    const depth = 1 + Math.max(0, ...[...dependencies].map(visit));
    visiting.delete(nodeId);
    memo.set(nodeId, depth);
    return depth;
  };
  return Math.max(0, ...[...graph.keys()].map(visit));
}

function validateAgainstCapabilities(
  plan: WorldQueryPlanV2,
  capabilities: readonly CapabilityDescriptor[]
): void {
  if (capabilities.length === 0) return;
  const descriptors = new Map(capabilities.map((descriptor) => [operationKey(descriptor), descriptor]));
  const descriptorsByNode = new Map<string, CapabilityDescriptor>();
  for (const node of plan.nodes) {
    const descriptor = descriptors.get(operationKey(node.operation));
    if (!descriptor) throw new Error("PLAN_OPERATION_NOT_REGISTERED");
    if (
      node.operation.inputSchemaHash !== descriptor.inputSchemaHash ||
      node.operation.outputSchemaHash !== descriptor.outputSchemaHash
    ) throw new Error("PLAN_OPERATION_SCHEMA_DRIFT");
    descriptorsByNode.set(node.nodeId, descriptor);
  }
  for (const node of plan.nodes) {
    for (const binding of Object.values(node.inputs)) {
      if (binding.kind !== "NODE_OUTPUT") continue;
      const sourceDescriptor = descriptorsByNode.get(binding.nodeId!);
      const sourcePort = sourceDescriptor?.ports.outputs.find((port) => port.name === binding.outputPort);
      if (!sourcePort || !samePort(binding.port, sourcePort) || !validSourcePath(sourcePort.path, binding.path)) {
        throw new Error("PLAN_SOURCE_PORT_DRIFT");
      }
      if (
        sourcePort.valueKind === "H3_CELL_SET" &&
        sourcePort.unitSemantics !== "DISCRETE"
      ) throw new Error("H3_UNIT_MISMATCH");
      if (
        (sourcePort.valueKind === "GEOMETRY" || sourcePort.valueKind === "POSITION") &&
        sourcePort.unitSemantics !== "ANGULAR_DEGREES"
      ) throw new Error("COORDINATE_UNIT_MISMATCH");
    }
  }
  for (const output of plan.outputs) {
    const descriptor = descriptorsByNode.get(output.binding.nodeId);
    const port = descriptor?.ports.outputs.find((candidate) => candidate.name === output.binding.outputPort);
    if (
      !port ||
      !samePort(output.binding.port, port) ||
      !validSourcePath(port.path, output.binding.path)
    ) throw new Error("PLAN_OUTPUT_PORT_DRIFT");
  }
}

export function validateCompiledPlan(
  plan: WorldQueryPlanV2,
  capabilities: readonly CapabilityDescriptor[] = []
): WorldQueryPlanV2 {
  if (plan.queryPlanVersion !== "2.0" || plan.nodes.length === 0 || plan.nodes.length > 64) {
    throw new Error("INVALID_PLAN_NODE_COUNT");
  }
  if (!Object.values(plan.budgets).every(positiveSafeInteger)) throw new Error("INVALID_PLAN_BUDGET");
  if (plan.nodes.length > plan.budgets.maximumNodes) throw new Error("PLAN_NODE_BUDGET_EXCEEDED");
  const nodeIds = plan.nodes.map((node) => node.nodeId);
  if (new Set(nodeIds).size !== nodeIds.length) throw new Error("DUPLICATE_PLAN_NODE_ID");
  const nodeSet = new Set(nodeIds);
  let rows = 0;
  let candidates = 0;
  let outputBytes = 0;
  let executionMs = 0;
  for (const node of plan.nodes) {
    if (!Object.values(node.budget).every(positiveSafeInteger)) throw new Error("INVALID_NODE_BUDGET");
    rows += node.budget.maximumRows;
    candidates += node.budget.maximumCandidates;
    outputBytes += node.budget.maximumOutputBytes;
    executionMs += node.budget.maximumExecutionMs;
    const bindings = Object.values(node.inputs);
    if (bindings.length === 0) throw new Error("MISSING_PLAN_INPUT");
    validateTargetPaths(bindings);
    for (const binding of bindings) {
      if (
        binding.port.valueKind === "H3_CELL" || binding.port.valueKind === "H3_CELL_SET"
      ) {
        if (binding.port.unitSemantics !== "DISCRETE") throw new Error("H3_UNIT_MISMATCH");
      }
      if (
        binding.port.valueKind === "GEOMETRY" || binding.port.valueKind === "POSITION" ||
        binding.port.valueKind === "POSITIONS"
      ) {
        if (binding.port.unitSemantics !== "ANGULAR_DEGREES") throw new Error("COORDINATE_UNIT_MISMATCH");
      }
    }
  }
  if (
    rows > plan.budgets.maximumRows ||
    candidates > plan.budgets.maximumCandidates ||
    outputBytes > plan.budgets.maximumOutputBytes ||
    executionMs > plan.budgets.maximumExecutionMs
  ) throw new Error("PLAN_AGGREGATE_BUDGET_EXCEEDED");
  for (const output of plan.outputs) {
    if (!nodeSet.has(output.binding.nodeId)) throw new Error("DANGLING_PLAN_OUTPUT");
  }
  const graph = dependencies(plan);
  if (maximumDepth(graph) > plan.budgets.maximumDepth) throw new Error("PLAN_DEPTH_BUDGET_EXCEEDED");
  validateAgainstCapabilities(plan, capabilities);
  return plan;
}

export function canonicalPlanHash(plan: WorldQueryPlanV2): `sha256:${string}` {
  validateCompiledPlan(plan);
  return `sha256:${createHash("sha256").update(canonical(plan), "utf8").digest("hex")}`;
}
