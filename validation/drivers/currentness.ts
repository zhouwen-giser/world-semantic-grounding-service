import {
  GdpsV021DriverEvidenceError,
  GdpsV021DriverExternalContractError,
  type DriverDigest,
  type GdpsV021DerivedDriverCase,
  type JsonObject,
  type PersistedDriverRun,
} from "./contracts.js";
import {
  canonicalHash,
  digest,
  exactOperationKeys,
  executionStatus,
  gdpsSource,
  requireTerminal,
  requireGdpsProductSource,
  semanticCodes,
  sha256,
  sourceText,
  stageAndExecutionFacts,
  stringsNamed,
  text,
  valuesNamed,
} from "./shared.js";

export const CURRENTNESS_DRIVER_IMPLEMENTATION_PATH = "validation/drivers/currentness.ts";

export interface CurrentnessSeedPointer {
  readonly groundingId: string;
  readonly groundingIdHash: DriverDigest;
  readonly gateRunId: string;
  readonly resultHash: DriverDigest;
  readonly selectedProductId: string;
  readonly selectedProductIdHash: DriverDigest;
  readonly sourceEvidence: JsonObject;
}

export interface VerifiedCurrentnessBarrier {
  readonly hash: DriverDigest;
  readonly document: JsonObject;
}

export function currentnessSeedPointer(
  run: PersistedDriverRun,
  groundingId: string,
  gateRunId: string,
): CurrentnessSeedPointer {
  requireTerminal(run, "COMPLETED", "CURRENTNESS_SEED_TERMINAL_STATUS_INVALID");
  exactOperationKeys(run, [
    "reference.resolve@1.0",
    "world.get-geometry@1.0",
    "geo-raster.find-by-range@1.0",
  ], "CURRENTNESS_SEED_OPERATION_CHAIN_INVALID");
  if (run.planDocuments.length !== 1 || run.planHashes.length !== 1 ||
      !stringsNamed(run.planDocuments[0], "descriptorId").includes("SLOPE/DEGREE") ||
      !stringsNamed(run.planDocuments[0], "operationId").includes("geo-raster.find-by-range")) {
    throw new GdpsV021DriverEvidenceError("CURRENTNESS_SEED_PLAN_BINDING_INVALID");
  }
  const source = gdpsSource(run, "CURRENTNESS_SEED");
  requireGdpsProductSource(source, "geo-raster.find-by-range@1.0", "COMPLETED");
  if (sourceText(source, "descriptorId", "CURRENTNESS_SEED_DESCRIPTOR_MISSING") !== "SLOPE/DEGREE") {
    throw new GdpsV021DriverEvidenceError("CURRENTNESS_SEED_DESCRIPTOR_INVALID");
  }
  const productId = sourceText(source, "productId", "CURRENTNESS_SEED_PRODUCT_ID_MISSING");
  const contentHash = digest(source["contentHash"], "CURRENTNESS_SEED_CONTENT_HASH_INVALID");
  if (!run.recipeLockHash || source["recipeLockHash"] !== run.recipeLockHash ||
      !stringsNamed(run.planDocuments[0], "descriptorHash").includes(String(source["descriptorHash"]))) {
    throw new GdpsV021DriverEvidenceError("CURRENTNESS_SEED_LOCK_BINDING_INVALID");
  }
  const evidenceItems = run.resultDocument["evidenceItems"];
  if (!Array.isArray(evidenceItems)) {
    throw new GdpsV021DriverEvidenceError("CURRENTNESS_SEED_EVIDENCE_PRODUCT_NOT_EXACT");
  }
  const selected = evidenceItems.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as JsonObject;
    const payload = item["safePayload"];
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
    const safePayload = payload as JsonObject;
    return safePayload["productId"] === productId && safePayload["contentHash"] === contentHash &&
      typeof item["evidenceProductId"] === "string" && item["evidenceProductId"].length > 0
      ? [item["evidenceProductId"]] : [];
  });
  // This equality is the important association: the selected evidence item,
  // rather than an unrelated product in the same result, carries the exact
  // source productId/contentHash that will cross the A-to-B barrier.
  if (selected.length !== 1) {
    throw new GdpsV021DriverEvidenceError("CURRENTNESS_SEED_EVIDENCE_PRODUCT_NOT_EXACT");
  }
  return {
    groundingId,
    groundingIdHash: run.groundingIdHash,
    gateRunId,
    resultHash: run.resultHash,
    selectedProductId: selected[0]!,
    selectedProductIdHash: sha256(selected[0]!),
    sourceEvidence: source,
  };
}

function currentnessDecision(run: PersistedDriverRun): JsonObject {
  const values = valuesNamed(run.resultDocument, "gdpsCurrentnessDecision")
    .concat(run.executionEvidence.flatMap((entry) =>
      entry.dataSnapshot ? valuesNamed(entry.dataSnapshot, "gdpsCurrentnessDecision") : []));
  const snapshotValues = run.gdpsSourceEvidence.flatMap((source) =>
    valuesNamed(source, "gdpsCurrentnessDecision"));
  const all = [...values, ...snapshotValues].filter((entry): entry is JsonObject =>
    Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
  const unique = new Map(all.map((entry) => [canonicalHash(entry), entry]));
  if (unique.size === 1) return [...unique.values()][0]!;

  throw new GdpsV021DriverEvidenceError("CURRENTNESS_DECISION_MISSING");
}

export function deriveCurrentnessDriver(
  replay: PersistedDriverRun,
  seed: CurrentnessSeedPointer,
  barrier: VerifiedCurrentnessBarrier,
): GdpsV021DerivedDriverCase {
  const source = seed.sourceEvidence;
  const decision = currentnessDecision(replay);
  const currentness = text(decision["currentness"], "CURRENTNESS_CONDITION_MISSING");
  const currentContentHash = digest(
    decision["currentContentHash"],
    "CURRENTNESS_CURRENT_CONTENT_HASH_MISSING",
  );
  const historicalContentHash = digest(
    seed.sourceEvidence["contentHash"],
    "CURRENTNESS_HISTORICAL_CONTENT_HASH_MISSING",
  );
  if (currentness !== "CHANGED" || currentContentHash === historicalContentHash) {
    throw new GdpsV021DriverExternalContractError(
      "NEG-CURRENTNESS",
      "READ_ONLY_STALE_SOURCE_NOT_AVAILABLE",
      "An isolated real GDPS A-to-B current-product fixture is required: epoch A must be queried naturally and persisted by WSGS, then epoch B must make geo-product.check-current report CHANGED through an isolated Gateway without changing the shared runtime.",
    );
  }
  const decisionSource = decision["source"];
  if (!decisionSource || typeof decisionSource !== "object" || Array.isArray(decisionSource) ||
      (decisionSource as JsonObject)["productId"] !== source["productId"] ||
      (decisionSource as JsonObject)["contentHash"] !== historicalContentHash ||
      decision["selectedEvidenceProductId"] !== seed.selectedProductId ||
      decision["sourceGroundingId"] !== seed.groundingId ||
      decision["sourceResultHash"] !== seed.resultHash) {
    throw new GdpsV021DriverEvidenceError("CURRENTNESS_DECISION_SOURCE_BINDING_INVALID");
  }
  if (barrier.document["schemaVersion"] !== "wsgs-gdps-currentness-epoch-barrier/1.0" ||
      barrier.document["gateRunId"] !== seed.gateRunId ||
      barrier.document["caseId"] !== "NEG-CURRENTNESS" ||
      barrier.document["fromEpoch"] !== "INITIAL_A" ||
      barrier.document["toEpoch"] !== "CURRENT_B" ||
      barrier.document["productId"] !== source["productId"] ||
      barrier.document["sourceGroundingIdHash"] !== seed.groundingIdHash ||
      barrier.document["sourceResultHash"] !== seed.resultHash ||
      !/^sha256:[0-9a-f]{64}$/u.test(String(barrier.document["initialEpochAttestationHash"] ?? "")) ||
      barrier.document["fromContentHash"] !== historicalContentHash ||
      barrier.document["toContentHash"] !== currentContentHash ||
      barrier.document["requiredExecutionPath"] !== "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" ||
      barrier.document["isolatedRuntime"] !== true ||
      barrier.document["sharedRuntimeMutated"] !== false ||
      barrier.document["directProviderCalls"] !== 0) {
    throw new GdpsV021DriverEvidenceError("CURRENTNESS_BARRIER_ATTESTATION_INVALID");
  }
  const allowedStatuses = ["STALE", "SNAPSHOT_MISMATCHED"] as const;
  const decisionStatus = text(decision["status"], "CURRENTNESS_DECISION_STATUS_MISSING");
  const observedSemanticCodes = semanticCodes(replay);
  const persistedNormalizedStatus = executionStatus(replay, "geo-product.check-current@1.0");
  if (!allowedStatuses.includes(decisionStatus as (typeof allowedStatuses)[number]) ||
      decision["executionBlocked"] !== true ||
      !observedSemanticCodes.includes("SNAPSHOT_MISMATCHED") ||
      persistedNormalizedStatus === undefined ||
      !allowedStatuses.includes(persistedNormalizedStatus as (typeof allowedStatuses)[number])) {
    throw new GdpsV021DriverEvidenceError("CURRENTNESS_FAIL_CLOSED_DECISION_MISSING");
  }
  requireTerminal(replay, "UNRESOLVED", "CURRENTNESS_TERMINAL_STATUS_INVALID");
  exactOperationKeys(replay, ["geo-product.check-current@1.0"], "CURRENTNESS_OPERATION_CHAIN_INVALID");
  const originalQueryExecutions = replay.operationKeys.filter((entry) =>
    entry !== "geo-product.check-current@1.0");
  if (originalQueryExecutions.length !== 0) {
    throw new GdpsV021DriverEvidenceError("CURRENTNESS_ORIGINAL_QUERY_REEXECUTED");
  }
  if (replay.planHashes.length !== 1 || replay.planDocuments.length !== 1 ||
      !stringsNamed(replay.planDocuments[0], "operationId").includes("geo-product.check-current")) {
    throw new GdpsV021DriverEvidenceError("CURRENTNESS_PLAN_NOT_CHECK_ONLY");
  }
  if (sourceText(source, "descriptorId", "CURRENTNESS_SOURCE_DESCRIPTOR_MISSING") !== "SLOPE/DEGREE") {
    throw new GdpsV021DriverEvidenceError("CURRENTNESS_SOURCE_DESCRIPTOR_INVALID");
  }
  const common = stageAndExecutionFacts(replay);
  return {
    caseId: "NEG-CURRENTNESS",
    driverKind: "STORED_HASH_DIFFERS_FROM_CURRENT",
    implementationPath: CURRENTNESS_DRIVER_IMPLEMENTATION_PATH,
    precondition: {
      caseId: "NEG-CURRENTNESS",
      driverKind: "STORED_HASH_DIFFERS_FROM_CURRENT",
      sourceGroundingIdHash: seed.groundingIdHash,
      sourceResultHash: seed.resultHash,
      selectedProductIdHash: seed.selectedProductIdHash,
      productId: source["productId"],
      storedContentHash: historicalContentHash,
      currentContentHash,
      checkOperation: "geo-product.check-current@1.0",
      barrierAttestationHash: barrier.hash,
      initialEpochAttestationHash: barrier.document["initialEpochAttestationHash"],
      barrierFromEpoch: "INITIAL_A",
      barrierToEpoch: "CURRENT_B",
      originalProducingOperationReplayCount: originalQueryExecutions.filter((entry) =>
        entry === "geo-raster.find-by-range@1.0").length,
    },
    persistedFacts: {
      terminalStatus: "UNRESOLVED",
      normalizedStatus: persistedNormalizedStatus,
      sourceCondition: "CHANGED",
      semanticPattern: "PRIOR_RESULT_REVALIDATION",
      descriptorId: "SLOPE/DEGREE",
      semanticCode: "SNAPSHOT_MISMATCHED",
      currentnessDecisionStatus: decisionStatus,
      recipeId: source["recipeId"],
      recipeLockHash: source["recipeLockHash"],
      descriptorHash: source["descriptorHash"],
      planHash: replay.planHashes[0],
      operationLockHash: replay.operationLockHash,
      productEvidence: source,
      currentContentHash,
      currentness: "CHANGED",
      truncated: false,
      falseFactAssertions: [],
      originalQueryExecutions,
      groundingIdHash: replay.groundingIdHash,
      requestHash: replay.requestHash,
      resultHash: replay.resultHash,
      sourceResultHash: seed.resultHash,
      currentnessBarrierAttestationHash: barrier.hash,
      ...common,
    },
  };
}
