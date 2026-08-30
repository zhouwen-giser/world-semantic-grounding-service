import type { WorldSemanticFrame } from "@wsgs/contracts";

export type GdpsRepresentation = "RASTER_CONTINUOUS" | "RASTER_CATEGORICAL" | "VECTOR_FEATURE";
export type GdpsQueryProfile =
  | "SAMPLE_VALUE" | "PROFILE_VALUE" | "FIND_VALUE_RANGE"
  | "SAMPLE_CLASS" | "FIND_CLASS"
  | "VECTOR_IN_AREA" | "VECTOR_NEARBY" | "VECTOR_INTERSECTS";
export type ProductQuerySemantics =
  | "READ_VALUE" | "READ_PROFILE" | "FIND_CLASS_AREAS" | "FIND_VALUE_RANGE_AREAS"
  | "FIND_FEATURES_IN_AREA" | "FIND_FEATURES_NEARBY" | "FIND_INTERSECTIONS";

export interface NumericRange {
  minimum?: number;
  maximum?: number;
  minimumInclusive?: boolean;
  maximumInclusive?: boolean;
}

export interface GeospatialProductSemanticIntent {
  schemaVersion: "wsgs-geospatial-product-intent/1.0";
  intentId: string;
  targetConcept: string;
  querySemantics: ProductQuerySemantics;
  subjectMentionIds: string[];
  classSemantics?: string[];
  numericConstraint?: { ranges: readonly NumericRange[]; unit?: string } | undefined;
  spatialConstraint?: { relation: "AT" | "WITHIN" | "NEAR" | "INTERSECTS"; distanceM?: number };
  explicitProductPreference?: string;
  platformProfile?: string;
  propertyFilters?: Record<string, unknown>;
  sourceNodeIds?: string[];
  sourceSpans?: Array<{
    sourceNodeId: string;
    encoding: "UTF16_CODE_UNIT";
    start: number;
    end: number;
  }>;
}

export interface ProductTypeDescriptor {
  descriptorId: string;
  productType: string;
  productProfile: string;
  category: string;
  representation: GdpsRepresentation;
  storageKinds: string[];
  valueSemantics: {
    kind: "NUMBER" | "CLASS_CODE" | "FEATURE";
    unit: string | null;
    validRange: { minimum?: number; maximum?: number; circular?: boolean } | null;
  };
  vocabularyRef: string | null;
  requiredProperties: string[];
  filterableProperties: string[];
  queryProfiles: GdpsQueryProfile[];
  platformProfilePolicy: "OPTIONAL" | "REQUIRED" | "FORBIDDEN";
  qualityFields: string[];
  gowmSemanticHints: Record<string, unknown>;
}

export interface ProductDescriptorRegistry {
  schemaVersion: "gdps-product-type-descriptors/1.0";
  categories: string[];
  representations: GdpsRepresentation[];
  queryProfiles: GdpsQueryProfile[];
  descriptors: ProductTypeDescriptor[];
}

export interface ProductVocabularyRegistry {
  schemaVersion: string;
  vocabularies: Record<string, readonly string[]>;
}

export interface SemanticConceptEntry {
  conceptCode: string;
  aliases: string[];
  descriptorCandidates: string[];
  allowedQuerySemantics: ProductQuerySemantics[];
}

export interface SemanticConceptMap {
  schemaVersion: string;
  operationIdsForbidden: true;
  concepts: SemanticConceptEntry[];
}

export interface GroundedGeospatialProductIntent {
  schemaVersion: "wsgs-grounded-geospatial-product-intent/1.0";
  intentId: string;
  descriptorId: string;
  descriptorHash: `sha256:${string}`;
  productType: string;
  productProfile: string;
  representation: GdpsRepresentation;
  queryProfile: GdpsQueryProfile;
  explicitProductId?: string;
  classCodes?: string[];
  ranges?: readonly NumericRange[];
  propertyFilters?: Record<string, unknown>;
  platformProfile?: string;
  spatialConstraint?: GeospatialProductSemanticIntent["spatialConstraint"];
  sourceNodeIds: string[];
  sourceSpans?: GeospatialProductSemanticIntent["sourceSpans"];
}

export type DescriptorResolutionStatus =
  | "MATCHED" | "AMBIGUOUS" | "DESCRIPTOR_NOT_FOUND" | "QUERY_PROFILE_UNSUPPORTED"
  | "CLASS_CODE_UNSUPPORTED" | "VALUE_RANGE_INVALID" | "UNIT_MISMATCH"
  | "PROPERTY_FILTER_UNSUPPORTED" | "PLATFORM_PROFILE_REQUIRED"
  | "PLATFORM_PROFILE_FORBIDDEN" | "DESCRIPTOR_LOCK_DRIFT";

export interface DescriptorResolutionEvidence {
  registryHash: `sha256:${string}`;
  descriptorHash?: `sha256:${string}`;
  conceptCode: string;
  querySemantics: ProductQuerySemantics;
  queryProfile?: GdpsQueryProfile;
  checks: string[];
  resolutionHash: `sha256:${string}`;
}

export interface DescriptorResolution {
  schemaVersion: "wsgs-gdps-descriptor-resolution/1.0";
  status: DescriptorResolutionStatus;
  intent?: GroundedGeospatialProductIntent;
  candidateDescriptorIds?: string[];
  evidence: DescriptorResolutionEvidence;
}

export interface DescriptorConsumerOptions {
  registry: ProductDescriptorRegistry;
  expectedRegistryHash: `sha256:${string}`;
  conceptMap: SemanticConceptMap;
  vocabularies: ProductVocabularyRegistry;
  expectedProductTypeCount?: number;
  expectedDescriptorProfileCount?: number;
  recipes?: readonly DescriptorRecipeBinding[];
}

export interface DescriptorRecipeBinding {
  schemaVersion: "wsgs-locked-gdps-recipe/2.0";
  recipeId: string;
  semanticPattern: string;
  requirementType: string;
  descriptorConstraint: { descriptorId: string; descriptorHash: `sha256:${string}` } | null;
  queryProfile: string | null;
  productIdPolicy: "UNBOUND_UNLESS_EXPLICIT" | "FORBIDDEN" | "REQUIRED";
  previewAuthorizationRequired: true;
}

export type DescriptorRecipeLookupStatus = "MATCHED" | "RECIPE_NOT_FOUND" | "AMBIGUOUS_RECIPE";

export interface DescriptorRecipeLookup {
  status: DescriptorRecipeLookupStatus;
  recipe?: DescriptorRecipeBinding;
  candidateRecipeIds: string[];
  evidence: {
    descriptorId: string;
    descriptorHash: `sha256:${string}`;
    queryProfile: GdpsQueryProfile;
    semanticPattern: string | null;
    checks: string[];
    lookupHash: `sha256:${string}`;
  };
}

export interface ProductIntentProjectionInput {
  frame: WorldSemanticFrame;
  originalText: string;
  conceptMap: SemanticConceptMap;
}
