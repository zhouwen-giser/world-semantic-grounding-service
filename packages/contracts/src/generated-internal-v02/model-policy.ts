/* Generated from the locked WSGS v0.2 internal JSON Schemas. Do not edit directly. */

export interface ModelPolicy {
  mode: "MODEL_REQUIRED" | "MODEL_OPTIONAL";
  outputMode: "RESPONSES_STRICT" | "CHAT_COMPLETIONS_STRICT" | "CHAT_COMPLETIONS_JSON";
  timeoutMs: number;
  maxRetries: number;
  modelUnavailableBehavior: "FAIL" | "DETERMINISTIC_PARTIAL";
}
