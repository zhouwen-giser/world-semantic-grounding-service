import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ValidateFunction } from "ajv";

function normalized(name: string, schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error(`Invalid API schema: ${name}`);
  return { ...(structuredClone(schema) as Record<string, unknown>), $id: name };
}

export interface ApiSchemaValidators {
  groundingRequest: ValidateFunction;
  groundingResult: ValidateFunction;
  groundingJob: ValidateFunction;
  capabilities: ValidateFunction;
  protocolError: ValidateFunction;
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
  return {
    groundingRequest: get("grounding-request.schema.json"),
    groundingResult: get("grounding-result.schema.json"),
    groundingJob: get("grounding-job.schema.json"),
    capabilities: get("capabilities-response.schema.json"),
    protocolError: get("protocol-error.schema.json")
  };
}
