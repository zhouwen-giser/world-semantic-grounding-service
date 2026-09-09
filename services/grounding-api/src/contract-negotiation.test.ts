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
  it("requires independent world-analysis authorization and the exact 1.2 pair", () => {
    const config = parseContractNegotiationConfig(undefined, '["7/sacs-service"]');
    const exact = { "wsgs-contract-version": "sacs-wsgs-grounding/1.2", "wsgs-result-profile": "wsgs-world-analysis-findings/1.0" };
    expect(negotiateGroundingContract(request(exact), identity, config)).toMatchObject({ contractVersion: "sacs-wsgs-grounding/1.2" });
    expect(negotiateGroundingContract(request({}), identity, config).contractVersion).toBe("sacs-wsgs-grounding/1.0");
    expect(Object.isFrozen(config.worldAnalysisServicePrincipals)).toBe(true);
    expect(() => negotiateGroundingContract(request(exact), identity, { sacsGeospatialServicePrincipals: [identity.servicePrincipalId] })).toThrowError(/not available/u);
    for (const headers of [
      { "wsgs-contract-version": exact["wsgs-contract-version"] },
      { "wsgs-result-profile": exact["wsgs-result-profile"] },
      { ...exact, "wsgs-result-profile": "sacs-wsgs-geospatial-findings/1.0" },
      { ...exact, "wsgs-contract-version": "sacs-wsgs-grounding/1.1" },
      { ...exact, "wsgs-result-profile": ` ${exact["wsgs-result-profile"]}` },
      { ...exact, "wsgs-result-profile": [exact["wsgs-result-profile"], exact["wsgs-result-profile"]] }
    ]) expect(() => negotiateGroundingContract(request(headers), identity, config)).toThrow();
  });
  it("rejects malformed or wildcard world-analysis configuration", () => {
    for (const value of ['["*"]', '["service-a","service-a"]', '[""]', 'null', '{}', 'invalid']) {
      expect(() => parseContractNegotiationConfig(undefined, value)).toThrow();
    }
  });
  it("accepts authority-valid numeric/slash principals and freezes a copy", () => {
    const parsed = parseContractNegotiationConfig('["7/sacs-service"]');
    expect(parsed.sacsGeospatialServicePrincipals).toEqual(["7/sacs-service"]);
    expect(Object.isFrozen(parsed.sacsGeospatialServicePrincipals)).toBe(true);
  });

  it("keeps a no-header request on legacy 1.0 even when the principal is allowlisted", () => {
    expect(negotiateGroundingContract(request({}), identity, {
      sacsGeospatialServicePrincipals: ["7/sacs-service"]
    })).toMatchObject({
      contractVersion: "sacs-wsgs-grounding/1.0",
      resultProfile: null
    });
  });

  it("selects 1.1 only for the exact header pair and an allowlisted principal", () => {
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
    for (const partial of [
      request({ "wsgs-contract-version": "sacs-wsgs-grounding/1.1" }),
      request({ "wsgs-result-profile": "sacs-wsgs-geospatial-findings/1.0" })
    ]) {
      expect(() => negotiateGroundingContract(partial, identity, {
        sacsGeospatialServicePrincipals: ["7/sacs-service"]
      })).toThrowError(/not available/u);
    }
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
