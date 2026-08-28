import { canonicalSha256 } from "./canonical.js";
import { ExecutionEvidenceError } from "./errors.js";
import type {
  DirectSnapshotExpectation,
  QuerySnapshotAdherence,
  QuerySnapshotManifest,
  SnapshotGap,
  SnapshotMode,
  WorldSnapshotExpectation
} from "./types.js";
import { digest, nonEmptyString, object, timestamp } from "./validation.js";

const snapshotModes = new Set<SnapshotMode>([
  "LATEST_AT_START", "PINNED", "AT_LEAST_WORLD_VERSION", "BEST_EFFORT"
]);
const consistencies = new Set(["PINNED", "CONSISTENT_AT_START", "BEST_EFFORT"]);
const adherenceStatuses = new Set(["MATCHED", "ADVANCED_COMPATIBLE", "MISMATCHED", "UNSUPPORTED", "NOT_APPLICABLE"]);
const manifestKeys = new Set([
  "querySnapshotId", "mode", "consistency", "capturedAt", "resources", "minimumWorldVersion", "manifestHash"
]);
const adherenceKeys = new Set(["nodeId", "status", "checkedResources", "mismatches"]);

export interface SnapshotAssessment {
  readonly gaps: readonly SnapshotGap[];
  readonly warnings: readonly string[];
}

export function parseAndVerifySnapshotManifest(value: unknown): QuerySnapshotManifest {
  const raw = object(value, "INVALID_WORLD_QUERY_RESULT");
  if (Object.keys(raw).some((key) => !manifestKeys.has(key))) {
    throw new ExecutionEvidenceError("INVALID_WORLD_QUERY_RESULT");
  }
  const mode = nonEmptyString(raw["mode"], "INVALID_WORLD_QUERY_RESULT") as SnapshotMode;
  const consistency = nonEmptyString(raw["consistency"], "INVALID_WORLD_QUERY_RESULT");
  if (!snapshotModes.has(mode) || !consistencies.has(consistency)) {
    throw new ExecutionEvidenceError("INVALID_WORLD_QUERY_RESULT");
  }
  if (!Array.isArray(raw["resources"]) || raw["resources"].length > 512) {
    throw new ExecutionEvidenceError("INVALID_WORLD_QUERY_RESULT");
  }
  const resources = raw["resources"].map((resource) => structuredClone(object(resource, "INVALID_WORLD_QUERY_RESULT")));
  const manifestHash = digest(raw["manifestHash"], "SNAPSHOT_MANIFEST_HASH_MISMATCH");
  const capturedAt = nonEmptyString(raw["capturedAt"], "INVALID_WORLD_QUERY_RESULT");
  timestamp(capturedAt);
  const content: Record<string, unknown> = {
    querySnapshotId: nonEmptyString(raw["querySnapshotId"], "INVALID_WORLD_QUERY_RESULT"),
    mode,
    consistency,
    capturedAt,
    resources,
    ...(raw["minimumWorldVersion"] === undefined ? {} : { minimumWorldVersion: raw["minimumWorldVersion"] })
  };
  if (raw["minimumWorldVersion"] !== undefined
    && (!Number.isSafeInteger(raw["minimumWorldVersion"]) || Number(raw["minimumWorldVersion"]) < 0)) {
    throw new ExecutionEvidenceError("INVALID_WORLD_QUERY_RESULT");
  }
  if (canonicalSha256(content) !== manifestHash) {
    throw new ExecutionEvidenceError("SNAPSHOT_MANIFEST_HASH_MISMATCH");
  }
  return structuredClone({ ...content, manifestHash }) as QuerySnapshotManifest;
}

export function parseSnapshotAdherence(value: unknown): readonly QuerySnapshotAdherence[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw new ExecutionEvidenceError("INVALID_WORLD_QUERY_RESULT");
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    const raw = object(entry, "INVALID_WORLD_QUERY_RESULT");
    if (Object.keys(raw).some((key) => !adherenceKeys.has(key))) {
      throw new ExecutionEvidenceError("INVALID_WORLD_QUERY_RESULT");
    }
    const nodeId = nonEmptyString(raw["nodeId"], "INVALID_WORLD_QUERY_RESULT");
    if (seen.has(nodeId)) throw new ExecutionEvidenceError("SNAPSHOT_ADHERENCE_DUPLICATE");
    seen.add(nodeId);
    const status = nonEmptyString(raw["status"], "INVALID_WORLD_QUERY_RESULT") as QuerySnapshotAdherence["status"];
    if (!adherenceStatuses.has(status)) throw new ExecutionEvidenceError("INVALID_WORLD_QUERY_RESULT");
    const checkedResources = raw["checkedResources"];
    if (!Number.isSafeInteger(checkedResources) || Number(checkedResources) < 0) {
      throw new ExecutionEvidenceError("INVALID_WORLD_QUERY_RESULT");
    }
    if (raw["mismatches"] !== undefined && (!Array.isArray(raw["mismatches"]) || raw["mismatches"].length > 128)) {
      throw new ExecutionEvidenceError("INVALID_WORLD_QUERY_RESULT");
    }
    return {
      nodeId,
      status,
      checkedResources: Number(checkedResources),
      ...(raw["mismatches"] === undefined
        ? {}
        : { mismatches: raw["mismatches"].map((mismatch) => structuredClone(object(mismatch, "INVALID_WORLD_QUERY_RESULT"))) })
    };
  });
}

export function assessWorldSnapshot(
  nodeIds: readonly string[],
  manifest: QuerySnapshotManifest,
  adherence: readonly QuerySnapshotAdherence[],
  expectation: WorldSnapshotExpectation
): SnapshotAssessment {
  if (!snapshotModes.has(expectation.mode)) throw new ExecutionEvidenceError("INVALID_WORLD_QUERY_RESULT");
  const expectedNodes = new Set(nodeIds);
  for (const entry of adherence) {
    if (!expectedNodes.has(entry.nodeId)) throw new ExecutionEvidenceError("SNAPSHOT_ADHERENCE_UNKNOWN_NODE");
  }
  for (const nodeId of nodeIds) {
    if (!adherence.some((entry) => entry.nodeId === nodeId)) {
      throw new ExecutionEvidenceError("SNAPSHOT_ADHERENCE_MISSING");
    }
  }

  const strict = expectation.mode === "PINNED"
    || (expectation.mode !== "BEST_EFFORT" && !expectation.allowDowngrade);
  const gaps: SnapshotGap[] = [];
  const warnings: string[] = [];
  if (manifest.mode !== expectation.mode) {
    if (strict) {
      gaps.push({
        code: "SNAPSHOT_MODE_DOWNGRADED",
        expected: expectation.mode,
        actual: manifest.mode
      });
    } else {
      warnings.push(`SNAPSHOT_MODE_CHANGED:${expectation.mode}:${manifest.mode}`);
    }
  }
  for (const entry of adherence) {
    if (!["MISMATCHED", "UNSUPPORTED"].includes(entry.status)) continue;
    if (strict) {
      gaps.push({
        code: "SNAPSHOT_ADHERENCE_FAILED",
        nodeId: entry.nodeId,
        expected: expectation.mode,
        actual: entry.status
      });
    } else {
      warnings.push(`SNAPSHOT_BEST_EFFORT_MISMATCH:${entry.nodeId}:${entry.status}`);
    }
  }
  return { gaps, warnings };
}

export function assessDirectSnapshot(
  dataSnapshot: Readonly<Record<string, unknown>> | undefined,
  expectation: DirectSnapshotExpectation
): SnapshotAssessment {
  if (!consistencies.has(expectation.consistency)) throw new ExecutionEvidenceError("INVALID_GATEWAY_ENVELOPE");
  const actual = dataSnapshot === undefined ? "ABSENT" : String(dataSnapshot["consistency"]);
  const matched = expectation.consistency === "BEST_EFFORT"
    ? dataSnapshot !== undefined
    : expectation.consistency === "CONSISTENT_AT_START"
      ? ["CONSISTENT_AT_START", "PINNED"].includes(actual)
      : actual === "PINNED"
        && Array.isArray(dataSnapshot?.["resources"])
        && (dataSnapshot["resources"] as unknown[]).every((resource) => object(resource, "INVALID_GATEWAY_ENVELOPE")["pinning"] === "PINNED");
  if (matched) return { gaps: [], warnings: [] };
  const strict = expectation.consistency === "PINNED" || !expectation.allowDowngrade;
  return strict
    ? {
        gaps: [{
          code: "DIRECT_SNAPSHOT_UNSATISFIED",
          expected: expectation.consistency,
          actual
        }],
        warnings: []
      }
    : { gaps: [], warnings: [`DIRECT_SNAPSHOT_BEST_EFFORT:${expectation.consistency}:${actual}`] };
}
