/* Generated from the authoritative WSGS v0.2.1 SACS geospatial JSON Schemas. Do not edit directly. */

export interface SACSGeospatialTypedGap10 {
  gapId: string;
  gapKind:
    | "DATA_GAP"
    | "COVERAGE_GAP"
    | "CAPABILITY_GAP"
    | "REFERENCE_AMBIGUITY"
    | "PRODUCT_SELECTION_AMBIGUITY"
    | "SOURCE_CHANGED"
    | "TRUNCATED"
    | "UNSUPPORTED_FINDING_SCHEMA"
    | "EVIDENCE_INCOMPLETE"
    | "UPSTREAM_FAILURE"
    | "CURRENTNESS_UNAVAILABLE";
  severity: "INFO" | "WARNING" | "BLOCKING";
  messageCode: string;
  semanticConcept?: string;
  /**
   * @maxItems 64
   */
  findingIds?: string[];
  /**
   * @maxItems 128
   */
  evidenceItemIds?: string[];
  safeDetail?: string;
}
