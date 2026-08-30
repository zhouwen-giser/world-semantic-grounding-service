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
  object,
  requireTerminal,
  semanticCodes,
  sha256,
  stageAndExecutionFacts,
  text,
} from "./shared.js";

export const RECIPE_DRIFT_DRIVER_IMPLEMENTATION_PATH = "validation/drivers/recipe-drift.ts";

export interface RecipeDriftRuntimeMaterial {
  readonly recipeLock: JsonObject;
  readonly recipeLockBytes: Uint8Array;
  readonly recipeLockHash: DriverDigest;
  readonly consumerSnapshot: JsonObject;
  readonly consumerSnapshotBytes: Uint8Array;
  readonly consumerSnapshotHash: DriverDigest;
  readonly descriptorId: string;
  readonly descriptorHash: DriverDigest;
  readonly originalSemanticProfileHash: DriverDigest;
  readonly alteredSemanticProfileHash: DriverDigest;
}

function prettyBytes(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function buildRecipeDriftRuntimeMaterial(input: {
  readonly gateRunId: string;
  readonly recipeLock: JsonObject;
  readonly consumerSnapshot: JsonObject;
}): RecipeDriftRuntimeMaterial {
  const lock = structuredClone(input.recipeLock);
  const recipes = lock["recipes"];
  if (lock["schemaVersion"] !== "wsgs-gdps-recipe-lock/2.0" ||
      !Array.isArray(recipes) || recipes.length !== 14) {
    throw new GdpsV021DriverEvidenceError("RECIPE_DRIFT_SOURCE_LOCK_INVALID");
  }
  const matches = recipes.filter((raw) => object(raw, "RECIPE_DRIFT_RECIPE_INVALID")["semanticPattern"] ===
    "GDPS_GENERIC_FIND_RANGE");
  if (matches.length !== 1) {
    throw new GdpsV021DriverEvidenceError("RECIPE_DRIFT_TARGET_RECIPE_NOT_EXACT");
  }
  const recipe = object(matches[0], "RECIPE_DRIFT_RECIPE_INVALID");
  const descriptor = object(recipe["descriptorConstraint"], "RECIPE_DRIFT_DESCRIPTOR_INVALID");
  const operations = recipe["allowedOperations"];
  if (!Array.isArray(operations) || operations.length !== 1) {
    throw new GdpsV021DriverEvidenceError("RECIPE_DRIFT_OPERATION_NOT_EXACT");
  }
  const operation = object(operations[0], "RECIPE_DRIFT_OPERATION_INVALID");
  if (`${operation["operationId"]}@${operation["operationVersion"]}` !==
      "geo-raster.find-by-range@1.0") {
    throw new GdpsV021DriverEvidenceError("RECIPE_DRIFT_OPERATION_NOT_EXACT");
  }
  const originalSemanticProfileHash = digest(
    operation["semanticProfileHash"],
    "RECIPE_DRIFT_SOURCE_SEMANTIC_HASH_INVALID",
  );
  const alteredSemanticProfileHash = canonicalHash({
    schemaVersion: "wsgs-gdps-recipe-drift-seed/1.0",
    gateRunId: input.gateRunId,
    caseId: "NEG-RECIPE-DRIFT",
    operationKey: "geo-raster.find-by-range@1.0",
    originalSemanticProfileHash,
  });
  if (alteredSemanticProfileHash === originalSemanticProfileHash) {
    throw new GdpsV021DriverEvidenceError("RECIPE_DRIFT_HASH_DID_NOT_CHANGE");
  }
  operation["semanticProfileHash"] = alteredSemanticProfileHash;
  const recipeLockBytes = prettyBytes(lock);
  const recipeLockHash = sha256(recipeLockBytes);

  const snapshot = structuredClone(input.consumerSnapshot);
  if (snapshot["schemaVersion"] !== "wsgs-gdps-consumer-snapshot/2.0" ||
      !Array.isArray(snapshot["capabilityKeys"]) || snapshot["capabilityKeys"].length !== 30) {
    throw new GdpsV021DriverEvidenceError("RECIPE_DRIFT_SOURCE_SNAPSHOT_INVALID");
  }
  snapshot["recipeLockHash"] = recipeLockHash;
  const { capabilitySnapshotHash: _oldHash, ...snapshotBody } = snapshot;
  snapshot["capabilitySnapshotHash"] = canonicalHash(snapshotBody);
  const consumerSnapshotBytes = prettyBytes(snapshot);
  return {
    recipeLock: lock,
    recipeLockBytes,
    recipeLockHash,
    consumerSnapshot: snapshot,
    consumerSnapshotBytes,
    consumerSnapshotHash: sha256(consumerSnapshotBytes),
    descriptorId: text(descriptor["descriptorId"], "RECIPE_DRIFT_DESCRIPTOR_ID_INVALID"),
    descriptorHash: digest(descriptor["descriptorHash"], "RECIPE_DRIFT_DESCRIPTOR_HASH_INVALID"),
    originalSemanticProfileHash,
    alteredSemanticProfileHash,
  };
}

export function deriveRecipeDriftDriver(
  run: PersistedDriverRun,
  material: RecipeDriftRuntimeMaterial,
): GdpsV021DerivedDriverCase {
  if (run.terminalStatus !== "UNRESOLVED" || !semanticCodes(run).includes("RECIPE_LOCK_DRIFT")) {
    throw new GdpsV021DriverExternalContractError(
      "NEG-RECIPE-DRIFT",
      "ISOLATED_RECIPE_DRIFT_NOT_OBSERVED",
      "The gate adapter must instantiate an isolated production WSGS runtime with the supplied altered recipe lock and matching consumer snapshot, while continuing to call GDPS only through GOWM Gateway.",
    );
  }
  requireTerminal(run, "UNRESOLVED", "RECIPE_DRIFT_TERMINAL_STATUS_INVALID");
  if (run.operationKeys.length !== 0 || run.planDocuments.length !== 0) {
    throw new GdpsV021DriverEvidenceError("RECIPE_DRIFT_MUST_FAIL_BEFORE_WORLD_QUERY");
  }
  if (run.recipeLockHash !== material.recipeLockHash) {
    throw new GdpsV021DriverEvidenceError("RECIPE_DRIFT_PERSISTED_LOCK_HASH_MISMATCH");
  }
  const common = stageAndExecutionFacts(run);
  return {
    caseId: "NEG-RECIPE-DRIFT",
    driverKind: "RECIPE_SEMANTIC_HASH_ALTERED",
    implementationPath: RECIPE_DRIFT_DRIVER_IMPLEMENTATION_PATH,
    precondition: {
      caseId: "NEG-RECIPE-DRIFT",
      driverKind: "RECIPE_SEMANTIC_HASH_ALTERED",
      targetOperation: "geo-raster.find-by-range@1.0",
      originalSemanticProfileHash: material.originalSemanticProfileHash,
      alteredSemanticProfileHash: material.alteredSemanticProfileHash,
      isolatedRecipeLockHash: material.recipeLockHash,
      isolatedConsumerSnapshotHash: material.consumerSnapshotHash,
      persistedRecipeLockHash: run.recipeLockHash,
    },
    persistedFacts: {
      terminalStatus: "UNRESOLVED",
      normalizedStatus: "CAPABILITY_GAP",
      sourceCondition: null,
      semanticPattern: "GDPS_GENERIC_FIND_RANGE",
      descriptorId: material.descriptorId,
      semanticCode: "RECIPE_LOCK_DRIFT",
      recipeId: "recipe-gdps-generic-find-range",
      recipeLockHash: material.recipeLockHash,
      descriptorHash: material.descriptorHash,
      planHash: null,
      operationLockHash: run.operationLockHash,
      productEvidence: null,
      currentContentHash: null,
      currentness: null,
      truncated: false,
      falseFactAssertions: [],
      originalQueryExecutions: [],
      groundingIdHash: run.groundingIdHash,
      requestHash: run.requestHash,
      resultHash: run.resultHash,
      ...common,
    },
  };
}
