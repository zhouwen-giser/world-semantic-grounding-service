import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { Pool } from "pg";

export async function applyMigrations(pool: Pool, migrationDirectory: string): Promise<string[]> {
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("BEGIN");
    await client.query("CREATE SCHEMA IF NOT EXISTS wsgs");
    await client.query(`
      CREATE TABLE IF NOT EXISTS wsgs.schema_migration (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
      )
    `);
    for (const file of files) {
      const existing = await client.query<{ version: string }>(
        "SELECT version FROM wsgs.schema_migration WHERE version = $1",
        [file]
      );
      if ((existing.rowCount ?? 0) > 0) continue;
      await client.query(await readFile(join(migrationDirectory, file), "utf8"));
      await client.query("INSERT INTO wsgs.schema_migration(version) VALUES ($1)", [file]);
      applied.push(file);
    }
    await client.query("COMMIT");
    return applied;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function runAssertions(pool: Pool, assertionDirectory: string): Promise<string[]> {
  const files = (await readdir(assertionDirectory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) await pool.query(await readFile(join(assertionDirectory, file), "utf8"));
  return files;
}

