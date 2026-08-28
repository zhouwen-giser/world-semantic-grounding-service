import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const matrixPath = resolve(root, "acceptance", "development-required.csv");
const groupsPath = resolve(root, "reports", "wsgs-v0.2", "development-acceptance-evidence-groups.json");
const outputPath = resolve(root, "reports", "wsgs-v0.2", "development-acceptance-ledger.json");
const statuses = ["PASS", "FAIL", "NOT_RUN", "BLOCKED"];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field.replace(/\r$/u, "")); rows.push(row); row = []; field = ""; }
    else field += character;
  }
  if (quoted) throw new Error("Development acceptance CSV has an unterminated quoted field");
  if (field || row.length) { row.push(field.replace(/\r$/u, "")); rows.push(row); }
  const [header, ...values] = rows;
  if (!header) throw new Error("Development acceptance CSV is empty");
  return values.filter((entry) => entry.some(Boolean)).map((entry) => Object.fromEntries(
    header.map((name, index) => [name, entry[index] ?? ""])
  ));
}

function expandId(value) {
  const range = /^(DEV-[A-Z])(\d{3})\.\.(DEV-[A-Z])(\d{3})$/u.exec(value);
  if (!range) return [value];
  if (range[1] !== range[3]) throw new Error(`Development range crosses prefixes: ${value}`);
  const start = Number(range[2]);
  const end = Number(range[4]);
  if (end < start) throw new Error(`Development range is reversed: ${value}`);
  return Array.from({ length: end - start + 1 }, (_unused, offset) =>
    `${range[1]}${String(start + offset).padStart(3, "0")}`
  );
}

const matrix = parseCsv(readFileSync(matrixPath, "utf8"));
if (matrix.length !== 63 || matrix.some((entry) => entry.required !== "yes")) {
  throw new Error(`Development matrix must contain exactly 63 required rows; received ${matrix.length}`);
}
const matrixById = new Map(matrix.map((entry) => [entry.id, entry]));
if (matrixById.size !== matrix.length) throw new Error("Development matrix contains duplicate IDs");
const source = JSON.parse(readFileSync(groupsPath, "utf8"));
if (source.schemaVersion !== "1.0" || !Array.isArray(source.groups)) {
  throw new Error("Development evidence groups must declare schemaVersion 1.0");
}
const evidenceById = new Map();
for (const [groupIndex, group] of source.groups.entries()) {
  if (!group || typeof group !== "object" || !statuses.includes(group.status)) {
    throw new Error(`Development evidence group ${groupIndex} has an invalid status`);
  }
  if (!Array.isArray(group.ids) || group.ids.length === 0 || !Array.isArray(group.evidence) || group.evidence.length === 0) {
    throw new Error(`Development evidence group ${groupIndex} is incomplete`);
  }
  for (const id of group.ids.flatMap(expandId)) {
    if (!matrixById.has(id)) throw new Error(`Development evidence group ${groupIndex} has unknown ID ${id}`);
    if (evidenceById.has(id)) throw new Error(`Development ID ${id} occurs in multiple groups`);
    evidenceById.set(id, {
      status: group.status,
      evidence: [...new Set(group.evidence)].sort(),
      ...(typeof group.note === "string" && group.note.trim() ? { note: group.note.trim() } : {})
    });
  }
}
const missing = matrix.map((entry) => entry.id).filter((id) => !evidenceById.has(id));
if (missing.length) throw new Error(`Development evidence is incomplete: ${missing.join("|")}`);
const cases = matrix.map((entry) => ({
  id: entry.id,
  area: entry.area,
  scenario: entry.scenario,
  expected: entry.expected,
  testType: entry.test_type,
  ...evidenceById.get(entry.id)
}));
const summary = Object.fromEntries(statuses.map((status) => [
  status,
  cases.filter((entry) => entry.status === status).length
]));
const decision = summary.FAIL + summary.NOT_RUN + summary.BLOCKED === 0 ? "DEVELOPMENT_READY" : "BLOCKED";
const ledger = {
  schemaVersion: "1.0",
  profile: "REQUIRED_DEVELOPMENT",
  generatedFrom: [
    "acceptance/development-required.csv",
    "reports/wsgs-v0.2/development-acceptance-evidence-groups.json"
  ],
  required: cases.length,
  decision,
  productionQualified: false,
  summary,
  cases
};
const value = `${JSON.stringify(ledger, null, 2)}\n`;
if (process.argv.includes("--write")) writeFileSync(outputPath, value);
else if (readFileSync(outputPath, "utf8") !== value) {
  throw new Error("Development acceptance ledger is stale; run with --write");
}
const digest = createHash("sha256").update(value).digest("hex");
console.log(
  `WSGS_V02_DEVELOPMENT_${decision} required=${cases.length} pass=${summary.PASS} fail=${summary.FAIL} ` +
  `not_run=${summary.NOT_RUN} blocked=${summary.BLOCKED} sha256=${digest}`
);
