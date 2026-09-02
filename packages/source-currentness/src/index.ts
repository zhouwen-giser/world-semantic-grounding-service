import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;

export const GDPS_CURRENTNESS_RECIPE_LOCK_RAW_SHA256 =
  "sha256:fde020db21aae9158a420725b322aa0cd1baa8bac83b35ba795eb252502b2994" as const;
export const GDPS_CURRENTNESS_SEMANTIC_PATTERN = "GDPS_VALIDATE_SOURCE_CURRENTNESS" as const;

export class SourceCurrentnessError extends Error {
  constructor(readonly code: string) {
    super("Source currentness validation failed");
  }
}

export interface ValidateSourceCurrentnessRequest {
  schemaVersion: "wsgs-source-currentness-request/1.0";
  sourceProductId: string;
  productId: string;
  previousContentHash: `sha256:${string}`;
}

export type SourceCurrentnessStatus = "CURRENT" | "CHANGED" | "NOT_AVAILABLE" | "UNKNOWN";

export interface SourceCurrentnessResultMaterial {
  schemaVersion: "sacs-source-currentness/1.0";
  productId: string;
  previousContentHash: `sha256:${string}`;
  currentContentHash?: `sha256:${string}`;
  status: SourceCurrentnessStatus;
  checkedAt: string;
  validationGroundingId: string;
}

export interface SourceCurrentnessResult extends SourceCurrentnessResultMaterial {
  validationResultHash: `sha256:${string}`;
}

export interface GdpsCheckCurrentResult {
  schemaVersion: "gdps-check-current-result/1.0";
  productId: string;
  currentness: "CURRENT" | "CHANGED" | "NOT_AVAILABLE";
  currentContentHash?: `sha256:${string}`;
}

export interface SourceCurrentnessEvidence {
  schemaVersion: "wsgs-source-currentness-evidence/1.0";
  gatewayOnly: true;
  directProviderCalls: 0;
  queryId: string;
  operationId: "geo-product.check-current";
  operationVersion: "1.0";
  upstreamResultHash: `sha256:${string}`;
  receiptIds: readonly string[];
  evidenceHash: `sha256:${string}`;
}

export interface SourceCurrentnessRecipeAuthorization {
  recipeId: "gdps-check-current-geo-product";
  semanticPattern: typeof GDPS_CURRENTNESS_SEMANTIC_PATTERN;
  recipeLockHash: `sha256:${string}`;
  descriptorConstraint: null;
  previewAuthorizationRequired: true;
  allowedOperations: readonly [{
    operationId: "geo-product.check-current";
    operationVersion: "1.0";
    inputSchemaHash: `sha256:${string}`;
    outputSchemaHash: `sha256:${string}`;
    semanticProfileHash: `sha256:${string}`;
  }];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function canonicalSha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex")}`;
}

function fail(code: string): never {
  throw new SourceCurrentnessError(code);
}

export function parseSourceCurrentnessRequest(value: unknown): ValidateSourceCurrentnessRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("CURRENTNESS_REQUEST_INVALID");
  const request = value as Record<string, unknown>;
  const keys = Object.keys(request).sort();
  const expected = ["previousContentHash", "productId", "schemaVersion", "sourceProductId"];
  if (JSON.stringify(keys) !== JSON.stringify(expected) ||
      request["schemaVersion"] !== "wsgs-source-currentness-request/1.0" ||
      typeof request["sourceProductId"] !== "string" || !identifierPattern.test(request["sourceProductId"]) ||
      typeof request["productId"] !== "string" || !identifierPattern.test(request["productId"]) ||
      typeof request["previousContentHash"] !== "string" || !sha256Pattern.test(request["previousContentHash"])) {
    fail("CURRENTNESS_REQUEST_INVALID");
  }
  return Object.freeze(structuredClone(request)) as unknown as ValidateSourceCurrentnessRequest;
}

export function currentnessOperationInput(request: ValidateSourceCurrentnessRequest): Readonly<Record<string, unknown>> {
  const parsed = parseSourceCurrentnessRequest(request);
  return Object.freeze({ productId: parsed.productId, contentHash: parsed.previousContentHash });
}

function parsedGdpsResult(value: unknown, expectedProductId: string): GdpsCheckCurrentResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (result["schemaVersion"] !== "gdps-check-current-result/1.0" ||
      result["productId"] !== expectedProductId ||
      !["CURRENT", "CHANGED", "NOT_AVAILABLE"].includes(String(result["currentness"]))) return null;
  const currentness = result["currentness"] as GdpsCheckCurrentResult["currentness"];
  const hash = result["currentContentHash"];
  if (currentness === "NOT_AVAILABLE") {
    if (hash !== undefined) return null;
  } else if (typeof hash !== "string" || !sha256Pattern.test(hash)) return null;
  return structuredClone(result) as unknown as GdpsCheckCurrentResult;
}

export function normalizeSourceCurrentness(input: {
  request: ValidateSourceCurrentnessRequest;
  validationGroundingId: string;
  checkedAt: string;
  upstream: unknown;
}): SourceCurrentnessResultMaterial {
  const request = parseSourceCurrentnessRequest(input.request);
  if (!identifierPattern.test(input.validationGroundingId) || !Number.isFinite(Date.parse(input.checkedAt))) {
    fail("CURRENTNESS_CONTEXT_INVALID");
  }
  const upstream = parsedGdpsResult(input.upstream, request.productId);
  let status: SourceCurrentnessStatus = "UNKNOWN";
  let currentContentHash: `sha256:${string}` | undefined;
  if (upstream?.currentness === "NOT_AVAILABLE") status = "NOT_AVAILABLE";
  else if (upstream?.currentContentHash) {
    currentContentHash = upstream.currentContentHash;
    const derived = currentContentHash === request.previousContentHash ? "CURRENT" : "CHANGED";
    status = upstream.currentness === derived ? derived : "UNKNOWN";
    if (status === "UNKNOWN") currentContentHash = undefined;
  }
  return Object.freeze({
    schemaVersion: "sacs-source-currentness/1.0",
    productId: request.productId,
    previousContentHash: request.previousContentHash,
    ...(currentContentHash ? { currentContentHash } : {}),
    status,
    checkedAt: new Date(input.checkedAt).toISOString(),
    validationGroundingId: input.validationGroundingId
  });
}

export function sourceCurrentnessReuseDecision(
  status: SourceCurrentnessStatus,
  policy: "STRICT_REUSE" | "BEST_EFFORT"
): "REUSE_CURRENT" | "FAIL_CLOSED" | "REQUERY_REQUIRED" {
  if (status === "CURRENT") return "REUSE_CURRENT";
  return policy === "STRICT_REUSE" ? "FAIL_CLOSED" : "REQUERY_REQUIRED";
}

export function buildSourceCurrentnessEvidence(input: Omit<SourceCurrentnessEvidence, "schemaVersion" | "gatewayOnly" |
  "directProviderCalls" | "operationId" | "operationVersion" | "evidenceHash">): SourceCurrentnessEvidence {
  if (!identifierPattern.test(input.queryId) || !sha256Pattern.test(input.upstreamResultHash) ||
      input.receiptIds.some((entry) => !identifierPattern.test(entry))) fail("CURRENTNESS_EVIDENCE_INVALID");
  const material = {
    schemaVersion: "wsgs-source-currentness-evidence/1.0" as const,
    gatewayOnly: true as const,
    directProviderCalls: 0 as const,
    queryId: input.queryId,
    operationId: "geo-product.check-current" as const,
    operationVersion: "1.0" as const,
    upstreamResultHash: input.upstreamResultHash,
    receiptIds: [...new Set(input.receiptIds)].sort()
  };
  return Object.freeze({ ...material, evidenceHash: canonicalSha256(material) });
}

export function loadSourceCurrentnessRecipeAuthorization(path: string): SourceCurrentnessRecipeAuthorization {
  const bytes = readFileSync(path);
  const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
  if (hash !== GDPS_CURRENTNESS_RECIPE_LOCK_RAW_SHA256) fail("CURRENTNESS_RECIPE_LOCK_DRIFT");
  let document: unknown;
  try { document = JSON.parse(bytes.toString("utf8")) as unknown; } catch { fail("CURRENTNESS_RECIPE_LOCK_INVALID"); }
  if (!document || typeof document !== "object" || Array.isArray(document)) fail("CURRENTNESS_RECIPE_LOCK_INVALID");
  const recipes = (document as Record<string, unknown>)["recipes"];
  if (!Array.isArray(recipes)) fail("CURRENTNESS_RECIPE_LOCK_INVALID");
  const entry = recipes.find((candidate) => candidate && typeof candidate === "object" &&
    (candidate as Record<string, unknown>)["recipeId"] === "gdps-check-current-geo-product") as Record<string, unknown> | undefined;
  if (!entry || entry["requirementKind"] !== "CHECK_CURRENT_GEO_PRODUCT" ||
      entry["operationId"] !== "geo-product.check-current" || entry["operationVersion"] !== "1.0" ||
      entry["inputSchemaHash"] !== "sha256:284dd239dba4acd2fbc0a3a8d31a7bc7fa1783218b85ee5c9dce4ed19ac27ed9" ||
      entry["outputSchemaHash"] !== "sha256:67ef7be1d9057705654ce3a17f91c6c76b96dd176384b86e2a2eb269cdf0c475" ||
      entry["semanticProfileHash"] !== "sha256:69f1a115e6dcb55d6c5dbe589c9b486fb5ac708aeeec03282c6b665905182034" ||
      entry["allowedMaturity"] !== "PREVIEW") fail("CURRENTNESS_RECIPE_LOCK_INVALID");
  return Object.freeze({
    recipeId: "gdps-check-current-geo-product",
    semanticPattern: GDPS_CURRENTNESS_SEMANTIC_PATTERN,
    recipeLockHash: hash,
    descriptorConstraint: null,
    previewAuthorizationRequired: true,
    allowedOperations: Object.freeze([Object.freeze({
      operationId: "geo-product.check-current",
      operationVersion: "1.0",
      inputSchemaHash: entry["inputSchemaHash"] as `sha256:${string}`,
      outputSchemaHash: entry["outputSchemaHash"] as `sha256:${string}`,
      semanticProfileHash: entry["semanticProfileHash"] as `sha256:${string}`
    })]) as SourceCurrentnessRecipeAuthorization["allowedOperations"]
  });
}
