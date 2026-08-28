import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { canonicalJson, canonicalSha256 } from "./canonical.js";
import { ExecutionEvidenceError } from "./errors.js";
import { normalizeDirectExecution, normalizeWorldQueryExecution } from "./normalizer.js";
import type {
  DirectExecutionNormalizationInput,
  ExecutionNormalizationContext,
  OperationExecutionContractTrace,
  QuerySnapshotAdherence,
  QuerySnapshotManifest,
  Sha256Digest,
  WorldQueryExecutionNormalizationInput
} from "./types.js";

function digest(character: string): Sha256Digest {
  return `sha256:${character.repeat(64)}`;
}

function trace(
  operationId = "world.get-current-state",
  overrides: Partial<OperationExecutionContractTrace> = {}
): OperationExecutionContractTrace {
  return {
    operationId,
    operationVersion: "1.0",
    inputSchemaHash: digest("1"),
    outputSchemaUri: `urn:test:${operationId}:output`,
    outputSchemaHash: digest("2"),
    semanticProfileHash: digest("3"),
    negativeEvidencePolicy: "NO_DATA_IS_UNKNOWN",
    availability: {
      availability: "AVAILABLE",
      checkedAt: "2026-08-27T09:00:00.000Z",
      reasonCodes: ["READY"]
    },
    ...overrides
  };
}

function context(overrides: Partial<ExecutionNormalizationContext> = {}): ExecutionNormalizationContext {
  return {
    executionId: "execution-001",
    groundingId: "grounding-001",
    requestPayload: { requestVersion: "1.0", input: { reference: "road-1" } },
    startedAt: "2026-08-27T09:00:01.000Z",
    finishedAt: "2026-08-27T09:00:02.000Z",
    contractCatalogRevision: digest("a"),
    bindingRevision: digest("b"),
    authorizationContextHash: digest("c"),
    delegatedIdentityHash: digest("d"),
    modelReceiptIds: ["model-receipt-1"],
    requestedProducts: ["WORLD_EVIDENCE"],
    ...overrides
  };
}

function computeSnapshot(operation: OperationExecutionContractTrace): Record<string, unknown> {
  return {
    provider: { providerId: "gowm.provider", providerVersion: "1.0.0", implementationDigest: digest("4") },
    operation: { operationId: operation.operationId, operationVersion: operation.operationVersion },
    engine: { name: "test-engine", version: "1.0.0", digest: digest("5") },
    policy: { version: "1", digest: digest("6") },
    schemas: { inputSchemaHash: operation.inputSchemaHash, outputSchemaHash: operation.outputSchemaHash }
  };
}

function evidenceReference(id = "world-evidence-1"): Record<string, unknown> {
  return {
    evidenceId: id,
    authority: "gowm.world-snapshot",
    evidenceType: "OBSERVATION",
    referenceKey: { namespace: "gowm", kind: "WORLD_OBJECT", id: "road-1", version: "v1" },
    schemaUri: "urn:test:world-evidence",
    schemaHash: digest("7"),
    payloadRef: "https://objects.invalid/evidence/road-1"
  };
}

interface EnvelopeOptions {
  readonly status?: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE" | "FAILED";
  readonly value?: unknown;
  readonly inputHash?: Sha256Digest;
  readonly receiptId?: string;
  readonly evidenceId?: string;
  readonly dataConsistency?: "PINNED" | "CONSISTENT_AT_START" | "BEST_EFFORT";
  readonly warnings?: readonly string[];
}

function envelope(operation: OperationExecutionContractTrace, options: EnvelopeOptions = {}): Record<string, unknown> {
  const status = options.status ?? "COMPLETED";
  const value = options.value ?? { state: "ACTIVE" };
  const compute = computeSnapshot(operation);
  const outputHash = status === "FAILED" || status === "NO_DATA" || status === "INDETERMINATE"
    ? canonicalSha256(null)
    : canonicalSha256(value);
  const receiptId = options.receiptId ?? `receipt-${operation.operationId.replaceAll(".", "-")}`;
  const inputHash = options.inputHash ?? canonicalSha256({ reference: "road-1" });
  const result: Record<string, unknown> = {
    providerProtocolVersion: "1.0",
    requestId: "gateway-request-1",
    operation: { operationId: operation.operationId, operationVersion: operation.operationVersion },
    status,
    ...(["FAILED", "NO_DATA", "INDETERMINATE"].includes(status)
      ? {}
      : { output: { schemaUri: operation.outputSchemaUri, schemaHash: operation.outputSchemaHash, value } }),
    ...(status === "FAILED" ? {} : {
      dataSnapshot: {
        consistency: options.dataConsistency ?? "CONSISTENT_AT_START",
        capturedAt: "2026-08-27T09:00:00.000Z",
        scopeDigest: digest("8"),
        resources: [{
          referenceKey: { namespace: "gowm", kind: "WORLD_OBJECT", id: "road-1", version: "v1" },
          authority: "gowm",
          pinning: options.dataConsistency === "PINNED" ? "PINNED" : "BEST_EFFORT",
          digest: digest("9")
        }]
      }
    }),
    computeSnapshot: compute,
    receipts: status === "FAILED" ? [] : [{
      receiptId,
      operationId: operation.operationId,
      operationVersion: operation.operationVersion,
      providerId: "gowm.provider",
      providerVersion: "1.0.0",
      inputHash,
      outputHash,
      computeSnapshotHash: canonicalSha256(compute),
      generatedAt: "2026-08-27T09:00:01.500Z",
      durationMs: 10,
      method: { engine: "test-engine", engineVersion: "1.0.0", methodId: "method", methodVersion: "1" },
      changes: { repairApplied: false, typeChanged: false },
      warnings: []
    }],
    evidenceReferences: status === "FAILED" ? [] : [evidenceReference(options.evidenceId)],
    warnings: [...(options.warnings ?? [])],
    consumption: { outputBytes: 10 },
    execution: {
      providerId: "gowm.provider",
      providerVersion: "1.0.0",
      elapsedMs: 10,
      resultHash: outputHash
    },
    ...(status === "FAILED" ? { error: { code: "UPSTREAM", message: "redacted", retryable: false } } : {})
  };
  return result;
}

function directInput(overrides: Partial<DirectExecutionNormalizationInput> = {}): DirectExecutionNormalizationInput {
  const operation = trace();
  return {
    context: context(),
    operation,
    snapshotExpectation: { consistency: "CONSISTENT_AT_START", allowDowngrade: false },
    outcome: { mode: "SYNC", status: 200, result: envelope(operation) },
    ...overrides
  };
}

function manifest(mode: QuerySnapshotManifest["mode"] = "LATEST_AT_START"): QuerySnapshotManifest {
  const body = {
    querySnapshotId: "snapshot-001",
    mode,
    consistency: mode === "PINNED" ? "PINNED" as const
      : mode === "BEST_EFFORT" ? "BEST_EFFORT" as const : "CONSISTENT_AT_START" as const,
    capturedAt: "2026-08-27T09:00:00.000Z",
    resources: [{
      resourceKind: "WORLD_OBJECT",
      resourceId: "gowm:road-1",
      version: "v1",
      pinning: mode === "BEST_EFFORT" ? "BEST_EFFORT" : "PINNED"
    }]
  };
  return { ...body, manifestHash: canonicalSha256(body) };
}

function adherence(nodeId: string, status: QuerySnapshotAdherence["status"] = "MATCHED"): QuerySnapshotAdherence {
  return {
    nodeId,
    status,
    checkedResources: 1,
    mismatches: status === "MISMATCHED" || status === "UNSUPPORTED"
      ? [{ resourceKind: "WORLD_OBJECT", resourceId: "gowm:road-1", reason: "PINNING_UNSUPPORTED" }]
      : []
  };
}

interface WorldFixtureOptions {
  readonly mode?: QuerySnapshotManifest["mode"];
  readonly adherenceStatus?: QuerySnapshotAdherence["status"];
  readonly worldStatus?: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
  readonly secondNodeStatus?: "COMPLETED" | "PARTIAL" | "NO_DATA" | "FAILED" | "CANCELLED" | "SKIPPED";
}

function worldFixture(options: WorldFixtureOptions = {}): {
  readonly result: Record<string, unknown>;
  readonly operationsByNode: Readonly<Record<string, OperationExecutionContractTrace>>;
  readonly nodeRequestHashes: Readonly<Record<string, Sha256Digest>>;
} {
  const first = trace("world.get-current-state");
  const second = trace("operational-task.get", {
    inputSchemaHash: digest("e"),
    outputSchemaUri: "urn:test:operational-task",
    outputSchemaHash: digest("f"),
    semanticProfileHash: digest("0")
  });
  const firstInputHash = canonicalSha256({ node: "first" });
  const secondInputHash = canonicalSha256({ node: "second" });
  const secondStatus = options.secondNodeStatus ?? "COMPLETED";
  const firstEnvelope = envelope(first, { inputHash: firstInputHash, receiptId: "receipt-node-a", evidenceId: "evidence-node-a" });
  const secondEnvelope = ["FAILED", "CANCELLED", "SKIPPED"].includes(secondStatus)
    ? undefined
    : envelope(second, {
        status: secondStatus === "NO_DATA" ? "NO_DATA" : secondStatus === "PARTIAL" ? "PARTIAL" : "COMPLETED",
        value: { controlState: "COMPLETED_REPORTED", outcomeVerification: "UNVERIFIED" },
        inputHash: secondInputHash,
        receiptId: "receipt-node-b",
        evidenceId: "evidence-node-b"
      });
  const outputs = { world: { state: "ACTIVE" }, operational: secondStatus };
  const snapshotManifest = manifest(options.mode);
  const nodes = [
    {
      nodeId: "NodeA",
      operation: { operationId: first.operationId, operationVersion: first.operationVersion },
      status: "COMPLETED",
      attempt: 1,
      startedAt: "2026-08-27T09:00:00.100Z",
      finishedAt: "2026-08-27T09:00:00.500Z",
      inputHash: firstInputHash,
      outputHash: canonicalSha256(firstEnvelope),
      result: firstEnvelope
    },
    {
      nodeId: "NodeB",
      operation: { operationId: second.operationId, operationVersion: second.operationVersion },
      status: secondStatus,
      attempt: 1,
      inputHash: secondInputHash,
      ...(secondEnvelope === undefined ? {} : {
        outputHash: canonicalSha256(secondEnvelope),
        result: secondEnvelope
      }),
      ...(secondStatus === "FAILED" ? { error: { code: "UPSTREAM", message: "redacted", retryable: false } } : {})
    }
  ];
  const snapshotAdherence = [
    adherence("NodeA", options.adherenceStatus),
    adherence("NodeB", options.adherenceStatus)
  ];
  const result = {
    queryPlanVersion: "2.0",
    queryId: "query-001",
    jobId: "gateway-job-001",
    status: options.worldStatus ?? "COMPLETED",
    nodes,
    outputs,
    warnings: [],
    snapshotManifest,
    snapshotAdherence,
    startedAt: "2026-08-27T09:00:00.000Z",
    finishedAt: "2026-08-27T09:00:01.000Z",
    outputHash: canonicalSha256(outputs)
  };
  return {
    result,
    operationsByNode: { NodeA: first, NodeB: second },
    nodeRequestHashes: { NodeA: firstInputHash, NodeB: secondInputHash }
  };
}

function worldInput(
  fixture = worldFixture(),
  overrides: Partial<WorldQueryExecutionNormalizationInput> = {}
): WorldQueryExecutionNormalizationInput {
  return {
    context: context({
      requestPayload: { requestVersion: "1.0", plan: { queryId: "query-001" } },
      requestedProducts: ["WORLD_EVIDENCE"]
    }),
    operationsByNode: fixture.operationsByNode,
    nodeRequestHashes: fixture.nodeRequestHashes,
    snapshotExpectation: { mode: "LATEST_AT_START", allowDowngrade: false },
    outcome: { mode: "SYNC", status: 200, result: fixture.result },
    ...overrides
  };
}

function expectExecutionError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ExecutionEvidenceError);
    expect(error).toMatchObject({ code });
  }
}

describe("GOWM execution evidence product", () => {
  it("normalizes a direct synchronous result without mixing receipts, evidence, or identity hashes", () => {
    const product = normalizeDirectExecution(directInput());
    expect(product.record).toMatchObject({
      executionKind: "DIRECT_OPERATION",
      normalizedStatus: "COMPLETED",
      upstreamStatus: "COMPLETED",
      receiptIds: ["receipt-world-get-current-state"],
      evidenceIds: ["world-evidence-1"]
    });
    expect(product.gowmReceipts.map((receipt) => receipt["receiptId"])).toEqual(["receipt-world-get-current-state"]);
    expect(product.evidenceReferences.map((reference) => reference["evidenceId"])).toEqual(["world-evidence-1"]);
    expect(product.modelReceiptIds).toEqual(["model-receipt-1"]);
    expect(product.evidenceItems[0]?.evidenceIds).not.toContain("model-receipt-1");
    expect(product.contractTrace).toMatchObject({
      contractCatalogRevision: digest("a"),
      bindingRevision: digest("b"),
      authorizationContextHash: digest("c"),
      delegatedIdentityHash: digest("d")
    });
    expect(product.contractTrace.operations[0]).toMatchObject({
      inputSchemaHash: digest("1"),
      outputSchemaHash: digest("2"),
      semanticProfileHash: digest("3")
    });
    expect(product.productHash).toBe(canonicalSha256((({ productHash: _ignored, ...body }) => body)(product)));
    expect(Object.isFrozen(product)).toBe(true);
  });

  it("normalizes a direct asynchronous terminal job while retaining the Gateway job identity", () => {
    const operation = trace();
    const result = envelope(operation);
    const product = normalizeDirectExecution(directInput({
      outcome: {
        mode: "ASYNC",
        status: 202,
        acceptedJob: {
          jobId: "gateway-job-direct",
          requestId: "request-1",
          kind: "DIRECT_OPERATION",
          status: "QUEUED",
          createdAt: "2026-08-27T09:00:00.000Z",
          updatedAt: "2026-08-27T09:00:00.000Z"
        },
        terminalJob: {
          jobId: "gateway-job-direct",
          requestId: "request-1",
          kind: "DIRECT_OPERATION",
          status: "COMPLETED",
          createdAt: "2026-08-27T09:00:00.000Z",
          updatedAt: "2026-08-27T09:00:02.000Z",
          startedAt: "2026-08-27T09:00:00.500Z",
          finishedAt: "2026-08-27T09:00:01.500Z",
          result
        }
      }
    }));
    expect(product.transport).toEqual({
      mode: "ASYNC",
      responseStatus: 202,
      gatewayJobId: "gateway-job-direct",
      terminalJobStatus: "COMPLETED"
    });
    expect(product.record.gatewayJobId).toBe("gateway-job-direct");
    expect(product.record.startedAt).toBe("2026-08-27T09:00:00.500Z");
  });

  it("rejects asynchronous job identity drift instead of attaching another job's result", () => {
    const operation = trace();
    expectExecutionError(() => normalizeDirectExecution(directInput({
      outcome: {
        mode: "ASYNC",
        status: 202,
        acceptedJob: { jobId: "job-a", kind: "DIRECT_OPERATION", status: "QUEUED" },
        terminalJob: { jobId: "job-b", kind: "DIRECT_OPERATION", status: "COMPLETED", result: envelope(operation) }
      }
    })), "GATEWAY_JOB_ID_MISMATCH");
  });

  it("preserves NO_DATA and INDETERMINATE as unknowns and emits no evidence for FAILED", () => {
    const operation = trace();
    const noData = normalizeDirectExecution(directInput({ outcome: {
      mode: "SYNC", status: 200, result: envelope(operation, { status: "NO_DATA" })
    } }));
    expect(noData.record.normalizedStatus).toBe("NO_DATA");
    expect(noData.evidenceItems[0]).toMatchObject({
      upstreamStatus: "NO_DATA",
      payload: { kind: "NONE", reason: "NO_DATA" },
      unknowns: ["NO_DATA"]
    });
    expect(JSON.stringify(noData)).not.toContain('"false"');

    const indeterminate = normalizeDirectExecution(directInput({ outcome: {
      mode: "SYNC", status: 200, result: envelope(operation, { status: "INDETERMINATE" })
    } }));
    expect(indeterminate.unknowns).toContain("INDETERMINATE");

    const failed = normalizeDirectExecution(directInput({ outcome: {
      mode: "SYNC", status: 200, result: envelope(operation, { status: "FAILED" })
    } }));
    expect(failed.record.normalizedStatus).toBe("FAILED");
    expect(failed.evidenceItems).toEqual([]);
    expect(failed.record.evidenceIds).toEqual([]);
  });

  it("keeps PARTIAL evidence and degradation warnings without turning either into a fact", () => {
    const operation = trace("world.get-current-state", {
      availability: {
        availability: "DEGRADED",
        checkedAt: "2026-08-27T09:00:00.000Z",
        reasonCodes: ["CAPACITY_LIMITED"]
      }
    });
    const product = normalizeDirectExecution(directInput({
      operation,
      outcome: { mode: "SYNC", status: 200, result: envelope(operation, { status: "PARTIAL", value: { valid: [1] } }) }
    }));
    expect(product.record.normalizedStatus).toBe("PARTIAL");
    expect(product.evidenceItems[0]?.payload).toMatchObject({ kind: "INLINE", value: { valid: [1] } });
    expect(product.unknowns).toContain("PARTIAL_RESULT");
    expect(product.warnings).toContain("AVAILABILITY_DEGRADED_AT_COMPILE");
  });

  it("references oversized output only after an exact authoritative object reference is supplied", () => {
    const operation = trace();
    const value = { geometry: "x".repeat(2000), rows: [1, 2, 3] };
    const byteCount = Buffer.byteLength(canonicalJson(value), "utf8");
    const payloadHash = canonicalSha256(value);
    const product = normalizeDirectExecution(directInput({
      context: context({
        maximumInlinePayloadBytes: 128,
        payloadObjectReferences: {
          DIRECT_RESULT: {
            payloadRef: "s3://wsgs-results/execution-001.json",
            byteCount,
            payloadHash
          }
        }
      }),
      operation,
      outcome: { mode: "SYNC", status: 200, result: envelope(operation, { value }) }
    }));
    expect(product.resultPayload).toEqual({
      kind: "OBJECT_REFERENCE",
      byteCount,
      payloadHash,
      boundedSummary: { jsonType: "object", keys: ["geometry", "rows"], keyCount: 2 },
      payloadRef: "s3://wsgs-results/execution-001.json"
    });
    expect(JSON.stringify(product)).not.toContain("x".repeat(100));

    expectExecutionError(() => normalizeDirectExecution(directInput({
      context: context({ maximumInlinePayloadBytes: 128 }),
      operation,
      outcome: { mode: "SYNC", status: 200, result: envelope(operation, { value }) }
    })), "LARGE_PAYLOAD_REFERENCE_REQUIRED");
  });

  it("rejects model-receipt injection, receipt/evidence collision, and result hash drift", () => {
    const operation = trace();
    const injected = { ...envelope(operation), modelReceiptIds: ["model-receipt-1"] };
    expectExecutionError(() => normalizeDirectExecution(directInput({ outcome: {
      mode: "SYNC", status: 200, result: injected
    } })), "UNKNOWN_GATEWAY_ENVELOPE_FIELD");

    const collision = envelope(operation, {
      receiptId: "same-id",
      evidenceId: "same-id"
    });
    expectExecutionError(() => normalizeDirectExecution(directInput({ outcome: {
      mode: "SYNC", status: 200, result: collision
    } })), "RECEIPT_EVIDENCE_ID_COLLISION");

    const drifted = envelope(operation);
    (drifted["execution"] as Record<string, unknown>)["resultHash"] = digest("9");
    expectExecutionError(() => normalizeDirectExecution(directInput({ outcome: {
      mode: "SYNC", status: 200, result: drifted
    } })), "UPSTREAM_RESULT_HASH_MISMATCH");
  });

  it("normalizes a synchronous world query with per-node records and exact Snapshot trace", () => {
    const fixture = worldFixture();
    const product = normalizeWorldQueryExecution(worldInput(fixture));
    expect(product.record).toMatchObject({
      executionKind: "WORLD_QUERY",
      gatewayQueryId: "query-001",
      gatewayJobId: "gateway-job-001",
      normalizedStatus: "COMPLETED"
    });
    expect(product.nodeRecords).toHaveLength(2);
    expect(product.nodeRecords.every((record) => record.executionKind === "WORLD_QUERY_NODE")).toBe(true);
    expect(product.snapshotManifest?.manifestHash).toBe(manifest().manifestHash);
    expect(product.snapshotAdherence.map((entry) => entry.nodeId)).toEqual(["NodeA", "NodeB"]);
    expect(product.contractTrace.querySnapshotManifestHash).toBe(manifest().manifestHash);
    expect(product.contractTrace.operations.map((operation) => operation.nodeId)).toEqual(["NodeA", "NodeB"]);
    expect((product.record.snapshotAdherence as Record<string, unknown>)["nodes"]).toEqual(product.snapshotAdherence);
    expect(product.evidenceItems).toHaveLength(2);
  });

  it("normalizes an asynchronous world-query terminal result and validates query/job identity", () => {
    const fixture = worldFixture();
    const product = normalizeWorldQueryExecution(worldInput(fixture, {
      outcome: {
        mode: "ASYNC",
        status: 202,
        acceptedJob: { jobId: "gateway-job-001", queryId: "query-001", kind: "WORLD_QUERY", status: "QUEUED" },
        terminalJob: {
          jobId: "gateway-job-001",
          queryId: "query-001",
          kind: "WORLD_QUERY",
          status: "COMPLETED",
          result: fixture.result
        }
      }
    }));
    expect(product.transport).toEqual({
      mode: "ASYNC",
      responseStatus: 202,
      gatewayJobId: "gateway-job-001",
      terminalJobStatus: "COMPLETED"
    });
  });

  it("does not silently downgrade PINNED Snapshot semantics", () => {
    const fixture = worldFixture({ mode: "BEST_EFFORT", adherenceStatus: "UNSUPPORTED" });
    const product = normalizeWorldQueryExecution(worldInput(fixture, {
      snapshotExpectation: { mode: "PINNED", allowDowngrade: true }
    }));
    expect(product.record.normalizedStatus).toBe("PARTIAL");
    expect(product.snapshotGaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SNAPSHOT_MODE_DOWNGRADED", expected: "PINNED", actual: "BEST_EFFORT" }),
      expect.objectContaining({ code: "SNAPSHOT_ADHERENCE_FAILED", actual: "UNSUPPORTED" })
    ]));
    expect(product.unknowns).toContain("SNAPSHOT_UNRESOLVED");
  });

  it("retains BEST_EFFORT mismatch warnings without inventing strict adherence", () => {
    const fixture = worldFixture({ mode: "BEST_EFFORT", adherenceStatus: "MISMATCHED" });
    const product = normalizeWorldQueryExecution(worldInput(fixture, {
      snapshotExpectation: { mode: "BEST_EFFORT", allowDowngrade: true }
    }));
    expect(product.record.normalizedStatus).toBe("COMPLETED");
    expect(product.snapshotGaps).toEqual([]);
    expect(product.warnings).toContain("SNAPSHOT_BEST_EFFORT_MISMATCH:NodeA:MISMATCHED");
    expect(product.snapshotAdherence[0]?.status).toBe("MISMATCHED");
  });

  it("retains valid node evidence for PARTIAL and emits no evidence for FAILED", () => {
    const partialFixture = worldFixture({ worldStatus: "PARTIAL", secondNodeStatus: "FAILED" });
    const partial = normalizeWorldQueryExecution(worldInput(partialFixture));
    expect(partial.record.normalizedStatus).toBe("PARTIAL");
    expect(partial.evidenceItems.map((item) => item.sourceNodeId)).toEqual(["NodeA"]);
    expect(partial.unknowns).toContain("PARTIAL_RESULT");

    const failedFixture = worldFixture({ worldStatus: "FAILED", secondNodeStatus: "FAILED" });
    const failed = normalizeWorldQueryExecution(worldInput(failedFixture));
    expect(failed.record.normalizedStatus).toBe("FAILED");
    expect(failed.evidenceItems).toEqual([]);
  });

  it("records cancellation without fabricating a result, receipt, evidence, or Snapshot", () => {
    const fixture = worldFixture();
    const product = normalizeWorldQueryExecution(worldInput(fixture, {
      outcome: {
        mode: "ASYNC",
        status: 202,
        acceptedJob: { jobId: "gateway-job-001", queryId: "query-001", kind: "WORLD_QUERY", status: "QUEUED" },
        terminalJob: {
          jobId: "gateway-job-001",
          queryId: "query-001",
          kind: "WORLD_QUERY",
          status: "CANCELLED",
          startedAt: "2026-08-27T09:00:00.000Z",
          finishedAt: "2026-08-27T09:00:00.500Z"
        }
      }
    }));
    expect(product.record.normalizedStatus).toBe("CANCELLED");
    expect(product.evidenceItems).toEqual([]);
    expect(product.gowmReceipts).toEqual([]);
    expect(product.evidenceReferences).toEqual([]);
    expect(product.snapshotManifest).toBeUndefined();
  });

  it("only returns caller-requested products and emits a non-substituting optional gap", () => {
    const fixture = worldFixture();
    const taskOnly = normalizeWorldQueryExecution(worldInput(fixture, {
      context: context({
        requestPayload: { plan: { queryId: "query-001" } },
        requestedProducts: ["OPERATIONAL_TASKS"]
      })
    }));
    expect(taskOnly.evidenceItems).toHaveLength(1);
    expect(taskOnly.evidenceItems[0]?.productKind).toBe("OPERATIONAL_TASK");

    const missing = normalizeDirectExecution(directInput({
      context: context({ requestedProducts: ["PREDICATE_EVALUATIONS"] })
    }));
    expect(missing.evidenceItems).toEqual([]);
    expect(missing.requestedProductGaps).toEqual([{
      requestedProduct: "PREDICATE_EVALUATIONS",
      reason: "NO_MATCHING_EVIDENCE",
      blocking: false,
      substituted: false
    }]);
  });

  it("keeps the execution record schema clean and the canonical product hash stable", () => {
    const first = normalizeDirectExecution(directInput());
    const second = normalizeDirectExecution(directInput());
    expect(first.productHash).toBe(second.productHash);
    expect(Object.keys(first.record).sort()).toEqual([
      "computeSnapshot",
      "evidenceIds",
      "executionId",
      "executionKind",
      "finishedAt",
      "groundingId",
      "normalizedStatus",
      "operationId",
      "operationVersion",
      "receiptIds",
      "requestHash",
      "resultHash",
      "startedAt",
      "upstreamStatus",
      "dataSnapshot"
    ].sort());
    expect(first.record).not.toHaveProperty("contractCatalogRevision");
    expect(first.record).not.toHaveProperty("semanticProfileHash");
    expect(first.contractTrace).toHaveProperty("contractCatalogRevision");
    expect(first.contractTrace.operations[0]).toHaveProperty("semanticProfileHash");
  });

  it("rejects tampered world-query output and Snapshot hashes", () => {
    const outputFixture = worldFixture();
    const badOutput = structuredClone(outputFixture.result);
    badOutput["outputHash"] = digest("9");
    expectExecutionError(() => normalizeWorldQueryExecution(worldInput({ ...outputFixture, result: badOutput })),
      "WORLD_QUERY_OUTPUT_HASH_MISMATCH");

    const nodeFixture = worldFixture();
    const badNode = structuredClone(nodeFixture.result);
    ((badNode["nodes"] as Array<Record<string, unknown>>)[0] as Record<string, unknown>)["outputHash"] = digest("9");
    expectExecutionError(() => normalizeWorldQueryExecution(worldInput({ ...nodeFixture, result: badNode })),
      "UPSTREAM_RESULT_HASH_MISMATCH");

    const snapshotFixture = worldFixture();
    const badSnapshot = structuredClone(snapshotFixture.result);
    (badSnapshot["snapshotManifest"] as Record<string, unknown>)["manifestHash"] = digest("9");
    expectExecutionError(() => normalizeWorldQueryExecution(worldInput({ ...snapshotFixture, result: badSnapshot })),
      "SNAPSHOT_MANIFEST_HASH_MISMATCH");
  });
});
