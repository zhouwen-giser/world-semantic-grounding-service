import { createHash, randomUUID } from "node:crypto";

import { defaultGowmConsumerSchemaRegistry } from "@wsgs/gowm-contract-intake";
import { importPKCS8, SignJWT } from "jose";

import { IdentityPolicyError, narrowScopes } from "./identity.js";
import type { DelegationRequest, DelegationSignerConfig, SignedDelegation } from "./types.js";

const operationKeyPattern = /^[a-z][a-z0-9.-]{2,127}@[0-9]+\.[0-9]+$/u;
const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const jtiPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,255}$/u;

export class DelegationPolicyError extends Error {
  constructor(readonly code: string) {
    super(`GOWM delegation rejected: ${code}`);
  }
}

function requiredText(value: string, code: string): string {
  if (!value || value.length > 256) throw new DelegationPolicyError(code);
  return value;
}

function operations(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > 128) {
    throw new DelegationPolicyError("ALLOWED_OPERATIONS_REQUIRED");
  }
  const result = [...new Set(values)].sort();
  if (result.length !== values.length || result.some((value) => !operationKeyPattern.test(value))) {
    throw new DelegationPolicyError("INVALID_ALLOWED_OPERATION");
  }
  return result;
}

export function operationKeysFromWorldQuery(plan: unknown): string[] {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new DelegationPolicyError("INVALID_WORLD_QUERY_PLAN");
  const nodes = (plan as Record<string, unknown>)["nodes"];
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > 64) throw new DelegationPolicyError("INVALID_WORLD_QUERY_NODES");
  const keys = nodes.map((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) throw new DelegationPolicyError("INVALID_WORLD_QUERY_NODE");
    const operation = (node as Record<string, unknown>)["operation"];
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) throw new DelegationPolicyError("INVALID_WORLD_QUERY_OPERATION");
    const record = operation as Record<string, unknown>;
    if (typeof record["operationId"] !== "string" || typeof record["operationVersion"] !== "string") {
      throw new DelegationPolicyError("INVALID_WORLD_QUERY_OPERATION");
    }
    return `${record["operationId"]}@${record["operationVersion"]}`;
  });
  return operations([...new Set(keys)]);
}

export class GowmDelegationSigner {
  readonly #issuer: string;
  readonly #audience: string;
  readonly #servicePrincipalId: string;
  readonly #maximumTtlSeconds: number;
  readonly #defaultTtlSeconds: number;
  readonly #now: () => number;
  readonly #newJti: () => string;
  readonly #privateKey: Promise<CryptoKey>;
  readonly #trustedOperationKeys: ReadonlySet<string>;

  constructor(config: DelegationSignerConfig) {
    this.#issuer = requiredText(config.issuer, "INVALID_ISSUER");
    this.#audience = requiredText(config.audience, "INVALID_AUDIENCE");
    this.#servicePrincipalId = requiredText(config.servicePrincipalId, "INVALID_SERVICE_PRINCIPAL");
    this.#maximumTtlSeconds = config.maximumTtlSeconds ?? 300;
    this.#defaultTtlSeconds = config.defaultTtlSeconds ?? Math.min(120, this.#maximumTtlSeconds);
    if (!Number.isInteger(this.#maximumTtlSeconds) || this.#maximumTtlSeconds < 1 || this.#maximumTtlSeconds > 300) {
      throw new DelegationPolicyError("INVALID_MAXIMUM_TTL");
    }
    if (!Number.isInteger(this.#defaultTtlSeconds) || this.#defaultTtlSeconds < 1 || this.#defaultTtlSeconds > this.#maximumTtlSeconds) {
      throw new DelegationPolicyError("INVALID_DEFAULT_TTL");
    }
    this.#now = config.now ?? (() => Math.floor(Date.now() / 1_000));
    this.#newJti = config.newJti ?? randomUUID;
    this.#trustedOperationKeys = new Set(operations(config.trustedOperationKeys));
    this.#privateKey = importPKCS8(config.privateKeyPkcs8, "RS256");
  }

  async ready(): Promise<void> {
    await this.#privateKey;
  }

  async sign(input: DelegationRequest): Promise<SignedDelegation> {
    if (input.identity.servicePrincipalId !== this.#servicePrincipalId) {
      throw new DelegationPolicyError("SERVICE_PRINCIPAL_MISMATCH");
    }
    if (!requestIdPattern.test(input.requestId)) throw new DelegationPolicyError("INVALID_REQUEST_ID");
    const allowedOperations = input.kind === "DIRECT_OPERATION"
      ? operations([`${input.operation.operationId}@${input.operation.operationVersion}`])
      : operationKeysFromWorldQuery(input.plan);
    if (allowedOperations.some((operation) => !this.#trustedOperationKeys.has(operation))) {
      throw new DelegationPolicyError("UNKNOWN_OPERATION");
    }
    let dataScopes: string[];
    let datasetScopes: string[];
    try {
      dataScopes = narrowScopes(input.identity.dataScopes, input.dataScopes, "DATA");
      datasetScopes = narrowScopes(input.identity.datasetScopes, input.datasetScopes, "DATASET");
    } catch (error) {
      if (error instanceof IdentityPolicyError) throw new DelegationPolicyError(error.code);
      throw error;
    }
    const ttl = input.ttlSeconds ?? this.#defaultTtlSeconds;
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > this.#maximumTtlSeconds || ttl > 300) {
      throw new DelegationPolicyError("TTL_EXCEEDS_POLICY");
    }
    const issuedAt = this.#now();
    const expiresAt = issuedAt + ttl;
    const jti = this.#newJti();
    if (!jtiPattern.test(jti)) throw new DelegationPolicyError("INVALID_JTI");
    const claims = {
      iss: this.#issuer,
      sub: this.#servicePrincipalId,
      aud: this.#audience,
      iat: issuedAt,
      nbf: issuedAt,
      exp: expiresAt,
      jti,
      act: { sub: input.identity.actorId },
      requestId: input.requestId,
      delegationDepth: 1,
      dataScopes,
      datasetScopes,
      allowedOperations
    };
    defaultGowmConsumerSchemaRegistry().validate("gowm-v0.6.3/delegated-identity-claims.schema.json", claims);
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .sign(await this.#privateKey);
    return {
      token,
      jtiHash: `sha256:${createHash("sha256").update(jti).digest("hex")}`,
      authorizationContextHash: input.identity.authorizationContextHash,
      allowedOperations,
      dataScopes,
      datasetScopes,
      issuedAt,
      expiresAt
    };
  }
}
