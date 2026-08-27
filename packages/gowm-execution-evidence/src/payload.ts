import { Buffer } from "node:buffer";

import { canonicalJson, canonicalSha256 } from "./canonical.js";
import { ExecutionEvidenceError } from "./errors.js";
import type {
  AuthoritativePayloadObjectReference,
  PayloadStorage
} from "./types.js";
import { digest } from "./validation.js";

function boundedSummary(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null) return { jsonType: "null" };
  if (Array.isArray(value)) return { jsonType: "array", itemCount: value.length };
  if (typeof value === "object") {
    return {
      jsonType: "object",
      keys: Object.keys(value as Record<string, unknown>).sort().slice(0, 32),
      keyCount: Object.keys(value as Record<string, unknown>).length
    };
  }
  if (typeof value === "string") return { jsonType: "string", characterCount: value.length };
  return { jsonType: typeof value };
}

function assertPayloadReference(reference: AuthoritativePayloadObjectReference): void {
  digest(reference.payloadHash);
  if (!Number.isSafeInteger(reference.byteCount) || reference.byteCount < 0) {
    throw new ExecutionEvidenceError("INVALID_PAYLOAD_REFERENCE");
  }
  try {
    const parsed = new URL(reference.payloadRef);
    if (parsed.username || parsed.password || !["https:", "s3:", "gs:", "az:", "urn:"].includes(parsed.protocol)) {
      throw new Error("unsafe reference");
    }
  } catch {
    throw new ExecutionEvidenceError("INVALID_PAYLOAD_REFERENCE");
  }
}

export function boundPayload(
  value: unknown,
  maximumInlineBytes: number,
  objectReference?: AuthoritativePayloadObjectReference
): PayloadStorage {
  const encoded = canonicalJson(value);
  const byteCount = Buffer.byteLength(encoded, "utf8");
  const payloadHash = canonicalSha256(value);
  if (byteCount <= maximumInlineBytes) {
    return { kind: "INLINE", byteCount, payloadHash, value: structuredClone(value) };
  }
  if (objectReference === undefined) {
    throw new ExecutionEvidenceError(
      "LARGE_PAYLOAD_REFERENCE_REQUIRED",
      "Large GOWM payload must already exist in an authoritative object store"
    );
  }
  assertPayloadReference(objectReference);
  if (objectReference.byteCount !== byteCount || objectReference.payloadHash !== payloadHash) {
    throw new ExecutionEvidenceError("PAYLOAD_REFERENCE_MISMATCH");
  }
  return {
    kind: "OBJECT_REFERENCE",
    byteCount,
    payloadHash,
    boundedSummary: boundedSummary(value),
    payloadRef: objectReference.payloadRef
  };
}
