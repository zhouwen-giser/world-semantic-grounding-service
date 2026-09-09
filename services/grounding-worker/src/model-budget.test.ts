import { afterEach, describe, expect, it, vi } from "vitest";
import type { SemanticModelParser, SemanticModelResult } from "@wsgs/semantic-model";
import { parseWithModelBudget } from "./model-budget.js";

const result: SemanticModelResult = {
  frame: { schemaVersion: "1.0", mentions: [], spatialExpressions: [], relationExpressions: [], temporalConstraints: [], aggregationExpressions: [], rankingExpressions: [] },
  receipt: { receiptVersion: "1.0", status: "SUCCEEDED", modelHash: "h", promptHash: "h", promptVersion: "v", schemaHash: "h", inputHash: "h", outputHash: "h", attempts: 1, elapsedMs: 1 }
};
afterEach(() => vi.useRealTimers());
describe("model budget inside the original task deadline", () => {
  it("reserves 30 seconds after admission and rejects a late model without retrying", async () => {
    vi.useFakeTimers(); vi.setSystemTime(27_000);
    let modelSignal: AbortSignal | undefined;
    const parse = vi.fn((_: unknown, signal?: AbortSignal) => { modelSignal = signal; return new Promise<SemanticModelResult>(() => undefined); });
    const pending = parseWithModelBudget({ parse }, { sourceText: "STOP" }, "MODEL_REQUIRED", new Date(120_000), new AbortController().signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: "MODEL_BUDGET_EXCEEDED", retryable: false });
    await vi.advanceTimersByTimeAsync(63_000); await rejected;
    expect(Date.now()).toBe(90_000); expect(modelSignal?.aborted).toBe(true); expect(parse).toHaveBeenCalledTimes(1);
  });
  it("returns an on-time frame and clears its timer", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    expect(await parseWithModelBudget({ parse: async () => result }, { sourceText: "STOP" }, "MODEL_REQUIRED", new Date(120_000), new AbortController().signal)).toMatchObject({ status: "AVAILABLE", frame: result.frame });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["MODEL_REQUIRED", "MODEL_OPTIONAL"] as const)("preserves caller cancellation in %s mode", async mode => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const controller = new AbortController(); const reason = new Error("shutdown");
    const parser: SemanticModelParser = { parse: async () => new Promise(() => undefined) };
    const pending = parseWithModelBudget(parser, { sourceText: "STOP" }, mode, new Date(120_000), controller.signal);
    const rejected = expect(pending).rejects.toBe(reason); controller.abort(reason); await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps optional degradation explicit and does not launch an expired model request", async () => {
    vi.useFakeTimers(); vi.setSystemTime(120_001);
    const parse = vi.fn(async () => result);
    expect(await parseWithModelBudget({ parse }, { sourceText: "STOP" }, "MODEL_OPTIONAL", new Date(120_000), new AbortController().signal)).toMatchObject({ status: "UNAVAILABLE", failureCode: "MODEL_BUDGET_EXCEEDED" });
    expect(parse).not.toHaveBeenCalled();
  });
});
