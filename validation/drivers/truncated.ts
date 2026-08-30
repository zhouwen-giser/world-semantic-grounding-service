import {
  GdpsV021DriverEvidenceError,
  GdpsV021DriverExternalContractError,
  type GdpsV021DerivedDriverCase,
  type PersistedDriverRun,
} from "./contracts.js";
import {
  exactOperationKeys,
  executionStatus,
  gdpsSource,
  requirePlanBinding,
  requireGdpsProductSource,
  requireTerminal,
  sourceText,
  stageAndExecutionFacts,
} from "./shared.js";

export const TRUNCATED_DRIVER_IMPLEMENTATION_PATH = "validation/drivers/truncated.ts";

const operationKeys = Object.freeze([
  "reference.resolve@1.0",
  "world.get-geometry@1.0",
  "geo-vector.find-in-area@1.0",
]);

export function deriveTruncatedDriver(run: PersistedDriverRun): GdpsV021DerivedDriverCase {
  const candidate = run.gdpsSourceEvidence[0];
  if (run.terminalStatus !== "PARTIAL" || candidate?.["truncated"] !== true) {
    throw new GdpsV021DriverExternalContractError(
      "NEG-TRUNCATED",
      "UPSTREAM_TRUNCATION_SIGNAL_NOT_OBSERVED",
      "An isolated real GDPS fixture must return truncated=true for the natural-language drainage-area query through an isolated registered Gateway path; a WSGS byte cap is not equivalent.",
    );
  }
  requireTerminal(run, "PARTIAL", "TRUNCATED_TERMINAL_STATUS_INVALID");
  exactOperationKeys(run, operationKeys, "TRUNCATED_OPERATION_CHAIN_INVALID");
  if (executionStatus(run, "geo-vector.find-in-area@1.0") !== "PARTIAL") {
    throw new GdpsV021DriverEvidenceError("TRUNCATED_TARGET_STATUS_NOT_PARTIAL");
  }
  const source = gdpsSource(run, "TRUNCATED");
  requireGdpsProductSource(source, "geo-vector.find-in-area@1.0", "PARTIAL");
  if (source["truncated"] !== true ||
      sourceText(source, "descriptorId", "TRUNCATED_DESCRIPTOR_MISSING") !==
        "DRAINAGE_NETWORK/DRAINAGE_FEATURES") {
    throw new GdpsV021DriverEvidenceError("TRUNCATED_SOURCE_BINDING_INVALID");
  }
  const plan = requirePlanBinding(
    run,
    "DRAINAGE_NETWORK/DRAINAGE_FEATURES",
    "geo-vector.find-in-area@1.0",
  );
  if (!run.recipeLockHash || source["recipeLockHash"] !== run.recipeLockHash ||
      source["descriptorHash"] !== plan.descriptorHash) {
    throw new GdpsV021DriverEvidenceError("TRUNCATED_SOURCE_LOCK_BINDING_INVALID");
  }
  const common = stageAndExecutionFacts(run);
  return {
    caseId: "NEG-TRUNCATED",
    driverKind: "UPSTREAM_TRUNCATED_TRUE",
    implementationPath: TRUNCATED_DRIVER_IMPLEMENTATION_PATH,
    precondition: {
      caseId: "NEG-TRUNCATED",
      driverKind: "UPSTREAM_TRUNCATED_TRUE",
      upstreamOperation: "geo-vector.find-in-area@1.0",
      upstreamNormalizedStatus: "PARTIAL",
      upstreamTruncated: true,
      productContentHash: source["contentHash"],
      resultHash: run.resultHash,
    },
    persistedFacts: {
      terminalStatus: "PARTIAL",
      normalizedStatus: "PARTIAL",
      sourceCondition: "TRUNCATED",
      semanticPattern: "GDPS_GENERIC_VECTOR_IN_AREA",
      descriptorId: "DRAINAGE_NETWORK/DRAINAGE_FEATURES",
      semanticCode: "RESULT_TRUNCATED",
      recipeId: source["recipeId"],
      recipeLockHash: run.recipeLockHash,
      descriptorHash: plan.descriptorHash,
      planHash: plan.planHash,
      operationLockHash: run.operationLockHash,
      productEvidence: source,
      currentContentHash: source["contentHash"],
      currentness: "CURRENT",
      truncated: true,
      falseFactAssertions: [],
      originalQueryExecutions: [],
      groundingIdHash: run.groundingIdHash,
      requestHash: run.requestHash,
      resultHash: run.resultHash,
      ...common,
    },
  };
}
