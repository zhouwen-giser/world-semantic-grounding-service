import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";

export type GowmConsumerSchemaPath =
  | "gowm-v0.6.2/capability-semantic-catalog-v1.schema.json"
  | "gowm-v0.6.2/capability-semantic-profile-v1.schema.json"
  | "gowm-v0.6.3/delegated-identity-claims.schema.json"
  | "gowm-v0.6.3/operation-availability-list.schema.json"
  | "gowm-v0.6.3/operation-availability.schema.json"
  | "platform/capability-descriptor.schema.json"
  | "platform/capability-list-response.schema.json"
  | "platform/capability-result-envelope.schema.json"
  | "platform/capability-versions-response.schema.json"
  | "platform/execution-receipt.schema.json"
  | "platform/gateway-execute-request.schema.json"
  | "platform/job-record.schema.json"
  | "platform/world-query-result.schema.json"
  | "platform/world-query-submission.schema.json";

export interface GowmSchemaIssue {
  instancePath: string;
  keyword: string;
  schemaPath: string;
  message: string;
}

export class GowmSchemaValidationError extends Error {
  readonly code = "GOWM_CONSUMER_SCHEMA_MISMATCH";

  constructor(
    readonly schemaPath: GowmConsumerSchemaPath,
    readonly issues: readonly GowmSchemaIssue[]
  ) {
    super(`GOWM consumer schema validation failed for ${schemaPath}`);
    this.name = "GowmSchemaValidationError";
  }
}

export interface GowmSchemaRegistryOptions {
  schemaRoot?: string;
}

function listJsonSchemas(root: string): string[] {
  const visit = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) return visit(entryPath);
      return entry.isFile() && entry.name.endsWith(".json") ? [entryPath] : [];
    });
  return visit(root).sort((left, right) => left.localeCompare(right));
}

function portableRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function issue(error: ErrorObject): GowmSchemaIssue {
  return {
    instancePath: error.instancePath,
    keyword: error.keyword,
    schemaPath: error.schemaPath,
    message: error.message ?? "schema constraint failed"
  };
}

export class GowmConsumerSchemaRegistry {
  readonly #validators = new Map<string, ValidateFunction>();
  readonly #schemaUris = new Map<string, string>();
  readonly #ajv: InstanceType<typeof Ajv2020Module.default>;

  constructor(options: GowmSchemaRegistryOptions = {}) {
    const schemaRoot = options.schemaRoot ?? fileURLToPath(
      new URL("../../../contracts/upstream/gowm-0.6.3/extracted/package/bundle/schemas/", import.meta.url)
    );
    this.#ajv = new Ajv2020Module.default({ allErrors: true, strict: true, strictRequired: false });
    addFormatsModule.default(this.#ajv);
    for (const filePath of listJsonSchemas(schemaRoot)) {
      const relativePath = portableRelative(schemaRoot, filePath);
      const schemaUri = pathToFileURL(filePath).href;
      const schema = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
      schema["$id"] = schemaUri;
      this.#schemaUris.set(relativePath, schemaUri);
      this.#ajv.addSchema(schema, schemaUri);
    }
  }

  validate(schemaPath: GowmConsumerSchemaPath, value: unknown): void {
    const schemaUri = this.#schemaUris.get(schemaPath);
    if (!schemaUri) throw new Error(`GOWM consumer schema is not present: ${schemaPath}`);
    let validator = this.#validators.get(schemaUri);
    if (!validator) {
      validator = this.#ajv.getSchema(schemaUri);
      if (!validator) throw new Error(`GOWM consumer schema could not be compiled: ${schemaPath}`);
      this.#validators.set(schemaUri, validator);
    }
    if (!validator(value)) {
      throw new GowmSchemaValidationError(schemaPath, (validator.errors ?? []).map(issue));
    }
  }
}

let defaultRegistry: GowmConsumerSchemaRegistry | undefined;

export function defaultGowmConsumerSchemaRegistry(): GowmConsumerSchemaRegistry {
  defaultRegistry ??= new GowmConsumerSchemaRegistry();
  return defaultRegistry;
}
