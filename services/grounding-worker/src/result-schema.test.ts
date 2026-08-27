import { describe, expect, it } from "vitest";

import {
  GroundingResultSchemaValidationError,
  assertFrozenGroundingResult
} from "./result-schema.js";

const digest = `sha256:${"a".repeat(64)}`;

function result(): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    requestId: "request-schema-test",
    groundingId: "grounding-schema-test",
    status: "COMPLETED",
    source: { messageId: "message-schema-test", originalTextSha256: digest },
    mentions: [],
    referenceProducts: [],
    evidenceItems: [],
    ambiguities: [],
    unresolvedMentions: [],
    capabilityGaps: [],
    warnings: [],
    execution: {
      parserVersion: "test/1.0",
      semanticModelReceiptIds: [],
      queryCompilerVersion: "test/1.0",
      normalizerVersion: "test/1.0",
      elapsedMs: 1
    },
    resultHash: digest
  };
}

describe("frozen grounding-result validation", () => {
  it("accepts a result through the frozen schema and all referenced schemas", () => {
    expect(() => assertFrozenGroundingResult(result())).not.toThrow();
  });

  it("rejects nested reference failures and unexpected fields without echoing result data", () => {
    const invalid = {
      ...result(),
      source: { messageId: "message-schema-test", originalTextSha256: "not-a-digest" },
      sensitiveUnexpectedField: "do-not-echo-this-value"
    };
    let caught: unknown;
    try {
      assertFrozenGroundingResult(invalid);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GroundingResultSchemaValidationError);
    expect(caught).toMatchObject({ code: "GROUNDING_RESULT_SCHEMA_INVALID", retryable: false });
    expect(String(caught)).not.toContain("do-not-echo-this-value");
  });
});
