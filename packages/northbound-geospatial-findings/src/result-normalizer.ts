import {
  SACS_GEOSPATIAL_FINDINGS_PROFILE,
  defaultSacsGeospatialSchemaRegistry,
  type GroundingResult11WithSACSGeospatialFindings,
  type SACSGeospatialFindingsProfile10,
  type SACSGeospatialTypedGap10,
  type SacsGeospatialSourceProduct,
  type SacsWorldFinding
} from "@wsgs/contracts";
import {
  readValidatedGowmFindingResult,
  type ValidatedGowmFindingResult
} from "@wsgs/gowm-execution-evidence";

import { canonicalSha256, compareCodePoints, deterministicId } from "./canonical.js";
import { normalizeGeospatialGaps } from "./gap-normalizer.js";
import { FindingDecoderRegistry, standardDecoderRegistrations } from "./registry.js";
import {
  readNormalizedSourceProductBinding,
  type NormalizedSourceProductBinding,
  type NormalizedSourceProductProjection,
  type SourceEnvelopeBinding
} from "./source-normalizer.js";
import type { FindingDecoderInput, StandardDecoderSchemaBinding } from "./types.js";
import { createFindingDecoderInput } from "./validation.js";

export const SACS_GEOSPATIAL_FINDINGS_SCHEMA_HASH =
  "sha256:0590ba82c33d0fe54de8f7aaec936e95614186e9033433e564a4dd81691907e1" as const;

export interface AssembleGeospatialFindingsInput {
  /** Opaque N03 source/provenance token. Raw source products are not accepted. */
  readonly sourceBinding: NormalizedSourceProductBinding;
  /** Opaque, contract-validated GOWM result tokens used to mint decoder inputs. */
  readonly validatedResults: readonly ValidatedGowmFindingResult[];
}

type GroundingEvidenceItem = GroundingResult11WithSACSGeospatialFindings["evidenceItems"][number];

export interface GeospatialFindingsAssembly {
  readonly geospatialFindings: Profile;
  readonly evidenceItems: readonly GroundingEvidenceItem[];
  readonly evidenceItemSetHash: `sha256:${string}`;
  readonly assemblyHash: `sha256:${string}`;
}

export class ResultNormalizationError extends Error {
  constructor(readonly code: string) {
    super(`Geospatial result normalization failed: ${code}`);
    this.name = "ResultNormalizationError";
  }
}

type Profile = SACSGeospatialFindingsProfile10;
type PublicItem = SacsWorldFinding | SacsGeospatialSourceProduct | SACSGeospatialTypedGap10;

interface DecodableEnvelope {
  readonly input: FindingDecoderInput;
  readonly result: ValidatedGowmFindingResult;
  readonly binding: SourceEnvelopeBinding;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const sensitiveStringPattern = /(?:https?:\/\/|(?:postgres(?:ql)?|mysql|mongodb|redis|s3|gs|file):\/\/|\bBearer\s+|\bAuthorization\s*[:=]|\btoken\s*[:=]|-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----|[A-Za-z]:\\|\\\\[^\\])/iu;
const sqlDetailPattern = /\b(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+.+\s+SET|DELETE\s+FROM)\b/iu;

function fail(code: string): never {
  throw new ResultNormalizationError(code);
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function assertIdentifiers(values: readonly string[], code: string): void {
  if (!Array.isArray(values)
    || values.some((value) => typeof value !== "string" || !identifierPattern.test(value))) {
    fail(code);
  }
}

function sorted(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || compareCodePoints(values[index - 1]!, value) <= 0
  );
}

function identityValue(value: PublicItem): string {
  if ("findingId" in value) return value.findingId;
  if ("sourceProductId" in value) return value.sourceProductId;
  return value.gapId;
}

function uniqueByIdentity<T extends PublicItem>(
  values: readonly T[],
  collisionCode: string
): T[] {
  const valuesById = new Map<string, T>();
  for (const value of values) {
    const id = identityValue(value);
    const prior = valuesById.get(id);
    if (prior !== undefined && canonicalSha256(prior) !== canonicalSha256(value)) fail(collisionCode);
    valuesById.set(id, prior ?? value);
  }
  return [...valuesById.values()]
    .sort((left, right) => compareCodePoints(identityValue(left), identityValue(right)));
}

function assertNoSensitiveProjection(value: unknown): void {
  const visit = (candidate: unknown): void => {
    if (typeof candidate === "string") {
      if (sensitiveStringPattern.test(candidate) || sqlDetailPattern.test(candidate)) {
        fail("SENSITIVE_RESULT_PROJECTION_FORBIDDEN");
      }
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (candidate === null || typeof candidate !== "object") return;
    for (const [key, child] of Object.entries(candidate as Record<string, unknown>)) {
      if (/^(?:request|envelope|receipt|computeSnapshot|dataSnapshot|execution|providerUrl|internal)/iu.test(key)) {
        fail("INTERNAL_RESULT_FIELD_FORBIDDEN");
      }
      visit(child);
    }
  };
  visit(value);
}

function requireCanonicalOrder<T extends PublicItem>(
  values: readonly T[],
  orderCode: string,
  duplicateCode: string,
  collisionCode: string
): void {
  const ids = values.map(identityValue);
  assertIdentifiers(ids, orderCode);
  const seen = new Map<string, T>();
  for (const value of values) {
    const id = identityValue(value);
    const prior = seen.get(id);
    if (prior !== undefined) {
      if (canonicalSha256(prior) !== canonicalSha256(value)) fail(collisionCode);
      fail(duplicateCode);
    }
    seen.set(id, value);
  }
  if (!sorted(ids)) fail(orderCode);
}

/** Validate schema locks, canonical sets, and every result-local foreign key. */
export function assertGeospatialFindingsProfileIntegrity(
  profileValue: unknown,
  evidenceItemIdsValue: readonly string[]
): asserts profileValue is Profile {
  defaultSacsGeospatialSchemaRegistry().validate("geospatial-findings.schema.json", profileValue);
  const profile = profileValue as Profile;
  if (profile.profile !== SACS_GEOSPATIAL_FINDINGS_PROFILE
    || profile.profileSchemaHash !== SACS_GEOSPATIAL_FINDINGS_SCHEMA_HASH) {
    fail("GEOSPATIAL_PROFILE_LOCK_MISMATCH");
  }
  assertIdentifiers(evidenceItemIdsValue, "EVIDENCE_ID_SET_INVALID");
  if (new Set(evidenceItemIdsValue).size !== evidenceItemIdsValue.length) {
    fail("EVIDENCE_ID_SET_DUPLICATE");
  }
  const evidenceIds = new Set(evidenceItemIdsValue);

  requireCanonicalOrder(profile.findings, "FINDING_ORDER_NON_CANONICAL", "FINDING_ID_DUPLICATE", "FINDING_ID_COLLISION");
  requireCanonicalOrder(profile.sourceProducts, "SOURCE_PRODUCT_ORDER_NON_CANONICAL", "SOURCE_PRODUCT_ID_DUPLICATE", "SOURCE_PRODUCT_ID_COLLISION");
  requireCanonicalOrder(profile.gaps, "GAP_ORDER_NON_CANONICAL", "GAP_ID_DUPLICATE", "GAP_ID_COLLISION");

  const findingIds = new Set(profile.findings.map(({ findingId }) => findingId));
  const sourceProductIds = new Set(profile.sourceProducts.map(({ sourceProductId }) => sourceProductId));
  for (const source of profile.sourceProducts) {
    if (source.evidenceItemIds.length < 1) fail("SOURCE_PRODUCT_EVIDENCE_REQUIRED");
    for (const id of source.evidenceItemIds) {
      if (!evidenceIds.has(id)) fail("SOURCE_PRODUCT_EVIDENCE_FK_MISSING");
    }
  }
  for (const finding of profile.findings) {
    if (finding.sourceProductIds.length < 1) fail("FINDING_SOURCE_PRODUCT_REQUIRED");
    if (finding.evidenceItemIds.length < 1) fail("FINDING_EVIDENCE_REQUIRED");
    for (const id of finding.sourceProductIds) {
      if (!sourceProductIds.has(id)) fail("FINDING_SOURCE_PRODUCT_FK_MISSING");
    }
    for (const id of finding.evidenceItemIds) {
      if (!evidenceIds.has(id)) fail("FINDING_EVIDENCE_FK_MISSING");
    }
  }
  for (const gap of profile.gaps) {
    for (const id of gap.findingIds ?? []) {
      if (!findingIds.has(id)) fail("GAP_FINDING_FK_MISSING");
    }
    for (const id of gap.evidenceItemIds ?? []) {
      if (!evidenceIds.has(id)) fail("GAP_EVIDENCE_FK_MISSING");
    }
  }
  if (canonicalSha256(profile.findings) !== profile.findingSetHash) fail("FINDING_SET_HASH_MISMATCH");
  if (canonicalSha256(profile.sourceProducts) !== profile.sourceProductSetHash) {
    fail("SOURCE_PRODUCT_SET_HASH_MISMATCH");
  }
  assertNoSensitiveProjection(profile);
}

function bindingByHash(
  projection: NormalizedSourceProductProjection,
  results: readonly ValidatedGowmFindingResult[]
): Map<string, { result: ValidatedGowmFindingResult; binding: SourceEnvelopeBinding }> {
  if (!Array.isArray(results) || results.length < 1) fail("VALIDATED_RESULTS_REQUIRED");
  const resultByHash = new Map<string, ValidatedGowmFindingResult>();
  for (const result of results) {
    const validated = readValidatedGowmFindingResult(result);
    if (resultByHash.has(validated.envelopeHash)) fail("DUPLICATE_VALIDATED_RESULT");
    resultByHash.set(validated.envelopeHash, result);
  }
  if (resultByHash.size !== projection.envelopeBindings.length) fail("SOURCE_RESULT_BINDING_SET_MISMATCH");
  const matches = new Map<string, { result: ValidatedGowmFindingResult; binding: SourceEnvelopeBinding }>();
  for (const binding of projection.envelopeBindings) {
    const result = resultByHash.get(binding.envelopeHash);
    if (result === undefined) fail("SOURCE_RESULT_BINDING_SET_MISMATCH");
    const validated = readValidatedGowmFindingResult(result);
    if (validated.envelope.status !== binding.status
      || validated.operation.operationId !== binding.operationId
      || validated.operation.operationVersion !== binding.operationVersion) {
      fail("SOURCE_RESULT_BINDING_IDENTITY_MISMATCH");
    }
    matches.set(binding.envelopeHash, { result, binding });
  }
  return matches;
}

function registration(input: FindingDecoderInput): StandardDecoderSchemaBinding {
  const output = input.envelope.output;
  if (output === undefined) fail("DECODER_OUTPUT_REQUIRED");
  const binding = {
    pattern: input.descriptor.decoderPattern,
    matchQueryProfile: input.descriptor.queryProfile,
    payloadSchemaUri: output.schemaUri,
    payloadSchemaHash: output.schemaHash,
    priority: "EXACT_OPERATION_SCHEMA" as const,
    operationId: input.envelope.operation.operationId,
    operationVersion: input.envelope.operation.operationVersion,
    semanticProfileHash: input.descriptor.semanticProfileHash,
    ...(input.descriptor.productType === undefined ? {} : { productType: input.descriptor.productType }),
    ...(input.descriptor.productProfile === undefined ? {} : { productProfile: input.descriptor.productProfile }),
    querySemantics: input.descriptor.querySemantics
  } satisfies Omit<StandardDecoderSchemaBinding, "decoderId">;
  return { decoderId: deterministicId("decoder", binding), ...binding };
}

function registrationsFor(decodable: readonly DecodableEnvelope[]): StandardDecoderSchemaBinding[] {
  const byId = new Map<string, StandardDecoderSchemaBinding>();
  for (const { input } of decodable) {
    const item = registration(input);
    const id = item.decoderId!;
    const prior = byId.get(id);
    if (prior !== undefined && canonicalSha256(prior) !== canonicalSha256(item)) {
      fail("DECODER_REGISTRATION_COLLISION");
    }
    byId.set(id, prior ?? item);
  }
  return [...byId.values()].sort((left, right) => compareCodePoints(left.decoderId!, right.decoderId!));
}

function mergeEnvelopeGaps(
  normalized: readonly SACSGeospatialTypedGap10[],
  decoded: readonly SACSGeospatialTypedGap10[]
): SACSGeospatialTypedGap10[] {
  const normalizedKinds = new Set(normalized.map(({ gapKind }) => gapKind));
  return [...normalized, ...decoded.filter(({ gapKind }) => !normalizedKinds.has(gapKind))];
}

function assertEnvelopeReferences(
  binding: SourceEnvelopeBinding,
  findings: readonly SacsWorldFinding[],
  gaps: readonly SACSGeospatialTypedGap10[]
): void {
  const sourceIds = new Set(binding.sourceProductIds);
  const evidenceIds = new Set(binding.evidenceItemIds);
  const findingIds = new Set(findings.map(({ findingId }) => findingId));
  for (const finding of findings) {
    if (finding.sourceProductIds.some((id) => !sourceIds.has(id))) fail("FINDING_ENVELOPE_SOURCE_FK_MISSING");
    if (finding.evidenceItemIds.some((id) => !evidenceIds.has(id))) fail("FINDING_ENVELOPE_EVIDENCE_FK_MISSING");
  }
  for (const gap of gaps) {
    if ((gap.findingIds ?? []).some((id) => !findingIds.has(id))) fail("GAP_ENVELOPE_FINDING_FK_MISSING");
    if ((gap.evidenceItemIds ?? []).some((id) => !evidenceIds.has(id))) fail("GAP_ENVELOPE_EVIDENCE_FK_MISSING");
  }
}

function assertNoOpaqueRuntimeLeak(
  profile: Profile,
  projection: NormalizedSourceProductProjection
): void {
  const forbidden = new Set<string>();
  for (const binding of projection.envelopeBindings) {
    forbidden.add(binding.envelopeHash);
    forbidden.add(binding.authorizationBindingHash);
    forbidden.add(binding.provenanceHash);
    binding.receiptIds.forEach((id) => forbidden.add(id));
    binding.evidenceReferences.forEach(({ evidenceId }) => forbidden.add(evidenceId));
  }
  const visit = (candidate: unknown): void => {
    if (typeof candidate === "string") {
      if (forbidden.has(candidate)) fail("OPAQUE_RUNTIME_VALUE_LEAK");
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (candidate === null || typeof candidate !== "object") return;
    Object.values(candidate as Record<string, unknown>).forEach(visit);
  };
  visit(profile);
}

function upstreamEvidenceStatus(status: SourceEnvelopeBinding["status"]): GroundingEvidenceItem["upstreamStatus"] {
  return status === "FAILED" ? "INDETERMINATE" : status;
}

function evidenceUnknowns(status: SourceEnvelopeBinding["status"]): string[] {
  switch (status) {
    case "FAILED":
      return ["UPSTREAM_FAILURE"];
    case "INDETERMINATE":
      return ["INDETERMINATE"];
    case "NO_DATA":
      return ["NO_DATA"];
    case "PARTIAL":
      return ["PARTIAL_RESULT"];
    case "COMPLETED":
      return [];
  }
}

function materializeEvidenceItems(
  projection: NormalizedSourceProductProjection,
  matches: ReadonlyMap<
    string,
    { result: ValidatedGowmFindingResult; binding: SourceEnvelopeBinding }
  >
): GroundingEvidenceItem[] {
  const byId = new Map<string, GroundingEvidenceItem>();
  for (const binding of projection.envelopeBindings) {
    const local = binding.localEvidenceItem;
    if (local === undefined) {
      if (binding.evidenceItemIds.length !== 0) fail("LOCAL_EVIDENCE_BINDING_MISSING");
      continue;
    }
    if (binding.evidenceItemIds.length !== 1
      || binding.evidenceItemIds[0] !== local.evidenceItemId) {
      fail("LOCAL_EVIDENCE_BINDING_MISMATCH");
    }
    const matched = matches.get(binding.envelopeHash);
    if (matched === undefined) fail("LOCAL_EVIDENCE_RESULT_MISSING");
    const operation = readValidatedGowmFindingResult(matched.result).operation;
    const item: GroundingEvidenceItem = {
      evidenceProductId: local.evidenceItemId,
      productKind: "CAPABILITY_RESULT",
      authority: "GOWM_WORLD_CAPABILITY_GATEWAY",
      sourceOperation: `${binding.operationId}@${binding.operationVersion}`,
      upstreamStatus: upstreamEvidenceStatus(binding.status),
      payloadSchemaUri: operation.outputSchemaUri,
      payloadSchemaHash: operation.outputSchemaHash,
      ...(binding.dataSnapshot === undefined ? {} : { dataSnapshot: binding.dataSnapshot }),
      computeSnapshot: binding.computeSnapshot,
      receiptIds: [...local.receiptIds],
      evidenceIds: [...local.upstreamEvidenceIds],
      unknowns: evidenceUnknowns(binding.status),
      warnings: []
    };
    const prior = byId.get(item.evidenceProductId);
    if (prior !== undefined && canonicalSha256(prior) !== canonicalSha256(item)) {
      fail("EVIDENCE_ITEM_ID_COLLISION");
    }
    byId.set(item.evidenceProductId, prior ?? item);
  }
  return [...byId.values()].sort((left, right) =>
    compareCodePoints(left.evidenceProductId, right.evidenceProductId)
  );
}

function assertEvidenceItems(items: readonly GroundingEvidenceItem[]): void {
  if (items.length > 128) fail("EVIDENCE_ITEM_SET_LIMIT_EXCEEDED");
  const ids = items.map(({ evidenceProductId }) => evidenceProductId);
  assertIdentifiers(ids, "EVIDENCE_ITEM_ID_INVALID");
  if (!sorted(ids)) fail("EVIDENCE_ITEM_ORDER_NON_CANONICAL");
  if (new Set(ids).size !== ids.length) fail("EVIDENCE_ITEM_ID_DUPLICATE");
  for (const item of items) {
    const keys = Object.keys(item).sort(compareCodePoints);
    const allowed = [
      "authority", "computeSnapshot", "dataSnapshot", "evidenceIds", "evidenceProductId",
      "payloadSchemaHash", "payloadSchemaUri", "productKind", "receiptIds",
      "sourceOperation", "unknowns", "upstreamStatus", "warnings"
    ].sort(compareCodePoints);
    if (canonicalSha256(keys) !== canonicalSha256(allowed)) fail("EVIDENCE_ITEM_FIELD_FORBIDDEN");
    if (item.authority !== "GOWM_WORLD_CAPABILITY_GATEWAY"
      || item.productKind !== "CAPABILITY_RESULT") {
      fail("EVIDENCE_ITEM_LOCK_MISMATCH");
    }
    assertIdentifiers(item.receiptIds, "EVIDENCE_RECEIPT_ID_INVALID");
    assertIdentifiers(item.evidenceIds, "UPSTREAM_EVIDENCE_ID_INVALID");
    if (!sorted(item.receiptIds) || !sorted(item.evidenceIds)
      || new Set(item.receiptIds).size !== item.receiptIds.length
      || new Set(item.evidenceIds).size !== item.evidenceIds.length) {
      fail("EVIDENCE_REFERENCE_ORDER_INVALID");
    }
  }
}

/**
 * Assemble the public profile from opaque validated runtime tokens. Non-result
 * statuses are normalized by N03 before the N02 decoder registry is invoked.
 */
export function assembleGeospatialFindingsResult(
  input: AssembleGeospatialFindingsInput
): GeospatialFindingsAssembly {
  if (input === null || typeof input !== "object") fail("INVALID_ASSEMBLY_INPUT");
  if (Object.keys(input).some((key) => key !== "sourceBinding" && key !== "validatedResults")) {
    fail("UNKNOWN_ASSEMBLY_FIELD");
  }
  const sourceProjection = readNormalizedSourceProductBinding(input.sourceBinding);
  if (sourceProjection.sourceProducts.length > 64) fail("SOURCE_PRODUCT_LIMIT_EXCEEDED");
  const matches = bindingByHash(sourceProjection, input.validatedResults);
  const decodable: DecodableEnvelope[] = [];
  const gaps: SACSGeospatialTypedGap10[] = [];

  for (const { result, binding } of matches.values()) {
    const validated = readValidatedGowmFindingResult(result);
    const preDecoded = normalizeGeospatialGaps({
      sourceBinding: input.sourceBinding,
      validatedResult: result,
      findingIds: []
    });
    assertEnvelopeReferences(binding, [], preDecoded.gaps);
    if (binding.qualification.status === "REJECTED") {
      if (binding.sourceProductIds.length !== 0
        || binding.evidenceItemIds.length !== 0
        || binding.localEvidenceItem !== undefined) {
        fail("REJECTED_BINDING_FACTS_FORBIDDEN");
      }
      if (preDecoded.status !== "INDETERMINATE"
        || preDecoded.gaps.length < 1
        || preDecoded.gaps.some(({ severity }) => severity !== "BLOCKING")) {
        fail("REJECTED_BINDING_GAP_REQUIRED");
      }
      gaps.push(...preDecoded.gaps);
      continue;
    }
    if (preDecoded.status === "NO_DATA" || preDecoded.status === "INDETERMINATE") {
      gaps.push(...preDecoded.gaps);
      continue;
    }
    if (preDecoded.status === "PARTIAL"
      && binding.sourceProductIds.length === 0
      && preDecoded.gaps.length > 0) {
      gaps.push(...preDecoded.gaps);
      continue;
    }
    if (validated.envelope.status !== "COMPLETED" && validated.envelope.status !== "PARTIAL") {
      fail("RESULT_STATUS_NORMALIZATION_CONTRADICTION");
    }
    if (binding.sourceProductIds.length > 0 && binding.evidenceItemIds.length > 0) {
      decodable.push({
        input: createFindingDecoderInput({ validatedResult: result, sourceBinding: input.sourceBinding }),
        result,
        binding
      });
      continue;
    }
    fail(binding.evidenceItemIds.length === 0 ? "RESULT_EVIDENCE_REQUIRED" : "RESULT_SOURCE_PRODUCT_REQUIRED");
  }

  const registry = new FindingDecoderRegistry(standardDecoderRegistrations(registrationsFor(decodable)));
  const findings: SacsWorldFinding[] = [];
  for (const item of decodable) {
    const decoded = registry.decode(item.input);
    const normalized = normalizeGeospatialGaps({
      sourceBinding: input.sourceBinding,
      validatedResult: item.result,
      findingIds: decoded.findings.map(({ findingId }) => findingId)
    });
    const envelopeGaps = mergeEnvelopeGaps(normalized.gaps, decoded.gaps);
    assertEnvelopeReferences(item.binding, decoded.findings, envelopeGaps);
    findings.push(...decoded.findings);
    gaps.push(...envelopeGaps);
  }

  const canonicalFindings = uniqueByIdentity(findings, "FINDING_ID_COLLISION");
  const canonicalSourceProducts = uniqueByIdentity(sourceProjection.sourceProducts, "SOURCE_PRODUCT_ID_COLLISION");
  const canonicalGaps = uniqueByIdentity(gaps, "GAP_ID_COLLISION");
  const qualifiedSourceIds = new Set(sourceProjection.envelopeBindings
    .filter(({ qualification }) => qualification.status === "QUALIFIED")
    .flatMap(({ sourceProductIds }) => sourceProductIds));
  const materializedSourceIds = new Set(
    canonicalSourceProducts.map(({ sourceProductId }) => sourceProductId)
  );
  if (canonicalSourceProducts.some(({ sourceProductId }) => !qualifiedSourceIds.has(sourceProductId))
    || [...qualifiedSourceIds].some((sourceProductId) => !materializedSourceIds.has(sourceProductId))) {
    fail("SOURCE_PRODUCT_QUALIFIED_BINDING_MISSING");
  }
  if (canonicalFindings.length > 128) fail("FINDING_SET_LIMIT_EXCEEDED");
  if (canonicalGaps.length > 128) fail("GAP_SET_LIMIT_EXCEEDED");
  const findingSetHash = canonicalSha256(canonicalFindings);
  const sourceProductSetHash = canonicalSha256(canonicalSourceProducts);
  if (sourceProductSetHash !== sourceProjection.sourceProductSetHash) fail("SOURCE_PRODUCT_SET_HASH_MISMATCH");
  const profile: Profile = {
    profile: SACS_GEOSPATIAL_FINDINGS_PROFILE,
    profileSchemaHash: SACS_GEOSPATIAL_FINDINGS_SCHEMA_HASH,
    findings: canonicalFindings,
    sourceProducts: canonicalSourceProducts,
    gaps: canonicalGaps,
    findingSetHash,
    sourceProductSetHash
  };
  const evidenceItems = materializeEvidenceItems(sourceProjection, matches);
  assertEvidenceItems(evidenceItems);
  const evidenceItemIds = evidenceItems.map(({ evidenceProductId }) => evidenceProductId);
  const boundEvidenceItemIds = [...new Set(
    sourceProjection.envelopeBindings.flatMap((binding) => binding.evidenceItemIds)
  )].sort(compareCodePoints);
  if (canonicalSha256(evidenceItemIds) !== canonicalSha256(boundEvidenceItemIds)) {
    fail("EVIDENCE_BINDING_SET_MISMATCH");
  }
  assertGeospatialFindingsProfileIntegrity(profile, evidenceItemIds);
  assertNoOpaqueRuntimeLeak(profile, sourceProjection);
  const evidenceItemSetHash = canonicalSha256(evidenceItems);
  return freeze({
    geospatialFindings: profile,
    evidenceItems,
    evidenceItemSetHash,
    assemblyHash: canonicalSha256({ profile, evidenceItems })
  });
}

/** Convenience view for callers which already merge the returned evidence set. */
export function assembleGeospatialFindingsProfile(
  input: AssembleGeospatialFindingsInput
): Profile {
  return assembleGeospatialFindingsResult(input).geospatialFindings;
}
