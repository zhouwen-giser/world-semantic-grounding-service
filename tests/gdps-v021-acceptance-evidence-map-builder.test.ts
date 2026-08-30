import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GDPS_V021_OPERATION_KEYS,
  GDPS_V021_QUALIFICATION_IDS,
  canonicalSha256,
  evaluateGdpsV021Report,
  gdpsV021DriverArtifactIds,
  parseGdpsV021Corpus,
  type GdpsV021Case,
  type GdpsV021CaseObservation,
  type GdpsV021DriverAttestation,
  type GdpsV021EvidenceArtifactKind,
  type GdpsV021EvidenceArtifactRecord,
  type GdpsV021EvidenceSubject,
  type GdpsV021OperationKey,
  type GdpsV021QualificationEvidence,
  type GdpsV021ReportInput,
  type GdpsV021Sha256Digest,
} from "../packages/gowm-execution-evidence/src/index.js";
import {
  GdpsV021EvidenceMapError,
  assertReportsOnlyCandidateDescendant,
  buildGdpsV021AcceptanceEvidenceMap,
  type EvidenceStatus,
} from "../validation/scripts/build-gdps-v021-acceptance-evidence-map.js";

type JsonObject = Record<string, unknown>;

interface Row {
  readonly id: string;
  readonly phase: string;
  readonly scenario: string;
  readonly expected: string;
  readonly evidenceTypes: readonly string[];
}

interface Fixture {
  readonly root: string;
  readonly candidateSha: string;
  readonly manifestPath: string;
  readonly manifest: JsonObject;
  readonly reports: JsonObject[];
  readonly rows: readonly Row[];
}

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoots: string[] = [];
const w43ReportSchemaVersion = "wsgs-gdps-v021-w43-phase-report/1.0";
const w43EvidenceLedgerSchemaVersion = "wsgs-gdps-v021-w43-evidence-ledger/1.0";
const w43AssertionEvidenceSchemaVersion = "wsgs-gdps-v021-w43-assertion-evidence/1.0";
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const target = {
  release: "GDPS v0.2.1",
  providerId: "gdps.geospatial-products",
  providerVersion: "0.2.1",
  capabilityCount: 30,
  productTypeCount: 34,
  descriptorProfileCount: 35,
};
const w43ScenarioIds = [
  "CURRENT_STRICT",
  "CHANGED_STRICT",
  "NOT_AVAILABLE_STRICT",
  "CHANGED_BEST_EFFORT",
  "SOURCE_CHANGED_ONCE",
  "SOURCE_CHANGED_TWICE",
] as const;
type W43ScenarioId = typeof w43ScenarioIds[number];
const w43ScenariosByAcceptanceId: Readonly<Record<string, readonly W43ScenarioId[]>> = {
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
};

function parseCsv(text: string): JsonObject[] {
  const lines = text.trim().split(/\r?\n/u);
  const header = lines.shift()!.split(",");
  return lines.map((line) => Object.fromEntries(
    line.split(",").map((value, index) => [header[index]!, value]),
  ));
}

function writeJson(path: string, value: unknown): Buffer {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return bytes;
}

function testSha256(bytes: Uint8Array | string): GdpsV021Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function artifact(root: string, repositoryPath: string, value: unknown): { path: string; hash: string } {
  const bytes = writeJson(resolve(root, repositoryPath), value);
  return { path: repositoryPath, hash: testSha256(bytes) };
}

interface EvidenceArtifactOptions {
  readonly id?: string;
  readonly repositoryPath?: string;
  readonly content?: unknown;
}

type AddEvidenceArtifact = (
  kind: GdpsV021EvidenceArtifactKind,
  subject: GdpsV021EvidenceSubject,
  options?: EvidenceArtifactOptions,
) => GdpsV021EvidenceArtifactRecord;

function w44Report(root: string, candidateSha: string): JsonObject {
  const corpus = parseGdpsV021Corpus(readFileSync(resolve(sourceRoot, "config", "gdps-e2e-corpus.json")));
  const operationLockHash = testSha256("fixture-operation-lock");
  const sourceIdentity: GdpsV021ReportInput["sourceIdentity"] = {
    wsgsCommit: candidateSha,
    gdpsCommit: "b".repeat(40),
    gowmIdentityHash: testSha256("fixture-gowm-identity"),
    runtimeIdentityHash: testSha256("fixture-runtime-identity"),
    handoffBundleHash: testSha256("fixture-handoff-bundle"),
    operationLockProvenanceHash: testSha256("fixture-operation-lock-provenance"),
    providerId: "gdps.geospatial-products",
    providerVersion: "0.2.1",
    capabilityCount: 30,
  };
  const execution: GdpsV021ReportInput["execution"] = {
    requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY",
    gatewayOnly: true,
    directProviderCalls: 0,
    mockTransportUsed: false,
  };
  const artifacts: GdpsV021EvidenceArtifactRecord[] = [];
  let sequence = 0;
  const addEvidenceArtifact: AddEvidenceArtifact = (kind, subject, options = {}) => {
    sequence += 1;
    const id = options.id ?? `artifact-${String(sequence).padStart(3, "0")}`;
    const repositoryPath = options.repositoryPath ??
      `reports/wsgs-v0.2-gdps-v0.2.1/evidence/${id}.json`;
    const absolutePath = resolve(root, repositoryPath);
    let bytes: Buffer;
    if (kind === "DRIVER_IMPLEMENTATION") {
      bytes = Buffer.from(String(options.content ?? `export const fixture = "${subject}";\n`), "utf8");
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, bytes);
    } else {
      bytes = writeJson(absolutePath, options.content ?? {
        schemaVersion: "wsgs-gdps-test-byte-evidence/1.0",
        id,
        kind,
        subject,
      });
    }
    const record: GdpsV021EvidenceArtifactRecord = {
      id,
      kind,
      subject,
      repoRelativePath: repositoryPath,
      hash: testSha256(bytes),
      byteLength: bytes.byteLength,
      byteVerified: true,
      sourceBinding: {
        wsgsCommit: sourceIdentity.wsgsCommit,
        gdpsCommit: sourceIdentity.gdpsCommit,
        gowmIdentityHash: sourceIdentity.gowmIdentityHash,
        handoffBundleHash: sourceIdentity.handoffBundleHash,
        operationLockProvenanceHash: sourceIdentity.operationLockProvenanceHash,
      },
      runtimeBinding: {
        runtimeIdentityHash: sourceIdentity.runtimeIdentityHash,
        requiredExecutionPath: execution.requiredExecutionPath,
        providerId: sourceIdentity.providerId,
        providerVersion: sourceIdentity.providerVersion,
        capabilityCount: sourceIdentity.capabilityCount,
        gatewayOnly: true,
        directProviderCalls: 0,
        mockTransportUsed: false,
      },
      operationLockHash,
    };
    artifacts.push(record);
    return record;
  };
  const driver = (expected: GdpsV021Case): GdpsV021DriverAttestation | null => {
    if (expected.requiredDriverKind === null) return null;
    const caseId = expected.id as GdpsV021DriverAttestation["caseId"];
    const ids = gdpsV021DriverArtifactIds(caseId);
    const implementation = addEvidenceArtifact("DRIVER_IMPLEMENTATION", expected.id, {
      id: ids.implementation,
      repositoryPath: `validation/drivers/${expected.id.toLowerCase()}.ts`,
    });
    const evidence = addEvidenceArtifact("DRIVER_EVIDENCE", expected.id, {
      id: ids.evidence,
    });
    const precondition = {
      caseId,
      driverKind: expected.requiredDriverKind,
      observationHash: testSha256(`precondition:${expected.id}`),
    };
    const attestation: GdpsV021DriverAttestation = {
      schemaVersion: "wsgs-gdps-e2e-driver-attestation/2.0",
      caseId,
      driverKind: expected.requiredDriverKind,
      sourceCommit: sourceIdentity.wsgsCommit,
      handoffBundleHash: sourceIdentity.handoffBundleHash,
      operationLockHash,
      provenanceHash: sourceIdentity.operationLockProvenanceHash,
      runtimeIdentityHash: sourceIdentity.runtimeIdentityHash,
      sharedRuntimeBeforeHash: testSha256("fixture-shared-runtime"),
      sharedRuntimeAfterHash: testSha256("fixture-shared-runtime"),
      executionEnvironment: "ISOLATED_REAL_RUNTIME",
      requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY",
      realExternalDependencies: true,
      mockTransportUsed: false,
      sharedRuntimeMutated: false,
      precondition,
      preconditionHash: canonicalSha256(precondition) as GdpsV021Sha256Digest,
      driverImplementationHash: implementation.hash,
      evidenceHash: evidence.hash,
    };
    addEvidenceArtifact("DRIVER_ATTESTATION", expected.id, {
      id: ids.attestation,
      content: attestation,
    });
    return attestation;
  };
  const observations: GdpsV021CaseObservation[] = corpus.cases.map((expected) => {
    const needsProduct = expected.productExpectation !== "ABSENT";
    const productId = expected.expectedExplicitProductId ??
      `gdps-${expected.id.toLowerCase().replaceAll("_", "-")}`;
    const caseEvidence = addEvidenceArtifact("CASE_EVIDENCE", expected.id);
    return {
      caseId: expected.id,
      terminalStatus: expected.expectedTerminalStatus,
      normalizedStatus: expected.expectedNormalizedStatus,
      sourceCondition: expected.expectedSourceCondition,
      semanticPattern: expected.expectedSemanticPattern,
      descriptorId: expected.expectedDescriptorId,
      operationKeys: [...expected.expectedOperationKeys],
      gdpsOperationKeys: expected.expectedOperationKeys.filter((key) =>
        (GDPS_V021_OPERATION_KEYS as readonly string[]).includes(key)),
      semanticCode: expected.expectedSemanticCode,
      recipeId: expected.requiresRecipeEvidence ? `recipe-${expected.id.toLowerCase()}` : null,
      recipeLockHash: expected.requiresRecipeEvidence ? testSha256(`recipe:${expected.id}`) : null,
      descriptorHash: expected.expectedDescriptorId === null
        ? null
        : testSha256(`descriptor:${expected.id}`),
      planHash: expected.requiresPlanEvidence ? testSha256(`plan:${expected.id}`) : null,
      operationLockHash: expected.requiresOperationLockEvidence ? operationLockHash : null,
      productEvidence: needsProduct && expected.expectedProductBinding !== null ? (() => {
        const contentHash = testSha256(`product:${expected.id}`);
        const dataSnapshot = {
          snapshotId: `data-${expected.id.toLowerCase()}`,
          hash: testSha256(`data:${expected.id}`),
        };
        const computeSnapshot = {
          snapshotId: `compute-${expected.id.toLowerCase()}`,
          hash: testSha256(`compute:${expected.id}`),
        };
        const quality = { completeness: 1, confidence: 1 };
        return {
          productId,
          contentHash,
          currentContentHash: expected.productExpectation === "CURRENTNESS_CHANGE"
            ? testSha256(`current:${expected.id}`)
            : contentHash,
          descriptorId: expected.expectedProductBinding.descriptorId,
          descriptorHash: testSha256(`descriptor:${expected.id}`),
          productType: expected.expectedProductBinding.productType,
          productProfile: expected.expectedProductBinding.productProfile,
          queryProfile: expected.expectedProductBinding.queryProfile,
          sourceOperationKey: expected.expectedOperationKeys.find((key) =>
            (GDPS_V021_OPERATION_KEYS as readonly string[]).includes(key)) as GdpsV021OperationKey,
          dataSnapshot,
          dataSnapshotHash: canonicalSha256(dataSnapshot) as GdpsV021Sha256Digest,
          computeSnapshot,
          computeSnapshotHash: canonicalSha256(computeSnapshot) as GdpsV021Sha256Digest,
          receiptIds: [`receipt-${expected.id.toLowerCase()}`],
          evidenceIds: [`evidence-${expected.id.toLowerCase()}`],
          quality,
          qualityHash: canonicalSha256(quality) as GdpsV021Sha256Digest,
          truncated: expected.caseType === "TRUNCATED",
        };
      })() : null,
      currentness: expected.caseType === "CURRENTNESS"
        ? "CHANGED"
        : expected.caseType === "DATA_GAP"
          ? "NOT_AVAILABLE"
          : needsProduct ? "CURRENT" : null,
      truncated: expected.caseType === "TRUNCATED",
      falseFactInferred: false,
      originalQueryExecuted: false,
      evidenceArtifactIds: [caseEvidence.id],
      evidenceHashes: [caseEvidence.hash],
      driverAttestation: driver(expected),
    };
  });
  const qualifications: GdpsV021QualificationEvidence[] = GDPS_V021_QUALIFICATION_IDS.map(
    (qualificationId) => {
      const evidence = addEvidenceArtifact("QUALIFICATION_EVIDENCE", qualificationId);
      return {
        qualificationId,
        status: "PASS",
        evidenceArtifactIds: [evidence.id],
        evidenceHashes: [evidence.hash],
        detail: `Real fixture evidence for ${qualificationId}`,
      };
    },
  );
  return structuredClone(evaluateGdpsV021Report(corpus, {
    generatedAt: "2026-08-29T13:00:00.000Z",
    sourceIdentity,
    execution,
    evidenceLedger: {
      schemaVersion: "wsgs-gdps-byte-evidence-ledger/1.0",
      operationLockHash,
      artifacts,
    },
    observations,
    qualifications,
  })) as unknown as JsonObject;
}

function w43Report(root: string, candidateSha: string, rows: readonly Row[]): JsonObject {
  const runtimeIdentityHash = testSha256("w43-runtime");
  const databaseIdentityHash = testSha256("w43-database");
  const gateRunId = "wsgs-gdps-v021-fixture-0001";
  const binding = {
    candidateSha,
    gateRunId,
    runtimeIdentityHash,
    gowmGatewayIdentityHash: testSha256("w43-gowm"),
    wsgsRuntimeIdentityHash: testSha256("w43-wsgs"),
    databaseIdentityHash,
    handoffBundleHash: testSha256("w43-handoff"),
    operationLockHash: testSha256("w43-operation-lock"),
    providerRecipeLockHash: testSha256("w43-recipe-lock"),
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
  const externalIds: Readonly<Record<W43ScenarioId, string>> = {
    CURRENT_STRICT: "W43-STRICT-CURRENT",
    CHANGED_STRICT: "W43-STRICT-CHANGED",
    NOT_AVAILABLE_STRICT: "W43-STRICT-NOT-AVAILABLE",
    CHANGED_BEST_EFFORT: "W43-BEST-EFFORT-CHANGED",
    SOURCE_CHANGED_ONCE: "W43-SOURCE-CHANGED-ONCE-THEN-SUCCESS",
    SOURCE_CHANGED_TWICE: "W43-SOURCE-CHANGED-TWICE-INDETERMINATE",
  };
  const barrierPlan = [
    ["CURRENT_STRICT", "PREPARE_A", "INITIAL_A", "INITIAL_A"],
    ["CHANGED_STRICT", "PREPARE_A", "INITIAL_A", "INITIAL_A"],
    ["CHANGED_STRICT", "AFTER_PRIOR_GROUNDING:A_TO_B", "INITIAL_A", "FINAL_B"],
    ["NOT_AVAILABLE_STRICT", "PREPARE_A", "FINAL_B", "INITIAL_A"],
    ["NOT_AVAILABLE_STRICT", "AFTER_PRIOR_GROUNDING:DISABLE_CURRENT_PRODUCT", "INITIAL_A", "NOT_AVAILABLE"],
    ["NOT_AVAILABLE_STRICT", "AFTER_SCENARIO:RESTORE_A", "NOT_AVAILABLE", "INITIAL_A"],
    ["CHANGED_BEST_EFFORT", "PREPARE_A", "INITIAL_A", "INITIAL_A"],
    ["CHANGED_BEST_EFFORT", "AFTER_PRIOR_GROUNDING:A_TO_B", "INITIAL_A", "FINAL_B"],
    ["SOURCE_CHANGED_ONCE", "PREPARE_A", "FINAL_B", "INITIAL_A"],
    ["SOURCE_CHANGED_ONCE", "BEFORE_REPLAY_QUERY:A_TO_B", "INITIAL_A", "FINAL_B"],
    ["SOURCE_CHANGED_TWICE", "PREPARE_A", "FINAL_B", "INITIAL_A"],
    ["SOURCE_CHANGED_TWICE", "BEFORE_REPLAY_QUERY:A_TO_B", "INITIAL_A", "FINAL_B"],
    ["SOURCE_CHANGED_TWICE", "AFTER_FIRST_SOURCE_CHANGED:B_TO_A", "FINAL_B", "INITIAL_A"],
    ["SOURCE_CHANGED_TWICE", "FINALIZE_B", "INITIAL_A", "FINAL_B"],
  ] as const;
  const initialContentHash = testSha256("w43-slope-a");
  const finalContentHash = testSha256("w43-slope-b");
  const providerRuntimeIdentityHash = testSha256("w43-provider-runtime");
  const providerManifestHash = testSha256("w43-provider-manifest");
  const authorityTupleHash = testSha256("w43-authority-tuple");
  let previousTransitionHash: string | null = null;
  const transitions = barrierPlan.map(([scenarioId, barrier, expectedFrom, targetState], index) => {
    const stateHash = (state: string) => state === "FINAL_B" ? finalContentHash : initialContentHash;
    const preimage = {
      sequence: index + 1,
      scenarioId: externalIds[scenarioId],
      barrier,
      status: "PASS",
      expectedFrom,
      targetState,
      beforeState: expectedFrom,
      afterState: targetState,
      beforeContentHash: stateHash(expectedFrom),
      afterContentHash: stateHash(targetState),
      foundationSchemaFingerprintBefore: testSha256("w43-foundation-schema"),
      foundationSchemaFingerprintAfter: testSha256("w43-foundation-schema"),
      foundationDataFingerprintBefore: testSha256("w43-foundation-data"),
      foundationDataFingerprintAfter: testSha256("w43-foundation-data"),
      nonTargetFingerprintBefore: testSha256("w43-non-target"),
      nonTargetFingerprintAfter: testSha256("w43-non-target"),
      providerRuntimeIdentityHashBefore: providerRuntimeIdentityHash,
      providerRuntimeIdentityHashAfter: providerRuntimeIdentityHash,
      providerManifestHashBefore: providerManifestHash,
      providerManifestHashAfter: providerManifestHash,
      previousTransitionHash,
      providerRuntimeInvariant: true,
      journalIntentHash: testSha256(`w43-journal-intent-${index}`),
      foundationInvariant: true,
      nonTargetInvariant: true,
      directProviderCalls: 0,
      credentialMaterialRecorded: false,
      recordedAt: `2026-08-29T13:00:${String(index).padStart(2, "0")}.000Z`,
    };
    const transitionHash = canonicalSha256(preimage);
    previousTransitionHash = transitionHash;
    return { ...preimage, transitionHash };
  });
  const barrierPath = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/barrier-attestation.json";
  const barrierWritten = artifact(root, barrierPath, {
    schemaVersion: "gdps-v021-w43-barrier-attestation/1.0",
    status: "PASS",
    contractHash: testSha256("w43-contract"),
    fixtureId: "GDPS_SLOPE_A_B_CURRENTNESS",
    scope: "scope-gdps-v021-baseline",
    productId: "gdps-baseline-slope",
    candidateSha,
    gateRunIdHash: canonicalSha256({ gateRunId }),
    runtimeIdentityHash: canonicalSha256({ runtimeIdentity: runtimeIdentityHash }),
    providerRuntimeIdentityHash,
    providerManifestHash,
    journalBindingHash: testSha256("w43-journal-binding"),
    qualificationScope: "FIXTURE_TRANSITIONS_ONLY",
    w43RuntimeQualificationStatus: "NOT_RUN",
    runtimeEvidenceIncluded: false,
    directProviderCalls: 0,
    credentialMaterialRecorded: false,
    transitionCount: transitions.length,
    transitions,
    currentState: "FINAL_B",
    finalFixtureState: "FINAL_B",
  });
  const barrierReference = {
    path: barrierPath,
    hash: barrierWritten.hash,
    byteLength: readFileSync(resolve(root, barrierPath)).byteLength,
  };
  const armPath = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/source-changed-twice-arm.json";
  const armWritten = artifact(root, armPath, {
    schemaVersion: "wsgs-gdps-v021-w43-barrier-arm/1.0",
    candidateSha,
    gateRunId,
    runtimeIdentityHash,
    scenarioId: "W43-SOURCE-CHANGED-TWICE-INDETERMINATE",
    barrier: "AFTER_FIRST_SOURCE_CHANGED:B_TO_A",
    challengeHash: testSha256("w43-arm-challenge"),
    controllerIdHash: testSha256("w43-arm-controller"),
    sidecarContractHash: testSha256("w43-arm-sidecar"),
  });
  const armReference = {
    path: armPath,
    hash: armWritten.hash,
    byteLength: readFileSync(resolve(root, armPath)).byteLength,
  };
  const transitionHashesByScenario = new Map<W43ScenarioId, string[]>(w43ScenarioIds.map((scenarioId) => [
    scenarioId,
    transitions.filter((entry) => entry.scenarioId === externalIds[scenarioId])
      .map((entry) => entry.transitionHash),
  ]));
  const scenarioTruth: Readonly<Record<W43ScenarioId, JsonObject>> = {
    CURRENT_STRICT: {
      replayMode: "STRICT", groundingStatus: "COMPLETED", terminalStatus: "COMPLETED",
      normalizedStatus: "CURRENT", currentness: "CURRENT", semanticCode: "OK",
      warnings: ["CURRENT_SOURCE_IDENTITY_CONFIRMED"], currentContentHash: testSha256("prior-CURRENT_STRICT"),
      newCurrentSourceExecutionCount: 0, sourceChangedDuringQueryCount: 0, retryCount: 0,
    },
    CHANGED_STRICT: {
      replayMode: "STRICT", groundingStatus: "UNRESOLVED", terminalStatus: "UNRESOLVED",
      normalizedStatus: "STALE", currentness: "CHANGED", semanticCode: "SNAPSHOT_MISMATCHED",
      warnings: ["SOURCE_CHANGED"], currentContentHash: testSha256("current-CHANGED_STRICT"),
      newCurrentSourceExecutionCount: 0, sourceChangedDuringQueryCount: 0, retryCount: 0,
    },
    NOT_AVAILABLE_STRICT: {
      replayMode: "STRICT", groundingStatus: "UNRESOLVED", terminalStatus: "UNRESOLVED",
      normalizedStatus: "DATA_GAP", currentness: "NOT_AVAILABLE", semanticCode: "DATA_GAP",
      warnings: ["SOURCE_NOT_AVAILABLE"], currentContentHash: null,
      newCurrentSourceExecutionCount: 0, sourceChangedDuringQueryCount: 0, retryCount: 0,
    },
    CHANGED_BEST_EFFORT: {
      replayMode: "BEST_EFFORT", groundingStatus: "COMPLETED", terminalStatus: "COMPLETED",
      normalizedStatus: "CURRENT", currentness: "CHANGED", semanticCode: "SOURCE_ADVANCED",
      warnings: ["SOURCE_ADVANCED"], currentContentHash: testSha256("current-CHANGED_BEST_EFFORT"),
      newCurrentSourceExecutionCount: 1, sourceChangedDuringQueryCount: 0, retryCount: 0,
    },
    SOURCE_CHANGED_ONCE: {
      replayMode: "BEST_EFFORT", groundingStatus: "COMPLETED", terminalStatus: "COMPLETED",
      normalizedStatus: "CURRENT", currentness: "CHANGED", semanticCode: "SOURCE_ADVANCED",
      warnings: ["CURRENT_SOURCE_QUERY_RETRIED", "SOURCE_ADVANCED", "SOURCE_CHANGED"],
      currentContentHash: testSha256("current-SOURCE_CHANGED_ONCE"), newCurrentSourceExecutionCount: 2,
      sourceChangedDuringQueryCount: 1, retryCount: 1,
    },
    SOURCE_CHANGED_TWICE: {
      replayMode: "BEST_EFFORT", groundingStatus: "UNRESOLVED", terminalStatus: "INDETERMINATE",
      normalizedStatus: "INDETERMINATE", currentness: "CHANGED", semanticCode: "SOURCE_CHANGED",
      warnings: ["CURRENT_SOURCE_QUERY_RETRIED", "INDETERMINATE", "SOURCE_ADVANCED", "SOURCE_CHANGED"],
      currentContentHash: testSha256("current-SOURCE_CHANGED_TWICE"), newCurrentSourceExecutionCount: 2,
      sourceChangedDuringQueryCount: 2, retryCount: 1,
    },
  };
  const scenarios = w43ScenarioIds.map((scenarioId) => {
    const barrierTransitionHashes = transitionHashesByScenario.get(scenarioId)!;
    const replayBarrierIndex = scenarioId === "CURRENT_STRICT" ? 0 : 1;
    const newExecutions = Number(scenarioTruth[scenarioId]["newCurrentSourceExecutionCount"]);
    return {
      scenarioId,
      ...scenarioTruth[scenarioId],
      priorContentHash: testSha256(`prior-${scenarioId}`),
      sourceOperationKey: "geo-raster.sample@1.0",
      executedOperationKeys: newExecutions > 0
        ? ["geo-product.check-current@1.0", "geo-raster.sample@1.0"]
        : ["geo-product.check-current@1.0"],
      checkCurrentExecutionCount: 1,
      originalSourceExecutionCount: 0,
      historicalPayloadRead: false,
      productVersionPresent: false,
      priorGroundingLoaded: true,
      currentnessEvidencePersisted: true,
      sourceRequestEvidenceHash: testSha256(`source-request-${scenarioId}`),
      replayRequestEvidenceHash: testSha256(`replay-request-${scenarioId}`),
      sourcePlanHash: testSha256(`plan-${scenarioId}`),
      sourceBarrierTransitionHash: barrierTransitionHashes[0],
      replayBarrierTransitionHash: barrierTransitionHashes[replayBarrierIndex],
      replayBarrierArm: scenarioId === "SOURCE_CHANGED_TWICE" ? armReference : null,
      barrierTransitionHashes,
      causalBindingHash: testSha256(`causal-${scenarioId}`),
      authorityTupleHash,
      currentnessDecisionHash: testSha256(`decision-${scenarioId}`),
      sourceGroundingIdHash: testSha256(`source-grounding-${scenarioId}`),
      replayGroundingIdHash: testSha256(`replay-grounding-${scenarioId}`),
      persistedResultHash: testSha256(`result-${scenarioId}`),
    };
  });
  const currentnessPath = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/currentness.json";
  const currentnessWritten = artifact(root, currentnessPath, {
    schemaVersion: "wsgs-gdps-v021-currentness-runner-receipt/1.0",
    generatedAt: "2026-08-29T13:00:00.000Z",
    binding,
    authorityTupleHash,
    barrierAttestation: barrierReference,
    scenarios,
  });
  const currentnessReference = {
    path: currentnessPath,
    hash: currentnessWritten.hash,
    byteLength: readFileSync(resolve(root, currentnessPath)).byteLength,
  };
  const rawUnitPath = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/unit-raw.json";
  const rawUnitWritten = artifact(root, rawUnitPath, {
    schemaVersion: "wsgs-gdps-v021-w43-canonical-vitest-report/1.0",
    runner: "vitest",
    runnerVersion: "4.1.11",
    selectedTestCount: 1,
    testResults: [{
      filePath: "services/grounding-worker/src/production-module.test.ts",
      assertions: [{ fullName: "fixture W43 currentness safety test", status: "passed" }],
    }],
  });
  const rawUnitReference = {
    path: rawUnitPath,
    hash: rawUnitWritten.hash,
    byteLength: readFileSync(resolve(root, rawUnitPath)).byteLength,
  };
  const unitPath = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/unit.json";
  const unitWritten = artifact(root, unitPath, {
    schemaVersion: "wsgs-gdps-v021-w43-unit-receipt/1.0",
    generatedAt: "2026-08-29T13:00:00.000Z",
    binding,
    runner: "vitest",
    runnerVersion: "4.1.11",
    testFiles: ["services/grounding-worker/src/production-module.test.ts"],
    exitCode: 0,
    rawReport: rawUnitReference,
  });
  const unitReference = {
    path: unitPath,
    hash: unitWritten.hash,
    byteLength: readFileSync(resolve(root, unitPath)).byteLength,
  };
  const observations = scenarios.map((scenario) => ({
    scenarioId: scenario.scenarioId,
    groundingStatus: scenario.groundingStatus,
    sourceGroundingIdHash: scenario.sourceGroundingIdHash,
    replayGroundingIdHash: scenario.replayGroundingIdHash,
    persistedResultHash: scenario.persistedResultHash,
    currentnessDecisionHash: testSha256(`decision-${scenario.scenarioId}`),
    transactionMode: "READ_ONLY",
    sourceGroundingRows: 1,
    replayGroundingRows: 1,
    resultRows: 1,
    stageRows: 3,
    executionRows: 1,
    currentnessEvidenceRows: 1,
    selectedProductRows: 1,
    priorGroundingLinkRows: 1,
    checkCurrentExecutionRows: 1,
    originalSourceExecutionRows: 0,
    newCurrentSourceExecutionRows: scenario.newCurrentSourceExecutionCount,
    sourceChangedDuringQueryRows: scenario.sourceChangedDuringQueryCount,
    sourceRequestEvidenceHash: scenario.sourceRequestEvidenceHash,
    replayRequestEvidenceHash: scenario.replayRequestEvidenceHash,
    sourcePlanHash: scenario.sourcePlanHash,
    sourceBarrierTransitionHash: scenario.sourceBarrierTransitionHash,
    replayBarrierTransitionHash: scenario.replayBarrierTransitionHash,
    replayBarrierArm: scenario.replayBarrierArm,
    barrierTransitionHashes: scenario.barrierTransitionHashes,
    causalBindingHash: scenario.causalBindingHash,
  }));
  const negativeAssertions = {
    foreignScope: { status: "DENIED", matchingRows: 0 },
    foreignPrincipal: { status: "DENIED", matchingRows: 0 },
    priorResultHashMismatch: { status: "DENIED", matchingRows: 0 },
  };
  const postgresPath = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/postgres.json";
  const postgresWritten = artifact(root, postgresPath, {
    schemaVersion: "wsgs-gdps-v021-real-postgres-currentness-receipt/1.0",
    generatedAt: "2026-08-29T13:00:00.000Z",
    binding,
    authorityTupleHash,
    barrierAttestation: barrierReference,
    database: {
      engine: "PostgreSQL",
      serverVersion: "17.1",
      executionClass: "REAL_ISOLATED_POSTGRESQL",
      mockUsed: false,
      connectionIdentityHash: databaseIdentityHash,
      migrationReceiptHash: testSha256("migrations"),
      queryTranscriptHash: testSha256("query-transcript"),
    },
    negativeAssertions,
    observations,
  });
  const postgresReference = {
    path: postgresPath,
    hash: postgresWritten.hash,
    byteLength: readFileSync(resolve(root, postgresPath)).byteLength,
  };
  const policySummary = (scenario: JsonObject): JsonObject => Object.fromEntries([
    "scenarioId", "replayMode", "groundingStatus", "terminalStatus", "normalizedStatus", "currentness",
    "semanticCode", "warnings", "priorContentHash", "currentContentHash", "checkCurrentExecutionCount",
    "originalSourceExecutionCount", "newCurrentSourceExecutionCount", "sourceChangedDuringQueryCount",
    "retryCount", "historicalPayloadRead", "productVersionPresent", "currentnessEvidencePersisted",
    "authorityTupleHash", "currentnessDecisionHash", "sourceRequestEvidenceHash", "replayRequestEvidenceHash",
    "sourcePlanHash", "sourceBarrierTransitionHash", "replayBarrierTransitionHash", "replayBarrierArm",
    "barrierTransitionHashes", "causalBindingHash",
  ].map((name) => [name, scenario[name]]));
  const postgresSummary = (observation: JsonObject): JsonObject => Object.fromEntries([
    "scenarioId", "groundingStatus", "transactionMode", "sourceGroundingRows", "replayGroundingRows",
    "resultRows", "stageRows", "executionRows", "currentnessEvidenceRows", "selectedProductRows",
    "priorGroundingLinkRows", "checkCurrentExecutionRows", "originalSourceExecutionRows",
    "newCurrentSourceExecutionRows", "sourceChangedDuringQueryRows", "currentnessDecisionHash",
    "sourceRequestEvidenceHash", "replayRequestEvidenceHash", "sourcePlanHash",
    "sourceBarrierTransitionHash", "replayBarrierTransitionHash", "replayBarrierArm",
    "barrierTransitionHashes", "causalBindingHash",
  ].map((name) => [name, observation[name]]));
  const artifacts = rows.flatMap((row) => row.evidenceTypes.map((evidenceType) => {
    const assertionId = `${row.id}.${evidenceType}`;
    const artifactPath = `reports/wsgs-v0.2-gdps-v0.2.1/w43-evidence/` +
      `${row.id.toLowerCase()}.${evidenceType.toLowerCase()}.json`;
    const selected = w43ScenariosByAcceptanceId[row.id]!;
    const facts = evidenceType === "CURRENTNESS"
      ? {
          gateRunId, runtimeIdentityHash, matrixScenario: row.scenario, matrixExpected: row.expected,
          sourceReceipt: currentnessReference,
          barrierAttestation: barrierReference,
          policyFacts: selected.map((id) => policySummary(scenarios.find((entry) => entry.scenarioId === id)!)),
        }
      : evidenceType === "UNIT"
        ? {
            gateRunId, runtimeIdentityHash, matrixScenario: row.scenario, matrixExpected: row.expected,
            sourceReceipt: unitReference,
            rawVitestReport: rawUnitReference,
            independentlyPassedTests: [{
              filePath: "services/grounding-worker/src/production-module.test.ts",
              fullName: "fixture W43 currentness safety test",
              status: "passed",
            }],
          }
        : {
            gateRunId, runtimeIdentityHash, matrixScenario: row.scenario, matrixExpected: row.expected,
            sourceReceipt: postgresReference,
            barrierAttestation: barrierReference,
            databaseIdentityHash,
            authorityTupleHash,
            persistedFacts: selected.map((id) => postgresSummary(
              observations.find((entry) => entry.scenarioId === id)!,
            )),
            negativeAssertions,
          };
    const written = artifact(root, artifactPath, {
      schemaVersion: w43AssertionEvidenceSchemaVersion,
      candidateSha,
      acceptanceId: row.id,
      evidenceType,
      assertionId,
      status: "PASS",
      facts,
    });
    return {
      acceptanceId: row.id,
      evidenceType,
      assertionId,
      artifactPath: written.path,
      artifactHash: written.hash,
      byteLength: readFileSync(resolve(root, written.path)).byteLength,
    };
  }));
  return {
    schemaVersion: w43ReportSchemaVersion,
    generatedAt: "2026-08-29T13:00:00.000Z",
    candidateSha,
    target,
    phase: "W43",
    status: "PASS",
    evidenceLedger: {
      schemaVersion: w43EvidenceLedgerSchemaVersion,
      candidateSha,
      phase: "W43",
      artifacts,
    },
  };
}

const typedReceiptSchemaVersions: Readonly<Record<string, string>> = {
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
};

function typedVerification(type: string, candidateSha: string): JsonObject {
  switch (type) {
    case "CI": return { kind: type, conclusion: "SUCCESS", checksPassed: 1 };
    case "CURRENTNESS": return {
      kind: type, currentness: "CURRENT", historicalPayloadRead: false, productVersionPresent: false,
    };
    case "GIT": return { kind: type, head: candidateSha, clean: true };
    case "GOWM_GATEWAY": return { kind: type, httpStatus: 200, readiness: "ok", directProviderCalls: 0 };
    case "REAL_NATURAL_LANGUAGE_E2E": return {
      kind: type, terminalStatus: "COMPLETED", gatewayOnly: true, directProviderCalls: 0,
      mockTransportUsed: false,
    };
    case "REAL_POSTGRES": return {
      kind: type, databaseClass: "REAL_ISOLATED_POSTGRESQL", transactionMode: "READ_ONLY",
      assertionsPassed: 1, mockUsed: false,
    };
    case "REPORT": return { kind: type, reportStatus: "PASS", evaluatedAssertions: 1 };
    case "RUNNING_GOWM_GATEWAY": return {
      kind: type, httpStatus: 200, readiness: "ok", operationAvailability: "AVAILABLE",
    };
    case "SCHEMA": return { kind: type, compiled: true, errors: [] };
    case "SOURCE": return { kind: type, sourceHash: testSha256("source"), sourceBytes: 1 };
    case "STATIC_GUARD": return { kind: type, exitCode: 0, violations: [] };
    case "UNIT": return { kind: type, exitCode: 0, passedTests: 1, failedTests: 0 };
    default: throw new Error(`unsupported fixture evidence type ${type}`);
  }
}

function typedPhaseReport(
  root: string,
  candidateSha: string,
  phase: string,
  rows: readonly Row[],
): JsonObject {
  const artifacts = rows.flatMap((row) => row.evidenceTypes.map((evidenceType) => {
    const assertionId = `${row.id}.${evidenceType}`;
    const suffix = `${row.id.toLowerCase()}.${evidenceType.toLowerCase()}.json`;
    const verification = typedVerification(evidenceType, candidateSha);
    const receiptPath = `reports/wsgs-v0.2-gdps-v0.2.1/typed-receipts/${suffix}`;
    const receiptWritten = artifact(root, receiptPath, {
      schemaVersion: typedReceiptSchemaVersions[evidenceType],
      candidateSha,
      acceptanceId: row.id,
      evidenceType,
      verification,
    });
    const sourceReceipt = {
      path: receiptPath,
      hash: receiptWritten.hash,
      byteLength: readFileSync(resolve(root, receiptPath)).byteLength,
    };
    const evidencePath = `reports/wsgs-v0.2-gdps-v0.2.1/typed-evidence/${suffix}`;
    const evidenceWritten = artifact(root, evidencePath, {
      schemaVersion: "wsgs-gdps-v021-typed-assertion-evidence/1.0",
      candidateSha,
      acceptanceId: row.id,
      evidenceType,
      assertionId,
      status: "PASS",
      facts: { sourceReceipt, verification },
    });
    return {
      acceptanceId: row.id,
      evidenceType,
      assertionId,
      artifactPath: evidencePath,
      artifactHash: evidenceWritten.hash,
      byteLength: readFileSync(resolve(root, evidencePath)).byteLength,
    };
  }));
  return {
    schemaVersion: "wsgs-gdps-v021-phase-report/2.0",
    generatedAt: "2026-08-29T13:00:00.000Z",
    candidateSha,
    target,
    phase,
    status: "PASS",
    evidenceLedger: {
      schemaVersion: "wsgs-gdps-v021-typed-evidence-ledger/1.0",
      candidateSha,
      phase,
      artifacts,
    },
  };
}

function createFixture(options: { readonly complete?: boolean; readonly designateW44?: boolean } = {}): Fixture {
  const complete = options.complete ?? true;
  const designateW44 = options.designateW44 ?? true;
  const root = mkdtempSync(resolve(tmpdir(), "wsgs-gdps-evidence-map-"));
  temporaryRoots.push(root);
  const candidateSha = "a".repeat(40);
  const matrixPath = "acceptance/gdps-v0.2.1/acceptance-matrix.csv";
  const policyPath = "config/gdps-v021-acceptance-policy.json";
  mkdirSync(resolve(root, dirname(matrixPath)), { recursive: true });
  mkdirSync(resolve(root, dirname(policyPath)), { recursive: true });
  cpSync(resolve(sourceRoot, matrixPath), resolve(root, matrixPath));
  cpSync(resolve(sourceRoot, policyPath), resolve(root, policyPath));
  cpSync(
    resolve(sourceRoot, "config", "gdps-e2e-corpus.json"),
    resolve(root, "config", "gdps-e2e-corpus.json"),
  );
  cpSync(
    resolve(sourceRoot, "contracts", "wsgs-v0.2-gdps", "report-contracts"),
    resolve(root, "contracts", "wsgs-v0.2-gdps", "report-contracts"),
    { recursive: true },
  );
  const matrixBytes = readFileSync(resolve(root, matrixPath));
  const policyBytes = readFileSync(resolve(root, policyPath));
  const rows = parseCsv(matrixBytes.toString("utf8")).map((row): Row => ({
    id: String(row["id"]),
    phase: String(row["phase"]),
    scenario: String(row["scenario"]),
    expected: String(row["expected"]),
    evidenceTypes: String(row["evidence"]).split("/"),
  }));
  const sourceReports: JsonObject[] = [];
  const phaseReports: JsonObject[] = [];
  const runtimeReports: JsonObject[] = [];
  const reports: JsonObject[] = [];
  if (complete) {
    for (const phase of [...new Set(rows.map((row) => row.phase))]) {
      const phaseRows = rows.filter((row) => row.phase === phase);
      const reportId = `${phase.toLowerCase()}-typed-report`;
      const reportPath = `reports/wsgs-v0.2-gdps-v0.2.1/${reportId}.json`;
      const reportDocument = phase === "W44"
        ? w44Report(root, candidateSha)
        : phase === "W43"
          ? w43Report(root, candidateSha, phaseRows)
          : typedPhaseReport(root, candidateSha, phase, phaseRows);
      const written = artifact(root, reportPath, reportDocument);
      const report: JsonObject = {
        reportId,
        phase,
        reportStatus: "PASS",
        artifactPath: written.path,
        artifactHash: written.hash,
        candidateSha,
        target,
        assertions: phaseRows.flatMap((row) => row.evidenceTypes.map((type) => ({
          acceptanceId: row.id,
          type,
          assertionId: `${row.id}.${type}`,
          status: "PASS",
          polarity: row.id === "W33-020" ? "NEGATIVE" : "POSITIVE",
        }))),
      };
      reports.push(report);
      if (phase === "W33") sourceReports.push(report);
      else if (phase === "W44") runtimeReports.push(report);
      else phaseReports.push(report);
    }
  }
  const w44 = runtimeReports[0];
  const manifest: JsonObject = {
    schemaVersion: "wsgs-gdps-v021-evidence-report-manifest/1.0",
    candidate: { repository: "world-semantic-grounding-service", gitHead: candidateSha },
    target,
    matrix: { artifactPath: matrixPath, artifactHash: testSha256(matrixBytes) },
    policy: { artifactPath: policyPath, artifactHash: testSha256(policyBytes) },
    sourceReports,
    phaseReports,
    runtimeReports,
    w44Report: designateW44 && w44
      ? {
          reportId: w44["reportId"],
          artifactPath: w44["artifactPath"],
          artifactHash: w44["artifactHash"],
        }
      : null,
  };
  const manifestPath = "reports/wsgs-v0.2-gdps-v0.2.1/evidence-report-manifest.json";
  writeJson(resolve(root, manifestPath), manifest);
  return { root, candidateSha, manifestPath, manifest, reports, rows };
}

function saveManifest(fixture: Fixture): void {
  writeJson(resolve(fixture.root, fixture.manifestPath), fixture.manifest);
}

function rewriteReport(
  fixture: Fixture,
  phase: string,
  mutate: (document: JsonObject) => void,
): JsonObject {
  const report = fixture.reports.find((candidate) => candidate["phase"] === phase)!;
  const reportPath = String(report["artifactPath"]);
  const document = JSON.parse(readFileSync(resolve(fixture.root, reportPath), "utf8")) as JsonObject;
  mutate(document);
  const written = artifact(fixture.root, reportPath, document);
  report["artifactHash"] = written.hash;
  if (phase === "W44") {
    const w44 = fixture.manifest["w44Report"] as JsonObject;
    w44["artifactHash"] = written.hash;
  }
  saveManifest(fixture);
  return document;
}

function rewriteW44Report(
  fixture: Fixture,
  mutate: (document: JsonObject) => void,
): JsonObject {
  return rewriteReport(fixture, "W44", mutate);
}

function git(root: string, arguments_: readonly string[]): string {
  return execFileSync("git", [...arguments_], { cwd: root, encoding: "utf8" }).trim();
}

function build(fixture: Fixture) {
  return buildGdpsV021AcceptanceEvidenceMap({
    repositoryRoot: fixture.root,
    manifestPath: fixture.manifestPath,
    expectedCandidateSha: fixture.candidateSha,
  });
}

function entry(result: ReturnType<typeof build>, id: string): JsonObject {
  const entries = result.document["entries"] as JsonObject[];
  return entries.find((candidate) => candidate["acceptanceId"] === id)!;
}

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error("expected evidence-map build failure");
  } catch (error) {
    expect(error).toBeInstanceOf(GdpsV021EvidenceMapError);
    expect((error as GdpsV021EvidenceMapError).code).toBe(code);
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("GDPS v0.2.1 row-level typed acceptance evidence map builder", () => {
  it("uses an independent SHA-256 oracle for fixture and tamper hashes", () => {
    expect(testSha256("")).toBe(
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("passes only when all 327 rows have every required typed assertion and the exact W44 report passes", () => {
    const fixture = createFixture();
    const result = build(fixture);
    const overall = result.document["overall"] as JsonObject;
    expect(overall["status"]).toBe("PASS");
    expect(overall["counts"]).toEqual({ PASS: 327, FAIL: 0, NOT_RUN: 0, BLOCKED: 0 });
    expect((result.document["entries"] as JsonObject[])).toHaveLength(327);
    expect(entry(result, "W33-001")["evidence"]).toHaveLength(2);
    const w43Evidence = entry(result, "W43-001")["evidence"] as JsonObject[];
    expect(w43Evidence).toHaveLength(3);
    expect(w43Evidence.every((item) => String(item["artifact"])
      .startsWith("reports/wsgs-v0.2-gdps-v0.2.1/w43-evidence/"))).toBe(true);
    expect(new Set(w43Evidence.map((item) => item["sha256"])).size).toBe(3);
    expect(entry(result, "W44-X12")["evidence"]).toHaveLength(2);
  });

  it("keeps all rows NOT_RUN when an otherwise PASS-shaped aggregate manifest has no row assertions", () => {
    const fixture = createFixture({ complete: false });
    const aggregate = artifact(
      fixture.root,
      "reports/wsgs-v0.2-gdps-v0.2.1/aggregate-pass.json",
      { candidateSha: fixture.candidateSha, target, overallStatus: "PASS", passed: 327 },
    );
    (fixture.manifest["phaseReports"] as JsonObject[]).push({
      reportId: "aggregate-pass",
      phase: "W45",
      reportStatus: "PASS",
      artifactPath: aggregate.path,
      artifactHash: aggregate.hash,
      candidateSha: fixture.candidateSha,
      target,
      assertions: [],
    });
    saveManifest(fixture);
    const result = build(fixture);
    const overall = result.document["overall"] as JsonObject;
    expect(overall["status"]).toBe("BLOCKED");
    expect(overall["counts"]).toEqual({ PASS: 0, FAIL: 0, NOT_RUN: 327, BLOCKED: 0 });
  });

  it("keeps a partially evidenced row BLOCKED when one required evidence type is missing", () => {
    const fixture = createFixture();
    const report = fixture.reports.find((candidate) => candidate["phase"] === "W45")!;
    report["assertions"] = (report["assertions"] as JsonObject[]).filter((assertion) =>
      !(assertion["acceptanceId"] === "W45-001" && assertion["type"] === "GIT"));
    rewriteReport(fixture, "W45", (document) => {
      const ledger = document["evidenceLedger"] as JsonObject;
      ledger["artifacts"] = (ledger["artifacts"] as JsonObject[]).filter((record) =>
        !(record["acceptanceId"] === "W45-001" && record["evidenceType"] === "GIT"));
    });
    saveManifest(fixture);
    const result = build(fixture);
    expect(entry(result, "W45-001")).toMatchObject({ status: "BLOCKED" });
    expect(String(entry(result, "W45-001")["reason"])).toContain("GIT");
  });

  it("does not accept a legacy aggregate W43 PASS report without the 54-file ledger", () => {
    const fixture = createFixture();
    rewriteReport(fixture, "W43", (document) => {
      document["schemaVersion"] = "wsgs-gdps-v021-phase-report/1.0";
      delete document["generatedAt"];
      delete document["evidenceLedger"];
    });
    expectCode(() => build(fixture), "W43_REPORT_SCHEMA_INVALID");
  });

  it("requires every W43 PASS assertion to have one exact ledger artifact", () => {
    const fixture = createFixture();
    rewriteReport(fixture, "W43", (document) => {
      const ledger = document["evidenceLedger"] as JsonObject;
      ledger["artifacts"] = (ledger["artifacts"] as JsonObject[]).filter((record) =>
        !(record["acceptanceId"] === "W43-001" && record["evidenceType"] === "CURRENTNESS"));
    });
    expectCode(() => build(fixture), "W43_EVIDENCE_LEDGER_INVENTORY_INVALID");
  });

  it("verifies all W43 CURRENTNESS, UNIT, and REAL_POSTGRES evidence bytes", () => {
    const fixture = createFixture();
    const report = fixture.reports.find((candidate) => candidate["phase"] === "W43")!;
    const document = JSON.parse(readFileSync(
      resolve(fixture.root, String(report["artifactPath"])),
      "utf8",
    )) as JsonObject;
    const ledger = document["evidenceLedger"] as JsonObject;
    const record = (ledger["artifacts"] as JsonObject[]).find((candidate) =>
      candidate["acceptanceId"] === "W43-018" && candidate["evidenceType"] === "REAL_POSTGRES")!;
    const artifactPath = resolve(fixture.root, String(record["artifactPath"]));
    const bytes = readFileSync(artifactPath);
    const forged = Buffer.from(bytes);
    forged[0] = forged[0] === 0x7b ? 0x5b : 0x7b;
    writeFileSync(artifactPath, forged);
    expectCode(() => build(fixture), "W43_EVIDENCE_ARTIFACT_HASH_DRIFT");
  });

  it("binds each W43 evidence envelope to its acceptance row, type, and assertion ID", () => {
    const fixture = createFixture();
    rewriteReport(fixture, "W43", (document) => {
      const ledger = document["evidenceLedger"] as JsonObject;
      const record = (ledger["artifacts"] as JsonObject[]).find((candidate) =>
        candidate["acceptanceId"] === "W43-001" && candidate["evidenceType"] === "UNIT")!;
      const artifactPath = resolve(fixture.root, String(record["artifactPath"]));
      const evidence = JSON.parse(readFileSync(artifactPath, "utf8")) as JsonObject;
      evidence["evidenceType"] = "CURRENTNESS";
      const bytes = writeJson(artifactPath, evidence);
      record["artifactHash"] = testSha256(bytes);
      record["byteLength"] = bytes.byteLength;
    });
    expectCode(() => build(fixture), "W43_EVIDENCE_ARTIFACT_SCHEMA_INVALID");
  });

  it("records an exact failed assertion as FAIL without promoting missing types", () => {
    const fixture = createFixture();
    const report = fixture.reports.find((candidate) => candidate["phase"] === "W35")!;
    const assertion = (report["assertions"] as JsonObject[]).find((candidate) =>
      candidate["acceptanceId"] === "W35-001" && candidate["type"] === "UNIT")!;
    assertion["status"] = "FAIL" satisfies EvidenceStatus;
    rewriteReport(fixture, "W35", (document) => {
      const ledger = document["evidenceLedger"] as JsonObject;
      ledger["artifacts"] = (ledger["artifacts"] as JsonObject[]).filter((record) =>
        !(record["acceptanceId"] === "W35-001" && record["evidenceType"] === "UNIT"));
    });
    saveManifest(fixture);
    const result = build(fixture);
    expect(entry(result, "W35-001")["status"]).toBe("FAIL");
    expect((result.document["overall"] as JsonObject)["status"]).toBe("FAIL");
  });

  it("requires the manifest and every report to bind the exact candidate SHA", () => {
    const fixture = createFixture();
    const report = fixture.reports.find((candidate) => candidate["phase"] === "W35")!;
    report["candidateSha"] = "e".repeat(40);
    saveManifest(fixture);
    expectCode(() => build(fixture), "REPORT_CANDIDATE_SHA_MISMATCH");
  });

  it("rejects a report artifact whose embedded WSGS candidate differs from its manifest", () => {
    const fixture = createFixture();
    const report = fixture.reports.find((candidate) => candidate["phase"] === "W35")!;
    const written = artifact(
      fixture.root,
      String(report["artifactPath"]),
      { candidateSha: "e".repeat(40), target, phase: "W35", status: "PASS" },
    );
    report["artifactHash"] = written.hash;
    saveManifest(fixture);
    expectCode(() => build(fixture), "REPORT_ARTIFACT_CANDIDATE_SHA_MISMATCH");
  });

  it("fails closed on an artifact byte-hash drift", () => {
    const fixture = createFixture();
    const report = fixture.reports.find((candidate) => candidate["phase"] === "W35")!;
    writeJson(resolve(fixture.root, String(report["artifactPath"])), { changed: true });
    expectCode(() => build(fixture), "REPORT_ARTIFACT_HASH_DRIFT");
  });

  it("rejects a positive legacy report location", () => {
    const fixture = createFixture();
    const report = fixture.reports.find((candidate) => candidate["phase"] === "W35")!;
    const legacy = artifact(
      fixture.root,
      "reports/wsgs-v0.2-gdps/legacy.json",
      { candidateSha: fixture.candidateSha, providerVersion: "0.2.1", capabilityCount: 30 },
    );
    report["artifactPath"] = legacy.path;
    report["artifactHash"] = legacy.hash;
    saveManifest(fixture);
    expectCode(() => build(fixture), "REPORT_ARTIFACT_PATH_NOT_CANONICAL");
  });

  it("rejects legacy 0.1.0, 23-operation, and forbidden-SHA identities in positive evidence", () => {
    for (const [field, value, code] of [
      ["providerVersion", "0.1.0", "LEGACY_PROVIDER_VERSION_FORBIDDEN"],
      ["capabilityCount", 23, "LEGACY_CAPABILITY_COUNT_FORBIDDEN"],
      ["sourceCommit", "9bbbafeef97e4bd9f0b65a11ad340d223e7ec4ca", "LEGACY_SOURCE_SHA_FORBIDDEN"],
    ] as const) {
      const fixture = createFixture();
      const report = fixture.reports.find((candidate) => candidate["phase"] === "W35")!;
      const written = artifact(
        fixture.root,
        String(report["artifactPath"]),
        { candidateSha: fixture.candidateSha, [field]: value },
      );
      report["artifactHash"] = written.hash;
      saveManifest(fixture);
      expectCode(() => build(fixture), code);
      rmSync(fixture.root, { recursive: true, force: true });
      temporaryRoots.splice(temporaryRoots.indexOf(fixture.root), 1);
    }
  });

  it("does not declare overall PASS without an explicitly designated exact W44 PASS report", () => {
    const fixture = createFixture({ designateW44: false });
    const result = build(fixture);
    const overall = result.document["overall"] as JsonObject;
    expect(overall["counts"]).toEqual({ PASS: 299, FAIL: 0, NOT_RUN: 28, BLOCKED: 0 });
    expect(overall["status"]).toBe("BLOCKED");
    expect((overall["blockers"] as JsonObject[])[0]?.["code"]).toBe("W44_REPORT_NOT_PASS");
  });

  it("rejects a designated W44 report that is not 16+12 gateway-only PASS", () => {
    const fixture = createFixture();
    const report = fixture.reports.find((candidate) => candidate["phase"] === "W44")!;
    const document = JSON.parse(readFileSync(
      resolve(fixture.root, String(report["artifactPath"])), "utf8",
    )) as JsonObject;
    (document["execution"] as JsonObject)["directProviderCalls"] = 1;
    const written = artifact(fixture.root, String(report["artifactPath"]), document);
    report["artifactHash"] = written.hash;
    const w44 = fixture.manifest["w44Report"] as JsonObject;
    w44["artifactHash"] = written.hash;
    saveManifest(fixture);
    expectCode(() => build(fixture), "W44_GATEWAY_ONLY_NOT_PROVEN");
  });

  it("validates the designated W44 document with the locked real-report schema", () => {
    const fixture = createFixture();
    rewriteW44Report(fixture, (document) => {
      delete document["generatedAt"];
    });
    expectCode(() => build(fixture), "W44_REPORT_SCHEMA_INVALID");
  });

  it("rejects arbitrary and unledgered qualification evidence references", () => {
    const arbitraryHash = createFixture();
    rewriteW44Report(arbitraryHash, (document) => {
      const qualification = (document["qualifications"] as JsonObject[])[0]!;
      (qualification["evidenceHashes"] as string[])[0] = testSha256("arbitrary-unledgered-hash");
    });
    expectCode(() => build(arbitraryHash), "W44_POLICY_REEVALUATION_FAILED");

    const unledgeredId = createFixture();
    rewriteW44Report(unledgeredId, (document) => {
      const qualification = (document["qualifications"] as JsonObject[])[0]!;
      (qualification["evidenceArtifactIds"] as string[])[0] = "not-ledgered-artifact";
    });
    expectCode(() => build(unledgeredId), "W44_POLICY_REEVALUATION_FAILED");
  });

  it("hashes every W44 ledger artifact from repository bytes", () => {
    const fixture = createFixture();
    const report = fixture.reports.find((candidate) => candidate["phase"] === "W44")!;
    const document = JSON.parse(readFileSync(
      resolve(fixture.root, String(report["artifactPath"])),
      "utf8",
    )) as JsonObject;
    const ledger = document["evidenceLedger"] as JsonObject;
    const record = (ledger["artifacts"] as JsonObject[])[0]!;
    const artifactPath = resolve(fixture.root, String(record["repoRelativePath"]));
    const bytes = readFileSync(artifactPath);
    const forged = Buffer.from(bytes);
    forged[0] = forged[0] === 0x7b ? 0x5b : 0x7b;
    writeFileSync(artifactPath, forged);
    expectCode(() => build(fixture), "W44_EVIDENCE_LEDGER_ARTIFACT_HASH_DRIFT");
  });

  it("rejects a PASS-shaped report whose observation fails frozen policy re-evaluation", () => {
    const fixture = createFixture();
    rewriteW44Report(fixture, (document) => {
      const firstCase = (document["cases"] as JsonObject[])[0]!;
      (firstCase["observation"] as JsonObject)["terminalStatus"] = "FAILED";
    });
    expectCode(() => build(fixture), "W44_POLICY_REEVALUATION_NOT_PASS");
  });

  it("requires the exact policy-derived driver artifact IDs", () => {
    const fixture = createFixture();
    rewriteW44Report(fixture, (document) => {
      const ledger = document["evidenceLedger"] as JsonObject;
      const record = (ledger["artifacts"] as JsonObject[]).find((candidate) =>
        candidate["id"] === "driver-neg-data-gap-implementation")!;
      record["id"] = "driver-neg-data-gap-renamed-implementation";
    });
    expectCode(() => build(fixture), "W44_POLICY_REEVALUATION_FAILED");
  });

  it("binds each embedded driver attestation to the ledgered attestation bytes", () => {
    const fixture = createFixture();
    rewriteW44Report(fixture, (document) => {
      const ledger = document["evidenceLedger"] as JsonObject;
      const record = (ledger["artifacts"] as JsonObject[]).find((candidate) =>
        candidate["id"] === "driver-neg-data-gap-attestation")!;
      const artifactPath = resolve(fixture.root, String(record["repoRelativePath"]));
      const attestation = JSON.parse(readFileSync(artifactPath, "utf8")) as JsonObject;
      attestation["sourceCommit"] = "e".repeat(40);
      const bytes = writeJson(artifactPath, attestation);
      record["hash"] = testSha256(bytes);
      record["byteLength"] = bytes.byteLength;
    });
    expectCode(() => build(fixture), "W44_DRIVER_ATTESTATION_ARTIFACT_CONTENT_MISMATCH");
  });

  it("accepts an implementation candidate with a reports-only descendant and rejects dirty source drift", () => {
    const root = mkdtempSync(resolve(tmpdir(), "wsgs-gdps-candidate-descendant-"));
    temporaryRoots.push(root);
    git(root, ["init", "--quiet"]);
    git(root, ["config", "user.email", "wsgs-tests@example.invalid"]);
    git(root, ["config", "user.name", "WSGS Tests"]);
    git(root, ["config", "core.autocrlf", "false"]);
    writeJson(resolve(root, "src", "implementation.json"), { implementation: 1 });
    git(root, ["add", "."]);
    git(root, ["commit", "--quiet", "-m", "implementation"]);
    const implementationSha = git(root, ["rev-parse", "HEAD"]);
    writeJson(
      resolve(root, "reports", "wsgs-v0.2-gdps-v0.2.1", "runtime-report.json"),
      { status: "PASS" },
    );
    git(root, ["add", "."]);
    git(root, ["commit", "--quiet", "-m", "reports only"]);
    const reportHead = git(root, ["rev-parse", "HEAD"]);
    expect(() => assertReportsOnlyCandidateDescendant(
      root,
      implementationSha,
      reportHead,
    )).not.toThrow();

    writeJson(resolve(root, "src", "implementation.json"), { implementation: 2 });
    expectCode(
      () => assertReportsOnlyCandidateDescendant(root, implementationSha, reportHead),
      "CLI_CANDIDATE_STALE_RELATIVE_TO_IMPLEMENTATION",
    );

    git(root, ["add", "."]);
    git(root, ["commit", "--quiet", "-m", "implementation drift"]);
    const implementationDriftHead = git(root, ["rev-parse", "HEAD"]);
    expectCode(
      () => assertReportsOnlyCandidateDescendant(root, implementationSha, implementationDriftHead),
      "CLI_CANDIDATE_STALE_RELATIVE_TO_IMPLEMENTATION",
    );
  });

  it("rejects duplicate row/type claims rather than choosing one report", () => {
    const fixture = createFixture();
    const report = fixture.reports.find((candidate) => candidate["phase"] === "W35")!;
    const duplicate = structuredClone((report["assertions"] as JsonObject[])[0]!);
    duplicate["assertionId"] = "different-id";
    (report["assertions"] as JsonObject[]).push(duplicate);
    saveManifest(fixture);
    expectCode(() => build(fixture), "DUPLICATE_ROW_EVIDENCE_TYPE");
  });
});
