import { canonicalBytes, canonicalSha256 } from "./canonical.js";
import {
  PIPELINE_STAGES,
  PIPELINE_TERMINAL_STATUSES,
  PipelineCancelledError,
  PipelineConfigurationError,
  PipelineDeadlineExceededError,
  PipelineFenceRejectedError,
  PipelineResultTooLargeError,
  PipelineStageAttemptTimeoutError,
  type GroundingOperation,
  type PipelineCheckpoint,
  type PipelineEventRecord,
  type PipelineEventStatus,
  type PipelineJournal,
  type PipelinePolicyResolver,
  type PipelineRunInput,
  type PipelineRunResult,
  type PipelineStage,
  type PipelineStageExecutor,
  type PipelineStagePolicy,
  type PipelineTerminalStatus,
  type PipelineTerminalValue
} from "./types.js";

const OPERATION_PLANS: Readonly<Record<GroundingOperation, readonly PipelineStage[]>> = Object.freeze({
  GROUND_REFERENCES: Object.freeze([
    "LOAD_CONTEXT",
    "DETERMINISTIC_PARSE",
    "SEMANTIC_MODEL_PARSE",
    "SEMANTIC_FRAME_VALIDATE",
    "GROUNDING_GRAPH_BUILD",
    "REFERENCE_RESOLVE",
    "REFERENCE_VALIDATE",
    "PRODUCT_ASSEMBLE"
  ] as const),
  VALIDATE_REFERENCES: Object.freeze([
    "LOAD_CONTEXT",
    "REFERENCE_VALIDATE",
    "PRODUCT_ASSEMBLE"
  ] as const),
  COMPILE_WORLD_QUERY: Object.freeze([
    "LOAD_CONTEXT",
    "DETERMINISTIC_PARSE",
    "SEMANTIC_MODEL_PARSE",
    "SEMANTIC_FRAME_VALIDATE",
    "GROUNDING_GRAPH_BUILD",
    "REFERENCE_RESOLVE",
    "REFERENCE_VALIDATE",
    "REQUIREMENT_PLAN",
    "CAPABILITY_MATCH",
    "WORLD_QUERY_COMPILE"
  ] as const),
  EXECUTE_WORLD_QUERY: PIPELINE_STAGES
});

const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const retryableStages = new Set<PipelineStage>([
  "SEMANTIC_MODEL_PARSE",
  "REFERENCE_RESOLVE",
  "REFERENCE_VALIDATE",
  "GOWM_EXECUTE"
]);

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  if (record["retryable"] === true) return true;
  const status = record["status"] ?? record["statusCode"];
  return typeof status === "number" && retryableStatuses.has(status);
}

export function defaultPipelineStagePolicy(stage: PipelineStage): PipelineStagePolicy {
  const external = retryableStages.has(stage);
  return {
    maxAttempts: external ? 3 : 1,
    attemptTimeoutMs: external ? 30_000 : 15_000,
    baseBackoffMs: external ? 100 : 0,
    retryable: isRetryable
  };
}

export function pipelinePlanForOperation(operation: GroundingOperation): readonly PipelineStage[] {
  return OPERATION_PLANS[operation];
}

function assertPolicy(policy: PipelineStagePolicy): void {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 10) {
    throw new PipelineConfigurationError("maxAttempts must be an integer from 1 through 10");
  }
  if (!Number.isInteger(policy.attemptTimeoutMs) || policy.attemptTimeoutMs < 1) {
    throw new PipelineConfigurationError("attemptTimeoutMs must be a positive integer");
  }
  if (!Number.isInteger(policy.baseBackoffMs) || policy.baseBackoffMs < 0 || policy.baseBackoffMs > 30_000) {
    throw new PipelineConfigurationError("baseBackoffMs must be an integer from 0 through 30000");
  }
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as Record<string, unknown>)["code"];
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,127}$/u.test(code)) return code;
    if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{1,127}$/u.test(error.name)) return error.name;
  }
  return "PIPELINE_STAGE_FAILED";
}

function eventRecord(
  input: Omit<PipelineEventRecord, "recordHash">
): PipelineEventRecord {
  const deterministicEvent = {
    ...input.event,
    elapsedMs: 0,
    createdAt: "1970-01-01T00:00:00.000Z"
  };
  return {
    ...input,
    recordHash: canonicalSha256({ ...input, event: deterministicEvent })
  };
}

function statusForError(error: unknown, signal: AbortSignal): PipelineEventStatus {
  if (signal.aborted || error instanceof PipelineCancelledError) return "CANCELLED";
  return "FAILED";
}

function cancellationError(signal: AbortSignal, now: number, deadlineAt: Date, stage?: PipelineStage): Error {
  if (now >= deadlineAt.getTime()) return new PipelineDeadlineExceededError(stage);
  if (signal.reason instanceof PipelineDeadlineExceededError) return signal.reason;
  if (signal.reason instanceof PipelineStageAttemptTimeoutError) return signal.reason;
  // Preserve the worker runtime's typed shutdown/lease reasons. The worker
  // uses those codes to requeue or fence a checkpointed job; arbitrary caller
  // abort reasons remain normal pipeline cancellation.
  if (signal.reason instanceof Error && /^WORKER_[A-Z0-9_]+$/u.test(
    String((signal.reason as Error & { code?: unknown }).code ?? "")
  )) return signal.reason;
  return new PipelineCancelledError();
}

function terminalValue(value: unknown): PipelineTerminalValue {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const status = record["status"];
    if (typeof status === "string" && (PIPELINE_TERMINAL_STATUSES as readonly string[]).includes(status)) {
      return {
        status: status as PipelineTerminalStatus,
        value: "value" in record ? record["value"] : value
      };
    }
  }
  return { status: "COMPLETED", value };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function canonicalResultMaterial(value: unknown): unknown {
  if (!isPlainRecord(value)) return value;
  const material = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "resultHash"));
  const execution = material["execution"];
  if (isPlainRecord(execution)) {
    material["execution"] = Object.fromEntries(Object.entries(execution).filter(([key]) => key !== "elapsedMs"));
  }
  return material;
}

function materializeResult(
  value: unknown,
  runFingerprint: string,
  maxResultBytes: number
): Pick<PipelineRunResult, "status" | "value" | "resultHash" | "resultBytes"> {
  const final = terminalValue(value);
  const hashMaterial = canonicalResultMaterial(final.value);
  const resultHash = canonicalSha256({ runFingerprint, status: final.status, value: hashMaterial });
  const resultValue = isPlainRecord(final.value)
    ? { ...final.value, resultHash }
    : { schemaVersion: "1.0", status: final.status, value: final.value, resultHash };
  const resultBytes = canonicalBytes(resultValue);
  if (resultBytes.byteLength > maxResultBytes) {
    throw new PipelineResultTooLargeError(resultBytes.byteLength, maxResultBytes);
  }
  return { status: final.status, value: resultValue, resultHash, resultBytes };
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal.aborted) throw new PipelineCancelledError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, ms);
    const aborted = (): void => {
      clearTimeout(timer);
      reject(new PipelineCancelledError());
    };
    signal.addEventListener("abort", aborted, { once: true });
  });
}

export interface GroundingPipelineConfig {
  executor: PipelineStageExecutor;
  journal: PipelineJournal;
  policy?: PipelinePolicyResolver;
  now?: () => number;
}

export class GroundingPipeline {
  readonly #executor: PipelineStageExecutor;
  readonly #journal: PipelineJournal;
  readonly #policy: PipelinePolicyResolver;
  readonly #now: () => number;

  constructor(config: GroundingPipelineConfig) {
    this.#executor = config.executor;
    this.#journal = config.journal;
    this.#policy = config.policy ?? defaultPipelineStagePolicy;
    this.#now = config.now ?? Date.now;
  }

  async run(input: PipelineRunInput): Promise<PipelineRunResult> {
    if (!Number.isInteger(input.fence.generation) || input.fence.generation < 1) {
      throw new PipelineConfigurationError("generation must be a positive integer");
    }
    if (!Number.isInteger(input.maxResultBytes) || input.maxResultBytes < 1) {
      throw new PipelineConfigurationError("maxResultBytes must be a positive integer");
    }
    if (!Number.isFinite(input.deadlineAt.getTime())) throw new PipelineConfigurationError("deadlineAt is invalid");

    const plan = pipelinePlanForOperation(input.operation);
    const runFingerprint = canonicalSha256({
      operation: input.operation,
      plan,
      initialState: input.initialState,
      immutableLocks: input.immutableLocks
    });
    const checkpoint = await this.#journal.loadLatestCheckpoint(input.fence.jobId, runFingerprint);
    this.#assertCheckpoint(checkpoint, input, plan, runFingerprint);

    let state: Readonly<Record<string, unknown>> = checkpoint ? { ...checkpoint.state } : { ...input.initialState };
    let nextStageIndex = checkpoint?.nextStageIndex ?? 0;
    let sequence = checkpoint?.nextEventSequence ?? 0;
    let previousRecordHash = checkpoint?.previousRecordHash;
    const recoveredStages = plan.slice(0, nextStageIndex);
    const completedStages: PipelineStage[] = [...recoveredStages];
    const signal = input.signal ?? new AbortController().signal;
    let materialized: Pick<PipelineRunResult, "status" | "value" | "resultHash" | "resultBytes"> | undefined;

    for (; nextStageIndex < plan.length; nextStageIndex += 1) {
      const stage = plan[nextStageIndex];
      if (!stage) throw new PipelineConfigurationError("Pipeline plan contains a missing stage");
      if (signal.aborted) throw cancellationError(signal, this.#now(), input.deadlineAt, stage);
      if (this.#now() >= input.deadlineAt.getTime()) throw new PipelineDeadlineExceededError(stage);
      const policy = this.#policy(stage);
      assertPolicy(policy);
      const stageExecutionId = canonicalSha256({ jobId: input.fence.jobId, runFingerprint, stage });
      const inputHash = canonicalSha256(state);

      for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
        const attemptStartedAt = this.#now();
        const started = eventRecord({
          jobId: input.fence.jobId,
          sequence,
          stageExecutionId,
          runFingerprint,
          ...(previousRecordHash ? { previousRecordHash } : {}),
          event: {
            groundingId: input.groundingId,
            stage,
            attempt,
            generation: input.fence.generation,
            status: "STARTED",
            inputHash,
            elapsedMs: 0,
            createdAt: new Date(attemptStartedAt).toISOString()
          }
        });
        if (!(await this.#journal.recordStarted(input.fence, started))) throw new PipelineFenceRejectedError();
        sequence += 1;
        previousRecordHash = started.recordHash;

        try {
          const output = await this.#executeAttempt({
            input,
            stage,
            attempt,
            stageExecutionId,
            runFingerprint,
            state,
            signal,
            policy
          });
          const outputValue = output ?? null;
          const stageMaterialized = nextStageIndex === plan.length - 1
            ? materializeResult(outputValue, runFingerprint, input.maxResultBytes)
            : undefined;
          const terminalStageStatus: PipelineEventStatus = stageMaterialized?.status === "PARTIAL"
            ? "PARTIAL"
            : stageMaterialized?.status === "FAILED"
              ? "FAILED"
              : stageMaterialized?.status === "CANCELLED"
                ? "CANCELLED"
                : "COMPLETED";
          const nextState = Object.freeze({ ...state, [stage]: outputValue });
          const completed = eventRecord({
            jobId: input.fence.jobId,
            sequence,
            stageExecutionId,
            runFingerprint,
            previousRecordHash,
            event: {
              groundingId: input.groundingId,
              stage,
              attempt,
              generation: input.fence.generation,
              status: terminalStageStatus,
              inputHash,
              outputHash: canonicalSha256(outputValue),
              elapsedMs: Math.max(0, Math.trunc(this.#now() - attemptStartedAt)),
              createdAt: new Date(this.#now()).toISOString()
            }
          });
          const nextCheckpoint: PipelineCheckpoint = {
            schemaVersion: "1.0",
            jobId: input.fence.jobId,
            operation: input.operation,
            runFingerprint,
            nextStageIndex: nextStageIndex + 1,
            nextEventSequence: sequence + 1,
            state: nextState,
            previousRecordHash: completed.recordHash,
            lastCompletedStage: stage
          };
          if (!(await this.#journal.recordTerminal(input.fence, completed, nextCheckpoint))) {
            throw new PipelineFenceRejectedError();
          }
          sequence += 1;
          previousRecordHash = completed.recordHash;
          state = nextState;
          completedStages.push(stage);
          if (stageMaterialized) materialized = stageMaterialized;
          break;
        } catch (caught) {
          if (caught instanceof PipelineFenceRejectedError) throw caught;
          const failure = signal.aborted ? cancellationError(signal, this.#now(), input.deadlineAt, stage) : caught;
          const terminal = eventRecord({
            jobId: input.fence.jobId,
            sequence,
            stageExecutionId,
            runFingerprint,
            previousRecordHash,
            event: {
              groundingId: input.groundingId,
              stage,
              attempt,
              generation: input.fence.generation,
              status: statusForError(failure, signal),
              inputHash,
              elapsedMs: Math.max(0, Math.trunc(this.#now() - attemptStartedAt)),
              errorCode: errorCode(failure),
              createdAt: new Date(this.#now()).toISOString()
            }
          });
          const failureCheckpoint: PipelineCheckpoint = {
            schemaVersion: "1.0",
            jobId: input.fence.jobId,
            operation: input.operation,
            runFingerprint,
            nextStageIndex,
            nextEventSequence: sequence + 1,
            state,
            previousRecordHash: terminal.recordHash,
            ...(nextStageIndex > 0 && plan[nextStageIndex - 1]
              ? { lastCompletedStage: plan[nextStageIndex - 1] }
              : {})
          };
          if (!(await this.#journal.recordTerminal(input.fence, terminal, failureCheckpoint))) {
            throw new PipelineFenceRejectedError();
          }
          sequence += 1;
          previousRecordHash = terminal.recordHash;

          const canRetry = attempt < policy.maxAttempts && !signal.aborted && policy.retryable(failure);
          if (!canRetry) throw failure;
          const remainingMs = input.deadlineAt.getTime() - this.#now();
          const backoffMs = Math.min(policy.baseBackoffMs * 2 ** (attempt - 1), 5_000);
          if (remainingMs <= backoffMs) throw new PipelineDeadlineExceededError(stage);
          await wait(backoffMs, signal);
        }
      }
    }

    const finalStage = plan.at(-1);
    if (!finalStage) throw new PipelineConfigurationError("Pipeline plan is empty");
    materialized ??= materializeResult(state[finalStage], runFingerprint, input.maxResultBytes);
    return {
      ...materialized,
      runFingerprint,
      completedStages,
      recoveredStages
    };
  }

  async #executeAttempt(args: {
    input: PipelineRunInput;
    stage: PipelineStage;
    attempt: number;
    stageExecutionId: string;
    runFingerprint: string;
    state: Readonly<Record<string, unknown>>;
    signal: AbortSignal;
    policy: PipelineStagePolicy;
  }): Promise<unknown> {
    const remainingMs = args.input.deadlineAt.getTime() - this.#now();
    if (remainingMs <= 0) throw new PipelineDeadlineExceededError(args.stage);
    const timeoutIsDeadline = remainingMs <= args.policy.attemptTimeoutMs;
    const timeoutMs = Math.min(remainingMs, args.policy.attemptTimeoutMs);
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort(
      cancellationError(args.signal, this.#now(), args.input.deadlineAt, args.stage)
    );
    if (args.signal.aborted) forwardAbort();
    else args.signal.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => {
      controller.abort(
        timeoutIsDeadline
          ? new PipelineDeadlineExceededError(args.stage)
          : new PipelineStageAttemptTimeoutError(args.stage)
      );
    }, timeoutMs);

    const execution = Promise.resolve(this.#executor.execute(args.stage, {
      jobId: args.input.fence.jobId,
      leaseToken: args.input.fence.leaseToken,
      groundingId: args.input.groundingId,
      operation: args.input.operation,
      generation: args.input.fence.generation,
      stage: args.stage,
      attempt: args.attempt,
      stageExecutionId: args.stageExecutionId,
      runFingerprint: args.runFingerprint,
      deadlineAt: args.input.deadlineAt,
      immutableLocks: args.input.immutableLocks,
      state: args.state,
      signal: controller.signal
    }));
    void execution.catch(() => undefined);
    const aborted = new Promise<never>((_resolve, reject) => {
      const rejectAborted = (): void => reject(controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new PipelineCancelledError());
      if (controller.signal.aborted) rejectAborted();
      else controller.signal.addEventListener("abort", rejectAborted, { once: true });
    });

    try {
      return await Promise.race([execution, aborted]);
    } finally {
      clearTimeout(timer);
      args.signal.removeEventListener("abort", forwardAbort);
    }
  }

  #assertCheckpoint(
    checkpoint: PipelineCheckpoint | null,
    input: PipelineRunInput,
    plan: readonly PipelineStage[],
    runFingerprint: string
  ): void {
    if (!checkpoint) return;
    if (
      checkpoint.jobId !== input.fence.jobId ||
      checkpoint.operation !== input.operation ||
      checkpoint.runFingerprint !== runFingerprint ||
      !Number.isInteger(checkpoint.nextStageIndex) ||
      checkpoint.nextStageIndex < 0 ||
      checkpoint.nextStageIndex > plan.length ||
      !Number.isInteger(checkpoint.nextEventSequence) ||
      checkpoint.nextEventSequence < 2 ||
      (checkpoint.nextStageIndex === 0
        ? checkpoint.lastCompletedStage !== undefined
        : plan[checkpoint.nextStageIndex - 1] !== checkpoint.lastCompletedStage)
    ) {
      throw new PipelineConfigurationError("Stored pipeline checkpoint is incompatible with this run");
    }
  }
}
