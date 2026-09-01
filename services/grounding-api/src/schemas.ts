import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ValidateFunction } from "ajv";
import { defaultSacsGeospatialSchemaRegistry } from "@wsgs/contracts";

function normalized(name: string, schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error(`Invalid API schema: ${name}`);
  return { ...(structuredClone(schema) as Record<string, unknown>), $id: name };
}

export interface ApiSchemaValidators {
  groundingRequest: ValidateFunction;
  groundingResult: ValidateFunction;
  groundingResult11: ValidateFunction;
  groundingJob: ValidateFunction;
  groundingJob11: ValidateFunction;
  capabilities: ValidateFunction;
  capabilities11: ValidateFunction;
  structuredSelectionRequest: ValidateFunction;
  structuredSelectionResult: ValidateFunction;
  protocolError: ValidateFunction;
}

function registryValidator(
  schemaName:
    | "grounding-result-extension.schema.json"
    | "capabilities-response-v1.1.schema.json"
    | "structured-selection-request.schema.json"
    | "structured-selection-result.schema.json"
): ValidateFunction {
  const registry = defaultSacsGeospatialSchemaRegistry();
  const validator = ((value: unknown): boolean => {
    try {
      registry.validate(schemaName, value);
      return true;
    } catch {
      return false;
    }
  }) as ValidateFunction;
  validator.errors = null;
  return validator;
}

export function compileApiSchemas(documents: Record<string, unknown>): ApiSchemaValidators {
  const ajv = new Ajv2020Module.default({ allErrors: true, strict: true });
  addFormatsModule.default(ajv);
  for (const [name, schema] of Object.entries(documents)) ajv.addSchema(normalized(name, schema), name);
  const get = (name: string): ValidateFunction => {
    const validator = ajv.getSchema(name);
    if (!validator) throw new Error(`Missing compiled API schema: ${name}`);
    return validator;
  };
  const groundingResult = get("grounding-result.schema.json");
  const groundingJob = get("grounding-job.schema.json");
  const groundingResult11 = registryValidator("grounding-result-extension.schema.json");
  const groundingJob11 = ((value: unknown): boolean => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    const shell = { ...candidate };
    delete shell["result"];
    if (!groundingJob(shell)) return false;
    return candidate["result"] === undefined || groundingResult11(candidate["result"]);
  }) as ValidateFunction;
  groundingJob11.errors = null;
  return {
    groundingRequest: get("grounding-request.schema.json"),
    groundingResult,
    groundingResult11,
    groundingJob,
    groundingJob11,
    capabilities: get("capabilities-response.schema.json"),
    capabilities11: registryValidator("capabilities-response-v1.1.schema.json"),
    structuredSelectionRequest: registryValidator("structured-selection-request.schema.json"),
    structuredSelectionResult: registryValidator("structured-selection-result.schema.json"),
    protocolError: get("protocol-error.schema.json")
  };
}
