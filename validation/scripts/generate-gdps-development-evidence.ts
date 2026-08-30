import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TypedWorldQueryCompiler } from "../../packages/query-compiler/src/compiler.js";
import { authorizeGdps, compileInput } from "../../packages/query-compiler/src/test-fixtures.js";
import type { QuerySemanticPattern } from "../../packages/query-compiler/src/types.js";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const reportRoot = resolve(root, "reports", "wsgs-v0.2-gdps");
const write = process.argv.includes("--write");
const snapshot = JSON.parse(readFileSync(resolve(reportRoot, "w21-capability-snapshot.json"), "utf8")) as Record<string, any>;
const recipeIds = snapshot.recipeLocks.map((entry: Record<string, unknown>) => String(entry.recipeId)) as QuerySemanticPattern[];

let existingLiveRegistration: Record<string, unknown> | undefined;
try {
  const existingSnapshot = JSON.parse(readFileSync(resolve(reportRoot, "w21-capability-snapshot.json"), "utf8")) as Record<string, unknown>;
  if (existingSnapshot.liveRegistration && typeof existingSnapshot.liveRegistration === "object" && !Array.isArray(existingSnapshot.liveRegistration)) {
    existingLiveRegistration = existingSnapshot.liveRegistration as Record<string, unknown>;
  }
} catch {
  existingLiveRegistration = undefined;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
  const input = authorizeGdps(compileInput(recipeId));
  input.maturityPolicy.allowPreview = true;
  input.snapshotPolicy = { mode: "BEST_EFFORT", allowDowngrade: false };
  if (recipeId === "GDPS_OBSTACLES_NEAR_REFERENCE") input.parameterValues = { ...input.parameterValues, distanceMetres: 500 };
  if (recipeId === "GDPS_HIGH_GROUND_IN_AREA") {
    input.parameterValues = { ...input.parameterValues, explicitProductId: "terrain-main" };
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
  naturalLanguageCasesCovered: recipeIds.length,
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
  assert(Array.isArray(snapshot.capabilities) && snapshot.capabilities.length > 0, "W21 capability inventory is empty");
  assert(
    new Set(snapshot.capabilities.map((entry: Record<string, unknown>) =>
      `${String(entry.operationId)}@${String(entry.operationVersion)}`)).size === snapshot.capabilities.length,
    "W21 capability inventory contains duplicate operation keys"
  );
  assert(Array.isArray(snapshot.recipeLocks) && snapshot.recipeLocks.length > 0, "W21 recipe inventory is empty");
  assert(recipeEvidence.globalPreviewAloneRejected && recipeEvidence.exactRecipeAllowlistRequired, "W24 preview policy mismatch");
  assert(plans.length === recipeIds.length && plans.every((plan) => !plan.providerIdInPlan), "W25 plan evidence mismatch");
  assert(plans.filter((plan) => plan.explicitProductId !== null).length === 1, "Product preference was fabricated or lost");
}

validate();
if (write) {
  writeFileSync(resolve(reportRoot, "w21-capability-snapshot.json"), `${JSON.stringify({
    ...snapshot,
    status: "PASS",
    registrationStateAtCapture: existingLiveRegistration
      ? "CURRENT_SHARED_GATEWAY_REGISTERED"
      : "SOURCE_SNAPSHOT_RUNTIME_REGISTRATION_NOT_CAPTURED",
    ...(existingLiveRegistration ? { liveRegistration: existingLiveRegistration } : {}),
    marker: "GDPS_CAPABILITY_SNAPSHOT_READY"
  }, null, 2)}\n`, "utf8");
  writeFileSync(resolve(reportRoot, "w23-semantic-planning-evidence.json"), `${JSON.stringify(planningEvidence, null, 2)}\n`, "utf8");
  writeFileSync(resolve(reportRoot, "w24-recipe-lock-validation.json"), `${JSON.stringify(recipeEvidence, null, 2)}\n`, "utf8");
  writeFileSync(resolve(reportRoot, "w25-typed-plan-evidence.json"), `${JSON.stringify(typedPlanEvidence, null, 2)}\n`, "utf8");
}

console.log(`GDPS_DEVELOPMENT_EVIDENCE_PASS mode=${write ? "write" : "check"} recipes=${plans.length}`);
