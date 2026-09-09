import { worldAnalysisCanonicalHash, worldAnalysisFindingSetHash, type GroundingResult12 } from "@wsgs/contracts";
import { assemblePublicWorldAnalysisResult, projectHistoricalReference, projectPublicWorldAnalysis } from "@wsgs/historical-trace-consumer";

type ProjectionInput = Parameters<typeof projectPublicWorldAnalysis>[0];
type RecordValue = Record<string, unknown>;
const referenceFields = ["productId", "productKind", "referenceKey", "referenceType", "displayName", "matchedBy", "matchScore", "stateConfidence", "sourceOperation", "sourceWorldVersion", "validUntil", "revalidationRequired"];
const evidenceFields = ["evidenceProductId", "productKind", "authority", "sourceOperation", "sourceProvider", "sourceQueryId", "sourceNodeId", "upstreamStatus", "payloadSchemaUri", "payloadSchemaHash", "receiptIds", "evidenceIds", "unknowns", "warnings"];

function pick(value: RecordValue, fields: readonly string[]): RecordValue {
  return Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}

/** Whitelist the consumer boundary; raw provider material remains in encrypted stage checkpoints. */
export function assembleProductionWorldAnalysis(input: {
  base: RecordValue;
  runFingerprint: string;
  validUntil: string;
  maxResultBytes: number;
  contracts?: ProjectionInput["contracts"];
  catalog?: ProjectionInput["catalog"];
  advanced?: ProjectionInput["advanced"];
  failureReasonCode?: string;
  foundation?: ProjectionInput["foundation"];
  foundationEvidenceIds: string[];
}): GroundingResult12 {
  const references = (input.base["referenceProducts"] as RecordValue[]).map(item => pick(item, referenceFields));
  const foundation = input.foundation ?? input.advanced?.foundation;
  if (foundation) {
    for (const findingKind of ["TASK_EXECUTION_INTERVAL", "HISTORICAL_TRAJECTORY"] as const) {
      const projected = projectHistoricalReference({ ...foundation.finding, findingKind }, 0, new Date(input.validUntil));
      if (!projected || references.some(product => worldAnalysisCanonicalHash(product["referenceKey"]) === worldAnalysisCanonicalHash(projected.referenceKey))) continue;
      references.push({ productId: `history-reference-${worldAnalysisCanonicalHash(projected.referenceKey).slice(7, 31)}`,
        productKind: "DERIVED_REFERENCE", referenceKey: projected.referenceKey, referenceType: projected.referenceType,
        displayName: findingKind === "TASK_EXECUTION_INTERVAL" ? "Task execution interval" : "Historical trajectory",
        sourceOperation: findingKind === "TASK_EXECUTION_INTERVAL" ? "operational-task.get-execution-intervals" : "history.get-trajectory",
        sourceWorldVersion: 0, revalidationRequired: projected.revalidationRequired,
        ...(projected.validUntil ? { validUntil: projected.validUntil } : {}) });
    }
  }
  const evidence = (input.base["evidenceItems"] as RecordValue[]).map(item => {
    const projected = pick(item, evidenceFields);
    for (const field of ["dataSnapshot", "computeSnapshot"]) {
      const snapshot = item[field];
      if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
        projected[field] = { snapshotHash: worldAnalysisCanonicalHash(snapshot), ...pick(snapshot as RecordValue, ["capturedAt", "worldVersion"]) };
      }
    }
    return projected;
  });
  const empty = { profile: "wsgs-world-analysis-findings/1.0" as const, findings: [], choices: [], gaps: [] };
  const base = {
    ...input.base, referenceProducts: references, evidenceItems: evidence,
    execution: { ...(input.base["execution"] as RecordValue), runFingerprint: input.runFingerprint },
    worldAnalysisFindings: { ...empty, findingSetHash: worldAnalysisFindingSetHash(empty) }
  } as unknown as GroundingResult12;
  const projection = projectPublicWorldAnalysis({
    context: { groundingId: base.groundingId, referenceProducts: base.referenceProducts, evidenceItems: base.evidenceItems,
      foundationEvidenceIds: input.foundationEvidenceIds, validUntil: input.validUntil },
    ...(input.contracts ? { contracts: input.contracts } : {}),
    ...(input.catalog ? { catalog: input.catalog } : {}),
    ...(input.advanced ? { advanced: input.advanced } : {}),
    ...(input.failureReasonCode ? { failureReasonCode: input.failureReasonCode } : {}),
    ...(input.foundation ? { foundation: input.foundation } : {})
  });
  for (const ambiguity of base.ambiguities) {
    const candidates = base.referenceProducts.filter(product => ambiguity.candidateProductIds.includes(product.productId));
    if (candidates.length === 0) continue;
    if (projection.component.choices.length >= 32 || candidates.length > 100) {
      projection.component.gaps.push({ gapId: `gap-${worldAnalysisCanonicalHash({ groundingId: base.groundingId, ambiguity: ambiguity.ambiguityId }).slice(7, 39)}`,
        gapKind: "RESULT_TRUNCATED", severity: "WARNING", messageCode: "RESULT_TRUNCATED", findingIds: [], evidenceIds: [], detail: {} });
      if (projection.component.choices.length >= 32) break;
    }
    const choiceId = `choice-${worldAnalysisCanonicalHash({ groundingId: base.groundingId, ambiguity: ambiguity.ambiguityId }).slice(7, 39)}`;
    projection.component.choices.push({ choiceId, choiceKind: candidates.every(product => product.referenceKey.kind === "OPERATIONAL_TASK") ? "TASK_SELECTION" : "REFERENCE_SELECTION",
      promptCode: "REFERENCE_AMBIGUOUS", validUntil: input.validUntil,
      candidates: candidates.slice(0, 100).map(product => ({ candidateId: `candidate-${worldAnalysisCanonicalHash({ choiceId, productId: product.productId }).slice(7, 39)}`,
        displayName: product.displayName, referenceProductId: product.productId })) });
    projection.status = "AMBIGUOUS";
  }
  projection.component.findingSetHash = worldAnalysisFindingSetHash(projection.component);
  return assemblePublicWorldAnalysisResult(base, projection, { maxResultBytes: input.maxResultBytes });
}
