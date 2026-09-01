import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SACS_GEOSPATIAL_BUSINESS_FILES,
  SacsGeospatialHandoffError,
  bundleHash,
  canonicalJson,
  jsonObject,
  sha256,
  verifySacsGeospatialHandoff
} from "./sacs-geospatial-handoff-lib.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const handoffRoot = join(repositoryRoot, "handoff", "sacs-geospatial-v1");
const reportRoot = join(repositoryRoot, "reports", "sacs-geospatial-v1");
const writeReports = process.argv.includes("--write-reports");
const requireReady = process.argv.includes("--require-ready");

function rebuildChecksums(directory: string): void {
  const old = jsonObject(readFileSync(join(directory, "CHECKSUMS.json")), "HANDOFF_CHECKSUMS_INVALID");
  const priorFiles = old["files"];
  if (!Array.isArray(priorFiles)) throw new SacsGeospatialHandoffError("HANDOFF_CHECKSUMS_INVALID");
  const metadata = new Map(priorFiles.map((raw) => {
    const entry = raw as Record<string, unknown>;
    return [String(entry["filename"]), entry];
  }));
  const files = SACS_GEOSPATIAL_BUSINESS_FILES.map((filename) => {
    const bytes = readFileSync(join(directory, filename));
    const previous = metadata.get(filename);
    return {
      filename,
      role: previous?.["role"],
      schemaVersion: previous?.["schemaVersion"],
      byteLength: bytes.byteLength,
      sha256: sha256(bytes)
    };
  }).sort((left, right) => left.filename < right.filename ? -1 : left.filename > right.filename ? 1 : 0);
  writeFileSync(join(directory, "CHECKSUMS.json"), canonicalJson({
    schemaVersion: "wsgs-sacs-geospatial-checksums/1.0",
    inventoryCount: 8,
    encoding: "UTF-8",
    lineEnding: "LF",
    canonicalJson: "WSGS_CODE_POINT_SORTED_JSON_V1",
    files,
    bundleHash: bundleHash(files)
  }), "utf8");
}

function mutateJson(directory: string, filename: string, mutate: (value: Record<string, unknown>) => void): void {
  const path = join(directory, filename);
  const value = jsonObject(readFileSync(path), "HANDOFF_JSON_INVALID");
  mutate(value);
  writeFileSync(path, canonicalJson(value), "utf8");
}

function negativeCase(
  caseId: string,
  expectedCode: string,
  mutate: (directory: string) => void
): Record<string, unknown> {
  const root = mkdtempSync(join(tmpdir(), "wsgs-n08-negative-"));
  const directory = join(root, "handoff");
  try {
    cpSync(handoffRoot, directory, { recursive: true });
    mutate(directory);
    try {
      verifySacsGeospatialHandoff({ repositoryRoot, handoffDirectory: directory });
    } catch (error) {
      if (error instanceof SacsGeospatialHandoffError && error.code === expectedCode) {
        return { caseId, expectedCode, observedCode: error.code, status: "PASS_FAIL_CLOSED" };
      }
      throw error;
    }
    throw new Error(`${caseId}: expected ${expectedCode}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const verified = verifySacsGeospatialHandoff({
  repositoryRoot,
  handoffDirectory: handoffRoot,
  requireReady
});

const intakeRoot = mkdtempSync(join(tmpdir(), "wsgs-n08-intake-"));
let intake;
try {
  const intakeDirectory = join(intakeRoot, "wsgs-geospatial");
  cpSync(handoffRoot, intakeDirectory, { recursive: true });
  const copied = verifySacsGeospatialHandoff({ repositoryRoot, handoffDirectory: intakeDirectory });
  intake = {
    portableCopyVerification: "PASS",
    copiedBundleHash: copied.bundleHash,
    consumerSchemaQualification: "NOT_RUN_N09_OWNER",
    sourceTreeModified: false
  };
} finally {
  rmSync(intakeRoot, { recursive: true, force: true });
}

const negativeCases = [
  negativeCase("N08-N01", "HANDOFF_CANONICAL_JSON_MISMATCH", (directory) => {
    const path = join(directory, "WSGS_WORLD_FINDING_SCHEMA_LOCK.json");
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from(" ")]))
  }),
  negativeCase("N08-N02", "HANDOFF_INVENTORY_MISMATCH", (directory) => {
    writeFileSync(join(directory, "STALE.json"), "{}\n", "utf8");
  }),
  negativeCase("N08-N03", "HANDOFF_INVENTORY_MISMATCH", (directory) => {
    unlinkSync(join(directory, "WSGS_TYPED_GAP_SCHEMA_LOCK.json"));
  }),
  negativeCase("N08-N04", "HANDOFF_LINE_ENDING_MISMATCH", (directory) => {
    const path = join(directory, "WSGS_SOURCE_PRODUCT_SCHEMA_LOCK.json");
    writeFileSync(path, readFileSync(path, "utf8").replaceAll("\n", "\r\n"), "utf8");
  }),
  negativeCase("N08-N05", "HANDOFF_SOURCE_SCHEMA_DRIFT", (directory) => {
    mutateJson(directory, "WSGS_WORLD_FINDING_SCHEMA_LOCK.json", (value) => {
      value["sourceSchemaSha256"] = `sha256:${"0".repeat(64)}`;
    });
    rebuildChecksums(directory);
  }),
  negativeCase("N08-N06", "HANDOFF_CONSUMER_LOCK_HASH_MISMATCH", (directory) => {
    mutateJson(directory, "WSGS_SACS_GEOSPATIAL_CONSUMER_LOCK.json", (value) => {
      value["status"] = value["status"] === "READY" ? "BLOCKED" : "READY";
    });
    rebuildChecksums(directory);
  }),
  negativeCase("N08-N07", "HANDOFF_FORBIDDEN_FIELD", (directory) => {
    mutateJson(directory, "WSGS_GEOSPATIAL_UPSTREAM_PROVENANCE_LOCK.json", (value) => {
      value["internalEndpoint"] = "redacted";
    });
    rebuildChecksums(directory);
  })
];

const negativeReport = {
  schemaVersion: "wsgs-v021-n08-handoff-negative-cases/1.0",
  phase: "N08",
  status: "PASS",
  bundleStatus: verified.status,
  caseCount: negativeCases.length,
  passedCount: negativeCases.length,
  cases: negativeCases,
  intake,
  credentialsIncluded: false,
  internalEndpointsIncluded: false
};
const phaseReport = `# N08 Authoritative Geospatial Handoff Phase Report\n\n` +
  `Status: **${verified.status === "READY" ? "READY" : "AUTHORITATIVE_BLOCKED_INTERMEDIATE"}**\n\n` +
  `- Generated the exact 8 business locks plus CHECKSUMS.json.\n` +
  `- Canonical JSON, UTF-8/LF, byte lengths, raw SHA-256 values, bundle hash, and self-excluding consumer lock hash verify.\n` +
  `- Stale, missing, byte-drifted, CRLF, source-hash-drifted, self-hash, and forbidden-field cases fail closed (${negativeCases.length}/${negativeCases.length}).\n` +
  `- A temporary portable intake copy verifies without modifying SACS source.\n` +
  `- Current bundle status is ${verified.status}; SACS consumer qualification remains owned by N09.\n` +
  `${verified.status === "READY" ? "- Completion marker is eligible.\n" : "- Completion marker `WSGS_V021_HANDOFF_PUBLISHED` is intentionally withheld.\n"}\n` +
  `Bundle: \`${verified.bundleHash}\`\n`;

function writeOrCheck(path: string, content: string): void {
  if (writeReports) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
    return;
  }
  if (!existsSync(path) || readFileSync(path, "utf8").replaceAll("\r\n", "\n") !== content) {
    throw new Error(`N08_REPORT_DRIFT:${relative(repositoryRoot, path)}`);
  }
}

writeOrCheck(join(reportRoot, "N08-handoff-negative-cases.json"), `${JSON.stringify(negativeReport, null, 2)}\n`);
writeOrCheck(join(reportRoot, "N08-phase-report.md"), phaseReport);

if (verified.status === "READY") console.log(`WSGS_V021_HANDOFF_PUBLISHED bundleHash=${verified.bundleHash}`);
else console.log(`WSGS_V021_HANDOFF_BLOCKED_VERIFIED bundleHash=${verified.bundleHash}`);
