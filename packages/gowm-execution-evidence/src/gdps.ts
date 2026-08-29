export type GdpsGroundingStatus =
  | "COMPLETED"
  | "PARTIAL"
  | "UNRESOLVED"
  | "AMBIGUOUS"
  | "INDETERMINATE"
  | "FAILED";

export type GdpsGapKind = "DATA_GAP" | "CAPABILITY_GAP" | "COVERAGE_GAP";

export interface GdpsSourceEvidence {
  readonly schemaVersion: "wsgs-gdps-source-evidence/1.0";
  readonly operationId: string;
  readonly operationVersion: string;
  readonly upstreamStatus: string;
  readonly normalizedStatus: GdpsGroundingStatus;
  readonly reasonCode?: string;
  readonly gapKind?: GdpsGapKind;
  readonly recipeId?: string;
  readonly recipeLockHash?: `sha256:${string}`;
  readonly descriptorId?: string;
  readonly descriptorHash?: `sha256:${string}`;
  readonly productType?: string;
  readonly productProfile?: string;
  readonly queryProfile?: string;
  readonly productId?: string;
  readonly contentHash?: `sha256:${string}`;
  readonly truncated: boolean;
  readonly emptyCurrentResult: boolean;
  readonly dataSnapshot?: Readonly<Record<string, unknown>>;
  readonly computeSnapshot?: Readonly<Record<string, unknown>>;
  readonly receiptIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly quality?: unknown;
  readonly coverage?: unknown;
  readonly evidence?: unknown;
  readonly warnings: readonly string[];
}

export interface GdpsEvidenceContext {
  readonly recipeId: string;
  readonly recipeLockHash: `sha256:${string}`;
  readonly descriptorId: string;
  readonly descriptorHash: `sha256:${string}`;
  readonly productType: string;
  readonly productProfile: string;
  readonly queryProfile: string;
}

export type GdpsReplayMode = "PINNED" | "STRICT" | "BEST_EFFORT";

export interface GdpsCurrentProductIdentity {
  readonly productId: string;
  readonly contentHash: `sha256:${string}`;
}

export interface GdpsCurrentnessCheck {
  readonly productId: string;
  readonly currentness: "CURRENT" | "CHANGED" | "NOT_AVAILABLE";
  readonly currentContentHash?: `sha256:${string}`;
}

export type GdpsReplayDecision =
  | {
      readonly status: "REPLAY_ALLOWED";
      readonly mode: GdpsReplayMode;
      readonly source: GdpsCurrentProductIdentity;
      readonly warnings: readonly [];
    }
  | {
      readonly status: "STALE" | "SNAPSHOT_MISMATCHED";
      readonly mode: "PINNED" | "STRICT";
      readonly source: GdpsCurrentProductIdentity;
      readonly actualContentHash?: `sha256:${string}`;
      readonly executionBlocked: true;
      readonly warnings: readonly ["SOURCE_CHANGED"] | readonly ["SOURCE_NOT_AVAILABLE"];
    }
  | {
      readonly status: "REPLAY_ALLOWED";
      readonly mode: "BEST_EFFORT";
      readonly source: GdpsCurrentProductIdentity;
      readonly priorContentHash: `sha256:${string}`;
      readonly warnings: readonly ["SOURCE_ADVANCED"];
    }
  | {
      readonly status: "UNRESOLVED";
      readonly mode: "BEST_EFFORT";
      readonly source: GdpsCurrentProductIdentity;
      readonly gapKind: "DATA_GAP";
      readonly executionBlocked: true;
      readonly warnings: readonly ["SOURCE_NOT_AVAILABLE"];
    };

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const operationIdPattern = /^[a-z][a-z0-9.-]{2,127}$/u;
const operationVersionPattern = /^\d+\.\d+$/u;
const productIdPattern = /^[a-z][a-z0-9-]{2,63}$/u;
const forbiddenProductVersionKey = /^(?:productVersion|product_version|productVersionId|product_version_id)$/iu;

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}

function assertNoProductVersion(value: unknown): void {
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (!entry || typeof entry !== "object") return;
    for (const [key, child] of Object.entries(entry)) {
      if (forbiddenProductVersionKey.test(key)) throw new Error("GDPS_PRODUCT_VERSION_SEMANTICS_FORBIDDEN");
      visit(child);
    }
  };
  visit(value);
}

function reasonCode(value: Record<string, unknown>, envelope: Record<string, unknown>): string | undefined {
  if (typeof value["code"] === "string") return value["code"];
  const error = envelope["error"];
  if (error && typeof error === "object" && !Array.isArray(error) && typeof (error as Record<string, unknown>)["code"] === "string") {
    return (error as Record<string, unknown>)["code"] as string;
  }
  return undefined;
}

function normalizedStatus(
  upstreamStatus: string,
  code: string | undefined,
  truncated: boolean
): Pick<GdpsSourceEvidence, "normalizedStatus" | "gapKind"> {
  if (code === "SOURCE_CHANGED_DURING_QUERY" || upstreamStatus === "INDETERMINATE") {
    return { normalizedStatus: "INDETERMINATE" };
  }
  if (["AMBIGUOUS_PRODUCT_SELECTION", "PRODUCT_COVERAGE_AMBIGUOUS"].includes(code ?? "")) {
    return { normalizedStatus: "AMBIGUOUS" };
  }
  if (code === "PRODUCT_COVERAGE_INSUFFICIENT") {
    return { normalizedStatus: "UNRESOLVED", gapKind: "COVERAGE_GAP" };
  }
  if (["OPERATION_UNAVAILABLE", "RECIPE_LOCK_DRIFT", "DESCRIPTOR_LOCK_DRIFT", "QUERY_PROFILE_UNSUPPORTED"]
      .includes(code ?? "")) {
    return { normalizedStatus: "UNRESOLVED", gapKind: "CAPABILITY_GAP" };
  }
  if (code === "PRODUCT_NOT_AVAILABLE" || upstreamStatus === "NO_DATA") {
    return { normalizedStatus: "UNRESOLVED", gapKind: "DATA_GAP" };
  }
  if (upstreamStatus === "FAILED") return { normalizedStatus: "FAILED" };
  if (truncated || upstreamStatus === "PARTIAL") return { normalizedStatus: "PARTIAL" };
  if (upstreamStatus === "COMPLETED") return { normalizedStatus: "COMPLETED" };
  throw new Error("GDPS_UPSTREAM_STATUS_INVALID");
}

function isEmptyFeatureCollection(value: Record<string, unknown>): boolean {
  return value["type"] === "FeatureCollection" && Array.isArray(value["features"]) && value["features"].length === 0;
}

export function normalizeGdpsSourceEvidence(
  envelopeValue: unknown,
  context?: GdpsEvidenceContext
): GdpsSourceEvidence {
  assertNoProductVersion(envelopeValue);
  assertNoProductVersion(context);
  const envelope = object(envelopeValue, "GDPS_ENVELOPE_INVALID");
  const operation = object(envelope["operation"], "GDPS_OPERATION_INVALID");
  const operationId = text(operation["operationId"], "GDPS_OPERATION_ID_INVALID");
  const operationVersion = text(operation["operationVersion"], "GDPS_OPERATION_VERSION_INVALID");
  if (!operationIdPattern.test(operationId) || !operationVersionPattern.test(operationVersion)) {
    throw new Error("GDPS_OPERATION_IDENTITY_INVALID");
  }
  const upstreamStatus = text(envelope["status"], "GDPS_UPSTREAM_STATUS_INVALID");
  const output = envelope["output"] === undefined ? undefined : object(envelope["output"], "GDPS_OUTPUT_INVALID");
  const value = output === undefined ? {} : object(output["value"], "GDPS_OUTPUT_VALUE_INVALID");
  const code = reasonCode(value, envelope);
  const truncated = value["truncated"] === true;
  const status = normalizedStatus(upstreamStatus, code, truncated);
  const productId = typeof value["productId"] === "string" ? value["productId"] : undefined;
  const contentHash = typeof value["contentHash"] === "string" ? value["contentHash"] : undefined;
  if (productId !== undefined && !productIdPattern.test(productId)) throw new Error("GDPS_PRODUCT_ID_INVALID");
  if (contentHash !== undefined && !digestPattern.test(contentHash)) throw new Error("GDPS_CONTENT_HASH_INVALID");
  if (["COMPLETED", "PARTIAL"].includes(status.normalizedStatus) && (!productId || !contentHash)) {
    throw new Error("GDPS_CURRENT_SOURCE_IDENTITY_REQUIRED");
  }
  if (context && (![context.recipeLockHash, context.descriptorHash].every((value) => digestPattern.test(value)) ||
      !context.recipeId || !context.descriptorId || !context.productType || !context.productProfile || !context.queryProfile)) {
    throw new Error("GDPS_EVIDENCE_CONTEXT_INVALID");
  }
  const receipts = Array.isArray(envelope["receipts"]) ? envelope["receipts"] : [];
  const receiptIds = receipts.map((entry) => text(object(entry, "GDPS_RECEIPT_INVALID")["receiptId"], "GDPS_RECEIPT_ID_INVALID"));
  const evidenceReferences = Array.isArray(envelope["evidenceReferences"])
    ? envelope["evidenceReferences"]
    : Array.isArray(envelope["evidence"]) ? envelope["evidence"] : [];
  const evidenceIds = evidenceReferences.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const evidenceId = (entry as Record<string, unknown>)["evidenceId"];
    return typeof evidenceId === "string" && evidenceId ? [evidenceId] : [];
  });
  const warnings = Array.isArray(envelope["warnings"])
    ? envelope["warnings"].map((entry) => text(entry, "GDPS_WARNING_INVALID"))
    : [];
  return Object.freeze({
    schemaVersion: "wsgs-gdps-source-evidence/1.0",
    operationId,
    operationVersion,
    upstreamStatus,
    normalizedStatus: status.normalizedStatus,
    ...(code === undefined ? {} : { reasonCode: code }),
    ...(status.gapKind === undefined ? {} : { gapKind: status.gapKind }),
    ...(context ? {
      recipeId: context.recipeId,
      recipeLockHash: context.recipeLockHash,
      descriptorId: context.descriptorId,
      descriptorHash: context.descriptorHash,
      productType: context.productType,
      productProfile: context.productProfile,
      queryProfile: context.queryProfile
    } : {}),
    ...(productId === undefined ? {} : { productId }),
    ...(contentHash === undefined ? {} : { contentHash: contentHash as `sha256:${string}` }),
    truncated,
    emptyCurrentResult: status.normalizedStatus === "COMPLETED" && isEmptyFeatureCollection(value),
    ...(envelope["dataSnapshot"] === undefined
      ? {}
      : { dataSnapshot: structuredClone(object(envelope["dataSnapshot"], "GDPS_DATA_SNAPSHOT_INVALID")) }),
    ...(envelope["computeSnapshot"] === undefined
      ? {}
      : { computeSnapshot: structuredClone(object(envelope["computeSnapshot"], "GDPS_COMPUTE_SNAPSHOT_INVALID")) }),
    receiptIds: Object.freeze([...new Set(receiptIds)].sort()),
    evidenceIds: Object.freeze([...new Set(evidenceIds)].sort()),
    ...(value["quality"] === undefined ? {} : { quality: structuredClone(value["quality"]) }),
    ...(value["coverage"] === undefined ? {} : { coverage: structuredClone(value["coverage"]) }),
    ...(value["evidence"] === undefined && envelope["evidence"] === undefined
      ? {}
      : { evidence: structuredClone(value["evidence"] ?? envelope["evidence"]) }),
    warnings: Object.freeze([...new Set(warnings)].sort())
  });
}

export function evaluateGdpsCurrentOnlyReplay(
  mode: GdpsReplayMode,
  prior: GdpsCurrentProductIdentity,
  check: GdpsCurrentnessCheck
): GdpsReplayDecision {
  if (!productIdPattern.test(prior.productId) || !digestPattern.test(prior.contentHash)) {
    throw new Error("GDPS_REPLAY_SOURCE_INVALID");
  }
  if (check.productId !== prior.productId) throw new Error("GDPS_REPLAY_PRODUCT_ID_MISMATCH");
  if (check.currentness !== "NOT_AVAILABLE" && (!check.currentContentHash || !digestPattern.test(check.currentContentHash))) {
    throw new Error("GDPS_REPLAY_CURRENT_HASH_REQUIRED");
  }
  if (check.currentness === "CURRENT") {
    if (check.currentContentHash !== prior.contentHash) throw new Error("GDPS_REPLAY_CURRENTNESS_CONTRADICTION");
    return { status: "REPLAY_ALLOWED", mode, source: structuredClone(prior), warnings: [] };
  }
  if (mode !== "BEST_EFFORT") {
    return check.currentness === "NOT_AVAILABLE"
      ? {
          status: "STALE",
          mode,
          source: structuredClone(prior),
          executionBlocked: true,
          warnings: ["SOURCE_NOT_AVAILABLE"]
        }
      : {
          status: "SNAPSHOT_MISMATCHED",
          mode,
          source: structuredClone(prior),
          actualContentHash: check.currentContentHash!,
          executionBlocked: true,
          warnings: ["SOURCE_CHANGED"]
        };
  }
  if (check.currentness === "NOT_AVAILABLE") {
    return {
      status: "UNRESOLVED",
      mode,
      source: structuredClone(prior),
      gapKind: "DATA_GAP",
      executionBlocked: true,
      warnings: ["SOURCE_NOT_AVAILABLE"]
    };
  }
  return {
    status: "REPLAY_ALLOWED",
    mode,
    source: { productId: prior.productId, contentHash: check.currentContentHash! },
    priorContentHash: prior.contentHash,
    warnings: ["SOURCE_ADVANCED"]
  };
}
