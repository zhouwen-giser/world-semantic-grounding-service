import { createHash } from "node:crypto";

import {
  GdpsV021DriverEvidenceError,
  type DriverDigest,
  type JsonObject,
  type PersistedDriverRun,
} from "./contracts.js";

export function sha256(value: string | Uint8Array): DriverDigest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new GdpsV021DriverEvidenceError("NON_FINITE_CANONICAL_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalValue(entry)}`)
      .join(",")}}`;
  }
  throw new GdpsV021DriverEvidenceError("UNSUPPORTED_CANONICAL_VALUE");
}

export function canonicalJson(value: unknown): string {
  return canonicalValue(value);
}

export function canonicalHash(value: unknown): DriverDigest {
  return sha256(canonicalJson(value));
}

export function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function object(value: unknown, code: string): JsonObject {
  if (!isObject(value)) throw new GdpsV021DriverEvidenceError(code);
  return value;
}

export function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GdpsV021DriverEvidenceError(code);
  }
  return value;
}

export function digest(value: unknown, code: string): DriverDigest {
  const candidate = text(value, code);
  if (!/^sha256:[0-9a-f]{64}$/u.test(candidate)) {
    throw new GdpsV021DriverEvidenceError(code);
  }
  return candidate as DriverDigest;
}

export function valuesNamed(value: unknown, name: string, found: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const entry of value) valuesNamed(entry, name, found);
    return found;
  }
  if (!isObject(value)) return found;
  for (const [key, entry] of Object.entries(value)) {
    if (key === name) found.push(entry);
    valuesNamed(entry, name, found);
  }
  return found;
}

export function stringsNamed(value: unknown, name: string): string[] {
  return [...new Set(valuesNamed(value, name)
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0))];
}

export function exactOperationKeys(run: PersistedDriverRun, expected: readonly string[], code: string): void {
  if (run.operationKeys.length !== expected.length ||
      run.operationKeys.some((entry, index) => entry !== expected[index])) {
    throw new GdpsV021DriverEvidenceError(code);
  }
}

export function requireTerminal(run: PersistedDriverRun, expected: string, code: string): void {
  if (run.terminalStatus !== expected || run.jobStatus !== expected) {
    throw new GdpsV021DriverEvidenceError(code);
  }
}

export function requirePlanBinding(
  run: PersistedDriverRun,
  descriptorId: string,
  operationKey: string,
): { readonly descriptorHash: DriverDigest; readonly planHash: DriverDigest } {
  if (run.planDocuments.length !== 1 || run.planHashes.length !== 1) {
    throw new GdpsV021DriverEvidenceError("DRIVER_EXACT_PLAN_REQUIRED");
  }
  const descriptorIds = stringsNamed(run.planDocuments[0], "descriptorId");
  const descriptorHashes = stringsNamed(run.planDocuments[0], "descriptorHash")
    .filter((entry) => /^sha256:[0-9a-f]{64}$/u.test(entry));
  if (!descriptorIds.includes(descriptorId) || descriptorHashes.length !== 1 ||
      !run.operationKeys.includes(operationKey)) {
    throw new GdpsV021DriverEvidenceError("DRIVER_PLAN_DESCRIPTOR_BINDING_INVALID");
  }
  return {
    descriptorHash: descriptorHashes[0] as DriverDigest,
    planHash: run.planHashes[0]!,
  };
}

export function semanticCodes(run: PersistedDriverRun): readonly string[] {
  return [...new Set([
    ...stringsNamed(run.resultDocument, "code"),
    ...stringsNamed(run.resultDocument, "reason"),
    ...stringsNamed(run.resultDocument, "warning"),
    ...stringsNamed(run.resultDocument, "warnings"),
    ...run.stageEvidence.flatMap((entry) => entry.errorCode ? [entry.errorCode] : []),
  ])];
}

export function executionStatus(run: PersistedDriverRun, operationKey: string): string | undefined {
  return run.executionEvidence.find((entry) => entry.operationKey === operationKey)?.normalizedStatus;
}

export function gdpsSource(run: PersistedDriverRun, code: string): JsonObject {
  if (run.gdpsSourceEvidence.length !== 1) {
    throw new GdpsV021DriverEvidenceError(`${code}_SOURCE_COUNT_${run.gdpsSourceEvidence.length}`);
  }
  return run.gdpsSourceEvidence[0]!;
}

export function sourceDigest(source: JsonObject, name: string, code: string): DriverDigest {
  return digest(source[name], code);
}

export function sourceText(source: JsonObject, name: string, code: string): string {
  return text(source[name], code);
}

export function requireGdpsProductSource(
  source: JsonObject,
  expectedOperationKey: string,
  expectedStatus: "COMPLETED" | "PARTIAL",
): void {
  const operationKey = `${text(source["operationId"], "GDPS_SOURCE_OPERATION_ID_MISSING")}@${
    text(source["operationVersion"], "GDPS_SOURCE_OPERATION_VERSION_MISSING")}`;
  const dataSnapshot = source["dataSnapshot"];
  const computeSnapshot = source["computeSnapshot"];
  const quality = source["quality"];
  const receiptIds = source["receiptIds"];
  const evidenceIds = source["evidenceIds"];
  if (operationKey !== expectedOperationKey || source["normalizedStatus"] !== expectedStatus ||
      !isObject(dataSnapshot) || Object.keys(dataSnapshot).length === 0 ||
      !isObject(computeSnapshot) || Object.keys(computeSnapshot).length === 0 ||
      !isObject(quality) || Object.keys(quality).length === 0 ||
      !Array.isArray(receiptIds) || receiptIds.length === 0 ||
      !receiptIds.every((entry) => typeof entry === "string" && entry.length > 0) ||
      new Set(receiptIds).size !== receiptIds.length ||
      !Array.isArray(evidenceIds) || evidenceIds.length === 0 ||
      !evidenceIds.every((entry) => typeof entry === "string" && entry.length > 0) ||
      new Set(evidenceIds).size !== evidenceIds.length) {
    throw new GdpsV021DriverEvidenceError("GDPS_PRODUCT_SOURCE_EVIDENCE_INCOMPLETE");
  }
}

export function stageAndExecutionFacts(run: PersistedDriverRun): JsonObject {
  return {
    sourceTextHash: run.sourceTextHash,
    requestRowHash: run.requestRowHash,
    resultDocumentHash: run.resultDocumentHash,
    jobStatus: run.jobStatus,
    consumerSnapshotHash: run.consumerSnapshotHash,
    stageEvidence: run.stageEvidence.map((entry) => ({ ...entry })),
    executionEvidence: run.executionEvidence.map((entry) => ({ ...entry })),
  };
}
