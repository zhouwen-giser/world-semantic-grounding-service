import {
  GroundingPipeline,
  PIPELINE_STAGES,
  PipelineDeadlineExceededError,
  ProductionPipelineStageExecutor,
  type ExecutionFence,
  type PipelineCheckpoint,
  type PipelineEventRecord,
  type PipelineJournal,
  type PipelineStage,
  type PipelineStageHandler
} from "@wsgs/grounding-pipeline";
import { describe, expect, it } from "vitest";

import { productionPipelinePolicyFromEnvironment } from "./pipeline-policy.js";
import { WorkerConfigurationError } from "./types.js";

class MemoryJournal implements PipelineJournal {
  checkpoint: PipelineCheckpoint | null = null;

  async loadLatestCheckpoint(jobId: string, runFingerprint: string): Promise<PipelineCheckpoint | null> {
    return this.checkpoint?.jobId === jobId && this.checkpoint.runFingerprint === runFingerprint
      ? this.checkpoint
      : null;
  }

  async recordStarted(_fence: ExecutionFence, _value: PipelineEventRecord): Promise<boolean> {
    return true;
  }

  async recordTerminal(
    _fence: ExecutionFence,
    _value: PipelineEventRecord,
    checkpoint?: PipelineCheckpoint
  ): Promise<boolean> {
    if (checkpoint) this.checkpoint = checkpoint;
    return true;
  }
}

function handlers(overrides: Partial<Record<PipelineStage, PipelineStageHandler>> = {}): ProductionPipelineStageExecutor {
  return new ProductionPipelineStageExecutor(Object.fromEntries(PIPELINE_STAGES.map((stage) => [
    stage,
    overrides[stage] ?? (async () => stage === "PRODUCT_ASSEMBLE"
      ? { status: "COMPLETED", value: { schemaVersion: "1.0" } }
      : { stage })
  ])) as Record<PipelineStage, PipelineStageHandler>);
}

describe("productionPipelinePolicyFromEnvironment", () => {
  it("uses MODEL_TIMEOUT_MS for the enclosing semantic-model stage and permits an explicit stage override", () => {
    const inherited = productionPipelinePolicyFromEnvironment({ MODEL_TIMEOUT_MS: "120000" });
    expect(inherited("SEMANTIC_MODEL_PARSE").attemptTimeoutMs).toBe(120_000);
    expect(inherited("GOWM_EXECUTE").attemptTimeoutMs).toBe(30_000);

    const overridden = productionPipelinePolicyFromEnvironment({
      MODEL_TIMEOUT_MS: "120000",
      WSGS_PIPELINE_SEMANTIC_MODEL_PARSE_ATTEMPT_TIMEOUT_MS: "180000"
    });
    expect(overridden("SEMANTIC_MODEL_PARSE").attemptTimeoutMs).toBe(180_000);
  });

  it("supports a global timeout and a higher-priority per-stage timeout", () => {
    const policy = productionPipelinePolicyFromEnvironment({
      WSGS_PIPELINE_ATTEMPT_TIMEOUT_MS: "45000",
      WSGS_PIPELINE_GOWM_EXECUTE_ATTEMPT_TIMEOUT_MS: "90000"
    });
    expect(policy("LOAD_CONTEXT").attemptTimeoutMs).toBe(45_000);
    expect(policy("SEMANTIC_MODEL_PARSE").attemptTimeoutMs).toBe(45_000);
    expect(policy("GOWM_EXECUTE").attemptTimeoutMs).toBe(90_000);
  });

  it.each(["", "-1", "1.5", "3e4", "3600001"])("fails closed for malformed timeout %j", (value) => {
    expect(() => productionPipelinePolicyFromEnvironment({
      WSGS_PIPELINE_SEMANTIC_MODEL_PARSE_ATTEMPT_TIMEOUT_MS: value
    })).toThrow(WorkerConfigurationError);
  });

  it("still lets the request deadline clamp a longer configured model-stage timeout", async () => {
    let semanticStageStarted = false;
    const pipeline = new GroundingPipeline({
      executor: handlers({
        SEMANTIC_MODEL_PARSE: async (context) => {
          semanticStageStarted = true;
          return new Promise((_resolve, reject) => {
            const aborted = (): void => reject(context.signal.reason);
            if (context.signal.aborted) aborted();
            else context.signal.addEventListener("abort", aborted, { once: true });
          });
        }
      }),
      journal: new MemoryJournal(),
      policy: productionPipelinePolicyFromEnvironment({ MODEL_TIMEOUT_MS: "120000" })
    });

    await expect(pipeline.run({
      fence: { jobId: "job-deadline", leaseToken: "lease-deadline", generation: 1 },
      groundingId: "grounding-deadline",
      operation: "GROUND_REFERENCES",
      deadlineAt: new Date(Date.now() + 75),
      initialState: { request: { source: "test" } },
      immutableLocks: { contract: "test" },
      maxResultBytes: 1_048_576
    })).rejects.toBeInstanceOf(PipelineDeadlineExceededError);
    expect(semanticStageStarted).toBe(true);
  });
});
