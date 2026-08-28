/* Generated from the locked WSGS v0.2 internal JSON Schemas. Do not edit directly. */

export interface CapabilityBinding {
  requirementId: string;
  operationId: string;
  operationVersion: string;
  inputSchemaHash: string;
  outputSchemaHash: string;
  semanticProfileHash: string;
  maturity: "STABLE" | "PREVIEW";
  availability: "AVAILABLE" | "DEGRADED";
  snapshotSupport: "NONE" | "BEST_EFFORT" | "CONSISTENT_AT_START" | "PINNED";
  requiredPermissions: string[];
  matchEvidence: {
    [k: string]: (string | boolean | number | unknown[] | {} | null) | undefined;
  };
  selectionPolicy: string;
}
