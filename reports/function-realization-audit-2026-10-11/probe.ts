import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";
import { AnalysisProviderContracts, analysisHash } from "../../packages/gowm-contract-intake/src/index.js";
import { projectHistoricalTraceIntent, resolveHistoricalFollowup } from "../../packages/historical-trace-consumer/src/intent.js";
import { parseAdvancedHistoricalIntent } from "../../packages/historical-trace-consumer/src/advanced-intent.js";
import { advancedHistoryConfigurationFromEnvironment } from "../../packages/historical-trace-consumer/src/advanced-config.js";
import { MetricSemanticCatalog } from "../../packages/historical-trace-consumer/src/metric-semantic-catalog.js";
import { projectPublicWorldAnalysis } from "../../packages/historical-trace-consumer/src/public-world-analysis.js";
import { projectWorldAnalysisAvailability } from "../../services/grounding-worker/src/world-analysis-capabilities.js";
import { planHistoricalRequirements } from "../../packages/historical-trace-consumer/src/planner.js";
import { assembleProductionWorldAnalysis } from "../../services/grounding-worker/src/world-analysis-result.js";

// Local synthetic inputs and committed Provider fixtures only. No network,
// model, database, deployment, or real business identifiers are used.
const config = { maximumInlinePoints: 256, allIntervalsLimit: 100 };
const advancedConfig = advancedHistoryConfigurationFromEnvironment({ WSGS_ADVANCED_HISTORY_ENABLED: "YES" });
const catalog = new MetricSemanticCatalog();
const key = (kind: string, name: string) => ({ namespace: "gowm", kind, id: `wrf_${analysisHash(name).slice(7, 39)}`, version: "1" });
const task = key("OPERATIONAL_TASK", "audit-task");
const vehicle = key("WORLD_OBJECT", "audit-vehicle-2");
const intervalKey = key("TASK_EXECUTION_INTERVAL", "audit-interval");
const trajectoryKey = key("HISTORICAL_TRAJECTORY", "audit-trajectory");
const period = { start: "2026-09-01T08:00:00.000Z", end: "2026-09-01T08:10:00.000Z", bounds: "[)" as const };
const finding = {
  findingKind: "HISTORICAL_TRAJECTORY" as const, status: "COMPLETED" as const,
  reasonCode: "TRAJECTORY_AVAILABLE", warnings: [], taskReferenceKey: task, subjectReferenceKey: vehicle,
  executionInterval: { executionIntervalReferenceKey: intervalKey, executionNo: 1, revisionNo: 1,
    lifecycleState: "COMPLETED", selectedPeriods: [period], activePeriods: [period], pausedPeriods: [],
    derivationKind: "EXPLICIT", stabilityState: "SEALED", envelopeDurationMs: 600000, activeDurationMs: 600000, pausedDurationMs: 0 },
  trajectory: { trajectoryReferenceKey: trajectoryKey, requestedPeriods: [period], definedPeriods: [period],
    excludedPeriods: [], gaps: [], inputTrackletVersions: [],
    completeness: { temporalCoverageRatio: 1, sampleCount: 3, sequenceCount: 1, gapCount: 0, prefixComplete: true, suffixComplete: true },
    finalization: { state: "SEALED" }, inlineSamples: { mode: "BOUNDED_PREVIEW" as const, points: [], truncated: true } }
};
const reference = { referenceKey: trajectoryKey, referenceType: "HISTORICAL_TRAJECTORY" as const, revalidationRequired: false };
const prior = { finding, taskReferenceKey: task, subjectReferenceKey: vehicle, phaseScope: "EXECUTION_ENVELOPE" as const, reference };
const observations: Record<string, unknown> = {};

const plainHistory = projectHistoricalTraceIntent("2号车本次任务历史轨迹", config);
const windowedHistory = projectHistoricalTraceIntent("2号车本次任务历史轨迹，仅限2026-09-01T08:03:00Z至2026-09-01T08:04:00Z", config);
assert.deepEqual(windowedHistory, plainHistory);
const plainAdvanced = parseAdvancedHistoricalIntent("2号车本次任务通信最好的三个位置", catalog, advancedConfig);
const windowedAdvanced = parseAdvancedHistoricalIntent("2号车本次任务通信最好的三个位置，仅限2026-09-01T08:03:00Z至2026-09-01T08:04:00Z", catalog, advancedConfig);
assert.deepEqual(windowedAdvanced, plainAdvanced);
observations.timeWindow = { historyIntentUnchanged: true, advancedIntentUnchanged: true, actualScope: plainHistory };

const changedPhase = resolveHistoricalFollowup("排除暂停后，这段轨迹完整吗？", prior, config);
assert.equal(changedPhase.mode, "REUSE");
const changedSubject = resolveHistoricalFollowup("3号车第2次任务这段轨迹完整吗？", prior, config);
assert.equal(changedSubject.mode, "REUSE");
const changedScope = projectHistoricalTraceIntent("3号车第2次任务这段轨迹完整吗？", config)!;
observations.historicalFollowup = { changedPhaseMode: changedPhase.mode, changedSubjectAndExecutionMode: changedSubject.mode,
  requestedSubject: changedScope.subjectMention, requestedExecution: changedScope.executionSelection,
  priorExecution: finding.executionInterval.executionNo, priorPhaseScope: prior.phaseScope };

const compound = parseAdvancedHistoricalIntent("2号车本次任务什么时候进入A区、什么时候离开A区、停留多久？", catalog, advancedConfig);
assert.equal(compound.status, "PARSED");
assert.equal(compound.status === "PARSED" && compound.intent.analysis.kind === "TEMPORAL_EVENT" && compound.intent.analysis.eventType, "DWELL");
observations.compoundAnalysis = compound;

const contracts = new AnalysisProviderContracts(fileURLToPath(new URL("../../contracts/upstream/gowm-analysis-providers-current", import.meta.url)));
const raw = JSON.parse(readFileSync(new URL("../../validation/fixtures/advanced-history/map-match.json", import.meta.url), "utf8"));
function rewrite(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.namespace === "gowm" && typeof record.kind === "string" && typeof record.id === "string") record.id = key(record.kind, record.id).id;
  for (const child of Object.values(value)) rewrite(child);
}
rewrite(raw);
raw.execution.resultHash = analysisHash(raw.output.value);
for (const receipt of raw.receipts) { receipt.outputHash = raw.execution.resultHash; receipt.computeSnapshotHash = analysisHash(raw.computeSnapshot); }
const envelope = contracts.validateEnvelope("trajectory.map-match", raw);
const subjectKey = envelope.output.value.subjectReferenceKey!;
const fixtureTrajectoryKey = envelope.output.value.trajectoryReferenceKey;
const validUntil = "2026-10-11T12:01:00.000Z";
const referenceProducts = [subjectKey, task, intervalKey, fixtureTrajectoryKey].map((referenceKey, index) => ({
  productId: `audit-product-${index}`, productKind: "RESOLVED_REFERENCE" as const, referenceKey,
  referenceType: referenceKey.kind, displayName: referenceKey.kind,
  sourceOperation: "history.get-trajectory", sourceWorldVersion: 1, validUntil
}));
const base = JSON.parse(readFileSync(new URL("../../contracts/wsgs-v0.2.4-world-analysis/examples/empty.json", import.meta.url), "utf8"));
const foundation = { intent: { taskReferenceKey: task, subjectReferenceKey: subjectKey,
  executionSelection: { kind: "LATEST" as const }, phaseScope: "EXECUTION_ENVELOPE" as const, sourceSelection: { mode: "ONLY_CANDIDATE" as const } },
  finding: { ...finding, subjectReferenceKey: subjectKey, trajectory: { ...finding.trajectory, trajectoryReferenceKey: fixtureTrajectoryKey } },
  reference: { ...reference, referenceKey: fixtureTrajectoryKey } };
const advanced = { status: "COMPLETED" as const, reasonCode: envelope.output.value.reasonCode,
  intent: { historicalScope: { taskReferenceKey: task, executionSelection: { kind: "LATEST" as const },
    phaseScope: "EXECUTION_ENVELOPE" as const, sourceSelection: { mode: "ONLY_CANDIDATE" as const } },
    analysis: { kind: "ROAD_ASSOCIATION" as const, output: "ROAD_VISITS" as const } },
  foundation, analysisEvidence: [{ operationId: "trajectory.map-match" as const, envelope }], findings: [], operations: ["trajectory.map-match"] };
const context = { groundingId: base.groundingId, referenceProducts, evidenceItems: base.evidenceItems,
  foundationEvidenceIds: [base.evidenceItems[0].evidenceProductId], validUntil };
const withSubject = projectPublicWorldAnalysis({ context, contracts, catalog, advanced });
assert.ok(withSubject.component.findings.some(item => item.findingKind === "ROAD_ASSOCIATION"));
const withoutSubject = projectPublicWorldAnalysis({ context: { ...context, referenceProducts: referenceProducts.slice(1) }, contracts, catalog, advanced });
assert.equal(withoutSubject.component.findings.length, 0);
assert.ok(withoutSubject.component.gaps.some(item => item.gapKind === "REFERENCE_MISSING"));
observations.advancedTaskOnlyProjection = { withAdmittedSubjectFindingKinds: withSubject.component.findings.map(item => item.findingKind),
  withoutSubjectFindingCount: withoutSubject.component.findings.length, withoutSubjectGaps: withoutSubject.component.gaps.map(item => item.gapKind) };

const startedAt = Date.parse("2026-10-11T09:00:00.000Z");
const finishedAt = startedAt + 72000;
const productionChoiceValidUntil = startedAt + 60000;
const ambiguityBase = { ...base, status: "AMBIGUOUS", referenceProducts: referenceProducts.slice(0, 2),
  ambiguities: [{ ambiguityId: "audit-ambiguity", mentionId: "mention-1", surfaceText: "audit ambiguous reference",
    candidateProductIds: referenceProducts.slice(0, 2).map(value => value.productId), reason: "MULTIPLE_EXACT_MATCHES" }] };
const withChoice = assembleProductionWorldAnalysis({ base: ambiguityBase, runFingerprint: analysisHash("audit-run"),
  validUntil: new Date(productionChoiceValidUntil).toISOString(), maxResultBytes: 1048576, foundationEvidenceIds: [] });
assert.equal(withChoice.worldAnalysisFindings.choices.length, 1);
assert.equal(Date.parse(withChoice.worldAnalysisFindings.choices[0]!.validUntil) - finishedAt, -12000);
observations.choiceTtl = { simulatedProcessingMs: finishedAt - startedAt,
  actualProjectedChoiceCount: withChoice.worldAnalysisFindings.choices.length,
  remainingValidityMsAtResponse: Date.parse(withChoice.worldAnalysisFindings.choices[0]!.validUntil) - finishedAt,
  basis: "production-module.ts resultDocument uses LOAD_CONTEXT.startedAt + 60000" };

const now = new Date("2026-10-11T09:00:00.000Z");
const hash = analysisHash({});
const operationIds = ["operational-task.find", "operational-task.get", "operational-task.get-execution-intervals", "history.get-trajectory",
  "trajectory.map-match", "temporal-spatial.find-events", "spatiotemporal-metric.rank-locations"];
const operationKeys = operationIds.map((operationId, index) => ({ operationId, operationVersion: index < 4 ? "1.0" : "0.1" }));
const profiles = operationKeys.map(value => ({ ...value, semanticProfile: {}, semanticProfileHash: hash }));
const semanticHash = analysisHash(profiles);
const enabled = { history: true, advanced: true, preview: false };
// The two gate expressions below are copied from production-module.ts:901 and :3551.
const discovery = projectWorldAnalysisAvailability({ now,
  historyEnabled: enabled.history && (enabled.preview || enabled.advanced), advancedEnabled: enabled.advanced,
  expectedCatalogRevision: hash, expectedSemanticHash: semanticHash,
  locks: operationKeys.map(value => ({ ...value, maturity: "PREVIEW", inputSchemaHash: hash, outputSchemaHash: hash, semanticProfileHash: hash })),
  catalog: { registryVersion: "1.0", contractCatalogRevision: hash, bindingRevision: hash,
    capabilities: operationKeys.map(value => ({ ...value, maturity: "PREVIEW", inputSchemaHash: hash, outputSchemaHash: hash })) } as never,
  semantics: { schemaVersion: "1.1", contractCatalogRevision: hash, bindingRevision: hash, catalogHash: semanticHash, profiles } as never,
  availability: { schemaVersion: "1.0", checkedAt: now.toISOString(), operations: operationKeys.map(value => ({ ...value, maturity: "PREVIEW",
    availability: "AVAILABLE", reasonCodes: [], checkedAt: now.toISOString(), validUntil: new Date(now.getTime() + 2000).toISOString(),
    contractCatalogRevision: hash, bindingRevision: hash })) }
});
const historyPlan = planHistoricalRequirements({ intent: plainHistory!, historyEnabled: enabled.history && enabled.preview });
assert.equal(discovery.capabilities.find(value => value.capability === "HISTORICAL_TRACE")!.available, true);
assert.equal(historyPlan.reason, "HISTORY_CAPABILITY_DISABLED");
observations.featureGateMismatch = { configuration: enabled, discovery: discovery.capabilities.find(value => value.capability === "HISTORICAL_TRACE"), historyPlan };

console.log(JSON.stringify({ scope: "LOCAL_SYNTHETIC_COMPONENT_REPRODUCTION", observations }, null, 2));
