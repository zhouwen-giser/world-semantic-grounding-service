import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type JsonObject = Record<string, unknown>;

const root = process.cwd();
const write = process.argv.includes("--write");
if (process.argv.includes("--execute")) {
  throw new Error("N10_RUNTIME_EXECUTION_NOT_AUTHORIZED_OR_IMPLEMENTED_USE_ISOLATED_QUALIFICATION_RUNNER");
}

const sourceLock = json(join(root, "contracts", "handoff-source-locks", "wsgs-sacs-geospatial-v1.json"));
const sacsRoot = resolve(root, "..", "..", "single-agent-chat-server", ".tmp", "worktrees", "v04-closure");
const expectedSacsHead = String(record(sourceLock["sacs"])["consumerHeadSha"]);
const actualSacsHead = execFileSync("git", ["-C", sacsRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (actualSacsHead !== expectedSacsHead) throw new Error("N10_SACS_HEAD_MISMATCH");
const corpusPath = join(sacsRoot, "config", "geospatial-explanation", "e2e-corpus.json");
const corpusBytes = readFileSync(corpusPath);
const corpus = json(corpusPath);
const cases = array(corpus["cases"]);
const expectedCaseIds = [
  "E2E-01", "E2E-02", "E2E-03", "E2E-04", "E2E-05", "E2E-06", "E2E-07", "E2E-08", "E2E-09", "E2E-10",
  "NEG-01", "NEG-02", "NEG-03", "NEG-04", "NEG-05", "NEG-06", "NEG-07", "HYBRID-01"
];
const actualCaseIds = cases.map((item) => String(record(item)["caseId"]));
if (JSON.stringify(actualCaseIds) !== JSON.stringify(expectedCaseIds)) throw new Error("N10_CORPUS_INVENTORY_MISMATCH");
if (corpus["schemaVersion"] !== "sacs-geospatial-e2e-corpus/1.0" || corpus["fixtureCannotSatisfyLive"] !== true) {
  throw new Error("N10_CORPUS_CONTRACT_INVALID");
}

const n07 = json(join(root, "reports", "sacs-geospatial-v1", "N07-postgres-integration.json"));
const n09 = json(join(root, "reports", "sacs-geospatial-v1", "N09-sacs-intake.json"));
const blockers = [
  ...(n07["status"] === "PASS" ? [] : ["N07_REAL_POSTGRESQL_QUALIFICATION_REQUIRED"]),
  ...(n09["status"] === "PASS" ? [] : ["N09_SACS_CONSUMER_COMPATIBILITY_REQUIRED"]),
  ...(sourceLock["status"] === "READY" ? [] : ["EXACT_SOURCE_RUNTIME_TUPLE_REQUIRED"]),
  "EXPLICIT_ISOLATED_DOCKER_EXECUTION_AUTHORIZATION_REQUIRED"
];
const sourceTuple = {
  wsgs: record(sourceLock["wsgs"]),
  gowm: record(sourceLock["gowm"]),
  gdps: record(sourceLock["gdps"]),
  sacs: record(sourceLock["sacs"])
};
const corpusHash = `sha256:${createHash("sha256").update(Buffer.from(corpusBytes.toString("utf8").replaceAll("\r\n", "\n"))).digest("hex")}`;
const runtimeBinding = {
  schemaVersion: "wsgs-v021-n10-runtime-binding/1.0",
  phase: "N10",
  status: "NOT_RUN",
  sourceTuple,
  corpus: { source: "SACS_PR17_CURRENT_E2E_CORPUS", hash: corpusHash, caseCount: cases.length },
  requiredLivePath: [
    "SACS_HTTP", "WSGS_HTTP", "WSGS_POSTGRES_QUEUE_WORKER_PIPELINE", "GOWM_WORLD_CAPABILITY_GATEWAY",
    "GDPS_CURRENT_PRODUCT", "WSGS_FINDING_PERSISTENCE", "SACS_EXPLANATION_PERSISTENCE", "RESULT_RETRIEVAL"
  ],
  isolatedComposeIdentity: null,
  imageDigests: null,
  blockers
};
const results = cases.map((item) => {
  const candidate = record(item);
  return {
    caseId: candidate["caseId"],
    questionKind: candidate["questionKind"],
    expectedExplanationStatus: candidate["expectedExplanationStatus"],
    status: "NOT_RUN",
    runtimeEvidence: null,
    blockers
  };
});
const realE2e = {
  schemaVersion: "wsgs-v021-n10-real-e2e/1.0",
  phase: "N10",
  status: "NOT_RUN",
  corpusHash,
  counts: { pass: 0, fail: 0, notRun: 18, blocked: 0 },
  cases: results,
  fixtureOrMockAcceptedAsRealEvidence: false,
  directProviderCalls: null,
  completionMarkerEmitted: false
};
const cleanup = {
  schemaVersion: "wsgs-v021-n10-cleanup/1.0",
  phase: "N10",
  status: "NOT_RUN",
  runtimeCreated: false,
  containersRemoved: 0,
  networksRemoved: 0,
  volumesRemoved: 0,
  dockerInvoked: false
};
const reportRoot = join(root, "reports", "sacs-geospatial-v1");
const caseRoot = join(reportRoot, "N10-case-evidence");
if (write) mkdirSync(caseRoot, { recursive: true });
emit(join(reportRoot, "N10-runtime-binding.json"), runtimeBinding);
emit(join(reportRoot, "N10-real-e2e.json"), realE2e);
emit(join(reportRoot, "N10-cleanup.json"), cleanup);
for (const result of results) emit(join(caseRoot, `${String(result.caseId)}.json`), result);
const phaseReport = [
  "# N10 real SACS geospatial E2E",
  "",
  "Status: NOT_RUN",
  "",
  `- SACS corpus: 18 exact cases, normalized-LF hash ${corpusHash}`,
  "- No Docker, Compose, network, database, Provider, Gateway, or shared runtime operation was invoked.",
  "- Every case remains NOT_RUN until N07 and N09 are PASS and a fresh explicit isolated-runtime authorization exists.",
  "- Fixture and mock evidence cannot satisfy this gate.",
  "",
  "Completion marker WSGS_SACS_V04_REAL_E2E_QUALIFIED is withheld."
].join("\n") + "\n";
emitText(join(reportRoot, "N10-phase-report.md"), phaseReport);
console.log(`WSGS_SACS_V04_REAL_E2E_NOT_RUN cases=${cases.length} corpus=${corpusHash}`);

function emit(path: string, value: unknown): void {
  emitText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function emitText(path: string, content: string): void {
  if (write) writeFileSync(path, content, "utf8");
  else if (readFileSync(path, "utf8").replaceAll("\r\n", "\n") !== content) throw new Error(`N10_REPORT_DRIFT:${path}`);
}

function json(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function record(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("N10_INVALID_OBJECT");
  return value as JsonObject;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("N10_INVALID_ARRAY");
  return value;
}
