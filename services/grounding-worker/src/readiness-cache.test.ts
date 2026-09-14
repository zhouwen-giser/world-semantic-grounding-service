import { describe, expect, it, vi } from "vitest";
import { ReadinessCache } from "./readiness-cache.js";

describe("bounded successful readiness cache", () => {
  it("coalesces cold callers and starts TTL after a slow probe completes", async () => {
    let now = 0;
    const cache = new ReadinessCache<number>(() => now);
    let finish!: (value: number) => void;
    const probe = vi.fn(() => new Promise<number>(resolve => { finish = resolve; }));
    const first = cache.get(probe, 60_000), second = cache.get(probe, 60_000);
    await Promise.resolve(); expect(probe).toHaveBeenCalledTimes(1);
    now = 118_000; finish(1); expect(await first).toBe(1); expect(await second).toBe(1);
    now = 177_999; expect(await cache.get(probe, 60_000)).toBe(1);
    expect(probe).toHaveBeenCalledTimes(1);
  });
  it("does not serve expired success after failed refresh, and allows recovery", async () => {
    let now = 0;
    const cache = new ReadinessCache<number>(() => now);
    await cache.get(async () => 1, 5_000);
    now = 5_000;
    await expect(cache.get(async () => { throw new Error("unready"); }, 5_000)).rejects.toThrow("unready");
    expect(await cache.get(async () => 2, 5_000)).toBe(2);
  });
  it("keeps short authority snapshots independent of long model readiness", async () => {
    let now = 0;
    const model = new ReadinessCache<void>(() => now), authority = new ReadinessCache<number>(() => now);
    const parse = vi.fn(async () => undefined), discover = vi.fn(async () => now);
    await model.get(parse, 60_000); await authority.get(discover, 5_000);
    now = 6_000;
    await model.get(parse, 60_000); expect(await authority.get(discover, 5_000)).toBe(6_000);
    expect(parse).toHaveBeenCalledTimes(1); expect(discover).toHaveBeenCalledTimes(2);
  });
});
