import type { AdvancedHistoryConfiguration } from "./advanced-types.js";
export function advancedHistoryConfigurationFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): AdvancedHistoryConfiguration {
  const flag = env["WSGS_ADVANCED_HISTORY_ENABLED"] ?? "NO";
  if (!["YES", "NO", "true", "false"].includes(flag)) throw new Error("WSGS_ADVANCED_HISTORY_ENABLED_INVALID");
  const int = (key: string, fallback: number, max: number, min = 1): number => {
    const value = env[`WSGS_ADVANCED_HISTORY_${key}`];
    if (value === undefined || value === "") return fallback;
    if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error("ADVANCED_HISTORY_CONFIGURATION_INVALID");
    return Number(value);
  };
  const metricTopKMax = int("METRIC_TOP_K_MAX", 50, 100);
  return {
    enabled: flag === "YES" || flag === "true",
    ...(env["WSGS_ANALYSIS_PROVIDER_CONTRACT_ROOT"] ? { contractRoot: env["WSGS_ANALYSIS_PROVIDER_CONTRACT_ROOT"] } : {}),
    ...(env["WSGS_ADVANCED_HISTORY_METRIC_CATALOG_PATH"] ? { metricCatalogPath: env["WSGS_ADVANCED_HISTORY_METRIC_CATALOG_PATH"] } : {}),
    maximumEvents: int("MAX_EVENTS", 100, 1000), maximumRoadVisits: int("MAX_ROAD_VISITS", 100, 1000),
    maximumSegments: int("MAX_SEGMENTS", 100, 1000), metricTopK: Math.min(int("METRIC_TOP_K", 5, 100), metricTopKMax), metricTopKMax,
    maximumWarnings: int("MAX_WARNINGS", 100, 256), maximumSeriesCandidates: int("MAX_SERIES_CANDIDATES", 50, 1000),
    maximumSafePayloadBytes: int("MAX_SAFE_PAYLOAD_BYTES", 262144, 1048576, 2048)
  };
}
