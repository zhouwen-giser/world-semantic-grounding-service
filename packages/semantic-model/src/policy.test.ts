import type { WorldSemanticFrame } from "@wsgs/contracts";
import { describe, expect, it } from "vitest";

import {
  SemanticModelError,
  parseSemanticModelWithPolicy,
  type ModelReceipt,
  type SemanticModelParser
} from "./index.js";

const emptyFrame: WorldSemanticFrame = {
  schemaVersion: "1.0",
  mentions: [],
  spatialExpressions: [],
  relationExpressions: [],
  temporalConstraints: [],
  aggregationExpressions: [],
  rankingExpressions: []
};

const failedReceipt: ModelReceipt = {
  receiptVersion: "1.0",
  status: "FAILED",
  modelHash: "model-hash",
  promptVersion: "prompt-v1",
  promptHash: "prompt-hash",
  schemaHash: "schema-hash",
  inputHash: "input-hash",
  outputHash: "output-hash",
  attempts: 1,
  elapsedMs: 5,
  failureCode: "MODEL_TRANSPORT_ERROR"
};

const unavailable: SemanticModelParser = {
  async parse() {
    throw new SemanticModelError("MODEL_TRANSPORT_ERROR", true, failedReceipt);
  }
};

describe("semantic model runtime policy", () => {
  it("fails with the typed model error when MODEL_REQUIRED is unavailable", async () => {
    const failure = await parseSemanticModelWithPolicy(
      unavailable,
      { sourceText: "nearest road" },
      "MODEL_REQUIRED"
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SemanticModelError);
    expect(failure).toMatchObject({ code: "MODEL_TRANSPORT_ERROR", receipt: failedReceipt });
  });

  it("returns deterministic-only PARTIAL semantics in MODEL_OPTIONAL without keyword fallback", async () => {
    const result = await parseSemanticModelWithPolicy(
      unavailable,
      { sourceText: "nearest road with keyword-looking content" },
      "MODEL_OPTIONAL"
    );
    expect(result).toMatchObject({
      status: "UNAVAILABLE",
      completionStatus: "PARTIAL",
      failureCode: "MODEL_TRANSPORT_ERROR",
      receipt: failedReceipt,
      frame: emptyFrame,
      warnings: ["DOMAIN_MODEL_UNAVAILABLE:MODEL_TRANSPORT_ERROR"]
    });
    expect(result.frame.mentions).toEqual([]);
    expect(result.frame.spatialExpressions).toEqual([]);
  });

  it("preserves a schema-validated available model result in either policy", async () => {
    const { failureCode: _failureCode, ...receiptFields } = failedReceipt;
    const receipt: ModelReceipt = { ...receiptFields, status: "SUCCEEDED" };
    const available: SemanticModelParser = { async parse() { return { frame: emptyFrame, receipt }; } };
    const result = await parseSemanticModelWithPolicy(available, { sourceText: "road" }, "MODEL_REQUIRED");
    expect(result).toMatchObject({ status: "AVAILABLE", completionStatus: "COMPLETE", frame: emptyFrame });
  });
});
