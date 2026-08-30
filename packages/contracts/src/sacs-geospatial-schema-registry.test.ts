import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  defaultSacsGeospatialSchemaRegistry,
  SacsGeospatialSchemaRegistry,
  SacsGeospatialSchemaValidationError
} from "./sacs-geospatial-schema-registry.js";

const validGap = {
  gapId: "gap.vehicles.truncated",
  gapKind: "TRUNCATED",
  severity: "WARNING",
  messageCode: "WSGS_RESULT_TRUNCATED"
};
const groundingResultExample = JSON.parse(readFileSync(new URL(
  "../../../contracts/wsgs-v0.2.1-sacs-geospatial/examples/grounding-result-with-geospatial-findings.json",
  import.meta.url
), "utf8")) as unknown;

describe("SacsGeospatialSchemaRegistry", () => {
  it("eagerly compiles the authoritative schemas", () => {
    expect(() => new SacsGeospatialSchemaRegistry()).not.toThrow();
  });

  it("accepts a conforming value", () => {
    expect(() => defaultSacsGeospatialSchemaRegistry().validate(
      "typed-gap.schema.json",
      validGap
    )).not.toThrow();
    expect(() => defaultSacsGeospatialSchemaRegistry().validate(
      "grounding-result-extension.schema.json",
      groundingResultExample
    )).not.toThrow();
  });

  it("fails closed on unknown fields", () => {
    expect(() => defaultSacsGeospatialSchemaRegistry().validate(
      "typed-gap.schema.json",
      { ...validGap, unexpectedAuthority: "request-body" }
    )).toThrowError(SacsGeospatialSchemaValidationError);
  });
});
