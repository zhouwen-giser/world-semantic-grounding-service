import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  },
  {
    schemaRoot: join(root, "contracts", "wsgs-v0.2.1-sacs-geospatial"),
    outputRoot: join(root, "packages", "contracts", "src", "generated-sacs-geospatial"),
    bannerComment: "/* Generated from the authoritative WSGS v0.2.1 SACS geospatial JSON Schemas. Do not edit directly. */",
    resolveWsgsUrns: true,
    targets: [
      "capabilities-response-v1.1",
      "geospatial-findings",
      "grounding-result-extension",
      "source-currentness-request",
      "source-currentness-result",
      "source-product",
      "structured-selection-request",
      "structured-selection-result",
      "typed-gap",
      "world-finding"
    ]
  }
];

const sacsGeospatialGeneration = generations.at(-1);
if (!sacsGeospatialGeneration) throw new Error("SACS geospatial generation is not configured");
const sacsGeospatialSchemaDocumentsDestination = join(
  sacsGeospatialGeneration.outputRoot,
  "schema-documents.ts"
);

function jsonSchemaFiles(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".schema.json"))
    .sort((left, right) => left.localeCompare(right));
}

function embeddedDocumentsSource(targetSchemaRoot, dependencySchemaRoot) {
  const readDocuments = (schemaRoot, names) => names.map((name) => ({
    name,
    schema: JSON.parse(readFileSync(join(schemaRoot, name), "utf8"))
  }));
  const targets = readDocuments(
    targetSchemaRoot,
    sacsGeospatialGeneration.targets.map((target) => `${target}.schema.json`)
  );
  const dependencies = readDocuments(dependencySchemaRoot, jsonSchemaFiles(dependencySchemaRoot));
  return [
    "/* Generated from authoritative WSGS JSON Schemas. Do not edit directly. */",
    "",
    "export interface EmbeddedJsonSchemaDocument {",
    "  readonly name: string;",
    "  readonly schema: Record<string, unknown>;",
    "}",
    "",
    "export const sacsGeospatialSchemaDocuments: readonly EmbeddedJsonSchemaDocument[] =",
    `${JSON.stringify(targets, null, 2)};`,
    "",
    "export const sacsGeospatialDependencySchemaDocuments: readonly EmbeddedJsonSchemaDocument[] =",
    `${JSON.stringify(dependencies, null, 2)};`,
    ""
  ].join("\n");
}

function schemaResolverRecords() {
  const records = new Map();
  for (const schemaRoot of [
    join(root, "contracts", "wsgs-v0.1", "contracts"),
    sacsGeospatialGeneration.schemaRoot
  ]) {
    const documents = jsonSchemaFiles(schemaRoot).map((name) => ({
      name,
      schema: JSON.parse(readFileSync(join(schemaRoot, name), "utf8"))
    }));
    const idsByName = new Map(documents.map(({ name, schema }) => [name, schema.$id]));
    for (const { schema } of documents) {
      if (typeof schema.$id === "string") records.set(schema.$id, { schema, idsByName });
    }
  }
  return records;
}

function rewriteRelativeSchemaReferences(value, idsByName) {
  if (Array.isArray(value)) return value.map((item) => rewriteRelativeSchemaReferences(item, idsByName));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key === "$ref" && typeof item === "string" && !item.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/i.test(item)) {
      const [name, fragment] = item.split("#", 2);
      const id = idsByName.get(name);
      if (typeof id === "string") return [key, `${id}${fragment === undefined ? "" : `#${fragment}`}`];
    }
    return [key, rewriteRelativeSchemaReferences(item, idsByName)];
  }));
}

const wsgsSchemasById = schemaResolverRecords();
const wsgsUrnResolver = {
  order: 1,
  canRead: /^urn:wsgs:/,
  read(file) {
    const id = file.url.split("#", 1)[0];
    const record = wsgsSchemasById.get(id);
    if (!record) throw new Error(`Unknown WSGS schema URN: ${id}`);
    return JSON.stringify(rewriteRelativeSchemaReferences(record.schema, record.idsByName));
  }
};

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
    if (generation.resolveWsgsUrns) {
      options.$refOptions = { resolve: { wsgsUrn: wsgsUrnResolver } };
    }
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

const embeddedDocuments = embeddedDocumentsSource(
  sacsGeospatialGeneration.schemaRoot,
  join(root, "contracts", "wsgs-v0.1", "contracts")
).replaceAll("\r\n", "\n");
if (check) {
  if (
    !existsSync(sacsGeospatialSchemaDocumentsDestination) ||
    readFileSync(sacsGeospatialSchemaDocumentsDestination, "utf8").replaceAll("\r\n", "\n") !== embeddedDocuments
  ) {
    throw new Error("Generated SACS geospatial schema documents are stale");
  }
} else {
  writeFileSync(sacsGeospatialSchemaDocumentsDestination, embeddedDocuments, "utf8");
}

console.log(
  `WSGS_CONTRACT_TYPES_${check ? "CHECK" : "GENERATE"}_PASS files=${generatedFileCount} embeddedSchemaDocuments=1`
);
