import { createHash } from "node:crypto";
import type {
  EvidenceNormalizationInput,
  EvidenceNormalizationResult,
  GroundingEvidenceItem
} from "./types.js";

type JsonObject = Record<string, unknown>;
const allowedEnvelopeKeys = new Set([
  "providerProtocolVersion", "requestId", "operation", "status", "output", "dataSnapshot", "computeSnapshot",
  "receipts", "evidenceReferences", "warnings", "consumption", "execution", "error"
]);
const evidenceStatuses = new Set(["COMPLETED", "PARTIAL", "NO_DATA", "INDETERMINATE"]);
const hashPattern = /^sha256:[0-9a-f]{64}$/u;
const operationProductKinds: Record<string, GroundingEvidenceItem["productKind"]> = {
  "world.get-current-state": "WORLD_FACT",
  "world.get-geometry": "WORLD_GEOMETRY",
  "world.get-provenance": "PROVENANCE",
  "world.get-event-timeline": "EVENT_TIMELINE",
  "operational-task.get": "OPERATIONAL_TASK",
  "operational-task.get-timeline": "EVENT_TIMELINE",
  "correlation.resolve": "CORRELATION_FINDING",
  "world-event.find-by-correlation": "CORRELATION_FINDING",
  "predicate.evaluate": "PREDICATE_EVALUATION"
};

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new EvidenceNormalizationError(code);
  return value as JsonObject;
}

function string(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new EvidenceNormalizationError(code);
  return value;
}

function strings(value: unknown, limit: number, code: string): string[] {
  if (!Array.isArray(value) || value.length > limit || value.some((entry) => typeof entry !== "string")) {
    throw new EvidenceNormalizationError(code);
  }
  return value as string[];
}

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function stableId(value: unknown): string {
  return `evidence-${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex").slice(0, 24)}`;
}

function cloneObject(value: unknown, code: string): JsonObject {
  return structuredClone(object(value, code));
}

export class EvidenceNormalizationError extends Error {
  constructor(readonly code: string) {
    super(`Evidence normalization failed: ${code}`);
  }
}

export class GowmEvidenceNormalizer {
  readonly #maximumSafePayloadBytes: number;

  constructor(maximumSafePayloadBytes = 16_384) {
    if (!Number.isSafeInteger(maximumSafePayloadBytes) || maximumSafePayloadBytes < 128) {
      throw new Error("maximumSafePayloadBytes must be at least 128");
    }
    this.#maximumSafePayloadBytes = maximumSafePayloadBytes;
  }

  normalize(input: EvidenceNormalizationInput): EvidenceNormalizationResult {
    const envelope = object(input.envelope, "INVALID_GATEWAY_ENVELOPE");
    if (Object.keys(envelope).some((key) => !allowedEnvelopeKeys.has(key))) {
      throw new EvidenceNormalizationError("UNKNOWN_GATEWAY_ENVELOPE_FIELD");
    }
    const operation = object(envelope["operation"], "INVALID_GATEWAY_OPERATION");
    const execution = object(envelope["execution"], "INVALID_GATEWAY_EXECUTION");
    if (
      envelope["providerProtocolVersion"] !== "1.0" ||
      operation["operationId"] !== input.expected.operationId ||
      operation["operationVersion"] !== input.expected.operationVersion ||
      execution["providerId"] !== input.expected.providerId
    ) throw new EvidenceNormalizationError("GATEWAY_AUTHORITY_MISMATCH");
    const status = string(envelope["status"], "INVALID_UPSTREAM_STATUS");
    const warnings = strings(envelope["warnings"], 256, "INVALID_UPSTREAM_WARNINGS").slice(0, 128);
    if (status === "FAILED") {
      return { status: "FAILED", errorCode: "UPSTREAM_FAILED", warnings };
    }
    if (!evidenceStatuses.has(status)) throw new EvidenceNormalizationError("INVALID_UPSTREAM_STATUS");

    const receipts = Array.isArray(envelope["receipts"]) ? envelope["receipts"] : [];
    if (receipts.length > 256) throw new EvidenceNormalizationError("RECEIPT_LIMIT");
    const receiptIds = receipts.map((raw) => {
      const receipt = object(raw, "INVALID_EXECUTION_RECEIPT");
      if (
        receipt["operationId"] !== input.expected.operationId ||
        receipt["operationVersion"] !== input.expected.operationVersion ||
        receipt["providerId"] !== input.expected.providerId
      ) throw new EvidenceNormalizationError("RECEIPT_AUTHORITY_MISMATCH");
      return string(receipt["receiptId"], "INVALID_RECEIPT_ID");
    });

    const evidenceReferences = Array.isArray(envelope["evidenceReferences"]) ? envelope["evidenceReferences"] : [];
    if (evidenceReferences.length > 1000) throw new EvidenceNormalizationError("EVIDENCE_REFERENCE_LIMIT");
    const evidenceIds: string[] = [];
    const authorities = new Set<string>();
    let payloadRef: string | undefined;
    for (const raw of evidenceReferences) {
      const evidence = object(raw, "INVALID_EVIDENCE_REFERENCE");
      evidenceIds.push(string(evidence["evidenceId"], "INVALID_EVIDENCE_ID"));
      authorities.add(string(evidence["authority"], "INVALID_EVIDENCE_AUTHORITY"));
      if (!payloadRef && typeof evidence["payloadRef"] === "string") payloadRef = evidence["payloadRef"];
    }
    const authority = authorities.size === 0 ? "gowm" : authorities.size === 1 ? [...authorities][0]! : "gowm:mixed-authority";

    let payloadSchemaUri = input.expected.outputSchemaUri;
    let payloadSchemaHash = input.expected.outputSchemaHash;
    let safePayload: unknown = status === "NO_DATA" ? { noData: true } : undefined;
    if (status !== "NO_DATA") {
      const output = object(envelope["output"], "MISSING_GATEWAY_OUTPUT");
      payloadSchemaUri = string(output["schemaUri"], "INVALID_OUTPUT_SCHEMA_URI");
      payloadSchemaHash = string(output["schemaHash"], "INVALID_OUTPUT_SCHEMA_HASH") as `sha256:${string}`;
      if (payloadSchemaUri !== input.expected.outputSchemaUri || payloadSchemaHash !== input.expected.outputSchemaHash || !hashPattern.test(payloadSchemaHash)) {
        throw new EvidenceNormalizationError("OUTPUT_SCHEMA_MISMATCH");
      }
      const serialized = JSON.stringify(output["value"]);
      if (serialized === undefined) throw new EvidenceNormalizationError("MISSING_OUTPUT_VALUE");
      const byteLength = Buffer.byteLength(serialized, "utf8");
      safePayload = byteLength <= this.#maximumSafePayloadBytes
        ? structuredClone(output["value"])
        : {
            summarized: true,
            byteLength,
            payloadHash: hash(serialized),
            ...(Array.isArray(output["value"]) ? { itemCount: output["value"].length } : {}),
            ...(output["value"] && typeof output["value"] === "object" && !Array.isArray(output["value"])
              ? { keys: Object.keys(output["value"] as JsonObject).sort().slice(0, 32) }
              : {})
          };
    }

    const computeSnapshot = cloneObject(envelope["computeSnapshot"], "MISSING_COMPUTE_SNAPSHOT");
    const computeProvider = object(computeSnapshot["provider"], "INVALID_COMPUTE_PROVIDER");
    const computeOperation = object(computeSnapshot["operation"], "INVALID_COMPUTE_OPERATION");
    const computeSchemas = object(computeSnapshot["schemas"], "INVALID_COMPUTE_SCHEMAS");
    if (
      computeProvider["providerId"] !== input.expected.providerId ||
      computeOperation["operationId"] !== input.expected.operationId ||
      computeOperation["operationVersion"] !== input.expected.operationVersion ||
      computeSchemas["outputSchemaHash"] !== input.expected.outputSchemaHash
    ) throw new EvidenceNormalizationError("COMPUTE_SNAPSHOT_MISMATCH");

    const unknowns = status === "NO_DATA" ? ["NO_DATA"]
      : status === "INDETERMINATE" ? ["INDETERMINATE"]
        : status === "PARTIAL" ? ["PARTIAL_RESULT"] : [];
    const item: GroundingEvidenceItem = {
      evidenceProductId: stableId({
        requestId: envelope["requestId"], operation: input.expected.operationId, status,
        outputHash: execution["resultHash"], evidenceIds
      }),
      productKind: operationProductKinds[input.expected.operationId] ?? "CAPABILITY_RESULT",
      authority,
      sourceOperation: input.expected.operationId,
      sourceProvider: input.expected.providerId,
      ...(input.sourceQueryId ? { sourceQueryId: input.sourceQueryId } : {}),
      ...(input.sourceNodeId ? { sourceNodeId: input.sourceNodeId } : {}),
      upstreamStatus: status as GroundingEvidenceItem["upstreamStatus"],
      payloadSchemaUri,
      payloadSchemaHash,
      safePayload,
      ...(payloadRef ? { payloadRef } : {}),
      ...(envelope["dataSnapshot"] === undefined ? {} : { dataSnapshot: cloneObject(envelope["dataSnapshot"], "INVALID_DATA_SNAPSHOT") }),
      computeSnapshot,
      receiptIds,
      evidenceIds,
      unknowns,
      warnings
    };
    return { status: "EVIDENCE", item };
  }
}
