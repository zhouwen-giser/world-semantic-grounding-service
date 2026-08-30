export const QUERY_COMPILER_VERSION = "wsgs-query-compiler/2.0" as const;

export {
  TypedWorldQueryCompiler,
  QueryCompilationError,
  queryTemplateRules,
  recipeSnapshotMode
} from "./compiler.js";
export { CapabilityMatcher, canonicalSemanticProfileHash, capabilityGap } from "./matcher.js";
export { canonicalPlanHash, validateCompiledPlan } from "./validation.js";
export type {
  CapabilityBinding,
  CapabilityGap,
  CapabilityGapReason,
  CapabilityMatchInput,
  CapabilityMatchResult,
  CompileInput,
  CompileResult,
  ExecutionBudgets,
  GdpsRecipeAuthorization,
  MatchedCapability,
  MaturityPolicy,
  PortRequirement,
  QuerySemanticPattern,
  QuerySnapshotPolicy,
  SchemaPort,
  SemanticCapabilityRequirement,
  SnapshotMode,
  WorldQueryInputBinding,
  WorldQueryNode,
  WorldQueryPlanV2,
  WorldQuerySubmission
} from "./types.js";
