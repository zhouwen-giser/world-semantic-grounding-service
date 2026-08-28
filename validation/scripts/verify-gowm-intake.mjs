import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const isWindows = process.platform === "win32";
const executable = isWindows ? (process.env["ComSpec"] ?? "cmd.exe") : "npm";
const argumentsList = isWindows
  ? ["/d", "/s", "/c", "npm.cmd exec -- tsx validation/scripts/verify-gowm-intake.ts"]
  : ["exec", "--", "tsx", "validation/scripts/verify-gowm-intake.ts"];
const result = spawnSync(executable, argumentsList, { cwd: repositoryRoot, stdio: "inherit" });

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
