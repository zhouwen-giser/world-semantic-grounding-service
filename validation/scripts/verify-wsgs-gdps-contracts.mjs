import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const contractRoot = join(root, "contracts", "wsgs-v0.2-gdps");
const schemaRoot = join(contractRoot, "contracts");
const expectedSchemas = [
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

function fail(message) {
  throw new Error(`WSGS v0.2 GDPS contract verification failed: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function json(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`invalid JSON ${relative(root, path)}`);
  }
}

const actualSchemas = readdirSync(schemaRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();
assert(JSON.stringify(actualSchemas) === JSON.stringify(expectedSchemas),
  `schema inventory mismatch expected=${expectedSchemas.join("|")} actual=${actualSchemas.join("|")}`);

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const schemas = new Map();
for (const name of expectedSchemas) {
  const schema = json(join(schemaRoot, name));
  assert(ajv.validateSchema(schema), `${name} is not a valid schema: ${ajv.errorsText(ajv.errors)}`);
  assert(typeof schema.$id === "string" && schema.$id.startsWith("urn:wsgs:"), `${name} has no locked WSGS URN`);
  ajv.addSchema(schema);
  schemas.set(name, schema);
}

function validate(schemaName, value, label) {
  const schema = schemas.get(schemaName);
  const validator = schema && ajv.getSchema(schema.$id);
  assert(validator, `${schemaName} did not compile`);
  assert(validator(value), `${label} failed ${schemaName}: ${ajv.errorsText(validator.errors)}`);
}

validate(
  "geospatial-product-intent.schema.json",
  json(join(contractRoot, "examples", "slope-range-intent.json")),
  "examples/slope-range-intent.json"
);
validate(
  "grounded-geospatial-product-intent.schema.json",
  json(join(contractRoot, "examples", "slope-range-grounded-intent.json")),
  "examples/slope-range-grounded-intent.json"
);

const expectedInventory = json(join(root, "config", "gdps-expected-inventory.json"));
assert(expectedInventory.schemaVersion === "wsgs-expected-gdps-inventory/1.0", "inventory schemaVersion drift");
assert(expectedInventory.providerId === "gdps.geospatial-products", "provider identity drift");
assert(expectedInventory.productTypeCount === 34 && expectedInventory.productTypes.length === 34,
  "product type inventory must be 34");
assert(expectedInventory.descriptorProfileCount === 35, "descriptor profile inventory must be 35");
assert(expectedInventory.capabilityCount === 30 && expectedInventory.legacyOperations.length === 23 &&
  expectedInventory.genericOperations.length === 7, "capability inventory must be 23 legacy plus 7 generic");
assert(new Set(expectedInventory.productTypes).size === 34, "duplicate product type");
const expectedOperations = [...expectedInventory.legacyOperations, ...expectedInventory.genericOperations];
assert(new Set(expectedOperations).size === 30, "duplicate expected operation");

const recipePlan = json(join(root, "config", "gdps-recipe-plan.json"));
assert(recipePlan.schemaVersion === "wsgs-gdps-recipe-plan/2.0", "recipe plan schemaVersion drift");
assert(JSON.stringify(recipePlan.consumerCapabilityInventory) === JSON.stringify(expectedOperations),
  "recipe consumer inventory drift");
assert(recipePlan.activeRuntimeRecipes.length === 14, "runtime recipe count must be 14");
assert(new Set(recipePlan.activeRuntimeRecipes.map((entry) => entry.recipeId)).size === 14,
  "duplicate runtime recipe id");
assert(new Set(recipePlan.activeRuntimeRecipes.map((entry) => entry.semanticPattern)).size === 14,
  "duplicate runtime semantic pattern");
assert(recipePlan.activeRuntimeRecipes.every((entry) => expectedOperations.includes(entry.operationId) &&
  entry.previewAuthorizationRequired === true && entry.productIdPolicy === "UNBOUND_UNLESS_EXPLICIT" &&
  entry.requiresExactHashes === true), "runtime recipe policy drift");

const runtimePlan = json(join(root, "config", "gdps-runtime-pattern-plan.json"));
assert(runtimePlan.schemaVersion === "wsgs-gdps-runtime-pattern-plan/1.0", "runtime pattern schemaVersion drift");
assert(runtimePlan.specializedPatterns.length === 7 && runtimePlan.genericPatterns.length === 7 &&
  runtimePlan.genericRequirements.length === 7, "runtime pattern partition must be 7 specialized plus 7 generic");
assert(JSON.stringify(recipePlan.activeRuntimeRecipes.map((entry) => entry.semanticPattern)) ===
  JSON.stringify([...runtimePlan.specializedPatterns, ...runtimePlan.genericPatterns]),
"runtime pattern ordering drift");
assert(runtimePlan.previewPolicy.allowAllPreview === false &&
  runtimePlan.previewPolicy.requiresRecipeLock === true &&
  runtimePlan.previewPolicy.requiresDescriptorHash === true &&
  runtimePlan.previewPolicy.requiresOperationHashes === true &&
  runtimePlan.previewPolicy.prefixBasedAuthorizationForbidden === true,
"preview authorization policy drift");

const conceptMap = json(join(root, "config", "gdps-semantic-concept-map.json"));
assert(conceptMap.operationIdsForbidden === true && conceptMap.concepts.length === 16,
  "semantic concept map inventory drift");
assert(new Set(conceptMap.concepts.map((entry) => entry.conceptCode)).size === conceptMap.concepts.length,
  "duplicate semantic concept");
assert(conceptMap.concepts.every((entry) => entry.descriptorCandidates.length > 0 &&
  entry.allowedQuerySemantics.length > 0), "empty semantic concept binding");
assert(!/(?:geo-raster|geo-vector|landcover|terrain|hydrology|obstacle|traversability|elevation|surface-material)\./u
  .test(JSON.stringify(conceptMap)), "operation id leaked into semantic concept map");

const corpus = json(join(root, "config", "gdps-e2e-corpus.json"));
assert(corpus.cases.length === 16 && new Set(corpus.cases.map((entry) => entry.id)).size === 16,
  "E2E corpus must contain 16 unique cases");

const statusMap = json(join(root, "config", "gdps-status-normalization.json"));
assert(statusMap.schemaVersion === "wsgs-gdps-status-map/1.0" && statusMap.mappings.length === 11,
  "status normalization inventory drift");
assert(new Set(statusMap.mappings.map((entry) => entry.upstreamCondition)).size === statusMap.mappings.length,
  "duplicate upstream status condition");
for (const entry of statusMap.mappings) {
  validate("gdps-status-normalization.schema.json", {
    schemaVersion: "wsgs-gdps-status-normalization/1.0",
    ...entry
  }, `status mapping ${entry.upstreamCondition}`);
}

const architecture = json(join(root, "config", "gdps-architecture-boundary-policy.json"));
assert(architecture.scanRoots.includes("packages") && architecture.scanRoots.includes("services"),
  "architecture scan roots drift");
assert(architecture.forbiddenDataProductHistoryIdentifiers.includes("productVersion") &&
  architecture.plannerForbiddenOperationPrefixes.length === 9,
"architecture fail-closed policy drift");

console.log(
  `WSGS_V02_GDPS_CONTRACT_PASS schemas=${expectedSchemas.length} productTypes=34 profiles=35 ` +
  `capabilities=30 recipes=14 concepts=${conceptMap.concepts.length} e2e=${corpus.cases.length}`
);
