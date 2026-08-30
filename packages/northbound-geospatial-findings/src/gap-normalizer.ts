import {
  defaultSacsGeospatialSchemaRegistry,
  type SACSGeospatialTypedGap10
} from "@wsgs/contracts";
import {
  readValidatedGowmFindingResult,
  type ValidatedGowmFindingResult
} from "@wsgs/gowm-execution-evidence";

import { canonicalSha256, compareCodePoints, deterministicId } from "./canonical.js";
import {
  readNormalizedSourceProductBinding,
  type NormalizedSourceProductBinding,
  type SourceEnvelopeBinding
} from "./source-normalizer.js";
import type { GowmResultStatus, Sha256Digest } from "./types.js";

const derivedSignals = [
  "RESULT",
  "NO_DATA",
  "COVERAGE_GAP",
  "CAPABILITY_GAP",
  "PRODUCT_SELECTION_AMBIGUITY",
  "SOURCE_CHANGED",
  "UNSUPPORTED_FINDING_SCHEMA",
  "EVIDENCE_INCOMPLETE",
  "UPSTREAM_FAILURE",
  "INDETERMINATE"
] as const;

type DerivedGapSignal = (typeof derivedSignals)[number];
type SourceRejectionReason = Extract<
  SourceEnvelopeBinding["qualification"],
  { readonly status: "REJECTED" }
>["reason"];

export type NormalizedFindingStatus = Exclude<GowmResultStatus, "FAILED">;

export interface GapNormalizationInput {
  /** Opaque source/provenance token minted by the trusted N03 boundary. */
  readonly sourceBinding: NormalizedSourceProductBinding;
  /** Opaque contract-validated result token; raw envelopes are not accepted. */
  readonly validatedResult: ValidatedGowmFindingResult;
  readonly findingIds?: readonly string[];
}

export interface GapNormalizationResult {
  readonly status: NormalizedFindingStatus;
  readonly gaps: readonly SACSGeospatialTypedGap10[];
  readonly gapSetHash: Sha256Digest;
  readonly normalizationHash: Sha256Digest;
}

export class GapNormalizationError extends Error {
  constructor(readonly code: string) {
    super(`Geospatial gap normalization failed: ${code}`);
    this.name = "GapNormalizationError";
  }
}

type JsonRecord = Record<string, unknown>;

interface ParsedGapNormalizationInput {
  readonly resultBindingHash: Sha256Digest;
  readonly upstreamStatus: GowmResultStatus;
  readonly signal: DerivedGapSignal;
  readonly semanticConcept?: string;
  readonly findingIds: readonly string[];
  readonly evidenceItemIds: readonly string[];
  readonly truncated: boolean;
  readonly evidenceIncomplete: boolean;
  readonly rejectionReason?: SourceRejectionReason;
}

interface GapTemplate {
  readonly gapKind: SACSGeospatialTypedGap10["gapKind"];
  readonly severity: SACSGeospatialTypedGap10["severity"];
  readonly messageCode: string;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const statuses = new Set<GowmResultStatus>([
  "COMPLETED",
  "PARTIAL",
  "NO_DATA",
  "INDETERMINATE",
  "FAILED"
]);
const topLevelKeys = new Set([
  "sourceBinding",
  "validatedResult",
  "findingIds"
]);

function fail(code: string): never {
  throw new GapNormalizationError(code);
}

function record(value: unknown, code: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as JsonRecord;
}

function onlyKeys(value: JsonRecord, allowed: ReadonlySet<string>, code: string): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) fail(code);
}

function identifiers(value: unknown, code: string, maximum: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) fail(code);
  const parsed = value.map((item) => {
    if (typeof item !== "string" || !identifierPattern.test(item)) fail(code);
    return item;
  });
  if (new Set(parsed).size !== parsed.length) fail(code);
  return parsed.sort(compareCodePoints);
}

function optionalRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

const dataGapCodes = new Set(["PRODUCT_NOT_AVAILABLE", "NO_DATA_AT_LOCATION"]);
const coverageGapCodes = new Set(["PRODUCT_COVERAGE_INSUFFICIENT"]);
const productAmbiguityCodes = new Set([
  "PRODUCT_COVERAGE_AMBIGUOUS",
  "AMBIGUOUS_PRODUCT_SELECTION"
]);
const sourceChangedCodes = new Set(["SOURCE_CHANGED_DURING_QUERY"]);
const capabilityGapCodes = new Set([
  "QUERY_PROFILE_UNSUPPORTED",
  "OPERATION_UNAVAILABLE"
]);
const upstreamFailureCodes = new Set([
  "ASSET_UNAVAILABLE",
  "INTEGRITY",
  "INTEGRITY_FAILURE",
  "INTEGRITY_MISMATCH",
  "CONTENT_INTEGRITY_FAILED",
  "RECIPE_LOCK_DRIFT",
  "DESCRIPTOR_LOCK_DRIFT",
  "FAILED"
]);
const authoritativeBlockingSignals = new Set<DerivedGapSignal>([
  "UPSTREAM_FAILURE",
  "INDETERMINATE",
  "CAPABILITY_GAP",
  "PRODUCT_SELECTION_AMBIGUITY",
  "SOURCE_CHANGED"
]);

function reasonCode(envelope: ReturnType<typeof readValidatedGowmFindingResult>["envelope"]): string | undefined {
  const platformError = optionalRecord(envelope["error"]);
  const error = optionalRecord(platformError?.["error"]);
  if (typeof error?.["code"] === "string") return error["code"] as string;
  const outputValue = optionalRecord(envelope.output?.value);
  return typeof outputValue?.["code"] === "string" ? outputValue["code"] as string : undefined;
}

function payloadTruncated(envelope: ReturnType<typeof readValidatedGowmFindingResult>["envelope"]): boolean {
  const value = optionalRecord(envelope.output?.value);
  const nested = optionalRecord(value?.["result"]);
  return value?.["truncated"] === true || nested?.["truncated"] === true;
}

function payloadNoData(envelope: ReturnType<typeof readValidatedGowmFindingResult>["envelope"]): boolean {
  const value = optionalRecord(envelope.output?.value);
  const nested = optionalRecord(value?.["result"]);
  for (const candidate of [value, nested]) {
    if (candidate?.["noData"] === true) return true;
    for (const key of ["products", "features"] as const) {
      if (Array.isArray(candidate?.[key]) && candidate[key].length === 0) return true;
    }
    if (Array.isArray(candidate?.["samples"])) {
      const samples = candidate["samples"] as unknown[];
      if (samples.length === 0 || samples.every((sample) => optionalRecord(sample)?.["noData"] === true)) {
        return true;
      }
    }
  }
  return false;
}

function derivedSignal(
  envelope: ReturnType<typeof readValidatedGowmFindingResult>["envelope"]
): DerivedGapSignal {
  const code = reasonCode(envelope);
  // Terminal failure/indeterminate is authoritative and cannot be weakened by
  // a contradictory value code.
  if (envelope.status === "FAILED") {
    if (sourceChangedCodes.has(code ?? "")) return "SOURCE_CHANGED";
    if (productAmbiguityCodes.has(code ?? "")) return "PRODUCT_SELECTION_AMBIGUITY";
    if (capabilityGapCodes.has(code ?? "")) return "CAPABILITY_GAP";
    return "UPSTREAM_FAILURE";
  }
  if (envelope.status === "INDETERMINATE") {
    if (upstreamFailureCodes.has(code ?? "")) return "UPSTREAM_FAILURE";
    if (sourceChangedCodes.has(code ?? "")) return "SOURCE_CHANGED";
    if (productAmbiguityCodes.has(code ?? "")) return "PRODUCT_SELECTION_AMBIGUITY";
    if (capabilityGapCodes.has(code ?? "")) return "CAPABILITY_GAP";
    return "INDETERMINATE";
  }
  if (upstreamFailureCodes.has(code ?? "")) return "UPSTREAM_FAILURE";
  if (sourceChangedCodes.has(code ?? "")) return "SOURCE_CHANGED";
  if (productAmbiguityCodes.has(code ?? "")) return "PRODUCT_SELECTION_AMBIGUITY";
  if (capabilityGapCodes.has(code ?? "")) return "CAPABILITY_GAP";
  if (coverageGapCodes.has(code ?? "")) return "COVERAGE_GAP";
  if (dataGapCodes.has(code ?? "")
    || envelope.status === "NO_DATA"
    || (envelope.status === "COMPLETED" && payloadNoData(envelope))) {
    return "NO_DATA";
  }
  return "RESULT";
}

function parseInput(value: unknown): ParsedGapNormalizationInput {
  const source = record(value, "INVALID_GAP_NORMALIZATION_INPUT");
  onlyKeys(source, topLevelKeys, "UNKNOWN_GAP_NORMALIZATION_FIELD");
  const validated = readValidatedGowmFindingResult(
    source["validatedResult"] as ValidatedGowmFindingResult
  );
  const sourceProjection = readNormalizedSourceProductBinding(
    source["sourceBinding"] as NormalizedSourceProductBinding
  );
  const envelopeBindings = sourceProjection.envelopeBindings.filter(
    ({ envelopeHash }) => envelopeHash === validated.envelopeHash
  );
  if (envelopeBindings.length !== 1) fail("SOURCE_RESULT_BINDING_MISSING");
  const envelopeBinding = envelopeBindings[0]!;
  if (envelopeBinding.operationId !== validated.operation.operationId
    || envelopeBinding.operationVersion !== validated.operation.operationVersion
    || envelopeBinding.status !== validated.envelope.status) {
    fail("SOURCE_RESULT_BINDING_MISMATCH");
  }
  const upstreamStatus = validated.envelope.status;
  if (!statuses.has(upstreamStatus)) fail("INVALID_UPSTREAM_STATUS");
  const findingIds = identifiers(source["findingIds"], "INVALID_GAP_FINDING_IDS", 64);
  const evidenceItemIds = identifiers(
    envelopeBinding.evidenceItemIds,
    "INVALID_GAP_EVIDENCE_IDS",
    128
  );
  const rejectionReason = envelopeBinding.qualification.status === "REJECTED"
    ? envelopeBinding.qualification.reason
    : undefined;
  if (rejectionReason !== undefined
    && (envelopeBinding.sourceProductIds.length !== 0
      || envelopeBinding.evidenceItemIds.length !== 0
      || envelopeBinding.localEvidenceItem !== undefined)) {
    fail("REJECTED_BINDING_FACTS_FORBIDDEN");
  }
  if (rejectionReason !== undefined && findingIds.length > 0) {
    fail("REJECTED_FINDINGS_FORBIDDEN");
  }
  if (upstreamStatus === "FAILED" && findingIds.length > 0) fail("FAILED_FINDINGS_FORBIDDEN");
  const envelopeSignal = derivedSignal(validated.envelope);
  // A source-qualification rejection may mask an otherwise publishable/no-data
  // value, but it cannot weaken a terminal blocking platform signal.
  const signal: DerivedGapSignal = rejectionReason !== undefined
    && !authoritativeBlockingSignals.has(envelopeSignal)
    ? rejectionReason
    : envelopeSignal;
  const truncated = payloadTruncated(validated.envelope);
  const evidenceIncomplete = rejectionReason === undefined
    && upstreamStatus !== "FAILED"
    && envelopeBinding.evidenceItemIds.length === 0;
  if ((upstreamStatus === "FAILED" || upstreamStatus === "INDETERMINATE") && truncated) {
    fail("TERMINAL_TRUNCATION_CONTRADICTION");
  }
  if (signal === "NO_DATA" && findingIds.length > 0) fail("NO_DATA_FINDINGS_FORBIDDEN");
  if (signal === "NO_DATA" && truncated) fail("EMPTY_TRUNCATED_RESULT_CONTRADICTION");
  if (evidenceIncomplete && findingIds.length > 0) {
    fail("UNQUALIFIED_FINDINGS_FORBIDDEN");
  }
  return {
    resultBindingHash: validated.envelopeHash,
    upstreamStatus,
    signal,
    semanticConcept: validated.operation.semanticConcept,
    findingIds,
    evidenceItemIds,
    truncated,
    evidenceIncomplete,
    ...(rejectionReason === undefined ? {} : { rejectionReason })
  };
}

function primaryTemplate(input: ParsedGapNormalizationInput): GapTemplate | undefined {
  if (input.signal === "UPSTREAM_FAILURE") {
    return {
      gapKind: "UPSTREAM_FAILURE",
      severity: "BLOCKING",
      messageCode: "WSGS_UPSTREAM_FAILURE"
    };
  }
  if (input.signal === "INDETERMINATE") {
    return {
      gapKind: "UPSTREAM_FAILURE",
      severity: "BLOCKING",
      messageCode: "WSGS_UPSTREAM_INDETERMINATE"
    };
  }
  if (input.signal === "EVIDENCE_INCOMPLETE") {
    return {
      gapKind: "EVIDENCE_INCOMPLETE",
      severity: "BLOCKING",
      messageCode: "WSGS_EVIDENCE_INCOMPLETE"
    };
  }
  if (input.signal === "UNSUPPORTED_FINDING_SCHEMA") {
    return {
      gapKind: "UNSUPPORTED_FINDING_SCHEMA",
      severity: "BLOCKING",
      messageCode: "WSGS_UNSUPPORTED_FINDING_SCHEMA"
    };
  }
  switch (input.signal) {
    case "NO_DATA":
      return {
        gapKind: "DATA_GAP",
        severity: "INFO",
        messageCode: "WSGS_UPSTREAM_NO_DATA"
      };
    case "COVERAGE_GAP":
      return {
        gapKind: "COVERAGE_GAP",
        severity: "WARNING",
        messageCode: "WSGS_UPSTREAM_COVERAGE_GAP"
      };
    case "CAPABILITY_GAP":
      return {
        gapKind: "CAPABILITY_GAP",
        severity: "BLOCKING",
        messageCode: "WSGS_UPSTREAM_CAPABILITY_GAP"
      };
    case "PRODUCT_SELECTION_AMBIGUITY":
      return {
        gapKind: "PRODUCT_SELECTION_AMBIGUITY",
        severity: "BLOCKING",
        messageCode: "WSGS_UPSTREAM_PRODUCT_SELECTION_AMBIGUITY"
      };
    case "SOURCE_CHANGED":
      return {
        gapKind: "SOURCE_CHANGED",
        severity: "BLOCKING",
        messageCode: "WSGS_UPSTREAM_SOURCE_CHANGED"
      };
    case "RESULT":
      break;
  }
  if (input.upstreamStatus === "NO_DATA") {
    return {
      gapKind: "DATA_GAP",
      severity: "INFO",
      messageCode: "WSGS_UPSTREAM_NO_DATA"
    };
  }
  if (input.upstreamStatus === "PARTIAL") {
    return {
      gapKind: "DATA_GAP",
      severity: "WARNING",
      messageCode: "WSGS_UPSTREAM_PARTIAL_RESULT"
    };
  }
  return undefined;
}

function normalizedStatus(input: ParsedGapNormalizationInput): NormalizedFindingStatus {
  if (input.signal === "UPSTREAM_FAILURE"
    || input.signal === "INDETERMINATE"
    || input.signal === "PRODUCT_SELECTION_AMBIGUITY"
    || input.signal === "SOURCE_CHANGED"
    || input.signal === "UNSUPPORTED_FINDING_SCHEMA"
    || input.signal === "EVIDENCE_INCOMPLETE"
    || input.rejectionReason !== undefined
    || input.evidenceIncomplete
  ) {
    return "INDETERMINATE";
  }
  if (input.signal === "NO_DATA" || input.signal === "COVERAGE_GAP") {
    return "NO_DATA";
  }
  if (input.signal === "CAPABILITY_GAP") {
    return input.findingIds.length === 0 ? "INDETERMINATE" : "PARTIAL";
  }
  if (input.upstreamStatus === "PARTIAL" || input.truncated) return "PARTIAL";
  return "COMPLETED";
}

function materializeGap(
  input: ParsedGapNormalizationInput,
  template: GapTemplate
): SACSGeospatialTypedGap10 {
  const findingIds = input.findingIds.length === 0 ? undefined : [...input.findingIds];
  const evidenceItemIds = input.evidenceItemIds.length === 0
    ? undefined
    : [...input.evidenceItemIds];
  const gapId = deterministicId("gap", {
    resultBindingHash: input.resultBindingHash,
    gapKind: template.gapKind,
    messageCode: template.messageCode,
    semanticConcept: input.semanticConcept,
    findingIds,
    evidenceItemIds
  });
  return {
    gapId,
    gapKind: template.gapKind,
    severity: template.severity,
    messageCode: template.messageCode,
    ...(input.semanticConcept === undefined ? {} : { semanticConcept: input.semanticConcept }),
    ...(findingIds === undefined ? {} : { findingIds }),
    ...(evidenceItemIds === undefined ? {} : { evidenceItemIds })
  };
}

function templateKey(template: GapTemplate): string {
  return `${template.gapKind}\u0000${template.messageCode}`;
}

/**
 * Normalize GOWM/provider status and contract-derived signals into the public
 * Finding status plus typed gaps. Authority/evidence are derived exclusively
 * from opaque N03 and validated-GOWM tokens; raw scope, status, evidence, or
 * arbitrary upstream detail is neither accepted nor copied into the result.
 */
export function normalizeGeospatialGaps(inputValue: unknown): GapNormalizationResult {
  const input = parseInput(inputValue);
  const templates: GapTemplate[] = [];
  const primary = primaryTemplate(input);
  if (primary !== undefined) templates.push(primary);
  if (input.rejectionReason !== undefined && input.rejectionReason !== input.signal) {
    const rejection = primaryTemplate({ ...input, signal: input.rejectionReason });
    if (rejection === undefined) fail("REJECTED_BINDING_GAP_REQUIRED");
    templates.push(rejection);
  }
  if (input.truncated) {
    templates.push({
      gapKind: "TRUNCATED",
      severity: "WARNING",
      messageCode: "WSGS_RESULT_TRUNCATED"
    });
  }
  if (input.evidenceIncomplete) {
    templates.push({
      gapKind: "EVIDENCE_INCOMPLETE",
      severity: "BLOCKING",
      messageCode: "WSGS_EVIDENCE_INCOMPLETE"
    });
  }
  const uniqueTemplates = [...new Map(
    templates.map((template) => [templateKey(template), template] as const)
  ).values()];
  const gaps = uniqueTemplates
    .map((template) => materializeGap(input, template))
    .sort((left, right) => compareCodePoints(left.gapId, right.gapId));
  const schemaRegistry = defaultSacsGeospatialSchemaRegistry();
  for (const gap of gaps) schemaRegistry.validate("typed-gap.schema.json", gap);
  const status = normalizedStatus(input);
  const gapSetHash = canonicalSha256(gaps);
  const result = {
    status,
    gaps,
    gapSetHash,
    normalizationHash: canonicalSha256({ status, gaps })
  };
  return Object.freeze({ ...result, gaps: Object.freeze([...gaps]) });
}
