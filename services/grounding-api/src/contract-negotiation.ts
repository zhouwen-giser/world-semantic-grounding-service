import {
  LEGACY_GROUNDING_CONTRACT_SELECTION,
  LEGACY_GROUNDING_CONTRACT_VERSION,
  SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION,
  SACS_GEOSPATIAL_GROUNDING_CONTRACT_VERSION,
  SACS_GEOSPATIAL_RESULT_PROFILE,
  type GroundingContractSelection
} from "@wsgs/grounding-pipeline";
import type { FastifyRequest } from "fastify";

import type { GroundingIdentity } from "./types.js";

export const WSGS_CONTRACT_VERSION_HEADER = "wsgs-contract-version" as const;
export const WSGS_RESULT_PROFILE_HEADER = "wsgs-result-profile" as const;

const principalPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;

export interface ContractNegotiationConfig {
  sacsGeospatialServicePrincipals: readonly string[];
}

export class ContractNegotiationError extends Error {
  readonly retryable = false;

  constructor(readonly code: string, readonly statusCode = 406) {
    super("Requested grounding contract is not available");
    this.name = "ContractNegotiationError";
  }
}

function exactHeader(request: FastifyRequest, name: string): string | undefined {
  let count = 0;
  for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
    if (request.raw.rawHeaders[index]?.toLowerCase() === name) count += 1;
  }
  if (count > 1) throw new ContractNegotiationError("WSGS_CONSUMER_CONTRACT_MISMATCH");
  const value = request.headers[name];
  if (value === undefined) return undefined;
  if (Array.isArray(value) || typeof value !== "string" || value.trim() !== value
    || value.length === 0 || value.includes(",")) {
    throw new ContractNegotiationError("WSGS_CONSUMER_CONTRACT_MISMATCH");
  }
  return value;
}

export function parseContractNegotiationConfig(value: string | undefined): ContractNegotiationConfig {
  if (value === undefined) return Object.freeze({ sacsGeospatialServicePrincipals: Object.freeze([]) });
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new ContractNegotiationError("WSGS_CONSUMER_CONTRACT_CONFIGURATION_INVALID", 500);
  }
  return normalizeContractNegotiationConfig({ sacsGeospatialServicePrincipals: parsed });
}

/** Strictly normalizes direct API construction as well as environment input. */
export function normalizeContractNegotiationConfig(value: unknown): ContractNegotiationConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value as Record<string, unknown>).sort())
      !== JSON.stringify(["sacsGeospatialServicePrincipals"])) {
    throw new ContractNegotiationError("WSGS_CONSUMER_CONTRACT_CONFIGURATION_INVALID", 500);
  }
  const parsed = (value as Record<string, unknown>)["sacsGeospatialServicePrincipals"];
  if (!Array.isArray(parsed) || parsed.some((entry) =>
    typeof entry !== "string" || !principalPattern.test(entry) || entry.includes("*"))) {
    throw new ContractNegotiationError("WSGS_CONSUMER_CONTRACT_CONFIGURATION_INVALID", 500);
  }
  if (new Set(parsed).size !== parsed.length) {
    throw new ContractNegotiationError("WSGS_CONSUMER_CONTRACT_CONFIGURATION_INVALID", 500);
  }
  return Object.freeze({
    sacsGeospatialServicePrincipals: Object.freeze([...parsed as string[]].sort())
  });
}

/**
 * The server-owned principal allowlist authorizes 1.1. Absence of both headers
 * always retains legacy 1.0, including for an allowlisted caller; 1.1 requires
 * the exact pair plus authorization. Request bodies, User-Agent, Accept, and source text are
 * never used to select a contract or profile.
 */
export function negotiateGroundingContract(
  request: FastifyRequest,
  identity: GroundingIdentity,
  config: ContractNegotiationConfig
): GroundingContractSelection {
  const contractVersion = exactHeader(request, WSGS_CONTRACT_VERSION_HEADER);
  const resultProfile = exactHeader(request, WSGS_RESULT_PROFILE_HEADER);
  const geospatialAuthorized = config.sacsGeospatialServicePrincipals.includes(identity.servicePrincipalId);
  if (contractVersion === undefined && resultProfile === undefined) {
    return LEGACY_GROUNDING_CONTRACT_SELECTION;
  }
  if (contractVersion === LEGACY_GROUNDING_CONTRACT_VERSION && resultProfile === undefined) {
    return LEGACY_GROUNDING_CONTRACT_SELECTION;
  }
  if (
    contractVersion === SACS_GEOSPATIAL_GROUNDING_CONTRACT_VERSION &&
    resultProfile === SACS_GEOSPATIAL_RESULT_PROFILE &&
    geospatialAuthorized
  ) return SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION;
  throw new ContractNegotiationError(
    resultProfile === undefined || resultProfile === SACS_GEOSPATIAL_RESULT_PROFILE
      ? "WSGS_CONSUMER_CONTRACT_MISMATCH"
      : "WSGS_GEOSPATIAL_PROFILE_UNSUPPORTED"
  );
}
