import { createHash } from "node:crypto";

import type { Sha256Digest } from "./types.js";

function normalizeForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForCanonicalJson);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, normalizeForCanonicalJson(entry)])
  );
}

export function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(normalizeForCanonicalJson(value));
  if (encoded === undefined) throw new TypeError("Value cannot be represented as canonical JSON");
  return encoded;
}

export function hashCanonicalJson(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function hashExactBytes(value: string | NodeJS.ArrayBufferView): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
