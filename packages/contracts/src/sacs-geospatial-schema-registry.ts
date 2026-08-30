import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";

import {
  sacsGeospatialDependencySchemaDocuments,
  sacsGeospatialSchemaDocuments,
  type EmbeddedJsonSchemaDocument
} from "./generated-sacs-geospatial/schema-documents.js";

export const SACS_GEOSPATIAL_SCHEMA_NAMES = [
  "capabilities-response-v1.1.schema.json",
  "geospatial-findings.schema.json",
  "grounding-result-extension.schema.json",
  "source-currentness-request.schema.json",
  "source-currentness-result.schema.json",
  "source-product.schema.json",
  "structured-selection-request.schema.json",
  "structured-selection-result.schema.json",
  "typed-gap.schema.json",
  "world-finding.schema.json"
] as const;

export type SacsGeospatialSchemaName = (typeof SACS_GEOSPATIAL_SCHEMA_NAMES)[number];

export interface SacsGeospatialSchemaIssue {
  instancePath: string;
  keyword: string;
  schemaPath: string;
  message: string;
}

export class SacsGeospatialSchemaValidationError extends Error {
  readonly code = "WSGS_SACS_GEOSPATIAL_SCHEMA_MISMATCH";

  constructor(
    readonly schemaName: SacsGeospatialSchemaName,
    readonly issues: readonly SacsGeospatialSchemaIssue[]
  ) {
    super(`SACS geospatial schema validation failed for ${schemaName}`);
    this.name = "SacsGeospatialSchemaValidationError";
  }
}

function schemaId(document: EmbeddedJsonSchemaDocument): string {
  const id = document.schema["$id"];
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`Authoritative JSON Schema has no $id: ${document.name}`);
  }
  return id;
}

function registryReferenceIds(): ReadonlyMap<string, string> {
  const entries: [string, string][] = [];
  for (const document of sacsGeospatialDependencySchemaDocuments) {
    const id = schemaId(document);
    entries.push([document.name, id], [`../wsgs-v0.1/contracts/${document.name}`, id]);
  }
  for (const document of sacsGeospatialSchemaDocuments) {
    entries.push([document.name, schemaId(document)]);
  }
  return new Map(entries);
}

function runtimeSchema(value: unknown, schemaIdsByName: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => runtimeSchema(item, schemaIdsByName));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (
      key === "$ref" &&
      typeof item === "string" &&
      !item.startsWith("#") &&
      !/^[a-z][a-z0-9+.-]*:/i.test(item)
    ) {
      const [name, fragment] = item.split("#", 2);
      const id = name === undefined ? undefined : schemaIdsByName.get(name);
      if (id !== undefined) return [key, `${id}${fragment === undefined ? "" : `#${fragment}`}`];
    }
    return [key, runtimeSchema(item, schemaIdsByName)];
  }));
}

function issue(error: ErrorObject): SacsGeospatialSchemaIssue {
  return {
    instancePath: error.instancePath,
    keyword: error.keyword,
    schemaPath: error.schemaPath,
    message: error.message ?? "schema constraint failed"
  };
}

/**
 * Runtime-path-independent registry for the authoritative SACS geospatial
 * contracts. All public schemas and their frozen v1.0 dependencies are
 * embedded by the deterministic contract generator and compiled eagerly.
 */
export class SacsGeospatialSchemaRegistry {
  readonly #validators = new Map<SacsGeospatialSchemaName, ValidateFunction>();

  constructor() {
    const ajv = new Ajv2020Module.default({ allErrors: true, strict: true, strictRequired: false });
    addFormatsModule.default(ajv);

    const referenceIds = registryReferenceIds();
    for (const document of sacsGeospatialDependencySchemaDocuments) {
      ajv.addSchema(
        runtimeSchema(document.schema, referenceIds) as Record<string, unknown>,
        schemaId(document)
      );
    }
    for (const document of sacsGeospatialSchemaDocuments) {
      ajv.addSchema(
        runtimeSchema(document.schema, referenceIds) as Record<string, unknown>,
        schemaId(document)
      );
    }

    const actualNames = new Set(sacsGeospatialSchemaDocuments.map(({ name }) => name));
    for (const name of SACS_GEOSPATIAL_SCHEMA_NAMES) {
      if (!actualNames.has(name)) {
        throw new Error(`Authoritative SACS geospatial schema is not embedded: ${name}`);
      }
      const document = sacsGeospatialSchemaDocuments.find((candidate) => candidate.name === name);
      if (!document) {
        throw new Error(`Authoritative SACS geospatial schema is not embedded: ${name}`);
      }
      const validator = ajv.getSchema(schemaId(document));
      if (!validator) {
        throw new Error(`Authoritative SACS geospatial schema could not be compiled: ${name}`);
      }
      this.#validators.set(name, validator);
    }
    if (actualNames.size !== SACS_GEOSPATIAL_SCHEMA_NAMES.length) {
      throw new Error("Authoritative SACS geospatial schema registry contains an unexpected schema");
    }
  }

  validate(schemaName: SacsGeospatialSchemaName, value: unknown): void {
    const validator = this.#validators.get(schemaName);
    if (!validator) {
      throw new Error(`Authoritative SACS geospatial schema is not registered: ${schemaName}`);
    }
    if (!validator(value)) {
      throw new SacsGeospatialSchemaValidationError(
        schemaName,
        (validator.errors ?? []).map(issue)
      );
    }
  }
}

let defaultRegistry: SacsGeospatialSchemaRegistry | undefined;

export function defaultSacsGeospatialSchemaRegistry(): SacsGeospatialSchemaRegistry {
  defaultRegistry ??= new SacsGeospatialSchemaRegistry();
  return defaultRegistry;
}
