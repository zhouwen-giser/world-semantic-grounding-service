import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createGroundingIdentity } from "@wsgs/delegated-identity";
import {
  Aes256GcmPayloadCodec,
  GroundingPipeline,
  PostgresPipelineJournal,
  canonicalSha256,
  type PipelineStage,
  type PipelineStageContext,
  type PipelineStageExecutor
} from "@wsgs/grounding-pipeline";
import { applyMigrations } from "@wsgs/runtime";
import { Pool } from "pg";

import { createGroundingApi } from "../../services/grounding-api/src/server.js";
import { createProductionBackendFromEnvironment } from "../../services/grounding-api/src/production.js";
import {
  captureAdmissionSnapshot,
  checkReadiness,
  checkReadinessForCurrentEnvironment,
  createPipelineStageExecutor
} from "../../services/grounding-worker/src/production-module.js";
import { productionPipelinePolicyFromEnvironment } from "../../services/grounding-worker/src/pipeline-policy.js";
import { PostgresGroundingWorkerStore } from "../../services/grounding-worker/src/postgres-store.js";
import { GroundingWorker } from "../../services/grounding-worker/src/worker.js";

type JsonObject = Record<string, unknown>;

if (process.env["ALLOW_REAL_DEVELOPMENT_PIPELINE_GATE"] !== "YES") {
  throw new Error("Set ALLOW_REAL_DEVELOPMENT_PIPELINE_GATE=YES to run real development dependencies");
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function list(name: string): string[] {
  return required(name).split(/[ ,]+/u).map((entry) => entry.trim()).filter(Boolean);
}

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonObject;
}

function string(value: unknown, code: string): string {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function safeId(value: string): `sha256:${string}` {
  return sha256(value);
}

function loadSchemas(): Record<string, unknown> {
  const directory = resolve(process.cwd(), "contracts", "wsgs-v0.1", "contracts");
  return Object.fromEntries(readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name, JSON.parse(readFileSync(resolve(directory, name), "utf8")) as unknown]));
}

function referenceMap(): JsonObject[] {
  const directory = required("GOWM_SAMPLE_HANDOFF_DIR");
  const value = JSON.parse(readFileSync(resolve(directory, "SAMPLE_REFERENCE_MAP.json"), "utf8")) as JsonObject;
  if (!Array.isArray(value["entries"])) throw new Error("SAMPLE_REFERENCE_MAP_INVALID");
  return value["entries"].map((entry) => object(entry, "SAMPLE_REFERENCE_ENTRY_INVALID"));
}

function visibleReference(fixtureKey: string, field: "currentWorldReferenceKey" | "currentCatalogReferenceKey"): JsonObject {
  const entry = referenceMap().find((candidate) => candidate["fixtureKey"] === fixtureKey);
  if (!entry || entry["scope"] !== "wsgs-demo") throw new Error("VISIBLE_SAMPLE_REFERENCE_MISSING");
  return object(entry[field], "VISIBLE_SAMPLE_REFERENCE_KEY_MISSING");
}

const sourceCommit = required("WSGS_EVIDENCE_SOURCE_COMMIT");
if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error("WSGS_EVIDENCE_SOURCE_COMMIT_INVALID");
const databaseUrl = required("DATABASE_URL");
const evidenceDirectory = resolve(process.env["WSGS_DEVELOPMENT_EVIDENCE_DIR"] ?? "reports/wsgs-v0.2");
const recipeEvidenceDirectory = resolve(evidenceDirectory, "recipe-evidence");
const encryptionKey = required("WSGS_REQUEST_ENCRYPTION_KEY_BASE64");
const identity = createGroundingIdentity({
  servicePrincipalId: required("GOWM_DELEGATION_SERVICE_PRINCIPAL_ID"),
  actorId: required("WSGS_READINESS_ACTOR_ID"),
  dataScopes: [required("WSGS_READINESS_DATA_SCOPE")],
  datasetScopes: list("WSGS_READINESS_DATASET_SCOPES"),
  permissions: [...new Set([...list("WSGS_READINESS_PERMISSIONS"), "grounding.read"])]
});

interface CaseEvidence {
  recipeId: string;
  requestHash: `sha256:${string}`;
  groundingIdHash: `sha256:${string}`;
  terminalStatus: string;
  resultHash: `sha256:${string}`;
  stageHashes: `sha256:${string}`[];
  completedStages: string[];
  planHashes: `sha256:${string}`[];
  upstreamResultHashes: `sha256:${string}`[];
  modelReceiptCount: number;
  worldQueryCount: number;
  spatialExecutionCount: number;
  totalStageElapsedMs: number;
}

const pool = new Pool({ connectionString: databaseUrl, max: 12, application_name: "wsgs-development-closure-gate" });
let resources: ReturnType<typeof createProductionBackendFromEnvironment> | undefined;
let app: Awaited<ReturnType<typeof createGroundingApi>> | undefined;
let exitCode = 1;

async function resetDatabase(): Promise<void> {
  await applyMigrations(pool, resolve(process.cwd(), "database", "migrations"));
  await pool.query(`TRUNCATE TABLE
    wsgs.pipeline_event, wsgs.pipeline_checkpoint, wsgs.gowm_execution,
    wsgs.model_receipt, wsgs.capability_snapshot, wsgs.result_product,
    wsgs.grounding_result, wsgs.world_query, wsgs.grounding_graph,
    wsgs.semantic_frame, wsgs.idempotency, wsgs.grounding_job,
    wsgs.grounding_request CASCADE`);
}

function requestBody(
  caseId: string,
  text: string,
  operation: "GROUND_REFERENCES" | "VALIDATE_REFERENCES" | "EXECUTE_WORLD_QUERY",
  requestedProducts: string[],
  knownWorldReferences: JsonObject[] = [],
  maxResultBytes = 1_048_576
): JsonObject {
  const requestId = `development-${caseId.toLowerCase()}-${sourceCommit.slice(0, 12)}`;
  return {
    schemaVersion: "1.0",
    requestId,
    operation,
    source: {
      conversationRef: `conversation-${caseId.toLowerCase()}`,
      messageId: `message-${caseId.toLowerCase()}`,
      originalText: text,
      originalTextSha256: sha256(text),
      locale: "zh-CN",
      createdAt: new Date().toISOString()
    },
    requestedProducts,
    contextCapsule: {
      knownWorldReferences,
      priorGroundings: [],
      mapSelections: [],
      externalCorrelationHints: [],
      externalPredicates: []
    },
    executionPolicy: {
      readOnly: true,
      deadlineMs: 120_000,
      maxQueryOperations: 16,
      maxCandidatesPerMention: 20,
      maxResultBytes,
      allowApproximation: false
    }
  };
}

function worker(executor: PipelineStageExecutor, workerId: string): GroundingWorker {
  const codec = Aes256GcmPayloadCodec.fromBase64(encryptionKey);
  return new GroundingWorker({
    workerId,
    store: new PostgresGroundingWorkerStore(pool, codec),
    pipeline: new GroundingPipeline({
      executor,
      journal: new PostgresPipelineJournal(pool, codec),
      policy: productionPipelinePolicyFromEnvironment()
    }),
    leaseMs: 5_000,
    heartbeatMs: 500,
    pollIntervalMs: 10,
    concurrency: 1,
    maxJobAttempts: 3,
    retryBackoffMs: 0
  });
}

async function fetchJson(baseUrl: string, path: string, init?: RequestInit): Promise<{ status: number; body: JsonObject }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: object(await response.json(), "API_RESPONSE_INVALID") };
}

async function collect(groundingId: string, requestHash: `sha256:${string}`): Promise<CaseEvidence> {
  const job = await pool.query<{ job_id: string }>(
    "SELECT job_id FROM wsgs.grounding_job WHERE grounding_id = $1",
    [groundingId]
  );
  if (!job.rows[0]) throw new Error("GROUNDING_JOB_MISSING");
  const events = await pool.query<{
    stage: string; status: string; output_hash: `sha256:${string}` | null;
    record_hash: `sha256:${string}`; elapsed_ms: number;
  }>(
    `SELECT stage, status, output_hash, record_hash, elapsed_ms
       FROM wsgs.pipeline_event WHERE grounding_id = $1 ORDER BY event_id`,
    [groundingId]
  );
  const terminalEvents = events.rows.filter((event) => event.status !== "STARTED");
  const queries = await pool.query<{
    plan_hash: `sha256:${string}`; upstream_result_hash: `sha256:${string}` | null;
  }>(
    "SELECT plan_hash, upstream_result_hash FROM wsgs.world_query WHERE grounding_id = $1 ORDER BY query_id",
    [groundingId]
  );
  const executions = await pool.query<{
    operation_id: string | null; result_hash: `sha256:${string}` | null;
  }>(
    "SELECT operation_id, result_hash FROM wsgs.gowm_execution WHERE grounding_id = $1 ORDER BY execution_id",
    [groundingId]
  );
  const model = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM wsgs.model_receipt WHERE grounding_id = $1",
    [groundingId]
  );
  const result = await pool.query<{ status: string; result_hash: `sha256:${string}` }>(
    "SELECT status, result_hash FROM wsgs.grounding_result WHERE grounding_id = $1",
    [groundingId]
  );
  const resultRow = result.rows[0];
  if (!resultRow) throw new Error("GROUNDING_RESULT_MISSING");
  return {
    recipeId: "",
    requestHash,
    groundingIdHash: safeId(groundingId),
    terminalStatus: resultRow.status,
    resultHash: resultRow.result_hash,
    stageHashes: terminalEvents.map((event) => event.output_hash ?? event.record_hash),
    completedStages: terminalEvents.filter((event) => ["COMPLETED", "PARTIAL"].includes(event.status)).map((event) => event.stage),
    planHashes: queries.rows.map((row) => row.plan_hash),
    upstreamResultHashes: queries.rows.flatMap((row) => row.upstream_result_hash ? [row.upstream_result_hash] : []),
    modelReceiptCount: Number(model.rows[0]?.count ?? 0),
    worldQueryCount: queries.rowCount ?? 0,
    spatialExecutionCount: executions.rows.filter((row) => row.operation_id?.startsWith("spatial.")).length,
    totalStageElapsedMs: terminalEvents.reduce((sum, event) => sum + event.elapsed_ms, 0)
  };
}

async function submitAndRun(
  baseUrl: string,
  executor: PipelineStageExecutor,
  recipeId: string,
  body: JsonObject,
  acceptedStatuses: readonly string[]
): Promise<CaseEvidence> {
  const requestHash = canonicalSha256(body) as `sha256:${string}`;
  const submitted = await fetchJson(baseUrl, "/v1/groundings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `development-${recipeId.toLowerCase()}-${requestHash.slice(-20)}`,
      prefer: "respond-async"
    },
    body: JSON.stringify(body)
  });
  if (submitted.status !== 202 || submitted.body["status"] !== "ACCEPTED") {
    throw new Error(`PUBLIC_API_SUBMIT_FAILED_${recipeId}_${submitted.status}`);
  }
  const groundingId = string(submitted.body["groundingId"], "GROUNDING_ID_MISSING");
  const outcome = await worker(executor, `development-${recipeId.toLowerCase()}`).runOnce();
  if (outcome.kind !== "SUCCEEDED") throw new Error(`WORKER_${recipeId}_${outcome.kind}`);
  const fetched = await fetchJson(baseUrl, `/v1/groundings/${encodeURIComponent(groundingId)}`);
  if (fetched.status !== 200) throw new Error(`PUBLIC_API_GET_FAILED_${recipeId}_${fetched.status}`);
  const terminalStatus = string(fetched.body["status"], "GROUNDING_STATUS_MISSING");
  if (!acceptedStatuses.includes(terminalStatus)) {
    throw new Error(`UNEXPECTED_TERMINAL_STATUS_${recipeId}_${terminalStatus}`);
  }
  const evidence = await collect(groundingId, requestHash);
  if (evidence.resultHash !== fetched.body["resultHash"]) throw new Error(`RESULT_HASH_MISMATCH_${recipeId}`);
  return { ...evidence, recipeId };
}

class RestartBarrierExecutor implements PipelineStageExecutor {
  readonly reached: Promise<void>;
  #releaseReached!: () => void;

  constructor(private readonly delegate: PipelineStageExecutor) {
    this.reached = new Promise((resolveReached) => { this.#releaseReached = resolveReached; });
  }

  async execute(stage: PipelineStage, context: PipelineStageContext): Promise<unknown> {
    if (stage !== "GOWM_EXECUTE") return this.delegate.execute(stage, context);
    this.#releaseReached();
    return await new Promise((_resolve, reject) => {
      const aborted = (): void => reject(context.signal.reason instanceof Error
        ? context.signal.reason
        : new Error("WORKER_RESTART_ABORTED"));
      if (context.signal.aborted) aborted();
      else context.signal.addEventListener("abort", aborted, { once: true });
    });
  }
}

async function recoveryCase(baseUrl: string, productionExecutor: PipelineStageExecutor): Promise<JsonObject> {
  const body = requestBody("RECOVERY", "2号车在哪里？", "EXECUTE_WORLD_QUERY", ["WORLD_EVIDENCE"]);
  const requestHash = canonicalSha256(body) as `sha256:${string}`;
  const submitted = await fetchJson(baseUrl, "/v1/groundings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `development-recovery-${requestHash.slice(-20)}`,
      prefer: "respond-async"
    },
    body: JSON.stringify(body)
  });
  if (submitted.status !== 202) throw new Error("RECOVERY_SUBMIT_FAILED");
  const groundingId = string(submitted.body["groundingId"], "RECOVERY_GROUNDING_ID_MISSING");
  const barrier = new RestartBarrierExecutor(productionExecutor);
  const firstWorker = worker(barrier, "development-restart-before-gowm");
  const firstRun = firstWorker.runOnce();
  await Promise.race([
    barrier.reached,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("RECOVERY_BARRIER_TIMEOUT")), 120_000))
  ]);
  const stopped = await firstWorker.stop(0);
  const firstOutcome = await firstRun;
  if (firstOutcome.kind !== "RETRY_SCHEDULED" || stopped.aborted !== 1) {
    throw new Error(`RECOVERY_FIRST_WORKER_${firstOutcome.kind}`);
  }
  const secondWorker = worker(productionExecutor, "development-restart-resume");
  let secondOutcome = await secondWorker.runOnce();
  for (let attempt = 0; secondOutcome.kind === "IDLE" && attempt < 20; attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    secondOutcome = await secondWorker.runOnce();
  }
  if (secondOutcome.kind !== "SUCCEEDED") throw new Error(`RECOVERY_SECOND_WORKER_${secondOutcome.kind}`);
  const events = await pool.query<{ stage: string; status: string; generation: number }>(
    "SELECT stage, status, generation FROM wsgs.pipeline_event WHERE grounding_id = $1 ORDER BY event_id",
    [groundingId]
  );
  const modelCompleted = events.rows.filter((event) => event.stage === "SEMANTIC_MODEL_PARSE" && event.status === "COMPLETED");
  const gowmCompleted = events.rows.filter((event) => event.stage === "GOWM_EXECUTE" && event.status === "COMPLETED");
  const generations = [...new Set(events.rows.map((event) => event.generation))];
  if (modelCompleted.length !== 1 || gowmCompleted.length !== 1 || generations.length !== 2) {
    throw new Error("RECOVERY_DUPLICATE_EXECUTION_OR_GENERATION_MISSING");
  }
  const fetched = await fetchJson(baseUrl, `/v1/groundings/${encodeURIComponent(groundingId)}`);
  if (fetched.status !== 200 || fetched.body["status"] !== "COMPLETED") throw new Error("RECOVERY_RESULT_MISSING");
  return {
    status: "PASS",
    groundingIdHash: safeId(groundingId),
    requestHash,
    generationCount: generations.length,
    modelCompletedCount: modelCompleted.length,
    gowmCompletedCount: gowmCompleted.length,
    resultHash: fetched.body["resultHash"]
  };
}

try {
  await resetDatabase();
  const productionExecutor = await createPipelineStageExecutor({ pool });
  resources = createProductionBackendFromEnvironment({
    readinessProbe: { checkReadiness, captureAdmissionSnapshot }
  });
  app = await createGroundingApi({
    auth: { mode: "STATIC_TRUSTED", identity },
    backend: resources.backend,
    schemas: loadSchemas(),
    logger: false
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("PUBLIC_API_ADDRESS_INVALID");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const live = await fetchJson(baseUrl, "/health/live");
  const ready = await fetchJson(baseUrl, "/health/ready");
  if (live.status !== 200 || live.body["status"] !== "live") throw new Error("CURRENT_LOCK_LIVENESS_FAILED");
  if (ready.status !== 200 || ready.body["status"] !== "ready") {
    const reasons = Array.isArray(ready.body["reasons"])
      ? ready.body["reasons"].filter((entry): entry is string => typeof entry === "string").join("_")
      : "NO_REASON";
    throw new Error(`CURRENT_LOCK_READINESS_FAILED_${ready.status}_${String(ready.body["status"])}_${reasons}`);
  }

  const vehicle = visibleReference("ugv-002", "currentWorldReferenceKey");
  const knownVehicle = {
    alias: "2号车",
    referenceKey: vehicle,
    referenceType: "WORLD_OBJECT",
    sourceMessageId: "message-known-vehicle"
  };
  const cases: CaseEvidence[] = [];
  cases.push(await submitAndRun(baseUrl, productionExecutor, "R1", requestBody(
    "R1", "2号车在哪里？", "EXECUTE_WORLD_QUERY", ["WORLD_EVIDENCE"]
  ), ["COMPLETED"]));
  cases.push(await submitAndRun(baseUrl, productionExecutor, "R2", requestBody(
    "R2", "滨河路附近有哪些设备？", "EXECUTE_WORLD_QUERY", ["WORLD_EVIDENCE"]
  ), ["AMBIGUOUS"]));
  if (cases.at(-1)?.spatialExecutionCount !== 0 || cases.at(-1)?.worldQueryCount !== 0) {
    throw new Error("AMBIGUOUS_REFERENCE_DID_NOT_STOP_SPATIAL_EXECUTION");
  }
  cases.push(await submitAndRun(baseUrl, productionExecutor, "R3", requestBody(
    "R3", "A区内有哪些车辆？", "EXECUTE_WORLD_QUERY", ["WORLD_EVIDENCE"]
  ), ["COMPLETED"]));
  cases.push(await submitAndRun(baseUrl, productionExecutor, "R4", requestBody(
    "R4", "2号车附近1公里有什么？", "EXECUTE_WORLD_QUERY", ["WORLD_EVIDENCE"]
  ), ["COMPLETED"]));
  cases.push(await submitAndRun(baseUrl, productionExecutor, "R5", requestBody(
    "R5", "验证2号车当前有效性", "VALIDATE_REFERENCES", ["RESOLVED_REFERENCES"], [knownVehicle]
  ), ["COMPLETED"]));

  const savedModel = {
    policy: process.env["WSGS_MODEL_POLICY"],
    baseUrl: process.env["MODEL_BASE_URL"],
    apiKey: process.env["MODEL_API_KEY"],
    name: process.env["MODEL_NAME"]
  };
  process.env["WSGS_MODEL_POLICY"] = "MODEL_OPTIONAL";
  delete process.env["MODEL_BASE_URL"];
  delete process.env["MODEL_API_KEY"];
  delete process.env["MODEL_NAME"];
  const optionalReadiness = await checkReadinessForCurrentEnvironment({ pool });
  if (!optionalReadiness.ready || optionalReadiness.reasons.length !== 0) {
    throw new Error(`MODEL_OPTIONAL_READINESS_FAILED_${optionalReadiness.reasons.join("_")}`);
  }
  const optionalExecutor = await createPipelineStageExecutor({ pool });
  process.env["WSGS_MODEL_POLICY"] = savedModel.policy ?? "MODEL_REQUIRED";
  if (savedModel.baseUrl === undefined) delete process.env["MODEL_BASE_URL"]; else process.env["MODEL_BASE_URL"] = savedModel.baseUrl;
  if (savedModel.apiKey === undefined) delete process.env["MODEL_API_KEY"]; else process.env["MODEL_API_KEY"] = savedModel.apiKey;
  if (savedModel.name === undefined) delete process.env["MODEL_NAME"]; else process.env["MODEL_NAME"] = savedModel.name;
  cases.push(await submitAndRun(baseUrl, optionalExecutor, "R6", requestBody(
    "R6", "查询坐标 113.93,22.54 附近对象", "GROUND_REFERENCES", ["RESOLVED_REFERENCES"]
  ), ["UNRESOLVED", "PARTIAL", "COMPLETED"]));
  if (cases.at(-1)?.modelReceiptCount !== 0) throw new Error("MODEL_OPTIONAL_FALLBACK_CALLED_MODEL");

  const noData = await submitAndRun(baseUrl, productionExecutor, "NO_DATA", requestBody(
    "NO-DATA", "4号车在哪里？", "GROUND_REFERENCES", ["RESOLVED_REFERENCES"]
  ), ["UNRESOLVED"]);
  const partial = await submitAndRun(baseUrl, optionalExecutor, "PARTIAL", requestBody(
    "PARTIAL", "2号车在哪里？", "GROUND_REFERENCES", ["RESOLVED_REFERENCES"], [knownVehicle]
  ), ["PARTIAL"]);

  const authorityInjectionBody = { ...requestBody(
    "AUTHORITY", "2号车在哪里？", "GROUND_REFERENCES", ["RESOLVED_REFERENCES"]
  ), actorId: "forged-actor" };
  const authorityInjection = await fetchJson(baseUrl, "/v1/groundings", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "development-authority-injection" },
    body: JSON.stringify(authorityInjectionBody)
  });
  if (authorityInjection.status !== 400) throw new Error("BODY_AUTHORITY_INJECTION_NOT_REJECTED");

  // Exercise the real scoped lookup with the raw id only in process. The
  // emitted evidence contains its hash, never the authority-bearing id.
  const rawId = await pool.query<{ grounding_id: string }>(
    "SELECT grounding_id FROM wsgs.grounding_result WHERE result_hash = $1",
    [cases[0]!.resultHash]
  );
  const crossScopeReal = await createGroundingApi({
    auth: {
      mode: "STATIC_TRUSTED",
      identity: createGroundingIdentity({
        servicePrincipalId: identity.servicePrincipalId,
        actorId: "development-cross-scope",
        dataScopes: ["development-other-scope"],
        datasetScopes: [],
        permissions: ["grounding.read"]
      })
    },
    backend: resources.backend,
    schemas: loadSchemas(),
    logger: false
  });
  const crossScopeRealResponse = await crossScopeReal.inject({
    method: "GET",
    url: `/v1/groundings/${encodeURIComponent(string(rawId.rows[0]?.grounding_id, "CROSS_SCOPE_SOURCE_ID_MISSING"))}`
  });
  await crossScopeReal.close();
  if (crossScopeRealResponse.statusCode !== 404) {
    throw new Error("CROSS_SCOPE_RESULT_DISCLOSURE");
  }

  const recovery = await recoveryCase(baseUrl, productionExecutor);
  const r1 = cases[0]!;
  if (r1.completedStages.length !== 14 || r1.stageHashes.length !== 14 || r1.modelReceiptCount < 1 || r1.worldQueryCount < 1) {
    throw new Error("REAL_PIPELINE_STAGE_PROOF_INCOMPLETE");
  }
  if (cases[3]?.planHashes.length === 0) throw new Error("R4_PLAN_HASH_MISSING");

  mkdirSync(recipeEvidenceDirectory, { recursive: true });
  const realPipelineEvidence = {
    schemaVersion: "1.0",
    sourceCommit,
    requestHash: r1.requestHash,
    terminalStatus: r1.terminalStatus,
    stageHashes: r1.stageHashes,
    resultHash: r1.resultHash,
    realDependencies: { api: true, postgres: true, worker: true, model: true, gowm: true },
    status: "PASS"
  };
  writeFileSync(resolve(evidenceDirectory, "real-pipeline-evidence.json"), `${JSON.stringify(realPipelineEvidence, null, 2)}\n`);
  for (const evidence of cases) {
    const recipeEvidence = {
      schemaVersion: "1.0",
      recipeId: evidence.recipeId,
      requestHash: evidence.requestHash,
      compilerOrigin: "WSGS_PRODUCTION_PIPELINE",
      ...(evidence.planHashes[0] ? { planHash: evidence.planHashes[0] } : {}),
      terminalStatus: evidence.terminalStatus,
      status: "PASS"
    };
    writeFileSync(resolve(recipeEvidenceDirectory, `${evidence.recipeId}.json`), `${JSON.stringify(recipeEvidence, null, 2)}\n`);
  }
  const summary = {
    schemaVersion: "1.0",
    gate: "validation/scripts/real-development-pipeline-gate.ts",
    sourceCommit,
    status: "PASS",
    executionClassification: "TRUSTED",
    readiness: {
      liveHttpStatus: live.status,
      readyHttpStatus: ready.status,
      currentOperationalLock: "PASS",
      modelRequired: "PASS",
      modelOptionalWithoutModel: "PASS"
    },
    realDependencies: { api: true, postgres: true, worker: true, model: true, gowm: true },
    recipes: cases.map((entry) => ({
      recipeId: entry.recipeId,
      requestHash: entry.requestHash,
      groundingIdHash: entry.groundingIdHash,
      terminalStatus: entry.terminalStatus,
      resultHash: entry.resultHash,
      stageCount: entry.completedStages.length,
      planHashes: entry.planHashes,
      upstreamResultHashes: entry.upstreamResultHashes,
      worldQueryCount: entry.worldQueryCount,
      spatialExecutionCount: entry.spatialExecutionCount,
      modelReceiptCount: entry.modelReceiptCount,
      totalStageElapsedMs: entry.totalStageElapsedMs,
      status: "PASS"
    })),
    additionalSemantics: {
      noData: { requestHash: noData.requestHash, terminalStatus: noData.terminalStatus, status: "PASS" },
      partial: { requestHash: partial.requestHash, terminalStatus: partial.terminalStatus, status: "PASS" }
    },
    security: {
      bodyAuthorityInjection: { httpStatus: authorityInjection.status, status: "PASS" },
      crossScopeNonDisclosure: { httpStatus: crossScopeRealResponse.statusCode, status: "PASS" },
      credentialPersistence: false,
      status: "PASS"
    },
    recovery,
    redaction: {
      credentialsIncluded: false,
      rawBusinessResponsesIncluded: false,
      rawGroundingIdsIncluded: false,
      externalJobIdsIncluded: false
    }
  };
  writeFileSync(resolve(evidenceDirectory, "development-closure-gate.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    marker: "WSGS_REAL_DEVELOPMENT_PIPELINE_PASS",
    sourceCommit,
    recipesPassed: cases.length,
    pipelineStages: r1.completedStages.length,
    currentLockReadiness: "PASS",
    minimumSecurity: "PASS",
    workerRestart: "PASS",
    noData: "PASS",
    partial: "PASS"
  }, null, 2)}\n`);
  exitCode = 0;
} catch (error) {
  const code = error instanceof Error ? error.message.replace(/[^A-Za-z0-9_:-]/gu, "_").slice(0, 240) : "UNKNOWN_ERROR";
  process.stderr.write(`${JSON.stringify({ marker: "WSGS_REAL_DEVELOPMENT_PIPELINE_BLOCKED", code })}\n`);
} finally {
  await app?.close().catch(() => undefined);
  await resources?.close().catch(() => undefined);
  await pool.end().catch(() => undefined);
}

process.exit(exitCode);
