import type { GroundingGraph } from "@wsgs/contracts";
import type { TextSpan } from "@wsgs/deterministic-parser";

export interface MergedMention {
  mentionId: string;
  surfaceText: string;
  span: TextSpan;
  expectedKinds: string[];
  semanticRole?: string;
  extractionSources: Array<"CLIENT_MAP" | "KNOWN_REFERENCE" | "DETERMINISTIC" | "DOMAIN_MODEL">;
}

export interface GraphAmbiguity {
  ambiguityId: string;
  mentionId: string;
  reason: "NAMESPACE_CONFLICT" | "CONTEXT_CONFLICT" | "MAP_TEXT_CONFLICT";
  alternatives: Array<{
    source: string;
    namespace: string;
    referenceType: string;
  }>;
}

export interface GroundingGraphBuildResult {
  graph: GroundingGraph;
  graphHash: `sha256:${string}`;
  mergedMentions: MergedMention[];
  ambiguities: GraphAmbiguity[];
}

export interface DegradedGroundingGraphResult extends GroundingGraphBuildResult {
  completionStatus: "COMPLETE" | "PARTIAL";
  warnings: string[];
}

export interface ReferenceMergeClaim {
  claimId: string;
  source: "CLIENT_MAP" | "KNOWN_REFERENCE" | "DETERMINISTIC" | "DOMAIN_MODEL";
  namespace: string;
  referenceType: string;
  priority: number;
}

export type ReferenceMergeDecision =
  | { status: "MERGED"; selected: ReferenceMergeClaim; alternatives: ReferenceMergeClaim[] }
  | { status: "AMBIGUOUS"; reason: "NAMESPACE_CONFLICT" | "CONTEXT_CONFLICT"; alternatives: ReferenceMergeClaim[] };
