/* Generated from public JSON Schema. Do not edit. */

export type TemporalEvent =
  TemporalEventCOMPLETED | TemporalEventPARTIAL | TemporalEventNO_DATA | TemporalEventINDETERMINATE;

export interface TemporalEventCOMPLETED {
  findingId: string;
  findingKind: "TEMPORAL_EVENT";
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
  /**
   * @minItems 1
   * @maxItems 6
   */
  eventTypes: ("ENTER" | "EXIT" | "DWELL" | "STOP" | "PASS_NEAR" | "CROSS")[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  events: Event[];
  selection?: EventSelection;
  sourcePrefixComplete: boolean;
  sourceSuffixComplete: boolean;
  completeForAllEvents: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
}
export interface Display {
  truncated: boolean;
  returnedCount: number;
  sourceCount?: number;
}
export interface Event {
  eventId: string;
  eventType: "ENTER" | "EXIT" | "DWELL" | "STOP" | "PASS_NEAR" | "CROSS";
  extent:
    | {
        kind: "INSTANT";
        timeWindow: TimeRange;
        estimatedAt?: string;
      }
    | {
        kind: "INTERVAL";
        period: TimeRange;
        durationSeconds: number;
        startTimeWindow?: TimeRange;
        endTimeWindow?: TimeRange;
      };
  position?: Point;
  target?:
    | {
        kind: "SPATIAL_TARGET";
        sourceTargetId: string;
        referenceProductId?: string;
        displayName?: string;
        targetType: "AREA" | "POINT" | "LINE";
      }
    | {
        kind: "NETWORK_JUNCTION";
        graphVersionId: string;
        graphVersion: string;
        nodeId: string;
        position: Point;
        incomingFeatureId: string;
        outgoingFeatureId: string;
      };
  certainty: "CONFIRMED_IN_AVAILABLE_DATA" | "APPROXIMATED" | "CLIPPED_TO_INPUT";
  confidence?: number;
  /**
   * @minItems 0
   * @maxItems 100
   */
  reasonCodes: string[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  evidenceIds: string[];
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
export interface EventSelection {
  kind: "FIRST" | "LAST";
  selectedEventId?: string;
  confirmed: boolean;
  confirmationScope: "REQUESTED_SCOPE_PROVEN" | "CONFIRMED_IN_AVAILABLE_DATA" | "NOT_CONFIRMED";
  reasonCode:
    | "FIRST_EVENT_CONFIRMED"
    | "FIRST_EVENT_NOT_CERTAIN"
    | "LAST_EVENT_CONFIRMED"
    | "LAST_EVENT_NOT_CERTAIN"
    | "NO_EVENT_FOUND";
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
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
export interface TemporalEventPARTIAL {
  findingId: string;
  findingKind: "TEMPORAL_EVENT";
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
  /**
   * @minItems 1
   * @maxItems 6
   */
  eventTypes: ("ENTER" | "EXIT" | "DWELL" | "STOP" | "PASS_NEAR" | "CROSS")[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  events: Event[];
  selection?: EventSelection;
  sourcePrefixComplete: boolean;
  sourceSuffixComplete: boolean;
  completeForAllEvents: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
}
export interface TemporalEventNO_DATA {
  findingId: string;
  findingKind: "TEMPORAL_EVENT";
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
  /**
   * @minItems 1
   * @maxItems 6
   */
  eventTypes: ("ENTER" | "EXIT" | "DWELL" | "STOP" | "PASS_NEAR" | "CROSS")[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  events: Event[];
  selection?: EventSelection;
  sourcePrefixComplete: boolean;
  sourceSuffixComplete: boolean;
  completeForAllEvents: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
}
export interface TemporalEventINDETERMINATE {
  findingId: string;
  findingKind: "TEMPORAL_EVENT";
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
  /**
   * @minItems 1
   * @maxItems 6
   */
  eventTypes: ("ENTER" | "EXIT" | "DWELL" | "STOP" | "PASS_NEAR" | "CROSS")[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  events: Event[];
  selection?: EventSelection;
  sourcePrefixComplete: boolean;
  sourceSuffixComplete: boolean;
  completeForAllEvents: boolean;
  /**
   * @minItems 0
   * @maxItems 100
   */
  blockingPeriods: PeriodIssue[];
}
