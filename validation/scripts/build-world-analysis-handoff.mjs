import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { filesUnder } from "./world-analysis-handoff-consumer.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = resolve(root, "contracts/wsgs-v0.2.4-world-analysis");
const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const dependencyFiles = {
  ajv: ["dist", "LICENSE", "package.json"], "ajv-formats": ["dist", "LICENSE", "package.json"],
  "fast-deep-equal": ["index.js", "LICENSE", "package.json"], "fast-uri": ["index.js", "lib", "LICENSE", "package.json"],
  "json-schema-traverse": ["index.js", "LICENSE", "package.json"], "require-from-string": ["index.js", "license", "package.json"]
};
export function buildHandoff(target) {
  const releaseBytes = readFileSync(resolve(source, "contract-release-lock.json"));
  if (hash(releaseBytes) !== "sha256:45f027673834f3d9e654a889eea25eaf81522f594af8dddf6939b91a0dd4c41a") throw new Error("HANDOFF_FREEZE_LOCK_DRIFT");
  const release = JSON.parse(releaseBytes);
  for (const [path, digest] of Object.entries(release.artifacts)) {
    if (hash(readFileSync(resolve(source, path))) !== digest) throw new Error(`HANDOFF_FROZEN_SOURCE_DRIFT:${path}`);
  }
  mkdirSync(target, { recursive: true });
  for (const path of [...Object.keys(release.artifacts), "contract-release-lock.json", "CHECKSUMS.sha256"]) {
    const dest = resolve(target, "public", path); mkdirSync(resolve(dest, ".."), { recursive: true });
    cpSync(resolve(source, path), dest, { errorOnExist: true, force: false });
  }
  const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  const dependencies = [];
  for (const [name, paths] of Object.entries(dependencyFiles)) {
    const packageRoot = resolve(root, "node_modules", name);
    const info = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
    const locked = lock.packages[`node_modules/${name}`];
    if (info.version !== locked.version || !locked.integrity) throw new Error("HANDOFF_INSTALLED_DEPENDENCY_DRIFT");
    for (const dependency of Object.keys(info.dependencies ?? {})) if (!Object.hasOwn(dependencyFiles, dependency)) throw new Error("HANDOFF_DEPENDENCY_CLOSURE_MISSING");
    for (const path of paths) {
      const dest = resolve(target, "node_modules", name, path); mkdirSync(resolve(dest, ".."), { recursive: true });
      cpSync(resolve(packageRoot, path), dest, { recursive: true, errorOnExist: true, force: false });
    }
    dependencies.push({ name, version: info.version, npmIntegrity: locked.integrity });
  }
  cpSync(fileURLToPath(new URL("./world-analysis-handoff-consumer.mjs", import.meta.url)), resolve(target, "verify.mjs"));
  writeFileSync(resolve(target, "README.md"), "# World Analysis Consumer Candidate\n\nRun `node verify.mjs` with Node.js 22 or newer. No installation or network is required.\n\nThe `public/` directory contains the byte-identical frozen schemas, TypeScript types, validator, OpenAPI, limits, semantics and complete examples. Read `public/README.md` and `public/SEMANTICS.md` for negotiation, selection, cancellation and action non-authorization. `node_modules/` contains only the explicitly listed validator runtime dependencies and licenses.\n\nThis is an offline contract candidate, not evidence of live SACS, Gateway, database or provider integration. W06 and final release gates remain separate.\n");
  const files = Object.fromEntries(filesUnder(target).map(path => [relative(target, path).split(sep).join("/"), hash(readFileSync(path))]).sort(([a], [b]) => a < b ? -1 : 1));
  const manifest = { schemaVersion: "1.0", contractVersion: release.contractVersion, resultProfile: release.resultProfile,
    status: "UNDISTRIBUTED_CANDIDATE", frozenReleaseLockSha256: hash(releaseBytes), dependencies, files };
  writeFileSync(resolve(target, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--report")) throw new Error("Only --report is supported; no publication supported.");
  const startedAt = new Date().toISOString();
  const verify = async directory => (await import(pathToFileURL(resolve(directory, "verify.mjs")).href)).verifyHandoff(directory);
  const directory = mkdtempSync(resolve(tmpdir(), "wsgs-handoff-"));
  try {
    buildHandoff(directory);
    const result = await verify(directory);
    const negativeCases = [];
    for (const name of ["missing-dependency", "tampered-file", "wrong-profile", "rewritten-freeze-lock"]) {
      const damaged = mkdtempSync(resolve(tmpdir(), "wsgs-handoff-negative-"));
      try {
        cpSync(directory, damaged, { recursive: true });
        const manifestPath = resolve(damaged, "manifest.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (name === "missing-dependency") rmSync(resolve(damaged, "node_modules/ajv"), { recursive: true });
        if (name === "tampered-file") writeFileSync(resolve(damaged, "public/validator.mjs"), "throw new Error('tampered');\n");
        if (name === "wrong-profile") manifest.resultProfile = "sacs-wsgs-geospatial-findings/1.0";
        if (name === "rewritten-freeze-lock") {
          const path = "public/contract-release-lock.json";
          const bytes = JSON.stringify({ artifacts: {} });
          writeFileSync(resolve(damaged, path), bytes); manifest.files[path] = hash(bytes);
        }
        writeFileSync(manifestPath, JSON.stringify(manifest));
        let rejection;
        try { await verify(damaged); } catch (error) { rejection = error.message; }
        const expected = { "missing-dependency": "HANDOFF_FILE_SET_MISMATCH", "tampered-file": "HANDOFF_CHECKSUM_MISMATCH:",
          "wrong-profile": "HANDOFF_PROFILE_MISMATCH", "rewritten-freeze-lock": "HANDOFF_FREEZE_LOCK_DRIFT" }[name];
        if (!rejection?.startsWith(expected)) throw new Error(`HANDOFF_NEGATIVE_DID_NOT_FAIL_AS_EXPECTED:${name}:${rejection}`);
        negativeCases.push({ name, status: "PASS", rejection });
      } finally { rmSync(damaged, { recursive: true, force: true }); }
    }
    const report = { ...result, negativeCases, qualification: "PREPARATION_ONLY_W06_GATE_REMAINS_OPEN",
      startedAt, finishedAt: new Date().toISOString(), command: "node validation/scripts/build-world-analysis-handoff.mjs --report",
      isolation: "Disposable directory outside repository; verifier and public validator imported from copied package in the same Node process. No subprocess or HTTP.",
      sourceFiles: Object.fromEntries(["build-world-analysis-handoff.mjs", "world-analysis-handoff-consumer.mjs"].map(name =>
        [`validation/scripts/${name}`, hash(readFileSync(fileURLToPath(new URL(name, import.meta.url))))])),
      manifestSha256: hash(readFileSync(resolve(directory, "manifest.json"))),
      publication: "NOT_PERFORMED", completeW07Gate: false };
    const bytes = JSON.stringify(report, null, 2) + "\n";
    if (process.argv[2] === "--report") {
      const output = resolve(root, "reports/wsgs-v0.2.4-stable-world-analysis-service/W07"); mkdirSync(output, { recursive: true });
      writeFileSync(resolve(output, "handoff-preparation.json"), bytes);
    }
    console.log(bytes);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
