import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const EXPECTED_COMMIT = "f2894d86eeca121f9cea76c70797ece3b091d51f";
const EXPECTED_VERSION = "0.6.4";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

if (required("ALLOW_BUILD_GOWM_EXACT_RUNTIME_IMAGE") !== "YES") {
  throw new Error("GOWM_EXACT_RUNTIME_IMAGE_BUILD_NOT_ALLOWED");
}
const sourceDirectory = resolve(required("GOWM_SOURCE_DIR"));
const imageTag = required("GOWM_RUNTIME_IMAGE_TAG");
if (!/^[a-z0-9][a-z0-9._/-]{2,127}:[a-z0-9][a-z0-9._-]{0,63}$/u.test(imageTag)) {
  throw new Error("GOWM_RUNTIME_IMAGE_TAG_INVALID");
}
const head = execFileSync("git", ["-C", sourceDirectory, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== EXPECTED_COMMIT) throw new Error("GOWM_RUNTIME_IMAGE_SOURCE_COMMIT_MISMATCH");
const tree = execFileSync("git", ["-C", sourceDirectory, "rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
if (!/^[0-9a-f]{40}$/u.test(tree)) throw new Error("GOWM_RUNTIME_IMAGE_SOURCE_TREE_INVALID");
const trackedDiff = execFileSync("git", ["-C", sourceDirectory, "status", "--porcelain", "--untracked-files=all"], {
  encoding: "utf8", maxBuffer: 8 * 1024 * 1024
}).trim();
if (trackedDiff) throw new Error("GOWM_RUNTIME_IMAGE_SOURCE_WORKTREE_NOT_CLEAN");
const packageDocument = JSON.parse(readFileSync(resolve(sourceDirectory, "package.json"), "utf8")) as { version?: string };
if (packageDocument.version !== EXPECTED_VERSION) throw new Error("GOWM_RUNTIME_IMAGE_VERSION_MISMATCH");

execFileSync("docker", [
  "build",
  "--label", `org.opencontainers.image.revision=${EXPECTED_COMMIT}`,
  "--label", `org.opencontainers.image.version=${EXPECTED_VERSION}`,
  "--tag", imageTag,
  "."
], { cwd: sourceDirectory, stdio: "inherit", maxBuffer: 64 * 1024 * 1024 });

const inspected = JSON.parse(execFileSync("docker", ["image", "inspect", imageTag], {
  encoding: "utf8", maxBuffer: 4 * 1024 * 1024
})) as Array<{ Id?: string; Config?: { Labels?: Record<string, string> } }>;
const image = inspected[0];
if (!image || !/^sha256:[0-9a-f]{64}$/u.test(image.Id ?? "")) throw new Error("GOWM_RUNTIME_IMAGE_INSPECT_INVALID");
if (image.Config?.Labels?.["org.opencontainers.image.revision"] !== EXPECTED_COMMIT ||
    image.Config?.Labels?.["org.opencontainers.image.version"] !== EXPECTED_VERSION) {
  throw new Error("GOWM_RUNTIME_IMAGE_LABEL_MISMATCH");
}
const dockerServerVersion = execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).trim();
const payload = {
  schemaVersion: "wsgs-gowm-runtime-image-build/1.0",
  status: "PASS",
  generatedAt: new Date().toISOString(),
  sourceCommit: EXPECTED_COMMIT,
  sourceTree: tree,
  runtimeVersion: EXPECTED_VERSION,
  imageDigest: image.Id,
  imageTagHash: sha256(imageTag),
  dockerServerVersion,
  buildMethod: "DOCKER_BUILD_FROM_CLEAN_EXACT_GIT_TREE_WITH_OCI_LABELS",
  sourceDirectoryIncluded: false,
  redaction: { credentialsIncluded: false, localPathsIncluded: false, internalTopologyIncluded: false }
};
const report = { ...payload, evidenceHash: sha256(canonical(payload)) };
const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const reportPath = resolve(process.env["GOWM_RUNTIME_IMAGE_BUILD_REPORT"] ??
  "reports/wsgs-gowm-0.6.4-alignment/runtime-image-build-report.json");
const relativePath = relative(repositoryRoot, reportPath).split(sep).join("/");
if (relativePath.startsWith("..")) throw new Error("GOWM_RUNTIME_IMAGE_BUILD_REPORT_OUTSIDE_REPOSITORY");
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({
  marker: "GOWM_EXACT_RUNTIME_IMAGE_BUILD_PASS",
  sourceCommit: EXPECTED_COMMIT,
  runtimeVersion: EXPECTED_VERSION,
  imageDigest: image.Id,
  reportPath: relativePath,
  evidenceHash: report.evidenceHash
})}\n`);
