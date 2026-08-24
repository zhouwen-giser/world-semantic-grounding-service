import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const matrixPath = resolve(root, "acceptance", "required-acceptance-matrix.csv");
const statePath = resolve(root, "reports", "wsgs-v0.1", "sync-state.json");
const outputPath = resolve(root, "reports", "wsgs-v0.1", "required-acceptance-ledger.json");
const matrixIds = readFileSync(matrixPath, "utf8").trim().split(/\r?\n/u).slice(1).map((line) => line.split(",", 1)[0]);
const state = JSON.parse(readFileSync(statePath, "utf8"));
const categories = [
  ["passed", "PASS"],
  ["failed", "FAIL"],
  ["notRun", "NOT_RUN"],
  ["blocked", "BLOCKED"]
];
const statusById = new Map();
for (const [category, status] of categories) {
  for (const id of state.acceptance[category] ?? []) {
    if (statusById.has(id)) throw new Error(`Acceptance ID ${id} occurs in multiple terminal categories`);
    statusById.set(id, status);
  }
}
if ((state.acceptance.deferred ?? []).length > 0) throw new Error("Final acceptance ledger cannot contain deferred cases");
const missing = matrixIds.filter((id) => !statusById.has(id));
const extra = [...statusById.keys()].filter((id) => !matrixIds.includes(id));
if (missing.length || extra.length) throw new Error(`Acceptance coverage mismatch missing=${missing.join("|")} extra=${extra.join("|")}`);
const cases = matrixIds.map((id) => ({ id, status: statusById.get(id) }));
const summary = Object.fromEntries(["PASS", "FAIL", "NOT_RUN", "BLOCKED"].map((status) => [
  status,
  cases.filter((entry) => entry.status === status).length
]));
const value = `${JSON.stringify({
  version: "0.1.0",
  generatedFrom: "acceptance/required-acceptance-matrix.csv plus reports/wsgs-v0.1/sync-state.json",
  required: cases.length,
  summary,
  cases
}, null, 2)}\n`;
if (process.argv.includes("--write")) writeFileSync(outputPath, value);
else if (readFileSync(outputPath, "utf8") !== value) throw new Error("Required acceptance ledger is stale; run with --write");
console.log(`WSGS_ACCEPTANCE_LEDGER_PASS required=${cases.length} pass=${summary.PASS} not_run=${summary.NOT_RUN} blocked=${summary.BLOCKED}`);
