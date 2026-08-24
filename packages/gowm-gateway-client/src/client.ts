import { CircuitBreaker } from "./circuit-breaker.js";
import type {
  CapabilityCatalog,
  CapabilityMismatch,
  CatalogValidation,
  GatewayRequestContext,
  OperationLock,
  OptionalOperationLock
} from "./types.js";

const retryableStatuses = new Set([429, 502, 503]);
const terminalJobStatuses = new Set(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]);
const traceparentPattern = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u;
const operationIdPattern = /^[a-z][a-z0-9.-]{2,127}$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

export class GatewayProtocolError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | null,
    readonly retryable: boolean
  ) {
    super(`GOWM Gateway request failed: ${code}`);
  }
}

export interface GowmGatewayClientConfig {
  baseUrl: string | URL;
  credential: () => string | Promise<string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  maxResponseBytes?: number;
  maxRequestBytes?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  circuitFailureThreshold?: number;
  circuitCooldownMs?: number;
  now?: () => number;
  random?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

interface RequestResult<T> {
  status: number;
  value: T;
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

function assertNoAuthorityFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoAuthorityFields);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (["dataScope", "data_scope", "dataScopeClaim", "actor", "permissions", "authorization"].includes(key)) {
      throw new GatewayProtocolError("BODY_AUTHORITY_FIELD_FORBIDDEN", null, false);
    }
    assertNoAuthorityFields(entry);
  }
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  if (/^\d+$/u.test(value)) return Number(value) * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

async function readBoundedJson<T>(response: Response, maximumBytes: number): Promise<T> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new GatewayProtocolError("RESPONSE_TOO_LARGE", response.status, false);
  }
  if (!response.body) throw new GatewayProtocolError("EMPTY_RESPONSE", response.status, false);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel("response exceeds configured limit");
      throw new GatewayProtocolError("RESPONSE_TOO_LARGE", response.status, false);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
  } catch {
    throw new GatewayProtocolError("INVALID_JSON_RESPONSE", response.status, false);
  }
}

export class GowmGatewayClient {
  readonly #baseUrl: URL;
  readonly #fetch: typeof fetch;
  readonly #credential: () => string | Promise<string>;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #maxResponseBytes: number;
  readonly #maxRequestBytes: number;
  readonly #retryBaseDelayMs: number;
  readonly #retryMaxDelayMs: number;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly #circuit: CircuitBreaker;

  constructor(config: GowmGatewayClientConfig) {
    this.#baseUrl = new URL(config.baseUrl);
    if (!(["https:", "http:"].includes(this.#baseUrl.protocol))) throw new Error("Gateway base URL must be HTTP(S)");
    if (this.#baseUrl.username || this.#baseUrl.password || this.#baseUrl.search || this.#baseUrl.hash) {
      throw new Error("Gateway base URL cannot contain credentials, query, or fragment");
    }
    this.#fetch = config.fetch ?? globalThis.fetch;
    this.#credential = config.credential;
    this.#timeoutMs = config.timeoutMs ?? 10_000;
    this.#maxRetries = config.maxRetries ?? 2;
    this.#maxResponseBytes = config.maxResponseBytes ?? 8 * 1024 * 1024;
    this.#maxRequestBytes = config.maxRequestBytes ?? 2 * 1024 * 1024;
    this.#retryBaseDelayMs = config.retryBaseDelayMs ?? 100;
    this.#retryMaxDelayMs = config.retryMaxDelayMs ?? 5_000;
    this.#now = config.now ?? Date.now;
    this.#random = config.random ?? Math.random;
    this.#sleep = config.sleep ?? defaultSleep;
    this.#circuit = new CircuitBreaker(
      config.circuitFailureThreshold ?? 5,
      config.circuitCooldownMs ?? 10_000,
      this.#now
    );
  }

  async listCapabilities(context: GatewayRequestContext = {}): Promise<CapabilityCatalog> {
    return (await this.#request<CapabilityCatalog>("GET", "/v1/capabilities", undefined, context, [200])).value;
  }

  validateCatalog(
    catalog: CapabilityCatalog,
    required: OperationLock[],
    optional: OptionalOperationLock[]
  ): CatalogValidation {
    if (!/^registry-[0-9]+$/u.test(catalog.registryVersion) || !Array.isArray(catalog.capabilities)) {
      throw new GatewayProtocolError("INVALID_CAPABILITY_CATALOG", 200, false);
    }
    const byKey = new Map(catalog.capabilities.map((entry) => [`${entry.operationId}@${entry.operationVersion}`, entry]));
    const requiredMismatches: CapabilityMismatch[] = [];
    for (const lock of required) {
      const capability = byKey.get(`${lock.operationId}@${lock.operationVersion}`);
      if (!capability) {
        requiredMismatches.push({ operationId: lock.operationId, reason: "NOT_REGISTERED" });
        continue;
      }
      if (!capability.providerId) {
        requiredMismatches.push({ operationId: lock.operationId, reason: "PROVIDER_ID_UNAVAILABLE", expected: lock.providerId });
      } else if (capability.providerId !== lock.providerId) {
        requiredMismatches.push({ operationId: lock.operationId, reason: "PROVIDER_MISMATCH", expected: lock.providerId, actual: capability.providerId });
      }
      if (!(capability.maturity === "PREVIEW" || capability.maturity === "STABLE")) {
        requiredMismatches.push({ operationId: lock.operationId, reason: "MATURITY_NOT_ALLOWED", expected: "PREVIEW|STABLE", actual: capability.maturity });
      }
      if (capability.inputSchemaHash !== lock.inputSchemaHash || capability.outputSchemaHash !== lock.outputSchemaHash) {
        requiredMismatches.push({ operationId: lock.operationId, reason: "SCHEMA_MISMATCH" });
      }
      if (!capability.ports || !Array.isArray(capability.ports.inputs) || !Array.isArray(capability.ports.outputs) || capability.ports.outputs.length === 0) {
        requiredMismatches.push({ operationId: lock.operationId, reason: "PORTS_MISSING" });
      }
    }
    return {
      registryVersion: catalog.registryVersion,
      requiredReady: requiredMismatches.length === 0,
      requiredMismatches,
      optionalCapabilities: optional.map((lock) => ({
        operationId: lock.operationId,
        available: byKey.has(`${lock.operationId}@${lock.operationVersion}`),
        ...(byKey.has(`${lock.operationId}@${lock.operationVersion}`) ? {} : { reason: "NOT_REGISTERED" })
      }))
    };
  }

  async executeOperation(
    lock: OperationLock,
    request: Record<string, unknown>,
    context: GatewayRequestContext = {}
  ): Promise<RequestResult<unknown>> {
    if (!operationIdPattern.test(lock.operationId)) throw new GatewayProtocolError("INVALID_LOCKED_OPERATION", null, false);
    if (request["operationVersion"] !== lock.operationVersion || request["inputSchemaHash"] !== lock.inputSchemaHash || request["outputSchemaHash"] !== lock.outputSchemaHash) {
      throw new GatewayProtocolError("OPERATION_LOCK_MISMATCH", null, false);
    }
    return this.#request("POST", `/v1/operations/${encodeURIComponent(lock.operationId)}:execute`, request, context, [200, 202]);
  }

  async submitWorldQuery(request: Record<string, unknown>, context: GatewayRequestContext = {}): Promise<RequestResult<unknown>> {
    return this.#request("POST", "/v1/world-queries", request, context, [200, 202]);
  }

  async getWorldQuery(queryId: string, context: GatewayRequestContext = {}): Promise<unknown> {
    this.#assertIdentifier(queryId);
    return (await this.#request("GET", `/v1/world-queries/${encodeURIComponent(queryId)}`, undefined, context, [200])).value;
  }

  async cancelWorldQuery(queryId: string, context: GatewayRequestContext = {}): Promise<unknown> {
    this.#assertIdentifier(queryId);
    return (await this.#request("POST", `/v1/world-queries/${encodeURIComponent(queryId)}:cancel`, undefined, context, [200])).value;
  }

  async getJob(jobId: string, context: GatewayRequestContext = {}): Promise<Record<string, unknown>> {
    this.#assertIdentifier(jobId);
    return (await this.#request<Record<string, unknown>>("GET", `/v1/jobs/${encodeURIComponent(jobId)}`, undefined, context, [200])).value;
  }

  async getReceipt(receiptId: string, context: GatewayRequestContext = {}): Promise<unknown> {
    this.#assertIdentifier(receiptId);
    return (await this.#request("GET", `/v1/receipts/${encodeURIComponent(receiptId)}`, undefined, context, [200])).value;
  }

  async pollJob(jobId: string, context: GatewayRequestContext = {}, intervalMs = 250): Promise<Record<string, unknown>> {
    while (true) {
      const job = await this.getJob(jobId, context);
      if (typeof job["status"] !== "string") throw new GatewayProtocolError("INVALID_JOB_RECORD", 200, false);
      if (terminalJobStatuses.has(job["status"])) return job;
      const remaining = context.deadlineAt ? context.deadlineAt.getTime() - this.#now() : intervalMs;
      if (remaining <= 0) throw new GatewayProtocolError("DEADLINE_EXCEEDED", null, true);
      await this.#sleep(Math.min(intervalMs, remaining), context.signal);
    }
  }

  #assertIdentifier(value: string): void {
    if (!identifierPattern.test(value)) throw new GatewayProtocolError("INVALID_IDENTIFIER", null, false);
  }

  async #request<T>(
    method: "GET" | "POST",
    path: string,
    body: Record<string, unknown> | undefined,
    context: GatewayRequestContext,
    expectedStatuses: number[]
  ): Promise<RequestResult<T>> {
    if (body) assertNoAuthorityFields(body);
    const encodedBody = body ? JSON.stringify(body) : undefined;
    if (encodedBody && Buffer.byteLength(encodedBody, "utf8") > this.#maxRequestBytes) {
      throw new GatewayProtocolError("REQUEST_TOO_LARGE", null, false);
    }
    if (context.traceparent && !traceparentPattern.test(context.traceparent)) {
      throw new GatewayProtocolError("INVALID_TRACEPARENT", null, false);
    }
    this.#circuit.beforeRequest();
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      const now = this.#now();
      const deadline = Math.min(now + this.#timeoutMs, context.deadlineAt?.getTime() ?? Number.POSITIVE_INFINITY);
      if (deadline <= now) throw new GatewayProtocolError("DEADLINE_EXCEEDED", null, true);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("GOWM Gateway deadline exceeded")), deadline - now);
      const onAbort = () => controller.abort(context.signal?.reason);
      context.signal?.addEventListener("abort", onAbort, { once: true });
      if (context.signal?.aborted) controller.abort(context.signal.reason);
      try {
        const credential = await this.#credential();
        if (!credential) throw new GatewayProtocolError("MISSING_GATEWAY_CREDENTIAL", null, false);
        const headers = new Headers({ accept: "application/json", authorization: `Bearer ${credential}` });
        if (encodedBody !== undefined) headers.set("content-type", "application/json");
        if (context.traceparent) headers.set("traceparent", context.traceparent);
        const init: RequestInit = { method, headers, signal: controller.signal };
        if (encodedBody !== undefined) init.body = encodedBody;
        const response = await this.#fetch(new URL(path, this.#baseUrl), init);
        if (retryableStatuses.has(response.status) && attempt < this.#maxRetries) {
          const retryAfter = parseRetryAfter(response.headers.get("retry-after"), this.#now());
          const fallback = this.#retryBaseDelayMs * 2 ** attempt * (0.5 + this.#random());
          const delay = Math.min(this.#retryMaxDelayMs, retryAfter ?? fallback);
          if (this.#now() + delay >= deadline) throw new GatewayProtocolError("DEADLINE_EXCEEDED", response.status, true);
          await this.#sleep(delay, context.signal);
          continue;
        }
        if (!expectedStatuses.includes(response.status)) {
          const retryable = retryableStatuses.has(response.status);
          if (retryable) this.#circuit.failure();
          throw new GatewayProtocolError(`HTTP_${response.status}`, response.status, retryable);
        }
        const value = await readBoundedJson<T>(response, this.#maxResponseBytes);
        this.#circuit.success();
        return { status: response.status, value };
      } catch (error) {
        lastError = error;
        if (error instanceof GatewayProtocolError) {
          if (!error.retryable || attempt >= this.#maxRetries) throw error;
        } else if (context.signal?.aborted) {
          throw new GatewayProtocolError("ABORTED", null, false);
        } else if (attempt >= this.#maxRetries) {
          this.#circuit.failure();
          throw new GatewayProtocolError("TRANSPORT_FAILURE", null, true);
        }
      } finally {
        clearTimeout(timeout);
        context.signal?.removeEventListener("abort", onAbort);
      }
    }
    this.#circuit.failure();
    throw lastError instanceof Error ? lastError : new GatewayProtocolError("TRANSPORT_FAILURE", null, true);
  }
}
