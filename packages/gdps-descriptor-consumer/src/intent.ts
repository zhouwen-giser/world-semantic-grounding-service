import { createHash } from "node:crypto";

import type {
  GeospatialProductSemanticIntent,
  ProductIntentProjectionInput,
  ProductQuerySemantics,
  SemanticConceptEntry
} from "./types.js";

function id(value: unknown): string {
  return `gdps-intent-${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex").slice(0, 24)}`;
}

function conceptFor(text: string, concepts: readonly SemanticConceptEntry[]): SemanticConceptEntry | undefined {
  return concepts.find((concept) => concept.aliases.some((alias) => text.toLocaleLowerCase().includes(alias.toLocaleLowerCase()))) ??
    (/(?:洪水|淹没).*风险/iu.test(text) ? concepts.find((concept) => concept.conceptCode === "FLOOD_RISK") : undefined);
}

function normalizedUnit(rawUnit: string | undefined): string | undefined {
  return rawUnit === undefined ? undefined
    : /^(?:度|degrees?)$/iu.test(rawUnit) ? "degree"
    : /^(?:米|metres?|meters?|m)$/iu.test(rawUnit) ? "metre"
    : /^dBm$/iu.test(rawUnit) ? "dBm" : "score";
}

function numeric(text: string): GeospatialProductSemanticIntent["numericConstraint"] | undefined {
  const range = /(?<minimum>-?\d+(?:\.\d+)?)\s*(?:到|至|[-~～])\s*(?<maximum>-?\d+(?:\.\d+)?)\s*(?<unit>度|degrees?|米|metres?|meters?|m\b|dBm|分(?:数)?|score)?/iu.exec(text);
  if (range?.groups) {
    const unit = normalizedUnit(range.groups["unit"]);
    return {
      ranges: [{ minimum: Number(range.groups["minimum"]), maximum: Number(range.groups["maximum"]), minimumInclusive: true, maximumInclusive: true }],
      ...(unit ? { unit } : {})
    };
  }
  const comparison = /(?<operator>大于|高于|超过|不少于|至少|小于|低于|少于|不高于|至多|>=|<=|>|<|greater\s+than|less\s+than|at\s+least|at\s+most)\s*(?<value>-?\d+(?:\.\d+)?)\s*(?<unit>度|degrees?|米|metres?|meters?|m\b|dBm|分(?:数)?|score)?/iu.exec(text);
  if (comparison?.groups) {
    const operator = comparison.groups["operator"]!.toLocaleLowerCase();
    const value = Number(comparison.groups["value"]);
    const unit = normalizedUnit(comparison.groups["unit"]);
    const lower = /^(?:大于|高于|超过|不少于|至少|>|>=|greater\s+than|at\s+least)$/iu.test(operator);
    const inclusive = /^(?:不少于|至少|>=|不高于|至多|<=|at\s+least|at\s+most)$/iu.test(operator);
    return {
      ranges: [lower
        ? { minimum: value, minimumInclusive: inclusive }
        : { maximum: value, maximumInclusive: inclusive }],
      ...(unit ? { unit } : {})
    };
  }
  return undefined;
}

function querySemantics(text: string, concept: SemanticConceptEntry, hasNumeric: boolean): ProductQuerySemantics {
  const allowed = new Set(concept.allowedQuerySemantics);
  const near = /(?:附近|周边|nearby|near\b)/iu.test(text);
  const intersects = /(?:相交|穿过|intersects?)/iu.test(text);
  const inArea = /(?:内|区域|范围|in\s+(?:the\s+)?area)/iu.test(text);
  const profile = /(?:剖面|沿线|profile)/iu.test(text);
  if (intersects && allowed.has("FIND_INTERSECTIONS")) return "FIND_INTERSECTIONS";
  if (near && allowed.has("FIND_FEATURES_NEARBY")) return "FIND_FEATURES_NEARBY";
  if (inArea && allowed.has("FIND_FEATURES_IN_AREA")) return "FIND_FEATURES_IN_AREA";
  if (hasNumeric && allowed.has("FIND_VALUE_RANGE_AREAS")) return "FIND_VALUE_RANGE_AREAS";
  if (profile && allowed.has("READ_PROFILE")) return "READ_PROFILE";
  if (inArea && allowed.has("FIND_CLASS_AREAS")) return "FIND_CLASS_AREAS";
  return allowed.has("READ_VALUE") ? "READ_VALUE" : concept.allowedQuerySemantics[0]!;
}

function classes(text: string, concept: string): string[] | undefined {
  if (concept === "FLOOD_RISK") {
    if (/(?:高风险|high\s+risk)/iu.test(text)) return ["HIGH", "VERY_HIGH"];
    if (/(?:中风险|medium\s+risk)/iu.test(text)) return ["MEDIUM"];
    if (/(?:低风险|low\s+risk)/iu.test(text)) return ["LOW", "VERY_LOW"];
  }
  return undefined;
}

export function projectGeospatialProductIntent(input: ProductIntentProjectionInput): GeospatialProductSemanticIntent | null {
  const concept = conceptFor(input.originalText, input.conceptMap.concepts);
  if (!concept) {
    if (!/(?:风险|risk)/iu.test(input.originalText) || input.frame.mentions.length === 0) return null;
    const mentionIds = input.frame.mentions.map((mention) => mention.mentionId);
    const inArea = /(?:内|区域|范围|in\s+(?:the\s+)?area)/iu.test(input.originalText);
    return {
      schemaVersion: "wsgs-geospatial-product-intent/1.0",
      intentId: id(["UNMAPPED_RISK_PRODUCT", mentionIds]),
      targetConcept: "UNMAPPED_RISK_PRODUCT",
      querySemantics: inArea ? "FIND_CLASS_AREAS" : "READ_VALUE",
      subjectMentionIds: mentionIds,
      spatialConstraint: { relation: inArea ? "WITHIN" : "AT" },
      sourceNodeIds: mentionIds
    };
  }
  const numericConstraint = numeric(input.originalText);
  const semantics = querySemantics(input.originalText, concept, numericConstraint !== undefined);
  const mentionIds = input.frame.mentions.map((mention) => mention.mentionId);
  if (mentionIds.length === 0) return null;
  const near = input.frame.spatialExpressions.find((entry) => entry.operator === "NEAR");
  const within = input.frame.spatialExpressions.find((entry) => entry.operator === "WITHIN" || entry.operator === "CONTAINS");
  const intersects = input.frame.spatialExpressions.find((entry) => entry.operator === "INTERSECTS");
  const product = /(?:使用|采用|use)\s*([a-z][a-z0-9-]{2,63})\s*(?:数据|data)?/iu.exec(input.originalText)?.[1]?.toLowerCase();
  const classSemantics = classes(input.originalText, concept.conceptCode);
  return {
    schemaVersion: "wsgs-geospatial-product-intent/1.0",
    intentId: id([concept.conceptCode, semantics, mentionIds, numericConstraint ?? null, classSemantics ?? null, product ?? null]),
    targetConcept: concept.conceptCode,
    querySemantics: semantics,
    subjectMentionIds: [...mentionIds],
    ...(classSemantics ? { classSemantics } : {}),
    ...(numericConstraint ? { numericConstraint } : {}),
    ...(intersects ? { spatialConstraint: { relation: "INTERSECTS" } } :
      near ? { spatialConstraint: { relation: "NEAR", ...(near.distanceM ? { distanceM: near.distanceM } : {}) } } :
      within ? { spatialConstraint: { relation: "WITHIN" } } : { spatialConstraint: { relation: "AT" } }),
    ...(product ? { explicitProductPreference: product } : {}),
    sourceNodeIds: [...mentionIds]
  };
}
