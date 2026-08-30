import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function before(text: string, first: string, second: string): void {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  expect(firstIndex, `missing ${first}`).toBeGreaterThanOrEqual(0);
  expect(secondIndex, `missing ${second}`).toBeGreaterThanOrEqual(0);
  expect(firstIndex, `${first} must precede ${second}`).toBeLessThan(secondIndex);
}

function beforeLast(text: string, first: string, second: string): void {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.lastIndexOf(second);
  expect(firstIndex, `missing ${first}`).toBeGreaterThanOrEqual(0);
  expect(secondIndex, `missing final ${second}`).toBeGreaterThanOrEqual(0);
  expect(firstIndex, `${first} must precede final ${second}`).toBeLessThan(secondIndex);
}

describe("real GDPS v0.2.1 orchestration boundary", () => {
  it("runs every source, handoff, live-lock, and typed preflight before Docker mutation", () => {
    const runner = source("validation/scripts/run-real-gdps-integration.ps1");
    const mutation = "$containerId = docker run -d";
    beforeLast(runner, "$sourceCommit = Get-CleanSourceCommit", mutation);
    beforeLast(runner, '"gdps:v021:intake:check"', mutation);
    beforeLast(runner, '"--w43-driver-source"', mutation);
    beforeLast(runner, '"--gateway-canary-source"', mutation);
    beforeLast(runner, '"gdps:v021:operation-lock:check"', mutation);
    beforeLast(runner, '$env:WSGS_GDPS_PREFLIGHT_ONLY = "YES"', mutation);
    beforeLast(runner, '"gate:real:development"', mutation);
    beforeLast(runner, '$gdpsProviderRecipeLockArtifact = Get-RequiredArtifactSha256', mutation);
  });

  it("uses a unique database container and removes only the exact container created by this invocation", () => {
    const runner = source("validation/scripts/run-real-gdps-integration.ps1");
    expect(runner).toContain('$databaseContainer = "wsgs-gdps-postgres-" + [Guid]::NewGuid()');
    expect(runner).toContain("function Remove-CreatedDatabaseContainer");
    expect(runner).toContain('$id = $script:createdDatabaseContainerId');
    expect(runner).toContain('$name -ne "/$databaseContainer"');
    expect(runner).toContain('$script:createdDatabaseContainerId = $containerId.Trim()');
    expect(runner).toContain("docker rm -f $id");
    expect(runner).not.toContain("docker ps -aq");
    expect(runner).not.toContain("docker rm -f $databaseContainer");
    expect(runner).not.toContain("Remove-ExactDatabaseContainer");
  });

  it("binds the upstream provider recipe lock and rejects the legacy evidence switch", () => {
    const runner = source("validation/scripts/run-real-gdps-integration.ps1");
    expect(runner).toContain('GDPS_RECIPE_LOCK.json');
    expect(runner).toContain('WSGS_GDPS_PROVIDER_RECIPE_LOCK_FILE');
    expect(runner).toContain('WSGS_GDPS_PROVIDER_RECIPE_LOCK_SHA256');
    before(runner, "if ($LegacyV02Evidence)", "$databaseContainer =");
    expect(runner).toContain("Legacy GDPS v0.2 evidence is not accepted");
  });

  it("restores every imported consumer and temporary process variable on all exit paths", () => {
    const runner = source("validation/scripts/run-real-gdps-integration.ps1");
    expect(runner).toContain("function Get-ProcessEnvironmentSnapshot");
    expect(runner).toContain("function Restore-ProcessEnvironment");
    before(runner, "$processEnvironmentBefore = Get-ProcessEnvironmentSnapshot", "Import-ProcessEnvironment $consumerEnvironment");
    beforeLast(runner, "Import-ProcessEnvironment $consumerEnvironment", "Restore-ProcessEnvironment $processEnvironmentBefore");
    expect(runner).toContain('Remove-Item -LiteralPath ("Env:" + $entry.Name)');
    expect(runner).toContain('Set-Item -LiteralPath ("Env:" + $name) -Value $snapshot[$name]');
  });

  it("executes typed authority preflight before requiring a database URL and reserves full verification for postflight", () => {
    const gate = source("validation/scripts/real-development-pipeline-gate.ts");
    before(gate, "const gdpsRuntimeAuthorityPreflight = loadGdpsV021RuntimeAuthorityPreflight()", 'required("DATABASE_URL")');
    before(gate, "verifyGdpsV021RuntimeAuthorityPreflight(gdpsV021AuthorityPaths())", 'required("DATABASE_URL")');
    expect(gate).toContain('marker: "WSGS_GDPS_V021_RUNTIME_AUTHORITY_PREFLIGHT_PASS"');
    expect(gate).toContain("const gdpsRuntimePostflight = gdpsSuite.mode");
    before(gate, "await resetDatabase()", "const gdpsRuntimePostflight = gdpsSuite.mode");
    expect(gate).not.toContain("GDPS_E2E_PRECONDITION_DRIVER_NOT_READY");
    expect(gate).not.toContain('mode: "LEGACY_V02"');
  });

  it("keeps the focused GOWM R1-R5 run isolated and validates materializer evidence before writing it", () => {
    const gate = source("validation/scripts/real-development-pipeline-gate.ts");
    expect(gate).toMatch(/function loadGdpsV021RuntimeAuthorityPreflight\(\)[\s\S]*?if \(focusedGowmR1R5\) return undefined;/u);
    expect(gate).toMatch(/function loadGdpsV021RuntimePostflight\(\)[\s\S]*?if \(focusedGowmR1R5\) return undefined;/u);
    expect(gate).toMatch(/const gdpsSuite: GdpsCaseSuite = focusedGowmR1R5\s*\? \{ mode: "DISABLED", cases: \[\], totalCaseCount: 0, selectedCaseCount: 0, fullCorpusSelected: false \}\s*: loadFrozenGdpsCaseSuite\(\);/u);
    expect(gate).toMatch(/const validationReference = focusedGowmR1R5\s*\? knownReferenceFromCase\(cases\.find\(\(entry\) => entry\.recipeId === "R1"\)!, "2号车"\)\s*: knownVehicle;/u);
    expect(gate).toContain("validationResultReferenceKeyHashes");
    expect(gate).toContain('...(directValidationProof ? ["reference.validate@1.0"] : [])');
    expect(gate).toContain("...entry.compositionProof.directOperationKeys");
    expect(gate).toContain('summary["validationSourceOperation"] === "reference.validate"');
    expect(gate).toContain("validUntil - evaluatedAt === expectedValidityTtlMs");
    expect(gate).toContain('finalValidationStage?.status === "COMPLETED"');
    expect(gate).toContain('canonicalSourceTreeManifestSchemaVersion: "wsgs-source-tree-manifest/1.0"');
    before(gate, "const validateMaterializer = materializerAjv.compile(materializerSchema);",
      "writeFileSync(reportPath");
    before(gate, "if (!validateMaterializer(materializerReport)) {",
      "writeFileSync(materializerPath");
  });

  it("locks the final GDPS v0.2.1 static handoff and source inventory without claiming W43 runtime", () => {
    const intake = source("validation/scripts/intake-gdps-v021-handoff.mjs");
    const expectedInventory = [
      "GDPS_CONSUMER_LOCK.json",
      "GDPS_CAPABILITY_LOCK.json",
      "GDPS_PRODUCT_DESCRIPTOR_LOCK.json",
      "GDPS_RECIPE_LOCK.json",
      "GDPS_SAMPLE_DATASET_LOCK.json",
      "GOWM_GATEWAY_BINDING_LOCK.json",
      "WSGS_TEST_BASELINE.json",
      "WSGS_QUERY_CORPUS.json",
      "CHECKSUMS.json"
    ];
    const inventoryMatch = /const requiredFiles = (\[[\s\S]*?\]);/u.exec(intake);
    expect(inventoryMatch).not.toBeNull();
    expect(JSON.parse(inventoryMatch![1]!)).toEqual(expectedInventory);

    const expectedFrozenLocks = {
      testBaselineSchemaHash: "sha256:00bd7b9d9648e8bf593a8d453fd1cc27b438a0cef3e21127dd740bf2e58e119e",
      queryCorpusSchemaHash: "sha256:67c69ba0225fbf8c49b9083538af5bb2f18660ff7c91ccf2a099b9f833fefd92",
      queryCorpusHash: "sha256:4f60e2ceb8ff96dcea76952b3bc3369bada54ddbcc12bc755b2ed2ae56a6559a",
      w43CurrentnessContractHash: "sha256:8b684f1f669cb2be50f4be7ffce854ffd3a97dd73563784179345aa7121e30a3",
      w43AttestationSchemaHash: "sha256:9e5e2b77ffa40f699678c4fdeed57d7d946b76829457ecff1d6ead2c030a6097",
      w43DriverSourceHash: "sha256:249930ea8ecdf0a4740f6917b9321cb74f5fce20a57afd8d1d1166a3a5194efd",
      gatewayCanarySourceHash: "sha256:0137926005b5c1879ac612baed76893c1313b2f91511b898b6fafee6c5373f17",
      r06ReportSchemaVersion: "gdps-v021-running-gowm-canaries/2.0",
      r06ReportSchemaHash: "sha256:7fd3531cb967730b567e5cbbe3be7901b45ef9ddd6de9caa219ea75ae0409fbc"
    } as const;
    for (const [key, value] of Object.entries(expectedFrozenLocks)) {
      expect(intake).toContain(`${key}: "${value}"`);
    }

    const intakeSchema = JSON.parse(source(
      "contracts/wsgs-v0.2-gdps/contracts/gdps-handoff-intake.schema.json"
    )) as {
      properties: { locks: { additionalProperties: boolean; required: string[]; properties: Record<string, unknown> } };
    };
    const expectedLockKeys = [
      "consumerLockHash", "capabilityLockHash", "descriptorLockHash", "recipeLockHash",
      "providerRecipeLockHash", "runtimeRecipeLockHash", "checksumHash", ...Object.keys(expectedFrozenLocks),
      "canaryEvidenceHash", "protocolEvidenceHash"
    ];
    expect(intakeSchema.properties.locks.additionalProperties).toBe(false);
    expect(intakeSchema.properties.locks.required).toEqual(expectedLockKeys);
    expect(Object.keys(intakeSchema.properties.locks.properties)).toEqual(expectedLockKeys);

    expect(intake).toContain("WSGS_GDPS_V021_HANDOFF_EXACT_INVENTORY_INVALID");
    expect(intake).toContain('w43Readiness.runtimeQualification === "NOT_RUN"');
    expect(intake).toContain("w43Readiness.driverSourceHash === frozenContractHashes.w43DriverSourceHash");
    expect(intake).toContain("canaryAttestation.runEvidenceHash === canonicalHash(canaryPayload)");
    expect(intake).toContain("canaryAttestation.protocolEvidenceHash === canonicalHash(protocolPayload)");
    const supersededDriverHash = ["sha256:fa13f50273e5bbc5de9b8533e318425", "d9b739727b76df7aee9ec1adf4c7b2a89"].join("");
    const supersededConsumerHead = ["65c3716f956c688f48e08a4", "3322548b75af849b8"].join("");
    expect(intake).not.toContain(supersededDriverHash);
    expect(intake).not.toContain(supersededConsumerHead);
    expect(intake).not.toContain("GDPS_30_CAPABILITY_CANARY.json");
  });

  it("keeps single-case runs diagnostic and publishes final evidence only through the policy evaluator", () => {
    const gate = source("validation/scripts/real-development-pipeline-gate.ts");
    expect(gate).toContain("evaluateGdpsV021Case(expected, observation, context())");
    expect(gate).toContain("buildGdpsV021DiagnosticEvaluation");
    expect(gate).toContain('"typed-case-evaluation.json"');
    expect(gate).toContain("evaluateGdpsV021Report(corpus, reportInput(qualifications))");
    expect(gate).toContain('"WSGS_GDPS_V021_DIAGNOSTIC_COMPLETE"');
    expect(gate).not.toContain('schemaVersion: "wsgs-gdps-real-e2e/2.0"');
    expect(gate).not.toContain("W44_X01_X12_EXTERNAL_QUALIFICATION_NOT_IMPLEMENTED");
    before(gate, '"e2e-report.core.json"', 'schemaVersion: "wsgs-gdps-e2e-validation-receipt/1.0"');
    before(gate, 'schemaVersion: "wsgs-gdps-e2e-validation-receipt/1.0"',
      "evaluateGdpsV021Report(corpus, reportInput([...qualifications, x12]))");
    before(gate, "const gdpsRuntimePostflight = gdpsSuite.mode", "buildGdpsV021PolicyReport({");
  });

  it("derives driver observations from byte-verified persisted facts and blocks direct or mock transport", () => {
    const gate = source("validation/scripts/real-development-pipeline-gate.ts");
    expect(gate).toContain('document["schemaVersion"] !== "wsgs-gdps-driver-evidence/2.0"');
    expect(gate).toContain('document["directProviderCalls"] !== 0');
    expect(gate).toContain('document["mockTransportUsed"] !== false');
    expect(gate).toContain("deriveGatewayTransportFacts");
    expect(gate).not.toContain('entry["transport"] !== "GOWM_GATEWAY"');
    expect(gate).toContain("parsePersistedExecutionFacts");
    expect(gate).toContain("parsePersistedStageFacts");
    expect(gate).toContain("falseFactInferred: falseFacts.length > 0");
    expect(gate).toContain("originalQueryExecuted: originalQueries.length > 0");
    expect(gate).toContain("GDPS_DRIVER_ARTIFACT_TOCTOU");
    // Both the full-corpus and single-case diagnostic paths must bind verified
    // driver bytes to the transport facts derived for that exact execution.
    expect(gate).toMatch(/const driverRecords\s*=\s*verifiedDriverArtifactRecords\(\s*postflight,\s*execution\s*\);/u);
    expect(gate).toMatch(/const driverRecords\s*=\s*input\.postflight\s*\?\s*verifiedDriverArtifactRecords\(\s*input\.postflight,\s*execution\s*\)\s*:\s*\[\];/u);
  });

  it("binds every live and driver fact to one gate run and one derived runtime identity", () => {
    const gate = source("validation/scripts/real-development-pipeline-gate.ts");
    expect(gate).toContain("computeGdpsV021RuntimeIdentity(");
    expect(gate).toContain('schemaVersion: "wsgs-gdps-driver-runtime-identity/1.0"');
    expect(gate).toContain("gdpsRuntimeIdentityHash = canonicalSha256(gdpsDriverRuntimeIdentity)");
    expect(gate).toContain("runGdpsV021DriverOrchestrator({");
    expect(gate).toContain("runtimeIdentity: gdpsDriverRuntimeIdentity");
    expect(gate).toContain("GDPS_DRIVER_GATE_RUN_ID_MISMATCH");
    expect(gate).toContain("GDPS_DRIVER_RUNTIME_IDENTITY_MISMATCH");
    expect(gate).toContain("GDPS_LIVE_REQUEST_RUN_ID_MISMATCH");
    expect(gate).toContain("runtimeIdentityHash: gdpsRuntimeIdentityHash");
    expect(gate).toContain("gateRunId");
  });

  it("invokes all four real drivers through a strict run-scoped sidecar handoff", () => {
    const gate = source("validation/scripts/real-development-pipeline-gate.ts");
    const runner = source("validation/scripts/run-real-gdps-integration.ps1");
    expect(gate).toContain("loadGdpsDriverSidecarContract");
    expect(gate).toContain('WSGS_GDPS_DRIVER_SIDECAR_CONTRACT_SHA256');
    expect(gate).toContain('schemaVersion: "wsgs-gdps-isolated-driver-request/1.0"');
    expect(gate).toContain("executeNaturalLanguageCase: async (request)");
    expect(gate).toContain("submitAndRunGdpsDriver(baseUrl, executor, request)");
    expect(gate).toContain("result.drivers.length !== 4");
    expect(gate).toContain("new Set(result.drivers.map((entry) => entry.caseId)).size !== 4");
    expect(gate).toContain("ISOLATED_DRIVER_SIDECAR_UNAVAILABLE");
    before(gate, "runGdpsV021DriverOrchestrator({", "const gdpsRuntimePostflight = gdpsSuite.mode");
    expect(runner).toContain("[string]$DriverSidecarContractFile");
    expect(runner).toContain("[string]$RequestedGateRunId");
    expect(runner).toContain("four-driver evidence remains NOT_RUN");
    expect(runner).toContain('$env:WSGS_GDPS_DRIVER_SIDECAR_CONTRACT_SHA256 = $driverSidecarArtifact[1]');
    beforeLast(runner, "$driverSidecarArtifact = if ($driverOrchestrationRequired)", "$containerId = docker run -d");
  });

  it("enforces the INITIAL_A to CURRENT_B barrier and treats the corpus sentinel as an any-of assertion", () => {
    const gate = source("validation/scripts/real-development-pipeline-gate.ts");
    const orchestrator = source("validation/scripts/gdps-v021-driver-orchestrator.ts");
    before(orchestrator, 'phase: "CURRENTNESS_SEED"', "await input.crossCurrentnessBarrier({");
    before(orchestrator, "await input.crossCurrentnessBarrier({", 'phase: "CURRENTNESS_REPLAY"');
    expect(orchestrator).toContain("priorGroundings: [{");
    expect(orchestrator).toContain("selectedProductIds: [seed.selectedProductId]");
    expect(orchestrator.match(/priorGroundings: \[\{/gu)?.length).toBe(1);
    expect(gate).toContain('const currentnessStatuses = ["STALE", "SNAPSHOT_MISMATCHED"] as const');
    expect(gate).toContain('expected.id === "NEG-CURRENTNESS" ? "STALE" : persistedNormalizedStatus');
    expect(gate).not.toContain('normalizedStatus: "STALE_OR_SNAPSHOT_MISMATCHED"');
    expect(gate).toContain('targetState: "CURRENT_B"');
    expect(gate).toContain("initialEpochAttestationHash: request.initialEpochAttestationHash");
  });

  it("derives live semantic observations from persisted facts instead of case-id expectations", () => {
    const gate = source("validation/scripts/real-development-pipeline-gate.ts");
    expect(gate).toContain("deriveLiveSemanticFacts");
    expect(gate).toContain("evidence.resultFacts");
    expect(gate).toContain("SELECT status, result_hash, result_bytes FROM wsgs.grounding_result");
    expect(gate).toContain("GDPS_LIVE_RESULT_PERSISTENCE_BINDING_MISMATCH");
    expect(gate).toContain("evidence.runtimeBinding.operationLockHash !== runtime.runtimeOperationLockHash");
    expect(gate).not.toContain("const statusByCase");
    expect(gate).not.toContain('expected.caseType === "POSITIVE"\n    ? { normalizedStatus');
  });

  it("binds the provider recipe tuple to each executed GDPS case", () => {
    const gate = source("validation/scripts/real-development-pipeline-gate.ts");
    expect(gate).toContain("providerRecipeByOperation");
    expect(gate).toContain("providerRecipeBindingForCase");
    expect(gate).toContain("GDPS_PROVIDER_RECIPE_CASE_BINDING_MISSING");
    expect(gate).toContain("GDPS_PROVIDER_RECIPE_HASH_TUPLE_DRIFT");
  });

  it("atomically isolates old canonical final evidence before a real run and never deletes it", () => {
    const gate = source("validation/scripts/real-development-pipeline-gate.ts");
    before(gate, "isolatePriorCanonicalGdpsEvidence", 'required("DATABASE_URL")');
    expect(gate).toContain('const isolatedDirectoryName = "invalidated"');
    expect(gate).toContain("finalEvidenceNames.has(left) ? 0 : 1");
    expect(gate).toContain("renameSync(resolve(evidenceDirectory, name), resolve(isolatedPath, name))");
    expect(gate).toContain('"development-closure-gate.pending.json"');
    expect(gate).toContain("renameSync(pendingSummaryPath, canonicalSummaryPath)");
    expect(gate).not.toContain('.wsgs-v0.2-gdps-v0.2.1-invalidated');
    expect(gate).not.toMatch(/rmSync|unlinkSync|rmdirSync/u);
  });

  it("keeps the closure summary consistent with all sixteen typed case evaluations", () => {
    const gate = source("validation/scripts/real-development-pipeline-gate.ts");
    expect(gate).toContain("assertCompleteTypedCaseSummary");
    expect(gate).toContain("GDPS_TYPED_CASE_SUMMARY_COUNT_MISMATCH");
    expect(gate).toContain("GDPS_TYPED_CASE_SUMMARY_ID_MISMATCH");
    expect(gate).toContain("typedCaseDetails");
  });
});
