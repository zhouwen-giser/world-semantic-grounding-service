import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const matrixPath = resolve(root, "acceptance", "gdps-v0.2.1", "acceptance-matrix.csv");
const evidenceMapPath = resolve(root, "reports", "wsgs-v0.2-gdps-v0.2.1", "acceptance-evidence-map.json");
const policyPath = resolve(root, "config", "gdps-v021-acceptance-policy.json");
const outputPath = resolve(root, "reports", "wsgs-v0.2-gdps-v0.2.1", "acceptance-ledger.json");
const write = process.argv.includes("--write");
const initializeExplicitMap = process.argv.includes("--initialize-explicit-map");
const statuses = new Set(["PASS", "FAIL", "NOT_RUN", "BLOCKED"]);
const shaPattern = /^[0-9a-f]{40}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
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

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function repositoryPath(value, label) {
  invariant(typeof value === "string" && value.length > 0, `${label} path is missing`);
  invariant(!/^[A-Za-z]:[\\/]|^[/\\]{1,2}/u.test(value) && !value.split(/[\\/]/u).includes(".."),
    `${label} must be repository-relative: ${value}`);
  const absolute = resolve(root, value);
  const repositoryRelative = relative(root, absolute).replaceAll("\\", "/");
  invariant(repositoryRelative !== "" && !repositoryRelative.startsWith("../"),
    `${label} escapes the repository: ${value}`);
  invariant(existsSync(absolute) && statSync(absolute).isFile(), `${label} does not exist: ${value}`);
  return { absolute, repositoryRelative };
}

function sameTarget(actual, expected) {
  return actual?.release === expected.release && actual?.providerId === expected.providerId &&
    actual?.providerVersion === expected.providerVersion && actual?.capabilityCount === expected.capabilityCount &&
    actual?.productTypeCount === expected.productTypeCount &&
    actual?.descriptorProfileCount === expected.descriptorProfileCount;
}

function collectNamedValues(value, names, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectNamedValues(item, names, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, item] of Object.entries(value)) {
    if (names.has(key)) output.push({ key, value: item });
    collectNamedValues(item, names, output);
  }
  return output;
}

function validatePositiveJsonIdentity(document, policy, artifactPath) {
  const named = collectNamedValues(document,
    new Set(["providerVersion", "capabilityCount", "operationCount", "sourceCommit", "candidateSha", "gitHead"]));
  for (const item of named) {
    if (item.key === "providerVersion" && policy.legacyEvidence.forbiddenProviderVersions.includes(item.value)) {
      throw new Error(`legacy provider version cannot support PASS: ${artifactPath} value=${item.value}`);
    }
    if ((item.key === "capabilityCount" || item.key === "operationCount") &&
        policy.legacyEvidence.forbiddenCapabilityCounts.includes(item.value)) {
      throw new Error(`legacy capability count cannot support PASS: ${artifactPath} value=${item.value}`);
    }
    if ((item.key === "sourceCommit" || item.key === "candidateSha" || item.key === "gitHead") &&
        policy.legacyEvidence.forbiddenSourceShas.includes(item.value)) {
      throw new Error(`legacy source SHA cannot support PASS: ${artifactPath} value=${item.value}`);
    }
  }
}

function validateEvidence(evidence, entry, row, policy, candidateSha) {
  invariant(evidence && typeof evidence === "object" && !Array.isArray(evidence),
    `GDPS acceptance evidence must be typed: ${entry.acceptanceId}`);
  invariant(policy.allowedEvidenceTypes.includes(evidence.type),
    `GDPS acceptance evidence type is invalid: ${entry.acceptanceId} type=${evidence.type ?? "UNKNOWN"}`);
  invariant(row.evidenceTypes.includes(evidence.type),
    `GDPS acceptance evidence type is not allowed by matrix: ${entry.acceptanceId} type=${evidence.type}`);
  invariant(evidence.candidateSha === candidateSha,
    `GDPS acceptance evidence candidate SHA mismatch: ${entry.acceptanceId}`);
  invariant(typeof evidence.assertionId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(evidence.assertionId),
    `GDPS acceptance evidence assertionId is invalid: ${entry.acceptanceId}`);
  invariant(evidence.polarity === "POSITIVE" || evidence.polarity === "NEGATIVE",
    `GDPS acceptance evidence polarity is invalid: ${entry.acceptanceId}`);
  invariant(sameTarget(evidence.target, policy.target),
    `GDPS acceptance evidence target identity mismatch: ${entry.acceptanceId}`);
  const artifact = repositoryPath(evidence.artifact, `GDPS acceptance evidence ${entry.acceptanceId}`);
  invariant(digestPattern.test(evidence.sha256), `GDPS acceptance evidence digest is invalid: ${entry.acceptanceId}`);
  invariant(sha256(readFileSync(artifact.absolute)) === evidence.sha256,
    `GDPS acceptance evidence digest drift: ${entry.acceptanceId} artifact=${artifact.repositoryRelative}`);
  if (entry.status === "PASS" && evidence.polarity === "POSITIVE") {
    invariant(!policy.legacyEvidence.forbiddenReportPrefixes.some((prefix) =>
      artifact.repositoryRelative === prefix || artifact.repositoryRelative.startsWith(`${prefix}/`)),
    `legacy report location cannot support PASS: ${entry.acceptanceId} artifact=${artifact.repositoryRelative}`);
    if (artifact.repositoryRelative.endsWith(".json")) {
      validatePositiveJsonIdentity(readJson(artifact.absolute, artifact.repositoryRelative), policy,
        artifact.repositoryRelative);
    }
  }
  if (evidence.polarity === "NEGATIVE") {
    invariant(policy.negativeAcceptanceIds.includes(entry.acceptanceId),
      `negative evidence is not authorized for acceptance row: ${entry.acceptanceId}`);
  }
  return { ...evidence, artifact: artifact.repositoryRelative };
}

function validatePolicy(policy, matrixEvidenceTypes) {
  invariant(policy?.schemaVersion === "wsgs-gdps-v021-acceptance-policy/1.0",
    "GDPS v0.2.1 acceptance policy is invalid");
  invariant(sameTarget(policy.target, {
    release: "GDPS v0.2.1",
    providerId: "gdps.geospatial-products",
    providerVersion: "0.2.1",
    capabilityCount: 30,
    productTypeCount: 34,
    descriptorProfileCount: 35
  }), "GDPS v0.2.1 acceptance target identity is invalid");
  invariant(Array.isArray(policy.allowedEvidenceTypes) &&
    matrixEvidenceTypes.every((type) => policy.allowedEvidenceTypes.includes(type)),
  "GDPS v0.2.1 acceptance policy omits a matrix evidence type");
  invariant(Array.isArray(policy.negativeAcceptanceIds) && policy.negativeAcceptanceIds.includes("W33-020"),
    "GDPS v0.2.1 acceptance policy must authorize W33-020 negative evidence");
  invariant(Array.isArray(policy.legacyEvidence?.forbiddenReportPrefixes) &&
    Array.isArray(policy.legacyEvidence?.forbiddenProviderVersions) &&
    policy.legacyEvidence.forbiddenProviderVersions.includes("0.1.0") &&
    Array.isArray(policy.legacyEvidence?.forbiddenCapabilityCounts) &&
    policy.legacyEvidence.forbiddenCapabilityCounts.includes(23) &&
    Array.isArray(policy.legacyEvidence?.forbiddenSourceShas) &&
    policy.legacyEvidence.forbiddenSourceShas.every((sha) => shaPattern.test(sha)),
  "GDPS v0.2.1 legacy evidence rejection policy is invalid");
}

const matrixBytes = readFileSync(matrixPath);
const normalizedMatrixBytes = Buffer.from(matrixBytes.toString("utf8").replaceAll("\r\n", "\n"), "utf8");
const matrix = csvRows(normalizedMatrixBytes.toString("utf8")).map((row) => ({
  ...row,
  evidenceTypes: row.evidence.split("/").filter(Boolean)
}));
if (matrix.length !== 327 || new Set(matrix.map((entry) => entry.id)).size !== 327) {
  throw new Error(`GDPS acceptance inventory invalid: ${matrix.length}`);
}
if (matrix.some((entry) => entry.required !== "yes")) throw new Error("GDPS acceptance contains a non-required row");

const policy = readJson(policyPath, "GDPS v0.2.1 acceptance policy");
validatePolicy(policy, [...new Set(matrix.flatMap((row) => row.evidenceTypes))]);
const actualCandidateSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
invariant(shaPattern.test(actualCandidateSha), "WSGS candidate SHA is invalid");

invariant(existsSync(evidenceMapPath), "GDPS acceptance evidence map is missing");
let evidenceMap = readJson(evidenceMapPath, "GDPS acceptance evidence map");
if (initializeExplicitMap) {
  invariant(evidenceMap.schemaVersion === "wsgs-gdps-acceptance-evidence-map/2.0" &&
    Array.isArray(evidenceMap.entries), "Only a v2 evidence map can be initialized");
  const existing = new Map(evidenceMap.entries.map((entry) => [entry.acceptanceId, entry]));
  evidenceMap = {
    ...evidenceMap,
    entries: matrix.map((row) => existing.get(row.id) ?? {
      acceptanceId: row.id,
      status: "NOT_RUN",
      evidence: []
    })
  };
  writeFileSync(evidenceMapPath, `${JSON.stringify(evidenceMap, null, 2)}\n`, "utf8");
  console.log(`WSGS_GDPS_V021_EVIDENCE_MAP_INITIALIZED entries=${evidenceMap.entries.length}`);
}

invariant(evidenceMap.schemaVersion === "wsgs-gdps-acceptance-evidence-map/2.0" &&
  Array.isArray(evidenceMap.entries), "GDPS acceptance evidence map is invalid");
invariant(evidenceMap.candidate?.repository === "world-semantic-grounding-service" &&
  shaPattern.test(evidenceMap.candidate?.gitHead ?? ""),
"GDPS acceptance evidence map candidate identity is invalid");
if (evidenceMap.candidate.gitHead !== actualCandidateSha) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", evidenceMap.candidate.gitHead, actualCandidateSha], {
      cwd: root, stdio: "ignore"
    });
  } catch {
    throw new Error("GDPS acceptance evidence candidate is not an ancestor of current HEAD");
  }
  const changedAfterCandidate = execFileSync(
    "git", ["diff", "--name-only", `${evidenceMap.candidate.gitHead}..${actualCandidateSha}`],
    { cwd: root, encoding: "utf8" }
  ).trim().split(/\r?\n/u).filter(Boolean).map((path) => path.replaceAll("\\", "/"));
  invariant(changedAfterCandidate.length > 0 && changedAfterCandidate.every((path) =>
    path.startsWith("reports/wsgs-v0.2-gdps-v0.2.1/") ||
      path === "validation/scripts/generate-gdps-v021-acceptance-ledger.mjs"),
  "GDPS acceptance evidence candidate is stale relative to implementation changes");
}
invariant(sameTarget(evidenceMap.target, policy.target), "GDPS acceptance evidence map target identity mismatch");
invariant(evidenceMap.overall?.status === "BLOCKED" && Array.isArray(evidenceMap.overall.blockers) &&
  evidenceMap.overall.blockers.length > 0,
"GDPS v0.2.1 candidate must remain explicitly BLOCKED while handoff/runtime gates are unresolved");
invariant(evidenceMap.entries.length === matrix.length,
  `GDPS acceptance evidence map must explicitly map all 327 rows: mapped=${evidenceMap.entries.length}`);

const matrixById = new Map(matrix.map((row) => [row.id, row]));
const evidenceById = new Map();
for (const entry of evidenceMap.entries) {
  const row = matrixById.get(entry.acceptanceId);
  invariant(row && !evidenceById.has(entry.acceptanceId),
    `GDPS acceptance evidence entry ID is invalid or duplicated: ${entry.acceptanceId ?? "UNKNOWN"}`);
  invariant(statuses.has(entry.status) && Array.isArray(entry.evidence),
    `GDPS acceptance evidence entry is invalid: ${entry.acceptanceId}`);
  if (entry.status === "PASS" || entry.status === "FAIL") {
    invariant(entry.evidence.length > 0, `GDPS acceptance ${entry.status} has no evidence: ${entry.acceptanceId}`);
  }
  if (entry.status === "NOT_RUN") {
    invariant(entry.evidence.length === 0, `GDPS acceptance NOT_RUN cannot carry result evidence: ${entry.acceptanceId}`);
  }
  const validatedEvidence = entry.evidence.map((evidence) =>
    validateEvidence(evidence, entry, row, policy, actualCandidateSha));
  if (entry.status === "PASS") {
    const actualTypes = new Set(validatedEvidence.map((evidence) => evidence.type));
    invariant(row.evidenceTypes.every((type) => actualTypes.has(type)),
      `GDPS acceptance PASS lacks required evidence types: ${entry.acceptanceId}`);
  }
  evidenceById.set(entry.acceptanceId, { ...entry, evidence: validatedEvidence });
}
invariant(evidenceById.size === matrix.length && matrix.every((row) => evidenceById.has(row.id)),
  "GDPS acceptance evidence map inventory differs from the 327-row matrix");

const cases = matrix.map((row) => {
  const mapped = evidenceById.get(row.id);
  return {
    acceptanceId: row.id,
    phase: row.phase,
    area: row.area,
    scenario: row.scenario,
    expected: row.expected,
    evidenceTypes: row.evidenceTypes,
    status: mapped.status,
    evidence: mapped.evidence,
    ...(mapped.reason ? { reason: mapped.reason } : {})
  };
});
const counts = Object.fromEntries([...statuses].map((status) =>
  [status, cases.filter((entry) => entry.status === status).length]));
const complete = evidenceMap.overall.status === "PASS" && counts.PASS === 327 && counts.FAIL === 0 &&
  counts.NOT_RUN === 0 && counts.BLOCKED === 0;
const body = {
  schemaVersion: "wsgs-gdps-required-acceptance-ledger/2.0",
  candidate: {
    repository: evidenceMap.candidate.repository,
    evidenceGitHead: evidenceMap.candidate.gitHead
  },
  target: policy.target,
  candidateStatus: evidenceMap.overall,
  matrix: { path: "acceptance/gdps-v0.2.1/acceptance-matrix.csv", sha256: sha256(normalizedMatrixBytes) },
  evidenceMap: {
    path: "reports/wsgs-v0.2-gdps-v0.2.1/acceptance-evidence-map.json",
    schemaVersion: evidenceMap.schemaVersion,
    explicitlyMappedCases: evidenceById.size
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
  : `WSGS_GDPS_V021_ACCEPTANCE_BLOCKED pass=${counts.PASS} fail=${counts.FAIL} blocked=${counts.BLOCKED} notRun=${counts.NOT_RUN} candidateStatus=${evidenceMap.overall.status}`);
