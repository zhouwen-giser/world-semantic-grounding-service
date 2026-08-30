#!/usr/bin/env node
// @ts-nocheck
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOCK = resolve(HERE, "..", "..", "contracts", "upstream", "gowm-runtime-contract-alignment-lock-v1.json");
const DEFAULT_BASELINE_LOCK = resolve(
  HERE,
  "..",
  "..",
  "contracts",
  "upstream",
  "gowm-0.6.3",
  "baselines",
  "wsgs-southbound-operation-lock-v2.17dd221.json"
);
const DEFAULT_CANDIDATE_LOCK = resolve(
  HERE,
  "..",
  "..",
  "contracts",
  "upstream",
  "gowm-0.6.3",
  "extracted",
  "package",
  "bundle",
  "locks",
  "wsgs-southbound-operation-lock-v2.json"
);

const EXPECTED = Object.freeze({
  runtimeCommit: "f2894d86eeca121f9cea76c70797ece3b091d51f",
  runtimeVersion: "0.6.4",
  gatewayPackageName: "@gowm/world-gateway-contracts",
  gatewayPackageVersion: "0.6.3",
  gatewayContractVersion: "0.6.3",
  consumerIntegrity: "sha512-KekpsVw943+iWwWcKepSxl408uBqH6oQ/ZzHcsrQrq2EjP+r2zYtljOfFekP6Vksxx1oSbE66rqaHE2rUGv6xw==",
  contractCatalogRevision: "sha256:efd0395dbd05c884c781f964b22147efcb38c4cef91704597706ec4b8332075a",
  semanticCatalogHash: "sha256:418fc328861e846801c6e8109bf6d48b876c7814c650a391b84076f71e588b61",
  availabilityContractHash: "sha256:66d6cfe2679d6bdd0cf6f22cb7153d1f5f4c934ebc286f6bac33ab6bd7eb4036",
  snapshotContractHash: "sha256:350044225667ce00c2850e9a9d7c86762fc2e042793b6a8666c724c763135ca0",
  delegationContractHash: "sha256:6edf49002dc75e6701c9c56b8795539b3512884d31b66f7f12f122abdee9344b",
  southboundLockFileSha256: "sha256:765714690fc2192138f925526cc6bf0215c2481fa234c566756c26b891649686",
  northboundContractVersion: "sacs-wsgs-grounding/1.0"
});

export class AlignmentInvariantError extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "AlignmentInvariantError";
    this.code = code;
  }
}

function fail(code, detail) {
  throw new AlignmentInvariantError(code, detail);
}

function assertEqual(actual, expected, code, label) {
  if (actual !== expected) fail(code, `${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}

function assertTrue(value, code, label) {
  if (value !== true) fail(code, `${label}: expected=true actual=${JSON.stringify(value)}`);
}

function object(value, code, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code, `${label} must be an object`);
  return value;
}

function array(value, code, label) {
  if (!Array.isArray(value)) fail(code, `${label} must be an array`);
  return value;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail("ALIGNMENT_LOCK_UNREADABLE", `${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalLf(bytes, label) {
  const decoded = bytes.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(bytes)) fail("SOURCE_TEXT_NOT_UTF8", label);
  const normalized = decoded.replace(/\r\n/g, "\n");
  if (normalized.includes("\r")) fail("SOURCE_TEXT_NON_CRLF_CARRIAGE_RETURN", label);
  return Buffer.from(normalized, "utf8");
}

function operationKey(op) {
  return `${op.operationId}@${op.operationVersion}`;
}

function mapOperations(lock) {
  const values = [...array(lock.defaultOperations, "GATEWAY_LOCK_INVALID", "defaultOperations"),
    ...array(lock.previewOperations, "GATEWAY_LOCK_INVALID", "previewOperations")];
  const map = new Map();
  for (const raw of values) {
    const op = object(raw, "GATEWAY_LOCK_INVALID", "operation");
    const key = operationKey(op);
    if (map.has(key)) fail("DUPLICATE_OPERATION_LOCK", key);
    map.set(key, op);
  }
  return map;
}

function migrationMap(doc) {
  const map = new Map();
  for (const raw of array(doc.declaredSemanticProfileMigrations, "ALIGNMENT_LOCK_INVALID", "declaredSemanticProfileMigrations")) {
    const item = object(raw, "ALIGNMENT_LOCK_INVALID", "semantic migration");
    map.set(`${item.operationId}@${item.operationVersion}`, item);
  }
  return map;
}

export function validateAlignmentLockDocument(doc) {
  const root = object(doc, "ALIGNMENT_LOCK_INVALID", "root");
  const task = object(root.taskGeneratedAgainst, "ALIGNMENT_LOCK_INVALID", "taskGeneratedAgainst");
  const tuple = object(root.requiredTuple, "ALIGNMENT_LOCK_INVALID", "requiredTuple");
  const runtime = object(root.gowmRuntime, "ALIGNMENT_LOCK_INVALID", "gowmRuntime");
  const contract = object(root.gatewayContract, "ALIGNMENT_LOCK_INVALID", "gatewayContract");
  const policy = object(root.compatibilityPolicy, "ALIGNMENT_LOCK_INVALID", "compatibilityPolicy");

  assertEqual(runtime.sourceCommit, EXPECTED.runtimeCommit, "GOWM_SOURCE_COMMIT_MISMATCH", "gowmRuntime.sourceCommit");
  assertEqual(runtime.softwareVersion, EXPECTED.runtimeVersion, "GOWM_RUNTIME_VERSION_MISMATCH", "gowmRuntime.softwareVersion");
  assertEqual(tuple.gowmRuntimeVersion, EXPECTED.runtimeVersion, "GOWM_RUNTIME_VERSION_MISMATCH", "requiredTuple.gowmRuntimeVersion");
  assertEqual(contract.packageName, EXPECTED.gatewayPackageName, "GATEWAY_PACKAGE_NAME_MISMATCH", "gatewayContract.packageName");
  assertEqual(contract.packageVersion, EXPECTED.gatewayPackageVersion, "GATEWAY_PACKAGE_VERSION_MISMATCH", "gatewayContract.packageVersion");
  assertEqual(tuple.gatewayConsumerPackageVersion, EXPECTED.gatewayPackageVersion, "GATEWAY_PACKAGE_VERSION_MISMATCH", "requiredTuple.gatewayConsumerPackageVersion");
  assertEqual(contract.gatewayContractVersion, EXPECTED.gatewayContractVersion, "GATEWAY_CONTRACT_VERSION_MISMATCH", "gatewayContract.gatewayContractVersion");
  assertEqual(tuple.gatewayContractVersion, EXPECTED.gatewayContractVersion, "GATEWAY_CONTRACT_VERSION_MISMATCH", "requiredTuple.gatewayContractVersion");
  if (runtime.softwareVersion === contract.gatewayContractVersion || tuple.gowmRuntimeVersion === tuple.gatewayContractVersion) {
    fail("RUNTIME_CONTRACT_VERSION_CONFLATED", "runtime 0.6.4 and Gateway contract 0.6.3 must remain distinct");
  }
  assertTrue(tuple.runtimeAndContractVersionsMustRemainIndependent, "RUNTIME_CONTRACT_VERSION_CONFLATED", "requiredTuple.runtimeAndContractVersionsMustRemainIndependent");
  assertTrue(tuple.runtimeVersionMustNotBeCopiedIntoContractVersion, "RUNTIME_CONTRACT_VERSION_CONFLATED", "requiredTuple.runtimeVersionMustNotBeCopiedIntoContractVersion");
  assertTrue(policy.runtimeVersionMustNotDetermineGatewayContractVersion, "RUNTIME_CONTRACT_VERSION_CONFLATED", "compatibilityPolicy.runtimeVersionMustNotDetermineGatewayContractVersion");
  assertTrue(policy.singleUpstreamAuthorityRequired, "MULTIPLE_UPSTREAM_AUTHORITIES", "compatibilityPolicy.singleUpstreamAuthorityRequired");
  assertTrue(policy.failClosed, "ALIGNMENT_MUST_FAIL_CLOSED", "compatibilityPolicy.failClosed");
  assertTrue(policy.failClosedOnUnexpectedWireDrift, "ALIGNMENT_MUST_FAIL_CLOSED", "compatibilityPolicy.failClosedOnUnexpectedWireDrift");
  assertEqual(task.northboundContractVersion, EXPECTED.northboundContractVersion, "NORTHBOUND_CONTRACT_DRIFT", "northboundContractVersion");
  assertEqual(contract.consumerLogicalIntegrity, EXPECTED.consumerIntegrity, "CONSUMER_INTEGRITY_MISMATCH", "consumerLogicalIntegrity");
  assertEqual(contract.contractCatalogRevision, EXPECTED.contractCatalogRevision, "CONTRACT_CATALOG_REVISION_MISMATCH", "contractCatalogRevision");
  assertEqual(contract.semanticCatalogHash, EXPECTED.semanticCatalogHash, "SEMANTIC_CATALOG_REVISION_MISMATCH", "semanticCatalogHash");
  assertEqual(contract.availabilityContractHash, EXPECTED.availabilityContractHash, "AVAILABILITY_CONTRACT_HASH_MISMATCH", "availabilityContractHash");
  assertEqual(contract.snapshotContractHash, EXPECTED.snapshotContractHash, "SNAPSHOT_CONTRACT_HASH_MISMATCH", "snapshotContractHash");
  assertEqual(contract.delegationContractHash, EXPECTED.delegationContractHash, "DELEGATION_CONTRACT_HASH_MISMATCH", "delegationContractHash");
  assertEqual(contract.southboundLockFileSha256, EXPECTED.southboundLockFileSha256, "SOUTHBOUND_LOCK_FILE_HASH_MISMATCH", "southboundLockFileSha256");

  const migrations = migrationMap(root);
  for (const raw of array(root.criticalOperationFingerprints, "ALIGNMENT_LOCK_INVALID", "criticalOperationFingerprints")) {
    const op = object(raw, "ALIGNMENT_LOCK_INVALID", "critical operation fingerprint");
    const key = operationKey(op);
    const expectedOp = CRITICAL_OPERATION_BY_KEY.get(key);
    if (!expectedOp) fail("UNEXPECTED_CRITICAL_OPERATION", key);
    for (const field of ["operationId", "operationVersion", "inputSchemaHash", "outputSchemaHash", "maturity", "snapshotSupport"]) {
      if (op[field] !== expectedOp[field]) {
        const code = field === "inputSchemaHash" || field === "outputSchemaHash" || field === "operationVersion"
          ? "UNEXPECTED_WIRE_SCHEMA_DRIFT" : "UNEXPECTED_OPERATION_POLICY_DRIFT";
        fail(code, `${key}.${field}: expected=${expectedOp[field]} actual=${op[field]}`);
      }
    }
    if (JSON.stringify(op.requiredPermissions) !== JSON.stringify(expectedOp.requiredPermissions)) {
      fail("UNEXPECTED_OPERATION_POLICY_DRIFT", `${key}.requiredPermissions`);
    }
    if (op.semanticProfileHash !== expectedOp.semanticProfileHash) {
      const migration = migrations.get(key);
      if (!migration || migration.toSemanticProfileHash !== op.semanticProfileHash) {
        fail("UNDECLARED_SEMANTIC_PROFILE_DRIFT", `${key}: actual=${op.semanticProfileHash}`);
      }
    }
  }
  if (root.criticalOperationFingerprints.length !== CRITICAL_OPERATION_BY_KEY.size) {
    fail("CRITICAL_OPERATION_SET_MISMATCH", `expected=${CRITICAL_OPERATION_BY_KEY.size} actual=${root.criticalOperationFingerprints.length}`);
  }

  return {
    status: "PASS",
    invariant: "GOWM_RUNTIME_0_6_4__GATEWAY_CONTRACT_0_6_3",
    runtimeCommit: runtime.sourceCommit,
    runtimeVersion: runtime.softwareVersion,
    gatewayPackage: `${contract.packageName}@${contract.packageVersion}`,
    gatewayContractVersion: contract.gatewayContractVersion,
    criticalOperationCount: root.criticalOperationFingerprints.length,
    declaredSemanticMigrationCount: root.declaredSemanticProfileMigrations.length
  };
}

const CRITICAL_OPERATION_BY_KEY = new Map([
  ["reference.resolve@1.0", {operationId:"reference.resolve",operationVersion:"1.0",inputSchemaHash:"sha256:90f4610871c7077358e9ce09bbf139194bf10feebc5eacd448fec0bd81817329",outputSchemaHash:"sha256:5e0779610b6e8f0ec12c2d47cbfa99d23a2e92f503eaabf06969b732fa21cb41",semanticProfileHash:"sha256:2345427b162f36cc0792116f20cd337f1e95e0e8284b000ab556b876c45328ad",maturity:"STABLE",requiredPermissions:["data:read"],snapshotSupport:"CONSISTENT_AT_START"}],
  ["reference.validate@1.0", {operationId:"reference.validate",operationVersion:"1.0",inputSchemaHash:"sha256:02b86151775176b13aa80fc0a8c595621941ab6ca5b6ba777c78d300ec59fc4b",outputSchemaHash:"sha256:e5f544f8d40c72dc1dc8039c4f5c83ed94b5d16624e05a68d47c65207941c75c",semanticProfileHash:"sha256:a79f3acf2cb9a825b367a63da65b63ed0f59746f0847ae30f9fb173082be79fc",maturity:"STABLE",requiredPermissions:["data:read"],snapshotSupport:"CONSISTENT_AT_START"}],
  ["world.get-current-state@1.0", {operationId:"world.get-current-state",operationVersion:"1.0",inputSchemaHash:"sha256:dbfccaff85081bcc161d9e83c4e8959f6ecc35c3c726e01ce83547925dcc7772",outputSchemaHash:"sha256:56a451b6f9c62e15cb6dfb67821f907124551d96410be1f0cd8626284e46abf9",semanticProfileHash:"sha256:d41323fdb7bb22db3100e45a3024b978e9325504ab865c5b08852a3caf91a12a",maturity:"STABLE",requiredPermissions:["data:read"],snapshotSupport:"CONSISTENT_AT_START"}],
  ["world.get-geometry@1.0", {operationId:"world.get-geometry",operationVersion:"1.0",inputSchemaHash:"sha256:dbfccaff85081bcc161d9e83c4e8959f6ecc35c3c726e01ce83547925dcc7772",outputSchemaHash:"sha256:56a451b6f9c62e15cb6dfb67821f907124551d96410be1f0cd8626284e46abf9",semanticProfileHash:"sha256:cc8df371406aff181616832bf4b6824e30d2cbc50186164b21c1a55e61680d11",maturity:"STABLE",requiredPermissions:["data:read"],snapshotSupport:"CONSISTENT_AT_START"}],
  ["world.get-provenance@1.0", {operationId:"world.get-provenance",operationVersion:"1.0",inputSchemaHash:"sha256:dbfccaff85081bcc161d9e83c4e8959f6ecc35c3c726e01ce83547925dcc7772",outputSchemaHash:"sha256:56a451b6f9c62e15cb6dfb67821f907124551d96410be1f0cd8626284e46abf9",semanticProfileHash:"sha256:d41323fdb7bb22db3100e45a3024b978e9325504ab865c5b08852a3caf91a12a",maturity:"STABLE",requiredPermissions:["data:read"],snapshotSupport:"CONSISTENT_AT_START"}],
  ["spatial.find-in-area@1.0", {operationId:"spatial.find-in-area",operationVersion:"1.0",inputSchemaHash:"sha256:f902acdbe64e91474b7f3d2a94d8cad72a7a2d6182265981a770fb472a8914dd",outputSchemaHash:"sha256:8aa8231c04110a4fcf235e759bcdd4f2e97db20097bbff62f9161b4ce6f4d161",semanticProfileHash:"sha256:fecded8fb9803f556acd8030ab05b52e377ab6a95121c9007273f2735233422b",maturity:"STABLE",requiredPermissions:["data:read"],snapshotSupport:"CONSISTENT_AT_START"}],
  ["spatial.find-nearby@1.0", {operationId:"spatial.find-nearby",operationVersion:"1.0",inputSchemaHash:"sha256:17f7d021a954e30721adb28d02aae1803061455da9f153c1af019779d92ae846",outputSchemaHash:"sha256:d62bb6f78c53bdd5f7a714682edb91b18a90c9e520f6e642ee5a43d92d61fe23",semanticProfileHash:"sha256:80e56fb4f234644890de458056d66b78903f1f458460b8a066da75a4a2f18eff",maturity:"STABLE",requiredPermissions:["data:read"],snapshotSupport:"CONSISTENT_AT_START"}]
]);

export function verifyGowmSourceDirectory(doc, sourceDirectory) {
  const root = resolve(sourceDirectory);
  let actualCommit;
  try {
    actualCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch (error) {
    fail("GOWM_SOURCE_GIT_UNAVAILABLE", error instanceof Error ? error.message : String(error));
  }
  assertEqual(actualCommit, EXPECTED.runtimeCommit, "GOWM_SOURCE_COMMIT_MISMATCH", "git HEAD");

  const runtimePackage = readJson(join(root, "package.json"));
  assertEqual(runtimePackage.version, EXPECTED.runtimeVersion, "GOWM_RUNTIME_VERSION_MISMATCH", "GOWM package.json.version");

  const nonAuthorityVersion = readFileSync(join(root, "VERSION"), "utf8").trim();
  assertEqual(nonAuthorityVersion, doc.gowmRuntime.knownNonAuthoritativeVersionFile.observedValueAtSourceCommit,
    "KNOWN_NON_AUTHORITY_VERSION_FILE_CHANGED", "GOWM VERSION observation");
  assertTrue(doc.gowmRuntime.knownNonAuthoritativeVersionFile.mustNotBeUsedAsRuntimeVersionAuthority,
    "RUNTIME_VERSION_AUTHORITY_INVALID", "VERSION must remain non-authoritative");

  const contractRoot = join(root, "packages", "platform", "world-gateway-contracts");
  const packageJson = readJson(join(contractRoot, "package.json"));
  assertEqual(packageJson.name, EXPECTED.gatewayPackageName, "GATEWAY_PACKAGE_NAME_MISMATCH", "consumer package name");
  assertEqual(packageJson.version, EXPECTED.gatewayPackageVersion, "GATEWAY_PACKAGE_VERSION_MISMATCH", "consumer package version");

  const manifest = readJson(join(contractRoot, "bundle", "MANIFEST.json"));
  assertEqual(manifest.packageName, EXPECTED.gatewayPackageName, "GATEWAY_PACKAGE_NAME_MISMATCH", "manifest packageName");
  assertEqual(manifest.packageVersion, EXPECTED.gatewayPackageVersion, "GATEWAY_PACKAGE_VERSION_MISMATCH", "manifest packageVersion");
  assertEqual(manifest.packageIntegrity, EXPECTED.consumerIntegrity, "CONSUMER_INTEGRITY_MISMATCH", "manifest packageIntegrity");
  assertEqual(manifest.contractCatalogRevision, EXPECTED.contractCatalogRevision, "CONTRACT_CATALOG_REVISION_MISMATCH", "manifest contractCatalogRevision");
  assertEqual(manifest.semanticCatalogHash, EXPECTED.semanticCatalogHash, "SEMANTIC_CATALOG_REVISION_MISMATCH", "manifest semanticCatalogHash");

  const southboundPath = join(contractRoot, "bundle", "locks", "wsgs-southbound-operation-lock-v2.json");
  const southboundRepositoryPath = "packages/platform/world-gateway-contracts/bundle/locks/wsgs-southbound-operation-lock-v2.json";
  let authoritativeBytes;
  try {
    authoritativeBytes = execFileSync("git", ["-C", root, "show", `${EXPECTED.runtimeCommit}:${southboundRepositoryPath}`], { encoding: null, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    fail("GOWM_SOURCE_GIT_UNAVAILABLE", error instanceof Error ? error.message : String(error));
  }
  assertEqual(sha256(authoritativeBytes), EXPECTED.southboundLockFileSha256, "SOUTHBOUND_LOCK_FILE_HASH_MISMATCH", "authoritative Git blob/LF southbound lock hash");
  const checkoutBytes = readFileSync(southboundPath);
  const checkoutCanonicalLf = canonicalLf(checkoutBytes, southboundRepositoryPath);
  assertEqual(sha256(checkoutCanonicalLf), EXPECTED.southboundLockFileSha256, "SOUTHBOUND_LOCK_FILE_HASH_MISMATCH", "checkout canonical-LF southbound lock hash");
  assertEqual(checkoutCanonicalLf.equals(authoritativeBytes), true, "SOUTHBOUND_LOCK_FILE_HASH_MISMATCH", "checkout vs authoritative Git blob/LF");
  const southbound = JSON.parse(authoritativeBytes.toString("utf8"));
  assertEqual(southbound.gatewayContractVersion, EXPECTED.gatewayContractVersion, "GATEWAY_CONTRACT_VERSION_MISMATCH", "southbound gatewayContractVersion");
  assertEqual(southbound.consumerContractPackage.name, EXPECTED.gatewayPackageName, "GATEWAY_PACKAGE_NAME_MISMATCH", "southbound consumer name");
  assertEqual(southbound.consumerContractPackage.version, EXPECTED.gatewayPackageVersion, "GATEWAY_PACKAGE_VERSION_MISMATCH", "southbound consumer version");
  assertEqual(southbound.consumerContractPackage.integrity, EXPECTED.consumerIntegrity, "CONSUMER_INTEGRITY_MISMATCH", "southbound consumer integrity");
  assertEqual(southbound.contractCatalogRevision, EXPECTED.contractCatalogRevision, "CONTRACT_CATALOG_REVISION_MISMATCH", "southbound contractCatalogRevision");
  assertEqual(southbound.semanticCatalogHash, EXPECTED.semanticCatalogHash, "SEMANTIC_CATALOG_REVISION_MISMATCH", "southbound semanticCatalogHash");
  assertEqual(southbound.availabilityContractHash, EXPECTED.availabilityContractHash, "AVAILABILITY_CONTRACT_HASH_MISMATCH", "southbound availabilityContractHash");
  assertEqual(southbound.snapshotContractHash, EXPECTED.snapshotContractHash, "SNAPSHOT_CONTRACT_HASH_MISMATCH", "southbound snapshotContractHash");
  assertEqual(southbound.delegationContractHash, EXPECTED.delegationContractHash, "DELEGATION_CONTRACT_HASH_MISMATCH", "southbound delegationContractHash");

  const liveOps = mapOperations(southbound);
  for (const expectedOp of doc.criticalOperationFingerprints) {
    const key = operationKey(expectedOp);
    const actual = liveOps.get(key);
    if (!actual) fail("CRITICAL_OPERATION_MISSING", key);
    for (const field of ["inputSchemaHash", "outputSchemaHash", "semanticProfileHash", "maturity", "snapshotSupport"]) {
      if (actual[field] !== expectedOp[field]) {
        const code = field === "semanticProfileHash" ? "UNDECLARED_SEMANTIC_PROFILE_DRIFT"
          : field === "inputSchemaHash" || field === "outputSchemaHash" ? "UNEXPECTED_WIRE_SCHEMA_DRIFT"
          : "UNEXPECTED_OPERATION_POLICY_DRIFT";
        fail(code, `${key}.${field}: expected=${expectedOp[field]} actual=${actual[field]}`);
      }
    }
    if (JSON.stringify(actual.requiredPermissions) !== JSON.stringify(expectedOp.requiredPermissions)) {
      fail("UNEXPECTED_OPERATION_POLICY_DRIFT", `${key}.requiredPermissions`);
    }
  }
  return { sourceDirectory: root, sourceCommit: actualCommit, liveOperationCount: liveOps.size };
}

export function compareBaselineAndCandidateLocks(doc, baselinePath, candidatePath) {
  const baseline = readJson(resolve(baselinePath));
  const candidate = readJson(resolve(candidatePath));
  const oldOps = mapOperations(baseline);
  const newOps = mapOperations(candidate);
  const oldKeys = [...oldOps.keys()].sort();
  const newKeys = [...newOps.keys()].sort();
  if (JSON.stringify(oldKeys) !== JSON.stringify(newKeys)) {
    fail("UNEXPECTED_OPERATION_SET_DRIFT", `baseline=${oldKeys.length} candidate=${newKeys.length}`);
  }
  const allowed = migrationMap(doc);
  const observedMigrations = [];
  for (const key of oldKeys) {
    const before = oldOps.get(key);
    const after = newOps.get(key);
    for (const field of ["inputSchemaHash", "outputSchemaHash", "maturity", "snapshotSupport"]) {
      if (before[field] !== after[field]) {
        const code = field === "inputSchemaHash" || field === "outputSchemaHash"
          ? "UNEXPECTED_WIRE_SCHEMA_DRIFT" : "UNEXPECTED_OPERATION_POLICY_DRIFT";
        fail(code, `${key}.${field}: before=${before[field]} after=${after[field]}`);
      }
    }
    if (JSON.stringify(before.requiredPermissions) !== JSON.stringify(after.requiredPermissions)) {
      fail("UNEXPECTED_OPERATION_POLICY_DRIFT", `${key}.requiredPermissions`);
    }
    if (before.semanticProfileHash !== after.semanticProfileHash) {
      const migration = allowed.get(key);
      if (!migration || migration.fromSemanticProfileHash !== before.semanticProfileHash || migration.toSemanticProfileHash !== after.semanticProfileHash) {
        fail("UNDECLARED_SEMANTIC_PROFILE_DRIFT", `${key}: before=${before.semanticProfileHash} after=${after.semanticProfileHash}`);
      }
      observedMigrations.push(key);
    }
  }
  const declaredKeys = [...allowed.keys()].sort();
  if (JSON.stringify(observedMigrations.sort()) !== JSON.stringify(declaredKeys)) {
    fail("DECLARED_SEMANTIC_MIGRATION_NOT_OBSERVED", `declared=${declaredKeys.join(",")} observed=${observedMigrations.sort().join(",")}`);
  }
  return { operationCount: oldKeys.length, observedSemanticMigrations: observedMigrations.sort() };
}

export function verifySingleUpstreamAuthority(doc, repositoryDirectory) {
  const root = resolve(repositoryDirectory);
  for (const relativePath of ["contracts/upstream/GOWM_COMMIT", "contracts/upstream/GOWM_VERSION"]) {
    if (existsSync(join(root, relativePath))) fail("MULTIPLE_UPSTREAM_AUTHORITIES", relativePath);
  }

  const task = doc.taskGeneratedAgainst;
  const runtime = doc.gowmRuntime;
  const contract = doc.gatewayContract;
  const expectedProjection = {
    schemaVersion: "1.0",
    wsgsSource: {
      repository: task.wsgsRepository,
      commit: task.wsgsCommit,
      version: task.wsgsVersion
    },
    gowmSource: {
      repository: runtime.repository,
      commit: runtime.sourceCommit,
      version: runtime.softwareVersion
    },
    consumerPackage: {
      name: contract.packageName,
      version: contract.packageVersion,
      integrity: contract.consumerLogicalIntegrity,
      contractCatalogRevision: contract.contractCatalogRevision,
      semanticCatalogHash: contract.semanticCatalogHash,
      availabilityContractHash: contract.availabilityContractHash,
      snapshotContractHash: contract.snapshotContractHash,
      delegationContractHash: contract.delegationContractHash,
      southboundLockSha256: contract.southboundLockFileSha256.replace(/^sha256:/u, "")
    },
    northboundContractVersion: task.northboundContractVersion,
    targetVersion: task.targetWsgsVersion
  };
  const projectionPaths = [
    "contracts/upstream/gowm-0.6.3/SOURCE_LOCK.json",
    "contracts/wsgs-v0.2-internal/dependencies/source-lock.json"
  ];
  for (const relativePath of projectionPaths) {
    const actual = readJson(join(root, relativePath));
    if (canonicalJson(actual) !== canonicalJson(expectedProjection)) {
      fail("MULTIPLE_UPSTREAM_AUTHORITIES", `${relativePath} is not the deterministic alignment-lock projection`);
    }
  }

  const artifactLock = readJson(join(root, "contracts/wsgs-v0.2-internal/artifact-lock.json"));
  assertEqual(artifactLock.gowmSourceCommit, runtime.sourceCommit, "MULTIPLE_UPSTREAM_AUTHORITIES", "artifact-lock.gowmSourceCommit");

  const handoff = readJson(join(root, "contracts/consumers/sacs-development-handoff-v1.json"));
  const handoffGowm = object(handoff.gowm, "MULTIPLE_UPSTREAM_AUTHORITIES", "handoff.gowm");
  assertEqual(handoffGowm.runtimeVersion, runtime.softwareVersion, "MULTIPLE_UPSTREAM_AUTHORITIES", "handoff.gowm.runtimeVersion");
  assertEqual(handoffGowm.sourceCommit, runtime.sourceCommit, "MULTIPLE_UPSTREAM_AUTHORITIES", "handoff.gowm.sourceCommit");
  assertEqual(handoffGowm.gatewayContractVersion, contract.gatewayContractVersion, "MULTIPLE_UPSTREAM_AUTHORITIES", "handoff.gowm.gatewayContractVersion");
  const handoffPackage = object(handoffGowm.consumerPackage, "MULTIPLE_UPSTREAM_AUTHORITIES", "handoff.gowm.consumerPackage");
  assertEqual(handoffPackage.name, contract.packageName, "MULTIPLE_UPSTREAM_AUTHORITIES", "handoff consumer package name");
  assertEqual(handoffPackage.version, contract.packageVersion, "MULTIPLE_UPSTREAM_AUTHORITIES", "handoff consumer package version");

  const activeSourcePaths = [
    "packages/gowm-contract-intake/src/index.ts",
    "packages/contracts/src/index.ts",
    "packages/contracts/src/gowm-alignment.ts",
    "validation/scripts/verify-wsgs-v02-internal.mjs"
  ];
  for (const relativePath of activeSourcePaths) {
    const source = readFileSync(join(root, relativePath), "utf8");
    if (source.includes("GOWM_SOURCE_VERSION") || source.includes("export const GOWM_SOURCE_COMMIT") ||
        source.includes("export const GOWM_COMMIT") || source.includes("export const GOWM_VERSION")) {
      fail("MULTIPLE_UPSTREAM_AUTHORITIES", `${relativePath} exports an ambiguous authority`);
    }
    if (source.includes("17dd221330d9af540ec815a39eca96550690299a")) {
      fail("MULTIPLE_UPSTREAM_AUTHORITIES", `${relativePath} pins the superseded runtime source`);
    }
  }

  return {
    status: "PASS",
    authorityPath: "contracts/upstream/gowm-runtime-contract-alignment-lock-v1.json",
    generatedCompatibilityProjections: projectionPaths,
    historicalNonAuthorities: [
      "contracts/upstream/gowm-v0.4/",
      "contracts/upstream/required-gowm-capabilities.json",
      "contracts/upstream/optional-gowm-capabilities.json",
      "execplans/EP-wsgs-v0.2-gowm-063.md",
      "reports/wsgs-v0.2/"
    ],
    independentAuthorityCount: 1
  };
}

function parseArgs(argv) {
  const result = {
    lock: DEFAULT_LOCK,
    gowmDir: process.env.GOWM_SOURCE_DIR,
    baselineLock: DEFAULT_BASELINE_LOCK,
    candidateLock: DEFAULT_CANDIDATE_LOCK
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--lock") result.lock = argv[++index];
    else if (token === "--gowm-dir") result.gowmDir = argv[++index];
    else if (token === "--baseline-lock") result.baselineLock = argv[++index];
    else if (token === "--candidate-lock") result.candidateLock = argv[++index];
    else fail("UNKNOWN_ARGUMENT", token);
  }
  if ((result.baselineLock === undefined) !== (result.candidateLock === undefined)) {
    fail("LOCK_DIFF_ARGUMENTS_INCOMPLETE", "--baseline-lock and --candidate-lock must be supplied together");
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const doc = readJson(resolve(args.lock));
  const staticResult = validateAlignmentLockDocument(doc);
  const authorityResult = verifySingleUpstreamAuthority(doc, resolve(HERE, "..", ".."));
  const sourceResult = args.gowmDir ? verifyGowmSourceDirectory(doc, args.gowmDir) : undefined;
  const diffResult = args.baselineLock ? compareBaselineAndCandidateLocks(doc, args.baselineLock, args.candidateLock) : undefined;
  console.log(JSON.stringify({ ...staticResult, authorityVerification: authorityResult, sourceVerification: sourceResult ?? "NOT_REQUESTED", contractDiff: diffResult ?? "NOT_REQUESTED" }, null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    const code = error instanceof AlignmentInvariantError ? error.code : "UNEXPECTED_VALIDATOR_FAILURE";
    console.error(JSON.stringify({ status: "BLOCKED", code, message: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
}
