import { describe, expect, it } from "vitest";

import { GroundingPipeline, pipelinePlanForOperation } from "./pipeline.js";
import { ProductionPipelineStageExecutor } from "./stage-executor.js";
import {
  PIPELINE_STAGES,
  PipelineCancelledError,
  PipelineFenceRejectedError,
  PipelineResultTooLargeError,
  PipelineStageAttemptTimeoutError,
  type ExecutionFence,
  type PipelineCheckpoint,
  type PipelineEventRecord,
  type PipelineJournal,
  type PipelineRunInput,
  type PipelineStage,
  type PipelineStageHandler
} from "./types.js";

class MemoryJournal implements PipelineJournal {
  readonly records: PipelineEventRecord[] = [];
  get events() { return this.records.map((record) => record.event); }
  checkpoint: PipelineCheckpoint | null = null;
  rejectTerminalStage: PipelineStage | undefined;

  async loadLatestCheckpoint(jobId: string, runFingerprint: string): Promise<PipelineCheckpoint | null> {
    return this.checkpoint?.jobId === jobId && this.checkpoint.runFingerprint === runFingerprint
      ? this.checkpoint
      : null;
  }

  async recordStarted(_fence: ExecutionFence, value: PipelineEventRecord): Promise<boolean> {
    this.records.push(value);
    return true;
  }

  async recordTerminal(
    _fence: ExecutionFence,
    value: PipelineEventRecord,
    checkpoint?: PipelineCheckpoint
  ): Promise<boolean> {
    this.records.push(value);
    if (value.event.stage === this.rejectTerminalStage) return false;
    if (checkpoint) this.checkpoint = checkpoint;
    return true;
  }
}

function handlerMap(
  calls: PipelineStage[],
  overrides: Partial<Record<PipelineStage, PipelineStageHandler>> = {}
): Record<PipelineStage, PipelineStageHandler> {
  return Object.fromEntries(PIPELINE_STAGES.map((stage) => [stage, overrides[stage] ?? (async () => {
    calls.push(stage);
    if (stage === "RESULT_PERSIST") return { status: "COMPLETED", value: { product: "grounded" } };
    return { stage, output: "stable" };
  })])) as Record<PipelineStage, PipelineStageHandler>;
}

function runInput(overrides: Partial<PipelineRunInput> = {}): PipelineRunInput {
  return {
    fence: { jobId: "job-1", leaseToken: "lease-1", generation: 1 },
    groundingId: "grounding-1",
    operation: "EXECUTE_WORLD_QUERY",
    deadlineAt: new Date(Date.now() + 30_000),
    initialState: { request: { text: "查询2号车" } },
    immutableLocks: {
      gowmCommit: "fceed92398a0b86c0a0121aa2188a7f1d328e577",
      contractRevision: "gowm-world-gateway/0.6.3"
    },
    maxResultBytes: 1_048_576,
    ...overrides
  };
}

describe("GroundingPipeline", () => {
  it("defines the canonical 14-stage order and operation-specific stopping points", () => {
    expect(pipelinePlanForOperation("EXECUTE_WORLD_QUERY")).toEqual(PIPELINE_STAGES);
    expect(pipelinePlanForOperation("GROUND_REFERENCES")).toEqual([
      "LOAD_CONTEXT", "DETERMINISTIC_PARSE", "SEMANTIC_MODEL_PARSE", "SEMANTIC_FRAME_VALIDATE",
      "GROUNDING_GRAPH_BUILD", "REFERENCE_RESOLVE", "REFERENCE_VALIDATE", "PRODUCT_ASSEMBLE"
    ]);
    expect(pipelinePlanForOperation("VALIDATE_REFERENCES")).toEqual([
      "LOAD_CONTEXT", "REFERENCE_VALIDATE", "PRODUCT_ASSEMBLE"
    ]);
    expect(pipelinePlanForOperation("COMPILE_WORLD_QUERY")).not.toContain("GOWM_EXECUTE");
    expect(pipelinePlanForOperation("COMPILE_WORLD_QUERY").at(-1)).toBe("WORLD_QUERY_COMPILE");
  });

  it("AC-P001..P014 executes every stage and records deterministic chained start/terminal hashes", async () => {
    const run = async (): Promise<{ journal: MemoryJournal; resultHash: string; resultBytes: Uint8Array }> => {
      const calls: PipelineStage[] = [];
      const journal = new MemoryJournal();
      const pipeline = new GroundingPipeline({
        executor: new ProductionPipelineStageExecutor(handlerMap(calls)),
        journal
      });
      const result = await pipeline.run(runInput());
      expect(calls).toEqual(PIPELINE_STAGES);
      expect(result.completedStages).toEqual(PIPELINE_STAGES);
      return { journal, resultHash: result.resultHash, resultBytes: result.resultBytes };
    };

    const first = await run();
    const second = await run();
    expect(first.journal.events).toHaveLength(PIPELINE_STAGES.length * 2);
    expect(first.journal.events.map((entry) => entry.status)).toEqual(
      PIPELINE_STAGES.flatMap(() => ["STARTED", "COMPLETED"])
    );
    expect(first.journal.events.map((entry) => entry.stage)).toEqual(PIPELINE_STAGES.flatMap((stage) => [stage, stage]));
    expect(Object.keys(first.journal.events[0] ?? {}).sort()).toEqual([
      "attempt", "createdAt", "elapsedMs", "generation", "groundingId", "inputHash", "stage", "status"
    ].sort());
    expect(Object.keys(first.journal.events[1] ?? {}).sort()).toEqual([
      "attempt", "createdAt", "elapsedMs", "generation", "groundingId", "inputHash", "outputHash", "stage", "status"
    ].sort());
    expect(first.journal.records.every((entry) => /^sha256:[0-9a-f]{64}$/u.test(entry.recordHash))).toBe(true);
    for (let index = 1; index < first.journal.records.length; index += 1) {
      expect(first.journal.records[index]?.previousRecordHash).toBe(first.journal.records[index - 1]?.recordHash);
    }
    expect(first.journal.records.map((entry) => entry.recordHash)).toEqual(
      second.journal.records.map((entry) => entry.recordHash)
    );
    expect(first.resultHash).toBe(second.resultHash);
    expect(first.resultBytes).toEqual(second.resultBytes);
  });

  it.each([
    ["GROUND_REFERENCES", ["REQUIREMENT_PLAN", "CAPABILITY_MATCH", "WORLD_QUERY_COMPILE", "GOWM_EXECUTE"], "PRODUCT_ASSEMBLE"],
    ["VALIDATE_REFERENCES", ["DETERMINISTIC_PARSE", "SEMANTIC_MODEL_PARSE", "GOWM_EXECUTE"], "PRODUCT_ASSEMBLE"],
    ["COMPILE_WORLD_QUERY", ["GOWM_EXECUTE", "EVIDENCE_NORMALIZE", "PRODUCT_ASSEMBLE"], "WORLD_QUERY_COMPILE"]
  ] as const)("enforces the %s architecture stop", async (operation, forbidden, terminalStage) => {
    const calls: PipelineStage[] = [];
    const pipeline = new GroundingPipeline({
      executor: new ProductionPipelineStageExecutor(handlerMap(calls)),
      journal: new MemoryJournal()
    });
    await pipeline.run(runInput({ operation }));
    forbidden.forEach((stage) => expect(calls).not.toContain(stage));
    expect(calls.at(-1)).toBe(terminalStage);
  });

  it("retries only within the bounded stage policy and preserves one invocation id", async () => {
    const calls: PipelineStage[] = [];
    const invocationIds: string[] = [];
    const journal = new MemoryJournal();
    let attempts = 0;
    const retryable = Object.assign(new Error("temporary"), { code: "UPSTREAM_503", retryable: true });
    const pipeline = new GroundingPipeline({
      executor: new ProductionPipelineStageExecutor(handlerMap(calls, {
        GOWM_EXECUTE: async (context) => {
          calls.push(context.stage);
          invocationIds.push(context.stageExecutionId);
          attempts += 1;
          if (attempts < 3) throw retryable;
          return { queryId: "query-1" };
        }
      })),
      journal,
      policy: (stage) => ({
        maxAttempts: stage === "GOWM_EXECUTE" ? 3 : 1,
        attemptTimeoutMs: 1_000,
        baseBackoffMs: 0,
        retryable: (error) => (error as { retryable?: boolean }).retryable === true
      })
    });
    await pipeline.run(runInput());
    expect(attempts).toBe(3);
    expect(new Set(invocationIds).size).toBe(1);
    expect(journal.events.filter((entry) => entry.stage === "GOWM_EXECUTE").map((entry) => entry.status)).toEqual([
      "STARTED", "FAILED", "STARTED", "FAILED", "STARTED", "COMPLETED"
    ]);
  });

  it("AC-P034 keeps the canonical result hash stable across worker generations and elapsed metrics", async () => {
    const run = async (jobId: string, generation: number, elapsedMs: number) => {
      const pipeline = new GroundingPipeline({
        executor: new ProductionPipelineStageExecutor(handlerMap([], {
          RESULT_PERSIST: async () => ({
            schemaVersion: "1.0",
            status: "COMPLETED",
            source: { messageId: "message-1" },
            execution: { parserVersion: "2.0", elapsedMs }
          })
        })),
        journal: new MemoryJournal()
      });
      return pipeline.run(runInput({
        fence: { jobId, leaseToken: `lease-${generation}`, generation }
      }));
    };
    const first = await run("job-1", 1, 12);
    const recovered = await run("job-2", 9, 987);
    expect(first.resultHash).toBe(recovered.resultHash);
    expect(first.value).toMatchObject({ resultHash: first.resultHash, execution: { elapsedMs: 12 } });
    expect(recovered.value).toMatchObject({ resultHash: recovered.resultHash, execution: { elapsedMs: 987 } });
  });

  it("binds the negotiated geospatial extension into the canonical result hash", async () => {
    const run = async (measurement: number) => new GroundingPipeline({
      executor: new ProductionPipelineStageExecutor(handlerMap([], {
        RESULT_PERSIST: async () => ({
          schemaVersion: "1.0",
          status: "COMPLETED",
          execution: { elapsedMs: 5 },
          geospatialFindings: {
            profile: "sacs-wsgs-geospatial-findings/1.0",
            findings: [{ findingId: "finding-1", measurement }]
          }
        })
      })),
      journal: new MemoryJournal()
    }).run(runInput());
    const first = await run(12.5);
    const changed = await run(13.5);
    expect(first.resultHash).not.toBe(changed.resultHash);
    expect(first.value).toMatchObject({ geospatialFindings: { findings: [{ measurement: 12.5 }] } });
  });

  it("aborts and rejects a stage that ignores its per-attempt timeout", async () => {
    const calls: PipelineStage[] = [];
    const journal = new MemoryJournal();
    const pipeline = new GroundingPipeline({
      executor: new ProductionPipelineStageExecutor(handlerMap(calls, {
        SEMANTIC_MODEL_PARSE: async () => new Promise((resolve) => setTimeout(() => resolve({ late: true }), 50))
      })),
      journal,
      policy: () => ({ maxAttempts: 1, attemptTimeoutMs: 5, baseBackoffMs: 0, retryable: () => false })
    });
    await expect(pipeline.run(runInput())).rejects.toBeInstanceOf(PipelineStageAttemptTimeoutError);
    expect(journal.events.filter((entry) => entry.stage === "SEMANTIC_MODEL_PARSE").map((entry) => entry.status)).toEqual([
      "STARTED", "FAILED"
    ]);
    expect(journal.events.at(-1)?.errorCode).toBe("PIPELINE_STAGE_ATTEMPT_TIMEOUT");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(journal.events.filter((entry) => entry.stage === "SEMANTIC_MODEL_PARSE")).toHaveLength(2);
  });

  it("attributes an overall deadline to the stage that consumed it", async () => {
    const pipeline = new GroundingPipeline({
      executor: new ProductionPipelineStageExecutor(handlerMap([], {
        LOAD_CONTEXT: async () => new Promise((resolve) => setTimeout(() => resolve({ late: true }), 50))
      })),
      journal: new MemoryJournal(),
      policy: () => ({ maxAttempts: 1, attemptTimeoutMs: 1_000, baseBackoffMs: 0, retryable: () => false })
    });
    await expect(pipeline.run(runInput({
      deadlineAt: new Date(Date.now() + 5)
    }))).rejects.toMatchObject({
      code: "PIPELINE_DEADLINE_EXCEEDED",
      stage: "LOAD_CONTEXT"
    });
  });

  it("fails the terminal stage before checkpointing an oversized result", async () => {
    const journal = new MemoryJournal();
    const pipeline = new GroundingPipeline({
      executor: new ProductionPipelineStageExecutor(handlerMap([], {
        RESULT_PERSIST: async () => ({ status: "COMPLETED", value: { payload: "x".repeat(2_000) } })
      })),
      journal
    });
    await expect(pipeline.run(runInput({ maxResultBytes: 128 }))).rejects.toBeInstanceOf(PipelineResultTooLargeError);
    expect(journal.events.filter((entry) => entry.stage === "RESULT_PERSIST").map((entry) => entry.status)).toEqual([
      "STARTED", "FAILED"
    ]);
    expect(journal.checkpoint?.lastCompletedStage).toBe("PRODUCT_ASSEMBLE");
  });

  it.each(["SEMANTIC_MODEL_PARSE", "GOWM_EXECUTE"] as const)(
    "cancellation wins over a late %s result",
    async (lateStage) => {
      const calls: PipelineStage[] = [];
      const journal = new MemoryJournal();
      const controller = new AbortController();
      let releaseStarted!: () => void;
      const started = new Promise<void>((resolve) => { releaseStarted = resolve; });
      const pipeline = new GroundingPipeline({
        executor: new ProductionPipelineStageExecutor(handlerMap(calls, {
          [lateStage]: async () => {
            calls.push(lateStage);
            releaseStarted();
            return new Promise((resolve) => setTimeout(() => resolve({ late: true }), 30));
          }
        })),
        journal,
        policy: () => ({ maxAttempts: 1, attemptTimeoutMs: 1_000, baseBackoffMs: 0, retryable: () => false })
      });
      const running = pipeline.run(runInput({ signal: controller.signal }));
      await started;
      controller.abort(new Error("cancelled"));
      await expect(running).rejects.toBeInstanceOf(PipelineCancelledError);
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(journal.events.filter((entry) => entry.stage === lateStage).map((entry) => entry.status)).toEqual([
        "STARTED", "CANCELLED"
      ]);
      expect(calls).not.toContain("RESULT_PERSIST");
    }
  );

  it("preserves a typed worker shutdown so the owning worker can requeue the checkpoint", async () => {
    const journal = new MemoryJournal();
    const controller = new AbortController();
    let releaseStarted!: () => void;
    const started = new Promise<void>((resolve) => { releaseStarted = resolve; });
    const pipeline = new GroundingPipeline({
      executor: new ProductionPipelineStageExecutor(handlerMap([], {
        GOWM_EXECUTE: async () => {
          releaseStarted();
          return await new Promise((resolve) => setTimeout(() => resolve({ late: true }), 30));
        }
      })),
      journal,
      policy: () => ({ maxAttempts: 1, attemptTimeoutMs: 1_000, baseBackoffMs: 0, retryable: () => false })
    });
    const shutdown = Object.assign(new Error("worker restart"), { code: "WORKER_SHUTDOWN" });
    const running = pipeline.run(runInput({ signal: controller.signal }));
    await started;
    controller.abort(shutdown);
    await expect(running).rejects.toBe(shutdown);
    expect(journal.events.filter((entry) => entry.stage === "GOWM_EXECUTE").at(-1)).toMatchObject({
      status: "CANCELLED",
      errorCode: "WORKER_SHUTDOWN"
    });
  });

  it("resumes from the last atomic checkpoint without duplicating model or GOWM work", async () => {
    const journal = new MemoryJournal();
    const firstCalls: PipelineStage[] = [];
    const crash = Object.assign(new Error("worker crashed"), { code: "WORKER_CRASH" });
    const first = new GroundingPipeline({
      executor: new ProductionPipelineStageExecutor(handlerMap(firstCalls, {
        EVIDENCE_NORMALIZE: async () => { throw crash; }
      })),
      journal,
      policy: () => ({ maxAttempts: 1, attemptTimeoutMs: 1_000, baseBackoffMs: 0, retryable: () => false })
    });
    await expect(first.run(runInput())).rejects.toBe(crash);
    expect(firstCalls).toContain("SEMANTIC_MODEL_PARSE");
    expect(firstCalls).toContain("GOWM_EXECUTE");

    const recoveredCalls: PipelineStage[] = [];
    const recovered = new GroundingPipeline({
      executor: new ProductionPipelineStageExecutor(handlerMap(recoveredCalls)),
      journal
    });
    const result = await recovered.run(runInput({
      fence: { jobId: "job-1", leaseToken: "lease-2", generation: 2 }
    }));
    expect(result.recoveredStages.at(-1)).toBe("GOWM_EXECUTE");
    expect(recoveredCalls).toEqual(["EVIDENCE_NORMALIZE", "PRODUCT_ASSEMBLE", "RESULT_PERSIST"]);
    expect(recoveredCalls).not.toContain("SEMANTIC_MODEL_PARSE");
    expect(recoveredCalls).not.toContain("GOWM_EXECUTE");
  });

  it("rejects a late terminal event when the generation fence is lost", async () => {
    const journal = new MemoryJournal();
    journal.rejectTerminalStage = "GOWM_EXECUTE";
    const pipeline = new GroundingPipeline({
      executor: new ProductionPipelineStageExecutor(handlerMap([])),
      journal
    });
    await expect(pipeline.run(runInput())).rejects.toBeInstanceOf(PipelineFenceRejectedError);
    expect(journal.checkpoint?.lastCompletedStage).toBe("WORLD_QUERY_COMPILE");
  });
});
