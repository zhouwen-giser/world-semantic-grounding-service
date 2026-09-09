/* Generated from public JSON Schema. Do not edit. */

export type ActionTargetCandidate = ActionTargetCandidateCOMPLETED | ActionTargetCandidatePARTIAL;

export interface ActionTargetCandidateCOMPLETED {
  findingId: string;
  findingKind: "ACTION_TARGET_CANDIDATE";
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
  actionKind: "MOVE_TO_LOCATION";
  sourceKind: "HISTORICAL_METRIC_CANDIDATE";
  target: Point;
  crs: "EPSG:4326";
  axisOrder: "LONGITUDE_LATITUDE";
  sourceFindingId: string;
  sourceCandidateId: string;
  sourceRank: number;
  representativeObservedAt: string;
  representativeMeasurementId: string;
  requirements: {
    currentValidationRequired: true;
    routePlanningRequired: true;
    executionConfirmationRequired: true;
  };
  executionAuthorized: false;
}
export interface Display {
  truncated: boolean;
  returnedCount: number;
  sourceCount?: number;
}
export interface Point {
  type: "Point";
  /**
   * @minItems 2
   * @maxItems 2
   */
  coordinates: [number, number];
}
export interface ActionTargetCandidatePARTIAL {
  findingId: string;
  findingKind: "ACTION_TARGET_CANDIDATE";
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
  actionKind: "MOVE_TO_LOCATION";
  sourceKind: "HISTORICAL_METRIC_CANDIDATE";
  target: Point;
  crs: "EPSG:4326";
  axisOrder: "LONGITUDE_LATITUDE";
  sourceFindingId: string;
  sourceCandidateId: string;
  sourceRank: number;
  representativeObservedAt: string;
  representativeMeasurementId: string;
  requirements: {
    currentValidationRequired: true;
    routePlanningRequired: true;
    executionConfirmationRequired: true;
  };
  executionAuthorized: false;
}
