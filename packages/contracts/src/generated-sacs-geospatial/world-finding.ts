/* Generated from the authoritative WSGS v0.2.1 SACS geospatial JSON Schemas. Do not edit directly. */

export type UrnWsgsV021SacsGeospatialWorldFinding10 =
  | {
      findingId: string;
      findingKind: "POINT_MEASUREMENT";
      semanticConcept: string;
      querySemantics: string;
      status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
      /**
       * @maxItems 32
       */
      subjectReferenceProductIds?: string[];
      /**
       * @minItems 1
       * @maxItems 256
       */
      evidenceItemIds: string[];
      /**
       * @minItems 1
       * @maxItems 64
       */
      sourceProductIds: string[];
      confidence?: number;
      /**
       * @maxItems 64
       */
      unknowns?: string[];
      /**
       * @maxItems 64
       */
      warnings?: string[];
      point: GeoJsonPoint;
      value: number;
      unit: string;
    }
  | {
      findingId: string;
      findingKind: "POINT_CLASSIFICATION";
      semanticConcept: string;
      querySemantics: string;
      status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
      /**
       * @maxItems 32
       */
      subjectReferenceProductIds?: string[];
      /**
       * @minItems 1
       * @maxItems 256
       */
      evidenceItemIds: string[];
      /**
       * @minItems 1
       * @maxItems 64
       */
      sourceProductIds: string[];
      confidence?: number;
      /**
       * @maxItems 64
       */
      unknowns?: string[];
      /**
       * @maxItems 64
       */
      warnings?: string[];
      point: GeoJsonPoint;
      classCode: string;
      classLabel?: string;
    }
  | {
      findingId: string;
      findingKind: "SPATIAL_FEATURE_COLLECTION";
      semanticConcept: string;
      querySemantics: string;
      status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
      /**
       * @maxItems 32
       */
      subjectReferenceProductIds?: string[];
      /**
       * @minItems 1
       * @maxItems 256
       */
      evidenceItemIds: string[];
      /**
       * @minItems 1
       * @maxItems 64
       */
      sourceProductIds: string[];
      confidence?: number;
      /**
       * @maxItems 64
       */
      unknowns?: string[];
      /**
       * @maxItems 64
       */
      warnings?: string[];
      returnedCount: number;
      truncated: boolean;
      /**
       * @maxItems 1000
       */
      features: SpatialFeature[];
    }
  | {
      findingId: string;
      findingKind: "PROFILE";
      semanticConcept: string;
      querySemantics: string;
      status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
      /**
       * @maxItems 32
       */
      subjectReferenceProductIds?: string[];
      /**
       * @minItems 1
       * @maxItems 256
       */
      evidenceItemIds: string[];
      /**
       * @minItems 1
       * @maxItems 64
       */
      sourceProductIds: string[];
      confidence?: number;
      /**
       * @maxItems 64
       */
      unknowns?: string[];
      /**
       * @maxItems 64
       */
      warnings?: string[];
      unit: string;
      /**
       * @maxItems 10000
       */
      samples: {
        distanceM: number;
        value: number;
        point?: GeoJsonPoint;
      }[];
      truncated: boolean;
    }
  | {
      findingId: string;
      findingKind: "QUALIFIED_EXPLANATION";
      semanticConcept: string;
      querySemantics: string;
      status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
      /**
       * @maxItems 32
       */
      subjectReferenceProductIds?: string[];
      /**
       * @minItems 1
       * @maxItems 256
       */
      evidenceItemIds: string[];
      /**
       * @minItems 1
       * @maxItems 64
       */
      sourceProductIds: string[];
      confidence?: number;
      /**
       * @maxItems 64
       */
      unknowns?: string[];
      /**
       * @maxItems 64
       */
      warnings?: string[];
      explanationCode: string;
      summary: string;
      /**
       * @maxItems 32
       */
      reasonCodes: string[];
      publishedFacts?: {
        slopeDegrees?: number;
        landcoverClass?: string;
        classCode?: string;
        classLabel?: string;
        riskClass?: string;
        traversabilityClass?: string;
      };
    }
  | {
      findingId: string;
      findingKind: "CATALOG";
      semanticConcept: string;
      querySemantics: string;
      status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
      /**
       * @maxItems 32
       */
      subjectReferenceProductIds?: string[];
      /**
       * @minItems 1
       * @maxItems 256
       */
      evidenceItemIds: string[];
      /**
       * @minItems 1
       * @maxItems 64
       */
      sourceProductIds: string[];
      confidence?: number;
      /**
       * @maxItems 64
       */
      unknowns?: string[];
      /**
       * @maxItems 64
       */
      warnings?: string[];
      returnedCount: number;
      truncated: boolean;
      /**
       * @maxItems 256
       */
      items: {
        itemId?: string;
        productId?: string;
        productType: string;
        productProfile?: string;
        displayName?: string;
        classCode?: string;
        classLabel?: string;
      }[];
    };
/**
 * @minItems 2
 * @maxItems 3
 */
export type Position = number[];
export type GeoJsonGeometry =
  GeoJsonPoint | GeoJsonMultiPoint | GeoJsonLineString | GeoJsonMultiLineString | GeoJsonPolygon | GeoJsonMultiPolygon;
/**
 * @minItems 2
 * @maxItems 10000
 */
export type LineStringCoordinates = Position[];
/**
 * @minItems 4
 * @maxItems 10000
 */
export type LinearRingCoordinates = Position[];
/**
 * @minItems 1
 * @maxItems 256
 */
export type PolygonCoordinates = LinearRingCoordinates[];

export interface GeoJsonPoint {
  type: "Point";
  coordinates: Position;
}
export interface SpatialFeature {
  featureId: string;
  displayName?: string;
  referenceKey?: ReferenceKey;
  geometry?: GeoJsonGeometry;
  payloadRef?: string;
  classCode?: string;
  classLabel?: string;
  areaM2?: number;
  lengthM?: number;
  distanceM?: number;
  confidence?: number;
  publishedAttributes?: PublishedAttributes;
}
export interface ReferenceKey {
  namespace: "gowm";
  kind: string;
  id: string;
  version: string;
}
export interface GeoJsonMultiPoint {
  type: "MultiPoint";
  /**
   * @minItems 1
   * @maxItems 10000
   */
  coordinates: Position[];
}
export interface GeoJsonLineString {
  type: "LineString";
  coordinates: LineStringCoordinates;
}
export interface GeoJsonMultiLineString {
  type: "MultiLineString";
  /**
   * @minItems 1
   * @maxItems 256
   */
  coordinates: LineStringCoordinates[];
}
export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: PolygonCoordinates;
}
export interface GeoJsonMultiPolygon {
  type: "MultiPolygon";
  /**
   * @minItems 1
   * @maxItems 256
   */
  coordinates: PolygonCoordinates[];
}
export interface PublishedAttributes {
  objectClass?: string;
  objectType?: string;
  categoryCode?: string;
  categoryLabel?: string;
  operationalStatus?: string;
}
