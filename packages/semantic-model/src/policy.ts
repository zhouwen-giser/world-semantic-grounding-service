import type { WorldSemanticFrame } from "@wsgs/contracts";

import { SemanticModelError } from "./adapter.js";
import type {
  SemanticModelInput,
  SemanticModelParser,
  SemanticModelPolicyMode,
  SemanticModelPolicyResult
} from "./types.js";

function emptySemanticFrame(): WorldSemanticFrame {
  return {
    schemaVersion: "1.0",
    mentions: [],
    spatialExpressions: [],
    relationExpressions: [],
    temporalConstraints: [],
    aggregationExpressions: [],
    rankingExpressions: []
  };
}

/**
 * Applies the runtime model policy without introducing any semantic fallback.
 * Optional mode yields only an empty model frame; deterministic parser products
 * remain the caller's sole degradation input.
 */
export async function parseSemanticModelWithPolicy(
  parser: SemanticModelParser,
  input: SemanticModelInput,
  mode: SemanticModelPolicyMode,
  signal?: AbortSignal
): Promise<SemanticModelPolicyResult> {
  try {
    const result = await parser.parse(input, signal);
    return {
      status: "AVAILABLE",
      completionStatus: "COMPLETE",
      frame: result.frame,
      receipt: result.receipt,
      warnings: []
    };
  } catch (error) {
    const failure = error instanceof SemanticModelError
      ? error
      : new SemanticModelError("MODEL_UNAVAILABLE", true);
    if (mode === "MODEL_REQUIRED") throw failure;
    return {
      status: "UNAVAILABLE",
      completionStatus: "PARTIAL",
      frame: emptySemanticFrame(),
      failureCode: failure.code,
      ...(failure.receipt ? { receipt: failure.receipt } : {}),
      warnings: [`DOMAIN_MODEL_UNAVAILABLE:${failure.code}`]
    };
  }
}
