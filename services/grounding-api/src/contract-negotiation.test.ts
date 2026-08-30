import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import { createGroundingIdentity } from "@wsgs/delegated-identity";

import {
  negotiateGroundingContract,
  normalizeContractNegotiationConfig,
  parseContractNegotiationConfig
} from "./contract-negotiation.js";

const identity = createGroundingIdentity({
  servicePrincipalId: "7/sacs-service",
  actorId: "operator",
  dataScopes: ["scope-a"],
  datasetScopes: [],
  permissions: ["grounding.read"]
});

function request(
  headers: Record<string, string | string[] | undefined>,
  rawHeaders?: string[]
): FastifyRequest {
  return {
    headers,
    raw: { rawHeaders: rawHeaders ?? Object.entries(headers).flatMap(([key, value]) =>
      value === undefined ? [] : [key, Array.isArray(value) ? value.join(",") : value]) }
  } as unknown as FastifyRequest;
}

describe("grounding contract negotiation", () => {
  it("accepts authority-valid numeric/slash principals and freezes a copy", () => {
    const parsed = parseContractNegotiationConfig('["7/sacs-service"]');
    expect(parsed.sacsGeospatialServicePrincipals).toEqual(["7/sacs-service"]);
    expect(negotiateGroundingContract(request({}), identity, parsed)).toMatchObject({
      contractVersion: "sacs-wsgs-grounding/1.0",
      resultProfile: null
    });
    expect(Object.isFrozen(parsed.sacsGeospatialServicePrincipals)).toBe(true);
  });

  it("requires the server-owned principal allowlist even for the exact 1.1 header pair", () => {
    const exact = request({
      "wsgs-contract-version": "sacs-wsgs-grounding/1.1",
      "wsgs-result-profile": "sacs-wsgs-geospatial-findings/1.0"
    });
    expect(negotiateGroundingContract(exact, identity, {
      sacsGeospatialServicePrincipals: ["7/sacs-service"]
    })).toMatchObject({ contractVersion: "sacs-wsgs-grounding/1.1" });
    expect(() => negotiateGroundingContract(exact, identity, {
      sacsGeospatialServicePrincipals: []
    })).toThrowError(/not available/u);
  });

  it("rejects duplicate raw headers even when Node presents one merged value", () => {
    const duplicated = request(
      { "wsgs-contract-version": "sacs-wsgs-grounding/1.1" },
      [
        "WSGS-Contract-Version", "sacs-wsgs-grounding/1.1",
        "wsgs-contract-version", "sacs-wsgs-grounding/1.1"
      ]
    );
    expect(() => negotiateGroundingContract(
      duplicated,
      identity,
      { sacsGeospatialServicePrincipals: [] }
    )).toThrowError(/not available/u);
  });

  it("rejects wildcard, duplicate, empty, mutable-shape, and unknown configuration", () => {
    for (const value of [
      { sacsGeospatialServicePrincipals: ["service-*"] },
      { sacsGeospatialServicePrincipals: ["service-a", "service-a"] },
      { sacsGeospatialServicePrincipals: [""] },
      { sacsGeospatialServicePrincipals: "service-a" },
      { sacsGeospatialServicePrincipals: [], unknown: true }
    ]) {
      expect(() => normalizeContractNegotiationConfig(value)).toThrowError(/not available/u);
    }
  });
});
