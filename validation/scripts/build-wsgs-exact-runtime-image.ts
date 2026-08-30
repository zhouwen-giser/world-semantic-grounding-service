import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

type JsonObject = Record<string, unknown>;

const EXPECTED_VERSION = "0.2.1";
const REPORT_RELATIVE_PATH = "reports/wsgs-gowm-0.6.4-alignment/wsgs-runtime-image-build-report.json";
const ALLOWED_PREEXISTING_EVIDENCE = new Set([
  "reports/wsgs-gowm-0.6.4-alignment/runtime-image-build-report.json"
]);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as JsonObject;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("WSGS_RUNTIME_IMAGE_CANONICAL_JSON_UNDEFINED");
  return encoded;
}

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function repositoryPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

if (required("ALLOW_BUILD_WSGS_EXACT_RUNTIME_IMAGE") !== "YES") {
  throw new Error("WSGS_EXACT_RUNTIME_IMAGE_BUILD_NOT_ALLOWED");
}

const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const expectedCommit = required("WSGS_EVIDENCE_SOURCE_COMMIT");
if (!/^[0-9a-f]{40}$/u.test(expectedCommit)) throw new Error("WSGS_EVIDENCE_SOURCE_COMMIT_INVALID");
const imageTag = required("WSGS_RUNTIME_IMAGE_TAG");
if (!/^[a-z0-9][a-z0-9._/-]{2,127}:[a-z0-9][a-z0-9._-]{0,63}$/u.test(imageTag)) {
  throw new Error("WSGS_RUNTIME_IMAGE_TAG_INVALID");
}

const head = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== expectedCommit) throw new Error("WSGS_RUNTIME_IMAGE_SOURCE_COMMIT_MISMATCH");
const sourceTree = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD^{tree}"], {
  encoding: "utf8"
}).trim();
if (!/^[0-9a-f]{40}$/u.test(sourceTree)) throw new Error("WSGS_RUNTIME_IMAGE_SOURCE_TREE_INVALID");
try {
  execFileSync("git", ["-C", repositoryRoot, "diff", "--quiet", "HEAD", "--", "."], { stdio: "ignore" });
} catch {
  throw new Error("WSGS_RUNTIME_IMAGE_TRACKED_SOURCE_DIRTY");
}
const status = execFileSync("git", ["-C", repositoryRoot, "status", "--porcelain=v1", "--untracked-files=all"], {
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024
}).trim();
const statusLines = status.length === 0 ? [] : status.split(/\r?\n/u);
if (!statusLines.every((line) => line.startsWith("?? ") && ALLOWED_PREEXISTING_EVIDENCE.has(line.slice(3)))) {
  throw new Error("WSGS_RUNTIME_IMAGE_SOURCE_WORKTREE_NOT_CLEAN");
}

const packageDocument = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")) as {
  name?: string;
  version?: string;
};
if (packageDocument.name !== "world-semantic-grounding-service" || packageDocument.version !== EXPECTED_VERSION) {
  throw new Error("WSGS_RUNTIME_IMAGE_PACKAGE_IDENTITY_MISMATCH");
}

execFileSync("docker", [
  "build",
  "--label", `org.opencontainers.image.revision=${expectedCommit}`,
  "--label", `org.opencontainers.image.version=${EXPECTED_VERSION}`,
  "--tag", imageTag,
  "."
], { cwd: repositoryRoot, stdio: "inherit", maxBuffer: 64 * 1024 * 1024 });

const inspected = JSON.parse(execFileSync("docker", ["image", "inspect", imageTag], {
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024
})) as Array<{ Id?: string; Config?: { Labels?: Record<string, string> } }>;
const image = inspected[0];
if (!image || !/^sha256:[0-9a-f]{64}$/u.test(image.Id ?? "")) {
  throw new Error("WSGS_RUNTIME_IMAGE_INSPECT_INVALID");
}
if (image.Config?.Labels?.["org.opencontainers.image.revision"] !== expectedCommit ||
    image.Config?.Labels?.["org.opencontainers.image.version"] !== EXPECTED_VERSION) {
  throw new Error("WSGS_RUNTIME_IMAGE_LABEL_MISMATCH");
}

const payload = {
  schemaVersion: "wsgs-runtime-image-build/1.0",
  status: "PASS",
  generatedAt: new Date().toISOString(),
  sourceCommit: expectedCommit,
  sourceTree,
  runtimeVersion: EXPECTED_VERSION,
  imageDigest: image.Id,
  imageTagHash: sha256(imageTag),
  dockerServerVersion: execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8"
  }).trim(),
  buildMethod: "DOCKER_BUILD_FROM_CLEAN_EXACT_GIT_TREE_WITH_OCI_LABELS",
  sourceDirectoryIncluded: false,
  preexistingUntrackedEvidence: [...ALLOWED_PREEXISTING_EVIDENCE].filter((path) =>
    statusLines.includes(`?? ${path}`)),
  redaction: {
    credentialsIncluded: false,
    localPathsIncluded: false,
    internalTopologyIncluded: false
  }
};
const report = { ...payload, evidenceHash: sha256(canonicalJson(payload)) };
const configuredReportPath = resolve(
  repositoryRoot,
  process.env["WSGS_RUNTIME_IMAGE_BUILD_REPORT"] ?? REPORT_RELATIVE_PATH
);
const reportPath = repositoryPath(repositoryRoot, configuredReportPath);
if (reportPath !== REPORT_RELATIVE_PATH) throw new Error("WSGS_RUNTIME_IMAGE_BUILD_REPORT_PATH_INVALID");
mkdirSync(dirname(configuredReportPath), { recursive: true });
writeFileSync(configuredReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(`${JSON.stringify({
  marker: "WSGS_EXACT_RUNTIME_IMAGE_BUILD_PASS",
  sourceCommit: expectedCommit,
  runtimeVersion: EXPECTED_VERSION,
  imageDigest: image.Id,
  reportPath,
  evidenceHash: report.evidenceHash
})}\n`);
