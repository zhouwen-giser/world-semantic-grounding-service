import { describe, expect, it, vi } from "vitest";
import { SourceCleanupLoop } from "./source-cleanup.js";

describe("source cleanup scheduling", () => {
  it("runs immediately, serializes slow scans, retries failures and stops during a scan", async () => {
    vi.useFakeTimers();
    try {
      let finish!: (count: number) => void;
      const cleanup = vi.fn<() => Promise<number>>()
        .mockRejectedValueOnce(Object.assign(new Error("secret connection string"), { code: "ECONNRESET" }))
        .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const log = vi.fn();
      const loop = new SourceCleanupLoop(cleanup, 60_000, log);
      loop.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(180_000);
      expect(cleanup).toHaveBeenCalledTimes(2);
      let stopped = false;
      const stop = loop.stop().then(() => { stopped = true; });
      await Promise.resolve();
      expect(stopped).toBe(false);
      finish(3);
      await stop;
      expect(log).toHaveBeenCalledWith({ event: "source_cleanup", stage: "SOURCE_CLEANUP", count: 3 });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(cleanup).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("interrupts the interval on stop", async () => {
    const cleanup = vi.fn(async () => 0);
    const loop = new SourceCleanupLoop(cleanup);
    loop.start();
    await Promise.resolve();
    await loop.stop();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648])("rejects invalid interval %s", interval => {
    expect(() => new SourceCleanupLoop(async () => 0, interval)).toThrow();
  });
});
