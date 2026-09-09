import type { Pool } from "pg";
import { safeRuntimeErrorCode, type WorkerRuntimeLogger } from "./runtime-errors.js";

/** The job lock is shared with claim, settlement and checkpoint writes. */
export async function cleanupExpiredSources(pool: Pool, batchSize = 100): Promise<number> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error("Invalid source cleanup batch size");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<{ grounding_id: string }>(
      `SELECT job.grounding_id
         FROM wsgs.grounding_job AS job
         JOIN wsgs.grounding_request AS request ON request.grounding_id = job.grounding_id
        WHERE job.status IN ('COMPLETED','PARTIAL','AMBIGUOUS','UNRESOLVED','FAILED','CANCELLED')
          AND request.source_expires_at <= clock_timestamp()
          AND (request.source_text_ciphertext IS NOT NULL OR EXISTS (
            SELECT 1 FROM wsgs.pipeline_checkpoint AS checkpoint WHERE checkpoint.job_id = job.job_id
          ))
        ORDER BY request.source_expires_at, job.job_id
        LIMIT $1 FOR UPDATE OF job, request SKIP LOCKED`, [batchSize]
    );
    const ids = selected.rows.map(row => row.grounding_id);
    if (ids.length) {
      await client.query("UPDATE wsgs.grounding_request SET source_text_ciphertext = NULL WHERE grounding_id = ANY($1::text[])", [ids]);
      await client.query("DELETE FROM wsgs.pipeline_checkpoint WHERE grounding_id = ANY($1::text[])", [ids]);
    }
    await client.query("COMMIT");
    return ids.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export class SourceCleanupLoop {
  readonly #controller = new AbortController();
  #running: Promise<void> | undefined;

  constructor(
    private readonly cleanup: () => Promise<number>,
    private readonly intervalMs = 60_000,
    private readonly log: WorkerRuntimeLogger = () => undefined
  ) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 2_147_483_647) {
      throw new Error("Invalid source cleanup interval");
    }
  }

  start(): void {
    this.#running ??= this.#loop();
  }

  async stop(): Promise<void> {
    this.#controller.abort();
    await this.#running;
  }

  async #loop(): Promise<void> {
    while (!this.#controller.signal.aborted) {
      try {
        const count = await this.cleanup();
        if (count) this.log({ event: "source_cleanup", stage: "SOURCE_CLEANUP", count });
      } catch (error) {
        this.log({ event: "source_cleanup_failed", stage: "SOURCE_CLEANUP", code: safeRuntimeErrorCode(error) });
      }
      if (this.#controller.signal.aborted) return;
      await new Promise<void>(resolve => {
        const done = (): void => {
          clearTimeout(timer);
          this.#controller.signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, this.intervalMs);
        this.#controller.signal.addEventListener("abort", done, { once: true });
      });
    }
  }
}
