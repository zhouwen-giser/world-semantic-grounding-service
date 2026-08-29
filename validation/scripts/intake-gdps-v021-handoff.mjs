import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const check = process.argv.includes("--check");
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

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

if (!handoff || !existsSync(handoff)) fail("WSGS_GDPS_V021_HANDOFF_NOT_READY", "reason=HANDOFF_DIRECTORY_MISSING");
const missing = requiredFiles.filter((name) => !existsSync(join(handoff, name)));
if (missing.length > 0) fail("WSGS_GDPS_V021_HANDOFF_NOT_READY", `missing=${missing.join(",")}`);

const checksums = json("CHECKSUMS.json");
const entries = Array.isArray(checksums.files) ? checksums.files : [];
const expectedCheckedFiles = requiredFiles.filter((name) => name !== "CHECKSUMS.json").sort();
assert(entries.length === expectedCheckedFiles.length, "WSGS_GDPS_CHECKSUM_INVENTORY_INVALID");
for (const name of expectedCheckedFiles) {
  const entry = entries.find((candidate) => candidate?.path === name);
  assert(entry && digestPattern.test(entry.sha256), `WSGS_GDPS_CHECKSUM_MISSING file=${name}`);
  assert(sha256(readFileSync(join(handoff, name))) === entry.sha256, `WSGS_GDPS_CHECKSUM_DRIFT file=${name}`);
}

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
const gateway = json("GOWM_GATEWAY_BINDING_LOCK.json");
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
assert(typeof providerVersion === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(providerVersion),
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

const sources = consumer.sources ?? {};
assert([sources.wsgsSha, sources.gdpsSha, sources.gowmSha].every((sha) => /^[0-9a-f]{40}$/u.test(sha)),
  "WSGS_GDPS_SOURCE_SHA_INVALID");
const gatewayBinding = consumer.gateway ?? gateway.gateway ?? gateway;
assert([gatewayBinding.contractCatalogRevision, gatewayBinding.semanticCatalogHash, gatewayBinding.bindingRevision]
  .every((hash) => digestPattern.test(hash)), "WSGS_GDPS_GATEWAY_BINDING_INVALID");

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
    checksumHash
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
