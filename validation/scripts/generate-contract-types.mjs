import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compileFromFile } from "json-schema-to-typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const check = process.argv.includes("--check");
const generations = [
  {
    schemaRoot: join(root, "contracts", "wsgs-v0.1", "contracts"),
    outputRoot: join(root, "packages", "contracts", "src", "generated"),
    bannerComment: "/* Generated from the frozen WSGS JSON Schemas. Do not edit directly. */",
    targets: [
      "grounding-request",
      "grounding-result",
      "grounding-job",
      "capabilities-response",
      "world-semantic-frame",
      "grounding-graph"
    ]
  },
  {
    schemaRoot: join(root, "contracts", "wsgs-v0.2-internal", "contracts"),
    outputRoot: join(root, "packages", "contracts", "src", "generated-internal-v02"),
    bannerComment: "/* Generated from the locked WSGS v0.2 internal JSON Schemas. Do not edit directly. */",
    targets: [
      "capability-binding",
      "contract-intake-report",
      "delegated-gowm-request-context",
      "gowm-consumer-intake-lock",
      "gowm-execution-record",
      "model-policy",
      "pipeline-event",
      "qualification-report",
      "recipe-catalog",
      "runtime-readiness",
      "trusted-capability-snapshot",
      "world-query-requirement-graph"
    ]
  }
];

let generatedFileCount = 0;
for (const generation of generations) {
  mkdirSync(generation.outputRoot, { recursive: true });
  for (const target of generation.targets) {
    const source = join(generation.schemaRoot, `${target}.schema.json`);
    const destination = join(generation.outputRoot, `${target}.ts`);
    const generated = await compileFromFile(source, {
      cwd: generation.schemaRoot,
      bannerComment: generation.bannerComment,
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
    generatedFileCount += 1;
  }
}

console.log(`WSGS_CONTRACT_TYPES_${check ? "CHECK" : "GENERATE"}_PASS files=${generatedFileCount}`);
