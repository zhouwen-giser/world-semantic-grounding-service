import { jwtVerify } from "jose";
import type { FastifyRequest } from "fastify";
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

export async function authenticate(request: FastifyRequest, config: ApiAuthConfig): Promise<GroundingIdentity> {
  if (config.mode === "STATIC_TRUSTED") return structuredClone(config.identity);
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) throw new ApiAuthError("MISSING_BEARER_TOKEN");
  try {
    const { payload } = await jwtVerify(authorization.slice("Bearer ".length), config.key, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["HS256"]
    });
    const rawPermissions = payload["permissions"];
    const permissions = Array.isArray(rawPermissions)
      ? rawPermissions.map((value) => claimString(value, "INVALID_PERMISSION"))
      : typeof rawPermissions === "string" ? rawPermissions.split(" ").filter(Boolean) : [];
    if (!permissions.includes("grounding.read")) throw new ApiAuthError("MISSING_GROUNDING_PERMISSION");
    return {
      principalId: claimString(payload.sub, "MISSING_SUBJECT"),
      actor: claimString(payload["actor"], "MISSING_ACTOR"),
      dataScope: claimString(payload["data_scope"], "MISSING_DATA_SCOPE"),
      permissions
    };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    throw new ApiAuthError("INVALID_SERVICE_TOKEN");
  }
}
