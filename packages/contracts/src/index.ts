export const WSGS_VERSION = "0.1.0" as const;
export const WSGS_CONTRACT_VERSION = "sacs-wsgs-grounding/1.0" as const;
export const GOWM_VERSION = "0.6.3" as const;
export const GOWM_COMMIT = "17dd221330d9af540ec815a39eca96550690299a" as const;

export const groundingOperations = [
  "GROUND_REFERENCES",
  "COMPILE_WORLD_QUERY",
  "EXECUTE_WORLD_QUERY",
  "VALIDATE_REFERENCES"
] as const;

export type GroundingOperation = (typeof groundingOperations)[number];

export type { GroundingRequest } from "./generated/grounding-request.js";
export type { GroundingResult } from "./generated/grounding-result.js";
export type { GroundingJob } from "./generated/grounding-job.js";
export type { WSGSCapabilitiesResponse } from "./generated/capabilities-response.js";
export type { WorldSemanticFrame } from "./generated/world-semantic-frame.js";
export type { GroundingGraph } from "./generated/grounding-graph.js";

export type { CapabilityBinding } from "./generated-internal-v02/capability-binding.js";
export type { ContractIntakeReport } from "./generated-internal-v02/contract-intake-report.js";
export type { DelegatedGowmRequestContext } from "./generated-internal-v02/delegated-gowm-request-context.js";
export type { GowmConsumerIntakeLock } from "./generated-internal-v02/gowm-consumer-intake-lock.js";
export type { GowmExecutionRecord } from "./generated-internal-v02/gowm-execution-record.js";
export type { ModelPolicy } from "./generated-internal-v02/model-policy.js";
export type { PipelineEvent } from "./generated-internal-v02/pipeline-event.js";
export type { QualificationReport } from "./generated-internal-v02/qualification-report.js";
export type { RecipeCatalog } from "./generated-internal-v02/recipe-catalog.js";
export type { RuntimeReadiness } from "./generated-internal-v02/runtime-readiness.js";
export type { TrustedCapabilitySnapshot } from "./generated-internal-v02/trusted-capability-snapshot.js";
export type { WorldQueryRequirementGraph } from "./generated-internal-v02/world-query-requirement-graph.js";

export type {
  UrnWsgsGdpsAcceptanceEvidenceMap10 as GdpsAcceptanceEvidenceMap
} from "./generated-internal-v02/gdps/acceptance-evidence-map.js";
export type {
  UrnWsgsGdpsDescriptorResolution10 as GdpsDescriptorResolution
} from "./generated-internal-v02/gdps/descriptor-resolution.js";
export type {
  UrnWsgsGdpsConsumerSnapshotExtension20 as GdpsConsumerSnapshotExtension
} from "./generated-internal-v02/gdps/gdps-consumer-snapshot-extension.js";
export type {
  UrnWsgsGdpsHandoffIntake10 as GdpsHandoffIntake
} from "./generated-internal-v02/gdps/gdps-handoff-intake.js";
export type {
  UrnWsgsGdpsSourceEvidence10 as GdpsSourceEvidence
} from "./generated-internal-v02/gdps/gdps-source-evidence.js";
export type {
  UrnWsgsGdpsStatusNormalization10 as GdpsStatusNormalization
} from "./generated-internal-v02/gdps/gdps-status-normalization.js";
export type {
  UrnWsgsGeospatialProductIntent10 as GeospatialProductIntentContract
} from "./generated-internal-v02/gdps/geospatial-product-intent.js";
export type {
  UrnWsgsGroundedGeospatialProductIntent10 as GroundedGeospatialProductIntentContract
} from "./generated-internal-v02/gdps/grounded-geospatial-product-intent.js";
export type {
  UrnWsgsLockedGdpsRecipe20 as LockedGdpsRecipeContract
} from "./generated-internal-v02/gdps/locked-gdps-recipe.js";

