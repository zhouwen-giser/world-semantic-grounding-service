import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { WorldSemanticFrame } from "@wsgs/contracts";
import Ajv2020Module from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { canonicalSha256, GdpsDescriptorConsumer } from "./consumer.js";
import { projectGeospatialProductIntent } from "./intent.js";
import type {
  ProductDescriptorRegistry,
  SemanticConceptMap
} from "./types.js";

const conceptMap: SemanticConceptMap = {
  schemaVersion: "wsgs-gdps-semantic-concept-map/1.0",
  operationIdsForbidden: true,
  concepts: [{
    conceptCode: "SLOPE",
    aliases: ["坡度", "slope"],
    descriptorCandidates: ["SLOPE/DEGREE"],
    allowedQuerySemantics: ["READ_VALUE", "READ_PROFILE", "FIND_VALUE_RANGE_AREAS"]
  }, {
    conceptCode: "DRAINAGE_NETWORK",
    aliases: ["排水沟", "drainage"],
    descriptorCandidates: ["DRAINAGE_NETWORK/DRAINAGE_FEATURES"],
    allowedQuerySemantics: ["FIND_FEATURES_IN_AREA", "FIND_FEATURES_NEARBY", "FIND_INTERSECTIONS"]
  }, {
    conceptCode: "ROAD_SOURCE",
    aliases: ["道路", "road"],
    descriptorCandidates: ["ROAD_SOURCE/ROAD_FEATURES"],
    allowedQuerySemantics: ["FIND_FEATURES_IN_AREA", "FIND_FEATURES_NEARBY", "FIND_INTERSECTIONS"]
  }]
};

function frameFor(
  originalText: string,
  surfaceText: string,
  values: Partial<WorldSemanticFrame> = {}
): WorldSemanticFrame {
  const start = originalText.indexOf(surfaceText);
  if (start < 0) throw new Error("TEST_MENTION_NOT_IN_SOURCE");
  return {
    schemaVersion: "1.0",
    mentions: [{
      mentionId: "source-mention",
      surfaceText,
      span: { encoding: "UTF16_CODE_UNIT", start, end: start + surfaceText.length },
      expectedKinds: ["LAYER_FEATURE"]
    }],
    spatialExpressions: [],
    relationExpressions: [],
    temporalConstraints: [],
    aggregationExpressions: [],
    rankingExpressions: [],
    ...values
  };
}

describe("projectGeospatialProductIntent source authority", () => {
  it.each([
    ["滨河路附近500米有哪些排水沟？", 500],
    ["滨河路附近1公里有哪些排水沟？", 1_000]
  ] as const)("anchors the distance in %s to the source as %d metres", (originalText, expectedDistanceM) => {
    const frame = frameFor(originalText, "滨河路", {
      spatialExpressions: [{
        expressionId: "model-near",
        operator: "NEAR",
        arguments: ["source-mention"],
        approximate: false,
        distanceM: 9_999
      }]
    });

    expect(projectGeospatialProductIntent({ frame, originalText, conceptMap })).toMatchObject({
      spatialConstraint: { relation: "NEAR", distanceM: expectedDistanceM }
    });
  });

  it("rejects a model-injected distance when no distance occurs in source text", () => {
    const originalText = "滨河路附近有哪些排水沟？";
    const frame = frameFor(originalText, "滨河路", {
      spatialExpressions: [{
        expressionId: "model-near",
        operator: "NEAR",
        arguments: ["source-mention"],
        approximate: false,
        distanceM: 9_999
      }]
    });

    const projected = projectGeospatialProductIntent({ frame, originalText, conceptMap });
    expect(projected).toMatchObject({ spatialConstraint: { relation: "NEAR" } });
    expect(projected?.spatialConstraint).not.toHaveProperty("distanceM");
  });

  it("projects a source-anchored road intersection onto the locked ROAD_SOURCE concept", () => {
    const originalText = "查找与滨河路东段相交的道路要素。";
    const frame = frameFor(originalText, "滨河路东段", {
      spatialExpressions: [{
        expressionId: "intersects",
        operator: "INTERSECTS",
        arguments: ["source-mention"],
        approximate: false
      }]
    });

    expect(projectGeospatialProductIntent({ frame, originalText, conceptMap })).toMatchObject({
      targetConcept: "ROAD_SOURCE",
      querySemantics: "FIND_INTERSECTIONS",
      spatialConstraint: { relation: "INTERSECTS" }
    });
  });

  it("accepts an explicit product only when the product id is anchored in source text", () => {
    const anchoredText = "使用 gdps-baseline-slope 数据查询A区坡度。";
    expect(projectGeospatialProductIntent({
      frame: frameFor(anchoredText, "A区"),
      originalText: anchoredText,
      conceptMap
    })).toMatchObject({ explicitProductPreference: "gdps-baseline-slope" });

    const unanchoredText = "查询A区坡度。";
    const modelInjected = frameFor(unanchoredText, "A区", {
      relationExpressions: [{
        expressionId: "model-product",
        relationType: "EXPLICIT_PRODUCT_PREFERENCE:model-only",
        subjectMentionId: "source-mention"
      }]
    });
    expect(projectGeospatialProductIntent({
      frame: modelInjected,
      originalText: unanchoredText,
      conceptMap
    })).not.toHaveProperty("explicitProductPreference");
  });

  it("fails closed when a mention span is not an exact UTF-16 source slice", () => {
    const originalText = "A区坡度是多少？";
    const frame = frameFor(originalText, "A区");
    frame.mentions[0] = {
      ...frame.mentions[0]!,
      span: { encoding: "UTF16_CODE_UNIT", start: 1, end: 3 }
    };

    expect(projectGeospatialProductIntent({ frame, originalText, conceptMap })).toBeNull();
  });

  it("validates actual projected and grounded intents against the frozen schemas", () => {
    const originalText = "A区内坡度15到30度的区域有哪些？";
    const projected = projectGeospatialProductIntent({
      frame: frameFor(originalText, "A区", {
        spatialExpressions: [{
          expressionId: "within",
          operator: "WITHIN",
          arguments: ["source-mention"],
          approximate: false
        }]
      }),
      originalText,
      conceptMap
    });
    expect(projected).not.toBeNull();

    const registry: ProductDescriptorRegistry = {
      schemaVersion: "gdps-product-type-descriptors/1.0",
      categories: ["BASE_TERRAIN"],
      representations: ["RASTER_CONTINUOUS"],
      queryProfiles: ["SAMPLE_VALUE", "PROFILE_VALUE", "FIND_VALUE_RANGE"],
      descriptors: [{
        descriptorId: "SLOPE/DEGREE",
        productType: "SLOPE",
        productProfile: "DEGREE",
        category: "BASE_TERRAIN",
        representation: "RASTER_CONTINUOUS",
        storageKinds: ["RASTER_FILE"],
        valueSemantics: { kind: "NUMBER", unit: "degree", validRange: { minimum: 0, maximum: 90 } },
        vocabularyRef: null,
        requiredProperties: [],
        filterableProperties: [],
        queryProfiles: ["SAMPLE_VALUE", "PROFILE_VALUE", "FIND_VALUE_RANGE"],
        platformProfilePolicy: "OPTIONAL",
        qualityFields: ["completeness"],
        gowmSemanticHints: { domain: "SPATIAL" }
      }]
    };
    const grounded = new GdpsDescriptorConsumer({
      registry,
      expectedRegistryHash: canonicalSha256(registry),
      conceptMap,
      vocabularies: { schemaVersion: "gdps-vocabularies/1.0", vocabularies: {} }
    }).resolve(projected!).intent;
    expect(grounded).toBeDefined();

    const schemaRoot = new URL("../../../contracts/wsgs-v0.2-gdps/contracts/", import.meta.url);
    const intentSchema = JSON.parse(readFileSync(fileURLToPath(new URL(
      "geospatial-product-intent.schema.json", schemaRoot
    )), "utf8")) as Record<string, unknown>;
    const groundedSchema = JSON.parse(readFileSync(fileURLToPath(new URL(
      "grounded-geospatial-product-intent.schema.json", schemaRoot
    )), "utf8")) as Record<string, unknown>;
    const ajv = new Ajv2020Module.default({ allErrors: true, strict: true, strictRequired: false });
    const validateIntent = ajv.compile(intentSchema);
    const validateGrounded = ajv.compile(groundedSchema);

    expect(validateIntent(projected), ajv.errorsText(validateIntent.errors)).toBe(true);
    expect(validateGrounded(grounded), ajv.errorsText(validateGrounded.errors)).toBe(true);
  });
});
