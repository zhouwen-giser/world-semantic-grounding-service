import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compileFromFile } from "json-schema-to-typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const schemaRoot = join(root, "contracts", "wsgs-v0.1", "contracts");
const outputRoot = join(root, "packages", "contracts", "src", "generated");
const check = process.argv.includes("--check");
const targets = [
  "grounding-request",
  "grounding-result",
  "grounding-job",
  "capabilities-response",
  "world-semantic-frame",
  "grounding-graph"
];

mkdirSync(outputRoot, { recursive: true });
for (const target of targets) {
  const source = join(schemaRoot, `${target}.schema.json`);
  const destination = join(outputRoot, `${target}.ts`);
  const generated = await compileFromFile(source, {
    cwd: schemaRoot,
    bannerComment: "/* Generated from the frozen WSGS JSON Schemas. Do not edit directly. */",
    additionalProperties: false,
    declareExternallyReferenced: true,
    enableConstEnums: false,
    format: true,
    ignoreMinAndMaxItems: true,
    strictIndexSignatures: true,
    unknownAny: true
  });
  const canonical = generated.replaceAll("\r\n", "\n");
  if (check) {
    if (!existsSync(destination) || readFileSync(destination, "utf8").replaceAll("\r\n", "\n") !== canonical) {
      throw new Error(`Generated contract type is stale: ${target}`);
    }
  } else {
    writeFileSync(destination, canonical, "utf8");
  }
}

console.log(`WSGS_CONTRACT_TYPES_${check ? "CHECK" : "GENERATE"}_PASS files=${targets.length}`);
