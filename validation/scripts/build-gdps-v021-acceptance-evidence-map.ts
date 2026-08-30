import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ValidateFunction } from "ajv";

import {
  canonicalJson,
  evaluateGdpsV021Report,
  parseGdpsV021Corpus,
  type GdpsV021CaseObservation,
  type GdpsV021EvidenceLedger,
  type GdpsV021QualificationEvidence,
  type GdpsV021ReportInput,
} from "../../packages/gowm-execution-evidence/src/index.js";

export type EvidenceStatus = "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED";
export type EvidencePolarity = "POSITIVE" | "NEGATIVE";
export type ReportCategory = "SOURCE" | "PHASE" | "RUNTIME";

type JsonObject = Record<string, unknown>;

export interface AcceptanceTarget {
  readonly release: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly capabilityCount: number;
  readonly productTypeCount: number;
  readonly descriptorProfileCount: number;
}

interface MatrixRow {
  readonly id: string;
  readonly phase: string;
  readonly area: string;
  readonly scenario: string;
  readonly expected: string;
  readonly evidenceTypes: readonly string[];
}

interface Policy {
  readonly schemaVersion: string;
  readonly target: AcceptanceTarget;
  readonly allowedEvidenceTypes: readonly string[];
  readonly negativeAcceptanceIds: readonly string[];
  readonly legacyEvidence: {
    readonly forbiddenReportPrefixes: readonly string[];
    readonly forbiddenProviderVersions: readonly string[];
    readonly forbiddenCapabilityCounts: readonly number[];
    readonly forbiddenSourceShas: readonly string[];
  };
}

interface AssertionManifest {
  readonly acceptanceId: string;
  readonly type: string;
  readonly assertionId: string;
  readonly status: EvidenceStatus;
  readonly polarity: EvidencePolarity;
  readonly reason?: string;
}

interface ReportManifest {
  readonly reportId: string;
  readonly phase: string;
  readonly reportStatus: EvidenceStatus;
  readonly artifactPath: string;
  readonly artifactHash: string;
  readonly candidateSha: string;
  readonly target: AcceptanceTarget;
  readonly assertions: readonly AssertionManifest[];
}

interface RootManifest {
  readonly schemaVersion: string;
  readonly candidate: {
    readonly repository: string;
    readonly gitHead: string;
  };
  readonly target: AcceptanceTarget;
  readonly matrix: { readonly artifactPath: string; readonly artifactHash: string };
  readonly policy: { readonly artifactPath: string; readonly artifactHash: string };
  readonly sourceReports: readonly ReportManifest[];
  readonly phaseReports: readonly ReportManifest[];
  readonly runtimeReports: readonly ReportManifest[];
  readonly w44Report: null | {
    readonly reportId: string;
    readonly artifactPath: string;
    readonly artifactHash: string;
  };
}

interface LoadedReport {
  readonly category: ReportCategory;
  readonly manifest: ReportManifest;
  readonly artifactRepositoryPath: string;
  readonly artifactBytes: Buffer;
  readonly artifactDocument: unknown;
  readonly assertionArtifacts: ReadonlyMap<string, AssertionArtifact>;
}

interface AssertionArtifact {
  readonly repositoryPath: string;
  readonly hash: string;
}

interface VerifiedAssertion {
  readonly report: LoadedReport;
  readonly assertion: AssertionManifest;
  readonly status: EvidenceStatus;
  readonly artifact?: AssertionArtifact;
}

interface ReportContractValidators {
  readonly acceptanceMap: ValidateFunction;
  readonly genericAssertion: ValidateFunction;
  readonly w43Assertion: ValidateFunction;
  readonly w43Phase: ValidateFunction;
}

export interface EvidenceMapBuildInput {
  readonly repositoryRoot: string;
  readonly manifestPath: string;
  readonly expectedCandidateSha: string;
  readonly matrixPath?: string;
  readonly policyPath?: string;
}

export interface EvidenceMapBuildResult {
  readonly document: JsonObject;
  readonly bytes: Buffer;
}

export class GdpsV021EvidenceMapError extends Error {
  public readonly code: string;

  public constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "GdpsV021EvidenceMapError";
    this.code = code;
  }
}

const shaPattern = /^[0-9a-f]{40}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const assertionIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const reportIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const phasePattern = /^W(?:3[3-9]|4[0-5])$/u;
const statuses = new Set<EvidenceStatus>(["PASS", "FAIL", "NOT_RUN", "BLOCKED"]);
const reportArtifactPrefix = "reports/wsgs-v0.2-gdps-v0.2.1/";
const driverReportSchemaPath =
  "contracts/wsgs-v0.2-gdps/report-contracts/gdps-v021-driver-attestation.schema.json";
const realE2eReportSchemaPath =
  "contracts/wsgs-v0.2-gdps/report-contracts/gdps-v021-real-e2e-report.schema.json";
const driverReportSchemaId = "urn:wsgs:gdps-v021-e2e-driver-attestation:2.0";
const realE2eReportSchemaId = "urn:wsgs:gdps-v021-real-e2e-report:2.1";
const acceptanceMapSchemaPath =
  "contracts/wsgs-v0.2-gdps/report-contracts/gdps-v021-acceptance-evidence-map.schema.json";
const typedAssertionSchemaPath =
  "contracts/wsgs-v0.2-gdps/report-contracts/gdps-v021-typed-assertion-evidence.schema.json";
const w43AssertionSchemaPath =
  "contracts/wsgs-v0.2-gdps/report-contracts/gdps-v021-w43-assertion-evidence.schema.json";
const w43PhaseSchemaPath =
  "contracts/wsgs-v0.2-gdps/report-contracts/gdps-v021-w43-phase-report.schema.json";
const acceptanceMapSchemaId = "urn:wsgs:gdps-v021-acceptance-evidence-map:2.0";
const typedAssertionSchemaId = "urn:wsgs:gdps-v021-typed-assertion-evidence:1.0";
const w43AssertionSchemaId = "urn:wsgs:gdps-v021-w43-assertion-evidence:1.0";
const w43PhaseSchemaId = "urn:wsgs:gdps-v021-w43-phase-report:1.0";
export const GDPS_V021_W43_REPORT_SCHEMA_VERSION =
  "wsgs-gdps-v021-w43-phase-report/1.0";
export const GDPS_V021_W43_EVIDENCE_LEDGER_SCHEMA_VERSION =
  "wsgs-gdps-v021-w43-evidence-ledger/1.0";
export const GDPS_V021_W43_ASSERTION_EVIDENCE_SCHEMA_VERSION =
  "wsgs-gdps-v021-w43-assertion-evidence/1.0";
const w43EvidenceArtifactPrefix = `${reportArtifactPrefix}w43-evidence/`;
const w43ReceiptPrefix = `${reportArtifactPrefix}w43-receipts/`;
const typedEvidenceArtifactPrefix = `${reportArtifactPrefix}typed-evidence/`;
const typedReceiptPrefix = `${reportArtifactPrefix}typed-receipts/`;
const w43EvidenceTypes = Object.freeze(["CURRENTNESS", "UNIT", "REAL_POSTGRES"] as const);
const forbiddenProductVersionKeys = new Set(["productversion", "productversionid"]);
const forbiddenSensitiveKeys = new Set([
  "password", "passwd", "secret", "token", "privatekey", "credential", "apikey",
  "accesstoken", "refreshtoken", "clientsecret", "authorization",
]);
const w43ScenarioIds = Object.freeze([
  "CURRENT_STRICT",
  "CHANGED_STRICT",
  "NOT_AVAILABLE_STRICT",
  "CHANGED_BEST_EFFORT",
  "SOURCE_CHANGED_ONCE",
  "SOURCE_CHANGED_TWICE",
] as const);
type W43ScenarioId = typeof w43ScenarioIds[number];
const w43BarrierPlan = Object.freeze([
  ["CURRENT_STRICT", "W43-STRICT-CURRENT", "PREPARE_A", "INITIAL_A", "INITIAL_A"],
  ["CHANGED_STRICT", "W43-STRICT-CHANGED", "PREPARE_A", "INITIAL_A", "INITIAL_A"],
  ["CHANGED_STRICT", "W43-STRICT-CHANGED", "AFTER_PRIOR_GROUNDING:A_TO_B", "INITIAL_A", "FINAL_B"],
  ["NOT_AVAILABLE_STRICT", "W43-STRICT-NOT-AVAILABLE", "PREPARE_A", "FINAL_B", "INITIAL_A"],
  ["NOT_AVAILABLE_STRICT", "W43-STRICT-NOT-AVAILABLE", "AFTER_PRIOR_GROUNDING:DISABLE_CURRENT_PRODUCT", "INITIAL_A", "NOT_AVAILABLE"],
  ["NOT_AVAILABLE_STRICT", "W43-STRICT-NOT-AVAILABLE", "AFTER_SCENARIO:RESTORE_A", "NOT_AVAILABLE", "INITIAL_A"],
  ["CHANGED_BEST_EFFORT", "W43-BEST-EFFORT-CHANGED", "PREPARE_A", "INITIAL_A", "INITIAL_A"],
  ["CHANGED_BEST_EFFORT", "W43-BEST-EFFORT-CHANGED", "AFTER_PRIOR_GROUNDING:A_TO_B", "INITIAL_A", "FINAL_B"],
  ["SOURCE_CHANGED_ONCE", "W43-SOURCE-CHANGED-ONCE-THEN-SUCCESS", "PREPARE_A", "FINAL_B", "INITIAL_A"],
  ["SOURCE_CHANGED_ONCE", "W43-SOURCE-CHANGED-ONCE-THEN-SUCCESS", "BEFORE_REPLAY_QUERY:A_TO_B", "INITIAL_A", "FINAL_B"],
  ["SOURCE_CHANGED_TWICE", "W43-SOURCE-CHANGED-TWICE-INDETERMINATE", "PREPARE_A", "FINAL_B", "INITIAL_A"],
  ["SOURCE_CHANGED_TWICE", "W43-SOURCE-CHANGED-TWICE-INDETERMINATE", "BEFORE_REPLAY_QUERY:A_TO_B", "INITIAL_A", "FINAL_B"],
  ["SOURCE_CHANGED_TWICE", "W43-SOURCE-CHANGED-TWICE-INDETERMINATE", "AFTER_FIRST_SOURCE_CHANGED:B_TO_A", "FINAL_B", "INITIAL_A"],
  ["SOURCE_CHANGED_TWICE", "W43-SOURCE-CHANGED-TWICE-INDETERMINATE", "FINALIZE_B", "INITIAL_A", "FINAL_B"],
] as const);
const w43ScenariosByAcceptanceId: Readonly<Record<string, readonly W43ScenarioId[]>> = Object.freeze({
  "W43-001": ["CURRENT_STRICT"],
  "W43-002": ["CHANGED_STRICT"],
  "W43-003": ["NOT_AVAILABLE_STRICT"],
  "W43-004": ["CURRENT_STRICT"],
  "W43-005": ["CHANGED_STRICT"],
  "W43-006": ["CURRENT_STRICT", "CHANGED_STRICT", "NOT_AVAILABLE_STRICT"],
  "W43-007": ["CHANGED_BEST_EFFORT"],
  "W43-008": ["CHANGED_BEST_EFFORT"],
  "W43-009": ["CHANGED_STRICT", "CHANGED_BEST_EFFORT"],
  "W43-010": ["CURRENT_STRICT", "CHANGED_STRICT", "CHANGED_BEST_EFFORT"],
  "W43-011": w43ScenarioIds,
  "W43-012": w43ScenarioIds,
  "W43-013": ["SOURCE_CHANGED_ONCE"],
  "W43-014": ["SOURCE_CHANGED_TWICE"],
  "W43-015": w43ScenarioIds,
  "W43-016": w43ScenarioIds,
  "W43-017": ["CHANGED_STRICT", "CHANGED_BEST_EFFORT"],
  "W43-018": w43ScenarioIds,
});

function fail(code: string, detail?: string): never {
  throw new GdpsV021EvidenceMapError(code, detail);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asObject(value: unknown, code: string): JsonObject {
  if (!isObject(value)) fail(code);
  return value;
}

function asString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}

function asArray(value: unknown, code: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(code);
  return value;
}

function exactKeys(value: JsonObject, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const locked = [...expected].sort();
  if (actual.length !== locked.length || actual.some((entry, index) => entry !== locked[index])) {
    fail(code, `expected=${locked.join("|")} actual=${actual.join("|")}`);
  }
}

export function sha256(bytes: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function parseJson(bytes: Uint8Array, code: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch (error) {
    fail(code, error instanceof Error ? error.message : String(error));
  }
}

function csvRows(text: string): JsonObject[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) fail("MATRIX_CSV_UNTERMINATED_QUOTE");
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  const nonEmpty = rows.filter((entry) => entry.some((value) => value !== ""));
  const header = nonEmpty.shift();
  if (!header) fail("MATRIX_CSV_EMPTY");
  return nonEmpty.map((values) => Object.fromEntries(
    header.map((name, index) => [name, values[index] ?? ""]),
  ));
}

function loadMatrix(bytes: Uint8Array): MatrixRow[] {
  const rows = csvRows(Buffer.from(bytes).toString("utf8")).map((row): MatrixRow => {
    const id = asString(row["id"], "MATRIX_ROW_ID_INVALID");
    const phase = asString(row["phase"], `MATRIX_PHASE_INVALID_${id}`);
    if (row["required"] !== "yes" || !phasePattern.test(phase)) {
      fail("MATRIX_REQUIRED_ROW_INVALID", id);
    }
    const evidenceTypes = asString(row["evidence"], `MATRIX_EVIDENCE_INVALID_${id}`)
      .split("/").filter(Boolean);
    if (evidenceTypes.length === 0 || new Set(evidenceTypes).size !== evidenceTypes.length) {
      fail("MATRIX_EVIDENCE_INVALID", id);
    }
    return {
      id,
      phase,
      area: asString(row["area"], `MATRIX_AREA_INVALID_${id}`),
      scenario: asString(row["scenario"], `MATRIX_SCENARIO_INVALID_${id}`),
      expected: asString(row["expected"], `MATRIX_EXPECTED_INVALID_${id}`),
      evidenceTypes,
    };
  });
  if (rows.length !== 327 || new Set(rows.map((row) => row.id)).size !== 327) {
    fail("MATRIX_INVENTORY_INVALID", `rows=${rows.length}`);
  }
  return rows;
}

function targetFrom(value: unknown, code: string): AcceptanceTarget {
  const target = asObject(value, code);
  exactKeys(target, [
    "release", "providerId", "providerVersion", "capabilityCount", "productTypeCount",
    "descriptorProfileCount",
  ], `${code}_FIELDS_INVALID`);
  const capabilityCount = target["capabilityCount"];
  const productTypeCount = target["productTypeCount"];
  const descriptorProfileCount = target["descriptorProfileCount"];
  if (![capabilityCount, productTypeCount, descriptorProfileCount]
      .every((entry) => Number.isInteger(entry))) fail(code);
  return {
    release: asString(target["release"], code),
    providerId: asString(target["providerId"], code),
    providerVersion: asString(target["providerVersion"], code),
    capabilityCount: capabilityCount as number,
    productTypeCount: productTypeCount as number,
    descriptorProfileCount: descriptorProfileCount as number,
  };
}

function sameTarget(left: AcceptanceTarget, right: AcceptanceTarget): boolean {
  return left.release === right.release && left.providerId === right.providerId &&
    left.providerVersion === right.providerVersion && left.capabilityCount === right.capabilityCount &&
    left.productTypeCount === right.productTypeCount &&
    left.descriptorProfileCount === right.descriptorProfileCount;
}

function loadPolicy(bytes: Uint8Array, matrix: readonly MatrixRow[]): Policy {
  const raw = asObject(parseJson(bytes, "POLICY_JSON_INVALID"), "POLICY_INVALID");
  const target = targetFrom(raw["target"], "POLICY_TARGET_INVALID");
  if (raw["schemaVersion"] !== "wsgs-gdps-v021-acceptance-policy/1.0" ||
      !sameTarget(target, {
        release: "GDPS v0.2.1",
        providerId: "gdps.geospatial-products",
        providerVersion: "0.2.1",
        capabilityCount: 30,
        productTypeCount: 34,
        descriptorProfileCount: 35,
      })) fail("POLICY_TARGET_INVALID");
  const allowedEvidenceTypes = asArray(raw["allowedEvidenceTypes"], "POLICY_EVIDENCE_TYPES_INVALID")
    .map((entry) => asString(entry, "POLICY_EVIDENCE_TYPES_INVALID"));
  const matrixTypes = new Set(matrix.flatMap((row) => row.evidenceTypes));
  if ([...matrixTypes].some((type) => !allowedEvidenceTypes.includes(type))) {
    fail("POLICY_OMITS_MATRIX_EVIDENCE_TYPE");
  }
  const negativeAcceptanceIds = asArray(raw["negativeAcceptanceIds"], "POLICY_NEGATIVE_IDS_INVALID")
    .map((entry) => asString(entry, "POLICY_NEGATIVE_IDS_INVALID"));
  const legacy = asObject(raw["legacyEvidence"], "POLICY_LEGACY_RULES_INVALID");
  const forbiddenReportPrefixes = asArray(
    legacy["forbiddenReportPrefixes"], "POLICY_LEGACY_RULES_INVALID",
  ).map((entry) => asString(entry, "POLICY_LEGACY_RULES_INVALID").replaceAll("\\", "/"));
  const forbiddenProviderVersions = asArray(
    legacy["forbiddenProviderVersions"], "POLICY_LEGACY_RULES_INVALID",
  ).map((entry) => asString(entry, "POLICY_LEGACY_RULES_INVALID"));
  const forbiddenCapabilityCounts = asArray(
    legacy["forbiddenCapabilityCounts"], "POLICY_LEGACY_RULES_INVALID",
  ).map((entry) => {
    if (!Number.isInteger(entry)) fail("POLICY_LEGACY_RULES_INVALID");
    return entry as number;
  });
  const forbiddenSourceShas = asArray(
    legacy["forbiddenSourceShas"], "POLICY_LEGACY_RULES_INVALID",
  ).map((entry) => {
    const value = asString(entry, "POLICY_LEGACY_RULES_INVALID");
    if (!shaPattern.test(value)) fail("POLICY_LEGACY_RULES_INVALID");
    return value;
  });
  return {
    schemaVersion: raw["schemaVersion"] as string,
    target,
    allowedEvidenceTypes,
    negativeAcceptanceIds,
    legacyEvidence: {
      forbiddenReportPrefixes,
      forbiddenProviderVersions,
      forbiddenCapabilityCounts,
      forbiddenSourceShas,
    },
  };
}

function repositoryFile(root: string, value: unknown, code: string): {
  readonly absolutePath: string;
  readonly repositoryPath: string;
  readonly bytes: Buffer;
} {
  const path = asString(value, code);
  if (/^[A-Za-z]:[\\/]|^[\\/]{1,2}/u.test(path) || path.split(/[\\/]/u).includes("..")) {
    fail(code, `repository-relative path required: ${path}`);
  }
  const absolutePath = resolve(root, path);
  const repositoryPath = relative(root, absolutePath).replaceAll("\\", "/");
  if (repositoryPath.length === 0 || repositoryPath.startsWith("../") ||
      !existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    fail(code, path);
  }
  return { absolutePath, repositoryPath, bytes: readFileSync(absolutePath) };
}

function assertCanonicalRepositoryPath(path: string, prefix: string, code: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (normalized !== path || !normalized.startsWith(prefix) ||
      /^[A-Za-z]:|^\/|^\\\\/u.test(normalized) || normalized.split("/").includes("..")) {
    fail(code, path);
  }
  return normalized;
}

function assertNoSensitiveOrInternalMaterial(value: unknown, code: string): void {
  const inspect = (entry: unknown, key?: string): void => {
    if (Array.isArray(entry)) {
      for (const item of entry) inspect(item);
      return;
    }
    if (isObject(entry)) {
      for (const [name, item] of Object.entries(entry)) {
        const normalizedName = name.replaceAll(/[^A-Za-z0-9]/gu, "").toLowerCase();
        if (forbiddenProductVersionKeys.has(normalizedName)) {
          fail("FORBIDDEN_PRODUCT_VERSION_EVIDENCE", name);
        }
        if (forbiddenSensitiveKeys.has(normalizedName) &&
            item !== false && item !== null) {
          fail(code, `sensitive field ${name}`);
        }
        inspect(item, name);
      }
      return;
    }
    if (typeof entry !== "string") return;
    if (/Bearer\s+[A-Za-z0-9._~+\/-]+=*/iu.test(entry) ||
        /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(entry) ||
        /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\//iu.test(entry) ||
        /(?:^|[\s"'=])(?:password|passwd|secret|token)\s*[:=]\s*[^\s,;}]+/iu.test(entry)) {
      fail(code, key ?? "value");
    }
    if (/^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|root|tmp|var|etc|opt|mnt|workspace|app)(?:\/|$)|file:\/\/)/u
      .test(entry)) fail(code, `internal path in ${key ?? "value"}`);
  };
  inspect(value);
}

interface LoadedJsonReference {
  readonly path: string;
  readonly hash: string;
  readonly byteLength: number;
  readonly bytes: Buffer;
  readonly document: JsonObject;
}

function loadJsonReference(
  root: string,
  value: unknown,
  prefix: string,
  code: string,
): LoadedJsonReference {
  const reference = asObject(value, code);
  exactKeys(reference, ["path", "hash", "byteLength"], `${code}_FIELDS_INVALID`);
  const path = assertCanonicalRepositoryPath(asString(reference["path"], code), prefix, code);
  const expectedHash = digest(reference["hash"], code);
  const expectedLength = reference["byteLength"];
  if (!Number.isSafeInteger(expectedLength) || (expectedLength as number) < 2) fail(code);
  const file = repositoryFile(root, path, code);
  if (file.repositoryPath !== path || file.bytes.byteLength !== expectedLength) {
    fail(`${code}_LENGTH_DRIFT`, path);
  }
  if (sha256(file.bytes) !== expectedHash) fail(`${code}_HASH_DRIFT`, path);
  const document = asObject(parseJson(file.bytes, `${code}_JSON_INVALID`), `${code}_DOCUMENT_INVALID`);
  assertNoSensitiveOrInternalMaterial(document, `${code}_SENSITIVE_MATERIAL`);
  return {
    path,
    hash: expectedHash,
    byteLength: expectedLength as number,
    bytes: file.bytes,
    document,
  };
}

function loadReportContractValidators(root: string): ReportContractValidators {
  const specifications = [
    [acceptanceMapSchemaPath, acceptanceMapSchemaId, "ACCEPTANCE_MAP_SCHEMA"],
    [typedAssertionSchemaPath, typedAssertionSchemaId, "TYPED_ASSERTION_SCHEMA"],
    [w43AssertionSchemaPath, w43AssertionSchemaId, "W43_ASSERTION_SCHEMA"],
    [w43PhaseSchemaPath, w43PhaseSchemaId, "W43_PHASE_SCHEMA"],
  ] as const;
  const ajv = new Ajv2020Module.default({ allErrors: true, strict: true, strictRequired: false });
  addFormatsModule.default(ajv);
  for (const [path, expectedId, label] of specifications) {
    const file = repositoryFile(root, path, `${label}_MISSING`);
    const schema = asObject(parseJson(file.bytes, `${label}_JSON_INVALID`), `${label}_INVALID`);
    if (schema["$id"] !== expectedId || !ajv.validateSchema(schema)) {
      fail(`${label}_INVALID`, ajv.errorsText(ajv.errors));
    }
    ajv.addSchema(schema);
  }
  const required = (id: string, code: string): ValidateFunction => {
    const validator = ajv.getSchema(id);
    if (!validator) fail(code);
    return validator;
  };
  return {
    acceptanceMap: required(acceptanceMapSchemaId, "ACCEPTANCE_MAP_SCHEMA_DID_NOT_COMPILE"),
    genericAssertion: required(typedAssertionSchemaId, "TYPED_ASSERTION_SCHEMA_DID_NOT_COMPILE"),
    w43Assertion: required(w43AssertionSchemaId, "W43_ASSERTION_SCHEMA_DID_NOT_COMPILE"),
    w43Phase: required(w43PhaseSchemaId, "W43_PHASE_SCHEMA_DID_NOT_COMPILE"),
  };
}

function digest(value: unknown, code: string): string {
  const result = asString(value, code);
  if (!digestPattern.test(result)) fail(code);
  return result;
}

function commit(value: unknown, code: string): string {
  const result = asString(value, code);
  if (!shaPattern.test(result)) fail(code);
  return result;
}

function validateW44ReportContract(root: string, document: unknown): void {
  const driverSchemaFile = repositoryFile(
    root,
    driverReportSchemaPath,
    "W44_DRIVER_REPORT_SCHEMA_MISSING",
  );
  const reportSchemaFile = repositoryFile(
    root,
    realE2eReportSchemaPath,
    "W44_REAL_E2E_REPORT_SCHEMA_MISSING",
  );
  const driverSchema = asObject(
    parseJson(driverSchemaFile.bytes, "W44_DRIVER_REPORT_SCHEMA_JSON_INVALID"),
    "W44_DRIVER_REPORT_SCHEMA_INVALID",
  );
  const reportSchema = asObject(
    parseJson(reportSchemaFile.bytes, "W44_REAL_E2E_REPORT_SCHEMA_JSON_INVALID"),
    "W44_REAL_E2E_REPORT_SCHEMA_INVALID",
  );
  if (driverSchema["$id"] !== driverReportSchemaId ||
      reportSchema["$id"] !== realE2eReportSchemaId) {
    fail("W44_REPORT_SCHEMA_ID_MISMATCH");
  }
  const ajv = new Ajv2020Module.default({ allErrors: true, strict: true, strictRequired: false });
  addFormatsModule.default(ajv);
  try {
    if (!ajv.validateSchema(driverSchema)) {
      fail("W44_DRIVER_REPORT_SCHEMA_INVALID", ajv.errorsText(ajv.errors));
    }
    ajv.addSchema(driverSchema);
    if (!ajv.validateSchema(reportSchema)) {
      fail("W44_REAL_E2E_REPORT_SCHEMA_INVALID", ajv.errorsText(ajv.errors));
    }
    ajv.addSchema(reportSchema);
    const validate = ajv.getSchema(realE2eReportSchemaId);
    if (!validate) fail("W44_REAL_E2E_REPORT_SCHEMA_DID_NOT_COMPILE");
    if (!validate(document)) {
      fail("W44_REPORT_SCHEMA_INVALID", ajv.errorsText(validate.errors, { separator: "; " }));
    }
  } catch (error) {
    if (error instanceof GdpsV021EvidenceMapError) throw error;
    fail("W44_REPORT_SCHEMA_COMPILE_FAILED", error instanceof Error ? error.message : String(error));
  }
}

interface VerifiedLedgerArtifact {
  readonly id: string;
  readonly kind: string;
  readonly subject: string;
  readonly repositoryPath: string;
  readonly bytes: Buffer;
}

function verifyW44LedgerArtifactBytes(
  root: string,
  document: JsonObject,
): ReadonlyMap<string, VerifiedLedgerArtifact> {
  const ledger = asObject(document["evidenceLedger"], "W44_EVIDENCE_LEDGER_INVALID");
  const artifacts = asArray(ledger["artifacts"], "W44_EVIDENCE_LEDGER_INVALID");
  const byId = new Map<string, VerifiedLedgerArtifact>();
  const paths = new Set<string>();
  const hashes = new Set<string>();
  for (const raw of artifacts) {
    const record = asObject(raw, "W44_EVIDENCE_LEDGER_ARTIFACT_INVALID");
    const id = asString(record["id"], "W44_EVIDENCE_LEDGER_ARTIFACT_INVALID");
    const kind = asString(record["kind"], "W44_EVIDENCE_LEDGER_ARTIFACT_INVALID");
    const subject = asString(record["subject"], "W44_EVIDENCE_LEDGER_ARTIFACT_INVALID");
    const repositoryPath = asString(
      record["repoRelativePath"],
      "W44_EVIDENCE_LEDGER_ARTIFACT_INVALID",
    ).replaceAll("\\", "/");
    const expectedHash = digest(record["hash"], "W44_EVIDENCE_LEDGER_ARTIFACT_INVALID");
    const byteLength = record["byteLength"];
    if (!Number.isSafeInteger(byteLength) || (byteLength as number) < 1 || record["byteVerified"] !== true) {
      fail("W44_EVIDENCE_LEDGER_ARTIFACT_BYTES_UNVERIFIED", id);
    }
    if (byId.has(id)) fail("W44_EVIDENCE_LEDGER_ARTIFACT_ID_REUSED", id);
    if (paths.has(repositoryPath)) fail("W44_EVIDENCE_LEDGER_ARTIFACT_PATH_REUSED", repositoryPath);
    if (hashes.has(expectedHash)) fail("W44_EVIDENCE_LEDGER_ARTIFACT_HASH_REUSED", expectedHash);
    const artifact = repositoryFile(root, repositoryPath, "W44_EVIDENCE_LEDGER_ARTIFACT_MISSING");
    if (artifact.repositoryPath !== repositoryPath) {
      fail("W44_EVIDENCE_LEDGER_ARTIFACT_PATH_NOT_NORMALIZED", repositoryPath);
    }
    if (artifact.bytes.byteLength !== byteLength) {
      fail("W44_EVIDENCE_LEDGER_ARTIFACT_LENGTH_DRIFT", id);
    }
    if (sha256(artifact.bytes) !== expectedHash) {
      fail("W44_EVIDENCE_LEDGER_ARTIFACT_HASH_DRIFT", id);
    }
    paths.add(repositoryPath);
    hashes.add(expectedHash);
    byId.set(id, { id, kind, subject, repositoryPath, bytes: artifact.bytes });
  }
  return byId;
}

function validateW44PolicyEvaluation(
  root: string,
  document: JsonObject,
  artifactsById: ReadonlyMap<string, VerifiedLedgerArtifact>,
): void {
  const corpusFile = repositoryFile(
    root,
    "config/gdps-e2e-corpus.json",
    "W44_CORPUS_FILE_MISSING",
  );
  const cases = asArray(document["cases"], "W44_CASES_INVALID");
  const observations = cases.map((raw) => {
    const evaluation = asObject(raw, "W44_CASE_INVALID");
    const observation = evaluation["observation"];
    if (!isObject(observation)) fail("W44_PASS_CASE_OBSERVATION_MISSING");
    return observation as unknown as GdpsV021CaseObservation;
  });
  const qualifications = asArray(
    document["qualifications"],
    "W44_QUALIFICATIONS_INVALID",
  ) as unknown as readonly GdpsV021QualificationEvidence[];
  const reportInput: GdpsV021ReportInput = {
    generatedAt: asString(document["generatedAt"], "W44_GENERATED_AT_INVALID"),
    sourceIdentity: asObject(
      document["sourceIdentity"],
      "W44_SOURCE_IDENTITY_INVALID",
    ) as unknown as GdpsV021ReportInput["sourceIdentity"],
    execution: asObject(
      document["execution"],
      "W44_EXECUTION_IDENTITY_INVALID",
    ) as unknown as GdpsV021ReportInput["execution"],
    evidenceLedger: asObject(
      document["evidenceLedger"],
      "W44_EVIDENCE_LEDGER_INVALID",
    ) as unknown as GdpsV021EvidenceLedger,
    observations,
    qualifications,
  };
  let reevaluated: ReturnType<typeof evaluateGdpsV021Report>;
  try {
    reevaluated = evaluateGdpsV021Report(parseGdpsV021Corpus(corpusFile.bytes), reportInput);
  } catch (error) {
    fail("W44_POLICY_REEVALUATION_FAILED", error instanceof Error ? error.message : String(error));
  }
  if (reevaluated.policyErrors.length > 0) {
    fail("W44_POLICY_REEVALUATION_FAILED", reevaluated.policyErrors.join("|"));
  }
  if (reevaluated.overallStatus !== "PASS") {
    fail("W44_POLICY_REEVALUATION_NOT_PASS");
  }
  if (canonicalJson(reevaluated) !== canonicalJson(document)) {
    fail("W44_POLICY_REEVALUATION_MISMATCH");
  }
  for (const raw of cases) {
    const evaluation = asObject(raw, "W44_CASE_INVALID");
    const observation = asObject(evaluation["observation"], "W44_PASS_CASE_OBSERVATION_MISSING");
    if (observation["driverAttestation"] === null) continue;
    const attestation = asObject(
      observation["driverAttestation"],
      "W44_DRIVER_ATTESTATION_INVALID",
    );
    const caseId = asString(attestation["caseId"], "W44_DRIVER_ATTESTATION_INVALID");
    const artifactId = `driver-${caseId.toLowerCase()}-attestation`;
    const artifact = artifactsById.get(artifactId);
    if (!artifact || artifact.kind !== "DRIVER_ATTESTATION" || artifact.subject !== caseId) {
      fail("W44_DRIVER_ATTESTATION_ARTIFACT_ID_MISMATCH", artifactId);
    }
    const artifactDocument = parseJson(
      artifact.bytes,
      "W44_DRIVER_ATTESTATION_ARTIFACT_JSON_INVALID",
    );
    if (canonicalJson(artifactDocument) !== canonicalJson(attestation)) {
      fail("W44_DRIVER_ATTESTATION_ARTIFACT_CONTENT_MISMATCH", artifactId);
    }
  }
}

interface W43ValidationContext {
  bindingJson?: string;
  barrierReferenceJson?: string;
  currentnessReceiptJson?: string;
  unitReceiptJson?: string;
  rawUnitReportJson?: string;
  postgresReceiptJson?: string;
  replayBarrierArmReferenceJson?: string;
  authorityTupleHash?: string;
  currentnessScenarios?: ReadonlyMap<W43ScenarioId, JsonObject>;
  postgresObservations?: ReadonlyMap<W43ScenarioId, JsonObject>;
}

function asNonNegativeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(code);
  return value as number;
}

function w43RuntimeBinding(value: unknown, expectedCandidateSha: string): JsonObject {
  const binding = asObject(value, "W43_RUNTIME_BINDING_INVALID");
  exactKeys(binding, [
    "candidateSha", "gateRunId", "runtimeIdentityHash", "gowmGatewayIdentityHash",
    "wsgsRuntimeIdentityHash", "databaseIdentityHash", "handoffBundleHash", "operationLockHash",
    "providerRecipeLockHash", "providerId", "providerVersion", "capabilityCount",
    "requiredExecutionPath", "gatewayOnly", "directProviderCalls", "mockTransportUsed",
    "databaseClass", "sharedRuntimeMutated",
  ], "W43_RUNTIME_BINDING_FIELDS_INVALID");
  if (binding["candidateSha"] !== expectedCandidateSha ||
      !/^wsgs-gdps-v021-[a-z0-9][a-z0-9-]{7,95}$/u.test(String(binding["gateRunId"] ?? "")) ||
      binding["providerId"] !== "gdps.geospatial-products" || binding["providerVersion"] !== "0.2.1" ||
      binding["capabilityCount"] !== 30 ||
      binding["requiredExecutionPath"] !== "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" ||
      binding["gatewayOnly"] !== true || binding["directProviderCalls"] !== 0 ||
      binding["mockTransportUsed"] !== false || binding["databaseClass"] !== "REAL_ISOLATED_POSTGRESQL" ||
      binding["sharedRuntimeMutated"] !== false) {
    fail("W43_RUNTIME_BINDING_TRUTH_INVALID");
  }
  for (const field of [
    "runtimeIdentityHash", "gowmGatewayIdentityHash", "wsgsRuntimeIdentityHash", "databaseIdentityHash",
    "handoffBundleHash", "operationLockHash", "providerRecipeLockHash",
  ]) digest(binding[field], `W43_RUNTIME_BINDING_${field.toUpperCase()}_INVALID`);
  return binding;
}

function bindW43Context(
  context: W43ValidationContext,
  binding: JsonObject,
  barrierReference?: unknown,
): void {
  const bindingJson = canonicalJson(binding);
  if (context.bindingJson !== undefined && context.bindingJson !== bindingJson) {
    fail("W43_CROSS_ARTIFACT_RUNTIME_BINDING_MISMATCH");
  }
  context.bindingJson = bindingJson;
  if (barrierReference !== undefined) {
    const barrierJson = canonicalJson(barrierReference);
    if (context.barrierReferenceJson !== undefined && context.barrierReferenceJson !== barrierJson) {
      fail("W43_CROSS_ARTIFACT_BARRIER_BINDING_MISMATCH");
    }
    context.barrierReferenceJson = barrierJson;
  }
}

function bindW43Singleton(
  context: W43ValidationContext,
  field: "currentnessReceiptJson" | "unitReceiptJson" | "rawUnitReportJson" |
    "postgresReceiptJson" | "replayBarrierArmReferenceJson",
  value: unknown,
  code: string,
): void {
  const json = canonicalJson(value);
  if (context[field] !== undefined && context[field] !== json) fail(code);
  context[field] = json;
}

const w43ScenarioExpectations: Readonly<Record<W43ScenarioId, JsonObject>> = Object.freeze({
  CURRENT_STRICT: {
    replayMode: "STRICT", groundingStatus: "COMPLETED", terminalStatus: "COMPLETED",
    normalizedStatus: "CURRENT", currentness: "CURRENT", semanticCode: "OK",
    warnings: ["CURRENT_SOURCE_IDENTITY_CONFIRMED"], newCurrentSourceExecutionCount: 0,
    sourceChangedDuringQueryCount: 0, retryCount: 0,
  },
  CHANGED_STRICT: {
    replayMode: "STRICT", groundingStatus: "UNRESOLVED", terminalStatus: "UNRESOLVED",
    normalizedStatus: "STALE", currentness: "CHANGED", semanticCode: "SNAPSHOT_MISMATCHED",
    warnings: ["SOURCE_CHANGED"], newCurrentSourceExecutionCount: 0,
    sourceChangedDuringQueryCount: 0, retryCount: 0,
  },
  NOT_AVAILABLE_STRICT: {
    replayMode: "STRICT", groundingStatus: "UNRESOLVED", terminalStatus: "UNRESOLVED",
    normalizedStatus: "DATA_GAP", currentness: "NOT_AVAILABLE", semanticCode: "DATA_GAP",
    warnings: ["SOURCE_NOT_AVAILABLE"], newCurrentSourceExecutionCount: 0,
    sourceChangedDuringQueryCount: 0, retryCount: 0,
  },
  CHANGED_BEST_EFFORT: {
    replayMode: "BEST_EFFORT", groundingStatus: "COMPLETED", terminalStatus: "COMPLETED",
    normalizedStatus: "CURRENT", currentness: "CHANGED", semanticCode: "SOURCE_ADVANCED",
    warnings: ["SOURCE_ADVANCED"], newCurrentSourceExecutionCount: 1,
    sourceChangedDuringQueryCount: 0, retryCount: 0,
  },
  SOURCE_CHANGED_ONCE: {
    replayMode: "BEST_EFFORT", groundingStatus: "COMPLETED", terminalStatus: "COMPLETED",
    normalizedStatus: "CURRENT", currentness: "CHANGED", semanticCode: "SOURCE_ADVANCED",
    warnings: ["CURRENT_SOURCE_QUERY_RETRIED", "SOURCE_ADVANCED", "SOURCE_CHANGED"],
    newCurrentSourceExecutionCount: 2, sourceChangedDuringQueryCount: 1, retryCount: 1,
  },
  SOURCE_CHANGED_TWICE: {
    replayMode: "BEST_EFFORT", groundingStatus: "UNRESOLVED", terminalStatus: "INDETERMINATE",
    normalizedStatus: "INDETERMINATE", currentness: "CHANGED", semanticCode: "SOURCE_CHANGED",
    warnings: ["CURRENT_SOURCE_QUERY_RETRIED", "INDETERMINATE", "SOURCE_ADVANCED", "SOURCE_CHANGED"],
    newCurrentSourceExecutionCount: 2, sourceChangedDuringQueryCount: 2, retryCount: 1,
  },
});
const w43ReplayBarrierIndex: Readonly<Record<W43ScenarioId, number>> = Object.freeze({
  CURRENT_STRICT: 0,
  CHANGED_STRICT: 1,
  NOT_AVAILABLE_STRICT: 1,
  CHANGED_BEST_EFFORT: 1,
  SOURCE_CHANGED_ONCE: 1,
  SOURCE_CHANGED_TWICE: 1,
});

function transitionHash(record: JsonObject): string {
  return sha256(canonicalJson(Object.fromEntries(
    Object.entries(record).filter(([name]) => name !== "transitionHash"),
  )));
}

function validateW43BarrierLedger(
  root: string,
  reference: unknown,
  binding: JsonObject,
): ReadonlyMap<W43ScenarioId, readonly string[]> {
  const loaded = loadJsonReference(root, reference, w43ReceiptPrefix, "W43_BARRIER_LEDGER");
  const document = loaded.document;
  exactKeys(document, [
    "schemaVersion", "status", "contractHash", "fixtureId", "scope", "productId", "candidateSha",
    "gateRunIdHash", "runtimeIdentityHash", "providerRuntimeIdentityHash", "providerManifestHash",
    "journalBindingHash", "qualificationScope", "w43RuntimeQualificationStatus", "runtimeEvidenceIncluded",
    "transitionCount", "transitions", "currentState", "finalFixtureState", "directProviderCalls",
    "credentialMaterialRecorded",
  ], "W43_BARRIER_LEDGER_FIELDS_INVALID");
  if (document["schemaVersion"] !== "gdps-v021-w43-barrier-attestation/1.0" ||
      document["status"] !== "PASS" || document["candidateSha"] !== binding["candidateSha"] ||
      document["gateRunIdHash"] !== sha256(canonicalJson({ gateRunId: binding["gateRunId"] })) ||
      document["runtimeIdentityHash"] !== sha256(canonicalJson({ runtimeIdentity: binding["runtimeIdentityHash"] })) ||
      document["fixtureId"] !== "GDPS_SLOPE_A_B_CURRENTNESS" ||
      document["scope"] !== "scope-gdps-v021-baseline" ||
      document["productId"] !== "gdps-baseline-slope" ||
      document["qualificationScope"] !== "FIXTURE_TRANSITIONS_ONLY" ||
      document["w43RuntimeQualificationStatus"] !== "NOT_RUN" ||
      document["runtimeEvidenceIncluded"] !== false || document["directProviderCalls"] !== 0 ||
      document["credentialMaterialRecorded"] !== false || document["currentState"] !== "FINAL_B" ||
      document["finalFixtureState"] !== "FINAL_B") {
    fail("W43_BARRIER_LEDGER_BINDING_INVALID");
  }
  digest(document["contractHash"], "W43_BARRIER_CONTRACT_HASH_INVALID");
  const providerRuntimeHash = digest(
    document["providerRuntimeIdentityHash"],
    "W43_BARRIER_PROVIDER_RUNTIME_HASH_INVALID",
  );
  const providerManifestHash = digest(
    document["providerManifestHash"],
    "W43_BARRIER_PROVIDER_MANIFEST_HASH_INVALID",
  );
  digest(document["journalBindingHash"], "W43_BARRIER_JOURNAL_HASH_INVALID");
  const transitions = asArray(document["transitions"], "W43_BARRIER_TRANSITIONS_INVALID");
  if (transitions.length !== w43BarrierPlan.length || document["transitionCount"] !== transitions.length) {
    fail("W43_BARRIER_TRANSITION_INVENTORY_INVALID");
  }
  const first = asObject(transitions[0], "W43_BARRIER_TRANSITION_INVALID");
  const third = asObject(transitions[2], "W43_BARRIER_TRANSITION_INVALID");
  const initialContentHash = digest(first["beforeContentHash"], "W43_BARRIER_CONTENT_HASH_INVALID");
  const finalContentHash = digest(third["afterContentHash"], "W43_BARRIER_CONTENT_HASH_INVALID");
  if (initialContentHash === finalContentHash) fail("W43_BARRIER_CONTENT_STATES_NOT_DISTINCT");
  const invariantFields = [
    "foundationSchemaFingerprintBefore", "foundationDataFingerprintBefore", "nonTargetFingerprintBefore",
  ] as const;
  const invariantHashes = Object.fromEntries(invariantFields.map((field) => [
    field,
    digest(first[field], "W43_BARRIER_INVARIANT_HASH_INVALID"),
  ]));
  const grouped = new Map<string, string[]>();
  let previous: string | null = null;
  transitions.forEach((raw, index) => {
    const item = asObject(raw, "W43_BARRIER_TRANSITION_INVALID");
    exactKeys(item, [
      "sequence", "scenarioId", "barrier", "status", "expectedFrom", "targetState", "beforeState",
      "afterState", "beforeContentHash", "afterContentHash", "foundationSchemaFingerprintBefore",
      "foundationSchemaFingerprintAfter", "foundationDataFingerprintBefore", "foundationDataFingerprintAfter",
      "nonTargetFingerprintBefore", "nonTargetFingerprintAfter", "providerRuntimeIdentityHashBefore",
      "providerRuntimeIdentityHashAfter", "providerManifestHashBefore", "providerManifestHashAfter",
      "providerRuntimeInvariant", "journalIntentHash", "foundationInvariant", "nonTargetInvariant",
      "directProviderCalls", "credentialMaterialRecorded", "recordedAt", "previousTransitionHash",
      "transitionHash",
    ], "W43_BARRIER_TRANSITION_FIELDS_INVALID");
    const [internalScenarioId, externalScenarioId, barrier, expectedFrom, targetState] = w43BarrierPlan[index]!;
    const hash = digest(item["transitionHash"], "W43_BARRIER_TRANSITION_HASH_INVALID");
    const stateContentHash = (state: unknown): string => state === "FINAL_B"
      ? finalContentHash
      : initialContentHash;
    if (item["sequence"] !== index + 1 || item["scenarioId"] !== externalScenarioId ||
        item["barrier"] !== barrier || item["status"] !== "PASS" ||
        item["expectedFrom"] !== expectedFrom || item["targetState"] !== targetState ||
        item["beforeState"] !== expectedFrom || item["afterState"] !== targetState ||
        item["beforeContentHash"] !== stateContentHash(expectedFrom) ||
        item["afterContentHash"] !== stateContentHash(targetState) ||
        item["previousTransitionHash"] !== previous || hash !== transitionHash(item) ||
        (index > 0 && item["beforeState"] !== asObject(
          transitions[index - 1], "W43_BARRIER_TRANSITION_INVALID",
        )["afterState"]) ||
        item["providerRuntimeIdentityHashBefore"] !== providerRuntimeHash ||
        item["providerRuntimeIdentityHashAfter"] !== providerRuntimeHash ||
        item["providerManifestHashBefore"] !== providerManifestHash ||
        item["providerManifestHashAfter"] !== providerManifestHash ||
        item["foundationSchemaFingerprintBefore"] !== invariantHashes["foundationSchemaFingerprintBefore"] ||
        item["foundationSchemaFingerprintAfter"] !== invariantHashes["foundationSchemaFingerprintBefore"] ||
        item["foundationDataFingerprintBefore"] !== invariantHashes["foundationDataFingerprintBefore"] ||
        item["foundationDataFingerprintAfter"] !== invariantHashes["foundationDataFingerprintBefore"] ||
        item["nonTargetFingerprintBefore"] !== invariantHashes["nonTargetFingerprintBefore"] ||
        item["nonTargetFingerprintAfter"] !== invariantHashes["nonTargetFingerprintBefore"] ||
        item["providerRuntimeInvariant"] !== true || item["foundationInvariant"] !== true ||
        item["nonTargetInvariant"] !== true || item["directProviderCalls"] !== 0 ||
        item["credentialMaterialRecorded"] !== false ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(String(item["recordedAt"] ?? "")) ||
        Number.isNaN(Date.parse(String(item["recordedAt"])))) {
      fail("W43_BARRIER_TRANSITION_CHAIN_INVALID", String(index + 1));
    }
    digest(item["journalIntentHash"], "W43_BARRIER_JOURNAL_INTENT_HASH_INVALID");
    const values = grouped.get(internalScenarioId) ?? [];
    values.push(hash);
    grouped.set(internalScenarioId, values);
    previous = hash;
  });
  return new Map(w43ScenarioIds.map((scenarioId) => {
    const values = grouped.get(scenarioId);
    if (!values || values.length === 0) fail("W43_BARRIER_SCENARIO_MISSING", scenarioId);
    return [scenarioId, values] as const;
  }));
}

function validateW43ScenarioSource(
  value: unknown,
  barrierHashes: readonly string[],
): JsonObject {
  const scenario = asObject(value, "W43_CURRENTNESS_SCENARIO_INVALID");
  exactKeys(scenario, [
    "scenarioId", "replayMode", "groundingStatus", "terminalStatus", "normalizedStatus", "currentness",
    "semanticCode", "warnings", "priorContentHash", "currentContentHash", "sourceOperationKey",
    "executedOperationKeys", "checkCurrentExecutionCount", "originalSourceExecutionCount",
    "newCurrentSourceExecutionCount", "sourceChangedDuringQueryCount", "retryCount", "historicalPayloadRead",
    "productVersionPresent", "priorGroundingLoaded", "currentnessEvidencePersisted", "sourceGroundingIdHash",
    "replayGroundingIdHash", "persistedResultHash", "sourceRequestEvidenceHash", "replayRequestEvidenceHash",
    "sourcePlanHash", "barrierTransitionHashes", "causalBindingHash", "authorityTupleHash",
    "currentnessDecisionHash", "sourceBarrierTransitionHash", "replayBarrierTransitionHash",
    "replayBarrierArm",
  ], "W43_CURRENTNESS_SCENARIO_FIELDS_INVALID");
  const scenarioId = asString(scenario["scenarioId"], "W43_CURRENTNESS_SCENARIO_INVALID");
  const expected = w43ScenarioExpectations[scenarioId as W43ScenarioId];
  const warnings = asArray(scenario["warnings"], "W43_CURRENTNESS_WARNINGS_INVALID")
    .map((entry) => asString(entry, "W43_CURRENTNESS_WARNINGS_INVALID"));
  const operations = asArray(scenario["executedOperationKeys"], "W43_CURRENTNESS_OPERATIONS_INVALID")
    .map((entry) => asString(entry, "W43_CURRENTNESS_OPERATIONS_INVALID"));
  if (!w43ScenarioIds.includes(scenarioId as W43ScenarioId) ||
      !expected || scenario["replayMode"] !== expected["replayMode"] ||
      scenario["groundingStatus"] !== expected["groundingStatus"] ||
      scenario["terminalStatus"] !== expected["terminalStatus"] ||
      scenario["normalizedStatus"] !== expected["normalizedStatus"] ||
      scenario["currentness"] !== expected["currentness"] ||
      scenario["semanticCode"] !== expected["semanticCode"] ||
      canonicalJson([...warnings].sort()) !== canonicalJson(
        [...asArray(expected["warnings"], "W43_CURRENTNESS_EXPECTATION_INVALID")].sort(),
      ) || new Set(warnings).size !== warnings.length || new Set(operations).size !== operations.length ||
      scenario["historicalPayloadRead"] !== false || scenario["productVersionPresent"] !== false ||
      scenario["priorGroundingLoaded"] !== true || scenario["currentnessEvidencePersisted"] !== true ||
      scenario["checkCurrentExecutionCount"] !== 1 || scenario["originalSourceExecutionCount"] !== 0 ||
      scenario["newCurrentSourceExecutionCount"] !== expected["newCurrentSourceExecutionCount"] ||
      scenario["sourceChangedDuringQueryCount"] !== expected["sourceChangedDuringQueryCount"] ||
      scenario["retryCount"] !== expected["retryCount"] ||
      scenario["sourceOperationKey"] !== "geo-raster.sample@1.0" ||
      !operations.includes("geo-product.check-current@1.0") ||
      (Number(scenario["newCurrentSourceExecutionCount"]) > 0
        ? !operations.includes("geo-raster.sample@1.0")
        : operations.length !== 1) ||
      JSON.stringify(scenario["barrierTransitionHashes"]) !== JSON.stringify(barrierHashes) ||
      scenario["sourceBarrierTransitionHash"] !== barrierHashes[0] ||
      scenario["replayBarrierTransitionHash"] !== barrierHashes[
        w43ReplayBarrierIndex[scenarioId as W43ScenarioId]
      ] ||
      (scenarioId === "SOURCE_CHANGED_TWICE"
        ? !isObject(scenario["replayBarrierArm"])
        : scenario["replayBarrierArm"] !== null)) {
    fail("W43_CURRENTNESS_SCENARIO_TRUTH_INVALID", scenarioId);
  }
  for (const field of [
    "priorContentHash", "sourceRequestEvidenceHash", "replayRequestEvidenceHash", "sourcePlanHash",
    "causalBindingHash", "sourceGroundingIdHash", "replayGroundingIdHash", "persistedResultHash",
    "authorityTupleHash", "currentnessDecisionHash", "sourceBarrierTransitionHash",
    "replayBarrierTransitionHash",
  ]) digest(scenario[field], `W43_CURRENTNESS_SCENARIO_${field.toUpperCase()}_INVALID`);
  if (scenario["currentContentHash"] !== null) {
    digest(scenario["currentContentHash"], "W43_CURRENTNESS_SCENARIO_CURRENT_HASH_INVALID");
  }
  if (scenario["currentness"] === "NOT_AVAILABLE"
      ? scenario["currentContentHash"] !== null
      : scenario["currentContentHash"] === null ||
        (scenario["currentness"] === "CURRENT"
          ? scenario["currentContentHash"] !== scenario["priorContentHash"]
          : scenario["currentContentHash"] === scenario["priorContentHash"])) {
    fail("W43_CURRENTNESS_CONTENT_HASH_SEMANTICS_INVALID", scenarioId);
  }
  for (const hash of barrierHashes) digest(hash, "W43_CURRENTNESS_BARRIER_HASH_INVALID");
  if (new Set(barrierHashes).size !== barrierHashes.length) {
    fail("W43_CURRENTNESS_BARRIER_HASHES_INVALID", scenarioId);
  }
  asNonNegativeInteger(scenario["newCurrentSourceExecutionCount"], "W43_CURRENTNESS_EXECUTION_COUNT_INVALID");
  asNonNegativeInteger(scenario["sourceChangedDuringQueryCount"], "W43_CURRENTNESS_SOURCE_CHANGE_COUNT_INVALID");
  asNonNegativeInteger(scenario["retryCount"], "W43_CURRENTNESS_RETRY_COUNT_INVALID");
  return scenario;
}

function w43ScenarioSummary(scenario: JsonObject): JsonObject {
  return Object.fromEntries([
    "scenarioId", "replayMode", "groundingStatus", "terminalStatus", "normalizedStatus", "currentness",
    "semanticCode", "warnings", "priorContentHash", "currentContentHash", "checkCurrentExecutionCount",
    "originalSourceExecutionCount", "newCurrentSourceExecutionCount", "sourceChangedDuringQueryCount",
    "retryCount", "historicalPayloadRead", "productVersionPresent", "currentnessEvidencePersisted",
    "authorityTupleHash", "currentnessDecisionHash", "sourceRequestEvidenceHash", "replayRequestEvidenceHash",
    "sourcePlanHash", "sourceBarrierTransitionHash", "replayBarrierTransitionHash", "replayBarrierArm",
    "barrierTransitionHashes", "causalBindingHash",
  ].map((name) => [name, scenario[name]]));
}

function w43PostgresSummary(observation: JsonObject): JsonObject {
  return Object.fromEntries([
    "scenarioId", "groundingStatus", "transactionMode", "sourceGroundingRows", "replayGroundingRows",
    "resultRows", "stageRows", "executionRows", "currentnessEvidenceRows", "selectedProductRows",
    "priorGroundingLinkRows", "checkCurrentExecutionRows", "originalSourceExecutionRows",
    "newCurrentSourceExecutionRows", "sourceChangedDuringQueryRows", "currentnessDecisionHash",
    "sourceRequestEvidenceHash", "replayRequestEvidenceHash", "sourcePlanHash",
    "sourceBarrierTransitionHash", "replayBarrierTransitionHash", "replayBarrierArm",
    "barrierTransitionHashes", "causalBindingHash",
  ].map((name) => [name, observation[name]]));
}

function crossCheckW43ScenarioSources(context: W43ValidationContext): void {
  if (context.currentnessScenarios === undefined || context.postgresObservations === undefined) return;
  for (const scenarioId of w43ScenarioIds) {
    const scenario = context.currentnessScenarios.get(scenarioId);
    const observation = context.postgresObservations.get(scenarioId);
    if (!scenario || !observation) fail("W43_CROSS_SOURCE_SCENARIO_INVENTORY_INVALID", scenarioId);
    for (const [observationField, scenarioField] of [
      ["groundingStatus", "groundingStatus"],
      ["sourceGroundingIdHash", "sourceGroundingIdHash"],
      ["replayGroundingIdHash", "replayGroundingIdHash"],
      ["persistedResultHash", "persistedResultHash"],
      ["currentnessDecisionHash", "currentnessDecisionHash"],
      ["originalSourceExecutionRows", "originalSourceExecutionCount"],
      ["newCurrentSourceExecutionRows", "newCurrentSourceExecutionCount"],
      ["sourceChangedDuringQueryRows", "sourceChangedDuringQueryCount"],
      ["sourceRequestEvidenceHash", "sourceRequestEvidenceHash"],
      ["replayRequestEvidenceHash", "replayRequestEvidenceHash"],
      ["sourcePlanHash", "sourcePlanHash"],
      ["sourceBarrierTransitionHash", "sourceBarrierTransitionHash"],
      ["replayBarrierTransitionHash", "replayBarrierTransitionHash"],
      ["replayBarrierArm", "replayBarrierArm"],
      ["barrierTransitionHashes", "barrierTransitionHashes"],
      ["causalBindingHash", "causalBindingHash"],
    ] as const) {
      if (canonicalJson(observation[observationField]) !== canonicalJson(scenario[scenarioField])) {
        fail("W43_POSTGRES_CURRENTNESS_CROSS_CHECK_FAILED", `${scenarioId}:${observationField}`);
      }
    }
  }
}

function validateW43CommonFacts(
  facts: JsonObject,
  row: MatrixRow,
  binding: JsonObject,
): void {
  if (facts["gateRunId"] !== binding["gateRunId"] ||
      facts["runtimeIdentityHash"] !== binding["runtimeIdentityHash"] ||
      facts["matrixScenario"] !== row.scenario || facts["matrixExpected"] !== row.expected) {
    fail("W43_EVIDENCE_FACT_BINDING_INVALID", row.id);
  }
}

function validateW43ReplayBarrierArm(
  root: string,
  reference: unknown,
  binding: JsonObject,
  context: W43ValidationContext,
): void {
  bindW43Singleton(
    context,
    "replayBarrierArmReferenceJson",
    reference,
    "W43_REPLAY_BARRIER_ARM_REFERENCE_MISMATCH",
  );
  const loaded = loadJsonReference(root, reference, w43ReceiptPrefix, "W43_REPLAY_BARRIER_ARM");
  exactKeys(loaded.document, [
    "schemaVersion", "candidateSha", "gateRunId", "runtimeIdentityHash", "scenarioId", "barrier",
    "challengeHash", "controllerIdHash", "sidecarContractHash",
  ], "W43_REPLAY_BARRIER_ARM_FIELDS_INVALID");
  if (loaded.document["schemaVersion"] !== "wsgs-gdps-v021-w43-barrier-arm/1.0" ||
      loaded.document["candidateSha"] !== binding["candidateSha"] ||
      loaded.document["gateRunId"] !== binding["gateRunId"] ||
      loaded.document["runtimeIdentityHash"] !== binding["runtimeIdentityHash"] ||
      loaded.document["scenarioId"] !== "W43-SOURCE-CHANGED-TWICE-INDETERMINATE" ||
      loaded.document["barrier"] !== "AFTER_FIRST_SOURCE_CHANGED:B_TO_A") {
    fail("W43_REPLAY_BARRIER_ARM_BINDING_INVALID");
  }
  for (const field of ["challengeHash", "controllerIdHash", "sidecarContractHash"] as const) {
    digest(loaded.document[field], "W43_REPLAY_BARRIER_ARM_DIGEST_INVALID");
  }
}

function validateW43CurrentnessFacts(
  root: string,
  facts: JsonObject,
  row: MatrixRow,
  expectedCandidateSha: string,
  context: W43ValidationContext,
): void {
  const receipt = loadJsonReference(root, facts["sourceReceipt"], w43ReceiptPrefix, "W43_CURRENTNESS_RECEIPT");
  const document = receipt.document;
  exactKeys(document, [
    "schemaVersion", "generatedAt", "binding", "authorityTupleHash", "barrierAttestation", "scenarios",
  ], "W43_CURRENTNESS_RECEIPT_FIELDS_INVALID");
  bindW43Singleton(
    context,
    "currentnessReceiptJson",
    facts["sourceReceipt"],
    "W43_CURRENTNESS_RECEIPT_REFERENCE_MISMATCH",
  );
  if (document["schemaVersion"] !== "wsgs-gdps-v021-currentness-runner-receipt/1.0" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(String(document["generatedAt"] ?? "")) ||
      Number.isNaN(Date.parse(String(document["generatedAt"])))) {
    fail("W43_CURRENTNESS_RECEIPT_SCHEMA_INVALID");
  }
  const binding = w43RuntimeBinding(document["binding"], expectedCandidateSha);
  const authorityTupleHash = digest(document["authorityTupleHash"], "W43_AUTHORITY_TUPLE_HASH_INVALID");
  if (context.authorityTupleHash !== undefined && context.authorityTupleHash !== authorityTupleHash) {
    fail("W43_CROSS_ARTIFACT_AUTHORITY_TUPLE_MISMATCH");
  }
  context.authorityTupleHash = authorityTupleHash;
  const barrierReference = document["barrierAttestation"];
  if (!isObject(barrierReference)) fail("W43_BARRIER_LEDGER_REFERENCE_MISSING");
  if (canonicalJson(facts["barrierAttestation"]) !== canonicalJson(barrierReference)) {
    fail("W43_CURRENTNESS_BARRIER_REFERENCE_MISMATCH", row.id);
  }
  const barrier = validateW43BarrierLedger(root, barrierReference, binding);
  bindW43Context(context, binding, barrierReference);
  validateW43CommonFacts(facts, row, binding);
  const scenarios = asArray(document["scenarios"], "W43_CURRENTNESS_SCENARIOS_INVALID");
  if (scenarios.length !== w43ScenarioIds.length) fail("W43_CURRENTNESS_SCENARIO_INVENTORY_INVALID");
  const byId = new Map<W43ScenarioId, JsonObject>();
  for (const raw of scenarios) {
    const item = asObject(raw, "W43_CURRENTNESS_SCENARIO_INVALID");
    const scenarioId = asString(item["scenarioId"], "W43_CURRENTNESS_SCENARIO_INVALID") as W43ScenarioId;
    if (byId.has(scenarioId) || !barrier.has(scenarioId)) fail("W43_CURRENTNESS_SCENARIO_INVENTORY_INVALID");
    const validated = validateW43ScenarioSource(item, barrier.get(scenarioId)!);
    if (validated["authorityTupleHash"] !== authorityTupleHash) {
      fail("W43_CURRENTNESS_AUTHORITY_TUPLE_MISMATCH", scenarioId);
    }
    byId.set(scenarioId, validated);
  }
  const armed = [...byId.values()].filter((scenario) => scenario["replayBarrierArm"] !== null);
  if (armed.length !== 1 || armed[0]?.["scenarioId"] !== "SOURCE_CHANGED_TWICE") {
    fail("W43_REPLAY_BARRIER_ARM_INVENTORY_INVALID");
  }
  validateW43ReplayBarrierArm(root, armed[0]["replayBarrierArm"], binding, context);
  const currentnessJson = canonicalJson([...byId].map(([id, scenario]) => [id, scenario]));
  if (context.currentnessScenarios !== undefined &&
      canonicalJson([...context.currentnessScenarios]) !== currentnessJson) {
    fail("W43_CURRENTNESS_RECEIPT_CONTENT_MISMATCH");
  }
  context.currentnessScenarios = byId;
  crossCheckW43ScenarioSources(context);
  const expectedScenarioIds = w43ScenariosByAcceptanceId[row.id];
  if (!expectedScenarioIds) fail("W43_CURRENTNESS_ACCEPTANCE_MAPPING_MISSING", row.id);
  const derived = expectedScenarioIds.map((scenarioId) => w43ScenarioSummary(byId.get(scenarioId)!));
  if (canonicalJson(facts["policyFacts"]) !== canonicalJson(derived)) {
    fail("W43_CURRENTNESS_FACT_RECOMPUTE_MISMATCH", row.id);
  }
}

function validateW43UnitFacts(
  root: string,
  facts: JsonObject,
  row: MatrixRow,
  expectedCandidateSha: string,
  context: W43ValidationContext,
): void {
  const receipt = loadJsonReference(root, facts["sourceReceipt"], w43ReceiptPrefix, "W43_UNIT_RECEIPT");
  const document = receipt.document;
  exactKeys(document, [
    "schemaVersion", "generatedAt", "binding", "runner", "runnerVersion", "testFiles", "exitCode",
    "rawReport",
  ], "W43_UNIT_RECEIPT_FIELDS_INVALID");
  bindW43Singleton(context, "unitReceiptJson", facts["sourceReceipt"], "W43_UNIT_RECEIPT_REFERENCE_MISMATCH");
  if (document["schemaVersion"] !== "wsgs-gdps-v021-w43-unit-receipt/1.0" ||
      document["runner"] !== "vitest" || document["exitCode"] !== 0 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(String(document["generatedAt"] ?? "")) ||
      Number.isNaN(Date.parse(String(document["generatedAt"])))) fail("W43_UNIT_RECEIPT_TRUTH_INVALID");
  const binding = w43RuntimeBinding(document["binding"], expectedCandidateSha);
  bindW43Context(context, binding);
  validateW43CommonFacts(facts, row, binding);
  const rawReference = document["rawReport"];
  if (canonicalJson(facts["rawVitestReport"]) !== canonicalJson(rawReference)) {
    fail("W43_UNIT_RAW_REFERENCE_MISMATCH", row.id);
  }
  bindW43Singleton(context, "rawUnitReportJson", rawReference, "W43_UNIT_RAW_REFERENCE_CROSS_ROW_MISMATCH");
  const raw = loadJsonReference(root, rawReference, w43ReceiptPrefix, "W43_UNIT_RAW_REPORT");
  exactKeys(raw.document, [
    "schemaVersion", "runner", "runnerVersion", "selectedTestCount", "testResults",
  ], "W43_UNIT_RAW_REPORT_FIELDS_INVALID");
  if (raw.document["schemaVersion"] !== "wsgs-gdps-v021-w43-canonical-vitest-report/1.0" ||
      raw.document["runner"] !== "vitest") fail("W43_UNIT_RAW_REPORT_IDENTITY_INVALID");
  const passed = new Map<string, JsonObject>();
  for (const fileRaw of asArray(raw.document["testResults"], "W43_UNIT_RAW_RESULTS_INVALID")) {
    const file = asObject(fileRaw, "W43_UNIT_RAW_FILE_INVALID");
    const filePath = asString(file["filePath"], "W43_UNIT_RAW_FILE_INVALID");
    if (/^[A-Za-z]:|^\/|\\|\.\./u.test(filePath)) fail("W43_UNIT_RAW_FILE_PATH_INVALID", filePath);
    for (const assertionRaw of asArray(file["assertions"], "W43_UNIT_RAW_ASSERTIONS_INVALID")) {
      const assertion = asObject(assertionRaw, "W43_UNIT_RAW_ASSERTION_INVALID");
      if (assertion["status"] !== "passed") fail("W43_UNIT_RAW_ASSERTION_NOT_PASSED");
      const fullName = asString(assertion["fullName"], "W43_UNIT_RAW_ASSERTION_INVALID");
      passed.set(fullName, { filePath, fullName, status: "passed" });
    }
  }
  if (raw.document["selectedTestCount"] !== passed.size || passed.size < 1) {
    fail("W43_UNIT_RAW_TEST_INVENTORY_INVALID");
  }
  const claimed = asArray(facts["independentlyPassedTests"], "W43_UNIT_FACTS_INVALID")
    .map((entry) => asObject(entry, "W43_UNIT_FACT_INVALID"));
  if (claimed.length < 1 || claimed.some((entry) => {
    const source = passed.get(String(entry["fullName"] ?? ""));
    return !source || canonicalJson(source) !== canonicalJson(entry);
  })) fail("W43_UNIT_FACT_RECOMPUTE_MISMATCH", row.id);
}

function validateW43PostgresFacts(
  root: string,
  facts: JsonObject,
  row: MatrixRow,
  expectedCandidateSha: string,
  context: W43ValidationContext,
): void {
  const receipt = loadJsonReference(root, facts["sourceReceipt"], w43ReceiptPrefix, "W43_POSTGRES_RECEIPT");
  const document = receipt.document;
  exactKeys(document, [
    "schemaVersion", "generatedAt", "binding", "authorityTupleHash", "barrierAttestation", "database",
    "negativeAssertions", "observations",
  ], "W43_POSTGRES_RECEIPT_FIELDS_INVALID");
  bindW43Singleton(
    context,
    "postgresReceiptJson",
    facts["sourceReceipt"],
    "W43_POSTGRES_RECEIPT_REFERENCE_MISMATCH",
  );
  if (document["schemaVersion"] !== "wsgs-gdps-v021-real-postgres-currentness-receipt/1.0" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(String(document["generatedAt"] ?? "")) ||
      Number.isNaN(Date.parse(String(document["generatedAt"])))) {
    fail("W43_POSTGRES_RECEIPT_SCHEMA_INVALID");
  }
  const binding = w43RuntimeBinding(document["binding"], expectedCandidateSha);
  const authorityTupleHash = digest(
    document["authorityTupleHash"],
    "W43_POSTGRES_AUTHORITY_TUPLE_HASH_INVALID",
  );
  if (facts["authorityTupleHash"] !== authorityTupleHash ||
      (context.authorityTupleHash !== undefined && context.authorityTupleHash !== authorityTupleHash)) {
    fail("W43_POSTGRES_AUTHORITY_TUPLE_MISMATCH", row.id);
  }
  context.authorityTupleHash = authorityTupleHash;
  const barrierReference = document["barrierAttestation"];
  if (!isObject(barrierReference)) fail("W43_POSTGRES_BARRIER_REFERENCE_MISSING");
  if (canonicalJson(facts["barrierAttestation"]) !== canonicalJson(barrierReference)) {
    fail("W43_POSTGRES_BARRIER_REFERENCE_MISMATCH", row.id);
  }
  validateW43BarrierLedger(root, barrierReference, binding);
  bindW43Context(context, binding, barrierReference);
  validateW43CommonFacts(facts, row, binding);
  if (facts["databaseIdentityHash"] !== binding["databaseIdentityHash"]) {
    fail("W43_POSTGRES_DATABASE_BINDING_INVALID", row.id);
  }
  const database = asObject(document["database"], "W43_POSTGRES_DATABASE_INVALID");
  exactKeys(database, [
    "engine", "serverVersion", "executionClass", "mockUsed", "connectionIdentityHash",
    "migrationReceiptHash", "queryTranscriptHash",
  ], "W43_POSTGRES_DATABASE_FIELDS_INVALID");
  if (database["engine"] !== "PostgreSQL" || database["executionClass"] !== "REAL_ISOLATED_POSTGRESQL" ||
      database["mockUsed"] !== false || database["connectionIdentityHash"] !== binding["databaseIdentityHash"] ||
      !/^1[7-9](?:\.[0-9]+){0,2}$/u.test(String(database["serverVersion"] ?? ""))) {
    fail("W43_POSTGRES_DATABASE_TRUTH_INVALID");
  }
  digest(database["migrationReceiptHash"], "W43_POSTGRES_MIGRATION_HASH_INVALID");
  digest(database["queryTranscriptHash"], "W43_POSTGRES_TRANSCRIPT_HASH_INVALID");
  const observations = asArray(document["observations"], "W43_POSTGRES_OBSERVATIONS_INVALID");
  const byId = new Map<W43ScenarioId, JsonObject>();
  for (const raw of observations) {
    const item = asObject(raw, "W43_POSTGRES_OBSERVATION_INVALID");
    exactKeys(item, [
      "scenarioId", "groundingStatus", "sourceGroundingIdHash", "replayGroundingIdHash",
      "persistedResultHash", "currentnessDecisionHash", "transactionMode", "sourceGroundingRows",
      "replayGroundingRows", "resultRows", "stageRows", "executionRows", "currentnessEvidenceRows",
      "selectedProductRows", "priorGroundingLinkRows", "checkCurrentExecutionRows",
      "originalSourceExecutionRows", "newCurrentSourceExecutionRows", "sourceChangedDuringQueryRows",
      "sourceRequestEvidenceHash", "replayRequestEvidenceHash", "sourcePlanHash",
      "sourceBarrierTransitionHash", "replayBarrierTransitionHash", "replayBarrierArm",
      "barrierTransitionHashes", "causalBindingHash",
    ], "W43_POSTGRES_OBSERVATION_FIELDS_INVALID");
    const scenarioId = asString(item["scenarioId"], "W43_POSTGRES_OBSERVATION_INVALID") as W43ScenarioId;
    if (!w43ScenarioIds.includes(scenarioId) || byId.has(scenarioId) || item["transactionMode"] !== "READ_ONLY" ||
        item["sourceGroundingRows"] !== 1 || item["replayGroundingRows"] !== 1 ||
        item["resultRows"] !== 1 || item["currentnessEvidenceRows"] !== 1 ||
        item["selectedProductRows"] !== 1 || item["priorGroundingLinkRows"] !== 1 ||
        item["checkCurrentExecutionRows"] !== 1 || item["originalSourceExecutionRows"] !== 0) {
      fail("W43_POSTGRES_OBSERVATION_TRUTH_INVALID", scenarioId);
    }
    for (const field of [
      "sourceGroundingIdHash", "replayGroundingIdHash", "persistedResultHash", "currentnessDecisionHash",
      "sourceRequestEvidenceHash", "replayRequestEvidenceHash", "sourcePlanHash",
      "sourceBarrierTransitionHash", "replayBarrierTransitionHash", "causalBindingHash",
    ] as const) digest(item[field], "W43_POSTGRES_OBSERVATION_HASH_INVALID");
    const barrierHashes = asArray(item["barrierTransitionHashes"], "W43_POSTGRES_BARRIER_HASHES_INVALID")
      .map((value) => digest(value, "W43_POSTGRES_BARRIER_HASH_INVALID"));
    if (new Set(barrierHashes).size !== barrierHashes.length || barrierHashes.length < 1) {
      fail("W43_POSTGRES_BARRIER_HASHES_INVALID", scenarioId);
    }
    byId.set(scenarioId, item);
  }
  if (byId.size !== w43ScenarioIds.length) fail("W43_POSTGRES_OBSERVATION_INVENTORY_INVALID");
  if (context.postgresObservations !== undefined &&
      canonicalJson([...context.postgresObservations]) !== canonicalJson([...byId])) {
    fail("W43_POSTGRES_RECEIPT_CONTENT_MISMATCH");
  }
  context.postgresObservations = byId;
  crossCheckW43ScenarioSources(context);
  const expectedScenarioIds = w43ScenariosByAcceptanceId[row.id];
  if (!expectedScenarioIds) fail("W43_POSTGRES_ACCEPTANCE_MAPPING_MISSING", row.id);
  const derived = expectedScenarioIds.map((scenarioId) => w43PostgresSummary(byId.get(scenarioId)!));
  if (canonicalJson(facts["persistedFacts"]) !== canonicalJson(derived)) {
    fail("W43_POSTGRES_FACT_RECOMPUTE_MISMATCH", row.id);
  }
  const negative = asObject(document["negativeAssertions"], "W43_POSTGRES_NEGATIVE_ASSERTIONS_MISSING");
  exactKeys(negative, [
    "foreignScope", "foreignPrincipal", "priorResultHashMismatch",
  ], "W43_POSTGRES_NEGATIVE_ASSERTIONS_INVALID");
  for (const name of ["foreignScope", "foreignPrincipal", "priorResultHashMismatch"] as const) {
    const assertion = asObject(negative[name], "W43_POSTGRES_NEGATIVE_ASSERTIONS_INVALID");
    exactKeys(assertion, ["status", "matchingRows"], "W43_POSTGRES_NEGATIVE_ASSERTIONS_INVALID");
    if (assertion["status"] !== "DENIED" || assertion["matchingRows"] !== 0) {
      fail("W43_POSTGRES_NEGATIVE_ASSERTIONS_INVALID", name);
    }
  }
  if (canonicalJson(facts["negativeAssertions"]) !== canonicalJson(negative)) {
    fail("W43_POSTGRES_NEGATIVE_ASSERTIONS_INVALID", "facts mismatch");
  }
}

function validateW43Report(
  root: string,
  report: LoadedReport,
  policy: Policy,
  expectedCandidateSha: string,
  rowsById: ReadonlyMap<string, MatrixRow>,
  validators: ReportContractValidators,
  globalPaths: Set<string>,
  globalHashes: Set<string>,
): ReadonlyMap<string, AssertionArtifact> {
  const document = asObject(report.artifactDocument, "W43_REPORT_JSON_INVALID");
  if (!validators.w43Phase(document)) {
    fail(
      "W43_REPORT_SCHEMA_INVALID",
      validators.w43Phase.errors?.map((entry) => entry.message ?? "invalid").join("; "),
    );
  }
  exactKeys(document, [
    "schemaVersion",
    "generatedAt",
    "candidateSha",
    "target",
    "phase",
    "status",
    "evidenceLedger",
  ], "W43_REPORT_FIELDS_INVALID");
  const generatedAt = asString(document["generatedAt"], "W43_REPORT_GENERATED_AT_INVALID");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(generatedAt) ||
      Number.isNaN(Date.parse(generatedAt))) {
    fail("W43_REPORT_GENERATED_AT_INVALID");
  }
  if (document["schemaVersion"] !== GDPS_V021_W43_REPORT_SCHEMA_VERSION ||
      document["candidateSha"] !== expectedCandidateSha ||
      document["phase"] !== "W43" ||
      document["status"] !== report.manifest.reportStatus ||
      !sameTarget(targetFrom(document["target"], "W43_REPORT_TARGET_INVALID"), policy.target)) {
    fail("W43_REPORT_IDENTITY_INVALID");
  }
  const ledger = asObject(document["evidenceLedger"], "W43_EVIDENCE_LEDGER_INVALID");
  exactKeys(
    ledger,
    ["schemaVersion", "candidateSha", "phase", "artifacts"],
    "W43_EVIDENCE_LEDGER_FIELDS_INVALID",
  );
  if (ledger["schemaVersion"] !== GDPS_V021_W43_EVIDENCE_LEDGER_SCHEMA_VERSION ||
      ledger["candidateSha"] !== expectedCandidateSha || ledger["phase"] !== "W43") {
    fail("W43_EVIDENCE_LEDGER_IDENTITY_INVALID");
  }
  const passAssertions = report.manifest.assertions.filter((assertion) => assertion.status === "PASS");
  const assertionsById = new Map<string, AssertionManifest>();
  for (const assertion of report.manifest.assertions) {
    if (assertionsById.has(assertion.assertionId)) {
      fail("W43_ASSERTION_ID_REUSED", assertion.assertionId);
    }
    assertionsById.set(assertion.assertionId, assertion);
  }
  const artifacts = asArray(ledger["artifacts"], "W43_EVIDENCE_LEDGER_ARTIFACTS_INVALID");
  if (artifacts.length !== passAssertions.length) {
    fail(
      "W43_EVIDENCE_LEDGER_INVENTORY_INVALID",
      `artifacts=${artifacts.length} passAssertions=${passAssertions.length}`,
    );
  }
  const assertionArtifacts = new Map<string, AssertionArtifact>();
  const validationContext: W43ValidationContext = {};
  for (const raw of artifacts) {
    const record = asObject(raw, "W43_EVIDENCE_LEDGER_ARTIFACT_INVALID");
    exactKeys(record, [
      "acceptanceId",
      "evidenceType",
      "assertionId",
      "artifactPath",
      "artifactHash",
      "byteLength",
    ], "W43_EVIDENCE_LEDGER_ARTIFACT_FIELDS_INVALID");
    const acceptanceId = asString(record["acceptanceId"], "W43_EVIDENCE_LEDGER_ARTIFACT_INVALID");
    const evidenceType = asString(record["evidenceType"], "W43_EVIDENCE_LEDGER_ARTIFACT_INVALID");
    const assertionId = asString(record["assertionId"], "W43_EVIDENCE_LEDGER_ARTIFACT_INVALID");
    const artifactPath = asString(record["artifactPath"], "W43_EVIDENCE_LEDGER_ARTIFACT_INVALID")
      .replaceAll("\\", "/");
    const artifactHash = digest(record["artifactHash"], "W43_EVIDENCE_LEDGER_ARTIFACT_INVALID");
    const byteLength = record["byteLength"];
    const assertion = assertionsById.get(assertionId);
    if (!assertion || assertion.status !== "PASS" || assertion.acceptanceId !== acceptanceId ||
        assertion.type !== evidenceType) {
      fail("W43_EVIDENCE_LEDGER_ASSERTION_MISMATCH", assertionId);
    }
    if (assertionArtifacts.has(assertionId)) fail("W43_EVIDENCE_LEDGER_ASSERTION_REUSED", assertionId);
    if (!artifactPath.startsWith(w43EvidenceArtifactPrefix) || !artifactPath.endsWith(".json")) {
      fail("W43_EVIDENCE_ARTIFACT_PATH_NOT_AUTHORIZED", artifactPath);
    }
    if (!Number.isSafeInteger(byteLength) || (byteLength as number) < 1) {
      fail("W43_EVIDENCE_ARTIFACT_LENGTH_INVALID", assertionId);
    }
    if (globalPaths.has(artifactPath)) fail("W43_EVIDENCE_ARTIFACT_PATH_REUSED", artifactPath);
    if (globalHashes.has(artifactHash)) fail("W43_EVIDENCE_ARTIFACT_HASH_REUSED", artifactHash);
    const artifact = repositoryFile(root, artifactPath, "W43_EVIDENCE_ARTIFACT_MISSING");
    if (artifact.repositoryPath !== artifactPath) {
      fail("W43_EVIDENCE_ARTIFACT_PATH_NOT_NORMALIZED", artifactPath);
    }
    if (artifact.bytes.byteLength !== byteLength) {
      fail("W43_EVIDENCE_ARTIFACT_LENGTH_DRIFT", assertionId);
    }
    if (sha256(artifact.bytes) !== artifactHash) {
      fail("W43_EVIDENCE_ARTIFACT_HASH_DRIFT", assertionId);
    }
    const artifactDocument = asObject(
      parseJson(artifact.bytes, "W43_EVIDENCE_ARTIFACT_JSON_INVALID"),
      "W43_EVIDENCE_ARTIFACT_INVALID",
    );
    assertNoSensitiveOrInternalMaterial(
      artifactDocument,
      "W43_EVIDENCE_ARTIFACT_SENSITIVE_MATERIAL",
    );
    if (!validators.w43Assertion(artifactDocument)) {
      fail(
        "W43_EVIDENCE_ARTIFACT_SCHEMA_INVALID",
        validators.w43Assertion.errors?.map((entry) => entry.message ?? "invalid").join("; "),
      );
    }
    exactKeys(artifactDocument, [
      "schemaVersion",
      "candidateSha",
      "acceptanceId",
      "evidenceType",
      "assertionId",
      "status",
      "facts",
    ], "W43_EVIDENCE_ARTIFACT_FIELDS_INVALID");
    const facts = asObject(artifactDocument["facts"], "W43_EVIDENCE_ARTIFACT_FACTS_INVALID");
    if (Object.keys(facts).length === 0 ||
        artifactDocument["schemaVersion"] !== GDPS_V021_W43_ASSERTION_EVIDENCE_SCHEMA_VERSION ||
        artifactDocument["candidateSha"] !== expectedCandidateSha ||
        artifactDocument["acceptanceId"] !== acceptanceId ||
        artifactDocument["evidenceType"] !== evidenceType ||
        artifactDocument["assertionId"] !== assertionId || artifactDocument["status"] !== "PASS") {
      fail("W43_EVIDENCE_ARTIFACT_BINDING_INVALID", assertionId);
    }
    const row = rowsById.get(acceptanceId);
    if (!row || row.phase !== "W43") fail("W43_EVIDENCE_ACCEPTANCE_ROW_INVALID", acceptanceId);
    if (evidenceType === "CURRENTNESS") {
      validateW43CurrentnessFacts(root, facts, row, expectedCandidateSha, validationContext);
    } else if (evidenceType === "UNIT") {
      validateW43UnitFacts(root, facts, row, expectedCandidateSha, validationContext);
    } else if (evidenceType === "REAL_POSTGRES") {
      validateW43PostgresFacts(root, facts, row, expectedCandidateSha, validationContext);
    } else fail("W43_EVIDENCE_TYPE_UNSUPPORTED", evidenceType);
    globalPaths.add(artifactPath);
    globalHashes.add(artifactHash);
    assertionArtifacts.set(assertionId, { repositoryPath: artifactPath, hash: artifactHash });
  }
  for (const assertion of passAssertions) {
    if (!assertionArtifacts.has(assertion.assertionId)) {
      fail("W43_PASS_ASSERTION_LEDGER_MISSING", assertion.assertionId);
    }
  }
  if (passAssertions.length > 0 &&
      (validationContext.bindingJson === undefined || validationContext.barrierReferenceJson === undefined ||
       validationContext.currentnessReceiptJson === undefined || validationContext.unitReceiptJson === undefined ||
       validationContext.rawUnitReportJson === undefined || validationContext.postgresReceiptJson === undefined ||
       validationContext.replayBarrierArmReferenceJson === undefined ||
       validationContext.authorityTupleHash === undefined ||
       validationContext.currentnessScenarios === undefined ||
       validationContext.postgresObservations === undefined)) {
    fail("W43_RUNTIME_EVIDENCE_INCOMPLETE");
  }
  return assertionArtifacts;
}

const typedReceiptSchemaVersions: Readonly<Record<string, string>> = Object.freeze({
  CI: "wsgs-gdps-v021-ci-receipt/1.0",
  CURRENTNESS: "wsgs-gdps-v021-currentness-receipt/1.0",
  GIT: "wsgs-gdps-v021-git-receipt/1.0",
  GOWM_GATEWAY: "wsgs-gdps-v021-gowm-gateway-receipt/1.0",
  REAL_NATURAL_LANGUAGE_E2E: "wsgs-gdps-v021-real-natural-language-e2e-receipt/1.0",
  REAL_POSTGRES: "wsgs-gdps-v021-real-postgres-receipt/1.0",
  REPORT: "wsgs-gdps-v021-report-receipt/1.0",
  RUNNING_GOWM_GATEWAY: "wsgs-gdps-v021-running-gowm-gateway-receipt/1.0",
  SCHEMA: "wsgs-gdps-v021-schema-receipt/1.0",
  SOURCE: "wsgs-gdps-v021-source-receipt/1.0",
  STATIC_GUARD: "wsgs-gdps-v021-static-guard-receipt/1.0",
  UNIT: "wsgs-gdps-v021-unit-receipt/1.0",
});

function validateGenericTypedReport(
  root: string,
  report: LoadedReport,
  policy: Policy,
  expectedCandidateSha: string,
  validators: ReportContractValidators,
  globalPaths: Set<string>,
  globalHashes: Set<string>,
): ReadonlyMap<string, AssertionArtifact> {
  if (!isObject(report.artifactDocument) ||
      report.artifactDocument["schemaVersion"] !== "wsgs-gdps-v021-phase-report/2.0") {
    return new Map();
  }
  const document = report.artifactDocument;
  exactKeys(document, [
    "schemaVersion", "generatedAt", "candidateSha", "target", "phase", "status", "evidenceLedger",
  ], "TYPED_REPORT_FIELDS_INVALID");
  if (document["candidateSha"] !== expectedCandidateSha || document["phase"] !== report.manifest.phase ||
      document["status"] !== report.manifest.reportStatus ||
      !sameTarget(targetFrom(document["target"], "TYPED_REPORT_TARGET_INVALID"), policy.target)) {
    fail("TYPED_REPORT_IDENTITY_INVALID", report.manifest.reportId);
  }
  const generatedAt = asString(document["generatedAt"], "TYPED_REPORT_GENERATED_AT_INVALID");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(generatedAt) ||
      Number.isNaN(Date.parse(generatedAt))) fail("TYPED_REPORT_GENERATED_AT_INVALID");
  const ledger = asObject(document["evidenceLedger"], "TYPED_EVIDENCE_LEDGER_INVALID");
  exactKeys(ledger, ["schemaVersion", "candidateSha", "phase", "artifacts"],
    "TYPED_EVIDENCE_LEDGER_FIELDS_INVALID");
  if (ledger["schemaVersion"] !== "wsgs-gdps-v021-typed-evidence-ledger/1.0" ||
      ledger["candidateSha"] !== expectedCandidateSha || ledger["phase"] !== report.manifest.phase) {
    fail("TYPED_EVIDENCE_LEDGER_IDENTITY_INVALID");
  }
  const passAssertions = report.manifest.assertions.filter((entry) => entry.status === "PASS");
  const assertionsById = new Map(passAssertions.map((entry) => [entry.assertionId, entry]));
  const artifacts = asArray(ledger["artifacts"], "TYPED_EVIDENCE_LEDGER_ARTIFACTS_INVALID");
  if (artifacts.length !== passAssertions.length) {
    fail("TYPED_EVIDENCE_LEDGER_INVENTORY_INVALID");
  }
  const verified = new Map<string, AssertionArtifact>();
  for (const raw of artifacts) {
    const record = asObject(raw, "TYPED_EVIDENCE_LEDGER_ARTIFACT_INVALID");
    exactKeys(record, [
      "acceptanceId", "evidenceType", "assertionId", "artifactPath", "artifactHash", "byteLength",
    ], "TYPED_EVIDENCE_LEDGER_ARTIFACT_FIELDS_INVALID");
    const acceptanceId = asString(record["acceptanceId"], "TYPED_EVIDENCE_LEDGER_ARTIFACT_INVALID");
    const evidenceType = asString(record["evidenceType"], "TYPED_EVIDENCE_LEDGER_ARTIFACT_INVALID");
    const assertionId = asString(record["assertionId"], "TYPED_EVIDENCE_LEDGER_ARTIFACT_INVALID");
    const assertion = assertionsById.get(assertionId);
    if (!assertion || assertion.acceptanceId !== acceptanceId || assertion.type !== evidenceType ||
        verified.has(assertionId)) fail("TYPED_EVIDENCE_LEDGER_ASSERTION_MISMATCH", assertionId);
    const path = assertCanonicalRepositoryPath(
      asString(record["artifactPath"], "TYPED_EVIDENCE_LEDGER_ARTIFACT_INVALID"),
      typedEvidenceArtifactPrefix,
      "TYPED_EVIDENCE_ARTIFACT_PATH_INVALID",
    );
    const expectedHash = digest(record["artifactHash"], "TYPED_EVIDENCE_ARTIFACT_HASH_INVALID");
    const expectedLength = record["byteLength"];
    if (!Number.isSafeInteger(expectedLength) || (expectedLength as number) < 2 ||
        globalPaths.has(path) || globalHashes.has(expectedHash)) {
      fail("TYPED_EVIDENCE_ARTIFACT_INVENTORY_INVALID", assertionId);
    }
    const file = repositoryFile(root, path, "TYPED_EVIDENCE_ARTIFACT_MISSING");
    if (file.repositoryPath !== path || file.bytes.byteLength !== expectedLength) {
      fail("TYPED_EVIDENCE_ARTIFACT_LENGTH_DRIFT", assertionId);
    }
    if (sha256(file.bytes) !== expectedHash) fail("TYPED_EVIDENCE_ARTIFACT_HASH_DRIFT", assertionId);
    const artifact = asObject(parseJson(file.bytes, "TYPED_EVIDENCE_ARTIFACT_JSON_INVALID"),
      "TYPED_EVIDENCE_ARTIFACT_INVALID");
    assertNoSensitiveOrInternalMaterial(artifact, "TYPED_EVIDENCE_ARTIFACT_SENSITIVE_MATERIAL");
    if (!validators.genericAssertion(artifact)) {
      fail("TYPED_EVIDENCE_ARTIFACT_SCHEMA_INVALID",
        validators.genericAssertion.errors?.map((entry) => entry.message ?? "invalid").join("; "));
    }
    if (artifact["candidateSha"] !== expectedCandidateSha || artifact["acceptanceId"] !== acceptanceId ||
        artifact["evidenceType"] !== evidenceType || artifact["assertionId"] !== assertionId ||
        artifact["status"] !== "PASS") fail("TYPED_EVIDENCE_ARTIFACT_BINDING_INVALID", assertionId);
    const facts = asObject(artifact["facts"], "TYPED_EVIDENCE_FACTS_INVALID");
    const receipt = loadJsonReference(root, facts["sourceReceipt"], typedReceiptPrefix,
      "TYPED_EVIDENCE_SOURCE_RECEIPT");
    exactKeys(receipt.document, [
      "schemaVersion", "candidateSha", "acceptanceId", "evidenceType", "verification",
    ], "TYPED_EVIDENCE_SOURCE_RECEIPT_FIELDS_INVALID");
    if (receipt.document["schemaVersion"] !== typedReceiptSchemaVersions[evidenceType] ||
        receipt.document["candidateSha"] !== expectedCandidateSha ||
        receipt.document["acceptanceId"] !== acceptanceId ||
        receipt.document["evidenceType"] !== evidenceType ||
        canonicalJson(receipt.document["verification"]) !== canonicalJson(facts["verification"])) {
      fail("TYPED_EVIDENCE_SOURCE_RECEIPT_BINDING_INVALID", assertionId);
    }
    const verification = asObject(receipt.document["verification"], "TYPED_EVIDENCE_VERIFICATION_INVALID");
    if (verification["kind"] !== evidenceType ||
        (evidenceType === "GIT" && verification["head"] !== expectedCandidateSha)) {
      fail("TYPED_EVIDENCE_VERIFICATION_INVALID", assertionId);
    }
    globalPaths.add(path);
    globalHashes.add(expectedHash);
    verified.set(assertionId, { repositoryPath: path, hash: expectedHash });
  }
  return verified;
}

function findNamedValues(value: unknown, names: ReadonlySet<string>, output: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const entry of value) findNamedValues(entry, names, output);
    return output;
  }
  if (!isObject(value)) return output;
  for (const [name, entry] of Object.entries(value)) {
    if (names.has(name)) output.push(entry);
    findNamedValues(entry, names, output);
  }
  return output;
}

function assertNoLegacyPositiveEvidence(
  report: LoadedReport,
  policy: Policy,
): void {
  const path = report.artifactRepositoryPath;
  if (policy.legacyEvidence.forbiddenReportPrefixes.some((prefix) =>
    path === prefix || path.startsWith(`${prefix}/`))) {
    fail("LEGACY_REPORT_FORBIDDEN", `${report.manifest.reportId}:${path}`);
  }
  const document = report.artifactDocument;
  if (!isObject(document)) return;
  const providerVersions = findNamedValues(document, new Set(["providerVersion"]));
  if (providerVersions.some((value) => policy.legacyEvidence.forbiddenProviderVersions.includes(String(value)))) {
    fail("LEGACY_PROVIDER_VERSION_FORBIDDEN", report.manifest.reportId);
  }
  const counts = findNamedValues(document, new Set(["capabilityCount", "operationCount"]));
  if (counts.some((value) => policy.legacyEvidence.forbiddenCapabilityCounts.includes(Number(value)))) {
    fail("LEGACY_CAPABILITY_COUNT_FORBIDDEN", report.manifest.reportId);
  }
  const sourceShas = findNamedValues(
    document,
    new Set(["candidateSha", "evidenceGitHead", "sourceCommit", "wsgsCommit"]),
  );
  if (sourceShas.some((value) => policy.legacyEvidence.forbiddenSourceShas.includes(String(value)))) {
    fail("LEGACY_SOURCE_SHA_FORBIDDEN", report.manifest.reportId);
  }
}

function assertArtifactCandidateIdentity(
  report: LoadedReport,
  expectedCandidateSha: string,
): void {
  const document = report.artifactDocument;
  if (!isObject(document)) return;
  const candidateBindings = findNamedValues(
    document,
    new Set(["candidateSha", "evidenceGitHead", "wsgsCommit"]),
  );
  if (candidateBindings.some((value) => value !== expectedCandidateSha)) {
    fail("REPORT_ARTIFACT_CANDIDATE_SHA_MISMATCH", report.manifest.reportId);
  }
  if (isObject(document["candidate"]) &&
      document["candidate"]["repository"] === "world-semantic-grounding-service" &&
      document["candidate"]["gitHead"] !== expectedCandidateSha) {
    fail("REPORT_ARTIFACT_CANDIDATE_SHA_MISMATCH", report.manifest.reportId);
  }
}

function loadRootManifest(bytes: Uint8Array): RootManifest {
  const raw = asObject(parseJson(bytes, "REPORT_MANIFEST_JSON_INVALID"), "REPORT_MANIFEST_INVALID");
  exactKeys(raw, [
    "schemaVersion", "candidate", "target", "matrix", "policy", "sourceReports", "phaseReports",
    "runtimeReports", "w44Report",
  ], "REPORT_MANIFEST_FIELDS_INVALID");
  if (raw["schemaVersion"] !== "wsgs-gdps-v021-evidence-report-manifest/1.0") {
    fail("REPORT_MANIFEST_SCHEMA_INVALID");
  }
  const candidate = asObject(raw["candidate"], "REPORT_MANIFEST_CANDIDATE_INVALID");
  exactKeys(candidate, ["repository", "gitHead"], "REPORT_MANIFEST_CANDIDATE_FIELDS_INVALID");
  const parseArtifactReference = (value: unknown, code: string) => {
    const entry = asObject(value, code);
    exactKeys(entry, ["artifactPath", "artifactHash"], `${code}_FIELDS_INVALID`);
    return {
      artifactPath: asString(entry["artifactPath"], code),
      artifactHash: digest(entry["artifactHash"], code),
    };
  };
  const parseReports = (value: unknown, code: string): ReportManifest[] => asArray(value, code)
    .map((item) => {
      const entry = asObject(item, code);
      exactKeys(entry, [
        "reportId", "phase", "reportStatus", "artifactPath", "artifactHash", "candidateSha", "target",
        "assertions",
      ], `${code}_FIELDS_INVALID`);
      const reportStatus = asString(entry["reportStatus"], code) as EvidenceStatus;
      if (!statuses.has(reportStatus)) fail(code);
      const assertions = asArray(entry["assertions"], code).map((rawAssertion) => {
        const assertion = asObject(rawAssertion, code);
        const assertionKeys = Object.keys(assertion).sort();
        const expectedKeys = ["acceptanceId", "type", "assertionId", "status", "polarity",
          ...(typeof assertion["reason"] === "string" ? ["reason"] : [])].sort();
        if (canonicalJson(assertionKeys) !== canonicalJson(expectedKeys)) fail(`${code}_ASSERTION_FIELDS_INVALID`);
        const status = asString(assertion["status"], code) as EvidenceStatus;
        const polarity = asString(assertion["polarity"], code) as EvidencePolarity;
        if (!statuses.has(status) || (polarity !== "POSITIVE" && polarity !== "NEGATIVE")) fail(code);
        return {
          acceptanceId: asString(assertion["acceptanceId"], code),
          type: asString(assertion["type"], code),
          assertionId: asString(assertion["assertionId"], code),
          status,
          polarity,
          ...(typeof assertion["reason"] === "string" && assertion["reason"].length > 0
            ? { reason: assertion["reason"] }
            : {}),
        };
      });
      return {
        reportId: asString(entry["reportId"], code),
        phase: asString(entry["phase"], code),
        reportStatus,
        artifactPath: asString(entry["artifactPath"], code),
        artifactHash: digest(entry["artifactHash"], code),
        candidateSha: commit(entry["candidateSha"], code),
        target: targetFrom(entry["target"], code),
        assertions,
      };
    });
  const w44Raw = raw["w44Report"];
  let w44Report: RootManifest["w44Report"] = null;
  if (w44Raw !== null && w44Raw !== undefined) {
    const entry = asObject(w44Raw, "REPORT_MANIFEST_W44_INVALID");
    exactKeys(entry, ["reportId", "artifactPath", "artifactHash"], "REPORT_MANIFEST_W44_FIELDS_INVALID");
    w44Report = {
      reportId: asString(entry["reportId"], "REPORT_MANIFEST_W44_INVALID"),
      artifactPath: asString(entry["artifactPath"], "REPORT_MANIFEST_W44_INVALID"),
      artifactHash: digest(entry["artifactHash"], "REPORT_MANIFEST_W44_INVALID"),
    };
  }
  return {
    schemaVersion: raw["schemaVersion"] as string,
    candidate: {
      repository: asString(candidate["repository"], "REPORT_MANIFEST_CANDIDATE_INVALID"),
      gitHead: commit(candidate["gitHead"], "REPORT_MANIFEST_CANDIDATE_INVALID"),
    },
    target: targetFrom(raw["target"], "REPORT_MANIFEST_TARGET_INVALID"),
    matrix: parseArtifactReference(raw["matrix"], "REPORT_MANIFEST_MATRIX_INVALID"),
    policy: parseArtifactReference(raw["policy"], "REPORT_MANIFEST_POLICY_INVALID"),
    sourceReports: parseReports(raw["sourceReports"], "REPORT_MANIFEST_SOURCE_REPORTS_INVALID"),
    phaseReports: parseReports(raw["phaseReports"], "REPORT_MANIFEST_PHASE_REPORTS_INVALID"),
    runtimeReports: parseReports(raw["runtimeReports"], "REPORT_MANIFEST_RUNTIME_REPORTS_INVALID"),
    w44Report,
  };
}

function validateW44Report(
  report: LoadedReport,
  expectedCandidateSha: string,
  w44Rows: readonly MatrixRow[],
  root: string,
): void {
  const document = asObject(report.artifactDocument, "W44_REPORT_JSON_INVALID");
  if (document["schemaVersion"] !== "wsgs-gdps-real-e2e-report/2.1" ||
      document["overallStatus"] !== "PASS") fail("W44_REPORT_NOT_PASS");
  const sourceIdentity = asObject(document["sourceIdentity"], "W44_SOURCE_IDENTITY_INVALID");
  if (sourceIdentity["wsgsCommit"] !== expectedCandidateSha ||
      sourceIdentity["providerId"] !== "gdps.geospatial-products" ||
      sourceIdentity["providerVersion"] !== "0.2.1" ||
      sourceIdentity["capabilityCount"] !== 30 ||
      !shaPattern.test(String(sourceIdentity["gdpsCommit"] ?? "")) ||
      !digestPattern.test(String(sourceIdentity["gowmIdentityHash"] ?? "")) ||
      !digestPattern.test(String(sourceIdentity["runtimeIdentityHash"] ?? ""))) {
    fail("W44_SOURCE_IDENTITY_INVALID");
  }
  const execution = asObject(document["execution"], "W44_EXECUTION_IDENTITY_INVALID");
  if (execution["requiredExecutionPath"] !== "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" ||
      execution["gatewayOnly"] !== true || execution["directProviderCalls"] !== 0 ||
      execution["mockTransportUsed"] !== false) fail("W44_GATEWAY_ONLY_NOT_PROVEN");
  const summary = asObject(document["summary"], "W44_SUMMARY_INVALID");
  if (summary["totalCases"] !== 16 || summary["passedCases"] !== 16 ||
      summary["failedCases"] !== 0 || summary["blockedCases"] !== 0 ||
      summary["notRunCases"] !== 0 || summary["requiredQualifications"] !== 12 ||
      summary["passedQualifications"] !== 12) fail("W44_SUMMARY_NOT_16_PLUS_12_PASS");
  if (asArray(document["policyErrors"], "W44_POLICY_ERRORS_INVALID").length !== 0) {
    fail("W44_POLICY_ERRORS_PRESENT");
  }
  const cases = asArray(document["cases"], "W44_CASES_INVALID");
  const qualifications = asArray(document["qualifications"], "W44_QUALIFICATIONS_INVALID");
  const expectedCases = w44Rows.filter((row) => row.id.startsWith("W44-E2E-"));
  const expectedQualifications = w44Rows.filter((row) => row.id.startsWith("W44-X"));
  if (cases.length !== 16 || qualifications.length !== 12 ||
      expectedCases.length !== 16 || expectedQualifications.length !== 12) {
    fail("W44_INVENTORY_INVALID");
  }
  cases.forEach((item, index) => {
    const entry = asObject(item, "W44_CASE_INVALID");
    if (entry["caseId"] !== expectedCases[index]!.scenario || entry["status"] !== "PASS") {
      fail("W44_CASE_NOT_PASS", expectedCases[index]!.id);
    }
  });
  qualifications.forEach((item, index) => {
    const entry = asObject(item, "W44_QUALIFICATION_INVALID");
    if (entry["qualificationId"] !== expectedQualifications[index]!.id || entry["status"] !== "PASS" ||
        !Array.isArray(entry["evidenceHashes"]) || entry["evidenceHashes"].length === 0 ||
        !entry["evidenceHashes"].every((value) => digestPattern.test(String(value)))) {
      fail("W44_QUALIFICATION_NOT_PASS", expectedQualifications[index]!.id);
    }
  });
  if (report.manifest.reportStatus !== "PASS") fail("W44_MANIFEST_STATUS_NOT_PASS");
  validateW44ReportContract(root, document);
  const artifactsById = verifyW44LedgerArtifactBytes(root, document);
  validateW44PolicyEvaluation(root, document, artifactsById);
}

function validateReportAssertions(
  report: LoadedReport,
  rowsById: ReadonlyMap<string, MatrixRow>,
  policy: Policy,
  expectedCandidateSha: string,
): void {
  const { manifest } = report;
  if (!reportIdPattern.test(manifest.reportId) || !phasePattern.test(manifest.phase)) {
    fail("REPORT_ID_OR_PHASE_INVALID", manifest.reportId);
  }
  if (manifest.candidateSha !== expectedCandidateSha ||
      policy.legacyEvidence.forbiddenSourceShas.includes(manifest.candidateSha)) {
    fail("REPORT_CANDIDATE_SHA_MISMATCH", manifest.reportId);
  }
  if (!sameTarget(manifest.target, policy.target)) fail("REPORT_TARGET_MISMATCH", manifest.reportId);
  if (manifest.artifactHash !== sha256(report.artifactBytes)) {
    fail("REPORT_ARTIFACT_HASH_DRIFT", manifest.reportId);
  }
  if (report.category === "SOURCE" && manifest.phase !== "W33") {
    fail("SOURCE_REPORT_PHASE_INVALID", manifest.reportId);
  }
  if (report.category === "RUNTIME" && manifest.phase !== "W44") {
    fail("RUNTIME_REPORT_PHASE_INVALID", manifest.reportId);
  }
  if (report.category === "PHASE" && (manifest.phase === "W33" || manifest.phase === "W44")) {
    fail("PHASE_REPORT_CATEGORY_INVALID", manifest.reportId);
  }
  assertArtifactCandidateIdentity(report, expectedCandidateSha);
  let hasPositivePass = false;
  const reportClaimKeys = new Set<string>();
  for (const assertion of manifest.assertions) {
    const row = rowsById.get(assertion.acceptanceId);
    if (!row || row.phase !== manifest.phase) fail("REPORT_ASSERTION_ROW_INVALID", assertion.acceptanceId);
    if (!assertionIdPattern.test(assertion.assertionId)) {
      fail("REPORT_ASSERTION_ID_INVALID", assertion.assertionId);
    }
    if (!policy.allowedEvidenceTypes.includes(assertion.type) ||
        !row.evidenceTypes.includes(assertion.type)) {
      fail("REPORT_ASSERTION_EVIDENCE_TYPE_INVALID", `${assertion.acceptanceId}:${assertion.type}`);
    }
    const claimKey = `${assertion.acceptanceId}:${assertion.type}`;
    if (reportClaimKeys.has(claimKey)) fail("DUPLICATE_ROW_EVIDENCE_TYPE", claimKey);
    reportClaimKeys.add(claimKey);
    if (assertion.polarity === "NEGATIVE" &&
        !policy.negativeAcceptanceIds.includes(assertion.acceptanceId)) {
      fail("NEGATIVE_ASSERTION_NOT_AUTHORIZED", assertion.acceptanceId);
    }
    if (assertion.status === "PASS" && assertion.polarity === "POSITIVE") hasPositivePass = true;
  }
  if (hasPositivePass) assertNoLegacyPositiveEvidence(report, policy);
}

function loadReports(
  root: string,
  manifest: RootManifest,
  policy: Policy,
  rowsById: ReadonlyMap<string, MatrixRow>,
  expectedCandidateSha: string,
  validators: ReportContractValidators,
): LoadedReport[] {
  const groups: readonly [ReportCategory, readonly ReportManifest[]][] = [
    ["SOURCE", manifest.sourceReports],
    ["PHASE", manifest.phaseReports],
    ["RUNTIME", manifest.runtimeReports],
  ];
  const reports: LoadedReport[] = [];
  const reportIds = new Set<string>();
  const paths = new Set<string>();
  const typedEvidencePaths = new Set<string>();
  const typedEvidenceHashes = new Set<string>();
  for (const [category, entries] of groups) {
    for (const entry of entries) {
      if (reportIds.has(entry.reportId)) fail("DUPLICATE_REPORT_ID", entry.reportId);
      const declaredPath = assertCanonicalRepositoryPath(
        entry.artifactPath,
        reportArtifactPrefix,
        "REPORT_ARTIFACT_PATH_NOT_CANONICAL",
      );
      if (declaredPath.endsWith("/acceptance-evidence-map.json") ||
          declaredPath.endsWith("/evidence-report-manifest.json")) {
        fail("PRESTORED_DERIVED_REPORT_ARTIFACT_FORBIDDEN", declaredPath);
      }
      const artifact = repositoryFile(root, entry.artifactPath, "REPORT_ARTIFACT_MISSING");
      if (paths.has(artifact.repositoryPath)) fail("DUPLICATE_REPORT_ARTIFACT", artifact.repositoryPath);
      reportIds.add(entry.reportId);
      paths.add(artifact.repositoryPath);
      let artifactDocument: unknown = null;
      if (artifact.repositoryPath.endsWith(".json")) {
        artifactDocument = parseJson(artifact.bytes, `REPORT_JSON_INVALID_${entry.reportId}`);
        assertNoSensitiveOrInternalMaterial(
          artifactDocument,
          `REPORT_SENSITIVE_OR_INTERNAL_MATERIAL_${entry.reportId}`,
        );
      }
      const loaded: LoadedReport = {
        category,
        manifest: entry,
        artifactRepositoryPath: artifact.repositoryPath,
        artifactBytes: artifact.bytes,
        artifactDocument,
        assertionArtifacts: new Map(),
      };
      validateReportAssertions(loaded, rowsById, policy, expectedCandidateSha);
      const assertionArtifacts = entry.phase === "W43"
        ? validateW43Report(
            root,
            loaded,
            policy,
            expectedCandidateSha,
            rowsById,
            validators,
            typedEvidencePaths,
            typedEvidenceHashes,
          )
        : entry.phase === "W44"
          ? loaded.assertionArtifacts
          : validateGenericTypedReport(
              root,
              loaded,
              policy,
              expectedCandidateSha,
              validators,
              typedEvidencePaths,
              typedEvidenceHashes,
            );
      reports.push({ ...loaded, assertionArtifacts });
    }
  }
  return reports;
}

function rowStatus(
  row: MatrixRow,
  assertions: readonly VerifiedAssertion[],
): { readonly status: EvidenceStatus; readonly reason?: string } {
  const resultAssertions = assertions.filter(({ status }) => status !== "NOT_RUN");
  if (resultAssertions.some(({ status }) => status === "FAIL")) {
    return { status: "FAIL", reason: "At least one exact typed assertion failed." };
  }
  if (resultAssertions.some(({ status }) => status === "BLOCKED")) {
    return { status: "BLOCKED", reason: "At least one required typed assertion is blocked." };
  }
  const passedTypes = new Set(resultAssertions
    .filter(({ status }) => status === "PASS")
    .map(({ assertion }) => assertion.type));
  const missing = row.evidenceTypes.filter((type) => !passedTypes.has(type));
  if (missing.length === 0) return { status: "PASS" };
  if (resultAssertions.length === 0) {
    return { status: "NOT_RUN", reason: `No exact typed evidence was supplied (${missing.join(",")}).` };
  }
  return { status: "BLOCKED", reason: `Required evidence types are missing: ${missing.join(",")}.` };
}

function blocker(code: string, detail: string): JsonObject {
  return { code, detail };
}

export function buildGdpsV021AcceptanceEvidenceMap(
  input: EvidenceMapBuildInput,
): EvidenceMapBuildResult {
  const root = resolve(input.repositoryRoot);
  const matrixFile = repositoryFile(
    root,
    input.matrixPath ?? "acceptance/gdps-v0.2.1/acceptance-matrix.csv",
    "MATRIX_FILE_MISSING",
  );
  const policyFile = repositoryFile(
    root,
    input.policyPath ?? "config/gdps-v021-acceptance-policy.json",
    "POLICY_FILE_MISSING",
  );
  const manifestFile = repositoryFile(root, input.manifestPath, "REPORT_MANIFEST_FILE_MISSING");
  const expectedManifestPath = `${reportArtifactPrefix}evidence-report-manifest.json`;
  if (manifestFile.repositoryPath !== expectedManifestPath) {
    fail("REPORT_MANIFEST_PATH_NOT_CANONICAL", manifestFile.repositoryPath);
  }
  const parsedManifest = parseJson(manifestFile.bytes, "REPORT_MANIFEST_JSON_INVALID");
  const canonicalManifestBytes = Buffer.from(`${JSON.stringify(parsedManifest, null, 2)}\n`, "utf8");
  if (!manifestFile.bytes.equals(canonicalManifestBytes)) fail("REPORT_MANIFEST_BYTES_NOT_CANONICAL");
  const matrix = loadMatrix(matrixFile.bytes);
  const w43Rows = matrix.filter((row) => row.phase === "W43");
  if (w43Rows.length !== 18 || w43Rows.some((row) =>
    JSON.stringify(row.evidenceTypes) !== JSON.stringify(w43EvidenceTypes))) {
    fail("W43_MATRIX_EVIDENCE_INVENTORY_INVALID");
  }
  const policy = loadPolicy(policyFile.bytes, matrix);
  const manifest = loadRootManifest(manifestFile.bytes);
  const validators = loadReportContractValidators(root);
  const expectedCandidateSha = commit(input.expectedCandidateSha, "EXPECTED_CANDIDATE_SHA_INVALID");
  if (manifest.candidate.repository !== "world-semantic-grounding-service" ||
      manifest.candidate.gitHead !== expectedCandidateSha ||
      policy.legacyEvidence.forbiddenSourceShas.includes(expectedCandidateSha)) {
    fail("REPORT_MANIFEST_CANDIDATE_MISMATCH");
  }
  if (!sameTarget(manifest.target, policy.target)) fail("REPORT_MANIFEST_TARGET_MISMATCH");
  if (manifest.matrix.artifactPath.replaceAll("\\", "/") !== matrixFile.repositoryPath ||
      manifest.matrix.artifactHash !== sha256(matrixFile.bytes)) fail("REPORT_MANIFEST_MATRIX_DRIFT");
  if (manifest.policy.artifactPath.replaceAll("\\", "/") !== policyFile.repositoryPath ||
      manifest.policy.artifactHash !== sha256(policyFile.bytes)) fail("REPORT_MANIFEST_POLICY_DRIFT");

  const rowsById = new Map(matrix.map((row) => [row.id, row]));
  const reports = loadReports(root, manifest, policy, rowsById, expectedCandidateSha, validators);
  let w44Pass = false;
  let w44Blocker = "W44 report was not supplied.";
  if (manifest.w44Report !== null) {
    const report = reports.find((entry) => entry.manifest.reportId === manifest.w44Report!.reportId);
    if (!report || report.category !== "RUNTIME" || report.manifest.phase !== "W44" ||
        report.artifactRepositoryPath !== manifest.w44Report.artifactPath.replaceAll("\\", "/") ||
        report.manifest.artifactHash !== manifest.w44Report.artifactHash) {
      fail("W44_REPORT_REFERENCE_MISMATCH");
    }
    validateW44Report(
      report,
      expectedCandidateSha,
      matrix.filter((row) => row.phase === "W44"),
      root,
    );
    w44Pass = true;
    w44Blocker = "";
  }

  const assertionsByRow = new Map<string, VerifiedAssertion[]>();
  const assertionIds = new Set<string>();
  const assertionTypeKeys = new Set<string>();
  for (const report of reports) {
    for (const assertion of report.manifest.assertions) {
      const globallyQualifiedAssertionId = `${report.manifest.reportId}:${assertion.assertionId}`;
      if (assertionIds.has(globallyQualifiedAssertionId)) {
        fail("DUPLICATE_ASSERTION_ID", globallyQualifiedAssertionId);
      }
      assertionIds.add(globallyQualifiedAssertionId);
      const typeKey = `${assertion.acceptanceId}:${assertion.type}`;
      if (assertionTypeKeys.has(typeKey)) fail("DUPLICATE_ROW_EVIDENCE_TYPE", typeKey);
      assertionTypeKeys.add(typeKey);
      const artifact = report.assertionArtifacts.get(assertion.assertionId);
      const derivedStatus: EvidenceStatus = assertion.status === "PASS"
        ? report.manifest.phase === "W44"
          ? w44Pass ? "PASS" : "NOT_RUN"
          : artifact ? "PASS" : "NOT_RUN"
        : assertion.status;
      const list = assertionsByRow.get(assertion.acceptanceId) ?? [];
      list.push({ report, assertion, status: derivedStatus, ...(artifact ? { artifact } : {}) });
      assertionsByRow.set(assertion.acceptanceId, list);
    }
  }

  const entries = matrix.map((row) => {
    const assertions = assertionsByRow.get(row.id) ?? [];
    const evaluation = rowStatus(row, assertions);
    const evidence = assertions
      .filter(({ status, report, artifact }) => status !== "NOT_RUN" &&
        (artifact !== undefined || (report.manifest.phase === "W44" && w44Pass)))
      .map(({ report, assertion, artifact }) => {
        return {
          type: assertion.type,
          artifact: artifact?.repositoryPath ?? report.artifactRepositoryPath,
          sha256: artifact?.hash ?? report.manifest.artifactHash,
          candidateSha: expectedCandidateSha,
          assertionId: assertion.assertionId,
          polarity: assertion.polarity,
          target: policy.target,
        };
      });
    return {
      acceptanceId: row.id,
      status: evaluation.status,
      evidence,
      ...(evaluation.reason ? { reason: evaluation.reason } : {}),
    };
  });
  const counts = Object.fromEntries([...statuses].map((status) => [
    status,
    entries.filter((entry) => entry.status === status).length,
  ])) as Record<EvidenceStatus, number>;
  const allRowsPass = counts.PASS === 327 && counts.FAIL === 0 &&
    counts.NOT_RUN === 0 && counts.BLOCKED === 0;
  const overallPass = allRowsPass && w44Pass;
  const overallFail = counts.FAIL > 0;
  const blockers: JsonObject[] = [];
  if (!w44Pass) blockers.push(blocker("W44_REPORT_NOT_PASS", w44Blocker));
  if (!allRowsPass) {
    blockers.push(blocker(
      overallFail ? "ACCEPTANCE_ROW_FAILED" : "ACCEPTANCE_ROWS_INCOMPLETE",
      `pass=${counts.PASS} fail=${counts.FAIL} blocked=${counts.BLOCKED} notRun=${counts.NOT_RUN}`,
    ));
  }
  const overallStatus: EvidenceStatus = overallPass ? "PASS" : overallFail ? "FAIL" : "BLOCKED";
  const document: JsonObject = {
    schemaVersion: "wsgs-gdps-acceptance-evidence-map/2.0",
    candidate: {
      repository: manifest.candidate.repository,
      gitHead: expectedCandidateSha,
    },
    target: policy.target,
    overall: {
      status: overallStatus,
      reasonCode: overallPass ? "ALL_327_AND_W44_PASS" : blockers[0]!["code"],
      blockers,
      counts,
    },
    provenance: {
      reportManifest: {
        artifactPath: manifestFile.repositoryPath,
        artifactHash: sha256(manifestFile.bytes),
      },
      matrix: {
        artifactPath: matrixFile.repositoryPath,
        artifactHash: sha256(matrixFile.bytes),
      },
      policy: {
        artifactPath: policyFile.repositoryPath,
        artifactHash: sha256(policyFile.bytes),
      },
      w44Report: manifest.w44Report,
    },
    entries,
  };
  if (!validators.acceptanceMap(document)) {
    fail(
      "ACCEPTANCE_EVIDENCE_MAP_SCHEMA_INVALID",
      validators.acceptanceMap.errors?.map((entry) => entry.message ?? "invalid").join("; "),
    );
  }
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { document, bytes };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function gitPaths(root: string, arguments_: readonly string[], code: string): string[] {
  try {
    return execFileSync("git", [...arguments_], { cwd: root, encoding: "utf8" })
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((path) => path.replaceAll("\\", "/"));
  } catch (error) {
    fail(code, error instanceof Error ? error.message : String(error));
  }
}

export function assertReportsOnlyCandidateDescendant(
  repositoryRoot: string,
  candidateImplementationSha: string,
  currentHead: string,
): void {
  const root = resolve(repositoryRoot);
  const candidate = commit(
    candidateImplementationSha,
    "CLI_CANDIDATE_IMPLEMENTATION_SHA_INVALID",
  );
  const head = commit(currentHead, "CLI_CURRENT_HEAD_INVALID");
  let actualHead: string;
  try {
    actualHead = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch (error) {
    fail("CLI_GIT_HEAD_UNAVAILABLE", error instanceof Error ? error.message : String(error));
  }
  if (actualHead !== head) fail("CLI_CURRENT_HEAD_DRIFT");
  if (candidate !== head) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", candidate, head], {
        cwd: root,
        stdio: "ignore",
      });
    } catch {
      fail("CLI_CANDIDATE_NOT_ANCESTOR_OF_HEAD");
    }
  }
  const paths = new Set<string>([
    ...(candidate === head
      ? []
      : gitPaths(
          root,
          ["diff", "--name-only", "--no-renames", `${candidate}..${head}`],
          "CLI_CANDIDATE_DIFF_UNAVAILABLE",
        )),
    ...gitPaths(
      root,
      ["diff", "--name-only", "--no-renames"],
      "CLI_WORKTREE_DIFF_UNAVAILABLE",
    ),
    ...gitPaths(
      root,
      ["diff", "--cached", "--name-only", "--no-renames"],
      "CLI_INDEX_DIFF_UNAVAILABLE",
    ),
    ...gitPaths(
      root,
      ["ls-files", "--others", "--exclude-standard"],
      "CLI_UNTRACKED_FILES_UNAVAILABLE",
    ),
  ]);
  const implementationChanges = [...paths].filter((path) =>
    !path.startsWith(reportArtifactPrefix));
  if (implementationChanges.length > 0) {
    fail(
      "CLI_CANDIDATE_STALE_RELATIVE_TO_IMPLEMENTATION",
      implementationChanges.sort().join("|"),
    );
  }
}

function runCli(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const manifestPath = argument("--manifest");
  if (!manifestPath) fail("CLI_MANIFEST_REQUIRED", "use --manifest <repository-relative-path>");
  const currentHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const manifestFile = repositoryFile(root, manifestPath, "CLI_MANIFEST_INVALID");
  const expectedCandidateSha = loadRootManifest(manifestFile.bytes).candidate.gitHead;
  assertReportsOnlyCandidateDescendant(root, expectedCandidateSha, currentHead);
  const result = buildGdpsV021AcceptanceEvidenceMap({
    repositoryRoot: root,
    manifestPath,
    expectedCandidateSha,
  });
  const outputPath = argument("--output");
  const check = process.argv.includes("--check");
  const write = process.argv.includes("--write");
  if (check && write) fail("CLI_MODE_CONFLICT");
  if ((check || write) && !outputPath) fail("CLI_OUTPUT_REQUIRED");
  if (outputPath) {
    const output = resolve(root, outputPath);
    const repositoryPath = relative(root, output).replaceAll("\\", "/");
    if (repositoryPath.startsWith("../") || repositoryPath.length === 0) fail("CLI_OUTPUT_ESCAPES_REPOSITORY");
    if (check) {
      if (!existsSync(output) || !readFileSync(output).equals(result.bytes)) {
        fail("ACCEPTANCE_EVIDENCE_MAP_STALE", repositoryPath);
      }
    } else if (write) {
      writeFileSync(output, result.bytes);
    } else process.stdout.write(result.bytes);
  } else process.stdout.write(result.bytes);
  const overall = asObject(result.document["overall"], "INTERNAL_OVERALL_INVALID");
  const counts = asObject(overall["counts"], "INTERNAL_COUNTS_INVALID");
  process.stderr.write(
    `WSGS_GDPS_V021_TYPED_EVIDENCE_MAP_${overall["status"]} ` +
    `pass=${counts["PASS"]} fail=${counts["FAIL"]} blocked=${counts["BLOCKED"]} ` +
    `notRun=${counts["NOT_RUN"]}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runCli();
