export const QUERY_COMPILER_VERSION = "wsgs-query-compiler/2.0" as const;

export {
  TypedWorldQueryCompiler,
  QueryCompilationError,
  queryTemplateRules,
  recipeSnapshotMode
} from "./compiler.js";
export { CapabilityMatcher, canonicalSemanticProfileHash, capabilityGap } from "./matcher.js";
export { canonicalPlanHash, validateCompiledPlan } from "./validation.js";
export {
  compileGdpsV032Requirement,
  gdpsV032RequirementKinds
} from "./gdps-v032.js";
export type {
  GdpsV032BindingCatalog,
  GdpsV032CatalogBinding,
  GdpsV032CatalogFamily,
  GdpsV032CompilationGapReason,
  GdpsV032CompiledOperationRequest,
  GdpsV032CompileResult,
  GdpsV032OperationState,
  GdpsV032Requirement,
  GdpsV032RequirementKind,
  GdpsV032TrustedContext,
  TrustedExplicitProductSelection
} from "./gdps-v032.js";
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
