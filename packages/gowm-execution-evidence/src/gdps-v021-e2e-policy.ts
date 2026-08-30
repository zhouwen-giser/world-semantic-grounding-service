import { createHash } from "node:crypto";

import { canonicalSha256 } from "./canonical.js";

export const GDPS_V021_E2E_CORPUS_HASH =
  "sha256:b9717b9af929fbd82bf0509f9648379aae601a8a0f567ce1d520ad970a8f6525" as const;

export const GDPS_V021_E2E_CASE_IDS = Object.freeze([
  "E2E-SLOPE-POINT",
  "E2E-SLOPE-RANGE",
  "E2E-FLOOD-HIGH",
  "E2E-DRAINAGE-NEARBY",
  "E2E-HIGH-GROUND",
  "E2E-WETLAND",
  "E2E-LAND-COVER",
  "E2E-TRAVERSABILITY-EXPLAIN",
  "E2E-EXPLICIT-PRODUCT",
  "NEG-DESCRIPTOR-GAP",
  "NEG-DATA-GAP",
  "NEG-REFERENCE-AMBIGUITY",
  "NEG-UNIT-MISMATCH",
  "NEG-RECIPE-DRIFT",
  "NEG-TRUNCATED",
  "NEG-CURRENTNESS"
] as const);

export const GDPS_V021_QUALIFICATION_IDS = Object.freeze([
  "W44-X01",
  "W44-X02",
  "W44-X03",
  "W44-X04",
  "W44-X05",
  "W44-X06",
  "W44-X07",
  "W44-X08",
  "W44-X09",
  "W44-X10",
  "W44-X11",
  "W44-X12"
] as const);

export const GDPS_V021_OPERATION_KEYS = Object.freeze([
  "geo-product.get@1.0",
  "geo-product.search@1.0",
  "geo-product.check-current@1.0",
  "elevation.sample@1.0",
  "elevation.profile@1.0",
  "elevation.sample-surface@1.0",
  "terrain.get-class@1.0",
  "terrain.find-by-class@1.0",
  "terrain.find-high-ground@1.0",
  "terrain.find-depressions@1.0",
  "landcover.get-class@1.0",
  "landcover.find-by-class@1.0",
  "hydrology.find-water@1.0",
  "hydrology.find-wetlands@1.0",
  "surface-material.get@1.0",
  "surface-material.find-by-class@1.0",
  "obstacle.find-buildings@1.0",
  "obstacle.find-nearby@1.0",
  "obstacle.find-intersections@1.0",
  "traversability.get@1.0",
  "traversability.find-passable@1.0",
  "traversability.find-blocked@1.0",
  "traversability.explain@1.0",
  "geo-raster.sample@1.0",
  "geo-raster.profile@1.0",
  "geo-raster.find-by-class@1.0",
  "geo-raster.find-by-range@1.0",
  "geo-vector.find-in-area@1.0",
  "geo-vector.find-nearby@1.0",
  "geo-vector.find-intersections@1.0"
] as const);

export type GdpsV021CaseId = typeof GDPS_V021_E2E_CASE_IDS[number];
export type GdpsV021QualificationId = typeof GDPS_V021_QUALIFICATION_IDS[number];
export type GdpsV021OperationKey = typeof GDPS_V021_OPERATION_KEYS[number];
export type GdpsV021Sha256Digest = `sha256:${string}`;

export type GdpsV021EvidenceArtifactKind =
  | "CASE_EVIDENCE"
  | "DRIVER_ATTESTATION"
  | "DRIVER_IMPLEMENTATION"
  | "DRIVER_EVIDENCE"
  | "QUALIFICATION_EVIDENCE";

export type GdpsV021EvidenceSubject = GdpsV021CaseId | GdpsV021QualificationId;

export type GdpsV021CaseType =
  | "POSITIVE"
  | "DESCRIPTOR_GAP"
  | "DATA_GAP"
  | "REFERENCE_AMBIGUITY"
  | "UNIT_MISMATCH"
  | "RECIPE_DRIFT"
  | "TRUNCATED"
  | "CURRENTNESS";

export type GdpsV021TerminalStatus =
  | "COMPLETED"
  | "UNRESOLVED"
  | "AMBIGUOUS"
  | "PARTIAL"
  | "INDETERMINATE"
  | "FAILED";

export type GdpsV021NormalizedStatus =
  | "CURRENT"
  | "STALE"
  | "DATA_GAP"
  | "CAPABILITY_GAP"
  | "COVERAGE_GAP"
  | "AMBIGUOUS"
  | "PARTIAL"
  | "INDETERMINATE"
  | "FAILED";

export type GdpsV021CurrentnessSourceCondition =
  | "CURRENT"
  | "CHANGED"
  | "PRODUCT_NOT_AVAILABLE"
  | "SOURCE_CHANGED_DURING_QUERY";

export interface GdpsV021CurrentnessStatusMapping {
  readonly terminalStatus: GdpsV021TerminalStatus;
  readonly normalizedStatus: "CURRENT" | "STALE" | "DATA_GAP" | "INDETERMINATE";
  readonly sourceCondition: GdpsV021CurrentnessSourceCondition;
  readonly semanticCode: "OK" | "SNAPSHOT_MISMATCHED" | "DATA_GAP" | "SOURCE_ADVANCED" | "SOURCE_CHANGED";
  readonly retryPolicy: "NONE" | "ONCE";
}

export function gdpsV021CurrentnessStatus(
  condition: "STRICT_CURRENT" | "STRICT_CHANGED" | "NOT_AVAILABLE" |
    "BEST_EFFORT_SOURCE_ADVANCED" | "SOURCE_CHANGED_DURING_QUERY"
): Readonly<GdpsV021CurrentnessStatusMapping> {
  switch (condition) {
    case "STRICT_CURRENT":
      return Object.freeze({ terminalStatus: "COMPLETED", normalizedStatus: "CURRENT",
        sourceCondition: "CURRENT", semanticCode: "OK", retryPolicy: "NONE" });
    case "STRICT_CHANGED":
      return Object.freeze({ terminalStatus: "UNRESOLVED", normalizedStatus: "STALE",
        sourceCondition: "CHANGED", semanticCode: "SNAPSHOT_MISMATCHED", retryPolicy: "NONE" });
    case "NOT_AVAILABLE":
      return Object.freeze({ terminalStatus: "UNRESOLVED", normalizedStatus: "DATA_GAP",
        sourceCondition: "PRODUCT_NOT_AVAILABLE", semanticCode: "DATA_GAP", retryPolicy: "NONE" });
    case "BEST_EFFORT_SOURCE_ADVANCED":
      return Object.freeze({ terminalStatus: "COMPLETED", normalizedStatus: "CURRENT",
        sourceCondition: "CHANGED", semanticCode: "SOURCE_ADVANCED", retryPolicy: "NONE" });
    case "SOURCE_CHANGED_DURING_QUERY":
      return Object.freeze({ terminalStatus: "INDETERMINATE", normalizedStatus: "INDETERMINATE",
        sourceCondition: "SOURCE_CHANGED_DURING_QUERY", semanticCode: "SOURCE_CHANGED", retryPolicy: "ONCE" });
  }
}

export type GdpsV021DriverKind =
  | "CURRENT_PRODUCT_ABSENT"
  | "RECIPE_SEMANTIC_HASH_ALTERED"
  | "UPSTREAM_TRUNCATED_TRUE"
  | "STORED_HASH_DIFFERS_FROM_CURRENT";

type ProductExpectation = "PRESENT" | "EXACT_ID" | "ABSENT" | "CURRENTNESS_CHANGE";

export interface GdpsV021ExpectedProductBinding {
  readonly descriptorId: string;
  readonly productType: string;
  readonly productProfile: string;
  readonly queryProfile: string;
}

interface GdpsV021CaseBase {
  readonly id: GdpsV021CaseId;
  readonly caseType: GdpsV021CaseType;
  readonly message: string;
  readonly expectedTerminalStatus: GdpsV021TerminalStatus;
  readonly expectedNormalizedStatus: GdpsV021NormalizedStatus;
  readonly expectedSourceCondition: string | null;
  readonly expectedSemanticPattern: string | null;
  readonly expectedDescriptorId: string | null;
  readonly expectedProductBinding: GdpsV021ExpectedProductBinding | null;
  readonly expectedOperationKeys: readonly string[];
  readonly expectedSemanticCode: string | null;
  readonly productExpectation: ProductExpectation;
  readonly expectedExplicitProductId: string | null;
  readonly requiredDriverKind: GdpsV021DriverKind | null;
  readonly mustNotInferFalse: boolean;
  readonly mustNotExecuteOriginalQuery: boolean;
  readonly requiresRecipeEvidence: boolean;
  readonly requiresPlanEvidence: boolean;
  readonly requiresOperationLockEvidence: boolean;
}

export interface GdpsV021PositiveCase extends GdpsV021CaseBase {
  readonly caseType: "POSITIVE";
  readonly id:
    | "E2E-SLOPE-POINT"
    | "E2E-SLOPE-RANGE"
    | "E2E-FLOOD-HIGH"
    | "E2E-DRAINAGE-NEARBY"
    | "E2E-HIGH-GROUND"
    | "E2E-WETLAND"
    | "E2E-LAND-COVER"
    | "E2E-TRAVERSABILITY-EXPLAIN"
    | "E2E-EXPLICIT-PRODUCT";
  readonly expectedTerminalStatus: "COMPLETED";
  readonly expectedNormalizedStatus: "CURRENT";
  readonly productExpectation: "PRESENT" | "EXACT_ID";
  readonly requiredDriverKind: null;
}

export interface GdpsV021DescriptorGapCase extends GdpsV021CaseBase {
  readonly caseType: "DESCRIPTOR_GAP";
  readonly id: "NEG-DESCRIPTOR-GAP";
  readonly expectedTerminalStatus: "UNRESOLVED";
  readonly expectedNormalizedStatus: "CAPABILITY_GAP";
  readonly expectedSemanticCode: "DESCRIPTOR_GAP";
  readonly productExpectation: "ABSENT";
}

export interface GdpsV021DataGapCase extends GdpsV021CaseBase {
  readonly caseType: "DATA_GAP";
  readonly id: "NEG-DATA-GAP";
  readonly expectedTerminalStatus: "UNRESOLVED";
  readonly expectedNormalizedStatus: "DATA_GAP";
  readonly expectedSemanticCode: "DATA_GAP";
  readonly productExpectation: "ABSENT";
  readonly requiredDriverKind: "CURRENT_PRODUCT_ABSENT";
  readonly mustNotInferFalse: true;
}

export interface GdpsV021ReferenceAmbiguityCase extends GdpsV021CaseBase {
  readonly caseType: "REFERENCE_AMBIGUITY";
  readonly id: "NEG-REFERENCE-AMBIGUITY";
  readonly expectedTerminalStatus: "AMBIGUOUS";
  readonly expectedNormalizedStatus: "AMBIGUOUS";
  readonly productExpectation: "ABSENT";
}

export interface GdpsV021UnitMismatchCase extends GdpsV021CaseBase {
  readonly caseType: "UNIT_MISMATCH";
  readonly id: "NEG-UNIT-MISMATCH";
  readonly expectedTerminalStatus: "UNRESOLVED";
  readonly expectedNormalizedStatus: "INDETERMINATE";
  readonly expectedSemanticCode: "UNIT_MISMATCH";
  readonly productExpectation: "ABSENT";
}

export interface GdpsV021RecipeDriftCase extends GdpsV021CaseBase {
  readonly caseType: "RECIPE_DRIFT";
  readonly id: "NEG-RECIPE-DRIFT";
  readonly expectedTerminalStatus: "UNRESOLVED";
  readonly expectedNormalizedStatus: "CAPABILITY_GAP";
  readonly expectedSemanticCode: "RECIPE_LOCK_DRIFT";
  readonly productExpectation: "ABSENT";
  readonly requiredDriverKind: "RECIPE_SEMANTIC_HASH_ALTERED";
}

export interface GdpsV021TruncatedCase extends GdpsV021CaseBase {
  readonly caseType: "TRUNCATED";
  readonly id: "NEG-TRUNCATED";
  readonly expectedTerminalStatus: "PARTIAL";
  readonly expectedNormalizedStatus: "PARTIAL";
  readonly expectedSemanticCode: "RESULT_TRUNCATED";
  readonly productExpectation: "PRESENT";
  readonly requiredDriverKind: "UPSTREAM_TRUNCATED_TRUE";
}

export interface GdpsV021CurrentnessCase extends GdpsV021CaseBase {
  readonly caseType: "CURRENTNESS";
  readonly id: "NEG-CURRENTNESS";
  readonly expectedTerminalStatus: "UNRESOLVED";
  readonly expectedNormalizedStatus: "STALE";
  readonly expectedSourceCondition: "CHANGED";
  readonly expectedSemanticCode: "SNAPSHOT_MISMATCHED";
  readonly productExpectation: "CURRENTNESS_CHANGE";
  readonly requiredDriverKind: "STORED_HASH_DIFFERS_FROM_CURRENT";
  readonly mustNotExecuteOriginalQuery: true;
}

export type GdpsV021Case =
  | GdpsV021PositiveCase
  | GdpsV021DescriptorGapCase
  | GdpsV021DataGapCase
  | GdpsV021ReferenceAmbiguityCase
  | GdpsV021UnitMismatchCase
  | GdpsV021RecipeDriftCase
  | GdpsV021TruncatedCase
  | GdpsV021CurrentnessCase;

export interface GdpsV021Corpus {
  readonly schemaVersion: "wsgs-gdps-e2e-corpus/2.0";
  readonly requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY";
  readonly hash: typeof GDPS_V021_E2E_CORPUS_HASH;
  readonly cases: readonly GdpsV021Case[];
}

export interface GdpsV021DriverAttestation {
  readonly schemaVersion: "wsgs-gdps-e2e-driver-attestation/2.0";
  readonly caseId: "NEG-DATA-GAP" | "NEG-RECIPE-DRIFT" | "NEG-TRUNCATED" | "NEG-CURRENTNESS";
  readonly driverKind: GdpsV021DriverKind;
  readonly sourceCommit: string;
  readonly handoffBundleHash: GdpsV021Sha256Digest;
  readonly operationLockHash: GdpsV021Sha256Digest;
  readonly provenanceHash: GdpsV021Sha256Digest;
  readonly runtimeIdentityHash: GdpsV021Sha256Digest;
  readonly sharedRuntimeBeforeHash: GdpsV021Sha256Digest;
  readonly sharedRuntimeAfterHash: GdpsV021Sha256Digest;
  readonly executionEnvironment: "ISOLATED_REAL_RUNTIME";
  readonly requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY";
  readonly realExternalDependencies: true;
  readonly mockTransportUsed: false;
  readonly sharedRuntimeMutated: false;
  readonly precondition: Readonly<Record<string, unknown>>;
  readonly preconditionHash: GdpsV021Sha256Digest;
  readonly driverImplementationHash: GdpsV021Sha256Digest;
  readonly evidenceHash: GdpsV021Sha256Digest;
}

export interface GdpsV021ProductEvidence {
  readonly productId: string;
  readonly contentHash: GdpsV021Sha256Digest;
  readonly currentContentHash: GdpsV021Sha256Digest | null;
  readonly descriptorId: string;
  readonly descriptorHash: GdpsV021Sha256Digest;
  readonly productType: string;
  readonly productProfile: string;
  readonly queryProfile: string;
  readonly sourceOperationKey: GdpsV021OperationKey;
  readonly dataSnapshot: Readonly<Record<string, unknown>>;
  readonly dataSnapshotHash: GdpsV021Sha256Digest;
  readonly computeSnapshot: Readonly<Record<string, unknown>>;
  readonly computeSnapshotHash: GdpsV021Sha256Digest;
  readonly receiptIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly quality: Readonly<Record<string, unknown>>;
  readonly qualityHash: GdpsV021Sha256Digest;
  readonly truncated: boolean;
}

export interface GdpsV021CaseObservation {
  readonly caseId: GdpsV021CaseId;
  readonly terminalStatus: GdpsV021TerminalStatus;
  readonly normalizedStatus: GdpsV021NormalizedStatus;
  readonly sourceCondition: string | null;
  readonly semanticPattern: string | null;
  readonly descriptorId: string | null;
  readonly operationKeys: readonly string[];
  readonly gdpsOperationKeys: readonly string[];
  readonly semanticCode: string | null;
  readonly recipeId: string | null;
  readonly recipeLockHash: GdpsV021Sha256Digest | null;
  readonly descriptorHash: GdpsV021Sha256Digest | null;
  readonly planHash: GdpsV021Sha256Digest | null;
  readonly operationLockHash: GdpsV021Sha256Digest | null;
  readonly productEvidence: GdpsV021ProductEvidence | null;
  readonly currentness: "CURRENT" | "CHANGED" | "NOT_AVAILABLE" | null;
  readonly truncated: boolean;
  readonly falseFactInferred: boolean;
  readonly originalQueryExecuted: boolean;
  readonly evidenceArtifactIds: readonly string[];
  readonly evidenceHashes: readonly GdpsV021Sha256Digest[];
  readonly driverAttestation: GdpsV021DriverAttestation | null;
}

export type GdpsV021EvidenceStatus = "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED";

export interface GdpsV021CaseEvaluation {
  readonly caseId: GdpsV021CaseId;
  readonly caseType: GdpsV021CaseType;
  readonly status: GdpsV021EvidenceStatus;
  readonly reasons: readonly string[];
  readonly observation: GdpsV021CaseObservation | null;
}

export interface GdpsV021QualificationEvidence {
  readonly qualificationId: GdpsV021QualificationId;
  readonly status: GdpsV021EvidenceStatus;
  readonly evidenceArtifactIds: readonly string[];
  readonly evidenceHashes: readonly GdpsV021Sha256Digest[];
  readonly detail: string;
}

export interface GdpsV021EvidenceArtifactRecord {
  readonly id: string;
  readonly kind: GdpsV021EvidenceArtifactKind;
  readonly subject: GdpsV021EvidenceSubject;
  readonly repoRelativePath: string;
  readonly hash: GdpsV021Sha256Digest;
  readonly byteLength: number;
  /** Set only by the runtime preflight after hashing the file bytes at repoRelativePath. */
  readonly byteVerified: true;
  readonly sourceBinding: {
    readonly wsgsCommit: string;
    readonly gdpsCommit: string;
    readonly gowmIdentityHash: GdpsV021Sha256Digest;
    readonly handoffBundleHash: GdpsV021Sha256Digest;
    readonly operationLockProvenanceHash: GdpsV021Sha256Digest;
  };
  readonly runtimeBinding: {
    readonly runtimeIdentityHash: GdpsV021Sha256Digest;
    readonly requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY";
    readonly providerId: "gdps.geospatial-products";
    readonly providerVersion: "0.2.1";
    readonly capabilityCount: 30;
    readonly gatewayOnly: true;
    readonly directProviderCalls: 0;
    readonly mockTransportUsed: false;
  };
  readonly operationLockHash: GdpsV021Sha256Digest;
}

export interface GdpsV021EvidenceLedger {
  readonly schemaVersion: "wsgs-gdps-byte-evidence-ledger/1.0";
  readonly operationLockHash: GdpsV021Sha256Digest;
  readonly artifacts: readonly GdpsV021EvidenceArtifactRecord[];
}

export interface GdpsV021ReportInput {
  readonly generatedAt: string;
  readonly sourceIdentity: {
    readonly wsgsCommit: string;
    readonly gdpsCommit: string;
    readonly gowmIdentityHash: GdpsV021Sha256Digest;
    readonly runtimeIdentityHash: GdpsV021Sha256Digest;
    readonly handoffBundleHash: GdpsV021Sha256Digest;
    readonly operationLockProvenanceHash: GdpsV021Sha256Digest;
    readonly providerId: "gdps.geospatial-products";
    readonly providerVersion: "0.2.1";
    readonly capabilityCount: 30;
  };
  readonly execution: {
    readonly requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY";
    readonly gatewayOnly: boolean;
    readonly directProviderCalls: number;
    readonly mockTransportUsed: boolean;
  };
  readonly evidenceLedger: GdpsV021EvidenceLedger;
  readonly observations: readonly GdpsV021CaseObservation[];
  readonly qualifications: readonly GdpsV021QualificationEvidence[];
}

export interface GdpsV021EvidenceBindingContext {
  readonly sourceIdentity: GdpsV021ReportInput["sourceIdentity"];
  readonly execution: GdpsV021ReportInput["execution"];
  readonly evidenceLedger: GdpsV021EvidenceLedger;
}

export interface GdpsV021RealE2eReport {
  readonly schemaVersion: "wsgs-gdps-real-e2e-report/2.1";
  readonly generatedAt: string;
  readonly sourceIdentity: GdpsV021ReportInput["sourceIdentity"];
  readonly execution: GdpsV021ReportInput["execution"];
  readonly evidenceLedger: GdpsV021EvidenceLedger;
  readonly corpus: {
    readonly schemaVersion: "wsgs-gdps-e2e-corpus/2.0";
    readonly hash: typeof GDPS_V021_E2E_CORPUS_HASH;
    readonly caseIds: typeof GDPS_V021_E2E_CASE_IDS;
  };
  readonly cases: readonly GdpsV021CaseEvaluation[];
  readonly qualifications: readonly GdpsV021QualificationEvidence[];
  readonly policyErrors: readonly string[];
  readonly summary: {
    readonly totalCases: 16;
    readonly passedCases: number;
    readonly failedCases: number;
    readonly blockedCases: number;
    readonly notRunCases: number;
    readonly requiredQualifications: 12;
    readonly passedQualifications: number;
  };
  readonly overallStatus: "PASS" | "FAIL" | "BLOCKED";
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const artifactIdPattern = /^[a-z0-9][a-z0-9._-]{2,127}$/u;
const authorizedJsonArtifactPathPattern =
  /^reports\/wsgs-v0\.2-gdps-v0\.2\.1\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.json$/u;
const authorizedDriverImplementationPathPattern =
  /^validation\/drivers\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:ts|mts|js|mjs)$/u;
const operationPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+@\d+\.\d+$/u;
const gdpsNamespacePattern = /^(?:geo-product|geo-raster|geo-vector|elevation|terrain|landcover|hydrology|surface-material|obstacle|traversability)\./u;
const knownGdpsOperations = new Set<string>(GDPS_V021_OPERATION_KEYS);

function productBinding(
  descriptorId: string,
  productType: string,
  productProfile: string,
  queryProfile: string
): GdpsV021ExpectedProductBinding {
  return Object.freeze({ descriptorId, productType, productProfile, queryProfile });
}

const policyCases: readonly GdpsV021Case[] = [
  positive("E2E-SLOPE-POINT", "2号车当前位置的坡度是多少？", "GDPS_GENERIC_SAMPLE_VALUE",
    productBinding("SLOPE/DEGREE", "SLOPE", "DEGREE", "SAMPLE_VALUE"),
    ["reference.resolve@1.0", "world.get-current-state@1.0", "geo-raster.sample@1.0"]),
  positive("E2E-SLOPE-RANGE", "A区内坡度15到30度的区域有哪些？", "GDPS_GENERIC_FIND_RANGE",
    productBinding("SLOPE/DEGREE", "SLOPE", "DEGREE", "FIND_VALUE_RANGE"),
    ["reference.resolve@1.0", "world.get-geometry@1.0", "geo-raster.find-by-range@1.0"]),
  positive("E2E-FLOOD-HIGH", "A区内有哪些洪水高风险区域？", "GDPS_GENERIC_FIND_CLASS",
    productBinding("FLOOD_RISK/FLOOD_RISK_CLASS", "FLOOD_RISK", "FLOOD_RISK_CLASS", "FIND_CLASS"),
    ["reference.resolve@1.0", "world.get-geometry@1.0", "geo-raster.find-by-class@1.0"]),
  positive("E2E-DRAINAGE-NEARBY", "2号车附近500米有哪些排水沟？", "GDPS_GENERIC_VECTOR_NEARBY",
    productBinding("DRAINAGE_NETWORK/DRAINAGE_FEATURES", "DRAINAGE_NETWORK", "DRAINAGE_FEATURES", "VECTOR_NEARBY"),
    ["reference.resolve@1.0", "world.get-current-state@1.0", "geo-vector.find-nearby@1.0"]),
  positive("E2E-HIGH-GROUND", "A区内有哪些高地？", "GDPS_HIGH_GROUND_IN_AREA",
    productBinding("TERRAIN_FORM/DEFAULT", "TERRAIN_FORM", "DEFAULT", "FIND_CLASS"),
    ["reference.resolve@1.0", "world.get-geometry@1.0", "terrain.find-high-ground@1.0"]),
  positive("E2E-WETLAND", "A区内有哪些湿地？", "GDPS_WETLANDS_IN_AREA",
    productBinding("WETLAND/DEFAULT", "WETLAND", "DEFAULT", "FIND_CLASS"),
    ["reference.resolve@1.0", "world.get-geometry@1.0", "hydrology.find-wetlands@1.0"]),
  positive("E2E-LAND-COVER", "2号车当前位置是什么地表覆盖？", "GDPS_LAND_COVER_AT_REFERENCE",
    productBinding("LAND_COVER/DEFAULT", "LAND_COVER", "DEFAULT", "SAMPLE_CLASS"),
    ["reference.resolve@1.0", "world.get-current-state@1.0", "landcover.get-class@1.0"]),
  positive("E2E-TRAVERSABILITY-EXPLAIN", "2号车当前位置为什么属于该通行性等级？",
    "GDPS_TRAVERSABILITY_EXPLAIN_AT_REFERENCE",
    productBinding("UGV_TRAVERSABILITY/DEFAULT", "UGV_TRAVERSABILITY", "DEFAULT", "SAMPLE_CLASS"),
    ["reference.resolve@1.0", "world.get-current-state@1.0", "traversability.explain@1.0"]),
  positive("E2E-EXPLICIT-PRODUCT", "使用 gdps-baseline-slope 数据查询A区15到30度的坡地。", "GDPS_GENERIC_FIND_RANGE",
    productBinding("SLOPE/DEGREE", "SLOPE", "DEGREE", "FIND_VALUE_RANGE"),
    ["reference.resolve@1.0", "world.get-geometry@1.0", "geo-raster.find-by-range@1.0"],
    "gdps-baseline-slope"),
  {
    ...negativeBase("NEG-DESCRIPTOR-GAP", "DESCRIPTOR_GAP", "A区内有哪些雪崩风险区域？",
      "UNRESOLVED", "CAPABILITY_GAP", null),
    caseType: "DESCRIPTOR_GAP"
  },
  {
    ...negativeBase("NEG-DATA-GAP", "DATA_GAP", "A区内有哪些无人机限制区？",
      "UNRESOLVED", "DATA_GAP", "PRODUCT_NOT_AVAILABLE"),
    caseType: "DATA_GAP",
    expectedSemanticPattern: "GDPS_GENERIC_VECTOR_IN_AREA",
    expectedDescriptorId: "UAV_RESTRICTION/RESTRICTION_ZONES",
    expectedProductBinding: productBinding("UAV_RESTRICTION/RESTRICTION_ZONES", "UAV_RESTRICTION",
      "RESTRICTION_ZONES", "VECTOR_IN_AREA"),
    expectedOperationKeys: ["reference.resolve@1.0", "world.get-geometry@1.0", "geo-vector.find-in-area@1.0"],
    requiredDriverKind: "CURRENT_PRODUCT_ABSENT",
    mustNotInferFalse: true,
    requiresRecipeEvidence: true,
    requiresPlanEvidence: true,
    requiresOperationLockEvidence: true
  },
  {
    ...negativeBase("NEG-REFERENCE-AMBIGUITY", "REFERENCE_AMBIGUOUS", "滨河路附近有哪些排水沟？",
      "AMBIGUOUS", "AMBIGUOUS", "REFERENCE_AMBIGUOUS"),
    caseType: "REFERENCE_AMBIGUITY",
    expectedOperationKeys: ["reference.resolve@1.0"],
    requiresPlanEvidence: true
  },
  {
    ...negativeBase("NEG-UNIT-MISMATCH", "UNIT_MISMATCH", "A区内坡度大于30米的区域有哪些？",
      "UNRESOLVED", "INDETERMINATE", null),
    caseType: "UNIT_MISMATCH"
  },
  {
    ...negativeBase("NEG-RECIPE-DRIFT", "RECIPE_LOCK_DRIFT", "A区内坡度15到30度的区域有哪些？",
      "UNRESOLVED", "CAPABILITY_GAP", null),
    caseType: "RECIPE_DRIFT",
    expectedSemanticPattern: "GDPS_GENERIC_FIND_RANGE",
    expectedDescriptorId: "SLOPE/DEGREE",
    requiredDriverKind: "RECIPE_SEMANTIC_HASH_ALTERED"
  },
  {
    ...negativeBase("NEG-TRUNCATED", "RESULT_TRUNCATED", "A区内有哪些排水沟？",
      "PARTIAL", "PARTIAL", "TRUNCATED"),
    caseType: "TRUNCATED",
    expectedSemanticPattern: "GDPS_GENERIC_VECTOR_IN_AREA",
    expectedDescriptorId: "DRAINAGE_NETWORK/DRAINAGE_FEATURES",
    expectedProductBinding: productBinding("DRAINAGE_NETWORK/DRAINAGE_FEATURES", "DRAINAGE_NETWORK",
      "DRAINAGE_FEATURES", "VECTOR_IN_AREA"),
    expectedOperationKeys: ["reference.resolve@1.0", "world.get-geometry@1.0", "geo-vector.find-in-area@1.0"],
    productExpectation: "PRESENT",
    requiredDriverKind: "UPSTREAM_TRUNCATED_TRUE",
    requiresRecipeEvidence: true,
    requiresPlanEvidence: true,
    requiresOperationLockEvidence: true
  },
  {
    ...negativeBase("NEG-CURRENTNESS", "SNAPSHOT_MISMATCHED", "严格重用之前的坡度查询证据。",
      "UNRESOLVED", "STALE", "CHANGED"),
    caseType: "CURRENTNESS",
    expectedSemanticPattern: "PRIOR_RESULT_REVALIDATION",
    expectedDescriptorId: "SLOPE/DEGREE",
    expectedProductBinding: productBinding("SLOPE/DEGREE", "SLOPE", "DEGREE", "FIND_VALUE_RANGE"),
    expectedOperationKeys: ["geo-product.check-current@1.0"],
    productExpectation: "CURRENTNESS_CHANGE",
    requiredDriverKind: "STORED_HASH_DIFFERS_FROM_CURRENT",
    mustNotExecuteOriginalQuery: true,
    requiresPlanEvidence: true,
    requiresOperationLockEvidence: true
  }
];

const frozenPolicyCases = Object.freeze(policyCases.map((entry) => Object.freeze({
  ...entry,
  expectedProductBinding: entry.expectedProductBinding === null
    ? null
    : Object.freeze({ ...entry.expectedProductBinding }),
  expectedOperationKeys: Object.freeze([...entry.expectedOperationKeys])
}))) as readonly GdpsV021Case[];

function positive(
  id: GdpsV021PositiveCase["id"],
  message: string,
  pattern: string,
  expectedProductBinding: GdpsV021ExpectedProductBinding,
  operationKeys: readonly string[],
  explicitProductId: string | null = null
): GdpsV021PositiveCase {
  return {
    id,
    caseType: "POSITIVE",
    message,
    expectedTerminalStatus: "COMPLETED",
    expectedNormalizedStatus: "CURRENT",
    expectedSourceCondition: "NORMAL_RESULT",
    expectedSemanticPattern: pattern,
    expectedDescriptorId: expectedProductBinding.descriptorId,
    expectedProductBinding,
    expectedOperationKeys: operationKeys,
    expectedSemanticCode: "OK",
    productExpectation: explicitProductId === null ? "PRESENT" : "EXACT_ID",
    expectedExplicitProductId: explicitProductId,
    requiredDriverKind: null,
    mustNotInferFalse: false,
    mustNotExecuteOriginalQuery: false,
    requiresRecipeEvidence: true,
    requiresPlanEvidence: true,
    requiresOperationLockEvidence: true
  };
}

function negativeBase<
  const I extends Exclude<GdpsV021CaseId, GdpsV021PositiveCase["id"]>,
  const C extends string | null,
  const T extends Exclude<GdpsV021TerminalStatus, "COMPLETED">,
  const N extends GdpsV021NormalizedStatus,
  const SC extends string | null
>(
  id: I,
  semanticCode: C,
  message: string,
  terminalStatus: T,
  normalizedStatus: N,
  sourceCondition: SC
): Omit<GdpsV021CaseBase, "id" | "caseType" | "expectedTerminalStatus" | "expectedNormalizedStatus" |
  "expectedSourceCondition" | "expectedSemanticCode" | "productExpectation"> & {
  readonly id: I;
  readonly expectedTerminalStatus: T;
  readonly expectedNormalizedStatus: N;
  readonly expectedSourceCondition: SC;
  readonly expectedSemanticCode: C;
  readonly productExpectation: "ABSENT";
} {
  return {
    id,
    message,
    expectedTerminalStatus: terminalStatus,
    expectedNormalizedStatus: normalizedStatus,
    expectedSourceCondition: sourceCondition,
    expectedSemanticPattern: null,
    expectedDescriptorId: null,
    expectedProductBinding: null,
    expectedOperationKeys: [],
    expectedSemanticCode: semanticCode,
    productExpectation: "ABSENT",
    expectedExplicitProductId: null,
    requiredDriverKind: null,
    mustNotInferFalse: false,
    mustNotExecuteOriginalQuery: false,
    requiresRecipeEvidence: false,
    requiresPlanEvidence: false,
    requiresOperationLockEvidence: false
  };
}

function sha256(bytes: Uint8Array): GdpsV021Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactArray(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((entry, index) => entry === expected[index]);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseGdpsV021Corpus(input: Uint8Array | string): GdpsV021Corpus {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  if (sha256(bytes) !== GDPS_V021_E2E_CORPUS_HASH) throw new Error("GDPS_V021_E2E_CORPUS_HASH_DRIFT");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error("GDPS_V021_E2E_CORPUS_JSON_INVALID");
  }
  if (!isObject(parsed) || parsed["schemaVersion"] !== "wsgs-gdps-e2e-corpus/2.0" ||
      parsed["requiredExecutionPath"] !== "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" ||
      !Array.isArray(parsed["cases"]) || parsed["cases"].length !== 16) {
    throw new Error("GDPS_V021_E2E_CORPUS_CONTRACT_INVALID");
  }
  const ids = parsed["cases"].map((entry) => isObject(entry) && typeof entry["id"] === "string" ? entry["id"] : "");
  if (!exactArray(ids, GDPS_V021_E2E_CASE_IDS)) throw new Error("GDPS_V021_E2E_CORPUS_CASE_IDS_DRIFT");
  return Object.freeze({
    schemaVersion: "wsgs-gdps-e2e-corpus/2.0",
    requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY",
    hash: GDPS_V021_E2E_CORPUS_HASH,
    cases: frozenPolicyCases
  });
}

export function findForbiddenGdpsOperations(operationKeys: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(operationKeys.filter((key) =>
    gdpsNamespacePattern.test(key) && (!operationPattern.test(key) || !knownGdpsOperations.has(key))))].sort());
}

function validateDigest(value: string | null): boolean {
  return value !== null && digestPattern.test(value);
}

function nonEmptyObject(value: Readonly<Record<string, unknown>>): boolean {
  return isObject(value) && Object.keys(value).length > 0;
}

function validEvidenceIds(values: readonly string[]): boolean {
  return values.length > 0 && new Set(values).size === values.length &&
    values.every((value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{1,255}$/u.test(value));
}

function expectedGdpsOperations(operationKeys: readonly string[]): string[] {
  return operationKeys.filter((key) => knownGdpsOperations.has(key));
}

interface EvidenceLedgerAudit {
  readonly byId: ReadonlyMap<string, GdpsV021EvidenceArtifactRecord>;
  readonly invalidIds: ReadonlySet<string>;
  readonly operationLockHash: GdpsV021Sha256Digest;
  readonly sourceIdentity: GdpsV021ReportInput["sourceIdentity"];
  readonly policyErrors: readonly string[];
}

function isCaseId(value: string): value is GdpsV021CaseId {
  return (GDPS_V021_E2E_CASE_IDS as readonly string[]).includes(value);
}

function isQualificationId(value: string): value is GdpsV021QualificationId {
  return (GDPS_V021_QUALIFICATION_IDS as readonly string[]).includes(value);
}

function isAuthorizedArtifactPath(record: GdpsV021EvidenceArtifactRecord): boolean {
  const pattern = record.kind === "DRIVER_IMPLEMENTATION"
    ? authorizedDriverImplementationPathPattern
    : authorizedJsonArtifactPathPattern;
  return pattern.test(record.repoRelativePath) && !record.repoRelativePath.includes("..") &&
    !record.repoRelativePath.includes("\\") &&
    !record.repoRelativePath.includes(":") && !record.repoRelativePath.startsWith("/") &&
    !record.repoRelativePath.startsWith("//");
}

function artifactKindMatchesSubject(record: GdpsV021EvidenceArtifactRecord): boolean {
  switch (record.kind) {
    case "CASE_EVIDENCE": return isCaseId(record.subject);
    case "QUALIFICATION_EVIDENCE": return isQualificationId(record.subject);
    case "DRIVER_ATTESTATION":
    case "DRIVER_IMPLEMENTATION":
    case "DRIVER_EVIDENCE":
      return ["NEG-DATA-GAP", "NEG-RECIPE-DRIFT", "NEG-TRUNCATED", "NEG-CURRENTNESS"].includes(record.subject);
    default: return false;
  }
}

function auditEvidenceLedger(context: GdpsV021EvidenceBindingContext): EvidenceLedgerAudit {
  const policyErrors: string[] = [];
  const byId = new Map<string, GdpsV021EvidenceArtifactRecord>();
  const idByPath = new Map<string, string>();
  const idByHash = new Map<string, string>();
  const invalidIds = new Set<string>();
  const ledger = context.evidenceLedger;
  if (ledger.schemaVersion !== "wsgs-gdps-byte-evidence-ledger/1.0") {
    policyErrors.push("EVIDENCE_LEDGER_SCHEMA_INVALID");
  }
  if (!digestPattern.test(ledger.operationLockHash)) policyErrors.push("EVIDENCE_LEDGER_OPERATION_LOCK_HASH_INVALID");
  for (const record of ledger.artifacts) {
    const invalidate = (code: string): void => {
      invalidIds.add(record.id);
      policyErrors.push(`${code}:${record.id}`);
    };
    if (!artifactIdPattern.test(record.id)) invalidate("EVIDENCE_ARTIFACT_ID_INVALID");
    if (byId.has(record.id)) {
      invalidate("DUPLICATE_EVIDENCE_ARTIFACT_ID");
      invalidIds.add(byId.get(record.id)!.id);
    } else {
      byId.set(record.id, record);
    }
    const priorPathId = idByPath.get(record.repoRelativePath);
    if (priorPathId !== undefined) {
      invalidate("DUPLICATE_EVIDENCE_ARTIFACT_PATH");
      invalidIds.add(priorPathId);
    } else {
      idByPath.set(record.repoRelativePath, record.id);
    }
    const priorHashId = idByHash.get(record.hash);
    if (priorHashId !== undefined) {
      invalidate("DUPLICATE_EVIDENCE_ARTIFACT_HASH");
      invalidIds.add(priorHashId);
    } else {
      idByHash.set(record.hash, record.id);
    }
    if (!isAuthorizedArtifactPath(record)) invalidate("EVIDENCE_ARTIFACT_PATH_NOT_AUTHORIZED");
    if (!digestPattern.test(record.hash) || !Number.isSafeInteger(record.byteLength) || record.byteLength < 1 ||
        record.byteVerified !== true) {
      invalidate("EVIDENCE_ARTIFACT_BYTES_NOT_VERIFIED");
    }
    if (!artifactKindMatchesSubject(record)) invalidate("EVIDENCE_ARTIFACT_KIND_SUBJECT_INVALID");
    if (record.sourceBinding.wsgsCommit !== context.sourceIdentity.wsgsCommit ||
        record.sourceBinding.gdpsCommit !== context.sourceIdentity.gdpsCommit ||
        record.sourceBinding.gowmIdentityHash !== context.sourceIdentity.gowmIdentityHash ||
        record.sourceBinding.handoffBundleHash !== context.sourceIdentity.handoffBundleHash ||
        record.sourceBinding.operationLockProvenanceHash !== context.sourceIdentity.operationLockProvenanceHash) {
      invalidate("EVIDENCE_ARTIFACT_SOURCE_BINDING_MISMATCH");
    }
    if (record.runtimeBinding.runtimeIdentityHash !== context.sourceIdentity.runtimeIdentityHash ||
        record.runtimeBinding.requiredExecutionPath !== context.execution.requiredExecutionPath ||
        record.runtimeBinding.providerId !== context.sourceIdentity.providerId ||
        record.runtimeBinding.providerVersion !== context.sourceIdentity.providerVersion ||
        record.runtimeBinding.capabilityCount !== context.sourceIdentity.capabilityCount ||
        record.runtimeBinding.gatewayOnly !== true || record.runtimeBinding.directProviderCalls !== 0 ||
        record.runtimeBinding.mockTransportUsed !== false || !context.execution.gatewayOnly ||
        context.execution.directProviderCalls !== 0 || context.execution.mockTransportUsed) {
      invalidate("EVIDENCE_ARTIFACT_RUNTIME_BINDING_MISMATCH");
    }
    if (record.operationLockHash !== ledger.operationLockHash) {
      invalidate("EVIDENCE_ARTIFACT_OPERATION_LOCK_BINDING_MISMATCH");
    }
  }
  return { byId, invalidIds, operationLockHash: ledger.operationLockHash,
    sourceIdentity: context.sourceIdentity, policyErrors };
}

export function gdpsV021DriverArtifactIds(caseId: GdpsV021DriverAttestation["caseId"]): Readonly<{
  attestation: string;
  implementation: string;
  evidence: string;
}> {
  const stem = `driver-${caseId.toLowerCase()}`;
  return Object.freeze({
    attestation: `${stem}-attestation`,
    implementation: `${stem}-implementation`,
    evidence: `${stem}-evidence`
  });
}

function addReference(referenceCounts: Map<string, number>, artifactId: string): void {
  referenceCounts.set(artifactId, (referenceCounts.get(artifactId) ?? 0) + 1);
}

function validateArtifactReferences(
  label: "CASE" | "QUALIFICATION",
  subject: GdpsV021EvidenceSubject,
  requiredKind: "CASE_EVIDENCE" | "QUALIFICATION_EVIDENCE",
  artifactIds: readonly string[],
  hashes: readonly GdpsV021Sha256Digest[],
  audit: EvidenceLedgerAudit,
  referenceCounts: Map<string, number>,
  requireEvidence: boolean
): readonly string[] {
  const reasons: string[] = [];
  if (requireEvidence && artifactIds.length === 0) reasons.push(`${label}_EVIDENCE_ARTIFACT_REQUIRED`);
  if (artifactIds.length !== hashes.length) reasons.push(`${label}_EVIDENCE_REFERENCE_HASH_COUNT_MISMATCH`);
  if (new Set(artifactIds).size !== artifactIds.length || new Set(hashes).size !== hashes.length) {
    reasons.push(`${label}_EVIDENCE_REFERENCE_DUPLICATE`);
  }
  artifactIds.forEach((artifactId, index) => {
    addReference(referenceCounts, artifactId);
    const record = audit.byId.get(artifactId);
    if (record === undefined) {
      reasons.push(`${label}_EVIDENCE_ARTIFACT_NOT_LEDGERED:${artifactId}`);
      return;
    }
    if (audit.invalidIds.has(artifactId)) reasons.push(`${label}_EVIDENCE_ARTIFACT_INVALID:${artifactId}`);
    if (record.kind !== requiredKind) reasons.push(`${label}_EVIDENCE_ARTIFACT_KIND_MISMATCH:${artifactId}`);
    if (record.subject !== subject) reasons.push(`${label}_EVIDENCE_ARTIFACT_SUBJECT_MISMATCH:${artifactId}`);
    if (hashes[index] !== record.hash) reasons.push(`${label}_EVIDENCE_ARTIFACT_HASH_MISMATCH:${artifactId}`);
  });
  return reasons;
}

function validateDriverArtifact(
  expected: GdpsV021Case,
  artifactId: string,
  hash: GdpsV021Sha256Digest | null,
  requiredKind: "DRIVER_ATTESTATION" | "DRIVER_IMPLEMENTATION" | "DRIVER_EVIDENCE",
  audit: EvidenceLedgerAudit,
  referenceCounts: Map<string, number>
): readonly string[] {
  addReference(referenceCounts, artifactId);
  const record = audit.byId.get(artifactId);
  if (record === undefined) return [`DRIVER_ARTIFACT_NOT_LEDGERED:${requiredKind}:${artifactId}`];
  const reasons: string[] = [];
  if (audit.invalidIds.has(artifactId)) reasons.push(`DRIVER_ARTIFACT_INVALID:${requiredKind}:${artifactId}`);
  if (record.kind !== requiredKind) reasons.push(`DRIVER_ARTIFACT_KIND_MISMATCH:${requiredKind}:${artifactId}`);
  if (record.subject !== expected.id) reasons.push(`DRIVER_ARTIFACT_SUBJECT_MISMATCH:${requiredKind}:${artifactId}`);
  if (hash !== null && record.hash !== hash) {
    reasons.push(`DRIVER_ARTIFACT_HASH_MISMATCH:${requiredKind}:${artifactId}`);
  }
  return reasons;
}

function validateDriverAttestation(
  expected: GdpsV021Case,
  attestation: GdpsV021DriverAttestation | null,
  audit: EvidenceLedgerAudit,
  referenceCounts: Map<string, number>
): readonly string[] {
  if (expected.requiredDriverKind === null) {
    return attestation === null ? [] : ["UNEXPECTED_DRIVER_ATTESTATION"];
  }
  if (attestation === null) return ["DRIVER_ATTESTATION_REQUIRED"];
  const reasons: string[] = [];
  const artifactIds = gdpsV021DriverArtifactIds(attestation.caseId);
  if (attestation.caseId !== expected.id) reasons.push("DRIVER_CASE_ID_MISMATCH");
  if (attestation.driverKind !== expected.requiredDriverKind) reasons.push("DRIVER_KIND_MISMATCH");
  if (attestation.schemaVersion !== "wsgs-gdps-e2e-driver-attestation/2.0" ||
      attestation.executionEnvironment !== "ISOLATED_REAL_RUNTIME" ||
      attestation.requiredExecutionPath !== "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" ||
      attestation.realExternalDependencies !== true || attestation.mockTransportUsed !== false ||
      attestation.sharedRuntimeMutated !== false) {
    reasons.push("DRIVER_ATTESTATION_NOT_REAL_ISOLATED_FAIL_CLOSED");
  }
  if (![attestation.handoffBundleHash, attestation.operationLockHash, attestation.provenanceHash,
    attestation.runtimeIdentityHash, attestation.sharedRuntimeBeforeHash, attestation.sharedRuntimeAfterHash,
    attestation.preconditionHash, attestation.driverImplementationHash, attestation.evidenceHash]
      .every((value) => digestPattern.test(value))) reasons.push("DRIVER_ATTESTATION_HASH_INVALID");
  if (attestation.sourceCommit !== audit.sourceIdentity.wsgsCommit ||
      attestation.handoffBundleHash !== audit.sourceIdentity.handoffBundleHash ||
      attestation.operationLockHash !== audit.operationLockHash ||
      attestation.provenanceHash !== audit.sourceIdentity.operationLockProvenanceHash ||
      attestation.runtimeIdentityHash !== audit.sourceIdentity.runtimeIdentityHash) {
    reasons.push("DRIVER_ATTESTATION_SOURCE_BINDING_MISMATCH");
  }
  if (attestation.sharedRuntimeBeforeHash !== attestation.sharedRuntimeAfterHash) {
    reasons.push("DRIVER_ATTESTATION_SHARED_RUNTIME_CHANGED");
  }
  if (!isObject(attestation.precondition) || Object.keys(attestation.precondition).length < 3 ||
      attestation.precondition["caseId"] !== expected.id ||
      attestation.precondition["driverKind"] !== expected.requiredDriverKind ||
      canonicalSha256(attestation.precondition) !== attestation.preconditionHash) {
    reasons.push("DRIVER_PRECONDITION_BINDING_MISMATCH");
  }
  if (new Set([attestation.driverImplementationHash, attestation.evidenceHash]).size !== 2) {
    reasons.push("DRIVER_ARTIFACT_REFERENCES_NOT_DISTINCT");
  }
  reasons.push(...validateDriverArtifact(expected, artifactIds.attestation, null,
    "DRIVER_ATTESTATION", audit, referenceCounts));
  reasons.push(...validateDriverArtifact(expected, artifactIds.implementation,
    attestation.driverImplementationHash, "DRIVER_IMPLEMENTATION", audit, referenceCounts));
  reasons.push(...validateDriverArtifact(expected, artifactIds.evidence, attestation.evidenceHash,
    "DRIVER_EVIDENCE", audit, referenceCounts));
  return reasons;
}

export function evaluateGdpsV021Case(
  expected: GdpsV021Case,
  observation: GdpsV021CaseObservation | null,
  context: GdpsV021EvidenceBindingContext
): GdpsV021CaseEvaluation {
  const audit = auditEvidenceLedger(context);
  return evaluateGdpsV021CaseWithAudit(expected, observation, audit, new Map<string, number>());
}

function evaluateGdpsV021CaseWithAudit(
  expected: GdpsV021Case,
  observation: GdpsV021CaseObservation | null,
  audit: EvidenceLedgerAudit,
  referenceCounts: Map<string, number>
): GdpsV021CaseEvaluation {
  if (observation === null) {
    return Object.freeze({ caseId: expected.id, caseType: expected.caseType, status: "NOT_RUN", reasons: ["CASE_NOT_RUN"], observation });
  }
  const reasons: string[] = [];
  if (observation.caseId !== expected.id) reasons.push("CASE_ID_MISMATCH");
  if (observation.terminalStatus !== expected.expectedTerminalStatus) reasons.push("TERMINAL_STATUS_MISMATCH");
  if (observation.normalizedStatus !== expected.expectedNormalizedStatus) reasons.push("NORMALIZED_STATUS_MISMATCH");
  if (observation.sourceCondition !== expected.expectedSourceCondition) reasons.push("SOURCE_CONDITION_MISMATCH");
  if (expected.expectedSemanticPattern !== null && observation.semanticPattern !== expected.expectedSemanticPattern) {
    reasons.push("SEMANTIC_PATTERN_MISMATCH");
  }
  if (expected.expectedDescriptorId !== null && observation.descriptorId !== expected.expectedDescriptorId) {
    reasons.push("DESCRIPTOR_ID_MISMATCH");
  }
  if (!exactArray(observation.operationKeys, expected.expectedOperationKeys)) reasons.push("OPERATION_CHAIN_MISMATCH");
  const forbidden = findForbiddenGdpsOperations(observation.operationKeys);
  if (forbidden.length > 0) reasons.push(`FORBIDDEN_GDPS_OPERATION:${forbidden.join(",")}`);
  const expectedGdps = expectedGdpsOperations(observation.operationKeys);
  if (!exactArray(observation.gdpsOperationKeys, expectedGdps)) reasons.push("GDPS_OPERATION_CLASSIFICATION_MISMATCH");
  if (observation.semanticCode !== expected.expectedSemanticCode) reasons.push("SEMANTIC_CODE_MISMATCH");
  if (expected.requiresRecipeEvidence && (!observation.recipeId || !validateDigest(observation.recipeLockHash))) {
    reasons.push("RECIPE_EVIDENCE_MISSING");
  }
  if (expected.expectedDescriptorId !== null && !validateDigest(observation.descriptorHash)) {
    reasons.push("DESCRIPTOR_HASH_MISSING");
  }
  if (expected.requiresPlanEvidence && !validateDigest(observation.planHash)) reasons.push("PLAN_HASH_MISSING");
  if (expected.requiresOperationLockEvidence && !validateDigest(observation.operationLockHash)) {
    reasons.push("OPERATION_LOCK_HASH_MISSING");
  }
  if (observation.operationLockHash !== null && observation.operationLockHash !== audit.operationLockHash) {
    reasons.push("OPERATION_LOCK_HASH_LEDGER_MISMATCH");
  }
  reasons.push(...validateArtifactReferences("CASE", expected.id, "CASE_EVIDENCE", observation.evidenceArtifactIds,
    observation.evidenceHashes, audit, referenceCounts, true));
  if (expected.productExpectation === "ABSENT" && observation.productEvidence !== null) reasons.push("PRODUCT_EVIDENCE_FORBIDDEN");
  if (["PRESENT", "EXACT_ID", "CURRENTNESS_CHANGE"].includes(expected.productExpectation)) {
    const product = observation.productEvidence;
    if (product === null || !product.productId || !validateDigest(product.contentHash) || !product.descriptorId ||
        !validateDigest(product.descriptorHash) || expected.expectedProductBinding === null) {
      reasons.push("PRODUCT_EVIDENCE_MISSING");
    } else {
      const binding = expected.expectedProductBinding;
      if (expected.productExpectation === "EXACT_ID" && product.productId !== expected.expectedExplicitProductId) {
        reasons.push("EXPLICIT_PRODUCT_ID_MISMATCH");
      }
      if (product.descriptorId !== binding.descriptorId || product.descriptorId !== observation.descriptorId) {
        reasons.push("PRODUCT_DESCRIPTOR_ID_MISMATCH");
      }
      if (product.descriptorHash !== observation.descriptorHash) reasons.push("PRODUCT_DESCRIPTOR_HASH_MISMATCH");
      if (product.productType !== binding.productType) reasons.push("PRODUCT_TYPE_MISMATCH");
      if (product.productProfile !== binding.productProfile) reasons.push("PRODUCT_PROFILE_MISMATCH");
      if (product.queryProfile !== binding.queryProfile) reasons.push("PRODUCT_QUERY_PROFILE_MISMATCH");
      const gdpsOperations = expectedGdpsOperations(expected.expectedOperationKeys);
      if (gdpsOperations.length !== 1 || product.sourceOperationKey !== gdpsOperations[0]) {
        reasons.push("PRODUCT_SOURCE_OPERATION_MISMATCH");
      }
      if (!nonEmptyObject(product.dataSnapshot) ||
          canonicalSha256(product.dataSnapshot) !== product.dataSnapshotHash) {
        reasons.push("PRODUCT_DATA_SNAPSHOT_BINDING_MISSING");
      }
      if (!nonEmptyObject(product.computeSnapshot) ||
          canonicalSha256(product.computeSnapshot) !== product.computeSnapshotHash) {
        reasons.push("PRODUCT_COMPUTE_SNAPSHOT_BINDING_MISSING");
      }
      if (!validEvidenceIds(product.receiptIds)) reasons.push("PRODUCT_RECEIPT_IDS_MISSING");
      if (!validEvidenceIds(product.evidenceIds)) reasons.push("PRODUCT_EVIDENCE_IDS_MISSING");
      if (!nonEmptyObject(product.quality) || canonicalSha256(product.quality) !== product.qualityHash) {
        reasons.push("PRODUCT_QUALITY_BINDING_MISSING");
      }
      if (product.truncated !== observation.truncated) reasons.push("PRODUCT_TRUNCATION_BINDING_MISMATCH");
      if (expected.productExpectation === "CURRENTNESS_CHANGE" &&
          (!validateDigest(product.currentContentHash) || product.currentContentHash === product.contentHash)) {
        reasons.push("CURRENTNESS_PRODUCT_HASH_NOT_CHANGED");
      }
      if (expected.productExpectation !== "CURRENTNESS_CHANGE" && product.currentContentHash !== product.contentHash) {
        reasons.push("CURRENT_PRODUCT_HASH_NOT_BOUND");
      }
    }
  }
  const expectedCurrentness = expected.caseType === "CURRENTNESS" ? "CHANGED" :
    expected.caseType === "DATA_GAP" ? "NOT_AVAILABLE" :
      ["PRESENT", "EXACT_ID"].includes(expected.productExpectation) ? "CURRENT" : null;
  if (observation.currentness !== expectedCurrentness) reasons.push("CURRENTNESS_MISMATCH");
  if (observation.truncated !== (expected.caseType === "TRUNCATED")) reasons.push("TRUNCATION_FLAG_MISMATCH");
  if (expected.mustNotInferFalse && observation.falseFactInferred) reasons.push("NEGATIVE_FACT_INFERRED_FROM_DATA_GAP");
  if (expected.mustNotExecuteOriginalQuery && observation.originalQueryExecuted) reasons.push("ORIGINAL_QUERY_REEXECUTED");
  reasons.push(...validateDriverAttestation(expected, observation.driverAttestation, audit, referenceCounts));
  const driverOnlyReasons = reasons.filter((reason) => reason.startsWith("DRIVER_"));
  const status: GdpsV021EvidenceStatus = reasons.length === 0 ? "PASS" :
    driverOnlyReasons.length === reasons.length ? "BLOCKED" : "FAIL";
  return Object.freeze({
    caseId: expected.id,
    caseType: expected.caseType,
    status,
    reasons: Object.freeze(reasons),
    observation: structuredClone(observation)
  });
}

function normalizeQualifications(
  input: readonly GdpsV021QualificationEvidence[],
  policyErrors: string[],
  audit: EvidenceLedgerAudit,
  referenceCounts: Map<string, number>
): GdpsV021QualificationEvidence[] {
  const byId = new Map<GdpsV021QualificationId, GdpsV021QualificationEvidence>();
  for (const entry of input) {
    if (!GDPS_V021_QUALIFICATION_IDS.includes(entry.qualificationId)) {
      policyErrors.push(`UNEXPECTED_QUALIFICATION:${entry.qualificationId}`);
      continue;
    }
    if (byId.has(entry.qualificationId)) policyErrors.push(`DUPLICATE_QUALIFICATION:${entry.qualificationId}`);
    else byId.set(entry.qualificationId, entry);
  }
  return GDPS_V021_QUALIFICATION_IDS.map((qualificationId) => {
    const evidence = byId.get(qualificationId);
    if (!evidence) {
      return {
        qualificationId,
        status: "NOT_RUN",
        evidenceArtifactIds: [],
        evidenceHashes: [],
        detail: "Required W44 qualification was not run."
      };
    }
    const evidenceReasons = validateArtifactReferences("QUALIFICATION", qualificationId, "QUALIFICATION_EVIDENCE",
      evidence.evidenceArtifactIds, evidence.evidenceHashes, audit, referenceCounts, evidence.status === "PASS");
    if (evidenceReasons.length > 0) {
      policyErrors.push(...evidenceReasons.map((reason) => `${reason}:${qualificationId}`));
      if (evidence.status === "PASS") return { ...structuredClone(evidence), status: "FAIL" };
    }
    return structuredClone(evidence);
  });
}

export function evaluateGdpsV021Report(
  corpus: GdpsV021Corpus,
  input: GdpsV021ReportInput
): GdpsV021RealE2eReport {
  if (corpus.hash !== GDPS_V021_E2E_CORPUS_HASH ||
      !exactArray(corpus.cases.map((entry) => entry.id), GDPS_V021_E2E_CASE_IDS)) {
    throw new Error("GDPS_V021_E2E_CORPUS_POLICY_DRIFT");
  }
  const policyErrors: string[] = [];
  if (!commitPattern.test(input.sourceIdentity.wsgsCommit)) policyErrors.push("WSGS_COMMIT_INVALID");
  if (!commitPattern.test(input.sourceIdentity.gdpsCommit)) policyErrors.push("GDPS_COMMIT_INVALID");
  if (![input.sourceIdentity.gowmIdentityHash, input.sourceIdentity.runtimeIdentityHash,
    input.sourceIdentity.handoffBundleHash, input.sourceIdentity.operationLockProvenanceHash]
      .every((value) => digestPattern.test(value))) policyErrors.push("SOURCE_IDENTITY_HASH_INVALID");
  if (input.sourceIdentity.providerId !== "gdps.geospatial-products" || input.sourceIdentity.providerVersion !== "0.2.1" ||
      input.sourceIdentity.capabilityCount !== 30) policyErrors.push("GDPS_PROVIDER_IDENTITY_MISMATCH");
  if (input.execution.requiredExecutionPath !== "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" ||
      !input.execution.gatewayOnly || input.execution.directProviderCalls !== 0 || input.execution.mockTransportUsed) {
    policyErrors.push("REAL_GATEWAY_ONLY_EXECUTION_NOT_PROVEN");
  }
  const evidenceContext: GdpsV021EvidenceBindingContext = {
    sourceIdentity: input.sourceIdentity,
    execution: input.execution,
    evidenceLedger: input.evidenceLedger
  };
  const ledgerAudit = auditEvidenceLedger(evidenceContext);
  policyErrors.push(...ledgerAudit.policyErrors);
  const referenceCounts = new Map<string, number>();
  const observationById = new Map<GdpsV021CaseId, GdpsV021CaseObservation>();
  for (const observation of input.observations) {
    if (!GDPS_V021_E2E_CASE_IDS.includes(observation.caseId)) {
      policyErrors.push(`UNEXPECTED_CASE_OBSERVATION:${observation.caseId}`);
      continue;
    }
    if (observationById.has(observation.caseId)) policyErrors.push(`DUPLICATE_CASE_OBSERVATION:${observation.caseId}`);
    else observationById.set(observation.caseId, observation);
  }
  const cases = corpus.cases.map((expected) => evaluateGdpsV021CaseWithAudit(
    expected,
    observationById.get(expected.id) ?? null,
    ledgerAudit,
    referenceCounts
  ));
  const qualifications = normalizeQualifications(input.qualifications, policyErrors, ledgerAudit, referenceCounts);
  for (const artifact of input.evidenceLedger.artifacts) {
    const referenceCount = referenceCounts.get(artifact.id) ?? 0;
    if (referenceCount === 0) policyErrors.push(`UNREFERENCED_EVIDENCE_ARTIFACT:${artifact.id}`);
    if (referenceCount > 1) policyErrors.push(`EVIDENCE_ARTIFACT_REFERENCE_REUSED:${artifact.id}`);
  }
  const passedCases = cases.filter((entry) => entry.status === "PASS").length;
  const failedCases = cases.filter((entry) => entry.status === "FAIL").length;
  const blockedCases = cases.filter((entry) => entry.status === "BLOCKED").length;
  const notRunCases = cases.filter((entry) => entry.status === "NOT_RUN").length;
  const passedQualifications = qualifications.filter((entry) => entry.status === "PASS").length;
  const explicitFailure = failedCases > 0 || policyErrors.length > 0 || qualifications.some((entry) => entry.status === "FAIL");
  const completePass = passedCases === 16 && passedQualifications === 12 && policyErrors.length === 0;
  return Object.freeze({
    schemaVersion: "wsgs-gdps-real-e2e-report/2.1",
    generatedAt: input.generatedAt,
    sourceIdentity: structuredClone(input.sourceIdentity),
    execution: structuredClone(input.execution),
    evidenceLedger: structuredClone(input.evidenceLedger),
    corpus: {
      schemaVersion: corpus.schemaVersion,
      hash: corpus.hash,
      caseIds: GDPS_V021_E2E_CASE_IDS
    },
    cases: Object.freeze(cases),
    qualifications: Object.freeze(qualifications),
    policyErrors: Object.freeze(policyErrors),
    summary: {
      totalCases: 16 as const,
      passedCases,
      failedCases,
      blockedCases,
      notRunCases,
      requiredQualifications: 12 as const,
      passedQualifications
    },
    overallStatus: completePass ? "PASS" : explicitFailure ? "FAIL" : "BLOCKED"
  });
}
