import { createHash } from "node:crypto";

import type { QuerySnapshotManifest, Sha256 } from "./types.js";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) {
        result[key] = canonicalize(child);
      }
    }
    return result;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Bytes(value: Uint8Array): Sha256 {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function sha256Canonical(value: unknown): Sha256 {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

export function isSha256(value: unknown): value is Sha256 {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function calculateManifestHash(
  manifest: Omit<QuerySnapshotManifest, "manifestHash">,
): Sha256 {
  return sha256Canonical(manifest);
}
