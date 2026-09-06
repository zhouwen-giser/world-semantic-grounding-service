import {
  AnalysisProviderContracts, AnalysisContractError, analysisHash, type AnalysisOperationId,
  type MapMatchProviderResultV01, type SpatialEventTarget
} from "@wsgs/gowm-contract-intake";
import { TypedWorldQueryCompiler, type CompileInput, type CompileResult, type WorldQueryNode, type QuerySemanticPattern } from "@wsgs/query-compiler";
import { executeHistoricalTrace, type HistoricalGatewayOperationExecutor } from "./executor.js";
import { projectHistoricalReference } from "./normalizer.js";
import { boundAdvancedSafePayload, normalizeMetricRanking, normalizeRoadAssociation, normalizeTemporalEvent } from "./advanced-normalizer.js";
import type { MetricSemanticCatalog } from "./metric-semantic-catalog.js";
import type { HistoricalReferenceKey, HistoricalTraceConfiguration } from "./types.js";
import type { AdvancedHistoricalExecutionResult, AdvancedHistoricalFoundation, AdvancedHistoricalIntent, AdvancedHistoryConfiguration } from "./advanced-types.js";

type Json = Record<string, unknown>;
export type AdvancedCompileContext = Pick<CompileInput, "requestId" | "idempotencyKey" | "groundingId" | "capabilities" | "semanticProfiles" | "operationLocks" | "availability" | "parameterSchemaHash" | "grantedPermissions" | "budgets">;
export interface AdvancedGateway {
  execute(operationId: AnalysisOperationId, input: Json, execution: { operationVersion: "0.1"; idempotencyKey: string; deadlineAt: Date; budget: WorldQueryNode["budget"] }): Promise<unknown>;
}
export interface AdvancedExecutionInput {
  intent: AdvancedHistoricalIntent; configuration: AdvancedHistoryConfiguration; history: HistoricalTraceConfiguration;
  contracts: AnalysisProviderContracts; catalog: MetricSemanticCatalog; compileContext: AdvancedCompileContext;
  foundationGateway: HistoricalGatewayOperationExecutor; gateway: AdvancedGateway;
  deadlineAt: Date; now?: () => number;
  taskReferenceKeys?: readonly HistoricalReferenceKey[]; subjectReferenceKeys?: readonly HistoricalReferenceKey[];
  reusableFoundation?: AdvancedHistoricalFoundation;
  resolveTarget?: (mention: string) => Promise<SpatialEventTarget | { reasonCode: string }>;
  onCompiled?: (plan: Extract<CompileResult, { status: "COMPILED" }>) => void;
}

export function advancedAnalysisPattern(intent: AdvancedHistoricalIntent): QuerySemanticPattern {
  return intent.analysis.kind === "ROAD_ASSOCIATION" ? "HISTORICAL_ROAD_ASSOCIATION" :
    intent.analysis.kind === "METRIC_RANKING" ? "HISTORICAL_METRIC_RANKING" :
      intent.analysis.eventType === "CROSS" ? "HISTORICAL_CROSS_EVENT" : "HISTORICAL_TEMPORAL_EVENT";
}
function operationInput(intent: AdvancedHistoricalIntent, foundation: AdvancedHistoricalFoundation, config: AdvancedHistoryConfiguration, target?: SpatialEventTarget): Json {
  const reference = foundation.reference.referenceKey;
  if (intent.analysis.kind === "ROAD_ASSOCIATION" || intent.analysis.kind === "TEMPORAL_EVENT" && intent.analysis.eventType === "CROSS") {
    return { schemaVersion: "0.1", trajectoryReferenceKey: reference, profile: "CAMPUS_TASK_DEFAULT",
      output: { maximumPointPreview: 0, maximumRejectedSamplePreview: 0, maximumOffNetworkPathPreviewPoints: 2 } };
  }
  if (intent.analysis.kind === "TEMPORAL_EVENT") return {
    schemaVersion: "0.1", source: { kind: "HISTORICAL_TRAJECTORY", trajectoryReferenceKey: reference },
    eventTypes: [intent.analysis.eventType], selection: intent.analysis.selection, profile: "CAMPUS_TASK_DEFAULT",
    ...(target ? { targets: [target] } : {})
  };
  return { schemaVersion: "0.1", trajectoryReferenceKey: reference, profile: "CAMPUS_TASK_DEFAULT",
    metricSelector: intent.analysis.metricSelector, metricSeriesSelection: intent.analysis.metricSeriesSelection,
    aggregation: { mode: "H3", resolution: 12 }, ranking: { topK: intent.analysis.topK },
    output: { includeCellBoundary: false, maximumAlignedSamplePreview: 0, maximumUnalignedSamplePreview: 0,
      maximumRejectedMetricSamplePreview: 0, maximumSeriesCandidatePreview: config.maximumSeriesCandidates } };
}

function materializeNode(node: WorldQueryNode, parameters: Json, outputs: Map<string, unknown>): Json {
  let request: unknown = {};
  const read = (value: unknown, path?: string): unknown => {
    if (!path) return value;
    return path.split("/").slice(1).reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") throw new Error("ADVANCED_HISTORY_PLAN_BINDING_INVALID");
      return (current as Json)[key];
    }, value);
  };
  for (const binding of Object.values(node.inputs)) {
    const value = binding.kind === "LITERAL" ? binding.value : binding.kind === "REQUEST_PATH" ? read(parameters, binding.path) : read(outputs.get(binding.nodeId), binding.path);
    if (value === undefined) throw new Error("ADVANCED_HISTORY_PLAN_BINDING_INVALID");
    if (!binding.targetPath) { request = structuredClone(value); continue; }
    const path = binding.targetPath.split("/").slice(1);
    let target = request as Json;
    for (const part of path.slice(0, -1)) {
      if (["__proto__", "constructor", "prototype"].includes(part)) throw new Error("ADVANCED_HISTORY_PLAN_BINDING_INVALID");
      target[part] ??= {}; target = target[part] as Json;
    }
    const key = path.at(-1)!;
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("ADVANCED_HISTORY_PLAN_BINDING_INVALID");
    target[key] = structuredClone(value);
  }
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("ADVANCED_HISTORY_PLAN_BINDING_INVALID");
  return request as Json;
}

export function canReuseAdvancedFoundation(prior: AdvancedHistoricalFoundation, intent: AdvancedHistoricalIntent, now: number): boolean {
  const scope = intent.historicalScope;
  const old = prior.intent;
  const projection = prior.reference;
  return ["COMPLETED", "PARTIAL"].includes(prior.finding.status) && prior.finding.trajectory?.finalization.state !== "CONFLICTED" &&
    !!old.taskReferenceKey && !!old.subjectReferenceKey &&
    projection.referenceType === "HISTORICAL_TRAJECTORY" && /^[1-9][0-9]*$/.test(projection.referenceKey.version) &&
    (projection.validUntil === undefined ? !projection.revalidationRequired : Number.isFinite(Date.parse(projection.validUntil)) && Date.parse(projection.validUntil) > now) &&
    scope.phaseScope === old.phaseScope && analysisHash(scope.executionSelection) === analysisHash(old.executionSelection) &&
    analysisHash(scope.sourceSelection) === analysisHash(old.sourceSelection) &&
    (!scope.taskReferenceKey || analysisHash(scope.taskReferenceKey) === analysisHash(old.taskReferenceKey)) &&
    (!scope.subjectReferenceKey || analysisHash(scope.subjectReferenceKey) === analysisHash(old.subjectReferenceKey)) &&
    (!scope.subjectMention || scope.subjectMention === old.subjectMention) && (!scope.taskMention || scope.taskMention === old.taskMention);
}

export async function executeAdvancedHistoricalAnalysis(input: AdvancedExecutionInput): Promise<AdvancedHistoricalExecutionResult> {
  const result: AdvancedHistoricalExecutionResult = { status: "CAPABILITY_GAP", reasonCode: "HISTORICAL_FOUNDATION_REQUIRED", intent: input.intent, analysisEvidence: [], findings: [], operations: [] };
  const stop = (code: string, status: AdvancedHistoricalExecutionResult["status"] = "CAPABILITY_GAP") => ({ ...result, status, reasonCode: code });
  if (!input.configuration.enabled) return stop("ADVANCED_HISTORY_DISABLED");
  if (!input.history.enabled) return stop("ADVANCED_HISTORY_REQUIRES_HISTORY");
  if (input.intent.historicalScope.executionSelection.kind === "ALL") return stop("MULTI_EXECUTION_ADVANCED_ANALYSIS_NOT_SUPPORTED", "UNRESOLVED");
  const now = input.now ?? Date.now;
  const checkDeadline = () => { if (now() >= input.deadlineAt.getTime()) throw new Error("ADVANCED_HISTORY_DEADLINE_EXCEEDED"); };
  try {
    checkDeadline();
    if (input.reusableFoundation && canReuseAdvancedFoundation(input.reusableFoundation, input.intent, now())) result.foundation = structuredClone(input.reusableFoundation);
    if (!result.foundation) {
      const executed = await executeHistoricalTrace({
        intent: { ...input.intent.historicalScope, queryKind: "HISTORICAL_TRAJECTORY", maximumInlinePoints: 0 },
        configuration: { ...input.history, pendingRetryMs: 0 },
        gateway: { execute: async (id, value) => { checkDeadline(); result.operations.push(id); return input.foundationGateway.execute(id, value); } },
        ...(input.taskReferenceKeys ? { taskReferenceKeys: input.taskReferenceKeys } : {}),
        ...(input.subjectReferenceKeys ? { subjectReferenceKeys: input.subjectReferenceKeys } : {})
      });
      const finding = executed.finding;
      if (executed.status === "PENDING" || finding?.status === "PENDING") return stop("HISTORICAL_PROJECTION_PENDING", "PENDING");
      if (finding?.trajectory?.finalization.state === "CONFLICTED" || finding?.executionInterval?.lifecycleState === "CONFLICTED") return stop("HISTORICAL_TRAJECTORY_CONFLICTED", "PARTIAL");
      if (finding?.status === "NO_DATA") return stop("HISTORICAL_TRAJECTORY_NO_DATA", "PARTIAL");
      if (!finding || !["COMPLETED", "PARTIAL"].includes(finding.status)) return stop(executed.reasonCode);
      if (!executed.context?.taskReferenceKey || !executed.context.subjectReferenceKey) return stop("SUBJECT_CONTEXT_REQUIRED", "UNRESOLVED");
      const projection = projectHistoricalReference(finding, input.history.provisionalReferenceTtlMs, new Date(now()));
      if (!projection || projection.referenceType !== "HISTORICAL_TRAJECTORY") return stop("HISTORICAL_TRAJECTORY_REFERENCE_MISSING");
      result.foundation = { intent: { ...input.intent.historicalScope, taskReferenceKey: executed.context.taskReferenceKey,
        subjectReferenceKey: executed.context.subjectReferenceKey }, finding, reference: projection };
    }
    const analysis = input.intent.analysis;
    if (analysis.kind === "TEMPORAL_EVENT" && !["CROSS", "STOP"].includes(analysis.eventType)) {
      if (!analysis.targetMention || !input.resolveTarget) return stop("TARGET_CONTEXT_REQUIRED", "UNRESOLVED");
      checkDeadline();
      const target = await input.resolveTarget(analysis.targetMention);
      if ("reasonCode" in target) return stop(target.reasonCode, target.reasonCode === "TARGET_CONTEXT_AMBIGUOUS" ? "AMBIGUOUS" : "UNRESOLVED");
      if (!target.referenceKey || target.crs !== "EPSG:4326" || (["ENTER", "EXIT", "DWELL"].includes(analysis.eventType) && target.targetType !== "AREA")) return stop("TARGET_GEOMETRY_UNSUPPORTED", "UNRESOLVED");
      result.target = target;
    }
    checkDeadline();
    const operation = operationInput(input.intent, result.foundation, input.configuration, result.target);
    const cross = analysis.kind === "TEMPORAL_EVENT" && analysis.eventType === "CROSS";
    const nodes = cross ? 2 : 1;
    const compiled = new TypedWorldQueryCompiler().compile({
      ...input.compileContext, pattern: advancedAnalysisPattern(input.intent), requiredForProduct: "WORLD_EVIDENCE", operationInput: operation,
      ...(cross ? { parameterValues: { selection: analysis.selection } } : {}),
      advancedHistoryEnabled: true, analysisProviderAuthorizations: input.contracts.authorizations,
      maturityPolicy: { allowPreview: false }, degradedPolicy: "REJECT", snapshotPolicy: { mode: "LATEST_AT_START", allowDowngrade: false },
      observedAt: new Date(now()).toISOString(),
      budgets: { ...input.compileContext.budgets, maximumNodes: Math.min(nodes, input.compileContext.budgets.maximumNodes),
        maximumDepth: Math.min(nodes, input.compileContext.budgets.maximumDepth),
        maximumExecutionMs: Math.min(input.compileContext.budgets.maximumExecutionMs, input.deadlineAt.getTime() - now()) }
    });
    if (compiled.status !== "COMPILED") {
      const reasons: Record<string, string> = { NOT_REGISTERED: "ANALYSIS_CAPABILITY_NOT_REGISTERED", OPERATION_UNAVAILABLE: "ANALYSIS_CAPABILITY_UNAVAILABLE",
        OPERATION_DEGRADED: "ANALYSIS_CAPABILITY_DEGRADED", AVAILABILITY_STALE: "ANALYSIS_CAPABILITY_UNAVAILABLE",
        SCHEMA_MISMATCH: "ANALYSIS_PROVIDER_CONTRACT_DRIFT", SEMANTIC_MISMATCH: "ANALYSIS_SEMANTIC_PROFILE_MISMATCH" };
      return stop(String(compiled.gap.details["reasonCode"] ?? reasons[compiled.gap.reason] ?? `ANALYSIS_${compiled.gap.reason}`));
    }
    input.onCompiled?.(compiled); result.planHash = compiled.planHash;
    let mapResult: MapMatchProviderResultV01 | undefined;
    const outputs = new Map<string, unknown>();
    for (const node of compiled.submission.plan.nodes) {
      checkDeadline();
      const id = node.operation.operationId as AnalysisOperationId;
      if (cross && id === "temporal-spatial.find-events" && (!mapResult || !["COMPLETED", "PARTIAL"].includes(mapResult.status))) return stop("MAP_MATCH_PRECONDITION_NOT_SATISFIED", "PARTIAL");
      const request = materializeNode(node, compiled.submission.parameters, outputs);
      input.contracts.validateInput(id, request);
      const key = analysisHash({ requestId: input.compileContext.requestId, scope: input.intent.historicalScope,
        trajectory: result.foundation.reference.referenceKey, target: result.target?.referenceKey, metricCatalogHash: input.catalog.hash,
        intent: input.intent.analysis, node: node.operation, planHash: compiled.planHash, input: request });
      result.operations.push(id);
      const envelope = input.contracts.validateEnvelope(id, await input.gateway.execute(id, request, {
        operationVersion: "0.1", idempotencyKey: key, deadlineAt: input.deadlineAt, budget: node.budget
      }), request);
      const payload = envelope.output.value;
      outputs.set(node.nodeId, payload);
      const trajectory = id === "temporal-spatial.find-events" ?
        (payload as AnalysisProviderResultTypesForEvents).source.trajectoryReferenceKey : (payload as MapMatchProviderResultV01).trajectoryReferenceKey;
      if (analysisHash(trajectory) !== analysisHash(result.foundation.reference.referenceKey)) throw new AnalysisContractError("ADVANCED_HISTORY_RESULT_INVALID");
      result.analysisEvidence.push({ operationId: id, envelope });
      if (id === "trajectory.map-match") {
        mapResult = input.contracts.validateResult(id, payload);
        result.findings.push(normalizeRoadAssociation(mapResult));
      } else if (id === "temporal-spatial.find-events") {
        const events = input.contracts.validateResult(id, payload);
        if (analysis.kind !== "TEMPORAL_EVENT" || analysisHash(events.requestedEventTypes) !== analysisHash([analysis.eventType]) ||
            analysis.selection.kind !== "ALL" && events.selectionResult?.kind !== analysis.selection.kind) throw new AnalysisContractError("ADVANCED_HISTORY_RESULT_INVALID");
        if (cross && (events.source.kind !== "MAP_MATCH_RESULT" || events.source.mapMatchResultHash !== analysisHash(mapResult))) throw new AnalysisContractError("ADVANCED_HISTORY_RESULT_INVALID");
        result.findings.push(normalizeTemporalEvent(events));
      } else if (analysis.kind === "METRIC_RANKING") {
        const ranking = input.contracts.validateResult(id, payload);
        if (ranking.metric.observedProperty !== analysis.metricSelector.observedProperty ||
            ranking.metric.optimizationDirection !== analysis.metricSelector.optimizationDirection ||
            analysis.metricSelector.measurementStage && ranking.metric.measurementStage !== analysis.metricSelector.measurementStage ||
            analysis.metricSelector.valueUnit && ranking.metric.valueUnit !== analysis.metricSelector.valueUnit) throw new AnalysisContractError("ADVANCED_HISTORY_RESULT_INVALID");
        if (analysis.metricSeriesSelection.mode === "EXPLICIT_SERIES" && ranking.selectedMetricSeries) {
          for (const key of ["sourceKey", "datastreamKey", "measurementKey"] as const) {
            if (analysis.metricSeriesSelection[key] && analysis.metricSeriesSelection[key] !== ranking.selectedMetricSeries[key]) {
              throw new AnalysisContractError("ADVANCED_HISTORY_RESULT_INVALID");
            }
          }
        }
        result.findings.push(...normalizeMetricRanking(ranking, analysis));
      }
    }
    const last = result.analysisEvidence.at(-1)!;
    result.reasonCode = last.envelope.output.value.reasonCode;
    result.status = result.reasonCode === "METRIC_SERIES_AMBIGUOUS" ? "AMBIGUOUS" :
      last.envelope.status === "COMPLETED" && result.foundation.finding.status === "COMPLETED" ? "COMPLETED" : "PARTIAL";
    if (analysis.kind === "ROAD_ASSOCIATION" && analysis.output === "LAST_CONFIRMED_ROAD" &&
        mapResult && !mapResult.associationCompleteness.associationSuffixComplete) {
      result.status = "PARTIAL";
      result.reasonCode = "ASSOCIATION_SUFFIX_INCOMPLETE";
    }
    result.findings = result.findings.map(finding => boundAdvancedSafePayload({ ...finding,
      metricCatalog: { catalogId: input.catalog.document.catalogId, catalogVersion: input.catalog.document.catalogVersion, hash: input.catalog.hash }
    }, input.configuration));
    if (result.findings.some(finding => finding["truncated"] === true)) result.status = "PARTIAL";
    return result;
  } catch (error) {
    const transportCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (transportCode === "ABORTED") throw error;
    const code = error instanceof AnalysisContractError ? error.code : transportCode === "DEADLINE_EXCEEDED" ||
      error instanceof Error && error.message === "ADVANCED_HISTORY_DEADLINE_EXCEEDED" ? "ADVANCED_HISTORY_DEADLINE_EXCEEDED" : "ADVANCED_HISTORY_RESULT_INVALID";
    return stop(code, code === "ADVANCED_HISTORY_DEADLINE_EXCEEDED" ? "PARTIAL" : "FAILED");
  }
}
type AnalysisProviderResultTypesForEvents = import("@wsgs/gowm-contract-intake").TemporalSpatialEventResultV01;
