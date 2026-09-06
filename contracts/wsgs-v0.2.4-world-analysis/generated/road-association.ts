/* Generated from public JSON Schema. Do not edit. */

export type RoadAssociation =
  RoadAssociationCOMPLETED | RoadAssociationPARTIAL | RoadAssociationNO_DATA | RoadAssociationINDETERMINATE;

export interface RoadAssociationCOMPLETED {
  findingId: string;
  findingKind: "ROAD_ASSOCIATION";
  semanticConcept: string;
  status: "COMPLETED";
  /**
   * @minItems 1
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 1
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  trajectoryReferenceProductId: string;
  networkRole: "REFERENCE_MODEL_NOT_PHYSICAL_TRUTH";
  network: Network;
  /**
   * @minItems 0
   * @maxItems 100
   */
  roadVisits: RoadVisit[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  offNetworkSegments: OffNetwork[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  ambiguousSegments: Ambiguity[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  networkDataIssues: NetworkIssue[];
  associationPrefixComplete: boolean;
  associationSuffixComplete: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
  lastConfirmedRoad?: {
    visitId: string;
    confirmationScope: "CONFIRMED_IN_AVAILABLE_DATA";
    absoluteFinalRoadClaimed: false;
  };
}
export interface Display {
  truncated: boolean;
  returnedCount: number;
  sourceCount?: number;
}
export interface Network {
  graphVersionId: string;
  graphVersion: string;
  topologyHash: string;
  timeBasis: "CURRENT_ACTIVE_TOPOLOGY";
}
export interface RoadVisit {
  visitId: string;
  sourceFeatureId: string;
  displayName?: string;
  period: TimeRange;
  entryPosition?: Point;
  exitPosition?: Point;
  sampleCount: number;
  confidence?: number;
}
export interface TimeRange {
  start: string;
  end: string;
  bounds: "[)" | "[]" | "(]" | "()" | "UNSPECIFIED";
}
export interface Point {
  type: "Point";
  /**
   * @minItems 2
   * @maxItems 2
   */
  coordinates: [number, number];
}
export interface OffNetwork {
  segmentId: string;
  period: TimeRange;
  sampleCount: number;
  entryPosition?: Point;
  exitPosition?: Point;
  /**
   * @minItems 2
   * @maxItems 256
   */
  pathPreview?: Point[];
  interpretationHint:
    | "UNMAPPED_PATH_CANDIDATE"
    | "OPEN_AREA_MOVEMENT"
    | "NETWORK_GEOMETRY_OFFSET_CANDIDATE"
    | "TEMPORARY_PATH_CANDIDATE"
    | "UNKNOWN";
  confidence?: number;
  /**
   * @minItems 0
   * @maxItems 100
   */
  reasonCodes: string[];
}
export interface Ambiguity {
  segmentId: string;
  period: TimeRange;
  /**
   * @minItems 0
   * @maxItems 32
   */
  candidateFeatureIds: string[];
  confidence?: number;
}
export interface NetworkIssue {
  issueKind:
    | "MISSING_PATH_CANDIDATE"
    | "MISSING_TOPOLOGY_CONNECTION_CANDIDATE"
    | "ROAD_GEOMETRY_OFFSET_CANDIDATE"
    | "DIRECTION_CONFLICT_CANDIDATE";
  period: TimeRange;
  /**
   * @minItems 0
   * @maxItems 32
   */
  relatedFeatureIds: string[];
  observationCount: number;
  confidence?: number;
  /**
   * @minItems 0
   * @maxItems 100
   */
  reasonCodes: string[];
}
export interface PeriodIssue {
  period: TimeRange;
  kind: string;
  /**
   * @minItems 0
   * @maxItems 100
   */
  reasonCodes: string[];
}
export interface RoadAssociationPARTIAL {
  findingId: string;
  findingKind: "ROAD_ASSOCIATION";
  semanticConcept: string;
  status: "PARTIAL";
  /**
   * @minItems 1
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 1
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  trajectoryReferenceProductId: string;
  networkRole: "REFERENCE_MODEL_NOT_PHYSICAL_TRUTH";
  network: Network;
  /**
   * @minItems 0
   * @maxItems 100
   */
  roadVisits: RoadVisit[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  offNetworkSegments: OffNetwork[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  ambiguousSegments: Ambiguity[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  networkDataIssues: NetworkIssue[];
  associationPrefixComplete: boolean;
  associationSuffixComplete: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
  lastConfirmedRoad?: {
    visitId: string;
    confirmationScope: "CONFIRMED_IN_AVAILABLE_DATA";
    absoluteFinalRoadClaimed: false;
  };
}
export interface RoadAssociationNO_DATA {
  findingId: string;
  findingKind: "ROAD_ASSOCIATION";
  semanticConcept: string;
  status: "NO_DATA";
  /**
   * @minItems 0
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  trajectoryReferenceProductId?: string;
  networkRole: "REFERENCE_MODEL_NOT_PHYSICAL_TRUTH";
  network?: Network;
  /**
   * @minItems 0
   * @maxItems 100
   */
  roadVisits: RoadVisit[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  offNetworkSegments: OffNetwork[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  ambiguousSegments: Ambiguity[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  networkDataIssues: NetworkIssue[];
  associationPrefixComplete: boolean;
  associationSuffixComplete: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
  lastConfirmedRoad?: {
    visitId: string;
    confirmationScope: "CONFIRMED_IN_AVAILABLE_DATA";
    absoluteFinalRoadClaimed: false;
  };
}
export interface RoadAssociationINDETERMINATE {
  findingId: string;
  findingKind: "ROAD_ASSOCIATION";
  semanticConcept: string;
  status: "INDETERMINATE";
  /**
   * @minItems 0
   * @maxItems 32
   */
  subjectReferenceProductIds: string[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  evidenceIds: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  warnings: string[];
  display: Display;
  validUntil?: string;
  trajectoryReferenceProductId?: string;
  networkRole: "REFERENCE_MODEL_NOT_PHYSICAL_TRUTH";
  network?: Network;
  /**
   * @minItems 0
   * @maxItems 100
   */
  roadVisits: RoadVisit[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  offNetworkSegments: OffNetwork[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  ambiguousSegments: Ambiguity[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  networkDataIssues: NetworkIssue[];
  associationPrefixComplete: boolean;
  associationSuffixComplete: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
  lastConfirmedRoad?: {
    visitId: string;
    confirmationScope: "CONFIRMED_IN_AVAILABLE_DATA";
    absoluteFinalRoadClaimed: false;
  };
}
