import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import {
  MigrationChecksumMismatchError,
  applyMigrations,
  runAssertions
} from "./migrations.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

const migrationDirectory = fileURLToPath(new URL("../../../database/migrations/", import.meta.url));
const assertionDirectory = fileURLToPath(new URL("../../../database/assertions/", import.meta.url));
const verifyAssertions = process.argv.includes("--assertions");
let pool: Pool | undefined;

try {
  pool = new Pool({
    connectionString: required("DATABASE_URL"),
    max: 1,
    application_name: "wsgs-database-migration",
    connectionTimeoutMillis: boundedInteger("WSGS_MIGRATION_CONNECT_TIMEOUT_MS", 10_000, 100, 120_000),
    statement_timeout: boundedInteger("WSGS_MIGRATION_STATEMENT_TIMEOUT_MS", 120_000, 1_000, 900_000)
  });
  const applied = await applyMigrations(pool, migrationDirectory);
  const assertions = verifyAssertions ? await runAssertions(pool, assertionDirectory) : [];
  process.stdout.write(`${JSON.stringify({
    marker: "WSGS_DATABASE_MIGRATION_PASS",
    applied,
    assertions,
    assertionVerification: verifyAssertions ? "PASS" : "NOT_REQUESTED"
  })}\n`);
} catch (error) {
  const evidence = error instanceof MigrationChecksumMismatchError
    ? {
        migration: error.version,
        recordedChecksum: error.expectedChecksum,
        currentChecksum: error.actualChecksum
      }
    : {};
  process.stderr.write(`${JSON.stringify({
    marker: "WSGS_DATABASE_MIGRATION_FAIL",
    errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    ...evidence
  })}\n`);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
