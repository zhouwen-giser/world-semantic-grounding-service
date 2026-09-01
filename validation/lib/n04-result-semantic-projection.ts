type JsonObject = Record<string, unknown>;

const runtimeFieldNames = new Set([
  "capturedAt",
  "evaluatedAt",
  "evidenceIds",
  "freshnessMs",
  "receiptIds",
  "validUntil",
  "validationEvaluatedAt"
]);

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonObject;
}

function withoutRuntimeFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRuntimeFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as JsonObject)
    .filter(([key]) => !runtimeFieldNames.has(key))
    .map(([key, entry]) => [key, withoutRuntimeFields(entry)]));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as JsonObject;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("N04_SEMANTIC_CANONICAL_JSON_UNDEFINED");
  return encoded;
}

function compareCanonical(left: unknown, right: unknown): number {
  const leftCanonical = canonicalJson(left);
  const rightCanonical = canonicalJson(right);
  if (leftCanonical < rightCanonical) return -1;
  if (leftCanonical > rightCanonical) return 1;
  return 0;
}

function projectDataSnapshot(value: unknown): unknown {
  const projected = withoutRuntimeFields(value);
  if (!projected || typeof projected !== "object" || Array.isArray(projected)) return projected;
  const snapshot = projected as JsonObject;
  if (!Array.isArray(snapshot["resources"])) return snapshot;
  return {
    ...snapshot,
    resources: snapshot["resources"].map((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
      return Object.fromEntries(Object.entries(candidate as JsonObject)
        // Foundation snapshot resource digests include the capture instant. The
        // stable authority, pinning and reference identity remain in the projection.
        .filter(([key]) => key !== "digest"));
    })
  };
}

function projectEvidenceItem(value: unknown): unknown {
  const projected = withoutRuntimeFields(value);
  if (!projected || typeof projected !== "object" || Array.isArray(projected)) return projected;
  const item = projected as JsonObject;
  return item["dataSnapshot"] === undefined
    ? item
    : { ...item, dataSnapshot: projectDataSnapshot(item["dataSnapshot"]) };
}

function projectEvidenceItems(value: unknown): unknown {
  if (!Array.isArray(value)) return withoutRuntimeFields(value);
  return value.map(projectEvidenceItem).sort(compareCanonical);
}

export function n04ResultSemanticProjection(result: JsonObject): JsonObject {
  const source = object(result["source"], "N04_RESULT_SOURCE_MISSING");
  const execution = object(result["execution"], "N04_RESULT_EXECUTION_MISSING");
  return {
    schemaVersion: result["schemaVersion"],
    status: result["status"],
    source: { originalTextSha256: source["originalTextSha256"] },
    mentions: withoutRuntimeFields(result["mentions"]),
    referenceProducts: withoutRuntimeFields(result["referenceProducts"]),
    evidenceItems: projectEvidenceItems(result["evidenceItems"]),
    geospatialFindings: withoutRuntimeFields(result["geospatialFindings"]),
    ambiguities: withoutRuntimeFields(result["ambiguities"]),
    unresolvedMentions: withoutRuntimeFields(result["unresolvedMentions"]),
    capabilityGaps: withoutRuntimeFields(result["capabilityGaps"]),
    warnings: withoutRuntimeFields(result["warnings"]),
    execution: Object.fromEntries(Object.entries(execution)
      .filter(([key]) => key !== "elapsedMs" && key !== "semanticModelReceiptIds")
      .map(([key, entry]) => [key, withoutRuntimeFields(entry)]))
  };
}
