import { createHash } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ApiAuthError, authenticate } from "./auth.js";
import { compileApiSchemas, type ApiSchemaValidators } from "./schemas.js";
import type { GroundingApiConfig, GroundingIdentity } from "./types.js";

const identifierPattern = /^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u;
const authorityFields = new Set(["dataScope", "data_scope", "actor", "permissions", "authorization"]);

class ApiProtocolError extends Error {
  constructor(readonly code: string, readonly statusCode: number) {
    super(`API request failed: ${code}`);
  }
}

class Metrics {
  readonly #counts = new Map<string, number>();

  increment(name: string): void {
    this.#counts.set(name, (this.#counts.get(name) ?? 0) + 1);
  }

  render(): string {
    return [...this.#counts.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `wsgs_${name}_total ${value}`).join("\n") + "\n";
  }
}

function requestObject(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    throw new ApiProtocolError("INVALID_JSON_BODY", 400);
  }
  return request.body as Record<string, unknown>;
}

function assertNoAuthority(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoAuthority);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (authorityFields.has(key)) throw new ApiProtocolError("BODY_AUTHORITY_FIELD_FORBIDDEN", 400);
    assertNoAuthority(entry);
  }
}

function validate(validator: ((value: unknown) => boolean) & { errors?: unknown }, value: unknown, code: string): void {
  if (!validator(value)) throw new ApiProtocolError(code, 400);
}

function validateResponse(validator: (value: unknown) => boolean, value: unknown): void {
  if (!validator(value)) throw new ApiProtocolError("BACKEND_CONTRACT_VIOLATION", 500);
}

function requestId(request: FastifyRequest): string {
  const body = request.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const value = (body as Record<string, unknown>)["requestId"];
    if (typeof value === "string" && identifierPattern.test(value)) return value;
  }
  const candidate = String(request.id).replace(/[^A-Za-z0-9._:-]/gu, "-");
  return /^[A-Za-z]/u.test(candidate) ? candidate.slice(0, 256) : `request-${candidate}`.slice(0, 256);
}

function protocolError(request: FastifyRequest, code: string, stage = "REQUEST_VALIDATION"): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    requestId: requestId(request),
    error: {
      code,
      message: "Request could not be completed",
      retryable: code === "INTERNAL_ERROR" || code === "NOT_READY",
      stage
    }
  };
}

function checkedProtocolError(
  validators: ApiSchemaValidators,
  request: FastifyRequest,
  code: string,
  stage = "REQUEST_VALIDATION"
): Record<string, unknown> {
  const value = protocolError(request, code, stage);
  if (!validators.protocolError(value)) throw new Error("Internal protocol error schema violation");
  return value;
}

function groundingId(request: FastifyRequest): string {
  const params = request.params as Record<string, unknown>;
  const value = params["groundingId"];
  if (typeof value !== "string" || !identifierPattern.test(value)) throw new ApiProtocolError("INVALID_GROUNDING_ID", 400);
  return value;
}

function cancellationGroundingId(request: FastifyRequest): string {
  const value = (request.params as Record<string, unknown>)["*"];
  if (typeof value !== "string" || !value.endsWith(":cancel")) throw new ApiProtocolError("INVALID_CANCEL_PATH", 404);
  const id = value.slice(0, -":cancel".length);
  if (!identifierPattern.test(id)) throw new ApiProtocolError("INVALID_GROUNDING_ID", 400);
  return id;
}

async function identity(request: FastifyRequest, config: GroundingApiConfig): Promise<GroundingIdentity> {
  return authenticate(request, config.auth);
}

export async function createGroundingApi(config: GroundingApiConfig): Promise<FastifyInstance> {
  const validators: ApiSchemaValidators = compileApiSchemas(config.schemas);
  const metrics = new Metrics();
  const app = Fastify({
    logger: config.logger ?? false,
    bodyLimit: config.bodyLimitBytes ?? 1_048_576
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiAuthError) {
      metrics.increment("auth_rejected");
      void reply.code(401).send(checkedProtocolError(validators, request, error.code));
      return;
    }
    if (error instanceof ApiProtocolError) {
      metrics.increment("request_rejected");
      void reply.code(error.statusCode).send(checkedProtocolError(validators, request, error.code));
      return;
    }
    const status = error && typeof error === "object" && "statusCode" in error && error.statusCode === 413 ? 413 : 500;
    metrics.increment(status === 413 ? "request_too_large" : "internal_error");
    void reply.code(status).send(checkedProtocolError(validators, request, status === 413 ? "REQUEST_TOO_LARGE" : "INTERNAL_ERROR"));
  });

  app.get("/health/live", async () => ({ status: "live" }));
  app.get("/health/ready", async (_request, reply) => {
    const readiness = await config.backend.readiness();
    return reply.code(readiness.ready ? 200 : 503).send({
      status: readiness.ready ? "ready" : "not_ready",
      reasons: readiness.reasons.slice(0, 32)
    });
  });
  app.get("/metrics", async (_request, reply) => reply.type("text/plain; version=0.0.4").send(metrics.render()));

  app.get("/v1/capabilities", async (request) => {
    const caller = await identity(request, config);
    const value = await config.backend.capabilities(caller);
    validateResponse(validators.capabilities, value);
    metrics.increment("capabilities");
    return value;
  });

  app.post("/v1/groundings", async (request, reply) => {
    const caller = await identity(request, config);
    const body = requestObject(request);
    assertNoAuthority(body);
    validate(validators.groundingRequest, body, "INVALID_GROUNDING_REQUEST");
    const source = body["source"] as Record<string, unknown>;
    const sourceText = source["originalText"] as string;
    const actualHash = `sha256:${createHash("sha256").update(sourceText, "utf8").digest("hex")}`;
    if (source["originalTextSha256"] !== actualHash) throw new ApiProtocolError("SOURCE_HASH_MISMATCH", 400);
    const idempotencyHeader = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(idempotencyHeader) ? idempotencyHeader[0] : idempotencyHeader;
    if (!idempotencyKey || idempotencyKey.length > 256) throw new ApiProtocolError("MISSING_OR_INVALID_IDEMPOTENCY_KEY", 400);
    const prefer = request.headers["prefer"];
    const preferAsync = typeof prefer === "string" && prefer.split(",").some((value) => value.trim().toLowerCase() === "respond-async");
    const outcome = await config.backend.create(caller, idempotencyKey, body, preferAsync);
    if (outcome.kind === "RESULT") {
      validateResponse(validators.groundingResult, outcome.value);
      metrics.increment("grounding_sync");
      return reply.code(200).send(outcome.value);
    }
    validateResponse(validators.groundingJob, outcome.value);
    metrics.increment("grounding_async");
    return reply.code(202).send(outcome.value);
  });

  app.get("/v1/groundings/:groundingId", async (request, reply) => {
    const caller = await identity(request, config);
    const value = await config.backend.get(caller, groundingId(request));
    if (value === null) return reply.code(404).send(checkedProtocolError(validators, request, "GROUNDING_NOT_FOUND"));
    validateResponse(validators.groundingJob, value);
    metrics.increment("grounding_get");
    return reply.code(200).send(value);
  });

  app.post("/v1/groundings/*", async (request, reply) => {
    const caller = await identity(request, config);
    const value = await config.backend.cancel(caller, cancellationGroundingId(request));
    if (value === null) return reply.code(404).send(checkedProtocolError(validators, request, "GROUNDING_NOT_FOUND"));
    validateResponse(validators.groundingJob, value);
    metrics.increment("grounding_cancel");
    return reply.code(200).send(value);
  });

  await app.ready();
  return app;
}
