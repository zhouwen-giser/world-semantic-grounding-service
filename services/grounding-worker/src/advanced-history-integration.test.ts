import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GroundingResult12 } from "@wsgs/contracts";
import type { ReferenceGroundingResult } from "@wsgs/grounding-graph";
import { AnalysisProviderContracts, analysisHash, type OperationalGowmLock } from "@wsgs/gowm-contract-intake";
import { advancedHistoryConfigurationFromEnvironment, historicalTraceConfigurationFromEnvironment, MetricSemanticCatalog,
  parseAdvancedHistoricalIntent, normalizeMetricRanking, type AdvancedHistoricalExecutionResult } from "@wsgs/historical-trace-consumer";
import { advancedEvidence, historicalFoundationForAdvanced, publicAnalysisSelectionFailure, selectProductionSouthboundLock } from "./production-module.js";
import type { PriorAnalysisAuthority } from "./prior-analysis-authority.js";

const contracts = new AnalysisProviderContracts(fileURLToPath(new URL("../../../contracts/upstream/gowm-analysis-providers-current", import.meta.url)));
const config = advancedHistoryConfigurationFromEnvironment({ WSGS_ADVANCED_HISTORY_ENABLED: "YES" });
const history = historicalTraceConfigurationFromEnvironment({ WSGS_HISTORY_TRACE_ENABLED: "YES" });
const baselineLock = (): OperationalGowmLock => JSON.parse(readFileSync(fileURLToPath(new URL("../../../contracts/upstream/gowm-0.6.3/extracted/package/bundle/locks/wsgs-southbound-operation-lock-v2.json", import.meta.url)), "utf8")) as OperationalGowmLock;
describe("production advanced-history integration boundaries", () => {
  it("does not relabel a legacy trajectory as a new execution or unresolved subject", () => {
    const parsed = parseAdvancedHistoricalIntent("最后经过哪个路口", new MetricSemanticCatalog(), config);
    if (parsed.status !== "PARSED") throw new Error("expected parsed");
    const key = { namespace: "gowm", kind: "HISTORICAL_TRAJECTORY", id: "trajectory", version: "1" };
    const prior = { phaseScope: "EXECUTION_ENVELOPE" as const, taskReferenceKey: { ...key, kind: "OPERATIONAL_TASK" }, subjectReferenceKey: { ...key, kind: "WORLD_OBJECT" },
      reference: { referenceKey: key, referenceType: "HISTORICAL_TRAJECTORY" as const, revalidationRequired: false },
      finding: { findingKind: "HISTORICAL_TRAJECTORY" as const, status: "COMPLETED" as const, reasonCode: "TRAJECTORY_AVAILABLE", warnings: [], trajectory: { trajectoryReferenceKey: key } } };
    const typedPrior = prior as Parameters<typeof historicalFoundationForAdvanced>[0];
    expect(historicalFoundationForAdvanced(typedPrior, parsed.intent, "最后经过哪个路口")).toBeDefined();
    expect(historicalFoundationForAdvanced(typedPrior, parsed.intent, "最近一次任务最后经过哪个路口")).toBeUndefined();
    parsed.intent.historicalScope.subjectMention = "3号车";
    expect(historicalFoundationForAdvanced(typedPrior, parsed.intent, "3号车最后经过哪个路口")).toBeUndefined();
  });
  it("keeps base readiness lock independent of absent optional Providers", () => {
    const lock = baselineLock();
    const selected = selectProductionSouthboundLock(lock, [], true, contracts.authorizations);
    expect(selected.defaultOperations.length).toBeGreaterThan(0);
    expect(selected.previewOperations.filter(op => contracts.authorizations.some(auth => auth.operationId === op.operationId))).toEqual([]);
  });
  it("does not confuse 0.1 analysis with 1.0 history and ignores drift", () => {
    const lock = baselineLock();
    const template = lock.previewOperations[0]!;
    const auth = contracts.authorizations[0]!;
    const exact = { ...template, operationId: auth.operationId, operationVersion: auth.operationVersion,
      inputSchemaHash: auth.inputSchemaHash, outputSchemaHash: auth.outputSchemaHash, semanticProfileHash: auth.semanticProfileHash };
    const extended = { ...lock, previewOperations: [...lock.previewOperations, exact] };
    expect(selectProductionSouthboundLock(extended, [], true, contracts.authorizations).previewOperations).toContainEqual(exact);
    exact.operationVersion = "1.0" as typeof exact.operationVersion;
    expect(selectProductionSouthboundLock(extended, [], true, contracts.authorizations).previewOperations.some(entry => entry.operationId === auth.operationId)).toBe(false);
  });
  it("publishes bounded CAPABILITY_RESULT, preserves provenance and never mints analysis references", () => {
    const raw: unknown = JSON.parse(readFileSync(fileURLToPath(new URL("../../../validation/fixtures/advanced-history/metric-shared-campus.json", import.meta.url)), "utf8"));
    const envelope = contracts.validateEnvelope("spatiotemporal-metric.rank-locations", raw);
    const parsed = parseAdvancedHistoricalIntent("让2号车回到通信最好的位置", new MetricSemanticCatalog(), config);
    if (parsed.status !== "PARSED" || parsed.intent.analysis.kind !== "METRIC_RANKING") throw new Error("metric required");
    const execution: AdvancedHistoricalExecutionResult = { status: "PARTIAL", reasonCode: envelope.output.value.reasonCode, intent: parsed.intent,
      operations: ["spatiotemporal-metric.rank-locations"], analysisEvidence: [{ operationId: "spatiotemporal-metric.rank-locations", envelope }],
      findings: normalizeMetricRanking(envelope.output.value, parsed.intent.analysis) };
    const authority = { capabilityCatalog: { registryVersion: "test", contractCatalogRevision: analysisHash("test"), bindingRevision: analysisHash("test"), capabilities: [] } };
    const assembled = advancedEvidence(execution, undefined, authority, "grounding-test", { history, advancedHistory: config });
    expect(assembled.referenceProducts).toEqual([]);
    expect(assembled.evidenceItems).toHaveLength(2);
    for (const item of assembled.evidenceItems) {
      expect(item).toMatchObject({ productKind: "CAPABILITY_RESULT", sourceProvider: "gowm.analysis.metric-ranking", payloadSchemaUri: envelope.output.schemaUri,
        payloadSchemaHash: envelope.output.schemaHash, receiptIds: envelope.receipts.map(r => r.receiptId), evidenceIds: envelope.evidenceReferences.map(r => r.evidenceId) });
      expect(item.safePayload).toMatchObject({ computeSnapshot: envelope.computeSnapshot, dataSnapshot: envelope.dataSnapshot });
      expect(Buffer.byteLength(JSON.stringify(item.safePayload))).toBeLessThanOrEqual(config.maximumSafePayloadBytes);
    }
    expect(analysisHash(assembled)).toBe(analysisHash(advancedEvidence(execution, undefined, authority, "grounding-test", { history, advancedHistory: config })));
  });
});

describe("selection admission shared by compilation and execution", () => {
  const now = Date.parse("2026-09-06T02:00:01Z");
  function selection() {
    const result = JSON.parse(readFileSync(new URL("../../../contracts/wsgs-v0.2.4-world-analysis/examples/all-choices.json", import.meta.url), "utf8")) as GroundingResult12;
    const choice = result.worldAnalysisFindings!.choices.find(entry => entry.choiceKind === "REFERENCE_SELECTION")!;
    const candidate = choice.candidates[0]!;
    if (!("referenceProductId" in candidate)) throw new Error("expected reference selection");
    const product = result.referenceProducts.find(entry => entry.productId === candidate.referenceProductId)!;
    const authority: PriorAnalysisAuthority = { result, choice, candidate };
    const references: ReferenceGroundingResult = { mentions: [], ambiguities: [], unresolvedMentions: [], validationResults: [],
      worldVersion: 1, resolverVersion: "test", referenceProducts: [{ ...product,
        matchedBy: "PRIOR_SELECTION", matchScore: 1, sourceOperation: "VALIDATE_REFERENCES", revalidationRequired: false, safeSummary: {} }] };
    return { authority, references };
  }
  it("accepts a currently validated selected reference", () => {
    const { authority, references } = selection();
    expect(publicAnalysisSelectionFailure([authority], references, now)).toBeUndefined();
  });
  it.each(["expired", "malformed"])("rejects a %s Choice before compiling or executing", kind => {
    const { authority, references } = selection();
    authority.choice.validUntil = kind === "expired" ? new Date(now).toISOString() : "invalid";
    expect(publicAnalysisSelectionFailure([authority], references, now)).toBe("SELECTION_EXPIRED");
  });
  it.each(["missing", "changed-version", "expired", "missing-lease", "malformed-lease", "revalidation-required"])("rejects a %s selected reference", kind => {
    const { authority, references } = selection();
    const product = references.referenceProducts[0]!;
    if (kind === "missing") references.referenceProducts = [];
    if (kind === "changed-version") product.referenceKey = { ...product.referenceKey, version: "2" };
    if (kind === "expired") product.validUntil = new Date(now).toISOString();
    if (kind === "missing-lease") delete product.validUntil;
    if (kind === "malformed-lease") product.validUntil = "invalid";
    if (kind === "revalidation-required") product.revalidationRequired = true;
    expect(publicAnalysisSelectionFailure([authority], references, now)).toBe("REFERENCE_MISSING");
  });
  it("keeps non-reference candidates independent of reference selection", () => {
    const { authority, references } = selection();
    const choice = authority.result.worldAnalysisFindings!.choices.find(entry => entry.candidates.some(candidate => !("referenceProductId" in candidate)))!;
    const candidate = choice.candidates.find(entry => !("referenceProductId" in entry))!;
    references.referenceProducts = [];
    expect(publicAnalysisSelectionFailure([{ ...authority, choice, candidate }], references, now)).toBeUndefined();
  });
});
