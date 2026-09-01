import { createHash } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type {
  DurableGroundingSubmission,
  DurableSubmissionOutcome,
  GroundingPresentation,
  ProductionGroundingStore,
  ScopedGroundingIdentity
} from "./backend.js";
import {
  LEGACY_GROUNDING_CONTRACT_SELECTION,
  parseGroundingContractSelection,
  type GroundingContractSelection
} from "./contract-selection.js";

const TERMINAL_STATUSES = new Set([
  "COMPLETED",
  "PARTIAL",
  "AMBIGUOUS",
  "UNRESOLVED",
  "FAILED",
  "CANCELLED"
]);

interface GroundingJobRow {
  job_id: string;
  grounding_id: string;
  request_id: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  error: unknown | null;
  result_bytes: Buffer | null;
  request_metadata: unknown;
}

export class PostgresGroundingStoreError extends Error {
  readonly code = "GROUNDING_STORE_ERROR";
}

export class PostgresIdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";
  readonly statusCode = 409;

  constructor() {
    super("The idempotency key was already used with a different payload");
  }
}

export class PostgresGroundingContractMismatchError extends Error {
  readonly code = "WSGS_CONSUMER_CONTRACT_MISMATCH";
  readonly statusCode = 406;

  constructor() {
    super("The requested presentation does not match the persisted grounding contract");
  }
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

function parseJsonObject(bytes: Buffer, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch (error) {
    throw new PostgresGroundingStoreError(
      `${label} is not a stored JSON object: ${error instanceof Error ? error.name : "UNKNOWN"}`
    );
  }
}

function presentation(row: GroundingJobRow): Record<string, unknown> {
  const value: Record<string, unknown> = {
    schemaVersion: "1.0",
    jobId: row.job_id,
    groundingId: row.grounding_id,
    requestId: row.request_id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
  if (row.started_at) value["startedAt"] = row.started_at.toISOString();
  if (row.finished_at) value["finishedAt"] = row.finished_at.toISOString();
  if (row.result_bytes) value["result"] = parseJsonObject(row.result_bytes, "Grounding result");
  if (row.error) value["error"] = row.error;
  return value;
}

function resultPresentation(row: GroundingJobRow): GroundingPresentation {
  if (row.result_bytes) return { kind: "RESULT", value: parseJsonObject(row.result_bytes, "Grounding result") };
  return { kind: "JOB", value: presentation(row) };
}

function selectionFromMetadata(metadata: unknown): GroundingContractSelection {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new PostgresGroundingContractMismatchError();
  }
  const stored = (metadata as Record<string, unknown>)["contractSelection"];
  // Rows created before v0.2.1 have no selection and are byte-locked legacy resources.
  if (stored === undefined) return LEGACY_GROUNDING_CONTRACT_SELECTION;
  try {
    return parseGroundingContractSelection(stored);
  } catch {
    throw new PostgresGroundingContractMismatchError();
  }
}

function assertPersistedSelection(row: GroundingJobRow, expected: GroundingContractSelection): void {
  assertMetadataSelection(row.request_metadata, expected);
}

function assertMetadataSelection(metadata: unknown, expected: GroundingContractSelection): void {
  const actual = selectionFromMetadata(metadata);
  if (actual.contractVersion !== expected.contractVersion
    || actual.resultProfile !== expected.resultProfile
    || actual.transportMode !== expected.transportMode) {
    throw new PostgresGroundingContractMismatchError();
  }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }, ms);
    const aborted = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

function advisoryLockKey(submission: DurableGroundingSubmission): string {
  return createHash("sha256")
    .update(submission.identity.dataScope)
    .update(Buffer.from([0]))
    .update(submission.identity.actorId)
    .update(Buffer.from([0]))
    .update(submission.idempotencyKey)
    .digest()
    .readBigInt64BE(0)
    .toString();
}

async function readJob(
  client: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  identity: ScopedGroundingIdentity,
  groundingId: string
): Promise<GroundingJobRow | null> {
  const found = await client.query<GroundingJobRow>(
    `SELECT job.job_id, job.grounding_id, request.request_id, job.status,
            job.created_at, job.updated_at, job.started_at,
            job.finished_at, job.error, result.result_bytes, request.request_metadata
       FROM wsgs.grounding_job AS job
       JOIN wsgs.grounding_request AS request ON request.grounding_id = job.grounding_id
       LEFT JOIN wsgs.grounding_result AS result ON result.grounding_id = job.grounding_id
      WHERE job.data_scope = $1 AND job.actor_id = $2 AND job.grounding_id = $3
        AND request.principal_id = $4 AND request.authorization_context_hash = $5`,
    [
      identity.dataScope,
      identity.actorId,
      groundingId,
      identity.servicePrincipalId,
      identity.authorizationContextHash
    ]
  );
  return found.rows[0] ?? null;
}

export interface PostgresProductionGroundingStoreConfig {
  pollIntervalMs?: number;
}

/**
 * PostgreSQL is the authority for submissions, idempotency, job state, results,
 * and cancellation.  No process-local cache participates in correctness.
 */
export class PostgresProductionGroundingStore implements ProductionGroundingStore {
  readonly #pollIntervalMs: number;

  constructor(
    private readonly pool: Pool,
    config: PostgresProductionGroundingStoreConfig = {}
  ) {
    this.#pollIntervalMs = config.pollIntervalMs ?? 50;
    if (!Number.isInteger(this.#pollIntervalMs) || this.#pollIntervalMs < 1 || this.#pollIntervalMs > 5_000) {
      throw new PostgresGroundingStoreError("pollIntervalMs must be an integer from 1 through 5000");
    }
  }

  async submit(submission: DurableGroundingSubmission): Promise<DurableSubmissionOutcome> {
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [advisoryLockKey(submission)]);
      const existing = await client.query<{
        payload_hash: string;
        grounding_id: string;
        result_bytes: Buffer | null;
      }>(
        `SELECT payload_hash, grounding_id, result_bytes
           FROM wsgs.idempotency
          WHERE data_scope = $1 AND actor_id = $2 AND idempotency_key = $3
          FOR UPDATE`,
        [submission.identity.dataScope, submission.identity.actorId, submission.idempotencyKey]
      );
      const replay = existing.rows[0];
      if (replay) {
        if (replay.payload_hash !== submission.payloadHash) throw new PostgresIdempotencyConflictError();
        const job = await readJob(client, submission.identity, replay.grounding_id);
        // The historical idempotency key does not include principal_id. Never
        // replay across principals that happen to share actor and data scope.
        if (!job) throw new PostgresIdempotencyConflictError();
        assertPersistedSelection(job, submission.contractSelection);
        if (replay.result_bytes) {
          return {
            kind: "REPLAY_RESULT",
            groundingId: replay.grounding_id,
            result: parseJsonObject(replay.result_bytes, "Idempotent grounding result")
          };
        }
        return {
          kind: "REPLAY_JOB",
          groundingId: replay.grounding_id,
          jobId: job.job_id,
          job: presentation(job)
        };
      }

      await client.query(
        `INSERT INTO wsgs.grounding_request(
           grounding_id, request_id, data_scope, actor_id, dataset_scopes,
           authorization_context_hash, principal_id, payload_hash, source_text_sha256,
           source_text_ciphertext, source_expires_at, request_metadata,
           gowm_contract_catalog_revision, gowm_semantic_catalog_hash,
           gowm_consumer_package_integrity, gowm_operation_lock_hash
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)`,
        [
          submission.groundingId,
          submission.requestId,
          submission.identity.dataScope,
          submission.identity.actorId,
          JSON.stringify([...submission.identity.datasetScopes]),
          submission.identity.authorizationContextHash,
          submission.identity.servicePrincipalId,
          submission.payloadHash,
          submission.sourceTextSha256,
          Buffer.from(submission.sealedRequest),
          submission.sourceExpiresAt,
          JSON.stringify({ ...submission.requestMetadata, maxResultBytes: submission.maxResultBytes }),
          submission.gowmContractCatalogRevision,
          submission.gowmSemanticCatalogHash,
          submission.gowmConsumerPackageIntegrity,
          submission.gowmOperationLockHash
        ]
      );
      await client.query(
        `INSERT INTO wsgs.grounding_job(
           job_id, grounding_id, data_scope, actor_id, status, deadline_at,
           max_result_bytes, immutable_locks
         ) VALUES ($1,$2,$3,$4,'ACCEPTED',$5,$6,$7::jsonb)`,
        [
          submission.jobId,
          submission.groundingId,
          submission.identity.dataScope,
          submission.identity.actorId,
          submission.deadlineAt,
          submission.maxResultBytes,
          JSON.stringify(submission.immutableLocks)
        ]
      );
      await client.query(
        `INSERT INTO wsgs.idempotency(
           data_scope, actor_id, idempotency_key, payload_hash, grounding_id
         ) VALUES ($1,$2,$3,$4,$5)`,
        [
          submission.identity.dataScope,
          submission.identity.actorId,
          submission.idempotencyKey,
          submission.payloadHash,
          submission.groundingId
        ]
      );
      const job = await readJob(client, submission.identity, submission.groundingId);
      if (!job) throw new PostgresGroundingStoreError("Newly inserted grounding job could not be read");
      return {
        kind: "CREATED",
        groundingId: submission.groundingId,
        jobId: submission.jobId,
        job: presentation(job)
      };
    });
  }

  async waitForTerminal(
    identity: ScopedGroundingIdentity,
    groundingId: string,
    deadlineAt: Date,
    contractSelection: GroundingContractSelection,
    signal?: AbortSignal
  ): Promise<GroundingPresentation> {
    while (true) {
      const job = await readJob(this.pool, identity, groundingId);
      if (!job) throw new PostgresGroundingStoreError("Grounding job disappeared while awaiting completion");
      assertPersistedSelection(job, contractSelection);
      if (TERMINAL_STATUSES.has(job.status)) return resultPresentation(job);
      const remaining = deadlineAt.getTime() - Date.now();
      if (remaining <= 0) return { kind: "JOB", value: presentation(job) };
      await abortableDelay(Math.min(this.#pollIntervalMs, remaining), signal);
    }
  }

  async get(
    identity: ScopedGroundingIdentity,
    groundingId: string,
    contractSelection: GroundingContractSelection
  ): Promise<unknown | null> {
    const job = await readJob(this.pool, identity, groundingId);
    if (!job) return null;
    assertPersistedSelection(job, contractSelection);
    return presentation(job);
  }

  async cancel(
    identity: ScopedGroundingIdentity,
    groundingId: string,
    contractSelection: GroundingContractSelection
  ): Promise<{ jobId: string; value: unknown } | null> {
    return transaction(this.pool, async (client) => {
      const current = await client.query<{ job_id: string; status: string; request_metadata: unknown }>(
        `SELECT job.job_id, job.status, request.request_metadata FROM wsgs.grounding_job AS job
          JOIN wsgs.grounding_request AS request ON request.grounding_id = job.grounding_id
          WHERE job.data_scope = $1 AND job.actor_id = $2 AND job.grounding_id = $3
            AND request.principal_id = $4 AND request.authorization_context_hash = $5
          FOR UPDATE`,
        [
          identity.dataScope,
          identity.actorId,
          groundingId,
          identity.servicePrincipalId,
          identity.authorizationContextHash
        ]
      );
      const row = current.rows[0];
      if (!row) return null;
      assertMetadataSelection(row.request_metadata, contractSelection);
      if (!TERMINAL_STATUSES.has(row.status)) {
        await client.query(
          `UPDATE wsgs.grounding_job
              SET status = 'CANCELLED', cancel_requested_at = clock_timestamp(),
                  finished_at = clock_timestamp(), lease_token = NULL,
                  lease_owner = NULL, lease_expires_at = NULL
            WHERE job_id = $1`,
          [row.job_id]
        );
        await client.query("SELECT pg_notify('wsgs_grounding_cancel', $1)", [row.job_id]);
      }
      const job = await readJob(client, identity, groundingId);
      if (!job) throw new PostgresGroundingStoreError("Cancelled grounding job could not be read");
      return { jobId: row.job_id, value: presentation(job) };
    });
  }

  async readiness(): Promise<{ ready: boolean; reasons: string[] }> {
    try {
      const result = await this.pool.query<{
        request_table: string | null;
        job_table: string | null;
        checkpoint_table: string | null;
        selection_table: string | null;
        currentness_table: string | null;
        read_only: string;
      }>(
        `SELECT to_regclass('wsgs.grounding_request')::text AS request_table,
                to_regclass('wsgs.grounding_job')::text AS job_table,
                to_regclass('wsgs.pipeline_checkpoint')::text AS checkpoint_table,
                to_regclass('wsgs.world_selection')::text AS selection_table,
                to_regclass('wsgs.source_currentness_validation')::text AS currentness_table,
                current_setting('transaction_read_only') AS read_only`
      );
      const row = result.rows[0];
      const reasons: string[] = [];
      if (!row?.request_table || !row.job_table || !row.checkpoint_table ||
          !row.selection_table || !row.currentness_table) reasons.push("DATABASE_SCHEMA_NOT_READY");
      if (row?.read_only === "on") reasons.push("DATABASE_READ_ONLY");
      return { ready: reasons.length === 0, reasons };
    } catch {
      return { ready: false, reasons: ["DATABASE_UNAVAILABLE"] };
    }
  }
}
