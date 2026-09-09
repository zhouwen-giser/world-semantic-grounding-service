/* Generated from public JSON Schema. Do not edit. */

export type Choice =
  | {
      choiceId: string;
      choiceKind: "REFERENCE_SELECTION";
      promptCode: string;
      sourceFindingId?: string;
      validUntil: string;
      /**
       * @minItems 1
       * @maxItems 100
       */
      candidates: {
        candidateId: string;
        displayName: string;
        referenceProductId: string;
      }[];
    }
  | {
      choiceId: string;
      choiceKind: "TASK_SELECTION";
      promptCode: string;
      sourceFindingId?: string;
      validUntil: string;
      /**
       * @minItems 1
       * @maxItems 100
       */
      candidates: {
        candidateId: string;
        displayName: string;
        referenceProductId: string;
      }[];
    }
  | {
      choiceId: string;
      choiceKind: "METRIC_SERIES_SELECTION";
      promptCode: string;
      sourceFindingId?: string;
      validUntil: string;
      /**
       * @minItems 1
       * @maxItems 100
       */
      candidates: {
        candidateId: string;
        displayName: string;
        series: Series;
      }[];
    }
  | {
      choiceId: string;
      choiceKind: "RANKED_LOCATION_SELECTION";
      promptCode: string;
      sourceFindingId?: string;
      validUntil: string;
      /**
       * @minItems 1
       * @maxItems 100
       */
      candidates: {
        candidateId: string;
        displayName: string;
        findingId: string;
        rank: number;
      }[];
    }
  | {
      choiceId: string;
      choiceKind: "EVENT_SELECTION";
      promptCode: string;
      sourceFindingId?: string;
      validUntil: string;
      /**
       * @minItems 1
       * @maxItems 100
       */
      candidates: {
        candidateId: string;
        displayName: string;
        findingId: string;
        eventId: string;
      }[];
    };

export interface Series {
  sourceKey: string;
  datastreamKey: string;
  measurementKey: string;
  observedProperty: string;
  measurementStage: "NORMALIZED" | "PARSED_NATIVE" | "FUSED_DERIVED";
  valueUnit?: string;
}
