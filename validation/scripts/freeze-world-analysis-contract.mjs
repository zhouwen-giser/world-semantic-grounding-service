import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const directory = join(root, "contracts/wsgs-v0.2.4-world-analysis");
const freezePath = join(directory, "contract-freeze.json");
if (process.argv.length !== 3 || process.argv[2] !== "--freeze") throw new Error("Explicit --freeze required");
if ([freezePath, join(directory, "contract-release-lock.json"), join(directory, "CHECKSUMS.sha256")].some(existsSync)) throw new Error("Refusing to overwrite frozen artifacts; withdraw explicitly or version the contract");
execFileSync(process.execPath, [join(root, "validation/scripts/verify-world-analysis-contract.mjs"), "--draft"], { cwd: root, stdio: "inherit" });
const sha = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const record = { schemaVersion: "1.0", status: "FROZEN_UNDISTRIBUTED_CANDIDATE", contractVersion: "sacs-wsgs-grounding/1.2", resultProfile: "wsgs-world-analysis-findings/1.0", phase: "W01", frozenAt: new Date().toISOString(), precedingCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), freezeCommitLocation: "reports/wsgs-v0.2.4-stable-world-analysis-service/W01/contract-freeze.json", runtimeImplementationStarted: false, validatedScope: "OFFLINE_PUBLIC_CONTRACT_ONLY", distributionRule: "No silent replacement. Explicitly withdraw undistributed candidate or publish a new version after handoff." };
writeFileSync(freezePath, `${JSON.stringify(record, null, 2)}\n`);
function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error("Symlink in frozen artifact set");
    return entry.isDirectory() ? walk(join(path, entry.name)) : [relative(directory, join(path, entry.name)).replaceAll("\\", "/")];
  });
}
const files = walk(directory).sort();
const artifacts = Object.fromEntries(files.map(path => [path, sha(readFileSync(join(directory, path)))]));
writeFileSync(join(directory, "contract-release-lock.json"), `${JSON.stringify({ schemaVersion: "1.0", contractVersion: record.contractVersion, resultProfile: record.resultProfile, artifactHashAlgorithm: "SHA-256_EXACT_BYTES", artifacts }, null, 2)}\n`);
writeFileSync(join(directory, "CHECKSUMS.sha256"), [...files, "contract-release-lock.json"].sort().map(path => `${sha(readFileSync(join(directory, path))).slice(7)}  ${path}\n`).join(""));
console.log(JSON.stringify({ status: "FROZEN_UNDISTRIBUTED_CANDIDATE", artifacts: files.length, releaseLockHash: sha(readFileSync(join(directory, "contract-release-lock.json"))) }));
