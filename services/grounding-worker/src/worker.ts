import { PIPELINE_STAGES, type PipelineStage } from "@wsgs/grounding-pipeline";
import { isTransientStoreError, safeRuntimeErrorCode, type WorkerRuntimeLogger } from "./runtime-errors.js";

import {
  WorkerConfigurationError,
  WorkerDeadlineExceededError,
  WorkerJobCancelledError,
  WorkerLeaseLostError,
  WorkerShutdownError,
  type GroundingWorkerStore,
  type WorkerClaim,
  type WorkerExecutionFence,
  type WorkerPipelineRunner,
  type WorkerRunOutcome,
  type WorkerSettlement,
  type WorkerSettlementOutcome
} from "./types.js";

export interface GroundingWorkerConfig {
  workerId: string;
  store: GroundingWorkerStore;
  pipeline: WorkerPipelineRunner;
  leaseMs?: number;
  heartbeatMs?: number;
  pollIntervalMs?: number;
  concurrency?: number;
  maxJobAttempts?: number;
  retryBackoffMs?: number;
  now?: () => number;
  log?: WorkerRuntimeLogger;
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as Record<string, unknown>)["code"];
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,127}$/u.test(code)) return code;
  }
  return "WORKER_PIPELINE_FAILED";
}

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  return record["retryable"] === true;
}

function pipelineStage(error: unknown): PipelineStage | undefined {
  if (!error || typeof error !== "object") return undefined;
  const stage = (error as Record<string, unknown>)["stage"];
  return typeof stage === "string" && (PIPELINE_STAGES as readonly string[]).includes(stage)
    ? stage as PipelineStage
    : undefined;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, ms);
    const aborted = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", aborted, { once: true });
  });
}

class LeaseHeartbeat {
  readonly #store: GroundingWorkerStore;
  readonly #fence: WorkerExecutionFence;
  readonly #leaseMs: number;
  readonly #heartbeatMs: number;
  readonly #controller: AbortController;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #inFlight: Promise<void> = Promise.resolve();
  #stopped = false;

  constructor(args: {
    store: GroundingWorkerStore;
    fence: WorkerExecutionFence;
    leaseMs: number;
    heartbeatMs: number;
    controller: AbortController;
  }) {
    this.#store = args.store;
    this.#fence = args.fence;
    this.#leaseMs = args.leaseMs;
    this.#heartbeatMs = args.heartbeatMs;
    this.#controller = args.controller;
  }

  start(): void {
    this.#schedule();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    await this.#inFlight;
  }

  #schedule(): void {
    if (this.#stopped || this.#controller.signal.aborted) return;
    this.#timer = setTimeout(() => {
      this.#inFlight = this.#beat();
    }, this.#heartbeatMs);
  }

  async #beat(): Promise<void> {
    try {
      const heartbeat = await this.#store.heartbeat(this.#fence, this.#leaseMs);
      if (!heartbeat.owned) this.#controller.abort(new WorkerLeaseLostError());
      else if (heartbeat.cancelRequested) this.#controller.abort(new WorkerJobCancelledError());
    } catch {
      // A heartbeat transport failure makes ownership uncertain. Never settle a
      // result from that generation; the database fence decides who may resume.
      this.#controller.abort(new WorkerLeaseLostError());
    } finally {
      this.#schedule();
    }
  }
}

export class GroundingWorker {
  readonly #config: Required<Omit<GroundingWorkerConfig, "store" | "pipeline" | "now" | "log">> &
    Pick<GroundingWorkerConfig, "store" | "pipeline">;
  readonly #now: () => number;
  readonly #log: WorkerRuntimeLogger;
  readonly #active = new Map<string, AbortController>();
  readonly #loopController = new AbortController();
  #running: Promise<void> | undefined;
  #accepting = true;

  constructor(config: GroundingWorkerConfig) {
    this.#config = {
      workerId: config.workerId,
      store: config.store,
      pipeline: config.pipeline,
      leaseMs: config.leaseMs ?? 30_000,
      heartbeatMs: config.heartbeatMs ?? 5_000,
      pollIntervalMs: config.pollIntervalMs ?? 250,
      concurrency: config.concurrency ?? 1,
      maxJobAttempts: config.maxJobAttempts ?? 3,
      retryBackoffMs: config.retryBackoffMs ?? 500
    };
    this.#now = config.now ?? Date.now;
    this.#log = config.log ?? (() => undefined);
    this.#validateConfig();
  }

  get activeJobs(): number {
    return this.#active.size;
  }

  async runOnce(): Promise<WorkerRunOutcome> {
    if (!this.#accepting) return { kind: "IDLE" };
    const claim = await this.#config.store.claimNext(this.#config.workerId, this.#config.leaseMs);
    if (!claim) return { kind: "IDLE" };
    // A stop/fatal error may arrive while claimNext is awaiting the database.
    if (!this.#accepting) return this.#settle(claim, {
      kind: "RETRY", errorCode: "WORKER_SHUTDOWN", retryable: true, availableAt: new Date(this.#now())
    }, "RETRY_SCHEDULED");
    return this.#runClaim(claim);
  }

  start(): Promise<void> {
    if (this.#running) return this.#running;
    if (!this.#accepting) throw new WorkerConfigurationError("A stopped worker cannot be restarted");
    this.#running = Promise.allSettled(
      Array.from({ length: this.#config.concurrency }, () => this.#loop().catch(error => {
        this.#accepting = false;
        this.#loopController.abort(new WorkerShutdownError());
        for (const controller of this.#active.values()) controller.abort(new WorkerShutdownError());
        throw error;
      }))
    ).then(outcomes => {
      const failed = outcomes.find(outcome => outcome.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    });
    return this.#running;
  }

  cancel(jobId: string): boolean {
    const controller = this.#active.get(jobId);
    if (!controller) return false;
    controller.abort(new WorkerJobCancelledError());
    return true;
  }

  async stop(graceMs = 10_000): Promise<{ drained: boolean; aborted: number }> {
    if (!Number.isInteger(graceMs) || graceMs < 0) throw new WorkerConfigurationError("graceMs must be non-negative");
    this.#accepting = false;
    this.#loopController.abort(new WorkerShutdownError());
    if (this.#active.size === 0) {
      await this.#running?.catch(() => undefined);
      return { drained: true, aborted: 0 };
    }
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const drained = await Promise.race([
      this.#waitForActiveJobs().then(() => true),
      new Promise<false>((resolve) => { graceTimer = setTimeout(() => resolve(false), graceMs); })
    ]);
    clearTimeout(graceTimer);
    if (drained) {
      await this.#running?.catch(() => undefined);
      return { drained: true, aborted: 0 };
    }
    const controllers = [...this.#active.values()];
    controllers.forEach((controller) => controller.abort(new WorkerShutdownError()));
    await this.#waitForActiveJobs();
    await this.#running?.catch(() => undefined);
    return { drained: false, aborted: controllers.length };
  }

  async #loop(): Promise<void> {
    let failures = 0;
    while (this.#accepting) {
      let delayMs = this.#config.pollIntervalMs;
      try {
        const outcome = await this.runOnce();
        failures = 0;
        if (outcome.kind !== "IDLE") continue;
      } catch (error) {
        failures += 1;
        this.#log({ event: "worker_loop_failed", stage: "WORKER_LOOP", code: safeRuntimeErrorCode(error), attempt: failures });
        if (!isTransientStoreError(error)) throw error;
        delayMs = Math.min(500 * 2 ** Math.min(failures - 1, 6), 30_000);
      }
      try {
        await abortableDelay(delayMs, this.#loopController.signal);
      } catch {
        return;
      }
    }
  }

  async #runClaim(claim: WorkerClaim): Promise<WorkerRunOutcome> {
    const controller = new AbortController();
    this.#active.set(claim.jobId, controller);
    const fence: WorkerExecutionFence = {
      jobId: claim.jobId,
      leaseToken: claim.leaseToken,
      generation: claim.generation
    };
    const heartbeat = new LeaseHeartbeat({
      store: this.#config.store,
      fence,
      leaseMs: this.#config.leaseMs,
      heartbeatMs: this.#config.heartbeatMs,
      controller
    });
    heartbeat.start();

    let settlingResult = false;
    try {
      if (claim.deadlineAt.getTime() <= this.#now()) throw new WorkerDeadlineExceededError();
      const result = await this.#config.pipeline.run({
        fence,
        groundingId: claim.groundingId,
        operation: claim.operation,
        deadlineAt: claim.deadlineAt,
        maxResultBytes: claim.maxResultBytes,
        initialState: claim.initialState,
        immutableLocks: claim.immutableLocks,
        signal: controller.signal
      });
      if (controller.signal.aborted) throw controller.signal.reason;
      const status = result.status;
      if (status === "CANCELLED") throw new WorkerJobCancelledError();
      settlingResult = true;
      return await this.#settle(fence, {
        kind: "RESULT",
        status,
        resultHash: result.resultHash,
        resultBytes: result.resultBytes
      }, status === "FAILED" ? "FAILED" : "SUCCEEDED");
    } catch (caught) {
      // A transport error may follow a successful COMMIT. Leave the durable
      // state untouched; the next claim/recovery determines its actual state.
      const code = safeRuntimeErrorCode(caught);
      if (isTransientStoreError(caught) || (settlingResult && ![
        "WORKER_RESULT_INVALID", "GROUNDING_RESULT_SCHEMA_INVALID", "GROUNDING_RESULT_MAX_BYTES_EXCEEDED"
      ].includes(code))) throw caught;
      if (!controller.signal.aborted && (code === "WORKER_RUNTIME_ERROR" || caught instanceof WorkerConfigurationError)) throw caught;
      const error = controller.signal.aborted ? controller.signal.reason : caught;
      this.#log({ event: "worker_job_failed", stage: pipelineStage(error) ?? "WORKER_JOB",
        code: safeRuntimeErrorCode(error), jobId: claim.jobId, attempt: claim.attempt });
      if (error instanceof WorkerLeaseLostError) return { kind: "FENCE_REJECTED", jobId: claim.jobId };
      if (error instanceof WorkerJobCancelledError) {
        return this.#settle(fence, {
          kind: "CANCELLED",
          errorCode: "WORKER_JOB_CANCELLED",
          retryable: false
        }, "CANCELLED");
      }
      const retry = error instanceof WorkerShutdownError || (isRetryable(error) && claim.attempt < this.#config.maxJobAttempts);
      if (retry) {
        const backoffMs = Math.min(this.#config.retryBackoffMs * 2 ** Math.max(0, claim.attempt - 1), 30_000);
        const failedStage = pipelineStage(error);
        return this.#settle(fence, {
          kind: "RETRY",
          errorCode: errorCode(error),
          ...(failedStage ? { pipelineStage: failedStage } : {}),
          retryable: true,
          availableAt: new Date(this.#now() + backoffMs)
        }, "RETRY_SCHEDULED");
      }
      const failedStage = pipelineStage(error);
      return this.#settle(fence, {
        kind: "FAILED",
        errorCode: errorCode(error),
        ...(failedStage ? { pipelineStage: failedStage } : {}),
        retryable: false
      }, "FAILED");
    } finally {
      await heartbeat.stop();
      this.#active.delete(claim.jobId);
    }
  }

  async #settle(
    fence: WorkerExecutionFence,
    settlement: WorkerSettlement,
    appliedKind: "SUCCEEDED" | "RETRY_SCHEDULED" | "FAILED" | "CANCELLED"
  ): Promise<WorkerRunOutcome> {
    const outcome: WorkerSettlementOutcome = await this.#config.store.settle(fence, settlement);
    return outcome === "APPLIED"
      ? { kind: appliedKind, jobId: fence.jobId }
      : { kind: "FENCE_REJECTED", jobId: fence.jobId };
  }

  async #waitForActiveJobs(): Promise<void> {
    while (this.#active.size > 0) await new Promise((resolve) => setTimeout(resolve, 5));
  }

  #validateConfig(): void {
    if (!this.#config.workerId.trim()) throw new WorkerConfigurationError("workerId is required");
    for (const [name, value, minimum] of [
      ["leaseMs", this.#config.leaseMs, 100],
      ["heartbeatMs", this.#config.heartbeatMs, 10],
      ["pollIntervalMs", this.#config.pollIntervalMs, 1],
      ["concurrency", this.#config.concurrency, 1],
      ["maxJobAttempts", this.#config.maxJobAttempts, 1],
      ["retryBackoffMs", this.#config.retryBackoffMs, 0]
    ] as const) {
      if (!Number.isInteger(value) || value < minimum) {
        throw new WorkerConfigurationError(`${name} must be an integer of at least ${minimum}`);
      }
    }
    if (this.#config.heartbeatMs * 2 >= this.#config.leaseMs) {
      throw new WorkerConfigurationError("heartbeatMs must be less than half of leaseMs");
    }
  }
}
