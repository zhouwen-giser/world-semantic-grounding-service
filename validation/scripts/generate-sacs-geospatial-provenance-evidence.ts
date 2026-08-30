import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;
type Sha256Digest = `sha256:${string}`;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const reportRoot = resolve(repoRoot, "reports/sacs-geospatial-v1");
const writeMode = process.argv.includes("--write");

const focusedTestPaths = [
  "packages/northbound-geospatial-findings/src/source-normalizer.test.ts",
  "packages/northbound-geospatial-findings/src/gap-normalizer.test.ts",
  "packages/northbound-geospatial-findings/src/result-normalizer.test.ts",
  "packages/northbound-geospatial-findings/src/registry.test.ts"
] as const;

const logicalTestIds = new Map<string, string>([
  ["source-normalizer.test.ts", "SOURCE_NORMALIZER"],
  ["gap-normalizer.test.ts", "GAP_NORMALIZER"],
  ["result-normalizer.test.ts", "RESULT_NORMALIZER"],
  ["registry.test.ts", "DECODER_REGISTRY"]
]);

const paths = {
  packageManifest: "package.json",
  generator: "validation/scripts/generate-sacs-geospatial-provenance-evidence.ts",
  realGate: "validation/scripts/real-sacs-geospatial-provenance-gate.ts",
  validatedEnvelope: "packages/gowm-execution-evidence/src/validated-envelope.ts",
  source: "packages/northbound-geospatial-findings/src/source-normalizer.ts",
  sourceTest: "packages/northbound-geospatial-findings/src/source-normalizer.test.ts",
  gap: "packages/northbound-geospatial-findings/src/gap-normalizer.ts",
  gapTest: "packages/northbound-geospatial-findings/src/gap-normalizer.test.ts",
  result: "packages/northbound-geospatial-findings/src/result-normalizer.ts",
  resultTest: "packages/northbound-geospatial-findings/src/result-normalizer.test.ts",
  validation: "packages/northbound-geospatial-findings/src/validation.ts",
  registry: "packages/northbound-geospatial-findings/src/registry.ts",
  publicIndex: "packages/northbound-geospatial-findings/src/index.ts",
  types: "packages/northbound-geospatial-findings/src/types.ts",
  sourceSchema: "contracts/wsgs-v0.2.1-sacs-geospatial/source-product.schema.json",
  gapSchema: "contracts/wsgs-v0.2.1-sacs-geospatial/typed-gap.schema.json",
  findingSchema: "contracts/wsgs-v0.2.1-sacs-geospatial/world-finding.schema.json",
  profileSchema: "contracts/wsgs-v0.2.1-sacs-geospatial/geospatial-findings.schema.json",
  resultExtensionSchema: "contracts/wsgs-v0.2.1-sacs-geospatial/grounding-result-extension.schema.json"
} as const;

function sha256(value: string | Buffer): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NON_FINITE_CANONICAL_VALUE");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonObject)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  throw new Error("UNSUPPORTED_CANONICAL_VALUE");
}

function canonicalHash(value: unknown): Sha256Digest {
  return sha256(JSON.stringify(canonicalValue(value)));
}

function raw(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function rawHash(path: string): Sha256Digest {
  return sha256(raw(path).replace(/\r\n?/gu, "\n"));
}

function jsonHash(path: string): Sha256Digest {
  return canonicalHash(JSON.parse(raw(path)));
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function materialize(path: string, content: string): void {
  const absolute = resolve(repoRoot, path);
  if (writeMode) {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
    if (readFileSync(absolute, "utf8") !== content) throw new Error(`N03_EVIDENCE_WRITE_FAILED:${path}`);
    return;
  }
  if (!existsSync(absolute)) throw new Error(`N03_EVIDENCE_MISSING:${path}`);
  if (readFileSync(absolute, "utf8") !== content) throw new Error(`N03_EVIDENCE_DRIFT:${path}`);
}

function object(value: unknown, code: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonObject;
}

function integer(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(code);
  return value as number;
}

function exactKeys(value: JsonObject, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const locked = [...expected].sort();
  if (actual.length !== locked.length || actual.some((key, index) => key !== locked[index])) {
    throw new Error(code);
  }
}

function readOption(prefix: string): string | undefined {
  const option = process.argv.find((argument) => argument.startsWith(prefix));
  return option?.slice(prefix.length);
}

function collectVitestResult(): JsonObject {
  const supplied = readOption("--vitest-json=");
  if (supplied !== undefined) return object(JSON.parse(readFileSync(resolve(supplied), "utf8")), "N03_VITEST_JSON_INVALID");
  if (!writeMode) throw new Error("N03_FOCUSED_TEST_EVIDENCE_MISSING");

  const temporaryRoot = mkdtempSync(resolve(tmpdir(), "wsgs-n03-vitest-"));
  const outputFile = resolve(temporaryRoot, "result.json");
  try {
    const vitestEntrypoint = resolve(repoRoot, "node_modules/vitest/vitest.mjs");
    if (!existsSync(vitestEntrypoint)) throw new Error("N03_VITEST_ENTRYPOINT_MISSING");
    const run = spawnSync(process.execPath, [
      vitestEntrypoint,
      "run",
      ...focusedTestPaths,
      "--reporter=json",
      `--outputFile=${outputFile}`
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (run.error !== undefined) throw new Error(`N03_FOCUSED_TEST_EXECUTION_FAILED:${run.error.message}`);
    if (run.status !== 0 || !existsSync(outputFile)) {
      throw new Error(`N03_FOCUSED_TESTS_FAILED:exit=${run.status ?? "null"}`);
    }
    return object(JSON.parse(readFileSync(outputFile, "utf8")), "N03_VITEST_JSON_INVALID");
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function validateFocusedExecution(report: JsonObject, expectedInputSetHash: Sha256Digest): JsonObject {
  const success = report["success"];
  const total = integer(report["numTotalTests"], "N03_VITEST_TOTAL_INVALID");
  const passed = integer(report["numPassedTests"], "N03_VITEST_PASSED_INVALID");
  const failed = integer(report["numFailedTests"], "N03_VITEST_FAILED_INVALID");
  const pending = integer(report["numPendingTests"], "N03_VITEST_PENDING_INVALID");
  if (success !== true || total < 1 || passed !== total || failed !== 0 || pending !== 0) {
    throw new Error(`N03_FOCUSED_TESTS_NOT_GREEN:passed=${passed}:total=${total}:failed=${failed}:pending=${pending}`);
  }

  const rawSuites = report["testResults"];
  if (!Array.isArray(rawSuites) || rawSuites.length !== focusedTestPaths.length) {
    throw new Error("N03_FOCUSED_TEST_SUITE_SET_INVALID");
  }
  const suites = rawSuites.map((rawSuite) => {
    const suite = object(rawSuite, "N03_VITEST_SUITE_INVALID");
    if (typeof suite["name"] !== "string") throw new Error("N03_VITEST_SUITE_NAME_INVALID");
    const filename = basename(suite["name"] as string);
    const logicalTestId = logicalTestIds.get(filename);
    if (logicalTestId === undefined) throw new Error(`N03_UNEXPECTED_TEST_SUITE:${filename}`);
    const assertions = suite["assertionResults"];
    if (!Array.isArray(assertions) || assertions.length < 1) throw new Error(`N03_EMPTY_TEST_SUITE:${logicalTestId}`);
    const suitePassed = assertions.filter((entry) => object(entry, "N03_VITEST_ASSERTION_INVALID")["status"] === "passed").length;
    if (suitePassed !== assertions.length) throw new Error(`N03_TEST_SUITE_NOT_GREEN:${logicalTestId}`);
    return { logicalTestId, passed: suitePassed };
  }).sort((left, right) => left.logicalTestId.localeCompare(right.logicalTestId));
  if (new Set(suites.map((suite) => suite.logicalTestId)).size !== focusedTestPaths.length) {
    throw new Error("N03_FOCUSED_TEST_SUITE_DUPLICATE");
  }
  if (suites.reduce((sum, suite) => sum + suite.passed, 0) !== passed) {
    throw new Error("N03_FOCUSED_TEST_COUNT_MISMATCH");
  }
  return {
    schemaVersion: "wsgs-v021-n03-focused-test-execution/1.0",
    status: "PASS",
    inputSetHash: expectedInputSetHash,
    suites,
    totals: { expected: total, passed, failed, pending },
    executionClass: "FOCUSED_UNIT",
    exitCode: 0,
    credentialsIncluded: false,
    localPathsIncluded: false,
    requestIdentifiersIncluded: false
  };
}

function validateStoredFocusedExecution(value: unknown, expectedInputSetHash: Sha256Digest): JsonObject {
  const report = object(value, "N03_FOCUSED_TEST_EVIDENCE_INVALID");
  const totals = object(report["totals"], "N03_FOCUSED_TEST_TOTALS_INVALID");
  exactKeys(report, [
    "schemaVersion", "status", "inputSetHash", "suites", "totals", "executionClass", "exitCode",
    "credentialsIncluded", "localPathsIncluded", "requestIdentifiersIncluded"
  ], "N03_FOCUSED_TEST_EVIDENCE_FIELDS_INVALID");
  exactKeys(totals, ["expected", "passed", "failed", "pending"], "N03_FOCUSED_TEST_TOTAL_FIELDS_INVALID");
  if (report["schemaVersion"] !== "wsgs-v021-n03-focused-test-execution/1.0"
    || report["status"] !== "PASS"
    || report["inputSetHash"] !== expectedInputSetHash
    || report["executionClass"] !== "FOCUSED_UNIT"
    || report["exitCode"] !== 0
    || report["credentialsIncluded"] !== false
    || report["localPathsIncluded"] !== false
    || report["requestIdentifiersIncluded"] !== false
    || integer(totals["expected"], "N03_FOCUSED_TEST_EXPECTED_INVALID") < 1
    || totals["expected"] !== totals["passed"]
    || totals["failed"] !== 0
    || totals["pending"] !== 0) {
    throw new Error("N03_FOCUSED_TEST_EVIDENCE_STALE_OR_INVALID");
  }
  const suites = report["suites"];
  if (!Array.isArray(suites) || suites.length !== focusedTestPaths.length) {
    throw new Error("N03_FOCUSED_TEST_EVIDENCE_SUITE_SET_INVALID");
  }
  let suitePassedTotal = 0;
  const logicalIds = suites.map((entry) => {
    const suite = object(entry, "N03_FOCUSED_TEST_EVIDENCE_SUITE_INVALID");
    exactKeys(suite, ["logicalTestId", "passed"], "N03_FOCUSED_TEST_EVIDENCE_SUITE_FIELDS_INVALID");
    suitePassedTotal += integer(suite["passed"], "N03_FOCUSED_TEST_EVIDENCE_SUITE_PASSED_INVALID");
    return suite["logicalTestId"];
  });
  if (new Set(logicalIds).size !== logicalTestIds.size
    || logicalIds.some((id) => typeof id !== "string" || ![...logicalTestIds.values()].includes(id))) {
    throw new Error("N03_FOCUSED_TEST_EVIDENCE_SUITE_ID_INVALID");
  }
  if (suitePassedTotal !== totals["passed"]) throw new Error("N03_FOCUSED_TEST_EVIDENCE_COUNT_MISMATCH");
  return report;
}

const inputHashes = Object.fromEntries([
  ["PACKAGE_MANIFEST", paths.packageManifest],
  ["N03_EVIDENCE_GENERATOR", paths.generator],
  ["N03_REAL_GATE", paths.realGate],
  ["VALIDATED_GOWM_ENVELOPE", paths.validatedEnvelope],
  ["SOURCE_NORMALIZER", paths.source],
  ["SOURCE_NORMALIZER_TEST", paths.sourceTest],
  ["GAP_NORMALIZER", paths.gap],
  ["GAP_NORMALIZER_TEST", paths.gapTest],
  ["RESULT_NORMALIZER", paths.result],
  ["RESULT_NORMALIZER_TEST", paths.resultTest],
  ["VALIDATION_BOUNDARY", paths.validation],
  ["DECODER_REGISTRY", paths.registry],
  ["PUBLIC_INDEX", paths.publicIndex],
  ["NORTHBOUND_TYPES", paths.types],
  ["SOURCE_PRODUCT_SCHEMA", paths.sourceSchema],
  ["TYPED_GAP_SCHEMA", paths.gapSchema],
  ["WORLD_FINDING_SCHEMA", paths.findingSchema],
  ["GEOSPATIAL_FINDINGS_SCHEMA", paths.profileSchema],
  ["GROUNDING_RESULT_EXTENSION_SCHEMA", paths.resultExtensionSchema]
].map(([logicalId, path]) => [logicalId, rawHash(path)]));
const inputSetHash = canonicalHash(inputHashes);
const schemaLocks = {
  sourceProduct: jsonHash(paths.sourceSchema),
  typedGap: jsonHash(paths.gapSchema),
  worldFinding: jsonHash(paths.findingSchema),
  geospatialFindings: jsonHash(paths.profileSchema),
  groundingResultExtension: jsonHash(paths.resultExtensionSchema)
};
const focusedExecutionPath = "reports/sacs-geospatial-v1/N03-focused-test-execution.json";
let focusedExecution: JsonObject;
if (writeMode) {
  focusedExecution = validateFocusedExecution(collectVitestResult(), inputSetHash);
  materialize(focusedExecutionPath, stableJson(focusedExecution));
} else {
  const absolute = resolve(repoRoot, focusedExecutionPath);
  if (!existsSync(absolute)) throw new Error("N03_FOCUSED_TEST_EVIDENCE_MISSING");
  focusedExecution = validateStoredFocusedExecution(JSON.parse(readFileSync(absolute, "utf8")), inputSetHash);
  materialize(focusedExecutionPath, stableJson(focusedExecution));
}
const focusedTotals = object(focusedExecution["totals"], "N03_FOCUSED_TEST_TOTALS_INVALID");
const testInventory = {
  focusedExecutedCases: integer(focusedTotals["passed"], "N03_FOCUSED_TEST_PASSED_INVALID"),
  focusedExpectedCases: integer(focusedTotals["expected"], "N03_FOCUSED_TEST_EXPECTED_INVALID"),
  focusedSuiteCount: focusedTestPaths.length,
  focusedExecutionEvidenceHash: sha256(stableJson(focusedExecution)),
  focusedExecutionClaimEmbedded: true
};

const common = {
  phase: "N03",
  version: "0.2.1",
  profile: "sacs-wsgs-geospatial-findings/1.0",
  transportMode: "RESULT_EXTENSION",
  inputSetHash,
  inputHashes,
  schemaLocks,
  testInventory,
  canonicalization: "UTF8_CRLF_CR_NORMALIZED_TO_LF_SHA256",
  credentialsIncluded: false,
  localPathsIncluded: false,
  requestIdentifiersIncluded: false,
  internalTopologyIncluded: false
};

const provenance = {
  schemaVersion: "wsgs-v021-n03-provenance-integrity/1.0",
  ...common,
  status: "PASS",
  qualificationModel: {
    qualified: "QUALIFIED",
    rejected: ["EVIDENCE_INCOMPLETE", "UNSUPPORTED_FINDING_SCHEMA", "SOURCE_CHANGED"],
    rejectedFacts: { sourceProducts: 0, findings: 0, evidenceItems: 0 }
  },
  invariants: [
    "AUTHENTICATED_SCOPE_CONTEXT_IS_OPAQUE_AND_WEAKMAP_BOUND",
    "AUTHORIZATION_CONTEXT_HASH_IS_RECOMPUTED",
    "GDPS_PRODUCT_AND_DESCRIPTOR_HASHES_ARE_UPSTREAM_BOUND",
    "PRODUCT_OR_CATALOG_SNAPSHOT_IS_EXACTLY_BOUND",
    "LOCAL_EVIDENCE_IS_DERIVED_FROM_VALIDATED_SNAPSHOT_COMPUTE_AND_RECEIPT",
    "REQUEST_ID_DOES_NOT_AFFECT_SEMANTIC_SOURCE_OR_EVIDENCE_IDENTITY",
    "RESULT_LOCAL_SOURCE_AND_EVIDENCE_SETS_ARE_CANONICAL",
    "EVERY_PUBLIC_FINDING_SOURCE_GAP_AND_EVIDENCE_FK_IS_CHECKED",
    "NO_RAW_ENVELOPE_RECEIPT_PROVIDER_URL_DATABASE_OR_ASSET_PATH_IS_PROJECTED"
  ],
  limits: { sourceProducts: 64, evidenceItems: 128, findings: 128, gaps: 128 },
  directProviderCalls: 0,
  directDatabaseCalls: 0,
  embeddedExecutionClaim: false
};

const gapNormalization = {
  schemaVersion: "wsgs-v021-n03-gap-normalization/1.0",
  ...common,
  status: "PASS",
  mappings: [
    { signal: "NO_DATA", gapKind: "DATA_GAP", status: "NO_DATA", severity: "INFO" },
    { signal: "COVERAGE_GAP", gapKind: "COVERAGE_GAP", status: "NO_DATA", severity: "WARNING" },
    { signal: "CAPABILITY_GAP", gapKind: "CAPABILITY_GAP", status: "INDETERMINATE", severity: "BLOCKING" },
    { signal: "PRODUCT_SELECTION_AMBIGUITY", gapKind: "PRODUCT_SELECTION_AMBIGUITY", status: "INDETERMINATE", severity: "BLOCKING" },
    { signal: "SOURCE_CHANGED", gapKind: "SOURCE_CHANGED", status: "INDETERMINATE", severity: "BLOCKING" },
    { signal: "UPSTREAM_FAILURE", gapKind: "UPSTREAM_FAILURE", status: "INDETERMINATE", severity: "BLOCKING" },
    { signal: "INDETERMINATE", gapKind: "UPSTREAM_FAILURE", status: "INDETERMINATE", severity: "BLOCKING" },
    { signal: "EVIDENCE_INCOMPLETE", gapKind: "EVIDENCE_INCOMPLETE", status: "INDETERMINATE", severity: "BLOCKING" },
    { signal: "UNSUPPORTED_FINDING_SCHEMA", gapKind: "UNSUPPORTED_FINDING_SCHEMA", status: "INDETERMINATE", severity: "BLOCKING" },
    { signal: "TRUNCATED", gapKind: "TRUNCATED", status: "PARTIAL", severity: "WARNING" }
  ],
  precedence: [
    "PLATFORM_TERMINAL_ERROR_OVER_PAYLOAD_CODE",
    "FAILED_OR_INDETERMINATE_NEVER_DOWNGRADED_TO_NO_DATA",
    "PARTIAL_EMPTY_COLLECTION_REMAINS_PARTIAL",
    "EMPTY_OR_NO_DATA_PLUS_TRUNCATED_FAILS_CLOSED"
  ],
  embeddedExecutionClaim: false
};

const scopeNegativeCases = [
  { caseId: "N03-NEG-FORGED-CONTEXT", expectedCode: "SOURCE_TRUSTED_CONTEXT_FORGED" },
  { caseId: "N03-NEG-AUTH-HASH", expectedCode: "SOURCE_AUTHORIZATION_CONTEXT_HASH_MISMATCH" },
  { caseId: "N03-NEG-SCOPE-NOT-AUTHORIZED", expectedCode: "SOURCE_TRUSTED_SCOPE_NOT_AUTHORIZED" },
  { caseId: "N03-NEG-MIXED-SCOPE", expectedCode: "SOURCE_DATA_SCOPE_MISMATCH" },
  { caseId: "N03-NEG-FOREIGN-SNAPSHOT", expectedCode: "SOURCE_PRODUCT_SNAPSHOT_BINDING_MISMATCH" },
  { caseId: "N03-NEG-FOREIGN-EVIDENCE", expectedCode: "SOURCE_EVIDENCE_PRODUCT_BINDING_MISMATCH" },
  { caseId: "N03-NEG-CLONED-BINDING", expectedCode: "SOURCE_PROVENANCE_BINDING_FORGED" },
  { caseId: "N03-NEG-SENSITIVE-PROJECTION", expectedCode: "SENSITIVE_RESULT_PROJECTION_FORBIDDEN" }
] as const;
const focusedTestSource = focusedTestPaths.map(raw).join("\n");
for (const testCase of scopeNegativeCases) {
  if (!focusedTestSource.includes(`"${testCase.expectedCode}"`)) {
    throw new Error(`N03_SCOPE_NEGATIVE_NOT_TESTED:${testCase.caseId}`);
  }
}

const scopeNegatives = {
  schemaVersion: "wsgs-v021-n03-scope-negative-cases/1.0",
  ...common,
  status: "PASS",
  cases: scopeNegativeCases,
  foreignFactsProjected: 0,
  requestBodyAuthorityAccepted: false,
  embeddedExecutionClaim: false
};

const detailArtifacts = [
  {
    logicalId: "PROVENANCE_INTEGRITY",
    outputPath: "reports/sacs-geospatial-v1/N03-provenance-integrity.json",
    text: stableJson(provenance)
  },
  {
    logicalId: "GAP_NORMALIZATION",
    outputPath: "reports/sacs-geospatial-v1/N03-gap-normalization.json",
    text: stableJson(gapNormalization)
  },
  {
    logicalId: "SCOPE_NEGATIVE_CASES",
    outputPath: "reports/sacs-geospatial-v1/N03-scope-negative-cases.json",
    text: stableJson(scopeNegatives)
  },
  {
    logicalId: "FOCUSED_TEST_EXECUTION",
    outputPath: focusedExecutionPath,
    text: stableJson(focusedExecution)
  }
] as const;
for (const artifact of detailArtifacts) materialize(artifact.outputPath, artifact.text);
const detailHashes = Object.fromEntries(detailArtifacts.map((artifact) => [artifact.logicalId, sha256(artifact.text)]));

const realAbsolute = resolve(reportRoot, "real-e2e.json");
let realEvidence: JsonObject | undefined;
let realEvidenceHash: Sha256Digest | undefined;

function requireSha256(value: unknown, code: string): void {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error(code);
}

function assertSafeRealEvidence(value: unknown, key = "ROOT"): void {
  if (value === null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    if (/https?:\/\//iu.test(value)
      || /(?:^|[\s"'])\p{L}:[\\/]/u.test(value)
      || /(?:^|[\s"'])(?:\\\\|\/)(?:Users|home|var|tmp|mnt)(?:[\\/]|$)/iu.test(value)) {
      throw new Error(`N03_REAL_UPSTREAM_LOCAL_OR_INTERNAL_PATH:${key}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeRealEvidence(item, `${key}[${index}]`));
    return;
  }
  const record = object(value, "N03_REAL_UPSTREAM_EVIDENCE_VALUE_INVALID");
  for (const [childKey, childValue] of Object.entries(record)) {
    if (/^(?:request|reference)(?:Id|Ids|Identifier|Identifiers)$/iu.test(childKey)
      || /^(?:authorization|token|privateKey|credential|providerUrl|databaseIdentifier|assetPath|localPath|endpoint)$/iu.test(childKey)) {
      throw new Error(`N03_REAL_UPSTREAM_FORBIDDEN_FIELD:${childKey}`);
    }
    assertSafeRealEvidence(childValue, childKey);
  }
}

function validateRealUpstreamEvidence(value: unknown): JsonObject {
  const report = object(value, "N03_REAL_UPSTREAM_EVIDENCE_INVALID");
  assertSafeRealEvidence(report);
  const qualifiedSourceSha = report["qualifiedSourceSha"];
  const operation = object(report["operation"], "N03_REAL_UPSTREAM_OPERATION_INVALID");
  const protocol = object(report["protocol"], "N03_REAL_UPSTREAM_PROTOCOL_INVALID");
  const counts = object(report["counts"], "N03_REAL_UPSTREAM_COUNTS_INVALID");
  const hashes = object(report["hashes"], "N03_REAL_UPSTREAM_HASHES_INVALID");
  if (report["schemaVersion"] !== "wsgs-v021-n03-real-upstream/1.0"
    || report["status"] !== "PASS"
    || report["evidenceClass"] !== "REAL_UPSTREAM"
    || report["inputSetHash"] !== inputSetHash
    || typeof qualifiedSourceSha !== "string"
    || !/^[0-9a-f]{40}$/u.test(qualifiedSourceSha)
    || report["gatewayOnly"] !== true
    || report["directProviderCalls"] !== 0
    || report["directDatabaseCalls"] !== 0
    || report["credentialsIncluded"] !== false
    || report["localPathsIncluded"] !== false
    || report["requestIdentifiersIncluded"] !== false
    || report["internalTopologyIncluded"] !== false
    || operation["operationId"] !== "geo-product.get"
    || operation["operationVersion"] !== "1.0"
    || ![200, 202].includes(protocol["submitHttpStatus"] as number)
    || protocol["terminalStatus"] !== "COMPLETED"
    || integer(counts["sourceProductCount"], "N03_REAL_UPSTREAM_SOURCE_COUNT_INVALID") < 1
    || integer(counts["findingCount"], "N03_REAL_UPSTREAM_FINDING_COUNT_INVALID") < 1
    || integer(counts["evidenceItemCount"], "N03_REAL_UPSTREAM_EVIDENCE_COUNT_INVALID") < 1
    || integer(counts["gapCount"], "N03_REAL_UPSTREAM_GAP_COUNT_INVALID") !== 0) {
    throw new Error("N03_REAL_UPSTREAM_EVIDENCE_INVALID");
  }
  for (const key of ["resultHash", "sourceProductSetHash", "evidenceItemSetHash", "findingSetHash", "assemblyHash"]) {
    requireSha256(hashes[key], `N03_REAL_UPSTREAM_HASH_INVALID:${key}`);
  }
  for (const key of ["runtimeIdentityHash", "contractCatalogRevision", "semanticCatalogHash", "bindingRevision"]) {
    requireSha256(report[key], `N03_REAL_UPSTREAM_LOCK_INVALID:${key}`);
  }
  return report;
}

if (existsSync(realAbsolute)) {
  realEvidence = validateRealUpstreamEvidence(JSON.parse(readFileSync(realAbsolute, "utf8")));
  realEvidenceHash = sha256(readFileSync(realAbsolute));
}
const runtimeQualified = realEvidence !== undefined;
const aggregate = {
  schemaVersion: "wsgs-v021-provenance-report/1.0",
  ...common,
  status: runtimeQualified ? "PASS" : "PARTIAL",
  marker: runtimeQualified ? "WSGS_V021_GEOSPATIAL_PROVENANCE_READY" : null,
  evidenceReports: detailHashes,
  evidenceSetHash: canonicalHash(detailHashes),
  unitQualification: "PASS",
  realUpstreamQualification: runtimeQualified ? "PASS" : "NOT_RUN",
  ...(realEvidenceHash === undefined ? {} : {
    realUpstreamEvidence: { logicalId: "REAL_SIGNED_GATEWAY_UPSTREAM", artifactSha256: realEvidenceHash }
  }),
  acceptance: { acceptanceId: "V21-G06", status: runtimeQualified ? "PASS" : "NOT_RUN" },
  productionQualified: false
};
const aggregatePath = "reports/sacs-geospatial-v1/provenance-report.json";
const aggregateText = stableJson(aggregate);
materialize(aggregatePath, aggregateText);

const phaseReport = `# N03 Phase Report — SourceProduct, TypedGap, and Provenance\n\nDecision: **${runtimeQualified ? "PASS" : "PARTIAL"} for N03 only**\n\nMarker: \`${runtimeQualified ? "WSGS_V021_GEOSPATIAL_PROVENANCE_READY" : "NOT_EMITTED"}\`\n\nG1: \`NOT_RUN\`\n\nv0.3 branch allowed: \`false\`\n\nproductionQualified: \`false\`\n\n## Scope\n\n- SourceProduct identity is derived from exact validated GDPS product/descriptor values and exact product-or-catalog snapshots.\n- Provenance admission is opaque, scope-bound, and fail-closed. Recoverable qualification failures produce zero facts and a blocking typed gap.\n- Grounding evidence uses the existing v0.1 wire item, retains safe snapshot/receipt references, and preserves actual GDPS output schema locks.\n- Finding, SourceProduct, EvidenceItem, and TypedGap foreign keys, identity collisions, ordering, limits, and set hashes are checked result-locally.\n- FAILED/INDETERMINATE cannot become NO_DATA; PARTIAL empty collections remain PARTIAL; empty plus truncated is contradictory.\n\n## Verification\n\n| Gate | Result |\n|---|---|\n| Focused source/gap/result/registry tests | PASS; ${testInventory.focusedExecutedCases}/${testInventory.focusedExpectedCases} across ${testInventory.focusedSuiteCount} suites |\n| Focused execution evidence bound to current input set | PASS; \`${testInventory.focusedExecutionEvidenceHash}\` |\n| Deterministic N03 materialization guard | PASS |\n| Real signed Gateway upstream gate | ${runtimeQualified ? "PASS" : "NOT_RUN"} |\n| Direct Provider / database calls | 0 / 0 |\n\nThe focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.\n\n## Evidence hashes\n\n| Logical artifact | SHA-256 |\n|---|---|\n${Object.entries(detailHashes).map(([logicalId, hash]) => `| \`${logicalId}\` | \`${hash}\` |`).join("\n")}\n| \`PROVENANCE_REPORT\` | \`${sha256(aggregateText)}\` |\n${realEvidenceHash === undefined ? "" : `| \`REAL_SIGNED_GATEWAY_UPSTREAM\` | \`${realEvidenceHash}\` |\n`}\nInput-set hash: \`${inputSetHash}\`.\n\n## Qualification boundary\n\n- V21-G06: ${runtimeQualified ? "PASS" : "NOT_RUN"}.\n- Runtime qualification: ${runtimeQualified ? "PASS for N03 real upstream only" : "NOT_RUN"}.\n- Real SACS v0.4 cases: 0/18.\n- Consumer compatible: false.\n- G1: NOT_RUN.\n\nNo shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.\n`;
materialize("reports/sacs-geospatial-v1/N03-phase-report.md", phaseReport);

process.stdout.write(
  `WSGS_V021_N03_EVIDENCE_${runtimeQualified ? "READY" : "SOURCE_READY"} `
  + `input=${inputSetHash} tests=${testInventory.focusedExecutedCases} real=${runtimeQualified ? "PASS" : "NOT_RUN"}\n`
);
