import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  gdpsV021FindingContractClosure,
  gdpsV021OutputSchemaDependencies,
  GdpsOutputSchemaError,
  GdpsV021OutputSchemaRegistry
} from "./index.js";

interface ShapeFixture {
  readonly payloads: Readonly<Record<string, unknown>>;
}

const shapes = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../northbound-geospatial-findings/fixtures/gdps-real-result-shapes.json",
  import.meta.url
)), "utf8")) as ShapeFixture;

function validateFixture(
  registry: GdpsV021OutputSchemaRegistry,
  operationId: string,
  fixtureName: string
): void {
  const operation = gdpsV021FindingContractClosure.operations.find(
    (candidate) => candidate.operationId === operationId && candidate.operationVersion === "1.0"
  );
  if (operation === undefined) throw new Error(`Missing locked operation: ${operationId}`);
  registry.validateOutput(
    operation.operationId,
    operation.operationVersion,
    operation.outputSchemaUri,
    operation.outputSchemaHash,
    shapes.payloads[fixtureName]
  );
}

function captureSchemaError(action: () => void): GdpsOutputSchemaError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(GdpsOutputSchemaError);
    return error as GdpsOutputSchemaError;
  }
  throw new Error("Expected GDPS schema validation to fail");
}

describe("GDPS v0.2.1 FINAL_B output-schema closure", () => {
  it("compiles all 30 exact output schemas with the complete nine-document dependency closure", () => {
    const registry = new GdpsV021OutputSchemaRegistry();

    expect(registry.operationCount).toBe(30);
    expect(gdpsV021FindingContractClosure.outputSchemas).toHaveLength(30);
    expect(gdpsV021OutputSchemaDependencies.schemas).toHaveLength(9);
    expect(gdpsV021FindingContractClosure.closureHash).toBe(
      "sha256:cd64d329134f14512f9fa96d501887885eb60140bdcfeeec5e0e10219af41c87"
    );
    expect(Object.isFrozen(gdpsV021FindingContractClosure)).toBe(true);
    expect(Object.isFrozen(gdpsV021FindingContractClosure.operations[0])).toBe(true);
  });

  it("validates real specialized, generic, catalog, profile, range, and explanation fixture shapes", () => {
    const registry = new GdpsV021OutputSchemaRegistry();
    const cases = [
      ["elevation.sample", "pointMeasurement"],
      ["geo-raster.sample", "pointMeasurementGenericService"],
      ["geo-raster.sample", "pointClassificationGeneric"],
      ["terrain.find-high-ground", "spatialFeatures"],
      ["elevation.profile", "profile"],
      ["geo-raster.profile", "profileGenericService"],
      ["geo-raster.find-by-range", "valueRangeGenericService"],
      ["traversability.explain", "qualifiedExplanation"],
      ["geo-product.get", "currentProductGet"],
      ["geo-product.search", "catalog"]
    ] as const;

    for (const [operationId, fixtureName] of cases) {
      expect(() => validateFixture(registry, operationId, fixtureName)).not.toThrow();
    }
  });

  it("fails closed before value validation when the operation schema lock is not exact", () => {
    const registry = new GdpsV021OutputSchemaRegistry();
    const operation = gdpsV021FindingContractClosure.operations.find(
      (candidate) => candidate.operationId === "elevation.sample"
    );
    if (operation === undefined) throw new Error("Missing elevation.sample lock");

    const error = captureSchemaError(() => registry.validateOutput(
      operation.operationId,
      operation.operationVersion,
      operation.outputSchemaUri,
      `sha256:${"0".repeat(64)}`,
      shapes.payloads["pointMeasurement"]
    ));

    expect(error.code).toBe("GDPS_OUTPUT_SCHEMA_LOCK_MISMATCH");
  });

  it("rejects a value that violates the exact authoritative output schema", () => {
    const registry = new GdpsV021OutputSchemaRegistry();
    const operation = gdpsV021FindingContractClosure.operations.find(
      (candidate) => candidate.operationId === "geo-product.get"
    );
    if (operation === undefined) throw new Error("Missing geo-product.get lock");

    const error = captureSchemaError(() => registry.validateOutput(
      operation.operationId,
      operation.operationVersion,
      operation.outputSchemaUri,
      operation.outputSchemaHash,
      { schemaVersion: "gdps-current-product/1.0", productId: "incomplete" }
    ));

    expect(error.code).toBe("GDPS_OUTPUT_VALUE_SCHEMA_MISMATCH");
  });
});
