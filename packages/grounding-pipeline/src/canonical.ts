import { createHash } from "node:crypto";

function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot encode non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "undefined") return null;
  if (typeof value !== "object") throw new TypeError(`Canonical JSON cannot encode ${typeof value}`);
  if (seen.has(value)) throw new TypeError("Canonical JSON cannot encode cyclic objects");
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new TypeError("Canonical JSON cannot encode an invalid Date");
    return value.toISOString();
  }
  if (value instanceof Uint8Array) return { $bytesBase64: Buffer.from(value).toString("base64") };

  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => normalize(entry, seen));
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON accepts only plain objects, arrays, dates, and byte arrays");
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry, seen)])
    );
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set()));
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

export function canonicalSha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalBytes(value)).digest("hex")}`;
}

export function utf8Sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
