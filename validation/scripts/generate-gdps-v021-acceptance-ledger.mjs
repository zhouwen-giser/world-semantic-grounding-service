import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const matrixPath = resolve(root, "acceptance", "gdps-v0.2.1", "acceptance-matrix.csv");
const evidenceMapPath = resolve(root, "reports", "wsgs-v0.2-gdps-v0.2.1", "acceptance-evidence-map.json");
const outputPath = resolve(root, "reports", "wsgs-v0.2-gdps-v0.2.1", "acceptance-ledger.json");
const write = process.argv.includes("--write");
const statuses = new Set(["PASS", "FAIL", "NOT_RUN", "BLOCKED"]);

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function csvRows(text) {
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
  if (quoted) throw new Error("GDPS acceptance CSV has an unterminated quote");
  if (field || row.length) { row.push(field.replace(/\r$/u, "")); rows.push(row); }
  const [header, ...body] = rows.filter((entry) => entry.some((value) => value !== ""));
  if (!header) throw new Error("GDPS acceptance CSV is empty");
  return body.map((values) => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""])));
}

const matrixBytes = readFileSync(matrixPath);
const matrix = csvRows(matrixBytes.toString("utf8"));
if (matrix.length !== 327 || new Set(matrix.map((entry) => entry.id)).size !== 327) {
  throw new Error(`GDPS acceptance inventory invalid: ${matrix.length}`);
}
if (matrix.some((entry) => entry.required !== "yes")) throw new Error("GDPS acceptance contains a non-required row");

const evidenceMap = existsSync(evidenceMapPath)
  ? JSON.parse(readFileSync(evidenceMapPath, "utf8"))
  : { schemaVersion: "wsgs-gdps-acceptance-evidence-map/1.0", entries: [] };
if (evidenceMap.schemaVersion !== "wsgs-gdps-acceptance-evidence-map/1.0" || !Array.isArray(evidenceMap.entries)) {
  throw new Error("GDPS acceptance evidence map is invalid");
}
const evidenceById = new Map();
for (const entry of evidenceMap.entries) {
  if (!matrix.some((candidate) => candidate.id === entry.acceptanceId) || evidenceById.has(entry.acceptanceId) ||
      !statuses.has(entry.status) || !Array.isArray(entry.evidence) || entry.evidence.length === 0) {
    throw new Error(`GDPS acceptance evidence entry invalid: ${entry.acceptanceId ?? "UNKNOWN"}`);
  }
  evidenceById.set(entry.acceptanceId, entry);
}

const cases = matrix.map((row) => {
  const mapped = evidenceById.get(row.id);
  return {
    acceptanceId: row.id,
    phase: row.phase,
    area: row.area,
    scenario: row.scenario,
    expected: row.expected,
    evidenceTypes: row.evidence.split("/").filter(Boolean),
    status: mapped?.status ?? "NOT_RUN",
    evidence: mapped?.evidence ?? [],
    ...(mapped?.reason ? { reason: mapped.reason } : {})
  };
});
const counts = Object.fromEntries([...statuses].map((status) =>
  [status, cases.filter((entry) => entry.status === status).length]));
const complete = counts.PASS === 327 && counts.FAIL === 0 && counts.NOT_RUN === 0 && counts.BLOCKED === 0;
const body = {
  schemaVersion: "wsgs-gdps-required-acceptance-ledger/1.0",
  matrix: { path: "acceptance/gdps-v0.2.1/acceptance-matrix.csv", sha256: sha256(matrixBytes) },
  evidenceMap: {
    path: "reports/wsgs-v0.2-gdps-v0.2.1/acceptance-evidence-map.json",
    present: existsSync(evidenceMapPath),
    mappedCases: evidenceById.size
  },
  requiredCases: 327,
  counts,
  complete,
  cases
};
const content = `${JSON.stringify(body, null, 2)}\n`;
if (write) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, "utf8");
} else if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== content) {
  throw new Error("GDPS v0.2.1 acceptance ledger is stale; run gdps:v021:acceptance:write");
}
console.log(complete
  ? "WSGS_GDPS_V021_ACCEPTANCE_PASS required=327 pass=327"
  : `WSGS_GDPS_V021_ACCEPTANCE_BLOCKED pass=${counts.PASS} fail=${counts.FAIL} blocked=${counts.BLOCKED} notRun=${counts.NOT_RUN}`);
