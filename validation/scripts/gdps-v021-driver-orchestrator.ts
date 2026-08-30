import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  currentnessSeedPointer,
  deriveCurrentnessDriver,
  type VerifiedCurrentnessBarrier,
} from "../drivers/currentness.js";
import { deriveDataGapDriver } from "../drivers/data-gap.js";
import {
  buildRecipeDriftRuntimeMaterial,
  deriveRecipeDriftDriver,
} from "../drivers/recipe-drift.js";
import { deriveTruncatedDriver } from "../drivers/truncated.js";
import {
  GdpsV021DriverEvidenceError,
  GdpsV021DriverExternalContractError,
  type DriverDigest,
  type GdpsV021DerivedDriverCase,
  type GdpsV021DriverArtifactSummary,
  type GdpsV021DriverCaseId,
  type GdpsV021DriverOrchestratorInput,
  type GdpsV021DriverOrchestratorResult,
  type GdpsV021ProviderRecipeBinding,
  type JsonObject,
  type PersistedDriverRun,
  type PersistedExecutionEvidence,
  type PersistedStageEvidence,
} from "../drivers/contracts.js";
import {
  canonicalHash,
  digest,
  isObject,
  object,
  sha256,
  text,
  valuesNamed,
} from "../drivers/shared.js";

const driverCaseIds = Object.freeze([
  "NEG-DATA-GAP",
  "NEG-RECIPE-DRIFT",
  "NEG-TRUNCATED",
  "NEG-CURRENTNESS",
] as const);

const operationByCase: Readonly<Record<GdpsV021DriverCaseId, string>> = Object.freeze({
  "NEG-DATA-GAP": "geo-vector.find-in-area@1.0",
  "NEG-RECIPE-DRIFT": "geo-raster.find-by-range@1.0",
  "NEG-TRUNCATED": "geo-vector.find-in-area@1.0",
  "NEG-CURRENTNESS": "geo-product.check-current@1.0",
});

const implementationPathByCase: Readonly<Record<GdpsV021DriverCaseId, string>> = Object.freeze({
  "NEG-DATA-GAP": "validation/drivers/data-gap.ts",
  "NEG-RECIPE-DRIFT": "validation/drivers/recipe-drift.ts",
  "NEG-TRUNCATED": "validation/drivers/truncated.ts",
  "NEG-CURRENTNESS": "validation/drivers/currentness.ts",
});

const messageByCase: Readonly<Record<GdpsV021DriverCaseId, string>> = Object.freeze({
  "NEG-DATA-GAP": "A区内有哪些无人机限制区？",
  "NEG-RECIPE-DRIFT": "A区内坡度15到30度的区域有哪些？",
  "NEG-TRUNCATED": "A区内有哪些排水沟？",
  "NEG-CURRENTNESS": "严格重用之前的坡度查询证据。",
});

const commitPattern = /^[0-9a-f]{40}$/u;
const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{5,63}$/u;

function inside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" ||
    (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function existingFile(root: string, path: string, code: string): string {
  const candidate = isAbsolute(path) ? resolve(path) : resolve(root, path);
  if (!inside(root, candidate)) throw new GdpsV021DriverEvidenceError(`${code}_PATH_ESCAPE`);
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    throw new GdpsV021DriverEvidenceError(`${code}_MISSING`);
  }
  if (!inside(root, real) || !statSync(real).isFile()) {
    throw new GdpsV021DriverEvidenceError(`${code}_INVALID`);
  }
  return real;
}

function existingReadableFile(path: string, code: string): string {
  let real: string;
  try {
    real = realpathSync(resolve(path));
  } catch {
    throw new GdpsV021DriverEvidenceError(`${code}_MISSING`);
  }
  if (!statSync(real).isFile()) throw new GdpsV021DriverEvidenceError(`${code}_INVALID`);
  return real;
}

function outputPath(root: string, outputRoot: string, path: string, code: string): string {
  const candidate = isAbsolute(path) ? resolve(path) : resolve(root, path);
  if (!inside(root, candidate) || !inside(outputRoot, candidate)) {
    throw new GdpsV021DriverEvidenceError(`${code}_PATH_ESCAPE`);
  }
  return candidate;
}

function repositoryPath(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  if (!value || value.startsWith("../") || value.includes("/../") || value.includes(":")) {
    throw new GdpsV021DriverEvidenceError("DRIVER_REPOSITORY_PATH_INVALID");
  }
  return value;
}

function parseJson(bytes: Uint8Array, code: string): JsonObject {
  try {
    return object(JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown, code);
  } catch (error) {
    if (error instanceof GdpsV021DriverEvidenceError) throw error;
    throw new GdpsV021DriverEvidenceError(code);
  }
}

function stableJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeNewFile(path: string, bytes: Uint8Array, gateRunId: string): void {
  if (existsSync(path)) throw new GdpsV021DriverEvidenceError("DRIVER_ARTIFACT_ALREADY_EXISTS");
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${gateRunId}.tmp`;
  if (existsSync(temporary)) throw new GdpsV021DriverEvidenceError("DRIVER_TEMPORARY_ARTIFACT_EXISTS");
  writeFileSync(temporary, bytes, { flag: "wx" });
  renameSync(temporary, path);
}

function writeNewJson(path: string, value: unknown, gateRunId: string): {
  readonly hash: DriverDigest;
  readonly byteLength: number;
} {
  const bytes = stableJsonBytes(value);
  writeNewFile(path, bytes, gateRunId);
  return { hash: sha256(bytes), byteLength: bytes.byteLength };
}

function one<Row extends object>(rows: readonly Row[], code: string): Row {
  if (rows.length !== 1) throw new GdpsV021DriverEvidenceError(`${code}_COUNT_${rows.length}`);
  return rows[0]!;
}

function nullableObject(value: unknown): JsonObject | null {
  return isObject(value) ? structuredClone(value) : null;
}

function stringArray(value: unknown, code: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new GdpsV021DriverEvidenceError(code);
  }
  return [...value];
}

function hashOpaque(value: string | null): DriverDigest | null {
  return value === null ? null : sha256(value);
}

function uniqueObjects(values: readonly JsonObject[]): JsonObject[] {
  const byHash = new Map<DriverDigest, JsonObject>();
  for (const value of values) byHash.set(canonicalHash(value), value);
  return [...byHash.values()].map((entry) => structuredClone(entry));
}

async function readPersistedRun(input: {
  readonly sql: GdpsV021DriverOrchestratorInput["sql"];
  readonly groundingId: string;
  readonly requestHash: DriverDigest;
  readonly requestBody: JsonObject;
  readonly expectedOperationLockHash: DriverDigest;
  readonly expectedRecipeLockHash: DriverDigest;
  readonly expectedConsumerSnapshotHash: DriverDigest;
}): Promise<PersistedDriverRun> {
  const request = one((await input.sql.query<{
    payload_hash: string;
    source_text_sha256: string;
    request_metadata: unknown;
    gowm_operation_lock_hash: string | null;
  }>(
    `SELECT payload_hash, source_text_sha256, request_metadata, gowm_operation_lock_hash
       FROM wsgs.grounding_request WHERE grounding_id = $1`,
    [input.groundingId],
  )).rows, "DRIVER_REQUEST_ROW");
  const source = object(input.requestBody["source"], "DRIVER_REQUEST_SOURCE_INVALID");
  const sourceTextHash = sha256(text(source["originalText"], "DRIVER_SOURCE_TEXT_MISSING"));
  if (input.requestHash !== canonicalHash(input.requestBody) ||
      request.payload_hash !== input.requestHash || request.source_text_sha256 !== sourceTextHash ||
      request.gowm_operation_lock_hash !== input.expectedOperationLockHash) {
    throw new GdpsV021DriverEvidenceError("DRIVER_REQUEST_PERSISTENCE_BINDING_MISMATCH");
  }

  const job = one((await input.sql.query<{
    status: string;
    error: unknown;
  }>("SELECT status, error FROM wsgs.grounding_job WHERE grounding_id = $1", [input.groundingId])).rows,
  "DRIVER_JOB_ROW");
  const result = one((await input.sql.query<{
    status: string;
    result_hash: string;
    result_bytes: unknown;
  }>(
    "SELECT status, result_hash, result_bytes FROM wsgs.grounding_result WHERE grounding_id = $1",
    [input.groundingId],
  )).rows, "DRIVER_RESULT_ROW");
  const resultHash = digest(result.result_hash, "DRIVER_RESULT_HASH_INVALID");
  if (!(result.result_bytes instanceof Uint8Array)) {
    throw new GdpsV021DriverEvidenceError("DRIVER_RESULT_BYTES_INVALID");
  }
  const resultDocument = parseJson(result.result_bytes, "DRIVER_RESULT_JSON_INVALID");
  if (resultDocument["status"] !== result.status || resultDocument["resultHash"] !== resultHash ||
      job.status !== result.status) {
    throw new GdpsV021DriverEvidenceError("DRIVER_TERMINAL_PERSISTENCE_MISMATCH");
  }

  const events = (await input.sql.query<{
    stage: string;
    status: string;
    input_hash: string;
    output_hash: string | null;
    record_hash: string;
    error_code: string | null;
    elapsed_ms: number;
  }>(
    `SELECT stage, status, input_hash, output_hash, record_hash, error_code, elapsed_ms
       FROM wsgs.pipeline_event WHERE grounding_id = $1 ORDER BY event_id`,
    [input.groundingId],
  )).rows;
  const stageEvidence: PersistedStageEvidence[] = events
    .filter((entry) => entry.status !== "STARTED")
    .map((entry) => ({
      stage: entry.stage,
      status: entry.status,
      inputHash: digest(entry.input_hash, "DRIVER_STAGE_INPUT_HASH_INVALID"),
      outputHash: entry.output_hash === null ? null : digest(entry.output_hash, "DRIVER_STAGE_OUTPUT_HASH_INVALID"),
      recordHash: digest(entry.record_hash, "DRIVER_STAGE_RECORD_HASH_INVALID"),
      errorCode: entry.error_code,
      elapsedMs: entry.elapsed_ms,
    }));
  if (stageEvidence.length === 0 ||
      !stageEvidence.some((entry) => entry.stage === "RESULT_PERSIST" && entry.status === "COMPLETED")) {
    throw new GdpsV021DriverEvidenceError("DRIVER_PERSISTED_STAGE_TRACE_INCOMPLETE");
  }

  const queries = (await input.sql.query<{
    plan: unknown;
    plan_hash: string;
    upstream_result_hash: string | null;
  }>(
    `SELECT plan, plan_hash, upstream_result_hash
       FROM wsgs.world_query WHERE grounding_id = $1 ORDER BY created_at, query_id`,
    [input.groundingId],
  )).rows;
  const planDocuments = queries.map((entry) => object(entry.plan, "DRIVER_PLAN_INVALID"));
  const planHashes = queries.map((entry) => digest(entry.plan_hash, "DRIVER_PLAN_HASH_INVALID"));

  const executions = (await input.sql.query<{
    execution_kind: string;
    operation_id: string | null;
    operation_version: string | null;
    request_hash: string;
    result_hash: string | null;
    normalized_status: string;
    upstream_status: string;
    gateway_query_id: string | null;
    gateway_job_id: string | null;
    data_snapshot: unknown;
    compute_snapshot: unknown;
    snapshot_adherence: unknown;
    receipt_ids: unknown;
    evidence_ids: unknown;
  }>(
    `SELECT execution_kind, operation_id, operation_version, request_hash, result_hash,
            normalized_status, upstream_status, gateway_query_id, gateway_job_id,
            data_snapshot, compute_snapshot, snapshot_adherence, receipt_ids, evidence_ids
       FROM wsgs.gowm_execution WHERE grounding_id = $1 ORDER BY created_at, execution_id`,
    [input.groundingId],
  )).rows;
  const executionEvidence: PersistedExecutionEvidence[] = executions.map((entry) => {
    if (!["WORLD_QUERY", "WORLD_QUERY_NODE"].includes(entry.execution_kind) ||
        (entry.execution_kind === "WORLD_QUERY_NODE" &&
          (!entry.operation_id || !entry.operation_version)) ||
        (entry.execution_kind === "WORLD_QUERY" &&
          (entry.operation_id !== null || entry.operation_version !== null))) {
      throw new GdpsV021DriverEvidenceError("DRIVER_NON_GATEWAY_EXECUTION_FORBIDDEN");
    }
    if (!entry.gateway_query_id && !entry.gateway_job_id) {
      throw new GdpsV021DriverEvidenceError("DRIVER_EXECUTION_GATEWAY_IDENTITY_MISSING");
    }
    return {
      executionKind: entry.execution_kind,
      operationKey: entry.operation_id && entry.operation_version
        ? `${entry.operation_id}@${entry.operation_version}` : null,
      requestHash: digest(entry.request_hash, "DRIVER_EXECUTION_REQUEST_HASH_INVALID"),
      resultHash: entry.result_hash === null ? null : digest(entry.result_hash, "DRIVER_EXECUTION_RESULT_HASH_INVALID"),
      normalizedStatus: entry.normalized_status,
      upstreamStatus: entry.upstream_status,
      gatewayQueryIdHash: hashOpaque(entry.gateway_query_id),
      gatewayJobIdHash: hashOpaque(entry.gateway_job_id),
      dataSnapshot: nullableObject(entry.data_snapshot),
      computeSnapshot: nullableObject(entry.compute_snapshot),
      snapshotAdherence: nullableObject(entry.snapshot_adherence),
      receiptIds: stringArray(entry.receipt_ids, "DRIVER_EXECUTION_RECEIPT_IDS_INVALID"),
      evidenceIds: stringArray(entry.evidence_ids, "DRIVER_EXECUTION_EVIDENCE_IDS_INVALID"),
    };
  });
  const operationKeys = executionEvidence.flatMap((entry) => entry.operationKey ? [entry.operationKey] : []);
  const sourceEvidence = uniqueObjects(executions.flatMap((entry) => {
    if (!isObject(entry.data_snapshot)) return [];
    return valuesNamed(entry.data_snapshot, "gdpsSourceEvidence")
      .filter((value): value is JsonObject => isObject(value));
  }));

  const snapshot = one((await input.sql.query<{
    operation_lock_hash: string | null;
    gdps_recipe_lock_hash: string | null;
    gdps_descriptor_lock_hash: string | null;
    gdps_capability_snapshot_hash: string | null;
  }>(
    `SELECT operation_lock_hash, gdps_recipe_lock_hash, gdps_descriptor_lock_hash,
            gdps_capability_snapshot_hash
       FROM wsgs.capability_snapshot WHERE grounding_id = $1 ORDER BY created_at DESC`,
    [input.groundingId],
  )).rows, "DRIVER_CAPABILITY_SNAPSHOT");
  const operationLockHash = digest(snapshot.operation_lock_hash, "DRIVER_OPERATION_LOCK_HASH_INVALID");
  if (operationLockHash !== input.expectedOperationLockHash) {
    throw new GdpsV021DriverEvidenceError("DRIVER_OPERATION_LOCK_HASH_DRIFT");
  }
  const recipeLockHash = snapshot.gdps_recipe_lock_hash === null
    ? null : digest(snapshot.gdps_recipe_lock_hash, "DRIVER_RECIPE_LOCK_HASH_INVALID");
  const consumerSnapshotHash = snapshot.gdps_capability_snapshot_hash === null
    ? null : digest(snapshot.gdps_capability_snapshot_hash, "DRIVER_CONSUMER_SNAPSHOT_HASH_INVALID");
  if (recipeLockHash !== input.expectedRecipeLockHash ||
      consumerSnapshotHash !== input.expectedConsumerSnapshotHash) {
    throw new GdpsV021DriverEvidenceError("DRIVER_GDPS_RUNTIME_LOCK_PERSISTENCE_DRIFT");
  }
  const requestMetadata = isObject(request.request_metadata) ? request.request_metadata : {};
  return {
    groundingIdHash: sha256(input.groundingId),
    requestHash: input.requestHash,
    sourceTextHash,
    requestRowHash: canonicalHash({
      payloadHash: request.payload_hash,
      sourceTextHash: request.source_text_sha256,
      requestMetadataHash: canonicalHash(requestMetadata),
      operationLockHash: request.gowm_operation_lock_hash,
    }),
    terminalStatus: result.status,
    jobStatus: job.status,
    resultHash,
    resultDocument,
    resultDocumentHash: canonicalHash(resultDocument),
    stageEvidence,
    executionEvidence,
    operationKeys,
    planDocuments,
    planHashes,
    operationLockHash,
    recipeLockHash,
    descriptorLockHash: snapshot.gdps_descriptor_lock_hash === null
      ? null : digest(snapshot.gdps_descriptor_lock_hash, "DRIVER_DESCRIPTOR_LOCK_HASH_INVALID"),
    consumerSnapshotHash,
    gdpsSourceEvidence: sourceEvidence,
  };
}

function requestBody(input: {
  readonly gateRunId: string;
  readonly caseId: GdpsV021DriverCaseId;
  readonly phase: "PRIMARY" | "CURRENTNESS_SEED" | "CURRENTNESS_REPLAY";
  readonly message: string;
  readonly priorGroundings?: readonly JsonObject[];
}): JsonObject {
  const stem = `gdps-driver-${input.caseId.toLowerCase()}-${input.phase.toLowerCase()}-${input.gateRunId}`;
  return {
    schemaVersion: "1.0",
    requestId: stem,
    operation: "EXECUTE_WORLD_QUERY",
    source: {
      conversationRef: `conversation-${input.caseId.toLowerCase()}-${input.gateRunId}`,
      messageId: `message-${input.phase.toLowerCase()}-${input.gateRunId}`,
      originalText: input.message,
      originalTextSha256: sha256(input.message),
      locale: "zh-CN",
      createdAt: new Date().toISOString(),
    },
    requestedProducts: ["WORLD_EVIDENCE"],
    contextCapsule: {
      knownWorldReferences: [],
      priorGroundings: input.priorGroundings ?? [],
      mapSelections: [],
      externalCorrelationHints: [],
      externalPredicates: [],
    },
    executionPolicy: {
      readOnly: true,
      deadlineMs: 120_000,
      maxQueryOperations: 16,
      maxCandidatesPerMention: 20,
      maxResultBytes: 1_048_576,
      allowApproximation: false,
    },
  };
}

function providerRecipeBindings(input: {
  readonly bytes: Uint8Array;
  readonly expectedHash: DriverDigest;
}): Readonly<Record<GdpsV021DriverCaseId, GdpsV021ProviderRecipeBinding>> {
  if (sha256(input.bytes) !== input.expectedHash) {
    throw new GdpsV021DriverEvidenceError("PROVIDER_RECIPE_LOCK_HASH_DRIFT");
  }
  const lock = parseJson(input.bytes, "PROVIDER_RECIPE_LOCK_JSON_INVALID");
  const recipes = lock["recipes"];
  if (lock["schemaVersion"] !== "wsgs-gdps-recipe-lock/1.0" ||
      !Array.isArray(recipes) || recipes.length !== 30) {
    throw new GdpsV021DriverEvidenceError("PROVIDER_RECIPE_LOCK_CONTRACT_INVALID");
  }
  return Object.fromEntries(driverCaseIds.map((caseId) => {
    const operationKey = operationByCase[caseId];
    const candidates = recipes.filter((raw) => {
      const recipe = object(raw, "PROVIDER_RECIPE_ENTRY_INVALID");
      return `${recipe["operationId"]}@${recipe["operationVersion"]}` === operationKey;
    });
    if (candidates.length !== 1) {
      throw new GdpsV021DriverEvidenceError(`PROVIDER_RECIPE_NOT_EXACT_${caseId}`);
    }
    const recipe = object(candidates[0], "PROVIDER_RECIPE_ENTRY_INVALID");
    return [caseId, {
      providerRecipeId: text(recipe["recipeId"], "PROVIDER_RECIPE_ID_INVALID"),
      providerRecipeLockHash: input.expectedHash,
      operationKey,
      inputSchemaHash: digest(recipe["inputSchemaHash"], "PROVIDER_RECIPE_INPUT_HASH_INVALID"),
      outputSchemaHash: digest(recipe["outputSchemaHash"], "PROVIDER_RECIPE_OUTPUT_HASH_INVALID"),
      semanticProfileHash: digest(recipe["semanticProfileHash"], "PROVIDER_RECIPE_SEMANTIC_HASH_INVALID"),
    } satisfies GdpsV021ProviderRecipeBinding];
  })) as unknown as Readonly<Record<GdpsV021DriverCaseId, GdpsV021ProviderRecipeBinding>>;
}

async function executeAndRead(input: GdpsV021DriverOrchestratorInput, request: {
  readonly caseId: GdpsV021DriverCaseId;
  readonly phase: "PRIMARY" | "CURRENTNESS_SEED" | "CURRENTNESS_REPLAY";
  readonly body: JsonObject;
  readonly runtimeVariant: Parameters<GdpsV021DriverOrchestratorInput["executeNaturalLanguageCase"]>[0]["runtimeVariant"];
  readonly expectedRecipeLockHash: DriverDigest;
  readonly expectedConsumerSnapshotHash: DriverDigest;
}): Promise<{ readonly groundingId: string; readonly run: PersistedDriverRun }> {
  const execution = await input.executeNaturalLanguageCase({
    gateRunId: input.gateRunId,
    caseId: request.caseId,
    phase: request.phase,
    body: request.body,
    runtimeVariant: request.runtimeVariant,
  });
  if (!execution.groundingId || !/^sha256:[0-9a-f]{64}$/u.test(execution.requestHash)) {
    throw new GdpsV021DriverEvidenceError("DRIVER_EXECUTION_ADAPTER_RESULT_INVALID");
  }
  const run = await readPersistedRun({
    sql: input.sql,
    groundingId: execution.groundingId,
    requestHash: execution.requestHash,
    requestBody: request.body,
    expectedOperationLockHash: input.operationLockHash,
    expectedRecipeLockHash: request.expectedRecipeLockHash,
    expectedConsumerSnapshotHash: request.expectedConsumerSnapshotHash,
  });
  return { groundingId: execution.groundingId, run };
}

function readBarrier(input: GdpsV021DriverOrchestratorInput, artifact: {
  readonly attestationPath: string;
  readonly attestationHash: DriverDigest;
}): VerifiedCurrentnessBarrier {
  const repositoryRoot = resolve(input.repositoryRoot);
  const outputRoot = isAbsolute(input.outputDirectory)
    ? resolve(input.outputDirectory) : resolve(repositoryRoot, input.outputDirectory);
  const path = outputPath(repositoryRoot, outputRoot, artifact.attestationPath,
    "CURRENTNESS_BARRIER_ATTESTATION");
  const bytes = readFileSync(path);
  if (sha256(bytes) !== artifact.attestationHash) {
    throw new GdpsV021DriverEvidenceError("CURRENTNESS_BARRIER_ATTESTATION_HASH_DRIFT");
  }
  const document = parseJson(bytes, "CURRENTNESS_BARRIER_ATTESTATION_JSON_INVALID");
  if (document["gateRunId"] !== input.gateRunId) {
    throw new GdpsV021DriverEvidenceError("CURRENTNESS_BARRIER_GATE_RUN_DRIFT");
  }
  return { hash: artifact.attestationHash, document };
}

function readIsolatedRuntimePreparation(
  input: GdpsV021DriverOrchestratorInput,
  artifact: { readonly attestationPath: string; readonly attestationHash: DriverDigest },
  expected: {
    readonly caseId: "NEG-TRUNCATED" | "NEG-CURRENTNESS";
    readonly targetState: "UPSTREAM_TRUNCATED" | "INITIAL_A";
    readonly runtimeIdentityHash: DriverDigest;
    readonly sharedRuntimeBeforeHash: DriverDigest;
  },
): { readonly path: string; readonly hash: DriverDigest; readonly document: JsonObject } {
  const repositoryRoot = resolve(input.repositoryRoot);
  const outputRoot = isAbsolute(input.outputDirectory)
    ? resolve(input.outputDirectory) : resolve(repositoryRoot, input.outputDirectory);
  const path = outputPath(repositoryRoot, outputRoot, artifact.attestationPath,
    "ISOLATED_RUNTIME_ATTESTATION");
  const bytes = readFileSync(path);
  if (sha256(bytes) !== artifact.attestationHash) {
    throw new GdpsV021DriverEvidenceError("ISOLATED_RUNTIME_ATTESTATION_HASH_DRIFT");
  }
  const document = parseJson(bytes, "ISOLATED_RUNTIME_ATTESTATION_JSON_INVALID");
  if (document["schemaVersion"] !== "wsgs-gdps-isolated-driver-runtime/1.0" ||
      document["gateRunId"] !== input.gateRunId ||
      document["caseId"] !== expected.caseId ||
      document["targetState"] !== expected.targetState ||
      document["runtimeIdentityHash"] !== expected.runtimeIdentityHash ||
      document["sharedRuntimeBeforeHash"] !== expected.sharedRuntimeBeforeHash ||
      document["ready"] !== true ||
      document["requiredExecutionPath"] !== "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" ||
      document["isolatedRuntime"] !== true ||
      document["sharedRuntimeMutated"] !== false ||
      document["directProviderCalls"] !== 0) {
    throw new GdpsV021DriverEvidenceError("ISOLATED_RUNTIME_ATTESTATION_INVALID");
  }
  digest(document["gatewayRuntimeHash"], "ISOLATED_GATEWAY_RUNTIME_HASH_INVALID");
  digest(document["gdpsProviderRuntimeHash"], "ISOLATED_PROVIDER_RUNTIME_HASH_INVALID");
  return { path, hash: artifact.attestationHash, document };
}

function validateInput(input: GdpsV021DriverOrchestratorInput): {
  readonly repositoryRoot: string;
  readonly outputRoot: string;
  readonly manifestPath: string;
  readonly runtimeIdentityHash: DriverDigest;
} {
  const repositoryRoot = realpathSync(resolve(input.repositoryRoot));
  const outputRoot = isAbsolute(input.outputDirectory)
    ? resolve(input.outputDirectory) : resolve(repositoryRoot, input.outputDirectory);
  const manifestPath = outputPath(repositoryRoot, outputRoot, input.manifestPath, "DRIVER_MANIFEST");
  if (!inside(repositoryRoot, outputRoot) ||
      !repositoryPath(repositoryRoot, outputRoot).startsWith("reports/wsgs-v0.2-gdps-v0.2.1/")) {
    throw new GdpsV021DriverEvidenceError("DRIVER_OUTPUT_DIRECTORY_NOT_CANONICAL");
  }
  if (!runIdPattern.test(input.gateRunId) || !commitPattern.test(input.sourceCommit) ||
      input.runtimeIdentity.schemaVersion !== "wsgs-gdps-driver-runtime-identity/1.0" ||
      input.runtimeIdentity.gateRunId !== input.gateRunId) {
    throw new GdpsV021DriverEvidenceError("DRIVER_SOURCE_IDENTITY_INVALID");
  }
  for (const value of [input.handoffBundleHash, input.operationLockHash, input.provenanceHash,
    input.providerRecipeLockHash, input.runtimeRecipeLockHash, input.runtimeConsumerSnapshotHash,
    input.runtimeIdentity.databaseIdentityHash,
    input.runtimeIdentity.wsgsRuntimeHash, input.runtimeIdentity.gowmGatewayRuntimeHash,
    input.runtimeIdentity.gdpsProviderRuntimeHash]) {
    digest(value, "DRIVER_SOURCE_DIGEST_INVALID");
  }
  if (existsSync(manifestPath)) {
    throw new GdpsV021DriverEvidenceError("DRIVER_MANIFEST_ALREADY_EXISTS");
  }
  return {
    repositoryRoot,
    outputRoot,
    manifestPath,
    runtimeIdentityHash: canonicalHash(input.runtimeIdentity),
  };
}

function blockedDocument(input: GdpsV021DriverOrchestratorInput, values: {
  readonly runtimeIdentityHash: DriverDigest;
  readonly before: DriverDigest;
  readonly after: DriverDigest;
  readonly error: unknown;
}): JsonObject {
  const external = values.error instanceof GdpsV021DriverExternalContractError;
  const evidence = values.error instanceof GdpsV021DriverEvidenceError;
  return {
    schemaVersion: "wsgs-gdps-driver-orchestration-blocked/1.0",
    gateRunId: input.gateRunId,
    sourceCommit: input.sourceCommit,
    runtimeIdentityHash: values.runtimeIdentityHash,
    sharedRuntimeBeforeHash: values.before,
    sharedRuntimeAfterHash: values.after,
    status: external ? "NOT_RUN" : "FAIL",
    caseId: external ? values.error.caseId : null,
    code: external ? values.error.code : evidence ? values.error.code : "DRIVER_ORCHESTRATION_ERROR",
    requiredExternalContract: external ? values.error.requiredContract : null,
    validDriverManifestWritten: false,
  };
}

export async function runGdpsV021DriverOrchestrator(
  input: GdpsV021DriverOrchestratorInput,
): Promise<GdpsV021DriverOrchestratorResult> {
  const validated = validateInput(input);
  const before = digest(await input.sampleSharedRuntimeHash(), "DRIVER_SHARED_RUNTIME_BEFORE_INVALID");
  const recipeLockPath = existingFile(validated.repositoryRoot, input.runtimeRecipeLockPath,
    "DRIVER_RUNTIME_RECIPE_LOCK");
  const snapshotPath = existingFile(validated.repositoryRoot, input.runtimeConsumerSnapshotPath,
    "DRIVER_RUNTIME_CONSUMER_SNAPSHOT");
  const providerPath = existingReadableFile(isAbsolute(input.providerRecipeLockPath)
    ? input.providerRecipeLockPath
    : resolve(validated.repositoryRoot, input.providerRecipeLockPath),
    "DRIVER_PROVIDER_RECIPE_LOCK");
  const runtimeRecipeLockBytes = readFileSync(recipeLockPath);
  const runtimeConsumerSnapshotBytes = readFileSync(snapshotPath);
  if (sha256(runtimeRecipeLockBytes) !== input.runtimeRecipeLockHash ||
      sha256(runtimeConsumerSnapshotBytes) !== input.runtimeConsumerSnapshotHash) {
    throw new GdpsV021DriverEvidenceError("DRIVER_RUNTIME_INPUT_FILE_HASH_DRIFT");
  }
  const runtimeRecipeLock = parseJson(runtimeRecipeLockBytes, "DRIVER_RUNTIME_RECIPE_LOCK_JSON_INVALID");
  const runtimeConsumerSnapshot = parseJson(runtimeConsumerSnapshotBytes,
    "DRIVER_RUNTIME_CONSUMER_SNAPSHOT_JSON_INVALID");
  const baseCapabilitySnapshotHash = digest(runtimeConsumerSnapshot["capabilitySnapshotHash"],
    "DRIVER_RUNTIME_CONSUMER_SNAPSHOT_IDENTITY_INVALID");
  const { capabilitySnapshotHash: _runtimeSnapshotHash, ...runtimeSnapshotBody } = runtimeConsumerSnapshot;
  if (runtimeConsumerSnapshot["recipeLockHash"] !== input.runtimeRecipeLockHash ||
      canonicalHash(runtimeSnapshotBody) !== baseCapabilitySnapshotHash) {
    throw new GdpsV021DriverEvidenceError("DRIVER_RUNTIME_CONSUMER_SNAPSHOT_BINDING_DRIFT");
  }
  const providerBindings = providerRecipeBindings({
    bytes: readFileSync(providerPath),
    expectedHash: input.providerRecipeLockHash,
  });
  const variantMaterial = buildRecipeDriftRuntimeMaterial({
    gateRunId: input.gateRunId,
    recipeLock: runtimeRecipeLock,
    consumerSnapshot: runtimeConsumerSnapshot,
  });
  const variantDirectory = resolve(validated.outputRoot, "runtime-variants");
  const variantRecipePath = resolve(variantDirectory, "NEG-RECIPE-DRIFT.recipe-lock.json");
  const variantSnapshotPath = resolve(variantDirectory, "NEG-RECIPE-DRIFT.consumer-snapshot.json");
  writeNewFile(variantRecipePath, variantMaterial.recipeLockBytes, input.gateRunId);
  writeNewFile(variantSnapshotPath, variantMaterial.consumerSnapshotBytes, input.gateRunId);

  const derived: GdpsV021DerivedDriverCase[] = [];
  try {
    const dataBody = requestBody({
      gateRunId: input.gateRunId,
      caseId: "NEG-DATA-GAP",
      phase: "PRIMARY",
      message: messageByCase["NEG-DATA-GAP"],
    });
    const data = await executeAndRead(input, {
      caseId: "NEG-DATA-GAP",
      phase: "PRIMARY",
      body: dataBody,
      runtimeVariant: { kind: "BASELINE_READ_ONLY" },
      expectedRecipeLockHash: input.runtimeRecipeLockHash,
      expectedConsumerSnapshotHash: baseCapabilitySnapshotHash,
    });
    derived.push(deriveDataGapDriver(data.run));

    const driftBody = requestBody({
      gateRunId: input.gateRunId,
      caseId: "NEG-RECIPE-DRIFT",
      phase: "PRIMARY",
      message: messageByCase["NEG-RECIPE-DRIFT"],
    });
    const drift = await executeAndRead(input, {
      caseId: "NEG-RECIPE-DRIFT",
      phase: "PRIMARY",
      body: driftBody,
      runtimeVariant: {
        kind: "ISOLATED_RECIPE_LOCK_DRIFT",
        recipeLockPath: variantRecipePath,
        recipeLockHash: variantMaterial.recipeLockHash,
        consumerSnapshotPath: variantSnapshotPath,
        consumerSnapshotHash: variantMaterial.consumerSnapshotHash,
      },
      expectedRecipeLockHash: variantMaterial.recipeLockHash,
      expectedConsumerSnapshotHash: digest(variantMaterial.consumerSnapshot["capabilitySnapshotHash"],
        "RECIPE_DRIFT_CONSUMER_SNAPSHOT_IDENTITY_INVALID"),
    });
    derived.push(deriveRecipeDriftDriver(drift.run, variantMaterial));

    if (!input.prepareIsolatedRuntime) {
      throw new GdpsV021DriverExternalContractError(
        "NEG-TRUNCATED",
        "ISOLATED_TRUNCATED_RUNTIME_UNAVAILABLE",
        "A same-run isolated real GDPS/Gateway runtime must attest UPSTREAM_TRUNCATED before the natural-language case executes; baseline or synthetic WSGS truncation is forbidden.",
      );
    }
    const truncatedPreparationArtifact = await input.prepareIsolatedRuntime({
      gateRunId: input.gateRunId,
      caseId: "NEG-TRUNCATED",
      targetState: "UPSTREAM_TRUNCATED",
      runtimeIdentityHash: validated.runtimeIdentityHash,
      sharedRuntimeBeforeHash: before,
    });
    const truncatedPreparation = readIsolatedRuntimePreparation(
      input,
      truncatedPreparationArtifact,
      {
        caseId: "NEG-TRUNCATED",
        targetState: "UPSTREAM_TRUNCATED",
        runtimeIdentityHash: validated.runtimeIdentityHash,
        sharedRuntimeBeforeHash: before,
      },
    );
    const truncatedBody = requestBody({
      gateRunId: input.gateRunId,
      caseId: "NEG-TRUNCATED",
      phase: "PRIMARY",
      message: messageByCase["NEG-TRUNCATED"],
    });
    const truncated = await executeAndRead(input, {
      caseId: "NEG-TRUNCATED",
      phase: "PRIMARY",
      body: truncatedBody,
      runtimeVariant: {
        kind: "ISOLATED_UPSTREAM_TRUNCATED",
        runtimeAttestationPath: truncatedPreparation.path,
        runtimeAttestationHash: truncatedPreparation.hash,
      },
      expectedRecipeLockHash: input.runtimeRecipeLockHash,
      expectedConsumerSnapshotHash: baseCapabilitySnapshotHash,
    });
    const truncatedDerived = deriveTruncatedDriver(truncated.run);
    derived.push({
      ...truncatedDerived,
      precondition: {
        ...truncatedDerived.precondition,
        isolatedRuntimeAttestationHash: truncatedPreparation.hash,
      },
    });

    if (!input.prepareIsolatedRuntime || !input.crossCurrentnessBarrier) {
      throw new GdpsV021DriverExternalContractError(
        "NEG-CURRENTNESS",
        "INITIAL_A_TO_CURRENT_B_BARRIER_UNAVAILABLE",
        "The isolated GDPS driver must expose an explicit INITIAL_A to CURRENT_B barrier attestation. Missing or already-advanced INITIAL_A cannot be repaired by inserting a synthetic WSGS prior result.",
      );
    }
    const initialPreparationArtifact = await input.prepareIsolatedRuntime({
      gateRunId: input.gateRunId,
      caseId: "NEG-CURRENTNESS",
      targetState: "INITIAL_A",
      runtimeIdentityHash: validated.runtimeIdentityHash,
      sharedRuntimeBeforeHash: before,
    });
    const initialPreparation = readIsolatedRuntimePreparation(input, initialPreparationArtifact, {
      caseId: "NEG-CURRENTNESS",
      targetState: "INITIAL_A",
      runtimeIdentityHash: validated.runtimeIdentityHash,
      sharedRuntimeBeforeHash: before,
    });
    const seedBody = requestBody({
      gateRunId: input.gateRunId,
      caseId: "NEG-CURRENTNESS",
      phase: "CURRENTNESS_SEED",
      message: "A区内坡度15到30度的区域有哪些？",
    });
    const seedRun = await executeAndRead(input, {
      caseId: "NEG-CURRENTNESS",
      phase: "CURRENTNESS_SEED",
      body: seedBody,
      runtimeVariant: {
        kind: "ISOLATED_CURRENTNESS_EPOCH_A",
        runtimeAttestationPath: initialPreparation.path,
        runtimeAttestationHash: initialPreparation.hash,
      },
      expectedRecipeLockHash: input.runtimeRecipeLockHash,
      expectedConsumerSnapshotHash: baseCapabilitySnapshotHash,
    });
    const seed = currentnessSeedPointer(seedRun.run, seedRun.groundingId, input.gateRunId);
    const productId = text(seed.sourceEvidence["productId"], "CURRENTNESS_SEED_PRODUCT_ID_MISSING");
    const initialContentHash = digest(seed.sourceEvidence["contentHash"],
      "CURRENTNESS_SEED_CONTENT_HASH_MISSING");
    const barrierArtifact = await input.crossCurrentnessBarrier({
      gateRunId: input.gateRunId,
      caseId: "NEG-CURRENTNESS",
      productId,
      initialContentHash,
      sourceGroundingIdHash: seed.groundingIdHash,
      sourceResultHash: seed.resultHash,
      initialEpochAttestationHash: initialPreparation.hash,
    });
    const barrier = readBarrier(input, barrierArtifact);
    if (barrier.document["fromContentHash"] !== initialContentHash ||
        barrier.document["productId"] !== productId ||
        barrier.document["initialEpochAttestationHash"] !== initialPreparation.hash) {
      throw new GdpsV021DriverEvidenceError("CURRENTNESS_BARRIER_SOURCE_BINDING_MISMATCH");
    }
    const replayBody = requestBody({
      gateRunId: input.gateRunId,
      caseId: "NEG-CURRENTNESS",
      phase: "CURRENTNESS_REPLAY",
      message: messageByCase["NEG-CURRENTNESS"],
      priorGroundings: [{
        groundingId: seed.groundingId,
        resultHash: seed.resultHash,
        selectedProductIds: [seed.selectedProductId],
      }],
    });
    const replay = await executeAndRead(input, {
      caseId: "NEG-CURRENTNESS",
      phase: "CURRENTNESS_REPLAY",
      body: replayBody,
      runtimeVariant: {
        kind: "ISOLATED_CURRENTNESS_EPOCH_B",
        barrierAttestationPath: barrierArtifact.attestationPath,
        barrierAttestationHash: barrier.hash,
      },
      expectedRecipeLockHash: input.runtimeRecipeLockHash,
      expectedConsumerSnapshotHash: baseCapabilitySnapshotHash,
    });
    derived.push(deriveCurrentnessDriver(replay.run, seed, barrier));
  } catch (error) {
    const after = digest(await input.sampleSharedRuntimeHash(), "DRIVER_SHARED_RUNTIME_AFTER_INVALID");
    const blockedPath = resolve(validated.outputRoot, "driver-orchestration-blocked.json");
    writeNewJson(blockedPath, blockedDocument(input, {
      runtimeIdentityHash: validated.runtimeIdentityHash,
      before,
      after,
      error,
    }), input.gateRunId);
    throw error;
  }

  const after = digest(await input.sampleSharedRuntimeHash(), "DRIVER_SHARED_RUNTIME_AFTER_INVALID");
  if (before !== after) {
    const error = new GdpsV021DriverEvidenceError("SHARED_RUNTIME_CHANGED_DURING_DRIVER_RUN");
    writeNewJson(resolve(validated.outputRoot, "driver-orchestration-blocked.json"),
      blockedDocument(input, {
        runtimeIdentityHash: validated.runtimeIdentityHash,
        before,
        after,
        error,
      }), input.gateRunId);
    throw error;
  }
  if (derived.length !== driverCaseIds.length ||
      derived.some((entry, index) => entry.caseId !== driverCaseIds[index])) {
    throw new GdpsV021DriverEvidenceError("DRIVER_CASE_SET_INCOMPLETE");
  }

  const artifactSummaries: GdpsV021DriverArtifactSummary[] = [];
  const usedHashes = new Set<DriverDigest>();
  for (const entry of derived) {
    const implementationPath = implementationPathByCase[entry.caseId];
    if (entry.implementationPath !== implementationPath) {
      throw new GdpsV021DriverEvidenceError(`DRIVER_IMPLEMENTATION_PATH_DRIFT_${entry.caseId}`);
    }
    const implementationRealPath = existingFile(validated.repositoryRoot, implementationPath,
      `DRIVER_IMPLEMENTATION_${entry.caseId}`);
    const implementationBytes = readFileSync(implementationRealPath);
    const implementationHash = sha256(implementationBytes);
    const providerRecipeBinding = providerBindings[entry.caseId];
    const precondition = {
      ...entry.precondition,
      gateRunId: input.gateRunId,
      runtimeIdentityHash: validated.runtimeIdentityHash,
      providerRecipeBindingHash: canonicalHash(providerRecipeBinding),
    };
    const evidenceDocument = {
      schemaVersion: "wsgs-gdps-driver-evidence/2.0",
      caseId: entry.caseId,
      driverKind: entry.driverKind,
      gateRunId: input.gateRunId,
      runtimeIdentityHash: validated.runtimeIdentityHash,
      requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY",
      gatewayOnly: true,
      directProviderCalls: 0,
      mockTransportUsed: false,
      persistedFacts: {
        ...entry.persistedFacts,
        gateRunId: input.gateRunId,
        runtimeIdentityHash: validated.runtimeIdentityHash,
        providerRecipeBinding,
      },
    };
    const evidencePath = resolve(validated.outputRoot, `${entry.caseId}.evidence.json`);
    const evidence = writeNewJson(evidencePath, evidenceDocument, input.gateRunId);
    const attestationDocument = {
      schemaVersion: "wsgs-gdps-e2e-driver-attestation/2.0",
      caseId: entry.caseId,
      driverKind: entry.driverKind,
      sourceCommit: input.sourceCommit,
      handoffBundleHash: input.handoffBundleHash,
      operationLockHash: input.operationLockHash,
      provenanceHash: input.provenanceHash,
      runtimeIdentityHash: validated.runtimeIdentityHash,
      sharedRuntimeBeforeHash: before,
      sharedRuntimeAfterHash: after,
      executionEnvironment: "ISOLATED_REAL_RUNTIME",
      requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY",
      realExternalDependencies: true,
      mockTransportUsed: false,
      sharedRuntimeMutated: false,
      precondition,
      preconditionHash: canonicalHash(precondition),
      driverImplementationHash: implementationHash,
      evidenceHash: evidence.hash,
    };
    const attestationPath = resolve(validated.outputRoot, `${entry.caseId}.attestation.json`);
    const attestation = writeNewJson(attestationPath, attestationDocument, input.gateRunId);
    for (const hash of [implementationHash, evidence.hash, attestation.hash]) {
      if (usedHashes.has(hash)) throw new GdpsV021DriverEvidenceError("DRIVER_ARTIFACT_HASH_REUSED");
      usedHashes.add(hash);
    }
    artifactSummaries.push({
      caseId: entry.caseId,
      driverKind: entry.driverKind,
      attestationPath: repositoryPath(validated.repositoryRoot, attestationPath),
      attestationHash: attestation.hash,
      implementationPath,
      implementationHash,
      evidencePath: repositoryPath(validated.repositoryRoot, evidencePath),
      evidenceHash: evidence.hash,
    });
  }

  const manifestDocument = {
    schemaVersion: "wsgs-gdps-e2e-driver-manifest/1.0",
    sourceCommit: input.sourceCommit,
    handoffBundleHash: input.handoffBundleHash,
    operationLockHash: input.operationLockHash,
    provenanceHash: input.provenanceHash,
    runtimeIdentityHash: validated.runtimeIdentityHash,
    drivers: artifactSummaries.map((entry) => ({
      caseId: entry.caseId,
      driverKind: entry.driverKind,
      attestationPath: entry.attestationPath,
      attestationHash: entry.attestationHash,
      implementationPath: entry.implementationPath,
      implementationHash: entry.implementationHash,
      evidencePath: entry.evidencePath,
      evidenceHash: entry.evidenceHash,
    })),
  };
  const manifest = writeNewJson(validated.manifestPath, manifestDocument, input.gateRunId);
  return {
    schemaVersion: "wsgs-gdps-driver-orchestration-result/1.0",
    gateRunId: input.gateRunId,
    runtimeIdentityHash: validated.runtimeIdentityHash,
    manifestPath: repositoryPath(validated.repositoryRoot, validated.manifestPath),
    manifestHash: manifest.hash,
    drivers: Object.freeze(artifactSummaries.map((entry) => Object.freeze({ ...entry }))),
  };
}
