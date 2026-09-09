/** Only known transport/transaction failures are safe to retry at loop level. */
export function isTransientStoreError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === "string" && (
    /^08[0-9A-Z]{3}$/u.test(code) ||
    ["40001", "40P01", "55P03", "57014", "57P01", "57P02", "57P03", "53300",
      "ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN"].includes(code)
  )) return true;
  // node-postgres emits these transport errors without a code. Never log the message.
  return ["Connection terminated unexpectedly", "Connection terminated", "Connection closed",
    "Connection terminated due to connection timeout", "timeout exceeded when trying to connect",
    "Query read timeout"].includes(error.message);
}

export function safeRuntimeErrorCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" && /^[A-Z0-9][A-Z0-9_]{1,127}$/u.test(code) ? code : "WORKER_RUNTIME_ERROR";
}

export interface WorkerRuntimeEvent {
  event: string;
  stage: string;
  code?: string;
  attempt?: number;
  jobId?: string;
  count?: number;
}

export type WorkerRuntimeLogger = (event: WorkerRuntimeEvent) => void;
