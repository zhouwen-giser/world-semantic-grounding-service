import { describe, expect, it } from "vitest";
import { BoundedWorkQueue, QueueCapacityError, QueueClosedError } from "./work-queue.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("bounded work queue", () => {
  it("bounds queued work while preserving configured concurrency", async () => {
    const firstGate = deferred();
    const order: string[] = [];
    const queue = new BoundedWorkQueue<string>({
      concurrency: 1,
      maxQueued: 1,
      run: async (value) => {
        order.push(value);
        if (value === "first") await firstGate.promise;
      }
    });
    const first = queue.submit("first");
    const second = queue.submit("second");
    await expect(queue.submit("overflow")).rejects.toBeInstanceOf(QueueCapacityError);
    expect(queue.state()).toEqual({ active: 1, queued: 1, accepting: true });
    firstGate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("stops intake, drops local queued work, and aborts an over-grace active task", async () => {
    let abortObserved = false;
    const queue = new BoundedWorkQueue<string>({
      concurrency: 1,
      maxQueued: 1,
      run: async (_value, signal) => new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => { abortObserved = true; resolve(); }, { once: true });
      })
    });
    const active = queue.submit("active");
    const queued = queue.submit("queued");
    const queuedRejection = expect(queued).rejects.toBeInstanceOf(QueueClosedError);
    const shutdown = await queue.shutdown(0);
    await active;
    await queuedRejection;
    await expect(queue.submit("late")).rejects.toBeInstanceOf(QueueClosedError);
    expect(shutdown).toEqual({ drained: false, aborted: 1 });
    expect(abortObserved).toBe(true);
  });

  it("allows active work to drain within the grace period", async () => {
    const queue = new BoundedWorkQueue<string>({ concurrency: 1, maxQueued: 0, run: async () => undefined });
    await queue.submit("short");
    expect(await queue.shutdown(100)).toEqual({ drained: true, aborted: 0 });
  });
});
