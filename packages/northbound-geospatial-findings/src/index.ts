export {
  canonicalJson,
  canonicalSha256,
  compareCodePoints,
  deterministicId
} from "./canonical.js";
export {
  FindingDecoderRegistry,
  canonicalDecoderCoverage,
  decoderCoverageHash,
  standardDecoderRegistrations
} from "./registry.js";
export {
  FINDING_DECODER_PATTERNS
} from "./types.js";
export {
  createFindingDecoderInput,
  FindingDecoderError,
  validateDecoderInput
} from "./validation.js";
export {
  normalizeSourceProducts,
  readNormalizedSourceProductBinding,
  SourceProductNormalizationError
} from "./source-normalizer.js";
export {
  GapNormalizationError,
  normalizeGeospatialGaps
} from "./gap-normalizer.js";
export {
  assembleGeospatialFindingsProfile,
  assembleGeospatialFindingsResult,
  assertGeospatialFindingsProfileIntegrity,
  ResultNormalizationError,
  SACS_GEOSPATIAL_FINDINGS_SCHEMA_HASH
} from "./result-normalizer.js";
export type {
  NormalizedSourceProductBinding,
  NormalizedSourceProductProjection,
  NormalizeSourceProductsInput,
  SafeComputeSnapshotProjection,
  SafeDataSnapshotProjection,
  SafeDataSnapshotResource,
  SafeEvidenceReference,
  SafeReceiptReference,
  SourceEnvelopeBinding,
  SourceEnvelopeQualification,
  SourceProvenanceRejectionReason,
  TrustedSourceRuntimeContext,
  WsgsLocalSourceEvidenceItem
} from "./source-normalizer.js";
export type {
  GapNormalizationInput,
  GapNormalizationResult,
  NormalizedFindingStatus
} from "./gap-normalizer.js";
export type {
  AssembleGeospatialFindingsInput,
  GeospatialFindingsAssembly
} from "./result-normalizer.js";
export type {
  DecoderCoverageCandidate,
  DecoderCoverageClassification,
  DecoderCoverageRow,
  DecoderCoverageSummary,
  DecoderMatch,
  DecoderPriority,
  DecoderSelection,
  FindingDecodeBatchResult,
  FindingDecodeResult,
  FindingDecoderContext,
  FindingDecoderFunction,
  FindingDecoderInput,
  FindingDecoderInputSource,
  FindingDecoderPattern,
  FindingDecoderRegistration,
  FindingDescriptorContext,
  GowmResultEnvelope,
  GowmResultStatus,
  Sha256Digest,
  StandardDecoderSchemaBinding,
  TypedFinding,
  TypedFindingGap
} from "./types.js";
