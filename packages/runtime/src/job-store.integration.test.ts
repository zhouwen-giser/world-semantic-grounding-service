import { resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  IdempotencyConflictError,
  PostgresJobStore,
  type CreateGroundingInput
} from "./job-store.js";
import { applyMigrations, runAssertions } from "./migrations.js";

const databaseUrl = process.env["TEST_DATABASE_URL"];
const integration = databaseUrl ? describe : describe.skip;

integration("PostgreSQL durable job store", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const store = new PostgresJobStore(pool);
  const root = resolve(import.meta.dirname, "..", "..", "..");

  beforeAll(async () => {
    await applyMigrations(pool, resolve(root, "database", "migrations"));
    await runAssertions(pool, resolve(root, "database", "assertions"));
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE TABLE
      wsgs.model_receipt, wsgs.capability_snapshot, wsgs.result_product,
      wsgs.grounding_result, wsgs.world_query, wsgs.grounding_graph,
      wsgs.semantic_frame, wsgs.idempotency, wsgs.grounding_job,
      wsgs.grounding_request CASCADE`);
  });

  afterAll(async () => pool.end());

  function input(suffix: string, payloadHash = `sha256:${"1".repeat(64)}`): CreateGroundingInput {
    return {
      groundingId: `grounding-${suffix}`,
      jobId: `job-${suffix}`,
      requestId: `request-${suffix}`,
      dataScope: "scope-a",
      principalId: "sacs-service",
      idempotencyKey: `key-${suffix}`,
      payloadHash,
      sourceTextSha256: `sha256:${"2".repeat(64)}`,
      sourceTextCiphertext: new Uint8Array([1, 2, 3]),
      sourceExpiresAt: new Date(Date.now() + 60_000),
      deadlineAt: new Date(Date.now() + 60_000),
      requestMetadata: { locale: "zh-CN" }
    };
  }

  it("replays the same key and rejects a different payload", async () => {
    const created = await store.createOrReplay(input("idem"));
    expect(created.kind).toBe("CREATED");
    const replay = await store.createOrReplay(input("idem"));
    expect(replay).toMatchObject({ kind: "REPLAY", groundingId: "grounding-idem" });
    await expect(store.createOrReplay(input("idem", `sha256:${"3".repeat(64)}`))).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("rejects raw source text in request metadata", async () => {
    const unsafe = input("unsafe-metadata");
    unsafe.requestMetadata = { originalText: "must not be duplicated" };
    await expect(store.createOrReplay(unsafe)).rejects.toThrow(/forbidden sensitive field originalText/u);
  });

  it("claims once, persists completion, and replays byte-identically", async () => {
    await store.createOrReplay(input("complete"));
    const [first, second] = await Promise.all([store.claimNext("worker-a", 5_000), store.claimNext("worker-b", 5_000)]);
    const claims = [first, second].filter((value) => value !== null);
    expect(claims).toHaveLength(1);
    const claim = claims[0];
    expect(claim).toBeDefined();
    const bytes = new TextEncoder().encode('{"status":"COMPLETED"}');
    expect(await store.complete(claim!.jobId, claim!.leaseToken, "COMPLETED", bytes)).toBe("COMPLETED");
    const replay = await store.createOrReplay(input("complete"));
    expect(replay.kind).toBe("REPLAY");
    if (replay.kind === "REPLAY") expect(replay.resultBytes).toEqual(bytes);
    const restartedStore = new PostgresJobStore(pool);
    const restartReplay = await restartedStore.createOrReplay(input("complete"));
    expect(restartReplay.kind).toBe("REPLAY");
  });

  it("heartbeats an owned lease and reclaims it after expiry", async () => {
    await store.createOrReplay(input("lease"));
    const first = await store.claimNext("worker-a", 5_000);
    expect(first).not.toBeNull();
    expect(await store.heartbeat(first!.jobId, first!.leaseToken, 5_000)).toBe(true);
    await pool.query(
      "UPDATE wsgs.grounding_job SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE job_id = $1",
      [first!.jobId]
    );
    const reclaimed = await store.claimNext("worker-b", 5_000);
    expect(reclaimed).toMatchObject({ jobId: first!.jobId, attempts: 2 });
    expect(reclaimed!.leaseToken).not.toBe(first!.leaseToken);
  });

  it("cancels a pending job before any downstream claim", async () => {
    await store.createOrReplay(input("pending-cancel"));
    expect(await store.cancel("scope-a", "grounding-pending-cancel")).toBe("CANCELLED");
    expect(await store.claimNext("worker-a", 5_000)).toBeNull();
  });

  it("makes cancellation win over a late worker result", async () => {
    await store.createOrReplay(input("cancel"));
    const claim = await store.claimNext("worker-a", 5_000);
    expect(claim).not.toBeNull();
    expect(await store.cancel("scope-a", "grounding-cancel")).toBe("CANCELLED");
    const outcome = await store.complete(
      claim!.jobId,
      claim!.leaseToken,
      "COMPLETED",
      new TextEncoder().encode("late")
    );
    expect(outcome).toBe("LATE_RESULT_IGNORED");
    expect(await store.getResult("scope-a", "grounding-cancel")).toBeNull();
  });

  it("isolates result reads by data scope and expires raw source ciphertext", async () => {
    const expired = input("retention");
    expired.sourceExpiresAt = new Date(Date.now() - 1_000);
    await store.createOrReplay(expired);
    expect(await store.getJob("scope-a", expired.groundingId)).not.toBeNull();
    expect(await store.getJob("scope-b", expired.groundingId)).toBeNull();
    expect(await store.getResult("scope-b", expired.groundingId)).toBeNull();
    expect(await store.expireSourceText()).toBe(1);
    const retained = await pool.query<{ source_text_ciphertext: Buffer | null }>(
      "SELECT source_text_ciphertext FROM wsgs.grounding_request WHERE grounding_id = $1",
      [expired.groundingId]
    );
    expect(retained.rows[0]?.source_text_ciphertext).toBeNull();
  });

  it("retains the audit result bytes and hash after raw source expiry", async () => {
    const retainedInput = input("retained-audit");
    retainedInput.sourceExpiresAt = new Date(Date.now() - 1_000);
    await store.createOrReplay(retainedInput);
    const claim = await store.claimNext("worker-retention", 5_000);
    const resultBytes = new TextEncoder().encode('{"status":"COMPLETED","audit":"retained"}');
    await store.complete(claim!.jobId, claim!.leaseToken, "COMPLETED", resultBytes);
    expect(await store.expireSourceText()).toBe(1);
    expect(await store.getResult("scope-a", retainedInput.groundingId)).toEqual(resultBytes);
    expect(await store.getResult("scope-b", retainedInput.groundingId)).toBeNull();
  });

  it("enforces terminal monotonicity in PostgreSQL", async () => {
    await store.createOrReplay(input("terminal"));
    const claim = await store.claimNext("worker-a", 5_000);
    await store.complete(claim!.jobId, claim!.leaseToken, "COMPLETED", new TextEncoder().encode("done"));
    await expect(
      pool.query("UPDATE wsgs.grounding_job SET status = 'RUNNING' WHERE job_id = $1", [claim!.jobId])
    ).rejects.toThrow(/terminal grounding job status cannot change/u);
  });
});
