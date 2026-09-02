import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SACS_GEOSPATIAL_BUSINESS_FILES,
  SACS_GEOSPATIAL_INVENTORY,
  bundleHash,
  canonicalHash,
  canonicalJson,
  inventoryRole,
  sha256,
  verifySacsGeospatialHandoff,
  type SacsGeospatialHandoffStatus
} from "./sacs-geospatial-handoff-lib.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const contractRoot = join(repositoryRoot, "contracts", "wsgs-v0.2.1-sacs-geospatial");
const outputRoot = join(repositoryRoot, "handoff", "sacs-geospatial-v1");
const reportRoot = join(repositoryRoot, "reports", "sacs-geospatial-v1");
const write = process.argv.includes("--write");

function object(path: string): Record<string, unknown> {
  const value = JSON.parse(readFileSync(join(repositoryRoot, path), "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`N08_INVALID_AUTHORITY:${path}`);
  return value as Record<string, unknown>;
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function sourceHash(path: string): `sha256:${string}` {
  return sha256(readFileSync(join(repositoryRoot, path)));
}

const sourceLockPath = "contracts/handoff-source-locks/wsgs-sacs-geospatial-v1.json";
const sourceLock = object(sourceLockPath);
const sourceStatus = sourceLock["status"];
if (sourceLock["schemaVersion"] !== "wsgs-sacs-geospatial-handoff-source-lock/1.0" ||
    !["BLOCKED", "READY"].includes(String(sourceStatus))) throw new Error("N08_SOURCE_LOCK_INVALID");
const wsgs = record(sourceLock["wsgs"], "N08_WSGS_SOURCE_LOCK_INVALID");
const gowm = record(sourceLock["gowm"], "N08_GOWM_SOURCE_LOCK_INVALID");
const gdps = record(sourceLock["gdps"], "N08_GDPS_SOURCE_LOCK_INVALID");
const sacs = record(sourceLock["sacs"], "N08_SACS_SOURCE_LOCK_INVALID");
for (const value of [wsgs["sourceSha"], wsgs["deliveryHeadSha"], gowm["sourceSha"], gdps["sourceSha"], sacs["consumerHeadSha"]]) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) throw new Error("N08_SOURCE_SHA_INVALID");
}

const releaseLock = object("contracts/wsgs-v0.2.1-sacs-geospatial/contract-release-lock.json");
const artifacts = record(releaseLock["artifacts"], "N08_CONTRACT_ARTIFACT_LOCK_INVALID");
if (releaseLock["contractVersion"] !== "sacs-wsgs-grounding/1.1" ||
    releaseLock["profile"] !== "sacs-wsgs-geospatial-findings/1.0") throw new Error("N08_CONTRACT_RELEASE_LOCK_INVALID");
for (const [path, expected] of Object.entries(artifacts)) {
  const actual = sha256(readFileSync(join(contractRoot, path)));
  if (actual !== expected) throw new Error(`N08_CONTRACT_SOURCE_DRIFT:${path}`);
}

const n05 = object("reports/sacs-geospatial-v1/N05-replay.json");
const n06 = object("reports/sacs-geospatial-v1/N06-currentness-runtime.json");
const n07Postgres = object("reports/sacs-geospatial-v1/N07-postgres-integration.json");
const n07Replay = object("reports/sacs-geospatial-v1/N07-restart-replay.json");
const runtimeReady = n05["durableReceiptReplay"] === "PASS" && n06["status"] === "PASS" &&
  n07Postgres["status"] === "PASS" && n07Replay["status"] === "PASS";
const consumerReportPath = "reports/sacs-geospatial-v1/N09-sacs-intake.json";
const e2eReportPath = "reports/sacs-geospatial-v1/N10-real-e2e.json";
const consumerReady = existsSync(join(repositoryRoot, consumerReportPath)) && object(consumerReportPath)["status"] === "PASS";
const e2eReady = existsSync(join(repositoryRoot, e2eReportPath)) && object(e2eReportPath)["status"] === "PASS";
const status: SacsGeospatialHandoffStatus = sourceStatus === "READY" && runtimeReady && consumerReady && e2eReady
  ? "READY"
  : "BLOCKED";
const blockers = [
  ...(runtimeReady ? [] : ["N07_REAL_POSTGRESQL_AND_RUNTIME_QUALIFICATION_REQUIRED"]),
  ...(consumerReady ? [] : ["N09_SACS_V04_CONSUMER_COMPATIBILITY_REQUIRED"]),
  ...(e2eReady ? [] : ["N10_REAL_18_CASE_E2E_REQUIRED"]),
  ...(sourceStatus === "READY" ? [] : ["WSGS_EXACT_SOURCE_AND_DELIVERY_QUALIFICATION_REQUIRED"])
].sort();

const schema = (name: string): `sha256:${string}` => {
  const locked = artifacts[name];
  if (typeof locked !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(locked)) {
    throw new Error(`N08_SCHEMA_NOT_LOCKED:${name}`);
  }
  return locked as `sha256:${string}`;
};

function schemaLock(input: {
  artifactRole: string;
  primarySchema: string;
  additionalSchemas?: readonly string[];
  generatedTypes: readonly string[];
}): Record<string, unknown> {
  const primaryPath = `contracts/wsgs-v0.2.1-sacs-geospatial/${input.primarySchema}`;
  const generatedTypeFiles = input.generatedTypes.map((name) => {
    const path = `packages/contracts/src/generated-sacs-geospatial/${name}`;
    return { path, sha256: sourceHash(path) };
  });
  return {
    lockSchemaVersion: "wsgs-sacs-geospatial-schema-lock/1.0",
    artifactRole: input.artifactRole,
    contractVersion: "sacs-wsgs-grounding/1.1",
    profile: "sacs-wsgs-geospatial-findings/1.0",
    sourceSchemaPath: primaryPath,
    sourceSchemaSha256: schema(input.primarySchema),
    additionalSourceSchemas: (input.additionalSchemas ?? []).map((name) => ({
      path: `contracts/wsgs-v0.2.1-sacs-geospatial/${name}`,
      sha256: schema(name)
    })),
    generatedTypePaths: generatedTypeFiles.map(({ path }) => path),
    generatedTypeSha256: canonicalHash(generatedTypeFiles),
    generatedTypeFiles,
    canonicalization: "WSGS_CODE_POINT_SORTED_JSON_V1",
    compatibilityTarget: {
      service: "SACS",
      version: text(sacs["consumerVersion"], "N08_SACS_VERSION_INVALID"),
      sourceHeadSha: text(sacs["consumerHeadSha"], "N08_SACS_HEAD_INVALID")
    }
  };
}

const consumerWithoutHash = {
  schemaVersion: "sacs-wsgs-geospatial-consumer-lock/1.0",
  provenance: "AUTHORITATIVE_WSGS_HANDOFF",
  status,
  ...(status === "BLOCKED"
    ? {
        blocker: {
          code: "WSGS_HANDOFF_QUALIFICATION_INCOMPLETE",
          safeDetail: "The authoritative handoff is generated, but runtime, consumer, E2E, or exact-source qualification is incomplete."
        }
      }
    : {}),
  sources: {
    wsgsSha: text(wsgs["sourceSha"], "N08_WSGS_SOURCE_INVALID"),
    gowmSha: text(gowm["sourceSha"], "N08_GOWM_SOURCE_INVALID"),
    gdpsSha: text(gdps["sourceSha"], "N08_GDPS_SOURCE_INVALID")
  },
  groundingContract: {
    contractVersion: "sacs-wsgs-grounding/1.1",
    resultSchemaHash: schema("grounding-result-extension.schema.json"),
    capabilitiesSchemaHash: schema("capabilities-response-v1.1.schema.json")
  },
  geospatialProfile: {
    profile: "sacs-wsgs-geospatial-findings/1.0",
    transportMode: status === "READY" ? "RESULT_EXTENSION" : "UNRESOLVED",
    profileSchemaHash: schema("geospatial-findings.schema.json"),
    findingSchemaHash: schema("world-finding.schema.json"),
    sourceProductSchemaHash: schema("source-product.schema.json"),
    gapSchemaHash: schema("typed-gap.schema.json"),
    requestedProducts: []
  },
  currentness: status === "READY"
    ? {
        mode: "DEDICATED_OPERATION",
        operation: "VALIDATE_SOURCE_CURRENTNESS"
      }
    : { mode: "UNSUPPORTED" }
};

const businessDocuments: Record<(typeof SACS_GEOSPATIAL_BUSINESS_FILES)[number], Record<string, unknown>> = {
  "WSGS_SACS_GEOSPATIAL_CONSUMER_LOCK.json": {
    ...consumerWithoutHash,
    consumerLockHash: canonicalHash(consumerWithoutHash)
  },
  "WSGS_GROUNDING_RESULT_EXTENSION_SCHEMA_LOCK.json": schemaLock({
    artifactRole: "GROUNDING_RESULT_EXTENSION",
    primarySchema: "grounding-result-extension.schema.json",
    generatedTypes: ["grounding-result-extension.ts"]
  }),
  "WSGS_WORLD_FINDING_SCHEMA_LOCK.json": schemaLock({
    artifactRole: "WORLD_FINDING",
    primarySchema: "world-finding.schema.json",
    generatedTypes: ["world-finding.ts"]
  }),
  "WSGS_SOURCE_PRODUCT_SCHEMA_LOCK.json": schemaLock({
    artifactRole: "SOURCE_PRODUCT",
    primarySchema: "source-product.schema.json",
    generatedTypes: ["source-product.ts"]
  }),
  "WSGS_TYPED_GAP_SCHEMA_LOCK.json": schemaLock({
    artifactRole: "TYPED_GAP",
    primarySchema: "typed-gap.schema.json",
    generatedTypes: ["typed-gap.ts"]
  }),
  "WSGS_STRUCTURED_SELECTION_SCHEMA_LOCK.json": schemaLock({
    artifactRole: "STRUCTURED_SELECTION",
    primarySchema: "structured-selection-request.schema.json",
    additionalSchemas: ["structured-selection-result.schema.json"],
    generatedTypes: ["structured-selection-request.ts", "structured-selection-result.ts"]
  }),
  "WSGS_CURRENTNESS_SCHEMA_LOCK.json": schemaLock({
    artifactRole: "SOURCE_CURRENTNESS",
    primarySchema: "source-currentness-request.schema.json",
    additionalSchemas: ["source-currentness-result.schema.json"],
    generatedTypes: ["source-currentness-request.ts", "source-currentness-result.ts"]
  }),
  "WSGS_GEOSPATIAL_UPSTREAM_PROVENANCE_LOCK.json": {
    schemaVersion: "wsgs-sacs-geospatial-upstream-provenance-lock/1.0",
    provenance: "AUTHORITATIVE_WSGS_HANDOFF",
    status,
    wsgs: {
      qualifiedSourceSha: status === "READY" ? wsgs["sourceSha"] : null,
      deliveryHeadSha: wsgs["deliveryHeadSha"],
      runtimeImageDigest: wsgs["runtimeImageDigest"]
    },
    gowm: {
      sourceSha: gowm["sourceSha"],
      runtimeVersion: gowm["runtimeVersion"],
      gatewayContractVersion: gowm["gatewayContractVersion"],
      runtimeImageDigest: gowm["runtimeImageDigest"]
    },
    gdps: {
      sourceSha: gdps["sourceSha"],
      providerVersion: gdps["providerVersion"],
      descriptorRegistryHash: gdps["descriptorRegistryHash"],
      consumerBundleHash: gdps["consumerBundleHash"]
    },
    sacs: {
      consumerVersion: sacs["consumerVersion"],
      consumerHeadSha: sacs["consumerHeadSha"]
    },
    evidence: {
      sourceLockHash: sourceHash(sourceLockPath),
      n05ReplayHash: sourceHash("reports/sacs-geospatial-v1/N05-replay.json"),
      n06RuntimeHash: sourceHash("reports/sacs-geospatial-v1/N06-currentness-runtime.json"),
      n07PostgresHash: sourceHash("reports/sacs-geospatial-v1/N07-postgres-integration.json"),
      n07RestartReplayHash: sourceHash("reports/sacs-geospatial-v1/N07-restart-replay.json"),
      consumerCompatibilityReportHash: consumerReady ? sourceHash(consumerReportPath) : null,
      realE2e18CaseReportHash: e2eReady ? sourceHash(e2eReportPath) : null
    },
    qualification: {
      implementation: true,
      runtime: runtimeReady,
      consumerCompatible: consumerReady,
      realE2e18Cases: e2eReady,
      production: false,
      blockers
    }
  }
};

const expected = new Map<string, string>();
for (const filename of SACS_GEOSPATIAL_BUSINESS_FILES) {
  expected.set(filename, canonicalJson(businessDocuments[filename]));
}
const entries = SACS_GEOSPATIAL_BUSINESS_FILES.map((filename) => {
  const bytes = Buffer.from(expected.get(filename)!, "utf8");
  const document = businessDocuments[filename];
  return {
    filename,
    role: inventoryRole(filename),
    schemaVersion: String(document["schemaVersion"] ?? document["lockSchemaVersion"]),
    byteLength: bytes.byteLength,
    sha256: sha256(bytes)
  };
}).sort((left, right) => left.filename < right.filename ? -1 : left.filename > right.filename ? 1 : 0);
const checksums = {
  schemaVersion: "wsgs-sacs-geospatial-checksums/1.0",
  inventoryCount: 8,
  encoding: "UTF-8",
  lineEnding: "LF",
  canonicalJson: "WSGS_CODE_POINT_SORTED_JSON_V1",
  files: entries,
  bundleHash: bundleHash(entries)
};
expected.set("CHECKSUMS.json", canonicalJson(checksums));

if (write) {
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  for (const filename of SACS_GEOSPATIAL_INVENTORY) {
    writeFileSync(join(outputRoot, filename), expected.get(filename)!, "utf8");
  }
} else {
  if (!existsSync(outputRoot) || JSON.stringify(readdirSync(outputRoot).sort()) !==
      JSON.stringify([...SACS_GEOSPATIAL_INVENTORY].sort())) throw new Error("N08_HANDOFF_INVENTORY_DRIFT");
  for (const filename of SACS_GEOSPATIAL_INVENTORY) {
    if (readFileSync(join(outputRoot, filename), "utf8").replaceAll("\r\n", "\n") !== expected.get(filename)) {
      throw new Error(`N08_HANDOFF_GENERATED_DRIFT:${filename}`);
    }
  }
}

const verified = verifySacsGeospatialHandoff({ repositoryRoot, handoffDirectory: outputRoot });
const generationReport = {
  schemaVersion: "wsgs-v021-n08-handoff-generation/1.0",
  phase: "N08",
  status: verified.status,
  provenance: "AUTHORITATIVE_WSGS_HANDOFF",
  inventoryCount: verified.inventoryCount,
  fileCount: SACS_GEOSPATIAL_INVENTORY.length,
  bundleHash: verified.bundleHash,
  consumerLockHash: verified.consumerLockHash,
  sourceLockPath,
  sourceLockHash: sourceHash(sourceLockPath),
  outputPath: "handoff/sacs-geospatial-v1",
  canonicalJson: "WSGS_CODE_POINT_SORTED_JSON_V1",
  encoding: "UTF-8",
  lineEnding: "LF",
  exactRegeneration: "PASS",
  readyForSacsConsumer: verified.status === "READY",
  blockers
};
const reportContent = `${JSON.stringify(generationReport, null, 2)}\n`;
const reportPath = join(reportRoot, "N08-handoff-generation.json");
if (write) {
  mkdirSync(reportRoot, { recursive: true });
  writeFileSync(reportPath, reportContent, "utf8");
} else if (!existsSync(reportPath) || readFileSync(reportPath, "utf8").replaceAll("\r\n", "\n") !== reportContent) {
  throw new Error(`N08_GENERATION_REPORT_DRIFT:${relative(repositoryRoot, reportPath)}`);
}

console.log(`WSGS_V021_HANDOFF_${verified.status} files=9 bundleHash=${verified.bundleHash}`);
