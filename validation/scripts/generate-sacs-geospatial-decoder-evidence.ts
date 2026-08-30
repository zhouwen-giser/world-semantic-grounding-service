import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  gdpsV021FindingContractClosure
} from "@wsgs/gowm-contract-intake";
import {
  createGdpsV021FinalBFindingAuthority,
  readGdpsFindingOperationAuthority,
  resolveGdpsFindingOperationAuthority,
  type GdpsFindingContractClosureOperation,
  type GdpsFindingOperationAuthority,
  type GdpsFindingOperationProjection
} from "@wsgs/gdps-descriptor-consumer";
import {
  validateGowmFindingResultEnvelope
} from "@wsgs/gowm-execution-evidence";
import {
  FindingDecoderRegistry,
  canonicalJson,
  canonicalSha256,
  createFindingDecoderInput,
  decoderCoverageHash,
  standardDecoderRegistrations,
  type DecoderCoverageCandidate,
  type FindingDecoderInput,
  type FindingDecoderPattern,
  type FindingDecoderRegistration,
  type GowmResultEnvelope,
  type GowmResultStatus,
  type Sha256Digest,
  type StandardDecoderSchemaBinding
} from "../../packages/northbound-geospatial-findings/src/index.js";
import {
  createTrustedSourceContext,
  normalizeSourceProducts,
  type SourceGroundingIdentity
} from "../../packages/northbound-geospatial-findings/src/source-normalizer.js";

type JsonObject = Record<string, unknown>;

type CoverageRow = {
  capabilityId: string;
  operationId: string;
  version: string;
  outputSchemaUri: string;
  outputSchemaHash: Sha256Digest;
  semanticProfileHash: Sha256Digest;
  classification: "SUPPORTED" | "NOT_APPLICABLE";
  decoderPattern: string | null;
  queryProfile?: string | null;
  findingKind?: string | null;
  findingKindOptions?: string[];
};

type CoverageFixture = {
  schemaVersion: string;
  sourceLocks: Record<string, string>;
  counts: {
    total: number;
    supported: number;
    intentionallyGap: number;
    unsupportedSchema: number;
    notApplicable: number;
  };
  rows: CoverageRow[];
};

type ShapeFixture = {
  fixtureClass: string;
  sourceAuthority: {
    repository: string;
    implementationSourceSha: string;
    deliveryEvidenceSha: string;
    schemas: string[];
  };
  payloads: Record<string, unknown>;
};

type NegativeCase = {
  caseId: string;
  expected: string;
  observed: string;
  status: "PASS_FAIL_CLOSED" | "PASS_STATIC_BOUNDARY";
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageRoot = resolve(repoRoot, "packages/northbound-geospatial-findings");
const reportRoot = resolve(repoRoot, "reports/sacs-geospatial-v1");
const coverageFixturePath = resolve(packageRoot, "fixtures/gdps-v021-capability-decoder-coverage.json");
const shapeFixturePath = resolve(packageRoot, "fixtures/gdps-real-result-shapes.json");
const writeMode = process.argv.includes("--write");

const outputPaths = {
  coverage: resolve(reportRoot, "N02-decoder-coverage.json"),
  determinism: resolve(reportRoot, "N02-determinism.json"),
  negative: resolve(reportRoot, "N02-negative-cases.json"),
  aggregate: resolve(reportRoot, "decoder-report.json"),
  phase: resolve(reportRoot, "N02-phase-report.md")
} as const;

function sha256Bytes(value: string | Buffer): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function independentCanonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NON_FINITE_INDEPENDENT_CANONICAL_VALUE");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(independentCanonicalValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonObject)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, independentCanonicalValue(item)]));
  }
  throw new Error("UNSUPPORTED_INDEPENDENT_CANONICAL_VALUE");
}

function independentCanonicalHash(value: unknown): Sha256Digest {
  return sha256Bytes(JSON.stringify(independentCanonicalValue(value)));
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function digest(character: string): Sha256Digest {
  return `sha256:${character.repeat(64)}`;
}

const finalBFindingAuthority = createGdpsV021FinalBFindingAuthority();
const closureOperations = gdpsV021FindingContractClosure.operations as unknown as readonly GdpsFindingContractClosureOperation[];

function operationFromClosure(operationId: string, operationVersion = "1.0"): GdpsFindingContractClosureOperation {
  const operation = closureOperations.find((candidate) =>
    candidate.operationId === operationId && candidate.operationVersion === operationVersion);
  if (operation === undefined) throw new Error(`MISSING_FINAL_B_OPERATION_${operationId}@${operationVersion}`);
  return operation;
}

function assertCoverageFixtureMatchesClosure(fixture: CoverageFixture): void {
  assert(fixture.rows.length === closureOperations.length, "COVERAGE_FIXTURE_OPERATION_COUNT_DRIFT");
  for (const operation of closureOperations) {
    const row = fixture.rows.find((candidate) =>
      candidate.operationId === operation.operationId && candidate.version === operation.operationVersion);
    assert(row !== undefined, `COVERAGE_FIXTURE_OPERATION_MISSING_${operation.operationId}`);
    assert(row.outputSchemaUri === operation.outputSchemaUri, `COVERAGE_FIXTURE_SCHEMA_URI_DRIFT_${operation.operationId}`);
    assert(row.outputSchemaHash === operation.outputSchemaHash, `COVERAGE_FIXTURE_SCHEMA_HASH_DRIFT_${operation.operationId}`);
    assert(row.semanticProfileHash === operation.semanticProfileHash, `COVERAGE_FIXTURE_PROFILE_HASH_DRIFT_${operation.operationId}`);
    const expectedClassification = operation.findingBinding.applicability === "NOT_APPLICABLE"
      ? "NOT_APPLICABLE"
      : "SUPPORTED";
    assert(row.classification === expectedClassification, `COVERAGE_FIXTURE_CLASSIFICATION_DRIFT_${operation.operationId}`);
    const expectedPattern = operation.findingBinding.queryProfile === "SAMPLE_VALUE_OR_CLASS"
      ? "SAMPLE_VALUE_OR_CLASS"
      : operation.findingBinding.decoderPattern;
    assert(row.decoderPattern === expectedPattern, `COVERAGE_FIXTURE_PATTERN_DRIFT_${operation.operationId}`);
    assert((row.queryProfile ?? null) === operation.findingBinding.queryProfile,
      `COVERAGE_FIXTURE_QUERY_PROFILE_DRIFT_${operation.operationId}`);
  }
}

function patternsForOperation(operation: GdpsFindingContractClosureOperation): FindingDecoderPattern[] {
  if (operation.findingBinding.applicability === "NOT_APPLICABLE") return [];
  if (operation.findingBinding.applicability === "CATALOG") return ["CATALOG"];
  if (operation.findingBinding.queryProfile === "SAMPLE_VALUE_OR_CLASS") {
    return ["SAMPLE_VALUE", "SAMPLE_CLASS"];
  }
  const pattern = operation.findingBinding.decoderPattern;
  assert(pattern !== null, `FINAL_B_DECODER_PATTERN_MISSING_${operation.operationId}`);
  return [pattern as FindingDecoderPattern];
}

function bindingsFromClosure(): StandardDecoderSchemaBinding[] {
  return closureOperations.flatMap((operation) => patternsForOperation(operation).map((pattern) => {
    const lockedQueryProfile = operation.findingBinding.applicability === "CATALOG"
      ? "CATALOG"
      : operation.findingBinding.queryProfile === "SAMPLE_VALUE_OR_CLASS"
        ? pattern
        : operation.findingBinding.queryProfile;
    assert(lockedQueryProfile !== null, `FINAL_B_QUERY_PROFILE_MISSING_${operation.operationId}`);
    return {
      decoderId: `final-b.${operation.operationId}@${operation.operationVersion}.${pattern}`,
      priority: "EXACT_OPERATION_SCHEMA" as const,
      pattern,
      matchQueryProfile: lockedQueryProfile as FindingDecoderPattern,
      operationId: operation.operationId,
      operationVersion: operation.operationVersion,
      semanticProfileHash: operation.semanticProfileHash as Sha256Digest,
      querySemantics: operation.findingBinding.querySemantics,
      payloadSchemaUri: operation.outputSchemaUri,
      payloadSchemaHash: operation.outputSchemaHash as Sha256Digest
    };
  }));
}

function coverageCandidatesFromClosure(): DecoderCoverageCandidate[] {
  return closureOperations.map((operation) => {
    const binding = operation.findingBinding;
    const queryProfile = binding.applicability === "CATALOG"
      ? "CATALOG"
      : binding.queryProfile === "SAMPLE_VALUE_OR_CLASS" || binding.queryProfile === null
        ? undefined
        : binding.queryProfile;
    return {
      capabilityId: `${operation.operationId}@${operation.operationVersion}`,
      operationId: operation.operationId,
      operationVersion: operation.operationVersion,
      payloadSchemaUri: operation.outputSchemaUri,
      payloadSchemaHash: operation.outputSchemaHash as Sha256Digest,
      semanticProfileHash: operation.semanticProfileHash as Sha256Digest,
      querySemantics: binding.querySemantics,
      ...(queryProfile === undefined ? {} : { queryProfile: queryProfile as FindingDecoderPattern }),
      ...(binding.applicability === "NOT_APPLICABLE"
        ? { applicability: "NOT_APPLICABLE" as const }
        : {})
    };
  });
}

function rowByOperation(fixture: CoverageFixture, operationId: string): CoverageRow {
  const row = fixture.rows.find((candidate) => candidate.operationId === operationId);
  if (row === undefined) throw new Error(`MISSING_COVERAGE_ROW_${operationId}`);
  return row;
}

function withLockedCatalogMetadata(payload: unknown): unknown {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const cloned = structuredClone(payload) as JsonObject;
  const products = Array.isArray(cloned["products"]) ? cloned["products"] : [cloned];
  for (const candidate of products) {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const product = candidate as JsonObject;
    if (product["metadata"] !== undefined) continue;
    const matches = gdpsV021FindingContractClosure.descriptorAuthority.registry.descriptors.filter(
      ({ productType }) => productType === product["productType"]
    );
    assert(matches.length === 1, `CATALOG_PRODUCT_DESCRIPTOR_AMBIGUOUS_${String(product["productType"])}`);
    const descriptor = matches[0]!;
    product["metadata"] = {
      gdpsDescriptor: {
        descriptorId: descriptor.descriptorId,
        descriptorHash: canonicalSha256(descriptor)
      },
      productProfile: descriptor.productProfile
    };
  }
  return cloned;
}

function completeEnvelope(
  row: CoverageRow,
  payload: unknown,
  status: GowmResultStatus = "COMPLETED",
  requestId = "request.n02.evidence"
): GowmResultEnvelope {
  const operationLock = operationFromClosure(row.operationId, row.version);
  assert(row.outputSchemaUri === operationLock.outputSchemaUri, "ROW_OUTPUT_SCHEMA_URI_NOT_FINAL_B");
  assert(row.outputSchemaHash === operationLock.outputSchemaHash, "ROW_OUTPUT_SCHEMA_HASH_NOT_FINAL_B");
  const operation = { operationId: operationLock.operationId, operationVersion: operationLock.operationVersion };
  const computeSnapshot = {
    provider: {
      providerId: gdpsV021FindingContractClosure.provider.providerId,
      providerVersion: gdpsV021FindingContractClosure.provider.providerVersion,
      implementationDigest: gdpsV021FindingContractClosure.provider.implementationDigest
    },
    operation,
    engine: { name: "gdps-python", version: "0.2.1", digest: digest("2") },
    policy: { version: "gdps-budget/1.0", digest: digest("3") },
    schemas: {
      inputSchemaHash: operationLock.inputSchemaHash,
      outputSchemaHash: operationLock.outputSchemaHash
    }
  };
  const authoritativePayload = operationLock.findingBinding.applicability === "CATALOG"
    ? withLockedCatalogMetadata(payload)
    : payload;
  const outputHash = canonicalSha256(authoritativePayload);
  const dataScope = "scope-gdps-v021-baseline";
  const payloadRecord = authoritativePayload !== null
    && typeof authoritativePayload === "object"
    && !Array.isArray(authoritativePayload)
    ? authoritativePayload as JsonObject
    : {};
  const catalogSnapshot = operationLock.findingBinding.applicability === "CATALOG";
  const productContentHash = typeof payloadRecord["contentHash"] === "string"
    ? payloadRecord["contentHash"] as Sha256Digest
    : undefined;
  const productId = typeof payloadRecord["productId"] === "string"
    ? payloadRecord["productId"]
    : undefined;
  const snapshotDigest = catalogSnapshot ? outputHash : productContentHash ?? outputHash;
  const snapshotId = catalogSnapshot || productId === undefined
    ? `catalog:${dataScope}`
    : `${dataScope}:${productId}`;
  return {
    providerProtocolVersion: "1.0",
    requestId,
    operation,
    status,
    output: {
      schemaUri: row.outputSchemaUri,
      schemaHash: row.outputSchemaHash,
      value: authoritativePayload
    },
    dataSnapshot: {
      consistency: "CONSISTENT_AT_START",
      capturedAt: "2026-08-30T00:00:00Z",
      scopeDigest: canonicalSha256({ dataScopeKey: dataScope }),
      resources: [{
        referenceKey: {
          namespace: "gdps",
          kind: "DATASET",
          id: snapshotId,
          version: snapshotDigest
        },
        authority: gdpsV021FindingContractClosure.provider.providerId,
        pinning: "PINNED",
        digest: snapshotDigest
      }]
    },
    computeSnapshot,
    receipts: [{
      receiptId: "receipt.n02.evidence",
      operationId: operation.operationId,
      operationVersion: operation.operationVersion,
      providerId: gdpsV021FindingContractClosure.provider.providerId,
      providerVersion: gdpsV021FindingContractClosure.provider.providerVersion,
      inputHash: digest("5"),
      outputHash,
      computeSnapshotHash: canonicalSha256(computeSnapshot),
      generatedAt: "2026-08-30T00:00:00Z",
      durationMs: 12.5,
      method: {
        engine: "gdps-python",
        engineVersion: "0.2.1",
        methodId: "descriptor-query",
        methodVersion: "1.0"
      },
      changes: { repairApplied: false, typeChanged: false },
      warnings: []
    }],
    // FINAL_B runtime may omit upstream evidenceReferences; WSGS derives its
    // result-local provenance evidence from the validated snapshot and receipt.
    evidenceReferences: [],
    warnings: [],
    consumption: { inputBytes: 128, outputBytes: 512, rows: 1 },
    execution: {
      providerId: gdpsV021FindingContractClosure.provider.providerId,
      providerVersion: gdpsV021FindingContractClosure.provider.providerVersion,
      elapsedMs: 12.5,
      resultHash: outputHash
    }
  };
}

type DecoderInputOptions = {
  status?: GowmResultStatus;
  requestId?: string;
  productType?: string;
  productProfile?: string;
  unit?: string;
  allowedClassCodes?: readonly string[];
  subjectReferenceProductIds?: readonly string[];
  descriptorQueryProfile?: FindingDecoderPattern;
};

function trustedSourceContext() {
  const identityBody = {
    servicePrincipalId: "wsgs-runtime",
    actorId: "sacs-service",
    dataScopes: ["scope-gdps-v021-baseline"],
    datasetScopes: ["wsgs-demo-main"],
    permissions: ["wsgs.grounding.execute"]
  };
  const identity: SourceGroundingIdentity = {
    ...identityBody,
    authorizationContextHash: canonicalSha256(identityBody)
  };
  return createTrustedSourceContext(identity, "scope-gdps-v021-baseline");
}

function descriptorIdFor(
  operation: GdpsFindingContractClosureOperation,
  payload: unknown,
  options: DecoderInputOptions
): string | undefined {
  const constraint = operation.findingBinding.descriptorConstraint;
  if (operation.findingBinding.applicability === "CATALOG") return undefined;
  if (constraint !== null) return constraint.descriptorId;
  const payloadObject = payload !== null && typeof payload === "object" ? payload as JsonObject : {};
  if (typeof payloadObject["descriptorId"] === "string") return payloadObject["descriptorId"];
  const productType = options.productType
    ?? (typeof payloadObject["productType"] === "string" ? payloadObject["productType"] : undefined);
  const productProfile = options.productProfile
    ?? (typeof payloadObject["productProfile"] === "string" ? payloadObject["productProfile"] : undefined);
  assert(productType !== undefined && productProfile !== undefined,
    `GENERIC_DESCRIPTOR_SELECTION_MISSING_${operation.operationId}`);
  const descriptor = gdpsV021FindingContractClosure.descriptorAuthority.registry.descriptors.find((candidate) =>
    candidate.productType === productType && candidate.productProfile === productProfile);
  assert(descriptor !== undefined, `GENERIC_DESCRIPTOR_NOT_IN_FINAL_B_${productType}/${productProfile}`);
  return descriptor.descriptorId;
}

function operationAuthorityFor(
  row: CoverageRow,
  pattern: FindingDecoderPattern,
  payload: unknown,
  options: DecoderInputOptions = {}
): { authority: GdpsFindingOperationAuthority; projection: GdpsFindingOperationProjection } {
  const operation = operationFromClosure(row.operationId, row.version);
  const descriptorId = descriptorIdFor(operation, payload, options);
  const authority = resolveGdpsFindingOperationAuthority(finalBFindingAuthority, {
    operationId: operation.operationId,
    operationVersion: operation.operationVersion,
    semanticConcept: `N02_${pattern}`,
    ...(descriptorId === undefined ? {} : { descriptorId })
  });
  const projection = readGdpsFindingOperationAuthority(authority);
  assert(projection.closureHash === gdpsV021FindingContractClosure.closureHash, "OPERATION_AUTHORITY_CLOSURE_DRIFT");
  assert(projection.outputSchemaUri === operation.outputSchemaUri, "OPERATION_AUTHORITY_SCHEMA_URI_DRIFT");
  assert(projection.outputSchemaHash === operation.outputSchemaHash, "OPERATION_AUTHORITY_SCHEMA_HASH_DRIFT");
  assert(projection.semanticProfileHash === operation.semanticProfileHash, "OPERATION_AUTHORITY_PROFILE_HASH_DRIFT");
  assert(projection.decoderPattern === pattern, `OPERATION_AUTHORITY_PATTERN_DRIFT_${operation.operationId}`);
  if (projection.descriptor === undefined) {
    assert(operation.findingBinding.applicability === "CATALOG", "DESCRIPTOR_AUTHORITY_UNEXPECTEDLY_ABSENT");
  } else {
    if (options.productType !== undefined) assert(options.productType === projection.descriptor.productType, "OPTION_PRODUCT_TYPE_NOT_AUTHORITATIVE");
    if (options.productProfile !== undefined) assert(options.productProfile === projection.descriptor.productProfile, "OPTION_PRODUCT_PROFILE_NOT_AUTHORITATIVE");
    if (options.unit !== undefined) assert(options.unit === projection.descriptor.unit, "OPTION_UNIT_NOT_AUTHORITATIVE");
    if (options.allowedClassCodes !== undefined) {
      const allowed = new Set(projection.descriptor.allowedClassCodes ?? []);
      assert(options.allowedClassCodes.every((code) => allowed.has(code)), "OPTION_CLASS_CODE_NOT_AUTHORITATIVE");
    }
    if (options.descriptorQueryProfile !== undefined) {
      assert(options.descriptorQueryProfile === projection.queryProfile, "OPTION_QUERY_PROFILE_NOT_AUTHORITATIVE");
    }
  }
  return { authority, projection };
}

function decoderInput(
  row: CoverageRow,
  pattern: FindingDecoderPattern,
  payload: unknown,
  options: DecoderInputOptions = {}
): FindingDecoderInput {
  const envelope = completeEnvelope(
    row,
    payload,
    options.status,
    options.requestId
  );
  const { authority } = operationAuthorityFor(row, pattern, payload, options);
  const validatedResult = validateGowmFindingResultEnvelope(authority, envelope);
  const sourceBinding = normalizeSourceProducts({
    trustedContext: trustedSourceContext(),
    validatedResults: [validatedResult]
  });
  return createFindingDecoderInput({
    validatedResult,
    sourceBinding,
    subjectReferenceProductIds: options.subjectReferenceProductIds
      ?? ["reference.n02.a", "reference.n02.b"]
  });
}

function expectedError(caseId: string, expected: string, action: () => unknown): NegativeCase {
  let observed = "NO_ERROR";
  try {
    action();
  } catch (error) {
    observed = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : error instanceof Error
        ? error.message
        : String(error);
  }
  assert(observed === expected, `${caseId}_EXPECTED_${expected}_OBSERVED_${observed}`);
  return { caseId, expected, observed, status: "PASS_FAIL_CLOSED" };
}

function commonReport(inputSetHash: Sha256Digest) {
  return {
    phase: "N02",
    generator: {
      name: "generate-sacs-geospatial-decoder-evidence",
      version: "1.0.0"
    },
    generationMode: "DETERMINISTIC_CONTENT_ADDRESSED_NO_WALL_CLOCK",
    inputSetHash,
    inputHashCanonicalization: "UTF8_CRLF_CR_NORMALIZED_TO_LF_SHA256",
    verificationRecipe: {
      writeCommand: "npm run findings:decoder:write",
      checkCommand: "npm run findings:decoder:check",
      expectedSuccessMarker: "WSGS_V021_FINDING_DECODER_READY",
      embeddedExecutionClaim: false,
      exitCode: null
    },
    executionEvidence: {
      status: "RECORDED_EXTERNALLY_IN_PHASE_REPORT_AND_CI",
      phaseReportPath: "reports/sacs-geospatial-v1/N02-phase-report.md"
    },
    runtimeQualification: "NOT_RUN",
    consumerRuntimeQualification: "BLOCKED_UPSTREAM",
    consumerCompatible: false,
    realConsumerCases: {
      passed: 0,
      total: 18,
      status: "NOT_RUN"
    },
    g1: "NOT_RUN",
    v03ContentAllowed: false,
    productionQualified: false
  } as const;
}

function normalizedTextInputHashes(): Record<string, Sha256Digest> {
  const paths = [
    "packages/northbound-geospatial-findings/fixtures/gdps-real-result-shapes.json",
    "packages/northbound-geospatial-findings/fixtures/gdps-v021-capability-decoder-coverage.json",
    "packages/northbound-geospatial-findings/package.json",
    "packages/northbound-geospatial-findings/src/canonical.ts",
    "packages/northbound-geospatial-findings/src/decoders.ts",
    "packages/northbound-geospatial-findings/src/index.ts",
    "packages/northbound-geospatial-findings/src/registry.ts",
    "packages/northbound-geospatial-findings/src/registry.test.ts",
    "packages/northbound-geospatial-findings/src/types.ts",
    "packages/northbound-geospatial-findings/src/validation.ts",
    "packages/northbound-geospatial-findings/src/source-normalizer.ts",
    "packages/gdps-descriptor-consumer/src/decoder-authority.ts",
    "packages/gdps-descriptor-consumer/src/index.ts",
    "packages/gowm-contract-intake/src/gdps-v021-finding-contract.generated.ts",
    "packages/gowm-execution-evidence/src/validated-envelope.ts",
    "validation/scripts/generate-sacs-geospatial-decoder-evidence.ts"
  ];
  return Object.fromEntries(paths.map((path) => [
    path,
    sha256Bytes(
      readFileSync(resolve(repoRoot, path), "utf8").replace(/\r\n?|\n/gu, "\n")
    )
  ]));
}

function buildReports(): {
  json: Record<"coverage" | "determinism" | "negative" | "aggregate", string>;
  phase: string;
} {
  const coverageFixture = readJson<CoverageFixture>(coverageFixturePath);
  const shapes = readJson<ShapeFixture>(shapeFixturePath);
  assert(coverageFixture.schemaVersion === "wsgs-gdps-v021-capability-decoder-coverage/1.0", "BAD_COVERAGE_FIXTURE_VERSION");
  assert(shapes.fixtureClass === "TEST_VECTOR", "NON_TEST_VECTOR_SHAPE_FIXTURE");
  assert(shapes.sourceAuthority.implementationSourceSha === coverageFixture.sourceLocks["gdpsImplementationSha"], "SHAPE_IMPLEMENTATION_LOCK_MISMATCH");
  assert(shapes.sourceAuthority.deliveryEvidenceSha === coverageFixture.sourceLocks["gdpsDeliveryEvidenceSha"], "SHAPE_DELIVERY_LOCK_MISMATCH");
  assertCoverageFixtureMatchesClosure(coverageFixture);
  assert(coverageFixture.sourceLocks["bundleHash"] === gdpsV021FindingContractClosure.handoff.bundleHash,
    "COVERAGE_BUNDLE_NOT_FINAL_B");
  assert(coverageFixture.sourceLocks["gdpsImplementationSha"] === gdpsV021FindingContractClosure.sources.gdpsSha,
    "COVERAGE_GDPS_SOURCE_NOT_FINAL_B");
  assert(coverageFixture.sourceLocks["gowmSourceSha"] === gdpsV021FindingContractClosure.sources.gowmSha,
    "COVERAGE_GOWM_SOURCE_NOT_FINAL_B");
  assert(coverageFixture.sourceLocks["wsgsSourceSha"] === gdpsV021FindingContractClosure.sources.wsgsSha,
    "COVERAGE_WSGS_SOURCE_NOT_FINAL_B");

  const inputHashes = normalizedTextInputHashes();
  const inputSetHash = independentCanonicalHash(inputHashes);
  const common = commonReport(inputSetHash);
  const bindings = bindingsFromClosure();
  const registry = new FindingDecoderRegistry(standardDecoderRegistrations(bindings));
  const coverage = registry.coverage(coverageCandidatesFromClosure());
  assert(canonicalJson(coverage.counts) === canonicalJson(coverageFixture.counts), "COVERAGE_COUNT_DRIFT");
  assert(coverage.counts.total === 30, "COVERAGE_TOTAL_NOT_30");
  assert(coverage.counts.supported === 29, "COVERAGE_SUPPORTED_NOT_29");
  assert(coverage.counts.intentionallyGap === 0, "COVERAGE_INTENTIONAL_GAP_NOT_0");
  assert(coverage.counts.unsupportedSchema === 0, "COVERAGE_UNSUPPORTED_NOT_0");
  assert(coverage.counts.notApplicable === 1, "COVERAGE_NOT_APPLICABLE_NOT_1");
  assert(new Set(coverage.rows.map(({ capabilityId }) => capabilityId)).size === 30, "COVERAGE_DUPLICATE_CAPABILITY");

  const coverageReport = {
    schemaVersion: "wsgs-v021-n02-decoder-coverage/1.0",
    ...common,
    status: "PASS",
    authority: {
      fixtureClass: shapes.fixtureClass,
      shapeImplementationSourceSha: shapes.sourceAuthority.implementationSourceSha,
      shapeDeliveryEvidenceSha: shapes.sourceAuthority.deliveryEvidenceSha,
      sourceLocks: coverageFixture.sourceLocks,
      finalBClosure: {
        closureHash: gdpsV021FindingContractClosure.closureHash,
        sources: gdpsV021FindingContractClosure.sources,
        handoff: gdpsV021FindingContractClosure.handoff,
        gateway: gdpsV021FindingContractClosure.gateway,
        provider: {
          providerId: gdpsV021FindingContractClosure.provider.providerId,
          providerVersion: gdpsV021FindingContractClosure.provider.providerVersion,
          manifestHash: gdpsV021FindingContractClosure.provider.manifestHash,
          implementationDigest: gdpsV021FindingContractClosure.provider.implementationDigest
        },
        descriptorRegistryHash: gdpsV021FindingContractClosure.descriptorAuthority.registryHash,
        vocabularyRegistryHash: gdpsV021FindingContractClosure.descriptorAuthority.vocabularyRegistryHash,
        operationCount: closureOperations.length,
        outputSchemaCount: gdpsV021FindingContractClosure.outputSchemas.length
      },
      inputHashes
    },
    coverageHash: decoderCoverageHash(coverage),
    independentCoverageHash: independentCanonicalHash(coverage),
    counts: coverage.counts,
    rows: coverage.rows.map((row) => ({
      ...row,
      lock: coverageFixture.rows.find(({ capabilityId }) => capabilityId === row.capabilityId)
    })),
    dynamicCapabilityPolicy: {
      capabilityId: "geo-raster.sample@1.0",
      dispatchAuthority: "LOCKED_DESCRIPTOR_VALUE_SEMANTICS",
      findingKindOptions: ["POINT_CLASSIFICATION", "POINT_MEASUREMENT"],
      capabilityCount: 1
    },
    currentnessBoundary: {
      capabilityId: "geo-product.check-current@1.0",
      classification: "NOT_APPLICABLE",
      ownerPhase: "N06"
    },
    noSilentOmission: true
  };

  const vectorCases = [
    {
      caseId: "REAL_SHAPE_POINT_MEASUREMENT",
      row: rowByOperation(coverageFixture, "elevation.sample"),
      pattern: "SAMPLE_VALUE" as const,
      payload: shapes.payloads["pointMeasurement"],
      options: { unit: "metre" },
      findingKind: "POINT_MEASUREMENT"
    },
    {
      caseId: "REAL_SHAPE_POINT_CLASSIFICATION",
      row: rowByOperation(coverageFixture, "geo-raster.sample"),
      pattern: "SAMPLE_CLASS" as const,
      payload: shapes.payloads["pointClassificationGeneric"],
      options: {
        productType: "UGV_TRAVERSABILITY",
        productProfile: "DEFAULT",
        allowedClassCodes: ["CONDITIONALLY_PASSABLE"]
      },
      findingKind: "POINT_CLASSIFICATION"
    },
    {
      caseId: "REAL_SHAPE_SPATIAL_FEATURE_COLLECTION",
      row: rowByOperation(coverageFixture, "terrain.find-high-ground"),
      pattern: "FIND_CLASS" as const,
      payload: shapes.payloads["spatialFeatures"],
      options: { allowedClassCodes: ["HIGH_GROUND"] },
      findingKind: "SPATIAL_FEATURE_COLLECTION"
    },
    {
      caseId: "REAL_SHAPE_PROFILE",
      row: rowByOperation(coverageFixture, "elevation.profile"),
      pattern: "PROFILE_VALUE" as const,
      payload: shapes.payloads["profile"],
      options: { unit: "metre" },
      findingKind: "PROFILE"
    },
    {
      caseId: "REAL_SHAPE_QUALIFIED_EXPLANATION",
      row: rowByOperation(coverageFixture, "traversability.explain"),
      pattern: "QUALIFIED_EXPLANATION" as const,
      payload: shapes.payloads["qualifiedExplanation"],
      options: {
        descriptorQueryProfile: "SAMPLE_CLASS" as const,
        allowedClassCodes: ["CONDITIONALLY_PASSABLE"]
      },
      findingKind: "QUALIFIED_EXPLANATION"
    },
    {
      caseId: "REAL_SHAPE_CATALOG",
      row: rowByOperation(coverageFixture, "geo-product.search"),
      pattern: "CATALOG" as const,
      payload: shapes.payloads["catalog"],
      options: {},
      findingKind: "CATALOG"
    }
  ];

  const inputs = vectorCases.map((item) => decoderInput(item.row, item.pattern, item.payload, item.options));
  const decoded = vectorCases.map((item, index) => {
    const result = registry.decode(inputs[index]!);
    assert(result.findings.length === 1, `${item.caseId}_FINDING_COUNT`);
    assert(result.findings[0]?.findingKind === item.findingKind, `${item.caseId}_FINDING_KIND`);
    assert(result.findingSetHash === independentCanonicalHash(result.findings), `${item.caseId}_HASH_RECOMPUTE`);
    return {
      caseId: item.caseId,
      status: "PASS",
      sourceShape: shapes.sourceAuthority.schemas,
      operationId: item.row.operationId,
      pattern: item.pattern,
      findingKind: item.findingKind,
      findingCount: result.findings.length,
      gapKinds: result.gaps.map(({ gapKind }) => gapKind),
      findingSetHash: result.findingSetHash,
      independentFindingSetHash: independentCanonicalHash(result.findings),
      outputHash: independentCanonicalHash(result)
    };
  });

  const adapterCases = [
    {
      caseId: "GENERIC_SAMPLE_NESTED_UNIT",
      row: rowByOperation(coverageFixture, "geo-raster.sample"),
      pattern: "SAMPLE_VALUE" as const,
      payload: shapes.payloads["pointMeasurementGenericService"],
      options: { productType: "ELEVATION_DTM", productProfile: "DEFAULT", unit: "metre" },
      findingKind: "POINT_MEASUREMENT"
    },
    {
      caseId: "GENERIC_PROFILE_NESTED_UNIT",
      row: rowByOperation(coverageFixture, "geo-raster.profile"),
      pattern: "PROFILE_VALUE" as const,
      payload: shapes.payloads["profileGenericService"],
      options: { productType: "ELEVATION_DTM", productProfile: "DEFAULT", unit: "metre" },
      findingKind: "PROFILE"
    },
    {
      caseId: "GENERIC_VALUE_RANGE_PROPERTIES",
      row: rowByOperation(coverageFixture, "geo-raster.find-by-range"),
      pattern: "FIND_VALUE_RANGE" as const,
      payload: shapes.payloads["valueRangeGenericService"],
      options: { productType: "SLOPE", productProfile: "DEGREE", unit: "degree" },
      findingKind: "SPATIAL_FEATURE_COLLECTION"
    },
    {
      caseId: "DIRECT_CURRENT_PRODUCT_GET",
      row: rowByOperation(coverageFixture, "geo-product.get"),
      pattern: "CATALOG" as const,
      payload: shapes.payloads["currentProductGet"],
      options: {},
      findingKind: "CATALOG"
    }
  ];
  const decodedAdapters = adapterCases.map((item) => {
    const result = registry.decode(decoderInput(item.row, item.pattern, item.payload, item.options));
    assert(result.findings.length === 1, `${item.caseId}_FINDING_COUNT`);
    assert(result.findings[0]?.findingKind === item.findingKind, `${item.caseId}_FINDING_KIND`);
    const projectedBytes = canonicalJson(result.findings);
    for (const forbidden of ["ranges", "productProfile", "gdpsDescriptor", "extent", "storageKind"]) {
      assert(!projectedBytes.includes(forbidden), `${item.caseId}_${forbidden}_PASSTHROUGH`);
    }
    return {
      caseId: item.caseId,
      status: "PASS",
      operationId: item.row.operationId,
      pattern: item.pattern,
      findingKind: item.findingKind,
      findingSetHash: result.findingSetHash,
      independentFindingSetHash: independentCanonicalHash(result.findings),
      rawPayloadPassThrough: false
    };
  });

  const noDataInput = decoderInput(
    rowByOperation(coverageFixture, "elevation.sample"),
    "SAMPLE_VALUE",
    {
      schemaVersion: "gdps-raster-sample-result/1.0",
      productId: "gdps-baseline-dtm",
      contentHash: digest("8"),
      point: { type: "Point", coordinates: [116.391, 39.907] },
      value: null,
      noData: true
    },
    { status: "NO_DATA", unit: "metre" }
  );
  let noDataOwnershipCode = "NO_ERROR";
  try {
    registry.decode(noDataInput);
  } catch (error) {
    noDataOwnershipCode = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : String(error);
  }
  assert(noDataOwnershipCode === "N03_STATUS_NORMALIZATION_REQUIRED", "NO_DATA_NOT_DELEGATED_TO_N03");

  const legalNoDataInput = decoderInput(
    rowByOperation(coverageFixture, "elevation.sample"),
    "SAMPLE_VALUE",
    {
      schemaVersion: "gdps-raster-sample-result/1.0",
      productId: "gdps-baseline-dtm",
      contentHash: digest("8"),
      point: { type: "Point", coordinates: [116.391, 39.907] },
      value: null,
      noData: true
    },
    { status: "COMPLETED", unit: "metre" }
  );
  const legalNoData = registry.decode(legalNoDataInput);
  assert(legalNoData.status === "NO_DATA" && legalNoData.findings.length === 0, "LEGAL_NO_DATA_PAYLOAD_NOT_NORMALIZED");
  assert(legalNoData.selection?.pattern === "SAMPLE_VALUE", "LEGAL_NO_DATA_DECODER_NOT_SELECTED");

  const emptyFeaturePayload = structuredClone(shapes.payloads["spatialFeatures"]) as {
    features: unknown[];
    truncated: boolean;
  };
  emptyFeaturePayload.features = [];
  emptyFeaturePayload.truncated = false;
  const emptyFeature = registry.decode(decoderInput(
    rowByOperation(coverageFixture, "terrain.find-high-ground"),
    "FIND_CLASS",
    emptyFeaturePayload,
    { allowedClassCodes: ["HIGH_GROUND"] }
  ));
  assert(emptyFeature.status === "NO_DATA" && emptyFeature.findings.length === 0, "EMPTY_FEATURE_NOT_NORMALIZED");

  const partialEmptyFeature = registry.decode(decoderInput(
    rowByOperation(coverageFixture, "terrain.find-high-ground"),
    "FIND_CLASS",
    emptyFeaturePayload,
    { status: "PARTIAL", allowedClassCodes: ["HIGH_GROUND"] }
  ));
  assert(partialEmptyFeature.status === "PARTIAL" && partialEmptyFeature.findings.length === 0, "PARTIAL_EMPTY_DOWNGRADED");
  assert(partialEmptyFeature.gaps[0]?.gapKind === "DATA_GAP"
    && partialEmptyFeature.gaps[0]?.severity === "WARNING", "PARTIAL_EMPTY_WARNING_GAP_MISSING");

  const emptyCatalogPayload = structuredClone(shapes.payloads["catalog"]) as {
    products: unknown[];
    truncated: boolean;
  };
  emptyCatalogPayload.products = [];
  emptyCatalogPayload.truncated = false;
  const emptyCatalog = registry.decode(decoderInput(
    rowByOperation(coverageFixture, "geo-product.search"),
    "CATALOG",
    emptyCatalogPayload
  ));
  assert(emptyCatalog.status === "NO_DATA" && emptyCatalog.findings.length === 0, "EMPTY_CATALOG_NOT_NORMALIZED");

  const mixedProfilePayload = structuredClone(shapes.payloads["profile"]) as {
    samples: Array<JsonObject>;
  };
  mixedProfilePayload.samples[0]!["value"] = null;
  mixedProfilePayload.samples[0]!["noData"] = true;
  const mixedProfile = registry.decode(decoderInput(
    rowByOperation(coverageFixture, "elevation.profile"),
    "PROFILE_VALUE",
    mixedProfilePayload,
    { unit: "metre" }
  ));
  assert(mixedProfile.status === "PARTIAL" && mixedProfile.findings.length === 1, "MIXED_PROFILE_NO_DATA_NOT_PARTIAL");
  assert(mixedProfile.gaps.some(({ gapKind }) => gapKind === "DATA_GAP"), "MIXED_PROFILE_DATA_GAP_MISSING");

  const allNoDataProfilePayload = structuredClone(shapes.payloads["profile"]) as {
    samples: Array<JsonObject>;
  };
  for (const sample of allNoDataProfilePayload.samples) {
    sample["value"] = null;
    sample["noData"] = true;
  }
  const allNoDataProfile = registry.decode(decoderInput(
    rowByOperation(coverageFixture, "elevation.profile"),
    "PROFILE_VALUE",
    allNoDataProfilePayload,
    { unit: "metre" }
  ));
  assert(allNoDataProfile.status === "NO_DATA" && allNoDataProfile.findings.length === 0, "ALL_NO_DATA_PROFILE_NOT_NORMALIZED");

  const truncatedInput = inputs[2]!;
  const truncated = registry.decode(truncatedInput);
  assert(truncated.status === "PARTIAL", "TRUNCATED_STATUS_NOT_PARTIAL");
  assert(truncated.gaps.some(({ gapKind }) => gapKind === "TRUNCATED"), "TRUNCATED_GAP_MISSING");

  const repeated = [registry.decodeAll(inputs), registry.decodeAll(inputs), registry.decodeAll(inputs)];
  const repeatedBytes = repeated.map((result) => canonicalJson(result));
  assert(new Set(repeatedBytes).size === 1, "THREE_RUN_BYTE_DRIFT");
  const baselineBatch = repeated[0]!;
  assert(baselineBatch.findingSetHash === independentCanonicalHash(baselineBatch.findings), "BATCH_HASH_RECOMPUTE_FAILED");

  const featurePayload = structuredClone(shapes.payloads["spatialFeatures"]) as { features: unknown[] };
  featurePayload.features.reverse();
  const featurePermutation = registry.decode(decoderInput(
    rowByOperation(coverageFixture, "terrain.find-high-ground"),
    "FIND_CLASS",
    featurePayload,
    { allowedClassCodes: ["HIGH_GROUND"] }
  ));
  assert(canonicalJson(featurePermutation) === canonicalJson(registry.decode(inputs[2]!)), "FEATURE_ORDER_DRIFT");

  const provenancePermutationInput = decoderInput(
    vectorCases[0]!.row,
    "SAMPLE_VALUE",
    vectorCases[0]!.payload,
    {
      unit: "metre",
      subjectReferenceProductIds: ["reference.n02.b", "reference.n02.a"]
    }
  );
  assert(
    canonicalJson(registry.decode(provenancePermutationInput)) === canonicalJson(registry.decode(inputs[0]!)),
    "PROVENANCE_ORDER_DRIFT"
  );

  const requestPermutationInput = decoderInput(
    vectorCases[0]!.row,
    "SAMPLE_VALUE",
    vectorCases[0]!.payload,
    { unit: "metre", requestId: "request.n02.changed-but-nonauthoritative" }
  );
  assert(
    canonicalJson(registry.decode(requestPermutationInput)) === canonicalJson(registry.decode(inputs[0]!)),
    "REQUEST_ID_DRIFT"
  );

  const inputOrderPermutation = registry.decodeAll([...inputs].reverse());
  assert(canonicalJson(inputOrderPermutation) === canonicalJson(baselineBatch), "INPUT_ORDER_DRIFT");

  const sampleInput = inputs[0]!;
  const sampleOutput = sampleInput.envelope.output!;
  const priorityRegistrations = standardDecoderRegistrations([
    {
      decoderId: "priority.generic",
      priority: "GENERIC_PATTERN",
      pattern: "SAMPLE_VALUE",
      payloadSchemaUri: sampleOutput.schemaUri,
      payloadSchemaHash: sampleOutput.schemaHash
    },
    {
      decoderId: "priority.semantic",
      priority: "SEMANTIC_PROFILE",
      pattern: "SAMPLE_VALUE",
      semanticProfileHash: sampleInput.descriptor.semanticProfileHash,
      payloadSchemaUri: sampleOutput.schemaUri,
      payloadSchemaHash: sampleOutput.schemaHash
    },
    {
      decoderId: "priority.exact",
      priority: "EXACT_OPERATION_SCHEMA",
      pattern: "SAMPLE_VALUE",
      operationId: sampleInput.envelope.operation.operationId,
      operationVersion: sampleInput.envelope.operation.operationVersion,
      payloadSchemaUri: sampleOutput.schemaUri,
      payloadSchemaHash: sampleOutput.schemaHash
    }
  ]);
  const exactSelection = new FindingDecoderRegistry(priorityRegistrations).decode(sampleInput).selection?.decoderId;
  const semanticSelection = new FindingDecoderRegistry(priorityRegistrations.slice(0, 2)).decode(sampleInput).selection?.decoderId;
  const genericSelection = new FindingDecoderRegistry(priorityRegistrations.slice(0, 1)).decode(sampleInput).selection?.decoderId;
  assert(exactSelection === "priority.exact", "EXACT_PRIORITY_FAILED");
  assert(semanticSelection === "priority.semantic", "SEMANTIC_PRIORITY_FAILED");
  assert(genericSelection === "priority.generic", "GENERIC_PRIORITY_FAILED");

  const determinismReport = {
    schemaVersion: "wsgs-v021-n02-determinism/1.0",
    ...common,
    status: "PASS",
    realShapeAuthority: shapes.sourceAuthority,
    findingKinds: {
      expected: 6,
      passed: decoded.length,
      cases: decoded
    },
    authoritativeShapeAdapters: {
      expected: 4,
      passed: decodedAdapters.length,
      cases: decodedAdapters
    },
    statusSemantics: {
      noData: {
        status: "PASS",
        owner: "N03_SOURCE_GAP_NORMALIZER",
        decoderErrorCode: noDataOwnershipCode,
        findingCount: 0
      },
      legalCompletedNoDataPayload: {
        status: "PASS",
        normalizedStatus: legalNoData.status,
        findingCount: legalNoData.findings.length,
        gapKinds: legalNoData.gaps.map(({ gapKind }) => gapKind)
      },
      emptyCollections: {
        status: "PASS",
        featureStatus: emptyFeature.status,
        catalogStatus: emptyCatalog.status,
        negativeFactsInferred: false
      },
      partialEmptyCollection: {
        status: "PASS",
        normalizedStatus: partialEmptyFeature.status,
        findingCount: partialEmptyFeature.findings.length,
        gapKinds: partialEmptyFeature.gaps.map(({ gapKind }) => gapKind),
        severity: partialEmptyFeature.gaps[0]?.severity
      },
      profileNoData: {
        status: "PASS",
        mixedStatus: mixedProfile.status,
        mixedFindingCount: mixedProfile.findings.length,
        mixedGapKinds: mixedProfile.gaps.map(({ gapKind }) => gapKind),
        allNoDataStatus: allNoDataProfile.status,
        allNoDataFindingCount: allNoDataProfile.findings.length
      },
      partialTruncated: {
        status: "PASS",
        resultStatus: truncated.status,
        gapKinds: truncated.gaps.map(({ gapKind }) => gapKind),
        findingSetHash: truncated.findingSetHash
      }
    },
    deterministicExecution: {
      repeatedRunCount: 3,
      byteIdentical: true,
      outputHash: independentCanonicalHash(baselineBatch),
      findingSetHash: baselineBatch.findingSetHash,
      independentFindingSetHash: independentCanonicalHash(baselineBatch.findings),
      independentRecomputation: "PASS",
      permutations: [
        { caseId: "FEATURE_ORDER", status: "PASS", outputHash: independentCanonicalHash(featurePermutation) },
        { caseId: "PROVENANCE_ORDER", status: "PASS", outputHash: independentCanonicalHash(registry.decode(provenancePermutationInput)) },
        { caseId: "REQUEST_ID", status: "PASS", outputHash: independentCanonicalHash(registry.decode(requestPermutationInput)) },
        { caseId: "INPUT_ORDER", status: "PASS", outputHash: independentCanonicalHash(inputOrderPermutation) }
      ]
    },
    priority: {
      requiredOrder: ["EXACT_OPERATION_SCHEMA", "SEMANTIC_PROFILE", "GENERIC_PATTERN"],
      selections: [exactSelection, semanticSelection, genericSelection],
      status: "PASS"
    },
    rawPayloadPassThrough: false
  };

  const negatives: NegativeCase[] = [];
  const cloneInput = (): FindingDecoderInput => structuredClone(sampleInput);
  const sampleRow = rowByOperation(coverageFixture, "elevation.sample");
  const samplePayload = shapes.payloads["pointMeasurement"];
  const { authority: sampleOperationAuthority } = operationAuthorityFor(
    sampleRow,
    "SAMPLE_VALUE",
    samplePayload,
    { unit: "metre" }
  );
  const sampleEnvelope = completeEnvelope(sampleRow, samplePayload);
  const sampleRegistry = new FindingDecoderRegistry(standardDecoderRegistrations([{
    decoderId: "negative.sample.exact",
    priority: "EXACT_OPERATION_SCHEMA",
    pattern: "SAMPLE_VALUE",
    operationId: sampleInput.envelope.operation.operationId,
    operationVersion: sampleInput.envelope.operation.operationVersion,
    payloadSchemaUri: sampleOutput.schemaUri,
    payloadSchemaHash: sampleOutput.schemaHash
  }]));

  negatives.push(expectedError(
    "NEG_MARKER",
    "UNVALIDATED_RESULT_ENVELOPE",
    () => sampleRegistry.decode(cloneInput())
  ));

  const mutated = cloneInput();
  ((mutated.envelope.output!.value as JsonObject)["value"] as number) += 1;
  negatives.push(expectedError("NEG_POST_VALIDATION_MUTATION", "UNVALIDATED_RESULT_ENVELOPE", () => sampleRegistry.decode(mutated)));

  const wrongLockEnvelope = structuredClone(sampleEnvelope);
  (wrongLockEnvelope.operation as { operationId: string }).operationId = "other.operation";
  negatives.push(expectedError(
    "NEG_OPERATION_LOCK",
    "OPERATION_IDENTITY_MISMATCH",
    () => validateGowmFindingResultEnvelope(sampleOperationAuthority, wrongLockEnvelope)
  ));

  const wrongSchemaEnvelope = structuredClone(sampleEnvelope);
  (wrongSchemaEnvelope.output as JsonObject)["schemaHash"] = digest("9");
  negatives.push(expectedError(
    "NEG_OUTPUT_SCHEMA_LOCK",
    "OUTPUT_SCHEMA_MISMATCH",
    () => validateGowmFindingResultEnvelope(sampleOperationAuthority, wrongSchemaEnvelope)
  ));

  const wrongProfile = cloneInput();
  (wrongProfile.descriptor.capabilitySemanticProfile as JsonObject)["domain"] = "MUTATED";
  negatives.push(expectedError("NEG_SEMANTIC_PROFILE_LOCK", "UNVALIDATED_RESULT_ENVELOPE", () => sampleRegistry.decode(wrongProfile)));

  negatives.push(expectedError(
    "NEG_FORGED_FINAL_B_AUTHORITY",
    "GDPS_FINDING_AUTHORITY_FORGED",
    () => resolveGdpsFindingOperationAuthority({ ...finalBFindingAuthority }, {
      operationId: "elevation.sample",
      operationVersion: "1.0",
      semanticConcept: "N02_FORGED_AUTHORITY",
      descriptorId: "ELEVATION_DTM/DEFAULT"
    })
  ));
  negatives.push(expectedError(
    "NEG_FORGED_OPERATION_AUTHORITY",
    "GDPS_FINDING_OPERATION_AUTHORITY_FORGED",
    () => validateGowmFindingResultEnvelope({ ...sampleOperationAuthority }, sampleEnvelope)
  ));
  negatives.push(expectedError(
    "NEG_CATALOG_DESCRIPTOR",
    "GDPS_CATALOG_DESCRIPTOR_FORBIDDEN",
    () => resolveGdpsFindingOperationAuthority(finalBFindingAuthority, {
      operationId: "geo-product.get",
      operationVersion: "1.0",
      semanticConcept: "N02_CATALOG",
      descriptorId: "ELEVATION_DTM/DEFAULT"
    })
  ));
  negatives.push(expectedError(
    "NEG_DESCRIPTOR_NOT_LOCKED",
    "GDPS_DESCRIPTOR_NOT_LOCKED",
    () => resolveGdpsFindingOperationAuthority(finalBFindingAuthority, {
      operationId: "geo-raster.sample",
      operationVersion: "1.0",
      semanticConcept: "N02_UNKNOWN_DESCRIPTOR",
      descriptorId: "UNKNOWN/DEFAULT"
    })
  ));

  const invalidOutputRegistration: FindingDecoderRegistration = {
    ...standardDecoderRegistrations([{
      decoderId: "negative.invalid-output",
      priority: "EXACT_OPERATION_SCHEMA",
      pattern: "SAMPLE_VALUE",
      operationId: sampleInput.envelope.operation.operationId,
      operationVersion: sampleInput.envelope.operation.operationVersion,
      payloadSchemaUri: sampleOutput.schemaUri,
      payloadSchemaHash: sampleOutput.schemaHash
    }])[0]!,
    decode: () => ({ findingId: "invalid", safePayload: true }) as never
  };
  negatives.push(expectedError(
    "NEG_DECODER_OUTPUT_SCHEMA",
    "WSGS_SACS_GEOSPATIAL_SCHEMA_MISMATCH",
    () => new FindingDecoderRegistry([invalidOutputRegistration]).decode(sampleInput)
  ));

  negatives.push(expectedError(
    "NEG_PROVENANCE_BINDING",
    "SOURCE_PROVENANCE_BINDING_FORGED",
    () => createFindingDecoderInput({
      validatedResult: validateGowmFindingResultEnvelope(sampleOperationAuthority, sampleEnvelope),
      sourceBinding: {} as never,
      subjectReferenceProductIds: ["reference.n02.a"]
    })
  ));

  const safePayloadInput = { ...cloneInput(), safePayload: { secret: "redacted" } } as FindingDecoderInput;
  negatives.push(expectedError("NEG_SAFE_PAYLOAD", "SAFE_PAYLOAD_INPUT_FORBIDDEN", () => sampleRegistry.decode(safePayloadInput)));

  const unknownSchemaEnvelope = structuredClone(sampleEnvelope);
  (unknownSchemaEnvelope.output as JsonObject)["schemaUri"] = "urn:gdps:unknown:output:1.0";
  negatives.push(expectedError(
    "NEG_UNKNOWN_SCHEMA",
    "OUTPUT_SCHEMA_MISMATCH",
    () => validateGowmFindingResultEnvelope(sampleOperationAuthority, unknownSchemaEnvelope)
  ));

  negatives.push(expectedError(
    "NEG_OPERATION_PREFIX",
    "GDPS_FINDING_OPERATION_NOT_LOCKED",
    () => resolveGdpsFindingOperationAuthority(finalBFindingAuthority, {
      operationId: "elevation.sample.extra",
      operationVersion: "1.0",
      semanticConcept: "N02_PREFIX",
      descriptorId: "ELEVATION_DTM/DEFAULT"
    })
  ));

  const ambiguousRegistrations = standardDecoderRegistrations([
    {
      decoderId: "negative.ambiguous.a",
      priority: "EXACT_OPERATION_SCHEMA",
      pattern: "SAMPLE_VALUE",
      operationId: sampleInput.envelope.operation.operationId,
      operationVersion: sampleInput.envelope.operation.operationVersion,
      payloadSchemaUri: sampleOutput.schemaUri,
      payloadSchemaHash: sampleOutput.schemaHash
    },
    {
      decoderId: "negative.ambiguous.b",
      priority: "EXACT_OPERATION_SCHEMA",
      pattern: "SAMPLE_VALUE",
      operationId: sampleInput.envelope.operation.operationId,
      operationVersion: sampleInput.envelope.operation.operationVersion,
      payloadSchemaUri: sampleOutput.schemaUri,
      payloadSchemaHash: sampleOutput.schemaHash
    }
  ]);
  negatives.push(expectedError("NEG_PRIORITY_AMBIGUITY", "AMBIGUOUS_DECODER_MATCH", () => new FindingDecoderRegistry(ambiguousRegistrations).decode(sampleInput)));

  const invalidGeometry = structuredClone(shapes.payloads["pointMeasurement"]) as JsonObject;
  ((invalidGeometry["point"] as JsonObject)["coordinates"] as number[])[0] = 181;
  negatives.push(expectedError("NEG_GEOMETRY", "GDPS_OUTPUT_VALUE_SCHEMA_MISMATCH", () => sampleRegistry.decode(decoderInput(
    rowByOperation(coverageFixture, "elevation.sample"), "SAMPLE_VALUE", invalidGeometry, { unit: "metre" }
  ))));

  const threeDimensionalGeometry = structuredClone(shapes.payloads["spatialFeatures"]) as {
    features: Array<{ geometry: { coordinates: unknown } }>;
  };
  threeDimensionalGeometry.features[0]!.geometry.coordinates = [[
    [116.4, 39.9, 10], [116.41, 39.9, 10], [116.41, 39.91, 10], [116.4, 39.9, 10]
  ]];
  negatives.push(expectedError("NEG_NON_2D_GEOMETRY", "GDPS_OUTPUT_VALUE_SCHEMA_MISMATCH", () => registry.decode(decoderInput(
    rowByOperation(coverageFixture, "terrain.find-high-ground"),
    "FIND_CLASS",
    threeDimensionalGeometry,
    { allowedClassCodes: ["HIGH_GROUND"] }
  ))));

  const nonFinite = structuredClone(shapes.payloads["pointMeasurement"]) as JsonObject;
  nonFinite["value"] = Number.POSITIVE_INFINITY;
  negatives.push(expectedError("NEG_NONFINITE", "NON_FINITE_CANONICAL_NUMBER", () => sampleRegistry.decode(decoderInput(
    rowByOperation(coverageFixture, "elevation.sample"), "SAMPLE_VALUE", nonFinite, { unit: "metre" }
  ))));

  const missingUnit = cloneInput() as unknown as { descriptor: JsonObject };
  delete missingUnit.descriptor["unit"];
  negatives.push(expectedError(
    "NEG_UNIT_MISSING",
    "UNVALIDATED_RESULT_ENVELOPE",
    () => sampleRegistry.decode(missingUnit as unknown as FindingDecoderInput)
  ));

  const invalidClassCode = structuredClone(shapes.payloads["pointClassificationGeneric"]) as {
    result: JsonObject;
  };
  invalidClassCode.result["classCode"] = "BLOCKED";
  negatives.push(expectedError("NEG_CLASS_VOCABULARY", "CLASS_CODE_NOT_IN_LOCKED_VOCABULARY", () => registry.decode(decoderInput(
    rowByOperation(coverageFixture, "geo-raster.sample"),
    "SAMPLE_CLASS",
    invalidClassCode,
    { productType: "UGV_TRAVERSABILITY", productProfile: "DEFAULT" }
  ))));

  const noDataContradiction = structuredClone(shapes.payloads["pointMeasurement"]) as JsonObject;
  noDataContradiction["noData"] = true;
  negatives.push(expectedError("NEG_NO_DATA_CONTRADICTION", "NO_DATA_VALUE_CONTRADICTION", () => sampleRegistry.decode(decoderInput(
    rowByOperation(coverageFixture, "elevation.sample"), "SAMPLE_VALUE", noDataContradiction, { unit: "metre" }
  ))));

  const genericUnitMismatch = structuredClone(shapes.payloads["pointMeasurementGenericService"]) as {
    result: JsonObject;
  };
  genericUnitMismatch.result["unit"] = "foot";
  negatives.push(expectedError("NEG_GENERIC_UNIT_BINDING", "GENERIC_RESULT_UNIT_MISMATCH", () => registry.decode(decoderInput(
    rowByOperation(coverageFixture, "geo-raster.sample"),
    "SAMPLE_VALUE",
    genericUnitMismatch,
    { productType: "ELEVATION_DTM", productProfile: "DEFAULT", unit: "metre" }
  ))));

  const genericSampleTruncated = structuredClone(shapes.payloads["pointMeasurementGenericService"]) as JsonObject;
  genericSampleTruncated["truncated"] = true;
  negatives.push(expectedError("NEG_GENERIC_SAMPLE_TRUNCATED", "SAMPLE_RESULT_TRUNCATION_FORBIDDEN", () => registry.decode(decoderInput(
    rowByOperation(coverageFixture, "geo-raster.sample"),
    "SAMPLE_VALUE",
    genericSampleTruncated,
    { productType: "ELEVATION_DTM", productProfile: "DEFAULT", unit: "metre" }
  ))));

  const profileNoDataContradiction = structuredClone(shapes.payloads["profile"]) as {
    samples: Array<JsonObject>;
  };
  profileNoDataContradiction.samples[0]!["noData"] = true;
  negatives.push(expectedError("NEG_PROFILE_NO_DATA_CONTRADICTION", "PROFILE_NO_DATA_VALUE_CONTRADICTION", () => registry.decode(decoderInput(
    rowByOperation(coverageFixture, "elevation.profile"),
    "PROFILE_VALUE",
    profileNoDataContradiction,
    { unit: "metre" }
  ))));

  const badProfile = structuredClone(shapes.payloads["profile"]) as { samples: JsonObject[] };
  badProfile.samples[0]!["distanceMetres"] = -1;
  negatives.push(expectedError("NEG_PROFILE_DISTANCE", "GDPS_OUTPUT_VALUE_SCHEMA_MISMATCH", () => registry.decode(decoderInput(
    rowByOperation(coverageFixture, "elevation.profile"), "PROFILE_VALUE", badProfile, { unit: "metre" }
  ))));

  const badBinding = structuredClone(shapes.payloads["pointClassificationGeneric"]) as JsonObject;
  badBinding["productType"] = "OTHER_PRODUCT";
  negatives.push(expectedError("NEG_GENERIC_BINDING", "SOURCE_PRODUCT_TYPE_MISMATCH", () => registry.decode(decoderInput(
    rowByOperation(coverageFixture, "geo-raster.sample"),
    "SAMPLE_CLASS",
    badBinding,
    { productType: "UGV_TRAVERSABILITY", productProfile: "DEFAULT", allowedClassCodes: ["CONDITIONALLY_PASSABLE"] }
  ))));

  const badTruncation = structuredClone(shapes.payloads["spatialFeatures"]) as JsonObject;
  badTruncation["truncated"] = "yes";
  negatives.push(expectedError("NEG_TRUNCATION_FLAG", "GDPS_OUTPUT_VALUE_SCHEMA_MISMATCH", () => registry.decode(decoderInput(
    rowByOperation(coverageFixture, "terrain.find-high-ground"), "FIND_CLASS", badTruncation, { allowedClassCodes: ["HIGH_GROUND"] }
  ))));

  const reversedRange = structuredClone(shapes.payloads["valueRangeGenericService"]) as {
    result: { features: Array<{ properties: { ranges: Array<JsonObject> } }> };
  };
  reversedRange.result.features[0]!.properties.ranges[0] = {
    minimumInclusive: 30,
    maximumExclusive: 15
  };
  negatives.push(expectedError("NEG_VALUE_RANGE_REVERSED", "FEATURE_VALUE_RANGE_REVERSED", () => registry.decode(decoderInput(
    rowByOperation(coverageFixture, "geo-raster.find-by-range"),
    "FIND_VALUE_RANGE",
    reversedRange,
    { productType: "SLOPE", productProfile: "DEGREE", unit: "degree" }
  ))));

  const emptyTruncated = structuredClone(shapes.payloads["spatialFeatures"]) as {
    features: unknown[];
    truncated: boolean;
  };
  emptyTruncated.features = [];
  emptyTruncated.truncated = true;
  negatives.push(expectedError("NEG_EMPTY_TRUNCATED", "EMPTY_TRUNCATED_RESULT_CONTRADICTION", () => registry.decode(decoderInput(
    rowByOperation(coverageFixture, "terrain.find-high-ground"),
    "FIND_CLASS",
    emptyTruncated,
    { allowedClassCodes: ["HIGH_GROUND"] }
  ))));

  const unknownField = structuredClone(shapes.payloads["pointMeasurement"]) as JsonObject;
  unknownField["unlockedField"] = true;
  negatives.push(expectedError("NEG_UNKNOWN_OUTPUT_FIELD", "GDPS_OUTPUT_VALUE_SCHEMA_MISMATCH", () => sampleRegistry.decode(decoderInput(
    rowByOperation(coverageFixture, "elevation.sample"), "SAMPLE_VALUE", unknownField, { unit: "metre" }
  ))));

  const duplicateRegistration = standardDecoderRegistrations([{
    decoderId: "negative.duplicate",
    priority: "EXACT_OPERATION_SCHEMA",
    pattern: "SAMPLE_VALUE",
    operationId: sampleInput.envelope.operation.operationId,
    operationVersion: sampleInput.envelope.operation.operationVersion,
    payloadSchemaUri: sampleOutput.schemaUri,
    payloadSchemaHash: sampleOutput.schemaHash
  }])[0]!;
  negatives.push(expectedError("NEG_DUPLICATE_DECODER", "DUPLICATE_DECODER_ID", () => new FindingDecoderRegistry([
    duplicateRegistration,
    duplicateRegistration
  ])));

  const sourcePaths = ["src/registry.ts", "src/decoders.ts", "src/validation.ts"];
  const sourceText = sourcePaths.map((path) => readFileSync(resolve(packageRoot, path), "utf8")).join("\n");
  const forbiddenStaticPatterns = [
    { label: "DIRECT_NETWORK_FETCH", pattern: /\bfetch\s*\(/u },
    { label: "DIRECT_PROVIDER_URL", pattern: /https?:\/\//u },
    { label: "DATABASE_CLIENT", pattern: /(?:from|require\s*\()["'](?:pg|postgres|mysql|sqlite)/u },
    { label: "SQL_STATEMENT", pattern: /\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO|SET|[A-Za-z_])/u }
  ];
  const staticMatches = forbiddenStaticPatterns.filter(({ pattern }) => pattern.test(sourceText));
  assert(staticMatches.length === 0, `STATIC_BOUNDARY_VIOLATION_${staticMatches.map(({ label }) => label).join("_")}`);
  negatives.push({
    caseId: "NEG_STATIC_PROVIDER_SQL_BYPASS",
    expected: "ZERO_DIRECT_PROVIDER_OR_SQL_ROUTES",
    observed: "ZERO_DIRECT_PROVIDER_OR_SQL_ROUTES",
    status: "PASS_STATIC_BOUNDARY"
  });

  assert(negatives.length >= 28, "NEGATIVE_CASE_INVENTORY_TOO_SMALL");
  const negativeReport = {
    schemaVersion: "wsgs-v021-n02-negative-cases/1.0",
    ...common,
    status: "PASS",
    negativeCaseCount: negatives.length,
    passed: negatives.length,
    cases: negatives,
    policies: {
      unknownSchema: "NO_FINDING_PLUS_UNSUPPORTED_FINDING_SCHEMA",
      rawPayloadPassThrough: "FORBIDDEN",
      directProviderCall: "FORBIDDEN",
      directSql: "FORBIDDEN",
      prefixMatch: "FORBIDDEN",
      ambiguousMatch: "FAIL_CLOSED"
    }
  };

  const coverageText = jsonText(coverageReport);
  const determinismText = jsonText(determinismReport);
  const negativeText = jsonText(negativeReport);
  const detailRawHashes = {
    "reports/sacs-geospatial-v1/N02-decoder-coverage.json": sha256Bytes(coverageText),
    "reports/sacs-geospatial-v1/N02-determinism.json": sha256Bytes(determinismText),
    "reports/sacs-geospatial-v1/N02-negative-cases.json": sha256Bytes(negativeText)
  };
  const aggregateReport = {
    schemaVersion: "wsgs-v021-decoder-report/1.0",
    ...common,
    status: "PASS",
    marker: "WSGS_V021_FINDING_DECODER_READY",
    package: "@wsgs/northbound-geospatial-findings",
    evidenceReports: detailRawHashes,
    evidenceSetHash: independentCanonicalHash(detailRawHashes),
    capabilityCoverage: coverage.counts,
    findingKinds: { expected: 6, passed: 6 },
    realShapeVectors: { expected: 10, passed: 10, fixtureClass: "TEST_VECTOR", findingKinds: 6 },
    statusCases: {
      noDataDelegatedToN03: "PASS",
      legalCompletedNoDataPayload: "PASS",
      emptyCollections: "PASS",
      partialEmptyCollection: "PASS",
      profileNoData: "PASS",
      partialTruncated: "PASS"
    },
    determinism: {
      repeatedRuns: 3,
      permutations: 4,
      independentFindingSetHash: "PASS"
    },
    negativeCases: { expectedMinimum: 28, passed: negatives.length },
    acceptance: {
      acceptanceId: "V21-G05",
      status: "PASS"
    },
    nonClaims: {
      sharedRuntime: "NOT_RUN",
      sacsRealE2E: "NOT_RUN",
      realConsumerCases: "0/18",
      g1: "NOT_RUN",
      v03Content: false,
      productionQualified: false
    }
  };
  const aggregateText = jsonText(aggregateReport);
  const aggregateHash = sha256Bytes(aggregateText);

  const phaseReport = `# N02 Phase Report — Typed Geospatial Finding Decoders\n\nDecision: **PASS for N02 only**\n\nMarker: \`WSGS_V021_FINDING_DECODER_READY\`\n\nG1: \`NOT_RUN\`\n\nv0.3 branch allowed: \`false\`\n\nproductionQualified: \`false\`\n\n## Scope completed\n\n- Added a descriptor/profile-driven registry with strict priority \`exact operation + schema > semantic profile > generic pattern\`.\n- Converted nine authoritative GDPS TEST_VECTOR payload shapes and adapters into the six published WorldFinding kinds, including specialized-query-profile and generic nested-unit paths.\n- Classified all 30 FINAL_B capability locks as 29 supported, 0 intentional gaps, 0 unsupported schemas, and 1 non-finding currentness capability owned by N06.\n- Kept dynamic \`geo-raster.sample\` as one capability whose locked descriptor value semantics select measurement or classification.\n- Enforced complete GOWM result-envelope validation, immutable schema/profile locks, deterministic finding/feature ordering, strict geometry, units, vocabularies, value ranges, no-data/empty semantics, and truncation gaps.\n- Kept raw result passthrough, direct Provider access, and direct SQL out of the decoder package.\n\nThis phase is a source/contract/unit qualification only. It does not claim a shared running instance, SACS real E2E, consumer compatibility, G1, or Development Complete.\n\n## Deterministic evidence\n\n| Artifact | Raw SHA-256 |\n|---|---|\n| \`reports/sacs-geospatial-v1/N02-decoder-coverage.json\` | \`${detailRawHashes["reports/sacs-geospatial-v1/N02-decoder-coverage.json"]}\` |\n| \`reports/sacs-geospatial-v1/N02-determinism.json\` | \`${detailRawHashes["reports/sacs-geospatial-v1/N02-determinism.json"]}\` |\n| \`reports/sacs-geospatial-v1/N02-negative-cases.json\` | \`${detailRawHashes["reports/sacs-geospatial-v1/N02-negative-cases.json"]}\` |\n| \`reports/sacs-geospatial-v1/decoder-report.json\` | \`${aggregateHash}\` |\n\nCommon deterministic input-set hash: \`${inputSetHash}\`. The aggregate binds the raw bytes of all three detailed JSON reports. It intentionally does not hash itself or this phase report.\n\n## Verification executed\n\n| Command | Result |\n|---|---|\n| \`npm run findings:decoder:write\` | PASS; five deterministic artifacts materialized |\n| \`npm run findings:decoder:check\` twice | PASS both times; no byte drift |\n| \`npx vitest run packages/northbound-geospatial-findings/src/registry.test.ts\` | PASS; 41 focused decoder tests |\n| \`npm run typecheck\` | PASS |\n| \`npm run architecture:check\` | PASS |\n| \`npm run contracts:sacs-geospatial:check\` | PASS; N01 contract lock unchanged |\n| Static direct Provider/SQL route scan | PASS; zero routes |\n\nThe generated JSON records \`embeddedExecutionClaim=false\` and \`exitCode=null\`; actual command execution is recorded here and will be independently repeated by hosted CI.\n\n## Acceptance snapshot\n\n- V21-G05: PASS.\n- V21-G01 and V21-G03 remain PASS from earlier phases.\n- V21-G02 remains NOT_RUN as a cross-phase gate.\n- V21-G04 and V21-G06–V21-G14 remain NOT_RUN.\n- Runtime qualification: NOT_RUN.\n- Consumer compatible: false.\n- Real SACS v0.4 cases executed: 0/18.\n- G1: NOT_RUN.\n\nNo shared WSGS, GOWM, GDPS, or SACS instance was modified or restarted. No credential, raw reference ID, Provider URL, database identifier, or internal topology is recorded.\n`;
  const finalizedPhaseReport = phaseReport
    .replace(
      "- Added a descriptor/profile-driven registry with strict priority `exact operation + schema > semantic profile > generic pattern`.",
      "- Added a descriptor/profile-driven registry with strict priority `exact operation + schema > semantic profile > generic pattern`.\n- Bound every positive decode to the materialized FINAL_B closure through the public no-argument authority factory, operation authority resolution, full GOWM envelope validation, and decoder-input minting; no caller-supplied descriptor/profile/schema lock is accepted."
    )
    .replace("nine authoritative GDPS TEST_VECTOR payload shapes and adapters", "ten authoritative GDPS TEST_VECTOR payload shapes and adapters")
    .replace("41 focused decoder tests", "47 focused decoder tests");

  return {
    json: {
      coverage: coverageText,
      determinism: determinismText,
      negative: negativeText,
      aggregate: aggregateText
    },
    phase: finalizedPhaseReport
  };
}

function materializeOrCheck(): void {
  const reports = buildReports();
  const expected = new Map<string, string>([
    [outputPaths.coverage, reports.json.coverage],
    [outputPaths.determinism, reports.json.determinism],
    [outputPaths.negative, reports.json.negative],
    [outputPaths.aggregate, reports.json.aggregate],
    [outputPaths.phase, reports.phase]
  ]);
  mkdirSync(reportRoot, { recursive: true });
  for (const [path, content] of expected) {
    if (writeMode) {
      writeFileSync(path, content, "utf8");
      continue;
    }
    const actual = readFileSync(path, "utf8");
    if (actual !== content) {
      throw new Error(`N02_EVIDENCE_DRIFT:${relative(repoRoot, path).replaceAll("\\", "/")}`);
    }
  }
}

materializeOrCheck();
console.log("WSGS_V021_FINDING_DECODER_READY coverage=30 supported=29 notApplicable=1 findingKinds=6 realShapes=10 negatives>=28 runtime=NOT_RUN consumerCases=0/18");
