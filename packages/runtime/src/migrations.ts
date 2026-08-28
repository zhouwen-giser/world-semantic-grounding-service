import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { Pool } from "pg";

export class MigrationChecksumMismatchError extends Error {
  constructor(
    readonly version: string,
    readonly expectedChecksum: string,
    readonly actualChecksum: string
  ) {
    super(`Migration ${version} checksum mismatch: recorded ${expectedChecksum}, found ${actualChecksum}`);
    this.name = "MigrationChecksumMismatchError";
  }
}

export function migrationChecksum(bytes: string): string {
  return `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
}

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
        checksum_sha256 TEXT,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
      )
    `);
    await client.query("ALTER TABLE wsgs.schema_migration ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT");
    for (const file of files) {
      const sql = await readFile(join(migrationDirectory, file), "utf8");
      const checksum = migrationChecksum(sql);
      const existing = await client.query<{ version: string; checksum_sha256: string | null }>(
        "SELECT version, checksum_sha256 FROM wsgs.schema_migration WHERE version = $1",
        [file]
      );
      const recorded = existing.rows[0];
      if (recorded) {
        if (recorded.checksum_sha256 === null) {
          await client.query(
            "UPDATE wsgs.schema_migration SET checksum_sha256 = $2 WHERE version = $1 AND checksum_sha256 IS NULL",
            [file, checksum]
          );
        } else if (recorded.checksum_sha256 !== checksum) {
          throw new MigrationChecksumMismatchError(file, recorded.checksum_sha256, checksum);
        }
        continue;
      }
      await client.query(sql);
      await client.query(
        "INSERT INTO wsgs.schema_migration(version, checksum_sha256) VALUES ($1, $2)",
        [file, checksum]
      );
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

