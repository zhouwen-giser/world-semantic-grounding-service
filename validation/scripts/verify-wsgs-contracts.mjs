import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const root = join(repositoryRoot, "contracts", "wsgs-v0.1");
const schemaRoot = join(root, "contracts");
const exampleRoot = join(root, "examples");
const openApiPath = join(root, "openapi", "wsgs-grounding-api-v1.yaml");
const lockPath = join(root, "contract-lock.json");
const forbiddenFields = new Set([
  "intent",
  "route",
  "shouldAnswer",
  "shouldForwardToSdar",
  "shouldCreateTask",
  "operationalBindings"
]);

function fail(message) {
  throw new Error(`WSGS contract verification failed: ${message}`);
}

function read(path) {
  if (!existsSync(path)) fail(`missing ${relative(repositoryRoot, path)}`);
  return readFileSync(path);
}

function json(path) {
  return JSON.parse(read(path).toString("utf8"));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function walk(value, visit, path = "$") {
  visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, visit, `${path}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) walk(entry, visit, `${path}.${key}`);
  }
}

function assertNoForbiddenFields(value, label) {
  walk(value, (entry, path) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    for (const key of Object.keys(entry)) {
      if (forbiddenFields.has(key)) fail(`${label} declares forbidden field ${key} at ${path}`);
    }
    if (Array.isArray(entry.required)) {
      for (const field of entry.required) {
        if (forbiddenFields.has(field)) fail(`${label} requires forbidden field ${field} at ${path}`);
      }
    }
    if (entry.properties && typeof entry.properties === "object") {
      for (const field of Object.keys(entry.properties)) {
        if (forbiddenFields.has(field)) fail(`${label} exposes forbidden field ${field} at ${path}`);
      }
    }
  });
}

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

const schemaFiles = readdirSync(schemaRoot).filter((name) => name.endsWith(".schema.json")).sort();
if (schemaFiles.length !== 19) fail(`expected 19 schemas, received ${schemaFiles.length}`);
for (const file of schemaFiles) {
  const schema = json(join(schemaRoot, file));
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") fail(`${file} is not JSON Schema 2020-12`);
  assertNoForbiddenFields(schema, file);
  walk(schema, (entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.$ref !== "string") return;
    const reference = entry.$ref.split("#", 1)[0];
    if (reference && !reference.includes(":") && !existsSync(join(schemaRoot, reference))) {
      fail(`${file} has missing local reference ${reference}`);
    }
  });
}

const requestSchema = json(join(schemaRoot, "grounding-request.schema.json"));
const resultSchema = json(join(schemaRoot, "grounding-result.schema.json"));
const commonSchema = json(join(schemaRoot, "common.schema.json"));
const contextSchema = json(join(schemaRoot, "grounding-context-capsule.schema.json"));
if (requestSchema.additionalProperties !== false || resultSchema.additionalProperties !== false) fail("request/result must fail closed on unknown fields");
const operations = requestSchema.properties.operation.enum;
if (JSON.stringify(operations) !== JSON.stringify(["GROUND_REFERENCES", "COMPILE_WORLD_QUERY", "EXECUTE_WORLD_QUERY", "VALIDATE_REFERENCES"])) {
  fail("service operation enum drift");
}
const products = requestSchema.properties.requestedProducts.items.enum;
if (products.length !== 11 || new Set(products).size !== products.length) fail("requested product enum is not bounded and unique");
if (requestSchema.properties.source.properties.originalText.maxLength !== 32768) fail("source text bound drift");
for (const property of Object.values(contextSchema.properties)) {
  if (property.type === "array" && !Number.isInteger(property.maxItems)) fail("unbounded context array");
}
if (commonSchema.$defs.textSpan.properties.encoding.const !== "UTF16_CODE_UNIT") fail("span encoding drift");

const exampleFiles = readdirSync(exampleRoot).filter((name) => name.endsWith(".json")).sort();
if (exampleFiles.length !== 12) fail(`expected 12 examples, received ${exampleFiles.length}`);
for (const file of exampleFiles) {
  const example = json(join(exampleRoot, file));
  assertNoForbiddenFields(example, file);
  if (file !== "12-no-data-normalization.json") {
    for (const required of requestSchema.required) {
      if (!(required in example)) fail(`${file} lacks required request field ${required}`);
    }
    const originalText = example.source.originalText;
    const expectedHash = `sha256:${sha256(Buffer.from(originalText, "utf8"))}`;
    if (example.source.originalTextSha256 !== expectedHash) fail(`${file} source text hash mismatch`);
    if (originalText.length > 32768) fail(`${file} source text exceeds bound`);
  }
}

const noData = json(join(exampleRoot, "12-no-data-normalization.json"));
if (
  noData.upstreamStatus !== "NO_DATA" ||
  noData.normalizedSemantics?.negativeFact !== false ||
  noData.normalizedSemantics?.unknown !== true
) fail("NO_DATA normalization example drift");

const openApi = read(openApiPath).toString("utf8");
for (const route of [
  "/health/live:",
  "/health/ready:",
  "/v1/capabilities:",
  "/v1/groundings:",
  "/v1/groundings/{groundingId}:",
  "/v1/groundings/{groundingId}:cancel:"
]) {
  if (!openApi.includes(`  ${route}`)) fail(`OpenAPI route missing ${route}`);
}
for (const forbidden of forbiddenFields) {
  if (new RegExp(`^\\s*${forbidden}:`, "mu").test(openApi)) fail(`OpenAPI exposes forbidden field ${forbidden}`);
}

const artifactFiles = filesBelow(root)
  .filter((path) => path !== lockPath)
  .sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
const lock = {
  lockVersion: "1.0",
  contractVersion: "sacs-wsgs-grounding/1.0",
  softwareVersion: "0.1.0",
  artifacts: Object.fromEntries(artifactFiles.map((path) => [
    relative(root, path).replaceAll("\\", "/"),
    `sha256:${sha256(read(path))}`
  ]))
};
const canonical = `${JSON.stringify(lock, null, 2)}\n`;
if (process.argv.includes("--write-lock")) {
  writeFileSync(lockPath, canonical, "utf8");
} else if (read(lockPath).toString("utf8").replaceAll("\r\n", "\n") !== canonical) {
  fail("contract lock is stale");
}

console.log(`WSGS_CONTRACT_FREEZE_PASS schemas=${schemaFiles.length} examples=${exampleFiles.length} artifacts=${artifactFiles.length}`);
