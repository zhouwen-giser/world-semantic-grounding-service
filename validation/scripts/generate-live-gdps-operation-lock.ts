import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type JsonObject = Record<string, unknown>;

const root = resolve(import.meta.dirname, "..", "..");
const reportDirectory = resolve(root, "reports", "wsgs-v0.2-gdps");
const outputPath = resolve(reportDirectory, "w26-combined-southbound-operation-lock.json");
const prior = JSON.parse(readFileSync(outputPath, "utf8")) as JsonObject;
const baseUrl = (process.env["GOWM_GATEWAY_BASE_URL"] ?? "http://127.0.0.1:18063").replace(/\/$/u, "");
const write = process.argv.includes("--write");

const stableIds = [
  "reference.get", "reference.resolve", "world.get-current-state", "world.get-geometry",
  "world.get-provenance", "catalog.get", "catalog.search", "spatial.find-nearby",
  "spatial.find-in-area", "spatial.find-intersections", "reference.validate", "result.validate"
] as const;
const previewIds = [
  "elevation.sample", "hydrology.find-wetlands", "landcover.get-class", "obstacle.find-nearby",
  "terrain.find-high-ground", "traversability.explain", "traversability.find-blocked"
] as const;

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonObject;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}

async function get(path: string): Promise<JsonObject> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`LIVE_DISCOVERY_HTTP_${response.status}`);
  return object(await response.json(), "LIVE_DISCOVERY_BODY_INVALID");
}

const [catalog, semantics] = await Promise.all([
  get("/v1/capabilities"),
  get("/v1/capability-semantics")
]);
const capabilities = catalog["capabilities"];
const profiles = semantics["profiles"];
if (!Array.isArray(capabilities) || !Array.isArray(profiles)) throw new Error("LIVE_DISCOVERY_COLLECTION_INVALID");
const priorEntries = [...(prior["defaultOperations"] as unknown[]), ...(prior["previewOperations"] as unknown[])]
  .map((entry) => object(entry, "PRIOR_OPERATION_INVALID"));

function operation(operationId: string, maturity: "STABLE" | "PREVIEW"): JsonObject {
  const descriptor = capabilities.map((entry) => object(entry, "CAPABILITY_INVALID"))
    .find((entry) => entry["operationId"] === operationId && entry["operationVersion"] === "1.0");
  const profile = profiles.map((entry) => object(entry, "SEMANTIC_PROFILE_INVALID"))
    .find((entry) => entry["operationId"] === operationId && entry["operationVersion"] === "1.0");
  const expected = priorEntries.find((entry) => entry["operationId"] === operationId && entry["operationVersion"] === "1.0");
  if (!descriptor || !profile || !expected) throw new Error(`LIVE_REQUIRED_OPERATION_MISSING_${operationId}`);
  for (const field of ["inputSchemaHash", "outputSchemaHash", "maturity"] as const) {
    if (descriptor[field] !== expected[field]) throw new Error(`LIVE_OPERATION_DRIFT_${operationId}_${field}`);
  }
  if (profile["semanticProfileHash"] !== expected["semanticProfileHash"]) {
    throw new Error(`LIVE_OPERATION_DRIFT_${operationId}_semanticProfileHash`);
  }
  if (descriptor["maturity"] !== maturity) throw new Error(`LIVE_OPERATION_MATURITY_${operationId}`);
  return {
    operationId,
    operationVersion: "1.0",
    inputSchemaHash: text(descriptor["inputSchemaHash"], "INPUT_SCHEMA_HASH_MISSING"),
    outputSchemaHash: text(descriptor["outputSchemaHash"], "OUTPUT_SCHEMA_HASH_MISSING"),
    semanticProfileHash: text(profile["semanticProfileHash"], "SEMANTIC_PROFILE_HASH_MISSING"),
    maturity,
    requiredPermissions: ["data:read"],
    snapshotSupport: "CONSISTENT_AT_START"
  };
}

const lock = {
  ...prior,
  contractCatalogRevision: text(catalog["contractCatalogRevision"], "CONTRACT_REVISION_MISSING"),
  semanticCatalogHash: text(semantics["catalogHash"], "SEMANTIC_CATALOG_HASH_MISSING"),
  defaultOperations: stableIds.map((operationId) => operation(operationId, "STABLE")),
  previewOperations: previewIds.map((operationId) => operation(operationId, "PREVIEW"))
};
const bytes = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, "utf8");
const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
if (write) writeFileSync(outputPath, bytes);
process.stdout.write(`${JSON.stringify({
  marker: "WSGS_GDPS_LIVE_OPERATION_LOCK_PASS",
  mode: write ? "write" : "check",
  gatewayBaseUrlHash: `sha256:${createHash("sha256").update(baseUrl).digest("hex")}`,
  capabilityCount: capabilities.length,
  selectedStableOperations: stableIds.length,
  selectedPreviewOperations: previewIds.length,
  contractCatalogRevision: lock.contractCatalogRevision,
  semanticCatalogHash: lock.semanticCatalogHash,
  exactOperationLockHash: hash
}, null, 2)}\n`);
