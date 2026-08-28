/* Generated from the locked WSGS v0.2 internal JSON Schemas. Do not edit directly. */

export interface ContractIntakeReport {
  schemaVersion: "1.0";
  sourceCommit: string;
  packageIntegrity: string;
  /**
   * @minItems 1
   */
  checks: {
    id: string;
    status: "PASS" | "FAIL";
    actual?: string;
    expected?: string;
  }[];
  status: "PASS" | "FAIL";
}
