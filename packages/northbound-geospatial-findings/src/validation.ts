import { canonicalSha256, compareCodePoints } from "./canonical.js";
import {
  readValidatedGowmFindingResult,
  type ValidatedGowmFindingResult
} from "@wsgs/gowm-execution-evidence";
import {
  FINDING_DECODER_PATTERNS,
  TRUSTED_PROVENANCE_BINDING_MARKER,
  type FindingDecoderInput,
  type FindingDecoderInputSource,
  type FindingDescriptorContext,
  type Sha256Digest
} from "./types.js";

export type JsonObject = Record<string, unknown>;
export type Position = [number, number];
export type GeoJsonGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

export class FindingDecoderError extends Error {
  constructor(readonly code: string) {
    super(`Geospatial finding decoding failed: ${code}`);
    this.name = "FindingDecoderError";
  }
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const operationIdPattern = /^[a-z][a-z0-9.-]{2,127}$/u;
const operationVersionPattern = /^[0-9]+\.[0-9]+$/u;
const referenceIdPattern = /^wrf_[0-9a-f]{32}$/u;
const opaquePayloadReferencePattern = /^urn:(?:gowm|wsgs):[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{1,1000}$/u;

export function object(value: unknown, code: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new FindingDecoderError(code);
  }
  return value as JsonObject;
}

export function text(value: unknown, code: string, maximum = 2048): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new FindingDecoderError(code);
  }
  return value;
}

export function optionalText(value: unknown, code: string, maximum: number): string | undefined {
  return value === undefined ? undefined : text(value, code, maximum);
}

export function finiteNumber(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new FindingDecoderError(code);
  return Object.is(value, -0) ? 0 : value;
}

export function nonNegativeNumber(value: unknown, code: string): number {
  const parsed = finiteNumber(value, code);
  if (parsed < 0) throw new FindingDecoderError(code);
  return parsed;
}

export function confidence(value: unknown, code: string): number {
  const parsed = finiteNumber(value, code);
  if (parsed < 0 || parsed > 1) throw new FindingDecoderError(code);
  return parsed;
}

export function integer(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new FindingDecoderError(code);
  return value as number;
}

export function boolean(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") throw new FindingDecoderError(code);
  return value;
}

export function digest(value: unknown, code: string): Sha256Digest {
  if (typeof value !== "string" || !digestPattern.test(value)) throw new FindingDecoderError(code);
  return value as Sha256Digest;
}

export function identifier(value: unknown, code: string): string {
  const parsed = text(value, code, 256);
  if (!identifierPattern.test(parsed)) throw new FindingDecoderError(code);
  return parsed;
}

export function stringCodes(value: unknown, code: string, maximum: number, itemMaximum = 128): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new FindingDecoderError(code);
  const values = value.map((item) => text(item, code, itemMaximum));
  return [...new Set(values)].sort(compareCodePoints);
}

export function identifierArray(value: readonly string[], code: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw new FindingDecoderError(code);
  }
  const normalized = value.map((item) => identifier(item, code));
  if (new Set(normalized).size !== normalized.length) throw new FindingDecoderError(code);
  return normalized.sort(compareCodePoints);
}

export function assertOnlyKeys(value: JsonObject, allowed: readonly string[], code: string): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) throw new FindingDecoderError(code);
}

function position(value: unknown): Position {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new FindingDecoderError("INVALID_GEOMETRY_POSITION");
  }
  const coordinates = value.map((item) => finiteNumber(item, "INVALID_GEOMETRY_POSITION"));
  const longitude = coordinates[0];
  const latitude = coordinates[1];
  if (longitude === undefined || latitude === undefined
    || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new FindingDecoderError("INVALID_GEOMETRY_POSITION");
  }
  return [longitude, latitude];
}

function positions(value: unknown, minimum: number, maximum: number): Position[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new FindingDecoderError("INVALID_GEOMETRY_COORDINATES");
  }
  return value.map(position);
}

function samePosition(left: Position, right: Position): boolean {
  return left.every((item, index) => item === right[index]);
}

function linearRing(value: unknown): Position[] {
  const ring = positions(value, 4, 10_000);
  if (!samePosition(ring[0]!, ring.at(-1)!)) throw new FindingDecoderError("UNCLOSED_POLYGON_RING");
  return ring;
}

function polygon(value: unknown): Position[][] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) {
    throw new FindingDecoderError("INVALID_POLYGON_COORDINATES");
  }
  return value.map(linearRing);
}

export function geometry(value: unknown): GeoJsonGeometry {
  const candidate = object(value, "INVALID_GEOMETRY");
  assertOnlyKeys(candidate, ["type", "coordinates"], "UNKNOWN_GEOMETRY_FIELD");
  const type = text(candidate["type"], "INVALID_GEOMETRY_TYPE", 32);
  switch (type) {
    case "Point":
      return { type, coordinates: position(candidate["coordinates"]) };
    case "LineString":
      return { type, coordinates: positions(candidate["coordinates"], 2, 10_000) };
    case "Polygon":
      return { type, coordinates: polygon(candidate["coordinates"]) };
    case "MultiPolygon": {
      const polygons = candidate["coordinates"];
      if (!Array.isArray(polygons) || polygons.length < 1 || polygons.length > 256) {
        throw new FindingDecoderError("INVALID_MULTIPOLYGON_COORDINATES");
      }
      return { type, coordinates: polygons.map(polygon) };
    }
    default:
      throw new FindingDecoderError("INVALID_GEOMETRY_TYPE");
  }
}

export function point(value: unknown): Extract<GeoJsonGeometry, { type: "Point" }> {
  const parsed = geometry(value);
  if (parsed.type !== "Point") throw new FindingDecoderError("POINT_GEOMETRY_REQUIRED");
  return parsed;
}

export function opaquePayloadReference(value: unknown): string {
  const parsed = text(value, "INVALID_PAYLOAD_REFERENCE", 1024);
  if (!opaquePayloadReferencePattern.test(parsed)) throw new FindingDecoderError("UNSAFE_PAYLOAD_REFERENCE");
  return parsed;
}

export function referenceKey(value: unknown): {
  namespace: "gowm";
  kind: string;
  id: string;
  version: string;
} {
  const candidate = object(value, "INVALID_REFERENCE_KEY");
  assertOnlyKeys(candidate, ["namespace", "kind", "id", "version"], "UNKNOWN_REFERENCE_KEY_FIELD");
  const id = text(candidate["id"], "INVALID_REFERENCE_KEY", 64);
  if (candidate["namespace"] !== "gowm" || !referenceIdPattern.test(id)) {
    throw new FindingDecoderError("INVALID_REFERENCE_KEY");
  }
  return {
    namespace: "gowm",
    kind: text(candidate["kind"], "INVALID_REFERENCE_KEY", 64),
    id,
    version: text(candidate["version"], "INVALID_REFERENCE_KEY", 128)
  };
}

export interface ValidatedDecoderInput {
  readonly evidenceItemIds: readonly string[];
  readonly sourceProductIds: readonly string[];
  readonly subjectReferenceProductIds?: readonly string[];
}

interface DecoderInputState {
  readonly validatedResult: ValidatedGowmFindingResult;
  readonly envelopeHash: Sha256Digest;
}

const decoderInputs = new WeakMap<object, DecoderInputState>();

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createFindingDecoderInput(source: FindingDecoderInputSource): FindingDecoderInput {
  const validated = readValidatedGowmFindingResult(source.validatedResult);
  const operation = validated.operation;
  const descriptor: FindingDescriptorContext = {
    authorityKind: operation.authorityKind,
    closureHash: operation.closureHash,
    semanticConcept: operation.semanticConcept,
    querySemantics: operation.querySemantics,
    queryProfile: operation.queryProfile,
    decoderPattern: operation.decoderPattern,
    capabilitySemanticProfile: operation.semanticProfile,
    semanticProfileHash: operation.semanticProfileHash,
    ...(operation.descriptor === undefined ? {} : {
      descriptorId: operation.descriptor.descriptorId,
      descriptorHash: operation.descriptor.descriptorHash,
      descriptorRegistryHash: operation.descriptor.registryHash,
      vocabularyRegistryHash: operation.descriptor.vocabularyRegistryHash,
      productType: operation.descriptor.productType,
      productProfile: operation.descriptor.productProfile,
      ...(operation.descriptor.valueSemanticsKind === "FEATURE"
        ? {}
        : { valueSemanticsKind: operation.descriptor.valueSemanticsKind }),
      ...(operation.descriptor.unit === null ? {} : { unit: operation.descriptor.unit }),
      ...(operation.descriptor.allowedClassCodes === undefined
        ? {}
        : { allowedClassCodes: operation.descriptor.allowedClassCodes })
    })
  };
  const input = freeze({
    envelope: validated.envelope,
    descriptor: freeze(descriptor),
    trustedProvenance: freeze(structuredClone(source.trustedProvenance))
  });
  decoderInputs.set(input, {
    validatedResult: source.validatedResult,
    envelopeHash: validated.envelopeHash
  });
  return input;
}

export function validateDecoderInput(input: FindingDecoderInput): ValidatedDecoderInput {
  if (Object.prototype.hasOwnProperty.call(input, "safePayload")) {
    throw new FindingDecoderError("SAFE_PAYLOAD_INPUT_FORBIDDEN");
  }
  const state = input !== null && typeof input === "object" ? decoderInputs.get(input) : undefined;
  if (state === undefined) throw new FindingDecoderError("UNVALIDATED_RESULT_ENVELOPE");
  const validated = readValidatedGowmFindingResult(state.validatedResult);
  if (validated.envelope !== input.envelope
    || validated.envelopeHash !== state.envelopeHash
    || canonicalSha256(input.envelope) !== state.envelopeHash) {
    throw new FindingDecoderError("VALIDATED_ENVELOPE_MUTATED");
  }
  if (input.trustedProvenance.marker !== TRUSTED_PROVENANCE_BINDING_MARKER) {
    throw new FindingDecoderError("UNTRUSTED_PROVENANCE_BINDING");
  }
  const operationId = text(input.envelope.operation.operationId, "INVALID_OPERATION_ID", 128);
  const operationVersion = text(input.envelope.operation.operationVersion, "INVALID_OPERATION_VERSION", 32);
  if (!operationIdPattern.test(operationId) || !operationVersionPattern.test(operationVersion)) {
    throw new FindingDecoderError("INVALID_OPERATION_IDENTITY");
  }
  const lock = validated.operation;
  if (lock.operationId !== operationId || lock.operationVersion !== operationVersion) {
    throw new FindingDecoderError("OPERATION_LOCK_MISMATCH");
  }
  if (input.descriptor.semanticProfileHash !== lock.semanticProfileHash
    || canonicalSha256(input.descriptor.capabilitySemanticProfile) !== input.descriptor.semanticProfileHash) {
    throw new FindingDecoderError("SEMANTIC_PROFILE_LOCK_MISMATCH");
  }
  if (!FINDING_DECODER_PATTERNS.includes(input.descriptor.queryProfile)) {
    throw new FindingDecoderError("UNKNOWN_QUERY_PROFILE");
  }
  if ((input.descriptor.queryProfile === "SAMPLE_VALUE"
      && input.descriptor.valueSemanticsKind !== "NUMBER")
    || (input.descriptor.queryProfile === "SAMPLE_CLASS"
      && input.descriptor.valueSemanticsKind !== "CLASS_CODE")) {
    throw new FindingDecoderError("SAMPLE_VALUE_SEMANTICS_LOCK_REQUIRED");
  }
  text(input.descriptor.semanticConcept, "INVALID_SEMANTIC_CONCEPT", 128);
  text(input.descriptor.querySemantics, "INVALID_QUERY_SEMANTICS", 128);
  if (input.descriptor.authorityKind === "DESCRIPTOR") {
    text(input.descriptor.descriptorId, "INVALID_DESCRIPTOR_ID", 256);
    digest(input.descriptor.descriptorHash, "INVALID_DESCRIPTOR_HASH");
    digest(input.descriptor.descriptorRegistryHash, "INVALID_DESCRIPTOR_REGISTRY_HASH");
    digest(input.descriptor.vocabularyRegistryHash, "INVALID_VOCABULARY_REGISTRY_HASH");
    text(input.descriptor.productType, "INVALID_PRODUCT_TYPE", 128);
    text(input.descriptor.productProfile, "INVALID_PRODUCT_PROFILE", 128);
  } else if (input.descriptor.descriptorId !== undefined
    || input.descriptor.descriptorHash !== undefined
    || input.descriptor.productType !== undefined
    || input.descriptor.productProfile !== undefined) {
    throw new FindingDecoderError("CATALOG_DESCRIPTOR_FORBIDDEN");
  }
  if (input.descriptor.unit !== undefined) text(input.descriptor.unit, "INVALID_DESCRIPTOR_UNIT", 64);
  if (input.descriptor.allowedClassCodes !== undefined) {
    const codes = stringCodes(input.descriptor.allowedClassCodes, "INVALID_CLASS_VOCABULARY", 1024, 128);
    if (codes.length !== input.descriptor.allowedClassCodes.length || codes.length < 1) {
      throw new FindingDecoderError("INVALID_CLASS_VOCABULARY");
    }
  }
  const output = input.envelope.output;
  if (input.envelope.status === "COMPLETED" || input.envelope.status === "PARTIAL") {
    if (output === undefined) throw new FindingDecoderError("RESULT_OUTPUT_REQUIRED");
  }
  if (output !== undefined
    && (output.schemaUri !== lock.outputSchemaUri || output.schemaHash !== lock.outputSchemaHash)) {
    throw new FindingDecoderError("OUTPUT_SCHEMA_LOCK_MISMATCH");
  }
  const evidenceItemIds = identifierArray(
    input.trustedProvenance.evidenceItemIds,
    "INVALID_EVIDENCE_BINDING",
    256
  );
  const sourceProductIds = identifierArray(
    input.trustedProvenance.sourceProductIds,
    "INVALID_SOURCE_PRODUCT_BINDING",
    64
  );
  const subjectReferenceProductIds = input.trustedProvenance.subjectReferenceProductIds === undefined
    ? undefined
    : identifierArray(
        input.trustedProvenance.subjectReferenceProductIds,
        "INVALID_SUBJECT_REFERENCE_BINDING",
        32
      );
  return {
    evidenceItemIds,
    sourceProductIds,
    ...(subjectReferenceProductIds === undefined ? {} : { subjectReferenceProductIds })
  };
}
