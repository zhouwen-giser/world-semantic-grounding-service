export const LEGACY_GROUNDING_CONTRACT_VERSION = "sacs-wsgs-grounding/1.0" as const;
export const SACS_GEOSPATIAL_GROUNDING_CONTRACT_VERSION = "sacs-wsgs-grounding/1.1" as const;
export const SACS_GEOSPATIAL_RESULT_PROFILE = "sacs-wsgs-geospatial-findings/1.0" as const;

export type GroundingContractSelection =
  | Readonly<{
      contractVersion: typeof LEGACY_GROUNDING_CONTRACT_VERSION;
      resultProfile: null;
      transportMode: "NONE";
    }>
  | Readonly<{
      contractVersion: typeof SACS_GEOSPATIAL_GROUNDING_CONTRACT_VERSION;
      resultProfile: typeof SACS_GEOSPATIAL_RESULT_PROFILE;
      transportMode: "RESULT_EXTENSION";
    }>;

export const LEGACY_GROUNDING_CONTRACT_SELECTION: GroundingContractSelection = Object.freeze({
  contractVersion: LEGACY_GROUNDING_CONTRACT_VERSION,
  resultProfile: null,
  transportMode: "NONE"
});

export const SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION: GroundingContractSelection = Object.freeze({
  contractVersion: SACS_GEOSPATIAL_GROUNDING_CONTRACT_VERSION,
  resultProfile: SACS_GEOSPATIAL_RESULT_PROFILE,
  transportMode: "RESULT_EXTENSION"
});

export class GroundingContractSelectionError extends Error {
  readonly code = "WSGS_CONSUMER_CONTRACT_MISMATCH";
  readonly retryable = false;

  constructor() {
    super("Grounding contract selection is invalid");
    this.name = "GroundingContractSelectionError";
  }
}

function fail(): never {
  throw new GroundingContractSelectionError();
}

/** Strictly validates server-owned, persisted negotiation metadata. */
export function parseGroundingContractSelection(value: unknown): GroundingContractSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["contractVersion", "resultProfile", "transportMode"])) return fail();
  if (
    candidate["contractVersion"] === LEGACY_GROUNDING_CONTRACT_VERSION &&
    candidate["resultProfile"] === null &&
    candidate["transportMode"] === "NONE"
  ) return LEGACY_GROUNDING_CONTRACT_SELECTION;
  if (
    candidate["contractVersion"] === SACS_GEOSPATIAL_GROUNDING_CONTRACT_VERSION &&
    candidate["resultProfile"] === SACS_GEOSPATIAL_RESULT_PROFILE &&
    candidate["transportMode"] === "RESULT_EXTENSION"
  ) return SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION;
  return fail();
}

export function isSacsGeospatialContract(
  selection: GroundingContractSelection
): selection is Extract<GroundingContractSelection, { contractVersion: "sacs-wsgs-grounding/1.1" }> {
  return selection.contractVersion === SACS_GEOSPATIAL_GROUNDING_CONTRACT_VERSION;
}
