import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { canonicalHash } from "../../contracts/wsgs-v0.2.4-world-analysis/validator.mjs";

// Explicit fixture intake only. Normal tests never need an upstream checkout.
const repository = process.argv[2];
if (!repository) throw new Error("Usage: node validation/scripts/generate-world-analysis-http-catalog.mjs <GOWM checkout>");
const commit = "c49bf415fdb4cbe19a09f341c34b6dd825e3ca14";
const read = path => JSON.parse(execFileSync("git", ["show", `${commit}:${path}`], { cwd: repository, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" }));
const registry = read("config/world-platform-gateway-registry.json");
const capabilities = registry.providers.flatMap(provider => read(provider.manifestPath).capabilities)
  .sort((a, b) => `${a.operationId}@${a.operationVersion}` < `${b.operationId}@${b.operationVersion}` ? -1 : 1);
const profiles = capabilities.map(({ operationId, operationVersion, semanticProfile }) => {
  if (!semanticProfile) throw new Error(`Missing explicit semantic profile: ${operationId}`);
  return { operationId, operationVersion, semanticProfile, semanticProfileHash: canonicalHash(semanticProfile) };
});
const lock = JSON.parse(readFileSync("contracts/upstream/gowm-0.6.3/extracted/package/bundle/locks/wsgs-southbound-operation-lock-v2.json", "utf8"));
if (canonicalHash(profiles) !== lock.semanticCatalogHash) throw new Error("Semantic catalog does not match locked intake");
for (const operation of [...lock.defaultOperations, ...lock.previewOperations]) {
  const descriptor = capabilities.find(value => value.operationId === operation.operationId && value.operationVersion === operation.operationVersion);
  if (!descriptor || descriptor.inputSchemaHash !== operation.inputSchemaHash || descriptor.outputSchemaHash !== operation.outputSchemaHash ||
    canonicalHash(descriptor.semanticProfile) !== operation.semanticProfileHash) throw new Error(`Locked descriptor mismatch: ${operation.operationId}`);
}
const directory = resolve("validation/fixtures/world-analysis-http");
mkdirSync(directory, { recursive: true });
const bytes = JSON.stringify({ capabilities, profiles }, null, 2) + "\n";
writeFileSync(resolve(directory, "gateway-catalog.json"), bytes);
writeFileSync(resolve(directory, "SOURCE.json"), JSON.stringify({ sourceCommit: commit,
  sourceRegistry: "config/world-platform-gateway-registry.json", capabilityCount: capabilities.length,
  semanticCatalogHash: lock.semanticCatalogHash, sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  contains: "Public capability descriptors and explicit semantics only; no endpoints or credentials",
  verification: "Every operation matches the frozen WSGS southbound schema and semantic hashes" }, null, 2) + "\n");
console.log(`WORLD_ANALYSIS_HTTP_CATALOG_INTAKE_PASS operations=${capabilities.length}`);
