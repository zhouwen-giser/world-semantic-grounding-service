import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const keyIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const referenceKeyIdPattern = /^wrf_[0-9a-f]{32}$/u;

export type StructuredSelectionErrorCode =
  | "SELECTION_NOT_FOUND"
  | "SELECTION_RESULT_HASH_MISMATCH"
  | "SELECTION_SOURCE_HASH_MISMATCH"
  | "SELECTION_REVISION_CONFLICT"
  | "SELECTION_SCOPE_MISMATCH"
  | "SELECTION_TOKEN_INVALID"
  | "SELECTION_TOKEN_EXPIRED"
  | "SELECTION_REFERENCE_STALE";

export class StructuredSelectionError extends Error {
  constructor(readonly code: StructuredSelectionErrorCode) {
    super("Structured world selection could not be resolved");
  }
}

export interface StructuredSelectionIdentity {
  servicePrincipalId: string;
  actorId: string;
  dataScope: string;
  authorizationContextHash: string;
}

export interface ResolveWorldSelectionRequest {
  schemaVersion: "wsgs-structured-selection-request/1.0";
  priorGroundingId: string;
  priorResultHash: string;
  findingId: string;
  featureId: string;
  selectionRevision: number;
  sourceHash: string;
}

export interface GowmReferenceKey {
  namespace: "gowm";
  kind: string;
  id: string;
  version: string;
}

export interface ResolveWorldSelectionResult {
  schemaVersion: "wsgs-structured-selection-result/1.0";
  selectionId: string;
  selectionKind: "FINDING_FEATURE";
  priorGroundingId: string;
  priorResultHash: string;
  findingId: string;
  featureId: string;
  referenceKey?: GowmReferenceKey;
  upstreamSelectionToken?: string;
  selectionRevision: number;
  sourceHash: string;
  selectedAt: string;
  expiresAt: string;
}

export interface PriorGroundingResult {
  groundingId: string;
  resultHash: string;
  geospatialFindings: {
    findings: readonly Readonly<Record<string, unknown>>[];
    sourceProducts: readonly Readonly<Record<string, unknown>>[];
  };
}

interface SelectionClaims {
  v: 1;
  selectionId: string;
  servicePrincipalId: string;
  actorId: string;
  dataScope: string;
  authorizationContextHash: string;
  priorGroundingId: string;
  priorResultHash: string;
  findingId: string;
  featureId: string;
  selectionRevision: number;
  sourceHash: string;
  issuedAt: number;
  expiresAt: number;
}

export interface StructuredSelectionTokenKey {
  keyId: string;
  key: Uint8Array;
}

export interface StructuredSelectionTokenCodecConfig {
  activeKeyId: string;
  keys: readonly StructuredSelectionTokenKey[];
  ttlMs: number;
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
}

export interface ResolveStructuredSelectionInput {
  identity: StructuredSelectionIdentity;
  request: ResolveWorldSelectionRequest;
  priorResult: PriorGroundingResult | null;
  latestSelectionRevision?: number;
  currentSourceHash?: string;
}

export interface VerifyStructuredSelectionInput {
  identity: StructuredSelectionIdentity;
  token: string;
  expected?: Partial<Pick<SelectionClaims,
    "selectionId" | "priorGroundingId" | "priorResultHash" | "findingId" |
    "featureId" | "selectionRevision" | "sourceHash">>;
  currentSourceHash?: string;
}

function fail(code: StructuredSelectionErrorCode): never {
  throw new StructuredSelectionError(code);
}

function assertIdentifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !identifierPattern.test(value)) fail("SELECTION_NOT_FOUND");
}

function assertSha256(value: unknown, code: StructuredSelectionErrorCode): asserts value is string {
  if (typeof value !== "string" || !sha256Pattern.test(value)) fail(code);
}

function assertIdentity(identity: StructuredSelectionIdentity): void {
  assertIdentifier(identity.servicePrincipalId);
  assertIdentifier(identity.actorId);
  assertIdentifier(identity.dataScope);
  assertSha256(identity.authorizationContextHash, "SELECTION_SCOPE_MISMATCH");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(canonicalize(value)), "utf8");
}

function selectionId(binding: Omit<SelectionClaims, "v" | "selectionId" | "issuedAt" | "expiresAt">): string {
  return `selection-${createHash("sha256").update(canonicalBytes(binding)).digest("hex")}`;
}

function referenceKey(value: unknown): GowmReferenceKey | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const key = value as Record<string, unknown>;
  if (key["namespace"] !== "gowm" || typeof key["kind"] !== "string" || !key["kind"] ||
    typeof key["id"] !== "string" || !referenceKeyIdPattern.test(key["id"]) ||
    typeof key["version"] !== "string" || !key["version"]) return undefined;
  return Object.freeze({
    namespace: "gowm",
    kind: key["kind"],
    id: key["id"],
    version: key["version"]
  });
}

function sourceProductHash(prior: PriorGroundingResult, finding: Readonly<Record<string, unknown>>, requested: string): string {
  const ids = finding["sourceProductIds"];
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((value) => typeof value !== "string")) {
    return fail("SELECTION_SOURCE_HASH_MISMATCH");
  }
  const products = prior.geospatialFindings.sourceProducts.filter((product) =>
    typeof product["sourceProductId"] === "string" && ids.includes(product["sourceProductId"])
  );
  if (products.length === 0) fail("SELECTION_SOURCE_HASH_MISMATCH");
  const hashes = products.map((product) => product["contentHash"]);
  if (!hashes.includes(requested)) fail("SELECTION_SOURCE_HASH_MISMATCH");
  return requested;
}

function selectedFeature(finding: Readonly<Record<string, unknown>>, featureId: string): Readonly<Record<string, unknown>> {
  const candidates = Array.isArray(finding["features"])
    ? finding["features"] as unknown[]
    : Array.isArray(finding["items"])
      ? finding["items"] as unknown[]
      : [];
  const feature = candidates.find((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const value = entry as Record<string, unknown>;
    return value["featureId"] === featureId || value["itemId"] === featureId;
  });
  if (!feature || typeof feature !== "object" || Array.isArray(feature)) fail("SELECTION_NOT_FOUND");
  return feature as Readonly<Record<string, unknown>>;
}

function parseClaims(value: unknown): SelectionClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("SELECTION_TOKEN_INVALID");
  const claims = value as Record<string, unknown>;
  const exact = [
    "v", "selectionId", "servicePrincipalId", "actorId", "dataScope",
    "authorizationContextHash", "priorGroundingId", "priorResultHash", "findingId",
    "featureId", "selectionRevision", "sourceHash", "issuedAt", "expiresAt"
  ];
  if (Object.keys(claims).length !== exact.length || exact.some((key) => !(key in claims)) || claims["v"] !== 1) {
    fail("SELECTION_TOKEN_INVALID");
  }
  for (const key of ["selectionId", "servicePrincipalId", "actorId", "dataScope", "priorGroundingId", "findingId", "featureId"] as const) {
    if (typeof claims[key] !== "string" || !identifierPattern.test(claims[key])) fail("SELECTION_TOKEN_INVALID");
  }
  for (const key of ["authorizationContextHash", "priorResultHash", "sourceHash"] as const) {
    if (typeof claims[key] !== "string" || !sha256Pattern.test(claims[key])) fail("SELECTION_TOKEN_INVALID");
  }
  if (!Number.isSafeInteger(claims["selectionRevision"]) || (claims["selectionRevision"] as number) < 1 ||
    !Number.isSafeInteger(claims["issuedAt"]) || !Number.isSafeInteger(claims["expiresAt"]) ||
    (claims["expiresAt"] as number) <= (claims["issuedAt"] as number)) fail("SELECTION_TOKEN_INVALID");
  return claims as unknown as SelectionClaims;
}

export class StructuredSelectionTokenCodec {
  readonly #activeKeyId: string;
  readonly #keys: ReadonlyMap<string, Uint8Array>;
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #randomBytes: (size: number) => Uint8Array;

  constructor(config: StructuredSelectionTokenCodecConfig) {
    if (!keyIdPattern.test(config.activeKeyId)) throw new Error("selection active keyId is invalid");
    if (!Number.isSafeInteger(config.ttlMs) || config.ttlMs < 1_000 || config.ttlMs > 86_400_000) {
      throw new Error("selection ttlMs must be an integer from 1000 through 86400000");
    }
    const keys = new Map<string, Uint8Array>();
    for (const entry of config.keys) {
      if (!keyIdPattern.test(entry.keyId) || entry.key.byteLength !== 32 || keys.has(entry.keyId)) {
        throw new Error("selection key ring is invalid");
      }
      keys.set(entry.keyId, entry.key.slice());
    }
    if (!keys.has(config.activeKeyId)) throw new Error("selection active key is missing from key ring");
    this.#activeKeyId = config.activeKeyId;
    this.#keys = keys;
    this.#ttlMs = config.ttlMs;
    this.#now = config.now ?? Date.now;
    this.#randomBytes = config.randomBytes ?? randomBytes;
  }

  issue(input: Omit<SelectionClaims, "v" | "issuedAt" | "expiresAt">): { token: string; claims: SelectionClaims } {
    const now = this.#now();
    const claims: SelectionClaims = Object.freeze({
      v: 1,
      ...input,
      issuedAt: now,
      expiresAt: now + this.#ttlMs
    });
    const key = this.#keys.get(this.#activeKeyId);
    if (!key) throw new Error("selection active key disappeared");
    const iv = Buffer.from(this.#randomBytes(12));
    if (iv.byteLength !== 12) throw new Error("selection nonce source returned an invalid nonce");
    const prefix = `wsgs.sel.v1.${this.#activeKeyId}`;
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(prefix, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(canonicalBytes(claims)), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      token: `${prefix}.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}`,
      claims
    };
  }

  verify(input: VerifyStructuredSelectionInput): SelectionClaims {
    if (typeof input.token !== "string" || input.token.length > 4096) fail("SELECTION_TOKEN_INVALID");
    const parts = input.token.split(".");
    if (parts.length !== 7 || parts[0] !== "wsgs" || parts[1] !== "sel" || parts[2] !== "v1") {
      fail("SELECTION_TOKEN_INVALID");
    }
    const keyId = parts[3];
    const key = keyId === undefined ? undefined : this.#keys.get(keyId);
    if (!key || !keyIdPattern.test(keyId ?? "")) fail("SELECTION_TOKEN_INVALID");
    const prefix = `wsgs.sel.v1.${keyId}`;
    let claims: SelectionClaims;
    try {
      const iv = Buffer.from(parts[4] ?? "", "base64url");
      const ciphertext = Buffer.from(parts[5] ?? "", "base64url");
      const tag = Buffer.from(parts[6] ?? "", "base64url");
      if (iv.byteLength !== 12 || ciphertext.byteLength === 0 || tag.byteLength !== 16) fail("SELECTION_TOKEN_INVALID");
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from(prefix, "utf8"));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      claims = parseClaims(JSON.parse(plaintext.toString("utf8")) as unknown);
    } catch (error) {
      if (error instanceof StructuredSelectionError) throw error;
      return fail("SELECTION_TOKEN_INVALID");
    }
    assertIdentity(input.identity);
    if (claims.servicePrincipalId !== input.identity.servicePrincipalId ||
      claims.actorId !== input.identity.actorId ||
      claims.dataScope !== input.identity.dataScope ||
      claims.authorizationContextHash !== input.identity.authorizationContextHash) {
      fail("SELECTION_SCOPE_MISMATCH");
    }
    if (claims.expiresAt < this.#now()) fail("SELECTION_TOKEN_EXPIRED");
    for (const keyName of [
      "selectionId", "priorGroundingId", "priorResultHash", "findingId",
      "featureId", "selectionRevision", "sourceHash"
    ] as const) {
      const expected = input.expected?.[keyName];
      if (expected !== undefined && claims[keyName] !== expected) {
        fail(keyName === "sourceHash" ? "SELECTION_SOURCE_HASH_MISMATCH" : "SELECTION_TOKEN_INVALID");
      }
    }
    if (input.currentSourceHash !== undefined && input.currentSourceHash !== claims.sourceHash) {
      fail("SELECTION_REFERENCE_STALE");
    }
    return Object.freeze(structuredClone(claims));
  }
}

export class StructuredWorldSelectionResolver {
  constructor(
    private readonly codec: StructuredSelectionTokenCodec,
    private readonly now: () => number = Date.now
  ) {}

  resolve(input: ResolveStructuredSelectionInput): ResolveWorldSelectionResult {
    assertIdentity(input.identity);
    const request = input.request;
    if (request.schemaVersion !== "wsgs-structured-selection-request/1.0") fail("SELECTION_NOT_FOUND");
    for (const value of [request.priorGroundingId, request.findingId, request.featureId]) assertIdentifier(value);
    assertSha256(request.priorResultHash, "SELECTION_RESULT_HASH_MISMATCH");
    assertSha256(request.sourceHash, "SELECTION_SOURCE_HASH_MISMATCH");
    if (!Number.isSafeInteger(request.selectionRevision) || request.selectionRevision < 1 ||
      request.selectionRevision !== (input.latestSelectionRevision ?? 0) + 1) {
      fail("SELECTION_REVISION_CONFLICT");
    }
    const prior = input.priorResult;
    if (!prior || prior.groundingId !== request.priorGroundingId) fail("SELECTION_NOT_FOUND");
    if (prior.resultHash !== request.priorResultHash) fail("SELECTION_RESULT_HASH_MISMATCH");
    const finding = prior.geospatialFindings.findings.find((entry) => entry["findingId"] === request.findingId);
    if (!finding) fail("SELECTION_NOT_FOUND");
    const feature = selectedFeature(finding, request.featureId);
    sourceProductHash(prior, finding, request.sourceHash);
    if (input.currentSourceHash !== undefined && input.currentSourceHash !== request.sourceHash) {
      fail("SELECTION_REFERENCE_STALE");
    }
    const binding = {
      servicePrincipalId: input.identity.servicePrincipalId,
      actorId: input.identity.actorId,
      dataScope: input.identity.dataScope,
      authorizationContextHash: input.identity.authorizationContextHash,
      priorGroundingId: request.priorGroundingId,
      priorResultHash: request.priorResultHash,
      findingId: request.findingId,
      featureId: request.featureId,
      selectionRevision: request.selectionRevision,
      sourceHash: request.sourceHash
    };
    const id = selectionId(binding);
    const selectedAtMs = this.now();
    const key = referenceKey(feature["referenceKey"]);
    const issued = key === undefined ? this.codec.issue({ selectionId: id, ...binding }) : undefined;
    const expiresAtMs = issued?.claims.expiresAt ?? selectedAtMs + 300_000;
    return Object.freeze({
      schemaVersion: "wsgs-structured-selection-result/1.0",
      selectionId: id,
      selectionKind: "FINDING_FEATURE",
      priorGroundingId: request.priorGroundingId,
      priorResultHash: request.priorResultHash,
      findingId: request.findingId,
      featureId: request.featureId,
      ...(key === undefined ? { upstreamSelectionToken: issued!.token } : { referenceKey: key }),
      selectionRevision: request.selectionRevision,
      sourceHash: request.sourceHash,
      selectedAt: new Date(selectedAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString()
    });
  }

  verify(input: VerifyStructuredSelectionInput): SelectionClaims {
    return this.codec.verify(input);
  }
}
