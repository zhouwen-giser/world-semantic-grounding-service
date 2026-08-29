import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const consumer = json("GDPS_CONSUMER_LOCK.json");
const capabilities = json("GDPS_CAPABILITY_LOCK.json");
const descriptors = json("GDPS_PRODUCT_DESCRIPTOR_LOCK.json");
const recipes = json("GDPS_RECIPE_LOCK.json");
const gateway = json("GOWM_GATEWAY_BINDING_LOCK.json");
const recipePlan = JSON.parse(readFileSync(resolve(root, "config", "gdps-recipe-plan.json"), "utf8"));
const operations = Array.isArray(capabilities.operations) ? capabilities.operations : [];
const productTypeCount = consumer.descriptorRegistry?.productTypeCount ?? descriptors.productTypeCount ?? descriptors.inventory?.productTypeCount;
const descriptorProfileCount = consumer.descriptorRegistry?.profileCount ?? descriptors.profileCount ?? descriptors.inventory?.descriptorProfileCount;
const descriptorLockHash = consumer.descriptorRegistry?.hash ?? descriptors.descriptorRegistryHash ?? descriptors.registryHash;
const providerId = consumer.provider?.providerId ?? capabilities.providerId ?? gateway.provider?.providerId;
const providerVersion = consumer.provider?.providerVersion ?? capabilities.providerVersion ?? gateway.provider?.providerVersion;
const manifestHash = consumer.provider?.providerManifestHash ?? capabilities.providerManifestHash ?? gateway.provider?.providerManifestHash;
assert(providerId === "gdps.geospatial-products", "WSGS_GDPS_PROVIDER_IDENTITY_INVALID");
assert(typeof providerVersion === "string" && providerVersion.length > 0, "WSGS_GDPS_PROVIDER_VERSION_MISSING");
assert(digestPattern.test(manifestHash), "WSGS_GDPS_PROVIDER_MANIFEST_HASH_INVALID");
assert(productTypeCount === 34 && descriptorProfileCount === 35, "WSGS_GDPS_DESCRIPTOR_INVENTORY_INVALID");
assert(digestPattern.test(descriptorLockHash), "WSGS_GDPS_DESCRIPTOR_LOCK_HASH_INVALID");
assert(operations.length === 30, "WSGS_GDPS_CAPABILITY_COUNT_INVALID");
assert(new Set(operations.map((entry) => `${entry.operationId}@${entry.operationVersion}`)).size === 30,
  "WSGS_GDPS_CAPABILITY_DUPLICATE");
assert(operations.every((entry) => entry.maturity === "PREVIEW" &&
  [entry.inputSchemaHash, entry.outputSchemaHash, entry.semanticProfileHash].every((hash) => digestPattern.test(hash))),
  "WSGS_GDPS_CAPABILITY_CONTRACT_INVALID");
assert(Array.isArray(recipes.recipes) && recipes.recipes.length === 30, "WSGS_GDPS_RECIPE_INVENTORY_INVALID");
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
const descriptorEntries = descriptors.descriptors ?? descriptors.registry?.descriptors ??
  descriptors.productTypeDescriptors ?? descriptors.profiles;
assert(Array.isArray(descriptorEntries) && descriptorEntries.length === 35,
  "WSGS_GDPS_DESCRIPTOR_PROFILE_INVENTORY_INVALID");
const areaPatterns = new Set([
  "GDPS_WETLANDS_IN_AREA", "GDPS_BLOCKED_AREAS_IN_AREA", "GDPS_HIGH_GROUND_IN_AREA",
  "GDPS_GENERIC_PROFILE_VALUE", "GDPS_GENERIC_FIND_CLASS", "GDPS_GENERIC_FIND_RANGE",
  "GDPS_GENERIC_VECTOR_IN_AREA", "GDPS_GENERIC_VECTOR_INTERSECTS"
]);
const specializedPatterns = new Set(recipePlan.activeRuntimeRecipes.slice(0, 7).map((entry) => entry.semanticPattern));
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
  return {
    recipeId: planned.recipeId,
    semanticPattern: planned.semanticPattern,
    descriptorConstraint,
    previewAuthorizationRequired: true,
    maturity: "PREVIEW",
    operationKeys: [
      "reference.resolve@1.0",
      areaPatterns.has(planned.semanticPattern) ? "world.get-geometry@1.0" : "world.get-current-state@1.0",
      key
    ],
    allowedOperations: [{
      operationId: operation.operationId,
      operationVersion: operation.operationVersion,
      inputSchemaHash: operation.inputSchemaHash,
      outputSchemaHash: operation.outputSchemaHash,
      semanticProfileHash: operation.semanticProfileHash
    }]
  };
}).sort((left, right) => left.recipeId.localeCompare(right.recipeId));
assert(new Set(runtimeRecipes.map((entry) => entry.recipeId)).size === 14 &&
  new Set(runtimeRecipes.map((entry) => entry.semanticPattern)).size === 14,
"WSGS_GDPS_RUNTIME_RECIPE_DUPLICATE");
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
const intake = {
  schemaVersion: "wsgs-gdps-handoff-intake/1.0",
  sources: { wsgsSha: sources.wsgsSha, gdpsSha: sources.gdpsSha, gowmSha: sources.gowmSha },
  provider: { providerId, providerVersion, manifestHash },
  inventory: { productTypeCount: 34, descriptorProfileCount: 35, capabilityCount: 30 },
  locks: {
    consumerLockHash: sha256(readFileSync(join(handoff, "GDPS_CONSUMER_LOCK.json"))),
    capabilityLockHash: sha256(readFileSync(join(handoff, "GDPS_CAPABILITY_LOCK.json"))),
    descriptorLockHash,
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

const upstream = resolve(root, "contracts", "upstream", "gdps-v0.2.1");
for (const name of requiredFiles) {
  const content = readFileSync(join(handoff, name), "utf8");
  guardedWrite(join(upstream, name), content);
}
guardedWrite(resolve(root, "contracts", "generated", "gdps-v0.2.1", "gdps-handoff-intake.json"), stableJson(intake));
guardedWrite(resolve(root, "contracts", "generated", "gdps-v0.2.1", "wsgs-gdps-recipe-lock.json"),
  runtimeRecipeLockContent);
guardedWrite(resolve(root, "packages", "contracts", "src", "generated-internal-v02", "gdps", "handoff.ts"),
  `// Generated by validation/scripts/intake-gdps-v021-handoff.mjs. Do not edit.\n` +
  `export const gdpsV021HandoffIntake = ${JSON.stringify(intake, null, 2)} as const;\n`);

console.log(`WSGS_GDPS_CONSUMER_LOCK_READY mode=${check ? "check" : "generate"} operations=30 productTypes=34 profiles=35`);
