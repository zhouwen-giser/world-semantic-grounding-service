import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createWorldAnalysisValidator, worldAnalysisResultHash } from "@wsgs/contracts";
import type { ReferenceProduct, ReferenceValidationProduct } from "@wsgs/grounding-graph";
import type { HistoricalExecutionResult, AdvancedHistoricalFoundation } from "@wsgs/historical-trace-consumer";
import { admitHistoricalSubject } from "./historical-subject.js";
import { assembleProductionWorldAnalysis } from "./world-analysis-result.js";

const key = (kind: string, digit: string, version = "1") => ({ namespace: "gowm" as const, kind, id: `wrf_${digit.repeat(32)}`, version });
const task = key("OPERATIONAL_TASK", "a"), subject = key("WORLD_OBJECT", "b", "2"), historical = { ...subject, version: "1" };
const current = { ...subject, version: "3" }, interval = key("TASK_EXECUTION_INTERVAL", "c"), trajectory = key("HISTORICAL_TRAJECTORY", "d");
const now = Date.parse("2026-09-09T12:00:00Z"), until = "2026-09-09T12:01:00.000Z";
const valid = (referenceKey = current): ReferenceValidationProduct => ({ referenceKey, status: "VALID", revalidationRequired: false, warnings: [] });
function setup() {
  const period = { start: "2026-09-09T10:00:00Z", end: "2026-09-09T11:00:00Z", bounds: "[)" as const };
  const execution: HistoricalExecutionResult = { status: "PARTIAL", reasonCode: "TRAJECTORY_GAP", operations: ["history.get-trajectory"],
    context: { status: "RESOLVED", taskSource: "EXPLICIT", taskReferenceKey: task, subjectReferenceKey: subject,
      taskSnapshot: { referenceKey: task, actorReferenceKeys: [historical], activityState: "COMPLETED" } },
    finding: { findingKind: "HISTORICAL_TRAJECTORY", status: "PARTIAL", reasonCode: "TRAJECTORY_GAP", warnings: [],
      subjectReferenceKey: historical, taskReferenceKey: task,
      executionInterval: { executionIntervalReferenceKey: interval, executionNo: 1, revisionNo: 1, lifecycleState: "CLOSED",
        selectedPeriods: [period], activePeriods: [period], pausedPeriods: [], derivationKind: "EXPLICIT", stabilityState: "PROVISIONAL",
        envelopeDurationMs: 3600000, activeDurationMs: 3600000, pausedDurationMs: 0 },
      trajectory: { trajectoryReferenceKey: trajectory, requestedPeriods: [period], definedPeriods: [period], excludedPeriods: [],
        gaps: [{ range: period, kind: "MISSING_OBSERVATIONS", reasonCodes: [] }], inputTrackletVersions: [],
        completeness: { temporalCoverageRatio: 0.9, sampleCount: 12, sequenceCount: 2, gapCount: 1, prefixComplete: false, suffixComplete: true },
        finalization: { state: "PROVISIONAL" }, inlineSamples: { mode: "BOUNDED_PREVIEW", points: [], truncated: true } } }
  };
  const resolve = vi.fn(async () => ({ referenceKey: current, referenceType: "WORLD_OBJECT", displayName: "Task actor", sourceWorldVersion: 0, stale: false }));
  const validate = vi.fn(async () => valid());
  const references: { referenceProducts: ReferenceProduct[]; validationResults: ReferenceValidationProduct[] } = { referenceProducts: [], validationResults: [] };
  return { execution, references, resolve, validate, validityTtlMs: 60000, now: () => now };
}

describe("historical subject admission", () => {
  it("admits a task-only subject and assembles a real linked trace without changing historical evidence", async () => {
    const input = setup(), before = structuredClone(input.execution.finding);
    const admitted = await admitHistoricalSubject(input);
    expect(admitted.status).toBe("ADMITTED"); if (admitted.status !== "ADMITTED") throw Error("not admitted");
    expect(admitted.product).toMatchObject({ productKind: "DERIVED_REFERENCE", referenceKey: current, validUntil: until, revalidationRequired: false });
    const base = JSON.parse(readFileSync(new URL("../../../contracts/wsgs-v0.2.4-world-analysis/examples/empty.json", import.meta.url), "utf8"));
    base.status = "PARTIAL";
    base.referenceProducts = [{ productId: "task", productKind: "DERIVED_REFERENCE", referenceKey: task,
      referenceType: "OPERATIONAL_TASK", displayName: "Task", sourceOperation: "operational-task.get", sourceWorldVersion: 0 }, admitted.product];
    const foundation: AdvancedHistoricalFoundation = { finding: input.execution.finding!,
      reference: { referenceKey: trajectory, referenceType: "HISTORICAL_TRAJECTORY", revalidationRequired: true, validUntil: until },
      intent: { taskReferenceKey: task, subjectReferenceKey: admitted.product.referenceKey, executionSelection: { kind: "LATEST" },
        phaseScope: "EXECUTION_ENVELOPE", sourceSelection: { mode: "ONLY_CANDIDATE" }, maximumInlinePoints: 256 } };
    const result = assembleProductionWorldAnalysis({ base, foundation, historicalExecution: input.execution,
      runFingerprint: `sha256:${"a".repeat(64)}`, validUntil: until, maxResultBytes: 1048576, foundationEvidenceIds: [base.evidenceItems[0].evidenceProductId] });
    expect(result.worldAnalysisFindings.gaps).toEqual([]);
    expect(result.worldAnalysisFindings.findings).toHaveLength(1);
    expect(result.worldAnalysisFindings.findings[0]).toMatchObject({ findingKind: "HISTORICAL_TRACE", status: "PARTIAL",
      subjectReferenceProductIds: [admitted.product.productId], coverage: { finalizationState: "PROVISIONAL", sampleCount: 12 } });
    expect((result.worldAnalysisFindings.findings[0] as { trajectoryGaps: unknown[] }).trajectoryGaps).toHaveLength(1);
    expect(createWorldAnalysisValidator()("result", result)).toEqual({ valid: true, errors: [] });
    expect(result.resultHash).toBe(worldAnalysisResultHash(result));
    expect(input.execution.finding).toEqual(before);
  });
  it("reuses a freshly validated exact product without a Gateway call", async () => {
    const input = setup();
    const product: ReferenceProduct = { productId: "existing", productKind: "RESOLVED_REFERENCE", referenceKey: subject,
      referenceType: "WORLD_OBJECT", displayName: "Actor", matchedBy: "EXACT", matchScore: 1, sourceOperation: "VALIDATE_REFERENCES",
      sourceWorldVersion: 1, revalidationRequired: false, validUntil: until, safeSummary: {} };
    input.references = { referenceProducts: [product], validationResults: [valid(subject)] };
    expect(await admitHistoricalSubject(input)).toEqual({ status: "ADMITTED", product, validation: valid(subject) });
    expect(input.resolve).not.toHaveBeenCalled(); expect(input.validate).not.toHaveBeenCalled();
    product.validUntil = new Date(now - 1).toISOString();
    expect((await admitHistoricalSubject(input)).status).toBe("ADMITTED"); expect(input.resolve).toHaveBeenCalledTimes(1);
  });
  it.each(["SCOPE_DENIED", "NOT_FOUND", "EXPIRED", "TYPE_MISMATCH", "VERSION_CONFLICT"] as const)("does not admit %s or refresh it", async status => {
    const input = setup(); input.validate.mockResolvedValue({ ...valid(), status });
    expect(await admitHistoricalSubject(input)).toEqual({ status: "REJECTED", reasonCode: "REFERENCE_MISSING" });
    expect(input.resolve).toHaveBeenCalledTimes(1);
  });
  it("allows only one stale refresh and requires validation of the exact returned key", async () => {
    const input = setup(); input.validate.mockResolvedValueOnce({ ...valid(), status: "STALE", revalidationRequired: true });
    expect((await admitHistoricalSubject(input)).status).toBe("ADMITTED"); expect(input.resolve).toHaveBeenCalledTimes(2);
    input.resolve.mockClear(); input.validate.mockResolvedValue({ ...valid(), status: "STALE" });
    expect((await admitHistoricalSubject(input)).status).toBe("REJECTED"); expect(input.resolve).toHaveBeenCalledTimes(2);
    input.validate.mockResolvedValue(valid({ ...current, version: "other" }));
    expect((await admitHistoricalSubject(input)).status).toBe("REJECTED");
  });
  it.each(["wrong-actor", "wrong-task", "wrong-subject", "wrong-kind"])("rejects %s before reading descriptors", async mode => {
    const input = setup();
    if (mode === "wrong-actor") input.execution.context!.taskSnapshot!.actorReferenceKeys = [key("WORLD_OBJECT", "e")];
    if (mode === "wrong-task") input.execution.finding!.taskReferenceKey = key("OPERATIONAL_TASK", "e");
    if (mode === "wrong-subject") input.execution.finding!.subjectReferenceKey = key("WORLD_OBJECT", "e");
    if (mode === "wrong-kind") input.execution.context!.subjectReferenceKey = { ...subject, kind: "OPERATIONAL_TASK" };
    expect((await admitHistoricalSubject(input)).status).toBe("REJECTED"); expect(input.resolve).not.toHaveBeenCalled();
  });
  it("rejects descriptor identity substitution and preserves old evidence", async () => {
    const input = setup(), before = structuredClone(input.execution);
    input.resolve.mockResolvedValue({ referenceKey: key("WORLD_OBJECT", "e"), referenceType: "WORLD_OBJECT", displayName: "Wrong", sourceWorldVersion: 0, stale: false });
    expect((await admitHistoricalSubject(input)).status).toBe("REJECTED");
    expect(input.validate).not.toHaveBeenCalled(); expect(input.execution).toEqual(before);
  });
});
