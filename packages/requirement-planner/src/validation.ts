import { createHash } from "node:crypto";

import {
  requestedProducts,
  requirementTypes,
  type PlannerJson,
  type RequirementDependency,
  type WorldQueryRequirement,
  type WorldQueryRequirementGraph
} from "./types.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const outputPattern = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const taggedHashPattern = /^sha256:[0-9a-f]{64}$/u;
const forbiddenInputKey = /^(?:operation|operationId|operationVersion|provider|providerId|providerUrl|url|uri|sql|database|endpoint)$/iu;
const forbiddenStringValue = /(?:https?:\/\/|postgres(?:ql)?:\/\/|jdbc:)|^\s*(?:SELECT|INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE)\s/iu;
const requirementTypeSet = new Set<string>(requirementTypes);
const requestedProductSet = new Set<string>(requestedProducts);

export class RequirementGraphValidationError extends Error {
  constructor(readonly code: string) {
    super(`World query requirement graph rejected: ${code}`);
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function validateNeutralJson(value: unknown, path: string): asserts value is PlannerJson {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string" && forbiddenStringValue.test(value)) {
      throw new RequirementGraphValidationError(`NON_NEUTRAL_VALUE:${path}`);
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RequirementGraphValidationError(`NON_FINITE_INPUT:${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateNeutralJson(entry, `${path}[${index}]`));
    return;
  }
  if (!plainObject(value)) throw new RequirementGraphValidationError(`INVALID_INPUT_VALUE:${path}`);
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenInputKey.test(key)) throw new RequirementGraphValidationError(`NON_NEUTRAL_FIELD:${path}.${key}`);
    validateNeutralJson(entry, `${path}.${key}`);
  }
}

function normalizedRequirements(requirements: readonly WorldQueryRequirement[]): WorldQueryRequirement[] {
  return [...requirements]
    .map((entry) => ({ ...entry, inputs: structuredClone(entry.inputs), outputs: [...entry.outputs].sort() }))
    .sort((left, right) => left.requirementId.localeCompare(right.requirementId));
}

function normalizedDependencies(dependencies: readonly RequirementDependency[]): RequirementDependency[] {
  return [...dependencies]
    .map((entry) => ({ ...entry }))
    .sort((left, right) =>
      left.fromRequirementId.localeCompare(right.fromRequirementId) ||
      left.toRequirementId.localeCompare(right.toRequirementId) ||
      (left.outputName ?? "").localeCompare(right.outputName ?? "") ||
      (left.targetPath ?? "").localeCompare(right.targetPath ?? "")
    );
}

function graphMaterial(graph: WorldQueryRequirementGraph): Omit<WorldQueryRequirementGraph, "graphHash"> {
  return {
    schemaVersion: graph.schemaVersion,
    graphId: graph.graphId,
    requirements: normalizedRequirements(graph.requirements),
    dependencies: normalizedDependencies(graph.dependencies)
  };
}

function validateAcyclic(requirementIds: readonly string[], dependencies: readonly RequirementDependency[]): void {
  const indegree = new Map(requirementIds.map((id) => [id, 0]));
  const outgoing = new Map(requirementIds.map((id) => [id, [] as string[]]));
  for (const dependency of dependencies) {
    outgoing.get(dependency.fromRequirementId)!.push(dependency.toRequirementId);
    indegree.set(dependency.toRequirementId, indegree.get(dependency.toRequirementId)! + 1);
  }
  const ready = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id).sort();
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.shift()!;
    visited += 1;
    for (const target of outgoing.get(id)!.sort()) {
      const next = indegree.get(target)! - 1;
      indegree.set(target, next);
      if (next === 0) ready.push(target);
    }
    ready.sort();
  }
  if (visited !== requirementIds.length) throw new RequirementGraphValidationError("DEPENDENCY_CYCLE");
}

function validateStructure(graph: WorldQueryRequirementGraph): void {
  if (graph.schemaVersion !== "1.0") throw new RequirementGraphValidationError("SCHEMA_VERSION");
  if (!identifierPattern.test(graph.graphId)) throw new RequirementGraphValidationError("INVALID_GRAPH_ID");
  if (!Array.isArray(graph.requirements) || graph.requirements.length < 1 || graph.requirements.length > 64) {
    throw new RequirementGraphValidationError("REQUIREMENT_LIMIT");
  }
  if (!Array.isArray(graph.dependencies) || graph.dependencies.length > 128) {
    throw new RequirementGraphValidationError("DEPENDENCY_LIMIT");
  }
  const requirementIds = graph.requirements.map((entry) => entry.requirementId);
  if (new Set(requirementIds).size !== requirementIds.length) {
    throw new RequirementGraphValidationError("DUPLICATE_REQUIREMENT_ID");
  }
  for (const requirement of graph.requirements) {
    if (!identifierPattern.test(requirement.requirementId)) throw new RequirementGraphValidationError("INVALID_REQUIREMENT_ID");
    if (!requirementTypeSet.has(requirement.requirementType)) throw new RequirementGraphValidationError("UNKNOWN_REQUIREMENT_TYPE");
    if (!requestedProductSet.has(requirement.requiredForProduct)) throw new RequirementGraphValidationError("UNKNOWN_REQUIRED_PRODUCT");
    if (typeof requirement.required !== "boolean" || typeof requirement.allowApproximation !== "boolean") {
      throw new RequirementGraphValidationError("INVALID_REQUIREMENT_POLICY");
    }
    if (!plainObject(requirement.inputs)) throw new RequirementGraphValidationError("INVALID_REQUIREMENT_INPUTS");
    validateNeutralJson(requirement.inputs, `requirements.${requirement.requirementId}.inputs`);
    if (
      !Array.isArray(requirement.outputs) || requirement.outputs.length < 1 || requirement.outputs.length > 32 ||
      new Set(requirement.outputs).size !== requirement.outputs.length || requirement.outputs.some((output) => !outputPattern.test(output))
    ) throw new RequirementGraphValidationError("INVALID_REQUIREMENT_OUTPUTS");
  }
  const requirementSet = new Set(requirementIds);
  const dependencyKeys = new Set<string>();
  for (const dependency of graph.dependencies) {
    if (!requirementSet.has(dependency.fromRequirementId) || !requirementSet.has(dependency.toRequirementId)) {
      throw new RequirementGraphValidationError("DANGLING_DEPENDENCY");
    }
    if (dependency.fromRequirementId === dependency.toRequirementId) {
      throw new RequirementGraphValidationError("SELF_DEPENDENCY");
    }
    if (dependency.outputName !== undefined && !outputPattern.test(dependency.outputName)) {
      throw new RequirementGraphValidationError("INVALID_DEPENDENCY_OUTPUT");
    }
    if (dependency.targetPath !== undefined && !/^\/[A-Za-z][A-Za-z0-9/_-]{0,255}$/u.test(dependency.targetPath)) {
      throw new RequirementGraphValidationError("INVALID_DEPENDENCY_TARGET");
    }
    const key = canonical(dependency);
    if (dependencyKeys.has(key)) throw new RequirementGraphValidationError("DUPLICATE_DEPENDENCY");
    dependencyKeys.add(key);
  }
  validateAcyclic(requirementIds, graph.dependencies);
}

export function canonicalRequirementGraphHash(graph: WorldQueryRequirementGraph): `sha256:${string}` {
  validateStructure(graph);
  return `sha256:${createHash("sha256").update(canonical(graphMaterial(graph)), "utf8").digest("hex")}`;
}

export function validateWorldQueryRequirementGraph(graph: WorldQueryRequirementGraph): WorldQueryRequirementGraph {
  validateStructure(graph);
  if (!taggedHashPattern.test(graph.graphHash) || canonicalRequirementGraphHash(graph) !== graph.graphHash) {
    throw new RequirementGraphValidationError("GRAPH_HASH_MISMATCH");
  }
  return graph;
}
