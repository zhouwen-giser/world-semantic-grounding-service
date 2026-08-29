export const GDPS_DESCRIPTOR_CONSUMER_VERSION = "wsgs-gdps-descriptor-consumer/1.0" as const;

export { canonicalJson, canonicalSha256, GdpsDescriptorConsumer } from "./consumer.js";
export { projectGeospatialProductIntent } from "./intent.js";
export type {
  DescriptorConsumerOptions,
  DescriptorResolution,
  DescriptorResolutionEvidence,
  DescriptorResolutionStatus,
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
