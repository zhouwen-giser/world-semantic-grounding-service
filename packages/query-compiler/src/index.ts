export const QUERY_COMPILER_VERSION = "wsgs-query-compiler/1.0" as const;

export { TypedWorldQueryCompiler, QueryCompilationError, queryTemplateRules } from "./compiler.js";
export { canonicalPlanHash, validateCompiledPlan } from "./validation.js";
export type {
  CapabilityGap,
  CompileInput,
  CompileResult,
  ExecutionBudgets,
  QuerySemanticPattern,
  WorldQueryPlanV2,
  WorldQuerySubmission
} from "./types.js";
