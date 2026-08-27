export { buildGroundingGraph, buildGroundingGraphWithDegradation, resolveReferenceClaimConflict } from "./builder.js";
export { canonicalGraphHash, validateGroundingGraph } from "./validation.js";
export {
  WSGS_V02_INTERNAL_NODE_KINDS,
  canonicalInternalGroundingGraphHash,
  toInternalGroundingGraphV2,
  validateInternalGroundingGraphV2
} from "./internal-v2.js";
export { GowmReferenceGrounder, ReferenceGroundingError } from "./reference-grounding.js";
export type {
  DegradedGroundingGraphResult,
  GraphAmbiguity,
  GroundingGraphBuildResult,
  MergedMention,
  ReferenceMergeClaim,
  ReferenceMergeDecision
} from "./types.js";
export type {
  InternalGraphEdgeV2,
  InternalGraphNodeV2,
  InternalGroundingGraphV2,
  InternalGroundingGraphV2Extension,
  WsgsV02InternalNodeKind
} from "./internal-v2.js";
export type {
  GatewayOperationExecutor,
  GroundedMentionProduct,
  GroundingAmbiguityProduct,
  ReferenceGroundingResult,
  ReferenceProduct,
  ReferenceValidationProduct
} from "./reference-types.js";

export const GROUNDING_GRAPH_VERSION = "grounding-graph/1.0" as const;
