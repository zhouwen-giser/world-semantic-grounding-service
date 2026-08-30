import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, relative, resolve, sep } from "node:path";

import { createGroundingIdentity } from "@wsgs/delegated-identity";
import {
  evaluateGdpsV021Case,
  evaluateGdpsV021Report,
  gdpsV021DriverArtifactIds,
  parseGdpsV021Corpus,
  type GdpsV021Case,
  type GdpsV021CaseObservation,
  type GdpsV021DriverAttestation,
  type GdpsV021EvidenceArtifactKind,
  type GdpsV021EvidenceArtifactRecord,
  type GdpsV021EvidenceBindingContext,
  type GdpsV021EvidenceLedger,
  type GdpsV021EvidenceSubject,
  type GdpsV021NormalizedStatus,
  type GdpsV021ProductEvidence,
  type GdpsV021QualificationEvidence,
  type GdpsV021QualificationId,
  type GdpsV021ReportInput,
  type GdpsV021Sha256Digest,
  type GdpsV021TerminalStatus
} from "@wsgs/gowm-execution-evidence";
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
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  verifyGdpsV021RuntimeAuthorityPreflight,
  verifyGdpsV021RuntimePreflight,
  type VerifiedGdpsV021RuntimeAuthorityPreflight,
  type VerifiedGdpsV021RuntimePreflight
} from "./gdps-v021-runtime-preflight.js";
import { runGdpsV021DriverOrchestrator } from "./gdps-v021-driver-orchestrator.js";
import {
  runGdpsV021W43RuntimeGate,
  type GdpsV021W43BarrierArtifact,
  type GdpsV021W43BarrierArmArtifact,
  type GdpsV021W43BarrierName,
  type GdpsV021W43ExecutionRequest
} from "./gdps-v021-w43-runtime-gate.js";
import {
  GdpsV021DriverExternalContractError,
  type GdpsV021CurrentnessBarrierRequest,
  type GdpsV021DriverOrchestratorInput,
  type GdpsV021DriverRuntimeIdentity,
  type GdpsV021IsolatedRuntimePreparationRequest,
  type GdpsV021NaturalLanguageDriverRequest
} from "../drivers/contracts.js";

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
const focusedGowmR1R5 = process.env["WSGS_GOWM_R1_R5_ONLY"] === "YES";
const focusedSourceTreeHash = process.env["WSGS_EVIDENCE_SOURCE_TREE_SHA256"]?.trim();
if (focusedGowmR1R5 && !/^sha256:[0-9a-f]{64}$/u.test(focusedSourceTreeHash ?? "")) {
  throw new Error("WSGS_EVIDENCE_SOURCE_TREE_SHA256_REQUIRED");
}

function gdpsV021AuthorityPaths(): {
  repositoryRoot: string;
  operationLockPath: string;
  handoffDirectory: string;
  expectedSourceCommit: string;
} {
  return {
    repositoryRoot: process.cwd(),
    operationLockPath: required("GOWM_SOUTHBOUND_LOCK_FILE"),
    handoffDirectory: required("WSGS_GDPS_V021_HANDOFF_DIR"),
    expectedSourceCommit: sourceCommit
  };
}

function loadGdpsV021RuntimeAuthorityPreflight(): VerifiedGdpsV021RuntimeAuthorityPreflight | undefined {
  if (focusedGowmR1R5) return undefined;
  if (!process.env["WSGS_GDPS_E2E_CORPUS_FILE"]?.trim()) return undefined;
  return verifyGdpsV021RuntimeAuthorityPreflight(gdpsV021AuthorityPaths());
}

function loadGdpsV021RuntimePostflight(): VerifiedGdpsV021RuntimePreflight | undefined {
  if (focusedGowmR1R5) return undefined;
  if (!process.env["WSGS_GDPS_E2E_CORPUS_FILE"]?.trim()) return undefined;
  const postflight = verifyGdpsV021RuntimePreflight({
    ...gdpsV021AuthorityPaths(),
    driverManifestPath: required("WSGS_GDPS_DRIVER_MANIFEST_FILE"),
  });
  if (postflight.driverManifest.runtimeIdentityHash !== gdpsRuntimeIdentityHash) {
    throw new Error("GDPS_DRIVER_RUNTIME_IDENTITY_MISMATCH");
  }
  return postflight;
}

const gdpsRuntimeAuthorityPreflight = loadGdpsV021RuntimeAuthorityPreflight();
if (process.env["WSGS_GDPS_PREFLIGHT_ONLY"] === "YES") {
  if (!gdpsRuntimeAuthorityPreflight) throw new Error("GDPS_V021_RUNTIME_AUTHORITY_PREFLIGHT_NOT_CONFIGURED");
  process.stdout.write(`${JSON.stringify({
    marker: "WSGS_GDPS_V021_RUNTIME_AUTHORITY_PREFLIGHT_PASS",
    sourceCommit: gdpsRuntimeAuthorityPreflight.sourceCommit,
    gdpsCommit: gdpsRuntimeAuthorityPreflight.gdpsCommit,
    gowmCommit: gdpsRuntimeAuthorityPreflight.gowmCommit,
    providerId: gdpsRuntimeAuthorityPreflight.provider.providerId,
    providerVersion: gdpsRuntimeAuthorityPreflight.provider.providerVersion,
    capabilityCount: gdpsRuntimeAuthorityPreflight.provider.capabilityCount,
    operationLockHash: gdpsRuntimeAuthorityPreflight.operationLock.hash,
    provenanceHash: gdpsRuntimeAuthorityPreflight.operationLock.provenanceHash,
    handoffBundleHash: gdpsRuntimeAuthorityPreflight.handoff.bundleHash
  })}\n`);
  process.exit(0);
}
const evidenceDirectory = resolve(process.env["WSGS_DEVELOPMENT_EVIDENCE_DIR"] ?? "reports/wsgs-v0.2");
const recipeEvidenceDirectory = resolve(evidenceDirectory, "recipe-evidence");
const gdpsV021EvidenceDirectory = resolve(process.cwd(), "reports", "wsgs-v0.2-gdps-v0.2.1");
if (process.env["WSGS_GDPS_E2E_CORPUS_FILE"]?.trim() && evidenceDirectory !== gdpsV021EvidenceDirectory) {
  throw new Error("GDPS_V021_EVIDENCE_DIRECTORY_NOT_CANONICAL");
}

function isolatePriorCanonicalGdpsEvidence(): string | null {
  if (!process.env["WSGS_GDPS_E2E_CORPUS_FILE"]?.trim() || !existsSync(evidenceDirectory)) return null;
  const isolatedDirectoryName = "invalidated";
  const priorEntries = readdirSync(evidenceDirectory)
    .filter((name) => name !== isolatedDirectoryName);
  if (priorEntries.length === 0) return null;
  const isolatedRoot = resolve(evidenceDirectory, isolatedDirectoryName);
  mkdirSync(isolatedRoot, { recursive: true });
  const isolatedPath = resolve(isolatedRoot, `${gateRunId}-${Date.now().toString(36)}`);
  if (existsSync(isolatedPath)) throw new Error("GDPS_PRIOR_EVIDENCE_ISOLATION_COLLISION");
  mkdirSync(isolatedPath);
  const finalEvidenceNames = new Set([
    "e2e-report.json",
    "e2e-report.core.json",
    "e2e-report.pending.json",
    "development-closure-gate.json",
    "development-closure-gate.pending.json"
  ]);
  priorEntries.sort((left, right) => {
    const leftPriority = finalEvidenceNames.has(left) ? 0 : 1;
    const rightPriority = finalEvidenceNames.has(right) ? 0 : 1;
    return leftPriority - rightPriority || left.localeCompare(right);
  });
  for (const name of priorEntries) {
    // Each rename is atomic on the same volume; canonical final/report names
    // move first, so an interrupted run can never leave an old PASS consumable.
    renameSync(resolve(evidenceDirectory, name), resolve(isolatedPath, name));
  }
  return repositoryRelative(isolatedPath);
}

const isolatedPriorEvidencePath = isolatePriorCanonicalGdpsEvidence();
const databaseUrl = required("DATABASE_URL");
const encryptionKey = required("WSGS_REQUEST_ENCRYPTION_KEY_BASE64");
const payloadCodec = Aes256GcmPayloadCodec.fromBase64(encryptionKey);
const identity = createGroundingIdentity({
  servicePrincipalId: required("GOWM_DELEGATION_SERVICE_PRINCIPAL_ID"),
  actorId: required("WSGS_READINESS_ACTOR_ID"),
  dataScopes: [required("WSGS_READINESS_DATA_SCOPE")],
  datasetScopes: list("WSGS_READINESS_DATASET_SCOPES"),
  permissions: [...new Set([...list("WSGS_READINESS_PERMISSIONS"), "grounding.read"])]
});

let gdpsDriverRuntimeIdentity: GdpsV021DriverRuntimeIdentity | undefined;
let gdpsRuntimeIdentityHash: GdpsV021Sha256Digest | undefined;
let gdpsDriverSidecar: GdpsDriverSidecarContract | undefined;

const volatileRuntimeIdentityKeys = new Set([
  "checkedAt", "generatedAt", "timestamp", "durationMs", "latencyMs", "uptimeSeconds"
]);

function stablePublicRuntimeIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stablePublicRuntimeIdentity(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as JsonObject)
    .filter(([key]) => !volatileRuntimeIdentityKeys.has(key))
    .map(([key, entry]) => [key, stablePublicRuntimeIdentity(entry)]));
}

async function sampleSharedGowmRuntimeHash(): Promise<GdpsV021Sha256Digest> {
  const baseUrl = required("GOWM_GATEWAY_BASE_URL").replace(/\/+$/u, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("GDPS_SHARED_RUNTIME_SAMPLE_TIMEOUT")), 5_000);
  try {
    const response = await fetch(`${baseUrl}/health/ready`, { signal: controller.signal });
    const body = object(await response.json(), "GDPS_SHARED_RUNTIME_READY_RESPONSE_INVALID");
    if (response.status !== 200 || !["ok", "ready"].includes(String(body["status"]))) {
      throw new Error(`GDPS_SHARED_RUNTIME_NOT_READY_${response.status}`);
    }
    return canonicalSha256({
      schemaVersion: "wsgs-gdps-shared-runtime-sample/1.0",
      httpStatus: response.status,
      ready: stablePublicRuntimeIdentity(body)
    }) as GdpsV021Sha256Digest;
  } finally {
    clearTimeout(timeout);
  }
}

async function computeGdpsV021RuntimeIdentity(
  database: Pool,
  authority: VerifiedGdpsV021RuntimeAuthorityPreflight,
  localReadiness: { readonly liveHttpStatus: number; readonly readyHttpStatus: number },
  sidecar: GdpsDriverSidecarContract | undefined
): Promise<GdpsV021DriverRuntimeIdentity> {
  const runtime = await database.query<{
    database_name: string;
    postmaster_started_at: string;
    server_version_num: string;
  }>(`SELECT current_database() AS database_name,
             pg_postmaster_start_time()::text AS postmaster_started_at,
             current_setting('server_version_num') AS server_version_num`);
  const row = runtime.rows[0];
  if (!row?.database_name || !row.postmaster_started_at || !row.server_version_num) {
    throw new Error("GDPS_RUNTIME_DATABASE_IDENTITY_MISSING");
  }
  const databaseIdentityHash = canonicalSha256(row) as GdpsV021Sha256Digest;
  const sharedGowmGatewayRuntimeHash = await sampleSharedGowmRuntimeHash();
  const gowmGatewayRuntimeHash = canonicalSha256({
    schemaVersion: "wsgs-gdps-gateway-runtime-set/1.0",
    sharedGowmGatewayRuntimeHash,
    isolatedGowmGatewayRuntimeHash: sidecar?.gatewayRuntimeHash ?? null,
    sidecarContractHash: sidecar?.hash ?? null
  }) as GdpsV021Sha256Digest;
  const wsgsRuntimeHash = canonicalSha256({
    schemaVersion: "wsgs-gdps-wsgs-runtime/1.0",
    sourceCommit,
    databaseIdentityHash,
    localReadiness,
    operationLockHash: authority.operationLock.hash,
    runtimeRecipeLockHash: required("WSGS_GDPS_RECIPE_LOCK_SHA256"),
    runtimeConsumerSnapshotHash: required("WSGS_GDPS_CONSUMER_SNAPSHOT_SHA256")
  }) as GdpsV021Sha256Digest;
  const gdpsProviderRuntimeHash = canonicalSha256({
    schemaVersion: "wsgs-gdps-provider-runtime-binding/1.0",
    gdpsCommit: authority.gdpsCommit,
    providerId: authority.provider.providerId,
    providerVersion: authority.provider.providerVersion,
    capabilityCount: authority.provider.capabilityCount,
    providerManifestHash: authority.provider.providerManifestHash,
    providerRecipeLockHash: required("WSGS_GDPS_PROVIDER_RECIPE_LOCK_SHA256"),
    operationLockHash: authority.operationLock.hash,
    gowmGatewayRuntimeHash,
    isolatedGdpsProviderRuntimeHash: sidecar?.gdpsProviderRuntimeHash ?? null,
    sidecarContractHash: sidecar?.hash ?? null
  }) as GdpsV021Sha256Digest;
  return {
    schemaVersion: "wsgs-gdps-driver-runtime-identity/1.0",
    gateRunId,
    databaseIdentityHash,
    wsgsRuntimeHash,
    gowmGatewayRuntimeHash,
    gdpsProviderRuntimeHash
  };
}

interface ByteArtifact {
  readonly id: string;
  readonly subject: GdpsV021EvidenceSubject;
  readonly kind: GdpsV021EvidenceArtifactKind;
  readonly absolutePath: string;
  readonly repoRelativePath: string;
  readonly hash: GdpsV021Sha256Digest;
  readonly byteLength: number;
}

function stableJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function repositoryRelative(path: string): string {
  const value = relative(process.cwd(), path).split(sep).join("/");
  if (!value || value.startsWith("../") || value.includes("/../") || value.includes(":")) {
    throw new Error("EVIDENCE_ARTIFACT_PATH_ESCAPE");
  }
  return value;
}

function writeAtomicJsonArtifact(
  id: string,
  subject: GdpsV021EvidenceSubject,
  kind: GdpsV021EvidenceArtifactKind,
  absolutePath: string,
  value: unknown
): ByteArtifact {
  const bytes = stableJsonBytes(value);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${gateRunId}.tmp`;
  writeFileSync(temporaryPath, bytes);
  renameSync(temporaryPath, absolutePath);
  return {
    id,
    subject,
    kind,
    absolutePath,
    repoRelativePath: repositoryRelative(absolutePath),
    hash: sha256(bytes),
    byteLength: bytes.byteLength
  };
}

function writeAtomicJsonFile(absolutePath: string, value: unknown): {
  readonly path: string;
  readonly hash: GdpsV021Sha256Digest;
  readonly byteLength: number;
} {
  const bytes = stableJsonBytes(value);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${gateRunId}.tmp`;
  writeFileSync(temporaryPath, bytes);
  renameSync(temporaryPath, absolutePath);
  return { path: repositoryRelative(absolutePath), hash: sha256(bytes), byteLength: bytes.byteLength };
}

interface GdpsDriverSidecarContract {
  readonly hash: GdpsV021Sha256Digest;
  readonly controllerIdHash: GdpsV021Sha256Digest;
  readonly isolatedGatewayBaseUrl: string;
  readonly requestDirectory: string;
  readonly attestationDirectory: string;
  readonly gatewayRuntimeHash: GdpsV021Sha256Digest;
  readonly gdpsProviderRuntimeHash: GdpsV021Sha256Digest;
}

function pathInside(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate));
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !value.includes(":"));
}

function driverOutputDirectory(): string {
  return dirname(resolve(required("WSGS_GDPS_DRIVER_MANIFEST_FILE")));
}

function loadGdpsDriverSidecarContract(
  authority: VerifiedGdpsV021RuntimeAuthorityPreflight
): GdpsDriverSidecarContract | undefined {
  const contractPath = process.env["WSGS_GDPS_DRIVER_SIDECAR_CONTRACT_FILE"]?.trim();
  const contractHash = process.env["WSGS_GDPS_DRIVER_SIDECAR_CONTRACT_SHA256"]?.trim();
  if (!contractPath && !contractHash) return undefined;
  if (!contractPath || !contractHash) throw new Error("GDPS_DRIVER_SIDECAR_CONTRACT_BINDING_INCOMPLETE");
  const bound = readBoundJson(
    "WSGS_GDPS_DRIVER_SIDECAR_CONTRACT_FILE",
    "WSGS_GDPS_DRIVER_SIDECAR_CONTRACT_SHA256",
    "GDPS_DRIVER_SIDECAR_CONTRACT"
  );
  const value = bound.value;
  if (value["schemaVersion"] !== "wsgs-gdps-isolated-driver-sidecar/1.0" ||
      value["gateRunId"] !== gateRunId || value["sourceCommit"] !== sourceCommit ||
      value["handoffBundleHash"] !== authority.handoff.bundleHash ||
      value["operationLockHash"] !== authority.operationLock.hash ||
      value["providerRecipeLockHash"] !== required("WSGS_GDPS_PROVIDER_RECIPE_LOCK_SHA256")) {
    throw new Error("GDPS_DRIVER_SIDECAR_CONTRACT_SOURCE_BINDING_INVALID");
  }
  const supportedStates = value["supportedStates"];
  const expectedStates = ["CURRENT_B", "INITIAL_A", "UPSTREAM_TRUNCATED"];
  if (!Array.isArray(supportedStates) || supportedStates.length !== expectedStates.length ||
      [...supportedStates].sort().some((entry, index) => entry !== expectedStates[index])) {
    throw new Error("GDPS_DRIVER_SIDECAR_CONTRACT_STATES_INVALID");
  }
  const isolatedUrl = new URL(string(value["isolatedGatewayBaseUrl"],
    "GDPS_DRIVER_SIDECAR_GATEWAY_URL_MISSING"));
  const sharedUrl = new URL(required("GOWM_GATEWAY_BASE_URL"));
  if (!["http:", "https:"].includes(isolatedUrl.protocol) || isolatedUrl.username || isolatedUrl.password ||
      isolatedUrl.search || isolatedUrl.hash || isolatedUrl.origin === sharedUrl.origin ||
      (["127.0.0.1", "localhost"].includes(isolatedUrl.hostname) && isolatedUrl.port === "18063")) {
    throw new Error("GDPS_DRIVER_SIDECAR_GATEWAY_NOT_ISOLATED");
  }
  const outputRoot = driverOutputDirectory();
  const requestDirectory = resolve(process.cwd(), string(value["requestDirectory"],
    "GDPS_DRIVER_SIDECAR_REQUEST_DIRECTORY_MISSING"));
  const attestationDirectory = resolve(process.cwd(), string(value["attestationDirectory"],
    "GDPS_DRIVER_SIDECAR_ATTESTATION_DIRECTORY_MISSING"));
  if (!pathInside(outputRoot, requestDirectory) || !pathInside(outputRoot, attestationDirectory) ||
      requestDirectory === outputRoot || attestationDirectory === outputRoot) {
    throw new Error("GDPS_DRIVER_SIDECAR_DIRECTORY_NOT_RUN_SCOPED");
  }
  mkdirSync(requestDirectory, { recursive: true });
  mkdirSync(attestationDirectory, { recursive: true });
  const gatewayRuntimeHash = optionalDigest(value["gatewayRuntimeHash"],
    "GDPS_DRIVER_SIDECAR_GATEWAY_RUNTIME_HASH_INVALID");
  const gdpsProviderRuntimeHash = optionalDigest(value["gdpsProviderRuntimeHash"],
    "GDPS_DRIVER_SIDECAR_PROVIDER_RUNTIME_HASH_INVALID");
  if (!gatewayRuntimeHash || !gdpsProviderRuntimeHash) {
    throw new Error("GDPS_DRIVER_SIDECAR_RUNTIME_HASH_MISSING");
  }
  return {
    hash: bound.hash,
    controllerIdHash: sha256(string(value["controllerId"], "GDPS_DRIVER_SIDECAR_CONTROLLER_ID_MISSING")),
    isolatedGatewayBaseUrl: isolatedUrl.toString().replace(/\/+$/u, ""),
    requestDirectory,
    attestationDirectory,
    gatewayRuntimeHash,
    gdpsProviderRuntimeHash
  };
}

function sidecarTimeoutMs(): number {
  const raw = process.env["WSGS_GDPS_DRIVER_SIDECAR_TIMEOUT_MS"]?.trim() ?? "30000";
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 60_000) {
    throw new Error("GDPS_DRIVER_SIDECAR_TIMEOUT_INVALID");
  }
  return value;
}

async function awaitGdpsSidecarAttestation(input: {
  readonly sidecar: GdpsDriverSidecarContract;
  readonly caseId: "NEG-TRUNCATED" | "NEG-CURRENTNESS";
  readonly targetState: "UPSTREAM_TRUNCATED" | "INITIAL_A" | "CURRENT_B";
  readonly request: JsonObject;
  readonly expectedSchemaVersion: string;
}): Promise<{ readonly attestationPath: string; readonly attestationHash: GdpsV021Sha256Digest }> {
  const challengeHash = sha256(randomBytes(32));
  const stem = `${input.caseId}.${input.targetState}.${challengeHash.slice(-16)}`;
  const attestationPath = resolve(input.sidecar.attestationDirectory, `${stem}.attestation.json`);
  const hashPath = `${attestationPath}.sha256`;
  const requestPath = resolve(input.sidecar.requestDirectory, `${stem}.request.json`);
  writeAtomicJsonFile(requestPath, {
    ...input.request,
    schemaVersion: "wsgs-gdps-isolated-driver-request/1.0",
    gateRunId,
    caseId: input.caseId,
    targetState: input.targetState,
    challengeHash,
    controllerIdHash: input.sidecar.controllerIdHash,
    sidecarContractHash: input.sidecar.hash,
    gatewayRuntimeHash: input.sidecar.gatewayRuntimeHash,
    gdpsProviderRuntimeHash: input.sidecar.gdpsProviderRuntimeHash,
    responseAttestationPath: repositoryRelative(attestationPath)
  });
  const deadline = Date.now() + sidecarTimeoutMs();
  while ((!existsSync(attestationPath) || !existsSync(hashPath)) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (!existsSync(attestationPath) || !existsSync(hashPath)) {
    throw new GdpsV021DriverExternalContractError(input.caseId,
      `SIDECAR_${input.targetState}_ATTESTATION_TIMEOUT`,
      `The isolated driver sidecar did not attest ${input.targetState} for the current gate run.`);
  }
  const claimedHash = readFileSync(hashPath, "utf8").trim();
  const bytes = readFileSync(attestationPath);
  const actualHash = sha256(bytes);
  if (claimedHash !== actualHash) throw new Error(`GDPS_DRIVER_SIDECAR_ATTESTATION_HASH_DRIFT_${input.caseId}`);
  const attestation = object(JSON.parse(bytes.toString("utf8")) as unknown,
    `GDPS_DRIVER_SIDECAR_ATTESTATION_INVALID_${input.caseId}`);
  if (attestation["schemaVersion"] !== input.expectedSchemaVersion ||
      attestation["gateRunId"] !== gateRunId || attestation["caseId"] !== input.caseId ||
      attestation["challengeHash"] !== challengeHash ||
      attestation["controllerIdHash"] !== input.sidecar.controllerIdHash ||
      attestation["sidecarContractHash"] !== input.sidecar.hash ||
      attestation["gatewayRuntimeHash"] !== input.sidecar.gatewayRuntimeHash ||
      attestation["gdpsProviderRuntimeHash"] !== input.sidecar.gdpsProviderRuntimeHash) {
    throw new Error(`GDPS_DRIVER_SIDECAR_ATTESTATION_BINDING_INVALID_${input.caseId}`);
  }
  for (const [key, expected] of Object.entries(input.request)) {
    if (attestation[key] !== expected) {
      throw new Error(`GDPS_DRIVER_SIDECAR_ATTESTATION_REQUEST_DRIFT_${input.caseId}_${key}`);
    }
  }
  return { attestationPath, attestationHash: actualHash };
}

function createGdpsSidecarCallbacks(
  sidecar: GdpsDriverSidecarContract | undefined
): Pick<GdpsV021DriverOrchestratorInput, "prepareIsolatedRuntime" | "crossCurrentnessBarrier"> {
  if (!sidecar) return {};
  return {
    prepareIsolatedRuntime: async (request: GdpsV021IsolatedRuntimePreparationRequest) =>
      await awaitGdpsSidecarAttestation({
        sidecar,
        caseId: request.caseId,
        targetState: request.targetState,
        expectedSchemaVersion: "wsgs-gdps-isolated-driver-runtime/1.0",
        request: {
          runtimeIdentityHash: request.runtimeIdentityHash,
          sharedRuntimeBeforeHash: request.sharedRuntimeBeforeHash
        }
      }),
    crossCurrentnessBarrier: async (request: GdpsV021CurrentnessBarrierRequest) =>
      await awaitGdpsSidecarAttestation({
        sidecar,
        caseId: request.caseId,
        targetState: "CURRENT_B",
        expectedSchemaVersion: "wsgs-gdps-currentness-epoch-barrier/1.0",
        request: {
          productId: request.productId,
          initialContentHash: request.initialContentHash,
          sourceGroundingIdHash: request.sourceGroundingIdHash,
          sourceResultHash: request.sourceResultHash,
          initialEpochAttestationHash: request.initialEpochAttestationHash
        }
      })
  };
}

interface GdpsW43SidecarContract {
  readonly hash: GdpsV021Sha256Digest;
  readonly controllerIdHash: GdpsV021Sha256Digest;
  readonly isolatedGatewayBaseUrl: string;
  readonly requestDirectory: string;
  readonly responseDirectory: string;
}

function loadGdpsW43SidecarContract(
  authority: VerifiedGdpsV021RuntimeAuthorityPreflight,
  runtimeIdentityHash: GdpsV021Sha256Digest
): GdpsW43SidecarContract | undefined {
  const path = process.env["WSGS_GDPS_W43_SIDECAR_CONTRACT_FILE"]?.trim();
  const hash = process.env["WSGS_GDPS_W43_SIDECAR_CONTRACT_SHA256"]?.trim();
  if (!path && !hash) return undefined;
  if (!path || !hash) throw new Error("GDPS_W43_SIDECAR_CONTRACT_BINDING_INCOMPLETE");
  const bound = readBoundJson("WSGS_GDPS_W43_SIDECAR_CONTRACT_FILE",
    "WSGS_GDPS_W43_SIDECAR_CONTRACT_SHA256", "GDPS_W43_SIDECAR_CONTRACT");
  const value = bound.value;
  if (value["schemaVersion"] !== "wsgs-gdps-v021-w43-sidecar/1.0" ||
      value["candidateSha"] !== sourceCommit || value["gateRunId"] !== gateRunId ||
      value["runtimeIdentityHash"] !== runtimeIdentityHash ||
      value["handoffBundleHash"] !== authority.handoff.bundleHash ||
      value["operationLockHash"] !== authority.operationLock.hash ||
      value["providerRecipeLockHash"] !== required("WSGS_GDPS_PROVIDER_RECIPE_LOCK_SHA256")) {
    throw new Error("GDPS_W43_SIDECAR_CONTRACT_SOURCE_BINDING_INVALID");
  }
  const url = new URL(string(value["isolatedGatewayBaseUrl"], "GDPS_W43_SIDECAR_GATEWAY_URL_MISSING"));
  const shared = new URL(required("GOWM_GATEWAY_BASE_URL"));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      url.origin === shared.origin) throw new Error("GDPS_W43_SIDECAR_GATEWAY_NOT_ISOLATED");
  const root = resolve(driverOutputDirectory(), "w43");
  const requestDirectory = resolve(process.cwd(), string(value["requestDirectory"], "GDPS_W43_REQUEST_DIR_MISSING"));
  const responseDirectory = resolve(process.cwd(), string(value["responseDirectory"], "GDPS_W43_RESPONSE_DIR_MISSING"));
  if (!pathInside(root, requestDirectory) || !pathInside(root, responseDirectory) ||
      requestDirectory === root || responseDirectory === root) throw new Error("GDPS_W43_SIDECAR_DIRECTORY_INVALID");
  mkdirSync(requestDirectory, { recursive: true });
  mkdirSync(responseDirectory, { recursive: true });
  return { hash: bound.hash, controllerIdHash: sha256(string(value["controllerId"], "GDPS_W43_CONTROLLER_ID_MISSING")),
    isolatedGatewayBaseUrl: url.toString().replace(/\/+$/u, ""), requestDirectory, responseDirectory };
}

async function awaitGdpsW43Control(input: {
  readonly sidecar: GdpsW43SidecarContract;
  readonly action: "ADVANCE" | "ARM" | "READ";
  readonly scenarioId?: string;
  readonly barrier?: GdpsV021W43BarrierName;
  readonly runtimeIdentityHash: GdpsV021Sha256Digest;
}): Promise<GdpsV021W43BarrierArtifact | GdpsV021W43BarrierArmArtifact> {
  const challengeHash = sha256(randomBytes(32));
  const stem = `${input.action.toLowerCase()}.${challengeHash.slice(-16)}`;
  const responsePath = resolve(input.sidecar.responseDirectory, `${stem}.json`);
  const hashPath = `${responsePath}.sha256`;
  writeAtomicJsonFile(resolve(input.sidecar.requestDirectory, `${stem}.request.json`), {
    schemaVersion: "wsgs-gdps-v021-w43-control-request/1.0", action: input.action,
    candidateSha: sourceCommit, gateRunId, runtimeIdentityHash: input.runtimeIdentityHash,
    ...(input.scenarioId ? { scenarioId: input.scenarioId } : {}),
    ...(input.barrier ? { barrier: input.barrier } : {}),
    challengeHash, controllerIdHash: input.sidecar.controllerIdHash,
    sidecarContractHash: input.sidecar.hash, responsePath: repositoryRelative(responsePath)
  });
  const deadline = Date.now() + sidecarTimeoutMs();
  while ((!existsSync(responsePath) || !existsSync(hashPath)) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (!existsSync(responsePath) || !existsSync(hashPath)) throw new Error(`GDPS_W43_SIDECAR_${input.action}_TIMEOUT`);
  const bytes = readFileSync(responsePath);
  const actualHash = sha256(bytes);
  if (readFileSync(hashPath, "utf8").trim() !== actualHash) throw new Error("GDPS_W43_SIDECAR_RESPONSE_HASH_DRIFT");
  if (input.action !== "ARM") return { bytes, hash: actualHash };
  const arm = object(JSON.parse(bytes.toString("utf8")) as unknown, "GDPS_W43_ARM_RESPONSE_INVALID");
  const armKeys = ["barrier", "candidateSha", "challengeHash", "controllerIdHash", "gateRunId",
    "runtimeIdentityHash", "scenarioId", "schemaVersion", "sidecarContractHash"];
  if (JSON.stringify(Object.keys(arm).sort()) !== JSON.stringify(armKeys.sort()) ||
      arm["schemaVersion"] !== "wsgs-gdps-v021-w43-barrier-arm/1.0" ||
      arm["candidateSha"] !== sourceCommit || arm["gateRunId"] !== gateRunId ||
      arm["runtimeIdentityHash"] !== input.runtimeIdentityHash || arm["challengeHash"] !== challengeHash ||
      arm["scenarioId"] !== input.scenarioId || arm["barrier"] !== input.barrier ||
      arm["controllerIdHash"] !== input.sidecar.controllerIdHash ||
      arm["sidecarContractHash"] !== input.sidecar.hash) throw new Error("GDPS_W43_ARM_RESPONSE_BINDING_INVALID");
  return { bytes, hash: actualHash };
}

function validateGdpsV021ReportContract(value: unknown): {
  readonly schemaPath: string;
  readonly schemaHash: GdpsV021Sha256Digest;
} {
  const schemaPath = resolve(process.cwd(), "contracts", "wsgs-v0.2-gdps", "report-contracts",
    "gdps-v021-real-e2e-report.schema.json");
  const schemaBytes = readFileSync(schemaPath);
  const schema = JSON.parse(schemaBytes.toString("utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  if (!ajv.validateSchema(schema)) throw new Error("GDPS_V021_REPORT_SCHEMA_INVALID");
  const validate = ajv.compile(schema);
  if (!validate(value)) {
    const details = ajv.errorsText(validate.errors).replace(/[^A-Za-z0-9_:/.-]+/gu, "_").slice(0, 400);
    throw new Error(`GDPS_V021_REPORT_CONTRACT_INVALID_${details}`);
  }
  return { schemaPath: repositoryRelative(schemaPath), schemaHash: sha256(schemaBytes) };
}

function reportSourceIdentity(
  authority: VerifiedGdpsV021RuntimeAuthorityPreflight,
  runtimeIdentityHash: GdpsV021Sha256Digest
): GdpsV021ReportInput["sourceIdentity"] {
  return {
    wsgsCommit: authority.sourceCommit,
    gdpsCommit: authority.gdpsCommit,
    gowmIdentityHash: sha256(authority.gowmCommit),
    runtimeIdentityHash,
    handoffBundleHash: authority.handoff.bundleHash,
    operationLockProvenanceHash: authority.operationLock.provenanceHash,
    providerId: authority.provider.providerId,
    providerVersion: authority.provider.providerVersion,
    capabilityCount: authority.provider.capabilityCount
  };
}

interface GatewayTransportFacts {
  readonly gatewayOnly: boolean;
  readonly directProviderCalls: number;
  readonly mockTransportUsed: boolean;
  readonly persistedGdpsExecutionCount: number;
}

function reportExecution(facts: GatewayTransportFacts): GdpsV021ReportInput["execution"] {
  return {
    requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY",
    gatewayOnly: facts.gatewayOnly,
    directProviderCalls: facts.directProviderCalls,
    mockTransportUsed: facts.mockTransportUsed
  };
}

function artifactRecord(
  artifact: ByteArtifact,
  authority: VerifiedGdpsV021RuntimeAuthorityPreflight,
  runtimeIdentityHash: GdpsV021Sha256Digest,
  execution: GdpsV021ReportInput["execution"]
): GdpsV021EvidenceArtifactRecord {
  const sourceIdentity = reportSourceIdentity(authority, runtimeIdentityHash);
  if (execution.requiredExecutionPath !== "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" ||
      execution.gatewayOnly !== true || execution.directProviderCalls !== 0 ||
      execution.mockTransportUsed !== false) {
    throw new Error(`GDPS_ARTIFACT_RUNTIME_BINDING_TRANSPORT_INVALID_${artifact.id}`);
  }
  return {
    id: artifact.id,
    kind: artifact.kind,
    subject: artifact.subject,
    repoRelativePath: artifact.repoRelativePath,
    hash: artifact.hash,
    byteLength: artifact.byteLength,
    byteVerified: true,
    sourceBinding: {
      wsgsCommit: sourceIdentity.wsgsCommit,
      gdpsCommit: sourceIdentity.gdpsCommit,
      gowmIdentityHash: sourceIdentity.gowmIdentityHash,
      handoffBundleHash: sourceIdentity.handoffBundleHash,
      operationLockProvenanceHash: sourceIdentity.operationLockProvenanceHash
    },
    runtimeBinding: {
      runtimeIdentityHash: sourceIdentity.runtimeIdentityHash,
      requiredExecutionPath: execution.requiredExecutionPath,
      providerId: sourceIdentity.providerId,
      providerVersion: sourceIdentity.providerVersion,
      capabilityCount: sourceIdentity.capabilityCount,
      gatewayOnly: execution.gatewayOnly,
      directProviderCalls: execution.directProviderCalls,
      mockTransportUsed: execution.mockTransportUsed
    },
    operationLockHash: authority.operationLock.hash
  };
}

function verifiedDriverArtifactRecords(
  postflight: VerifiedGdpsV021RuntimePreflight,
  execution: GdpsV021ReportInput["execution"]
): GdpsV021EvidenceArtifactRecord[] {
  return postflight.driverManifest.drivers.flatMap((driver) => {
    const ids = gdpsV021DriverArtifactIds(driver.caseId);
    const artifacts: ByteArtifact[] = [
      {
        id: ids.attestation,
        subject: driver.caseId,
        kind: "DRIVER_ATTESTATION",
        absolutePath: resolve(process.cwd(), driver.attestationPath),
        repoRelativePath: driver.attestationPath,
        hash: driver.attestationHash,
        byteLength: driver.attestationByteLength
      },
      {
        id: ids.implementation,
        subject: driver.caseId,
        kind: "DRIVER_IMPLEMENTATION",
        absolutePath: resolve(process.cwd(), driver.implementationPath),
        repoRelativePath: driver.implementationPath,
        hash: driver.implementationHash,
        byteLength: driver.implementationByteLength
      },
      {
        id: ids.evidence,
        subject: driver.caseId,
        kind: "DRIVER_EVIDENCE",
        absolutePath: resolve(process.cwd(), driver.evidencePath),
        repoRelativePath: driver.evidencePath,
        hash: driver.evidenceHash,
        byteLength: driver.evidenceByteLength
      }
    ];
    for (const artifact of artifacts) {
      if (statSync(artifact.absolutePath).size !== artifact.byteLength || sha256(readFileSync(artifact.absolutePath)) !== artifact.hash) {
        throw new Error(`GDPS_DRIVER_ARTIFACT_TOCTOU_${driver.caseId}_${artifact.kind}`);
      }
    }
    return artifacts.map((artifact) => artifactRecord(
      artifact,
      postflight,
      postflight.driverManifest.runtimeIdentityHash,
      execution
    ));
  });
}

interface PersistedStageFact {
  readonly stage: string;
  readonly status: string;
  readonly inputHash: GdpsV021Sha256Digest;
  readonly outputHash: GdpsV021Sha256Digest | null;
  readonly recordHash: GdpsV021Sha256Digest;
  readonly errorCode: string | null;
  readonly elapsedMs: number;
}

interface PersistedExecutionFact {
  readonly executionKind: "DIRECT_OPERATION" | "WORLD_QUERY" | "WORLD_QUERY_NODE";
  readonly operationKey: string | null;
  readonly requestHash: GdpsV021Sha256Digest;
  readonly resultHash: GdpsV021Sha256Digest | null;
  readonly normalizedStatus: string;
  readonly upstreamStatus: string;
  readonly gatewayQueryIdHash: GdpsV021Sha256Digest | null;
  readonly gatewayJobIdHash: GdpsV021Sha256Digest | null;
  readonly dataSnapshot: JsonObject | null;
  readonly computeSnapshot: JsonObject | null;
  readonly snapshotAdherence: JsonObject | null;
  readonly receiptIds: string[];
  readonly evidenceIds: string[];
}

interface PersistedResultFacts {
  readonly terminalStatus: string;
  readonly resultHash: GdpsV021Sha256Digest;
  readonly resultDocumentHash: GdpsV021Sha256Digest;
  readonly referenceProductCount: number;
  readonly evidenceItemCount: number;
  readonly ambiguityCount: number;
  readonly unresolvedMentionCount: number;
  readonly capabilityGapCount: number;
  readonly persistedProductKinds: readonly string[];
  readonly persistedProductHashes: readonly GdpsV021Sha256Digest[];
}

interface CaseEvidence {
  recipeId: string;
  requestHash: `sha256:${string}`;
  sourceTextHash: GdpsV021Sha256Digest;
  requestRowHash: GdpsV021Sha256Digest;
  groundingIdHash: `sha256:${string}`;
  terminalStatus: string;
  resultHash: `sha256:${string}`;
  stageHashes: `sha256:${string}`[];
  requestIdHash: GdpsV021Sha256Digest;
  gateRunId: string;
  stageEvidence: PersistedStageFact[];
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
  gdpsSourceEvidence: JsonObject[];
  executionEvidence: PersistedExecutionFact[];
  runtimeBinding: {
    readonly operationLockHash: GdpsV021Sha256Digest | null;
    readonly recipeLockHash: GdpsV021Sha256Digest | null;
    readonly consumerSnapshotHash: GdpsV021Sha256Digest | null;
  };
  resultFacts: PersistedResultFacts;
  truncated: boolean;
  totalStageElapsedMs: number;
  compositionProof: {
    resolveReferenceKeyHashes: GdpsV021Sha256Digest[];
    validatedReferenceKeyHashes: GdpsV021Sha256Digest[];
    worldQueryAnchorReferenceKeyHashes: GdpsV021Sha256Digest[];
    directOperationKeys: string[];
    directValidationProof: boolean;
    planOperationKeys: string[];
    planDataflowBindings: string[];
    validationLeaseUsable: boolean;
  };
}

interface PrivateCaseRuntime {
  readonly terminalResult: JsonObject;
  readonly checkpointState: Readonly<Record<string, unknown>>;
}

const privateCaseRuntime = new WeakMap<CaseEvidence, PrivateCaseRuntime>();

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
  mode: "DISABLED" | "GDPS_V021_FROZEN_CORPUS";
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
const gdpsV021DriverCaseIds = new Set([
  "NEG-DATA-GAP", "NEG-RECIPE-DRIFT", "NEG-TRUNCATED", "NEG-CURRENTNESS"
]);
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
    throw new Error("GDPS_V021_FROZEN_CORPUS_REQUIRED");
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
  return {
    mode: "GDPS_V021_FROZEN_CORPUS",
    cases: selected,
    totalCaseCount: cases.length,
    selectedCaseCount: selected.length,
    fullCorpusSelected: !requestedCase,
    corpusHash: sha256(bytes)
  };
}

interface ProviderRecipeBinding {
  readonly recipeId: string;
  readonly operationKey: string;
  readonly inputSchemaHash: GdpsV021Sha256Digest;
  readonly outputSchemaHash: GdpsV021Sha256Digest;
  readonly semanticProfileHash: GdpsV021Sha256Digest;
}

interface RuntimeRecipeBinding extends ProviderRecipeBinding {
  readonly semanticPattern: string;
}

interface GdpsRuntimeExpectations {
  operationByPattern: Map<string, string>;
  runtimeRecipeByPattern: Map<string, RuntimeRecipeBinding>;
  providerRecipeByOperation: Map<string, ProviderRecipeBinding>;
  gdpsOperationKeys: Set<string>;
  runtimeRecipeLockHash?: `sha256:${string}`;
  runtimeConsumerSnapshotHash?: `sha256:${string}`;
  runtimeOperationLockHash?: `sha256:${string}`;
  providerRecipeLockHash?: `sha256:${string}`;
}

function readBoundJson(pathVariable: string, hashVariable: string, code: string): {
  value: JsonObject;
  hash: `sha256:${string}`;
} {
  const path = required(pathVariable);
  const expectedHash = required(hashVariable);
  if (!/^sha256:[0-9a-f]{64}$/u.test(expectedHash)) throw new Error(`${code}_EXPECTED_HASH_INVALID`);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new Error(`${code}_MISSING`);
  }
  const actualHash = sha256(bytes);
  if (actualHash !== expectedHash) throw new Error(`${code}_HASH_DRIFT`);
  try {
    return { value: object(JSON.parse(bytes.toString("utf8")) as unknown, `${code}_INVALID`), hash: actualHash };
  } catch {
    throw new Error(`${code}_INVALID`);
  }
}

function loadGdpsRuntimeExpectations(
  suite: GdpsCaseSuite,
  authorityPreflight?: VerifiedGdpsV021RuntimeAuthorityPreflight
): GdpsRuntimeExpectations {
  if (suite.mode !== "GDPS_V021_FROZEN_CORPUS") {
    return {
      operationByPattern: new Map(),
      runtimeRecipeByPattern: new Map(),
      providerRecipeByOperation: new Map(),
      gdpsOperationKeys: new Set()
    };
  }
  if (!authorityPreflight) throw new Error("GDPS_RUNTIME_AUTHORITY_PREFLIGHT_MISSING");
  const runtimeRecipe = readBoundJson(
    "WSGS_GDPS_RECIPE_LOCK_FILE", "WSGS_GDPS_RECIPE_LOCK_SHA256", "GDPS_RUNTIME_RECIPE_LOCK"
  );
  const providerRecipe = readBoundJson(
    "WSGS_GDPS_PROVIDER_RECIPE_LOCK_FILE", "WSGS_GDPS_PROVIDER_RECIPE_LOCK_SHA256", "GDPS_PROVIDER_RECIPE_LOCK"
  );
  const value = runtimeRecipe.value;
  if (value["schemaVersion"] !== "wsgs-gdps-recipe-lock/2.0" ||
      !Array.isArray(value["recipes"]) || value["recipes"].length !== 14) {
    throw new Error("GDPS_RUNTIME_RECIPE_LOCK_CONTRACT_INVALID");
  }
  if (providerRecipe.value["providerId"] !== "gdps.geospatial-products" ||
      providerRecipe.value["providerVersion"] !== "0.2.1" ||
      !Array.isArray(providerRecipe.value["recipes"]) || providerRecipe.value["recipes"].length !== 30) {
    throw new Error("GDPS_PROVIDER_RECIPE_LOCK_CONTRACT_INVALID");
  }
  if (authorityPreflight.handoff.fileHashes["GDPS_RECIPE_LOCK.json"] !== providerRecipe.hash) {
    throw new Error("GDPS_PROVIDER_RECIPE_LOCK_HANDOFF_DRIFT");
  }
  const providerRecipeByOperation = new Map<string, ProviderRecipeBinding>();
  for (const entry of providerRecipe.value["recipes"]) {
    const recipe = object(entry, "GDPS_PROVIDER_RECIPE_INVALID");
    const operationKey = `${string(recipe["operationId"], "GDPS_PROVIDER_RECIPE_OPERATION_ID_INVALID")}@${
      string(recipe["operationVersion"], "GDPS_PROVIDER_RECIPE_OPERATION_VERSION_INVALID")}`;
    const binding: ProviderRecipeBinding = {
      recipeId: string(recipe["recipeId"], "GDPS_PROVIDER_RECIPE_ID_INVALID"),
      operationKey,
      inputSchemaHash: optionalDigest(recipe["inputSchemaHash"], "GDPS_PROVIDER_RECIPE_INPUT_HASH_INVALID")!,
      outputSchemaHash: optionalDigest(recipe["outputSchemaHash"], "GDPS_PROVIDER_RECIPE_OUTPUT_HASH_INVALID")!,
      semanticProfileHash: optionalDigest(recipe["semanticProfileHash"], "GDPS_PROVIDER_RECIPE_PROFILE_HASH_INVALID")!
    };
    if (!binding.inputSchemaHash || !binding.outputSchemaHash || !binding.semanticProfileHash) {
      throw new Error(`GDPS_PROVIDER_RECIPE_HASH_TUPLE_INVALID_${operationKey}`);
    }
    if (providerRecipeByOperation.has(operationKey)) {
      throw new Error(`GDPS_PROVIDER_RECIPE_OPERATION_DUPLICATE_${operationKey}`);
    }
    providerRecipeByOperation.set(operationKey, binding);
  }
  const operationByPattern = new Map<string, string>();
  const runtimeRecipeByPattern = new Map<string, RuntimeRecipeBinding>();
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
    const providerBinding = providerRecipeByOperation.get(key);
    if (!providerBinding) throw new Error(`GDPS_PROVIDER_RECIPE_CASE_BINDING_MISSING_${pattern}_${key}`);
    const runtimeBinding: RuntimeRecipeBinding = {
      recipeId: string(recipe["recipeId"], `GDPS_RUNTIME_RECIPE_ID_INVALID_${pattern}`),
      semanticPattern: pattern,
      operationKey: key,
      inputSchemaHash: optionalDigest(operation["inputSchemaHash"], `GDPS_RUNTIME_INPUT_HASH_INVALID_${pattern}`)!,
      outputSchemaHash: optionalDigest(operation["outputSchemaHash"], `GDPS_RUNTIME_OUTPUT_HASH_INVALID_${pattern}`)!,
      semanticProfileHash: optionalDigest(operation["semanticProfileHash"], `GDPS_RUNTIME_PROFILE_HASH_INVALID_${pattern}`)!
    };
    if (!runtimeBinding.inputSchemaHash || !runtimeBinding.outputSchemaHash || !runtimeBinding.semanticProfileHash) {
      throw new Error(`GDPS_RUNTIME_RECIPE_HASH_TUPLE_INVALID_${pattern}`);
    }
    if (runtimeBinding.inputSchemaHash !== providerBinding.inputSchemaHash ||
        runtimeBinding.outputSchemaHash !== providerBinding.outputSchemaHash ||
        runtimeBinding.semanticProfileHash !== providerBinding.semanticProfileHash) {
      throw new Error(`GDPS_PROVIDER_RECIPE_HASH_TUPLE_DRIFT_${pattern}_${key}`);
    }
    operationByPattern.set(pattern, key);
    runtimeRecipeByPattern.set(pattern, runtimeBinding);
  }
  for (const definition of suite.cases) {
    if (definition.expectedPattern && !operationByPattern.has(definition.expectedPattern)) {
      throw new Error(`GDPS_EXPECTED_RECIPE_NOT_LOCKED_${definition.id}`);
    }
  }
  const consumerSnapshot = readBoundJson(
    "WSGS_GDPS_CONSUMER_SNAPSHOT_FILE", "WSGS_GDPS_CONSUMER_SNAPSHOT_SHA256", "GDPS_RUNTIME_CONSUMER_SNAPSHOT"
  );
  const snapshot = consumerSnapshot.value;
  const capabilityKeys = snapshot["capabilityKeys"];
  if (snapshot["schemaVersion"] !== "wsgs-gdps-consumer-snapshot/2.0" ||
      !Array.isArray(capabilityKeys) || capabilityKeys.length !== 30 ||
      !capabilityKeys.every((entry) => typeof entry === "string" && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+@1\.0$/u.test(entry)) ||
      new Set(capabilityKeys).size !== 30) {
    throw new Error("GDPS_RUNTIME_CONSUMER_SNAPSHOT_CONTRACT_INVALID");
  }
  return {
    operationByPattern,
    runtimeRecipeByPattern,
    providerRecipeByOperation,
    gdpsOperationKeys: new Set(capabilityKeys),
    runtimeRecipeLockHash: runtimeRecipe.hash,
    runtimeConsumerSnapshotHash: consumerSnapshot.hash,
    runtimeOperationLockHash: authorityPreflight.operationLock.hash,
    providerRecipeLockHash: providerRecipe.hash
  };
}

function acceptedTerminalStatuses(definition: GdpsCaseDefinition, suite: GdpsCaseSuite): readonly string[] {
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
  if (!runtime.runtimeOperationLockHash || !runtime.runtimeRecipeLockHash || !runtime.runtimeConsumerSnapshotHash ||
      evidence.runtimeBinding.operationLockHash !== runtime.runtimeOperationLockHash ||
      evidence.runtimeBinding.recipeLockHash !== runtime.runtimeRecipeLockHash ||
      evidence.runtimeBinding.consumerSnapshotHash !== runtime.runtimeConsumerSnapshotHash) {
    throw new Error(`GDPS_LIVE_RUNTIME_BINDING_DRIFT_${definition.id}`);
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

function optionalDigest(value: unknown, code: string): GdpsV021Sha256Digest | null {
  if (value === null || value === undefined) return null;
  const candidate = string(value, code);
  if (!/^sha256:[0-9a-f]{64}$/u.test(candidate)) throw new Error(code);
  return candidate as GdpsV021Sha256Digest;
}

function exactStringArray(value: unknown, code: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((entry) => typeof entry === "string" && entry.length > 0) ||
      new Set(value).size !== value.length) throw new Error(code);
  return [...value];
}

function uniqueStringArray(value: unknown, code: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.length > 0) ||
      new Set(value).size !== value.length) throw new Error(code);
  return [...value];
}

function productEvidenceFromSource(
  source: JsonObject,
  currentContentHash?: GdpsV021Sha256Digest
): GdpsV021ProductEvidence {
  const productId = string(source["productId"], "GDPS_PRODUCT_ID_MISSING");
  const contentHash = optionalDigest(source["contentHash"], "GDPS_PRODUCT_CONTENT_HASH_INVALID");
  const descriptorId = string(source["descriptorId"], "GDPS_PRODUCT_DESCRIPTOR_ID_MISSING");
  const descriptorHash = optionalDigest(source["descriptorHash"], "GDPS_PRODUCT_DESCRIPTOR_HASH_INVALID");
  const operationId = string(source["operationId"], "GDPS_PRODUCT_OPERATION_ID_MISSING");
  const operationVersion = string(source["operationVersion"], "GDPS_PRODUCT_OPERATION_VERSION_MISSING");
  const sourceOperationKey = `${operationId}@${operationVersion}`;
  const dataSnapshot = object(source["dataSnapshot"], "GDPS_PRODUCT_DATA_SNAPSHOT_MISSING");
  const computeSnapshot = object(source["computeSnapshot"], "GDPS_PRODUCT_COMPUTE_SNAPSHOT_MISSING");
  const quality = object(source["quality"], "GDPS_PRODUCT_QUALITY_MISSING");
  if (!contentHash || !descriptorHash || Object.keys(dataSnapshot).length === 0 ||
      Object.keys(computeSnapshot).length === 0 || Object.keys(quality).length === 0) {
    throw new Error("GDPS_PRODUCT_EVIDENCE_INCOMPLETE");
  }
  return {
    productId,
    contentHash,
    currentContentHash: currentContentHash ?? contentHash,
    descriptorId,
    descriptorHash,
    productType: string(source["productType"], "GDPS_PRODUCT_TYPE_MISSING"),
    productProfile: string(source["productProfile"], "GDPS_PRODUCT_PROFILE_MISSING"),
    queryProfile: string(source["queryProfile"], "GDPS_PRODUCT_QUERY_PROFILE_MISSING"),
    sourceOperationKey: sourceOperationKey as GdpsV021ProductEvidence["sourceOperationKey"],
    dataSnapshot: structuredClone(dataSnapshot),
    dataSnapshotHash: canonicalSha256(dataSnapshot) as GdpsV021Sha256Digest,
    computeSnapshot: structuredClone(computeSnapshot),
    computeSnapshotHash: canonicalSha256(computeSnapshot) as GdpsV021Sha256Digest,
    receiptIds: exactStringArray(source["receiptIds"], "GDPS_PRODUCT_RECEIPT_IDS_INVALID"),
    evidenceIds: exactStringArray(source["evidenceIds"], "GDPS_PRODUCT_EVIDENCE_IDS_INVALID"),
    quality: structuredClone(quality),
    qualityHash: canonicalSha256(quality) as GdpsV021Sha256Digest,
    truncated: source["truncated"] === true
  };
}

function providerRecipeBindingForCase(
  caseId: string,
  operationKeys: readonly string[],
  sources: readonly JsonObject[],
  runtime: GdpsRuntimeExpectations
): ProviderRecipeBinding | null {
  const gdpsOperations = operationKeys.filter((key) => runtime.gdpsOperationKeys.has(key));
  if (gdpsOperations.length === 0) return null;
  const unique = [...new Set(gdpsOperations)];
  if (unique.length !== 1) throw new Error(`GDPS_PROVIDER_RECIPE_CASE_OPERATION_AMBIGUOUS_${caseId}`);
  const operationKey = unique[0]!;
  const provider = runtime.providerRecipeByOperation.get(operationKey);
  if (!provider) throw new Error(`GDPS_PROVIDER_RECIPE_CASE_BINDING_MISSING_${caseId}_${operationKey}`);
  const selectedPatterns = sources.flatMap((source) => typeof source["recipeId"] === "string" ? [source["recipeId"]] : []);
  for (const source of sources) {
    const sourceKey = `${string(source["operationId"], `GDPS_SOURCE_OPERATION_ID_MISSING_${caseId}`)}@${
      string(source["operationVersion"], `GDPS_SOURCE_OPERATION_VERSION_MISSING_${caseId}`)}`;
    if (sourceKey !== operationKey) throw new Error(`GDPS_PROVIDER_RECIPE_SOURCE_OPERATION_DRIFT_${caseId}`);
    if (optionalDigest(source["recipeLockHash"], `GDPS_SOURCE_RECIPE_LOCK_HASH_INVALID_${caseId}`) !==
        runtime.runtimeRecipeLockHash) {
      throw new Error(`GDPS_RUNTIME_RECIPE_CASE_BINDING_DRIFT_${caseId}`);
    }
  }
  const runtimeRecipes = [...runtime.runtimeRecipeByPattern.values()]
    .filter((entry) => entry.operationKey === operationKey && selectedPatterns.includes(entry.recipeId));
  if (sources.length > 0 && runtimeRecipes.length !== 1) {
    throw new Error(`GDPS_RUNTIME_RECIPE_CASE_BINDING_MISSING_${caseId}`);
  }
  if (runtimeRecipes[0] && (runtimeRecipes[0].inputSchemaHash !== provider.inputSchemaHash ||
      runtimeRecipes[0].outputSchemaHash !== provider.outputSchemaHash ||
      runtimeRecipes[0].semanticProfileHash !== provider.semanticProfileHash)) {
    throw new Error(`GDPS_PROVIDER_RECIPE_HASH_TUPLE_DRIFT_${caseId}_${operationKey}`);
  }
  return provider;
}

function deriveLiveSemanticFacts(evidence: CaseEvidence): {
  readonly normalizedStatus: GdpsV021NormalizedStatus;
  readonly sourceCondition: string | null;
  readonly semanticCode: string | null;
  readonly currentness: "CURRENT" | "CHANGED" | "NOT_AVAILABLE" | null;
} {
  if (evidence.resultFacts.terminalStatus !== evidence.terminalStatus ||
      evidence.resultFacts.resultHash !== evidence.resultHash) {
    throw new Error(`GDPS_LIVE_RESULT_FACT_BINDING_MISMATCH_${evidence.recipeId}`);
  }
  if (evidence.gdpsSourceEvidence.length > 1) {
    throw new Error(`GDPS_LIVE_SOURCE_FACT_AMBIGUOUS_${evidence.recipeId}`);
  }
  const source = evidence.gdpsSourceEvidence[0];
  if (source) {
    const sourceStatus = string(source["normalizedStatus"], `GDPS_SOURCE_STATUS_MISSING_${evidence.recipeId}`);
    const mapping: Record<string, {
      normalizedStatus: GdpsV021NormalizedStatus;
      sourceCondition: string | null;
      semanticCode: string;
      currentness: "CURRENT" | "NOT_AVAILABLE" | null;
    }> = {
      COMPLETED: { normalizedStatus: "CURRENT", sourceCondition: "NORMAL_RESULT", semanticCode: "OK", currentness: "CURRENT" },
      PARTIAL: { normalizedStatus: "PARTIAL", sourceCondition: "NORMAL_RESULT", semanticCode: "RESULT_TRUNCATED", currentness: "CURRENT" },
      NO_DATA: { normalizedStatus: "DATA_GAP", sourceCondition: "PRODUCT_NOT_AVAILABLE", semanticCode: "DATA_GAP", currentness: "NOT_AVAILABLE" },
      FAILED: { normalizedStatus: "FAILED", sourceCondition: null, semanticCode: "FAILED", currentness: null }
    };
    const derived = mapping[sourceStatus];
    if (!derived) throw new Error(`GDPS_SOURCE_STATUS_UNSUPPORTED_${evidence.recipeId}_${sourceStatus}`);
    return derived;
  }
  const semanticMappings: Readonly<Record<string, {
    normalizedStatus: GdpsV021NormalizedStatus;
    sourceCondition: string | null;
  }>> = {
    DESCRIPTOR_GAP: { normalizedStatus: "CAPABILITY_GAP", sourceCondition: null },
    UNIT_MISMATCH: { normalizedStatus: "INDETERMINATE", sourceCondition: null },
    DATA_GAP: { normalizedStatus: "DATA_GAP", sourceCondition: "PRODUCT_NOT_AVAILABLE" },
    RECIPE_LOCK_DRIFT: { normalizedStatus: "CAPABILITY_GAP", sourceCondition: null },
    RESULT_TRUNCATED: { normalizedStatus: "PARTIAL", sourceCondition: "NORMAL_RESULT" },
    SNAPSHOT_MISMATCHED: { normalizedStatus: "STALE", sourceCondition: "CHANGED" }
  };
  const recognized = [...new Set(evidence.semanticCodes)].filter((code) => semanticMappings[code] !== undefined);
  if (evidence.terminalStatus === "AMBIGUOUS" && recognized.length === 0) {
    return { normalizedStatus: "AMBIGUOUS", sourceCondition: "REFERENCE_AMBIGUOUS", semanticCode: null, currentness: null };
  }
  if (recognized.length !== 1) {
    throw new Error(`GDPS_LIVE_SEMANTIC_FACT_AMBIGUOUS_${evidence.recipeId}_${recognized.length}`);
  }
  const semanticCode = recognized[0]!;
  const status = semanticMappings[semanticCode]!;
  return {
    ...status,
    semanticCode,
    currentness: status.normalizedStatus === "DATA_GAP" ? "NOT_AVAILABLE" :
      status.normalizedStatus === "STALE" ? "CHANGED" : null
  };
}

function deriveGatewayTransportFacts(executions: readonly PersistedExecutionFact[]): GatewayTransportFacts {
  const gdpsRows = executions.filter((entry) => entry.operationKey !== null &&
    /^(?:geo-|elevation\.|terrain\.|landcover\.|hydrology\.|surface-material\.|obstacle\.|traversability\.)/u
      .test(entry.operationKey));
  const directProviderCalls = gdpsRows.filter((entry) => entry.executionKind !== "WORLD_QUERY_NODE" ||
    (entry.gatewayQueryIdHash === null && entry.gatewayJobIdHash === null)).length;
  const mockTransportUsed = executions.some((entry) =>
    !["DIRECT_OPERATION", "WORLD_QUERY", "WORLD_QUERY_NODE"].includes(entry.executionKind));
  return {
    gatewayOnly: directProviderCalls === 0 && !mockTransportUsed,
    directProviderCalls,
    mockTransportUsed,
    persistedGdpsExecutionCount: gdpsRows.length
  };
}

function liveCaseObservation(
  caseId: GdpsV021Case["id"],
  evidence: CaseEvidence,
  runtime: GdpsRuntimeExpectations,
  operationLockHash: GdpsV021Sha256Digest
): Omit<GdpsV021CaseObservation, "evidenceArtifactIds" | "evidenceHashes"> {
  const sources = evidence.gdpsSourceEvidence;
  const status = deriveLiveSemanticFacts(evidence);
  const selectedPatterns = evidence.selectedRecipeIds.filter((entry) => runtime.operationByPattern.has(entry));
  const source = sources[0];
  const providerBinding = providerRecipeBindingForCase(caseId, evidence.operationKeys, sources, runtime);
  const planHash = evidence.planHashes.length === 1 ? evidence.planHashes[0]! : null;
  const sourceRecipeLockHash = source ? optionalDigest(source["recipeLockHash"], "GDPS_SOURCE_RECIPE_LOCK_HASH_INVALID") : null;
  const sourceDescriptorHash = source ? optionalDigest(source["descriptorHash"], "GDPS_SOURCE_DESCRIPTOR_HASH_INVALID") : null;
  const product = source && typeof source["productId"] === "string" ? productEvidenceFromSource(source) : null;
  const truncated = evidence.truncated || product?.truncated === true;
  return {
    caseId,
    terminalStatus: evidence.terminalStatus as GdpsV021TerminalStatus,
    normalizedStatus: status.normalizedStatus,
    sourceCondition: status.sourceCondition,
    semanticPattern: selectedPatterns.length === 1 ? selectedPatterns[0]! : null,
    descriptorId: source && typeof source["descriptorId"] === "string" ? source["descriptorId"] : null,
    operationKeys: [...evidence.operationKeys],
    gdpsOperationKeys: evidence.operationKeys.filter((key) => runtime.gdpsOperationKeys.has(key)),
    semanticCode: status.semanticCode,
    recipeId: source && typeof source["recipeId"] === "string" ? source["recipeId"] : null,
    recipeLockHash: sourceRecipeLockHash,
    descriptorHash: sourceDescriptorHash,
    planHash,
    operationLockHash: providerBinding ? operationLockHash : null,
    productEvidence: product,
    currentness: status.currentness,
    truncated,
    falseFactInferred: evidence.resultFacts.evidenceItemCount > 0 && product === null,
    originalQueryExecuted: evidence.executionEvidence.some((entry) => entry.operationKey !== null &&
      runtime.gdpsOperationKeys.has(entry.operationKey)),
    driverAttestation: null
  };
}

function optionalJsonObject(value: unknown, code: string): JsonObject | null {
  if (value === null || value === undefined) return null;
  return structuredClone(object(value, code));
}

function nonNegativeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(code);
  return value as number;
}

function parsePersistedStageFacts(value: unknown, caseId: string): PersistedStageFact[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`GDPS_DRIVER_PERSISTED_STAGE_FACTS_MISSING_${caseId}`);
  }
  const facts = value.map((raw, index): PersistedStageFact => {
    const entry = object(raw, `GDPS_DRIVER_STAGE_FACT_INVALID_${caseId}_${index}`);
    const inputHash = optionalDigest(entry["inputHash"], `GDPS_DRIVER_STAGE_INPUT_HASH_INVALID_${caseId}_${index}`);
    const outputHash = optionalDigest(entry["outputHash"], `GDPS_DRIVER_STAGE_OUTPUT_HASH_INVALID_${caseId}_${index}`);
    const recordHash = optionalDigest(entry["recordHash"], `GDPS_DRIVER_STAGE_RECORD_HASH_INVALID_${caseId}_${index}`);
    if (!inputHash || !recordHash) throw new Error(`GDPS_DRIVER_STAGE_HASH_MISSING_${caseId}_${index}`);
    const errorCode = entry["errorCode"] === null
      ? null
      : string(entry["errorCode"], `GDPS_DRIVER_STAGE_ERROR_CODE_INVALID_${caseId}_${index}`);
    return {
      stage: string(entry["stage"], `GDPS_DRIVER_STAGE_NAME_INVALID_${caseId}_${index}`),
      status: string(entry["status"], `GDPS_DRIVER_STAGE_STATUS_INVALID_${caseId}_${index}`),
      inputHash,
      outputHash,
      recordHash,
      errorCode,
      elapsedMs: nonNegativeInteger(entry["elapsedMs"], `GDPS_DRIVER_STAGE_ELAPSED_INVALID_${caseId}_${index}`)
    };
  });
  if (new Set(facts.map((entry) => entry.recordHash)).size !== facts.length) {
    throw new Error(`GDPS_DRIVER_STAGE_RECORD_HASH_DUPLICATE_${caseId}`);
  }
  return facts;
}

function parsePersistedExecutionFacts(value: unknown, caseId: string): PersistedExecutionFact[] {
  if (!Array.isArray(value)) throw new Error(`GDPS_DRIVER_PERSISTED_EXECUTION_FACTS_MISSING_${caseId}`);
  const executionKinds = new Set(["DIRECT_OPERATION", "WORLD_QUERY", "WORLD_QUERY_NODE"]);
  return value.map((raw, index): PersistedExecutionFact => {
    const entry = object(raw, `GDPS_DRIVER_EXECUTION_FACT_INVALID_${caseId}_${index}`);
    const executionKind = string(entry["executionKind"], `GDPS_DRIVER_EXECUTION_KIND_INVALID_${caseId}_${index}`);
    if (!executionKinds.has(executionKind)) {
      throw new Error(`GDPS_DRIVER_EXECUTION_KIND_INVALID_${caseId}_${index}`);
    }
    const requestHash = optionalDigest(entry["requestHash"], `GDPS_DRIVER_REQUEST_HASH_INVALID_${caseId}_${index}`);
    if (!requestHash) throw new Error(`GDPS_DRIVER_REQUEST_HASH_MISSING_${caseId}_${index}`);
    const operationKey = entry["operationKey"] === null
      ? null
      : string(entry["operationKey"], `GDPS_DRIVER_OPERATION_KEY_INVALID_${caseId}_${index}`);
    if (operationKey !== null && !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+@1\.0$/u.test(operationKey)) {
      throw new Error(`GDPS_DRIVER_OPERATION_KEY_INVALID_${caseId}_${index}`);
    }
    return {
      executionKind: executionKind as PersistedExecutionFact["executionKind"],
      operationKey,
      requestHash,
      resultHash: optionalDigest(entry["resultHash"], `GDPS_DRIVER_RESULT_HASH_INVALID_${caseId}_${index}`),
      normalizedStatus: string(entry["normalizedStatus"], `GDPS_DRIVER_NORMALIZED_STATUS_INVALID_${caseId}_${index}`),
      upstreamStatus: string(entry["upstreamStatus"], `GDPS_DRIVER_UPSTREAM_STATUS_INVALID_${caseId}_${index}`),
      gatewayQueryIdHash: optionalDigest(entry["gatewayQueryIdHash"], `GDPS_DRIVER_QUERY_ID_HASH_INVALID_${caseId}_${index}`),
      gatewayJobIdHash: optionalDigest(entry["gatewayJobIdHash"], `GDPS_DRIVER_JOB_ID_HASH_INVALID_${caseId}_${index}`),
      dataSnapshot: optionalJsonObject(entry["dataSnapshot"], `GDPS_DRIVER_DATA_SNAPSHOT_INVALID_${caseId}_${index}`),
      computeSnapshot: optionalJsonObject(entry["computeSnapshot"], `GDPS_DRIVER_COMPUTE_SNAPSHOT_INVALID_${caseId}_${index}`),
      snapshotAdherence: optionalJsonObject(entry["snapshotAdherence"], `GDPS_DRIVER_SNAPSHOT_ADHERENCE_INVALID_${caseId}_${index}`),
      receiptIds: entry["receiptIds"] === undefined ? [] : uniqueStringArray(entry["receiptIds"],
        `GDPS_DRIVER_RECEIPT_IDS_INVALID_${caseId}_${index}`),
      evidenceIds: entry["evidenceIds"] === undefined ? [] : uniqueStringArray(entry["evidenceIds"],
        `GDPS_DRIVER_EVIDENCE_IDS_INVALID_${caseId}_${index}`)
    };
  });
}

function parseDriverAssertionFacts(value: unknown, caseId: string, label: string): JsonObject[] {
  if (!Array.isArray(value)) throw new Error(`GDPS_DRIVER_${label}_FACTS_MISSING_${caseId}`);
  return value.map((raw, index) => {
    const fact = object(raw, `GDPS_DRIVER_${label}_FACT_INVALID_${caseId}_${index}`);
    const factHash = optionalDigest(fact["factHash"], `GDPS_DRIVER_${label}_FACT_HASH_INVALID_${caseId}_${index}`);
    if (!factHash || canonicalSha256(fact["fact"]) !== factHash) {
      throw new Error(`GDPS_DRIVER_${label}_FACT_BINDING_INVALID_${caseId}_${index}`);
    }
    return structuredClone(fact);
  });
}

function validateDriverProviderRecipeBinding(
  facts: JsonObject,
  caseId: string,
  runtime: GdpsRuntimeExpectations
): ProviderRecipeBinding {
  const raw = object(facts["providerRecipeBinding"], `GDPS_PROVIDER_RECIPE_CASE_BINDING_MISSING_${caseId}`);
  const operationKey = string(raw["operationKey"], `GDPS_PROVIDER_RECIPE_OPERATION_MISSING_${caseId}`);
  const expected = runtime.providerRecipeByOperation.get(operationKey);
  if (!expected) throw new Error(`GDPS_PROVIDER_RECIPE_CASE_BINDING_MISSING_${caseId}_${operationKey}`);
  const actual: ProviderRecipeBinding = {
    recipeId: string(raw["providerRecipeId"], `GDPS_PROVIDER_RECIPE_ID_MISSING_${caseId}`),
    operationKey,
    inputSchemaHash: optionalDigest(raw["inputSchemaHash"], `GDPS_PROVIDER_RECIPE_INPUT_HASH_INVALID_${caseId}`)!,
    outputSchemaHash: optionalDigest(raw["outputSchemaHash"], `GDPS_PROVIDER_RECIPE_OUTPUT_HASH_INVALID_${caseId}`)!,
    semanticProfileHash: optionalDigest(raw["semanticProfileHash"], `GDPS_PROVIDER_RECIPE_PROFILE_HASH_INVALID_${caseId}`)!
  };
  const providerRecipeLockHash = optionalDigest(raw["providerRecipeLockHash"],
    `GDPS_PROVIDER_RECIPE_LOCK_HASH_INVALID_${caseId}`);
  if (!actual.inputSchemaHash || !actual.outputSchemaHash || !actual.semanticProfileHash ||
      providerRecipeLockHash !== runtime.providerRecipeLockHash || actual.recipeId !== expected.recipeId ||
      actual.inputSchemaHash !== expected.inputSchemaHash || actual.outputSchemaHash !== expected.outputSchemaHash ||
      actual.semanticProfileHash !== expected.semanticProfileHash) {
    throw new Error(`GDPS_PROVIDER_RECIPE_HASH_TUPLE_DRIFT_${caseId}_${operationKey}`);
  }
  return actual;
}

function driverCaseObservation(
  expected: GdpsV021Case,
  postflight: VerifiedGdpsV021RuntimePreflight,
  runtime: GdpsRuntimeExpectations
): {
  readonly observation: Omit<GdpsV021CaseObservation, "evidenceArtifactIds" | "evidenceHashes">;
  readonly executions: readonly PersistedExecutionFact[];
  readonly providerRecipeBinding: ProviderRecipeBinding;
} {
  const driver = postflight.driverManifest.drivers.find((entry) => entry.caseId === expected.id);
  if (!driver) throw new Error(`GDPS_DRIVER_POSTFLIGHT_MISSING_${expected.id}`);
  const bytes = readFileSync(resolve(process.cwd(), driver.evidencePath));
  if (sha256(bytes) !== driver.evidenceHash) throw new Error(`GDPS_DRIVER_EVIDENCE_TOCTOU_${expected.id}`);
  let document: JsonObject;
  try {
    document = object(JSON.parse(bytes.toString("utf8")) as unknown, `GDPS_DRIVER_EVIDENCE_INVALID_${expected.id}`);
  } catch {
    throw new Error(`GDPS_DRIVER_EVIDENCE_INVALID_${expected.id}`);
  }
  if (document["schemaVersion"] !== "wsgs-gdps-driver-evidence/2.0" || document["caseId"] !== expected.id ||
      document["gatewayOnly"] !== true || document["directProviderCalls"] !== 0 || document["mockTransportUsed"] !== false) {
    throw new Error(`GDPS_DRIVER_EVIDENCE_CONTRACT_${expected.id}`);
  }
  if (document["gateRunId"] !== gateRunId) throw new Error(`GDPS_DRIVER_GATE_RUN_ID_MISMATCH_${expected.id}`);
  if (document["runtimeIdentityHash"] !== gdpsRuntimeIdentityHash) {
    throw new Error(`GDPS_DRIVER_RUNTIME_IDENTITY_MISMATCH_${expected.id}`);
  }
  const facts = object(document["persistedFacts"], `GDPS_DRIVER_PERSISTED_FACTS_MISSING_${expected.id}`);
  if (facts["gateRunId"] !== gateRunId || facts["runtimeIdentityHash"] !== gdpsRuntimeIdentityHash) {
    throw new Error(`GDPS_DRIVER_PERSISTED_RUN_BINDING_MISMATCH_${expected.id}`);
  }
  for (const [field, code] of [
    ["groundingIdHash", "GROUNDING_ID_HASH"],
    ["requestHash", "REQUEST_HASH"],
    ["sourceTextHash", "SOURCE_TEXT_HASH"],
    ["requestRowHash", "REQUEST_ROW_HASH"],
    ["resultHash", "RESULT_HASH"],
    ["resultDocumentHash", "RESULT_DOCUMENT_HASH"]
  ] as const) {
    if (!optionalDigest(facts[field], `GDPS_DRIVER_${code}_INVALID_${expected.id}`)) {
      throw new Error(`GDPS_DRIVER_${code}_MISSING_${expected.id}`);
    }
  }
  const executions = parsePersistedExecutionFacts(facts["executionEvidence"], expected.id);
  const stageEvidence = parsePersistedStageFacts(facts["stageEvidence"], expected.id);
  if (!stageEvidence.some((entry) => entry.stage === "RESULT_PERSIST" && entry.status === "COMPLETED")) {
    throw new Error(`GDPS_DRIVER_PERSISTED_TRACE_INCOMPLETE_${expected.id}`);
  }
  const operationKeys = executions.flatMap((entry) => entry.operationKey ? [entry.operationKey] : []);
  const falseFacts = parseDriverAssertionFacts(facts["falseFactAssertions"], expected.id, "FALSE_ASSERTION");
  const originalQueries = parseDriverAssertionFacts(facts["originalQueryExecutions"], expected.id, "ORIGINAL_QUERY");
  const providerRecipeBinding = validateDriverProviderRecipeBinding(facts, expected.id, runtime);
  const rawProduct = facts["productEvidence"];
  const product = rawProduct === null || rawProduct === undefined
    ? null
    : productEvidenceFromSource(object(rawProduct, `GDPS_DRIVER_PRODUCT_INVALID_${expected.id}`),
      optionalDigest(facts["currentContentHash"], `GDPS_DRIVER_CURRENT_HASH_INVALID_${expected.id}`) ?? undefined);
  const terminalStatus = string(facts["terminalStatus"], `GDPS_DRIVER_TERMINAL_STATUS_MISSING_${expected.id}`);
  const persistedNormalizedStatus = string(facts["normalizedStatus"],
    `GDPS_DRIVER_NORMALIZED_STATUS_MISSING_${expected.id}`);
  const currentnessStatuses = ["STALE", "SNAPSHOT_MISMATCHED"] as const;
  if (expected.id === "NEG-CURRENTNESS" &&
      !currentnessStatuses.includes(persistedNormalizedStatus as (typeof currentnessStatuses)[number])) {
    throw new Error(`GDPS_DRIVER_CURRENTNESS_STATUS_INVALID_${persistedNormalizedStatus}`);
  }
  const normalizedStatus = expected.id === "NEG-CURRENTNESS" ? "STALE" : persistedNormalizedStatus;
  const jobStatus = string(facts["jobStatus"], `GDPS_DRIVER_JOB_STATUS_MISSING_${expected.id}`);
  if (jobStatus !== terminalStatus) throw new Error(`GDPS_DRIVER_JOB_RESULT_STATUS_DRIFT_${expected.id}`);
  if (!["COMPLETED", "PARTIAL", "UNRESOLVED", "AMBIGUOUS", "FAILED"].includes(terminalStatus)) {
    throw new Error(`GDPS_DRIVER_TERMINAL_STATUS_INVALID_${expected.id}`);
  }
  if (!["CURRENT", "PARTIAL", "DATA_GAP", "CAPABILITY_GAP", "INDETERMINATE", "AMBIGUOUS", "FAILED",
    "STALE"].includes(normalizedStatus)) {
    throw new Error(`GDPS_DRIVER_NORMALIZED_STATUS_INVALID_${expected.id}`);
  }
  if (facts["truncated"] !== true && facts["truncated"] !== false) {
    throw new Error(`GDPS_DRIVER_TRUNCATED_FACT_INVALID_${expected.id}`);
  }
  const rawCurrentness = facts["currentness"];
  if (rawCurrentness !== null && rawCurrentness !== undefined &&
      !["CURRENT", "CHANGED", "NOT_AVAILABLE"].includes(String(rawCurrentness))) {
    throw new Error(`GDPS_DRIVER_CURRENTNESS_INVALID_${expected.id}`);
  }
  const observation = {
    caseId: expected.id,
    terminalStatus: terminalStatus as GdpsV021TerminalStatus,
    normalizedStatus: normalizedStatus as GdpsV021NormalizedStatus,
    sourceCondition: typeof facts["sourceCondition"] === "string" ? facts["sourceCondition"] : null,
    semanticPattern: typeof facts["semanticPattern"] === "string" ? facts["semanticPattern"] : null,
    descriptorId: typeof facts["descriptorId"] === "string" ? facts["descriptorId"] : null,
    operationKeys,
    gdpsOperationKeys: operationKeys.filter((key) => key.startsWith("geo-") ||
      /^(?:elevation|terrain|landcover|hydrology|surface-material|obstacle|traversability)\./u.test(key)),
    semanticCode: typeof facts["semanticCode"] === "string" ? facts["semanticCode"] : null,
    recipeId: typeof facts["recipeId"] === "string" ? facts["recipeId"] : null,
    recipeLockHash: optionalDigest(facts["recipeLockHash"], `GDPS_DRIVER_RECIPE_HASH_INVALID_${expected.id}`),
    descriptorHash: optionalDigest(facts["descriptorHash"], `GDPS_DRIVER_DESCRIPTOR_HASH_INVALID_${expected.id}`),
    planHash: optionalDigest(facts["planHash"], `GDPS_DRIVER_PLAN_HASH_INVALID_${expected.id}`),
    operationLockHash: optionalDigest(facts["operationLockHash"], `GDPS_DRIVER_OPERATION_LOCK_HASH_INVALID_${expected.id}`),
    productEvidence: product,
    currentness: typeof rawCurrentness === "string"
      ? rawCurrentness as "CURRENT" | "CHANGED" | "NOT_AVAILABLE" : null,
    truncated: facts["truncated"],
    falseFactInferred: falseFacts.length > 0,
    originalQueryExecuted: originalQueries.length > 0,
    driverAttestation: driver.attestation as GdpsV021DriverAttestation
  };
  const transport = deriveGatewayTransportFacts(executions);
  if (operationKeys.some((key) => runtime.gdpsOperationKeys.has(key)) && !transport.gatewayOnly) {
    throw new Error(`GDPS_DRIVER_DIRECT_TRANSPORT_${expected.id}`);
  }
  const precondition = driver.attestation.precondition as JsonObject;
  if (precondition["gateRunId"] !== gateRunId || precondition["runtimeIdentityHash"] !== gdpsRuntimeIdentityHash) {
    throw new Error(`GDPS_DRIVER_ATTESTATION_RUN_BINDING_MISMATCH_${expected.id}`);
  }
  return { observation, executions, providerRecipeBinding };
}

function buildGdpsV021PolicyReport(input: {
  readonly postflight: VerifiedGdpsV021RuntimePreflight;
  readonly liveCases: readonly CaseEvidence[];
  readonly runtime: GdpsRuntimeExpectations;
  readonly apiLiveStatus: number;
  readonly apiReadyStatus: number;
  readonly crossScopeStatus: number;
}): {
  readonly report: ReturnType<typeof evaluateGdpsV021Report>;
  readonly core: { readonly path: string; readonly hash: GdpsV021Sha256Digest; readonly byteLength: number };
  readonly final: { readonly path: string; readonly hash: GdpsV021Sha256Digest; readonly byteLength: number };
  readonly validationReceiptHash: GdpsV021Sha256Digest | null;
} {
  const corpus = parseGdpsV021Corpus(readFileSync(required("WSGS_GDPS_E2E_CORPUS_FILE")));
  const postflight = input.postflight;
  if (!gdpsRuntimeIdentityHash || postflight.driverManifest.runtimeIdentityHash !== gdpsRuntimeIdentityHash) {
    throw new Error("GDPS_DRIVER_RUNTIME_IDENTITY_MISMATCH");
  }
  const liveById = new Map(input.liveCases.map((entry) => [entry.recipeId, entry]));
  const derivedById = new Map<GdpsV021Case["id"],
    Omit<GdpsV021CaseObservation, "evidenceArtifactIds" | "evidenceHashes">>();
  const driverExecutions: PersistedExecutionFact[] = [];
  const driverProviderBindings = new Map<GdpsV021Case["id"], ProviderRecipeBinding>();

  for (const expected of corpus.cases) {
    const driverCase = gdpsV021DriverCaseIds.has(expected.id);
    const evidence = driverCase ? undefined : liveById.get(expected.id);
    if (!driverCase && !evidence) throw new Error(`GDPS_LIVE_CASE_EVIDENCE_MISSING_${expected.id}`);
    if (driverCase) {
      const driver = driverCaseObservation(expected, postflight, input.runtime);
      derivedById.set(expected.id, driver.observation);
      driverExecutions.push(...driver.executions);
      driverProviderBindings.set(expected.id, driver.providerRecipeBinding);
    } else {
      derivedById.set(expected.id,
        liveCaseObservation(expected.id, evidence!, input.runtime, postflight.operationLock.hash));
    }
  }
  const transport = deriveGatewayTransportFacts([
    ...input.liveCases.flatMap((entry) => entry.executionEvidence),
    ...driverExecutions
  ]);
  if (!transport.gatewayOnly || transport.directProviderCalls !== 0 || transport.mockTransportUsed ||
      transport.persistedGdpsExecutionCount === 0) {
    throw new Error("GDPS_REAL_GATEWAY_TRANSPORT_NOT_PROVEN");
  }
  const sourceIdentity = reportSourceIdentity(postflight, gdpsRuntimeIdentityHash);
  const execution = reportExecution(transport);
  const driverRecords = verifiedDriverArtifactRecords(postflight, execution);
  const artifacts: GdpsV021EvidenceArtifactRecord[] = [...driverRecords];
  const observations: GdpsV021CaseObservation[] = [];

  for (const expected of corpus.cases) {
    const driverCase = gdpsV021DriverCaseIds.has(expected.id);
    const evidence = driverCase ? undefined : liveById.get(expected.id);
    const derived = derivedById.get(expected.id);
    if (!derived) throw new Error(`GDPS_DERIVED_OBSERVATION_MISSING_${expected.id}`);
    const providerRecipeBinding = driverCase
      ? driverProviderBindings.get(expected.id) ?? null
      : providerRecipeBindingForCase(expected.id, evidence!.operationKeys, evidence!.gdpsSourceEvidence, input.runtime);
    const artifactId = `case-${expected.id.toLowerCase()}-evidence`;
    const artifact = writeAtomicJsonArtifact(
      artifactId,
      expected.id,
      "CASE_EVIDENCE",
      resolve(evidenceDirectory, "case-evidence", `${expected.id}.json`),
      {
        schemaVersion: "wsgs-gdps-runtime-case-evidence/1.0",
        caseId: expected.id,
         sourceCommit: postflight.sourceCommit,
         gateRunId,
         operationLockHash: postflight.operationLock.hash,
         provenanceHash: postflight.operationLock.provenanceHash,
         runtimeIdentityHash: gdpsRuntimeIdentityHash,
         providerRecipeBinding: providerRecipeBinding ? {
           ...providerRecipeBinding,
           providerRecipeLockHash: input.runtime.providerRecipeLockHash
         } : null,
        ...(driverCase ? {
          evidenceOrigin: "VERIFIED_ISOLATED_DRIVER_POSTFLIGHT",
          driverEvidenceHash: postflight.driverManifest.drivers.find((entry) => entry.caseId === expected.id)?.evidenceHash,
          derivedObservation: structuredClone(derived)
        } : {
          evidenceOrigin: "REAL_POSTGRES_PIPELINE_FACTS",
          groundingIdHash: evidence!.groundingIdHash,
          requestIdHash: evidence!.requestIdHash,
          requestHash: evidence!.requestHash,
          sourceTextHash: evidence!.sourceTextHash,
          requestRowHash: evidence!.requestRowHash,
          resultHash: evidence!.resultHash,
          terminalStatus: evidence!.terminalStatus,
          resultFacts: evidence!.resultFacts,
          runtimeBinding: evidence!.runtimeBinding,
          stageEvidence: evidence!.stageEvidence,
          planHashes: evidence!.planHashes,
          executionEvidence: evidence!.executionEvidence,
          gdpsSourceEvidence: evidence!.gdpsSourceEvidence,
          derivedObservation: structuredClone(derived)
        })
      }
    );
    artifacts.push(artifactRecord(artifact, postflight, gdpsRuntimeIdentityHash, execution));
    observations.push({
      ...derived,
      evidenceArtifactIds: [artifact.id],
      evidenceHashes: [artifact.hash]
    });
  }

  const ledger = (): GdpsV021EvidenceLedger => ({
    schemaVersion: "wsgs-gdps-byte-evidence-ledger/1.0",
    operationLockHash: postflight.operationLock.hash,
    artifacts: [...artifacts]
  });
  const context = (): GdpsV021EvidenceBindingContext => ({ sourceIdentity, execution, evidenceLedger: ledger() });
  const evaluations = new Map(corpus.cases.map((expected) => {
    const observation = observations.find((entry) => entry.caseId === expected.id) ?? null;
    return [expected.id, evaluateGdpsV021Case(expected, observation, context())] as const;
  }));
  const passed = (...caseIds: string[]): boolean => caseIds.every((caseId) => evaluations.get(caseId)?.status === "PASS");
  const positiveIds = corpus.cases.filter((entry) => entry.caseType === "POSITIVE").map((entry) => entry.id);
  const livePositiveEvidence = positiveIds.map((id) => liveById.get(id)).filter((entry): entry is CaseEvidence => Boolean(entry));
  const exactFacts: Record<GdpsV021QualificationId, { readonly pass: boolean; readonly facts: JsonObject }> = {
    "W44-X01": {
      pass: postflight.provider.providerVersion === "0.2.1" && postflight.operationLock.previewOperationKeys.length === 30,
      facts: { providerId: postflight.provider.providerId, providerVersion: postflight.provider.providerVersion,
        capabilityCount: postflight.provider.capabilityCount, availablePreviewOperations: postflight.operationLock.previewOperationKeys.length }
    },
    "W44-X02": {
      pass: postflight.operationLock.stableOperationKeys.length === 12 &&
        livePositiveEvidence.length === positiveIds.length &&
        livePositiveEvidence.every((entry) => entry.gatewayQueryIdHashes.length > 0),
      facts: { stableOperations: postflight.operationLock.stableOperationKeys.length,
        previewOperations: postflight.operationLock.previewOperationKeys.length,
        gatewayExecutedPositiveCases: livePositiveEvidence.filter((entry) => entry.gatewayQueryIdHashes.length > 0).length,
        operationLockHash: postflight.operationLock.hash }
    },
    "W44-X03": {
      pass: input.apiLiveStatus === 200 && input.apiReadyStatus === 200 &&
        input.liveCases.every((entry) => entry.completedStages.length > 0),
      facts: { apiLiveHttpStatus: input.apiLiveStatus, apiReadyHttpStatus: input.apiReadyStatus,
        workerExecutedCases: input.liveCases.filter((entry) => entry.completedStages.length > 0).length }
    },
    "W44-X04": {
      pass: execution.gatewayOnly && execution.directProviderCalls === 0 && execution.mockTransportUsed === false &&
        transport.persistedGdpsExecutionCount > 0 &&
        postflight.driverManifest.drivers.every((entry) => entry.attestation.mockTransportUsed === false &&
        entry.attestation.realExternalDependencies === true && entry.attestation.requiredExecutionPath ===
        "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY"),
      facts: { gatewayOnly: execution.gatewayOnly, directProviderCalls: execution.directProviderCalls,
        mockTransportUsed: execution.mockTransportUsed,
        persistedGdpsExecutionCount: transport.persistedGdpsExecutionCount,
        verifiedDriverAttestations: postflight.driverManifest.drivers.length }
    },
    "W44-X05": { pass: passed("E2E-SLOPE-POINT", "E2E-SLOPE-RANGE"),
      facts: { cases: ["E2E-SLOPE-POINT", "E2E-SLOPE-RANGE"] } },
    "W44-X06": { pass: passed("E2E-FLOOD-HIGH", "E2E-LAND-COVER"),
      facts: { cases: ["E2E-FLOOD-HIGH", "E2E-LAND-COVER"] } },
    "W44-X07": { pass: passed("E2E-DRAINAGE-NEARBY", "NEG-TRUNCATED"),
      facts: { cases: ["E2E-DRAINAGE-NEARBY", "NEG-TRUNCATED"] } },
    "W44-X08": { pass: passed("E2E-HIGH-GROUND", "E2E-WETLAND", "E2E-TRAVERSABILITY-EXPLAIN"),
      facts: { cases: ["E2E-HIGH-GROUND", "E2E-WETLAND", "E2E-TRAVERSABILITY-EXPLAIN"] } },
    "W44-X09": { pass: passed("E2E-EXPLICIT-PRODUCT"), facts: { case: "E2E-EXPLICIT-PRODUCT" } },
    "W44-X10": { pass: input.crossScopeStatus === 404, facts: { crossScopeHttpStatus: input.crossScopeStatus } },
    "W44-X11": {
      pass: positiveIds.every((id) => Boolean(observations.find((entry) => entry.caseId === id)?.productEvidence)),
      facts: { positiveProductEvidenceCount: positiveIds.filter((id) =>
        Boolean(observations.find((entry) => entry.caseId === id)?.productEvidence)).length,
      requiredPositiveProductEvidenceCount: positiveIds.length }
    },
    "W44-X12": { pass: false, facts: { pending: "REPORT_CORE_VALIDATION_RECEIPT" } }
  };
  const qualifications: GdpsV021QualificationEvidence[] = [];
  for (const qualificationId of Object.keys(exactFacts).filter((id) => id !== "W44-X12") as GdpsV021QualificationId[]) {
    const assertion = exactFacts[qualificationId]!;
    const artifact = writeAtomicJsonArtifact(
      `qualification-${qualificationId.toLowerCase()}-evidence`,
      qualificationId,
      "QUALIFICATION_EVIDENCE",
      resolve(evidenceDirectory, "qualification-evidence", `${qualificationId}.json`),
      { schemaVersion: "wsgs-gdps-qualification-evidence/1.0", qualificationId,
        assertionStatus: assertion.pass ? "PASS" : "FAIL", facts: assertion.facts,
        sourceCommit: postflight.sourceCommit, operationLockHash: postflight.operationLock.hash }
    );
    artifacts.push(artifactRecord(artifact, postflight, gdpsRuntimeIdentityHash, execution));
    qualifications.push({ qualificationId, status: assertion.pass ? "PASS" : "FAIL",
      evidenceArtifactIds: [artifact.id], evidenceHashes: [artifact.hash],
      detail: assertion.pass ? "Derived from exact runtime facts." : "Exact runtime facts did not satisfy the qualification." });
  }
  const generatedAt = new Date().toISOString();
  const reportInput = (qualificationEvidence: readonly GdpsV021QualificationEvidence[]): GdpsV021ReportInput => ({
    generatedAt,
    sourceIdentity,
    execution,
    evidenceLedger: ledger(),
    observations,
    qualifications: qualificationEvidence
  });
  const coreReport = evaluateGdpsV021Report(corpus, reportInput(qualifications));
  const schemaBinding = validateGdpsV021ReportContract(coreReport);
  const core = writeAtomicJsonFile(resolve(evidenceDirectory, "e2e-report.core.json"), coreReport);
  const coreReadyForReceipt = coreReport.summary.passedCases === 16 && coreReport.summary.failedCases === 0 &&
    coreReport.summary.blockedCases === 0 && coreReport.summary.notRunCases === 0 &&
    coreReport.summary.passedQualifications === 11 && coreReport.policyErrors.length === 0 &&
    coreReport.qualifications.find((entry) => entry.qualificationId === "W44-X12")?.status === "NOT_RUN";
  if (!coreReadyForReceipt) {
    const final = writeAtomicJsonFile(resolve(evidenceDirectory, "e2e-report.pending.json"), coreReport);
    return { report: coreReport, core, final, validationReceiptHash: null };
  }
  const receiptArtifact = writeAtomicJsonArtifact(
    "qualification-w44-x12-evidence",
    "W44-X12",
    "QUALIFICATION_EVIDENCE",
    resolve(evidenceDirectory, "qualification-evidence", "W44-X12.json"),
    {
      schemaVersion: "wsgs-gdps-e2e-validation-receipt/1.0",
      qualificationId: "W44-X12",
      reportCore: core,
      schema: schemaBinding,
      validation: { jsonSchema: "PASS", policyCases: 16, policyQualificationsBeforeReceipt: 11 },
      sourceCommit: postflight.sourceCommit,
      operationLockHash: postflight.operationLock.hash
    }
  );
  artifacts.push(artifactRecord(receiptArtifact, postflight, gdpsRuntimeIdentityHash, execution));
  const x12: GdpsV021QualificationEvidence = {
    qualificationId: "W44-X12",
    status: "PASS",
    evidenceArtifactIds: [receiptArtifact.id],
    evidenceHashes: [receiptArtifact.hash],
    detail: "Machine validation receipt binds the report core and exact report schema bytes."
  };
  const finalReport = evaluateGdpsV021Report(corpus, reportInput([...qualifications, x12]));
  validateGdpsV021ReportContract(finalReport);
  const final = writeAtomicJsonFile(resolve(evidenceDirectory, "e2e-report.pending.json"), finalReport);
  return { report: finalReport, core, final, validationReceiptHash: receiptArtifact.hash };
}

function buildGdpsV021DiagnosticEvaluation(input: {
  readonly expected: GdpsV021Case;
  readonly liveEvidence?: CaseEvidence;
  readonly postflight?: VerifiedGdpsV021RuntimePreflight;
  readonly runtime: GdpsRuntimeExpectations;
}): {
  readonly evaluation: ReturnType<typeof evaluateGdpsV021Case>;
  readonly artifact: { readonly path: string; readonly hash: GdpsV021Sha256Digest; readonly byteLength: number };
  readonly execution: GdpsV021ReportInput["execution"];
} {
  const authority = input.postflight ?? gdpsRuntimeAuthorityPreflight;
  if (!authority || !gdpsRuntimeIdentityHash) throw new Error("GDPS_DIAGNOSTIC_RUNTIME_IDENTITY_MISSING");
  const driverCase = gdpsV021DriverCaseIds.has(input.expected.id);
  if (driverCase !== Boolean(input.postflight)) throw new Error("GDPS_DIAGNOSTIC_DRIVER_POSTFLIGHT_MISMATCH");
  if (!driverCase && !input.liveEvidence) throw new Error("GDPS_DIAGNOSTIC_LIVE_EVIDENCE_MISSING");
  const driver = driverCase
    ? driverCaseObservation(input.expected, input.postflight!, input.runtime)
    : undefined;
  const derived = driver?.observation ?? liveCaseObservation(
    input.expected.id,
    input.liveEvidence!,
    input.runtime,
    authority.operationLock.hash
  );
  const executions = driver?.executions ?? input.liveEvidence!.executionEvidence;
  const transport = deriveGatewayTransportFacts(executions);
  if (!transport.gatewayOnly || transport.directProviderCalls !== 0 || transport.mockTransportUsed) {
    throw new Error(`GDPS_DIAGNOSTIC_TRANSPORT_NOT_PROVEN_${input.expected.id}`);
  }
  const execution = reportExecution(transport);
  const sourceIdentity = reportSourceIdentity(authority, gdpsRuntimeIdentityHash);
  const driverRecords = input.postflight ? verifiedDriverArtifactRecords(input.postflight, execution) : [];
  const providerRecipeBinding = driver?.providerRecipeBinding ?? providerRecipeBindingForCase(
    input.expected.id,
    input.liveEvidence!.operationKeys,
    input.liveEvidence!.gdpsSourceEvidence,
    input.runtime
  );
  const caseArtifact = writeAtomicJsonArtifact(
    `case-${input.expected.id.toLowerCase()}-evidence`,
    input.expected.id,
    "CASE_EVIDENCE",
    resolve(evidenceDirectory, "diagnostics", gateRunId, input.expected.id, "case-evidence.json"),
    {
      schemaVersion: "wsgs-gdps-runtime-case-evidence/1.0",
      evidenceOrigin: driverCase ? "VERIFIED_ISOLATED_DRIVER_POSTFLIGHT" : "REAL_POSTGRES_PIPELINE_FACTS",
      caseId: input.expected.id,
      gateRunId,
      sourceCommit: authority.sourceCommit,
      operationLockHash: authority.operationLock.hash,
      provenanceHash: authority.operationLock.provenanceHash,
      runtimeIdentityHash: gdpsRuntimeIdentityHash,
      providerRecipeBinding: providerRecipeBinding ? {
        ...providerRecipeBinding,
        providerRecipeLockHash: input.runtime.providerRecipeLockHash
      } : null,
      persistedFacts: driverCase ? {
        driverEvidenceHash: input.postflight!.driverManifest.drivers.find((entry) =>
          entry.caseId === input.expected.id)?.evidenceHash
      } : {
        groundingIdHash: input.liveEvidence!.groundingIdHash,
        requestIdHash: input.liveEvidence!.requestIdHash,
        requestHash: input.liveEvidence!.requestHash,
        sourceTextHash: input.liveEvidence!.sourceTextHash,
        requestRowHash: input.liveEvidence!.requestRowHash,
        resultHash: input.liveEvidence!.resultHash,
        resultFacts: input.liveEvidence!.resultFacts,
        runtimeBinding: input.liveEvidence!.runtimeBinding,
        stageEvidence: input.liveEvidence!.stageEvidence,
        executionEvidence: input.liveEvidence!.executionEvidence,
        gdpsSourceEvidence: input.liveEvidence!.gdpsSourceEvidence
      },
      derivedObservation: structuredClone(derived)
    }
  );
  const artifacts = [
    ...driverRecords,
    artifactRecord(caseArtifact, authority, gdpsRuntimeIdentityHash, execution)
  ];
  const context: GdpsV021EvidenceBindingContext = {
    sourceIdentity,
    execution,
    evidenceLedger: {
      schemaVersion: "wsgs-gdps-byte-evidence-ledger/1.0",
      operationLockHash: authority.operationLock.hash,
      artifacts
    }
  };
  const observation: GdpsV021CaseObservation = {
    ...derived,
    evidenceArtifactIds: [caseArtifact.id],
    evidenceHashes: [caseArtifact.hash]
  };
  const evaluation = evaluateGdpsV021Case(input.expected, observation, context);
  const artifact = writeAtomicJsonFile(
    resolve(evidenceDirectory, "diagnostics", gateRunId, input.expected.id, "typed-case-evaluation.json"),
    {
      schemaVersion: "wsgs-gdps-typed-case-diagnostic/1.0",
      gateRunId,
      runtimeIdentityHash: gdpsRuntimeIdentityHash,
      sourceCommit: authority.sourceCommit,
      evaluation
    }
  );
  if (evaluation.status !== "PASS") {
    throw new Error(`GDPS_V021_DIAGNOSTIC_POLICY_${evaluation.status}_${input.expected.id}`);
  }
  return { evaluation, artifact, execution };
}

function assertCompleteTypedCaseSummary(
  report: ReturnType<typeof evaluateGdpsV021Report>
): readonly ReturnType<typeof evaluateGdpsV021Case>[] {
  if (report.cases.length !== frozenGdpsV021CaseIds.length || report.summary.totalCases !== 16) {
    throw new Error("GDPS_TYPED_CASE_SUMMARY_COUNT_MISMATCH");
  }
  if (report.cases.some((entry, index) => entry.caseId !== frozenGdpsV021CaseIds[index])) {
    throw new Error("GDPS_TYPED_CASE_SUMMARY_ID_MISMATCH");
  }
  const counts = {
    PASS: report.cases.filter((entry) => entry.status === "PASS").length,
    FAIL: report.cases.filter((entry) => entry.status === "FAIL").length,
    BLOCKED: report.cases.filter((entry) => entry.status === "BLOCKED").length,
    NOT_RUN: report.cases.filter((entry) => entry.status === "NOT_RUN").length
  };
  if (report.summary.passedCases !== counts.PASS || report.summary.failedCases !== counts.FAIL ||
      report.summary.blockedCases !== counts.BLOCKED || report.summary.notRunCases !== counts.NOT_RUN ||
      Object.values(counts).reduce((sum, count) => sum + count, 0) !== 16) {
    throw new Error("GDPS_TYPED_CASE_SUMMARY_STATUS_MISMATCH");
  }
  return report.cases;
}

const pool = new Pool({ connectionString: databaseUrl, max: 12, application_name: "wsgs-development-closure-gate" });
let resources: ReturnType<typeof createProductionBackendFromEnvironment> | undefined;
let app: Awaited<ReturnType<typeof createGroundingApi>> | undefined;
let focusedModelServer: Server | undefined;
let exitCode = 1;

async function startFocusedSchemaModel(): Promise<void> {
  if (!focusedGowmR1R5) return;
  const outputText = JSON.stringify({
    schemaVersion: "1.0",
    mentions: [],
    spatialExpressions: [],
    relationExpressions: [],
    temporalConstraints: [],
    aggregationExpressions: [],
    rankingExpressions: []
  });
  focusedModelServer = createServer((request, response) => {
    request.resume();
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "NOT_FOUND" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ output_text: outputText }));
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    focusedModelServer!.once("error", rejectListen);
    focusedModelServer!.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = focusedModelServer.address();
  if (!address || typeof address === "string") throw new Error("FOCUSED_MODEL_ADDRESS_INVALID");
  process.env["WSGS_MODEL_POLICY"] = "MODEL_REQUIRED";
  process.env["MODEL_BASE_URL"] = `http://127.0.0.1:${address.port}/v1`;
  process.env["MODEL_API_KEY"] = "focused-local-schema-model";
  process.env["MODEL_NAME"] = "focused-local-schema-model";
}

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
  priorGroundings: JsonObject[] = [],
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
      priorGroundings,
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

function uniqueDigests(values: readonly GdpsV021Sha256Digest[]): GdpsV021Sha256Digest[] {
  return [...new Set(values)].sort() as GdpsV021Sha256Digest[];
}

function referenceKeyDigest(value: unknown): GdpsV021Sha256Digest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const key = value as JsonObject;
  if (key["namespace"] !== "gowm" || typeof key["kind"] !== "string" ||
      typeof key["id"] !== "string" || typeof key["version"] !== "string") return null;
  return canonicalSha256({
    namespace: key["namespace"],
    kind: key["kind"],
    id: key["id"],
    version: key["version"]
  }) as GdpsV021Sha256Digest;
}

function referenceProductKeyHashes(value: unknown): GdpsV021Sha256Digest[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const products = (value as JsonObject)["referenceProducts"];
  if (!Array.isArray(products)) return [];
  return uniqueDigests(products.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const digest = referenceKeyDigest((entry as JsonObject)["referenceKey"]);
    return digest ? [digest] : [];
  }));
}

function compiledWorldQueryFacts(value: unknown): {
  anchorReferenceKeyHashes: GdpsV021Sha256Digest[];
  operationKeys: string[];
  dataflowBindings: string[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { anchorReferenceKeyHashes: [], operationKeys: [], dataflowBindings: [] };
  }
  const compiled = (value as JsonObject)["compiled"];
  if (!Array.isArray(compiled)) return { anchorReferenceKeyHashes: [], operationKeys: [], dataflowBindings: [] };
  const anchors: GdpsV021Sha256Digest[] = [];
  const operationKeys = new Set<string>();
  const dataflowBindings = new Set<string>();
  for (const rawEntry of compiled) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
    const entry = rawEntry as JsonObject;
    if (entry["status"] !== "COMPILED") continue;
    const submission = entry["submission"];
    if (!submission || typeof submission !== "object" || Array.isArray(submission)) continue;
    const submissionObject = submission as JsonObject;
    const parameters = submissionObject["parameters"];
    if (parameters && typeof parameters === "object" && !Array.isArray(parameters)) {
      const operationInput = (parameters as JsonObject)["operationInput"];
      if (operationInput && typeof operationInput === "object" && !Array.isArray(operationInput)) {
        const context = (operationInput as JsonObject)["context"];
        const anchorKeys = context && typeof context === "object" && !Array.isArray(context)
          ? (context as JsonObject)["anchorReferenceKeys"] : undefined;
        if (Array.isArray(anchorKeys)) {
          for (const anchor of anchorKeys) {
            const digest = referenceKeyDigest(anchor);
            if (digest) anchors.push(digest);
          }
        }
      }
    }
    const plan = submissionObject["plan"];
    const nodes = plan && typeof plan === "object" && !Array.isArray(plan)
      ? (plan as JsonObject)["nodes"] : undefined;
    if (!Array.isArray(nodes)) continue;
    const byNodeId = new Map<string, string>();
    for (const rawNode of nodes) {
      if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) continue;
      const node = rawNode as JsonObject;
      const operation = node["operation"];
      if (typeof node["nodeId"] !== "string" || !operation || typeof operation !== "object" || Array.isArray(operation)) continue;
      const operationId = (operation as JsonObject)["operationId"];
      const operationVersion = (operation as JsonObject)["operationVersion"];
      if (typeof operationId !== "string" || typeof operationVersion !== "string") continue;
      const operationKey = `${operationId}@${operationVersion}`;
      operationKeys.add(operationKey);
      byNodeId.set(node["nodeId"], operationKey);
    }
    for (const rawNode of nodes) {
      if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) continue;
      const node = rawNode as JsonObject;
      const targetOperation = typeof node["nodeId"] === "string" ? byNodeId.get(node["nodeId"]) : undefined;
      const inputs = node["inputs"];
      if (!targetOperation || !inputs || typeof inputs !== "object" || Array.isArray(inputs)) continue;
      for (const [inputName, rawBinding] of Object.entries(inputs as JsonObject)) {
        if (!rawBinding || typeof rawBinding !== "object" || Array.isArray(rawBinding)) continue;
        const binding = rawBinding as JsonObject;
        if (binding["kind"] !== "NODE_OUTPUT" || typeof binding["nodeId"] !== "string" ||
            typeof binding["outputPort"] !== "string") continue;
        const sourceOperation = byNodeId.get(binding["nodeId"]);
        if (!sourceOperation) continue;
        dataflowBindings.add(`${sourceOperation}:${binding["outputPort"]}->${targetOperation}:${inputName}`);
      }
    }
  }
  return {
    anchorReferenceKeyHashes: uniqueDigests(anchors),
    operationKeys: [...operationKeys].sort(),
    dataflowBindings: [...dataflowBindings].sort()
  };
}

function compositionProof(
  checkpointState: Readonly<Record<string, unknown>>
): CaseEvidence["compositionProof"] {
  const resolved = checkpointState["REFERENCE_RESOLVE"];
  const validated = checkpointState["REFERENCE_VALIDATE"];
  const compiled = compiledWorldQueryFacts(checkpointState["WORLD_QUERY_COMPILE"]);
  const resolvedReferenceKeyHashes = referenceProductKeyHashes(resolved);
  const validatedReferenceKeyHashes = referenceProductKeyHashes(validated);
  const validationProducts = validated && typeof validated === "object" && !Array.isArray(validated) &&
    Array.isArray((validated as JsonObject)["referenceProducts"])
    ? (validated as JsonObject)["referenceProducts"] as unknown[] : [];
  const validationResults = validated && typeof validated === "object" && !Array.isArray(validated) &&
    Array.isArray((validated as JsonObject)["validationResults"])
    ? (validated as JsonObject)["validationResults"] as unknown[] : [];
  const validationResultRecords = validationResults.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const value = entry as JsonObject;
    const digest = referenceKeyDigest(value["referenceKey"]);
    return digest && typeof value["status"] === "string" && typeof value["revalidationRequired"] === "boolean"
      ? [{ digest, status: value["status"], revalidationRequired: value["revalidationRequired"] }]
      : [];
  });
  const validationProductRecords = validationProducts.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const product = entry as JsonObject;
    const digest = referenceKeyDigest(product["referenceKey"]);
    const summary = product["safeSummary"];
    return digest && summary && typeof summary === "object" && !Array.isArray(summary)
      ? [{ digest, product, summary: summary as JsonObject }]
      : [];
  });
  const validationResultReferenceKeyHashes = uniqueDigests(validationResultRecords.map((entry) => entry.digest));
  const validationProductReferenceKeyHashes = uniqueDigests(validationProductRecords.map((entry) => entry.digest));
  const resultByDigest = new Map(validationResultRecords.map((entry) => [entry.digest, entry]));
  const expectedValidityTtlMs = Number(process.env["WSGS_REFERENCE_VALIDATION_TTL_MS"] ?? "60000");
  const directValidationProof = validationResults.length > 0 &&
    validationResultRecords.length === validationResults.length &&
    validationProductRecords.length === validationProducts.length &&
    validationResultReferenceKeyHashes.length === validationResults.length &&
    validationProductReferenceKeyHashes.length === validationProducts.length &&
    JSON.stringify(validationResultReferenceKeyHashes) === JSON.stringify(validationProductReferenceKeyHashes) &&
    JSON.stringify(validationProductReferenceKeyHashes) === JSON.stringify(validatedReferenceKeyHashes) &&
    validationProductRecords.every(({ digest, product, summary }) => {
      const result = resultByDigest.get(digest);
      return result !== undefined && product["sourceOperation"] === "VALIDATE_REFERENCES" &&
        summary["validationSourceOperation"] === "reference.validate" &&
        summary["validationStatus"] === result.status &&
        summary["validitySemantics"] === "GOWM_REFERENCE_VALIDATE_BOUNDED_LEASE";
    });
  const validationLeaseUsable = directValidationProof && validationProductRecords.every(({ digest, product, summary }) => {
    const result = resultByDigest.get(digest);
    const evaluatedAt = typeof summary["validationEvaluatedAt"] === "string"
      ? Date.parse(summary["validationEvaluatedAt"]) : Number.NaN;
    const validUntil = typeof product["validUntil"] === "string"
      ? Date.parse(product["validUntil"]) : Number.NaN;
    return result?.status === "VALID" && result.revalidationRequired === false &&
      product["revalidationRequired"] === false && Number.isFinite(evaluatedAt) &&
      Number.isFinite(validUntil) && Number.isSafeInteger(expectedValidityTtlMs) &&
      expectedValidityTtlMs >= 1_000 && expectedValidityTtlMs <= 300_000 &&
      validUntil - evaluatedAt === expectedValidityTtlMs;
  });
  return {
    resolveReferenceKeyHashes: resolvedReferenceKeyHashes,
    validatedReferenceKeyHashes,
    worldQueryAnchorReferenceKeyHashes: compiled.anchorReferenceKeyHashes,
    directOperationKeys: [
      ...(resolvedReferenceKeyHashes.length > 0 ? ["reference.resolve@1.0"] : []),
      ...(directValidationProof ? ["reference.validate@1.0"] : [])
    ],
    directValidationProof,
    planOperationKeys: compiled.operationKeys,
    planDataflowBindings: compiled.dataflowBindings,
    validationLeaseUsable
  };
}

async function collect(
  groundingId: string,
  requestHash: `sha256:${string}`,
  requestBodyDocument: JsonObject,
  terminalResult: JsonObject
): Promise<CaseEvidence> {
  const request = await pool.query<{
    request_id: string;
    payload_hash: GdpsV021Sha256Digest;
    source_text_sha256: GdpsV021Sha256Digest;
    request_metadata: unknown;
    gowm_operation_lock_hash: GdpsV021Sha256Digest | null;
  }>(
    `SELECT request_id, payload_hash, source_text_sha256, request_metadata, gowm_operation_lock_hash
       FROM wsgs.grounding_request WHERE grounding_id = $1`,
    [groundingId]
  );
  const requestRow = request.rows[0];
  const requestSource = object(requestBodyDocument["source"], "GDPS_LIVE_REQUEST_SOURCE_INVALID");
  const expectedSourceTextHash = sha256(string(requestSource["originalText"], "GDPS_LIVE_SOURCE_TEXT_MISSING"));
  if (!requestRow || canonicalSha256(requestBodyDocument) !== requestHash || requestRow.payload_hash !== requestHash ||
      requestRow.source_text_sha256 !== expectedSourceTextHash || requestRow.request_id !== requestBodyDocument["requestId"]) {
    throw new Error("GDPS_LIVE_REQUEST_PERSISTENCE_BINDING_MISMATCH");
  }
  if (!requestRow.request_id.endsWith(`-${gateRunId}`)) throw new Error("GDPS_LIVE_REQUEST_RUN_ID_MISMATCH");
  const job = await pool.query<{ job_id: string; run_fingerprint: string | null }>(
    `SELECT job.job_id, checkpoint.run_fingerprint
       FROM wsgs.grounding_job AS job
       LEFT JOIN wsgs.pipeline_checkpoint AS checkpoint ON checkpoint.job_id = job.job_id
      WHERE job.grounding_id = $1`,
    [groundingId]
  );
  if (!job.rows[0]) throw new Error("GROUNDING_JOB_MISSING");
  const events = await pool.query<{
    stage: string; status: string; input_hash: `sha256:${string}`;
    output_hash: `sha256:${string}` | null; record_hash: `sha256:${string}`;
    error_code: string | null; elapsed_ms: number;
  }>(
    `SELECT stage, status, input_hash, output_hash, record_hash, error_code, elapsed_ms
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
    execution_kind: string;
    operation_id: string | null; operation_version: string | null;
    request_hash: `sha256:${string}`; result_hash: `sha256:${string}` | null;
    normalized_status: string; upstream_status: string;
    gateway_query_id: string | null; gateway_job_id: string | null;
    data_snapshot: unknown; compute_snapshot: unknown; snapshot_adherence: unknown;
    receipt_ids: unknown; evidence_ids: unknown;
  }>(
    `SELECT execution_kind, operation_id, operation_version, request_hash, result_hash,
            normalized_status, upstream_status, gateway_query_id, gateway_job_id,
            data_snapshot, compute_snapshot, snapshot_adherence, receipt_ids, evidence_ids
       FROM wsgs.gowm_execution WHERE grounding_id = $1 ORDER BY created_at, execution_id`,
    [groundingId]
  );
  const model = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM wsgs.model_receipt WHERE grounding_id = $1",
    [groundingId]
  );
  const result = await pool.query<{
    status: string;
    result_hash: GdpsV021Sha256Digest;
    result_bytes: Uint8Array;
  }>(
    "SELECT status, result_hash, result_bytes FROM wsgs.grounding_result WHERE grounding_id = $1",
    [groundingId]
  );
  const resultRow = result.rows[0];
  if (!resultRow) throw new Error("GROUNDING_RESULT_MISSING");
  let persistedResult: JsonObject;
  try {
    if (!(resultRow.result_bytes instanceof Uint8Array)) throw new Error("RESULT_BYTES_INVALID");
    persistedResult = object(JSON.parse(Buffer.from(resultRow.result_bytes).toString("utf8")) as unknown,
      "GDPS_LIVE_PERSISTED_RESULT_INVALID");
  } catch {
    throw new Error("GDPS_LIVE_PERSISTED_RESULT_INVALID");
  }
  if (persistedResult["status"] !== resultRow.status || persistedResult["resultHash"] !== resultRow.result_hash ||
      terminalResult["status"] !== resultRow.status || terminalResult["resultHash"] !== resultRow.result_hash) {
    throw new Error("GDPS_LIVE_RESULT_PERSISTENCE_BINDING_MISMATCH");
  }
  const snapshots = await pool.query<{
    operation_lock_hash: GdpsV021Sha256Digest | null;
    gdps_recipe_lock_hash: GdpsV021Sha256Digest | null;
    gdps_capability_snapshot_hash: GdpsV021Sha256Digest | null;
  }>(
    `SELECT operation_lock_hash, gdps_recipe_lock_hash, gdps_capability_snapshot_hash
       FROM wsgs.capability_snapshot WHERE grounding_id = $1 ORDER BY created_at DESC`,
    [groundingId]
  );
  if (snapshots.rows.length !== 1) throw new Error("GDPS_LIVE_CAPABILITY_SNAPSHOT_NOT_EXACT");
  const runtimeSnapshot = snapshots.rows[0]!;
  if (requestRow.gowm_operation_lock_hash !== runtimeSnapshot.operation_lock_hash) {
    throw new Error("GDPS_LIVE_REQUEST_RUNTIME_LOCK_DRIFT");
  }
  const persistedProducts = await pool.query<{
    product_kind: string;
    payload_hash: GdpsV021Sha256Digest;
  }>(
    `SELECT product_kind, payload_hash
       FROM wsgs.result_product WHERE grounding_id = $1 ORDER BY product_kind, product_id`,
    [groundingId]
  );
  const gdpsSourceEvidence = executions.rows.flatMap((row) => {
    if (!row.data_snapshot || typeof row.data_snapshot !== "object" || Array.isArray(row.data_snapshot)) return [];
    const source = (row.data_snapshot as JsonObject)["gdpsSourceEvidence"];
    return source && typeof source === "object" && !Array.isArray(source)
      ? [structuredClone(source as JsonObject)]
      : [];
  });
  const sourceNamed = collectNamedStrings(gdpsSourceEvidence, new Set(["productId", "contentHash"]));
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
  const capabilityGaps = Array.isArray(persistedResult["capabilityGaps"])
    ? persistedResult["capabilityGaps"]
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
  const serializedResult = JSON.stringify(persistedResult);
  const count = (name: string): number => Array.isArray(persistedResult[name]) ? persistedResult[name].length : 0;
  const executionEvidence = executions.rows.map((row, index): PersistedExecutionFact => {
    if (!["DIRECT_OPERATION", "WORLD_QUERY", "WORLD_QUERY_NODE"].includes(row.execution_kind)) {
      throw new Error(`GDPS_LIVE_EXECUTION_KIND_INVALID_${index}`);
    }
    return {
      executionKind: row.execution_kind as PersistedExecutionFact["executionKind"],
      operationKey: row.operation_id && row.operation_version ? `${row.operation_id}@${row.operation_version}` : null,
      requestHash: row.request_hash,
      resultHash: row.result_hash,
      normalizedStatus: row.normalized_status,
      upstreamStatus: row.upstream_status,
      gatewayQueryIdHash: row.gateway_query_id ? safeId(row.gateway_query_id) : null,
      gatewayJobIdHash: row.gateway_job_id ? safeId(row.gateway_job_id) : null,
      dataSnapshot: row.data_snapshot && typeof row.data_snapshot === "object" && !Array.isArray(row.data_snapshot)
        ? structuredClone(row.data_snapshot as JsonObject) : null,
      computeSnapshot: row.compute_snapshot && typeof row.compute_snapshot === "object" && !Array.isArray(row.compute_snapshot)
        ? structuredClone(row.compute_snapshot as JsonObject) : null,
      snapshotAdherence: row.snapshot_adherence && typeof row.snapshot_adherence === "object" && !Array.isArray(row.snapshot_adherence)
        ? structuredClone(row.snapshot_adherence as JsonObject) : null,
      receiptIds: Array.isArray(row.receipt_ids)
        ? row.receipt_ids.filter((entry): entry is string => typeof entry === "string") : [],
      evidenceIds: Array.isArray(row.evidence_ids)
        ? row.evidence_ids.filter((entry): entry is string => typeof entry === "string") : []
    };
  });
  const evidence: CaseEvidence = {
    recipeId: "",
    requestHash,
    sourceTextHash: requestRow.source_text_sha256,
    requestRowHash: canonicalSha256({
      payloadHash: requestRow.payload_hash,
      sourceTextHash: requestRow.source_text_sha256,
      requestMetadataHash: canonicalSha256(requestRow.request_metadata && typeof requestRow.request_metadata === "object"
        ? requestRow.request_metadata : {}),
      operationLockHash: requestRow.gowm_operation_lock_hash
    }) as GdpsV021Sha256Digest,
    requestIdHash: safeId(requestRow.request_id),
    gateRunId,
    groundingIdHash: safeId(groundingId),
    terminalStatus: resultRow.status,
    resultHash: resultRow.result_hash,
    stageHashes: terminalEvents.map((event) => event.output_hash ?? event.record_hash),
    stageEvidence: terminalEvents.map((event) => ({
      stage: event.stage,
      status: event.status,
      inputHash: event.input_hash,
      outputHash: event.output_hash,
      recordHash: event.record_hash,
      errorCode: event.error_code,
      elapsedMs: event.elapsed_ms
    })),
    completedStages: terminalEvents.filter((event) => ["COMPLETED", "PARTIAL"].includes(event.status)).map((event) => event.stage),
    planHashes: queries.rows.map((row) => row.plan_hash),
    upstreamResultHashes: queries.rows.flatMap((row) => row.upstream_result_hash ? [row.upstream_result_hash] : []),
    modelReceiptCount: Number(model.rows[0]?.count ?? 0),
    worldQueryCount: queries.rowCount ?? 0,
    spatialExecutionCount: executions.rows.filter((row) => row.operation_id?.startsWith("spatial.")).length,
    operationKeys: executions.rows.flatMap((row) =>
      row.operation_id && row.operation_version ? [`${row.operation_id}@${row.operation_version}`] : []),
    operationStatuses: executions.rows.flatMap((row) => row.operation_id && row.operation_version ? [{
      operationKey: `${row.operation_id}@${row.operation_version}`,
      status: row.normalized_status,
      ...(row.result_hash ? { resultHash: row.result_hash } : {})
    }] : []),
    normalizedStatuses: [...new Set(executions.rows.map((row) => row.normalized_status))],
    gatewayQueryIdHashes: [...new Set(executions.rows.flatMap((row) => row.gateway_query_id ? [safeId(row.gateway_query_id)] : []))],
    gatewayJobIdHashes: [...new Set(executions.rows.flatMap((row) => row.gateway_job_id ? [safeId(row.gateway_job_id)] : []))],
    productIds: [...(sourceNamed.get("productId") ?? [])].sort(),
    contentHashes: [...(sourceNamed.get("contentHash") ?? [])].filter((entry) => /^sha256:[0-9a-f]{64}$/u.test(entry)).sort(),
    selectedRecipeIds: [...new Set(selectedRecipeIds)].sort(),
    descriptorIds: [...(checkpointNamed.get("descriptorId") ?? [])].sort(),
    semanticCodes: [...new Set(semanticCodes)].sort(),
    gdpsSourceEvidence,
    executionEvidence,
    runtimeBinding: {
      operationLockHash: runtimeSnapshot.operation_lock_hash,
      recipeLockHash: runtimeSnapshot.gdps_recipe_lock_hash,
      consumerSnapshotHash: runtimeSnapshot.gdps_capability_snapshot_hash
    },
    resultFacts: {
      terminalStatus: resultRow.status,
      resultHash: resultRow.result_hash,
      resultDocumentHash: canonicalSha256(persistedResult) as GdpsV021Sha256Digest,
      referenceProductCount: count("referenceProducts"),
      evidenceItemCount: count("evidenceItems"),
      ambiguityCount: count("ambiguities"),
      unresolvedMentionCount: count("unresolvedMentions"),
      capabilityGapCount: count("capabilityGaps"),
      persistedProductKinds: persistedProducts.rows.map((entry) => entry.product_kind),
      persistedProductHashes: persistedProducts.rows.map((entry) => entry.payload_hash)
    },
    truncated: serializedResult.includes('"truncated":true'),
    totalStageElapsedMs: terminalEvents.reduce((sum, event) => sum + event.elapsed_ms, 0),
    compositionProof: compositionProof(checkpoint.state)
  };
  privateCaseRuntime.set(evidence, { terminalResult: persistedResult, checkpointState: checkpoint.state });
  return evidence;
}

function validateLivePersistedFacts(evidence: CaseEvidence): void {
  if (evidence.gateRunId !== gateRunId) throw new Error(`GDPS_LIVE_REQUEST_RUN_ID_MISMATCH_${evidence.recipeId}`);
  if (!/^sha256:[0-9a-f]{64}$/u.test(evidence.requestIdHash) ||
      !/^sha256:[0-9a-f]{64}$/u.test(evidence.requestHash) ||
      !/^sha256:[0-9a-f]{64}$/u.test(evidence.sourceTextHash) ||
      !/^sha256:[0-9a-f]{64}$/u.test(evidence.requestRowHash) ||
      !/^sha256:[0-9a-f]{64}$/u.test(evidence.resultFacts.resultDocumentHash) ||
      !/^sha256:[0-9a-f]{64}$/u.test(evidence.resultHash)) {
    throw new Error(`GDPS_LIVE_IDENTITY_HASH_INVALID_${evidence.recipeId}`);
  }
  for (const [value, code] of [
    [evidence.runtimeBinding.operationLockHash, "OPERATION_LOCK"],
    [evidence.runtimeBinding.recipeLockHash, "RECIPE_LOCK"],
    [evidence.runtimeBinding.consumerSnapshotHash, "CONSUMER_SNAPSHOT"]
  ] as const) {
    if (value !== null && !/^sha256:[0-9a-f]{64}$/u.test(value)) {
      throw new Error(`GDPS_LIVE_${code}_HASH_INVALID_${evidence.recipeId}`);
    }
  }
  const stages = parsePersistedStageFacts(evidence.stageEvidence, evidence.recipeId);
  const executions = parsePersistedExecutionFacts(evidence.executionEvidence, evidence.recipeId);
  if (stages.length !== evidence.stageEvidence.length || executions.length !== evidence.executionEvidence.length ||
      evidence.resultFacts.terminalStatus !== evidence.terminalStatus || evidence.resultFacts.resultHash !== evidence.resultHash) {
    throw new Error(`GDPS_LIVE_PERSISTED_FACT_BINDING_MISMATCH_${evidence.recipeId}`);
  }
  for (const value of [
    evidence.resultFacts.referenceProductCount,
    evidence.resultFacts.evidenceItemCount,
    evidence.resultFacts.ambiguityCount,
    evidence.resultFacts.unresolvedMentionCount,
    evidence.resultFacts.capabilityGapCount
  ]) {
    nonNegativeInteger(value, `GDPS_LIVE_RESULT_FACT_COUNT_INVALID_${evidence.recipeId}`);
  }
  if (evidence.resultFacts.persistedProductHashes.some((hash) => !/^sha256:[0-9a-f]{64}$/u.test(hash)) ||
      evidence.resultFacts.persistedProductKinds.some((kind) => !kind)) {
    throw new Error(`GDPS_LIVE_RESULT_PRODUCT_FACT_INVALID_${evidence.recipeId}`);
  }
}

async function withTemporaryProcessEnvironment<T>(
  overrides: Readonly<Record<string, string>>,
  action: () => Promise<T>
): Promise<T> {
  const prior = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(overrides)) {
    prior.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    return await action();
  } finally {
    for (const [name, value] of prior) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function verifyIsolatedVariantAttestation(
  sidecar: GdpsDriverSidecarContract,
  path: string,
  expectedHash: GdpsV021Sha256Digest,
  caseId: string
): void {
  const absolutePath = resolve(process.cwd(), path);
  if (!pathInside(sidecar.attestationDirectory, absolutePath)) {
    throw new Error(`GDPS_DRIVER_VARIANT_ATTESTATION_PATH_INVALID_${caseId}`);
  }
  const bytes = readFileSync(absolutePath);
  if (sha256(bytes) !== expectedHash) throw new Error(`GDPS_DRIVER_VARIANT_ATTESTATION_HASH_DRIFT_${caseId}`);
  const document = object(JSON.parse(bytes.toString("utf8")) as unknown,
    `GDPS_DRIVER_VARIANT_ATTESTATION_INVALID_${caseId}`);
  if (document["gateRunId"] !== gateRunId || document["caseId"] !== caseId ||
      document["gatewayRuntimeHash"] !== sidecar.gatewayRuntimeHash ||
      document["gdpsProviderRuntimeHash"] !== sidecar.gdpsProviderRuntimeHash) {
    throw new Error(`GDPS_DRIVER_VARIANT_ATTESTATION_BINDING_INVALID_${caseId}`);
  }
}

async function executorForGdpsDriverVariant(
  request: GdpsV021NaturalLanguageDriverRequest,
  productionExecutor: PipelineStageExecutor,
  sidecar: GdpsDriverSidecarContract | undefined
): Promise<PipelineStageExecutor> {
  const variant = request.runtimeVariant;
  if (variant.kind === "BASELINE_READ_ONLY") return productionExecutor;
  if (variant.kind === "ISOLATED_RECIPE_LOCK_DRIFT") {
    if (request.caseId !== "NEG-RECIPE-DRIFT" || request.phase !== "PRIMARY") {
      throw new Error("GDPS_DRIVER_RECIPE_DRIFT_VARIANT_CONTEXT_INVALID");
    }
    return await withTemporaryProcessEnvironment({
      WSGS_GDPS_RECIPE_LOCK_FILE: variant.recipeLockPath,
      WSGS_GDPS_RECIPE_LOCK_SHA256: variant.recipeLockHash,
      WSGS_GDPS_CONSUMER_SNAPSHOT_FILE: variant.consumerSnapshotPath,
      WSGS_GDPS_CONSUMER_SNAPSHOT_SHA256: variant.consumerSnapshotHash
    }, async () => await createPipelineStageExecutor({ pool }));
  }
  if (!sidecar) {
    throw new GdpsV021DriverExternalContractError(request.caseId,
      "ISOLATED_DRIVER_SIDECAR_UNAVAILABLE",
      "A hash-bound, run-scoped isolated GDPS/Gateway sidecar contract is required for this driver variant.");
  }
  let attestationPath: string;
  let attestationHash: GdpsV021Sha256Digest;
  if (variant.kind === "ISOLATED_UPSTREAM_TRUNCATED") {
    if (request.caseId !== "NEG-TRUNCATED" || request.phase !== "PRIMARY") {
      throw new Error("GDPS_DRIVER_TRUNCATED_VARIANT_CONTEXT_INVALID");
    }
    attestationPath = variant.runtimeAttestationPath;
    attestationHash = variant.runtimeAttestationHash;
  } else if (variant.kind === "ISOLATED_CURRENTNESS_EPOCH_A") {
    if (request.caseId !== "NEG-CURRENTNESS" || request.phase !== "CURRENTNESS_SEED") {
      throw new Error("GDPS_DRIVER_CURRENTNESS_A_VARIANT_CONTEXT_INVALID");
    }
    attestationPath = variant.runtimeAttestationPath;
    attestationHash = variant.runtimeAttestationHash;
  } else {
    if (request.caseId !== "NEG-CURRENTNESS" || request.phase !== "CURRENTNESS_REPLAY") {
      throw new Error("GDPS_DRIVER_CURRENTNESS_B_VARIANT_CONTEXT_INVALID");
    }
    attestationPath = variant.barrierAttestationPath;
    attestationHash = variant.barrierAttestationHash;
  }
  verifyIsolatedVariantAttestation(sidecar, attestationPath, attestationHash, request.caseId);
  return await withTemporaryProcessEnvironment({
    GOWM_GATEWAY_BASE_URL: sidecar.isolatedGatewayBaseUrl
  }, async () => await createPipelineStageExecutor({ pool }));
}

async function submitAndRunGdpsDriver(
  baseUrl: string,
  executor: PipelineStageExecutor,
  request: GdpsV021NaturalLanguageDriverRequest
): Promise<{ readonly groundingId: string; readonly requestHash: GdpsV021Sha256Digest }> {
  const requestHash = canonicalSha256(request.body) as GdpsV021Sha256Digest;
  const submitted = await fetchJson(baseUrl, "/v1/groundings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `gdps-driver-${request.caseId.toLowerCase()}-${request.phase.toLowerCase()}-${requestHash.slice(-16)}`
    },
    body: JSON.stringify(request.body)
  });
  if (submitted.status !== 202 || submitted.body["status"] !== "ACCEPTED") {
    throw new Error(`GDPS_DRIVER_PUBLIC_API_SUBMIT_FAILED_${request.caseId}_${request.phase}_${submitted.status}`);
  }
  const groundingId = string(submitted.body["groundingId"], "GDPS_DRIVER_GROUNDING_ID_MISSING");
  const outcome = await worker(executor,
    `gdps-driver-${request.caseId.toLowerCase()}-${request.phase.toLowerCase()}`).runOnce();
  if (outcome.kind !== "SUCCEEDED") {
    throw new Error(`GDPS_DRIVER_WORKER_${request.caseId}_${request.phase}_${outcome.kind}`);
  }
  // The adapter intentionally returns no status, stage, product, or execution
  // assertion. The orchestrator derives all such facts from PostgreSQL.
  return { groundingId, requestHash };
}

async function submitAndRunGdpsW43(
  baseUrl: string,
  executor: PipelineStageExecutor,
  request: GdpsV021W43ExecutionRequest
): Promise<{ readonly groundingId: string; readonly requestHash: GdpsV021Sha256Digest }> {
  const requestSource = object(request.body["source"], "GDPS_W43_REQUEST_SOURCE_MISSING");
  const requestId = string(request.body["requestId"], "GDPS_W43_REQUEST_ID_MISSING");
  if (requestSource["conversationRef"] !== `${requestId}.barrier.${request.requiredBarrierHash}` ||
      requestSource["messageId"] !== (request.replayBarrierArmHash === undefined
        ? `${requestId}.arm.none` : `${requestId}.arm.${request.replayBarrierArmHash}`)) {
    throw new Error(`GDPS_W43_REQUEST_BARRIER_MARKER_INVALID_${request.scenarioId}_${request.phase}`);
  }
  const requestHash = canonicalSha256(request.body) as GdpsV021Sha256Digest;
  const submitted = await fetchJson(baseUrl, "/v1/groundings", {
    method: "POST",
    headers: { "content-type": "application/json",
      "idempotency-key": `gdps-w43-${request.scenarioId.toLowerCase()}-${request.phase.toLowerCase()}-${requestHash.slice(-16)}` },
    body: JSON.stringify(request.body)
  });
  if (submitted.status !== 202 || submitted.body["status"] !== "ACCEPTED") {
    throw new Error(`GDPS_W43_PUBLIC_API_SUBMIT_FAILED_${request.scenarioId}_${request.phase}_${submitted.status}`);
  }
  const groundingId = string(submitted.body["groundingId"], "GDPS_W43_GROUNDING_ID_MISSING");
  const outcome = await worker(executor, `gdps-w43-${request.scenarioId.toLowerCase()}-${request.phase.toLowerCase()}`).runOnce();
  if (outcome.kind !== "SUCCEEDED") throw new Error(`GDPS_W43_WORKER_${request.scenarioId}_${request.phase}_${outcome.kind}`);
  return { groundingId, requestHash };
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
  const evidence = await collect(groundingId, requestHash, body, terminalResult);
  if (evidence.resultHash !== terminalResult["resultHash"]) throw new Error(`RESULT_HASH_MISMATCH_${recipeId}`);
  const boundEvidence = { ...evidence, recipeId };
  const privateRuntime = privateCaseRuntime.get(evidence);
  if (!privateRuntime) throw new Error(`PRIVATE_CASE_RUNTIME_MISSING_${recipeId}`);
  privateCaseRuntime.set(boundEvidence, privateRuntime);
  validateLivePersistedFacts(boundEvidence);
  return boundEvidence;
}

function knownReferenceFromCase(evidence: CaseEvidence, expectedAlias: string): JsonObject {
  const runtime = privateCaseRuntime.get(evidence);
  const products = runtime?.terminalResult["referenceProducts"];
  if (!Array.isArray(products)) throw new Error(`FOCUSED_REFERENCE_PRODUCTS_MISSING_${evidence.recipeId}`);
  const product = products.find((entry) => entry && typeof entry === "object" && !Array.isArray(entry) &&
    (entry as JsonObject)["displayName"] === expectedAlias) as JsonObject | undefined;
  if (!product || !referenceKeyDigest(product["referenceKey"]) || typeof product["referenceType"] !== "string") {
    throw new Error(`FOCUSED_REFERENCE_PRODUCT_INVALID_${evidence.recipeId}`);
  }
  return {
    alias: expectedAlias,
    referenceKey: structuredClone(product["referenceKey"]),
    referenceType: product["referenceType"],
    sourceMessageId: `message-${evidence.recipeId.toLowerCase()}`
  };
}

class FocusedGowmR1R5Complete extends Error {
  constructor() {
    super("FOCUSED_GOWM_R1_R5_COMPLETE");
  }
}

function exactSingleDigest(...sets: readonly GdpsV021Sha256Digest[][]): GdpsV021Sha256Digest | null {
  if (sets.some((entries) => entries.length !== 1)) return null;
  const first = sets[0]?.[0];
  return first && sets.every((entries) => entries[0] === first) ? first : null;
}

function includesAll(values: readonly string[], requiredValues: readonly string[]): boolean {
  const available = new Set(values);
  return requiredValues.every((value) => available.has(value));
}

async function writeFocusedGowmR1R5Evidence(
  cases: readonly CaseEvidence[],
  localReadiness: { readonly liveHttpStatus: number; readonly readyHttpStatus: number }
): Promise<void> {
  const materializerSchemaPath = resolve(
    process.cwd(),
    "contracts", "upstream", "gowm-0.6.3", "extracted", "package", "bundle", "schemas",
    "gowm-v0.6.2", "semantic-materializer-report.schema.json"
  );
  const materializerSchema = object(
    JSON.parse(readFileSync(materializerSchemaPath, "utf8")) as unknown,
    "FOCUSED_MATERIALIZER_SCHEMA_INVALID"
  );
  const materializerSchemaHash = canonicalSha256(materializerSchema) as GdpsV021Sha256Digest;
  const byId = new Map(cases.map((entry) => [entry.recipeId, entry]));
  if (byId.size !== 5 || ["R1", "R2", "R3", "R4", "R5"].some((caseId) => !byId.has(caseId))) {
    throw new Error("FOCUSED_GOWM_R1_R5_CASE_SET_INVALID");
  }
  const r1 = byId.get("R1")!;
  const r2 = byId.get("R2")!;
  const r3 = byId.get("R3")!;
  const r4 = byId.get("R4")!;
  const r5 = byId.get("R5")!;
  const r1ReferenceHash = exactSingleDigest(
    r1.compositionProof.resolveReferenceKeyHashes,
    r1.compositionProof.validatedReferenceKeyHashes,
    r1.compositionProof.worldQueryAnchorReferenceKeyHashes
  );
  const r3ReferenceHash = exactSingleDigest(
    r3.compositionProof.resolveReferenceKeyHashes,
    r3.compositionProof.validatedReferenceKeyHashes,
    r3.compositionProof.worldQueryAnchorReferenceKeyHashes
  );
  const r4ReferenceHash = exactSingleDigest(
    r4.compositionProof.resolveReferenceKeyHashes,
    r4.compositionProof.validatedReferenceKeyHashes,
    r4.compositionProof.worldQueryAnchorReferenceKeyHashes
  );
  const r5ReferenceHash = exactSingleDigest(r5.compositionProof.validatedReferenceKeyHashes);
  const requirements = new Map<string, { operations: string[]; bindings: string[] }>([
    ["R1", {
      operations: ["reference.resolve@1.0", "reference.validate@1.0", "world.get-current-state@1.0"],
      bindings: ["reference.resolve@1.0:candidateReferenceKey->world.get-current-state@1.0:referenceKey"]
    }],
    ["R2", { operations: ["reference.resolve@1.0", "reference.validate@1.0"], bindings: [] }],
    ["R3", {
      operations: ["reference.resolve@1.0", "reference.validate@1.0", "world.get-geometry@1.0", "spatial.find-in-area@1.0"],
      bindings: [
        "reference.resolve@1.0:candidateReferenceKey->world.get-geometry@1.0:referenceKey",
        "world.get-geometry@1.0:geometry->spatial.find-in-area@1.0:geometry"
      ]
    }],
    ["R4", {
      operations: ["reference.resolve@1.0", "reference.validate@1.0", "world.get-current-state@1.0", "spatial.find-nearby@1.0"],
      bindings: [
        "reference.resolve@1.0:candidateReferenceKey->world.get-current-state@1.0:referenceKey",
        "world.get-current-state@1.0:positionCoordinates->spatial.find-nearby@1.0:location"
      ]
    }],
    ["R5", { operations: ["reference.validate@1.0"], bindings: [] }]
  ]);
  const referenceHashes = new Map<string, GdpsV021Sha256Digest | null>([
    ["R1", r1ReferenceHash], ["R2", null], ["R3", r3ReferenceHash], ["R4", r4ReferenceHash], ["R5", r5ReferenceHash]
  ]);
  const evaluatedCases = [r1, r2, r3, r4, r5].map((entry) => {
    const requirement = requirements.get(entry.recipeId)!;
    const observedOperations = [...new Set([
      ...entry.operationKeys,
      ...entry.compositionProof.directOperationKeys,
      ...entry.compositionProof.planOperationKeys
    ])].sort();
    const ambiguityStopped = entry.recipeId !== "R2" ||
      (entry.terminalStatus === "AMBIGUOUS" && entry.worldQueryCount === 0 && entry.spatialExecutionCount === 0);
    const keyConsumed = entry.recipeId === "R2" ? true : referenceHashes.get(entry.recipeId) !== null;
    const leaseUsable = entry.recipeId === "R2" || entry.compositionProof.validationLeaseUsable;
    const priorResolverOutputConsumed = entry.recipeId !== "R5" ||
      (r1ReferenceHash !== null && r5ReferenceHash === r1ReferenceHash);
    const validationStageEvidence = entry.stageEvidence.filter((stage) => stage.stage === "REFERENCE_VALIDATE");
    const completedValidationStages = validationStageEvidence.filter((stage) => stage.status === "COMPLETED");
    const finalValidationStage = validationStageEvidence.at(-1);
    const directOperationStageEvidenceMet = !requirement.operations.includes("reference.validate@1.0") ||
      (completedValidationStages.length === 1 && finalValidationStage?.status === "COMPLETED" &&
        finalValidationStage.outputHash !== null && finalValidationStage.errorCode === null);
    const terminalStatusMatched = entry.terminalStatus === (entry.recipeId === "R2" ? "AMBIGUOUS" : "COMPLETED");
    const operationRequirementsMet = includesAll(observedOperations, requirement.operations);
    const dataflowRequirementsMet = includesAll(entry.compositionProof.planDataflowBindings, requirement.bindings);
    const pass = terminalStatusMatched && operationRequirementsMet && dataflowRequirementsMet &&
      directOperationStageEvidenceMet &&
      ambiguityStopped && keyConsumed && leaseUsable && priorResolverOutputConsumed;
    return {
      entry,
      requirement,
      observedOperations,
      ambiguityStopped,
      keyConsumed,
      leaseUsable,
      priorResolverOutputConsumed,
      terminalStatusMatched,
      operationRequirementsMet,
      dataflowRequirementsMet,
      directOperationStageEvidenceMet,
      validationStageTerminalCount: validationStageEvidence.length,
      pass
    };
  });
  const failedCases = evaluatedCases.filter((evaluation) => !evaluation.pass);
  if (failedCases.length > 0) {
    const blockedEvidencePayload = {
      schemaVersion: "wsgs-gowm-v0.6.4-r1-r5-smoke-blocked/1.0",
      marker: "WSGS_GOWM_SMOKE_BLOCKED",
      sourceIdentity: {
        kind: "CURRENT_WORKTREE_CANONICAL_TREE_NOT_RELEASE_COMMIT",
        baseCommit: sourceCommit,
        canonicalSourceTreeHash: focusedSourceTreeHash,
        canonicalSourceTreeManifestSchemaVersion: "wsgs-source-tree-manifest/1.0",
        canonicalSourceTreePolicy: "TRACKED_AND_NONIGNORED_FILES_EXCLUDING_DEDICATED_RUNTIME_EVIDENCE",
        gowmRunningSourceRevision: required("GOWM_RUNNING_SOURCE_REVISION")
      },
      summary: {
        total: 5,
        passed: evaluatedCases.length - failedCases.length,
        failed: failedCases.length,
        status: "BLOCKED"
      },
      cases: evaluatedCases.map((evaluation) => ({
        caseId: evaluation.entry.recipeId,
        terminalStatus: evaluation.entry.terminalStatus,
        terminalStatusMatched: evaluation.terminalStatusMatched,
        requiredOperationKeys: evaluation.requirement.operations,
        observedOperationKeys: evaluation.observedOperations,
        observedDirectOperationKeys: evaluation.entry.compositionProof.directOperationKeys,
        operationRequirementsMet: evaluation.operationRequirementsMet,
        requiredDataflowBindings: evaluation.requirement.bindings,
        observedDataflowBindings: evaluation.entry.compositionProof.planDataflowBindings,
        dataflowRequirementsMet: evaluation.dataflowRequirementsMet,
        directOperationStageEvidenceMet: evaluation.directOperationStageEvidenceMet,
        validationStageTerminalCount: evaluation.validationStageTerminalCount,
        directValidationProof: evaluation.entry.compositionProof.directValidationProof,
        resolveReferenceKeyHashCount: evaluation.entry.compositionProof.resolveReferenceKeyHashes.length,
        validatedReferenceKeyHashCount: evaluation.entry.compositionProof.validatedReferenceKeyHashes.length,
        worldQueryAnchorReferenceKeyHashCount: evaluation.entry.compositionProof.worldQueryAnchorReferenceKeyHashes.length,
        resolverOutputConsumedWithoutKeyRewrite: evaluation.keyConsumed,
        priorResolverOutputConsumed: evaluation.priorResolverOutputConsumed,
        validationLeaseUsable: evaluation.leaseUsable,
        ambiguityStoppedBeforeWorldQuery: evaluation.ambiguityStopped,
        status: evaluation.pass ? "PASS" : "BLOCKED"
      })),
      redaction: {
        credentialsIncluded: false,
        rawReferenceIdsIncluded: false,
        rawGroundingIdsIncluded: false,
        internalTopologyIncluded: false
      }
    };
    const blockedReport = {
      schemaVersion: "wsgs-gowm-v0.6.4-r1-r5-smoke-blocked-report/1.0",
      evidencePayload: blockedEvidencePayload,
      evidenceHash: canonicalSha256(blockedEvidencePayload)
    };
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(resolve(evidenceDirectory, "r1-r5-smoke-blocked-report.json"),
      `${JSON.stringify(blockedReport, null, 2)}\n`);
    throw new Error(`FOCUSED_GOWM_${failedCases.map((evaluation) => evaluation.entry.recipeId).join("_")}_COMPOSITION_FAILED`);
  }
  const casePayloads = evaluatedCases.map((evaluation) => {
    const { entry, requirement, observedOperations, ambiguityStopped, keyConsumed, leaseUsable,
      priorResolverOutputConsumed } = evaluation;
    return {
      caseId: entry.recipeId,
      status: "PASS",
      terminalStatus: entry.terminalStatus,
      requestHash: entry.requestHash,
      resultHash: entry.resultHash,
      stageCount: entry.completedStages.length,
      requiredOperationKeys: requirement.operations,
      observedOperationKeys: observedOperations,
      observedDirectOperationKeys: entry.compositionProof.directOperationKeys,
      requiredDataflowBindings: requirement.bindings,
      observedDataflowBindings: entry.compositionProof.planDataflowBindings,
      directOperationStageEvidenceMet: evaluation.directOperationStageEvidenceMet,
      validationStageTerminalCount: evaluation.validationStageTerminalCount,
      directValidationProof: entry.compositionProof.directValidationProof,
      resolverOutputConsumedWithoutKeyRewrite: keyConsumed,
      priorResolverOutputConsumed: priorResolverOutputConsumed,
      validationLeaseUsable: leaseUsable,
      ambiguityStoppedBeforeWorldQuery: ambiguityStopped,
      referenceKeyHash: referenceHashes.get(entry.recipeId)
    };
  });
  const operationLockHashes = uniqueDigests(cases.flatMap((entry) =>
    entry.runtimeBinding.operationLockHash ? [entry.runtimeBinding.operationLockHash] : []));
  if (operationLockHashes.length !== 1) throw new Error("FOCUSED_GOWM_OPERATION_LOCK_BINDING_INVALID");
  const gatewayReady = await fetchJson(required("GOWM_GATEWAY_BASE_URL").replace(/\/+$/u, ""), "/health/ready");
  if (gatewayReady.status !== 200 || !["ok", "ready"].includes(String(gatewayReady.body["status"]))) {
    throw new Error(`FOCUSED_GOWM_READINESS_FAILED_${gatewayReady.status}`);
  }
  const evidencePayload = {
    schemaVersion: "wsgs-gowm-v0.6.4-r1-r5-smoke/1.0",
    marker: "WSGS_GOWM_SMOKE_READY",
    sourceIdentity: {
      kind: "CURRENT_WORKTREE_CANONICAL_TREE_NOT_RELEASE_COMMIT",
      baseCommit: sourceCommit,
      canonicalSourceTreeHash: focusedSourceTreeHash,
      canonicalSourceTreeManifestSchemaVersion: "wsgs-source-tree-manifest/1.0",
      canonicalSourceTreePolicy: "TRACKED_AND_NONIGNORED_FILES_EXCLUDING_DEDICATED_RUNTIME_EVIDENCE",
      gowmRunningSourceRevision: required("GOWM_RUNNING_SOURCE_REVISION")
    },
    readiness: {
      wsgsLiveHttpStatus: localReadiness.liveHttpStatus,
      wsgsReadyHttpStatus: localReadiness.readyHttpStatus,
      gowmReadyHttpStatus: gatewayReady.status,
      requiredAvailability: { available: 12, required: 12, status: "PASS" }
    },
    runtimeBinding: {
      operationLockHash: operationLockHashes[0],
      modelTransport: "LOCAL_SCHEMA_VALID_HTTP_TRANSPORT_NOT_EXTERNAL_MODEL_QUALIFICATION",
      materializerReportSchemaHash: materializerSchemaHash,
      materializerReportSchemaValidation: "PASS",
      gatewayOnly: true,
      directProviderCalls: 0
    },
    summary: { total: 5, passed: 5, failed: 0, notRun: 0, status: "PASS" },
    cases: casePayloads,
    redaction: {
      credentialsIncluded: false,
      rawReferenceIdsIncluded: false,
      rawGroundingIdsIncluded: false,
      internalTopologyIncluded: false
    }
  };
  const evidenceHash = canonicalSha256(evidencePayload) as GdpsV021Sha256Digest;
  const report = { schemaVersion: "wsgs-gowm-v0.6.4-r1-r5-smoke-report/1.0", evidencePayload, evidenceHash };
  const materializerReport = {
    schemaVersion: "1.0",
    resolved: ["R1", "R2", "R3", "R4", "R5"],
    conflicts: [],
    insufficient: [],
    determinismHash: evidenceHash,
    status: "PASS"
  };
  const materializerAjv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(materializerAjv);
  const validateMaterializer = materializerAjv.compile(materializerSchema);
  if (!validateMaterializer(materializerReport)) {
    throw new Error(`FOCUSED_MATERIALIZER_REPORT_SCHEMA_INVALID_${
      materializerAjv.errorsText(validateMaterializer.errors).replace(/[^A-Za-z0-9_.:-]/gu, "_").slice(0, 160)
    }`);
  }
  mkdirSync(evidenceDirectory, { recursive: true });
  const reportPath = resolve(evidenceDirectory, "r1-r5-smoke-report.json");
  const materializerPath = resolve(evidenceDirectory, "semantic-materializer-report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(materializerPath, `${JSON.stringify(materializerReport, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    marker: "WSGS_GOWM_SMOKE_READY",
    sourceCommit,
    sourceTreeHash: focusedSourceTreeHash,
    casesPassed: 5,
    casesTotal: 5,
    evidenceHash,
    reportPath,
    materializerPath
  }, null, 2)}\n`);
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
  await startFocusedSchemaModel();
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
  if (gdpsRuntimeAuthorityPreflight) {
    gdpsDriverSidecar = loadGdpsDriverSidecarContract(gdpsRuntimeAuthorityPreflight);
    gdpsDriverRuntimeIdentity = await computeGdpsV021RuntimeIdentity(pool, gdpsRuntimeAuthorityPreflight, {
      liveHttpStatus: live.status,
      readyHttpStatus: ready.status
    }, gdpsDriverSidecar);
    gdpsRuntimeIdentityHash = canonicalSha256(gdpsDriverRuntimeIdentity) as GdpsV021Sha256Digest;
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
  const gdpsSuite: GdpsCaseSuite = focusedGowmR1R5
    ? { mode: "DISABLED", cases: [], totalCaseCount: 0, selectedCaseCount: 0, fullCorpusSelected: false }
    : loadFrozenGdpsCaseSuite();
  const gdpsRuntime = loadGdpsRuntimeExpectations(gdpsSuite, gdpsRuntimeAuthorityPreflight);
  for (const definition of gdpsSuite.cases.filter((entry) => !gdpsV021DriverCaseIds.has(entry.id))) {
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
  const validationReference = focusedGowmR1R5
    ? knownReferenceFromCase(cases.find((entry) => entry.recipeId === "R1")!, "2号车")
    : knownVehicle;
  cases.push(await submitAndRun(baseUrl, productionExecutor, "R5", requestBody(
    "R5", "验证2号车当前有效性", "VALIDATE_REFERENCES", ["RESOLVED_REFERENCES"], [validationReference]
  ), ["COMPLETED"]));

  if (focusedGowmR1R5) {
    await writeFocusedGowmR1R5Evidence(cases, {
      liveHttpStatus: live.status,
      readyHttpStatus: ready.status
    });
    exitCode = 0;
    throw new FocusedGowmR1R5Complete();
  }

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

  const gdpsDriverOrchestrationRequired = gdpsSuite.mode === "GDPS_V021_FROZEN_CORPUS" &&
    (gdpsSuite.fullCorpusSelected || gdpsSuite.cases.some((entry) => gdpsV021DriverCaseIds.has(entry.id)));
  const gdpsDriverOrchestration = gdpsDriverOrchestrationRequired
    ? await (async () => {
      if (!gdpsRuntimeAuthorityPreflight || !gdpsDriverRuntimeIdentity || !gdpsRuntimeIdentityHash ||
          !gdpsRuntime.runtimeRecipeLockHash || !gdpsRuntime.providerRecipeLockHash) {
        throw new Error("GDPS_DRIVER_RUNTIME_BINDING_MISSING");
      }
      const callbacks = createGdpsSidecarCallbacks(gdpsDriverSidecar);
      const manifestPath = resolve(required("WSGS_GDPS_DRIVER_MANIFEST_FILE"));
      const runtimeConsumerSnapshotHash = optionalDigest(required("WSGS_GDPS_CONSUMER_SNAPSHOT_SHA256"),
        "GDPS_RUNTIME_CONSUMER_SNAPSHOT_HASH_INVALID");
      if (!runtimeConsumerSnapshotHash) throw new Error("GDPS_RUNTIME_CONSUMER_SNAPSHOT_HASH_MISSING");
      const result = await runGdpsV021DriverOrchestrator({
        repositoryRoot: process.cwd(),
        outputDirectory: dirname(manifestPath),
        manifestPath,
        gateRunId,
        sourceCommit,
        handoffBundleHash: gdpsRuntimeAuthorityPreflight.handoff.bundleHash,
        operationLockHash: gdpsRuntimeAuthorityPreflight.operationLock.hash,
        provenanceHash: gdpsRuntimeAuthorityPreflight.operationLock.provenanceHash,
        runtimeIdentity: gdpsDriverRuntimeIdentity,
        runtimeRecipeLockPath: required("WSGS_GDPS_RECIPE_LOCK_FILE"),
        runtimeRecipeLockHash: gdpsRuntime.runtimeRecipeLockHash,
        runtimeConsumerSnapshotPath: required("WSGS_GDPS_CONSUMER_SNAPSHOT_FILE"),
        runtimeConsumerSnapshotHash,
        providerRecipeLockPath: required("WSGS_GDPS_PROVIDER_RECIPE_LOCK_FILE"),
        providerRecipeLockHash: gdpsRuntime.providerRecipeLockHash,
        sql: pool,
        executeNaturalLanguageCase: async (request) => {
          const executor = await executorForGdpsDriverVariant(request, productionExecutor, gdpsDriverSidecar);
          return await submitAndRunGdpsDriver(baseUrl, executor, request);
        },
        ...callbacks,
        sampleSharedRuntimeHash: sampleSharedGowmRuntimeHash
      });
      if (result.gateRunId !== gateRunId || result.runtimeIdentityHash !== gdpsRuntimeIdentityHash ||
          result.manifestPath !== repositoryRelative(manifestPath) || result.drivers.length !== 4 ||
          new Set(result.drivers.map((entry) => entry.caseId)).size !== 4) {
        throw new Error("GDPS_DRIVER_ORCHESTRATION_RESULT_BINDING_INVALID");
      }
      return result;
    })()
    : undefined;

  // The complete verifier consumes evidence created by all four real isolated
  // drivers. It is deliberately invoked only after case execution and before
  // any final report or completion marker can be published.
  const gdpsRuntimePostflight = gdpsSuite.mode === "GDPS_V021_FROZEN_CORPUS" &&
    (gdpsSuite.fullCorpusSelected || gdpsSuite.cases.some((entry) => gdpsV021DriverCaseIds.has(entry.id)))
    ? loadGdpsV021RuntimePostflight()
    : undefined;
  if (gdpsDriverOrchestration && gdpsRuntimePostflight &&
      (gdpsRuntimePostflight.driverManifest.hash !== gdpsDriverOrchestration.manifestHash ||
       gdpsRuntimePostflight.driverManifest.path !== gdpsDriverOrchestration.manifestPath)) {
    throw new Error("GDPS_DRIVER_ORCHESTRATION_POSTFLIGHT_DRIFT");
  }
  if (gdpsSuite.mode === "GDPS_V021_FROZEN_CORPUS" && gdpsSuite.fullCorpusSelected && !gdpsRuntimePostflight) {
    throw new Error("GDPS_DRIVER_POSTFLIGHT_NOT_RUN");
  }
  const gdpsW43Requested = process.env["WSGS_RUN_GDPS_W43_RUNTIME_GATE"] === "YES";
  const gdpsW43Runtime = gdpsW43Requested
    ? await (async () => {
      if (!gdpsSuite.fullCorpusSelected || !gdpsRuntimeAuthorityPreflight || !gdpsDriverRuntimeIdentity ||
          !gdpsRuntimeIdentityHash || !/^wsgs-gdps-v021-[a-z0-9][a-z0-9-]{7,95}$/u.test(gateRunId)) {
        throw new Error("GDPS_W43_RUNTIME_BINDING_MISSING");
      }
      const sidecar = loadGdpsW43SidecarContract(gdpsRuntimeAuthorityPreflight, gdpsRuntimeIdentityHash);
      if (!sidecar) throw new Error("GDPS_W43_SIDECAR_UNAVAILABLE_NOT_RUN");
      const w43Executor = await withTemporaryProcessEnvironment({
        GOWM_GATEWAY_BASE_URL: sidecar.isolatedGatewayBaseUrl
      }, async () => await createPipelineStageExecutor({ pool }));
      const binding = {
        candidateSha: sourceCommit,
        gateRunId,
        runtimeIdentityHash: gdpsRuntimeIdentityHash,
        gowmGatewayIdentityHash: gdpsDriverRuntimeIdentity.gowmGatewayRuntimeHash,
        wsgsRuntimeIdentityHash: gdpsDriverRuntimeIdentity.wsgsRuntimeHash,
        databaseIdentityHash: gdpsDriverRuntimeIdentity.databaseIdentityHash,
        handoffBundleHash: gdpsRuntimeAuthorityPreflight.handoff.bundleHash,
        operationLockHash: gdpsRuntimeAuthorityPreflight.operationLock.hash,
        providerRecipeLockHash: required("WSGS_GDPS_PROVIDER_RECIPE_LOCK_SHA256") as GdpsV021Sha256Digest,
        providerId: "gdps.geospatial-products" as const,
        providerVersion: "0.2.1" as const,
        capabilityCount: 30 as const,
        requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" as const,
        gatewayOnly: true as const,
        directProviderCalls: 0 as const,
        mockTransportUsed: false as const,
        databaseClass: "REAL_ISOLATED_POSTGRESQL" as const,
        sharedRuntimeMutated: false as const
      };
      const receiptPrefix = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts";
      return await runGdpsV021W43RuntimeGate({
        repositoryRoot: process.cwd(), binding,
        authority: {
          dataScope: required("WSGS_READINESS_DATA_SCOPE"), actorId: identity.actorId,
          principalId: identity.servicePrincipalId, datasetScopes: [...identity.datasetScopes].sort(),
          authorizationContextHash: identity.authorizationContextHash as GdpsV021Sha256Digest,
          operationLockHash: binding.operationLockHash
        },
        pool, generatedAt: new Date().toISOString(),
        currentnessReceiptPath: `${receiptPrefix}/currentness.json`,
        postgresReceiptPath: `${receiptPrefix}/postgres.json`,
        barrierAttestationPath: `${receiptPrefix}/barrier-attestation.json`,
        replayBarrierArmAttestationPath: `${receiptPrefix}/source-changed-twice-arm.json`,
        manifestPath: `${receiptPrefix}/runtime-manifest.json`,
        executeNaturalLanguageCase: async (request) => await submitAndRunGdpsW43(baseUrl, w43Executor, request),
        advanceBarrier: async (request) => await awaitGdpsW43Control({
          sidecar, action: "ADVANCE", scenarioId: request.scenarioId, barrier: request.barrier,
          runtimeIdentityHash: request.runtimeIdentityHash
        }) as GdpsV021W43BarrierArtifact,
        armReplayBarrier: async (request) => await awaitGdpsW43Control({
          sidecar, action: "ARM", scenarioId: request.scenarioId, barrier: request.barrier,
          runtimeIdentityHash: request.runtimeIdentityHash
        }) as GdpsV021W43BarrierArmArtifact,
        readBarrierAttestation: async () => await awaitGdpsW43Control({
          sidecar, action: "READ", runtimeIdentityHash: binding.runtimeIdentityHash
        }) as GdpsV021W43BarrierArtifact,
        openPersistedRequest: async (ciphertext, context) =>
          await payloadCodec.openRequest(ciphertext, context)
      });
    })()
    : undefined;
  const gdpsPolicyEvidence = gdpsSuite.mode === "GDPS_V021_FROZEN_CORPUS" && gdpsSuite.fullCorpusSelected
    ? buildGdpsV021PolicyReport({
      postflight: gdpsRuntimePostflight!,
      liveCases: cases.filter((entry) => gdpsCaseIds.has(entry.recipeId)),
      runtime: gdpsRuntime,
      apiLiveStatus: live.status,
      apiReadyStatus: ready.status,
      crossScopeStatus: crossScopeRealResponse.statusCode
    })
    : undefined;
  if (gdpsPolicyEvidence) {
    gdpsV021DriverCaseIds.forEach((caseId) => gdpsCaseIds.add(caseId));
    if (gdpsPolicyEvidence.report.overallStatus !== "PASS") {
      throw new Error(`GDPS_V021_POLICY_REPORT_${gdpsPolicyEvidence.report.overallStatus}`);
    }
  }
  const typedDiagnostic = gdpsSuite.mode === "GDPS_V021_FROZEN_CORPUS" && !gdpsSuite.fullCorpusSelected
    ? (() => {
      const expected = parseGdpsV021Corpus(readFileSync(required("WSGS_GDPS_E2E_CORPUS_FILE"))).cases
        .find((entry) => entry.id === gdpsSuite.cases[0]!.id);
      if (!expected) throw new Error(`GDPS_DIAGNOSTIC_POLICY_CASE_MISSING_${gdpsSuite.cases[0]!.id}`);
      return buildGdpsV021DiagnosticEvaluation({
        expected,
        liveEvidence: gdpsV021DriverCaseIds.has(expected.id)
          ? undefined
          : cases.find((entry) => entry.recipeId === expected.id),
        postflight: gdpsV021DriverCaseIds.has(expected.id) ? gdpsRuntimePostflight : undefined,
        runtime: gdpsRuntime
      });
    })()
    : undefined;
  if (typedDiagnostic) gdpsCaseIds.add(typedDiagnostic.evaluation.caseId);
  const typedCaseDetails = gdpsPolicyEvidence
    ? assertCompleteTypedCaseSummary(gdpsPolicyEvidence.report)
    : typedDiagnostic ? [typedDiagnostic.evaluation] : [];
  const gdpsExecutionSummary = gdpsPolicyEvidence?.report.execution ?? typedDiagnostic?.execution ?? null;

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
    gateRunId,
    runtimeIdentityHash: gdpsRuntimeIdentityHash ?? null,
    priorCanonicalEvidence: isolatedPriorEvidencePath
      ? { status: "INVALIDATED_AND_ISOLATED", path: isolatedPriorEvidencePath }
      : { status: "NONE_PRESENT", path: null },
    status: gdpsSuite.mode === "GDPS_V021_FROZEN_CORPUS" && !gdpsSuite.fullCorpusSelected ? "PARTIAL" : "PASS",
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
      gatewayOnly: gdpsExecutionSummary?.gatewayOnly ?? false,
      directProviderCalls: gdpsExecutionSummary?.directProviderCalls ?? null,
      mockTransportUsed: gdpsExecutionSummary?.mockTransportUsed ?? null,
      suiteMode: gdpsSuite.mode,
      corpus: gdpsSuite.mode === "GDPS_V021_FROZEN_CORPUS" ? {
        schemaVersion: "wsgs-gdps-e2e-corpus/2.0",
        hash: gdpsSuite.corpusHash,
        frozenCaseCount: gdpsSuite.totalCaseCount,
        selectedCaseCount: gdpsSuite.selectedCaseCount,
        selection: gdpsSuite.fullCorpusSelected ? "FULL_16_CASE_CORPUS" : "SINGLE_CASE"
      } : null,
      typedCaseDetails,
      geometryBuffer: {
        caseId: "E2E-08",
        status: "NOT_RUN",
        reason: "GOWM_GEOMETRY_BUFFER_CAPABILITY_REQUIRED"
      },
      w43Runtime: gdpsW43Runtime ? {
        status: gdpsW43Runtime.status,
        scenarioCount: gdpsW43Runtime.scenarioCount,
        manifestPath: gdpsW43Runtime.manifestPath,
        manifestHash: gdpsW43Runtime.manifestHash,
        barrierAttestationHash: gdpsW43Runtime.barrierAttestationHash
      } : { status: "NOT_RUN", reason: "W43_RUNTIME_GATE_NOT_REQUESTED_OR_SIDECAR_UNAVAILABLE" },
      caseValidationStatus: gdpsCaseIds.size > 0 && gdpsCaseIds.size === gdpsSuite.selectedCaseCount
        ? (gdpsSuite.fullCorpusSelected && gdpsPolicyEvidence?.report.overallStatus === "PASS" ? "PASS" : "PARTIAL")
        : "NOT_RUN",
      status: gdpsSuite.fullCorpusSelected ? (gdpsPolicyEvidence?.report.overallStatus ?? "BLOCKED") : "PARTIAL",
      policyReport: gdpsPolicyEvidence ? {
        schemaVersion: gdpsPolicyEvidence.report.schemaVersion,
        corePath: gdpsPolicyEvidence.core.path,
        coreHash: gdpsPolicyEvidence.core.hash,
        finalPath: repositoryRelative(resolve(evidenceDirectory, "e2e-report.json")),
        finalHash: gdpsPolicyEvidence.final.hash,
        validationReceiptHash: gdpsPolicyEvidence.validationReceiptHash,
        casesPassed: gdpsPolicyEvidence.report.summary.passedCases,
        qualificationsPassed: gdpsPolicyEvidence.report.summary.passedQualifications,
        overallStatus: gdpsPolicyEvidence.report.overallStatus
      } : null,
      diagnostic: typedDiagnostic ? {
        caseId: typedDiagnostic.evaluation.caseId,
        status: typedDiagnostic.evaluation.status,
        artifactPath: typedDiagnostic.artifact.path,
        artifactHash: typedDiagnostic.artifact.hash
      } : null
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
  const canonicalSummaryPath = resolve(evidenceDirectory, "development-closure-gate.json");
  if (gdpsPolicyEvidence) {
    const pendingSummaryPath = resolve(evidenceDirectory, "development-closure-gate.pending.json");
    if (existsSync(canonicalSummaryPath) || existsSync(pendingSummaryPath)) {
      throw new Error("GDPS_CLOSURE_SUMMARY_ATOMIC_PROMOTION_PRECONDITION_FAILED");
    }
    writeFileSync(pendingSummaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    const pendingFinalPath = resolve(process.cwd(), gdpsPolicyEvidence.final.path);
    const canonicalFinalPath = resolve(evidenceDirectory, "e2e-report.json");
    if (sha256(readFileSync(pendingFinalPath)) !== gdpsPolicyEvidence.final.hash || existsSync(canonicalFinalPath)) {
      throw new Error("GDPS_FINAL_REPORT_ATOMIC_PROMOTION_PRECONDITION_FAILED");
    }
    renameSync(pendingFinalPath, canonicalFinalPath);
    renameSync(pendingSummaryPath, canonicalSummaryPath);
  } else {
    writeFileSync(canonicalSummaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({
    marker: gdpsSuite.mode === "GDPS_V021_FROZEN_CORPUS" && !gdpsSuite.fullCorpusSelected
      ? "WSGS_GDPS_V021_DIAGNOSTIC_COMPLETE"
      : "WSGS_REAL_DEVELOPMENT_PIPELINE_PASS",
    sourceCommit,
    recipesPassed: stableRecipeCases.length,
    gdpsCasesPassed: gdpsCaseIds.size,
    pipelineStages: r1.completedStages.length,
    currentLockReadiness: "PASS",
    minimumSecurity: "PASS",
    workerRestart: "PASS",
    noData: "PASS",
    partial: "PASS",
    gdpsCases: gdpsCaseIds.size,
    gdpsW43Runtime: gdpsW43Runtime?.status ?? "NOT_RUN",
    ...(gdpsPolicyEvidence ? {
      gdpsPolicyStatus: gdpsPolicyEvidence.report.overallStatus,
      gdpsPolicyReportHash: gdpsPolicyEvidence.final.hash,
      gdpsQualificationCount: gdpsPolicyEvidence.report.summary.passedQualifications
    } : {})
  }, null, 2)}\n`);
  exitCode = 0;
} catch (error) {
  if (!(error instanceof FocusedGowmR1R5Complete)) {
    const code = error instanceof Error ? error.message.replace(/[^A-Za-z0-9_:-]/gu, "_").slice(0, 240) : "UNKNOWN_ERROR";
    process.stderr.write(`${JSON.stringify({ marker: "WSGS_REAL_DEVELOPMENT_PIPELINE_BLOCKED", code })}\n`);
  }
} finally {
  await app?.close().catch(() => undefined);
  await resources?.close().catch(() => undefined);
  await pool.end().catch(() => undefined);
  if (focusedModelServer) {
    await new Promise<void>((resolveClose) => focusedModelServer!.close(() => resolveClose()));
  }
}

process.exit(exitCode);
