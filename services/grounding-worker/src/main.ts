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

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function integerEnvironment(name: string, fallback: number, minimum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}`);
  }
  return value;
}

async function loadExecutor(pool: Pool): Promise<PipelineStageExecutor> {
  const moduleSpecifier = process.env["WSGS_PIPELINE_MODULE"] ?? new URL("./production-module.js", import.meta.url).href;
  const importSpecifier = isAbsolute(moduleSpecifier) || moduleSpecifier.startsWith(".")
    ? pathToFileURL(resolve(moduleSpecifier)).href
    : moduleSpecifier;
  const loaded = await import(importSpecifier) as Record<string, unknown>;
  const factory = loaded["createPipelineStageExecutor"];
  if (typeof factory !== "function") {
    throw new Error("WSGS_PIPELINE_MODULE must export createPipelineStageExecutor()");
  }
  const executor = await (factory as (options: { pool: Pool }) => unknown | Promise<unknown>)({ pool });
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
  application_name: "wsgs-grounding-worker"
});
await pool.query("SELECT 1 FROM wsgs.pipeline_checkpoint LIMIT 0");
const executor = await loadExecutor(pool);

const store = new PostgresGroundingWorkerStore(pool, codec);
const journal = new PostgresPipelineJournal(pool, codec);
const pipeline = new GroundingPipeline({
  executor,
  journal,
  policy: productionPipelinePolicyFromEnvironment()
});
const worker = new GroundingWorker({
  workerId: process.env["WSGS_WORKER_ID"] ?? `worker-${randomUUID()}`,
  store,
  pipeline,
  leaseMs: integerEnvironment("WSGS_WORKER_LEASE_MS", 30_000, 100),
  heartbeatMs: integerEnvironment("WSGS_WORKER_HEARTBEAT_MS", 5_000, 10),
  pollIntervalMs: integerEnvironment("WSGS_WORKER_POLL_INTERVAL_MS", 250, 1),
  concurrency: integerEnvironment("WSGS_WORKER_CONCURRENCY", 1, 1),
  maxJobAttempts: integerEnvironment("WSGS_WORKER_MAX_JOB_ATTEMPTS", 3, 1),
  retryBackoffMs: integerEnvironment("WSGS_WORKER_RETRY_BACKOFF_MS", 500, 0)
});
const cancellationListener = new PostgresCancellationListener(pool);
await cancellationListener.start(worker);

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  process.stdout.write(`${JSON.stringify({ level: "info", event: "shutdown", signal })}\n`);
  await worker.stop(integerEnvironment("WSGS_WORKER_SHUTDOWN_GRACE_MS", 10_000, 0));
  await cancellationListener.close();
  await pool.end();
}

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });

try {
  await worker.start();
} catch (error) {
  await cancellationListener.close();
  await pool.end();
  throw error;
}
