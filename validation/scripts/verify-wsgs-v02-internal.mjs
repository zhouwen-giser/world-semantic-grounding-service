import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifactRoot = join(repositoryRoot, "contracts", "wsgs-v0.2-internal");
const schemaRoot = join(artifactRoot, "contracts");
const lockPath = join(artifactRoot, "artifact-lock.json");
const acceptancePaths = [
  join(repositoryRoot, "acceptance", "acceptance-matrix.csv"),
  join(repositoryRoot, "acceptance", "traceability.csv")
];

const expected = {
  contracts: [
    "capability-binding.schema.json",
    "contract-intake-report.schema.json",
    "delegated-gowm-request-context.schema.json",
    "gowm-consumer-intake-lock.schema.json",
    "gowm-execution-record.schema.json",
    "model-policy.schema.json",
    "pipeline-event.schema.json",
    "qualification-report.schema.json",
    "recipe-catalog.schema.json",
    "runtime-readiness.schema.json",
    "trusted-capability-snapshot.schema.json",
    "world-query-requirement-graph.schema.json"
  ],
  dependencies: ["source-lock.json"],
  examples: [
    "01-unique-reference-current-state.json",
    "02-ambiguous-road.json",
    "03-area-vehicles.json",
    "04-nearby-distance.json",
    "05-model-unavailable-coordinate.json",
    "06-prior-grounding.json",
    "07-contract-drift.json",
    "08-operation-unavailable.json",
    "09-snapshot-mismatch.json",
    "10-terrain-visibility-gap.json",
    "11-delegated-request-context.json",
    "12-pipeline-event.json",
    "13-trusted-capability-snapshot.json"
  ],
  manifests: [
    "capability-gap-policy.json",
    "model-policy.json",
    "pipeline-stage-policy.json",
    "preview-recipe-catalog.json",
    "stable-recipe-catalog.json"
  ],
  openapi: ["wsgs-grounding-api-v0.2-overlay.yaml"]
};

function fail(message) {
  throw new Error(`WSGS v0.2 internal contract verification failed: ${message}`);
}

function json(path) {
  if (!existsSync(path)) fail(`missing ${relative(repositoryRoot, path)}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalizedLf(path) {
  const raw = readFileSync(path);
  const decoded = raw.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(raw)) fail(`${relative(repositoryRoot, path)} is not UTF-8`);
  const normalized = decoded.replaceAll("\r\n", "\n");
  if (normalized.includes("\r")) fail(`${relative(repositoryRoot, path)} contains a non-CRLF carriage return`);
  return Buffer.from(normalized, "utf8");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function names(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function assertExactFiles(directoryName, expectedNames) {
  const actual = names(join(artifactRoot, directoryName));
  if (JSON.stringify(actual) !== JSON.stringify(expectedNames)) {
    fail(`${directoryName} file set mismatch expected=${expectedNames.join("|")} actual=${actual.join("|")}`);
  }
}

for (const [directory, expectedNames] of Object.entries(expected)) assertExactFiles(directory, expectedNames);

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const schemas = new Map();
for (const name of expected.contracts) {
  const schema = json(join(schemaRoot, name));
  if (!ajv.validateSchema(schema)) fail(`${name} is not valid JSON Schema: ${ajv.errorsText(ajv.errors)}`);
  ajv.addSchema(schema);
  schemas.set(name, schema);
}

function validate(schemaName, value, label) {
  const schema = schemas.get(schemaName);
  if (!schema) fail(`unknown schema ${schemaName}`);
  const validator = ajv.getSchema(schema.$id);
  if (!validator) fail(`schema did not compile: ${schemaName}`);
  if (!validator(value)) fail(`${label} failed ${schemaName}: ${ajv.errorsText(validator.errors)}`);
}

validate(
  "gowm-consumer-intake-lock.schema.json",
  json(join(artifactRoot, "dependencies", "source-lock.json")),
  "dependencies/source-lock.json"
);
validate(
  "delegated-gowm-request-context.schema.json",
  json(join(artifactRoot, "examples", "11-delegated-request-context.json")),
  "examples/11-delegated-request-context.json"
);
validate(
  "pipeline-event.schema.json",
  json(join(artifactRoot, "examples", "12-pipeline-event.json")),
  "examples/12-pipeline-event.json"
);
validate(
  "trusted-capability-snapshot.schema.json",
  json(join(artifactRoot, "examples", "13-trusted-capability-snapshot.json")),
  "examples/13-trusted-capability-snapshot.json"
);
for (const name of ["stable-recipe-catalog.json", "preview-recipe-catalog.json"]) {
  validate("recipe-catalog.schema.json", json(join(artifactRoot, "manifests", name)), `manifests/${name}`);
}
validate(
  "model-policy.schema.json",
  json(join(artifactRoot, "manifests", "model-policy.json")),
  "manifests/model-policy.json"
);

const stableRecipes = json(join(artifactRoot, "manifests", "stable-recipe-catalog.json")).recipes;
const previewRecipes = json(join(artifactRoot, "manifests", "preview-recipe-catalog.json")).recipes;
if (stableRecipes.length !== 9 || previewRecipes.length !== 5) fail("recipe catalog counts must be stable=9 preview=5");
const recipeIds = [...stableRecipes, ...previewRecipes].map((recipe) => recipe.recipeId);
if (new Set(recipeIds).size !== recipeIds.length) fail("recipe IDs must be unique across maturity catalogs");

const stagePolicy = json(join(artifactRoot, "manifests", "pipeline-stage-policy.json"));
if (stagePolicy.stages.length !== 14 || new Set(stagePolicy.stages).size !== 14) {
  fail("pipeline stage policy must contain 14 unique stages");
}
const overlay = readFileSync(join(artifactRoot, "openapi", expected.openapi[0]), "utf8");
for (const reference of overlay.matchAll(/\$ref:\s+\.\.\/contracts\/([^\s]+)/gu)) {
  if (!expected.contracts.includes(reference[1])) fail(`OpenAPI overlay has missing schema reference ${reference[1]}`);
}

const acceptanceLines = normalizedLf(acceptancePaths[0]).toString("utf8").trimEnd().split("\n");
if (acceptanceLines[0] !== "id,required,area,scenario,expected,test_type") fail("acceptance header mismatch");
const acceptance = acceptanceLines.slice(1).map((line) => {
  const [id, required] = line.split(",", 3);
  return { id, required };
});
if (acceptance.length !== 279) fail(`expected 279 acceptance cases, received ${acceptance.length}`);
if (new Set(acceptance.map(({ id }) => id)).size !== acceptance.length) fail("acceptance IDs are not unique");
if (acceptance.some(({ required }) => required !== "yes")) fail("all acceptance cases must be required");
const traceabilityLines = normalizedLf(acceptancePaths[1]).toString("utf8").trimEnd().split("\n");
const expectedTraceabilityPhases = [
  "W00",
  "W01",
  "W02",
  "W03",
  "W04",
  "W05",
  "W06",
  "W07-W09",
  "W10-W11",
  "W12",
  "W13",
  "W14"
];
const traceabilityPhases = traceabilityLines.slice(1).map((line) => line.split(",", 1)[0]);
if (
  traceabilityLines[0] !== "phase,acceptance,deliverable" ||
  JSON.stringify(traceabilityPhases) !== JSON.stringify(expectedTraceabilityPhases)
) {
  fail("traceability phase ranges must exactly map W00 through W14");
}

const artifactFiles = Object.entries(expected).flatMap(([directory, fileNames]) =>
  fileNames.map((name) => join(artifactRoot, directory, name))
);
artifactFiles.push(...acceptancePaths);
artifactFiles.sort((left, right) => relative(repositoryRoot, left).localeCompare(relative(repositoryRoot, right)));
const lock = {
  lockVersion: "1.0",
  taskPackageVersion: "R1",
  sourceCommitAtGeneration: "c2a71a0f455c728ae45d70067f223e1450cfa427",
  gowmSourceCommit: "fceed92398a0b86c0a0121aa2188a7f1d328e577",
  artifacts: artifactFiles.map((path) => {
    const bytes = normalizedLf(path);
    return {
      path: relative(repositoryRoot, path).replaceAll("\\", "/"),
      lfBytes: bytes.length,
      lfSha256: sha256(bytes)
    };
  })
};
const canonicalLock = `${JSON.stringify(lock, null, 2)}\n`;
if (process.argv.includes("--write-lock")) {
  writeFileSync(lockPath, canonicalLock, "utf8");
} else if (!existsSync(lockPath) || readFileSync(lockPath, "utf8").replaceAll("\r\n", "\n") !== canonicalLock) {
  fail("artifact lock is missing or stale; run with --write-lock after authorized intake changes");
}

console.log(
  `WSGS_V02_INTERNAL_CONTRACT_PASS schemas=${expected.contracts.length} stableRecipes=${stableRecipes.length} ` +
    `previewRecipes=${previewRecipes.length} examples=${expected.examples.length} acceptance=${acceptance.length}`
);
