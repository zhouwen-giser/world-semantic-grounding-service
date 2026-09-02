export const WSGS_VERSION = "0.2.1" as const;
export const WSGS_CONTRACT_VERSION = "sacs-wsgs-grounding/1.1" as const;
export const WSGS_LEGACY_CONTRACT_VERSION = "sacs-wsgs-grounding/1.0" as const;
export const SACS_GEOSPATIAL_FINDINGS_PROFILE = "sacs-wsgs-geospatial-findings/1.0" as const;
export const SACS_GEOSPATIAL_TRANSPORT_MODE = "RESULT_EXTENSION" as const;
export const SACS_GEOSPATIAL_CURRENTNESS_MODE = "DEDICATED_OPERATION" as const;
export const SACS_GEOSPATIAL_CURRENTNESS_OPERATION = "VALIDATE_SOURCE_CURRENTNESS" as const;
export const SACS_GEOSPATIAL_MAX_FINDINGS = 128 as const;
export const supportedResultProfiles = [SACS_GEOSPATIAL_FINDINGS_PROFILE] as const;

export {
  GOWM_CONSUMER_PACKAGE_NAME,
  GOWM_CONSUMER_PACKAGE_VERSION,
  GOWM_GATEWAY_CONTRACT_VERSION,
  GOWM_RUNTIME_CONTRACT_ALIGNMENT_LOCK,
  GOWM_RUNTIME_CONTRACT_ALIGNMENT_LOCK_RELATIVE_PATH,
  GOWM_RUNTIME_SOURCE_COMMIT,
  GOWM_RUNTIME_VERSION,
  GowmRuntimeContractAlignmentLockError,
  loadGowmRuntimeContractAlignmentLock
} from "./gowm-alignment.js";
export type {
  GowmAlignmentCompatibilityPolicy,
  GowmAlignmentCriticalOperationFingerprint,
  GowmAlignmentDeclaredSemanticProfileMigration,
  GowmAlignmentGatewayContract,
  GowmAlignmentRequiredTuple,
  GowmAlignmentRuntime,
  GowmAlignmentTaskSource,
  GowmRuntimeContractAlignmentLock,
  GowmSha256Digest,
  GowmSha512Integrity,
  LoadGowmRuntimeContractAlignmentLockOptions
} from "./gowm-alignment.js";

export const groundingOperations = [
  "GROUND_REFERENCES",
  "COMPILE_WORLD_QUERY",
  "EXECUTE_WORLD_QUERY",
  "VALIDATE_REFERENCES",
  "RESOLVE_WORLD_SELECTION",
  "VALIDATE_SOURCE_CURRENTNESS"
] as const;

export type GroundingOperation = (typeof groundingOperations)[number];

export type { GroundingRequest } from "./generated/grounding-request.js";
export type { GroundingResult } from "./generated/grounding-result.js";
export type { GroundingJob } from "./generated/grounding-job.js";
export type { WSGSCapabilitiesResponse } from "./generated/capabilities-response.js";
export type { WorldSemanticFrame } from "./generated/world-semantic-frame.js";
export type { GroundingGraph } from "./generated/grounding-graph.js";

export {
  defaultSacsGeospatialSchemaRegistry,
  SACS_GEOSPATIAL_SCHEMA_NAMES,
  SacsGeospatialSchemaRegistry,
  SacsGeospatialSchemaValidationError
} from "./sacs-geospatial-schema-registry.js";
export type {
  SacsGeospatialSchemaIssue,
  SacsGeospatialSchemaName
} from "./sacs-geospatial-schema-registry.js";
export type {
  WSGSCapabilitiesResponseForGroundingContract11,
  WSGSCapabilitiesResponseForGroundingContract11 as WSGSCapabilitiesResponseV11
} from "./generated-sacs-geospatial/capabilities-response-v1.1.js";
export type {
  SACSGeospatialFindingsProfile10,
  SACSGeospatialFindingsProfile10 as SacsGeospatialFindings
} from "./generated-sacs-geospatial/geospatial-findings.js";
export type {
  GroundingResult11WithSACSGeospatialFindings,
  GroundingResult11WithSACSGeospatialFindings as GroundingResultV11
} from "./generated-sacs-geospatial/grounding-result-extension.js";
export type { ValidateSourceCurrentnessRequest10 } from "./generated-sacs-geospatial/source-currentness-request.js";
export type { SACSSourceCurrentnessResult10 } from "./generated-sacs-geospatial/source-currentness-result.js";
export type {
  UrnWsgsV021SacsGeospatialSourceProduct10,
  UrnWsgsV021SacsGeospatialSourceProduct10 as SacsGeospatialSourceProduct
} from "./generated-sacs-geospatial/source-product.js";
export type { ResolveWorldSelectionRequest10 } from "./generated-sacs-geospatial/structured-selection-request.js";
export type { ResolveWorldSelectionResult10 } from "./generated-sacs-geospatial/structured-selection-result.js";
export type { SACSGeospatialTypedGap10 } from "./generated-sacs-geospatial/typed-gap.js";
export type {
  UrnWsgsV021SacsGeospatialWorldFinding10,
  UrnWsgsV021SacsGeospatialWorldFinding10 as SacsWorldFinding
} from "./generated-sacs-geospatial/world-finding.js";

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

