import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyMigrations, runAssertions } from "./migrations.js";

const databaseUrl = process.env["TEST_UPGRADE_DATABASE_URL"];
const integration = databaseUrl ? describe : describe.skip;

integration("001 to 002 production database upgrade", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const root = resolve(import.meta.dirname, "..", "..", "..");
  let legacyMigrations: string;

  beforeAll(async () => {
    legacyMigrations = await mkdtemp(resolve(tmpdir(), "wsgs-legacy-migrations-"));
    await copyFile(
      resolve(root, "database", "migrations", "001_wsgs_core.sql"),
      resolve(legacyMigrations, "001_wsgs_core.sql")
    );
    expect(await applyMigrations(pool, legacyMigrations)).toEqual(["001_wsgs_core.sql"]);
    await pool.query(
      `INSERT INTO wsgs.grounding_request(
         grounding_id, request_id, data_scope, principal_id, payload_hash,
         source_text_sha256, source_text_ciphertext, source_expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp() + interval '1 hour')`,
      [
        "grounding-legacy",
        "request-legacy",
        "scope-legacy",
        "principal-legacy",
        `sha256:${"1".repeat(64)}`,
        `sha256:${"2".repeat(64)}`,
        Buffer.from([1, 2, 3])
      ]
    );
    await pool.query(
      `INSERT INTO wsgs.grounding_job(job_id, grounding_id, data_scope, status, deadline_at)
       VALUES ('job-legacy','grounding-legacy','scope-legacy','ACCEPTED',clock_timestamp() + interval '1 hour')`
    );
    await pool.query(
      `INSERT INTO wsgs.idempotency(data_scope, idempotency_key, payload_hash, grounding_id)
       VALUES ('scope-legacy','key-legacy',$1,'grounding-legacy')`,
      [`sha256:${"1".repeat(64)}`]
    );
  });

  afterAll(async () => {
    await pool.end();
    if (legacyMigrations) await rm(legacyMigrations, { recursive: true, force: true });
  });

  it("rolls a failed 002 back as one transaction without schema or ledger residue", async () => {
    const failingMigrations = await mkdtemp(resolve(tmpdir(), "wsgs-failing-002-migrations-"));
    try {
      const version = "002_wsgs_gowm_063_runtime.sql";
      const source = await readFile(resolve(root, "database", "migrations", version), "utf8");
      await copyFile(
        resolve(root, "database", "migrations", "001_wsgs_core.sql"),
        resolve(failingMigrations, "001_wsgs_core.sql")
      );
      await writeFile(
        resolve(failingMigrations, version),
        `${source}\nCREATE TABLE wsgs.migration_002_rollback_probe(value INTEGER);\nSELECT 1 / 0;\n`,
        "utf8"
      );

      await expect(applyMigrations(pool, failingMigrations)).rejects.toThrow();
      const residue = await pool.query<{
        checkpoint_table: string | null;
        event_table: string | null;
        probe_table: string | null;
        ledger_count: string;
      }>(
        `SELECT to_regclass('wsgs.pipeline_checkpoint')::text AS checkpoint_table,
                to_regclass('wsgs.pipeline_event')::text AS event_table,
                to_regclass('wsgs.migration_002_rollback_probe')::text AS probe_table,
                (SELECT count(*)::text FROM wsgs.schema_migration WHERE version = $1) AS ledger_count`,
        [version]
      );
      expect(residue.rows[0]).toEqual({
        checkpoint_table: null,
        event_table: null,
        probe_table: null,
        ledger_count: "0"
      });
    } finally {
      await rm(failingMigrations, { recursive: true, force: true });
    }
  });

  it("applies additive 002, backfills actor fences, and passes schema assertions", async () => {
    expect(await applyMigrations(pool, resolve(root, "database", "migrations"))).toEqual([
      "002_wsgs_gowm_063_runtime.sql"
    ]);
    expect(await runAssertions(pool, resolve(root, "database", "assertions"))).toEqual([
      "001_wsgs_core.sql",
      "002_wsgs_gowm_063_runtime.sql"
    ]);
    const upgraded = await pool.query<{
      request_actor: string;
      job_actor: string;
      idempotency_actor: string;
      checkpoint_table: string;
      event_table: string;
    }>(
      `SELECT request.actor_id AS request_actor, job.actor_id AS job_actor,
              item.actor_id AS idempotency_actor,
              to_regclass('wsgs.pipeline_checkpoint')::text AS checkpoint_table,
              to_regclass('wsgs.pipeline_event')::text AS event_table
         FROM wsgs.grounding_request AS request
         JOIN wsgs.grounding_job AS job USING (grounding_id)
         JOIN wsgs.idempotency AS item USING (grounding_id)
        WHERE request.grounding_id = 'grounding-legacy'`
    );
    expect(upgraded.rows[0]).toEqual({
      request_actor: "principal-legacy",
      job_actor: "principal-legacy",
      idempotency_actor: "principal-legacy",
      checkpoint_table: "pipeline_checkpoint",
      event_table: "pipeline_event"
    });
  });
});
