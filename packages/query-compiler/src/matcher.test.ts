import { describe, expect, it } from "vitest";
import type {
  CapabilityMatchInput,
  CapabilitySemanticProfile,
  SemanticCapabilityRequirement
} from "./types.js";
import {
  CapabilityMatcher,
  TypedWorldQueryCompiler,
  canonicalSemanticProfileHash,
  queryTemplateRules
} from "./index.js";
import { semanticRequirementFor } from "./recipes.js";
import {
  compileInput,
  compilerCatalog,
  observedAt,
  operationFrom,
  type CompilerCatalog
} from "./test-fixtures.js";

const matcher = new CapabilityMatcher();

function currentStateRequirement(): SemanticCapabilityRequirement {
  const rule = queryTemplateRules.find((entry) => entry.pattern === "REFERENCE_CURRENT_STATE")!;
  const step = rule.steps.find((entry) => entry.stepId === "read-current-state")!;
  return semanticRequirementFor(rule, step, "WORLD_EVIDENCE", "LATEST_AT_START");
}

function geometryRequirement(): SemanticCapabilityRequirement {
  const rule = queryTemplateRules.find((entry) => entry.pattern === "REFERENCE_GEOMETRY")!;
  const step = rule.steps.find((entry) => entry.stepId === "read-geometry")!;
  return semanticRequirementFor(rule, step, "WORLD_EVIDENCE", "LATEST_AT_START");
}

function matchInput(
  catalog: CompilerCatalog = compilerCatalog(),
  requirement: SemanticCapabilityRequirement = currentStateRequirement()
): CapabilityMatchInput {
  return {
    requirement,
    ...catalog,
    maturityPolicy: { allowPreview: false },
    degradedPolicy: "REJECT",
    observedAt
  };
}

function replaceProfile(
  catalog: CompilerCatalog,
  key: string,
  update: (profile: CapabilitySemanticProfile) => void
): void {
  const operation = operationFrom(catalog, key);
  const profile = structuredClone(operation.semanticEntry.semanticProfile);
  update(profile);
  const semanticProfileHash = canonicalSemanticProfileHash(profile);
  operation.semanticEntry.semanticProfile = profile;
  operation.semanticEntry.semanticProfileHash = semanticProfileHash;
  operation.descriptor.semanticProfile = profile;
  operation.lock.semanticProfileHash = semanticProfileHash;
}

describe("CapabilityMatcher v2", () => {
  it("selects a stable operation solely by operationId@version and contract evidence", () => {
    const result = matcher.match(matchInput());
    expect(result).toMatchObject({
      status: "MATCHED",
      primary: {
        binding: {
          operationId: "world.get-current-state",
          operationVersion: "1.0",
          maturity: "STABLE",
          availability: "AVAILABLE",
          selectionPolicy: "UNIQUE_SEMANTIC_MATCH"
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain("providerId");
  });

  it("rejects EXPERIMENTAL even if an operation is present in the lock input", () => {
    const catalog = compilerCatalog();
    const operation = operationFrom(catalog, "world.get-current-state@1.0");
    operation.descriptor.maturity = "EXPERIMENTAL";
    expect(matcher.match(matchInput(catalog))).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "MATURITY_NOT_ALLOWED" }
    });
  });

  it("uses live availability and applies the recipe degraded policy", () => {
    const unavailable = compilerCatalog();
    operationFrom(unavailable, "world.get-current-state@1.0").availability.availability = "UNAVAILABLE";
    expect(matcher.match(matchInput(unavailable))).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "OPERATION_UNAVAILABLE" }
    });

    const degraded = compilerCatalog();
    operationFrom(degraded, "world.get-current-state@1.0").availability.availability = "DEGRADED";
    expect(matcher.match(matchInput(degraded))).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "OPERATION_DEGRADED" }
    });
    const allowed = matchInput(degraded);
    allowed.degradedPolicy = "ALLOW";
    expect(matcher.match(allowed)).toMatchObject({
      status: "MATCHED",
      primary: { binding: { availability: "DEGRADED" } }
    });
  });

  it("rejects expired availability observations", () => {
    const catalog = compilerCatalog();
    operationFrom(catalog, "world.get-current-state@1.0").availability.validUntil =
      "2026-08-26T23:59:59.000Z";
    expect(matcher.match(matchInput(catalog))).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "AVAILABILITY_STALE" }
    });
  });

  it.each([
    ["domain", (profile: CapabilitySemanticProfile) => { profile.domain = "CATALOG"; }],
    ["relation", (profile: CapabilitySemanticProfile) => { profile.relationSemantics = ["NEAR"]; }],
    ["accepted reference kinds", (profile: CapabilitySemanticProfile) => { profile.acceptedReferenceKinds = []; }],
    ["produced reference kinds", (profile: CapabilitySemanticProfile) => { profile.producedReferenceKinds = []; }],
    ["spatial exactness", (profile: CapabilitySemanticProfile) => { profile.spatialSemantics = "CANDIDATE"; }],
    ["time semantics", (profile: CapabilitySemanticProfile) => { profile.timeSemantics = "HISTORICAL"; }],
    ["result nature", (profile: CapabilitySemanticProfile) => { profile.resultNature = "PLAN"; }]
  ] as const)("rejects %s drift after validating the explicit semantic hash", (_name, update) => {
    const catalog = compilerCatalog();
    const requirement = geometryRequirement();
    replaceProfile(catalog, "world.get-geometry@1.0", update);
    expect(matcher.match(matchInput(catalog, requirement))).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "SEMANTIC_MISMATCH" }
    });
  });

  it("rejects operation schema hash drift", () => {
    const catalog = compilerCatalog();
    operationFrom(catalog, "world.get-current-state@1.0").descriptor.outputSchemaHash =
      "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    expect(matcher.match(matchInput(catalog))).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "SCHEMA_MISMATCH" }
    });
  });

  it.each([
    ["value kind", { valueKind: "H3_CELL", unitSemantics: "DISCRETE" }],
    ["unit semantics", { valueKind: "ANY", unitSemantics: "LINEAR_METERS" }]
  ] as const)("rejects %s drift on a controlled port", (_name, replacement) => {
    const catalog = compilerCatalog();
    const descriptor = operationFrom(catalog, "world.get-current-state@1.0").descriptor;
    descriptor.ports.inputs = descriptor.ports.inputs.map((port) =>
      port.name === "request" ? { ...port, ...replacement } : port);
    expect(matcher.match(matchInput(catalog))).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "PORT_MISMATCH" }
    });
  });

  it("returns an ambiguity gap for equivalent candidates without frozen priority", () => {
    const catalog = compilerCatalog();
    const original = operationFrom(catalog, "world.get-current-state@1.0");
    catalog.capabilities.push({
      ...structuredClone(original.descriptor),
      operationId: "world.get-current-state-alt"
    });
    catalog.semanticProfiles.push({
      ...structuredClone(original.semanticEntry),
      operationId: "world.get-current-state-alt"
    });
    catalog.operationLocks.push({
      ...structuredClone(original.lock),
      operationId: "world.get-current-state-alt"
    });
    catalog.availability.push({
      ...structuredClone(original.availability),
      operationId: "world.get-current-state-alt"
    });
    const requirement = currentStateRequirement();
    delete requirement.allowedOperationKeys;
    delete requirement.selectionPriority;
    expect(matcher.match(matchInput(catalog, requirement))).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "AMBIGUOUS_MATCH" }
    });
  });

  it("uses a frozen priority deterministically and never substitutes a similar operation", () => {
    const catalog = compilerCatalog();
    const original = operationFrom(catalog, "world.get-current-state@1.0");
    const alternativeKey = "world.get-current-state-alt@1.0";
    catalog.capabilities.push({
      ...structuredClone(original.descriptor),
      operationId: "world.get-current-state-alt"
    });
    catalog.semanticProfiles.push({
      ...structuredClone(original.semanticEntry),
      operationId: "world.get-current-state-alt"
    });
    catalog.operationLocks.push({
      ...structuredClone(original.lock),
      operationId: "world.get-current-state-alt"
    });
    catalog.availability.push({
      ...structuredClone(original.availability),
      operationId: "world.get-current-state-alt"
    });

    const prioritized = currentStateRequirement();
    prioritized.allowedOperationKeys = ["world.get-current-state@1.0", alternativeKey];
    prioritized.selectionPriority = [alternativeKey, "world.get-current-state@1.0"];
    expect(matcher.match(matchInput(catalog, prioritized))).toMatchObject({
      status: "MATCHED",
      primary: {
        binding: {
          operationId: "world.get-current-state-alt",
          selectionPolicy: `FROZEN_PRIORITY:${alternativeKey}`
        }
      }
    });

    const noSubstitution = currentStateRequirement();
    catalog.operationLocks = catalog.operationLocks.filter((lock) =>
      lock.operationId !== "world.get-current-state");
    expect(matcher.match(matchInput(catalog, noSubstitution))).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "NOT_REGISTERED", details: { substituted: false } }
    });
  });

  it("requires snapshot support compatible with the explicit policy", () => {
    const catalog = compilerCatalog();
    operationFrom(catalog, "world.get-current-state@1.0").lock.snapshotSupport = "NONE";
    expect(matcher.match(matchInput(catalog))).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "SNAPSHOT_UNSUPPORTED" }
    });
  });

  it("does not bind a candidate-only operation directly to an exact requirement", () => {
    const input = compileInput("H3_EXACT_VERIFY");
    input.maturityPolicy.allowPreview = true;
    const rule = queryTemplateRules.find((entry) => entry.pattern === "H3_EXACT_VERIFY")!;
    const requirement = semanticRequirementFor(
      rule,
      rule.steps[0]!,
      input.requiredForProduct,
      "LATEST_AT_START"
    );
    requirement.allowCandidateWithExactVerification = false;
    expect(matcher.match({
      requirement,
      capabilities: input.capabilities,
      semanticProfiles: input.semanticProfiles,
      operationLocks: input.operationLocks,
      availability: input.availability,
      maturityPolicy: input.maturityPolicy,
      degradedPolicy: "REJECT",
      observedAt
    })).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { reason: "SEMANTIC_MISMATCH" }
    });
  });

  it("fails closed when the declared exact verifier is unavailable", () => {
    const input = compileInput("H3_EXACT_VERIFY");
    input.maturityPolicy.allowPreview = true;
    operationFrom(input, "spatial.find-intersections@1.0").availability.availability = "UNAVAILABLE";
    expect(new TypedWorldQueryCompiler().compile(input)).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: {
        reason: "EXACT_VERIFIER_UNAVAILABLE",
        details: { verifierOperationKey: "spatial.find-intersections@1.0" }
      }
    });
  });
});
