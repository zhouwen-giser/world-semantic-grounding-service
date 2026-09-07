import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { posix } from "node:path";
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
const schemas = {};
function collect(path) {
  if (schemas[path]) return;
  if (!path.startsWith("contracts/") || !path.endsWith(".schema.json")) throw new Error("HISTORY_SCHEMA_PATH_INVALID");
  const schema = read(path); schemas[path] = schema;
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (typeof value.$ref === "string" && !value.$ref.startsWith("#")) {
      if (/^[a-z]+:/i.test(value.$ref)) throw new Error("HISTORY_EXTERNAL_SCHEMA_REFERENCE");
      collect(posix.normalize(posix.join(posix.dirname(path), value.$ref.split("#")[0])));
    }
    Object.values(value).forEach(visit);
  }
  visit(schema);
}
for (const name of ["historical-trajectory-result", "task-execution-interval-result"]) collect(`contracts/gowm-v0.7.1/${name}.schema.json`);
for (const [id, path] of [["history.get-trajectory", "historical-trajectory-result"], ["operational-task.get-execution-intervals", "task-execution-interval-result"]]) {
  if (canonicalHash(schemas[`contracts/gowm-v0.7.1/${path}.schema.json`]) !== operations.find(entry => entry.operationId === id).outputSchemaHash) throw new Error("HISTORY_OUTPUT_SCHEMA_LOCK_MISMATCH");
}
const schemaBytes = JSON.stringify(schemas, null, 2) + "\n";
writeFileSync("validation/fixtures/world-analysis-http/history-schemas.json", schemaBytes);
writeFileSync("validation/fixtures/world-analysis-http/HISTORY_SOURCE.json", JSON.stringify({ commit, sources,
  fixtureSha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  schemaSha256: `sha256:${createHash("sha256").update(schemaBytes).digest("hex")}`,
  scope: "Four real history descriptors, exact source lock entries and historical output schema closure; no endpoints, credentials or live data" }, null, 2) + "\n");
console.log("WORLD_ANALYSIS_HISTORY_HTTP_INTAKE_PASS operations=4");
