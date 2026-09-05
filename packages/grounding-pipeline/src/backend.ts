import { randomUUID } from "node:crypto";

import { canonicalBytes, canonicalSha256, utf8Sha256 } from "./canonical.js";
import {
  LEGACY_GROUNDING_CONTRACT_SELECTION,
  isSacsGeospatialContract,
  parseGroundingContractSelection,
  type GroundingContractSelection
} from "./contract-selection.js";
import { GROUNDING_OPERATIONS, type GroundingOperation } from "./types.js";

export interface ProductionGroundingIdentity {
  servicePrincipalId: string;
  actorId: string;
  dataScopes: string[];
  datasetScopes: string[];
  permissions: string[];
  authorizationContextHash: string;
}

export interface ScopedGroundingIdentity extends ProductionGroundingIdentity {
  dataScope: string;
}

export interface DurableGroundingSubmission {
  groundingId: string;
  jobId: string;
  requestId: string;
  operation: GroundingOperation;
  identity: ScopedGroundingIdentity;
  idempotencyKey: string;
  payloadHash: string;
  sourceTextSha256: string;
  sealedRequest: Uint8Array;
  sourceExpiresAt: Date;
  deadlineAt: Date;
  maxResultBytes: number;
  immutableLocks: Readonly<Record<string, unknown>>;
  gowmContractCatalogRevision: string;
  gowmSemanticCatalogHash: string;
  gowmConsumerPackageIntegrity: string;
  gowmOperationLockHash: string;
  contractSelection: GroundingContractSelection;
  requestMetadata: Readonly<Record<string, unknown>>;
}

export interface ProductionAdmissionSnapshot {
  immutableLocks: Readonly<Record<string, unknown>>;
  gowmContractCatalogRevision: string;
  gowmSemanticCatalogHash: string;
  gowmConsumerPackageIntegrity: string;
  gowmOperationLockHash: string;
}

export type DurableSubmissionOutcome =
  | { kind: "CREATED"; groundingId: string; jobId: string; job: unknown }
  | { kind: "REPLAY_JOB"; groundingId: string; jobId: string; job: unknown }
  | { kind: "REPLAY_RESULT"; groundingId: string; result: unknown };

export type GroundingPresentation =
  | { kind: "JOB"; value: unknown }
  | { kind: "RESULT"; value: unknown };

export type GroundingReplayLookup = Pick<DurableGroundingSubmission,
  "identity" | "idempotencyKey" | "payloadHash" | "contractSelection">;
export type GroundingReplayOutcome = Exclude<DurableSubmissionOutcome, { kind: "CREATED" }>;

export interface ProductionGroundingStore {
  replay(lookup: GroundingReplayLookup): Promise<GroundingReplayOutcome | null>;
  submit(submission: DurableGroundingSubmission): Promise<DurableSubmissionOutcome>;
  waitForTerminal(
    identity: ScopedGroundingIdentity,
    groundingId: string,
    deadlineAt: Date,
    contractSelection: GroundingContractSelection,
    signal?: AbortSignal
  ): Promise<GroundingPresentation>;
  get(
    identity: ScopedGroundingIdentity,
    groundingId: string,
    contractSelection: GroundingContractSelection
  ): Promise<unknown | null>;
  cancel(
    identity: ScopedGroundingIdentity,
    groundingId: string,
    contractSelection: GroundingContractSelection
  ): Promise<{ jobId: string; value: unknown } | null>;
}

export interface RequestSealer {
  seal(plaintext: Uint8Array, context: { groundingId: string; requestId: string }): Promise<Uint8Array>;
}

export interface GroundingCancellationNotifier {
  notify(jobId: string): void | Promise<void>;
}

export class ProductionBackendError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface ProductionGroundingBackendConfig {
  store: ProductionGroundingStore;
  sealer: RequestSealer;
  readiness: () => Promise<{ ready: boolean; reasons: string[] }>;
  capabilities: (
    identity: ProductionGroundingIdentity,
    contractSelection: GroundingContractSelection
  ) => Promise<unknown>;
  captureAdmissionSnapshot: (context: {
    identity: ScopedGroundingIdentity;
    request: Readonly<Record<string, unknown>>;
    groundingId: string;
    jobId: string;
  }) => Promise<ProductionAdmissionSnapshot>;
  cancellationNotifier?: GroundingCancellationNotifier;
  selectDataScope?: (identity: ProductionGroundingIdentity, request: Record<string, unknown>) => string;
  now?: () => number;
  newId?: () => string;
  sourceRetentionMs?: number;
}

function nonEmptyString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ProductionBackendError(code, code);
  return value;
}

function positiveInteger(value: unknown, minimum: number, maximum: number, code: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ProductionBackendError(code, code);
  }
  return value as number;
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProductionBackendError(code, code);
  return value as Record<string, unknown>;
}

function operation(value: unknown): GroundingOperation {
  if (typeof value !== "string" || !(GROUNDING_OPERATIONS as readonly string[]).includes(value)) {
    throw new ProductionBackendError("INVALID_GROUNDING_OPERATION", "Unsupported grounding operation");
  }
  return value as GroundingOperation;
}

function assertIdentity(identity: ProductionGroundingIdentity): void {
  nonEmptyString(identity.servicePrincipalId, "INVALID_SERVICE_PRINCIPAL");
  nonEmptyString(identity.actorId, "INVALID_ACTOR");
  if (!/^sha256:[0-9a-f]{64}$/u.test(identity.authorizationContextHash)) {
    throw new ProductionBackendError("INVALID_AUTHORIZATION_CONTEXT_HASH", "Invalid authorization context hash");
  }
  if (!Array.isArray(identity.dataScopes) || identity.dataScopes.length === 0 ||
    identity.dataScopes.some((scope) => typeof scope !== "string" || !scope.trim()) ||
    new Set(identity.dataScopes).size !== identity.dataScopes.length) {
    throw new ProductionBackendError("INVALID_DATA_SCOPES", "At least one non-empty data scope is required");
  }
  if (!Array.isArray(identity.datasetScopes) ||
    identity.datasetScopes.some((scope) => typeof scope !== "string" || !scope.trim()) ||
    new Set(identity.datasetScopes).size !== identity.datasetScopes.length) {
    throw new ProductionBackendError("INVALID_DATASET_SCOPES", "Dataset scopes must not contain empty values");
  }
  if (!Array.isArray(identity.permissions) || identity.permissions.length === 0 ||
    identity.permissions.some((permission) => typeof permission !== "string" || !permission.trim())) {
    throw new ProductionBackendError("INVALID_PERMISSIONS", "At least one non-empty permission is required");
  }
}

function assertAdmissionSnapshot(value: ProductionAdmissionSnapshot): void {
  if (!value.immutableLocks || typeof value.immutableLocks !== "object" || Array.isArray(value.immutableLocks)) {
    throw new ProductionBackendError("INVALID_ADMISSION_SNAPSHOT", "Admission snapshot locks must be an object");
  }
  for (const [field, digest] of [
    ["gowmContractCatalogRevision", value.gowmContractCatalogRevision],
    ["gowmSemanticCatalogHash", value.gowmSemanticCatalogHash],
    ["gowmOperationLockHash", value.gowmOperationLockHash]
  ] as const) {
    if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) {
      throw new ProductionBackendError("INVALID_ADMISSION_SNAPSHOT", `${field} must be a tagged SHA-256 digest`);
    }
  }
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(value.gowmConsumerPackageIntegrity)) {
    throw new ProductionBackendError("INVALID_ADMISSION_SNAPSHOT", "Consumer package integrity must be SHA-512 SRI");
  }
  try {
    canonicalBytes(value.immutableLocks);
  } catch {
    throw new ProductionBackendError("INVALID_ADMISSION_SNAPSHOT", "Admission snapshot locks are not canonical JSON");
  }
}

export class ProductionGroundingBackend {
  readonly #config: ProductionGroundingBackendConfig;
  readonly #now: () => number;
  readonly #newId: () => string;
  readonly #sourceRetentionMs: number;

  constructor(config: ProductionGroundingBackendConfig) {
    this.#config = config;
    this.#now = config.now ?? Date.now;
    this.#newId = config.newId ?? randomUUID;
    this.#sourceRetentionMs = config.sourceRetentionMs ?? 3_600_000;
    if (!Number.isInteger(this.#sourceRetentionMs) || this.#sourceRetentionMs < 1_000) {
      throw new ProductionBackendError("INVALID_SOURCE_RETENTION", "sourceRetentionMs must be at least 1000");
    }
  }

  readiness(): Promise<{ ready: boolean; reasons: string[] }> {
    return this.#config.readiness();
  }

  capabilities(
    identity: ProductionGroundingIdentity,
    contractSelection: GroundingContractSelection = LEGACY_GROUNDING_CONTRACT_SELECTION
  ): Promise<unknown> {
    assertIdentity(identity);
    return this.#config.capabilities(identity, parseGroundingContractSelection(contractSelection));
  }

  async create(
    identity: ProductionGroundingIdentity,
    idempotencyKey: string,
    request: Record<string, unknown>,
    preferAsync: boolean,
    contractSelectionOrSignal: GroundingContractSelection | AbortSignal = LEGACY_GROUNDING_CONTRACT_SELECTION,
    explicitSignal?: AbortSignal
  ): Promise<GroundingPresentation> {
    assertIdentity(identity);
    const legacySignal = typeof contractSelectionOrSignal === "object"
      && contractSelectionOrSignal !== null
      && typeof (contractSelectionOrSignal as AbortSignal).addEventListener === "function"
      ? contractSelectionOrSignal as AbortSignal
      : undefined;
    const contractSelection = legacySignal === undefined
      ? contractSelectionOrSignal as GroundingContractSelection
      : LEGACY_GROUNDING_CONTRACT_SELECTION;
    const signal = explicitSignal ?? legacySignal;
    const negotiatedContract = parseGroundingContractSelection(contractSelection);
    if (!idempotencyKey || idempotencyKey.length > 256) {
      throw new ProductionBackendError("INVALID_IDEMPOTENCY_KEY", "Idempotency key must contain 1 through 256 characters");
    }
    if (request["schemaVersion"] !== "1.0") {
      throw new ProductionBackendError("INVALID_SCHEMA_VERSION", "Only sacs-wsgs-grounding/1.0 requests are accepted");
    }
    const requestId = nonEmptyString(request["requestId"], "INVALID_REQUEST_ID");
    const requestedOperation = operation(request["operation"]);
    const source = object(request["source"], "INVALID_REQUEST_SOURCE");
    const originalText = nonEmptyString(source["originalText"], "INVALID_ORIGINAL_TEXT");
    const suppliedSourceHash = nonEmptyString(source["originalTextSha256"], "INVALID_SOURCE_HASH");
    const computedSourceHash = utf8Sha256(originalText);
    if (suppliedSourceHash !== computedSourceHash) {
      throw new ProductionBackendError("SOURCE_HASH_MISMATCH", "originalTextSha256 does not match originalText");
    }
    const executionPolicy = object(request["executionPolicy"], "INVALID_EXECUTION_POLICY");
    if (executionPolicy["readOnly"] !== true) {
      throw new ProductionBackendError("READ_ONLY_REQUIRED", "Grounding execution must be read-only");
    }
    const deadlineMs = positiveInteger(executionPolicy["deadlineMs"], 100, 120_000, "INVALID_DEADLINE");
    const maxResultBytes = positiveInteger(
      executionPolicy["maxResultBytes"],
      1_024,
      67_108_864,
      "INVALID_MAX_RESULT_BYTES"
    );
    const dataScope = this.#selectDataScope(identity, request);
    const scopedIdentity: ScopedGroundingIdentity = { ...identity, dataScope };
    const now = this.#now();
    // Keep existing results available without asking an upstream service to
    // admit new work. The store verifies payload, principal, authorization
    // context and the persisted contract before returning any replay.
    const payloadHash = isSacsGeospatialContract(negotiatedContract)
      ? canonicalSha256({ request, contractSelection: negotiatedContract })
      : canonicalSha256(request);
    const replay = await this.#config.store.replay({
      identity: scopedIdentity, idempotencyKey, payloadHash, contractSelection: negotiatedContract
    });
    if (replay) {
      if (replay.kind === "REPLAY_RESULT") return { kind: "RESULT", value: replay.result };
      if (preferAsync) return { kind: "JOB", value: replay.job };
      return this.#config.store.waitForTerminal(
        scopedIdentity, replay.groundingId, new Date(now + deadlineMs), negotiatedContract, signal
      );
    }
    const readiness = await this.#config.readiness();
    if (!readiness.ready) {
      throw new ProductionBackendError("NOT_READY", "Required grounding capabilities are not ready");
    }
    const groundingId = `grounding-${this.#newId()}`;
    const jobId = `job-${this.#newId()}`;
    const admissionSnapshot = await this.#config.captureAdmissionSnapshot({
      identity: scopedIdentity,
      request,
      groundingId,
      jobId
    });
    assertAdmissionSnapshot(admissionSnapshot);
    const sealedRequest = await this.#config.sealer.seal(canonicalBytes(request), { groundingId, requestId });
    if (!(sealedRequest instanceof Uint8Array) || sealedRequest.byteLength === 0) {
      throw new ProductionBackendError("REQUEST_SEAL_FAILED", "Request sealer returned no ciphertext");
    }
    const outcome = await this.#config.store.submit({
      groundingId,
      jobId,
      requestId,
      operation: requestedOperation,
      identity: scopedIdentity,
      idempotencyKey,
      payloadHash,
      sourceTextSha256: computedSourceHash,
      sealedRequest,
      sourceExpiresAt: new Date(now + this.#sourceRetentionMs),
      deadlineAt: new Date(now + deadlineMs),
      maxResultBytes,
      ...admissionSnapshot,
      contractSelection: negotiatedContract,
      requestMetadata: Object.freeze({
        schemaVersion: request["schemaVersion"],
        locale: source["locale"],
        messageId: source["messageId"],
        operation: requestedOperation,
        dataScopes: [...identity.dataScopes],
        permissions: [...identity.permissions],
        contractSelection: negotiatedContract
      })
    });

    if (outcome.kind === "REPLAY_RESULT") return { kind: "RESULT", value: outcome.result };
    if (preferAsync) return { kind: "JOB", value: outcome.job };
    return this.#config.store.waitForTerminal(
      scopedIdentity,
      outcome.groundingId,
      new Date(now + deadlineMs),
      negotiatedContract,
      signal
    );
  }

  async get(
    identity: ProductionGroundingIdentity,
    groundingId: string,
    contractSelection: GroundingContractSelection = LEGACY_GROUNDING_CONTRACT_SELECTION
  ): Promise<unknown | null> {
    assertIdentity(identity);
    return this.#config.store.get(
      this.#scope(identity, {}),
      nonEmptyString(groundingId, "INVALID_GROUNDING_ID"),
      parseGroundingContractSelection(contractSelection)
    );
  }

  async cancel(
    identity: ProductionGroundingIdentity,
    groundingId: string,
    contractSelection: GroundingContractSelection = LEGACY_GROUNDING_CONTRACT_SELECTION
  ): Promise<unknown | null> {
    assertIdentity(identity);
    const cancelled = await this.#config.store.cancel(
      this.#scope(identity, {}),
      nonEmptyString(groundingId, "INVALID_GROUNDING_ID"),
      parseGroundingContractSelection(contractSelection)
    );
    if (!cancelled) return null;
    await this.#config.cancellationNotifier?.notify(cancelled.jobId);
    return cancelled.value;
  }

  #selectDataScope(identity: ProductionGroundingIdentity, request: Record<string, unknown>): string {
    const selected = this.#config.selectDataScope
      ? this.#config.selectDataScope(identity, request)
      : identity.dataScopes.length === 1
        ? identity.dataScopes[0]
        : undefined;
    if (!selected || !identity.dataScopes.includes(selected)) {
      throw new ProductionBackendError(
        "DATA_SCOPE_SELECTION_REQUIRED",
        "A single authorized data scope must be selected without expanding authority"
      );
    }
    return selected;
  }

  #scope(identity: ProductionGroundingIdentity, request: Record<string, unknown>): ScopedGroundingIdentity {
    return { ...identity, dataScope: this.#selectDataScope(identity, request) };
  }
}
