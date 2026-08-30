import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compile, compileFromFile } from "json-schema-to-typescript";

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
  },
  {
    schemaRoot: join(root, "contracts", "wsgs-v0.2-gdps", "contracts"),
    outputRoot: join(root, "packages", "contracts", "src", "generated-internal-v02", "gdps"),
    bannerComment: "/* Generated from the locked WSGS v0.2 GDPS JSON Schemas. Do not edit directly. */",
    targets: [
      "acceptance-evidence-map",
      "descriptor-resolution",
      "gdps-consumer-snapshot-extension",
      "gdps-handoff-intake",
      "gdps-source-evidence",
      "gdps-status-normalization",
      "geospatial-product-intent",
      "grounded-geospatial-product-intent",
      "locked-gdps-recipe"
    ]
  }
];

let generatedFileCount = 0;
for (const generation of generations) {
  mkdirSync(generation.outputRoot, { recursive: true });
  for (const target of generation.targets) {
    const source = join(generation.schemaRoot, `${target}.schema.json`);
    const destination = join(generation.outputRoot, `${target}.ts`);
    const options = {
      cwd: generation.schemaRoot,
      bannerComment: generation.bannerComment,
      additionalProperties: false,
      declareExternallyReferenced: true,
      enableConstEnums: false,
      format: true,
      ignoreMinAndMaxItems: true,
      strictIndexSignatures: true,
      unknownAny: true
    };
    // The frozen task contract intentionally identifies its referenced schema
    // by URN. json-schema-to-typescript's file resolver treats that URN as a
    // filesystem path on Windows, so translate only the in-memory generation
    // copy to the colocated schema file while preserving the locked source.
    const generated = target === "descriptor-resolution"
      ? await compile({
          ...JSON.parse(readFileSync(source, "utf8")),
          properties: {
            ...JSON.parse(readFileSync(source, "utf8")).properties,
            intent: { $ref: "grounded-geospatial-product-intent.schema.json" }
          }
        }, "DescriptorResolution", options)
      : await compileFromFile(source, options);
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
