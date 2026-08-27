import type { ExecutionEvidenceErrorCode } from "./types.js";

export class ExecutionEvidenceError extends Error {
  constructor(
    readonly code: ExecutionEvidenceErrorCode,
    message: string = code
  ) {
    super(`GOWM execution evidence failed: ${message}`);
    this.name = "ExecutionEvidenceError";
  }
}
