import { createHash } from "node:crypto";

import type { ErrorObject, ValidateFunction } from "ajv";
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

import {
  gdpsV021FindingContractClosure,
  gdpsV021OutputSchemaDependencies
} from "./gdps-v021-finding-contract.generated.js";

export type GdpsContractDigest = `sha256:${string}`;

export interface GdpsOutputSchemaIssue {
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly keyword: string;
  readonly message: string;
}

export class GdpsOutputSchemaError extends Error {
  constructor(
    readonly code: string,
    readonly operationKey?: string,
    readonly issues: readonly GdpsOutputSchemaIssue[] = []
  ) {
    super(`GDPS output schema validation failed: ${code}${operationKey ? ` (${operationKey})` : ""}`);
    this.name = "GdpsOutputSchemaError";
  }
}

interface LockedOperation {
  readonly operationId: string;
  readonly operationVersion: string;
  readonly outputSchemaUri: string;
  readonly outputSchemaHash: string;
}

interface LockedSchema {
  readonly schemaUri: string;
  readonly schemaHash: string;
  readonly sourcePath: string;
  readonly document: Readonly<Record<string, unknown>>;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function canonicalHash(value: unknown): GdpsContractDigest {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function operationKey(operationId: string, operationVersion: string): string {
  return `${operationId}@${operationVersion}`;
}

function issue(error: ErrorObject): GdpsOutputSchemaIssue {
  return {
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? "schema constraint failed"
  };
}

/**
 * Exact FINAL_B GDPS output-schema registry. It validates values only; it does
 * not mint a result-validation marker or an operation authority.
 */
export class GdpsV021OutputSchemaRegistry {
  readonly #operations = new Map<string, LockedOperation>();
  readonly #validators = new Map<string, ValidateFunction>();

  constructor() {
    const { closureHash, ...body } = gdpsV021FindingContractClosure;
    if (canonicalHash(body) !== closureHash) {
      throw new GdpsOutputSchemaError("GDPS_FINDING_CONTRACT_CLOSURE_DRIFT");
    }
    const { closureHash: dependencyHash, ...dependencyBody } = gdpsV021OutputSchemaDependencies;
    if (canonicalHash(dependencyBody) !== dependencyHash) {
      throw new GdpsOutputSchemaError("GDPS_OUTPUT_SCHEMA_DEPENDENCY_CLOSURE_DRIFT");
    }
    if (gdpsV021FindingContractClosure.operations.length !== 30
      || gdpsV021FindingContractClosure.outputSchemas.length !== 30) {
      throw new GdpsOutputSchemaError("GDPS_OUTPUT_SCHEMA_OPERATION_COUNT_MISMATCH");
    }

    const ajv = new Ajv2020Module.default({
      allErrors: true,
      strict: true,
      strictRequired: false,
      allowUnionTypes: true
    });
    addFormatsModule.default(ajv);
    ajv.addKeyword({ keyword: "x-gdps-generated-from", schemaType: "string" });
    const schemas: readonly LockedSchema[] = [
      ...gdpsV021FindingContractClosure.outputSchemas,
      ...gdpsV021OutputSchemaDependencies.schemas
    ];
    const schemaUris = new Set<string>();
    for (const schema of schemas) {
      if (schema.document["$id"] !== schema.schemaUri || canonicalHash(schema.document) !== schema.schemaHash) {
        throw new GdpsOutputSchemaError("GDPS_OUTPUT_SCHEMA_DOCUMENT_DRIFT");
      }
      if (schemaUris.has(schema.schemaUri)) {
        throw new GdpsOutputSchemaError("GDPS_OUTPUT_SCHEMA_URI_DUPLICATE");
      }
      schemaUris.add(schema.schemaUri);
      ajv.addSchema(schema.document, schema.schemaUri);
    }

    for (const operation of gdpsV021FindingContractClosure.operations) {
      const key = operationKey(operation.operationId, operation.operationVersion);
      if (this.#operations.has(key)) {
        throw new GdpsOutputSchemaError("GDPS_OUTPUT_SCHEMA_OPERATION_DUPLICATE", key);
      }
      const root = gdpsV021FindingContractClosure.outputSchemas.find(
        (schema) => schema.schemaUri === operation.outputSchemaUri
      );
      if (root === undefined || root.schemaHash !== operation.outputSchemaHash) {
        throw new GdpsOutputSchemaError("GDPS_OUTPUT_SCHEMA_OPERATION_LOCK_DRIFT", key);
      }
      const validator = ajv.getSchema(operation.outputSchemaUri);
      if (validator === undefined) {
        throw new GdpsOutputSchemaError("GDPS_OUTPUT_SCHEMA_COMPILE_FAILED", key);
      }
      this.#operations.set(key, operation);
      this.#validators.set(key, validator);
    }
  }

  get operationCount(): number {
    return this.#operations.size;
  }

  validateOutput(
    operationId: string,
    operationVersion: string,
    schemaUri: string,
    schemaHash: GdpsContractDigest,
    value: unknown
  ): void {
    const key = operationKey(operationId, operationVersion);
    const operation = this.#operations.get(key);
    if (operation === undefined) throw new GdpsOutputSchemaError("GDPS_OPERATION_NOT_LOCKED", key);
    if (schemaUri !== operation.outputSchemaUri || schemaHash !== operation.outputSchemaHash) {
      throw new GdpsOutputSchemaError("GDPS_OUTPUT_SCHEMA_LOCK_MISMATCH", key);
    }
    const validator = this.#validators.get(key);
    if (validator === undefined) throw new GdpsOutputSchemaError("GDPS_OUTPUT_SCHEMA_VALIDATOR_MISSING", key);
    if (!validator(value)) {
      throw new GdpsOutputSchemaError(
        "GDPS_OUTPUT_VALUE_SCHEMA_MISMATCH",
        key,
        (validator.errors ?? []).map(issue)
      );
    }
  }
}

let defaultRegistry: GdpsV021OutputSchemaRegistry | undefined;

export function defaultGdpsV021OutputSchemaRegistry(): GdpsV021OutputSchemaRegistry {
  defaultRegistry ??= new GdpsV021OutputSchemaRegistry();
  return defaultRegistry;
}
