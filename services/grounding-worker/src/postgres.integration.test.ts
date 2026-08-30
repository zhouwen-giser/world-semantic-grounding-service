import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  Aes256GcmPayloadCodec,
  GroundingPipeline,
  PIPELINE_STAGES,
  PostgresPipelineJournal,
  PostgresProductionGroundingStore,
  ProductionGroundingBackend,
  ProductionPipelineStageExecutor,
  PostgresIdempotencyConflictError,
  PostgresGroundingContractMismatchError,
  SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION,
  utf8Sha256,
  type PipelineStage,
  type PipelineStageContext,
  type PipelineStageHandler
} from "@wsgs/grounding-pipeline";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyMigrations, runAssertions } from "../../../packages/runtime/src/migrations.js";
import {
  PostgresCancellationListener,
  PostgresGroundingWorkerStore
} from "./postgres-store.js";
import { GroundingWorker } from "./worker.js";

const databaseUrl = process.env["TEST_DATABASE_URL"];
const integration = databaseUrl ? describe : describe.skip;
const encryptionKey = new Uint8Array(Array.from({ length: 32 }, (_value, index) => index + 1));
const locks = {
  gowmSoftwareVersion: "0.6.3",
  gowmCommit: "test-integration-lock",
  catalogRevision: "test-catalog-revision"
};
const admissionSnapshot = {
  immutableLocks: locks,
  gowmContractCatalogRevision: `sha256:${"1".repeat(64)}`,
  gowmSemanticCatalogHash: `sha256:${"2".repeat(64)}`,
  gowmConsumerPackageIntegrity: `sha512-${Buffer.alloc(64, 3).toString("base64")}`,
  gowmOperationLockHash: `sha256:${"4".repeat(64)}`
};
const geospatialResult = JSON.parse(readFileSync(new URL(
  "../../../contracts/wsgs-v0.2.1-sacs-geospatial/examples/grounding-result-with-geospatial-findings.json",
  import.meta.url
), "utf8")) as Record<string, unknown>;

const identity = {
  servicePrincipalId: "sacs-service",
  actorId: "operator-1",
  dataScopes: ["region-a"],
  datasetScopes: ["roads", "vehicles"],
  permissions: ["grounding.read"],
  authorizationContextHash: `sha256:${"a".repeat(64)}`
};

function request(suffix: string, text = "secret-route-vehicle-2"): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    requestId: `request-${suffix}`,
    operation: "EXECUTE_WORLD_QUERY",
    source: {
      messageId: `message-${suffix}`,
      originalText: text,
      originalTextSha256: utf8Sha256(text),
      locale: "zh-CN"
    },
    executionPolicy: { readOnly: true, deadlineMs: 60_000, maxResultBytes: 1_048_576 }
  };
}

function finalResult(context: PipelineStageContext): Record<string, unknown> {
  const storedRequest = context.state["request"] as Record<string, unknown>;
  const source = storedRequest["source"] as Record<string, unknown>;
  return {
    schemaVersion: "1.0",
    requestId: storedRequest["requestId"],
    groundingId: context.groundingId,
    status: "COMPLETED",
    source: {
      messageId: source["messageId"],
      originalTextSha256: source["originalTextSha256"]
    },
    mentions: [],
    referenceProducts: [{
      productId: "reference-product-integration",
      productKind: "RESOLVED_REFERENCE",
      referenceKey: { namespace: "gowm", kind: "OBJECT", id: `wrf_${"1".repeat(32)}`, version: "v1" },
      referenceType: "VEHICLE",
      displayName: "Integration vehicle",
      sourceOperation: "reference.resolve",
      sourceWorldVersion: 1
    }],
    evidenceItems: [{
      evidenceProductId: "evidence-product-integration",
      productKind: "WORLD_FACT",
      authority: "gowm",
      sourceOperation: "world.get-current-state",
      upstreamStatus: "COMPLETED",
      payloadSchemaUri: "urn:gowm:test:world-fact",
      payloadSchemaHash: `sha256:${"8".repeat(64)}`,
      payloadRef: "urn:wsgs:test:evidence-product",
      receiptIds: [],
      evidenceIds: [],
      unknowns: [],
      warnings: []
    }],
    ambiguities: [],
    unresolvedMentions: [],
    capabilityGaps: [],
    warnings: [],
    execution: {
      parserVersion: "test-adapter/1.0",
      semanticModelReceiptIds: [],
      queryCompilerVersion: "test-adapter/1.0",
      normalizerVersion: "test-adapter/1.0",
      elapsedMs: 1
    }
  };
}

function executor(
  calls: PipelineStage[],
  overrides: Partial<Record<PipelineStage, PipelineStageHandler>> = {}
): ProductionPipelineStageExecutor {
  return new ProductionPipelineStageExecutor(Object.fromEntries(PIPELINE_STAGES.map((stage) => [
    stage,
    overrides[stage] ?? (async (context: PipelineStageContext) => {
      calls.push(stage);
      return stage === "RESULT_PERSIST" ? finalResult(context) : { stage, adapterProbe: true };
    })
  ])) as Record<PipelineStage, PipelineStageHandler>);
}

integration("W04 PostgreSQL production adapters", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const codec = new Aes256GcmPayloadCodec(encryptionKey);
  const backendStore = new PostgresProductionGroundingStore(pool, { pollIntervalMs: 5 });
  const backend = new ProductionGroundingBackend({
    store: backendStore,
    sealer: codec,
    readiness: () => backendStore.readiness(),
    capabilities: async () => ({}),
    captureAdmissionSnapshot: async () => admissionSnapshot,
    sourceRetentionMs: 60_000
  });
  const root = resolve(import.meta.dirname, "..", "..", "..");

  beforeAll(async () => {
    await applyMigrations(pool, resolve(root, "database", "migrations"));
    await runAssertions(pool, resolve(root, "database", "assertions"));
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE TABLE
      wsgs.pipeline_event, wsgs.pipeline_checkpoint, wsgs.gowm_execution,
      wsgs.model_receipt, wsgs.capability_snapshot, wsgs.result_product,
      wsgs.grounding_result, wsgs.world_query, wsgs.grounding_graph,
      wsgs.semantic_frame, wsgs.idempotency, wsgs.grounding_job,
      wsgs.grounding_request CASCADE`);
  });

  afterAll(async () => pool.end());

  it("persists encrypted input, runs all stages, checkpoints, and replays exact result bytes", async () => {
    const body = request("complete");
    const created = await backend.create(identity, "idem-complete", body, true);
    expect(created).toMatchObject({ kind: "JOB", value: { status: "ACCEPTED" } });

    const persistedInput = await pool.query<{ source_text_ciphertext: Buffer; request_metadata: unknown }>(
      `SELECT source_text_ciphertext, request_metadata
         FROM wsgs.grounding_request WHERE request_id = $1`,
      ["request-complete"]
    );
    expect(persistedInput.rows[0]?.source_text_ciphertext.includes(Buffer.from("secret-route-vehicle-2"))).toBe(false);
    expect(JSON.stringify(persistedInput.rows[0]?.request_metadata)).not.toContain("secret-route-vehicle-2");

    const calls: PipelineStage[] = [];
    const workerStore = new PostgresGroundingWorkerStore(pool, codec);
    const pipeline = new GroundingPipeline({
      executor: executor(calls),
      journal: new PostgresPipelineJournal(pool, codec)
    });
    const worker = new GroundingWorker({
      workerId: "worker-integration",
      store: workerStore,
      pipeline,
      leaseMs: 5_000,
      heartbeatMs: 500
    });
    expect(await worker.runOnce()).toMatchObject({ kind: "SUCCEEDED" });
    expect(calls).toEqual(PIPELINE_STAGES);

    const stored = await pool.query<{
      event_count: string;
      minimum_sequence: number;
      maximum_sequence: number;
      distinct_execution_ids: string;
      run_fingerprints: string;
    }>(
      `SELECT count(*)::text AS event_count, min(sequence)::integer AS minimum_sequence,
              max(sequence)::integer AS maximum_sequence,
              count(DISTINCT stage_execution_id)::text AS distinct_execution_ids,
              count(DISTINCT run_fingerprint)::text AS run_fingerprints
         FROM wsgs.pipeline_event`
    );
    expect(stored.rows[0]).toEqual({
      event_count: "28",
      minimum_sequence: 0,
      maximum_sequence: 27,
      distinct_execution_ids: "14",
      run_fingerprints: "1"
    });
    const checkpoint = await pool.query<{
      next_stage_index: number;
      next_event_sequence: number;
      state_ciphertext: Buffer;
      run_fingerprint: string;
    }>("SELECT next_stage_index, next_event_sequence, state_ciphertext, run_fingerprint FROM wsgs.pipeline_checkpoint");
    expect(checkpoint.rows[0]).toMatchObject({ next_stage_index: 14, next_event_sequence: 28 });
    expect(checkpoint.rows[0]?.state_ciphertext.includes(Buffer.from("secret-route-vehicle-2"))).toBe(false);

    const job = await backend.get(identity, (created.value as Record<string, unknown>)["groundingId"] as string);
    expect(job).toMatchObject({ status: "COMPLETED", result: { status: "COMPLETED" } });
    const products = await pool.query<{
      product_kind: string;
      payload: unknown | null;
      payload_ref: string | null;
      payload_hash: string;
    }>(
      `SELECT product_kind, payload, payload_ref, payload_hash
         FROM wsgs.result_product
        ORDER BY product_kind`
    );
    expect(products.rows).toHaveLength(2);
    expect(products.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        product_kind: "RESOLVED_REFERENCE",
        payload: expect.objectContaining({ productId: "reference-product-integration" }),
        payload_ref: null,
        payload_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
      }),
      expect.objectContaining({
        product_kind: "WORLD_FACT",
        payload: null,
        payload_ref: "urn:wsgs:test:evidence-product",
        payload_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
      })
    ]));
    const replay = await backend.create(identity, "idem-complete", body, true);
    expect(replay).toEqual({ kind: "RESULT", value: (job as Record<string, unknown>)["result"] });
  });

  it("rolls back settlement before any result write when the frozen result schema rejects the bytes", async () => {
    await backend.create(identity, "idem-invalid-result", request("invalid-result"), true);
    const workerStore = new PostgresGroundingWorkerStore(pool, codec);
    const claimed = await workerStore.claimNext("worker-invalid-result", 5_000);
    expect(claimed).not.toBeNull();
    const resultHash = `sha256:${"9".repeat(64)}`;
    const invalidBytes = new TextEncoder().encode(JSON.stringify({
      schemaVersion: "1.0",
      status: "COMPLETED",
      resultHash,
      forbiddenUnexpectedField: "must-never-be-persisted"
    }));

    await expect(workerStore.settle(claimed!, {
      kind: "RESULT",
      status: "COMPLETED",
      resultHash,
      resultBytes: invalidBytes
    })).rejects.toMatchObject({ code: "GROUNDING_RESULT_SCHEMA_INVALID", retryable: false });

    const persisted = await pool.query<{
      result_count: string;
      product_count: string;
      idempotency_result_count: string;
      job_status: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM wsgs.grounding_result) AS result_count,
         (SELECT count(*)::text FROM wsgs.result_product) AS product_count,
         (SELECT count(*)::text FROM wsgs.idempotency WHERE result_bytes IS NOT NULL) AS idempotency_result_count,
         (SELECT status FROM wsgs.grounding_job LIMIT 1) AS job_status`
    );
    expect(persisted.rows[0]).toEqual({
      result_count: "0",
      product_count: "0",
      idempotency_result_count: "0",
      job_status: "RUNNING"
    });
  });

  it("persists and replays the full 1.1 extension only under its immutable selection", async () => {
    const created = await backend.create(
      identity,
      "idem-geospatial-extension",
      request("geospatial-extension"),
      true,
      SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION
    );
    const workerStore = new PostgresGroundingWorkerStore(pool, codec);
    const claim = await workerStore.claimNext("worker-geospatial-extension", 5_000);
    expect(claim?.initialState["contractSelection"]).toEqual(SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION);
    const material = structuredClone(geospatialResult);
    delete material["resultHash"];
    const pipeline = new GroundingPipeline({
      executor: executor([], { RESULT_PERSIST: async () => material }),
      journal: new PostgresPipelineJournal(pool, codec)
    });
    const result = await pipeline.run({ ...claim!, fence: claim! });
    expect(await workerStore.settle(claim!, {
      kind: "RESULT",
      status: result.status,
      resultHash: result.resultHash,
      resultBytes: result.resultBytes
    })).toBe("APPLIED");
    const groundingId = (created.value as Record<string, unknown>)["groundingId"] as string;
    const replay = await backend.get(identity, groundingId, SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION);
    expect(replay).toMatchObject({
      status: "COMPLETED",
      result: { resultHash: result.resultHash, geospatialFindings: { profile: "sacs-wsgs-geospatial-findings/1.0" } }
    });
    await expect(backend.get(identity, groundingId)).rejects.toBeInstanceOf(PostgresGroundingContractMismatchError);
    await expect(backend.cancel(identity, groundingId)).rejects.toBeInstanceOf(PostgresGroundingContractMismatchError);
    expect(await backend.get(
      { ...identity, servicePrincipalId: "foreign-service" },
      groundingId,
      SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION
    )).toBeNull();
    const diminishedIdentity = {
      ...identity,
      datasetScopes: ["roads"],
      authorizationContextHash: `sha256:${"b".repeat(64)}`
    };
    expect(await backend.get(
      diminishedIdentity,
      groundingId,
      SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION
    )).toBeNull();
    expect(await backend.cancel(
      diminishedIdentity,
      groundingId,
      SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION
    )).toBeNull();
    await expect(backend.create(
      diminishedIdentity,
      "idem-geospatial-extension",
      request("geospatial-extension"),
      true,
      SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION
    )).rejects.toBeInstanceOf(PostgresIdempotencyConflictError);
  });

  it("rejects idempotency payload drift in the database serialization transaction", async () => {
    await backend.create(identity, "idem-conflict", request("conflict", "first-secret"), true);
    await expect(
      backend.create(identity, "idem-conflict", request("conflict", "different-secret"), true)
    ).rejects.toBeInstanceOf(PostgresIdempotencyConflictError);
    const count = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM wsgs.grounding_job");
    expect(count.rows[0]?.count).toBe("1");
  });

  it("recovers the last atomic checkpoint under a new generation without redoing completed stages", async () => {
    const created = await backend.create(identity, "idem-recover", request("recover"), true);
    const workerStore = new PostgresGroundingWorkerStore(pool, codec);
    const firstClaim = await workerStore.claimNext("worker-first", 5_000);
    expect(firstClaim).not.toBeNull();
    const firstCalls: PipelineStage[] = [];
    const temporary = Object.assign(new Error("test adapter interruption"), {
      code: "GOWM_TEMPORARY_UNAVAILABLE",
      retryable: true
    });
    const firstPipeline = new GroundingPipeline({
      executor: executor(firstCalls, {
        GOWM_EXECUTE: async () => {
          firstCalls.push("GOWM_EXECUTE");
          throw temporary;
        }
      }),
      journal: new PostgresPipelineJournal(pool, codec),
      policy: () => ({ maxAttempts: 1, attemptTimeoutMs: 5_000, baseBackoffMs: 0, retryable: () => false })
    });
    await expect(firstPipeline.run({ ...firstClaim!, fence: firstClaim! })).rejects.toBe(temporary);
    expect(await workerStore.settle(firstClaim!, {
      kind: "RETRY",
      errorCode: temporary.code,
      retryable: true,
      availableAt: new Date(Date.now() - 1)
    })).toBe("APPLIED");

    const restartedStore = new PostgresGroundingWorkerStore(pool, codec);
    const recoveredClaim = await restartedStore.claimNext("worker-restarted", 5_000);
    expect(recoveredClaim).toMatchObject({
      jobId: (created.value as Record<string, unknown>)["jobId"],
      generation: 2,
      attempt: 2,
      immutableLocks: locks
    });
    const recoveredCalls: PipelineStage[] = [];
    const result = await new GroundingPipeline({
      executor: executor(recoveredCalls),
      journal: new PostgresPipelineJournal(pool, codec)
    }).run({ ...recoveredClaim!, fence: recoveredClaim! });
    expect(result.recoveredStages.at(-1)).toBe("WORLD_QUERY_COMPILE");
    expect(recoveredCalls).toEqual(["GOWM_EXECUTE", "EVIDENCE_NORMALIZE", "PRODUCT_ASSEMBLE", "RESULT_PERSIST"]);
    expect(await restartedStore.settle(recoveredClaim!, {
      kind: "RESULT",
      status: result.status,
      resultHash: result.resultHash,
      resultBytes: result.resultBytes
    })).toBe("APPLIED");
  });

  it("delivers database cancellation and rejects a late worker generation result", async () => {
    const created = await backend.create(identity, "idem-cancel", request("cancel"), true);
    let stageStarted!: () => void;
    const started = new Promise<void>((resolveStarted) => { stageStarted = resolveStarted; });
    const workerStore = new PostgresGroundingWorkerStore(pool, codec);
    const worker = new GroundingWorker({
      workerId: "worker-cancel",
      store: workerStore,
      pipeline: new GroundingPipeline({
        executor: executor([], {
          SEMANTIC_MODEL_PARSE: async () => {
            stageStarted();
            return new Promise((resolveLate) => setTimeout(() => resolveLate({ late: true }), 250));
          }
        }),
        journal: new PostgresPipelineJournal(pool, codec)
      }),
      leaseMs: 5_000,
      heartbeatMs: 500
    });
    const listener = new PostgresCancellationListener(pool);
    await listener.start(worker);
    try {
      const running = worker.runOnce();
      await started;
      const groundingId = (created.value as Record<string, unknown>)["groundingId"] as string;
      expect(await backend.cancel(identity, groundingId)).toMatchObject({ status: "CANCELLED" });
      expect(await running).toMatchObject({ kind: "FENCE_REJECTED" });
      await new Promise((resolveLate) => setTimeout(resolveLate, 275));
      const result = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM wsgs.grounding_result WHERE grounding_id = $1",
        [groundingId]
      );
      expect(result.rows[0]?.count).toBe("0");
      expect(await backend.get(identity, groundingId)).toMatchObject({ status: "CANCELLED" });
    } finally {
      await listener.close();
    }
  });
});
