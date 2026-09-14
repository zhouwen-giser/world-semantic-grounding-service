import { expect, it } from "vitest";
import { apiOptionsFromEnvironment } from "./environment.js";

it("loads API limits and logging switches, rejecting invalid limits", () => {
  expect(apiOptionsFromEnvironment({ WSGS_API_BODY_LIMIT_BYTES: "2048", WSGS_API_LOG_ENABLED: "NO", WSGS_API_RATE_LIMIT_REQUESTS: "5", WSGS_API_RATE_LIMIT_WINDOW_MS: "1000", WSGS_API_RATE_LIMIT_MAX_KEYS: "20" })).toEqual({ logger: false, bodyLimitBytes: 2048, rateBudget: { requests: 5, windowMs: 1000, maxTrackedKeys: 20 } });
  expect(apiOptionsFromEnvironment({}).logger).toBe(true);
  expect(() => apiOptionsFromEnvironment({ WSGS_API_RATE_LIMIT_REQUESTS: "0" })).toThrow();
  expect(() => apiOptionsFromEnvironment({ WSGS_API_LOG_ENABLED: "unknown" })).toThrow();
});
