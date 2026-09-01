import { createHash } from "node:crypto";

import {
  authorizationContextHash,
  type DelegationRequest,
  type GroundingIdentityV2,
  type SignedDelegation
} from "@wsgs/delegated-identity";
import type {
  CapabilityDescriptor,
  GatewayRequestContext,
  GatewayResponse,
  Sha256Digest
} from "@wsgs/gowm-gateway-client";
import {
  assessWorldSnapshot,
  parseAndVerifySnapshotManifest,
  parseSnapshotAdherence,
  type QuerySnapshotManifest
} from "@wsgs/gowm-execution-evidence";
import {
  canonicalPlanHash,
  validateCompiledPlan,
  type WorldQueryInputBinding,
  type WorldQueryNode,
  type WorldQueryPlanV2,
  type WorldQuerySubmission
} from "@wsgs/query-compiler";

import {
  SegmentedScopeAuthorityError,
  assertLoadedSegmentedScopeAuthority,
  type SegmentedOperationScopeBinding,
  type SegmentedScopeAuthority
} from "./segmented-scope-authority.js";

const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const compactJwsPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const unsafeTargetSegments = new Set(["__proto__", "prototype", "constructor"]);
const successfulWorldStatuses = new Set(["COMPLETED", "PARTIAL"]);
const usableNodeStatuses = new Set(["COMPLETED", "PARTIAL", "NO_DATA"]);

const projectedValuePorts = Object.freeze({
  array: {
    schemaUri: "urn:gowm:v0.2:value:array",
    schemaHash: "sha256:8e1e4dd66e9483d8341c51dc5ec424d8e6510ae35cdbc53040d0bab497459945",
    valueKind: "ANY",
    unitSemantics: "UNSPECIFIED"
  },
  boolean: {
    schemaUri: "urn:gowm:v0.2:value:boolean",
    schemaHash: "sha256:7f17d695204279bf96eee346c482a8525470b30e5685c0a8fe2d8c3d291c6837",
    valueKind: "ANY",
    unitSemantics: "UNSPECIFIED"
  },
  number: {
    schemaUri: "urn:gowm:v0.2:value:number",
    schemaHash: "sha256:f0bbdee8d99cf6777316260a88948dcb4290389c3a80268ae3cbbc4835970348",
    valueKind: "ANY",
    unitSemantics: "UNSPECIFIED"
  },
  object: {
    schemaUri: "urn:gowm:v0.2:value:object",
    schemaHash: "sha256:a874188523644975b2d758a153c3b6fafbafd5b107133b30b9abf4055ae1809c",
    valueKind: "ANY",
    unitSemantics: "UNSPECIFIED"
  },
  string: {
    schemaUri: "urn:gowm:v0.2:value:string",
    schemaHash: "sha256:a71d355802de7ff21b9c9d9214a1ba71b3648866bcf1b7c0f4ff3b656485c6d5",
    valueKind: "ANY",
    unitSemantics: "UNSPECIFIED"
  }
} as const);

type JsonObject = Record<string, unknown>;

export class SegmentedWorldQueryError extends Error {
  constructor(readonly code: string) {
    super(`Segmented GOWM world query rejected: ${code}`);
  }
}

export interface SegmentedDelegationSigner {
  sign(input: DelegationRequest): Promise<SignedDelegation>;
}

export interface SegmentedGatewayClient {
  submitWorldQuery(
    request: Record<string, unknown>,
    context?: GatewayRequestContext
  ): Promise<GatewayResponse<unknown>>;
  pollJob(
    jobId: string,
    context?: GatewayRequestContext,
    intervalMs?: number
  ): Promise<Record<string, unknown>>;
  cancelWorldQuery(
    queryId: string,
    context?: GatewayRequestContext
  ): Promise<unknown>;
}

export interface AcceptedSegmentCheckpoint {
  readonly nodeId: string;
  readonly operationKey: string;
  readonly dataScope: string;
  readonly submission: WorldQuerySubmission;
  readonly delegatedIdentityHash: string;
  readonly responseStatus: 202;
  readonly acceptance: Readonly<JsonObject>;
}

export interface CompletedSegmentCheckpoint {
  readonly nodeId: string;
  readonly operationKey: string;
  readonly dataScope: string;
  readonly sourceLockHash: Sha256Digest;
  readonly submission: WorldQuerySubmission;
  readonly delegatedIdentityHash: string;
  readonly responseStatus: 200 | 202;
  readonly response: Readonly<JsonObject>;
  readonly worldResult: Readonly<JsonObject>;
  readonly terminal?: Readonly<JsonObject>;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface SegmentedWorldQueryRuntime {
  readonly gateway: SegmentedGatewayClient;
  readonly signer: SegmentedDelegationSigner;
  readonly now?: () => Date;
  /** Mandatory durability fence invoked before the first async poll. */
  readonly onAccepted: (checkpoint: AcceptedSegmentCheckpoint) => Promise<void>;
  readonly onCompleted?: (checkpoint: CompletedSegmentCheckpoint) => Promise<void>;
}

export interface SegmentedWorldQuerySegment {
  readonly nodeId: string;
  readonly operationKey: string;
  readonly dataScope: string;
  readonly sourceLockHash: Sha256Digest;
  readonly submission: WorldQuerySubmission;
  readonly delegatedIdentityHash: string;
  readonly responseStatus: 200 | 202;
  readonly response: Readonly<JsonObject>;
  readonly terminal?: Readonly<JsonObject>;
  readonly worldResult: Readonly<JsonObject>;
  readonly nodeResult: Readonly<JsonObject>;
  readonly startedAt: string;
  readonly finishedAt: string;
}

/**
 * This is deliberately not a WorldQueryResult. Each segment is an independent
 * Gateway execution and remains individually auditable; callers must not
 * present this aggregate as one upstream DAG execution.
 */
export interface SegmentedWorldQueryExecution {
  readonly schemaVersion: "wsgs-segmented-world-query-execution/1.0";
  readonly executionMode: "GATEWAY_SEGMENTED_BY_TRUSTED_DATA_SCOPE";
  readonly sourceQueryId: string;
  readonly sourcePlanHash: Sha256Digest;
  readonly scopeAuthorityHash: Sha256Digest;
  readonly status: "COMPLETED" | "PARTIAL";
  readonly segments: readonly SegmentedWorldQuerySegment[];
  readonly nodeResults: readonly Readonly<JsonObject>[];
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly segmentedExecutionHash: Sha256Digest;
}

export interface ExecuteSegmentedWorldQueryInput {
  readonly submission: WorldQuerySubmission;
  readonly authority: SegmentedScopeAuthority;
  /** The persisted, contract-verified catalog used for the original compile. */
  readonly capabilities: readonly CapabilityDescriptor[];
  readonly identity: GroundingIdentityV2;
  readonly runtime: SegmentedWorldQueryRuntime;
  readonly signal?: AbortSignal;
  readonly deadlineAt: Date;
}

function operationKey(value: { operationId: string; operationVersion: string }): string {
  return `${value.operationId}@${value.operationVersion}`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as JsonObject)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function assertJson(value: unknown, code: string, active = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new SegmentedWorldQueryError(code);
    return;
  }
  if (typeof value !== "object") throw new SegmentedWorldQueryError(code);
  if (active.has(value)) throw new SegmentedWorldQueryError(code);
  active.add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new SegmentedWorldQueryError(code);
    for (const item of value) assertJson(item, code, active);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new SegmentedWorldQueryError(code);
    for (const item of Object.values(value as JsonObject)) assertJson(item, code, active);
  }
  active.delete(value);
}

function jsonClone<T>(value: T, code: string): T {
  assertJson(value, code);
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
  return Object.freeze(value);
}

function jsonFrozenClone<T>(value: T, code: string): T {
  return deepFreeze(jsonClone(value, code));
}

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SegmentedWorldQueryError(code);
  return value as JsonObject;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new SegmentedWorldQueryError(code);
  return value;
}

function pointer(value: unknown, path: string, code: string): unknown {
  if (!/^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/u.test(path)) {
    throw new SegmentedWorldQueryError(code);
  }
  let current = value;
  for (const encoded of path.slice(1).split("/")) {
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(segment)) throw new SegmentedWorldQueryError(code);
      const index = Number(segment);
      if (index >= current.length) throw new SegmentedWorldQueryError(code);
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      throw new SegmentedWorldQueryError(code);
    }
    current = (current as JsonObject)[segment];
  }
  return jsonClone(current, code);
}

function dependencies(plan: WorldQueryPlanV2): ReadonlyMap<string, ReadonlySet<string>> {
  const nodes = new Set(plan.nodes.map(({ nodeId }) => nodeId));
  if (nodes.size !== plan.nodes.length) throw new SegmentedWorldQueryError("DUPLICATE_PLAN_NODE_ID");
  const outputNames = new Set<string>();
  const result = new Map<string, ReadonlySet<string>>();
  for (const node of plan.nodes) {
    const values = new Set<string>();
    for (const binding of Object.values(node.inputs)) {
      if (binding.kind === "LITERAL" || binding.kind === "REQUEST_PATH") continue;
      if (binding.kind !== "NODE_OUTPUT") throw new SegmentedWorldQueryError("BINDING_KIND_UNSUPPORTED");
      if (!nodes.has(binding.nodeId)) throw new SegmentedWorldQueryError("DANGLING_PLAN_BINDING");
      values.add(binding.nodeId);
    }
    result.set(node.nodeId, values);
  }
  for (const output of plan.outputs) {
    if (!nodes.has(output.binding.nodeId)) throw new SegmentedWorldQueryError("DANGLING_PLAN_OUTPUT");
    if (outputNames.has(output.name)) throw new SegmentedWorldQueryError("DUPLICATE_PLAN_OUTPUT_NAME");
    outputNames.add(output.name);
  }
  return result;
}

function topologicalNodes(plan: WorldQueryPlanV2): readonly WorldQueryNode[] {
  const graph = dependencies(plan);
  const byId = new Map(plan.nodes.map((node) => [node.nodeId, node]));
  const complete = new Set<string>();
  const ordered: WorldQueryNode[] = [];
  while (ordered.length < plan.nodes.length) {
    const next = plan.nodes.find(({ nodeId }) => !complete.has(nodeId) &&
      [...(graph.get(nodeId) ?? [])].every((dependency) => complete.has(dependency)));
    if (!next) throw new SegmentedWorldQueryError("CYCLIC_PLAN");
    ordered.push(byId.get(next.nodeId)!);
    complete.add(next.nodeId);
  }
  return ordered;
}

function operationBinding(
  authority: SegmentedScopeAuthority,
  node: WorldQueryNode
): SegmentedOperationScopeBinding {
  const binding = authority.bindings[operationKey(node.operation)];
  if (!binding) throw new SegmentedWorldQueryError("OPERATION_SCOPE_AUTHORITY_MISSING");
  if (binding.operation.inputSchemaHash !== node.operation.inputSchemaHash ||
      binding.operation.outputSchemaHash !== node.operation.outputSchemaHash) {
    throw new SegmentedWorldQueryError("OPERATION_SCOPE_LOCK_DRIFT");
  }
  return binding;
}

function nodeResultValue(
  resultByNode: ReadonlyMap<string, Readonly<JsonObject>>,
  binding: Extract<WorldQueryInputBinding, { kind: "NODE_OUTPUT" }>,
  noData: "REJECT" | "NULL" = "REJECT"
): unknown {
  const node = resultByNode.get(binding.nodeId);
  if (!node) throw new SegmentedWorldQueryError("SOURCE_NODE_OUTPUT_MISSING");
  if (!usableNodeStatuses.has(String(node["status"]))) {
    throw new SegmentedWorldQueryError("SOURCE_NODE_NOT_USABLE");
  }
  const envelope = object(node["result"], "SOURCE_NODE_RESULT_ENVELOPE_MISSING");
  if (node["status"] === "NO_DATA" && noData === "REJECT") {
    throw new SegmentedWorldQueryError("SOURCE_NODE_NO_DATA");
  }
  const output = object(envelope["output"], "SOURCE_NODE_OUTPUT_MISSING");
  const value = output["value"];
  return binding.path === undefined
    ? jsonClone(value, "SOURCE_NODE_OUTPUT_NOT_JSON")
    : pointer(value, binding.path, "SOURCE_NODE_OUTPUT_PATH_UNRESOLVED");
}

function resolveInputBinding(
  submission: WorldQuerySubmission,
  resultByNode: ReadonlyMap<string, Readonly<JsonObject>>,
  binding: WorldQueryInputBinding
): unknown {
  if (binding.kind === "LITERAL") return jsonClone(binding.value, "LITERAL_BINDING_NOT_JSON");
  if (binding.kind === "REQUEST_PATH") {
    return pointer(submission.parameters, binding.path, "REQUEST_PATH_BINDING_UNRESOLVED");
  }
  if (binding.kind !== "NODE_OUTPUT") throw new SegmentedWorldQueryError("BINDING_KIND_UNSUPPORTED");
  return nodeResultValue(resultByNode, binding);
}

function projectedValuePort(value: unknown): WorldQueryInputBinding["port"] {
  if (Array.isArray(value)) return projectedValuePorts.array;
  if (value !== null && typeof value === "object") return projectedValuePorts.object;
  if (typeof value === "boolean") return projectedValuePorts.boolean;
  if (typeof value === "number") return projectedValuePorts.number;
  if (typeof value === "string") return projectedValuePorts.string;
  throw new SegmentedWorldQueryError("PROJECTED_NODE_OUTPUT_TYPE_UNSUPPORTED");
}

function segmentOutputs(plan: WorldQueryPlanV2, nodeId: string): WorldQueryPlanV2["outputs"] {
  const outputs = new Map<string, WorldQueryPlanV2["outputs"][number]["binding"]>();
  const add = (binding: WorldQueryPlanV2["outputs"][number]["binding"]): void => {
    const selector = {
      kind: binding.kind,
      port: binding.port,
      nodeId: binding.nodeId,
      outputPort: binding.outputPort
    } as const;
    const prior = outputs.get(binding.outputPort);
    if (prior && canonical(prior) !== canonical(selector)) {
      throw new SegmentedWorldQueryError("AMBIGUOUS_NODE_OUTPUT_PORT_BINDING");
    }
    outputs.set(binding.outputPort, selector);
  };
  for (const node of plan.nodes) {
    for (const binding of Object.values(node.inputs)) {
      if (binding.kind === "NODE_OUTPUT" && binding.nodeId === nodeId) add(binding);
    }
  }
  for (const output of plan.outputs) {
    if (output.binding.nodeId === nodeId) add(output.binding);
  }
  if (outputs.size === 0) throw new SegmentedWorldQueryError("NODE_OUTPUT_BINDING_REQUIRED");
  return [...outputs.entries()].map(([name, binding]) => ({ name, binding: jsonClone(binding, "INVALID_NODE_OUTPUT_BINDING") }));
}

function boundedIdentifier(prefix: string, suffix: string): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9._:-]/gu, "-");
  const maximumPrefixLength = 255 - suffix.length;
  const candidate = `${safePrefix.slice(0, Math.max(1, maximumPrefixLength))}${suffix}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(candidate)) {
    throw new SegmentedWorldQueryError("SEGMENT_IDENTIFIER_INVALID");
  }
  return candidate;
}

function singleNodeSubmission(
  source: WorldQuerySubmission,
  node: WorldQueryNode,
  index: number,
  resultByNode: ReadonlyMap<string, Readonly<JsonObject>>
): WorldQuerySubmission {
  const inputEntries = Object.entries(node.inputs).map(([name, binding]) => {
    const value = resolveInputBinding(source, resultByNode, binding);
    const port = binding.kind === "NODE_OUTPUT" && binding.path !== undefined
      ? projectedValuePort(value)
      : binding.port;
    return [name, {
      kind: "LITERAL" as const,
      port: jsonClone(port, "INVALID_BINDING_PORT"),
      value,
      ...(binding.targetPath === undefined ? {} : { targetPath: binding.targetPath })
    }] as const;
  });
  const segmentDigest = createHash("sha256")
    .update(`${source.plan.queryId}:${index}:${node.nodeId}:${operationKey(node.operation)}`)
    .digest("hex").slice(0, 20);
  const identifierSuffix = `:seg:${index}:${segmentDigest}`;
  const plan: WorldQueryPlanV2 = {
    queryPlanVersion: "2.0",
    queryId: boundedIdentifier(source.plan.queryId, identifierSuffix),
    nodes: [{
      ...jsonClone(node, "INVALID_PLAN_NODE"),
      inputs: Object.fromEntries(inputEntries)
    }],
    outputs: segmentOutputs(source.plan, node.nodeId),
    budgets: {
      maximumNodes: 1,
      maximumDepth: 1,
      maximumRows: node.budget.maximumRows,
      maximumCandidates: node.budget.maximumCandidates,
      maximumOutputBytes: node.budget.maximumOutputBytes,
      maximumExecutionMs: node.budget.maximumExecutionMs
    }
  };
  return {
    requestId: source.requestId,
    idempotencyKey: boundedIdentifier(source.idempotencyKey, identifierSuffix),
    plan,
    parameters: jsonClone(source.parameters, "INVALID_WORLD_QUERY_PARAMETERS"),
    parameterSchemaHash: source.parameterSchemaHash,
    snapshotPolicy: jsonClone(source.snapshotPolicy, "INVALID_SNAPSHOT_POLICY")
  };
}

function finalWorldResult(response: GatewayResponse<unknown>, terminal: JsonObject | undefined): JsonObject {
  if (response.status === 200) return object(response.value, "WORLD_QUERY_RESULT_INVALID");
  if (response.status !== 202) throw new SegmentedWorldQueryError("WORLD_QUERY_RESPONSE_STATUS_INVALID");
  return object(object(terminal, "WORLD_QUERY_JOB_INVALID")["result"], "WORLD_QUERY_JOB_RESULT_MISSING");
}

function assignPointer(target: JsonObject, path: string, value: unknown): void {
  if (!/^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/u.test(path)) {
    throw new SegmentedWorldQueryError("SEGMENT_NODE_TARGET_PATH_INVALID");
  }
  const segments = path.slice(1).split("/").map((entry) => entry.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (segments.some((entry) => unsafeTargetSegments.has(entry))) {
    throw new SegmentedWorldQueryError("SEGMENT_NODE_TARGET_PATH_UNSAFE");
  }
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    if (!Object.hasOwn(current, segment)) current[segment] = Object.create(null) as JsonObject;
    current = object(current[segment], "SEGMENT_NODE_TARGET_PATH_COLLISION");
  }
  const leaf = segments.at(-1)!;
  if (Object.hasOwn(current, leaf)) throw new SegmentedWorldQueryError("SEGMENT_NODE_TARGET_PATH_COLLISION");
  current[leaf] = jsonClone(value, "SEGMENT_NODE_INPUT_NOT_JSON");
}

function segmentNodeInput(node: WorldQueryNode, descriptor: CapabilityDescriptor): unknown {
  const entries = Object.entries(node.inputs).map(([name, binding]) => {
    if (binding.kind !== "LITERAL") throw new SegmentedWorldQueryError("SEGMENT_NODE_INPUT_NOT_LITERAL");
    return { name, binding, value: binding.value };
  });
  const wholeRequest = entries.length === 1 && entries[0]?.name === "request" &&
    entries[0].binding.targetPath === undefined && descriptor.ports.inputs.length === 1 &&
    descriptor.ports.inputs[0]?.name === "request";
  if (wholeRequest) return jsonClone(entries[0]!.value, "SEGMENT_NODE_INPUT_NOT_JSON");
  const assembled = Object.create(null) as JsonObject;
  for (const entry of entries) {
    const defaultPath = `/${entry.name.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    assignPointer(assembled, entry.binding.targetPath ?? defaultPath, entry.value);
  }
  return assembled;
}

function validateCapabilityEnvelope(
  envelope: JsonObject,
  node: WorldQueryNode,
  descriptor: CapabilityDescriptor,
  expectedInputHash: Sha256Digest
): void {
  if (envelope["providerProtocolVersion"] !== "1.0") {
    throw new SegmentedWorldQueryError("SEGMENT_PROVIDER_PROTOCOL_INVALID");
  }
  const computeSnapshot = object(envelope["computeSnapshot"], "SEGMENT_COMPUTE_SNAPSHOT_INVALID");
  const computeOperation = object(computeSnapshot["operation"], "SEGMENT_COMPUTE_SNAPSHOT_INVALID");
  const computeSchemas = object(computeSnapshot["schemas"], "SEGMENT_COMPUTE_SNAPSHOT_INVALID");
  const computeProvider = object(computeSnapshot["provider"], "SEGMENT_COMPUTE_SNAPSHOT_INVALID");
  const execution = object(envelope["execution"], "SEGMENT_EXECUTION_AUTHORITY_INVALID");
  if (computeOperation["operationId"] !== node.operation.operationId ||
      computeOperation["operationVersion"] !== node.operation.operationVersion ||
      computeSchemas["inputSchemaHash"] !== node.operation.inputSchemaHash ||
      computeSchemas["outputSchemaHash"] !== node.operation.outputSchemaHash ||
      computeProvider["providerId"] !== execution["providerId"] ||
      computeProvider["providerVersion"] !== execution["providerVersion"]) {
    throw new SegmentedWorldQueryError("SEGMENT_COMPUTE_SNAPSHOT_AUTHORITY_MISMATCH");
  }
  const output = envelope["output"] === undefined ? undefined : object(envelope["output"], "SEGMENT_OUTPUT_INVALID");
  if (output !== undefined && !Object.hasOwn(output, "value")) {
    throw new SegmentedWorldQueryError("SEGMENT_OUTPUT_INVALID");
  }
  const resultHash = output === undefined ? undefined : sha256(output["value"]);
  if (output !== undefined && (output["schemaUri"] !== descriptor.outputSchemaUri ||
      output["schemaHash"] !== descriptor.outputSchemaHash || execution["resultHash"] !== resultHash)) {
    throw new SegmentedWorldQueryError("SEGMENT_OUTPUT_AUTHORITY_MISMATCH");
  }
  if (output === undefined && execution["resultHash"] !== undefined) {
    throw new SegmentedWorldQueryError("SEGMENT_UNBOUND_RESULT_HASH_FORBIDDEN");
  }
  if (!Array.isArray(envelope["receipts"]) || envelope["receipts"].length === 0) {
    throw new SegmentedWorldQueryError("SEGMENT_RECEIPT_REQUIRED");
  }
  const receiptIds = new Set<string>();
  const computeSnapshotHash = sha256(computeSnapshot);
  for (const raw of envelope["receipts"]) {
    const receipt = object(raw, "SEGMENT_RECEIPT_INVALID");
    const receiptId = text(receipt["receiptId"], "SEGMENT_RECEIPT_INVALID");
    if (receiptIds.has(receiptId)) throw new SegmentedWorldQueryError("SEGMENT_RECEIPT_DUPLICATE");
    receiptIds.add(receiptId);
    if (receipt["operationId"] !== node.operation.operationId ||
        receipt["operationVersion"] !== node.operation.operationVersion ||
        receipt["providerId"] !== execution["providerId"] ||
        receipt["providerVersion"] !== execution["providerVersion"] ||
        receipt["inputHash"] !== expectedInputHash ||
        receipt["computeSnapshotHash"] !== computeSnapshotHash ||
        !sha256Pattern.test(String(receipt["outputHash"])) ||
        (resultHash !== undefined && receipt["outputHash"] !== resultHash)) {
      throw new SegmentedWorldQueryError("SEGMENT_RECEIPT_AUTHORITY_MISMATCH");
    }
  }
  if (!Array.isArray(envelope["evidenceReferences"])) {
    throw new SegmentedWorldQueryError("SEGMENT_EVIDENCE_REFERENCES_INVALID");
  }
  const evidenceIds = new Set<string>();
  for (const raw of envelope["evidenceReferences"]) {
    const evidenceId = text(object(raw, "SEGMENT_EVIDENCE_REFERENCE_INVALID")["evidenceId"],
      "SEGMENT_EVIDENCE_REFERENCE_INVALID");
    if (evidenceIds.has(evidenceId) || receiptIds.has(evidenceId)) {
      throw new SegmentedWorldQueryError("SEGMENT_EVIDENCE_ID_COLLISION");
    }
    evidenceIds.add(evidenceId);
  }
}

function validateSegmentWorldResult(
  world: JsonObject,
  submission: WorldQuerySubmission,
  node: WorldQueryNode,
  descriptor: CapabilityDescriptor,
  expectedJobId?: string
): JsonObject {
  if (world["queryPlanVersion"] !== "2.0" || world["queryId"] !== submission.plan.queryId) {
    throw new SegmentedWorldQueryError("SEGMENT_WORLD_QUERY_IDENTITY_MISMATCH");
  }
  if (!successfulWorldStatuses.has(String(world["status"]))) {
    throw new SegmentedWorldQueryError("SEGMENT_WORLD_QUERY_NOT_SUCCESSFUL");
  }
  const worldJobId = text(world["jobId"], "SEGMENT_WORLD_QUERY_JOB_ID_MISSING");
  if (expectedJobId !== undefined && worldJobId !== expectedJobId) {
    throw new SegmentedWorldQueryError("SEGMENT_WORLD_QUERY_JOB_ID_MISMATCH");
  }
  const nodes = world["nodes"];
  if (!Array.isArray(nodes) || nodes.length !== 1) {
    throw new SegmentedWorldQueryError("SEGMENT_WORLD_QUERY_NODE_COUNT_INVALID");
  }
  const result = object(nodes[0], "SEGMENT_WORLD_QUERY_NODE_INVALID");
  const operation = object(result["operation"], "SEGMENT_WORLD_QUERY_OPERATION_MISSING");
  if (result["nodeId"] !== node.nodeId || operation["operationId"] !== node.operation.operationId ||
      operation["operationVersion"] !== node.operation.operationVersion) {
    throw new SegmentedWorldQueryError("SEGMENT_WORLD_QUERY_NODE_IDENTITY_MISMATCH");
  }
  if (!usableNodeStatuses.has(String(result["status"]))) {
    throw new SegmentedWorldQueryError("SEGMENT_WORLD_QUERY_NODE_NOT_SUCCESSFUL");
  }
  const envelope = object(result["result"], "SEGMENT_WORLD_QUERY_RESULT_ENVELOPE_MISSING");
  const envelopeOperation = object(envelope["operation"], "SEGMENT_WORLD_QUERY_ENVELOPE_OPERATION_MISSING");
  const allowedEnvelopeStatuses = result["status"] === "PARTIAL" ? ["PARTIAL", "INDETERMINATE"] : [result["status"]];
  if (envelopeOperation["operationId"] !== node.operation.operationId ||
      envelopeOperation["operationVersion"] !== node.operation.operationVersion ||
      !allowedEnvelopeStatuses.includes(envelope["status"])) {
    throw new SegmentedWorldQueryError("SEGMENT_WORLD_QUERY_ENVELOPE_AUTHORITY_MISMATCH");
  }
  if (result["status"] !== "NO_DATA") {
    const output = object(envelope["output"], "SEGMENT_WORLD_QUERY_OUTPUT_MISSING");
    if (output["schemaHash"] !== node.operation.outputSchemaHash) {
      throw new SegmentedWorldQueryError("SEGMENT_WORLD_QUERY_ENVELOPE_AUTHORITY_MISMATCH");
    }
  }
  const expectedInputHash = sha256(segmentNodeInput(submission.plan.nodes[0]!, descriptor));
  if (result["inputHash"] !== expectedInputHash || result["outputHash"] !== sha256(envelope)) {
    throw new SegmentedWorldQueryError("SEGMENT_WORLD_QUERY_NODE_HASH_MISMATCH");
  }
  validateCapabilityEnvelope(envelope, node, descriptor, expectedInputHash);
  const outputs = object(world["outputs"], "SEGMENT_WORLD_QUERY_OUTPUTS_MISSING");
  if (world["outputHash"] !== sha256(outputs)) {
    throw new SegmentedWorldQueryError("SEGMENT_WORLD_QUERY_OUTPUT_HASH_MISMATCH");
  }
  const frozenResult = jsonFrozenClone(result, "SEGMENT_WORLD_QUERY_NODE_NOT_JSON");
  const expectedOutputs = originalOutputs(submission, new Map([[node.nodeId, frozenResult]]));
  if (canonical(expectedOutputs) !== canonical(outputs)) {
    throw new SegmentedWorldQueryError("SEGMENT_WORLD_QUERY_OUTPUT_BINDING_MISMATCH");
  }
  return frozenResult;
}

function snapshotResourceKey(resource: Readonly<Record<string, unknown>>): string {
  const resourceKind = text(resource["resourceKind"], "SEGMENT_SNAPSHOT_RESOURCE_IDENTITY_MISSING");
  const resourceId = text(resource["resourceId"], "SEGMENT_SNAPSHOT_RESOURCE_IDENTITY_MISSING");
  return `${resourceKind}\u0000${resourceId}`;
}

function validateSegmentSnapshot(
  world: JsonObject,
  nodeId: string,
  policy: WorldQuerySubmission["snapshotPolicy"],
  priorResources: Map<string, string>,
  pinnedManifestHash: string | undefined
): QuerySnapshotManifest {
  let manifest: QuerySnapshotManifest;
  try {
    manifest = parseAndVerifySnapshotManifest(world["snapshotManifest"]);
    const adherence = parseSnapshotAdherence(world["snapshotAdherence"]);
    const assessment = assessWorldSnapshot([nodeId], manifest, adherence, policy);
    if (assessment.gaps.length > 0) throw new SegmentedWorldQueryError("SEGMENT_SNAPSHOT_POLICY_UNSATISFIED");
  } catch (error) {
    if (error instanceof SegmentedWorldQueryError) throw error;
    throw new SegmentedWorldQueryError("SEGMENT_SNAPSHOT_EVIDENCE_INVALID");
  }
  if (pinnedManifestHash !== undefined && manifest.manifestHash !== pinnedManifestHash) {
    throw new SegmentedWorldQueryError("SEGMENT_PINNED_SNAPSHOT_MISMATCH");
  }
  for (const resource of manifest.resources) {
    const key = snapshotResourceKey(resource);
    const digest = sha256(resource);
    const prior = priorResources.get(key);
    if (prior !== undefined && prior !== digest) {
      throw new SegmentedWorldQueryError("SEGMENT_SNAPSHOT_RESOURCE_DRIFT");
    }
    priorResources.set(key, digest);
  }
  return manifest;
}

function originalOutputs(
  submission: WorldQuerySubmission,
  resultByNode: ReadonlyMap<string, Readonly<JsonObject>>
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const output of submission.plan.outputs) {
    if (Object.hasOwn(result, output.name)) throw new SegmentedWorldQueryError("DUPLICATE_PLAN_OUTPUT_NAME");
    result[output.name] = nodeResultValue(resultByNode, output.binding, "NULL");
  }
  return deepFreeze(result);
}

function sourcePlanHash(plan: WorldQueryPlanV2, capabilities: readonly CapabilityDescriptor[]): Sha256Digest {
  dependencies(plan);
  try {
    validateCompiledPlan(plan, capabilities);
    return canonicalPlanHash(plan);
  } catch (error) {
    if (error instanceof SegmentedWorldQueryError) throw error;
    throw new SegmentedWorldQueryError("SOURCE_WORLD_QUERY_PLAN_INVALID");
  }
}

function preflightBindings(submission: WorldQuerySubmission): void {
  const noResults = new Map<string, Readonly<JsonObject>>();
  for (const node of submission.plan.nodes) {
    if (node.failurePolicy === "SKIP_IF_PRECONDITION_FALSE") {
      throw new SegmentedWorldQueryError("SEGMENT_PRECONDITION_POLICY_UNSUPPORTED");
    }
    segmentOutputs(submission.plan, node.nodeId);
    for (const binding of Object.values(node.inputs)) {
      if (binding.kind === "NODE_OUTPUT") continue;
      resolveInputBinding(submission, noResults, binding);
    }
  }
}

function validateAuthority(authority: SegmentedScopeAuthority): void {
  try {
    assertLoadedSegmentedScopeAuthority(authority);
  } catch (error) {
    if (error instanceof SegmentedScopeAuthorityError) {
      throw new SegmentedWorldQueryError(error.code);
    }
    throw error;
  }
}

function validateIdentity(value: GroundingIdentityV2): void {
  let expected: string;
  try {
    expected = authorizationContextHash({
      servicePrincipalId: value.servicePrincipalId,
      actorId: value.actorId,
      dataScopes: value.dataScopes,
      datasetScopes: value.datasetScopes,
      permissions: value.permissions
    });
  } catch {
    throw new SegmentedWorldQueryError("SEGMENTED_IDENTITY_INVALID");
  }
  if (expected !== value.authorizationContextHash) {
    throw new SegmentedWorldQueryError("SEGMENTED_IDENTITY_AUTHORIZATION_HASH_MISMATCH");
  }
}

function validateSignedSegment(
  signed: SignedDelegation,
  identity: GroundingIdentityV2,
  binding: SegmentedOperationScopeBinding,
  node: WorldQueryNode
): void {
  const expectedOperation = operationKey(node.operation);
  if (!compactJwsPattern.test(signed.token) || !sha256Pattern.test(signed.jtiHash) ||
      signed.dataScopes.length !== 1 || signed.dataScopes[0] !== binding.dataScope ||
      canonical(signed.datasetScopes) !== canonical(identity.datasetScopes) ||
      signed.allowedOperations.length !== 1 || signed.allowedOperations[0] !== expectedOperation ||
      signed.authorizationContextHash !== identity.authorizationContextHash) {
    throw new SegmentedWorldQueryError("SEGMENT_DELEGATION_AUTHORITY_MISMATCH");
  }
}

export async function executeSegmentedWorldQuery(
  input: ExecuteSegmentedWorldQueryInput
): Promise<SegmentedWorldQueryExecution> {
  validateAuthority(input.authority);
  const sourceSubmission = jsonFrozenClone(input.submission, "SOURCE_WORLD_QUERY_SUBMISSION_INVALID");
  // Independent per-scope Gateway submissions cannot prove that every segment
  // observed one shared "latest" instant. Preserve the caller's strict
  // LATEST_AT_START contract by refusing segmented execution until an
  // authoritative cross-scope snapshot mechanism exists.
  if (sourceSubmission.snapshotPolicy.mode === "LATEST_AT_START") {
    throw new SegmentedWorldQueryError("SEGMENT_LATEST_AT_START_UNSUPPORTED");
  }
  const executionIdentity = jsonFrozenClone(input.identity, "SEGMENTED_IDENTITY_INVALID");
  const capabilities = jsonFrozenClone(input.capabilities, "SEGMENTED_CAPABILITY_CATALOG_INVALID");
  validateIdentity(executionIdentity);
  if (!(input.deadlineAt instanceof Date) || !Number.isFinite(input.deadlineAt.getTime()) ||
      input.deadlineAt.getTime() <= Date.now()) {
    throw new SegmentedWorldQueryError("SEGMENTED_WORLD_QUERY_DEADLINE_INVALID");
  }
  const authorizedScopes = new Set(executionIdentity.dataScopes);
  if (input.authority.requiredDataScopes.some((dataScope) => !authorizedScopes.has(dataScope))) {
    throw new SegmentedWorldQueryError("IDENTITY_MISSING_REQUIRED_DATA_SCOPE");
  }
  const ordered = topologicalNodes(sourceSubmission.plan);
  for (const node of ordered) operationBinding(input.authority, node);
  const sourceHash = sourcePlanHash(sourceSubmission.plan, capabilities);
  preflightBindings(sourceSubmission);

  let pinnedManifestHash: string | undefined;
  if (sourceSubmission.snapshotPolicy.mode === "PINNED") {
    try {
      pinnedManifestHash = parseAndVerifySnapshotManifest(sourceSubmission.snapshotPolicy.pinnedSnapshot).manifestHash;
    } catch {
      throw new SegmentedWorldQueryError("SEGMENT_PINNED_SNAPSHOT_INVALID");
    }
  }

  const now = input.runtime.now ?? (() => new Date());
  const resultByNode = new Map<string, Readonly<JsonObject>>();
  const snapshotResources = new Map<string, string>();
  const descriptors = new Map(capabilities.map((descriptor) => [operationKey(descriptor), descriptor]));
  const segments: SegmentedWorldQuerySegment[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const node = ordered[index]!;
    const authority = operationBinding(input.authority, node);
    const descriptor = descriptors.get(operationKey(node.operation));
    if (!descriptor) throw new SegmentedWorldQueryError("SEGMENT_CAPABILITY_DESCRIPTOR_MISSING");
    const submission = jsonFrozenClone(
      singleNodeSubmission(sourceSubmission, node, index, resultByNode),
      "SEGMENT_WORLD_QUERY_SUBMISSION_INVALID"
    );
    const signed = await input.runtime.signer.sign({
      kind: "WORLD_QUERY",
      identity: executionIdentity,
      requestId: submission.requestId,
      plan: submission.plan,
      dataScopes: [authority.dataScope],
      datasetScopes: executionIdentity.datasetScopes
    });
    validateSignedSegment(signed, executionIdentity, authority, node);
    const context: GatewayRequestContext = {
      deadlineAt: input.deadlineAt,
      requestId: submission.requestId,
      delegationToken: signed.token,
      preferAsync: true,
      ...(input.signal === undefined ? {} : { signal: input.signal })
    };
    const startedAt = now().toISOString();
    const response = await input.runtime.gateway.submitWorldQuery(submission as unknown as JsonObject, context);
    const rawResponse = jsonFrozenClone(
      object(response.value, "SEGMENT_GATEWAY_RESPONSE_INVALID"),
      "SEGMENT_GATEWAY_RESPONSE_NOT_JSON"
    );
    let terminal: JsonObject | undefined;
    if (response.status === 202) {
      if (rawResponse["requestId"] !== submission.requestId || rawResponse["kind"] !== "WORLD_QUERY" ||
          rawResponse["queryId"] !== submission.plan.queryId ||
          !["QUEUED", "RUNNING"].includes(String(rawResponse["status"]))) {
        throw new SegmentedWorldQueryError("SEGMENT_GATEWAY_ACCEPTANCE_IDENTITY_MISMATCH");
      }
      const accepted: AcceptedSegmentCheckpoint = Object.freeze({
        nodeId: node.nodeId,
        operationKey: operationKey(node.operation),
        dataScope: authority.dataScope,
        submission,
        delegatedIdentityHash: signed.jtiHash,
        responseStatus: 202,
        acceptance: rawResponse
      });
      const jobId = text(rawResponse["jobId"], "SEGMENT_GATEWAY_JOB_ID_MISSING");
      await input.runtime.onAccepted(accepted);
      try {
        terminal = jsonFrozenClone(
          await input.runtime.gateway.pollJob(jobId, context),
          "SEGMENT_GATEWAY_TERMINAL_NOT_JSON"
        );
      } catch (error) {
        // A transient polling failure remains resumable through the exact
        // idempotency key. Once the caller has cancelled or the hard deadline
        // has elapsed, use a fresh delegation to avoid leaving an orphan job.
        if (input.signal?.aborted || Date.now() >= input.deadlineAt.getTime()) {
          try {
            const cancelRequestId = boundedIdentifier(
              submission.requestId,
              `:cancel:${createHash("sha256").update(`${signed.jtiHash}:${jobId}`).digest("hex").slice(0, 20)}`
            );
            const cancelSigned = await input.runtime.signer.sign({
              kind: "WORLD_QUERY",
              identity: executionIdentity,
              requestId: cancelRequestId,
              plan: submission.plan,
              dataScopes: [authority.dataScope],
              datasetScopes: executionIdentity.datasetScopes
            });
            validateSignedSegment(cancelSigned, executionIdentity, authority, node);
            await input.runtime.gateway.cancelWorldQuery(submission.plan.queryId, {
              requestId: cancelRequestId,
              delegationToken: cancelSigned.token,
              deadlineAt: new Date(Date.now() + 2_000)
            });
          } catch {
            // The durable local acceptance checkpoint remains authoritative;
            // cancellation is best effort and cannot weaken its recovery fence.
          }
        }
        throw error;
      }
      if (terminal["jobId"] !== jobId || terminal["requestId"] !== submission.requestId ||
          terminal["kind"] !== "WORLD_QUERY" || terminal["queryId"] !== submission.plan.queryId) {
        throw new SegmentedWorldQueryError("SEGMENT_GATEWAY_TERMINAL_IDENTITY_MISMATCH");
      }
      if (terminal["status"] !== "COMPLETED" && terminal["status"] !== "PARTIAL") {
        throw new SegmentedWorldQueryError("SEGMENT_GATEWAY_JOB_NOT_SUCCESSFUL");
      }
    } else if (response.status !== 200) {
      throw new SegmentedWorldQueryError("SEGMENT_GATEWAY_RESPONSE_STATUS_INVALID");
    }
    const world = jsonFrozenClone(finalWorldResult(response, terminal), "SEGMENT_WORLD_QUERY_RESULT_NOT_JSON");
    const nodeResult = validateSegmentWorldResult(
      world,
      submission,
      node,
      descriptor,
      response.status === 202 ? text(rawResponse["jobId"], "SEGMENT_GATEWAY_JOB_ID_MISSING") : undefined
    );
    validateSegmentSnapshot(world, node.nodeId, sourceSubmission.snapshotPolicy, snapshotResources, pinnedManifestHash);
    resultByNode.set(node.nodeId, nodeResult);
    const segment: SegmentedWorldQuerySegment = Object.freeze({
      nodeId: node.nodeId,
      operationKey: operationKey(node.operation),
      dataScope: authority.dataScope,
      sourceLockHash: authority.sourceLockHash,
      submission,
      delegatedIdentityHash: signed.jtiHash,
      responseStatus: response.status,
      response: rawResponse,
      ...(terminal === undefined ? {} : { terminal }),
      worldResult: world,
      nodeResult,
      startedAt,
      finishedAt: now().toISOString()
    });
    segments.push(segment);
    await input.runtime.onCompleted?.(Object.freeze({
      nodeId: segment.nodeId,
      operationKey: segment.operationKey,
      dataScope: segment.dataScope,
      sourceLockHash: segment.sourceLockHash,
      submission: segment.submission,
      delegatedIdentityHash: segment.delegatedIdentityHash,
      responseStatus: segment.responseStatus,
      response: segment.response,
      worldResult: segment.worldResult,
      ...(segment.terminal === undefined ? {} : { terminal: segment.terminal }),
      startedAt: segment.startedAt,
      finishedAt: segment.finishedAt
    }));
  }
  const outputs = originalOutputs(sourceSubmission, resultByNode);
  const status = segments.some((segment) => segment.worldResult["status"] === "PARTIAL" ||
    segment.nodeResult["status"] === "PARTIAL") ? "PARTIAL" as const : "COMPLETED" as const;
  const hashPreimage = {
    schemaVersion: "wsgs-segmented-world-query-execution/1.0" as const,
    executionMode: "GATEWAY_SEGMENTED_BY_TRUSTED_DATA_SCOPE" as const,
    sourceQueryId: sourceSubmission.plan.queryId,
    sourcePlanHash: sourceHash,
    scopeAuthorityHash: input.authority.authorityHash,
    status,
    segments: deepFreeze(segments),
    nodeResults: deepFreeze([...resultByNode.values()]),
    outputs
  };
  return deepFreeze({
    ...hashPreimage,
    segmentedExecutionHash: sha256(hashPreimage)
  });
}
