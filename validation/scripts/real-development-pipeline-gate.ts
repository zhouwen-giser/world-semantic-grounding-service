import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { createGroundingIdentity } from "@wsgs/delegated-identity";
import {
  Aes256GcmPayloadCodec,
  GroundingPipeline,
  PostgresPipelineJournal,
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
if (formalR1R5Only && !formalExternalProcessMode) throw new Error("WSGS_FORMAL_EXTERNAL_PROCESS_MODE_REQUIRED");
if (formalExternalProcessMode && !formalR1R5Only) throw new Error("WSGS_FORMAL_EXTERNAL_PROCESS_MODE_REQUIRES_R1_R5_ONLY");
if (formalR1R5Only) {
  if (!process.env["WSGS_FORMAL_API_BASE_URL"]?.trim()) throw new Error("WSGS_FORMAL_API_BASE_URL_REQUIRED");
  if (!process.env["WSGS_RUNTIME_COMPOSE_PROJECT"]?.trim()) throw new Error("WSGS_RUNTIME_COMPOSE_PROJECT_REQUIRED");
  if (!process.env["WSGS_RUNTIME_IMAGE_BUILD_REPORT"]?.trim()) throw new Error("WSGS_RUNTIME_IMAGE_BUILD_REPORT_REQUIRED");
  if (process.env["WSGS_FORMAL_ISOLATED_DATABASE"]?.trim() !== "YES") {
    throw new Error("WSGS_FORMAL_ISOLATED_DATABASE_REQUIRED");
  }
}
const expectedGowmRuntimeSourceCommit = "fceed92398a0b86c0a0121aa2188a7f1d328e577";
const expectedGowmRuntimeVersion = "0.6.4";
const expectedGatewayContractVersion = "0.6.3";
const expectedWsgsRuntimeVersion = "0.2.1";
const apiBearerToken = process.env["WSGS_FORMAL_API_BEARER_TOKEN"]?.trim();
const encryptionKey = required("WSGS_REQUEST_ENCRYPTION_KEY_BASE64");
const payloadCodec = Aes256GcmPayloadCodec.fromBase64(encryptionKey);
const identity = createGroundingIdentity({
  servicePrincipalId: required("GOWM_DELEGATION_SERVICE_PRINCIPAL_ID"),
  actorId: required("WSGS_READINESS_ACTOR_ID"),
  dataScopes: [required("WSGS_READINESS_DATA_SCOPE")],
  datasetScopes: list("WSGS_READINESS_DATASET_SCOPES"),
  permissions: [...new Set([...list("WSGS_READINESS_PERMISSIONS"), "grounding.read"])]
});

interface VerifiedWsgsSourceBinding {
  status: "PASS";
  headCommit: string;
  sourceTree: string;
  evidenceSourceCommit: string;
  trackedSourceClean: true;
  verification: "GIT_HEAD_AND_TRACKED_DIFF";
}

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
    execFileSync("git", ["-C", repositoryRoot, "diff", "--quiet", "HEAD", "--", "."], {
      stdio: "ignore"
    });
  } catch {
    throw new Error("WSGS_SOURCE_TRACKED_DIRTY");
  }
  return {
    status: "PASS",
    headCommit: head,
    sourceTree,
    evidenceSourceCommit: sourceCommit,
    trackedSourceClean: true,
    verification: "GIT_HEAD_AND_TRACKED_DIFF"
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
      imageBuildReport["sourceTree"] !== sourceTree || imageBuildReport["imageDigest"] !== imageDigest) {
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
    runtimeVersion: expectedWsgsRuntimeVersion,
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
    runtimeVersion: expectedWsgsRuntimeVersion,
    composeProjectHash: safeId(composeProject),
    serviceSetHash: canonicalSha256(expectedServices),
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
  return { baseUrl: apiUrl.origin, binding: { ...payload, bindingHash: canonicalSha256(payload) } };
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
    api: { postHttpStatus: 202; getHttpStatus: 200; requestHash: `sha256:${string}` };
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
}

const privateCaseRuntime = new WeakMap<CaseEvidence, PrivateCaseRuntime>();

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
  const codec = Aes256GcmPayloadCodec.fromBase64(encryptionKey);
  return new GroundingWorker({
    workerId,
    store: new PostgresGroundingWorkerStore(pool, codec),
    pipeline: new GroundingPipeline({
      executor,
      journal: new PostgresPipelineJournal(pool, codec),
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
  const headers = new Headers(init?.headers);
  if (apiBearerToken) headers.set("authorization", `Bearer ${apiBearerToken}`);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  return { status: response.status, body: object(await response.json(), "API_RESPONSE_INVALID") };
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
    const material = outcome["encryptedCheckpointEvidenceMaterial"];
    if (!material || typeof material !== "object" || Array.isArray(material)) continue;
    const protectedMaterial = material as JsonObject;
    const terminal = protectedMaterial["terminal"];
    const world = protectedMaterial["responseStatus"] === 200
      ? protectedMaterial["response"]
      : terminal && typeof terminal === "object" && !Array.isArray(terminal)
        ? (terminal as JsonObject)["result"]
        : undefined;
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
  return {
    resolverReferenceKeyHashes: uniqueDigests(resolverHashes),
    worldFactReferenceKeyHashes: uniqueDigests(worldFactHashes),
    worldFactReferenceObjectHashes: uniqueDigests(worldFactObjectHashes),
    nodeStatuses,
    upstreamResultHashes: uniqueDigests(upstreamResultHashes),
    spatialResultCount
  };
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
  terminalResult: JsonObject
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
  }>(
    `SELECT job.job_id, request.request_id, job.status AS job_status, job.stage_generation,
            checkpoint.run_fingerprint, checkpoint.state_hash,
            checkpoint.previous_record_hash AS checkpoint_record_hash,
            checkpoint.last_completed_stage, request.payload_hash,
            result.status AS result_status, result.result_hash, result.result_bytes
       FROM wsgs.grounding_job AS job
       JOIN wsgs.grounding_request AS request ON request.grounding_id = job.grounding_id
       LEFT JOIN wsgs.pipeline_checkpoint AS checkpoint ON checkpoint.job_id = job.job_id
       LEFT JOIN wsgs.grounding_result AS result ON result.grounding_id = job.grounding_id
      WHERE job.grounding_id = $1`,
    [groundingId]
  );
  const jobRow = job.rows[0];
  if (!jobRow) throw new Error("GROUNDING_JOB_MISSING");
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
  }>(
    "SELECT plan_hash, upstream_result_hash FROM wsgs.world_query WHERE grounding_id = $1 ORDER BY query_id",
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
  if (jobRow.payload_hash !== requestHash || resultBytesHash !== canonicalSha256(terminalResult) ||
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
  const named = collectNamedStrings(terminalResult, new Set(["productId", "contentHash"]));
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
    truncated: serializedResult.includes('"truncated":true'),
    totalStageElapsedMs: terminalEvents.reduce((sum, event) => sum + event.elapsed_ms, 0),
    compositionProof: compositionProof(checkpoint.state, terminalResult),
    traceability: {
      status: "PASS",
      api: { postHttpStatus: 202, getHttpStatus: 200, requestHash },
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
        persistedExecutionCount: executions.rowCount ?? 0,
        planHashesMatchCheckpoint: true,
        upstreamHashesMatchCheckpoint: true
      },
      persistence: { jobStatus: jobRow.job_status, getMatchesPersistedResult: true }
    }
  };
  privateCaseRuntime.set(evidence, { groundingId, terminalResult, checkpointState: checkpoint.state });
  return evidence;
}

async function submitAndRun(
  baseUrl: string,
  executor: PipelineStageExecutor | undefined,
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
    : await fetchJson(baseUrl, `/v1/groundings/${encodeURIComponent(groundingId)}`);
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
  const evidenceHash = canonicalSha256(payload) as `sha256:${string}`;
  writeFileSync(resolve(formalReportDirectory, name), `${JSON.stringify({ ...payload, evidenceHash }, null, 2)}\n`, "utf8");
  return evidenceHash;
}

function writeWsgsProcessBinding(binding: VerifiedWsgsProcessBinding): ReportedWsgsProcessBinding {
  const { bindingHash, ...bindingPayload } = binding;
  if (canonicalSha256(bindingPayload) !== bindingHash) throw new Error("WSGS_PROCESS_BINDING_HASH_MISMATCH");
  const reportPath = resolve(formalReportDirectory, "wsgs-process-binding.json");
  const relativeReportPath = repositoryRelativePath(reportPath, "WSGS_PROCESS_BINDING_REPORT_OUTSIDE_REPOSITORY");
  const reportEvidenceHash = canonicalSha256(binding) as `sha256:${string}`;
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

  const cases: CaseEvidence[] = [];
  const gdpsCaseIds = new Set<string>();
  if (!formalR1R5Only && process.env["WSGS_RUN_GDPS_INTEGRATION_CASES"] === "YES") {
    const gdpsCases = [
      ["E2E-01", "2号车位置的地表覆盖是什么？", "landcover.get-class@1.0", ["COMPLETED", "PARTIAL"]],
      ["E2E-02", "A区内有哪些湿地？", "hydrology.find-wetlands@1.0", ["COMPLETED", "PARTIAL"]],
      ["E2E-03", "2号车附近500米有哪些障碍物？", "obstacle.find-nearby@1.0", ["COMPLETED", "PARTIAL", "NO_DATA"]],
      ["E2E-04", "A区内有哪些不可通行区域？", "traversability.find-blocked@1.0", ["COMPLETED", "PARTIAL"]],
      ["E2E-05", "A区内有哪些高地？", "terrain.find-high-ground@1.0", ["COMPLETED", "PARTIAL"]],
      ["E2E-06", "2号车位置的高程是多少？", "elevation.sample@1.0", ["COMPLETED", "PARTIAL"]],
      ["E2E-07", "为什么2号车当前位置的通行性受限？", "traversability.explain@1.0", ["COMPLETED", "PARTIAL"]]
    ] as const;
    const requestedGdpsCase = process.env["WSGS_GDPS_CASE_ID"];
    const selectedGdpsCases = requestedGdpsCase
      ? gdpsCases.filter(([caseId]) => caseId === requestedGdpsCase)
      : gdpsCases;
    if (selectedGdpsCases.length === 0) throw new Error(`UNKNOWN_GDPS_CASE_${requestedGdpsCase}`);
    for (const [caseId, text, targetOperation, acceptedOperationStatuses] of selectedGdpsCases) {
      gdpsCaseIds.add(caseId);
      cases.push(await submitAndRun(baseUrl, productionExecutor, caseId, requestBody(
        caseId, text, "EXECUTE_WORLD_QUERY", ["WORLD_EVIDENCE"]
      ), ["COMPLETED", "PARTIAL", "UNRESOLVED"]));
      const last = cases.at(-1)!;
      const target = last.operationStatuses.find((entry) => entry.operationKey === targetOperation);
      if (!target) throw new Error(`GDPS_OPERATION_NOT_EXECUTED_${caseId}`);
      if (!(acceptedOperationStatuses as readonly string[]).includes(target.status)) {
        throw new Error(`GDPS_OPERATION_STATUS_${caseId}_${target.status}`);
      }
    }
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
  for (const evidence of cases) {
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
    recipes: cases.map((entry) => ({
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
      cases: cases.filter((entry) => gdpsCaseIds.has(entry.recipeId)).map((entry) => ({
        caseId: entry.recipeId,
        terminalStatus: entry.terminalStatus,
        operationKeys: entry.operationKeys,
        operationStatuses: entry.operationStatuses,
        productIds: entry.productIds,
        contentHashes: entry.contentHashes,
        truncated: entry.truncated,
        status: "PASS"
      })),
      geometryBuffer: {
        caseId: "E2E-08",
        status: "NOT_RUN",
        reason: "GOWM_GEOMETRY_BUFFER_CAPABILITY_REQUIRED"
      },
      status: gdpsCaseIds.size === 7 ? "PASS" : "NOT_RUN"
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
  process.stdout.write(`${JSON.stringify({
    marker: "WSGS_REAL_DEVELOPMENT_PIPELINE_PASS",
    sourceCommit,
    recipesPassed: cases.length,
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
} catch (error) {
  const code = error instanceof Error ? error.message.replace(/[^A-Za-z0-9_:-]/gu, "_").slice(0, 240) : "UNKNOWN_ERROR";
  process.stderr.write(`${JSON.stringify({ marker: "WSGS_REAL_DEVELOPMENT_PIPELINE_BLOCKED", code })}\n`);
} finally {
  await app?.close().catch(() => undefined);
  await resources?.close().catch(() => undefined);
  await pool.end().catch(() => undefined);
}

process.exit(exitCode);
