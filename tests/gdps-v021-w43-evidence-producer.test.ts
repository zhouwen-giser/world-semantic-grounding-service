import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { buildGdpsV021AcceptanceEvidenceMap } from
  "../validation/scripts/build-gdps-v021-acceptance-evidence-map.js";
import {
  GDPS_V021_W43_UNIT_TESTS,
  GdpsV021W43EvidenceError,
  produceGdpsV021W43Evidence,
} from "../validation/scripts/produce-gdps-v021-w43-evidence.js";

type JsonObject = Record<string, unknown>;

const sourceRoot = process.cwd();
const temporaryRoots: string[] = [];
const candidateSha = "a".repeat(40);
const unitReceiptPath = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/unit-receipt.json";
const unitRawPath = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/vitest.json";
const postgresReceiptPath = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/postgres.json";
const currentnessReceiptPath = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/currentness.json";
const barrierPath = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/barrier-attestation.json";
const armPath = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/source-changed-twice-arm.json";

const digest = (value: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const hashBytes = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  return `{${Object.entries(value as JsonObject).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function writeJson(root: string, path: string, value: unknown): Buffer {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, bytes);
  return bytes;
}

const binding = {
  candidateSha,
  gateRunId: "wsgs-gdps-v021-fixture-0001",
  runtimeIdentityHash: digest("runtime"),
  gowmGatewayIdentityHash: digest("gateway"),
  wsgsRuntimeIdentityHash: digest("wsgs"),
  databaseIdentityHash: digest("database"),
  handoffBundleHash: digest("handoff"),
  operationLockHash: digest("operation-lock"),
  providerRecipeLockHash: digest("recipe-lock"),
  providerId: "gdps.geospatial-products",
  providerVersion: "0.2.1",
  capabilityCount: 30,
  requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY",
  gatewayOnly: true,
  directProviderCalls: 0,
  mockTransportUsed: false,
  databaseClass: "REAL_ISOLATED_POSTGRESQL",
  sharedRuntimeMutated: false,
};

const scenarioTruth = {
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
} as const;
const barrierPlan = [
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
] as const;

function barrierDocument(): JsonObject {
  const a = digest("slope-A"); const b = digest("slope-B");
  const provider = digest("provider"); const manifest = digest("manifest");
  let previous: string | null = null;
  const transitions = barrierPlan.map(([, external, barrier, from, to], index) => {
    const content = (state: string) => state === "FINAL_B" ? b : a;
    const value: JsonObject = {
      sequence: index + 1, scenarioId: external, barrier, status: "PASS", expectedFrom: from,
      targetState: to, beforeState: from, afterState: to, beforeContentHash: content(from), afterContentHash: content(to),
      foundationSchemaFingerprintBefore: digest("fs"), foundationSchemaFingerprintAfter: digest("fs"),
      foundationDataFingerprintBefore: digest("fd"), foundationDataFingerprintAfter: digest("fd"),
      nonTargetFingerprintBefore: digest("nt"), nonTargetFingerprintAfter: digest("nt"),
      providerRuntimeIdentityHashBefore: provider, providerRuntimeIdentityHashAfter: provider,
      providerManifestHashBefore: manifest, providerManifestHashAfter: manifest, providerRuntimeInvariant: true,
      journalIntentHash: digest(`intent-${index}`), foundationInvariant: true, nonTargetInvariant: true,
      directProviderCalls: 0, credentialMaterialRecorded: false,
      recordedAt: `2026-08-29T14:00:${String(index).padStart(2, "0")}.000Z`, previousTransitionHash: previous,
    };
    const transitionHash = digest(canonicalJson(value)); previous = transitionHash;
    return { ...value, transitionHash };
  });
  return {
    schemaVersion: "gdps-v021-w43-barrier-attestation/1.0", status: "PASS", contractHash: digest("contract"),
    fixtureId: "GDPS_SLOPE_A_B_CURRENTNESS", scope: "scope-gdps-v021-baseline",
    productId: "gdps-baseline-slope", candidateSha, gateRunIdHash: digest(canonicalJson({ gateRunId: binding.gateRunId })),
    runtimeIdentityHash: digest(canonicalJson({ runtimeIdentity: binding.runtimeIdentityHash })),
    providerRuntimeIdentityHash: provider, providerManifestHash: manifest, journalBindingHash: digest("journal"),
    qualificationScope: "FIXTURE_TRANSITIONS_ONLY", w43RuntimeQualificationStatus: "NOT_RUN",
    runtimeEvidenceIncluded: false, transitionCount: 14, transitions, currentState: "FINAL_B",
    finalFixtureState: "FINAL_B", directProviderCalls: 0, credentialMaterialRecorded: false,
  };
}

function armDocument(): JsonObject {
  return {
    schemaVersion: "wsgs-gdps-v021-w43-barrier-arm/1.0",
    candidateSha,
    gateRunId: binding.gateRunId,
    runtimeIdentityHash: binding.runtimeIdentityHash,
    scenarioId: "W43-SOURCE-CHANGED-TWICE-INDETERMINATE",
    barrier: "AFTER_FIRST_SOURCE_CHANGED:B_TO_A",
    challengeHash: digest("challenge"), controllerIdHash: digest("controller"),
    sidecarContractHash: digest("sidecar"),
  };
}

function scenario(scenarioId: keyof typeof scenarioTruth): JsonObject {
  const expected = scenarioTruth[scenarioId];
  const priorContentHash = digest("slope-A");
  const currentContentHash = expected.currentness === "NOT_AVAILABLE" ? null :
    expected.currentness === "CURRENT" ? priorContentHash : digest("slope-B");
  const external = barrierPlan.find(([internal]) => internal === scenarioId)![1];
  const barrierTransitionHashes = (barrierDocument()["transitions"] as JsonObject[])
    .filter((entry) => entry["scenarioId"] === external).map((entry) => entry["transitionHash"]);
  const replayBarrierIndex = ({ CURRENT_STRICT: 0, CHANGED_STRICT: 1, NOT_AVAILABLE_STRICT: 1,
    CHANGED_BEST_EFFORT: 1, SOURCE_CHANGED_ONCE: 1, SOURCE_CHANGED_TWICE: 1 } as const)[scenarioId];
  const armBytes = Buffer.from(`${JSON.stringify(armDocument(), null, 2)}\n`, "utf8");
  return {
    scenarioId,
    replayMode: expected.replayMode,
    groundingStatus: expected.groundingStatus,
    terminalStatus: expected.terminalStatus,
    normalizedStatus: expected.normalizedStatus,
    currentness: expected.currentness,
    semanticCode: expected.semanticCode,
    warnings: expected.warnings,
    priorContentHash,
    currentContentHash,
    sourceOperationKey: "geo-raster.sample@1.0",
    executedOperationKeys: expected.newExecutions > 0
      ? ["geo-product.check-current@1.0", "geo-raster.sample@1.0"]
      : ["geo-product.check-current@1.0"],
    checkCurrentExecutionCount: 1,
    originalSourceExecutionCount: 0,
    newCurrentSourceExecutionCount: expected.newExecutions,
    sourceChangedDuringQueryCount: expected.sourceChanges,
    retryCount: expected.retries,
    historicalPayloadRead: false,
    productVersionPresent: false,
    priorGroundingLoaded: true,
    currentnessEvidencePersisted: true,
    authorityTupleHash: digest("authority-tuple"),
    currentnessDecisionHash: digest(`decision:${scenarioId}`),
    sourceGroundingIdHash: digest(`source:${scenarioId}`),
    replayGroundingIdHash: digest(`replay:${scenarioId}`),
    persistedResultHash: digest(`result:${scenarioId}`),
    sourceRequestEvidenceHash: digest(`source-request:${scenarioId}`),
    replayRequestEvidenceHash: digest(`replay-request:${scenarioId}`),
    sourcePlanHash: digest(`source-plan:${scenarioId}`),
    sourceBarrierTransitionHash: barrierTransitionHashes[0],
    replayBarrierTransitionHash: barrierTransitionHashes[replayBarrierIndex],
    replayBarrierArm: scenarioId === "SOURCE_CHANGED_TWICE" ? {
      path: armPath, hash: hashBytes(armBytes), byteLength: armBytes.byteLength,
    } : null,
    barrierTransitionHashes,
    causalBindingHash: digest(`causal:${scenarioId}`),
  };
}

interface Fixture {
  readonly root: string;
  readonly scenarios: JsonObject[];
  readonly currentness: JsonObject;
  readonly postgres: JsonObject;
  readonly unit: JsonObject;
  readonly raw: JsonObject;
}

function fileForTest(name: string): string {
  if (name.startsWith("production stage module")) {
    return "services/grounding-worker/src/production-module.test.ts";
  }
  if (name.startsWith("GDPS v0.2.1")) {
    return "packages/gowm-execution-evidence/src/gdps-v021-e2e-policy.test.ts";
  }
  return "packages/gowm-execution-evidence/src/gdps.test.ts";
}

function fixture(): Fixture {
  const root = mkdtempSync(resolve(tmpdir(), "wsgs-w43-producer-"));
  temporaryRoots.push(root);
  const matrixPath = "acceptance/gdps-v0.2.1/acceptance-matrix.csv";
  mkdirSync(dirname(resolve(root, matrixPath)), { recursive: true });
  cpSync(resolve(sourceRoot, matrixPath), resolve(root, matrixPath));
  cpSync(resolve(sourceRoot, "contracts/wsgs-v0.2-gdps/report-contracts"),
    resolve(root, "contracts/wsgs-v0.2-gdps/report-contracts"), { recursive: true });
  const scenarios = Object.keys(scenarioTruth).map((id) => scenario(id as keyof typeof scenarioTruth));
  const barrierBytes = writeJson(root, barrierPath, barrierDocument());
  writeJson(root, armPath, armDocument());
  const barrierReference = { path: barrierPath, hash: hashBytes(barrierBytes), byteLength: barrierBytes.byteLength };
  const currentness: JsonObject = {
    schemaVersion: "wsgs-gdps-v021-currentness-runner-receipt/1.0",
    generatedAt: "2026-08-29T14:00:00.000Z",
    binding,
    authorityTupleHash: digest("authority-tuple"),
    barrierAttestation: barrierReference,
    scenarios,
  };
  writeJson(root, currentnessReceiptPath, currentness);
  const observations = scenarios.map((entry) => ({
    scenarioId: entry["scenarioId"],
    groundingStatus: entry["groundingStatus"],
    sourceGroundingIdHash: entry["sourceGroundingIdHash"],
    replayGroundingIdHash: entry["replayGroundingIdHash"],
    persistedResultHash: entry["persistedResultHash"],
    currentnessDecisionHash: entry["currentnessDecisionHash"],
    transactionMode: "READ_ONLY",
    sourceGroundingRows: 1,
    replayGroundingRows: 1,
    resultRows: 1,
    stageRows: 9,
    executionRows: 2 + Number(entry["newCurrentSourceExecutionCount"]),
    currentnessEvidenceRows: 1,
    selectedProductRows: 1,
    priorGroundingLinkRows: 1,
    checkCurrentExecutionRows: 1,
    originalSourceExecutionRows: entry["originalSourceExecutionCount"],
    newCurrentSourceExecutionRows: entry["newCurrentSourceExecutionCount"],
    sourceChangedDuringQueryRows: entry["sourceChangedDuringQueryCount"],
    sourceRequestEvidenceHash: entry["sourceRequestEvidenceHash"],
    replayRequestEvidenceHash: entry["replayRequestEvidenceHash"],
    sourcePlanHash: entry["sourcePlanHash"],
    sourceBarrierTransitionHash: entry["sourceBarrierTransitionHash"],
    replayBarrierTransitionHash: entry["replayBarrierTransitionHash"],
    replayBarrierArm: entry["replayBarrierArm"],
    barrierTransitionHashes: entry["barrierTransitionHashes"],
    causalBindingHash: entry["causalBindingHash"],
  }));
  const postgres: JsonObject = {
    schemaVersion: "wsgs-gdps-v021-real-postgres-currentness-receipt/1.0",
    generatedAt: "2026-08-29T14:01:00.000Z",
    binding,
    authorityTupleHash: digest("authority-tuple"),
    barrierAttestation: barrierReference,
    database: {
      engine: "PostgreSQL",
      serverVersion: "17.10",
      executionClass: "REAL_ISOLATED_POSTGRESQL",
      mockUsed: false,
      connectionIdentityHash: binding.databaseIdentityHash,
      migrationReceiptHash: digest("migration"),
      queryTranscriptHash: digest("queries"),
    },
    negativeAssertions: {
      foreignScope: { status: "DENIED", matchingRows: 0 },
      foreignPrincipal: { status: "DENIED", matchingRows: 0 },
      priorResultHashMismatch: { status: "DENIED", matchingRows: 0 },
    },
    observations,
  };
  writeJson(root, postgresReceiptPath, postgres);
  const testNames = [...new Set(Object.values(GDPS_V021_W43_UNIT_TESTS).flat())];
  const files = [
    "packages/gowm-execution-evidence/src/gdps.test.ts",
    "packages/gowm-execution-evidence/src/gdps-v021-e2e-policy.test.ts",
    "services/grounding-worker/src/production-module.test.ts",
  ];
  const raw: JsonObject = {
    schemaVersion: "wsgs-gdps-v021-w43-canonical-vitest-report/1.0",
    runner: "vitest",
    runnerVersion: "4.1.11",
    selectedTestCount: testNames.length,
    testResults: files.map((file) => ({
      filePath: file,
      assertions: testNames.filter((name) => fileForTest(name) === file).map((fullName) => ({
        fullName,
        status: "passed",
      })),
    })),
  };
  const rawBytes = writeJson(root, unitRawPath, raw);
  const unit: JsonObject = {
    schemaVersion: "wsgs-gdps-v021-w43-unit-receipt/1.0",
    generatedAt: "2026-08-29T14:02:00.000Z",
    binding,
    runner: "vitest",
    runnerVersion: "4.1.11",
    testFiles: files,
    exitCode: 0,
    rawReport: { path: unitRawPath, hash: hashBytes(rawBytes), byteLength: rawBytes.byteLength },
  };
  writeJson(root, unitReceiptPath, unit);
  return { root, scenarios, currentness, postgres, unit, raw };
}

function produce(value: Fixture) {
  return produceGdpsV021W43Evidence({
    repositoryRoot: value.root,
    candidateSha,
    unitReceiptPath,
    postgresReceiptPath,
    currentnessReceiptPath,
  });
}

function expectCode(callback: () => unknown, code: string): void {
  try {
    callback();
    throw new Error("expected producer to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(GdpsV021W43EvidenceError);
    expect((error as GdpsV021W43EvidenceError).code).toBe(code);
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("GDPS v0.2.1 W43 real evidence producer", () => {
  it("derives 54 unique byte-bound artifacts and a builder-ready phase manifest entry", () => {
    const value = fixture();
    const result = produce(value);
    expect(result.artifactCount).toBe(54);
    expect(result.assertionCount).toBe(54);
    expect(result.files.size).toBe(56);
    const evidence = [...result.files.entries()].filter(([path]) => path.includes("/w43-evidence/"));
    expect(evidence).toHaveLength(54);
    expect(new Set(evidence.map(([, bytes]) => hashBytes(bytes))).size).toBe(54);
    expect(result.manifestEntry).toMatchObject({
      reportId: "w43-currentness-real-evidence",
      phase: "W43",
      reportStatus: "PASS",
      candidateSha,
    });
    expect((result.manifestEntry["assertions"] as unknown[])).toHaveLength(54);
    const sample = JSON.parse(result.files.get(
      "reports/wsgs-v0.2-gdps-v0.2.1/w43-evidence/w43-014.real_postgres.json",
    )!.toString("utf8")) as JsonObject;
    expect(sample).toMatchObject({
      acceptanceId: "W43-014",
      evidenceType: "REAL_POSTGRES",
      status: "PASS",
      facts: { gateRunId: binding.gateRunId, runtimeIdentityHash: binding.runtimeIdentityHash },
    });
  });

  it("is accepted as 18 exact W43 PASS rows by the independent 327-row evidence builder", () => {
    const value = fixture();
    const result = produce(value);
    for (const [path, bytes] of result.files) {
      const absolute = resolve(value.root, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, bytes);
    }
    const policyPath = "config/gdps-v021-acceptance-policy.json";
    mkdirSync(dirname(resolve(value.root, policyPath)), { recursive: true });
    cpSync(resolve(sourceRoot, policyPath), resolve(value.root, policyPath));
    const matrixPath = "acceptance/gdps-v0.2.1/acceptance-matrix.csv";
    const matrixBytes = readFileSync(resolve(value.root, matrixPath));
    const policyBytes = readFileSync(resolve(value.root, policyPath));
    const manifestPath = "reports/wsgs-v0.2-gdps-v0.2.1/evidence-report-manifest.json";
    writeJson(value.root, manifestPath, {
      schemaVersion: "wsgs-gdps-v021-evidence-report-manifest/1.0",
      candidate: { repository: "world-semantic-grounding-service", gitHead: candidateSha },
      target: {
        release: "GDPS v0.2.1",
        providerId: "gdps.geospatial-products",
        providerVersion: "0.2.1",
        capabilityCount: 30,
        productTypeCount: 34,
        descriptorProfileCount: 35,
      },
      matrix: { artifactPath: matrixPath, artifactHash: hashBytes(matrixBytes) },
      policy: { artifactPath: policyPath, artifactHash: hashBytes(policyBytes) },
      sourceReports: [],
      phaseReports: [result.manifestEntry],
      runtimeReports: [],
      w44Report: null,
    });
    const built = buildGdpsV021AcceptanceEvidenceMap({
      repositoryRoot: value.root,
      manifestPath,
      expectedCandidateSha: candidateSha,
    });
    const document = built.document as { entries: Array<{ acceptanceId: string; status: string }> };
    const w43 = document.entries.filter((entry) => entry.acceptanceId.startsWith("W43-"));
    expect(w43).toHaveLength(18);
    expect(w43.every((entry) => entry.status === "PASS")).toBe(true);
  });

  it("rejects a missing exact independent unit test even when the raw report says success", () => {
    const value = fixture();
    const files = value.raw["testResults"] as JsonObject[];
    const targetFile = files.find((entry) => String(entry["filePath"]).endsWith("production-module.test.ts"))!;
    targetFile["assertions"] = (targetFile["assertions"] as JsonObject[]).filter((entry) =>
      entry["fullName"] !== "production stage module authority boundaries never carries historical payload or unknown persisted parameters into the current-source query");
    value.raw["selectedTestCount"] = Number(value.raw["selectedTestCount"]) - 1;
    const rawBytes = writeJson(value.root, unitRawPath, value.raw);
    (value.unit["rawReport"] as JsonObject)["hash"] = hashBytes(rawBytes);
    (value.unit["rawReport"] as JsonObject)["byteLength"] = rawBytes.byteLength;
    writeJson(value.root, unitReceiptPath, value.unit);
    expectCode(() => produce(value), "W43_REQUIRED_UNIT_TEST_NOT_PASSED");
  });

  it("rejects absolute Vitest paths so no workstation prefix can enter committed evidence", () => {
    const value = fixture();
    const files = value.raw["testResults"] as JsonObject[];
    files[0]!["filePath"] = resolve(value.root, String(files[0]!["filePath"]));
    const rawBytes = writeJson(value.root, unitRawPath, value.raw);
    (value.unit["rawReport"] as JsonObject)["hash"] = hashBytes(rawBytes);
    (value.unit["rawReport"] as JsonObject)["byteLength"] = rawBytes.byteLength;
    writeJson(value.root, unitReceiptPath, value.unit);
    expectCode(() => produce(value), "W43_UNIT_CANONICAL_FILE_PATH_INVALID");
  });

  it("rejects cross-run receipt composition", () => {
    const value = fixture();
    (value.postgres["binding"] as JsonObject)["gateRunId"] = "wsgs-gdps-v021-foreign-0002";
    writeJson(value.root, postgresReceiptPath, value.postgres);
    expectCode(() => produce(value), "W43_POSTGRES_RUNTIME_BINDING_MISMATCH");
  });

  it("recomputes scenario truth rather than trusting a receipt-level success claim", () => {
    const value = fixture();
    const changed = value.scenarios.find((entry) => entry["scenarioId"] === "CHANGED_STRICT")!;
    changed["originalSourceExecutionCount"] = 1;
    writeJson(value.root, currentnessReceiptPath, value.currentness);
    expectCode(() => produce(value), "W43_CURRENTNESS_SCENARIO_TRUTH_INVALID");
  });

  it("requires PostgreSQL facts to bind the exact canonical currentness decision", () => {
    const value = fixture();
    const observations = value.postgres["observations"] as JsonObject[];
    observations[0]!["currentnessDecisionHash"] = digest("wrong-decision");
    writeJson(value.root, postgresReceiptPath, value.postgres);
    expectCode(() => produce(value), "W43_POSTGRES_OBSERVATION_TRUTH_INVALID");
  });
});
