import { createHash } from "node:crypto";
import type { GroundingEvidenceItem } from "./types.js";

export type OperationalRequestedProduct =
  | "WORLD_EVIDENCE"
  | "OPERATIONAL_TASKS"
  | "EVENT_TIMELINES"
  | "CORRELATION_FINDINGS"
  | "PREDICATE_EVALUATIONS";

export interface OperationalAssemblyInput {
  requestedProducts: OperationalRequestedProduct[];
  evidenceItems: GroundingEvidenceItem[];
}

export interface OperationalAssemblyResult {
  status: "COMPLETED" | "PARTIAL";
  evidenceItems: GroundingEvidenceItem[];
  capabilityGaps: Array<{
    gapId: string;
    semanticCapability: string;
    reason: "NOT_REGISTERED";
    requiredForProduct: string;
    blocking: boolean;
    details: Record<string, unknown>;
  }>;
}

const requestedKinds: Record<OperationalRequestedProduct, GroundingEvidenceItem["productKind"][] | null> = {
  WORLD_EVIDENCE: null,
  OPERATIONAL_TASKS: ["OPERATIONAL_TASK"],
  EVENT_TIMELINES: ["EVENT_TIMELINE"],
  CORRELATION_FINDINGS: ["CORRELATION_FINDING"],
  PREDICATE_EVALUATIONS: ["PREDICATE_EVALUATION"]
};

const controlStates = new Set([
  "NO_CONTROL_EVENT", "REQUESTED_OBSERVED", "ACCEPTED_OBSERVED", "REJECTED_OBSERVED",
  "COMPLETED_REPORTED", "FAILED_REPORTED", "CANCELLED_REPORTED"
]);
const activityStates = new Set(["NOT_OBSERVED", "STARTED_OBSERVED", "ACTIVE_OBSERVED", "PAUSED_OBSERVED", "STOPPED_OBSERVED", "UNKNOWN"]);
const outcomeStates = new Set(["NOT_APPLICABLE", "UNVERIFIED", "PARTIALLY_VERIFIED", "VERIFIED", "CONTRADICTED", "INDETERMINATE"]);
const observabilityStates = new Set(["FRESH", "STALE", "OBSERVATION_GAP", "NO_DATA"]);
const correlationRelations = new Set([
  "REPORTS_EXECUTION_OF", "REALIZES", "PARTIALLY_REALIZES", "POSSIBLY_CORRESPONDS_TO", "NO_MATCH_FOUND", "CONFLICTING_MATCHES"
]);
const predicateStatuses = new Set(["SUPPORTED", "NOT_SUPPORTED", "PARTIALLY_SUPPORTED", "INDETERMINATE", "NO_DATA", "CONFLICTING"]);

function payload(item: GroundingEvidenceItem): Record<string, unknown> | null {
  if (!item.safePayload || typeof item.safePayload !== "object" || Array.isArray(item.safePayload)) return null;
  const object = item.safePayload as Record<string, unknown>;
  return object["summarized"] === true ? null : object;
}

function validateOperationalSemantics(item: GroundingEvidenceItem): void {
  const value = payload(item);
  if (!value) return;
  if (item.productKind === "OPERATIONAL_TASK") {
    if (
      !controlStates.has(String(value["controlState"])) || !activityStates.has(String(value["activityState"])) ||
      !outcomeStates.has(String(value["outcomeVerification"])) || !observabilityStates.has(String(value["observability"]))
    ) throw new OperationalProductError("INVALID_OPERATIONAL_DIMENSIONS");
  }
  if (item.productKind === "CORRELATION_FINDING") {
    if (!correlationRelations.has(String(value["relation"]))) throw new OperationalProductError("INVALID_CORRELATION_RELATION");
    if (value["relation"] === "NO_MATCH_FOUND" && value["operationalTaskReferenceKey"] !== undefined) {
      throw new OperationalProductError("NO_MATCH_HAS_TASK_REFERENCE");
    }
  }
  if (item.productKind === "PREDICATE_EVALUATION") {
    if (!predicateStatuses.has(String(value["status"]))) throw new OperationalProductError("INVALID_PREDICATE_STATUS");
    if (!Array.isArray(value["supportingEvidenceIds"]) || !Array.isArray(value["contradictingEvidenceIds"])) {
      throw new OperationalProductError("PREDICATE_EVIDENCE_MISSING");
    }
  }
  if (item.productKind === "EVENT_TIMELINE" && !Array.isArray(value["events"])) {
    throw new OperationalProductError("INVALID_EVENT_TIMELINE");
  }
}

export class OperationalProductError extends Error {
  constructor(readonly code: string) {
    super(`Operational product assembly failed: ${code}`);
  }
}

export class OperationalProductAssembler {
  assemble(input: OperationalAssemblyInput): OperationalAssemblyResult {
    if (input.requestedProducts.length === 0 || input.requestedProducts.length > 16 || new Set(input.requestedProducts).size !== input.requestedProducts.length) {
      throw new OperationalProductError("INVALID_REQUESTED_PRODUCTS");
    }
    const selected = new Map<string, GroundingEvidenceItem>();
    const gaps: OperationalAssemblyResult["capabilityGaps"] = [];
    for (const requested of input.requestedProducts) {
      const kinds = requestedKinds[requested];
      const matches = kinds === null
        ? input.evidenceItems
        : input.evidenceItems.filter((item) => kinds.includes(item.productKind));
      if (matches.length === 0) {
        gaps.push({
          gapId: `gap-${createHash("sha256").update(requested).digest("hex").slice(0, 24)}`,
          semanticCapability: requested,
          reason: "NOT_REGISTERED",
          requiredForProduct: requested,
          blocking: requested === "WORLD_EVIDENCE",
          details: { substituted: false }
        });
        continue;
      }
      for (const item of matches) {
        validateOperationalSemantics(item);
        selected.set(item.evidenceProductId, structuredClone(item));
      }
    }
    return {
      status: gaps.length === 0 ? "COMPLETED" : "PARTIAL",
      evidenceItems: [...selected.values()].sort((left, right) => left.evidenceProductId.localeCompare(right.evidenceProductId)),
      capabilityGaps: gaps.sort((left, right) => left.requiredForProduct.localeCompare(right.requiredForProduct))
    };
  }
}
