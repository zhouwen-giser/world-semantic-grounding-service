export const SERVICE_NAME = "world-semantic-grounding-service" as const;

export { createGroundingApi } from "./server.js";
export { compileApiSchemas } from "./schemas.js";
export { ApiSecurityError, assertSafeUnicodeText, ScopedRateBudget } from "./security.js";
export type { RateBudgetConfig } from "./security.js";
export type {
  ApiAuthConfig,
  GroundingApiBackend,
  GroundingApiConfig,
  GroundingIdentity
} from "./types.js";
