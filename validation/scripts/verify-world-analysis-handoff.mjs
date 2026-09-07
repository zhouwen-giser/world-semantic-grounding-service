import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildHandoff } from "./build-world-analysis-handoff.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const target = resolve(root, "contracts/consumers/sacs-world-analysis-v1");
const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
if (process.argv.slice(2).some(arg => arg !== "--write") || process.argv.length > 3) throw new Error("Only --write is supported");
const temporary = mkdtempSync(resolve(tmpdir(), "wsgs-handoff-final-"));
function run(directory) {
  const result = spawnSync(process.execPath, ["--permission", `--allow-fs-read=${directory}`, resolve(directory, "verify.mjs")], {
    cwd: directory, env: { PATH: dirname(process.execPath), HOME: directory, NODE_PATH: "", NODE_OPTIONS: "" },
    encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024
  });
  if (result.error) throw result.error;
  return { exitCode: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
}
try {
  const candidate = resolve(temporary, "candidate"); buildHandoff(candidate);
  if (process.argv.includes("--write")) {
    if (existsSync(target)) throw new Error("HANDOFF_TARGET_EXISTS: refusing to overwrite");
    cpSync(candidate, target, { recursive: true, errorOnExist: true, force: false });
  }
  const manifestBytes = readFileSync(resolve(target, "manifest.json"));
  if (!manifestBytes.equals(readFileSync(resolve(candidate, "manifest.json")))) throw new Error("HANDOFF_REBUILD_MISMATCH");
  const isolated = resolve(temporary, "isolated"); cpSync(target, isolated, { recursive: true });
  const positive = run(isolated);
  if (positive.exitCode !== 0) throw new Error(`HANDOFF_CHILD_FAILED:${positive.stderr}`);
  const result = JSON.parse(positive.stdout);
  const negativeCases = [];
  for (const [name, expected] of Object.entries({
    "missing-dependency": "HANDOFF_FILE_SET_MISMATCH", "tampered-file": "HANDOFF_CHECKSUM_MISMATCH",
    "wrong-profile": "HANDOFF_PROFILE_MISMATCH", "rewritten-freeze-lock": "HANDOFF_FREEZE_LOCK_DRIFT"
  })) {
    const damaged = resolve(temporary, name); cpSync(target, damaged, { recursive: true });
    const manifestPath = resolve(damaged, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (name === "missing-dependency") rmSync(resolve(damaged, "node_modules/ajv"), { recursive: true });
    if (name === "tampered-file") writeFileSync(resolve(damaged, "public/validator.mjs"), "throw new Error('tampered');\n");
    if (name === "wrong-profile") manifest.resultProfile = "wrong-profile";
    if (name === "rewritten-freeze-lock") {
      const path = "public/contract-release-lock.json", bytes = JSON.stringify({ artifacts: {} });
      writeFileSync(resolve(damaged, path), bytes); manifest.files[path] = hash(bytes);
    }
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const child = run(damaged);
    if (child.exitCode === 0 || child.signal || !child.stderr.includes(expected)) throw new Error(`HANDOFF_NEGATIVE_FAILED:${name}:${child.stderr}`);
    negativeCases.push({ name, expected, status: "PASS", ...child });
  }
  console.log(JSON.stringify({ status: "PASS", scope: "OFFLINE_PUBLIC_HANDOFF_ONLY", target,
    manifestSha256: hash(manifestBytes), reproducible: true,
    isolation: "Fresh Node process per case, outside repository, sanitized environment, filesystem reads restricted to copied bundle; no WSGS runtime imports. Not a network sandbox or live integration.",
    result, positive, negativeCases }, null, 2));
} finally { rmSync(temporary, { recursive: true, force: true }); }
