import type { GroundingCapabilities12 } from "@wsgs/contracts";
import { analysisHash } from "@wsgs/gowm-contract-intake";
import type { CapabilityCatalog, CapabilitySemanticCatalog, OperationAvailabilityList, OperationLock } from "@wsgs/gowm-gateway-client";

type Availability = Pick<GroundingCapabilities12["worldAnalysis"], "capabilities" | "checkedAt" | "validUntil">;
type Capability = Availability["capabilities"][number]["capability"];
type Reason = Availability["capabilities"][number]["reasonCodes"][number];
export interface WorldAnalysisDiscoveryInput {
  historyEnabled: boolean;
  advancedEnabled: boolean;
  locks: readonly OperationLock[];
  catalog?: CapabilityCatalog;
  semantics?: CapabilitySemanticCatalog;
  availability?: OperationAvailabilityList;
  expectedCatalogRevision: string;
  expectedSemanticHash: string;
  now?: Date;
}

const traceOperations = ["operational-task.find", "operational-task.get", "operational-task.get-execution-intervals", "history.get-trajectory"];
const capabilities: Capability[] = ["HISTORICAL_TRACE", "ROAD_ASSOCIATION", "TEMPORAL_EVENT", "CROSS", "METRIC_RANKING", "ACTION_TARGET_CANDIDATE"];

/** Only accepts server-locked contracts and Gateway-schema-validated, caller-filtered metadata. */
export function projectWorldAnalysisAvailability(input: WorldAnalysisDiscoveryInput): Availability {
  const now = (input.now ?? new Date()).getTime();
  let validUntil = now + 5_000;
  const { catalog, semantics, availability } = input;
  const semanticCatalogIntact = semantics ? analysisHash(semantics.profiles) === semantics.catalogHash : false;
  function operation(id: string, version: string): Reason[] {
    if (!catalog || !semantics || !availability) return ["SNAPSHOT_UNAVAILABLE"];
    if (catalog.contractCatalogRevision !== input.expectedCatalogRevision ||
      semantics.contractCatalogRevision !== catalog.contractCatalogRevision ||
      semantics.bindingRevision !== catalog.bindingRevision) return ["CONTRACT_MISMATCH"];
    if (!semanticCatalogIntact || semantics.catalogHash !== input.expectedSemanticHash) return ["SEMANTIC_MISMATCH"];
    const matches = <T extends { operationId: string; operationVersion: string }>(values: readonly T[]): T | undefined => {
      const found = values.filter(value => value.operationId === id && value.operationVersion === version);
      return found.length === 1 ? found[0] : undefined;
    };
    const lock = matches(input.locks);
    const descriptor = matches(catalog.capabilities);
    if (!descriptor) return ["CAPABILITY_NOT_REGISTERED"];
    if (!lock || descriptor.inputSchemaHash !== lock.inputSchemaHash || descriptor.outputSchemaHash !== lock.outputSchemaHash ||
      descriptor.maturity !== lock.maturity) return ["CONTRACT_MISMATCH"];
    const semantic = matches(semantics.profiles);
    if (!semantic || semantic.semanticProfileHash !== lock.semanticProfileHash ||
      analysisHash(semantic.semanticProfile) !== lock.semanticProfileHash) return ["SEMANTIC_MISMATCH"];
    const state = matches(availability.operations);
    // A registered operation omitted from an authenticated filtered view is not a grant.
    if (!state) return ["PERMISSION_DENIED"];
    if (state.contractCatalogRevision !== catalog.contractCatalogRevision || state.bindingRevision !== catalog.bindingRevision ||
      state.maturity !== lock.maturity) return ["CONTRACT_MISMATCH"];
    const checkedAt = Date.parse(state.checkedAt);
    const expiry = Date.parse(state.validUntil);
    const capturedAt = Date.parse(availability.checkedAt);
    if (!Number.isFinite(checkedAt) || !Number.isFinite(expiry) || !Number.isFinite(capturedAt) ||
      checkedAt > now || capturedAt > now || expiry <= now || expiry <= checkedAt) return ["SNAPSHOT_EXPIRED"];
    validUntil = Math.min(validUntil, expiry);
    if (state.reasonCodes.some(code => code === "PERMISSION_DENIED" || code === "FORBIDDEN" || code === "UNAUTHORIZED")) return ["PERMISSION_DENIED"];
    if (state.availability === "DEGRADED") return ["OPERATION_DEGRADED"];
    return state.availability === "AVAILABLE" ? [] : ["OPERATION_UNAVAILABLE"];
  }
  const reasons = new Map<Capability, Reason[]>();
  const trace = input.historyEnabled ? traceOperations.flatMap(id => operation(id, "1.0")) : ["FEATURE_DISABLED" as const];
  reasons.set("HISTORICAL_TRACE", trace);
  for (const [capability, id] of [
    ["ROAD_ASSOCIATION", "trajectory.map-match"],
    ["TEMPORAL_EVENT", "temporal-spatial.find-events"],
    ["METRIC_RANKING", "spatiotemporal-metric.rank-locations"]
  ] as const) {
    reasons.set(capability, !input.advancedEnabled ? ["FEATURE_DISABLED"] : [
      ...operation(id, "0.1"), ...(trace.length ? ["DEPENDENCY_UNAVAILABLE" as const] : [])
    ]);
  }
  for (const [capability, dependencies] of [
    ["CROSS", ["ROAD_ASSOCIATION", "TEMPORAL_EVENT"]],
    ["ACTION_TARGET_CANDIDATE", ["METRIC_RANKING"]]
  ] as const) {
    reasons.set(capability, !input.advancedEnabled ? ["FEATURE_DISABLED"] :
      dependencies.some(dependency => reasons.get(dependency)!.length) ? ["DEPENDENCY_UNAVAILABLE"] : []);
  }
  return {
    capabilities: capabilities.map(capability => {
      const reasonCodes = [...new Set(reasons.get(capability)!)];
      return { capability, supported: true, available: reasonCodes.length === 0, reasonCodes: reasonCodes.length ? reasonCodes : ["AVAILABLE"] };
    }),
    checkedAt: new Date(now).toISOString(), validUntil: new Date(validUntil).toISOString()
  };
}
