import { createHash } from "node:crypto";
import type { GatewayRequestContext, OperationLock } from "@wsgs/gowm-gateway-client";
import type { MergedMention } from "./types.js";
import type {
  GatewayOperationExecutor,
  GroundedMentionProduct,
  GroundingAmbiguityProduct,
  ReferenceGroundingResult,
  ReferenceProduct,
  ReferenceValidationProduct
} from "./reference-types.js";

type JsonObject = Record<string, unknown>;
const resolutionStatuses = new Set(["RESOLVED_EXACT", "SUGGESTED_UNIQUE", "AMBIGUOUS", "UNRESOLVED", "INVALID"]);
const validationStatuses = new Set(["VALID", "STALE", "EXPIRED", "NOT_FOUND", "TYPE_MISMATCH", "VERSION_CONFLICT", "SCOPE_DENIED"]);
const matchedByValues = new Set([
  "EXACT_REFERENCE_KEY", "EXACT_EXTERNAL_ID", "EXACT_CODE", "EXACT_CANONICAL_NAME",
  "EXACT_ALIAS", "PINYIN", "FUZZY_NAME", "SPATIAL_CONTEXT"
]);
const referenceIdPattern = /^wrf_[0-9a-f]{32}$/u;

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReferenceGroundingError(code);
  return value as JsonObject;
}

function string(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new ReferenceGroundingError(code);
  return value;
}

function boundedScore(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new ReferenceGroundingError(code);
  return value;
}

function integer(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new ReferenceGroundingError(code);
  return value as number;
}

function referenceKey(value: unknown): ReferenceProduct["referenceKey"] {
  const key = object(value, "INVALID_REFERENCE_KEY");
  if (key["namespace"] !== "gowm" || !referenceIdPattern.test(string(key["id"], "INVALID_REFERENCE_ID"))) {
    throw new ReferenceGroundingError("INVALID_REFERENCE_KEY");
  }
  return {
    namespace: "gowm",
    kind: string(key["kind"], "INVALID_REFERENCE_KIND"),
    id: key["id"] as string,
    version: string(key["version"], "INVALID_REFERENCE_VERSION")
  };
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}-${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex").slice(0, 24)}`;
}

function envelopeOutput(value: unknown, lock: OperationLock): unknown {
  const envelope = object(value, "INVALID_GATEWAY_ENVELOPE");
  const operation = object(envelope["operation"], "INVALID_GATEWAY_OPERATION");
  const computeSnapshot = object(envelope["computeSnapshot"], "INVALID_COMPUTE_SNAPSHOT");
  const snapshotOperation = object(computeSnapshot["operation"], "INVALID_COMPUTE_SNAPSHOT_OPERATION");
  const snapshotSchemas = object(computeSnapshot["schemas"], "INVALID_COMPUTE_SNAPSHOT_SCHEMAS");
  if (
    envelope["providerProtocolVersion"] !== "1.0" || operation["operationId"] !== lock.operationId ||
    operation["operationVersion"] !== lock.operationVersion ||
    snapshotOperation["operationId"] !== lock.operationId ||
    snapshotOperation["operationVersion"] !== lock.operationVersion ||
    snapshotSchemas["inputSchemaHash"] !== lock.inputSchemaHash ||
    snapshotSchemas["outputSchemaHash"] !== lock.outputSchemaHash
  ) throw new ReferenceGroundingError("GATEWAY_AUTHORITY_MISMATCH");
  if (envelope["status"] === "NO_DATA") return null;
  if (envelope["status"] !== "COMPLETED" && envelope["status"] !== "PARTIAL") {
    throw new ReferenceGroundingError("GATEWAY_OPERATION_NOT_SUCCESSFUL");
  }
  const output = object(envelope["output"], "MISSING_GATEWAY_OUTPUT");
  if (output["schemaHash"] !== lock.outputSchemaHash) throw new ReferenceGroundingError("GATEWAY_OUTPUT_SCHEMA_MISMATCH");
  return output["value"];
}

export class ReferenceGroundingError extends Error {
  constructor(readonly code: string) {
    super(`Reference grounding failed: ${code}`);
  }
}

export interface GowmReferenceGrounderConfig {
  gateway: GatewayOperationExecutor;
  resolveLock: OperationLock;
  validateLock: OperationLock;
  maximumCandidatesPerMention?: number;
  maximumResultBytes?: number;
  now?: () => Date;
}

export class GowmReferenceGrounder {
  readonly #gateway: GatewayOperationExecutor;
  readonly #resolveLock: OperationLock;
  readonly #validateLock: OperationLock;
  readonly #candidateLimit: number;
  readonly #maximumResultBytes: number;
  readonly #now: () => Date;

  constructor(config: GowmReferenceGrounderConfig) {
    if (config.resolveLock.operationId !== "reference.resolve" || config.validateLock.operationId !== "reference.validate") {
      throw new Error("Reference grounder requires the exact locked resolve and validate operations");
    }
    this.#gateway = config.gateway;
    this.#resolveLock = config.resolveLock;
    this.#validateLock = config.validateLock;
    this.#candidateLimit = config.maximumCandidatesPerMention ?? 20;
    if (!Number.isSafeInteger(this.#candidateLimit) || this.#candidateLimit < 1 || this.#candidateLimit > 20) {
      throw new Error("maximumCandidatesPerMention must be between 1 and 20");
    }
    this.#maximumResultBytes = config.maximumResultBytes ?? 1_048_576;
    this.#now = config.now ?? (() => new Date());
  }

  async ground(
    requestId: string,
    idempotencyKey: string,
    mentions: readonly MergedMention[],
    options: {
      language?: string;
      anchorReferenceKeys?: ReferenceProduct["referenceKey"][];
      mapViewport?: [number, number, number, number];
      deadlineAt: Date;
      context?: GatewayRequestContext;
    }
  ): Promise<ReferenceGroundingResult> {
    if (mentions.length === 0 || mentions.length > 32) throw new ReferenceGroundingError("MENTION_BATCH_LIMIT");
    const resolveInput = {
      schemaVersion: "1.0",
      mentions: mentions.map((mention) => ({
        mentionId: mention.mentionId,
        surfaceText: mention.surfaceText,
        ...(mention.expectedKinds.length > 0 ? { expectedKinds: mention.expectedKinds } : {})
      })),
      context: {
        anchorReferenceKeys: options.anchorReferenceKeys ?? [],
        ...(options.mapViewport ? { mapViewport: options.mapViewport } : {}),
        ...(options.language ? { language: options.language } : {})
      },
      limitPerMention: this.#candidateLimit
    };
    const resolveValue = await this.#execute(
      this.#resolveLock, requestId, `${idempotencyKey}:resolve`, resolveInput, options.deadlineAt, options.context
    );
    const normalized = this.#normalizeResolve(resolveValue, mentions);
    if (normalized.referenceProducts.length === 0) return normalized;
    const validateInput = {
      schemaVersion: "1.0",
      references: normalized.referenceProducts.map((product) => ({
        referenceKey: product.referenceKey,
        expectedType: product.referenceType,
        minimumWorldVersion: product.sourceWorldVersion
      }))
    };
    const validationValue = await this.#execute(
      this.#validateLock, requestId, `${idempotencyKey}:validate`, validateInput, options.deadlineAt, options.context
    );
    normalized.validationResults = this.#normalizeValidation(validationValue);
    const validationByKey = new Map(normalized.validationResults.map((entry) => [JSON.stringify(entry.referenceKey), entry]));
    for (const product of normalized.referenceProducts) {
      const validation = validationByKey.get(JSON.stringify(product.referenceKey));
      if (!validation) throw new ReferenceGroundingError("MISSING_REFERENCE_VALIDATION");
      product.revalidationRequired = product.revalidationRequired || validation.revalidationRequired || validation.status !== "VALID";
      if (validation.status !== "VALID") product.safeSummary = { ...product.safeSummary, validationStatus: validation.status };
    }
    return normalized;
  }

  async #execute(
    lock: OperationLock,
    requestId: string,
    idempotencyKey: string,
    input: Record<string, unknown>,
    deadlineAt: Date,
    context?: GatewayRequestContext
  ): Promise<unknown> {
    if (deadlineAt.getTime() <= this.#now().getTime()) throw new ReferenceGroundingError("DEADLINE_EXCEEDED");
    const request = {
      requestVersion: "1.0",
      requestId,
      idempotencyKey,
      operationVersion: lock.operationVersion,
      inputSchemaHash: lock.inputSchemaHash,
      outputSchemaHash: lock.outputSchemaHash,
      input,
      executionPolicy: {
        deadlineAt: deadlineAt.toISOString(),
        maximumResultBytes: this.#maximumResultBytes,
        maximumCandidates: this.#candidateLimit * 32,
        maximumCostClass: "LOW",
        preferredExecution: "AUTO"
      }
    };
    const requestContext: GatewayRequestContext = { ...(context ?? {}), deadlineAt };
    const result = await this.#gateway.executeOperation(lock, request, requestContext);
    if (result.status === 200) return envelopeOutput(result.value, lock);
    if (result.status !== 202) throw new ReferenceGroundingError("UNEXPECTED_GATEWAY_STATUS");
    const accepted = object(result.value, "INVALID_ASYNC_ACCEPTANCE");
    const jobId = string(accepted["jobId"], "MISSING_GATEWAY_JOB_ID");
    const job = await this.#gateway.pollJob(jobId, requestContext);
    if (job["status"] !== "COMPLETED" && job["status"] !== "PARTIAL") {
      throw new ReferenceGroundingError("GATEWAY_JOB_NOT_SUCCESSFUL");
    }
    return envelopeOutput(job["result"], lock);
  }

  #normalizeResolve(value: unknown, mentions: readonly MergedMention[]): ReferenceGroundingResult {
    if (value === null) {
      return {
        mentions: mentions.map((mention) => ({ ...mention, status: "UNRESOLVED", candidateProductIds: [] })),
        referenceProducts: [],
        ambiguities: [],
        unresolvedMentions: mentions.map((mention) => ({ mentionId: mention.mentionId, surfaceText: mention.surfaceText, reason: "NO_DATA" })),
        validationResults: [],
        worldVersion: 0,
        resolverVersion: "gateway-no-data"
      };
    }
    const result = object(value, "INVALID_RESOLVE_RESULT");
    if (result["schemaVersion"] !== "1.0" || !Array.isArray(result["resolutions"])) {
      throw new ReferenceGroundingError("INVALID_RESOLVE_RESULT");
    }
    const worldVersion = integer(result["worldVersion"], "INVALID_WORLD_VERSION");
    const resolverVersion = string(result["resolverVersion"], "INVALID_RESOLVER_VERSION");
    const inputById = new Map(mentions.map((mention) => [mention.mentionId, mention]));
    const seen = new Set<string>();
    const grounded: GroundedMentionProduct[] = [];
    const products: ReferenceProduct[] = [];
    const ambiguities: GroundingAmbiguityProduct[] = [];
    const unresolved: ReferenceGroundingResult["unresolvedMentions"] = [];
    for (const rawResolution of result["resolutions"]) {
      const resolution = object(rawResolution, "INVALID_RESOLUTION");
      const mentionId = string(resolution["mentionId"], "INVALID_RESOLUTION_MENTION");
      const mention = inputById.get(mentionId);
      if (!mention || seen.has(mentionId)) throw new ReferenceGroundingError("UNKNOWN_OR_DUPLICATE_RESOLUTION_MENTION");
      seen.add(mentionId);
      const status = string(resolution["status"], "INVALID_RESOLUTION_STATUS") as GroundedMentionProduct["status"];
      if (!resolutionStatuses.has(status) || !Array.isArray(resolution["candidates"]) || resolution["candidates"].length > this.#candidateLimit) {
        throw new ReferenceGroundingError("INVALID_RESOLUTION_STATUS_OR_LIMIT");
      }
      const productIds: string[] = [];
      for (const [rank, rawCandidate] of resolution["candidates"].entries()) {
        const entry = object(rawCandidate, "INVALID_RESOLUTION_CANDIDATE");
        const descriptor = object(entry["candidate"], "INVALID_REFERENCE_DESCRIPTOR");
        const key = referenceKey(descriptor["referenceKey"]);
        const matchedBy = string(entry["matchedBy"], "INVALID_MATCH_KIND");
        if (!matchedByValues.has(matchedBy)) throw new ReferenceGroundingError("INVALID_MATCH_KIND");
        const matchScore = boundedScore(entry["matchScore"], "INVALID_MATCH_SCORE");
        const version = object(descriptor["version"], "INVALID_REFERENCE_DESCRIPTOR_VERSION");
        const descriptorWorldVersion = version["worldVersion"] === undefined
          ? worldVersion
          : integer(version["worldVersion"], "INVALID_DESCRIPTOR_WORLD_VERSION");
        const quality = descriptor["stateQuality"] === undefined ? {} : object(descriptor["stateQuality"], "INVALID_STATE_QUALITY");
        const stateConfidence = quality["stateConfidence"] === undefined
          ? undefined
          : boundedScore(quality["stateConfidence"], "INVALID_STATE_CONFIDENCE");
        const productId = stableId("reference-product", { mentionId, rank, key, worldVersion: descriptorWorldVersion });
        products.push({
          productId,
          productKind: "RESOLVED_REFERENCE",
          referenceKey: key,
          referenceType: string(descriptor["referenceType"], "INVALID_REFERENCE_TYPE"),
          displayName: string(descriptor["displayName"], "INVALID_REFERENCE_DISPLAY_NAME"),
          matchedBy,
          matchScore,
          ...(stateConfidence === undefined ? {} : { stateConfidence }),
          sourceOperation: "reference.resolve",
          sourceWorldVersion: descriptorWorldVersion,
          ...(typeof descriptor["validUntil"] === "string" ? { validUntil: descriptor["validUntil"] } : {}),
          revalidationRequired: descriptor["revalidationRequired"] === true,
          safeSummary: { providerRank: rank }
        });
        productIds.push(productId);
      }
      if ((status === "UNRESOLVED" || status === "INVALID") && productIds.length > 0) {
        throw new ReferenceGroundingError("TERMINAL_RESOLUTION_HAS_CANDIDATES");
      }
      if (status === "AMBIGUOUS" && productIds.length < 2) throw new ReferenceGroundingError("AMBIGUITY_REQUIRES_MULTIPLE_CANDIDATES");
      if ((status === "RESOLVED_EXACT" || status === "SUGGESTED_UNIQUE") && productIds.length !== 1) {
        throw new ReferenceGroundingError("UNIQUE_RESOLUTION_REQUIRES_ONE_CANDIDATE");
      }
      grounded.push({ ...mention, status, candidateProductIds: productIds });
      if (status === "AMBIGUOUS") {
        ambiguities.push({
          ambiguityId: stableId("ambiguity", { mentionId, productIds }),
          mentionId,
          surfaceText: mention.surfaceText,
          candidateProductIds: productIds,
          reason: productIds.every((id) => products.find((product) => product.productId === id)?.matchedBy.startsWith("EXACT_"))
            ? "MULTIPLE_EXACT_MATCHES"
            : "MULTIPLE_PLAUSIBLE_MATCHES"
        });
      }
      if (status === "UNRESOLVED" || status === "INVALID") {
        unresolved.push({ mentionId, surfaceText: mention.surfaceText, reason: status });
      }
    }
    for (const mention of mentions) {
      if (!seen.has(mention.mentionId)) {
        grounded.push({ ...mention, status: "UNRESOLVED", candidateProductIds: [] });
        unresolved.push({ mentionId: mention.mentionId, surfaceText: mention.surfaceText, reason: "MISSING_UPSTREAM_RESOLUTION" });
      }
    }
    return {
      mentions: grounded.sort((left, right) => left.span.start - right.span.start),
      referenceProducts: products,
      ambiguities,
      unresolvedMentions: unresolved,
      validationResults: [],
      worldVersion,
      resolverVersion
    };
  }

  #normalizeValidation(value: unknown): ReferenceValidationProduct[] {
    const result = object(value, "INVALID_VALIDATE_RESULT");
    if (result["schemaVersion"] !== "1.0" || !Array.isArray(result["results"]) || result["results"].length > 100) {
      throw new ReferenceGroundingError("INVALID_VALIDATE_RESULT");
    }
    return result["results"].map((raw): ReferenceValidationProduct => {
      const entry = object(raw, "INVALID_VALIDATION_ENTRY");
      const status = string(entry["status"], "INVALID_VALIDATION_STATUS") as ReferenceValidationProduct["status"];
      if (!validationStatuses.has(status) || typeof entry["revalidationRequired"] !== "boolean") {
        throw new ReferenceGroundingError("INVALID_VALIDATION_STATUS");
      }
      return {
        referenceKey: referenceKey(entry["referenceKey"]),
        status,
        revalidationRequired: entry["revalidationRequired"],
        warnings: Array.isArray(entry["warnings"])
          ? entry["warnings"].filter((warning): warning is string => typeof warning === "string").slice(0, 64)
          : []
      };
    });
  }
}
