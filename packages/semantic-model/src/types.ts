import type { WorldSemanticFrame } from "@wsgs/contracts";

export const modelOutputModes = [
  "RESPONSES_STRICT",
  "CHAT_COMPLETIONS_STRICT",
  "CHAT_COMPLETIONS_JSON"
] as const;

export type ModelOutputMode = (typeof modelOutputModes)[number];

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
