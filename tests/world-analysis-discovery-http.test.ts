import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { jwtVerify, SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisProviderContracts, GowmConsumerSchemaRegistry } from "@wsgs/gowm-contract-intake";
import { createGroundingIdentity } from "@wsgs/delegated-identity";
import { createWorldAnalysisValidator } from "@wsgs/contracts";
import { ProductionGroundingBackend } from "@wsgs/grounding-pipeline";
import { createGroundingApi } from "../services/grounding-api/src/server.js";
import { groundingCapabilitiesForSelection } from "../services/grounding-api/src/production.js";
import { HttpMemoryStore, analysisAdmissionFixture } from "./world-analysis-http-support.js";

const hashBytes = (bytes: string | Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

describe("world analysis signed caller discovery through real local HTTP", () => {
  const gateway = Fastify();
  let app: Awaited<ReturnType<typeof createGroundingApi>>;
  let baseUrl: string;
  let directory: string;
  let mode = "available";
  let actor = "allowed-actor";
  const requests: string[] = [];
  const claims: any[] = [];
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const apiKey = randomBytes(32);
  const identity = (actorId: string) => createGroundingIdentity({ servicePrincipalId: "discovery-consumer", actorId,
    dataScopes: [`scope-${actorId}`], datasetScopes: [`roads-${actorId}`], permissions: ["grounding.read", "data:read"] });
  const headers = { "WSGS-Contract-Version": "sacs-wsgs-grounding/1.2", "WSGS-Result-Profile": "wsgs-world-analysis-findings/1.0" };
  beforeAll(async () => {
    const input = analysisAdmissionFixture().metadata;
    const registry = new GowmConsumerSchemaRegistry({ analysisContracts: new AnalysisProviderContracts() });
    try {
      registry.validate("platform/capability-list-response.schema.json", input.catalog);
      registry.validate("gowm-v0.6.2/capability-semantic-catalog-v1.schema.json", input.semantics);
    } catch (error) { throw new Error(JSON.stringify((error as { issues: unknown }).issues)); }
    gateway.addHook("onRequest", async request => { requests.push(request.url); });
    gateway.get("/v1/capabilities", async (_request, reply) => {
      if (mode === "offline") return reply.code(503).send({ error: "controlled-provider-offline" });
      return input.catalog;
    });
    gateway.get("/v1/capability-semantics", async () => {
      const semantics = structuredClone(input.semantics);
      if (mode === "tampered-catalog") {
        const unrelated = semantics.profiles.find(entry => entry.operationId === "correlation.resolve")!;
        unrelated.semanticProfile.notes = ["controlled unrelated semantic tampering"];
      }
      return semantics;
    });
    gateway.get("/v1/operation-availability", async request => {
      const verified = await jwtVerify(String(request.headers["x-gowm-delegation"]), keys.publicKey,
        { algorithms: ["RS256"], issuer: "discovery-issuer", audience: "discovery-audience" });
      claims.push(verified.payload);
      const checkedAt = new Date().toISOString();
      const operations = [...input.lock.defaultOperations, ...input.lock.previewOperations]
        .filter(entry => (verified.payload["allowedOperations"] as string[]).includes(`${entry.operationId}@${entry.operationVersion}`))
        .filter(entry => !(verified.payload["act"] as { sub: string }).sub.startsWith("denied") || entry.operationId !== "trajectory.map-match")
        .map(entry => ({ operationId: entry.operationId, operationVersion: entry.operationVersion, maturity: entry.maturity,
          availability: mode === "t2-offline" && entry.operationId === "trajectory.map-match" ? "UNAVAILABLE" : "AVAILABLE",
          reasonCodes: ["AVAILABLE"], checkedAt, validUntil: new Date(Date.now() + 60_000).toISOString(),
          contractCatalogRevision: input.lock.contractCatalogRevision, bindingRevision: input.catalog.bindingRevision }));
      return { schemaVersion: "1.0", checkedAt, operations };
    });
    const gatewayUrl = await gateway.listen({ host: "127.0.0.1", port: 0 });
    directory = mkdtempSync(join(tmpdir(), "wsgs-discovery-http-"));
    const bytes = JSON.stringify(input.lock); const lockPath = join(directory, "lock.json"); writeFileSync(lockPath, bytes);
    for (const name of ["WSGS_GDPS_RECIPE_LOCK_FILE", "WSGS_GDPS_RECIPE_LOCK_SHA256", "WSGS_GDPS_PREVIEW_RECIPE_ALLOWLIST",
      "WSGS_CROSS_SCOPE_GATEWAY_ROUTING", "WSGS_GDPS_CONSUMER_SNAPSHOT_FILE", "WSGS_GDPS_DESCRIPTOR_REGISTRY_FILE",
      "MODEL_BASE_URL", "MODEL_API_KEY", "MODEL_NAME", "GOWM_DELEGATION_PRIVATE_KEY_FILE"]) vi.stubEnv(name, "");
    for (const [name, value] of Object.entries({ GOWM_SOUTHBOUND_LOCK_FILE: lockPath, GOWM_SOUTHBOUND_LOCK_SHA256: hashBytes(bytes),
      WSGS_HISTORY_TRACE_ENABLED: "YES", WSGS_ADVANCED_HISTORY_ENABLED: "YES", WSGS_ALLOW_PREVIEW_CAPABILITIES: "NO",
      WSGS_MODEL_POLICY: "MODEL_OPTIONAL", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
      GOWM_GATEWAY_BASE_URL: gatewayUrl, GOWM_GATEWAY_TOKEN: "controlled-test-only", GOWM_GATEWAY_MAX_RETRIES: "0",
      GOWM_DELEGATION_ISSUER: "discovery-issuer", GOWM_DELEGATION_AUDIENCE: "discovery-audience",
      GOWM_DELEGATION_SERVICE_PRINCIPAL_ID: "discovery-consumer",
      GOWM_DELEGATION_PRIVATE_KEY_PKCS8: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() })) vi.stubEnv(name, value);
    const { discoverWorldAnalysis } = await import("../services/grounding-worker/src/production-module.js");
    const store = new HttpMemoryStore();
    const backend = new ProductionGroundingBackend({ store, sealer: store.codec, readiness: async () => ({ ready: false, reasons: ["MODEL_NOT_CONFIGURED"] }),
      captureAdmissionSnapshot: async () => { throw new Error("DISCOVERY_MUST_NOT_ADMIT"); },
      capabilities: async (caller, selection) => groundingCapabilitiesForSelection(selection, { ready: false, reasons: [] }, await discoverWorldAnalysis(caller)) });
    const schemaDirectory = new URL("../contracts/wsgs-v0.1/contracts/", import.meta.url);
    const schemas = Object.fromEntries(readdirSync(schemaDirectory).filter(name => name.endsWith(".json"))
      .map(name => [name, JSON.parse(readFileSync(new URL(name, schemaDirectory), "utf8"))]));
    app = await createGroundingApi({ auth: { mode: "JWT_SERVICE", key: apiKey, issuer: "test-api-issuer", audience: "test-api-audience" }, backend, schemas,
      contractNegotiation: { sacsGeospatialServicePrincipals: [], worldAnalysisServicePrincipals: ["discovery-consumer"] } });
    baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  });
  beforeEach(() => { mode = "available"; actor = "allowed-actor"; requests.length = 0; claims.length = 0; });
  afterAll(async () => { await app?.close(); await gateway.close(); vi.unstubAllEnvs(); if (directory) rmSync(directory, { recursive: true, force: true }); });
  async function discover() {
    const caller = identity(actor);
    const token = await new SignJWT({ actorId: caller.actorId, dataScopes: caller.dataScopes, datasetScopes: caller.datasetScopes, permissions: caller.permissions })
      .setProtectedHeader({ alg: "HS256" }).setSubject(caller.servicePrincipalId).setIssuer("test-api-issuer").setAudience("test-api-audience")
      .setIssuedAt().setExpirationTime("1m").sign(apiKey);
    const response = await fetch(`${baseUrl}/v1/capabilities`, { headers: { ...headers, authorization: `Bearer ${token}` } });
    const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200);
    expect(createWorldAnalysisValidator()("capabilities", body)).toEqual({ valid: true, errors: [] });
    return body;
  }
  it("advertises all components through signed discovery without model readiness or database admission", async () => {
    const body = await discover();
    expect(body.requiredCapabilitiesReady).toBe(false);
    expect(body.worldAnalysis.capabilities.every((entry: any) => entry.available), JSON.stringify(body)).toBe(true);
    expect(requests).toEqual(["/v1/capabilities", "/v1/capability-semantics", "/v1/operation-availability"]);
    expect(claims[0]).toMatchObject({ sub: "discovery-consumer", act: { sub: actor }, dataScopes: [`scope-${actor}`], datasetScopes: [`roads-${actor}`] });
    expect(claims[0].allowedOperations).toContain("trajectory.map-match@0.1");
  });
  it("refreshes the exact caller grants and isolates T2 permission omission", async () => {
    await discover(); actor = "denied-actor"; const body = await discover();
    expect(claims).toHaveLength(2); expect(claims[0].jti).not.toBe(claims[1].jti);
    expect(claims[1]).toMatchObject({ act: { sub: actor }, dataScopes: [`scope-${actor}`], datasetScopes: [`roads-${actor}`] });
    for (const entry of body.worldAnalysis.capabilities) expect(entry.available).toBe(!["ROAD_ASSOCIATION", "CROSS"].includes(entry.capability));
    expect(body.worldAnalysis.capabilities.find((entry: any) => entry.capability === "ROAD_ASSOCIATION").reasonCodes).toEqual(["PERMISSION_DENIED"]);
  });
  it("isolates T2 operational failure while preserving history, T3, T4 and action discovery", async () => {
    mode = "t2-offline"; const body = await discover();
    for (const entry of body.worldAnalysis.capabilities) expect(entry.available).toBe(!["ROAD_ASSOCIATION", "CROSS"].includes(entry.capability));
  });
  it("returns bounded unavailable capabilities when Gateway discovery fails", async () => {
    mode = "offline"; const body = await discover();
    expect(body.worldAnalysis.capabilities.every((entry: any) => !entry.available)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("controlled-provider-offline");
  });
  it("rejects a changed unrelated profile despite an unchanged expected catalog hash label", async () => {
    mode = "tampered-catalog"; const body = await discover();
    expect(claims).toHaveLength(1);
    expect(body.worldAnalysis.capabilities.every((entry: any) => !entry.available)).toBe(true);
    expect(body.worldAnalysis.capabilities.find((entry: any) => entry.capability === "HISTORICAL_TRACE").reasonCodes).toEqual(["SEMANTIC_MISMATCH"]);
    expect(JSON.stringify(body)).not.toContain("controlled unrelated semantic tampering");
  });
  it("rejects missing and forged northbound credentials before any Gateway discovery", async () => {
    for (const authorization of [undefined, "Bearer forged-token"]) {
      const response = await fetch(`${baseUrl}/v1/capabilities`, { headers: { ...headers,
        ...(authorization ? { authorization } : {}) } });
      expect(response.status).toBe(401);
    }
    expect(requests).toEqual([]); expect(claims).toEqual([]);
  });
});
