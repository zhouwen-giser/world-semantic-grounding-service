import { describe, expect, it } from "vitest";
import type { WorldSemanticFrame } from "@wsgs/contracts";

import { canonicalSha256, GdpsDescriptorConsumer } from "./consumer.js";
import { projectGeospatialProductIntent } from "./intent.js";
import type {
  GeospatialProductSemanticIntent,
  ProductDescriptorRegistry,
  SemanticConceptMap
} from "./types.js";

const registry: ProductDescriptorRegistry = {
  schemaVersion: "gdps-product-type-descriptors/1.0",
  categories: ["BASE_TERRAIN", "HYDROLOGY", "MOBILITY"],
  representations: ["RASTER_CONTINUOUS", "RASTER_CATEGORICAL", "VECTOR_FEATURE"],
  queryProfiles: ["SAMPLE_VALUE", "PROFILE_VALUE", "FIND_VALUE_RANGE", "SAMPLE_CLASS", "FIND_CLASS", "VECTOR_IN_AREA", "VECTOR_NEARBY", "VECTOR_INTERSECTS"],
  descriptors: [{
    descriptorId: "SLOPE/DEGREE", productType: "SLOPE", productProfile: "DEGREE", category: "BASE_TERRAIN",
    representation: "RASTER_CONTINUOUS", storageKinds: ["RASTER_FILE"],
    valueSemantics: { kind: "NUMBER", unit: "degree", validRange: { minimum: 0, maximum: 90 } },
    vocabularyRef: null, requiredProperties: [], filterableProperties: [],
    queryProfiles: ["SAMPLE_VALUE", "PROFILE_VALUE", "FIND_VALUE_RANGE"], platformProfilePolicy: "OPTIONAL",
    qualityFields: ["completeness"], gowmSemanticHints: { domain: "SPATIAL" }
  }, {
    descriptorId: "FLOOD_RISK/FLOOD_RISK_CLASS", productType: "FLOOD_RISK", productProfile: "FLOOD_RISK_CLASS", category: "HYDROLOGY",
    representation: "RASTER_CATEGORICAL", storageKinds: ["RASTER_FILE"],
    valueSemantics: { kind: "CLASS_CODE", unit: null, validRange: null },
    vocabularyRef: "FLOOD_RISK_CLASS", requiredProperties: [], filterableProperties: [],
    queryProfiles: ["SAMPLE_CLASS", "FIND_CLASS"], platformProfilePolicy: "OPTIONAL",
    qualityFields: ["completeness"], gowmSemanticHints: { domain: "SPATIAL" }
  }, {
    descriptorId: "DRAINAGE_NETWORK/DRAINAGE_FEATURES", productType: "DRAINAGE_NETWORK", productProfile: "DRAINAGE_FEATURES", category: "HYDROLOGY",
    representation: "VECTOR_FEATURE", storageKinds: ["POSTGIS_VECTOR"],
    valueSemantics: { kind: "FEATURE", unit: null, validRange: null }, vocabularyRef: null,
    requiredProperties: ["drainageType"], filterableProperties: ["drainageType", "conditionClass"],
    queryProfiles: ["VECTOR_IN_AREA", "VECTOR_NEARBY", "VECTOR_INTERSECTS"], platformProfilePolicy: "OPTIONAL",
    qualityFields: ["completeness"], gowmSemanticHints: { domain: "SPATIAL" }
  }, {
    descriptorId: "UGV_TRAVERSABILITY/DEFAULT", productType: "UGV_TRAVERSABILITY", productProfile: "DEFAULT", category: "MOBILITY",
    representation: "RASTER_CATEGORICAL", storageKinds: ["RASTER_FILE"],
    valueSemantics: { kind: "CLASS_CODE", unit: null, validRange: null }, vocabularyRef: "TRAVERSABILITY",
    requiredProperties: [], filterableProperties: [], queryProfiles: ["SAMPLE_CLASS", "FIND_CLASS"],
    platformProfilePolicy: "REQUIRED", qualityFields: [], gowmSemanticHints: { domain: "SPATIAL" }
  }]
};

const conceptMap: SemanticConceptMap = {
  schemaVersion: "wsgs-gdps-semantic-concept-map/1.0",
  operationIdsForbidden: true,
  concepts: [{
    conceptCode: "SLOPE", aliases: ["坡度", "slope"], descriptorCandidates: ["SLOPE/DEGREE"],
    allowedQuerySemantics: ["READ_VALUE", "READ_PROFILE", "FIND_VALUE_RANGE_AREAS"]
  }, {
    conceptCode: "FLOOD_RISK", aliases: ["洪水风险"], descriptorCandidates: ["FLOOD_RISK/FLOOD_RISK_CLASS"],
    allowedQuerySemantics: ["FIND_CLASS_AREAS"]
  }, {
    conceptCode: "DRAINAGE_NETWORK", aliases: ["排水沟"], descriptorCandidates: ["DRAINAGE_NETWORK/DRAINAGE_FEATURES"],
    allowedQuerySemantics: ["FIND_FEATURES_IN_AREA", "FIND_FEATURES_NEARBY", "FIND_INTERSECTIONS"]
  }, {
    conceptCode: "UGV_TRAVERSABILITY", aliases: ["通行性"], descriptorCandidates: ["UGV_TRAVERSABILITY/DEFAULT"],
    allowedQuerySemantics: ["READ_VALUE", "FIND_CLASS_AREAS"]
  }]
};

const options = {
  registry,
  expectedRegistryHash: canonicalSha256(registry),
  conceptMap,
  vocabularies: {
    schemaVersion: "gdps-vocabularies/1.0",
    vocabularies: { FLOOD_RISK_CLASS: ["LOW", "HIGH", "VERY_HIGH"], TRAVERSABILITY: ["PASSABLE"] }
  }
} as const;

const rangeRecipe = {
  schemaVersion: "wsgs-locked-gdps-recipe/2.0",
  recipeId: "recipe-gdps-generic-find-range",
  semanticPattern: "GDPS_GENERIC_FIND_RANGE",
  requirementType: "FIND_GEO_PRODUCT_VALUE_RANGE_AREAS",
  descriptorConstraint: null,
  queryProfile: "FIND_VALUE_RANGE",
  productIdPolicy: "UNBOUND_UNLESS_EXPLICIT",
  previewAuthorizationRequired: true
} as const;

function intent(values: Partial<GeospatialProductSemanticIntent> = {}): GeospatialProductSemanticIntent {
  return {
    schemaVersion: "wsgs-geospatial-product-intent/1.0", intentId: "intent-1", targetConcept: "SLOPE",
    querySemantics: "FIND_VALUE_RANGE_AREAS", subjectMentionIds: ["mention-area"],
    numericConstraint: { ranges: [{ minimum: 15, maximum: 30 }], unit: "degree" },
    sourceNodeIds: ["mention-area"], ...values
  };
}

describe("GdpsDescriptorConsumer", () => {
  it("resolves an exact continuous descriptor without guessing a product id", () => {
    const result = new GdpsDescriptorConsumer(options).resolve(intent());
    expect(result.status).toBe("MATCHED");
    expect(result.intent).toMatchObject({ descriptorId: "SLOPE/DEGREE", queryProfile: "FIND_VALUE_RANGE" });
    expect(result.intent).not.toHaveProperty("explicitProductId");
  });

  it.each([
    [{ numericConstraint: { ranges: [{ minimum: 15, maximum: 30 }], unit: "metre" } }, "UNIT_MISMATCH"],
    [{ numericConstraint: { ranges: [{ minimum: -1, maximum: 30 }], unit: "degree" } }, "VALUE_RANGE_INVALID"],
    [{ targetConcept: "UNKNOWN" }, "DESCRIPTOR_NOT_FOUND"]
  ] as const)("fails closed for %o", (change, status) => {
    expect(new GdpsDescriptorConsumer(options).resolve(intent(change)).status).toBe(status);
  });

  it("validates locked class vocabulary and vector filter properties", () => {
    const consumer = new GdpsDescriptorConsumer(options);
    expect(consumer.resolve(intent({ targetConcept: "FLOOD_RISK", querySemantics: "FIND_CLASS_AREAS", classSemantics: ["HIGH"], numericConstraint: undefined })).status).toBe("MATCHED");
    expect(consumer.resolve(intent({ targetConcept: "FLOOD_RISK", querySemantics: "FIND_CLASS_AREAS", classSemantics: ["EXTREME"], numericConstraint: undefined })).status).toBe("CLASS_CODE_UNSUPPORTED");
    expect(consumer.resolve(intent({ targetConcept: "DRAINAGE_NETWORK", querySemantics: "FIND_FEATURES_IN_AREA", numericConstraint: undefined, propertyFilters: { secretField: true } })).status).toBe("PROPERTY_FILTER_UNSUPPORTED");
  });

  it("enforces platform profile policy and descriptor lock drift", () => {
    const consumer = new GdpsDescriptorConsumer(options);
    expect(consumer.resolve(intent({ targetConcept: "UGV_TRAVERSABILITY", querySemantics: "READ_VALUE", numericConstraint: undefined })).status).toBe("PLATFORM_PROFILE_REQUIRED");
    const drifted = new GdpsDescriptorConsumer({ ...options, expectedRegistryHash: `sha256:${"0".repeat(64)}` });
    expect(drifted.resolve(intent()).status).toBe("DESCRIPTOR_LOCK_DRIFT");
  });

  it("looks up the exact descriptor/query-profile recipe and returns an explicit absence", () => {
    const consumer = new GdpsDescriptorConsumer({ ...options, recipes: [rangeRecipe] });
    const resolved = consumer.resolve(intent());
    expect(resolved.status).toBe("MATCHED");
    expect(resolved.intent).toBeDefined();
    expect(consumer.lookupRecipe(resolved.intent!, "GDPS_GENERIC_FIND_RANGE")).toMatchObject({
      status: "MATCHED",
      recipe: { recipeId: rangeRecipe.recipeId },
      candidateRecipeIds: [rangeRecipe.recipeId]
    });
    expect(consumer.lookupRecipe(resolved.intent!, "GDPS_GENERIC_SAMPLE_VALUE")).toMatchObject({
      status: "RECIPE_NOT_FOUND",
      candidateRecipeIds: []
    });
  });

  it("produces deterministic descriptor and recipe evidence hashes", () => {
    const consumer = new GdpsDescriptorConsumer({ ...options, recipes: [rangeRecipe] });
    const first = consumer.resolve(intent());
    const second = consumer.resolve(structuredClone(intent()));
    expect(first.evidence.resolutionHash).toBe(second.evidence.resolutionHash);
    expect(first.intent).toBeDefined();
    expect(consumer.lookupRecipe(first.intent!, "GDPS_GENERIC_FIND_RANGE").evidence.lookupHash)
      .toBe(consumer.lookupRecipe(first.intent!, "GDPS_GENERIC_FIND_RANGE").evidence.lookupHash);
  });
});

describe("projectGeospatialProductIntent", () => {
  const emptyFrame: WorldSemanticFrame = {
    schemaVersion: "1.0", mentions: [{ mentionId: "area", surfaceText: "A区", span: { encoding: "UTF16_CODE_UNIT", start: 0, end: 2 }, expectedKinds: ["LAYER_FEATURE"] }],
    spatialExpressions: [{ expressionId: "within", operator: "WITHIN", arguments: ["area"], approximate: false }],
    relationExpressions: [], temporalConstraints: [], aggregationExpressions: [], rankingExpressions: []
  };

  it("projects deterministic range and class semantics without provider or operation identifiers", () => {
    const slope = projectGeospatialProductIntent({ frame: emptyFrame, originalText: "A区内坡度15到30度的区域有哪些？", conceptMap });
    expect(slope).toMatchObject({ targetConcept: "SLOPE", querySemantics: "FIND_VALUE_RANGE_AREAS", numericConstraint: { unit: "degree" } });
    const flood = projectGeospatialProductIntent({ frame: emptyFrame, originalText: "A区内有哪些洪水高风险区域？", conceptMap });
    expect(flood).toMatchObject({ targetConcept: "FLOOD_RISK", querySemantics: "FIND_CLASS_AREAS", classSemantics: ["HIGH", "VERY_HIGH"] });
    const invalidUnit = projectGeospatialProductIntent({ frame: emptyFrame, originalText: "A区内坡度大于30米的区域有哪些？", conceptMap });
    expect(invalidUnit).toMatchObject({
      targetConcept: "SLOPE",
      querySemantics: "FIND_VALUE_RANGE_AREAS",
      numericConstraint: { ranges: [{ minimum: 30, minimumInclusive: false }], unit: "metre" }
    });
    const unknownRisk = projectGeospatialProductIntent({ frame: emptyFrame, originalText: "A区内有哪些雪崩风险区域？", conceptMap });
    expect(unknownRisk).toMatchObject({
      targetConcept: "UNMAPPED_RISK_PRODUCT",
      querySemantics: "FIND_CLASS_AREAS"
    });
    expect(new GdpsDescriptorConsumer(options).resolve(unknownRisk!)).toMatchObject({
      status: "DESCRIPTOR_NOT_FOUND"
    });
    expect(JSON.stringify([slope, flood, invalidUnit, unknownRisk])).not.toMatch(/providerId|operationId|geo-raster/u);
  });

  it("anchors 500 metre and one kilometre distances to source text", () => {
    const nearFrame: WorldSemanticFrame = {
      ...emptyFrame,
      mentions: [{
        mentionId: "road", surfaceText: "滨河路",
        span: { encoding: "UTF16_CODE_UNIT", start: 0, end: 3 }, expectedKinds: ["LAYER_FEATURE"]
      }],
      spatialExpressions: [{
        expressionId: "near", operator: "NEAR", arguments: ["road"], approximate: false, distanceM: 9_999
      }]
    };
    expect(projectGeospatialProductIntent({
      frame: nearFrame, originalText: "滨河路附近500米有哪些排水沟？", conceptMap
    })).toMatchObject({ spatialConstraint: { relation: "NEAR", distanceM: 500 } });
    expect(projectGeospatialProductIntent({
      frame: nearFrame, originalText: "滨河路附近1公里有哪些排水沟？", conceptMap
    })).toMatchObject({ spatialConstraint: { relation: "NEAR", distanceM: 1_000 } });
    expect(projectGeospatialProductIntent({
      frame: nearFrame, originalText: "滨河路附近有哪些排水沟？", conceptMap
    })).toMatchObject({ spatialConstraint: { relation: "NEAR" } });
    expect(projectGeospatialProductIntent({
      frame: nearFrame, originalText: "滨河路附近有哪些排水沟？", conceptMap
    })?.spatialConstraint).not.toHaveProperty("distanceM");
  });

  it("rejects an invalid source span and parses an explicit product only from source", () => {
    const invalidFrame: WorldSemanticFrame = {
      ...emptyFrame,
      mentions: [{
        ...emptyFrame.mentions[0]!, span: { encoding: "UTF16_CODE_UNIT", start: 1, end: 3 }
      }]
    };
    expect(projectGeospatialProductIntent({ frame: invalidFrame, originalText: "A区坡度是多少？", conceptMap }))
      .toBeNull();
    const explicitProductText = "使用 gdps-baseline-slope 数据查询A区坡度。";
    const explicitProductFrame: WorldSemanticFrame = {
      ...emptyFrame,
      mentions: [{
        ...emptyFrame.mentions[0]!,
        span: {
          encoding: "UTF16_CODE_UNIT",
          start: explicitProductText.indexOf("A区"),
          end: explicitProductText.indexOf("A区") + 2
        }
      }]
    };
    expect(projectGeospatialProductIntent({
      frame: explicitProductFrame, originalText: explicitProductText, conceptMap
    })).toMatchObject({ explicitProductPreference: "gdps-baseline-slope" });
    expect(projectGeospatialProductIntent({
      frame: emptyFrame, originalText: "A区坡度是多少？", conceptMap
    })).not.toHaveProperty("explicitProductPreference");
  });
});
