import type { HistoricalReferenceKey, HistoricalTraceConfiguration } from "./types.js";

type Environment = Readonly<Record<string, string | undefined>>;

function integer(environment: Environment, name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) throw new Error(`${name}_INVALID`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name}_INVALID`);
  return value;
}

function reference(raw: string | undefined, fallback: HistoricalReferenceKey, expectedKind?: string): HistoricalReferenceKey {
  if (!raw?.trim()) return fallback;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("WSGS_HISTORY_REFERENCE_INVALID");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("WSGS_HISTORY_REFERENCE_INVALID");
  const record = value as Record<string, unknown>;
  for (const key of ["namespace", "kind", "id", "version"] as const) {
    if (typeof record[key] !== "string" || record[key].length === 0) throw new Error("WSGS_HISTORY_REFERENCE_INVALID");
  }
  if (expectedKind && record["kind"] !== expectedKind) throw new Error("WSGS_HISTORY_REFERENCE_KIND_INVALID");
  return record as unknown as HistoricalReferenceKey;
}

export function historicalTraceConfigurationFromEnvironment(
  environment: Environment = process.env
): HistoricalTraceConfiguration {
  const enabledValue = environment["WSGS_HISTORY_TRACE_ENABLED"]?.trim() ?? "NO";
  if (enabledValue !== "YES" && enabledValue !== "NO") throw new Error("WSGS_HISTORY_TRACE_ENABLED_INVALID");
  const sourceSelectionProfileReferenceKey = reference(
    environment["WSGS_HISTORY_SOURCE_SELECTION_PROFILE_REFERENCE"],
    {
      namespace: "gowm.history",
      kind: "HISTORY_METHOD_PROFILE",
      id: "trajectory-single-authoritative-v1",
      version: "1.0"
    },
    "HISTORY_METHOD_PROFILE"
  );
  const analysisRaw = environment["WSGS_HISTORY_DEFAULT_ANALYSIS_SPACE_REFERENCE"];
  return {
    enabled: enabledValue === "YES",
    sourceSelectionProfileReferenceKey,
    maximumInlinePoints: integer(environment, "WSGS_HISTORY_MAX_INLINE_POINTS", 256, 0, 10_000),
    ...(analysisRaw?.trim()
      ? { analysisSpaceReferenceKey: reference(analysisRaw, sourceSelectionProfileReferenceKey) }
      : {}),
    provisionalReferenceTtlMs: integer(environment, "WSGS_HISTORY_PROVISIONAL_REFERENCE_TTL_MS", 60_000, 1_000, 3_600_000),
    allIntervalsLimit: integer(environment, "WSGS_HISTORY_ALL_INTERVALS_LIMIT", 100, 1, 1_000),
    pendingRetryMs: integer(environment, "WSGS_HISTORY_PENDING_RETRY_MS", 0, 0, 30_000)
  };
}
