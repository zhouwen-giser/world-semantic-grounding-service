import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const base = "reports/wsgs-v0.2.4-stable-world-analysis-service";
const task = "WSGS_v0.2.4_Stable_World_Analysis_Codex_Goal";
const read = path => JSON.parse(readFileSync(path, "utf8"));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
const digest = path => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const evidence = (path, locator = "Full file; see the associated requirement note.") => ({ path, sha256: digest(path), locator });
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const spec = read(`${task}/PACKAGE_MANIFEST.json`);
const ledger = read(`${base}/acceptance-ledger.json`);
const names = ["final-check", "final-tests", "final-build", "final-contract", "final-fixture", "final-http", "handoff-validation"];
const expected = ["npm run check", "npm test", "npm run build", "npm run verify:world-analysis-contract", "npm run smoke:world-analysis:fixture", "npm run test:world-analysis:http", "npm run verify:world-analysis:handoff"];
const commands = names.map((name, i) => {
  const path = `${base}/W07/${name}.json`, record = read(path);
  assert(record.status === "PASS" && record.exitCode === 0 && record.command === expected[i], `Command not passed: ${name}`);
  assert(digest(record.logPath) === record.logSha256, `Log drift: ${name}`);
  return { ...record, evidence: [evidence(path), evidence(record.logPath)] };
});
const testedCommit = commands[0].testedCommit;
assert(commands.every(command => command.testedCommit === testedCommit), "Mixed tested implementations");
git("merge-base", "--is-ancestor", testedCommit, "HEAD");
const allowedReportChange = path => path.startsWith("reports/") || path.startsWith("execplans/") ||
  ["validation/scripts/generate-world-analysis-acceptance.mjs", "validation/scripts/finalize-world-analysis-report.mjs"].includes(path);
const changed = git("diff", "--name-only", testedCommit).split("\n").filter(Boolean);
assert(changed.every(allowedReportChange), "Implementation changed after final verification");
const prCommand = ["pr", "view", spec.branch, "--json", "number,state,isDraft,headRefName,headRefOid,baseRefName,url"];
const pr = JSON.parse(execFileSync("gh", prCommand, { encoding: "utf8" }));
assert(pr.state === "OPEN" && pr.isDraft && pr.headRefName === spec.branch && pr.baseRefName === "main", "Draft PR state mismatch");
const remote = { status: "DRAFT_PR", branch: spec.branch, commit: pr.headRefOid, draftPrUrl: pr.url,
  observedAt: new Date().toISOString(), command: `gh ${prCommand.join(" ")}`, observation: pr,
  mainCommit: git("rev-parse", "origin/main"), t5Commit: "0db24edf8490766346904c5ab71fd78fbf3afb5d" };
git("merge-base", "--is-ancestor", remote.mainCommit, "HEAD");
git("merge-base", "--is-ancestor", remote.t5Commit, "HEAD");
write(`${base}/W07/remote-delivery.json`, remote);
const limitations = [
  "L0 contracts/unit and L1 actual local HTTP with controlled dependencies only; real Gateway/providers, PostgreSQL, model, SACS and devices are NOT_RUN; production is DEFERRED.",
  "HTTP uses the actual production backend/stage factory/pipeline/worker/projector and AES checkpoints, with a controlled signed Gateway and in-memory SQL adapter. This is not real PostgreSQL recovery or deployed data acceptance.",
  "Twenty-nine skipped tests remain explicitly skipped. Earlier failed timeout attempts are retained in W06; no assertion or request deadline was weakened to claim success.",
  "Historical action candidates never authorize execution; current validation, route planning and explicit execution confirmation remain mandatory.",
  "The standalone consumer verifies artificial complete examples and sample linkage, not live SACS authorization or currentness. Node filesystem isolation is not a network sandbox.",
  "Vendored dependency versions/integrity metadata match package-lock and copied bytes are hashed; registry tarball contents were not independently reverified.",
  "Final source review is a separate pass by the implementing agent, not a second reviewer sign-off. No merge, tag, release, deployment or device action was performed."
];
writeFileSync(`${base}/limitations.md`, "# Limitations\n\n" + limitations.map(value => `- ${value}`).join("\n") + "\n");
const finalizer = "validation/scripts/finalize-world-analysis-report.mjs";
const finalRows = {
  "WA-068": { note: "All 72 original IDs are present exactly once with reviewed evidence; finalizer checks all cited hashes and produces one ledger/index, without a self-referential report hash.", paths: [finalizer, `${task}/acceptance/required-requirements.json`, `${base}/W07/review.md`] },
  "WA-070": { note: "Dedicated branch pushed and OPEN Draft PR observed through gh; main and T5 remain ancestors. No merge/tag/release/deploy.", paths: [`${base}/W07/remote-delivery.json`, `${base}/PR_BODY.md`] },
  "WA-071": { note: "MD/JSON are generated from one verified command/evidence model; exact source, log hashes, skipped tests, controlled dependencies and NOT_RUN limits are preserved. Package report checker is a format/evidence check, not a substitute for execution.", paths: [finalizer, `${base}/limitations.md`, ...names.map(name => `${base}/W07/${name}.json`)] },
  "WA-072": { note: "Readiness is restricted to all 72 Required rows plus seven passed commands, frozen contract, validated handoff and no open blocking code defect. Production/release/strict replay/device claims remain false.", paths: [finalizer, `${base}/W07/review.md`, `${base}/limitations.md`] }
};
for (const row of ledger.acceptance) {
  const final = finalRows[row.id];
  if (final) Object.assign(row, { status: "PASS", note: final.note, verificationScope: "REVIEWED_DEVELOPMENT_DELIVERY_NOT_LIVE_QUALIFICATION", evidence: final.paths.map(path => evidence(path)) });
  else for (const item of row.evidence) assert(digest(item.path) === item.sha256, `Evidence drift: ${row.id}:${item.path}`);
}
const required = read(`${task}/acceptance/required-requirements.json`).requirements;
assert(ledger.acceptance.length === 72 && new Set(ledger.acceptance.map(row => row.id)).size === 72, "Required ID count mismatch");
assert(required.every(item => ledger.acceptance.some(row => row.id === item.id && row.status === "PASS" && row.evidence.length > 0)), "Unproven Required item");
for (const row of ledger.acceptance.filter(row => row.phase === "W06")) row.evidence.push(...commands.flatMap(command => command.evidence));
ledger.summary = { total: 72, pass: 72, notRun: 0, ready: true };
ledger.reviewStatus = "REQUIRED_DEVELOPMENT_COMPLETE";
write(`${base}/acceptance-ledger.json`, ledger);
const index = new Map(ledger.acceptance.flatMap(row => row.evidence).map(item => [item.path, item]));
write(`${base}/evidence-index.json`, { schemaVersion: "1.0", evidence: [...index.values()] });
const report = read(`${task}/templates/FINAL_REPORT.template.json`);
const freeze = read(`${base}/W01/contract-freeze.json`);
Object.assign(report, { status: "DEV_READY", completionMarker: spec.completionMarker,
  source: { mainCommit: remote.mainCommit, featureCommit: git("rev-parse", "HEAD"), testedCommit,
    testedWorkingTreeDirty: commands[0].trackedWorkingTreeDirty, testedDiffSha256: commands[0].trackedDiffSha256,
    postTestChanges: changed, postTestChangeScope: "Reports/execplan/report generators only; each command retains its own dirty-state record." },
  contract: { state: "FROZEN", ...spec.targetContract, freezeCommit: freeze.freezeCommit,
    freezeManifestPath: `${base}/W01/contract-freeze.json`, freezeManifestSha256: digest(`${base}/W01/contract-freeze.json`) },
  commands, acceptance: ledger.acceptance, blockers: [], limitations, remoteDelivery: remote,
  controlledDependencies: ["Signed controlled Gateway HTTP server", "In-memory SQL adapter with actual AES checkpoint serialization", "Controlled model readiness where explicitly identified"],
  handoff: { status: "PASS", manifestPath: "contracts/consumers/sacs-world-analysis-v1/manifest.json",
    manifestSha256: digest("contracts/consumers/sacs-world-analysis-v1/manifest.json") } });
report.verificationLevels.L0_CONTRACT_UNIT = "PASS";
report.verificationLevels.L1_HTTP_DEVELOPMENT_CONTROLLED_DEPENDENCIES = "PASS";
write(`${base}/FINAL_REPORT.json`, report);
const md = `# WSGS v0.2.4 Final Report\n\nStatus: ${report.status}. Required: 72/72 PASS.\n\n${report.completionMarker}\n\n## Source and Delivery\n\n- Tested implementation: ${testedCommit}.\n- Refreshed main: ${remote.mainCommit}. T5: ${remote.t5Commit}.\n- Draft PR: ${remote.draftPrUrl}; observed head: ${remote.commit}. No merge or release.\n- Public contract frozen at ${freeze.freezeCommit}; ${report.contract.contractVersion} / ${report.contract.resultProfile}.\n- Later changes are reports and report generators only. Exact per-command source/dirty state is in the JSON records.\n\n## Verification\n\n${commands.map(c => `- ${c.command}: ${c.status}, exit ${c.exitCode}; [raw log](${resolve(c.logPath)}).`).join("\n")}\n\nFull check and independent tests each passed 954 tests, with 29 explicit skips. HTTP: 23 passed; fixture: 43 passed. Frozen contract: 45 schemas, 44 examples, 836 assertions, 68 unchanged legacy artifacts. Handoff: 20 positive and 24 negative examples, two-round linkage, four damaged-bundle rejections.\n\n## Evidence and Consumer\n\nSee acceptance-ledger.json and evidence-index.json for all Required rows, locators and SHA-256 values. The contract-freeze record is W01/contract-freeze.json; handoff execution and review are W07/handoff-validation.json and W07/review.md.\n\nConsumer: contracts/consumers/sacs-world-analysis-v1/. Run node verify.mjs there using Node 22 or newer. Public README/OpenAPI/SEMANTICS and complete job/selection/cancel examples are included.\n\n## Limitations\n\n${limitations.map(value => `- ${value}`).join("\n")}\n`;
writeFileSync(`${base}/FINAL_REPORT.md`, md);
assert(md.includes(report.source.testedCommit) && md.includes(report.remoteDelivery.draftPrUrl) && report.acceptance.every(row => row.status === "PASS"), "Report consistency failure");
const result = execFileSync(process.execPath, [`${task}/tools/validate-report.mjs`, `${base}/FINAL_REPORT.json`, "--require-ready"], { encoding: "utf8" });
console.log(result.trim());
console.log(JSON.stringify({ status: "PASS", required: 72, report: `${base}/FINAL_REPORT.json`, draftPr: remote.draftPrUrl }));
