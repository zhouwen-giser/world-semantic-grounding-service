import { createHash } from "node:crypto";

import type { GroundingIdentityV2 } from "./types.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;

export class IdentityPolicyError extends Error {
  constructor(readonly code: string) {
    super(`Grounding identity rejected: ${code}`);
  }
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
  });
}

function identifier(value: string, code: string): string {
  if (!identifierPattern.test(value)) throw new IdentityPolicyError(code);
  return value;
}

function normalized(values: string[], maximum: number, code: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(values) || values.length > maximum || (!allowEmpty && values.length === 0)) {
    throw new IdentityPolicyError(code);
  }
  const result = [...new Set(values.map((value) => identifier(value, code)))].sort();
  if (result.length !== values.length) throw new IdentityPolicyError(`${code}_DUPLICATE`);
  return result;
}

export function authorizationContextHash(input: Omit<GroundingIdentityV2, "authorizationContextHash">): string {
  return `sha256:${createHash("sha256").update(canonical({
    servicePrincipalId: identifier(input.servicePrincipalId, "INVALID_SERVICE_PRINCIPAL"),
    actorId: identifier(input.actorId, "INVALID_ACTOR"),
    dataScopes: normalized(input.dataScopes, 32, "INVALID_DATA_SCOPE", false),
    datasetScopes: normalized(input.datasetScopes, 32, "INVALID_DATASET_SCOPE", true),
    permissions: normalized(input.permissions, 64, "INVALID_PERMISSION", false)
  })).digest("hex")}`;
}

export function createGroundingIdentity(input: Omit<GroundingIdentityV2, "authorizationContextHash">): GroundingIdentityV2 {
  const identity = {
    servicePrincipalId: identifier(input.servicePrincipalId, "INVALID_SERVICE_PRINCIPAL"),
    actorId: identifier(input.actorId, "INVALID_ACTOR"),
    dataScopes: normalized(input.dataScopes, 32, "INVALID_DATA_SCOPE", false),
    datasetScopes: normalized(input.datasetScopes, 32, "INVALID_DATASET_SCOPE", true),
    permissions: normalized(input.permissions, 64, "INVALID_PERMISSION", false)
  };
  return { ...identity, authorizationContextHash: authorizationContextHash(identity) };
}

export function narrowScopes(authorized: string[], requested: string[] | undefined, kind: "DATA" | "DATASET"): string[] {
  const allowed = new Set(authorized);
  const desired = requested ?? authorized;
  const narrowed = normalized(desired, 32, `INVALID_${kind}_SCOPE`, kind === "DATASET");
  if (narrowed.some((scope) => !allowed.has(scope))) throw new IdentityPolicyError(`${kind}_SCOPE_EXPANSION_FORBIDDEN`);
  if (kind === "DATA" && narrowed.length === 0) throw new IdentityPolicyError("DATA_SCOPE_REQUIRED");
  return narrowed;
}
