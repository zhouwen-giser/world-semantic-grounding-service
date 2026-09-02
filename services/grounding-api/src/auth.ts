import { jwtVerify } from "jose";
import type { FastifyRequest } from "fastify";
import { createGroundingIdentity, IdentityPolicyError } from "@wsgs/delegated-identity";
import type { ApiAuthConfig, GroundingIdentity } from "./types.js";

export class ApiAuthError extends Error {
  constructor(readonly code: string) {
    super(`Authentication failed: ${code}`);
  }
}

function claimString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) throw new ApiAuthError(code);
  return value;
}

type Claims = Record<string, unknown>;

function presentClaims(payload: Claims, names: readonly string[]): string[] {
  return names.filter((name) => Object.prototype.hasOwnProperty.call(payload, name));
}

function aliasedString(payload: Claims, names: readonly string[], missingCode: string, invalidCode: string): string {
  const present = presentClaims(payload, names);
  if (present.length === 0) throw new ApiAuthError(missingCode);
  if (present.length !== 1) throw new ApiAuthError(invalidCode);
  return claimString(payload[present[0]!], invalidCode);
}

function scopeClaims(
  payload: Claims,
  arrayNames: readonly string[],
  scalarNames: readonly string[],
  missingCode: string,
  invalidCode: string,
  allowMissing: boolean
): string[] {
  const arrays = presentClaims(payload, arrayNames);
  const scalars = presentClaims(payload, scalarNames);
  if (arrays.length + scalars.length === 0) {
    if (allowMissing) return [];
    throw new ApiAuthError(missingCode);
  }
  if (arrays.length + scalars.length !== 1) throw new ApiAuthError(invalidCode);
  if (scalars.length === 1) return [claimString(payload[scalars[0]!], invalidCode)];
  const value = payload[arrays[0]!];
  if (!Array.isArray(value) || value.length > 32) throw new ApiAuthError(invalidCode);
  return value.map((entry) => claimString(entry, invalidCode));
}

function permissionClaims(payload: Claims): string[] {
  const rawPermissions = payload["permissions"];
  if (Array.isArray(rawPermissions)) {
    if (rawPermissions.length > 64) throw new ApiAuthError("INVALID_PERMISSION");
    return rawPermissions.map((value) => claimString(value, "INVALID_PERMISSION"));
  }
  if (typeof rawPermissions === "string") {
    const permissions = rawPermissions.split(" ").filter(Boolean);
    if (permissions.length > 64) throw new ApiAuthError("INVALID_PERMISSION");
    return permissions;
  }
  return [];
}

function canonicalIdentity(input: Omit<GroundingIdentity, "authorizationContextHash">): GroundingIdentity {
  try {
    return createGroundingIdentity(input);
  } catch (error) {
    if (error instanceof IdentityPolicyError) throw new ApiAuthError(error.code);
    throw error;
  }
}

function staticIdentity(identity: GroundingIdentity): GroundingIdentity {
  const canonical = canonicalIdentity({
    servicePrincipalId: identity.servicePrincipalId,
    actorId: identity.actorId,
    dataScopes: identity.dataScopes,
    datasetScopes: identity.datasetScopes,
    permissions: identity.permissions
  });
  if (canonical.authorizationContextHash !== identity.authorizationContextHash) {
    throw new ApiAuthError("INVALID_AUTHORIZATION_CONTEXT_HASH");
  }
  return canonical;
}

export async function authenticate(request: FastifyRequest, config: ApiAuthConfig): Promise<GroundingIdentity> {
  if (config.mode === "STATIC_TRUSTED") return staticIdentity(config.identity);
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) throw new ApiAuthError("MISSING_BEARER_TOKEN");
  const token = authorization.slice("Bearer ".length).trim();
  if (token.length === 0) throw new ApiAuthError("MISSING_BEARER_TOKEN");
  if (config.mode === "BEARER_PRESENT") return staticIdentity(config.identity);
  try {
    const { payload } = await jwtVerify(token, config.key, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["HS256"]
    });
    const claims = payload as Claims;
    const permissions = permissionClaims(claims);
    if (!permissions.includes("grounding.read")) throw new ApiAuthError("MISSING_GROUNDING_PERMISSION");
    return canonicalIdentity({
      servicePrincipalId: claimString(payload.sub, "MISSING_SUBJECT"),
      actorId: aliasedString(claims, ["actorId", "actor_id", "actor"], "MISSING_ACTOR", "INVALID_ACTOR"),
      dataScopes: scopeClaims(
        claims,
        ["dataScopes", "data_scopes"],
        ["dataScope", "data_scope"],
        "MISSING_DATA_SCOPE",
        "INVALID_DATA_SCOPE",
        false
      ),
      datasetScopes: scopeClaims(
        claims,
        ["datasetScopes", "dataset_scopes"],
        ["datasetScope", "dataset_scope"],
        "MISSING_DATASET_SCOPE",
        "INVALID_DATASET_SCOPE",
        true
      ),
      permissions
    });
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    throw new ApiAuthError("INVALID_SERVICE_TOKEN");
  }
}
