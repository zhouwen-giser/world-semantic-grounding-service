/** Lease loss, shutdown and per-attempt timeout remain resumable. */
export function shouldCancelUpstreamQuery(signal: AbortSignal | undefined, deadlineAt: Date): boolean {
  if (Date.now() >= deadlineAt.getTime()) return true;
  if (!signal?.aborted) return false;
  const reason: unknown = signal.reason;
  const code = reason && typeof reason === "object" && "code" in reason ? reason.code : undefined;
  return code === undefined || (reason instanceof Error && reason.name === "AbortError") ||
    code === "WORKER_JOB_CANCELLED" || code === "PIPELINE_CANCELLED";
}
