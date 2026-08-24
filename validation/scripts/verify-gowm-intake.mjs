import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const upstreamRoot = join(repositoryRoot, "contracts", "upstream");
const contractRoot = join(upstreamRoot, "gowm-v0.4");
const expectedCommit = "db575f79c874a69f65a2043a7e463338524b713d";
const expectedVersion = "0.4.0";
const expectedSourceLockBlob = "97b118737f82bfe49c7741b2787da9d72e2d7400";
const expectedGatewayOpenApiBlob = "120f1f3ca2d65f5d7a73422718b6aa152794abed";
const allowedMaturities = new Set(["PREVIEW", "STABLE"]);

function fail(message) {
  throw new Error(`GOWM intake verification failed: ${message}`);
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

function gitBlobSha(bytes) {
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

function sourceArtifactPath(sourcePath) {
  if (sourcePath.startsWith("openapi/")) {
    return join(upstreamRoot, "gowm-platform", ...sourcePath.split("/"));
  }
  const vendoredPath = sourcePath.startsWith("contracts/")
    ? sourcePath.slice("contracts/".length)
    : sourcePath;
  return join(contractRoot, ...vendoredPath.split("/"));
}

const commit = read(join(upstreamRoot, "GOWM_COMMIT")).toString("utf8").trim();
const version = read(join(upstreamRoot, "GOWM_VERSION")).toString("utf8").trim();
if (commit !== expectedCommit) fail(`commit ${commit}`);
if (version !== expectedVersion) fail(`version ${version}`);

const upstreamLock = json(join(upstreamRoot, "gowm-upstream-lock.json"));
if (upstreamLock.commit !== expectedCommit || upstreamLock.softwareVersion !== expectedVersion) {
  fail("task lock commit/version mismatch");
}

const sourceLockPath = join(contractRoot, "source-package-lock.json");
const sourceLockBytes = read(sourceLockPath);
if (gitBlobSha(sourceLockBytes) !== expectedSourceLockBlob) fail("source lock Git blob mismatch");
const sourceLock = JSON.parse(sourceLockBytes.toString("utf8"));
const artifacts = Object.entries(sourceLock.artifacts);
if (artifacts.length !== 33) fail(`expected 33 source artifacts, received ${artifacts.length}`);
for (const [sourcePath, expectedHash] of artifacts) {
  const actual = sha256(read(sourceArtifactPath(sourcePath)));
  if (actual !== expectedHash) fail(`byte hash mismatch for ${sourcePath}`);
}

const gatewayOpenApi = read(join(upstreamRoot, "gowm-platform", "openapi", "world-capability-gateway-v1.yaml"));
if (gitBlobSha(gatewayOpenApi) !== expectedGatewayOpenApiBlob) fail("Gateway OpenAPI Git blob mismatch");

const requiredPolicy = json(join(upstreamRoot, "required-gowm-capabilities.json"));
const expectedProviders = requiredPolicy.requiredProviders;
const providerDirectory = join(contractRoot, "manifests", "providers");
const operations = [];
for (const file of readdirSync(providerDirectory).filter((name) => name.endsWith(".json")).sort()) {
  const provider = json(join(providerDirectory, file));
  const expectedCount = expectedProviders[provider.providerId];
  if (expectedCount === undefined) fail(`unexpected required provider ${provider.providerId}`);
  if (provider.operations.length !== expectedCount) fail(`operation count mismatch for ${provider.providerId}`);
  for (const operation of provider.operations) {
    if (operation.operationVersion !== "1.0") fail(`operation version drift for ${operation.operationId}`);
    if (!allowedMaturities.has(operation.maturity)) fail(`maturity drift for ${operation.operationId}`);
    for (const direction of ["input", "output"]) {
      const schemaFile = operation[`${direction}SchemaFile`];
      const schemaHash = operation[`${direction}SchemaHash`];
      if (!schemaFile || !schemaHash?.startsWith("sha256:")) fail(`missing ${direction} schema lock for ${operation.operationId}`);
      const actualSchemaHash = `sha256:${sha256(read(sourceArtifactPath(schemaFile)))}`;
      if (actualSchemaHash !== schemaHash) fail(`${direction} schema hash drift for ${operation.operationId}`);
    }
    operations.push({
      operationId: operation.operationId,
      operationVersion: operation.operationVersion,
      providerId: provider.providerId,
      providerVersion: provider.providerVersion,
      maturity: operation.maturity,
      inputSchemaFile: operation.inputSchemaFile,
      inputSchemaHash: operation.inputSchemaHash,
      outputSchemaFile: operation.outputSchemaFile,
      outputSchemaHash: operation.outputSchemaHash
    });
  }
}

const expectedOperationIds = requiredPolicy.requiredOperations.map((entry) => entry.operationId).sort();
const actualOperationIds = operations.map((entry) => entry.operationId).sort();
if (actualOperationIds.length !== 28 || new Set(actualOperationIds).size !== 28) fail("required operations are not 28 unique entries");
if (JSON.stringify(actualOperationIds) !== JSON.stringify(expectedOperationIds)) fail("required operation catalog mismatch");

const generatedLock = {
  lockVersion: "1.0",
  source: {
    repository: upstreamLock.repository,
    commit: expectedCommit,
    softwareVersion: expectedVersion,
    sourcePackageLockGitBlob: expectedSourceLockBlob,
    gatewayOpenApiGitBlob: expectedGatewayOpenApiBlob
  },
  providers: Object.keys(expectedProviders).sort(),
  operations: operations.sort((left, right) => left.operationId.localeCompare(right.operationId))
};
const generatedLockPath = join(upstreamRoot, "required-operation-lock.json");
const canonical = `${JSON.stringify(generatedLock, null, 2)}\n`;
if (process.argv.includes("--write-lock")) {
  writeFileSync(generatedLockPath, canonical, "utf8");
} else if (read(generatedLockPath).toString("utf8").replaceAll("\r\n", "\n") !== canonical) {
  fail("generated required operation lock is stale");
}

console.log(`GOWM_CONTRACT_INTAKE_PASS commit=${expectedCommit} artifacts=${artifacts.length} providers=${Object.keys(expectedProviders).length} operations=${operations.length}`);
