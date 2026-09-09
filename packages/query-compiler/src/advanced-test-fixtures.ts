import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AnalysisProviderContracts } from "@wsgs/gowm-contract-intake";
import type { CompileInput, CapabilityDescriptor, QuerySemanticPattern } from "./types.js";

export function advancedCompileFixture(pattern: QuerySemanticPattern = "HISTORICAL_ROAD_ASSOCIATION"): CompileInput {
  const contracts = new AnalysisProviderContracts(fileURLToPath(new URL("../../../contracts/upstream/gowm-analysis-providers-current", import.meta.url)));
  const capabilities = ["map-matching", "temporal-events", "metric-ranking"].map(name => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL(`../../../contracts/upstream/gowm-analysis-providers-current/contracts/manifests/${name}-provider.json`, import.meta.url)), "utf8")) as { capabilities: CapabilityDescriptor[] };
    return manifest.capabilities[0]!;
  });
  const now = new Date().toISOString();
  return { requestId: "analysis-test-request", idempotencyKey: "analysis-test-key", pattern, requiredForProduct: "WORLD_EVIDENCE",
    operationInput: { schemaVersion: "0.1", trajectoryReferenceKey: { namespace: "gowm", kind: "HISTORICAL_TRAJECTORY", id: "wrf_fixture_trajectory", version: "1" } },
    capabilities, semanticProfiles: capabilities.map(capability => ({ operationId: capability.operationId, operationVersion: capability.operationVersion,
      semanticProfile: capability.semanticProfile!, semanticProfileHash: contracts.authorizations.find(a => a.operationId === capability.operationId)!.semanticProfileHash })),
    operationLocks: contracts.authorizations.map(a => ({ operationId: a.operationId, operationVersion: a.operationVersion,
      inputSchemaHash: a.inputSchemaHash, outputSchemaHash: a.outputSchemaHash, semanticProfileHash: a.semanticProfileHash,
      maturity: "PREVIEW", requiredPermissions: ["analysis:read"], snapshotSupport: "CONSISTENT_AT_START" })),
    availability: contracts.authorizations.map(a => ({ operationId: a.operationId, operationVersion: a.operationVersion, maturity: "PREVIEW",
      availability: "AVAILABLE", reasonCodes: [], checkedAt: now, validUntil: new Date(Date.now() + 3600000).toISOString(), contractCatalogRevision: "sha256:test", bindingRevision: "sha256:test" })),
    advancedHistoryEnabled: true, analysisProviderAuthorizations: contracts.authorizations, grantedPermissions: ["analysis:read"],
    maturityPolicy: { allowPreview: false }, parameterSchemaHash: `sha256:${"a".repeat(64)}`,
    budgets: { maximumNodes: 2, maximumDepth: 2, maximumRows: 250000, maximumCandidates: 250000, maximumOutputBytes: 1048576, maximumExecutionMs: 30000 }
  };
}
