import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGroundingIdentity } from "@wsgs/delegated-identity";
import { createWorldAnalysisValidator, worldAnalysisResultHash, type GroundingResult12 } from "@wsgs/contracts";
import { GroundingPipeline, ProductionGroundingBackend, utf8Sha256 } from "@wsgs/grounding-pipeline";
import { createGroundingApi } from "../services/grounding-api/src/server.js";
import { groundingCapabilitiesForSelection } from "../services/grounding-api/src/production.js";
import { createPipelineStageExecutor } from "../services/grounding-worker/src/production-module.js";
import { GroundingWorker } from "../services/grounding-worker/src/worker.js";
import { HttpMemoryStore, admissionFixture } from "./world-analysis-http-support.js";

const identity = createGroundingIdentity({ servicePrincipalId: "http-development-consumer", actorId: "http-development-actor",
  dataScopes: ["http-development-scope"], datasetScopes: ["http-development-roads"], permissions: ["grounding.read", "data:read"] });
const headers = { "content-type": "application/json", "WSGS-Contract-Version": "sacs-wsgs-grounding/1.2", "WSGS-Result-Profile": "wsgs-world-analysis-findings/1.0" };
const validate = createWorldAnalysisValidator();
const schemaDirectory = new URL("../contracts/wsgs-v0.1/contracts/", import.meta.url);
const schemas = Object.fromEntries(readdirSync(schemaDirectory).filter(name => name.endsWith(".json"))
  .map(name => [name, JSON.parse(readFileSync(new URL(name, schemaDirectory), "utf8"))]));
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function request(operation = "VALIDATE_REFERENCES", text = "validate known references") {
  return { schemaVersion: "1.0", requestId: `request-${randomUUID()}`, operation,
    source: { conversationRef: "http-development-conversation", messageId: `message-${randomUUID()}`, originalText: text,
      originalTextSha256: utf8Sha256(text), locale: "en-US", createdAt: new Date().toISOString() },
    requestedProducts: ["RESOLVED_REFERENCES"], contextCapsule: { knownWorldReferences: [], priorGroundings: [], mapSelections: [], externalCorrelationHints: [], externalPredicates: [] },
    executionPolicy: { readOnly: true, deadlineMs: 10_000, maxQueryOperations: 16, maxCandidatesPerMention: 5, maxResultBytes: 1_048_576, allowApproximation: false } };
}

describe("world analysis real local HTTP production pipeline", () => {
  let app: Awaited<ReturnType<typeof createGroundingApi>>;
  let baseUrl: string;
  let store: HttpMemoryStore;
  let worker: GroundingWorker;
  beforeEach(async () => {
    for (const name of ["GOWM_SOUTHBOUND_LOCK_FILE", "GOWM_SOUTHBOUND_LOCK_SHA256", "WSGS_GDPS_RECIPE_LOCK_FILE", "WSGS_GDPS_RECIPE_LOCK_SHA256",
      "WSGS_GDPS_PREVIEW_RECIPE_ALLOWLIST", "WSGS_CROSS_SCOPE_GATEWAY_ROUTING", "WSGS_GDPS_CONSUMER_SNAPSHOT_FILE", "WSGS_GDPS_DESCRIPTOR_REGISTRY_FILE",
      "MODEL_BASE_URL", "MODEL_API_KEY", "MODEL_NAME", "GOWM_DELEGATION_PRIVATE_KEY_FILE"]) vi.stubEnv(name, "");
    vi.stubEnv("WSGS_MODEL_POLICY", "MODEL_OPTIONAL");
    vi.stubEnv("WSGS_HISTORY_TRACE_ENABLED", "NO"); vi.stubEnv("WSGS_ADVANCED_HISTORY_ENABLED", "NO"); vi.stubEnv("WSGS_ALLOW_PREVIEW_CAPABILITIES", "NO");
    vi.stubEnv("GOWM_GATEWAY_BASE_URL", "http://127.0.0.1:1"); vi.stubEnv("GOWM_GATEWAY_TOKEN", "test-only-placeholder");
    vi.stubEnv("GOWM_DELEGATION_ISSUER", "http-development-issuer"); vi.stubEnv("GOWM_DELEGATION_AUDIENCE", "http-development-audience");
    vi.stubEnv("GOWM_DELEGATION_SERVICE_PRINCIPAL_ID", identity.servicePrincipalId); vi.stubEnv("GOWM_DELEGATION_PRIVATE_KEY_PKCS8", privateKey);
    store = new HttpMemoryStore();
    const executor = await createPipelineStageExecutor({ pool: store.pool as unknown as Pool, priorAnalysisJournal: store });
    const pipeline = new GroundingPipeline({ executor, journal: store });
    worker = new GroundingWorker({ workerId: "http-development-worker", store, pipeline, leaseMs: 30_000, heartbeatMs: 100, maxJobAttempts: 1 });
    store.runWorker = () => worker.runOnce();
    const admission = admissionFixture();
    const backend = new ProductionGroundingBackend({ store, sealer: store.codec, readiness: async () => ({ ready: true, reasons: [] }),
      captureAdmissionSnapshot: async () => admission,
      capabilities: async (_identity, selection) => groundingCapabilitiesForSelection(selection, { ready: true, reasons: [] }) });
    app = await createGroundingApi({ auth: { mode: "STATIC_TRUSTED", identity }, backend, schemas,
      contractNegotiation: { sacsGeospatialServicePrincipals: [identity.servicePrincipalId], worldAnalysisServicePrincipals: [identity.servicePrincipalId] } });
    baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  });
  afterEach(async () => { await worker?.stop(0); await app?.close(); vi.unstubAllEnvs(); });
  async function post(body: ReturnType<typeof request>, async = false, idempotencyKey = randomUUID()) {
    expect(validate("request", body)).toEqual({ valid: true, errors: [] });
    return fetch(`${baseUrl}/v1/groundings`, { method: "POST", headers: { ...headers, "idempotency-key": idempotencyKey,
      ...(async ? { prefer: "respond-async" } : {}) }, body: JSON.stringify(body) });
  }
  it("sync 200 traverses production stages, public normalization, encrypted checkpoint and settlement", async () => {
    const response = await post(request());
    const result = await response.json() as GroundingResult12;
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(validate("result", result)).toEqual({ valid: true, errors: [] });
    expect(result.status).toBe("COMPLETED");
    expect(result.worldAnalysisFindings.findings).toEqual([]);
    expect(worldAnalysisResultHash(result)).toBe(result.resultHash);
    expect(store.records.filter(record => record.event.status === "COMPLETED").map(record => record.event.stage))
      .toEqual(["LOAD_CONTEXT", "REFERENCE_VALIDATE", "PRODUCT_ASSEMBLE"]);
    expect(store.jobs.get(result.groundingId)!.resultBytes).toBeDefined();
    expect(store.checkpoints.size).toBe(1);
    expect(store.sql.some(sql => sql.includes("INSERT INTO wsgs.capability_snapshot"))).toBe(true);
  });
  it("async 202 is completed by the actual worker and GET returns the stored result without reprojection", async () => {
    const response = await post(request(), true);
    const accepted = await response.json() as { groundingId: string };
    expect(response.status, JSON.stringify(accepted)).toBe(202);
    expect(validate("job", accepted).valid).toBe(true);
    expect(store.records).toHaveLength(0);
    const outcome = await worker.runOnce();
    expect(outcome.kind, JSON.stringify({ errors: [...store.jobs.values()].map(job => job.error), events: store.records.map(record => record.event) })).toBe("SUCCEEDED");
    const loaded = await fetch(`${baseUrl}/v1/groundings/${accepted.groundingId}`, { headers });
    const job = await loaded.json() as { result: GroundingResult12 };
    expect(loaded.status, JSON.stringify(job)).toBe(200);
    expect(validate("job", job).valid).toBe(true);
    expect(job.result).toEqual(JSON.parse(Buffer.from(store.jobs.get(accepted.groundingId)!.resultBytes!).toString("utf8")));
    const recordCount = store.records.length;
    const again = await fetch(`${baseUrl}/v1/groundings/${accepted.groundingId}`, { headers });
    expect(await again.json()).toEqual(job); expect(store.records).toHaveLength(recordCount);
  });
  it("retains profile-bound idempotency and rejects cross-profile GET", async () => {
    const body = request(); const key = randomUUID();
    const first = await post(body, false, key); const result = await first.json();
    expect(first.status, JSON.stringify(result)).toBe(200);
    expect(await (await post(body, false, key)).json()).toEqual(result);
    const changed = await post({ ...body, requestId: `request-${randomUUID()}` }, false, key);
    expect(changed.status).toBe(409);
    const wrongProfile = await fetch(`${baseUrl}/v1/groundings/${result.groundingId}`);
    expect(wrongProfile.status).toBe(406);
  });
  it("cancels an accepted job before any worker stage can write a result", async () => {
    const accepted = await (await post(request(), true)).json();
    const cancelled = await fetch(`${baseUrl}/v1/groundings/${accepted.groundingId}:cancel`, { method: "POST", headers, body: "{}" });
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).status).toBe("CANCELLED");
    expect((await worker.runOnce()).kind).toBe("IDLE");
    expect(store.records).toHaveLength(0); expect(store.jobs.get(accepted.groundingId)!.resultBytes).toBeUndefined();
  });
  it("expires an accepted job before execution and never saves a late result", async () => {
    const body = request(); body.executionPolicy.deadlineMs = 100;
    const response = await post(body, true); const accepted = await response.json();
    expect(response.status).toBe(202);
    await new Promise(resolve => setTimeout(resolve, 120));
    expect((await worker.runOnce()).kind).toBe("FAILED");
    const loaded = await fetch(`${baseUrl}/v1/groundings/${accepted.groundingId}`, { headers });
    const job = await loaded.json(); expect(loaded.status, JSON.stringify(job)).toBe(200);
    expect(validate("job", job).valid).toBe(true);
    expect(job).toMatchObject({ status: "FAILED", error: { code: "WORKER_DEADLINE_EXCEEDED" } });
    expect(job.result).toBeUndefined(); expect(store.records).toHaveLength(0);
  });
  it("runs all production stages and exposes an explicit gap when advanced history is disabled", async () => {
    const body = request("EXECUTE_WORLD_QUERY", "让2号车回到通信最好的位置");
    body.source.locale = "zh-CN"; body.requestedProducts = ["WORLD_EVIDENCE"];
    const response = await post(body); const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(validate("result", result).valid).toBe(true);
    expect(result.status).not.toBe("COMPLETED");
    expect(result.worldAnalysisFindings.gaps).toEqual([expect.objectContaining({ gapKind: "CAPABILITY_UNAVAILABLE", severity: "BLOCKING" })]);
    expect(result.worldAnalysisFindings.findings).toEqual([]);
    expect(store.records.filter(record => record.event.status === "COMPLETED").map(record => record.event.stage))
      .toEqual(["LOAD_CONTEXT", "DETERMINISTIC_PARSE", "SEMANTIC_MODEL_PARSE", "SEMANTIC_FRAME_VALIDATE", "GROUNDING_GRAPH_BUILD",
        "REFERENCE_RESOLVE", "REFERENCE_VALIDATE", "REQUIREMENT_PLAN", "CAPABILITY_MATCH", "WORLD_QUERY_COMPILE", "GOWM_EXECUTE",
        "EVIDENCE_NORMALIZE", "PRODUCT_ASSEMBLE", "RESULT_PERSIST"]);
  });
  it.each(["1.0", "1.1"])("preserves %s public results on the same production path", async version => {
    const selected = version === "1.0" ? {} : { "WSGS-Contract-Version": "sacs-wsgs-grounding/1.1", "WSGS-Result-Profile": "sacs-wsgs-geospatial-findings/1.0" };
    const response = await fetch(`${baseUrl}/v1/groundings`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomUUID(), ...selected }, body: JSON.stringify(request()) });
    const result = await response.json(); expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result.status).toBe("COMPLETED"); expect(result.worldAnalysisFindings).toBeUndefined();
  });
});
