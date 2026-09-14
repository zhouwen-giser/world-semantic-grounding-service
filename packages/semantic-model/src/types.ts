import type { WorldSemanticFrame } from "@wsgs/contracts";

export const modelOutputModes = [
  "RESPONSES_STRICT",
  "CHAT_COMPLETIONS_STRICT",
  "CHAT_COMPLETIONS_JSON"
] as const;

export type ModelOutputMode = (typeof modelOutputModes)[number];

export const semanticModelPolicyModes = ["MODEL_REQUIRED", "MODEL_OPTIONAL"] as const;

export type SemanticModelPolicyMode = (typeof semanticModelPolicyModes)[number];

export interface SemanticModelInput {
  sourceText: string;
  locale?: string;
  excludedSpans?: ReadonlyArray<{ start: number; end: number }>;
}

export interface ModelReceipt {
  receiptVersion: "1.0";
  status: "SUCCEEDED" | "FAILED";
  modelHash: string;
  promptVersion: string;
  promptHash: string;
  schemaHash: string;
  inputHash: string;
  outputHash: string;
  requestIdHash?: string;
  attempts: number;
  elapsedMs: number;
  failureCode?: string;
}

export interface SemanticModelResult {
  frame: WorldSemanticFrame;
  receipt: ModelReceipt;
}

/** Metadata only: never contains prompts, model text, credentials or provider error bodies. */
export interface ModelDiagnostic {
  event: "MODEL_ATTEMPT_STARTED" | "MODEL_HEADERS" | "MODEL_BODY_COMPLETE" | "MODEL_ATTEMPT_FAILED" | "MODEL_FINISHED" | "MODEL_BUDGET";
  elapsedMs: number;
  attempt?: number;
  attemptElapsedMs?: number;
  httpStatus?: number;
  requestIdHash?: string;
  code?: string;
  receipt?: ModelReceipt;
  remainingMs?: number;
  reserveMs?: number;
  budgetMs?: number;
}
export type ModelObserver = (diagnostic: ModelDiagnostic) => void;

export interface SemanticModelParser {
  parse(input: SemanticModelInput, signal?: AbortSignal, observe?: ModelObserver): Promise<SemanticModelResult>;
}

export type SemanticModelPolicyResult =
  | {
      status: "AVAILABLE";
      completionStatus: "COMPLETE";
      frame: WorldSemanticFrame;
      receipt: ModelReceipt;
      warnings: [];
    }
  | {
      status: "UNAVAILABLE";
      completionStatus: "PARTIAL";
      frame: WorldSemanticFrame;
      failureCode: string;
      receipt?: ModelReceipt;
      warnings: string[];
    };

export interface SemanticModelAdapterConfig {
  baseUrl: string | URL;
  apiKey: string;
  model: string;
  outputMode?: ModelOutputMode;
  timeoutMs?: number;
  maxRetries?: number;
  maxResponseBytes?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export type WorldSemanticFrameValidator = (value: unknown) => value is WorldSemanticFrame;
