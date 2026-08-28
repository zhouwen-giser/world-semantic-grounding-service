import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const outputRoot = join(repositoryRoot, "reports", "wsgs-v0.2-gdps");
const jsonPath = join(outputRoot, "w20-source-baseline.json");
const markdownPath = join(outputRoot, "w20-source-baseline.md");
const write = process.argv.includes("--write");

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function gitSha(root) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validate(report) {
  assert(report.schemaVersion === "wsgs-gdps-source-baseline/1.0", "W20 schemaVersion mismatch");
  assert(report.status === "PASS", "W20 status is not PASS");
  assert(report.marker === "GDPS_INTEGRATION_BASELINE_LOCKED", "W20 marker missing");
  assert(/^[0-9a-f]{40}$/u.test(report.sources.wsgs.commit), "WSGS commit is invalid");
  assert(/^[0-9a-f]{40}$/u.test(report.sources.gowm.commit), "GOWM commit is invalid");
  assert(/^[0-9a-f]{40}$/u.test(report.sources.gdps.commit), "GDPS commit is invalid");
  assert(/^sha256:[0-9a-f]{64}$/u.test(report.gateway.contractCatalogRevision), "Gateway catalog hash is invalid");
  assert(/^sha256:[0-9a-f]{64}$/u.test(report.gateway.semanticCatalogHash), "Gateway semantic hash is invalid");
  assert(/^sha256:[0-9a-f]{64}$/u.test(report.gateway.bindingRevision), "Gateway binding hash is invalid");
  assert(report.gdps.providerId === "gdps.geospatial-products", "Unexpected GDPS provider");
  assert(report.gdps.capabilityCount === 23 && report.gdps.capabilities.length === 23, "GDPS capability count mismatch");
  assert(report.gdps.capabilities.every((entry) => entry.maturity === "PREVIEW"), "GDPS maturity drift");
  assert(report.gdps.capabilities.every((entry) => entry.snapshotSupport === "CONSISTENT_AT_START"), "GDPS snapshot policy drift");
  assert(new Set(report.gdps.capabilities.map((entry) => `${entry.operationId}@${entry.operationVersion}`)).size === 23,
    "Duplicate GDPS operation");
  assert(report.currentGateway.gdpsRegistered === false, "W20 must not claim GDPS registration");
  assert(report.currentGateway.gdpsCapabilityCount === 0, "Current Gateway unexpectedly exposes GDPS");
  assert(report.geometryBuffer.operationId === "geometry.buffer", "Geometry buffer descriptor missing");
}

async function generate() {
  const gdpsRoot = resolve(process.env.GDPS_ROOT ?? "");
  const gowmRoot = resolve(process.env.GOWM_ROOT ?? "");
  assert(process.env.GDPS_ROOT && process.env.GOWM_ROOT, "GDPS_ROOT and GOWM_ROOT are required for --write");
  const manifest = JSON.parse(readFileSync(join(gdpsRoot, "reports", "GDPS_GOWM_APPROVED_MANIFEST.json"), "utf8"));
  const baseUrl = (process.env.GOWM_GATEWAY_BASE_URL ?? "http://127.0.0.1:18063").replace(/\/$/u, "");
  const gdpsBaseUrl = (process.env.GDPS_PROVIDER_BASELINE_URL ?? "http://127.0.0.1:8090").replace(/\/$/u, "");
  const [catalogResponse, semanticsResponse, gdpsReadyResponse] = await Promise.all([
    fetch(`${baseUrl}/v1/capabilities`, { signal: AbortSignal.timeout(30_000) }),
    fetch(`${baseUrl}/v1/capability-semantics`, { signal: AbortSignal.timeout(30_000) }),
    fetch(`${gdpsBaseUrl}/health/ready`, { signal: AbortSignal.timeout(10_000) })
  ]);
  assert(catalogResponse.ok && semanticsResponse.ok && gdpsReadyResponse.ok, "Live W20 discovery failed");
  const catalog = await catalogResponse.json();
  const semantics = await semanticsResponse.json();
  const gdpsReady = await gdpsReadyResponse.json();
  const gdpsPrefixes = ["geo-product.", "elevation.", "terrain.", "landcover.", "hydrology.", "surface-material.", "obstacle.", "traversability."];
  const exposedGdps = catalog.capabilities.filter((entry) => gdpsPrefixes.some((prefix) => entry.operationId.startsWith(prefix)));
  const geometryBuffer = catalog.capabilities.find((entry) => entry.operationId === "geometry.buffer");
  assert(geometryBuffer, "Current Gateway does not describe geometry.buffer");
  const capabilities = manifest.capabilities.map((entry) => ({
    operationId: entry.operationId,
    operationVersion: entry.operationVersion,
    inputSchemaHash: entry.inputSchemaHash,
    outputSchemaHash: entry.outputSchemaHash,
    semanticProfileHash: sha256(entry.semanticProfile),
    maturity: entry.maturity,
    availability: gdpsReady.ready === true ? "PROVIDER_READY_NOT_REGISTERED" : "PROVIDER_NOT_READY",
    snapshotSupport: entry.snapshotPolicy?.dataSnapshot === "REQUIRED" ? "CONSISTENT_AT_START" : "NONE",
    providerBinding: manifest.provider.providerId
  }));
  return {
    schemaVersion: "wsgs-gdps-source-baseline/1.0",
    generatedAt: new Date().toISOString(),
    status: "PASS",
    sources: {
      wsgs: { commit: gitSha(repositoryRoot), branch: "codex/wsgs-v0.2-gdps-capability-integration" },
      gowm: { commit: gitSha(gowmRoot), softwareVersion: "0.6.3" },
      gdps: { commit: gitSha(gdpsRoot), providerVersion: manifest.provider.providerVersion }
    },
    gateway: {
      baseUrl: "http://127.0.0.1:18063",
      contractRevision: "0.6.3",
      contractCatalogRevision: catalog.contractCatalogRevision,
      semanticCatalogHash: semantics.catalogHash,
      bindingRevision: catalog.bindingRevision
    },
    currentGateway: {
      gdpsRegistered: exposedGdps.length > 0,
      gdpsCapabilityCount: exposedGdps.length,
      note: "Provider readiness is not Gateway registration or execution availability."
    },
    gdps: {
      providerId: manifest.provider.providerId,
      providerVersion: manifest.provider.providerVersion,
      implementationDigest: manifest.provider.implementationDigest,
      manifestHash: sha256(manifest),
      providerReady: gdpsReady.ready === true,
      capabilityCount: capabilities.length,
      capabilities
    },
    geometryBuffer: {
      operationId: geometryBuffer.operationId,
      operationVersion: geometryBuffer.operationVersion,
      maturity: geometryBuffer.maturity,
      inputSchemaHash: geometryBuffer.inputSchemaHash,
      outputSchemaHash: geometryBuffer.outputSchemaHash,
      descriptorVisible: true,
      executionAvailability: "REQUIRES_AUTHENTICATED_COMBINED_INSTANCE_CHECK"
    },
    decisions: {
      gatewayOnly: true,
      directGdpsAccessForbiddenInRuntime: true,
      previewRequiresExplicitRecipe: true,
      hardcodedProductIdsForbidden: true,
      currentOnlyEvidenceUsesContentHash: true
    },
    marker: "GDPS_INTEGRATION_BASELINE_LOCKED"
  };
}

if (write) {
  const report = await generate();
  validate(report);
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const markdown = `# W20 GDPS source baseline\n\n` +
    `Status: **${report.status}**\n\n` +
    `- WSGS: \`${report.sources.wsgs.commit}\`\n` +
    `- GOWM: \`${report.sources.gowm.commit}\`\n` +
    `- GDPS: \`${report.sources.gdps.commit}\`\n` +
    `- Gateway catalog: \`${report.gateway.contractCatalogRevision}\`\n` +
    `- Gateway semantics: \`${report.gateway.semanticCatalogHash}\`\n` +
    `- GDPS capabilities: ${report.gdps.capabilityCount} PREVIEW operations\n` +
    `- Current shared Gateway GDPS registration: ${report.currentGateway.gdpsRegistered ? "YES" : "NO"}\n` +
    `- Geometry buffer descriptor: ${report.geometryBuffer.descriptorVisible ? "VISIBLE" : "MISSING"}; execution is checked in W28.\n\n` +
    `Provider readiness is deliberately not treated as Gateway availability. Runtime code remains Gateway-only.\n\n` +
    `Marker: \`${report.marker}\`\n`;
  writeFileSync(markdownPath, markdown, "utf8");
} else {
  validate(JSON.parse(readFileSync(jsonPath, "utf8")));
}

console.log(`GDPS_SOURCE_BASELINE_PASS mode=${write ? "write" : "check"}`);
