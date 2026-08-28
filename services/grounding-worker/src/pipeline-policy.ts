import {
  PIPELINE_STAGES,
  defaultPipelineStagePolicy,
  type PipelinePolicyResolver,
  type PipelineStage,
  type PipelineStagePolicy
} from "@wsgs/grounding-pipeline";

import { WorkerConfigurationError } from "./types.js";

const minimumAttemptTimeoutMs = 1;
const maximumAttemptTimeoutMs = 3_600_000;

type Environment = Readonly<Record<string, string | undefined>>;

function configuredInteger(
  environment: Environment,
  name: string,
  minimum: number,
  maximum: number
): number | undefined {
  const raw = environment[name];
  if (raw === undefined) return undefined;
  const normalized = raw.trim();
  if (!/^(?:0|[1-9][0-9]*)$/u.test(normalized)) {
    throw new WorkerConfigurationError(`${name} must be a base-10 integer`);
  }
  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new WorkerConfigurationError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function stageTimeoutName(stage: PipelineStage): string {
  return `WSGS_PIPELINE_${stage}_ATTEMPT_TIMEOUT_MS`;
}

function configuredAttemptTimeout(
  environment: Environment,
  stage: PipelineStage,
  fallback: number
): number {
  const stageSpecific = configuredInteger(
    environment,
    stageTimeoutName(stage),
    minimumAttemptTimeoutMs,
    maximumAttemptTimeoutMs
  );
  if (stageSpecific !== undefined) return stageSpecific;

  const global = configuredInteger(
    environment,
    "WSGS_PIPELINE_ATTEMPT_TIMEOUT_MS",
    minimumAttemptTimeoutMs,
    maximumAttemptTimeoutMs
  );
  if (global !== undefined) return global;

  // Keep the model adapter and its enclosing pipeline stage on the same
  // configured budget unless the operator deliberately supplies a stage
  // override. The pipeline still clamps every attempt to the request deadline.
  if (stage === "SEMANTIC_MODEL_PARSE") {
    const modelTimeout = configuredInteger(
      environment,
      "MODEL_TIMEOUT_MS",
      100,
      300_000
    );
    if (modelTimeout !== undefined) return modelTimeout;
  }
  return fallback;
}

/**
 * Resolves the complete production policy eagerly so malformed configuration
 * fails worker startup rather than surfacing after a job has been claimed.
 */
export function productionPipelinePolicyFromEnvironment(
  environment: Environment = process.env
): PipelinePolicyResolver {
  const policies = new Map<PipelineStage, PipelineStagePolicy>();
  for (const stage of PIPELINE_STAGES) {
    const baseline = defaultPipelineStagePolicy(stage);
    policies.set(stage, Object.freeze({
      ...baseline,
      attemptTimeoutMs: configuredAttemptTimeout(environment, stage, baseline.attemptTimeoutMs)
    }));
  }
  return (stage) => {
    const policy = policies.get(stage);
    if (!policy) throw new WorkerConfigurationError(`Unsupported pipeline stage policy: ${stage as string}`);
    return policy;
  };
}
