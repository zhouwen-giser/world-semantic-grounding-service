import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = resolve(import.meta.dirname, "..", "..");
const contractRoot = resolve(root, "contracts", "wsgs-v0.2-development");
const reportRoot = resolve(root, "reports", "wsgs-v0.2");
const recipeRoot = resolve(reportRoot, "recipe-evidence");

function fail(message) {
  throw new Error(`WSGS development closure verification failed: ${message}`);
}

function json(path) {
  if (!existsSync(path)) fail(`missing ${path.slice(root.length + 1)}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256File(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Canonical(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function csvRows(path) {
  const lines = readFileSync(path, "utf8").replaceAll("\r\n", "\n").trimEnd().split("\n");
  return { header: lines[0], rows: lines.slice(1) };
}

const expectedSchemas = [
  "development-readiness-report.schema.json",
  "real-pipeline-evidence.schema.json",
  "recipe-evidence.schema.json",
  "sacs-development-handoff.schema.json"
];
const actualSchemas = readdirSync(contractRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".schema.json"))
  .map((entry) => entry.name)
  .sort();
if (JSON.stringify(actualSchemas) !== JSON.stringify([...expectedSchemas].sort())) fail("development schema set mismatch");
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const validators = new Map();
for (const name of expectedSchemas) {
  const schema = json(resolve(contractRoot, name));
  if (!ajv.validateSchema(schema)) fail(`${name} is not valid JSON Schema: ${ajv.errorsText(ajv.errors)}`);
  const validator = ajv.compile(schema);
  validators.set(name, validator);
}
function validate(name, value, label) {
  const validator = validators.get(name);
  if (!validator || !validator(value)) fail(`${label}: ${ajv.errorsText(validator?.errors)}`);
}

const development = csvRows(resolve(root, "acceptance", "development-required.csv"));
const deferred = csvRows(resolve(root, "acceptance", "production-deferred.csv"));
if (development.header !== "id,required,area,scenario,expected,test_type" || development.rows.length !== 63) {
  fail(`development profile must contain 63 rows; received ${development.rows.length}`);
}
if (deferred.header !== "id,profile,area,scenario,blocking_for_development" || deferred.rows.length !== 14 ||
    deferred.rows.some((row) => !row.endsWith(",no"))) {
  fail("production deferred profile must contain 14 non-blocking rows");
}
const reclassification = json(resolve(root, "acceptance", "legacy-279-reclassification.json"));
const historical = json(resolve(reportRoot, "required-acceptance-ledger.json"));
if (reclassification.policy !== "PRESERVE_HISTORY_ADD_SEPARATE_DEVELOPMENT_GATE" ||
    historical.required !== reclassification.legacyLedger.total ||
    historical.summary.PASS !== reclassification.legacyLedger.pass ||
    historical.summary.FAIL !== reclassification.legacyLedger.fail ||
    historical.summary.NOT_RUN !== reclassification.legacyLedger.notRun ||
    historical.summary.BLOCKED !== reclassification.legacyLedger.blocked) {
  fail("historical 279-case ledger was rewritten or reclassification drifted");
}
const errata = json(resolve(contractRoot, "manifests", "acceptance-errata.v1.json"));
if (errata.errata?.length !== 3 || errata.errata.map((entry) => entry.id).join("|") !== "ERRATA-001|ERRATA-002|ERRATA-003") {
  fail("the three acceptance errata are incomplete");
}
const policy = json(resolve(contractRoot, "manifests", "development-gate-policy.json"));
const productionPolicy = json(resolve(contractRoot, "manifests", "production-deferred-policy.json"));
if (policy.goal !== "WSGS_V0_2_DEVELOPMENT_READY" || policy.productionQualified !== false ||
    productionPolicy.blockingForDevelopmentReady !== false) fail("development/deferred policy mismatch");

const realPipelinePath = resolve(reportRoot, "real-pipeline-evidence.json");
const realPipeline = json(realPipelinePath);
validate("real-pipeline-evidence.schema.json", realPipeline, "real-pipeline-evidence.json");
if (realPipeline.status !== "PASS" || realPipeline.stageHashes.length !== 14 ||
    Object.values(realPipeline.realDependencies).some((value) => value !== true)) {
  fail("real pipeline evidence is not a complete trusted fourteen-stage PASS");
}
const recipeIds = ["R1", "R2", "R3", "R4", "R5", "R6"];
for (const recipeId of recipeIds) {
  const value = json(resolve(recipeRoot, `${recipeId}.json`));
  validate("recipe-evidence.schema.json", value, `recipe-evidence/${recipeId}.json`);
  if (value.recipeId !== recipeId || value.status !== "PASS") fail(`${recipeId} recipe evidence is not PASS`);
}
const gate = json(resolve(reportRoot, "development-closure-gate.json"));
if (gate.status !== "PASS" || gate.executionClassification !== "TRUSTED" || gate.recipes?.length !== 6 ||
    gate.readiness?.modelRequired !== "PASS" || gate.readiness?.modelOptionalWithoutModel !== "PASS" ||
    gate.security?.status !== "PASS" || gate.recovery?.status !== "PASS") {
  fail("development closure gate is incomplete");
}
const ledgerPath = resolve(reportRoot, "development-acceptance-ledger.json");
const ledger = json(ledgerPath);
if (ledger.required !== 63 || ledger.decision !== "DEVELOPMENT_READY" || ledger.productionQualified !== false ||
    ledger.summary.PASS !== 63 || ledger.summary.FAIL !== 0 || ledger.summary.NOT_RUN !== 0 || ledger.summary.BLOCKED !== 0) {
  fail("development acceptance must be 63/63 PASS");
}
const report = json(resolve(reportRoot, "development-ready-report.json"));
validate("development-readiness-report.schema.json", report, "development-ready-report.json");
const requiredMarkers = [
  "ACCEPTANCE_PROFILE_SPLIT_READY",
  "REAL_GROUNDING_PIPELINE_READY",
  "STABLE_RECIPE_E2E_READY",
  "MINIMUM_DEVELOPMENT_SECURITY_READY",
  "DEVELOPMENT_RECOVERY_READY",
  "SACS_DEVELOPMENT_HANDOFF_READY",
  "WSGS_V0_2_DEVELOPMENT_READY"
];
if (report.status !== "DEVELOPMENT_READY" || report.productionQualified !== false ||
    report.developmentAcceptance.pass !== 63 || report.developmentAcceptance.fail !== 0 ||
    report.developmentAcceptance.notRun !== 0 ||
    requiredMarkers.some((marker) => !report.markers.includes(marker)) ||
    report.developmentLedgerHash !== sha256File(ledgerPath) ||
    report.realPipelineEvidenceHash !== sha256File(realPipelinePath)) {
  fail("development readiness report is incomplete or hash-drifted");
}
const handoffPath = resolve(root, "contracts", "consumers", "sacs-development-handoff-v1.json");
const handoff = json(handoffPath);
validate("sacs-development-handoff.schema.json", handoff, "sacs-development-handoff-v1.json");
if (handoff.developmentLedgerHash !== report.developmentLedgerHash || handoff.productionQualified !== false ||
    JSON.stringify(handoff.stableRecipes) !== JSON.stringify(recipeIds) ||
    !Array.isArray(handoff.alignmentValidatedRecipes)) {
  fail("SACS development handoff does not match the tested candidate and ledger");
}
const handoffVerification = json(resolve(
  root,
  "reports",
  "wsgs-gowm-0.6.4-alignment",
  "handoff-verification-report.json"
));
const { evidenceHash: handoffEvidenceHash, ...handoffVerificationPayload } = handoffVerification;
if (handoffVerification.schemaVersion !== "wsgs-gowm-handoff-verification/1.0" ||
    !["BLOCKED", "PASS"].includes(handoffVerification.status) ||
    handoffVerification.handoffPath !== "contracts/consumers/sacs-development-handoff-v1.json" ||
    handoffVerification.handoffFileHash !== sha256File(handoffPath) ||
    handoffVerification.wsgsSourceBinding?.status !== "PASS" ||
    handoffVerification.wsgsSourceBinding?.sourceCommit !== handoff.wsgs.commit ||
    canonicalJson(handoffVerification.exactTuple) !== canonicalJson(handoff.gowm) ||
    JSON.stringify(handoffVerification.alignmentValidatedRecipes) !== JSON.stringify(handoff.alignmentValidatedRecipes) ||
    handoffVerification.productionQualified !== handoff.productionQualified ||
    handoffEvidenceHash !== sha256Canonical(handoffVerificationPayload)) {
  fail("SACS development handoff alignment binding is incomplete or hash-drifted");
}

console.log(
  `WSGS_V02_DEVELOPMENT_CLOSURE_PASS schemas=${expectedSchemas.length} development=63/63 ` +
  `deferred=${deferred.rows.length} recipes=${recipeIds.length} productionQualified=false`
);
