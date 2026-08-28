import { createHash, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { isTerminalJobStatus, type JobStatus, type TerminalJobStatus } from "./job-state.js";

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";

  constructor() {
    super("The idempotency key was already used with a different payload");
  }
}

export interface CreateGroundingInput {
  groundingId: string;
  jobId: string;
  requestId: string;
  dataScope: string;
  actorId: string;
  datasetScopes: readonly string[];
  authorizationContextHash: string;
  principalId: string;
  idempotencyKey: string;
  payloadHash: string;
  sourceTextSha256: string;
  sourceTextCiphertext: Uint8Array;
  sourceExpiresAt: Date;
  deadlineAt: Date;
  requestMetadata: Record<string, unknown>;
}

export type CreateGroundingOutcome =
  | { kind: "CREATED"; groundingId: string; jobId: string }
  | { kind: "REPLAY"; groundingId: string; resultBytes: Uint8Array | null };

export interface ClaimedJob {
  jobId: string;
  groundingId: string;
  dataScope: string;
  actorId: string;
  leaseToken: string;
  attempts: number;
  deadlineAt: Date;
}

export interface StoredJob {
  jobId: string;
  groundingId: string;
  status: JobStatus;
  attempts: number;
  cancelRequestedAt: Date | null;
}

export type CompletionOutcome = "COMPLETED" | "LATE_RESULT_IGNORED";

function assertSha256(value: string, label: string): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} must be a tagged SHA-256 digest`);
}

function assertMetadataIsRedacted(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertMetadataIsRedacted);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (["originalText", "conversationHistory", "authorization", "token"].includes(key)) {
      throw new Error(`requestMetadata contains forbidden sensitive field ${key}`);
    }
    assertMetadataIsRedacted(entry);
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

export class PostgresJobStore {
  constructor(private readonly pool: Pool) {}

  async createOrReplay(input: CreateGroundingInput): Promise<CreateGroundingOutcome> {
    assertSha256(input.payloadHash, "payloadHash");
    assertSha256(input.sourceTextSha256, "sourceTextSha256");
    assertSha256(input.authorizationContextHash, "authorizationContextHash");
    if (!input.actorId.trim()) throw new Error("actorId must not be empty");
    if (input.datasetScopes.some((scope) => !scope.trim())) throw new Error("datasetScopes must not contain empty values");
    assertMetadataIsRedacted(input.requestMetadata);
    return transaction(this.pool, async (client) => {
      const lockDigest = createHash("sha256")
        .update(input.dataScope)
        .update(Buffer.from([0]))
        .update(input.actorId)
        .update(Buffer.from([0]))
        .update(input.idempotencyKey)
        .digest();
      const lockKey = lockDigest.readBigInt64BE(0).toString();
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [lockKey]);
      const existing = await client.query<{
        payload_hash: string;
        grounding_id: string;
        result_bytes: Buffer | null;
      }>(
        `SELECT payload_hash, grounding_id, result_bytes
           FROM wsgs.idempotency
          WHERE data_scope = $1 AND actor_id = $2 AND idempotency_key = $3
          FOR UPDATE`,
        [input.dataScope, input.actorId, input.idempotencyKey]
      );
      const row = existing.rows[0];
      if (row) {
        if (row.payload_hash !== input.payloadHash) throw new IdempotencyConflictError();
        return {
          kind: "REPLAY",
          groundingId: row.grounding_id,
          resultBytes: row.result_bytes ? new Uint8Array(row.result_bytes) : null
        };
      }

      await client.query(
        `INSERT INTO wsgs.grounding_request(
           grounding_id, request_id, data_scope, actor_id, dataset_scopes,
           authorization_context_hash, principal_id, payload_hash, source_text_sha256,
           source_text_ciphertext, source_expires_at, request_metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          input.groundingId,
          input.requestId,
          input.dataScope,
          input.actorId,
          JSON.stringify([...new Set(input.datasetScopes)].sort()),
          input.authorizationContextHash,
          input.principalId,
          input.payloadHash,
          input.sourceTextSha256,
          Buffer.from(input.sourceTextCiphertext),
          input.sourceExpiresAt,
          input.requestMetadata
        ]
      );
      await client.query(
        `INSERT INTO wsgs.grounding_job(job_id, grounding_id, data_scope, actor_id, status, deadline_at)
         VALUES ($1,$2,$3,$4,'ACCEPTED',$5)`,
        [input.jobId, input.groundingId, input.dataScope, input.actorId, input.deadlineAt]
      );
      await client.query(
        `INSERT INTO wsgs.idempotency(data_scope, actor_id, idempotency_key, payload_hash, grounding_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [input.dataScope, input.actorId, input.idempotencyKey, input.payloadHash, input.groundingId]
      );
      return { kind: "CREATED", groundingId: input.groundingId, jobId: input.jobId };
    });
  }

  async claimNext(workerId: string, leaseMs: number): Promise<ClaimedJob | null> {
    if (!Number.isInteger(leaseMs) || leaseMs < 100) throw new Error("leaseMs must be an integer of at least 100");
    return transaction(this.pool, async (client) => {
      const selected = await client.query<{
        job_id: string;
        grounding_id: string;
        data_scope: string;
        actor_id: string;
        attempts: number;
        deadline_at: Date;
      }>(
        `SELECT job_id, grounding_id, data_scope, actor_id, attempts, deadline_at
           FROM wsgs.grounding_job
          WHERE cancel_requested_at IS NULL
            AND deadline_at > clock_timestamp()
            AND available_at <= clock_timestamp()
            AND (status = 'ACCEPTED' OR (status = 'RUNNING' AND lease_expires_at < clock_timestamp()))
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1`
      );
      const row = selected.rows[0];
      if (!row) return null;
      const leaseToken = randomUUID();
      const updated = await client.query<{ attempts: number }>(
        `UPDATE wsgs.grounding_job
            SET status = 'RUNNING', lease_token = $2, lease_owner = $3,
                lease_expires_at = clock_timestamp() + ($4 * interval '1 millisecond'),
                heartbeat_at = clock_timestamp(), attempts = attempts + 1
          WHERE job_id = $1
          RETURNING attempts`,
        [row.job_id, leaseToken, workerId, leaseMs]
      );
      return {
        jobId: row.job_id,
        groundingId: row.grounding_id,
        dataScope: row.data_scope,
        actorId: row.actor_id,
        leaseToken,
        attempts: updated.rows[0]?.attempts ?? row.attempts + 1,
        deadlineAt: row.deadline_at
      };
    });
  }

  async heartbeat(jobId: string, leaseToken: string, leaseMs: number): Promise<boolean> {
    const updated = await this.pool.query(
      `UPDATE wsgs.grounding_job
          SET heartbeat_at = clock_timestamp(),
              lease_expires_at = clock_timestamp() + ($3 * interval '1 millisecond')
        WHERE job_id = $1 AND lease_token = $2 AND status = 'RUNNING'
          AND cancel_requested_at IS NULL`,
      [jobId, leaseToken, leaseMs]
    );
    return (updated.rowCount ?? 0) === 1;
  }

  async cancel(dataScope: string, actorId: string, groundingId: string): Promise<JobStatus | null> {
    return transaction(this.pool, async (client) => {
      const current = await client.query<{ job_id: string; status: JobStatus }>(
        `SELECT job_id, status FROM wsgs.grounding_job
          WHERE data_scope = $1 AND actor_id = $2 AND grounding_id = $3 FOR UPDATE`,
        [dataScope, actorId, groundingId]
      );
      const row = current.rows[0];
      if (!row) return null;
      if (isTerminalJobStatus(row.status)) return row.status;
      await client.query(
        `UPDATE wsgs.grounding_job
            SET cancel_requested_at = clock_timestamp(), status = 'CANCELLED',
                finished_at = clock_timestamp(), lease_token = NULL, lease_owner = NULL,
                lease_expires_at = NULL
          WHERE job_id = $1`,
        [row.job_id]
      );
      return "CANCELLED";
    });
  }

  async complete(
    jobId: string,
    leaseToken: string,
    status: TerminalJobStatus,
    resultBytes: Uint8Array
  ): Promise<CompletionOutcome> {
    if (status === "CANCELLED") throw new Error("Use cancel() to complete cancellation");
    const resultHash = `sha256:${createHash("sha256").update(resultBytes).digest("hex")}`;
    return transaction(this.pool, async (client) => {
      const locked = await client.query<{
        grounding_id: string;
        data_scope: string;
        actor_id: string;
        status: JobStatus;
        cancel_requested_at: Date | null;
        lease_token: string | null;
      }>("SELECT grounding_id, data_scope, actor_id, status, cancel_requested_at, lease_token FROM wsgs.grounding_job WHERE job_id = $1 FOR UPDATE", [jobId]);
      const row = locked.rows[0];
      if (!row) throw new Error("Grounding job not found");
      if (row.status === "CANCELLED" || row.cancel_requested_at || row.lease_token !== leaseToken || row.status !== "RUNNING") {
        return "LATE_RESULT_IGNORED";
      }
      await client.query(
        `INSERT INTO wsgs.grounding_result(grounding_id, data_scope, actor_id, status, result_hash, result_bytes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [row.grounding_id, row.data_scope, row.actor_id, status, resultHash, Buffer.from(resultBytes)]
      );
      await client.query(
        `UPDATE wsgs.idempotency SET result_bytes = $2, updated_at = clock_timestamp()
          WHERE grounding_id = $1`,
        [row.grounding_id, Buffer.from(resultBytes)]
      );
      await client.query(
        `UPDATE wsgs.grounding_job
            SET status = $2, finished_at = clock_timestamp(), lease_token = NULL,
                lease_owner = NULL, lease_expires_at = NULL
          WHERE job_id = $1`,
        [jobId, status]
      );
      return "COMPLETED";
    });
  }

  async getResult(dataScope: string, actorId: string, groundingId: string): Promise<Uint8Array | null> {
    const result = await this.pool.query<{ result_bytes: Buffer }>(
      "SELECT result_bytes FROM wsgs.grounding_result WHERE data_scope = $1 AND actor_id = $2 AND grounding_id = $3",
      [dataScope, actorId, groundingId]
    );
    const bytes = result.rows[0]?.result_bytes;
    return bytes ? new Uint8Array(bytes) : null;
  }

  async getJob(dataScope: string, actorId: string, groundingId: string): Promise<StoredJob | null> {
    const result = await this.pool.query<{
      job_id: string;
      grounding_id: string;
      status: JobStatus;
      attempts: number;
      cancel_requested_at: Date | null;
    }>(
      `SELECT job_id, grounding_id, status, attempts, cancel_requested_at
         FROM wsgs.grounding_job WHERE data_scope = $1 AND actor_id = $2 AND grounding_id = $3`,
      [dataScope, actorId, groundingId]
    );
    const row = result.rows[0];
    return row
      ? {
          jobId: row.job_id,
          groundingId: row.grounding_id,
          status: row.status,
          attempts: row.attempts,
          cancelRequestedAt: row.cancel_requested_at
        }
      : null;
  }

  async expireSourceText(now = new Date()): Promise<number> {
    const result = await this.pool.query(
      `UPDATE wsgs.grounding_request SET source_text_ciphertext = NULL
        WHERE source_text_ciphertext IS NOT NULL AND source_expires_at <= $1`,
      [now]
    );
    return result.rowCount ?? 0;
  }
}
