import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import {
  compileGdpsV032Requirement,
  type GdpsV032BindingCatalog,
  type GdpsV032CatalogBinding,
  type GdpsV032OperationState,
  type GdpsV032Requirement,
  type GdpsV032TrustedContext
} from "../../packages/query-compiler/src/index.js";

type JsonObject = Record<string, unknown>;

const root = process.cwd();
const gdpsRoot = process.env["GDPS_V032_SOURCE_ROOT"] === undefined
  ? resolve(root, "..", "geospatial-data-product-service-v0.3.2")
  : resolve(process.env["GDPS_V032_SOURCE_ROOT"]!);
const handoffRoot = join(gdpsRoot, "handoff", "gdps-v0.3.2");
const reportRoot = join(root, "reports", "wsgs-gdps-v0.3.2");
const write = process.argv.includes("--write");
const catalog = json(join(root, "contracts", "integrations", "gdps", "wsgs-gdps-binding-catalog.json")) as unknown as GdpsV032BindingCatalog;
const consumer = json(join(handoffRoot, "GDPS_CONSUMER_LOCK.json"));
const checksums = json(join(handoffRoot, "CHECKSUMS.json"));
const intake = json(join(reportRoot, "WSGS_GDPS_HANDOFF_INTAKE_REPORT.json"));
const spatial = jsonIfExists(join(reportRoot, "WSGS_GDPS_SPATIAL_E2E_REPORT.json"));
const availability = jsonIfExists(join(reportRoot, "WSGS_GDPS_AVAILABILITY_E2E_REPORT.json"));
const sources = object(consumer["sources"]);
const currentImplementation = execFileSync(
  "git",
  ["log", "-1", "--format=%H", "--", ".", ":(exclude)reports/**"],
  { cwd: root, encoding: "utf8" }
).trim();
const dirtyImplementation = execFileSync(
  "git",
  ["status", "--porcelain=v1", "--", ".", ":(exclude)reports/**"],
  { cwd: root, encoding: "utf8" }
).trim();
if (dirtyImplementation !== "") throw new Error("V032_BINDING_EVIDENCE_SOURCE_DIRTY");
if (intake["status"] !== "PASS" ||
    object(intake["handoff"])["bundleHash"] !== checksums["bundleHash"] ||
    sources["wsgsSha"] !== currentImplementation ||
    object(intake["sourceTuple"])["currentWsgsHead"] !== currentImplementation) {
  throw new Error("V032_BINDING_EVIDENCE_SOURCE_NOT_CURRENT");
}

const spatialSource = optionalObject(spatial["sources"]);
const spatialCase = optionalArray(spatial["cases"])
  .map(object)
  .find((item) => item["acceptanceId"] === "V032-W05-001");
const spatialExecution = optionalObject(spatialCase?.["execution"]);
const spatialResult = optionalObject(spatialCase?.["result"]);
const temporalEvidence = optionalObject(spatialResult["temporalEvidence"]);
const realSpatialTimeQualified = spatial["status"] === "PASS" &&
  spatialSource["gdpsSha"] === sources["gdpsSha"] &&
  spatialSource["gdpsImplementationTreeHash"] === sources["gdpsImplementationTreeHash"] &&
  object(spatial["sourceTuple"])["wsgsImplementationSha"] === currentImplementation &&
  spatialCase?.["status"] === "PASS" &&
  spatialExecution["terminalStatus"] === "COMPLETED" &&
  spatialExecution["publicGetHttpStatus"] === 200 &&
  temporalEvidence["currentSemantics"] === "CURRENT_AT_QUERY_START" &&
  temporalEvidence["snapshotMode"] === "LATEST_AT_START" &&
  temporalEvidence["dataConsistency"] === "CONSISTENT_AT_START" &&
  temporalEvidence["resourcePinning"] === "PINNED" &&
  typeof temporalEvidence["queryStartedAt"] === "string" &&
  typeof temporalEvidence["dataCapturedAt"] === "string" &&
  typeof temporalEvidence["queryFinishedAt"] === "string" &&
  Date.parse(String(temporalEvidence["queryStartedAt"])) <= Date.parse(String(temporalEvidence["dataCapturedAt"])) &&
  Date.parse(String(temporalEvidence["dataCapturedAt"])) <= Date.parse(String(temporalEvidence["queryFinishedAt"]));

const availabilitySources = optionalObject(availability["sources"]);
const availabilityTuple = optionalObject(availability["sourceTuple"]);
const availabilityContrast = optionalObject(availability["availabilityContrast"]);
const unavailable = optionalObject(availabilityContrast["providerUnavailable"]);
const noData = optionalObject(availabilityContrast["noData"]);
const availabilityQualified = availability["status"] === "PASS" &&
  availabilitySources["gdpsSha"] === sources["gdpsSha"] &&
  availabilitySources["gdpsImplementationTreeHash"] === sources["gdpsImplementationTreeHash"] &&
  availabilityTuple["wsgsImplementationSha"] === currentImplementation &&
  availabilityTuple["bundleHash"] === checksums["bundleHash"] &&
  unavailable["publicPostHttpStatus"] === 503 &&
  unavailable["groundingCreated"] === false &&
  unavailable["noDataResultCreated"] === false &&
  noData["terminalStatus"] === "COMPLETED" &&
  noData["resultCode"] === "PRODUCT_NOT_AVAILABLE" &&
  array(noData["unknowns"]).includes("NO_DATA") &&
  availabilityContrast["classificationsRemainDistinct"] === true &&
  availabilityContrast["providerRestored"] === true &&
  availabilityContrast["wsgsReadinessAfterRestoreHttpStatus"] === 200 &&
  availability["credentialMaterialIncluded"] === false;

const binding = catalog.bindings.find((entry) => entry.bindingId === "SLOPE/DEGREE::SAMPLE_VALUE");
if (binding === undefined) throw new Error("V032_EVIDENCE_BINDING_MISSING");
const requirement: GdpsV032Requirement = {
  schemaVersion: "wsgs-gdps-requirement/1.0",
  requirementId: "evidence-req-1",
  kind: "POINT_VALUE",
  productType: "SLOPE",
  productProfile: "DEGREE",
  geometry: { type: "Point", coordinates: [116.3, 39.9] },
  timeIntent: "CURRENT"
};
const trustedContext: GdpsV032TrustedContext = {
  servicePrincipalId: "wsgs-service",
  dataScope: "scope-gdps-v032",
  maximumGeometryBytes: 16_384
};

function operationState(value: GdpsV032CatalogBinding = binding): GdpsV032OperationState {
  return {
    operationId: value.operationId,
    operationVersion: value.operationVersion,
    maturity: "PREVIEW",
    inputSchemaHash: value.inputSchemaHash,
    outputSchemaHash: value.outputSchemaHash,
    semanticProfileHash: value.semanticProfileHash
  };
}

function compile(values: Partial<{
  requirement: GdpsV032Requirement;
  trustedContext: GdpsV032TrustedContext;
  operationState: GdpsV032OperationState;
}> = {}) {
  return compileGdpsV032Requirement({
    requirement,
    catalog,
    trustedContext,
    operationState: operationState(),
    ...values
  });
}

const implicit = compile();
const explicit = compile({
  trustedContext: {
    ...trustedContext,
    explicitProductSelection: {
      productId: "slope-current-a",
      source: "USER_EXPLICIT",
      descriptorHash: binding.descriptorHash
    }
  }
});
const injectedProduct = compile({
  requirement: { ...requirement, productId: "attacker-product" } as GdpsV032Requirement
});
const maturityEscalation = compile({
  operationState: { ...operationState(), maturity: "STABLE" }
});
const hashDrift = compile({
  operationState: { ...operationState(), inputSchemaHash: "sha256:drift" }
});
const semanticHashDrift = compile({
  operationState: { ...operationState(), semanticProfileHash: "sha256:drift" }
});
const historical = compile({
  requirement: { ...requirement, timeIntent: "HISTORICAL" }
});
const intakeNegativeCases = array(intake["negativeCases"]).map(object);
const intakeDescriptorDriftRejected = intakeNegativeCases.some((entry) =>
  entry["id"] === "DESCRIPTOR_HASH_DRIFT" && entry["status"] === "PASS_FAIL_CLOSED");
const intakeSchemaDriftRejected = intakeNegativeCases.some((entry) =>
  entry["id"] === "INPUT_SCHEMA_HASH_DRIFT" && entry["status"] === "PASS_FAIL_CLOSED");
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const validateRequirement = ajv.compile(json(
  join(root, "contracts", "integrations", "gdps", "wsgs-gdps-requirement.schema.json")
));
const validateCompiledRequest = ajv.compile(json(
  join(root, "contracts", "integrations", "gdps", "wsgs-gdps-compiled-operation.schema.json")
));
if (implicit.status !== "COMPILED" || "productId" in implicit.request.input ||
    explicit.status !== "COMPILED" || explicit.request.input["productId"] !== "slope-current-a" ||
    injectedProduct.status !== "GAP" || injectedProduct.reason !== "INVALID_REQUIREMENT" ||
    maturityEscalation.status !== "GAP" || maturityEscalation.reason !== "MATURITY_NOT_ALLOWED" ||
    hashDrift.status !== "GAP" || hashDrift.reason !== "OPERATION_LOCK_DRIFT" ||
    semanticHashDrift.status !== "GAP" || semanticHashDrift.reason !== "OPERATION_LOCK_DRIFT" ||
    historical.status !== "GAP" || historical.reason !== "HISTORICAL_INTENT_UNSUPPORTED" ||
    !intakeDescriptorDriftRejected || !intakeSchemaDriftRejected) {
  throw new Error("V032_BINDING_COMPILER_FAIL_OPEN");
}
if (!validateRequirement(requirement) ||
    !validateCompiledRequest(implicit.status === "COMPILED" ? implicit.request : null)) {
  throw new Error("V032_BINDING_COMPILER_SCHEMA_INVALID");
}
const compiledText = JSON.stringify(implicit.request);
if (compiledText.includes("providerUrl") || compiledText.includes("allowHistoricalFallback\":true") ||
    implicit.request.operation.operationId !== binding.operationId ||
    implicit.request.operation.operationVersion !== binding.operationVersion ||
    implicit.request.locks.inputSchemaHash !== binding.inputSchemaHash ||
    implicit.request.locks.outputSchemaHash !== binding.outputSchemaHash ||
    implicit.request.locks.semanticProfileHash !== binding.semanticProfileHash ||
    implicit.request.locks.descriptorHash !== binding.descriptorHash) {
  throw new Error("V032_COMPILED_REQUEST_LOCK_DRIFT");
}

const source = {
  gdpsSha: sources["gdpsSha"],
  gdpsImplementationTreeHash: sources["gdpsImplementationTreeHash"]
};
const common = {
  sources: source,
  sourceTuple: {
    ...source,
    wsgsImplementationSha: currentImplementation,
    bundleHash: checksums["bundleHash"]
  },
  credentialMaterialIncluded: false
};
const bindingReport = {
  schemaVersion: "wsgs-gdps-v032-binding-report/1.0",
  status: "PASS",
  provenance: "REAL_WSGS_BINDING_COMPILER_EXECUTION",
  ...common,
  catalog: {
    authority: catalog.authority,
    operationFamilyCount: catalog.operationFamilies.length,
    bindingCount: catalog.bindings.length,
    catalogHash: canonicalHash(catalog),
    defaultProductIdBinding: catalog.policy.defaultProductIdBinding,
    historicalFallback: catalog.policy.historicalFallback
  },
  observations: {
    exactPreviewBindingCompiled: true,
    implicitProductIdPresent: false,
    trustedExplicitProductIdCompiled: true,
    callerProductIdRejected: true,
    maturityEscalationRejected: true,
    operationHashDriftRejected: true
  },
  assertions: [
    { id: "V032-W02-004", status: "PASS", blockingReason: "" },
    { id: "V032-W02-005", status: "PASS", blockingReason: "" }
  ],
  gatewayQualification: "NOT_RUN"
};
const compilerReport = {
  schemaVersion: "wsgs-gdps-v032-compiler-report/1.0",
  status: "PASS",
  provenance: "REAL_WSGS_TYPED_COMPILER_EXECUTION",
  ...common,
  compiler: {
    compiledRequestHash: canonicalHash(implicit.request),
    operation: implicit.request.operation,
    locks: implicit.request.locks,
    inputKeys: Object.keys(implicit.request.input).sort(),
    trustedIdentityBound: implicit.request.authorization.source === "TRUSTED_IDENTITY",
    callerProviderUrlPresent: false,
    callerScopeOverridePresent: false,
    defaultProductIdPresent: false,
    historicalFallbackAllowed: false,
    requirementSchemaValidated: true,
    compiledRequestSchemaValidated: true
  },
  assertions: [
    { id: "V032-W04-001", status: "PASS", blockingReason: "" },
    {
      id: "V032-W04-002",
      status: "NOT_RUN",
      blockingReason: "REAL_GATEWAY_TWO_PRODUCT_AMBIGUITY_NOT_EXECUTED"
    }
  ],
  gatewayQualification: "NOT_RUN"
};
const timeSemanticsReport = {
  schemaVersion: "wsgs-gdps-v032-time-semantics-report/1.0",
  status: "PASS",
  provenance: "REAL_WSGS_TYPED_COMPILER_EXECUTION",
  ...common,
  observations: {
    catalogTimeSemantics: binding.timeSemantics,
    temporalApplicability: binding.evidenceMapping.temporalApplicability,
    compiledSnapshotMode: implicit.request.snapshotPolicy.mode,
    compiledHistoricalFallbackAllowed: implicit.request.snapshotPolicy.allowHistoricalFallback,
    historicalIntentResult: historical,
    realSpatialNormalization: realSpatialTimeQualified ? {
      requestId: object(spatialCase["request"])["requestId"],
      queryStartedAt: temporalEvidence["queryStartedAt"],
      dataCapturedAt: temporalEvidence["dataCapturedAt"],
      queryFinishedAt: temporalEvidence["queryFinishedAt"],
      currentSemantics: temporalEvidence["currentSemantics"],
      snapshotMode: temporalEvidence["snapshotMode"],
      dataConsistency: temporalEvidence["dataConsistency"],
      resourcePinning: temporalEvidence["resourcePinning"],
      contentHash: spatialResult["contentHash"],
      descriptorHash: spatialResult["descriptorHash"],
      publicResponseHash: spatialResult["publicResponseHash"]
    } : {
      status: "NOT_RUN",
      blockingReason: "REAL_SPATIAL_TIME_EVIDENCE_NOT_CURRENT"
    }
  },
  assertions: [
    {
      id: "V032-W08-001",
      status: realSpatialTimeQualified ? "PASS" : "NOT_RUN",
      blockingReason: realSpatialTimeQualified ? "" : "REAL_SPATIAL_TIME_EVIDENCE_NOT_CURRENT"
    },
    { id: "V032-W08-002", status: "PASS", blockingReason: "" }
  ],
  gatewayQualification: realSpatialTimeQualified ? "REAL_PUBLIC_WSGS_GATEWAY_GDPS" : "NOT_RUN"
};
const negativeReport = {
  schemaVersion: "wsgs-gdps-v032-negative-report/1.0",
  status: "PASS",
  provenance: "REAL_WSGS_INTAKE_TYPED_COMPILER_AND_PUBLIC_AVAILABILITY_EXECUTION",
  ...common,
  observations: {
    descriptorHashDriftRejectedByIntake: intakeDescriptorDriftRejected,
    descriptorMismatchRejectedForExplicitSelection:
      compile({
        trustedContext: {
          ...trustedContext,
          explicitProductSelection: {
            productId: "slope-current-a",
            source: "REVALIDATED_PRIOR_REFERENCE",
            descriptorHash: "sha256:drift"
          }
        }
      }),
    inputSchemaHashDriftRejectedByIntake: intakeSchemaDriftRejected,
    inputSchemaHashDriftRejectedByCompiler: hashDrift,
    semanticProfileHashDriftRejectedByCompiler: semanticHashDrift
  },
  availabilityContrast: availabilityQualified ? availabilityContrast : {
    status: "NOT_RUN",
    blockingReason: "REAL_AVAILABILITY_EVIDENCE_NOT_CURRENT"
  },
  assertions: [
    { id: "V032-W10-001", status: "PASS", blockingReason: "" },
    { id: "V032-W10-002", status: "PASS", blockingReason: "" },
    {
      id: "V032-W10-003",
      status: availabilityQualified ? "PASS" : "NOT_RUN",
      blockingReason: availabilityQualified ? "" : "REAL_AVAILABILITY_EVIDENCE_NOT_CURRENT"
    }
  ],
  gatewayQualification: availabilityQualified
    ? "REAL_PUBLIC_WSGS_AND_REAL_GATEWAY_CONTROLLED_UNAVAILABILITY"
    : "NOT_RUN"
};

writeOrCheck(join(reportRoot, "WSGS_GDPS_BINDING_REPORT.json"), bindingReport);
writeOrCheck(join(reportRoot, "WSGS_GDPS_COMPILER_REPORT.json"), compilerReport);
writeOrCheck(join(reportRoot, "WSGS_GDPS_TIME_SEMANTICS_REPORT.json"), timeSemanticsReport);
writeOrCheck(join(reportRoot, "WSGS_GDPS_NEGATIVE_REPORT.json"), negativeReport);
console.log(
  "WSGS_GDPS_V032_BINDING_COMPILER_PASS families=" + catalog.operationFamilies.length +
  " bindings=" + catalog.bindings.length +
  " availability=" + (availabilityQualified ? "PASS" : "NOT_RUN") +
  " spatialTime=" + (realSpatialTimeQualified ? "PASS" : "NOT_RUN")
);

function json(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}
function jsonIfExists(path: string): JsonObject {
  return existsSync(path) ? json(path) : {};
}
function object(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("V032_OBJECT_REQUIRED");
  return value as JsonObject;
}
function optionalObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("V032_ARRAY_REQUIRED");
  return value;
}
function optionalArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  const item = value as JsonObject;
  return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])]));
}
function canonicalHash(value: unknown): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex");
}
function writeOrCheck(path: string, value: unknown): void {
  const content = JSON.stringify(value, null, 2) + "\n";
  if (write) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
    return;
  }
  if (!existsSync(path) || readFileSync(path, "utf8").replaceAll("\r\n", "\n") !== content) {
    throw new Error("V032_BINDING_COMPILER_EVIDENCE_DRIFT:" + path);
  }
}
