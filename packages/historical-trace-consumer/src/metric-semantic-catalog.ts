import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020Module from "ajv/dist/2020.js";
import { analysisHash, type MetricSelector } from "@wsgs/gowm-contract-intake";

export interface MetricConcept {
  conceptId: string; aliases: string[]; observedProperty: string; valueUnit?: string;
  measurementStage: "NORMALIZED" | "PARSED_NATIVE" | "FUSED_DERIVED";
  bestDirection: "MAXIMIZE" | "MINIMIZE";
  validValueRange?: { minimum?: number; maximum?: number };
}
export interface MetricCatalogDocument { schemaVersion: "1.0"; catalogId: string; catalogVersion: string; concepts: MetricConcept[] }
export class MetricSemanticCatalog {
  readonly document: MetricCatalogDocument;
  readonly hash: `sha256:${string}`;
  constructor(value: unknown = JSON.parse(readFileSync(fileURLToPath(new URL("../../../config/advanced-history-metric-catalog.json", import.meta.url)), "utf8"))) {
    const schema = JSON.parse(readFileSync(fileURLToPath(new URL("../../../config/advanced-history-metric-catalog.schema.json", import.meta.url)), "utf8")) as Record<string, unknown>;
    const ajv = new Ajv2020Module.default({ strict: true });
    if (!ajv.compile(schema)(value)) throw new Error("METRIC_CATALOG_INVALID");
    this.document = structuredClone(value) as MetricCatalogDocument;
    const ids = new Set<string>();
    const aliases = new Set<string>();
    for (const concept of this.document.concepts) {
      if (ids.has(concept.conceptId)) throw new Error("METRIC_CATALOG_DUPLICATE_CONCEPT");
      ids.add(concept.conceptId);
      for (const alias of concept.aliases) {
        if (!alias.trim() || aliases.has(alias.toLowerCase())) throw new Error("METRIC_CATALOG_ALIAS_CONFLICT");
        aliases.add(alias.toLowerCase());
      }
      const range = concept.validValueRange;
      if (range?.minimum !== undefined && range.maximum !== undefined && range.minimum > range.maximum) throw new Error("METRIC_CATALOG_RANGE_INVALID");
      Object.freeze(concept.aliases);
      if (range) Object.freeze(range);
      Object.freeze(concept);
    }
    Object.freeze(this.document.concepts); Object.freeze(this.document);
    this.hash = analysisHash(this.document);
  }
  resolve(text: string): { concept: MetricConcept; selector: MetricSelector } | { reasonCode: "METRIC_CONCEPT_UNSUPPORTED" | "METRIC_CONCEPT_AMBIGUOUS" } {
    const matched = this.document.concepts.filter(concept => concept.aliases.some(alias => text.toLowerCase().includes(alias.toLowerCase())));
    if (matched.length !== 1) return { reasonCode: matched.length ? "METRIC_CONCEPT_AMBIGUOUS" : "METRIC_CONCEPT_UNSUPPORTED" };
    const concept = matched[0]!;
    return { concept, selector: {
      observedProperty: concept.observedProperty, measurementStage: concept.measurementStage,
      optimizationDirection: /最高|最大/u.test(text) ? "MAXIMIZE" : /最低|最小/u.test(text) ? "MINIMIZE" : concept.bestDirection,
      ...(concept.valueUnit ? { valueUnit: concept.valueUnit } : {}),
      ...(concept.validValueRange ? { validValueRange: { ...concept.validValueRange } } : {})
    } };
  }
  static load(path?: string): MetricSemanticCatalog {
    return path ? new MetricSemanticCatalog(JSON.parse(readFileSync(path, "utf8"))) : new MetricSemanticCatalog();
  }
}
