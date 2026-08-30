import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createGroundingIdentity } from "@wsgs/delegated-identity";
import {
  Aes256GcmPayloadCodec,
  GroundingPipeline,
  PostgresPipelineJournal,
  canonicalSha256,
  type PipelineStage,
  type PipelineStageContext,
  type PipelineStageExecutor
} from "@wsgs/grounding-pipeline";
import { applyMigrations } from "@wsgs/runtime";
import { Pool } from "pg";

import { createGroundingApi } from "../../services/grounding-api/src/server.js";
import { createProductionBackendFromEnvironment } from "../../services/grounding-api/src/production.js";
import {
  captureAdmissionSnapshot,
  checkReadiness,
  checkReadinessForCurrentEnvironment,
  createPipelineStageExecutor
} from "../../services/grounding-worker/src/production-module.js";
import { productionPipelinePolicyFromEnvironment } from "../../services/grounding-worker/src/pipeline-policy.js";
import { PostgresGroundingWorkerStore } from "../../services/grounding-worker/src/postgres-store.js";
import { GroundingWorker } from "../../services/grounding-worker/src/worker.js";

type JsonObject = Record<string, unknown>;

if (process.env["ALLOW_REAL_DEVELOPMENT_PIPELINE_GATE"] !== "YES") {
  throw new Error("Set ALLOW_REAL_DEVELOPMENT_PIPELINE_GATE=YES to run real development dependencies");
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function list(name: string): string[] {
  return required(name).split(/[ ,]+/u).map((entry) => entry.trim()).filter(Boolean);
}

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonObject;
}

function string(value: unknown, code: string): string {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function safeId(value: string): `sha256:${string}` {
  return sha256(value);
}

function loadSchemas(): Record<string, unknown> {
  const directory = resolve(process.cwd(), "contracts", "wsgs-v0.1", "contracts");
  return Object.fromEntries(readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name, JSON.parse(readFileSync(resolve(directory, name), "utf8")) as unknown]));
}

function referenceMap(): JsonObject[] {
  const directory = required("GOWM_SAMPLE_HANDOFF_DIR");
  const value = JSON.parse(readFileSync(resolve(directory, "SAMPLE_REFERENCE_MAP.json"), "utf8")) as JsonObject;
  if (!Array.isArray(value["entries"])) throw new Error("SAMPLE_REFERENCE_MAP_INVALID");
  return value["entries"].map((entry) => object(entry, "SAMPLE_REFERENCE_ENTRY_INVALID"));
}

function visibleReference(fixtureKey: string, field: "currentWorldReferenceKey" | "currentCatalogReferenceKey"): JsonObject {
  const entry = referenceMap().find((candidate) => candidate["fixtureKey"] === fixtureKey);
  if (!entry || entry["scope"] !== "wsgs-demo") throw new Error("VISIBLE_SAMPLE_REFERENCE_MISSING");
  return object(entry[field], "VISIBLE_SAMPLE_REFERENCE_KEY_MISSING");
}

const sourceCommit = required("WSGS_EVIDENCE_SOURCE_COMMIT");
if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error("WSGS_EVIDENCE_SOURCE_COMMIT_INVALID");
const gateRunId = process.env["WSGS_GATE_RUN_ID"]?.trim() || sourceCommit.slice(0, 12);
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{5,63}$/u.test(gateRunId)) throw new Error("WSGS_GATE_RUN_ID_INVALID");
const databaseUrl = required("DATABASE_URL");
const evidenceDirectory = resolve(process.env["WSGS_DEVELOPMENT_EVIDENCE_DIR"] ?? "reports/wsgs-v0.2");
const recipeEvidenceDirectory = resolve(evidenceDirectory, "recipe-evidence");
const encryptionKey = required("WSGS_REQUEST_ENCRYPTION_KEY_BASE64");
const payloadCodec = Aes256GcmPayloadCodec.fromBase64(encryptionKey);
const identity = createGroundingIdentity({
  servicePrincipalId: required("GOWM_DELEGATION_SERVICE_PRINCIPAL_ID"),
  actorId: required("WSGS_READINESS_ACTOR_ID"),
  dataScopes: [required("WSGS_READINESS_DATA_SCOPE")],
  datasetScopes: list("WSGS_READINESS_DATASET_SCOPES"),
  permissions: [...new Set([...list("WSGS_READINESS_PERMISSIONS"), "grounding.read"])]
});

interface CaseEvidence {
  recipeId: string;
  requestHash: `sha256:${string}`;
  groundingIdHash: `sha256:${string}`;
  terminalStatus: string;
  resultHash: `sha256:${string}`;
  stageHashes: `sha256:${string}`[];
  completedStages: string[];
  planHashes: `sha256:${string}`[];
  upstreamResultHashes: `sha256:${string}`[];
  modelReceiptCount: number;
  worldQueryCount: number;
  spatialExecutionCount: number;
  operationKeys: string[];
  operationStatuses: Array<{ operationKey: string; status: string; resultHash?: `sha256:${string}` }>;
  normalizedStatuses: string[];
  gatewayQueryIdHashes: `sha256:${string}`[];
  gatewayJobIdHashes: `sha256:${string}`[];
  productIds: string[];
  contentHashes: string[];
  selectedRecipeIds: string[];
  descriptorIds: string[];
  semanticCodes: string[];
  truncated: boolean;
  totalStageElapsedMs: number;
}

interface GdpsCaseDefinition {
  id: string;
  message: string;
  expectedStatus: string;
  expectedPattern?: string;
  expectedDescriptor?: string;
  expectedOperations?: string[];
  expectedExplicitProductId?: string;
  expectedSemanticCode?: string;
  precondition?: string;
  mustNotExecuteGdps?: boolean;
  mustNotInferFalse?: boolean;
  mustNotExecuteOriginalQuery?: boolean;
  legacyTargetOperation?: string;
  legacyAcceptedOperationStatuses?: readonly string[];
}

interface GdpsCaseSuite {
  mode: "DISABLED" | "LEGACY_V02" | "GDPS_V021_FROZEN_CORPUS";
  cases: GdpsCaseDefinition[];
  totalCaseCount: number;
  selectedCaseCount: number;
  fullCorpusSelected: boolean;
  corpusHash?: `sha256:${string}`;
}

const terminalGroundingStatuses = new Set([
  "COMPLETED", "PARTIAL", "AMBIGUOUS", "UNRESOLVED", "FAILED", "CANCELLED"
]);
const frozenGdpsV021CorpusHash = "sha256:b9717b9af929fbd82bf0509f9648379aae601a8a0f567ce1d520ad970a8f6525";
const frozenGdpsV021CaseIds = [
  "E2E-SLOPE-POINT", "E2E-SLOPE-RANGE", "E2E-FLOOD-HIGH", "E2E-DRAINAGE-NEARBY",
  "E2E-HIGH-GROUND", "E2E-WETLAND", "E2E-LAND-COVER", "E2E-TRAVERSABILITY-EXPLAIN",
  "E2E-EXPLICIT-PRODUCT", "NEG-DESCRIPTOR-GAP", "NEG-DATA-GAP", "NEG-REFERENCE-AMBIGUITY",
  "NEG-UNIT-MISMATCH", "NEG-RECIPE-DRIFT", "NEG-TRUNCATED", "NEG-CURRENTNESS"
] as const;
const legacyGdpsCases: GdpsCaseDefinition[] = [
  { id: "E2E-01", message: "2号车位置的地表覆盖是什么？", expectedStatus: "COMPLETED",
    legacyTargetOperation: "landcover.get-class@1.0", legacyAcceptedOperationStatuses: ["COMPLETED", "PARTIAL"] },
  { id: "E2E-02", message: "A区内有哪些湿地？", expectedStatus: "COMPLETED",
    legacyTargetOperation: "hydrology.find-wetlands@1.0", legacyAcceptedOperationStatuses: ["COMPLETED", "PARTIAL"] },
  { id: "E2E-03", message: "2号车附近500米有哪些障碍物？", expectedStatus: "COMPLETED",
    legacyTargetOperation: "obstacle.find-nearby@1.0", legacyAcceptedOperationStatuses: ["COMPLETED", "PARTIAL", "NO_DATA"] },
  { id: "E2E-04", message: "A区内有哪些不可通行区域？", expectedStatus: "COMPLETED",
    legacyTargetOperation: "traversability.find-blocked@1.0", legacyAcceptedOperationStatuses: ["COMPLETED", "PARTIAL"] },
  { id: "E2E-05", message: "A区内有哪些高地？", expectedStatus: "COMPLETED",
    legacyTargetOperation: "terrain.find-high-ground@1.0", legacyAcceptedOperationStatuses: ["COMPLETED", "PARTIAL"] },
  { id: "E2E-06", message: "2号车位置的高程是多少？", expectedStatus: "COMPLETED",
    legacyTargetOperation: "elevation.sample@1.0", legacyAcceptedOperationStatuses: ["COMPLETED", "PARTIAL"] },
  { id: "E2E-07", message: "为什么2号车当前位置的通行性受限？", expectedStatus: "COMPLETED",
    legacyTargetOperation: "traversability.explain@1.0", legacyAcceptedOperationStatuses: ["COMPLETED", "PARTIAL"] }
];

function optionalString(value: unknown, code: string): string | undefined {
  if (value === undefined) return undefined;
  return string(value, code);
}

function optionalBoolean(value: unknown, code: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(code);
  return value;
}

function optionalStrings(value: unknown, code: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || !value.every((entry) => typeof entry === "string" && entry)) {
    throw new Error(code);
  }
  return [...value];
}

function loadFrozenGdpsCaseSuite(): GdpsCaseSuite {
  if (process.env["WSGS_RUN_GDPS_INTEGRATION_CASES"] !== "YES") {
    return { mode: "DISABLED", cases: [], totalCaseCount: 0, selectedCaseCount: 0, fullCorpusSelected: false };
  }
  const requestedCase = process.env["WSGS_GDPS_CASE_ID"]?.trim();
  const configuredCorpus = process.env["WSGS_GDPS_E2E_CORPUS_FILE"]?.trim();
  if (!configuredCorpus) {
    const selected = requestedCase ? legacyGdpsCases.filter((entry) => entry.id === requestedCase) : legacyGdpsCases;
    if (selected.length === 0) throw new Error(`UNKNOWN_GDPS_CASE_${requestedCase}`);
    return {
      mode: "LEGACY_V02",
      cases: selected,
      totalCaseCount: legacyGdpsCases.length,
      selectedCaseCount: selected.length,
      fullCorpusSelected: !requestedCase
    };
  }
  const frozenPath = resolve(process.cwd(), "config", "gdps-e2e-corpus.json");
  if (resolve(configuredCorpus) !== frozenPath) throw new Error("GDPS_E2E_CORPUS_PATH_NOT_FROZEN");
  const bytes = readFileSync(frozenPath);
  let value: JsonObject;
  try {
    value = object(JSON.parse(bytes.toString("utf8")) as unknown, "GDPS_E2E_CORPUS_INVALID");
  } catch {
    throw new Error("GDPS_E2E_CORPUS_INVALID");
  }
  if (value["schemaVersion"] !== "wsgs-gdps-e2e-corpus/2.0" ||
      value["requiredExecutionPath"] !== "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" ||
      !Array.isArray(value["cases"]) || value["cases"].length !== 16) {
    throw new Error("GDPS_E2E_CORPUS_CONTRACT_INVALID");
  }
  if (sha256(bytes) !== frozenGdpsV021CorpusHash) throw new Error("GDPS_E2E_CORPUS_HASH_DRIFT");
  const cases = value["cases"].map((entry, index): GdpsCaseDefinition => {
    const item = object(entry, `GDPS_E2E_CASE_${index + 1}_INVALID`);
    const definition: GdpsCaseDefinition = {
      id: string(item["id"], `GDPS_E2E_CASE_${index + 1}_ID_INVALID`),
      message: string(item["message"], `GDPS_E2E_CASE_${index + 1}_MESSAGE_INVALID`),
      expectedStatus: string(item["expectedStatus"], `GDPS_E2E_CASE_${index + 1}_STATUS_INVALID`)
    };
    const expectedPattern = optionalString(item["expectedPattern"], `GDPS_E2E_CASE_${index + 1}_PATTERN_INVALID`);
    const expectedDescriptor = optionalString(item["expectedDescriptor"], `GDPS_E2E_CASE_${index + 1}_DESCRIPTOR_INVALID`);
    const expectedOperations = optionalStrings(item["expectedOperations"], `GDPS_E2E_CASE_${index + 1}_OPERATIONS_INVALID`);
    const expectedExplicitProductId = optionalString(item["expectedExplicitProductId"], `GDPS_E2E_CASE_${index + 1}_PRODUCT_INVALID`);
    const expectedSemanticCode = optionalString(item["expectedSemanticCode"], `GDPS_E2E_CASE_${index + 1}_SEMANTIC_CODE_INVALID`);
    const precondition = optionalString(item["precondition"], `GDPS_E2E_CASE_${index + 1}_PRECONDITION_INVALID`);
    const mustNotExecuteGdps = optionalBoolean(item["mustNotExecuteGdps"], `GDPS_E2E_CASE_${index + 1}_EXECUTION_POLICY_INVALID`);
    const mustNotInferFalse = optionalBoolean(item["mustNotInferFalse"], `GDPS_E2E_CASE_${index + 1}_INFERENCE_POLICY_INVALID`);
    const mustNotExecuteOriginalQuery = optionalBoolean(item["mustNotExecuteOriginalQuery"], `GDPS_E2E_CASE_${index + 1}_REPLAY_POLICY_INVALID`);
    return {
      ...definition,
      ...(expectedPattern ? { expectedPattern } : {}),
      ...(expectedDescriptor ? { expectedDescriptor } : {}),
      ...(expectedOperations ? { expectedOperations } : {}),
      ...(expectedExplicitProductId ? { expectedExplicitProductId } : {}),
      ...(expectedSemanticCode ? { expectedSemanticCode } : {}),
      ...(precondition ? { precondition } : {}),
      ...(mustNotExecuteGdps !== undefined ? { mustNotExecuteGdps } : {}),
      ...(mustNotInferFalse !== undefined ? { mustNotInferFalse } : {}),
      ...(mustNotExecuteOriginalQuery !== undefined ? { mustNotExecuteOriginalQuery } : {})
    };
  });
  assertExactStrings(cases.map((entry) => entry.id), frozenGdpsV021CaseIds, "GDPS_E2E_CORPUS_CASE_SET_DRIFT");
  const selected = requestedCase ? cases.filter((entry) => entry.id === requestedCase) : cases;
  if (selected.length === 0) throw new Error(`UNKNOWN_GDPS_CASE_${requestedCase}`);
  const unsupportedPreconditions = selected.filter((entry) => entry.precondition).map((entry) => entry.id);
  if (unsupportedPreconditions.length > 0) {
    throw new Error(`GDPS_E2E_PRECONDITION_DRIVER_NOT_READY_${unsupportedPreconditions.join("_")}`);
  }
  return {
    mode: "GDPS_V021_FROZEN_CORPUS",
    cases: selected,
    totalCaseCount: cases.length,
    selectedCaseCount: selected.length,
    fullCorpusSelected: !requestedCase,
    corpusHash: sha256(bytes)
  };
}

interface GdpsRuntimeExpectations {
  operationByPattern: Map<string, string>;
  gdpsOperationKeys: Set<string>;
}

function loadGdpsRuntimeExpectations(suite: GdpsCaseSuite): GdpsRuntimeExpectations {
  if (suite.mode !== "GDPS_V021_FROZEN_CORPUS") {
    return { operationByPattern: new Map(), gdpsOperationKeys: new Set() };
  }
  const path = required("WSGS_GDPS_RECIPE_LOCK_FILE");
  let value: JsonObject;
  try {
    value = object(JSON.parse(readFileSync(path, "utf8")) as unknown, "GDPS_RUNTIME_RECIPE_LOCK_INVALID");
  } catch {
    throw new Error("GDPS_RUNTIME_RECIPE_LOCK_INVALID");
  }
  if (value["schemaVersion"] !== "wsgs-gdps-recipe-lock/2.0" ||
      !Array.isArray(value["recipes"]) || value["recipes"].length !== 14) {
    throw new Error("GDPS_RUNTIME_RECIPE_LOCK_CONTRACT_INVALID");
  }
  const operationByPattern = new Map<string, string>();
  for (const entry of value["recipes"]) {
    const recipe = object(entry, "GDPS_RUNTIME_RECIPE_INVALID");
    const pattern = string(recipe["semanticPattern"], "GDPS_RUNTIME_RECIPE_PATTERN_INVALID");
    const operations = recipe["allowedOperations"];
    if (!Array.isArray(operations) || operations.length !== 1) {
      throw new Error(`GDPS_RUNTIME_RECIPE_OPERATION_INVALID_${pattern}`);
    }
    const operation = object(operations[0], `GDPS_RUNTIME_RECIPE_OPERATION_INVALID_${pattern}`);
    const key = `${string(operation["operationId"], "GDPS_RUNTIME_OPERATION_ID_INVALID")}@${
      string(operation["operationVersion"], "GDPS_RUNTIME_OPERATION_VERSION_INVALID")}`;
    if (operationByPattern.has(pattern)) throw new Error(`GDPS_RUNTIME_RECIPE_DUPLICATE_${pattern}`);
    operationByPattern.set(pattern, key);
  }
  for (const definition of suite.cases) {
    if (definition.expectedPattern && !operationByPattern.has(definition.expectedPattern)) {
      throw new Error(`GDPS_EXPECTED_RECIPE_NOT_LOCKED_${definition.id}`);
    }
  }
  let snapshot: JsonObject;
  try {
    snapshot = object(JSON.parse(readFileSync(required("WSGS_GDPS_CONSUMER_SNAPSHOT_FILE"), "utf8")) as unknown,
      "GDPS_RUNTIME_CONSUMER_SNAPSHOT_INVALID");
  } catch {
    throw new Error("GDPS_RUNTIME_CONSUMER_SNAPSHOT_INVALID");
  }
  const capabilityKeys = snapshot["capabilityKeys"];
  if (snapshot["schemaVersion"] !== "wsgs-gdps-consumer-snapshot/2.0" ||
      !Array.isArray(capabilityKeys) || capabilityKeys.length !== 30 ||
      !capabilityKeys.every((entry) => typeof entry === "string" && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+@1\.0$/u.test(entry)) ||
      new Set(capabilityKeys).size !== 30) {
    throw new Error("GDPS_RUNTIME_CONSUMER_SNAPSHOT_CONTRACT_INVALID");
  }
  return { operationByPattern, gdpsOperationKeys: new Set(capabilityKeys) };
}

function acceptedTerminalStatuses(definition: GdpsCaseDefinition, suite: GdpsCaseSuite): readonly string[] {
  if (suite.mode === "LEGACY_V02") return ["COMPLETED", "PARTIAL", "UNRESOLVED"];
  return terminalGroundingStatuses.has(definition.expectedStatus)
    ? [definition.expectedStatus]
    : ["COMPLETED", "PARTIAL", "AMBIGUOUS", "UNRESOLVED"];
}

function assertExactStrings(actual: readonly string[], expected: readonly string[], code: string): void {
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    throw new Error(code);
  }
}

function expectedOperationChain(definition: GdpsCaseDefinition): string[] | undefined {
  if (definition.expectedOperations) return definition.expectedOperations;
  if (definition.id === "E2E-EXPLICIT-PRODUCT") {
    return ["reference.resolve", "world.get-geometry", "geo-raster.find-by-range"];
  }
  return undefined;
}

function validateGdpsCaseEvidence(
  definition: GdpsCaseDefinition,
  evidence: CaseEvidence,
  suite: GdpsCaseSuite,
  runtime: GdpsRuntimeExpectations
): void {
  if (suite.mode === "LEGACY_V02") {
    const target = evidence.operationStatuses.find((entry) => entry.operationKey === definition.legacyTargetOperation);
    if (!target) throw new Error(`GDPS_OPERATION_NOT_EXECUTED_${definition.id}`);
    if (!definition.legacyAcceptedOperationStatuses?.includes(target.status)) {
      throw new Error(`GDPS_OPERATION_STATUS_${definition.id}_${target.status}`);
    }
    return;
  }
  if (terminalGroundingStatuses.has(definition.expectedStatus)) {
    if (evidence.terminalStatus !== definition.expectedStatus) {
      throw new Error(`GDPS_TERMINAL_STATUS_${definition.id}_${evidence.terminalStatus}`);
    }
  } else if (!evidence.normalizedStatuses.includes(definition.expectedStatus)) {
    throw new Error(`GDPS_NORMALIZED_STATUS_${definition.id}_${definition.expectedStatus}`);
  }
  if (definition.expectedPattern) {
    const selectedGdpsPatterns = evidence.selectedRecipeIds
      .filter((entry) => runtime.operationByPattern.has(entry));
    assertExactStrings(selectedGdpsPatterns, [definition.expectedPattern],
      `GDPS_RECIPE_SELECTION_${definition.id}_${definition.expectedPattern}`);
  }
  let targetOperation = definition.expectedPattern
    ? runtime.operationByPattern.get(definition.expectedPattern)
    : undefined;
  const operationChain = expectedOperationChain(definition);
  if (operationChain) {
    assertExactStrings(
      evidence.operationKeys,
      operationChain.map((operationId) => `${operationId}@1.0`),
      `GDPS_OPERATION_CHAIN_${definition.id}`
    );
    targetOperation ??= `${operationChain.at(-1)}@1.0`;
  } else if (definition.expectedPattern && !definition.mustNotExecuteGdps) {
    if (!targetOperation || !evidence.operationKeys.includes(targetOperation)) {
      throw new Error(`GDPS_TARGET_OPERATION_NOT_EXECUTED_${definition.id}`);
    }
  }
  if (targetOperation && ["COMPLETED", "PARTIAL"].includes(definition.expectedStatus)) {
    const targetStatus = evidence.operationStatuses.find((entry) => entry.operationKey === targetOperation)?.status;
    if (targetStatus !== definition.expectedStatus) {
      throw new Error(`GDPS_TARGET_OPERATION_STATUS_${definition.id}_${targetStatus ?? "MISSING"}`);
    }
  }
  if (definition.expectedDescriptor && !evidence.descriptorIds.includes(definition.expectedDescriptor)) {
    throw new Error(`GDPS_DESCRIPTOR_NOT_OBSERVED_${definition.id}`);
  }
  if (definition.expectedExplicitProductId && !evidence.productIds.includes(definition.expectedExplicitProductId)) {
    throw new Error(`GDPS_EXPLICIT_PRODUCT_NOT_OBSERVED_${definition.id}`);
  }
  if (definition.expectedSemanticCode && !evidence.semanticCodes.includes(definition.expectedSemanticCode)) {
    throw new Error(`GDPS_SEMANTIC_CODE_NOT_OBSERVED_${definition.id}_${definition.expectedSemanticCode}`);
  }
  const executedGdpsOperations = evidence.operationKeys.filter((key) => runtime.gdpsOperationKeys.has(key));
  if (definition.mustNotExecuteGdps && executedGdpsOperations.length > 0) {
    throw new Error(`GDPS_FORBIDDEN_OPERATION_EXECUTED_${definition.id}`);
  }
  if (definition.mustNotExecuteOriginalQuery && evidence.operationKeys.includes("geo-raster.find-by-range@1.0")) {
    throw new Error(`GDPS_ORIGINAL_QUERY_REEXECUTED_${definition.id}`);
  }
  if (definition.mustNotInferFalse && evidence.terminalStatus === "COMPLETED") {
    throw new Error(`GDPS_FALSE_FACT_INFERENCE_NOT_BLOCKED_${definition.id}`);
  }
  if (definition.id === "NEG-TRUNCATED" && !evidence.truncated) {
    throw new Error("GDPS_TRUNCATION_NOT_OBSERVED_NEG-TRUNCATED");
  }
  if (definition.id === "NEG-TRUNCATED" && !evidence.operationStatuses.some((entry) =>
    runtime.gdpsOperationKeys.has(entry.operationKey) && entry.status === "PARTIAL")) {
    throw new Error("GDPS_TRUNCATED_OPERATION_STATUS_NOT_PARTIAL");
  }
}

const pool = new Pool({ connectionString: databaseUrl, max: 12, application_name: "wsgs-development-closure-gate" });
let resources: ReturnType<typeof createProductionBackendFromEnvironment> | undefined;
let app: Awaited<ReturnType<typeof createGroundingApi>> | undefined;
let exitCode = 1;

async function resetDatabase(): Promise<void> {
  await applyMigrations(pool, resolve(process.cwd(), "database", "migrations"));
  await pool.query(`TRUNCATE TABLE
    wsgs.pipeline_event, wsgs.pipeline_checkpoint, wsgs.gowm_execution,
    wsgs.model_receipt, wsgs.capability_snapshot, wsgs.result_product,
    wsgs.grounding_result, wsgs.world_query, wsgs.grounding_graph,
    wsgs.semantic_frame, wsgs.idempotency, wsgs.grounding_job,
    wsgs.grounding_request CASCADE`);
}

function requestBody(
  caseId: string,
  text: string,
  operation: "GROUND_REFERENCES" | "VALIDATE_REFERENCES" | "EXECUTE_WORLD_QUERY",
  requestedProducts: string[],
  knownWorldReferences: JsonObject[] = [],
  maxResultBytes = 1_048_576
): JsonObject {
  const requestId = `development-${caseId.toLowerCase()}-${gateRunId}`;
  return {
    schemaVersion: "1.0",
    requestId,
    operation,
    source: {
      conversationRef: `conversation-${caseId.toLowerCase()}`,
      messageId: `message-${caseId.toLowerCase()}`,
      originalText: text,
      originalTextSha256: sha256(text),
      locale: "zh-CN",
      createdAt: new Date().toISOString()
    },
    requestedProducts,
    contextCapsule: {
      knownWorldReferences,
      priorGroundings: [],
      mapSelections: [],
      externalCorrelationHints: [],
      externalPredicates: []
    },
    executionPolicy: {
      readOnly: true,
      deadlineMs: 120_000,
      maxQueryOperations: 16,
      maxCandidatesPerMention: 20,
      maxResultBytes,
      allowApproximation: false
    }
  };
}

function worker(executor: PipelineStageExecutor, workerId: string): GroundingWorker {
  return new GroundingWorker({
    workerId,
    store: new PostgresGroundingWorkerStore(pool, payloadCodec),
    pipeline: new GroundingPipeline({
      executor,
      journal: new PostgresPipelineJournal(pool, payloadCodec),
      policy: productionPipelinePolicyFromEnvironment()
    }),
    leaseMs: 5_000,
    heartbeatMs: 500,
    pollIntervalMs: 10,
    concurrency: 1,
    maxJobAttempts: 3,
    retryBackoffMs: 0
  });
}

async function fetchJson(baseUrl: string, path: string, init?: RequestInit): Promise<{ status: number; body: JsonObject }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: object(await response.json(), "API_RESPONSE_INVALID") };
}

function collectNamedStrings(value: unknown, names: ReadonlySet<string>, found = new Map<string, Set<string>>()): Map<string, Set<string>> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectNamedStrings(entry, names, found));
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, entry] of Object.entries(value as JsonObject)) {
    if (names.has(key) && typeof entry === "string") {
      const values = found.get(key) ?? new Set<string>();
      values.add(entry);
      found.set(key, values);
    }
    collectNamedStrings(entry, names, found);
  }
  return found;
}

async function collect(
  groundingId: string,
  requestHash: `sha256:${string}`,
  terminalResult: JsonObject
): Promise<CaseEvidence> {
  const job = await pool.query<{ job_id: string; run_fingerprint: string | null }>(
    `SELECT job.job_id, checkpoint.run_fingerprint
       FROM wsgs.grounding_job AS job
       LEFT JOIN wsgs.pipeline_checkpoint AS checkpoint ON checkpoint.job_id = job.job_id
      WHERE job.grounding_id = $1`,
    [groundingId]
  );
  if (!job.rows[0]) throw new Error("GROUNDING_JOB_MISSING");
  const events = await pool.query<{
    stage: string; status: string; output_hash: `sha256:${string}` | null;
    record_hash: `sha256:${string}`; elapsed_ms: number;
  }>(
    `SELECT stage, status, output_hash, record_hash, elapsed_ms
       FROM wsgs.pipeline_event WHERE grounding_id = $1 ORDER BY event_id`,
    [groundingId]
  );
  const terminalEvents = events.rows.filter((event) => event.status !== "STARTED");
  const queries = await pool.query<{
    plan_hash: `sha256:${string}`; upstream_result_hash: `sha256:${string}` | null;
  }>(
    "SELECT plan_hash, upstream_result_hash FROM wsgs.world_query WHERE grounding_id = $1 ORDER BY query_id",
    [groundingId]
  );
  const executions = await pool.query<{
    operation_id: string | null; operation_version: string | null;
    result_hash: `sha256:${string}` | null; normalized_status: string;
    gateway_query_id: string | null; gateway_job_id: string | null;
  }>(
    `SELECT operation_id, operation_version, result_hash, normalized_status, gateway_query_id, gateway_job_id
       FROM wsgs.gowm_execution WHERE grounding_id = $1 ORDER BY execution_id`,
    [groundingId]
  );
  const model = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM wsgs.model_receipt WHERE grounding_id = $1",
    [groundingId]
  );
  const result = await pool.query<{ status: string; result_hash: `sha256:${string}` }>(
    "SELECT status, result_hash FROM wsgs.grounding_result WHERE grounding_id = $1",
    [groundingId]
  );
  const resultRow = result.rows[0];
  if (!resultRow) throw new Error("GROUNDING_RESULT_MISSING");
  const named = collectNamedStrings(terminalResult, new Set(["productId", "contentHash"]));
  const checkpointRow = job.rows[0];
  const checkpoint = checkpointRow?.run_fingerprint
    ? await new PostgresPipelineJournal(pool, payloadCodec)
      .loadLatestCheckpoint(checkpointRow.job_id, checkpointRow.run_fingerprint)
    : null;
  if (!checkpoint) throw new Error("PIPELINE_CHECKPOINT_EVIDENCE_MISSING");
  const planning = checkpoint.state["REQUIREMENT_PLAN"];
  const selectedRecipeIds = planning && typeof planning === "object" && !Array.isArray(planning) &&
    Array.isArray((planning as JsonObject)["selectedRecipeIds"])
    ? (planning as JsonObject)["selectedRecipeIds"].filter((entry): entry is string => typeof entry === "string")
    : [];
  const checkpointNamed = collectNamedStrings(checkpoint.state, new Set(["descriptorId"]));
  const capabilityGaps = Array.isArray(terminalResult["capabilityGaps"])
    ? terminalResult["capabilityGaps"]
    : [];
  const semanticCodes = capabilityGaps.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const gap = entry as JsonObject;
    const details = gap["details"] && typeof gap["details"] === "object" && !Array.isArray(gap["details"])
      ? gap["details"] as JsonObject
      : undefined;
    return [gap["reason"], details?.["code"]]
      .filter((value): value is string => typeof value === "string" && value.length > 0);
  });
  const serializedResult = JSON.stringify(terminalResult);
  return {
    recipeId: "",
    requestHash,
    groundingIdHash: safeId(groundingId),
    terminalStatus: resultRow.status,
    resultHash: resultRow.result_hash,
    stageHashes: terminalEvents.map((event) => event.output_hash ?? event.record_hash),
    completedStages: terminalEvents.filter((event) => ["COMPLETED", "PARTIAL"].includes(event.status)).map((event) => event.stage),
    planHashes: queries.rows.map((row) => row.plan_hash),
    upstreamResultHashes: queries.rows.flatMap((row) => row.upstream_result_hash ? [row.upstream_result_hash] : []),
    modelReceiptCount: Number(model.rows[0]?.count ?? 0),
    worldQueryCount: queries.rowCount ?? 0,
    spatialExecutionCount: executions.rows.filter((row) => row.operation_id?.startsWith("spatial.")).length,
    operationKeys: [...new Set(executions.rows.flatMap((row) =>
      row.operation_id && row.operation_version ? [`${row.operation_id}@${row.operation_version}`] : []))],
    operationStatuses: executions.rows.flatMap((row) => row.operation_id && row.operation_version ? [{
      operationKey: `${row.operation_id}@${row.operation_version}`,
      status: row.normalized_status,
      ...(row.result_hash ? { resultHash: row.result_hash } : {})
    }] : []),
    normalizedStatuses: [...new Set(executions.rows.map((row) => row.normalized_status))],
    gatewayQueryIdHashes: [...new Set(executions.rows.flatMap((row) => row.gateway_query_id ? [safeId(row.gateway_query_id)] : []))],
    gatewayJobIdHashes: [...new Set(executions.rows.flatMap((row) => row.gateway_job_id ? [safeId(row.gateway_job_id)] : []))],
    productIds: [...(named.get("productId") ?? [])].sort(),
    contentHashes: [...(named.get("contentHash") ?? [])].filter((entry) => /^sha256:[0-9a-f]{64}$/u.test(entry)).sort(),
    selectedRecipeIds: [...new Set(selectedRecipeIds)].sort(),
    descriptorIds: [...(checkpointNamed.get("descriptorId") ?? [])].sort(),
    semanticCodes: [...new Set(semanticCodes)].sort(),
    truncated: serializedResult.includes('"truncated":true'),
    totalStageElapsedMs: terminalEvents.reduce((sum, event) => sum + event.elapsed_ms, 0)
  };
}

async function submitAndRun(
  baseUrl: string,
  executor: PipelineStageExecutor,
  recipeId: string,
  body: JsonObject,
  acceptedStatuses: readonly string[]
): Promise<CaseEvidence> {
  const requestHash = canonicalSha256(body) as `sha256:${string}`;
  const submitted = await fetchJson(baseUrl, "/v1/groundings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `development-${recipeId.toLowerCase()}-${requestHash.slice(-20)}`,
      prefer: "respond-async"
    },
    body: JSON.stringify(body)
  });
  if (submitted.status !== 202 || submitted.body["status"] !== "ACCEPTED") {
    const errorEnvelope = submitted.body["error"] && typeof submitted.body["error"] === "object" &&
      !Array.isArray(submitted.body["error"])
      ? submitted.body["error"] as JsonObject
      : submitted.body;
    const rawCode = typeof errorEnvelope["code"] === "string" ? errorEnvelope["code"] : "NO_ERROR_CODE";
    const safeCode = rawCode.toUpperCase().replace(/[^A-Z0-9_:-]+/gu, "_").slice(0, 96);
    throw new Error(`PUBLIC_API_SUBMIT_FAILED_${recipeId}_${submitted.status}_${safeCode}`);
  }
  const groundingId = string(submitted.body["groundingId"], "GROUNDING_ID_MISSING");
  const outcome = await worker(executor, `development-${recipeId.toLowerCase()}`).runOnce();
  if (outcome.kind !== "SUCCEEDED") {
    const diagnostic = await pool.query<{ job_code: string | null; stage: string | null; event_code: string | null }>(
      `SELECT job.error->>'code' AS job_code,
              event.stage,
              event.error_code AS event_code
         FROM wsgs.grounding_job AS job
         LEFT JOIN LATERAL (
           SELECT stage, error_code
             FROM wsgs.pipeline_event
            WHERE grounding_id = job.grounding_id AND error_code IS NOT NULL
            ORDER BY event_id DESC LIMIT 1
         ) AS event ON true
        WHERE job.grounding_id = $1`,
      [groundingId]
    );
    const detail = diagnostic.rows[0];
    throw new Error([
      "WORKER", recipeId, outcome.kind,
      detail?.stage ?? "NO_STAGE",
      detail?.event_code ?? detail?.job_code ?? "NO_ERROR_CODE"
    ].join("_"));
  }
  const fetched = await fetchJson(baseUrl, `/v1/groundings/${encodeURIComponent(groundingId)}`);
  if (fetched.status !== 200) throw new Error(`PUBLIC_API_GET_FAILED_${recipeId}_${fetched.status}`);
  const terminalStatus = string(fetched.body["status"], "GROUNDING_STATUS_MISSING");
  const terminalResult = object(fetched.body["result"], "GROUNDING_RESULT_MISSING");
  if (terminalResult["status"] !== terminalStatus) throw new Error(`GROUNDING_RESULT_STATUS_MISMATCH_${recipeId}`);
  if (!acceptedStatuses.includes(terminalStatus)) {
    const executionDiagnostic = await pool.query<{
      execution_kind: string;
      operation_id: string | null;
      upstream_status: string;
    }>(
      `SELECT execution_kind, operation_id, upstream_status
         FROM wsgs.gowm_execution
        WHERE grounding_id = $1
        ORDER BY execution_kind, operation_id NULLS FIRST, execution_id`,
      [groundingId]
    );
    const executionTrace = executionDiagnostic.rows.map((entry) => [
      entry.execution_kind,
      entry.operation_id ?? "QUERY",
      entry.upstream_status
    ].map((value) => value.toUpperCase().replace(/[^A-Z0-9@._-]+/gu, "-").slice(0, 96)).join("-")).join("--") || "NONE";
    const count = (name: string): number => Array.isArray(terminalResult[name]) ? terminalResult[name].length : 0;
    const capabilityGaps = Array.isArray(terminalResult["capabilityGaps"])
      ? terminalResult["capabilityGaps"]
      : [];
    const gapReasons = capabilityGaps
      .flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const reason = (entry as JsonObject)["reason"];
        return typeof reason === "string" ? [reason] : [];
      }).join("-") || "NONE";
    const firstGap = capabilityGaps.find((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) as JsonObject | undefined;
    const gapDetails = firstGap && firstGap["details"] && typeof firstGap["details"] === "object" && !Array.isArray(firstGap["details"])
      ? firstGap["details"] as JsonObject
      : undefined;
    const safeCode = (value: unknown): string => typeof value === "string"
      ? value.toUpperCase().replace(/[^A-Z0-9@._-]+/gu, "-").slice(0, 160) || "NONE"
      : "NONE";
    const allowedOperationKeys = Array.isArray(gapDetails?.["allowedOperationKeys"])
      ? gapDetails["allowedOperationKeys"].map(safeCode).join("-") || "NONE"
      : "NONE";
    throw new Error(
      `UNEXPECTED_TERMINAL_STATUS_${recipeId}_${terminalStatus}` +
      `_M${count("mentions")}_R${count("referenceProducts")}_U${count("unresolvedMentions")}` +
      `_A${count("ambiguities")}_G${count("capabilityGaps")}_${gapReasons}` +
      `_CAP_${safeCode(firstGap?.["semanticCapability"])}_DETAIL_${safeCode(gapDetails?.["code"])}` +
      `_ALLOWED_${allowedOperationKeys}_EXEC_${executionTrace}`
    );
  }
  const evidence = await collect(groundingId, requestHash, terminalResult);
  if (evidence.resultHash !== terminalResult["resultHash"]) throw new Error(`RESULT_HASH_MISMATCH_${recipeId}`);
  return { ...evidence, recipeId };
}

class RestartBarrierExecutor implements PipelineStageExecutor {
  readonly reached: Promise<void>;
  #releaseReached!: () => void;

  constructor(private readonly delegate: PipelineStageExecutor) {
    this.reached = new Promise((resolveReached) => { this.#releaseReached = resolveReached; });
  }

  async execute(stage: PipelineStage, context: PipelineStageContext): Promise<unknown> {
    if (stage !== "GOWM_EXECUTE") return this.delegate.execute(stage, context);
    this.#releaseReached();
    return await new Promise((_resolve, reject) => {
      const aborted = (): void => reject(context.signal.reason instanceof Error
        ? context.signal.reason
        : new Error("WORKER_RESTART_ABORTED"));
      if (context.signal.aborted) aborted();
      else context.signal.addEventListener("abort", aborted, { once: true });
    });
  }
}

async function recoveryCase(baseUrl: string, productionExecutor: PipelineStageExecutor): Promise<JsonObject> {
  const body = requestBody("RECOVERY", "2号车在哪里？", "EXECUTE_WORLD_QUERY", ["WORLD_EVIDENCE"]);
  const requestHash = canonicalSha256(body) as `sha256:${string}`;
  const submitted = await fetchJson(baseUrl, "/v1/groundings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `development-recovery-${requestHash.slice(-20)}`,
      prefer: "respond-async"
    },
    body: JSON.stringify(body)
  });
  if (submitted.status !== 202) throw new Error("RECOVERY_SUBMIT_FAILED");
  const groundingId = string(submitted.body["groundingId"], "RECOVERY_GROUNDING_ID_MISSING");
  const barrier = new RestartBarrierExecutor(productionExecutor);
  const firstWorker = worker(barrier, "development-restart-before-gowm");
  const firstRun = firstWorker.runOnce();
  await Promise.race([
    barrier.reached,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("RECOVERY_BARRIER_TIMEOUT")), 120_000))
  ]);
  const stopped = await firstWorker.stop(0);
  const firstOutcome = await firstRun;
  if (firstOutcome.kind !== "RETRY_SCHEDULED" || stopped.aborted !== 1) {
    throw new Error(`RECOVERY_FIRST_WORKER_${firstOutcome.kind}`);
  }
  const secondWorker = worker(productionExecutor, "development-restart-resume");
  let secondOutcome = await secondWorker.runOnce();
  for (let attempt = 0; secondOutcome.kind === "IDLE" && attempt < 20; attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    secondOutcome = await secondWorker.runOnce();
  }
  if (secondOutcome.kind !== "SUCCEEDED") throw new Error(`RECOVERY_SECOND_WORKER_${secondOutcome.kind}`);
  const events = await pool.query<{ stage: string; status: string; generation: number }>(
    "SELECT stage, status, generation FROM wsgs.pipeline_event WHERE grounding_id = $1 ORDER BY event_id",
    [groundingId]
  );
  const modelCompleted = events.rows.filter((event) => event.stage === "SEMANTIC_MODEL_PARSE" && event.status === "COMPLETED");
  const gowmCompleted = events.rows.filter((event) => event.stage === "GOWM_EXECUTE" && event.status === "COMPLETED");
  const generations = [...new Set(events.rows.map((event) => event.generation))];
  if (modelCompleted.length !== 1 || gowmCompleted.length !== 1 || generations.length !== 2) {
    throw new Error("RECOVERY_DUPLICATE_EXECUTION_OR_GENERATION_MISSING");
  }
  const fetched = await fetchJson(baseUrl, `/v1/groundings/${encodeURIComponent(groundingId)}`);
  if (fetched.status !== 200 || fetched.body["status"] !== "COMPLETED") throw new Error("RECOVERY_RESULT_MISSING");
  const terminalResult = object(fetched.body["result"], "RECOVERY_GROUNDING_RESULT_MISSING");
  if (terminalResult["status"] !== "COMPLETED") throw new Error("RECOVERY_RESULT_STATUS_MISMATCH");
  return {
    status: "PASS",
    groundingIdHash: safeId(groundingId),
    requestHash,
    generationCount: generations.length,
    modelCompletedCount: modelCompleted.length,
    gowmCompletedCount: gowmCompleted.length,
    resultHash: terminalResult["resultHash"]
  };
}

try {
  await resetDatabase();
  const productionExecutor = await createPipelineStageExecutor({ pool });
  resources = createProductionBackendFromEnvironment({
    readinessProbe: { checkReadiness, captureAdmissionSnapshot }
  });
  app = await createGroundingApi({
    auth: { mode: "STATIC_TRUSTED", identity },
    backend: resources.backend,
    schemas: loadSchemas(),
    logger: false
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("PUBLIC_API_ADDRESS_INVALID");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const live = await fetchJson(baseUrl, "/health/live");
  const ready = await fetchJson(baseUrl, "/health/ready");
  if (live.status !== 200 || live.body["status"] !== "live") throw new Error("CURRENT_LOCK_LIVENESS_FAILED");
  if (ready.status !== 200 || ready.body["status"] !== "ready") {
    const reasons = Array.isArray(ready.body["reasons"])
      ? ready.body["reasons"].filter((entry): entry is string => typeof entry === "string").join("_")
      : "NO_REASON";
    throw new Error(`CURRENT_LOCK_READINESS_FAILED_${ready.status}_${String(ready.body["status"])}_${reasons}`);
  }

  const vehicle = visibleReference("ugv-002", "currentWorldReferenceKey");
  const knownVehicle = {
    alias: "2号车",
    referenceKey: vehicle,
    referenceType: "WORLD_OBJECT",
    sourceMessageId: "message-known-vehicle"
  };
  const cases: CaseEvidence[] = [];
  const gdpsCaseIds = new Set<string>();
  const gdpsSuite = loadFrozenGdpsCaseSuite();
  const gdpsRuntime = loadGdpsRuntimeExpectations(gdpsSuite);
  const gdpsDefinitions = new Map(gdpsSuite.cases.map((entry) => [entry.id, entry]));
  for (const definition of gdpsSuite.cases) {
      gdpsCaseIds.add(definition.id);
      cases.push(await submitAndRun(baseUrl, productionExecutor, definition.id, requestBody(
        definition.id, definition.message, "EXECUTE_WORLD_QUERY", ["WORLD_EVIDENCE"]
      ), acceptedTerminalStatuses(definition, gdpsSuite)));
      const last = cases.at(-1)!;
      validateGdpsCaseEvidence(definition, last, gdpsSuite, gdpsRuntime);
  }

  cases.push(await submitAndRun(baseUrl, productionExecutor, "R1", requestBody(
    "R1", "2号车在哪里？", "EXECUTE_WORLD_QUERY", ["WORLD_EVIDENCE"]
  ), ["COMPLETED"]));
  cases.push(await submitAndRun(baseUrl, productionExecutor, "R2", requestBody(
    "R2", "滨河路附近有哪些车辆？", "EXECUTE_WORLD_QUERY", ["WORLD_EVIDENCE"]
  ), ["AMBIGUOUS"]));
  if (cases.at(-1)?.spatialExecutionCount !== 0 || cases.at(-1)?.worldQueryCount !== 0) {
    throw new Error("AMBIGUOUS_REFERENCE_DID_NOT_STOP_SPATIAL_EXECUTION");
  }
  cases.push(await submitAndRun(baseUrl, productionExecutor, "R3", requestBody(
    "R3", "A区内有哪些车辆？", "EXECUTE_WORLD_QUERY", ["WORLD_EVIDENCE"]
  ), ["COMPLETED"]));
  cases.push(await submitAndRun(baseUrl, productionExecutor, "R4", requestBody(
    "R4", "2号车附近1公里有什么？", "EXECUTE_WORLD_QUERY", ["WORLD_EVIDENCE"]
  ), ["COMPLETED"]));
  cases.push(await submitAndRun(baseUrl, productionExecutor, "R5", requestBody(
    "R5", "验证2号车当前有效性", "VALIDATE_REFERENCES", ["RESOLVED_REFERENCES"], [knownVehicle]
  ), ["COMPLETED"]));

  const savedModel = {
    policy: process.env["WSGS_MODEL_POLICY"],
    baseUrl: process.env["MODEL_BASE_URL"],
    apiKey: process.env["MODEL_API_KEY"],
    name: process.env["MODEL_NAME"]
  };
  process.env["WSGS_MODEL_POLICY"] = "MODEL_OPTIONAL";
  delete process.env["MODEL_BASE_URL"];
  delete process.env["MODEL_API_KEY"];
  delete process.env["MODEL_NAME"];
  const optionalReadiness = await checkReadinessForCurrentEnvironment({ pool });
  if (!optionalReadiness.ready || optionalReadiness.reasons.length !== 0) {
    throw new Error(`MODEL_OPTIONAL_READINESS_FAILED_${optionalReadiness.reasons.join("_")}`);
  }
  const optionalExecutor = await createPipelineStageExecutor({ pool });
  process.env["WSGS_MODEL_POLICY"] = savedModel.policy ?? "MODEL_REQUIRED";
  if (savedModel.baseUrl === undefined) delete process.env["MODEL_BASE_URL"]; else process.env["MODEL_BASE_URL"] = savedModel.baseUrl;
  if (savedModel.apiKey === undefined) delete process.env["MODEL_API_KEY"]; else process.env["MODEL_API_KEY"] = savedModel.apiKey;
  if (savedModel.name === undefined) delete process.env["MODEL_NAME"]; else process.env["MODEL_NAME"] = savedModel.name;
  cases.push(await submitAndRun(baseUrl, optionalExecutor, "R6", requestBody(
    "R6", "查询坐标 113.93,22.54 附近对象", "GROUND_REFERENCES", ["RESOLVED_REFERENCES"]
  ), ["UNRESOLVED", "PARTIAL", "COMPLETED"]));
  if (cases.at(-1)?.modelReceiptCount !== 0) throw new Error("MODEL_OPTIONAL_FALLBACK_CALLED_MODEL");

  const noData = await submitAndRun(baseUrl, productionExecutor, "NO_DATA", requestBody(
    "NO-DATA", "4号车在哪里？", "GROUND_REFERENCES", ["RESOLVED_REFERENCES"]
  ), ["UNRESOLVED"]);
  const partial = await submitAndRun(baseUrl, optionalExecutor, "PARTIAL", requestBody(
    "PARTIAL", "2号车在哪里？", "GROUND_REFERENCES", ["RESOLVED_REFERENCES"], [knownVehicle]
  ), ["PARTIAL"]);

  const authorityInjectionBody = { ...requestBody(
    "AUTHORITY", "2号车在哪里？", "GROUND_REFERENCES", ["RESOLVED_REFERENCES"]
  ), actorId: "forged-actor" };
  const authorityInjection = await fetchJson(baseUrl, "/v1/groundings", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "development-authority-injection" },
    body: JSON.stringify(authorityInjectionBody)
  });
  if (authorityInjection.status !== 400) throw new Error("BODY_AUTHORITY_INJECTION_NOT_REJECTED");

  // Exercise the real scoped lookup with the raw id only in process. The
  // emitted evidence contains its hash, never the authority-bearing id.
  const rawId = await pool.query<{ grounding_id: string }>(
    "SELECT grounding_id FROM wsgs.grounding_result WHERE result_hash = $1",
    [cases[0]!.resultHash]
  );
  const crossScopeReal = await createGroundingApi({
    auth: {
      mode: "STATIC_TRUSTED",
      identity: createGroundingIdentity({
        servicePrincipalId: identity.servicePrincipalId,
        actorId: "development-cross-scope",
        dataScopes: ["development-other-scope"],
        datasetScopes: [],
        permissions: ["grounding.read"]
      })
    },
    backend: resources.backend,
    schemas: loadSchemas(),
    logger: false
  });
  const crossScopeRealResponse = await crossScopeReal.inject({
    method: "GET",
    url: `/v1/groundings/${encodeURIComponent(string(rawId.rows[0]?.grounding_id, "CROSS_SCOPE_SOURCE_ID_MISSING"))}`
  });
  await crossScopeReal.close();
  if (crossScopeRealResponse.statusCode !== 404) {
    throw new Error("CROSS_SCOPE_RESULT_DISCLOSURE");
  }

  const recovery = await recoveryCase(baseUrl, productionExecutor);
  const r1 = cases.find((entry) => entry.recipeId === "R1");
  if (!r1) throw new Error("R1_EVIDENCE_MISSING");
  if (r1.completedStages.length !== 14 || r1.stageHashes.length !== 14 || r1.modelReceiptCount < 1 || r1.worldQueryCount < 1) {
    throw new Error("REAL_PIPELINE_STAGE_PROOF_INCOMPLETE");
  }
  if (cases.find((entry) => entry.recipeId === "R4")?.planHashes.length === 0) {
    throw new Error("R4_PLAN_HASH_MISSING");
  }
  const stableRecipeCases = cases.filter((entry) => !gdpsCaseIds.has(entry.recipeId));

  mkdirSync(recipeEvidenceDirectory, { recursive: true });
  const realPipelineEvidence = {
    schemaVersion: "1.0",
    sourceCommit,
    requestHash: r1.requestHash,
    terminalStatus: r1.terminalStatus,
    stageHashes: r1.stageHashes,
    resultHash: r1.resultHash,
    realDependencies: { api: true, postgres: true, worker: true, model: true, gowm: true },
    status: "PASS"
  };
  writeFileSync(resolve(evidenceDirectory, "real-pipeline-evidence.json"), `${JSON.stringify(realPipelineEvidence, null, 2)}\n`);
  for (const evidence of stableRecipeCases) {
    const recipeEvidence = {
      schemaVersion: "1.0",
      recipeId: evidence.recipeId,
      requestHash: evidence.requestHash,
      compilerOrigin: "WSGS_PRODUCTION_PIPELINE",
      ...(evidence.planHashes[0] ? { planHash: evidence.planHashes[0] } : {}),
      terminalStatus: evidence.terminalStatus,
      status: "PASS"
    };
    writeFileSync(resolve(recipeEvidenceDirectory, `${evidence.recipeId}.json`), `${JSON.stringify(recipeEvidence, null, 2)}\n`);
  }
  const summary = {
    schemaVersion: "1.0",
    gate: "validation/scripts/real-development-pipeline-gate.ts",
    sourceCommit,
    status: "PASS",
    executionClassification: "TRUSTED",
    readiness: {
      liveHttpStatus: live.status,
      readyHttpStatus: ready.status,
      currentOperationalLock: "PASS",
      modelRequired: "PASS",
      modelOptionalWithoutModel: "PASS"
    },
    realDependencies: { api: true, postgres: true, worker: true, model: true, gowm: true },
    recipes: stableRecipeCases.map((entry) => ({
      recipeId: entry.recipeId,
      requestHash: entry.requestHash,
      groundingIdHash: entry.groundingIdHash,
      terminalStatus: entry.terminalStatus,
      resultHash: entry.resultHash,
      stageCount: entry.completedStages.length,
      planHashes: entry.planHashes,
      upstreamResultHashes: entry.upstreamResultHashes,
      worldQueryCount: entry.worldQueryCount,
      spatialExecutionCount: entry.spatialExecutionCount,
      operationKeys: entry.operationKeys,
      operationStatuses: entry.operationStatuses,
      normalizedStatuses: entry.normalizedStatuses,
      gatewayQueryIdHashes: entry.gatewayQueryIdHashes,
      gatewayJobIdHashes: entry.gatewayJobIdHashes,
      productIds: entry.productIds,
      contentHashes: entry.contentHashes,
      truncated: entry.truncated,
      modelReceiptCount: entry.modelReceiptCount,
      totalStageElapsedMs: entry.totalStageElapsedMs,
      status: "PASS"
    })),
    additionalSemantics: {
      noData: { requestHash: noData.requestHash, terminalStatus: noData.terminalStatus, status: "PASS" },
      partial: { requestHash: partial.requestHash, terminalStatus: partial.terminalStatus, status: "PASS" }
    },
    gdps: {
      enabled: gdpsCaseIds.size > 0,
      gatewayOnly: true,
      directProviderCalls: false,
      suiteMode: gdpsSuite.mode,
      corpus: gdpsSuite.mode === "GDPS_V021_FROZEN_CORPUS" ? {
        schemaVersion: "wsgs-gdps-e2e-corpus/2.0",
        hash: gdpsSuite.corpusHash,
        frozenCaseCount: gdpsSuite.totalCaseCount,
        selectedCaseCount: gdpsSuite.selectedCaseCount,
        selection: gdpsSuite.fullCorpusSelected ? "FULL_16_CASE_CORPUS" : "SINGLE_CASE"
      } : null,
      cases: cases.filter((entry) => gdpsCaseIds.has(entry.recipeId)).map((entry) => {
        const definition = gdpsDefinitions.get(entry.recipeId);
        if (!definition) throw new Error(`GDPS_CASE_DEFINITION_MISSING_${entry.recipeId}`);
        return {
          caseId: entry.recipeId,
          expectedPattern: definition.expectedPattern ?? null,
          selectedRecipeIds: entry.selectedRecipeIds,
          expectedOperations: expectedOperationChain(definition) ?? [],
          operationKeys: entry.operationKeys,
          expectedStatus: definition.expectedStatus,
          terminalStatus: entry.terminalStatus,
          normalizedStatuses: entry.normalizedStatuses,
          expectedSemanticCode: definition.expectedSemanticCode ?? null,
          semanticCodes: entry.semanticCodes,
          expectedDescriptor: definition.expectedDescriptor ?? null,
          descriptorIds: entry.descriptorIds,
          expectedExplicitProductId: definition.expectedExplicitProductId ?? null,
          operationStatuses: entry.operationStatuses,
          productIds: entry.productIds,
          contentHashes: entry.contentHashes,
          truncated: entry.truncated,
          precondition: definition.precondition ?? null,
          status: "PASS"
        };
      }),
      geometryBuffer: {
        caseId: "E2E-08",
        status: "NOT_RUN",
        reason: "GOWM_GEOMETRY_BUFFER_CAPABILITY_REQUIRED"
      },
      caseValidationStatus: gdpsCaseIds.size > 0 && gdpsCaseIds.size === gdpsSuite.selectedCaseCount
        ? (gdpsSuite.fullCorpusSelected ? "PASS" : "PARTIAL")
        : "NOT_RUN",
      status: gdpsSuite.fullCorpusSelected ? "BLOCKED" : "PARTIAL"
    },
    security: {
      bodyAuthorityInjection: { httpStatus: authorityInjection.status, status: "PASS" },
      crossScopeNonDisclosure: { httpStatus: crossScopeRealResponse.statusCode, status: "PASS" },
      credentialPersistence: false,
      status: "PASS"
    },
    recovery,
    redaction: {
      credentialsIncluded: false,
      rawBusinessResponsesIncluded: false,
      rawGroundingIdsIncluded: false,
      externalJobIdsIncluded: false
    }
  };
  writeFileSync(resolve(evidenceDirectory, "development-closure-gate.json"), `${JSON.stringify(summary, null, 2)}\n`);
  if (gdpsSuite.mode === "GDPS_V021_FROZEN_CORPUS") {
    const gdpsE2eReport = {
      schemaVersion: "wsgs-gdps-real-e2e/2.0",
      sourceCommit,
      executionClassification: "REAL_EXTERNAL_DEPENDENCIES",
      requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY",
      gatewayOnly: true,
      directProviderCalls: false,
      corpus: summary.gdps.corpus,
      cases: summary.gdps.cases,
      fullCorpusExecuted: gdpsSuite.fullCorpusSelected && gdpsCaseIds.size === 16,
      blockers: ["W44_X01_X12_EXTERNAL_QUALIFICATION_NOT_IMPLEMENTED"],
      status: gdpsSuite.fullCorpusSelected ? "BLOCKED" : "PARTIAL"
    };
    writeFileSync(resolve(evidenceDirectory, "e2e-report.json"), `${JSON.stringify(gdpsE2eReport, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({
    marker: "WSGS_REAL_DEVELOPMENT_PIPELINE_PASS",
    sourceCommit,
    recipesPassed: stableRecipeCases.length,
    gdpsCasesPassed: gdpsCaseIds.size,
    pipelineStages: r1.completedStages.length,
    currentLockReadiness: "PASS",
    minimumSecurity: "PASS",
    workerRestart: "PASS",
    noData: "PASS",
    partial: "PASS",
    gdpsCases: gdpsCaseIds.size
  }, null, 2)}\n`);
  exitCode = 0;
} catch (error) {
  const code = error instanceof Error ? error.message.replace(/[^A-Za-z0-9_:-]/gu, "_").slice(0, 240) : "UNKNOWN_ERROR";
  process.stderr.write(`${JSON.stringify({ marker: "WSGS_REAL_DEVELOPMENT_PIPELINE_BLOCKED", code })}\n`);
} finally {
  await app?.close().catch(() => undefined);
  await resources?.close().catch(() => undefined);
  await pool.end().catch(() => undefined);
}

process.exit(exitCode);
