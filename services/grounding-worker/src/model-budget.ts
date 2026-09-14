import { SemanticModelError, parseSemanticModelWithPolicy, type ModelObserver, type ModelReceipt, type SemanticModelInput, type SemanticModelParser, type SemanticModelPolicyMode } from "@wsgs/semantic-model";

/** Reserve time for grounding and execution within the original job deadline. */
export async function parseWithModelBudget(
  parser: SemanticModelParser, input: SemanticModelInput, mode: SemanticModelPolicyMode,
  deadlineAt: Date, signal: AbortSignal, now: () => number = Date.now, observe?: ModelObserver
) {
  const remaining = deadlineAt.getTime() - now();
  const reserve = Math.min(30_000, Math.ceil(remaining / 2));
  const budget = remaining - reserve;
  let receipt: ModelReceipt | undefined;
  const observed: ModelObserver = event => {
    if (event.receipt) receipt = event.receipt;
    try { observe?.(event); } catch { /* Metadata logging must not affect the deadline. */ }
  };
  observed({ event: "MODEL_BUDGET", elapsedMs: 0, remainingMs: remaining, reserveMs: reserve, budgetMs: Math.max(0, budget) });
  const bounded: SemanticModelParser = { parse: async (value) => {
    if (signal.aborted) throw signal.reason;
    if (budget <= 0) throw new SemanticModelError("MODEL_BUDGET_EXCEEDED", false);
    const controller = new AbortController();
    const forward = () => controller.abort(signal.reason);
    signal.addEventListener("abort", forward, { once: true });
    const timer = setTimeout(() => controller.abort(new SemanticModelError("MODEL_BUDGET_EXCEEDED", false)), budget);
    let rejectAbort: () => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    try {
      const result = await Promise.race([parser.parse(value, controller.signal, observed), aborted]);
      if (controller.signal.aborted) throw controller.signal.reason;
      return result;
    } catch (error) {
      if (error instanceof SemanticModelError && receipt && !error.receipt) {
        throw new SemanticModelError(error.code, error.retryable, { ...receipt, status: "FAILED", failureCode: error.code });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", forward);
      controller.signal.removeEventListener("abort", rejectAbort);
    }
  } };
  try {
    const result = await parseSemanticModelWithPolicy(bounded, input, mode, signal);
    if (signal.aborted) throw signal.reason;
    return result;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof SemanticModelError && receipt && !error.receipt) {
      throw new SemanticModelError(error.code, error.retryable, { ...receipt, status: "FAILED", failureCode: error.code });
    }
    throw error;
  }
}
