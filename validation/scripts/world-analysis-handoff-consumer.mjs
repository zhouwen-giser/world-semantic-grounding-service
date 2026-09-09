import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, relative, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const assert = (condition, code) => { if (!condition) throw new Error(code); };
export function verifySelectionLink(prior, request) {
  for (const selection of request.analysisSelections) {
    assert(selection.priorGroundingId === prior.groundingId && selection.priorResultHash === prior.resultHash &&
      selection.findingSetHash === prior.worldAnalysisFindings.findingSetHash, "HANDOFF_SELECTION_ANCHOR_MISMATCH");
    const choice = prior.worldAnalysisFindings.choices.find(value => value.choiceId === selection.choiceId);
    assert(choice?.candidates.some(value => value.candidateId === selection.candidateId), "HANDOFF_SELECTION_CANDIDATE_MISMATCH");
  }
}
export function filesUnder(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(root, entry.name);
    assert(!lstatSync(path).isSymbolicLink(), "HANDOFF_SYMLINK_FORBIDDEN");
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}
export async function verifyHandoff(root) {
  root = realpathSync(root);
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
  assert(manifest.contractVersion === "sacs-wsgs-grounding/1.2" && manifest.resultProfile === "wsgs-world-analysis-findings/1.0", "HANDOFF_PROFILE_MISMATCH");
  const actual = filesUnder(root).map(path => relative(root, path).split(sep).join("/")).filter(path => path !== "manifest.json").sort();
  assert(JSON.stringify(actual) === JSON.stringify(Object.keys(manifest.files).sort()), "HANDOFF_FILE_SET_MISMATCH");
  for (const path of actual) assert(hash(readFileSync(resolve(root, path))) === manifest.files[path], `HANDOFF_CHECKSUM_MISMATCH:${path}`);
  const releaseBytes = readFileSync(resolve(root, "public/contract-release-lock.json"));
  assert(hash(releaseBytes) === "sha256:45f027673834f3d9e654a889eea25eaf81522f594af8dddf6939b91a0dd4c41a", "HANDOFF_FREEZE_LOCK_DRIFT");
  const release = JSON.parse(releaseBytes);
  for (const [path, digest] of Object.entries(release.artifacts)) assert(hash(readFileSync(resolve(root, "public", path))) === digest, "HANDOFF_FROZEN_ARTIFACT_DRIFT");
  const require = createRequire(pathToFileURL(resolve(root, "public/validator.mjs")));
  assert(JSON.stringify(manifest.dependencies.map(value => value.name).sort()) ===
    JSON.stringify(["ajv", "ajv-formats", "fast-deep-equal", "fast-uri", "json-schema-traverse", "require-from-string"]), "HANDOFF_DEPENDENCY_SET_MISMATCH");
  for (const dependency of manifest.dependencies) {
    const path = realpathSync(require.resolve(`${dependency.name}/package.json`));
    assert(path.startsWith(resolve(root, "node_modules") + sep), "HANDOFF_EXTERNAL_DEPENDENCY");
    assert(JSON.parse(readFileSync(path, "utf8")).version === dependency.version, "HANDOFF_DEPENDENCY_VERSION_MISMATCH");
  }
  const { createPublicValidator } = await import(pathToFileURL(resolve(root, "public/validator.mjs")).href);
  const validate = createPublicValidator();
  const examples = JSON.parse(readFileSync(resolve(root, "public/examples/manifest.json"), "utf8")).examples;
  const results = examples.map(example => {
    const value = JSON.parse(readFileSync(resolve(root, "public", example.path), "utf8"));
    const result = validate(example.schema, value);
    assert(result.valid === example.valid, `HANDOFF_EXAMPLE_FAILED:${example.path}`);
    if (!example.valid) assert(result.errors.some(error => error.code === example.expectedCode), `HANDOFF_EXAMPLE_CODE_FAILED:${example.path}`);
    return { path: example.path, expectedValid: example.valid, actualValid: result.valid, expectedCode: example.expectedCode, errors: result.errors };
  });
  const prior = JSON.parse(readFileSync(resolve(root, "public/examples/ranking.json"), "utf8"));
  const request = JSON.parse(readFileSync(resolve(root, "public/examples/request-selection.json"), "utf8"));
  verifySelectionLink(prior, request);
  const selectionNegatives = [];
  for (const [field, expected] of [["priorResultHash", "HANDOFF_SELECTION_ANCHOR_MISMATCH"], ["candidateId", "HANDOFF_SELECTION_CANDIDATE_MISMATCH"]]) {
    const changed = structuredClone(request); changed.analysisSelections[0][field] = "wrong";
    let rejection;
    try { verifySelectionLink(prior, changed); } catch (error) { rejection = error.message; }
    assert(rejection === expected, "HANDOFF_SELECTION_NEGATIVE_FAILED");
    selectionNegatives.push({ field, rejection, status: "PASS" });
  }
  return { status: "PASS", scope: "OFFLINE_PUBLIC_HANDOFF_ONLY", files: actual.length, dependencies: manifest.dependencies.length,
    selectionLink: { status: "PASS", scope: "SAMPLE_CONSISTENCY_NOT_SERVER_AUTHORIZATION_OR_TTL", selectionNegatives },
    positiveExamples: results.filter(value => value.expectedValid).length, negativeExamples: results.filter(value => !value.expectedValid).length, results };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await verifyHandoff(fileURLToPath(new URL(".", import.meta.url))), null, 2));
}
