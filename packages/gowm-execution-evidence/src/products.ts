import type {
  EvidenceProductKind,
  EvidenceRequestedProduct,
  NormalizedExecutionEvidenceItem,
  RequestedProductGap
} from "./types.js";
import { compareText } from "./validation.js";

const productKindsByOperation: Readonly<Record<string, EvidenceProductKind>> = {
  "world.get-current-state": "WORLD_FACT",
  "world.get-geometry": "WORLD_GEOMETRY",
  "world.get-provenance": "PROVENANCE",
  "world.get-event-timeline": "EVENT_TIMELINE",
  "operational-task.get": "OPERATIONAL_TASK",
  "operational-task.get-timeline": "EVENT_TIMELINE",
  "correlation.resolve": "CORRELATION_FINDING",
  "world-event.find-by-correlation": "CORRELATION_FINDING",
  "predicate.evaluate": "PREDICATE_EVALUATION"
};

const requestedKinds: Readonly<Record<Exclude<EvidenceRequestedProduct, "WORLD_EVIDENCE">, readonly EvidenceProductKind[]>> = {
  OPERATIONAL_TASKS: ["OPERATIONAL_TASK"],
  EVENT_TIMELINES: ["EVENT_TIMELINE"],
  CORRELATION_FINDINGS: ["CORRELATION_FINDING"],
  PREDICATE_EVALUATIONS: ["PREDICATE_EVALUATION"]
};

export function evidenceProductKindForOperation(operationId: string): EvidenceProductKind {
  return productKindsByOperation[operationId] ?? "CAPABILITY_RESULT";
}

export function selectRequestedEvidenceProducts(
  evidenceItems: readonly NormalizedExecutionEvidenceItem[],
  requestedProducts: readonly EvidenceRequestedProduct[]
): {
  readonly evidenceItems: readonly NormalizedExecutionEvidenceItem[];
  readonly gaps: readonly RequestedProductGap[];
} {
  const selected = new Map<string, NormalizedExecutionEvidenceItem>();
  const gaps: RequestedProductGap[] = [];
  for (const requested of requestedProducts) {
    const matches = requested === "WORLD_EVIDENCE"
      ? evidenceItems
      : evidenceItems.filter((item) => requestedKinds[requested].includes(item.productKind));
    if (matches.length === 0) {
      gaps.push({
        requestedProduct: requested,
        reason: "NO_MATCHING_EVIDENCE",
        blocking: requested === "WORLD_EVIDENCE",
        substituted: false
      });
      continue;
    }
    for (const item of matches) selected.set(item.evidenceProductId, item);
  }
  return {
    evidenceItems: [...selected.values()].sort((left, right) => compareText(left.evidenceProductId, right.evidenceProductId)),
    gaps: gaps.sort((left, right) => compareText(left.requestedProduct, right.requestedProduct))
  };
}
