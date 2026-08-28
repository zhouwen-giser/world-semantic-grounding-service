import { createHash } from "node:crypto";

import {
  defaultGowmConsumerSchemaRegistry,
  GowmSchemaValidationError,
  type GowmConsumerSchemaPath,
  type GowmConsumerSchemaRegistry
} from "@wsgs/gowm-contract-intake";

import { CircuitBreaker } from "./circuit-breaker.js";
import type {
  CapabilityCatalog,
  CapabilityMismatch,
  CapabilitySemanticCatalog,
  CapabilitySemanticEntry,
  CatalogValidation,
  GatewayRequestContext,
  OperationAvailability,
  OperationAvailabilityList,
  OperationLock,
  OptionalOperationLock,
  TrustedGatewayContractInput
} from "./types.js";

const retryableStatuses = new Set([429, 502, 503]);
const terminalJobStatuses = new Set(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]);
const upstreamProtocolFailureCodes = new Set([
  "EMPTY_RESPONSE",
  "INVALID_JSON_RESPONSE",
  "RESPONSE_SCHEMA_MISMATCH",
  "RESPONSE_TOO_LARGE"
]);
const traceparentPattern = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u;
const operationIdPattern = /^[a-z][a-z0-9.-]{2,127}$/u;
const operationVersionPattern = /^[0-9]+\.[0-9]+$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const compactJwsPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const authorityFields = new Set([
  "actor",
  "actorId",
  "authorization",
  "authorizationContextHash",
  "dataScope",
  "dataScopes",
  "data_scope",
  "dataScopeClaim",
  "datasetScope",
  "datasetScopes",
  "dataset_scope",
  "permissions",
  "servicePrincipalId"
]);

export class GatewayProtocolError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly details?: Readonly<Record<string, unknown>>
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
  schemaRegistry?: Pick<GowmConsumerSchemaRegistry, "validate">;
}

export interface GatewayResponse<T> {
  status: number;
  value: T;
}

interface GatewaySchemaPolicy {
  request?: GowmConsumerSchemaPath;
  responses?: Readonly<Partial<Record<number, GowmConsumerSchemaPath>>>;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  });
}

function canonicalSha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
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
    if (authorityFields.has(key)) {
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

function upstreamErrorCode(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const nested = record["error"];
  const candidate = typeof record["code"] === "string"
    ? record["code"]
    : nested && typeof nested === "object" && !Array.isArray(nested) && typeof (nested as Record<string, unknown>)["code"] === "string"
      ? (nested as Record<string, unknown>)["code"] as string
      : null;
  if (!candidate) return null;
  const normalized = candidate.trim().toUpperCase().replace(/[^A-Z0-9_:-]+/gu, "_");
  return /^[A-Z][A-Z0-9_:-]{0,127}$/u.test(normalized) ? normalized : null;
}

function upstreamErrorDetails(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const nested = (value as Record<string, unknown>)["error"];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return undefined;
  const details = (nested as Record<string, unknown>)["details"];
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const allowed = new Set([
    "stage", "nodeId", "operationId", "operationVersion", "requested", "allowed",
    "schemaUri", "registeredHash", "canonicalHash", "issues", "path", "keyword"
  ]);
  return Object.fromEntries(Object.entries(details as Record<string, unknown>)
    .filter(([key]) => allowed.has(key)));
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
  readonly #schemaRegistry: Pick<GowmConsumerSchemaRegistry, "validate">;

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
    this.#schemaRegistry = config.schemaRegistry ?? defaultGowmConsumerSchemaRegistry();
    this.#circuit = new CircuitBreaker(
      config.circuitFailureThreshold ?? 5,
      config.circuitCooldownMs ?? 10_000,
      this.#now
    );
  }

  async listCapabilities(context: GatewayRequestContext = {}): Promise<CapabilityCatalog> {
    return (await this.#request<CapabilityCatalog>("GET", "/v1/capabilities", undefined, context, [200], {
      responses: { 200: "platform/capability-list-response.schema.json" }
    })).value;
  }

  async getCapability(operationId: string, context: GatewayRequestContext = {}): Promise<unknown> {
    this.#assertOperation(operationId);
    return (await this.#request("GET", `/v1/capabilities/${encodeURIComponent(operationId)}`, undefined, context, [200], {
      responses: { 200: "platform/capability-versions-response.schema.json" }
    })).value;
  }

  async listCapabilitySemantics(context: GatewayRequestContext = {}): Promise<CapabilitySemanticCatalog> {
    return (await this.#request<CapabilitySemanticCatalog>("GET", "/v1/capability-semantics", undefined, context, [200], {
      responses: { 200: "gowm-v0.6.2/capability-semantic-catalog-v1.schema.json" }
    })).value;
  }

  async getCapabilitySemantics(
    operationId: string,
    operationVersion: string,
    context: GatewayRequestContext = {}
  ): Promise<CapabilitySemanticEntry> {
    this.#assertOperation(operationId, operationVersion);
    const entry = (await this.#request<CapabilitySemanticEntry>(
      "GET",
      `/v1/capability-semantics/${encodeURIComponent(operationId)}/${encodeURIComponent(operationVersion)}`,
      undefined,
      context,
      [200]
    )).value;
    this.#validateSchema("gowm-v0.6.2/capability-semantic-profile-v1.schema.json", entry.semanticProfile, 200, false);
    if (entry.operationId !== operationId || entry.operationVersion !== operationVersion
      || !sha256Pattern.test(entry.semanticProfileHash)) {
      throw new GatewayProtocolError("INVALID_SEMANTIC_PROFILE", 200, false);
    }
    return entry;
  }

  async listOperationAvailability(context: GatewayRequestContext = {}): Promise<OperationAvailabilityList> {
    return (await this.#request<OperationAvailabilityList>("GET", "/v1/operation-availability", undefined, context, [200], {
      responses: { 200: "gowm-v0.6.3/operation-availability-list.schema.json" }
    })).value;
  }

  async getOperationAvailability(
    operationId: string,
    operationVersion: string,
    context: GatewayRequestContext = {}
  ): Promise<OperationAvailability> {
    this.#assertOperation(operationId, operationVersion);
    return (await this.#request<OperationAvailability>(
      "GET",
      `/v1/operation-availability/${encodeURIComponent(operationId)}/${encodeURIComponent(operationVersion)}`,
      undefined,
      context,
      [200],
      { responses: { 200: "gowm-v0.6.3/operation-availability.schema.json" } }
    )).value;
  }

  validateCatalog(
    catalog: CapabilityCatalog,
    required: OperationLock[],
    optional: OptionalOperationLock[],
    expectedContractCatalogRevision?: string
  ): CatalogValidation {
    if (!sha256Pattern.test(catalog.contractCatalogRevision)
      || !sha256Pattern.test(catalog.bindingRevision)
      || !Array.isArray(catalog.capabilities)) {
      throw new GatewayProtocolError("INVALID_CAPABILITY_CATALOG", 200, false);
    }
    if (expectedContractCatalogRevision && catalog.contractCatalogRevision !== expectedContractCatalogRevision) {
      throw new GatewayProtocolError("CONTRACT_CATALOG_REVISION_MISMATCH", 200, false);
    }
    const byKey = new Map(catalog.capabilities.map((entry) => [`${entry.operationId}@${entry.operationVersion}`, entry]));
    if (byKey.size !== catalog.capabilities.length) {
      throw new GatewayProtocolError("DUPLICATE_CAPABILITY", 200, false);
    }
    const requiredMismatches: CapabilityMismatch[] = [];
    for (const lock of required) {
      const capability = byKey.get(`${lock.operationId}@${lock.operationVersion}`);
      if (!capability) {
        requiredMismatches.push({ operationId: lock.operationId, reason: "NOT_REGISTERED" });
        continue;
      }
      if (capability.maturity !== lock.maturity) {
        requiredMismatches.push({ operationId: lock.operationId, reason: "MATURITY_NOT_ALLOWED", expected: lock.maturity, actual: capability.maturity });
      }
      if (capability.inputSchemaHash !== lock.inputSchemaHash || capability.outputSchemaHash !== lock.outputSchemaHash) {
        requiredMismatches.push({ operationId: lock.operationId, reason: "SCHEMA_MISMATCH" });
      }
      if (!capability.ports || !Array.isArray(capability.ports.inputs) || !Array.isArray(capability.ports.outputs) || capability.ports.outputs.length === 0) {
        requiredMismatches.push({ operationId: lock.operationId, reason: "PORTS_MISSING" });
      }
    }
    return {
      contractCatalogRevision: catalog.contractCatalogRevision,
      bindingRevision: catalog.bindingRevision,
      requiredReady: requiredMismatches.length === 0,
      requiredMismatches,
      optionalCapabilities: optional.map((lock) => ({
        operationId: lock.operationId,
        available: byKey.has(`${lock.operationId}@${lock.operationVersion}`),
        ...(byKey.has(`${lock.operationId}@${lock.operationVersion}`) ? {} : { reason: "NOT_REGISTERED" })
      }))
    };
  }

  validateTrustedContracts(input: TrustedGatewayContractInput): CatalogValidation {
    this.#validateSchema("platform/capability-list-response.schema.json", input.catalog, 200, false);
    this.#validateSchema("gowm-v0.6.2/capability-semantic-catalog-v1.schema.json", input.semantics, 200, false);
    this.#validateSchema("gowm-v0.6.3/operation-availability-list.schema.json", input.availability, 200, false);
    if (input.catalog.contractCatalogRevision !== input.expectedContractCatalogRevision
      || input.semantics.contractCatalogRevision !== input.expectedContractCatalogRevision) {
      throw new GatewayProtocolError("CONTRACT_CATALOG_REVISION_MISMATCH", 200, false);
    }
    if (input.semantics.catalogHash !== input.expectedSemanticCatalogHash
      || canonicalSha256(input.semantics.profiles) !== input.expectedSemanticCatalogHash) {
      throw new GatewayProtocolError("SEMANTIC_CATALOG_HASH_MISMATCH", 200, false);
    }
    if (input.catalog.bindingRevision !== input.semantics.bindingRevision) {
      throw new GatewayProtocolError("BINDING_REVISION_MISMATCH", 200, false);
    }
    const validation = this.validateCatalog(
      input.catalog,
      input.required,
      input.optional ?? [],
      input.expectedContractCatalogRevision
    );
    const profiles = new Map(input.semantics.profiles.map((profile) => [`${profile.operationId}@${profile.operationVersion}`, profile]));
    const availability = new Map(input.availability.operations.map((entry) => [`${entry.operationId}@${entry.operationVersion}`, entry]));
    if (profiles.size !== input.semantics.profiles.length) {
      throw new GatewayProtocolError("DUPLICATE_SEMANTIC_PROFILE", 200, false);
    }
    if (availability.size !== input.availability.operations.length) {
      throw new GatewayProtocolError("DUPLICATE_OPERATION_AVAILABILITY", 200, false);
    }
    const capabilities = new Map(
      input.catalog.capabilities.map((entry) => [`${entry.operationId}@${entry.operationVersion}`, entry])
    );
    for (const lock of input.required) {
      const key = `${lock.operationId}@${lock.operationVersion}`;
      const profile = profiles.get(key);
      const descriptorProfile = capabilities.get(key)?.semanticProfile;
      if (!profile) {
        validation.requiredMismatches.push({ operationId: lock.operationId, reason: "SEMANTIC_PROFILE_MISSING" });
      } else if (profile.semanticProfileHash !== lock.semanticProfileHash
        || canonicalSha256(profile.semanticProfile) !== lock.semanticProfileHash
        || descriptorProfile === undefined
        || canonicalSha256(descriptorProfile) !== profile.semanticProfileHash) {
        validation.requiredMismatches.push({ operationId: lock.operationId, reason: "SEMANTIC_PROFILE_MISMATCH" });
      }
      const observed = availability.get(key);
      if (!observed) {
        validation.requiredMismatches.push({ operationId: lock.operationId, reason: "AVAILABILITY_MISSING" });
      } else {
        if (observed.contractCatalogRevision !== input.expectedContractCatalogRevision) {
          throw new GatewayProtocolError("AVAILABILITY_CONTRACT_REVISION_MISMATCH", 200, false);
        }
        if (observed.bindingRevision !== input.catalog.bindingRevision) {
          throw new GatewayProtocolError("AVAILABILITY_REFRESH_REQUIRED", 200, false);
        }
        if (observed.availability === "UNAVAILABLE") {
          validation.requiredMismatches.push({ operationId: lock.operationId, reason: "UNAVAILABLE" });
        } else if (observed.availability === "DISABLED") {
          validation.requiredMismatches.push({ operationId: lock.operationId, reason: "DISABLED" });
        }
      }
    }
    validation.requiredReady = validation.requiredMismatches.length === 0;
    return validation;
  }

  async executeOperation(
    lock: OperationLock,
    request: Record<string, unknown>,
    context: GatewayRequestContext = {}
  ): Promise<GatewayResponse<unknown>> {
    this.#assertOperation(lock.operationId, lock.operationVersion);
    if (request["operationVersion"] !== lock.operationVersion || request["inputSchemaHash"] !== lock.inputSchemaHash || request["outputSchemaHash"] !== lock.outputSchemaHash) {
      throw new GatewayProtocolError("OPERATION_LOCK_MISMATCH", null, false);
    }
    return this.#request("POST", `/v1/operations/${encodeURIComponent(lock.operationId)}:execute`, request, context, [200, 202], {
      request: "platform/gateway-execute-request.schema.json",
      responses: {
        200: "platform/capability-result-envelope.schema.json",
        202: "platform/job-record.schema.json"
      }
    });
  }

  async submitWorldQuery(request: Record<string, unknown>, context: GatewayRequestContext = {}): Promise<GatewayResponse<unknown>> {
    return this.#request("POST", "/v1/world-queries", request, context, [200, 202], {
      request: "platform/world-query-submission.schema.json",
      responses: { 200: "platform/world-query-result.schema.json", 202: "platform/job-record.schema.json" }
    });
  }

  async getWorldQuery(queryId: string, context: GatewayRequestContext = {}): Promise<unknown> {
    this.#assertIdentifier(queryId);
    return (await this.#request("GET", `/v1/world-queries/${encodeURIComponent(queryId)}`, undefined, context, [200], {
      responses: { 200: "platform/job-record.schema.json" }
    })).value;
  }

  async cancelWorldQuery(queryId: string, context: GatewayRequestContext = {}): Promise<unknown> {
    this.#assertIdentifier(queryId);
    return (await this.#request("POST", `/v1/world-queries/${encodeURIComponent(queryId)}:cancel`, undefined, context, [200], {
      responses: { 200: "platform/job-record.schema.json" }
    })).value;
  }

  async getJob(jobId: string, context: GatewayRequestContext = {}): Promise<Record<string, unknown>> {
    this.#assertIdentifier(jobId);
    return (await this.#request<Record<string, unknown>>("GET", `/v1/jobs/${encodeURIComponent(jobId)}`, undefined, context, [200], {
      responses: { 200: "platform/job-record.schema.json" }
    })).value;
  }

  async getReceipt(receiptId: string, context: GatewayRequestContext = {}): Promise<unknown> {
    this.#assertIdentifier(receiptId);
    return (await this.#request("GET", `/v1/receipts/${encodeURIComponent(receiptId)}`, undefined, context, [200], {
      responses: { 200: "platform/execution-receipt.schema.json" }
    })).value;
  }

  async pollJob(jobId: string, context: GatewayRequestContext = {}, intervalMs = 250): Promise<Record<string, unknown>> {
    if (!Number.isInteger(intervalMs) || intervalMs < 1) {
      throw new GatewayProtocolError("INVALID_POLL_INTERVAL", null, false);
    }
    const deadlineAt = context.deadlineAt ?? new Date(this.#now() + this.#timeoutMs);
    const boundedContext = { ...context, deadlineAt };
    while (true) {
      const job = await this.getJob(jobId, boundedContext);
      if (typeof job["status"] !== "string") throw new GatewayProtocolError("INVALID_JOB_RECORD", 200, false);
      if (terminalJobStatuses.has(job["status"])) return job;
      const remaining = deadlineAt.getTime() - this.#now();
      if (remaining <= 0) throw new GatewayProtocolError("DEADLINE_EXCEEDED", null, true);
      await this.#sleep(Math.min(intervalMs, remaining), context.signal);
    }
  }

  #assertIdentifier(value: string): void {
    if (!identifierPattern.test(value)) throw new GatewayProtocolError("INVALID_IDENTIFIER", null, false);
  }

  #assertOperation(operationId: string, operationVersion?: string): void {
    if (!operationIdPattern.test(operationId)
      || (operationVersion !== undefined && !operationVersionPattern.test(operationVersion))) {
      throw new GatewayProtocolError("INVALID_LOCKED_OPERATION", null, false);
    }
  }

  async #request<T>(
    method: "GET" | "POST",
    path: string,
    body: Record<string, unknown> | undefined,
    context: GatewayRequestContext,
    expectedStatuses: number[],
    schemaPolicy: GatewaySchemaPolicy = {}
  ): Promise<GatewayResponse<T>> {
    if (body) assertNoAuthorityFields(body);
    const encodedBody = body ? JSON.stringify(body) : undefined;
    if (encodedBody && Buffer.byteLength(encodedBody, "utf8") > this.#maxRequestBytes) {
      throw new GatewayProtocolError("REQUEST_TOO_LARGE", null, false);
    }
    if (body && schemaPolicy.request) this.#validateSchema(schemaPolicy.request, body, null, true);
    if (context.traceparent && !traceparentPattern.test(context.traceparent)) {
      throw new GatewayProtocolError("INVALID_TRACEPARENT", null, false);
    }
    if (context.requestId && !identifierPattern.test(context.requestId)) {
      throw new GatewayProtocolError("INVALID_REQUEST_ID", null, false);
    }
    if (context.delegationToken && !compactJwsPattern.test(context.delegationToken)) {
      throw new GatewayProtocolError("INVALID_DELEGATION_TOKEN", null, false);
    }
    this.#circuit.beforeRequest();
    const overallDeadline = Math.min(
      this.#now() + this.#timeoutMs,
      context.deadlineAt?.getTime() ?? Number.POSITIVE_INFINITY
    );
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      const now = this.#now();
      const deadline = overallDeadline;
      if (deadline <= now) throw new GatewayProtocolError("DEADLINE_EXCEEDED", null, true);
      const controller = new AbortController();
      let deadlineExpired = false;
      const timeout = setTimeout(() => {
        deadlineExpired = true;
        controller.abort(new Error("GOWM Gateway deadline exceeded"));
      }, deadline - now);
      const onAbort = () => controller.abort(context.signal?.reason);
      context.signal?.addEventListener("abort", onAbort, { once: true });
      if (context.signal?.aborted) controller.abort(context.signal.reason);
      try {
        const credential = await this.#credential();
        if (!credential) throw new GatewayProtocolError("MISSING_GATEWAY_CREDENTIAL", null, false);
        const headers = new Headers({ accept: "application/json", authorization: `Bearer ${credential}` });
        if (encodedBody !== undefined) headers.set("content-type", "application/json");
        if (context.traceparent) headers.set("traceparent", context.traceparent);
        if (context.requestId) headers.set("x-request-id", context.requestId);
        if (context.delegationToken) headers.set("x-gowm-delegation", context.delegationToken);
        if (context.preferAsync) headers.set("prefer", "respond-async");
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
          let protocolCode: string | null = null;
          let protocolDetails: Readonly<Record<string, unknown>> | undefined;
          try {
            const upstream = await readBoundedJson<unknown>(response, this.#maxResponseBytes);
            protocolCode = upstreamErrorCode(upstream);
            protocolDetails = upstreamErrorDetails(upstream);
          } catch {
            // The status is authoritative even when an error body is absent or malformed.
          }
          throw new GatewayProtocolError(
            `HTTP_${response.status}${protocolCode ? `_${protocolCode}` : ""}`,
            response.status,
            retryable,
            protocolDetails
          );
        }
        const value = await readBoundedJson<T>(response, this.#maxResponseBytes);
        const responseSchema = schemaPolicy.responses?.[response.status];
        if (responseSchema) this.#validateSchema(responseSchema, value, response.status, false);
        this.#circuit.success();
        return { status: response.status, value };
      } catch (error) {
        lastError = error;
        if (error instanceof GatewayProtocolError) {
          if (!error.retryable || attempt >= this.#maxRetries) {
            if (upstreamProtocolFailureCodes.has(error.code)) this.#circuit.failure();
            throw error;
          }
        } else if (context.signal?.aborted) {
          throw new GatewayProtocolError("ABORTED", null, false);
        } else if (deadlineExpired) {
          this.#circuit.failure();
          throw new GatewayProtocolError("DEADLINE_EXCEEDED", null, true);
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

  #validateSchema(
    schemaPath: GowmConsumerSchemaPath,
    value: unknown,
    status: number | null,
    request: boolean
  ): void {
    try {
      this.#schemaRegistry.validate(schemaPath, value);
    } catch (error) {
      if (error instanceof GowmSchemaValidationError) {
        throw new GatewayProtocolError(request ? "REQUEST_SCHEMA_MISMATCH" : "RESPONSE_SCHEMA_MISMATCH", status, false);
      }
      throw error;
    }
  }
}
