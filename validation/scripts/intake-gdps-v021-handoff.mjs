import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const requiredFiles = [
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
const argument = process.argv.indexOf("--handoff");
const handoff = argument >= 0 ? process.argv[argument + 1] : process.env.GDPS_V021_HANDOFF_DIR;
const driverSourceArgument = process.argv.indexOf("--w43-driver-source");
const w43DriverSource = driverSourceArgument >= 0
  ? process.argv[driverSourceArgument + 1]
  : process.env.GDPS_V021_W43_DRIVER_SOURCE_FILE;
const gatewayCanarySourceArgument = process.argv.indexOf("--gateway-canary-source");
const gatewayCanarySource = gatewayCanarySourceArgument >= 0
  ? process.argv[gatewayCanarySourceArgument + 1]
  : process.env.GDPS_V021_GATEWAY_CANARY_SOURCE_FILE;
const check = process.argv.includes("--check");
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const frozenContractHashes = {
  testBaselineSchemaHash: "sha256:00bd7b9d9648e8bf593a8d453fd1cc27b438a0cef3e21127dd740bf2e58e119e",
  queryCorpusSchemaHash: "sha256:67c69ba0225fbf8c49b9083538af5bb2f18660ff7c91ccf2a099b9f833fefd92",
  queryCorpusHash: "sha256:4f60e2ceb8ff96dcea76952b3bc3369bada54ddbcc12bc755b2ed2ae56a6559a",
  w43CurrentnessContractHash: "sha256:8b684f1f669cb2be50f4be7ffce854ffd3a97dd73563784179345aa7121e30a3",
  w43AttestationSchemaHash: "sha256:9e5e2b77ffa40f699678c4fdeed57d7d946b76829457ecff1d6ead2c030a6097",
  w43DriverSourceHash: "sha256:249930ea8ecdf0a4740f6917b9321cb74f5fce20a57afd8d1d1166a3a5194efd",
  gatewayCanarySourceHash: "sha256:0137926005b5c1879ac612baed76893c1313b2f91511b898b6fafee6c5373f17",
  r06ReportSchemaVersion: "gdps-v021-running-gowm-canaries/2.0",
  r06ReportSchemaHash: "sha256:7fd3531cb967730b567e5cbbe3be7901b45ef9ddd6de9caa219ea75ae0409fbc"
};
const stableProtocolAssertions = [
  "RESPONSE_REQUEST_BINDING",
  "RESPONSE_OPERATION_BINDING",
  "OUTPUT_SCHEMA_BINDING",
  "OUTPUT_PRODUCT_BINDING",
  "COMPUTE_PROVIDER_BINDING",
  "COMPUTE_SCHEMA_BINDING",
  "EXECUTION_RESULT_HASH_BINDING",
  "RECEIPT_HASH_BINDING"
];

function fail(code, details = "") {
  console.error(`${code}${details ? ` ${details}` : ""}`);
  process.exit(2);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function json(name) {
  try {
    return JSON.parse(readFileSync(join(handoff, name), "utf8"));
  } catch {
    fail("WSGS_GDPS_V021_HANDOFF_INVALID", `file=${name}`);
  }
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalHash(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function assert(condition, code) {
  if (!condition) fail(code);
}

function exactKeys(value, keys, code) {
  assert(value && typeof value === "object" && !Array.isArray(value), code);
  assert(Object.keys(value).sort().join(",") === [...keys].sort().join(","), code);
}

function exactCanonical(value, expected, code) {
  assert(canonicalJson(value) === canonicalJson(expected), code);
}

function assertDigest(value, code) {
  assert(typeof value === "string" && digestPattern.test(value), code);
}

function assertDataSnapshotEvidence(value, code) {
  exactKeys(value,
    ["consistency", "scopeDigest", "resourceCount", "referenceKeyHash", "authority", "pinning", "digest"],
    `${code}_KEYS_INVALID`);
  assert(value.consistency === "CONSISTENT_AT_START" && value.resourceCount === 1 &&
    value.authority === "gdps.geospatial-products" && value.pinning === "PINNED",
  `${code}_SEMANTICS_INVALID`);
  for (const field of ["scopeDigest", "referenceKeyHash", "digest"]) {
    assertDigest(value[field], `${code}_HASH_INVALID field=${field}`);
  }
}

function assertStableProtocolEvidence(value, approvedImplementationDigest, code) {
  exactKeys(value, [
    "assertions", "requestInputHash", "responseOutputHash", "computeSnapshotHash", "receiptInputHash",
    "receiptOutputHash", "receiptComputeSnapshotHash", "providerImplementationDigest"
  ], `${code}_KEYS_INVALID`);
  exactCanonical(value.assertions, stableProtocolAssertions, `${code}_ASSERTIONS_INVALID`);
  for (const field of [
    "requestInputHash", "responseOutputHash", "computeSnapshotHash", "receiptInputHash", "receiptOutputHash",
    "receiptComputeSnapshotHash", "providerImplementationDigest"
  ]) assertDigest(value[field], `${code}_HASH_INVALID field=${field}`);
  assert(value.receiptInputHash === value.requestInputHash &&
    value.receiptOutputHash === value.responseOutputHash &&
    value.receiptComputeSnapshotHash === value.computeSnapshotHash &&
    value.providerImplementationDigest === approvedImplementationDigest,
  `${code}_BINDING_INVALID`);
}

function assertCanaryNegativeDriverAttestations(value, code) {
  exactKeys(value, ["CURRENT_PRODUCT_ABSENT", "UPSTREAM_TRUNCATED_TRUE"], `${code}_KEYS_INVALID`);
  const absent = value.CURRENT_PRODUCT_ABSENT;
  exactKeys(absent, [
    "status", "executionPath", "operationId", "operationVersion", "descriptorId", "inputHash",
    "matchingCurrentProductCount", "upstreamStatus", "reasonCode", "mustNotInferFalse", "directProviderCalls"
  ], `${code}_CURRENT_PRODUCT_ABSENT_KEYS_INVALID`);
  assert(absent.status === "PASS" && absent.executionPath === "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" &&
    absent.operationId === "geo-vector.find-in-area" && absent.operationVersion === "1.0" &&
    absent.descriptorId === "UAV_RESTRICTION/RESTRICTION_ZONES" && absent.matchingCurrentProductCount === 0 &&
    absent.upstreamStatus === "NO_DATA" && absent.reasonCode === "PRODUCT_NOT_AVAILABLE" &&
    absent.mustNotInferFalse === true && absent.directProviderCalls === 0,
  `${code}_CURRENT_PRODUCT_ABSENT_SEMANTICS_INVALID`);
  assertDigest(absent.inputHash, `${code}_CURRENT_PRODUCT_ABSENT_INPUT_HASH_INVALID`);

  const truncated = value.UPSTREAM_TRUNCATED_TRUE;
  exactKeys(truncated, [
    "status", "executionPath", "operationId", "operationVersion", "descriptorId", "inputHash", "productId",
    "contentHash", "upstreamStatus", "authoritativeFeatureCount", "returnedFeatureCount", "truncated",
    "requestedLimit", "directProviderCalls"
  ], `${code}_UPSTREAM_TRUNCATED_KEYS_INVALID`);
  assert(truncated.status === "PASS" && truncated.executionPath === "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" &&
    truncated.operationId === "geo-vector.find-in-area" && truncated.operationVersion === "1.0" &&
    truncated.descriptorId === "DRAINAGE_NETWORK/DRAINAGE_FEATURES" &&
    truncated.productId === "gdps-baseline-drainage" && truncated.upstreamStatus === "COMPLETED" &&
    truncated.authoritativeFeatureCount === 3 && truncated.returnedFeatureCount === 1 &&
    truncated.truncated === true && truncated.requestedLimit === 1 && truncated.directProviderCalls === 0,
  `${code}_UPSTREAM_TRUNCATED_SEMANTICS_INVALID`);
  assertDigest(truncated.inputHash, `${code}_UPSTREAM_TRUNCATED_INPUT_HASH_INVALID`);
  assertDigest(truncated.contentHash, `${code}_UPSTREAM_TRUNCATED_CONTENT_HASH_INVALID`);
}

function guardedWrite(path, content) {
  if (check) {
    assert(existsSync(path) && readFileSync(path, "utf8") === content, `WSGS_GDPS_GENERATED_DRIFT file=${basename(path)}`);
    return;
  }
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

const taskSchemaRoot = resolve(root, "contracts", "wsgs-v0.2-gdps", "contracts");
const taskSchemaNames = [
  "acceptance-evidence-map.schema.json",
  "descriptor-resolution.schema.json",
  "gdps-consumer-snapshot-extension.schema.json",
  "gdps-handoff-intake.schema.json",
  "gdps-source-evidence.schema.json",
  "gdps-status-normalization.schema.json",
  "geospatial-product-intent.schema.json",
  "grounded-geospatial-product-intent.schema.json",
  "locked-gdps-recipe.schema.json"
];
const taskContracts = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(taskContracts);
for (const name of taskSchemaNames) {
  const schema = JSON.parse(readFileSync(resolve(taskSchemaRoot, name), "utf8"));
  assert(taskContracts.validateSchema(schema), `WSGS_GDPS_TASK_SCHEMA_INVALID file=${name}`);
  taskContracts.addSchema(schema);
}
function assertTaskContract(schemaId, value, code) {
  const validate = taskContracts.getSchema(schemaId);
  assert(validate && validate(value), `${code} errors=${taskContracts.errorsText(validate?.errors)}`);
}

if (driverSourceArgument >= 0 && !w43DriverSource) {
  fail("WSGS_GDPS_W43_DRIVER_SOURCE_FILE_MISSING", "reason=ARGUMENT_VALUE_MISSING");
}
if (gatewayCanarySourceArgument >= 0 && !gatewayCanarySource) {
  fail("WSGS_GDPS_GATEWAY_CANARY_SOURCE_FILE_MISSING", "reason=ARGUMENT_VALUE_MISSING");
}
if (!handoff || !existsSync(handoff)) fail("WSGS_GDPS_V021_HANDOFF_NOT_READY", "reason=HANDOFF_DIRECTORY_MISSING");
const missing = requiredFiles.filter((name) => !existsSync(join(handoff, name)));
if (missing.length > 0) fail("WSGS_GDPS_V021_HANDOFF_NOT_READY", `missing=${missing.join(",")}`);
const handoffInventory = readdirSync(handoff, { withFileTypes: true });
assert(handoffInventory.length === requiredFiles.length &&
  handoffInventory.every((entry) => entry.isFile() && requiredFiles.includes(entry.name)),
"WSGS_GDPS_V021_HANDOFF_EXACT_INVENTORY_INVALID");

const checksums = json("CHECKSUMS.json");
const entries = Array.isArray(checksums.files) ? checksums.files : [];
const expectedCheckedFiles = requiredFiles.filter((name) => name !== "CHECKSUMS.json").sort();
assert(checksums.schemaVersion === "wsgs-gdps-v021-checksums/1.0" && checksums.algorithm === "SHA-256" &&
  digestPattern.test(checksums.bundleHash), "WSGS_GDPS_CHECKSUM_CONTRACT_INVALID");
assert(entries.length === expectedCheckedFiles.length, "WSGS_GDPS_CHECKSUM_INVENTORY_INVALID");
const checkedFileHashes = {};
for (const name of expectedCheckedFiles) {
  const entry = entries.find((candidate) => candidate?.path === name);
  assert(entry && digestPattern.test(entry.sha256), `WSGS_GDPS_CHECKSUM_MISSING file=${name}`);
  assert(Object.keys(entry).sort().join(",") === "path,sha256", `WSGS_GDPS_CHECKSUM_ENTRY_INVALID file=${name}`);
  assert(sha256(readFileSync(join(handoff, name))) === entry.sha256, `WSGS_GDPS_CHECKSUM_DRIFT file=${name}`);
  checkedFileHashes[name] = entry.sha256;
}
assert(entries.every((entry) => expectedCheckedFiles.includes(entry?.path)) &&
  new Set(entries.map((entry) => entry?.path)).size === expectedCheckedFiles.length,
"WSGS_GDPS_CHECKSUM_INVENTORY_INVALID");
assert(canonicalHash(checkedFileHashes) === checksums.bundleHash, "WSGS_GDPS_CHECKSUM_BUNDLE_HASH_DRIFT");

const scanned = expectedCheckedFiles.map((name) => readFileSync(join(handoff, name), "utf8")).join("\n");
assert(!/(?:postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@|jdbc:|s3:\/\/|file:\/\/|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/iu.test(scanned),
  "WSGS_GDPS_HANDOFF_SECRET_OR_INTERNAL_URI_REJECTED");
assert(!/["'](?:[A-Za-z]:\\|\/(?:home|Users|var|opt|srv)\/)/u.test(scanned),
  "WSGS_GDPS_HANDOFF_INTERNAL_PATH_REJECTED");
assert(!/["'](?:productVersion|product_version|productVersionId|product_version_id)["']\s*:/iu.test(scanned),
  "WSGS_GDPS_PRODUCT_VERSION_SEMANTICS_FORBIDDEN");

const consumer = json("GDPS_CONSUMER_LOCK.json");
const capabilities = json("GDPS_CAPABILITY_LOCK.json");
const descriptors = json("GDPS_PRODUCT_DESCRIPTOR_LOCK.json");
const recipes = json("GDPS_RECIPE_LOCK.json");
const dataset = json("GDPS_SAMPLE_DATASET_LOCK.json");
const gateway = json("GOWM_GATEWAY_BINDING_LOCK.json");
const baseline = json("WSGS_TEST_BASELINE.json");
const queryCorpus = json("WSGS_QUERY_CORPUS.json");
const recipePlan = JSON.parse(readFileSync(resolve(root, "config", "gdps-recipe-plan.json"), "utf8"));
const descriptorRegistry = descriptors.descriptorRegistry ?? descriptors.registry?.descriptorRegistry ??
  (descriptors.schemaVersion === "gdps-product-type-descriptors/1.0" ? descriptors : undefined);
const vocabularyRegistry = descriptors.vocabularyRegistry ?? descriptors.registry?.vocabularyRegistry ??
  (descriptors.vocabularies && typeof descriptors.vocabularies === "object" ? {
    schemaVersion: "gdps-product-vocabularies/1.0",
    vocabularies: descriptors.vocabularies
  } : undefined);
const operations = Array.isArray(capabilities.operations) ? capabilities.operations : [];
const productTypeCount = consumer.descriptorRegistry?.productTypeCount ?? descriptors.productTypeCount ?? descriptors.inventory?.productTypeCount;
const descriptorProfileCount = consumer.descriptorRegistry?.profileCount ?? descriptors.profileCount ?? descriptors.inventory?.descriptorProfileCount;
const descriptorLockHash = consumer.descriptorRegistry?.hash ?? descriptors.descriptorRegistryHash ?? descriptors.registryHash;
const providerId = consumer.provider?.providerId ?? capabilities.providerId ?? gateway.provider?.providerId;
const providerVersion = consumer.provider?.providerVersion ?? capabilities.providerVersion ?? gateway.provider?.providerVersion;
const manifestHash = consumer.provider?.providerManifestHash ?? capabilities.providerManifestHash ?? gateway.provider?.providerManifestHash;
assert(providerId === "gdps.geospatial-products", "WSGS_GDPS_PROVIDER_IDENTITY_INVALID");
assert(providerVersion === "0.2.1",
  "WSGS_GDPS_PROVIDER_VERSION_INVALID");
assert(digestPattern.test(manifestHash), "WSGS_GDPS_PROVIDER_MANIFEST_HASH_INVALID");
assert(productTypeCount === 34 && descriptorProfileCount === 35, "WSGS_GDPS_DESCRIPTOR_INVENTORY_INVALID");
assert(digestPattern.test(descriptorLockHash), "WSGS_GDPS_DESCRIPTOR_LOCK_HASH_INVALID");
assert(descriptorRegistry?.schemaVersion === "gdps-product-type-descriptors/1.0" &&
  Array.isArray(descriptorRegistry.descriptors) && descriptorRegistry.descriptors.length === 35,
"WSGS_GDPS_DESCRIPTOR_REGISTRY_MISSING");
assert(vocabularyRegistry && typeof vocabularyRegistry.schemaVersion === "string" &&
  vocabularyRegistry.vocabularies && typeof vocabularyRegistry.vocabularies === "object" &&
  !Array.isArray(vocabularyRegistry.vocabularies), "WSGS_GDPS_VOCABULARY_REGISTRY_MISSING");
assert(canonicalHash(descriptorRegistry) === descriptorLockHash, "WSGS_GDPS_DESCRIPTOR_REGISTRY_HASH_DRIFT");
assert(descriptorRegistry.descriptors.every((entry) => entry.vocabularyRef === null ||
  (typeof entry.vocabularyRef === "string" && Array.isArray(vocabularyRegistry.vocabularies[entry.vocabularyRef]))),
"WSGS_GDPS_VOCABULARY_REFERENCE_INVALID");
assert(operations.length === 30, "WSGS_GDPS_CAPABILITY_COUNT_INVALID");
assert(new Set(operations.map((entry) => `${entry.operationId}@${entry.operationVersion}`)).size === 30,
  "WSGS_GDPS_CAPABILITY_DUPLICATE");
assert(operations.every((entry) => entry.maturity === "PREVIEW" &&
  [entry.inputSchemaHash, entry.outputSchemaHash, entry.semanticProfileHash].every((hash) => digestPattern.test(hash))),
  "WSGS_GDPS_CAPABILITY_CONTRACT_INVALID");
assert(Array.isArray(recipes.recipes) && recipes.recipes.length === 30, "WSGS_GDPS_RECIPE_INVENTORY_INVALID");
assert(recipes.recipes.every((recipe) => {
  const operation = operations.find((entry) => entry.operationId === recipe.operationId &&
    entry.operationVersion === recipe.operationVersion);
  return operation && recipe.allowedMaturity === "PREVIEW" &&
    recipe.inputSchemaHash === operation.inputSchemaHash &&
    recipe.outputSchemaHash === operation.outputSchemaHash &&
    recipe.semanticProfileHash === operation.semanticProfileHash;
}), "WSGS_GDPS_PROVIDER_RECIPE_LOCK_DRIFT");
assert(recipePlan.schemaVersion === "wsgs-gdps-recipe-plan/2.0" &&
  Array.isArray(recipePlan.activeRuntimeRecipes) && recipePlan.activeRuntimeRecipes.length === 14,
"WSGS_GDPS_RUNTIME_RECIPE_PLAN_INVALID");

const expectedNegativeDrivers = [
  {
    driverId: "NEG-CURRENT-PRODUCT-ABSENT",
    precondition: "CURRENT_PRODUCT_ABSENT",
    driverClass: "RUNNING_GATEWAY_READ_ONLY",
    operationId: "geo-vector.find-in-area",
    operationVersion: "1.0",
    input: {
      productType: "UAV_RESTRICTION",
      productProfile: "RESTRICTION_ZONES",
      selector: {
        type: "Polygon",
        coordinates: [[
          [113.931, 22.541], [113.959, 22.541], [113.959, 22.559],
          [113.931, 22.559], [113.931, 22.541]
        ]]
      },
      limit: 20
    },
    expectedUpstreamStatus: "NO_DATA",
    expectedReasonCode: "PRODUCT_NOT_AVAILABLE",
    expectedConsumerStatus: "UNRESOLVED",
    expectedSemanticCode: "DATA_GAP",
    mustNotInferFalse: true,
    directProviderCalls: 0
  },
  {
    driverId: "NEG-RECIPE-SEMANTIC-HASH-ALTERED",
    precondition: "RECIPE_SEMANTIC_HASH_ALTERED",
    driverClass: "ISOLATED_CONSUMER_LOCK_COPY",
    sourceLock: "GDPS_RECIPE_LOCK.json",
    mutation: { field: "semanticProfileHash", mode: "DETERMINISTIC_SINGLE_NIBBLE_FLIP" },
    expectedConsumerStatus: "UNRESOLVED",
    expectedSemanticCode: "RECIPE_LOCK_DRIFT",
    mustNotExecuteGdps: true,
    sharedInstanceMutation: false
  },
  {
    driverId: "NEG-UPSTREAM-TRUNCATED-TRUE",
    precondition: "UPSTREAM_TRUNCATED_TRUE",
    driverClass: "RUNNING_GATEWAY_READ_ONLY",
    operationId: "geo-vector.find-in-area",
    operationVersion: "1.0",
    input: {
      productType: "DRAINAGE_NETWORK",
      productProfile: "DRAINAGE_FEATURES",
      selector: {
        type: "Polygon",
        coordinates: [[
          [113.932, 22.543], [113.958, 22.543], [113.958, 22.558],
          [113.932, 22.558], [113.932, 22.543]
        ]]
      },
      limit: 1
    },
    expectedUpstreamStatus: "COMPLETED",
    expectedTruncated: true,
    expectedConsumerStatus: "PARTIAL",
    expectedSemanticCode: "RESULT_TRUNCATED",
    directProviderCalls: 0
  },
  {
    driverId: "NEG-STORED-HASH-DIFFERS-FROM-CURRENT",
    precondition: "STORED_HASH_DIFFERS_FROM_CURRENT",
    driverClass: "TWO_PHASE_RUNNING_GATEWAY_REPLAY",
    initialDatasetState: "INITIAL_A",
    priorGroundingBarrierRequired: true,
    priorGroundingExecutionPath: "RUNNING_GOWM_WORLD_QUERY_GATEWAY",
    transition: "GDPS_CURRENTNESS_A_TO_B",
    originalOperationId: "geo-raster.find-by-range",
    validationOperationId: "geo-product.check-current",
    expectedCurrentness: "CHANGED",
    expectedReplayDecisionStatusAnyOf: ["STALE", "SNAPSHOT_MISMATCHED"],
    strictReplay: true,
    mustNotExecuteOriginalQuery: true,
    directProviderCalls: 0
  }
];

const expectedW43CurrentnessContract = {
  schemaVersion: "gdps-v021-w43-currentness-drivers/1.0",
  fixtureId: "GDPS_SLOPE_A_B_CURRENTNESS",
  scope: "scope-gdps-v021-baseline",
  productId: "gdps-baseline-slope",
  originalOperationId: "geo-raster.find-by-range",
  validationOperationId: "geo-product.check-current",
  priorGroundingExecutionPath: "REAL_NL_WSGS_GOWM_GATEWAY",
  barrierAuthority: "GDPS_CONTROLLED_DATABASE_DRIVER",
  sameRunBindingFields: ["candidateSha", "gateRunId", "runtimeIdentity"],
  requiredDatabaseEvidenceRows: ["source", "replay", "result", "stage", "execution", "currentnessDecision"],
  directProviderCalls: 0,
  mockTransportAllowed: false,
  wsgsByteCapAllowed: false,
  finalFixtureState: "FINAL_B",
  scenarios: [
    {
      scenarioId: "W43-STRICT-CURRENT", policy: "STRICT", fixtureBeforePriorGrounding: "INITIAL_A",
      barriers: [], expectedCurrentness: "CURRENT", expectedReplayDecisionStatus: "REPLAY_ALLOWED",
      expectedOriginalOperationExecutionsAfterReplay: 0
    },
    {
      scenarioId: "W43-STRICT-CHANGED", policy: "STRICT", fixtureBeforePriorGrounding: "INITIAL_A",
      barriers: ["AFTER_PRIOR_GROUNDING:A_TO_B"], expectedCurrentness: "CHANGED",
      expectedReplayDecisionStatus: "SNAPSHOT_MISMATCHED", expectedStrictExecutionBlocked: true,
      expectedOriginalOperationExecutionsAfterReplay: 0
    },
    {
      scenarioId: "W43-STRICT-NOT-AVAILABLE", policy: "STRICT", fixtureBeforePriorGrounding: "INITIAL_A",
      barriers: ["AFTER_PRIOR_GROUNDING:DISABLE_CURRENT_PRODUCT", "AFTER_SCENARIO:RESTORE_A"],
      expectedCurrentness: "NOT_AVAILABLE", expectedReplayDecisionStatus: "STALE",
      expectedWarning: "SOURCE_NOT_AVAILABLE", expectedSemanticOutcome: "DATA_GAP",
      expectedStrictExecutionBlocked: true, expectedOriginalOperationExecutionsAfterReplay: 0
    },
    {
      scenarioId: "W43-BEST-EFFORT-CHANGED", policy: "BEST_EFFORT", fixtureBeforePriorGrounding: "INITIAL_A",
      barriers: ["AFTER_PRIOR_GROUNDING:A_TO_B"], expectedCurrentness: "CHANGED",
      expectedReplayDecisionStatus: "REPLAY_ALLOWED", expectedWarning: "SOURCE_ADVANCED",
      expectedNewQuery: true, expectedOriginalOperationExecutionsAfterReplay: 1
    },
    {
      scenarioId: "W43-SOURCE-CHANGED-ONCE-THEN-SUCCESS", policy: "BEST_EFFORT",
      fixtureBeforePriorGrounding: "INITIAL_A", barriers: ["BEFORE_REPLAY_QUERY:A_TO_B"],
      expectedSourceChangedDuringQueryCount: 1, expectedRetryCount: 1, expectedTerminalStatus: "COMPLETED"
    },
    {
      scenarioId: "W43-SOURCE-CHANGED-TWICE-INDETERMINATE", policy: "BEST_EFFORT",
      fixtureBeforePriorGrounding: "INITIAL_A",
      barriers: ["BEFORE_REPLAY_QUERY:A_TO_B", "AFTER_FIRST_SOURCE_CHANGED:B_TO_A"],
      expectedSourceChangedDuringQueryCount: 2, expectedRetryCount: 1, expectedTerminalStatus: "INDETERMINATE"
    }
  ]
};

exactKeys(queryCorpus, ["schemaVersion", "cases", "negativePreconditionDrivers", "w43CurrentnessContract"],
  "WSGS_GDPS_QUERY_CORPUS_KEYS_INVALID");
assert(queryCorpus.schemaVersion === "wsgs-gdps-v021-query-corpus/1.0" &&
  Array.isArray(queryCorpus.cases) && queryCorpus.cases.length === 11,
"WSGS_GDPS_QUERY_CORPUS_CONTRACT_INVALID");
const expectedQueryCaseIds = [
  "SLOPE-POINT", "SLOPE-RANGE", "FLOOD-HIGH", "DRAINAGE-NEARBY", "HIGH-GROUND", "WETLAND",
  "LAND-COVER", "TRAVERSABILITY", "DATA-GAP", "AMBIGUOUS-REFERENCE", "CURRENTNESS"
];
assert(queryCorpus.cases.every((entry, index) => entry?.id === expectedQueryCaseIds[index] &&
  typeof entry.message === "string" && entry.message.length > 0), "WSGS_GDPS_QUERY_CASE_INVENTORY_INVALID");
assert(queryCorpus.cases[10]?.expectedStatusWhenHashChanged === "STALE_OR_SNAPSHOT_MISMATCHED",
  "WSGS_GDPS_CURRENTNESS_STATUS_SENTINEL_INVALID");
exactCanonical(queryCorpus.negativePreconditionDrivers, expectedNegativeDrivers,
  "WSGS_GDPS_W44_DRIVER_CONTRACT_INVALID");
exactCanonical(queryCorpus.w43CurrentnessContract, expectedW43CurrentnessContract,
  "WSGS_GDPS_W43_SCENARIO_CONTRACT_INVALID");
assert(canonicalHash(queryCorpus) === frozenContractHashes.queryCorpusHash,
  "WSGS_GDPS_QUERY_CORPUS_FROZEN_HASH_DRIFT");
assert(canonicalHash(queryCorpus.w43CurrentnessContract) === frozenContractHashes.w43CurrentnessContractHash,
  "WSGS_GDPS_W43_CURRENTNESS_CONTRACT_FROZEN_HASH_DRIFT");

exactKeys(baseline, [
  "schemaVersion", "consumerLockHash", "recipeLockHash", "sampleDatasetLockHash", "queryCorpusHash",
  "canarySpatialInputHash", "negativeDriverContractHash", "w43CurrentnessContractHash", "w43Readiness",
  "gatewayCanaryAttestation", "gatewayCanaryEvidencePayload", "gatewayProtocolEvidencePayload", "status"
], "WSGS_GDPS_TEST_BASELINE_KEYS_INVALID");
assert(baseline.schemaVersion === "wsgs-gdps-test-baseline/1.0" && baseline.status === "READY",
  "WSGS_GDPS_TEST_BASELINE_NOT_READY");
assert(baseline.consumerLockHash === canonicalHash(consumer) &&
  baseline.recipeLockHash === canonicalHash(recipes) &&
  baseline.sampleDatasetLockHash === canonicalHash(dataset) &&
  baseline.queryCorpusHash === frozenContractHashes.queryCorpusHash &&
  baseline.negativeDriverContractHash === canonicalHash(queryCorpus.negativePreconditionDrivers) &&
  baseline.w43CurrentnessContractHash === frozenContractHashes.w43CurrentnessContractHash,
"WSGS_GDPS_TEST_BASELINE_SOURCE_HASH_DRIFT");

const w43Readiness = baseline.w43Readiness;
exactKeys(w43Readiness, [
  "driverAvailability", "driverSourcePath", "driverSourceHash", "attestationSchemaPath",
  "attestationSchemaHash", "currentnessContractHash", "runtimeQualification", "runtimeEvidenceIncluded",
  "transitionAttestationSemantics"
], "WSGS_GDPS_W43_READINESS_KEYS_INVALID");
assert(w43Readiness.driverAvailability === "AVAILABLE_NOT_EXECUTED" &&
  w43Readiness.driverSourcePath === "scripts/v021_w43_barrier.py" &&
  w43Readiness.attestationSchemaPath === "contracts/v021-w43-barrier-attestation.schema.json" &&
  w43Readiness.currentnessContractHash === baseline.w43CurrentnessContractHash &&
  w43Readiness.runtimeQualification === "NOT_RUN" && w43Readiness.runtimeEvidenceIncluded === false &&
  w43Readiness.transitionAttestationSemantics === "FIXTURE_TRANSITION_ONLY_NOT_W43_RUNTIME_PASS",
"WSGS_GDPS_W43_STATIC_RUNTIME_BOUNDARY_INVALID");
assertDigest(w43Readiness.driverSourceHash, "WSGS_GDPS_W43_DRIVER_SOURCE_HASH_INVALID");
assertDigest(w43Readiness.attestationSchemaHash, "WSGS_GDPS_W43_ATTESTATION_SCHEMA_HASH_INVALID");
assert(w43Readiness.attestationSchemaHash === frozenContractHashes.w43AttestationSchemaHash,
  "WSGS_GDPS_W43_FROZEN_ATTESTATION_SCHEMA_LOCK_DRIFT");
assert(w43Readiness.driverSourceHash === frozenContractHashes.w43DriverSourceHash,
  "WSGS_GDPS_W43_FROZEN_DRIVER_SOURCE_LOCK_DRIFT");
if (w43DriverSource) {
  assert(existsSync(w43DriverSource), "WSGS_GDPS_W43_DRIVER_SOURCE_FILE_MISSING");
  const normalizedSource = readFileSync(w43DriverSource, "utf8").replace(/\r\n?/gu, "\n");
  assert(sha256(Buffer.from(normalizedSource, "utf8")) === w43Readiness.driverSourceHash,
    "WSGS_GDPS_W43_DRIVER_SOURCE_HASH_DRIFT");
}
if (gatewayCanarySource) {
  assert(existsSync(gatewayCanarySource), "WSGS_GDPS_GATEWAY_CANARY_SOURCE_FILE_MISSING");
  const normalizedSource = readFileSync(gatewayCanarySource, "utf8").replace(/\r\n?/gu, "\n");
  assert(sha256(Buffer.from(normalizedSource, "utf8")) === frozenContractHashes.gatewayCanarySourceHash,
    "WSGS_GDPS_GATEWAY_CANARY_SOURCE_HASH_DRIFT");
}

const canaryPayload = baseline.gatewayCanaryEvidencePayload;
exactKeys(canaryPayload, [
  "datasetState", "datasetHash", "contractCatalogRevision", "semanticCatalogHash", "bindingRevision",
  "spatialInputHash", "truthContractHash", "expectedTruthHash", "negativeDriverContractHash",
  "emptyVsNoProduct", "negativeDriverAttestations", "scopeIsolation", "cases"
], "WSGS_GDPS_R06_CANONICAL_PREIMAGE_KEYS_INVALID");
assert(["INITIAL_A", "FINAL_B"].includes(canaryPayload.datasetState),
  "WSGS_GDPS_R06_CANONICAL_PREIMAGE_DATASET_STATE_INVALID");
for (const field of [
  "datasetHash", "contractCatalogRevision", "semanticCatalogHash", "bindingRevision", "spatialInputHash",
  "truthContractHash", "expectedTruthHash", "negativeDriverContractHash"
]) assertDigest(canaryPayload[field], `WSGS_GDPS_R06_CANONICAL_PREIMAGE_HASH_INVALID field=${field}`);
assert(Array.isArray(canaryPayload.cases) && canaryPayload.cases.length === 30,
  "WSGS_GDPS_R06_CANARY_CASE_COUNT_INVALID");
const canaryOperations = new Set();
for (const [index, entry] of canaryPayload.cases.entries()) {
  const expectedCaseId = `CAP-${String(index + 1).padStart(2, "0")}`;
  exactKeys(entry, [
    "caseId", "operationId", "normalizedStatus", "resultHash", "productId", "contentHash", "truthAssertions",
    "dataSnapshotAssertions", "dataSnapshotEvidence"
  ], `WSGS_GDPS_R06_CANARY_CASE_KEYS_INVALID case=${expectedCaseId}`);
  assert(entry.caseId === expectedCaseId && typeof entry.operationId === "string" && entry.operationId.length > 0 &&
    entry.normalizedStatus === "COMPLETED", `WSGS_GDPS_R06_CANARY_CASE_IDENTITY_INVALID case=${expectedCaseId}`);
  assertDigest(entry.resultHash, `WSGS_GDPS_R06_CANARY_RESULT_HASH_INVALID case=${expectedCaseId}`);
  assert((entry.productId === null || typeof entry.productId === "string") &&
    (entry.contentHash === null || digestPattern.test(entry.contentHash)) &&
    Array.isArray(entry.truthAssertions) && entry.truthAssertions.length > 0 &&
    entry.truthAssertions.every((value) => typeof value === "string" && /^[A-Z0-9_]+$/u.test(value)) &&
    new Set(entry.truthAssertions).size === entry.truthAssertions.length,
  `WSGS_GDPS_R06_CANARY_TRUTH_INVALID case=${expectedCaseId}`);
  exactCanonical(entry.dataSnapshotAssertions,
    ["SNAPSHOT_CONSISTENCY", "SNAPSHOT_SCOPE", "SNAPSHOT_RESOURCE_IDENTITY", "SNAPSHOT_DIGEST"],
    `WSGS_GDPS_R06_CANARY_SNAPSHOT_ASSERTIONS_INVALID case=${expectedCaseId}`);
  assertDataSnapshotEvidence(entry.dataSnapshotEvidence, `WSGS_GDPS_R06_CANARY_SNAPSHOT case=${expectedCaseId}`);
  canaryOperations.add(entry.operationId);
}
assert(canaryOperations.size === 30 && operations.every((entry) => canaryOperations.has(entry.operationId)),
  "WSGS_GDPS_R06_CANARY_OPERATION_INVENTORY_INVALID");
exactCanonical(canaryPayload.emptyVsNoProduct, {
  status: "PASS", emptyQueryStatus: "COMPLETED", emptyFeatureCount: 0,
  missingProductStatus: "NO_DATA", missingProductCode: "PRODUCT_NOT_AVAILABLE"
}, "WSGS_GDPS_R06_EMPTY_VS_NO_PRODUCT_INVALID");
exactCanonical(canaryPayload.scopeIsolation,
  { status: "PASS", foreignHttpStatus: 403, errorCode: "SCOPE_DENIED" },
  "WSGS_GDPS_R06_SCOPE_ISOLATION_INVALID");
assertCanaryNegativeDriverAttestations(canaryPayload.negativeDriverAttestations,
  "WSGS_GDPS_R06_NEGATIVE_DRIVER_ATTESTATIONS");

const canaryAttestation = baseline.gatewayCanaryAttestation;
exactKeys(canaryAttestation, [
  "status", "executionPath", "authenticationMode", "requiredCapabilityCount", "availableCapabilityCount",
  "passedCaseCount", "directProviderCalls", "datasetState", "datasetHash", "spatialInputHash",
  "truthContractHash", "expectedTruthHash", "negativeDriverContractHash", "contractCatalogRevision",
  "semanticCatalogHash", "bindingRevision", "gatewayBaseUrlHash", "gatewayInstanceFingerprint",
  "runningConfigFingerprint", "onboardingEvidenceHash", "onboardingGeneratedAt", "canaryGeneratedAt",
  "runEvidenceHash", "protocolEvidenceHash", "negativeDriverAttestations", "credentialMaterialRecorded"
], "WSGS_GDPS_R06_ATTESTATION_KEYS_INVALID");
assert(canaryAttestation.status === "PASS" &&
  canaryAttestation.executionPath === "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" &&
  canaryAttestation.authenticationMode === "SIGNED_DELEGATION_V1" &&
  canaryAttestation.requiredCapabilityCount === 30 && canaryAttestation.availableCapabilityCount === 30 &&
  canaryAttestation.passedCaseCount === 30 && canaryAttestation.directProviderCalls === 0 &&
  canaryAttestation.credentialMaterialRecorded === false,
"WSGS_GDPS_R06_ATTESTATION_RUNTIME_INVALID");
for (const field of [
  "datasetHash", "spatialInputHash", "truthContractHash", "expectedTruthHash", "negativeDriverContractHash",
  "contractCatalogRevision", "semanticCatalogHash", "bindingRevision", "gatewayBaseUrlHash",
  "gatewayInstanceFingerprint", "runningConfigFingerprint", "onboardingEvidenceHash", "runEvidenceHash",
  "protocolEvidenceHash"
]) assertDigest(canaryAttestation[field], `WSGS_GDPS_R06_ATTESTATION_HASH_INVALID field=${field}`);
assert(Number.isFinite(Date.parse(canaryAttestation.onboardingGeneratedAt)) &&
  Number.isFinite(Date.parse(canaryAttestation.canaryGeneratedAt)) &&
  Date.parse(canaryAttestation.canaryGeneratedAt) >= Date.parse(canaryAttestation.onboardingGeneratedAt),
"WSGS_GDPS_R06_ATTESTATION_FRESHNESS_INVALID");
for (const field of [
  "datasetState", "datasetHash", "spatialInputHash", "truthContractHash", "expectedTruthHash",
  "negativeDriverContractHash", "contractCatalogRevision", "semanticCatalogHash", "bindingRevision"
]) assert(canaryAttestation[field] === canaryPayload[field], `WSGS_GDPS_R06_PREIMAGE_BINDING_DRIFT field=${field}`);
assert(baseline.canarySpatialInputHash === canaryPayload.spatialInputHash &&
  baseline.negativeDriverContractHash === canaryPayload.negativeDriverContractHash &&
  canonicalJson(canaryAttestation.negativeDriverAttestations) === canonicalJson(canaryPayload.negativeDriverAttestations) &&
  canaryAttestation.runEvidenceHash === canonicalHash(canaryPayload),
"WSGS_GDPS_R06_CANONICAL_PREIMAGE_HASH_DRIFT");

const protocolPayload = baseline.gatewayProtocolEvidencePayload;
exactKeys(protocolPayload, ["sourceRuntimeBinding", "cases", "negativeDrivers"],
  "WSGS_GDPS_R06_PROTOCOL_PREIMAGE_KEYS_INVALID");
const sourceRuntimeBinding = protocolPayload.sourceRuntimeBinding;
exactKeys(sourceRuntimeBinding, [
  "approvedManifestHash", "approvedImplementationDigest", "providerRuntimeIdentityHash",
  "providerRuntimeEvidenceHash", "onboardingEvidenceHash", "contractCatalogRevision", "semanticCatalogHash",
  "bindingRevision"
], "WSGS_GDPS_R06_PROTOCOL_RUNTIME_BINDING_KEYS_INVALID");
for (const field of [
  "approvedManifestHash", "approvedImplementationDigest", "providerRuntimeIdentityHash",
  "providerRuntimeEvidenceHash", "onboardingEvidenceHash", "contractCatalogRevision", "semanticCatalogHash",
  "bindingRevision"
]) assertDigest(sourceRuntimeBinding[field], `WSGS_GDPS_R06_PROTOCOL_RUNTIME_BINDING_HASH_INVALID field=${field}`);
assert(sourceRuntimeBinding.approvedManifestHash === manifestHash &&
  sourceRuntimeBinding.onboardingEvidenceHash === canaryAttestation.onboardingEvidenceHash &&
  sourceRuntimeBinding.contractCatalogRevision === canaryPayload.contractCatalogRevision &&
  sourceRuntimeBinding.semanticCatalogHash === canaryPayload.semanticCatalogHash &&
  sourceRuntimeBinding.bindingRevision === canaryPayload.bindingRevision,
"WSGS_GDPS_R06_PROTOCOL_RUNTIME_BINDING_DRIFT");

assert(Array.isArray(protocolPayload.cases) && protocolPayload.cases.length === 30,
  "WSGS_GDPS_R06_PROTOCOL_CASE_COUNT_INVALID");
for (const [index, protocolEvidence] of protocolPayload.cases.entries()) {
  const expectedCaseId = `CAP-${String(index + 1).padStart(2, "0")}`;
  assertStableProtocolEvidence(protocolEvidence, sourceRuntimeBinding.approvedImplementationDigest,
    `WSGS_GDPS_R06_PROTOCOL_CASE case=${expectedCaseId}`);
  assert(protocolEvidence.responseOutputHash === canaryPayload.cases[index].resultHash,
    `WSGS_GDPS_R06_PROTOCOL_RESULT_BINDING_DRIFT case=${expectedCaseId}`);
}

exactKeys(protocolPayload.negativeDrivers, ["CURRENT_PRODUCT_ABSENT", "UPSTREAM_TRUNCATED_TRUE"],
  "WSGS_GDPS_R06_PROTOCOL_NEGATIVE_DRIVER_KEYS_INVALID");
for (const driverId of ["CURRENT_PRODUCT_ABSENT", "UPSTREAM_TRUNCATED_TRUE"]) {
  const negativeEvidence = protocolPayload.negativeDrivers[driverId];
  exactKeys(negativeEvidence, ["protocolEvidence", "dataSnapshotEvidence", "dataSnapshotHash"],
    `WSGS_GDPS_R06_PROTOCOL_NEGATIVE_DRIVER_KEYS_INVALID driver=${driverId}`);
  assertStableProtocolEvidence(negativeEvidence.protocolEvidence, sourceRuntimeBinding.approvedImplementationDigest,
    `WSGS_GDPS_R06_PROTOCOL_NEGATIVE_DRIVER driver=${driverId}`);
  assertDataSnapshotEvidence(negativeEvidence.dataSnapshotEvidence,
    `WSGS_GDPS_R06_PROTOCOL_NEGATIVE_SNAPSHOT driver=${driverId}`);
  assertDigest(negativeEvidence.dataSnapshotHash,
    `WSGS_GDPS_R06_PROTOCOL_NEGATIVE_SNAPSHOT_HASH_INVALID driver=${driverId}`);
  assert(negativeEvidence.dataSnapshotHash === canonicalHash(negativeEvidence.dataSnapshotEvidence),
    `WSGS_GDPS_R06_PROTOCOL_NEGATIVE_SNAPSHOT_HASH_DRIFT driver=${driverId}`);
}
assert(canaryAttestation.protocolEvidenceHash === canonicalHash(protocolPayload),
  "WSGS_GDPS_R06_PROTOCOL_CANONICAL_PREIMAGE_HASH_DRIFT");

const sources = consumer.sources ?? {};
assert([sources.wsgsSha, sources.gdpsSha, sources.gowmSha].every((sha) => /^[0-9a-f]{40}$/u.test(sha)),
  "WSGS_GDPS_SOURCE_SHA_INVALID");
const currentWsgsSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
assert(sources.wsgsSha === currentWsgsSha, "WSGS_GDPS_CONSUMER_SOURCE_SHA_DRIFT");
const gatewayBinding = consumer.gateway ?? gateway.gateway ?? gateway;
assert([gatewayBinding.contractCatalogRevision, gatewayBinding.semanticCatalogHash, gatewayBinding.bindingRevision]
  .every((hash) => digestPattern.test(hash)), "WSGS_GDPS_GATEWAY_BINDING_INVALID");
assert(gatewayBinding.contractCatalogRevision === canaryPayload.contractCatalogRevision &&
  gatewayBinding.semanticCatalogHash === canaryPayload.semanticCatalogHash &&
  gatewayBinding.bindingRevision === canaryPayload.bindingRevision,
"WSGS_GDPS_R06_GATEWAY_BINDING_DRIFT");

const checksumHash = sha256(readFileSync(join(handoff, "CHECKSUMS.json")));
const operationByKey = new Map(operations.map((entry) => [`${entry.operationId}@${entry.operationVersion}`, entry]));
const providerRecipeByOperation = new Map(recipes.recipes.map((entry) =>
  [`${entry.operationId}@${entry.operationVersion}`, entry]));
const descriptorEntries = descriptorRegistry.descriptors;
assert(Array.isArray(descriptorEntries) && descriptorEntries.length === 35,
  "WSGS_GDPS_DESCRIPTOR_PROFILE_INVENTORY_INVALID");
const specializedPatterns = new Set(recipePlan.activeRuntimeRecipes.slice(0, 7).map((entry) => entry.semanticPattern));
const specializedRequirementByPattern = new Map(Object.entries({
  GDPS_LAND_COVER_AT_REFERENCE: "READ_LAND_COVER",
  GDPS_WETLANDS_IN_AREA: "FIND_WETLANDS",
  GDPS_OBSTACLES_NEAR_REFERENCE: "FIND_OBSTACLES",
  GDPS_BLOCKED_AREAS_IN_AREA: "FIND_BLOCKED_AREAS",
  GDPS_HIGH_GROUND_IN_AREA: "FIND_HIGH_GROUND",
  GDPS_ELEVATION_AT_REFERENCE: "READ_ELEVATION",
  GDPS_TRAVERSABILITY_EXPLAIN_AT_REFERENCE: "EXPLAIN_TRAVERSABILITY"
}));
const runtimeRecipes = recipePlan.activeRuntimeRecipes.map((planned) => {
  const key = `${planned.operationId}@1.0`;
  const operation = operationByKey.get(key);
  const providerRecipe = providerRecipeByOperation.get(key);
  assert(operation && providerRecipe, `WSGS_GDPS_RUNTIME_RECIPE_OPERATION_MISSING operation=${key}`);
  let descriptorConstraint = null;
  if (specializedPatterns.has(planned.semanticPattern)) {
    const productType = providerRecipe.inputBindings?.productTypeConstraint;
    const productProfile = providerRecipe.inputBindings?.productProfileConstraint;
    assert(typeof productType === "string" && typeof productProfile === "string",
      `WSGS_GDPS_SPECIALIZED_DESCRIPTOR_BINDING_MISSING recipe=${planned.recipeId}`);
    const candidates = descriptorEntries.filter((entry) =>
      entry.productType === productType && entry.productProfile === productProfile);
    assert(candidates.length === 1,
      `WSGS_GDPS_SPECIALIZED_DESCRIPTOR_BINDING_AMBIGUOUS recipe=${planned.recipeId}`);
    const descriptor = candidates[0];
    const descriptorId = descriptor.descriptorId;
    const descriptorHash = descriptor.descriptorHash ?? canonicalHash(descriptor);
    assert(typeof descriptorId === "string" && digestPattern.test(descriptorHash),
      `WSGS_GDPS_SPECIALIZED_DESCRIPTOR_INVALID recipe=${planned.recipeId}`);
    descriptorConstraint = { descriptorId, descriptorHash };
  }
  const requirementType = planned.requirementType ?? specializedRequirementByPattern.get(planned.semanticPattern);
  assert(typeof requirementType === "string",
    `WSGS_GDPS_RUNTIME_RECIPE_REQUIREMENT_MISSING recipe=${planned.recipeId}`);
  return {
    schemaVersion: "wsgs-locked-gdps-recipe/2.0",
    recipeId: planned.recipeId,
    semanticPattern: planned.semanticPattern,
    requirementType,
    descriptorConstraint,
    queryProfile: planned.queryProfile,
    allowedOperations: [{
      operationId: operation.operationId,
      operationVersion: operation.operationVersion,
      inputSchemaHash: operation.inputSchemaHash,
      outputSchemaHash: operation.outputSchemaHash,
      semanticProfileHash: operation.semanticProfileHash
    }],
    maturityPolicy: { allowed: "PREVIEW", requiresExactHashes: true },
    productIdPolicy: planned.productIdPolicy,
    inputBindings: structuredClone(providerRecipe.inputBindings ?? {}),
    outputSemantics: structuredClone(providerRecipe.outputSemantics ?? {}),
    previewAuthorizationRequired: true
  };
}).sort((left, right) => left.recipeId.localeCompare(right.recipeId));
assert(new Set(runtimeRecipes.map((entry) => entry.recipeId)).size === 14 &&
  new Set(runtimeRecipes.map((entry) => entry.semanticPattern)).size === 14,
"WSGS_GDPS_RUNTIME_RECIPE_DUPLICATE");
for (const recipe of runtimeRecipes) {
  assertTaskContract("urn:wsgs:locked-gdps-recipe:2.0", recipe,
    `WSGS_GDPS_RUNTIME_RECIPE_CONTRACT_INVALID recipe=${recipe.recipeId}`);
}
const runtimeRecipeLock = {
  schemaVersion: "wsgs-gdps-recipe-lock/2.0",
  providerId,
  providerVersion,
  descriptorRegistryHash: descriptorLockHash,
  productTypeCount: 34,
  profileCount: 35,
  capabilityLockHash: sha256(readFileSync(join(handoff, "GDPS_CAPABILITY_LOCK.json"))),
  recipes: runtimeRecipes
};
const runtimeRecipeLockContent = stableJson(runtimeRecipeLock);
const runtimeRecipeLockHash = sha256(Buffer.from(runtimeRecipeLockContent, "utf8"));
const consumerSnapshotBody = {
  schemaVersion: "wsgs-gdps-consumer-snapshot/2.0",
  providerId,
  providerVersion,
  consumerLockHash: sha256(readFileSync(join(handoff, "GDPS_CONSUMER_LOCK.json"))),
  capabilityLockHash: sha256(readFileSync(join(handoff, "GDPS_CAPABILITY_LOCK.json"))),
  descriptorLockHash,
  recipeLockHash: runtimeRecipeLockHash,
  productTypeCount: 34,
  descriptorProfileCount: 35,
  capabilityKeys: operations.map((entry) => `${entry.operationId}@${entry.operationVersion}`).sort()
};
const consumerSnapshot = {
  ...consumerSnapshotBody,
  capabilitySnapshotHash: canonicalHash(consumerSnapshotBody)
};
assertTaskContract("urn:wsgs:gdps-consumer-snapshot-extension:2.0", consumerSnapshot,
  "WSGS_GDPS_CONSUMER_SNAPSHOT_CONTRACT_INVALID");
const intake = {
  schemaVersion: "wsgs-gdps-handoff-intake/1.0",
  sources: { wsgsSha: sources.wsgsSha, gdpsSha: sources.gdpsSha, gowmSha: sources.gowmSha },
  provider: { providerId, providerVersion, manifestHash },
  inventory: { productTypeCount: 34, descriptorProfileCount: 35, capabilityCount: 30 },
  locks: {
    consumerLockHash: sha256(readFileSync(join(handoff, "GDPS_CONSUMER_LOCK.json"))),
    capabilityLockHash: sha256(readFileSync(join(handoff, "GDPS_CAPABILITY_LOCK.json"))),
    descriptorLockHash,
    recipeLockHash: runtimeRecipeLockHash,
    providerRecipeLockHash: sha256(readFileSync(join(handoff, "GDPS_RECIPE_LOCK.json"))),
    runtimeRecipeLockHash,
    checksumHash,
    testBaselineSchemaHash: frozenContractHashes.testBaselineSchemaHash,
    queryCorpusSchemaHash: frozenContractHashes.queryCorpusSchemaHash,
    queryCorpusHash: frozenContractHashes.queryCorpusHash,
    w43CurrentnessContractHash: frozenContractHashes.w43CurrentnessContractHash,
    w43AttestationSchemaHash: frozenContractHashes.w43AttestationSchemaHash,
    w43DriverSourceHash: frozenContractHashes.w43DriverSourceHash,
    gatewayCanarySourceHash: frozenContractHashes.gatewayCanarySourceHash,
    r06ReportSchemaVersion: frozenContractHashes.r06ReportSchemaVersion,
    r06ReportSchemaHash: frozenContractHashes.r06ReportSchemaHash,
    canaryEvidenceHash: canaryAttestation.runEvidenceHash,
    protocolEvidenceHash: canaryAttestation.protocolEvidenceHash
  },
  gatewayBinding: {
    contractCatalogRevision: gatewayBinding.contractCatalogRevision,
    semanticCatalogHash: gatewayBinding.semanticCatalogHash,
    bindingRevision: gatewayBinding.bindingRevision
  },
  status: "PASS"
};
assertTaskContract("urn:wsgs:gdps-handoff-intake:1.0", intake,
  "WSGS_GDPS_HANDOFF_INTAKE_CONTRACT_INVALID");

const upstream = resolve(root, "contracts", "upstream", "gdps-v0.2.1");
for (const name of requiredFiles) {
  const content = readFileSync(join(handoff, name), "utf8");
  guardedWrite(join(upstream, name), content);
}
guardedWrite(resolve(root, "contracts", "generated", "gdps-v0.2.1", "gdps-handoff-intake.json"), stableJson(intake));
guardedWrite(resolve(root, "contracts", "generated", "gdps-v0.2.1", "wsgs-gdps-recipe-lock.json"),
  runtimeRecipeLockContent);
guardedWrite(resolve(root, "contracts", "generated", "gdps-v0.2.1", "product-type-descriptors.json"),
  stableJson(descriptorRegistry));
guardedWrite(resolve(root, "contracts", "generated", "gdps-v0.2.1", "product-vocabularies.json"),
  stableJson(vocabularyRegistry));
guardedWrite(resolve(root, "contracts", "generated", "gdps-v0.2.1", "gdps-consumer-snapshot.json"),
  stableJson(consumerSnapshot));
guardedWrite(resolve(root, "packages", "contracts", "src", "generated-internal-v02", "gdps", "handoff.ts"),
  `// Generated by validation/scripts/intake-gdps-v021-handoff.mjs. Do not edit.\n` +
  `export const gdpsV021HandoffIntake = ${JSON.stringify(intake, null, 2)} as const;\n`);
guardedWrite(resolve(root, "packages", "contracts", "src", "generated-internal-v02", "gdps", "descriptors.ts"),
  `// Generated by validation/scripts/intake-gdps-v021-handoff.mjs. Do not edit.\n` +
  `export const gdpsV021DescriptorRegistry = ${JSON.stringify(descriptorRegistry, null, 2)} as const;\n` +
  `export const gdpsV021VocabularyRegistry = ${JSON.stringify(vocabularyRegistry, null, 2)} as const;\n`);
guardedWrite(resolve(root, "packages", "contracts", "src", "generated-internal-v02", "gdps", "recipes.ts"),
  `// Generated by validation/scripts/intake-gdps-v021-handoff.mjs. Do not edit.\n` +
  `export const gdpsV021RuntimeRecipeLock = ${JSON.stringify(runtimeRecipeLock, null, 2)} as const;\n`);
guardedWrite(resolve(root, "packages", "contracts", "src", "generated-internal-v02", "gdps", "hashes.ts"),
  `// Generated by validation/scripts/intake-gdps-v021-handoff.mjs. Do not edit.\n` +
  `export const gdpsV021LockHashes = ${JSON.stringify(intake.locks, null, 2)} as const;\n`);
guardedWrite(resolve(root, "packages", "contracts", "src", "generated-internal-v02", "gdps", "snapshot.ts"),
  `// Generated by validation/scripts/intake-gdps-v021-handoff.mjs. Do not edit.\n` +
  `export const gdpsV021ConsumerSnapshot = ${JSON.stringify(consumerSnapshot, null, 2)} as const;\n`);

console.log(`WSGS_GDPS_CONSUMER_LOCK_READY mode=${check ? "check" : "generate"} operations=30 productTypes=34 profiles=35`);
