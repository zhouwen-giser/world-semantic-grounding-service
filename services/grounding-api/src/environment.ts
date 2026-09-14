import type { GroundingApiConfig } from "./types.js";

export function apiOptionsFromEnvironment(environment: NodeJS.ProcessEnv = process.env): Pick<GroundingApiConfig, "bodyLimitBytes" | "logger" | "rateBudget"> {
  function integerEnvironment(name: string, fallback: number): number {
    const raw = environment[name];
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
    return value;
  }
  const log = environment["WSGS_API_LOG_ENABLED"] ?? "YES";
  if (log !== "YES" && log !== "NO") throw new Error("WSGS_API_LOG_ENABLED must be YES or NO");
  return {
    logger: log === "YES",
    bodyLimitBytes: integerEnvironment("WSGS_API_BODY_LIMIT_BYTES", 1_048_576),
    rateBudget: {
      requests: integerEnvironment("WSGS_API_RATE_LIMIT_REQUESTS", 120),
      windowMs: integerEnvironment("WSGS_API_RATE_LIMIT_WINDOW_MS", 60_000),
      maxTrackedKeys: integerEnvironment("WSGS_API_RATE_LIMIT_MAX_KEYS", 10_000)
    }
  };
}
