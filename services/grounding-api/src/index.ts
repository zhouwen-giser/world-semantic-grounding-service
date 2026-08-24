export const SERVICE_NAME = "world-semantic-grounding-service" as const;

export { createGroundingApi } from "./server.js";
export { compileApiSchemas } from "./schemas.js";
export type {
  ApiAuthConfig,
  GroundingApiBackend,
  GroundingApiConfig,
  GroundingIdentity
} from "./types.js";
