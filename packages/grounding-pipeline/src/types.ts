export const PIPELINE_STAGES = [
  "LOAD_CONTEXT",
  "DETERMINISTIC_PARSE",
  "SEMANTIC_MODEL_PARSE",
  "SEMANTIC_FRAME_VALIDATE",
  "GROUNDING_GRAPH_BUILD",
  "REFERENCE_RESOLVE",
  "REFERENCE_VALIDATE",
  "REQUIREMENT_PLAN",
  "CAPABILITY_MATCH",
  "WORLD_QUERY_COMPILE",
  "GOWM_EXECUTE",
  "EVIDENCE_NORMALIZE",
  "PRODUCT_ASSEMBLE",
  "RESULT_PERSIST"
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const GROUNDING_OPERATIONS = [
  "GROUND_REFERENCES",
  "VALIDATE_REFERENCES",
  "COMPILE_WORLD_QUERY",
  "EXECUTE_WORLD_QUERY",
  "VALIDATE_SOURCE_CURRENTNESS"
] as const;

export type GroundingOperation = (typeof GROUNDING_OPERATIONS)[number];

export const PIPELINE_TERMINAL_STATUSES = [
  "COMPLETED",
  "PARTIAL",
  "AMBIGUOUS",
  "UNRESOLVED",
  "FAILED",
  "CANCELLED"
] as const;

export type PipelineTerminalStatus = (typeof PIPELINE_TERMINAL_STATUSES)[number];
export type PipelineEventStatus = "STARTED" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";

export interface ExecutionFence {
  jobId: string;
  leaseToken: string;
  generation: number;
}

export interface PipelineStageEvent {
  groundingId: string;
  stage: PipelineStage;
  attempt: number;
  generation: number;
  status: PipelineEventStatus;
  inputHash: string;
  outputHash?: string;
  elapsedMs: number;
  errorCode?: string;
  createdAt: string;
}

export interface PipelineEventRecord {
  jobId: string;
  sequence: number;
  stageExecutionId: string;
  runFingerprint: string;
  previousRecordHash?: string;
  recordHash: string;
  event: PipelineStageEvent;
}

export interface PipelineCheckpoint {
  schemaVersion: "1.0";
  jobId: string;
  operation: GroundingOperation;
  runFingerprint: string;
  nextStageIndex: number;
  nextEventSequence: number;
  state: Readonly<Record<string, unknown>>;
  previousRecordHash: string;
  lastCompletedStage?: PipelineStage;
}

export interface PipelineJournal {
  loadLatestCheckpoint(jobId: string, runFingerprint: string): Promise<PipelineCheckpoint | null>;
  recordStarted(fence: ExecutionFence, record: PipelineEventRecord): Promise<boolean>;
  recordTerminal(
    fence: ExecutionFence,
    record: PipelineEventRecord,
    checkpoint?: PipelineCheckpoint
  ): Promise<boolean>;
}

export interface PipelineStageContext {
  jobId: string;
  leaseToken: string;
  groundingId: string;
  operation: GroundingOperation;
  generation: number;
  stage: PipelineStage;
  attempt: number;
  stageExecutionId: string;
  runFingerprint: string;
  deadlineAt: Date;
  immutableLocks: unknown;
  state: Readonly<Record<string, unknown>>;
  signal: AbortSignal;
}

export interface PipelineStageExecutor {
  execute(stage: PipelineStage, context: PipelineStageContext): Promise<unknown>;
}

export interface PipelineStagePolicy {
  maxAttempts: number;
  attemptTimeoutMs: number;
  baseBackoffMs: number;
  retryable(error: unknown): boolean;
}

export type PipelinePolicyResolver = (stage: PipelineStage) => PipelineStagePolicy;

export interface PipelineRunInput {
  fence: ExecutionFence;
  groundingId: string;
  operation: GroundingOperation;
  deadlineAt: Date;
  initialState: Readonly<Record<string, unknown>>;
  immutableLocks: unknown;
  maxResultBytes: number;
  signal?: AbortSignal;
}

export interface PipelineTerminalValue {
  status: PipelineTerminalStatus;
  value: unknown;
}

export interface PipelineRunResult {
  status: PipelineTerminalStatus;
  value: unknown;
  resultHash: string;
  resultBytes: Uint8Array;
  runFingerprint: string;
  completedStages: readonly PipelineStage[];
  recoveredStages: readonly PipelineStage[];
}

export type PipelineStageHandler = (context: PipelineStageContext) => Promise<unknown>;

export class PipelineConfigurationError extends Error {
  readonly code = "PIPELINE_CONFIGURATION_ERROR";
}

export class PipelineFenceRejectedError extends Error {
  readonly code = "PIPELINE_FENCE_REJECTED";

  constructor() {
    super("The worker no longer owns the pipeline execution fence");
  }
}

export class PipelineCancelledError extends Error {
  readonly code = "PIPELINE_CANCELLED";

  constructor() {
    super("The grounding pipeline was cancelled");
  }
}

export class PipelineDeadlineExceededError extends Error {
  readonly code = "PIPELINE_DEADLINE_EXCEEDED";

  constructor(readonly stage?: PipelineStage) {
    super("The grounding pipeline deadline elapsed");
  }
}

export class PipelineStageAttemptTimeoutError extends Error {
  readonly code = "PIPELINE_STAGE_ATTEMPT_TIMEOUT";
  readonly retryable = true;

  constructor(readonly stage: PipelineStage) {
    super(`Pipeline stage ${stage} exceeded its per-attempt timeout`);
  }
}

export class PipelineResultTooLargeError extends Error {
  readonly code = "PIPELINE_RESULT_TOO_LARGE";

  constructor(readonly actualBytes: number, readonly maximumBytes: number) {
    super(`Pipeline result is ${actualBytes} bytes; maximum is ${maximumBytes}`);
  }
}
