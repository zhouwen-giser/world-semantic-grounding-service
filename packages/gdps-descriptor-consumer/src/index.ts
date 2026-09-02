export const GDPS_DESCRIPTOR_CONSUMER_VERSION = "wsgs-gdps-descriptor-consumer/1.0" as const;

export { canonicalJson, canonicalSha256, GdpsDescriptorConsumer } from "./consumer.js";
export {
  GdpsFindingAuthorityError,
  createGdpsV021FinalBFindingAuthority,
  listGdpsFindingClosureOperations,
  readGdpsFindingOperationAuthority,
  resolveGdpsFindingOperationAuthority
} from "./decoder-authority.js";
export { projectGeospatialProductIntent } from "./intent.js";
export type {
  GdpsFinalBFindingAuthority,
  GdpsFindingContractClosure,
  GdpsFindingContractClosureOperation,
  GdpsFindingDecoderPattern,
  GdpsFindingOperationAuthority,
  GdpsFindingOperationBinding,
  GdpsFindingOperationProjection,
  GdpsGatewayBindingProjection,
  GdpsSha256Digest,
  ResolveGdpsFindingOperationAuthorityInput
} from "./decoder-authority.js";
export type {
  DescriptorConsumerOptions,
  DescriptorResolution,
  DescriptorResolutionEvidence,
  DescriptorResolutionStatus,
  DescriptorRecipeBinding,
  DescriptorRecipeLookup,
  DescriptorRecipeLookupStatus,
  GdpsQueryProfile,
  GdpsRepresentation,
  GeospatialProductSemanticIntent,
  GroundedGeospatialProductIntent,
  NumericRange,
  ProductDescriptorRegistry,
  ProductIntentProjectionInput,
  ProductQuerySemantics,
  ProductTypeDescriptor,
  ProductVocabularyRegistry,
  SemanticConceptEntry,
  SemanticConceptMap
} from "./types.js";
