import type {
  HistoricalContextResolution,
  HistoricalRequirementPlan,
  HistoricalRequirementType,
  HistoricalTraceIntent
} from "./types.js";

export function planHistoricalRequirements(input: {
  intent: HistoricalTraceIntent;
  context?: HistoricalContextResolution;
  historyEnabled: boolean;
  priorFindingReusable?: boolean;
}): HistoricalRequirementPlan {
  if (!input.historyEnabled) return { status: "CAPABILITY_GAP", requirements: [], reason: "HISTORY_CAPABILITY_DISABLED" };
  if (input.context?.status === "CONTEXT_GAP") {
    return { status: "CAPABILITY_GAP", requirements: [], reason: input.context.reason };
  }
  if ((input.intent.queryKind === "TRAJECTORY_COMPLETENESS" || input.intent.queryKind === "TRAJECTORY_GAPS") && input.priorFindingReusable) {
    return {
      status: "PROJECTION_ONLY",
      requirements: [input.intent.queryKind === "TRAJECTORY_COMPLETENESS" ? "READ_TRAJECTORY_COMPLETENESS" : "READ_TRAJECTORY_GAPS"]
    };
  }
  const trajectory = input.intent.queryKind !== "EXECUTION_INTERVAL";
  if (trajectory && input.intent.executionSelection.kind === "ALL") {
    return {
      status: "CAPABILITY_GAP",
      requirements: ["READ_TASK_EXECUTION_INTERVAL"],
      reason: "MULTI_EXECUTION_TRAJECTORY_NOT_SUPPORTED"
    };
  }
  const requirements: HistoricalRequirementType[] = [];
  if (!input.intent.taskReferenceKey && input.intent.subjectReferenceKey) requirements.push("FIND_RELEVANT_OPERATIONAL_TASK" as const);
  if (trajectory) requirements.push("READ_OPERATIONAL_TASK" as const);
  requirements.push("READ_TASK_EXECUTION_INTERVAL" as const);
  if (trajectory) requirements.push("READ_HISTORICAL_TRAJECTORY" as const);
  return { status: "PLANNED", requirements };
}
