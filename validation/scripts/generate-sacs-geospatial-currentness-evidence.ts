import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SourceCurrentnessError,
  currentnessOperationInput,
  loadSourceCurrentnessRecipeAuthorization,
  normalizeSourceCurrentness,
  parseSourceCurrentnessRequest,
  sourceCurrentnessReuseDecision,
  type SourceCurrentnessStatus,
  type ValidateSourceCurrentnessRequest
} from "../../packages/source-currentness/src/index.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const reportRoot = join(repositoryRoot, "reports", "sacs-geospatial-v1");
const write = process.argv.includes("--write");
const checkedAt = "2026-09-01T00:00:00.000Z";
const previousContentHash = `sha256:${"a".repeat(64)}` as const;
const changedContentHash = `sha256:${"b".repeat(64)}` as const;
const request: ValidateSourceCurrentnessRequest = {
  schemaVersion: "wsgs-source-currentness-request/1.0",
  sourceProductId: "source.gdps.baseline.dtm",
  productId: "gdps-baseline-dtm",
  previousContentHash
};

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
    throw new Error(`N06_GENERATED_ARTIFACT_DRIFT:${relative(repositoryRoot, path)}`);
  }
}

function upstream(status: Exclude<SourceCurrentnessStatus, "UNKNOWN">): Record<string, unknown> {
  return {
    schemaVersion: "gdps-check-current-result/1.0",
    productId: request.productId,
    currentness: status,
    ...(status === "CURRENT" ? { currentContentHash: previousContentHash } : {}),
    ...(status === "CHANGED" ? { currentContentHash: changedContentHash } : {})
  };
}

const vectors = (["CURRENT", "CHANGED", "NOT_AVAILABLE"] as const).map((expected) => {
  const result = normalizeSourceCurrentness({
    request,
    validationGroundingId: `grounding.currentness.${expected.toLowerCase()}`,
    checkedAt,
    upstream: upstream(expected)
  });
  if (result.status !== expected) throw new Error(`N06_${expected}_NORMALIZATION_FAILED`);
  return { caseId: `N06-${expected}`, expected, actual: result.status, status: "PASS_SOURCE_VECTOR" };
});
const unknown = normalizeSourceCurrentness({
  request,
  validationGroundingId: "grounding.currentness.unknown",
  checkedAt,
  upstream: null
});
if (unknown.status !== "UNKNOWN") throw new Error("N06_UNKNOWN_DEFAULT_FAILED");
vectors.push({ caseId: "N06-UNKNOWN", expected: "UNKNOWN", actual: unknown.status, status: "PASS_SOURCE_VECTOR" });

const negativeCases: Record<string, unknown>[] = [];
try {
  parseSourceCurrentnessRequest({ ...request, dataScope: "foreign" });
  throw new Error("N06_BODY_AUTHORITY_ACCEPTED");
} catch (error) {
  if (!(error instanceof SourceCurrentnessError) || error.code !== "CURRENTNESS_REQUEST_INVALID") throw error;
  negativeCases.push({ caseId: "N06-N01", assertion: "BODY_AUTHORITY_REJECTED", status: "PASS_FAIL_CLOSED" });
}
const contradictory = normalizeSourceCurrentness({
  request,
  validationGroundingId: "grounding.currentness.contradictory",
  checkedAt,
  upstream: { ...upstream("CHANGED"), currentness: "CURRENT" }
});
if (contradictory.status !== "UNKNOWN") throw new Error("N06_CONTRADICTORY_AUTHORITY_ACCEPTED");
negativeCases.push({ caseId: "N06-N02", assertion: "CONTRADICTORY_AUTHORITY_IS_UNKNOWN", status: "PASS_FAIL_CLOSED" });
for (const status of ["CHANGED", "NOT_AVAILABLE", "UNKNOWN"] as const) {
  if (sourceCurrentnessReuseDecision(status, "STRICT_REUSE") !== "FAIL_CLOSED" ||
      sourceCurrentnessReuseDecision(status, "BEST_EFFORT") !== "REQUERY_REQUIRED") {
    throw new Error(`N06_REUSE_POLICY_FAILED_${status}`);
  }
  negativeCases.push({
    caseId: `N06-N-${status}`,
    status,
    strictReuse: "FAIL_CLOSED",
    bestEffort: "REQUERY_REQUIRED",
    result: "PASS"
  });
}
const visibleMaterial = JSON.stringify(vectors);
if (visibleMaterial.includes("oldProductContent") || visibleMaterial.includes("sourcePayload")) {
  throw new Error("N06_OLD_PRODUCT_CONTENT_EXPOSED");
}

const recipe = loadSourceCurrentnessRecipeAuthorization(join(
  repositoryRoot, "contracts", "upstream", "gdps-v0.2.1", "GDPS_RECIPE_LOCK.json"
));
const sourcePaths = [
  "packages/source-currentness/src/index.ts",
  "packages/source-currentness/src/index.test.ts",
  "packages/query-compiler/src/recipes.ts",
  "packages/query-compiler/src/compiler.ts",
  "packages/grounding-pipeline/src/pipeline.ts",
  "packages/grounding-pipeline/src/backend.ts",
  "services/grounding-api/src/server.ts",
  "services/grounding-api/src/production.ts",
  "services/grounding-worker/src/production-module.ts",
  "contracts/wsgs-v0.2.1-sacs-geospatial/source-currentness-request.schema.json",
  "contracts/wsgs-v0.2.1-sacs-geospatial/source-currentness-result.schema.json"
];
const sourceHashes = Object.fromEntries(sourcePaths.map((path) => [path, sha256(readFileSync(join(repositoryRoot, path)))]));
const inputSetHash = canonicalHash(sourceHashes);
const common = {
  phase: "N06",
  generator: { name: "generate-sacs-geospatial-currentness-evidence", version: "1.0.0" },
  generationMode: "DETERMINISTIC_SOURCE_VECTOR_EXECUTION_NO_WALL_CLOCK",
  inputSetHash,
  sourceHashes,
  runtimeQualification: "NOT_RUN",
  postgresQualification: "NOT_RUN_N07_OWNER",
  productionQualified: false
};

writeOrCheck(join(reportRoot, "N06-currentness-contract.json"), document({
  schemaVersion: "wsgs-v021-n06-currentness-contract/1.0",
  ...common,
  status: "PASS_SOURCE_AND_UNIT",
  operation: "VALIDATE_SOURCE_CURRENTNESS",
  apiRoute: "POST /v1/source-currentness:validate",
  pipelinePlan: [
    "LOAD_CONTEXT", "REQUIREMENT_PLAN", "CAPABILITY_MATCH", "WORLD_QUERY_COMPILE",
    "GOWM_EXECUTE", "EVIDENCE_NORMALIZE", "PRODUCT_ASSEMBLE", "RESULT_PERSIST"
  ],
  modelStagesExecuted: false,
  gatewayOperation: "geo-product.check-current@1.0",
  recipeLockHash: recipe.recipeLockHash,
  operationInput: currentnessOperationInput(request),
  authoritySource: "AUTHENTICATED_CONTEXT_ONLY",
  sourceProductContentReturned: false,
  vectors
}));

writeOrCheck(join(reportRoot, "N06-currentness-runtime.json"), document({
  schemaVersion: "wsgs-v021-n06-currentness-runtime/1.0",
  ...common,
  status: "NOT_RUN",
  reason: "REAL_GATEWAY_POSTGRES_RUNTIME_NOT_EXECUTED",
  gatewayEndpoint: null,
  signedDelegation: "NOT_RUN",
  directProviderCalls: "NOT_RUN",
  foreignScope: "NOT_RUN",
  fourStateRuntimeCases: { passed: 0, required: 4 },
  runtimeEvidenceIncluded: false
}));

writeOrCheck(join(reportRoot, "N06-currentness-negative-cases.json"), document({
  schemaVersion: "wsgs-v021-n06-currentness-negative-cases/1.0",
  ...common,
  status: "PASS_SOURCE_AND_UNIT",
  unknownDefaultsToCurrent: false,
  oldProductContentReadable: false,
  negativeCases
}));

writeOrCheck(join(reportRoot, "N06-phase-report.md"), `# N06 Source Currentness Phase Report\n\n` +
  `Status: **SOURCE_AND_UNIT_READY_RUNTIME_NOT_RUN**\n\n` +
  `- Added the dedicated \`VALIDATE_SOURCE_CURRENTNESS\` northbound operation and API route.\n` +
  `- Uses the eight-stage Requirement/Capability/Compile/Gateway pipeline with no model stages.\n` +
  `- Locks \`geo-product.check-current@1.0\` to the exact Provider recipe and hashes.\n` +
  `- CURRENT, CHANGED, NOT_AVAILABLE, and UNKNOWN deterministic source vectors pass.\n` +
  `- STRICT_REUSE fails closed; BEST_EFFORT requires a new query.\n` +
  `- Real Gateway, PostgreSQL, foreign-scope, replay, and restart qualification remain NOT_RUN.\n` +
  `- Completion marker \`WSGS_V021_CURRENTNESS_READY\` is intentionally withheld.\n\n` +
  `Input set: \`${inputSetHash}\`\n`);

console.log(`WSGS_V021_CURRENTNESS_SOURCE_READY cases=${vectors.length + negativeCases.length} inputSetHash=${inputSetHash}`);
