import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION } from "@wsgs/grounding-pipeline";

import {
  GroundingResultSchemaValidationError,
  assertFrozenGroundingResult,
  assertNegotiatedGroundingResult
} from "./result-schema.js";

const digest = `sha256:${"a".repeat(64)}`;
const geospatialResult = JSON.parse(readFileSync(new URL(
  "../../../contracts/wsgs-v0.2.1-sacs-geospatial/examples/grounding-result-with-geospatial-findings.json",
  import.meta.url
), "utf8")) as Record<string, unknown>;

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

  it("accepts the exact 1.1 result only under its persisted negotiation", () => {
    expect(() => assertNegotiatedGroundingResult(
      geospatialResult,
      SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION
    )).not.toThrow();
    expect(() => assertFrozenGroundingResult(geospatialResult)).toThrowError(GroundingResultSchemaValidationError);
  });
});
