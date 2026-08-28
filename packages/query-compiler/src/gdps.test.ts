import { describe, expect, it } from "vitest";
import { TypedWorldQueryCompiler } from "./compiler.js";
import { queryTemplateRules } from "./recipes.js";
import { compileInput } from "./test-fixtures.js";
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
      gap: { reason: "MATURITY_NOT_ALLOWED", details: { explicitRecipeAuthorized: false } }
    });
  });

  it.each(cases)("compiles explicitly locked recipe %s", (pattern, operations) => {
    const input = compileInput(pattern);
    input.maturityPolicy.allowPreview = true;
    input.previewRecipeIds = [pattern];
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
    implicit.previewRecipeIds = [implicit.pattern];
    delete implicit.parameterValues?.["explicitProductId"];
    const implicitPlan = compiler.compile(implicit);
    expect(implicitPlan.status).toBe("COMPILED");
    if (implicitPlan.status !== "COMPILED") return;
    expect(JSON.stringify(implicitPlan.submission)).not.toContain("productId");

    const explicit = compileInput("GDPS_HIGH_GROUND_IN_AREA");
    explicit.maturityPolicy.allowPreview = true;
    explicit.previewRecipeIds = [explicit.pattern];
    explicit.parameterValues = { ...explicit.parameterValues, explicitProductId: "terrain-main" };
    const explicitPlan = compiler.compile(explicit);
    expect(explicitPlan.status).toBe("COMPILED");
    if (explicitPlan.status !== "COMPILED") return;
    expect(explicitPlan.submission.parameters["explicitProductId"]).toBe("terrain-main");
    expect(explicitPlan.submission.plan.nodes.at(-1)?.inputs["explicitProductId"]).toMatchObject({
      kind: "REQUEST_PATH", path: "/explicitProductId", targetPath: "/productId"
    });
  });

  it("preserves the 500 metre obstacle radius as a typed request binding", () => {
    const input = compileInput("GDPS_OBSTACLES_NEAR_REFERENCE");
    input.maturityPolicy.allowPreview = true;
    input.previewRecipeIds = [input.pattern];
    input.parameterValues = { distanceMetres: 500 };
    const result = compiler.compile(input);
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(result.submission.plan.nodes.at(-1)?.inputs["distanceMetres"]).toMatchObject({
      kind: "REQUEST_PATH",
      path: "/distanceMetres",
      targetPath: "/distanceMetres",
      port: { unitSemantics: "LINEAR_METERS" }
    });
  });
});
