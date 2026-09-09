import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";
import type { AnalysisProviderContracts } from "./analysis-provider-contracts.js";
import { currentGowmPath, currentGowmSchemaAlias } from "./current.js";

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
  analysisContracts?: AnalysisProviderContracts;
}

function listJsonSchemas(root: string): string[] {
  const visit = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) return visit(entryPath);
      return entry.isFile() && entry.name.endsWith(".schema.json") ? [entryPath] : [];
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
  readonly #current: boolean;
  readonly #validators = new Map<string, ValidateFunction>();
  readonly #schemaUris = new Map<string, string>();
  readonly #publishedPaths = new Map<string, string>();
  readonly #ajv: InstanceType<typeof Ajv2020Module.default>;

  constructor(options: GowmSchemaRegistryOptions = {}) {
    this.#current = options.schemaRoot === undefined;
    const schemaRoot = options.schemaRoot ?? currentGowmPath("bundle/schemas");
    this.#ajv = new Ajv2020Module.default({ allErrors: true, strict: true, strictRequired: false,
      strictTuples: false, strictTypes: false });
    addFormatsModule.default(this.#ajv);
    for (const filePath of listJsonSchemas(schemaRoot)) {
      const relativePath = portableRelative(schemaRoot, filePath);
      const schemaUri = pathToFileURL(filePath).href;
      // Only the opt-in registry accepts the schema from the hash-verified GSAP intake.
      // The frozen files and default registry retain their original validation behavior.
      const schema = !this.#current && options.analysisContracts && relativePath === "gowm-v0.6.2/capability-semantic-profile-v1.schema.json"
        ? options.analysisContracts.semanticProfileSchema()
        : !this.#current && options.analysisContracts && relativePath === "platform/capability-descriptor.schema.json"
          ? options.analysisContracts.capabilityDescriptorSchema()
        : !this.#current && options.analysisContracts && relativePath === "platform/data-snapshot-context.schema.json"
          ? options.analysisContracts.dataSnapshotSchema()
        : JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
      if (typeof schema["$id"] === "string") this.#publishedPaths.set(schema["$id"], relativePath);
      schema["$id"] = schemaUri;
      this.#schemaUris.set(relativePath, schemaUri);
      this.#ajv.addSchema(schema, schemaUri);
    }
    if (options.analysisContracts && !this.#current) {
      // The verified descriptor retains this original relative reference after relocation.
      const schemaUri = pathToFileURL(join(schemaRoot, "gowm-v0.7/capability-semantic-profile-v1.1.schema.json")).href;
      this.#ajv.addSchema({ ...options.analysisContracts.semanticProfileSchema(), $id: schemaUri }, schemaUri);
    }
  }

  validatePublished(schemaUri: string, value: unknown): void {
    const path = this.#publishedPaths.get(schemaUri);
    if (!path) throw new Error("GOWM_PUBLISHED_SCHEMA_MISSING");
    this.validate(path as GowmConsumerSchemaPath, value);
  }

  validate(schemaPath: GowmConsumerSchemaPath, value: unknown): void {
    const schemaUri = this.#schemaUris.get(this.#current ? currentGowmSchemaAlias(schemaPath) : schemaPath);
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
