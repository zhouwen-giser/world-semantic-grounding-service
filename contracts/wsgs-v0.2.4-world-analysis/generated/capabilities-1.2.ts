/* Generated from public JSON Schema. Do not edit. */

export interface GroundingCapabilities12 {
  service: "world-semantic-grounding-service";
  version: "0.2.1";
  contractVersion: "sacs-wsgs-grounding/1.2";
  resultProfile: "wsgs-world-analysis-findings/1.0";
  /**
   * @minItems 4
   * @maxItems 4
   */
  supportedOperations: ("GROUND_REFERENCES" | "COMPILE_WORLD_QUERY" | "EXECUTE_WORLD_QUERY" | "VALIDATE_REFERENCES")[];
  /**
   * @minItems 2
   * @maxItems 2
   */
  supportedResultProfiles: ("wsgs-world-analysis-findings/1.0" | "sacs-wsgs-geospatial-findings/1.0")[];
  resultComponents: {
    worldAnalysisFindings: "REQUIRED";
    geospatialFindings: "OPTIONAL";
  };
  worldAnalysis: {
    /**
     * @minItems 5
     * @maxItems 5
     */
    supportedFindingKinds: (
      "HISTORICAL_TRACE" | "ROAD_ASSOCIATION" | "TEMPORAL_EVENT" | "METRIC_RANKING" | "ACTION_TARGET_CANDIDATE"
    )[];
    /**
     * @minItems 5
     * @maxItems 5
     */
    supportedChoiceKinds: (
      | "REFERENCE_SELECTION"
      | "TASK_SELECTION"
      | "METRIC_SERIES_SELECTION"
      | "RANKED_LOCATION_SELECTION"
      | "EVENT_SELECTION"
    )[];
    structuredSelection: true;
    /**
     * @minItems 1
     * @maxItems 1
     */
    supportedActionSources: "HISTORICAL_METRIC_CANDIDATE"[];
    /**
     * @minItems 6
     * @maxItems 6
     */
    capabilities: {
      capability:
        | "HISTORICAL_TRACE"
        | "ROAD_ASSOCIATION"
        | "TEMPORAL_EVENT"
        | "CROSS"
        | "METRIC_RANKING"
        | "ACTION_TARGET_CANDIDATE";
      supported: true;
      available: boolean;
      /**
       * @minItems 1
       * @maxItems 16
       */
      reasonCodes: (
        | "AVAILABLE"
        | "FEATURE_DISABLED"
        | "PROFILE_UNAUTHORIZED"
        | "SNAPSHOT_UNAVAILABLE"
        | "SNAPSHOT_EXPIRED"
        | "CAPABILITY_NOT_REGISTERED"
        | "OPERATION_UNAVAILABLE"
        | "OPERATION_DEGRADED"
        | "CONTRACT_MISMATCH"
        | "SEMANTIC_MISMATCH"
        | "PERMISSION_DENIED"
        | "DEPENDENCY_UNAVAILABLE"
      )[];
    }[];
    checkedAt: string;
    validUntil: string;
  };
  limits: {
    maximumFindings: 32;
    maximumChoices: 32;
    maximumCandidatesPerChoice: 100;
    maximumEvents: 100;
    maximumRankedLocations: 100;
    maximumRoadVisits: 100;
    maximumPeriods: 100;
    maximumLinePositions: 256;
    maximumGaps: 64;
    maximumSourceIds: 32;
    maximumWarnings: 100;
    maximumIdLength: 256;
    maximumLabelLength: 512;
    maximumSelections: 8;
    maximumPublicResultBytes: 1048576;
    choiceTtlMs: 60000;
  };
  requiredCapabilitiesReady: boolean;
}
