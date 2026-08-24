import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createGroundingApi, type GroundingApiBackend, type GroundingIdentity } from "./index.js";

const schemaDirectory = new URL("../../../contracts/wsgs-v0.1/contracts/", import.meta.url);
const schemas = Object.fromEntries(readdirSync(schemaDirectory)
  .filter((name) => name.endsWith(".json"))
  .map((name) => [name, JSON.parse(readFileSync(new URL(name, schemaDirectory), "utf8")) as unknown]));
const now = "2026-08-25T00:00:00Z";
const resultHash = `sha256:${"a".repeat(64)}`;
const sourceText = "road";
const sourceHash = `sha256:${createHash("sha256").update(sourceText).digest("hex")}`;

const groundingResult = {
  schemaVersion: "1.0",
  requestId: "request-1",
  groundingId: "grounding-1",
  status: "COMPLETED",
  source: { messageId: "message-1", originalTextSha256: sourceHash },
  mentions: [],
  referenceProducts: [],
  evidenceItems: [],
  ambiguities: [],
  unresolvedMentions: [],
  capabilityGaps: [],
  warnings: [],
  execution: {
    parserVersion: "deterministic-parser/1.0",
    semanticModelReceiptIds: [],
    queryCompilerVersion: "wsgs-query-compiler/1.0",
    normalizerVersion: "evidence-normalizer/1.0",
    elapsedMs: 1
  },
  resultHash
};
const groundingJob = {
  schemaVersion: "1.0",
  jobId: "job-1",
  groundingId: "grounding-1",
  requestId: "request-1",
  status: "ACCEPTED",
  createdAt: now,
  updatedAt: now
};
const capabilities = {
  service: "world-semantic-grounding-service",
  version: "0.1.0",
  contractVersion: "sacs-wsgs-grounding/1.0",
  supportedOperations: ["GROUND_REFERENCES", "COMPILE_WORLD_QUERY", "EXECUTE_WORLD_QUERY", "VALIDATE_REFERENCES"],
  supportedProducts: ["MENTIONS", "WORLD_EVIDENCE"],
  gowmContract: {
    softwareVersion: "0.4.0",
    commit: "db575f79c874a69f65a2043a7e463338524b713d",
    sourcePackageArtifacts: 33
  },
  requiredCapabilitiesReady: true,
  optionalCapabilities: []
};

function requestBody(): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    requestId: "request-1",
    operation: "GROUND_REFERENCES",
    source: {
      conversationRef: "conversation-1",
      messageId: "message-1",
      originalText: sourceText,
      originalTextSha256: sourceHash,
      locale: "en-US",
      createdAt: now
    },
    requestedProducts: ["MENTIONS"],
    contextCapsule: {
      knownWorldReferences: [],
      priorGroundings: [],
      mapSelections: [],
      externalCorrelationHints: [],
      externalPredicates: []
    },
    executionPolicy: {
      readOnly: true,
      deadlineMs: 10_000,
      maxQueryOperations: 16,
      maxCandidatesPerMention: 5,
      maxResultBytes: 1_048_576,
      allowApproximation: false
    }
  };
}

function backend(captured: GroundingIdentity[] = []): GroundingApiBackend {
  return {
    readiness: vi.fn(async () => ({ ready: true, reasons: [] })),
    capabilities: vi.fn(async (identity) => { captured.push(identity); return capabilities; }),
    create: vi.fn(async (identity, _key, _request, preferAsync) => {
      captured.push(identity);
      return preferAsync ? { kind: "JOB" as const, value: groundingJob } : { kind: "RESULT" as const, value: groundingResult };
    }),
    get: vi.fn(async (identity, groundingId) => {
      captured.push(identity);
      return groundingId === "missing" ? null : groundingJob;
    }),
    cancel: vi.fn(async (identity, groundingId) => {
      captured.push(identity);
      return groundingId === "missing" ? null : { ...groundingJob, status: "CANCELLED", updatedAt: now, finishedAt: now };
    })
  };
}

const staticIdentity: GroundingIdentity = {
  principalId: "service-a",
  actor: "sacs",
  dataScope: "scope-a",
  permissions: ["grounding.read"]
};
const apps: FastifyInstance[] = [];

async function staticApp(captured: GroundingIdentity[] = [], service = backend(captured)): Promise<FastifyInstance> {
  const app = await createGroundingApi({
    auth: { mode: "STATIC_TRUSTED", identity: staticIdentity },
    backend: service,
    schemas,
    bodyLimitBytes: 65_536
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("grounding API", () => {
  it("reports liveness/readiness and frozen capabilities", async () => {
    const app = await staticApp();
    expect((await app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/health/ready" })).json()).toEqual({ status: "ready", reasons: [] });
    const response = await app.inject({ method: "GET", url: "/v1/capabilities" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(capabilities);
  });

  it("returns contract-valid synchronous 200 and asynchronous 202 responses", async () => {
    const app = await staticApp();
    const sync = await app.inject({
      method: "POST", url: "/v1/groundings", headers: { "idempotency-key": "idem-1" }, payload: requestBody()
    });
    expect(sync.statusCode).toBe(200);
    expect(sync.json()).toEqual(groundingResult);
    const asyncResponse = await app.inject({
      method: "POST",
      url: "/v1/groundings",
      headers: { "idempotency-key": "idem-2", prefer: "respond-async" },
      payload: requestBody()
    });
    expect(asyncResponse.statusCode).toBe(202);
    expect(asyncResponse.json()).toEqual(groundingJob);
  });

  it("derives identity/scope from trusted transport and rejects body injection", async () => {
    const captured: GroundingIdentity[] = [];
    const app = await staticApp(captured);
    const injected = { ...requestBody(), dataScope: "scope-b" };
    const response = await app.inject({
      method: "POST", url: "/v1/groundings", headers: { "idempotency-key": "idem-1" }, payload: injected
    });
    expect(response.statusCode).toBe(400);
    expect(captured).toEqual([]);
    await app.inject({
      method: "POST", url: "/v1/groundings", headers: { "idempotency-key": "idem-2" }, payload: requestBody()
    });
    expect(captured[0]).toEqual(staticIdentity);
  });

  it("rejects missing idempotency, source hash drift, and unknown conversation history", async () => {
    const app = await staticApp();
    expect((await app.inject({ method: "POST", url: "/v1/groundings", payload: requestBody() })).statusCode).toBe(400);
    const drift = requestBody();
    (drift["source"] as Record<string, unknown>)["originalTextSha256"] = `sha256:${"0".repeat(64)}`;
    expect((await app.inject({
      method: "POST", url: "/v1/groundings", headers: { "idempotency-key": "idem" }, payload: drift
    })).statusCode).toBe(400);
    const history = { ...requestBody(), conversationHistory: [] };
    expect((await app.inject({
      method: "POST", url: "/v1/groundings", headers: { "idempotency-key": "idem" }, payload: history
    })).statusCode).toBe(400);
  });

  it("authenticates JWT_SERVICE claims and rejects wrong audience/missing identity", async () => {
    const key = new TextEncoder().encode("a-secure-test-key-with-at-least-32-bytes");
    const captured: GroundingIdentity[] = [];
    const app = await createGroundingApi({
      auth: { mode: "JWT_SERVICE", key, issuer: "https://issuer.test", audience: "wsgs" },
      backend: backend(captured),
      schemas
    });
    apps.push(app);
    expect((await app.inject({ method: "GET", url: "/v1/capabilities" })).statusCode).toBe(401);
    const wrong = await new SignJWT({ actor: "sacs", data_scope: "scope-a", permissions: ["grounding.read"] })
      .setProtectedHeader({ alg: "HS256" }).setSubject("service-a").setIssuer("https://issuer.test").setAudience("wrong").sign(key);
    expect((await app.inject({ method: "GET", url: "/v1/capabilities", headers: { authorization: `Bearer ${wrong}` } })).statusCode).toBe(401);
    const valid = await new SignJWT({ actor: "sacs", data_scope: "scope-a", permissions: ["grounding.read"] })
      .setProtectedHeader({ alg: "HS256" }).setSubject("service-a").setIssuer("https://issuer.test").setAudience("wsgs").sign(key);
    expect((await app.inject({ method: "GET", url: "/v1/capabilities", headers: { authorization: `Bearer ${valid}` } })).statusCode).toBe(200);
    expect(captured[0]).toEqual(staticIdentity);
  });

  it("polls and cancels only through the scoped backend and keeps not-found opaque", async () => {
    const captured: GroundingIdentity[] = [];
    const app = await staticApp(captured);
    expect((await app.inject({ method: "GET", url: "/v1/groundings/grounding-1" })).json()).toEqual(groundingJob);
    const cancelled = await app.inject({ method: "POST", url: "/v1/groundings/grounding-1:cancel" });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json()).toMatchObject({ status: "CANCELLED" });
    expect((await app.inject({ method: "GET", url: "/v1/groundings/missing" })).statusCode).toBe(404);
    expect(captured.every((identity) => identity.dataScope === "scope-a")).toBe(true);
  });

  it("fails closed when backend output violates the frozen response schema", async () => {
    const service = backend();
    service.create = vi.fn(async () => ({ kind: "RESULT" as const, value: { status: "fabricated" } }));
    const app = await staticApp([], service);
    const response = await app.inject({
      method: "POST", url: "/v1/groundings", headers: { "idempotency-key": "idem" }, payload: requestBody()
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: "BACKEND_CONTRACT_VIOLATION" } });
  });

  it("exposes low-cardinality metrics without user text, scope, or IDs", async () => {
    const app = await staticApp();
    await app.inject({
      method: "POST", url: "/v1/groundings", headers: { "idempotency-key": "idem" }, payload: requestBody()
    });
    const metrics = await app.inject({ method: "GET", url: "/metrics" });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain("wsgs_grounding_sync_total 1");
    expect(metrics.body).not.toContain(sourceText);
    expect(metrics.body).not.toContain("scope-a");
    expect(metrics.body).not.toContain("grounding-1");
  });
});
