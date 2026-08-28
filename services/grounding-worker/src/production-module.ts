import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { GroundingIdentityV2 } from "@wsgs/delegated-identity";
import { GowmDelegationSigner, createGroundingIdentity } from "@wsgs/delegated-identity";
import {
  parseDeterministicReferences,
  type DeterministicParseResult
} from "@wsgs/deterministic-parser";
import {
  OperationalProductAssembler,
  type GroundingEvidenceItem,
  type OperationalRequestedProduct
} from "@wsgs/evidence-normalizer";
import {
  GOWM_SOUTHBOUND_LOCK_LF_SHA256,
  loadOperationalGowmLock,
  type LoadedOperationalGowmLock,
  type OperationalGowmLock,
  verifyGowmContractIntake
} from "@wsgs/gowm-contract-intake";
import {
  GowmExecutionEvidenceNormalizer,
  type EvidenceRequestedProduct,
  type ExecutionEvidenceProduct,
  type GowmExecutionRecord,
  type NormalizedExecutionEvidenceItem,
  type OperationExecutionContractTrace,
  type Sha256Digest
} from "@wsgs/gowm-execution-evidence";
import {
  GowmGatewayClient,
  type CapabilityDescriptor,
  type CapabilityCatalog,
  type CapabilitySemanticCatalog,
  type GatewayRequestContext,
  type OperationAvailabilityList,
  type OperationLock
} from "@wsgs/gowm-gateway-client";
import {
  buildGroundingGraphWithDegradation,
  type DegradedGroundingGraphResult,
  type MergedMention,
  type ReferenceGroundingResult,
  type ReferenceProduct,
  type ReferenceValidationProduct
} from "@wsgs/grounding-graph";
import {
  PIPELINE_STAGES,
  PipelineFenceRejectedError,
  ProductionPipelineStageExecutor,
  canonicalSha256,
  type PipelineStageContext,
  type ProductionAdmissionSnapshot
} from "@wsgs/grounding-pipeline";
import {
  QUERY_COMPILER_VERSION,
  CapabilityMatcher,
  TypedWorldQueryCompiler,
  queryTemplateRules,
  recipeSnapshotMode,
  type CapabilityGap,
  type CompileResult,
  type QuerySemanticPattern,
  type WorldQuerySubmission
} from "@wsgs/query-compiler";
import {
  REQUIREMENT_PLANNER_VERSION,
  SemanticRequirementPlanner,
  stableRecipeCatalog,
  type RequirementPlanningResult,
  type StableRecipeId,
  type WorldQueryRequirement
} from "@wsgs/requirement-planner";
import { stabilizeSemanticFrame } from "@wsgs/semantic-frame";
import {
  OpenAICompatibleSemanticModel,
  SemanticModelError,
  compileWorldSemanticFrameSchema,
  parseSemanticModelWithPolicy,
  semanticModelConfigFromEnvironment,
  type ModelReceipt,
  type SemanticModelParser,
  type SemanticModelPolicyMode,
  type SemanticModelPolicyResult
} from "@wsgs/semantic-model";
import {
  buildTrustedCapabilitySnapshot,
  verifyPersistedTrustedCapabilitySnapshot,
  type SchemaValidatedSouthboundLock,
  type TrustedCapabilitySnapshot
} from "@wsgs/trusted-capability-snapshot";
import { Pool, type PoolClient } from "pg";

type JsonObject = Record<string, unknown>;

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const lockPath = fileURLToPath(new URL(
  "../../../contracts/upstream/gowm-0.6.3/extracted/package/bundle/locks/wsgs-southbound-operation-lock-v2.json",
  import.meta.url
));
const frameSchemaPath = fileURLToPath(new URL(
  "../../../contracts/wsgs-v0.1/contracts/world-semantic-frame.schema.json",
  import.meta.url
));
const commonSchemaPath = fileURLToPath(new URL(
  "../../../contracts/wsgs-v0.1/contracts/common.schema.json",
  import.meta.url
));
const referenceIdPattern = /^wrf_[0-9a-f]{32}$/u;
const evidenceProducts = new Set<OperationalRequestedProduct>([
  "WORLD_EVIDENCE",
  "OPERATIONAL_TASKS",
  "EVENT_TIMELINES",
  "CORRELATION_FINDINGS",
  "PREDICATE_EVALUATIONS"
]);

export const PRODUCTION_STABLE_OPERATION_IDS = Object.freeze([
  "reference.get",
  "reference.resolve",
  "world.get-current-state",
  "world.get-geometry",
  "world.get-provenance",
  "catalog.get",
  "catalog.search",
  "spatial.find-nearby",
  "spatial.find-in-area",
  "spatial.find-intersections",
  "reference.validate",
  "result.validate"
] as const);

export class ProductionStageModuleError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
    message = code
  ) {
    super(message);
    this.name = "ProductionStageModuleError";
  }
}

interface PersistedAuthority {
  schemaVersion: "1.0";
  trustedCapabilitySnapshot: TrustedCapabilitySnapshot;
  capabilityCatalog: CapabilityCatalog;
  semanticCatalog: CapabilitySemanticCatalog;
  availability: OperationAvailabilityList;
  southboundLock: SchemaValidatedSouthboundLock;
}

interface LiveAuthority {
  persisted: PersistedAuthority;
  admission: ProductionAdmissionSnapshot;
}

interface Runtime {
  pool: Pool;
  ownsPool: boolean;
  operationalLock: LoadedOperationalGowmLock;
  gateway: GowmGatewayClient;
  signer: GowmDelegationSigner;
  model: SemanticModelParser;
  modelPolicy: SemanticModelPolicyMode;
  allowPreview: boolean;
}

type PersistedSemanticModelResult = SemanticModelPolicyResult & { receiptId?: string };

interface ProductionFactoryOptions {
  pool?: Pool;
}

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProductionStageModuleError(code);
  return value as JsonObject;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || !value) throw new ProductionStageModuleError(code);
  return value;
}

function integer(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new ProductionStageModuleError(code);
  return value as number;
}

function environmentText(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ProductionStageModuleError(`MISSING_${name}`);
  return value;
}

function environmentInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ProductionStageModuleError(`INVALID_${name}`);
  }
  return value;
}

function privateKey(): string {
  const inline = process.env["GOWM_DELEGATION_PRIVATE_KEY_PKCS8"];
  if (inline?.trim()) return inline.replaceAll("\\n", "\n");
  const path = process.env["GOWM_DELEGATION_PRIVATE_KEY_FILE"]?.trim();
  if (!path) throw new ProductionStageModuleError("MISSING_GOWM_DELEGATION_PRIVATE_KEY");
  return readFileSync(path, "utf8");
}

export function canonicalLfSha256(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  const decoded = buffer.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(buffer) || /\r(?!\n)/u.test(decoded)) {
    throw new ProductionStageModuleError("SOUTHBOUND_LOCK_NOT_CANONICAL_UTF8");
  }
  return createHash("sha256").update(decoded.replaceAll("\r\n", "\n"), "utf8").digest("hex");
}

function readOperationalLock(): LoadedOperationalGowmLock {
  const externalPath = process.env["GOWM_SOUTHBOUND_LOCK_FILE"]?.trim();
  if (externalPath) {
    const expectedSha256 = process.env["GOWM_SOUTHBOUND_LOCK_SHA256"]?.trim();
    if (!expectedSha256) throw new ProductionStageModuleError("MISSING_GOWM_SOUTHBOUND_LOCK_SHA256");
    return loadOperationalGowmLock({
      lockPath: externalPath,
      expectedSha256: expectedSha256 as `sha256:${string}`,
      hashMode: "EXACT_BYTES"
    });
  }
  if (process.env["GOWM_SOUTHBOUND_LOCK_SHA256"]?.trim()) {
    throw new ProductionStageModuleError("GOWM_SOUTHBOUND_LOCK_FILE_REQUIRED");
  }
  return loadOperationalGowmLock({
    lockPath,
    expectedSha256: `sha256:${GOWM_SOUTHBOUND_LOCK_LF_SHA256}`,
    hashMode: "CANONICAL_LF"
  });
}

function validatedLock(value: OperationalGowmLock): SchemaValidatedSouthboundLock {
  return value as SchemaValidatedSouthboundLock;
}

function gatewayLock(entry: OperationalGowmLock["defaultOperations"][number]): OperationLock {
  return {
    operationId: entry.operationId,
    operationVersion: entry.operationVersion,
    maturity: entry.maturity,
    inputSchemaHash: entry.inputSchemaHash,
    outputSchemaHash: entry.outputSchemaHash,
    semanticProfileHash: entry.semanticProfileHash,
    snapshotSupport: entry.snapshotSupport,
    requiredPermissions: [...entry.requiredPermissions]
  };
}

function allGatewayLocks(lock: OperationalGowmLock): OperationLock[] {
  return [...lock.defaultOperations, ...lock.previewOperations].map(gatewayLock);
}

export function selectProductionSouthboundLock(lock: OperationalGowmLock): OperationalGowmLock {
  const available = [...lock.defaultOperations, ...lock.previewOperations];
  const selected = PRODUCTION_STABLE_OPERATION_IDS.map((operationId) => {
    const entry = available.find((candidate) =>
      candidate.operationId === operationId && candidate.operationVersion === "1.0");
    if (!entry || entry.maturity !== "STABLE") {
      throw new ProductionStageModuleError(`PRODUCTION_STABLE_OPERATION_LOCK_MISSING_${operationId}`);
    }
    return entry;
  });
  return {
    ...lock,
    defaultOperations: selected,
    previewOperations: []
  };
}

class UnavailableSemanticModel implements SemanticModelParser {
  async parse(): Promise<never> {
    throw new SemanticModelError("MODEL_NOT_CONFIGURED", false);
  }
}

function createModel(policy: SemanticModelPolicyMode): SemanticModelParser {
  const configured = ["MODEL_BASE_URL", "MODEL_API_KEY", "MODEL_NAME"]
    .every((name) => Boolean(process.env[name]?.trim()));
  if (!configured) {
    if (policy === "MODEL_REQUIRED") throw new ProductionStageModuleError("MODEL_CONFIGURATION_REQUIRED");
    return new UnavailableSemanticModel();
  }
  const frameSchema = JSON.parse(readFileSync(frameSchemaPath, "utf8")) as unknown;
  const commonSchema = JSON.parse(readFileSync(commonSchemaPath, "utf8")) as unknown;
  const compiled = compileWorldSemanticFrameSchema(frameSchema, commonSchema);
  return new OpenAICompatibleSemanticModel(
    semanticModelConfigFromEnvironment(process.env),
    compiled.schema,
    compiled.validate
  );
}

function runtime(options: ProductionFactoryOptions = {}): Runtime {
  const operationalLock = readOperationalLock();
  const lock = operationalLock.lock;
  const productionLock = selectProductionSouthboundLock(lock);
  const trustedOperationKeys = productionLock.defaultOperations
    .map((entry) => `${entry.operationId}@${entry.operationVersion}`);
  const modelPolicy = (process.env["WSGS_MODEL_POLICY"]?.trim() ?? "MODEL_REQUIRED") as SemanticModelPolicyMode;
  if (modelPolicy !== "MODEL_REQUIRED" && modelPolicy !== "MODEL_OPTIONAL") {
    throw new ProductionStageModuleError("INVALID_WSGS_MODEL_POLICY");
  }
  const pool = options.pool ?? new Pool({
    connectionString: environmentText("DATABASE_URL"),
    max: environmentInteger("WSGS_PRODUCTION_MODULE_DATABASE_POOL_SIZE", 4, 1, 32),
    application_name: "wsgs-production-module"
  });
  const gateway = new GowmGatewayClient({
    baseUrl: environmentText("GOWM_GATEWAY_BASE_URL"),
    credential: () => environmentText("GOWM_GATEWAY_TOKEN"),
    timeoutMs: environmentInteger("GOWM_GATEWAY_TIMEOUT_MS", 10_000, 100, 120_000),
    maxRetries: environmentInteger("GOWM_GATEWAY_MAX_RETRIES", 2, 0, 5)
  });
  const signer = new GowmDelegationSigner({
    issuer: environmentText("GOWM_DELEGATION_ISSUER"),
    audience: environmentText("GOWM_DELEGATION_AUDIENCE"),
    servicePrincipalId: environmentText("GOWM_DELEGATION_SERVICE_PRINCIPAL_ID"),
    privateKeyPkcs8: privateKey(),
    trustedOperationKeys
  });
  return {
    pool,
    ownsPool: options.pool === undefined,
    operationalLock,
    gateway,
    signer,
    model: createModel(modelPolicy),
    modelPolicy,
    allowPreview: process.env["WSGS_ALLOW_PREVIEW_CAPABILITIES"] === "YES"
  };
}

let sharedRuntime: Runtime | undefined;
let cachedAuthority: { expiresAt: number; value: LiveAuthority } | undefined;
let staticIntakeVerified = false;

function readinessRuntime(): Runtime {
  sharedRuntime ??= runtime();
  return sharedRuntime;
}

function environmentList(name: string): string[] {
  return process.env[name]?.split(/[ ,]+/u).map((entry) => entry.trim()).filter(Boolean) ?? [];
}

function readinessIdentity(): GroundingIdentityV2 {
  const servicePrincipalId = environmentText("GOWM_DELEGATION_SERVICE_PRINCIPAL_ID");
  return createGroundingIdentity({
    servicePrincipalId,
    actorId: process.env["WSGS_READINESS_ACTOR_ID"]?.trim() || servicePrincipalId,
    dataScopes: [environmentText("WSGS_READINESS_DATA_SCOPE")],
    datasetScopes: environmentList("WSGS_READINESS_DATASET_SCOPES"),
    permissions: environmentList("WSGS_READINESS_PERMISSIONS").length > 0
      ? environmentList("WSGS_READINESS_PERMISSIONS")
      : ["data:read", "dataset:read"]
  });
}

async function liveAuthority(
  value: Runtime,
  force = false,
  principal: GroundingIdentityV2 = readinessIdentity()
): Promise<LiveAuthority> {
  const now = Date.now();
  if (!force && cachedAuthority && cachedAuthority.expiresAt > now) return cachedAuthority.value;
  if (!staticIntakeVerified) {
    verifyGowmContractIntake({ repositoryRoot, verifyRecordedEvidence: true });
    staticIntakeVerified = true;
  }
  const lock = value.operationalLock.lock;
  const productionLock = selectProductionSouthboundLock(lock);
  const requestId = `wsgs-readiness-${createHash("sha256").update(JSON.stringify({
    servicePrincipalId: principal.servicePrincipalId,
    actorId: principal.actorId,
    dataScopes: principal.dataScopes,
    datasetScopes: principal.datasetScopes
  })).digest("hex").slice(0, 24)}`;
  const signed = await value.signer.sign({
    kind: "WORLD_QUERY",
    identity: principal,
    requestId,
    plan: {
      nodes: productionLock.defaultOperations.map((entry, index) => ({
        nodeId: `Readiness_${index + 1}`,
        operation: { operationId: entry.operationId, operationVersion: entry.operationVersion }
      }))
    },
    dataScopes: principal.dataScopes,
    datasetScopes: principal.datasetScopes
  });
  const deadlineAt = new Date(now + environmentInteger("WSGS_READINESS_TIMEOUT_MS", 15_000, 500, 120_000));
  const publicContext = { deadlineAt };
  const authenticatedContext = { deadlineAt, requestId, delegationToken: signed.token };
  const [catalog, semantics, availability] = await Promise.all([
    // GOWM exposes catalog and semantic metadata without principal filtering;
    // availability is authenticated and filtered by exact operation grants.
    value.gateway.listCapabilities(publicContext),
    value.gateway.listCapabilitySemantics(publicContext),
    value.gateway.listOperationAvailability(authenticatedContext)
  ]);
  const trustedCapabilitySnapshot = buildTrustedCapabilitySnapshot({
    catalog: catalog as never,
    semantics,
    availability,
    southboundLock: validatedLock(productionLock),
    southboundLockHash: value.operationalLock.lockHash,
    capturedAt: new Date()
  });
  const validation = value.gateway.validateTrustedContracts({
    catalog,
    semantics,
    availability,
    required: productionLock.defaultOperations.map(gatewayLock),
    optional: [],
    expectedContractCatalogRevision: lock.contractCatalogRevision,
    expectedSemanticCatalogHash: lock.semanticCatalogHash
  });
  if (!validation.requiredReady) throw new ProductionStageModuleError("STABLE_GOWM_OPERATIONS_NOT_READY");
  await value.signer.ready();
  if (value.modelPolicy === "MODEL_REQUIRED") {
    const probeText = "2号车在哪里？";
    const probe = await value.model.parse({ sourceText: probeText, locale: "zh-CN" });
    stabilizeSemanticFrame(probe.frame, probeText);
  }
  const persisted: PersistedAuthority = {
    schemaVersion: "1.0",
    trustedCapabilitySnapshot,
    capabilityCatalog: catalog,
    semanticCatalog: semantics,
    availability,
    southboundLock: validatedLock(productionLock)
  };
  const admission: ProductionAdmissionSnapshot = {
    immutableLocks: persisted as unknown as Readonly<Record<string, unknown>>,
    gowmContractCatalogRevision: trustedCapabilitySnapshot.contractCatalogRevision,
    gowmSemanticCatalogHash: trustedCapabilitySnapshot.semanticCatalogHash,
    gowmConsumerPackageIntegrity: lock.consumerContractPackage.integrity,
    gowmOperationLockHash: trustedCapabilitySnapshot.southboundLockHash
  };
  const result = { persisted, admission };
  // Admission captures are scoped to the actual caller and must never replace
  // the readiness principal's cached view of filtered operation availability.
  if (!force) {
    cachedAuthority = {
      value: result,
      expiresAt: now + environmentInteger("WSGS_READINESS_CACHE_MS", 5_000, 0, 60_000)
    };
  }
  return result;
}

export async function checkReadiness(): Promise<{ ready: boolean; reasons: string[] }> {
  try {
    const value = readinessRuntime();
    await Promise.all([
      value.pool.query("SELECT 1 FROM wsgs.pipeline_checkpoint LIMIT 0"),
      liveAuthority(value)
    ]);
    return { ready: true, reasons: [] };
  } catch (error) {
    const code = error && typeof error === "object" && typeof (error as JsonObject)["code"] === "string"
      ? (error as JsonObject)["code"] as string
      : error instanceof Error ? error.name : "READINESS_FAILED";
    return { ready: false, reasons: [code] };
  }
}

/**
 * Uncached readiness probe used by qualification to exercise the current
 * environment (including MODEL_OPTIONAL) without mutating the API process's
 * cached production runtime.
 */
export async function checkReadinessForCurrentEnvironment(
  options: ProductionFactoryOptions = {}
): Promise<{ ready: boolean; reasons: string[] }> {
  try {
    const value = runtime(options);
    await Promise.all([
      value.pool.query("SELECT 1 FROM wsgs.pipeline_checkpoint LIMIT 0"),
      liveAuthority(value, true)
    ]);
    return { ready: true, reasons: [] };
  } catch (error) {
    const code = error && typeof error === "object" && typeof (error as JsonObject)["code"] === "string"
      ? (error as JsonObject)["code"] as string
      : error instanceof Error ? error.name : "READINESS_FAILED";
    return { ready: false, reasons: [code] };
  }
}

export async function captureAdmissionSnapshot(context: {
  identity: GroundingIdentityV2;
}): Promise<ProductionAdmissionSnapshot> {
  return (await liveAuthority(readinessRuntime(), true, context.identity)).admission;
}

function persistedAuthority(context: PipelineStageContext, gateway: GowmGatewayClient): PersistedAuthority {
  const authority = object(context.immutableLocks, "IMMUTABLE_AUTHORITY_MISSING") as unknown as PersistedAuthority;
  if (authority.schemaVersion !== "1.0") throw new ProductionStageModuleError("IMMUTABLE_AUTHORITY_VERSION");
  verifyPersistedTrustedCapabilitySnapshot(authority.trustedCapabilitySnapshot);
  const validation = gateway.validateTrustedContracts({
    catalog: authority.capabilityCatalog,
    semantics: authority.semanticCatalog,
    availability: authority.availability,
    required: authority.southboundLock.defaultOperations.map(gatewayLock),
    optional: authority.southboundLock.previewOperations.map((entry) => ({
      operationId: entry.operationId,
      operationVersion: entry.operationVersion
    })),
    expectedContractCatalogRevision: authority.trustedCapabilitySnapshot.contractCatalogRevision,
    expectedSemanticCatalogHash: authority.trustedCapabilitySnapshot.semanticCatalogHash
  });
  if (!validation.requiredReady) throw new ProductionStageModuleError("PERSISTED_AUTHORITY_INVALID");
  return authority;
}

function request(context: PipelineStageContext): JsonObject {
  return object(context.state["request"], "PIPELINE_REQUEST_MISSING");
}

function identity(context: PipelineStageContext): GroundingIdentityV2 & { dataScope: string } {
  return object(context.state["identity"], "PIPELINE_IDENTITY_MISSING") as unknown as GroundingIdentityV2 & { dataScope: string };
}

function idempotencyKey(context: PipelineStageContext): string {
  return text(context.state["idempotencyKey"], "PIPELINE_IDEMPOTENCY_KEY_MISSING");
}

function modelReceiptId(receipt: ModelReceipt): string {
  return `model-receipt-${canonicalSha256(receipt).slice("sha256:".length, "sha256:".length + 32)}`;
}

function stageValue<T>(context: PipelineStageContext, stage: string): T {
  const value = context.state[stage];
  if (value === undefined) throw new ProductionStageModuleError(`PIPELINE_${stage}_MISSING`);
  return value as T;
}

function operationLock(authority: PersistedAuthority, operationId: string): OperationLock {
  const entry = [...authority.southboundLock.defaultOperations, ...authority.southboundLock.previewOperations]
    .find((candidate) => candidate.operationId === operationId);
  if (!entry) throw new ProductionStageModuleError("OPERATION_LOCK_MISSING");
  return gatewayLock(entry);
}

export function capabilityCatalogHash(catalog: CapabilityCatalog): string {
  return canonicalSha256(catalog);
}

export function assertPriorGroundingReplaySupport(
  locks: readonly OperationLock[],
  priorGroundingCount: number
): void {
  if (priorGroundingCount === 0) return;
  for (const operationId of ["reference.validate", "result.validate"] as const) {
    const lock = locks.find((entry) => entry.operationId === operationId && entry.operationVersion === "1.0");
    if (!lock || lock.maturity !== "STABLE" || lock.snapshotSupport !== "PINNED") {
      throw new ProductionStageModuleError("PINNED_VALIDATION_OPERATION_UNAVAILABLE");
    }
  }
}

async function executeOperation(
  value: Runtime,
  context: PipelineStageContext,
  lock: OperationLock,
  input: JsonObject,
  suffix: string
): Promise<JsonObject> {
  const caller = identity(context);
  const authority = persistedAuthority(context, value.gateway);
  const descriptor = authority.capabilityCatalog.capabilities.find((candidate) =>
    candidate.operationId === lock.operationId && candidate.operationVersion === lock.operationVersion);
  if (!descriptor) throw new ProductionStageModuleError("GATEWAY_CAPABILITY_DESCRIPTOR_MISSING");
  const signed = await value.signer.sign({
    kind: "DIRECT_OPERATION",
    identity: caller,
    requestId: text(request(context)["requestId"], "REQUEST_ID_MISSING"),
    operation: { operationId: lock.operationId, operationVersion: lock.operationVersion },
    dataScopes: [caller.dataScope],
    datasetScopes: caller.datasetScopes
  });
  const callerPolicy = object(request(context)["executionPolicy"], "EXECUTION_POLICY_MISSING");
  const callerMaximumResultBytes = integer(callerPolicy["maxResultBytes"], "MAX_RESULT_BYTES_INVALID");
  const maximumResultBytes = Math.min(
    callerMaximumResultBytes,
    descriptor.limits.maximumOutputBytes ?? callerMaximumResultBytes
  );
  const deadlineAt = new Date(Math.min(
    context.deadlineAt.getTime(),
    Date.now() + descriptor.execution.maximumTimeoutMs
  ));
  const preferredExecution = descriptor.execution.mode === "SYNC"
    ? "SYNC" as const
    : descriptor.execution.mode === "ASYNC"
      ? "ASYNC" as const
      : "AUTO" as const;
  const executionRequest = {
    requestVersion: "1.0",
    requestId: text(request(context)["requestId"], "REQUEST_ID_MISSING"),
    idempotencyKey: `${idempotencyKey(context)}:${suffix}`,
    operationVersion: lock.operationVersion,
    inputSchemaHash: lock.inputSchemaHash,
    outputSchemaHash: lock.outputSchemaHash,
    input,
    executionPolicy: {
      deadlineAt: deadlineAt.toISOString(),
      maximumResultBytes,
      ...(descriptor.limits.maximumRows === undefined ? {} : { maximumRows: descriptor.limits.maximumRows }),
      ...(descriptor.limits.maximumCandidates === undefined
        ? {}
        : { maximumCandidates: descriptor.limits.maximumCandidates }),
      maximumCostClass: descriptor.execution.costClass,
      preferredExecution
    }
  };
  const gatewayContext: GatewayRequestContext = {
    signal: context.signal,
    deadlineAt,
    requestId: executionRequest.requestId,
    delegationToken: signed.token,
    preferAsync: preferredExecution !== "SYNC"
  };
  const response = await value.gateway.executeOperation(lock, executionRequest, gatewayContext);
  if (response.status === 200) return object(response.value, "INVALID_GATEWAY_ENVELOPE");
  const accepted = object(response.value, "INVALID_GATEWAY_ACCEPTANCE");
  const terminal = await value.gateway.pollJob(text(accepted["jobId"], "GATEWAY_JOB_ID_MISSING"), gatewayContext);
  if (terminal["status"] !== "COMPLETED" && terminal["status"] !== "PARTIAL") {
    throw new ProductionStageModuleError("GATEWAY_JOB_NOT_SUCCESSFUL");
  }
  return object(terminal["result"], "GATEWAY_JOB_RESULT_MISSING");
}

function envelopeValue(envelope: JsonObject, lock: OperationLock): unknown {
  const operation = object(envelope["operation"], "INVALID_GATEWAY_OPERATION");
  const snapshot = object(envelope["computeSnapshot"], "INVALID_COMPUTE_SNAPSHOT");
  const snapshotOperation = object(snapshot["operation"], "INVALID_COMPUTE_OPERATION");
  const schemas = object(snapshot["schemas"], "INVALID_COMPUTE_SCHEMAS");
  if (operation["operationId"] !== lock.operationId || operation["operationVersion"] !== lock.operationVersion ||
    snapshotOperation["operationId"] !== lock.operationId || schemas["inputSchemaHash"] !== lock.inputSchemaHash ||
    schemas["outputSchemaHash"] !== lock.outputSchemaHash) {
    throw new ProductionStageModuleError("GATEWAY_AUTHORITY_MISMATCH");
  }
  if (envelope["status"] === "NO_DATA") return null;
  if (envelope["status"] !== "COMPLETED" && envelope["status"] !== "PARTIAL") {
    throw new ProductionStageModuleError("GATEWAY_OPERATION_NOT_SUCCESSFUL");
  }
  const output = object(envelope["output"], "GATEWAY_OUTPUT_MISSING");
  if (output["schemaHash"] !== lock.outputSchemaHash) throw new ProductionStageModuleError("GATEWAY_OUTPUT_SCHEMA_MISMATCH");
  return output["value"];
}

function referenceKey(value: unknown): ReferenceProduct["referenceKey"] {
  const key = object(value, "INVALID_REFERENCE_KEY");
  if (key["namespace"] !== "gowm" || !referenceIdPattern.test(text(key["id"], "INVALID_REFERENCE_ID"))) {
    throw new ProductionStageModuleError("INVALID_REFERENCE_KEY");
  }
  return {
    namespace: "gowm",
    kind: text(key["kind"], "INVALID_REFERENCE_KIND"),
    id: key["id"] as string,
    version: text(key["version"], "INVALID_REFERENCE_VERSION")
  };
}

export function normalizeReferenceResolution(
  value: unknown,
  mentions: readonly MergedMention[]
): ReferenceGroundingResult {
  if (value === null) {
    return {
      mentions: mentions.map((mention) => ({ ...mention, status: "UNRESOLVED", candidateProductIds: [] })),
      referenceProducts: [], ambiguities: [],
      unresolvedMentions: mentions.map((mention) => ({ mentionId: mention.mentionId, surfaceText: mention.surfaceText, reason: "NO_DATA" })),
      validationResults: [], worldVersion: 0, resolverVersion: "gateway-no-data"
    };
  }
  const body = object(value, "INVALID_REFERENCE_RESOLVE_RESULT");
  const resolutions = body["resolutions"];
  if (body["schemaVersion"] !== "1.0" || !Array.isArray(resolutions)) throw new ProductionStageModuleError("INVALID_REFERENCE_RESOLVE_RESULT");
  const worldVersion = integer(body["worldVersion"], "INVALID_WORLD_VERSION");
  const byMention = new Map(mentions.map((mention) => [mention.mentionId, mention]));
  const products: ReferenceProduct[] = [];
  const grounded: ReferenceGroundingResult["mentions"] = [];
  const ambiguities: ReferenceGroundingResult["ambiguities"] = [];
  const unresolved: ReferenceGroundingResult["unresolvedMentions"] = [];
  const handledMentionIds = new Set<string>();
  for (const raw of resolutions) {
    const entry = object(raw, "INVALID_REFERENCE_RESOLUTION");
    const mentionId = text(entry["mentionId"], "INVALID_REFERENCE_MENTION");
    const mention = byMention.get(mentionId);
    if (!mention || handledMentionIds.has(mentionId) || !Array.isArray(entry["candidates"])) {
      throw new ProductionStageModuleError("UNKNOWN_REFERENCE_MENTION");
    }
    handledMentionIds.add(mentionId);
    const status = text(entry["status"], "INVALID_REFERENCE_STATUS") as ReferenceGroundingResult["mentions"][number]["status"];
    const ids: string[] = [];
    for (const [rank, rawCandidate] of entry["candidates"].entries()) {
      const candidate = object(rawCandidate, "INVALID_REFERENCE_CANDIDATE");
      const descriptor = object(candidate["candidate"], "INVALID_REFERENCE_DESCRIPTOR");
      const key = referenceKey(descriptor["referenceKey"]);
      const productId = `reference-product-${createHash("sha256").update(JSON.stringify({ mentionId, rank, key })).digest("hex").slice(0, 24)}`;
      products.push({
        productId, productKind: "RESOLVED_REFERENCE", referenceKey: key,
        referenceType: text(descriptor["referenceType"], "INVALID_REFERENCE_TYPE"),
        displayName: text(descriptor["displayName"], "INVALID_REFERENCE_DISPLAY_NAME"),
        matchedBy: text(candidate["matchedBy"], "INVALID_MATCH_KIND"),
        matchScore: Number(candidate["matchScore"]), sourceOperation: "reference.resolve",
        sourceWorldVersion: worldVersion, revalidationRequired: descriptor["revalidationRequired"] === true,
        safeSummary: { candidateRank: rank }
      });
      ids.push(productId);
    }
    grounded.push({ ...mention, status, candidateProductIds: ids });
    if (status === "AMBIGUOUS") {
      ambiguities.push({
        ambiguityId: `ambiguity-${createHash("sha256").update(`${mentionId}:${ids.join(":")}`).digest("hex").slice(0, 24)}`,
        mentionId, surfaceText: mention.surfaceText, candidateProductIds: ids,
        reason: "MULTIPLE_PLAUSIBLE_MATCHES"
      });
    }
    if (status === "UNRESOLVED" || status === "INVALID") unresolved.push({ mentionId, surfaceText: mention.surfaceText, reason: status });
  }
  for (const mention of mentions) {
    if (handledMentionIds.has(mention.mentionId)) continue;
    grounded.push({ ...mention, status: "UNRESOLVED", candidateProductIds: [] });
    unresolved.push({ mentionId: mention.mentionId, surfaceText: mention.surfaceText, reason: "UPSTREAM_RESULT_MISSING" });
  }
  return {
    mentions: grounded, referenceProducts: products, ambiguities, unresolvedMentions: unresolved,
    validationResults: [], worldVersion, resolverVersion: text(body["resolverVersion"], "INVALID_RESOLVER_VERSION")
  };
}

const stableReferenceKinds = new Set([
  "WORLD_OBJECT", "SPATIAL_OBJECT", "DATA_SCOPE", "DATASET", "LAYER", "LAYER_FEATURE",
  "QUERY_RESULT", "DERIVED_REFERENCE", "REFERENCE_SET", "OPERATIONAL_TASK"
]);
const nonReferenceKinds = new Set([
  "PUNCTUATION", "QUERY", "QUESTION", "INTERROGATIVE", "PRONOUN", "QUERY_WORD", "QUESTION_WORD"
]);
const interrogativeSurfaces = new Set([
  "哪里", "哪儿", "何处", "什么", "哪些", "哪个", "谁", "多少", "怎么", "如何",
  "where", "what", "which", "who", "how"
]);

function canonicalReferenceKind(raw: string): string | null {
  const normalized = raw.trim().toUpperCase().replace(/[ .-]+/gu, "_");
  if (stableReferenceKinds.has(normalized)) return normalized;
  if (["VEHICLE", "DEVICE", "SENSOR", "CAMERA", "TARGET", "OBJECT", "ENTITY"].includes(normalized)) {
    return "WORLD_OBJECT";
  }
  if (["ROAD", "STREET", "ZONE", "AREA", "REGION", "LOCATION", "PLACE", "FEATURE"].includes(normalized)) {
    return "LAYER_FEATURE";
  }
  return null;
}

export function productionReferenceMentions(mentions: readonly MergedMention[]): MergedMention[] {
  return mentions.flatMap((mention) => {
    const modelOnly = mention.extractionSources.every((source) => source === "DOMAIN_MODEL");
    const surface = mention.surfaceText.trim();
    const role = mention.semanticRole?.trim().toUpperCase().replace(/[ .-]+/gu, "_") ?? "";
    const rawKinds = mention.expectedKinds.map((kind) => kind.trim().toUpperCase().replace(/[ .-]+/gu, "_"));
    const punctuationOnly = /^[\p{P}\p{S}\s]+$/u.test(surface);
    const interrogative = interrogativeSurfaces.has(surface.toLocaleLowerCase("en-US"));
    const nonReferenceRole = nonReferenceKinds.has(role);
    const onlyNonReferenceKinds = rawKinds.length > 0 && rawKinds.every((kind) => nonReferenceKinds.has(kind));
    if (modelOnly && (punctuationOnly || interrogative || nonReferenceRole || onlyNonReferenceKinds)) return [];
    const expectedKinds = [...new Set(mention.expectedKinds.flatMap((kind) => {
      const canonical = canonicalReferenceKind(kind);
      return canonical ? [canonical] : [];
    }))].sort();
    return [{ ...mention, expectedKinds }];
  });
}

export function normalizeValidation(value: unknown): ReferenceValidationProduct[] {
  const body = object(value, "INVALID_REFERENCE_VALIDATE_RESULT");
  if (body["schemaVersion"] !== "1.0" || !Array.isArray(body["results"])) {
    throw new ProductionStageModuleError("INVALID_REFERENCE_VALIDATE_RESULT");
  }
  return body["results"].map((raw): ReferenceValidationProduct => {
    const entry = object(raw, "INVALID_REFERENCE_VALIDATION");
    if (typeof entry["status"] !== "string") {
      const existence = text(entry["existence"], "INVALID_REFERENCE_EXISTENCE");
      const freshness = text(entry["freshness"], "INVALID_REFERENCE_FRESHNESS");
      const usable = text(entry["usable"], "INVALID_REFERENCE_USABILITY");
      const snapshot = text(entry["snapshot"], "INVALID_REFERENCE_SNAPSHOT");
      const status: ReferenceValidationProduct["status"] = existence === "SCOPE_DENIED" ? "SCOPE_DENIED"
        : existence === "NOT_FOUND" ? "NOT_FOUND"
          : existence === "RETIRED" ? "EXPIRED"
            : freshness === "EXPIRED" ? "EXPIRED"
              : freshness === "STALE" || snapshot === "STALE" || usable === "REVALIDATE" ? "STALE"
                : usable === "YES" ? "VALID" : "NOT_FOUND";
      const warnings = Array.isArray(entry["reasons"])
        ? entry["reasons"].filter((item): item is string => typeof item === "string").slice(0, 64)
        : [];
      return {
        referenceKey: referenceKey(entry["referenceKey"]),
        status,
        revalidationRequired: usable !== "YES" || snapshot !== "CURRENT",
        warnings
      };
    }
    return {
      referenceKey: referenceKey(entry["referenceKey"]),
      status: text(entry["status"], "INVALID_REFERENCE_VALIDATION_STATUS") as ReferenceValidationProduct["status"],
      revalidationRequired: entry["revalidationRequired"] === true,
      warnings: Array.isArray(entry["warnings"])
        ? entry["warnings"].filter((item): item is string => typeof item === "string").slice(0, 64)
        : []
    };
  });
}

function requestParts(context: PipelineStageContext): {
  source: JsonObject; capsule: JsonObject; policy: JsonObject; requestedProducts: string[];
} {
  const value = request(context);
  const products = value["requestedProducts"];
  if (!Array.isArray(products) || products.some((entry) => typeof entry !== "string")) {
    throw new ProductionStageModuleError("REQUESTED_PRODUCTS_INVALID");
  }
  return {
    source: object(value["source"], "REQUEST_SOURCE_MISSING"),
    capsule: object(value["contextCapsule"], "CONTEXT_CAPSULE_MISSING"),
    policy: object(value["executionPolicy"], "EXECUTION_POLICY_MISSING"),
    requestedProducts: products as string[]
  };
}

export type RecipeOperationInputResult =
  | {
      status: "READY";
      requiredForProduct: string;
      operationInput: JsonObject;
      parameterValues: JsonObject;
    }
  | { status: "CAPABILITY_GAP"; gap: CapabilityGap };

export interface RecipeOperationInputOptions {
  recipeId: StableRecipeId;
  planning: RequirementPlanningResult;
  groundingGraph: DegradedGroundingGraphResult;
  references: ReferenceGroundingResult;
  locale?: string;
  maximumCandidates: number;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

function recipeInputGap(
  recipeId: StableRecipeId,
  requiredForProduct: string,
  code: string,
  details: JsonObject = {}
): RecipeOperationInputResult {
  const identity = { recipeId, requiredForProduct, code, ...details };
  return {
    status: "CAPABILITY_GAP",
    gap: {
      gapId: `gap-${canonicalSha256(identity).slice("sha256:".length, "sha256:".length + 24)}`,
      semanticCapability: recipeId,
      reason: "UNSUPPORTED_EXPRESSION",
      requiredForProduct,
      blocking: true,
      details: { code, recipeId, ...details }
    }
  };
}

function requirementChain(
  planning: RequirementPlanningResult,
  recipeId: StableRecipeId
): WorldQueryRequirement[] | null {
  const graph = planning.graph;
  const recipe = stableRecipeCatalog.find((entry) => entry.recipeId === recipeId);
  if (!graph || !recipe) return null;
  const byId = new Map(graph.requirements.map((entry) => [entry.requirementId, entry]));
  const starts = graph.requirements
    .filter((entry) => entry.requirementType === recipe.requirements[0])
    .sort((left, right) => left.requiredForProduct.localeCompare(right.requiredForProduct) ||
      left.requirementId.localeCompare(right.requirementId));
  for (const start of starts) {
    const chain = [start];
    let current = start;
    let complete = true;
    for (const type of recipe.requirements.slice(1)) {
      const next = graph.dependencies
        .filter((entry) => entry.fromRequirementId === current.requirementId)
        .map((entry) => byId.get(entry.toRequirementId))
        .filter((entry): entry is WorldQueryRequirement =>
          entry?.requirementType === type && entry.requiredForProduct === start.requiredForProduct)
        .sort((left, right) => left.requirementId.localeCompare(right.requirementId))[0];
      if (!next) {
        complete = false;
        break;
      }
      chain.push(next);
      current = next;
    }
    if (complete) return chain;
  }
  return null;
}

function referenceResolveInput(
  requirement: WorldQueryRequirement,
  graph: DegradedGroundingGraphResult,
  references: ReferenceGroundingResult,
  locale: string | undefined,
  maximumCandidates: number
): JsonObject | null {
  const mentionNodeIds = stringArray(requirement.inputs["mentionNodeIds"]);
  if (mentionNodeIds.length === 0) return null;
  const nodes = new Map(graph.graph.nodes.map((entry) => [entry.nodeId, entry]));
  const fallbackKinds = stringArray(requirement.inputs["expectedReferenceKinds"]);
  const mentions = mentionNodeIds.flatMap((nodeId) => {
    const node = nodes.get(nodeId);
    if (node?.kind !== "MENTION") return [];
    const payload = object(node.payload, "GROUNDING_GRAPH_MENTION_PAYLOAD_INVALID");
    const mentionId = typeof payload["mentionId"] === "string" ? payload["mentionId"] : "";
    const surfaceText = typeof payload["surfaceText"] === "string" ? payload["surfaceText"] : "";
    if (!mentionId || mentionId.length > 128 || !surfaceText || surfaceText.length > 512) return [];
    const expectedKinds = stringArray(payload["expectedKinds"])
      .concat(fallbackKinds)
      .filter((entry, index, values) => entry.length <= 128 && values.indexOf(entry) === index)
      .sort()
      .slice(0, 32);
    return [{ mentionId, surfaceText, ...(expectedKinds.length > 0 ? { expectedKinds } : {}) }];
  });
  if (mentions.length !== mentionNodeIds.length || mentions.length > 32) return null;
  const anchorReferenceKeys = references.referenceProducts
    .map((entry) => entry.referenceKey)
    .filter((entry, index, values) =>
      values.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(entry)) === index)
    .slice(0, 32);
  return {
    schemaVersion: "1.0",
    mentions,
    context: {
      anchorReferenceKeys,
      ...(locale && locale.length <= 32 ? { language: locale } : {})
    },
    limitPerMention: Math.max(1, Math.min(20, maximumCandidates))
  };
}

/** Builds only schema-shaped inputs justified by the planner graph; it never invents missing recipe data. */
export function buildRecipeOperationInput(options: RecipeOperationInputOptions): RecipeOperationInputResult {
  const chain = requirementChain(options.planning, options.recipeId);
  const fallbackProduct = options.planning.graph?.requirements.find((entry) => entry.required)?.requiredForProduct ?? "WORLD_QUERY";
  if (!chain) return recipeInputGap(options.recipeId, fallbackProduct, "RECIPE_REQUIREMENT_CHAIN_MISSING");
  const requiredForProduct = chain[0]!.requiredForProduct;
  if (options.recipeId === "CATALOG_SEARCH") {
    const requirement = chain[0]!;
    const mentionNodeIds = stringArray(requirement.inputs["mentionNodeIds"]);
    const dataKinds = stringArray(requirement.inputs["expectedReferenceKinds"])
      .filter((entry, index, values) => values.indexOf(entry) === index)
      .sort();
    if (mentionNodeIds.length === 0 && dataKinds.length === 0) {
      return recipeInputGap(options.recipeId, requiredForProduct, "CATALOG_SEARCH_INPUT_MISSING");
    }
    return {
      status: "READY",
      requiredForProduct,
      operationInput: {
        schemaVersion: "1.0",
        ...(dataKinds.length > 0 ? { dataKinds } : {}),
        limit: Math.max(1, Math.min(100, options.maximumCandidates))
      },
      parameterValues: {}
    };
  }
  if (options.recipeId === "PRIOR_RESULT_REVALIDATION") {
    return recipeInputGap(options.recipeId, requiredForProduct, "PINNED_PRIOR_RESULT_INPUT_UNAVAILABLE");
  }
  const resolve = chain.find((entry) => entry.requirementType === "RESOLVE_REFERENCE");
  if (!resolve) return recipeInputGap(options.recipeId, requiredForProduct, "REFERENCE_RESOLUTION_INPUT_MISSING");
  const operationInput = referenceResolveInput(
    resolve,
    options.groundingGraph,
    options.references,
    options.locale,
    options.maximumCandidates
  );
  if (!operationInput) return recipeInputGap(options.recipeId, requiredForProduct, "REFERENCE_MENTION_INPUT_MISSING");
  const parameterValues: JsonObject = {};
  if (options.recipeId === "REFERENCE_NEARBY") {
    const spatial = chain.find((entry) => entry.requirementType === "SPATIAL_NEARBY");
    const constraints = Array.isArray(spatial?.inputs["spatialConstraints"])
      ? spatial.inputs["spatialConstraints"] : [];
    const distances = constraints.flatMap((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const distanceMm = (raw as JsonObject)["distanceMm"];
      return Number.isSafeInteger(distanceMm) && (distanceMm as number) > 0 ? [distanceMm as number] : [];
    }).filter((entry, index, values) => values.indexOf(entry) === index);
    if (distances.length !== 1) {
      return recipeInputGap(options.recipeId, requiredForProduct, "NEARBY_DISTANCE_MM_MISSING_OR_AMBIGUOUS", {
        distanceCount: distances.length
      });
    }
    const distanceM = distances[0]! / 1_000;
    if (!Number.isFinite(distanceM) || distanceM <= 0 || distanceM > 20_000_000) {
      return recipeInputGap(options.recipeId, requiredForProduct, "NEARBY_DISTANCE_OUT_OF_RANGE");
    }
    parameterValues["distanceM"] = distanceM;
  }
  for (const [recipeId, requirementType] of [
    ["REFERENCE_IN_AREA", "SPATIAL_IN_AREA"],
    ["REFERENCE_INTERSECTIONS", "SPATIAL_INTERSECTS"]
  ] as const) {
    if (options.recipeId !== recipeId) continue;
    const spatial = chain.find((entry) => entry.requirementType === requirementType);
    if (!Array.isArray(spatial?.inputs["spatialConstraints"]) || spatial.inputs["spatialConstraints"].length === 0) {
      return recipeInputGap(options.recipeId, requiredForProduct, "SPATIAL_CONSTRAINT_INPUT_MISSING");
    }
  }
  return { status: "READY", requiredForProduct, operationInput, parameterValues };
}

function mappedGap(gap: CapabilityGap | JsonObject): JsonObject {
  const reason = String(gap.reason);
  const normalized = ["NOT_REGISTERED"].includes(reason) ? "NOT_REGISTERED"
    : reason === "MATURITY_NOT_ALLOWED" ? "MATURITY_NOT_ALLOWED"
      : ["OPERATION_UNAVAILABLE", "OPERATION_DEGRADED", "AVAILABILITY_STALE"].includes(reason) ? "PROVIDER_UNAVAILABLE"
        : reason === "BUDGET_EXCEEDED" ? "BUDGET_EXCEEDED"
          : ["SCHEMA_MISMATCH", "SEMANTIC_MISMATCH", "PORT_MISMATCH"].includes(reason) ? "SCHEMA_MISMATCH"
            : "UNSUPPORTED_EXPRESSION";
  return {
    gapId: String(gap.gapId), semanticCapability: String(gap.semanticCapability), reason: normalized,
    requiredForProduct: String(gap.requiredForProduct), blocking: gap.blocking !== false,
    details: object(gap.details ?? {}, "INVALID_GAP_DETAILS")
  };
}

function resultDocument(context: PipelineStageContext, evidenceItems: GroundingEvidenceItem[] = []): JsonObject {
  const parts = requestParts(context);
  const deterministic = context.state["DETERMINISTIC_PARSE"] as DeterministicParseResult | undefined;
  const semantic = context.state["SEMANTIC_MODEL_PARSE"] as PersistedSemanticModelResult | undefined;
  const graph = context.state["GROUNDING_GRAPH_BUILD"] as DegradedGroundingGraphResult | undefined;
  const references = context.state["REFERENCE_VALIDATE"] as ReferenceGroundingResult | undefined;
  const planning = context.state["REQUIREMENT_PLAN"] as RequirementPlanningResult | undefined;
  const compiled = context.state["WORLD_QUERY_COMPILE"] as { compiled: CompileResult[]; capabilityGaps: JsonObject[] } | undefined;
  const executed = context.state["GOWM_EXECUTE"] as { outcomes: Array<{ submission: WorldQuerySubmission; status: string; resultHash: string }> } | undefined;
  const normalized = context.state["EVIDENCE_NORMALIZE"] as { status: "COMPLETED" | "PARTIAL"; evidenceItems: GroundingEvidenceItem[]; capabilityGaps: JsonObject[] } | undefined;
  const gaps = [
    ...(planning?.capabilityGaps ?? []).map((entry) => mappedGap(entry as unknown as JsonObject)),
    ...(compiled?.capabilityGaps ?? []).map(mappedGap),
    ...(normalized?.capabilityGaps ?? []).map(mappedGap)
  ];
  const warnings = [
    ...(deterministic?.warnings ?? []),
    ...(semantic?.warnings ?? []),
    ...(graph?.warnings ?? []),
    ...(references?.validationResults.flatMap((entry) => entry.warnings) ?? [])
  ];
  const ambiguities = references?.ambiguities ?? [];
  const unresolved = references?.unresolvedMentions ?? [];
  const partial = semantic?.completionStatus === "PARTIAL" || graph?.completionStatus === "PARTIAL" ||
    normalized?.status === "PARTIAL" || gaps.some((gap) => gap["blocking"] === true);
  const status = ambiguities.length > 0 ? "AMBIGUOUS" : unresolved.length > 0 && (references?.referenceProducts.length ?? 0) === 0
    ? "UNRESOLVED" : partial ? "PARTIAL" : "COMPLETED";
  const queryRecords = executed?.outcomes.map((entry) => ({
    queryId: entry.submission.plan.queryId,
    status: ["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].includes(entry.status) ? entry.status : "FAILED",
    resultHash: entry.resultHash
  })) ?? compiled?.compiled.flatMap((entry) => entry.status === "COMPILED" ? [{
    queryId: entry.submission.plan.queryId, status: "COMPLETED", resultHash: entry.planHash
  }] : []) ?? [];
  const source = parts.source;
  const receipt = semantic?.receiptId ? [semantic.receiptId] : [];
  return {
    schemaVersion: "1.0",
    requestId: request(context)["requestId"],
    groundingId: context.groundingId,
    status,
    source: { messageId: source["messageId"], originalTextSha256: source["originalTextSha256"] },
    mentions: references?.mentions ?? graph?.mergedMentions.map((mention) => ({
      ...mention, status: "UNRESOLVED", candidateProductIds: []
    })) ?? [],
    ...(semantic ? { semanticFrame: semantic.frame } : {}),
    ...(graph ? { groundingGraph: graph.graph } : {}),
    referenceProducts: references?.referenceProducts ?? [],
    evidenceItems: normalized?.evidenceItems ?? evidenceItems,
    ...(queryRecords.length > 0 ? { gowmQueries: queryRecords } : {}),
    ambiguities,
    unresolvedMentions: unresolved,
    capabilityGaps: gaps,
    warnings: [...new Set(warnings)].slice(0, 256),
    execution: {
      parserVersion: deterministic?.parserVersion ?? "deterministic-parser/not-run",
      semanticModelReceiptIds: receipt,
      queryCompilerVersion: QUERY_COMPILER_VERSION,
      normalizerVersion: "gowm-execution-evidence/2.0",
      elapsedMs: Math.max(0, Date.now() - Date.parse(String((stageValue<JsonObject>(context, "LOAD_CONTEXT"))["startedAt"])))
    }
  };
}

async function transaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function withFence(context: PipelineStageContext, pool: Pool, run: (client: PoolClient) => Promise<void>): Promise<void> {
  await transaction(pool, async (client) => {
    const owned = await client.query(
      `SELECT 1 FROM wsgs.grounding_job
        WHERE job_id = $1 AND lease_token = $2 AND stage_generation = $3
          AND status = 'RUNNING' AND cancel_requested_at IS NULL
        FOR UPDATE`,
      [context.jobId, context.leaseToken, context.generation]
    );
    if (owned.rowCount !== 1) throw new PipelineFenceRejectedError();
    await run(client);
  });
}

interface EncryptedCheckpointEvidenceMaterial {
  /** Raw GOWM envelopes are required for receipt verification and exist only inside the AES-GCM checkpoint. */
  checkpointProtection: "AES_256_GCM_INTERNAL_ONLY";
  responseStatus: number;
  response: unknown;
  terminal?: unknown;
}

interface PersistedWorldQueryOutcome extends JsonObject {
  submission: WorldQuerySubmission;
  status: string;
  resultHash: string;
  encryptedCheckpointEvidenceMaterial: EncryptedCheckpointEvidenceMaterial;
}

function finalWorldResult(outcome: PersistedWorldQueryOutcome): JsonObject {
  const material = outcome.encryptedCheckpointEvidenceMaterial;
  if (material.responseStatus === 200) return object(material.response, "WORLD_QUERY_RESULT_INVALID");
  const terminal = object(material.terminal, "WORLD_QUERY_JOB_INVALID");
  return object(terminal["result"], "WORLD_QUERY_JOB_RESULT_MISSING");
}

export async function persistAcceptedWorldQueryJob(
  context: PipelineStageContext,
  pool: Pool,
  submission: WorldQuerySubmission,
  acceptedValue: unknown
): Promise<void> {
  const accepted = object(acceptedValue, "WORLD_QUERY_ACCEPTANCE_INVALID");
  const jobId = text(accepted["jobId"], "WORLD_QUERY_JOB_ID_MISSING");
  const gatewayQueryId = typeof accepted["queryId"] === "string"
    ? accepted["queryId"] : submission.plan.queryId;
  const upstreamStatus = typeof accepted["status"] === "string" ? accepted["status"] : "QUEUED";
  await withFence(context, pool, async (client) => {
    const updated = await client.query(
      `UPDATE wsgs.world_query
          SET gateway_query_id = $2, gateway_job_id = $3,
              upstream_job_id = $3, upstream_status = $4
        WHERE query_id = $1 AND grounding_id = $5`,
      [submission.plan.queryId, gatewayQueryId, jobId, upstreamStatus, context.groundingId]
    );
    if (updated.rowCount !== 1) throw new PipelineFenceRejectedError();
  });
}

function pointer(value: unknown, path: string, code: string): unknown {
  if (!path.startsWith("/")) throw new ProductionStageModuleError(code);
  let current = value;
  for (const encoded of path.slice(1).split("/")) {
    const part = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(part)) throw new ProductionStageModuleError(code);
      current = current[Number(part)];
      continue;
    }
    if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) {
      throw new ProductionStageModuleError(code);
    }
    current = (current as JsonObject)[part];
  }
  return structuredClone(current);
}

function assignPointer(target: JsonObject, path: string, value: unknown): void {
  if (!/^\/(?:[^/~]|~[01])+(?:\/(?:[^/~]|~[01])+)*$/u.test(path)) {
    throw new ProductionStageModuleError("WORLD_QUERY_NODE_TARGET_PATH_INVALID");
  }
  const segments = path.slice(1).split("/").map((entry) => entry.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (segments.some((entry) => ["__proto__", "prototype", "constructor"].includes(entry))) {
    throw new ProductionStageModuleError("WORLD_QUERY_NODE_TARGET_PATH_UNSAFE");
  }
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    if (!Object.hasOwn(current, segment)) current[segment] = Object.create(null) as JsonObject;
    current = object(current[segment], "WORLD_QUERY_NODE_TARGET_PATH_COLLISION");
  }
  const leaf = segments.at(-1)!;
  if (Object.hasOwn(current, leaf)) throw new ProductionStageModuleError("WORLD_QUERY_NODE_TARGET_PATH_COLLISION");
  current[leaf] = structuredClone(value);
}

/** Replays the gateway's binding rules from the submitted DAG and returned upstream values. */
export function computeWorldQueryNodeRequestHashes(
  submission: WorldQuerySubmission,
  worldResult: unknown,
  capabilities: readonly CapabilityDescriptor[]
): Record<string, Sha256Digest> {
  const world = object(worldResult, "WORLD_QUERY_RESULT_INVALID");
  const rawNodes = Array.isArray(world["nodes"]) ? world["nodes"] : [];
  const results = new Map(rawNodes.map((raw) => {
    const node = object(raw, "WORLD_QUERY_NODE_INVALID");
    return [text(node["nodeId"], "WORLD_QUERY_NODE_ID_MISSING"), node] as const;
  }));
  const planByNode = new Map(submission.plan.nodes.map((node) => [node.nodeId, node]));
  const descriptor = (nodeId: string): CapabilityDescriptor => {
    const operation = planByNode.get(nodeId)?.operation;
    const value = capabilities.find((entry) =>
      entry.operationId === operation?.operationId && entry.operationVersion === operation.operationVersion);
    if (!value) throw new ProductionStageModuleError("WORLD_QUERY_CAPABILITY_MISSING");
    return value;
  };
  const resolveBinding = (binding: WorldQuerySubmission["plan"]["nodes"][number]["inputs"][string]): unknown => {
    if (binding.kind === "LITERAL") return structuredClone(binding.value);
    if (binding.kind === "REQUEST_PATH") {
      return pointer(submission.parameters, binding.path, "WORLD_QUERY_REQUEST_PATH_UNRESOLVED");
    }
    if (binding.kind !== "NODE_OUTPUT") throw new ProductionStageModuleError("WORLD_QUERY_BINDING_KIND_UNSUPPORTED");
    const sourceNodeId = text(binding.nodeId, "WORLD_QUERY_SOURCE_NODE_MISSING");
    const source = results.get(sourceNodeId);
    if (!source) throw new ProductionStageModuleError("WORLD_QUERY_SOURCE_NODE_OUTPUT_MISSING");
    const sourceStatus = String(source["status"]);
    if (!["COMPLETED", "PARTIAL", "NO_DATA"].includes(sourceStatus)) {
      const safeStatus = /^[A-Z][A-Z0-9_]{0,63}$/u.test(sourceStatus) ? sourceStatus : "INVALID";
      const sourceOperation = planByNode.get(sourceNodeId)?.operation.operationId ?? "unknown";
      const safeOperation = sourceOperation.toUpperCase().replace(/[^A-Z0-9]+/gu, "_").slice(0, 64);
      const nodeError = source["error"] && typeof source["error"] === "object" && !Array.isArray(source["error"])
        ? (source["error"] as JsonObject)["code"] : undefined;
      const safeError = typeof nodeError === "string"
        ? nodeError.toUpperCase().replace(/[^A-Z0-9]+/gu, "_").slice(0, 96)
        : "NO_ERROR_CODE";
      throw new ProductionStageModuleError(
        `WORLD_QUERY_SOURCE_NODE_OUTPUT_UNAVAILABLE_${safeOperation}_${safeStatus}_${safeError}`
      );
    }
    const envelope = object(source["result"], "WORLD_QUERY_SOURCE_ENVELOPE_MISSING");
    const output = object(envelope["output"], "WORLD_QUERY_SOURCE_OUTPUT_MISSING");
    const outputPort = descriptor(sourceNodeId).ports.outputs.find((entry) =>
      entry.name === text(binding.outputPort, "WORLD_QUERY_OUTPUT_PORT_MISSING"));
    if (!outputPort) throw new ProductionStageModuleError("WORLD_QUERY_OUTPUT_PORT_UNREGISTERED");
    return outputPort.path === undefined
      ? structuredClone(output["value"])
      : pointer(output["value"], outputPort.path, "WORLD_QUERY_SOURCE_OUTPUT_PATH_UNRESOLVED");
  };
  const hashes: Record<string, Sha256Digest> = {};
  for (const rawNode of rawNodes) {
    const returned = object(rawNode, "WORLD_QUERY_NODE_INVALID");
    const nodeId = text(returned["nodeId"], "WORLD_QUERY_NODE_ID_MISSING");
    const planned = planByNode.get(nodeId);
    if (!planned) throw new ProductionStageModuleError("WORLD_QUERY_NODE_NOT_IN_PLAN");
    const entries = Object.entries(planned.inputs).map(([name, binding]) => ({
      name,
      binding,
      value: resolveBinding(binding)
    }));
    const operation = descriptor(nodeId);
    const wholeRequest = entries.length === 1 && entries[0]?.name === "request" &&
      entries[0].binding.targetPath === undefined && operation.ports.inputs.length === 1 &&
      operation.ports.inputs[0]?.name === "request";
    let actualInput: unknown;
    if (wholeRequest) {
      actualInput = entries[0]!.value;
    } else {
      const assembled = Object.create(null) as JsonObject;
      for (const entry of entries) {
        assignPointer(assembled, entry.binding.targetPath ?? `/${entry.name.replaceAll("~", "~0").replaceAll("/", "~1")}`, entry.value);
      }
      actualInput = assembled;
    }
    const digest = canonicalSha256(actualInput);
    if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) throw new ProductionStageModuleError("WORLD_QUERY_NODE_INPUT_HASH_INVALID");
    hashes[nodeId] = digest as Sha256Digest;
  }
  return hashes;
}

function jsonByteLength(value: unknown): number {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new ProductionStageModuleError("EVIDENCE_PAYLOAD_NOT_JSON");
  return Buffer.byteLength(encoded, "utf8");
}

export function oversizedEvidencePayload(world: JsonObject, maximumInlineBytes: number): { path: string; byteCount: number } | null {
  const candidates: Array<{ path: string; value: unknown }> = [{ path: "WORLD_QUERY_OUTPUTS", value: world["outputs"] }];
  if (Array.isArray(world["nodes"])) {
    for (const raw of world["nodes"]) {
      const node = object(raw, "WORLD_QUERY_NODE_INVALID");
      if (node["result"] === undefined) continue;
      const envelope = object(node["result"], "WORLD_QUERY_SOURCE_ENVELOPE_MISSING");
      if (envelope["output"] === undefined) continue;
      const output = object(envelope["output"], "WORLD_QUERY_SOURCE_OUTPUT_MISSING");
      candidates.push({ path: text(node["nodeId"], "WORLD_QUERY_NODE_ID_MISSING"), value: output["value"] });
    }
  }
  for (const candidate of candidates) {
    const byteCount = jsonByteLength(candidate.value);
    if (byteCount > maximumInlineBytes) return { path: candidate.path, byteCount };
  }
  return null;
}

function publicEvidenceItem(item: NormalizedExecutionEvidenceItem): GroundingEvidenceItem {
  return {
    evidenceProductId: item.evidenceProductId,
    productKind: item.productKind,
    authority: "gowm",
    sourceOperation: item.sourceOperation,
    ...(item.sourceNodeId ? { sourceNodeId: item.sourceNodeId } : {}),
    upstreamStatus: item.upstreamStatus,
    payloadSchemaUri: item.payloadSchemaUri,
    payloadSchemaHash: item.payloadSchemaHash,
    ...(item.payload.kind === "INLINE" ? { safePayload: item.payload.value } : {}),
    ...(item.payload.kind === "OBJECT_REFERENCE" ? { payloadRef: item.payload.payloadRef } : {}),
    ...(item.dataSnapshot ? { dataSnapshot: { ...item.dataSnapshot } } : {}),
    computeSnapshot: { ...item.computeSnapshot },
    receiptIds: [...item.receiptIds],
    evidenceIds: [...item.evidenceIds],
    unknowns: [...item.unknowns],
    warnings: [...item.warnings]
  };
}

async function persistExecutionRecords(
  context: PipelineStageContext,
  pool: Pool,
  records: readonly GowmExecutionRecord[]
): Promise<void> {
  await withFence(context, pool, async (client) => {
    for (const record of records) {
      await client.query(
        `INSERT INTO wsgs.gowm_execution(
           execution_id, grounding_id, data_scope, actor_id, execution_kind,
           operation_id, operation_version, gateway_query_id, gateway_job_id,
           request_hash, result_hash, normalized_status, upstream_status,
           data_snapshot, compute_snapshot, snapshot_adherence,
           receipt_ids, evidence_ids, started_at, finished_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
           $14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20
         ) ON CONFLICT (execution_id) DO NOTHING`,
        [record.executionId, context.groundingId, identity(context).dataScope,
          identity(context).actorId, record.executionKind,
          record.operationId ?? null, record.operationVersion ?? null,
          record.gatewayQueryId ?? null, record.gatewayJobId ?? null,
          record.requestHash, record.resultHash ?? null, record.normalizedStatus,
          record.upstreamStatus, JSON.stringify(record.dataSnapshot ?? null),
          JSON.stringify(record.computeSnapshot ?? null), JSON.stringify(record.snapshotAdherence ?? null),
          JSON.stringify(record.receiptIds), JSON.stringify(record.evidenceIds),
          record.startedAt, record.finishedAt]
      );
    }
  });
}

export async function createPipelineStageExecutor(
  options: ProductionFactoryOptions = {}
): Promise<ProductionPipelineStageExecutor> {
  const value = runtime(options);
  await value.signer.ready();
  const planner = new SemanticRequirementPlanner();
  const matcher = new CapabilityMatcher();
  const compiler = new TypedWorldQueryCompiler();
  const evidenceNormalizer = new GowmExecutionEvidenceNormalizer();
  const productAssembler = new OperationalProductAssembler();

  return new ProductionPipelineStageExecutor({
    LOAD_CONTEXT: async (context) => {
      const parts = requestParts(context);
      const authority = persistedAuthority(context, value.gateway);
      const priorGroundings = Array.isArray(parts.capsule["priorGroundings"])
        ? parts.capsule["priorGroundings"]
        : [];
      // W11 requires replay of the exact historical snapshot. The current
      // frozen 0.6.3 locks expose CONSISTENT_AT_START only, so accepting a
      // prior result here would silently weaken its authority boundary.
      assertPriorGroundingReplaySupport(allGatewayLocks(authority.southboundLock), priorGroundings.length);
      const snapshot = authority.trustedCapabilitySnapshot;
      const snapshotId = `capability-snapshot-${canonicalSha256({
        groundingId: context.groundingId,
        snapshotHash: snapshot.snapshotHash
      }).slice("sha256:".length, "sha256:".length + 32)}`;
      await withFence(context, value.pool, async (client) => {
        await client.query(
          `INSERT INTO wsgs.capability_snapshot(
             snapshot_id, grounding_id, data_scope, catalog_hash, catalog,
             contract_catalog_revision, semantic_catalog_hash, binding_revision,
             availability_snapshot, availability_hash, operation_lock_hash,
             consumer_package_integrity, snapshot_hash
           ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)
           ON CONFLICT (snapshot_id) DO NOTHING`,
          [snapshotId, context.groundingId, identity(context).dataScope,
            capabilityCatalogHash(authority.capabilityCatalog), JSON.stringify(authority.capabilityCatalog),
            snapshot.contractCatalogRevision, snapshot.semanticCatalogHash,
            snapshot.bindingRevision, JSON.stringify(authority.availability),
            canonicalSha256(authority.availability), snapshot.southboundLockHash,
            snapshot.consumerPackageIntegrity, snapshot.snapshotHash]
        );
      });
      return {
        startedAt: new Date().toISOString(),
        capabilitySnapshotId: snapshotId,
        knownWorldReferences: parts.capsule["knownWorldReferences"],
        priorGroundings,
        mapSelections: parts.capsule["mapSelections"],
        externalCorrelationHints: parts.capsule["externalCorrelationHints"],
        externalPredicates: parts.capsule["externalPredicates"]
      };
    },

    DETERMINISTIC_PARSE: async (context) => {
      const parts = requestParts(context);
      return parseDeterministicReferences({
        originalText: text(parts.source["originalText"], "SOURCE_TEXT_MISSING"),
        focusSpans: Array.isArray(parts.source["focusSpans"]) ? parts.source["focusSpans"] as never[] : [],
        knownWorldReferences: Array.isArray(parts.capsule["knownWorldReferences"]) ? parts.capsule["knownWorldReferences"] as never[] : [],
        mapSelections: Array.isArray(parts.capsule["mapSelections"]) ? parts.capsule["mapSelections"] as never[] : [],
        priorGroundings: Array.isArray(parts.capsule["priorGroundings"]) ? parts.capsule["priorGroundings"] as never[] : []
      });
    },

    SEMANTIC_MODEL_PARSE: async (context) => {
      const parts = requestParts(context);
      const deterministic = stageValue<DeterministicParseResult>(context, "DETERMINISTIC_PARSE");
      const parsed = await parseSemanticModelWithPolicy(value.model, {
        sourceText: text(parts.source["originalText"], "SOURCE_TEXT_MISSING"),
        ...(typeof parts.source["locale"] === "string" ? { locale: parts.source["locale"] } : {}),
        excludedSpans: deterministic.mentions.map((mention) => mention.span)
      }, value.modelPolicy, context.signal);
      const receipt = parsed.receipt;
      if (!receipt) return parsed;
      const receiptId = modelReceiptId(receipt);
      await withFence(context, value.pool, async (client) => {
        await client.query(
          `INSERT INTO wsgs.model_receipt(
             receipt_id, grounding_id, data_scope, model_name_hash, prompt_hash,
             schema_hash, input_hash, output_hash, status, elapsed_ms
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (receipt_id) DO NOTHING`,
          [receiptId, context.groundingId, identity(context).dataScope,
            receipt.modelHash, receipt.promptHash, receipt.schemaHash,
            receipt.inputHash, receipt.outputHash || null, receipt.status, receipt.elapsedMs]
        );
      });
      return { ...parsed, receiptId };
    },

    SEMANTIC_FRAME_VALIDATE: async (context) => {
      const parts = requestParts(context);
      const model = stageValue<PersistedSemanticModelResult>(context, "SEMANTIC_MODEL_PARSE");
      return { ...model, frame: stabilizeSemanticFrame(model.frame, text(parts.source["originalText"], "SOURCE_TEXT_MISSING")) };
    },

    GROUNDING_GRAPH_BUILD: async (context) => {
      const parts = requestParts(context);
      const deterministic = stageValue<DeterministicParseResult>(context, "DETERMINISTIC_PARSE");
      const model = stageValue<PersistedSemanticModelResult>(context, "SEMANTIC_FRAME_VALIDATE");
      return buildGroundingGraphWithDegradation(
        text(parts.source["originalText"], "SOURCE_TEXT_MISSING"),
        deterministic,
        model.status === "AVAILABLE" ? { status: "AVAILABLE", frame: model.frame } : { status: "UNAVAILABLE", failureCode: model.failureCode }
      );
    },

    REFERENCE_RESOLVE: async (context) => {
      const authority = persistedAuthority(context, value.gateway);
      const graph = stageValue<DegradedGroundingGraphResult>(context, "GROUNDING_GRAPH_BUILD");
      const referenceMentions = productionReferenceMentions(graph.mergedMentions);
      if (referenceMentions.length === 0) return normalizeReferenceResolution(null, []);
      const parts = requestParts(context);
      const lock = operationLock(authority, "reference.resolve");
      const envelope = await executeOperation(value, context, lock, {
        schemaVersion: "1.0",
        mentions: referenceMentions.map((mention) => ({
          mentionId: mention.mentionId, surfaceText: mention.surfaceText,
          ...(mention.expectedKinds.length > 0 ? { expectedKinds: mention.expectedKinds } : {})
        })),
        context: { language: parts.source["locale"], anchorReferenceKeys: [] },
        limitPerMention: parts.policy["maxCandidatesPerMention"]
      }, "reference-resolve");
      return normalizeReferenceResolution(envelopeValue(envelope, lock), referenceMentions);
    },

    REFERENCE_VALIDATE: async (context) => {
      const authority = persistedAuthority(context, value.gateway);
      const resolved = context.state["REFERENCE_RESOLVE"] as ReferenceGroundingResult | undefined;
      const parts = requestParts(context);
      const known = Array.isArray(parts.capsule["knownWorldReferences"])
        ? parts.capsule["knownWorldReferences"].map((entry) => object(entry, "INVALID_KNOWN_REFERENCE")) : [];
      const references = resolved?.referenceProducts.map((entry) => ({
        referenceKey: entry.referenceKey, requireCurrentSnapshot: true
      })) ?? known.map((entry) => ({ referenceKey: referenceKey(entry["referenceKey"]), requireCurrentSnapshot: true }));
      if (references.length === 0) return resolved ?? normalizeReferenceResolution(null, []);
      const lock = operationLock(authority, "reference.validate");
      const envelope = await executeOperation(value, context, lock, { schemaVersion: "1.0", references }, "reference-validate");
      const validations = normalizeValidation(envelopeValue(envelope, lock));
      const result = resolved ?? {
        mentions: [],
        referenceProducts: known.map((entry, index): ReferenceProduct => ({
          productId: `known-reference-${index}-${createHash("sha256").update(JSON.stringify(entry["referenceKey"])).digest("hex").slice(0, 16)}`,
          productKind: "RESOLVED_REFERENCE", referenceKey: referenceKey(entry["referenceKey"]),
          referenceType: text(entry["referenceType"], "INVALID_REFERENCE_TYPE"),
          displayName: typeof entry["alias"] === "string" ? entry["alias"] : text(object(entry["referenceKey"], "INVALID_REFERENCE_KEY")["id"], "INVALID_REFERENCE_ID"),
          matchedBy: "EXACT_REFERENCE_KEY", matchScore: 1,
          sourceOperation: "reference.resolve", sourceWorldVersion: 0,
          revalidationRequired: true, safeSummary: { source: "contextCapsule" }
        })),
        ambiguities: [], unresolvedMentions: [], validationResults: [], worldVersion: 0, resolverVersion: "context-capsule"
      };
      const byKey = new Map(validations.map((entry) => [JSON.stringify(entry.referenceKey), entry]));
      return {
        ...result,
        validationResults: validations,
        referenceProducts: result.referenceProducts.map((product) => {
          const validation = byKey.get(JSON.stringify(product.referenceKey));
          if (!validation) throw new ProductionStageModuleError("REFERENCE_VALIDATION_MISSING");
          return { ...product, revalidationRequired: validation.status !== "VALID" || validation.revalidationRequired };
        })
      };
    },

    REQUIREMENT_PLAN: async (context) => {
      const parts = requestParts(context);
      const graph = stageValue<DegradedGroundingGraphResult>(context, "GROUNDING_GRAPH_BUILD");
      return planner.plan({
        groundingGraph: graph.graph,
        requestedProducts: parts.requestedProducts,
        executionPolicy: {
          readOnly: true,
          deadlineMs: integer(parts.policy["deadlineMs"], "DEADLINE_INVALID"),
          maxQueryOperations: integer(parts.policy["maxQueryOperations"], "MAX_QUERY_OPERATIONS_INVALID"),
          maxCandidatesPerMention: integer(parts.policy["maxCandidatesPerMention"], "MAX_CANDIDATES_INVALID"),
          maxResultBytes: integer(parts.policy["maxResultBytes"], "MAX_RESULT_BYTES_INVALID"),
          allowApproximation: parts.policy["allowApproximation"] === true
        }
      });
    },

    CAPABILITY_MATCH: async (context) => {
      const authority = persistedAuthority(context, value.gateway);
      const planning = stageValue<RequirementPlanningResult>(context, "REQUIREMENT_PLAN");
      const matches: JsonObject[] = [];
      const gaps: JsonObject[] = [];
      for (const recipeId of planning.selectedRecipeIds) {
        const rule = queryTemplateRules.find((entry) => entry.pattern === recipeId);
        if (!rule) throw new ProductionStageModuleError("QUERY_RECIPE_MISSING");
        for (const step of rule.steps) {
          const result = matcher.match({
            requirement: {
              requirementId: `${rule.templateId}:${step.stepId}`,
              semanticCapability: `${rule.pattern}:${step.stepId}`,
              requiredForProduct: planning.graph?.requirements.find((entry) => entry.required)?.requiredForProduct ?? "WORLD_QUERY",
              snapshotMode: recipeSnapshotMode(rule),
              ...step.requirement
            },
            capabilities: authority.capabilityCatalog.capabilities,
            semanticProfiles: authority.semanticCatalog.profiles,
            operationLocks: allGatewayLocks(authority.southboundLock),
            availability: authority.availability.operations,
            maturityPolicy: { allowPreview: value.allowPreview },
            degradedPolicy: rule.allowDegraded ? "ALLOW" : "REJECT",
            observedAt: authority.availability.checkedAt
          });
          if (result.status === "CAPABILITY_GAP") gaps.push(result.gap as unknown as JsonObject);
          else matches.push(result.primary.binding as unknown as JsonObject);
        }
      }
      return { matches, capabilityGaps: gaps };
    },

    WORLD_QUERY_COMPILE: async (context) => {
      const authority = persistedAuthority(context, value.gateway);
      const planning = stageValue<RequirementPlanningResult>(context, "REQUIREMENT_PLAN");
      const matched = stageValue<{ capabilityGaps: JsonObject[] }>(context, "CAPABILITY_MATCH");
      const parts = requestParts(context);
      const groundingGraph = stageValue<DegradedGroundingGraphResult>(context, "GROUNDING_GRAPH_BUILD");
      const references = stageValue<ReferenceGroundingResult>(context, "REFERENCE_VALIDATE");
      const compiled: CompileResult[] = [];
      const gaps = [...matched.capabilityGaps];
      for (const recipeId of planning.selectedRecipeIds) {
        const recipeInput = buildRecipeOperationInput({
          recipeId,
          planning,
          groundingGraph,
          references,
          ...(typeof parts.source["locale"] === "string" ? { locale: parts.source["locale"] } : {}),
          maximumCandidates: integer(parts.policy["maxCandidatesPerMention"], "MAX_CANDIDATES_INVALID")
        });
        if (recipeInput.status === "CAPABILITY_GAP") {
          const result: CompileResult = recipeInput;
          compiled.push(result);
          gaps.push(result.gap as unknown as JsonObject);
          continue;
        }
        const result = compiler.compile({
          requestId: text(request(context)["requestId"], "REQUEST_ID_MISSING"),
          idempotencyKey: `${idempotencyKey(context)}:${recipeId}`,
          pattern: recipeId as QuerySemanticPattern,
          requiredForProduct: recipeInput.requiredForProduct,
          operationInput: recipeInput.operationInput,
          parameterValues: recipeInput.parameterValues,
          capabilities: authority.capabilityCatalog.capabilities,
          semanticProfiles: authority.semanticCatalog.profiles,
          operationLocks: allGatewayLocks(authority.southboundLock),
          availability: authority.availability.operations,
          maturityPolicy: { allowPreview: value.allowPreview },
          observedAt: authority.availability.checkedAt,
          budgets: {
            maximumNodes: integer(parts.policy["maxQueryOperations"], "MAX_QUERY_OPERATIONS_INVALID"),
            maximumDepth: integer(parts.policy["maxQueryOperations"], "MAX_QUERY_OPERATIONS_INVALID"),
            maximumRows: Math.max(1, integer(parts.policy["maxCandidatesPerMention"], "MAX_CANDIDATES_INVALID") * 32),
            maximumCandidates: Math.max(1, integer(parts.policy["maxCandidatesPerMention"], "MAX_CANDIDATES_INVALID") * 32),
            maximumOutputBytes: integer(parts.policy["maxResultBytes"], "MAX_RESULT_BYTES_INVALID"),
            maximumExecutionMs: integer(parts.policy["deadlineMs"], "DEADLINE_INVALID")
          }
        });
        compiled.push(result);
        if (result.status === "CAPABILITY_GAP") gaps.push(result.gap as unknown as JsonObject);
      }
      const successful = compiled.filter((entry): entry is Extract<CompileResult, { status: "COMPILED" }> => entry.status === "COMPILED");
      await withFence(context, value.pool, async (client) => {
        for (const item of successful) {
          await client.query(
            `INSERT INTO wsgs.world_query(query_id, grounding_id, data_scope, plan, plan_hash)
             VALUES ($1,$2,$3,$4::jsonb,$5)
             ON CONFLICT (query_id) DO UPDATE SET plan = EXCLUDED.plan, plan_hash = EXCLUDED.plan_hash
             WHERE wsgs.world_query.grounding_id = EXCLUDED.grounding_id
               AND wsgs.world_query.plan_hash = EXCLUDED.plan_hash`,
            [item.submission.plan.queryId, context.groundingId, identity(context).dataScope, JSON.stringify(item.submission), item.planHash]
          );
        }
      });
      const output = { compiled, capabilityGaps: gaps };
      return context.operation === "COMPILE_WORLD_QUERY"
        ? resultDocument({ ...context, state: { ...context.state, WORLD_QUERY_COMPILE: output } })
        : output;
    },

    GOWM_EXECUTE: async (context) => {
      const compilation = stageValue<{ compiled: CompileResult[] }>(context, "WORLD_QUERY_COMPILE");
      const caller = identity(context);
      const outcomes: PersistedWorldQueryOutcome[] = [];
      for (const item of compilation.compiled) {
        if (item.status !== "COMPILED") continue;
        const signed = await value.signer.sign({
          kind: "WORLD_QUERY", identity: caller,
          requestId: text(request(context)["requestId"], "REQUEST_ID_MISSING"),
          plan: item.submission.plan,
          dataScopes: [caller.dataScope], datasetScopes: caller.datasetScopes
        });
        const gatewayContext: GatewayRequestContext = {
          signal: context.signal, deadlineAt: context.deadlineAt,
          requestId: text(request(context)["requestId"], "REQUEST_ID_MISSING"),
          delegationToken: signed.token,
          preferAsync: true
        };
        const startedAt = new Date().toISOString();
        const response = await value.gateway.submitWorldQuery(item.submission as unknown as JsonObject, gatewayContext);
        const accepted = response.status === 202 ? object(response.value, "WORLD_QUERY_ACCEPTANCE_INVALID") : undefined;
        if (accepted) {
          // This fenced write is deliberately before the first poll. A crash can
          // recover the authoritative upstream job id and idempotently resume.
          await persistAcceptedWorldQueryJob(context, value.pool, item.submission, accepted);
        }
        let terminal: JsonObject | undefined;
        try {
          terminal = accepted
            ? await value.gateway.pollJob(text(accepted["jobId"], "WORLD_QUERY_JOB_ID_MISSING"), gatewayContext)
            : undefined;
        } catch (error) {
          if (accepted) {
            // The v0.6.3 cancellation authority is the world-query id, not the
            // generic job id. Never reuse the submit request binding, JTI, or
            // the already-aborted caller signal.
            try {
              const cancelRequestId = `wsgs-cancel-${createHash("sha256")
                .update(`${item.submission.plan.queryId}:${randomUUID()}`)
                .digest("hex").slice(0, 32)}`;
              const cancelDelegation = await value.signer.sign({
                kind: "WORLD_QUERY",
                identity: caller,
                requestId: cancelRequestId,
                plan: item.submission.plan,
                dataScopes: [caller.dataScope],
                datasetScopes: caller.datasetScopes
              });
              await value.gateway.cancelWorldQuery(item.submission.plan.queryId, {
                deadlineAt: new Date(Date.now() + environmentInteger("GOWM_CANCEL_TIMEOUT_MS", 2_000, 100, 10_000)),
                requestId: cancelRequestId,
                delegationToken: cancelDelegation.token
              });
            } catch {
              // Best effort only: the local PostgreSQL generation fence still
              // prevents any late upstream value from becoming authoritative.
            }
          }
          throw error;
        }
        const world = response.status === 200
          ? object(response.value, "WORLD_QUERY_RESULT_INVALID")
          : object(object(terminal, "WORLD_QUERY_JOB_INVALID")["result"], "WORLD_QUERY_JOB_RESULT_MISSING");
        const status = text(world["status"], "WORLD_QUERY_STATUS_MISSING");
        const resultHash = text(world["outputHash"], "WORLD_QUERY_RESULT_HASH_MISSING");
        outcomes.push({
          submission: item.submission,
          status, resultHash, delegatedIdentityHash: signed.jtiHash,
          startedAt, finishedAt: new Date().toISOString(),
          encryptedCheckpointEvidenceMaterial: {
            checkpointProtection: "AES_256_GCM_INTERNAL_ONLY",
            responseStatus: response.status,
            response: response.value,
            ...(terminal ? { terminal } : {})
          }
        });
        await withFence(context, value.pool, async (client) => {
          await client.query(
            `UPDATE wsgs.world_query
                SET gateway_query_id = $2, gateway_job_id = $3,
                    upstream_job_id = COALESCE($3, upstream_job_id),
                    query_snapshot_manifest = $4::jsonb,
                    snapshot_adherence = $5::jsonb,
                    upstream_status = $6, upstream_result_hash = $7
              WHERE query_id = $1 AND grounding_id = $8`,
            [item.submission.plan.queryId, world["queryId"] ?? item.submission.plan.queryId,
              accepted?.["jobId"] ?? null, JSON.stringify(world["snapshotManifest"] ?? null),
              JSON.stringify(world["snapshotAdherence"] ?? null), status, resultHash, context.groundingId]
          );
        });
      }
      return { outcomes };
    },

    EVIDENCE_NORMALIZE: async (context) => {
      const authority = persistedAuthority(context, value.gateway);
      const execution = stageValue<{ outcomes: PersistedWorldQueryOutcome[] }>(context, "GOWM_EXECUTE");
      const evidenceItems: GroundingEvidenceItem[] = [];
      const warnings: string[] = [];
      const evidenceProductsForPersistence: ExecutionEvidenceProduct[] = [];
      const normalizationGaps: JsonObject[] = [];
      const requested = requestParts(context).requestedProducts.filter(
        (entry): entry is EvidenceRequestedProduct => evidenceProducts.has(entry as OperationalRequestedProduct)
      );
      const normalizationProducts: EvidenceRequestedProduct[] = requested.length > 0 ? requested : ["WORLD_EVIDENCE"];
      const semantic = context.state["SEMANTIC_MODEL_PARSE"] as PersistedSemanticModelResult | undefined;
      for (const outcome of execution.outcomes) {
        const world = finalWorldResult(outcome);
        const maximumInlinePayloadBytes = Math.min(
          1_048_576,
          integer(requestParts(context).policy["maxResultBytes"], "MAX_RESULT_BYTES_INVALID")
        );
        const oversized = oversizedEvidencePayload(world, maximumInlinePayloadBytes);
        if (oversized) {
          normalizationGaps.push({
            gapId: `gap-${canonicalSha256({
              queryId: outcome.submission.plan.queryId,
              code: "PAYLOAD_REFERENCE_REQUIRED",
              ...oversized
            }).slice("sha256:".length, "sha256:".length + 24)}`,
            semanticCapability: "GOWM_EXECUTION_EVIDENCE_OBJECT_STORAGE",
            reason: "BUDGET_EXCEEDED",
            requiredForProduct: normalizationProducts[0] ?? "WORLD_EVIDENCE",
            blocking: true,
            details: {
              code: "PAYLOAD_REFERENCE_REQUIRED",
              payloadPath: oversized.path,
              payloadBytes: oversized.byteCount,
              maximumInlinePayloadBytes,
              authoritativePayloadRef: false,
              objectStorageAdded: false
            }
          });
          warnings.push("PAYLOAD_REFERENCE_REQUIRED");
          continue;
        }
        const nodes = Array.isArray(world["nodes"]) ? world["nodes"] : [];
        const planByNode = new Map(outcome.submission.plan.nodes.map((node) => [node.nodeId, node]));
        const operationsByNode: Record<string, OperationExecutionContractTrace> = {};
        const nodeRequestHashes = computeWorldQueryNodeRequestHashes(
          outcome.submission,
          world,
          authority.capabilityCatalog.capabilities
        );
        for (const rawNode of nodes) {
          const node = object(rawNode, "WORLD_QUERY_NODE_INVALID");
          const nodeId = text(node["nodeId"], "WORLD_QUERY_NODE_ID_MISSING");
          const planned = planByNode.get(nodeId);
          if (!planned) throw new ProductionStageModuleError("WORLD_QUERY_NODE_NOT_IN_PLAN");
          const descriptor = authority.capabilityCatalog.capabilities.find((entry) =>
            entry.operationId === planned.operation.operationId && entry.operationVersion === planned.operation.operationVersion);
          if (!descriptor) throw new ProductionStageModuleError("WORLD_QUERY_CAPABILITY_MISSING");
          const profile = authority.semanticCatalog.profiles.find((entry) =>
            entry.operationId === descriptor.operationId && entry.operationVersion === descriptor.operationVersion);
          const observed = authority.availability.operations.find((entry) =>
            entry.operationId === descriptor.operationId && entry.operationVersion === descriptor.operationVersion);
          if (!profile || !observed) throw new ProductionStageModuleError("WORLD_QUERY_CONTRACT_TRACE_MISSING");
          operationsByNode[nodeId] = {
            nodeId,
            operationId: descriptor.operationId,
            operationVersion: descriptor.operationVersion,
            inputSchemaHash: descriptor.inputSchemaHash,
            outputSchemaUri: descriptor.outputSchemaUri,
            outputSchemaHash: descriptor.outputSchemaHash,
            semanticProfileHash: profile.semanticProfileHash,
            negativeEvidencePolicy: text(profile.semanticProfile["negativeEvidencePolicy"], "NEGATIVE_EVIDENCE_POLICY_MISSING"),
            availability: {
              availability: observed.availability,
              checkedAt: observed.checkedAt,
              reasonCodes: [...observed.reasonCodes]
            }
          };
        }
        const material = outcome.encryptedCheckpointEvidenceMaterial;
        const responseStatus = material.responseStatus;
        if (responseStatus !== 200 && responseStatus !== 202) throw new ProductionStageModuleError("WORLD_QUERY_RESPONSE_STATUS_INVALID");
        const evidence = evidenceNormalizer.normalizeWorldQuery({
          context: {
            executionId: `execution-${createHash("sha256").update(`${context.groundingId}:${outcome.submission.plan.queryId}`).digest("hex").slice(0, 32)}`,
            groundingId: context.groundingId,
            requestPayload: outcome.submission,
            startedAt: text(outcome["startedAt"], "WORLD_QUERY_START_TIME_MISSING"),
            finishedAt: text(outcome["finishedAt"], "WORLD_QUERY_FINISH_TIME_MISSING"),
            contractCatalogRevision: authority.trustedCapabilitySnapshot.contractCatalogRevision,
            bindingRevision: authority.trustedCapabilitySnapshot.bindingRevision,
            authorizationContextHash: identity(context).authorizationContextHash as Sha256Digest,
            delegatedIdentityHash: text(outcome["delegatedIdentityHash"], "DELEGATED_IDENTITY_HASH_MISSING") as Sha256Digest,
            ...(semantic?.receiptId ? { modelReceiptIds: [semantic.receiptId] } : {}),
            requestedProducts: normalizationProducts,
            maximumInlinePayloadBytes
          },
          operationsByNode,
          nodeRequestHashes,
          snapshotExpectation: {
            mode: outcome.submission.snapshotPolicy.mode,
            allowDowngrade: false
          },
          outcome: responseStatus === 200
            ? { mode: "SYNC", status: 200, result: material.response }
            : {
                mode: "ASYNC", status: 202,
                acceptedJob: material.response,
                terminalJob: material.terminal
              }
        });
        evidenceProductsForPersistence.push(evidence);
        evidenceItems.push(...evidence.evidenceItems.map(publicEvidenceItem));
        warnings.push(...evidence.warnings, ...evidence.unknowns);
      }
      await persistExecutionRecords(
        context,
        value.pool,
        evidenceProductsForPersistence.flatMap((entry) => [entry.record, ...entry.nodeRecords])
      );
      const operationalRequested = requested as OperationalRequestedProduct[];
      const assembled = requested.length === 0
        ? {
            status: normalizationGaps.length > 0 ? "PARTIAL" as const : "COMPLETED" as const,
            evidenceItems,
            capabilityGaps: [] as JsonObject[]
          }
        : productAssembler.assemble({ requestedProducts: operationalRequested, evidenceItems });
      return {
        ...assembled,
        status: normalizationGaps.length > 0 ? "PARTIAL" as const : assembled.status,
        capabilityGaps: [...assembled.capabilityGaps, ...normalizationGaps],
        warnings
      };
    },

    PRODUCT_ASSEMBLE: async (context) => resultDocument(context),

    RESULT_PERSIST: async (context) => stageValue<JsonObject>(context, "PRODUCT_ASSEMBLE")
  });
}

export const PRODUCTION_PIPELINE_STAGE_COUNT = PIPELINE_STAGES.length;
export const PRODUCTION_REQUIREMENT_PLANNER_VERSION = REQUIREMENT_PLANNER_VERSION;
