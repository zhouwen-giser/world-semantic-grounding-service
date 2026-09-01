import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { TypedWorldQueryCompiler } from "./compiler.js";
import { queryTemplateRules } from "./recipes.js";
import { authorizeGdps, compileInput, digest } from "./test-fixtures.js";
import type {
  CapabilityDescriptor,
  CapabilitySemanticProfile,
  CompileInput,
  OperationLock,
  QuerySemanticPattern
} from "./types.js";

interface PublishedGdpsOperation {
  operationId: string;
  operationVersion: string;
  semanticProfile: CapabilitySemanticProfile;
  semanticProfileHash: `sha256:${string}`;
}

const generatedArtifactRoot = resolve(
  import.meta.dirname,
  "..", "..", "..", "contracts", "generated", "gdps-v0.2.1"
);
const publishedClosure = JSON.parse(readFileSync(
  resolve(generatedArtifactRoot, "gdps-finding-contract-closure.json"),
  "utf8"
)) as {
  provider: { manifest: { capabilities: CapabilityDescriptor[] } };
  operations: PublishedGdpsOperation[];
};
const publishedOperationLock = JSON.parse(readFileSync(
  resolve(generatedArtifactRoot, "wsgs-southbound-operation-lock-v2.json"),
  "utf8"
)) as { defaultOperations: OperationLock[]; previewOperations: OperationLock[] };

function usePublishedGdpsOperation(input: CompileInput, operationId: string): void {
  const descriptor = publishedClosure.provider.manifest.capabilities.find((entry) =>
    entry.operationId === operationId && entry.operationVersion === "1.0");
  const semantic = publishedClosure.operations.find((entry) =>
    entry.operationId === operationId && entry.operationVersion === "1.0");
  const lock = [...publishedOperationLock.defaultOperations, ...publishedOperationLock.previewOperations]
    .find((entry) => entry.operationId === operationId && entry.operationVersion === "1.0");
  if (!descriptor || !semantic || !lock) throw new Error(`PUBLISHED_GDPS_OPERATION_MISSING:${operationId}`);

  input.capabilities = input.capabilities.map((entry) =>
    entry.operationId === operationId && entry.operationVersion === "1.0" ? descriptor : entry);
  input.semanticProfiles = input.semanticProfiles.map((entry) =>
    entry.operationId === operationId && entry.operationVersion === "1.0"
      ? {
          operationId: semantic.operationId,
          operationVersion: semantic.operationVersion,
          semanticProfile: semantic.semanticProfile,
          semanticProfileHash: semantic.semanticProfileHash
        }
      : entry);
  input.operationLocks = input.operationLocks.map((entry) =>
    entry.operationId === operationId && entry.operationVersion === "1.0" ? lock : entry);
  input.availability = input.availability.map((entry) =>
    entry.operationId === operationId && entry.operationVersion === "1.0"
      ? { ...entry, maturity: lock.maturity }
      : entry);
}

const cases: Array<readonly [QuerySemanticPattern, readonly string[]]> = [
  ["GDPS_LAND_COVER_AT_REFERENCE", ["reference.resolve", "world.get-current-state", "landcover.get-class"]],
  ["GDPS_WETLANDS_IN_AREA", ["reference.resolve", "world.get-geometry", "hydrology.find-wetlands"]],
  ["GDPS_OBSTACLES_NEAR_REFERENCE", ["reference.resolve", "world.get-current-state", "obstacle.find-nearby"]],
  ["GDPS_BLOCKED_AREAS_IN_AREA", ["reference.resolve", "world.get-geometry", "traversability.find-blocked"]],
  ["GDPS_HIGH_GROUND_IN_AREA", ["reference.resolve", "world.get-geometry", "terrain.find-high-ground"]],
  ["GDPS_ELEVATION_AT_REFERENCE", ["reference.resolve", "world.get-current-state", "elevation.sample"]],
  ["GDPS_TRAVERSABILITY_EXPLAIN_AT_REFERENCE", ["reference.resolve", "world.get-current-state", "traversability.explain"]]
];

const genericCases: Array<readonly [QuerySemanticPattern, readonly string[], Record<string, unknown>]> = [
  ["GDPS_GENERIC_SAMPLE_VALUE", ["reference.resolve", "world.get-current-state", "geo-raster.sample"], {}],
  ["GDPS_GENERIC_PROFILE_VALUE", ["reference.resolve", "world.get-geometry", "geo-raster.profile"], {}],
  ["GDPS_GENERIC_FIND_CLASS", ["reference.resolve", "world.get-geometry", "geo-raster.find-by-class"], { classCodes: ["HIGH"] }],
  ["GDPS_GENERIC_FIND_RANGE", ["reference.resolve", "world.get-geometry", "geo-raster.find-by-range"], { ranges: [{ minimum: 15, maximum: 30 }] }],
  ["GDPS_GENERIC_VECTOR_IN_AREA", ["reference.resolve", "world.get-geometry", "geo-vector.find-in-area"], {}],
  ["GDPS_GENERIC_VECTOR_NEARBY", ["reference.resolve", "world.get-current-state", "geo-vector.find-nearby"], { distanceM: 500 }],
  ["GDPS_GENERIC_VECTOR_INTERSECTS", ["reference.resolve", "world.get-geometry", "geo-vector.find-intersections"], {}]
];

describe("GDPS typed query plans", () => {
  const compiler = new TypedWorldQueryCompiler();

  function trustedNearestApproachInput(): CompileInput {
    const input = compileInput("STAS_NEAREST_APPROACH_WITH_GDPS_CONTEXT");
    input.maturityPolicy.allowPreview = true;
    input.operationInput = {
      dataScopeId: "00000000-0000-4000-8000-000000000001",
      dimensionPolicy: "2D",
      timeRange: { end: "2026-08-13T01:00:06.000Z", start: "2026-08-13T01:00:00.000Z" },
      trackletA: { trackletId: "40000000-0000-4000-8000-000000000001", versionNo: 1 },
      trackletB: { trackletId: "40000000-0000-4000-8000-000000000002", versionNo: 1 },
      uncertaintyPolicy: "NOMINAL_WITH_SCALAR_SENSITIVITY"
    };
    input.parameterValues = {};
    authorizeGdps(input);
    return input;
  }

  it("requires an exact trusted fixture lock for the STAS plus GDPS recipe", () => {
    const input = trustedNearestApproachInput();

    expect(compiler.compile(input)).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "SCHEMA_MISMATCH", details: { reason: "TRUSTED_OPERATION_INPUT_REQUIRED" } }
    });
  });

  it("compiles locked nearest-approach geometry into two complementary current products", () => {
    const input = trustedNearestApproachInput();
    input.trustedOperationInput = {
      source: "RUNTIME_FIXTURE_LOCK",
      inputHash: digest(JSON.stringify(input.operationInput))
    };

    const result = compiler.compile(input);
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(result.submission.plan.nodes.map((node) => node.operation.operationId)).toEqual([
      "stas.nearest-approach",
      "geo-raster.sample",
      "geo-raster.sample"
    ]);
    for (const node of result.submission.plan.nodes.slice(1)) {
      expect(node.inputs["pointCoordinates"]).toMatchObject({
        kind: "NODE_OUTPUT",
        nodeId: "Node_1",
        outputPort: "result",
        path: "/result/shortest_line/coordinates/0",
        targetPath: "/point/coordinates"
      });
    }
    expect(result.submission.plan.nodes[1]?.inputs).toMatchObject({
      productType: { kind: "LITERAL", value: "SLOPE", targetPath: "/productType" },
      productProfile: { kind: "LITERAL", value: "DEGREE", targetPath: "/productProfile" },
      pointType: { kind: "LITERAL", value: "Point", targetPath: "/point/type" }
    });
    expect(result.submission.plan.nodes[2]?.inputs).toMatchObject({
      productType: { kind: "LITERAL", value: "LAND_COVER", targetPath: "/productType" },
      productProfile: { kind: "LITERAL", value: "DEFAULT", targetPath: "/productProfile" },
      pointType: { kind: "LITERAL", value: "Point", targetPath: "/point/type" }
    });
    expect(result.submission.plan.outputs.map((output) => output.name)).toEqual([
      "temporalEvidence", "slopeEvidence", "landCoverEvidence"
    ]);
    expect(JSON.stringify(result.submission.plan)).not.toMatch(/providerId|providerUrl|https?:\/\//iu);

    (input.operationInput["trackletA"] as Record<string, unknown>)["versionNo"] = 2;
    expect(compiler.compile(input)).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "SCHEMA_MISMATCH", details: { reason: "TRUSTED_OPERATION_INPUT_REQUIRED" } }
    });
  });

  it.each([
    "GDPS_WETLANDS_IN_AREA",
    "GDPS_BLOCKED_AREAS_IN_AREA",
    "GDPS_HIGH_GROUND_IN_AREA"
  ] as const)("matches %s against the published generic GDPS result port", (pattern) => {
    const domainRequirement = queryTemplateRules.find((rule) => rule.pattern === pattern)?.steps.at(-1)?.requirement;
    expect(domainRequirement?.outputPorts).toEqual([
      { name: "result", valueKind: "ANY", unitSemantics: "UNSPECIFIED" }
    ]);
  });

  it("matches obstacle.find-nearby against its published NEAR semantics", () => {
    const requirement = queryTemplateRules
      .find((rule) => rule.pattern === "GDPS_OBSTACLES_NEAR_REFERENCE")?.steps.at(-1)?.requirement;
    expect(requirement?.relationSemantics).toEqual(["NEAR"]);
  });

  it("matches combined GDPS context against its published request/result ports", () => {
    const steps = queryTemplateRules
      .find((rule) => rule.pattern === "STAS_NEAREST_APPROACH_WITH_GDPS_CONTEXT")?.steps.slice(1);
    expect(steps).toHaveLength(2);
    for (const step of steps ?? []) {
      expect(step.requirement.inputPorts).toEqual([
        { name: "request", valueKind: "ANY", unitSemantics: "UNSPECIFIED" }
      ]);
      expect(step.requirement.outputPorts).toEqual([
        { name: "result", valueKind: "ANY", unitSemantics: "UNSPECIFIED" }
      ]);
    }
  });

  it("rejects GDPS when only the global PREVIEW switch is enabled", () => {
    const input = compileInput("GDPS_LAND_COVER_AT_REFERENCE");
    input.maturityPolicy.allowPreview = true;
    expect(compiler.compile(input)).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "RECIPE_LOCK_DRIFT", details: { exactRecipeAuthorized: false } }
    });
  });

  it("compiles source currentness as one exact Gateway operation without a descriptor binding", () => {
    const input = compileInput("GDPS_VALIDATE_SOURCE_CURRENTNESS");
    input.maturityPolicy.allowPreview = true;
    usePublishedGdpsOperation(input, "geo-product.check-current");
    input.operationInput = {
      productId: "gdps-baseline-dtm",
      contentHash: `sha256:${"a".repeat(64)}`
    };
    const lock = input.operationLocks.find((entry) => entry.operationId === "geo-product.check-current")!;
    input.gdpsRecipeAuthorization = {
      recipeId: "gdps-check-current-geo-product",
      semanticPattern: "GDPS_VALIDATE_SOURCE_CURRENTNESS",
      recipeLockHash: `sha256:${"f".repeat(64)}`,
      descriptorConstraint: null,
      previewAuthorizationRequired: true,
      allowedOperations: [{
        operationId: lock.operationId,
        operationVersion: lock.operationVersion,
        inputSchemaHash: lock.inputSchemaHash,
        outputSchemaHash: lock.outputSchemaHash,
        semanticProfileHash: lock.semanticProfileHash
      }]
    };
    input.trustedGdpsRecipeLockHash = input.gdpsRecipeAuthorization.recipeLockHash;
    input.parameterValues = {};
    const result = compiler.compile(input);
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(result.submission.plan.nodes).toHaveLength(1);
    expect(result.submission.plan.nodes[0]).toMatchObject({
      operation: { operationId: "geo-product.check-current", operationVersion: "1.0" },
      inputs: { request: { kind: "REQUEST_PATH", path: "/operationInput" } }
    });
    expect(result.submission.parameters).toEqual({ operationInput: input.operationInput });
    expect(JSON.stringify(result.submission)).not.toContain("sourceProductId");
  });

  it.each(cases)("compiles explicitly locked recipe %s", (pattern, operations) => {
    const input = compileInput(pattern);
    input.maturityPolicy.allowPreview = true;
    authorizeGdps(input);
    const result = compiler.compile(input);
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(result.submission.plan.nodes.map((node) => node.operation.operationId)).toEqual(operations);
    expect(result.submission.snapshotPolicy).toEqual({ mode: "LATEST_AT_START", allowDowngrade: false });
    expect(JSON.stringify(result)).not.toContain("providerId");
  });

  it("passes productId only when the user supplied an explicit preference", () => {
    const implicit = compileInput("GDPS_HIGH_GROUND_IN_AREA");
    implicit.maturityPolicy.allowPreview = true;
    authorizeGdps(implicit);
    delete implicit.parameterValues?.["explicitProductId"];
    const implicitPlan = compiler.compile(implicit);
    expect(implicitPlan.status).toBe("COMPILED");
    if (implicitPlan.status !== "COMPILED") return;
    expect(JSON.stringify(implicitPlan.submission)).not.toContain("productId");

    const explicit = compileInput("GDPS_HIGH_GROUND_IN_AREA");
    explicit.maturityPolicy.allowPreview = true;
    authorizeGdps(explicit);
    explicit.parameterValues = { ...explicit.parameterValues, explicitProductId: "terrain-main" };
    const explicitPlan = compiler.compile(explicit);
    expect(explicitPlan.status).toBe("COMPILED");
    if (explicitPlan.status !== "COMPILED") return;
    expect(explicitPlan.submission.parameters["explicitProductId"]).toBe("terrain-main");
    expect(explicitPlan.submission.plan.nodes.at(-1)?.inputs["explicitProductId"]).toMatchObject({
      kind: "LITERAL", value: "terrain-main", targetPath: "/productId"
    });
  });

  it("preserves the 500 metre obstacle radius as a typed request binding", () => {
    const input = compileInput("GDPS_OBSTACLES_NEAR_REFERENCE");
    input.maturityPolicy.allowPreview = true;
    authorizeGdps(input);
    input.parameterValues = { ...input.parameterValues, distanceMetres: 500 };
    const result = compiler.compile(input);
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(result.submission.plan.nodes.at(-1)?.inputs["distanceMetres"]).toMatchObject({
      kind: "LITERAL",
      value: 500,
      targetPath: "/distanceMetres",
      port: { unitSemantics: "LINEAR_METERS" }
    });
  });

  it.each(genericCases)("builds descriptor-driven generic plan %s", (pattern, operations, parameters) => {
    const input = compileInput(pattern);
    input.maturityPolicy.allowPreview = true;
    usePublishedGdpsOperation(input, operations.at(-1)!);
    authorizeGdps(input, {
      descriptorId: pattern.includes("VECTOR") ? "DRAINAGE_NETWORK/DRAINAGE_FEATURES" : "SLOPE/DEGREE",
      productType: pattern.includes("VECTOR") ? "DRAINAGE_NETWORK" : "SLOPE",
      productProfile: pattern.includes("VECTOR") ? "DRAINAGE_FEATURES" : "DEGREE"
    });
    input.parameterValues = { ...input.parameterValues, ...parameters };
    const result = compiler.compile(input);
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(result.submission.plan.nodes.map((node) => node.operation.operationId)).toEqual(operations);
    expect(result.submission.plan.nodes.at(-1)?.inputs).toEqual(expect.objectContaining({
      productType: expect.objectContaining({ kind: "LITERAL", targetPath: "/productType" }),
      productProfile: expect.objectContaining({ kind: "LITERAL", targetPath: "/productProfile" })
    }));
    for (const [name, value] of Object.entries(parameters)) {
      const bindingName = name === "distanceM" ? "distanceMetres" : name;
      const expectedSchemaUri = name === "distanceM"
        ? "urn:gowm:v0.2:value:number"
        : name === "propertyFilters"
          ? "urn:gowm:v0.2:value:object"
          : "urn:gowm:v0.2:value:array";
      expect(result.submission.plan.nodes.at(-1)?.inputs[bindingName])
        .toMatchObject({ kind: "LITERAL", value, port: { schemaUri: expectedSchemaUri } });
    }
    if (pattern === "GDPS_GENERIC_SAMPLE_VALUE" || pattern === "GDPS_GENERIC_VECTOR_NEARBY") {
      expect(result.submission.plan.nodes.at(-1)?.inputs["pointType"]).toMatchObject({
        kind: "LITERAL", value: "Point", targetPath: "/point/type"
      });
    }
    expect(JSON.stringify(result.submission)).not.toContain("providerId");
  });

  it("rejects descriptor and operation hash drift before compilation", () => {
    const descriptorDrift = compileInput("GDPS_GENERIC_FIND_RANGE");
    descriptorDrift.maturityPolicy.allowPreview = true;
    authorizeGdps(descriptorDrift, { descriptorId: "SLOPE/DEGREE", productType: "SLOPE", productProfile: "DEGREE" });
    descriptorDrift.parameterValues!["descriptorHash"] = `sha256:${"0".repeat(64)}`;
    expect(compiler.compile(descriptorDrift)).toMatchObject({ status: "CAPABILITY_GAP", gap: { reason: "DESCRIPTOR_LOCK_DRIFT" } });

    const recipeDrift = compileInput("GDPS_GENERIC_FIND_RANGE");
    recipeDrift.maturityPolicy.allowPreview = true;
    authorizeGdps(recipeDrift, { descriptorId: "SLOPE/DEGREE", productType: "SLOPE", productProfile: "DEGREE" });
    const allowed = recipeDrift.gdpsRecipeAuthorization!.allowedOperations[0]!;
    recipeDrift.gdpsRecipeAuthorization = {
      ...recipeDrift.gdpsRecipeAuthorization!,
      allowedOperations: [{ ...allowed, inputSchemaHash: `sha256:${"0".repeat(64)}` }]
    };
    expect(compiler.compile(recipeDrift)).toMatchObject({ status: "CAPABILITY_GAP", gap: { reason: "RECIPE_LOCK_DRIFT" } });

    const lockDrift = compileInput("GDPS_GENERIC_FIND_RANGE");
    lockDrift.maturityPolicy.allowPreview = true;
    authorizeGdps(lockDrift, { descriptorId: "SLOPE/DEGREE", productType: "SLOPE", productProfile: "DEGREE" });
    lockDrift.gdpsRecipeAuthorization = {
      ...lockDrift.gdpsRecipeAuthorization!,
      recipeLockHash: `sha256:${"f".repeat(64)}`
    };
    expect(compiler.compile(lockDrift)).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "RECIPE_LOCK_DRIFT", details: { trustedRecipeLockMatched: false } }
    });
  });
});
