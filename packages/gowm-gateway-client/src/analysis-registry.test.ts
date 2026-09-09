import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AnalysisProviderContracts, analysisHash, GowmConsumerSchemaRegistry } from "@wsgs/gowm-contract-intake";
import { GowmGatewayClient } from "./client.js";
import type { CapabilityCatalog, CapabilitySemanticCatalog, OperationAvailabilityList, OperationLock } from "./types.js";

const contracts = new AnalysisProviderContracts(new URL("../../../contracts/upstream/gowm-analysis-providers-current", import.meta.url).pathname);
function discovery() {
  const capabilities = ["map-matching", "temporal-events", "metric-ranking"].flatMap(name =>
    JSON.parse(readFileSync(new URL(`../../../contracts/upstream/gowm-analysis-providers-current/contracts/manifests/${name}-provider.json`, import.meta.url), "utf8")).capabilities);
  const contractCatalogRevision = analysisHash("controlled-analysis-registry");
  const bindingRevision = analysisHash("controlled-analysis-binding");
  const profiles = capabilities.map(descriptor => ({ operationId: descriptor.operationId, operationVersion: descriptor.operationVersion,
    semanticProfile: descriptor.semanticProfile, semanticProfileHash: analysisHash(descriptor.semanticProfile) }));
  const catalog: CapabilityCatalog = { registryVersion: "registry-1", contractCatalogRevision, bindingRevision, capabilities };
  const semantics: CapabilitySemanticCatalog = { schemaVersion: "1.1", contractCatalogRevision, bindingRevision,
    profiles, catalogHash: analysisHash(profiles) };
  const required: OperationLock[] = contracts.authorizations.map(auth => ({ operationId: auth.operationId, operationVersion: auth.operationVersion,
    maturity: "PREVIEW", inputSchemaHash: auth.inputSchemaHash, outputSchemaHash: auth.outputSchemaHash, semanticProfileHash: auth.semanticProfileHash }));
  const checkedAt = new Date().toISOString();
  const availability: OperationAvailabilityList = { schemaVersion: "1.0", checkedAt, operations: required.map(operation => ({
    operationId: operation.operationId, operationVersion: operation.operationVersion, maturity: operation.maturity,
    availability: "AVAILABLE", reasonCodes: ["AVAILABLE"], checkedAt, validUntil: new Date(Date.now() + 60_000).toISOString(), contractCatalogRevision, bindingRevision })) };
  return { catalog, semantics, availability, required, expectedContractCatalogRevision: contractCatalogRevision, expectedSemanticCatalogHash: semantics.catalogHash };
}
function client(optIn: boolean) {
  return new GowmGatewayClient({ baseUrl: "http://127.0.0.1:1", credential: () => "test-only-placeholder",
    ...(optIn ? { schemaRegistry: new GowmConsumerSchemaRegistry({ analysisContracts: contracts }) } : {}) });
}

describe("verified opt-in analysis Gateway semantics", () => {
  it("accepts published profile 1.1 in the current Gateway registry", () => {
    expect(() => client(false).validateTrustedContracts(discovery())).not.toThrow();
  });
  it("accepts all three real pinned GSAP manifests through the actual Gateway validator", () => {
    const input = discovery();
    try { new GowmConsumerSchemaRegistry({ analysisContracts: contracts }).validate("platform/capability-list-response.schema.json", input.catalog); }
    catch (error) { throw new Error(JSON.stringify((error as { issues: unknown }).issues)); }
    expect(client(true).validateTrustedContracts(input)).toMatchObject({ requiredReady: true, requiredMismatches: [] });
  });
  it("does not accept an unknown profile version or invented reference kind", () => {
    const input = discovery(); input.catalog.capabilities[0]!.semanticProfile!.profileVersion = "1.2";
    expect(() => client(true).validateTrustedContracts(input)).toThrow();
    const kinds = discovery(); kinds.catalog.capabilities[0]!.semanticProfile!.acceptedReferenceKinds = ["INVENTED_KIND"];
    expect(() => client(true).validateTrustedContracts(kinds)).toThrow();
  });
  it("still recomputes the semantic catalog and exact per-operation lock hashes", () => {
    const input = discovery(); input.semantics.profiles[0]!.semanticProfile.resultNature = "VALIDATION";
    expect(() => client(true).validateTrustedContracts(input)).toThrow("SEMANTIC_CATALOG_HASH_MISMATCH");
    input.semantics.catalogHash = analysisHash(input.semantics.profiles); input.expectedSemanticCatalogHash = input.semantics.catalogHash;
    expect(client(true).validateTrustedContracts(input).requiredReady).toBe(false);
  });
  it("returns an isolated copy of the hash-verified semantic schema", () => {
    const schema = contracts.semanticProfileSchema(); schema["additionalProperties"] = true;
    expect(contracts.semanticProfileSchema()["additionalProperties"]).toBe(false);
  });
  it.each(["map-match", "cross-last", "metric-shared-campus"])("validates the full %s Gateway envelope, not only its analysis payload", name => {
    const envelope = JSON.parse(readFileSync(new URL(`../../../validation/fixtures/advanced-history/${name}.json`, import.meta.url), "utf8"));
    expect(() => new GowmConsumerSchemaRegistry({ analysisContracts: contracts })
      .validate("platform/capability-result-envelope.schema.json", envelope)).not.toThrow();
  });
  it.each([-1, 0.5, "1"])("rejects an invalid snapshot worldVersion %s", worldVersion => {
    const envelope = JSON.parse(readFileSync(new URL("../../../validation/fixtures/advanced-history/metric-shared-campus.json", import.meta.url), "utf8"));
    envelope.dataSnapshot.resources[0].worldVersion = worldVersion;
    expect(() => new GowmConsumerSchemaRegistry({ analysisContracts: contracts })
      .validate("platform/capability-result-envelope.schema.json", envelope)).toThrow();
  });
  it("accepts published snapshot resources and rejects additional resource properties", () => {
    const envelope = JSON.parse(readFileSync(new URL("../../../validation/fixtures/advanced-history/metric-shared-campus.json", import.meta.url), "utf8"));
    expect(() => new GowmConsumerSchemaRegistry().validate("platform/capability-result-envelope.schema.json", envelope)).not.toThrow();
    envelope.dataSnapshot.resources[0].untrusted = true;
    expect(() => new GowmConsumerSchemaRegistry({ analysisContracts: contracts })
      .validate("platform/capability-result-envelope.schema.json", envelope)).toThrow();
  });
});
