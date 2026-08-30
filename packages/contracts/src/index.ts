export const WSGS_VERSION = "0.1.0" as const;
export const WSGS_CONTRACT_VERSION = "sacs-wsgs-grounding/1.0" as const;

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

