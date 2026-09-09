import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = join(root, "contracts/wsgs-v0.2.4-world-analysis");
const destination = join(root, "packages/contracts/src/world-analysis");
const lock = JSON.parse(readFileSync(join(source, "contract-release-lock.json"), "utf8"));
const paths = ["validator.mjs", ...readdirSync(join(source, "generated")).map(name => `generated/${name}`)];
const check = process.argv.includes("--check");
// A colocated declaration shadows the JS input and prevents tsc from emitting it.
// Runtime types are provided by the package's typed facade instead.
if (!check && existsSync(join(destination, "validator.d.mts"))) rmSync(join(destination, "validator.d.mts"));
for (const path of paths) {
  const bytes = readFileSync(join(source, path));
  if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== lock.artifacts[path]) throw new Error(`Frozen source drift: ${path}`);
  const output = join(destination, path);
  if (check) {
    if (!existsSync(output) || !readFileSync(output).equals(bytes)) throw new Error(`Runtime mirror drift: ${path}`);
  } else {
    mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, bytes);
  }
}
console.log(`WORLD_ANALYSIS_RUNTIME_MIRROR_${check ? "CHECK" : "GENERATE"}_PASS files=${paths.length}`);
