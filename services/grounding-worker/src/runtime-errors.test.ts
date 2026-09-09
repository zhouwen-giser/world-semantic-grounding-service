import { describe, expect, it } from "vitest";
import { isTransientStoreError, safeRuntimeErrorCode } from "./runtime-errors.js";

describe("runtime database error classification", () => {
  it.each(["08006", "40001", "40P01", "55P03", "57014", "57P01", "53300", "ECONNRESET", "ETIMEDOUT", "EPIPE"])(
    "retries %s without exposing its message", code => {
      const error = Object.assign(new Error("secret database password"), { code });
      expect(isTransientStoreError(error)).toBe(true);
      expect(safeRuntimeErrorCode(error)).toBe(code);
    }
  );
  it.each([new Error("Connection terminated unexpectedly"), new Error("Query read timeout")])("recognizes code-less pg transport errors", error => {
    expect(isTransientStoreError(error)).toBe(true);
    expect(safeRuntimeErrorCode(error)).toBe("WORKER_RUNTIME_ERROR");
  });
  it.each([new TypeError("bug"), Object.assign(new Error("invalid password"), { code: "28P01" }),
    Object.assign(new Error("missing table"), { code: "42P01" }), new Error("unexpected database failure")])("does not retry unknown or configuration errors", error => {
    expect(isTransientStoreError(error)).toBe(false);
  });
});
