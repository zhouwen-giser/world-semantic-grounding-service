import {
  GdpsV021DriverEvidenceError,
  GdpsV021DriverExternalContractError,
  type GdpsV021DerivedDriverCase,
  type PersistedDriverRun,
} from "./contracts.js";
import {
  exactOperationKeys,
  executionStatus,
  requirePlanBinding,
  requireTerminal,
  semanticCodes,
  stageAndExecutionFacts,
} from "./shared.js";

export const DATA_GAP_DRIVER_IMPLEMENTATION_PATH = "validation/drivers/data-gap.ts";

const operationKeys = Object.freeze([
  "reference.resolve@1.0",
  "world.get-geometry@1.0",
  "geo-vector.find-in-area@1.0",
]);

export function deriveDataGapDriver(run: PersistedDriverRun): GdpsV021DerivedDriverCase {
  if (run.terminalStatus !== "UNRESOLVED" || !semanticCodes(run).includes("DATA_GAP")) {
    throw new GdpsV021DriverExternalContractError(
      "NEG-DATA-GAP",
      "CURRENT_PRODUCT_ABSENCE_NOT_OBSERVED",
      "The live GDPS baseline must expose UAV_RESTRICTION/RESTRICTION_ZONES while returning a typed DATA_GAP for its absent current product through the Gateway.",
    );
  }
  requireTerminal(run, "UNRESOLVED", "DATA_GAP_TERMINAL_STATUS_INVALID");
  exactOperationKeys(run, operationKeys, "DATA_GAP_OPERATION_CHAIN_INVALID");
  const targetStatus = executionStatus(run, "geo-vector.find-in-area@1.0");
  if (targetStatus !== "NO_DATA") {
    throw new GdpsV021DriverEvidenceError("DATA_GAP_TARGET_STATUS_NOT_NO_DATA");
  }
  const gapSources = run.gdpsSourceEvidence.filter((entry) =>
    entry["descriptorId"] === "UAV_RESTRICTION/RESTRICTION_ZONES" &&
    entry["normalizedStatus"] === "UNRESOLVED" && entry["gapKind"] === "DATA_GAP" &&
    entry["recipeId"] === "recipe-gdps-generic-vector-in-area" &&
    entry["recipeLockHash"] === run.recipeLockHash &&
    entry["productId"] === undefined && entry["contentHash"] === undefined &&
    entry["truncated"] === false);
  const currentProductEvidenceCount = run.gdpsSourceEvidence.filter((entry) =>
    typeof entry["productId"] === "string" || typeof entry["contentHash"] === "string").length;
  if (gapSources.length !== 1 || run.gdpsSourceEvidence.length !== 1 ||
      currentProductEvidenceCount !== 0) {
    throw new GdpsV021DriverEvidenceError("DATA_GAP_CURRENT_PRODUCT_EVIDENCE_FORBIDDEN");
  }
  if (!run.recipeLockHash) {
    throw new GdpsV021DriverEvidenceError("DATA_GAP_RECIPE_LOCK_HASH_MISSING");
  }
  const plan = requirePlanBinding(
    run,
    "UAV_RESTRICTION/RESTRICTION_ZONES",
    "geo-vector.find-in-area@1.0",
  );
  const common = stageAndExecutionFacts(run);
  return {
    caseId: "NEG-DATA-GAP",
    driverKind: "CURRENT_PRODUCT_ABSENT",
    implementationPath: DATA_GAP_DRIVER_IMPLEMENTATION_PATH,
    precondition: {
      caseId: "NEG-DATA-GAP",
      driverKind: "CURRENT_PRODUCT_ABSENT",
      descriptorId: "UAV_RESTRICTION/RESTRICTION_ZONES",
      descriptorHash: plan.descriptorHash,
      targetOperation: "geo-vector.find-in-area@1.0",
      persistedTargetStatus: targetStatus,
      currentProductEvidenceCount,
      resultHash: run.resultHash,
    },
    persistedFacts: {
      terminalStatus: "UNRESOLVED",
      normalizedStatus: "DATA_GAP",
      sourceCondition: "PRODUCT_NOT_AVAILABLE",
      semanticPattern: "GDPS_GENERIC_VECTOR_IN_AREA",
      descriptorId: "UAV_RESTRICTION/RESTRICTION_ZONES",
      semanticCode: "DATA_GAP",
      recipeId: gapSources[0]!["recipeId"],
      recipeLockHash: run.recipeLockHash,
      descriptorHash: plan.descriptorHash,
      planHash: plan.planHash,
      operationLockHash: run.operationLockHash,
      productEvidence: null,
      currentContentHash: null,
      currentness: "NOT_AVAILABLE",
      truncated: false,
      falseFactAssertions: [],
      originalQueryExecutions: operationKeys.filter((key) => key.startsWith("geo-raster.")),
      groundingIdHash: run.groundingIdHash,
      requestHash: run.requestHash,
      resultHash: run.resultHash,
      ...common,
    },
  };
}
