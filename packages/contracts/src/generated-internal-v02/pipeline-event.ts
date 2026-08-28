/* Generated from the locked WSGS v0.2 internal JSON Schemas. Do not edit directly. */

export interface PipelineEvent {
  groundingId: string;
  stage:
    | "LOAD_CONTEXT"
    | "DETERMINISTIC_PARSE"
    | "SEMANTIC_MODEL_PARSE"
    | "SEMANTIC_FRAME_VALIDATE"
    | "GROUNDING_GRAPH_BUILD"
    | "REFERENCE_RESOLVE"
    | "REFERENCE_VALIDATE"
    | "REQUIREMENT_PLAN"
    | "CAPABILITY_MATCH"
    | "WORLD_QUERY_COMPILE"
    | "GOWM_EXECUTE"
    | "EVIDENCE_NORMALIZE"
    | "PRODUCT_ASSEMBLE"
    | "RESULT_PERSIST";
  attempt: number;
  generation: number;
  status: "STARTED" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
  inputHash: string;
  outputHash?: string;
  elapsedMs: number;
  errorCode?: string;
  createdAt: string;
}
