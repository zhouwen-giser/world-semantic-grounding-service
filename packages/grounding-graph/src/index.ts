export { buildGroundingGraph, buildGroundingGraphWithDegradation, resolveReferenceClaimConflict } from "./builder.js";
export { canonicalGraphHash, validateGroundingGraph } from "./validation.js";
export type {
  DegradedGroundingGraphResult,
  GraphAmbiguity,
  GroundingGraphBuildResult,
  MergedMention,
  ReferenceMergeClaim,
  ReferenceMergeDecision
} from "./types.js";

export const GROUNDING_GRAPH_VERSION = "grounding-graph/1.0" as const;
