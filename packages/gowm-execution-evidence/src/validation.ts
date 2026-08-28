import { ExecutionEvidenceError } from "./errors.js";
import type {
  ExecutionEvidenceErrorCode,
  ExecutionNormalizationContext,
  Sha256Digest
} from "./types.js";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const operationIdPattern = /^[a-z][a-z0-9.-]{2,127}$/u;
const operationVersionPattern = /^[0-9]+\.[0-9]+$/u;

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function object(value: unknown, code: ExecutionEvidenceErrorCode): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ExecutionEvidenceError(code);
  }
  return value as Record<string, unknown>;
}

export function nonEmptyString(value: unknown, code: ExecutionEvidenceErrorCode): string {
  if (typeof value !== "string" || value.length === 0) throw new ExecutionEvidenceError(code);
  return value;
}

export function identifier(value: unknown, code: ExecutionEvidenceErrorCode): string {
  const parsed = nonEmptyString(value, code);
  if (!identifierPattern.test(parsed)) throw new ExecutionEvidenceError(code);
  return parsed;
}

export function operationId(value: unknown, code: ExecutionEvidenceErrorCode): string {
  const parsed = nonEmptyString(value, code);
  if (!operationIdPattern.test(parsed)) throw new ExecutionEvidenceError(code);
  return parsed;
}

export function operationVersion(value: unknown, code: ExecutionEvidenceErrorCode): string {
  const parsed = nonEmptyString(value, code);
  if (!operationVersionPattern.test(parsed)) throw new ExecutionEvidenceError(code);
  return parsed;
}

export function digest(value: unknown, code: ExecutionEvidenceErrorCode = "INVALID_DIGEST"): Sha256Digest {
  if (typeof value !== "string" || !digestPattern.test(value)) throw new ExecutionEvidenceError(code);
  return value as Sha256Digest;
}

export function timestamp(value: unknown, code: ExecutionEvidenceErrorCode = "INVALID_TIMESTAMP"): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new ExecutionEvidenceError(code);
  return new Date(value).toISOString();
}

export function stringArray(
  value: unknown,
  maximum: number,
  code: ExecutionEvidenceErrorCode
): string[] {
  if (!Array.isArray(value) || value.length > maximum || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new ExecutionEvidenceError(code);
  }
  return value as string[];
}

export function assertUnique(values: readonly string[], code: ExecutionEvidenceErrorCode): void {
  if (new Set(values).size !== values.length) throw new ExecutionEvidenceError(code);
}

export function validateContext(context: ExecutionNormalizationContext): {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly maximumInlinePayloadBytes: number;
  readonly modelReceiptIds: readonly string[];
} {
  identifier(context.executionId, "INVALID_IDENTIFIER");
  identifier(context.groundingId, "INVALID_IDENTIFIER");
  digest(context.contractCatalogRevision);
  digest(context.bindingRevision);
  digest(context.authorizationContextHash);
  digest(context.delegatedIdentityHash);
  const startedAt = timestamp(context.startedAt);
  const finishedAt = timestamp(context.finishedAt);
  if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new ExecutionEvidenceError("INVALID_TIME_RANGE");
  if (context.requestedProducts.length < 1
    || context.requestedProducts.length > 16
    || new Set(context.requestedProducts).size !== context.requestedProducts.length) {
    throw new ExecutionEvidenceError("INVALID_REQUESTED_PRODUCTS");
  }
  const maximumInlinePayloadBytes = context.maximumInlinePayloadBytes ?? 16_384;
  if (!Number.isSafeInteger(maximumInlinePayloadBytes)
    || maximumInlinePayloadBytes < 128
    || maximumInlinePayloadBytes > 1_048_576) {
    throw new ExecutionEvidenceError("INVALID_MAXIMUM_INLINE_BYTES");
  }
  const modelReceiptIds = [...(context.modelReceiptIds ?? [])];
  for (const receiptId of modelReceiptIds) identifier(receiptId, "INVALID_IDENTIFIER");
  assertUnique(modelReceiptIds, "MODEL_RECEIPT_COLLISION");
  return { startedAt, finishedAt, maximumInlinePayloadBytes, modelReceiptIds };
}

export function cloneObject(value: unknown, code: ExecutionEvidenceErrorCode): Readonly<Record<string, unknown>> {
  return structuredClone(object(value, code));
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}
