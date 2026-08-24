export const EVIDENCE_NORMALIZER_VERSION = "evidence-normalizer/1.0" as const;

export { GowmEvidenceNormalizer, EvidenceNormalizationError } from "./normalizer.js";
export type {
  EvidenceNormalizationInput,
  EvidenceNormalizationResult,
  GroundingEvidenceItem
} from "./types.js";
