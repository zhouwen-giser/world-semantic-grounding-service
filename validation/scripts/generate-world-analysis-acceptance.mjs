import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const reports = "reports/wsgs-v0.2.4-stable-world-analysis-service";
const read = path => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const digest = path => `sha256:${createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex")}`;
const requirements = read("WSGS_v0.2.4_Stable_World_Analysis_Codex_Goal/acceptance/required-requirements.json").requirements;
const phaseFiles = {
  W00: ["W00/baseline.json", "W00/baseline.md", "W00/baseline-check.json", "W00/baseline-check.log", "W00/legacy-contract-hashes.json"],
  W01: ["W01/contract-freeze.json", "W01/contract-validation.json", "W01/contract-validation.log"],
  W02: ["W02/normalization-report.json", "W02/normalization-tests.json", "W02/normalization-tests.log", "W02/hash-vectors.json"],
  W03: ["W03/closure-review.json", "W03/closure-tests.json", "W03/closure-tests.log", "W03/migration-notes.md"],
  W04: ["W06/complete-cross-tests.json", "W06/complete-cross-tests.log", "W06/complete-cross-http.json", "W06/complete-cross-http.log"],
  W05: ["W06/complete-cross-check.json", "W06/complete-cross-check.log", "W06/complete-cross-http.json", "W06/complete-cross-http.log"],
  W06: ["W06/complete-cross-check.json", "W06/complete-cross-check.log", "W06/complete-cross-tests.json", "W06/complete-cross-tests.log",
    "W06/complete-cross-http.json", "W06/complete-cross-http.log", "W06/complete-cross-build.json", "W06/complete-cross-build.log",
    "W06/metric-rounds-contract.json", "W06/metric-rounds-contract.log", "W06/metric-rounds-fixture.json", "W06/metric-rounds-fixture.log",
    "W06/complete-cross-summary.json"],
  W07: []
};
const sources = {
  W00: ["execplans/EP-wsgs-v0.2.4-stable-world-analysis-service.md"],
  W01: ["contracts/wsgs-v0.2.4-world-analysis/contract-release-lock.json", "contracts/wsgs-v0.2.4-world-analysis/validator.mjs", "contracts/wsgs-v0.2.4-world-analysis/examples/manifest.json"],
  W02: ["packages/historical-trace-consumer/src/public-world-analysis.ts", "packages/historical-trace-consumer/src/public-world-analysis.test.ts"],
  W03: ["tests/world-analysis-http.test.ts", "tests/world-analysis-business-http.test.ts", "services/grounding-worker/src/postgres-contract-recovery.test.ts"],
  W04: ["packages/prior-grounding/src/analysis-selection.test.ts", "packages/historical-trace-consumer/src/public-world-analysis.test.ts",
    "packages/historical-trace-consumer/src/advanced-historical.test.ts", "services/grounding-worker/src/prior-analysis-authority.test.ts", "tests/world-analysis-business-http.test.ts",
    "contracts/wsgs-v0.2.4-world-analysis/examples/action-requirements.json"],
  W05: ["services/grounding-worker/src/world-analysis-capabilities.test.ts", "services/grounding-api/src/production-capabilities.test.ts",
    "tests/world-analysis-discovery-http.test.ts", "tests/world-analysis-business-http.test.ts", "packages/query-compiler/src/gdps.test.ts",
    "packages/gowm-execution-evidence/src/gdps.test.ts", "docs/world-analysis-capabilities.md", ".env.example"],
  W06: ["tests/world-analysis-http.test.ts", "tests/world-analysis-discovery-http.test.ts", "tests/world-analysis-business-http.test.ts", "tests/world-analysis-http-support.ts", "docs/world-analysis-http-development.md"],
  W07: []
};

// These notes are the reviewed requirement-to-proof mapping, not inferred test counts.
const notes = [
  "WSGS-only implementation scope and read-only upstream intake are recorded in the baseline; no deployment/control operation was performed.",
  "Fetched main/T5 commits and ancestry are recorded; the implementation branch contains both without repeated merging.",
  "Main recovery/idempotency/deadline fixes remain covered by the current production adapter and worker regressions.",
  "Historical foundation and T5 GSAP compiler/executor/intake are in the same branch and reused by actual HTTP cases.",
  "Dedicated codex branch preserves the original workspace; no reset, clean, force push or merge operation was used.",
  "Baseline call-path inventory and current HTTP fixtures identify API, backend, actual stages, worker, settlement and GET.",
  "The 68-artifact legacy manifest records raw SHA-256 separately from Git objects; current check compares bytes.",
  "Baseline command records include actual exit codes, logs, skipped tests and dependency limitations.",
  "Execplan fixes repository/version boundaries; v0.2.4 is a work item, not a release or image-tag change.",
  "The frozen release precedes W02 runtime commits; the explicitly withdrawn candidate is retained separately.",
  "Frozen schemas define five findings, five bounded choices and finite gaps; unknown/raw payload examples fail.",
  "Offline validation loads the complete request/result/job/capabilities/schema closure; OpenAPI and generated types are frozen artifacts.",
  "Current full check verifies every one of the 68 previously frozen legacy/geospatial artifact byte hashes.",
  "Exact independent 1.2 principal/header negotiation, old versions and coexistence examples are validated.",
  "Choice candidate IDs are distinct from ReferenceProducts; prior anchors and all cross-references have semantic validation.",
  "Status/gap codes, pending projection, explicit uncertainty, range bounds, CRS and two-coordinate points are validated.",
  "Canonical vectors, frozen limits and stable code-unit ordering are checked; hashes exclude their own fields.",
  "Release lock/checksums, generated types and mirrored runtime schema documents pass drift checks.",
  "AnalysisProviderContracts validates locked full envelopes before projection; changed hashes and malformed source payloads fail closed.",
  "Golden projection cases cover all five public finding kinds without exposing internal HISTORICAL safePayload.",
  "Projection tests preserve periods, gaps, exclusions and finalization and reject conflicted or multiple executions.",
  "Road fixtures retain reference-model role, off-network and ambiguous segments, and incomplete association suffix.",
  "Event tests retain uncertainty and proof; actual complete/incomplete CROSS HTTP binds the full T2 source and hash.",
  "MAX/MIN fixtures and negative values preserve metric series, median ranking basis and representative measurement separately.",
  "Dangling reference/evidence and fake ReferenceKey cases fail; actual historical HTTP verifies derived interval/trajectory closure.",
  "Small-budget tests retain selected source closure and legal geometry, or return a bounded gap/error rather than fabricate completeness.",
  "Golden hashes and repeat projection are stable; semantic representative-position changes alter both public hashes.",
  ...read(`${reports}/W03/closure-review.json`).requirements.map(row => row.proof),
  "Public selection schema is independent of selectedProductIds; real two/three-round HTTP uses empty selectedProductIds for derived candidates.",
  "Stored-result resolver rejects client coordinate/rank/summary/name fields; production authority reads scoped stored bytes and AES checkpoints.",
  "Selection tests cover identity/scope/TTL/hash/ownership and corrupted private checkpoints; actual HTTP rejects bad candidate/hash/expiry.",
  "Ordinal inference requires a unique choice and rejects text/structured rank conflict; combined ambiguous roles do not silently resolve.",
  "Metric/phase/execution/catalog changes invalidate reuse in component tests; series selection actually reissues T4 over HTTP.",
  "Out-of-range/absent candidates are rejected; incomplete LAST is requeried and display truncation never creates a missing position.",
  "Two/three-round HTTP asserts exact visited point, finding/candidate/rank, measurement/time and full evidence closure.",
  "Public schema and runtime tests require executionAuthorized=false and all three downstream requirements=true.",
  "Ordinary Top-K yields no action; explicit selection does. The frozen positive ugv1 example remains valid as an opaque world/product ID.",
  "Actual capability projection separates supported from available for flags-disabled and fully authorized snapshots.",
  "Component and signed discovery HTTP cover flags, versions/schema hashes, full semantic catalog hash, grants, freshness and availability.",
  "Full capability schema validates bounded public reasons/limits; arbitrary upstream diagnostic strings are sanitized.",
  "Dependency tests independently remove T2/T3/T4/trace and verify only dependent CROSS/action capabilities become unavailable.",
  "Actual T2 failure leaves subsequent ordinary reference/history HTTP usable; full check runs unchanged GDPS planning/compiler/normalizer regressions. This does not claim live GDPS failure testing.",
  "Default opt-in flags and exact signed Gateway execution remain; architecture check prohibits direct provider/database access and global preview bypass.",
  "Only HISTORICAL_METRIC_CANDIDATE action source is advertised; missing discovery cannot advertise execution availability.",
  "Discovery is independent of model readiness and does not introduce a new aggregate production-readiness qualification.",
  "Reviewed .env.example and capability docs describe defaults, independent allowlist, selective preview, shared signing and bounded degradation without secrets.",
  "complete-cross-check.json/log records the complete check command and 954 passing tests with 29 explicit skips; earlier failures remain archived.",
  "complete-cross-tests and complete-cross-build are separate commands and raw logs, not extracted nested results.",
  "Independent metric-rounds-contract and metric-rounds-fixture commands pass offline; the relevant frozen validator and fixture suite are unchanged.",
  "23 actual local HTTP cases use the production backend/stages/worker/projector; only lower-level Gateway/store dependencies are controlled.",
  "Actual synchronous 200 and asynchronous 202->worker->GET preserve contract selection and saved result hash/bytes.",
  "Actual two-round rank/action and three-round series/requery/rank/action restore server-owned public results and private checkpoints.",
  "HTTP covers complete/incomplete CROSS, provider failure, ambiguity/invalid selections, legacy 1.0/1.1, profile conflict, cancel and deadline.",
  "Reports explicitly separate L0/L1 controlled evidence from NOT_RUN live Gateway/PostgreSQL/model/SACS/device scopes.",
  "Listeners use loopback ephemeral ports; afterEach stops workers, closes listeners, restores environment and removes owned temp directories; command logs carry source/diff hashes."
];
const gaps = [
  "Publish the permanent public-only consumer bundle and inspect its manifest/dependency closure.",
  "Run the copied bundle in a fresh isolated Node process and verify full examples plus prior-result/selection linkage.",
  "Run missing dependency, tampered file and wrong-profile rejection against the final isolated bundle.",
  "Verify delivered README/OpenAPI and complete selection/cancel examples in that bundle.",
  "Finalize this 72-row ledger and evidence index after all remaining deliverables have authoritative evidence.",
  "Perform final focused independent review of scope, contracts, authority, ranking, truncation, non-authorization and errors.",
  "Commit and deliver the dedicated Draft PR, or record an evidenced remote restriction without merge/tag/release/deploy.",
  "Generate and check consistent final MD/JSON reports, source identity, limitations and delivery status.",
  "Evaluate the final readiness marker only after every Required row is proven; no early DEV_READY."
];
if (notes.length !== 63 || gaps.length !== 9 || requirements.length !== 72) throw new Error("ACCEPTANCE_MAPPING_INCOMPLETE");
const index = new Map();
function evidence(path) {
  const value = { path, sha256: digest(path) };
  if (path.endsWith(".json")) {
    const record = read(path);
    if (record.command && record.logPath && record.logSha256) {
      if (digest(record.logPath) !== record.logSha256) throw new Error(`COMMAND_LOG_DRIFT:${path}`);
      Object.assign(value, { command: record.command, status: record.status, testedCommit: record.testedCommit });
    }
  }
  index.set(path, value); return value;
}
const acceptance = requirements.map((requirement, i) => ({ ...requirement,
  status: i < notes.length ? "PASS" : "NOT_RUN", note: notes[i] ?? gaps[i - notes.length],
  verificationScope: i < 63 ? "REVIEWED_L0_OR_CONTROLLED_L1_NOT_LIVE_DEPLOYMENT" : "PENDING_DELIVERABLE",
  evidence: [...phaseFiles[requirement.phase].map(path => `${reports}/${path}`), ...sources[requirement.phase]].map(evidence)
}));
const ledger = { schemaVersion: "1.0", scope: "ALL_ORIGINAL_72_REQUIRED_ITEMS", reviewStatus: "BATCH_A_COMPLETE_W07_PENDING",
  summary: { total: 72, pass: 63, notRun: 9, ready: false }, acceptance };
writeFileSync(resolve(root, reports, "acceptance-ledger.json"), JSON.stringify(ledger, null, 2) + "\n");
writeFileSync(resolve(root, reports, "evidence-index.json"), JSON.stringify({ schemaVersion: "1.0", evidence: [...index.values()] }, null, 2) + "\n");
console.log(JSON.stringify(ledger.summary));
