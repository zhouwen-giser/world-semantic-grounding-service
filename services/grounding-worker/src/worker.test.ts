import { describe, expect, it, vi } from "vitest";

import {
  type GroundingWorkerStore,
  type WorkerClaim,
  type WorkerExecutionFence,
  type WorkerHeartbeat,
  type WorkerPipelineRunInput,
  type WorkerPipelineRunResult,
  type WorkerSettlement,
  type WorkerSettlementOutcome
} from "./types.js";
import { GroundingWorker } from "./worker.js";

function claim(overrides: Partial<WorkerClaim> = {}): WorkerClaim {
  return {
    jobId: "job-1",
    groundingId: "grounding-1",
    operation: "EXECUTE_WORLD_QUERY",
    leaseToken: "lease-1",
    generation: 1,
    attempt: 1,
    deadlineAt: new Date(Date.now() + 30_000),
    maxResultBytes: 1_048_576,
    initialState: { request: "sealed-and-loaded" },
    immutableLocks: { gowmCommit: "c49bf415fdb4cbe19a09f341c34b6dd825e3ca14" },
    ...overrides
  };
}

class MemoryWorkerStore implements GroundingWorkerStore {
  claims: WorkerClaim[] = [];
  heartbeats: WorkerHeartbeat[] = [];
  settlements: Array<{ fence: WorkerExecutionFence; value: WorkerSettlement }> = [];
  settlementOutcome: WorkerSettlementOutcome = "APPLIED";
  resultSettlementError: Error | undefined;

  async claimNext(): Promise<WorkerClaim | null> {
    return this.claims.shift() ?? null;
  }

  async heartbeat(): Promise<WorkerHeartbeat> {
    return this.heartbeats.shift() ?? { owned: true, cancelRequested: false };
  }

  async settle(fence: WorkerExecutionFence, value: WorkerSettlement): Promise<WorkerSettlementOutcome> {
    this.settlements.push({ fence, value });
    if (value.kind === "RESULT" && this.resultSettlementError) throw this.resultSettlementError;
    return this.settlementOutcome;
  }
}

function success(): WorkerPipelineRunResult {
  return {
    status: "COMPLETED",
    resultHash: `sha256:${"a".repeat(64)}`,
    resultBytes: new Uint8Array([1, 2, 3])
  };
}

function worker(
  store: MemoryWorkerStore,
  run: (input: WorkerPipelineRunInput) => Promise<WorkerPipelineRunResult>,
  overrides: Partial<ConstructorParameters<typeof GroundingWorker>[0]> = {}
): GroundingWorker {
  return new GroundingWorker({
    workerId: "worker-a",
    store,
    pipeline: { run },
    leaseMs: 100,
    heartbeatMs: 20,
    pollIntervalMs: 5,
    retryBackoffMs: 10,
    ...overrides
  });
}

describe("GroundingWorker", () => {
  it("claims a durable job and publishes with the exact lease generation fence", async () => {
    const store = new MemoryWorkerStore();
    store.claims.push(claim({ generation: 7, leaseToken: "lease-7" }));
    const run = vi.fn(async () => success());
    const outcome = await worker(store, run).runOnce();
    expect(outcome).toEqual({ kind: "SUCCEEDED", jobId: "job-1" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(store.settlements).toEqual([{
      fence: { jobId: "job-1", leaseToken: "lease-7", generation: 7 },
      value: {
        kind: "RESULT",
        status: "COMPLETED",
        resultHash: `sha256:${"a".repeat(64)}`,
        resultBytes: new Uint8Array([1, 2, 3])
      }
    }]);
  });

  it("fail-closes a rejected result settlement into a durable failed settlement", async () => {
    const store = new MemoryWorkerStore();
    store.claims.push(claim());
    store.resultSettlementError = Object.assign(new Error("invalid negotiated result"), {
      code: "GROUNDING_RESULT_SCHEMA_INVALID"
    });
    const outcome = await worker(store, async () => success()).runOnce();
    expect(outcome).toEqual({ kind: "FAILED", jobId: "job-1" });
    expect(store.settlements.map(({ value }) => value.kind)).toEqual(["RESULT", "FAILED"]);
    expect(store.settlements[1]?.value).toMatchObject({
      kind: "FAILED",
      errorCode: "GROUNDING_RESULT_SCHEMA_INVALID",
      retryable: false
    });
  });

  it("continues the worker loop after a rejected result settlement is durably failed", async () => {
    const store = new MemoryWorkerStore();
    store.claims.push(
      claim(),
      claim({
        jobId: "job-2",
        groundingId: "grounding-2",
        leaseToken: "lease-2"
      })
    );
    const settlementError = Object.assign(new Error("result exceeds negotiated boundary"), {
      code: "GROUNDING_RESULT_MAX_BYTES_EXCEEDED"
    });
    let secondResultSettled!: () => void;
    const secondResult = new Promise<void>((resolve) => { secondResultSettled = resolve; });
    const originalSettle = store.settle.bind(store);
    const settle = vi.spyOn(store, "settle").mockImplementation(async (fence, value) => {
      const outcome = await originalSettle(fence, value);
      if (fence.jobId === "job-2" && value.kind === "RESULT") secondResultSettled();
      return outcome;
    });
    settle.mockRejectedValueOnce(settlementError);
    const run = vi.fn(async () => success());
    const groundingWorker = worker(store, run, { pollIntervalMs: 1 });
    const loop = groundingWorker.start();

    await Promise.race([
      secondResult,
      loop.then(() => { throw new Error("worker loop stopped before the second result settled"); })
    ]);
    await expect(groundingWorker.stop()).resolves.toEqual({ drained: true, aborted: 0 });
    await expect(loop).resolves.toBeUndefined();

    expect(run).toHaveBeenCalledTimes(2);
    expect(settle.mock.calls.map(([, value]) => value.kind)).toEqual(["RESULT", "FAILED", "RESULT"]);
    expect(store.settlements.map(({ fence, value }) => [fence.jobId, value.kind])).toEqual([
      ["job-1", "FAILED"],
      ["job-2", "RESULT"]
    ]);
    expect(store.settlements[0]?.value).toMatchObject({
      kind: "FAILED",
      errorCode: "GROUNDING_RESULT_MAX_BYTES_EXCEEDED",
      retryable: false
    });
  });

  it("heartbeats a long-running lease", async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryWorkerStore();
      store.claims.push(claim());
      const heartbeat = vi.spyOn(store, "heartbeat");
      const running = worker(store, async () => {
        await new Promise((resolve) => setTimeout(resolve, 55));
        return success();
      }).runOnce();
      await vi.advanceTimersByTimeAsync(55);
      const result = await running;
      expect(result.kind).toBe("SUCCEEDED");
      expect(heartbeat.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts immediately when a heartbeat reports cancellation", async () => {
    const store = new MemoryWorkerStore();
    store.claims.push(claim());
    store.heartbeats.push({ owned: true, cancelRequested: true });
    const result = await worker(store, async (input) => new Promise((_resolve, reject) => {
      input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
    })).runOnce();
    expect(result).toEqual({ kind: "CANCELLED", jobId: "job-1" });
    expect(store.settlements[0]?.value).toMatchObject({ kind: "CANCELLED" });
  });

  it("does not publish after losing its lease to a newer generation", async () => {
    const store = new MemoryWorkerStore();
    store.claims.push(claim());
    store.heartbeats.push({ owned: false, cancelRequested: false });
    const result = await worker(store, async (input) => new Promise((_resolve, reject) => {
      input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
    })).runOnce();
    expect(result).toEqual({ kind: "FENCE_REJECTED", jobId: "job-1" });
    expect(store.settlements).toHaveLength(0);
  });

  it("makes cancellation win over a late model or GOWM result", async () => {
    const store = new MemoryWorkerStore();
    store.claims.push(claim());
    let releaseStarted!: () => void;
    const started = new Promise<void>((resolve) => { releaseStarted = resolve; });
    const groundingWorker = worker(store, async () => {
      releaseStarted();
      await new Promise((resolve) => setTimeout(resolve, 35));
      return success();
    });
    const running = groundingWorker.runOnce();
    await started;
    expect(groundingWorker.cancel("job-1")).toBe(true);
    await expect(running).resolves.toEqual({ kind: "CANCELLED", jobId: "job-1" });
    expect(store.settlements.map((entry) => entry.value.kind)).toEqual(["CANCELLED"]);
  });

  it("treats a rejected completion fence as a late result", async () => {
    const store = new MemoryWorkerStore();
    store.claims.push(claim({ generation: 1 }));
    store.settlementOutcome = "FENCE_REJECTED";
    await expect(worker(store, async () => success()).runOnce()).resolves.toEqual({
      kind: "FENCE_REJECTED",
      jobId: "job-1"
    });
  });

  it("persists a schema-valid FAILED result instead of discarding its bytes", async () => {
    const store = new MemoryWorkerStore();
    store.claims.push(claim());
    const failedResult = { ...success(), status: "FAILED" as const };
    await expect(worker(store, async () => failedResult).runOnce()).resolves.toEqual({
      kind: "FAILED",
      jobId: "job-1"
    });
    expect(store.settlements[0]?.value).toMatchObject({
      kind: "RESULT",
      status: "FAILED",
      resultHash: failedResult.resultHash
    });
  });

  it("schedules bounded job-level retry with exponential availability", async () => {
    const store = new MemoryWorkerStore();
    store.claims.push(claim({ attempt: 2 }));
    const temporary = Object.assign(new Error("temporary upstream failure"), {
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true
    });
    const now = Date.parse("2026-08-27T00:00:00Z");
    const result = await worker(store, async () => { throw temporary; }, { now: () => now }).runOnce();
    expect(result).toEqual({ kind: "RETRY_SCHEDULED", jobId: "job-1" });
    expect(store.settlements[0]?.value).toMatchObject({
      kind: "RETRY",
      errorCode: "UPSTREAM_UNAVAILABLE",
      availableAt: new Date(now + 20)
    });
  });

  it("fails an expired job without invoking the pipeline", async () => {
    const store = new MemoryWorkerStore();
    store.claims.push(claim({ deadlineAt: new Date(0) }));
    const run = vi.fn(async () => success());
    const result = await worker(store, run).runOnce();
    expect(result).toEqual({ kind: "FAILED", jobId: "job-1" });
    expect(run).not.toHaveBeenCalled();
    expect(store.settlements[0]?.value).toMatchObject({
      kind: "FAILED",
      errorCode: "WORKER_DEADLINE_EXCEEDED"
    });
  });

  it("preserves the failed pipeline stage for public error attribution", async () => {
    const store = new MemoryWorkerStore();
    store.claims.push(claim());
    const deadline = Object.assign(new Error("deadline"), {
      code: "PIPELINE_DEADLINE_EXCEEDED",
      stage: "SEMANTIC_MODEL_PARSE"
    });
    await expect(worker(store, async () => { throw deadline; }).runOnce()).resolves.toEqual({
      kind: "FAILED",
      jobId: "job-1"
    });
    expect(store.settlements[0]?.value).toMatchObject({
      kind: "FAILED",
      errorCode: "PIPELINE_DEADLINE_EXCEEDED",
      pipelineStage: "SEMANTIC_MODEL_PARSE"
    });
  });

  it("graceful shutdown drains first and aborts in-flight work only after grace", async () => {
    const store = new MemoryWorkerStore();
    store.claims.push(claim());
    let releaseStarted!: () => void;
    const started = new Promise<void>((resolve) => { releaseStarted = resolve; });
    const groundingWorker = worker(store, async (input) => {
      releaseStarted();
      return new Promise((_resolve, reject) => {
        input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
      });
    });
    const running = groundingWorker.runOnce();
    await started;
    const stopped = await groundingWorker.stop(5);
    expect(stopped).toEqual({ drained: false, aborted: 1 });
    await expect(running).resolves.toEqual({ kind: "RETRY_SCHEDULED", jobId: "job-1" });
    expect(store.settlements[0]?.value).toMatchObject({ kind: "RETRY", errorCode: "WORKER_SHUTDOWN" });
  });
});
