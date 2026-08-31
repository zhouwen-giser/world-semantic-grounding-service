export type FormalHttpTimeoutCode =
  | "FORMAL_HTTP_REQUEST_TIMEOUT"
  | "EXTERNAL_WORKER_GROUNDING_TIMEOUT";

export interface FormalHttpRequestOptions {
  readonly timeoutMs: number;
  readonly deadlineAt?: number;
  readonly deadlineTimeoutCode?: FormalHttpTimeoutCode;
}

export function formalHttpRequestTimeoutMs(
  environment: NodeJS.ProcessEnv = process.env
): number {
  const raw = environment["WSGS_FORMAL_HTTP_REQUEST_TIMEOUT_MS"] ?? "10000";
  if (!/^\d+$/u.test(raw)) throw new Error("WSGS_FORMAL_HTTP_REQUEST_TIMEOUT_MS_INVALID");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 60_000) {
    throw new Error("WSGS_FORMAL_HTTP_REQUEST_TIMEOUT_MS_INVALID");
  }
  return value;
}

export async function fetchJsonWithTimeout(
  input: string | URL,
  init: RequestInit,
  options: FormalHttpRequestOptions
): Promise<{ response: Response; body: unknown }> {
  const deadlineTimeoutCode = options.deadlineTimeoutCode ?? "EXTERNAL_WORKER_GROUNDING_TIMEOUT";
  const remainingMs = options.deadlineAt === undefined
    ? options.timeoutMs
    : options.deadlineAt - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    throw new Error(options.deadlineAt === undefined
      ? "FORMAL_HTTP_REQUEST_TIMEOUT"
      : deadlineTimeoutCode);
  }
  const effectiveTimeoutMs = Math.max(1, Math.min(options.timeoutMs, remainingMs));
  const timeoutCode = options.deadlineAt !== undefined && remainingMs <= options.timeoutMs
    ? deadlineTimeoutCode
    : "FORMAL_HTTP_REQUEST_TIMEOUT";
  const controller = new AbortController();
  let firstAbort: "caller" | "timeout" | undefined = init.signal?.aborted ? "caller" : undefined;
  const recordCallerAbort = (): void => {
    firstAbort ??= "caller";
  };
  init.signal?.addEventListener("abort", recordCallerAbort, { once: true });
  const timeout = setTimeout(() => {
    firstAbort ??= "timeout";
    controller.abort();
  }, effectiveTimeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  try {
    const response = await fetch(input, { ...init, signal });
    const body = await response.json();
    return { response, body };
  } catch (error) {
    if (firstAbort === "timeout") throw new Error(timeoutCode);
    throw error;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", recordCallerAbort);
  }
}
