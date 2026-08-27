import {
  PIPELINE_STAGES,
  PipelineConfigurationError,
  type PipelineStage,
  type PipelineStageContext,
  type PipelineStageExecutor,
  type PipelineStageHandler
} from "./types.js";

export class ProductionPipelineStageExecutor implements PipelineStageExecutor {
  readonly #handlers: Readonly<Record<PipelineStage, PipelineStageHandler>>;

  constructor(handlers: Readonly<Record<PipelineStage, PipelineStageHandler>>) {
    const keys = Object.keys(handlers);
    const missing = PIPELINE_STAGES.filter((stage) => typeof handlers[stage] !== "function");
    const unknown = keys.filter((key) => !(PIPELINE_STAGES as readonly string[]).includes(key));
    if (missing.length > 0 || unknown.length > 0) {
      throw new PipelineConfigurationError(
        `Invalid stage handlers; missing=${missing.join(",") || "none"}; unknown=${unknown.join(",") || "none"}`
      );
    }
    this.#handlers = Object.freeze({ ...handlers });
  }

  execute(stage: PipelineStage, context: PipelineStageContext): Promise<unknown> {
    return this.#handlers[stage](context);
  }
}
