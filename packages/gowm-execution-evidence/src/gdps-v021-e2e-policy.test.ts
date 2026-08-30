import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  GDPS_V021_E2E_CASE_IDS,
  GDPS_V021_E2E_CORPUS_HASH,
  GDPS_V021_OPERATION_KEYS,
  GDPS_V021_QUALIFICATION_IDS,
  evaluateGdpsV021Case,
  evaluateGdpsV021Report,
  findForbiddenGdpsOperations,
  gdpsV021CurrentnessStatus,
  gdpsV021DriverArtifactIds,
  parseGdpsV021Corpus
} from "./gdps-v021-e2e-policy.js";
import { canonicalSha256 } from "./canonical.js";
import type {
  GdpsV021Case,
  GdpsV021CaseObservation,
  GdpsV021DriverAttestation,
  GdpsV021EvidenceArtifactKind,
  GdpsV021EvidenceArtifactRecord,
  GdpsV021EvidenceBindingContext,
  GdpsV021EvidenceSubject,
  GdpsV021OperationKey,
  GdpsV021QualificationEvidence,
  GdpsV021ReportInput,
  GdpsV021Sha256Digest
} from "./gdps-v021-e2e-policy.js";

const digest = (value: string | number): GdpsV021Sha256Digest =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;
const corpusBytes = (): Buffer => readFileSync(resolve(process.cwd(), "config", "gdps-e2e-corpus.json"));

const sourceIdentity: GdpsV021ReportInput["sourceIdentity"] = {
  wsgsCommit: "1".repeat(40),
  gdpsCommit: "2".repeat(40),
  gowmIdentityHash: digest("gowm-identity"),
  runtimeIdentityHash: digest("runtime-identity"),
  handoffBundleHash: digest("handoff-bundle"),
  operationLockProvenanceHash: digest("operation-lock-provenance"),
  providerId: "gdps.geospatial-products",
  providerVersion: "0.2.1",
  capabilityCount: 30
};

const execution: GdpsV021ReportInput["execution"] = {
  requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY",
  gatewayOnly: true,
  directProviderCalls: 0,
  mockTransportUsed: false
};

const operationLockHash = digest("operation-lock");

interface ArtifactOptions {
  readonly id?: string;
  readonly hash?: GdpsV021Sha256Digest;
  readonly repoRelativePath?: string;
}

type AddArtifact = (kind: GdpsV021EvidenceArtifactKind, subject: GdpsV021EvidenceSubject,
  options?: ArtifactOptions) => GdpsV021EvidenceArtifactRecord;

function driver(expected: GdpsV021Case, addArtifact: AddArtifact): GdpsV021DriverAttestation | null {
  if (expected.requiredDriverKind === null) return null;
  if (!["NEG-DATA-GAP", "NEG-RECIPE-DRIFT", "NEG-TRUNCATED", "NEG-CURRENTNESS"].includes(expected.id)) {
    throw new Error("test driver case mismatch");
  }
  const caseId = expected.id as GdpsV021DriverAttestation["caseId"];
  const ids = gdpsV021DriverArtifactIds(caseId);
  const implementation = addArtifact("DRIVER_IMPLEMENTATION", expected.id, {
    id: ids.implementation,
    repoRelativePath: `validation/drivers/${expected.id.toLowerCase()}.ts`
  });
  const evidence = addArtifact("DRIVER_EVIDENCE", expected.id, { id: ids.evidence });
  const precondition = {
    caseId,
    driverKind: expected.requiredDriverKind,
    observationHash: digest(`precondition:${expected.id}`)
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
    sharedRuntimeBeforeHash: digest("shared-runtime"),
    sharedRuntimeAfterHash: digest("shared-runtime"),
    executionEnvironment: "ISOLATED_REAL_RUNTIME",
    requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY",
    realExternalDependencies: true,
    mockTransportUsed: false,
    sharedRuntimeMutated: false,
    precondition,
    preconditionHash: canonicalSha256(precondition),
    driverImplementationHash: implementation.hash,
    evidenceHash: evidence.hash
  };
  addArtifact("DRIVER_ATTESTATION", expected.id, { id: ids.attestation });
  return attestation;
}

function observation(expected: GdpsV021Case, addArtifact: AddArtifact): GdpsV021CaseObservation {
  const needsProduct = expected.productExpectation !== "ABSENT";
  const productId = expected.expectedExplicitProductId ?? `gdps-${expected.id.toLowerCase().replaceAll("_", "-")}`;
  const evidence = addArtifact("CASE_EVIDENCE", expected.id);
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
    recipeLockHash: expected.requiresRecipeEvidence ? digest(`recipe:${expected.id}`) : null,
    descriptorHash: expected.expectedDescriptorId === null ? null : digest(`descriptor:${expected.id}`),
    planHash: expected.requiresPlanEvidence ? digest(`plan:${expected.id}`) : null,
    operationLockHash: expected.requiresOperationLockEvidence ? operationLockHash : null,
    productEvidence: needsProduct && expected.expectedProductBinding !== null ? (() => {
      const contentHash = digest(`product:${expected.id}`);
      const dataSnapshot = { snapshotId: `data-${expected.id.toLowerCase()}`, hash: digest(`data:${expected.id}`) };
      const computeSnapshot = { snapshotId: `compute-${expected.id.toLowerCase()}`, hash: digest(`compute:${expected.id}`) };
      const quality = { completeness: 1, confidence: 1 };
      return {
      productId,
      contentHash,
      currentContentHash: expected.productExpectation === "CURRENTNESS_CHANGE" ? digest(`current:${expected.id}`) : contentHash,
      descriptorId: expected.expectedProductBinding.descriptorId,
      descriptorHash: digest(`descriptor:${expected.id}`),
      productType: expected.expectedProductBinding.productType,
      productProfile: expected.expectedProductBinding.productProfile,
      queryProfile: expected.expectedProductBinding.queryProfile,
      sourceOperationKey: expected.expectedOperationKeys.filter((key) =>
        (GDPS_V021_OPERATION_KEYS as readonly string[]).includes(key))[0]! as GdpsV021OperationKey,
      dataSnapshot,
      dataSnapshotHash: canonicalSha256(dataSnapshot),
      computeSnapshot,
      computeSnapshotHash: canonicalSha256(computeSnapshot),
      receiptIds: [`receipt-${expected.id.toLowerCase()}`],
      evidenceIds: [`evidence-${expected.id.toLowerCase()}`],
      quality,
      qualityHash: canonicalSha256(quality),
      truncated: expected.caseType === "TRUNCATED"
      };
    })() : null,
    currentness: expected.caseType === "CURRENTNESS" ? "CHANGED" :
      expected.caseType === "DATA_GAP" ? "NOT_AVAILABLE" : needsProduct ? "CURRENT" : null,
    truncated: expected.caseType === "TRUNCATED",
    falseFactInferred: false,
    originalQueryExecuted: false,
    evidenceArtifactIds: [evidence.id],
    evidenceHashes: [evidence.hash],
    driverAttestation: driver(expected, addArtifact)
  };
}

function qualifications(addArtifact: AddArtifact): GdpsV021QualificationEvidence[] {
  return GDPS_V021_QUALIFICATION_IDS.map((qualificationId) => ({
    qualificationId,
    status: "PASS",
    ...(() => {
      const evidence = addArtifact("QUALIFICATION_EVIDENCE", qualificationId);
      return { evidenceArtifactIds: [evidence.id], evidenceHashes: [evidence.hash] };
    })(),
    detail: `Real evidence for ${qualificationId}`
  }));
}

function reportInput(corpus: ReturnType<typeof parseGdpsV021Corpus>, includeQualifications = true): GdpsV021ReportInput {
  const artifacts: GdpsV021EvidenceArtifactRecord[] = [];
  let artifactSequence = 0;
  const addArtifact: AddArtifact = (kind, subject, options = {}) => {
    artifactSequence += 1;
    const id = options.id ?? `artifact-${String(artifactSequence).padStart(3, "0")}`;
    const record: GdpsV021EvidenceArtifactRecord = {
      id,
      kind,
      subject,
      repoRelativePath: options.repoRelativePath ?? `reports/wsgs-v0.2-gdps-v0.2.1/evidence/${id}.json`,
      hash: options.hash ?? digest(`artifact-bytes:${artifactSequence}`),
      byteLength: 100 + artifactSequence,
      byteVerified: true,
      sourceBinding: {
        wsgsCommit: sourceIdentity.wsgsCommit,
        gdpsCommit: sourceIdentity.gdpsCommit,
        gowmIdentityHash: sourceIdentity.gowmIdentityHash,
        handoffBundleHash: sourceIdentity.handoffBundleHash,
        operationLockProvenanceHash: sourceIdentity.operationLockProvenanceHash
      },
      runtimeBinding: {
        runtimeIdentityHash: sourceIdentity.runtimeIdentityHash,
        requiredExecutionPath: execution.requiredExecutionPath,
        providerId: sourceIdentity.providerId,
        providerVersion: sourceIdentity.providerVersion,
        capabilityCount: sourceIdentity.capabilityCount,
        gatewayOnly: true,
        directProviderCalls: 0,
        mockTransportUsed: false
      },
      operationLockHash
    };
    artifacts.push(record);
    return record;
  };
  const observations = corpus.cases.map((expected) => observation(expected, addArtifact));
  const qualificationEvidence = includeQualifications ? qualifications(addArtifact) : [];
  return {
    generatedAt: "2026-08-29T13:00:00.000Z",
    sourceIdentity,
    execution,
    evidenceLedger: {
      schemaVersion: "wsgs-gdps-byte-evidence-ledger/1.0",
      operationLockHash,
      artifacts
    },
    observations,
    qualifications: qualificationEvidence
  };
}

function evidenceContext(input: GdpsV021ReportInput): GdpsV021EvidenceBindingContext {
  return {
    sourceIdentity: input.sourceIdentity,
    execution: input.execution,
    evidenceLedger: input.evidenceLedger
  };
}

function validators(): { validateReport: (value: unknown) => boolean; validateDriver: (value: unknown) => boolean;
  errors: () => string } {
  const driverSchema = JSON.parse(readFileSync(resolve(process.cwd(), "contracts", "wsgs-v0.2-gdps", "report-contracts",
    "gdps-v021-driver-attestation.schema.json"), "utf8")) as object;
  const reportSchema = JSON.parse(readFileSync(resolve(process.cwd(), "contracts", "wsgs-v0.2-gdps", "report-contracts",
    "gdps-v021-real-e2e-report.schema.json"), "utf8")) as object;
  const ajv = new Ajv2020Module.default({ allErrors: true, strict: true, strictRequired: false });
  addFormatsModule.default(ajv);
  const validateDriver = ajv.compile(driverSchema);
  const validateReport = ajv.compile(reportSchema);
  return {
    validateReport,
    validateDriver,
    errors: () => ajv.errorsText(validateReport.errors ?? validateDriver.errors, { separator: "; " })
  };
}

describe("GDPS v0.2.1 frozen E2E corpus policy", () => {
  it("locks the exact bytes, exact ordered IDs, and all eight discriminated case classes", () => {
    const corpus = parseGdpsV021Corpus(corpusBytes());
    expect(corpus.hash).toBe(GDPS_V021_E2E_CORPUS_HASH);
    expect(Object.isFrozen(corpus.cases)).toBe(true);
    expect(corpus.cases.every((entry) => Object.isFrozen(entry) && Object.isFrozen(entry.expectedOperationKeys))).toBe(true);
    expect(corpus.cases.map((entry) => entry.id)).toEqual(GDPS_V021_E2E_CASE_IDS);
    expect(corpus.cases.filter((entry) => entry.caseType === "POSITIVE")).toHaveLength(9);
    expect(new Set(corpus.cases.map((entry) => entry.caseType))).toEqual(new Set([
      "POSITIVE", "DESCRIPTOR_GAP", "DATA_GAP", "REFERENCE_AMBIGUITY", "UNIT_MISMATCH", "RECIPE_DRIFT",
      "TRUNCATED", "CURRENTNESS"
    ]));
    expect(corpus.cases.find((entry) => entry.id === "E2E-EXPLICIT-PRODUCT")).toMatchObject({
      expectedExplicitProductId: "gdps-baseline-slope",
      expectedOperationKeys: ["reference.resolve@1.0", "world.get-geometry@1.0", "geo-raster.find-by-range@1.0"]
    });
    expect(corpus.cases.find((entry) => entry.id === "NEG-CURRENTNESS")).toMatchObject({
      caseType: "CURRENTNESS",
      expectedTerminalStatus: "UNRESOLVED",
      expectedNormalizedStatus: "STALE",
      expectedSourceCondition: "CHANGED",
      expectedSemanticCode: "SNAPSHOT_MISMATCHED",
      expectedOperationKeys: ["geo-product.check-current@1.0"],
      mustNotExecuteOriginalQuery: true
    });
  });

  it("fails closed on any byte or case-order drift", () => {
    const altered = Buffer.from(corpusBytes());
    altered[altered.length - 2] = 0x20;
    expect(() => parseGdpsV021Corpus(altered)).toThrow("GDPS_V021_E2E_CORPUS_HASH_DRIFT");
    const reordered = corpusBytes().toString("utf8").replace("E2E-SLOPE-POINT", "E2E-SLOPE-RANGE");
    expect(() => parseGdpsV021Corpus(reordered)).toThrow("GDPS_V021_E2E_CORPUS_HASH_DRIFT");
  });

  it("recognizes exactly 30 allowed operations and reports forbidden GDPS names or versions", () => {
    expect(GDPS_V021_OPERATION_KEYS).toHaveLength(30);
    expect(new Set(GDPS_V021_OPERATION_KEYS).size).toBe(30);
    expect(findForbiddenGdpsOperations([
      "reference.resolve@1.0",
      "geo-raster.sample@1.0",
      "geo-raster.sample@2.0",
      "geo-raster.secret@1.0",
      "spatial.find-nearby@1.0"
    ])).toEqual(["geo-raster.sample@2.0", "geo-raster.secret@1.0"]);
  });
});

describe("GDPS v0.2.1 case evidence evaluation", () => {
  it("locks W43 strict, BEST_EFFORT, data-gap, and second-source-change status mappings", () => {
    expect(gdpsV021CurrentnessStatus("STRICT_CHANGED")).toEqual({
      terminalStatus: "UNRESOLVED",
      normalizedStatus: "STALE",
      sourceCondition: "CHANGED",
      semanticCode: "SNAPSHOT_MISMATCHED",
      retryPolicy: "NONE"
    });
    expect(gdpsV021CurrentnessStatus("BEST_EFFORT_SOURCE_ADVANCED")).toEqual({
      terminalStatus: "COMPLETED",
      normalizedStatus: "CURRENT",
      sourceCondition: "CHANGED",
      semanticCode: "SOURCE_ADVANCED",
      retryPolicy: "NONE"
    });
    expect(gdpsV021CurrentnessStatus("NOT_AVAILABLE")).toMatchObject({
      terminalStatus: "UNRESOLVED",
      normalizedStatus: "DATA_GAP",
      semanticCode: "DATA_GAP"
    });
    expect(gdpsV021CurrentnessStatus("SOURCE_CHANGED_DURING_QUERY")).toEqual({
      terminalStatus: "INDETERMINATE",
      normalizedStatus: "INDETERMINATE",
      sourceCondition: "SOURCE_CHANGED_DURING_QUERY",
      semanticCode: "SOURCE_CHANGED",
      retryPolicy: "ONCE"
    });
  });

  it("accepts exact positive, negative, truncated, and currentness evidence", () => {
    const corpus = parseGdpsV021Corpus(corpusBytes());
    const input = reportInput(corpus);
    const context = evidenceContext(input);
    for (const expected of corpus.cases) {
      const observed = input.observations.find((entry) => entry.caseId === expected.id)!;
      expect(evaluateGdpsV021Case(expected, observed, context)).toMatchObject({ status: "PASS", reasons: [] });
    }
  });

  it("keeps terminal, normalized, source-condition, and semantic currentness states distinct", () => {
    const corpus = parseGdpsV021Corpus(corpusBytes());
    const input = reportInput(corpus);
    const expected = corpus.cases.find((entry) => entry.id === "NEG-CURRENTNESS")!;
    const observed = input.observations.find((entry) => entry.caseId === expected.id)!;
    expect(observed).toMatchObject({
      terminalStatus: "UNRESOLVED",
      normalizedStatus: "STALE",
      sourceCondition: "CHANGED",
      semanticCode: "SNAPSHOT_MISMATCHED",
      currentness: "CHANGED"
    });
    const result = evaluateGdpsV021Case(expected, {
      ...observed,
      terminalStatus: "COMPLETED"
    }, evidenceContext(input));
    expect(result.status).toBe("FAIL");
    expect(result.reasons).toContain("TERMINAL_STATUS_MISMATCH");

    const report = structuredClone(evaluateGdpsV021Report(corpus, input)) as unknown as {
      cases: Array<{ observation: Record<string, unknown> | null }>;
    };
    report.cases[15]!.observation!["terminalStatus"] = "SNAPSHOT_MISMATCHED";
    const { validateReport, errors } = validators();
    expect(validateReport(report), errors()).toBe(false);
  });

  it("requires complete descriptor/product/profile/snapshot/receipt/evidence/quality binding", () => {
    const corpus = parseGdpsV021Corpus(corpusBytes());
    const input = reportInput(corpus);
    const expected = corpus.cases.find((entry) => entry.id === "E2E-SLOPE-POINT")!;
    const observed = input.observations.find((entry) => entry.caseId === expected.id)!;
    const result = evaluateGdpsV021Case(expected, {
      ...observed,
      productEvidence: {
        ...observed.productEvidence!,
        productType: "FLOOD_RISK",
        productProfile: "FLOOD_RISK_CLASS",
        queryProfile: "FIND_CLASS",
        dataSnapshotHash: digest("not-the-data-snapshot"),
        computeSnapshot: {},
        receiptIds: [],
        evidenceIds: [],
        quality: {},
        currentContentHash: null
      }
    }, evidenceContext(input));
    expect(result.status).toBe("FAIL");
    expect(result.reasons).toEqual(expect.arrayContaining([
      "PRODUCT_TYPE_MISMATCH",
      "PRODUCT_PROFILE_MISMATCH",
      "PRODUCT_QUERY_PROFILE_MISMATCH",
      "PRODUCT_DATA_SNAPSHOT_BINDING_MISSING",
      "PRODUCT_COMPUTE_SNAPSHOT_BINDING_MISSING",
      "PRODUCT_RECEIPT_IDS_MISSING",
      "PRODUCT_EVIDENCE_IDS_MISSING",
      "PRODUCT_QUALITY_BINDING_MISSING",
      "CURRENT_PRODUCT_HASH_NOT_BOUND"
    ]));
  });

  it("detects operation, semantic, explicit-product, and no-false-inference violations", () => {
    const corpus = parseGdpsV021Corpus(corpusBytes());
    const input = reportInput(corpus);
    const context = evidenceContext(input);
    const explicit = corpus.cases.find((entry) => entry.id === "E2E-EXPLICIT-PRODUCT")!;
    const badExplicit = input.observations.find((entry) => entry.caseId === explicit.id)!;
    const explicitResult = evaluateGdpsV021Case(explicit, {
      ...badExplicit,
      operationKeys: [...badExplicit.operationKeys.slice(0, -1), "geo-raster.secret@1.0"],
      gdpsOperationKeys: ["geo-raster.secret@1.0"],
      semanticCode: "WRONG",
      productEvidence: { ...badExplicit.productEvidence!, productId: "gdps-other-product" }
    }, context);
    expect(explicitResult.status).toBe("FAIL");
    expect(explicitResult.reasons).toEqual(expect.arrayContaining([
      "OPERATION_CHAIN_MISMATCH",
      "FORBIDDEN_GDPS_OPERATION:geo-raster.secret@1.0",
      "SEMANTIC_CODE_MISMATCH",
      "EXPLICIT_PRODUCT_ID_MISMATCH"
    ]));

    const dataGap = corpus.cases.find((entry) => entry.id === "NEG-DATA-GAP")!;
    const dataGapObservation = input.observations.find((entry) => entry.caseId === dataGap.id)!;
    const badGap = evaluateGdpsV021Case(dataGap, { ...dataGapObservation, falseFactInferred: true }, context);
    expect(badGap).toMatchObject({ status: "FAIL" });
    expect(badGap.reasons).toContain("NEGATIVE_FACT_INFERRED_FROM_DATA_GAP");
  });

  it("marks a driven case BLOCKED when real isolated driver attestation is absent", () => {
    const corpus = parseGdpsV021Corpus(corpusBytes());
    const input = reportInput(corpus);
    const expected = corpus.cases.find((entry) => entry.id === "NEG-RECIPE-DRIFT")!;
    const observed = input.observations.find((entry) => entry.caseId === expected.id)!;
    const result = evaluateGdpsV021Case(expected, { ...observed, driverAttestation: null }, evidenceContext(input));
    expect(result).toMatchObject({ status: "BLOCKED", reasons: ["DRIVER_ATTESTATION_REQUIRED"] });
  });
});

describe("GDPS v0.2.1 machine-valid report policy", () => {
  it("permits overall PASS only for 16 exact cases plus W44-X01 through W44-X12", () => {
    const corpus = parseGdpsV021Corpus(corpusBytes());
    const report = evaluateGdpsV021Report(corpus, reportInput(corpus));
    expect(report).toMatchObject({
      overallStatus: "PASS",
      policyErrors: [],
      summary: { totalCases: 16, passedCases: 16, requiredQualifications: 12, passedQualifications: 12 }
    });
    const { validateReport, errors } = validators();
    expect(validateReport(report), errors()).toBe(true);
  });

  it("stays BLOCKED when all 16 cases pass but W44-X01 through W44-X12 are absent", () => {
    const corpus = parseGdpsV021Corpus(corpusBytes());
    const report = evaluateGdpsV021Report(corpus, reportInput(corpus, false));
    expect(report.overallStatus).toBe("BLOCKED");
    expect(report.summary).toMatchObject({ passedCases: 16, passedQualifications: 0 });
    expect(report.qualifications).toHaveLength(12);
    expect(report.qualifications.every((entry) => entry.status === "NOT_RUN")).toBe(true);
    const { validateReport, errors } = validators();
    expect(validateReport(report), errors()).toBe(true);
    const falsePass = { ...structuredClone(report), overallStatus: "PASS" };
    expect(validateReport(falsePass), errors()).toBe(false);
  });

  it("fails a claimed real report when it uses a mock or direct Provider path", () => {
    const corpus = parseGdpsV021Corpus(corpusBytes());
    const input = reportInput(corpus);
    const report = evaluateGdpsV021Report(corpus, {
      ...input,
      execution: { ...input.execution, gatewayOnly: false, directProviderCalls: 1, mockTransportUsed: true }
    });
    expect(report.overallStatus).toBe("FAIL");
    expect(report.policyErrors).toContain("REAL_GATEWAY_ONLY_EXECUTION_NOT_PROVEN");
  });

  it("rejects an arbitrary digest that is not the byte-verified ledger record hash", () => {
    const corpus = parseGdpsV021Corpus(corpusBytes());
    const input = reportInput(corpus);
    const target = input.observations[0]!;
    const report = evaluateGdpsV021Report(corpus, {
      ...input,
      observations: input.observations.map((entry) => entry.caseId === target.caseId
        ? { ...entry, evidenceHashes: [digest("fabricated-unbound-digest")] }
        : entry)
    });
    expect(report.overallStatus).toBe("FAIL");
    expect(report.cases[0]).toMatchObject({ status: "FAIL" });
    expect(report.cases[0]!.reasons).toContain(`CASE_EVIDENCE_ARTIFACT_HASH_MISMATCH:${target.evidenceArtifactIds[0]}`);
  });

  it("rejects a referenced artifact omitted from the ledger and an artifact with the wrong case subject", () => {
    const corpus = parseGdpsV021Corpus(corpusBytes());
    const input = reportInput(corpus);
    const target = input.observations[0]!;
    const targetArtifactId = target.evidenceArtifactIds[0]!;
    const omitted = evaluateGdpsV021Report(corpus, {
      ...input,
      evidenceLedger: {
        ...input.evidenceLedger,
        artifacts: input.evidenceLedger.artifacts.filter((entry) => entry.id !== targetArtifactId)
      }
    });
    expect(omitted.overallStatus).toBe("FAIL");
    expect(omitted.cases[0]!.reasons).toContain(`CASE_EVIDENCE_ARTIFACT_NOT_LEDGERED:${targetArtifactId}`);

    const wrongSubject = evaluateGdpsV021Report(corpus, {
      ...input,
      evidenceLedger: {
        ...input.evidenceLedger,
        artifacts: input.evidenceLedger.artifacts.map((entry) => entry.id === targetArtifactId
          ? { ...entry, subject: "E2E-SLOPE-RANGE" as const }
          : entry)
      }
    });
    expect(wrongSubject.overallStatus).toBe("FAIL");
    expect(wrongSubject.cases[0]!.reasons).toContain(`CASE_EVIDENCE_ARTIFACT_SUBJECT_MISMATCH:${targetArtifactId}`);
  });

  it("rejects qualification cross-reuse and never counts a shared fake artifact as two W44 passes", () => {
    const corpus = parseGdpsV021Corpus(corpusBytes());
    const input = reportInput(corpus);
    const first = input.qualifications[0]!;
    const second = input.qualifications[1]!;
    const report = evaluateGdpsV021Report(corpus, {
      ...input,
      qualifications: input.qualifications.map((entry) => entry.qualificationId === second.qualificationId
        ? {
          ...entry,
          evidenceArtifactIds: [...first.evidenceArtifactIds],
          evidenceHashes: [...first.evidenceHashes]
        }
        : entry)
    });
    expect(report.overallStatus).toBe("FAIL");
    expect(report.qualifications[1]!.status).toBe("FAIL");
    expect(report.policyErrors).toEqual(expect.arrayContaining([
      expect.stringContaining("QUALIFICATION_EVIDENCE_ARTIFACT_SUBJECT_MISMATCH"),
      `EVIDENCE_ARTIFACT_REFERENCE_REUSED:${first.evidenceArtifactIds[0]}`,
      `UNREFERENCED_EVIDENCE_ARTIFACT:${second.evidenceArtifactIds[0]}`
    ]));
  });

  it("requires all three distinct driver artifact kinds for the exact driven case", () => {
    const corpus = parseGdpsV021Corpus(corpusBytes());
    const input = reportInput(corpus);
    const expected = corpus.cases.find((entry) => entry.id === "NEG-CURRENTNESS")!;
    const target = input.observations.find((entry) => entry.caseId === expected.id)!;
    const artifactIds = gdpsV021DriverArtifactIds(target.driverAttestation!.caseId);
    const report = evaluateGdpsV021Report(corpus, {
      ...input,
      evidenceLedger: {
        ...input.evidenceLedger,
        artifacts: input.evidenceLedger.artifacts.map((entry) => entry.id === artifactIds.implementation
          ? { ...entry, kind: "DRIVER_EVIDENCE" as const }
          : entry)
      }
    });
    const evaluated = report.cases.find((entry) => entry.caseId === expected.id)!;
    expect(report.overallStatus).toBe("FAIL");
    expect(evaluated.status).toBe("BLOCKED");
    expect(evaluated.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("DRIVER_ARTIFACT_KIND_MISMATCH:DRIVER_IMPLEMENTATION")
    ]));
  });

  it("rejects duplicate, unreferenced, path-escape, legacy-path, and stale binding records", () => {
    const corpus = parseGdpsV021Corpus(corpusBytes());
    const input = reportInput(corpus);
    const first = input.evidenceLedger.artifacts[0]!;
    const duplicate: GdpsV021EvidenceArtifactRecord = {
      ...first,
      id: "artifact-unreferenced-duplicate",
      repoRelativePath: "reports/wsgs-v0.2-gdps-v0.2.1/evidence/unreferenced-duplicate.json"
    };
    const duplicateReport = evaluateGdpsV021Report(corpus, {
      ...input,
      evidenceLedger: { ...input.evidenceLedger, artifacts: [...input.evidenceLedger.artifacts, duplicate] }
    });
    expect(duplicateReport.overallStatus).toBe("FAIL");
    expect(duplicateReport.policyErrors).toEqual(expect.arrayContaining([
      `DUPLICATE_EVIDENCE_ARTIFACT_HASH:${duplicate.id}`,
      `UNREFERENCED_EVIDENCE_ARTIFACT:${duplicate.id}`
    ]));

    for (const repoRelativePath of [
      "reports/wsgs-v0.2-gdps-v0.2.1/../escaped.json",
      "reports/wsgs-v0.2-gdps/legacy.json"
    ]) {
      const pathReport = evaluateGdpsV021Report(corpus, {
        ...input,
        evidenceLedger: {
          ...input.evidenceLedger,
          artifacts: input.evidenceLedger.artifacts.map((entry) => entry.id === first.id
            ? { ...entry, repoRelativePath }
            : entry)
        }
      });
      expect(pathReport.overallStatus).toBe("FAIL");
      expect(pathReport.policyErrors).toContain(`EVIDENCE_ARTIFACT_PATH_NOT_AUTHORIZED:${first.id}`);
    }

    const staleBindingReport = evaluateGdpsV021Report(corpus, {
      ...input,
      evidenceLedger: {
        ...input.evidenceLedger,
        artifacts: input.evidenceLedger.artifacts.map((entry) => entry.id === first.id
          ? {
            ...entry,
            sourceBinding: { ...entry.sourceBinding, wsgsCommit: "a".repeat(40) },
            runtimeBinding: { ...entry.runtimeBinding, runtimeIdentityHash: digest("wrong-runtime") },
            operationLockHash: digest("wrong-operation-lock")
          }
          : entry)
      }
    });
    expect(staleBindingReport.overallStatus).toBe("FAIL");
    expect(staleBindingReport.policyErrors).toEqual(expect.arrayContaining([
      `EVIDENCE_ARTIFACT_SOURCE_BINDING_MISMATCH:${first.id}`,
      `EVIDENCE_ARTIFACT_RUNTIME_BINDING_MISMATCH:${first.id}`,
      `EVIDENCE_ARTIFACT_OPERATION_LOCK_BINDING_MISMATCH:${first.id}`
    ]));
  });

  it("validates the driver schema and rejects a case-to-driver mismatch", () => {
    const corpus = parseGdpsV021Corpus(corpusBytes());
    const input = reportInput(corpus);
    const expected = corpus.cases.find((entry) => entry.id === "NEG-TRUNCATED")!;
    const valid = input.observations.find((entry) => entry.caseId === expected.id)!.driverAttestation!;
    const { validateDriver, errors } = validators();
    expect(validateDriver(valid), errors()).toBe(true);
    expect(validateDriver({ ...valid, driverKind: "STORED_HASH_DIFFERS_FROM_CURRENT" }), errors()).toBe(false);
  });

  it("rejects structurally incomplete reports and unsupported PASS evidence", () => {
    const corpus = parseGdpsV021Corpus(corpusBytes());
    const report = evaluateGdpsV021Report(corpus, reportInput(corpus));
    const { validateReport, errors } = validators();
    const missingQualification = structuredClone(report) as unknown as { qualifications: unknown[] };
    missingQualification.qualifications.pop();
    expect(validateReport(missingQualification), errors()).toBe(false);
    const reordered = structuredClone(report) as unknown as { cases: unknown[] };
    [reordered.cases[0], reordered.cases[1]] = [reordered.cases[1], reordered.cases[0]];
    expect(validateReport(reordered), errors()).toBe(false);
    const noEvidence = structuredClone(report) as unknown as {
      qualifications: Array<{ evidenceArtifactIds: string[]; evidenceHashes: GdpsV021Sha256Digest[] }>;
    };
    noEvidence.qualifications[0]!.evidenceArtifactIds = [];
    noEvidence.qualifications[0]!.evidenceHashes = [];
    expect(validateReport(noEvidence), errors()).toBe(false);
  });
});
