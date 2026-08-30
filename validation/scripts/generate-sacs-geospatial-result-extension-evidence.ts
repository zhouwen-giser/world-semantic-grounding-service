import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;
type Sha256Digest = `sha256:${string}`;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const writeMode = process.argv.includes("--write");

const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--write");
if (unknownArguments.length > 0) throw new Error(`N04_ARGUMENT_UNSUPPORTED:${unknownArguments.join(",")}`);

const paths = {
  generator: "validation/scripts/generate-sacs-geospatial-result-extension-evidence.ts",
  packageManifest: "package.json",
  packageLock: "package-lock.json",
  environmentExample: ".env.example",
  compose: "compose.yaml",
  contractReleaseLock: "contracts/wsgs-v0.2.1-sacs-geospatial/contract-release-lock.json",
  capabilities11Schema: "contracts/wsgs-v0.2.1-sacs-geospatial/capabilities-response-v1.1.schema.json",
  capabilities11Example: "contracts/wsgs-v0.2.1-sacs-geospatial/examples/capabilities-response-v1.1.json",
  resultExtensionSchema: "contracts/wsgs-v0.2.1-sacs-geospatial/grounding-result-extension.schema.json",
  resultExtensionExample: "contracts/wsgs-v0.2.1-sacs-geospatial/examples/grounding-result-with-geospatial-findings.json",
  legacyContractLock: "contracts/wsgs-v0.1/contract-lock.json",
  legacyBaselineLock: "contracts/wsgs-v0.2.1-sacs-geospatial/baselines/sacs-wsgs-grounding-1.0-contract-lock.json",
  legacyCapabilitiesSchema: "contracts/wsgs-v0.1/contracts/capabilities-response.schema.json",
  legacyResultSchema: "contracts/wsgs-v0.1/contracts/grounding-result.schema.json",
  contractSelection: "packages/grounding-pipeline/src/contract-selection.ts",
  backend: "packages/grounding-pipeline/src/backend.ts",
  backendTest: "packages/grounding-pipeline/src/backend.test.ts",
  pipelineIndex: "packages/grounding-pipeline/src/index.ts",
  pipelineCanonical: "packages/grounding-pipeline/src/canonical.ts",
  pipeline: "packages/grounding-pipeline/src/pipeline.ts",
  pipelineTest: "packages/grounding-pipeline/src/pipeline.test.ts",
  postgresBackendStore: "packages/grounding-pipeline/src/postgres-backend-store.ts",
  findingPackageManifest: "packages/northbound-geospatial-findings/package.json",
  resultNormalizer: "packages/northbound-geospatial-findings/src/result-normalizer.ts",
  resultNormalizerTest: "packages/northbound-geospatial-findings/src/result-normalizer.test.ts",
  runtimeAssembly: "packages/northbound-geospatial-findings/src/runtime-assembly.ts",
  runtimeAssemblyTest: "packages/northbound-geospatial-findings/src/runtime-assembly.test.ts",
  apiPackageManifest: "services/grounding-api/package.json",
  apiTsconfig: "services/grounding-api/tsconfig.json",
  apiIndex: "services/grounding-api/src/index.ts",
  apiMain: "services/grounding-api/src/main.ts",
  apiNegotiation: "services/grounding-api/src/contract-negotiation.ts",
  apiNegotiationTest: "services/grounding-api/src/contract-negotiation.test.ts",
  apiProduction: "services/grounding-api/src/production.ts",
  apiProductionIntegrationTest: "services/grounding-api/src/production.integration.test.ts",
  apiCapabilitiesTest: "services/grounding-api/src/production-capabilities.test.ts",
  apiSchemas: "services/grounding-api/src/schemas.ts",
  apiServer: "services/grounding-api/src/server.ts",
  apiServerTest: "services/grounding-api/src/server.test.ts",
  apiTypes: "services/grounding-api/src/types.ts",
  workerPackageManifest: "services/grounding-worker/package.json",
  workerTsconfig: "services/grounding-worker/tsconfig.json",
  worker: "services/grounding-worker/src/worker.ts",
  workerTest: "services/grounding-worker/src/worker.test.ts",
  workerProductionModule: "services/grounding-worker/src/production-module.ts",
  workerProductionModuleTest: "services/grounding-worker/src/production-module.test.ts",
  workerPostgresStore: "services/grounding-worker/src/postgres-store.ts",
  workerPostgresIntegrationTest: "services/grounding-worker/src/postgres.integration.test.ts",
  workerResultSchema: "services/grounding-worker/src/result-schema.ts",
  workerResultSchemaTest: "services/grounding-worker/src/result-schema.test.ts",
  architectureBoundary: "validation/scripts/architecture-boundary.mjs",
  liveGdpsOperationLockGenerator: "validation/scripts/generate-live-gdps-operation-lock.ts",
  gowmBaseOperationLock:
    "contracts/upstream/gowm-0.6.3/extracted/package/bundle/locks/wsgs-southbound-operation-lock-v2.json",
  gdpsCapabilityLock: "contracts/upstream/gdps-v0.2.1/GDPS_CAPABILITY_LOCK.json",
  gdpsGatewayBindingLock: "contracts/upstream/gdps-v0.2.1/GOWM_GATEWAY_BINDING_LOCK.json",
  generatedGdpsOperationLock: "contracts/generated/gdps-v0.2.1/wsgs-southbound-operation-lock-v2.json",
  realGowmGate: "validation/scripts/real-gowm-gate.ts",
  realDevelopmentGate: "validation/scripts/real-development-pipeline-gate.ts",
  runRealGdpsIntegration: "validation/scripts/run-real-gdps-integration.ps1"
} as const;

const realRuntimeReportPath = "reports/sacs-geospatial-v1/N04-real-runtime.json";
const excludedRuntimeEvidenceOutputs = [
  "reports/wsgs-gowm-0.6.4-alignment/direct-r1-r5-smoke.json",
  "reports/wsgs-gowm-0.6.4-alignment/runtime-binding-report.json"
] as const;

function sha256(value: string | Buffer): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("N04_CANONICAL_NON_FINITE_NUMBER");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonObject)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  throw new Error("N04_CANONICAL_VALUE_UNSUPPORTED");
}

function canonicalHash(value: unknown): Sha256Digest {
  return sha256(JSON.stringify(canonicalValue(value)));
}

function source(path: string): string {
  const absolute = resolve(repoRoot, path);
  if (!existsSync(absolute)) throw new Error(`N04_INPUT_MISSING:${path}`);
  return readFileSync(absolute, "utf8").replace(/\r\n?/gu, "\n");
}

function sourceHash(path: string): Sha256Digest {
  return sha256(source(path));
}

function json(path: string): JsonObject {
  const value = JSON.parse(source(path)) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`N04_JSON_OBJECT_REQUIRED:${path}`);
  }
  return value as JsonObject;
}

function jsonHash(path: string): Sha256Digest {
  return canonicalHash(json(path));
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function record(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonObject;
}

function exactKeys(value: JsonObject, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(`${code}:expected=${required.join(",")}:actual=${actual.join(",")}`);
  }
}

function exact(value: unknown, expected: unknown, code: string): void {
  if (value !== expected) throw new Error(code);
}

function nonEmptyString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) throw new Error(code);
  return value;
}

function nonNegativeInteger(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}

function positiveInteger(value: unknown, code: string): number {
  const result = nonNegativeInteger(value, code);
  if (result < 1) throw new Error(code);
  return result;
}

function digest(value: unknown, code: string): Sha256Digest {
  const result = nonEmptyString(value, code);
  if (!/^sha256:[0-9a-f]{64}$/u.test(result)) throw new Error(code);
  return result as Sha256Digest;
}

function commit(value: unknown, code: string): string {
  const result = nonEmptyString(value, code);
  if (!/^[0-9a-f]{40}$/u.test(result)) throw new Error(code);
  return result;
}

function gitRevision(argument: string): string {
  const result = execFileSync("git", ["rev-parse", argument], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  return commit(result, `N04_GIT_REVISION_INVALID:${argument}`);
}

function sourceAtCommitHash(sourceCommit: string, path: string): Sha256Digest {
  const value = execFileSync("git", ["show", `${sourceCommit}:${path}`], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).replace(/\r\n?/gu, "\n");
  return sha256(value);
}

function assertAncestor(ancestor: string): void {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, "HEAD"], {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "pipe"]
    });
  } catch {
    throw new Error("N04_RUNTIME_SOURCE_NOT_ANCESTOR_OF_DELIVERY_HEAD");
  }
}

function materialize(path: string, content: string): void {
  const absolute = resolve(repoRoot, path);
  if (writeMode) {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
    if (readFileSync(absolute, "utf8") !== content) throw new Error(`N04_EVIDENCE_WRITE_FAILED:${path}`);
    return;
  }
  if (!existsSync(absolute)) throw new Error(`N04_EVIDENCE_MISSING:${path}`);
  if (readFileSync(absolute, "utf8") !== content) throw new Error(`N04_EVIDENCE_DRIFT:${path}`);
}

function requireFragments(path: string, fragments: readonly string[]): void {
  const text = source(path);
  for (const fragment of fragments) {
    if (!text.includes(fragment)) throw new Error(`N04_REQUIRED_SOURCE_FRAGMENT_MISSING:${path}:${fragment}`);
  }
}

const legacyLock = json(paths.legacyContractLock);
const legacyBaselineLock = json(paths.legacyBaselineLock);
if (canonicalHash(legacyLock) !== canonicalHash(legacyBaselineLock)) {
  throw new Error("N04_LEGACY_CONTRACT_BASELINE_DRIFT");
}
const legacyArtifacts = legacyLock["artifacts"];
if (!legacyArtifacts || typeof legacyArtifacts !== "object" || Array.isArray(legacyArtifacts)) {
  throw new Error("N04_LEGACY_ARTIFACT_LOCK_INVALID");
}
const legacyArtifactMap = legacyArtifacts as Record<string, unknown>;
if (legacyArtifactMap["contracts/capabilities-response.schema.json"] !== sourceHash(paths.legacyCapabilitiesSchema)
  || legacyArtifactMap["contracts/grounding-result.schema.json"] !== sourceHash(paths.legacyResultSchema)) {
  throw new Error("N04_LEGACY_SCHEMA_HASH_DRIFT");
}

requireFragments(paths.apiNegotiation, [
  "request.raw.rawHeaders",
  "count > 1",
  "value.includes(\",\")",
  "sacsGeospatialServicePrincipals.includes(identity.servicePrincipalId)",
  "contractVersion === LEGACY_GROUNDING_CONTRACT_VERSION",
  "contractVersion === SACS_GEOSPATIAL_GROUNDING_CONTRACT_VERSION",
  "resultProfile === SACS_GEOSPATIAL_RESULT_PROFILE",
  "geospatialAuthorized"
]);
requireFragments(paths.apiServer, [
  "assertNoAuthority(body)",
  "negotiateGroundingContract(request, caller, contractNegotiation)",
  "negotiatedResponseValidator(validators, selection",
  "config.backend.get(caller, groundingId(request), selection)",
  "config.backend.cancel(caller, cancellationGroundingId(request), selection)"
]);
requireFragments(paths.postgresBackendStore, [
  "request.principal_id = $4",
  "request.authorization_context_hash = $5",
  "assertPersistedSelection(job, contractSelection)",
  "assertMetadataSelection(row.request_metadata, contractSelection)"
]);
requireFragments(paths.pipeline, [
  "canonicalResultMaterial",
  "key !== \"resultHash\"",
  "key !== \"elapsedMs\"",
  "resultBytes.byteLength > maxResultBytes"
]);
requireFragments(paths.workerProductionModule, [
  "const geospatialNegotiated = geospatialResultNegotiated(context)",
  "if (geospatialNegotiated)",
  "geospatialFindings: geospatialAssembly.geospatialFindings",
  "RESULT_PERSIST: async (context) => stageValue<JsonObject>(context, \"PRODUCT_ASSEMBLE\")"
]);
requireFragments(paths.workerResultSchema, [
  "assertNegotiatedGroundingResult",
  "grounding-result-extension.schema.json"
]);
requireFragments(paths.worker, [
  "return await this.#settle(fence, {",
  "kind: \"RESULT\""
]);

if (!existsSync(resolve(repoRoot, realRuntimeReportPath))) {
  throw new Error("N04_REAL_RUNTIME_REPORT_MISSING");
}
const realRuntimeReport = json(realRuntimeReportPath);
exactKeys(realRuntimeReport, [
  "schemaVersion",
  "sourceCommit",
  "qualifiedSourceSha",
  "sourceTree",
  "sourceBinding",
  "upstreamRuntime",
  "negotiation",
  "capabilities",
  "realExecution",
  "synchronousExecution",
  "legacyCompatibility",
  "executionBoundary",
  "qualification",
  "redaction",
  "status",
  "reportHash"
], "N04_REAL_RUNTIME_TOP_LEVEL_KEYS_INVALID");
exact(realRuntimeReport["schemaVersion"], "wsgs-v021-result-extension-real-runtime/1.0", "N04_REAL_RUNTIME_SCHEMA_VERSION_INVALID");
exact(realRuntimeReport["status"], "PASS", "N04_REAL_RUNTIME_STATUS_NOT_PASS");
const qualifiedRuntimeSourceSha = commit(realRuntimeReport["sourceCommit"], "N04_REAL_RUNTIME_SOURCE_SHA_INVALID");
exact(realRuntimeReport["qualifiedSourceSha"], qualifiedRuntimeSourceSha, "N04_QUALIFIED_SOURCE_SHA_MISMATCH");
const qualifiedRuntimeSourceTree = commit(realRuntimeReport["sourceTree"], "N04_REAL_RUNTIME_SOURCE_TREE_INVALID");
const runtimeReportHash = digest(realRuntimeReport["reportHash"], "N04_REAL_RUNTIME_REPORT_HASH_INVALID");
const runtimeReportFileHash = sha256(readFileSync(resolve(repoRoot, realRuntimeReportPath)));
const realRuntimePayload = Object.fromEntries(
  Object.entries(realRuntimeReport).filter(([key]) => key !== "reportHash")
);
if (canonicalHash(realRuntimePayload) !== runtimeReportHash) {
  throw new Error("N04_REAL_RUNTIME_REPORT_HASH_MISMATCH");
}
if (gitRevision(`${qualifiedRuntimeSourceSha}^{tree}`) !== qualifiedRuntimeSourceTree) {
  throw new Error("N04_REAL_RUNTIME_SOURCE_TREE_MISMATCH");
}
assertAncestor(qualifiedRuntimeSourceSha);

const sourceBinding = record(realRuntimeReport["sourceBinding"], "N04_SOURCE_BINDING_INVALID");
exactKeys(sourceBinding, [
  "status",
  "headCommit",
  "sourceTree",
  "evidenceSourceCommit",
  "trackedSourceClean",
  "untrackedSourceClean",
  "excludedRuntimeEvidenceOutputs",
  "verification"
], "N04_SOURCE_BINDING_KEYS_INVALID");
exact(sourceBinding["status"], "PASS", "N04_SOURCE_BINDING_NOT_PASS");
exact(sourceBinding["headCommit"], qualifiedRuntimeSourceSha, "N04_SOURCE_BINDING_HEAD_MISMATCH");
exact(sourceBinding["sourceTree"], qualifiedRuntimeSourceTree, "N04_SOURCE_BINDING_TREE_MISMATCH");
exact(sourceBinding["evidenceSourceCommit"], qualifiedRuntimeSourceSha, "N04_SOURCE_BINDING_EVIDENCE_SHA_MISMATCH");
exact(sourceBinding["trackedSourceClean"], true, "N04_SOURCE_BINDING_TRACKED_DIRTY");
exact(sourceBinding["untrackedSourceClean"], true, "N04_SOURCE_BINDING_UNTRACKED_DIRTY");
const sourceBindingExclusions = sourceBinding["excludedRuntimeEvidenceOutputs"];
if (!Array.isArray(sourceBindingExclusions) ||
    sourceBindingExclusions.length !== excludedRuntimeEvidenceOutputs.length ||
    sourceBindingExclusions.some((path, index) => path !== excludedRuntimeEvidenceOutputs[index])) {
  throw new Error("N04_SOURCE_BINDING_EVIDENCE_OUTPUT_EXCLUSIONS_INVALID");
}
exact(
  sourceBinding["verification"],
  "GIT_HEAD_AND_WORKTREE_STATUS_EXCLUDING_EXACT_RUNTIME_EVIDENCE_OUTPUTS",
  "N04_SOURCE_BINDING_VERIFICATION_INVALID"
);

const upstreamRuntime = record(realRuntimeReport["upstreamRuntime"], "N04_UPSTREAM_RUNTIME_INVALID");
exactKeys(upstreamRuntime, [
  "sourceCommit",
  "runtimeBindingHash",
  "gatewayContractVersion",
  "operationLockHash",
  "operationLockPathHash"
], "N04_UPSTREAM_RUNTIME_KEYS_INVALID");
commit(upstreamRuntime["sourceCommit"], "N04_UPSTREAM_SOURCE_SHA_INVALID");
digest(upstreamRuntime["runtimeBindingHash"], "N04_UPSTREAM_RUNTIME_BINDING_HASH_INVALID");
nonEmptyString(upstreamRuntime["gatewayContractVersion"], "N04_UPSTREAM_GATEWAY_CONTRACT_VERSION_INVALID");
exact(
  digest(upstreamRuntime["operationLockHash"], "N04_UPSTREAM_OPERATION_LOCK_HASH_INVALID"),
  sourceHash(paths.generatedGdpsOperationLock),
  "N04_UPSTREAM_OPERATION_LOCK_HASH_MISMATCH"
);
exact(
  digest(upstreamRuntime["operationLockPathHash"], "N04_UPSTREAM_OPERATION_LOCK_PATH_HASH_INVALID"),
  sha256(paths.generatedGdpsOperationLock),
  "N04_UPSTREAM_OPERATION_LOCK_PATH_HASH_MISMATCH"
);

const negotiation = record(realRuntimeReport["negotiation"], "N04_NEGOTIATION_INVALID");
exactKeys(negotiation, [
  "legacyContractVersion",
  "contractVersion",
  "profile",
  "transportMode",
  "noHeaderDefault",
  "explicitResponseHeadersVerified",
  "crossContractPersistedReadHttpStatus"
], "N04_NEGOTIATION_KEYS_INVALID");
exact(negotiation["legacyContractVersion"], "sacs-wsgs-grounding/1.0", "N04_LEGACY_CONTRACT_VERSION_INVALID");
exact(negotiation["contractVersion"], "sacs-wsgs-grounding/1.1", "N04_CONTRACT_VERSION_INVALID");
exact(negotiation["profile"], "sacs-wsgs-geospatial-findings/1.0", "N04_PROFILE_INVALID");
exact(negotiation["transportMode"], "RESULT_EXTENSION", "N04_TRANSPORT_MODE_INVALID");
exact(negotiation["noHeaderDefault"], "sacs-wsgs-grounding/1.0", "N04_NO_HEADER_DEFAULT_INVALID");
exact(negotiation["explicitResponseHeadersVerified"], true, "N04_NEGOTIATION_RESPONSE_HEADERS_NOT_VERIFIED");
exact(negotiation["crossContractPersistedReadHttpStatus"], 406, "N04_CROSS_CONTRACT_READ_NOT_REJECTED");

const runtimeCapabilities = record(realRuntimeReport["capabilities"], "N04_RUNTIME_CAPABILITIES_INVALID");
exactKeys(runtimeCapabilities, [
  "legacyHash",
  "geospatialHash",
  "supportedOperationCount",
  "requiredCapabilitiesReady",
  "n05N06RemainUnavailable"
], "N04_RUNTIME_CAPABILITIES_KEYS_INVALID");
digest(runtimeCapabilities["legacyHash"], "N04_LEGACY_CAPABILITIES_HASH_INVALID");
digest(runtimeCapabilities["geospatialHash"], "N04_GEOSPATIAL_CAPABILITIES_HASH_INVALID");
exact(runtimeCapabilities["supportedOperationCount"], 6, "N04_SUPPORTED_OPERATION_COUNT_INVALID");
exact(runtimeCapabilities["requiredCapabilitiesReady"], false, "N04_CAPABILITIES_PREMATURELY_READY");
exact(runtimeCapabilities["n05N06RemainUnavailable"], true, "N04_N05_N06_AVAILABILITY_BOUNDARY_INVALID");

function validateExtensionSummary(value: JsonObject, prefix: string): void {
  positiveInteger(value["findingCount"], `${prefix}_FINDING_COUNT_INVALID`);
  positiveInteger(value["sourceProductCount"], `${prefix}_SOURCE_PRODUCT_COUNT_INVALID`);
  positiveInteger(value["evidenceItemCount"], `${prefix}_EVIDENCE_ITEM_COUNT_INVALID`);
  nonNegativeInteger(value["gapCount"], `${prefix}_GAP_COUNT_INVALID`);
  positiveInteger(value["subjectReferenceCount"], `${prefix}_SUBJECT_REFERENCE_COUNT_INVALID`);
  exact(value["extensionIncludedInResultHash"], true, `${prefix}_EXTENSION_NOT_HASHED`);
  exact(value["elapsedMsExcludedFromResultHash"], true, `${prefix}_ELAPSED_MS_HASH_BOUNDARY_INVALID`);
}

const realExecution = record(realRuntimeReport["realExecution"], "N04_REAL_EXECUTION_INVALID");
exactKeys(realExecution, [
  "caseId",
  "freshSyncPostHttpStatus",
  "freshSyncGetHttpStatus",
  "asyncPostHttpStatus",
  "persistedGetHttpStatus",
  "syncReplayHttpStatus",
  "terminalStatus",
  "pipelineStageCount",
  "gatewayExecutionCount",
  "resultHash",
  "persistedResultBytesHash",
  "persistedBytesAndHashMatchGet",
  "persistedContractSelectionVerified",
  "syncAndAsyncResultSemanticsMatch",
  "syncAndAsyncSemanticProjectionHash",
  "semanticProjectionIncludesGapsEvidenceAndSubjects",
  "syncReplayAddedGatewayExecutions",
  "findingCount",
  "sourceProductCount",
  "evidenceItemCount",
  "gapCount",
  "subjectReferenceCount",
  "extensionIncludedInResultHash",
  "elapsedMsExcludedFromResultHash"
], "N04_REAL_EXECUTION_KEYS_INVALID");
exact(realExecution["caseId"], "E2E-SLOPE-POINT", "N04_REAL_CASE_INVALID");
exact(realExecution["freshSyncPostHttpStatus"], 200, "N04_FRESH_SYNC_POST_FAILED");
exact(realExecution["freshSyncGetHttpStatus"], 200, "N04_FRESH_SYNC_GET_FAILED");
exact(realExecution["asyncPostHttpStatus"], 202, "N04_ASYNC_POST_FAILED");
exact(realExecution["persistedGetHttpStatus"], 200, "N04_PERSISTED_GET_FAILED");
exact(realExecution["syncReplayHttpStatus"], 200, "N04_SYNC_REPLAY_FAILED");
exact(realExecution["terminalStatus"], "COMPLETED", "N04_REAL_EXECUTION_NOT_COMPLETED");
positiveInteger(realExecution["pipelineStageCount"], "N04_PIPELINE_STAGE_COUNT_INVALID");
positiveInteger(realExecution["gatewayExecutionCount"], "N04_GATEWAY_EXECUTION_COUNT_INVALID");
digest(realExecution["resultHash"], "N04_RESULT_HASH_INVALID");
digest(realExecution["persistedResultBytesHash"], "N04_PERSISTED_RESULT_BYTES_HASH_INVALID");
exact(realExecution["persistedBytesAndHashMatchGet"], true, "N04_PERSISTED_RESULT_MISMATCH");
exact(realExecution["persistedContractSelectionVerified"], true, "N04_PERSISTED_SELECTION_NOT_VERIFIED");
exact(realExecution["syncAndAsyncResultSemanticsMatch"], true, "N04_SYNC_ASYNC_SEMANTICS_MISMATCH");
digest(realExecution["syncAndAsyncSemanticProjectionHash"], "N04_SYNC_ASYNC_SEMANTIC_PROJECTION_HASH_INVALID");
exact(
  realExecution["semanticProjectionIncludesGapsEvidenceAndSubjects"],
  true,
  "N04_SYNC_ASYNC_SEMANTIC_PROJECTION_INCOMPLETE"
);
exact(realExecution["syncReplayAddedGatewayExecutions"], 0, "N04_SYNC_REPLAY_REEXECUTED_GATEWAY");
validateExtensionSummary(realExecution, "N04_REAL");

const synchronousExecution = record(realRuntimeReport["synchronousExecution"], "N04_SYNCHRONOUS_EXECUTION_INVALID");
exactKeys(synchronousExecution, [
  "terminalStatus",
  "resultHash",
  "persistedResultBytesHash",
  "findingCount",
  "sourceProductCount",
  "evidenceItemCount",
  "gapCount",
  "subjectReferenceCount",
  "extensionIncludedInResultHash",
  "elapsedMsExcludedFromResultHash"
], "N04_SYNCHRONOUS_EXECUTION_KEYS_INVALID");
exact(synchronousExecution["terminalStatus"], "COMPLETED", "N04_SYNCHRONOUS_EXECUTION_NOT_COMPLETED");
digest(synchronousExecution["resultHash"], "N04_SYNCHRONOUS_RESULT_HASH_INVALID");
digest(synchronousExecution["persistedResultBytesHash"], "N04_SYNCHRONOUS_BYTES_HASH_INVALID");
validateExtensionSummary(synchronousExecution, "N04_SYNCHRONOUS");

const legacyCompatibility = record(realRuntimeReport["legacyCompatibility"], "N04_LEGACY_COMPATIBILITY_INVALID");
exactKeys(legacyCompatibility, [
  "asyncPostHttpStatus",
  "persistedGetHttpStatus",
  "terminalStatus",
  "geospatialFindingsAbsent",
  "resultHash"
], "N04_LEGACY_COMPATIBILITY_KEYS_INVALID");
exact(legacyCompatibility["asyncPostHttpStatus"], 202, "N04_LEGACY_ASYNC_POST_FAILED");
exact(legacyCompatibility["persistedGetHttpStatus"], 200, "N04_LEGACY_PERSISTED_GET_FAILED");
exact(legacyCompatibility["terminalStatus"], "COMPLETED", "N04_LEGACY_EXECUTION_NOT_COMPLETED");
exact(legacyCompatibility["geospatialFindingsAbsent"], true, "N04_LEGACY_EXTENSION_PRESENT");
digest(legacyCompatibility["resultHash"], "N04_LEGACY_RESULT_HASH_INVALID");

const executionBoundary = record(realRuntimeReport["executionBoundary"], "N04_EXECUTION_BOUNDARY_INVALID");
exactKeys(executionBoundary, [
  "publicApi",
  "productionPipeline",
  "isolatedPostgresqlPersistence",
  "signedGowmGatewayOnly",
  "wsgsDirectProviderCalls",
  "wsgsDirectUpstreamDatabaseCalls",
  "testHarnessPersistenceInspection",
  "sharedInstanceModified"
], "N04_EXECUTION_BOUNDARY_KEYS_INVALID");
for (const key of [
  "publicApi",
  "productionPipeline",
  "isolatedPostgresqlPersistence",
  "signedGowmGatewayOnly",
  "testHarnessPersistenceInspection"
] as const) exact(executionBoundary[key], true, `N04_EXECUTION_BOUNDARY_${key.toUpperCase()}_INVALID`);
exact(executionBoundary["wsgsDirectProviderCalls"], 0, "N04_DIRECT_PROVIDER_CALL_DETECTED");
exact(executionBoundary["wsgsDirectUpstreamDatabaseCalls"], 0, "N04_DIRECT_UPSTREAM_DATABASE_CALL_DETECTED");
exact(executionBoundary["sharedInstanceModified"], false, "N04_SHARED_INSTANCE_MODIFIED");

const qualification = record(realRuntimeReport["qualification"], "N04_QUALIFICATION_INVALID");
exactKeys(qualification, [
  "contractAuthority",
  "implementationQualified",
  "runtimeQualified",
  "consumerCompatible",
  "productionQualified",
  "g1"
], "N04_QUALIFICATION_KEYS_INVALID");
exact(qualification["contractAuthority"], "AUTHORITATIVE", "N04_CONTRACT_AUTHORITY_INVALID");
exact(qualification["implementationQualified"], true, "N04_IMPLEMENTATION_NOT_QUALIFIED");
exact(qualification["runtimeQualified"], true, "N04_RUNTIME_NOT_QUALIFIED");
exact(qualification["consumerCompatible"], false, "N04_CONSUMER_COMPATIBILITY_PREMATURE");
exact(qualification["productionQualified"], false, "N04_PRODUCTION_QUALIFICATION_INVALID");
exact(qualification["g1"], "NOT_RUN", "N04_G1_PREMATURELY_QUALIFIED");

const redaction = record(realRuntimeReport["redaction"], "N04_REDACTION_INVALID");
exactKeys(redaction, [
  "credentialsIncluded",
  "rawGroundingIdsIncluded",
  "rawReferenceIdsIncluded",
  "internalProviderUrlsIncluded",
  "databaseIdentifiersIncluded",
  "localPathsIncluded"
], "N04_REDACTION_KEYS_INVALID");
for (const key of Object.keys(redaction)) exact(redaction[key], false, `N04_REDACTION_${key.toUpperCase()}_INVALID`);

const inputHashes = Object.fromEntries(Object.entries(paths).map(([logicalId, path]) => [
  logicalId,
  sourceHash(path)
]));
const inputSetHash = canonicalHash(inputHashes);
for (const [logicalId, path] of Object.entries(paths)) {
  if (sourceAtCommitHash(qualifiedRuntimeSourceSha, path) !== inputHashes[logicalId]) {
    throw new Error(`N04_RUNTIME_SOURCE_INPUT_DRIFT:${path}`);
  }
}

const contractLocks = {
  legacyContractLock: sourceHash(paths.legacyContractLock),
  legacyCapabilitiesSchema: sourceHash(paths.legacyCapabilitiesSchema),
  legacyGroundingResultSchema: sourceHash(paths.legacyResultSchema),
  additiveReleaseLock: sourceHash(paths.contractReleaseLock),
  capabilities11Schema: jsonHash(paths.capabilities11Schema),
  groundingResultExtensionSchema: jsonHash(paths.resultExtensionSchema)
};

const verificationEvidence = {
  repositoryReceiptFormat: "NOT_DEFINED",
  unverifiedTestCountsClaimed: false,
  sourceGates: [
    {
      logicalId: "CONTRACT_NEGOTIATION_AND_API",
      inputLogicalIds: [
        "apiNegotiation",
        "apiNegotiationTest",
        "apiProduction",
        "apiProductionIntegrationTest",
        "apiCapabilitiesTest",
        "apiSchemas",
        "apiServer",
        "apiServerTest"
      ],
      disposition: "SOURCE_INPUTS_HASH_LOCKED",
      currentExecutionClaimed: false
    },
    {
      logicalId: "RESULT_ASSEMBLY_HASH_AND_PERSISTENCE",
      inputLogicalIds: [
        "pipeline",
        "pipelineTest",
        "resultNormalizer",
        "resultNormalizerTest",
        "runtimeAssembly",
        "runtimeAssemblyTest",
        "workerProductionModule",
        "workerProductionModuleTest",
        "workerPostgresIntegrationTest",
        "workerResultSchema",
        "workerResultSchemaTest"
      ],
      disposition: "SOURCE_INPUTS_HASH_LOCKED",
      currentExecutionClaimed: false
    },
    {
      logicalId: "REAL_RESULT_EXTENSION_GATE",
      inputLogicalIds: [
        "liveGdpsOperationLockGenerator",
        "gowmBaseOperationLock",
        "gdpsCapabilityLock",
        "gdpsGatewayBindingLock",
        "generatedGdpsOperationLock",
        "realGowmGate",
        "realDevelopmentGate",
        "runRealGdpsIntegration"
      ],
      disposition: "REAL_RUNTIME_REPORT_HASH_VERIFIED",
      currentExecutionClaimed: true,
      runtimeReportHash
    }
  ]
};

const common = {
  phase: "N04",
  version: "0.2.1",
  contractVersion: "sacs-wsgs-grounding/1.1",
  legacyContractVersion: "sacs-wsgs-grounding/1.0",
  wireSchemaVersion: "1.0",
  profile: "sacs-wsgs-geospatial-findings/1.0",
  transportMode: "RESULT_EXTENSION",
  resultExtensionField: "geospatialFindings",
  inputSetHash,
  inputHashes,
  contractLocks,
  qualifiedRuntimeSourceSha,
  qualifiedRuntimeSourceTree,
  runtimeReport: {
    schemaVersion: realRuntimeReport["schemaVersion"],
    fileHash: runtimeReportFileHash,
    reportHash: runtimeReportHash,
    qualifiedSourceSha: qualifiedRuntimeSourceSha,
    qualifiedSourceTree: qualifiedRuntimeSourceTree,
    status: "PASS"
  },
  verificationEvidence,
  generationMode: "DETERMINISTIC_CONTENT_ADDRESSED_NO_WALL_CLOCK",
  canonicalization: "UTF8_CRLF_CR_NORMALIZED_TO_LF_SHA256",
  securityBoundary: {
    credentialsIncluded: false,
    requestIdentifiersIncluded: false,
    rawReferenceIdentifiersIncluded: false,
    localPathsIncluded: false,
    internalTopologyIncluded: false,
    directProviderCalls: executionBoundary["wsgsDirectProviderCalls"],
    directUpstreamDatabaseCalls: executionBoundary["wsgsDirectUpstreamDatabaseCalls"],
    sharedInstanceModified: false
  },
  qualificationBoundary: {
    contractAuthority: "AUTHORITATIVE",
    phaseSourceAndIntegrationQualification: "PASS",
    runtimeQualification: "PASS_ISOLATED_WSGS_SIGNED_GATEWAY",
    sharedWsgsRuntimeQualification: "NOT_RUN",
    sacsV04RealE2E: { status: "NOT_RUN", passed: 0, expected: 18 },
    consumerCompatible: false,
    g1: "NOT_RUN",
    productionQualified: false
  }
};

const capabilitiesReport = {
  schemaVersion: "wsgs-v021-n04-capabilities/1.0",
  ...common,
  status: "PASS",
  legacyRelease: {
    contractVersion: "sacs-wsgs-grounding/1.0",
    behavior: "UNCHANGED",
    extensionReturned: false,
    byteStable: true
  },
  additiveRelease: {
    contractVersion: "sacs-wsgs-grounding/1.1",
    supportedResultProfiles: ["sacs-wsgs-geospatial-findings/1.0"],
    geospatialTransportMode: "RESULT_EXTENSION",
    currentness: {
      mode: "DEDICATED_OPERATION",
      operation: "VALIDATE_SOURCE_CURRENTNESS"
    },
    requiredCapabilitiesReady: false,
    stagedUnavailableCapabilities: [
      { operationId: "RESOLVE_WORLD_SELECTION", available: false, ownerPhase: "N05" },
      { operationId: "VALIDATE_SOURCE_CURRENTNESS", available: false, ownerPhase: "N06" }
    ]
  },
  runtimeEvidence: {
    legacyCapabilitiesHash: runtimeCapabilities["legacyHash"],
    geospatialCapabilitiesHash: runtimeCapabilities["geospatialHash"],
    supportedOperationCount: runtimeCapabilities["supportedOperationCount"],
    reportHash: runtimeReportHash
  },
  negotiation: {
    contractHeader: "wsgs-contract-version",
    profileHeader: "wsgs-result-profile",
    exactHeaderPairRequiredForExplicit11: true,
    exactPrincipalAllowlistRequiredFor11: true,
    duplicateOrCommaJoinedHeadersRejected: true,
    requestBodyAuthorityUsed: false,
    userAgentUsed: false,
    sourceTextUsed: false,
    unconfiguredDefault: "sacs-wsgs-grounding/1.0"
  }
};

const apiContractReport = {
  schemaVersion: "wsgs-v021-n04-api-contract/1.0",
  ...common,
  status: "PASS",
  paths: {
    capabilities: "NEGOTIATED_AND_RESPONSE_VALIDATED",
    synchronousGrounding: "NEGOTIATED_11_EXTENSION_OR_EXACT_LEGACY",
    asynchronousGrounding: "SELECTION_PERSISTED_BEFORE_QUEUEING",
    persistedGet: "PRINCIPAL_SCOPE_ACTOR_AND_SELECTION_BOUND",
    cancellation: "PRINCIPAL_SCOPE_ACTOR_AND_SELECTION_BOUND_BEFORE_MUTATION"
  },
  invariants: [
    "AUTHENTICATION_PRECEDES_CONTRACT_NEGOTIATION",
    "BODY_AUTHORITY_SCAN_REMAINS_ACTIVE",
    "ONLY_ALLOWLISTED_PRINCIPALS_CAN_SELECT_1_1",
    "LEGACY_1_0_NEVER_RECEIVES_GEOSPATIAL_FINDINGS",
    "GET_AND_CANCEL_REQUIRE_EXACT_PERSISTED_SELECTION",
    "INVALID_INTERNAL_OUTPUT_FAILS_CLOSED_AS_BACKEND_CONTRACT_VIOLATION",
    "SYNCHRONOUS_ASYNCHRONOUS_AND_PERSISTED_PRESENTATIONS_SHARE_ONE_SCHEMA_SELECTION"
  ],
  failureCodes: {
    negotiation: ["WSGS_CONSUMER_CONTRACT_MISMATCH", "WSGS_GEOSPATIAL_PROFILE_UNSUPPORTED"],
    configuration: "WSGS_CONSUMER_CONTRACT_CONFIGURATION_INVALID",
    internalOutput: "BACKEND_CONTRACT_VIOLATION"
  },
  realRuntimeReceipt: {
    freshSynchronousPostHttpStatus: realExecution["freshSyncPostHttpStatus"],
    freshSynchronousGetHttpStatus: realExecution["freshSyncGetHttpStatus"],
    asynchronousPostHttpStatus: realExecution["asyncPostHttpStatus"],
    persistedGetHttpStatus: realExecution["persistedGetHttpStatus"],
    synchronousReplayHttpStatus: realExecution["syncReplayHttpStatus"],
    crossContractReadHttpStatus: negotiation["crossContractPersistedReadHttpStatus"],
    terminalStatus: realExecution["terminalStatus"],
    persistedContractSelectionVerified: realExecution["persistedContractSelectionVerified"],
    reportHash: runtimeReportHash
  }
};

const resultHashReport = {
  schemaVersion: "wsgs-v021-n04-result-hash/1.0",
  ...common,
  status: "PASS",
  resultSemantics: {
    geospatialExtensionIncludedInResultValue: true,
    geospatialExtensionIncludedInResultHash: true,
    resultHashFieldExcludedFromHashPreimage: true,
    executionElapsedMsExcludedFromHashPreimage: true,
    completeCanonicalResultBytesPersisted: true,
    persistedResultHashAndBytesReplayedWithoutProjection: true,
    maxResultBytesAppliedAfterExtensionAssembly: true,
    oversizedUpstreamInlinePayloadQuarantinedBeforeFindingDecode: true
  },
  immutableSelection: {
    persistedWithRequestMetadata: true,
    restoredByWorker: true,
    checkedBeforeSettlementValidation: true,
    checkedBeforeGetReplay: true,
    checkedBeforeCancellation: true,
    legacyRowsWithoutSelectionRemainLegacy: true
  },
  realRuntimeReceipt: {
    resultHash: realExecution["resultHash"],
    persistedResultBytesHash: realExecution["persistedResultBytesHash"],
    persistedBytesAndHashMatchGet: realExecution["persistedBytesAndHashMatchGet"],
    extensionIncludedInResultHash: realExecution["extensionIncludedInResultHash"],
    elapsedMsExcludedFromResultHash: realExecution["elapsedMsExcludedFromResultHash"],
    syncAndAsyncResultSemanticsMatch: realExecution["syncAndAsyncResultSemanticsMatch"],
    syncAndAsyncSemanticProjectionHash: realExecution["syncAndAsyncSemanticProjectionHash"],
    semanticProjectionIncludesGapsEvidenceAndSubjects:
      realExecution["semanticProjectionIncludesGapsEvidenceAndSubjects"],
    syncReplayAddedGatewayExecutions: realExecution["syncReplayAddedGatewayExecutions"],
    legacyGeospatialFindingsAbsent: legacyCompatibility["geospatialFindingsAbsent"],
    reportHash: runtimeReportHash
  }
};

const artifacts = [
  {
    logicalId: "N04_CAPABILITIES",
    path: "reports/sacs-geospatial-v1/N04-capabilities.json",
    content: stableJson(capabilitiesReport)
  },
  {
    logicalId: "N04_API_CONTRACT",
    path: "reports/sacs-geospatial-v1/N04-api-contract.json",
    content: stableJson(apiContractReport)
  },
  {
    logicalId: "N04_RESULT_HASH",
    path: "reports/sacs-geospatial-v1/N04-result-hash.json",
    content: stableJson(resultHashReport)
  }
] as const;

const evidenceHashes = Object.fromEntries(artifacts.map((artifact) => [artifact.logicalId, sha256(artifact.content)]));
const phaseReport = `# N04 Phase Report — API, Capabilities, and Result Extension Runtime Integration

Decision: **PASS for N04 source and qualified isolated-WSGS real runtime integration**

Marker: \`WSGS_V021_RESULT_EXTENSION_READY\`

G1: \`NOT_RUN\`

Qualified runtime source: \`${qualifiedRuntimeSourceSha}\`

Shared WSGS runtime: \`NOT_RUN\`

SACS v0.4 real E2E: \`0/18 NOT_RUN\`

productionQualified: \`false\`

## Contract decision

- \`sacs-wsgs-grounding/1.0\` remains byte-stable and never receives \`geospatialFindings\`.
- The allowlisted, explicitly negotiated \`sacs-wsgs-grounding/1.1\` path returns Profile \`sacs-wsgs-geospatial-findings/1.0\` through \`RESULT_EXTENSION\`.
- Duplicate or comma-joined negotiation headers fail closed. Request bodies, User-Agent, Accept, and source text do not select a contract.
- GET and cancel bind the authenticated principal, actor, data scope, and exact persisted contract selection.
- N05 \`RESOLVE_WORLD_SELECTION\` and N06 \`VALIDATE_SOURCE_CURRENTNESS\` remain unavailable, so 1.1 \`requiredCapabilitiesReady=false\` is intentional and truthful.

## Result integrity

- The complete Result, including the extension, is canonicalized before hashing and persistence.
- \`resultHash\` and nondeterministic \`execution.elapsedMs\` are excluded from the hash preimage.
- The final canonical Result bytes are checked against \`maxResultBytes\`; oversized upstream inline payloads are quarantined before Finding decoding.
- Persisted replay uses the immutable negotiated selection; a legacy request cannot retrieve or cancel a 1.1 presentation.

## Qualified real-runtime receipt

| Evidence | Result |
|---|---|
| Signed Gateway boundary | \`PASS\`; WSGS direct Provider calls = \`0\`; WSGS direct upstream database calls = \`0\` |
| Fresh synchronous POST / persisted GET | \`${realExecution["freshSyncPostHttpStatus"]}\` / \`${realExecution["freshSyncGetHttpStatus"]}\` |
| Asynchronous POST / persisted GET | \`${realExecution["asyncPostHttpStatus"]}\` / \`${realExecution["persistedGetHttpStatus"]}\` |
| Synchronous idempotent replay | HTTP \`${realExecution["syncReplayHttpStatus"]}\`; additional Gateway executions = \`${realExecution["syncReplayAddedGatewayExecutions"]}\` |
| Terminal result | \`${realExecution["terminalStatus"]}\`; extension findings/source products/evidence/subjects = \`${realExecution["findingCount"]}/${realExecution["sourceProductCount"]}/${realExecution["evidenceItemCount"]}/${realExecution["subjectReferenceCount"]}\` |
| Persisted bytes and Result hash | \`PASS\`; extension included and elapsedMs excluded |
| Legacy 1.0 compatibility | \`${legacyCompatibility["terminalStatus"]}\`; unnegotiated \`geospatialFindings\` absent |
| Cross-contract persisted read | HTTP \`${negotiation["crossContractPersistedReadHttpStatus"]}\` fail-closed |

The repository has no unified machine-readable focused-test receipt consumed by this generator. Source gates are content-hash locked, but no unit or integration case count is inferred or claimed here. N04 readiness is conditional on the separately generated real-runtime report passing strict field, source-commit, source-tree, source-input, and canonical report-hash validation.

## Evidence hashes

${Object.entries(evidenceHashes).map(([logicalId, hash]) => `- \`${logicalId}\`: \`${hash}\``).join("\n")}

Input-set hash: \`${inputSetHash}\`.

Real-runtime report hash: \`${runtimeReportHash}\`.

Real-runtime report file hash: \`${runtimeReportFileHash}\`.

## Qualification boundary

- This phase does not claim G1, SACS 18-case execution, consumer compatibility, or shared-runtime qualification.
- No shared instance was modified or restarted.
- No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
`;

for (const artifact of artifacts) materialize(artifact.path, artifact.content);
materialize("reports/sacs-geospatial-v1/N04-phase-report.md", phaseReport);

process.stdout.write(
  `${JSON.stringify({
    marker: "WSGS_V021_RESULT_EXTENSION_READY",
    qualifiedRuntimeSourceSha,
    inputSetHash,
    runtimeReportFileHash,
    runtimeReportHash,
    runtime: "PASS_ISOLATED_WSGS_SIGNED_GATEWAY",
    sharedWsgsRuntime: "NOT_RUN",
    sacsV04RealE2E: "NOT_RUN",
    g1: "NOT_RUN",
    productionQualified: false
  })}\n`
);
