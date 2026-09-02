import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  compileGdpsV032Requirement,
  type GdpsV032BindingCatalog,
  type GdpsV032CatalogBinding,
  type GdpsV032OperationState,
  type GdpsV032Requirement,
  type GdpsV032TrustedContext
} from "./gdps-v032.js";

const catalog = JSON.parse(readFileSync(resolve(
  import.meta.dirname,
  "..", "..", "..", "contracts", "integrations", "gdps", "wsgs-gdps-binding-catalog.json"
), "utf8")) as GdpsV032BindingCatalog;
const binding = catalog.bindings.find((entry) =>
  entry.bindingId === "SLOPE/DEGREE::SAMPLE_VALUE") as GdpsV032CatalogBinding;
const requirement: GdpsV032Requirement = {
  schemaVersion: "wsgs-gdps-requirement/1.0",
  requirementId: "req-1",
  kind: "POINT_VALUE",
  productType: "SLOPE",
  productProfile: "DEGREE",
  geometry: { type: "Point", coordinates: [116.3, 39.9] },
  timeIntent: "CURRENT"
};
const trustedContext: GdpsV032TrustedContext = {
  servicePrincipalId: "wsgs-service",
  dataScope: "scope-gdps-v032",
  maximumGeometryBytes: 16_384
};

function state(value: GdpsV032CatalogBinding = binding): GdpsV032OperationState {
  return {
    operationId: value.operationId,
    operationVersion: value.operationVersion,
    maturity: "PREVIEW",
    inputSchemaHash: value.inputSchemaHash,
    outputSchemaHash: value.outputSchemaHash,
    semanticProfileHash: value.semanticProfileHash
  };
}

function compile(overrides: Partial<{
  requirement: GdpsV032Requirement;
  catalog: GdpsV032BindingCatalog;
  trustedContext: GdpsV032TrustedContext;
  operationState: GdpsV032OperationState;
}> = {}) {
  return compileGdpsV032Requirement({
    requirement,
    catalog,
    trustedContext,
    operationState: state(),
    ...overrides
  });
}

describe("GDPS v0.3.2 authoritative binding compiler", () => {
  it("compiles an exact locked PREVIEW binding without a default productId", () => {
    const result = compile();
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(result.request.operation).toEqual({
      operationId: binding.operationId,
      operationVersion: binding.operationVersion
    });
    expect(result.request.locks).toEqual({
      inputSchemaHash: binding.inputSchemaHash,
      outputSchemaHash: binding.outputSchemaHash,
      semanticProfileHash: binding.semanticProfileHash,
      descriptorHash: binding.descriptorHash
    });
    expect(result.request.input).not.toHaveProperty("productId");
    expect(JSON.stringify(result.request)).not.toContain("providerUrl");
  });

  it("allows a productId only from a trusted explicit selection", () => {
    const result = compile({
      trustedContext: {
        ...trustedContext,
        explicitProductSelection: {
          productId: "slope-current-a",
          source: "USER_EXPLICIT",
          descriptorHash: binding.descriptorHash
        }
      }
    });
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(result.request.input["productId"]).toBe("slope-current-a");
  });

  it("accepts the platform identity character set and still rejects unsafe identities", () => {
    expect(compile({
      trustedContext: {
        ...trustedContext,
        servicePrincipalId: "7/wsgs:runtime",
        dataScope: "scope/gdps:v032"
      }
    })).toMatchObject({ status: "COMPILED" });
    for (const servicePrincipalId of ["wsgs runtime", "*", ""]) {
      expect(compile({
        trustedContext: { ...trustedContext, servicePrincipalId }
      })).toMatchObject({ status: "GAP", reason: "INVALID_REQUIREMENT" });
    }
  });

  it.each(["productId", "providerUrl", "dataScope", "operationId", "inputSchemaHash"])(
    "rejects caller-controlled %s injection",
    (key) => {
      expect(compile({
        requirement: { ...requirement, [key]: "attacker-value" } as GdpsV032Requirement
      })).toMatchObject({ status: "GAP", reason: "INVALID_REQUIREMENT" });
    }
  );

  it("rejects explicit selection when descriptor revalidation fails", () => {
    expect(compile({
      trustedContext: {
        ...trustedContext,
        explicitProductSelection: {
          productId: "slope-current-a",
          source: "REVALIDATED_PRIOR_REFERENCE",
          descriptorHash: "sha256:invalid"
        }
      }
    })).toMatchObject({ status: "GAP", reason: "EXPLICIT_PRODUCT_SELECTION_INVALID" });
  });

  it("rejects historical intent without falling back to current data", () => {
    expect(compile({
      requirement: { ...requirement, timeIntent: "HISTORICAL" }
    })).toMatchObject({ status: "GAP", reason: "HISTORICAL_INTENT_UNSUPPORTED" });
  });

  it("rejects maturity escalation and exact operation hash drift", () => {
    expect(compile({
      operationState: { ...state(), maturity: "STABLE" }
    })).toMatchObject({ status: "GAP", reason: "MATURITY_NOT_ALLOWED" });
    expect(compile({
      operationState: { ...state(), inputSchemaHash: "sha256:drift" }
    })).toMatchObject({ status: "GAP", reason: "OPERATION_LOCK_DRIFT" });
  });

  it("rejects catalog policy and family lock drift", () => {
    expect(compile({
      catalog: {
        ...catalog,
        policy: { ...catalog.policy, historicalFallback: "ALLOWED" as "FORBIDDEN" }
      }
    })).toMatchObject({ status: "GAP", reason: "CATALOG_POLICY_INVALID" });
    expect(compile({
      catalog: {
        ...catalog,
        operationFamilies: catalog.operationFamilies.map((entry) =>
          entry.familyId === binding.familyId ? { ...entry, inputSchemaHash: "sha256:drift" } : entry)
      }
    })).toMatchObject({ status: "GAP", reason: "CATALOG_LOCK_DRIFT" });
  });

  it("preserves ambiguity instead of choosing the first binding", () => {
    expect(compile({
      catalog: { ...catalog, bindings: [...catalog.bindings, { ...binding, bindingId: "duplicate" }] }
    })).toMatchObject({ status: "GAP", reason: "BINDING_AMBIGUOUS" });
  });

  it("requires platformProfile only where the descriptor policy requires it", () => {
    const required = catalog.bindings.find((entry) =>
      entry.platformProfilePolicy === "REQUIRED" && entry.requirementKind === "POINT_CLASSIFICATION")!;
    const requiredRequirement: GdpsV032Requirement = {
      ...requirement,
      kind: required.requirementKind,
      productType: required.productType,
      productProfile: required.productProfile
    };
    expect(compile({
      requirement: requiredRequirement,
      operationState: state(required)
    })).toMatchObject({ status: "GAP", reason: "PLATFORM_PROFILE_REQUIRED" });
    expect(compile({
      requirement: { ...requiredRequirement, platformProfile: "ROBOT_DOG" },
      operationState: state(required)
    })).toMatchObject({ status: "COMPILED" });
  });

  it("enforces geometry type and byte budgets", () => {
    expect(compile({
      requirement: { ...requirement, geometry: { type: "Polygon", coordinates: [] } }
    })).toMatchObject({ status: "GAP", reason: "GEOMETRY_INVALID" });
    expect(compile({
      trustedContext: { ...trustedContext, maximumGeometryBytes: 1 }
    })).toMatchObject({ status: "GAP", reason: "GEOMETRY_BUDGET_EXCEEDED" });
  });

  it("rejects parameters outside the bounded whitelist", () => {
    expect(compile({
      requirement: { ...requirement, parameters: { sql: "select *" } }
    })).toMatchObject({ status: "GAP", reason: "PARAMETER_POLICY_VIOLATION" });
  });
});
