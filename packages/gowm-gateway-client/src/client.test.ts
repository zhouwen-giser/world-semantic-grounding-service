import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CircuitOpenError } from "./circuit-breaker.js";
import { GatewayProtocolError, GowmGatewayClient } from "./client.js";
import type {
  CapabilityCatalog,
  CapabilitySemanticCatalog,
  CapabilitySemanticProfile,
  OperationAvailabilityList,
  OperationLock,
  Sha256Digest
} from "./types.js";

const digest = (character: string): Sha256Digest => `sha256:${character.repeat(64)}`;
const revision = digest("a");
const bindingRevision = digest("b");

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  });
}

function canonicalHash(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

const semanticProfile: CapabilitySemanticProfile = {
  profileVersion: "1.0",
  domain: "REFERENCE",
  relationSemantics: ["VALIDATES"],
  acceptedReferenceKinds: ["WORLD_OBJECT"],
  producedReferenceKinds: ["WORLD_OBJECT"],
  spatialSemantics: "NONE",
  timeSemantics: "SNAPSHOT",
  freshnessSemantics: "SNAPSHOT_CURRENTNESS",
  resultNature: "VALIDATION",
  negativeEvidencePolicy: "NO_DATA_IS_UNKNOWN"
};
const semanticProfileHash = canonicalHash(semanticProfile);

const lock: OperationLock = {
  operationId: "reference.validate",
  operationVersion: "1.0",
  maturity: "STABLE",
  inputSchemaHash: digest("1"),
  outputSchemaHash: digest("2"),
  semanticProfileHash,
  snapshotSupport: "CONSISTENT_AT_START",
  requiredPermissions: ["data:read"]
};

function catalog(overrides: Partial<CapabilityCatalog> = {}): CapabilityCatalog {
  return {
    registryVersion: revision,
    registryRevision: revision,
    contractCatalogRevision: revision,
    bindingRevision,
    capabilities: [
      {
        operationId: lock.operationId,
        operationVersion: lock.operationVersion,
        semanticRole: "FOUNDATION_DATA_QUERY",
        dataBinding: "WORLD_SNAPSHOT_BOUND",
        resultSemantics: "VALIDATION",
        executionBindings: ["SYNC_HTTP"],
        criticalPathPolicy: "REMOTE_ONLY",
        maturity: "STABLE",
        inputSchemaUri: "urn:test:reference-validation-input",
        inputSchemaHash: lock.inputSchemaHash,
        outputSchemaUri: "urn:test:reference-validation-output",
        outputSchemaHash: lock.outputSchemaHash,
        scopePolicy: "DATA_SCOPE_REQUIRED",
        semanticProfile,
        execution: {
          mode: "SYNC",
          defaultTimeoutMs: 100,
          maximumTimeoutMs: 1_000,
          costClass: "LOW"
        },
        limits: { maximumInputBytes: 4_096, maximumOutputBytes: 4_096 },
        snapshotPolicy: { dataSnapshot: "REQUIRED", computeSnapshot: "REQUIRED" },
        ports: {
          inputs: [],
          outputs: [{
            name: "result",
            schemaUri: "urn:test:reference-validation",
            schemaHash: lock.outputSchemaHash,
            valueKind: "REFERENCE_KEY",
            unitSemantics: "UNSPECIFIED"
          }]
        }
      }
    ],
    ...overrides
  };
}

function gatewayResult(): Record<string, unknown> {
  return {
    providerProtocolVersion: "1.0",
    requestId: "request-1",
    operation: { operationId: lock.operationId, operationVersion: lock.operationVersion },
    status: "COMPLETED",
    output: {
      schemaUri: "urn:test:reference-validation-output",
      schemaHash: lock.outputSchemaHash,
      value: { valid: true }
    },
    computeSnapshot: {
      provider: { providerId: "gowm.reference-catalog", providerVersion: "1.0.0" },
      operation: { operationId: lock.operationId, operationVersion: lock.operationVersion },
      engine: { name: "test-engine", version: "1.0.0" },
      policy: { version: "1.0", digest: digest("7") },
      schemas: { inputSchemaHash: lock.inputSchemaHash, outputSchemaHash: lock.outputSchemaHash }
    },
    receipts: [],
    evidenceReferences: [],
    warnings: [],
    consumption: { outputBytes: 16 },
    execution: { providerId: "gowm.reference-catalog", providerVersion: "1.0.0", elapsedMs: 1 }
  };
}

function gatewayJob(status: "QUEUED" | "RUNNING" | "COMPLETED" | "CANCELLED", queryId = "query-1"): Record<string, unknown> {
  return {
    jobId: "job-1",
    requestId: "request-1",
    kind: "WORLD_QUERY",
    status,
    queryId,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:01.000Z"
  };
}

function worldQuerySubmission(): Record<string, unknown> {
  const port = {
    schemaUri: "urn:test:reference-validation-output",
    schemaHash: lock.outputSchemaHash,
    valueKind: "REFERENCE_KEY",
    unitSemantics: "UNSPECIFIED"
  };
  return {
    requestId: "request-1",
    idempotencyKey: "idempotency-1",
    plan: {
      queryPlanVersion: "2.0",
      queryId: "query-1",
      nodes: [{
        nodeId: "resolve",
        operation: {
          operationId: lock.operationId,
          operationVersion: lock.operationVersion,
          inputSchemaHash: lock.inputSchemaHash,
          outputSchemaHash: lock.outputSchemaHash
        },
        inputs: {},
        failurePolicy: "FAIL_FAST",
        budget: { maximumRows: 10, maximumCandidates: 10, maximumOutputBytes: 4_096, maximumExecutionMs: 1_000 }
      }],
      outputs: [{
        name: "result",
        binding: { kind: "NODE_OUTPUT", port, nodeId: "resolve", outputPort: "result" }
      }],
      budgets: {
        maximumNodes: 1,
        maximumDepth: 1,
        maximumRows: 10,
        maximumCandidates: 10,
        maximumOutputBytes: 4_096,
        maximumExecutionMs: 1_000
      }
    },
    parameters: {},
    parameterSchemaHash: digest("8"),
    snapshotPolicy: { mode: "LATEST_AT_START", allowDowngrade: false }
  };
}

function executionReceipt(): Record<string, unknown> {
  return {
    receiptId: "receipt-1",
    operationId: lock.operationId,
    operationVersion: lock.operationVersion,
    providerId: "gowm.reference-catalog",
    providerVersion: "1.0.0",
    inputHash: digest("1"),
    outputHash: digest("2"),
    computeSnapshotHash: digest("3"),
    generatedAt: "2026-08-27T00:00:00.000Z",
    durationMs: 1,
    method: { engine: "test", engineVersion: "1", methodId: "validate", methodVersion: "1" },
    changes: { repairApplied: false, typeChanged: false },
    warnings: []
  };
}

const semanticEntry = {
  operationId: lock.operationId,
  operationVersion: lock.operationVersion,
  semanticProfile,
  semanticProfileHash
};

function semantics(overrides: Partial<CapabilitySemanticCatalog> = {}): CapabilitySemanticCatalog {
  const profiles = [semanticEntry];
  return {
    schemaVersion: "1.1",
    contractCatalogRevision: revision,
    bindingRevision,
    profiles,
    catalogHash: canonicalHash(profiles),
    ...overrides
  };
}

function availability(status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "DISABLED" = "AVAILABLE"): OperationAvailabilityList {
  return {
    schemaVersion: "1.0",
    checkedAt: "2026-08-27T00:00:00.000Z",
    operations: [{
      operationId: lock.operationId,
      operationVersion: lock.operationVersion,
      maturity: "STABLE",
      availability: status,
      reasonCodes: status === "AVAILABLE" ? ["READY"] : ["TEST"],
      checkedAt: "2026-08-27T00:00:00.000Z",
      validUntil: "2026-08-27T00:00:05.000Z",
      contractCatalogRevision: revision,
      bindingRevision
    }]
  };
}

function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

function client(fetchImplementation: typeof fetch, extra: Partial<ConstructorParameters<typeof GowmGatewayClient>[0]> = {}) {
  return new GowmGatewayClient({
    baseUrl: "https://gateway.invalid/",
    credential: () => "deployment-token",
    fetch: fetchImplementation,
    timeoutMs: 1_000,
    maxRetries: 0,
    ...extra
  });
}

describe("GOWM Gateway client v2", () => {
  it("accepts content revisions without registry-N or provider identity", () => {
    const result = client(async () => jsonResponse({})).validateCatalog(catalog(), [lock], [
      { operationId: "spatial.find-nearby", operationVersion: "1.0" }
    ], revision);
    expect(result.requiredReady).toBe(true);
    expect(result.contractCatalogRevision).toBe(revision);
    expect(result.optionalCapabilities).toEqual([
      { operationId: "spatial.find-nearby", available: false, reason: "NOT_REGISTERED" }
    ]);
  });

  it("fails closed on maturity, schema, and port drift", () => {
    const drifted = catalog({
      capabilities: [{
        ...catalog().capabilities[0]!,
        operationId: lock.operationId,
        operationVersion: lock.operationVersion,
        maturity: "EXPERIMENTAL",
        inputSchemaHash: digest("9"),
        outputSchemaHash: lock.outputSchemaHash,
        ports: { inputs: [], outputs: [] }
      }]
    });
    const result = client(async () => jsonResponse({})).validateCatalog(drifted, [lock], [], revision);
    expect(result.requiredReady).toBe(false);
    expect(result.requiredMismatches.map((entry) => entry.reason)).toEqual([
      "MATURITY_NOT_ALLOWED",
      "SCHEMA_MISMATCH",
      "PORTS_MISSING"
    ]);
  });

  it("binds catalog, semantics, availability, and content revisions", () => {
    const gateway = client(async () => jsonResponse({}));
    const trusted = gateway.validateTrustedContracts({
      catalog: catalog(),
      semantics: semantics(),
      availability: availability(),
      required: [lock],
      expectedContractCatalogRevision: revision,
      expectedSemanticCatalogHash: semantics().catalogHash
    });
    expect(trusted.requiredReady).toBe(true);

    expect(() => gateway.validateTrustedContracts({
      catalog: catalog(),
      semantics: semantics({ catalogHash: digest("f") }),
      availability: availability(),
      required: [lock],
      expectedContractCatalogRevision: revision,
      expectedSemanticCatalogHash: semantics().catalogHash
    })).toThrowError(expect.objectContaining({ code: "SEMANTIC_CATALOG_HASH_MISMATCH" }));

    expect(gateway.validateTrustedContracts({
      catalog: catalog(),
      semantics: semantics(),
      availability: availability("UNAVAILABLE"),
      required: [lock],
      expectedContractCatalogRevision: revision,
      expectedSemanticCatalogHash: semantics().catalogHash
    }).requiredMismatches).toContainEqual(expect.objectContaining({ reason: "UNAVAILABLE" }));
  });

  it("uses code-point canonical ordering for nested semantic maps", () => {
    const profile: CapabilitySemanticProfile = {
      ...semanticProfile,
      domainStatus: {
        path: "/status",
        mapping: {
          CONFLICTING: "INDETERMINATE",
          INDETERMINATE: "INDETERMINATE",
          NOT_SUPPORTED: "INDETERMINATE",
          NO_DATA: "NO_DATA",
          PARTIALLY_SUPPORTED: "PARTIAL",
          SUPPORTED: "COMPLETED"
        }
      }
    };
    const profileHash = canonicalHash(profile);
    const codePointLock = { ...lock, semanticProfileHash: profileHash };
    const codePointCatalog = catalog({
      capabilities: [{ ...catalog().capabilities[0]!, semanticProfile: profile }]
    });
    const profiles = [{ ...semanticEntry, semanticProfile: profile, semanticProfileHash: profileHash }];

    expect(client(async () => jsonResponse({})).validateTrustedContracts({
      catalog: codePointCatalog,
      semantics: semantics({ profiles, catalogHash: canonicalHash(profiles) }),
      availability: availability(),
      required: [codePointLock],
      expectedContractCatalogRevision: revision,
      expectedSemanticCatalogHash: canonicalHash(profiles)
    }).requiredReady).toBe(true);
  });

  it("uses semantic and availability endpoints with no provider route", async () => {
    const paths: string[] = [];
    const fetchImplementation: typeof fetch = async (input) => {
      const path = new URL(input.toString()).pathname;
      paths.push(path);
      if (path === "/v1/capability-semantics") return jsonResponse(semantics());
      if (path.endsWith("/reference.validate/1.0")) {
        return jsonResponse(path.includes("operation-availability") ? availability().operations[0] : semanticEntry);
      }
      if (path === "/v1/operation-availability") return jsonResponse(availability());
      return jsonResponse({ error: true }, 404);
    };
    const gateway = client(fetchImplementation);
    await gateway.listCapabilitySemantics();
    await gateway.getCapabilitySemantics("reference.validate", "1.0");
    await gateway.listOperationAvailability();
    await gateway.getOperationAvailability("reference.validate", "1.0");
    expect(paths).toEqual([
      "/v1/capability-semantics",
      "/v1/capability-semantics/reference.validate/1.0",
      "/v1/operation-availability",
      "/v1/operation-availability/reference.validate/1.0"
    ]);
  });

  it("uses only locked operation paths and signed transport headers", async () => {
    let capturedUrl = "";
    let capturedHeaders = new Headers();
    let capturedBody = "";
    const fetchImplementation: typeof fetch = async (input, init) => {
      capturedUrl = input.toString();
      capturedHeaders = new Headers(init?.headers);
      capturedBody = String(init?.body);
      return jsonResponse(gatewayResult());
    };
    const result = await client(fetchImplementation).executeOperation(
      lock,
      {
        requestVersion: "1.0",
        requestId: "request-1",
        idempotencyKey: "idempotency-1",
        operationVersion: lock.operationVersion,
        inputSchemaHash: lock.inputSchemaHash,
        outputSchemaHash: lock.outputSchemaHash,
        input: {},
        executionPolicy: {
          deadlineAt: new Date(Date.now() + 1_000).toISOString(),
          maximumResultBytes: 4_096,
          maximumCostClass: "LOW"
        }
      },
      {
        requestId: "request-1",
        delegationToken: "signed.payload.signature",
        traceparent: `00-${"1".repeat(32)}-${"2".repeat(16)}-01`
      }
    );
    expect(result.status).toBe(200);
    expect(capturedUrl).toBe("https://gateway.invalid/v1/operations/reference.validate:execute");
    expect(capturedHeaders.get("authorization")).toBe("Bearer deployment-token");
    expect(capturedHeaders.get("x-request-id")).toBe("request-1");
    expect(capturedHeaders.get("x-gowm-delegation")).toBe("signed.payload.signature");
    expect(capturedHeaders.get("traceparent")).toBe(`00-${"1".repeat(32)}-${"2".repeat(16)}-01`);
    expect(capturedBody).not.toContain("dataScope");
  });

  it("validates request and response bytes with consumer schemas without leaking topology", async () => {
    let calls = 0;
    const invalidCatalog = structuredClone(catalog()) as CapabilityCatalog;
    invalidCatalog.capabilities[0]!["providerUrl"] = "https://provider.internal.example";
    const gateway = client(async () => {
      calls += 1;
      return jsonResponse(invalidCatalog);
    });
    const responseError = await gateway.listCapabilities().catch((error: unknown) => error);
    expect(responseError).toMatchObject({ code: "RESPONSE_SCHEMA_MISMATCH" });
    expect(String(responseError)).not.toContain("provider.internal.example");
    expect(calls).toBe(1);

    calls = 0;
    await expect(client(async () => {
      calls += 1;
      return jsonResponse({});
    }).submitWorldQuery({ requestId: "request-1" })).rejects.toMatchObject({ code: "REQUEST_SCHEMA_MISMATCH" });
    expect(calls).toBe(0);
  });

  it("treats binding drift as an availability refresh instead of contract drift", () => {
    const changedBinding = digest("c");
    const gateway = client(async () => jsonResponse({}));
    expect(() => gateway.validateTrustedContracts({
      catalog: catalog({ bindingRevision: changedBinding }),
      semantics: semantics({ bindingRevision: changedBinding }),
      availability: availability(),
      required: [lock],
      expectedContractCatalogRevision: revision,
      expectedSemanticCatalogHash: semantics().catalogHash
    })).toThrowError(expect.objectContaining({ code: "AVAILABILITY_REFRESH_REQUIRED" }));
  });

  it("rejects every body authority shape before transport", async () => {
    for (const field of ["actor", "actorId", "dataScope", "dataScopes", "datasetScope", "datasetScopes", "permissions", "authorizationContextHash"]) {
      let calls = 0;
      const gateway = client(async () => {
        calls += 1;
        return jsonResponse({});
      });
      await expect(gateway.submitWorldQuery({ nested: { [field]: "forged" } })).rejects.toMatchObject({
        code: "BODY_AUTHORITY_FIELD_FORBIDDEN"
      });
      expect(calls).toBe(0);
    }
  });

  it("rejects direct execution when the request does not match its lock", async () => {
    let calls = 0;
    const gateway = client(async () => {
      calls += 1;
      return jsonResponse({});
    });
    await expect(gateway.executeOperation(lock, {
      operationVersion: "9.9",
      inputSchemaHash: lock.inputSchemaHash,
      outputSchemaHash: lock.outputSchemaHash
    })).rejects.toMatchObject({ code: "OPERATION_LOCK_MISMATCH" });
    expect(calls).toBe(0);
  });

  it("retains a bounded upstream protocol code on unexpected HTTP responses", async () => {
    const gateway = client(async () => jsonResponse({ error: { code: "INPUT_SCHEMA_INVALID", detail: "not retained" } }, 422));
    await expect(gateway.executeOperation(lock, {
      requestVersion: "1.0",
      requestId: "request-1",
      idempotencyKey: "idempotency-1",
      operationVersion: lock.operationVersion,
      inputSchemaHash: lock.inputSchemaHash,
      outputSchemaHash: lock.outputSchemaHash,
      input: {},
      executionPolicy: {
        deadlineAt: new Date(Date.now() + 1_000).toISOString(),
        maximumResultBytes: 4_096,
        maximumCostClass: "LOW"
      }
    })).rejects.toMatchObject({ code: "HTTP_422_INPUT_SCHEMA_INVALID", status: 422, retryable: false });
  });

  it("requests asynchronous world-query execution and polls terminal jobs", async () => {
    const paths: string[] = [];
    const prefer: Array<string | null> = [];
    let polls = 0;
    const fetchImplementation: typeof fetch = async (input, init) => {
      const path = new URL(input.toString()).pathname;
      paths.push(path);
      prefer.push(new Headers(init?.headers).get("prefer"));
      if (path === "/v1/world-queries") return jsonResponse(gatewayJob("QUEUED"), 202);
      if (path === "/v1/jobs/job-1") {
        polls += 1;
        return jsonResponse(gatewayJob(polls === 1 ? "RUNNING" : "COMPLETED"));
      }
      if (path === "/v1/world-queries/query-1:cancel") return jsonResponse(gatewayJob("CANCELLED"));
      if (path === "/v1/receipts/receipt-1") return jsonResponse(executionReceipt());
      return jsonResponse({ error: true }, 404);
    };
    const gateway = client(fetchImplementation, { sleep: async () => undefined });
    await expect(gateway.submitWorldQuery(worldQuerySubmission(), { preferAsync: true })).resolves.toMatchObject({ status: 202 });
    await expect(gateway.pollJob("job-1")).resolves.toMatchObject({ status: "COMPLETED" });
    await expect(gateway.cancelWorldQuery("query-1")).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(gateway.getReceipt("receipt-1")).resolves.toMatchObject({ receiptId: "receipt-1" });
    expect(paths).toEqual([
      "/v1/world-queries",
      "/v1/jobs/job-1",
      "/v1/jobs/job-1",
      "/v1/world-queries/query-1:cancel",
      "/v1/receipts/receipt-1"
    ]);
    expect(prefer[0]).toBe("respond-async");
  });

  it("honors Retry-After and retries only bounded retryable statuses", async () => {
    let calls = 0;
    const delays: number[] = [];
    const gateway = client(async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({ error: true }, 503, { "retry-after": "1" }) : jsonResponse(catalog());
    }, {
      maxRetries: 1,
      timeoutMs: 5_000,
      sleep: async (milliseconds) => { delays.push(milliseconds); }
    });
    await expect(gateway.listCapabilities()).resolves.toMatchObject({ contractCatalogRevision: revision });
    expect(calls).toBe(2);
    expect(delays).toEqual([1_000]);

    calls = 0;
    await expect(client(async () => {
      calls += 1;
      return jsonResponse({ error: true }, 403);
    }, { maxRetries: 3 }).listCapabilities()).rejects.toMatchObject({ status: 403, retryable: false });
    expect(calls).toBe(1);
  });

  it("enforces caller deadlines and request/response limits", async () => {
    let calls = 0;
    const gateway = client(async () => {
      calls += 1;
      return jsonResponse(catalog());
    });
    await expect(gateway.listCapabilities({ deadlineAt: new Date(Date.now() - 1) })).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED" });
    expect(calls).toBe(0);

    await expect(client(async () => jsonResponse({ large: true }, 200, { "content-length": "999" }), {
      maxResponseBytes: 10
    }).listCapabilities()).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });

    await expect(client(async () => jsonResponse({}), { maxRequestBytes: 10 }).submitWorldQuery({ payload: "too large" }))
      .rejects.toMatchObject({ code: "REQUEST_TOO_LARGE" });
  });

  it("propagates AbortSignal and opens then recovers its circuit", async () => {
    let now = 1_000;
    let fail = true;
    const fetchImplementation: typeof fetch = async (_input, init) => {
      if (init?.signal?.aborted) throw init.signal.reason;
      if (fail) throw new Error("network down");
      return jsonResponse(catalog());
    };
    const gateway = client(fetchImplementation, {
      now: () => now,
      circuitFailureThreshold: 1,
      circuitCooldownMs: 100,
      maxRetries: 0
    });
    await expect(gateway.listCapabilities()).rejects.toBeInstanceOf(GatewayProtocolError);
    await expect(gateway.listCapabilities()).rejects.toBeInstanceOf(CircuitOpenError);
    now += 101;
    fail = false;
    await expect(gateway.listCapabilities()).resolves.toMatchObject({ contractCatalogRevision: revision });

    const controller = new AbortController();
    controller.abort();
    await expect(gateway.listCapabilities({ signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("bounds transport and polling with one overall deadline", async () => {
    let transportCalls = 0;
    const hangingFetch: typeof fetch = async (_input, init) => {
      transportCalls += 1;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    };
    await expect(client(hangingFetch, { timeoutMs: 10, maxRetries: 2 }).listCapabilities())
      .rejects.toMatchObject({ code: "DEADLINE_EXCEEDED" });
    expect(transportCalls).toBe(1);

    let now = 1_000;
    const gateway = client(async () => jsonResponse(gatewayJob("RUNNING")), {
      now: () => now,
      timeoutMs: 10,
      sleep: async (milliseconds) => { now += milliseconds; }
    });
    await expect(gateway.pollJob("job-1", {}, 5)).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED" });
  });
});
