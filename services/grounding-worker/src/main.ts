import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  Aes256GcmPayloadCodec,
  GroundingPipeline,
  PostgresPipelineJournal,
  type PipelineStageExecutor
} from "@wsgs/grounding-pipeline";
import { Pool } from "pg";

import { PostgresCancellationListener, PostgresGroundingWorkerStore } from "./postgres-store.js";
import { productionPipelinePolicyFromEnvironment } from "./pipeline-policy.js";
import { GroundingWorker } from "./worker.js";
import { cleanupExpiredSources, SourceCleanupLoop } from "./source-cleanup.js";
import { safeRuntimeErrorCode, type WorkerRuntimeLogger } from "./runtime-errors.js";

const log: WorkerRuntimeLogger = event => {
  process.stdout.write(`${JSON.stringify({ level: event.code ? "error" : "info", ...event })}\n`);
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function integerEnvironment(name: string, fallback: number, minimum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}`);
  }
  return value;
}

async function loadExecutor(pool: Pool, priorAnalysisJournal: PostgresPipelineJournal): Promise<PipelineStageExecutor> {
  const moduleSpecifier = process.env["WSGS_PIPELINE_MODULE"] ?? new URL("./production-module.js", import.meta.url).href;
  const importSpecifier = isAbsolute(moduleSpecifier) || moduleSpecifier.startsWith(".")
    ? pathToFileURL(resolve(moduleSpecifier)).href
    : moduleSpecifier;
  const loaded = await import(importSpecifier) as Record<string, unknown>;
  const factory = loaded["createPipelineStageExecutor"];
  if (typeof factory !== "function") {
    throw new Error("WSGS_PIPELINE_MODULE must export createPipelineStageExecutor()");
  }
  const executor = await (factory as (options: { pool: Pool; priorAnalysisJournal: PostgresPipelineJournal }) => unknown | Promise<unknown>)({ pool, priorAnalysisJournal });
  if (!executor || typeof executor !== "object" ||
    typeof (executor as Record<string, unknown>)["execute"] !== "function") {
    throw new Error("createPipelineStageExecutor() did not return a pipeline stage executor");
  }
  return executor as PipelineStageExecutor;
}

const databaseUrl = required("DATABASE_URL");
const codec = Aes256GcmPayloadCodec.fromBase64(required("WSGS_REQUEST_ENCRYPTION_KEY_BASE64"));
const pool = new Pool({
  connectionString: databaseUrl,
  max: integerEnvironment("WSGS_WORKER_DATABASE_POOL_SIZE", 8, 2),
  connectionTimeoutMillis: 5_000,
  query_timeout: 30_000,
  application_name: "wsgs-grounding-worker"
});
pool.on("error", error => log({ event: "worker_database_error", stage: "DATABASE", code: safeRuntimeErrorCode(error) }));
await pool.query("SELECT 1 FROM wsgs.pipeline_checkpoint LIMIT 0");
const journal = new PostgresPipelineJournal(pool, codec);
const executor = await loadExecutor(pool, journal);

const store = new PostgresGroundingWorkerStore(pool, codec, log);
const pipeline = new GroundingPipeline({
  executor,
  journal,
  policy: productionPipelinePolicyFromEnvironment()
});
const worker = new GroundingWorker({
  workerId: process.env["WSGS_WORKER_ID"] ?? `worker-${randomUUID()}`,
  store,
  pipeline,
  log,
  leaseMs: integerEnvironment("WSGS_WORKER_LEASE_MS", 30_000, 100),
  heartbeatMs: integerEnvironment("WSGS_WORKER_HEARTBEAT_MS", 5_000, 10),
  pollIntervalMs: integerEnvironment("WSGS_WORKER_POLL_INTERVAL_MS", 250, 1),
  concurrency: integerEnvironment("WSGS_WORKER_CONCURRENCY", 1, 1),
  maxJobAttempts: integerEnvironment("WSGS_WORKER_MAX_JOB_ATTEMPTS", 3, 1),
  retryBackoffMs: integerEnvironment("WSGS_WORKER_RETRY_BACKOFF_MS", 500, 0)
});
const cancellationListener = new PostgresCancellationListener(pool, log);
await cancellationListener.start(worker);
const cleanupBatchSize = integerEnvironment("WSGS_SOURCE_CLEANUP_BATCH_SIZE", 100, 1);
const cleanup = new SourceCleanupLoop(
  () => cleanupExpiredSources(pool, cleanupBatchSize),
  integerEnvironment("WSGS_SOURCE_CLEANUP_INTERVAL_MS", 60_000, 1),
  log
);
cleanup.start();

let closing: Promise<void> | undefined;
function shutdown(): Promise<void> {
  closing ??= (async () => {
    log({ event: "shutdown", stage: "SHUTDOWN" });
    const outcomes = await Promise.allSettled([
      worker.stop(integerEnvironment("WSGS_WORKER_SHUTDOWN_GRACE_MS", 10_000, 0)), cleanup.stop()
    ]);
    try { await cancellationListener.close(); }
    finally { await pool.end(); }
    const failed = outcomes.find(outcome => outcome.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  })();
  return closing;
}

function reportFatal(error: unknown): void {
  log({ event: "worker_fatal", stage: "WORKER_RUNTIME", code: safeRuntimeErrorCode(error) });
  process.exitCode = 1;
}
process.once("SIGTERM", () => { void shutdown().catch(reportFatal); });
process.once("SIGINT", () => { void shutdown().catch(reportFatal); });

try {
  await worker.start();
} catch (error) {
  reportFatal(error);
} finally {
  await shutdown().catch(reportFatal);
}
