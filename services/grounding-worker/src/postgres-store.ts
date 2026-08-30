import { randomUUID } from "node:crypto";

import {
  Aes256GcmPayloadCodec,
  GROUNDING_OPERATIONS,
  LEGACY_GROUNDING_CONTRACT_SELECTION,
  canonicalSha256,
  parseGroundingContractSelection,
  type GroundingContractSelection,
  type PipelineStage
} from "@wsgs/grounding-pipeline";
import { createGroundingIdentity } from "@wsgs/delegated-identity";
import type { Notification, Pool, PoolClient } from "pg";

import type { GroundingWorker } from "./worker.js";
import type {
  GroundingWorkerStore,
  WorkerClaim,
  WorkerExecutionFence,
  WorkerGroundingOperation,
  WorkerHeartbeat,
  WorkerSettlement,
  WorkerSettlementOutcome
} from "./types.js";
import { assertNegotiatedGroundingResult } from "./result-schema.js";

interface ClaimRow {
  job_id: string;
  grounding_id: string;
  request_id: string;
  operation: string;
  attempts: number;
  stage_generation: number;
  deadline_at: Date;
  max_result_bytes: number;
  immutable_locks: unknown | null;
  source_text_ciphertext: Buffer | null;
  data_scope: string;
  actor_id: string;
  dataset_scopes: unknown;
  authorization_context_hash: string;
  principal_id: string;
  request_metadata: unknown;
  idempotency_key: string;
}

export class PostgresWorkerStoreError extends Error {
  readonly code = "WORKER_STORE_ERROR";
}

async function transaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await run(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function operation(value: string): WorkerGroundingOperation {
  if (!(GROUNDING_OPERATIONS as readonly string[]).includes(value)) {
    throw new PostgresWorkerStoreError(`Stored grounding operation is unsupported: ${value}`);
  }
  return value as WorkerGroundingOperation;
}

function jsonObject(bytes: Uint8Array): Readonly<Record<string, unknown>> {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Readonly<Record<string, unknown>>;
  } catch (error) {
    throw new PostgresWorkerStoreError(
      `Stored encrypted request is not a JSON object: ${error instanceof Error ? error.name : "UNKNOWN"}`
    );
  }
}

function errorStage(code: string): string {
  if (code.includes("CONTEXT")) return "CONTEXT_LOADING";
  if (code.includes("MODEL") || code.includes("SEMANTIC")) return "SEMANTIC_MODEL";
  if (code.includes("REFERENCE") || code.includes("PINNED_VALIDATION")) return "REFERENCE_GROUNDING";
  if (code.includes("QUERY") || code.includes("COMPILE")) return "QUERY_COMPILATION";
  if (code.includes("GOWM")) return "GOWM_EXECUTION";
  if (code.includes("NORMAL")) return "RESULT_NORMALIZATION";
  return "PERSISTENCE";
}

function publicErrorStage(stage: PipelineStage): string {
  if (stage === "LOAD_CONTEXT") return "CONTEXT_LOADING";
  if (["DETERMINISTIC_PARSE", "SEMANTIC_MODEL_PARSE", "SEMANTIC_FRAME_VALIDATE", "GROUNDING_GRAPH_BUILD"].includes(stage)) {
    return "SEMANTIC_MODEL";
  }
  if (["REFERENCE_RESOLVE", "REFERENCE_VALIDATE"].includes(stage)) return "REFERENCE_GROUNDING";
  if (["REQUIREMENT_PLAN", "CAPABILITY_MATCH", "WORLD_QUERY_COMPILE"].includes(stage)) return "QUERY_COMPILATION";
  if (stage === "GOWM_EXECUTE") return "GOWM_EXECUTION";
  if (["EVIDENCE_NORMALIZE", "PRODUCT_ASSEMBLE"].includes(stage)) return "RESULT_NORMALIZATION";
  return "PERSISTENCE";
}

function jobError(code: string, retryable: boolean, pipelineStage?: PipelineStage): Record<string, unknown> {
  return {
    code,
    message: "Grounding execution could not be completed",
    retryable,
    stage: pipelineStage ? publicErrorStage(pipelineStage) : errorStage(code)
  };
}

function assertResult(
  settlement: Extract<WorkerSettlement, { kind: "RESULT" }>,
  maximumBytes: number,
  contractSelection: GroundingContractSelection
): Readonly<Record<string, unknown>> {
  if (!/^sha256:[0-9a-f]{64}$/u.test(settlement.resultHash)) {
    throw new PostgresWorkerStoreError("Worker result hash is not a tagged SHA-256 digest");
  }
  if (settlement.resultBytes.byteLength > maximumBytes) {
    throw new PostgresWorkerStoreError("Worker result exceeds the persisted maximum result size");
  }
  const result = jsonObject(settlement.resultBytes);
  if (result["resultHash"] !== settlement.resultHash || result["status"] !== settlement.status) {
    throw new PostgresWorkerStoreError("Worker result bytes do not match their settlement metadata");
  }
  assertNegotiatedGroundingResult(result, contractSelection);
  return result;
}

function storedContractSelection(metadata: Record<string, unknown>): GroundingContractSelection {
  const selected = metadata["contractSelection"];
  if (selected === undefined) return LEGACY_GROUNDING_CONTRACT_SELECTION;
  try {
    return parseGroundingContractSelection(selected);
  } catch {
    throw new PostgresWorkerStoreError("Stored grounding contract selection is invalid");
  }
}

function storedAuthorityList(
  value: unknown,
  label: string,
  allowEmpty: boolean
): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0) ||
    new Set(value).size !== value.length) {
    throw new PostgresWorkerStoreError(`Stored trusted identity ${label} are invalid`);
  }
  return [...value] as string[];
}

function restoredIdentity(row: ClaimRow, metadata: Record<string, unknown>): Readonly<Record<string, unknown>> {
  // Pre-v0.2.1 rows did not persist the complete list. Their one selected
  // scope remains recoverable without weakening new multi-scope rows.
  const dataScopes = metadata["dataScopes"] === undefined
    ? [row.data_scope]
    : storedAuthorityList(metadata["dataScopes"], "data scopes", false);
  const datasetScopes = storedAuthorityList(row.dataset_scopes, "dataset scopes", true);
  const permissions = storedAuthorityList(metadata["permissions"], "permissions", false);
  if (!dataScopes.includes(row.data_scope)) {
    throw new PostgresWorkerStoreError("Stored selected data scope is not authorized by the trusted identity");
  }
  let restored;
  try {
    restored = createGroundingIdentity({
      servicePrincipalId: row.principal_id,
      actorId: row.actor_id,
      dataScopes,
      datasetScopes,
      permissions
    });
  } catch {
    throw new PostgresWorkerStoreError("Stored trusted identity authority is invalid");
  }
  if (restored.authorizationContextHash !== row.authorization_context_hash) {
    throw new PostgresWorkerStoreError("Stored trusted identity authorization context hash is inconsistent");
  }
  return {
    ...restored,
    dataScope: row.data_scope,
  };
}

async function persistResultProducts(
  client: PoolClient,
  groundingId: string,
  dataScope: string,
  result: Readonly<Record<string, unknown>>
): Promise<void> {
  const candidates = [
    ...(Array.isArray(result["referenceProducts"]) ? result["referenceProducts"] : []),
    ...(Array.isArray(result["evidenceItems"]) ? result["evidenceItems"] : [])
  ];
  for (const raw of candidates) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new PostgresWorkerStoreError("Grounding result contains an invalid product");
    }
    const product = raw as Record<string, unknown>;
    const publicId = typeof product["productId"] === "string"
      ? product["productId"]
      : typeof product["evidenceProductId"] === "string"
        ? product["evidenceProductId"]
        : undefined;
    const productKind = product["productKind"];
    if (!publicId || typeof productKind !== "string") {
      throw new PostgresWorkerStoreError("Grounding result product identity is missing");
    }
    const payloadRef = typeof product["payloadRef"] === "string" ? product["payloadRef"] : null;
    await client.query(
      `INSERT INTO wsgs.result_product(
         product_id, grounding_id, data_scope, product_kind,
         payload, payload_ref, payload_hash, valid_until
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
       ON CONFLICT (product_id) DO NOTHING`,
      [`${groundingId}:${publicId}`, groundingId, dataScope, productKind,
        payloadRef === null ? JSON.stringify(product) : null,
        payloadRef, canonicalSha256(product),
        typeof product["validUntil"] === "string" ? product["validUntil"] : null]
    );
  }
}

/** PostgreSQL-backed queue and generation fence used by production workers. */
export class PostgresGroundingWorkerStore implements GroundingWorkerStore {
  constructor(
    private readonly pool: Pool,
    private readonly codec: Aes256GcmPayloadCodec
  ) {}

  async claimNext(workerId: string, leaseMs: number): Promise<WorkerClaim | null> {
    if (!workerId.trim()) throw new PostgresWorkerStoreError("workerId is required");
    if (!Number.isInteger(leaseMs) || leaseMs < 100) {
      throw new PostgresWorkerStoreError("leaseMs must be an integer of at least 100");
    }
    const claimed = await transaction(this.pool, async (client) => {
      const selected = await client.query<ClaimRow>(
        `SELECT job.job_id, job.grounding_id, request.request_id,
                request.request_metadata->>'operation' AS operation,
                job.attempts, job.stage_generation, job.deadline_at,
                job.max_result_bytes, job.immutable_locks,
                request.source_text_ciphertext, request.data_scope, request.actor_id,
                request.dataset_scopes, request.authorization_context_hash,
                request.principal_id, request.request_metadata,
                item.idempotency_key
           FROM wsgs.grounding_job AS job
           JOIN wsgs.grounding_request AS request ON request.grounding_id = job.grounding_id
           JOIN wsgs.idempotency AS item ON item.grounding_id = job.grounding_id
          WHERE job.cancel_requested_at IS NULL
            AND job.deadline_at > clock_timestamp()
            AND job.available_at <= clock_timestamp()
            AND (job.status = 'ACCEPTED' OR (
              job.status = 'RUNNING' AND job.lease_expires_at < clock_timestamp()
            ))
          ORDER BY job.available_at, job.created_at
          FOR UPDATE OF job SKIP LOCKED
          LIMIT 1`
      );
      const row = selected.rows[0];
      if (!row) return null;
      if (!row.source_text_ciphertext) {
        await client.query(
          `UPDATE wsgs.grounding_job
              SET status = 'FAILED', finished_at = clock_timestamp(),
                  error = $2::jsonb, lease_token = NULL, lease_owner = NULL,
                  lease_expires_at = NULL
            WHERE job_id = $1`,
          [row.job_id, JSON.stringify(jobError("SOURCE_TEXT_EXPIRED", false))]
        );
        return null;
      }
      if (!row.immutable_locks) {
        await client.query(
          `UPDATE wsgs.grounding_job
              SET status = 'FAILED', finished_at = clock_timestamp(),
                  error = $2::jsonb, lease_token = NULL, lease_owner = NULL,
                  lease_expires_at = NULL
            WHERE job_id = $1`,
          [row.job_id, JSON.stringify(jobError("IMMUTABLE_LOCKS_MISSING", false))]
        );
        return null;
      }
      const leaseToken = randomUUID();
      const immutableLocks = row.immutable_locks;
      const updated = await client.query<{ attempts: number; stage_generation: number }>(
        `UPDATE wsgs.grounding_job
            SET status = 'RUNNING', lease_token = $2, lease_owner = $3,
                lease_expires_at = clock_timestamp() + ($4 * interval '1 millisecond'),
                heartbeat_at = clock_timestamp(), started_at = COALESCE(started_at, clock_timestamp()),
                attempts = attempts + 1,
                stage_generation = CASE WHEN attempts = 0 THEN stage_generation ELSE stage_generation + 1 END,
                immutable_locks = COALESCE(immutable_locks, $5::jsonb), error = NULL
          WHERE job_id = $1
          RETURNING attempts, stage_generation`,
        [row.job_id, leaseToken, workerId, leaseMs, JSON.stringify(immutableLocks)]
      );
      const fence = updated.rows[0];
      if (!fence) throw new PostgresWorkerStoreError("Claimed grounding job could not be fenced");
      return { row, leaseToken, immutableLocks, ...fence };
    });
    if (!claimed) return null;
    const plaintext = await this.codec.openRequest(
      new Uint8Array(claimed.row.source_text_ciphertext as Buffer),
      { groundingId: claimed.row.grounding_id, requestId: claimed.row.request_id }
    );
    const metadata = claimed.row.request_metadata && typeof claimed.row.request_metadata === "object" &&
      !Array.isArray(claimed.row.request_metadata)
      ? claimed.row.request_metadata as Record<string, unknown>
      : {};
    const identity = restoredIdentity(claimed.row, metadata);
    const contractSelection = storedContractSelection(metadata);
    return {
      jobId: claimed.row.job_id,
      groundingId: claimed.row.grounding_id,
      operation: operation(claimed.row.operation),
      leaseToken: claimed.leaseToken,
      generation: claimed.stage_generation,
      attempt: claimed.attempts,
      deadlineAt: claimed.row.deadline_at,
      maxResultBytes: claimed.row.max_result_bytes,
      initialState: {
        request: jsonObject(plaintext),
        idempotencyKey: claimed.row.idempotency_key,
        contractSelection,
        identity
      },
      immutableLocks: claimed.immutableLocks
    };
  }

  async heartbeat(fence: WorkerExecutionFence, leaseMs: number): Promise<WorkerHeartbeat> {
    if (!Number.isInteger(leaseMs) || leaseMs < 100) {
      throw new PostgresWorkerStoreError("leaseMs must be an integer of at least 100");
    }
    const updated = await this.pool.query<{ cancel_requested_at: Date | null }>(
      `UPDATE wsgs.grounding_job
          SET heartbeat_at = clock_timestamp(),
              lease_expires_at = clock_timestamp() + ($4 * interval '1 millisecond')
        WHERE job_id = $1 AND lease_token = $2 AND stage_generation = $3
          AND status = 'RUNNING'
        RETURNING cancel_requested_at`,
      [fence.jobId, fence.leaseToken, fence.generation, leaseMs]
    );
    const row = updated.rows[0];
    return row
      ? { owned: true, cancelRequested: row.cancel_requested_at !== null }
      : { owned: false, cancelRequested: false };
  }

  async settle(
    fence: WorkerExecutionFence,
    settlement: WorkerSettlement
  ): Promise<WorkerSettlementOutcome> {
    return transaction(this.pool, async (client) => {
      const locked = await client.query<{
        grounding_id: string;
        data_scope: string;
        actor_id: string;
        status: string;
        cancel_requested_at: Date | null;
        lease_token: string | null;
        stage_generation: number;
        max_result_bytes: number;
        request_metadata: unknown;
      }>(
        `SELECT job.grounding_id, job.data_scope, job.actor_id, job.status, job.cancel_requested_at,
                job.lease_token, job.stage_generation, job.max_result_bytes, request.request_metadata
           FROM wsgs.grounding_job AS job
           JOIN wsgs.grounding_request AS request ON request.grounding_id = job.grounding_id
          WHERE job.job_id = $1 FOR UPDATE OF job`,
        [fence.jobId]
      );
      const job = locked.rows[0];
      if (!job || job.status !== "RUNNING" || job.cancel_requested_at !== null ||
        job.lease_token !== fence.leaseToken || job.stage_generation !== fence.generation) {
        return "FENCE_REJECTED";
      }

      if (settlement.kind === "RESULT") {
        const metadata = job.request_metadata && typeof job.request_metadata === "object"
          && !Array.isArray(job.request_metadata)
          ? job.request_metadata as Record<string, unknown>
          : {};
        const result = assertResult(settlement, job.max_result_bytes, storedContractSelection(metadata));
        await client.query(
          `INSERT INTO wsgs.grounding_result(
             grounding_id, data_scope, actor_id, status, result_hash, result_bytes
           ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            job.grounding_id,
            job.data_scope,
            job.actor_id,
            settlement.status,
            settlement.resultHash,
            Buffer.from(settlement.resultBytes)
          ]
        );
        await persistResultProducts(client, job.grounding_id, job.data_scope, result);
        await client.query(
          `UPDATE wsgs.idempotency
              SET result_bytes = $2, updated_at = clock_timestamp()
            WHERE grounding_id = $1`,
          [job.grounding_id, Buffer.from(settlement.resultBytes)]
        );
        await client.query(
          `UPDATE wsgs.grounding_job
              SET status = $2, finished_at = clock_timestamp(),
                  lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL
            WHERE job_id = $1`,
          [fence.jobId, settlement.status]
        );
        return "APPLIED";
      }

      if (settlement.kind === "RETRY") {
        await client.query(
          `UPDATE wsgs.grounding_job
              SET status = 'ACCEPTED', available_at = $2,
                  lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
                  error = $3::jsonb
            WHERE job_id = $1`,
          [fence.jobId, settlement.availableAt, JSON.stringify(jobError(
            settlement.errorCode,
            true,
            settlement.pipelineStage
          ))]
        );
        return "APPLIED";
      }

      const status = settlement.kind === "CANCELLED" ? "CANCELLED" : "FAILED";
      await client.query(
        `UPDATE wsgs.grounding_job
            SET status = $2, finished_at = clock_timestamp(),
                cancel_requested_at = CASE WHEN $2 = 'CANCELLED' THEN clock_timestamp() ELSE cancel_requested_at END,
                lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
                error = $3::jsonb
          WHERE job_id = $1`,
        [fence.jobId, status, JSON.stringify(jobError(
          settlement.errorCode,
          false,
          settlement.kind === "FAILED" ? settlement.pipelineStage : undefined
        ))]
      );
      return "APPLIED";
    });
  }
}

/** Dedicated LISTEN connection used only to abort local in-flight work. */
export class PostgresCancellationListener {
  #client: PoolClient | undefined;
  #worker: GroundingWorker | undefined;
  readonly #notification = (message: Notification): void => {
    if (message.channel === "wsgs_grounding_cancel" && message.payload) this.#worker?.cancel(message.payload);
  };

  constructor(private readonly pool: Pool) {}

  async start(worker: GroundingWorker): Promise<void> {
    if (this.#client) throw new PostgresWorkerStoreError("Cancellation listener has already started");
    const client = await this.pool.connect();
    try {
      await client.query("LISTEN wsgs_grounding_cancel");
      client.on("notification", this.#notification);
      this.#client = client;
      this.#worker = worker;
    } catch (error) {
      client.release();
      throw error;
    }
  }

  async close(): Promise<void> {
    const client = this.#client;
    if (!client) return;
    this.#client = undefined;
    this.#worker = undefined;
    client.removeListener("notification", this.#notification);
    try {
      await client.query("UNLISTEN wsgs_grounding_cancel");
    } finally {
      client.release();
    }
  }
}
