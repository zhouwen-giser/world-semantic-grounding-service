/* Generated from the locked WSGS v0.2 GDPS JSON Schemas. Do not edit directly. */

export interface UrnWsgsGdpsHandoffIntake10 {
  schemaVersion: "wsgs-gdps-handoff-intake/1.0";
  sources: {
    wsgsSha: string;
    gdpsSha: string;
    gowmSha: string;
  };
  provider: {
    providerId: "gdps.geospatial-products";
    providerVersion: string;
    manifestHash: string;
  };
  inventory: {
    productTypeCount: 34;
    descriptorProfileCount: 35;
    capabilityCount: 30;
  };
  locks: {
    [k: string]: string | undefined;
  };
  gatewayBinding: {};
  status: "PASS" | "FAIL";
}
