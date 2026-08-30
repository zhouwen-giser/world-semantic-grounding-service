export const SERVICE_NAME = "world-semantic-grounding-service" as const;

export { createGroundingApi } from "./server.js";
export { compileApiSchemas } from "./schemas.js";
export {
  ContractNegotiationError,
  WSGS_CONTRACT_VERSION_HEADER,
  WSGS_RESULT_PROFILE_HEADER,
  negotiateGroundingContract,
  normalizeContractNegotiationConfig,
  parseContractNegotiationConfig
} from "./contract-negotiation.js";
export type { ContractNegotiationConfig } from "./contract-negotiation.js";
export { ApiSecurityError, assertSafeUnicodeText, ScopedRateBudget } from "./security.js";
export type { RateBudgetConfig } from "./security.js";
export type {
  ApiAuthConfig,
  GroundingApiBackend,
  GroundingApiConfig,
  GroundingIdentity
} from "./types.js";
