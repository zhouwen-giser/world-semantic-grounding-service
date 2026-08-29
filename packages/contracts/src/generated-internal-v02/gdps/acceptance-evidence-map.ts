/* Generated from the locked WSGS v0.2 GDPS JSON Schemas. Do not edit directly. */

export interface UrnWsgsGdpsAcceptanceEvidenceMap10 {
  schemaVersion: "wsgs-gdps-acceptance-evidence-map/1.0";
  entries: {
    acceptanceId: string;
    /**
     * @minItems 1
     */
    evidence: unknown[];
  }[];
}
