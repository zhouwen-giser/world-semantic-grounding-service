import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const gateway = await import("/app/dist/services/gateway/world-capability-gateway/src/index.js");
const capabilitySemantics = await import("/app/dist/services/gateway/world-capability-gateway/src/capability-semantics.js");
const contracts = await import("/app/dist/packages/platform/contract-runtime/src/index.js");
const providerSdk = await import("/app/dist/packages/platform/provider-sdk/src/index.js");

const sampleRegistryPath = "/app/config/wsgs-sample-gateway-registry.json";
const gdpsManifestPath = "/integration/gdps-manifest.json";
const baseLockPath = "/app/contracts/consumers/wsgs-southbound-operation-lock-v2.json";
const outputDirectory = "/integration-output";
const stableOperationIds = Object.freeze([
  "reference.get",
  "reference.resolve",
  "world.get-current-state",
  "world.get-geometry",
  "world.get-provenance",
  "catalog.get",
  "catalog.search",
  "spatial.find-nearby",
  "spatial.find-in-area",
  "spatial.find-intersections",
  "reference.validate",
  "result.validate"
]);
const gdpsOperationIds = Object.freeze([
  "elevation.sample",
  "hydrology.find-wetlands",
  "landcover.get-class",
  "obstacle.find-nearby",
  "terrain.find-high-ground",
  "traversability.explain",
  "traversability.find-blocked"
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function exactSha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function operationKey(value) {
  return `${value.operationId}@${value.operationVersion}`;
}

async function waitForProviders(registry, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let health = {};
  do {
    health = await registry.health();
    if (Object.values(health).every((entry) => entry.ready)) return health;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  const unavailable = Object.entries(health)
    .filter(([, entry]) => !entry.ready)
    .map(([providerId]) => providerId)
    .sort();
  throw new Error(`Providers not ready: ${unavailable.join(",")}`);
}

const sampleDeployments = await gateway.loadControlledProviderDeployments(sampleRegistryPath);
const registry = new gateway.CapabilityRegistry({ profile: "world-platform" });
for (const deployment of sampleDeployments) {
  const client = new gateway.HttpProviderClient({
    endpoint: deployment.endpoint,
    providerId: deployment.providerId,
    providerVersion: deployment.providerVersion,
    implementationDigest: deployment.implementationDigest,
    manifestHash: deployment.manifestHash,
    approvedManifest: deployment.approvedManifest,
    transportToken: required(deployment.transportTokenEnv),
    allowPlaintextPrivateNetwork: deployment.allowPlaintextPrivateNetwork,
    maximumResponseBytes: 16 * 1024 * 1024
  });
  registry.register({
    approvalId: deployment.approvalId,
    approved: true,
    endpoint: deployment.endpoint,
    allowPlaintextPrivateNetwork: deployment.allowPlaintextPrivateNetwork,
    client,
    manifest: deployment.approvedManifest
  });
}

const gdpsManifestBytes = await readFile(gdpsManifestPath);
const gdpsManifest = JSON.parse(gdpsManifestBytes.toString("utf8"));
const gdpsManifestHash = providerSdk.sha256(gdpsManifest);
if (gdpsManifestHash !== required("GDPS_APPROVED_MANIFEST_HASH")) {
  throw new Error("GDPS approved manifest hash mismatch");
}
const gdpsContract = contracts.validateContract("capability-provider-manifest.schema.json", gdpsManifest);
const gdpsSemantics = contracts.validateProviderManifestSemantics(gdpsManifest);
if (!gdpsContract.valid || !gdpsSemantics.valid) throw new Error("GDPS approved manifest is invalid");
const gdpsEndpoint = new URL("http://gdps:8090/");
const gdpsClient = new gateway.HttpProviderClient({
  endpoint: gdpsEndpoint,
  providerId: gdpsManifest.provider.providerId,
  providerVersion: gdpsManifest.provider.providerVersion,
  implementationDigest: gdpsManifest.provider.implementationDigest,
  manifestHash: gdpsManifestHash,
  approvedManifest: gdpsManifest,
  transportToken: required("GDPS_PROVIDER_TRANSPORT_TOKEN"),
  allowPlaintextPrivateNetwork: true,
  maximumResponseBytes: 16 * 1024 * 1024
});
registry.register({
  approvalId: "wsgs-gdps-v0.2-integration",
  approved: true,
  endpoint: gdpsEndpoint,
  allowPlaintextPrivateNetwork: true,
  client: gdpsClient,
  manifest: gdpsManifest
});

const circuits = new gateway.ProviderCircuitBreaker();
const records = new gateway.MemoryGatewayRecordStore();
const directExecution = new gateway.DirectExecutionService({
  registry,
  circuits,
  idempotency: new gateway.MemoryGatewayIdempotencyStore(),
  audit: new gateway.MemoryAuditSink(),
  records,
  gatewayId: "wsgs-gdps-integration-gateway",
  policyVersion: "wsgs-gdps-v0.2-integration-policy",
  attestationIssuer: "wsgs-gdps-integration-gateway"
});
const worldQueries = new gateway.WorldQueryRuntime({
  validator: new gateway.QueryPlanValidator(registry),
  directExecution,
  store: new gateway.MemoryQueryPlanStore(),
  autoRunAsync: true
});
const availability = new gateway.OperationAvailabilityService({ registry, circuits, cacheTtlMs: 1_000 });
const authConfig = {
  sharedToken: required("GOWM_WSGS_SAMPLE_TOKEN"),
  principalRef: required("GATEWAY_RUNTIME_PRINCIPAL_REF"),
  dataScopeClaim: required("GATEWAY_DATA_SCOPE_CLAIM"),
  datasetScopeClaim: required("GATEWAY_DATASET_SCOPE_CLAIM"),
  allowExperimental: false,
  authenticationMode: "SIGNED_DELEGATION_V1",
  delegationIssuer: required("GATEWAY_DELEGATION_ISSUER"),
  delegationAudience: required("GATEWAY_DELEGATION_AUDIENCE"),
  delegationPublicKey: required("GATEWAY_DELEGATION_PUBLIC_KEY").replaceAll("\\n", "\n"),
  delegationMaximumTtlSeconds: Number(required("GATEWAY_DELEGATION_MAX_TTL_SECONDS"))
};
const app = gateway.buildGatewayApp({
  registry,
  directExecution,
  authenticate: gateway.createGatewayAuthenticator(
    authConfig,
    () => registry.catalog().map(operationKey)
  ),
  records,
  worldQueries,
  availability,
  readiness: async () => Object.values(await registry.health()).every((entry) => entry.ready),
  logger: false
});

await app.listen({ host: "0.0.0.0", port: 8090 });
const providerHealth = await waitForProviders(registry);
const semanticCatalog = capabilitySemantics.projectCapabilitySemantics(
  registry.semanticDescriptors(),
  registry.contractCatalogRevision,
  registry.bindingRevision
);
const baseLock = JSON.parse(await readFile(baseLockPath, "utf8"));
const baseOperations = [...baseLock.defaultOperations, ...baseLock.previewOperations];
const stableLocks = stableOperationIds.map((operationId) => {
  const value = baseOperations.find((entry) => entry.operationId === operationId && entry.operationVersion === "1.0");
  if (!value || value.maturity !== "STABLE") throw new Error(`Stable lock missing ${operationId}@1.0`);
  return value;
});
const descriptors = registry.catalog();
const gdpsLocks = gdpsOperationIds.map((operationId) => {
  const descriptor = descriptors.find((entry) => entry.operationId === operationId && entry.operationVersion === "1.0");
  if (!descriptor || descriptor.maturity !== "PREVIEW" || !descriptor.semanticProfile) {
    throw new Error(`GDPS preview descriptor missing ${operationId}@1.0`);
  }
  return {
    operationId,
    operationVersion: descriptor.operationVersion,
    inputSchemaHash: descriptor.inputSchemaHash,
    outputSchemaHash: descriptor.outputSchemaHash,
    semanticProfileHash: contracts.canonicalSha256(descriptor.semanticProfile),
    maturity: "PREVIEW",
    requiredPermissions: ["data:read"],
    snapshotSupport: "CONSISTENT_AT_START"
  };
});
const combinedLock = {
  ...baseLock,
  contractCatalogRevision: registry.contractCatalogRevision,
  semanticCatalogHash: semanticCatalog.catalogHash,
  defaultOperations: stableLocks,
  previewOperations: gdpsLocks.sort((left, right) => operationKey(left).localeCompare(operationKey(right)))
};
const combinedLockBytes = Buffer.from(`${JSON.stringify(combinedLock, null, 2)}\n`, "utf8");
const combinedLockHash = exactSha256(combinedLockBytes);
await mkdir(outputDirectory, { recursive: true });
await writeFile(`${outputDirectory}/w26-combined-southbound-operation-lock.json`, combinedLockBytes);

const requiredKeys = [...stableLocks, ...gdpsLocks].map(operationKey).sort();
const evidencePrincipal = {
  principalRef: authConfig.principalRef,
  servicePrincipalRef: authConfig.principalRef,
  actorRef: authConfig.principalRef,
  authenticationMethod: "INTEGRATION_READINESS",
  authenticatedAt: new Date().toISOString(),
  dataScopeClaim: authConfig.dataScopeClaim,
  datasetScopeClaim: authConfig.datasetScopeClaim,
  allowedOperations: requiredKeys,
  allowExperimental: false
};
const availabilitySnapshot = await availability.list(evidencePrincipal);
const requiredAvailability = availabilitySnapshot.operations
  .filter((entry) => requiredKeys.includes(operationKey(entry)))
  .sort((left, right) => operationKey(left).localeCompare(operationKey(right)));
if (requiredAvailability.length !== requiredKeys.length || requiredAvailability.some((entry) => entry.availability !== "AVAILABLE")) {
  throw new Error("Combined Gateway required operation availability is not 19/19 AVAILABLE");
}
const runtimeEvidence = {
  schemaVersion: "wsgs-gdps-combined-gateway/1.0",
  capturedAt: new Date().toISOString(),
  executionClassification: "REAL_EXTERNAL_DEPENDENCIES",
  authenticationMode: "SIGNED_DELEGATION_V1",
  persistenceMode: "MEMORY_ISOLATED_GATEWAY",
  registry: {
    capabilityCount: descriptors.length,
    providerCount: Object.keys(providerHealth).length,
    contractCatalogRevision: registry.contractCatalogRevision,
    bindingRevision: registry.bindingRevision,
    semanticCatalogHash: semanticCatalog.catalogHash
  },
  gdps: {
    providerId: gdpsManifest.provider.providerId,
    providerVersion: gdpsManifest.provider.providerVersion,
    manifestHash: gdpsManifestHash,
    capabilityCount: gdpsManifest.capabilities.length
  },
  requiredOperations: requiredAvailability.map((entry) => ({
    operationId: entry.operationId,
    operationVersion: entry.operationVersion,
    maturity: entry.maturity,
    availability: entry.availability,
    reasonCodes: entry.reasonCodes
  })),
  exactOperationLockHash: combinedLockHash,
  providersReady: Object.keys(providerHealth).sort(),
  status: "PASS",
  marker: "WSGS_GDPS_INTEGRATION_INSTANCE_READY"
};
await writeFile(
  `${outputDirectory}/w28-integration-instance.json`,
  `${JSON.stringify(runtimeEvidence, null, 2)}\n`,
  "utf8"
);
process.stdout.write(
  `WSGS_GDPS_COMBINED_GATEWAY_READY capabilities=${descriptors.length} required=${requiredAvailability.length} lock=${combinedLockHash}\n`
);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  process.exit(0);
}
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
