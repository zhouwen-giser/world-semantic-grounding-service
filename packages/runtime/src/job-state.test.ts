import { describe, expect, it } from "vitest";

import { CancellationRegistry, canTransitionJob, isTerminalJobStatus } from "./job-state.js";

describe("durable job state invariants", () => {
  it("keeps terminal states monotonic", () => {
    expect(isTerminalJobStatus("COMPLETED")).toBe(true);
    expect(canTransitionJob("ACCEPTED", "RUNNING")).toBe(true);
    expect(canTransitionJob("RUNNING", "PARTIAL")).toBe(true);
    expect(canTransitionJob("COMPLETED", "RUNNING")).toBe(false);
    expect(canTransitionJob("CANCELLED", "COMPLETED")).toBe(false);
  });

  it("propagates cancellation through AbortSignal", () => {
    const registry = new CancellationRegistry();
    const signal = registry.register("job-1");
    expect(signal.aborted).toBe(false);
    expect(registry.cancel("job-1")).toBe(true);
    expect(signal.aborted).toBe(true);
    registry.release("job-1");
    expect(registry.cancel("job-1")).toBe(false);
  });
});
