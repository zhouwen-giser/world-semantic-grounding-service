import { modelOutputModes, type ModelOutputMode, type SemanticModelAdapterConfig } from "./types.js";

function required(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`Missing required semantic model environment variable: ${key}`);
  return value;
}

function boundedInteger(environment: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = environment[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function outputMode(environment: NodeJS.ProcessEnv): ModelOutputMode {
  const raw = environment["MODEL_OUTPUT_MODE"]?.trim().toUpperCase() ?? "RESPONSES_STRICT";
  if (!modelOutputModes.includes(raw as ModelOutputMode)) {
    throw new Error(`MODEL_OUTPUT_MODE must be one of: ${modelOutputModes.join(", ")}`);
  }
  return raw as ModelOutputMode;
}

export function semanticModelConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): SemanticModelAdapterConfig {
  return {
    baseUrl: required(environment, "MODEL_BASE_URL"),
    apiKey: required(environment, "MODEL_API_KEY"),
    model: required(environment, "MODEL_NAME"),
    timeoutMs: boundedInteger(environment, "MODEL_TIMEOUT_MS", 30_000, 100, 300_000),
    maxRetries: boundedInteger(environment, "MODEL_MAX_RETRIES", 2, 0, 5),
    outputMode: outputMode(environment)
  };
}
