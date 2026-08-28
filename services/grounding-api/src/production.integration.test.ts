import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { createGroundingIdentity } from "@wsgs/delegated-identity";
import { applyMigrations } from "@wsgs/runtime";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createProductionBackendFromEnvironment, type ProductionBackendResources } from "./production.js";
import { createGroundingApi } from "./server.js";

const databaseUrl = process.env["TEST_DATABASE_URL"];
const integration = databaseUrl ? describe : describe.skip;
const schemaDirectory = new URL("../../../contracts/wsgs-v0.1/contracts/", import.meta.url);
const schemas = Object.fromEntries(readdirSync(schemaDirectory)
  .filter((name) => name.endsWith(".json"))
  .map((name) => [name, JSON.parse(readFileSync(new URL(name, schemaDirectory), "utf8")) as unknown]));

function body(text: string): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    requestId: "request-production-api",
    operation: "GROUND_REFERENCES",
    source: {
      conversationRef: "conversation-1",
      messageId: "message-production-api",
      originalText: text,
      originalTextSha256: `sha256:${createHash("sha256").update(text).digest("hex")}`,
      locale: "en-US",
      createdAt: "2026-08-27T00:00:00.000Z"
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

integration("production grounding API PostgreSQL wiring", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const root = resolve(import.meta.dirname, "..", "..", "..");
  let resources: ProductionBackendResources | undefined;
  let app: Awaited<ReturnType<typeof createGroundingApi>> | undefined;
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  const previousKey = process.env["WSGS_REQUEST_ENCRYPTION_KEY_BASE64"];

  beforeAll(async () => applyMigrations(pool, resolve(root, "database", "migrations")));

  beforeEach(async () => {
    await pool.query(`TRUNCATE TABLE
      wsgs.pipeline_event, wsgs.pipeline_checkpoint, wsgs.gowm_execution,
      wsgs.model_receipt, wsgs.capability_snapshot, wsgs.result_product,
      wsgs.grounding_result, wsgs.world_query, wsgs.grounding_graph,
      wsgs.semantic_frame, wsgs.idempotency, wsgs.grounding_job,
      wsgs.grounding_request CASCADE`);
    process.env["DATABASE_URL"] = databaseUrl;
    process.env["WSGS_REQUEST_ENCRYPTION_KEY_BASE64"] = Buffer.alloc(32, 9).toString("base64");
    resources = createProductionBackendFromEnvironment({
      readinessProbe: {
        checkReadiness: async () => ({ ready: true, reasons: [] }),
        captureAdmissionSnapshot: async () => ({
          immutableLocks: { snapshotHash: `sha256:${"9".repeat(64)}` },
          gowmContractCatalogRevision: `sha256:${"1".repeat(64)}`,
          gowmSemanticCatalogHash: `sha256:${"2".repeat(64)}`,
          gowmConsumerPackageIntegrity: `sha512-${Buffer.alloc(64, 3).toString("base64")}`,
          gowmOperationLockHash: `sha256:${"4".repeat(64)}`
        })
      }
    });
    app = await createGroundingApi({
      auth: {
        mode: "STATIC_TRUSTED",
        identity: createGroundingIdentity({
          servicePrincipalId: "service-production-api",
          actorId: "operator-production-api",
          dataScopes: ["region-production-api"],
          datasetScopes: ["roads"],
          permissions: ["grounding.read"]
        })
      },
      backend: resources.backend,
      schemas
    });
  });

  afterEach(async () => {
    await app?.close();
    await resources?.close();
    app = undefined;
    resources = undefined;
  });

  afterAll(async () => {
    await pool.end();
    if (previousDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = previousDatabaseUrl;
    if (previousKey === undefined) delete process.env["WSGS_REQUEST_ENCRYPTION_KEY_BASE64"];
    else process.env["WSGS_REQUEST_ENCRYPTION_KEY_BASE64"] = previousKey;
  });

  it("reports ready and durably serves submit, get, cancel, and idempotency conflict", async () => {
    expect((await app!.inject({ method: "GET", url: "/health/ready" })).json()).toEqual({
      status: "ready",
      reasons: []
    });
    expect((await app!.inject({ method: "GET", url: "/v1/capabilities" })).statusCode).toBe(200);
    const created = await app!.inject({
      method: "POST",
      url: "/v1/groundings",
      headers: { "idempotency-key": "production-api-key", prefer: "respond-async" },
      payload: body("production-api-secret")
    });
    expect(created.statusCode).toBe(202);
    expect(created.json()).toMatchObject({ status: "ACCEPTED" });
    const groundingId = (created.json() as Record<string, unknown>)["groundingId"] as string;
    expect((await app!.inject({ method: "GET", url: `/v1/groundings/${groundingId}` })).statusCode).toBe(200);

    const conflict = await app!.inject({
      method: "POST",
      url: "/v1/groundings",
      headers: { "idempotency-key": "production-api-key", prefer: "respond-async" },
      payload: body("changed-production-api-secret")
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT" } });

    const cancelled = await app!.inject({ method: "POST", url: `/v1/groundings/${groundingId}:cancel` });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ status: "CANCELLED" });
  });
});
