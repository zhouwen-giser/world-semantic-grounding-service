import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createGroundingIdentity, GowmDelegationSigner } from "@wsgs/delegated-identity";
import {
  GOWM_SOUTHBOUND_LOCK_RAW_SHA256,
  loadOperationalGowmLock
} from "@wsgs/gowm-contract-intake";
import {
  GowmGatewayClient,
  GatewayProtocolError,
  type CapabilityDescriptor,
  type GatewayRequestContext,
  type OperationLock
} from "@wsgs/gowm-gateway-client";

type JsonObject = Record<string, unknown>;
type CheckStatus = "PASS" | "BLOCKED";

interface GateCheck {
  id: string;
  status: CheckStatus;
  evidence: JsonObject;
}

interface ConsumerLock {
  contractCatalogRevision: `sha256:${string}`;
  semanticCatalogHash: `sha256:${string}`;
  defaultOperations: OperationLock[];
  previewOperations: OperationLock[];
}

const expectedOperationKeys = [
  "reference.resolve@1.0",
  "reference.validate@1.0",
  "world.get-current-state@1.0",
  "world.get-geometry@1.0",
  "spatial.find-in-area@1.0",
  "spatial.find-nearby@1.0"
] as const;
const expectedOperationIds = expectedOperationKeys.map((key) => key.slice(0, key.lastIndexOf("@")));
const terminalStatuses = new Set(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]);
const alignmentFocused = process.env["GOWM_ALIGNMENT_R1_R5_ONLY"] === "YES";
const foreignReferenceId = "wrf_02ffffffffffffffffffffffffffffff";
const outsideReferenceId = "wrf_02000000000000000000000000000003";
let failureStage = "startup";
let failureEvidence: JsonObject | undefined;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function assertion(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function object(value: unknown, code: string): JsonObject {
  assertion(value !== null && typeof value === "object" && !Array.isArray(value), code);
  return value as JsonObject;
}

function array(value: unknown, code: string): unknown[] {
  assertion(Array.isArray(value), code);
  return value;
}

function text(value: unknown, code: string): string {
  assertion(typeof value === "string" && value.length > 0, code);
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as JsonObject;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// The published 0.6.3 bundle builder used localeCompare while the live
// contract runtime uses the code-point ordering above. Keep this function
// diagnostic-only so the real gate can prove that exact upstream mismatch;
// it is never used to validate a request or response.
function bundleBuildCanonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right)));
  });
}

function bundleBuildSha256(value: unknown): `sha256:${string}` {
  return sha256(bundleBuildCanonical(value));
}

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalSha256(value: unknown): `sha256:${string}` {
  return sha256(canonical(value));
}

function safeReferenceEvidence(referenceKey: JsonObject): JsonObject {
  return {
    namespace: text(referenceKey["namespace"], "REFERENCE_NAMESPACE_MISSING"),
    kind: text(referenceKey["kind"], "REFERENCE_KIND_MISSING"),
    idHash: sha256(text(referenceKey["id"], "REFERENCE_ID_MISSING")),
    version: text(referenceKey["version"], "REFERENCE_VERSION_MISSING"),
    identityHash: referenceIdentityHash(referenceKey)
  };
}

function referenceIdentityHash(referenceKey: JsonObject): `sha256:${string}` {
  return canonicalSha256({
    namespace: text(referenceKey["namespace"], "REFERENCE_NAMESPACE_MISSING"),
    kind: text(referenceKey["kind"], "REFERENCE_KIND_MISSING"),
    id: text(referenceKey["id"], "REFERENCE_ID_MISSING"),
    version: text(referenceKey["version"], "REFERENCE_VERSION_MISSING")
  });
}

function outputValue(envelope: unknown, code: string): JsonObject {
  const record = object(envelope, `${code}_ENVELOPE`);
  const output = object(record["output"], `${code}_OUTPUT`);
  return object(output["value"], `${code}_VALUE`);
}

function receiptIds(envelope: unknown): string[] {
  return array(object(envelope, "RECEIPT_ENVELOPE")["receipts"], "RECEIPTS_MISSING")
    .map((item) => text(object(item, "RECEIPT_INVALID")["receiptId"], "RECEIPT_ID_MISSING"));
}

function schemaPort(port: unknown): JsonObject {
  const value = object(port, "PORT_INVALID");
  return {
    schemaUri: text(value["schemaUri"], "PORT_SCHEMA_URI_MISSING"),
    schemaHash: text(value["schemaHash"], "PORT_SCHEMA_HASH_MISSING"),
    valueKind: text(value["valueKind"], "PORT_VALUE_KIND_MISSING"),
    unitSemantics: text(value["unitSemantics"], "PORT_UNIT_MISSING")
  };
}

async function schemaHash(relativePath: string): Promise<`sha256:${string}`> {
  const url = new URL(`../../contracts/upstream/gowm-0.6.3/extracted/package/bundle/schemas/${relativePath}`, import.meta.url);
  return canonicalSha256(JSON.parse(await readFile(url, "utf8")) as unknown);
}

async function upstreamSchemaHash(relativePath: string): Promise<`sha256:${string}`> {
  const url = new URL(`../../contracts/upstream/${relativePath}`, import.meta.url);
  return canonicalSha256(JSON.parse(await readFile(url, "utf8")) as unknown);
}

function literalSchemaName(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

async function literalBinding(value: unknown, targetPath?: string): Promise<JsonObject> {
  const kind = literalSchemaName(value);
  assertion(["array", "boolean", "null", "number", "object", "string"].includes(kind), "LITERAL_KIND_UNSUPPORTED");
  return {
    kind: "LITERAL",
    value,
    ...(targetPath === undefined ? {} : { targetPath }),
    port: {
      schemaUri: `urn:gowm:v0.2:value:${kind}`,
      schemaHash: await schemaHash(`platform/value-${kind}.schema.json`),
      valueKind: "ANY",
      unitSemantics: "UNSPECIFIED"
    }
  };
}

function operationRef(descriptor: CapabilityDescriptor): JsonObject {
  return {
    operationId: descriptor.operationId,
    operationVersion: descriptor.operationVersion,
    inputSchemaHash: descriptor.inputSchemaHash,
    outputSchemaHash: descriptor.outputSchemaHash
  };
}

function alignmentOperationProjection(value: OperationLock): JsonObject {
  return {
    operationId: value.operationId,
    operationVersion: value.operationVersion,
    inputSchemaHash: value.inputSchemaHash,
    outputSchemaHash: value.outputSchemaHash,
    semanticProfileHash: value.semanticProfileHash,
    maturity: value.maturity
  };
}

function loadAlignmentRuntimeOperationLock(
  path: string,
  expectedSha256: string,
  bundledLockPath: string
): ConsumerLock {
  const repositoryRoot = resolve(import.meta.dirname, "..", "..");
  const absolute = resolve(path);
  const safePath = relative(repositoryRoot, absolute).split(sep).join("/");
  assertion(
    safePath === "contracts/generated/gdps-v0.2.1/wsgs-southbound-operation-lock-v2.json",
    "ALIGNMENT_RUNTIME_OPERATION_LOCK_PATH_INVALID"
  );
  assertion(/^sha256:[0-9a-f]{64}$/u.test(expectedSha256), "ALIGNMENT_RUNTIME_OPERATION_LOCK_HASH_INVALID");
  const bytes = readFileSync(absolute);
  assertion(sha256(bytes) === expectedSha256, "ALIGNMENT_RUNTIME_OPERATION_LOCK_HASH_MISMATCH");
  const document = object(JSON.parse(bytes.toString("utf8")) as unknown, "ALIGNMENT_RUNTIME_OPERATION_LOCK_INVALID");
  const expectedKeys = [
    "availabilityContractHash",
    "consumerContractPackage",
    "contractCatalogRevision",
    "defaultOperations",
    "delegationContractHash",
    "gatewayContractVersion",
    "previewOperations",
    "schemaVersion",
    "semanticCatalogHash",
    "snapshotContractHash"
  ];
  assertion(
    JSON.stringify(Object.keys(document).sort()) === JSON.stringify(expectedKeys),
    "ALIGNMENT_RUNTIME_OPERATION_LOCK_KEYS_INVALID"
  );
  const consumerContractPackage = object(
    document["consumerContractPackage"],
    "ALIGNMENT_RUNTIME_OPERATION_LOCK_PACKAGE_INVALID"
  );
  assertion(
    JSON.stringify(Object.keys(consumerContractPackage).sort()) ===
      JSON.stringify(["integrity", "name", "version"]),
    "ALIGNMENT_RUNTIME_OPERATION_LOCK_PACKAGE_KEYS_INVALID"
  );
  assertion(document["schemaVersion"] === "2.0" &&
    document["gatewayContractVersion"] === "0.6.3" &&
    consumerContractPackage["name"] === "@gowm/world-gateway-contracts" &&
    consumerContractPackage["version"] === "0.6.3" &&
    /^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(text(
      consumerContractPackage["integrity"],
      "ALIGNMENT_RUNTIME_OPERATION_LOCK_PACKAGE_INTEGRITY_MISSING"
    )),
  "ALIGNMENT_RUNTIME_OPERATION_LOCK_IDENTITY_INVALID");
  for (const key of [
    "availabilityContractHash",
    "contractCatalogRevision",
    "delegationContractHash",
    "semanticCatalogHash",
    "snapshotContractHash"
  ]) {
    assertion(/^sha256:[0-9a-f]{64}$/u.test(text(document[key], `ALIGNMENT_RUNTIME_OPERATION_LOCK_${key}_MISSING`)),
      `ALIGNMENT_RUNTIME_OPERATION_LOCK_${key}_INVALID`);
  }
  const defaults = array(document["defaultOperations"], "ALIGNMENT_RUNTIME_DEFAULT_OPERATIONS_INVALID");
  const previews = array(document["previewOperations"], "ALIGNMENT_RUNTIME_PREVIEW_OPERATIONS_INVALID");
  assertion(defaults.length === 12 && previews.length === 30, "ALIGNMENT_RUNTIME_OPERATION_COUNT_MISMATCH");
  const lock = document as unknown as ConsumerLock;
  const allOperations = [...lock.defaultOperations, ...lock.previewOperations];
  const operationKeys = allOperations.map((entry) => `${entry.operationId}@${entry.operationVersion}`);
  assertion(new Set(operationKeys).size === 42, "ALIGNMENT_RUNTIME_OPERATION_DUPLICATE");

  const bundled = loadOperationalGowmLock({
    lockPath: bundledLockPath,
    expectedSha256: `sha256:${GOWM_SOUTHBOUND_LOCK_RAW_SHA256}`,
    hashMode: "EXACT_BYTES"
  }).lock as ConsumerLock;
  const bundledOperations = [...bundled.defaultOperations, ...bundled.previewOperations];
  for (const expectedKey of expectedOperationKeys) {
    const live = allOperations.find((entry) => `${entry.operationId}@${entry.operationVersion}` === expectedKey);
    const baseline = bundledOperations.find((entry) => `${entry.operationId}@${entry.operationVersion}` === expectedKey);
    assertion(live !== undefined && baseline !== undefined, `ALIGNMENT_RUNTIME_OPERATION_MISSING_${expectedKey}`);
    assertion(
      canonical(alignmentOperationProjection(live)) === canonical(alignmentOperationProjection(baseline)),
      `ALIGNMENT_RUNTIME_OPERATION_DRIFT_${expectedKey}`
    );
  }
  return lock;
}

function nodeBudget(descriptor: CapabilityDescriptor): JsonObject {
  return {
    maximumRows: descriptor.limits.maximumRows ?? 100_000,
    maximumCandidates: descriptor.limits.maximumCandidates ?? 100_000,
    maximumOutputBytes: descriptor.limits.maximumOutputBytes ?? 16_777_216,
    maximumExecutionMs: Math.min(descriptor.execution.maximumTimeoutMs, 120_000)
  };
}

function loadRuntimeImageBuildEvidence(imageDigest: string): JsonObject {
  const configuredPath = process.env["GOWM_RUNTIME_IMAGE_BUILD_REPORT"]?.trim();
  assertion(!alignmentFocused || Boolean(configuredPath), "GOWM_RUNTIME_IMAGE_BUILD_REPORT_REQUIRED");
  if (!configuredPath) return { status: "NOT_REQUESTED" };
  const repositoryRoot = resolve(import.meta.dirname, "..", "..");
  const reportPath = resolve(repositoryRoot, configuredPath);
  const safePath = relative(repositoryRoot, reportPath).split(sep).join("/");
  assertion(!safePath.startsWith(".."), "GOWM_RUNTIME_IMAGE_BUILD_REPORT_OUTSIDE_REPOSITORY");
  assertion(
    !alignmentFocused ||
      safePath === "reports/wsgs-gowm-0.6.4-alignment/runtime-image-build-report.json",
    "GOWM_RUNTIME_IMAGE_BUILD_REPORT_PATH_MISMATCH"
  );
  const bytes = readFileSync(reportPath);
  const report = object(JSON.parse(bytes.toString("utf8")) as unknown, "GOWM_RUNTIME_IMAGE_BUILD_REPORT_INVALID");
  const evidenceHash = text(report["evidenceHash"], "GOWM_RUNTIME_IMAGE_BUILD_REPORT_HASH_MISSING");
  assertion(/^sha256:[0-9a-f]{64}$/u.test(evidenceHash), "GOWM_RUNTIME_IMAGE_BUILD_REPORT_HASH_INVALID");
  const { evidenceHash: _evidenceHash, ...payload } = report;
  assertion(canonicalSha256(payload) === evidenceHash, "GOWM_RUNTIME_IMAGE_BUILD_REPORT_HASH_MISMATCH");
  assertion(report["status"] === "PASS", "GOWM_RUNTIME_IMAGE_BUILD_REPORT_NOT_PASS");
  assertion(report["sourceCommit"] === "c49bf415fdb4cbe19a09f341c34b6dd825e3ca14", "GOWM_RUNTIME_IMAGE_BUILD_SOURCE_MISMATCH");
  assertion(report["runtimeVersion"] === "0.6.4", "GOWM_RUNTIME_IMAGE_BUILD_VERSION_MISMATCH");
  const independentBuildImageDigest = text(
    report["imageDigest"],
    "GOWM_RUNTIME_IMAGE_BUILD_INDEPENDENT_DIGEST_MISSING"
  );
  assertion(/^sha256:[0-9a-f]{64}$/u.test(independentBuildImageDigest),
    "GOWM_RUNTIME_IMAGE_BUILD_INDEPENDENT_DIGEST_INVALID");
  assertion(report["runtimeImageDigest"] === imageDigest, "GOWM_RUNTIME_IMAGE_BUILD_DIGEST_MISMATCH");
  const independentBuildContentHash = text(
    report["independentBuildContentHash"],
    "GOWM_RUNTIME_IMAGE_BUILD_CONTENT_HASH_MISSING"
  );
  const runtimeContentHash = text(report["runtimeContentHash"], "GOWM_RUNTIME_IMAGE_CONTENT_HASH_MISSING");
  assertion(/^sha256:[0-9a-f]{64}$/u.test(independentBuildContentHash) &&
    independentBuildContentHash === runtimeContentHash && report["tagIndependentContentMatch"] === true,
  "GOWM_RUNTIME_IMAGE_BUILD_CONTENT_MISMATCH");
  assertion(JSON.stringify(report["tagScopedIdentityFieldsExcluded"]) ===
    JSON.stringify(["Descriptor", "Id", "Identity", "Metadata", "RepoDigests", "RepoTags"]),
  "GOWM_RUNTIME_IMAGE_BUILD_CONTENT_PROJECTION_INVALID");
  const sourceTree = text(report["sourceTree"], "GOWM_RUNTIME_IMAGE_BUILD_TREE_MISSING");
  assertion(/^[0-9a-f]{40}$/u.test(sourceTree), "GOWM_RUNTIME_IMAGE_BUILD_TREE_INVALID");
  const generatedAt = text(report["generatedAt"], "GOWM_RUNTIME_IMAGE_BUILD_TIME_MISSING");
  assertion(Number.isFinite(Date.parse(generatedAt)), "GOWM_RUNTIME_IMAGE_BUILD_TIME_INVALID");
  return {
    status: "PASS",
    sourceTree,
    reportPath: safePath,
    reportFileHash: sha256(bytes),
    reportPayloadHash: evidenceHash,
    independentBuildImageDigest,
    tagIndependentContentHash: independentBuildContentHash,
    generatedAt
  };
}

function observeExactRuntimeBinding(baseUrl: URL): JsonObject {
  const composeProject = process.env["GOWM_RUNTIME_COMPOSE_PROJECT"]?.trim();
  if (!composeProject) {
    assertion(!alignmentFocused, "GOWM_RUNTIME_COMPOSE_PROJECT_REQUIRED");
    return { status: "NOT_REQUESTED" };
  }
  assertion(/^[a-z0-9][a-z0-9_-]{2,62}$/u.test(composeProject), "GOWM_RUNTIME_COMPOSE_PROJECT_INVALID");
  const expectedServices = [
    "dataset-catalog-provider",
    "platform-validation-provider",
    "reference-catalog-provider",
    "spatial-provider-bridge",
    "world-capability-gateway",
    "world-evidence-provider"
  ];
  let inspection: Array<{
    Image?: string;
    Config?: { Image?: string; Labels?: Record<string, string> };
    State?: { Running?: boolean; Health?: { Status?: string } };
    NetworkSettings?: { Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null> };
  }>;
  try {
    const ids = execFileSync("docker", [
      "ps", "--quiet", "--filter", `label=com.docker.compose.project=${composeProject}`
    ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).trim().split(/\s+/u).filter(Boolean);
    assertion(ids.length >= expectedServices.length, "GOWM_RUNTIME_CONTAINER_SET_INCOMPLETE");
    inspection = JSON.parse(execFileSync("docker", ["inspect", ...ids], {
      encoding: "utf8", maxBuffer: 16 * 1024 * 1024
    })) as typeof inspection;
  } catch (error) {
    if (error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)) throw error;
    throw new Error("GOWM_RUNTIME_DOCKER_INSPECTION_FAILED");
  }
  const appContainers = inspection.filter((entry) =>
    expectedServices.includes(entry.Config?.Labels?.["com.docker.compose.service"] ?? ""));
  const observedServices = appContainers.map((entry) => entry.Config?.Labels?.["com.docker.compose.service"] ?? "").sort();
  assertion(JSON.stringify(observedServices) === JSON.stringify(expectedServices), "GOWM_RUNTIME_CONTAINER_SET_MISMATCH");
  assertion(appContainers.every((entry) => entry.State?.Running === true && entry.State?.Health?.Status === "healthy"),
    "GOWM_RUNTIME_CONTAINER_NOT_HEALTHY");
  const imageIds = [...new Set(appContainers.map((entry) => entry.Image))];
  assertion(imageIds.length === 1 && /^sha256:[0-9a-f]{64}$/u.test(imageIds[0] ?? ""), "GOWM_RUNTIME_IMAGE_ID_MISMATCH");
  assertion(appContainers.every((entry) =>
    entry.Config?.Labels?.["org.opencontainers.image.revision"] === "c49bf415fdb4cbe19a09f341c34b6dd825e3ca14" &&
    entry.Config?.Labels?.["org.opencontainers.image.version"] === "0.6.4"), "GOWM_RUNTIME_IMAGE_SOURCE_LABEL_MISMATCH");
  const gateway = appContainers.find((entry) =>
    entry.Config?.Labels?.["com.docker.compose.service"] === "world-capability-gateway");
  const published = gateway?.NetworkSettings?.Ports?.["8090/tcp"] ?? [];
  const expectedPort = baseUrl.port || (baseUrl.protocol === "https:" ? "443" : "80");
  assertion(published.some((entry) => entry.HostPort === expectedPort && ["127.0.0.1", "::1"].includes(entry.HostIp ?? "")),
    "GOWM_RUNTIME_GATEWAY_ENDPOINT_BINDING_MISMATCH");
  const imageBuildEvidence = loadRuntimeImageBuildEvidence(imageIds[0]!);
  const payload = {
    schemaVersion: "wsgs-gowm-runtime-binding/1.0",
    bindingStatus: "PASS",
    observedAt: new Date().toISOString(),
    sourceCommit: "c49bf415fdb4cbe19a09f341c34b6dd825e3ca14",
    runtimeVersion: "0.6.4",
    gatewayContractVersion: "0.6.3",
    imageDigest: imageIds[0],
    appContainerCount: appContainers.length,
    composeProjectHash: sha256(composeProject),
    serviceSetHash: canonicalSha256(observedServices),
    gatewayPortBindingVerified: true,
    allAppContainersHealthy: true,
    sourceBindingMethod: "OCI_LABEL_AND_RUNNING_CONTAINER_IMAGE_ID",
    imageBuildEvidence,
    redaction: { credentialsIncluded: false, rawContainerIdsIncluded: false, internalTopologyIncluded: false }
  };
  const evidencePayload = { ...payload, evidenceHash: canonicalSha256(payload) };
  const evidenceBytes = `${JSON.stringify(evidencePayload, null, 2)}\n`;
  const repositoryRoot = resolve(import.meta.dirname, "..", "..");
  const evidencePath = resolve(repositoryRoot, process.env["GOWM_RUNTIME_BINDING_REPORT"] ??
    "reports/wsgs-gowm-0.6.4-alignment/runtime-binding-report.json");
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, evidenceBytes, "utf8");
  const safeEvidencePath = relative(repositoryRoot, evidencePath).split(sep).join("/");
  assertion(!safeEvidencePath.startsWith(".."), "GOWM_RUNTIME_BINDING_REPORT_OUTSIDE_REPOSITORY");
  assertion(
    !alignmentFocused ||
      safeEvidencePath === "reports/wsgs-gowm-0.6.4-alignment/runtime-binding-report.json",
    "GOWM_RUNTIME_BINDING_REPORT_PATH_MISMATCH"
  );
  const binding = {
    bindingStatus: "PASS",
    sourceCommit: payload.sourceCommit,
    runtimeVersion: payload.runtimeVersion,
    gatewayContractVersion: payload.gatewayContractVersion,
    imageDigest: payload.imageDigest,
    observedAt: payload.observedAt,
    instanceEvidencePath: safeEvidencePath,
    instanceEvidenceHash: sha256(evidenceBytes),
    instanceEvidencePayloadHash: evidencePayload.evidenceHash,
    imageBuildEvidencePath: imageBuildEvidence["reportPath"],
    imageBuildEvidenceHash: imageBuildEvidence["reportFileHash"],
    imageBuildEvidencePayloadHash: imageBuildEvidence["reportPayloadHash"],
    sourceTree: imageBuildEvidence["sourceTree"]
  };
  return { ...binding, bindingHash: canonicalSha256(binding) };
}

function verifyWsgsSourceCommit(): string {
  const repositoryRoot = resolve(import.meta.dirname, "..", "..");
  const expected = process.env["WSGS_EVIDENCE_SOURCE_COMMIT"]?.trim();
  assertion(!alignmentFocused || Boolean(expected), "WSGS_EVIDENCE_SOURCE_COMMIT_REQUIRED");
  const head = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assertion(/^[0-9a-f]{40}$/u.test(head), "WSGS_SOURCE_HEAD_INVALID");
  if (expected) {
    assertion(/^[0-9a-f]{40}$/u.test(expected), "WSGS_EVIDENCE_SOURCE_COMMIT_INVALID");
    assertion(expected === head, "WSGS_SOURCE_HEAD_MISMATCH");
  }
  const exactTrackedRuntimeOutputs = [
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
  const verifiedSourcePathspecs = alignmentFocused
    ? [".", ...exactTrackedRuntimeOutputs.map((path) => `:(top,exclude,literal)${path}`)]
    : ["."];
  try {
    execFileSync("git", ["-C", repositoryRoot, "diff", "--quiet", "HEAD", "--", ...verifiedSourcePathspecs], {
      stdio: "ignore"
    });
  } catch {
    throw new Error("WSGS_SOURCE_TRACKED_DIRTY");
  }
  const status = execFileSync("git", ["-C", repositoryRoot, "status", "--porcelain=v1", "--untracked-files=all"], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024
  }).replace(/(?:\r?\n)+$/u, "");
  const declaredEvidencePaths = [
    process.env["GOWM_RUNTIME_IMAGE_BUILD_REPORT"]?.trim(),
    process.env["WSGS_RUNTIME_IMAGE_BUILD_REPORT"]?.trim()
  ].filter((entry): entry is string => entry !== undefined && entry.length > 0)
    .map((entry) => relative(repositoryRoot, resolve(repositoryRoot, entry)).split(sep).join("/"));
  const expectedEvidencePaths = new Set([
    "reports/wsgs-gowm-0.6.4-alignment/runtime-image-build-report.json",
    "reports/wsgs-gowm-0.6.4-alignment/wsgs-runtime-image-build-report.json"
  ]);
  assertion(
    declaredEvidencePaths.every((entry) => !entry.startsWith("..") && expectedEvidencePaths.has(entry)),
    "RUNTIME_IMAGE_BUILD_REPORT_PATH_NOT_ALLOWED"
  );
  const allowedUntrackedEvidence = new Set(declaredEvidencePaths.map((entry) => `?? ${entry}`));
  if (alignmentFocused) {
    for (const path of exactTrackedRuntimeOutputs) {
      try {
        execFileSync("git", ["-C", repositoryRoot, "ls-files", "--error-unmatch", "--", path], {
          stdio: "ignore"
        });
      } catch {
        throw new Error("GOWM_ALIGNMENT_RUNTIME_EVIDENCE_OUTPUT_NOT_TRACKED");
      }
    }
  }
  const allowedTrackedRuntimeEvidence = new Set(
    alignmentFocused ? exactTrackedRuntimeOutputs.map((entry) => ` M ${entry}`) : []
  );
  const statusLines = status.length === 0 ? [] : status.split(/\r?\n/u).filter((line) => line.length > 0);
  assertion(
    statusLines.every((line) => allowedUntrackedEvidence.has(line) || allowedTrackedRuntimeEvidence.has(line)),
    "WSGS_SOURCE_WORKTREE_NOT_CLEAN_BEFORE_DIRECT_GATE"
  );
  return head;
}

async function main(): Promise<void> {
  assertion(required("ALLOW_REAL_GOWM_GATE") === "YES", "REAL_GOWM_GATE_NOT_ALLOWED");
  const baseUrl = new URL(required("GOWM_BASE_URL"));
  assertion(baseUrl.protocol === "https:" || ["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname), "INSECURE_REMOTE_GATEWAY_FORBIDDEN");
  const wsgsSourceCommit = verifyWsgsSourceCommit();
  const runtimeBinding = observeExactRuntimeBinding(baseUrl);
  const credential = required("GOWM_GATEWAY_CREDENTIAL");
  const privateKeyPath = required("GOWM_DELEGATION_PRIVATE_KEY_PATH");
  const dataScope = required("GOWM_DATA_SCOPE");
  const datasetScope = required("GOWM_DATASET_SCOPE");
  const sampleHandoffDirectory = process.env["GOWM_SAMPLE_HANDOFF_DIR"]?.trim();
  const sampleExpectedCases = sampleHandoffDirectory === undefined
    ? []
    : array(JSON.parse(await readFile(join(sampleHandoffDirectory, "EXPECTED_CASES.json"), "utf8")) as unknown, "SAMPLE_EXPECTED_CASES_INVALID")
        .map((entry) => object(entry, "SAMPLE_EXPECTED_CASE_INVALID"));
  const sampleReferenceEntries = sampleHandoffDirectory === undefined
    ? []
    : array(object(JSON.parse(await readFile(join(sampleHandoffDirectory, "SAMPLE_REFERENCE_MAP.json"), "utf8")) as unknown, "SAMPLE_REFERENCE_MAP_INVALID")["entries"], "SAMPLE_REFERENCE_ENTRIES_INVALID")
        .map((entry) => object(entry, "SAMPLE_REFERENCE_ENTRY_INVALID"));
  const sampleExpectedCase = (caseId: string): JsonObject | undefined =>
    sampleExpectedCases.find((entry) => entry["caseId"] === caseId);
  const sampleExpectedInput = (caseId: string): JsonObject | undefined => {
    const entry = sampleExpectedCase(caseId);
    return entry === undefined ? undefined : object(entry["inputTemplate"], `SAMPLE_${caseId}_INPUT_INVALID`);
  };
  const expectedReferenceIds = (entry: JsonObject | undefined, field = "expectedReferenceKeys"): string[] =>
    entry === undefined || entry[field] === undefined
      ? []
      : array(entry[field], `SAMPLE_${field.toUpperCase()}_INVALID`).map((value) => text(value, `SAMPLE_${field.toUpperCase()}_ENTRY_INVALID`));
  const forbiddenReferenceIds = (entry: JsonObject | undefined): string[] => {
    if (entry === undefined || entry["forbiddenFixtureKeys"] === undefined) return [];
    const fixtureKeys = array(entry["forbiddenFixtureKeys"], "SAMPLE_FORBIDDEN_FIXTURE_KEYS_INVALID")
      .map((value) => text(value, "SAMPLE_FORBIDDEN_FIXTURE_KEY_INVALID"));
    return sampleReferenceEntries
      .filter((candidate) => fixtureKeys.includes(text(candidate["fixtureKey"], "SAMPLE_REFERENCE_FIXTURE_KEY_MISSING")))
      .map((candidate) => text(candidate["referenceId"], "SAMPLE_REFERENCE_ID_MISSING"));
  };
  const runId = `wsgs-v02-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const checks: GateCheck[] = [];
  const timings: Record<string, number> = {};
  const time = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    failureStage = name;
    const started = performance.now();
    try {
      return await work();
    } finally {
      timings[name] = Math.round((performance.now() - started) * 100) / 100;
    }
  };

  const bundledLockPath = new URL(
    "../../contracts/upstream/gowm-0.6.3/extracted/package/bundle/locks/wsgs-southbound-operation-lock-v2.json",
    import.meta.url
  );
  const externalLockPath = process.env["GOWM_SOUTHBOUND_LOCK_FILE"]?.trim();
  const operationalLockHash = externalLockPath
    ? required("GOWM_SOUTHBOUND_LOCK_SHA256")
    : `sha256:${GOWM_SOUTHBOUND_LOCK_RAW_SHA256}`;
  assertion(!alignmentFocused || externalLockPath !== undefined, "ALIGNMENT_RUNTIME_OPERATION_LOCK_REQUIRED");
  const lock = alignmentFocused
    ? loadAlignmentRuntimeOperationLock(
        externalLockPath!,
        required("GOWM_SOUTHBOUND_LOCK_SHA256"),
        fileURLToPath(bundledLockPath)
      )
    : (externalLockPath
        ? loadOperationalGowmLock({
            lockPath: externalLockPath,
            expectedSha256: required("GOWM_SOUTHBOUND_LOCK_SHA256") as `sha256:${string}`,
            hashMode: "EXACT_BYTES"
          })
        : loadOperationalGowmLock({
            lockPath: fileURLToPath(bundledLockPath),
            expectedSha256: `sha256:${GOWM_SOUTHBOUND_LOCK_RAW_SHA256}`,
            hashMode: "EXACT_BYTES"
          })).lock as ConsumerLock;
  const allLocks = [...lock.defaultOperations, ...lock.previewOperations];
  const requiredLocks = expectedOperationIds.map((operationId) => {
    const operation = allLocks.find((entry) => entry.operationId === operationId && entry.operationVersion === "1.0");
    assertion(operation !== undefined, `LOCK_MISSING_${operationId}`);
    return operation;
  });

  const identity = createGroundingIdentity({
    servicePrincipalId: required("GOWM_SERVICE_PRINCIPAL_ID"),
    actorId: "wsgs-real-gowm-gate",
    dataScopes: [dataScope],
    datasetScopes: [datasetScope],
    permissions: ["data:read", "dataset:read", "reference:read", "world:read"]
  });
  const signer = new GowmDelegationSigner({
    issuer: required("GOWM_DELEGATION_ISSUER"),
    audience: required("GOWM_DELEGATION_AUDIENCE"),
    servicePrincipalId: identity.servicePrincipalId,
    privateKeyPkcs8: await readFile(privateKeyPath, "utf8"),
    trustedOperationKeys: expectedOperationKeys,
    maximumTtlSeconds: 300,
    defaultTtlSeconds: 120
  });
  await signer.ready();

  const client = new GowmGatewayClient({
    baseUrl,
    credential: () => credential,
    timeoutMs: 30_000,
    maxRetries: 1,
    maxRequestBytes: 2 * 1024 * 1024,
    maxResponseBytes: 16 * 1024 * 1024,
    retryBaseDelayMs: 100,
    retryMaxDelayMs: 1_000
  });

  const catalog = await time("catalog", () => client.listCapabilities());
  const semantics = await time("semantics", () => client.listCapabilitySemantics());
  const descriptors = new Map(catalog.capabilities.map((entry) => [`${entry.operationId}@${entry.operationVersion}`, entry]));
  const descriptor = (operationId: string): CapabilityDescriptor => {
    const value = descriptors.get(`${operationId}@1.0`);
    assertion(value !== undefined, `CAPABILITY_MISSING_${operationId}`);
    return value;
  };
  const operationLock = (operationId: string): OperationLock => {
    const value = requiredLocks.find((entry) => entry.operationId === operationId);
    assertion(value !== undefined, `OPERATION_LOCK_MISSING_${operationId}`);
    return value;
  };

  const availabilityRequestId = `${runId}-availability`;
  const availabilityPlanAuthority = {
    nodes: expectedOperationIds.map((operationId, index) => ({
      nodeId: `authority_${index}`,
      operation: { operationId, operationVersion: "1.0" }
    }))
  };
  const availabilityDelegation = await signer.sign({
    kind: "WORLD_QUERY",
    identity,
    requestId: availabilityRequestId,
    dataScopes: [dataScope],
    datasetScopes: [datasetScope],
    plan: availabilityPlanAuthority
  });
  assertion(JSON.stringify(availabilityDelegation.allowedOperations) === JSON.stringify([...expectedOperationKeys].sort()), "AVAILABILITY_AUTHORITY_NOT_MINIMAL");
  const availability = await time("availability", () => client.listOperationAvailability({
    requestId: availabilityRequestId,
    delegationToken: availabilityDelegation.token
  }));
  const unavailable = availability.operations.filter((entry) => entry.availability !== "AVAILABLE");
  assertion(unavailable.length === 0, "REQUIRED_OPERATION_UNAVAILABLE");
  checks.push({
    id: "live-contract-endpoints",
    status: "PASS",
    evidence: {
      capabilityCount: catalog.capabilities.length,
      contractCatalogRevision: catalog.contractCatalogRevision,
      bindingRevision: catalog.bindingRevision,
      semanticCatalogHash: semantics.catalogHash,
      authorizedAvailabilityCount: availability.operations.length,
      availability: Object.fromEntries(availability.operations.map((entry) => [
        `${entry.operationId}@${entry.operationVersion}`,
        entry.availability
      ]))
    }
  });
  let trustedReady = false;
  try {
    const trusted = client.validateTrustedContracts({
      catalog,
      semantics,
      availability,
      required: requiredLocks,
      expectedContractCatalogRevision: lock.contractCatalogRevision,
      expectedSemanticCatalogHash: lock.semanticCatalogHash
    });
    assertion(trusted.requiredReady, "TRUSTED_CONTRACTS_NOT_READY");
    trustedReady = true;
    checks.push({
      id: "consumer-semantic-lock",
      status: "PASS",
      evidence: { expected: lock.semanticCatalogHash, observed: semantics.catalogHash }
    });
  } catch (error) {
    if (!(error instanceof GatewayProtocolError) || error.code !== "SEMANTIC_CATALOG_HASH_MISMATCH") throw error;
    const runtimeCanonicalHash = canonicalSha256(semantics.profiles);
    const bundleProjection = semantics.profiles.map((entry) => ({
      operationId: entry.operationId,
      operationVersion: entry.operationVersion,
      semanticProfile: entry.semanticProfile,
      semanticProfileHash: bundleBuildSha256(entry.semanticProfile)
    }));
    const bundleCanonicalHash = bundleBuildSha256(bundleProjection);
    const perProfileHashDifferences = semantics.profiles.filter((entry) =>
      entry.semanticProfileHash !== bundleBuildSha256(entry.semanticProfile)
    ).length;
    assertion(runtimeCanonicalHash === semantics.catalogHash, "LIVE_SEMANTIC_HASH_SELF_INCONSISTENT");
    if (!externalLockPath) {
      assertion(bundleCanonicalHash === lock.semanticCatalogHash, "BUNDLE_SEMANTIC_HASH_CAUSE_UNCONFIRMED");
    }
    checks.push({
      id: "consumer-semantic-lock",
      status: "BLOCKED",
      evidence: {
        reason: externalLockPath
          ? "PINNED_OPERATIONAL_LOCK_SEMANTIC_CATALOG_MISMATCH"
          : "UPSTREAM_0_6_3_SEMANTIC_CATALOG_CANONICALIZATION_MISMATCH",
        expectedConsumerBundleHash: lock.semanticCatalogHash,
        observedLiveRuntimeHash: semantics.catalogHash,
        runtimeCanonicalHash,
        ...(externalLockPath ? {} : { bundleBuilderCanonicalHash: bundleCanonicalHash }),
        perProfileHashDifferences,
        wsgsReadiness: "FAIL_CLOSED",
        subsequentTransportChecks: "DIAGNOSTIC_ONLY"
      }
    });
  }

  const validationLocks = allLocks.filter((entry) =>
    entry.operationVersion === "1.0"
      && (entry.operationId === "reference.validate" || entry.operationId === "result.validate")
  );
  const pinnedValidationReady = validationLocks.length === 2
    && validationLocks.every((entry) => entry.snapshotSupport === "PINNED");
  checks.push(pinnedValidationReady ? {
    id: "pinned-prior-result-validation",
    status: "PASS",
    evidence: { operations: validationLocks.map((entry) => `${entry.operationId}@${entry.operationVersion}`) }
  } : {
    id: "pinned-prior-result-validation",
    status: "BLOCKED",
    evidence: {
      reason: "PINNED_VALIDATION_OPERATION_UNAVAILABLE",
      operations: validationLocks.map((entry) => ({
        operationKey: `${entry.operationId}@${entry.operationVersion}`,
        snapshotSupport: entry.snapshotSupport
      }))
    }
  });

  async function direct(operationId: string, input: JsonObject, label: string): Promise<unknown> {
    const operationDescriptor = descriptor(operationId);
    const requestId = `${runId}-${label}`;
    const delegation = await signer.sign({
      kind: "DIRECT_OPERATION",
      identity,
      requestId,
      dataScopes: [dataScope],
      datasetScopes: [datasetScope],
      operation: { operationId, operationVersion: "1.0" }
    });
    assertion(
      delegation.allowedOperations.length === 1 && delegation.allowedOperations[0] === `${operationId}@1.0`,
      `DIRECT_AUTHORITY_NOT_MINIMAL_${operationId}`
    );
    const maximumTimeoutMs = operationDescriptor.execution.maximumTimeoutMs;
    const request = {
      requestVersion: "1.0",
      requestId,
      idempotencyKey: `${runId}:${label}`,
      operationVersion: "1.0",
      inputSchemaHash: operationDescriptor.inputSchemaHash,
      outputSchemaHash: operationDescriptor.outputSchemaHash,
      input,
      executionPolicy: {
        deadlineAt: new Date(Date.now() + Math.min(maximumTimeoutMs, 25_000)).toISOString(),
        maximumResultBytes: operationDescriptor.limits.maximumOutputBytes ?? 16_777_216,
        ...(operationDescriptor.limits.maximumRows === undefined ? {} : { maximumRows: operationDescriptor.limits.maximumRows }),
        ...(operationDescriptor.limits.maximumCandidates === undefined ? {} : { maximumCandidates: operationDescriptor.limits.maximumCandidates }),
        maximumCostClass: operationDescriptor.execution.costClass,
        preferredExecution: "SYNC"
      }
    };
    let response;
    try {
      response = await time(`direct:${label}`, () => client.executeOperation(operationLock(operationId), request, {
        requestId,
        delegationToken: delegation.token,
        deadlineAt: new Date(Date.now() + 30_000)
      }));
    } catch (error) {
      if (!(error instanceof GatewayProtocolError) || error.status !== 422) throw error;
      const diagnosticResponse = await fetch(new URL(`/v1/operations/${encodeURIComponent(operationId)}:execute`, baseUrl), {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${credential}`,
          "content-type": "application/json",
          "x-request-id": requestId,
          "x-gowm-delegation": delegation.token
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(10_000)
      });
      const diagnosticBody = object(await diagnosticResponse.json(), "GOWM_PUBLIC_ERROR_INVALID");
      const publicError = object(diagnosticBody["error"], "GOWM_PUBLIC_ERROR_MISSING");
      failureEvidence = {
        gatewayStage: publicError["stage"],
        details: publicError["details"]
      };
      throw new Error(`GOWM_${text(publicError["code"], "GOWM_PUBLIC_ERROR_CODE_MISSING")}`);
    }
    assertion(response.status === 200, `DIRECT_NOT_SYNCHRONOUS_${operationId}`);
    return response.value;
  }

  async function validateReference(referenceKey: JsonObject, label: string): Promise<{
    envelope: unknown;
    result: JsonObject;
    identityHash: `sha256:${string}`;
  }> {
    const inputIdentityHash = referenceIdentityHash(referenceKey);
    const envelope = await direct("reference.validate", {
      schemaVersion: "1.0",
      references: [{ referenceKey, requireCurrentSnapshot: true }]
    }, label);
    const value = outputValue(envelope, `${label.toUpperCase()}_VALIDATION`);
    const results = array(value["results"], `${label.toUpperCase()}_VALIDATION_RESULTS_MISSING`);
    assertion(results.length === 1, `${label.toUpperCase()}_VALIDATION_RESULT_COUNT`);
    const result = object(results[0], `${label.toUpperCase()}_VALIDATION_RESULT_INVALID`);
    const outputReferenceKey = object(result["referenceKey"], `${label.toUpperCase()}_VALIDATION_REFERENCE_MISSING`);
    const outputIdentityHash = referenceIdentityHash(outputReferenceKey);
    assertion(outputIdentityHash === inputIdentityHash, `${label.toUpperCase()}_VALIDATION_REFERENCE_KEY_MUTATED`);
    assertion(result["existence"] === "AVAILABLE", `${label.toUpperCase()}_VALIDATION_NOT_AVAILABLE`);
    assertion(result["freshness"] === "CURRENT", `${label.toUpperCase()}_VALIDATION_NOT_CURRENT`);
    assertion(result["snapshot"] === "CURRENT", `${label.toUpperCase()}_VALIDATION_SNAPSHOT_NOT_CURRENT`);
    assertion(result["usable"] === "YES", `${label.toUpperCase()}_VALIDATION_NOT_USABLE`);
    return { envelope, result, identityHash: inputIdentityHash };
  }

  const mention = (surfaceText: string, expectedKinds: string[]): JsonObject => ({
    schemaVersion: "1.0",
    mentions: [{ mentionId: `m-${sha256(surfaceText).slice(-12)}`, surfaceText, expectedKinds }],
    context: { anchorReferenceKeys: [], language: "zh-CN" },
    limitPerMention: 10
  });

  const vehicleResolutionEnvelope = await direct("reference.resolve", sampleExpectedInput("REF-UNIQUE-2") ?? mention("2号车", ["WORLD_OBJECT"]), "resolve-vehicle-2");
  const vehicleResolution = outputValue(vehicleResolutionEnvelope, "VEHICLE_RESOLUTION");
  const vehicleResolutionItem = object(array(vehicleResolution["resolutions"], "VEHICLE_RESOLUTIONS_MISSING")[0], "VEHICLE_RESOLUTION_MISSING");
  const vehicleCandidates = array(vehicleResolutionItem["candidates"], "VEHICLE_CANDIDATES_MISSING");
  assertion(vehicleResolutionItem["status"] === "RESOLVED_EXACT" && vehicleCandidates.length === 1, "VEHICLE_NOT_UNIQUE");
  const vehicleDescriptor = object(object(vehicleCandidates[0], "VEHICLE_CANDIDATE_INVALID")["candidate"], "VEHICLE_DESCRIPTOR_INVALID");
  const vehicleReference = object(vehicleDescriptor["referenceKey"], "VEHICLE_REFERENCE_INVALID");
  const expectedVehicleIds = expectedReferenceIds(sampleExpectedCase("REF-UNIQUE-2"));
  assertion(expectedVehicleIds.length === 0 || expectedVehicleIds.includes(text(vehicleReference["id"], "VEHICLE_REFERENCE_ID_MISSING")), "VEHICLE_REFERENCE_MISMATCH");
  const vehicleValidation = await validateReference(vehicleReference, "vehicle-resolver-output");

  const vehicleStateEnvelope = await direct("world.get-current-state", {
    schemaVersion: "1.0",
    referenceKey: vehicleReference
  }, "vehicle-current-state");
  const vehicleState = outputValue(vehicleStateEnvelope, "VEHICLE_STATE");
  const vehicleFact = object(array(vehicleState["facts"], "VEHICLE_FACTS_MISSING")[0], "VEHICLE_FACT_MISSING");
  const position = object(vehicleFact["position"], "VEHICLE_POSITION_MISSING");
  const coordinates = array(position["coordinates"], "VEHICLE_COORDINATES_MISSING");
  assertion(coordinates.length >= 2 && coordinates.slice(0, 2).every((value) => typeof value === "number" && Number.isFinite(value)), "VEHICLE_POSITION_INVALID");
  checks.push({
    id: "business-2号车-current-state",
    status: "PASS",
    evidence: {
      resolution: vehicleResolutionItem["status"],
      candidateCount: vehicleCandidates.length,
      reference: safeReferenceEvidence(vehicleReference),
      validation: {
        identityHash: vehicleValidation.identityHash,
        existence: vehicleValidation.result["existence"],
        freshness: vehicleValidation.result["freshness"],
        snapshot: vehicleValidation.result["snapshot"],
        usable: vehicleValidation.result["usable"]
      },
      position: { type: position["type"], coordinateCount: coordinates.length },
      envelopeStatus: object(vehicleStateEnvelope, "VEHICLE_STATE_ENVELOPE_INVALID")["status"],
      diagnosticOnly: !trustedReady
    }
  });

  const roadResolutionEnvelope = await direct("reference.resolve", sampleExpectedInput("REF-AMBIGUOUS-RIVER-ROAD") ?? mention("滨河路", ["WORLD_OBJECT"]), "resolve-ambiguous-road");
  const roadResolution = outputValue(roadResolutionEnvelope, "ROAD_RESOLUTION");
  const roadResolutionItem = object(array(roadResolution["resolutions"], "ROAD_RESOLUTIONS_MISSING")[0], "ROAD_RESOLUTION_MISSING");
  const roadCandidates = array(roadResolutionItem["candidates"], "ROAD_CANDIDATES_MISSING");
  assertion(roadResolutionItem["status"] === "AMBIGUOUS" && roadCandidates.length === 2, "ROAD_AMBIGUITY_NOT_PRESERVED");
  const expectedRoadIds = expectedReferenceIds(sampleExpectedCase("REF-AMBIGUOUS-RIVER-ROAD")).sort();
  const observedRoadIds = roadCandidates.map((entry) => {
    const candidate = object(entry, "ROAD_CANDIDATE_INVALID");
    const candidateDescriptor = object(candidate["candidate"], "ROAD_DESCRIPTOR_INVALID");
    const referenceKey = object(candidateDescriptor["referenceKey"], "ROAD_REFERENCE_INVALID");
    return text(referenceKey["id"], "ROAD_REFERENCE_ID_MISSING");
  }).sort();
  assertion(expectedRoadIds.length === 0 || JSON.stringify(observedRoadIds) === JSON.stringify(expectedRoadIds), "ROAD_REFERENCE_SET_MISMATCH");
  checks.push({
    id: "business-滨河路-ambiguity",
    status: "PASS",
    evidence: {
      resolution: roadResolutionItem["status"],
      candidateCount: roadCandidates.length,
      downstreamSpatialExecutions: 0,
      diagnosticOnly: !trustedReady
    }
  });

  const areaResolutionEnvelope = await direct("reference.resolve", {
    schemaVersion: "1.0",
    mentions: [{ mentionId: `m-${sha256("A区").slice(-12)}`, surfaceText: "A区" }],
    context: { anchorReferenceKeys: [], language: "zh-CN" },
    limitPerMention: 10
  }, "resolve-area-a");
  const areaResolution = outputValue(areaResolutionEnvelope, "AREA_RESOLUTION");
  const areaResolutionItem = object(array(areaResolution["resolutions"], "AREA_RESOLUTIONS_MISSING")[0], "AREA_RESOLUTION_MISSING");
  const areaCandidates = array(areaResolutionItem["candidates"], "AREA_CANDIDATES_MISSING");
  assertion(areaResolutionItem["status"] === "RESOLVED_EXACT" && areaCandidates.length === 1, "AREA_NOT_UNIQUE");
  const areaReference = object(object(object(areaCandidates[0], "AREA_CANDIDATE_INVALID")["candidate"], "AREA_DESCRIPTOR_INVALID")["referenceKey"], "AREA_REFERENCE_INVALID");
  const expectedAreaIds = expectedReferenceIds(sampleExpectedCase("WORLD-GEOMETRY-ZONE-A"));
  assertion(expectedAreaIds.length === 0 || expectedAreaIds.includes(text(areaReference["id"], "AREA_REFERENCE_ID_MISSING")), "AREA_REFERENCE_MISMATCH");
  const areaValidation = await validateReference(areaReference, "area-resolver-output");
  const areaGeometryInput = {
    schemaVersion: "1.0",
    referenceKey: areaReference
  };
  const areaGeometryEnvelope = await direct("world.get-geometry", areaGeometryInput, "area-geometry");
  const areaGeometryOutput = outputValue(areaGeometryEnvelope, "AREA_GEOMETRY");
  if (!Array.isArray(areaGeometryOutput["facts"]) || areaGeometryOutput["facts"].length === 0) {
    failureEvidence = { outputKeys: Object.keys(areaGeometryOutput).sort() };
  }
  const areaFact = object(array(areaGeometryOutput["facts"], "AREA_FACTS_MISSING")[0], "AREA_FACT_MISSING");
  const areaGeometry = object(areaFact["geometry"], "AREA_GEOMETRY_MISSING");
  assertion(areaGeometry["type"] === "Polygon", "AREA_GEOMETRY_NOT_POLYGON");
  const sampleInAreaCase = sampleExpectedCase("SPATIAL-IN-ZONE-A");
  const expectedInAreaInput = sampleInAreaCase === undefined
    ? undefined
    : object(sampleInAreaCase["inputTemplate"], "SAMPLE_IN_AREA_INPUT_INVALID");
  const inAreaInput = {
    geometry: areaGeometry,
    objectTypes: expectedInAreaInput?.["objectTypes"] ?? ["VEHICLE"],
    limit: expectedInAreaInput?.["limit"] ?? 20,
    crs: expectedInAreaInput?.["crs"] ?? "EPSG:4326"
  };
  const inAreaEnvelope = await direct("spatial.find-in-area", inAreaInput, "vehicles-in-area");
  const inArea = outputValue(inAreaEnvelope, "IN_AREA");
  const inAreaObjects = array(inArea["objects"], "IN_AREA_OBJECTS_MISSING").map((entry) => object(entry, "IN_AREA_OBJECT_INVALID"));
  const inAreaIds = inAreaObjects.map((entry) => text(object(entry["referenceKey"], "IN_AREA_REFERENCE_INVALID")["id"], "IN_AREA_REFERENCE_ID_MISSING"));
  const expectedInAreaIds = expectedReferenceIds(sampleInAreaCase).sort();
  const forbiddenInAreaIds = expectedReferenceIds(sampleInAreaCase, "forbiddenReferenceKeys");
  assertion(expectedInAreaIds.length === 0 ? inAreaIds.length === 2 : JSON.stringify([...inAreaIds].sort()) === JSON.stringify(expectedInAreaIds), "IN_AREA_REFERENCE_SET_MISMATCH");
  assertion(inAreaIds.includes(text(vehicleReference["id"], "VEHICLE_REFERENCE_ID_MISSING")), "IN_AREA_VEHICLE_2_MISSING");
  assertion(!inAreaIds.includes(outsideReferenceId) && !inAreaIds.includes(foreignReferenceId) && forbiddenInAreaIds.every((id) => !inAreaIds.includes(id)), "IN_AREA_SCOPE_LEAK");
  checks.push({
    id: "business-A区-exact-in-area",
    status: "PASS",
    evidence: {
      areaResolution: areaResolutionItem["status"],
      areaReference: safeReferenceEvidence(areaReference),
      validation: {
        identityHash: areaValidation.identityHash,
        existence: areaValidation.result["existence"],
        freshness: areaValidation.result["freshness"],
        snapshot: areaValidation.result["snapshot"],
        usable: areaValidation.result["usable"]
      },
      resolverOutputConsumedByValidation: true,
      resolverOutputConsumedByGeometry: true,
      geometryOutputConsumedBySpatial: true,
      vehicleCount: inAreaIds.length,
      scopedReferenceSetHash: canonicalSha256([...inAreaIds].sort()),
      outsideExcluded: true,
      foreignScopeExcluded: true,
      diagnosticOnly: !trustedReady
    }
  });

  const worldDescriptor = descriptor("world.get-current-state");
  const nearbyDescriptor = descriptor("spatial.find-nearby");
  const positionPort = worldDescriptor.ports.outputs.find((port) => port.name === "positionCoordinates");
  const resultPort = nearbyDescriptor.ports.outputs.find((port) => port.name === "result");
  assertion(positionPort !== undefined && resultPort !== undefined, "TYPED_PORTS_MISSING");
  const worldInputPort = worldDescriptor.ports.inputs.find((port) => port.name === "request");
  assertion(worldInputPort !== undefined, "WORLD_REQUEST_PORT_MISSING");
  const sampleNearbyCase = sampleExpectedCase("SPATIAL-NEARBY-UGV2");
  const sampleNearbyInput = sampleNearbyCase === undefined
    ? undefined
    : object(sampleNearbyCase["inputTemplate"], "SAMPLE_NEARBY_INPUT_INVALID");
  const nearbyRadiusM = alignmentFocused
    ? 1_000
    : sampleNearbyInput === undefined ? 1_000 : sampleNearbyInput["radiusM"];
  const nearbyObjectTypes = sampleNearbyInput === undefined ? ["AREA"] : sampleNearbyInput["objectTypes"];
  const nearbyLimit = sampleNearbyInput === undefined ? 20 : sampleNearbyInput["limit"];
  const nearbyCrs = sampleNearbyInput === undefined ? "EPSG:4326" : sampleNearbyInput["crs"];
  const referenceKeyPort = {
    schemaUri: "urn:gowm:v0.4:reference-key",
    schemaHash: await upstreamSchemaHash("gowm-v0.4/reference-key.schema.json"),
    valueKind: "REFERENCE_KEY",
    unitSemantics: "UNSPECIFIED"
  };
  const typedPlan = {
    queryPlanVersion: "2.0",
    queryId: `${runId}-nearby-query`,
    nodes: [
      {
        nodeId: "vehicle_state",
        operation: operationRef(worldDescriptor),
        inputs: {
          schemaVersion: await literalBinding("1.0", "/schemaVersion"),
          referenceKey: {
            kind: "REFERENCE_KEY",
            port: referenceKeyPort,
            targetPath: "/referenceKey",
            referenceKey: vehicleReference
          }
        },
        failurePolicy: "FAIL_FAST",
        budget: nodeBudget(worldDescriptor)
      },
      {
        nodeId: "nearby_areas",
        operation: operationRef(nearbyDescriptor),
        inputs: {
          location: {
            kind: "NODE_OUTPUT",
            nodeId: "vehicle_state",
            outputPort: "positionCoordinates",
            path: positionPort.path,
            targetPath: "/location",
            port: schemaPort(positionPort)
          },
          radiusM: await literalBinding(nearbyRadiusM, "/radiusM"),
          objectTypes: await literalBinding(nearbyObjectTypes, "/objectTypes"),
          limit: await literalBinding(nearbyLimit, "/limit"),
          crs: await literalBinding(nearbyCrs, "/crs")
        },
        failurePolicy: "FAIL_FAST",
        budget: nodeBudget(nearbyDescriptor)
      }
    ],
    outputs: [{
      name: "nearby",
      binding: {
        kind: "NODE_OUTPUT",
        nodeId: "nearby_areas",
        outputPort: "result",
        ...(resultPort.path === undefined ? {} : { path: resultPort.path }),
        port: schemaPort(resultPort)
      }
    }],
    budgets: {
      maximumNodes: 2,
      maximumDepth: 2,
      maximumRows: 1_000_000,
      maximumCandidates: 5_000_000,
      maximumOutputBytes: 128_000_000,
      maximumExecutionMs: 300_000
    }
  };
  const worldQueryRequestId = `${runId}-nearby-submit`;
  const worldQuerySubmission = {
    requestId: worldQueryRequestId,
    idempotencyKey: `${runId}:nearby-world-query`,
    plan: typedPlan,
    parameters: {},
    parameterSchemaHash: await schemaHash("platform/world-query-parameters.schema.json"),
    snapshotPolicy: { mode: "BEST_EFFORT", allowDowngrade: true }
  };
  const queryDelegation = await signer.sign({
    kind: "WORLD_QUERY",
    identity,
    requestId: worldQueryRequestId,
    dataScopes: [dataScope],
    datasetScopes: [datasetScope],
    plan: typedPlan
  });
  assertion(
    JSON.stringify(queryDelegation.allowedOperations) === JSON.stringify(["spatial.find-nearby@1.0", "world.get-current-state@1.0"]),
    "WORLD_QUERY_AUTHORITY_NOT_MINIMAL"
  );
  let submitted;
  try {
    submitted = await time("world-query:submit", () => client.submitWorldQuery(worldQuerySubmission, {
      requestId: worldQueryRequestId,
      delegationToken: queryDelegation.token,
      preferAsync: true,
      deadlineAt: new Date(Date.now() + 30_000)
    }));
  } catch (error) {
    if (!(error instanceof GatewayProtocolError) || error.status !== 422) throw error;
    const diagnosticResponse = await fetch(new URL("/v1/world-queries", baseUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
        prefer: "respond-async",
        "x-request-id": worldQueryRequestId,
        "x-gowm-delegation": queryDelegation.token
      },
      body: JSON.stringify(worldQuerySubmission),
      signal: AbortSignal.timeout(10_000)
    });
    const diagnosticBody = object(await diagnosticResponse.json(), "WORLD_QUERY_PUBLIC_ERROR_INVALID");
    const publicError = object(diagnosticBody["error"], "WORLD_QUERY_PUBLIC_ERROR_MISSING");
    failureEvidence = {
      gatewayStage: publicError["stage"],
      nodeId: publicError["nodeId"],
      details: publicError["details"]
    };
    throw new Error(`GOWM_WORLD_QUERY_${text(publicError["code"], "WORLD_QUERY_PUBLIC_ERROR_CODE_MISSING")}`);
  }
  assertion(submitted.status === 202, "WORLD_QUERY_NOT_ACCEPTED_ASYNC");
  const submittedJob = object(submitted.value, "WORLD_QUERY_JOB_INVALID");
  const worldQueryJobId = text(submittedJob["jobId"], "WORLD_QUERY_JOB_ID_MISSING");
  const pollRequestId = `${runId}-nearby-poll`;
  const pollDelegation = await signer.sign({
    kind: "WORLD_QUERY",
    identity,
    requestId: pollRequestId,
    dataScopes: [dataScope],
    datasetScopes: [datasetScope],
    plan: typedPlan
  });
  const terminalJob = await time("world-query:poll", () => client.pollJob(worldQueryJobId, {
    requestId: pollRequestId,
    delegationToken: pollDelegation.token,
    deadlineAt: new Date(Date.now() + 60_000)
  }, 100));
  if (terminalJob["status"] !== "COMPLETED") {
    const terminalResult = terminalJob["result"] === undefined
      ? undefined
      : object(terminalJob["result"], "WORLD_QUERY_FAILED_RESULT_INVALID");
    const failedNodes = terminalResult === undefined
      ? []
      : array(terminalResult["nodes"], "WORLD_QUERY_FAILED_NODES_INVALID").map((entry) => {
          const node = object(entry, "WORLD_QUERY_FAILED_NODE_INVALID");
          const errorEnvelope = node["error"] === undefined ? undefined : object(node["error"], "WORLD_QUERY_FAILED_NODE_ERROR_INVALID");
          const error = errorEnvelope === undefined ? undefined : object(errorEnvelope["error"], "WORLD_QUERY_FAILED_NODE_ERROR_BODY_INVALID");
          return {
            nodeId: node["nodeId"],
            status: node["status"],
            ...(error === undefined
              ? {}
              : { errorCode: error["code"], errorStage: error["stage"], errorDetails: error["details"] })
          };
        });
    failureEvidence = {
      jobStatus: terminalJob["status"],
      resultStatus: terminalResult?.["status"],
      nodes: failedNodes
    };
  }
  assertion(terminalJob["status"] === "COMPLETED", "WORLD_QUERY_NOT_COMPLETED");
  const worldQueryResult = object(terminalJob["result"], "WORLD_QUERY_RESULT_MISSING");
  const nearbyOutput = object(object(worldQueryResult["outputs"], "WORLD_QUERY_OUTPUTS_MISSING")["nearby"], "WORLD_QUERY_NEARBY_MISSING");
  const nearbyObjects = array(nearbyOutput["objects"], "WORLD_QUERY_NEARBY_OBJECTS_MISSING").map((entry) => object(entry, "WORLD_QUERY_NEARBY_OBJECT_INVALID"));
  const nearbyIds = nearbyObjects.map((entry) => text(object(entry["referenceKey"], "WORLD_QUERY_NEARBY_REFERENCE_INVALID")["id"], "WORLD_QUERY_NEARBY_ID_MISSING"));
  const areaId = text(areaReference["id"], "AREA_REFERENCE_ID_MISSING");
  const expectedNearbyIds = alignmentFocused ? [] : expectedReferenceIds(sampleNearbyCase).sort();
  const forbiddenNearbyIds = alignmentFocused ? [] : forbiddenReferenceIds(sampleNearbyCase);
  const missingNearbyIds = expectedNearbyIds.filter((id) => !nearbyIds.includes(id));
  const forbiddenNearbyMatches = forbiddenNearbyIds.filter((id) => nearbyIds.includes(id));
  if (missingNearbyIds.length > 0 || forbiddenNearbyMatches.length > 0) {
    failureEvidence = {
      expectedReferenceSetHash: canonicalSha256(expectedNearbyIds),
      observedReferenceSetHash: canonicalSha256([...nearbyIds].sort()),
      expectedCount: expectedNearbyIds.length,
      observedCount: nearbyIds.length,
      missingCount: missingNearbyIds.length,
      forbiddenMatchCount: forbiddenNearbyMatches.length
    };
  }
  assertion(
    alignmentFocused
      ? nearbyObjects.length >= 1
      : expectedNearbyIds.length === 0
        ? nearbyIds.includes(areaId)
        : missingNearbyIds.length === 0 && forbiddenNearbyMatches.length === 0,
    "NEARBY_REFERENCE_SET_MISMATCH"
  );
  assertion(typeof nearbyRadiusM === "number" && nearbyObjects.every((entry) => typeof entry["distanceM"] === "number" && (entry["distanceM"] as number) <= nearbyRadiusM), "NEARBY_DISTANCE_LIMIT_BROKEN");
  assertion(!nearbyIds.includes(foreignReferenceId), "NEARBY_SCOPE_LEAK");
  checks.push({
    id:
      alignmentFocused || sampleNearbyCase === undefined
        ? "async-world-query-nearby-1km"
        : "async-world-query-nearby-sample",
    status: "PASS",
    evidence: {
      submitStatus: submitted.status,
      terminalStatus: terminalJob["status"],
      snapshotPolicy: "BEST_EFFORT",
      snapshotAdherenceCount: array(worldQueryResult["snapshotAdherence"], "SNAPSHOT_ADHERENCE_MISSING").length,
      allowedOperations: queryDelegation.allowedOperations,
      radiusM: nearbyRadiusM,
      resultCount: nearbyObjects.length,
      referenceSetAssertion: alignmentFocused ? "RADIUS_AND_SCOPE" : "EXACT_SAMPLE_SET",
      foreignScopeExcluded: true,
      jobIdHash: sha256(worldQueryJobId),
      diagnosticOnly: !trustedReady
    }
  });

  const directReceiptId = receiptIds(vehicleStateEnvelope)[0];
  assertion(directReceiptId !== undefined, "DIRECT_RECEIPT_MISSING");
  const receiptRequestId = `${runId}-receipt`;
  const receiptDelegation = await signer.sign({
    kind: "DIRECT_OPERATION",
    identity,
    requestId: receiptRequestId,
    dataScopes: [dataScope],
    datasetScopes: [datasetScope],
    operation: { operationId: "world.get-current-state", operationVersion: "1.0" }
  });
  const receipt = object(await time("receipt:get", () => client.getReceipt(directReceiptId, {
    requestId: receiptRequestId,
    delegationToken: receiptDelegation.token,
    deadlineAt: new Date(Date.now() + 10_000)
  })), "RECEIPT_INVALID");
  assertion(receipt["receiptId"] === directReceiptId, "RECEIPT_ID_MISMATCH");
  checks.push({
    id: "bounded-receipt-fetch",
    status: "PASS",
    evidence: {
      receiptIdHash: sha256(directReceiptId),
      operationId: receipt["operationId"],
      operationVersion: receipt["operationVersion"],
      status: receipt["status"],
      diagnosticOnly: !trustedReady
    }
  });

  let cancelledJob: JsonObject | undefined;
  let cancellationAttempts = 0;
  for (let attempt = 1; attempt <= 3 && cancelledJob === undefined; attempt += 1) {
    cancellationAttempts = attempt;
    const cancelPlan = structuredClone(typedPlan);
    cancelPlan.queryId = `${runId}-cancel-query-${attempt}`;
    const cancelSubmitRequestId = `${runId}-cancel-submit-${attempt}`;
    const cancelSubmission = {
      requestId: cancelSubmitRequestId,
      idempotencyKey: `${runId}:cancel:${attempt}`,
      plan: cancelPlan,
      parameters: {},
      parameterSchemaHash: worldQuerySubmission.parameterSchemaHash,
      snapshotPolicy: { mode: "BEST_EFFORT", allowDowngrade: true }
    };
    const cancelSubmitDelegation = await signer.sign({
      kind: "WORLD_QUERY",
      identity,
      requestId: cancelSubmitRequestId,
      dataScopes: [dataScope],
      datasetScopes: [datasetScope],
      plan: cancelPlan
    });
    const cancelSubmitted = await client.submitWorldQuery(cancelSubmission, {
      requestId: cancelSubmitRequestId,
      delegationToken: cancelSubmitDelegation.token,
      preferAsync: true,
      deadlineAt: new Date(Date.now() + 15_000)
    });
    assertion(cancelSubmitted.status === 202, "CANCEL_QUERY_NOT_ASYNC");
    const cancelRequestId = `${runId}-cancel-request-${attempt}`;
    const cancelDelegation = await signer.sign({
      kind: "WORLD_QUERY",
      identity,
      requestId: cancelRequestId,
      dataScopes: [dataScope],
      datasetScopes: [datasetScope],
      plan: cancelPlan
    });
    const cancellation = object(await client.cancelWorldQuery(cancelPlan.queryId, {
      requestId: cancelRequestId,
      delegationToken: cancelDelegation.token,
      deadlineAt: new Date(Date.now() + 15_000)
    }), "CANCEL_RESPONSE_INVALID");
    if (cancellation["status"] === "CANCELLED") cancelledJob = cancellation;
    else if (!terminalStatuses.has(String(cancellation["status"]))) {
      const cancelJobId = text(object(cancelSubmitted.value, "CANCEL_SUBMISSION_INVALID")["jobId"], "CANCEL_JOB_ID_MISSING");
      const cancelPollRequestId = `${runId}-cancel-poll-${attempt}`;
      const cancelPollDelegation = await signer.sign({
        kind: "WORLD_QUERY",
        identity,
        requestId: cancelPollRequestId,
        dataScopes: [dataScope],
        datasetScopes: [datasetScope],
        plan: cancelPlan
      });
      const terminal = await client.pollJob(cancelJobId, {
        requestId: cancelPollRequestId,
        delegationToken: cancelPollDelegation.token,
        deadlineAt: new Date(Date.now() + 30_000)
      }, 100);
      if (terminal["status"] === "CANCELLED") cancelledJob = terminal;
    }
  }
  checks.push(cancelledJob === undefined ? {
    id: "world-query-cancel",
    status: "BLOCKED",
    evidence: { reason: "CANCELLATION_RACE_NOT_OBSERVED", attempts: cancellationAttempts, diagnosticOnly: !trustedReady }
  } : {
    id: "world-query-cancel",
    status: "PASS",
    evidence: { terminalStatus: cancelledJob["status"], attempts: cancellationAttempts, diagnosticOnly: !trustedReady }
  });

  const asyncDirectDescriptor = descriptor("world.get-current-state");
  const asyncDirectRequestId = `${runId}-direct-async-probe`;
  const asyncDirectDelegation = await signer.sign({
    kind: "DIRECT_OPERATION",
    identity,
    requestId: asyncDirectRequestId,
    dataScopes: [dataScope],
    datasetScopes: [datasetScope],
    operation: { operationId: "world.get-current-state", operationVersion: "1.0" }
  });
  const asyncDirectRequest = {
    requestVersion: "1.0",
    requestId: asyncDirectRequestId,
    idempotencyKey: `${runId}:direct-async-probe`,
    operationVersion: "1.0",
    inputSchemaHash: asyncDirectDescriptor.inputSchemaHash,
    outputSchemaHash: asyncDirectDescriptor.outputSchemaHash,
    input: { schemaVersion: "1.0", referenceKey: vehicleReference },
    executionPolicy: {
      deadlineAt: new Date(Date.now() + Math.min(asyncDirectDescriptor.execution.maximumTimeoutMs, 25_000)).toISOString(),
      maximumResultBytes: asyncDirectDescriptor.limits.maximumOutputBytes ?? 16_777_216,
      maximumCostClass: asyncDirectDescriptor.execution.costClass,
      preferredExecution: "ASYNC"
    }
  };
  const asyncDirectResponse = await time("direct:async-probe", () => client.executeOperation(
    operationLock("world.get-current-state"),
    asyncDirectRequest,
    {
      requestId: asyncDirectRequestId,
      delegationToken: asyncDirectDelegation.token,
      deadlineAt: new Date(Date.now() + 30_000)
    }
  ));
  checks.push(asyncDirectResponse.status === 202 ? {
    id: "direct-operation-202",
    status: "PASS",
    evidence: {
      requestHash: canonicalSha256(asyncDirectRequest),
      observedDirectStatus: asyncDirectResponse.status,
      testedOperationMode: asyncDirectDescriptor.execution.mode,
      diagnosticOnly: !trustedReady
    }
  } : {
    id: "direct-operation-202",
    status: "BLOCKED",
    evidence: {
      reason: "GOWM_0_6_3_DIRECT_ROUTE_HAS_NO_ASYNC_JOB_RESPONSE",
      requestHash: canonicalSha256(asyncDirectRequest),
      observedDirectStatus: asyncDirectResponse.status,
      testedOperationMode: asyncDirectDescriptor.execution.mode,
      asyncLifecycleVerifiedBy: "world-query",
      diagnosticOnly: !trustedReady
    }
  });

  const directCases = [
    {
      caseId: "R1",
      status: "PASS",
      operationKeys: ["reference.resolve@1.0", "reference.validate@1.0", "world.get-current-state@1.0"],
      referenceIdentityHash: referenceIdentityHash(vehicleReference),
      resolverOutputConsumedWithoutRewrite: true,
      validationCurrentAndUsable: true,
      receiptIdHashes: receiptIds(vehicleStateEnvelope).map(sha256)
    },
    {
      caseId: "R2",
      status: "PASS",
      operationKeys: ["reference.resolve@1.0"],
      terminalStatus: "AMBIGUOUS",
      candidateCount: roadCandidates.length,
      spatialExecutionCount: 0
    },
    {
      caseId: "R3",
      status: "PASS",
      operationKeys: ["reference.resolve@1.0", "reference.validate@1.0", "world.get-geometry@1.0", "spatial.find-in-area@1.0"],
      referenceIdentityHash: referenceIdentityHash(areaReference),
      resolverOutputConsumedWithoutRewrite: true,
      geometryOutputConsumedBySpatial: true,
      resultCount: inAreaObjects.length
    },
    {
      caseId: "R4",
      status: "PASS",
      operationKeys: ["reference.resolve@1.0", "reference.validate@1.0", "world.get-current-state@1.0", "spatial.find-nearby@1.0"],
      referenceIdentityHash: referenceIdentityHash(vehicleReference),
      resolverOutputConsumedWithoutRewrite: true,
      radiusM: nearbyRadiusM,
      resultCount: nearbyObjects.length
    },
    {
      caseId: "R5",
      status: "PASS",
      operationKeys: ["reference.validate@1.0"],
      referenceIdentityHash: vehicleValidation.identityHash,
      consumesR1ResolverOutput: true,
      existence: vehicleValidation.result["existence"],
      freshness: vehicleValidation.result["freshness"],
      snapshot: vehicleValidation.result["snapshot"],
      usable: vehicleValidation.result["usable"]
    }
  ];
  const focusedRequiredIds = new Set([
    "live-contract-endpoints",
    "consumer-semantic-lock",
    "business-2号车-current-state",
    "business-滨河路-ambiguity",
    "business-A区-exact-in-area",
    "async-world-query-nearby-sample",
    "async-world-query-nearby"
  ]);
  const blocked = checks.filter((check) => check.status === "BLOCKED" &&
    (!alignmentFocused || focusedRequiredIds.has(check.id)));
  const alignmentStatus = blocked.length === 0 ? "PASS" : "BLOCKED";
  const directEvidencePayload = {
    schemaVersion: "wsgs-gowm-direct-r1-r5-smoke/1.0",
    generatedAt: new Date().toISOString(),
    marker: alignmentStatus === "PASS" ? "DIRECT_GOWM_R1_R5_READY" : "DIRECT_GOWM_R1_R5_BLOCKED",
    status: alignmentStatus,
    executionLayer: "DIRECT_WSGS_CONSUMER_TO_GOWM_GATEWAY",
    wsgsSourceCommit,
    formalWsgsPipelineEvidence: false,
    runtime: {
      sourceCommit: "c49bf415fdb4cbe19a09f341c34b6dd825e3ca14",
      runtimeVersion: "0.6.4",
      gatewayContractVersion: "0.6.3",
      consumerPackage: "@gowm/world-gateway-contracts@0.6.3",
      contractCatalogRevision: lock.contractCatalogRevision,
      semanticCatalogHash: lock.semanticCatalogHash,
      operationalLockHash,
      runtimeBinding
    },
    summary: {
      total: 5,
      pass: alignmentStatus === "PASS" ? 5 : 0,
      fail: 0,
      notRun: 0,
      blocked: alignmentStatus === "PASS" ? 0 : 5,
      blockingCheckCount: blocked.length
    },
    cases: directCases,
    redaction: {
      credentialsIncluded: false,
      rawReferenceIdsIncluded: false,
      internalTopologyIncluded: false
    }
  };
  const directReport = {
    ...directEvidencePayload,
    evidenceHash: canonicalSha256(directEvidencePayload)
  };
  const directReportRepositoryRoot = resolve(import.meta.dirname, "..", "..");
  const directReportPath = resolve(
    directReportRepositoryRoot,
    process.env["GOWM_ALIGNMENT_DIRECT_REPORT"] ??
      "reports/wsgs-gowm-0.6.4-alignment/direct-r1-r5-smoke.json"
  );
  const directReportRelativePath = relative(directReportRepositoryRoot, directReportPath).split(sep).join("/");
  assertion(!directReportRelativePath.startsWith(".."), "GOWM_ALIGNMENT_DIRECT_REPORT_OUTSIDE_REPOSITORY");
  assertion(
    !alignmentFocused ||
      directReportRelativePath === "reports/wsgs-gowm-0.6.4-alignment/direct-r1-r5-smoke.json",
    "GOWM_ALIGNMENT_DIRECT_REPORT_PATH_MISMATCH"
  );
  mkdirSync(dirname(directReportPath), { recursive: true });
  writeFileSync(directReportPath, `${JSON.stringify(directReport, null, 2)}\n`, "utf8");

  process.stdout.write(`${JSON.stringify({
    status: blocked.length === 0 ? "PASS" : "PARTIAL",
    runtime: {
      gatewayContractVersion: "0.6.3",
      transport: baseUrl.protocol,
      exactConsumerRevision: lock.contractCatalogRevision,
      exactOperationalLockHash: operationalLockHash,
      operationalLockSource: externalLockPath ? "PINNED_EXTERNAL" : "BUNDLED_SOURCE_LOCK",
      privateKeyPathHash: sha256(privateKeyPath),
      executionClassification: trustedReady ? "TRUSTED" : "DIAGNOSTIC_ONLY_AFTER_FAIL_CLOSED_CONTRACT_DRIFT"
    },
    checks,
    alignmentR1R5: {
      status: alignmentStatus,
      cases: 5,
      reportPath: directReportPath,
      evidenceHash: directReport.evidenceHash
    },
    timingsMs: timings,
    summary: {
      pass: checks.length - blocked.length,
      blocked: blocked.length,
      failed: 0
    }
  }, null, 2)}\n`);
  if (blocked.length > 0) process.exitCode = 2;
}

main().catch((error: unknown) => {
  const safeMessage = error instanceof Error
    ? error.message.replace(/[A-Za-z0-9_./+=:-]{40,}/gu, "[REDACTED]").slice(0, 512)
    : undefined;
  const errorCode = error instanceof GatewayProtocolError
    ? error.code
    : error instanceof Error && /^[A-Z0-9_.:-]+$/u.test(error.message)
      ? error.message
      : error instanceof Error
        ? error.name
        : "UNKNOWN_ERROR";
  process.stderr.write(`${JSON.stringify({
    status: "FAIL",
    errorCode,
    stage: failureStage,
    ...(failureEvidence === undefined && safeMessage === undefined
      ? {}
      : { evidence: { ...(failureEvidence ?? {}), ...(safeMessage === undefined ? {} : { message: safeMessage }) } })
  })}\n`);
  process.exitCode = 1;
});
