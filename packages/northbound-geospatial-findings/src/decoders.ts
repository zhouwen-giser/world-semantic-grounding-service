import type {
  SacsWorldFinding,
  SACSGeospatialTypedGap10
} from "@wsgs/contracts";

import { canonicalJson, compareCodePoints, deterministicId } from "./canonical.js";
import type {
  FindingDecoderContext,
  FindingDecoderPattern
} from "./types.js";
import {
  FindingDecoderError,
  assertOnlyKeys,
  boolean,
  confidence,
  digest,
  finiteNumber,
  geometry,
  identifier,
  nonNegativeNumber,
  object,
  optionalText,
  point,
  text,
  type GeoJsonGeometry,
  type JsonObject
} from "./validation.js";

type CommonFindingFields = {
  findingId: string;
  semanticConcept: string;
  querySemantics: string;
  status: "COMPLETED" | "PARTIAL";
  subjectReferenceProductIds?: string[];
  evidenceItemIds: string[];
  sourceProductIds: string[];
  confidence?: number;
};

type ProjectedFeature = {
  featureId: string;
  displayName?: string;
  geometry: GeoJsonGeometry;
  classCode?: string;
  classLabel?: string;
  areaM2?: number;
  lengthM?: number;
  distanceM?: number;
  confidence?: number;
  publishedAttributes?: {
    objectClass?: string;
    objectType?: string;
    categoryCode?: string;
    categoryLabel?: string;
    operationalStatus?: string;
  };
};

const rasterSampleKeys = [
  "schemaVersion",
  "productId",
  "contentHash",
  "point",
  "value",
  "classCode",
  "confidence",
  "noData",
  "explanation"
] as const;

const genericResultVersion: Readonly<Partial<Record<FindingDecoderPattern, string>>> = {
  SAMPLE_VALUE: "gdps-geo-raster-sample-result/1.0",
  SAMPLE_CLASS: "gdps-geo-raster-sample-result/1.0",
  PROFILE_VALUE: "gdps-geo-raster-profile-result/1.0",
  FIND_CLASS: "gdps-geo-raster-find-by-class-result/1.0",
  FIND_VALUE_RANGE: "gdps-geo-raster-find-by-range-result/1.0",
  VECTOR_IN_AREA: "gdps-geo-vector-find-in-area-result/1.0",
  VECTOR_NEARBY: "gdps-geo-vector-find-nearby-result/1.0",
  VECTOR_INTERSECTS: "gdps-geo-vector-find-intersections-result/1.0"
};

function hasOwn(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireKeys(value: JsonObject, keys: readonly string[], code: string): void {
  if (keys.some((key) => !hasOwn(value, key))) throw new FindingDecoderError(code);
}

function commonFields(context: FindingDecoderContext, payload: JsonObject): CommonFindingFields {
  const provenance = context.input.trustedProvenance;
  const upstreamConfidence = payload["confidence"] === undefined
    ? undefined
    : confidence(payload["confidence"], "INVALID_FINDING_CONFIDENCE");
  const subjectReferenceProductIds = provenance.subjectReferenceProductIds === undefined
    ? undefined
    : [...provenance.subjectReferenceProductIds].sort(compareCodePoints);
  return {
    findingId: context.findingId,
    semanticConcept: context.input.descriptor.semanticConcept,
    querySemantics: context.input.descriptor.querySemantics,
    status: context.input.envelope.status as "COMPLETED" | "PARTIAL",
    evidenceItemIds: [...provenance.evidenceItemIds].sort(compareCodePoints),
    sourceProductIds: [...provenance.sourceProductIds].sort(compareCodePoints),
    ...(subjectReferenceProductIds === undefined ? {} : { subjectReferenceProductIds }),
    ...(upstreamConfidence === undefined ? {} : { confidence: upstreamConfidence })
  };
}

function authoritativeUnit(context: FindingDecoderContext, payload: JsonObject): string {
  const descriptorUnit = context.input.descriptor.unit;
  if (descriptorUnit === undefined) throw new FindingDecoderError("DESCRIPTOR_UNIT_REQUIRED");
  void payload;
  return descriptorUnit;
}

function validateGenericNestedUnit(
  context: FindingDecoderContext,
  unwrapped: ReturnType<typeof unwrapGenericResult>,
  payload: JsonObject
): void {
  if (!unwrapped.isGeneric || !hasOwn(payload, "unit")) return;
  const descriptorUnit = context.input.descriptor.unit;
  if (descriptorUnit === undefined
    || text(payload["unit"], "INVALID_GENERIC_RESULT_UNIT", 64) !== descriptorUnit) {
    throw new FindingDecoderError("GENERIC_RESULT_UNIT_MISMATCH");
  }
}

function authoritativeClassCode(context: FindingDecoderContext, value: unknown): string {
  const code = text(value, "INVALID_CLASS_CODE", 128);
  const allowed = context.input.descriptor.allowedClassCodes;
  if (allowed === undefined || allowed.length === 0) {
    throw new FindingDecoderError("CLASS_VOCABULARY_REQUIRED");
  }
  if (!allowed.includes(code)) throw new FindingDecoderError("CLASS_CODE_NOT_IN_LOCKED_VOCABULARY");
  return code;
}

function validateProductBinding(payload: JsonObject): void {
  text(payload["productId"], "INVALID_RESULT_PRODUCT_ID", 256);
  digest(payload["contentHash"], "INVALID_RESULT_CONTENT_HASH");
}

/**
 * Generic operations wrap their shared result. Their outer schema deliberately
 * leaves `result` open, so N02 validates the nested value by the locked query
 * profile before projecting any northbound fields.
 */
function unwrapGenericResult(
  context: FindingDecoderContext,
  payload: JsonObject
): {
  payload: JsonObject;
  isGeneric: boolean;
  outerTruncated?: boolean;
  outerProductId?: string;
  outerContentHash?: string;
} {
  if (!hasOwn(payload, "result")) return { payload, isGeneric: false };
  assertOnlyKeys(payload, [
    "schemaVersion",
    "productId",
    "productType",
    "productProfile",
    "contentHash",
    "descriptorId",
    "descriptorHash",
    "result",
    "truncated"
  ], "UNKNOWN_GENERIC_RESULT_FIELD");
  requireKeys(payload, [
    "schemaVersion",
    "productId",
    "productType",
    "productProfile",
    "contentHash",
    "descriptorId",
    "descriptorHash",
    "result"
  ], "INCOMPLETE_GENERIC_RESULT_BINDING");
  const expectedVersion = genericResultVersion[context.input.descriptor.queryProfile];
  if (expectedVersion === undefined || payload["schemaVersion"] !== expectedVersion) {
    throw new FindingDecoderError("INVALID_GENERIC_RESULT_VERSION");
  }
  validateProductBinding(payload);
  if (text(payload["productType"], "INVALID_GENERIC_PRODUCT_TYPE", 128)
      !== context.input.descriptor.productType
    || text(payload["productProfile"], "INVALID_GENERIC_PRODUCT_PROFILE", 128)
      !== context.input.descriptor.productProfile) {
    throw new FindingDecoderError("GENERIC_DESCRIPTOR_BINDING_MISMATCH");
  }
  if (text(payload["descriptorId"], "INVALID_GENERIC_DESCRIPTOR_ID", 256)
      !== context.input.descriptor.descriptorId
    || digest(payload["descriptorHash"], "INVALID_GENERIC_DESCRIPTOR_HASH")
      !== context.input.descriptor.descriptorHash) {
    throw new FindingDecoderError("GENERIC_DESCRIPTOR_LOCK_MISMATCH");
  }
  const outerTruncated = payload["truncated"] === undefined
    ? undefined
    : boolean(payload["truncated"], "INVALID_OUTER_TRUNCATION_FLAG");
  return {
    payload: object(payload["result"], "INVALID_GENERIC_NESTED_RESULT"),
    isGeneric: true,
    outerProductId: text(payload["productId"], "INVALID_RESULT_PRODUCT_ID", 256),
    outerContentHash: digest(payload["contentHash"], "INVALID_RESULT_CONTENT_HASH"),
    ...(outerTruncated === undefined ? {} : { outerTruncated })
  };
}

function assertNestedProductBinding(
  unwrapped: ReturnType<typeof unwrapGenericResult>,
  payload: JsonObject
): void {
  if (unwrapped.outerProductId !== undefined
    && (payload["productId"] !== unwrapped.outerProductId
      || payload["contentHash"] !== unwrapped.outerContentHash)) {
    throw new FindingDecoderError("GENERIC_NESTED_PRODUCT_BINDING_MISMATCH");
  }
}

function strictRasterSample(
  context: FindingDecoderContext,
  source: JsonObject,
  requireClassCode: boolean,
  unwrapped: ReturnType<typeof unwrapGenericResult>
): { payload: JsonObject; noData: boolean } {
  assertOnlyKeys(
    source,
    unwrapped.isGeneric ? [...rasterSampleKeys, "unit"] : rasterSampleKeys,
    "UNKNOWN_RASTER_SAMPLE_FIELD"
  );
  requireKeys(
    source,
    ["schemaVersion", "productId", "contentHash", "point", "value", "noData"],
    "INCOMPLETE_RASTER_SAMPLE_RESULT"
  );
  if (source["schemaVersion"] !== "gdps-raster-sample-result/1.0") {
    throw new FindingDecoderError("INVALID_RASTER_SAMPLE_VERSION");
  }
  validateProductBinding(source);
  validateGenericNestedUnit(context, unwrapped, source);
  point(source["point"]);
  const noData = boolean(source["noData"], "INVALID_NO_DATA_FLAG");
  if (noData !== (source["value"] === null)) {
    throw new FindingDecoderError("NO_DATA_VALUE_CONTRADICTION");
  }
  if (noData) {
    if (source["classCode"] !== undefined || source["explanation"] !== undefined) {
      throw new FindingDecoderError("NO_DATA_PAYLOAD_CONTRADICTION");
    }
  } else {
    finiteNumber(source["value"], "INVALID_SAMPLE_VALUE");
    if (requireClassCode) authoritativeClassCode(context, source["classCode"]);
  }
  if (source["classCode"] !== undefined) text(source["classCode"], "INVALID_CLASS_CODE", 128);
  if (source["confidence"] !== undefined) confidence(source["confidence"], "INVALID_FINDING_CONFIDENCE");
  return { payload: source, noData };
}

function samplePayload(
  context: FindingDecoderContext,
  requireClassCode: boolean
): { payload: JsonObject; noData: boolean } {
  const outer = object(context.payload, "INVALID_RASTER_SAMPLE_RESULT");
  const unwrapped = unwrapGenericResult(context, outer);
  if (unwrapped.outerTruncated === true) {
    throw new FindingDecoderError("SAMPLE_RESULT_TRUNCATION_FORBIDDEN");
  }
  const decoded = strictRasterSample(context, unwrapped.payload, requireClassCode, unwrapped);
  assertNestedProductBinding(unwrapped, decoded.payload);
  return decoded;
}

function decodePointMeasurement(context: FindingDecoderContext): SacsWorldFinding | undefined {
  const decoded = samplePayload(context, false);
  if (decoded.noData) return undefined;
  const { payload } = decoded;
  return {
    ...commonFields(context, payload),
    findingKind: "POINT_MEASUREMENT",
    point: point(payload["point"]),
    value: finiteNumber(payload["value"], "INVALID_SAMPLE_VALUE"),
    unit: authoritativeUnit(context, payload)
  };
}

function decodePointClassification(context: FindingDecoderContext): SacsWorldFinding | undefined {
  const decoded = samplePayload(context, true);
  if (decoded.noData) return undefined;
  const { payload } = decoded;
  return {
    ...commonFields(context, payload),
    findingKind: "POINT_CLASSIFICATION",
    point: point(payload["point"]),
    classCode: authoritativeClassCode(context, payload["classCode"])
  };
}

function optionalMetric(
  properties: JsonObject,
  primary: string,
  alternate: string,
  code: string
): number | undefined {
  const primaryValue = properties[primary];
  const alternateValue = properties[alternate];
  if (primaryValue !== undefined && alternateValue !== undefined && primaryValue !== alternateValue) {
    throw new FindingDecoderError(`${code}_CONFLICT`);
  }
  const value = primaryValue ?? alternateValue;
  return value === undefined ? undefined : nonNegativeNumber(value, code);
}

function projectedPublishedAttributes(properties: JsonObject): ProjectedFeature["publishedAttributes"] {
  const projected = {
    objectClass: optionalText(properties["objectClass"], "INVALID_PUBLISHED_ATTRIBUTE", 128),
    objectType: optionalText(properties["objectType"], "INVALID_PUBLISHED_ATTRIBUTE", 128),
    categoryCode: optionalText(properties["categoryCode"], "INVALID_PUBLISHED_ATTRIBUTE", 128),
    categoryLabel: optionalText(properties["categoryLabel"], "INVALID_PUBLISHED_ATTRIBUTE", 256),
    operationalStatus: optionalText(properties["operationalStatus"], "INVALID_PUBLISHED_ATTRIBUTE", 128)
  };
  const entries = Object.entries(projected).filter((entry): entry is [string, string] => entry[1] !== undefined);
  return entries.length === 0
    ? undefined
    : Object.fromEntries(entries) as NonNullable<ProjectedFeature["publishedAttributes"]>;
}

const valueRangeKeys = [
  "minimumInclusive",
  "minimumExclusive",
  "maximumInclusive",
  "maximumExclusive"
] as const;

function validateValueRanges(value: unknown): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) {
    throw new FindingDecoderError("INVALID_FEATURE_VALUE_RANGES");
  }
  for (const rawRange of value) {
    const range = object(rawRange, "INVALID_FEATURE_VALUE_RANGE");
    assertOnlyKeys(range, valueRangeKeys, "UNKNOWN_FEATURE_VALUE_RANGE_FIELD");
    const lower = valueRangeKeys.filter((key) => key.startsWith("minimum") && hasOwn(range, key));
    const upper = valueRangeKeys.filter((key) => key.startsWith("maximum") && hasOwn(range, key));
    if (lower.length > 1 || upper.length > 1 || (lower.length === 0 && upper.length === 0)) {
      throw new FindingDecoderError("AMBIGUOUS_FEATURE_VALUE_RANGE");
    }
    for (const key of [...lower, ...upper]) {
      finiteNumber(range[key], "INVALID_FEATURE_VALUE_RANGE_ENDPOINT");
    }
    if (lower[0] !== undefined && upper[0] !== undefined
      && (range[lower[0]] as number) > (range[upper[0]] as number)) {
      throw new FindingDecoderError("FEATURE_VALUE_RANGE_REVERSED");
    }
  }
}

function validateFeatureProperties(context: FindingDecoderContext, properties: JsonObject): void {
  if (Object.keys(properties).length > 64) {
    throw new FindingDecoderError("INVALID_RESULT_FEATURE_PROPERTIES");
  }
  for (const [key, value] of Object.entries(properties)) {
    if (key === "ranges" && context.input.descriptor.queryProfile === "FIND_VALUE_RANGE") {
      validateValueRanges(value);
      continue;
    }
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      throw new FindingDecoderError("INVALID_RESULT_FEATURE_PROPERTIES");
    }
    if (typeof value === "number") finiteNumber(value, "INVALID_RESULT_FEATURE_PROPERTY_NUMBER");
  }
  if (context.input.descriptor.queryProfile === "FIND_VALUE_RANGE" && !hasOwn(properties, "ranges")) {
    throw new FindingDecoderError("FEATURE_VALUE_RANGES_REQUIRED");
  }
}

function projectedFeature(
  context: FindingDecoderContext,
  value: unknown
): { identity: unknown; projected: Omit<ProjectedFeature, "featureId"> } {
  const feature = object(value, "INVALID_SPATIAL_FEATURE");
  assertOnlyKeys(feature, ["type", "id", "geometry", "properties"], "UNKNOWN_RESULT_FEATURE_FIELD");
  requireKeys(feature, ["type", "geometry", "properties"], "INCOMPLETE_RESULT_FEATURE");
  if (feature["type"] !== "Feature") throw new FindingDecoderError("INVALID_RESULT_FEATURE_TYPE");
  const parsedGeometry = geometry(feature["geometry"]);
  const properties = object(feature["properties"], "INVALID_RESULT_FEATURE_PROPERTIES");
  validateFeatureProperties(context, properties);
  const rawClassCode = properties["classCode"];
  if (context.input.descriptor.queryProfile === "FIND_CLASS" && rawClassCode === undefined) {
    throw new FindingDecoderError("FEATURE_CLASS_CODE_REQUIRED");
  }
  const classCode = rawClassCode === undefined
    ? undefined
    : context.input.descriptor.queryProfile === "FIND_CLASS"
      ? authoritativeClassCode(context, rawClassCode)
      : text(rawClassCode, "INVALID_FEATURE_CLASS_CODE", 128);
  const displayName = optionalText(
    properties["displayName"] ?? properties["name"],
    "INVALID_FEATURE_DISPLAY_NAME",
    512
  );
  const classLabel = optionalText(properties["classLabel"], "INVALID_FEATURE_CLASS_LABEL", 256);
  const areaM2 = optionalMetric(properties, "areaM2", "areaSquareMetres", "INVALID_FEATURE_AREA");
  const lengthM = optionalMetric(properties, "lengthM", "lengthMetres", "INVALID_FEATURE_LENGTH");
  const distanceM = optionalMetric(properties, "distanceM", "distanceMetres", "INVALID_FEATURE_DISTANCE");
  const featureConfidence = properties["confidence"] === undefined
    ? undefined
    : confidence(properties["confidence"], "INVALID_FEATURE_CONFIDENCE");
  const publishedAttributes = projectedPublishedAttributes(properties);
  const projected = {
    geometry: parsedGeometry,
    ...(displayName === undefined ? {} : { displayName }),
    ...(classCode === undefined ? {} : { classCode }),
    ...(classLabel === undefined ? {} : { classLabel }),
    ...(areaM2 === undefined ? {} : { areaM2 }),
    ...(lengthM === undefined ? {} : { lengthM }),
    ...(distanceM === undefined ? {} : { distanceM }),
    ...(featureConfidence === undefined ? {} : { confidence: featureConfidence }),
    ...(publishedAttributes === undefined ? {} : { publishedAttributes })
  };
  const sourceId = feature["id"] === undefined
    ? undefined
    : text(feature["id"], "INVALID_RESULT_FEATURE_ID", 256);
  return {
    identity: { sourceId, projected },
    projected
  };
}

function stableFeatures(context: FindingDecoderContext, values: readonly unknown[]): ProjectedFeature[] {
  const seeds = values.map((value) => projectedFeature(context, value))
    .sort((left, right) => compareCodePoints(canonicalJson(left.identity), canonicalJson(right.identity)));
  const occurrences = new Map<string, number>();
  return seeds.map(({ identity, projected }) => {
    const canonical = canonicalJson(identity);
    const occurrence = occurrences.get(canonical) ?? 0;
    occurrences.set(canonical, occurrence + 1);
    return {
      featureId: deterministicId("feature", {
        findingId: context.findingId,
        identity,
        occurrence
      }),
      ...projected
    };
  });
}

function strictFeatureCollection(
  context: FindingDecoderContext
): { payload: JsonObject; features: ProjectedFeature[]; truncated: boolean } {
  const outer = object(context.payload, "INVALID_FEATURE_COLLECTION_RESULT");
  const unwrapped = unwrapGenericResult(context, outer);
  const payload = unwrapped.payload;
  assertOnlyKeys(
    payload,
    unwrapped.isGeneric && context.input.descriptor.queryProfile === "FIND_VALUE_RANGE"
      ? ["schemaVersion", "productId", "contentHash", "type", "features", "truncated", "unit"]
      : ["schemaVersion", "productId", "contentHash", "type", "features", "truncated"],
    "UNKNOWN_FEATURE_COLLECTION_FIELD"
  );
  requireKeys(
    payload,
    ["schemaVersion", "productId", "contentHash", "type", "features", "truncated"],
    "INCOMPLETE_FEATURE_COLLECTION_RESULT"
  );
  if (payload["schemaVersion"] !== "gdps-feature-collection-result/1.0"
    || payload["type"] !== "FeatureCollection") {
    throw new FindingDecoderError("INVALID_FEATURE_COLLECTION_VERSION");
  }
  validateProductBinding(payload);
  validateGenericNestedUnit(context, unwrapped, payload);
  assertNestedProductBinding(unwrapped, payload);
  const raw = payload["features"];
  if (!Array.isArray(raw) || raw.length > 1000) throw new FindingDecoderError("INVALID_FEATURE_COLLECTION");
  const nestedTruncated = boolean(payload["truncated"], "INVALID_TRUNCATION_FLAG");
  if (unwrapped.outerTruncated !== undefined && unwrapped.outerTruncated !== nestedTruncated) {
    throw new FindingDecoderError("TRUNCATION_BINDING_MISMATCH");
  }
  if (raw.length === 0 && nestedTruncated) {
    throw new FindingDecoderError("EMPTY_TRUNCATED_RESULT_CONTRADICTION");
  }
  return {
    payload,
    features: stableFeatures(context, raw),
    truncated: nestedTruncated
  };
}

function decodeFeatureCollection(context: FindingDecoderContext): SacsWorldFinding | undefined {
  const decoded = strictFeatureCollection(context);
  if (decoded.features.length === 0) return undefined;
  return {
    ...commonFields(context, decoded.payload),
    ...(decoded.truncated ? { status: "PARTIAL" as const } : {}),
    findingKind: "SPATIAL_FEATURE_COLLECTION",
    returnedCount: decoded.features.length,
    truncated: decoded.truncated,
    features: decoded.features
  };
}

function decodeProfile(context: FindingDecoderContext): SacsWorldFinding | undefined {
  const outer = object(context.payload, "INVALID_PROFILE_RESULT");
  const unwrapped = unwrapGenericResult(context, outer);
  const payload = unwrapped.payload;
  assertOnlyKeys(
    payload,
    unwrapped.isGeneric
      ? ["schemaVersion", "productId", "contentHash", "lengthMetres", "samples", "unit"]
      : ["schemaVersion", "productId", "contentHash", "lengthMetres", "samples"],
    "UNKNOWN_PROFILE_RESULT_FIELD"
  );
  requireKeys(
    payload,
    ["schemaVersion", "productId", "contentHash", "lengthMetres", "samples"],
    "INCOMPLETE_PROFILE_RESULT"
  );
  if (payload["schemaVersion"] !== "gdps-elevation-profile/1.0") {
    throw new FindingDecoderError("INVALID_PROFILE_VERSION");
  }
  validateProductBinding(payload);
  validateGenericNestedUnit(context, unwrapped, payload);
  assertNestedProductBinding(unwrapped, payload);
  const lengthMetres = nonNegativeNumber(payload["lengthMetres"], "INVALID_PROFILE_LENGTH");
  const raw = payload["samples"];
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 10_000) {
    throw new FindingDecoderError("INVALID_PROFILE_SAMPLES");
  }
  const validatedSamples = raw.map((value) => {
    const sample = object(value, "INVALID_PROFILE_SAMPLE");
    assertOnlyKeys(sample, ["distanceMetres", "point", "value", "noData"], "UNKNOWN_PROFILE_SAMPLE_FIELD");
    requireKeys(sample, ["distanceMetres", "point", "value", "noData"], "INCOMPLETE_PROFILE_SAMPLE");
    const distanceM = nonNegativeNumber(sample["distanceMetres"], "INVALID_PROFILE_DISTANCE");
    if (distanceM > lengthMetres) throw new FindingDecoderError("PROFILE_DISTANCE_EXCEEDS_LENGTH");
    const noData = boolean(sample["noData"], "INVALID_PROFILE_NO_DATA_FLAG");
    if (noData !== (sample["value"] === null)) {
      throw new FindingDecoderError("PROFILE_NO_DATA_VALUE_CONTRADICTION");
    }
    return {
      distanceM,
      point: point(sample["point"]),
      ...(noData ? {} : { value: finiteNumber(sample["value"], "INVALID_PROFILE_VALUE") })
    };
  });
  for (let index = 1; index < validatedSamples.length; index += 1) {
    if (validatedSamples[index]!.distanceM < validatedSamples[index - 1]!.distanceM) {
      throw new FindingDecoderError("PROFILE_DISTANCE_NOT_MONOTONIC");
    }
  }
  const samples = validatedSamples
    .filter((sample): sample is typeof sample & { value: number } => sample.value !== undefined)
    .map(({ distanceM, point: samplePoint, value }) => ({ distanceM, point: samplePoint, value }));
  if (samples.length === 0) return undefined;
  const omittedNoDataSamples = samples.length !== validatedSamples.length;
  return {
    ...commonFields(context, payload),
    ...(unwrapped.outerTruncated === true || omittedNoDataSamples
      ? { status: "PARTIAL" as const }
      : {}),
    ...(omittedNoDataSamples ? { unknowns: ["PROFILE_NO_DATA_SAMPLES_OMITTED"] } : {}),
    findingKind: "PROFILE",
    unit: authoritativeUnit(context, payload),
    samples,
    truncated: unwrapped.outerTruncated ?? false
  };
}

function decodeQualifiedExplanation(context: FindingDecoderContext): SacsWorldFinding | undefined {
  const decoded = samplePayload(context, true);
  if (decoded.noData) return undefined;
  const { payload } = decoded;
  const explanation = object(payload["explanation"], "EXPLANATION_REQUIRED");
  assertOnlyKeys(explanation, ["classification", "basis", "quality"], "UNKNOWN_EXPLANATION_FIELD");
  requireKeys(explanation, ["classification", "basis", "quality"], "INCOMPLETE_EXPLANATION_RESULT");
  const classCode = authoritativeClassCode(context, payload["classCode"]);
  const classification = explanation["classification"];
  if (classification === null) {
    throw new FindingDecoderError("EXPLANATION_CLASS_REQUIRED_FOR_CURRENT_VALUE");
  }
  if (text(classification, "INVALID_EXPLANATION_CLASS", 128) !== classCode) {
    throw new FindingDecoderError("EXPLANATION_CLASS_MISMATCH");
  }
  object(explanation["quality"], "INVALID_EXPLANATION_QUALITY");
  return {
    ...commonFields(context, payload),
    findingKind: "QUALIFIED_EXPLANATION",
    explanationCode: "TRAVERSABILITY_CLASSIFICATION",
    summary: text(explanation["basis"], "INVALID_EXPLANATION_SUMMARY", 4000),
    reasonCodes: [classCode],
    publishedFacts: { traversabilityClass: classCode }
  };
}

function catalogItem(value: unknown): {
  productId: string;
  productType: string;
  displayName: string;
} {
  const source = object(value, "INVALID_CATALOG_ITEM");
  assertOnlyKeys(source, [
    "schemaVersion",
    "productId",
    "productType",
    "dataScopeKey",
    "name",
    "description",
    "contentHash",
    "loadedAt",
    "dataTime",
    "enabled",
    "extent",
    "storageKind",
    "crs",
    "verticalDatum",
    "resolution",
    "vocabulary",
    "quality",
    "metadata"
  ], "UNKNOWN_CATALOG_ITEM_FIELD");
  requireKeys(source, [
    "schemaVersion",
    "productId",
    "productType",
    "dataScopeKey",
    "name",
    "contentHash",
    "loadedAt",
    "enabled",
    "extent",
    "storageKind"
  ], "INCOMPLETE_CATALOG_ITEM");
  if (source["schemaVersion"] !== "gdps-current-product/1.0") {
    throw new FindingDecoderError("INVALID_CATALOG_ITEM_VERSION");
  }
  digest(source["contentHash"], "INVALID_CATALOG_CONTENT_HASH");
  text(source["dataScopeKey"], "INVALID_CATALOG_DATA_SCOPE", 256);
  text(source["loadedAt"], "INVALID_CATALOG_LOADED_AT", 64);
  boolean(source["enabled"], "INVALID_CATALOG_ENABLED_FLAG");
  object(source["extent"], "INVALID_CATALOG_EXTENT");
  const storageKind = text(source["storageKind"], "INVALID_CATALOG_STORAGE_KIND", 64);
  if (storageKind !== "RASTER_FILE" && storageKind !== "POSTGIS_VECTOR") {
    throw new FindingDecoderError("INVALID_CATALOG_STORAGE_KIND");
  }
  for (const key of ["resolution", "vocabulary", "quality"] as const) {
    if (source[key] !== undefined) object(source[key], `INVALID_CATALOG_${key.toUpperCase()}`);
  }
  if (source["metadata"] !== undefined) {
    const metadata = object(source["metadata"], "INVALID_CATALOG_METADATA");
    if (metadata["productProfile"] !== undefined) {
      text(metadata["productProfile"], "INVALID_CATALOG_PRODUCT_PROFILE", 128);
    }
  }
  return {
    productId: identifier(source["productId"], "INVALID_CATALOG_PRODUCT_ID"),
    productType: text(source["productType"], "INVALID_CATALOG_PRODUCT_TYPE", 128),
    displayName: text(source["name"], "INVALID_CATALOG_DISPLAY_NAME", 512)
  };
}

function decodeCatalog(context: FindingDecoderContext): SacsWorldFinding | undefined {
  const payload = object(context.payload, "INVALID_CATALOG_RESULT");
  let raw: readonly unknown[];
  let truncated: boolean;
  if (hasOwn(payload, "products")) {
    assertOnlyKeys(payload, ["schemaVersion", "products", "truncated"], "UNKNOWN_PRODUCT_SEARCH_FIELD");
    requireKeys(payload, ["schemaVersion", "products", "truncated"], "INCOMPLETE_PRODUCT_SEARCH_RESULT");
    if (payload["schemaVersion"] !== "gdps-product-search-result/1.0" || !Array.isArray(payload["products"])) {
      throw new FindingDecoderError("INVALID_PRODUCT_SEARCH_RESULT");
    }
    raw = payload["products"];
    truncated = boolean(payload["truncated"], "INVALID_TRUNCATION_FLAG");
  } else {
    raw = [payload];
    truncated = false;
  }
  if (raw.length > 256) throw new FindingDecoderError("CATALOG_RESULT_LIMIT_EXCEEDED");
  if (raw.length === 0) {
    if (truncated) throw new FindingDecoderError("EMPTY_TRUNCATED_RESULT_CONTRADICTION");
    return undefined;
  }
  const items = raw.map(catalogItem)
    .sort((left, right) => compareCodePoints(canonicalJson(left), canonicalJson(right)));
  return {
    ...commonFields(context, {}),
    ...(truncated ? { status: "PARTIAL" as const } : {}),
    findingKind: "CATALOG",
    returnedCount: items.length,
    truncated,
    items
  };
}

export function decodeStandardFinding(
  pattern: FindingDecoderPattern,
  context: FindingDecoderContext
): SacsWorldFinding | undefined {
  switch (pattern) {
    case "SAMPLE_VALUE":
      return decodePointMeasurement(context);
    case "SAMPLE_CLASS":
      return decodePointClassification(context);
    case "FIND_CLASS":
    case "FIND_VALUE_RANGE":
    case "VECTOR_IN_AREA":
    case "VECTOR_NEARBY":
    case "VECTOR_INTERSECTS":
      return decodeFeatureCollection(context);
    case "PROFILE_VALUE":
      return decodeProfile(context);
    case "CATALOG":
      return decodeCatalog(context);
    case "QUALIFIED_EXPLANATION":
      return decodeQualifiedExplanation(context);
  }
}

export function decoderGapsForFinding(finding: SacsWorldFinding): SACSGeospatialTypedGap10[] {
  const gaps: SACSGeospatialTypedGap10[] = [];
  const truncated = (finding.findingKind === "SPATIAL_FEATURE_COLLECTION"
    || finding.findingKind === "PROFILE"
    || finding.findingKind === "CATALOG") && finding.truncated;
  const omittedProfileSamples = finding.findingKind === "PROFILE"
    && finding.unknowns?.includes("PROFILE_NO_DATA_SAMPLES_OMITTED") === true;
  if (finding.status === "PARTIAL" && (!truncated || omittedProfileSamples)) {
    gaps.push({
      gapId: deterministicId("gap", { findingId: finding.findingId, kind: "PARTIAL" }),
      gapKind: "DATA_GAP",
      severity: "WARNING",
      messageCode: "WSGS_UPSTREAM_PARTIAL_RESULT",
      semanticConcept: finding.semanticConcept,
      findingIds: [finding.findingId],
      evidenceItemIds: [...finding.evidenceItemIds]
    });
  }
  if (truncated) {
    gaps.push({
      gapId: deterministicId("gap", { findingId: finding.findingId, kind: "TRUNCATED" }),
      gapKind: "TRUNCATED",
      severity: "WARNING",
      messageCode: "WSGS_RESULT_TRUNCATED",
      semanticConcept: finding.semanticConcept,
      findingIds: [finding.findingId],
      evidenceItemIds: [...finding.evidenceItemIds]
    });
  }
  return gaps.sort((left, right) => compareCodePoints(left.gapId, right.gapId));
}
