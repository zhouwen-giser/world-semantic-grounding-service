import type { PipelineStage } from "@wsgs/grounding-pipeline";

export type WorkerGroundingOperation =
  | "GROUND_REFERENCES"
  | "VALIDATE_REFERENCES"
  | "COMPILE_WORLD_QUERY"
  | "EXECUTE_WORLD_QUERY"
  | "VALIDATE_SOURCE_CURRENTNESS";

export type WorkerTerminalStatus =
  | "COMPLETED"
  | "PARTIAL"
  | "AMBIGUOUS"
  | "UNRESOLVED"
  | "FAILED"
  | "CANCELLED";

export interface WorkerExecutionFence {
  jobId: string;
  leaseToken: string;
  generation: number;
}

export interface WorkerClaim extends WorkerExecutionFence {
  groundingId: string;
  operation: WorkerGroundingOperation;
  attempt: number;
  deadlineAt: Date;
  maxResultBytes: number;
  initialState: Readonly<Record<string, unknown>>;
  immutableLocks: unknown;
}

export interface WorkerHeartbeat {
  owned: boolean;
  cancelRequested: boolean;
}

export type WorkerSettlement =
  | {
      kind: "RESULT";
      status: Exclude<WorkerTerminalStatus, "CANCELLED">;
      resultHash: string;
      resultBytes: Uint8Array;
    }
  | { kind: "FAILED"; errorCode: string; pipelineStage?: PipelineStage; retryable: false }
  | { kind: "RETRY"; errorCode: string; pipelineStage?: PipelineStage; retryable: true; availableAt: Date }
  | { kind: "CANCELLED"; errorCode: "WORKER_JOB_CANCELLED"; retryable: false };

export type WorkerSettlementOutcome = "APPLIED" | "FENCE_REJECTED";

export interface GroundingWorkerStore {
  claimNext(workerId: string, leaseMs: number): Promise<WorkerClaim | null>;
  heartbeat(fence: WorkerExecutionFence, leaseMs: number): Promise<WorkerHeartbeat>;
  settle(fence: WorkerExecutionFence, settlement: WorkerSettlement): Promise<WorkerSettlementOutcome>;
}

export interface WorkerPipelineRunInput {
  fence: WorkerExecutionFence;
  groundingId: string;
  operation: WorkerGroundingOperation;
  deadlineAt: Date;
  maxResultBytes: number;
  initialState: Readonly<Record<string, unknown>>;
  immutableLocks: unknown;
  signal: AbortSignal;
}

export interface WorkerPipelineRunResult {
  status: WorkerTerminalStatus;
  resultHash: string;
  resultBytes: Uint8Array;
}

export interface WorkerPipelineRunner {
  run(input: WorkerPipelineRunInput): Promise<WorkerPipelineRunResult>;
}

export type WorkerRunOutcome =
  | { kind: "IDLE" }
  | { kind: "SUCCEEDED"; jobId: string }
  | { kind: "RETRY_SCHEDULED"; jobId: string }
  | { kind: "FAILED"; jobId: string }
  | { kind: "CANCELLED"; jobId: string }
  | { kind: "FENCE_REJECTED"; jobId: string };

export class WorkerConfigurationError extends Error {
  readonly code = "WORKER_CONFIGURATION_ERROR";
}

export class WorkerJobCancelledError extends Error {
  readonly code = "WORKER_JOB_CANCELLED";
  constructor() {
    super("Grounding job cancellation was requested");
  }
}

export class WorkerLeaseLostError extends Error {
  readonly code = "WORKER_LEASE_LOST";
  constructor() {
    super("Grounding worker lease was lost");
  }
}

export class WorkerShutdownError extends Error {
  readonly code = "WORKER_SHUTDOWN";
  constructor() {
    super("Grounding worker is shutting down");
  }
}

export class WorkerDeadlineExceededError extends Error {
  readonly code = "WORKER_DEADLINE_EXCEEDED";
  constructor() {
    super("Grounding job deadline elapsed");
  }
}
