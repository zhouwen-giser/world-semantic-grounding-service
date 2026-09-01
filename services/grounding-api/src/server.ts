import { createHash } from "node:crypto";
import { isSacsGeospatialContract, type GroundingContractSelection } from "@wsgs/grounding-pipeline";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { ApiAuthError, authenticate } from "./auth.js";
import {
  ContractNegotiationError,
  WSGS_CONTRACT_VERSION_HEADER,
  WSGS_RESULT_PROFILE_HEADER,
  negotiateGroundingContract,
  normalizeContractNegotiationConfig
} from "./contract-negotiation.js";
import { compileApiSchemas, type ApiSchemaValidators } from "./schemas.js";
import { ApiSecurityError, assertSafeUnicodeText, ScopedRateBudget } from "./security.js";
import type { GroundingApiConfig, GroundingIdentity } from "./types.js";

const identifierPattern = /^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u;
const authorityFields = new Set([
  "servicePrincipalId",
  "service_principal_id",
  "principalId",
  "principal_id",
  "actorId",
  "actor_id",
  "actor",
  "dataScopes",
  "data_scopes",
  "dataScope",
  "data_scope",
  "datasetScopes",
  "dataset_scopes",
  "datasetScope",
  "dataset_scope",
  "permissions",
  "authorizationContextHash",
  "authorization_context_hash",
  "authorization",
  "accessToken",
  "access_token",
  "token"
]);

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

function negotiatedResponseValidator(
  validators: ApiSchemaValidators,
  selection: GroundingContractSelection,
  kind: "CAPABILITIES" | "RESULT" | "JOB"
): (value: unknown) => boolean {
  const geospatial = isSacsGeospatialContract(selection);
  if (kind === "CAPABILITIES") return geospatial ? validators.capabilities11 : validators.capabilities;
  if (kind === "RESULT") return geospatial ? validators.groundingResult11 : validators.groundingResult;
  return geospatial ? validators.groundingJob11 : validators.groundingJob;
}

function exposeNegotiation(reply: FastifyReply, selection: GroundingContractSelection): void {
  reply.header(WSGS_CONTRACT_VERSION_HEADER, selection.contractVersion);
  if (selection.resultProfile !== null) reply.header(WSGS_RESULT_PROFILE_HEADER, selection.resultProfile);
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
  const rateBudget = new ScopedRateBudget(config.rateBudget ?? { requests: 120, windowMs: 60_000 });
  const contractNegotiation = normalizeContractNegotiationConfig(
    config.contractNegotiation ?? { sacsGeospatialServicePrincipals: [] }
  );
  const app = Fastify({
    logger: config.logger
      ? {
          level: "info",
          redact: {
            paths: ["req.headers.authorization", "req.body", "res.body", "err.message", "err.stack"],
            censor: "[REDACTED]"
          }
        }
      : false,
    bodyLimit: config.bodyLimitBytes ?? 1_048_576
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiAuthError) {
      metrics.increment("auth_rejected");
      void reply.code(401).send(checkedProtocolError(validators, request, error.code));
      return;
    }
    if (error instanceof ContractNegotiationError) {
      metrics.increment("contract_negotiation_rejected");
      void reply.code(error.statusCode).send(checkedProtocolError(validators, request, error.code));
      return;
    }
    if (error instanceof ApiProtocolError) {
      metrics.increment("request_rejected");
      void reply.code(error.statusCode).send(checkedProtocolError(validators, request, error.code));
      return;
    }
    if (error instanceof ApiSecurityError) {
      metrics.increment("security_rejected");
      void reply.code(error.statusCode).send(checkedProtocolError(validators, request, error.code));
      return;
    }
    if (error && typeof error === "object" && "code" in error && error.code === "IDEMPOTENCY_CONFLICT") {
      metrics.increment("idempotency_conflict");
      void reply.code(409).send(checkedProtocolError(validators, request, "IDEMPOTENCY_CONFLICT"));
      return;
    }
    if (error && typeof error === "object" && "code" in error
      && error.code === "WSGS_CONSUMER_CONTRACT_MISMATCH") {
      metrics.increment("contract_selection_mismatch");
      void reply.code(406).send(checkedProtocolError(validators, request, "WSGS_CONSUMER_CONTRACT_MISMATCH"));
      return;
    }
    if (error && typeof error === "object" && "code" in error && error.code === "DATA_SCOPE_SELECTION_REQUIRED") {
      metrics.increment("scope_rejected");
      void reply.code(403).send(checkedProtocolError(validators, request, "DATA_SCOPE_SELECTION_REQUIRED"));
      return;
    }
    if (error && typeof error === "object" && "code" in error && error.code === "NOT_READY") {
      metrics.increment("not_ready");
      void reply.code(503).send(checkedProtocolError(validators, request, "NOT_READY"));
      return;
    }
    if (error && typeof error === "object" && "code" in error &&
      typeof error.code === "string" && error.code.startsWith("SELECTION_")) {
      const statusCode = error.code === "SELECTION_NOT_FOUND" ? 404
        : error.code === "SELECTION_SCOPE_MISMATCH" ? 403
          : error.code === "SELECTION_TOKEN_EXPIRED" ? 410
            : error.code === "SELECTION_REVISION_CONFLICT" ||
              error.code === "SELECTION_RESULT_HASH_MISMATCH" ||
              error.code === "SELECTION_SOURCE_HASH_MISMATCH" ||
              error.code === "SELECTION_REFERENCE_STALE" ? 409
              : 400;
      metrics.increment("selection_rejected");
      void reply.code(statusCode).send(checkedProtocolError(validators, request, error.code));
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

  app.get("/v1/capabilities", async (request, reply) => {
    const caller = await identity(request, config);
    const selection = negotiateGroundingContract(request, caller, contractNegotiation);
    const value = await config.backend.capabilities(caller, selection);
    validateResponse(negotiatedResponseValidator(validators, selection, "CAPABILITIES"), value);
    exposeNegotiation(reply, selection);
    metrics.increment("capabilities");
    return reply.code(200).send(value);
  });

  app.post("/v1/groundings", async (request, reply) => {
    const caller = await identity(request, config);
    const selection = negotiateGroundingContract(request, caller, contractNegotiation);
    rateBudget.consume(caller);
    const body = requestObject(request);
    assertNoAuthority(body);
    validate(validators.groundingRequest, body, "INVALID_GROUNDING_REQUEST");
    const source = body["source"] as Record<string, unknown>;
    const sourceText = source["originalText"] as string;
    assertSafeUnicodeText(sourceText);
    const actualHash = `sha256:${createHash("sha256").update(sourceText, "utf8").digest("hex")}`;
    if (source["originalTextSha256"] !== actualHash) throw new ApiProtocolError("SOURCE_HASH_MISMATCH", 400);
    const idempotencyHeader = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(idempotencyHeader) ? idempotencyHeader[0] : idempotencyHeader;
    if (!idempotencyKey || idempotencyKey.length > 256) throw new ApiProtocolError("MISSING_OR_INVALID_IDEMPOTENCY_KEY", 400);
    const prefer = request.headers["prefer"];
    const preferAsync = typeof prefer === "string" && prefer.split(",").some((value) => value.trim().toLowerCase() === "respond-async");
    const outcome = await config.backend.create(caller, idempotencyKey, body, preferAsync, selection);
    if (outcome.kind === "RESULT") {
      validateResponse(negotiatedResponseValidator(validators, selection, "RESULT"), outcome.value);
      exposeNegotiation(reply, selection);
      metrics.increment("grounding_sync");
      return reply.code(200).send(outcome.value);
    }
    validateResponse(negotiatedResponseValidator(validators, selection, "JOB"), outcome.value);
    exposeNegotiation(reply, selection);
    metrics.increment("grounding_async");
    return reply.code(202).send(outcome.value);
  });

  app.get("/v1/groundings/:groundingId", async (request, reply) => {
    const caller = await identity(request, config);
    const selection = negotiateGroundingContract(request, caller, contractNegotiation);
    const value = await config.backend.get(caller, groundingId(request), selection);
    if (value === null) return reply.code(404).send(checkedProtocolError(validators, request, "GROUNDING_NOT_FOUND"));
    validateResponse(negotiatedResponseValidator(validators, selection, "JOB"), value);
    exposeNegotiation(reply, selection);
    metrics.increment("grounding_get");
    return reply.code(200).send(value);
  });

  app.post("/v1/world-selections:resolve", async (request, reply) => {
    const caller = await identity(request, config);
    const selection = negotiateGroundingContract(request, caller, contractNegotiation);
    if (!isSacsGeospatialContract(selection)) {
      throw new ApiProtocolError("WSGS_CONSUMER_CONTRACT_MISMATCH", 406);
    }
    rateBudget.consume(caller);
    const body = requestObject(request);
    assertNoAuthority(body);
    validate(validators.structuredSelectionRequest, body, "INVALID_STRUCTURED_SELECTION_REQUEST");
    if (!config.backend.resolveWorldSelection) throw new ApiProtocolError("NOT_READY", 503);
    const value = await config.backend.resolveWorldSelection(caller, body);
    validateResponse(validators.structuredSelectionResult, value);
    exposeNegotiation(reply, selection);
    metrics.increment("world_selection_resolve");
    return reply.code(200).send(value);
  });

  app.post("/v1/groundings/*", async (request, reply) => {
    const caller = await identity(request, config);
    const selection = negotiateGroundingContract(request, caller, contractNegotiation);
    const value = await config.backend.cancel(caller, cancellationGroundingId(request), selection);
    if (value === null) return reply.code(404).send(checkedProtocolError(validators, request, "GROUNDING_NOT_FOUND"));
    validateResponse(negotiatedResponseValidator(validators, selection, "JOB"), value);
    exposeNegotiation(reply, selection);
    metrics.increment("grounding_cancel");
    return reply.code(200).send(value);
  });

  await app.ready();
  return app;
}
