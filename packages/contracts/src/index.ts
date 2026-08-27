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

