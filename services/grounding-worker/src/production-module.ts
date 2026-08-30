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
  GdpsDescriptorConsumer,
  projectGeospatialProductIntent,
  type ProductDescriptorRegistry,
  type ProductVocabularyRegistry,
  type SemanticConceptMap
} from "@wsgs/gdps-descriptor-consumer";
import {
  GOWM_SOUTHBOUND_LOCK_LF_SHA256,
  loadOperationalGowmLock,
  loadWorldQueryParameterSchemaHash,
  type LoadedOperationalGowmLock,
  type OperationalGowmLock,
  verifyGowmContractIntake
} from "@wsgs/gowm-contract-intake";
import {
  GowmExecutionEvidenceNormalizer,
  evaluateGdpsCurrentOnlyReplay,
  normalizeGdpsSourceEvidence,
  type EvidenceRequestedProduct,
  type ExecutionEvidenceProduct,
  type GdpsReplayDecision,
  type GdpsSourceEvidence,
  type GowmExecutionRecord,
  type NormalizedExecutionEvidenceItem,
  type OperationExecutionContractTrace,
  type Sha256Digest
} from "@wsgs/gowm-execution-evidence";
import {
  GatewayProtocolError,
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
  canonicalGraphHash,
  validateGroundingGraph,
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
  type PipelineStage,
  type PipelineStageContext,
  type ProductionAdmissionSnapshot
} from "@wsgs/grounding-pipeline";
import {
  QUERY_COMPILER_VERSION,
  CapabilityMatcher,
  TypedWorldQueryCompiler,
  canonicalPlanHash,
  queryTemplateRules,
  recipeSnapshotMode,
  type CapabilityGap,
  type CompileResult,
  type ExecutionBudgets,
  type GdpsCurrentnessAuthorization,
  type QuerySemanticPattern,
  type WorldQuerySubmission
} from "@wsgs/query-compiler";
import {
  REQUIREMENT_PLANNER_VERSION,
  SemanticRequirementPlanner,
  stableRecipeCatalog,
  type RequirementPlanningResult,
  type PlannerCapabilityGap,
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
  loadGdpsConsumerSnapshotExtension,
  loadGdpsRecipeLock,
  verifyGdpsConsumerSnapshotExtension,
  verifyPersistedTrustedCapabilitySnapshot,
  type GdpsConsumerSnapshotExtension,
  type GdpsLockedRecipe,
  type LoadedGdpsRecipeLock,
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
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const gdpsProductIdPattern = /^[a-z][a-z0-9-]{2,127}$/u;
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

/**
 * Stable grounding recipes combine world-independent catalog resolution with
 * snapshot-bound world evidence. GOWM cannot attest a world-independent node
 * to LATEST_AT_START, so the mixed DAG preserves each node's observed
 * adherence under BEST_EFFORT. Historical PINNED replay is rejected separately
 * and is never weakened to a latest snapshot.
 */
export const PRODUCTION_WORLD_QUERY_SNAPSHOT_POLICY = Object.freeze({
  mode: "BEST_EFFORT",
  allowDowngrade: false
} as const);

export class ProductionStageModuleError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
    message = code,
    readonly stage?: PipelineStage
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
  gdpsConsumerSnapshot?: GdpsConsumerSnapshotExtension;
  gdpsCurrentnessAuthorization?: GdpsCurrentnessAuthorization;
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
  gdpsConsumerSnapshot?: GdpsConsumerSnapshotExtension;
  gdpsRecipeLock?: LoadedGdpsRecipeLock;
  gdpsRecipes: GdpsLockedRecipe[];
  gdpsCurrentnessAuthorization?: GdpsCurrentnessAuthorization;
  gdpsDescriptor?: {
    consumer: GdpsDescriptorConsumer;
    conceptMap: SemanticConceptMap;
  };
  parameterSchemaHash: `sha256:${string}`;
}

type PersistedSemanticModelResult = SemanticModelPolicyResult & { receiptId?: string };

interface ProductionFactoryOptions {
  pool?: Pool;
}

export interface GdpsPriorCurrentnessReplay {
  sourceGroundingId: string;
  sourceResultHash: `sha256:${string}`;
  selectedEvidenceProductId: string;
  productId: string;
  contentHash: `sha256:${string}`;
  sourceOperation: string;
  sourceOperationVersion: string;
  sourceRecipeId: string;
  sourceRecipeLockHash: `sha256:${string}`;
  descriptorId: string;
  descriptorHash: `sha256:${string}`;
  productType: string;
  productProfile: string;
  queryProfile: string;
  replayMode: "STRICT" | "BEST_EFFORT";
  /** Internal correlation only; it is deliberately omitted from the public grounding graph. */
  sourceGatewayQueryId: string;
  /** Exact southbound lock used for the persisted source query. */
  sourceOperationLockHash: `sha256:${string}`;
}

export interface GdpsPersistedSourceQuery {
  sourceGroundingId: string;
  sourceGatewayQueryId: string;
  sourcePlanHash: `sha256:${string}`;
  submission: WorldQuerySubmission;
}

export interface PriorCurrentnessLoadResult {
  gdpsCurrentnessReplays: GdpsPriorCurrentnessReplay[];
  gdpsPersistedSourceQueries: GdpsPersistedSourceQuery[];
  hasOtherPriorProducts: boolean;
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
      hashMode: "EXACT_BYTES",
      operationCountPolicy: "HASH_LOCKED_EXTENSION"
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

export function selectProductionSouthboundLock(
  lock: OperationalGowmLock,
  previewRecipes: readonly GdpsLockedRecipe[] = [],
  currentnessAuthorization?: GdpsCurrentnessAuthorization
): OperationalGowmLock {
  const available = [...lock.defaultOperations, ...lock.previewOperations];
  const selected = PRODUCTION_STABLE_OPERATION_IDS.map((operationId) => {
    const entry = available.find((candidate) =>
      candidate.operationId === operationId && candidate.operationVersion === "1.0");
    if (!entry || entry.maturity !== "STABLE") {
      throw new ProductionStageModuleError(`PRODUCTION_STABLE_OPERATION_LOCK_MISSING_${operationId}`);
    }
    return entry;
  });
  const previewOperations = new Map(previewRecipes.flatMap((recipe) => recipe.allowedOperations)
    .map((entry) => [`${entry.operationId}@${entry.operationVersion}`, entry] as const));
  if (currentnessAuthorization) {
    const entry = currentnessAuthorization.allowedOperation;
    previewOperations.set(`${entry.operationId}@${entry.operationVersion}`, entry);
  }
  const selectedPreview = [...previewOperations.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([operationKey, expected]) => {
    const { operationId, operationVersion } = expected;
    const entry = available.find((candidate) =>
      candidate.operationId === operationId && candidate.operationVersion === operationVersion);
    if (!entry || entry.maturity !== "PREVIEW") {
      throw new ProductionStageModuleError(`PRODUCTION_PREVIEW_OPERATION_LOCK_MISSING_${operationId}`);
    }
    if (entry.inputSchemaHash !== expected.inputSchemaHash || entry.outputSchemaHash !== expected.outputSchemaHash ||
        entry.semanticProfileHash !== expected.semanticProfileHash) {
      throw new ProductionStageModuleError(`PRODUCTION_PREVIEW_OPERATION_LOCK_DRIFT_${operationKey}`);
    }
    if (currentnessAuthorization && operationKey === "geo-product.check-current@1.0" &&
        entry.snapshotSupport !== "CONSISTENT_AT_START") {
      throw new ProductionStageModuleError("PRODUCTION_CURRENTNESS_SNAPSHOT_SUPPORT_INVALID");
    }
    return entry;
  });
  return {
    ...lock,
    defaultOperations: selected,
    previewOperations: selectedPreview
  };
}

interface ProviderCurrentnessRecipe {
  providerRecipeLockHash: `sha256:${string}`;
  allowedOperation: GdpsCurrentnessAuthorization["allowedOperation"];
}

/** Loads the provider recipe as an exact-byte authority; names alone never enable PREVIEW. */
export function loadProviderCurrentnessRecipe(options: {
  lockPath: string;
  expectedSha256: `sha256:${string}`;
}): ProviderCurrentnessRecipe {
  if (!sha256Pattern.test(options.expectedSha256)) {
    throw new ProductionStageModuleError("WSGS_GDPS_PROVIDER_RECIPE_LOCK_EXPECTED_HASH_INVALID");
  }
  const bytes = readFileSync(options.lockPath);
  const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
  if (actual !== options.expectedSha256) {
    throw new ProductionStageModuleError("WSGS_GDPS_PROVIDER_RECIPE_LOCK_INTEGRITY_MISMATCH");
  }
  let lock: JsonObject;
  try {
    lock = object(JSON.parse(bytes.toString("utf8")), "WSGS_GDPS_PROVIDER_RECIPE_LOCK_JSON_INVALID");
  } catch (error) {
    if (error instanceof ProductionStageModuleError) throw error;
    throw new ProductionStageModuleError("WSGS_GDPS_PROVIDER_RECIPE_LOCK_JSON_INVALID");
  }
  const policy = object(lock["previewPolicy"], "WSGS_GDPS_PROVIDER_RECIPE_POLICY_INVALID");
  const recipes = lock["recipes"];
  if (lock["schemaVersion"] !== "wsgs-gdps-recipe-lock/1.0" ||
      policy["allowAllPreview"] !== false || policy["requiresExactHashes"] !== true ||
      !Array.isArray(recipes) || recipes.length !== 30) {
    throw new ProductionStageModuleError("WSGS_GDPS_PROVIDER_RECIPE_LOCK_CONTRACT_INVALID");
  }
  const candidates = recipes.filter((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const recipe = raw as JsonObject;
    return recipe["recipeId"] === "gdps-check-current-geo-product" &&
      recipe["requirementKind"] === "CHECK_CURRENT_GEO_PRODUCT" &&
      recipe["operationId"] === "geo-product.check-current" && recipe["operationVersion"] === "1.0";
  });
  if (candidates.length !== 1) {
    throw new ProductionStageModuleError("WSGS_GDPS_CURRENTNESS_RECIPE_NOT_EXACT");
  }
  const recipe = candidates[0] as JsonObject;
  if (recipe["allowedMaturity"] !== "PREVIEW" ||
      ![recipe["inputSchemaHash"], recipe["outputSchemaHash"], recipe["semanticProfileHash"]]
        .every((value) => typeof value === "string" && sha256Pattern.test(value))) {
    throw new ProductionStageModuleError("WSGS_GDPS_CURRENTNESS_RECIPE_HASH_INVALID");
  }
  return {
    providerRecipeLockHash: actual,
    allowedOperation: {
      operationId: "geo-product.check-current",
      operationVersion: "1.0",
      inputSchemaHash: recipe["inputSchemaHash"] as `sha256:${string}`,
      outputSchemaHash: recipe["outputSchemaHash"] as `sha256:${string}`,
      semanticProfileHash: recipe["semanticProfileHash"] as `sha256:${string}`
    }
  };
}

function configuredGdpsRecipes(): {
  loaded?: LoadedGdpsRecipeLock;
  recipes: GdpsLockedRecipe[];
  consumerSnapshot?: GdpsConsumerSnapshotExtension;
} {
  const allowlist = [...new Set(environmentList("WSGS_GDPS_PREVIEW_RECIPE_ALLOWLIST"))];
  const lockPath = process.env["WSGS_GDPS_RECIPE_LOCK_FILE"]?.trim();
  const expectedSha256 = process.env["WSGS_GDPS_RECIPE_LOCK_SHA256"]?.trim();
  const snapshotPath = process.env["WSGS_GDPS_CONSUMER_SNAPSHOT_FILE"]?.trim();
  const snapshotSha256 = process.env["WSGS_GDPS_CONSUMER_SNAPSHOT_SHA256"]?.trim();
  if (allowlist.length === 0) {
    if (lockPath || expectedSha256 || snapshotPath || snapshotSha256) {
      throw new ProductionStageModuleError("WSGS_GDPS_PREVIEW_RECIPE_ALLOWLIST_REQUIRED");
    }
    return { recipes: [] };
  }
  if (!lockPath || !expectedSha256) throw new ProductionStageModuleError("WSGS_GDPS_RECIPE_LOCK_REQUIRED");
  if (!snapshotPath || !snapshotSha256) throw new ProductionStageModuleError("WSGS_GDPS_CONSUMER_SNAPSHOT_REQUIRED");
  const loaded = loadGdpsRecipeLock({
    lockPath,
    expectedSha256: expectedSha256 as `sha256:${string}`
  });
  const recipes = loaded.lock.recipes.filter((entry) =>
    allowlist.includes(entry.recipeId) || allowlist.includes(entry.semanticPattern));
  if (recipes.length !== allowlist.length) throw new ProductionStageModuleError("WSGS_GDPS_PREVIEW_RECIPE_ALLOWLIST_INVALID");
  const consumerSnapshot = loadGdpsConsumerSnapshotExtension({
    snapshotPath,
    expectedSha256: snapshotSha256 as `sha256:${string}`
  });
  if (consumerSnapshot.providerVersion !== loaded.lock.providerVersion ||
      consumerSnapshot.capabilityLockHash !== loaded.lock.capabilityLockHash ||
      consumerSnapshot.descriptorLockHash !== loaded.lock.descriptorRegistryHash ||
      consumerSnapshot.recipeLockHash !== loaded.lockHash) {
    throw new ProductionStageModuleError("WSGS_GDPS_CONSUMER_SNAPSHOT_LOCK_DRIFT");
  }
  return { loaded, recipes, consumerSnapshot };
}

function configuredGdpsCurrentnessAuthorization(
  gdps: ReturnType<typeof configuredGdpsRecipes>,
  operationalLock: LoadedOperationalGowmLock
): GdpsCurrentnessAuthorization | undefined {
  const lockPath = process.env["WSGS_GDPS_PROVIDER_RECIPE_LOCK_FILE"]?.trim();
  const expectedSha256 = process.env["WSGS_GDPS_PROVIDER_RECIPE_LOCK_SHA256"]?.trim();
  if (!gdps.loaded) {
    if (lockPath || expectedSha256) {
      throw new ProductionStageModuleError("WSGS_GDPS_RUNTIME_RECIPE_LOCK_REQUIRED_FOR_CURRENTNESS");
    }
    return undefined;
  }
  if (!lockPath || !expectedSha256) {
    throw new ProductionStageModuleError("WSGS_GDPS_PROVIDER_RECIPE_LOCK_REQUIRED");
  }
  if (!gdps.consumerSnapshot?.capabilityKeys.includes("geo-product.check-current@1.0")) {
    throw new ProductionStageModuleError("WSGS_GDPS_CURRENTNESS_CAPABILITY_NOT_CONSUMER_LOCKED");
  }
  const provider = loadProviderCurrentnessRecipe({
    lockPath,
    expectedSha256: expectedSha256 as `sha256:${string}`
  });
  const operation = [...operationalLock.lock.defaultOperations, ...operationalLock.lock.previewOperations]
    .find((entry) => entry.operationId === "geo-product.check-current" && entry.operationVersion === "1.0");
  if (!operation || operation.maturity !== "PREVIEW" || operation.snapshotSupport !== "CONSISTENT_AT_START") {
    throw new ProductionStageModuleError("WSGS_GDPS_CONSISTENT_CURRENTNESS_OPERATION_UNAVAILABLE");
  }
  if (operation.inputSchemaHash !== provider.allowedOperation.inputSchemaHash ||
      operation.outputSchemaHash !== provider.allowedOperation.outputSchemaHash ||
      operation.semanticProfileHash !== provider.allowedOperation.semanticProfileHash) {
    throw new ProductionStageModuleError("WSGS_GDPS_CURRENTNESS_OPERATION_LOCK_DRIFT");
  }
  return {
    recipeId: "gdps-check-current-geo-product",
    requirementKind: "CHECK_CURRENT_GEO_PRODUCT",
    providerRecipeLockHash: provider.providerRecipeLockHash,
    operationLockHash: operationalLock.lockHash,
    allowedOperation: provider.allowedOperation
  };
}

function configuredGdpsDescriptor(
  loaded?: LoadedGdpsRecipeLock,
  authorizedRecipes: readonly GdpsLockedRecipe[] = []
): Runtime["gdpsDescriptor"] {
  if (!loaded) return undefined;
  const registryPath = process.env["WSGS_GDPS_DESCRIPTOR_REGISTRY_FILE"]?.trim();
  const registrySha256 = process.env["WSGS_GDPS_DESCRIPTOR_REGISTRY_SHA256"]?.trim();
  const vocabularyPath = process.env["WSGS_GDPS_VOCABULARY_REGISTRY_FILE"]?.trim();
  const vocabularySha256 = process.env["WSGS_GDPS_VOCABULARY_REGISTRY_SHA256"]?.trim();
  const conceptMapPath = process.env["WSGS_GDPS_SEMANTIC_CONCEPT_MAP_FILE"]?.trim() || fileURLToPath(new URL(
    "../../../config/gdps-semantic-concept-map.json",
    import.meta.url
  ));
  const conceptMapSha256 = process.env["WSGS_GDPS_SEMANTIC_CONCEPT_MAP_SHA256"]?.trim();
  if (!registryPath || !registrySha256 || !vocabularyPath || !vocabularySha256 || !conceptMapSha256) {
    throw new ProductionStageModuleError("WSGS_GDPS_DESCRIPTOR_INPUT_LOCKS_REQUIRED");
  }
  const lockedJson = <T>(path: string, expectedSha256: string, code: string): T => {
    if (!/^sha256:[0-9a-f]{64}$/u.test(expectedSha256)) {
      throw new ProductionStageModuleError(`${code}_EXPECTED_HASH_INVALID`);
    }
    const bytes = readFileSync(path);
    const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (actual !== expectedSha256) throw new ProductionStageModuleError(`${code}_INTEGRITY_MISMATCH`);
    try {
      return JSON.parse(bytes.toString("utf8")) as T;
    } catch {
      throw new ProductionStageModuleError(`${code}_JSON_INVALID`);
    }
  };
  let registry: ProductDescriptorRegistry;
  let vocabularies: ProductVocabularyRegistry;
  let conceptMap: SemanticConceptMap;
  try {
    registry = lockedJson<ProductDescriptorRegistry>(registryPath, registrySha256, "WSGS_GDPS_DESCRIPTOR_REGISTRY");
    vocabularies = lockedJson<ProductVocabularyRegistry>(vocabularyPath, vocabularySha256, "WSGS_GDPS_VOCABULARY_REGISTRY");
    conceptMap = lockedJson<SemanticConceptMap>(conceptMapPath, conceptMapSha256, "WSGS_GDPS_SEMANTIC_CONCEPT_MAP");
  } catch (error) {
    if (error instanceof ProductionStageModuleError) throw error;
    throw new ProductionStageModuleError("WSGS_GDPS_DESCRIPTOR_INPUT_INVALID");
  }
  const consumer = new GdpsDescriptorConsumer({
    registry,
    expectedRegistryHash: loaded.lock.descriptorRegistryHash,
    conceptMap,
    vocabularies,
    expectedProductTypeCount: 34,
    expectedDescriptorProfileCount: 35,
    recipes: authorizedRecipes
  });
  if (consumer.registryHash !== loaded.lock.descriptorRegistryHash) {
    throw new ProductionStageModuleError("WSGS_GDPS_DESCRIPTOR_LOCK_DRIFT");
  }
  return { consumer, conceptMap };
}

function gatewayFailure(error: unknown): never {
  if (!(error instanceof GatewayProtocolError)) throw error;
  const details = error.details ?? {};
  const safe = [details["stage"], details["nodeId"], details["operationId"]]
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.toUpperCase().replace(/[^A-Z0-9_]/gu, "_").slice(0, 32));
  if (typeof details["schemaUri"] === "string") safe.push("SCHEMA");
  if (typeof details["registeredHash"] === "string" || typeof details["canonicalHash"] === "string") {
    safe.push("HASH");
  }
  for (const [label, value] of [["REQ", details["requested"]], ["ALLOW", details["allowed"]]] as const) {
    if (typeof value === "number" && Number.isFinite(value)) safe.push(`${label}${Math.trunc(value)}`);
  }
  throw new ProductionStageModuleError([error.code, ...safe].join("_").slice(0, 127), error.retryable);
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
  const gdps = configuredGdpsRecipes();
  const gdpsDescriptor = configuredGdpsDescriptor(gdps.loaded, gdps.recipes);
  const gdpsCurrentnessAuthorization = configuredGdpsCurrentnessAuthorization(gdps, operationalLock);
  const productionLock = selectProductionSouthboundLock(lock, gdps.recipes, gdpsCurrentnessAuthorization);
  const trustedOperationKeys = allGatewayLocks(productionLock)
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
    allowPreview: process.env["WSGS_ALLOW_PREVIEW_CAPABILITIES"] === "YES",
    ...(gdps.consumerSnapshot ? { gdpsConsumerSnapshot: gdps.consumerSnapshot } : {}),
    ...(gdps.loaded ? { gdpsRecipeLock: gdps.loaded } : {}),
    gdpsRecipes: gdps.recipes,
    ...(gdpsCurrentnessAuthorization ? { gdpsCurrentnessAuthorization } : {}),
    ...(gdpsDescriptor ? { gdpsDescriptor } : {}),
    parameterSchemaHash: loadWorldQueryParameterSchemaHash()
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
  principal: GroundingIdentityV2 = readinessIdentity(),
  probeModel = true
): Promise<LiveAuthority> {
  const now = Date.now();
  if (!force && cachedAuthority && cachedAuthority.expiresAt > now) return cachedAuthority.value;
  if (!staticIntakeVerified) {
    verifyGowmContractIntake({ repositoryRoot, verifyRecordedEvidence: true });
    staticIntakeVerified = true;
  }
  const lock = value.operationalLock.lock;
  const productionLock = selectProductionSouthboundLock(
    lock,
    value.gdpsRecipes,
    value.gdpsCurrentnessAuthorization
  );
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
      nodes: allGatewayLocks(productionLock).map((entry, index) => ({
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
    required: allGatewayLocks(productionLock),
    optional: [],
    expectedContractCatalogRevision: lock.contractCatalogRevision,
    expectedSemanticCatalogHash: lock.semanticCatalogHash
  });
  if (!validation.requiredReady) throw new ProductionStageModuleError("STABLE_GOWM_OPERATIONS_NOT_READY");
  await value.signer.ready();
  if (probeModel && value.modelPolicy === "MODEL_REQUIRED") {
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
    southboundLock: validatedLock(productionLock),
    ...(value.gdpsConsumerSnapshot ? { gdpsConsumerSnapshot: value.gdpsConsumerSnapshot } : {}),
    ...(value.gdpsCurrentnessAuthorization
      ? { gdpsCurrentnessAuthorization: structuredClone(value.gdpsCurrentnessAuthorization) }
      : {})
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
  const value = readinessRuntime();
  // Keep the fail-closed model readiness probe on its short-lived readiness
  // cache, then refresh caller-filtered GOWM authority without parsing the
  // same model prompt a second time for every admitted business request.
  await liveAuthority(value);
  return (await liveAuthority(value, true, context.identity, false)).admission;
}

function persistedAuthority(context: PipelineStageContext, gateway: GowmGatewayClient): PersistedAuthority {
  const authority = object(context.immutableLocks, "IMMUTABLE_AUTHORITY_MISSING") as unknown as PersistedAuthority;
  if (authority.schemaVersion !== "1.0") throw new ProductionStageModuleError("IMMUTABLE_AUTHORITY_VERSION");
  verifyPersistedTrustedCapabilitySnapshot(authority.trustedCapabilitySnapshot);
  if (authority.gdpsConsumerSnapshot) verifyGdpsConsumerSnapshotExtension(authority.gdpsConsumerSnapshot);
  if (authority.gdpsCurrentnessAuthorization) {
    const authorization = authority.gdpsCurrentnessAuthorization;
    const locked = [...authority.southboundLock.defaultOperations, ...authority.southboundLock.previewOperations]
      .find((entry) => entry.operationId === "geo-product.check-current" && entry.operationVersion === "1.0");
    if (!authority.gdpsConsumerSnapshot?.capabilityKeys.includes("geo-product.check-current@1.0") ||
        authorization.recipeId !== "gdps-check-current-geo-product" ||
        authorization.requirementKind !== "CHECK_CURRENT_GEO_PRODUCT" ||
        authorization.operationLockHash !== authority.trustedCapabilitySnapshot.southboundLockHash ||
        !sha256Pattern.test(authorization.providerRecipeLockHash) || !locked ||
        locked.maturity !== "PREVIEW" || locked.snapshotSupport !== "CONSISTENT_AT_START" ||
        locked.inputSchemaHash !== authorization.allowedOperation.inputSchemaHash ||
        locked.outputSchemaHash !== authorization.allowedOperation.outputSchemaHash ||
        locked.semanticProfileHash !== authorization.allowedOperation.semanticProfileHash) {
      throw new ProductionStageModuleError("PERSISTED_GDPS_CURRENTNESS_AUTHORITY_INVALID");
    }
  }
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

function exactStringSet(left: readonly string[], right: readonly string[]): boolean {
  const normalized = (values: readonly string[]): string[] => [...new Set(values)].sort();
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

function parsePersistedResultBytes(value: unknown): JsonObject {
  if (!(value instanceof Uint8Array)) throw new ProductionStageModuleError("INVALID_STORED_PRIOR_RESULT");
  try {
    return object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value)), "INVALID_STORED_PRIOR_RESULT");
  } catch (error) {
    if (error instanceof ProductionStageModuleError) throw error;
    throw new ProductionStageModuleError("INVALID_STORED_PRIOR_RESULT");
  }
}

interface PriorExecutionRow {
  execution_kind: string;
  operation_id: string | null;
  operation_version: string | null;
  gateway_query_id: string | null;
  request_hash: string;
  data_snapshot: unknown;
}

interface PriorWorldQueryRow {
  query_id: string;
  gateway_query_id: string | null;
  plan: unknown;
  plan_hash: string;
}

function parsePersistedWorldQuerySubmission(
  value: unknown,
  expectedQueryId: string,
  expectedPlanHash: string
): WorldQuerySubmission {
  const submission = object(value, "PRIOR_WORLD_QUERY_SUBMISSION_INVALID");
  const allowedKeys = new Set([
    "requestId", "idempotencyKey", "plan", "parameters", "parameterSchemaHash", "snapshotPolicy"
  ]);
  if (Object.keys(submission).some((key) => !allowedKeys.has(key)) ||
      typeof submission["requestId"] !== "string" || !submission["requestId"] ||
      typeof submission["idempotencyKey"] !== "string" || !submission["idempotencyKey"] ||
      !submission["parameters"] || typeof submission["parameters"] !== "object" ||
      Array.isArray(submission["parameters"]) ||
      typeof submission["parameterSchemaHash"] !== "string" ||
      !sha256Pattern.test(submission["parameterSchemaHash"])) {
    throw new ProductionStageModuleError("PRIOR_WORLD_QUERY_SUBMISSION_INVALID");
  }
  const snapshotPolicy = object(submission["snapshotPolicy"], "PRIOR_WORLD_QUERY_SUBMISSION_INVALID");
  if (!['LATEST_AT_START', 'BEST_EFFORT', 'PINNED'].includes(String(snapshotPolicy["mode"])) ||
      snapshotPolicy["allowDowngrade"] !== false) {
    throw new ProductionStageModuleError("PRIOR_WORLD_QUERY_SUBMISSION_INVALID");
  }
  const typed = submission as unknown as WorldQuerySubmission;
  let actualPlanHash: string;
  try {
    actualPlanHash = canonicalPlanHash(typed.plan);
  } catch {
    throw new ProductionStageModuleError("PRIOR_WORLD_QUERY_PLAN_INVALID");
  }
  if (typed.plan.queryId !== expectedQueryId || actualPlanHash !== expectedPlanHash ||
      !sha256Pattern.test(expectedPlanHash)) {
    throw new ProductionStageModuleError("PRIOR_WORLD_QUERY_PLAN_HASH_MISMATCH");
  }
  return structuredClone(typed);
}

/**
 * Recognizes only a selected, persisted GDPS Current Product evidence item.
 * Any partial GDPS-shaped evidence is rejected rather than downgraded to the
 * generic prior-reference path.
 */
export function recognizeGdpsPriorCurrentnessReplay(options: {
  sourceGroundingId: string;
  sourceResultHash: string;
  selectedProductIds: readonly string[];
  resultBytes: Uint8Array;
  executions: readonly PriorExecutionRow[];
  sourceOperationLockHash: string;
}): GdpsPriorCurrentnessReplay | null {
  if (!sha256Pattern.test(options.sourceResultHash) || options.selectedProductIds.length !== 1) return null;
  const result = parsePersistedResultBytes(options.resultBytes);
  if (result["groundingId"] !== options.sourceGroundingId || result["resultHash"] !== options.sourceResultHash) {
    throw new ProductionStageModuleError("PRIOR_RESULT_HASH_MISMATCH");
  }
  const evidenceItems = Array.isArray(result["evidenceItems"]) ? result["evidenceItems"] : [];
  const selected = evidenceItems.filter((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    return (raw as JsonObject)["evidenceProductId"] === options.selectedProductIds[0];
  });
  if (selected.length === 0) return null;
  if (selected.length !== 1) throw new ProductionStageModuleError("DUPLICATE_PRIOR_PRODUCT_ID");
  const item = object(selected[0], "INVALID_PRIOR_PRODUCT");
  const sourceOperation = typeof item["sourceOperation"] === "string" ? item["sourceOperation"] : "";
  const payload = item["safePayload"];
  const gdpsShaped = /^(?:geo-product|geo-raster|geo-vector|elevation|terrain|landcover|hydrology|surface-material|obstacle|traversability)\./u
    .test(sourceOperation) || (payload && typeof payload === "object" && !Array.isArray(payload) &&
      (Object.hasOwn(payload, "productId") || Object.hasOwn(payload, "contentHash")));
  if (!gdpsShaped) return null;
  if (item["productKind"] !== "CAPABILITY_RESULT" || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ProductionStageModuleError("PRIOR_GDPS_EVIDENCE_NOT_REVALIDATABLE");
  }
  const safePayload = payload as JsonObject;
  const productId = text(safePayload["productId"], "PRIOR_GDPS_PRODUCT_ID_MISSING");
  const contentHash = text(safePayload["contentHash"], "PRIOR_GDPS_CONTENT_HASH_MISSING");
  if (!gdpsProductIdPattern.test(productId) || !sha256Pattern.test(contentHash) ||
      sourceOperation === "geo-product.check-current") {
    throw new ProductionStageModuleError("PRIOR_GDPS_PRODUCT_IDENTITY_INVALID");
  }
  const matches = options.executions.flatMap((row) => {
    if (row.execution_kind !== "WORLD_QUERY_NODE" ||
        row.operation_id !== sourceOperation || row.operation_version !== "1.0" ||
        !row.data_snapshot || typeof row.data_snapshot !== "object" || Array.isArray(row.data_snapshot)) return [];
    const source = (row.data_snapshot as JsonObject)["gdpsSourceEvidence"];
    if (!source || typeof source !== "object" || Array.isArray(source)) return [];
    const evidence = source as JsonObject;
    return evidence["productId"] === productId && evidence["contentHash"] === contentHash
      ? [{ evidence, gatewayQueryId: row.gateway_query_id }]
      : [];
  });
  if (matches.length !== 1) {
    throw new ProductionStageModuleError("PRIOR_GDPS_EXECUTION_EVIDENCE_AMBIGUOUS");
  }
  const match = matches[0]!;
  const evidence = match.evidence;
  const sourceGatewayQueryId = text(match.gatewayQueryId, "PRIOR_GDPS_GATEWAY_QUERY_ID_MISSING");
  const sourceRecipeLockHash = text(evidence["recipeLockHash"], "PRIOR_GDPS_RECIPE_LOCK_HASH_MISSING");
  const descriptorHash = text(evidence["descriptorHash"], "PRIOR_GDPS_DESCRIPTOR_HASH_MISSING");
  if (!sha256Pattern.test(sourceRecipeLockHash) || !sha256Pattern.test(descriptorHash) ||
      !sha256Pattern.test(options.sourceOperationLockHash)) {
    throw new ProductionStageModuleError("PRIOR_GDPS_EVIDENCE_HASH_INVALID");
  }
  return {
    sourceGroundingId: options.sourceGroundingId,
    sourceResultHash: options.sourceResultHash as `sha256:${string}`,
    selectedEvidenceProductId: options.selectedProductIds[0]!,
    productId,
    contentHash: contentHash as `sha256:${string}`,
    sourceOperation,
    sourceOperationVersion: "1.0",
    sourceRecipeId: text(evidence["recipeId"], "PRIOR_GDPS_RECIPE_ID_MISSING"),
    sourceRecipeLockHash: sourceRecipeLockHash as `sha256:${string}`,
    descriptorId: text(evidence["descriptorId"], "PRIOR_GDPS_DESCRIPTOR_ID_MISSING"),
    descriptorHash: descriptorHash as `sha256:${string}`,
    productType: text(evidence["productType"], "PRIOR_GDPS_PRODUCT_TYPE_MISSING"),
    productProfile: text(evidence["productProfile"], "PRIOR_GDPS_PRODUCT_PROFILE_MISSING"),
    queryProfile: text(evidence["queryProfile"], "PRIOR_GDPS_QUERY_PROFILE_MISSING"),
    replayMode: "STRICT",
    sourceGatewayQueryId,
    sourceOperationLockHash: options.sourceOperationLockHash as `sha256:${string}`
  };
}

export async function loadPriorCurrentnessContexts(
  pool: Pool,
  caller: GroundingIdentityV2 & { dataScope: string },
  rawPointers: readonly unknown[]
): Promise<PriorCurrentnessLoadResult> {
  const gdpsCurrentnessReplays: GdpsPriorCurrentnessReplay[] = [];
  const gdpsPersistedSourceQueries: GdpsPersistedSourceQuery[] = [];
  let hasOtherPriorProducts = false;
  for (const rawPointer of rawPointers) {
    const pointer = object(rawPointer, "INVALID_PRIOR_POINTER");
    if (Object.keys(pointer).some((key) => !["groundingId", "resultHash", "selectedProductIds"].includes(key))) {
      throw new ProductionStageModuleError("PRIOR_CONTENT_SUBSTITUTION_FORBIDDEN");
    }
    const groundingId = text(pointer["groundingId"], "INVALID_PRIOR_GROUNDING_ID");
    const resultHash = text(pointer["resultHash"], "INVALID_PRIOR_RESULT_HASH");
    const selectedProductIds = stringArray(pointer["selectedProductIds"]);
    if (!sha256Pattern.test(resultHash) || selectedProductIds.length > 64 ||
        new Set(selectedProductIds).size !== selectedProductIds.length) {
      throw new ProductionStageModuleError("INVALID_PRIOR_POINTER");
    }
    const stored = await pool.query<{
      result_hash: string;
      result_bytes: Buffer;
      principal_id: string;
      dataset_scopes: unknown;
      authorization_context_hash: string;
      gowm_operation_lock_hash: string | null;
    }>(
      `SELECT result.result_hash, result.result_bytes, request.principal_id,
              request.dataset_scopes, request.authorization_context_hash,
              request.gowm_operation_lock_hash
         FROM wsgs.grounding_result AS result
         JOIN wsgs.grounding_request AS request USING (grounding_id)
        WHERE result.grounding_id = $1 AND result.data_scope = $2 AND result.actor_id = $3`,
      [groundingId, caller.dataScope, caller.actorId]
    );
    const row = stored.rows[0];
    if (!row) throw new ProductionStageModuleError("PRIOR_RESULT_NOT_FOUND_IN_SCOPE");
    const storedDatasetScopes = Array.isArray(row.dataset_scopes) &&
      row.dataset_scopes.every((entry) => typeof entry === "string") ? row.dataset_scopes as string[] : [];
    if (row.result_hash !== resultHash || row.principal_id !== caller.servicePrincipalId ||
        row.authorization_context_hash !== caller.authorizationContextHash ||
        !exactStringSet(storedDatasetScopes, caller.datasetScopes) ||
        typeof row.gowm_operation_lock_hash !== "string" || !sha256Pattern.test(row.gowm_operation_lock_hash)) {
      throw new ProductionStageModuleError("PRIOR_RESULT_NOT_FOUND_IN_SCOPE");
    }
    const executions = await pool.query<PriorExecutionRow>(
      `SELECT execution_kind, operation_id, operation_version, gateway_query_id, request_hash, data_snapshot
         FROM wsgs.gowm_execution
        WHERE grounding_id = $1 AND data_scope = $2 AND actor_id = $3`,
      [groundingId, caller.dataScope, caller.actorId]
    );
    const replay = recognizeGdpsPriorCurrentnessReplay({
      sourceGroundingId: groundingId,
      sourceResultHash: resultHash,
      selectedProductIds,
      resultBytes: new Uint8Array(row.result_bytes),
      executions: executions.rows,
      sourceOperationLockHash: row.gowm_operation_lock_hash
    });
    if (replay) {
      const persistedQueries = await pool.query<PriorWorldQueryRow>(
        `SELECT query_id, gateway_query_id, plan, plan_hash
           FROM wsgs.world_query
          WHERE grounding_id = $1 AND data_scope = $2 AND query_id = $3`,
        [groundingId, caller.dataScope, replay.sourceGatewayQueryId]
      );
      if (persistedQueries.rows.length !== 1) {
        throw new ProductionStageModuleError("PRIOR_GDPS_SOURCE_QUERY_AMBIGUOUS");
      }
      const persistedQuery = persistedQueries.rows[0]!;
      if (persistedQuery.gateway_query_id !== replay.sourceGatewayQueryId) {
        throw new ProductionStageModuleError("PRIOR_GDPS_SOURCE_QUERY_ID_MISMATCH");
      }
      if (persistedQuery.query_id !== replay.sourceGatewayQueryId) {
        throw new ProductionStageModuleError("PRIOR_GDPS_SOURCE_QUERY_ID_MISMATCH");
      }
      const submission = parsePersistedWorldQuerySubmission(
        persistedQuery.plan,
        persistedQuery.query_id,
        persistedQuery.plan_hash
      );
      const sourceQueryExecutions = executions.rows.filter((entry) =>
        entry.execution_kind === "WORLD_QUERY" && entry.gateway_query_id === replay.sourceGatewayQueryId
      );
      if (sourceQueryExecutions.length !== 1 ||
          sourceQueryExecutions[0]!.request_hash !== canonicalSha256(submission)) {
        throw new ProductionStageModuleError("PRIOR_GDPS_SOURCE_QUERY_REQUEST_HASH_MISMATCH");
      }
      gdpsCurrentnessReplays.push(replay);
      gdpsPersistedSourceQueries.push({
        sourceGroundingId: groundingId,
        sourceGatewayQueryId: replay.sourceGatewayQueryId,
        sourcePlanHash: persistedQuery.plan_hash as `sha256:${string}`,
        submission
      });
    } else hasOtherPriorProducts = true;
  }
  if (gdpsCurrentnessReplays.length > 1 || (gdpsCurrentnessReplays.length > 0 && hasOtherPriorProducts)) {
    throw new ProductionStageModuleError("MIXED_PRIOR_REPLAY_AUTHORITY_FORBIDDEN");
  }
  return { gdpsCurrentnessReplays, gdpsPersistedSourceQueries, hasOtherPriorProducts };
}

/**
 * Adds an authority-bound prior-product marker to the public graph. The marker
 * contains only immutable product identity and lock provenance; it is not an
 * executable copy of the original query.
 */
export function augmentGroundingGraphWithCurrentness(
  value: DegradedGroundingGraphResult,
  replays: readonly GdpsPriorCurrentnessReplay[]
): DegradedGroundingGraphResult {
  if (replays.length === 0) return value;
  const replayNodes = replays.map((replay) => ({
    nodeId: `node-prior-currentness-${canonicalSha256(replay).slice("sha256:".length, "sha256:".length + 24)}`,
    kind: "WORLD_QUERY" as const,
    payload: {
      sourceGroundingId: replay.sourceGroundingId,
      sourceResultHash: replay.sourceResultHash,
      priorGroundingId: replay.sourceGroundingId,
      revalidationRequired: true,
      replayMode: replay.replayMode,
      gdpsCurrentProduct: {
        selectedEvidenceProductId: replay.selectedEvidenceProductId,
        productId: replay.productId,
        contentHash: replay.contentHash,
        sourceOperation: replay.sourceOperation,
        sourceOperationVersion: replay.sourceOperationVersion,
        sourceRecipeId: replay.sourceRecipeId,
        sourceRecipeLockHash: replay.sourceRecipeLockHash,
        descriptorId: replay.descriptorId,
        descriptorHash: replay.descriptorHash,
        productType: replay.productType,
        productProfile: replay.productProfile,
        queryProfile: replay.queryProfile
      }
    }
  }));
  const graph = validateGroundingGraph({
    schemaVersion: "1.0",
    nodes: [...value.graph.nodes, ...replayNodes].sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    edges: [...value.graph.edges]
  });
  return { ...value, graph, graphHash: canonicalGraphHash(graph) };
}

function currentnessReplays(context: PipelineStageContext): GdpsPriorCurrentnessReplay[] {
  const loaded = stageValue<PriorCurrentnessLoadResult & JsonObject>(context, "LOAD_CONTEXT");
  return Array.isArray(loaded.gdpsCurrentnessReplays)
    ? loaded.gdpsCurrentnessReplays as GdpsPriorCurrentnessReplay[]
    : [];
}

function persistedCurrentnessSourceQueries(context: PipelineStageContext): GdpsPersistedSourceQuery[] {
  const loaded = stageValue<PriorCurrentnessLoadResult & JsonObject>(context, "LOAD_CONTEXT");
  return Array.isArray(loaded.gdpsPersistedSourceQueries)
    ? loaded.gdpsPersistedSourceQueries as GdpsPersistedSourceQuery[]
    : [];
}

export function mergeKnownReferenceProducts(
  resolved: ReferenceGroundingResult | undefined,
  known: readonly JsonObject[]
): ReferenceGroundingResult {
  const result = resolved ?? normalizeReferenceResolution(null, []);
  const seen = new Set(result.referenceProducts.map((entry) => JSON.stringify(entry.referenceKey)));
  const additions = known.flatMap((entry, index): ReferenceProduct[] => {
    const key = referenceKey(entry["referenceKey"]);
    const canonicalKey = JSON.stringify(key);
    if (seen.has(canonicalKey)) return [];
    seen.add(canonicalKey);
    return [{
      productId: `known-reference-${index}-${createHash("sha256").update(canonicalKey).digest("hex").slice(0, 16)}`,
      productKind: "RESOLVED_REFERENCE",
      referenceKey: key,
      referenceType: text(entry["referenceType"], "INVALID_REFERENCE_TYPE"),
      displayName: typeof entry["alias"] === "string"
        ? entry["alias"]
        : text(object(entry["referenceKey"], "INVALID_REFERENCE_KEY")["id"], "INVALID_REFERENCE_ID"),
      matchedBy: "EXACT_REFERENCE_KEY",
      matchScore: 1,
      sourceOperation: "reference.resolve",
      sourceWorldVersion: 0,
      revalidationRequired: true,
      safeSummary: { source: "contextCapsule" }
    }];
  });
  return { ...result, referenceProducts: [...result.referenceProducts, ...additions] };
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
        revalidationRequired: status !== "VALID" || usable !== "YES",
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

export function referenceMentionsRequiringResolution(
  mentions: readonly MergedMention[],
  deterministic: DeterministicParseResult
): MergedMention[] {
  const knownMentionIds = new Set(deterministic.mentions.flatMap((mention) =>
    mention.candidate.kind === "KNOWN_REFERENCE" ? [mention.mentionId] : []));
  return productionReferenceMentions(mentions).filter((mention) => !knownMentionIds.has(mention.mentionId));
}

export function applyReferenceValidation(
  product: ReferenceProduct,
  validation: ReferenceValidationProduct,
  evaluatedAt: string,
  validityTtlMs: number
): ReferenceProduct {
  const timestamp = Date.parse(evaluatedAt);
  if (!Number.isFinite(timestamp) || !Number.isInteger(validityTtlMs) || validityTtlMs < 1) {
    throw new ProductionStageModuleError("REFERENCE_VALIDATION_LEASE_INVALID");
  }
  const usable = validation.status === "VALID" && !validation.revalidationRequired;
  const { validUntil: _priorValidity, ...withoutPriorValidity } = product;
  return {
    ...withoutPriorValidity,
    sourceOperation: "VALIDATE_REFERENCES",
    revalidationRequired: !usable,
    ...(usable ? { validUntil: new Date(timestamp + validityTtlMs).toISOString() } : {}),
    safeSummary: {
      ...product.safeSummary,
      validationStatus: validation.status,
      validationSourceOperation: "reference.validate",
      validationEvaluatedAt: new Date(timestamp).toISOString(),
      validitySemantics: "GOWM_REFERENCE_VALIDATE_BOUNDED_LEASE"
    }
  };
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
  originalText?: string;
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
    const validation = chain.find((entry) => entry.requirementType === "VALIDATE_RESULT");
    const resultNodeIds = stringArray(validation?.inputs["resultNodeIds"]);
    if (resultNodeIds.length !== 1) {
      return recipeInputGap(options.recipeId, requiredForProduct, "PINNED_PRIOR_RESULT_INPUT_UNAVAILABLE", {
        resultNodeCount: resultNodeIds.length
      });
    }
    const node = options.groundingGraph.graph.nodes.find((entry) => entry.nodeId === resultNodeIds[0]);
    const payload = node?.kind === "WORLD_QUERY" ? node.payload as JsonObject : undefined;
    const currentProduct = payload?.["gdpsCurrentProduct"];
    if (!payload || !["STRICT", "BEST_EFFORT"].includes(String(payload["replayMode"])) ||
        !currentProduct || typeof currentProduct !== "object" || Array.isArray(currentProduct)) {
      return recipeInputGap(options.recipeId, requiredForProduct, "PINNED_PRIOR_RESULT_INPUT_UNAVAILABLE");
    }
    const product = currentProduct as JsonObject;
    const productId = typeof product["productId"] === "string" ? product["productId"] : "";
    const contentHash = typeof product["contentHash"] === "string" ? product["contentHash"] : "";
    const sourceRecipeLockHash = typeof product["sourceRecipeLockHash"] === "string"
      ? product["sourceRecipeLockHash"] : "";
    const descriptorHash = typeof product["descriptorHash"] === "string" ? product["descriptorHash"] : "";
    if (!gdpsProductIdPattern.test(productId) || !sha256Pattern.test(contentHash) ||
        !sha256Pattern.test(sourceRecipeLockHash) || !sha256Pattern.test(descriptorHash) ||
        product["sourceOperationVersion"] !== "1.0") {
      return recipeInputGap(options.recipeId, requiredForProduct, "PINNED_PRIOR_RESULT_INPUT_INVALID");
    }
    for (const key of ["sourceOperation", "sourceRecipeId", "descriptorId", "productType", "productProfile", "queryProfile"] as const) {
      if (typeof product[key] !== "string" || !(product[key] as string)) {
        return recipeInputGap(options.recipeId, requiredForProduct, "PINNED_PRIOR_RESULT_INPUT_INVALID", { field: key });
      }
    }
    return {
      status: "READY",
      requiredForProduct,
      operationInput: { productId, contentHash },
      parameterValues: {
        productId,
        contentHash,
        replayMode: payload["replayMode"],
        sourceGroundingId: payload["sourceGroundingId"],
        sourceResultHash: payload["sourceResultHash"],
        selectedEvidenceProductId: product["selectedEvidenceProductId"],
        sourceOperation: product["sourceOperation"],
        sourceOperationVersion: product["sourceOperationVersion"],
        sourceRecipeId: product["sourceRecipeId"],
        sourceRecipeLockHash,
        descriptorId: product["descriptorId"],
        descriptorHash,
        productType: product["productType"],
        productProfile: product["productProfile"],
        queryProfile: product["queryProfile"]
      }
    };
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
  const gdpsRule = queryTemplateRules.find((entry) =>
    entry.pattern === options.recipeId && entry.previewAuthorizationRequired === true);
  if (gdpsRule) {
    const semanticRequirement = chain.at(-1)!;
    const productIds = stringArray(semanticRequirement.inputs["explicitProductIds"]);
    if (productIds.length > 1) {
      return recipeInputGap(options.recipeId, requiredForProduct, "EXPLICIT_PRODUCT_PREFERENCE_AMBIGUOUS", {
        productCount: productIds.length
      });
    }
    if (productIds[0]) parameterValues["explicitProductId"] = productIds[0];
    const descriptorIntents = Array.isArray(semanticRequirement.inputs["descriptorIntents"])
      ? semanticRequirement.inputs["descriptorIntents"] : [];
    if (descriptorIntents.length > 1) {
      return recipeInputGap(options.recipeId, requiredForProduct, "DESCRIPTOR_INTENT_AMBIGUOUS", {
        descriptorCount: descriptorIntents.length
      });
    }
    if (descriptorIntents.length === 1) {
      const descriptorIntent = object(descriptorIntents[0], "DESCRIPTOR_INTENT_INVALID");
      for (const key of [
        "descriptorId", "descriptorHash", "productType", "productProfile", "queryProfile",
        "explicitProductId", "classCodes", "ranges", "propertyFilters", "platformProfile", "spatialConstraint"
      ] as const) {
        if (descriptorIntent[key] !== undefined) parameterValues[key] = structuredClone(descriptorIntent[key]);
      }
      const spatialConstraint = descriptorIntent["spatialConstraint"];
      if (spatialConstraint && typeof spatialConstraint === "object" && !Array.isArray(spatialConstraint)) {
        const distanceM = (spatialConstraint as JsonObject)["distanceM"];
        if (typeof distanceM === "number" && Number.isFinite(distanceM) && distanceM > 0) {
          parameterValues["distanceM"] = distanceM;
        }
      }
    }
    if (options.recipeId === "GDPS_OBSTACLES_NEAR_REFERENCE") {
      const constraints = Array.isArray(semanticRequirement.inputs["spatialConstraints"])
        ? semanticRequirement.inputs["spatialConstraints"] : [];
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
      parameterValues["distanceMetres"] = distances[0]! / 1_000;
    }
  }
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
  const executed = context.state["GOWM_EXECUTE"] as {
    outcomes: Array<{ submission: WorldQuerySubmission; status: string; resultHash: string }>;
    sourceChangeAttempts?: Array<{ submission: WorldQuerySubmission; status: string; resultHash: string }>;
  } | undefined;
  const normalized = context.state["EVIDENCE_NORMALIZE"] as {
    status: "COMPLETED" | "PARTIAL";
    evidenceItems: GroundingEvidenceItem[];
    capabilityGaps: JsonObject[];
    warnings?: string[];
  } | undefined;
  const gaps = [
    ...(planning?.capabilityGaps ?? []).map((entry) => mappedGap(entry as unknown as JsonObject)),
    ...(compiled?.capabilityGaps ?? []).map(mappedGap),
    ...(normalized?.capabilityGaps ?? []).map(mappedGap)
  ];
  const warnings = [
    ...(deterministic?.warnings ?? []),
    ...(semantic?.warnings ?? []),
    ...(graph?.warnings ?? []),
    ...(references?.validationResults.flatMap((entry) => entry.warnings) ?? []),
    ...(normalized?.warnings ?? [])
  ];
  const ambiguities = references?.ambiguities ?? [];
  const unresolved = references?.unresolvedMentions ?? [];
  const currentnessMismatch = gaps.some((gap) => {
    const details = gap["details"];
    return details && typeof details === "object" && !Array.isArray(details) &&
      ["STALE", "SNAPSHOT_MISMATCHED", "DATA_GAP", "SOURCE_CHANGED"]
        .includes(String((details as JsonObject)["code"]));
  });
  const partial = semantic?.completionStatus === "PARTIAL" || graph?.completionStatus === "PARTIAL" ||
    normalized?.status === "PARTIAL" || gaps.some((gap) => gap["blocking"] === true);
  const status = ambiguities.length > 0 ? "AMBIGUOUS" : unresolved.length > 0 && (references?.referenceProducts.length ?? 0) === 0
    ? "UNRESOLVED" : currentnessMismatch ? "UNRESOLVED" : partial ? "PARTIAL" : "COMPLETED";
  const executedQueries = executed ? [...executed.outcomes, ...(executed.sourceChangeAttempts ?? [])] : undefined;
  const queryRecords = executedQueries?.map((entry) => ({
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
  delegatedIdentityHash: string;
  startedAt: string;
  finishedAt: string;
  encryptedCheckpointEvidenceMaterial: EncryptedCheckpointEvidenceMaterial;
}

function finalWorldResult(outcome: PersistedWorldQueryOutcome): JsonObject {
  const material = outcome.encryptedCheckpointEvidenceMaterial;
  if (material.responseStatus === 200) return object(material.response, "WORLD_QUERY_RESULT_INVALID");
  const terminal = object(material.terminal, "WORLD_QUERY_JOB_INVALID");
  return object(terminal["result"], "WORLD_QUERY_JOB_RESULT_MISSING");
}

export interface NormalizedGdpsWorldQuerySource {
  nodeId: string;
  evidence: GdpsSourceEvidence;
}

export function normalizeGdpsWorldQuerySources(
  submission: WorldQuerySubmission,
  worldValue: unknown,
  recipeLock?: LoadedGdpsRecipeLock
): NormalizedGdpsWorldQuerySource[] {
  if (!recipeLock) return [];
  const world = object(worldValue, "WORLD_QUERY_RESULT_INVALID");
  const nodes = Array.isArray(world["nodes"]) ? world["nodes"] : [];
  const plannedByNode = new Map(submission.plan.nodes.map((node) => [node.nodeId, node]));
  const recipesByOperation = new Map<string, GdpsLockedRecipe>();
  for (const recipe of recipeLock.lock.recipes) {
    for (const operation of recipe.allowedOperations) {
      const key = `${operation.operationId}@${operation.operationVersion}`;
      if (recipesByOperation.has(key)) throw new ProductionStageModuleError("GDPS_RECIPE_OPERATION_AMBIGUOUS");
      recipesByOperation.set(key, recipe);
    }
  }
  const parameters = submission.parameters;
  return nodes.flatMap((rawNode): NormalizedGdpsWorldQuerySource[] => {
    const node = object(rawNode, "WORLD_QUERY_NODE_INVALID");
    const nodeId = text(node["nodeId"], "WORLD_QUERY_NODE_ID_MISSING");
    const planned = plannedByNode.get(nodeId);
    if (!planned) throw new ProductionStageModuleError("WORLD_QUERY_NODE_NOT_IN_PLAN");
    const key = `${planned.operation.operationId}@${planned.operation.operationVersion}`;
    const recipe = recipesByOperation.get(key);
    if (!recipe) return [];
    if (node["result"] === undefined) throw new ProductionStageModuleError("GDPS_NODE_RESULT_MISSING");
    const descriptorId = text(parameters["descriptorId"], "GDPS_DESCRIPTOR_ID_MISSING");
    const descriptorHash = text(parameters["descriptorHash"], "GDPS_DESCRIPTOR_HASH_MISSING") as `sha256:${string}`;
    const productType = text(parameters["productType"], "GDPS_PRODUCT_TYPE_MISSING");
    const productProfile = text(parameters["productProfile"], "GDPS_PRODUCT_PROFILE_MISSING");
    const queryProfile = text(parameters["queryProfile"], "GDPS_QUERY_PROFILE_MISSING");
    return [{
      nodeId,
      evidence: normalizeGdpsSourceEvidence(node["result"], {
        recipeId: recipe.recipeId,
        recipeLockHash: recipeLock.lockHash,
        descriptorId,
        descriptorHash,
        productType,
        productProfile,
        queryProfile
      })
    }];
  });
}

export interface GdpsCurrentnessWorldQueryResult {
  nodeId: string;
  currentness: "CURRENT" | "CHANGED" | "NOT_AVAILABLE";
  currentContentHash?: `sha256:${string}`;
  decision: GdpsReplayDecision;
}

/**
 * Verifies that a replay query is the single authorized currentness operation
 * and evaluates the provider response under the explicitly selected replay
 * mode. No producing operation from the historical query is accepted here;
 * BEST_EFFORT source refresh is a separate, sequential Gateway query.
 */
export function normalizeGdpsCurrentnessWorldQuery(options: {
  submission: WorldQuerySubmission;
  worldValue: unknown;
  replay: GdpsPriorCurrentnessReplay;
  operation: OperationLock;
  authorization: GdpsCurrentnessAuthorization;
}): GdpsCurrentnessWorldQueryResult {
  const { submission, replay, operation, authorization } = options;
  const planned = submission.plan.nodes;
  if (planned.length !== 1 || planned[0]?.operation.operationId !== "geo-product.check-current" ||
      planned[0].operation.operationVersion !== "1.0" ||
      planned[0].operation.inputSchemaHash !== authorization.allowedOperation.inputSchemaHash ||
      planned[0].operation.outputSchemaHash !== authorization.allowedOperation.outputSchemaHash ||
      operation.operationId !== "geo-product.check-current" || operation.operationVersion !== "1.0" ||
      operation.inputSchemaHash !== authorization.allowedOperation.inputSchemaHash ||
      operation.outputSchemaHash !== authorization.allowedOperation.outputSchemaHash ||
      operation.semanticProfileHash !== authorization.allowedOperation.semanticProfileHash) {
    throw new ProductionStageModuleError("GDPS_CURRENTNESS_OPERATION_CHAIN_INVALID");
  }
  const parameters = submission.parameters;
  if (parameters["productId"] !== replay.productId || parameters["contentHash"] !== replay.contentHash ||
      parameters["replayMode"] !== replay.replayMode || parameters["sourceGroundingId"] !== replay.sourceGroundingId ||
      parameters["sourceResultHash"] !== replay.sourceResultHash ||
      parameters["currentnessRecipeId"] !== authorization.recipeId ||
      parameters["currentnessProviderRecipeLockHash"] !== authorization.providerRecipeLockHash ||
      parameters["currentnessOperationLockHash"] !== authorization.operationLockHash) {
    throw new ProductionStageModuleError("GDPS_CURRENTNESS_PLAN_AUTHORITY_MISMATCH");
  }
  const world = object(options.worldValue, "WORLD_QUERY_RESULT_INVALID");
  const nodes = Array.isArray(world["nodes"]) ? world["nodes"] : [];
  if (nodes.length !== 1) throw new ProductionStageModuleError("GDPS_CURRENTNESS_RESULT_CHAIN_INVALID");
  const node = object(nodes[0], "WORLD_QUERY_NODE_INVALID");
  if (node["nodeId"] !== planned[0].nodeId || node["status"] !== "COMPLETED") {
    throw new ProductionStageModuleError("GDPS_CURRENTNESS_RESULT_CHAIN_INVALID");
  }
  const output = object(envelopeValue(object(node["result"], "GDPS_CURRENTNESS_RESULT_MISSING"), operation),
    "GDPS_CURRENTNESS_OUTPUT_INVALID");
  const productId = text(output["productId"], "GDPS_CURRENTNESS_PRODUCT_ID_MISSING");
  const currentness = output["currentness"];
  if (productId !== replay.productId || !["CURRENT", "CHANGED", "NOT_AVAILABLE"].includes(String(currentness))) {
    throw new ProductionStageModuleError("GDPS_CURRENTNESS_OUTPUT_INVALID");
  }
  const currentContentHash = output["currentContentHash"];
  if (currentness === "NOT_AVAILABLE") {
    if (currentContentHash !== undefined && currentContentHash !== null) {
      throw new ProductionStageModuleError("GDPS_CURRENTNESS_NOT_AVAILABLE_HASH_FORBIDDEN");
    }
  } else if (typeof currentContentHash !== "string" || !sha256Pattern.test(currentContentHash)) {
    throw new ProductionStageModuleError("GDPS_CURRENTNESS_CURRENT_HASH_REQUIRED");
  }
  let decision: GdpsReplayDecision;
  try {
    decision = evaluateGdpsCurrentOnlyReplay(replay.replayMode, {
      productId: replay.productId,
      contentHash: replay.contentHash
    }, {
      productId,
      currentness: currentness as "CURRENT" | "CHANGED" | "NOT_AVAILABLE",
      ...(typeof currentContentHash === "string"
        ? { currentContentHash: currentContentHash as `sha256:${string}` }
        : {})
    });
  } catch (error) {
    const code = error instanceof Error && /^GDPS_[A-Z0-9_]+$/u.test(error.message)
      ? error.message : "GDPS_CURRENTNESS_DECISION_INVALID";
    throw new ProductionStageModuleError(code);
  }
  return {
    nodeId: planned[0].nodeId,
    currentness: currentness as "CURRENT" | "CHANGED" | "NOT_AVAILABLE",
    ...(typeof currentContentHash === "string"
      ? { currentContentHash: currentContentHash as `sha256:${string}` }
      : {}),
    decision
  };
}

function applyGdpsCurrentnessDecision(
  evidence: ExecutionEvidenceProduct,
  replay: GdpsPriorCurrentnessReplay,
  normalized: GdpsCurrentnessWorldQueryResult,
  authorization: GdpsCurrentnessAuthorization
): ExecutionEvidenceProduct {
  const decisionSnapshot = {
    schemaVersion: "wsgs-gdps-currentness-decision/1.0",
    status: normalized.decision.status,
    currentness: normalized.currentness,
    replayMode: replay.replayMode,
    source: { productId: replay.productId, contentHash: replay.contentHash },
    ...(normalized.currentContentHash ? { currentContentHash: normalized.currentContentHash } : {}),
    executionBlocked: normalized.decision.status !== "REPLAY_ALLOWED",
    sourceGroundingId: replay.sourceGroundingId,
    sourceResultHash: replay.sourceResultHash,
    selectedEvidenceProductId: replay.selectedEvidenceProductId,
    sourceOperation: replay.sourceOperation,
    sourceOperationVersion: replay.sourceOperationVersion,
    sourceRecipeId: replay.sourceRecipeId,
    sourceRecipeLockHash: replay.sourceRecipeLockHash,
    descriptorId: replay.descriptorId,
    descriptorHash: replay.descriptorHash,
    productType: replay.productType,
    productProfile: replay.productProfile,
    queryProfile: replay.queryProfile,
    currentnessRecipeId: authorization.recipeId,
    providerRecipeLockHash: authorization.providerRecipeLockHash,
    operationLockHash: authorization.operationLockHash,
    historicalPayloadRead: false,
    currentIdentityPolicy: normalized.currentness === "CURRENT"
      ? "IDENTITY_CONFIRMED_NO_HISTORICAL_PAYLOAD"
      : normalized.currentness === "CHANGED" && replay.replayMode === "BEST_EFFORT"
        ? "NEW_CURRENT_SOURCE_QUERY_REQUIRED"
        : "NO_SOURCE_QUERY_ALLOWED"
  };
  const blocked = normalized.decision.status !== "REPLAY_ALLOWED";
  const blockedStatus = normalized.currentness === "NOT_AVAILABLE"
    ? "NO_DATA" as const
    : normalized.decision.mode === "BEST_EFFORT" ? "INDETERMINATE" as const : "STALE" as const;
  const explicitWarnings = normalized.currentness === "CURRENT" && normalized.decision.status === "REPLAY_ALLOWED"
    ? ["CURRENT_SOURCE_IDENTITY_CONFIRMED"]
    : [...normalized.decision.warnings];
  const nodeRecords = evidence.nodeRecords.map((record) => record.operationId === "geo-product.check-current" ? {
    ...record,
    normalizedStatus: blocked ? blockedStatus : record.normalizedStatus,
    dataSnapshot: { ...(record.dataSnapshot ?? {}), gdpsCurrentnessDecision: decisionSnapshot }
  } : record);
  const body = {
    ...evidence,
    record: {
      ...evidence.record,
      normalizedStatus: blocked ? blockedStatus : evidence.record.normalizedStatus,
      dataSnapshot: { ...(evidence.record.dataSnapshot ?? {}), gdpsCurrentnessDecision: decisionSnapshot }
    },
    nodeRecords,
    evidenceItems: evidence.evidenceItems.map((item) => item.sourceOperation === "geo-product.check-current" ? {
      ...item,
      dataSnapshot: { ...(item.dataSnapshot ?? {}), gdpsCurrentnessDecision: decisionSnapshot },
      warnings: [...new Set([...item.warnings, ...explicitWarnings])].sort()
    } : item),
    warnings: [...new Set([...evidence.warnings, ...explicitWarnings])].sort()
  };
  const { productHash: _priorProductHash, ...hashable } = body;
  return { ...hashable, productHash: canonicalSha256(hashable) as Sha256Digest };
}

export interface GdpsCurrentSourceCompilationOptions {
  replay: GdpsPriorCurrentnessReplay;
  persistedSource: GdpsPersistedSourceQuery;
  attempt: 1 | 2;
  requestId: string;
  idempotencyKey: string;
  requiredForProduct: string;
  parameterSchemaHash: `sha256:${string}`;
  capabilities: CapabilityDescriptor[];
  semanticProfiles: CapabilitySemanticCatalog["profiles"];
  operationLocks: OperationLock[];
  operationLockHash: `sha256:${string}`;
  availability: OperationAvailabilityList["operations"];
  allowPreview: boolean;
  observedAt: string;
  budgets: ExecutionBudgets;
  recipeLock: LoadedGdpsRecipeLock;
}

function exactOperationIdentity(
  left: { operationId: string; operationVersion: string; inputSchemaHash: string; outputSchemaHash: string },
  right: { operationId: string; operationVersion: string; inputSchemaHash: string; outputSchemaHash: string }
): boolean {
  return left.operationId === right.operationId && left.operationVersion === right.operationVersion &&
    left.inputSchemaHash === right.inputSchemaHash && left.outputSchemaHash === right.outputSchemaHash;
}

/**
 * Recompiles the persisted source recipe against the current immutable
 * authority. The prior product payload is neither accepted nor read: only the
 * persisted operation input, recipe/descriptor identity, and exact hashes are
 * carried forward into a genuinely new current-source query.
 */
export function compileGdpsBestEffortCurrentSource(
  options: GdpsCurrentSourceCompilationOptions
): Extract<CompileResult, { status: "COMPILED" }> {
  const { replay, persistedSource, recipeLock } = options;
  if (replay.replayMode !== "BEST_EFFORT" ||
      persistedSource.sourceGroundingId !== replay.sourceGroundingId ||
      persistedSource.sourceGatewayQueryId !== replay.sourceGatewayQueryId ||
      canonicalPlanHash(persistedSource.submission.plan) !== persistedSource.sourcePlanHash ||
      persistedSource.submission.parameterSchemaHash !== options.parameterSchemaHash ||
      replay.sourceOperationLockHash !== options.operationLockHash ||
      recipeLock.lockHash !== replay.sourceRecipeLockHash) {
    throw new ProductionStageModuleError("GDPS_BEST_EFFORT_SOURCE_AUTHORITY_MISMATCH");
  }
  const matchingRecipes = recipeLock.lock.recipes.filter((entry) => entry.recipeId === replay.sourceRecipeId);
  if (matchingRecipes.length !== 1) throw new ProductionStageModuleError("GDPS_BEST_EFFORT_SOURCE_RECIPE_AMBIGUOUS");
  const recipe = matchingRecipes[0]!;
  const rule = queryTemplateRules.find((entry) => entry.pattern === recipe.semanticPattern && entry.previewAuthorizationRequired);
  if (!rule || recipe.previewAuthorizationRequired !== true || recipe.maturityPolicy.allowed !== "PREVIEW" ||
      recipe.maturityPolicy.requiresExactHashes !== true ||
      (recipe.descriptorConstraint !== null &&
        (recipe.descriptorConstraint.descriptorId !== replay.descriptorId ||
          recipe.descriptorConstraint.descriptorHash !== replay.descriptorHash)) ||
      (recipe.queryProfile !== null && recipe.queryProfile !== replay.queryProfile)) {
    throw new ProductionStageModuleError("GDPS_BEST_EFFORT_SOURCE_RECIPE_DRIFT");
  }
  const sourceParameters = object(
    persistedSource.submission.parameters,
    "GDPS_BEST_EFFORT_SOURCE_PARAMETERS_INVALID"
  );
  const allowedSourceParameterKeys = new Set([
    "operationInput", "descriptorId", "descriptorHash", "productType", "productProfile", "queryProfile",
    "explicitProductId", "classCodes", "ranges", "propertyFilters", "platformProfile", "spatialConstraint",
    "distanceM", "distanceMetres"
  ]);
  if (Object.keys(sourceParameters).some((key) => !allowedSourceParameterKeys.has(key))) {
    throw new ProductionStageModuleError("GDPS_BEST_EFFORT_SOURCE_PARAMETER_NOT_AUTHORIZED");
  }
  const operationInput = object(
    sourceParameters["operationInput"],
    "GDPS_BEST_EFFORT_SOURCE_OPERATION_INPUT_MISSING"
  );
  for (const [key, expected] of Object.entries({
    descriptorId: replay.descriptorId,
    descriptorHash: replay.descriptorHash,
    productType: replay.productType,
    productProfile: replay.productProfile,
    queryProfile: replay.queryProfile
  })) {
    if (sourceParameters[key] !== expected) {
      throw new ProductionStageModuleError("GDPS_BEST_EFFORT_SOURCE_DESCRIPTOR_DRIFT");
    }
  }
  const sourcePlanNodes = persistedSource.submission.plan.nodes.filter((entry) =>
    entry.operation.operationId === replay.sourceOperation &&
    entry.operation.operationVersion === replay.sourceOperationVersion
  );
  const recipeOperations = recipe.allowedOperations.filter((entry) =>
    entry.operationId === replay.sourceOperation && entry.operationVersion === replay.sourceOperationVersion
  );
  const lockedSourceOperation = options.operationLocks.find((entry) =>
    entry.operationId === replay.sourceOperation && entry.operationVersion === replay.sourceOperationVersion
  );
  if (sourcePlanNodes.length !== 1 || recipeOperations.length !== 1 || !lockedSourceOperation ||
      !exactOperationIdentity(sourcePlanNodes[0]!.operation, recipeOperations[0]!) ||
      lockedSourceOperation.semanticProfileHash !== recipeOperations[0]!.semanticProfileHash) {
    throw new ProductionStageModuleError("GDPS_BEST_EFFORT_SOURCE_OPERATION_DRIFT");
  }
  for (const node of persistedSource.submission.plan.nodes) {
    const locked = options.operationLocks.find((entry) =>
      entry.operationId === node.operation.operationId && entry.operationVersion === node.operation.operationVersion
    );
    if (!locked || !exactOperationIdentity(node.operation, locked)) {
      throw new ProductionStageModuleError("GDPS_BEST_EFFORT_SOURCE_OPERATION_LOCK_DRIFT");
    }
  }
  const parameterValues = Object.fromEntries(Object.entries(sourceParameters)
    .filter(([key]) => key !== "operationInput")
    .map(([key, value]) => [key, structuredClone(value)]));
  const compiler = new TypedWorldQueryCompiler();
  const refreshRequestId = `wsgs-refresh-${canonicalSha256({
    requestId: options.requestId,
    sourcePlanHash: persistedSource.sourcePlanHash,
    attempt: options.attempt
  }).slice("sha256:".length, "sha256:".length + 32)}`;
  const compiled = compiler.compile({
    requestId: refreshRequestId,
    idempotencyKey: `${options.idempotencyKey}:gdps-current-source:${options.attempt}`,
    pattern: recipe.semanticPattern as QuerySemanticPattern,
    requiredForProduct: options.requiredForProduct,
    operationInput: structuredClone(operationInput),
    parameterValues,
    capabilities: options.capabilities,
    semanticProfiles: options.semanticProfiles,
    operationLocks: options.operationLocks,
    availability: options.availability,
    maturityPolicy: { allowPreview: options.allowPreview },
    trustedGdpsRecipeLockHash: recipeLock.lockHash,
    gdpsRecipeAuthorization: {
      recipeId: recipe.recipeId,
      semanticPattern: recipe.semanticPattern as QuerySemanticPattern,
      recipeLockHash: recipeLock.lockHash,
      descriptorId: replay.descriptorId,
      descriptorHash: replay.descriptorHash,
      previewAuthorizationRequired: true,
      allowedOperations: recipe.allowedOperations
    },
    parameterSchemaHash: options.parameterSchemaHash,
    observedAt: options.observedAt,
    snapshotPolicy: { mode: "LATEST_AT_START", allowDowngrade: false },
    budgets: options.budgets
  });
  if (compiled.status !== "COMPILED") {
    throw new ProductionStageModuleError(`GDPS_BEST_EFFORT_SOURCE_COMPILE_${compiled.gap.reason}`);
  }
  const oldOperationChain = persistedSource.submission.plan.nodes.map((entry) =>
    `${entry.operation.operationId}@${entry.operation.operationVersion}`);
  const newOperationChain = compiled.submission.plan.nodes.map((entry) =>
    `${entry.operation.operationId}@${entry.operation.operationVersion}`);
  if (JSON.stringify(oldOperationChain) !== JSON.stringify(newOperationChain) ||
      compiled.submission.plan.nodes.filter((entry) => entry.operation.operationId === replay.sourceOperation).length !== 1 ||
      compiled.submission.plan.nodes.some((entry) => entry.operation.operationId === "geo-product.check-current")) {
    throw new ProductionStageModuleError("GDPS_BEST_EFFORT_SOURCE_CHAIN_DRIFT");
  }
  const plan = {
    ...compiled.submission.plan,
    queryId: `query-${canonicalSha256({
      requestId: refreshRequestId,
      sourcePlanHash: persistedSource.sourcePlanHash,
      currentRecipeLockHash: recipeLock.lockHash,
      attempt: options.attempt
    }).slice("sha256:".length, "sha256:".length + 24)}`
  };
  if (plan.queryId === persistedSource.submission.plan.queryId) {
    throw new ProductionStageModuleError("GDPS_BEST_EFFORT_SOURCE_QUERY_NOT_NEW");
  }
  const submission: WorldQuerySubmission = {
    ...compiled.submission,
    plan,
    idempotencyKey: `${options.idempotencyKey}:gdps-current-source:${options.attempt}`
  };
  return {
    ...compiled,
    submission,
    planHash: canonicalPlanHash(plan)
  };
}

export type GdpsSequentialCurrentSourceResult<T> =
  | { status: "NOT_RUN_STRICT" | "CURRENT_CONFIRMED" | "DATA_GAP"; attempts: readonly [] }
  | { status: "COMPLETED"; attempts: readonly [T] | readonly [T, T] }
  | {
    status: "INDETERMINATE";
    attempts: readonly [T, T];
    reasonCode: "SOURCE_CHANGED";
    upstreamCondition: "SOURCE_CHANGED_DURING_QUERY";
  };

/** Internal bounded state machine: a current-source query is allowed only for BEST_EFFORT+CHANGED. */
export async function executeGdpsSequentialCurrentSource<T>(options: {
  replayMode: "STRICT" | "BEST_EFFORT";
  currentness: "CURRENT" | "CHANGED" | "NOT_AVAILABLE";
  executeAttempt: (attempt: 1 | 2) => Promise<{ value: T; sourceChangedDuringQuery: boolean }>;
}): Promise<GdpsSequentialCurrentSourceResult<T>> {
  if (options.replayMode === "STRICT") return { status: "NOT_RUN_STRICT", attempts: [] };
  if (options.currentness === "CURRENT") return { status: "CURRENT_CONFIRMED", attempts: [] };
  if (options.currentness === "NOT_AVAILABLE") return { status: "DATA_GAP", attempts: [] };
  const first = await options.executeAttempt(1);
  if (!first.sourceChangedDuringQuery) return { status: "COMPLETED", attempts: [first.value] };
  const second = await options.executeAttempt(2);
  return second.sourceChangedDuringQuery
    ? {
      status: "INDETERMINATE",
      attempts: [first.value, second.value],
      reasonCode: "SOURCE_CHANGED",
      upstreamCondition: "SOURCE_CHANGED_DURING_QUERY"
    }
    : { status: "COMPLETED", attempts: [first.value, second.value] };
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

async function persistCompiledWorldQuery(
  context: PipelineStageContext,
  pool: Pool,
  item: Extract<CompileResult, { status: "COMPILED" }>
): Promise<void> {
  await withFence(context, pool, async (client) => {
    const inserted = await client.query(
      `INSERT INTO wsgs.world_query(query_id, grounding_id, data_scope, plan, plan_hash)
       VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (query_id) DO UPDATE SET plan = EXCLUDED.plan, plan_hash = EXCLUDED.plan_hash
       WHERE wsgs.world_query.grounding_id = EXCLUDED.grounding_id
         AND wsgs.world_query.data_scope = EXCLUDED.data_scope
         AND wsgs.world_query.plan_hash = EXCLUDED.plan_hash`,
      [item.submission.plan.queryId, context.groundingId, identity(context).dataScope,
        JSON.stringify(item.submission), item.planHash]
    );
    if (inserted.rowCount !== 1) throw new PipelineFenceRejectedError();
  });
}

async function executeWorldQuerySubmission(
  value: Runtime,
  context: PipelineStageContext,
  submission: WorldQuerySubmission
): Promise<PersistedWorldQueryOutcome> {
  const caller = identity(context);
  const requestId = text(submission.requestId, "REQUEST_ID_MISSING");
  const signed = await value.signer.sign({
    kind: "WORLD_QUERY", identity: caller, requestId,
    plan: submission.plan,
    dataScopes: [caller.dataScope], datasetScopes: caller.datasetScopes
  });
  const gatewayContext: GatewayRequestContext = {
    signal: context.signal, deadlineAt: context.deadlineAt,
    requestId, delegationToken: signed.token, preferAsync: true
  };
  const startedAt = new Date().toISOString();
  const response = await value.gateway.submitWorldQuery(submission as unknown as JsonObject, gatewayContext)
    .catch(gatewayFailure);
  const accepted = response.status === 202 ? object(response.value, "WORLD_QUERY_ACCEPTANCE_INVALID") : undefined;
  if (accepted) await persistAcceptedWorldQueryJob(context, value.pool, submission, accepted);
  let terminal: JsonObject | undefined;
  try {
    terminal = accepted
      ? await value.gateway.pollJob(text(accepted["jobId"], "WORLD_QUERY_JOB_ID_MISSING"), gatewayContext)
      : undefined;
  } catch (error) {
    if (accepted) {
      try {
        const cancelRequestId = `wsgs-cancel-${createHash("sha256")
          .update(`${submission.plan.queryId}:${randomUUID()}`)
          .digest("hex").slice(0, 32)}`;
        const cancelDelegation = await value.signer.sign({
          kind: "WORLD_QUERY", identity: caller, requestId: cancelRequestId,
          plan: submission.plan, dataScopes: [caller.dataScope], datasetScopes: caller.datasetScopes
        });
        await value.gateway.cancelWorldQuery(submission.plan.queryId, {
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
  const finishedAt = new Date().toISOString();
  const outcome: PersistedWorldQueryOutcome = {
    submission,
    status,
    resultHash,
    delegatedIdentityHash: signed.jtiHash,
    startedAt,
    finishedAt,
    encryptedCheckpointEvidenceMaterial: {
      checkpointProtection: "AES_256_GCM_INTERNAL_ONLY",
      responseStatus: response.status,
      response: response.value,
      ...(terminal ? { terminal } : {})
    }
  };
  await withFence(context, value.pool, async (client) => {
    const updated = await client.query(
      `UPDATE wsgs.world_query
          SET gateway_query_id = $2, gateway_job_id = $3,
              upstream_job_id = COALESCE($3, upstream_job_id),
              query_snapshot_manifest = $4::jsonb,
              snapshot_adherence = $5::jsonb,
              upstream_status = $6, upstream_result_hash = $7
        WHERE query_id = $1 AND grounding_id = $8 AND data_scope = $9`,
      [submission.plan.queryId, world["queryId"] ?? submission.plan.queryId,
        accepted?.["jobId"] ?? null, JSON.stringify(world["snapshotManifest"] ?? null),
        JSON.stringify(world["snapshotAdherence"] ?? null), status, resultHash,
        context.groundingId, caller.dataScope]
    );
    if (updated.rowCount !== 1) throw new PipelineFenceRejectedError();
  });
  return outcome;
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
      const errorEnvelope = source["error"] && typeof source["error"] === "object" && !Array.isArray(source["error"])
        ? source["error"] as JsonObject : undefined;
      const nestedError = errorEnvelope?.["error"] && typeof errorEnvelope["error"] === "object" && !Array.isArray(errorEnvelope["error"])
        ? errorEnvelope["error"] as JsonObject : undefined;
      const nodeError = nestedError?.["code"] ?? errorEnvelope?.["code"];
      const safeError = typeof nodeError === "string"
        ? nodeError.toUpperCase().replace(/[^A-Z0-9]+/gu, "_").slice(0, 96)
        : "NO_ERROR_CODE";
      const nodeStage = nestedError?.["stage"] ?? errorEnvelope?.["stage"];
      const safeStage = typeof nodeStage === "string"
        ? nodeStage.toUpperCase().replace(/[^A-Z0-9]+/gu, "_").slice(0, 64)
        : "NO_STAGE";
      const errorDetails = nestedError?.["details"] && typeof nestedError["details"] === "object" && !Array.isArray(nestedError["details"])
        ? nestedError["details"] as JsonObject : undefined;
      const firstIssue = Array.isArray(errorDetails?.["issues"]) && errorDetails["issues"][0] &&
        typeof errorDetails["issues"][0] === "object" && !Array.isArray(errorDetails["issues"][0])
        ? errorDetails["issues"][0] as JsonObject : undefined;
      const issueKeyword = typeof firstIssue?.["keyword"] === "string"
        ? firstIssue["keyword"].toUpperCase().replace(/[^A-Z0-9]+/gu, "_").slice(0, 48) : "NO_KEYWORD";
      const issuePath = typeof firstIssue?.["path"] === "string"
        ? firstIssue["path"].toUpperCase().replace(/[^A-Z0-9]+/gu, "_").slice(0, 96) : "NO_PATH";
      const hashState = typeof errorDetails?.["schemaHash"] === "string" && typeof errorDetails["canonicalHash"] === "string"
        ? errorDetails["schemaHash"] === errorDetails["canonicalHash"] ? "HASH_MATCH" : "HASH_DRIFT"
        : "NO_HASH_COMPARISON";
      const diagnosticCode = [
        "WQ_NODE", safeOperation.slice(0, 28), safeStatus, safeError.slice(0, 32), safeStage.slice(0, 24),
        hashState, issueKeyword.slice(0, 20), issuePath.slice(0, 32)
      ].join("_").slice(0, 128);
      throw new ProductionStageModuleError(diagnosticCode);
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

function worldQueryFailureCode(world: JsonObject, submission: WorldQuerySubmission): string {
  const planned = new Map(submission.plan.nodes.map((node) => [node.nodeId, node.operation.operationId]));
  const failed = (Array.isArray(world["nodes"]) ? world["nodes"] : [])
    .map((entry) => object(entry, "WORLD_QUERY_NODE_INVALID"))
    .find((node) => node["status"] === "FAILED");
  if (!failed) return "WORLD_QUERY_FAILED_NO_FAILED_NODE";
  const nodeId = text(failed["nodeId"], "WORLD_QUERY_NODE_ID_MISSING");
  const operation = (planned.get(nodeId) ?? "unknown").toUpperCase().replace(/[^A-Z0-9]+/gu, "_").slice(0, 32);
  const envelope = failed["error"] && typeof failed["error"] === "object" && !Array.isArray(failed["error"])
    ? failed["error"] as JsonObject
    : undefined;
  const nested = envelope?.["error"] && typeof envelope["error"] === "object" && !Array.isArray(envelope["error"])
    ? envelope["error"] as JsonObject
    : undefined;
  const rawCode = nested?.["code"] ?? envelope?.["code"];
  const rawStage = nested?.["stage"] ?? envelope?.["stage"];
  const code = typeof rawCode === "string"
    ? rawCode.toUpperCase().replace(/[^A-Z0-9]+/gu, "_").slice(0, 48)
    : "NO_ERROR_CODE";
  const stage = typeof rawStage === "string"
    ? rawStage.toUpperCase().replace(/[^A-Z0-9]+/gu, "_").slice(0, 32)
    : "NO_STAGE";
  const details = nested?.["details"] && typeof nested["details"] === "object" && !Array.isArray(nested["details"])
    ? nested["details"] as JsonObject
    : envelope?.["details"] && typeof envelope["details"] === "object" && !Array.isArray(envelope["details"])
      ? envelope["details"] as JsonObject
      : undefined;
  const issue = Array.isArray(details?.["issues"]) && details["issues"][0] &&
    typeof details["issues"][0] === "object" && !Array.isArray(details["issues"][0])
    ? details["issues"][0] as JsonObject
    : undefined;
  const keyword = typeof issue?.["keyword"] === "string"
    ? issue["keyword"].toUpperCase().replace(/[^A-Z0-9]+/gu, "_").slice(0, 24)
    : "NO_KEYWORD";
  const path = typeof issue?.["path"] === "string"
    ? issue["path"].toUpperCase().replace(/[^A-Z0-9]+/gu, "_").slice(0, 48)
    : "NO_PATH";
  const hashState = typeof details?.["schemaHash"] === "string" && typeof details["canonicalHash"] === "string"
    ? details["schemaHash"] === details["canonicalHash"] ? "HASH_MATCH" : "HASH_DRIFT"
    : "NO_HASH_COMPARISON";
  return `WQ_NODE_${operation}_${code}_${stage}_${hashState}_${keyword}_${path}`.slice(0, 180);
}

function nestedProtocolErrorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const envelope = value as JsonObject;
  if (typeof envelope["code"] === "string") return envelope["code"];
  const nested = envelope["error"];
  return nested && typeof nested === "object" && !Array.isArray(nested) &&
    typeof (nested as JsonObject)["code"] === "string"
    ? (nested as JsonObject)["code"] as string
    : undefined;
}

/** Recognizes both GDPS INDETERMINATE envelopes and Gateway PlatformError wrappers. */
export function isGdpsSourceChangedDuringQuery(
  submission: WorldQuerySubmission,
  worldValue: unknown,
  sourceOperation: string
): boolean {
  const planned = submission.plan.nodes.filter((entry) =>
    entry.operation.operationId === sourceOperation && entry.operation.operationVersion === "1.0"
  );
  if (planned.length !== 1) throw new ProductionStageModuleError("GDPS_BEST_EFFORT_SOURCE_NODE_AMBIGUOUS");
  const world = object(worldValue, "WORLD_QUERY_RESULT_INVALID");
  const nodes = (Array.isArray(world["nodes"]) ? world["nodes"] : [])
    .map((entry) => object(entry, "WORLD_QUERY_NODE_INVALID"));
  const sourceNodes = nodes.filter((entry) => entry["nodeId"] === planned[0]!.nodeId);
  if (sourceNodes.length !== 1) throw new ProductionStageModuleError("GDPS_BEST_EFFORT_SOURCE_RESULT_NODE_MISSING");
  const node = sourceNodes[0]!;
  const returnedOperation = object(node["operation"], "WORLD_QUERY_NODE_OPERATION_MISSING");
  if (returnedOperation["operationId"] !== sourceOperation || returnedOperation["operationVersion"] !== "1.0") {
    throw new ProductionStageModuleError("GDPS_BEST_EFFORT_SOURCE_RESULT_OPERATION_MISMATCH");
  }
  const directErrorCode = nestedProtocolErrorCode(node["error"]);
  let resultCode: string | undefined;
  if (node["result"] && typeof node["result"] === "object" && !Array.isArray(node["result"])) {
    const result = node["result"] as JsonObject;
    resultCode = nestedProtocolErrorCode(result["error"]);
    const output = result["output"];
    if (!resultCode && output && typeof output === "object" && !Array.isArray(output)) {
      const outputValue = (output as JsonObject)["value"];
      if (outputValue && typeof outputValue === "object" && !Array.isArray(outputValue) &&
          typeof (outputValue as JsonObject)["code"] === "string") {
        resultCode = (outputValue as JsonObject)["code"] as string;
      }
    }
  }
  return directErrorCode === "SOURCE_CHANGED_DURING_QUERY" || resultCode === "SOURCE_CHANGED_DURING_QUERY";
}

export function gdpsSourceChangedAttemptRecord(
  context: PipelineStageContext,
  outcome: PersistedWorldQueryOutcome,
  replay: GdpsPriorCurrentnessReplay,
  attempt: number,
  currentSourceExecution: JsonObject
): GowmExecutionRecord {
  const world = finalWorldResult(outcome);
  if (!isGdpsSourceChangedDuringQuery(outcome.submission, world, replay.sourceOperation)) {
    throw new ProductionStageModuleError("GDPS_BEST_EFFORT_ATTEMPT_REASON_MISMATCH");
  }
  const gatewayQueryId = text(world["queryId"], "WORLD_QUERY_ID_MISSING");
  if (gatewayQueryId !== outcome.submission.plan.queryId || !sha256Pattern.test(outcome.resultHash)) {
    throw new ProductionStageModuleError("GDPS_BEST_EFFORT_ATTEMPT_IDENTITY_MISMATCH");
  }
  const gatewayJobId = typeof world["jobId"] === "string" && world["jobId"] ? world["jobId"] : undefined;
  return {
    executionId: `execution-${canonicalSha256({
      groundingId: context.groundingId,
      queryId: gatewayQueryId,
      reasonCode: "SOURCE_CHANGED_DURING_QUERY"
    }).slice("sha256:".length, "sha256:".length + 32)}`,
    groundingId: context.groundingId,
    executionKind: "WORLD_QUERY",
    operationId: replay.sourceOperation,
    operationVersion: replay.sourceOperationVersion,
    gatewayQueryId,
    ...(gatewayJobId ? { gatewayJobId } : {}),
    requestHash: canonicalSha256(outcome.submission) as Sha256Digest,
    resultHash: outcome.resultHash as Sha256Digest,
    normalizedStatus: "INDETERMINATE",
    upstreamStatus: outcome.status,
    dataSnapshot: {
      gdpsBestEffortCurrentSource: {
        ...structuredClone(currentSourceExecution),
        attempt,
        attemptQueryId: gatewayQueryId,
        reasonCode: "SOURCE_CHANGED",
        upstreamCondition: "SOURCE_CHANGED_DURING_QUERY"
      }
    },
    receiptIds: [],
    evidenceIds: [],
    startedAt: outcome.startedAt,
    finishedAt: outcome.finishedAt
  };
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
    upstreamStatus: item.normalizedStatus,
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
      const prior = await loadPriorCurrentnessContexts(value.pool, identity(context), priorGroundings);
      const replayMode = parts.policy["allowApproximation"] === true ? "BEST_EFFORT" as const : "STRICT" as const;
      const gdpsCurrentnessReplays = prior.gdpsCurrentnessReplays.map((entry) => ({ ...entry, replayMode }));
      if (prior.gdpsCurrentnessReplays.length > 0 && !authority.gdpsCurrentnessAuthorization) {
        throw new ProductionStageModuleError("GDPS_CURRENTNESS_AUTHORITY_UNAVAILABLE");
      }
      // W11 requires replay of the exact historical snapshot. The current
      // frozen 0.6.3 locks expose CONSISTENT_AT_START only, so accepting a
      // generic prior result here would silently weaken its authority boundary.
      // A recognized GDPS current-product replay is different: its immutable
      // source identity stays hash-pinned and its only executable operation is
      // the independently locked currentness check.
      if (prior.hasOtherPriorProducts) {
        assertPriorGroundingReplaySupport(allGatewayLocks(authority.southboundLock), priorGroundings.length);
      }
      const snapshot = authority.trustedCapabilitySnapshot;
      const snapshotId = `capability-snapshot-${canonicalSha256({
        groundingId: context.groundingId,
        snapshotHash: snapshot.snapshotHash
      }).slice("sha256:".length, "sha256:".length + 32)}`;
      const gdpsSnapshot = authority.gdpsConsumerSnapshot;
      await withFence(context, value.pool, async (client) => {
        await client.query(
          `INSERT INTO wsgs.capability_snapshot(
             snapshot_id, grounding_id, data_scope, catalog_hash, catalog,
             contract_catalog_revision, semantic_catalog_hash, binding_revision,
             availability_snapshot, availability_hash, operation_lock_hash,
             consumer_package_integrity, snapshot_hash,
             gdps_consumer_snapshot, gdps_provider_version, gdps_consumer_lock_hash,
             gdps_capability_lock_hash, gdps_descriptor_lock_hash, gdps_recipe_lock_hash,
             gdps_capability_keys, gdps_capability_snapshot_hash
           ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,
             $14::jsonb,$15,$16,$17,$18,$19,$20::jsonb,$21)
           ON CONFLICT (snapshot_id) DO NOTHING`,
          [snapshotId, context.groundingId, identity(context).dataScope,
            capabilityCatalogHash(authority.capabilityCatalog), JSON.stringify(authority.capabilityCatalog),
            snapshot.contractCatalogRevision, snapshot.semanticCatalogHash,
            snapshot.bindingRevision, JSON.stringify(authority.availability),
            canonicalSha256(authority.availability), snapshot.southboundLockHash,
            snapshot.consumerPackageIntegrity, snapshot.snapshotHash,
            gdpsSnapshot ? JSON.stringify(gdpsSnapshot) : null,
            gdpsSnapshot?.providerVersion ?? null,
            gdpsSnapshot?.consumerLockHash ?? null,
            gdpsSnapshot?.capabilityLockHash ?? null,
            gdpsSnapshot?.descriptorLockHash ?? null,
            gdpsSnapshot?.recipeLockHash ?? null,
            gdpsSnapshot ? JSON.stringify(gdpsSnapshot.capabilityKeys) : null,
            gdpsSnapshot?.capabilitySnapshotHash ?? null]
        );
      });
      return {
        startedAt: new Date().toISOString(),
        capabilitySnapshotId: snapshotId,
        knownWorldReferences: parts.capsule["knownWorldReferences"],
        priorGroundings,
        gdpsCurrentnessReplays,
        gdpsPersistedSourceQueries: prior.gdpsPersistedSourceQueries,
        hasOtherPriorProducts: prior.hasOtherPriorProducts,
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
      try {
        const built = buildGroundingGraphWithDegradation(
          text(parts.source["originalText"], "SOURCE_TEXT_MISSING"),
          deterministic,
          model.status === "AVAILABLE" ? { status: "AVAILABLE", frame: model.frame } : { status: "UNAVAILABLE", failureCode: model.failureCode }
        );
        return augmentGroundingGraphWithCurrentness(built, currentnessReplays(context));
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const code = /^GROUNDING_GRAPH_[A-Z0-9_]+(?::.*)?$/u.test(message)
          ? message.split(":", 1)[0]!
          : "GROUNDING_GRAPH_BUILD_FAILED";
        throw new ProductionStageModuleError(code, false, code, "GROUNDING_GRAPH_BUILD");
      }
    },

    REFERENCE_RESOLVE: async (context) => {
      const authority = persistedAuthority(context, value.gateway);
      const graph = stageValue<DegradedGroundingGraphResult>(context, "GROUNDING_GRAPH_BUILD");
      if (currentnessReplays(context).length > 0) return normalizeReferenceResolution(null, []);
      const deterministic = stageValue<DeterministicParseResult>(context, "DETERMINISTIC_PARSE");
      // A KnownWorldReference is already an immutable caller-supplied key. It
      // must be validated, but resolving its original ambiguous alias again
      // would discard the user's PendingChoice selection.
      const referenceMentions = referenceMentionsRequiringResolution(graph.mergedMentions, deterministic);
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
      if (currentnessReplays(context).length > 0) return normalizeReferenceResolution(null, []);
      const parts = requestParts(context);
      const known = Array.isArray(parts.capsule["knownWorldReferences"])
        ? parts.capsule["knownWorldReferences"].map((entry) => object(entry, "INVALID_KNOWN_REFERENCE")) : [];
      const result = mergeKnownReferenceProducts(resolved, known);
      const references = result.referenceProducts.map((entry) => ({
        referenceKey: entry.referenceKey, requireCurrentSnapshot: true
      }));
      if (references.length === 0) return result;
      const lock = operationLock(authority, "reference.validate");
      const envelope = await executeOperation(value, context, lock, { schemaVersion: "1.0", references }, "reference-validate");
      const validations = normalizeValidation(envelopeValue(envelope, lock));
      const evaluatedAt = new Date().toISOString();
      const validityTtlMs = environmentInteger("WSGS_REFERENCE_VALIDATION_TTL_MS", 60_000, 1_000, 300_000);
      const byKey = new Map(validations.map((entry) => [JSON.stringify(entry.referenceKey), entry]));
      const validated = {
        ...result,
        validationResults: validations,
        referenceProducts: result.referenceProducts.map((product) => {
          const validation = byKey.get(JSON.stringify(product.referenceKey));
          if (!validation) throw new ProductionStageModuleError("REFERENCE_VALIDATION_MISSING");
          return applyReferenceValidation(product, validation, evaluatedAt, validityTtlMs);
        })
      };
      return validated;
    },

    REQUIREMENT_PLAN: async (context) => {
      const parts = requestParts(context);
      const graph = stageValue<DegradedGroundingGraphResult>(context, "GROUNDING_GRAPH_BUILD");
      const model = stageValue<PersistedSemanticModelResult>(context, "SEMANTIC_FRAME_VALIDATE");
      const replays = currentnessReplays(context);
      const planningGraph = replays.length > 0 ? validateGroundingGraph({
        schemaVersion: "1.0",
        nodes: graph.graph.nodes.filter((node) => node.kind === "WORLD_QUERY" &&
          node.payload && typeof node.payload === "object" && "gdpsCurrentProduct" in node.payload),
        edges: []
      }) : graph.graph;
      const projected = replays.length === 0 && value.gdpsDescriptor ? projectGeospatialProductIntent({
        frame: model.frame,
        originalText: text(parts.source["originalText"], "SOURCE_TEXT_MISSING"),
        conceptMap: value.gdpsDescriptor.conceptMap
      }) : null;
      const descriptorResolution = projected ? value.gdpsDescriptor!.consumer.resolve(projected) : undefined;
      const planned = planner.plan({
        groundingGraph: planningGraph,
        ...(descriptorResolution?.status === "MATCHED" && descriptorResolution.intent
          ? { groundedProductIntents: [descriptorResolution.intent] }
          : {}),
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
      if (replays.length > 0) {
        if (planned.status !== "PLANNED" || planned.capabilityGaps.length > 0 ||
            JSON.stringify(planned.selectedRecipeIds) !== JSON.stringify(["PRIOR_RESULT_REVALIDATION"])) {
          throw new ProductionStageModuleError("GDPS_CURRENTNESS_REPLAY_PLAN_INVALID");
        }
        return planned;
      }
      if (descriptorResolution?.status === "MATCHED" && descriptorResolution.intent) {
        const selectedGdpsPatterns = planned.selectedRecipeIds.filter((recipeId) =>
          queryTemplateRules.some((rule) => rule.pattern === recipeId && rule.previewAuthorizationRequired));
        const recipeGaps = selectedGdpsPatterns.flatMap((semanticPattern): PlannerCapabilityGap[] => {
          const lookup = value.gdpsDescriptor!.consumer.lookupRecipe(descriptorResolution.intent!, semanticPattern);
          if (lookup.status === "MATCHED") return [];
          return [{
            gapId: `gdps-recipe-${canonicalSha256(lookup).slice(7, 31)}`,
            semanticCapability: semanticPattern,
            reason: lookup.status,
            requiredForProduct: (parts.requestedProducts[0] ?? "WORLD_STATE") as PlannerCapabilityGap["requiredForProduct"],
            blocking: true,
            details: {
              code: lookup.status,
              descriptorId: lookup.evidence.descriptorId,
              descriptorHash: lookup.evidence.descriptorHash,
              queryProfile: lookup.evidence.queryProfile,
              lookupHash: lookup.evidence.lookupHash,
              candidateRecipeIds: lookup.candidateRecipeIds
            }
          }];
        });
        if (recipeGaps.length === 0) return planned;
        return {
          ...planned,
          status: "CAPABILITY_GAP" as const,
          capabilityGaps: [...planned.capabilityGaps, ...recipeGaps]
            .sort((left, right) => left.gapId.localeCompare(right.gapId))
        };
      }
      if (!descriptorResolution) return planned;
      const descriptorReason = descriptorResolution.status === "MATCHED"
        ? "DESCRIPTOR_LOCK_DRIFT" as const
        : descriptorResolution.status;
      const descriptorGap: PlannerCapabilityGap = {
        gapId: `gdps-descriptor-${canonicalSha256(descriptorResolution).slice(7, 31)}`,
        semanticCapability: `GDPS_DESCRIPTOR:${descriptorResolution.evidence.conceptCode}`,
        reason: descriptorReason,
        requiredForProduct: (parts.requestedProducts[0] ?? "WORLD_STATE") as PlannerCapabilityGap["requiredForProduct"],
        blocking: true,
        details: {
          code: descriptorReason === "DESCRIPTOR_NOT_FOUND" ? "DESCRIPTOR_GAP" : descriptorReason,
          registryHash: descriptorResolution.evidence.registryHash,
          descriptorHash: descriptorResolution.evidence.descriptorHash ?? null,
          querySemantics: descriptorResolution.evidence.querySemantics,
          queryProfile: descriptorResolution.evidence.queryProfile ?? null,
          checks: descriptorResolution.evidence.checks,
          candidateDescriptorIds: descriptorResolution.candidateDescriptorIds ?? []
        }
      };
      return {
        ...planned,
        status: "CAPABILITY_GAP" as const,
        capabilityGaps: [...planned.capabilityGaps, descriptorGap]
          .sort((left, right) => left.gapId.localeCompare(right.gapId))
      };
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
        const gdpsRecipe = value.gdpsRecipes.find((entry) => entry.semanticPattern === recipeId);
        const isGdpsCurrentness = recipeId === "PRIOR_RESULT_REVALIDATION";
        const recipeInput = buildRecipeOperationInput({
          recipeId,
          planning,
          groundingGraph,
          references,
          ...(typeof parts.source["locale"] === "string" ? { locale: parts.source["locale"] } : {}),
          maximumCandidates: integer(parts.policy["maxCandidatesPerMention"], "MAX_CANDIDATES_INVALID")
          , originalText: text(parts.source["originalText"], "SOURCE_TEXT_MISSING")
        });
        if (recipeInput.status === "CAPABILITY_GAP") {
          const result: CompileResult = recipeInput;
          compiled.push(result);
          gaps.push(result.gap as unknown as JsonObject);
          continue;
        }
        const descriptorId = typeof recipeInput.parameterValues?.["descriptorId"] === "string"
          ? recipeInput.parameterValues["descriptorId"]
          : gdpsRecipe?.descriptorConstraint?.descriptorId;
        const descriptorHash = typeof recipeInput.parameterValues?.["descriptorHash"] === "string"
          ? recipeInput.parameterValues["descriptorHash"]
          : gdpsRecipe?.descriptorConstraint?.descriptorHash;
        const currentnessAuthorization = isGdpsCurrentness ? authority.gdpsCurrentnessAuthorization : undefined;
        const parameterValues = currentnessAuthorization ? {
          ...recipeInput.parameterValues,
          currentnessRecipeId: currentnessAuthorization.recipeId,
          currentnessProviderRecipeLockHash: currentnessAuthorization.providerRecipeLockHash,
          currentnessOperationLockHash: currentnessAuthorization.operationLockHash
        } : gdpsRecipe && descriptorId && descriptorHash ? {
          ...recipeInput.parameterValues,
          descriptorId,
          descriptorHash
        } : recipeInput.parameterValues;
        const result = compiler.compile({
          requestId: text(request(context)["requestId"], "REQUEST_ID_MISSING"),
          idempotencyKey: `${idempotencyKey(context)}:${recipeId}`,
          pattern: recipeId as QuerySemanticPattern,
          requiredForProduct: recipeInput.requiredForProduct,
          operationInput: recipeInput.operationInput,
          parameterValues,
          capabilities: authority.capabilityCatalog.capabilities,
          semanticProfiles: authority.semanticCatalog.profiles,
          operationLocks: allGatewayLocks(authority.southboundLock),
          availability: authority.availability.operations,
          maturityPolicy: { allowPreview: value.allowPreview },
          ...(gdpsRecipe && value.gdpsRecipeLock && descriptorId && descriptorHash ? {
            trustedGdpsRecipeLockHash: value.gdpsRecipeLock.lockHash,
            gdpsRecipeAuthorization: {
              recipeId: gdpsRecipe.recipeId,
              semanticPattern: gdpsRecipe.semanticPattern as QuerySemanticPattern,
              recipeLockHash: value.gdpsRecipeLock.lockHash,
              descriptorId,
              descriptorHash: descriptorHash as `sha256:${string}`,
              previewAuthorizationRequired: true as const,
              allowedOperations: gdpsRecipe.allowedOperations
            }
          } : {}),
          ...(currentnessAuthorization ? {
            gdpsCurrentnessAuthorization: currentnessAuthorization,
            trustedGdpsProviderRecipeLockHash: currentnessAuthorization.providerRecipeLockHash,
            trustedGdpsOperationLockHash: authority.trustedCapabilitySnapshot.southboundLockHash
          } : {}),
          parameterSchemaHash: value.parameterSchemaHash,
          observedAt: authority.availability.checkedAt,
          snapshotPolicy: isGdpsCurrentness
            ? { mode: "LATEST_AT_START", allowDowngrade: false }
            : PRODUCTION_WORLD_QUERY_SNAPSHOT_POLICY,
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
      const authority = persistedAuthority(context, value.gateway);
      const parts = requestParts(context);
      const planning = stageValue<RequirementPlanningResult>(context, "REQUIREMENT_PLAN");
      const outcomes: PersistedWorldQueryOutcome[] = [];
      const sourceChangeAttempts: PersistedWorldQueryOutcome[] = [];
      let currentSourceExecution: GdpsSequentialCurrentSourceResult<PersistedWorldQueryOutcome> | undefined;
      let currentSourceExecutionSummary: JsonObject | undefined;
      for (const item of compilation.compiled) {
        if (item.status !== "COMPILED") continue;
        const outcome = await executeWorldQuerySubmission(value, context, item.submission);
        const currentnessPlan = item.submission.plan.nodes.length === 1 &&
          item.submission.plan.nodes[0]?.operation.operationId === "geo-product.check-current";
        if (!currentnessPlan) {
          const world = finalWorldResult(outcome);
          if (outcome.status === "FAILED") {
            throw new ProductionStageModuleError(worldQueryFailureCode(world, item.submission));
          }
          outcomes.push(outcome);
          continue;
        }
        const replay = currentnessReplays(context)[0];
        const authorization = authority.gdpsCurrentnessAuthorization;
        if (!replay || !authorization) throw new ProductionStageModuleError("GDPS_CURRENTNESS_AUTHORITY_UNAVAILABLE");
        const checkWorld = finalWorldResult(outcome);
        if (outcome.status === "FAILED") {
          throw new ProductionStageModuleError(worldQueryFailureCode(checkWorld, item.submission));
        }
        const currentness = normalizeGdpsCurrentnessWorldQuery({
          submission: item.submission,
          worldValue: checkWorld,
          replay,
          operation: operationLock(authority, "geo-product.check-current"),
          authorization
        });
        outcomes.push(outcome);
        const persistedSources = persistedCurrentnessSourceQueries(context).filter((entry) =>
          entry.sourceGroundingId === replay.sourceGroundingId &&
          entry.sourceGatewayQueryId === replay.sourceGatewayQueryId
        );
        if (persistedSources.length !== 1 || !value.gdpsRecipeLock) {
          throw new ProductionStageModuleError("GDPS_BEST_EFFORT_SOURCE_AUTHORITY_UNAVAILABLE");
        }
        const changedAttemptIds = new Set<string>();
        currentSourceExecution = await executeGdpsSequentialCurrentSource({
          replayMode: replay.replayMode,
          currentness: currentness.currentness,
          executeAttempt: async (attempt) => {
            const compiledSource = compileGdpsBestEffortCurrentSource({
              replay,
              persistedSource: persistedSources[0]!,
              attempt,
              requestId: text(request(context)["requestId"], "REQUEST_ID_MISSING"),
              idempotencyKey: idempotencyKey(context),
              requiredForProduct: planning.graph?.requirements.find((entry) => entry.required)?.requiredForProduct ??
                parts.requestedProducts[0] ?? "WORLD_EVIDENCE",
              parameterSchemaHash: value.parameterSchemaHash,
              capabilities: authority.capabilityCatalog.capabilities,
              semanticProfiles: authority.semanticCatalog.profiles,
              operationLocks: allGatewayLocks(authority.southboundLock),
              operationLockHash: authority.trustedCapabilitySnapshot.southboundLockHash,
              availability: authority.availability.operations,
              allowPreview: value.allowPreview,
              observedAt: authority.availability.checkedAt,
              budgets: {
                maximumNodes: integer(parts.policy["maxQueryOperations"], "MAX_QUERY_OPERATIONS_INVALID"),
                maximumDepth: integer(parts.policy["maxQueryOperations"], "MAX_QUERY_OPERATIONS_INVALID"),
                maximumRows: Math.max(1, integer(parts.policy["maxCandidatesPerMention"], "MAX_CANDIDATES_INVALID") * 32),
                maximumCandidates: Math.max(1, integer(parts.policy["maxCandidatesPerMention"], "MAX_CANDIDATES_INVALID") * 32),
                maximumOutputBytes: integer(parts.policy["maxResultBytes"], "MAX_RESULT_BYTES_INVALID"),
                maximumExecutionMs: integer(parts.policy["deadlineMs"], "DEADLINE_INVALID")
              },
              recipeLock: value.gdpsRecipeLock!
            });
            await persistCompiledWorldQuery(context, value.pool, compiledSource);
            const sourceOutcome = await executeWorldQuerySubmission(value, context, compiledSource.submission);
            const sourceWorld = finalWorldResult(sourceOutcome);
            let sourceChangedDuringQuery = isGdpsSourceChangedDuringQuery(
              compiledSource.submission,
              sourceWorld,
              replay.sourceOperation
            );
            if (!sourceChangedDuringQuery && sourceOutcome.status === "FAILED") {
              throw new ProductionStageModuleError(worldQueryFailureCode(sourceWorld, compiledSource.submission));
            }
            if (!sourceChangedDuringQuery) {
              const sources = normalizeGdpsWorldQuerySources(
                compiledSource.submission,
                sourceWorld,
                value.gdpsRecipeLock
              ).filter((entry) => entry.evidence.operationId === replay.sourceOperation);
              if (sources.length !== 1 || sources[0]!.evidence.productId !== replay.productId) {
                throw new ProductionStageModuleError("GDPS_BEST_EFFORT_CURRENT_SOURCE_IDENTITY_MISMATCH");
              }
              if (currentness.currentContentHash && sources[0]!.evidence.contentHash !== currentness.currentContentHash) {
                throw new ProductionStageModuleError("GDPS_BEST_EFFORT_CURRENT_SOURCE_HASH_MISMATCH");
              }
            }
            if (sourceChangedDuringQuery) changedAttemptIds.add(compiledSource.submission.plan.queryId);
            return { value: sourceOutcome, sourceChangedDuringQuery };
          }
        });
        for (const attempted of currentSourceExecution.attempts) {
          if (changedAttemptIds.has(attempted.submission.plan.queryId)) sourceChangeAttempts.push(attempted);
          else outcomes.push(attempted);
        }
        currentSourceExecutionSummary = {
          schemaVersion: "wsgs-gdps-best-effort-current-source/1.0",
          replayMode: replay.replayMode,
          currentness: currentness.currentness,
          status: currentSourceExecution.status,
          productId: replay.productId,
          priorContentHash: replay.contentHash,
          ...(currentness.currentContentHash ? { currentContentHash: currentness.currentContentHash } : {}),
          sourceAdvanced: currentness.decision.warnings.some((warning) => warning === "SOURCE_ADVANCED"),
          sourceQueryExecuted: currentSourceExecution.attempts.length > 0,
          historicalPayloadRead: false,
          attemptQueryIds: currentSourceExecution.attempts.map((entry) => entry.submission.plan.queryId),
          ...(currentSourceExecution.status === "INDETERMINATE"
            ? {
              reasonCode: "SOURCE_CHANGED",
              upstreamCondition: "SOURCE_CHANGED_DURING_QUERY"
            }
            : {})
        };
      }
      return {
        outcomes,
        sourceChangeAttempts,
        ...(currentSourceExecutionSummary ? { currentSourceExecution: currentSourceExecutionSummary } : {})
      };
    },

    EVIDENCE_NORMALIZE: async (context) => {
      const authority = persistedAuthority(context, value.gateway);
      const execution = stageValue<{
        outcomes: PersistedWorldQueryOutcome[];
        sourceChangeAttempts: PersistedWorldQueryOutcome[];
        currentSourceExecution?: JsonObject;
      }>(context, "GOWM_EXECUTE");
      const evidenceItems: GroundingEvidenceItem[] = [];
      const warnings: string[] = [];
      const evidenceProductsForPersistence: ExecutionEvidenceProduct[] = [];
      const gdpsExecutionRecordsForPersistence: GowmExecutionRecord[] = [];
      const normalizationGaps: JsonObject[] = [];
      const requested = requestParts(context).requestedProducts.filter(
        (entry): entry is EvidenceRequestedProduct => evidenceProducts.has(entry as OperationalRequestedProduct)
      );
      const normalizationProducts: EvidenceRequestedProduct[] = requested.length > 0 ? requested : ["WORLD_EVIDENCE"];
      const semantic = context.state["SEMANTIC_MODEL_PARSE"] as PersistedSemanticModelResult | undefined;
      const replay = currentnessReplays(context)[0];
      const sourceChangeRecords = execution.sourceChangeAttempts.map((outcome, index) => {
        if (!replay || !execution.currentSourceExecution) {
          throw new ProductionStageModuleError("GDPS_BEST_EFFORT_ATTEMPT_AUTHORITY_MISSING");
        }
        return gdpsSourceChangedAttemptRecord(
          context,
          outcome,
          replay,
          index + 1,
          execution.currentSourceExecution
        );
      });
      if (sourceChangeRecords.length > 0) {
        warnings.push("SOURCE_CHANGED", "CURRENT_SOURCE_QUERY_RETRIED");
      }
      if (execution.currentSourceExecution?.["status"] === "INDETERMINATE") {
        normalizationGaps.push({
          gapId: `gap-${canonicalSha256({
            groundingId: context.groundingId,
            code: "SOURCE_CHANGED",
            priorContentHash: execution.currentSourceExecution["priorContentHash"],
            currentContentHash: execution.currentSourceExecution["currentContentHash"]
          }).slice("sha256:".length, "sha256:".length + 24)}`,
          semanticCapability: "PRIOR_RESULT_REVALIDATION",
          reason: "UNSUPPORTED_EXPRESSION",
          requiredForProduct: normalizationProducts[0] ?? "WORLD_EVIDENCE",
          blocking: true,
          details: {
            code: "SOURCE_CHANGED",
            upstreamCondition: "SOURCE_CHANGED_DURING_QUERY",
            normalizedStatus: "INDETERMINATE",
            replayMode: "BEST_EFFORT",
            productId: execution.currentSourceExecution["productId"],
            priorContentHash: execution.currentSourceExecution["priorContentHash"],
            currentContentHash: execution.currentSourceExecution["currentContentHash"],
            sourceAdvanced: true,
            currentSourceQueryAttempts: 2,
            historicalPayloadRead: false,
            historicalQueryReplayed: false
          }
        });
        warnings.push("SOURCE_CHANGED", "INDETERMINATE", "SOURCE_ADVANCED");
      }
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
        let evidence = evidenceNormalizer.normalizeWorldQuery({
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
        const currentnessPlan = outcome.submission.plan.nodes.length === 1 &&
          outcome.submission.plan.nodes[0]?.operation.operationId === "geo-product.check-current";
        if (currentnessPlan) {
          const replay = currentnessReplays(context)[0];
          const authorization = authority.gdpsCurrentnessAuthorization;
          if (!replay || !authorization) throw new ProductionStageModuleError("GDPS_CURRENTNESS_AUTHORITY_UNAVAILABLE");
          const currentness = normalizeGdpsCurrentnessWorldQuery({
            submission: outcome.submission,
            worldValue: world,
            replay,
            operation: operationLock(authority, "geo-product.check-current"),
            authorization
          });
          evidence = applyGdpsCurrentnessDecision(evidence, replay, currentness, authorization);
          warnings.push(...currentness.decision.warnings);
          if (currentness.decision.status !== "REPLAY_ALLOWED") {
            const decisionCode = "gapKind" in currentness.decision
              ? currentness.decision.gapKind
              : currentness.decision.status;
            normalizationGaps.push({
              gapId: `gap-${canonicalSha256({
                queryId: outcome.submission.plan.queryId,
                code: decisionCode,
                productId: replay.productId,
                contentHash: replay.contentHash,
                currentContentHash: currentness.currentContentHash ?? null
              }).slice("sha256:".length, "sha256:".length + 24)}`,
              semanticCapability: "PRIOR_RESULT_REVALIDATION",
              reason: decisionCode === "DATA_GAP" ? "OPERATION_UNAVAILABLE" : "UNSUPPORTED_EXPRESSION",
              requiredForProduct: normalizationProducts[0] ?? "WORLD_EVIDENCE",
              blocking: true,
              details: {
                code: decisionCode,
                currentness: currentness.currentness,
                replayMode: replay.replayMode,
                executionBlocked: true,
                productId: replay.productId,
                contentHash: replay.contentHash,
                ...(currentness.currentContentHash ? { currentContentHash: currentness.currentContentHash } : {}),
                descriptorId: replay.descriptorId,
                descriptorHash: replay.descriptorHash,
                sourceRecipeId: replay.sourceRecipeId,
                sourceRecipeLockHash: replay.sourceRecipeLockHash,
                currentnessRecipeId: authorization.recipeId,
                providerRecipeLockHash: authorization.providerRecipeLockHash,
                operationLockHash: authorization.operationLockHash,
                originalQueryExecuted: false,
                historicalPayloadRead: false
              }
            });
          }
        }
        const gdpsSources = normalizeGdpsWorldQuerySources(outcome.submission, world, value.gdpsRecipeLock);
        const gdpsByNode = new Map(gdpsSources.map((entry) => [entry.nodeId, entry.evidence]));
        for (const record of evidence.nodeRecords) {
          const nodeId = record.executionId.split(":node:").at(-1);
          const gdpsSource = nodeId ? gdpsByNode.get(nodeId) : undefined;
          if (!gdpsSource) continue;
          gdpsExecutionRecordsForPersistence.push({
            ...record,
            dataSnapshot: {
              ...(record.dataSnapshot ?? {}),
              gdpsSourceEvidence: structuredClone(gdpsSource),
              ...(execution.currentSourceExecution?.["status"] === "COMPLETED" &&
                execution.currentSourceExecution["sourceAdvanced"] === true
                ? { gdpsBestEffortCurrentSource: structuredClone(execution.currentSourceExecution) }
                : {})
            }
          });
          warnings.push(...gdpsSource.warnings);
          if (gdpsSource.normalizedStatus !== "COMPLETED") {
            warnings.push(`GDPS_${gdpsSource.normalizedStatus}${gdpsSource.gapKind ? `:${gdpsSource.gapKind}` : ""}`);
          }
        }
        evidenceProductsForPersistence.push(evidence);
        evidenceItems.push(...evidence.evidenceItems.map(publicEvidenceItem));
        warnings.push(...evidence.warnings, ...evidence.unknowns);
      }
      await persistExecutionRecords(
        context,
        value.pool,
        evidenceProductsForPersistence.flatMap((entry) => [entry.record, ...entry.nodeRecords.filter((record) =>
          !gdpsExecutionRecordsForPersistence.some((gdpsRecord) => gdpsRecord.executionId === record.executionId))])
          .concat(gdpsExecutionRecordsForPersistence, sourceChangeRecords)
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
