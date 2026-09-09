import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [phase, name, ...command] = process.argv.slice(2);
if (!/^W0[0-7]$/.test(phase ?? "") || !/^[a-z][a-z0-9-]*$/.test(name ?? "") || command.length === 0) {
  throw new Error("Usage: run-world-analysis-evidence.mjs W00 name command [args...]");
}
const root = resolve("reports/wsgs-v0.2.4-stable-world-analysis-service", phase);
mkdirSync(root, { recursive: true });
const startedAt = new Date().toISOString();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const diff = execFileSync("git", ["diff", "HEAD", "--binary"], { maxBuffer: 32 * 1024 * 1024 });
const hash = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const chunks = [Buffer.from(`COMMAND ${JSON.stringify(command)}\nSTART ${startedAt}\nCOMMIT ${commit}\n`)];
const child = spawn(command[0], command.slice(1), { stdio: ["ignore", "pipe", "pipe"], env: process.env });
for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { chunks.push(chunk); process.stdout.write(chunk); });
child.on("error", error => { chunks.push(Buffer.from(`PROCESS_ERROR ${error.code ?? "UNKNOWN"}\n`)); });
child.on("close", (code, signal) => {
  const exitCode = code ?? 1;
  chunks.push(Buffer.from(`\nEXIT_CODE ${exitCode}\nSIGNAL ${signal ?? "NONE"}\n`));
  const bytes = Buffer.concat(chunks);
  writeFileSync(resolve(root, `${name}.log`), bytes);
  writeFileSync(resolve(root, `${name}.json`), JSON.stringify({ command: command.join(" "), startedAt,
    finishedAt: new Date().toISOString(), exitCode, signal, status: exitCode === 0 ? "PASS" : "FAIL",
    testedCommit: commit, trackedDiffSha256: hash(diff), trackedWorkingTreeDirty: diff.length > 0,
    logPath: `reports/wsgs-v0.2.4-stable-world-analysis-service/${phase}/${name}.log`, logSha256: hash(bytes)
  }, null, 2) + "\n");
  process.exitCode = exitCode;
});
