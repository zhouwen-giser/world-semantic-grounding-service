import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  IdempotencyConflictError,
  PostgresJobStore,
  type CreateGroundingInput
} from "./job-store.js";
import {
  applyMigrations,
  MigrationChecksumMismatchError,
  runAssertions
} from "./migrations.js";

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
      actorId: "actor-a",
      datasetScopes: ["dataset:roads", "dataset:vehicles"],
      authorizationContextHash: `sha256:${"4".repeat(64)}`,
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

  it("records migration checksums and rejects same-version content drift", async () => {
    const recorded = await pool.query<{ version: string; checksum_sha256: string | null }>(
      "SELECT version, checksum_sha256 FROM wsgs.schema_migration ORDER BY version"
    );
    const versions = (await readdir(resolve(root, "database", "migrations")))
      .filter((name) => /^\d+.*\.sql$/u.test(name)).sort();
    expect(recorded.rows.map((row) => row.version)).toEqual(versions);
    expect(recorded.rows.every((row) => /^sha256:[0-9a-f]{64}$/u.test(row.checksum_sha256 ?? ""))).toBe(true);
    expect(await applyMigrations(pool, resolve(root, "database", "migrations"))).toEqual([]);

    const directory = await mkdtemp(resolve(tmpdir(), "wsgs-migration-checksum-"));
    const version = "900_checksum_probe.sql";
    const path = resolve(directory, version);
    try {
      await writeFile(path, "CREATE TABLE wsgs.migration_checksum_probe(value INTEGER);\n", "utf8");
      expect(await applyMigrations(pool, directory)).toEqual([version]);
      await writeFile(path, "CREATE TABLE wsgs.migration_checksum_probe(value TEXT);\n", "utf8");
      await expect(applyMigrations(pool, directory)).rejects.toBeInstanceOf(MigrationChecksumMismatchError);
    } finally {
      await pool.query("DROP TABLE IF EXISTS wsgs.migration_checksum_probe");
      await pool.query("DELETE FROM wsgs.schema_migration WHERE version = $1", [version]);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rolls back the whole migration batch on failure", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "wsgs-migration-rollback-"));
    try {
      await writeFile(
        resolve(directory, "910_rollback_probe.sql"),
        "CREATE TABLE wsgs.migration_rollback_probe(value INTEGER);\n",
        "utf8"
      );
      await writeFile(resolve(directory, "911_forced_failure.sql"), "SELECT missing_wsgs_function();\n", "utf8");
      await expect(applyMigrations(pool, directory)).rejects.toThrow(/missing_wsgs_function/u);
      const table = await pool.query<{ relation: string | null }>(
        "SELECT to_regclass('wsgs.migration_rollback_probe')::text AS relation"
      );
      expect(table.rows[0]?.relation).toBeNull();
      const recorded = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM wsgs.schema_migration WHERE version LIKE '91%_%.sql'"
      );
      expect(recorded.rows[0]?.count).toBe("0");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects raw source text in request metadata", async () => {
    const unsafe = input("unsafe-metadata");
    unsafe.requestMetadata = { originalText: "must not be duplicated" };
    await expect(store.createOrReplay(unsafe)).rejects.toThrow(/forbidden sensitive field originalText/u);
  });

  it("persists actor and dataset scopes separately and isolates actor access", async () => {
    const created = input("actor-scope");
    await store.createOrReplay(created);
    const persisted = await pool.query<{
      actor_id: string;
      dataset_scopes: string[];
      authorization_context_hash: string;
    }>(
      `SELECT actor_id, dataset_scopes, authorization_context_hash
         FROM wsgs.grounding_request WHERE grounding_id = $1`,
      [created.groundingId]
    );
    expect(persisted.rows[0]).toEqual({
      actor_id: "actor-a",
      dataset_scopes: ["dataset:roads", "dataset:vehicles"],
      authorization_context_hash: created.authorizationContextHash
    });
    expect(await store.getJob("scope-a", "actor-a", created.groundingId)).not.toBeNull();
    expect(await store.getJob("scope-a", "actor-b", created.groundingId)).toBeNull();
    expect(await store.cancel("scope-a", "actor-b", created.groundingId)).toBeNull();
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
    expect(await store.cancel("scope-a", "actor-a", "grounding-pending-cancel")).toBe("CANCELLED");
    expect(await store.claimNext("worker-a", 5_000)).toBeNull();
  });

  it("makes cancellation win over a late worker result", async () => {
    await store.createOrReplay(input("cancel"));
    const claim = await store.claimNext("worker-a", 5_000);
    expect(claim).not.toBeNull();
    expect(await store.cancel("scope-a", "actor-a", "grounding-cancel")).toBe("CANCELLED");
    const outcome = await store.complete(
      claim!.jobId,
      claim!.leaseToken,
      "COMPLETED",
      new TextEncoder().encode("late")
    );
    expect(outcome).toBe("LATE_RESULT_IGNORED");
    expect(await store.getResult("scope-a", "actor-a", "grounding-cancel")).toBeNull();
  });

  it("isolates result reads by data scope and expires raw source ciphertext", async () => {
    const expired = input("retention");
    expired.sourceExpiresAt = new Date(Date.now() - 1_000);
    await store.createOrReplay(expired);
    expect(await store.getJob("scope-a", "actor-a", expired.groundingId)).not.toBeNull();
    expect(await store.getJob("scope-a", "actor-b", expired.groundingId)).toBeNull();
    expect(await store.getJob("scope-b", "actor-a", expired.groundingId)).toBeNull();
    expect(await store.getResult("scope-b", "actor-a", expired.groundingId)).toBeNull();
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
    expect(await store.getResult("scope-a", "actor-a", retainedInput.groundingId)).toEqual(resultBytes);
    expect(await store.getResult("scope-a", "actor-b", retainedInput.groundingId)).toBeNull();
    expect(await store.getResult("scope-b", "actor-a", retainedInput.groundingId)).toBeNull();
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
