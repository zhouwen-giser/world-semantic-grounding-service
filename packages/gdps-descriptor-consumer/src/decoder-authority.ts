import { canonicalSha256 } from "./consumer.js";
import { gdpsV021FindingContractClosure } from "@wsgs/gowm-contract-intake";
import type {
  GdpsQueryProfile,
  ProductDescriptorRegistry,
  ProductQuerySemantics,
  ProductTypeDescriptor,
  ProductVocabularyRegistry
} from "./types.js";

export type GdpsSha256Digest = `sha256:${string}`;

export type GdpsFindingDecoderPattern =
  | GdpsQueryProfile
  | "CATALOG"
  | "QUALIFIED_EXPLANATION";

export interface GdpsFindingOperationBinding {
  readonly applicability: "FINDING" | "CATALOG" | "NOT_APPLICABLE";
  readonly descriptorConstraint: {
    readonly descriptorId: string;
    readonly descriptorHash: GdpsSha256Digest;
  } | null;
  readonly queryProfile: GdpsQueryProfile | "SAMPLE_VALUE_OR_CLASS" | null;
  readonly querySemantics: ProductQuerySemantics | "CATALOG" | "CURRENTNESS";
  readonly decoderPattern: GdpsFindingDecoderPattern | null;
}

export interface GdpsFindingContractClosureOperation {
  readonly operationId: string;
  readonly operationVersion: string;
  readonly inputSchemaUri: string;
  readonly inputSchemaHash: GdpsSha256Digest;
  readonly outputSchemaUri: string;
  readonly outputSchemaHash: GdpsSha256Digest;
  readonly semanticProfile: Readonly<Record<string, unknown>>;
  readonly semanticProfileHash: GdpsSha256Digest;
  readonly maturity: string;
  readonly availability: string;
  readonly findingBinding: GdpsFindingOperationBinding;
}

export interface GdpsFindingContractClosure {
  readonly schemaVersion: "wsgs-gdps-finding-contract-closure/1.0";
  readonly sources: {
    readonly gdpsSha: string;
    readonly gdpsImplementationTreeHash: GdpsSha256Digest;
    readonly gdpsSourceFingerprint: GdpsSha256Digest;
    readonly gdpsSourceFileCount: number;
    readonly gowmSha: string;
    readonly wsgsSha: string;
  };
  readonly handoff: {
    readonly bundleHash: GdpsSha256Digest;
    readonly checksumsHash: GdpsSha256Digest;
    readonly consumerLockHash: GdpsSha256Digest;
    readonly capabilityLockHash: GdpsSha256Digest;
    readonly descriptorLockHash: GdpsSha256Digest;
    readonly providerRecipeLockHash: GdpsSha256Digest;
    readonly runtimeRecipeLockHash: GdpsSha256Digest;
    readonly sampleDatasetLockHash: GdpsSha256Digest;
    readonly queryCorpusHash: GdpsSha256Digest;
    readonly testBaselineHash: GdpsSha256Digest;
  };
  readonly gateway: {
    readonly contractCatalogRevision: GdpsSha256Digest;
    readonly semanticCatalogHash: GdpsSha256Digest;
    readonly bindingRevision: GdpsSha256Digest;
    readonly instanceFingerprint: GdpsSha256Digest;
    readonly runningConfigFingerprint: GdpsSha256Digest;
  };
  readonly provider: {
    readonly providerId: string;
    readonly providerVersion: string;
    readonly manifestHash: GdpsSha256Digest;
    readonly implementationDigest: GdpsSha256Digest;
    readonly manifest: Readonly<Record<string, unknown>>;
  };
  readonly descriptorAuthority: {
    readonly registryHash: GdpsSha256Digest;
    readonly registry: ProductDescriptorRegistry;
    readonly vocabularyRegistryHash: GdpsSha256Digest;
    readonly vocabularyRegistry: ProductVocabularyRegistry;
  };
  readonly operations: readonly GdpsFindingContractClosureOperation[];
  readonly outputSchemas: readonly {
    readonly schemaUri: string;
    readonly schemaHash: GdpsSha256Digest;
    readonly sourcePath: string;
    readonly document: Readonly<Record<string, unknown>>;
  }[];
  readonly closureHash: GdpsSha256Digest;
}

export interface GdpsFinalBFindingAuthority {
  readonly closureHash: GdpsSha256Digest;
}

export interface GdpsFindingOperationAuthority {
  readonly closureHash: GdpsSha256Digest;
  readonly operationId: string;
  readonly operationVersion: string;
  readonly authorityKind: "DESCRIPTOR" | "CATALOG";
}

export interface GdpsGatewayBindingProjection {
  readonly contractCatalogRevision: GdpsSha256Digest;
  readonly semanticCatalogHash: GdpsSha256Digest;
  readonly bindingRevision: GdpsSha256Digest;
  readonly instanceFingerprint: GdpsSha256Digest;
  readonly runningConfigFingerprint: GdpsSha256Digest;
}

export interface GdpsFindingOperationProjection {
  readonly closureHash: GdpsSha256Digest;
  readonly authorityKind: "DESCRIPTOR" | "CATALOG";
  readonly operationId: string;
  readonly operationVersion: string;
  readonly inputSchemaUri: string;
  readonly inputSchemaHash: GdpsSha256Digest;
  readonly outputSchemaUri: string;
  readonly outputSchemaHash: GdpsSha256Digest;
  readonly semanticProfile: Readonly<Record<string, unknown>>;
  readonly semanticProfileHash: GdpsSha256Digest;
  readonly semanticConcept: string;
  readonly querySemantics: ProductQuerySemantics | "CATALOG";
  readonly queryProfile: GdpsQueryProfile | "CATALOG";
  readonly decoderPattern: GdpsFindingDecoderPattern;
  readonly gateway: GdpsGatewayBindingProjection;
  readonly provider: {
    readonly providerId: string;
    readonly providerVersion: string;
    readonly manifestHash: GdpsSha256Digest;
    readonly implementationDigest: GdpsSha256Digest;
  };
  readonly descriptor?: {
    readonly descriptorId: string;
    readonly descriptorHash: GdpsSha256Digest;
    readonly registryHash: GdpsSha256Digest;
    readonly vocabularyRegistryHash: GdpsSha256Digest;
    readonly productType: string;
    readonly productProfile: string;
    readonly representation: ProductTypeDescriptor["representation"];
    readonly valueSemanticsKind: ProductTypeDescriptor["valueSemantics"]["kind"];
    readonly unit: string | null;
    readonly allowedClassCodes?: readonly string[];
  };
}

export interface ResolveGdpsFindingOperationAuthorityInput {
  readonly operationId: string;
  readonly operationVersion: string;
  readonly semanticConcept: string;
  /** Required only when the locked operation is descriptor-generic. */
  readonly descriptorId?: string;
}

export class GdpsFindingAuthorityError extends Error {
  constructor(readonly code: string) {
    super(`GDPS finding authority validation failed: ${code}`);
    this.name = "GdpsFindingAuthorityError";
  }
}

interface FinalAuthorityState {
  readonly closureHash: GdpsSha256Digest;
  readonly gateway: GdpsGatewayBindingProjection;
  readonly provider: GdpsFindingOperationProjection["provider"];
  readonly registryHash: GdpsSha256Digest;
  readonly vocabularyRegistryHash: GdpsSha256Digest;
  readonly descriptors: ReadonlyMap<string, ProductTypeDescriptor>;
  readonly descriptorHashes: ReadonlyMap<string, GdpsSha256Digest>;
  readonly vocabularies: Readonly<Record<string, readonly string[]>>;
  readonly operations: ReadonlyMap<string, GdpsFindingContractClosureOperation>;
}

const finalAuthorities = new WeakMap<object, FinalAuthorityState>();
const operationAuthorities = new WeakMap<object, GdpsFindingOperationProjection>();
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const sourceShaPattern = /^[0-9a-f]{40}$/u;
const operationIdPattern = /^[a-z][a-z0-9.-]{2,127}$/u;
const operationVersionPattern = /^[0-9]+\.[0-9]+$/u;
const queryProfiles = new Set<GdpsQueryProfile>([
  "SAMPLE_VALUE",
  "PROFILE_VALUE",
  "FIND_VALUE_RANGE",
  "SAMPLE_CLASS",
  "FIND_CLASS",
  "VECTOR_IN_AREA",
  "VECTOR_NEARBY",
  "VECTOR_INTERSECTS"
]);
const decoderPatterns = new Set<GdpsFindingDecoderPattern>([
  ...queryProfiles,
  "CATALOG",
  "QUALIFIED_EXPLANATION"
]);
const querySemanticsByProfile: Readonly<Record<GdpsQueryProfile | "SAMPLE_VALUE_OR_CLASS", ProductQuerySemantics>> = {
  SAMPLE_VALUE: "READ_VALUE",
  SAMPLE_CLASS: "READ_VALUE",
  SAMPLE_VALUE_OR_CLASS: "READ_VALUE",
  PROFILE_VALUE: "READ_PROFILE",
  FIND_CLASS: "FIND_CLASS_AREAS",
  FIND_VALUE_RANGE: "FIND_VALUE_RANGE_AREAS",
  VECTOR_IN_AREA: "FIND_FEATURES_IN_AREA",
  VECTOR_NEARBY: "FIND_FEATURES_NEARBY",
  VECTOR_INTERSECTS: "FIND_INTERSECTIONS"
};

function fail(code: string): never {
  throw new GdpsFindingAuthorityError(code);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], code: string): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) fail(code);
}

function text(value: unknown, code: string, maximum = 2048): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) fail(code);
  return value;
}

function digest(value: unknown, code: string): GdpsSha256Digest {
  if (typeof value !== "string" || !digestPattern.test(value)) fail(code);
  return value as GdpsSha256Digest;
}

function sourceSha(value: unknown, code: string): string {
  if (typeof value !== "string" || !sourceShaPattern.test(value)) fail(code);
  return value;
}

function exactInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail(code);
  return value as number;
}

function unique(values: readonly string[], code: string): void {
  if (new Set(values).size !== values.length) fail(code);
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function operationKey(operationId: string, operationVersion: string): string {
  return `${operationId}@${operationVersion}`;
}

function validateDescriptorRegistry(value: unknown, expectedHash: GdpsSha256Digest): {
  registry: ProductDescriptorRegistry;
  descriptors: Map<string, ProductTypeDescriptor>;
  descriptorHashes: Map<string, GdpsSha256Digest>;
} {
  const registry = record(value, "GDPS_DESCRIPTOR_REGISTRY_INVALID") as unknown as ProductDescriptorRegistry;
  if (registry.schemaVersion !== "gdps-product-type-descriptors/1.0"
    || !Array.isArray(registry.descriptors)
    || registry.descriptors.length !== 35
    || canonicalSha256(registry) !== expectedHash) {
    fail("GDPS_DESCRIPTOR_REGISTRY_DRIFT");
  }
  if (new Set(registry.descriptors.map(({ productType }) => productType)).size !== 34) {
    fail("GDPS_DESCRIPTOR_PRODUCT_TYPE_COUNT_MISMATCH");
  }
  const descriptors = new Map<string, ProductTypeDescriptor>();
  const descriptorHashes = new Map<string, GdpsSha256Digest>();
  for (const descriptor of registry.descriptors) {
    text(descriptor.descriptorId, "GDPS_DESCRIPTOR_ID_INVALID", 256);
    text(descriptor.productType, "GDPS_DESCRIPTOR_PRODUCT_TYPE_INVALID", 128);
    text(descriptor.productProfile, "GDPS_DESCRIPTOR_PRODUCT_PROFILE_INVALID", 128);
    if (!Array.isArray(descriptor.queryProfiles)
      || descriptor.queryProfiles.length < 1
      || descriptor.queryProfiles.some((profile) => !queryProfiles.has(profile))) {
      fail("GDPS_DESCRIPTOR_QUERY_PROFILE_INVALID");
    }
    unique(descriptor.queryProfiles, "GDPS_DESCRIPTOR_QUERY_PROFILE_DUPLICATE");
    if (descriptors.has(descriptor.descriptorId)) fail("GDPS_DESCRIPTOR_ID_DUPLICATE");
    descriptors.set(descriptor.descriptorId, structuredClone(descriptor));
    descriptorHashes.set(descriptor.descriptorId, canonicalSha256(descriptor));
  }
  unique(
    registry.descriptors.map(({ productType, productProfile }) => `${productType}/${productProfile}`),
    "GDPS_DESCRIPTOR_PRODUCT_PROFILE_DUPLICATE"
  );
  return { registry, descriptors, descriptorHashes };
}

function validateVocabularyRegistry(
  value: unknown,
  expectedHash: GdpsSha256Digest,
  descriptors: ReadonlyMap<string, ProductTypeDescriptor>
): ProductVocabularyRegistry {
  const registry = record(value, "GDPS_VOCABULARY_REGISTRY_INVALID") as unknown as ProductVocabularyRegistry;
  if (typeof registry.schemaVersion !== "string"
    || registry.vocabularies === null
    || typeof registry.vocabularies !== "object"
    || Array.isArray(registry.vocabularies)
    || canonicalSha256(registry) !== expectedHash) {
    fail("GDPS_VOCABULARY_REGISTRY_DRIFT");
  }
  for (const [name, codes] of Object.entries(registry.vocabularies)) {
    text(name, "GDPS_VOCABULARY_ID_INVALID", 128);
    if (!Array.isArray(codes) || codes.length < 1 || codes.length > 4096) {
      fail("GDPS_VOCABULARY_CODES_INVALID");
    }
    for (const code of codes) text(code, "GDPS_VOCABULARY_CODE_INVALID", 128);
    unique(codes, "GDPS_VOCABULARY_CODE_DUPLICATE");
  }
  for (const descriptor of descriptors.values()) {
    if (descriptor.vocabularyRef !== null
      && registry.vocabularies[descriptor.vocabularyRef] === undefined) {
      fail("GDPS_DESCRIPTOR_VOCABULARY_REFERENCE_MISSING");
    }
    if (descriptor.valueSemantics.kind === "CLASS_CODE" && descriptor.vocabularyRef === null) {
      fail("GDPS_CLASS_DESCRIPTOR_VOCABULARY_REQUIRED");
    }
    if (descriptor.valueSemantics.kind === "NUMBER"
      && (typeof descriptor.valueSemantics.unit !== "string" || descriptor.valueSemantics.unit.length < 1)) {
      fail("GDPS_NUMERIC_DESCRIPTOR_UNIT_REQUIRED");
    }
  }
  return registry;
}

function validateBinding(
  value: unknown,
  descriptors: ReadonlyMap<string, ProductTypeDescriptor>,
  descriptorHashes: ReadonlyMap<string, GdpsSha256Digest>
): GdpsFindingOperationBinding {
  const binding = record(value, "GDPS_FINDING_BINDING_INVALID");
  onlyKeys(
    binding,
    ["applicability", "descriptorConstraint", "queryProfile", "querySemantics", "decoderPattern"],
    "GDPS_FINDING_BINDING_UNKNOWN_FIELD"
  );
  const applicability = binding["applicability"];
  if (applicability !== "FINDING" && applicability !== "CATALOG" && applicability !== "NOT_APPLICABLE") {
    fail("GDPS_FINDING_APPLICABILITY_INVALID");
  }
  if (applicability === "CATALOG") {
    if (binding["descriptorConstraint"] !== null || binding["queryProfile"] !== null
      || binding["querySemantics"] !== "CATALOG" || binding["decoderPattern"] !== "CATALOG") {
      fail("GDPS_CATALOG_DESCRIPTOR_FORBIDDEN");
    }
  } else if (applicability === "NOT_APPLICABLE") {
    if (binding["descriptorConstraint"] !== null || binding["queryProfile"] !== null
      || binding["querySemantics"] !== "CURRENTNESS" || binding["decoderPattern"] !== null) {
      fail("GDPS_NON_FINDING_BINDING_INVALID");
    }
  } else {
    const profile = binding["queryProfile"];
    if ((typeof profile !== "string")
      || (profile !== "SAMPLE_VALUE_OR_CLASS" && !queryProfiles.has(profile as GdpsQueryProfile))) {
      fail("GDPS_FINDING_QUERY_PROFILE_INVALID");
    }
    if (binding["querySemantics"] !== querySemanticsByProfile[profile as GdpsQueryProfile | "SAMPLE_VALUE_OR_CLASS"]) {
      fail("GDPS_FINDING_QUERY_SEMANTICS_MISMATCH");
    }
    if (typeof binding["decoderPattern"] !== "string"
      || !decoderPatterns.has(binding["decoderPattern"] as GdpsFindingDecoderPattern)) {
      fail("GDPS_FINDING_DECODER_PATTERN_INVALID");
    }
    if (binding["descriptorConstraint"] !== null) {
      const constraint = record(binding["descriptorConstraint"], "GDPS_DESCRIPTOR_CONSTRAINT_INVALID");
      onlyKeys(constraint, ["descriptorId", "descriptorHash"], "GDPS_DESCRIPTOR_CONSTRAINT_UNKNOWN_FIELD");
      const descriptorId = text(constraint["descriptorId"], "GDPS_DESCRIPTOR_CONSTRAINT_INVALID", 256);
      const descriptorHash = digest(constraint["descriptorHash"], "GDPS_DESCRIPTOR_CONSTRAINT_INVALID");
      const descriptor = descriptors.get(descriptorId);
      if (descriptor === undefined || descriptorHashes.get(descriptorId) !== descriptorHash) {
        fail("GDPS_DESCRIPTOR_CONSTRAINT_DRIFT");
      }
      if (profile !== "SAMPLE_VALUE_OR_CLASS"
        && !descriptor.queryProfiles.includes(profile as GdpsQueryProfile)) {
        fail("GDPS_DESCRIPTOR_QUERY_PROFILE_UNSUPPORTED");
      }
    }
  }
  return structuredClone(binding) as unknown as GdpsFindingOperationBinding;
}

function validateManifestOperation(
  manifest: Record<string, unknown>,
  operation: GdpsFindingContractClosureOperation
): void {
  const capabilities = manifest["capabilities"];
  if (!Array.isArray(capabilities)) fail("GDPS_PROVIDER_MANIFEST_CAPABILITIES_INVALID");
  const matches = capabilities.filter((candidate) => {
    const item = record(candidate, "GDPS_PROVIDER_MANIFEST_CAPABILITY_INVALID");
    return item["operationId"] === operation.operationId
      && item["operationVersion"] === operation.operationVersion;
  });
  if (matches.length !== 1) fail("GDPS_PROVIDER_MANIFEST_OPERATION_MISMATCH");
  const candidate = record(matches[0], "GDPS_PROVIDER_MANIFEST_CAPABILITY_INVALID");
  if (candidate["inputSchemaUri"] !== operation.inputSchemaUri
    || candidate["inputSchemaHash"] !== operation.inputSchemaHash
    || candidate["outputSchemaUri"] !== operation.outputSchemaUri
    || candidate["outputSchemaHash"] !== operation.outputSchemaHash
    || candidate["maturity"] !== operation.maturity
    || canonicalSha256(candidate["semanticProfile"]) !== operation.semanticProfileHash
    || canonicalSha256(operation.semanticProfile) !== operation.semanticProfileHash) {
    fail("GDPS_PROVIDER_MANIFEST_OPERATION_DRIFT");
  }
}

function createFinalBFindingAuthority(
  closureValue: unknown,
  expectedClosureHash: GdpsSha256Digest
): GdpsFinalBFindingAuthority {
  const closure = record(closureValue, "GDPS_FINDING_CLOSURE_INVALID");
  onlyKeys(
    closure,
    [
      "schemaVersion",
      "sources",
      "handoff",
      "gateway",
      "provider",
      "descriptorAuthority",
      "operations",
      "outputSchemas",
      "closureHash"
    ],
    "GDPS_FINDING_CLOSURE_UNKNOWN_FIELD"
  );
  if (closure["schemaVersion"] !== "wsgs-gdps-finding-contract-closure/1.0") {
    fail("GDPS_FINDING_CLOSURE_SCHEMA_UNSUPPORTED");
  }
  const closureHash = digest(closure["closureHash"], "GDPS_FINDING_CLOSURE_HASH_INVALID");
  if (digest(expectedClosureHash, "GDPS_EXPECTED_CLOSURE_HASH_INVALID") !== closureHash) {
    fail("GDPS_FINDING_CLOSURE_ROOT_MISMATCH");
  }
  const body = { ...closure };
  delete body["closureHash"];
  if (canonicalSha256(body) !== closureHash) fail("GDPS_FINDING_CLOSURE_HASH_DRIFT");

  const sources = record(closure["sources"], "GDPS_FINDING_CLOSURE_SOURCES_INVALID");
  onlyKeys(sources, [
    "gdpsSha",
    "gdpsImplementationTreeHash",
    "gdpsSourceFingerprint",
    "gdpsSourceFileCount",
    "gowmSha",
    "wsgsSha"
  ], "GDPS_FINDING_CLOSURE_SOURCES_UNKNOWN_FIELD");
  sourceSha(sources["gdpsSha"], "GDPS_FINDING_CLOSURE_SOURCE_SHA_INVALID");
  sourceSha(sources["gowmSha"], "GDPS_FINDING_CLOSURE_SOURCE_SHA_INVALID");
  sourceSha(sources["wsgsSha"], "GDPS_FINDING_CLOSURE_SOURCE_SHA_INVALID");
  digest(sources["gdpsImplementationTreeHash"], "GDPS_FINDING_CLOSURE_SOURCE_HASH_INVALID");
  digest(sources["gdpsSourceFingerprint"], "GDPS_FINDING_CLOSURE_SOURCE_HASH_INVALID");
  exactInteger(sources["gdpsSourceFileCount"], "GDPS_FINDING_CLOSURE_SOURCE_COUNT_INVALID");

  const handoff = record(closure["handoff"], "GDPS_FINDING_CLOSURE_HANDOFF_INVALID");
  const handoffKeys = [
    "bundleHash",
    "checksumsHash",
    "consumerLockHash",
    "capabilityLockHash",
    "descriptorLockHash",
    "providerRecipeLockHash",
    "runtimeRecipeLockHash",
    "sampleDatasetLockHash",
    "queryCorpusHash",
    "testBaselineHash"
  ] as const;
  onlyKeys(handoff, handoffKeys, "GDPS_FINDING_CLOSURE_HANDOFF_UNKNOWN_FIELD");
  for (const key of handoffKeys) digest(handoff[key], "GDPS_FINDING_CLOSURE_HANDOFF_HASH_INVALID");

  const gateway = record(closure["gateway"], "GDPS_FINDING_CLOSURE_GATEWAY_INVALID");
  const gatewayKeys = [
    "contractCatalogRevision",
    "semanticCatalogHash",
    "bindingRevision",
    "instanceFingerprint",
    "runningConfigFingerprint"
  ] as const;
  onlyKeys(gateway, gatewayKeys, "GDPS_FINDING_CLOSURE_GATEWAY_UNKNOWN_FIELD");
  for (const key of gatewayKeys) digest(gateway[key], "GDPS_FINDING_CLOSURE_GATEWAY_HASH_INVALID");

  const provider = record(closure["provider"], "GDPS_FINDING_CLOSURE_PROVIDER_INVALID");
  onlyKeys(
    provider,
    ["providerId", "providerVersion", "manifestHash", "implementationDigest", "manifest"],
    "GDPS_FINDING_CLOSURE_PROVIDER_UNKNOWN_FIELD"
  );
  const providerId = text(provider["providerId"], "GDPS_FINDING_CLOSURE_PROVIDER_INVALID", 128);
  const providerVersion = text(provider["providerVersion"], "GDPS_FINDING_CLOSURE_PROVIDER_INVALID", 64);
  const manifestHash = digest(provider["manifestHash"], "GDPS_FINDING_CLOSURE_MANIFEST_HASH_INVALID");
  const implementationDigest = digest(
    provider["implementationDigest"],
    "GDPS_FINDING_CLOSURE_IMPLEMENTATION_DIGEST_INVALID"
  );
  const manifest = record(provider["manifest"], "GDPS_FINDING_CLOSURE_MANIFEST_INVALID");
  const manifestProvider = record(manifest["provider"], "GDPS_FINDING_CLOSURE_MANIFEST_PROVIDER_INVALID");
  if (manifestProvider["providerId"] !== providerId
    || manifestProvider["providerVersion"] !== providerVersion
    || manifestProvider["implementationDigest"] !== implementationDigest
    || canonicalSha256(manifest) !== manifestHash) {
    fail("GDPS_FINDING_CLOSURE_MANIFEST_DRIFT");
  }

  const descriptorAuthority = record(
    closure["descriptorAuthority"],
    "GDPS_FINDING_CLOSURE_DESCRIPTOR_AUTHORITY_INVALID"
  );
  onlyKeys(
    descriptorAuthority,
    ["registryHash", "registry", "vocabularyRegistryHash", "vocabularyRegistry"],
    "GDPS_FINDING_CLOSURE_DESCRIPTOR_AUTHORITY_UNKNOWN_FIELD"
  );
  const registryHash = digest(
    descriptorAuthority["registryHash"],
    "GDPS_DESCRIPTOR_REGISTRY_HASH_INVALID"
  );
  if (registryHash !== handoff["descriptorLockHash"]) fail("GDPS_DESCRIPTOR_HANDOFF_HASH_MISMATCH");
  const { descriptors, descriptorHashes } = validateDescriptorRegistry(
    descriptorAuthority["registry"],
    registryHash
  );
  const vocabularyRegistryHash = digest(
    descriptorAuthority["vocabularyRegistryHash"],
    "GDPS_VOCABULARY_REGISTRY_HASH_INVALID"
  );
  const vocabularyRegistry = validateVocabularyRegistry(
    descriptorAuthority["vocabularyRegistry"],
    vocabularyRegistryHash,
    descriptors
  );

  if (!Array.isArray(closure["operations"]) || closure["operations"].length !== 30) {
    fail("GDPS_FINDING_CLOSURE_OPERATION_COUNT_MISMATCH");
  }
  const operations = new Map<string, GdpsFindingContractClosureOperation>();
  const operationKeys: string[] = [];
  for (const value of closure["operations"]) {
    const raw = record(value, "GDPS_FINDING_CLOSURE_OPERATION_INVALID");
    onlyKeys(raw, [
      "operationId",
      "operationVersion",
      "inputSchemaUri",
      "inputSchemaHash",
      "outputSchemaUri",
      "outputSchemaHash",
      "semanticProfile",
      "semanticProfileHash",
      "maturity",
      "availability",
      "findingBinding"
    ], "GDPS_FINDING_CLOSURE_OPERATION_UNKNOWN_FIELD");
    const operationId = text(raw["operationId"], "GDPS_FINDING_CLOSURE_OPERATION_ID_INVALID", 128);
    const operationVersion = text(
      raw["operationVersion"],
      "GDPS_FINDING_CLOSURE_OPERATION_VERSION_INVALID",
      32
    );
    if (!operationIdPattern.test(operationId) || !operationVersionPattern.test(operationVersion)) {
      fail("GDPS_FINDING_CLOSURE_OPERATION_IDENTITY_INVALID");
    }
    const operation: GdpsFindingContractClosureOperation = {
      operationId,
      operationVersion,
      inputSchemaUri: text(raw["inputSchemaUri"], "GDPS_FINDING_CLOSURE_SCHEMA_URI_INVALID"),
      inputSchemaHash: digest(raw["inputSchemaHash"], "GDPS_FINDING_CLOSURE_SCHEMA_HASH_INVALID"),
      outputSchemaUri: text(raw["outputSchemaUri"], "GDPS_FINDING_CLOSURE_SCHEMA_URI_INVALID"),
      outputSchemaHash: digest(raw["outputSchemaHash"], "GDPS_FINDING_CLOSURE_SCHEMA_HASH_INVALID"),
      semanticProfile: structuredClone(record(
        raw["semanticProfile"],
        "GDPS_FINDING_CLOSURE_SEMANTIC_PROFILE_INVALID"
      )),
      semanticProfileHash: digest(
        raw["semanticProfileHash"],
        "GDPS_FINDING_CLOSURE_SEMANTIC_PROFILE_HASH_INVALID"
      ),
      maturity: text(raw["maturity"], "GDPS_FINDING_CLOSURE_MATURITY_INVALID", 32),
      availability: text(raw["availability"], "GDPS_FINDING_CLOSURE_AVAILABILITY_INVALID", 32),
      findingBinding: validateBinding(raw["findingBinding"], descriptors, descriptorHashes)
    };
    if (operation.maturity !== "PREVIEW") fail("GDPS_FINDING_CLOSURE_MATURITY_MISMATCH");
    if (canonicalSha256(operation.semanticProfile) !== operation.semanticProfileHash) {
      fail("GDPS_FINDING_CLOSURE_SEMANTIC_PROFILE_DRIFT");
    }
    validateManifestOperation(manifest, operation);
    const key = operationKey(operationId, operationVersion);
    if (operations.has(key)) fail("GDPS_FINDING_CLOSURE_OPERATION_DUPLICATE");
    operations.set(key, freeze(operation));
    operationKeys.push(key);
  }
  const sortedOperationKeys = [...operationKeys].sort();
  if (operationKeys.some((key, index) => key !== sortedOperationKeys[index])) {
    fail("GDPS_FINDING_CLOSURE_OPERATION_ORDER_INVALID");
  }

  if (!Array.isArray(closure["outputSchemas"]) || closure["outputSchemas"].length !== 30) {
    fail("GDPS_FINDING_CLOSURE_OUTPUT_SCHEMA_COUNT_MISMATCH");
  }
  const schemaUris = new Set<string>();
  const sourcePaths: string[] = [];
  for (const value of closure["outputSchemas"]) {
    const raw = record(value, "GDPS_FINDING_CLOSURE_OUTPUT_SCHEMA_INVALID");
    onlyKeys(raw, ["schemaUri", "schemaHash", "sourcePath", "document"],
      "GDPS_FINDING_CLOSURE_OUTPUT_SCHEMA_UNKNOWN_FIELD");
    const schemaUri = text(raw["schemaUri"], "GDPS_FINDING_CLOSURE_OUTPUT_SCHEMA_URI_INVALID");
    const schemaHash = digest(raw["schemaHash"], "GDPS_FINDING_CLOSURE_OUTPUT_SCHEMA_HASH_INVALID");
    const sourcePath = text(raw["sourcePath"], "GDPS_FINDING_CLOSURE_OUTPUT_SCHEMA_PATH_INVALID");
    const document = record(raw["document"], "GDPS_FINDING_CLOSURE_OUTPUT_SCHEMA_DOCUMENT_INVALID");
    if (document["$id"] !== schemaUri || canonicalSha256(document) !== schemaHash) {
      fail("GDPS_FINDING_CLOSURE_OUTPUT_SCHEMA_DRIFT");
    }
    if (schemaUris.has(schemaUri)) fail("GDPS_FINDING_CLOSURE_OUTPUT_SCHEMA_DUPLICATE");
    schemaUris.add(schemaUri);
    sourcePaths.push(sourcePath);
  }
  const sortedSourcePaths = [...sourcePaths].sort();
  if (sourcePaths.some((path, index) => path !== sortedSourcePaths[index])) {
    fail("GDPS_FINDING_CLOSURE_OUTPUT_SCHEMA_ORDER_INVALID");
  }
  for (const operation of operations.values()) {
    if (!schemaUris.has(operation.outputSchemaUri)) fail("GDPS_FINDING_CLOSURE_OUTPUT_SCHEMA_MISSING");
  }

  const token = freeze({ closureHash });
  finalAuthorities.set(token, {
    closureHash,
    gateway: freeze(structuredClone(gateway) as unknown as GdpsGatewayBindingProjection),
    provider: freeze({ providerId, providerVersion, manifestHash, implementationDigest }),
    registryHash,
    vocabularyRegistryHash,
    descriptors,
    descriptorHashes,
    vocabularies: freeze(structuredClone(vocabularyRegistry.vocabularies)),
    operations
  });
  return token;
}

const gdpsV021ExpectedFindingClosureHash = gdpsV021FindingContractClosure.closureHash;

/**
 * The only production minting path. It consumes the build-intake artifact
 * directly, so a caller cannot substitute a self-signed closure and hash.
 */
export function createGdpsV021FinalBFindingAuthority(): GdpsFinalBFindingAuthority {
  return createFinalBFindingAuthority(
    gdpsV021FindingContractClosure,
    gdpsV021ExpectedFindingClosureHash
  );
}

function requireFinalAuthority(authority: GdpsFinalBFindingAuthority): FinalAuthorityState {
  if (authority === null || typeof authority !== "object") fail("GDPS_FINDING_AUTHORITY_FORGED");
  const state = finalAuthorities.get(authority);
  if (state === undefined) fail("GDPS_FINDING_AUTHORITY_FORGED");
  return state;
}

export function resolveGdpsFindingOperationAuthority(
  authority: GdpsFinalBFindingAuthority,
  input: ResolveGdpsFindingOperationAuthorityInput
): GdpsFindingOperationAuthority {
  const state = requireFinalAuthority(authority);
  const operationId = text(input.operationId, "GDPS_FINDING_OPERATION_ID_INVALID", 128);
  const operationVersion = text(input.operationVersion, "GDPS_FINDING_OPERATION_VERSION_INVALID", 32);
  const operation = state.operations.get(operationKey(operationId, operationVersion));
  if (operation === undefined) fail("GDPS_FINDING_OPERATION_NOT_LOCKED");
  const semanticConcept = text(input.semanticConcept, "GDPS_FINDING_SEMANTIC_CONCEPT_INVALID", 128);
  const binding = operation.findingBinding;
  if (binding.applicability === "NOT_APPLICABLE") fail("GDPS_FINDING_OPERATION_NOT_APPLICABLE");

  let projection: GdpsFindingOperationProjection;
  if (binding.applicability === "CATALOG") {
    if (input.descriptorId !== undefined) fail("GDPS_CATALOG_DESCRIPTOR_FORBIDDEN");
    projection = {
      closureHash: state.closureHash,
      authorityKind: "CATALOG",
      operationId,
      operationVersion,
      inputSchemaUri: operation.inputSchemaUri,
      inputSchemaHash: operation.inputSchemaHash,
      outputSchemaUri: operation.outputSchemaUri,
      outputSchemaHash: operation.outputSchemaHash,
      semanticProfile: operation.semanticProfile,
      semanticProfileHash: operation.semanticProfileHash,
      semanticConcept,
      querySemantics: "CATALOG",
      queryProfile: "CATALOG",
      decoderPattern: "CATALOG",
      gateway: state.gateway,
      provider: state.provider
    };
  } else {
    const constrainedId = binding.descriptorConstraint?.descriptorId;
    const descriptorId = constrainedId ?? input.descriptorId;
    if (descriptorId === undefined) fail("GDPS_GENERIC_DESCRIPTOR_ID_REQUIRED");
    if (constrainedId !== undefined && input.descriptorId !== undefined && input.descriptorId !== constrainedId) {
      fail("GDPS_OPERATION_DESCRIPTOR_CONSTRAINT_MISMATCH");
    }
    const descriptor = state.descriptors.get(descriptorId);
    if (descriptor === undefined) fail("GDPS_DESCRIPTOR_NOT_LOCKED");
    const descriptorHash = state.descriptorHashes.get(descriptorId);
    if (descriptorHash === undefined) fail("GDPS_DESCRIPTOR_NOT_LOCKED");
    const lockedProfile = binding.queryProfile;
    if (lockedProfile === null) fail("GDPS_FINDING_QUERY_PROFILE_INVALID");
    const queryProfile: GdpsQueryProfile = lockedProfile === "SAMPLE_VALUE_OR_CLASS"
      ? descriptor.valueSemantics.kind === "NUMBER"
        ? "SAMPLE_VALUE"
        : descriptor.valueSemantics.kind === "CLASS_CODE"
          ? "SAMPLE_CLASS"
          : fail("GDPS_DYNAMIC_SAMPLE_VALUE_SEMANTICS_UNSUPPORTED")
      : lockedProfile;
    if (!descriptor.queryProfiles.includes(queryProfile)) fail("GDPS_DESCRIPTOR_QUERY_PROFILE_UNSUPPORTED");
    const decoderPattern = binding.decoderPattern === "QUALIFIED_EXPLANATION"
      ? "QUALIFIED_EXPLANATION"
      : queryProfile;
    const vocabulary = descriptor.vocabularyRef === null
      ? undefined
      : state.vocabularies[descriptor.vocabularyRef];
    projection = {
      closureHash: state.closureHash,
      authorityKind: "DESCRIPTOR",
      operationId,
      operationVersion,
      inputSchemaUri: operation.inputSchemaUri,
      inputSchemaHash: operation.inputSchemaHash,
      outputSchemaUri: operation.outputSchemaUri,
      outputSchemaHash: operation.outputSchemaHash,
      semanticProfile: operation.semanticProfile,
      semanticProfileHash: operation.semanticProfileHash,
      semanticConcept,
      querySemantics: querySemanticsByProfile[queryProfile],
      queryProfile,
      decoderPattern,
      gateway: state.gateway,
      provider: state.provider,
      descriptor: {
        descriptorId,
        descriptorHash,
        registryHash: state.registryHash,
        vocabularyRegistryHash: state.vocabularyRegistryHash,
        productType: descriptor.productType,
        productProfile: descriptor.productProfile,
        representation: descriptor.representation,
        valueSemanticsKind: descriptor.valueSemantics.kind,
        unit: descriptor.valueSemantics.unit,
        ...(vocabulary === undefined ? {} : { allowedClassCodes: [...vocabulary] })
      }
    };
  }
  const token = freeze({
    closureHash: state.closureHash,
    operationId,
    operationVersion,
    authorityKind: projection.authorityKind
  });
  operationAuthorities.set(token, freeze(structuredClone(projection)));
  return token;
}

export function readGdpsFindingOperationAuthority(
  authority: GdpsFindingOperationAuthority
): GdpsFindingOperationProjection {
  if (authority === null || typeof authority !== "object") fail("GDPS_FINDING_OPERATION_AUTHORITY_FORGED");
  const projection = operationAuthorities.get(authority);
  if (projection === undefined) fail("GDPS_FINDING_OPERATION_AUTHORITY_FORGED");
  return projection;
}

export function listGdpsFindingClosureOperations(
  authority: GdpsFinalBFindingAuthority
): readonly GdpsFindingContractClosureOperation[] {
  return [...requireFinalAuthority(authority).operations.values()];
}
