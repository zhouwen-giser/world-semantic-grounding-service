import { createHash } from "node:crypto";
import type { CapabilityDescriptor, CapabilityPort, OperationLock } from "@wsgs/gowm-gateway-client";
import type {
  CapabilityGap,
  CompileInput,
  CompileResult,
  QuerySemanticPattern,
  SchemaPort,
  WorldQueryNode,
  WorldQueryPlanV2,
  WorldQuerySubmission
} from "./types.js";
import { canonicalPlanHash, validateCompiledPlan } from "./validation.js";

interface QueryTemplateRule {
  templateId: string;
  pattern: Exclude<QuerySemanticPattern, "TERRAIN_VISIBILITY">;
  operations: readonly string[];
  linkOutput?: string;
  linkTargetPath?: string;
  approximate: boolean;
}

export const queryTemplateRules: readonly QueryTemplateRule[] = [
  { templateId: "reference-current-state", pattern: "REFERENCE_CURRENT_STATE", operations: ["reference.resolve", "world.get-current-state"], linkOutput: "candidateReferenceKey", linkTargetPath: "/referenceKey", approximate: false },
  { templateId: "reference-geometry", pattern: "REFERENCE_GEOMETRY", operations: ["reference.resolve", "world.get-geometry"], linkOutput: "candidateReferenceKey", linkTargetPath: "/referenceKey", approximate: false },
  { templateId: "reference-provenance", pattern: "REFERENCE_PROVENANCE", operations: ["reference.resolve", "world.get-provenance"], linkOutput: "candidateReferenceKey", linkTargetPath: "/referenceKey", approximate: false },
  { templateId: "reference-event-timeline", pattern: "REFERENCE_EVENT_TIMELINE", operations: ["reference.resolve", "world.get-event-timeline"], linkOutput: "candidateReferenceKey", linkTargetPath: "/referenceKey", approximate: false },
  { templateId: "nearby-world-objects", pattern: "REFERENCE_NEARBY", operations: ["reference.resolve", "spatial.find-nearby"], linkOutput: "candidateReferenceKey", linkTargetPath: "/anchorReferenceKey", approximate: false },
  { templateId: "area-world-objects", pattern: "REFERENCE_IN_AREA", operations: ["reference.resolve", "spatial.find-in-area"], linkOutput: "candidateReferenceKey", linkTargetPath: "/areaReferenceKey", approximate: false },
  { templateId: "containing-area", pattern: "REFERENCE_CONTAINING_AREA", operations: ["reference.resolve", "spatial.find-containing-area"], linkOutput: "candidateReferenceKey", linkTargetPath: "/referenceKey", approximate: false },
  { templateId: "h3-neighborhood", pattern: "H3_NEIGHBORHOOD", operations: ["h3.neighborhood.disk"], approximate: true },
  { templateId: "h3-exact-verify", pattern: "H3_EXACT_VERIFY", operations: ["h3.neighborhood.disk", "spatial.find-nearby"], linkOutput: "result", linkTargetPath: "/candidateCells", approximate: false },
  { templateId: "operational-correlation-timeline", pattern: "EXTERNAL_CORRELATION_TIMELINE", operations: ["correlation.resolve", "operational-task.get-timeline"], linkOutput: "operationalTaskReferenceKey", linkTargetPath: "/referenceKey", approximate: false },
  { templateId: "predicate-evaluation", pattern: "EXTERNAL_PREDICATE_EVALUATION", operations: ["predicate.evaluate"], approximate: false }
] as const;

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

function gap(input: CompileInput, reason: CapabilityGap["reason"], details: Record<string, unknown>): CompileResult {
  return {
    status: "CAPABILITY_GAP",
    gap: {
      gapId: stableId("gap", `${input.pattern}:${reason}:${JSON.stringify(details)}`),
      semanticCapability: input.pattern,
      reason,
      requiredForProduct: input.requiredForProduct,
      blocking: true,
      details
    }
  };
}

function allocate(total: number, count: number): number {
  return Math.floor(total / count);
}

export class QueryCompilationError extends Error {
  constructor(readonly code: string) {
    super(`World query compilation failed: ${code}`);
  }
}

export class TypedWorldQueryCompiler {
  compile(input: CompileInput): CompileResult {
    const rule = queryTemplateRules.find((entry) => entry.pattern === input.pattern);
    if (!rule) return gap(input, "UNSUPPORTED_EXPRESSION", { pattern: input.pattern, substituted: false });
    if (
      !Number.isSafeInteger(input.budgets.maximumNodes) || !Number.isSafeInteger(input.budgets.maximumDepth) ||
      input.budgets.maximumNodes < rule.operations.length || input.budgets.maximumDepth < rule.operations.length ||
      [input.budgets.maximumRows, input.budgets.maximumCandidates, input.budgets.maximumOutputBytes, input.budgets.maximumExecutionMs]
        .some((value) => !Number.isSafeInteger(value) || value < rule.operations.length)
    ) return gap(input, "BUDGET_EXCEEDED", { requiredNodes: rule.operations.length });

    const locks = new Map(input.operationLocks.map((lock) => [`${lock.operationId}@${lock.operationVersion}`, lock]));
    const descriptors = new Map(input.capabilities.map((entry) => [`${entry.operationId}@${entry.operationVersion}`, entry]));
    const resolved: Array<{ lock: OperationLock; descriptor: CapabilityDescriptor }> = [];
    for (const operationId of rule.operations) {
      const lock = [...input.operationLocks].find((entry) => entry.operationId === operationId);
      if (!lock) return gap(input, "NOT_REGISTERED", { operationId, source: "operation-lock" });
      const descriptor = descriptors.get(`${operationId}@${lock.operationVersion}`);
      if (!descriptor) return gap(input, "NOT_REGISTERED", { operationId, operationVersion: lock.operationVersion });
      if (descriptor.providerId === undefined || descriptor.providerId !== lock.providerId) {
        return gap(input, "PROVIDER_UNAVAILABLE", { operationId, expectedProviderId: lock.providerId });
      }
      if (descriptor.maturity !== "PREVIEW" && descriptor.maturity !== "STABLE") {
        return gap(input, "MATURITY_NOT_ALLOWED", { operationId, maturity: descriptor.maturity });
      }
      if (descriptor.inputSchemaHash !== lock.inputSchemaHash || descriptor.outputSchemaHash !== lock.outputSchemaHash) {
        return gap(input, "SCHEMA_MISMATCH", { operationId, layer: "operation" });
      }
      if (!locks.has(`${operationId}@${lock.operationVersion}`)) throw new QueryCompilationError("LOCK_LOOKUP_DRIFT");
      resolved.push({ lock, descriptor });
    }

    const rows = allocate(input.budgets.maximumRows, resolved.length);
    const candidates = allocate(input.budgets.maximumCandidates, resolved.length);
    const outputBytes = allocate(input.budgets.maximumOutputBytes, resolved.length);
    const executionMs = allocate(input.budgets.maximumExecutionMs, resolved.length);
    const nodes: WorldQueryNode[] = [];
    for (const [index, entry] of resolved.entries()) {
      const nodeId = `Node_${index + 1}`;
      const inputPort = entry.descriptor.ports.inputs.find((port) => port.name === "request");
      if (!inputPort) return gap(input, "SCHEMA_MISMATCH", { operationId: entry.lock.operationId, missingPort: "request" });
      let binding: WorldQueryNode["inputs"][string];
      if (index === 0) {
        binding = { kind: "REQUEST_PATH", port: schemaPort(inputPort), path: "/operationInput" };
      } else {
        const prior = resolved[index - 1]!;
        const outputName = index === 1 && rule.linkOutput ? rule.linkOutput : "result";
        const outputPort = prior.descriptor.ports.outputs.find((port) => port.name === outputName);
        if (!outputPort) {
          return gap(input, "SCHEMA_MISMATCH", { operationId: prior.lock.operationId, missingPort: outputName });
        }
        if (
          (outputPort.valueKind === "H3_CELL" || outputPort.valueKind === "H3_CELL_SET") &&
          outputPort.unitSemantics !== "DISCRETE"
        ) return gap(input, "SCHEMA_MISMATCH", { operationId: prior.lock.operationId, reason: "H3_UNIT_MISMATCH" });
        binding = {
          kind: "NODE_OUTPUT",
          port: schemaPort(outputPort),
          nodeId: `Node_${index}`,
          outputPort: outputName,
          ...(index === 1 && rule.linkTargetPath ? { targetPath: rule.linkTargetPath } : {})
        };
      }
      nodes.push({
        nodeId,
        operation: {
          operationId: entry.lock.operationId,
          operationVersion: entry.lock.operationVersion,
          inputSchemaHash: entry.lock.inputSchemaHash,
          outputSchemaHash: entry.lock.outputSchemaHash
        },
        inputs: { request: binding },
        failurePolicy: "FAIL_FAST",
        budget: {
          maximumRows: rows,
          maximumCandidates: candidates,
          maximumOutputBytes: outputBytes,
          maximumExecutionMs: executionMs
        }
      });
    }
    const finalDescriptor = resolved.at(-1)!.descriptor;
    const finalOutput = finalDescriptor.ports.outputs.find((port) => port.name === "result") ?? finalDescriptor.ports.outputs[0];
    if (!finalOutput) return gap(input, "SCHEMA_MISMATCH", { operationId: resolved.at(-1)!.lock.operationId, missingPort: "result" });
    const queryId = stableId("query", `${input.requestId}:${rule.templateId}:${JSON.stringify(input.operationInput)}`);
    const plan: WorldQueryPlanV2 = {
      queryPlanVersion: "2.0",
      queryId,
      nodes,
      outputs: [{
        name: "result",
        binding: {
          kind: "NODE_OUTPUT",
          port: schemaPort(finalOutput),
          nodeId: nodes.at(-1)!.nodeId,
          outputPort: finalOutput.name
        }
      }],
      budgets: { ...input.budgets }
    };
    validateCompiledPlan(plan);
    const parameterSchema = '{"additionalProperties":false,"properties":{"operationInput":{"type":"object"}},"required":["operationInput"],"type":"object"}';
    const submission: WorldQuerySubmission = {
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      plan,
      parameters: { operationInput: input.operationInput },
      parameterSchemaHash: `sha256:${hash(parameterSchema)}`
    };
    return {
      status: "COMPILED",
      templateId: rule.templateId,
      submission,
      planHash: canonicalPlanHash(plan),
      policy: {
        approximateInput: rule.pattern === "H3_NEIGHBORHOOD" || rule.pattern === "H3_EXACT_VERIFY",
        exactVerificationRequired: rule.pattern === "H3_EXACT_VERIFY"
      }
    };
  }
}
