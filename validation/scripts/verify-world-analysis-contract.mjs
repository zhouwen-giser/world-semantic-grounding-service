import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createPublicValidator, canonicalJson, canonicalHash, findingSetHash, resultHash, aggregateAnalysisStatus, isWorldAnalysisTransport, contractVersion, resultProfile } from "../../contracts/wsgs-v0.2.4-world-analysis/validator.mjs";
import { schemaDocuments } from "../../contracts/wsgs-v0.2.4-world-analysis/generated/schema-documents.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const directory = join(root, "contracts/wsgs-v0.2.4-world-analysis");
const json = path => JSON.parse(readFileSync(join(directory, path), "utf8"));
const sha = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions++; }
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }
const validate = createPublicValidator();
const documentsById = new Map(schemaDocuments.map(schema => [schema.$id, schema]));
function pointer(document, fragment) {
  if (!fragment) return document;
  assert.ok(fragment.startsWith("/"));
  return fragment.slice(1).split("/").reduce((value, key) => value?.[decodeURIComponent(key).replaceAll("~1", "/").replaceAll("~0", "~")], document);
}
function inspectRefs(value, source) {
  if (!value || typeof value !== "object") return;
  if (value.$ref) {
    const [id, fragment] = value.$ref.split("#");
    const target = id ? documentsById.get(id) : source;
    check(target !== undefined && pointer(target, fragment) !== undefined, `Unresolved offline ref ${value.$ref}`);
  }
  for (const child of Object.values(value)) inspectRefs(child, source);
}
for (const schema of schemaDocuments) inspectRefs(schema, schema);
const examples = json("examples/manifest.json");
for (const example of examples.examples) {
  const actual = validate(example.schema, json(example.path));
  equal(actual.valid, example.valid, example.path);
  if (example.expectedCode) check(actual.errors.some(error => error.code === example.expectedCode), `${example.path}: ${example.expectedCode}`);
}
for (const vector of json("hash-vectors.json").vectors) {
  equal(canonicalJson(vector.input), vector.canonical, "Fixed canonical JSON");
  equal(canonicalHash(vector.input), vector.hash, "Fixed hash");
  equal(sha(vector.canonical), vector.hash, "Independent byte SHA-256");
}
equal(canonicalJson({ b: undefined, a: -0 }), '{"a":0}', "Omitted member and negative zero");
for (const invalid of [NaN, Infinity, -Infinity, undefined, 1n, Symbol("x"), new Date(), [undefined], new Array(1), new Map(), () => 1]) {
  assert.throws(() => canonicalJson(invalid)); assertions++;
}
const cyclic = {}; cyclic.self = cyclic;
assert.throws(() => canonicalJson(cyclic)); assertions++;
const result = json("examples/ranking.json");
const elapsed = structuredClone(result); elapsed.execution.elapsedMs += 1000;
equal(resultHash(elapsed), result.resultHash, "Elapsed time excluded");
const changed = structuredClone(result); changed.worldAnalysisFindings.findings[0].warnings.push("CHANGED");
check(findingSetHash(changed.worldAnalysisFindings) !== result.worldAnalysisFindings.findingSetHash, "Findings are hashed");
check(resultHash(changed) !== result.resultHash, "Extension included in result hash");
check(sha(JSON.stringify(result)) !== result.resultHash, "Raw bytes hash is not result identity");
const nonFinite = structuredClone(result); nonFinite.worldAnalysisFindings.findings[0].candidates[0].representativeVisitedPosition.coordinates[0] = NaN;
check(!validate("result", nonFinite).valid, "Non-finite coordinates fail");
check(!validate("result", result, { maxResultBytes: 1024 }).valid, "Caller size limit wins");
const legacyRequestId = "urn:wsgs:v0.1:grounding-request";
check(validate(legacyRequestId, json("examples/request-first.json")).valid, "Legacy request remains accepted");
check(!validate(legacyRequestId, json("examples/request-selection.json")).valid, "Legacy request rejects analysis selections");
check(!validate("urn:wsgs:v0.1:grounding-result", result).valid, "Legacy result rejects world extension");
check(!validate("urn:wsgs:v0.2.1:sacs-geospatial:grounding-result:1.1", result).valid, "1.1 result rejects world extension");
for (const version of [contractVersion, undefined, "sacs-wsgs-grounding/1.1", `${contractVersion} `, `${contractVersion},${contractVersion}`, [contractVersion, contractVersion]]) {
  for (const profile of [resultProfile, undefined, "sacs-wsgs-geospatial-findings/1.0", ` ${resultProfile}`, [resultProfile]]) {
    for (const authorized of [false, true]) equal(isWorldAnalysisTransport(version, profile, authorized), version === contractVersion && profile === resultProfile && authorized, "Exact authorized transport matrix");
  }
}
const component = { profile: resultProfile, findings: [], choices: [], gaps: [] };
equal(aggregateAnalysisStatus(component), "COMPLETED");
equal(aggregateAnalysisStatus({ ...component, choices: [{}] }), "AMBIGUOUS");
equal(aggregateAnalysisStatus({ ...component, choices: [{}] }, true), "CANCELLED");
for (const gapKind of ["UPSTREAM_TIMEOUT", "UPSTREAM_FAILURE", "UPSTREAM_CONTRACT_MISMATCH"]) {
  equal(aggregateAnalysisStatus({ ...component, gaps: [{ gapKind, severity: "BLOCKING" }] }), "FAILED");
  equal(aggregateAnalysisStatus({ ...component, findings: [{ status: "COMPLETED" }], gaps: [{ gapKind, severity: "BLOCKING" }] }), "PARTIAL");
}
equal(aggregateAnalysisStatus({ ...component, gaps: [{ gapKind: "TASK_CONTEXT_REQUIRED", severity: "BLOCKING" }] }), "UNRESOLVED");
equal(aggregateAnalysisStatus({ ...component, gaps: [{ gapKind: "HISTORICAL_PROJECTION_PENDING", severity: "BLOCKING" }] }), "PARTIAL");
equal(aggregateAnalysisStatus({ ...component, findings: [{ status: "NO_DATA" }] }), "COMPLETED");
equal(aggregateAnalysisStatus({ ...component, gaps: [{ gapKind: "EXECUTION_NOT_AUTHORIZED", severity: "INFO" }] }), "COMPLETED");
const capsSchema = json("capabilities-1.2.schema.json");
const limits = json("limits.json");
for (const [key, schema] of Object.entries(capsSchema.properties.limits.properties)) equal(limits[key], schema.const, `Limit ${key}`);
equal(json("vocabulary.json").gapKinds, json("gap.schema.json").properties.gapKind.enum, "Finite gap vocabulary");
const openapi = json("openapi.json");
const responseTargets = [
  ["/v1/groundings", "post", "200", "./grounding-result-1.2.schema.json"],
  ["/v1/groundings", "post", "202", "./grounding-job-1.2.schema.json"],
  ["/v1/groundings/{groundingId}", "get", "200", "./grounding-job-1.2.schema.json"],
  ["/v1/groundings/{groundingId}:cancel", "post", "200", "./grounding-job-1.2.schema.json"]
];
for (const [path, method, status, target] of responseTargets) equal(openapi.paths[path][method].responses[status].content["application/json"].schema.$ref, target, "Actual HTTP envelope");
function openapiRefs(value) {
  if (!value || typeof value !== "object") return;
  if (value.$ref) {
    const path = resolve(directory, value.$ref);
    check(path.startsWith(directory + sep) && existsSync(path), "OpenAPI offline reference");
    check(documentsById.has(JSON.parse(readFileSync(path, "utf8")).$id), "OpenAPI references included schema");
  }
  for (const child of Object.values(value)) openapiRefs(child);
}
openapiRefs(openapi);
for (const [vendored, original] of [["legacy", "contracts/wsgs-v0.1/contracts"], ["geospatial", "contracts/wsgs-v0.2.1-sacs-geospatial"]]) {
  for (const name of readdirSync(join(directory, "dependencies", vendored))) {
    equal(readFileSync(join(directory, "dependencies", vendored, name)), readFileSync(join(root, original, name)), `Byte-immutable public dependency ${name}`);
  }
}
if (!process.argv.includes("--draft")) {
  const lock = json("contract-release-lock.json");
  const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(path, entry.name)) : [relative(directory, join(path, entry.name)).replaceAll("\\", "/")]);
  const files = walk(directory).filter(path => !["contract-release-lock.json", "CHECKSUMS.sha256"].includes(path)).sort();
  equal(files, Object.keys(lock.artifacts).sort(), "Exact release inventory");
  for (const [path, hash] of Object.entries(lock.artifacts)) equal(sha(readFileSync(join(directory, path))), hash, `Release hash ${path}`);
  const expectedChecksums = [...files, "contract-release-lock.json"].sort().map(path => `${sha(readFileSync(join(directory, path))).slice(7)}  ${path}\n`).join("");
  equal(readFileSync(join(directory, "CHECKSUMS.sha256"), "utf8"), expectedChecksums, "Exact checksums");
}
for (const script of ["generate-world-analysis-contract.mjs", "generate-world-analysis-examples.mjs", "world-analysis-legacy-baseline.mjs"]) {
  execFileSync(process.execPath, [join(root, "validation/scripts", script), "--check"], { cwd: root, stdio: "inherit" });
}
const generatedTypes = readdirSync(join(directory, "generated")).filter(name => name.endsWith(".ts")).map(name => join(directory, "generated", name));
execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--ignoreConfig", "--noEmit", "--strict", "--module", "nodenext", "--target", "es2022", ...generatedTypes, join(directory, "validator.d.mts")], { cwd: root, stdio: "inherit" });
console.log(JSON.stringify({ status: "PASS", scope: process.argv.includes("--draft") ? "W01_DRAFT_CONTRACT_NOT_FROZEN" : "W01_FROZEN_CONTRACT_ONLY", schemas: schemaDocuments.length, examples: examples.examples.length, assertions, runtimeValidated: false, liveServicesUsed: false }));
