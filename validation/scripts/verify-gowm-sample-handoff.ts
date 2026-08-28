import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import {
  defaultGowmConsumerSchemaRegistry,
  loadOperationalGowmLock,
  type OperationalGowmLock
} from "@wsgs/gowm-contract-intake";
import { hashCanonicalJson } from "@wsgs/trusted-capability-snapshot";

type JsonObject = Record<string, unknown>;

const requiredFiles = [
  "CANARY_EVIDENCE_REPORT.json",
  "CANARY_REPORT.json",
  "CONSUMER_CONNECTIVITY_REPORT.json",
  "CONSUMER_CONTRACT_LOCK.json",
  "EXPECTED_CASES.json",
  "INSTANCE_BINDING.json",
  "INSTANCE_BINDING.schema.json",
  "INSTANCE_MANIFEST.json",
  "LOAD_REPORT.json",
  "README.md",
  "SAMPLE_REFERENCE_MAP.json",
  "SAMPLE_WORLD_REALIZATION.json"
] as const;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function assertion(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function object(value: unknown, code: string): JsonObject {
  assertion(value !== null && typeof value === "object" && !Array.isArray(value), code);
  return value as JsonObject;
}

function array(value: unknown, code: string): unknown[] {
  assertion(Array.isArray(value), code);
  return value;
}

function text(value: unknown, code: string): string {
  assertion(typeof value === "string" && value.length > 0, code);
  return value;
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function operationKey(value: JsonObject): string {
  return `${text(value["operationId"], "OPERATION_ID_MISSING")}@${text(value["operationVersion"], "OPERATION_VERSION_MISSING")}`;
}

async function getJson(baseUrl: URL, path: string): Promise<{ status: number; value: unknown; bodyHash: `sha256:${string}` }> {
  const response = await fetch(new URL(path, baseUrl), {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.text();
  assertion(Buffer.byteLength(body, "utf8") <= 16 * 1024 * 1024, "PUBLIC_DISCOVERY_RESPONSE_TOO_LARGE");
  return { status: response.status, value: JSON.parse(body) as unknown, bodyHash: sha256(body) };
}

async function postJsonWithoutAuthentication(
  baseUrl: URL,
  path: string,
  requestId: string,
  body: JsonObject
): Promise<{ status: number; value: unknown; bodyHash: `sha256:${string}` }> {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "x-request-id": requestId },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  });
  const responseBody = await response.text();
  assertion(Buffer.byteLength(responseBody, "utf8") <= 1024 * 1024, "PUBLIC_NEGATIVE_RESPONSE_TOO_LARGE");
  return { status: response.status, value: JSON.parse(responseBody) as unknown, bodyHash: sha256(responseBody) };
}

async function main(): Promise<void> {
  const handoffRoot = resolve(requiredEnvironment("GOWM_SAMPLE_HANDOFF_DIR"));
  const baseUrl = new URL(requiredEnvironment("GOWM_BASE_URL"));
  assertion(baseUrl.protocol === "https:" || ["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname), "INSECURE_REMOTE_GATEWAY_FORBIDDEN");

  const actualFiles = readdirSync(handoffRoot, { withFileTypes: true })
    .map((entry) => {
      assertion(entry.isFile() && !lstatSync(join(handoffRoot, entry.name)).isSymbolicLink(), "HANDOFF_NON_REGULAR_ENTRY");
      return entry.name;
    })
    .sort();
  assertion(JSON.stringify(actualFiles) === JSON.stringify([...requiredFiles].sort()), "HANDOFF_FILE_SET_MISMATCH");

  const allBytes = requiredFiles.map((name) => readFileSync(join(handoffRoot, name)));
  const combinedText = Buffer.concat(allBytes).toString("utf8");
  assertion(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(combinedText), "HANDOFF_PRIVATE_KEY_PRESENT");
  assertion(!/postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/u.test(combinedText), "HANDOFF_DATABASE_CREDENTIAL_PRESENT");
  assertion(!/authorization\s*[:=]\s*["']?Bearer\s+[A-Za-z0-9._~+\/-]{16,}/iu.test(combinedText), "HANDOFF_BEARER_VALUE_PRESENT");

  const manifest = object(json(join(handoffRoot, "INSTANCE_MANIFEST.json")), "MANIFEST_INVALID");
  const binding = object(json(join(handoffRoot, "INSTANCE_BINDING.json")), "BINDING_INVALID");
  const bindingSchema = json(join(handoffRoot, "INSTANCE_BINDING.schema.json"));
  const ajv = new Ajv2020Module.default({ allErrors: true, strict: true });
  addFormatsModule.default(ajv);
  const validateBinding = ajv.compile(bindingSchema);
  assertion(validateBinding(binding), `INSTANCE_BINDING_SCHEMA_MISMATCH:${ajv.errorsText(validateBinding.errors)}`);

  const lockHash = text(manifest["operationLockHash"], "MANIFEST_OPERATION_LOCK_HASH_MISSING") as `sha256:${string}`;
  const loadedLock = loadOperationalGowmLock({
    lockPath: join(handoffRoot, "CONSUMER_CONTRACT_LOCK.json"),
    expectedSha256: lockHash,
    hashMode: "EXACT_BYTES"
  });
  const lock = loadedLock.lock;
  const manifestContract = object(manifest["consumerContract"], "MANIFEST_CONSUMER_CONTRACT_INVALID");
  assertion(lock.consumerContractPackage.name === manifestContract["name"], "HANDOFF_PACKAGE_NAME_MISMATCH");
  assertion(lock.consumerContractPackage.version === manifestContract["version"], "HANDOFF_PACKAGE_VERSION_MISMATCH");
  assertion(lock.consumerContractPackage.integrity === manifestContract["integrity"], "HANDOFF_PACKAGE_INTEGRITY_MISMATCH");
  assertion(lock.contractCatalogRevision === manifest["contractCatalogRevision"], "HANDOFF_CONTRACT_REVISION_MISMATCH");
  assertion(lock.semanticCatalogHash === manifest["semanticCatalogHash"], "HANDOFF_SEMANTIC_HASH_MISMATCH");

  const bindingContracts = array(binding["operationContracts"], "BINDING_OPERATION_CONTRACTS_INVALID").map((entry) => object(entry, "BINDING_OPERATION_CONTRACT_INVALID"));
  const stableOperations = array(manifest["stableOperations"], "MANIFEST_STABLE_OPERATIONS_INVALID").map((entry) => text(entry, "MANIFEST_OPERATION_KEY_INVALID"));
  assertion(bindingContracts.length === 12 && stableOperations.length === 12, "HANDOFF_REQUIRED_OPERATION_COUNT_MISMATCH");
  const defaultOperations = new Map(lock.defaultOperations.map((entry) => [`${entry.operationId}@${entry.operationVersion}`, entry]));
  for (const entry of bindingContracts) {
    const key = operationKey(entry);
    const locked = defaultOperations.get(key);
    assertion(locked !== undefined && stableOperations.includes(key), `HANDOFF_REQUIRED_OPERATION_NOT_LOCKED:${key}`);
    for (const field of ["inputSchemaHash", "outputSchemaHash", "semanticProfileHash", "maturity"] as const) {
      assertion(entry[field] === locked[field], `HANDOFF_OPERATION_CONTRACT_MISMATCH:${key}:${field}`);
    }
  }

  const realization = object(json(join(handoffRoot, "SAMPLE_WORLD_REALIZATION.json")), "REALIZATION_INVALID");
  const loadReport = object(json(join(handoffRoot, "LOAD_REPORT.json")), "LOAD_REPORT_INVALID");
  const referenceMap = object(json(join(handoffRoot, "SAMPLE_REFERENCE_MAP.json")), "REFERENCE_MAP_INVALID");
  const canary = object(json(join(handoffRoot, "CANARY_EVIDENCE_REPORT.json")), "CANARY_INVALID");
  const connectivity = object(json(join(handoffRoot, "CONSUMER_CONNECTIVITY_REPORT.json")), "CONNECTIVITY_INVALID");
  const realizationId = text(binding["realizationId"], "BINDING_REALIZATION_ID_MISSING");
  for (const [name, value] of [["manifest", manifest["instanceId"]], ["realization", realization["realizationId"]], ["referenceMap", referenceMap["realizationId"]], ["canary", canary["realizationId"]], ["connectivity", connectivity["realizationId"]]] as const) {
    assertion(value === realizationId, `HANDOFF_REALIZATION_ID_MISMATCH:${name}`);
  }
  assertion(binding["realizationHash"] === realization["realizationHash"] && binding["realizationHash"] === loadReport["realizationHash"], "HANDOFF_REALIZATION_HASH_MISMATCH");
  assertion(loadReport["status"] === "PASS" && loadReport["idempotent"] === true, "HANDOFF_LOAD_NOT_QUALIFIED");
  const canaryCases = array(canary["cases"], "CANARY_CASES_INVALID").map((entry) => object(entry, "CANARY_CASE_INVALID"));
  assertion(canary["status"] === "PASS" && canaryCases.length === 28 && canaryCases.every((entry) => entry["status"] === "PASS"), "HANDOFF_CANARY_NOT_28_PASS");
  assertion(connectivity["status"] === "PASS" && connectivity["authMode"] === "SIGNED_DELEGATION_V1" && connectivity["operation"] === "reference.get@1.0", "HANDOFF_CONNECTIVITY_NOT_QUALIFIED");
  const expectedCases = array(json(join(handoffRoot, "EXPECTED_CASES.json")), "EXPECTED_CASES_INVALID").map((entry) => object(entry, "EXPECTED_CASE_INVALID"));
  const expectedCaseIds = expectedCases.map((entry) => text(entry["caseId"], "EXPECTED_CASE_ID_MISSING"));
  assertion(expectedCases.length === 13 && new Set(expectedCaseIds).size === 13, "HANDOFF_EXPECTED_CASE_COUNT_MISMATCH");

  const [health, liveness, capabilitiesResponse, semanticsResponse, availabilityResponse] = await Promise.all([
    getJson(baseUrl, "/health"),
    getJson(baseUrl, "/health/live"),
    getJson(baseUrl, "/v1/capabilities"),
    getJson(baseUrl, "/v1/capability-semantics"),
    getJson(baseUrl, "/v1/operation-availability")
  ]);
  assertion(health.status === 200 && liveness.status === 200, "PUBLIC_HEALTH_UNAVAILABLE");
  assertion(object(liveness.value, "LIVENESS_INVALID")["status"] === "ok", "PUBLIC_LIVENESS_NOT_OK");
  assertion(capabilitiesResponse.status === 200 && semanticsResponse.status === 200, "PUBLIC_DISCOVERY_UNAVAILABLE");
  const registry = defaultGowmConsumerSchemaRegistry();
  registry.validate("platform/capability-list-response.schema.json", capabilitiesResponse.value);
  registry.validate("gowm-v0.6.2/capability-semantic-catalog-v1.schema.json", semanticsResponse.value);
  const capabilities = object(capabilitiesResponse.value, "CAPABILITIES_INVALID");
  const semantics = object(semanticsResponse.value, "SEMANTICS_INVALID");
  const profiles = array(semantics["profiles"], "SEMANTIC_PROFILES_INVALID").map((entry) => object(entry, "SEMANTIC_PROFILE_INVALID"));
  assertion(capabilities["contractCatalogRevision"] === lock.contractCatalogRevision, "LIVE_CONTRACT_REVISION_MISMATCH");
  assertion(capabilities["bindingRevision"] === binding["bindingRevision"], "LIVE_BINDING_REVISION_MISMATCH");
  assertion(semantics["contractCatalogRevision"] === lock.contractCatalogRevision, "LIVE_SEMANTIC_CONTRACT_REVISION_MISMATCH");
  assertion(semantics["bindingRevision"] === binding["bindingRevision"], "LIVE_SEMANTIC_BINDING_REVISION_MISMATCH");
  assertion(semantics["catalogHash"] === lock.semanticCatalogHash, "LIVE_SEMANTIC_CATALOG_HASH_MISMATCH");
  assertion(hashCanonicalJson(profiles) === lock.semanticCatalogHash, "LIVE_SEMANTIC_CONTENT_HASH_MISMATCH");
  for (const profile of profiles) {
    assertion(hashCanonicalJson(profile["semanticProfile"]) === profile["semanticProfileHash"], `LIVE_SEMANTIC_PROFILE_HASH_MISMATCH:${operationKey(profile)}`);
  }
  const capabilityEntries = array(capabilities["capabilities"], "CAPABILITY_LIST_INVALID").map((entry) => object(entry, "CAPABILITY_INVALID"));
  const capabilityKeys = new Set(capabilityEntries.map(operationKey));
  const profileKeys = new Set(profiles.map(operationKey));
  assertion(stableOperations.every((key) => capabilityKeys.has(key) && profileKeys.has(key)), "LIVE_REQUIRED_OPERATION_DISCOVERY_MISSING");

  const availabilityError = object(availabilityResponse.value, "AVAILABILITY_PUBLIC_ERROR_INVALID");
  const availabilityCode = typeof availabilityError["code"] === "string"
    ? availabilityError["code"]
    : object(availabilityError["error"], "AVAILABILITY_PUBLIC_ERROR_MISSING")["code"];
  assertion(availabilityResponse.status === 403 && availabilityCode === "SCOPE_DENIED", "PUBLIC_AVAILABILITY_DID_NOT_FAIL_CLOSED");

  const currentStateDescriptor = capabilityEntries.find((entry) => operationKey(entry) === "world.get-current-state@1.0");
  assertion(currentStateDescriptor !== undefined, "CURRENT_STATE_DESCRIPTOR_MISSING");
  const currentStateExecution = object(currentStateDescriptor["execution"], "CURRENT_STATE_EXECUTION_INVALID");
  const currentStateLimits = object(currentStateDescriptor["limits"], "CURRENT_STATE_LIMITS_INVALID");
  const currentStateCase = expectedCases.find((entry) => entry["caseId"] === "WORLD-STATE-UGV2");
  assertion(currentStateCase !== undefined, "CURRENT_STATE_EXPECTED_CASE_MISSING");
  const negativeRequestId = `wsgs-public-${sha256(realizationId).slice(-20)}`;
  const realizationT0 = text(binding["realizationT0"], "BINDING_REALIZATION_T0_MISSING");
  const deterministicProbeDeadline = new Date(Date.parse(realizationT0) + 24 * 60 * 60 * 1_000).toISOString();
  const asyncRequest = {
    requestVersion: "1.0",
    requestId: negativeRequestId,
    idempotencyKey: `${negativeRequestId}-async`,
    operationVersion: "1.0",
    inputSchemaHash: currentStateDescriptor["inputSchemaHash"],
    outputSchemaHash: currentStateDescriptor["outputSchemaHash"],
    input: currentStateCase["inputTemplate"],
    executionPolicy: {
      deadlineAt: deterministicProbeDeadline,
      maximumResultBytes: currentStateLimits["maximumOutputBytes"],
      maximumRows: currentStateLimits["maximumRows"],
      maximumCandidates: currentStateLimits["maximumCandidates"],
      maximumCostClass: currentStateExecution["costClass"],
      preferredExecution: "ASYNC"
    }
  } satisfies JsonObject;
  const unauthenticatedAsyncProbe = await postJsonWithoutAuthentication(
    baseUrl,
    "/v1/operations/world.get-current-state:execute",
    negativeRequestId,
    asyncRequest
  );
  const asyncProbeError = object(unauthenticatedAsyncProbe.value, "ASYNC_PROBE_PUBLIC_ERROR_INVALID");
  const asyncProbeCode = typeof asyncProbeError["code"] === "string"
    ? asyncProbeError["code"]
    : object(asyncProbeError["error"], "ASYNC_PROBE_PUBLIC_ERROR_MISSING")["code"];
  assertion(unauthenticatedAsyncProbe.status === 403 && asyncProbeCode === "SCOPE_DENIED", "PUBLIC_ASYNC_PROBE_DID_NOT_FAIL_CLOSED");

  const validationOperations = lock.defaultOperations.filter((entry) =>
    entry.operationId === "reference.validate" || entry.operationId === "result.validate"
  );
  process.stdout.write(`${JSON.stringify({
    marker: "WSGS_GOWM_SAMPLE_PUBLIC_HANDOFF_PASS",
    handoff: {
      fileCount: actualFiles.length,
      operationLockHash: loadedLock.lockHash,
      realizationId,
      realizationHash: binding["realizationHash"],
      expectedCases: expectedCases.length,
      canaryPass: canaryCases.length,
      connectivity: connectivity["status"]
    },
    livePublicDiscovery: {
      gatewayBaseUrlHash: sha256(baseUrl.toString()),
      healthStatus: object(health.value, "HEALTH_INVALID")["status"],
      livenessStatus: object(liveness.value, "LIVENESS_INVALID")["status"],
      capabilityCount: capabilityKeys.size,
      semanticProfileCount: profileKeys.size,
      contractCatalogRevision: capabilities["contractCatalogRevision"],
      bindingRevision: capabilities["bindingRevision"],
      semanticCatalogHash: semantics["catalogHash"],
      unauthenticatedAvailability: { httpStatus: availabilityResponse.status, code: availabilityCode },
      unauthenticatedDirectAsyncProbe: {
        method: "POST",
        path: "/v1/operations/world.get-current-state:execute",
        expectedCaseId: "WORLD-STATE-UGV2",
        requestHash: hashCanonicalJson(asyncRequest),
        deadlineAt: deterministicProbeDeadline,
        requestedExecution: "ASYNC",
        advertisedExecutionMode: currentStateExecution["mode"],
        httpStatus: unauthenticatedAsyncProbe.status,
        code: asyncProbeCode,
        responseHash: unauthenticatedAsyncProbe.bodyHash
      },
      responseHashes: {
        capabilities: capabilitiesResponse.bodyHash,
        semantics: semanticsResponse.bodyHash,
        availabilityError: availabilityResponse.bodyHash
      }
    },
    unresolvedProtocolCapabilities: {
      pinnedValidation: validationOperations.map((entry) => ({
        operationKey: `${entry.operationId}@${entry.operationVersion}`,
        snapshotSupport: entry.snapshotSupport
      })),
      authenticatedExecution: "NOT_RUN_SECURE_CREDENTIAL_HANDOFF_AUTHORIZATION_REQUIRED"
    }
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const code = error instanceof Error && /^[A-Z0-9_.:@-]+$/u.test(error.message)
    ? error.message
    : error instanceof Error ? error.name : "UNKNOWN_ERROR";
  process.stderr.write(`${JSON.stringify({
    marker: "WSGS_GOWM_SAMPLE_PUBLIC_HANDOFF_FAILED",
    code,
    handoffName: basename(process.env["GOWM_SAMPLE_HANDOFF_DIR"] ?? "missing")
  })}\n`);
  process.exitCode = 1;
});
