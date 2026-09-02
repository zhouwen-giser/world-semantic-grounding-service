import type {
  SacsWorldFinding,
  SACSGeospatialTypedGap10
} from "@wsgs/contracts";
import type {
  GowmCapabilityResultEnvelope,
  GowmFindingResultStatus,
  ValidatedGowmFindingResult
} from "@wsgs/gowm-execution-evidence";
import type { NormalizedSourceProductBinding } from "./source-normalizer.js";

export type Sha256Digest = `sha256:${string}`;

export const TRUSTED_PROVENANCE_BINDING_MARKER =
  "TRUSTED_EVIDENCE_SOURCE_BINDING" as const;

export const FINDING_DECODER_PATTERNS = [
  "SAMPLE_VALUE",
  "SAMPLE_CLASS",
  "FIND_CLASS",
  "FIND_VALUE_RANGE",
  "PROFILE_VALUE",
  "VECTOR_IN_AREA",
  "VECTOR_NEARBY",
  "VECTOR_INTERSECTS",
  "CATALOG",
  "QUALIFIED_EXPLANATION"
] as const;

export type FindingDecoderPattern = (typeof FINDING_DECODER_PATTERNS)[number];

export type DecoderPriority =
  | "EXACT_OPERATION_SCHEMA"
  | "SEMANTIC_PROFILE"
  | "GENERIC_PATTERN";

export type GowmResultStatus = GowmFindingResultStatus;
export type GowmResultEnvelope = GowmCapabilityResultEnvelope;

export interface FindingDescriptorContext {
  readonly authorityKind: "DESCRIPTOR" | "CATALOG";
  readonly closureHash: Sha256Digest;
  readonly semanticConcept: string;
  readonly querySemantics: string;
  readonly queryProfile: FindingDecoderPattern;
  readonly decoderPattern: FindingDecoderPattern;
  readonly capabilitySemanticProfile: Readonly<Record<string, unknown>>;
  readonly semanticProfileHash: Sha256Digest;
  readonly descriptorId?: string;
  readonly descriptorHash?: Sha256Digest;
  readonly descriptorRegistryHash?: Sha256Digest;
  readonly vocabularyRegistryHash?: Sha256Digest;
  readonly productType?: string;
  readonly productProfile?: string;
  /** Frozen descriptor value semantics; mandatory for generic raster sample. */
  readonly valueSemanticsKind?: "NUMBER" | "CLASS_CODE";
  /** Required for numeric point/profile results and treated as authoritative. */
  readonly unit?: string;
  /** When present, classification codes must be members of this frozen set. */
  readonly allowedClassCodes?: readonly string[];
  readonly paginationMode?: "FULL_RESULT" | "PAGE_SEGMENT";
}

export interface FindingDecoderInput {
  readonly envelope: GowmResultEnvelope;
  readonly descriptor: FindingDescriptorContext;
  readonly trustedProvenance: TrustedProvenanceBinding;
}

export interface FindingDecoderInputSource {
  readonly validatedResult: ValidatedGowmFindingResult;
  /** Opaque N03 binding minted from the authenticated result envelope. */
  readonly sourceBinding: NormalizedSourceProductBinding;
  readonly subjectReferenceProductIds?: readonly string[];
}

/** N02 consumes these opaque bindings; N03 owns their materialization and FK checks. */
export interface TrustedProvenanceBinding {
  readonly marker: typeof TRUSTED_PROVENANCE_BINDING_MARKER;
  readonly evidenceItemIds: readonly string[];
  readonly sourceProductIds: readonly string[];
  readonly subjectReferenceProductIds?: readonly string[];
}

export interface DecoderMatch {
  readonly payloadSchemaUri: string;
  readonly payloadSchemaHash: Sha256Digest;
  readonly operationId?: string;
  readonly operationVersion?: string;
  readonly semanticProfileHash?: Sha256Digest;
  readonly productType?: string;
  readonly productProfile?: string;
  readonly querySemantics?: string;
  readonly queryProfile?: FindingDecoderPattern;
}

export interface FindingDecoderContext {
  readonly input: FindingDecoderInput;
  readonly payload: unknown;
  readonly findingId: string;
}

export type FindingDecoderFunction = (
  context: FindingDecoderContext
) => SacsWorldFinding | undefined;

export interface FindingDecoderRegistration {
  readonly decoderId: string;
  readonly priority: DecoderPriority;
  readonly pattern: FindingDecoderPattern;
  readonly match: DecoderMatch;
  /** Omit to use the package's strict decoder for the selected pattern. */
  readonly decode?: FindingDecoderFunction;
}

export interface StandardDecoderSchemaBinding {
  readonly decoderId?: string;
  readonly pattern: FindingDecoderPattern;
  /**
   * Descriptor query profile used for matching when it intentionally differs
   * from the northbound decoder pattern (for example, traversability explain
   * is a SAMPLE_CLASS query decoded as QUALIFIED_EXPLANATION).
   */
  readonly matchQueryProfile?: FindingDecoderPattern;
  readonly payloadSchemaUri: string;
  readonly payloadSchemaHash: Sha256Digest;
  readonly priority?: DecoderPriority;
  readonly operationId?: string;
  readonly operationVersion?: string;
  readonly semanticProfileHash?: Sha256Digest;
  readonly productType?: string;
  readonly productProfile?: string;
  readonly querySemantics?: string;
}

export interface DecoderSelection {
  readonly decoderId: string;
  readonly priority: DecoderPriority;
  readonly pattern: FindingDecoderPattern;
}

export interface FindingDecodeResult {
  readonly status: Exclude<GowmResultStatus, "FAILED">;
  readonly selection?: DecoderSelection;
  readonly findings: readonly SacsWorldFinding[];
  readonly gaps: readonly SACSGeospatialTypedGap10[];
  readonly findingSetHash: Sha256Digest;
}

export interface FindingDecodeBatchResult {
  readonly findings: readonly SacsWorldFinding[];
  readonly gaps: readonly SACSGeospatialTypedGap10[];
  readonly findingSetHash: Sha256Digest;
}

export type DecoderCoverageClassification =
  | "SUPPORTED"
  | "INTENTIONALLY_GAP"
  | "UNSUPPORTED_SCHEMA"
  | "NOT_APPLICABLE";

export interface DecoderCoverageCandidate {
  readonly capabilityId: string;
  readonly operationId: string;
  readonly operationVersion: string;
  readonly payloadSchemaUri: string;
  readonly payloadSchemaHash: Sha256Digest;
  readonly semanticProfileHash: Sha256Digest;
  readonly productType?: string;
  readonly productProfile?: string;
  readonly querySemantics: string;
  readonly queryProfile?: FindingDecoderPattern;
  readonly valueSemanticsKind?: "NUMBER" | "CLASS_CODE";
  readonly applicability?: "APPLICABLE" | "NOT_APPLICABLE";
  readonly intentionalGapReason?: string;
}

export interface DecoderCoverageRow {
  readonly capabilityId: string;
  readonly operationId: string;
  readonly operationVersion: string;
  readonly classification: DecoderCoverageClassification;
  readonly decoderId?: string;
  readonly priority?: DecoderPriority;
  readonly resolvedQueryProfile?: FindingDecoderPattern;
  /** A single dynamic capability may resolve to either kind without being counted twice. */
  readonly findingKindOptions?: readonly (
    | "POINT_MEASUREMENT"
    | "POINT_CLASSIFICATION"
  )[];
  readonly reason?: string;
}

export interface DecoderCoverageSummary {
  readonly rows: readonly DecoderCoverageRow[];
  readonly counts: {
    readonly total: number;
    readonly supported: number;
    readonly intentionallyGap: number;
    readonly unsupportedSchema: number;
    readonly notApplicable: number;
  };
}

export type TypedFinding = SacsWorldFinding;
export type TypedFindingGap = SACSGeospatialTypedGap10;
