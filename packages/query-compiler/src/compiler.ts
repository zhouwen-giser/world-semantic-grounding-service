import { createHash } from "node:crypto";
import type { CapabilityDescriptor, CapabilityPort } from "@wsgs/gowm-gateway-client";
import { CapabilityMatcher, capabilityGap } from "./matcher.js";
import {
  queryTemplateRules,
  semanticRequirementFor,
  type QueryTemplateLink,
  type QueryTemplateLiteralBinding,
  type QueryTemplateRequestBinding,
  type QueryTemplateRule,
  type QueryTemplateStep
} from "./recipes.js";
import type {
  CapabilityGapReason,
  CompileInput,
  CompileResult,
  MatchedCapability,
  QuerySnapshotPolicy,
  SchemaPort,
  SemanticCapabilityRequirement,
  SnapshotMode,
  WorldQueryNode,
  WorldQueryPlanV2,
  WorldQuerySubmission
} from "./types.js";
import { canonicalPlanHash, validateCompiledPlan } from "./validation.js";

interface CompiledUnit {
  unitId: string;
  matched: MatchedCapability;
  costWeight: number;
  failurePolicy: WorldQueryNode["failurePolicy"];
  links: readonly QueryTemplateLink[];
  requestBindings: readonly QueryTemplateRequestBinding[];
  literalBindings: readonly QueryTemplateLiteralBinding[];
}

export { queryTemplateRules };

const digestPattern = /^sha256:[0-9a-f]{64}$/u;

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

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${hash(value).slice(0, 24)}`;
}

function schemaPort(port: CapabilityPort): SchemaPort {
  return {
    schemaUri: port.schemaUri,
    schemaHash: port.schemaHash,
    valueKind: port.valueKind,
    unitSemantics: port.unitSemantics
  };
}

function placeholderRequirement(input: CompileInput): SemanticCapabilityRequirement {
  return {
    requirementId: `compile:${input.pattern}`,
    semanticCapability: input.pattern,
    requiredForProduct: input.requiredForProduct,
    domain: "PLATFORM",
    relationSemantics: [],
    acceptedReferenceKinds: [],
    producedReferenceKinds: [],
    spatialSemantics: "NONE",
    timeSemantics: "NONE",
    resultNature: "VALIDATION",
    inputPorts: [],
    outputPorts: [],
    snapshotMode: input.snapshotPolicy?.mode ?? "LATEST_AT_START"
  };
}

function gap(input: CompileInput, reason: CapabilityGapReason, details: Record<string, unknown>): CompileResult {
  return {
    status: "CAPABILITY_GAP",
    gap: capabilityGap(placeholderRequirement(input), reason, details)
  };
}

function costClassWeight(descriptor: CapabilityDescriptor): number {
  switch (descriptor.execution.costClass) {
    case "HIGH": return 4;
    case "MEDIUM": return 2;
    case "LOW": return 1;
    default: return 1;
  }
}

function descriptorLimit(descriptor: CapabilityDescriptor, name: string): number | undefined {
  const value = descriptor.limits[name as keyof CapabilityDescriptor["limits"]];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function executionLimit(descriptor: CapabilityDescriptor): number | undefined {
  const value = descriptor.execution.maximumTimeoutMs;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function weightedAllocation(total: number, units: readonly CompiledUnit[]): number[] {
  const allocations = units.map(() => 1);
  let remaining = total - units.length;
  const weights = units.map((unit) => unit.costWeight * costClassWeight(unit.matched.descriptor));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const fractions = weights.map((weight, index) => {
    const exact = remaining * weight / weightTotal;
    const whole = Math.floor(exact);
    allocations[index]! += whole;
    return { index, remainder: exact - whole, unitId: units[index]!.unitId };
  });
  remaining -= allocations.reduce((sum, value) => sum + value, 0) - units.length;
  fractions.sort((left, right) => right.remainder - left.remainder || left.unitId.localeCompare(right.unitId));
  for (let index = 0; index < remaining; index += 1) {
    allocations[fractions[index % fractions.length]!.index]! += 1;
  }
  return allocations;
}

function boundedAllocations(
  total: number,
  units: readonly CompiledUnit[],
  limitName: "maximumRows" | "maximumCandidates" | "maximumOutputBytes" | "maximumExecutionMs"
): number[] {
  return weightedAllocation(total, units).map((value, index) => {
    const descriptor = units[index]!.matched.descriptor;
    const limit = limitName === "maximumExecutionMs"
      ? executionLimit(descriptor)
      : descriptorLimit(descriptor, limitName);
    return limit === undefined ? value : Math.min(value, limit);
  });
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function snapshotPolicy(input: CompileInput, rule: QueryTemplateRule): QuerySnapshotPolicy | undefined {
  if (input.snapshotPolicy !== undefined) return input.snapshotPolicy;
  if (rule.defaultSnapshotMode === "PINNED") return undefined;
  return { mode: "LATEST_AT_START", allowDowngrade: false };
}

function gdpsAuthorizationGap(input: CompileInput, rule: QueryTemplateRule): CompileResult | undefined {
  if (!rule.previewAuthorizationRequired) return undefined;
  const authorization = input.gdpsRecipeAuthorization;
  const expectedRecipeId = `recipe-${rule.pattern.toLowerCase().replaceAll("_", "-")}`;
  if (!authorization || authorization.previewAuthorizationRequired !== true ||
      authorization.semanticPattern !== rule.pattern ||
      authorization.recipeId !== expectedRecipeId ||
      !input.trustedGdpsRecipeLockHash ||
      authorization.recipeLockHash !== input.trustedGdpsRecipeLockHash ||
      !digestPattern.test(authorization.recipeLockHash) || !digestPattern.test(authorization.descriptorHash)) {
    return gap(input, "RECIPE_LOCK_DRIFT", {
      pattern: rule.pattern,
      exactRecipeAuthorized: false,
      expectedRecipeId,
      trustedRecipeLockMatched: authorization?.recipeLockHash === input.trustedGdpsRecipeLockHash
    });
  }
  const parameterValues = input.parameterValues ?? {};
  if (parameterValues["descriptorId"] !== authorization.descriptorId ||
      parameterValues["descriptorHash"] !== authorization.descriptorHash) {
    return gap(input, "DESCRIPTOR_LOCK_DRIFT", {
      pattern: rule.pattern,
      exactDescriptorAuthorized: false
    });
  }
  for (const step of rule.steps) {
    const operationKey = step.requirement.allowedOperationKeys?.[0];
    if (!operationKey || operationKey.startsWith("reference.") || operationKey.startsWith("world.")) continue;
    const separator = operationKey.lastIndexOf("@");
    const operationId = operationKey.slice(0, separator);
    const operationVersion = operationKey.slice(separator + 1);
    const locked = input.operationLocks.find((entry) =>
      entry.operationId === operationId && entry.operationVersion === operationVersion);
    const allowed = authorization.allowedOperations.find((entry) =>
      entry.operationId === operationId && entry.operationVersion === operationVersion);
    if (!locked || !allowed || locked.inputSchemaHash !== allowed.inputSchemaHash ||
        locked.outputSchemaHash !== allowed.outputSchemaHash ||
        locked.semanticProfileHash !== allowed.semanticProfileHash) {
      return gap(input, "RECIPE_LOCK_DRIFT", {
        pattern: rule.pattern,
        operationKey,
        exactOperationHashes: false
      });
    }
  }
  return undefined;
}

function sourceOutput(
  source: { matched: MatchedCapability },
  outputPort: string
): CapabilityPort | undefined {
  return source.matched.descriptor.ports.outputs.find((port) => port.name === outputPort);
}

export class QueryCompilationError extends Error {
  constructor(readonly code: string) {
    super(`World query compilation failed: ${code}`);
  }
}

export class TypedWorldQueryCompiler {
  private readonly matcher = new CapabilityMatcher();

  compile(input: CompileInput): CompileResult {
    const rule = queryTemplateRules.find((entry) => entry.pattern === input.pattern);
    if (!rule) {
      return gap(input, "UNSUPPORTED_EXPRESSION", { pattern: input.pattern, substituted: false });
    }
    if (rule.maturity === "PREVIEW" && !input.maturityPolicy.allowPreview) {
      return gap(input, "MATURITY_NOT_ALLOWED", {
        pattern: input.pattern,
        recipeMaturity: rule.maturity,
        previewEnabled: false
      });
    }
    const authorizationGap = gdpsAuthorizationGap(input, rule);
    if (authorizationGap) return authorizationGap;
    if (!digestPattern.test(input.parameterSchemaHash)) {
      return gap(input, "SCHEMA_MISMATCH", { reason: "WORLD_QUERY_PARAMETER_SCHEMA_HASH_INVALID" });
    }
    const policy = snapshotPolicy(input, rule);
    if (!policy) {
      return gap(input, "SNAPSHOT_UNSUPPORTED", {
        pattern: input.pattern,
        requiredSnapshotMode: "PINNED",
        pinnedSnapshotPresent: false
      });
    }
    const budgetValues = Object.values(input.budgets);
    if (!budgetValues.every(isPositiveSafeInteger)) {
      return gap(input, "BUDGET_EXCEEDED", { reason: "INVALID_CALLER_BUDGET" });
    }

    const observedAt = input.observedAt ??
      [...input.availability].map((entry) => entry.checkedAt).sort().at(-1) ??
      "1970-01-01T00:00:00.000Z";
    const units: CompiledUnit[] = [];
    const bindings: MatchedCapability["binding"][] = [];
    for (const step of rule.steps) {
      const requirement = semanticRequirementFor(rule, step, input.requiredForProduct, policy.mode);
      const matched = this.matcher.match({
        requirement,
        capabilities: input.capabilities,
        semanticProfiles: input.semanticProfiles,
        operationLocks: input.operationLocks,
        availability: input.availability,
        maturityPolicy: input.maturityPolicy,
        degradedPolicy: input.degradedPolicy ?? (rule.allowDegraded ? "ALLOW" : "REJECT"),
        observedAt
      });
      if (matched.status === "CAPABILITY_GAP") return matched;
      units.push({
        unitId: step.stepId,
        matched: matched.primary,
        costWeight: step.costWeight,
        failurePolicy: step.failurePolicy,
        links: step.links,
        requestBindings: step.requestBindings ?? [],
        literalBindings: step.literalBindings ?? []
      });
      bindings.push(matched.primary.binding);
      if (matched.exactVerification !== undefined) {
        matched.exactVerification.binding.requirementId = `${requirement.requirementId}:exact-verification`;
        const candidateOutput = matched.primary.descriptor.ports.outputs.find((port) => port.name === "cells") ??
          matched.primary.descriptor.ports.outputs.find((port) => port.name === "result") ??
          matched.primary.descriptor.ports.outputs[0];
        if (!candidateOutput) {
          return gap(input, "PORT_MISMATCH", {
            operationId: matched.primary.descriptor.operationId,
            missingPort: "candidate output"
          });
        }
        units.push({
          unitId: `${step.stepId}-exact-verification`,
          matched: matched.exactVerification,
          costWeight: Math.max(2, step.costWeight),
          failurePolicy: "FAIL_FAST",
          requestBindings: [{
            inputName: "geometry",
            path: "/operationInput/geometry",
            targetPath: "/geometry"
          }],
          literalBindings: [],
          links: [{
            sourceStepId: step.stepId,
            outputPort: candidateOutput.name,
            inputName: "candidateReferences",
            targetPath: "/candidateReferences"
          }]
        });
        bindings.push(matched.exactVerification.binding);
      }
    }

    if (
      input.budgets.maximumNodes < units.length ||
      input.budgets.maximumDepth < units.length ||
      [
        input.budgets.maximumRows,
        input.budgets.maximumCandidates,
        input.budgets.maximumOutputBytes,
        input.budgets.maximumExecutionMs
      ].some((value) => value < units.length)
    ) {
      return gap(input, "BUDGET_EXCEEDED", {
        requiredNodes: units.length,
        requiredDepth: units.length
      });
    }

    const rows = boundedAllocations(input.budgets.maximumRows, units, "maximumRows");
    const candidates = boundedAllocations(input.budgets.maximumCandidates, units, "maximumCandidates");
    const outputBytes = boundedAllocations(input.budgets.maximumOutputBytes, units, "maximumOutputBytes");
    const executionMs = boundedAllocations(input.budgets.maximumExecutionMs, units, "maximumExecutionMs");
    const nodes: WorldQueryNode[] = [];
    const resolvedByUnitId = new Map<string, { matched: MatchedCapability; node: WorldQueryNode }>();
    for (const [index, unit] of units.entries()) {
      const nodeId = `Node_${index + 1}`;
      const requestPort = unit.matched.descriptor.ports.inputs.find((port) => port.name === "request") ??
        unit.matched.descriptor.ports.inputs[0];
      if (!requestPort) {
        return gap(input, "PORT_MISMATCH", {
          operationId: unit.matched.descriptor.operationId,
          missingPort: "request"
        });
      }
      const nodeInputs: WorldQueryNode["inputs"] = {};
      if (unit.links.length === 0) {
        nodeInputs["request"] = {
          kind: "REQUEST_PATH",
          port: schemaPort(requestPort),
          path: "/operationInput"
        };
      } else {
        for (const link of unit.links) {
          const source = resolvedByUnitId.get(link.sourceStepId);
          if (!source) throw new QueryCompilationError("TEMPLATE_DEPENDENCY_ORDER");
          const outputPort = sourceOutput(source, link.outputPort);
          if (!outputPort) {
            return gap(input, "PORT_MISMATCH", {
              operationId: source.matched.descriptor.operationId,
              missingPort: link.outputPort
            });
          }
          nodeInputs[link.inputName] = {
            kind: "NODE_OUTPUT",
            port: schemaPort(outputPort),
            nodeId: source.node.nodeId,
            outputPort: outputPort.name,
            ...(outputPort.path === undefined ? {} : { path: outputPort.path }),
            targetPath: link.targetPath
          };
        }
      }
      for (const requestBinding of unit.requestBindings) {
        const parameterName = requestBinding.path.replace(/^\//u, "");
        const hasParameter = Object.hasOwn(input.parameterValues ?? {}, parameterName);
        if (requestBinding.optional && !hasParameter) {
          continue;
        }
        if (nodeInputs[requestBinding.inputName] !== undefined) {
          throw new QueryCompilationError("TEMPLATE_INPUT_NAME_COLLISION");
        }
        if (requestBinding.literalFromParameter) {
          if (!hasParameter || !/^\/[A-Za-z][A-Za-z0-9_]*$/u.test(requestBinding.path)) {
            return gap(input, "SCHEMA_MISMATCH", {
              operationId: unit.matched.descriptor.operationId,
              missingLiteralParameter: parameterName
            });
          }
          nodeInputs[requestBinding.inputName] = {
            kind: "LITERAL",
            port: requestBinding.port ?? schemaPort(requestPort),
            value: structuredClone(input.parameterValues![parameterName]),
            targetPath: requestBinding.targetPath
          };
        } else {
          nodeInputs[requestBinding.inputName] = {
            kind: "REQUEST_PATH",
            port: requestBinding.port ?? schemaPort(requestPort),
            path: requestBinding.path,
            targetPath: requestBinding.targetPath
          };
        }
      }
      for (const literalBinding of unit.literalBindings) {
        if (nodeInputs[literalBinding.inputName] !== undefined) {
          throw new QueryCompilationError("TEMPLATE_INPUT_NAME_COLLISION");
        }
        nodeInputs[literalBinding.inputName] = {
          kind: "LITERAL",
          port: literalBinding.port,
          value: structuredClone(literalBinding.value),
          targetPath: literalBinding.targetPath
        };
      }
      const node: WorldQueryNode = {
        nodeId,
        operation: {
          operationId: unit.matched.lock.operationId,
          operationVersion: unit.matched.lock.operationVersion,
          inputSchemaHash: unit.matched.lock.inputSchemaHash,
          outputSchemaHash: unit.matched.lock.outputSchemaHash
        },
        inputs: nodeInputs,
        failurePolicy: unit.failurePolicy,
        budget: {
          maximumRows: rows[index]!,
          maximumCandidates: candidates[index]!,
          maximumOutputBytes: outputBytes[index]!,
          maximumExecutionMs: executionMs[index]!
        }
      };
      nodes.push(node);
      resolvedByUnitId.set(unit.unitId, { matched: unit.matched, node });
    }

    const finalUnit = units.at(-1)!;
    const finalNode = nodes.at(-1)!;
    const finalOutput = finalUnit.matched.descriptor.ports.outputs.find((port) => port.name === "result") ??
      finalUnit.matched.descriptor.ports.outputs[0];
    if (!finalOutput) {
      return gap(input, "PORT_MISMATCH", {
        operationId: finalUnit.matched.descriptor.operationId,
        missingPort: "result"
      });
    }
    const queryId = stableId("query", canonical({
      ...(input.groundingId === undefined ? {} : { groundingId: input.groundingId }),
      idempotencyKey: input.idempotencyKey,
      requestId: input.requestId,
      templateId: rule.templateId,
      operationInput: input.operationInput,
      parameterValues: input.parameterValues ?? {},
      operationKeys: units.map((unit) =>
        `${unit.matched.lock.operationId}@${unit.matched.lock.operationVersion}`)
    }));
    const plan: WorldQueryPlanV2 = {
      queryPlanVersion: "2.0",
      queryId,
      nodes,
      outputs: [{
        name: "result",
        binding: {
          kind: "NODE_OUTPUT",
          port: schemaPort(finalOutput),
          nodeId: finalNode.nodeId,
          outputPort: finalOutput.name,
          ...(finalOutput.path === undefined ? {} : { path: finalOutput.path })
        }
      }],
      budgets: { ...input.budgets }
    };
    validateCompiledPlan(plan, units.map((unit) => unit.matched.descriptor));
    if (Object.hasOwn(input.parameterValues ?? {}, "operationInput")) {
      throw new QueryCompilationError("RESERVED_PARAMETER_NAME");
    }
    const parameters = {
      operationInput: input.operationInput,
      ...(input.parameterValues ?? {})
    };
    if (Object.keys(parameters).length > 256) {
      return gap(input, "BUDGET_EXCEEDED", { reason: "WORLD_QUERY_PARAMETER_LIMIT" });
    }
    const submission: WorldQuerySubmission = {
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      plan,
      parameters,
      parameterSchemaHash: input.parameterSchemaHash,
      snapshotPolicy: policy
    };
    return {
      status: "COMPILED",
      templateId: rule.templateId,
      bindings,
      submission,
      planHash: canonicalPlanHash(plan),
      policy: {
        approximateInput: units.some((unit) => unit.matched.semanticProfile.spatialSemantics === "CANDIDATE"),
        exactVerificationRequired: units.some((unit) =>
          unit.matched.binding.selectionPolicy.startsWith("EXACT_VERIFIER:")),
        snapshotMode: policy.mode
      }
    };
  }
}

export function recipeSnapshotMode(rule: QueryTemplateRule): SnapshotMode {
  return rule.defaultSnapshotMode ?? "LATEST_AT_START";
}

export type { QueryTemplateRule, QueryTemplateStep };
