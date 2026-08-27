import type { Pool, PoolClient } from "pg";

import { canonicalSha256 } from "./canonical.js";
import type { Aes256GcmPayloadCodec } from "./crypto.js";
import {
  GROUNDING_OPERATIONS,
  PIPELINE_STAGES,
  type ExecutionFence,
  type GroundingOperation,
  type PipelineCheckpoint,
  type PipelineEventRecord,
  type PipelineJournal,
  type PipelineStage
} from "./types.js";

export class PipelinePersistenceError extends Error {
  readonly code = "PIPELINE_PERSISTENCE_ERROR";
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

function jsonObject(bytes: Uint8Array): Readonly<Record<string, unknown>> {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PipelinePersistenceError("Stored checkpoint state is not a JSON object");
  }
  return value as Record<string, unknown>;
}

function operation(value: string): GroundingOperation {
  if (!(GROUNDING_OPERATIONS as readonly string[]).includes(value)) {
    throw new PipelinePersistenceError(`Stored checkpoint has unknown operation ${value}`);
  }
  return value as GroundingOperation;
}

function stage(value: string | null): PipelineStage | undefined {
  if (value === null) return undefined;
  if (!(PIPELINE_STAGES as readonly string[]).includes(value)) {
    throw new PipelinePersistenceError(`Stored checkpoint has unknown stage ${value}`);
  }
  return value as PipelineStage;
}

interface CheckpointRow {
  job_id: string;
  operation: string;
  run_fingerprint: string;
  next_stage_index: number;
  next_event_sequence: number;
  state_ciphertext: Buffer;
  state_hash: string;
  previous_record_hash: string;
  last_completed_stage: string | null;
}

export class PostgresPipelineJournal implements PipelineJournal {
  constructor(
    private readonly pool: Pool,
    private readonly codec: Aes256GcmPayloadCodec
  ) {}

  async loadLatestCheckpoint(jobId: string, runFingerprint: string): Promise<PipelineCheckpoint | null> {
    const result = await this.pool.query<CheckpointRow>(
      `SELECT job_id, operation, run_fingerprint, next_stage_index, next_event_sequence,
              state_ciphertext, state_hash, previous_record_hash, last_completed_stage
         FROM wsgs.pipeline_checkpoint
        WHERE job_id = $1 AND run_fingerprint = $2`,
      [jobId, runFingerprint]
    );
    const row = result.rows[0];
    if (!row) return null;
    const state = jsonObject(await this.codec.openCheckpoint(
      new Uint8Array(row.state_ciphertext),
      { jobId: row.job_id, runFingerprint: row.run_fingerprint }
    ));
    if (canonicalSha256(state) !== row.state_hash) {
      throw new PipelinePersistenceError("Stored checkpoint state hash does not match decrypted state");
    }
    const lastCompletedStage = stage(row.last_completed_stage);
    return {
      schemaVersion: "1.0",
      jobId: row.job_id,
      operation: operation(row.operation),
      runFingerprint: row.run_fingerprint,
      nextStageIndex: row.next_stage_index,
      nextEventSequence: row.next_event_sequence,
      state,
      previousRecordHash: row.previous_record_hash,
      ...(lastCompletedStage ? { lastCompletedStage } : {})
    };
  }

  recordStarted(fence: ExecutionFence, record: PipelineEventRecord): Promise<boolean> {
    return this.#record(fence, record);
  }

  recordTerminal(
    fence: ExecutionFence,
    record: PipelineEventRecord,
    checkpoint?: PipelineCheckpoint
  ): Promise<boolean> {
    return this.#record(fence, record, checkpoint);
  }

  async #record(
    fence: ExecutionFence,
    record: PipelineEventRecord,
    checkpoint?: PipelineCheckpoint
  ): Promise<boolean> {
    this.#assertRecord(fence, record, checkpoint);
    const checkpointCiphertext = checkpoint ? await this.codec.sealCheckpoint(checkpoint) : undefined;
    const checkpointStateHash = checkpoint ? canonicalSha256(checkpoint.state) : undefined;
    return transaction(this.pool, async (client) => {
      const ownership = await client.query<{
        grounding_id: string;
        status: string;
        lease_token: string | null;
        stage_generation: number;
        cancel_requested_at: Date | null;
      }>(
        `SELECT grounding_id, status, lease_token, stage_generation, cancel_requested_at
           FROM wsgs.grounding_job WHERE job_id = $1 FOR UPDATE`,
        [fence.jobId]
      );
      const job = ownership.rows[0];
      if (!job || job.status !== "RUNNING" || job.cancel_requested_at !== null ||
        job.lease_token !== fence.leaseToken || job.stage_generation !== fence.generation ||
        job.grounding_id !== record.event.groundingId) {
        return false;
      }

      if (record.previousRecordHash) {
        const previous = await client.query(
          "SELECT 1 FROM wsgs.pipeline_event WHERE job_id = $1 AND record_hash = $2",
          [fence.jobId, record.previousRecordHash]
        );
        if (previous.rowCount !== 1) throw new PipelinePersistenceError("Pipeline event chain predecessor is missing");
      } else if (record.sequence !== 0) {
        throw new PipelinePersistenceError("Only sequence zero may omit the previous record hash");
      }

      const inserted = await client.query<{ record_hash: string }>(
        `INSERT INTO wsgs.pipeline_event(
           grounding_id, job_id, stage, attempt, generation, sequence,
           stage_execution_id, run_fingerprint, previous_record_hash, record_hash,
           status, input_hash, output_hash, elapsed_ms, error_code, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (job_id, generation, sequence) DO NOTHING
         RETURNING record_hash`,
        [
          record.event.groundingId,
          record.jobId,
          record.event.stage,
          record.event.attempt,
          record.event.generation,
          record.sequence,
          record.stageExecutionId,
          record.runFingerprint,
          record.previousRecordHash ?? null,
          record.recordHash,
          record.event.status,
          record.event.inputHash,
          record.event.outputHash ?? null,
          record.event.elapsedMs,
          record.event.errorCode ?? null,
          record.event.createdAt
        ]
      );
      if (inserted.rowCount === 0) {
        const existing = await client.query<{ record_hash: string }>(
          `SELECT record_hash FROM wsgs.pipeline_event
            WHERE job_id = $1 AND generation = $2 AND sequence = $3`,
          [record.jobId, record.event.generation, record.sequence]
        );
        if (existing.rows[0]?.record_hash !== record.recordHash) {
          throw new PipelinePersistenceError("Pipeline event sequence was reused with different content");
        }
      }

      if (record.event.status === "STARTED") {
        await client.query(
          `UPDATE wsgs.grounding_job
              SET pipeline_stage = $2, stage_started_at = $3, stage_completed_at = NULL
            WHERE job_id = $1`,
          [record.jobId, record.event.stage, record.event.createdAt]
        );
      } else {
        await client.query(
          `UPDATE wsgs.grounding_job
              SET pipeline_stage = $2, stage_completed_at = $3
            WHERE job_id = $1`,
          [record.jobId, record.event.stage, record.event.createdAt]
        );
      }

      if (checkpoint && checkpointCiphertext && checkpointStateHash) {
        await client.query(
          `INSERT INTO wsgs.pipeline_checkpoint(
             job_id, grounding_id, operation, run_fingerprint, next_stage_index,
             next_event_sequence, state_ciphertext, state_hash, previous_record_hash,
             last_completed_stage, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp())
           ON CONFLICT (job_id) DO UPDATE SET
             grounding_id = EXCLUDED.grounding_id,
             operation = EXCLUDED.operation,
             run_fingerprint = EXCLUDED.run_fingerprint,
             next_stage_index = EXCLUDED.next_stage_index,
             next_event_sequence = EXCLUDED.next_event_sequence,
             state_ciphertext = EXCLUDED.state_ciphertext,
             state_hash = EXCLUDED.state_hash,
             previous_record_hash = EXCLUDED.previous_record_hash,
             last_completed_stage = EXCLUDED.last_completed_stage,
             updated_at = clock_timestamp()`,
          [
            checkpoint.jobId,
            record.event.groundingId,
            checkpoint.operation,
            checkpoint.runFingerprint,
            checkpoint.nextStageIndex,
            checkpoint.nextEventSequence,
            Buffer.from(checkpointCiphertext),
            checkpointStateHash,
            checkpoint.previousRecordHash,
            checkpoint.lastCompletedStage ?? null
          ]
        );
      }
      return true;
    });
  }

  #assertRecord(
    fence: ExecutionFence,
    record: PipelineEventRecord,
    checkpoint?: PipelineCheckpoint
  ): void {
    if (record.jobId !== fence.jobId || record.event.generation !== fence.generation) {
      throw new PipelinePersistenceError("Pipeline record does not match its execution fence");
    }
    if (checkpoint && (
      checkpoint.jobId !== fence.jobId ||
      checkpoint.runFingerprint !== record.runFingerprint ||
      checkpoint.nextEventSequence !== record.sequence + 1 ||
      checkpoint.previousRecordHash !== record.recordHash
    )) {
      throw new PipelinePersistenceError("Pipeline checkpoint does not atomically follow its terminal record");
    }
  }
}
