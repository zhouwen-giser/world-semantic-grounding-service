import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import proj4 from "proj4";

import type { GdpsLockedOperation } from "@wsgs/trusted-capability-snapshot";

export interface StasGdpsRuntimeBinding {
  gowmSourceCommit: string;
  gdpsSourceCommit: string;
  gdpsDataScope: string;
  gatewayInstanceBindingHash: `sha256:${string}`;
  gdpsProviderImageDigest: `sha256:${string}`;
}

export interface StasGdpsEventGeometryTransform {
  sourceCrs: "EPSG:32618";
  targetCrs: "EPSG:4326";
  axisOrder: "EAST_NORTH_TO_LONGITUDE_LATITUDE";
  engine: "PROJ4JS/2.22.0";
}

export interface StasGdpsFixtureLock {
  schemaVersion: "wsgs-stas-gdps-fixture-lock/1.0";
  recipeId: "stas-nearest-approach-gdps-current-context";
  semanticPattern: "STAS_NEAREST_APPROACH_WITH_GDPS_CONTEXT";
  authority: "WSGS";
  runtimeBinding: StasGdpsRuntimeBinding;
  operationInput: Record<string, unknown>;
  operationInputHash: `sha256:${string}`;
  eventGeometryPath: "/result/shortest_line/coordinates/0";
  eventGeometryTransform: StasGdpsEventGeometryTransform;
  products: readonly [
    { productType: "SLOPE"; productProfile: "DEGREE" },
    { productType: "LAND_COVER"; productProfile: "DEFAULT" }
  ];
  allowedOperations: readonly GdpsLockedOperation[];
}

export interface LoadedStasGdpsFixtureLock {
  lock: StasGdpsFixtureLock;
  lockHash: `sha256:${string}`;
}

export class StasGdpsFixtureLockError extends Error {
  constructor(readonly code: string) {
    super(`STAS plus GDPS fixture lock rejected: ${code}`);
  }
}

const digest = /^sha256:[0-9a-f]{64}$/u;
const commit = /^[0-9a-f]{40}$/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const topLevelKeys = [
  "schemaVersion", "recipeId", "semanticPattern", "authority", "runtimeBinding", "operationInput",
  "operationInputHash", "eventGeometryPath", "eventGeometryTransform", "products", "allowedOperations"
] as const;
const runtimeBindingKeys = [
  "gowmSourceCommit", "gdpsSourceCommit", "gdpsDataScope", "gatewayInstanceBindingHash", "gdpsProviderImageDigest"
] as const;
const dataScope = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const eventGeometryTransformKeys = ["sourceCrs", "targetCrs", "axisOrder", "engine"] as const;
const expectedOperations: Readonly<Record<string, Omit<GdpsLockedOperation, "operationId" | "operationVersion">>> = {
  "stas.nearest-approach@1.0": {
    inputSchemaHash: "sha256:fa852ea7022341b5e4f93985af177c0eadf0085928ca0b7516111dfeb4b74dd1",
    outputSchemaHash: "sha256:7e6e2bad26790a6f049ac887951dc3c7409b12a3f8f6ae517de8be0ed606f1a6",
    semanticProfileHash: "sha256:ac083588969e1d02790e11ae380db6b5a7012abfe0664c170308341aa4dc8705"
  },
  "geo-raster.sample@1.0": {
    inputSchemaHash: "sha256:57983c08d1fafefac136dc44effa137500bca5580056bd68ec01b677747308d4",
    outputSchemaHash: "sha256:da086a0ab6c1a48ffeac7633acef50b0385851dbf4e9191c24a21f5cd414ecf0",
    semanticProfileHash: "sha256:c591c93b448564f1508387ee7609efc6c474fd57fde7c6a2394057cf4fdda4cd"
  }
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function canonicalStasGdpsInputHash(value: Record<string, unknown>): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

export function transformStasGdpsEventCoordinates(
  transform: StasGdpsEventGeometryTransform,
  value: unknown
): readonly [number, number] {
  if (!Array.isArray(value) || value.length < 2 ||
      !value.slice(0, 2).every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    throw new StasGdpsFixtureLockError("EVENT_GEOMETRY_COORDINATES_INVALID");
  }
  let projected: number[];
  try {
    projected = proj4(transform.sourceCrs, transform.targetCrs, [value[0] as number, value[1] as number]);
  } catch {
    throw new StasGdpsFixtureLockError("EVENT_GEOMETRY_TRANSFORM_FAILED");
  }
  const [longitude, latitude] = projected;
  if (projected.length < 2 || longitude === undefined || latitude === undefined ||
      !Number.isFinite(longitude) || !Number.isFinite(latitude) ||
      longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new StasGdpsFixtureLockError("EVENT_GEOMETRY_TRANSFORM_INVALID");
  }
  return Object.freeze([longitude, latitude] as [number, number]);
}

function validateOperationInput(value: Record<string, unknown>): void {
  if (!exactKeys(value, [
    "dataScopeId", "dimensionPolicy", "timeRange", "trackletA", "trackletB", "uncertaintyPolicy"
  ])) throw new StasGdpsFixtureLockError("OPERATION_INPUT_SHAPE");
  if (!uuid.test(String(value["dataScopeId"])) || value["dimensionPolicy"] !== "2D" ||
      value["uncertaintyPolicy"] !== "NOMINAL_WITH_SCALAR_SENSITIVITY") {
    throw new StasGdpsFixtureLockError("OPERATION_INPUT_POLICY");
  }
  const range = value["timeRange"];
  if (!object(range) || !exactKeys(range, ["start", "end"])) {
    throw new StasGdpsFixtureLockError("TIME_RANGE_SHAPE");
  }
  const start = Date.parse(String(range["start"]));
  const end = Date.parse(String(range["end"]));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new StasGdpsFixtureLockError("TIME_RANGE_INVALID");
  }
  for (const key of ["trackletA", "trackletB"] as const) {
    const reference = value[key];
    if (!object(reference) || !exactKeys(reference, ["trackletId", "versionNo"]) ||
        !uuid.test(String(reference["trackletId"])) || reference["versionNo"] !== 1) {
      throw new StasGdpsFixtureLockError("TRACKLET_REFERENCE_INVALID");
    }
  }
}

function validateLock(value: unknown): StasGdpsFixtureLock {
  if (!object(value) || !exactKeys(value, topLevelKeys) ||
      value["schemaVersion"] !== "wsgs-stas-gdps-fixture-lock/1.0" ||
      value["recipeId"] !== "stas-nearest-approach-gdps-current-context" ||
      value["semanticPattern"] !== "STAS_NEAREST_APPROACH_WITH_GDPS_CONTEXT" ||
      value["authority"] !== "WSGS" ||
      value["eventGeometryPath"] !== "/result/shortest_line/coordinates/0") {
    throw new StasGdpsFixtureLockError("IDENTITY_INVALID");
  }
  const runtimeBinding = value["runtimeBinding"];
  if (!object(runtimeBinding) || !exactKeys(runtimeBinding, runtimeBindingKeys) ||
      !commit.test(String(runtimeBinding["gowmSourceCommit"])) ||
      !commit.test(String(runtimeBinding["gdpsSourceCommit"])) ||
      !dataScope.test(String(runtimeBinding["gdpsDataScope"])) ||
      String(runtimeBinding["gdpsDataScope"]).includes("*") ||
      !digest.test(String(runtimeBinding["gatewayInstanceBindingHash"])) ||
      !digest.test(String(runtimeBinding["gdpsProviderImageDigest"]))) {
    throw new StasGdpsFixtureLockError("RUNTIME_BINDING_INVALID");
  }
  const eventGeometryTransform = value["eventGeometryTransform"];
  if (!object(eventGeometryTransform) || !exactKeys(eventGeometryTransform, eventGeometryTransformKeys) ||
      eventGeometryTransform["sourceCrs"] !== "EPSG:32618" ||
      eventGeometryTransform["targetCrs"] !== "EPSG:4326" ||
      eventGeometryTransform["axisOrder"] !== "EAST_NORTH_TO_LONGITUDE_LATITUDE" ||
      eventGeometryTransform["engine"] !== "PROJ4JS/2.22.0") {
    throw new StasGdpsFixtureLockError("EVENT_GEOMETRY_TRANSFORM_INVALID");
  }
  const operationInput = value["operationInput"];
  if (!object(operationInput)) throw new StasGdpsFixtureLockError("OPERATION_INPUT_INVALID");
  validateOperationInput(operationInput);
  if (!digest.test(String(value["operationInputHash"])) ||
      value["operationInputHash"] !== canonicalStasGdpsInputHash(operationInput)) {
    throw new StasGdpsFixtureLockError("OPERATION_INPUT_HASH_MISMATCH");
  }
  if (JSON.stringify(value["products"]) !== JSON.stringify([
    { productType: "SLOPE", productProfile: "DEGREE" },
    { productType: "LAND_COVER", productProfile: "DEFAULT" }
  ])) throw new StasGdpsFixtureLockError("PRODUCT_BINDING_INVALID");
  const operations = value["allowedOperations"];
  if (!Array.isArray(operations) || operations.length !== 2) {
    throw new StasGdpsFixtureLockError("OPERATION_COUNT_INVALID");
  }
  const observed = new Set<string>();
  for (const candidate of operations) {
    if (!object(candidate) || !exactKeys(candidate, [
      "operationId", "operationVersion", "inputSchemaHash", "outputSchemaHash", "semanticProfileHash"
    ])) throw new StasGdpsFixtureLockError("OPERATION_SHAPE_INVALID");
    const key = `${candidate["operationId"]}@${candidate["operationVersion"]}`;
    const expected = expectedOperations[key];
    if (!expected || observed.has(key) || candidate["inputSchemaHash"] !== expected.inputSchemaHash ||
        candidate["outputSchemaHash"] !== expected.outputSchemaHash ||
        candidate["semanticProfileHash"] !== expected.semanticProfileHash) {
      throw new StasGdpsFixtureLockError("OPERATION_LOCK_DRIFT");
    }
    observed.add(key);
  }
  if (observed.size !== Object.keys(expectedOperations).length) {
    throw new StasGdpsFixtureLockError("OPERATION_SET_INVALID");
  }
  return value as unknown as StasGdpsFixtureLock;
}

export function loadStasGdpsFixtureLock(options: {
  lockPath: string;
  expectedSha256: `sha256:${string}`;
}): LoadedStasGdpsFixtureLock {
  if (!digest.test(options.expectedSha256)) throw new StasGdpsFixtureLockError("EXPECTED_HASH_INVALID");
  const bytes = readFileSync(options.lockPath);
  const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
  if (actual !== options.expectedSha256) throw new StasGdpsFixtureLockError("INTEGRITY_MISMATCH");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new StasGdpsFixtureLockError("JSON_INVALID");
  }
  return { lock: validateLock(parsed), lockHash: actual };
}
