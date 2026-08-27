import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const matrixPath = resolve(root, "acceptance", "acceptance-matrix.csv");
const groupsPath = resolve(root, "reports", "wsgs-v0.2", "acceptance-evidence-groups.json");
const outputPath = resolve(root, "reports", "wsgs-v0.2", "required-acceptance-ledger.json");
const terminalStatuses = ["PASS", "FAIL", "NOT_RUN", "BLOCKED"];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("Acceptance matrix has an unterminated quoted field");
  if (field || row.length) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  const [header, ...values] = rows;
  if (!header) throw new Error("Acceptance matrix is empty");
  return values.filter((entry) => entry.some(Boolean)).map((entry) => Object.fromEntries(
    header.map((name, index) => [name, entry[index] ?? ""])
  ));
}

function expandId(value) {
  const range = /^(AC-[A-Z])(\d{3})\.\.(AC-[A-Z])(\d{3})$/u.exec(value);
  if (!range) return [value];
  if (range[1] !== range[3]) throw new Error(`Acceptance range crosses prefixes: ${value}`);
  const start = Number(range[2]);
  const end = Number(range[4]);
  if (end < start) throw new Error(`Acceptance range is reversed: ${value}`);
  return Array.from({ length: end - start + 1 }, (_unused, offset) =>
    `${range[1]}${String(start + offset).padStart(3, "0")}`
  );
}

const matrix = parseCsv(readFileSync(matrixPath, "utf8"));
const requiredCases = matrix.filter((entry) => entry.required === "yes");
const matrixById = new Map(requiredCases.map((entry) => [entry.id, entry]));
if (matrixById.size !== requiredCases.length) throw new Error("Acceptance matrix contains duplicate Required IDs");

const source = JSON.parse(readFileSync(groupsPath, "utf8"));
if (source.version !== "0.2.0" || !Array.isArray(source.groups)) {
  throw new Error("Acceptance evidence groups must declare version 0.2.0 and a groups array");
}

const evidenceById = new Map();
for (const [groupIndex, group] of source.groups.entries()) {
  if (!group || typeof group !== "object" || !terminalStatuses.includes(group.status)) {
    throw new Error(`Evidence group ${groupIndex} has an invalid terminal status`);
  }
  if (!Array.isArray(group.ids) || group.ids.length === 0) {
    throw new Error(`Evidence group ${groupIndex} has no IDs`);
  }
  if (!Array.isArray(group.evidence) || group.evidence.length === 0 ||
      group.evidence.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`Evidence group ${groupIndex} must contain non-empty evidence references`);
  }
  for (const id of group.ids.flatMap(expandId)) {
    if (!matrixById.has(id)) throw new Error(`Evidence group ${groupIndex} contains unknown ID ${id}`);
    if (evidenceById.has(id)) throw new Error(`Acceptance ID ${id} occurs in multiple evidence groups`);
    evidenceById.set(id, {
      status: group.status,
      evidence: [...new Set(group.evidence)].sort(),
      ...(typeof group.note === "string" && group.note.trim() ? { note: group.note.trim() } : {})
    });
  }
}

const missing = requiredCases.map((entry) => entry.id).filter((id) => !evidenceById.has(id));
if (missing.length) throw new Error(`Required acceptance evidence is incomplete: ${missing.join("|")}`);

const cases = requiredCases.map((entry) => ({
  id: entry.id,
  area: entry.area,
  scenario: entry.scenario,
  expected: entry.expected,
  testType: entry.test_type,
  ...evidenceById.get(entry.id)
}));
const summary = Object.fromEntries(terminalStatuses.map((status) => [
  status,
  cases.filter((entry) => entry.status === status).length
]));
const ledger = {
  version: "0.2.0",
  generatedFrom: [
    "acceptance/acceptance-matrix.csv",
    "reports/wsgs-v0.2/acceptance-evidence-groups.json"
  ],
  required: cases.length,
  decision: summary.FAIL + summary.NOT_RUN + summary.BLOCKED === 0 ? "PASS" : "BLOCKED",
  summary,
  cases
};
const value = `${JSON.stringify(ledger, null, 2)}\n`;
if (process.argv.includes("--write")) {
  writeFileSync(outputPath, value);
} else if (readFileSync(outputPath, "utf8") !== value) {
  throw new Error("WSGS v0.2 acceptance ledger is stale; run with --write");
}
console.log(
  `WSGS_V02_ACCEPTANCE_LEDGER_${ledger.decision} required=${cases.length} pass=${summary.PASS} ` +
  `fail=${summary.FAIL} not_run=${summary.NOT_RUN} blocked=${summary.BLOCKED}`
);
