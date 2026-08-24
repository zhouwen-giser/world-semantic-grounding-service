import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ErrorObject } from "ajv";
import type { WorldSemanticFrame } from "@wsgs/contracts";
import type { WorldSemanticFrameValidator } from "./types.js";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneAndInline(value: unknown, commonDefinitions: JsonObject): unknown {
  if (Array.isArray(value)) return value.map((entry) => cloneAndInline(entry, commonDefinitions));
  if (!isObject(value)) return value;
  const reference = value["$ref"];
  if (typeof reference === "string" && reference.startsWith("common.schema.json#/$defs/")) {
    const name = reference.slice("common.schema.json#/$defs/".length);
    const definition = commonDefinitions[name];
    if (definition === undefined) throw new Error(`Missing common schema definition: ${name}`);
    return cloneAndInline(definition, commonDefinitions);
  }
  const result: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$schema" || key === "$id") continue;
    result[key] = cloneAndInline(entry, commonDefinitions);
  }
  return result;
}

export function bundleWorldSemanticFrameSchema(frameSchema: unknown, commonSchema: unknown): JsonObject {
  if (!isObject(frameSchema) || !isObject(commonSchema) || !isObject(commonSchema["$defs"])) {
    throw new Error("WorldSemanticFrame and common schemas must be JSON objects");
  }
  const bundled = cloneAndInline(frameSchema, commonSchema["$defs"]);
  if (!isObject(bundled)) throw new Error("Bundled WorldSemanticFrame schema is invalid");
  return bundled;
}

function strictTransportValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strictTransportValue);
  if (!isObject(value)) return value;
  const result: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) result[key] = strictTransportValue(entry);
  if (result["type"] === "object" && isObject(result["properties"])) {
    const properties = result["properties"];
    const originallyRequired = new Set(
      Array.isArray(result["required"]) ? result["required"].filter((entry): entry is string => typeof entry === "string") : []
    );
    for (const [key, property] of Object.entries(properties)) {
      if (!originallyRequired.has(key)) properties[key] = { anyOf: [property, { type: "null" }] };
    }
    result["required"] = Object.keys(properties);
  }
  return result;
}

export function makeOpenAIStrictTransportSchema(schema: JsonObject): JsonObject {
  const strict = strictTransportValue(schema);
  if (!isObject(strict)) throw new Error("Strict transport schema is invalid");
  return strict;
}

export function removeOptionalNulls(value: unknown, schema: unknown): unknown {
  if (!isObject(schema)) return value;
  if (Array.isArray(value)) {
    const itemSchema = schema["items"];
    return value.map((entry) => removeOptionalNulls(entry, itemSchema));
  }
  if (!isObject(value) || schema["type"] !== "object" || !isObject(schema["properties"])) return value;
  const required = new Set(
    Array.isArray(schema["required"]) ? schema["required"].filter((entry): entry is string => typeof entry === "string") : []
  );
  const result: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null && !required.has(key)) continue;
    result[key] = removeOptionalNulls(entry, schema["properties"][key]);
  }
  return result;
}

export interface CompiledWorldSemanticFrameSchema {
  schema: JsonObject;
  validate: WorldSemanticFrameValidator;
  errors: () => ErrorObject[] | null | undefined;
}

export function compileWorldSemanticFrameSchema(
  frameSchema: unknown,
  commonSchema: unknown
): CompiledWorldSemanticFrameSchema {
  const schema = bundleWorldSemanticFrameSchema(frameSchema, commonSchema);
  const ajv = new Ajv2020Module.default({ allErrors: true, strict: true });
  addFormatsModule.default(ajv);
  const compiled = ajv.compile<WorldSemanticFrame>(schema);
  return {
    schema,
    validate: (value: unknown): value is WorldSemanticFrame => compiled(value),
    errors: () => compiled.errors
  };
}
