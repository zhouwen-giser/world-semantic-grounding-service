import { describe, expect, it } from "vitest";

import { CircuitOpenError } from "./circuit-breaker.js";
import { GatewayProtocolError, GowmGatewayClient } from "./client.js";
import type { CapabilityCatalog, OperationLock } from "./types.js";

const lock: OperationLock = {
  operationId: "reference.validate",
  operationVersion: "1.0",
  providerId: "gowm.reference-catalog",
  maturity: "PREVIEW",
  inputSchemaHash: `sha256:${"1".repeat(64)}`,
  outputSchemaHash: `sha256:${"2".repeat(64)}`
};

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

describe("GOWM Gateway client", () => {
  it("validates exact required locks and degrades missing optional capabilities", () => {
    const catalog: CapabilityCatalog = {
      registryVersion: "registry-7",
      capabilities: [
        {
          operationId: lock.operationId,
          operationVersion: lock.operationVersion,
          providerId: lock.providerId,
          maturity: "PREVIEW",
          inputSchemaHash: lock.inputSchemaHash,
          outputSchemaHash: lock.outputSchemaHash,
          ports: { inputs: [], outputs: [{ name: "result", schemaUri: "urn:test", schemaHash: lock.outputSchemaHash, valueKind: "ANY", unitSemantics: "UNSPECIFIED" }] }
        }
      ]
    };
    const result = client(async () => jsonResponse({})).validateCatalog(catalog, [lock], [
      { operationId: "spatial.find-nearby", operationVersion: "1.0" }
    ]);
    expect(result.requiredReady).toBe(true);
    expect(result.optionalCapabilities).toEqual([
      { operationId: "spatial.find-nearby", available: false, reason: "NOT_REGISTERED" }
    ]);
  });

  it("fails required readiness when provider identity is unavailable", () => {
    const catalog: CapabilityCatalog = {
      registryVersion: "registry-1",
      capabilities: [{
        operationId: lock.operationId,
        operationVersion: lock.operationVersion,
        maturity: "PREVIEW",
        inputSchemaHash: lock.inputSchemaHash,
        outputSchemaHash: lock.outputSchemaHash,
        ports: { inputs: [], outputs: [{ name: "result", schemaUri: "urn:test", schemaHash: lock.outputSchemaHash, valueKind: "ANY", unitSemantics: "UNSPECIFIED" }] }
      }]
    };
    const result = client(async () => jsonResponse({})).validateCatalog(catalog, [lock], []);
    expect(result.requiredReady).toBe(false);
    expect(result.requiredMismatches[0]?.reason).toBe("PROVIDER_ID_UNAVAILABLE");
  });

  it("fails closed on provider, maturity, and schema drift", () => {
    const catalog: CapabilityCatalog = {
      registryVersion: "registry-2",
      capabilities: [{
        operationId: lock.operationId,
        operationVersion: lock.operationVersion,
        providerId: "gowm.wrong-provider",
        maturity: "EXPERIMENTAL",
        inputSchemaHash: `sha256:${"9".repeat(64)}`,
        outputSchemaHash: lock.outputSchemaHash,
        ports: { inputs: [], outputs: [] }
      }]
    };
    const result = client(async () => jsonResponse({})).validateCatalog(catalog, [lock], []);
    expect(result.requiredReady).toBe(false);
    expect(result.requiredMismatches.map((entry) => entry.reason)).toEqual([
      "PROVIDER_MISMATCH",
      "MATURITY_NOT_ALLOWED",
      "SCHEMA_MISMATCH",
      "PORTS_MISSING"
    ]);
  });

  it("uses only locked operation paths and propagates transport headers", async () => {
    let capturedUrl = "";
    let capturedHeaders = new Headers();
    let capturedBody = "";
    const fetchImplementation: typeof fetch = async (input, init) => {
      capturedUrl = input.toString();
      capturedHeaders = new Headers(init?.headers);
      capturedBody = String(init?.body);
      return jsonResponse({ status: "COMPLETED" });
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
        executionPolicy: { deadlineAt: new Date(Date.now() + 1_000).toISOString() }
      },
      { traceparent: `00-${"1".repeat(32)}-${"2".repeat(16)}-01` }
    );
    expect(result.status).toBe(200);
    expect(capturedUrl).toBe("https://gateway.invalid/v1/operations/reference.validate:execute");
    expect(capturedHeaders.get("authorization")).toBe("Bearer deployment-token");
    expect(capturedHeaders.get("traceparent")).toBe(`00-${"1".repeat(32)}-${"2".repeat(16)}-01`);
    expect(capturedBody).not.toContain("dataScope");
  });

  it("rejects body scope injection before transport", async () => {
    let calls = 0;
    const fetchImplementation: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({});
    };
    await expect(client(fetchImplementation).submitWorldQuery({ dataScope: "forged" })).rejects.toMatchObject({
      code: "BODY_AUTHORITY_FIELD_FORBIDDEN"
    });
    expect(calls).toBe(0);
  });

  it("rejects direct execution when the request does not match its lock", async () => {
    let calls = 0;
    const fetchImplementation: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({});
    };
    await expect(
      client(fetchImplementation).executeOperation(lock, {
        operationVersion: "latest",
        inputSchemaHash: lock.inputSchemaHash,
        outputSchemaHash: lock.outputSchemaHash
      })
    ).rejects.toMatchObject({ code: "OPERATION_LOCK_MISMATCH" });
    expect(calls).toBe(0);
  });

  it("honors Retry-After for 503 and retries a bounded number of times", async () => {
    let calls = 0;
    const delays: number[] = [];
    const fetchImplementation: typeof fetch = async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({ error: true }, 503, { "retry-after": "1" }) : jsonResponse({ registryVersion: "registry-1", capabilities: [] });
    };
    const gateway = client(fetchImplementation, {
      maxRetries: 1,
      timeoutMs: 5_000,
      sleep: async (milliseconds) => { delays.push(milliseconds); }
    });
    await expect(gateway.listCapabilities()).resolves.toMatchObject({ registryVersion: "registry-1" });
    expect(calls).toBe(2);
    expect(delays).toEqual([1_000]);
  });

  it("does not retry unsafe 403 responses", async () => {
    let calls = 0;
    const fetchImplementation: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({ error: true }, 403);
    };
    await expect(client(fetchImplementation, { maxRetries: 3 }).listCapabilities()).rejects.toMatchObject({
      status: 403,
      retryable: false
    });
    expect(calls).toBe(1);
  });

  it("polls async jobs and uses only fixed cancel and receipt routes", async () => {
    const paths: string[] = [];
    let polls = 0;
    const fetchImplementation: typeof fetch = async (input) => {
      const path = new URL(input.toString()).pathname;
      paths.push(path);
      if (path === "/v1/jobs/job-1") {
        polls += 1;
        return jsonResponse({ jobId: "job-1", status: polls === 1 ? "RUNNING" : "COMPLETED" });
      }
      if (path === "/v1/world-queries/query-1:cancel") return jsonResponse({ queryId: "query-1", status: "CANCELLED" });
      if (path === "/v1/receipts/receipt-1") return jsonResponse({ receiptId: "receipt-1" });
      return jsonResponse({ error: true }, 404);
    };
    const gateway = client(fetchImplementation, { sleep: async () => undefined });
    await expect(gateway.pollJob("job-1")).resolves.toMatchObject({ status: "COMPLETED" });
    await expect(gateway.cancelWorldQuery("query-1")).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(gateway.getReceipt("receipt-1")).resolves.toMatchObject({ receiptId: "receipt-1" });
    expect(paths).toEqual([
      "/v1/jobs/job-1",
      "/v1/jobs/job-1",
      "/v1/world-queries/query-1:cancel",
      "/v1/receipts/receipt-1"
    ]);
  });

  it("uses the minimum caller and client deadline", async () => {
    let calls = 0;
    const fetchImplementation: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({ registryVersion: "registry-1", capabilities: [] });
    };
    await expect(
      client(fetchImplementation).listCapabilities({ deadlineAt: new Date(Date.now() - 1) })
    ).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED" });
    expect(calls).toBe(0);
  });

  it("rejects oversized responses before parsing", async () => {
    const fetchImplementation: typeof fetch = async () => jsonResponse({ large: true }, 200, { "content-length": "999" });
    await expect(client(fetchImplementation, { maxResponseBytes: 10 }).listCapabilities()).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE"
    });
  });

  it("propagates AbortSignal and opens then recovers its circuit", async () => {
    let now = 1_000;
    let fail = true;
    const fetchImplementation: typeof fetch = async (_input, init) => {
      if (init?.signal?.aborted) throw init.signal.reason;
      if (fail) throw new Error("network down");
      return jsonResponse({ registryVersion: "registry-1", capabilities: [] });
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
    await expect(gateway.listCapabilities()).resolves.toMatchObject({ registryVersion: "registry-1" });

    const controller = new AbortController();
    controller.abort();
    await expect(gateway.listCapabilities({ signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" });
  });
});
