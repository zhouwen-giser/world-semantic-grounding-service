import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateGdpsV021W43BarrierAttestation } from "./capture-gdps-v021-w43-runtime-receipts.js";

type JsonObject = Record<string, unknown>;
type EvidenceType = "CURRENTNESS" | "UNIT" | "REAL_POSTGRES";
export type GdpsV021W43ScenarioId =
  | "CURRENT_STRICT"
  | "CHANGED_STRICT"
  | "NOT_AVAILABLE_STRICT"
  | "CHANGED_BEST_EFFORT"
  | "SOURCE_CHANGED_ONCE"
  | "SOURCE_CHANGED_TWICE";

interface W43Row {
  readonly id: string;
  readonly scenario: string;
  readonly expected: string;
  readonly evidenceTypes: readonly EvidenceType[];
}

interface ReceiptReference {
  readonly path: string;
  readonly hash: `sha256:${string}`;
  readonly byteLength: number;
}

type ScenarioId = GdpsV021W43ScenarioId;

export interface GdpsV021W43RuntimeBinding {
  readonly candidateSha: string;
  readonly gateRunId: string;
  readonly runtimeIdentityHash: `sha256:${string}`;
  readonly gowmGatewayIdentityHash: `sha256:${string}`;
  readonly wsgsRuntimeIdentityHash: `sha256:${string}`;
  readonly databaseIdentityHash: `sha256:${string}`;
  readonly handoffBundleHash: `sha256:${string}`;
  readonly operationLockHash: `sha256:${string}`;
  readonly providerRecipeLockHash: `sha256:${string}`;
  readonly providerId: "gdps.geospatial-products";
  readonly providerVersion: "0.2.1";
  readonly capabilityCount: 30;
  readonly requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY";
  readonly gatewayOnly: true;
  readonly directProviderCalls: 0;
  readonly mockTransportUsed: false;
  readonly databaseClass: "REAL_ISOLATED_POSTGRESQL";
  readonly sharedRuntimeMutated: false;
}

type RuntimeBinding = GdpsV021W43RuntimeBinding;

interface ScenarioReceipt {
  readonly scenarioId: ScenarioId;
  readonly replayMode: "STRICT" | "BEST_EFFORT";
  readonly groundingStatus: "COMPLETED" | "UNRESOLVED";
  readonly terminalStatus: "COMPLETED" | "UNRESOLVED" | "INDETERMINATE";
  readonly normalizedStatus: "CURRENT" | "STALE" | "DATA_GAP" | "INDETERMINATE";
  readonly currentness: "CURRENT" | "CHANGED" | "NOT_AVAILABLE";
  readonly semanticCode: "OK" | "SNAPSHOT_MISMATCHED" | "DATA_GAP" | "SOURCE_ADVANCED" | "SOURCE_CHANGED";
  readonly warnings: readonly string[];
  readonly priorContentHash: `sha256:${string}`;
  readonly currentContentHash: `sha256:${string}` | null;
  readonly sourceOperationKey: string;
  readonly executedOperationKeys: readonly string[];
  readonly checkCurrentExecutionCount: number;
  readonly originalSourceExecutionCount: number;
  readonly newCurrentSourceExecutionCount: number;
  readonly sourceChangedDuringQueryCount: number;
  readonly retryCount: number;
  readonly historicalPayloadRead: false;
  readonly productVersionPresent: false;
  readonly priorGroundingLoaded: true;
  readonly currentnessEvidencePersisted: true;
  readonly authorityTupleHash: `sha256:${string}`;
  readonly currentnessDecisionHash: `sha256:${string}`;
  readonly sourceGroundingIdHash: `sha256:${string}`;
  readonly replayGroundingIdHash: `sha256:${string}`;
  readonly persistedResultHash: `sha256:${string}`;
  readonly sourceRequestEvidenceHash: `sha256:${string}`;
  readonly replayRequestEvidenceHash: `sha256:${string}`;
  readonly sourcePlanHash: `sha256:${string}`;
  readonly sourceBarrierTransitionHash: `sha256:${string}`;
  readonly replayBarrierTransitionHash: `sha256:${string}`;
  readonly replayBarrierArm: ReceiptReference | null;
  readonly barrierTransitionHashes: readonly `sha256:${string}`[];
  readonly causalBindingHash: `sha256:${string}`;
}

interface PostgresObservation {
  readonly scenarioId: ScenarioId;
  readonly groundingStatus: "COMPLETED" | "UNRESOLVED";
  readonly sourceGroundingIdHash: `sha256:${string}`;
  readonly replayGroundingIdHash: `sha256:${string}`;
  readonly persistedResultHash: `sha256:${string}`;
  readonly currentnessDecisionHash: `sha256:${string}`;
  readonly transactionMode: "READ_ONLY";
  readonly sourceGroundingRows: number;
  readonly replayGroundingRows: number;
  readonly resultRows: number;
  readonly stageRows: number;
  readonly executionRows: number;
  readonly currentnessEvidenceRows: number;
  readonly selectedProductRows: number;
  readonly priorGroundingLinkRows: number;
  readonly checkCurrentExecutionRows: number;
  readonly originalSourceExecutionRows: number;
  readonly newCurrentSourceExecutionRows: number;
  readonly sourceChangedDuringQueryRows: number;
  readonly sourceRequestEvidenceHash: `sha256:${string}`;
  readonly replayRequestEvidenceHash: `sha256:${string}`;
  readonly sourcePlanHash: `sha256:${string}`;
  readonly sourceBarrierTransitionHash: `sha256:${string}`;
  readonly replayBarrierTransitionHash: `sha256:${string}`;
  readonly replayBarrierArm: ReceiptReference | null;
  readonly barrierTransitionHashes: readonly `sha256:${string}`[];
  readonly causalBindingHash: `sha256:${string}`;
}

interface LoadedReceipt {
  readonly reference: ReceiptReference;
  readonly bytes: Buffer;
  readonly document: JsonObject;
}

export interface W43EvidenceProducerInput {
  readonly repositoryRoot: string;
  readonly candidateSha: string;
  readonly unitReceiptPath: string;
  readonly postgresReceiptPath: string;
  readonly currentnessReceiptPath: string;
  readonly matrixPath?: string;
  readonly reportPath?: string;
  readonly manifestEntryPath?: string;
  readonly generatedAt?: string;
}

export interface W43EvidenceProducerResult {
  readonly files: ReadonlyMap<string, Buffer>;
  readonly reportPath: string;
  readonly manifestEntryPath: string;
  readonly manifestEntry: JsonObject;
  readonly artifactCount: 54;
  readonly assertionCount: 54;
  readonly candidateSha: string;
  readonly gateRunId: string;
  readonly runtimeIdentityHash: `sha256:${string}`;
}

export interface W43UnitReceiptCaptureInput {
  readonly repositoryRoot: string;
  readonly candidateSha: string;
  readonly currentnessReceiptPath: string;
  readonly rawReportPath: string;
  readonly unitReceiptPath: string;
  readonly generatedAt?: string;
}

export interface W43UnitReceiptCaptureResult {
  readonly rawReportPath: string;
  readonly unitReceiptPath: string;
  readonly rawReportHash: `sha256:${string}`;
  readonly rawReportByteLength: number;
  readonly selectedTestCount: number;
  readonly candidateSha: string;
  readonly gateRunId: string;
  readonly runtimeIdentityHash: `sha256:${string}`;
}

export class GdpsV021W43EvidenceError extends Error {
  public readonly code: string;

  public constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "GdpsV021W43EvidenceError";
    this.code = code;
  }
}

const receiptPrefix = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/";
const evidencePrefix = "reports/wsgs-v0.2-gdps-v0.2.1/w43-evidence/";
const defaultReportPath = "reports/wsgs-v0.2-gdps-v0.2.1/w43-currentness-phase-report.json";
const defaultManifestEntryPath =
  "reports/wsgs-v0.2-gdps-v0.2.1/w43-currentness-phase-manifest-entry.json";
const target = Object.freeze({
  release: "GDPS v0.2.1",
  providerId: "gdps.geospatial-products",
  providerVersion: "0.2.1",
  capabilityCount: 30,
  productTypeCount: 34,
  descriptorProfileCount: 35,
});
const receiptFiles = Object.freeze([
  "packages/gowm-execution-evidence/src/gdps.test.ts",
  "packages/gowm-execution-evidence/src/gdps-v021-e2e-policy.test.ts",
  "services/grounding-worker/src/production-module.test.ts",
]);
const scenarioIds = Object.freeze([
  "CURRENT_STRICT",
  "CHANGED_STRICT",
  "NOT_AVAILABLE_STRICT",
  "CHANGED_BEST_EFFORT",
  "SOURCE_CHANGED_ONCE",
  "SOURCE_CHANGED_TWICE",
] as const);
const evidenceTypes = Object.freeze(["CURRENTNESS", "UNIT", "REAL_POSTGRES"] as const);
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const gateRunIdPattern = /^wsgs-gdps-v021-[a-z0-9][a-z0-9-]{7,95}$/u;
const isoInstantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export const GDPS_V021_W43_UNIT_TESTS = Object.freeze<Record<string, readonly string[]>>({
  "W43-001": [
    "GDPS current-only replay allows an exact current source under strict replay",
    "production stage module authority boundaries allows only the same current product identity in STRICT mode",
  ],
  "W43-002": [
    "GDPS current-only replay blocks strict and PINNED replay when the current source changed",
    "production stage module authority boundaries maps a real-shaped CHANGED currentness output to strict SNAPSHOT_MISMATCHED",
  ],
  "W43-003": [
    "GDPS current-only replay does not reinterpret a missing current product as a replayable negative fact",
    "production stage module authority boundaries marks a missing current product STALE and blocks execution in STRICT mode",
  ],
  "W43-004": [
    "GDPS current-only replay allows an exact current source under strict replay",
    "production stage module authority boundaries injects a non-executable prior product marker and builds only check-current input",
  ],
  "W43-005": [
    "GDPS current-only replay blocks strict and PINNED replay when the current source changed",
    "production stage module authority boundaries executes CHANGED as one new source query and never executes it for NOT_AVAILABLE or STRICT",
  ],
  "W43-006": [
    "production stage module authority boundaries injects a non-executable prior product marker and builds only check-current input",
    "production stage module authority boundaries executes CHANGED as one new source query and never executes it for NOT_AVAILABLE or STRICT",
  ],
  "W43-007": [
    "GDPS current-only replay allows BEST_EFFORT source advance only with an explicit warning and actual hash",
    "production stage module authority boundaries recompiles a persisted source recipe as a new exact current-source query",
  ],
  "W43-008": [
    "production stage module authority boundaries maps CHANGED to SOURCE_ADVANCED only under explicit BEST_EFFORT",
  ],
  "W43-009": [
    "GDPS current-only replay allows BEST_EFFORT source advance only with an explicit warning and actual hash",
  ],
  "W43-010": [
    "GDPS current-only replay blocks strict and PINNED replay when the current source changed",
    "production stage module authority boundaries rejects a contradictory CURRENT hash instead of silently advancing",
  ],
  "W43-011": [
    "production stage module authority boundaries never carries historical payload or unknown persisted parameters into the current-source query",
  ],
  "W43-012": [
    "GDPS current-only execution evidence rejects product-version semantics at any nesting level",
  ],
  "W43-013": [
    "production stage module authority boundaries retries SOURCE_CHANGED_DURING_QUERY once, then completes or becomes INDETERMINATE",
  ],
  "W43-014": [
    "production stage module authority boundaries retries SOURCE_CHANGED_DURING_QUERY once, then completes or becomes INDETERMINATE",
    "GDPS v0.2.1 case evidence evaluation locks W43 strict, BEST_EFFORT, data-gap, and second-source-change status mappings",
  ],
  "W43-015": [
    "production stage module authority boundaries recognizes only a persisted, selected GDPS current-product identity",
    "production stage module authority boundaries loads the source submission only through the same-authority persisted request and query hashes",
  ],
  "W43-016": [
    "production stage module authority boundaries fails closed before reading evidence for foreign scope or prior hash mismatch",
    "production stage module authority boundaries loads the source submission only through the same-authority persisted request and query hashes",
  ],
  "W43-017": [
    "GDPS v0.2.1 case evidence evaluation keeps terminal, normalized, source-condition, and semantic currentness states distinct",
    "production stage module authority boundaries injects a non-executable prior product marker and builds only check-current input",
  ],
  "W43-018": [
    "GDPS v0.2.1 case evidence evaluation locks W43 strict, BEST_EFFORT, data-gap, and second-source-change status mappings",
    "production stage module authority boundaries rejects a contradictory CURRENT hash instead of silently advancing",
  ],
});

const unitTestsByAcceptanceId = GDPS_V021_W43_UNIT_TESTS;

const scenariosByAcceptanceId = Object.freeze<Record<string, readonly ScenarioId[]>>({
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
  "W43-011": scenarioIds,
  "W43-012": scenarioIds,
  "W43-013": ["SOURCE_CHANGED_ONCE"],
  "W43-014": ["SOURCE_CHANGED_TWICE"],
  "W43-015": scenarioIds,
  "W43-016": scenarioIds,
  "W43-017": ["CHANGED_STRICT", "CHANGED_BEST_EFFORT"],
  "W43-018": scenarioIds,
});

function fail(code: string, detail?: string): never {
  throw new GdpsV021W43EvidenceError(code, detail);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown, code: string): JsonObject {
  if (!isObject(value)) fail(code);
  return value;
}

function array(value: unknown, code: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(code);
  return value;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}

function integer(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(code);
  return value as number;
}

function exactKeys(value: JsonObject, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const locked = [...expected].sort();
  if (actual.length !== locked.length || actual.some((entry, index) => entry !== locked[index])) {
    fail(code, `expected=${locked.join("|")} actual=${actual.join("|")}`);
  }
}

function sha256(bytes: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  return `{${Object.entries(value as JsonObject).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function digest(value: unknown, code: string): `sha256:${string}` {
  const result = text(value, code);
  if (!digestPattern.test(result)) fail(code);
  return result as `sha256:${string}`;
}

function commit(value: unknown, code: string): string {
  const result = text(value, code);
  if (!commitPattern.test(result)) fail(code);
  return result;
}

function instant(value: unknown, code: string): string {
  const result = text(value, code);
  if (!isoInstantPattern.test(result) || Number.isNaN(Date.parse(result))) fail(code);
  return result;
}

function normalizeRepositoryPath(value: unknown, prefix: string, code: string): string {
  const path = text(value, code).replaceAll("\\", "/");
  if (!path.startsWith(prefix) || path.split("/").includes("..") || /^[A-Za-z]:|^\//u.test(path)) {
    fail(code, path);
  }
  return path;
}

function loadRepositoryFile(root: string, value: unknown, prefix: string, code: string): LoadedReceipt {
  const path = normalizeRepositoryPath(value, prefix, code);
  const absolute = resolve(root, path);
  const repositoryPath = relative(root, absolute).replaceAll("\\", "/");
  if (repositoryPath !== path || !existsSync(absolute) || !statSync(absolute).isFile()) fail(code, path);
  const bytes = readFileSync(absolute);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${code}_JSON_INVALID`, error instanceof Error ? error.message : String(error));
  }
  return {
    reference: { path, hash: sha256(bytes), byteLength: bytes.byteLength },
    bytes,
    document: object(parsed, `${code}_DOCUMENT_INVALID`),
  };
}

function csvRows(textValue: string): JsonObject[] {
  const lines = textValue.replaceAll("\r\n", "\n").trim().split("\n");
  const header = lines.shift()?.split(",");
  if (!header) fail("W43_MATRIX_EMPTY");
  return lines.map((line) => {
    const values = line.split(",");
    if (values.length !== header.length) fail("W43_MATRIX_CSV_UNSUPPORTED", line);
    return Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""]));
  });
}

function loadW43Rows(root: string, matrixPath: string): W43Row[] {
  const absolute = resolve(root, matrixPath);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) fail("W43_MATRIX_MISSING");
  const rows = csvRows(readFileSync(absolute, "utf8"))
    .filter((row) => row["phase"] === "W43")
    .map((row): W43Row => ({
      id: text(row["id"], "W43_MATRIX_ID_INVALID"),
      scenario: text(row["scenario"], "W43_MATRIX_SCENARIO_INVALID"),
      expected: text(row["expected"], "W43_MATRIX_EXPECTED_INVALID"),
      evidenceTypes: text(row["evidence"], "W43_MATRIX_EVIDENCE_INVALID").split("/") as EvidenceType[],
    }));
  if (rows.length !== 18 || rows.some((row, index) =>
    row.id !== `W43-${String(index + 1).padStart(3, "0")}` ||
    JSON.stringify(row.evidenceTypes) !== JSON.stringify(evidenceTypes) ||
    !unitTestsByAcceptanceId[row.id] || !scenariosByAcceptanceId[row.id])) {
    fail("W43_MATRIX_INVENTORY_DRIFT");
  }
  return rows;
}

function parseRuntimeBinding(value: unknown, expectedCandidateSha: string): RuntimeBinding {
  const raw = object(value, "W43_RUNTIME_BINDING_INVALID");
  exactKeys(raw, [
    "candidateSha", "gateRunId", "runtimeIdentityHash", "gowmGatewayIdentityHash",
    "wsgsRuntimeIdentityHash", "databaseIdentityHash", "handoffBundleHash", "operationLockHash",
    "providerRecipeLockHash", "providerId", "providerVersion", "capabilityCount",
    "requiredExecutionPath", "gatewayOnly", "directProviderCalls", "mockTransportUsed",
    "databaseClass", "sharedRuntimeMutated",
  ], "W43_RUNTIME_BINDING_FIELDS_INVALID");
  if (commit(raw["candidateSha"], "W43_RUNTIME_CANDIDATE_INVALID") !== expectedCandidateSha ||
      !gateRunIdPattern.test(text(raw["gateRunId"], "W43_GATE_RUN_ID_INVALID")) ||
      raw["providerId"] !== "gdps.geospatial-products" || raw["providerVersion"] !== "0.2.1" ||
      raw["capabilityCount"] !== 30 ||
      raw["requiredExecutionPath"] !== "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" ||
      raw["gatewayOnly"] !== true || raw["directProviderCalls"] !== 0 ||
      raw["mockTransportUsed"] !== false || raw["databaseClass"] !== "REAL_ISOLATED_POSTGRESQL" ||
      raw["sharedRuntimeMutated"] !== false) fail("W43_RUNTIME_BINDING_TRUTH_INVALID");
  for (const field of [
    "runtimeIdentityHash", "gowmGatewayIdentityHash", "wsgsRuntimeIdentityHash", "databaseIdentityHash",
    "handoffBundleHash", "operationLockHash", "providerRecipeLockHash",
  ]) digest(raw[field], `W43_RUNTIME_${field.toUpperCase()}_INVALID`);
  return raw as unknown as RuntimeBinding;
}

function parseScenario(value: unknown): ScenarioReceipt {
  const raw = object(value, "W43_CURRENTNESS_SCENARIO_INVALID");
  exactKeys(raw, [
    "scenarioId", "replayMode", "groundingStatus", "terminalStatus", "normalizedStatus", "currentness",
    "semanticCode",
    "warnings", "priorContentHash", "currentContentHash", "sourceOperationKey", "executedOperationKeys",
    "checkCurrentExecutionCount", "originalSourceExecutionCount", "newCurrentSourceExecutionCount",
    "sourceChangedDuringQueryCount", "retryCount", "historicalPayloadRead", "productVersionPresent",
    "priorGroundingLoaded", "currentnessEvidencePersisted", "sourceGroundingIdHash",
    "replayGroundingIdHash", "persistedResultHash", "sourceRequestEvidenceHash",
    "replayRequestEvidenceHash", "sourcePlanHash", "barrierTransitionHashes", "causalBindingHash",
    "authorityTupleHash", "currentnessDecisionHash", "sourceBarrierTransitionHash",
    "replayBarrierTransitionHash", "replayBarrierArm",
  ], "W43_CURRENTNESS_SCENARIO_FIELDS_INVALID");
  if (!scenarioIds.includes(raw["scenarioId"] as ScenarioId)) fail("W43_CURRENTNESS_SCENARIO_ID_INVALID");
  const warnings = array(raw["warnings"], "W43_CURRENTNESS_WARNINGS_INVALID")
    .map((entry) => text(entry, "W43_CURRENTNESS_WARNINGS_INVALID"));
  const operationKeys = array(raw["executedOperationKeys"], "W43_CURRENTNESS_OPERATIONS_INVALID")
    .map((entry) => text(entry, "W43_CURRENTNESS_OPERATIONS_INVALID"));
  if (new Set(warnings).size !== warnings.length || new Set(operationKeys).size !== operationKeys.length ||
      !operationKeys.includes("geo-product.check-current@1.0")) fail("W43_CURRENTNESS_OPERATIONS_INVALID");
  digest(raw["priorContentHash"], "W43_CURRENTNESS_PRIOR_HASH_INVALID");
  if (raw["currentContentHash"] !== null) digest(raw["currentContentHash"], "W43_CURRENTNESS_CURRENT_HASH_INVALID");
  for (const field of [
    "sourceGroundingIdHash", "replayGroundingIdHash", "persistedResultHash", "sourceRequestEvidenceHash",
    "replayRequestEvidenceHash", "sourcePlanHash", "causalBindingHash",
    "authorityTupleHash", "currentnessDecisionHash", "sourceBarrierTransitionHash",
    "replayBarrierTransitionHash",
  ] as const) {
    digest(raw[field], `W43_CURRENTNESS_${field.toUpperCase()}_INVALID`);
  }
  const barrierHashes = array(raw["barrierTransitionHashes"], "W43_CURRENTNESS_BARRIER_HASHES_INVALID")
    .map((entry) => digest(entry, "W43_CURRENTNESS_BARRIER_HASH_INVALID"));
  if (barrierHashes.length < 1 || new Set(barrierHashes).size !== barrierHashes.length) {
    fail("W43_CURRENTNESS_BARRIER_HASHES_INVALID");
  }
  const arm = raw["replayBarrierArm"] === null ? null : object(raw["replayBarrierArm"],
    "W43_CURRENTNESS_REPLAY_ARM_INVALID");
  if (arm !== null) {
    exactKeys(arm, ["path", "hash", "byteLength"], "W43_CURRENTNESS_REPLAY_ARM_FIELDS_INVALID");
    text(arm["path"], "W43_CURRENTNESS_REPLAY_ARM_PATH_INVALID");
    digest(arm["hash"], "W43_CURRENTNESS_REPLAY_ARM_HASH_INVALID");
    integer(arm["byteLength"], "W43_CURRENTNESS_REPLAY_ARM_LENGTH_INVALID");
  }
  for (const field of [
    "checkCurrentExecutionCount", "originalSourceExecutionCount", "newCurrentSourceExecutionCount",
    "sourceChangedDuringQueryCount", "retryCount",
  ]) integer(raw[field], `W43_CURRENTNESS_${field.toUpperCase()}_INVALID`);
  if (raw["historicalPayloadRead"] !== false || raw["productVersionPresent"] !== false ||
      raw["priorGroundingLoaded"] !== true || raw["currentnessEvidencePersisted"] !== true) {
    fail("W43_CURRENTNESS_SAFETY_FACT_INVALID", String(raw["scenarioId"]));
  }
  return { ...raw, warnings, executedOperationKeys: operationKeys,
    replayBarrierArm: arm, barrierTransitionHashes: barrierHashes } as unknown as ScenarioReceipt;
}

interface ScenarioExpectation {
  readonly replayMode: ScenarioReceipt["replayMode"];
  readonly groundingStatus: ScenarioReceipt["groundingStatus"];
  readonly terminalStatus: ScenarioReceipt["terminalStatus"];
  readonly normalizedStatus: ScenarioReceipt["normalizedStatus"];
  readonly currentness: ScenarioReceipt["currentness"];
  readonly semanticCode: ScenarioReceipt["semanticCode"];
  readonly warnings: readonly string[];
  readonly newExecutions: number;
  readonly sourceChanges: number;
  readonly retries: number;
}

const scenarioExpectations: Readonly<Record<ScenarioId, ScenarioExpectation>> = Object.freeze({
  CURRENT_STRICT: {
    replayMode: "STRICT", groundingStatus: "COMPLETED", terminalStatus: "COMPLETED", normalizedStatus: "CURRENT",
    currentness: "CURRENT", semanticCode: "OK", warnings: ["CURRENT_SOURCE_IDENTITY_CONFIRMED"],
    newExecutions: 0, sourceChanges: 0, retries: 0,
  },
  CHANGED_STRICT: {
    replayMode: "STRICT", groundingStatus: "UNRESOLVED", terminalStatus: "UNRESOLVED", normalizedStatus: "STALE",
    currentness: "CHANGED", semanticCode: "SNAPSHOT_MISMATCHED", warnings: ["SOURCE_CHANGED"],
    newExecutions: 0, sourceChanges: 0, retries: 0,
  },
  NOT_AVAILABLE_STRICT: {
    replayMode: "STRICT", groundingStatus: "UNRESOLVED", terminalStatus: "UNRESOLVED", normalizedStatus: "DATA_GAP",
    currentness: "NOT_AVAILABLE", semanticCode: "DATA_GAP", warnings: ["SOURCE_NOT_AVAILABLE"],
    newExecutions: 0, sourceChanges: 0, retries: 0,
  },
  CHANGED_BEST_EFFORT: {
    replayMode: "BEST_EFFORT", groundingStatus: "COMPLETED", terminalStatus: "COMPLETED",
    normalizedStatus: "CURRENT",
    currentness: "CHANGED", semanticCode: "SOURCE_ADVANCED", warnings: ["SOURCE_ADVANCED"],
    newExecutions: 1, sourceChanges: 0, retries: 0,
  },
  SOURCE_CHANGED_ONCE: {
    replayMode: "BEST_EFFORT", groundingStatus: "COMPLETED", terminalStatus: "COMPLETED",
    normalizedStatus: "CURRENT",
    currentness: "CHANGED", semanticCode: "SOURCE_ADVANCED",
    warnings: ["CURRENT_SOURCE_QUERY_RETRIED", "SOURCE_ADVANCED", "SOURCE_CHANGED"],
    newExecutions: 2, sourceChanges: 1, retries: 1,
  },
  SOURCE_CHANGED_TWICE: {
    replayMode: "BEST_EFFORT", groundingStatus: "UNRESOLVED", terminalStatus: "INDETERMINATE",
    normalizedStatus: "INDETERMINATE",
    currentness: "CHANGED", semanticCode: "SOURCE_CHANGED",
    warnings: ["CURRENT_SOURCE_QUERY_RETRIED", "INDETERMINATE", "SOURCE_ADVANCED", "SOURCE_CHANGED"],
    newExecutions: 2, sourceChanges: 2, retries: 1,
  },
});

function validateScenarioTruth(scenario: ScenarioReceipt): void {
  const expected = scenarioExpectations[scenario.scenarioId];
  const barrierCount = ({ CURRENT_STRICT: 1, CHANGED_STRICT: 2, NOT_AVAILABLE_STRICT: 3,
    CHANGED_BEST_EFFORT: 2, SOURCE_CHANGED_ONCE: 2, SOURCE_CHANGED_TWICE: 4 } as const)[scenario.scenarioId];
  const currentHashRequired = scenario.currentness !== "NOT_AVAILABLE";
  const hashesEqual = scenario.currentContentHash === scenario.priorContentHash;
  if (scenario.replayMode !== expected.replayMode || scenario.groundingStatus !== expected.groundingStatus ||
      scenario.terminalStatus !== expected.terminalStatus ||
      scenario.normalizedStatus !== expected.normalizedStatus || scenario.currentness !== expected.currentness ||
      scenario.semanticCode !== expected.semanticCode ||
      JSON.stringify([...scenario.warnings].sort()) !== JSON.stringify([...expected.warnings].sort()) ||
      scenario.checkCurrentExecutionCount !== 1 || scenario.originalSourceExecutionCount !== 0 ||
      scenario.newCurrentSourceExecutionCount !== expected.newExecutions ||
      scenario.sourceChangedDuringQueryCount !== expected.sourceChanges || scenario.retryCount !== expected.retries ||
      scenario.barrierTransitionHashes.length !== barrierCount ||
      scenario.sourceBarrierTransitionHash !== scenario.barrierTransitionHashes[0] ||
      scenario.replayBarrierTransitionHash !== scenario.barrierTransitionHashes[
        ({ CURRENT_STRICT: 0, CHANGED_STRICT: 1, NOT_AVAILABLE_STRICT: 1,
          CHANGED_BEST_EFFORT: 1, SOURCE_CHANGED_ONCE: 1, SOURCE_CHANGED_TWICE: 1 } as const)[scenario.scenarioId]] ||
      (scenario.scenarioId === "SOURCE_CHANGED_TWICE" ? scenario.replayBarrierArm === null : scenario.replayBarrierArm !== null) ||
      scenario.sourceOperationKey !== "geo-raster.sample@1.0" ||
      (currentHashRequired ? scenario.currentContentHash === null : scenario.currentContentHash !== null) ||
      (scenario.currentness === "CURRENT" ? !hashesEqual : currentHashRequired && hashesEqual) ||
      (scenario.newCurrentSourceExecutionCount > 0 &&
        !scenario.executedOperationKeys.includes(scenario.sourceOperationKey)) ||
      (scenario.newCurrentSourceExecutionCount === 0 && scenario.executedOperationKeys.length !== 1)) {
    fail("W43_CURRENTNESS_SCENARIO_TRUTH_INVALID", scenario.scenarioId);
  }
}

function loadCurrentnessReceipt(root: string, path: string, candidateSha: string): {
  readonly loaded: LoadedReceipt;
  readonly barrier: LoadedReceipt;
  readonly authorityTupleHash: `sha256:${string}`;
  readonly generatedAt: string;
  readonly binding: RuntimeBinding;
  readonly scenarios: ReadonlyMap<ScenarioId, ScenarioReceipt>;
} {
  const loaded = loadRepositoryFile(root, path, receiptPrefix, "W43_CURRENTNESS_RECEIPT_MISSING");
  const raw = loaded.document;
  exactKeys(raw, ["schemaVersion", "generatedAt", "binding", "authorityTupleHash", "barrierAttestation", "scenarios"],
    "W43_CURRENTNESS_RECEIPT_FIELDS_INVALID");
  if (raw["schemaVersion"] !== "wsgs-gdps-v021-currentness-runner-receipt/1.0") {
    fail("W43_CURRENTNESS_RECEIPT_SCHEMA_INVALID");
  }
  const generatedAt = instant(raw["generatedAt"], "W43_CURRENTNESS_RECEIPT_TIME_INVALID");
  const binding = parseRuntimeBinding(raw["binding"], candidateSha);
  const authorityHash = digest(raw["authorityTupleHash"], "W43_AUTHORITY_TUPLE_HASH_INVALID");
  const barrierReference = object(raw["barrierAttestation"], "W43_BARRIER_REFERENCE_INVALID");
  exactKeys(barrierReference, ["path", "hash", "byteLength"], "W43_BARRIER_REFERENCE_FIELDS_INVALID");
  const barrier = loadRepositoryFile(root, barrierReference["path"], receiptPrefix,
    "W43_BARRIER_ATTESTATION_MISSING");
  if (digest(barrierReference["hash"], "W43_BARRIER_REFERENCE_HASH_INVALID") !== barrier.reference.hash ||
      integer(barrierReference["byteLength"], "W43_BARRIER_REFERENCE_LENGTH_INVALID") !== barrier.reference.byteLength ||
      barrier.document["schemaVersion"] !== "gdps-v021-w43-barrier-attestation/1.0" ||
      barrier.document["status"] !== "PASS" || barrier.document["candidateSha"] !== candidateSha ||
      barrier.document["transitionCount"] !== 14 || barrier.document["currentState"] !== "FINAL_B" ||
      barrier.document["finalFixtureState"] !== "FINAL_B" ||
      barrier.document["w43RuntimeQualificationStatus"] !== "NOT_RUN" ||
      barrier.document["runtimeEvidenceIncluded"] !== false) {
    fail("W43_BARRIER_REFERENCE_TRUTH_INVALID");
  }
  validateGdpsV021W43BarrierAttestation(barrier.bytes, barrier.reference.hash, binding);
  const scenarios = array(raw["scenarios"], "W43_CURRENTNESS_SCENARIOS_INVALID").map(parseScenario);
  if (scenarios.length !== scenarioIds.length || new Set(scenarios.map((entry) => entry.scenarioId)).size !== scenarioIds.length) {
    fail("W43_CURRENTNESS_SCENARIO_INVENTORY_INVALID");
  }
  scenarios.forEach(validateScenarioTruth);
  const armed = scenarios.filter((entry) => entry.replayBarrierArm !== null);
  if (armed.length !== 1 || armed[0]!.scenarioId !== "SOURCE_CHANGED_TWICE") {
    fail("W43_REPLAY_BARRIER_ARM_INVENTORY_INVALID");
  }
  const armReference = armed[0]!.replayBarrierArm!;
  const arm = loadRepositoryFile(root, armReference.path, receiptPrefix, "W43_REPLAY_BARRIER_ARM_MISSING");
  exactKeys(arm.document, ["barrier", "candidateSha", "challengeHash", "controllerIdHash", "gateRunId",
    "runtimeIdentityHash", "scenarioId", "schemaVersion", "sidecarContractHash"],
  "W43_REPLAY_BARRIER_ARM_FIELDS_INVALID");
  if (arm.reference.hash !== armReference.hash || arm.reference.byteLength !== armReference.byteLength ||
      arm.document["schemaVersion"] !== "wsgs-gdps-v021-w43-barrier-arm/1.0" ||
      arm.document["candidateSha"] !== binding.candidateSha || arm.document["gateRunId"] !== binding.gateRunId ||
      arm.document["runtimeIdentityHash"] !== binding.runtimeIdentityHash ||
      arm.document["scenarioId"] !== "W43-SOURCE-CHANGED-TWICE-INDETERMINATE" ||
      arm.document["barrier"] !== "AFTER_FIRST_SOURCE_CHANGED:B_TO_A") {
    fail("W43_REPLAY_BARRIER_ARM_BINDING_INVALID");
  }
  for (const field of ["challengeHash", "controllerIdHash", "sidecarContractHash"] as const) {
    digest(arm.document[field], "W43_REPLAY_BARRIER_ARM_DIGEST_INVALID");
  }
  return { loaded, barrier, generatedAt, binding, authorityTupleHash: authorityHash,
    scenarios: new Map(scenarios.map((entry) => [entry.scenarioId, entry])) };
}

function parsePostgresObservation(value: unknown): PostgresObservation {
  const raw = object(value, "W43_POSTGRES_OBSERVATION_INVALID");
  exactKeys(raw, [
    "scenarioId", "groundingStatus", "sourceGroundingIdHash", "replayGroundingIdHash", "persistedResultHash",
    "currentnessDecisionHash", "transactionMode", "sourceGroundingRows", "replayGroundingRows",
    "resultRows", "stageRows", "executionRows", "currentnessEvidenceRows", "selectedProductRows",
    "priorGroundingLinkRows", "checkCurrentExecutionRows", "originalSourceExecutionRows",
    "newCurrentSourceExecutionRows", "sourceChangedDuringQueryRows", "sourceRequestEvidenceHash",
    "replayRequestEvidenceHash", "sourcePlanHash", "sourceBarrierTransitionHash",
    "replayBarrierTransitionHash", "replayBarrierArm", "barrierTransitionHashes", "causalBindingHash",
  ], "W43_POSTGRES_OBSERVATION_FIELDS_INVALID");
  if (!scenarioIds.includes(raw["scenarioId"] as ScenarioId) || raw["transactionMode"] !== "READ_ONLY") {
    fail("W43_POSTGRES_OBSERVATION_IDENTITY_INVALID");
  }
  for (const field of [
    "sourceGroundingIdHash", "replayGroundingIdHash", "persistedResultHash", "currentnessDecisionHash",
    "sourceRequestEvidenceHash", "replayRequestEvidenceHash", "sourcePlanHash", "sourceBarrierTransitionHash",
    "replayBarrierTransitionHash", "causalBindingHash",
  ]) digest(raw[field], `W43_POSTGRES_${field.toUpperCase()}_INVALID`);
  const barrierHashes = array(raw["barrierTransitionHashes"], "W43_POSTGRES_BARRIER_HASHES_INVALID")
    .map((entry) => digest(entry, "W43_POSTGRES_BARRIER_HASH_INVALID"));
  if (barrierHashes.length < 1 || new Set(barrierHashes).size !== barrierHashes.length) {
    fail("W43_POSTGRES_BARRIER_HASHES_INVALID");
  }
  const arm = raw["replayBarrierArm"] === null ? null : object(raw["replayBarrierArm"],
    "W43_POSTGRES_REPLAY_ARM_INVALID");
  if (arm !== null) {
    exactKeys(arm, ["path", "hash", "byteLength"], "W43_POSTGRES_REPLAY_ARM_FIELDS_INVALID");
    text(arm["path"], "W43_POSTGRES_REPLAY_ARM_PATH_INVALID");
    digest(arm["hash"], "W43_POSTGRES_REPLAY_ARM_HASH_INVALID");
    integer(arm["byteLength"], "W43_POSTGRES_REPLAY_ARM_LENGTH_INVALID");
  }
  for (const field of [
    "sourceGroundingRows", "replayGroundingRows", "resultRows", "stageRows", "executionRows",
    "currentnessEvidenceRows", "selectedProductRows", "priorGroundingLinkRows", "checkCurrentExecutionRows",
    "originalSourceExecutionRows", "newCurrentSourceExecutionRows", "sourceChangedDuringQueryRows",
  ]) integer(raw[field], `W43_POSTGRES_${field.toUpperCase()}_INVALID`);
  return { ...raw, replayBarrierArm: arm,
    barrierTransitionHashes: barrierHashes } as unknown as PostgresObservation;
}

function loadPostgresReceipt(root: string, path: string, candidateSha: string,
  scenarios: ReadonlyMap<ScenarioId, ScenarioReceipt>): {
  readonly loaded: LoadedReceipt;
  readonly generatedAt: string;
  readonly binding: RuntimeBinding;
  readonly observations: ReadonlyMap<ScenarioId, PostgresObservation>;
  readonly negativeAssertions: JsonObject;
  readonly authorityTupleHash: `sha256:${string}`;
} {
  const loaded = loadRepositoryFile(root, path, receiptPrefix, "W43_POSTGRES_RECEIPT_MISSING");
  const raw = loaded.document;
  exactKeys(raw, ["schemaVersion", "generatedAt", "binding", "authorityTupleHash", "barrierAttestation", "database",
    "negativeAssertions", "observations"],
    "W43_POSTGRES_RECEIPT_FIELDS_INVALID");
  if (raw["schemaVersion"] !== "wsgs-gdps-v021-real-postgres-currentness-receipt/1.0") {
    fail("W43_POSTGRES_RECEIPT_SCHEMA_INVALID");
  }
  const generatedAt = instant(raw["generatedAt"], "W43_POSTGRES_RECEIPT_TIME_INVALID");
  const binding = parseRuntimeBinding(raw["binding"], candidateSha);
  const authorityHash = digest(raw["authorityTupleHash"], "W43_POSTGRES_AUTHORITY_TUPLE_HASH_INVALID");
  const barrierReference = object(raw["barrierAttestation"], "W43_POSTGRES_BARRIER_REFERENCE_INVALID");
  exactKeys(barrierReference, ["path", "hash", "byteLength"], "W43_POSTGRES_BARRIER_REFERENCE_FIELDS_INVALID");
  const barrier = loadRepositoryFile(root, barrierReference["path"], receiptPrefix,
    "W43_POSTGRES_BARRIER_ATTESTATION_MISSING");
  if (barrier.reference.hash !== barrierReference["hash"] ||
      barrier.reference.byteLength !== barrierReference["byteLength"]) fail("W43_POSTGRES_BARRIER_REFERENCE_DRIFT");
  const database = object(raw["database"], "W43_POSTGRES_DATABASE_INVALID");
  exactKeys(database, [
    "engine", "serverVersion", "executionClass", "mockUsed", "connectionIdentityHash",
    "migrationReceiptHash", "queryTranscriptHash",
  ], "W43_POSTGRES_DATABASE_FIELDS_INVALID");
  if (database["engine"] !== "PostgreSQL" ||
      !/^1[7-9](?:\.[0-9]+){0,2}$/u.test(text(database["serverVersion"], "W43_POSTGRES_VERSION_INVALID")) ||
      database["executionClass"] !== "REAL_ISOLATED_POSTGRESQL" || database["mockUsed"] !== false ||
      digest(database["connectionIdentityHash"], "W43_POSTGRES_CONNECTION_IDENTITY_INVALID") !==
        binding.databaseIdentityHash) fail("W43_POSTGRES_DATABASE_TRUTH_INVALID");
  digest(database["migrationReceiptHash"], "W43_POSTGRES_MIGRATION_RECEIPT_HASH_INVALID");
  digest(database["queryTranscriptHash"], "W43_POSTGRES_QUERY_TRANSCRIPT_HASH_INVALID");
  const negativeAssertions = object(raw["negativeAssertions"], "W43_POSTGRES_NEGATIVE_ASSERTIONS_INVALID");
  exactKeys(negativeAssertions, ["foreignScope", "foreignPrincipal", "priorResultHashMismatch"],
    "W43_POSTGRES_NEGATIVE_ASSERTION_FIELDS_INVALID");
  for (const key of ["foreignScope", "foreignPrincipal", "priorResultHashMismatch"] as const) {
    const entry = object(negativeAssertions[key], "W43_POSTGRES_NEGATIVE_ASSERTION_INVALID");
    exactKeys(entry, ["status", "matchingRows"], "W43_POSTGRES_NEGATIVE_ASSERTION_FIELDS_INVALID");
    if (entry["status"] !== "DENIED" || entry["matchingRows"] !== 0) {
      fail("W43_POSTGRES_NEGATIVE_ASSERTION_TRUTH_INVALID");
    }
  }
  const observations = array(raw["observations"], "W43_POSTGRES_OBSERVATIONS_INVALID")
    .map(parsePostgresObservation);
  if (observations.length !== scenarioIds.length ||
      new Set(observations.map((entry) => entry.scenarioId)).size !== scenarioIds.length) {
    fail("W43_POSTGRES_OBSERVATION_INVENTORY_INVALID");
  }
  for (const observation of observations) {
    const scenario = scenarios.get(observation.scenarioId)!;
    const exactOne = [
      observation.sourceGroundingRows, observation.replayGroundingRows, observation.resultRows,
      observation.currentnessEvidenceRows, observation.selectedProductRows,
      observation.priorGroundingLinkRows, observation.checkCurrentExecutionRows,
    ];
    if (observation.groundingStatus !== scenario.groundingStatus ||
        observation.sourceGroundingIdHash !== scenario.sourceGroundingIdHash ||
        observation.replayGroundingIdHash !== scenario.replayGroundingIdHash ||
        observation.persistedResultHash !== scenario.persistedResultHash ||
        observation.currentnessDecisionHash !== scenario.currentnessDecisionHash ||
        exactOne.some((count) => count !== 1) || observation.stageRows < 1 || observation.executionRows < 1 ||
        observation.originalSourceExecutionRows !== scenario.originalSourceExecutionCount ||
        observation.newCurrentSourceExecutionRows !== scenario.newCurrentSourceExecutionCount ||
        observation.sourceChangedDuringQueryRows !== scenario.sourceChangedDuringQueryCount ||
        observation.sourceRequestEvidenceHash !== scenario.sourceRequestEvidenceHash ||
        observation.replayRequestEvidenceHash !== scenario.replayRequestEvidenceHash ||
        observation.sourcePlanHash !== scenario.sourcePlanHash ||
        observation.sourceBarrierTransitionHash !== scenario.sourceBarrierTransitionHash ||
        observation.replayBarrierTransitionHash !== scenario.replayBarrierTransitionHash ||
        canonicalJson(observation.replayBarrierArm) !== canonicalJson(scenario.replayBarrierArm) ||
        observation.causalBindingHash !== scenario.causalBindingHash ||
        JSON.stringify(observation.barrierTransitionHashes) !== JSON.stringify(scenario.barrierTransitionHashes)) {
      fail("W43_POSTGRES_OBSERVATION_TRUTH_INVALID", observation.scenarioId);
    }
  }
  return { loaded, generatedAt, binding, negativeAssertions, authorityTupleHash: authorityHash,
    observations: new Map(observations.map((entry) => [entry.scenarioId, entry])) };
}

interface UnitTestResult {
  readonly filePath: string;
  readonly fullName: string;
  readonly status: string;
}

function normalizeTestPath(root: string, value: unknown): string {
  const name = text(value, "W43_UNIT_TEST_FILE_INVALID").replaceAll("\\", "/");
  const rootPath = root.replaceAll("\\", "/").replace(/\/$/u, "");
  const repositoryPath = name.startsWith(`${rootPath}/`) ? name.slice(rootPath.length + 1) : name;
  if (!receiptFiles.includes(repositoryPath)) fail("W43_UNIT_TEST_FILE_NOT_AUTHORIZED", repositoryPath);
  return repositoryPath;
}

function parseVitestResults(root: string, rawReport: JsonObject): UnitTestResult[] {
  if (rawReport["success"] !== true || rawReport["numFailedTests"] !== 0 || rawReport["numPendingTests"] !== 0 ||
      rawReport["numTodoTests"] !== 0) fail("W43_UNIT_RAW_REPORT_NOT_GREEN");
  const results: UnitTestResult[] = [];
  for (const rawFile of array(rawReport["testResults"], "W43_UNIT_RAW_RESULTS_INVALID")) {
    const file = object(rawFile, "W43_UNIT_RAW_FILE_INVALID");
    const filePath = normalizeTestPath(root, file["name"]);
    if (file["status"] !== "passed") fail("W43_UNIT_RAW_FILE_NOT_PASSED", filePath);
    for (const rawAssertion of array(file["assertionResults"], "W43_UNIT_RAW_ASSERTIONS_INVALID")) {
      const assertion = object(rawAssertion, "W43_UNIT_RAW_ASSERTION_INVALID");
      results.push({
        filePath,
        fullName: text(assertion["fullName"], "W43_UNIT_RAW_ASSERTION_NAME_INVALID"),
        status: text(assertion["status"], "W43_UNIT_RAW_ASSERTION_STATUS_INVALID"),
      });
    }
  }
  if (new Set(results.map((entry) => `${entry.filePath}\u0000${entry.fullName}`)).size !== results.length) {
    fail("W43_UNIT_TEST_ID_REUSED");
  }
  return results;
}

function parseCanonicalUnitResults(value: JsonObject): UnitTestResult[] {
  exactKeys(value, ["schemaVersion", "runner", "runnerVersion", "selectedTestCount", "testResults"],
    "W43_UNIT_CANONICAL_REPORT_FIELDS_INVALID");
  if (value["schemaVersion"] !== "wsgs-gdps-v021-w43-canonical-vitest-report/1.0" ||
      value["runner"] !== "vitest" || !/^4\./u.test(text(value["runnerVersion"],
        "W43_UNIT_CANONICAL_RUNNER_VERSION_INVALID"))) {
    fail("W43_UNIT_CANONICAL_REPORT_IDENTITY_INVALID");
  }
  const results: UnitTestResult[] = [];
  for (const rawFile of array(value["testResults"], "W43_UNIT_CANONICAL_RESULTS_INVALID")) {
    const file = object(rawFile, "W43_UNIT_CANONICAL_FILE_INVALID");
    exactKeys(file, ["filePath", "assertions"], "W43_UNIT_CANONICAL_FILE_FIELDS_INVALID");
    const filePath = text(file["filePath"], "W43_UNIT_CANONICAL_FILE_PATH_INVALID");
    if (!receiptFiles.includes(filePath) || /^[A-Za-z]:|^\/|\\/u.test(filePath) || filePath.includes("..")) {
      fail("W43_UNIT_CANONICAL_FILE_PATH_INVALID", filePath);
    }
    for (const rawAssertion of array(file["assertions"], "W43_UNIT_CANONICAL_ASSERTIONS_INVALID")) {
      const assertion = object(rawAssertion, "W43_UNIT_CANONICAL_ASSERTION_INVALID");
      exactKeys(assertion, ["fullName", "status"], "W43_UNIT_CANONICAL_ASSERTION_FIELDS_INVALID");
      results.push({
        filePath,
        fullName: text(assertion["fullName"], "W43_UNIT_CANONICAL_ASSERTION_NAME_INVALID"),
        status: text(assertion["status"], "W43_UNIT_CANONICAL_ASSERTION_STATUS_INVALID"),
      });
    }
  }
  if (integer(value["selectedTestCount"], "W43_UNIT_CANONICAL_COUNT_INVALID") !== results.length ||
      new Set(results.map((entry) => `${entry.filePath}\u0000${entry.fullName}`)).size !== results.length ||
      results.some((entry) => entry.status !== "passed")) {
    fail("W43_UNIT_CANONICAL_TEST_INVENTORY_INVALID");
  }
  return results;
}

function loadUnitReceipt(root: string, path: string, candidateSha: string): {
  readonly loaded: LoadedReceipt;
  readonly raw: LoadedReceipt;
  readonly generatedAt: string;
  readonly binding: RuntimeBinding;
  readonly testsByName: ReadonlyMap<string, UnitTestResult>;
} {
  const loaded = loadRepositoryFile(root, path, receiptPrefix, "W43_UNIT_RECEIPT_MISSING");
  const document = loaded.document;
  exactKeys(document, [
    "schemaVersion", "generatedAt", "binding", "runner", "runnerVersion", "testFiles",
    "exitCode", "rawReport",
  ], "W43_UNIT_RECEIPT_FIELDS_INVALID");
  if (document["schemaVersion"] !== "wsgs-gdps-v021-w43-unit-receipt/1.0" ||
      document["runner"] !== "vitest" || document["exitCode"] !== 0) fail("W43_UNIT_RECEIPT_IDENTITY_INVALID");
  const generatedAt = instant(document["generatedAt"], "W43_UNIT_RECEIPT_TIME_INVALID");
  const binding = parseRuntimeBinding(document["binding"], candidateSha);
  const declaredFiles = array(document["testFiles"], "W43_UNIT_RECEIPT_FILES_INVALID")
    .map((entry) => text(entry, "W43_UNIT_RECEIPT_FILES_INVALID"));
  if (JSON.stringify(declaredFiles) !== JSON.stringify(receiptFiles)) fail("W43_UNIT_RECEIPT_FILE_SET_INVALID");
  if (!/^4\./u.test(text(document["runnerVersion"], "W43_UNIT_RUNNER_VERSION_INVALID"))) {
    fail("W43_UNIT_RUNNER_VERSION_INVALID");
  }
  const rawReference = object(document["rawReport"], "W43_UNIT_RAW_REFERENCE_INVALID");
  exactKeys(rawReference, ["path", "hash", "byteLength"], "W43_UNIT_RAW_REFERENCE_FIELDS_INVALID");
  const raw = loadRepositoryFile(root, rawReference["path"], receiptPrefix, "W43_UNIT_RAW_REPORT_MISSING");
  if (digest(rawReference["hash"], "W43_UNIT_RAW_REFERENCE_HASH_INVALID") !== raw.reference.hash ||
      integer(rawReference["byteLength"], "W43_UNIT_RAW_REFERENCE_LENGTH_INVALID") !== raw.reference.byteLength) {
    fail("W43_UNIT_RAW_REFERENCE_DRIFT");
  }
  const results = parseCanonicalUnitResults(raw.document);
  const testsByName = new Map(results.map((entry) => [entry.fullName, entry]));
  const requiredNames = new Set(Object.values(unitTestsByAcceptanceId).flat());
  for (const name of requiredNames) {
    const result = testsByName.get(name);
    if (!result || result.status !== "passed") fail("W43_REQUIRED_UNIT_TEST_NOT_PASSED", name);
  }
  return { loaded, raw, generatedAt, binding, testsByName };
}

function assertSameBinding(left: RuntimeBinding, right: RuntimeBinding, code: string): void {
  if (canonicalJson(left) !== canonicalJson(right)) fail(code);
}

function scenarioSummary(scenario: ScenarioReceipt): JsonObject {
  return {
    scenarioId: scenario.scenarioId,
    replayMode: scenario.replayMode,
    groundingStatus: scenario.groundingStatus,
    terminalStatus: scenario.terminalStatus,
    normalizedStatus: scenario.normalizedStatus,
    currentness: scenario.currentness,
    semanticCode: scenario.semanticCode,
    warnings: scenario.warnings,
    priorContentHash: scenario.priorContentHash,
    currentContentHash: scenario.currentContentHash,
    checkCurrentExecutionCount: scenario.checkCurrentExecutionCount,
    originalSourceExecutionCount: scenario.originalSourceExecutionCount,
    newCurrentSourceExecutionCount: scenario.newCurrentSourceExecutionCount,
    sourceChangedDuringQueryCount: scenario.sourceChangedDuringQueryCount,
    retryCount: scenario.retryCount,
    historicalPayloadRead: scenario.historicalPayloadRead,
    productVersionPresent: scenario.productVersionPresent,
    currentnessEvidencePersisted: scenario.currentnessEvidencePersisted,
    authorityTupleHash: scenario.authorityTupleHash,
    currentnessDecisionHash: scenario.currentnessDecisionHash,
    sourceRequestEvidenceHash: scenario.sourceRequestEvidenceHash,
    replayRequestEvidenceHash: scenario.replayRequestEvidenceHash,
    sourcePlanHash: scenario.sourcePlanHash,
    sourceBarrierTransitionHash: scenario.sourceBarrierTransitionHash,
    replayBarrierTransitionHash: scenario.replayBarrierTransitionHash,
    replayBarrierArm: scenario.replayBarrierArm,
    barrierTransitionHashes: scenario.barrierTransitionHashes,
    causalBindingHash: scenario.causalBindingHash,
  };
}

function postgresSummary(observation: PostgresObservation): JsonObject {
  return {
    scenarioId: observation.scenarioId,
    groundingStatus: observation.groundingStatus,
    transactionMode: observation.transactionMode,
    sourceGroundingRows: observation.sourceGroundingRows,
    replayGroundingRows: observation.replayGroundingRows,
    resultRows: observation.resultRows,
    stageRows: observation.stageRows,
    executionRows: observation.executionRows,
    currentnessEvidenceRows: observation.currentnessEvidenceRows,
    selectedProductRows: observation.selectedProductRows,
    priorGroundingLinkRows: observation.priorGroundingLinkRows,
    checkCurrentExecutionRows: observation.checkCurrentExecutionRows,
    originalSourceExecutionRows: observation.originalSourceExecutionRows,
    newCurrentSourceExecutionRows: observation.newCurrentSourceExecutionRows,
    sourceChangedDuringQueryRows: observation.sourceChangedDuringQueryRows,
    currentnessDecisionHash: observation.currentnessDecisionHash,
    sourceRequestEvidenceHash: observation.sourceRequestEvidenceHash,
    replayRequestEvidenceHash: observation.replayRequestEvidenceHash,
    sourcePlanHash: observation.sourcePlanHash,
    sourceBarrierTransitionHash: observation.sourceBarrierTransitionHash,
    replayBarrierTransitionHash: observation.replayBarrierTransitionHash,
    replayBarrierArm: observation.replayBarrierArm,
    barrierTransitionHashes: observation.barrierTransitionHashes,
    causalBindingHash: observation.causalBindingHash,
  };
}

function evidenceFacts(options: {
  readonly row: W43Row;
  readonly evidenceType: EvidenceType;
  readonly gateRunId: string;
  readonly runtimeIdentityHash: string;
  readonly unit: ReturnType<typeof loadUnitReceipt>;
  readonly currentness: ReturnType<typeof loadCurrentnessReceipt>;
  readonly postgres: ReturnType<typeof loadPostgresReceipt>;
}): JsonObject {
  const { row, evidenceType, unit, currentness, postgres } = options;
  const selectedScenarioIds = scenariosByAcceptanceId[row.id]!;
  const base = {
    gateRunId: options.gateRunId,
    runtimeIdentityHash: options.runtimeIdentityHash,
    matrixScenario: row.scenario,
    matrixExpected: row.expected,
  };
  if (evidenceType === "UNIT") {
    const tests = unitTestsByAcceptanceId[row.id]!.map((name) => {
      const test = unit.testsByName.get(name)!;
      return { filePath: test.filePath, fullName: test.fullName, status: test.status };
    });
    return {
      ...base,
      sourceReceipt: unit.loaded.reference,
      rawVitestReport: unit.raw.reference,
      independentlyPassedTests: tests,
    };
  }
  if (evidenceType === "CURRENTNESS") {
    return {
      ...base,
      sourceReceipt: currentness.loaded.reference,
      barrierAttestation: currentness.barrier.reference,
      policyFacts: selectedScenarioIds.map((id) => scenarioSummary(currentness.scenarios.get(id)!)),
    };
  }
  return {
    ...base,
    sourceReceipt: postgres.loaded.reference,
    barrierAttestation: currentness.barrier.reference,
    databaseIdentityHash: postgres.binding.databaseIdentityHash,
    authorityTupleHash: postgres.authorityTupleHash,
    negativeAssertions: postgres.negativeAssertions,
    persistedFacts: selectedScenarioIds.map((id) => postgresSummary(postgres.observations.get(id)!)),
  };
}

function outputPath(value: string, expectedPrefix: string, code: string): string {
  return normalizeRepositoryPath(value, expectedPrefix, code);
}

export function captureGdpsV021W43UnitReceipt(
  input: W43UnitReceiptCaptureInput,
): W43UnitReceiptCaptureResult {
  const root = resolve(input.repositoryRoot);
  const candidateSha = commit(input.candidateSha, "W43_CANDIDATE_SHA_INVALID");
  assertCurrentHead(root, candidateSha);
  const currentness = loadCurrentnessReceipt(root, input.currentnessReceiptPath, candidateSha);
  const rawReportPath = outputPath(input.rawReportPath, receiptPrefix, "W43_UNIT_RAW_OUTPUT_PATH_INVALID");
  const unitReceiptPath = outputPath(input.unitReceiptPath, receiptPrefix, "W43_UNIT_OUTPUT_PATH_INVALID");
  if (rawReportPath === unitReceiptPath) fail("W43_UNIT_OUTPUT_PATH_COLLISION");
  const rawAbsolute = resolve(root, rawReportPath);
  const unitAbsolute = resolve(root, unitReceiptPath);
  mkdirSync(dirname(rawAbsolute), { recursive: true });
  mkdirSync(dirname(unitAbsolute), { recursive: true });
  const vitestEntrypoint = resolve(root, "node_modules", "vitest", "vitest.mjs");
  const vitestPackagePath = resolve(root, "node_modules", "vitest", "package.json");
  if (!existsSync(vitestEntrypoint) || !existsSync(vitestPackagePath)) fail("W43_VITEST_NOT_INSTALLED");
  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "wsgs-w43-vitest-"));
  const temporaryRawPath = resolve(temporaryDirectory, "vitest-raw.json");
  let tests: UnitTestResult[];
  try {
    const commandArguments = [
      vitestEntrypoint,
      "run",
      ...receiptFiles,
      "--reporter=json",
      `--outputFile=${temporaryRawPath}`,
    ];
    const executed = spawnSync(process.execPath, commandArguments, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 120_000,
    });
    if (executed.error || executed.status !== 0 || !existsSync(temporaryRawPath)) {
      fail("W43_UNIT_TEST_EXECUTION_FAILED", executed.error?.message ?? `exit=${String(executed.status)}`);
    }
    let rawDocument: JsonObject;
    try {
      rawDocument = object(JSON.parse(readFileSync(temporaryRawPath, "utf8")), "W43_UNIT_CAPTURE_RAW_INVALID");
    } catch (error) {
      if (error instanceof GdpsV021W43EvidenceError) throw error;
      fail("W43_UNIT_CAPTURE_RAW_INVALID", error instanceof Error ? error.message : String(error));
    }
    tests = parseVitestResults(root, rawDocument);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  const requiredNames = new Set(Object.values(unitTestsByAcceptanceId).flat());
  for (const name of requiredNames) {
    if (!tests.some((test) => test.fullName === name && test.status === "passed")) {
      fail("W43_REQUIRED_UNIT_TEST_NOT_PASSED", name);
    }
  }
  const vitestPackage = object(JSON.parse(readFileSync(vitestPackagePath, "utf8")),
    "W43_VITEST_PACKAGE_INVALID");
  const runnerVersion = text(vitestPackage["version"], "W43_VITEST_VERSION_INVALID");
  const selectedTests = [...requiredNames].sort().map((fullName) => {
    const test = tests.find((entry) => entry.fullName === fullName)!;
    return test;
  });
  const canonicalReport = {
    schemaVersion: "wsgs-gdps-v021-w43-canonical-vitest-report/1.0",
    runner: "vitest",
    runnerVersion,
    selectedTestCount: selectedTests.length,
    testResults: receiptFiles.map((filePath) => ({
      filePath,
      assertions: selectedTests.filter((entry) => entry.filePath === filePath)
        .map((entry) => ({ fullName: entry.fullName, status: "passed" })),
    })),
  };
  const rawBytes = jsonBytes(canonicalReport);
  writeFileSync(rawAbsolute, rawBytes);
  const generatedAt = input.generatedAt
    ? instant(input.generatedAt, "W43_UNIT_CAPTURE_TIME_INVALID")
    : new Date().toISOString();
  const unitDocument = {
    schemaVersion: "wsgs-gdps-v021-w43-unit-receipt/1.0",
    generatedAt,
    binding: currentness.binding,
    runner: "vitest",
    runnerVersion,
    testFiles: receiptFiles,
    exitCode: 0,
    rawReport: { path: rawReportPath, hash: sha256(rawBytes), byteLength: rawBytes.byteLength },
  };
  writeFileSync(unitAbsolute, jsonBytes(unitDocument));
  return {
    rawReportPath,
    unitReceiptPath,
    rawReportHash: sha256(rawBytes),
    rawReportByteLength: rawBytes.byteLength,
    selectedTestCount: requiredNames.size,
    candidateSha,
    gateRunId: currentness.binding.gateRunId,
    runtimeIdentityHash: currentness.binding.runtimeIdentityHash,
  };
}

export function produceGdpsV021W43Evidence(input: W43EvidenceProducerInput): W43EvidenceProducerResult {
  const root = resolve(input.repositoryRoot);
  const candidateSha = commit(input.candidateSha, "W43_CANDIDATE_SHA_INVALID");
  const rows = loadW43Rows(root, input.matrixPath ?? "acceptance/gdps-v0.2.1/acceptance-matrix.csv");
  const currentness = loadCurrentnessReceipt(root, input.currentnessReceiptPath, candidateSha);
  const postgres = loadPostgresReceipt(root, input.postgresReceiptPath, candidateSha, currentness.scenarios);
  const unit = loadUnitReceipt(root, input.unitReceiptPath, candidateSha);
  assertSameBinding(currentness.binding, postgres.binding, "W43_POSTGRES_RUNTIME_BINDING_MISMATCH");
  assertSameBinding(currentness.binding, unit.binding, "W43_UNIT_RUNTIME_BINDING_MISMATCH");
  if (currentness.barrier.reference.hash !==
      (object(postgres.loaded.document["barrierAttestation"], "W43_POSTGRES_BARRIER_REFERENCE_INVALID")["hash"])) {
    fail("W43_RECEIPT_BARRIER_REFERENCE_MISMATCH");
  }
  if (currentness.authorityTupleHash !== postgres.authorityTupleHash) {
    fail("W43_RECEIPT_AUTHORITY_TUPLE_MISMATCH");
  }
  const reportPath = outputPath(input.reportPath ?? defaultReportPath,
    "reports/wsgs-v0.2-gdps-v0.2.1/", "W43_REPORT_PATH_INVALID");
  const manifestEntryPath = outputPath(input.manifestEntryPath ?? defaultManifestEntryPath,
    "reports/wsgs-v0.2-gdps-v0.2.1/", "W43_MANIFEST_ENTRY_PATH_INVALID");
  const generatedAt = input.generatedAt
    ? instant(input.generatedAt, "W43_GENERATED_AT_INVALID")
    : [unit.generatedAt, currentness.generatedAt, postgres.generatedAt]
      .sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1)!;
  const files = new Map<string, Buffer>();
  const ledgerArtifacts: JsonObject[] = [];
  const assertions: JsonObject[] = [];
  for (const row of rows) {
    for (const evidenceType of evidenceTypes) {
      const assertionId = `${row.id}.${evidenceType}`;
      const artifactPath = `${evidencePrefix}${row.id.toLowerCase()}.${evidenceType.toLowerCase()}.json`;
      const artifactDocument = {
        schemaVersion: "wsgs-gdps-v021-w43-assertion-evidence/1.0",
        candidateSha,
        acceptanceId: row.id,
        evidenceType,
        assertionId,
        status: "PASS",
        facts: evidenceFacts({
          row,
          evidenceType,
          gateRunId: currentness.binding.gateRunId,
          runtimeIdentityHash: currentness.binding.runtimeIdentityHash,
          unit,
          currentness,
          postgres,
        }),
      };
      const bytes = jsonBytes(artifactDocument);
      files.set(artifactPath, bytes);
      ledgerArtifacts.push({
        acceptanceId: row.id,
        evidenceType,
        assertionId,
        artifactPath,
        artifactHash: sha256(bytes),
        byteLength: bytes.byteLength,
      });
      assertions.push({ acceptanceId: row.id, type: evidenceType, assertionId, status: "PASS", polarity: "POSITIVE" });
    }
  }
  if (files.size !== 54 || new Set([...files.values()].map((bytes) => sha256(bytes))).size !== 54) {
    fail("W43_EVIDENCE_ARTIFACT_INVENTORY_INVALID");
  }
  const report = {
    schemaVersion: "wsgs-gdps-v021-w43-phase-report/1.0",
    generatedAt,
    candidateSha,
    target,
    phase: "W43",
    status: "PASS",
    evidenceLedger: {
      schemaVersion: "wsgs-gdps-v021-w43-evidence-ledger/1.0",
      candidateSha,
      phase: "W43",
      artifacts: ledgerArtifacts,
    },
  };
  const reportBytes = jsonBytes(report);
  files.set(reportPath, reportBytes);
  const manifestEntry: JsonObject = {
    reportId: "w43-currentness-real-evidence",
    phase: "W43",
    reportStatus: "PASS",
    artifactPath: reportPath,
    artifactHash: sha256(reportBytes),
    candidateSha,
    target,
    assertions,
  };
  files.set(manifestEntryPath, jsonBytes(manifestEntry));
  return {
    files,
    reportPath,
    manifestEntryPath,
    manifestEntry,
    artifactCount: 54,
    assertionCount: 54,
    candidateSha,
    gateRunId: currentness.binding.gateRunId,
    runtimeIdentityHash: currentness.binding.runtimeIdentityHash,
  };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredArgument(name: string): string {
  const value = argument(name);
  if (!value) fail("W43_CLI_ARGUMENT_REQUIRED", name);
  return value;
}

function assertCurrentHead(root: string, expected: string): void {
  let head: string;
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    fail("W43_GIT_HEAD_UNAVAILABLE", error instanceof Error ? error.message : String(error));
  }
  if (head !== expected) fail("W43_CANDIDATE_HEAD_MISMATCH", `expected=${expected} actual=${head}`);
  const changed = [
    execFileSync("git", ["diff", "--name-only", "--no-renames"], { cwd: root, encoding: "utf8" }),
    execFileSync("git", ["diff", "--cached", "--name-only", "--no-renames"], { cwd: root, encoding: "utf8" }),
    execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }),
  ].join("\n").split(/\r?\n/u).map((entry) => entry.trim().replaceAll("\\", "/")).filter(Boolean);
  const implementationChanges = [...new Set(changed)].filter((path) =>
    !path.startsWith("reports/wsgs-v0.2-gdps-v0.2.1/"));
  if (implementationChanges.length > 0) fail("W43_IMPLEMENTATION_WORKTREE_NOT_CLEAN", implementationChanges.sort().join("|"));
}

function writeOrCheck(root: string, result: W43EvidenceProducerResult, mode: "write" | "check"): void {
  const expectedEvidencePaths = new Set([...result.files.keys()].filter((path) => path.startsWith(evidencePrefix)));
  const evidenceDirectory = resolve(root, evidencePrefix);
  if (existsSync(evidenceDirectory)) {
    const actual = readdirSync(evidenceDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => `${evidencePrefix}${entry.name}`);
    const unexpected = actual.filter((path) => !expectedEvidencePaths.has(path));
    if (unexpected.length > 0) fail("W43_STALE_EVIDENCE_ARTIFACT_PRESENT", unexpected.sort().join("|"));
  }
  for (const [path, bytes] of result.files) {
    const absolute = resolve(root, path);
    if (mode === "check") {
      if (!existsSync(absolute) || !statSync(absolute).isFile() || !readFileSync(absolute).equals(bytes)) {
        fail("W43_EVIDENCE_OUTPUT_STALE", path);
      }
    } else {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, bytes);
    }
  }
}

function runCli(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const candidateSha = requiredArgument("--candidate-sha");
  if (process.argv.includes("--capture-unit")) {
    const captured = captureGdpsV021W43UnitReceipt({
      repositoryRoot: root,
      candidateSha,
      currentnessReceiptPath: requiredArgument("--currentness-receipt"),
      rawReportPath: requiredArgument("--unit-raw-report"),
      unitReceiptPath: requiredArgument("--unit-receipt"),
    });
    process.stdout.write(`${JSON.stringify({
      marker: "WSGS_GDPS_V021_W43_UNIT_RECEIPT_CAPTURED",
      ...captured,
    }, null, 2)}\n`);
    return;
  }
  assertCurrentHead(root, candidateSha);
  const result = produceGdpsV021W43Evidence({
    repositoryRoot: root,
    candidateSha,
    unitReceiptPath: requiredArgument("--unit-receipt"),
    postgresReceiptPath: requiredArgument("--postgres-receipt"),
    currentnessReceiptPath: requiredArgument("--currentness-receipt"),
    ...(argument("--matrix") ? { matrixPath: argument("--matrix")! } : {}),
    ...(argument("--report") ? { reportPath: argument("--report")! } : {}),
    ...(argument("--manifest-entry") ? { manifestEntryPath: argument("--manifest-entry")! } : {}),
  });
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  if (write === check) fail("W43_CLI_MODE_REQUIRED", "select exactly one of --write or --check");
  writeOrCheck(root, result, write ? "write" : "check");
  process.stdout.write(`${JSON.stringify({
    marker: "WSGS_GDPS_V021_W43_EVIDENCE_PRODUCED",
    candidateSha: result.candidateSha,
    gateRunId: result.gateRunId,
    runtimeIdentityHash: result.runtimeIdentityHash,
    artifactCount: result.artifactCount,
    assertionCount: result.assertionCount,
    reportPath: result.reportPath,
    manifestEntryPath: result.manifestEntryPath,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runCli();
