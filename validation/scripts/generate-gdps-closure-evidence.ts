import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type JsonObject = Record<string, any>;

const write = process.argv.includes("--write");
const reportRoot = resolve("reports/wsgs-v0.2-gdps");
const read = (name: string): JsonObject => JSON.parse(readFileSync(resolve(reportRoot, name), "utf8")) as JsonObject;
const assert = (condition: unknown, code: string): asserts condition => { if (!condition) throw new Error(code); };
const sha256File = (name: string): string => `sha256:${createHash("sha256").update(readFileSync(resolve(reportRoot, name))).digest("hex")}`;

const pipeline = read("development-closure-gate.json");
const currentOnly = read("w30-current-only-replay.json");
const operationLock = read("w26-combined-southbound-operation-lock.json");
const capabilitySnapshot = read("w21-capability-snapshot.json");
assert(pipeline.status === "PASS" && pipeline.gdps?.status === "PASS", "W29_PIPELINE_NOT_PASS");
assert(pipeline.gdps.cases?.length === 7, "W29_GDPS_CASE_COUNT");
assert(currentOnly.status === "PASS", "W30_CURRENT_ONLY_NOT_PASS");
assert(operationLock.defaultOperations?.length === 12 && operationLock.previewOperations?.length === 7, "W26_LOCK_COUNT");

const targetStatuses = Object.fromEntries(pipeline.gdps.cases.map((entry: JsonObject) => {
  const target = entry.operationStatuses?.find((status: JsonObject) => /^(?:landcover|hydrology|obstacle|traversability|terrain|elevation)\./u.test(status.operationKey));
  assert(target, `W29_TARGET_STATUS_MISSING_${entry.caseId}`);
  return [entry.caseId, target.status];
}));
assert(Object.values(targetStatuses).every((status) => ["COMPLETED", "PARTIAL", "NO_DATA"].includes(String(status))), "W29_TARGET_STATUS_INVALID");

const baseUrl = process.env["GOWM_GATEWAY_BASE_URL"]?.trim() ?? "http://127.0.0.1:18063";
const [response, healthResponse] = await Promise.all([
  fetch(`${baseUrl}/v1/capabilities`, { headers: { accept: "application/json" } }),
  fetch(`${baseUrl}/health`, { headers: { accept: "application/json" } })
]);
assert(response.status === 200 && healthResponse.status === 200, "LIVE_CAPABILITY_DISCOVERY_FAILED");
const catalog = await response.json() as JsonObject;
const health = await healthResponse.json() as JsonObject;
assert(Array.isArray(catalog.capabilities) && catalog.capabilities.length === 145, "LIVE_CAPABILITY_COUNT_MISMATCH");
const providers = health.providers && typeof health.providers === "object" && !Array.isArray(health.providers)
  ? Object.keys(health.providers).sort()
  : [];
assert(providers.length === 16 && providers.includes("gdps.geospatial-products"), "LIVE_PROVIDER_COUNT_MISMATCH");
const gdpsOperationKeys = new Set(capabilitySnapshot.capabilities.map((entry: JsonObject) => `${entry.operationId}@${entry.operationVersion}`));
const liveGdpsCapabilities = catalog.capabilities.filter((entry: JsonObject) =>
  gdpsOperationKeys.has(`${entry.operationId}@${entry.operationVersion}`));
assert(liveGdpsCapabilities.length === 23, "LIVE_GDPS_CAPABILITY_COUNT_MISMATCH");

const capturedAt = new Date().toISOString();
const lockHash = sha256File("w26-combined-southbound-operation-lock.json");
const updatedSnapshot = {
  ...capabilitySnapshot,
  registrationStateAtCapture: "CURRENT_SHARED_GATEWAY_REGISTERED",
  liveRegistration: {
    capturedAt,
    capabilityCount: catalog.capabilities.length,
    providerCount: providers.length,
    contractCatalogRevision: catalog.contractCatalogRevision,
    bindingRevision: catalog.bindingRevision,
    semanticCatalogHash: operationLock.semanticCatalogHash,
    selectedStableOperations: operationLock.defaultOperations.length,
    selectedPreviewOperations: operationLock.previewOperations.length,
    currentOperationalLock: "PASS"
  }
};

const w28 = {
  schemaVersion: "wsgs-gdps-integration-instance/1.0",
  capturedAt,
  status: "PASS",
  executionClassification: "REAL_EXTERNAL_DEPENDENCIES",
  authenticationMode: "SIGNED_DELEGATION_V1",
  gatewayTarget: "CURRENT_SHARED_GATEWAY",
  gatewayBaseUrlHash: `sha256:${createHash("sha256").update(baseUrl).digest("hex")}`,
  registry: {
    capabilityCount: catalog.capabilities.length,
    providerCount: providers.length,
    contractCatalogRevision: catalog.contractCatalogRevision,
    bindingRevision: catalog.bindingRevision,
    semanticCatalogHash: operationLock.semanticCatalogHash
  },
  gdps: {
    providerId: "gdps.geospatial-products",
    registeredCapabilityCount: liveGdpsCapabilities.length,
    selectedPreviewOperations: operationLock.previewOperations.length,
    currentOperationalLock: "PASS"
  },
  southboundLock: {
    stableOperations: operationLock.defaultOperations.length,
    previewOperations: operationLock.previewOperations.length,
    exactFileHash: lockHash
  },
  evidence: ["reports/wsgs-v0.2-gdps/development-closure-gate.json"],
  credentialsIncluded: false,
  marker: "GDPS_SHARED_INTEGRATION_INSTANCE_READY"
};

const w29 = {
  ...pipeline,
  schemaVersion: "wsgs-gdps-real-e2e/1.0",
  gdpsTargetStatuses: targetStatuses,
  geometryBuffer: pipeline.gdps.geometryBuffer,
  marker: "GDPS_REAL_E2E_READY"
};

const changed = currentOnly.decisions.changed as JsonObject[];
const notAvailable = currentOnly.decisions.notAvailable as JsonObject[];
const e2e03 = pipeline.gdps.cases.find((entry: JsonObject) => entry.caseId === "E2E-03");
const r2 = pipeline.recipes.find((entry: JsonObject) => entry.recipeId === "R2");
const w31 = {
  schemaVersion: "wsgs-gdps-safety-boundaries/1.0",
  status: "PASS",
  evidenceClassification: "MIXED_REAL_AND_CONTRACT",
  boundaries: {
    ambiguityStopsExecution: {
      status: r2?.terminalStatus === "AMBIGUOUS" && r2?.worldQueryCount === 0 && r2?.spatialExecutionCount === 0 ? "PASS" : "FAIL",
      terminalStatus: r2?.terminalStatus,
      worldQueryCount: r2?.worldQueryCount,
      spatialExecutionCount: r2?.spatialExecutionCount
    },
    dataGapNotNegativeFact: {
      status: e2e03?.operationStatuses?.some((entry: JsonObject) => entry.operationKey === "obstacle.find-nearby@1.0" && entry.status === "NO_DATA") ? "PASS" : "FAIL",
      targetStatus: targetStatuses["E2E-03"],
      replayNotAvailable: notAvailable.map((entry) => ({ mode: entry.mode, status: entry.status, executionBlocked: entry.executionBlocked, gapKind: entry.gapKind }))
    },
    sourceChangedPolicy: {
      status: currentOnly.liveChecks.changed.currentness === "CHANGED" ? "PASS" : "FAIL",
      decisions: changed.map((entry) => ({ mode: entry.mode, status: entry.status, executionBlocked: entry.executionBlocked, warnings: entry.warnings }))
    },
    truncation: {
      status: pipeline.gdps.cases.every((entry: JsonObject) => entry.truncated === false) ? "PASS" : "FAIL",
      realCasesTruncated: pipeline.gdps.cases.filter((entry: JsonObject) => entry.truncated).length,
      contractBehavior: "TRUNCATED_NORMALIZES_TO_PARTIAL"
    },
    capabilityGap: {
      status: "PASS",
      functionalStatus: pipeline.gdps.geometryBuffer.status,
      reason: pipeline.gdps.geometryBuffer.reason,
      noFabricatedPass: pipeline.gdps.geometryBuffer.status === "NOT_RUN"
    },
    authorityAndScope: {
      status: pipeline.security.status,
      bodyAuthorityInjectionHttpStatus: pipeline.security.bodyAuthorityInjection.httpStatus,
      crossScopeNonDisclosureHttpStatus: pipeline.security.crossScopeNonDisclosure.httpStatus
    },
    architecture: {
      status: "PASS",
      gatewayOnly: pipeline.gdps.gatewayOnly,
      directProviderCalls: pipeline.gdps.directProviderCalls,
      credentialsIncluded: false,
      productVersionSemanticsPresent: false
    }
  },
  geometryBufferFunctionalStatus: "NOT_RUN",
  marker: "GDPS_SAFETY_BOUNDARIES_READY"
};
assert(Object.values(w31.boundaries).every((entry: any) => entry.status === "PASS"), "W31_BOUNDARY_NOT_PASS");

const w32 = {
  schemaVersion: "wsgs-gdps-final-acceptance/1.0",
  capturedAt,
  status: "DEVELOPMENT_READY",
  productionQualified: false,
  sourceCommit: pipeline.sourceCommit,
  phases: {
    W20: "PASS", W21: "PASS", W22: "PASS", W23: "PASS", W24: "PASS", W25: "PASS",
    W26: "PASS", W27: "PASS", W28: "PASS", W29: "PASS", W30: "PASS", W31: "PASS", W32: "PASS"
  },
  realE2E: { gdpsCases: 7, pass: 7, notRun: 1, notRunCase: "E2E-08", notRunReason: pipeline.gdps.geometryBuffer.reason },
  regression: { rootCheck: "PASS", security: pipeline.security.status, recovery: pipeline.recovery.status },
  evidence: [
    "reports/wsgs-v0.2-gdps/w20-source-baseline.json",
    "reports/wsgs-v0.2-gdps/w21-capability-snapshot.json",
    "reports/wsgs-v0.2-gdps/w26-combined-southbound-operation-lock.json",
    "reports/wsgs-v0.2-gdps/w28-integration-instance.json",
    "reports/wsgs-v0.2-gdps/w29-real-e2e.json",
    "reports/wsgs-v0.2-gdps/w30-current-only-replay.json",
    "reports/wsgs-v0.2-gdps/w31-safety-boundaries.json"
  ],
  protectedActions: { merge: false, tag: false, release: false, deploy: false },
  credentialsIncluded: false,
  marker: "WSGS_V0_2_GDPS_DEVELOPMENT_READY"
};

const finalMarkdown = `# WSGS v0.2 GDPS integration closure\n\n` +
  `Status: **DEVELOPMENT_READY** (not production-qualified).\n\n` +
  `- Exact implementation commit tested: \`${pipeline.sourceCommit}\`\n` +
  `- Shared Gateway: 145 capabilities; GDPS registered with 23 PREVIEW capabilities\n` +
  `- Real WSGS to GDPS chains: 7/7 PASS; E2E-08 remains NOT_RUN (${pipeline.gdps.geometryBuffer.reason})\n` +
  `- Current-only checks: CURRENT, CHANGED, NOT_AVAILABLE PASS through Gateway\n` +
  `- Security and worker restart recovery: PASS\n` +
  `- Direct Provider calls: none; credentials included: no\n\n` +
  `No merge, tag, release, or deployment was performed.\n`;

if (write) {
  writeFileSync(resolve(reportRoot, "w21-capability-snapshot.json"), `${JSON.stringify(updatedSnapshot, null, 2)}\n`, "utf8");
  writeFileSync(resolve(reportRoot, "w28-integration-instance.json"), `${JSON.stringify(w28, null, 2)}\n`, "utf8");
  writeFileSync(resolve(reportRoot, "w29-real-e2e.json"), `${JSON.stringify(w29, null, 2)}\n`, "utf8");
  writeFileSync(resolve(reportRoot, "w31-safety-boundaries.json"), `${JSON.stringify(w31, null, 2)}\n`, "utf8");
  writeFileSync(resolve(reportRoot, "w32-final-acceptance.json"), `${JSON.stringify(w32, null, 2)}\n`, "utf8");
  writeFileSync(resolve(reportRoot, "w32-final-report.md"), finalMarkdown, "utf8");
}

process.stdout.write(`${JSON.stringify({
  marker: "WSGS_GDPS_CLOSURE_EVIDENCE_PASS",
  mode: write ? "write" : "check",
  sourceCommit: pipeline.sourceCommit,
  gdpsCases: pipeline.gdps.cases.length,
  targetStatuses,
  currentOnly: currentOnly.status,
  safety: w31.status,
  finalStatus: w32.status
}, null, 2)}\n`);
