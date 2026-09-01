import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";

type JsonObject = Record<string, unknown>;

const root = process.cwd();
const gdpsRoot = process.env["GDPS_V032_SOURCE_ROOT"] === undefined
  ? resolve(root, "..", "geospatial-data-product-service-v0.3.2")
  : resolve(process.env["GDPS_V032_SOURCE_ROOT"]!);
const handoffRoot = join(gdpsRoot, "handoff", "gdps-v0.3.2");
const catalogPath = join(root, "contracts", "integrations", "gdps", "wsgs-gdps-binding-catalog.json");
const reportPath = join(root, "reports", "wsgs-gdps-v0.3.2", "WSGS_GDPS_HANDOFF_INTAKE_REPORT.json");
const writeCatalog = process.argv.includes("--write-catalog") || process.argv.includes("--write");
const writeReport = process.argv.includes("--write");
const expectedFiles = [
  "CHECKSUMS.json", "GDPS_BINDING_CANDIDATE.json", "GDPS_CAPABILITY_LOCK.json", "GDPS_CONSUMER_LOCK.json",
  "GDPS_CONTRACT_BYTE_LOCK.json", "GDPS_DESCRIPTOR_LOCK.json", "GDPS_OPERATIONAL_RUNTIME_LOCK.json",
  "GDPS_REAL_DATA_COVERAGE_LOCK.json", "GDPS_REAL_DATA_TRUTH_LOCK.json", "GOWM_GATEWAY_CONTRACT_LOCK.json",
  "STAS_AUTHORITY_LOCK.json"
].sort();
if (JSON.stringify(readdirSync(handoffRoot).sort()) !== JSON.stringify(expectedFiles)) throw new Error("V032_HANDOFF_INVENTORY_MISMATCH");

const checksums = json(join(handoffRoot, "CHECKSUMS.json"));
const checksumEntries = array(checksums["files"]).map(record);
if (checksumEntries.length !== 10) throw new Error("V032_CHECKSUM_COUNT_MISMATCH");
for (const entry of checksumEntries) {
  const path = String(entry["path"]);
  const bytes = readFileSync(join(handoffRoot, path));
  if (bytes.byteLength !== entry["bytes"] || hash(bytes) !== entry["sha256"]) throw new Error(`V032_HANDOFF_BYTE_DRIFT:${path}`);
}
const bundlePreimage = Object.fromEntries(checksumEntries.map((entry) => [String(entry["path"]), String(entry["sha256"])]));
if (canonicalHash(bundlePreimage) !== checksums["bundleHash"]) throw new Error("V032_BUNDLE_HASH_MISMATCH");

const consumer = json(join(handoffRoot, "GDPS_CONSUMER_LOCK.json"));
const capabilities = json(join(handoffRoot, "GDPS_CAPABILITY_LOCK.json"));
const descriptors = json(join(handoffRoot, "GDPS_DESCRIPTOR_LOCK.json"));
const candidate = json(join(handoffRoot, "GDPS_BINDING_CANDIDATE.json"));
const gateway = json(join(handoffRoot, "GOWM_GATEWAY_CONTRACT_LOCK.json"));
const coverage = json(join(handoffRoot, "GDPS_REAL_DATA_COVERAGE_LOCK.json"));
const stas = json(join(handoffRoot, "STAS_AUTHORITY_LOCK.json"));
if (consumer["status"] !== "CANDIDATE_READY_FOR_WSGS_INTAKE" || capabilities["operationCount"] !== 30 ||
    descriptors["profileCount"] !== 35 || candidate["operationFamilyCount"] !== 10 || candidate["semanticBindingCount"] !== 88) {
  throw new Error("V032_HANDOFF_CONTRACT_COUNTS_INVALID");
}
const consumerSources = record(consumer["sources"]);
if (consumerSources["gdpsSha"] !== checksums["sourceSha"] ||
    consumerSources["gdpsImplementationTreeHash"] !== checksums["implementationTreeHash"]) throw new Error("V032_GDPS_SOURCE_CROSS_LOCK_MISMATCH");

const operationById = new Map(array(capabilities["operations"]).map((value) => {
  const item = record(value);
  return [String(item["operationId"]), item] as const;
}));
const descriptorById = new Map(array(descriptors["descriptors"]).map((value) => {
  const item = record(value);
  return [String(item["descriptorId"]), item] as const;
}));
const familyQueryProfile: Record<string, string> = {
  CURRENT_PRODUCT_GET: "GET", CURRENT_PRODUCT_SEARCH: "SEARCH", CURRENT_PRODUCT_CHECK: "CHECK_CURRENT",
  CURRENT_RASTER_SAMPLE: "SAMPLE", CURRENT_RASTER_PROFILE: "PROFILE", CURRENT_RASTER_FIND_CLASS: "FIND_CLASS",
  CURRENT_RASTER_FIND_RANGE: "FIND_RANGE", CURRENT_VECTOR_IN_AREA: "IN_AREA", CURRENT_VECTOR_NEARBY: "NEARBY",
  CURRENT_VECTOR_INTERSECTS: "INTERSECTS"
};
const requirementKind: Record<string, string> = {
  SAMPLE_VALUE: "POINT_VALUE", SAMPLE_CLASS: "POINT_CLASSIFICATION", PROFILE_VALUE: "PROFILE",
  FIND_CLASS: "CLASS_AREAS", FIND_VALUE_RANGE: "VALUE_RANGE_AREAS", VECTOR_IN_AREA: "FEATURES_IN_AREA",
  VECTOR_NEARBY: "FEATURES_NEARBY", VECTOR_INTERSECTS: "INTERSECTIONS"
};
const families = array(candidate["operationFamilies"]).map((value) => {
  const item = record(value);
  const operation = operationById.get(String(item["operationId"]));
  if (operation === undefined) throw new Error("V032_BINDING_OPERATION_MISSING");
  for (const key of ["operationVersion", "inputSchemaHash", "outputSchemaHash", "semanticProfileHash"] as const) {
    if (item[key] !== operation[key]) throw new Error(`V032_BINDING_OPERATION_DRIFT:${String(item["familyId"])}:${key}`);
  }
  return {
    ...item,
    queryProfile: familyQueryProfile[String(item["familyId"])],
    timeSemantics: "CURRENT"
  };
});
const familyById = new Map(families.map((item) => [String(item.familyId), item] as const));
const bindings = array(candidate["semanticBindings"]).map((value) => {
  const item = record(value);
  const family = familyById.get(String(item["operationFamily"]));
  const descriptor = descriptorById.get(String(item["descriptorId"]));
  if (family === undefined || descriptor === undefined) throw new Error("V032_BINDING_REFERENCE_MISSING");
  if (item["descriptorHash"] !== descriptor["descriptorHash"] ||
      item["productType"] !== descriptor["productType"] || item["productProfile"] !== descriptor["productProfile"] ||
      !array(descriptor["queryProfiles"]).includes(item["queryProfile"])) throw new Error("V032_BINDING_DESCRIPTOR_DRIFT");
  return {
    bindingId: item["candidateBindingId"],
    requirementKind: requirementKind[String(item["queryProfile"])],
    requirementVersion: "1.0",
    operationId: family.operationId,
    operationVersion: family.operationVersion,
    familyId: family.familyId,
    productType: item["productType"], productProfile: item["productProfile"], descriptorId: item["descriptorId"],
    descriptorHash: item["descriptorHash"], queryProfile: item["queryProfile"], platformProfilePolicy: item["platformProfilePolicy"],
    inputSchemaHash: family.inputSchemaHash, outputSchemaHash: family.outputSchemaHash,
    semanticProfileHash: family.semanticProfileHash, allowedMaturity: family.allowedMaturity,
    selectionPolicy: {
      defaultProductId: null, explicitProductId: "TRUSTED_EXPLICIT_SELECTION_ONLY", requiresFullCoverage: true,
      scopePolicy: "CURRENT_SCOPE_AUTHORIZED_DESCRIPTOR_MATCH"
    },
    timeSemantics: "CURRENT", noDataSemantics: "EXPLICIT_GAP",
    evidenceMapping: {
      dataSnapshot: "REQUIRED", executionReceipt: "REQUIRED", contentHash: "REQUIRED", descriptorHash: "REQUIRED",
      temporalApplicability: "CURRENT_AT_QUERY_START"
    }
  };
});
const catalog = {
  schemaVersion: "wsgs-gdps-binding-catalog/1.0", authority: "WSGS",
  policy: {
    defaultProductIdBinding: "FORBIDDEN", explicitUserProductSelection: "ALLOWED", requiresExactSchemaHashes: true,
    requiresExactSemanticHash: true, requiresExactDescriptorHash: true, historicalFallback: "FORBIDDEN"
  },
  operationFamilies: families,
  bindings
};
validateCatalog(catalog);
const catalogSchema = json(join(root, "contracts", "integrations", "gdps", "wsgs-gdps-binding-catalog.schema.json"));
const validateSchema = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(catalogSchema);
if (!validateSchema(catalog)) throw new Error(`V032_BINDING_CATALOG_SCHEMA_INVALID:${JSON.stringify(validateSchema.errors)}`);
emit(catalogPath, catalog, writeCatalog, "V032_BINDING_CATALOG_DRIFT");

const negativeCases = [
  reject("DEFAULT_PRODUCT_ID", (copy) => { record(array(copy["bindings"])[0])["selectionPolicy"] = { ...record(record(array(copy["bindings"])[0])["selectionPolicy"]), defaultProductId: "forbidden" }; }),
  reject("UNKNOWN_FAMILY", (copy) => { record(array(copy["bindings"])[0])["familyId"] = "UNKNOWN"; }),
  reject("DESCRIPTOR_HASH_DRIFT", (copy) => { record(array(copy["bindings"])[0])["descriptorHash"] = `sha256:${"0".repeat(64)}`; }),
  reject("INPUT_SCHEMA_HASH_DRIFT", (copy) => { record(array(copy["bindings"])[0])["inputSchemaHash"] = `sha256:${"0".repeat(64)}`; }),
  reject("MATURITY_ESCALATION", (copy) => { record(array(copy["bindings"])[0])["allowedMaturity"] = ["STABLE"]; }),
  reject("HISTORICAL_FALLBACK", (copy) => { record(copy["policy"])["historicalFallback"] = "ALLOWED"; })
];
const currentHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const exactSource = consumerSources["wsgsSha"] === currentHead;
const report = {
  schemaVersion: "wsgs-gdps-v032-handoff-intake-report/1.0",
  status: exactSource ? "PASS" : "BLOCKED",
  provenance: "AUTHORITATIVE_GDPS_HANDOFF_CONSUMED_BY_WSGS",
  sourceTuple: {
    gdpsSha: consumerSources["gdpsSha"], gdpsImplementationTreeHash: consumerSources["gdpsImplementationTreeHash"],
    wsgsSha: consumerSources["wsgsSha"], currentWsgsHead: currentHead,
    gowmSha: consumerSources["gowmSha"], stasSha: consumerSources["stasSha"]
  },
  handoff: { inventoryCount: 11, businessFileCount: 10, bundleHash: checksums["bundleHash"] },
  locks: {
    providerManifestHash: record(consumer["provider"])["manifestHash"],
    descriptorRegistryHash: record(consumer["provider"])["descriptorRegistryHash"],
    realDataCoverageLockHash: canonicalHash(coverage), gowmGatewayContractLockHash: canonicalHash(gateway),
    stasAuthorityLockHash: canonicalHash(stas), catalogHash: canonicalHash(catalog)
  },
  catalog: { authority: "WSGS", operationFamilyCount: families.length, bindingCount: bindings.length, defaultProductIdBinding: "FORBIDDEN" },
  negativeCases,
  runtimeQualification: "NOT_RUN",
  blockers: exactSource ? [] : ["GDPS_HANDOFF_WSGS_SOURCE_LOCK_NOT_CURRENT"],
  credentialMaterialIncluded: false
};
if (!(writeCatalog && !writeReport)) emit(reportPath, report, writeReport, "V032_INTAKE_REPORT_DRIFT");
console.log(`WSGS_GDPS_V032_INTAKE_${String(report.status)} families=${families.length} bindings=${bindings.length} bundle=${String(checksums["bundleHash"])}`);

function validateCatalog(value: JsonObject): void {
  const policy = record(value["policy"]);
  if (value["schemaVersion"] !== "wsgs-gdps-binding-catalog/1.0" || value["authority"] !== "WSGS" ||
      policy["defaultProductIdBinding"] !== "FORBIDDEN" || policy["historicalFallback"] !== "FORBIDDEN") throw new Error("V032_CATALOG_POLICY_INVALID");
  const familyMap = new Map(array(value["operationFamilies"]).map((entry) => [String(record(entry)["familyId"]), record(entry)]));
  if (familyMap.size !== 10) throw new Error("V032_CATALOG_FAMILY_COUNT_INVALID");
  for (const raw of array(value["bindings"])) {
    const item = record(raw); const family = familyMap.get(String(item["familyId"])); const descriptor = descriptorById.get(String(item["descriptorId"]));
    if (family === undefined || descriptor === undefined || item["descriptorHash"] !== descriptor["descriptorHash"]) throw new Error("V032_CATALOG_BINDING_REFERENCE_INVALID");
    for (const key of ["operationId", "operationVersion", "inputSchemaHash", "outputSchemaHash", "semanticProfileHash", "allowedMaturity"] as const) {
      if (JSON.stringify(item[key]) !== JSON.stringify(family[key])) throw new Error(`V032_CATALOG_BINDING_LOCK_DRIFT:${key}`);
    }
    const selection = record(item["selectionPolicy"]);
    if (selection["defaultProductId"] !== null || selection["scopePolicy"] !== "CURRENT_SCOPE_AUTHORIZED_DESCRIPTOR_MATCH" ||
        item["timeSemantics"] !== "CURRENT" || item["noDataSemantics"] !== "EXPLICIT_GAP") throw new Error("V032_CATALOG_BINDING_POLICY_INVALID");
  }
}

function reject(id: string, mutate: (copy: JsonObject) => void) {
  const copy = structuredClone(catalog) as JsonObject; mutate(copy); let rejected = false;
  try { validateCatalog(copy); } catch { rejected = true; }
  if (!rejected) throw new Error(`V032_NEGATIVE_FAIL_OPEN:${id}`);
  return { id, status: "PASS_FAIL_CLOSED" };
}

function emit(path: string, value: unknown, write: boolean, code: string): void {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (write) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content, "utf8"); }
  else if (readFileSync(path, "utf8").replaceAll("\r\n", "\n") !== content) throw new Error(code);
}
function hash(value: Buffer): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function canonicalHash(value: unknown): string { return hash(Buffer.from(JSON.stringify(canonical(value)), "utf8")); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  const item = value as JsonObject;
  return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])]));
}
function json(path: string): JsonObject { return JSON.parse(readFileSync(path, "utf8")) as JsonObject; }
function record(value: unknown): JsonObject { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("V032_OBJECT_REQUIRED"); return value as JsonObject; }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error("V032_ARRAY_REQUIRED"); return value; }
