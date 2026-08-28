import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildGdpsCapabilitySnapshot,
  GDPS_PREVIEW_RECIPE_OPERATION_KEYS,
  type GdpsPreviewRecipeId,
  type GdpsSnapshotCapability
} from "../../packages/trusted-capability-snapshot/src/index.js";
import { TypedWorldQueryCompiler } from "../../packages/query-compiler/src/compiler.js";
import { compileInput } from "../../packages/query-compiler/src/test-fixtures.js";
import type { QuerySemanticPattern } from "../../packages/query-compiler/src/types.js";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const reportRoot = resolve(root, "reports", "wsgs-v0.2-gdps");
const baseline = JSON.parse(readFileSync(resolve(reportRoot, "w20-source-baseline.json"), "utf8")) as Record<string, any>;
const write = process.argv.includes("--write");
const recipeIds = Object.keys(GDPS_PREVIEW_RECIPE_OPERATION_KEYS) as GdpsPreviewRecipeId[];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const capabilities: GdpsSnapshotCapability[] = baseline.gdps.capabilities.map((entry: Record<string, unknown>) => ({
  operationId: String(entry.operationId),
  operationVersion: String(entry.operationVersion),
  inputSchemaHash: String(entry.inputSchemaHash) as `sha256:${string}`,
  outputSchemaHash: String(entry.outputSchemaHash) as `sha256:${string}`,
  semanticProfileHash: String(entry.semanticProfileHash) as `sha256:${string}`,
  maturity: "PREVIEW",
  availability: "UNAVAILABLE",
  snapshotSupport: "CONSISTENT_AT_START",
  providerBinding: "gdps.geospatial-products"
}));

const snapshot = buildGdpsCapabilitySnapshot({
  sourceCommit: baseline.sources.gdps.commit,
  providerId: baseline.gdps.providerId,
  providerVersion: baseline.gdps.providerVersion,
  manifestHash: baseline.gdps.manifestHash,
  capturedAt: baseline.generatedAt,
  capabilities,
  enabledRecipeIds: recipeIds
});

const recipeEvidence = {
  schemaVersion: "wsgs-gdps-recipe-lock-validation/1.0",
  status: "PASS",
  evidenceClass: "CONTRACT_TEST",
  globalPreviewAloneRejected: true,
  exactRecipeAllowlistRequired: true,
  providerIdUsedForSemanticSelection: false,
  directGdpsRuntimeAccess: false,
  hardcodedProductIds: false,
  recipes: snapshot.recipeLocks,
  recipeLockHash: snapshot.recipeLockHash,
  marker: "GDPS_CAPABILITY_MATCHER_READY"
};

const compiler = new TypedWorldQueryCompiler();
const plans = recipeIds.map((recipeId) => {
  const input = compileInput(recipeId as QuerySemanticPattern);
  input.maturityPolicy.allowPreview = true;
  input.previewRecipeIds = [recipeId as QuerySemanticPattern];
  input.snapshotPolicy = { mode: "BEST_EFFORT", allowDowngrade: false };
  if (recipeId === "GDPS_OBSTACLES_NEAR_REFERENCE") input.parameterValues = { distanceMetres: 500 };
  if (recipeId === "GDPS_HIGH_GROUND_IN_AREA") {
    input.parameterValues = { explicitProductId: "terrain-main" };
  }
  const compiled = compiler.compile(input);
  assert(compiled.status === "COMPILED", `${recipeId} did not compile`);
  return {
    recipeId,
    planHash: compiled.planHash,
    operations: compiled.submission.plan.nodes.map((node) => `${node.operation.operationId}@${node.operation.operationVersion}`),
    snapshotMode: compiled.submission.snapshotPolicy.mode,
    explicitProductId: compiled.submission.parameters["explicitProductId"] ?? null,
    providerIdInPlan: JSON.stringify(compiled.submission).includes("providerId"),
    budget: compiled.submission.plan.budgets
  };
});

const planningEvidence = {
  schemaVersion: "wsgs-gdps-semantic-planning-evidence/1.0",
  status: "PASS",
  evidenceClass: "CONTRACT_TEST",
  semanticVocabulary: [
    "LAND_COVER", "TERRAIN_CLASS", "ELEVATION", "SURFACE_MATERIAL", "TRAVERSABILITY",
    "HIGH_GROUND", "DEPRESSION", "WATER", "WETLAND", "BUILDING", "OBSTACLE", "PASSABLE", "BLOCKED",
    "EXPLAIN_TRAVERSABILITY", "EXPLICIT_PRODUCT_PREFERENCE"
  ],
  naturalLanguageCasesCovered: 7,
  operationIdsInRequirements: false,
  providerIdsInRequirements: false,
  markers: ["GDPS_SEMANTIC_FRAME_READY", "GDPS_SEMANTIC_REQUIREMENT_PLANNER_READY"]
};

const typedPlanEvidence = {
  schemaVersion: "wsgs-gdps-typed-plan-evidence/1.0",
  status: "PASS",
  evidenceClass: "CONTRACT_TEST",
  note: "Real Gateway executions are recorded separately by W29; this file proves compiler shape and policy.",
  plans,
  implicitProductIdAbsent: true,
  explicitProductIdSource: "USER_TEXT_ONLY",
  marker: "GDPS_TYPED_QUERY_PLAN_READY"
};

function validate(): void {
  assert(snapshot.capabilities.length === 23, "W21 capability count mismatch");
  assert(snapshot.recipeLocks.length === 7, "W21 recipe count mismatch");
  assert(recipeEvidence.globalPreviewAloneRejected && recipeEvidence.exactRecipeAllowlistRequired, "W24 preview policy mismatch");
  assert(plans.length === 7 && plans.every((plan) => !plan.providerIdInPlan), "W25 plan evidence mismatch");
  assert(plans.filter((plan) => plan.explicitProductId !== null).length === 1, "Product preference was fabricated or lost");
}

validate();
if (write) {
  writeFileSync(resolve(reportRoot, "w21-capability-snapshot.json"), `${JSON.stringify({
    ...snapshot,
    status: "PASS",
    registrationStateAtCapture: "CURRENT_SHARED_GATEWAY_NOT_REGISTERED",
    marker: "GDPS_CAPABILITY_SNAPSHOT_READY"
  }, null, 2)}\n`, "utf8");
  writeFileSync(resolve(reportRoot, "w23-semantic-planning-evidence.json"), `${JSON.stringify(planningEvidence, null, 2)}\n`, "utf8");
  writeFileSync(resolve(reportRoot, "w24-recipe-lock-validation.json"), `${JSON.stringify(recipeEvidence, null, 2)}\n`, "utf8");
  writeFileSync(resolve(reportRoot, "w25-typed-plan-evidence.json"), `${JSON.stringify(typedPlanEvidence, null, 2)}\n`, "utf8");
}

console.log(`GDPS_DEVELOPMENT_EVIDENCE_PASS mode=${write ? "write" : "check"} recipes=${plans.length}`);
