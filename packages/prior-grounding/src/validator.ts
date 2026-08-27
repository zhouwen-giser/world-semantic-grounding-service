import {
  calculateManifestHash,
  canonicalJson,
  isSha256,
  sha256Bytes,
  sha256Canonical,
} from "./canonical.js";
import type {
  GowmReferenceKey,
  PriorGroundingIdentity,
  PriorGroundingPointer,
  PriorGroundingResult,
  PriorGroundingValidatorOptions,
  PriorValidationGatewayResponse,
  ProductValidationObservation,
  QuerySnapshotManifest,
  QuerySnapshotResource,
  RevalidationStatus,
  ValidationOperationLock,
} from "./types.js";

type JsonObject = Record<string, unknown>;

const pointerKeys = new Set(["groundingId", "resultHash", "selectedProductIds"]);
const manifestKeys = new Set([
  "querySnapshotId",
  "mode",
  "consistency",
  "capturedAt",
  "resources",
  "minimumWorldVersion",
  "manifestHash",
]);
const resourceKeys = new Set([
  "resourceKind",
  "resourceId",
  "version",
  "contentHash",
  "worldVersion",
  "pinning",
]);
const referenceKeyKeys = new Set(["namespace", "kind", "id", "version"]);
const referenceIdPattern = /^wrf_[0-9a-f]{32}$/u;
const validationOperations = ["reference.validate", "result.validate"] as const;

export class PriorGroundingError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number = 400,
  ) {
    super(`Prior Grounding rejected: ${code}`);
  }
}

function object(value: unknown, code: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PriorGroundingError(code);
  }
  return value as JsonObject;
}

function boundedString(value: unknown, code: string, maximum = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new PriorGroundingError(code);
  }
  return value;
}

function stringArray(value: unknown, code: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new PriorGroundingError(code, Array.isArray(value) ? 413 : 400);
  }
  const values = value.map((entry) => boundedString(entry, code));
  if (new Set(values).size !== values.length) {
    throw new PriorGroundingError(`${code}_DUPLICATE`);
  }
  return values;
}

function normalizedScopeSet(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameScopeSet(left: string[], right: string[]): boolean {
  return canonicalJson(normalizedScopeSet(left)) === canonicalJson(normalizedScopeSet(right));
}

function notFoundInScope(): never {
  throw new PriorGroundingError("PRIOR_RESULT_NOT_FOUND_IN_SCOPE", 404);
}

function validateIdentity(identityValue: PriorGroundingIdentity, dataScopeValue: string): PriorGroundingIdentity {
  const identity = object(identityValue, "INVALID_PRIOR_IDENTITY");
  const servicePrincipalId = boundedString(identity["servicePrincipalId"], "INVALID_SERVICE_PRINCIPAL_ID");
  const actorId = boundedString(identity["actorId"], "INVALID_ACTOR_ID");
  const dataScopes = stringArray(identity["dataScopes"], "INVALID_DATA_SCOPES", 64);
  const datasetScopes = stringArray(identity["datasetScopes"], "INVALID_DATASET_SCOPES", 256);
  const permissions = stringArray(identity["permissions"], "INVALID_PERMISSIONS", 256);
  const authorizationContextHash = identity["authorizationContextHash"];
  if (!isSha256(authorizationContextHash)) {
    throw new PriorGroundingError("INVALID_AUTHORIZATION_CONTEXT_HASH");
  }
  const dataScope = boundedString(dataScopeValue, "INVALID_DATA_SCOPE");
  if (!dataScopes.includes(dataScope)) {
    throw new PriorGroundingError("DATA_SCOPE_NOT_AUTHORIZED", 403);
  }
  return {
    servicePrincipalId,
    actorId,
    dataScopes,
    datasetScopes,
    permissions,
    authorizationContextHash,
  };
}

function validatePointer(value: unknown, maximumSelectedProducts: number): PriorGroundingPointer {
  const pointer = object(value, "INVALID_PRIOR_POINTER");
  if (Object.keys(pointer).some((key) => !pointerKeys.has(key))) {
    throw new PriorGroundingError("PRIOR_CONTENT_SUBSTITUTION_FORBIDDEN");
  }
  const groundingId = boundedString(pointer["groundingId"], "INVALID_PRIOR_GROUNDING_ID");
  if (!isSha256(pointer["resultHash"])) {
    throw new PriorGroundingError("INVALID_PRIOR_RESULT_HASH");
  }
  const selectedProductIds = stringArray(
    pointer["selectedProductIds"],
    "INVALID_SELECTED_PRODUCT_IDS",
    maximumSelectedProducts,
  );
  if (selectedProductIds.length === 0) {
    throw new PriorGroundingError("SELECTED_PRODUCT_IDS_REQUIRED");
  }
  return { groundingId, resultHash: pointer["resultHash"], selectedProductIds };
}

function validateReferenceKey(value: unknown): GowmReferenceKey {
  const key = object(value, "INVALID_PRIOR_REFERENCE_KEY");
  if (Object.keys(key).some((property) => !referenceKeyKeys.has(property))) {
    throw new PriorGroundingError("INVALID_PRIOR_REFERENCE_KEY");
  }
  if (key["namespace"] !== "gowm") {
    throw new PriorGroundingError("INVALID_PRIOR_REFERENCE_KEY");
  }
  const kind = boundedString(key["kind"], "INVALID_PRIOR_REFERENCE_KEY", 128);
  const id = boundedString(key["id"], "INVALID_PRIOR_REFERENCE_KEY", 36);
  const version = boundedString(key["version"], "INVALID_PRIOR_REFERENCE_KEY", 128);
  if (!referenceIdPattern.test(id)) {
    throw new PriorGroundingError("INVALID_PRIOR_REFERENCE_KEY");
  }
  return { namespace: "gowm", kind, id, version };
}

function safeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new PriorGroundingError(code, 409);
  }
  return value as number;
}

function validateResource(value: unknown): QuerySnapshotResource {
  const resource = object(value, "INVALID_PRIOR_SNAPSHOT_RESOURCE");
  if (Object.keys(resource).some((key) => !resourceKeys.has(key))) {
    throw new PriorGroundingError("INVALID_PRIOR_SNAPSHOT_RESOURCE", 409);
  }
  const resourceKind = boundedString(resource["resourceKind"], "INVALID_PRIOR_SNAPSHOT_RESOURCE", 128);
  const resourceId = boundedString(resource["resourceId"], "INVALID_PRIOR_SNAPSHOT_RESOURCE", 256);
  const version = boundedString(resource["version"], "INVALID_PRIOR_SNAPSHOT_RESOURCE", 256);
  if (!(["PINNED", "AT_LEAST", "BEST_EFFORT"] as unknown[]).includes(resource["pinning"])) {
    throw new PriorGroundingError("INVALID_PRIOR_SNAPSHOT_RESOURCE", 409);
  }
  const contentHash = resource["contentHash"];
  if (contentHash !== undefined && !isSha256(contentHash)) {
    throw new PriorGroundingError("INVALID_PRIOR_SNAPSHOT_RESOURCE", 409);
  }
  const worldVersion = resource["worldVersion"];
  if (worldVersion !== undefined) {
    safeInteger(worldVersion, "INVALID_PRIOR_SNAPSHOT_RESOURCE");
  }
  return {
    resourceKind,
    resourceId,
    version,
    pinning: resource["pinning"] as QuerySnapshotResource["pinning"],
    ...(contentHash === undefined ? {} : { contentHash }),
    ...(worldVersion === undefined ? {} : { worldVersion: worldVersion as number }),
  };
}

function validateManifest(value: unknown): QuerySnapshotManifest {
  const manifest = object(value, "INVALID_PRIOR_SNAPSHOT_MANIFEST");
  if (Object.keys(manifest).some((key) => !manifestKeys.has(key))) {
    throw new PriorGroundingError("INVALID_PRIOR_SNAPSHOT_MANIFEST", 409);
  }
  const querySnapshotId = boundedString(manifest["querySnapshotId"], "INVALID_PRIOR_SNAPSHOT_MANIFEST");
  const mode = manifest["mode"];
  if (!(["PINNED", "LATEST_AT_START", "AT_LEAST_WORLD_VERSION", "BEST_EFFORT"] as unknown[]).includes(mode)) {
    throw new PriorGroundingError("INVALID_PRIOR_SNAPSHOT_MANIFEST", 409);
  }
  const consistency = manifest["consistency"];
  if (!(["PINNED", "CONSISTENT_AT_START", "BEST_EFFORT"] as unknown[]).includes(consistency)) {
    throw new PriorGroundingError("INVALID_PRIOR_SNAPSHOT_MANIFEST", 409);
  }
  const capturedAt = boundedString(manifest["capturedAt"], "INVALID_PRIOR_SNAPSHOT_MANIFEST");
  if (!Number.isFinite(Date.parse(capturedAt))) {
    throw new PriorGroundingError("INVALID_PRIOR_SNAPSHOT_MANIFEST", 409);
  }
  if (!Array.isArray(manifest["resources"]) || manifest["resources"].length === 0 || manifest["resources"].length > 512) {
    throw new PriorGroundingError("PINNED_SNAPSHOT_RESOURCES_REQUIRED", 409);
  }
  const resources = manifest["resources"].map(validateResource);
  const resourceIdentities = resources.map(({ resourceKind, resourceId }) => `${resourceKind}\u0000${resourceId}`);
  if (new Set(resourceIdentities).size !== resourceIdentities.length) {
    throw new PriorGroundingError("DUPLICATE_PRIOR_SNAPSHOT_RESOURCE", 409);
  }
  const minimumWorldVersion = manifest["minimumWorldVersion"];
  if (minimumWorldVersion !== undefined) {
    safeInteger(minimumWorldVersion, "INVALID_PRIOR_SNAPSHOT_MANIFEST");
  }
  if (!isSha256(manifest["manifestHash"])) {
    throw new PriorGroundingError("INVALID_PRIOR_SNAPSHOT_MANIFEST", 409);
  }
  const normalized: QuerySnapshotManifest = {
    querySnapshotId,
    mode: mode as QuerySnapshotManifest["mode"],
    consistency: consistency as QuerySnapshotManifest["consistency"],
    capturedAt,
    resources,
    ...(minimumWorldVersion === undefined ? {} : { minimumWorldVersion: minimumWorldVersion as number }),
    manifestHash: manifest["manifestHash"],
  };
  const { manifestHash, ...unsigned } = normalized;
  if (calculateManifestHash(unsigned) !== manifestHash) {
    throw new PriorGroundingError("PRIOR_SNAPSHOT_MANIFEST_HASH_MISMATCH", 409);
  }
  return normalized;
}

function pinnedReplayManifest(sourceValue: unknown): QuerySnapshotManifest {
  const source = validateManifest(sourceValue);
  if (source.mode !== "LATEST_AT_START" && source.mode !== "PINNED") {
    throw new PriorGroundingError("PRIOR_SNAPSHOT_NOT_REPLAYABLE", 409);
  }
  if (
    (source.mode === "LATEST_AT_START" && source.consistency !== "CONSISTENT_AT_START") ||
    (source.mode === "PINNED" && source.consistency !== "PINNED") ||
    source.resources.some((resource) => resource.pinning !== "PINNED")
  ) {
    throw new PriorGroundingError("PRIOR_SNAPSHOT_NOT_REPLAYABLE", 409);
  }
  if (source.mode === "PINNED") {
    return source;
  }
  const resources = [...source.resources].sort((left, right) =>
    `${left.resourceKind}\u0000${left.resourceId}`.localeCompare(`${right.resourceKind}\u0000${right.resourceId}`),
  );
  const unsigned: Omit<QuerySnapshotManifest, "manifestHash"> = {
    querySnapshotId: `prior-${source.manifestHash.slice("sha256:".length, "sha256:".length + 32)}`,
    mode: "PINNED",
    consistency: "PINNED",
    capturedAt: source.capturedAt,
    resources,
    ...(source.minimumWorldVersion === undefined ? {} : { minimumWorldVersion: source.minimumWorldVersion }),
  };
  return { ...unsigned, manifestHash: calculateManifestHash(unsigned) };
}

function validateLocks(locks: ValidationOperationLock[]): Map<(typeof validationOperations)[number], ValidationOperationLock> {
  const result = new Map<(typeof validationOperations)[number], ValidationOperationLock>();
  for (const lock of locks) {
    if (!validationOperations.includes(lock.operationId)) continue;
    if (result.has(lock.operationId)) {
      throw new PriorGroundingError("DUPLICATE_VALIDATION_OPERATION_LOCK", 500);
    }
    if (
      lock.operationVersion !== "1.0" ||
      lock.maturity !== "STABLE" ||
      !isSha256(lock.inputSchemaHash) ||
      !isSha256(lock.outputSchemaHash) ||
      !isSha256(lock.semanticProfileHash)
    ) {
      throw new PriorGroundingError("INVALID_VALIDATION_OPERATION_LOCK", 500);
    }
    if (lock.snapshotSupport !== "PINNED") {
      throw new PriorGroundingError("PINNED_VALIDATION_OPERATION_UNAVAILABLE", 503);
    }
    if (!Array.isArray(lock.requiredPermissions) || lock.requiredPermissions.length === 0) {
      throw new PriorGroundingError("INVALID_VALIDATION_OPERATION_LOCK", 500);
    }
    result.set(lock.operationId, structuredClone(lock));
  }
  if (validationOperations.some((operationId) => !result.has(operationId))) {
    throw new PriorGroundingError("VALIDATION_OPERATION_LOCK_MISSING", 503);
  }
  return result;
}

function parseStoredResult(bytes: Uint8Array, groundingId: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new PriorGroundingError("INVALID_PRIOR_RESULT", 409);
  }
  const result = object(value, "INVALID_PRIOR_RESULT");
  if (result["groundingId"] !== groundingId) {
    throw new PriorGroundingError("PRIOR_GROUNDING_ID_MISMATCH", 409);
  }
  return result;
}

function selectedProducts(result: JsonObject, selectedIds: string[]): Array<{
  productId: string;
  product: JsonObject;
  referenceKey: GowmReferenceKey;
}> {
  const rawReferenceProducts = result["referenceProducts"] ?? [];
  const rawEvidenceItems = result["evidenceItems"] ?? [];
  if (!Array.isArray(rawReferenceProducts) || rawReferenceProducts.length > 1000 || !Array.isArray(rawEvidenceItems) || rawEvidenceItems.length > 1000) {
    throw new PriorGroundingError("PRIOR_PRODUCT_LIMIT", 409);
  }
  const byId = new Map<string, JsonObject>();
  for (const rawProduct of [...rawReferenceProducts, ...rawEvidenceItems]) {
    const product = object(rawProduct, "INVALID_PRIOR_PRODUCT");
    const productId = boundedString(product["productId"] ?? product["evidenceProductId"], "INVALID_PRIOR_PRODUCT_ID");
    if (byId.has(productId)) {
      throw new PriorGroundingError("DUPLICATE_PRIOR_PRODUCT_ID", 409);
    }
    byId.set(productId, product);
  }
  return selectedIds.map((productId) => {
    const product = byId.get(productId);
    if (product === undefined) {
      throw new PriorGroundingError("SELECTED_PRIOR_PRODUCT_NOT_FOUND", 409);
    }
    if (product["referenceKey"] === undefined) {
      throw new PriorGroundingError("PRIOR_PRODUCT_NOT_REVALIDATABLE", 409);
    }
    return {
      productId,
      product: structuredClone(product),
      referenceKey: validateReferenceKey(product["referenceKey"]),
    };
  });
}

function responseStatus(value: unknown): RevalidationStatus {
  const result = object(value, "INVALID_VALIDATION_RESULT");
  const legacyStatus = result["status"];
  if (
    (["VALID", "STALE", "EXPIRED", "NOT_FOUND", "TYPE_MISMATCH", "VERSION_CONFLICT", "SCOPE_DENIED"] as unknown[])
      .includes(legacyStatus)
  ) {
    return legacyStatus as RevalidationStatus;
  }
  const existence = result["existence"];
  const freshness = result["freshness"];
  const snapshot = result["snapshot"];
  const usable = result["usable"];
  const reasons = result["reasons"];
  if (!Array.isArray(reasons) || reasons.length > 100 || reasons.some((reason) => typeof reason !== "string")) {
    throw new PriorGroundingError("INVALID_VALIDATION_RESULT", 502);
  }
  if (existence === "SCOPE_DENIED") return "SCOPE_DENIED";
  if (existence === "NOT_FOUND" || existence === "RETIRED") return "NOT_FOUND";
  if (reasons.includes("TYPE_MISMATCH")) return "TYPE_MISMATCH";
  if (reasons.includes("VERSION_CONFLICT")) return "VERSION_CONFLICT";
  if (freshness === "EXPIRED") return "EXPIRED";
  if (existence === "AVAILABLE" && freshness === "CURRENT" && (snapshot === "CURRENT" || snapshot === "NOT_APPLICABLE") && usable === "YES") {
    return "VALID";
  }
  if (
    existence === "AVAILABLE" &&
    (["STALE", "UNKNOWN", "NOT_APPLICABLE"] as unknown[]).includes(freshness) &&
    (["CURRENT", "STALE", "UNKNOWN", "NOT_APPLICABLE"] as unknown[]).includes(snapshot) &&
    (usable === "REVALIDATE" || usable === "NO")
  ) {
    return "STALE";
  }
  throw new PriorGroundingError("INDETERMINATE_VALIDATION_RESULT", 502);
}

function validateSnapshotProof(response: PriorValidationGatewayResponse, pinned: QuerySnapshotManifest): void {
  if (response.snapshotManifest === undefined) {
    throw new PriorGroundingError("VALIDATION_SNAPSHOT_PROOF_MISSING", 502);
  }
  const actual = validateManifest(response.snapshotManifest);
  if (actual.mode !== "PINNED" || actual.consistency !== "PINNED" || canonicalJson(actual) !== canonicalJson(pinned)) {
    throw new PriorGroundingError("PINNED_SNAPSHOT_MISMATCH", 409);
  }
  if (!Array.isArray(response.snapshotAdherence)) {
    throw new PriorGroundingError("VALIDATION_SNAPSHOT_ADHERENCE_MISSING", 502);
  }
  const expectedKeys = pinned.resources
    .map(({ resourceKind, resourceId }) => `${resourceKind}\u0000${resourceId}`)
    .sort();
  const actualKeys = response.snapshotAdherence.map((entry) => {
    if (entry.status !== "MATCHED") {
      throw new PriorGroundingError("PINNED_SNAPSHOT_MISMATCH", 409);
    }
    return `${entry.resourceKind}\u0000${entry.resourceId}`;
  }).sort();
  if (canonicalJson(expectedKeys) !== canonicalJson(actualKeys)) {
    throw new PriorGroundingError("PINNED_SNAPSHOT_MISMATCH", 409);
  }
}

function parseValidationResponse(
  response: PriorValidationGatewayResponse,
  lock: ValidationOperationLock,
  references: GowmReferenceKey[],
  pinned: QuerySnapshotManifest,
  maximumResultBytes: number,
): Map<string, RevalidationStatus> {
  if (response.operationId !== lock.operationId || response.operationVersion !== lock.operationVersion) {
    throw new PriorGroundingError("VALIDATION_OPERATION_IDENTITY_MISMATCH", 502);
  }
  if (response.status !== "COMPLETED") {
    throw new PriorGroundingError(`PRIOR_VALIDATION_${response.status}`, response.status === "FAILED" ? 502 : 409);
  }
  validateSnapshotProof(response, pinned);
  let valueBytes: number;
  try {
    valueBytes = Buffer.byteLength(JSON.stringify(response.value), "utf8");
  } catch {
    throw new PriorGroundingError("INVALID_VALIDATION_RESULT", 502);
  }
  if (valueBytes > maximumResultBytes) {
    throw new PriorGroundingError("VALIDATION_RESULT_TOO_LARGE", 502);
  }
  const value = object(response.value, "INVALID_VALIDATION_RESULT");
  if (value["schemaVersion"] !== "1.0" || !Array.isArray(value["results"]) || value["results"].length > 100) {
    throw new PriorGroundingError("INVALID_VALIDATION_RESULT", 502);
  }
  const statuses = new Map<string, RevalidationStatus>();
  for (const rawResult of value["results"]) {
    const result = object(rawResult, "INVALID_VALIDATION_RESULT");
    const key = validateReferenceKey(result["referenceKey"]);
    const canonicalKey = canonicalJson(key);
    if (statuses.has(canonicalKey)) {
      throw new PriorGroundingError("DUPLICATE_VALIDATION_RESULT", 502);
    }
    statuses.set(canonicalKey, responseStatus(result));
  }
  const requestedKeys = new Set(references.map(canonicalJson));
  if (statuses.size !== requestedKeys.size || [...statuses.keys()].some((key) => !requestedKeys.has(key))) {
    throw new PriorGroundingError("VALIDATION_RESULT_COVERAGE_MISMATCH", 502);
  }
  return statuses;
}

export class PriorGroundingValidator {
  readonly #options: Required<Pick<PriorGroundingValidatorOptions,
    "maximumStoredResultBytes" | "maximumSelectedProducts" | "maximumValidationResultBytes" | "deadlineMs">> &
    Pick<PriorGroundingValidatorOptions, "store" | "gateway">;
  readonly #now: () => Date;
  readonly #locks: Map<(typeof validationOperations)[number], ValidationOperationLock>;

  constructor(options: PriorGroundingValidatorOptions) {
    this.#options = {
      store: options.store,
      gateway: options.gateway,
      maximumStoredResultBytes: options.maximumStoredResultBytes ?? 1_048_576,
      maximumSelectedProducts: options.maximumSelectedProducts ?? 64,
      maximumValidationResultBytes: options.maximumValidationResultBytes ?? 262_144,
      deadlineMs: options.deadlineMs ?? 30_000,
    };
    if (
      this.#options.maximumStoredResultBytes < 1 ||
      this.#options.maximumSelectedProducts < 1 ||
      this.#options.maximumValidationResultBytes < 1 ||
      this.#options.deadlineMs < 1
    ) {
      throw new PriorGroundingError("INVALID_PRIOR_GROUNDING_LIMIT", 500);
    }
    this.#now = options.now ?? (() => new Date());
    this.#locks = validateLocks(options.operationLocks);
  }

  async revalidate(input: {
    identity: PriorGroundingIdentity;
    dataScope: string;
    pointer: unknown;
  }): Promise<PriorGroundingResult> {
    const identity = validateIdentity(input.identity, input.dataScope);
    const dataScope = boundedString(input.dataScope, "INVALID_DATA_SCOPE");
    const pointer = validatePointer(input.pointer, this.#options.maximumSelectedProducts);
    const stored = await this.#options.store.read({
      groundingId: pointer.groundingId,
      actorId: identity.actorId,
      dataScope,
    });
    if (stored === null) notFoundInScope();
    if (
      stored.groundingId !== pointer.groundingId ||
      stored.servicePrincipalId !== identity.servicePrincipalId ||
      stored.actorId !== identity.actorId ||
      stored.dataScope !== dataScope ||
      !sameScopeSet(stored.datasetScopes, identity.datasetScopes) ||
      stored.authorizationContextHash !== identity.authorizationContextHash
    ) {
      notFoundInScope();
    }
    if (!(stored.resultBytes instanceof Uint8Array)) {
      throw new PriorGroundingError("INVALID_STORED_PRIOR_RESULT", 500);
    }
    if (stored.resultBytes.byteLength > this.#options.maximumStoredResultBytes) {
      throw new PriorGroundingError("PRIOR_RESULT_TOO_LARGE", 413);
    }
    if (sha256Bytes(stored.resultBytes) !== pointer.resultHash) {
      throw new PriorGroundingError("PRIOR_RESULT_HASH_MISMATCH", 409);
    }
    const source = parseStoredResult(stored.resultBytes, pointer.groundingId);
    const products = selectedProducts(source, pointer.selectedProductIds);
    const references = products.map(({ referenceKey }) => referenceKey);
    const referenceKeys = references.map(canonicalJson);
    if (new Set(referenceKeys).size !== referenceKeys.length) {
      throw new PriorGroundingError("DUPLICATE_SELECTED_REFERENCE_KEY", 409);
    }
    const snapshotManifest = pinnedReplayManifest(stored.querySnapshotManifest);
    const startedAt = this.#now();
    if (!Number.isFinite(startedAt.getTime())) {
      throw new PriorGroundingError("INVALID_CLOCK", 500);
    }
    const deadlineAt = new Date(startedAt.getTime() + this.#options.deadlineMs).toISOString();
    const observationsByProduct = new Map<string, ProductValidationObservation[]>();
    for (const product of products) observationsByProduct.set(product.productId, []);

    for (const operationId of validationOperations) {
      const lock = this.#locks.get(operationId)!;
      if (lock.requiredPermissions.some((permission) => !identity.permissions.includes(permission))) {
        throw new PriorGroundingError("VALIDATION_PERMISSION_REQUIRED", 403);
      }
      const operationKey = `${lock.operationId}@${lock.operationVersion}`;
      const requestSeed = {
        groundingId: pointer.groundingId,
        sourceResultHash: pointer.resultHash,
        selectedProductIds: pointer.selectedProductIds,
        snapshotManifestHash: snapshotManifest.manifestHash,
        operationKey,
        actorId: identity.actorId,
        dataScope,
        datasetScopes: normalizedScopeSet(identity.datasetScopes),
        authorizationContextHash: identity.authorizationContextHash,
      };
      const requestHash = sha256Canonical(requestSeed).slice("sha256:".length);
      const response = await this.#options.gateway.execute({
        operation: lock,
        requestId: `prior-${requestHash.slice(0, 32)}`,
        idempotencyKey: `prior:${requestHash}`,
        input: {
          schemaVersion: "1.0",
          references: references.map((referenceKey) => ({ referenceKey, requireCurrentSnapshot: true })),
        },
        snapshotPolicy: {
          mode: "PINNED",
          pinnedSnapshot: snapshotManifest,
          allowDowngrade: false,
        },
        identity,
        dataScope,
        deadlineAt,
        maximumResultBytes: this.#options.maximumValidationResultBytes,
      });
      const statuses = parseValidationResponse(
        response,
        lock,
        references,
        snapshotManifest,
        this.#options.maximumValidationResultBytes,
      );
      for (const product of products) {
        const status = statuses.get(canonicalJson(product.referenceKey));
        if (status === undefined) {
          throw new PriorGroundingError("VALIDATION_RESULT_COVERAGE_MISMATCH", 502);
        }
        if (status === "SCOPE_DENIED") notFoundInScope();
        observationsByProduct.get(product.productId)!.push({
          operationId,
          operationVersion: lock.operationVersion,
          status,
        });
      }
    }

    const revalidatedProducts = products.map((product) => {
      const validations = observationsByProduct.get(product.productId)!;
      return {
        productId: product.productId,
        referenceKey: product.referenceKey,
        product: product.product,
        usable: validations.length === validationOperations.length && validations.every(({ status }) => status === "VALID"),
        validations,
      };
    });
    const status = revalidatedProducts.every(({ usable }) => usable) ? "REVALIDATED" : "REVALIDATION_REQUIRED";
    const unsignedResult = {
      groundingId: pointer.groundingId,
      sourceResultHash: pointer.resultHash,
      dataScope,
      datasetScopes: normalizedScopeSet(identity.datasetScopes),
      snapshotManifest,
      status,
      products: revalidatedProducts,
    } as const;
    return {
      ...unsignedResult,
      revalidationHash: sha256Canonical(unsignedResult),
    };
  }
}
