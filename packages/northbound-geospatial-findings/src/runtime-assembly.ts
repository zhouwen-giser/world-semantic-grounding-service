import {
  createGdpsV021FinalBFindingAuthority,
  listGdpsFindingClosureOperations,
  resolveGdpsFindingOperationAuthority
} from "@wsgs/gdps-descriptor-consumer";
import {
  validateGowmFindingResultEnvelope,
  type ValidatedGowmFindingResult
} from "@wsgs/gowm-execution-evidence";

import {
  createTrustedSourceContext,
  normalizeSourceProducts,
  type SourceGroundingIdentity
} from "./source-normalizer.js";
import {
  assembleGeospatialFindingsResult,
  createReferenceProductSubjectBinding,
  type GeospatialFindingsAssembly
} from "./result-normalizer.js";

export interface RuntimeFindingEnvelopeInput {
  readonly operationId: string;
  readonly operationVersion: string;
  readonly semanticConcept: string;
  readonly descriptorId?: string;
  /** Worker-derived subjects whose ReferenceKey occurs in this exact node result. */
  readonly subjectReferenceProductIds?: readonly string[];
  readonly envelope: unknown;
}

export interface AssembleRuntimeGeospatialFindingsInput {
  /** Authenticated, server-owned identity. Request-body authority is forbidden upstream. */
  readonly identity: SourceGroundingIdentity;
  readonly selectedDataScope: string;
  readonly envelopes: readonly RuntimeFindingEnvelopeInput[];
  readonly referenceProductIds?: readonly string[];
}

/**
 * The production-only bridge keeps all WeakMap-backed authority tokens inside
 * one invocation. Only its safe, serializable assembly may cross a checkpoint.
 */
export function assembleRuntimeGeospatialFindings(
  input: AssembleRuntimeGeospatialFindingsInput
): GeospatialFindingsAssembly | null {
  if (!Array.isArray(input.envelopes)) throw new TypeError("Runtime finding envelopes must be an array");
  const finalAuthority = createGdpsV021FinalBFindingAuthority();
  const closure = new Map(listGdpsFindingClosureOperations(finalAuthority)
    .map((operation) => [`${operation.operationId}@${operation.operationVersion}`, operation]));
  const validatedResults: ValidatedGowmFindingResult[] = [];
  const subjectReferenceProductIdsByResult: string[][] = [];
  for (const candidate of input.envelopes) {
    const operation = closure.get(`${candidate.operationId}@${candidate.operationVersion}`);
    if (operation === undefined) throw new TypeError("Runtime finding operation is not in the locked GDPS closure");
    if (operation.findingBinding.applicability === "NOT_APPLICABLE") continue;
    if (operation.findingBinding.applicability === "CATALOG" && candidate.descriptorId !== undefined) {
      throw new TypeError("Catalog finding operation must not carry a descriptor identity");
    }
    const authority = resolveGdpsFindingOperationAuthority(finalAuthority, {
      operationId: candidate.operationId,
      operationVersion: candidate.operationVersion,
      semanticConcept: candidate.semanticConcept,
      ...(operation.findingBinding.applicability === "CATALOG"
        ? {}
        : candidate.descriptorId === undefined ? {} : { descriptorId: candidate.descriptorId })
    });
    validatedResults.push(validateGowmFindingResultEnvelope(authority, candidate.envelope));
    subjectReferenceProductIdsByResult.push([...(candidate.subjectReferenceProductIds ?? [])]);
  }
  if (validatedResults.length === 0) return null;
  const trustedContext = createTrustedSourceContext(input.identity, input.selectedDataScope);
  const sourceBinding = normalizeSourceProducts({ trustedContext, validatedResults });
  const hasSubjects = subjectReferenceProductIdsByResult.some((subjects) => subjects.length > 0);
  if (hasSubjects && input.referenceProductIds === undefined) {
    throw new TypeError("Runtime ReferenceProduct authority is required for finding subjects");
  }
  const referenceProductBinding = !hasSubjects || input.referenceProductIds === undefined
    ? undefined
    : createReferenceProductSubjectBinding({
        validatedResults,
        subjectReferenceProductIdsByResult,
        referenceProductIds: input.referenceProductIds
      });
  return assembleGeospatialFindingsResult({
    sourceBinding,
    validatedResults,
    ...(referenceProductBinding === undefined
      ? {}
      : { referenceProductBinding })
  });
}
