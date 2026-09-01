import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const reportRoot = join(repositoryRoot, "reports", "sacs-geospatial-v1");
const write = process.argv.includes("--write");

function sha256(value: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function canonicalHash(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

function document(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeOrCheck(path: string, content: string): void {
  if (write) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
    return;
  }
  if (!existsSync(path) || readFileSync(path, "utf8").replaceAll("\r\n", "\n") !== content) {
    throw new Error(`N07_GENERATED_ARTIFACT_DRIFT:${relative(repositoryRoot, path)}`);
  }
}

function requireSource(path: string, fragments: readonly string[]): string {
  const value = readFileSync(join(repositoryRoot, path), "utf8").replaceAll("\r\n", "\n");
  for (const fragment of fragments) {
    if (!value.includes(fragment)) throw new Error(`N07_SOURCE_REQUIREMENT_MISSING:${path}:${fragment}`);
  }
  return value;
}

const migrationPath = "database/migrations/005_wsgs_sacs_geospatial.sql";
const assertionPath = "database/assertions/005_wsgs_sacs_geospatial.sql";
requireSource(migrationPath, [
  "ADD COLUMN IF NOT EXISTS contract_version",
  "geospatial_finding_set_hash",
  "geospatial_source_product_set_hash",
  "geospatial_source_locks_hash",
  "CREATE TABLE IF NOT EXISTS wsgs.world_selection",
  "world_selection_upstream_identity_exactly_one",
  "CREATE TABLE IF NOT EXISTS wsgs.source_currentness_validation",
  "source_currentness_hash_presence"
]);
requireSource(assertionPath, [
  "grounding_result_contract_selection_complete",
  "grounding_result_geospatial_extension_complete",
  "wsgs.world_selection",
  "wsgs.source_currentness_validation",
  "SACS geospatial result lineage foreign keys"
]);
requireSource("services/grounding-worker/src/postgres-store.ts", [
  "persistSourceCurrentness",
  "geospatialResultPersistence",
  "INSERT INTO wsgs.grounding_result",
  "INSERT INTO wsgs.source_currentness_validation"
]);
requireSource("services/grounding-api/src/postgres-selection-store.ts", [
  "pg_advisory_xact_lock",
  "authorization_context_hash",
  "INSERT INTO wsgs.world_selection",
  "only their key id, expiry, and SHA-256 digest are stored"
]);
requireSource("packages/grounding-pipeline/src/postgres-backend-store.ts", [
  "to_regclass('wsgs.world_selection')",
  "to_regclass('wsgs.source_currentness_validation')",
  "DATABASE_SCHEMA_NOT_READY"
]);
requireSource("services/grounding-worker/src/postgres.integration.test.ts", [
  "persists currentness request and result atomically",
  "rolls back the terminal result when currentness extension persistence fails"
]);
requireSource("services/grounding-api/src/postgres-selection-store.integration.test.ts", [
  "allocates durable revisions",
  "rejects foreign authority"
]);

const sourcePaths = [
  migrationPath,
  assertionPath,
  "packages/runtime/src/migrations.ts",
  "packages/runtime/src/migration-002.integration.test.ts",
  "packages/grounding-pipeline/src/backend.ts",
  "packages/grounding-pipeline/src/postgres-backend-store.ts",
  "services/grounding-worker/src/result-schema.ts",
  "services/grounding-worker/src/postgres-store.ts",
  "services/grounding-worker/src/postgres.integration.test.ts",
  "services/grounding-api/src/postgres-selection-store.ts",
  "services/grounding-api/src/postgres-selection-store.test.ts",
  "services/grounding-api/src/postgres-selection-store.integration.test.ts",
  "services/grounding-api/src/production.ts"
];
const sourceHashes = Object.fromEntries(sourcePaths.map((path) => [
  path,
  sha256(readFileSync(join(repositoryRoot, path)))
]));
const inputSetHash = canonicalHash(sourceHashes);
const common = {
  phase: "N07",
  generator: { name: "generate-sacs-geospatial-persistence-evidence", version: "1.0.0" },
  generationMode: "DETERMINISTIC_SOURCE_AUDIT_NO_DATABASE",
  inputSetHash,
  sourceHashes,
  runtimeQualification: "NOT_RUN",
  postgresQualification: "NOT_RUN",
  productionQualified: false
};

writeOrCheck(join(reportRoot, "N07-migration.json"), document({
  schemaVersion: "wsgs-v021-n07-migration/1.0",
  ...common,
  status: "SOURCE_READY_POSTGRES_NOT_RUN",
  migration: {
    path: migrationPath,
    sha256: sourceHashes[migrationPath],
    additive: true,
    exactResultAuthority: "wsgs.grounding_result.result_bytes",
    duplicateFullResultStore: false
  },
  assertion: { path: assertionPath, sha256: sourceHashes[assertionPath] },
  persistedState: [
    "contract release/profile/hash",
    "geospatial finding/source set hashes",
    "source descriptor/content locks",
    "structured selection binding and token metadata",
    "source currentness request/result",
    "exact result bytes"
  ],
  migrationRunner: "packages/runtime/src/migrations.ts",
  emptyExistingRepeatPostgresCases: "NOT_RUN"
}));

writeOrCheck(join(reportRoot, "N07-postgres-integration.json"), document({
  schemaVersion: "wsgs-v021-n07-postgres-integration/1.0",
  ...common,
  status: "NOT_RUN",
  reason: "REAL_POSTGRESQL_INSTANCE_NOT_EXECUTED",
  testEntrypoints: [
    "services/grounding-worker/src/postgres.integration.test.ts",
    "services/grounding-api/src/postgres-selection-store.integration.test.ts",
    "packages/runtime/src/migration-002.integration.test.ts",
    "packages/runtime/src/job-store.integration.test.ts"
  ],
  requiredCases: 12,
  passedCases: 0,
  resultExtensionAtomicity: "NOT_RUN",
  selectionScopeIsolation: "NOT_RUN",
  currentnessScopeIsolation: "NOT_RUN",
  idempotencyConflict: "NOT_RUN",
  splitBrainRollback: "NOT_RUN",
  runtimeEvidenceIncluded: false
}));

writeOrCheck(join(reportRoot, "N07-restart-replay.json"), document({
  schemaVersion: "wsgs-v021-n07-restart-replay/1.0",
  ...common,
  status: "NOT_RUN",
  reason: "API_WORKER_RESTART_WITH_REAL_POSTGRESQL_NOT_EXECUTED",
  exactResultBytesReplay: "NOT_RUN",
  sameIdempotencySameRequest: "NOT_RUN",
  sameIdempotencyDifferentRequest: "NOT_RUN",
  selectionRevisionAfterRestart: "NOT_RUN",
  workerFenceGenerationRecovery: "NOT_RUN",
  runtimeEvidenceIncluded: false
}));

writeOrCheck(join(reportRoot, "N07-phase-report.md"), `# N07 PostgreSQL Persistence Phase Report\n\n` +
  `Status: **SOURCE_READY_POSTGRES_AND_RESTART_NOT_RUN**\n\n` +
  `- Added additive migration 005 and matching SQL assertions.\n` +
  `- The existing grounding result bytes remain the single full-result authority.\n` +
  `- Contract, geospatial hash/lock, structured selection, and currentness state are written with authority bindings.\n` +
  `- Currentness result settlement now validates its dedicated schema and hash field.\n` +
  `- Result and currentness extension writes share the fenced Worker settlement transaction.\n` +
  `- Structured selection revisions use a PostgreSQL advisory transaction lock and persist token metadata only.\n` +
  `- Real PostgreSQL migration, restart, replay, and negative cases remain NOT_RUN.\n` +
  `- Completion marker \`WSGS_V021_PERSISTENCE_READY\` is intentionally withheld.\n\n` +
  `Input set: \`${inputSetHash}\`\n`);

console.log(`WSGS_V021_PERSISTENCE_SOURCE_READY inputSetHash=${inputSetHash}`);
