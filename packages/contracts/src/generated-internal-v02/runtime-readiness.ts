/* Generated from the locked WSGS v0.2 internal JSON Schemas. Do not edit directly. */

export interface RuntimeReadiness {
  schemaVersion: "1.0";
  ready: boolean;
  /**
   * @minItems 1
   */
  checks: {
    name: string;
    status: "PASS" | "FAIL" | "DEGRADED" | "NOT_REQUIRED";
    reason?: string;
  }[];
  checkedAt: string;
}
