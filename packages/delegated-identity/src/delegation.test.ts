import { createHash } from "node:crypto";

import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import { DelegationPolicyError, GowmDelegationSigner, operationKeysFromWorldQuery } from "./delegation.js";
import { authorizationContextHash, createGroundingIdentity, IdentityPolicyError } from "./identity.js";

async function keys() {
  const pair = await generateKeyPair("RS256", { extractable: true });
  return { privateKeyPkcs8: await exportPKCS8(pair.privateKey), publicKey: pair.publicKey };
}

function identity() {
  return createGroundingIdentity({
    servicePrincipalId: "wsgs-runtime",
    actorId: "user-123",
    dataScopes: ["tenant-b", "tenant-a"],
    datasetScopes: ["dataset-a", "dataset-b"],
    permissions: ["grounding.read", "world.read"]
  });
}

describe("grounding identity v2", () => {
  it("separates service, actor, data scopes, dataset scopes, and permissions", () => {
    const value = identity();
    expect(value).toMatchObject({
      servicePrincipalId: "wsgs-runtime",
      actorId: "user-123",
      dataScopes: ["tenant-a", "tenant-b"],
      datasetScopes: ["dataset-a", "dataset-b"]
    });
    expect(value.authorizationContextHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(value.authorizationContextHash).toBe(authorizationContextHash({
      servicePrincipalId: value.servicePrincipalId,
      actorId: value.actorId,
      dataScopes: value.dataScopes,
      datasetScopes: value.datasetScopes,
      permissions: value.permissions
    }));
  });

  it("rejects duplicate or empty authority dimensions", () => {
    expect(() => createGroundingIdentity({
      servicePrincipalId: "wsgs-runtime",
      actorId: "user-123",
      dataScopes: ["tenant-a", "tenant-a"],
      datasetScopes: [],
      permissions: ["world.read"]
    })).toThrowError(expect.objectContaining<Partial<IdentityPolicyError>>({ code: "INVALID_DATA_SCOPE_DUPLICATE" }));
    expect(() => createGroundingIdentity({
      servicePrincipalId: "wsgs-runtime",
      actorId: "user-123",
      dataScopes: [],
      datasetScopes: [],
      permissions: ["world.read"]
    })).toThrowError(expect.objectContaining<Partial<IdentityPolicyError>>({ code: "INVALID_DATA_SCOPE" }));
  });
});

describe("signed GOWM delegation", () => {
  it("fails readiness when the configured RS256 private key cannot be imported", async () => {
    const signer = new GowmDelegationSigner({
      issuer: "issuer",
      audience: "audience",
      servicePrincipalId: "wsgs-runtime",
      privateKeyPkcs8: "not-a-private-key",
      trustedOperationKeys: ["reference.resolve@1.0"]
    });
    await expect(signer.ready()).rejects.toThrow();
  });

  it("issues a request-bound RS256 JWS with minimum operation authority", async () => {
    const { privateKeyPkcs8, publicKey } = await keys();
    const now = 1_800_000_000;
    const signer = new GowmDelegationSigner({
      issuer: "https://wsgs.invalid/",
      audience: "gowm-world-gateway",
      servicePrincipalId: "wsgs-runtime",
      privateKeyPkcs8,
      trustedOperationKeys: ["reference.resolve@1.0", "world.get-current-state@1.0"],
      maximumTtlSeconds: 300,
      defaultTtlSeconds: 120,
      now: () => now,
      newJti: () => "jti-000000000001"
    });
    const signed = await signer.sign({
      kind: "WORLD_QUERY",
      identity: identity(),
      requestId: "request-1",
      dataScopes: ["tenant-a"],
      datasetScopes: ["dataset-b"],
      plan: {
        nodes: [
          { operation: { operationId: "world.get-current-state", operationVersion: "1.0" } },
          { operation: { operationId: "reference.resolve", operationVersion: "1.0" } }
        ]
      }
    });
    const verified = await jwtVerify(signed.token, publicKey, {
      algorithms: ["RS256"],
      issuer: "https://wsgs.invalid/",
      audience: "gowm-world-gateway",
      subject: "wsgs-runtime",
      currentDate: new Date(now * 1_000)
    });
    expect(verified.protectedHeader).toMatchObject({ alg: "RS256", typ: "JWT" });
    expect(verified.payload).toMatchObject({
      sub: "wsgs-runtime",
      act: { sub: "user-123" },
      requestId: "request-1",
      delegationDepth: 1,
      dataScopes: ["tenant-a"],
      datasetScopes: ["dataset-b"],
      allowedOperations: ["reference.resolve@1.0", "world.get-current-state@1.0"],
      iat: now,
      nbf: now,
      exp: now + 120,
      jti: "jti-000000000001"
    });
    expect(signed.jtiHash).toBe(`sha256:${createHash("sha256").update("jti-000000000001").digest("hex")}`);
    expect(JSON.stringify({ ...signed, token: undefined })).not.toContain("jti-000000000001");
  });

  it("rejects scope expansion, excessive TTL, and service-subject mismatch", async () => {
    const { privateKeyPkcs8 } = await keys();
    const signer = new GowmDelegationSigner({
      issuer: "issuer",
      audience: "audience",
      servicePrincipalId: "wsgs-runtime",
      privateKeyPkcs8,
      trustedOperationKeys: ["reference.resolve@1.0"],
      now: () => 1_800_000_000,
      newJti: () => "jti-000000000002"
    });
    const base = {
      kind: "DIRECT_OPERATION" as const,
      identity: identity(),
      requestId: "request-2",
      operation: { operationId: "reference.resolve", operationVersion: "1.0" }
    };
    await expect(signer.sign({ ...base, dataScopes: ["tenant-c"] })).rejects.toMatchObject({ code: "DATA_SCOPE_EXPANSION_FORBIDDEN" });
    await expect(signer.sign({ ...base, datasetScopes: ["dataset-c"] })).rejects.toMatchObject({ code: "DATASET_SCOPE_EXPANSION_FORBIDDEN" });
    await expect(signer.sign({ ...base, ttlSeconds: 301 })).rejects.toMatchObject({ code: "TTL_EXCEEDS_POLICY" });
    await expect(signer.sign({ ...base, operation: { operationId: "unknown.operation", operationVersion: "1.0" } })).rejects
      .toMatchObject({ code: "UNKNOWN_OPERATION" });
    await expect(signer.sign({ ...base, identity: { ...identity(), servicePrincipalId: "wrong-service" } })).rejects
      .toMatchObject({ code: "SERVICE_PRINCIPAL_MISMATCH" });
  });

  it("derives a unique operation allowlist from the actual query DAG", () => {
    expect(operationKeysFromWorldQuery({
      nodes: [
        { operation: { operationId: "reference.resolve", operationVersion: "1.0" } },
        { operation: { operationId: "spatial.find-nearby", operationVersion: "1.0" } },
        { operation: { operationId: "reference.resolve", operationVersion: "1.0" } }
      ]
    })).toEqual(["reference.resolve@1.0", "spatial.find-nearby@1.0"]);
    expect(() => operationKeysFromWorldQuery({ nodes: [{ operation: { operationId: "unknown tool", operationVersion: "latest" } }] }))
      .toThrowError(expect.objectContaining<Partial<DelegationPolicyError>>({ code: "INVALID_ALLOWED_OPERATION" }));
  });
});
