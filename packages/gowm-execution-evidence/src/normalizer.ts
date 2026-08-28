import { canonicalSha256 } from "./canonical.js";
import { ExecutionEvidenceError } from "./errors.js";
import { boundPayload } from "./payload.js";
import { evidenceProductKindForOperation, selectRequestedEvidenceProducts } from "./products.js";
import {
  assessDirectSnapshot,
  assessWorldSnapshot,
  parseAndVerifySnapshotManifest,
  parseSnapshotAdherence
} from "./snapshot.js";
import type {
  AuthoritativePayloadObjectReference,
  DirectExecutionNormalizationInput,
  EvidenceProductKind,
  ExecutionContractTrace,
  ExecutionEvidenceProduct,
  ExecutionEvidenceProductBody,
  ExecutionNormalizationContext,
  GatewayTransportTrace,
  GowmExecutionRecord,
  NormalizedExecutionEvidenceItem,
  NormalizedExecutionStatus,
  OperationExecutionContractTrace,
  PayloadStorage,
  QuerySnapshotAdherence,
  Sha256Digest,
  SnapshotGap,
  WorldQueryExecutionNormalizationInput
} from "./types.js";
import {
  assertUnique,
  cloneObject,
  compareText,
  deepFreeze,
  digest,
  identifier,
  nonEmptyString,
  object,
  operationId,
  operationVersion,
  stringArray,
  timestamp,
  validateContext
} from "./validation.js";

const envelopeKeys = new Set([
  "providerProtocolVersion", "requestId", "operation", "status", "output", "dataSnapshot", "computeSnapshot",
  "receipts", "evidenceReferences", "warnings", "consumption", "execution", "error"
]);
const worldResultKeys = new Set([
  "queryPlanVersion", "queryId", "jobId", "status", "nodes", "outputs", "warnings",
  "snapshotManifest", "snapshotAdherence", "startedAt", "finishedAt", "outputHash"
]);
const worldNodeKeys = new Set([
  "nodeId", "operation", "providerId", "status", "attempt", "startedAt", "finishedAt",
  "inputHash", "outputHash", "result", "error"
]);
const upstreamCapabilityStatuses = new Set(["COMPLETED", "PARTIAL", "NO_DATA", "INDETERMINATE", "FAILED"]);
const terminalJobStatuses = new Set(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]);
const worldNodeStatuses = new Set(["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "NO_DATA", "SKIPPED", "FAILED", "CANCELLED"]);
const availabilityStatuses = new Set(["AVAILABLE", "DEGRADED", "UNAVAILABLE", "DISABLED"]);

interface ParsedReceipt {
  readonly id: string;
  readonly value: Readonly<Record<string, unknown>>;
}

interface ParsedEvidenceReference {
  readonly id: string;
  readonly value: Readonly<Record<string, unknown>>;
}

interface ParsedCapabilityEnvelope {
  readonly status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE" | "FAILED";
  readonly dataSnapshot?: Readonly<Record<string, unknown>>;
  readonly computeSnapshot: Readonly<Record<string, unknown>>;
  readonly receipts: readonly ParsedReceipt[];
  readonly evidenceReferences: readonly ParsedEvidenceReference[];
  readonly warnings: readonly string[];
  readonly resultHash?: Sha256Digest;
  readonly payload: PayloadStorage;
  readonly evidenceItem?: NormalizedExecutionEvidenceItem;
}

interface ParsedGatewayJob {
  readonly jobId: string;
  readonly kind: "DIRECT_OPERATION" | "WORLD_QUERY";
  readonly status: string;
  readonly queryId?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly result?: unknown;
}

interface ResolvedOutcome {
  readonly result?: unknown;
  readonly transport: GatewayTransportTrace;
  readonly gatewayJobId?: string;
  readonly gatewayQueryId?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly terminalStatus?: string;
}

interface ParsedWorldNode {
  readonly nodeId: string;
  readonly operationId: string;
  readonly operationVersion: string;
  readonly status: string;
  readonly inputHash?: Sha256Digest;
  readonly outputHash?: Sha256Digest;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly result?: unknown;
}

interface ParsedWorldResult {
  readonly queryId: string;
  readonly jobId: string;
  readonly status: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
  readonly nodes: readonly ParsedWorldNode[];
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly warnings: readonly string[];
  readonly snapshotManifest: ReturnType<typeof parseAndVerifySnapshotManifest>;
  readonly snapshotAdherence: readonly QuerySnapshotAdherence[];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly outputHash: Sha256Digest;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareText);
}

function validateOperationTrace(trace: OperationExecutionContractTrace): OperationExecutionContractTrace {
  if (trace.nodeId !== undefined) identifier(trace.nodeId, "INVALID_IDENTIFIER");
  operationId(trace.operationId, "OPERATION_IDENTITY_MISMATCH");
  operationVersion(trace.operationVersion, "OPERATION_IDENTITY_MISMATCH");
  digest(trace.inputSchemaHash);
  digest(trace.outputSchemaHash);
  digest(trace.semanticProfileHash);
  nonEmptyString(trace.outputSchemaUri, "OUTPUT_SCHEMA_MISMATCH");
  nonEmptyString(trace.negativeEvidencePolicy, "INVALID_GATEWAY_ENVELOPE");
  if (!availabilityStatuses.has(trace.availability.availability)) {
    throw new ExecutionEvidenceError("INVALID_GATEWAY_ENVELOPE");
  }
  timestamp(trace.availability.checkedAt);
  for (const reason of trace.availability.reasonCodes) nonEmptyString(reason, "INVALID_GATEWAY_ENVELOPE");
  assertUnique(trace.availability.reasonCodes, "INVALID_GATEWAY_ENVELOPE");
  return structuredClone(trace);
}

function availabilityWarnings(trace: OperationExecutionContractTrace): readonly string[] {
  if (trace.availability.availability === "AVAILABLE") return [];
  return uniqueSorted([
    `AVAILABILITY_${trace.availability.availability}_AT_COMPILE`,
    ...trace.availability.reasonCodes.map((reason) => `AVAILABILITY_REASON:${reason}`)
  ]);
}

function parseReceipt(
  value: unknown,
  trace: OperationExecutionContractTrace,
  computeSnapshot: Readonly<Record<string, unknown>>,
  resultHash: Sha256Digest | undefined,
  expectedInputHash: Sha256Digest | undefined
): ParsedReceipt {
  const raw = object(value, "INVALID_RECEIPT");
  const id = identifier(raw["receiptId"], "INVALID_RECEIPT");
  if (raw["operationId"] !== trace.operationId || raw["operationVersion"] !== trace.operationVersion) {
    throw new ExecutionEvidenceError("INVALID_RECEIPT");
  }
  if (digest(raw["computeSnapshotHash"], "RECEIPT_HASH_MISMATCH") !== canonicalSha256(computeSnapshot)) {
    throw new ExecutionEvidenceError("RECEIPT_HASH_MISMATCH");
  }
  const outputHash = digest(raw["outputHash"], "RECEIPT_HASH_MISMATCH");
  if (resultHash !== undefined && outputHash !== resultHash) {
    throw new ExecutionEvidenceError("RECEIPT_HASH_MISMATCH");
  }
  const inputHash = digest(raw["inputHash"], "RECEIPT_HASH_MISMATCH");
  if (expectedInputHash !== undefined && inputHash !== expectedInputHash) {
    throw new ExecutionEvidenceError("RECEIPT_HASH_MISMATCH");
  }
  timestamp(raw["generatedAt"], "INVALID_RECEIPT");
  const providerId = nonEmptyString(raw["providerId"], "INVALID_RECEIPT");
  const providerVersion = nonEmptyString(raw["providerVersion"], "INVALID_RECEIPT");
  const computeProvider = object(computeSnapshot["provider"], "COMPUTE_SNAPSHOT_MISMATCH");
  if (computeProvider["providerId"] !== providerId || computeProvider["providerVersion"] !== providerVersion) {
    throw new ExecutionEvidenceError("INVALID_RECEIPT");
  }
  return { id, value: structuredClone(raw) };
}

function parseEvidenceReference(value: unknown): ParsedEvidenceReference {
  const raw = object(value, "INVALID_EVIDENCE_REFERENCE");
  const id = identifier(raw["evidenceId"], "INVALID_EVIDENCE_REFERENCE");
  nonEmptyString(raw["authority"], "INVALID_EVIDENCE_REFERENCE");
  nonEmptyString(raw["evidenceType"], "INVALID_EVIDENCE_REFERENCE");
  nonEmptyString(raw["schemaUri"], "INVALID_EVIDENCE_REFERENCE");
  digest(raw["schemaHash"], "INVALID_EVIDENCE_REFERENCE");
  return { id, value: structuredClone(raw) };
}

function evidenceId(
  executionId: string,
  trace: OperationExecutionContractTrace,
  status: string,
  resultHash: Sha256Digest | undefined,
  evidenceIds: readonly string[]
): string {
  return `evidence-${canonicalSha256({
    executionId,
    nodeId: trace.nodeId ?? null,
    operationId: trace.operationId,
    operationVersion: trace.operationVersion,
    status,
    resultHash: resultHash ?? null,
    evidenceIds
  }).slice(7, 39)}`;
}

function parseCapabilityEnvelope(
  value: unknown,
  traceInput: OperationExecutionContractTrace,
  executionId: string,
  maximumInlineBytes: number,
  objectReference: AuthoritativePayloadObjectReference | undefined,
  expectedInputHash?: Sha256Digest
): ParsedCapabilityEnvelope {
  const trace = validateOperationTrace(traceInput);
  const envelope = object(value, "INVALID_GATEWAY_ENVELOPE");
  if (Object.keys(envelope).some((key) => !envelopeKeys.has(key))) {
    throw new ExecutionEvidenceError("UNKNOWN_GATEWAY_ENVELOPE_FIELD");
  }
  if (envelope["providerProtocolVersion"] !== "1.0") throw new ExecutionEvidenceError("INVALID_GATEWAY_ENVELOPE");
  const operation = object(envelope["operation"], "INVALID_GATEWAY_ENVELOPE");
  if (operation["operationId"] !== trace.operationId || operation["operationVersion"] !== trace.operationVersion) {
    throw new ExecutionEvidenceError("OPERATION_IDENTITY_MISMATCH");
  }
  const status = nonEmptyString(envelope["status"], "INVALID_UPSTREAM_STATUS") as ParsedCapabilityEnvelope["status"];
  if (!upstreamCapabilityStatuses.has(status)) throw new ExecutionEvidenceError("INVALID_UPSTREAM_STATUS");

  const output = envelope["output"] === undefined ? undefined : object(envelope["output"], "OUTPUT_SCHEMA_MISMATCH");
  if (["COMPLETED", "PARTIAL"].includes(status) && output === undefined) {
    throw new ExecutionEvidenceError("OUTPUT_REQUIRED");
  }
  if (status === "FAILED" && output !== undefined) throw new ExecutionEvidenceError("OUTPUT_FORBIDDEN");
  if (output !== undefined
    && (output["schemaUri"] !== trace.outputSchemaUri || output["schemaHash"] !== trace.outputSchemaHash)) {
    throw new ExecutionEvidenceError("OUTPUT_SCHEMA_MISMATCH");
  }

  const computeSnapshot = cloneObject(envelope["computeSnapshot"], "COMPUTE_SNAPSHOT_MISMATCH");
  const computeOperation = object(computeSnapshot["operation"], "COMPUTE_SNAPSHOT_MISMATCH");
  const computeSchemas = object(computeSnapshot["schemas"], "COMPUTE_SNAPSHOT_MISMATCH");
  if (computeOperation["operationId"] !== trace.operationId
    || computeOperation["operationVersion"] !== trace.operationVersion
    || computeSchemas["inputSchemaHash"] !== trace.inputSchemaHash
    || computeSchemas["outputSchemaHash"] !== trace.outputSchemaHash) {
    throw new ExecutionEvidenceError("COMPUTE_SNAPSHOT_MISMATCH");
  }
  const execution = object(envelope["execution"], "INVALID_GATEWAY_ENVELOPE");
  const computeProvider = object(computeSnapshot["provider"], "COMPUTE_SNAPSHOT_MISMATCH");
  if (computeProvider["providerId"] !== execution["providerId"]
    || computeProvider["providerVersion"] !== execution["providerVersion"]) {
    throw new ExecutionEvidenceError("COMPUTE_SNAPSHOT_MISMATCH");
  }

  const resultHash = output === undefined
    ? (execution["resultHash"] === undefined ? undefined : digest(execution["resultHash"], "UPSTREAM_RESULT_HASH_MISMATCH"))
    : canonicalSha256(output["value"]);
  if (output !== undefined && execution["resultHash"] !== resultHash) {
    throw new ExecutionEvidenceError("UPSTREAM_RESULT_HASH_MISMATCH");
  }

  if (!Array.isArray(envelope["receipts"]) || envelope["receipts"].length > 256) {
    throw new ExecutionEvidenceError("INVALID_RECEIPT");
  }
  if (status !== "FAILED" && envelope["receipts"].length === 0) {
    throw new ExecutionEvidenceError("RECEIPT_REQUIRED");
  }
  const receipts = envelope["receipts"].map((receipt) => parseReceipt(
    receipt,
    trace,
    computeSnapshot,
    resultHash,
    expectedInputHash
  ));
  assertUnique(receipts.map((receipt) => receipt.id), "DUPLICATE_RECEIPT_ID");

  if (!Array.isArray(envelope["evidenceReferences"]) || envelope["evidenceReferences"].length > 1000) {
    throw new ExecutionEvidenceError("INVALID_EVIDENCE_REFERENCE");
  }
  const evidenceReferences = envelope["evidenceReferences"].map(parseEvidenceReference);
  assertUnique(evidenceReferences.map((reference) => reference.id), "DUPLICATE_EVIDENCE_ID");
  const receiptIds = receipts.map((receipt) => receipt.id);
  const evidenceIds = evidenceReferences.map((reference) => reference.id);
  if (receiptIds.some((id) => evidenceIds.includes(id))) {
    throw new ExecutionEvidenceError("RECEIPT_EVIDENCE_ID_COLLISION");
  }
  const warnings = uniqueSorted([
    ...stringArray(envelope["warnings"], 256, "INVALID_GATEWAY_ENVELOPE"),
    ...availabilityWarnings(trace)
  ]);
  const dataSnapshot = envelope["dataSnapshot"] === undefined
    ? undefined
    : cloneObject(envelope["dataSnapshot"], "INVALID_GATEWAY_ENVELOPE");
  const payload: PayloadStorage = output === undefined
    ? {
        kind: "NONE",
        reason: status === "NO_DATA" ? "NO_DATA"
          : status === "INDETERMINATE" ? "INDETERMINATE"
            : status === "FAILED" ? "FAILED" : "NO_OUTPUT"
      }
    : boundPayload(output["value"], maximumInlineBytes, objectReference);
  const unknowns = status === "NO_DATA" ? ["NO_DATA"]
    : status === "INDETERMINATE" ? ["INDETERMINATE"]
      : status === "PARTIAL" ? ["PARTIAL_RESULT"] : [];
  const evidenceItem = status === "FAILED" ? undefined : {
    evidenceProductId: evidenceId(executionId, trace, status, resultHash, evidenceIds),
    productKind: evidenceProductKindForOperation(trace.operationId),
    executionId,
    sourceOperation: trace.operationId,
    ...(trace.nodeId === undefined ? {} : { sourceNodeId: trace.nodeId }),
    upstreamStatus: status,
    payloadSchemaUri: trace.outputSchemaUri,
    payloadSchemaHash: trace.outputSchemaHash,
    payload,
    ...(dataSnapshot === undefined ? {} : { dataSnapshot }),
    computeSnapshot,
    receiptIds: uniqueSorted(receiptIds),
    evidenceIds: uniqueSorted(evidenceIds),
    unknowns,
    warnings,
    contractTrace: trace
  } satisfies NormalizedExecutionEvidenceItem;

  return {
    status,
    ...(dataSnapshot === undefined ? {} : { dataSnapshot }),
    computeSnapshot,
    receipts,
    evidenceReferences,
    warnings,
    ...(resultHash === undefined ? {} : { resultHash }),
    payload,
    ...(evidenceItem === undefined ? {} : { evidenceItem })
  };
}

function parseJob(value: unknown): ParsedGatewayJob {
  const raw = object(value, "INVALID_GATEWAY_JOB");
  const kind = raw["kind"];
  if (kind !== "DIRECT_OPERATION" && kind !== "WORLD_QUERY") throw new ExecutionEvidenceError("INVALID_GATEWAY_JOB");
  return {
    jobId: identifier(raw["jobId"], "INVALID_GATEWAY_JOB"),
    kind,
    status: nonEmptyString(raw["status"], "INVALID_GATEWAY_JOB"),
    ...(raw["queryId"] === undefined ? {} : { queryId: identifier(raw["queryId"], "INVALID_GATEWAY_JOB") }),
    ...(raw["startedAt"] === undefined ? {} : { startedAt: timestamp(raw["startedAt"], "INVALID_GATEWAY_JOB") }),
    ...(raw["finishedAt"] === undefined ? {} : { finishedAt: timestamp(raw["finishedAt"], "INVALID_GATEWAY_JOB") }),
    ...(raw["result"] === undefined ? {} : { result: raw["result"] })
  };
}

function resolveOutcome(
  outcome: DirectExecutionNormalizationInput["outcome"] | WorldQueryExecutionNormalizationInput["outcome"],
  expectedKind: "DIRECT_OPERATION" | "WORLD_QUERY"
): ResolvedOutcome {
  if (outcome.mode === "SYNC") {
    return { result: outcome.result, transport: { mode: "SYNC", responseStatus: 200 } };
  }
  const accepted = parseJob(outcome.acceptedJob);
  const terminal = parseJob(outcome.terminalJob);
  if (accepted.jobId !== terminal.jobId) throw new ExecutionEvidenceError("GATEWAY_JOB_ID_MISMATCH");
  if (accepted.kind !== expectedKind || terminal.kind !== expectedKind) {
    throw new ExecutionEvidenceError("GATEWAY_JOB_KIND_MISMATCH");
  }
  if (!terminalJobStatuses.has(terminal.status)) throw new ExecutionEvidenceError("GATEWAY_JOB_NOT_TERMINAL");
  if (accepted.queryId !== undefined && terminal.queryId !== undefined && accepted.queryId !== terminal.queryId) {
    throw new ExecutionEvidenceError("WORLD_QUERY_IDENTITY_MISMATCH");
  }
  if (["COMPLETED", "PARTIAL"].includes(terminal.status) && terminal.result === undefined) {
    throw new ExecutionEvidenceError("GATEWAY_JOB_RESULT_MISSING");
  }
  return {
    ...(terminal.result === undefined ? {} : { result: terminal.result }),
    transport: {
      mode: "ASYNC",
      responseStatus: 202,
      gatewayJobId: terminal.jobId,
      terminalJobStatus: terminal.status
    },
    gatewayJobId: terminal.jobId,
    ...(terminal.queryId === undefined ? {} : { gatewayQueryId: terminal.queryId }),
    ...(terminal.startedAt === undefined ? {} : { startedAt: terminal.startedAt }),
    ...(terminal.finishedAt === undefined ? {} : { finishedAt: terminal.finishedAt }),
    terminalStatus: terminal.status
  };
}

function normalizedCapabilityStatus(status: ParsedCapabilityEnvelope["status"]): NormalizedExecutionStatus {
  return status;
}

function normalizedTerminalStatus(status: string): NormalizedExecutionStatus {
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "FAILED") return "FAILED";
  if (status === "PARTIAL") return "PARTIAL";
  if (status === "COMPLETED") return "COMPLETED";
  throw new ExecutionEvidenceError("GATEWAY_JOB_NOT_TERMINAL");
}

function contractTrace(
  context: ExecutionNormalizationContext,
  operations: readonly OperationExecutionContractTrace[],
  manifestHash?: Sha256Digest
): ExecutionContractTrace {
  const ordered = operations
    .map((operation) => validateOperationTrace(operation))
    .sort((left, right) => compareText(
      `${left.nodeId ?? ""}:${left.operationId}@${left.operationVersion}`,
      `${right.nodeId ?? ""}:${right.operationId}@${right.operationVersion}`
    ));
  return {
    contractCatalogRevision: context.contractCatalogRevision,
    bindingRevision: context.bindingRevision,
    authorizationContextHash: context.authorizationContextHash,
    delegatedIdentityHash: context.delegatedIdentityHash,
    operations: ordered,
    ...(manifestHash === undefined ? {} : { querySnapshotManifestHash: manifestHash }),
    availabilityObservedAt: uniqueSorted(ordered.map((operation) => timestamp(operation.availability.checkedAt)))
  };
}

function assertIdentitySeparation(
  modelReceiptIds: readonly string[],
  receiptIds: readonly string[],
  evidenceIds: readonly string[]
): void {
  if (receiptIds.some((id) => evidenceIds.includes(id))) {
    throw new ExecutionEvidenceError("RECEIPT_EVIDENCE_ID_COLLISION");
  }
  if (modelReceiptIds.some((id) => receiptIds.includes(id) || evidenceIds.includes(id))) {
    throw new ExecutionEvidenceError("MODEL_RECEIPT_COLLISION");
  }
}

function finish(body: ExecutionEvidenceProductBody): ExecutionEvidenceProduct {
  return deepFreeze({ ...body, productHash: canonicalSha256(body) });
}

function failedDirectProduct(
  input: DirectExecutionNormalizationInput,
  resolved: ResolvedOutcome,
  validated: ReturnType<typeof validateContext>,
  requestHash: Sha256Digest
): ExecutionEvidenceProduct {
  const normalizedStatus = normalizedTerminalStatus(resolved.terminalStatus ?? "FAILED");
  const startedAt = resolved.startedAt ?? validated.startedAt;
  const finishedAt = resolved.finishedAt ?? validated.finishedAt;
  if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new ExecutionEvidenceError("INVALID_TIME_RANGE");
  const record: GowmExecutionRecord = {
    executionId: input.context.executionId,
    groundingId: input.context.groundingId,
    executionKind: "DIRECT_OPERATION",
    operationId: input.operation.operationId,
    operationVersion: input.operation.operationVersion,
    ...(resolved.gatewayJobId === undefined ? {} : { gatewayJobId: resolved.gatewayJobId }),
    requestHash,
    normalizedStatus,
    upstreamStatus: resolved.terminalStatus ?? normalizedStatus,
    receiptIds: [],
    evidenceIds: [],
    startedAt,
    finishedAt
  };
  const selected = selectRequestedEvidenceProducts([], input.context.requestedProducts);
  return finish({
    record,
    nodeRecords: [],
    evidenceItems: selected.evidenceItems,
    gowmReceipts: [],
    modelReceiptIds: validated.modelReceiptIds,
    evidenceReferences: [],
    contractTrace: contractTrace(input.context, [input.operation]),
    snapshotAdherence: [],
    snapshotGaps: [],
    requestedProductGaps: selected.gaps,
    warnings: [],
    unknowns: [],
    transport: resolved.transport
  });
}

export function normalizeDirectExecution(input: DirectExecutionNormalizationInput): ExecutionEvidenceProduct {
  const validated = validateContext(input.context);
  const trace = validateOperationTrace(input.operation);
  const requestHash = canonicalSha256(input.context.requestPayload);
  const resolved = resolveOutcome(input.outcome, "DIRECT_OPERATION");
  if (resolved.result === undefined || resolved.terminalStatus === "CANCELLED") {
    return failedDirectProduct(input, resolved, validated, requestHash);
  }
  const request = object(input.context.requestPayload, "INVALID_GATEWAY_ENVELOPE");
  if (!("input" in request)) throw new ExecutionEvidenceError("INVALID_GATEWAY_ENVELOPE");
  const expectedInputHash = canonicalSha256(request["input"]);
  const parsed = parseCapabilityEnvelope(
    resolved.result,
    trace,
    input.context.executionId,
    validated.maximumInlinePayloadBytes,
    input.context.payloadObjectReferences?.["DIRECT_RESULT"],
    expectedInputHash
  );
  if (resolved.terminalStatus === "PARTIAL" && parsed.status !== "PARTIAL"
    || resolved.terminalStatus === "COMPLETED" && !["COMPLETED", "NO_DATA", "INDETERMINATE"].includes(parsed.status)
    || resolved.terminalStatus === "FAILED" && parsed.status !== "FAILED") {
    throw new ExecutionEvidenceError("GATEWAY_JOB_RESULT_STATUS_MISMATCH");
  }
  const snapshot = parsed.status === "FAILED"
    ? { gaps: [] as readonly SnapshotGap[], warnings: [] as readonly string[] }
    : assessDirectSnapshot(parsed.dataSnapshot, input.snapshotExpectation);
  let normalizedStatus = normalizedCapabilityStatus(parsed.status);
  if (snapshot.gaps.length > 0 && !["FAILED", "CANCELLED"].includes(normalizedStatus)) normalizedStatus = "PARTIAL";
  const receiptIds = parsed.receipts.map((receipt) => receipt.id);
  const evidenceIds = parsed.evidenceReferences.map((reference) => reference.id);
  assertIdentitySeparation(validated.modelReceiptIds, receiptIds, evidenceIds);
  const startedAt = resolved.startedAt ?? validated.startedAt;
  const finishedAt = resolved.finishedAt ?? validated.finishedAt;
  if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new ExecutionEvidenceError("INVALID_TIME_RANGE");
  const record: GowmExecutionRecord = {
    executionId: input.context.executionId,
    groundingId: input.context.groundingId,
    executionKind: "DIRECT_OPERATION",
    operationId: trace.operationId,
    operationVersion: trace.operationVersion,
    ...(resolved.gatewayJobId === undefined ? {} : { gatewayJobId: resolved.gatewayJobId }),
    requestHash,
    ...(parsed.resultHash === undefined ? {} : { resultHash: parsed.resultHash }),
    normalizedStatus,
    upstreamStatus: parsed.status,
    ...(parsed.dataSnapshot === undefined ? {} : { dataSnapshot: parsed.dataSnapshot }),
    computeSnapshot: parsed.computeSnapshot,
    receiptIds: uniqueSorted(receiptIds),
    evidenceIds: uniqueSorted(evidenceIds),
    startedAt,
    finishedAt
  };
  const candidates = parsed.evidenceItem === undefined ? [] : [parsed.evidenceItem];
  const selected = selectRequestedEvidenceProducts(candidates, input.context.requestedProducts);
  const warnings = uniqueSorted([...parsed.warnings, ...snapshot.warnings]);
  const unknowns = uniqueSorted([
    ...(parsed.evidenceItem?.unknowns ?? []),
    ...(snapshot.gaps.length === 0 ? [] : ["SNAPSHOT_UNRESOLVED"])
  ]);
  return finish({
    record,
    nodeRecords: [],
    evidenceItems: selected.evidenceItems,
    gowmReceipts: parsed.receipts.map((receipt) => receipt.value).sort((left, right) => compareText(String(left["receiptId"]), String(right["receiptId"]))),
    modelReceiptIds: validated.modelReceiptIds,
    evidenceReferences: parsed.evidenceReferences.map((reference) => reference.value).sort((left, right) => compareText(String(left["evidenceId"]), String(right["evidenceId"]))),
    contractTrace: contractTrace(input.context, [trace]),
    snapshotAdherence: [],
    snapshotGaps: snapshot.gaps,
    resultPayload: parsed.payload,
    requestedProductGaps: selected.gaps,
    warnings,
    unknowns,
    transport: resolved.transport
  });
}

function parseWorldResult(value: unknown): ParsedWorldResult {
  const raw = object(value, "INVALID_WORLD_QUERY_RESULT");
  if (Object.keys(raw).some((key) => !worldResultKeys.has(key)) || raw["queryPlanVersion"] !== "2.0") {
    throw new ExecutionEvidenceError("INVALID_WORLD_QUERY_RESULT");
  }
  const status = nonEmptyString(raw["status"], "INVALID_WORLD_QUERY_RESULT") as ParsedWorldResult["status"];
  if (!terminalJobStatuses.has(status)) throw new ExecutionEvidenceError("INVALID_WORLD_QUERY_RESULT");
  if (!Array.isArray(raw["nodes"]) || raw["nodes"].length < 1 || raw["nodes"].length > 64) {
    throw new ExecutionEvidenceError("INVALID_WORLD_QUERY_RESULT");
  }
  const seen = new Set<string>();
  const nodes = raw["nodes"].map((entry): ParsedWorldNode => {
    const node = object(entry, "INVALID_WORLD_QUERY_RESULT");
    if (Object.keys(node).some((key) => !worldNodeKeys.has(key))) throw new ExecutionEvidenceError("INVALID_WORLD_QUERY_RESULT");
    const nodeId = identifier(node["nodeId"], "INVALID_WORLD_QUERY_RESULT");
    if (seen.has(nodeId)) throw new ExecutionEvidenceError("DUPLICATE_WORLD_QUERY_NODE");
    seen.add(nodeId);
    const operation = object(node["operation"], "INVALID_WORLD_QUERY_RESULT");
    const nodeStatus = nonEmptyString(node["status"], "INVALID_WORLD_QUERY_RESULT");
    if (!worldNodeStatuses.has(nodeStatus) || ["QUEUED", "RUNNING"].includes(nodeStatus)) {
      throw new ExecutionEvidenceError("INVALID_WORLD_QUERY_RESULT");
    }
    return {
      nodeId,
      operationId: operationId(operation["operationId"], "INVALID_WORLD_QUERY_RESULT"),
      operationVersion: operationVersion(operation["operationVersion"], "INVALID_WORLD_QUERY_RESULT"),
      status: nodeStatus,
      ...(node["inputHash"] === undefined ? {} : { inputHash: digest(node["inputHash"], "INVALID_WORLD_QUERY_RESULT") }),
      ...(node["outputHash"] === undefined ? {} : { outputHash: digest(node["outputHash"], "INVALID_WORLD_QUERY_RESULT") }),
      ...(node["startedAt"] === undefined ? {} : { startedAt: timestamp(node["startedAt"], "INVALID_WORLD_QUERY_RESULT") }),
      ...(node["finishedAt"] === undefined ? {} : { finishedAt: timestamp(node["finishedAt"], "INVALID_WORLD_QUERY_RESULT") }),
      ...(node["result"] === undefined ? {} : { result: node["result"] })
    };
  });
  const outputs = cloneObject(raw["outputs"], "INVALID_WORLD_QUERY_RESULT");
  const outputHash = digest(raw["outputHash"], "WORLD_QUERY_OUTPUT_HASH_MISMATCH");
  if (canonicalSha256(outputs) !== outputHash) throw new ExecutionEvidenceError("WORLD_QUERY_OUTPUT_HASH_MISMATCH");
  const startedAt = timestamp(raw["startedAt"], "INVALID_WORLD_QUERY_RESULT");
  const finishedAt = timestamp(raw["finishedAt"], "INVALID_WORLD_QUERY_RESULT");
  if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new ExecutionEvidenceError("INVALID_TIME_RANGE");
  return {
    queryId: identifier(raw["queryId"], "INVALID_WORLD_QUERY_RESULT"),
    jobId: identifier(raw["jobId"], "INVALID_WORLD_QUERY_RESULT"),
    status,
    nodes,
    outputs,
    warnings: uniqueSorted(stringArray(raw["warnings"], 256, "INVALID_WORLD_QUERY_RESULT")),
    snapshotManifest: parseAndVerifySnapshotManifest(raw["snapshotManifest"]),
    snapshotAdherence: parseSnapshotAdherence(raw["snapshotAdherence"]),
    startedAt,
    finishedAt,
    outputHash
  };
}

function normalizedWorldNodeStatus(status: string, parsed?: ParsedCapabilityEnvelope): NormalizedExecutionStatus {
  if (parsed !== undefined) return normalizedCapabilityStatus(parsed.status);
  if (status === "FAILED") return "FAILED";
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "SKIPPED") return "INDETERMINATE";
  if (status === "NO_DATA") return "NO_DATA";
  if (status === "PARTIAL") return "PARTIAL";
  if (status === "COMPLETED") return "COMPLETED";
  throw new ExecutionEvidenceError("INVALID_WORLD_QUERY_RESULT");
}

function failedWorldProduct(
  input: WorldQueryExecutionNormalizationInput,
  resolved: ResolvedOutcome,
  validated: ReturnType<typeof validateContext>,
  requestHash: Sha256Digest
): ExecutionEvidenceProduct {
  const normalizedStatus = normalizedTerminalStatus(resolved.terminalStatus ?? "FAILED");
  const startedAt = resolved.startedAt ?? validated.startedAt;
  const finishedAt = resolved.finishedAt ?? validated.finishedAt;
  if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new ExecutionEvidenceError("INVALID_TIME_RANGE");
  const operations = Object.entries(input.operationsByNode).map(([nodeId, operation]) =>
    validateOperationTrace({ ...operation, nodeId }));
  const record: GowmExecutionRecord = {
    executionId: input.context.executionId,
    groundingId: input.context.groundingId,
    executionKind: "WORLD_QUERY",
    ...(resolved.gatewayQueryId === undefined ? {} : { gatewayQueryId: resolved.gatewayQueryId }),
    ...(resolved.gatewayJobId === undefined ? {} : { gatewayJobId: resolved.gatewayJobId }),
    requestHash,
    normalizedStatus,
    upstreamStatus: resolved.terminalStatus ?? normalizedStatus,
    receiptIds: [],
    evidenceIds: [],
    startedAt,
    finishedAt
  };
  const selected = selectRequestedEvidenceProducts([], input.context.requestedProducts);
  return finish({
    record,
    nodeRecords: [],
    evidenceItems: selected.evidenceItems,
    gowmReceipts: [],
    modelReceiptIds: validated.modelReceiptIds,
    evidenceReferences: [],
    contractTrace: contractTrace(input.context, operations),
    snapshotAdherence: [],
    snapshotGaps: [],
    requestedProductGaps: selected.gaps,
    warnings: [],
    unknowns: [],
    transport: resolved.transport
  });
}

function assertNodeResultStatus(node: ParsedWorldNode, parsed: ParsedCapabilityEnvelope | undefined): void {
  if (["COMPLETED", "PARTIAL", "NO_DATA"].includes(node.status) && parsed === undefined) {
    throw new ExecutionEvidenceError("GATEWAY_JOB_RESULT_MISSING");
  }
  if (parsed === undefined) return;
  const allowed = node.status === "PARTIAL" ? ["PARTIAL", "INDETERMINATE"] : [node.status];
  if (!allowed.includes(parsed.status)) throw new ExecutionEvidenceError("WORLD_QUERY_NODE_RESULT_STATUS_MISMATCH");
}

export function normalizeWorldQueryExecution(input: WorldQueryExecutionNormalizationInput): ExecutionEvidenceProduct {
  const validated = validateContext(input.context);
  const requestHash = canonicalSha256(input.context.requestPayload);
  const resolved = resolveOutcome(input.outcome, "WORLD_QUERY");
  if (resolved.result === undefined) {
    return failedWorldProduct(input, resolved, validated, requestHash);
  }
  const world = parseWorldResult(resolved.result);
  if (resolved.gatewayJobId !== undefined && resolved.gatewayJobId !== world.jobId) {
    throw new ExecutionEvidenceError("GATEWAY_JOB_ID_MISMATCH");
  }
  if (resolved.gatewayQueryId !== undefined && resolved.gatewayQueryId !== world.queryId) {
    throw new ExecutionEvidenceError("WORLD_QUERY_IDENTITY_MISMATCH");
  }
  if (resolved.terminalStatus !== undefined && resolved.terminalStatus !== world.status) {
    throw new ExecutionEvidenceError("GATEWAY_JOB_RESULT_STATUS_MISMATCH");
  }
  const nodeIds = world.nodes.map((node) => node.nodeId);
  const snapshot = assessWorldSnapshot(nodeIds, world.snapshotManifest, world.snapshotAdherence, input.snapshotExpectation);
  const adherenceByNode = new Map(world.snapshotAdherence.map((entry) => [entry.nodeId, entry]));
  const nodeRecords: GowmExecutionRecord[] = [];
  const candidateEvidenceItems: NormalizedExecutionEvidenceItem[] = [];
  const allReceipts: ParsedReceipt[] = [];
  const allEvidenceReferences: ParsedEvidenceReference[] = [];
  const allUnknowns: string[] = [];
  const allWarnings: string[] = [...world.warnings, ...snapshot.warnings];
  const operationTraces: OperationExecutionContractTrace[] = [];

  for (const node of world.nodes) {
    const suppliedTrace = input.operationsByNode[node.nodeId];
    if (suppliedTrace === undefined) throw new ExecutionEvidenceError("WORLD_QUERY_NODE_TRACE_MISSING");
    const trace = validateOperationTrace({ ...suppliedTrace, nodeId: node.nodeId });
    operationTraces.push(trace);
    if (trace.operationId !== node.operationId || trace.operationVersion !== node.operationVersion) {
      throw new ExecutionEvidenceError("OPERATION_IDENTITY_MISMATCH");
    }
    const nodeRequestHash = input.nodeRequestHashes[node.nodeId];
    if (nodeRequestHash === undefined) throw new ExecutionEvidenceError("WORLD_QUERY_NODE_REQUEST_HASH_MISSING");
    digest(nodeRequestHash, "WORLD_QUERY_NODE_REQUEST_HASH_MISSING");
    if (node.inputHash !== undefined && node.inputHash !== nodeRequestHash) {
      throw new ExecutionEvidenceError("WORLD_QUERY_NODE_INPUT_HASH_MISMATCH");
    }
    const nodeExecutionId = `${input.context.executionId}:node:${node.nodeId}`;
    const parsed = node.result === undefined ? undefined : parseCapabilityEnvelope(
      node.result,
      trace,
      nodeExecutionId,
      validated.maximumInlinePayloadBytes,
      input.context.payloadObjectReferences?.[node.nodeId],
      nodeRequestHash
    );
    assertNodeResultStatus(node, parsed);
    // GOWM's World Query node outputHash attests the complete capability
    // envelope. The nested execution.resultHash independently attests only
    // output.value and is verified by parseCapabilityEnvelope above.
    if (node.outputHash !== undefined && node.result !== undefined &&
      node.outputHash !== canonicalSha256(node.result)) {
      throw new ExecutionEvidenceError("UPSTREAM_RESULT_HASH_MISMATCH");
    }
    const adherence = adherenceByNode.get(node.nodeId);
    if (adherence === undefined) throw new ExecutionEvidenceError("SNAPSHOT_ADHERENCE_MISSING");
    let normalizedStatus = normalizedWorldNodeStatus(node.status, parsed);
    if (snapshot.gaps.some((gap) => gap.nodeId === node.nodeId) && !["FAILED", "CANCELLED"].includes(normalizedStatus)) {
      normalizedStatus = "PARTIAL";
      allUnknowns.push(`SNAPSHOT_UNRESOLVED:${node.nodeId}`);
    }
    const receiptIds = parsed?.receipts.map((receipt) => receipt.id) ?? [];
    const evidenceIds = parsed?.evidenceReferences.map((reference) => reference.id) ?? [];
    const nodeResultHash = node.outputHash ?? parsed?.resultHash;
    allReceipts.push(...(parsed?.receipts ?? []));
    allEvidenceReferences.push(...(parsed?.evidenceReferences ?? []));
    allWarnings.push(...(parsed?.warnings ?? []));
    allUnknowns.push(...(parsed?.evidenceItem?.unknowns ?? []));
    if (world.status !== "FAILED" && world.status !== "CANCELLED" && parsed?.evidenceItem !== undefined) {
      candidateEvidenceItems.push(parsed.evidenceItem);
    }
    nodeRecords.push({
      executionId: nodeExecutionId,
      groundingId: input.context.groundingId,
      executionKind: "WORLD_QUERY_NODE",
      operationId: node.operationId,
      operationVersion: node.operationVersion,
      gatewayQueryId: world.queryId,
      gatewayJobId: world.jobId,
      requestHash: nodeRequestHash,
      ...(nodeResultHash === undefined ? {} : { resultHash: nodeResultHash }),
      normalizedStatus,
      upstreamStatus: node.status,
      ...(parsed?.dataSnapshot === undefined ? {} : { dataSnapshot: parsed.dataSnapshot }),
      ...(parsed?.computeSnapshot === undefined ? {} : { computeSnapshot: parsed.computeSnapshot }),
      snapshotAdherence: structuredClone(adherence) as unknown as Readonly<Record<string, unknown>>,
      receiptIds: uniqueSorted(receiptIds),
      evidenceIds: uniqueSorted(evidenceIds),
      startedAt: node.startedAt ?? world.startedAt,
      finishedAt: node.finishedAt ?? world.finishedAt
    });
  }

  const receiptIds = allReceipts.map((receipt) => receipt.id);
  const evidenceIds = allEvidenceReferences.map((reference) => reference.id);
  assertUnique(receiptIds, "DUPLICATE_RECEIPT_ID");
  assertUnique(evidenceIds, "DUPLICATE_EVIDENCE_ID");
  assertIdentitySeparation(validated.modelReceiptIds, receiptIds, evidenceIds);
  let normalizedStatus = normalizedTerminalStatus(world.status);
  if (snapshot.gaps.length > 0 && !["FAILED", "CANCELLED"].includes(normalizedStatus)) normalizedStatus = "PARTIAL";
  const record: GowmExecutionRecord = {
    executionId: input.context.executionId,
    groundingId: input.context.groundingId,
    executionKind: "WORLD_QUERY",
    gatewayQueryId: world.queryId,
    gatewayJobId: world.jobId,
    requestHash,
    resultHash: world.outputHash,
    normalizedStatus,
    upstreamStatus: world.status,
    snapshotAdherence: { nodes: structuredClone(world.snapshotAdherence) },
    receiptIds: uniqueSorted(receiptIds),
    evidenceIds: uniqueSorted(evidenceIds),
    startedAt: world.startedAt,
    finishedAt: world.finishedAt
  };
  const selected = selectRequestedEvidenceProducts(candidateEvidenceItems, input.context.requestedProducts);
  const resultPayload = boundPayload(
    world.outputs,
    validated.maximumInlinePayloadBytes,
    input.context.payloadObjectReferences?.["WORLD_QUERY_OUTPUTS"]
  );
  return finish({
    record,
    nodeRecords: nodeRecords.sort((left, right) => compareText(left.executionId, right.executionId)),
    evidenceItems: selected.evidenceItems,
    gowmReceipts: allReceipts.map((receipt) => receipt.value).sort((left, right) => compareText(String(left["receiptId"]), String(right["receiptId"]))),
    modelReceiptIds: validated.modelReceiptIds,
    evidenceReferences: allEvidenceReferences.map((reference) => reference.value).sort((left, right) => compareText(String(left["evidenceId"]), String(right["evidenceId"]))),
    contractTrace: contractTrace(input.context, operationTraces, world.snapshotManifest.manifestHash),
    snapshotManifest: world.snapshotManifest,
    snapshotAdherence: world.snapshotAdherence,
    snapshotGaps: snapshot.gaps,
    resultPayload,
    requestedProductGaps: selected.gaps,
    warnings: uniqueSorted(allWarnings),
    unknowns: uniqueSorted([
      ...allUnknowns,
      ...(snapshot.gaps.length === 0 ? [] : ["SNAPSHOT_UNRESOLVED"]),
      ...(world.status === "PARTIAL" ? ["PARTIAL_RESULT"] : [])
    ]),
    transport: {
      ...resolved.transport,
      gatewayJobId: world.jobId,
      ...(resolved.transport.terminalJobStatus === undefined ? {} : { terminalJobStatus: resolved.transport.terminalJobStatus })
    }
  });
}

export class GowmExecutionEvidenceNormalizer {
  normalizeDirect(input: DirectExecutionNormalizationInput): ExecutionEvidenceProduct {
    return normalizeDirectExecution(input);
  }

  normalizeWorldQuery(input: WorldQueryExecutionNormalizationInput): ExecutionEvidenceProduct {
    return normalizeWorldQueryExecution(input);
  }
}
