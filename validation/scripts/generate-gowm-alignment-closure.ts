import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

type JsonObject = Record<string, unknown>;
type CriterionStatus = "PASS";

interface AcceptanceRow {
  id: string;
  phase: string;
  requirement: string;
  gate: string;
  evidence: string;
  blocking: true;
}

interface EvidencePointer {
  path: string;
  sha256: `sha256:${string}`;
  status: string;
}

interface EvidenceDocument extends EvidencePointer {
  document: JsonObject;
}

interface CriterionResult {
  id: string;
  phase: string;
  requirement: string;
  gate: string;
  declaredEvidence: string;
  blocking: true;
  status: CriterionStatus;
  evidence: EvidencePointer[];
  evidenceHash: `sha256:${string}`;
}

interface CliOptions {
  root: string;
  write: boolean;
}

const DEFAULT_ROOT = resolve(import.meta.dirname, "..", "..");
const ACCEPTANCE_RELATIVE_PATH = "acceptance/alignment-required.csv";
const REPORT_ROOT = "reports/wsgs-gowm-0.6.4-alignment";
const EXPECTED_ACCEPTANCE_SHA256 =
  "sha256:1d81b3b5ffb8c069498e04a160499db33e795fcef092db0f9bb9c382440528e4" as const;
const EXPECTED_RUNTIME_COMMIT = "fceed92398a0b86c0a0121aa2188a7f1d328e577" as const;
const EXPECTED_RUNTIME_VERSION = "0.6.4" as const;
const EXPECTED_GATEWAY_CONTRACT_VERSION = "0.6.3" as const;
const EXPECTED_PACKAGE_NAME = "@gowm/world-gateway-contracts" as const;
const EXPECTED_PACKAGE_VERSION = "0.6.3" as const;
const EXPECTED_LOGICAL_INTEGRITY =
  "sha512-f4bcksAK/JMk67pbkXlTycHREfM/19Xys4PcYhtjPTNW1Q43Xx+GYLlFkir0ePprUmNHo9Mnvksj2d2DOuCFrg==" as const;
const EXPECTED_TARBALL_BYTES = "52867" as const;
const EXPECTED_TARBALL_SHA256 = "3ae5372060752877fae34f16eb1b3239eb60878ec69473a502010df8a88ae322" as const;
const EXPECTED_ARCHIVE_SRI =
  "sha512-/QHyUETXwXXb09+cWgWjh9Hh+U24PuYhEh56O0P01lJkL2k+mB09yOPgO+efc9qY8X1FnxQOC4T/xc9pVyGldA==" as const;
const EXPECTED_MATERIALIZATION_TREE =
  "sha256:dee0bda2b950243d25b582fa1f691172997f8b01d837954510ec9f762d822a5a" as const;
const EXPECTED_CONTRACT_CATALOG_REVISION =
  "sha256:efd0395dbd05c884c781f964b22147efcb38c4cef91704597706ec4b8332075a" as const;
const EXPECTED_SEMANTIC_CATALOG_HASH =
  "sha256:418fc328861e846801c6e8109bf6d48b876c7814c650a391b84076f71e588b61" as const;
const EXPECTED_SOUTHBOUND_RAW_SHA256 =
  "sha256:e31f657f5ab82a687dba58021d0b105d635753f2d3a59c2daa616afa20b9e54a" as const;
const EXPECTED_NORTHBOUND_CONTRACT = "sacs-wsgs-grounding/1.0" as const;
const EXPECTED_RECIPE_IDS = ["R1", "R2", "R3", "R4", "R5"] as const;
const EXPECTED_CRITERION_IDS = Array.from(
  { length: 24 },
  (_unused, index) => `ALIGN-${String(index + 1).padStart(3, "0")}`
);

const EVIDENCE_PATHS = {
  baseline: `${REPORT_ROOT}/w00-baseline.json`,
  invariant: `${REPORT_ROOT}/alignment-invariant-report.json`,
  negativeAlignment: `${REPORT_ROOT}/negative-cases-report.json`,
  northbound: `${REPORT_ROOT}/northbound-compatibility-report.json`,
  intake: `${REPORT_ROOT}/contract-intake-report.json`,
  contractDiff: `${REPORT_ROOT}/contract-diff-report.json`,
  semanticMigration: `${REPORT_ROOT}/semantic-migration-report.json`,
  authorities: `${REPORT_ROOT}/w00-existing-authorities.json`,
  referenceIdentity: `${REPORT_ROOT}/reference-identity-report.json`,
  referenceNegative: `${REPORT_ROOT}/reference-negative-cases.json`,
  direct: `${REPORT_ROOT}/direct-r1-r5-smoke.json`,
  runtimeBinding: `${REPORT_ROOT}/runtime-binding-report.json`,
  runtimeImageBuild: `${REPORT_ROOT}/runtime-image-build-report.json`,
  wsgsProcessBinding: `${REPORT_ROOT}/wsgs-process-binding.json`,
  wsgsRuntimeImageBuild: `${REPORT_ROOT}/wsgs-runtime-image-build-report.json`,
  formal: `${REPORT_ROOT}/formal-pipeline-r1-r5.json`,
  r3Composability: `${REPORT_ROOT}/reference-composability-r3.json`,
  traceability: `${REPORT_ROOT}/pipeline-traceability.json`,
  handoff: `${REPORT_ROOT}/handoff-verification-report.json`,
  handoffContract: "contracts/consumers/sacs-development-handoff-v1.json",
  repositoryCheck: `${REPORT_ROOT}/repository-check.json`,
  deliveryScan: `${REPORT_ROOT}/delivery-scan.json`,
  prReview: `${REPORT_ROOT}/pr-review.json`,
  prBody: `${REPORT_ROOT}/PR_BODY.md`
} as const;

const OUTPUT_PATHS = {
  closure: `${REPORT_ROOT}/closure-report.json`,
  readiness: `${REPORT_ROOT}/development-readiness.md`,
  ledger: `${REPORT_ROOT}/alignment-ledger.json`
} as const;

const CRITERION_EVIDENCE: Readonly<Record<string, readonly string[]>> = {
  "ALIGN-001": [EVIDENCE_PATHS.baseline],
  "ALIGN-002": [EVIDENCE_PATHS.invariant],
  "ALIGN-003": [EVIDENCE_PATHS.invariant],
  "ALIGN-004": [EVIDENCE_PATHS.invariant],
  "ALIGN-005": [EVIDENCE_PATHS.invariant],
  "ALIGN-006": [EVIDENCE_PATHS.negativeAlignment],
  "ALIGN-007": [EVIDENCE_PATHS.northbound],
  "ALIGN-008": [EVIDENCE_PATHS.intake],
  "ALIGN-009": [EVIDENCE_PATHS.intake],
  "ALIGN-010": [EVIDENCE_PATHS.intake],
  "ALIGN-011": [EVIDENCE_PATHS.contractDiff],
  "ALIGN-012": [EVIDENCE_PATHS.semanticMigration],
  "ALIGN-013": [EVIDENCE_PATHS.authorities],
  "ALIGN-014": [EVIDENCE_PATHS.referenceIdentity],
  "ALIGN-015": [EVIDENCE_PATHS.referenceNegative],
  "ALIGN-016": [EVIDENCE_PATHS.direct],
  "ALIGN-017": [EVIDENCE_PATHS.formal],
  "ALIGN-018": [EVIDENCE_PATHS.formal, EVIDENCE_PATHS.r3Composability],
  "ALIGN-019": [EVIDENCE_PATHS.traceability],
  "ALIGN-020": [EVIDENCE_PATHS.handoff],
  "ALIGN-021": [EVIDENCE_PATHS.handoff],
  "ALIGN-022": [EVIDENCE_PATHS.repositoryCheck],
  "ALIGN-023": [EVIDENCE_PATHS.deliveryScan],
  "ALIGN-024": [EVIDENCE_PATHS.prReview]
};

export class AlignmentClosureError extends Error {
  public constructor(
    readonly code: string,
    message: string = code
  ) {
    super(message);
    this.name = "AlignmentClosureError";
  }
}

function fail(code: string, detail?: string): never {
  throw new AlignmentClosureError(code, detail === undefined ? code : `${code}:${detail}`);
}

function invariant(condition: unknown, code: string, detail?: string): asserts condition {
  if (!condition) fail(code, detail);
}

function object(value: unknown, label: string): JsonObject {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), "ALIGNMENT_CLOSURE_INVALID_OBJECT", label);
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  invariant(Array.isArray(value), "ALIGNMENT_CLOSURE_INVALID_ARRAY", label);
  return value;
}

function text(value: unknown, label: string): string {
  invariant(typeof value === "string" && value.length > 0, "ALIGNMENT_CLOSURE_INVALID_TEXT", label);
  return value;
}

function integer(value: unknown, label: string): number {
  invariant(Number.isSafeInteger(value), "ALIGNMENT_CLOSURE_INVALID_INTEGER", label);
  return value as number;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as JsonObject;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  invariant(encoded !== undefined, "ALIGNMENT_CLOSURE_CANONICAL_JSON_UNDEFINED");
  return encoded;
}

function sha256(value: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalSha256(value: unknown): `sha256:${string}` {
  return sha256(canonicalJson(value));
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function repoPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function resolveRepoFile(root: string, relativePath: string, label: string): string {
  invariant(!isAbsolute(relativePath) && !relativePath.includes("\\"), "ALIGNMENT_EVIDENCE_PATH_UNSAFE", label);
  const path = resolve(root, relativePath);
  invariant(repoPath(root, path) === relativePath, "ALIGNMENT_EVIDENCE_PATH_UNSAFE", label);
  return path;
}

function parseCsvLine(line: string, lineNumber: number): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  invariant(!quoted, "ALIGNMENT_ACCEPTANCE_CSV_INVALID", `unclosed quote at line ${lineNumber}`);
  values.push(value);
  return values;
}

function readAcceptanceMatrix(root: string): { rows: AcceptanceRow[]; hash: `sha256:${string}` } {
  const path = resolve(root, ACCEPTANCE_RELATIVE_PATH);
  invariant(existsSync(path), "ALIGNMENT_ACCEPTANCE_MATRIX_MISSING", ACCEPTANCE_RELATIVE_PATH);
  const bytes = readFileSync(path);
  const hash = sha256(bytes);
  invariant(hash === EXPECTED_ACCEPTANCE_SHA256, "ALIGNMENT_ACCEPTANCE_MATRIX_HASH_MISMATCH", hash);
  const source = bytes.toString("utf8");
  invariant(Buffer.from(source, "utf8").equals(bytes), "ALIGNMENT_ACCEPTANCE_MATRIX_NOT_UTF8");
  invariant(!source.includes("\r"), "ALIGNMENT_ACCEPTANCE_MATRIX_NOT_CANONICAL_LF");
  const lines = source.endsWith("\n") ? source.slice(0, -1).split("\n") : source.split("\n");
  const header = parseCsvLine(lines[0] ?? "", 1);
  invariant(
    canonicalJson(header) === canonicalJson(["id", "phase", "requirement", "gate", "evidence", "blocking"]),
    "ALIGNMENT_ACCEPTANCE_MATRIX_HEADER_MISMATCH"
  );
  const rows = lines.slice(1).map((line, index): AcceptanceRow => {
    const values = parseCsvLine(line, index + 2);
    invariant(values.length === header.length, "ALIGNMENT_ACCEPTANCE_CSV_INVALID", `line ${index + 2}`);
    const [id, phase, requirement, gate, evidence, blocking] = values;
    invariant(blocking === "true", "ALIGNMENT_ACCEPTANCE_NON_BLOCKING_ROW", id);
    invariant(
      [id, phase, requirement, gate, evidence].every((entry) => entry !== undefined && entry.length > 0),
      "ALIGNMENT_ACCEPTANCE_EMPTY_FIELD",
      id
    );
    return {
      id: id!,
      phase: phase!,
      requirement: requirement!,
      gate: gate!,
      evidence: evidence!,
      blocking: true
    };
  });
  invariant(rows.length === EXPECTED_CRITERION_IDS.length, "ALIGNMENT_ACCEPTANCE_COUNT_MISMATCH", String(rows.length));
  invariant(
    canonicalJson(rows.map((row) => row.id)) === canonicalJson(EXPECTED_CRITERION_IDS),
    "ALIGNMENT_ACCEPTANCE_ID_SET_MISMATCH"
  );
  invariant(
    rows.every((row) => CRITERION_EVIDENCE[row.id] !== undefined),
    "ALIGNMENT_ACCEPTANCE_EVIDENCE_MAPPING_MISSING"
  );
  return { rows, hash };
}

function verifyDeclaredEvidenceHash(document: JsonObject, label: string): void {
  invariant(Object.hasOwn(document, "evidenceHash"), "ALIGNMENT_EVIDENCE_HASH_MISSING", label);
  const declared = text(document["evidenceHash"], `${label}.evidenceHash`);
  invariant(/^sha256:[0-9a-f]{64}$/u.test(declared), "ALIGNMENT_EVIDENCE_HASH_INVALID", label);
  const payload = { ...document };
  delete payload["evidenceHash"];
  invariant(declared === canonicalSha256(payload), "ALIGNMENT_EVIDENCE_HASH_MISMATCH", label);
}

function assertNoSecretMaterial(bytes: Buffer, label: string): void {
  const decoded = bytes.toString("utf8");
  invariant(Buffer.from(decoded, "utf8").equals(bytes), "ALIGNMENT_EVIDENCE_NOT_UTF8", label);
  const secretPattern =
    /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[oprsu]_[A-Za-z0-9]{20,}\b|\bsk-[A-Za-z0-9_-]{20,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b)/u;
  invariant(!secretPattern.test(decoded), "ALIGNMENT_EVIDENCE_SECRET_MATERIAL", label);
}

function readHashedJson(root: string, relativePath: string): Omit<EvidenceDocument, "status"> {
  const path = resolveRepoFile(root, relativePath, relativePath);
  invariant(existsSync(path), "ALIGNMENT_CLOSURE_EVIDENCE_MISSING", relativePath);
  const bytes = readFileSync(path);
  assertNoSecretMaterial(bytes, relativePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail("ALIGNMENT_CLOSURE_EVIDENCE_INVALID_JSON", `${relativePath}:${detail}`);
  }
  const document = object(parsed, relativePath);
  verifyDeclaredEvidenceHash(document, relativePath);
  return { path: relativePath, sha256: sha256(bytes), document };
}

function readEvidence(root: string, relativePath: string, allowedStatuses: readonly string[] = ["PASS"]): EvidenceDocument {
  const item = readHashedJson(root, relativePath);
  const { document } = item;
  const status = text(document["status"], `${relativePath}.status`);
  invariant(allowedStatuses.includes(status), "ALIGNMENT_CLOSURE_EVIDENCE_NOT_PASS", `${relativePath}:${status}`);
  return { ...item, status };
}

function assertRuntimeTuple(document: JsonObject, label: string): void {
  invariant(document["sourceCommit"] === EXPECTED_RUNTIME_COMMIT, "ALIGNMENT_RUNTIME_COMMIT_MISMATCH", label);
  invariant(document["runtimeVersion"] === EXPECTED_RUNTIME_VERSION, "ALIGNMENT_RUNTIME_VERSION_MISMATCH", label);
  invariant(
    document["gatewayContractVersion"] === EXPECTED_GATEWAY_CONTRACT_VERSION,
    "ALIGNMENT_GATEWAY_CONTRACT_VERSION_MISMATCH",
    label
  );
  const packageValue = document["consumerPackage"];
  if (typeof packageValue === "string") {
    invariant(
      packageValue === `${EXPECTED_PACKAGE_NAME}@${EXPECTED_PACKAGE_VERSION}`,
      "ALIGNMENT_GATEWAY_PACKAGE_MISMATCH",
      label
    );
  } else {
    const consumerPackage = object(packageValue, `${label}.consumerPackage`);
    invariant(consumerPackage["name"] === EXPECTED_PACKAGE_NAME, "ALIGNMENT_GATEWAY_PACKAGE_MISMATCH", label);
    invariant(consumerPackage["version"] === EXPECTED_PACKAGE_VERSION, "ALIGNMENT_GATEWAY_PACKAGE_MISMATCH", label);
  }
}

function digest(value: unknown, label: string): `sha256:${string}` {
  const candidate = text(value, label);
  invariant(/^sha256:[0-9a-f]{64}$/u.test(candidate), "ALIGNMENT_DIGEST_INVALID", label);
  return candidate as `sha256:${string}`;
}

function assertSchemaVersion(document: JsonObject, expected: string, label: string): void {
  invariant(document["schemaVersion"] === expected, "ALIGNMENT_EVIDENCE_SCHEMA_VERSION_MISMATCH", label);
}

function assertDirectRuntimeBinding(root: string, runtime: JsonObject, label: string): JsonObject {
  const binding = object(runtime["runtimeBinding"], `${label}.runtime.runtimeBinding`);
  invariant(binding["bindingStatus"] === "PASS", "ALIGNMENT_RUNTIME_BINDING_NOT_PASS", label);
  invariant(binding["sourceCommit"] === EXPECTED_RUNTIME_COMMIT, "ALIGNMENT_RUNTIME_BINDING_COMMIT_MISMATCH", label);
  invariant(binding["runtimeVersion"] === EXPECTED_RUNTIME_VERSION, "ALIGNMENT_RUNTIME_BINDING_VERSION_MISMATCH", label);
  invariant(
    binding["gatewayContractVersion"] === EXPECTED_GATEWAY_CONTRACT_VERSION,
    "ALIGNMENT_RUNTIME_BINDING_CONTRACT_VERSION_MISMATCH",
    label
  );
  digest(binding["imageDigest"], `${label}.runtimeBinding.imageDigest`);
  const observedAt = text(binding["observedAt"], `${label}.runtimeBinding.observedAt`);
  invariant(Number.isFinite(Date.parse(observedAt)), "ALIGNMENT_RUNTIME_BINDING_OBSERVED_AT_INVALID", label);
  const instanceEvidencePath = text(binding["instanceEvidencePath"], `${label}.runtimeBinding.instanceEvidencePath`);
  invariant(instanceEvidencePath === EVIDENCE_PATHS.runtimeBinding, "ALIGNMENT_RUNTIME_BINDING_EVIDENCE_PATH_MISMATCH", label);
  const instanceEvidencePointer = readHashedJson(root, instanceEvidencePath);
  const instanceEvidenceHash = digest(binding["instanceEvidenceHash"], `${label}.runtimeBinding.instanceEvidenceHash`);
  invariant(instanceEvidenceHash === instanceEvidencePointer.sha256, "ALIGNMENT_RUNTIME_BINDING_INSTANCE_EVIDENCE_HASH_MISMATCH", label);
  const instanceEvidence = instanceEvidencePointer.document;
  assertSchemaVersion(instanceEvidence, "wsgs-gowm-runtime-binding/1.0", instanceEvidencePath);
  const instanceEvidencePayloadHash = digest(
    binding["instanceEvidencePayloadHash"],
    `${label}.runtimeBinding.instanceEvidencePayloadHash`
  );
  invariant(instanceEvidence["evidenceHash"] === instanceEvidencePayloadHash, "ALIGNMENT_RUNTIME_BINDING_INSTANCE_PAYLOAD_HASH_MISMATCH", label);
  invariant(instanceEvidence["bindingStatus"] === "PASS", "ALIGNMENT_RUNTIME_BINDING_INSTANCE_NOT_PASS", label);
  invariant(instanceEvidence["sourceCommit"] === EXPECTED_RUNTIME_COMMIT, "ALIGNMENT_RUNTIME_BINDING_INSTANCE_COMMIT_MISMATCH", label);
  invariant(instanceEvidence["runtimeVersion"] === EXPECTED_RUNTIME_VERSION, "ALIGNMENT_RUNTIME_BINDING_INSTANCE_VERSION_MISMATCH", label);
  invariant(
    instanceEvidence["gatewayContractVersion"] === EXPECTED_GATEWAY_CONTRACT_VERSION,
    "ALIGNMENT_RUNTIME_BINDING_INSTANCE_CONTRACT_VERSION_MISMATCH",
    label
  );
  invariant(instanceEvidence["imageDigest"] === binding["imageDigest"], "ALIGNMENT_RUNTIME_BINDING_INSTANCE_IMAGE_MISMATCH", label);
  invariant(instanceEvidence["observedAt"] === observedAt, "ALIGNMENT_RUNTIME_BINDING_INSTANCE_TIME_MISMATCH", label);
  invariant(instanceEvidence["appContainerCount"] === 6, "ALIGNMENT_RUNTIME_BINDING_CONTAINER_COUNT_MISMATCH", label);
  invariant(instanceEvidence["gatewayPortBindingVerified"] === true, "ALIGNMENT_RUNTIME_BINDING_PORT_NOT_VERIFIED", label);
  invariant(instanceEvidence["allAppContainersHealthy"] === true, "ALIGNMENT_RUNTIME_BINDING_CONTAINERS_NOT_HEALTHY", label);
  digest(instanceEvidence["composeProjectHash"], `${label}.runtimeBinding.composeProjectHash`);
  digest(instanceEvidence["serviceSetHash"], `${label}.runtimeBinding.serviceSetHash`);
  invariant(
    instanceEvidence["sourceBindingMethod"] === "OCI_LABEL_AND_RUNNING_CONTAINER_IMAGE_ID",
    "ALIGNMENT_RUNTIME_BINDING_METHOD_MISMATCH",
    label
  );

  const instanceImageBuild = object(instanceEvidence["imageBuildEvidence"], `${label}.runtimeBinding.imageBuildEvidence`);
  invariant(instanceImageBuild["status"] === "PASS", "ALIGNMENT_RUNTIME_IMAGE_BUILD_NOT_PASS", label);
  const imageBuildEvidencePath = text(binding["imageBuildEvidencePath"], `${label}.runtimeBinding.imageBuildEvidencePath`);
  invariant(imageBuildEvidencePath === EVIDENCE_PATHS.runtimeImageBuild, "ALIGNMENT_RUNTIME_IMAGE_BUILD_PATH_MISMATCH", label);
  invariant(instanceImageBuild["reportPath"] === imageBuildEvidencePath, "ALIGNMENT_RUNTIME_IMAGE_BUILD_PATH_CROSS_REPORT_MISMATCH", label);
  const imageBuildPointer = readHashedJson(root, imageBuildEvidencePath);
  const imageBuildEvidenceHash = digest(binding["imageBuildEvidenceHash"], `${label}.runtimeBinding.imageBuildEvidenceHash`);
  invariant(imageBuildEvidenceHash === imageBuildPointer.sha256, "ALIGNMENT_RUNTIME_IMAGE_BUILD_FILE_HASH_MISMATCH", label);
  invariant(instanceImageBuild["reportFileHash"] === imageBuildEvidenceHash, "ALIGNMENT_RUNTIME_IMAGE_BUILD_FILE_HASH_CROSS_REPORT_MISMATCH", label);
  const imageBuildEvidencePayloadHash = digest(
    binding["imageBuildEvidencePayloadHash"],
    `${label}.runtimeBinding.imageBuildEvidencePayloadHash`
  );
  const imageBuildReport = imageBuildPointer.document;
  assertSchemaVersion(imageBuildReport, "wsgs-gowm-runtime-image-build/1.0", imageBuildEvidencePath);
  invariant(
    imageBuildReport["evidenceHash"] === imageBuildEvidencePayloadHash &&
      instanceImageBuild["reportPayloadHash"] === imageBuildEvidencePayloadHash,
    "ALIGNMENT_RUNTIME_IMAGE_BUILD_PAYLOAD_HASH_MISMATCH",
    label
  );
  invariant(imageBuildReport["status"] === "PASS", "ALIGNMENT_RUNTIME_IMAGE_BUILD_NOT_PASS", label);
  invariant(imageBuildReport["sourceCommit"] === EXPECTED_RUNTIME_COMMIT, "ALIGNMENT_RUNTIME_IMAGE_BUILD_COMMIT_MISMATCH", label);
  invariant(imageBuildReport["runtimeVersion"] === EXPECTED_RUNTIME_VERSION, "ALIGNMENT_RUNTIME_IMAGE_BUILD_VERSION_MISMATCH", label);
  invariant(imageBuildReport["imageDigest"] === binding["imageDigest"], "ALIGNMENT_RUNTIME_IMAGE_BUILD_IMAGE_MISMATCH", label);
  invariant(
    imageBuildReport["buildMethod"] === "DOCKER_BUILD_FROM_CLEAN_EXACT_GIT_TREE_WITH_OCI_LABELS",
    "ALIGNMENT_RUNTIME_IMAGE_BUILD_METHOD_MISMATCH",
    label
  );
  const sourceTree = text(binding["sourceTree"], `${label}.runtimeBinding.sourceTree`);
  invariant(/^[0-9a-f]{40}$/u.test(sourceTree), "ALIGNMENT_RUNTIME_SOURCE_TREE_INVALID", label);
  invariant(
    imageBuildReport["sourceTree"] === sourceTree && instanceImageBuild["sourceTree"] === sourceTree,
    "ALIGNMENT_RUNTIME_SOURCE_TREE_MISMATCH",
    label
  );
  const imageBuildGeneratedAt = text(imageBuildReport["generatedAt"], `${label}.runtimeBinding.imageBuildGeneratedAt`);
  invariant(Number.isFinite(Date.parse(imageBuildGeneratedAt)), "ALIGNMENT_RUNTIME_IMAGE_BUILD_TIME_INVALID", label);
  invariant(instanceImageBuild["generatedAt"] === imageBuildGeneratedAt, "ALIGNMENT_RUNTIME_IMAGE_BUILD_TIME_MISMATCH", label);
  const declaredBindingHash = digest(binding["bindingHash"], `${label}.runtimeBinding.bindingHash`);
  const bindingPayload = { ...binding };
  delete bindingPayload["bindingHash"];
  invariant(declaredBindingHash === canonicalSha256(bindingPayload), "ALIGNMENT_RUNTIME_BINDING_HASH_MISMATCH", label);
  return binding;
}

function assertFormalRuntimeBinding(
  root: string,
  document: JsonObject,
  label: string,
  directBinding: JsonObject,
  directEvidence: EvidenceDocument
): void {
  const binding = object(document["runtimeBinding"], `${label}.runtimeBinding`);
  invariant(binding["bindingStatus"] === "PASS", "ALIGNMENT_RUNTIME_BINDING_NOT_PASS", label);
  invariant(binding["sourceCommit"] === EXPECTED_RUNTIME_COMMIT, "ALIGNMENT_RUNTIME_BINDING_COMMIT_MISMATCH", label);
  invariant(binding["runtimeVersion"] === EXPECTED_RUNTIME_VERSION, "ALIGNMENT_RUNTIME_BINDING_VERSION_MISMATCH", label);
  invariant(
    binding["gatewayContractVersion"] === EXPECTED_GATEWAY_CONTRACT_VERSION,
    "ALIGNMENT_RUNTIME_BINDING_CONTRACT_VERSION_MISMATCH",
    label
  );
  invariant(binding["imageDigest"] === directBinding["imageDigest"], "ALIGNMENT_RUNTIME_BINDING_IMAGE_MISMATCH", label);
  invariant(
    binding["instanceEvidenceHash"] === directBinding["instanceEvidenceHash"],
    "ALIGNMENT_RUNTIME_BINDING_INSTANCE_EVIDENCE_MISMATCH",
    label
  );
  invariant(
    binding["runtimeBindingHash"] === directBinding["bindingHash"],
    "ALIGNMENT_RUNTIME_BINDING_CROSS_REPORT_HASH_MISMATCH",
    label
  );
  invariant(
    document["runtimeBindingHash"] === binding["runtimeBindingHash"],
    "ALIGNMENT_RUNTIME_BINDING_TOP_LEVEL_HASH_MISMATCH",
    label
  );
  invariant(
    binding["runtimeBindingHashBasis"] === "DIRECT_REPORT_RUNTIME_BINDING_CANONICAL_JSON_WITHOUT_BINDING_HASH",
    "ALIGNMENT_RUNTIME_BINDING_HASH_BASIS_MISMATCH",
    label
  );
  invariant(
    binding["instanceEvidencePayloadHash"] === directBinding["instanceEvidencePayloadHash"],
    "ALIGNMENT_RUNTIME_BINDING_INSTANCE_PAYLOAD_MISMATCH",
    label
  );
  invariant(
    binding["imageBuildEvidenceHash"] === directBinding["imageBuildEvidenceHash"] &&
      binding["imageBuildEvidencePayloadHash"] === directBinding["imageBuildEvidencePayloadHash"],
    "ALIGNMENT_RUNTIME_BINDING_IMAGE_BUILD_EVIDENCE_MISMATCH",
    label
  );
  invariant(binding["sourceTree"] === directBinding["sourceTree"], "ALIGNMENT_RUNTIME_BINDING_SOURCE_TREE_MISMATCH", label);
  const imageBuildPath = text(directBinding["imageBuildEvidencePath"], `${label}.runtimeBinding.imageBuildEvidencePath`);
  const imageBuildPointer = readHashedJson(root, imageBuildPath);
  invariant(
    binding["imageBuildEvidencePathHash"] === sha256(imageBuildPath),
    "ALIGNMENT_RUNTIME_BINDING_IMAGE_BUILD_PATH_HASH_MISMATCH",
    label
  );
  invariant(
    binding["imageBuildGeneratedAt"] === imageBuildPointer.document["generatedAt"],
    "ALIGNMENT_RUNTIME_BINDING_IMAGE_BUILD_TIME_MISMATCH",
    label
  );
  invariant(
    binding["sourceReportFileHash"] === directEvidence.sha256,
    "ALIGNMENT_RUNTIME_BINDING_SOURCE_REPORT_FILE_HASH_MISMATCH",
    label
  );
  invariant(
    binding["sourceReportEvidenceHash"] === directEvidence.document["evidenceHash"],
    "ALIGNMENT_RUNTIME_BINDING_SOURCE_REPORT_EVIDENCE_HASH_MISMATCH",
    label
  );
  invariant(
    binding["sourceReportPathHash"] === sha256(EVIDENCE_PATHS.direct),
    "ALIGNMENT_RUNTIME_BINDING_SOURCE_REPORT_PATH_HASH_MISMATCH",
    label
  );
  const observedAt = text(binding["observedAt"], `${label}.runtimeBinding.observedAt`);
  invariant(Number.isFinite(Date.parse(observedAt)), "ALIGNMENT_RUNTIME_BINDING_OBSERVED_AT_INVALID", label);
  invariant(observedAt === directBinding["observedAt"], "ALIGNMENT_RUNTIME_BINDING_OBSERVED_AT_MISMATCH", label);
}

function assertWsgsProcessBinding(
  root: string,
  document: JsonObject,
  label: string,
  expectedSourceCommit: string
): JsonObject {
  invariant(document["executionMode"] === "EXTERNAL_PROCESS", "ALIGNMENT_FORMAL_EXTERNAL_PROCESS_MODE_REQUIRED", label);
  const binding = object(document["wsgsProcessBinding"], `${label}.wsgsProcessBinding`);
  assertSchemaVersion(binding, "wsgs-external-process-binding/1.0", `${label}.wsgsProcessBinding`);
  invariant(binding["bindingStatus"] === "PASS", "ALIGNMENT_WSGS_PROCESS_BINDING_NOT_PASS", label);
  invariant(binding["executionMode"] === "EXTERNAL_PROCESS", "ALIGNMENT_WSGS_PROCESS_MODE_MISMATCH", label);
  invariant(binding["sourceCommit"] === expectedSourceCommit, "ALIGNMENT_WSGS_PROCESS_SOURCE_COMMIT_MISMATCH", label);
  invariant(binding["runtimeVersion"] === "0.2.1", "ALIGNMENT_WSGS_PROCESS_VERSION_MISMATCH", label);
  const sourceTree = text(binding["sourceTree"], `${label}.wsgsProcessBinding.sourceTree`);
  invariant(/^[0-9a-f]{40}$/u.test(sourceTree), "ALIGNMENT_WSGS_PROCESS_SOURCE_TREE_INVALID", label);
  const observedAt = text(binding["observedAt"], `${label}.wsgsProcessBinding.observedAt`);
  invariant(Number.isFinite(Date.parse(observedAt)), "ALIGNMENT_WSGS_PROCESS_OBSERVED_AT_INVALID", label);
  for (const field of [
    "composeProjectHash",
    "serviceSetHash",
    "apiEndpointHash",
    "gowmGatewayEndpointHash",
    "apiWorkerImageDigest",
    "databaseIdentityHash",
    "databaseServerAddressHash",
    "databaseServerVersionHash"
  ] as const) {
    digest(binding[field], `${label}.wsgsProcessBinding.${field}`);
  }
  const expectedServices = ["grounding-api", "grounding-worker", "postgres"];
  invariant(
    binding["serviceSetHash"] === canonicalSha256(expectedServices),
    "ALIGNMENT_WSGS_PROCESS_SERVICE_SET_HASH_MISMATCH",
    label
  );
  invariant(
      binding["distinctContainerCount"] === 3 &&
      binding["apiPortBindingVerified"] === true &&
      binding["containerCommandSetVerified"] === true &&
      binding["runtimeEnvironmentAgreementVerified"] === true &&
      binding["postgresConnectionVerified"] === true &&
      binding["isolatedDatabaseAttested"] === true &&
      binding["initialGroundingRowCount"] === 0,
    "ALIGNMENT_WSGS_PROCESS_ISOLATION_INCOMPLETE",
    label
  );
  const services = array(binding["services"], `${label}.wsgsProcessBinding.services`).map((entry, index) =>
    object(entry, `${label}.wsgsProcessBinding.services[${index}]`)
  );
  invariant(
    canonicalJson(services.map((service) => service["service"])) === canonicalJson(expectedServices),
    "ALIGNMENT_WSGS_PROCESS_SERVICE_SET_MISMATCH",
    label
  );
  const containerHashes = services.map((service, index) => {
    invariant(
      service["running"] === true && service["health"] === "healthy",
      "ALIGNMENT_WSGS_PROCESS_SERVICE_NOT_HEALTHY",
      `${label}:${expectedServices[index]}`
    );
    digest(service["imageDigest"], `${label}.wsgsProcessBinding.services[${index}].imageDigest`);
    return digest(
      service["containerIdentityHash"],
      `${label}.wsgsProcessBinding.services[${index}].containerIdentityHash`
    );
  });
  invariant(new Set(containerHashes).size === 3, "ALIGNMENT_WSGS_PROCESS_CONTAINERS_NOT_DISTINCT", label);
  invariant(
    services[0]?.["imageDigest"] === binding["apiWorkerImageDigest"] &&
      services[1]?.["imageDigest"] === binding["apiWorkerImageDigest"],
    "ALIGNMENT_WSGS_PROCESS_API_WORKER_IMAGE_MISMATCH",
    label
  );

  const imageBuild = object(
    binding["runtimeImageBuildEvidence"],
    `${label}.wsgsProcessBinding.runtimeImageBuildEvidence`
  );
  invariant(imageBuild["status"] === "PASS", "ALIGNMENT_WSGS_RUNTIME_IMAGE_BUILD_NOT_PASS", label);
  invariant(
    imageBuild["sourceCommit"] === expectedSourceCommit &&
      imageBuild["sourceTree"] === sourceTree &&
      imageBuild["runtimeVersion"] === "0.2.1" &&
      imageBuild["imageDigest"] === binding["apiWorkerImageDigest"],
    "ALIGNMENT_WSGS_RUNTIME_IMAGE_BUILD_BINDING_MISMATCH",
    label
  );
  const buildGeneratedAt = text(imageBuild["generatedAt"], `${label}.wsgsProcessBinding.runtimeImageBuildEvidence.generatedAt`);
  invariant(Number.isFinite(Date.parse(buildGeneratedAt)), "ALIGNMENT_WSGS_RUNTIME_IMAGE_BUILD_TIME_INVALID", label);
  const buildPointer = readHashedJson(root, EVIDENCE_PATHS.wsgsRuntimeImageBuild);
  const buildReport = buildPointer.document;
  assertSchemaVersion(buildReport, "wsgs-runtime-image-build/1.0", EVIDENCE_PATHS.wsgsRuntimeImageBuild);
  invariant(buildReport["status"] === "PASS", "ALIGNMENT_WSGS_RUNTIME_IMAGE_BUILD_NOT_PASS", label);
  invariant(
    buildReport["sourceCommit"] === expectedSourceCommit &&
      buildReport["sourceTree"] === sourceTree &&
      buildReport["runtimeVersion"] === "0.2.1" &&
      buildReport["imageDigest"] === binding["apiWorkerImageDigest"] &&
      buildReport["generatedAt"] === buildGeneratedAt &&
      buildReport["buildMethod"] === "DOCKER_BUILD_FROM_CLEAN_EXACT_GIT_TREE_WITH_OCI_LABELS" &&
      buildReport["sourceDirectoryIncluded"] === false,
    "ALIGNMENT_WSGS_RUNTIME_IMAGE_BUILD_REPORT_MISMATCH",
    label
  );
  invariant(
    imageBuild["reportFileHash"] === buildPointer.sha256 &&
      imageBuild["reportPayloadHash"] === buildReport["evidenceHash"] &&
      imageBuild["reportPathHash"] === sha256(EVIDENCE_PATHS.wsgsRuntimeImageBuild),
    "ALIGNMENT_WSGS_RUNTIME_IMAGE_BUILD_HASH_MISMATCH",
    label
  );

  const processPointer = readHashedJson(root, EVIDENCE_PATHS.wsgsProcessBinding);
  const processReport = processPointer.document;
  assertSchemaVersion(processReport, "wsgs-external-process-binding/1.0", EVIDENCE_PATHS.wsgsProcessBinding);
  const reportedBinding = { ...binding };
  delete reportedBinding["reportFileHash"];
  delete reportedBinding["reportEvidenceHash"];
  delete reportedBinding["reportPathHash"];
  const processReportPayload = { ...processReport };
  delete processReportPayload["evidenceHash"];
  invariant(
    canonicalJson(reportedBinding) === canonicalJson(processReportPayload),
    "ALIGNMENT_WSGS_PROCESS_REPORT_BINDING_MISMATCH",
    label
  );
  invariant(
    binding["reportFileHash"] === processPointer.sha256 &&
      binding["reportEvidenceHash"] === processReport["evidenceHash"] &&
      binding["reportPathHash"] === sha256(EVIDENCE_PATHS.wsgsProcessBinding),
    "ALIGNMENT_WSGS_PROCESS_REPORT_HASH_MISMATCH",
    label
  );
  const bindingHash = digest(binding["bindingHash"], `${label}.wsgsProcessBinding.bindingHash`);
  const bindingPreimage = { ...processReportPayload };
  delete bindingPreimage["bindingHash"];
  invariant(bindingHash === canonicalSha256(bindingPreimage), "ALIGNMENT_WSGS_PROCESS_BINDING_HASH_MISMATCH", label);
  invariant(document["wsgsProcessBindingHash"] === bindingHash, "ALIGNMENT_WSGS_PROCESS_TOP_LEVEL_HASH_MISMATCH", label);
  const redaction = object(binding["redaction"], `${label}.wsgsProcessBinding.redaction`);
  invariant(
    ["credentialsIncluded", "rawContainerIdsIncluded", "rawDatabaseIdentityIncluded", "internalTopologyIncluded", "localPathsIncluded"]
      .every((field) => redaction[field] === false),
    "ALIGNMENT_WSGS_PROCESS_REDACTION_MISMATCH",
    label
  );
  return binding;
}

function assertFivePassingRecipes(document: JsonObject, label: string): Map<string, JsonObject> {
  const summary = object(document["summary"], `${label}.summary`);
  invariant(integer(summary["total"], `${label}.summary.total`) === 5, "ALIGNMENT_RECIPE_TOTAL_MISMATCH", label);
  invariant(integer(summary["pass"], `${label}.summary.pass`) === 5, "ALIGNMENT_RECIPE_PASS_MISMATCH", label);
  for (const field of ["fail", "notRun", "blocked"] as const) {
    invariant(integer(summary[field], `${label}.summary.${field}`) === 0, "ALIGNMENT_RECIPE_NON_PASS_COUNT", `${label}:${field}`);
  }
  const cases = array(document["cases"] ?? document["recipes"], `${label}.cases`);
  invariant(cases.length === 5, "ALIGNMENT_RECIPE_CASE_COUNT_MISMATCH", label);
  const recipes = cases.map((entry, index) => {
    const recipe = object(entry, `${label}.cases[${index}]`);
    const id = text(recipe["caseId"] ?? recipe["recipeId"], `${label}.cases[${index}].id`);
    invariant(recipe["status"] === "PASS", "ALIGNMENT_RECIPE_CASE_NOT_PASS", `${label}:${id}`);
    return [id, recipe] as const;
  });
  const ids = recipes.map(([id]) => id);
  invariant(canonicalJson(ids) === canonicalJson(EXPECTED_RECIPE_IDS), "ALIGNMENT_RECIPE_ID_SET_MISMATCH", label);
  return new Map(recipes);
}

function validateStaticEvidence(evidence: Map<string, EvidenceDocument>): void {
  const baseline = evidence.get(EVIDENCE_PATHS.baseline)!.document;
  assertSchemaVersion(baseline, "wsgs-gowm-alignment-baseline/1.0", EVIDENCE_PATHS.baseline);
  const baselineWsgs = object(baseline["wsgs"], "baseline.wsgs");
  const baselineRuntime = object(baseline["gowmRuntime"], "baseline.gowmRuntime");
  const baselineGateway = object(baseline["gatewayContract"], "baseline.gatewayContract");
  invariant(baselineWsgs["commit"] === "c2a71a0f455c728ae45d70067f223e1450cfa427", "ALIGNMENT_WSGS_BASE_MISMATCH");
  invariant(baselineWsgs["version"] === "0.2.0" && baselineWsgs["targetVersion"] === "0.2.1", "ALIGNMENT_WSGS_VERSION_MISMATCH");
  invariant(baselineRuntime["commit"] === EXPECTED_RUNTIME_COMMIT, "ALIGNMENT_RUNTIME_COMMIT_MISMATCH", "baseline");
  invariant(baselineRuntime["version"] === EXPECTED_RUNTIME_VERSION, "ALIGNMENT_RUNTIME_VERSION_MISMATCH", "baseline");
  invariant(baselineGateway["packageName"] === EXPECTED_PACKAGE_NAME, "ALIGNMENT_GATEWAY_PACKAGE_MISMATCH", "baseline");
  invariant(baselineGateway["packageVersion"] === EXPECTED_PACKAGE_VERSION, "ALIGNMENT_GATEWAY_PACKAGE_MISMATCH", "baseline");
  invariant(baselineGateway["contractVersion"] === EXPECTED_GATEWAY_CONTRACT_VERSION, "ALIGNMENT_GATEWAY_CONTRACT_VERSION_MISMATCH", "baseline");

  const invariantReport = evidence.get(EVIDENCE_PATHS.invariant)!.document;
  assertSchemaVersion(
    invariantReport,
    "wsgs-gowm-runtime-contract-alignment-report/1.0",
    EVIDENCE_PATHS.invariant
  );
  const invariantValue = object(invariantReport["invariant"], "alignment-invariant-report.invariant");
  const exactSource = object(invariantReport["exactSourceVerification"], "alignment-invariant-report.exactSourceVerification");
  invariant(invariantValue["status"] === "PASS", "ALIGNMENT_INVARIANT_NOT_PASS");
  invariant(invariantValue["runtimeCommit"] === EXPECTED_RUNTIME_COMMIT, "ALIGNMENT_RUNTIME_COMMIT_MISMATCH", "invariant");
  invariant(invariantValue["runtimeVersion"] === EXPECTED_RUNTIME_VERSION, "ALIGNMENT_RUNTIME_VERSION_MISMATCH", "invariant");
  invariant(invariantValue["gatewayPackage"] === `${EXPECTED_PACKAGE_NAME}@${EXPECTED_PACKAGE_VERSION}`, "ALIGNMENT_GATEWAY_PACKAGE_MISMATCH", "invariant");
  invariant(invariantValue["gatewayContractVersion"] === EXPECTED_GATEWAY_CONTRACT_VERSION, "ALIGNMENT_GATEWAY_CONTRACT_VERSION_MISMATCH", "invariant");
  invariant(exactSource["status"] === "PASS" && exactSource["sourceCommit"] === EXPECTED_RUNTIME_COMMIT, "ALIGNMENT_EXACT_SOURCE_NOT_PASS");

  const negative = evidence.get(EVIDENCE_PATHS.negativeAlignment)!.document;
  assertSchemaVersion(negative, "wsgs-gowm-alignment-negative-cases/1.0", EVIDENCE_PATHS.negativeAlignment);
  const negativeCases = array(negative["cases"], "negative-cases-report.cases");
  invariant(integer(negative["count"], "negative-cases-report.count") === 9, "ALIGNMENT_NEGATIVE_CASE_COUNT_MISMATCH");
  invariant(negativeCases.length === 9, "ALIGNMENT_NEGATIVE_CASE_COUNT_MISMATCH");
  invariant(negativeCases.every((entry) => {
    const item = object(entry, "negative alignment case");
    return item["status"] === "PASS" && item["expectedCode"] === item["observedCode"];
  }), "ALIGNMENT_NEGATIVE_CASE_NOT_PASS");
  invariant(negativeCases.some((entry) => object(entry, "negative alignment case")["id"] === "version-conflation"), "ALIGNMENT_VERSION_CONFLATION_CASE_MISSING");

  const northbound = evidence.get(EVIDENCE_PATHS.northbound)!.document;
  assertSchemaVersion(northbound, "wsgs-northbound-compatibility-report/1.0", EVIDENCE_PATHS.northbound);
  invariant(northbound["contractVersion"] === EXPECTED_NORTHBOUND_CONTRACT, "ALIGNMENT_NORTHBOUND_VERSION_MISMATCH");
  invariant(northbound["changedByAlignment"] === false, "ALIGNMENT_NORTHBOUND_CHANGED");

  const intake = evidence.get(EVIDENCE_PATHS.intake)!.document;
  assertSchemaVersion(intake, "1.0", EVIDENCE_PATHS.intake);
  invariant(intake["sourceCommit"] === EXPECTED_RUNTIME_COMMIT, "ALIGNMENT_RUNTIME_COMMIT_MISMATCH", "intake");
  invariant(intake["packageIntegrity"] === EXPECTED_LOGICAL_INTEGRITY, "ALIGNMENT_LOGICAL_INTEGRITY_MISMATCH");
  const intakeChecks = new Map(array(intake["checks"], "contract-intake-report.checks").map((entry) => {
    const check = object(entry, "contract intake check");
    const id = text(check["id"], "contract intake check id");
    invariant(check["status"] === "PASS" && check["actual"] === check["expected"], "ALIGNMENT_INTAKE_CHECK_NOT_PASS", id);
    return [id, check] as const;
  }));
  const requiredIntakeChecks: Readonly<Record<string, string>> = {
    "tarball-bytes": EXPECTED_TARBALL_BYTES,
    "tarball-sha256": EXPECTED_TARBALL_SHA256,
    "tarball-sha512": EXPECTED_ARCHIVE_SRI,
    "package-identity": `${EXPECTED_PACKAGE_NAME}@${EXPECTED_PACKAGE_VERSION}`,
    "logical-package-integrity": EXPECTED_LOGICAL_INTEGRITY,
    "contract-catalog-revision": EXPECTED_CONTRACT_CATALOG_REVISION,
    "semantic-catalog-hash": EXPECTED_SEMANTIC_CATALOG_HASH,
    "southbound-lock-sha256": EXPECTED_SOUTHBOUND_RAW_SHA256.slice("sha256:".length),
    "manifest-raw-bytes-sha256": "62/62",
    "raw-crlf-materialization-count": "58",
    "materialization-tree-sha256": EXPECTED_MATERIALIZATION_TREE,
    "archive-extracted-materialization": "64 byte-identical files"
  };
  for (const [id, expected] of Object.entries(requiredIntakeChecks)) {
    invariant(intakeChecks.get(id)?.["actual"] === expected, "ALIGNMENT_INTAKE_CHECK_MISMATCH", id);
  }

  const diff = evidence.get(EVIDENCE_PATHS.contractDiff)!.document;
  assertSchemaVersion(diff, "wsgs-gowm-contract-diff-report/1.0", EVIDENCE_PATHS.contractDiff);
  const candidate = object(diff["candidate"], "contract-diff-report.candidate");
  const operationSet = object(diff["operationSet"], "contract-diff-report.operationSet");
  invariant(candidate["sourceCommit"] === EXPECTED_RUNTIME_COMMIT, "ALIGNMENT_RUNTIME_COMMIT_MISMATCH", "contract diff");
  invariant(candidate["lockHash"] === EXPECTED_SOUTHBOUND_RAW_SHA256, "ALIGNMENT_SOUTHBOUND_HASH_MISMATCH", "contract diff");
  invariant(operationSet["before"] === 120 && operationSet["after"] === 120 && operationSet["equality"] === "PASS", "ALIGNMENT_OPERATION_SET_DRIFT");
  invariant(diff["wireSchemaStability"] === "PASS" && diff["operationPolicyStability"] === "PASS", "ALIGNMENT_WIRE_POLICY_DRIFT");
  invariant(diff["semanticMigrationAllowlistExact"] === "PASS", "ALIGNMENT_SEMANTIC_ALLOWLIST_DRIFT");

  const migration = evidence.get(EVIDENCE_PATHS.semanticMigration)!.document;
  assertSchemaVersion(migration, "wsgs-gowm-semantic-migration-report/1.0", EVIDENCE_PATHS.semanticMigration);
  invariant(migration["declaredCount"] === 3 && migration["observedCount"] === 3, "ALIGNMENT_SEMANTIC_MIGRATION_COUNT_MISMATCH");
  invariant(migration["declaredEqualsObserved"] === true, "ALIGNMENT_SEMANTIC_MIGRATION_DRIFT");

  const authorities = evidence.get(EVIDENCE_PATHS.authorities)!.document;
  assertSchemaVersion(authorities, "wsgs-gowm-authority-inventory/1.0", EVIDENCE_PATHS.authorities);
  invariant(authorities["independentAuthorityCount"] === 1, "ALIGNMENT_MULTIPLE_UPSTREAM_AUTHORITIES");
  const authorityRecords = array(authorities["authoritative"], "w00-existing-authorities.authoritative");
  invariant(authorityRecords.length === 1, "ALIGNMENT_MULTIPLE_UPSTREAM_AUTHORITIES");
  const authority = object(authorityRecords[0], "w00-existing-authorities.authoritative[0]");
  invariant(authority["runtimeSourceCommit"] === EXPECTED_RUNTIME_COMMIT, "ALIGNMENT_RUNTIME_COMMIT_MISMATCH", "authority");
  invariant(authority["runtimeVersion"] === EXPECTED_RUNTIME_VERSION, "ALIGNMENT_RUNTIME_VERSION_MISMATCH", "authority");
  invariant(authority["gatewayContractVersion"] === EXPECTED_GATEWAY_CONTRACT_VERSION, "ALIGNMENT_GATEWAY_CONTRACT_VERSION_MISMATCH", "authority");
  invariant(authority["consumerPackageVersion"] === EXPECTED_PACKAGE_VERSION, "ALIGNMENT_GATEWAY_PACKAGE_MISMATCH", "authority");
}

function validateRuntimeEvidence(root: string, evidence: Map<string, EvidenceDocument>): void {
  const directEvidence = evidence.get(EVIDENCE_PATHS.direct)!;
  const direct = directEvidence.document;
  assertSchemaVersion(direct, "wsgs-gowm-direct-r1-r5-smoke/1.0", EVIDENCE_PATHS.direct);
  invariant(direct["marker"] === "DIRECT_GOWM_R1_R5_READY", "ALIGNMENT_DIRECT_MARKER_MISMATCH");
  invariant(direct["formalWsgsPipelineEvidence"] === false, "ALIGNMENT_DIRECT_FORMAL_CLASSIFICATION_INVALID");
  const directRuntime = object(direct["runtime"], "direct-r1-r5-smoke.runtime");
  const directWsgsSourceCommit = text(direct["wsgsSourceCommit"], "direct-r1-r5-smoke.wsgsSourceCommit");
  invariant(/^[0-9a-f]{40}$/u.test(directWsgsSourceCommit), "ALIGNMENT_DIRECT_WSGS_SOURCE_COMMIT_INVALID");
  assertRuntimeTuple(directRuntime, "direct-r1-r5-smoke");
  const directBinding = assertDirectRuntimeBinding(root, directRuntime, "direct-r1-r5-smoke");
  const directRecipes = assertFivePassingRecipes(direct, "direct-r1-r5-smoke");
  const directR1 = directRecipes.get("R1")!;
  const directR2 = directRecipes.get("R2")!;
  const directR3 = directRecipes.get("R3")!;
  const directR4 = directRecipes.get("R4")!;
  const directR5 = directRecipes.get("R5")!;
  const directR1Identity = digest(directR1["referenceIdentityHash"], "direct-r1-r5-smoke.R1.referenceIdentityHash");
  invariant(
    directR1["resolverOutputConsumedWithoutRewrite"] === true && directR1["validationCurrentAndUsable"] === true,
    "ALIGNMENT_DIRECT_R1_INCOMPLETE"
  );
  invariant(
    directR2["terminalStatus"] === "AMBIGUOUS" &&
      integer(directR2["candidateCount"], "direct-r1-r5-smoke.R2.candidateCount") >= 2 &&
      integer(directR2["spatialExecutionCount"], "direct-r1-r5-smoke.R2.spatialExecutionCount") === 0,
    "ALIGNMENT_DIRECT_R2_FAIL_CLOSED_INCOMPLETE"
  );
  digest(directR3["referenceIdentityHash"], "direct-r1-r5-smoke.R3.referenceIdentityHash");
  invariant(
    directR3["resolverOutputConsumedWithoutRewrite"] === true &&
      directR3["geometryOutputConsumedBySpatial"] === true &&
      integer(directR3["resultCount"], "direct-r1-r5-smoke.R3.resultCount") >= 1,
    "ALIGNMENT_DIRECT_R3_INCOMPLETE"
  );
  digest(directR4["referenceIdentityHash"], "direct-r1-r5-smoke.R4.referenceIdentityHash");
  invariant(
    directR4["resolverOutputConsumedWithoutRewrite"] === true &&
      directR4["radiusM"] === 1_000 &&
      integer(directR4["resultCount"], "direct-r1-r5-smoke.R4.resultCount") >= 1,
    "ALIGNMENT_DIRECT_R4_INCOMPLETE"
  );
  invariant(
    directR5["consumesR1ResolverOutput"] === true &&
      directR5["usable"] === true &&
      digest(directR5["referenceIdentityHash"], "direct-r1-r5-smoke.R5.referenceIdentityHash") === directR1Identity,
    "ALIGNMENT_DIRECT_R5_INCOMPLETE"
  );
  verifyDeclaredEvidenceHash(direct, EVIDENCE_PATHS.direct);

  const formal = evidence.get(EVIDENCE_PATHS.formal)!.document;
  assertSchemaVersion(formal, "wsgs-formal-pipeline-r1-r5/1.0", EVIDENCE_PATHS.formal);
  invariant(formal["marker"] === "WSGS_GOWM_FORMAL_PIPELINE_R1_R5_READY", "ALIGNMENT_FORMAL_MARKER_MISMATCH");
  invariant(formal["formalWsgsPipelineEvidence"] === true, "ALIGNMENT_FORMAL_CLASSIFICATION_INVALID");
  invariant(formal["focusedMode"] === true, "ALIGNMENT_FORMAL_FOCUSED_MODE_REQUIRED");
  assertRuntimeTuple(object(formal["runtime"], "formal-pipeline-r1-r5.runtime"), "formal-pipeline-r1-r5");
  assertFormalRuntimeBinding(root, formal, "formal-pipeline-r1-r5", directBinding, directEvidence);
  const formalProcessBinding = assertWsgsProcessBinding(
    root,
    formal,
    "formal-pipeline-r1-r5",
    directWsgsSourceCommit
  );
  const formalRealDependencies = object(formal["realDependencies"], "formal-pipeline-r1-r5.realDependencies");
  invariant(
    ["api", "postgres", "worker", "pipeline", "model", "gowmGateway", "independentProcesses"].every(
      (dependency) => formalRealDependencies[dependency] === true
    ),
    "ALIGNMENT_FORMAL_REAL_DEPENDENCIES_INCOMPLETE"
  );
  const formalRecipes = assertFivePassingRecipes(formal, "formal-pipeline-r1-r5");
  for (const recipeId of EXPECTED_RECIPE_IDS) {
    const recipe = formalRecipes.get(recipeId)!;
    digest(recipe["requestHash"], `formal-pipeline-r1-r5.${recipeId}.requestHash`);
    digest(recipe["groundingIdHash"], `formal-pipeline-r1-r5.${recipeId}.groundingIdHash`);
    digest(recipe["resultHash"], `formal-pipeline-r1-r5.${recipeId}.resultHash`);
    invariant(recipe["traceabilityStatus"] === "PASS", "ALIGNMENT_FORMAL_TRACEABILITY_NOT_PASS", recipeId);
  }
  const formalR1 = formalRecipes.get("R1")!;
  const formalR2 = formalRecipes.get("R2")!;
  const formalR3 = formalRecipes.get("R3")!;
  const formalR4 = formalRecipes.get("R4")!;
  const formalR5 = formalRecipes.get("R5")!;
  invariant(
    formalR1["terminalStatus"] === "COMPLETED" &&
      integer(formalR1["stageCount"], "formal-pipeline-r1-r5.R1.stageCount") === 14,
    "ALIGNMENT_FORMAL_R1_INCOMPLETE"
  );
  invariant(
    formalR2["terminalStatus"] === "AMBIGUOUS" &&
      integer(formalR2["worldQueryCount"], "formal-pipeline-r1-r5.R2.worldQueryCount") === 0 &&
      integer(formalR2["gatewayExecutionCount"], "formal-pipeline-r1-r5.R2.gatewayExecutionCount") === 0 &&
      integer(formalR2["spatialExecutionCount"], "formal-pipeline-r1-r5.R2.spatialExecutionCount") === 0,
    "ALIGNMENT_FORMAL_R2_FAIL_CLOSED_INCOMPLETE"
  );
  invariant(
    formalR3["terminalStatus"] === "COMPLETED" &&
      integer(formalR3["spatialExecutionCount"], "formal-pipeline-r1-r5.R3.spatialExecutionCount") >= 1 &&
      integer(formalR3["spatialResultCount"], "formal-pipeline-r1-r5.R3.spatialResultCount") >= 1,
    "ALIGNMENT_FORMAL_R3_INCOMPLETE"
  );
  invariant(
    formalR4["terminalStatus"] === "COMPLETED" &&
      formalR4["nearbyRadiusMetres"] === 1_000 &&
      integer(formalR4["spatialExecutionCount"], "formal-pipeline-r1-r5.R4.spatialExecutionCount") >= 1,
    "ALIGNMENT_FORMAL_R4_INCOMPLETE"
  );
  invariant(
    formalR5["terminalStatus"] === "COMPLETED" &&
      integer(formalR5["stageCount"], "formal-pipeline-r1-r5.R5.stageCount") === 3 &&
      integer(formalR5["worldQueryCount"], "formal-pipeline-r1-r5.R5.worldQueryCount") === 0 &&
      integer(formalR5["gatewayExecutionCount"], "formal-pipeline-r1-r5.R5.gatewayExecutionCount") === 0,
    "ALIGNMENT_FORMAL_R5_INCOMPLETE"
  );
  for (const recipeId of ["R1", "R3", "R4", "R5"] as const) {
    const recipe = formalRecipes.get(recipeId)!;
    const referenceIdentity = object(recipe["referenceIdentity"], `formal-pipeline-r1-r5.${recipeId}.referenceIdentity`);
    const validationLease = object(recipe["validationLease"], `formal-pipeline-r1-r5.${recipeId}.validationLease`);
    invariant(
      referenceIdentity["applicable"] === true && referenceIdentity["preserved"] === true &&
        validationLease["applicable"] === true && validationLease["usable"] === true,
      "ALIGNMENT_FORMAL_REFERENCE_PROOF_INCOMPLETE",
      recipeId
    );
  }
  verifyDeclaredEvidenceHash(formal, EVIDENCE_PATHS.formal);

  const identity = evidence.get(EVIDENCE_PATHS.referenceIdentity)!.document;
  assertSchemaVersion(identity, "wsgs-reference-identity-report/1.0", EVIDENCE_PATHS.referenceIdentity);
  verifyDeclaredEvidenceHash(identity, EVIDENCE_PATHS.referenceIdentity);
  const identityRecipes = array(identity["recipes"] ?? identity["cases"], "reference-identity-report.recipes");
  const identityByRecipe = new Map(identityRecipes.map((entry, index) => {
    const recipe = object(entry, `reference-identity-report.recipes[${index}]`);
    invariant(recipe["status"] === "PASS", "ALIGNMENT_REFERENCE_IDENTITY_NOT_PASS");
    invariant(recipe["identityPreserved"] === true, "ALIGNMENT_REFERENCE_IDENTITY_REWRITTEN");
    invariant(recipe["validationLeaseUsable"] === true, "ALIGNMENT_REFERENCE_IDENTITY_LEASE_NOT_USABLE");
    const recipeId = text(recipe["recipeId"] ?? recipe["caseId"], "reference identity recipe id");
    const referenceIdentityHash = digest(
      recipe["referenceIdentityHash"],
      `reference-identity-report.${recipeId}.referenceIdentityHash`
    );
    const layers = object(recipe["layers"], `reference-identity-report.${recipeId}.layers`);
    let observedLayerHashes = 0;
    for (const [layerName, value] of Object.entries(layers)) {
      for (const layerHash of array(value, `reference-identity-report.${recipeId}.layers.${layerName}`)) {
        invariant(
          digest(layerHash, `reference-identity-report.${recipeId}.layers.${layerName}`) === referenceIdentityHash,
          "ALIGNMENT_REFERENCE_IDENTITY_LAYER_MISMATCH",
          `${recipeId}:${layerName}`
        );
        observedLayerHashes += 1;
      }
    }
    invariant(observedLayerHashes >= 2, "ALIGNMENT_REFERENCE_IDENTITY_LAYER_EVIDENCE_INCOMPLETE", recipeId);
    if (recipeId === "R5") {
      invariant(recipe["consumesR1PersistedResolverOutput"] === true, "ALIGNMENT_R1_R5_HANDOFF_NOT_CONSUMED");
    }
    return [recipeId, { recipe, referenceIdentityHash }] as const;
  }));
  const identityIds = [...identityByRecipe.keys()];
  invariant(canonicalJson(identityIds) === canonicalJson(["R1", "R3", "R4", "R5"]), "ALIGNMENT_REFERENCE_IDENTITY_RECIPE_SET_MISMATCH");
  const r1ToR5 = object(identity["r1ToR5"], "reference-identity-report.r1ToR5");
  const r1Hash = identityByRecipe.get("R1")?.referenceIdentityHash;
  const r5Hash = identityByRecipe.get("R5")?.referenceIdentityHash;
  invariant(r1Hash !== undefined && r1Hash === r5Hash, "ALIGNMENT_R1_R5_REFERENCE_IDENTITY_MISMATCH");
  invariant(
    r1ToR5["status"] === "PASS" &&
      r1ToR5["referenceIdentityHash"] === r1Hash &&
      r1ToR5["persistedCheckpointHandoff"] === true &&
      r1ToR5["knownWorldReferenceConsumed"] === true &&
      r1ToR5["leaseCarriedAndRevalidated"] === true,
    "ALIGNMENT_R1_R5_HANDOFF_PROOF_INCOMPLETE"
  );

  const negative = evidence.get(EVIDENCE_PATHS.referenceNegative)!.document;
  assertSchemaVersion(negative, "wsgs-reference-negative-cases/1.0", EVIDENCE_PATHS.referenceNegative);
  verifyDeclaredEvidenceHash(negative, EVIDENCE_PATHS.referenceNegative);
  const negativeCases = array(negative["cases"], "reference-negative-cases.cases");
  invariant(negativeCases.length === 1, "ALIGNMENT_R2_NEGATIVE_CASE_COUNT_MISMATCH");
  const r2 = object(negativeCases[0], "reference-negative-cases.cases[0]");
  invariant(r2["status"] === "PASS", "ALIGNMENT_R2_NEGATIVE_NOT_PASS");
  invariant(r2["recipeId"] === "R2" && r2["terminalStatus"] === "AMBIGUOUS", "ALIGNMENT_R2_TERMINAL_STATUS_MISMATCH");
  invariant(
    integer(r2["ambiguityCount"], "reference-negative-cases.R2.ambiguityCount") >= 1 &&
      integer(r2["candidateCount"], "reference-negative-cases.R2.candidateCount") >= 2,
    "ALIGNMENT_R2_AMBIGUITY_EVIDENCE_INCOMPLETE"
  );
  const downstreamCounts = object(r2["downstreamCounts"], "reference-negative-cases.cases[0].downstreamCounts");
  invariant(
    Object.values(downstreamCounts).length === 5 && Object.values(downstreamCounts).every((count) => count === 0),
    "ALIGNMENT_R2_DOWNSTREAM_EXECUTION_OCCURRED"
  );

  const composability = evidence.get(EVIDENCE_PATHS.r3Composability)!.document;
  assertSchemaVersion(composability, "wsgs-reference-composability-r3/1.0", EVIDENCE_PATHS.r3Composability);
  verifyDeclaredEvidenceHash(composability, EVIDENCE_PATHS.r3Composability);
  invariant(composability["recipeId"] === "R3" && composability["status"] === "PASS", "ALIGNMENT_R3_COMPOSABILITY_NOT_PASS");
  const identityLayers = object(composability["identityLayers"], "reference-composability-r3.identityLayers");
  const r3IdentityHash = digest(composability["referenceIdentityHash"], "reference-composability-r3.referenceIdentityHash");
  const layerHashes = Object.values(identityLayers).flatMap((value, index) =>
    array(value, `reference-composability-r3.identityLayers[${index}]`).map((entry) => digest(entry, "R3 identity hash"))
  );
  invariant(
    layerHashes.length >= 4 && layerHashes.every((hash) => hash === r3IdentityHash),
    "ALIGNMENT_R3_REFERENCE_KEY_REWRITTEN"
  );
  invariant(composability["validationLeaseUsable"] === true, "ALIGNMENT_R3_VALIDATION_LEASE_NOT_USABLE");
  const operationKeys = [...new Set(
    array(composability["operationKeys"], "reference-composability-r3.operationKeys")
      .map((entry) => text(entry, "reference-composability-r3.operationKey"))
  )].sort();
  invariant(
    canonicalJson(operationKeys) === canonicalJson([
      "reference.resolve@1.0",
      "reference.validate@1.0",
      "spatial.find-in-area@1.0",
      "world.get-geometry@1.0"
    ].sort()),
    "ALIGNMENT_R3_OPERATION_SET_MISMATCH"
  );
  invariant(
    array(composability["dataflowBindings"], "reference-composability-r3.dataflowBindings").length >= 2,
    "ALIGNMENT_R3_DATAFLOW_BINDINGS_INCOMPLETE"
  );
  invariant(
    composability["resolverOutputConsumedByValidation"] === true &&
      composability["resolverOutputConsumedByGeometry"] === true &&
      composability["geometryOutputConsumedBySpatial"] === true,
    "ALIGNMENT_R3_DATAFLOW_NOT_COMPOSABLE"
  );
  invariant(
    integer(composability["spatialExecutionCount"], "R3 spatialExecutionCount") >= 1 &&
      integer(composability["spatialResultCount"], "R3 spatialResultCount") >= 1,
    "ALIGNMENT_R3_SPATIAL_QUERY_NOT_COMPLETE"
  );

  const traceability = evidence.get(EVIDENCE_PATHS.traceability)!.document;
  assertSchemaVersion(traceability, "wsgs-pipeline-traceability/1.0", EVIDENCE_PATHS.traceability);
  verifyDeclaredEvidenceHash(traceability, EVIDENCE_PATHS.traceability);
  assertFormalRuntimeBinding(root, traceability, "pipeline-traceability", directBinding, directEvidence);
  const traceProcessBinding = assertWsgsProcessBinding(
    root,
    traceability,
    "pipeline-traceability",
    directWsgsSourceCommit
  );
  invariant(
    canonicalJson(traceProcessBinding) === canonicalJson(formalProcessBinding),
    "ALIGNMENT_WSGS_PROCESS_BINDING_CROSS_REPORT_MISMATCH"
  );
  const expectedPath = ["PUBLIC_API", "POSTGRES", "WORKER", "PRODUCTION_PIPELINE", "GOWM_GATEWAY", "POSTGRES_PERSIST", "PUBLIC_API_GET"];
  invariant(canonicalJson(traceability["executionPath"]) === canonicalJson(expectedPath), "ALIGNMENT_TRACEABILITY_STAGE_SET_MISMATCH");
  invariant(canonicalJson(formal["executionPath"]) === canonicalJson(expectedPath), "ALIGNMENT_FORMAL_EXECUTION_PATH_MISMATCH");
  const traceCases = array(traceability["cases"], "pipeline-traceability.cases");
  const traceIds = traceCases.map((entry, index) => {
    const traceCase = object(entry, `pipeline-traceability.cases[${index}]`);
    invariant(traceCase["status"] === "PASS", "ALIGNMENT_TRACEABILITY_CASE_NOT_PASS");
    const trace = object(traceCase["traceability"], `pipeline-traceability.cases[${index}].traceability`);
    const api = object(trace["api"], `pipeline-traceability.cases[${index}].api`);
    const postgres = object(trace["postgres"], `pipeline-traceability.cases[${index}].postgres`);
    const worker = object(trace["worker"], `pipeline-traceability.cases[${index}].worker`);
    const pipeline = object(trace["pipeline"], `pipeline-traceability.cases[${index}].pipeline`);
    const gateway = object(trace["gateway"], `pipeline-traceability.cases[${index}].gateway`);
    const persistence = object(trace["persistence"], `pipeline-traceability.cases[${index}].persistence`);
    invariant(trace["status"] === "PASS", "ALIGNMENT_TRACEABILITY_CASE_NOT_PASS");
    invariant(api["postHttpStatus"] === 202 && api["getHttpStatus"] === 200, "ALIGNMENT_TRACEABILITY_API_MISMATCH");
    digest(api["requestHash"], `pipeline-traceability.${index}.api.requestHash`);
    for (const field of ["requestPayloadHash", "checkpointStateHash", "resultBytesHash", "resultHash"] as const) {
      digest(postgres[field], `pipeline-traceability.${index}.postgres.${field}`);
    }
    invariant(
      worker["outcome"] === "SUCCEEDED" && integer(worker["generationCount"], `pipeline-traceability.${index}.worker.generationCount`) >= 1,
      "ALIGNMENT_TRACEABILITY_WORKER_MISMATCH"
    );
    invariant(pipeline["eventChainValid"] === true && pipeline["stageOutputsMatchCheckpoint"] === true, "ALIGNMENT_TRACEABILITY_PIPELINE_MISMATCH");
    invariant(
      integer(pipeline["expectedStageCount"], `pipeline-traceability.${index}.pipeline.expectedStageCount`) >= 1 &&
        integer(pipeline["terminalEventCount"], `pipeline-traceability.${index}.pipeline.terminalEventCount`) >= 1 &&
        integer(pipeline["eventRecordCount"], `pipeline-traceability.${index}.pipeline.eventRecordCount`) >= 1,
      "ALIGNMENT_TRACEABILITY_PIPELINE_COUNTS_INVALID"
    );
    text(pipeline["checkpointLastCompletedStage"], `pipeline-traceability.${index}.pipeline.checkpointLastCompletedStage`);
    digest(pipeline["finalRecordHash"], `pipeline-traceability.${index}.pipeline.finalRecordHash`);
    invariant(
      integer(gateway["persistedWorldQueryCount"], `pipeline-traceability.${index}.gateway.persistedWorldQueryCount`) >= 0 &&
        integer(gateway["persistedExecutionCount"], `pipeline-traceability.${index}.gateway.persistedExecutionCount`) >= 0 &&
        gateway["planHashesMatchCheckpoint"] === true && gateway["upstreamHashesMatchCheckpoint"] === true,
      "ALIGNMENT_TRACEABILITY_GATEWAY_MISMATCH"
    );
    invariant(
      text(persistence["jobStatus"], `pipeline-traceability.${index}.persistence.jobStatus`).length > 0 &&
        persistence["getMatchesPersistedResult"] === true,
      "ALIGNMENT_TRACEABILITY_PERSISTENCE_MISMATCH"
    );
    return text(traceCase["recipeId"], "pipeline traceability recipe id");
  });
  invariant(canonicalJson(traceIds) === canonicalJson(EXPECTED_RECIPE_IDS), "ALIGNMENT_TRACEABILITY_RECIPE_SET_MISMATCH");

  const formalSourceCommit = text(formal["sourceCommit"], "formal-pipeline-r1-r5.sourceCommit");
  invariant(/^[0-9a-f]{40}$/u.test(formalSourceCommit), "ALIGNMENT_FORMAL_SOURCE_COMMIT_INVALID");
  invariant(formalSourceCommit === directWsgsSourceCommit, "ALIGNMENT_WSGS_SOURCE_COMMIT_CROSS_GATE_MISMATCH");
  const wsgsSourceBinding = object(formal["wsgsSourceBinding"], "formal-pipeline-r1-r5.wsgsSourceBinding");
  invariant(
      wsgsSourceBinding["status"] === "PASS" &&
      wsgsSourceBinding["headCommit"] === formalSourceCommit &&
      wsgsSourceBinding["evidenceSourceCommit"] === formalSourceCommit &&
      wsgsSourceBinding["sourceTree"] === formalProcessBinding["sourceTree"] &&
      wsgsSourceBinding["trackedSourceClean"] === true &&
      wsgsSourceBinding["verification"] === "GIT_HEAD_AND_TRACKED_DIFF",
    "ALIGNMENT_FORMAL_WSGS_SOURCE_BINDING_MISMATCH"
  );
  invariant(
    canonicalJson(traceability["wsgsSourceBinding"]) === canonicalJson(wsgsSourceBinding),
    "ALIGNMENT_TRACEABILITY_WSGS_SOURCE_BINDING_MISMATCH"
  );
  const formalObservedAt = text(formal["observedAt"], "formal-pipeline-r1-r5.observedAt");
  invariant(Number.isFinite(Date.parse(formalObservedAt)), "ALIGNMENT_FORMAL_OBSERVED_AT_INVALID");
  for (const [path, document] of [
    [EVIDENCE_PATHS.referenceIdentity, identity],
    [EVIDENCE_PATHS.referenceNegative, negative],
    [EVIDENCE_PATHS.r3Composability, composability],
    [EVIDENCE_PATHS.traceability, traceability]
  ] as const) {
    invariant(document["sourceCommit"] === formalSourceCommit, "ALIGNMENT_FORMAL_SOURCE_COMMIT_DRIFT", path);
    invariant(document["observedAt"] === formalObservedAt, "ALIGNMENT_FORMAL_OBSERVED_AT_DRIFT", path);
    invariant(document["runtimeBindingHash"] === directBinding["bindingHash"], "ALIGNMENT_FORMAL_RUNTIME_BINDING_DRIFT", path);
  }
}

function validateHandoff(root: string, evidence: Map<string, EvidenceDocument>): void {
  const verification = evidence.get(EVIDENCE_PATHS.handoff)!.document;
  assertSchemaVersion(verification, "wsgs-gowm-handoff-verification/1.0", EVIDENCE_PATHS.handoff);
  invariant(verification["handoffPath"] === EVIDENCE_PATHS.handoffContract, "ALIGNMENT_HANDOFF_PATH_MISMATCH");
  invariant(verification["schemaValidationStatus"] === "PASS", "ALIGNMENT_HANDOFF_SCHEMA_NOT_VALIDATED");
  invariant(verification["handoffStatus"] === "DEVELOPMENT_READY", "ALIGNMENT_HANDOFF_STATUS_MISMATCH");
  invariant(verification["productionQualified"] === false, "ALIGNMENT_PRODUCTION_QUALIFICATION_ESCALATED");
  invariant(verification["marker"] === "WSGS_GOWM_HANDOFF_ALIGNMENT_VERIFIED", "ALIGNMENT_HANDOFF_MARKER_MISMATCH");
  const checks = object(verification["checks"], "handoff-verification.checks");
  invariant(
    ["schema", "exactTuple", "alignmentRecipes", "productionBoundary", "wsgsSourceBinding"].every(
      (check) => checks[check] === "PASS"
    ),
    "ALIGNMENT_HANDOFF_VERIFICATION_INCOMPLETE"
  );

  const handoffFile = resolveRepoFile(root, EVIDENCE_PATHS.handoffContract, EVIDENCE_PATHS.handoffContract);
  invariant(existsSync(handoffFile), "ALIGNMENT_CLOSURE_EVIDENCE_MISSING", EVIDENCE_PATHS.handoffContract);
  const handoffBytes = readFileSync(handoffFile);
  assertNoSecretMaterial(handoffBytes, EVIDENCE_PATHS.handoffContract);
  let parsedHandoff: unknown;
  try {
    parsedHandoff = JSON.parse(handoffBytes.toString("utf8")) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail("ALIGNMENT_CLOSURE_EVIDENCE_INVALID_JSON", `${EVIDENCE_PATHS.handoffContract}:${detail}`);
  }
  const handoff = object(parsedHandoff, EVIDENCE_PATHS.handoffContract);
  invariant(verification["handoffFileHash"] === sha256(handoffBytes), "ALIGNMENT_HANDOFF_FILE_HASH_MISMATCH");
  invariant(
    verification["handoffCanonicalPayloadHash"] === canonicalSha256(handoff),
    "ALIGNMENT_HANDOFF_PAYLOAD_HASH_MISMATCH"
  );
  invariant(handoff["schemaVersion"] === "1.0" && handoff["status"] === "DEVELOPMENT_READY", "ALIGNMENT_HANDOFF_STATUS_MISMATCH");
  invariant(handoff["productionQualified"] === false, "ALIGNMENT_PRODUCTION_QUALIFICATION_ESCALATED");
  const wsgs = object(handoff["wsgs"], "handoff.wsgs");
  const handoffWsgsCommit = text(wsgs["commit"], "handoff.wsgs.commit");
  invariant(/^[0-9a-f]{40}$/u.test(handoffWsgsCommit), "ALIGNMENT_HANDOFF_WSGS_COMMIT_INVALID");
  invariant(wsgs["version"] === "0.2.1", "ALIGNMENT_HANDOFF_WSGS_VERSION_MISMATCH");
  const direct = evidence.get(EVIDENCE_PATHS.direct)!.document;
  const formal = evidence.get(EVIDENCE_PATHS.formal)!.document;
  invariant(
    handoffWsgsCommit === direct["wsgsSourceCommit"] && handoffWsgsCommit === formal["sourceCommit"],
    "ALIGNMENT_HANDOFF_WSGS_SOURCE_COMMIT_MISMATCH"
  );
  const wsgsSourceBinding = object(verification["wsgsSourceBinding"], "handoff-verification.wsgsSourceBinding");
  invariant(
    wsgsSourceBinding["status"] === "PASS" &&
      wsgsSourceBinding["sourceCommit"] === handoffWsgsCommit &&
      wsgsSourceBinding["verification"] === "DECLARED_HANDOFF_SOURCE_COMMIT_FOR_CLOSURE_CROSS_VALIDATION",
    "ALIGNMENT_HANDOFF_WSGS_SOURCE_BINDING_MISMATCH"
  );
  const northbound = object(handoff["northboundContract"], "handoff.northboundContract");
  invariant(northbound["id"] === EXPECTED_NORTHBOUND_CONTRACT, "ALIGNMENT_HANDOFF_NORTHBOUND_MISMATCH");
  digest(northbound["hash"], "handoff.northboundContract.hash");
  const gowm = object(handoff["gowm"], "handoff.gowm");
  assertRuntimeTuple({
    sourceCommit: gowm["sourceCommit"],
    runtimeVersion: gowm["runtimeVersion"],
    gatewayContractVersion: gowm["gatewayContractVersion"],
    consumerPackage: gowm["consumerPackage"]
  }, "handoff.gowm");
  invariant(gowm["contractCatalogRevision"] === EXPECTED_CONTRACT_CATALOG_REVISION, "ALIGNMENT_CONTRACT_CATALOG_MISMATCH", "handoff");
  invariant(gowm["semanticCatalogHash"] === EXPECTED_SEMANTIC_CATALOG_HASH, "ALIGNMENT_SEMANTIC_CATALOG_MISMATCH", "handoff");
  const exactTuple = object(verification["exactTuple"], "handoff-verification.exactTuple");
  invariant(canonicalJson(exactTuple) === canonicalJson(gowm), "ALIGNMENT_HANDOFF_TUPLE_REPORT_MISMATCH");
  const recipes = array(handoff["alignmentValidatedRecipes"], "handoff.alignmentValidatedRecipes");
  invariant(canonicalJson(recipes) === canonicalJson(EXPECTED_RECIPE_IDS), "ALIGNMENT_HANDOFF_RECIPE_SET_MISMATCH");
  invariant(
    canonicalJson(verification["alignmentValidatedRecipes"]) === canonicalJson(recipes),
    "ALIGNMENT_HANDOFF_RECIPE_REPORT_MISMATCH"
  );
}

export function verifyPrReviewArtifact(root: string, prReview: JsonObject): void {
  invariant(prReview["draft"] === true, "ALIGNMENT_PR_NOT_DRAFT");
  invariant(prReview["productionQualified"] === false, "ALIGNMENT_PR_PRODUCTION_CLAIM");
  invariant(prReview["bodyPath"] === EVIDENCE_PATHS.prBody, "ALIGNMENT_PR_BODY_PATH_MISMATCH");
  const prBodyPath = resolveRepoFile(root, EVIDENCE_PATHS.prBody, EVIDENCE_PATHS.prBody);
  invariant(existsSync(prBodyPath), "ALIGNMENT_CLOSURE_EVIDENCE_MISSING", EVIDENCE_PATHS.prBody);
  const prBodyBytes = readFileSync(prBodyPath);
  assertNoSecretMaterial(prBodyBytes, EVIDENCE_PATHS.prBody);
  const prBody = prBodyBytes.toString("utf8");
  invariant(Buffer.from(prBody, "utf8").equals(prBodyBytes), "ALIGNMENT_PR_BODY_NOT_UTF8");
  const canonicalPrBody = prBody.replace(/\r\n?/gu, "\n");
  invariant(prReview["bodyHash"] === sha256(prBodyBytes), "ALIGNMENT_PR_BODY_RAW_HASH_MISMATCH");
  invariant(
    prReview["bodyCanonicalHash"] === sha256(canonicalPrBody),
    "ALIGNMENT_PR_BODY_CANONICAL_HASH_MISMATCH"
  );
  const evidencePaths = array(prReview["evidencePaths"], "pr-review.evidencePaths");
  for (const required of [
    EVIDENCE_PATHS.direct,
    EVIDENCE_PATHS.runtimeBinding,
    EVIDENCE_PATHS.runtimeImageBuild,
    EVIDENCE_PATHS.formal,
    EVIDENCE_PATHS.wsgsProcessBinding,
    EVIDENCE_PATHS.wsgsRuntimeImageBuild,
    EVIDENCE_PATHS.traceability,
    OUTPUT_PATHS.closure
  ]) {
    invariant(evidencePaths.includes(required), "ALIGNMENT_PR_EVIDENCE_PATH_MISSING", required);
    invariant(canonicalPrBody.includes(required), "ALIGNMENT_PR_BODY_EVIDENCE_PATH_MISSING", required);
  }
  const reportedNonClaims = array(prReview["nonClaims"], "pr-review.nonClaims")
    .map((entry) => text(entry, "pr-review.nonClaim"));
  for (const nonClaim of reportedNonClaims) {
    invariant(canonicalPrBody.includes(nonClaim), "ALIGNMENT_PR_BODY_NON_CLAIM_MISMATCH", nonClaim);
  }
  const nonClaims = reportedNonClaims.join(" ").toLowerCase();
  for (const required of ["development readiness only", "production qualification", "release", "deployment", "shared-runtime mutation"]) {
    invariant(nonClaims.includes(required), "ALIGNMENT_PR_NON_CLAIM_MISSING", required);
  }
}

function validateClosurePreconditions(root: string, evidence: Map<string, EvidenceDocument>): void {
  const directSourceCommit = text(
    evidence.get(EVIDENCE_PATHS.direct)!.document["wsgsSourceCommit"],
    "direct-r1-r5-smoke.wsgsSourceCommit"
  );
  const formalSourceCommit = text(
    evidence.get(EVIDENCE_PATHS.formal)!.document["sourceCommit"],
    "formal-pipeline-r1-r5.sourceCommit"
  );
  invariant(directSourceCommit === formalSourceCommit, "ALIGNMENT_WSGS_SOURCE_COMMIT_CROSS_GATE_MISMATCH");
  const repositoryCheck = evidence.get(EVIDENCE_PATHS.repositoryCheck)!.document;
  assertSchemaVersion(repositoryCheck, "wsgs-gowm-repository-check/1.0", EVIDENCE_PATHS.repositoryCheck);
  verifyDeclaredEvidenceHash(repositoryCheck, EVIDENCE_PATHS.repositoryCheck);
  invariant(repositoryCheck["command"] === "npm run check", "ALIGNMENT_REPOSITORY_CHECK_COMMAND_MISMATCH");
  invariant(repositoryCheck["exitCode"] === 0, "ALIGNMENT_REPOSITORY_CHECK_NOT_PASS");
  invariant(
    repositoryCheck["sourceCommit"] === directSourceCommit,
    "ALIGNMENT_REPOSITORY_CHECK_SOURCE_COMMIT_MISMATCH"
  );
  invariant(repositoryCheck["gowmSourceCommit"] === EXPECTED_RUNTIME_COMMIT, "ALIGNMENT_REPOSITORY_CHECK_GOWM_SOURCE_MISMATCH");
  invariant(repositoryCheck["alignmentExactSourceVerification"] === "PASS", "ALIGNMENT_REPOSITORY_CHECK_EXACT_SOURCE_NOT_PASS");
  invariant(
    /^sha256:[0-9a-f]{64}$/u.test(text(repositoryCheck["gowmSourceDirectoryHash"], "repository-check.gowmSourceDirectoryHash")),
    "ALIGNMENT_REPOSITORY_CHECK_GOWM_SOURCE_DIRECTORY_HASH_INVALID"
  );

  const deliveryScan = evidence.get(EVIDENCE_PATHS.deliveryScan)!.document;
  assertSchemaVersion(deliveryScan, "wsgs-gowm-delivery-scan/1.0", EVIDENCE_PATHS.deliveryScan);
  verifyDeclaredEvidenceHash(deliveryScan, EVIDENCE_PATHS.deliveryScan);
  invariant(deliveryScan["sourceCommit"] === directSourceCommit, "ALIGNMENT_DELIVERY_SCAN_SOURCE_COMMIT_MISMATCH");
  invariant(deliveryScan["secretsFound"] === 0, "ALIGNMENT_DELIVERY_SECRETS_FOUND");
  invariant(deliveryScan["generatedDrift"] === false, "ALIGNMENT_GENERATED_DRIFT_FOUND");
  invariant(deliveryScan["credentialsIncluded"] === false, "ALIGNMENT_DELIVERY_CREDENTIALS_INCLUDED");

  const prReview = evidence.get(EVIDENCE_PATHS.prReview)!.document;
  assertSchemaVersion(prReview, "wsgs-gowm-pr-review/1.0", EVIDENCE_PATHS.prReview);
  verifyDeclaredEvidenceHash(prReview, EVIDENCE_PATHS.prReview);
  verifyPrReviewArtifact(root, prReview);
}

function buildEvidenceMap(root: string): Map<string, EvidenceDocument> {
  const statusesByPath = new Map<string, readonly string[]>();
  const uniquePaths = [...new Set(Object.values(CRITERION_EVIDENCE).flat())];
  const evidence = new Map<string, EvidenceDocument>();
  for (const relativePath of uniquePaths) {
    evidence.set(relativePath, readEvidence(root, relativePath, statusesByPath.get(relativePath)));
  }
  validateStaticEvidence(evidence);
  validateRuntimeEvidence(root, evidence);
  validateHandoff(root, evidence);
  validateClosurePreconditions(root, evidence);
  return evidence;
}

function buildCriterionResults(rows: AcceptanceRow[], evidence: Map<string, EvidenceDocument>): CriterionResult[] {
  return rows.map((row) => {
    const paths = CRITERION_EVIDENCE[row.id];
    invariant(paths !== undefined, "ALIGNMENT_ACCEPTANCE_EVIDENCE_MAPPING_MISSING", row.id);
    const pointers = paths.map((path): EvidencePointer => {
      const item = evidence.get(path);
      invariant(item !== undefined, "ALIGNMENT_CLOSURE_EVIDENCE_MISSING", path);
      return { path: item.path, sha256: item.sha256, status: item.status };
    });
    if (row.id === "ALIGN-020" || row.id === "ALIGN-021") {
      const handoffVerification = evidence.get(EVIDENCE_PATHS.handoff)!.document;
      pointers.unshift({
        path: EVIDENCE_PATHS.handoffContract,
        sha256: digest(handoffVerification["handoffFileHash"], "handoff-verification.handoffFileHash"),
        status: text(handoffVerification["handoffStatus"], "handoff-verification.handoffStatus")
      });
    }
    if (row.id === "ALIGN-024") {
      const prReview = evidence.get(EVIDENCE_PATHS.prReview)!.document;
      pointers.unshift({
        path: EVIDENCE_PATHS.prBody,
        sha256: digest(prReview["bodyHash"], "pr-review.bodyHash"),
        status: "REVIEWED"
      });
    }
    return {
      id: row.id,
      phase: row.phase,
      requirement: row.requirement,
      gate: row.gate,
      declaredEvidence: row.evidence,
      blocking: true,
      status: "PASS",
      evidence: pointers,
      evidenceHash: canonicalSha256({ id: row.id, declaredEvidence: row.evidence, evidence: pointers })
    };
  });
}

function buildOutputs(
  acceptanceHash: `sha256:${string}`,
  criteria: CriterionResult[],
  evidence: Map<string, EvidenceDocument>
): { closure: JsonObject; readiness: string; ledger: JsonObject } {
  const ledgerPayload: JsonObject = {
    schemaVersion: "wsgs-gowm-alignment-ledger/1.0",
    status: "PASS",
    decision: "DEVELOPMENT_READY",
    productionQualified: false,
    runtime: {
      sourceCommit: EXPECTED_RUNTIME_COMMIT,
      runtimeVersion: EXPECTED_RUNTIME_VERSION,
      gatewayContractVersion: EXPECTED_GATEWAY_CONTRACT_VERSION,
      consumerPackage: `${EXPECTED_PACKAGE_NAME}@${EXPECTED_PACKAGE_VERSION}`,
      consumerLogicalIntegrity: EXPECTED_LOGICAL_INTEGRITY
    },
    acceptanceMatrix: {
      path: ACCEPTANCE_RELATIVE_PATH,
      sha256: acceptanceHash,
      required: 24
    },
    summary: { required: 24, pass: 24, fail: 0, notRun: 0, blocked: 0 },
    criteria,
    marker: "WSGS_GOWM_ALIGNMENT_LEDGER_COMPLETE"
  };
  const ledger: JsonObject = { ...ledgerPayload, evidenceHash: canonicalSha256(ledgerPayload) };
  const ledgerHash = sha256(stableJson(ledger));
  const direct = evidence.get(EVIDENCE_PATHS.direct)!.document;
  const directRuntime = object(direct["runtime"], "direct-r1-r5-smoke.runtime");
  const directBinding = object(directRuntime["runtimeBinding"], "direct-r1-r5-smoke.runtime.runtimeBinding");
  const formal = evidence.get(EVIDENCE_PATHS.formal)!.document;
  const handoffPointer = evidence.get(EVIDENCE_PATHS.handoff)!;
  const handoffVerification = handoffPointer.document;
  const closurePayload: JsonObject = {
    schemaVersion: "wsgs-gowm-alignment-closure/1.0",
    status: "DEVELOPMENT_READY",
    productionQualified: false,
    runtime: {
      sourceCommit: EXPECTED_RUNTIME_COMMIT,
      runtimeVersion: EXPECTED_RUNTIME_VERSION,
      gatewayContractVersion: EXPECTED_GATEWAY_CONTRACT_VERSION,
      consumerPackage: `${EXPECTED_PACKAGE_NAME}@${EXPECTED_PACKAGE_VERSION}`,
      consumerLogicalIntegrity: EXPECTED_LOGICAL_INTEGRITY,
      tarballBytes: Number(EXPECTED_TARBALL_BYTES),
      tarballSha256: `sha256:${EXPECTED_TARBALL_SHA256}`,
      archiveSri: EXPECTED_ARCHIVE_SRI,
      materializationTreeSha256: EXPECTED_MATERIALIZATION_TREE,
      rawCrLfFileCount: 58,
      contractCatalogRevision: EXPECTED_CONTRACT_CATALOG_REVISION,
      semanticCatalogHash: EXPECTED_SEMANTIC_CATALOG_HASH,
      southboundRawSha256: EXPECTED_SOUTHBOUND_RAW_SHA256
    },
    acceptance: {
      required: 24,
      pass: 24,
      ledgerPath: OUTPUT_PATHS.ledger,
      ledgerHash
    },
    runtimeEvidence: {
      direct: {
        status: direct["status"],
        recipes: "5/5",
        path: EVIDENCE_PATHS.direct,
        wsgsSourceCommit: direct["wsgsSourceCommit"],
        imageDigest: directBinding["imageDigest"],
        runtimeBindingHash: directBinding["bindingHash"],
        instanceEvidencePath: directBinding["instanceEvidencePath"],
        instanceEvidenceHash: directBinding["instanceEvidenceHash"]
      },
      formal: {
        status: formal["status"],
        recipes: "5/5",
        path: EVIDENCE_PATHS.formal,
        wsgsSourceCommit: formal["sourceCommit"],
        runtimeBindingHash: formal["runtimeBindingHash"],
        executionMode: formal["executionMode"],
        wsgsProcessBindingHash: formal["wsgsProcessBindingHash"],
        wsgsProcessBindingPath: EVIDENCE_PATHS.wsgsProcessBinding,
        wsgsRuntimeImageBuildPath: EVIDENCE_PATHS.wsgsRuntimeImageBuild
      }
    },
    handoff: {
      verificationPath: handoffPointer.path,
      verificationSha256: handoffPointer.sha256,
      contractPath: EVIDENCE_PATHS.handoffContract,
      contractSha256: handoffVerification["handoffFileHash"],
      contractPayloadHash: handoffVerification["handoffCanonicalPayloadHash"],
      alignmentValidatedRecipes: EXPECTED_RECIPE_IDS,
      productionQualified: false
    },
    nonClaims: [
      "This closure is development readiness only.",
      "It is not production qualification, release, deployment, or shared-runtime mutation evidence."
    ],
    marker: "WSGS_GOWM_0_6_4_ALIGNMENT_DEVELOPMENT_READY"
  };
  const closure: JsonObject = { ...closurePayload, evidenceHash: canonicalSha256(closurePayload) };
  const readiness = `# WSGS / GOWM runtime-contract alignment development readiness\n\n` +
    `Status: **DEVELOPMENT_READY**; \`productionQualified=false\`.\n\n` +
    `- GOWM runtime source: \`${EXPECTED_RUNTIME_COMMIT}\` (runtime \`${EXPECTED_RUNTIME_VERSION}\`).\n` +
    `- Gateway contract / consumer package: \`${EXPECTED_GATEWAY_CONTRACT_VERSION}\` / \`${EXPECTED_PACKAGE_VERSION}\`.\n` +
    `- Acceptance: 24/24 blocking ALIGN criteria PASS; ledger \`${ledgerHash}\`.\n` +
    `- Direct exact-runtime recipes: R1-R5, 5/5 PASS.\n` +
    `- Formal WSGS pipeline recipes: R1-R5, 5/5 PASS.\n` +
    `- SACS handoff records \`alignmentValidatedRecipes=[R1,R2,R3,R4,R5]\`.\n\n` +
    `This report does not claim production qualification, release, deployment, or shared-runtime mutation.\n`;
  return { closure, readiness, ledger };
}

function emit(root: string, relativePath: string, contents: string, write: boolean): void {
  const path = resolve(root, relativePath);
  if (write) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, "utf8");
    return;
  }
  invariant(existsSync(path), "ALIGNMENT_CLOSURE_OUTPUT_MISSING", relativePath);
  const observed = readFileSync(path, "utf8");
  invariant(observed === contents, "ALIGNMENT_CLOSURE_OUTPUT_DRIFT", relativePath);
}

function parseArgs(argv: string[]): CliOptions {
  let root = DEFAULT_ROOT;
  let write = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") write = true;
    else if (argument === "--root") {
      const value = argv[index + 1];
      invariant(value !== undefined, "ALIGNMENT_CLOSURE_ARGUMENT_MISSING", "--root");
      root = resolve(value);
      index += 1;
    } else {
      fail("ALIGNMENT_CLOSURE_UNKNOWN_ARGUMENT", argument);
    }
  }
  return { root, write };
}

export function generateGowmAlignmentClosure(options: CliOptions): JsonObject {
  const acceptance = readAcceptanceMatrix(options.root);
  const evidence = buildEvidenceMap(options.root);
  const criteria = buildCriterionResults(acceptance.rows, evidence);
  const outputs = buildOutputs(acceptance.hash, criteria, evidence);
  emit(options.root, OUTPUT_PATHS.ledger, stableJson(outputs.ledger), options.write);
  emit(options.root, OUTPUT_PATHS.closure, stableJson(outputs.closure), options.write);
  emit(options.root, OUTPUT_PATHS.readiness, outputs.readiness, options.write);
  return {
    status: "PASS",
    mode: options.write ? "WRITE" : "CHECK",
    required: 24,
    pass: 24,
    directRecipes: "5/5",
    formalRecipes: "5/5",
    productionQualified: false,
    outputs: OUTPUT_PATHS,
    marker: "WSGS_GOWM_ALIGNMENT_CLOSURE_PASS"
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = generateGowmAlignmentClosure(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error: unknown) => {
    const code = error instanceof AlignmentClosureError ? error.code : "ALIGNMENT_CLOSURE_UNEXPECTED_FAILURE";
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({
      status: "BLOCKED",
      productionQualified: false,
      code,
      message,
      marker: "WSGS_GOWM_ALIGNMENT_CLOSURE_BLOCKED"
    })}\n`);
    process.exitCode = 1;
  });
}
