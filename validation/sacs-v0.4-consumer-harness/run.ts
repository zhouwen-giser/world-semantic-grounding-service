import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

type JsonObject = Record<string, unknown>;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sacsRoot = resolve(repositoryRoot, "..", "..", "single-agent-chat-server", ".tmp", "worktrees", "v04-closure");
const write = process.argv.includes("--write");
const reportRoot = join(repositoryRoot, "reports", "sacs-geospatial-v1");
const sourceLock = json(join(repositoryRoot, "contracts", "handoff-source-locks", "wsgs-sacs-geospatial-v1.json"));
const expectedSacsHead = String(record(sourceLock["sacs"])["consumerHeadSha"]);
const actualSacsHead = git(["rev-parse", "HEAD"]);
const sacsStatus = git(["status", "--porcelain"]);
if (actualSacsHead !== expectedSacsHead) throw new Error("N09_SACS_HEAD_MISMATCH");
if (sacsStatus !== "") throw new Error("N09_SACS_SOURCE_DIRTY");

const packageDocument = json(join(sacsRoot, "package.json"));
const lock = json(join(repositoryRoot, "handoff", "sacs-geospatial-v1", "WSGS_SACS_GEOSPATIAL_CONSUMER_LOCK.json"));
const checksums = json(join(repositoryRoot, "handoff", "sacs-geospatial-v1", "CHECKSUMS.json"));
const consumer = await import(pathToFileURL(join(sacsRoot, "packages", "wsgs-geospatial-consumer", "src", "index.ts")).href);
const adapter = await import(pathToFileURL(join(sacsRoot, "packages", "wsgs-http-adapter", "src", "index.ts")).href);

const parsedLock = consumer.parseWsgsGeospatialConsumerLock(lock) as JsonObject;
const fixtureResult = json(join(repositoryRoot, "contracts", "wsgs-v0.2.1-sacs-geospatial", "examples", "grounding-result-with-geospatial-findings.json"));
adapter.parseWsgsGroundingResult(fixtureResult);
consumer.parseWsgsGeospatialFindings(fixtureResult["geospatialFindings"]);

const projectedReady = structuredClone(lock) as JsonObject;
delete projectedReady["blocker"];
projectedReady["status"] = "READY";
record(projectedReady["geospatialProfile"])["transportMode"] = "RESULT_EXTENSION";
projectedReady["currentness"] = { mode: "DEDICATED_OPERATION", operation: "VALIDATE_SOURCE_CURRENTNESS" };
projectedReady["consumerLockHash"] = consumer.calculateConsumerLockHash(projectedReady);
consumer.parseWsgsGeospatialConsumerLock(projectedReady);

const findings = record(fixtureResult["geospatialFindings"]);
const negativeCases = [
  negative("WSGS_SHA_MISMATCH", () => {
    const candidate = structuredClone(projectedReady);
    record(candidate["sources"])["wsgsSha"] = "0".repeat(40);
    candidate["consumerLockHash"] = consumer.calculateConsumerLockHash(candidate);
    consumer.parseWsgsGeospatialConsumerLock(candidate);
  }, false, "The current consumer has no runtime WSGS SHA binding assertion."),
  negative("GOWM_SHA_MISMATCH", () => consumer.assertWsgsCapabilitiesAgainstConsumerLock({
    contractVersion: String(record(projectedReady["groundingContract"])["contractVersion"]),
    supportedProducts: [],
    requiredCapabilitiesReady: true,
    gowmContract: { commit: "0".repeat(40) }
  }, projectedReady), true),
  negative("RESULT_SCHEMA_HASH_MISMATCH", () => {
    const candidate = structuredClone(projectedReady);
    record(candidate["groundingContract"])["resultSchemaHash"] = `sha256:${"0".repeat(64)}`;
    candidate["consumerLockHash"] = consumer.calculateConsumerLockHash(candidate);
    consumer.parseWsgsGeospatialConsumerLock(candidate);
    adapter.parseWsgsGroundingResult(fixtureResult);
  }, false, "The current adapter parses the result shape but does not bind it to resultSchemaHash."),
  negative("PROFILE_HASH_MISMATCH", () => consumer.assertWsgsGeospatialFindingsAuthorized({
    ...findings,
    profileSchemaHash: `sha256:${"0".repeat(64)}`
  }, projectedReady), true),
  negative("UNKNOWN_FINDING", () => consumer.parseWsgsGeospatialFindings({
    ...findings,
    findings: [{ findingKind: "UNKNOWN" }]
  }), true),
  {
    id: "STALE_SOURCE",
    status: "PASS_FAIL_CLOSED",
    evidence: "SACS focused currentness suite passed 9/9 at the locked head."
  },
  {
    id: "FOREIGN_SCOPE_SELECTION",
    status: "PASS_FAIL_CLOSED",
    evidence: "SACS focused structured-selection suites passed 11/11 with 3 PostgreSQL cases skipped."
  }
];

const blockers = [
  "AUTHORITATIVE_HANDOFF_NOT_READY",
  "REAL_WSGS_RESULT_NOT_AVAILABLE",
  "SACS_RUNTIME_WSGS_SHA_BINDING_MISSING",
  "SACS_RESULT_SCHEMA_HASH_BINDING_MISSING",
  "SACS_AUTHORITATIVE_8_PLUS_CHECKSUMS_INTAKE_NOT_IMPLEMENTED"
];
const intakeReport = {
  schemaVersion: "wsgs-v021-n09-sacs-intake/1.0",
  phase: "N09",
  status: "BLOCKED",
  sacsHeadSha: actualSacsHead,
  packageManager: packageDocument["packageManager"],
  nodeVersion: process.version,
  handoffBundleHash: checksums["bundleHash"],
  inventoryCount: checksums["inventoryCount"],
  consumerLockParsedByActualSacsSource: true,
  handoffStatus: parsedLock["status"],
  authoritativeReadyIntake: false,
  realRuntimeResultParsed: false,
  blockers
};
const contractReport = {
  schemaVersion: "wsgs-v021-n09-sacs-consumer-contract/1.0",
  phase: "N09",
  status: "PARTIAL",
  exactConsumerHead: actualSacsHead,
  authoritativeBlockedLockAccepted: true,
  projectedReadyLockShapeAccepted: true,
  fixtureGroundingResultParsed: true,
  fixtureGeospatialFindingsParsed: true,
  fixtureIsRuntimeEvidence: false,
  focusedTests: [
    { command: "pnpm test:v04:s14", passed: 23, skipped: 0 },
    { command: "pnpm test:closure:v04:selection", passed: 11, skipped: 3 },
    { command: "pnpm test:v04:s22", passed: 9, skipped: 0 }
  ],
  sacsSourceModified: false
};
const negativeReport = {
  schemaVersion: "wsgs-v021-n09-sacs-negative-cases/1.0",
  phase: "N09",
  status: negativeCases.every((item) => item.status === "PASS_FAIL_CLOSED") ? "PASS" : "BLOCKED",
  cases: negativeCases
};
const phaseReport = [
  "# N09 SACS v0.4 consumer compatibility",
  "",
  "Status: BLOCKED",
  "",
  `- Exact SACS consumer head: ${actualSacsHead}`,
  `- Handoff bundle: ${String(checksums["bundleHash"])}`,
  "- Actual SACS consumer source accepts the authoritative BLOCKED lock and the projected READY shape.",
  "- The checked-in fixture parses through both SACS parsers, but it is not real runtime evidence.",
  "- WSGS SHA and result-schema-hash runtime bindings remain fail-open in the locked SACS consumer.",
  "- No SACS source was modified; no Docker or shared runtime was used.",
  "",
  "Completion marker WSGS_SACS_V04_CONSUMER_COMPATIBLE is withheld."
].join("\n") + "\n";

emit("N09-sacs-intake.json", `${JSON.stringify(intakeReport, null, 2)}\n`);
emit("N09-sacs-consumer-contract.json", `${JSON.stringify(contractReport, null, 2)}\n`);
emit("N09-sacs-negative-cases.json", `${JSON.stringify(negativeReport, null, 2)}\n`);
emit("N09-phase-report.md", phaseReport);
console.log(`WSGS_SACS_V04_CONSUMER_BLOCKED handoff=${String(checksums["bundleHash"])}`);

function negative(id: string, action: () => void, shouldThrow: boolean, evidence?: string) {
  let threw = false;
  try { action(); } catch { threw = true; }
  return {
    id,
    status: threw === shouldThrow && shouldThrow ? "PASS_FAIL_CLOSED" : "BLOCKED_FAIL_OPEN",
    ...(evidence === undefined ? {} : { evidence })
  };
}

function emit(name: string, content: string): void {
  const path = join(reportRoot, name);
  if (write) writeFileSync(path, content, "utf8");
  else if (readFileSync(path, "utf8").replaceAll("\r\n", "\n") !== content) throw new Error(`N09_REPORT_DRIFT:${name}`);
}

function git(args: string[]): string {
  return execFileSync("git", ["-C", sacsRoot, ...args], { encoding: "utf8" }).trim();
}

function json(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function record(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("N09_INVALID_OBJECT");
  return value as JsonObject;
}
