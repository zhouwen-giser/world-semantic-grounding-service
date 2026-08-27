/* Generated from the locked WSGS v0.2 internal JSON Schemas. Do not edit directly. */

export interface QualificationReport {
  schemaVersion: "1.0";
  wsgsSourceCommit: string;
  gowmSourceCommit: string;
  consumerPackageIntegrity: string;
  /**
   * @minItems 1
   */
  cases: {
    id: string;
    status: "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED";
    evidence: string[];
  }[];
  status: "PASS" | "FAIL" | "BLOCKED";
}
