import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const roots = ["contracts/wsgs-v0.1", "contracts/wsgs-v0.2.1-sacs-geospatial"];
const directory = "reports/wsgs-v0.2.4-stable-world-analysis-service/W00";
const target = `${directory}/legacy-contract-hashes.json`;
const sha256 = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
function walk(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = `${root}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error("Legacy contracts cannot contain symlinks");
    return entry.isDirectory() ? walk(path) : [path];
  }).sort();
}
const files = Object.fromEntries(roots.flatMap(walk).map(path => [path, sha256(readFileSync(path))]));
if (process.argv.includes("--capture")) {
  if (existsSync(target)) throw new Error("Legacy baseline already captured; refusing to replace it");
  mkdirSync(directory, { recursive: true });
  writeFileSync(target, JSON.stringify({ schemaVersion: "1.0", algorithm: "SHA256_EXACT_UTF8_FILE_BYTES",
    baselineCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), roots, files
  }, null, 2) + "\n");
} else {
  const baseline = JSON.parse(readFileSync(target, "utf8"));
  if (JSON.stringify(baseline.files) !== JSON.stringify(files)) throw new Error("LEGACY_CONTRACT_BYTES_CHANGED");
}
console.log(JSON.stringify({ status: "PASS", mode: process.argv.includes("--capture") ? "CAPTURE" : "VERIFY", files: Object.keys(files).length, manifest: target }));
