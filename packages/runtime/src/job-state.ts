export const jobStatuses = [
  "ACCEPTED",
  "RUNNING",
  "COMPLETED",
  "PARTIAL",
  "AMBIGUOUS",
  "UNRESOLVED",
  "FAILED",
  "CANCELLED"
] as const;

export type JobStatus = (typeof jobStatuses)[number];
export type TerminalJobStatus = Exclude<JobStatus, "ACCEPTED" | "RUNNING">;

const terminal = new Set<JobStatus>([
  "COMPLETED",
  "PARTIAL",
  "AMBIGUOUS",
  "UNRESOLVED",
  "FAILED",
  "CANCELLED"
]);

export function isTerminalJobStatus(status: JobStatus): status is TerminalJobStatus {
  return terminal.has(status);
}

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return true;
  if (isTerminalJobStatus(from)) return false;
  if (to === "CANCELLED" || to === "FAILED") return true;
  if (from === "ACCEPTED") return to === "RUNNING";
  return isTerminalJobStatus(to);
}

export class CancellationRegistry {
  readonly #controllers = new Map<string, AbortController>();

  register(jobId: string): AbortSignal {
    const controller = new AbortController();
    this.#controllers.set(jobId, controller);
    return controller.signal;
  }

  cancel(jobId: string, reason = "grounding job cancelled"): boolean {
    const controller = this.#controllers.get(jobId);
    if (!controller) return false;
    controller.abort(new Error(reason));
    return true;
  }

  release(jobId: string): void {
    this.#controllers.delete(jobId);
  }
}
