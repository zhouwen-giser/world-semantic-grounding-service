import {
  readGdpsFindingOperationAuthority,
  type GdpsFindingOperationAuthority,
  type GdpsFindingOperationProjection
} from "@wsgs/gdps-descriptor-consumer";
import {
  defaultGdpsV021OutputSchemaRegistry,
  defaultGowmConsumerSchemaRegistry
} from "@wsgs/gowm-contract-intake";

import { canonicalSha256 } from "./canonical.js";
import type { Sha256Digest } from "./types.js";

export type GowmFindingResultStatus =
  | "COMPLETED"
  | "PARTIAL"
  | "NO_DATA"
  | "INDETERMINATE"
  | "FAILED";

export interface GowmCapabilityResultEnvelope {
  readonly providerProtocolVersion: "1.0";
  readonly requestId: string;
  readonly operation: {
    readonly operationId: string;
    readonly operationVersion: string;
  };
  readonly status: GowmFindingResultStatus;
  readonly output?: {
    readonly schemaUri: string;
    readonly schemaHash: Sha256Digest;
    readonly value: unknown;
  };
  readonly computeSnapshot: Readonly<Record<string, unknown>>;
  readonly receipts: readonly Readonly<Record<string, unknown>>[];
  readonly evidenceReferences: readonly Readonly<Record<string, unknown>>[];
  readonly warnings: readonly string[];
  readonly consumption: Readonly<Record<string, unknown>>;
  readonly execution: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export interface ValidatedGowmFindingResult {
  readonly envelopeHash: Sha256Digest;
  readonly operationId: string;
  readonly operationVersion: string;
}

export interface ValidatedGowmFindingResultProjection {
  readonly envelope: GowmCapabilityResultEnvelope;
  readonly envelopeHash: Sha256Digest;
  readonly operationAuthority: GdpsFindingOperationAuthority;
  readonly operation: GdpsFindingOperationProjection;
}

export class ValidatedGowmResultError extends Error {
  constructor(readonly code: string) {
    super(`GOWM finding result validation failed: ${code}`);
    this.name = "ValidatedGowmResultError";
  }
}

const validatedResults = new WeakMap<object, ValidatedGowmFindingResultProjection>();
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function fail(code: string): never {
  throw new ValidatedGowmResultError(code);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function digest(value: unknown, code: string): Sha256Digest {
  if (typeof value !== "string" || !digestPattern.test(value)) fail(code);
  return value as Sha256Digest;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function assertUnique(values: readonly string[], code: string): void {
  if (new Set(values).size !== values.length) fail(code);
}

function receiptId(value: unknown): string {
  const receipt = record(value, "INVALID_RECEIPT");
  const id = receipt["receiptId"];
  if (typeof id !== "string") fail("INVALID_RECEIPT");
  return id;
}

function evidenceId(value: unknown): string {
  const evidence = record(value, "INVALID_EVIDENCE_REFERENCE");
  const id = evidence["evidenceId"];
  if (typeof id !== "string") fail("INVALID_EVIDENCE_REFERENCE");
  return id;
}

export function validateGowmFindingResultEnvelope(
  operationAuthority: GdpsFindingOperationAuthority,
  envelopeValue: unknown
): ValidatedGowmFindingResult {
  const operation = readGdpsFindingOperationAuthority(operationAuthority);
  defaultGowmConsumerSchemaRegistry().validate(
    "platform/capability-result-envelope.schema.json",
    envelopeValue
  );
  const envelope = record(envelopeValue, "INVALID_GATEWAY_ENVELOPE") as unknown as GowmCapabilityResultEnvelope;
  if (envelope.providerProtocolVersion !== "1.0") fail("INVALID_PROVIDER_PROTOCOL_VERSION");
  if (envelope.operation.operationId !== operation.operationId
    || envelope.operation.operationVersion !== operation.operationVersion) {
    fail("OPERATION_IDENTITY_MISMATCH");
  }
  const output = envelope.output;
  if ((envelope.status === "COMPLETED" || envelope.status === "PARTIAL") && output === undefined) {
    fail("OUTPUT_REQUIRED");
  }
  if (envelope.status === "FAILED" && output !== undefined) fail("OUTPUT_FORBIDDEN");
  if (output !== undefined
    && (output.schemaUri !== operation.outputSchemaUri
      || output.schemaHash !== operation.outputSchemaHash)) {
    fail("OUTPUT_SCHEMA_MISMATCH");
  }
  if (output !== undefined) {
    defaultGdpsV021OutputSchemaRegistry().validateOutput(
      operation.operationId,
      operation.operationVersion,
      output.schemaUri,
      output.schemaHash,
      output.value
    );
  }

  const computeSnapshot = record(envelope.computeSnapshot, "COMPUTE_SNAPSHOT_MISMATCH");
  const computeOperation = record(computeSnapshot["operation"], "COMPUTE_SNAPSHOT_MISMATCH");
  const computeSchemas = record(computeSnapshot["schemas"], "COMPUTE_SNAPSHOT_MISMATCH");
  const computeProvider = record(computeSnapshot["provider"], "COMPUTE_SNAPSHOT_MISMATCH");
  if (computeOperation["operationId"] !== operation.operationId
    || computeOperation["operationVersion"] !== operation.operationVersion
    || computeSchemas["inputSchemaHash"] !== operation.inputSchemaHash
    || computeSchemas["outputSchemaHash"] !== operation.outputSchemaHash
    || computeProvider["providerId"] !== operation.provider.providerId
    || computeProvider["providerVersion"] !== operation.provider.providerVersion
    || computeProvider["implementationDigest"] !== operation.provider.implementationDigest) {
    fail("COMPUTE_SNAPSHOT_MISMATCH");
  }
  const execution = record(envelope.execution, "INVALID_GATEWAY_ENVELOPE");
  if (execution["providerId"] !== operation.provider.providerId
    || execution["providerVersion"] !== operation.provider.providerVersion
    || execution["providerId"] !== computeProvider["providerId"]
    || execution["providerVersion"] !== computeProvider["providerVersion"]) {
    fail("EXECUTION_PROVIDER_MISMATCH");
  }

  const resultHash = output === undefined ? undefined : canonicalSha256(output.value);
  if (output === undefined && execution["resultHash"] !== undefined) {
    fail("UNBOUND_RESULT_HASH_FORBIDDEN");
  }
  if (output !== undefined && execution["resultHash"] !== resultHash) {
    fail("UPSTREAM_RESULT_HASH_MISMATCH");
  }

  if (!Array.isArray(envelope.receipts)) fail("INVALID_RECEIPT");
  if (envelope.status !== "FAILED" && envelope.receipts.length === 0) fail("RECEIPT_REQUIRED");
  const computeSnapshotHash = canonicalSha256(computeSnapshot);
  const receiptIds = envelope.receipts.map(receiptId);
  assertUnique(receiptIds, "DUPLICATE_RECEIPT_ID");
  for (const value of envelope.receipts) {
    const receipt = record(value, "INVALID_RECEIPT");
    if (receipt["operationId"] !== operation.operationId
      || receipt["operationVersion"] !== operation.operationVersion
      || receipt["providerId"] !== operation.provider.providerId
      || receipt["providerVersion"] !== operation.provider.providerVersion) {
      fail("RECEIPT_OPERATION_PROVIDER_MISMATCH");
    }
    if (digest(receipt["computeSnapshotHash"], "RECEIPT_HASH_MISMATCH") !== computeSnapshotHash) {
      fail("RECEIPT_HASH_MISMATCH");
    }
    digest(receipt["inputHash"], "RECEIPT_HASH_MISMATCH");
    const outputHash = digest(receipt["outputHash"], "RECEIPT_HASH_MISMATCH");
    if (resultHash !== undefined && outputHash !== resultHash) fail("RECEIPT_HASH_MISMATCH");
  }

  if (!Array.isArray(envelope.evidenceReferences)) fail("INVALID_EVIDENCE_REFERENCE");
  const evidenceIds = envelope.evidenceReferences.map(evidenceId);
  assertUnique(evidenceIds, "DUPLICATE_EVIDENCE_ID");
  if (receiptIds.some((id) => evidenceIds.includes(id))) fail("RECEIPT_EVIDENCE_ID_COLLISION");

  const envelopeClone = freeze(structuredClone(envelope));
  const envelopeHash = canonicalSha256(envelopeClone);
  const token = freeze({
    envelopeHash,
    operationId: operation.operationId,
    operationVersion: operation.operationVersion
  });
  validatedResults.set(token, freeze({
    envelope: envelopeClone,
    envelopeHash,
    operationAuthority,
    operation
  }));
  return token;
}

export function readValidatedGowmFindingResult(
  result: ValidatedGowmFindingResult
): ValidatedGowmFindingResultProjection {
  if (result === null || typeof result !== "object") fail("VALIDATED_GOWM_RESULT_FORGED");
  const projection = validatedResults.get(result);
  if (projection === undefined) fail("VALIDATED_GOWM_RESULT_FORGED");
  if (canonicalSha256(projection.envelope) !== projection.envelopeHash) {
    fail("VALIDATED_GOWM_RESULT_MUTATED");
  }
  const currentOperation = readGdpsFindingOperationAuthority(projection.operationAuthority);
  if (currentOperation.closureHash !== projection.operation.closureHash
    || currentOperation.operationId !== projection.operation.operationId
    || currentOperation.operationVersion !== projection.operation.operationVersion
    || currentOperation.outputSchemaHash !== projection.operation.outputSchemaHash
    || currentOperation.semanticProfileHash !== projection.operation.semanticProfileHash) {
    fail("VALIDATED_GOWM_RESULT_AUTHORITY_DRIFT");
  }
  return projection;
}
