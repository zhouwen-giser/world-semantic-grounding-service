import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createGroundingIdentity, GowmDelegationSigner } from "@wsgs/delegated-identity";
import {
  createGdpsV021FinalBFindingAuthority,
  readGdpsFindingOperationAuthority,
  resolveGdpsFindingOperationAuthority
} from "@wsgs/gdps-descriptor-consumer";
import { gdpsV021FindingContractClosure } from "@wsgs/gowm-contract-intake";
import {
  readValidatedGowmFindingResult,
  validateGowmFindingResultEnvelope
} from "@wsgs/gowm-execution-evidence";
import {
  GowmGatewayClient,
  type CapabilityDescriptor,
  type OperationLock
} from "@wsgs/gowm-gateway-client";

import {
  assembleGeospatialFindingsResult,
  canonicalSha256,
  type Sha256Digest
} from "../../packages/northbound-geospatial-findings/src/index.js";
import {
  createTrustedSourceContext,
  normalizeSourceProducts,
  type SourceGroundingIdentity
} from "../../packages/northbound-geospatial-findings/src/source-normalizer.js";

type JsonObject = Record<string, unknown>;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const operationId = "geo-product.get";
const operationVersion = "1.0";
const reportPath = resolve(repoRoot, "reports/sacs-geospatial-v1/real-e2e.json");
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const sourceShaPattern = /^[0-9a-f]{40}$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const productIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
Error.stackTraceLimit = 0;

function fail(code: string): never {
  throw new Error(code);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`MISSING_${name}`);
  return value;
}

function object(value: unknown, code: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as JsonObject;
}

function stringValue(value: unknown, code: string, maximum = 512): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) fail(code);
  return value;
}

function digest(value: unknown, code: string): Sha256Digest {
  if (typeof value !== "string" || !digestPattern.test(value)) fail(code);
  return value as Sha256Digest;
}

function exactInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(code);
  return value as number;
}

function list(name: string): string[] {
  const values = required(name).split(/[ ,]+/u).map((entry) => entry.trim()).filter(Boolean);
  if (new Set(values).size !== values.length || values.some((value) => !identifierPattern.test(value))) {
    fail(`INVALID_${name}`);
  }
  return values;
}

function rawSha256(value: string | Buffer): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function readJsonFile(path: string, code: string): JsonObject {
  try {
    return object(JSON.parse(readFileSync(path, "utf8")), code);
  } catch {
    return fail(code);
  }
}

function assertExactKeys(value: JsonObject, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const normalized = [...expected].sort();
  if (actual.length !== normalized.length
    || actual.some((key, index) => key !== normalized[index])) {
    fail(code);
  }
}

function assertCleanExactSource(): string {
  const head = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
    encoding: "utf8"
  }).trim();
  const expected = required("WSGS_QUALIFIED_SOURCE_SHA");
  if (!sourceShaPattern.test(head) || !sourceShaPattern.test(expected) || head !== expected) {
    fail("N03_QUALIFIED_SOURCE_SHA_MISMATCH");
  }
  const dirty = execFileSync(
    "git",
    ["-C", repoRoot, "status", "--porcelain=v1", "--untracked-files=all"],
    { encoding: "utf8" }
  ).trim();
  if (dirty.length > 0) fail("N03_QUALIFIED_SOURCE_NOT_CLEAN");
  return head;
}

function readCheckedN03InputSet(): Sha256Digest {
  try {
    execFileSync(process.execPath, [
      resolve(repoRoot, "node_modules/tsx/dist/cli.mjs"),
      resolve(repoRoot, "validation/scripts/generate-sacs-geospatial-provenance-evidence.ts")
    ], { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
  } catch {
    fail("N03_SOURCE_QUALIFICATION_CHECK_FAILED");
  }
  const value = readJsonFile(
    resolve(repoRoot, "reports/sacs-geospatial-v1/provenance-report.json"),
    "N03_SOURCE_QUALIFICATION_REPORT_INVALID"
  );
  const inputHashes = object(value["inputHashes"], "N03_SOURCE_INPUT_HASHES_INVALID");
  const inputSetHash = digest(value["inputSetHash"], "N03_SOURCE_INPUT_SET_HASH_INVALID");
  const acceptance = object(value["acceptance"], "N03_SOURCE_ACCEPTANCE_INVALID");
  if (value["schemaVersion"] !== "wsgs-v021-provenance-report/1.0"
    || value["phase"] !== "N03"
    || value["version"] !== "0.2.1"
    || value["profile"] !== "sacs-wsgs-geospatial-findings/1.0"
    || value["status"] !== "PARTIAL"
    || value["marker"] !== null
    || value["unitQualification"] !== "PASS"
    || value["realUpstreamQualification"] !== "NOT_RUN"
    || value["productionQualified"] !== false
    || acceptance["acceptanceId"] !== "V21-G06"
    || acceptance["status"] !== "NOT_RUN"
    || canonicalSha256(inputHashes) !== inputSetHash) {
    fail("N03_SOURCE_QUALIFICATION_NOT_READY_FOR_REAL_GATE");
  }
  return inputSetHash;
}

interface BaselineSelection {
  readonly productId: string;
  readonly expectedResultHash: Sha256Digest;
  readonly expectedContentHash: Sha256Digest;
  readonly baselineHash: Sha256Digest;
  readonly caseHash: Sha256Digest;
}

function selectFinalBBaselineCase(): BaselineSelection {
  const handoffRoot = resolve(
    process.env["GDPS_V021_HANDOFF_DIR"]?.trim()
      || join(repoRoot, "contracts/upstream/gdps-v0.2.1")
  );
  let checksumsBytes: Buffer;
  let baselineBytes: Buffer;
  try {
    checksumsBytes = readFileSync(join(handoffRoot, "CHECKSUMS.json"));
    baselineBytes = readFileSync(join(handoffRoot, "WSGS_TEST_BASELINE.json"));
  } catch {
    fail("N03_FINAL_B_HANDOFF_UNREADABLE");
  }
  const checksums = object(JSON.parse(checksumsBytes.toString("utf8")), "N03_FINAL_B_CHECKSUMS_INVALID");
  const baseline = object(JSON.parse(baselineBytes.toString("utf8")), "N03_FINAL_B_BASELINE_INVALID");
  if (checksums["bundleHash"] !== gdpsV021FindingContractClosure.handoff.bundleHash) {
    fail("N03_FINAL_B_BUNDLE_HASH_MISMATCH");
  }
  const files = Array.isArray(checksums["files"])
    ? checksums["files"].map((entry) => object(entry, "N03_FINAL_B_CHECKSUM_ENTRY_INVALID"))
    : fail("N03_FINAL_B_CHECKSUM_INVENTORY_INVALID");
  const entry = files.find((candidate) => candidate["path"] === "WSGS_TEST_BASELINE.json");
  if (entry === undefined
    || entry["sha256"] !== rawSha256(baselineBytes)
    || files.filter((candidate) => candidate["path"] === "WSGS_TEST_BASELINE.json").length !== 1) {
    fail("N03_FINAL_B_BASELINE_RAW_HASH_MISMATCH");
  }
  const baselineHash = canonicalSha256(baseline);
  if (baselineHash !== gdpsV021FindingContractClosure.handoff.testBaselineHash
    || baseline["schemaVersion"] !== "wsgs-gdps-test-baseline/1.0"
    || baseline["status"] !== "READY") {
    fail("N03_FINAL_B_BASELINE_AUTHORITY_MISMATCH");
  }

  const evidencePayload = object(
    baseline["gatewayCanaryEvidencePayload"],
    "N03_FINAL_B_EVIDENCE_PAYLOAD_INVALID"
  );
  const attestation = object(
    baseline["gatewayCanaryAttestation"],
    "N03_FINAL_B_ATTESTATION_INVALID"
  );
  if (attestation["runEvidenceHash"] !== canonicalSha256(evidencePayload)
    || attestation["status"] !== "PASS"
    || evidencePayload["datasetState"] !== "FINAL_B"
    || evidencePayload["contractCatalogRevision"]
      !== gdpsV021FindingContractClosure.gateway.contractCatalogRevision
    || evidencePayload["semanticCatalogHash"]
      !== gdpsV021FindingContractClosure.gateway.semanticCatalogHash
    || evidencePayload["bindingRevision"]
      !== gdpsV021FindingContractClosure.gateway.bindingRevision) {
    fail("N03_FINAL_B_EVIDENCE_BINDING_MISMATCH");
  }
  const cases = Array.isArray(evidencePayload["cases"])
    ? evidencePayload["cases"].map((candidate) => object(candidate, "N03_FINAL_B_CASE_INVALID"))
    : fail("N03_FINAL_B_CASES_INVALID");
  const matches = cases.filter((candidate) => candidate["operationId"] === operationId);
  if (matches.length !== 1) fail("N03_FINAL_B_CATALOG_CASE_NOT_UNIQUE");
  const selected = matches[0]!;
  if (selected["normalizedStatus"] !== "COMPLETED") fail("N03_FINAL_B_CATALOG_CASE_NOT_COMPLETED");
  const productId = stringValue(selected["productId"], "N03_FINAL_B_PRODUCT_ID_INVALID");
  if (!productIdentifierPattern.test(productId)) fail("N03_FINAL_B_PRODUCT_ID_INVALID");
  const expectedResultHash = digest(selected["resultHash"], "N03_FINAL_B_RESULT_HASH_INVALID");
  const expectedContentHash = digest(selected["contentHash"], "N03_FINAL_B_CONTENT_HASH_INVALID");
  const snapshot = object(selected["dataSnapshotEvidence"], "N03_FINAL_B_SNAPSHOT_INVALID");
  const dataScope = required("WSGS_READINESS_DATA_SCOPE");
  if (dataScope.includes("*")
    || snapshot["scopeDigest"] !== canonicalSha256({ dataScopeKey: dataScope })) {
    fail("N03_FINAL_B_SCOPE_BINDING_MISMATCH");
  }
  return {
    productId,
    expectedResultHash,
    expectedContentHash,
    baselineHash,
    caseHash: canonicalSha256(selected)
  };
}

function operationLock(descriptor: CapabilityDescriptor, semanticProfileHash: Sha256Digest): OperationLock {
  return {
    operationId,
    operationVersion,
    maturity: "PREVIEW",
    inputSchemaHash: descriptor.inputSchemaHash,
    outputSchemaHash: descriptor.outputSchemaHash,
    semanticProfileHash
  };
}

function assertSafeReport(report: JsonObject): void {
  assertExactKeys(report, [
    "schemaVersion", "status", "evidenceClass", "qualifiedSourceSha", "inputSetHash", "runtimeIdentityHash",
    "contractCatalogRevision", "semanticCatalogHash", "bindingRevision", "gatewayOnly",
    "directProviderCalls", "directDatabaseCalls", "credentialsIncluded", "localPathsIncluded",
    "requestIdentifiersIncluded", "internalTopologyIncluded", "operation", "protocol", "counts",
    "hashes", "generatedAt"
  ], "N03_REAL_REPORT_FIELD_SET_INVALID");
  assertExactKeys(object(report["operation"], "N03_REAL_REPORT_OPERATION_INVALID"),
    ["operationId", "operationVersion"], "N03_REAL_REPORT_OPERATION_FIELD_SET_INVALID");
  assertExactKeys(object(report["protocol"], "N03_REAL_REPORT_PROTOCOL_INVALID"),
    ["submitHttpStatus", "terminalStatus"], "N03_REAL_REPORT_PROTOCOL_FIELD_SET_INVALID");
  assertExactKeys(object(report["counts"], "N03_REAL_REPORT_COUNTS_INVALID"),
    ["sourceProductCount", "findingCount", "evidenceItemCount", "gapCount"],
    "N03_REAL_REPORT_COUNTS_FIELD_SET_INVALID");
  assertExactKeys(object(report["hashes"], "N03_REAL_REPORT_HASHES_INVALID"), [
    "resultHash", "sourceProductSetHash", "findingSetHash", "evidenceItemSetHash", "assemblyHash",
    "authorityClosureHash", "baselineHash", "baselineCaseHash"
  ], "N03_REAL_REPORT_HASH_FIELD_SET_INVALID");

  const forbiddenKey = /^(?:request|reference|product)(?:Id|Ids|Identifier|Identifiers)$|^(?:endpoint|url|uri|path|authorization|token|privateKey|credential|providerUrl|databaseIdentifier|assetPath)$/iu;
  const forbiddenValue = /(?:https?:\/\/|(?:postgres(?:ql)?|mysql|mongodb|redis|s3|gs|file):\/\/|\bBearer\s+|-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----|(?:^|[\s"'])\p{L}:[\\/]|(?:^|[\s"'])(?:\\\\|\/)(?:Users|home|var|tmp|mnt)(?:[\\/]|$))/iu;
  const visit = (value: unknown, key: string): void => {
    if (forbiddenKey.test(key)) fail(`N03_REAL_REPORT_FORBIDDEN_FIELD:${key}`);
    if (typeof value === "string") {
      if (forbiddenValue.test(value)) fail(`N03_REAL_REPORT_FORBIDDEN_VALUE:${key}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${key}[${index}]`));
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [childKey, child] of Object.entries(value as JsonObject)) visit(child, childKey);
  };
  visit(report, "ROOT");
}

const qualifiedSourceSha = assertCleanExactSource();
const inputSetHash = readCheckedN03InputSet();
const baseline = selectFinalBBaselineCase();
const finalAuthority = createGdpsV021FinalBFindingAuthority();
const operationAuthority = resolveGdpsFindingOperationAuthority(finalAuthority, {
  operationId,
  operationVersion,
  semanticConcept: "N03_CATALOG"
});
const operation = readGdpsFindingOperationAuthority(operationAuthority);

const baseUrl = required("GOWM_GATEWAY_BASE_URL");
const credential = required("GOWM_GATEWAY_TOKEN");
const timeoutMs = Number(process.env["WSGS_N03_GATEWAY_TIMEOUT_MS"] ?? "120000");
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 300_000) {
  fail("N03_GATEWAY_TIMEOUT_INVALID");
}
const client = new GowmGatewayClient({
  baseUrl,
  credential: () => credential,
  timeoutMs,
  maxRetries: 2
});
const catalog = await client.listCapabilities();
const semantics = await client.listCapabilitySemantics();
const descriptor = catalog.capabilities.find((candidate) =>
  candidate.operationId === operationId && candidate.operationVersion === operationVersion
);
const semantic = semantics.profiles.find((candidate) =>
  candidate.operationId === operationId && candidate.operationVersion === operationVersion
);
if (descriptor === undefined || semantic === undefined) {
  fail("N03_TRUSTED_OPERATION_DISCOVERY_INCOMPLETE");
}
if (descriptor.maturity !== "PREVIEW"
  || descriptor.inputSchemaUri !== operation.inputSchemaUri
  || descriptor.inputSchemaHash !== operation.inputSchemaHash
  || descriptor.outputSchemaUri !== operation.outputSchemaUri
  || descriptor.outputSchemaHash !== operation.outputSchemaHash
  || semantic.semanticProfileHash !== operation.semanticProfileHash) {
  fail("N03_TRUSTED_OPERATION_LOCK_MISMATCH");
}

const dataScope = required("WSGS_READINESS_DATA_SCOPE");
if (dataScope.includes("*") || !identifierPattern.test(dataScope)) fail("N03_DATA_SCOPE_INVALID");
const identity = createGroundingIdentity({
  servicePrincipalId: required("GOWM_DELEGATION_SERVICE_PRINCIPAL_ID"),
  actorId: required("WSGS_READINESS_ACTOR_ID"),
  dataScopes: [dataScope],
  datasetScopes: list("WSGS_READINESS_DATASET_SCOPES"),
  permissions: list("WSGS_READINESS_PERMISSIONS")
});
const sourceIdentity: SourceGroundingIdentity = {
  ...identity,
  authorizationContextHash: identity.authorizationContextHash as Sha256Digest
};
const trustedContext = createTrustedSourceContext(sourceIdentity, dataScope);
let privateKeyPkcs8: string;
try {
  privateKeyPkcs8 = readFileSync(required("GOWM_DELEGATION_PRIVATE_KEY_FILE"), "utf8");
} catch {
  fail("N03_DELEGATION_PRIVATE_KEY_UNREADABLE");
}
const signer = new GowmDelegationSigner({
  issuer: required("GOWM_DELEGATION_ISSUER"),
  audience: required("GOWM_DELEGATION_AUDIENCE"),
  servicePrincipalId: identity.servicePrincipalId,
  privateKeyPkcs8,
  trustedOperationKeys: [`${operationId}@${operationVersion}`],
  maximumTtlSeconds: 300,
  defaultTtlSeconds: 120
});
await signer.ready();

const requestId = `wsgs-n03-${createHash("sha256")
  .update(`${qualifiedSourceSha}:${Date.now()}:${process.pid}`)
  .digest("hex")
  .slice(0, 24)}`;
const deadlineAt = new Date(Date.now() + timeoutMs);
const executionDeadlineAt = new Date(
  Date.now() + Math.min(descriptor.execution.maximumTimeoutMs, 25_000)
);
const delegation = await signer.sign({
  kind: "DIRECT_OPERATION",
  identity,
  requestId,
  dataScopes: identity.dataScopes,
  datasetScopes: identity.datasetScopes,
  operation: { operationId, operationVersion }
});
const availability = await client.listOperationAvailability({
  requestId,
  delegationToken: delegation.token,
  deadlineAt
});
const available = availability.operations.find((candidate) =>
  candidate.operationId === operationId && candidate.operationVersion === operationVersion
);
if (available === undefined
  || available.maturity !== "PREVIEW"
  || available.availability !== "AVAILABLE") {
  fail("N03_TRUSTED_OPERATION_AVAILABILITY_MISMATCH");
}
const lock = operationLock(descriptor, semantic.semanticProfileHash);
const trustedCatalog = client.validateTrustedContracts({
  catalog,
  semantics,
  availability,
  required: [lock],
  expectedContractCatalogRevision: operation.gateway.contractCatalogRevision,
  expectedSemanticCatalogHash: operation.gateway.semanticCatalogHash
});
if (!trustedCatalog.requiredReady
  || trustedCatalog.requiredMismatches.length !== 0
  || catalog.bindingRevision !== operation.gateway.bindingRevision
  || semantics.bindingRevision !== operation.gateway.bindingRevision
  || available.bindingRevision !== operation.gateway.bindingRevision) {
  fail("N03_TRUSTED_GATEWAY_AUTHORITY_MISMATCH");
}
const response = await client.executeOperation(lock, {
  requestVersion: "1.0",
  requestId,
  idempotencyKey: `${requestId}:execute`,
  operationVersion,
  inputSchemaHash: operation.inputSchemaHash,
  outputSchemaHash: operation.outputSchemaHash,
  input: { productId: baseline.productId },
  executionPolicy: {
    deadlineAt: executionDeadlineAt.toISOString(),
    maximumResultBytes: descriptor.limits.maximumOutputBytes ?? 5_242_880,
    maximumCostClass: descriptor.execution.costClass,
    preferredExecution: "SYNC"
  }
}, {
  requestId,
  delegationToken: delegation.token,
  deadlineAt
});

let envelope: JsonObject;
let terminalStatus: string;
if (response.status === 200) {
  envelope = object(response.value, "N03_SYNC_RESULT_INVALID");
  terminalStatus = stringValue(envelope["status"], "N03_SYNC_STATUS_INVALID", 32);
} else if (response.status === 202) {
  const job = object(response.value, "N03_JOB_SUBMISSION_INVALID");
  const jobId = stringValue(job["jobId"], "N03_JOB_ID_INVALID");
  const terminal = await client.pollJob(jobId, { requestId, delegationToken: delegation.token, deadlineAt });
  terminalStatus = stringValue(terminal["status"], "N03_JOB_STATUS_INVALID", 32);
  envelope = object(terminal["result"], "N03_JOB_RESULT_INVALID");
} else {
  fail("N03_SUBMIT_HTTP_STATUS_INVALID");
}
if (terminalStatus !== "COMPLETED" || envelope["status"] !== "COMPLETED") {
  fail("N03_GATEWAY_EXECUTION_NOT_COMPLETED");
}

const validatedResult = validateGowmFindingResultEnvelope(operationAuthority, envelope);
const validatedProjection = readValidatedGowmFindingResult(validatedResult);
const output = validatedProjection.envelope.output;
if (output === undefined) fail("N03_GATEWAY_OUTPUT_REQUIRED");
const resultHash = canonicalSha256(output.value);
if (resultHash !== baseline.expectedResultHash) fail("N03_FINAL_B_RESULT_CHANGED");
const sourceBinding = normalizeSourceProducts({ trustedContext, validatedResults: [validatedResult] });
const assembly = assembleGeospatialFindingsResult({ sourceBinding, validatedResults: [validatedResult] });
const findings = assembly.geospatialFindings;
if (findings.findings.length < 1
  || findings.sourceProducts.length < 1
  || assembly.evidenceItems.length < 1
  || findings.gaps.length !== 0
  || findings.sourceProducts.some((source) => source.contentHash !== baseline.expectedContentHash)) {
  fail("N03_REAL_UPSTREAM_RESULT_QUALIFICATION_FAILED");
}

const runtimeIdentityHash = canonicalSha256({
  qualifiedSourceSha,
  inputSetHash,
  authorityClosureHash: operation.closureHash,
  gateway: operation.gateway,
  operation: {
    operationId,
    operationVersion,
    inputSchemaHash: operation.inputSchemaHash,
    outputSchemaHash: operation.outputSchemaHash,
    semanticProfileHash: operation.semanticProfileHash
  },
  availability: "AVAILABLE"
});
const report: JsonObject = {
  schemaVersion: "wsgs-v021-n03-real-upstream/1.0",
  status: "PASS",
  evidenceClass: "REAL_UPSTREAM",
  qualifiedSourceSha,
  inputSetHash,
  runtimeIdentityHash,
  contractCatalogRevision: catalog.contractCatalogRevision,
  semanticCatalogHash: semantics.catalogHash,
  bindingRevision: catalog.bindingRevision,
  gatewayOnly: true,
  directProviderCalls: 0,
  directDatabaseCalls: 0,
  credentialsIncluded: false,
  localPathsIncluded: false,
  requestIdentifiersIncluded: false,
  internalTopologyIncluded: false,
  operation: { operationId, operationVersion },
  protocol: { submitHttpStatus: response.status, terminalStatus },
  counts: {
    sourceProductCount: exactInteger(findings.sourceProducts.length, "N03_SOURCE_COUNT_INVALID"),
    findingCount: exactInteger(findings.findings.length, "N03_FINDING_COUNT_INVALID"),
    evidenceItemCount: exactInteger(assembly.evidenceItems.length, "N03_EVIDENCE_COUNT_INVALID"),
    gapCount: exactInteger(findings.gaps.length, "N03_GAP_COUNT_INVALID")
  },
  hashes: {
    resultHash,
    sourceProductSetHash: findings.sourceProductSetHash,
    findingSetHash: findings.findingSetHash,
    evidenceItemSetHash: assembly.evidenceItemSetHash,
    assemblyHash: assembly.assemblyHash,
    authorityClosureHash: operation.closureHash,
    baselineHash: baseline.baselineHash,
    baselineCaseHash: baseline.caseHash
  },
  generatedAt: new Date().toISOString()
};
assertSafeReport(report);

if (process.argv.includes("--write")) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
process.stdout.write(`${JSON.stringify({
  marker: "WSGS_V021_N03_REAL_UPSTREAM_PASS",
  qualifiedSourceSha,
  inputSetHash,
  operation: `${operationId}@${operationVersion}`,
  submitHttpStatus: response.status,
  terminalStatus,
  counts: report["counts"],
  resultHash,
  assemblyHash: assembly.assemblyHash,
  reportWritten: process.argv.includes("--write")
}, null, 2)}\n`);
