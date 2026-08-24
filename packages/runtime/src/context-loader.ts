import { createHash } from "node:crypto";

type JsonObject = Record<string, unknown>;

export interface PriorGroundingPointerInput {
  groundingId: string;
  resultHash: `sha256:${string}`;
  selectedProductIds?: string[];
}

export interface ContextCapsuleInput {
  knownWorldReferences: JsonObject[];
  priorGroundings: PriorGroundingPointerInput[];
  mapSelections: JsonObject[];
  externalCorrelationHints: JsonObject[];
  externalPredicates: JsonObject[];
}

export interface ScopedResultReader {
  getResult(dataScope: string, groundingId: string): Promise<Uint8Array | null>;
}

export interface MapRevisionReader {
  currentRevision(dataScope: string, selectionId: string): Promise<number | null>;
}

export interface LoadedContextCapsule {
  knownWorldReferences: Array<JsonObject & { revalidationRequired: boolean }>;
  priorProducts: Array<{
    sourceGroundingId: string;
    sourceResultHash: string;
    productId: string;
    productKind: string;
    product: JsonObject;
    revalidationRequired: boolean;
  }>;
  mapSelections: Array<JsonObject & { revisionStatus: "CURRENT" | "STALE" | "NOT_FOUND" }>;
  externalCorrelationHints: JsonObject[];
  externalPredicates: JsonObject[];
  warnings: string[];
}

const contextKeys = new Set([
  "knownWorldReferences", "priorGroundings", "mapSelections", "externalCorrelationHints", "externalPredicates"
]);
const pointerKeys = new Set(["groundingId", "resultHash", "selectedProductIds"]);
const hashPattern = /^sha256:[0-9a-f]{64}$/u;

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ContextLoadError(code);
  return value as JsonObject;
}

function string(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) throw new ContextLoadError(code);
  return value;
}

function expired(validUntil: unknown, now: Date): boolean {
  return typeof validUntil === "string" && Number.isFinite(Date.parse(validUntil)) && Date.parse(validUntil) <= now.getTime();
}

export class ContextLoadError extends Error {
  constructor(readonly code: string, readonly httpStatus: number = 400) {
    super(`Context capsule rejected: ${code}`);
  }
}

export interface PriorContextLoaderConfig {
  resultStore: ScopedResultReader;
  mapRevisions: MapRevisionReader;
  maximumCapsuleBytes?: number;
  now?: () => Date;
}

export class PriorContextLoader {
  readonly #resultStore: ScopedResultReader;
  readonly #mapRevisions: MapRevisionReader;
  readonly #maximumCapsuleBytes: number;
  readonly #now: () => Date;

  constructor(config: PriorContextLoaderConfig) {
    this.#resultStore = config.resultStore;
    this.#mapRevisions = config.mapRevisions;
    this.#maximumCapsuleBytes = config.maximumCapsuleBytes ?? 262_144;
    this.#now = config.now ?? (() => new Date());
  }

  async load(dataScope: string, rawCapsule: unknown): Promise<LoadedContextCapsule> {
    const capsule = object(rawCapsule, "INVALID_CONTEXT_CAPSULE");
    if (Object.keys(capsule).some((key) => !contextKeys.has(key))) throw new ContextLoadError("UNKNOWN_CONTEXT_FIELD", 400);
    const encoded = JSON.stringify(capsule);
    if (Buffer.byteLength(encoded, "utf8") > this.#maximumCapsuleBytes) throw new ContextLoadError("CONTEXT_TOO_LARGE", 413);
    const known = this.#array(capsule["knownWorldReferences"], 64, "KNOWN_REFERENCE_LIMIT");
    const priors = this.#array(capsule["priorGroundings"], 16, "PRIOR_GROUNDING_LIMIT");
    const maps = this.#array(capsule["mapSelections"], 32, "MAP_SELECTION_LIMIT");
    const correlations = this.#array(capsule["externalCorrelationHints"], 32, "CORRELATION_HINT_LIMIT");
    const predicates = this.#array(capsule["externalPredicates"], 32, "EXTERNAL_PREDICATE_LIMIT");
    const now = this.#now();
    const warnings: string[] = [];

    const knownWorldReferences = known.map((entry) => {
      const value = structuredClone(object(entry, "INVALID_KNOWN_REFERENCE"));
      const revalidationRequired = expired(value["validUntil"], now);
      if (revalidationRequired) warnings.push(`KNOWN_REFERENCE_EXPIRED:${String(value["alias"] ?? "unknown")}`);
      return { ...value, revalidationRequired };
    });

    const priorProducts: LoadedContextCapsule["priorProducts"] = [];
    for (const rawPointer of priors) {
      const pointer = object(rawPointer, "INVALID_PRIOR_POINTER");
      if (Object.keys(pointer).some((key) => !pointerKeys.has(key))) throw new ContextLoadError("PRIOR_CONTENT_SUBSTITUTION_FORBIDDEN", 400);
      const groundingId = string(pointer["groundingId"], "INVALID_PRIOR_GROUNDING_ID");
      const resultHash = string(pointer["resultHash"], "INVALID_PRIOR_RESULT_HASH");
      if (!hashPattern.test(resultHash)) throw new ContextLoadError("INVALID_PRIOR_RESULT_HASH", 400);
      const selected = pointer["selectedProductIds"] === undefined
        ? []
        : this.#array(pointer["selectedProductIds"], 64, "SELECTED_PRODUCT_LIMIT").map((value) => string(value, "INVALID_SELECTED_PRODUCT_ID"));
      const bytes = await this.#resultStore.getResult(dataScope, groundingId);
      if (!bytes) throw new ContextLoadError("PRIOR_RESULT_NOT_FOUND_IN_SCOPE", 404);
      const actualHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (actualHash !== resultHash) throw new ContextLoadError("PRIOR_RESULT_HASH_MISMATCH", 409);
      let result: JsonObject;
      try {
        result = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), "INVALID_PRIOR_RESULT");
      } catch (error) {
        if (error instanceof ContextLoadError) throw error;
        throw new ContextLoadError("INVALID_PRIOR_RESULT", 409);
      }
      const products = [
        ...this.#array(result["referenceProducts"] ?? [], 1000, "PRIOR_PRODUCT_LIMIT"),
        ...this.#array(result["evidenceItems"] ?? [], 1000, "PRIOR_PRODUCT_LIMIT")
      ].map((entry) => object(entry, "INVALID_PRIOR_PRODUCT"));
      const byId = new Map(products.map((product) => [
        string(product["productId"] ?? product["evidenceProductId"], "INVALID_PRIOR_PRODUCT_ID"), product
      ]));
      for (const productId of selected) {
        const product = byId.get(productId);
        if (!product) throw new ContextLoadError("SELECTED_PRIOR_PRODUCT_NOT_FOUND", 409);
        const revalidationRequired = expired(product["validUntil"], now) || product["revalidationRequired"] === true;
        if (revalidationRequired) warnings.push(`PRIOR_PRODUCT_REVALIDATION_REQUIRED:${productId}`);
        priorProducts.push({
          sourceGroundingId: groundingId,
          sourceResultHash: resultHash,
          productId,
          productKind: string(product["productKind"], "INVALID_PRIOR_PRODUCT_KIND"),
          product: structuredClone(product),
          revalidationRequired
        });
      }
    }

    const mapSelections: LoadedContextCapsule["mapSelections"] = [];
    for (const rawMap of maps) {
      const map = structuredClone(object(rawMap, "INVALID_MAP_SELECTION"));
      const selectionId = string(map["selectionId"], "INVALID_MAP_SELECTION_ID");
      const revision = map["revision"];
      if (!Number.isSafeInteger(revision) || (revision as number) < 1) throw new ContextLoadError("INVALID_MAP_REVISION", 400);
      const current = await this.#mapRevisions.currentRevision(dataScope, selectionId);
      const revisionStatus = current === null ? "NOT_FOUND" : current === revision ? "CURRENT" : "STALE";
      if (revisionStatus !== "CURRENT") warnings.push(`MAP_REVISION_${revisionStatus}:${selectionId}`);
      mapSelections.push({ ...map, revisionStatus });
    }

    return {
      knownWorldReferences,
      priorProducts,
      mapSelections,
      externalCorrelationHints: structuredClone(correlations.map((entry) => object(entry, "INVALID_CORRELATION_HINT"))),
      externalPredicates: structuredClone(predicates.map((entry) => object(entry, "INVALID_EXTERNAL_PREDICATE"))),
      warnings
    };
  }

  #array(value: unknown, maximum: number, code: string): unknown[] {
    if (!Array.isArray(value) || value.length > maximum) throw new ContextLoadError(code, value && Array.isArray(value) ? 413 : 400);
    return value;
  }
}
