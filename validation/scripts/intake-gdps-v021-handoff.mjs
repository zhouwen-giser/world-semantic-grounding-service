import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, posix, resolve } from "node:path";
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
const check = process.argv.includes("--check");
const argument = process.argv.indexOf("--handoff");
const handoff = argument >= 0
  ? process.argv[argument + 1]
  : process.env.GDPS_V021_HANDOFF_DIR
    ?? (check ? resolve(root, "contracts", "upstream", "gdps-v0.2.1") : undefined);
const sourceArgument = process.argv.indexOf("--gdps-source");
const gdpsSourceRepository = sourceArgument >= 0
  ? process.argv[sourceArgument + 1]
  : process.env.GDPS_V021_SOURCE_REPOSITORY;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const sourcePathPattern = /^(?:contracts|integration)\/[A-Za-z0-9._/-]+$/u;
const approvedManifestSourcePath = "integration/GDPS_GOWM_V021_APPROVED_MANIFEST.json";
const findingBindingPlan = Object.freeze({
  "geo-product.get": ["CATALOG", null, "CATALOG", "CATALOG"],
  "geo-product.search": ["CATALOG", null, "CATALOG", "CATALOG"],
  "geo-product.check-current": ["NOT_APPLICABLE", null, "CURRENTNESS", null],
  "elevation.sample": ["FINDING", "SAMPLE_VALUE", "READ_VALUE", "SAMPLE_VALUE"],
  "elevation.profile": ["FINDING", "PROFILE_VALUE", "READ_PROFILE", "PROFILE_VALUE"],
  "elevation.sample-surface": ["FINDING", "SAMPLE_VALUE", "READ_VALUE", "SAMPLE_VALUE"],
  "terrain.get-class": ["FINDING", "SAMPLE_CLASS", "READ_VALUE", "SAMPLE_CLASS"],
  "terrain.find-by-class": ["FINDING", "FIND_CLASS", "FIND_CLASS_AREAS", "FIND_CLASS"],
  "terrain.find-high-ground": ["FINDING", "FIND_CLASS", "FIND_CLASS_AREAS", "FIND_CLASS"],
  "terrain.find-depressions": ["FINDING", "FIND_CLASS", "FIND_CLASS_AREAS", "FIND_CLASS"],
  "landcover.get-class": ["FINDING", "SAMPLE_CLASS", "READ_VALUE", "SAMPLE_CLASS"],
  "landcover.find-by-class": ["FINDING", "FIND_CLASS", "FIND_CLASS_AREAS", "FIND_CLASS"],
  "hydrology.find-water": ["FINDING", "FIND_CLASS", "FIND_CLASS_AREAS", "FIND_CLASS"],
  "hydrology.find-wetlands": ["FINDING", "FIND_CLASS", "FIND_CLASS_AREAS", "FIND_CLASS"],
  "surface-material.get": ["FINDING", "SAMPLE_CLASS", "READ_VALUE", "SAMPLE_CLASS"],
  "surface-material.find-by-class": ["FINDING", "FIND_CLASS", "FIND_CLASS_AREAS", "FIND_CLASS"],
  "obstacle.find-buildings": ["FINDING", "VECTOR_IN_AREA", "FIND_FEATURES_IN_AREA", "VECTOR_IN_AREA"],
  "obstacle.find-nearby": ["FINDING", "VECTOR_NEARBY", "FIND_FEATURES_NEARBY", "VECTOR_NEARBY"],
  "obstacle.find-intersections": ["FINDING", "VECTOR_INTERSECTS", "FIND_INTERSECTIONS", "VECTOR_INTERSECTS"],
  "traversability.get": ["FINDING", "SAMPLE_CLASS", "READ_VALUE", "SAMPLE_CLASS"],
  "traversability.find-passable": ["FINDING", "FIND_CLASS", "FIND_CLASS_AREAS", "FIND_CLASS"],
  "traversability.find-blocked": ["FINDING", "FIND_CLASS", "FIND_CLASS_AREAS", "FIND_CLASS"],
  "traversability.explain": ["FINDING", "SAMPLE_CLASS", "READ_VALUE", "QUALIFIED_EXPLANATION"],
  "geo-raster.sample": ["FINDING", "SAMPLE_VALUE_OR_CLASS", "READ_VALUE", "SAMPLE_VALUE"],
  "geo-raster.profile": ["FINDING", "PROFILE_VALUE", "READ_PROFILE", "PROFILE_VALUE"],
  "geo-raster.find-by-class": ["FINDING", "FIND_CLASS", "FIND_CLASS_AREAS", "FIND_CLASS"],
  "geo-raster.find-by-range": ["FINDING", "FIND_VALUE_RANGE", "FIND_VALUE_RANGE_AREAS", "FIND_VALUE_RANGE"],
  "geo-vector.find-in-area": ["FINDING", "VECTOR_IN_AREA", "FIND_FEATURES_IN_AREA", "VECTOR_IN_AREA"],
  "geo-vector.find-nearby": ["FINDING", "VECTOR_NEARBY", "FIND_FEATURES_NEARBY", "VECTOR_NEARBY"],
  "geo-vector.find-intersections": ["FINDING", "VECTOR_INTERSECTS", "FIND_INTERSECTIONS", "VECTOR_INTERSECTS"]
});

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

function assertSourcePath(path) {
  assert(sourcePathPattern.test(path) && !path.split("/").includes(".."),
    `WSGS_GDPS_SOURCE_PATH_INVALID path=${path}`);
  return path;
}

function gitBytes(repository, commit, path) {
  assert(repository && existsSync(repository), "WSGS_GDPS_SOURCE_REPOSITORY_REQUIRED");
  const exactCommit = execFileSync("git", ["-C", repository, "rev-parse", `${commit}^{commit}`], {
    encoding: "utf8"
  }).trim();
  assert(exactCommit === commit, "WSGS_GDPS_SOURCE_COMMIT_MISMATCH");
  return execFileSync("git", ["-C", repository, "show", `${commit}:${assertSourcePath(path)}`], {
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024
  });
}

function gitContractSchemaPaths(repository, commit) {
  assert(repository && existsSync(repository), "WSGS_GDPS_SOURCE_REPOSITORY_REQUIRED");
  const exactCommit = execFileSync("git", ["-C", repository, "rev-parse", `${commit}^{commit}`], {
    encoding: "utf8"
  }).trim();
  assert(exactCommit === commit, "WSGS_GDPS_SOURCE_COMMIT_MISMATCH");
  return execFileSync("git", ["-C", repository, "ls-tree", "-r", "--name-only", commit, "--", "contracts"], {
    encoding: "utf8"
  }).split(/\r?\n/u).filter((path) => path.endsWith(".schema.json")).map(assertSourcePath).sort();
}

function collectRefs(value, refs = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectRefs(entry, refs);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "$ref" && typeof entry === "string") refs.add(entry);
      else collectRefs(entry, refs);
    }
  }
  return refs;
}

function refDocument(ref, sourcePath, byUri, byPath) {
  const documentRef = ref.split("#", 1)[0];
  if (!documentRef || documentRef === "https://json-schema.org/draft/2020-12/schema") return undefined;
  if (documentRef.startsWith("urn:")) return byUri.get(documentRef);
  const path = posix.normalize(posix.join(posix.dirname(sourcePath), documentRef));
  return byPath.get(path);
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
const generated = resolve(root, "contracts", "generated", "gdps-v0.2.1");
const sourceMaterialization = resolve(upstream, "source-contracts");
const closurePath = resolve(generated, "gdps-finding-contract-closure.json");
const dependencyPath = resolve(generated, "gdps-output-schema-dependencies.json");
const sourceCommit = sources.gdpsSha;
assert(sourceCommit === "d9238d19bae98e387d390c936300358a30b024cb",
  "WSGS_GDPS_FINDING_SOURCE_COMMIT_UNAUTHORIZED");

function materializedBytes(path) {
  return readFileSync(join(sourceMaterialization, ...assertSourcePath(path).split("/")));
}

function sourceBytes(path) {
  return check
    ? materializedBytes(path)
    : gitBytes(gdpsSourceRepository, sourceCommit, path);
}

function parseSourceJson(path, bytes = sourceBytes(path)) {
  const text = bytes.toString("utf8");
  assert(Buffer.from(text, "utf8").equals(bytes), `WSGS_GDPS_SOURCE_NOT_UTF8 path=${path}`);
  try {
    return JSON.parse(text);
  } catch {
    fail("WSGS_GDPS_SOURCE_JSON_INVALID", `path=${path}`);
  }
}

const expectedClosure = check
  ? parseSourceJson("contracts/generated-placeholder.schema.json", readFileSync(closurePath))
  : undefined;
const expectedDependencies = check
  ? parseSourceJson("contracts/generated-dependencies-placeholder.schema.json", readFileSync(dependencyPath))
  : undefined;
const candidateSchemaPaths = check
  ? [
      ...(Array.isArray(expectedClosure?.outputSchemas) ? expectedClosure.outputSchemas : []),
      ...(Array.isArray(expectedDependencies?.schemas) ? expectedDependencies.schemas : [])
    ].map((entry) => assertSourcePath(entry.sourcePath)).sort()
  : gitContractSchemaPaths(gdpsSourceRepository, sourceCommit);
assert(candidateSchemaPaths.length >= 30 && new Set(candidateSchemaPaths).size === candidateSchemaPaths.length,
  "WSGS_GDPS_SCHEMA_SOURCE_INVENTORY_INVALID");

const candidateSchemas = candidateSchemaPaths.map((sourcePath) => {
  const bytes = sourceBytes(sourcePath);
  const document = parseSourceJson(sourcePath, bytes);
  assert(typeof document?.$id === "string" && document.$id.length > 0,
    `WSGS_GDPS_SCHEMA_ID_MISSING path=${sourcePath}`);
  return {
    sourcePath,
    schemaUri: document.$id,
    schemaHash: canonicalHash(document),
    document,
    bytes
  };
});
const schemaByUri = new Map(candidateSchemas.map((entry) => [entry.schemaUri, entry]));
const schemaByPath = new Map(candidateSchemas.map((entry) => [entry.sourcePath, entry]));
assert(schemaByUri.size === candidateSchemas.length && schemaByPath.size === candidateSchemas.length,
  "WSGS_GDPS_SCHEMA_ID_OR_PATH_DUPLICATE");

const approvedManifestBytes = sourceBytes(approvedManifestSourcePath);
const approvedManifest = parseSourceJson(approvedManifestSourcePath, approvedManifestBytes);
assert(canonicalHash(approvedManifest) === manifestHash, "WSGS_GDPS_APPROVED_MANIFEST_HASH_DRIFT");
assert(approvedManifest?.provider?.providerId === providerId
  && approvedManifest?.provider?.providerVersion === providerVersion
  && digestPattern.test(approvedManifest?.provider?.implementationDigest),
"WSGS_GDPS_APPROVED_MANIFEST_PROVIDER_DRIFT");
assert(Array.isArray(approvedManifest.capabilities) && approvedManifest.capabilities.length === 30,
  "WSGS_GDPS_APPROVED_MANIFEST_CAPABILITY_COUNT_INVALID");
const manifestCapabilityByKey = new Map(approvedManifest.capabilities.map((entry) =>
  [`${entry.operationId}@${entry.operationVersion}`, entry]));
assert(manifestCapabilityByKey.size === 30, "WSGS_GDPS_APPROVED_MANIFEST_CAPABILITY_DUPLICATE");

const operationClosure = operations.map((operation) => {
  const key = `${operation.operationId}@${operation.operationVersion}`;
  const manifestCapability = manifestCapabilityByKey.get(key);
  const providerRecipe = providerRecipeByOperation.get(key);
  const plan = findingBindingPlan[operation.operationId];
  assert(manifestCapability && providerRecipe && plan,
    `WSGS_GDPS_FINDING_OPERATION_AUTHORITY_MISSING operation=${key}`);
  assert(manifestCapability.inputSchemaHash === operation.inputSchemaHash
    && manifestCapability.outputSchemaHash === operation.outputSchemaHash
    && manifestCapability.maturity === operation.maturity
    && canonicalHash(manifestCapability.semanticProfile) === operation.semanticProfileHash,
  `WSGS_GDPS_APPROVED_MANIFEST_OPERATION_DRIFT operation=${key}`);
  assert(manifestCapability.inputSchemaUri === manifestCapability.ports?.inputs?.[0]?.schemaUri
    && manifestCapability.inputSchemaHash === manifestCapability.ports?.inputs?.[0]?.schemaHash
    && manifestCapability.outputSchemaUri === manifestCapability.ports?.outputs?.[0]?.schemaUri
    && manifestCapability.outputSchemaHash === manifestCapability.ports?.outputs?.[0]?.schemaHash,
  `WSGS_GDPS_APPROVED_MANIFEST_PORT_DRIFT operation=${key}`);
  const outputSchema = schemaByUri.get(manifestCapability.outputSchemaUri);
  assert(outputSchema && outputSchema.schemaHash === operation.outputSchemaHash,
    `WSGS_GDPS_OUTPUT_SCHEMA_SOURCE_DRIFT operation=${key}`);

  const [applicability, queryProfile, querySemantics, decoderPattern] = plan;
  const productType = providerRecipe.inputBindings?.productTypeConstraint;
  const productProfile = providerRecipe.inputBindings?.productProfileConstraint;
  let descriptorConstraint = null;
  if (typeof productType === "string" || typeof productProfile === "string") {
    assert(typeof productType === "string" && typeof productProfile === "string",
      `WSGS_GDPS_DESCRIPTOR_CONSTRAINT_PARTIAL operation=${key}`);
    const matches = descriptorRegistry.descriptors.filter((entry) =>
      entry.productType === productType && entry.productProfile === productProfile);
    assert(matches.length === 1, `WSGS_GDPS_DESCRIPTOR_CONSTRAINT_AMBIGUOUS operation=${key}`);
    const descriptor = matches[0];
    const descriptorHash = canonicalHash(descriptor);
    if (queryProfile !== "SAMPLE_VALUE_OR_CLASS") {
      assert(descriptor.queryProfiles.includes(queryProfile),
        `WSGS_GDPS_DESCRIPTOR_QUERY_PROFILE_UNSUPPORTED operation=${key}`);
    }
    descriptorConstraint = { descriptorId: descriptor.descriptorId, descriptorHash };
  }
  if (applicability !== "FINDING") {
    assert(descriptorConstraint === null && queryProfile === null,
      `WSGS_GDPS_NON_FINDING_DESCRIPTOR_FORBIDDEN operation=${key}`);
  }
  return {
    operationId: operation.operationId,
    operationVersion: operation.operationVersion,
    inputSchemaUri: manifestCapability.inputSchemaUri,
    inputSchemaHash: operation.inputSchemaHash,
    outputSchemaUri: manifestCapability.outputSchemaUri,
    outputSchemaHash: operation.outputSchemaHash,
    semanticProfile: structuredClone(manifestCapability.semanticProfile),
    semanticProfileHash: operation.semanticProfileHash,
    maturity: operation.maturity,
    availability: operation.availability,
    findingBinding: { applicability, descriptorConstraint, queryProfile, querySemantics, decoderPattern }
  };
}).sort((left, right) =>
  `${left.operationId}@${left.operationVersion}`.localeCompare(`${right.operationId}@${right.operationVersion}`));
assert(operationClosure.length === 30 && Object.keys(findingBindingPlan).length === 30,
  "WSGS_GDPS_FINDING_BINDING_COVERAGE_INVALID");

const outputSchemaUris = new Set(operationClosure.map((entry) => entry.outputSchemaUri));
assert(outputSchemaUris.size === 30, "WSGS_GDPS_OUTPUT_SCHEMA_URI_DUPLICATE");
const reachableSchemas = new Map();
const queue = [...outputSchemaUris].map((uri) => schemaByUri.get(uri));
while (queue.length > 0) {
  const current = queue.shift();
  assert(current, "WSGS_GDPS_OUTPUT_SCHEMA_CLOSURE_MISSING");
  if (reachableSchemas.has(current.schemaUri)) continue;
  reachableSchemas.set(current.schemaUri, current);
  for (const ref of collectRefs(current.document)) {
    const dependency = refDocument(ref, current.sourcePath, schemaByUri, schemaByPath);
    if (dependency !== undefined && !reachableSchemas.has(dependency.schemaUri)) queue.push(dependency);
    else if (dependency === undefined && !ref.startsWith("#")
      && !ref.startsWith("https://json-schema.org/")) {
      fail("WSGS_GDPS_OUTPUT_SCHEMA_REFERENCE_UNRESOLVED", `schema=${current.schemaUri} ref=${ref}`);
    }
  }
}
const rootOutputSchemas = [...outputSchemaUris].map((uri) => reachableSchemas.get(uri)).sort((left, right) =>
  left.sourcePath.localeCompare(right.sourcePath));
const dependencySchemas = [...reachableSchemas.values()].filter((entry) => !outputSchemaUris.has(entry.schemaUri))
  .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
assert(rootOutputSchemas.length === 30, "WSGS_GDPS_OUTPUT_SCHEMA_ROOT_COUNT_INVALID");
if (check) {
  assert(candidateSchemas.length === reachableSchemas.size,
    "WSGS_GDPS_OUTPUT_SCHEMA_MATERIALIZATION_HAS_UNREACHABLE_DOCUMENTS");
}

for (const entry of [...rootOutputSchemas, ...dependencySchemas]) {
  guardedWrite(join(sourceMaterialization, ...entry.sourcePath.split("/")), entry.bytes.toString("utf8"));
}
guardedWrite(join(sourceMaterialization, ...approvedManifestSourcePath.split("/")),
  approvedManifestBytes.toString("utf8"));

const sampleDataset = json("GDPS_SAMPLE_DATASET_LOCK.json");
const queryCorpus = json("WSGS_QUERY_CORPUS.json");
const testBaseline = json("WSGS_TEST_BASELINE.json");
const consumerLockHash = canonicalHash(consumer);
const capabilityLockHash = canonicalHash(capabilities);
const providerRecipeLockHash = canonicalHash(recipes);
const sampleDatasetLockHash = canonicalHash(sampleDataset);
const queryCorpusHash = canonicalHash(queryCorpus);
const testBaselineHash = canonicalHash(testBaseline);
assert(consumerLockHash === testBaseline.consumerLockHash
  && providerRecipeLockHash === testBaseline.recipeLockHash
  && sampleDatasetLockHash === testBaseline.sampleDatasetLockHash
  && queryCorpusHash === testBaseline.queryCorpusHash,
"WSGS_GDPS_BASELINE_LOCK_BINDING_DRIFT");
assert(capabilityLockHash === consumer.capabilityLockHash
  && sampleDatasetLockHash === consumer.sampleDatasetLockHash,
"WSGS_GDPS_CONSUMER_LOCK_BINDING_DRIFT");
const vocabularyRegistryHash = canonicalHash(vocabularyRegistry);
const closureBody = {
  schemaVersion: "wsgs-gdps-finding-contract-closure/1.0",
  sources: {
    gdpsSha: sources.gdpsSha,
    gdpsImplementationTreeHash: sources.gdpsImplementationTreeHash,
    gdpsSourceFingerprint: sources.gdpsSourceFingerprint,
    gdpsSourceFileCount: sources.gdpsSourceFileCount,
    gowmSha: sources.gowmSha,
    wsgsSha: sources.wsgsSha
  },
  handoff: {
    bundleHash: checksums.bundleHash,
    checksumsHash: checksumHash,
    consumerLockHash,
    capabilityLockHash,
    descriptorLockHash,
    providerRecipeLockHash,
    runtimeRecipeLockHash,
    sampleDatasetLockHash,
    queryCorpusHash,
    testBaselineHash
  },
  gateway: {
    contractCatalogRevision: gatewayBinding.contractCatalogRevision,
    semanticCatalogHash: gatewayBinding.semanticCatalogHash,
    bindingRevision: gatewayBinding.bindingRevision,
    instanceFingerprint: gatewayBinding.instanceFingerprint,
    runningConfigFingerprint: gatewayBinding.runningConfigFingerprint
  },
  provider: {
    providerId,
    providerVersion,
    manifestHash,
    implementationDigest: approvedManifest.provider.implementationDigest,
    manifest: approvedManifest
  },
  descriptorAuthority: {
    registryHash: descriptorLockHash,
    registry: descriptorRegistry,
    vocabularyRegistryHash,
    vocabularyRegistry
  },
  operations: operationClosure,
  outputSchemas: rootOutputSchemas.map(({ sourcePath, schemaUri, schemaHash, document }) =>
    ({ schemaUri, schemaHash, sourcePath, document }))
};
const findingContractClosure = { ...closureBody, closureHash: canonicalHash(closureBody) };
const dependencyBody = {
  schemaVersion: "wsgs-gdps-output-schema-dependencies/1.0",
  sourceCommit,
  schemas: dependencySchemas.map(({ sourcePath, schemaUri, schemaHash, document }) =>
    ({ schemaUri, schemaHash, sourcePath, document }))
};
const outputSchemaDependencies = { ...dependencyBody, closureHash: canonicalHash(dependencyBody) };

for (const name of requiredFiles) {
  const content = readFileSync(join(handoff, name), "utf8");
  guardedWrite(join(upstream, name), content);
}
guardedWrite(resolve(generated, "gdps-handoff-intake.json"), stableJson(intake));
guardedWrite(resolve(generated, "wsgs-gdps-recipe-lock.json"),
  runtimeRecipeLockContent);
guardedWrite(resolve(generated, "product-type-descriptors.json"),
  stableJson(descriptorRegistry));
guardedWrite(resolve(generated, "product-vocabularies.json"),
  stableJson(vocabularyRegistry));
guardedWrite(resolve(generated, "gdps-consumer-snapshot.json"),
  stableJson(consumerSnapshot));
guardedWrite(closurePath, stableJson(findingContractClosure));
guardedWrite(dependencyPath, stableJson(outputSchemaDependencies));
guardedWrite(resolve(root, "packages", "gowm-contract-intake", "src", "gdps-v021-finding-contract.generated.ts"),
  `// Generated by validation/scripts/intake-gdps-v021-handoff.mjs. Do not edit.\n` +
  `function deepFreeze<T>(value: T): T {\n` +
  `  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {\n` +
  `    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);\n` +
  `    Object.freeze(value);\n` +
  `  }\n` +
  `  return value;\n` +
  `}\n\n` +
  `export const gdpsV021FindingContractClosure = deepFreeze(${JSON.stringify(findingContractClosure, null, 2)} as const);\n\n` +
  `export const gdpsV021OutputSchemaDependencies = deepFreeze(${JSON.stringify(outputSchemaDependencies, null, 2)} as const);\n`);

console.log(`WSGS_GDPS_CONSUMER_LOCK_READY mode=${check ? "check" : "generate"} operations=30 productTypes=34 profiles=35 outputSchemas=30 dependencies=${dependencySchemas.length} closureHash=${findingContractClosure.closureHash}`);
