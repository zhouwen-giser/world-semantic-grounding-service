import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalHash } from "../../contracts/wsgs-v0.2.4-world-analysis/validator.mjs";

const repository = process.argv[2];
if (!repository) throw new Error("Usage: node validation/scripts/generate-world-analysis-history-http-fixture.mjs <GOWM checkout>");
const commit = "a4023f545e7d43beac316abc3ad510f96ccfea61";
const sources = [];
const read = path => {
  const bytes = execFileSync("git", ["show", `${commit}:${path}`], { cwd: repository, maxBuffer: 8 * 1024 * 1024 });
  sources.push({ path, sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}` });
  return JSON.parse(bytes.toString("utf8"));
};
const ids = ["history.get-trajectory", "operational-task.get-execution-intervals", "operational-task.find", "operational-task.get"];
const capabilities = ["historical-trace-provider", "operational-reality-provider"].flatMap(name =>
  read(`contracts/manifests/providers/${name}.json`).capabilities).filter(entry => ids.includes(entry.operationId));
const lock = read("contracts/consumers/wsgs-southbound-operation-lock-v2.json");
const operations = [...lock.defaultOperations, ...lock.previewOperations].filter(entry => ids.includes(entry.operationId));
if (capabilities.length !== 4 || operations.length !== 4) throw new Error("HISTORY_FIXTURE_COUNT_MISMATCH");
for (const entry of operations) {
  const descriptor = capabilities.find(value => value.operationId === entry.operationId && value.operationVersion === entry.operationVersion);
  if (!descriptor || descriptor.inputSchemaHash !== entry.inputSchemaHash || descriptor.outputSchemaHash !== entry.outputSchemaHash ||
      canonicalHash(descriptor.semanticProfile) !== entry.semanticProfileHash) throw new Error("HISTORY_FIXTURE_LOCK_MISMATCH");
}
const output = "validation/fixtures/world-analysis-http/history-metadata.json";
const bytes = JSON.stringify({ capabilities, operations }, null, 2) + "\n";
writeFileSync(output, bytes);
writeFileSync("validation/fixtures/world-analysis-http/HISTORY_SOURCE.json", JSON.stringify({ commit, sources,
  fixtureSha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  scope: "Four real history descriptors and their exact source lock entries; no endpoints, credentials or live data" }, null, 2) + "\n");
console.log("WORLD_ANALYSIS_HISTORY_HTTP_INTAKE_PASS operations=4");
