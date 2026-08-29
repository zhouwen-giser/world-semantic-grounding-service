import { describe, expect, it } from "vitest";
import { TypedWorldQueryCompiler } from "./compiler.js";
import { queryTemplateRules } from "./recipes.js";
import { authorizeGdps, compileInput } from "./test-fixtures.js";
import type { QuerySemanticPattern } from "./types.js";

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

  it("rejects GDPS when only the global PREVIEW switch is enabled", () => {
    const input = compileInput("GDPS_LAND_COVER_AT_REFERENCE");
    input.maturityPolicy.allowPreview = true;
    expect(compiler.compile(input)).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "RECIPE_LOCK_DRIFT", details: { exactRecipeAuthorized: false } }
    });
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
      expect(result.submission.plan.nodes.at(-1)?.inputs[name === "distanceM" ? "distanceMetres" : name])
        .toMatchObject({ kind: "LITERAL", value });
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
