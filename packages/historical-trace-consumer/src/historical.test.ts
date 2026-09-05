import { describe, expect, it } from "vitest";

import {
  compareHistoricalFindings,
  executeHistoricalTrace,
  historicalTraceConfigurationFromEnvironment,
  normalizeExecutionIntervalResult,
  normalizeHistoricalTrajectoryResult,
  planHistoricalRequirements,
  projectHistoricalReference,
  projectHistoricalTraceIntent,
  resolveHistoricalContext,
  resolveHistoricalFollowup,
  selectUniqueActiveTask,
  validateSubjectTaskAssociation,
  type HistoricalReferenceKey,
  type HistoricalTraceFinding,
  type OperationalTaskSnapshot
} from "./index.js";

const configuration = { maximumInlinePoints: 128, allIntervalsLimit: 50 };
const task: HistoricalReferenceKey = { namespace: "gowm", kind: "OPERATIONAL_TASK", id: "task-a", version: "3" };
const vehicle: HistoricalReferenceKey = { namespace: "gowm", kind: "WORLD_OBJECT", id: "vehicle-2", version: "7" };
const otherVehicle: HistoricalReferenceKey = { namespace: "gowm", kind: "WORLD_OBJECT", id: "vehicle-3", version: "2" };
const snapshot: OperationalTaskSnapshot = {
  referenceKey: task,
  actorReferenceKeys: [vehicle],
  activityState: "ACTIVE_OBSERVED"
};

describe("historical intent projection", () => {
  it.each([
    ["任务A什么时候开始执行？", "EXECUTION_INTERVAL", "LATEST", "EXECUTION_ENVELOPE"],
    ["任务A暂停过几次？", "EXECUTION_INTERVAL", "LATEST", "EXECUTION_ENVELOPE"],
    ["2号车在任务A中的轨迹是什么？", "HISTORICAL_TRAJECTORY", "LATEST", "EXECUTION_ENVELOPE"],
    ["排除暂停阶段后的轨迹是什么？", "HISTORICAL_TRAJECTORY", "LATEST", "ACTIVE_PHASES_ONLY"],
    ["第2次执行的轨迹是什么？", "HISTORICAL_TRAJECTORY", "EXECUTION_NO", "EXECUTION_ENVELOPE"],
    ["任务A所有执行记录是什么？", "EXECUTION_INTERVAL", "ALL", "EXECUTION_ENVELOPE"],
    ["这段轨迹完整吗？", "TRAJECTORY_COMPLETENESS", "LATEST", "EXECUTION_ENVELOPE"],
    ["这段轨迹有哪些缺失时段？", "TRAJECTORY_GAPS", "LATEST", "EXECUTION_ENVELOPE"]
  ])("projects %s", (text, kind, selection, scope) => {
    const intent = projectHistoricalTraceIntent(text, configuration);
    expect(intent).toMatchObject({ queryKind: kind, executionSelection: { kind: selection }, phaseScope: scope });
  });

  it("keeps task selection separate from execution selection", () => {
    expect(projectHistoricalTraceIntent("2号车在任务A中第十二次执行的轨迹是什么？", configuration)).toMatchObject({
      taskMention: "任务A",
      subjectMention: "2号车",
      executionSelection: { kind: "EXECUTION_NO", executionNo: 12 }
    });
  });

  it("does not project unrelated current-world text", () => {
    expect(projectHistoricalTraceIntent("2号车现在在哪里？", configuration)).toBeNull();
  });

  it("rejects an unbounded execution number instead of silently selecting latest", () => {
    expect(() => projectHistoricalTraceIntent(
      "第999999999999999999999999次执行的轨迹是什么？",
      configuration
    )).toThrow(/HISTORICAL_EXECUTION_NUMBER_INVALID/u);
  });
});

describe("historical task and subject context", () => {
  it("applies explicit, known, prior, then active-task priority", () => {
    const intent = projectHistoricalTraceIntent("2号车本次任务走过哪里？", configuration)!;
    const result = resolveHistoricalContext({
      intent,
      explicitTaskReferences: [task],
      knownTaskReferences: [{ ...task, id: "known" }],
      priorSelectedTaskReferences: [{ ...task, id: "prior" }],
      explicitSubjectReferences: [vehicle],
      taskSnapshot: snapshot
    });
    expect(result).toMatchObject({ status: "RESOLVED", taskReferenceKey: task, subjectReferenceKey: vehicle, taskSource: "EXPLICIT" });
  });

  it("selects only a unique active task", () => {
    expect(selectUniqueActiveTask([snapshot])).toMatchObject({ status: "RESOLVED", taskReferenceKey: task });
    expect(selectUniqueActiveTask([{ ...snapshot, activityState: "STOPPED_OBSERVED" }])).toEqual({
      status: "CONTEXT_GAP", reason: "TASK_CONTEXT_REQUIRED", candidateCount: 0
    });
    expect(selectUniqueActiveTask([snapshot, { ...snapshot, referenceKey: { ...task, id: "task-b" } }])).toMatchObject({
      status: "CONTEXT_GAP", reason: "TASK_CONTEXT_AMBIGUOUS", candidateCount: 2
    });
  });

  it("rejects a vehicle-task mismatch before trajectory consumption", () => {
    expect(validateSubjectTaskAssociation(otherVehicle, snapshot)).toEqual({
      status: "CONTEXT_GAP", reason: "SUBJECT_TASK_MISMATCH", candidateCount: 1
    });
  });

  it("uses the only actor and never guesses the first actor", () => {
    const intent = projectHistoricalTraceIntent("任务A的轨迹是什么？", configuration)!;
    expect(resolveHistoricalContext({ intent, explicitTaskReferences: [task], taskSnapshot: snapshot })).toMatchObject({
      status: "RESOLVED", subjectReferenceKey: vehicle
    });
    expect(resolveHistoricalContext({
      intent,
      explicitTaskReferences: [task],
      taskSnapshot: { ...snapshot, actorReferenceKeys: [vehicle, otherVehicle] }
    })).toEqual({ status: "CONTEXT_GAP", reason: "SUBJECT_CONTEXT_AMBIGUOUS", candidateCount: 2 });
  });
});

describe("historical requirement planning", () => {
  it("plans interval and trajectory calls without redundant projection calls", () => {
    const interval = projectHistoricalTraceIntent("任务A所有执行记录是什么？", configuration)!;
    expect(planHistoricalRequirements({ intent: interval, historyEnabled: true })).toEqual({
      status: "PLANNED", requirements: ["READ_TASK_EXECUTION_INTERVAL"]
    });
    const trajectory = projectHistoricalTraceIntent("2号车在任务A中的轨迹是什么？", configuration)!;
    expect(planHistoricalRequirements({ intent: trajectory, historyEnabled: true })).toEqual({
      status: "PLANNED",
      requirements: ["READ_OPERATIONAL_TASK", "READ_TASK_EXECUTION_INTERVAL", "READ_HISTORICAL_TRAJECTORY"]
    });
    const completeness = projectHistoricalTraceIntent("这段轨迹完整吗？", configuration)!;
    expect(planHistoricalRequirements({ intent: completeness, historyEnabled: true, priorFindingReusable: true })).toEqual({
      status: "PROJECTION_ONLY", requirements: ["READ_TRAJECTORY_COMPLETENESS"]
    });
  });

  it("rejects multi-execution trajectory and disabled history", () => {
    const all = projectHistoricalTraceIntent("任务A所有执行轨迹是什么？", configuration)!;
    expect(planHistoricalRequirements({ intent: all, historyEnabled: true })).toMatchObject({
      status: "CAPABILITY_GAP", reason: "MULTI_EXECUTION_TRAJECTORY_NOT_SUPPORTED"
    });
    expect(planHistoricalRequirements({ intent: all, historyEnabled: false })).toMatchObject({
      status: "CAPABILITY_GAP", reason: "HISTORY_CAPABILITY_DISABLED"
    });
  });
});

const intervalResult = {
  schemaVersion: "1.1",
  status: "COMPLETED",
  reasonCode: "EXECUTION_INTERVAL_AVAILABLE",
  requestedPhaseScope: "EXECUTION_ENVELOPE",
  intervals: [{
    executionIntervalReferenceKey: { namespace: "gowm", kind: "TASK_EXECUTION_INTERVAL", id: "interval-1", version: "2" },
    executionNo: 2,
    revisionNo: 3,
    start: "2026-09-04T00:00:00.000Z",
    end: "2026-09-04T00:10:00.000Z",
    lifecycleState: "CLOSED",
    selectedPeriods: [{ start: "2026-09-04T00:00:00.000Z", end: "2026-09-04T00:10:00.000Z", bounds: "[)" }],
    activePeriods: [
      { start: "2026-09-04T00:00:00.000Z", end: "2026-09-04T00:04:00.000Z" },
      { start: "2026-09-04T00:06:00.000Z", end: "2026-09-04T00:10:00.000Z" }
    ],
    pausedPeriods: [{ start: "2026-09-04T00:04:00.000Z", end: "2026-09-04T00:06:00.000Z" }],
    derivationKind: "OBSERVED",
    stabilityState: "SEALED",
    confidence: 1,
    reasonCodes: []
  }],
  truncated: false
};

function trajectoryResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    status: "COMPLETED",
    reasonCode: "TRAJECTORY_AVAILABLE",
    subjectReferenceKey: vehicle,
    executionIntervalReferenceKey: intervalResult.intervals[0]!.executionIntervalReferenceKey,
    trajectoryReferenceKey: { namespace: "gowm", kind: "HISTORICAL_TRAJECTORY", id: "trajectory-1", version: "4" },
    requestedPeriods: [{ start: "2026-09-04T00:00:00.000Z", end: "2026-09-04T00:10:00.000Z" }],
    definedPeriods: [{ start: "2026-09-04T00:00:00.000Z", end: "2026-09-04T00:10:00.000Z" }],
    excludedPeriods: [],
    gaps: [],
    inputTrackletVersions: [{ contentHash: `sha256:${"a".repeat(64)}` }],
    completeness: { temporalCoverageRatio: 1, sampleCount: 2, sequenceCount: 1, gapCount: 0, prefixComplete: true, suffixComplete: true },
    finalization: { state: "SEALED", observedThrough: "2026-09-04T00:10:00.000Z" },
    preview: [{ observedAt: "2026-09-04T00:00:00.000Z", position: { type: "Point", coordinates: [1, 2] } }, { observedAt: "2026-09-04T00:10:00.000Z", position: { type: "Point", coordinates: [2, 3] } }],
    warnings: [],
    ...overrides
  };
}

describe("historical result normalization", () => {
  it("derives durations only from returned periods", () => {
    const finding = normalizeExecutionIntervalResult(intervalResult);
    expect(finding.executionInterval).toMatchObject({ envelopeDurationMs: 600_000, activeDurationMs: 480_000, pausedDurationMs: 120_000 });
  });

  it("keeps paused periods separate from trajectory gaps", () => {
    const finding = normalizeHistoricalTrajectoryResult(trajectoryResult({
      excludedPeriods: [{ range: intervalResult.intervals[0]!.pausedPeriods[0], reason: "EXCLUDED_PAUSED_PHASE" }]
    }));
    expect(finding.trajectory?.completeness.gapCount).toBe(0);
    expect(finding.warnings).toContain("PAUSED_PERIODS_ARE_EXCLUDED_NOT_MISSING");
  });

  it("marks truncated samples as preview and never creates geometry", () => {
    const finding = normalizeHistoricalTrajectoryResult(trajectoryResult({
      completeness: { temporalCoverageRatio: 0.8, sampleCount: 100, sequenceCount: 1, gapCount: 1, prefixComplete: true, suffixComplete: false }
    }));
    expect(finding.trajectory?.inlineSamples).toMatchObject({ mode: "BOUNDED_PREVIEW", truncated: true });
    expect(finding.trajectory).not.toHaveProperty("geometry");
  });

  it("maps pending and conflicts without publishing references", () => {
    const pending = normalizeHistoricalTrajectoryResult(trajectoryResult({
      status: "NO_DATA", reasonCode: "PROJECTION_PENDING", trajectoryReferenceKey: undefined,
      completeness: { temporalCoverageRatio: 0, sampleCount: 0, sequenceCount: 0, gapCount: 0, prefixComplete: false, suffixComplete: false },
      preview: [], finalization: { state: "PROVISIONAL" }
    }));
    expect(pending.status).toBe("PENDING");
    expect(projectHistoricalReference(pending, 30_000)).toBeNull();
    const conflicted = normalizeHistoricalTrajectoryResult(trajectoryResult({ finalization: { state: "CONFLICTED" } }));
    expect(conflicted.status).toBe("INDETERMINATE");
    expect(projectHistoricalReference(conflicted, 30_000)).toBeNull();
  });

  it("publishes stable sealed references and short-lived provisional references", () => {
    const sealed = normalizeHistoricalTrajectoryResult(trajectoryResult());
    expect(projectHistoricalReference(sealed, 30_000, new Date("2026-09-04T01:00:00Z"))).toMatchObject({ revalidationRequired: false });
    const provisional = normalizeHistoricalTrajectoryResult(trajectoryResult({ finalization: { state: "PROVISIONAL" } }));
    expect(projectHistoricalReference(provisional, 30_000, new Date("2026-09-04T01:00:00Z"))).toMatchObject({
      revalidationRequired: true, validUntil: "2026-09-04T01:00:30.000Z"
    });
  });
});

describe("historical multi-turn behavior", () => {
  const finding = normalizeHistoricalTrajectoryResult(trajectoryResult());
  const prior = { finding, taskReferenceKey: task, subjectReferenceKey: vehicle, phaseScope: "EXECUTION_ENVELOPE" as const };

  it("reuses completeness and gaps without an upstream call", () => {
    expect(resolveHistoricalFollowup("这段轨迹完整吗？", prior, configuration)).toMatchObject({ mode: "REUSE", queryKind: "TRAJECTORY_COMPLETENESS" });
    expect(resolveHistoricalFollowup("这段轨迹有哪些缺失？", prior, configuration)).toMatchObject({ mode: "REUSE", queryKind: "TRAJECTORY_GAPS" });
  });

  it("requeries active-only and update follow-ups", () => {
    expect(resolveHistoricalFollowup("排除暂停阶段呢？", prior, configuration)).toMatchObject({
      mode: "REQUERY", intent: { phaseScope: "ACTIVE_PHASES_ONLY", taskReferenceKey: task, subjectReferenceKey: vehicle }
    });
    expect(resolveHistoricalFollowup("现在更新了吗？", prior, configuration)).toMatchObject({ mode: "REQUERY", compareWithPrior: true });
  });

  it("requeries an expired provisional reference", () => {
    const expired = {
      ...prior,
      reference: {
        referenceKey: finding.trajectory!.trajectoryReferenceKey!,
        referenceType: "HISTORICAL_TRAJECTORY" as const,
        revalidationRequired: true,
        validUntil: "2026-09-04T00:00:00.000Z"
      }
    };
    expect(resolveHistoricalFollowup("排除暂停阶段呢？", expired, configuration, new Date("2026-09-04T01:00:00Z"))).toMatchObject({
      mode: "REQUERY", compareWithPrior: true
    });
    expect(resolveHistoricalFollowup("这段轨迹完整吗？", expired, configuration, new Date("2026-09-04T01:00:00Z"))).toMatchObject({
      mode: "REQUERY", compareWithPrior: true
    });
  });

  it("compares reference versions, finalization, status, and tracklet inputs", () => {
    expect(compareHistoricalFindings(finding, finding)).toEqual({ changed: false, changedFields: [] });
    const changed = normalizeHistoricalTrajectoryResult(trajectoryResult({
      trajectoryReferenceKey: { namespace: "gowm", kind: "HISTORICAL_TRAJECTORY", id: "trajectory-1", version: "5" },
      finalization: { state: "PROVISIONAL" }
    }));
    expect(compareHistoricalFindings(finding, changed)).toMatchObject({
      changed: true,
      changedFields: expect.arrayContaining(["trajectory.version", "trajectory.finalization"])
    });
  });

  it("does not invent a trajectory reference for pending findings", () => {
    const pending: HistoricalTraceFinding = { findingKind: "HISTORICAL_TRAJECTORY", status: "PENDING", reasonCode: "HISTORICAL_PROJECTION_PENDING", warnings: [] };
    expect(resolveHistoricalFollowup("这段轨迹完整吗？", { ...prior, finding: pending }, configuration)).toMatchObject({
      mode: "REUSE", finding: { status: "PENDING" }
    });
  });
});

describe("historical Gateway orchestration", () => {
  const runtimeConfiguration = historicalTraceConfigurationFromEnvironment({ WSGS_HISTORY_TRACE_ENABLED: "YES" });

  it("discovers one active task for a vehicle and consumes interval then trajectory", async () => {
    const calls: string[] = [];
    const result = await executeHistoricalTrace({
      intent: { ...projectHistoricalTraceIntent("2号车本次任务走过哪里？", configuration)!, subjectReferenceKey: vehicle },
      configuration: runtimeConfiguration,
      subjectReferenceKeys: [vehicle],
      gateway: { execute: async (operationId) => {
        calls.push(operationId);
        if (operationId === "operational-task.find") return { schemaVersion: "1.0", tasks: [snapshot], truncated: false };
        if (operationId === "operational-task.get") return snapshot;
        if (operationId === "operational-task.get-execution-intervals") return intervalResult;
        return trajectoryResult();
      } }
    });
    expect(result).toMatchObject({ status: "COMPLETED", finding: { findingKind: "HISTORICAL_TRAJECTORY" } });
    expect(calls).toEqual([
      "operational-task.find", "operational-task.get", "operational-task.get-execution-intervals", "history.get-trajectory"
    ]);
  });

  it("stops before trajectory on subject mismatch", async () => {
    const calls: string[] = [];
    const result = await executeHistoricalTrace({
      intent: {
        ...projectHistoricalTraceIntent("3号车在任务A中的轨迹是什么？", configuration)!,
        taskReferenceKey: task,
        subjectReferenceKey: otherVehicle
      },
      configuration: runtimeConfiguration,
      taskReferenceKeys: [task],
      subjectReferenceKeys: [otherVehicle],
      gateway: { execute: async (operationId) => {
        calls.push(operationId);
        return snapshot;
      } }
    });
    expect(result).toMatchObject({ status: "CAPABILITY_GAP", reasonCode: "SUBJECT_TASK_MISMATCH" });
    expect(calls).toEqual(["operational-task.get"]);
  });

  it("stops before trajectory while interval projection is pending", async () => {
    const calls: string[] = [];
    const result = await executeHistoricalTrace({
      intent: {
        ...projectHistoricalTraceIntent("2号车在任务A中的轨迹是什么？", configuration)!,
        taskReferenceKey: task,
        subjectReferenceKey: vehicle
      },
      configuration: runtimeConfiguration,
      taskReferenceKeys: [task],
      subjectReferenceKeys: [vehicle],
      gateway: { execute: async (operationId) => {
        calls.push(operationId);
        if (operationId === "operational-task.get") return snapshot;
        return { ...intervalResult, status: "NO_DATA", reasonCode: "PROJECTION_PENDING", intervals: [] };
      } }
    });
    expect(result).toMatchObject({ status: "PENDING", reasonCode: "HISTORICAL_PROJECTION_PENDING" });
    expect(calls).toEqual(["operational-task.get", "operational-task.get-execution-intervals"]);
  });

  it("performs at most one configured pending retry", async () => {
    const calls: string[] = [];
    let intervalCalls = 0;
    const result = await executeHistoricalTrace({
      intent: {
        ...projectHistoricalTraceIntent("2号车在任务A中的轨迹是什么？", configuration)!,
        taskReferenceKey: task,
        subjectReferenceKey: vehicle
      },
      configuration: { ...runtimeConfiguration, pendingRetryMs: 1 },
      taskReferenceKeys: [task],
      subjectReferenceKeys: [vehicle],
      gateway: { execute: async (operationId) => {
        calls.push(operationId);
        if (operationId === "operational-task.get") return snapshot;
        if (operationId === "operational-task.get-execution-intervals") {
          intervalCalls += 1;
          return intervalCalls === 1
            ? { ...intervalResult, status: "NO_DATA", reasonCode: "PROJECTION_PENDING", intervals: [] }
            : intervalResult;
        }
        return trajectoryResult();
      } }
    });
    expect(result.status).toBe("COMPLETED");
    expect(calls).toEqual([
      "operational-task.get",
      "operational-task.get-execution-intervals",
      "operational-task.get-execution-intervals",
      "history.get-trajectory"
    ]);
  });

  it("validates bounded development configuration", () => {
    expect(runtimeConfiguration.pendingRetryMs).toBe(0);
    expect(() => historicalTraceConfigurationFromEnvironment({ WSGS_HISTORY_TRACE_ENABLED: "MAYBE" })).toThrow(
      /WSGS_HISTORY_TRACE_ENABLED_INVALID/u
    );
    expect(() => historicalTraceConfigurationFromEnvironment({
      WSGS_HISTORY_TRACE_ENABLED: "YES", WSGS_HISTORY_MAX_INLINE_POINTS: "10001"
    })).toThrow(/WSGS_HISTORY_MAX_INLINE_POINTS_INVALID/u);
  });
});
