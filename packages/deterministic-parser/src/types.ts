export interface TextSpan {
  encoding: "UTF16_CODE_UNIT";
  start: number;
  end: number;
}

export interface ReferenceKey {
  namespace: "gowm";
  kind: string;
  id: string;
  version: string;
}

export interface KnownWorldReferenceInput {
  alias?: string;
  referenceKey: ReferenceKey;
  referenceType: string;
  sourceMessageId: string;
  sourceGroundingId?: string;
  validUntil?: string;
}

export interface MapSelectionInput {
  selectionId: string;
  label?: string;
  kind: "POINT" | "LINE" | "AREA" | "FEATURE" | "ANNOTATION";
  revision: number;
  referenceKey?: ReferenceKey;
  geometry?: Record<string, unknown>;
  geometryHash?: string;
}

export interface PriorGroundingInput {
  groundingId: string;
  resultHash: string;
  selectedProductIds?: string[];
}

export interface ParseInput {
  originalText: string;
  focusSpans?: TextSpan[];
  knownWorldReferences?: KnownWorldReferenceInput[];
  mapSelections?: MapSelectionInput[];
  priorGroundings?: PriorGroundingInput[];
}

export type CandidateKind =
  | "KNOWN_REFERENCE"
  | "MAP_SELECTION"
  | "H3_CELL_CANDIDATE"
  | "COORDINATE_CANDIDATE"
  | "GEOMETRY_CANDIDATE"
  | "REFERENCE_KEY_OBJECT"
  | "CODE_HINT";

export interface ParsedCandidate {
  kind: CandidateKind;
  value: unknown;
  approximate: boolean;
  requiresUpstreamValidation: boolean;
  referenceKey?: ReferenceKey;
}

export interface ParsedMention {
  mentionId: string;
  surfaceText: string;
  span: TextSpan;
  expectedKinds: string[];
  extractionSource: "CLIENT_MAP" | "KNOWN_REFERENCE" | "DETERMINISTIC";
  priority: number;
  candidate: ParsedCandidate;
}

export interface ParseAmbiguity {
  ambiguityId: string;
  reason: "OVERLAPPING_DETERMINISTIC_CANDIDATES" | "MAP_TEXT_CONFLICT";
  mentionIds: string[];
}

export interface PriorGroundingPointer {
  groundingId: string;
  resultHash: string;
  selectedProductIds: string[];
}

export interface DeterministicParseResult {
  parserVersion: "deterministic-parser/1.0";
  mentions: ParsedMention[];
  ambiguities: ParseAmbiguity[];
  priorGroundings: PriorGroundingPointer[];
  warnings: string[];
}

export interface ModelSpanMention {
  mentionId: string;
  surfaceText: string;
  span: TextSpan;
}
