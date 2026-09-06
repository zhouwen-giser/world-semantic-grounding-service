import { createWorldAnalysisValidator, type GroundingCapabilities12 } from "@wsgs/contracts";

type Discovery = Pick<GroundingCapabilities12["worldAnalysis"], "capabilities" | "checkedAt" | "validUntil">;
const validate = createWorldAnalysisValidator();

export function worldAnalysisCapabilities(ready: boolean, discovery?: unknown): GroundingCapabilities12 {
  const now = Date.now();
  const fallback: Discovery = {
    capabilities: (["HISTORICAL_TRACE", "ROAD_ASSOCIATION", "TEMPORAL_EVENT", "CROSS", "METRIC_RANKING", "ACTION_TARGET_CANDIDATE"] as const)
      .map(capability => ({ capability, supported: true, available: false, reasonCodes: ["SNAPSHOT_UNAVAILABLE"] })),
    checkedAt: new Date(now).toISOString(), validUntil: new Date(now + 5_000).toISOString()
  };
  const result: GroundingCapabilities12 = {
    service: "world-semantic-grounding-service", version: "0.2.1",
    contractVersion: "sacs-wsgs-grounding/1.2", resultProfile: "wsgs-world-analysis-findings/1.0",
    supportedOperations: ["GROUND_REFERENCES", "COMPILE_WORLD_QUERY", "EXECUTE_WORLD_QUERY", "VALIDATE_REFERENCES"],
    supportedResultProfiles: ["wsgs-world-analysis-findings/1.0", "sacs-wsgs-geospatial-findings/1.0"],
    resultComponents: { worldAnalysisFindings: "REQUIRED", geospatialFindings: "OPTIONAL" },
    worldAnalysis: {
      supportedFindingKinds: ["HISTORICAL_TRACE", "ROAD_ASSOCIATION", "TEMPORAL_EVENT", "METRIC_RANKING", "ACTION_TARGET_CANDIDATE"],
      supportedChoiceKinds: ["REFERENCE_SELECTION", "TASK_SELECTION", "METRIC_SERIES_SELECTION", "RANKED_LOCATION_SELECTION", "EVENT_SELECTION"],
      structuredSelection: true, supportedActionSources: ["HISTORICAL_METRIC_CANDIDATE"], ...fallback
    },
    limits: { maximumFindings: 32, maximumChoices: 32, maximumCandidatesPerChoice: 100, maximumEvents: 100,
      maximumRankedLocations: 100, maximumRoadVisits: 100, maximumPeriods: 100, maximumLinePositions: 256,
      maximumGaps: 64, maximumSourceIds: 32, maximumWarnings: 100, maximumIdLength: 256,
      maximumLabelLength: 512, maximumSelections: 8, maximumPublicResultBytes: 1_048_576, choiceTtlMs: 60_000 },
    requiredCapabilitiesReady: ready
  };
  if (discovery && typeof discovery === "object" && !Array.isArray(discovery)) {
    const candidate = discovery as Discovery;
    const projected = { ...result, worldAnalysis: { ...result.worldAnalysis,
      capabilities: candidate.capabilities, checkedAt: candidate.checkedAt, validUntil: candidate.validUntil } };
    if (validate("capabilities", projected).valid && Date.parse(candidate.checkedAt) <= now && Date.parse(candidate.validUntil) > now) return projected;
  }
  return result;
}
