import type {
  HistoricalContextResolution,
  HistoricalReferenceKey,
  HistoricalTraceIntent,
  OperationalTaskSnapshot
} from "./types.js";

function sameReference(left: HistoricalReferenceKey, right: HistoricalReferenceKey): boolean {
  return left.namespace === right.namespace && left.kind === right.kind && left.id === right.id && left.version === right.version;
}

function unique(values: readonly HistoricalReferenceKey[]): HistoricalReferenceKey[] {
  return values.filter((value, index) => values.findIndex((candidate) => sameReference(candidate, value)) === index);
}

const activeStates = new Set(["STARTED_OBSERVED", "ACTIVE_OBSERVED", "PAUSED_OBSERVED"]);

export function selectUniqueActiveTask(tasks: readonly OperationalTaskSnapshot[]): HistoricalContextResolution {
  const active = tasks.filter((task) => activeStates.has(task.activityState));
  if (active.length === 0) return { status: "CONTEXT_GAP", reason: "TASK_CONTEXT_REQUIRED", candidateCount: 0 };
  if (active.length !== 1) return { status: "CONTEXT_GAP", reason: "TASK_CONTEXT_AMBIGUOUS", candidateCount: active.length };
  const selected = active[0]!;
  return {
    status: "RESOLVED",
    taskReferenceKey: selected.referenceKey,
    taskSnapshot: selected,
    taskSource: "ACTIVE_TASK_DISCOVERY"
  };
}

export function validateSubjectTaskAssociation(
  subject: HistoricalReferenceKey,
  task: OperationalTaskSnapshot
): HistoricalContextResolution {
  if (!task.actorReferenceKeys.some((actor) => sameReference(actor, subject))) {
    return { status: "CONTEXT_GAP", reason: "SUBJECT_TASK_MISMATCH", candidateCount: task.actorReferenceKeys.length };
  }
  return {
    status: "RESOLVED",
    taskReferenceKey: task.referenceKey,
    subjectReferenceKey: subject,
    taskSnapshot: task,
    taskSource: "EXPLICIT"
  };
}

export function resolveHistoricalContext(input: {
  intent: HistoricalTraceIntent;
  explicitTaskReferences?: readonly HistoricalReferenceKey[];
  knownTaskReferences?: readonly HistoricalReferenceKey[];
  priorSelectedTaskReferences?: readonly HistoricalReferenceKey[];
  explicitSubjectReferences?: readonly HistoricalReferenceKey[];
  discoveredActiveTasks?: readonly OperationalTaskSnapshot[];
  taskSnapshot?: OperationalTaskSnapshot;
  deferSubjectResolution?: boolean;
}): HistoricalContextResolution {
  const subjectCandidates = unique([
    ...(input.intent.subjectReferenceKey ? [input.intent.subjectReferenceKey] : []),
    ...(input.explicitSubjectReferences ?? [])
  ]);
  if (subjectCandidates.length > 1) {
    return { status: "CONTEXT_GAP", reason: "SUBJECT_CONTEXT_AMBIGUOUS", candidateCount: subjectCandidates.length };
  }
  const prioritizedTasks: Array<readonly [HistoricalContextResolution extends infer _ ? "EXPLICIT" | "KNOWN_CONTEXT" | "PRIOR_SELECTION" : never, readonly HistoricalReferenceKey[]]> = [
    ["EXPLICIT", unique([...(input.intent.taskReferenceKey ? [input.intent.taskReferenceKey] : []), ...(input.explicitTaskReferences ?? [])])],
    ["KNOWN_CONTEXT", unique(input.knownTaskReferences ?? [])],
    ["PRIOR_SELECTION", unique(input.priorSelectedTaskReferences ?? [])]
  ];
  let taskReference: HistoricalReferenceKey | undefined;
  let taskSource: "EXPLICIT" | "KNOWN_CONTEXT" | "PRIOR_SELECTION" | "ACTIVE_TASK_DISCOVERY" = "EXPLICIT";
  for (const [source, candidates] of prioritizedTasks) {
    if (candidates.length > 1) return { status: "CONTEXT_GAP", reason: "TASK_CONTEXT_AMBIGUOUS", candidateCount: candidates.length };
    if (candidates.length === 1) {
      taskReference = candidates[0];
      taskSource = source;
      break;
    }
  }
  if (!taskReference) {
    const discovered = selectUniqueActiveTask(input.discoveredActiveTasks ?? []);
    if (discovered.status !== "RESOLVED") return discovered;
    taskReference = discovered.taskReferenceKey;
    taskSource = "ACTIVE_TASK_DISCOVERY";
  }
  const snapshot = input.taskSnapshot ?? input.discoveredActiveTasks?.find((task) => sameReference(task.referenceKey, taskReference));
  const subject = subjectCandidates[0];
  if (subject && snapshot) {
    const association = validateSubjectTaskAssociation(subject, snapshot);
    if (association.status !== "RESOLVED") return association;
  }
  if (!subject && input.intent.queryKind !== "EXECUTION_INTERVAL") {
    if (!snapshot && input.deferSubjectResolution) {
      return { status: "RESOLVED", taskReferenceKey: taskReference, taskSource };
    }
    if (!snapshot) return { status: "CONTEXT_GAP", reason: "SUBJECT_CONTEXT_REQUIRED", candidateCount: 0 };
    const actors = unique(snapshot.actorReferenceKeys);
    if (actors.length === 0) return { status: "CONTEXT_GAP", reason: "SUBJECT_CONTEXT_REQUIRED", candidateCount: 0 };
    if (actors.length !== 1) return { status: "CONTEXT_GAP", reason: "SUBJECT_CONTEXT_AMBIGUOUS", candidateCount: actors.length };
    return { status: "RESOLVED", taskReferenceKey: taskReference, subjectReferenceKey: actors[0]!, taskSnapshot: snapshot, taskSource };
  }
  return {
    status: "RESOLVED",
    taskReferenceKey: taskReference,
    ...(subject ? { subjectReferenceKey: subject } : {}),
    ...(snapshot ? { taskSnapshot: snapshot } : {}),
    taskSource
  };
}
