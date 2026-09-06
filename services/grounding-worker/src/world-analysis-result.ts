import { worldAnalysisCanonicalHash, worldAnalysisFindingSetHash, type GroundingResult12 } from "@wsgs/contracts";
import { assemblePublicWorldAnalysisResult, projectPublicWorldAnalysis } from "@wsgs/historical-trace-consumer";

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
  foundation?: ProjectionInput["foundation"];
  foundationEvidenceIds: string[];
}): GroundingResult12 {
  const references = (input.base["referenceProducts"] as RecordValue[]).map(item => pick(item, referenceFields));
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
    ...(input.foundation ? { foundation: input.foundation } : {})
  });
  return assemblePublicWorldAnalysisResult(base, projection, { maxResultBytes: input.maxResultBytes });
}
