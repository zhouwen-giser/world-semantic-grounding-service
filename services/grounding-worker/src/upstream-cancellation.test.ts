import { describe, expect, it } from "vitest";
import { shouldCancelUpstreamQuery } from "./upstream-cancellation.js";

describe("upstream cancellation ownership", () => {
  it("cancels at the hard task deadline even without an aborted signal", () => {
    expect(shouldCancelUpstreamQuery(undefined, new Date(0))).toBe(true);
    expect(shouldCancelUpstreamQuery(undefined, new Date(Date.now() + 60_000))).toBe(false);
  });

  it("recognizes an ordinary AbortController cancellation", () => {
    const controller = new AbortController();
    controller.abort();
    expect(shouldCancelUpstreamQuery(controller.signal, new Date(Date.now() + 60_000))).toBe(true);
  });
});
