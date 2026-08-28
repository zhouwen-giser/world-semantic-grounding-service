import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

import type { ErrorObject, ValidateFunction } from "ajv";
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

const schemaDirectory = new URL("../../../contracts/wsgs-v0.1/contracts/", import.meta.url);
const contractLockUrl = new URL("../../../contracts/wsgs-v0.1/contract-lock.json", import.meta.url);
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

interface FrozenContractLock {
  lockVersion: "1.0";
  contractVersion: "sacs-wsgs-grounding/1.0";
  artifacts: Record<string, string>;
}

export class GroundingResultSchemaValidationError extends Error {
  readonly code = "GROUNDING_RESULT_SCHEMA_INVALID";
  readonly retryable = false;

  constructor(details: string) {
    super(`Worker result does not satisfy sacs-wsgs-grounding/1.0: ${details}`);
    this.name = "GroundingResultSchemaValidationError";
  }
}
function decodeCanonicalUtf8(bytes: Uint8Array, artifact: string): string {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new GroundingResultSchemaValidationError(`frozen artifact ${artifact} is not UTF-8`);
  }
  const canonical = decoded.replaceAll("\r\n", "\n");
  if (/\r/u.test(canonical)) {
    throw new GroundingResultSchemaValidationError(`frozen artifact ${artifact} has non-canonical line endings`);
  }
  return canonical;
}

function parseObject(text: string, artifact: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new GroundingResultSchemaValidationError(`frozen artifact ${artifact} is not a JSON object`);
  }
}

function readContractLock(): FrozenContractLock {
  const document = parseObject(
    decodeCanonicalUtf8(readFileSync(contractLockUrl), "contract-lock.json"),
    "contract-lock.json"
  );
  if (document["lockVersion"] !== "1.0" || document["contractVersion"] !== "sacs-wsgs-grounding/1.0") {
    throw new GroundingResultSchemaValidationError("frozen contract identity does not match sacs-wsgs-grounding/1.0");
  }
  const artifacts = document["artifacts"];
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) {
    throw new GroundingResultSchemaValidationError("frozen contract lock has no artifact map");
  }
  return document as unknown as FrozenContractLock;
}

function verifyLockedSchema(name: string, expected: string): Record<string, unknown> {
  if (!digestPattern.test(expected)) {
    throw new GroundingResultSchemaValidationError(`frozen schema ${name} has an invalid lock digest`);
  }
  const canonical = decodeCanonicalUtf8(readFileSync(new URL(name, schemaDirectory)), name);
  const actual = `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
  if (actual !== expected) {
    throw new GroundingResultSchemaValidationError(`frozen schema ${name} does not match contract-lock.json`);
  }
  return parseObject(canonical, name);
}

function compileFrozenGroundingResultSchema(): ValidateFunction {
  const lock = readContractLock();
  const names = readdirSync(schemaDirectory)
    .filter((name) => name.endsWith(".schema.json"))
    .sort();
  const lockedNames = Object.keys(lock.artifacts)
    .filter((name) => name.startsWith("contracts/") && name.endsWith(".schema.json"))
    .map((name) => name.slice("contracts/".length))
    .sort();
  if (JSON.stringify(names) !== JSON.stringify(lockedNames)) {
    throw new GroundingResultSchemaValidationError("frozen schema set does not match contract-lock.json");
  }

  const ajv = new Ajv2020Module.default({ allErrors: true, strict: true });
  addFormatsModule.default(ajv);
  for (const name of names) {
    const expected = lock.artifacts[`contracts/${name}`];
    if (expected === undefined) {
      throw new GroundingResultSchemaValidationError(`frozen schema ${name} is not locked`);
    }
    const schema = verifyLockedSchema(name, expected);
    ajv.addSchema({ ...structuredClone(schema), $id: name }, name);
  }
  const validator = ajv.getSchema("grounding-result.schema.json");
  if (!validator) {
    throw new GroundingResultSchemaValidationError("frozen grounding-result schema did not compile");
  }
  return validator;
}

function safeValidationDetails(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "schema validation failed";
  return errors.slice(0, 8).map((error) => `${error.instancePath || "/"}:${error.keyword}`).join(",");
}

// Compile and integrity-check at module load so a broken or drifted frozen
// contract prevents the worker from starting and therefore from claiming jobs.
const validateGroundingResult = compileFrozenGroundingResultSchema();

export function assertFrozenGroundingResult(value: unknown): asserts value is Readonly<Record<string, unknown>> {
  if (!validateGroundingResult(value)) {
    throw new GroundingResultSchemaValidationError(safeValidationDetails(validateGroundingResult.errors));
  }
}
