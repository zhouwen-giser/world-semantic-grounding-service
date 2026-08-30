/* Generated from the locked WSGS v0.2 GDPS JSON Schemas. Do not edit directly. */

export type Digest = string;

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
    consumerLockHash: Digest;
    capabilityLockHash: Digest;
    descriptorLockHash: Digest;
    recipeLockHash: Digest;
    providerRecipeLockHash: Digest;
    runtimeRecipeLockHash: Digest;
    checksumHash: Digest;
    testBaselineSchemaHash: "sha256:00bd7b9d9648e8bf593a8d453fd1cc27b438a0cef3e21127dd740bf2e58e119e";
    queryCorpusSchemaHash: "sha256:67c69ba0225fbf8c49b9083538af5bb2f18660ff7c91ccf2a099b9f833fefd92";
    queryCorpusHash: "sha256:4f60e2ceb8ff96dcea76952b3bc3369bada54ddbcc12bc755b2ed2ae56a6559a";
    w43CurrentnessContractHash: "sha256:8b684f1f669cb2be50f4be7ffce854ffd3a97dd73563784179345aa7121e30a3";
    w43AttestationSchemaHash: "sha256:9e5e2b77ffa40f699678c4fdeed57d7d946b76829457ecff1d6ead2c030a6097";
    w43DriverSourceHash: "sha256:249930ea8ecdf0a4740f6917b9321cb74f5fce20a57afd8d1d1166a3a5194efd";
    gatewayCanarySourceHash: "sha256:0137926005b5c1879ac612baed76893c1313b2f91511b898b6fafee6c5373f17";
    r06ReportSchemaVersion: "gdps-v021-running-gowm-canaries/2.0";
    r06ReportSchemaHash: "sha256:7fd3531cb967730b567e5cbbe3be7901b45ef9ddd6de9caa219ea75ae0409fbc";
    canaryEvidenceHash: Digest;
    protocolEvidenceHash: Digest;
  };
  gatewayBinding: {};
  status: "PASS" | "FAIL";
}
