import { sameReferenceIdentity } from "./context.js";
import { advancedAnalysisRequests, MAXIMUM_ADVANCED_ANALYSES, type AdvancedAnalysisFailure, type AdvancedAvailabilityObservation } from "./advanced-types.js";
import {
  AnalysisProviderContracts, AnalysisContractError, analysisHash, type AnalysisOperationId,
  type MapMatchProviderResultV01, type SpatialEventTarget
} from "@wsgs/gowm-contract-intake";
import { TypedWorldQueryCompiler, type CompileInput, type CompileResult, type WorldQueryNode, type QuerySemanticPattern } from "@wsgs/query-compiler";
import { executeHistoricalTrace, type HistoricalExecutionResult, type HistoricalGatewayOperationExecutor } from "./executor.js";
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
  admitFoundationSubject?: (execution: HistoricalExecutionResult) => Promise<
    { status: "ADMITTED"; subjectReferenceKey: HistoricalReferenceKey } | { status: "REJECTED"; reasonCode: string }>;
  resolveTarget?: (mention: string, referenceKey?: HistoricalReferenceKey) => Promise<SpatialEventTarget | { reasonCode: string }>;
  observeAvailability?: (operationIds: readonly string[]) => Promise<AdvancedAvailabilityObservation>;
  onCompiled?: (plan: Extract<CompileResult, { status: "COMPILED" }>) => void;
  onFailure?: (diagnostic: { phase: "FOUNDATION" | "ANALYSIS"; code: string; classification: string; lastOperation?: string; attemptedOperations: number; analysisEvidenceCount: number }) => void;
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
    !scope.unsupportedReason && !!prior.finding.trajectory?.trajectoryReferenceKey &&
    analysisHash(prior.finding.trajectory.trajectoryReferenceKey) === analysisHash(projection.referenceKey) &&
    !!old.taskReferenceKey && !!old.subjectReferenceKey &&
    projection.referenceType === "HISTORICAL_TRAJECTORY" && /^[1-9][0-9]*$/.test(projection.referenceKey.version) &&
    (projection.validUntil === undefined ? !projection.revalidationRequired : Number.isFinite(Date.parse(projection.validUntil)) && Date.parse(projection.validUntil) > now) &&
    scope.phaseScope === old.phaseScope && analysisHash(scope.executionSelection) === analysisHash(old.executionSelection) &&
    analysisHash(scope.sourceSelection) === analysisHash(old.sourceSelection) &&
    (!scope.taskReferenceKey || analysisHash(scope.taskReferenceKey) === analysisHash(old.taskReferenceKey)) &&
    (!scope.subjectReferenceKey || sameReferenceIdentity(scope.subjectReferenceKey, old.subjectReferenceKey)) &&
    (!scope.subjectMention || scope.subjectMention === old.subjectMention) && (!scope.taskMention || scope.taskMention === old.taskMention);
}

/** Compiles an already trusted foundation without resolving or executing anything. */
export function compileAdvancedHistoricalAnalysis(input: Pick<AdvancedExecutionInput,
  "intent" | "configuration" | "history" | "contracts" | "compileContext" | "deadlineAt" | "now"> & {
    foundation?: AdvancedHistoricalFoundation; target?: SpatialEventTarget;
  }): Extract<CompileResult, { status: "COMPILED" }> | { status: "CAPABILITY_GAP"; reasonCode: string } {
  const gap = (reasonCode: string) => ({ status: "CAPABILITY_GAP" as const, reasonCode });
  if (input.intent.additionalAnalyses?.length) return gap("MULTI_ANALYSIS_REQUIRES_BATCH_COMPILATION");
  if (!input.configuration.enabled) return gap("ADVANCED_HISTORY_DISABLED");
  if (!input.history.enabled) return gap("ADVANCED_HISTORY_REQUIRES_HISTORY");
  if (input.intent.historicalScope.unsupportedReason) return gap(input.intent.historicalScope.unsupportedReason);
  if (input.intent.historicalScope.executionSelection.kind === "ALL") return gap("MULTI_EXECUTION_ADVANCED_ANALYSIS_NOT_SUPPORTED");
  const now = (input.now ?? Date.now)();
  if (now >= input.deadlineAt.getTime()) return gap("ADVANCED_HISTORY_DEADLINE_EXCEEDED");
  if (!input.foundation || !canReuseAdvancedFoundation(input.foundation, input.intent, now)) return gap("HISTORICAL_TRAJECTORY_REFERENCE_MISSING");
  const analysis = input.intent.analysis;
  if (analysis.kind === "TEMPORAL_EVENT" && !["CROSS", "STOP"].includes(analysis.eventType)) {
    if (!input.target) return gap("TARGET_CONTEXT_REQUIRED");
    const target = input.contracts.validateTarget(input.target);
    if (!target.referenceKey || target.crs !== "EPSG:4326" ||
        (["ENTER", "EXIT", "DWELL"].includes(analysis.eventType) && target.targetType !== "AREA") ||
        (analysis.targetReferenceKey && analysisHash(analysis.targetReferenceKey) !== analysisHash(target.referenceKey))) return gap("TARGET_GEOMETRY_UNSUPPORTED");
  }
  const cross = analysis.kind === "TEMPORAL_EVENT" && analysis.eventType === "CROSS";
  const nodes = cross ? 2 : 1;
  const compiled = new TypedWorldQueryCompiler().compile({
    ...input.compileContext, pattern: advancedAnalysisPattern(input.intent), requiredForProduct: "WORLD_EVIDENCE",
    operationInput: operationInput(input.intent, input.foundation, input.configuration, input.target),
    ...(cross ? { parameterValues: { selection: analysis.selection } } : {}),
    advancedHistoryEnabled: true, analysisProviderAuthorizations: input.contracts.authorizations,
    maturityPolicy: { allowPreview: false }, degradedPolicy: "REJECT", snapshotPolicy: { mode: "LATEST_AT_START", allowDowngrade: false },
    observedAt: new Date(now).toISOString(),
    budgets: { ...input.compileContext.budgets, maximumNodes: Math.min(nodes, input.compileContext.budgets.maximumNodes),
      maximumDepth: Math.min(nodes, input.compileContext.budgets.maximumDepth),
      maximumExecutionMs: Math.min(input.compileContext.budgets.maximumExecutionMs, input.deadlineAt.getTime() - now) }
  });
  if (compiled.status === "COMPILED") return compiled;
  const reasons: Record<string, string> = { NOT_REGISTERED: "ANALYSIS_CAPABILITY_NOT_REGISTERED", OPERATION_UNAVAILABLE: "ANALYSIS_CAPABILITY_UNAVAILABLE",
    OPERATION_DEGRADED: "ANALYSIS_CAPABILITY_DEGRADED", AVAILABILITY_STALE: "ANALYSIS_CAPABILITY_UNAVAILABLE",
    SCHEMA_MISMATCH: "ANALYSIS_PROVIDER_CONTRACT_DRIFT", SEMANTIC_MISMATCH: "ANALYSIS_SEMANTIC_PROFILE_MISMATCH" };
  return gap(String(compiled.gap.details["reasonCode"] ?? reasons[compiled.gap.reason] ?? `ANALYSIS_${compiled.gap.reason}`));
}

type AdvancedCompilationInput = Parameters<typeof compileAdvancedHistoricalAnalysis>[0];
type CompiledAnalysis = Extract<CompileResult, { status: "COMPILED" }>;

/** Allocate one request budget across all recipes, including both CROSS nodes. */
function batchInputs(input: AdvancedCompilationInput): AdvancedCompilationInput[] | string {
  const requests = advancedAnalysisRequests(input.intent);
  if (requests.length > MAXIMUM_ADVANCED_ANALYSES) return "ADVANCED_ANALYSIS_LIMIT_EXCEEDED";
  const weights = requests.map(request => request.analysis.kind === "TEMPORAL_EVENT" && request.analysis.eventType === "CROSS" ? 2 : 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const budget = input.compileContext.budgets;
  if (budget.maximumNodes < total || [budget.maximumRows, budget.maximumCandidates, budget.maximumOutputBytes, budget.maximumExecutionMs].some(value => value < total)) {
    return "ADVANCED_ANALYSIS_BUDGET_EXCEEDED";
  }
  let preceding = 0;
  return requests.map((intent, index) => {
    const weight = weights[index]!;
    const share = (value: number) => Math.floor(value * (preceding + weight) / total) - Math.floor(value * preceding / total);
    const budgets = { ...budget, maximumNodes: weight, maximumRows: share(budget.maximumRows), maximumCandidates: share(budget.maximumCandidates),
      maximumOutputBytes: share(budget.maximumOutputBytes), maximumExecutionMs: share(budget.maximumExecutionMs) };
    preceding += weight;
    const identity = { requestId: input.compileContext.requestId, key: input.compileContext.idempotencyKey, analysis: intent.analysis, index };
    return { ...input, intent, compileContext: { ...input.compileContext, budgets,
      ...(requests.length > 1 ? { requestId: `wsgs-analysis-${analysisHash(identity).slice(7, 39)}`, idempotencyKey: analysisHash(identity) } : {}) } };
  });
}

export function compileAdvancedHistoricalAnalyses(input: AdvancedCompilationInput & {
  targets?: readonly { analysis: AdvancedHistoricalIntent["analysis"]; target: SpatialEventTarget }[];
}): { plans: CompiledAnalysis[]; failures: AdvancedAnalysisFailure[] } {
  const children = batchInputs(input);
  if (typeof children === "string") return { plans: [], failures: [{ intent: input.intent, reasonCode: children, analysisIndex: 1 }] };
  const plans: CompiledAnalysis[] = [];
  const failures: AdvancedAnalysisFailure[] = [];
  for (const [index, child] of children.entries()) {
    const target = input.targets?.find(value => analysisHash(value.analysis) === analysisHash(child.intent.analysis))?.target ??
      (children.length === 1 ? input.target : undefined);
    const { target: _unused, ...withoutTarget } = child;
    const compiled = compileAdvancedHistoricalAnalysis({ ...withoutTarget, ...(target ? { target } : {}) });
    if (compiled.status === "COMPILED") plans.push(compiled);
    else failures.push({ intent: child.intent, reasonCode: compiled.reasonCode, analysisIndex: index + 1 });
  }
  return { plans, failures };
}

export async function executeAdvancedHistoricalAnalysis(input: AdvancedExecutionInput): Promise<AdvancedHistoricalExecutionResult> {
  if (!input.intent.additionalAnalyses?.length) return executeSingleAdvancedHistoricalAnalysis(input);
  const result: AdvancedHistoricalExecutionResult = { status: "CAPABILITY_GAP", reasonCode: "HISTORICAL_FOUNDATION_REQUIRED", intent: input.intent,
    analysisEvidence: [], findings: [], operations: [], analysisResults: [] };
  const children = batchInputs(input);
  if (typeof children === "string") { delete result.analysisResults; return { ...result, reasonCode: children }; }
  const now = input.now ?? Date.now;
  let foundation = input.reusableFoundation && canReuseAdvancedFoundation(input.reusableFoundation, children[0]!.intent, now()) ? input.reusableFoundation : undefined;
  let foundationFailure: AdvancedHistoricalExecutionResult | undefined;
  // Same request, authority, reference versions and exact operation input only.
  // This also keeps a single source receipt when ROAD and CROSS share T2.
  const verifiedOutputs = new Map<string, unknown>();
  for (const child of children) {
    const reusedOperationIds: string[] = [];
    const blocked = foundationFailure ?? (foundation && !canReuseAdvancedFoundation(foundation, child.intent, now())
      ? { status: "CAPABILITY_GAP" as const, reasonCode: "HISTORICAL_TRAJECTORY_REFERENCE_MISSING" } : undefined);
    const executed: AdvancedHistoricalExecutionResult = blocked ? { status: blocked.status, reasonCode: blocked.reasonCode, intent: child.intent,
      analysisEvidence: [], findings: [], operations: [] } satisfies AdvancedHistoricalExecutionResult :
      await executeSingleAdvancedHistoricalAnalysis({ ...input, ...child, ...(foundation ? { reusableFoundation: foundation } : {}),
        gateway: { execute: async (id, request, execution) => {
          const key = analysisHash({ id, request });
          if (verifiedOutputs.has(key)) { reusedOperationIds.push(id); return structuredClone(verifiedOutputs.get(key)); }
          const response = await input.gateway.execute(id, request, execution);
          const verified = input.contracts.validateEnvelope(id, response, request);
          verifiedOutputs.set(key, verified);
          return structuredClone(verified);
        } },
        deadlineAt: new Date(Math.min(input.deadlineAt.getTime(), now() + child.compileContext.budgets.maximumExecutionMs)) });
    if (reusedOperationIds.length) executed.reusedOperationIds = reusedOperationIds;
    result.analysisResults!.push(executed);
    if (executed.foundation) foundation = executed.foundation;
    else foundationFailure = executed;
    result.analysisEvidence.push(...executed.analysisEvidence);
    result.findings.push(...executed.findings);
    result.operations.push(...executed.operations);
    (result.executionAvailabilityObservations ??= []).push(...(executed.executionAvailabilityObservations ?? []));
  }
  if (foundation && !foundationFailure) result.foundation = foundation;
  const outcomes = result.analysisResults!;
  result.status = outcomes.every(value => value.status === "COMPLETED") ? "COMPLETED" :
    outcomes.some(value => value.foundation || value.analysisEvidence.length) ? "PARTIAL" :
    outcomes.every(value => value.status === "PENDING") ? "PENDING" : outcomes[0]!.status;
  result.reasonCode = result.status === "COMPLETED" ? "MULTI_ANALYSIS_COMPLETED" : "MULTI_ANALYSIS_PARTIAL";
  return result;
}

async function executeSingleAdvancedHistoricalAnalysis(input: AdvancedExecutionInput): Promise<AdvancedHistoricalExecutionResult> {
  const result: AdvancedHistoricalExecutionResult = { status: "CAPABILITY_GAP", reasonCode: "HISTORICAL_FOUNDATION_REQUIRED", intent: input.intent, analysisEvidence: [], findings: [], operations: [] };
  const stop = (code: string, status: AdvancedHistoricalExecutionResult["status"] = "CAPABILITY_GAP") => ({ ...result, status, reasonCode: code });
  if (!input.configuration.enabled) return stop("ADVANCED_HISTORY_DISABLED");
  if (!input.history.enabled) return stop("ADVANCED_HISTORY_REQUIRES_HISTORY");
  if (input.intent.historicalScope.unsupportedReason) return stop(input.intent.historicalScope.unsupportedReason);
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
        gateway: {
          execute: async (id, value) => { checkDeadline(); result.operations.push(id); return input.foundationGateway.execute(id, value); },
          executeQuery: async request => {
            checkDeadline(); result.operations.push("operational-task.get-execution-intervals");
            const queried = await input.foundationGateway.executeQuery(request);
            if (queried.trajectory !== undefined) result.operations.push("history.get-trajectory");
            return queried;
          }
        },
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
      checkDeadline();
      const admission = await input.admitFoundationSubject?.(executed);
      if (admission?.status === "REJECTED") return stop(admission.reasonCode, "UNRESOLVED");
      result.foundation = { intent: { ...input.intent.historicalScope, taskReferenceKey: executed.context.taskReferenceKey,
        subjectReferenceKey: admission?.subjectReferenceKey ?? executed.context.subjectReferenceKey }, finding, reference: projection };
    }
    const analysis = input.intent.analysis;
    if (analysis.kind === "TEMPORAL_EVENT" && !["CROSS", "STOP"].includes(analysis.eventType)) {
      if (!analysis.targetMention || !input.resolveTarget) return stop("TARGET_CONTEXT_REQUIRED", "UNRESOLVED");
      checkDeadline();
      const target = await input.resolveTarget(analysis.targetMention, analysis.targetReferenceKey);
      if ("reasonCode" in target) return stop(target.reasonCode, target.reasonCode === "TARGET_CONTEXT_AMBIGUOUS" ? "AMBIGUOUS" : "UNRESOLVED");
      if (!target.referenceKey || target.crs !== "EPSG:4326" || (["ENTER", "EXIT", "DWELL"].includes(analysis.eventType) && target.targetType !== "AREA")) return stop("TARGET_GEOMETRY_UNSUPPORTED", "UNRESOLVED");
      result.target = target;
    }
    checkDeadline();
    const cross = analysis.kind === "TEMPORAL_EVENT" && analysis.eventType === "CROSS";
    const requiredOperations = cross ? ["trajectory.map-match", "temporal-spatial.find-events"]
      : [analysis.kind === "ROAD_ASSOCIATION" ? "trajectory.map-match"
        : analysis.kind === "METRIC_RANKING" ? "spatiotemporal-metric.rank-locations" : "temporal-spatial.find-events"];
    let executionAvailability = input.compileContext.availability;
    const observe = async (ids: readonly string[]) => {
      const observation = await input.observeAvailability!(ids);
      (result.executionAvailabilityObservations ??= []).push(observation);
      executionAvailability = [...executionAvailability.filter(entry => !ids.includes(entry.operationId)), ...observation.operations];
    };
    if (input.observeAvailability) await observe(requiredOperations);
    const compiled = compileAdvancedHistoricalAnalysis({ ...input, foundation: result.foundation,
      compileContext: { ...input.compileContext, availability: executionAvailability }, now,
      ...(result.target ? { target: result.target } : {}) });
    if (compiled.status !== "COMPILED") return stop(compiled.reasonCode);
    input.onCompiled?.(compiled); result.planHash = compiled.planHash; result.queryId = compiled.submission.plan.queryId;
    let mapResult: MapMatchProviderResultV01 | undefined;
    const outputs = new Map<string, unknown>();
    for (const node of compiled.submission.plan.nodes) {
      checkDeadline();
      const id = node.operation.operationId as AnalysisOperationId;
      let availability = executionAvailability.find(entry => entry.operationId === id && entry.operationVersion === node.operation.operationVersion);
      if ((!availability || Date.parse(availability.validUntil) <= now()) && input.observeAvailability) {
        await observe([id]);
        availability = executionAvailability.find(entry => entry.operationId === id && entry.operationVersion === node.operation.operationVersion);
      }
      if (!availability || !Number.isFinite(Date.parse(availability.validUntil)) || Date.parse(availability.validUntil) <= now()) return stop("ANALYSIS_AVAILABILITY_STALE");
      if (availability.availability !== "AVAILABLE") return stop("ANALYSIS_CAPABILITY_UNAVAILABLE");
      if (cross && id === "temporal-spatial.find-events" && (!mapResult || !["COMPLETED", "PARTIAL"].includes(mapResult.status))) return stop("MAP_MATCH_PRECONDITION_NOT_SATISFIED", "PARTIAL");
      const request = materializeNode(node, compiled.submission.parameters, outputs);
      input.contracts.validateInput(id, request);
      const key = analysisHash({ requestId: input.compileContext.requestId, scope: input.intent.historicalScope,
        trajectory: result.foundation.reference.referenceKey, target: result.target?.referenceKey, metricCatalogHash: input.catalog.hash,
        intent: input.intent.analysis, node: node.operation, planHash: compiled.planHash, input: request });
      result.operations.push(id);
      const response = await input.gateway.execute(id, request, {
        operationVersion: "0.1", idempotencyKey: key,
        deadlineAt: new Date(Math.min(input.deadlineAt.getTime(), now() + node.budget.maximumExecutionMs)), budget: node.budget
      });
      checkDeadline();
      const envelope = input.contracts.validateEnvelope(id, response, request);
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
            events.events.some(event => event.eventType !== analysis.eventType) ||
            analysis.selection.kind !== "ALL" && events.selectionResult?.kind !== analysis.selection.kind) throw new AnalysisContractError("ADVANCED_HISTORY_RESULT_INVALID");
        if (result.target && events.events.some(event => event.target?.kind !== "SPATIAL_TARGET" || event.target.targetId !== result.target!.targetId ||
            event.target.targetType !== result.target!.targetType || !event.target.referenceKey ||
            analysisHash(event.target.referenceKey) !== analysisHash(result.target!.referenceKey))) throw new AnalysisContractError("ADVANCED_HISTORY_RESULT_INVALID");
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
    if (transportCode === "ABORTED" || error && typeof error === "object" &&
        (("retryable" in error && error.retryable === true && !result.foundation) ||
         ("name" in error && error.name === "PipelineFenceRejectedError") ||
         typeof transportCode === "string" && /^(08[A-Z0-9]{3}|40001|40P01|57P0[123]|53300)$/.test(transportCode))) throw error;
    const code = error instanceof AnalysisContractError ? error.code : transportCode === "HISTORICAL_AVAILABILITY_EXPIRED" ? "ANALYSIS_AVAILABILITY_STALE" : transportCode === "DEADLINE_EXCEEDED" ||
      error instanceof Error && error.message === "ADVANCED_HISTORY_DEADLINE_EXCEEDED" ? "ADVANCED_HISTORY_DEADLINE_EXCEEDED" :
      typeof transportCode === "string" && (["TRANSPORT_FAILURE", "GATEWAY_CIRCUIT_OPEN", "HISTORICAL_UPSTREAM_UNAVAILABLE"].includes(transportCode) || /^HTTP_[45]\d\d(?:_|$)/u.test(transportCode)) ?
        "ADVANCED_HISTORY_UPSTREAM_FAILURE" : "ADVANCED_HISTORY_RESULT_INVALID";
    // Record only bounded protocol categories, never exception messages or payloads.
    const httpStatus = typeof transportCode === "string" ? /^HTTP_([45]\d\d)(?:_|$)/u.exec(transportCode)?.[1] : undefined;
    const diagnosticCode = typeof transportCode === "string" && ["TRANSPORT_FAILURE", "GATEWAY_CIRCUIT_OPEN", "DEADLINE_EXCEEDED", "RESPONSE_SCHEMA_MISMATCH", "REQUEST_SCHEMA_MISMATCH", "INVALID_JSON_RESPONSE", "GATEWAY_OUTPUT_MISSING", "GATEWAY_OUTPUT_SCHEMA_MISMATCH"].includes(transportCode)
      ? transportCode : typeof transportCode === "string" && /^HISTORICAL_[A-Z0-9_]{1,100}$/.test(transportCode) ? transportCode : httpStatus ? `HTTP_${httpStatus}` : "UNCLASSIFIED_EXECUTION_ERROR";
    input.onFailure?.({ phase: result.foundation ? "ANALYSIS" : "FOUNDATION", code: diagnosticCode, classification: code,
      ...(result.operations.at(-1) ? { lastOperation: result.operations.at(-1)! } : {}),
      attemptedOperations: result.operations.length, analysisEvidenceCount: result.analysisEvidence.length });
    return stop(code, code === "ADVANCED_HISTORY_DEADLINE_EXCEEDED" ? "PARTIAL" : "FAILED");
  }
}
type AnalysisProviderResultTypesForEvents = import("@wsgs/gowm-contract-intake").TemporalSpatialEventResultV01;
