import { createHash } from "node:crypto";

import type {
  DescriptorConsumerOptions,
  DescriptorRecipeLookup,
  DescriptorResolution,
  DescriptorResolutionEvidence,
  GdpsQueryProfile,
  GeospatialProductSemanticIntent,
  GroundedGeospatialProductIntent,
  NumericRange,
  ProductTypeDescriptor
} from "./types.js";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const identifierPattern = /^[A-Z][A-Z0-9_]{1,127}$/u;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function canonicalSha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function requestedProfile(intent: GeospatialProductSemanticIntent, descriptor: ProductTypeDescriptor): GdpsQueryProfile {
  switch (intent.querySemantics) {
    case "READ_VALUE": return descriptor.representation === "RASTER_CATEGORICAL" ? "SAMPLE_CLASS" : "SAMPLE_VALUE";
    case "READ_PROFILE": return "PROFILE_VALUE";
    case "FIND_CLASS_AREAS": return "FIND_CLASS";
    case "FIND_VALUE_RANGE_AREAS": return "FIND_VALUE_RANGE";
    case "FIND_FEATURES_IN_AREA": return "VECTOR_IN_AREA";
    case "FIND_FEATURES_NEARBY": return "VECTOR_NEARBY";
    case "FIND_INTERSECTIONS": return "VECTOR_INTERSECTS";
  }
}

function rangesValid(ranges: readonly NumericRange[], descriptor: ProductTypeDescriptor): boolean {
  if (ranges.length === 0) return false;
  const permitted = descriptor.valueSemantics.validRange;
  return ranges.every((range) => {
    const values = [range.minimum, range.maximum].filter((value): value is number => value !== undefined);
    if (values.length === 0 || values.some((value) => !Number.isFinite(value))) return false;
    if (range.minimum !== undefined && range.maximum !== undefined && range.minimum > range.maximum) return false;
    if (permitted?.minimum !== undefined && values.some((value) => value < permitted.minimum!)) return false;
    if (permitted?.maximum !== undefined && values.some((value) => value > permitted.maximum!)) return false;
    return true;
  });
}

export class GdpsDescriptorConsumer {
  readonly registryHash: `sha256:${string}`;
  private readonly descriptorById: Map<string, ProductTypeDescriptor>;

  constructor(private readonly options: DescriptorConsumerOptions) {
    this.registryHash = canonicalSha256(options.registry);
    if (!digestPattern.test(options.expectedRegistryHash) || this.registryHash !== options.expectedRegistryHash) {
      this.descriptorById = new Map();
      return;
    }
    if (options.registry.schemaVersion !== "gdps-product-type-descriptors/1.0") {
      throw new Error("GDPS_DESCRIPTOR_REGISTRY_SCHEMA_UNSUPPORTED");
    }
    const ids = options.registry.descriptors.map((entry) => entry.descriptorId);
    if (!unique(ids)) throw new Error("GDPS_DESCRIPTOR_ID_DUPLICATE");
    const productTypes = new Set(options.registry.descriptors.map((entry) => entry.productType));
    if (options.expectedProductTypeCount !== undefined && productTypes.size !== options.expectedProductTypeCount) {
      throw new Error("GDPS_PRODUCT_TYPE_COUNT_MISMATCH");
    }
    if (options.expectedDescriptorProfileCount !== undefined && ids.length !== options.expectedDescriptorProfileCount) {
      throw new Error("GDPS_DESCRIPTOR_PROFILE_COUNT_MISMATCH");
    }
    this.descriptorById = new Map(options.registry.descriptors.map((entry) => [entry.descriptorId, structuredClone(entry)]));
  }

  private result(
    status: DescriptorResolution["status"],
    intent: GeospatialProductSemanticIntent,
    evidence: Omit<DescriptorResolutionEvidence, "registryHash" | "conceptCode" | "querySemantics" | "resolutionHash">,
    candidateDescriptorIds?: string[],
    grounded?: GroundedGeospatialProductIntent
  ): DescriptorResolution {
    const evidenceCore = {
      registryHash: this.registryHash,
      conceptCode: intent.targetConcept,
      querySemantics: intent.querySemantics,
      ...evidence
    };
    return {
      schemaVersion: "wsgs-gdps-descriptor-resolution/1.0",
      status,
      ...(grounded ? { intent: grounded } : {}),
      ...(candidateDescriptorIds ? { candidateDescriptorIds: [...candidateDescriptorIds].sort() } : {}),
      evidence: {
        ...evidenceCore,
        resolutionHash: canonicalSha256({ status, intent: grounded ?? null, candidateDescriptorIds: candidateDescriptorIds ?? [], evidence: evidenceCore })
      }
    };
  }

  lookupRecipe(intent: GroundedGeospatialProductIntent, semanticPattern?: string): DescriptorRecipeLookup {
    const recipes = this.options.recipes ?? [];
    const profileMatches = (locked: string | null): boolean => locked === intent.queryProfile ||
      (locked === "SAMPLE_VALUE_OR_CLASS" && ["SAMPLE_VALUE", "SAMPLE_CLASS"].includes(intent.queryProfile));
    const policyValid = (entry: (typeof recipes)[number]): boolean =>
      entry.schemaVersion === "wsgs-locked-gdps-recipe/2.0" && entry.previewAuthorizationRequired === true &&
      entry.productIdPolicy === "UNBOUND_UNLESS_EXPLICIT";
    const descriptorMatches = (entry: (typeof recipes)[number]): boolean => entry.descriptorConstraint === null ||
      (entry.descriptorConstraint.descriptorId === intent.descriptorId &&
        entry.descriptorConstraint.descriptorHash === intent.descriptorHash);
    let candidates = recipes.filter((entry) => policyValid(entry) && descriptorMatches(entry) &&
      (semanticPattern ? entry.semanticPattern === semanticPattern : true) &&
      (entry.queryProfile === null ? Boolean(semanticPattern) : profileMatches(entry.queryProfile)));
    const specialized = candidates.filter((entry) => entry.descriptorConstraint !== null);
    if (specialized.length > 0) candidates = specialized;
    candidates = [...candidates].sort((left, right) => left.recipeId.localeCompare(right.recipeId));
    const status = candidates.length === 1 ? "MATCHED" : candidates.length === 0 ? "RECIPE_NOT_FOUND" : "AMBIGUOUS_RECIPE";
    const evidenceCore = {
      descriptorId: intent.descriptorId,
      descriptorHash: intent.descriptorHash,
      queryProfile: intent.queryProfile,
      semanticPattern: semanticPattern ?? null,
      checks: ["DESCRIPTOR_EXACT", "QUERY_PROFILE_EXACT", "RECIPE_POLICY_EXACT"]
    } as const;
    return {
      status,
      ...(status === "MATCHED" ? { recipe: structuredClone(candidates[0]!) } : {}),
      candidateRecipeIds: candidates.map((entry) => entry.recipeId),
      evidence: {
        ...evidenceCore,
        checks: [...evidenceCore.checks],
        lookupHash: canonicalSha256({ status, candidateRecipeIds: candidates.map((entry) => entry.recipeId), ...evidenceCore })
      }
    };
  }

  resolve(intent: GeospatialProductSemanticIntent): DescriptorResolution {
    if (this.registryHash !== this.options.expectedRegistryHash || this.descriptorById.size === 0) {
      return this.result("DESCRIPTOR_LOCK_DRIFT", intent, { checks: ["REGISTRY_HASH_MISMATCH"] });
    }
    if (!identifierPattern.test(intent.targetConcept) || intent.subjectMentionIds.length === 0) {
      return this.result("DESCRIPTOR_NOT_FOUND", intent, { checks: ["INTENT_INVALID"] });
    }
    const concept = this.options.conceptMap.concepts.find((entry) => entry.conceptCode === intent.targetConcept);
    if (!concept) return this.result("DESCRIPTOR_NOT_FOUND", intent, { checks: ["CONCEPT_NOT_MAPPED"] });
    if (!concept.allowedQuerySemantics.includes(intent.querySemantics)) {
      return this.result("QUERY_PROFILE_UNSUPPORTED", intent, { checks: ["SEMANTIC_QUERY_NOT_ALLOWED"] }, concept.descriptorCandidates);
    }
    let candidates = concept.descriptorCandidates.flatMap((id) => {
      const descriptor = this.descriptorById.get(id);
      return descriptor ? [descriptor] : [];
    });
    if (intent.explicitProductPreference?.includes("/")) {
      candidates = candidates.filter((descriptor) => descriptor.descriptorId === intent.explicitProductPreference);
    }
    if (candidates.length === 0) {
      return this.result("DESCRIPTOR_NOT_FOUND", intent, { checks: ["DESCRIPTOR_CANDIDATE_NOT_IN_LOCK"] }, concept.descriptorCandidates);
    }
    if (candidates.length > 1) {
      return this.result("AMBIGUOUS", intent, { checks: ["MULTIPLE_LOCKED_DESCRIPTORS"] }, candidates.map((entry) => entry.descriptorId));
    }
    const descriptor = candidates[0]!;
    const queryProfile = requestedProfile(intent, descriptor);
    const baseEvidence = {
      descriptorHash: canonicalSha256(descriptor),
      queryProfile,
      checks: ["REGISTRY_HASH", "DESCRIPTOR_PRESENT", "QUERY_SEMANTICS"]
    } satisfies Omit<DescriptorResolutionEvidence, "registryHash" | "conceptCode" | "querySemantics" | "resolutionHash">;
    if (!descriptor.queryProfiles.includes(queryProfile)) {
      return this.result("QUERY_PROFILE_UNSUPPORTED", intent, baseEvidence, [descriptor.descriptorId]);
    }
    if (intent.numericConstraint) {
      if (descriptor.valueSemantics.kind !== "NUMBER" || !rangesValid(intent.numericConstraint.ranges, descriptor)) {
        return this.result("VALUE_RANGE_INVALID", intent, baseEvidence, [descriptor.descriptorId]);
      }
      if (intent.numericConstraint.unit !== undefined && intent.numericConstraint.unit !== descriptor.valueSemantics.unit) {
        return this.result("UNIT_MISMATCH", intent, baseEvidence, [descriptor.descriptorId]);
      }
    }
    if (intent.classSemantics?.length) {
      const allowed = descriptor.vocabularyRef ? this.options.vocabularies.vocabularies[descriptor.vocabularyRef] : undefined;
      if (!allowed || intent.classSemantics.some((code) => !allowed.includes(code))) {
        return this.result("CLASS_CODE_UNSUPPORTED", intent, baseEvidence, [descriptor.descriptorId]);
      }
    }
    if (intent.propertyFilters) {
      const keys = Object.keys(intent.propertyFilters);
      if (keys.some((key) => !descriptor.filterableProperties.includes(key))) {
        return this.result("PROPERTY_FILTER_UNSUPPORTED", intent, baseEvidence, [descriptor.descriptorId]);
      }
    }
    if (descriptor.platformProfilePolicy === "REQUIRED" && !intent.platformProfile) {
      return this.result("PLATFORM_PROFILE_REQUIRED", intent, baseEvidence, [descriptor.descriptorId]);
    }
    if (descriptor.platformProfilePolicy === "FORBIDDEN" && intent.platformProfile) {
      return this.result("PLATFORM_PROFILE_FORBIDDEN", intent, baseEvidence, [descriptor.descriptorId]);
    }
    const grounded: GroundedGeospatialProductIntent = {
      schemaVersion: "wsgs-grounded-geospatial-product-intent/1.0",
      intentId: intent.intentId,
      descriptorId: descriptor.descriptorId,
      descriptorHash: baseEvidence.descriptorHash,
      productType: descriptor.productType,
      productProfile: descriptor.productProfile,
      representation: descriptor.representation,
      queryProfile,
      ...(intent.explicitProductPreference ? { explicitProductId: intent.explicitProductPreference } : {}),
      ...(intent.classSemantics ? { classCodes: [...intent.classSemantics] } : {}),
      ...(intent.numericConstraint ? { ranges: structuredClone(intent.numericConstraint.ranges) } : {}),
      ...(intent.propertyFilters ? { propertyFilters: structuredClone(intent.propertyFilters) } : {}),
      ...(intent.platformProfile ? { platformProfile: intent.platformProfile } : {}),
      ...(intent.spatialConstraint ? { spatialConstraint: structuredClone(intent.spatialConstraint) } : {}),
      sourceNodeIds: [...new Set(intent.sourceNodeIds ?? intent.subjectMentionIds)].sort(),
      ...(intent.sourceSpans ? { sourceSpans: structuredClone(intent.sourceSpans) } : {})
    };
    return this.result("MATCHED", intent, {
      ...baseEvidence,
      checks: [...baseEvidence.checks, "VALUE_CONSTRAINTS", "VOCABULARY", "FILTERS", "PLATFORM_POLICY"]
    }, [descriptor.descriptorId], grounded);
  }
}
