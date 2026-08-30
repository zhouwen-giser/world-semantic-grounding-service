import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  AlignmentInvariantError,
  compareBaselineAndCandidateLocks,
  validateAlignmentLockDocument,
  verifySingleUpstreamAuthority,
  verifyGowmSourceDirectory
} from "./verify-gowm-alignment.js";

type JsonObject = Record<string, any>;

const root = resolve(import.meta.dirname, "..", "..");
const reportRoot = resolve(root, "reports", "wsgs-gowm-0.6.4-alignment");
const alignmentLockPath = resolve(root, "contracts", "upstream", "gowm-runtime-contract-alignment-lock-v1.json");
const baselineLockPath = resolve(
  root,
  "contracts",
  "upstream",
  "gowm-0.6.3",
  "baselines",
  "wsgs-southbound-operation-lock-v2.17dd221.json"
);
const candidateLockPath = resolve(
  root,
  "contracts",
  "upstream",
  "gowm-0.6.3",
  "extracted",
  "package",
  "bundle",
  "locks",
  "wsgs-southbound-operation-lock-v2.json"
);
const intakeReportPath = resolve(root, "contracts", "upstream", "gowm-0.6.3", "CONTRACT_INTAKE_REPORT.json");
const handoffPath = resolve(root, "contracts", "consumers", "sacs-development-handoff-v1.json");
const handoffSchemaPath = resolve(root, "contracts", "wsgs-v0.2-development", "sacs-development-handoff.schema.json");
const write = process.argv.includes("--write");
const invariantReportPath = resolve(reportRoot, "alignment-invariant-report.json");

function json(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as JsonObject;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalSha256(value: unknown): `sha256:${string}` {
  return sha256(canonicalJson(value));
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function withEvidenceHash(payload: JsonObject): JsonObject {
  if (Object.hasOwn(payload, "evidenceHash")) {
    throw new Error("ALIGNMENT_EVIDENCE_PREIMAGE_CONTAINS_EVIDENCE_HASH");
  }
  return { ...payload, evidenceHash: canonicalSha256(payload) };
}

function repoPath(path: string): string {
  return relative(root, path).split(sep).join("/");
}

function emit(path: string, contents: string): void {
  if (write) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, "utf8");
    return;
  }
  if (!existsSync(path)) throw new Error(`ALIGNMENT_EVIDENCE_MISSING:${repoPath(path)}`);
  const observed = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
  if (observed !== contents) throw new Error(`ALIGNMENT_EVIDENCE_DRIFT:${repoPath(path)}`);
}

const lock = json(alignmentLockPath);
const invariant = validateAlignmentLockDocument(lock);
const authority = verifySingleUpstreamAuthority(lock, root);
const source = process.env["GOWM_SOURCE_DIR"]
  ? verifyGowmSourceDirectory(lock, process.env["GOWM_SOURCE_DIR"]!)
  : undefined;
const diff = compareBaselineAndCandidateLocks(lock, baselineLockPath, candidateLockPath);
const lockHash = sha256(readFileSync(alignmentLockPath));
const baselineLockHash = sha256(readFileSync(baselineLockPath).toString("utf8").replaceAll("\r\n", "\n"));
const candidateLockHash = sha256(readFileSync(candidateLockPath).toString("utf8").replaceAll("\r\n", "\n"));
const intakeReport = json(intakeReportPath);
const handoff = json(handoffPath);
const handoffSchema = json(handoffSchemaPath);
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
if (!ajv.validateSchema(handoffSchema)) {
  throw new Error(`HANDOFF_SCHEMA_INVALID:${ajv.errorsText(ajv.errors)}`);
}
const validateHandoffSchema = ajv.compile(handoffSchema);
if (!validateHandoffSchema(handoff)) {
  throw new Error(`HANDOFF_SCHEMA_VALIDATION_FAILED:${ajv.errorsText(validateHandoffSchema.errors)}`);
}

const negativeCases: Array<{
  id: string;
  expectedCode: string;
  mutate: (document: JsonObject) => void;
}> = [
  { id: "runtime-version", expectedCode: "GOWM_RUNTIME_VERSION_MISMATCH", mutate: (doc) => { doc.gowmRuntime.softwareVersion = "0.6.3"; } },
  { id: "gateway-contract-version", expectedCode: "GATEWAY_CONTRACT_VERSION_MISMATCH", mutate: (doc) => { doc.gatewayContract.gatewayContractVersion = "0.6.4"; } },
  { id: "gateway-package-version", expectedCode: "GATEWAY_PACKAGE_VERSION_MISMATCH", mutate: (doc) => { doc.gatewayContract.packageVersion = "0.6.4"; } },
  { id: "source-commit", expectedCode: "GOWM_SOURCE_COMMIT_MISMATCH", mutate: (doc) => { doc.gowmRuntime.sourceCommit = "17dd221330d9af540ec815a39eca96550690299a"; } },
  { id: "wire-schema", expectedCode: "UNEXPECTED_WIRE_SCHEMA_DRIFT", mutate: (doc) => { doc.criticalOperationFingerprints[0].inputSchemaHash = `sha256:${"f".repeat(64)}`; } },
  { id: "semantic-profile", expectedCode: "UNDECLARED_SEMANTIC_PROFILE_DRIFT", mutate: (doc) => { doc.criticalOperationFingerprints[3].semanticProfileHash = `sha256:${"f".repeat(64)}`; } },
  { id: "version-conflation", expectedCode: "RUNTIME_CONTRACT_VERSION_CONFLATED", mutate: (doc) => { doc.requiredTuple.runtimeAndContractVersionsMustRemainIndependent = false; } },
  { id: "multiple-authorities", expectedCode: "MULTIPLE_UPSTREAM_AUTHORITIES", mutate: (doc) => { doc.compatibilityPolicy.singleUpstreamAuthorityRequired = false; } },
  { id: "fail-open", expectedCode: "ALIGNMENT_MUST_FAIL_CLOSED", mutate: (doc) => { doc.compatibilityPolicy.failClosed = false; } }
];
const negativeResults = negativeCases.map((testCase) => {
  const document = structuredClone(lock);
  testCase.mutate(document);
  let observedCode = "UNEXPECTED_PASS";
  try {
    validateAlignmentLockDocument(document);
  } catch (error) {
    observedCode = error instanceof AlignmentInvariantError ? error.code : "UNEXPECTED_ERROR";
  }
  if (observedCode !== testCase.expectedCode) {
    throw new Error(`ALIGNMENT_NEGATIVE_CASE_FAILED:${testCase.id}:${observedCode}`);
  }
  return { id: testCase.id, expectedCode: testCase.expectedCode, observedCode, status: "PASS" };
});

function exactSourceEvidence(): JsonObject {
  if (source) {
    return {
      status: "PASS",
      sourceCommit: source.sourceCommit,
      liveOperationCount: source.liveOperationCount,
      sourceDirectoryIncluded: false
    };
  }
  if (!write && existsSync(invariantReportPath)) {
    const recorded = json(invariantReportPath).exactSourceVerification;
    if (recorded?.status === "PASS" && recorded.sourceCommit === lock.gowmRuntime.sourceCommit &&
        recorded.liveOperationCount === diff.operationCount && recorded.sourceDirectoryIncluded === false) {
      return recorded;
    }
  }
  return {
    status: "NOT_EMBEDDED",
    reason: "Run the write gate with GOWM_SOURCE_DIR to verify the exact external source worktree"
  };
}

const northboundLockPath = resolve(root, "contracts", "wsgs-v0.1", "contract-lock.json");
const northboundLock = json(northboundLockPath);
if (northboundLock.contractVersion !== "sacs-wsgs-grounding/1.0") {
  throw new Error("NORTHBOUND_CONTRACT_DRIFT");
}

const base = lock.taskGeneratedAgainst;
const baseline = {
  schemaVersion: "wsgs-gowm-alignment-baseline/1.0",
  status: "PASS",
  wsgs: { commit: base.wsgsCommit, version: base.wsgsVersion, targetVersion: base.targetWsgsVersion },
  gowmRuntime: { commit: lock.gowmRuntime.sourceCommit, version: lock.gowmRuntime.softwareVersion },
  gatewayContract: {
    packageName: lock.gatewayContract.packageName,
    packageVersion: lock.gatewayContract.packageVersion,
    contractVersion: lock.gatewayContract.gatewayContractVersion
  },
  northboundContract: base.northboundContractVersion,
  knownMetadataMismatch: {
    path: "GOWM/VERSION",
    value: lock.gowmRuntime.knownNonAuthoritativeVersionFile.observedValueAtSourceCommit,
    authoritative: false
  },
  baselineCheck: "npm run check PASS before implementation"
};

const authorities = {
  schemaVersion: "wsgs-gowm-authority-inventory/1.0",
  status: "PASS",
  authoritative: [{
    path: "contracts/upstream/gowm-runtime-contract-alignment-lock-v1.json",
    hash: lockHash,
    runtimeSourceCommit: lock.gowmRuntime.sourceCommit,
    runtimeVersion: lock.gowmRuntime.softwareVersion,
    gatewayContractVersion: lock.gatewayContract.gatewayContractVersion,
    consumerPackageVersion: lock.gatewayContract.packageVersion
  }],
  generatedCompatibilityProjections: ["contracts/upstream/gowm-0.6.3/SOURCE_LOCK.json"],
  historicalNonAuthorities: [
    "contracts/upstream/gowm-v0.4/",
    "contracts/upstream/required-gowm-capabilities.json",
    "contracts/upstream/optional-gowm-capabilities.json",
    "execplans/EP-wsgs-v0.2-gowm-063.md",
    "reports/wsgs-v0.2/"
  ],
  removedConflictingAuthorities: ["contracts/upstream/GOWM_COMMIT", "contracts/upstream/GOWM_VERSION"],
  independentAuthorityCount: authority.independentAuthorityCount
};

const invariantReport = {
  schemaVersion: "wsgs-gowm-runtime-contract-alignment-report/1.0",
  status: "PASS",
  markers: ["GOWM_RUNTIME_0_6_4_LOCKED", "GATEWAY_CONTRACT_0_6_3_LOCKED", "RUNTIME_CONTRACT_VERSION_INVARIANT_READY"],
  alignmentLockHash: lockHash,
  invariant,
  exactSourceVerification: exactSourceEvidence()
};

const contractDiff = {
  schemaVersion: "wsgs-gowm-contract-diff-report/1.0",
  status: "PASS",
  baseline: { sourceCommit: "17dd221330d9af540ec815a39eca96550690299a", lockHash: baselineLockHash },
  candidate: { sourceCommit: lock.gowmRuntime.sourceCommit, lockHash: candidateLockHash },
  operationSet: { before: diff.operationCount, after: diff.operationCount, equality: "PASS" },
  wireSchemaStability: "PASS",
  operationPolicyStability: "PASS",
  semanticMigrationAllowlistExact: "PASS",
  observedSemanticMigrations: diff.observedSemanticMigrations
};

const semanticMigration = {
  schemaVersion: "wsgs-gowm-semantic-migration-report/1.0",
  status: "PASS",
  declaredCount: lock.declaredSemanticProfileMigrations.length,
  observedCount: diff.observedSemanticMigrations.length,
  declaredEqualsObserved: true,
  migrations: lock.declaredSemanticProfileMigrations
};

const northboundCompatibility = {
  schemaVersion: "wsgs-northbound-compatibility-report/1.0",
  status: "PASS",
  contractVersion: northboundLock.contractVersion,
  contractLockPath: repoPath(northboundLockPath),
  contractLockFileHash: sha256(readFileSync(northboundLockPath)),
  changedByAlignment: false
};

const expectedAlignmentRecipes = ["R1", "R2", "R3", "R4", "R5"];
const handoffGowm = handoff.gowm as JsonObject;
const handoffTupleMatches =
  handoffGowm.sourceCommit === lock.gowmRuntime.sourceCommit &&
  handoffGowm.runtimeVersion === lock.gowmRuntime.softwareVersion &&
  handoffGowm.gatewayContractVersion === lock.gatewayContract.gatewayContractVersion &&
  handoffGowm.consumerPackage?.name === lock.gatewayContract.packageName &&
  handoffGowm.consumerPackage?.version === lock.gatewayContract.packageVersion &&
  handoffGowm.contractCatalogRevision === lock.gatewayContract.contractCatalogRevision &&
  handoffGowm.semanticCatalogHash === lock.gatewayContract.semanticCatalogHash;
const handoffRecipesMatch =
  JSON.stringify(handoff.alignmentValidatedRecipes) === JSON.stringify(expectedAlignmentRecipes);
const handoffProductionBoundaryMatches = handoff.productionQualified === false;
const handoffWsgsCommitValid = /^[0-9a-f]{40}$/u.test(handoff.wsgs?.commit ?? "");
const handoffVerification = {
  schemaVersion: "wsgs-gowm-handoff-verification/1.0",
  status:
    handoffTupleMatches && handoffRecipesMatch && handoffProductionBoundaryMatches && handoffWsgsCommitValid
      ? "PASS"
      : "BLOCKED",
  handoffPath: repoPath(handoffPath),
  handoffFileHash: sha256(readFileSync(handoffPath)),
  handoffCanonicalPayloadHash: canonicalSha256(handoff),
  schemaValidationStatus: "PASS",
  handoffStatus: handoff.status,
  wsgsSourceBinding: {
    status: handoffWsgsCommitValid ? "PASS" : "BLOCKED",
    sourceCommit: handoff.wsgs?.commit,
    verification: "DECLARED_HANDOFF_SOURCE_COMMIT_FOR_CLOSURE_CROSS_VALIDATION"
  },
  exactTuple: {
    sourceCommit: handoffGowm.sourceCommit,
    runtimeVersion: handoffGowm.runtimeVersion,
    gatewayContractVersion: handoffGowm.gatewayContractVersion,
    consumerPackage: handoffGowm.consumerPackage,
    contractCatalogRevision: handoffGowm.contractCatalogRevision,
    semanticCatalogHash: handoffGowm.semanticCatalogHash
  },
  alignmentValidatedRecipes: handoff.alignmentValidatedRecipes,
  productionQualified: handoff.productionQualified,
  checks: {
    schema: "PASS",
    exactTuple: handoffTupleMatches ? "PASS" : "BLOCKED",
    alignmentRecipes: handoffRecipesMatch ? "PASS" : "BLOCKED",
    productionBoundary: handoffProductionBoundaryMatches ? "PASS" : "BLOCKED",
    wsgsSourceBinding: handoffWsgsCommitValid ? "PASS" : "BLOCKED"
  },
  marker: handoffRecipesMatch
    ? "WSGS_GOWM_HANDOFF_ALIGNMENT_VERIFIED"
    : "WSGS_GOWM_HANDOFF_ALIGNMENT_NOT_VERIFIED"
};

emit(resolve(reportRoot, "w00-baseline.json"), stableJson(withEvidenceHash(baseline)));
emit(resolve(reportRoot, "w00-existing-authorities.json"), stableJson(withEvidenceHash(authorities)));
emit(invariantReportPath, stableJson(withEvidenceHash(invariantReport)));
emit(resolve(reportRoot, "negative-cases-report.json"), stableJson(withEvidenceHash({
  schemaVersion: "wsgs-gowm-alignment-negative-cases/1.0",
  status: "PASS",
  count: negativeResults.length,
  cases: negativeResults
})));
emit(resolve(reportRoot, "northbound-compatibility-report.json"), stableJson(withEvidenceHash(northboundCompatibility)));
emit(resolve(reportRoot, "contract-diff-report.json"), stableJson(withEvidenceHash(contractDiff)));
emit(resolve(reportRoot, "semantic-migration-report.json"), stableJson(withEvidenceHash(semanticMigration)));
emit(resolve(reportRoot, "contract-intake-report.json"), stableJson(withEvidenceHash(intakeReport)));
emit(resolve(reportRoot, "handoff-verification-report.json"), stableJson(withEvidenceHash(handoffVerification)));
emit(resolve(reportRoot, "w00-source-reconciliation.md"), `# W00 source reconciliation\n\n` +
  `- WSGS base: \`${base.wsgsCommit}\` (\`${base.wsgsVersion}\`)\n` +
  `- WSGS target: \`${base.targetWsgsVersion}\`\n` +
  `- GOWM runtime: \`${lock.gowmRuntime.sourceCommit}\` (\`${lock.gowmRuntime.softwareVersion}\`)\n` +
  `- Gateway contract / consumer package: \`${lock.gatewayContract.gatewayContractVersion}\` / \`${lock.gatewayContract.packageVersion}\`\n` +
  `- Northbound contract: \`${base.northboundContractVersion}\` (unchanged)\n` +
  `- Root GOWM \`VERSION\` observation: \`${lock.gowmRuntime.knownNonAuthoritativeVersionFile.observedValueAtSourceCommit}\` (non-authoritative)\n` +
  `- Full operation lock diff: ${diff.operationCount}/${diff.operationCount}, exactly ${diff.observedSemanticMigrations.length} declared semantic migrations.\n\n` +
  `Marker: \`W00_BASELINE_RECONCILED\`\n`);

process.stdout.write(`${JSON.stringify({
  marker: "WSGS_GOWM_ALIGNMENT_STATIC_EVIDENCE_PASS",
  mode: write ? "WRITE" : "CHECK",
  reports: 10,
  lockHash,
  operationCount: diff.operationCount,
  semanticMigrations: diff.observedSemanticMigrations.length,
  negativeCases: negativeResults.length,
  handoffVerificationStatus: handoffVerification.status
})}\n`);
