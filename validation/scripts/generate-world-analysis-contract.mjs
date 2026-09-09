import { readFileSync, readdirSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const directory = join(root, "contracts/wsgs-v0.2.4-world-analysis");
const check = process.argv.includes("--check");
const documents = [];
function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const next = join(path, entry.name);
    if (entry.isDirectory() && entry.name !== "generated") walk(next);
    else if (entry.isFile() && entry.name.endsWith(".schema.json")) {
      documents.push({ path: relative(directory, next).replaceAll("\\", "/"), schema: JSON.parse(readFileSync(next, "utf8")) });
    }
  }
}
walk(directory);
const byPath = new Map(documents.map(document => [document.path, document.schema.$id]));
const ids = new Set();
for (const document of documents) {
  if (!document.schema.$id || ids.has(document.schema.$id)) throw new Error(`Duplicate/missing schema identity: ${document.path}`);
  ids.add(document.schema.$id);
  function rewrite(value) {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (key === "$ref" && !child.startsWith("#") && !child.startsWith("urn:")) {
        const [path, fragment] = child.split("#");
        const target = relative(directory, resolve(directory, dirname(document.path), path)).replaceAll("\\", "/");
        const id = byPath.get(target);
        if (!id) throw new Error(`Non-local schema reference: ${document.path} -> ${child}`);
        return [key, `${id}${fragment === undefined ? "" : `#${fragment}`}`];
      }
      return [key, rewrite(child)];
    }));
  }
  document.schema = rewrite(document.schema);
}
const byId = new Map(documents.map(document => [document.schema.$id, document.schema]));
// The generator targets draft-07 syntax. Adapt only its in-memory input;
// the public validator continues to use the original draft-2020-12 documents.
function typeSchema(value) {
  if (Array.isArray(value)) return value.map(typeSchema);
  if (!value || typeof value !== "object") return value;
  if (value.allOf?.every(rule => rule.if?.properties?.status?.enum) && value.properties?.status?.enum) {
    const { allOf, ...base } = value;
    return { $id: base.$id, title: base.title, oneOf: base.properties.status.enum.map(status => {
      const branch = structuredClone(base);
      delete branch.$id;
      branch.title = `${base.title}${status}`;
      branch.properties.status = { const: status };
      for (const rule of allOf) if (rule.if.properties.status.enum.includes(status)) {
        branch.required = [...new Set([...branch.required, ...(rule.then.required ?? [])])];
        for (const [key, constraint] of Object.entries(rule.then.properties ?? {})) branch.properties[key] = { ...branch.properties[key], ...constraint };
        for (const key of rule.then.not?.required ?? []) delete branch.properties[key];
      }
      return typeSchema(branch);
    }) };
  }
  const output = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, typeSchema(child)]));
  if (value.prefixItems) {
    output.items = typeSchema(value.prefixItems);
    output.additionalItems = value.items ?? true;
    delete output.prefixItems;
  }
  return output;
}
function emit(path, text) {
  const destination = join(directory, "generated", path);
  if (check) {
    if (!existsSync(destination) || readFileSync(destination, "utf8") !== text) throw new Error(`Stale generated artifact: ${path}`);
  } else {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, text);
  }
}
emit("schema-documents.mjs", `// Generated from locked public schemas. Do not edit.\nexport const schemaDocuments = ${JSON.stringify(documents.map(document => document.schema), null, 2)};\n`);
let count = 0;
for (const { path, schema } of documents.filter(document => !document.path.includes("/"))) {
  if (path === "common.schema.json") continue;
  const generated = await compile(typeSchema(schema), schema.title.replaceAll(/[^A-Za-z0-9]/g, ""), {
    bannerComment: "/* Generated from public JSON Schema. Do not edit. */",
    additionalProperties: false, enableConstEnums: false, format: true,
    ignoreMinAndMaxItems: true, strictIndexSignatures: true, unknownAny: true,
    $refOptions: { resolve: { file: false, http: false, publicUrn: {
      order: 1, canRead: /^urn:wsgs:/,
      read(file) {
        const document = byId.get(file.url);
        if (!document) throw new Error(`Unresolved schema: ${file.url}`);
        return JSON.stringify(typeSchema(document));
      }
    } } }
  });
  emit(path.replace(".schema.json", ".ts"), generated.replaceAll("\r\n", "\n"));
  count++;
}
console.log(`WORLD_ANALYSIS_TYPES_${check ? "CHECK" : "GENERATE"}_PASS schemas=${documents.length} types=${count}`);
