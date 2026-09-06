import { resolveHistoricalContext } from "./context.js";
import { normalizeExecutionIntervalResult, normalizeHistoricalTrajectoryResult } from "./normalizer.js";
import type {
  HistoricalContextResolution,
  HistoricalFindingComparison,
  HistoricalReferenceKey,
  HistoricalTraceConfiguration,
  HistoricalTraceFinding,
  HistoricalTraceIntent,
  OperationalTaskSnapshot
} from "./types.js";

type JsonObject = Record<string, unknown>;

export interface HistoricalGatewayOperationExecutor {
  execute(operationId: string, input: JsonObject): Promise<unknown>;
}

export interface HistoricalExecutionResult {
  status: "COMPLETED" | "PARTIAL" | "PENDING" | "CAPABILITY_GAP";
  reasonCode: string;
  finding?: HistoricalTraceFinding;
  context?: Extract<HistoricalContextResolution, { status: "RESOLVED" }>;
  phaseScope?: HistoricalTraceIntent["phaseScope"];
  comparison?: HistoricalFindingComparison;
  operations: string[];
}

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonObject;
}

function taskSnapshot(value: unknown): OperationalTaskSnapshot {
  const snapshot = object(value, "HISTORICAL_TASK_SNAPSHOT_INVALID");
  if (!Array.isArray(snapshot["actorReferenceKeys"])) throw new Error("HISTORICAL_TASK_ACTORS_INVALID");
  return {
    referenceKey: object(snapshot["referenceKey"], "HISTORICAL_TASK_REFERENCE_INVALID") as unknown as HistoricalReferenceKey,
    actorReferenceKeys: snapshot["actorReferenceKeys"].map((entry) =>
      object(entry, "HISTORICAL_TASK_ACTOR_INVALID") as unknown as HistoricalReferenceKey),
    activityState: String(snapshot["activityState"] ?? "UNKNOWN"),
    ...(typeof snapshot["controlState"] === "string" ? { controlState: snapshot["controlState"] } : {})
  };
}

function taskList(value: unknown): OperationalTaskSnapshot[] {
  const result = object(value, "HISTORICAL_TASK_LIST_INVALID");
  if (!Array.isArray(result["tasks"])) throw new Error("HISTORICAL_TASK_LIST_TASKS_INVALID");
  return result["tasks"].map(taskSnapshot);
}

async function retryDelay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function executeHistoricalTrace(input: {
  intent: HistoricalTraceIntent;
  configuration: HistoricalTraceConfiguration;
  gateway: HistoricalGatewayOperationExecutor;
  taskReferenceKeys?: readonly HistoricalReferenceKey[];
  subjectReferenceKeys?: readonly HistoricalReferenceKey[];
}): Promise<HistoricalExecutionResult> {
  if (!input.configuration.enabled) {
    return { status: "CAPABILITY_GAP", reasonCode: "HISTORY_CAPABILITY_DISABLED", operations: [] };
  }
  if (input.intent.queryKind !== "EXECUTION_INTERVAL" && input.intent.executionSelection.kind === "ALL") {
    return { status: "CAPABILITY_GAP", reasonCode: "MULTI_EXECUTION_TRAJECTORY_NOT_SUPPORTED", operations: [] };
  }
  const operations: string[] = [];
  let context = resolveHistoricalContext({
    intent: input.intent,
    ...(input.taskReferenceKeys ? { explicitTaskReferences: input.taskReferenceKeys } : {}),
    ...(input.subjectReferenceKeys ? { explicitSubjectReferences: input.subjectReferenceKeys } : {}),
    deferSubjectResolution: true
  });
  if (context.status === "CONTEXT_GAP" && context.reason === "TASK_CONTEXT_REQUIRED" && input.subjectReferenceKeys?.length === 1) {
    operations.push("operational-task.find");
    const found = await input.gateway.execute("operational-task.find", {
      schemaVersion: "1.0",
      actorReferenceKeys: [input.subjectReferenceKeys[0]],
      limit: 20
    });
    context = resolveHistoricalContext({
      intent: input.intent,
      explicitSubjectReferences: input.subjectReferenceKeys,
      discoveredActiveTasks: taskList(found),
      deferSubjectResolution: true
    });
  }
  if (context.status === "CONTEXT_GAP") {
    return { status: "CAPABILITY_GAP", reasonCode: context.reason, operations };
  }

  let resolvedContext: Extract<HistoricalContextResolution, { status: "RESOLVED" }> = context;
  const trajectoryRequested = input.intent.queryKind !== "EXECUTION_INTERVAL";
  if (trajectoryRequested) {
    operations.push("operational-task.get");
    const snapshot = taskSnapshot(await input.gateway.execute("operational-task.get", {
      schemaVersion: "1.0",
      referenceKey: context.taskReferenceKey
    }));
    const associated = resolveHistoricalContext({
      intent: input.intent,
      explicitTaskReferences: [context.taskReferenceKey],
      ...(context.subjectReferenceKey
        ? { explicitSubjectReferences: [context.subjectReferenceKey] }
        : input.subjectReferenceKeys ? { explicitSubjectReferences: input.subjectReferenceKeys } : {}),
      taskSnapshot: snapshot
    });
    if (associated.status === "CONTEXT_GAP") {
      return { status: "CAPABILITY_GAP", reasonCode: associated.reason, operations };
    }
    resolvedContext = associated;
  }

  operations.push("operational-task.get-execution-intervals");
  const selection = input.intent.executionSelection.kind === "ALL"
    ? { kind: "ALL" as const, limit: input.intent.executionSelection.limit }
    : input.intent.executionSelection;
  const intervalInput = { taskReferenceKey: resolvedContext.taskReferenceKey, selection, phaseScope: input.intent.phaseScope };
  let intervalFinding = normalizeExecutionIntervalResult(await input.gateway.execute(
    "operational-task.get-execution-intervals",
    intervalInput
  ));
  if (intervalFinding.status === "PENDING" && input.configuration.pendingRetryMs > 0) {
    await retryDelay(input.configuration.pendingRetryMs);
    operations.push("operational-task.get-execution-intervals");
    intervalFinding = normalizeExecutionIntervalResult(await input.gateway.execute(
      "operational-task.get-execution-intervals",
      intervalInput
    ));
  }
  intervalFinding.taskReferenceKey = resolvedContext.taskReferenceKey;
  if (!trajectoryRequested) {
    return {
      status: intervalFinding.status === "PENDING" ? "PENDING" : intervalFinding.status === "COMPLETED" ? "COMPLETED" : "PARTIAL",
      reasonCode: intervalFinding.reasonCode,
      finding: intervalFinding,
      context: resolvedContext,
      operations
    };
  }
  if (intervalFinding.status === "PENDING") {
    return { status: "PENDING", reasonCode: "HISTORICAL_PROJECTION_PENDING", finding: intervalFinding, context: resolvedContext, operations };
  }
  const interval = intervalFinding.executionInterval;
  if (!interval || intervalFinding.status === "NO_DATA" || intervalFinding.status === "INDETERMINATE" ||
      interval.lifecycleState === "CONFLICTED" || interval.stabilityState === "CONFLICTED") {
    return {
      status: "PARTIAL",
      reasonCode: intervalFinding.reasonCode,
      finding: intervalFinding,
      context: resolvedContext,
      operations
    };
  }
  if (!resolvedContext.subjectReferenceKey) {
    return { status: "CAPABILITY_GAP", reasonCode: "SUBJECT_CONTEXT_REQUIRED", context: resolvedContext, operations };
  }
  operations.push("history.get-trajectory");
  const trajectoryInput = {
    subjectReferenceKey: resolvedContext.subjectReferenceKey,
    executionIntervalReferenceKey: interval.executionIntervalReferenceKey,
    phaseScope: input.intent.phaseScope,
    sourceSelection: input.intent.sourceSelection,
    sourceSelectionProfileReferenceKey: input.configuration.sourceSelectionProfileReferenceKey,
    ...(input.configuration.analysisSpaceReferenceKey
      ? { analysisSpaceReferenceKey: input.configuration.analysisSpaceReferenceKey }
      : {}),
    maximumInlinePoints: input.intent.maximumInlinePoints
  };
  let trajectoryFinding = normalizeHistoricalTrajectoryResult(await input.gateway.execute("history.get-trajectory", trajectoryInput));
  if (trajectoryFinding.status === "PENDING" && input.configuration.pendingRetryMs > 0) {
    await retryDelay(input.configuration.pendingRetryMs);
    operations.push("history.get-trajectory");
    trajectoryFinding = normalizeHistoricalTrajectoryResult(await input.gateway.execute("history.get-trajectory", trajectoryInput));
  }
  trajectoryFinding.taskReferenceKey = resolvedContext.taskReferenceKey;
  return {
    status: trajectoryFinding.status === "PENDING" ? "PENDING" : trajectoryFinding.status === "COMPLETED" ? "COMPLETED" : "PARTIAL",
    reasonCode: trajectoryFinding.reasonCode,
    finding: trajectoryFinding,
    context: resolvedContext,
    operations
  };
}
