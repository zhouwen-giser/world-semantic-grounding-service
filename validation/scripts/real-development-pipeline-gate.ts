import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { URL } from "node:url";

import { createGroundingIdentity } from "@wsgs/delegated-identity";
import {
  Aes256GcmPayloadCodec,
  GroundingPipeline,
  LEGACY_GROUNDING_CONTRACT_SELECTION,
  PostgresPipelineJournal,
  SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION,
  canonicalSha256,
  pipelinePlanForOperation,
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

function evidenceCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(evidenceCanonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as JsonObject;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${evidenceCanonicalJson(record[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("EVIDENCE_CANONICAL_JSON_UNDEFINED");
  return encoded;
}

function evidenceCanonicalSha256(value: unknown): `sha256:${string}` {
  return sha256(evidenceCanonicalJson(value));
}

function safeId(value: string): `sha256:${string}` {
  return sha256(value);
}

const repositoryRoot = resolve(import.meta.dirname, "..", "..");

function loadSchemas(): Record<string, unknown> {
  const directory = resolve(repositoryRoot, "contracts", "wsgs-v0.1", "contracts");
  return Object.fromEntries(readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name, JSON.parse(readFileSync(resolve(directory, name), "utf8")) as unknown]));
}

const sourceCommit = required("WSGS_EVIDENCE_SOURCE_COMMIT");
if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error("WSGS_EVIDENCE_SOURCE_COMMIT_INVALID");
const gateRunId = process.env["WSGS_GATE_RUN_ID"]?.trim() || sourceCommit.slice(0, 12);
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{5,63}$/u.test(gateRunId)) throw new Error("WSGS_GATE_RUN_ID_INVALID");
const databaseUrl = required("DATABASE_URL");
const evidenceDirectory = resolve(repositoryRoot, process.env["WSGS_DEVELOPMENT_EVIDENCE_DIR"] ?? "reports/wsgs-v0.2");
const recipeEvidenceDirectory = resolve(evidenceDirectory, "recipe-evidence");
const formalReportDirectory = resolve(repositoryRoot, process.env["WSGS_FORMAL_R1_R5_REPORT_DIR"] ??
  "reports/wsgs-gowm-0.6.4-alignment");
const formalR1R5Only = process.env["WSGS_GOWM_R1_R5_ONLY"] === "YES";
const formalExternalProcessMode = process.env["WSGS_FORMAL_EXTERNAL_PROCESS_MODE"] === "YES";
const commandArguments = process.argv.slice(2);
const allowedCommandArguments = new Set(["--n04-result-extension-only"]);
const unsupportedCommandArgument = commandArguments.find((argument) => !allowedCommandArguments.has(argument));
if (unsupportedCommandArgument) throw new Error("WSGS_REAL_DEVELOPMENT_PIPELINE_ARGUMENT_INVALID");
const n04ResultExtensionOnly = process.env["WSGS_N04_RESULT_EXTENSION_ONLY"] === "YES" ||
  commandArguments.includes("--n04-result-extension-only");
if (formalR1R5Only && !formalExternalProcessMode) throw new Error("WSGS_FORMAL_EXTERNAL_PROCESS_MODE_REQUIRED");
if (formalExternalProcessMode && !formalR1R5Only) throw new Error("WSGS_FORMAL_EXTERNAL_PROCESS_MODE_REQUIRES_R1_R5_ONLY");
if (n04ResultExtensionOnly && (formalR1R5Only || formalExternalProcessMode)) {
  throw new Error("WSGS_N04_RESULT_EXTENSION_MODE_CONFLICT");
}
if (formalR1R5Only) {
  if (!process.env["WSGS_FORMAL_API_BASE_URL"]?.trim()) throw new Error("WSGS_FORMAL_API_BASE_URL_REQUIRED");
  if (!process.env["WSGS_RUNTIME_COMPOSE_PROJECT"]?.trim()) throw new Error("WSGS_RUNTIME_COMPOSE_PROJECT_REQUIRED");
  if (!process.env["WSGS_RUNTIME_IMAGE_BUILD_REPORT"]?.trim()) throw new Error("WSGS_RUNTIME_IMAGE_BUILD_REPORT_REQUIRED");
  if (process.env["WSGS_FORMAL_ISOLATED_DATABASE"]?.trim() !== "YES") {
    throw new Error("WSGS_FORMAL_ISOLATED_DATABASE_REQUIRED");
  }
}
const expectedGowmRuntimeSourceCommit = "c49bf415fdb4cbe19a09f341c34b6dd825e3ca14";
const expectedSharedExecutionGowmSourceLock = "c49bf415fdb4cbe19a09f341c34b6dd825e3ca14";
const expectedGdpsImplementationSourceCommit = "d9238d19bae98e387d390c936300358a30b024cb";
const expectedGdpsFinalBBundleHash =
  "sha256:0cefdafb63aafc01da7ce62148fcf83f40267ec86d73fca78b18eb6af3155fab" as const;
const expectedGowmRuntimeVersion = "0.6.4";
const expectedGatewayContractVersion = "0.6.3";
const expectedWsgsRuntimeVersion = "0.2.1";
const apiBearerToken = process.env["WSGS_FORMAL_API_BEARER_TOKEN"]?.trim();
const encryptionKey = required("WSGS_REQUEST_ENCRYPTION_KEY_BASE64");
const payloadCodec = Aes256GcmPayloadCodec.fromBase64(encryptionKey);
const configuredIdentityDataScopes = process.env["WSGS_READINESS_DATA_SCOPES"]
  ?.split(/[ ,]+/u).map((entry) => entry.trim()).filter(Boolean) ?? [];
const identity = createGroundingIdentity({
  servicePrincipalId: required("GOWM_DELEGATION_SERVICE_PRINCIPAL_ID"),
  actorId: required("WSGS_READINESS_ACTOR_ID"),
  dataScopes: configuredIdentityDataScopes.length > 0
    ? configuredIdentityDataScopes
    : [required("WSGS_READINESS_DATA_SCOPE")],
  datasetScopes: list("WSGS_READINESS_DATASET_SCOPES"),
  permissions: [...new Set([...list("WSGS_READINESS_PERMISSIONS"), "grounding.read"])]
});

interface VerifiedWsgsSourceBinding {
  status: "PASS";
  headCommit: string;
  sourceTree: string;
  evidenceSourceCommit: string;
  trackedSourceClean: true;
  untrackedSourceClean: true;
  excludedRuntimeEvidenceOutputs: readonly [
    "reports/wsgs-gowm-0.6.4-alignment/direct-r1-r5-smoke.json",
    "reports/wsgs-gowm-0.6.4-alignment/runtime-binding-report.json",
    "reports/wsgs-gowm-0.6.4-alignment/runtime-image-build-report.json",
    "reports/wsgs-gowm-0.6.4-alignment/wsgs-runtime-image-build-report.json",
    "reports/wsgs-gowm-0.6.4-alignment/wsgs-process-binding.json",
    "reports/wsgs-gowm-0.6.4-alignment/formal-pipeline-r1-r5.json",
    "reports/wsgs-gowm-0.6.4-alignment/reference-identity-report.json",
    "reports/wsgs-gowm-0.6.4-alignment/reference-composability-r3.json",
    "reports/wsgs-gowm-0.6.4-alignment/reference-negative-cases.json",
    "reports/wsgs-gowm-0.6.4-alignment/pipeline-traceability.json"
  ];
  verification: "GIT_HEAD_AND_WORKTREE_STATUS_EXCLUDING_EXACT_RUNTIME_EVIDENCE_OUTPUTS";
}

const excludedRuntimeEvidenceOutputs = [
  "reports/wsgs-gowm-0.6.4-alignment/direct-r1-r5-smoke.json",
  "reports/wsgs-gowm-0.6.4-alignment/runtime-binding-report.json",
  "reports/wsgs-gowm-0.6.4-alignment/runtime-image-build-report.json",
  "reports/wsgs-gowm-0.6.4-alignment/wsgs-runtime-image-build-report.json",
  "reports/wsgs-gowm-0.6.4-alignment/wsgs-process-binding.json",
  "reports/wsgs-gowm-0.6.4-alignment/formal-pipeline-r1-r5.json",
  "reports/wsgs-gowm-0.6.4-alignment/reference-identity-report.json",
  "reports/wsgs-gowm-0.6.4-alignment/reference-composability-r3.json",
  "reports/wsgs-gowm-0.6.4-alignment/reference-negative-cases.json",
  "reports/wsgs-gowm-0.6.4-alignment/pipeline-traceability.json"
] as const;

const verifiedSourcePathspecs = [
  ".",
  ...excludedRuntimeEvidenceOutputs.map((path) => `:(top,exclude,literal)${path}`)
];

function verifyWsgsSourceBinding(): VerifiedWsgsSourceBinding {
  const packageDocument = object(
    JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")) as unknown,
    "WSGS_PACKAGE_JSON_INVALID"
  );
  if (packageDocument["version"] !== expectedWsgsRuntimeVersion) throw new Error("WSGS_RUNTIME_VERSION_MISMATCH");
  let head: string;
  let sourceTree: string;
  try {
    head = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    sourceTree = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD^{tree}"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    throw new Error("WSGS_SOURCE_HEAD_MISMATCH");
  }
  if (head !== sourceCommit || !/^[0-9a-f]{40}$/u.test(sourceTree)) throw new Error("WSGS_SOURCE_HEAD_MISMATCH");
  try {
    execFileSync("git", ["-C", repositoryRoot, "diff", "--quiet", "HEAD", "--", ...verifiedSourcePathspecs], {
      stdio: "ignore"
    });
  } catch {
    throw new Error("WSGS_SOURCE_TRACKED_DIRTY");
  }
  const worktreeStatus = execFileSync(
    "git",
    ["-C", repositoryRoot, "status", "--porcelain=v1", "--untracked-files=all", "--", ...verifiedSourcePathspecs],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  ).trim();
  if (worktreeStatus) throw new Error("WSGS_SOURCE_WORKTREE_DIRTY");
  return {
    status: "PASS",
    headCommit: head,
    sourceTree,
    evidenceSourceCommit: sourceCommit,
    trackedSourceClean: true,
    untrackedSourceClean: true,
    excludedRuntimeEvidenceOutputs,
    verification: "GIT_HEAD_AND_WORKTREE_STATUS_EXCLUDING_EXACT_RUNTIME_EVIDENCE_OUTPUTS"
  };
}

interface VerifiedRuntimeBinding {
  bindingStatus: "PASS";
  sourceCommit: string;
  runtimeVersion: string;
  gatewayContractVersion: string;
  imageDigest: `sha256:${string}`;
  instanceEvidenceHash: `sha256:${string}`;
  instanceEvidencePayloadHash: `sha256:${string}`;
  imageBuildEvidenceHash: `sha256:${string}`;
  imageBuildEvidencePayloadHash: `sha256:${string}`;
  imageBuildEvidencePathHash: `sha256:${string}`;
  imageBuildGeneratedAt: string;
  sourceTree: string;
  observedAt: string;
  runtimeBindingHash: `sha256:${string}`;
  runtimeBindingHashBasis: "DIRECT_REPORT_RUNTIME_BINDING_CANONICAL_JSON_WITHOUT_BINDING_HASH";
  sourceReportFileHash: `sha256:${string}`;
  sourceReportEvidenceHash: `sha256:${string}`;
  sourceReportPathHash: `sha256:${string}`;
}

function digest(value: unknown, code: string): `sha256:${string}` {
  const candidate = string(value, code);
  if (!/^sha256:[0-9a-f]{64}$/u.test(candidate)) throw new Error(code);
  return candidate as `sha256:${string}`;
}

function repositoryRelativePath(path: string, code: string): string {
  const candidate = relative(repositoryRoot, path);
  if (candidate === ".." || candidate.startsWith(`..${sep}`) || isAbsolute(candidate)) throw new Error(code);
  return candidate.split(sep).join("/");
}

interface N04GatewayTuple {
  contractCatalogRevision: `sha256:${string}`;
  semanticCatalogHash: `sha256:${string}`;
  bindingRevision: `sha256:${string}`;
}

interface VerifiedN04SharedExecutionGatewayBinding {
  executionSourceLockSha: string;
  sourceBindingMethod: "CHECKSUMMED_FINAL_B_SOURCE_LOCK_PLUS_LIVE_GATEWAY_LOCK_MATCH";
  gdpsSourceCommit: string;
  handoffBundleHash: `sha256:${string}`;
  checksumsFileHash: `sha256:${string}`;
  consumerLockHash: `sha256:${string}`;
  gatewayBindingLockHash: `sha256:${string}`;
  capabilityLockHash: `sha256:${string}`;
  foundationInstanceBindingHash: `sha256:${string}`;
  foundationOperationLockHash: `sha256:${string}`;
  foundationDataScopeHash: `sha256:${string}`;
  selectedDatasetDataScopeHash: `sha256:${string}`;
  endpointHash: `sha256:${string}`;
  lockedGatewayTuple: N04GatewayTuple & {
    instanceFingerprint: `sha256:${string}`;
    runningConfigFingerprint: `sha256:${string}`;
  };
}

const n04GdpsHandoffInventory = [
  "GDPS_CAPABILITY_LOCK.json",
  "GDPS_CONSUMER_LOCK.json",
  "GDPS_PRODUCT_DESCRIPTOR_LOCK.json",
  "GDPS_RECIPE_LOCK.json",
  "GDPS_SAMPLE_DATASET_LOCK.json",
  "GOWM_GATEWAY_BINDING_LOCK.json",
  "WSGS_QUERY_CORPUS.json",
  "WSGS_TEST_BASELINE.json"
] as const;

function n04JsonFile(path: string, code: string): { bytes: Buffer; value: JsonObject } {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new Error(`${code}_MISSING`);
  }
  try {
    return { bytes, value: object(JSON.parse(bytes.toString("utf8")) as unknown, `${code}_INVALID`) };
  } catch (error) {
    if (error instanceof Error && error.message === `${code}_INVALID`) throw error;
    throw new Error(`${code}_INVALID`);
  }
}

function n04GatewayTuple(value: JsonObject, code: string): N04GatewayTuple {
  return {
    contractCatalogRevision: digest(value["contractCatalogRevision"], `${code}_CATALOG_REVISION_INVALID`),
    semanticCatalogHash: digest(value["semanticCatalogHash"], `${code}_SEMANTIC_HASH_INVALID`),
    bindingRevision: digest(value["bindingRevision"], `${code}_BINDING_REVISION_INVALID`)
  };
}

function n04GatewayOrigin(value: string, code: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(code);
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password ||
      parsed.search || parsed.hash || (parsed.pathname !== "" && parsed.pathname !== "/")) {
    throw new Error(code);
  }
  return parsed.origin;
}

function loadVerifiedN04SharedExecutionGatewayBinding(): VerifiedN04SharedExecutionGatewayBinding {
  const handoffDirectory = resolve(repositoryRoot, "contracts", "upstream", "gdps-v0.2.1");
  const checksumsFile = n04JsonFile(resolve(handoffDirectory, "CHECKSUMS.json"), "N04_GDPS_CHECKSUMS");
  const checksums = checksumsFile.value;
  if (checksums["schemaVersion"] !== "wsgs-gdps-v021-checksums/1.0" || checksums["algorithm"] !== "SHA-256" ||
      checksums["bundleHash"] !== expectedGdpsFinalBBundleHash || !Array.isArray(checksums["files"])) {
    throw new Error("N04_GDPS_CHECKSUMS_CONTRACT_MISMATCH");
  }
  const entries = new Map<string, `sha256:${string}`>();
  for (const raw of checksums["files"]) {
    const entry = object(raw, "N04_GDPS_CHECKSUM_ENTRY_INVALID");
    const path = string(entry["path"], "N04_GDPS_CHECKSUM_PATH_INVALID");
    if (path.includes("/") || path.includes("\\") || entries.has(path)) {
      throw new Error("N04_GDPS_CHECKSUM_INVENTORY_INVALID");
    }
    entries.set(path, digest(entry["sha256"], "N04_GDPS_CHECKSUM_HASH_INVALID"));
  }
  const actualInventory = [...entries.keys()].sort();
  const expectedInventory = [...n04GdpsHandoffInventory].sort();
  if (evidenceCanonicalJson(actualInventory) !== evidenceCanonicalJson(expectedInventory)) {
    throw new Error("N04_GDPS_CHECKSUM_INVENTORY_INVALID");
  }
  const files = new Map<string, { bytes: Buffer; value: JsonObject }>();
  for (const path of n04GdpsHandoffInventory) {
    const file = n04JsonFile(resolve(handoffDirectory, path), `N04_GDPS_${path.replace(/[^A-Za-z0-9]/gu, "_")}`);
    if (sha256(file.bytes) !== entries.get(path)) throw new Error(`N04_GDPS_CHECKSUM_DRIFT_${path}`);
    files.set(path, file);
  }
  if (evidenceCanonicalSha256(Object.fromEntries(entries)) !== expectedGdpsFinalBBundleHash) {
    throw new Error("N04_GDPS_BUNDLE_HASH_MISMATCH");
  }

  const consumerFile = files.get("GDPS_CONSUMER_LOCK.json")!;
  const capabilityFile = files.get("GDPS_CAPABILITY_LOCK.json")!;
  const datasetFile = files.get("GDPS_SAMPLE_DATASET_LOCK.json")!;
  const gatewayFile = files.get("GOWM_GATEWAY_BINDING_LOCK.json")!;
  const baselineFile = files.get("WSGS_TEST_BASELINE.json")!;
  const consumer = consumerFile.value;
  const sources = object(consumer["sources"], "N04_GDPS_CONSUMER_SOURCES_INVALID");
  if (sources["gowmSha"] !== expectedSharedExecutionGowmSourceLock ||
      sources["gdpsSha"] !== expectedGdpsImplementationSourceCommit) {
    throw new Error("N04_SHARED_EXECUTION_SOURCE_LOCK_MISMATCH");
  }
  const consumerGateway = n04GatewayTuple(
    object(consumer["gateway"], "N04_GDPS_CONSUMER_GATEWAY_INVALID"),
    "N04_GDPS_CONSUMER_GATEWAY"
  );
  const gatewayDocument = gatewayFile.value;
  if (gatewayDocument["schemaVersion"] !== "gowm-gateway-binding-lock/1.0") {
    throw new Error("N04_GDPS_GATEWAY_BINDING_SCHEMA_MISMATCH");
  }
  const gateway = object(gatewayDocument["gateway"], "N04_GDPS_GATEWAY_BINDING_INVALID");
  const lockedGatewayTuple = {
    ...n04GatewayTuple(gateway, "N04_GDPS_GATEWAY_BINDING"),
    instanceFingerprint: digest(gateway["instanceFingerprint"], "N04_GDPS_GATEWAY_INSTANCE_INVALID"),
    runningConfigFingerprint: digest(gateway["runningConfigFingerprint"], "N04_GDPS_GATEWAY_CONFIG_INVALID")
  };
  if (evidenceCanonicalJson(consumerGateway) !== evidenceCanonicalJson({
    contractCatalogRevision: lockedGatewayTuple.contractCatalogRevision,
    semanticCatalogHash: lockedGatewayTuple.semanticCatalogHash,
    bindingRevision: lockedGatewayTuple.bindingRevision
  })) {
    throw new Error("N04_GDPS_GATEWAY_LOCK_CROSS_BINDING_MISMATCH");
  }

  const baseline = baselineFile.value;
  const attestation = object(baseline["gatewayCanaryAttestation"], "N04_GDPS_BASELINE_ATTESTATION_INVALID");
  const baselineTuple = n04GatewayTuple(attestation, "N04_GDPS_BASELINE_GATEWAY");
  if (baseline["schemaVersion"] !== "wsgs-gdps-test-baseline/1.0" || attestation["status"] !== "PASS" ||
      attestation["executionPath"] !== "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" ||
      attestation["authenticationMode"] !== "SIGNED_DELEGATION_V1" || attestation["datasetState"] !== "FINAL_B" ||
      attestation["requiredCapabilityCount"] !== 30 || attestation["availableCapabilityCount"] !== 30 ||
      attestation["passedCaseCount"] !== 30 || attestation["directProviderCalls"] !== 0 ||
      evidenceCanonicalJson(baselineTuple) !== evidenceCanonicalJson(consumerGateway)) {
    throw new Error("N04_GDPS_FINAL_B_BASELINE_MISMATCH");
  }

  const endpointOrigin = n04GatewayOrigin(required("GOWM_GATEWAY_BASE_URL"), "N04_GATEWAY_BASE_URL_INVALID");
  const endpointHash = safeId(endpointOrigin);
  if (digest(attestation["gatewayBaseUrlHash"], "N04_GDPS_GATEWAY_ENDPOINT_HASH_INVALID") !== endpointHash ||
      attestation["gatewayInstanceFingerprint"] !== lockedGatewayTuple.instanceFingerprint ||
      attestation["runningConfigFingerprint"] !== lockedGatewayTuple.runningConfigFingerprint) {
    throw new Error("N04_GDPS_LIVE_ENDPOINT_LOCK_MISMATCH");
  }

  const foundationDirectory = required("GOWM_SAMPLE_HANDOFF_DIR");
  const foundationManifestFile = n04JsonFile(resolve(foundationDirectory, "INSTANCE_MANIFEST.json"),
    "N04_GOWM_INSTANCE_MANIFEST");
  const foundationBindingFile = n04JsonFile(resolve(foundationDirectory, "INSTANCE_BINDING.json"),
    "N04_GOWM_INSTANCE_BINDING");
  const foundationManifest = foundationManifestFile.value;
  const foundationBinding = foundationBindingFile.value;
  if (foundationManifest["schemaVersion"] !== "1.0" || foundationBinding["schemaVersion"] !== "1.0" ||
      foundationManifest["authMode"] !== "SIGNED_DELEGATION_V1" ||
      foundationManifest["runtimeInstanceId"] !== foundationBinding["runtimeInstanceId"] ||
      foundationManifest["instanceId"] !== foundationBinding["instanceId"] ||
      foundationManifest["fixtureId"] !== foundationBinding["fixtureId"] ||
      foundationManifest["fixtureVersion"] !== foundationBinding["fixtureVersion"] ||
      n04GatewayOrigin(string(foundationManifest["gatewayBaseUrl"], "N04_GOWM_INSTANCE_ENDPOINT_MISSING"),
        "N04_GOWM_INSTANCE_ENDPOINT_INVALID") !== endpointOrigin) {
    throw new Error("N04_GOWM_INSTANCE_HANDOFF_MISMATCH");
  }
  const foundationDataScope = string(foundationManifest["dataScope"], "N04_GOWM_FOUNDATION_SCOPE_INVALID");
  const foundationOperationLockHash = digest(
    foundationManifest["operationLockHash"],
    "N04_GOWM_FOUNDATION_OPERATION_LOCK_INVALID"
  );
  const committedFoundationOperationLockHash = sha256(readFileSync(resolve(
    repositoryRoot,
    "contracts/upstream/gowm-0.6.3/extracted/package/bundle/locks/wsgs-southbound-operation-lock-v2.json"
  )));
  if (foundationOperationLockHash !== committedFoundationOperationLockHash) {
    throw new Error("N04_GOWM_FOUNDATION_OPERATION_LOCK_DRIFT");
  }
  const dataset = datasetFile.value;
  const selectedDatasetDataScope = string(dataset["scope"], "N04_GDPS_DATASET_SCOPE_INVALID");
  if (foundationDataScope.includes("*") || selectedDatasetDataScope.includes("*") ||
      foundationDataScope === selectedDatasetDataScope) {
    throw new Error("N04_SEGMENTED_DATA_SCOPE_AUTHORITY_INVALID");
  }

  return {
    executionSourceLockSha: expectedSharedExecutionGowmSourceLock,
    sourceBindingMethod: "CHECKSUMMED_FINAL_B_SOURCE_LOCK_PLUS_LIVE_GATEWAY_LOCK_MATCH",
    gdpsSourceCommit: expectedGdpsImplementationSourceCommit,
    handoffBundleHash: expectedGdpsFinalBBundleHash,
    checksumsFileHash: sha256(checksumsFile.bytes),
    consumerLockHash: sha256(consumerFile.bytes),
    gatewayBindingLockHash: sha256(gatewayFile.bytes),
    capabilityLockHash: sha256(capabilityFile.bytes),
    foundationInstanceBindingHash: sha256(foundationBindingFile.bytes),
    foundationOperationLockHash,
    foundationDataScopeHash: safeId(foundationDataScope),
    selectedDatasetDataScopeHash: safeId(selectedDatasetDataScope),
    endpointHash,
    lockedGatewayTuple
  };
}

const n04OperationLockRelativePath =
  "contracts/generated/gdps-v0.2.1/wsgs-southbound-operation-lock-v2.json" as const;

interface VerifiedN04OperationLockBinding {
  operationLockHash: `sha256:${string}`;
  operationLockPathHash: `sha256:${string}`;
}

function verifyN04OperationLockBinding(
  sourceBinding: VerifiedWsgsSourceBinding
): VerifiedN04OperationLockBinding {
  const configuredPath = resolve(repositoryRoot, required("GOWM_SOUTHBOUND_LOCK_FILE"));
  const relativePath = repositoryRelativePath(configuredPath, "N04_OPERATION_LOCK_OUTSIDE_REPOSITORY");
  if (relativePath !== n04OperationLockRelativePath) throw new Error("N04_OPERATION_LOCK_PATH_MISMATCH");
  const expectedHash = digest(required("GOWM_SOUTHBOUND_LOCK_SHA256"), "N04_OPERATION_LOCK_HASH_INVALID");
  const runtimeBytes = readFileSync(configuredPath);
  if (sha256(runtimeBytes) !== expectedHash) throw new Error("N04_OPERATION_LOCK_HASH_MISMATCH");
  let committedBytes: Buffer;
  try {
    committedBytes = execFileSync(
      "git",
      ["-C", repositoryRoot, "show", `${sourceBinding.headCommit}:${relativePath}`],
      { maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
    );
  } catch {
    throw new Error("N04_OPERATION_LOCK_NOT_IN_QUALIFIED_SOURCE");
  }
  if (!committedBytes.equals(runtimeBytes)) throw new Error("N04_OPERATION_LOCK_SOURCE_BYTES_MISMATCH");
  return {
    operationLockHash: expectedHash,
    operationLockPathHash: safeId(relativePath)
  };
}

function loadVerifiedRuntimeBinding(): VerifiedRuntimeBinding {
  const reportPath = resolve(repositoryRoot, required("GOWM_ALIGNMENT_DIRECT_REPORT"));
  const relativeReportPath = relative(repositoryRoot, reportPath);
  if (relativeReportPath === ".." || relativeReportPath.startsWith(`..${sep}`) || isAbsolute(relativeReportPath)) {
    throw new Error("GOWM_ALIGNMENT_DIRECT_REPORT_OUTSIDE_REPOSITORY");
  }
  const normalizedReportPath = relativeReportPath.split(sep).join("/");
  const reportBytes = readFileSync(reportPath);
  const report = object(JSON.parse(reportBytes.toString("utf8")) as unknown, "GOWM_RUNTIME_BINDING_REPORT_INVALID_JSON");
  const reportEvidenceHash = digest(report["evidenceHash"], "GOWM_RUNTIME_BINDING_REPORT_EVIDENCE_HASH_INVALID");
  const { evidenceHash: _evidenceHash, ...reportPayload } = report;
  if (canonicalSha256(reportPayload) !== reportEvidenceHash) {
    throw new Error("GOWM_RUNTIME_BINDING_REPORT_EVIDENCE_HASH_MISMATCH");
  }
  if (report["schemaVersion"] !== "wsgs-gowm-direct-r1-r5-smoke/1.0" ||
      report["marker"] !== "DIRECT_GOWM_R1_R5_READY" || report["status"] !== "PASS" ||
      report["executionLayer"] !== "DIRECT_WSGS_CONSUMER_TO_GOWM_GATEWAY" ||
      report["formalWsgsPipelineEvidence"] !== false || report["wsgsSourceCommit"] !== sourceCommit) {
    throw new Error("GOWM_ALIGNMENT_DIRECT_REPORT_NOT_PASS");
  }
  const directSummary = object(report["summary"], "GOWM_ALIGNMENT_DIRECT_REPORT_SUMMARY_MISSING");
  if (directSummary["total"] !== 5 || directSummary["pass"] !== 5 || directSummary["fail"] !== 0 ||
      directSummary["notRun"] !== 0 || directSummary["blocked"] !== 0) {
    throw new Error("GOWM_ALIGNMENT_DIRECT_REPORT_SUMMARY_MISMATCH");
  }
  const directCases = Array.isArray(report["cases"])
    ? report["cases"].map((entry) => object(entry, "GOWM_ALIGNMENT_DIRECT_REPORT_CASE_INVALID")) : [];
  const directCaseIds = directCases.map((entry) => entry["caseId"]).sort();
  if (JSON.stringify(directCaseIds) !== JSON.stringify(["R1", "R2", "R3", "R4", "R5"]) ||
      directCases.some((entry) => entry["status"] !== "PASS")) {
    throw new Error("GOWM_ALIGNMENT_DIRECT_REPORT_CASE_SET_MISMATCH");
  }

  const runtime = object(report["runtime"], "GOWM_RUNTIME_BINDING_REPORT_RUNTIME_MISSING");
  const binding = object(runtime["runtimeBinding"], "GOWM_RUNTIME_BINDING_REPORT_BINDING_MISSING");
  if (binding["bindingStatus"] !== "PASS" || binding["status"] !== undefined) {
    throw new Error("GOWM_RUNTIME_BINDING_NOT_PASS");
  }
  const runtimeSourceCommit = string(binding["sourceCommit"], "GOWM_RUNTIME_BINDING_SOURCE_COMMIT_MISSING");
  const runtimeVersion = string(binding["runtimeVersion"], "GOWM_RUNTIME_BINDING_RUNTIME_VERSION_MISSING");
  const gatewayContractVersion = string(binding["gatewayContractVersion"], "GOWM_RUNTIME_BINDING_GATEWAY_CONTRACT_VERSION_MISSING");
  if (runtimeSourceCommit !== expectedGowmRuntimeSourceCommit) throw new Error("GOWM_RUNTIME_BINDING_SOURCE_COMMIT_MISMATCH");
  if (runtimeVersion !== expectedGowmRuntimeVersion) throw new Error("GOWM_RUNTIME_BINDING_RUNTIME_VERSION_MISMATCH");
  if (gatewayContractVersion !== expectedGatewayContractVersion) throw new Error("GOWM_RUNTIME_BINDING_GATEWAY_CONTRACT_VERSION_MISMATCH");
  if (runtime["sourceCommit"] !== runtimeSourceCommit || runtime["runtimeVersion"] !== runtimeVersion ||
      runtime["gatewayContractVersion"] !== gatewayContractVersion ||
      runtime["consumerPackage"] !== "@gowm/world-gateway-contracts@0.6.3") {
    throw new Error("GOWM_RUNTIME_BINDING_DIRECT_REPORT_TUPLE_MISMATCH");
  }
  const imageDigest = digest(binding["imageDigest"], "GOWM_RUNTIME_BINDING_IMAGE_DIGEST_INVALID");
  const instanceEvidenceHash = digest(binding["instanceEvidenceHash"], "GOWM_RUNTIME_BINDING_INSTANCE_EVIDENCE_HASH_INVALID");
  const instanceEvidencePayloadHash = digest(binding["instanceEvidencePayloadHash"],
    "GOWM_RUNTIME_BINDING_INSTANCE_EVIDENCE_PAYLOAD_HASH_INVALID");
  const imageBuildEvidenceHash = digest(binding["imageBuildEvidenceHash"],
    "GOWM_RUNTIME_BINDING_IMAGE_BUILD_EVIDENCE_HASH_INVALID");
  const imageBuildEvidencePayloadHash = digest(binding["imageBuildEvidencePayloadHash"],
    "GOWM_RUNTIME_BINDING_IMAGE_BUILD_EVIDENCE_PAYLOAD_HASH_INVALID");
  const sourceTree = string(binding["sourceTree"], "GOWM_RUNTIME_BINDING_SOURCE_TREE_MISSING");
  if (!/^[0-9a-f]{40}$/u.test(sourceTree)) throw new Error("GOWM_RUNTIME_BINDING_SOURCE_TREE_INVALID");
  const observedAt = string(binding["observedAt"], "GOWM_RUNTIME_BINDING_OBSERVED_AT_MISSING");
  const observedTime = Date.parse(observedAt);
  const maximumBindingAgeMs = Number(process.env["GOWM_RUNTIME_BINDING_MAX_AGE_MS"] ?? "900000");
  if (!Number.isFinite(observedTime) || !Number.isSafeInteger(maximumBindingAgeMs) ||
      maximumBindingAgeMs < 60_000 || maximumBindingAgeMs > 3_600_000) {
    throw new Error("GOWM_RUNTIME_BINDING_OBSERVED_AT_INVALID");
  }
  if (observedTime > Date.now() + 60_000 || Date.now() - observedTime > maximumBindingAgeMs) {
    throw new Error("GOWM_RUNTIME_BINDING_STALE");
  }
  const runtimeBindingHash = digest(binding["bindingHash"], "GOWM_RUNTIME_BINDING_HASH_INVALID");
  const { bindingHash: _bindingHash, ...bindingPayload } = binding;
  if (canonicalSha256(bindingPayload) !== runtimeBindingHash) throw new Error("GOWM_RUNTIME_BINDING_HASH_MISMATCH");

  const instanceEvidencePath = string(binding["instanceEvidencePath"], "GOWM_RUNTIME_BINDING_INSTANCE_EVIDENCE_PATH_MISSING");
  if (isAbsolute(instanceEvidencePath)) throw new Error("GOWM_RUNTIME_BINDING_INSTANCE_EVIDENCE_PATH_ABSOLUTE");
  const resolvedInstanceEvidencePath = resolve(repositoryRoot, instanceEvidencePath);
  const relativeInstanceEvidencePath = relative(repositoryRoot, resolvedInstanceEvidencePath);
  if (relativeInstanceEvidencePath === ".." || relativeInstanceEvidencePath.startsWith(`..${sep}`) ||
      isAbsolute(relativeInstanceEvidencePath)) {
    throw new Error("GOWM_RUNTIME_BINDING_INSTANCE_EVIDENCE_OUTSIDE_REPOSITORY");
  }
  const instanceEvidenceBytes = readFileSync(resolvedInstanceEvidencePath);
  if (sha256(instanceEvidenceBytes) !== instanceEvidenceHash) throw new Error("GOWM_RUNTIME_INSTANCE_EVIDENCE_FILE_HASH_MISMATCH");
  const instanceEvidence = object(JSON.parse(instanceEvidenceBytes.toString("utf8")) as unknown,
    "GOWM_RUNTIME_INSTANCE_EVIDENCE_INVALID_JSON");
  const instancePayloadHash = digest(instanceEvidence["evidenceHash"], "GOWM_RUNTIME_INSTANCE_EVIDENCE_PAYLOAD_HASH_INVALID");
  const { evidenceHash: _instanceEvidenceHash, ...instancePayload } = instanceEvidence;
  if (instancePayloadHash !== instanceEvidencePayloadHash || canonicalSha256(instancePayload) !== instancePayloadHash) {
    throw new Error("GOWM_RUNTIME_INSTANCE_EVIDENCE_PAYLOAD_HASH_MISMATCH");
  }
  if (instanceEvidence["schemaVersion"] !== "wsgs-gowm-runtime-binding/1.0" ||
      instanceEvidence["bindingStatus"] !== "PASS" || instanceEvidence["sourceCommit"] !== runtimeSourceCommit ||
      instanceEvidence["runtimeVersion"] !== runtimeVersion ||
      instanceEvidence["gatewayContractVersion"] !== gatewayContractVersion ||
      instanceEvidence["imageDigest"] !== imageDigest || instanceEvidence["observedAt"] !== observedAt ||
      instanceEvidence["appContainerCount"] !== 6 || instanceEvidence["allAppContainersHealthy"] !== true ||
      instanceEvidence["gatewayPortBindingVerified"] !== true) {
    throw new Error("GOWM_RUNTIME_INSTANCE_EVIDENCE_BINDING_MISMATCH");
  }
  const instanceImageBuild = object(instanceEvidence["imageBuildEvidence"],
    "GOWM_RUNTIME_INSTANCE_IMAGE_BUILD_EVIDENCE_MISSING");
  if (instanceImageBuild["status"] !== "PASS" || instanceImageBuild["sourceTree"] !== sourceTree ||
      instanceImageBuild["reportFileHash"] !== imageBuildEvidenceHash ||
      instanceImageBuild["reportPayloadHash"] !== imageBuildEvidencePayloadHash) {
    throw new Error("GOWM_RUNTIME_INSTANCE_IMAGE_BUILD_EVIDENCE_MISMATCH");
  }

  const imageBuildEvidencePath = string(binding["imageBuildEvidencePath"],
    "GOWM_RUNTIME_BINDING_IMAGE_BUILD_EVIDENCE_PATH_MISSING");
  if (isAbsolute(imageBuildEvidencePath)) throw new Error("GOWM_RUNTIME_BINDING_IMAGE_BUILD_EVIDENCE_PATH_ABSOLUTE");
  const resolvedImageBuildEvidencePath = resolve(repositoryRoot, imageBuildEvidencePath);
  const relativeImageBuildEvidencePath = relative(repositoryRoot, resolvedImageBuildEvidencePath);
  if (relativeImageBuildEvidencePath === ".." || relativeImageBuildEvidencePath.startsWith(`..${sep}`) ||
      isAbsolute(relativeImageBuildEvidencePath)) {
    throw new Error("GOWM_RUNTIME_BINDING_IMAGE_BUILD_EVIDENCE_OUTSIDE_REPOSITORY");
  }
  const imageBuildBytes = readFileSync(resolvedImageBuildEvidencePath);
  if (sha256(imageBuildBytes) !== imageBuildEvidenceHash) throw new Error("GOWM_RUNTIME_IMAGE_BUILD_FILE_HASH_MISMATCH");
  const imageBuildReport = object(JSON.parse(imageBuildBytes.toString("utf8")) as unknown,
    "GOWM_RUNTIME_IMAGE_BUILD_EVIDENCE_INVALID_JSON");
  const imageBuildPayloadHash = digest(imageBuildReport["evidenceHash"],
    "GOWM_RUNTIME_IMAGE_BUILD_EVIDENCE_PAYLOAD_HASH_INVALID");
  const { evidenceHash: _imageBuildEvidenceHash, ...imageBuildPayload } = imageBuildReport;
  if (imageBuildPayloadHash !== imageBuildEvidencePayloadHash ||
      canonicalSha256(imageBuildPayload) !== imageBuildPayloadHash) {
    throw new Error("GOWM_RUNTIME_IMAGE_BUILD_EVIDENCE_PAYLOAD_HASH_MISMATCH");
  }
  const imageBuildGeneratedAt = string(imageBuildReport["generatedAt"], "GOWM_RUNTIME_IMAGE_BUILD_GENERATED_AT_MISSING");
  if (!Number.isFinite(Date.parse(imageBuildGeneratedAt)) ||
      imageBuildReport["schemaVersion"] !== "wsgs-gowm-runtime-image-build/1.0" ||
      imageBuildReport["status"] !== "PASS" ||
      imageBuildReport["sourceCommit"] !== runtimeSourceCommit || imageBuildReport["runtimeVersion"] !== runtimeVersion ||
      imageBuildReport["sourceTree"] !== sourceTree || imageBuildReport["runtimeImageDigest"] !== imageDigest ||
      imageBuildReport["tagIndependentContentMatch"] !== true ||
      imageBuildReport["independentBuildContentHash"] !== imageBuildReport["runtimeContentHash"] ||
      !/^sha256:[0-9a-f]{64}$/u.test(String(imageBuildReport["imageDigest"] ?? "")) ||
      !/^sha256:[0-9a-f]{64}$/u.test(String(imageBuildReport["independentBuildContentHash"] ?? ""))) {
    throw new Error("GOWM_RUNTIME_IMAGE_BUILD_EVIDENCE_BINDING_MISMATCH");
  }
  if (instanceImageBuild["reportPath"] !== imageBuildEvidencePath ||
      instanceImageBuild["generatedAt"] !== imageBuildGeneratedAt) {
    throw new Error("GOWM_RUNTIME_INSTANCE_IMAGE_BUILD_CROSS_REPORT_MISMATCH");
  }

  return {
    bindingStatus: "PASS",
    sourceCommit: runtimeSourceCommit,
    runtimeVersion,
    gatewayContractVersion,
    imageDigest,
    instanceEvidenceHash,
    instanceEvidencePayloadHash,
    imageBuildEvidenceHash,
    imageBuildEvidencePayloadHash,
    imageBuildEvidencePathHash: safeId(imageBuildEvidencePath),
    imageBuildGeneratedAt,
    sourceTree,
    observedAt,
    runtimeBindingHash,
    runtimeBindingHashBasis: "DIRECT_REPORT_RUNTIME_BINDING_CANONICAL_JSON_WITHOUT_BINDING_HASH",
    sourceReportFileHash: sha256(reportBytes),
    sourceReportEvidenceHash: reportEvidenceHash,
    sourceReportPathHash: safeId(normalizedReportPath)
  };
}

interface VerifiedWsgsRuntimeImageBuildEvidence {
  status: "PASS";
  sourceCommit: string;
  sourceTree: string;
  runtimeVersion: "0.2.1";
  imageDigest: `sha256:${string}`;
  generatedAt: string;
  reportFileHash: `sha256:${string}`;
  reportPayloadHash: `sha256:${string}`;
  reportPathHash: `sha256:${string}`;
}

interface WsgsProcessServiceBinding {
  service: "grounding-api" | "grounding-worker" | "postgres";
  containerIdentityHash: `sha256:${string}`;
  imageDigest: `sha256:${string}`;
  running: true;
  health: "healthy";
}

interface VerifiedWsgsProcessBinding {
  schemaVersion: "wsgs-external-process-binding/1.0";
  bindingStatus: "PASS";
  observedAt: string;
  executionMode: "EXTERNAL_PROCESS";
  sourceCommit: string;
  sourceTree: string;
  runtimeVersion: "0.2.1";
  composeProjectHash: `sha256:${string}`;
  serviceSetHash: `sha256:${string}`;
  apiEndpointHash: `sha256:${string}`;
  distinctContainerCount: 3;
  apiWorkerImageDigest: `sha256:${string}`;
  apiPortBindingVerified: true;
  containerCommandSetVerified: true;
  runtimeEnvironmentAgreementVerified: true;
  gowmGatewayEndpointHash: `sha256:${string}`;
  postgresConnectionVerified: true;
  isolatedDatabaseAttested: true;
  initialGroundingRowCount: 0;
  databaseIdentityHash: `sha256:${string}`;
  databaseServerAddressHash: `sha256:${string}`;
  databaseServerVersionHash: `sha256:${string}`;
  services: WsgsProcessServiceBinding[];
  runtimeImageBuildEvidence: VerifiedWsgsRuntimeImageBuildEvidence;
  redaction: {
    credentialsIncluded: false;
    rawContainerIdsIncluded: false;
    rawDatabaseIdentityIncluded: false;
    internalTopologyIncluded: false;
    localPathsIncluded: false;
  };
  bindingHash: `sha256:${string}`;
}

interface ReportedWsgsProcessBinding extends VerifiedWsgsProcessBinding {
  reportFileHash: `sha256:${string}`;
  reportEvidenceHash: `sha256:${string}`;
  reportPathHash: `sha256:${string}`;
}

interface DockerContainerInspection {
  Id?: string;
  Image?: string;
  Config?: { Cmd?: string[]; Env?: string[]; Labels?: Record<string, string> };
  State?: { Running?: boolean; Health?: { Status?: string } };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
    Networks?: Record<string, { IPAddress?: string }>;
  };
}

function containerEnvironmentValue(entry: DockerContainerInspection, name: string, code: string): string {
  const prefix = `${name}=`;
  const value = entry.Config?.Env?.find((candidate) => candidate.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(code);
  return value;
}

function loadVerifiedWsgsRuntimeImageBuildEvidence(
  expectedImageDigest: `sha256:${string}`,
  sourceBinding: VerifiedWsgsSourceBinding
): VerifiedWsgsRuntimeImageBuildEvidence {
  const reportPath = resolve(repositoryRoot, required("WSGS_RUNTIME_IMAGE_BUILD_REPORT"));
  const normalizedPath = repositoryRelativePath(reportPath, "WSGS_RUNTIME_IMAGE_BUILD_REPORT_OUTSIDE_REPOSITORY");
  const bytes = readFileSync(reportPath);
  const report = object(JSON.parse(bytes.toString("utf8")) as unknown, "WSGS_RUNTIME_IMAGE_BUILD_REPORT_INVALID_JSON");
  if (report["schemaVersion"] !== "wsgs-runtime-image-build/1.0") {
    throw new Error("WSGS_RUNTIME_IMAGE_BUILD_REPORT_SCHEMA_MISMATCH");
  }
  const reportPayloadHash = digest(report["evidenceHash"], "WSGS_RUNTIME_IMAGE_BUILD_REPORT_HASH_INVALID");
  const { evidenceHash: _evidenceHash, ...payload } = report;
  if (canonicalSha256(payload) !== reportPayloadHash) throw new Error("WSGS_RUNTIME_IMAGE_BUILD_REPORT_HASH_MISMATCH");
  const imageDigest = digest(report["imageDigest"], "WSGS_RUNTIME_IMAGE_BUILD_REPORT_IMAGE_INVALID");
  const reportSourceTree = string(report["sourceTree"], "WSGS_RUNTIME_IMAGE_BUILD_REPORT_TREE_MISSING");
  const generatedAt = string(report["generatedAt"], "WSGS_RUNTIME_IMAGE_BUILD_REPORT_TIME_MISSING");
  if (report["status"] !== "PASS" || report["sourceCommit"] !== sourceBinding.headCommit ||
      reportSourceTree !== sourceBinding.sourceTree || report["runtimeVersion"] !== expectedWsgsRuntimeVersion ||
      imageDigest !== expectedImageDigest || !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error("WSGS_RUNTIME_IMAGE_BUILD_REPORT_BINDING_MISMATCH");
  }
  return {
    status: "PASS",
    sourceCommit: sourceBinding.headCommit,
    sourceTree: sourceBinding.sourceTree,
    runtimeVersion: expectedWsgsRuntimeVersion as "0.2.1",
    imageDigest,
    generatedAt,
    reportFileHash: sha256(bytes),
    reportPayloadHash,
    reportPathHash: safeId(normalizedPath)
  };
}

async function observeExternalWsgsProcessBinding(
  sourceBinding: VerifiedWsgsSourceBinding
): Promise<{ baseUrl: string; binding: VerifiedWsgsProcessBinding }> {
  if (!formalExternalProcessMode || !formalR1R5Only) throw new Error("WSGS_EXTERNAL_PROCESS_BINDING_MODE_REQUIRED");
  if (required("WSGS_FORMAL_ISOLATED_DATABASE") !== "YES") throw new Error("WSGS_FORMAL_ISOLATED_DATABASE_REQUIRED");
  const composeProject = required("WSGS_RUNTIME_COMPOSE_PROJECT");
  if (!/^[a-z0-9][a-z0-9_-]{2,62}$/u.test(composeProject)) throw new Error("WSGS_RUNTIME_COMPOSE_PROJECT_INVALID");
  const apiUrl = new URL(required("WSGS_FORMAL_API_BASE_URL"));
  if (apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash || !["", "/"].includes(apiUrl.pathname)) {
    throw new Error("WSGS_FORMAL_API_BASE_URL_INVALID");
  }
  if (apiUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(apiUrl.hostname)) {
    throw new Error("WSGS_FORMAL_API_BASE_URL_NOT_LOOPBACK_HTTP");
  }
  const expectedServices = ["grounding-api", "grounding-worker", "postgres"] as const;
  let inspection: DockerContainerInspection[];
  try {
    const ids = execFileSync("docker", [
      "ps", "--quiet", "--filter", `label=com.docker.compose.project=${composeProject}`
    ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).trim().split(/\s+/u).filter(Boolean);
    if (ids.length < expectedServices.length) throw new Error("WSGS_RUNTIME_CONTAINER_SET_INCOMPLETE");
    inspection = JSON.parse(execFileSync("docker", ["inspect", ...ids], {
      encoding: "utf8", maxBuffer: 16 * 1024 * 1024
    })) as DockerContainerInspection[];
  } catch (error) {
    if (error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)) throw error;
    throw new Error("WSGS_RUNTIME_DOCKER_INSPECTION_FAILED");
  }
  const containers = expectedServices.map((service) => {
    const matches = inspection.filter((entry) => entry.Config?.Labels?.["com.docker.compose.service"] === service);
    if (matches.length !== 1) throw new Error("WSGS_RUNTIME_CONTAINER_SET_MISMATCH");
    return [service, matches[0]!] as const;
  });
  if (new Set(containers.map(([, entry]) => entry.Id)).size !== 3) {
    throw new Error("WSGS_RUNTIME_CONTAINERS_NOT_DISTINCT");
  }
  if (containers.some(([, entry]) => entry.State?.Running !== true || entry.State?.Health?.Status !== "healthy")) {
    throw new Error("WSGS_RUNTIME_CONTAINER_NOT_HEALTHY");
  }
  const api = containers.find(([service]) => service === "grounding-api")![1];
  const worker = containers.find(([service]) => service === "grounding-worker")![1];
  const postgres = containers.find(([service]) => service === "postgres")![1];
  const apiImageDigest = digest(api.Image, "WSGS_RUNTIME_API_IMAGE_INVALID");
  const workerImageDigest = digest(worker.Image, "WSGS_RUNTIME_WORKER_IMAGE_INVALID");
  const postgresImageDigest = digest(postgres.Image, "WSGS_RUNTIME_POSTGRES_IMAGE_INVALID");
  if (apiImageDigest !== workerImageDigest) throw new Error("WSGS_RUNTIME_API_WORKER_IMAGE_MISMATCH");
  for (const entry of [api, worker]) {
    if (entry.Config?.Labels?.["org.opencontainers.image.revision"] !== sourceBinding.headCommit ||
        entry.Config?.Labels?.["org.opencontainers.image.version"] !== expectedWsgsRuntimeVersion) {
      throw new Error("WSGS_RUNTIME_IMAGE_SOURCE_LABEL_MISMATCH");
    }
  }
  if (JSON.stringify(api.Config?.Cmd) !== JSON.stringify(["node", "services/grounding-api/dist/main.js"]) ||
      JSON.stringify(worker.Config?.Cmd) !== JSON.stringify(["node", "services/grounding-worker/dist/main.js"])) {
    throw new Error("WSGS_RUNTIME_CONTAINER_COMMAND_MISMATCH");
  }
  const apiDatabaseUrl = containerEnvironmentValue(api, "DATABASE_URL", "WSGS_RUNTIME_API_DATABASE_URL_MISSING");
  const workerDatabaseUrl = containerEnvironmentValue(worker, "DATABASE_URL", "WSGS_RUNTIME_WORKER_DATABASE_URL_MISSING");
  if (apiDatabaseUrl !== workerDatabaseUrl) throw new Error("WSGS_RUNTIME_API_WORKER_DATABASE_URL_MISMATCH");
  const apiGowmBaseUrl = containerEnvironmentValue(api, "GOWM_GATEWAY_BASE_URL", "WSGS_RUNTIME_API_GOWM_URL_MISSING");
  const workerGowmBaseUrl = containerEnvironmentValue(worker, "GOWM_GATEWAY_BASE_URL", "WSGS_RUNTIME_WORKER_GOWM_URL_MISSING");
  if (apiGowmBaseUrl !== workerGowmBaseUrl) throw new Error("WSGS_RUNTIME_API_WORKER_GOWM_URL_MISMATCH");
  const expectedPort = apiUrl.port || "80";
  const publishedPorts = api.NetworkSettings?.Ports?.["8080/tcp"] ?? [];
  if (!publishedPorts.some((entry) => entry.HostPort === expectedPort && ["127.0.0.1", "::1"].includes(entry.HostIp ?? ""))) {
    throw new Error("WSGS_RUNTIME_API_PORT_BINDING_MISMATCH");
  }
  const runtimeImageBuildEvidence = loadVerifiedWsgsRuntimeImageBuildEvidence(apiImageDigest, sourceBinding);
  const postgresAddresses = Object.values(postgres.NetworkSettings?.Networks ?? {})
    .flatMap((entry) => entry.IPAddress ? [entry.IPAddress] : []);
  if (postgresAddresses.length === 0) throw new Error("WSGS_RUNTIME_POSTGRES_NETWORK_BINDING_MISSING");
  const databaseState = await pool.query<{
    database_name: string;
    database_user: string;
    server_address: string | null;
    server_port: number;
    server_version: string;
    request_count: string;
    job_count: string;
    result_count: string;
  }>(`SELECT current_database() AS database_name,
             current_user AS database_user,
             host(inet_server_addr()) AS server_address,
             inet_server_port() AS server_port,
             current_setting('server_version') AS server_version,
             (SELECT count(*)::text FROM wsgs.grounding_request) AS request_count,
             (SELECT count(*)::text FROM wsgs.grounding_job) AS job_count,
             (SELECT count(*)::text FROM wsgs.grounding_result) AS result_count`);
  const database = databaseState.rows[0];
  if (!database?.server_address || !postgresAddresses.includes(database.server_address)) {
    throw new Error("WSGS_RUNTIME_POSTGRES_CONNECTION_CONTAINER_MISMATCH");
  }
  const initialGroundingRows = Number(database.request_count) + Number(database.job_count) + Number(database.result_count);
  if (!Number.isSafeInteger(initialGroundingRows) || initialGroundingRows !== 0) {
    throw new Error("WSGS_FORMAL_DATABASE_NOT_EMPTY");
  }
  const containerDatabaseUrl = new URL(apiDatabaseUrl);
  if (!["postgres:", "postgresql:"].includes(containerDatabaseUrl.protocol) || containerDatabaseUrl.hostname !== "postgres" ||
      decodeURIComponent(containerDatabaseUrl.username) !== database.database_user ||
      decodeURIComponent(containerDatabaseUrl.pathname.replace(/^\//u, "")) !== database.database_name ||
      (containerDatabaseUrl.port || "5432") !== String(database.server_port)) {
    throw new Error("WSGS_RUNTIME_DATABASE_URL_CONTAINER_BINDING_MISMATCH");
  }
  const serviceBindings: WsgsProcessServiceBinding[] = containers.map(([service, entry]) => ({
    service,
    containerIdentityHash: safeId(string(entry.Id, "WSGS_RUNTIME_CONTAINER_ID_MISSING")),
    imageDigest: service === "grounding-api" ? apiImageDigest
      : service === "grounding-worker" ? workerImageDigest : postgresImageDigest,
    running: true,
    health: "healthy"
  }));
  const payload = {
    schemaVersion: "wsgs-external-process-binding/1.0" as const,
    bindingStatus: "PASS" as const,
    observedAt: new Date().toISOString(),
    executionMode: "EXTERNAL_PROCESS" as const,
    sourceCommit: sourceBinding.headCommit,
    sourceTree: sourceBinding.sourceTree,
    runtimeVersion: expectedWsgsRuntimeVersion as "0.2.1",
    composeProjectHash: safeId(composeProject),
    serviceSetHash: canonicalSha256(expectedServices) as `sha256:${string}`,
    apiEndpointHash: safeId(apiUrl.origin),
    distinctContainerCount: 3 as const,
    apiWorkerImageDigest: apiImageDigest,
    apiPortBindingVerified: true as const,
    containerCommandSetVerified: true as const,
    runtimeEnvironmentAgreementVerified: true as const,
    gowmGatewayEndpointHash: safeId(apiGowmBaseUrl),
    postgresConnectionVerified: true as const,
    isolatedDatabaseAttested: true as const,
    initialGroundingRowCount: 0 as const,
    databaseIdentityHash: safeId(`${database.database_name}:${database.database_user}`),
    databaseServerAddressHash: safeId(`${database.server_address}:${database.server_port}`),
    databaseServerVersionHash: safeId(database.server_version),
    services: serviceBindings,
    runtimeImageBuildEvidence,
    redaction: {
      credentialsIncluded: false as const,
      rawContainerIdsIncluded: false as const,
      rawDatabaseIdentityIncluded: false as const,
      internalTopologyIncluded: false as const,
      localPathsIncluded: false as const
    }
  };
  return { baseUrl: apiUrl.origin, binding: { ...payload, bindingHash: evidenceCanonicalSha256(payload) } };
}

interface CaseEvidence {
  recipeId: string;
  requestHash: `sha256:${string}`;
  requestIdHash: `sha256:${string}`;
  groundingIdHash: `sha256:${string}`;
  jobIdHash: `sha256:${string}`;
  terminalStatus: string;
  resultHash: `sha256:${string}`;
  stageHashes: `sha256:${string}`[];
  completedStages: string[];
  planHashes: `sha256:${string}`[];
  upstreamResultHashes: `sha256:${string}`[];
  modelReceiptCount: number;
  worldQueryCount: number;
  segmentedWorldQueryCount: number;
  gatewaySegmentCount: number;
  segmentManifestHashes: `sha256:${string}`[];
  segmentPlanHashes: `sha256:${string}`[];
  segmentScopeHashes: `sha256:${string}`[];
  segmentBindings: Array<{
    operationKey: string;
    dataScopeHash: `sha256:${string}`;
    sourceLockHash: `sha256:${string}`;
    scopeAuthorityHash: `sha256:${string}`;
    upstreamResultHash: `sha256:${string}`;
    worldResultHash: `sha256:${string}`;
  }>;
  segmentDelegationBindingCount: number;
  segmentDelegationBindingsHash: `sha256:${string}`;
  admissionGatewayBinding: {
    contractCatalogRevision: `sha256:${string}`;
    semanticCatalogHash: `sha256:${string}`;
    bindingRevision: `sha256:${string}`;
    operationLockHash: `sha256:${string}`;
  };
  admissionSegmentedScopeAuthorityBinding: {
    schemaVersion: "1.0";
    authorityHash: `sha256:${string}`;
    foundationInstanceBindingHash: `sha256:${string}`;
    gdpsChecksumsHash: `sha256:${string}`;
  };
  gatewayExecutionCount: number;
  spatialExecutionCount: number;
  operationKeys: string[];
  operationStatuses: Array<{ operationKey: string; status: string; resultHash?: `sha256:${string}` }>;
  normalizedStatuses: string[];
  gatewayQueryIdHashes: `sha256:${string}`[];
  gatewayJobIdHashes: `sha256:${string}`[];
  gatewayReceiptIdHashes: `sha256:${string}`[];
  gatewayEvidenceIdHashes: `sha256:${string}`[];
  productIds: string[];
  contentHashes: string[];
  selectedRecipeIds: string[];
  descriptorIds: string[];
  semanticCodes: string[];
  truncated: boolean;
  totalStageElapsedMs: number;
  compositionProof: {
    knownReferenceKeyHashes: `sha256:${string}`[];
    resolveReferenceKeyHashes: `sha256:${string}`[];
    validatedReferenceKeyHashes: `sha256:${string}`[];
    persistedReferenceKeyHashes: `sha256:${string}`[];
    worldQueryAnchorReferenceKeyHashes: `sha256:${string}`[];
    gatewayResolverReferenceKeyHashes: `sha256:${string}`[];
    gatewayWorldFactReferenceKeyHashes: `sha256:${string}`[];
    gatewayWorldFactReferenceObjectHashes: `sha256:${string}`[];
    directOperationKeys: string[];
    planOperationKeys: string[];
    planDataflowBindings: string[];
    gatewayNodeStatuses: Array<{ operationKey: string; status: string }>;
    nearbyRadiusMetres: number | null;
    spatialResultCount: number;
    ambiguityCount: number;
    ambiguityCandidateCount: number;
    directValidationProof: boolean;
    validationLeaseUsable: boolean;
    resolverOutputConsumedByValidation: boolean;
    resolverOutputConsumedByWorldQuery: boolean;
    worldOutputConsumedBySpatial: boolean;
    worldFactObjectIdentityPreserved: boolean;
    identityPreserved: boolean;
  };
  traceability: {
    status: "PASS";
    api: { postHttpStatus: 200 | 202; getHttpStatus: 200; requestHash: `sha256:${string}` };
    postgres: {
      requestPayloadHash: `sha256:${string}`;
      checkpointStateHash: `sha256:${string}`;
      resultBytesHash: `sha256:${string}`;
      resultHash: `sha256:${string}`;
    };
    worker: { outcome: "SUCCEEDED"; generationCount: number };
    pipeline: {
      operation: string;
      expectedStageCount: number;
      terminalEventCount: number;
      eventRecordCount: number;
      eventChainValid: true;
      stageOutputsMatchCheckpoint: true;
      checkpointLastCompletedStage: string;
      finalRecordHash: `sha256:${string}`;
    };
    gateway: {
      persistedWorldQueryCount: number;
      persistedSegmentCount: number;
      segmentedWorldQueryCount: number;
      persistedExecutionCount: number;
      planHashesMatchCheckpoint: true;
      upstreamHashesMatchCheckpoint: true;
    };
    persistence: { jobStatus: string; getMatchesPersistedResult: true };
  };
}

interface PrivateCaseRuntime {
  groundingId: string;
  terminalResult: JsonObject;
  checkpointState: Readonly<Record<string, unknown>>;
  runFingerprint: string;
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
  await applyMigrations(pool, resolve(repositoryRoot, "database", "migrations"));
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

async function fetchJson(
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: JsonObject; headers: Headers }> {
  const headers = new Headers(init?.headers);
  if (apiBearerToken) headers.set("authorization", `Bearer ${apiBearerToken}`);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  return {
    status: response.status,
    body: object(await response.json(), "API_RESPONSE_INVALID"),
    headers: response.headers
  };
}

async function pollExternalGrounding(baseUrl: string, groundingId: string): Promise<{ status: number; body: JsonObject }> {
  const configuredTimeout = Number(process.env["WSGS_FORMAL_POLL_TIMEOUT_MS"] ?? "180000");
  if (!Number.isSafeInteger(configuredTimeout) || configuredTimeout < 10_000 || configuredTimeout > 600_000) {
    throw new Error("WSGS_FORMAL_POLL_TIMEOUT_MS_INVALID");
  }
  const terminalStatuses = new Set([
    "COMPLETED", "PARTIAL", "NO_DATA", "UNRESOLVED", "AMBIGUOUS", "FAILED", "CANCELLED"
  ]);
  const deadline = Date.now() + configuredTimeout;
  while (Date.now() < deadline) {
    const fetched = await fetchJson(baseUrl, `/v1/groundings/${encodeURIComponent(groundingId)}`);
    if (fetched.status !== 200) throw new Error(`PUBLIC_API_GET_POLL_FAILED_${fetched.status}`);
    const status = string(fetched.body["status"], "GROUNDING_POLL_STATUS_MISSING");
    if (terminalStatuses.has(status)) return fetched;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("EXTERNAL_WORKER_GROUNDING_TIMEOUT");
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

function uniqueDigests(values: readonly `sha256:${string}`[]): `sha256:${string}`[] {
  return [...new Set(values)].sort() as `sha256:${string}`[];
}

function sameDigests(left: readonly `sha256:${string}`[], right: readonly `sha256:${string}`[]): boolean {
  return JSON.stringify(uniqueDigests(left)) === JSON.stringify(uniqueDigests(right));
}

function containsDigests(container: readonly `sha256:${string}`[], requiredValues: readonly `sha256:${string}`[]): boolean {
  const available = new Set(container);
  return requiredValues.length > 0 && requiredValues.every((entry) => available.has(entry));
}

function referenceKeyDigest(value: unknown): `sha256:${string}` | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const key = value as JsonObject;
  if (key["namespace"] !== "gowm" || typeof key["kind"] !== "string" ||
      typeof key["id"] !== "string" || typeof key["version"] !== "string") return null;
  return canonicalSha256({
    namespace: key["namespace"],
    kind: key["kind"],
    id: key["id"],
    version: key["version"]
  }) as `sha256:${string}`;
}

function referenceObjectDigest(value: unknown): `sha256:${string}` | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const key = value as JsonObject;
  if (key["namespace"] !== "gowm" || typeof key["kind"] !== "string" || typeof key["id"] !== "string") return null;
  return canonicalSha256({ namespace: key["namespace"], kind: key["kind"], id: key["id"] }) as `sha256:${string}`;
}

function referenceProductKeyHashes(value: unknown): `sha256:${string}`[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const products = (value as JsonObject)["referenceProducts"];
  if (!Array.isArray(products)) return [];
  return uniqueDigests(products.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const digest = referenceKeyDigest((entry as JsonObject)["referenceKey"]);
    return digest ? [digest] : [];
  }));
}

function referenceProductObjectHashes(value: unknown): `sha256:${string}`[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const products = (value as JsonObject)["referenceProducts"];
  if (!Array.isArray(products)) return [];
  return uniqueDigests(products.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const digest = referenceObjectDigest((entry as JsonObject)["referenceKey"]);
    return digest ? [digest] : [];
  }));
}

function knownReferenceKeyHashes(checkpointState: Readonly<Record<string, unknown>>): `sha256:${string}`[] {
  const loaded = checkpointState["LOAD_CONTEXT"];
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) return [];
  const known = (loaded as JsonObject)["knownWorldReferences"];
  if (!Array.isArray(known)) return [];
  return uniqueDigests(known.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const digest = referenceKeyDigest((entry as JsonObject)["referenceKey"]);
    return digest ? [digest] : [];
  }));
}

function ambiguityFacts(value: unknown): { count: number; candidateCount: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { count: 0, candidateCount: 0 };
  const ambiguities = (value as JsonObject)["ambiguities"];
  if (!Array.isArray(ambiguities)) return { count: 0, candidateCount: 0 };
  return {
    count: ambiguities.length,
    candidateCount: ambiguities.reduce((sum, raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return sum;
      const candidates = (raw as JsonObject)["candidateProductIds"];
      return sum + (Array.isArray(candidates) ? candidates.length : 0);
    }, 0)
  };
}

function compiledWorldQueryFacts(value: unknown): {
  anchorReferenceKeyHashes: `sha256:${string}`[];
  operationKeys: string[];
  dataflowBindings: string[];
  planHashes: `sha256:${string}`[];
  nearbyRadiiMetres: number[];
} {
  const empty = {
    anchorReferenceKeyHashes: [], operationKeys: [], dataflowBindings: [], planHashes: [], nearbyRadiiMetres: []
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const compiled = (value as JsonObject)["compiled"];
  if (!Array.isArray(compiled)) return empty;
  const anchors: `sha256:${string}`[] = [];
  const operationKeys = new Set<string>();
  const dataflowBindings = new Set<string>();
  const planHashes: `sha256:${string}`[] = [];
  const nearbyRadiiMetres: number[] = [];
  for (const rawEntry of compiled) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
    const entry = rawEntry as JsonObject;
    if (entry["status"] !== "COMPILED") continue;
    if (typeof entry["planHash"] === "string" && /^sha256:[0-9a-f]{64}$/u.test(entry["planHash"])) {
      planHashes.push(entry["planHash"] as `sha256:${string}`);
    }
    const submission = entry["submission"];
    if (!submission || typeof submission !== "object" || Array.isArray(submission)) continue;
    const submissionObject = submission as JsonObject;
    const parameters = submissionObject["parameters"];
    if (parameters && typeof parameters === "object" && !Array.isArray(parameters) &&
        typeof (parameters as JsonObject)["distanceM"] === "number" &&
        Number.isFinite((parameters as JsonObject)["distanceM"])) {
      nearbyRadiiMetres.push((parameters as JsonObject)["distanceM"] as number);
    }
    const operationInput = parameters && typeof parameters === "object" && !Array.isArray(parameters)
      ? (parameters as JsonObject)["operationInput"] : undefined;
    const context = operationInput && typeof operationInput === "object" && !Array.isArray(operationInput)
      ? (operationInput as JsonObject)["context"] : undefined;
    const anchorKeys = context && typeof context === "object" && !Array.isArray(context)
      ? (context as JsonObject)["anchorReferenceKeys"] : undefined;
    if (Array.isArray(anchorKeys)) {
      for (const anchor of anchorKeys) {
        const digest = referenceKeyDigest(anchor);
        if (digest) anchors.push(digest);
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
        if (sourceOperation) {
          dataflowBindings.add(`${sourceOperation}:${binding["outputPort"]}->${targetOperation}:${inputName}`);
        }
      }
    }
  }
  return {
    anchorReferenceKeyHashes: uniqueDigests(anchors),
    operationKeys: [...operationKeys].sort(),
    dataflowBindings: [...dataflowBindings].sort(),
    planHashes: uniqueDigests(planHashes),
    nearbyRadiiMetres: [...new Set(nearbyRadiiMetres)].sort((left, right) => left - right)
  };
}

function gatewayEnvelopeOutputValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const output = (value as JsonObject)["output"];
  return output && typeof output === "object" && !Array.isArray(output)
    ? (output as JsonObject)["value"]
    : undefined;
}

function gatewayResolverHashes(value: unknown): `sha256:${string}`[] {
  const output = gatewayEnvelopeOutputValue(value);
  if (!output || typeof output !== "object" || Array.isArray(output)) return [];
  const resolutions = (output as JsonObject)["resolutions"];
  if (!Array.isArray(resolutions)) return [];
  return uniqueDigests(resolutions.flatMap((rawResolution) => {
    if (!rawResolution || typeof rawResolution !== "object" || Array.isArray(rawResolution)) return [];
    const candidates = (rawResolution as JsonObject)["candidates"];
    if (!Array.isArray(candidates)) return [];
    return candidates.flatMap((rawCandidate) => {
      if (!rawCandidate || typeof rawCandidate !== "object" || Array.isArray(rawCandidate)) return [];
      const descriptor = (rawCandidate as JsonObject)["candidate"];
      if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) return [];
      const digest = referenceKeyDigest((descriptor as JsonObject)["referenceKey"]);
      return digest ? [digest] : [];
    });
  }));
}

function gatewayWorldFactHashes(value: unknown): {
  referenceKeyHashes: `sha256:${string}`[];
  referenceObjectHashes: `sha256:${string}`[];
} {
  const output = gatewayEnvelopeOutputValue(value);
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return { referenceKeyHashes: [], referenceObjectHashes: [] };
  }
  const outputObject = output as JsonObject;
  const topLevelReference = referenceKeyDigest(outputObject["referenceKey"]);
  const topLevelObject = referenceObjectDigest(outputObject["referenceKey"]);
  const facts = outputObject["facts"];
  const factReferences = !Array.isArray(facts) ? [] : facts.flatMap((rawFact) => {
    if (!rawFact || typeof rawFact !== "object" || Array.isArray(rawFact)) return [];
    const digest = referenceKeyDigest((rawFact as JsonObject)["referenceKey"]);
    return digest ? [digest] : [];
  });
  const factObjects = !Array.isArray(facts) ? [] : facts.flatMap((rawFact) => {
    if (!rawFact || typeof rawFact !== "object" || Array.isArray(rawFact)) return [];
    const digest = referenceObjectDigest((rawFact as JsonObject)["referenceKey"]);
    return digest ? [digest] : [];
  });
  return {
    referenceKeyHashes: uniqueDigests([...(topLevelReference ? [topLevelReference] : []), ...factReferences]),
    referenceObjectHashes: uniqueDigests([...(topLevelObject ? [topLevelObject] : []), ...factObjects])
  };
}

function gatewayWorldQueryFacts(value: unknown): {
  resolverReferenceKeyHashes: `sha256:${string}`[];
  worldFactReferenceKeyHashes: `sha256:${string}`[];
  worldFactReferenceObjectHashes: `sha256:${string}`[];
  nodeStatuses: Array<{ operationKey: string; status: string }>;
  upstreamResultHashes: `sha256:${string}`[];
  spatialResultCount: number;
} {
  const empty = {
    resolverReferenceKeyHashes: [], worldFactReferenceKeyHashes: [], worldFactReferenceObjectHashes: [],
    nodeStatuses: [], upstreamResultHashes: [],
    spatialResultCount: 0
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const outcomes = (value as JsonObject)["outcomes"];
  if (!Array.isArray(outcomes)) return empty;
  const resolverHashes: `sha256:${string}`[] = [];
  const worldFactHashes: `sha256:${string}`[] = [];
  const worldFactObjectHashes: `sha256:${string}`[] = [];
  const nodeStatuses: Array<{ operationKey: string; status: string }> = [];
  const upstreamResultHashes: `sha256:${string}`[] = [];
  let spatialResultCount = 0;
  for (const rawOutcome of outcomes) {
    if (!rawOutcome || typeof rawOutcome !== "object" || Array.isArray(rawOutcome)) continue;
    const outcome = rawOutcome as JsonObject;
    if (typeof outcome["resultHash"] === "string" && /^sha256:[0-9a-f]{64}$/u.test(outcome["resultHash"])) {
      upstreamResultHashes.push(outcome["resultHash"] as `sha256:${string}`);
    }
    const worlds: unknown[] = [];
    const segmented = outcome["segmentedExecution"];
    if (segmented && typeof segmented === "object" && !Array.isArray(segmented) &&
        (segmented as JsonObject)["executionMode"] === "GATEWAY_SEGMENTED_BY_TRUSTED_DATA_SCOPE") {
      const segments = (segmented as JsonObject)["segments"];
      if (Array.isArray(segments)) {
        worlds.push(...segments.flatMap((raw) => raw && typeof raw === "object" && !Array.isArray(raw)
          ? [(raw as JsonObject)["worldResult"]] : []));
      }
    } else {
      const material = outcome["encryptedCheckpointEvidenceMaterial"];
      if (material && typeof material === "object" && !Array.isArray(material)) {
        const protectedMaterial = material as JsonObject;
        const terminal = protectedMaterial["terminal"];
        worlds.push(protectedMaterial["responseStatus"] === 200
          ? protectedMaterial["response"]
          : terminal && typeof terminal === "object" && !Array.isArray(terminal)
            ? (terminal as JsonObject)["result"]
            : undefined);
      }
    }
    for (const world of worlds) {
      if (!world || typeof world !== "object" || Array.isArray(world)) continue;
      const nodes = (world as JsonObject)["nodes"];
      if (!Array.isArray(nodes)) continue;
      for (const rawNode of nodes) {
      if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) continue;
      const node = rawNode as JsonObject;
      const operation = node["operation"];
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) continue;
      const operationId = (operation as JsonObject)["operationId"];
      const operationVersion = (operation as JsonObject)["operationVersion"];
      if (typeof operationId !== "string" || typeof operationVersion !== "string" || typeof node["status"] !== "string") continue;
      const operationKey = `${operationId}@${operationVersion}`;
      nodeStatuses.push({ operationKey, status: node["status"] });
      if (operationId === "reference.resolve") resolverHashes.push(...gatewayResolverHashes(node["result"]));
      if (operationId === "world.get-current-state" || operationId === "world.get-geometry") {
        const worldFacts = gatewayWorldFactHashes(node["result"]);
        worldFactHashes.push(...worldFacts.referenceKeyHashes);
        worldFactObjectHashes.push(...worldFacts.referenceObjectHashes);
      }
        if (operationId.startsWith("spatial.")) {
          const spatialValue = gatewayEnvelopeOutputValue(node["result"]);
          if (spatialValue && typeof spatialValue === "object" && !Array.isArray(spatialValue) &&
              Array.isArray((spatialValue as JsonObject)["objects"])) {
            spatialResultCount += ((spatialValue as JsonObject)["objects"] as unknown[]).length;
          }
        }
      }
    }
  }
  return {
    resolverReferenceKeyHashes: uniqueDigests(resolverHashes),
    worldFactReferenceKeyHashes: uniqueDigests(worldFactHashes),
    worldFactReferenceObjectHashes: uniqueDigests(worldFactObjectHashes),
    nodeStatuses,
    upstreamResultHashes: uniqueDigests(upstreamResultHashes),
    spatialResultCount
  };
}

function checkpointSegmentBindings(value: unknown): CaseEvidence["segmentBindings"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const outcomes = (value as JsonObject)["outcomes"];
  if (!Array.isArray(outcomes)) return [];
  const bindings: CaseEvidence["segmentBindings"] = [];
  for (const rawOutcome of outcomes) {
    if (!rawOutcome || typeof rawOutcome !== "object" || Array.isArray(rawOutcome)) continue;
    const segmentedValue = (rawOutcome as JsonObject)["segmentedExecution"];
    if (segmentedValue === undefined) continue;
    const segmented = object(segmentedValue, "SEGMENTED_CHECKPOINT_INVALID");
    if (segmented["schemaVersion"] !== "wsgs-segmented-world-query-execution/1.0" ||
        segmented["executionMode"] !== "GATEWAY_SEGMENTED_BY_TRUSTED_DATA_SCOPE" ||
        !Array.isArray(segmented["segments"])) {
      throw new Error("SEGMENTED_CHECKPOINT_INVALID");
    }
    const scopeAuthorityHash = digest(segmented["scopeAuthorityHash"], "SEGMENTED_CHECKPOINT_AUTHORITY_INVALID");
    for (const rawSegment of segmented["segments"]) {
      const segment = object(rawSegment, "SEGMENTED_CHECKPOINT_SEGMENT_INVALID");
      const worldResult = object(segment["worldResult"], "SEGMENTED_CHECKPOINT_WORLD_RESULT_INVALID");
      bindings.push({
        operationKey: string(segment["operationKey"], "SEGMENTED_CHECKPOINT_OPERATION_INVALID"),
        dataScopeHash: safeId(string(segment["dataScope"], "SEGMENTED_CHECKPOINT_SCOPE_INVALID")),
        sourceLockHash: digest(segment["sourceLockHash"], "SEGMENTED_CHECKPOINT_SOURCE_LOCK_INVALID"),
        scopeAuthorityHash,
        upstreamResultHash: digest(worldResult["outputHash"], "SEGMENTED_CHECKPOINT_RESULT_HASH_INVALID"),
        worldResultHash: digest(
          canonicalSha256(worldResult),
          "SEGMENTED_CHECKPOINT_WORLD_RESULT_HASH_INVALID"
        )
      });
    }
  }
  return bindings;
}

function compositionProof(
  checkpointState: Readonly<Record<string, unknown>>,
  terminalResult: JsonObject
): CaseEvidence["compositionProof"] {
  const resolved = checkpointState["REFERENCE_RESOLVE"];
  const validated = checkpointState["REFERENCE_VALIDATE"];
  const compiled = compiledWorldQueryFacts(checkpointState["WORLD_QUERY_COMPILE"]);
  const gateway = gatewayWorldQueryFacts(checkpointState["GOWM_EXECUTE"]);
  const knownReferenceHashes = knownReferenceKeyHashes(checkpointState);
  const resolveReferenceKeyHashes = referenceProductKeyHashes(resolved);
  const resolveReferenceObjectHashes = referenceProductObjectHashes(resolved);
  const validatedReferenceKeyHashes = referenceProductKeyHashes(validated);
  const persistedReferenceKeyHashes = referenceProductKeyHashes(terminalResult);
  const validationProducts = validated && typeof validated === "object" && !Array.isArray(validated) &&
    Array.isArray((validated as JsonObject)["referenceProducts"])
    ? (validated as JsonObject)["referenceProducts"] as JsonObject[] : [];
  const rawValidationResults = validated && typeof validated === "object" && !Array.isArray(validated)
    ? (validated as JsonObject)["validationResults"] : undefined;
  const validationResults = Array.isArray(rawValidationResults)
    ? rawValidationResults.filter((entry): entry is JsonObject => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : [];
  const directValidationProof = validationProducts.length > 0 &&
    validationProducts.every((product) => product["sourceOperation"] === "VALIDATE_REFERENCES" &&
      referenceKeyDigest(product["referenceKey"]) !== null) &&
    validationResults.length === validationProducts.length &&
    validationResults.every((entry) => entry["status"] === "VALID" && entry["revalidationRequired"] === false &&
      referenceKeyDigest(entry["referenceKey"]) !== null);
  const collectedAt = Date.now();
  const validationLeaseUsable = directValidationProof && validationProducts.every((product) =>
    product["revalidationRequired"] === false && typeof product["validUntil"] === "string" &&
    Number.isFinite(Date.parse(product["validUntil"] as string)) && Date.parse(product["validUntil"] as string) > collectedAt);
  const ambiguity = ambiguityFacts(validated ?? resolved);
  const resolverOutputConsumedByValidation = containsDigests(validatedReferenceKeyHashes, resolveReferenceKeyHashes);
  const resolverOutputConsumedByWorldQuery = resolveReferenceKeyHashes.length > 0 &&
    containsDigests(compiled.anchorReferenceKeyHashes, resolveReferenceKeyHashes) &&
    containsDigests(gateway.resolverReferenceKeyHashes, resolveReferenceKeyHashes);
  const worldOutputConsumedBySpatial = compiled.dataflowBindings.some((binding) =>
    /^world\.get-(?:current-state|geometry)@[^:]+:[^-]+->spatial\.[^:]+@/u.test(binding));
  const worldFactObjectIdentityPreserved = gateway.worldFactReferenceKeyHashes.length === 0 ||
    (resolveReferenceObjectHashes.length > 0 &&
      sameDigests(gateway.worldFactReferenceObjectHashes, resolveReferenceObjectHashes));
  const identityHashes = uniqueDigests([
    ...knownReferenceHashes,
    ...resolveReferenceKeyHashes,
    ...validatedReferenceKeyHashes,
    ...persistedReferenceKeyHashes,
    ...compiled.anchorReferenceKeyHashes,
    ...gateway.resolverReferenceKeyHashes
  ]);
  return {
    knownReferenceKeyHashes: knownReferenceHashes,
    resolveReferenceKeyHashes,
    validatedReferenceKeyHashes,
    persistedReferenceKeyHashes,
    worldQueryAnchorReferenceKeyHashes: compiled.anchorReferenceKeyHashes,
    gatewayResolverReferenceKeyHashes: gateway.resolverReferenceKeyHashes,
    gatewayWorldFactReferenceKeyHashes: gateway.worldFactReferenceKeyHashes,
    gatewayWorldFactReferenceObjectHashes: gateway.worldFactReferenceObjectHashes,
    directOperationKeys: [
      ...(resolveReferenceKeyHashes.length > 0 ? ["reference.resolve@1.0"] : []),
      ...(directValidationProof ? ["reference.validate@1.0"] : [])
    ],
    planOperationKeys: compiled.operationKeys,
    planDataflowBindings: compiled.dataflowBindings,
    gatewayNodeStatuses: gateway.nodeStatuses,
    nearbyRadiusMetres: compiled.nearbyRadiiMetres.length === 1 ? compiled.nearbyRadiiMetres[0]! : null,
    spatialResultCount: gateway.spatialResultCount,
    ambiguityCount: ambiguity.count,
    ambiguityCandidateCount: ambiguity.candidateCount,
    directValidationProof,
    validationLeaseUsable,
    resolverOutputConsumedByValidation,
    resolverOutputConsumedByWorldQuery,
    worldOutputConsumedBySpatial,
    worldFactObjectIdentityPreserved,
    identityPreserved: identityHashes.length === 1
  };
}

async function collect(
  groundingId: string,
  requestHash: `sha256:${string}`,
  terminalResult: JsonObject,
  persistedPayloadHash: `sha256:${string}` = requestHash,
  postHttpStatus: 200 | 202 = 202
): Promise<CaseEvidence> {
  const job = await pool.query<{
    job_id: string;
    request_id: string;
    job_status: string;
    stage_generation: number;
    run_fingerprint: string | null;
    state_hash: `sha256:${string}` | null;
    checkpoint_record_hash: `sha256:${string}` | null;
    last_completed_stage: string | null;
    payload_hash: `sha256:${string}`;
    result_status: string | null;
    result_hash: `sha256:${string}` | null;
    result_bytes: Buffer | null;
    immutable_locks: unknown;
    gowm_contract_catalog_revision: `sha256:${string}` | null;
    gowm_semantic_catalog_hash: `sha256:${string}` | null;
    gowm_operation_lock_hash: `sha256:${string}` | null;
  }>(
    `SELECT job.job_id, request.request_id, job.status AS job_status, job.stage_generation,
            checkpoint.run_fingerprint, checkpoint.state_hash,
            checkpoint.previous_record_hash AS checkpoint_record_hash,
            checkpoint.last_completed_stage, request.payload_hash,
            result.status AS result_status, result.result_hash, result.result_bytes,
            job.immutable_locks, request.gowm_contract_catalog_revision,
            request.gowm_semantic_catalog_hash, request.gowm_operation_lock_hash
       FROM wsgs.grounding_job AS job
       JOIN wsgs.grounding_request AS request ON request.grounding_id = job.grounding_id
       LEFT JOIN wsgs.pipeline_checkpoint AS checkpoint ON checkpoint.job_id = job.job_id
       LEFT JOIN wsgs.grounding_result AS result ON result.grounding_id = job.grounding_id
      WHERE job.grounding_id = $1`,
    [groundingId]
  );
  const jobRow = job.rows[0];
  if (!jobRow) throw new Error("GROUNDING_JOB_MISSING");
  const immutableLocks = object(jobRow.immutable_locks, "PERSISTED_IMMUTABLE_LOCKS_MISSING");
  const trustedCapabilitySnapshot = object(
    immutableLocks["trustedCapabilitySnapshot"],
    "PERSISTED_TRUSTED_CAPABILITY_SNAPSHOT_MISSING"
  );
  const admissionGatewayBinding: CaseEvidence["admissionGatewayBinding"] = {
    contractCatalogRevision: digest(
      trustedCapabilitySnapshot["contractCatalogRevision"],
      "PERSISTED_GATEWAY_CATALOG_REVISION_INVALID"
    ),
    semanticCatalogHash: digest(
      trustedCapabilitySnapshot["semanticCatalogHash"],
      "PERSISTED_GATEWAY_SEMANTIC_HASH_INVALID"
    ),
    bindingRevision: digest(
      trustedCapabilitySnapshot["bindingRevision"],
      "PERSISTED_GATEWAY_BINDING_REVISION_INVALID"
    ),
    operationLockHash: digest(
      trustedCapabilitySnapshot["southboundLockHash"],
      "PERSISTED_GATEWAY_OPERATION_LOCK_INVALID"
    )
  };
  if (jobRow.gowm_contract_catalog_revision !== admissionGatewayBinding.contractCatalogRevision ||
      jobRow.gowm_semantic_catalog_hash !== admissionGatewayBinding.semanticCatalogHash ||
      jobRow.gowm_operation_lock_hash !== admissionGatewayBinding.operationLockHash) {
    throw new Error("PERSISTED_GATEWAY_ADMISSION_BINDING_MISMATCH");
  }
  const rawSegmentedScopeAuthorityBinding = object(
    immutableLocks["segmentedScopeAuthorityBinding"],
    "PERSISTED_SEGMENTED_SCOPE_AUTHORITY_BINDING_MISSING"
  );
  if (rawSegmentedScopeAuthorityBinding["schemaVersion"] !== "1.0") {
    throw new Error("PERSISTED_SEGMENTED_SCOPE_AUTHORITY_BINDING_VERSION_INVALID");
  }
  const admissionSegmentedScopeAuthorityBinding: CaseEvidence["admissionSegmentedScopeAuthorityBinding"] = {
    schemaVersion: "1.0",
    authorityHash: digest(
      rawSegmentedScopeAuthorityBinding["authorityHash"],
      "PERSISTED_SEGMENTED_SCOPE_AUTHORITY_HASH_INVALID"
    ),
    foundationInstanceBindingHash: digest(
      rawSegmentedScopeAuthorityBinding["foundationInstanceBindingHash"],
      "PERSISTED_SEGMENTED_FOUNDATION_BINDING_HASH_INVALID"
    ),
    gdpsChecksumsHash: digest(
      rawSegmentedScopeAuthorityBinding["gdpsChecksumsHash"],
      "PERSISTED_SEGMENTED_GDPS_CHECKSUMS_HASH_INVALID"
    )
  };
  const events = await pool.query<{
    stage: string; status: string; output_hash: `sha256:${string}` | null;
    previous_record_hash: `sha256:${string}` | null; record_hash: `sha256:${string}`;
    elapsed_ms: number; generation: number; sequence: number;
  }>(
    `SELECT stage, status, output_hash, previous_record_hash, record_hash,
            elapsed_ms, generation, sequence
       FROM wsgs.pipeline_event WHERE grounding_id = $1 ORDER BY event_id`,
    [groundingId]
  );
  const terminalEvents = events.rows.filter((event) => event.status !== "STARTED");
  const queries = await pool.query<{
    plan_hash: `sha256:${string}`; upstream_result_hash: `sha256:${string}` | null;
    execution_mode: "SINGLE_GATEWAY_QUERY" | "SEGMENTED_GATEWAY_QUERIES";
    segment_manifest_hash: `sha256:${string}` | null;
  }>(
    `SELECT plan_hash, upstream_result_hash, execution_mode, segment_manifest_hash
       FROM wsgs.world_query WHERE grounding_id = $1 ORDER BY query_id`,
    [groundingId]
  );
  const segments = await pool.query<{
    operation_key: string;
    plan_hash: `sha256:${string}`;
    data_scope: string;
    source_lock_hash: `sha256:${string}`;
    scope_authority_hash: `sha256:${string}`;
    delegated_identity_hash: `sha256:${string}`;
    completion_delegated_identity_hash: `sha256:${string}` | null;
    upstream_result_hash: `sha256:${string}` | null;
    world_result_hash: `sha256:${string}` | null;
    response_status: number | null;
    finished_at: Date | null;
  }>(
    `SELECT operation_key, plan_hash, data_scope, source_lock_hash, scope_authority_hash,
             delegated_identity_hash, completion_delegated_identity_hash,
             upstream_result_hash, world_result_hash, response_status, finished_at
       FROM wsgs.world_query_segment WHERE grounding_id = $1 ORDER BY query_id, segment_index`,
    [groundingId]
  );
  const executions = await pool.query<{
    operation_id: string | null; operation_version: string | null;
    result_hash: `sha256:${string}` | null; normalized_status: string;
    gateway_query_id: string | null; gateway_job_id: string | null;
    receipt_ids: unknown; evidence_ids: unknown;
  }>(
    `SELECT operation_id, operation_version, result_hash, normalized_status, gateway_query_id, gateway_job_id,
            receipt_ids, evidence_ids
       FROM wsgs.gowm_execution WHERE grounding_id = $1 ORDER BY execution_id`,
    [groundingId]
  );
  const model = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM wsgs.model_receipt WHERE grounding_id = $1",
    [groundingId]
  );
  if (!jobRow.result_status || !jobRow.result_hash || !jobRow.result_bytes) throw new Error("GROUNDING_RESULT_MISSING");
  const checkpoint = jobRow.run_fingerprint
    ? await new PostgresPipelineJournal(pool, payloadCodec)
      .loadLatestCheckpoint(jobRow.job_id, jobRow.run_fingerprint)
    : null;
  if (!checkpoint) throw new Error("PIPELINE_CHECKPOINT_EVIDENCE_MISSING");
  if (!jobRow.state_hash || !jobRow.checkpoint_record_hash || !jobRow.last_completed_stage) {
    throw new Error("PIPELINE_CHECKPOINT_TRACE_MISSING");
  }
  const expectedStages = [...pipelinePlanForOperation(checkpoint.operation)];
  const completedStageEvents = terminalEvents.filter((event) => ["COMPLETED", "PARTIAL"].includes(event.status));
  const completedStages = completedStageEvents.map((event) => event.stage);
  if (JSON.stringify(completedStages) !== JSON.stringify(expectedStages)) throw new Error("PIPELINE_STAGE_SEQUENCE_MISMATCH");
  const eventChainValid = events.rows.every((event, index) =>
    index === 0
      ? event.previous_record_hash === null && event.sequence === 0
      : event.previous_record_hash === events.rows[index - 1]!.record_hash);
  if (!eventChainValid || events.rows.at(-1)?.record_hash !== jobRow.checkpoint_record_hash) {
    throw new Error("PIPELINE_EVENT_CHAIN_INVALID");
  }
  const stageOutputsMatchCheckpoint = completedStageEvents.every((event) =>
    event.output_hash !== null && event.output_hash === canonicalSha256(checkpoint.state[event.stage]));
  if (!stageOutputsMatchCheckpoint) throw new Error("PIPELINE_STAGE_OUTPUT_HASH_MISMATCH");
  if (canonicalSha256(checkpoint.state) !== jobRow.state_hash || checkpoint.lastCompletedStage !== jobRow.last_completed_stage ||
      expectedStages.at(-1) !== checkpoint.lastCompletedStage) {
    throw new Error("PIPELINE_CHECKPOINT_HASH_OR_STAGE_MISMATCH");
  }
  const resultBytesHash = sha256(jobRow.result_bytes);
  if (jobRow.payload_hash !== persistedPayloadHash || resultBytesHash !== canonicalSha256(terminalResult) ||
      jobRow.result_hash !== terminalResult["resultHash"] || jobRow.result_status !== terminalResult["status"] ||
      jobRow.job_status !== terminalResult["status"]) {
    throw new Error("POSTGRES_PERSISTED_RESULT_TRACE_MISMATCH");
  }
  const compiled = compiledWorldQueryFacts(checkpoint.state["WORLD_QUERY_COMPILE"]);
  const gateway = gatewayWorldQueryFacts(checkpoint.state["GOWM_EXECUTE"]);
  const persistedPlanHashes = queries.rows.map((row) => row.plan_hash);
  const persistedUpstreamHashes = queries.rows.flatMap((row) => row.upstream_result_hash ? [row.upstream_result_hash] : []);
  if (!sameDigests(compiled.planHashes, persistedPlanHashes)) throw new Error("PERSISTED_WORLD_QUERY_PLAN_HASH_MISMATCH");
  if (!sameDigests(gateway.upstreamResultHashes, persistedUpstreamHashes)) {
    throw new Error("PERSISTED_GATEWAY_RESULT_HASH_MISMATCH");
  }
  const segmentedQueries = queries.rows.filter((row) => row.execution_mode === "SEGMENTED_GATEWAY_QUERIES");
  if (segmentedQueries.some((row) => row.segment_manifest_hash === null) ||
      segments.rows.some((row) => row.upstream_result_hash === null || row.world_result_hash === null ||
        row.finished_at === null ||
        !/^sha256:[0-9a-f]{64}$/u.test(row.delegated_identity_hash) ||
        !row.completion_delegated_identity_hash ||
        !/^sha256:[0-9a-f]{64}$/u.test(row.completion_delegated_identity_hash) ||
        (row.response_status !== 200 && row.response_status !== 202))) {
    throw new Error("PERSISTED_SEGMENTED_GATEWAY_TRACE_INCOMPLETE");
  }
  if ((segmentedQueries.length === 0) !== (segments.rowCount === 0)) {
    throw new Error("PERSISTED_SEGMENTED_GATEWAY_TRACE_ORPHANED");
  }
  const persistedSegmentBindings: CaseEvidence["segmentBindings"] = segments.rows.map((row) => ({
    operationKey: row.operation_key,
    dataScopeHash: safeId(row.data_scope),
    sourceLockHash: digest(row.source_lock_hash, "PERSISTED_SEGMENT_SOURCE_LOCK_INVALID"),
    scopeAuthorityHash: digest(row.scope_authority_hash, "PERSISTED_SEGMENT_AUTHORITY_INVALID"),
    upstreamResultHash: digest(row.upstream_result_hash, "PERSISTED_SEGMENT_RESULT_HASH_INVALID"),
    worldResultHash: digest(row.world_result_hash, "PERSISTED_SEGMENT_WORLD_RESULT_HASH_INVALID")
  }));
  const checkpointBindings = checkpointSegmentBindings(checkpoint.state["GOWM_EXECUTE"]);
  if (evidenceCanonicalJson(persistedSegmentBindings) !== evidenceCanonicalJson(checkpointBindings)) {
    throw new Error("PERSISTED_SEGMENTED_GATEWAY_BINDING_MISMATCH");
  }
  const segmentDelegationBindings = segments.rows.map((row) => ({
    operationKey: row.operation_key,
    delegatedIdentityHash: digest(row.delegated_identity_hash, "PERSISTED_SEGMENT_DELEGATED_IDENTITY_INVALID"),
    completionDelegatedIdentityHash: digest(
      row.completion_delegated_identity_hash,
      "PERSISTED_SEGMENT_COMPLETION_IDENTITY_INVALID"
    )
  }));
  const named = collectNamedStrings(terminalResult, new Set(["productId", "contentHash"]));
  const planning = checkpoint.state["REQUIREMENT_PLAN"];
  const selectedRecipeValues = planning && typeof planning === "object" && !Array.isArray(planning)
    ? (planning as JsonObject)["selectedRecipeIds"]
    : undefined;
  const selectedRecipeIds = Array.isArray(selectedRecipeValues)
    ? selectedRecipeValues.filter((entry): entry is string => typeof entry === "string")
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
  const evidence: CaseEvidence = {
    recipeId: "",
    requestHash,
    requestIdHash: safeId(jobRow.request_id),
    groundingIdHash: safeId(groundingId),
    jobIdHash: safeId(jobRow.job_id),
    terminalStatus: jobRow.result_status,
    resultHash: jobRow.result_hash,
    stageHashes: terminalEvents.map((event) => event.output_hash ?? event.record_hash),
    completedStages,
    planHashes: persistedPlanHashes,
    upstreamResultHashes: persistedUpstreamHashes,
    modelReceiptCount: Number(model.rows[0]?.count ?? 0),
    worldQueryCount: queries.rowCount ?? 0,
    segmentedWorldQueryCount: segmentedQueries.length,
    gatewaySegmentCount: segments.rowCount ?? 0,
    segmentManifestHashes: segmentedQueries.flatMap((row) => row.segment_manifest_hash ? [row.segment_manifest_hash] : []),
    segmentPlanHashes: segments.rows.map((row) => row.plan_hash),
    segmentScopeHashes: [...new Set(segments.rows.map((row) => safeId(row.data_scope)))],
    segmentBindings: persistedSegmentBindings,
    segmentDelegationBindingCount: segmentDelegationBindings.length,
    segmentDelegationBindingsHash: evidenceCanonicalSha256(segmentDelegationBindings),
    admissionGatewayBinding,
    admissionSegmentedScopeAuthorityBinding,
    gatewayExecutionCount: executions.rowCount ?? 0,
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
    gatewayReceiptIdHashes: [...new Set(executions.rows.flatMap((row) => Array.isArray(row.receipt_ids)
      ? row.receipt_ids.map((entry) => safeId(string(entry, "GOWM_RECEIPT_ID_INVALID"))) : []))],
    gatewayEvidenceIdHashes: [...new Set(executions.rows.flatMap((row) => Array.isArray(row.evidence_ids)
      ? row.evidence_ids.map((entry) => safeId(string(entry, "GOWM_EVIDENCE_ID_INVALID"))) : []))],
    productIds: [...(named.get("productId") ?? [])].sort(),
    contentHashes: [...(named.get("contentHash") ?? [])].filter((entry) => /^sha256:[0-9a-f]{64}$/u.test(entry)).sort(),
    selectedRecipeIds: [...new Set(selectedRecipeIds)].sort(),
    descriptorIds: [...(checkpointNamed.get("descriptorId") ?? [])].sort(),
    semanticCodes: [...new Set(semanticCodes)].sort(),
    truncated: serializedResult.includes('"truncated":true'),
    totalStageElapsedMs: terminalEvents.reduce((sum, event) => sum + event.elapsed_ms, 0),
    compositionProof: compositionProof(checkpoint.state, terminalResult),
    traceability: {
      status: "PASS",
      api: { postHttpStatus, getHttpStatus: 200, requestHash },
      postgres: {
        requestPayloadHash: jobRow.payload_hash,
        checkpointStateHash: jobRow.state_hash,
        resultBytesHash,
        resultHash: jobRow.result_hash
      },
      worker: {
        outcome: "SUCCEEDED",
        generationCount: new Set(events.rows.map((event) => event.generation)).size
      },
      pipeline: {
        operation: checkpoint.operation,
        expectedStageCount: expectedStages.length,
        terminalEventCount: terminalEvents.length,
        eventRecordCount: events.rowCount ?? 0,
        eventChainValid: true,
        stageOutputsMatchCheckpoint: true,
        checkpointLastCompletedStage: jobRow.last_completed_stage,
        finalRecordHash: jobRow.checkpoint_record_hash
      },
      gateway: {
        persistedWorldQueryCount: queries.rowCount ?? 0,
        persistedSegmentCount: segments.rowCount ?? 0,
        segmentedWorldQueryCount: segmentedQueries.length,
        persistedExecutionCount: executions.rowCount ?? 0,
        planHashesMatchCheckpoint: true,
        upstreamHashesMatchCheckpoint: true
      },
      persistence: { jobStatus: jobRow.job_status, getMatchesPersistedResult: true }
    }
  };
  privateCaseRuntime.set(evidence, {
    groundingId,
    terminalResult,
    checkpointState: checkpoint.state,
    runFingerprint: checkpoint.runFingerprint
  });
  return evidence;
}

async function submitAndRun(
  baseUrl: string,
  executor: PipelineStageExecutor | undefined,
  recipeId: string,
  body: JsonObject,
  acceptedStatuses: readonly string[],
  contractHeaders: Readonly<Record<string, string>> = {},
  persistedPayloadHash?: `sha256:${string}`
): Promise<CaseEvidence> {
  const requestHash = canonicalSha256(body) as `sha256:${string}`;
  const submitted = await fetchJson(baseUrl, "/v1/groundings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `development-${recipeId.toLowerCase()}-${requestHash.slice(-20)}`,
      prefer: "respond-async",
      ...contractHeaders
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
  if (!formalExternalProcessMode) {
    if (!executor) throw new Error("IN_PROCESS_PIPELINE_EXECUTOR_MISSING");
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
  }
  const fetched = formalExternalProcessMode
    ? await pollExternalGrounding(baseUrl, groundingId)
    : await fetchJson(baseUrl, `/v1/groundings/${encodeURIComponent(groundingId)}`, {
        headers: contractHeaders
      });
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
  const evidence = await collect(groundingId, requestHash, terminalResult, persistedPayloadHash ?? requestHash);
  if (evidence.resultHash !== terminalResult["resultHash"]) throw new Error(`RESULT_HASH_MISMATCH_${recipeId}`);
  const boundEvidence = { ...evidence, recipeId };
  const privateRuntime = privateCaseRuntime.get(evidence);
  if (!privateRuntime) throw new Error(`PRIVATE_CASE_RUNTIME_MISSING_${recipeId}`);
  privateCaseRuntime.set(boundEvidence, privateRuntime);
  return boundEvidence;
}

function knownReferenceFromCase(evidence: CaseEvidence, expectedAlias: string): JsonObject {
  const runtime = privateCaseRuntime.get(evidence);
  if (!runtime) throw new Error(`PRIVATE_CASE_RUNTIME_MISSING_${evidence.recipeId}`);
  const resolved = runtime.checkpointState["REFERENCE_RESOLVE"];
  const validated = runtime.checkpointState["REFERENCE_VALIDATE"];
  const resolvedProducts = resolved && typeof resolved === "object" && !Array.isArray(resolved) &&
    Array.isArray((resolved as JsonObject)["referenceProducts"])
    ? (resolved as JsonObject)["referenceProducts"] as JsonObject[] : [];
  const resolverProduct = resolvedProducts.find((entry) => entry["displayName"] === expectedAlias);
  const resolverIdentityHash = referenceKeyDigest(resolverProduct?.["referenceKey"]);
  if (!resolverProduct || !resolverIdentityHash || typeof resolverProduct["referenceType"] !== "string") {
    throw new Error(`PERSISTED_RESOLVER_PRODUCT_INVALID_${evidence.recipeId}`);
  }
  const validatedProducts = validated && typeof validated === "object" && !Array.isArray(validated) &&
    Array.isArray((validated as JsonObject)["referenceProducts"])
    ? (validated as JsonObject)["referenceProducts"] as JsonObject[] : [];
  const validatedProduct = validatedProducts.find((entry) => referenceKeyDigest(entry["referenceKey"]) === resolverIdentityHash);
  const persistedProducts = Array.isArray(runtime.terminalResult["referenceProducts"])
    ? runtime.terminalResult["referenceProducts"] as JsonObject[] : [];
  const persistedProduct = persistedProducts.find((entry) => referenceKeyDigest(entry["referenceKey"]) === resolverIdentityHash);
  if (!validatedProduct || !persistedProduct || validatedProduct["sourceOperation"] !== "VALIDATE_REFERENCES" ||
      validatedProduct["revalidationRequired"] !== false || typeof validatedProduct["validUntil"] !== "string" ||
      !Number.isFinite(Date.parse(validatedProduct["validUntil"] as string)) ||
      Date.parse(validatedProduct["validUntil"] as string) <= Date.now() ||
      referenceKeyDigest(persistedProduct["referenceKey"]) !== resolverIdentityHash) {
    throw new Error(`PERSISTED_RESOLVER_LEASE_INVALID_${evidence.recipeId}`);
  }
  return {
    alias: expectedAlias,
    referenceKey: structuredClone(resolverProduct["referenceKey"]),
    referenceType: resolverProduct["referenceType"],
    sourceMessageId: `message-${evidence.recipeId.toLowerCase()}`,
    sourceGroundingId: runtime.groundingId,
    validUntil: validatedProduct["validUntil"]
  };
}

function requiredCase(cases: readonly CaseEvidence[], recipeId: string): CaseEvidence {
  const evidence = cases.find((entry) => entry.recipeId === recipeId);
  if (!evidence) throw new Error(`FORMAL_CASE_MISSING_${recipeId}`);
  return evidence;
}

function referenceIdentityHash(evidence: CaseEvidence): `sha256:${string}` {
  const proof = evidence.compositionProof;
  const hashes = uniqueDigests([
    ...proof.knownReferenceKeyHashes,
    ...proof.resolveReferenceKeyHashes,
    ...proof.validatedReferenceKeyHashes,
    ...proof.persistedReferenceKeyHashes,
    ...proof.worldQueryAnchorReferenceKeyHashes,
    ...proof.gatewayResolverReferenceKeyHashes
  ]);
  if (!proof.identityPreserved || hashes.length !== 1) throw new Error(`REFERENCE_IDENTITY_NOT_PRESERVED_${evidence.recipeId}`);
  return hashes[0]!;
}

function assertPlanOperations(evidence: CaseEvidence, expected: readonly string[]): void {
  const actual = [...evidence.compositionProof.planOperationKeys].sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`PLAN_OPERATION_SET_MISMATCH_${evidence.recipeId}`);
  const persisted = [...evidence.operationKeys].sort();
  if (JSON.stringify(persisted) !== JSON.stringify(wanted)) throw new Error(`PERSISTED_OPERATION_SET_MISMATCH_${evidence.recipeId}`);
  const gateway = [...new Set(evidence.compositionProof.gatewayNodeStatuses.map((entry) => entry.operationKey))].sort();
  if (JSON.stringify(gateway) !== JSON.stringify(wanted) ||
      evidence.compositionProof.gatewayNodeStatuses.some((entry) => !["COMPLETED", "PARTIAL", "NO_DATA"].includes(entry.status))) {
    throw new Error(`GATEWAY_NODE_TRACE_MISMATCH_${evidence.recipeId}`);
  }
}

function assertR1ToR5Handoff(r1: CaseEvidence, r5: CaseEvidence): `sha256:${string}` {
  const r1Runtime = privateCaseRuntime.get(r1);
  const r5Runtime = privateCaseRuntime.get(r5);
  if (!r1Runtime || !r5Runtime) throw new Error("R1_R5_PRIVATE_TRACE_MISSING");
  const r1Resolved = r1Runtime.checkpointState["REFERENCE_RESOLVE"];
  const r1Validated = r1Runtime.checkpointState["REFERENCE_VALIDATE"];
  const r5Loaded = r5Runtime.checkpointState["LOAD_CONTEXT"];
  const resolverProducts = r1Resolved && typeof r1Resolved === "object" && !Array.isArray(r1Resolved) &&
    Array.isArray((r1Resolved as JsonObject)["referenceProducts"])
    ? (r1Resolved as JsonObject)["referenceProducts"] as JsonObject[] : [];
  const resolverProduct = resolverProducts.find((entry) => entry["displayName"] === "2号车");
  const identityHash = referenceKeyDigest(resolverProduct?.["referenceKey"]);
  const validatedProducts = r1Validated && typeof r1Validated === "object" && !Array.isArray(r1Validated) &&
    Array.isArray((r1Validated as JsonObject)["referenceProducts"])
    ? (r1Validated as JsonObject)["referenceProducts"] as JsonObject[] : [];
  const validatedProduct = validatedProducts.find((entry) => referenceKeyDigest(entry["referenceKey"]) === identityHash);
  const loadedKnown = r5Loaded && typeof r5Loaded === "object" && !Array.isArray(r5Loaded) &&
    Array.isArray((r5Loaded as JsonObject)["knownWorldReferences"])
    ? (r5Loaded as JsonObject)["knownWorldReferences"] as JsonObject[] : [];
  const known = loadedKnown.find((entry) => referenceKeyDigest(entry["referenceKey"]) === identityHash);
  if (!identityHash || !validatedProduct || !known || known["sourceGroundingId"] !== r1Runtime.groundingId ||
      known["sourceMessageId"] !== "message-r1" || known["validUntil"] !== validatedProduct["validUntil"] ||
      validatedProduct["revalidationRequired"] !== false || referenceIdentityHash(r5) !== identityHash) {
    throw new Error("R5_DID_NOT_CONSUME_R1_PERSISTED_RESOLVER_OUTPUT");
  }
  return identityHash;
}

function formalCaseEvidence(evidence: CaseEvidence): JsonObject {
  return {
    recipeId: evidence.recipeId,
    requestHash: evidence.requestHash,
    requestIdHash: evidence.requestIdHash,
    groundingIdHash: evidence.groundingIdHash,
    jobIdHash: evidence.jobIdHash,
    terminalStatus: evidence.terminalStatus,
    resultHash: evidence.resultHash,
    stageCount: evidence.completedStages.length,
    stageHashes: evidence.stageHashes,
    planHashes: evidence.planHashes,
    upstreamResultHashes: evidence.upstreamResultHashes,
    worldQueryCount: evidence.worldQueryCount,
    gatewayExecutionCount: evidence.gatewayExecutionCount,
    spatialExecutionCount: evidence.spatialExecutionCount,
    operationKeys: evidence.operationKeys,
    normalizedStatuses: evidence.normalizedStatuses,
    gatewayReceiptIdHashes: evidence.gatewayReceiptIdHashes,
    gatewayEvidenceIdHashes: evidence.gatewayEvidenceIdHashes,
    nearbyRadiusMetres: evidence.compositionProof.nearbyRadiusMetres,
    spatialResultCount: evidence.compositionProof.spatialResultCount,
    referenceIdentity: evidence.recipeId === "R2"
      ? { applicable: false, reason: "AMBIGUOUS_REFERENCE_SET" }
      : {
          applicable: true,
          preserved: evidence.compositionProof.identityPreserved,
          worldFactObjectIdentityPreserved: evidence.compositionProof.worldFactObjectIdentityPreserved
        },
    validationLease: evidence.recipeId === "R2"
      ? { applicable: false, reason: "AMBIGUITY_STOPS_DOWNSTREAM" }
      : { applicable: true, usable: evidence.compositionProof.validationLeaseUsable },
    traceabilityStatus: evidence.traceability.status,
    status: "PASS"
  };
}

function identityLayers(evidence: CaseEvidence): JsonObject {
  const proof = evidence.compositionProof;
  return {
    knownReferenceKeyHashes: proof.knownReferenceKeyHashes,
    resolverReferenceKeyHashes: proof.resolveReferenceKeyHashes,
    validationReferenceKeyHashes: proof.validatedReferenceKeyHashes,
    planAnchorReferenceKeyHashes: proof.worldQueryAnchorReferenceKeyHashes,
    gatewayResolverReferenceKeyHashes: proof.gatewayResolverReferenceKeyHashes,
    persistedGetReferenceKeyHashes: proof.persistedReferenceKeyHashes
  };
}

function writeFormalReport(name: string, payload: JsonObject): `sha256:${string}` {
  repositoryRelativePath(resolve(formalReportDirectory, name), "WSGS_FORMAL_REPORT_OUTSIDE_REPOSITORY");
  const evidenceHash = evidenceCanonicalSha256(payload);
  writeFileSync(resolve(formalReportDirectory, name), `${JSON.stringify({ ...payload, evidenceHash }, null, 2)}\n`, "utf8");
  return evidenceHash;
}

function writeWsgsProcessBinding(binding: VerifiedWsgsProcessBinding): ReportedWsgsProcessBinding {
  const { bindingHash, ...bindingPayload } = binding;
  if (evidenceCanonicalSha256(bindingPayload) !== bindingHash) throw new Error("WSGS_PROCESS_BINDING_HASH_MISMATCH");
  const reportPath = resolve(formalReportDirectory, "wsgs-process-binding.json");
  const relativeReportPath = repositoryRelativePath(reportPath, "WSGS_PROCESS_BINDING_REPORT_OUTSIDE_REPOSITORY");
  const reportEvidenceHash = evidenceCanonicalSha256(binding);
  const bytes = `${JSON.stringify({ ...binding, evidenceHash: reportEvidenceHash }, null, 2)}\n`;
  writeFileSync(reportPath, bytes, "utf8");
  return {
    ...binding,
    reportFileHash: sha256(bytes),
    reportEvidenceHash,
    reportPathHash: safeId(relativeReportPath)
  };
}

function emitFormalR1R5Reports(
  cases: readonly CaseEvidence[],
  runtimeBinding: VerifiedRuntimeBinding,
  wsgsSourceBinding: VerifiedWsgsSourceBinding,
  processBinding: VerifiedWsgsProcessBinding
): Record<string, `sha256:${string}`> {
  if (!formalR1R5Only || !formalExternalProcessMode || processBinding.executionMode !== "EXTERNAL_PROCESS") {
    throw new Error("FORMAL_PASS_REQUIRES_EXTERNAL_PROCESS_MODE");
  }
  const formalCases = ["R1", "R2", "R3", "R4", "R5"].map((recipeId) => requiredCase(cases, recipeId));
  const [r1, r2, r3, r4, r5] = formalCases as [CaseEvidence, CaseEvidence, CaseEvidence, CaseEvidence, CaseEvidence];
  if (formalCases.some((entry) => entry.traceability.status !== "PASS")) throw new Error("FORMAL_PIPELINE_TRACEABILITY_INCOMPLETE");
  if (r1.terminalStatus !== "COMPLETED" || r1.completedStages.length !== 14 || r1.gatewayReceiptIdHashes.length < 1 ||
      !r1.compositionProof.directValidationProof || !r1.compositionProof.validationLeaseUsable ||
      !r1.compositionProof.resolverOutputConsumedByValidation || !r1.compositionProof.resolverOutputConsumedByWorldQuery ||
      !r1.compositionProof.worldFactObjectIdentityPreserved) {
    throw new Error("FORMAL_R1_INCOMPLETE");
  }
  assertPlanOperations(r1, ["reference.resolve@1.0", "world.get-current-state@1.0"]);
  if (r2.terminalStatus !== "AMBIGUOUS" || r2.compositionProof.ambiguityCount < 1 ||
      r2.compositionProof.ambiguityCandidateCount < 2 || r2.worldQueryCount !== 0 ||
      r2.gatewayExecutionCount !== 0 || r2.spatialExecutionCount !== 0 ||
      r2.compositionProof.planOperationKeys.length !== 0 || r2.compositionProof.gatewayNodeStatuses.length !== 0) {
    throw new Error("FORMAL_R2_AMBIGUITY_DID_NOT_STOP_DOWNSTREAM");
  }
  if (r3.terminalStatus !== "COMPLETED" || !r3.compositionProof.directValidationProof ||
      !r3.compositionProof.validationLeaseUsable || !r3.compositionProof.resolverOutputConsumedByValidation ||
      !r3.compositionProof.resolverOutputConsumedByWorldQuery || !r3.compositionProof.worldOutputConsumedBySpatial ||
      !r3.compositionProof.worldFactObjectIdentityPreserved ||
      r3.spatialExecutionCount < 1 || r3.compositionProof.spatialResultCount < 1 ||
      r3.gatewayReceiptIdHashes.length + r3.gatewayEvidenceIdHashes.length < 1) {
    throw new Error("FORMAL_R3_COMPOSITION_INCOMPLETE");
  }
  assertPlanOperations(r3, ["reference.resolve@1.0", "world.get-geometry@1.0", "spatial.find-in-area@1.0"]);
  if (r4.terminalStatus !== "COMPLETED" || !r4.compositionProof.directValidationProof ||
      !r4.compositionProof.validationLeaseUsable || !r4.compositionProof.resolverOutputConsumedByValidation ||
      !r4.compositionProof.resolverOutputConsumedByWorldQuery || !r4.compositionProof.worldOutputConsumedBySpatial ||
      !r4.compositionProof.worldFactObjectIdentityPreserved ||
      r4.spatialExecutionCount < 1 || r4.compositionProof.spatialResultCount < 1 ||
      r4.compositionProof.nearbyRadiusMetres !== 1_000 ||
      r4.gatewayReceiptIdHashes.length + r4.gatewayEvidenceIdHashes.length < 1) {
    throw new Error("FORMAL_R4_COMPOSITION_INCOMPLETE");
  }
  assertPlanOperations(r4, ["reference.resolve@1.0", "world.get-current-state@1.0", "spatial.find-nearby@1.0"]);
  if (r5.terminalStatus !== "COMPLETED" || r5.completedStages.length !== 3 || r5.worldQueryCount !== 0 ||
      r5.gatewayExecutionCount !== 0 || r5.compositionProof.resolveReferenceKeyHashes.length !== 0 ||
      r5.compositionProof.knownReferenceKeyHashes.length !== 1 || !r5.compositionProof.directValidationProof ||
      !r5.compositionProof.validationLeaseUsable ||
      JSON.stringify(r5.compositionProof.directOperationKeys) !== JSON.stringify(["reference.validate@1.0"])) {
    throw new Error("FORMAL_R5_INCOMPLETE");
  }
  const r1IdentityHash = referenceIdentityHash(r1);
  const r3IdentityHash = referenceIdentityHash(r3);
  const r4IdentityHash = referenceIdentityHash(r4);
  const r5IdentityHash = assertR1ToR5Handoff(r1, r5);
  if (r1IdentityHash !== r5IdentityHash) throw new Error("R1_R5_REFERENCE_IDENTITY_MISMATCH");
  for (const entry of [r1, r3, r4]) {
    if (entry.gatewayExecutionCount !== entry.compositionProof.planOperationKeys.length + entry.worldQueryCount) {
      throw new Error(`GATEWAY_PERSISTENCE_COUNT_MISMATCH_${entry.recipeId}`);
    }
  }

  const observedAt = new Date().toISOString();
  const redaction = {
    credentialsIncluded: false,
    rawReferenceIdsIncluded: false,
    rawGroundingIdsIncluded: false,
    rawRequestIdsIncluded: false,
    rawGatewayIdsIncluded: false,
    rawBusinessResponsesIncluded: false
  };
  mkdirSync(formalReportDirectory, { recursive: true });
  const reportedProcessBinding = writeWsgsProcessBinding(processBinding);
  const hashes: Record<string, `sha256:${string}`> = {};
  hashes["wsgs-process-binding.json"] = reportedProcessBinding.reportEvidenceHash;
  hashes["formal-pipeline-r1-r5.json"] = writeFormalReport("formal-pipeline-r1-r5.json", {
    schemaVersion: "wsgs-formal-pipeline-r1-r5/1.0",
    marker: "WSGS_GOWM_FORMAL_PIPELINE_R1_R5_READY",
    formalWsgsPipelineEvidence: true,
    sourceCommit,
    observedAt,
    wsgsSourceBinding,
    runtime: {
      sourceCommit: runtimeBinding.sourceCommit,
      runtimeVersion: runtimeBinding.runtimeVersion,
      gatewayContractVersion: runtimeBinding.gatewayContractVersion,
      consumerPackage: "@gowm/world-gateway-contracts@0.6.3"
    },
    runtimeBinding,
    runtimeBindingHash: runtimeBinding.runtimeBindingHash,
    wsgsProcessBinding: reportedProcessBinding,
    wsgsProcessBindingHash: processBinding.bindingHash,
    executionPath: ["PUBLIC_API", "POSTGRES", "WORKER", "PRODUCTION_PIPELINE", "GOWM_GATEWAY", "POSTGRES_PERSIST", "PUBLIC_API_GET"],
    executionMode: "EXTERNAL_PROCESS",
    focusedMode: formalR1R5Only,
    realDependencies: {
      api: true, postgres: true, worker: true, pipeline: true,
      model: r1.modelReceiptCount > 0, modelRequired: false, gowmGateway: true, independentProcesses: true
    },
    summary: { total: 5, pass: 5, fail: 0, notRun: 0, blocked: 0 },
    cases: formalCases.map(formalCaseEvidence),
    redaction,
    status: "PASS"
  });
  hashes["reference-identity-report.json"] = writeFormalReport("reference-identity-report.json", {
    schemaVersion: "wsgs-reference-identity-report/1.0",
    sourceCommit,
    observedAt,
    runtimeBindingHash: runtimeBinding.runtimeBindingHash,
    cases: [
      { recipeId: "R1", referenceIdentityHash: r1IdentityHash, layers: identityLayers(r1), authoritativeWorldFactReferenceKeyHashes: r1.compositionProof.gatewayWorldFactReferenceKeyHashes, worldFactObjectIdentityPreserved: true, identityPreserved: true, validationLeaseUsable: true, status: "PASS" },
      { recipeId: "R3", referenceIdentityHash: r3IdentityHash, layers: identityLayers(r3), authoritativeWorldFactReferenceKeyHashes: r3.compositionProof.gatewayWorldFactReferenceKeyHashes, worldFactObjectIdentityPreserved: true, identityPreserved: true, validationLeaseUsable: true, status: "PASS" },
      { recipeId: "R4", referenceIdentityHash: r4IdentityHash, layers: identityLayers(r4), authoritativeWorldFactReferenceKeyHashes: r4.compositionProof.gatewayWorldFactReferenceKeyHashes, worldFactObjectIdentityPreserved: true, identityPreserved: true, validationLeaseUsable: true, status: "PASS" },
      { recipeId: "R5", referenceIdentityHash: r5IdentityHash, layers: identityLayers(r5), authoritativeWorldFactReferenceKeyHashes: r5.compositionProof.gatewayWorldFactReferenceKeyHashes, worldFactObjectIdentityPreserved: true, consumesR1PersistedResolverOutput: true, identityPreserved: true, validationLeaseUsable: true, status: "PASS" }
    ],
    r1ToR5: { referenceIdentityHash: r1IdentityHash, persistedCheckpointHandoff: true, knownWorldReferenceConsumed: true, leaseCarriedAndRevalidated: true, status: "PASS" },
    redaction,
    status: "PASS"
  });
  hashes["reference-composability-r3.json"] = writeFormalReport("reference-composability-r3.json", {
    schemaVersion: "wsgs-reference-composability-r3/1.0",
    sourceCommit,
    observedAt,
    runtimeBindingHash: runtimeBinding.runtimeBindingHash,
    recipeId: "R3",
    referenceIdentityHash: r3IdentityHash,
    identityLayers: identityLayers(r3),
    authoritativeWorldFactReferenceKeyHashes: r3.compositionProof.gatewayWorldFactReferenceKeyHashes,
    worldFactObjectIdentityPreserved: true,
    operationKeys: [...new Set([...r3.compositionProof.directOperationKeys, ...r3.compositionProof.planOperationKeys])],
    dataflowBindings: r3.compositionProof.planDataflowBindings,
    gatewayNodeStatuses: r3.compositionProof.gatewayNodeStatuses,
    resolverOutputConsumedByValidation: true,
    resolverOutputConsumedByGeometry: true,
    geometryOutputConsumedBySpatial: true,
    validationLeaseUsable: true,
    spatialExecutionCount: r3.spatialExecutionCount,
    spatialResultCount: r3.compositionProof.spatialResultCount,
    redaction,
    status: "PASS"
  });
  hashes["reference-negative-cases.json"] = writeFormalReport("reference-negative-cases.json", {
    schemaVersion: "wsgs-reference-negative-cases/1.0",
    sourceCommit,
    observedAt,
    runtimeBindingHash: runtimeBinding.runtimeBindingHash,
    cases: [{
      recipeId: "R2",
      terminalStatus: "AMBIGUOUS",
      ambiguityCount: r2.compositionProof.ambiguityCount,
      candidateCount: r2.compositionProof.ambiguityCandidateCount,
      downstreamCounts: {
        compiledPlans: r2.compositionProof.planOperationKeys.length,
        persistedWorldQueries: r2.worldQueryCount,
        gatewayExecutions: r2.gatewayExecutionCount,
        gatewayNodes: r2.compositionProof.gatewayNodeStatuses.length,
        spatialExecutions: r2.spatialExecutionCount
      },
      status: "PASS"
    }],
    redaction,
    status: "PASS"
  });
  hashes["pipeline-traceability.json"] = writeFormalReport("pipeline-traceability.json", {
    schemaVersion: "wsgs-pipeline-traceability/1.0",
    sourceCommit,
    observedAt,
    wsgsSourceBinding,
    runtimeBinding,
    runtimeBindingHash: runtimeBinding.runtimeBindingHash,
    wsgsProcessBinding: reportedProcessBinding,
    wsgsProcessBindingHash: processBinding.bindingHash,
    executionPath: ["PUBLIC_API", "POSTGRES", "WORKER", "PRODUCTION_PIPELINE", "GOWM_GATEWAY", "POSTGRES_PERSIST", "PUBLIC_API_GET"],
    executionMode: "EXTERNAL_PROCESS",
    cases: formalCases.map((entry) => ({
      recipeId: entry.recipeId,
      requestIdHash: entry.requestIdHash,
      groundingIdHash: entry.groundingIdHash,
      jobIdHash: entry.jobIdHash,
      stageHashes: entry.stageHashes,
      planHashes: entry.planHashes,
      upstreamResultHashes: entry.upstreamResultHashes,
      gatewayQueryIdHashes: entry.gatewayQueryIdHashes,
      gatewayJobIdHashes: entry.gatewayJobIdHashes,
      gatewayReceiptIdHashes: entry.gatewayReceiptIdHashes,
      gatewayEvidenceIdHashes: entry.gatewayEvidenceIdHashes,
      traceability: entry.traceability,
      status: "PASS"
    })),
    redaction,
    status: "PASS"
  });
  return hashes;
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

const n04LegacyHeaders = Object.freeze({
  "wsgs-contract-version": "sacs-wsgs-grounding/1.0"
});

const n04GeospatialHeaders = Object.freeze({
  "wsgs-contract-version": "sacs-wsgs-grounding/1.1",
  "wsgs-result-profile": "sacs-wsgs-geospatial-findings/1.0"
});

function canonicalResultHash(runFingerprint: string, result: JsonObject): `sha256:${string}` {
  const material = Object.fromEntries(Object.entries(result).filter(([key]) => key !== "resultHash"));
  const execution = material["execution"];
  if (execution && typeof execution === "object" && !Array.isArray(execution)) {
    material["execution"] = Object.fromEntries(
      Object.entries(execution as JsonObject).filter(([key]) => key !== "elapsedMs")
    );
  }
  return canonicalSha256({
    runFingerprint,
    status: string(result["status"], "N04_RESULT_STATUS_MISSING"),
    value: material
  }) as `sha256:${string}`;
}

function n04ResultSemanticProjection(result: JsonObject): JsonObject {
  const withoutRuntimeFields = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withoutRuntimeFields);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as JsonObject)
      .filter(([key]) => ![
        "validUntil",
        "evaluatedAt",
        "receiptIds",
        "evidenceIds"
      ].includes(key))
      .map(([key, entry]) => [key, withoutRuntimeFields(entry)]));
  };
  const source = object(result["source"], "N04_RESULT_SOURCE_MISSING");
  const execution = object(result["execution"], "N04_RESULT_EXECUTION_MISSING");
  return {
    schemaVersion: result["schemaVersion"],
    status: result["status"],
    source: { originalTextSha256: source["originalTextSha256"] },
    mentions: withoutRuntimeFields(result["mentions"]),
    referenceProducts: withoutRuntimeFields(result["referenceProducts"]),
    evidenceItems: withoutRuntimeFields(result["evidenceItems"]),
    geospatialFindings: withoutRuntimeFields(result["geospatialFindings"]),
    ambiguities: withoutRuntimeFields(result["ambiguities"]),
    unresolvedMentions: withoutRuntimeFields(result["unresolvedMentions"]),
    capabilityGaps: withoutRuntimeFields(result["capabilityGaps"]),
    warnings: withoutRuntimeFields(result["warnings"]),
    execution: Object.fromEntries(Object.entries(execution)
      .filter(([key]) => key !== "elapsedMs" && key !== "semanticModelReceiptIds")
      .map(([key, entry]) => [key, withoutRuntimeFields(entry)]))
  };
}

function n04ExtensionSummary(evidence: CaseEvidence): {
  findingCount: number;
  sourceProductCount: number;
  evidenceItemCount: number;
  gapCount: number;
  subjectReferenceCount: number;
  extensionIncludedInResultHash: true;
  elapsedMsExcludedFromResultHash: true;
} {
  const runtime = privateCaseRuntime.get(evidence);
  if (!runtime) throw new Error("N04_PRIVATE_RUNTIME_MISSING");
  const result = runtime.terminalResult;
  const profile = object(result["geospatialFindings"], "N04_GEOSPATIAL_FINDINGS_MISSING");
  if (profile["profile"] !== "sacs-wsgs-geospatial-findings/1.0") {
    throw new Error("N04_GEOSPATIAL_PROFILE_MISMATCH");
  }
  const findings = Array.isArray(profile["findings"]) ? profile["findings"] : [];
  const sourceProducts = Array.isArray(profile["sourceProducts"]) ? profile["sourceProducts"] : [];
  const gaps = Array.isArray(profile["gaps"]) ? profile["gaps"] : [];
  const evidenceItems = Array.isArray(result["evidenceItems"]) ? result["evidenceItems"] : [];
  if (findings.length < 1 || sourceProducts.length < 1 || evidenceItems.length < 1) {
    throw new Error("N04_GEOSPATIAL_PROFILE_EMPTY");
  }

  const referenceProducts = Array.isArray(result["referenceProducts"]) ? result["referenceProducts"] : [];
  const referenceProductIds = new Set(referenceProducts.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const productId = (entry as JsonObject)["productId"];
    return typeof productId === "string" && productId.length > 0 ? [productId] : [];
  }));
  const subjectReferenceIds = findings.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const subjects = (entry as JsonObject)["subjectReferenceProductIds"];
    return Array.isArray(subjects)
      ? subjects.filter((subject): subject is string => typeof subject === "string" && subject.length > 0)
      : [];
  });
  if (subjectReferenceIds.length < 1 || subjectReferenceIds.some((subject) => !referenceProductIds.has(subject))) {
    throw new Error("N04_SUBJECT_REFERENCE_PRODUCT_FK_INVALID");
  }

  const storedResultHash = string(result["resultHash"], "N04_RESULT_HASH_MISSING") as `sha256:${string}`;
  if (canonicalResultHash(runtime.runFingerprint, result) !== storedResultHash) {
    throw new Error("N04_RESULT_HASH_RECOMPUTE_MISMATCH");
  }
  const withoutExtension = { ...result };
  delete withoutExtension["geospatialFindings"];
  if (canonicalResultHash(runtime.runFingerprint, withoutExtension) === storedResultHash) {
    throw new Error("N04_RESULT_HASH_EXCLUDES_EXTENSION");
  }
  const execution = object(result["execution"], "N04_RESULT_EXECUTION_MISSING");
  const elapsedMs = execution["elapsedMs"];
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs)) throw new Error("N04_RESULT_ELAPSED_MS_MISSING");
  const changedElapsed = {
    ...result,
    execution: { ...execution, elapsedMs: elapsedMs + 10_000 }
  };
  if (canonicalResultHash(runtime.runFingerprint, changedElapsed) !== storedResultHash) {
    throw new Error("N04_RESULT_HASH_INCLUDES_ELAPSED_MS");
  }
  return {
    findingCount: findings.length,
    sourceProductCount: sourceProducts.length,
    evidenceItemCount: evidenceItems.length,
    gapCount: gaps.length,
    subjectReferenceCount: new Set(subjectReferenceIds).size,
    extensionIncludedInResultHash: true,
    elapsedMsExcludedFromResultHash: true
  };
}

async function assertPersistedN04ContractSelection(
  groundingId: string,
  expected: typeof LEGACY_GROUNDING_CONTRACT_SELECTION | typeof SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION
): Promise<void> {
  const persisted = await pool.query<{ request_metadata: unknown }>(
    "SELECT request_metadata FROM wsgs.grounding_request WHERE grounding_id = $1",
    [groundingId]
  );
  const metadata = object(persisted.rows[0]?.request_metadata, "N04_REQUEST_METADATA_MISSING");
  if (evidenceCanonicalJson(metadata["contractSelection"]) !== evidenceCanonicalJson(expected)) {
    throw new Error("N04_PERSISTED_CONTRACT_SELECTION_MISMATCH");
  }
}

function assertN04SegmentedGatewayTrace(
  evidence: CaseEvidence,
  sharedBinding: VerifiedN04SharedExecutionGatewayBinding,
  operationLockBinding: VerifiedN04OperationLockBinding
): void {
  if (evidence.segmentedWorldQueryCount !== 1 || evidence.gatewaySegmentCount !== 3 ||
      evidence.segmentManifestHashes.length !== 1 || evidence.segmentPlanHashes.length !== 3 ||
      new Set(evidence.segmentPlanHashes).size !== 3 || evidence.segmentScopeHashes.length !== 2 ||
      evidence.segmentDelegationBindingCount !== 3 ||
      !/^sha256:[0-9a-f]{64}$/u.test(evidence.segmentDelegationBindingsHash)) {
    throw new Error("N04_SEGMENTED_GATEWAY_TRACE_MISMATCH");
  }
  const required = [
    "reference.resolve@1.0",
    "world.get-current-state@1.0",
    "geo-raster.sample@1.0"
  ];
  if (evidence.operationKeys.length !== required.length ||
      required.some((operationKey) => !evidence.operationKeys.includes(operationKey)) ||
      evidenceCanonicalJson(evidence.segmentBindings.map((entry) => entry.operationKey)) !== evidenceCanonicalJson(required)) {
    throw new Error("N04_SEGMENTED_GATEWAY_OPERATION_CHAIN_MISMATCH");
  }
  const expectedGatewayBinding = {
    contractCatalogRevision: sharedBinding.lockedGatewayTuple.contractCatalogRevision,
    semanticCatalogHash: sharedBinding.lockedGatewayTuple.semanticCatalogHash,
    bindingRevision: sharedBinding.lockedGatewayTuple.bindingRevision,
    operationLockHash: operationLockBinding.operationLockHash
  };
  if (evidenceCanonicalJson(evidence.admissionGatewayBinding) !== evidenceCanonicalJson(expectedGatewayBinding)) {
    throw new Error("N04_SHARED_GATEWAY_LIVE_TUPLE_MISMATCH");
  }
  const expectedSegmentAuthorities = [{
    operationKey: "reference.resolve@1.0",
    dataScopeHash: sharedBinding.foundationDataScopeHash,
    sourceLockHash: sharedBinding.foundationOperationLockHash
  }, {
    operationKey: "world.get-current-state@1.0",
    dataScopeHash: sharedBinding.foundationDataScopeHash,
    sourceLockHash: sharedBinding.foundationOperationLockHash
  }, {
    operationKey: "geo-raster.sample@1.0",
    dataScopeHash: sharedBinding.selectedDatasetDataScopeHash,
    sourceLockHash: sharedBinding.capabilityLockHash
  }];
  const actualSegmentAuthorities = evidence.segmentBindings.map(({ operationKey, dataScopeHash, sourceLockHash }) => ({
    operationKey,
    dataScopeHash,
    sourceLockHash
  }));
  if (evidenceCanonicalJson(actualSegmentAuthorities) !== evidenceCanonicalJson(expectedSegmentAuthorities) ||
      new Set(evidence.segmentBindings.map((entry) => entry.scopeAuthorityHash)).size !== 1 ||
      evidence.segmentBindings.some((entry) => !/^sha256:[0-9a-f]{64}$/u.test(entry.upstreamResultHash) ||
        !/^sha256:[0-9a-f]{64}$/u.test(entry.worldResultHash))) {
    throw new Error("N04_SEGMENTED_GATEWAY_SOURCE_AUTHORITY_MISMATCH");
  }
  const expectedAdmissionScopeAuthorityBinding = {
    schemaVersion: "1.0",
    authorityHash: evidence.segmentBindings[0]?.scopeAuthorityHash,
    foundationInstanceBindingHash: sharedBinding.foundationInstanceBindingHash,
    gdpsChecksumsHash: sharedBinding.checksumsFileHash
  };
  if (!expectedAdmissionScopeAuthorityBinding.authorityHash ||
      evidenceCanonicalJson(evidence.admissionSegmentedScopeAuthorityBinding) !==
        evidenceCanonicalJson(expectedAdmissionScopeAuthorityBinding)) {
    throw new Error("N04_SEGMENTED_GATEWAY_ADMISSION_AUTHORITY_MISMATCH");
  }
}

async function runN04ResultExtensionGate(
  baseUrl: string,
  productionExecutor: PipelineStageExecutor | undefined,
  wsgsSourceBinding: VerifiedWsgsSourceBinding,
  runtimeBinding: VerifiedRuntimeBinding
): Promise<void> {
  if (!productionExecutor) throw new Error("N04_PRODUCTION_EXECUTOR_REQUIRED");
  const operationLockBinding = verifyN04OperationLockBinding(wsgsSourceBinding);
  const sharedExecutionGatewayBinding = loadVerifiedN04SharedExecutionGatewayBinding();
  const legacyCapabilities = await fetchJson(baseUrl, "/v1/capabilities", { headers: n04LegacyHeaders });
  if (legacyCapabilities.status !== 200 ||
      legacyCapabilities.headers.get("wsgs-contract-version") !== "sacs-wsgs-grounding/1.0" ||
      legacyCapabilities.body["contractVersion"] !== "sacs-wsgs-grounding/1.0" ||
      "supportedResultProfiles" in legacyCapabilities.body) {
    throw new Error("N04_LEGACY_CAPABILITIES_MISMATCH");
  }
  const geospatialCapabilities = await fetchJson(baseUrl, "/v1/capabilities", { headers: n04GeospatialHeaders });
  const supportedOperations = Array.isArray(geospatialCapabilities.body["supportedOperations"])
    ? geospatialCapabilities.body["supportedOperations"] : [];
  if (geospatialCapabilities.status !== 200 ||
      geospatialCapabilities.headers.get("wsgs-contract-version") !== "sacs-wsgs-grounding/1.1" ||
      geospatialCapabilities.headers.get("wsgs-result-profile") !== "sacs-wsgs-geospatial-findings/1.0" ||
      geospatialCapabilities.body["contractVersion"] !== "sacs-wsgs-grounding/1.1" ||
      geospatialCapabilities.body["geospatialTransportMode"] !== "RESULT_EXTENSION" ||
      supportedOperations.length !== 6 || new Set(supportedOperations).size !== 6) {
    throw new Error("N04_GEOSPATIAL_CAPABILITIES_MISMATCH");
  }

  const gdpsSuite = loadFrozenGdpsCaseSuite();
  const definition = gdpsSuite.cases.find((entry) => entry.id === "E2E-SLOPE-POINT");
  if (!definition) throw new Error("N04_REAL_GDPS_CASE_MISSING");
  const gdpsRuntime = loadGdpsRuntimeExpectations(gdpsSuite);

  const synchronousBody = requestBody(
    "N04-V11-SYNC",
    definition.message,
    "EXECUTE_WORLD_QUERY",
    ["WORLD_EVIDENCE"]
  );
  const synchronousRequestHash = canonicalSha256(synchronousBody) as `sha256:${string}`;
  const synchronousPayloadHash = canonicalSha256({
    request: synchronousBody,
    contractSelection: SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION
  }) as `sha256:${string}`;
  const synchronousWorker = worker(productionExecutor, "development-n04-v11-sync");
  const synchronousWorkerLoop = synchronousWorker.start();
  let synchronousResponse: Awaited<ReturnType<typeof fetchJson>>;
  try {
    synchronousResponse = await fetchJson(baseUrl, "/v1/groundings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `development-n04-v11-sync-${synchronousRequestHash.slice(-20)}`,
        ...n04GeospatialHeaders
      },
      body: JSON.stringify(synchronousBody)
    });
  } finally {
    await synchronousWorker.stop(10_000);
    await synchronousWorkerLoop;
  }
  if (synchronousResponse.status !== 200 || synchronousResponse.body["status"] !== "COMPLETED" ||
      synchronousResponse.headers.get("wsgs-contract-version") !== "sacs-wsgs-grounding/1.1" ||
      synchronousResponse.headers.get("wsgs-result-profile") !== "sacs-wsgs-geospatial-findings/1.0") {
    throw new Error("N04_FRESH_SYNC_SUBMISSION_FAILED");
  }
  const synchronousGroundingId = string(
    synchronousResponse.body["groundingId"],
    "N04_SYNC_GROUNDING_ID_MISSING"
  );
  const synchronousGet = await fetchJson(
    baseUrl,
    `/v1/groundings/${encodeURIComponent(synchronousGroundingId)}`,
    { headers: n04GeospatialHeaders }
  );
  const synchronousGetResult = object(synchronousGet.body["result"], "N04_SYNC_GET_RESULT_MISSING");
  if (synchronousGet.status !== 200 ||
      evidenceCanonicalJson(synchronousGetResult) !== evidenceCanonicalJson(synchronousResponse.body)) {
    throw new Error("N04_SYNC_GET_RESULT_MISMATCH");
  }
  const synchronousEvidence = await collect(
    synchronousGroundingId,
    synchronousRequestHash,
    synchronousResponse.body,
    synchronousPayloadHash,
    200
  );
  await assertPersistedN04ContractSelection(
    synchronousGroundingId,
    SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION
  );
  validateGdpsCaseEvidence(
    definition,
    { ...synchronousEvidence, recipeId: definition.id },
    gdpsSuite,
    gdpsRuntime
  );
  assertN04SegmentedGatewayTrace(synchronousEvidence, sharedExecutionGatewayBinding, operationLockBinding);
  const synchronousExtension = n04ExtensionSummary(synchronousEvidence);

  const geospatialBody = requestBody(
    "N04-V11-ASYNC",
    definition.message,
    "EXECUTE_WORLD_QUERY",
    ["WORLD_EVIDENCE"]
  );
  const geospatialPayloadHash = canonicalSha256({
    request: geospatialBody,
    contractSelection: SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION
  }) as `sha256:${string}`;
  const geospatialEvidence = await submitAndRun(
    baseUrl,
    productionExecutor,
    "N04-V11-ASYNC",
    geospatialBody,
    ["COMPLETED"],
    n04GeospatialHeaders,
    geospatialPayloadHash
  );
  validateGdpsCaseEvidence(definition, { ...geospatialEvidence, recipeId: definition.id }, gdpsSuite, gdpsRuntime);
  assertN04SegmentedGatewayTrace(geospatialEvidence, sharedExecutionGatewayBinding, operationLockBinding);
  if (evidenceCanonicalJson(synchronousEvidence.admissionGatewayBinding) !==
        evidenceCanonicalJson(geospatialEvidence.admissionGatewayBinding) ||
      evidenceCanonicalJson(synchronousEvidence.segmentBindings) !== evidenceCanonicalJson(geospatialEvidence.segmentBindings)) {
    throw new Error("N04_SYNC_ASYNC_SHARED_GATEWAY_BINDING_MISMATCH");
  }
  const extension = n04ExtensionSummary(geospatialEvidence);
  const geospatialRuntime = privateCaseRuntime.get(geospatialEvidence);
  if (!geospatialRuntime) throw new Error("N04_PRIVATE_RUNTIME_MISSING");
  await assertPersistedN04ContractSelection(
    geospatialRuntime.groundingId,
    SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION
  );
  const mismatchedRead = await fetchJson(
    baseUrl,
    `/v1/groundings/${encodeURIComponent(geospatialRuntime.groundingId)}`,
    { headers: n04LegacyHeaders }
  );
  const mismatchedError = mismatchedRead.body["error"];
  if (mismatchedRead.status !== 406 || !mismatchedError || typeof mismatchedError !== "object" ||
      Array.isArray(mismatchedError) ||
      (mismatchedError as JsonObject)["code"] !== "WSGS_CONSUMER_CONTRACT_MISMATCH") {
    throw new Error("N04_CROSS_CONTRACT_READ_NOT_REJECTED");
  }
  const synchronousRuntime = privateCaseRuntime.get(synchronousEvidence);
  if (!synchronousRuntime) throw new Error("N04_SYNC_PRIVATE_RUNTIME_MISSING");
  const synchronousSemanticHash = evidenceCanonicalSha256(
    n04ResultSemanticProjection(synchronousRuntime.terminalResult)
  );
  const asynchronousSemanticProjection = n04ResultSemanticProjection(geospatialRuntime.terminalResult);
  const asynchronousSemanticHash = evidenceCanonicalSha256(asynchronousSemanticProjection);
  if (synchronousSemanticHash !== asynchronousSemanticHash) {
    throw new Error("N04_SYNC_ASYNC_RESULT_SEMANTICS_MISMATCH");
  }
  const gapMutation = structuredClone(asynchronousSemanticProjection);
  const gapProfile = object(gapMutation["geospatialFindings"], "N04_ASYNC_PROFILE_MISSING");
  const priorGaps = Array.isArray(gapProfile["gaps"]) ? gapProfile["gaps"] : [];
  gapProfile["gaps"] = [...priorGaps, { gapId: "semantic-projection-self-check" }];
  if (evidenceCanonicalSha256(gapMutation) === asynchronousSemanticHash) {
    throw new Error("N04_SEMANTIC_PROJECTION_GAP_INSENSITIVE");
  }
  const executionCountBeforeReplay = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM wsgs.gowm_execution WHERE grounding_id = $1",
    [geospatialRuntime.groundingId]
  );
  const geospatialRequestHash = canonicalSha256(geospatialBody) as `sha256:${string}`;
  const replay = await fetchJson(baseUrl, "/v1/groundings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `development-n04-v11-async-${geospatialRequestHash.slice(-20)}`,
      ...n04GeospatialHeaders
    },
    body: JSON.stringify(geospatialBody)
  });
  if (replay.status !== 200 ||
      replay.headers.get("wsgs-contract-version") !== "sacs-wsgs-grounding/1.1" ||
      replay.headers.get("wsgs-result-profile") !== "sacs-wsgs-geospatial-findings/1.0" ||
      evidenceCanonicalJson(replay.body) !== evidenceCanonicalJson(geospatialRuntime.terminalResult)) {
    throw new Error("N04_SYNC_REPLAY_RESULT_MISMATCH");
  }
  const executionCountAfterReplay = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM wsgs.gowm_execution WHERE grounding_id = $1",
    [geospatialRuntime.groundingId]
  );
  if (executionCountAfterReplay.rows[0]?.count !== executionCountBeforeReplay.rows[0]?.count) {
    throw new Error("N04_SYNC_REPLAY_REEXECUTED_UPSTREAM");
  }

  const legacyBody = requestBody(
    "N04-LEGACY",
    definition.message,
    "EXECUTE_WORLD_QUERY",
    ["WORLD_EVIDENCE"]
  );
  const legacyEvidence = await submitAndRun(
    baseUrl,
    productionExecutor,
    "N04-LEGACY",
    legacyBody,
    ["COMPLETED"],
    n04LegacyHeaders,
    canonicalSha256(legacyBody) as `sha256:${string}`
  );
  const legacyRuntime = privateCaseRuntime.get(legacyEvidence);
  if (!legacyRuntime || "geospatialFindings" in legacyRuntime.terminalResult) {
    throw new Error("N04_LEGACY_UNNEGOTIATED_EXTENSION");
  }
  await assertPersistedN04ContractSelection(
    legacyRuntime.groundingId,
    LEGACY_GROUNDING_CONTRACT_SELECTION
  );

  const reportPayload = {
    schemaVersion: "wsgs-v021-result-extension-real-runtime/1.1",
    sourceCommit,
    qualifiedSourceSha: sourceCommit,
    sourceTree: wsgsSourceBinding.sourceTree,
    sourceBinding: wsgsSourceBinding,
    isolatedFoundationQualification: {
      sourceCommit: runtimeBinding.sourceCommit,
      runtimeBindingHash: runtimeBinding.runtimeBindingHash,
      gatewayContractVersion: runtimeBinding.gatewayContractVersion,
      evidenceLayer: "DIRECT_WSGS_CONSUMER_TO_ISOLATED_GOWM_GATEWAY",
      usedByN04Execution: false
    },
    sharedExecutionGatewayBinding: {
      ...sharedExecutionGatewayBinding,
      gatewayContractVersion: expectedGatewayContractVersion,
      operationLockHash: operationLockBinding.operationLockHash,
      operationLockPathHash: operationLockBinding.operationLockPathHash,
      liveGatewayTuple: geospatialEvidence.admissionGatewayBinding,
      admissionSegmentedScopeAuthorityBinding: geospatialEvidence.admissionSegmentedScopeAuthorityBinding,
      segmentAuthorityHashes: [...new Set(geospatialEvidence.segmentBindings.map((entry) => entry.scopeAuthorityHash))],
      segmentSourceLockHashes: [...new Set(geospatialEvidence.segmentBindings.map((entry) => entry.sourceLockHash))].sort(),
      segmentBindings: geospatialEvidence.segmentBindings,
      segmentBindingsHash: evidenceCanonicalSha256(geospatialEvidence.segmentBindings),
      segmentDelegationBindingCount: geospatialEvidence.segmentDelegationBindingCount,
      segmentDelegationBindingsHash: geospatialEvidence.segmentDelegationBindingsHash
    },
    negotiation: {
      legacyContractVersion: "sacs-wsgs-grounding/1.0",
      contractVersion: "sacs-wsgs-grounding/1.1",
      profile: "sacs-wsgs-geospatial-findings/1.0",
      transportMode: "RESULT_EXTENSION",
      noHeaderDefault: "sacs-wsgs-grounding/1.0",
      explicitResponseHeadersVerified: true,
      crossContractPersistedReadHttpStatus: mismatchedRead.status
    },
    capabilities: {
      legacyHash: evidenceCanonicalSha256(legacyCapabilities.body),
      geospatialHash: evidenceCanonicalSha256(geospatialCapabilities.body),
      supportedOperationCount: supportedOperations.length,
      requiredCapabilitiesReady: geospatialCapabilities.body["requiredCapabilitiesReady"],
      n05N06RemainUnavailable: true
    },
    realExecution: {
      caseId: definition.id,
      freshSyncPostHttpStatus: synchronousEvidence.traceability.api.postHttpStatus,
      freshSyncGetHttpStatus: synchronousEvidence.traceability.api.getHttpStatus,
      asyncPostHttpStatus: 202,
      persistedGetHttpStatus: 200,
      syncReplayHttpStatus: replay.status,
      terminalStatus: geospatialEvidence.terminalStatus,
      pipelineStageCount: geospatialEvidence.completedStages.length,
      gatewayExecutionCount: geospatialEvidence.gatewayExecutionCount,
      segmentedWorldQueryCount: geospatialEvidence.segmentedWorldQueryCount,
      gatewaySegmentCount: geospatialEvidence.gatewaySegmentCount,
      segmentManifestHashes: geospatialEvidence.segmentManifestHashes,
      segmentPlanHashes: geospatialEvidence.segmentPlanHashes,
      segmentDelegationBindingCount: geospatialEvidence.segmentDelegationBindingCount,
      segmentDelegationBindingsHash: geospatialEvidence.segmentDelegationBindingsHash,
      exactSegmentedGatewayOperationChainVerified: true,
      exactTrustedDataScopeCount: geospatialEvidence.segmentScopeHashes.length,
      resultHash: geospatialEvidence.resultHash,
      persistedResultBytesHash: geospatialEvidence.traceability.postgres.resultBytesHash,
      persistedBytesAndHashMatchGet: true,
      persistedContractSelectionVerified: true,
      syncAndAsyncResultSemanticsMatch: true,
      syncAndAsyncSemanticProjectionHash: asynchronousSemanticHash,
      semanticProjectionIncludesGapsEvidenceAndSubjects: true,
      syncReplayAddedGatewayExecutions: 0,
      ...extension
    },
    synchronousExecution: {
      terminalStatus: synchronousEvidence.terminalStatus,
      resultHash: synchronousEvidence.resultHash,
      persistedResultBytesHash: synchronousEvidence.traceability.postgres.resultBytesHash,
      ...synchronousExtension
    },
    legacyCompatibility: {
      asyncPostHttpStatus: legacyEvidence.traceability.api.postHttpStatus,
      persistedGetHttpStatus: legacyEvidence.traceability.api.getHttpStatus,
      terminalStatus: legacyEvidence.terminalStatus,
      geospatialFindingsAbsent: true,
      resultHash: legacyEvidence.resultHash
    },
    executionBoundary: {
      publicApi: true,
      productionPipeline: true,
      isolatedPostgresqlPersistence: true,
      signedGowmGatewayOnly: true,
      wsgsDirectProviderCalls: 0,
      wsgsDirectUpstreamDatabaseCalls: 0,
      testHarnessPersistenceInspection: true,
      sharedInstanceModified: false
    },
    qualification: {
      contractAuthority: "AUTHORITATIVE",
      implementationQualified: true,
      runtimeQualified: true,
      consumerCompatible: false,
      productionQualified: false,
      g1: "NOT_RUN"
    },
    redaction: {
      credentialsIncluded: false,
      rawGroundingIdsIncluded: false,
      rawReferenceIdsIncluded: false,
      internalProviderUrlsIncluded: false,
      databaseIdentifiersIncluded: false,
      localPathsIncluded: false
    },
    status: "PASS"
  };
  const report = {
    ...reportPayload,
    reportHash: evidenceCanonicalSha256(reportPayload)
  };
  const n04ReportDirectory = resolve(repositoryRoot, "reports", "sacs-geospatial-v1");
  mkdirSync(n04ReportDirectory, { recursive: true });
  writeFileSync(resolve(n04ReportDirectory, "N04-real-runtime.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    marker: "WSGS_V021_RESULT_EXTENSION_RUNTIME_PASS",
    sourceCommit,
    contractVersion: "sacs-wsgs-grounding/1.1",
    profile: "sacs-wsgs-geospatial-findings/1.0",
    asyncPost: 202,
    persistedGet: 200,
    freshSync: 200,
    syncReplay: 200,
    legacyExtensionAbsent: true,
    reportHash: report.reportHash
  }, null, 2)}\n`);
}

try {
  const wsgsSourceBinding = verifyWsgsSourceBinding();
  const runtimeBinding = loadVerifiedRuntimeBinding();
  let productionExecutor: PipelineStageExecutor | undefined;
  let processBinding: VerifiedWsgsProcessBinding | undefined;
  let baseUrl: string;
  if (formalExternalProcessMode) {
    const observation = await observeExternalWsgsProcessBinding(wsgsSourceBinding);
    processBinding = observation.binding;
    baseUrl = observation.baseUrl;
  } else {
    await resetDatabase();
    productionExecutor = await createPipelineStageExecutor({ pool });
    resources = createProductionBackendFromEnvironment({
      readinessProbe: { checkReadiness, captureAdmissionSnapshot }
    });
    app = await createGroundingApi({
      auth: { mode: "STATIC_TRUSTED", identity },
      backend: resources.backend,
      schemas: loadSchemas(),
      ...(n04ResultExtensionOnly
        ? { contractNegotiation: { sacsGeospatialServicePrincipals: [identity.servicePrincipalId] } }
        : {}),
      logger: false
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("PUBLIC_API_ADDRESS_INVALID");
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
  const live = await fetchJson(baseUrl, "/health/live");
  const ready = await fetchJson(baseUrl, "/health/ready");
  if (live.status !== 200 || live.body["status"] !== "live") throw new Error("CURRENT_LOCK_LIVENESS_FAILED");
  if (ready.status !== 200 || ready.body["status"] !== "ready") {
    const reasons = Array.isArray(ready.body["reasons"])
      ? ready.body["reasons"].filter((entry): entry is string => typeof entry === "string").join("_")
      : "NO_REASON";
    throw new Error(`CURRENT_LOCK_READINESS_FAILED_${ready.status}_${String(ready.body["status"])}_${reasons}`);
  }

  if (n04ResultExtensionOnly) {
    await runN04ResultExtensionGate(baseUrl, productionExecutor, wsgsSourceBinding, runtimeBinding);
    exitCode = 0;
  } else {
  const cases: CaseEvidence[] = [];
  const gdpsCaseIds = new Set<string>();
  const gdpsSuite: GdpsCaseSuite = formalR1R5Only
    ? { mode: "DISABLED", cases: [], totalCaseCount: 0, selectedCaseCount: 0, fullCorpusSelected: false }
    : loadFrozenGdpsCaseSuite();
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

  const r1Case = await submitAndRun(baseUrl, productionExecutor, "R1", requestBody(
    "R1", "2号车在哪里？", "EXECUTE_WORLD_QUERY", ["WORLD_EVIDENCE"]
  ), ["COMPLETED"]);
  cases.push(r1Case);
  const r1KnownVehicle = knownReferenceFromCase(r1Case, "2号车");
  cases.push(await submitAndRun(baseUrl, productionExecutor, "R2", requestBody(
    "R2", "滨河路附近有哪些设备？", "EXECUTE_WORLD_QUERY", ["WORLD_EVIDENCE"]
  ), ["AMBIGUOUS"]));
  if (cases.at(-1)?.spatialExecutionCount !== 0 || cases.at(-1)?.worldQueryCount !== 0 ||
      cases.at(-1)?.gatewayExecutionCount !== 0) {
    throw new Error("AMBIGUOUS_REFERENCE_DID_NOT_STOP_SPATIAL_EXECUTION");
  }
  cases.push(await submitAndRun(baseUrl, productionExecutor, "R3", requestBody(
    "R3", "A区内有哪些车辆？", "EXECUTE_WORLD_QUERY", ["WORLD_EVIDENCE"]
  ), ["COMPLETED"]));
  cases.push(await submitAndRun(baseUrl, productionExecutor, "R4", requestBody(
    "R4", "2号车附近1公里有什么？", "EXECUTE_WORLD_QUERY", ["WORLD_EVIDENCE"]
  ), ["COMPLETED"]));
  cases.push(await submitAndRun(baseUrl, productionExecutor, "R5", requestBody(
    "R5", "验证2号车当前有效性", "VALIDATE_REFERENCES", ["RESOLVED_REFERENCES"], [r1KnownVehicle]
  ), ["COMPLETED"]));

  if (formalR1R5Only) {
    if (!processBinding) throw new Error("WSGS_EXTERNAL_PROCESS_BINDING_MISSING");
    const formalReportHashes = emitFormalR1R5Reports(cases, runtimeBinding, wsgsSourceBinding, processBinding);
    process.stdout.write(`${JSON.stringify({
      marker: "WSGS_GOWM_FORMAL_PIPELINE_R1_R5_READY",
      sourceCommit,
      runtimeBindingHash: runtimeBinding.runtimeBindingHash,
      wsgsProcessBindingHash: processBinding.bindingHash,
      recipesPassed: 5,
      reportHashes: formalReportHashes,
      redacted: true
    }, null, 2)}\n`);
    exitCode = 0;
  } else {
  if (!resources || !productionExecutor) throw new Error("IN_PROCESS_RUNTIME_NOT_INITIALIZED");

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
    "PARTIAL", "2号车在哪里？", "GROUND_REFERENCES", ["RESOLVED_REFERENCES"], [r1KnownVehicle]
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
  }
  }
} catch (error) {
  const code = error instanceof Error ? error.message.replace(/[^A-Za-z0-9_:-]/gu, "_").slice(0, 240) : "UNKNOWN_ERROR";
  process.stderr.write(`${JSON.stringify({ marker: "WSGS_REAL_DEVELOPMENT_PIPELINE_BLOCKED", code })}\n`);
} finally {
  await app?.close().catch(() => undefined);
  await resources?.close().catch(() => undefined);
  await pool.end().catch(() => undefined);
}

process.exit(exitCode);
