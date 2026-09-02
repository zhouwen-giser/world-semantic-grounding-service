import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("../..", import.meta.url)));
const gdpsPolicy = JSON.parse(readFileSync(join(root, "config", "gdps-architecture-boundary-policy.json"), "utf8"));
const sourceRoots = gdpsPolicy.scanRoots.map((entry) => join(root, entry));
const allowedExtensions = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"]);
const forbiddenDependency = /(?:^|[/@_-])(sdar|a2a|smpp|langgraph)(?:$|[/@_.-])/iu;
const forbiddenConfiguration = /\b(?:PROVIDER_BASE_URL|PROVIDER_URL|GOWM_DATABASE_URL|MCP_SERVER_URL|MCP_TOOL)\b/u;
const forbiddenGdpsDependency = /(?:^|[/@_-])(?:gdps-client|geospatial-product-client|gdps-adapter)(?:$|[/@_.-])/iu;
const forbiddenGdpsConfiguration = /\b(?:GDPS_BASE_URL|GDPS_PROVIDER_URL|GDPS_DATABASE_URL|GDPS_POSTGRES_URL|GDPS_REST_ENDPOINT)\b/u;
const forbiddenGdpsSql = /\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:gdps(?:_live_sample)?\.|wsgs_gdps_|gdps_product(?:_version|_catalog)?\b)/iu;
const forbiddenDirectGdpsFetch = /\bfetch\s*\(\s*(?:process\.env\.)?(?:GDPS_[A-Z0-9_]*URL|gdps(?:Provider|Base|Endpoint)Url)\b/u;
const forbiddenAgentCode = /\b(?:bindTools|tool_choice|function_call)\b/u;
const forbiddenPrefixAuthorization = /\.startsWith\(\s*["']GDPS_/u;
const internalFindingRuntimeAdapter = "@wsgs/northbound-geospatial-findings/internal/runtime-assembly";
const allowedFindingRuntimeImporter = "services/grounding-worker/src/production-module.ts";

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "dist" || entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : allowedExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

const failures = [];
for (const path of sourceRoots.flatMap(files)) {
  const label = relative(root, path).replaceAll("\\", "/");
  const text = readFileSync(path, "utf8");
  for (const match of text.matchAll(/(?:from\s+|import\s*\(|require\s*\()["']([^"']+)["']/gu)) {
    const specifier = match[1] ?? "";
    if (forbiddenDependency.test(specifier)) failures.push(`${label}: forbidden dependency ${specifier}`);
    if (forbiddenGdpsDependency.test(specifier)) failures.push(`${label}: forbidden direct GDPS dependency ${specifier}`);
    if (specifier === internalFindingRuntimeAdapter && label !== allowedFindingRuntimeImporter) {
      failures.push(`${label}: internal finding runtime adapter importer is not allowlisted`);
    }
  }
  if (forbiddenConfiguration.test(text)) failures.push(`${label}: forbidden direct provider/GOWM DB/MCP configuration`);
  if (forbiddenGdpsConfiguration.test(text)) failures.push(`${label}: forbidden direct GDPS endpoint/database configuration`);
  if (forbiddenGdpsSql.test(text)) failures.push(`${label}: forbidden direct GDPS SQL access`);
  if (forbiddenDirectGdpsFetch.test(text)) failures.push(`${label}: forbidden direct GDPS HTTP call`);
  if (forbiddenPrefixAuthorization.test(text)) failures.push(`${label}: forbidden prefix-based GDPS authorization`);
  if (forbiddenAgentCode.test(text)) failures.push(`${label}: free tool-calling agent surface is forbidden`);
  if (path.endsWith("package.json")) {
    const manifest = JSON.parse(text);
    for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const dependency of Object.keys(manifest[section] ?? {})) {
        if (forbiddenDependency.test(dependency)) failures.push(`${label}: forbidden package ${dependency}`);
        if (forbiddenGdpsDependency.test(dependency)) failures.push(`${label}: forbidden direct GDPS package ${dependency}`);
      }
    }
  }
}

const plannerProduction = files(join(root, "packages", "requirement-planner", "src"))
  .filter((path) => !path.endsWith(".test.ts"));
for (const path of plannerProduction) {
  const label = relative(root, path).replaceAll("\\", "/");
  const text = readFileSync(path, "utf8");
  for (const prefix of gdpsPolicy.plannerForbiddenOperationPrefixes) {
    if (text.includes(prefix)) failures.push(`${label}: planner contains forbidden operation prefix ${prefix}`);
  }
}

const descriptorConsumerProduction = files(join(root, "packages", "gdps-descriptor-consumer", "src"))
  .filter((path) => !path.endsWith(".test.ts"));
for (const path of descriptorConsumerProduction) {
  const label = relative(root, path).replaceAll("\\", "/");
  const text = readFileSync(path, "utf8");
  if (/\b(?:fetch|XMLHttpRequest|Pool|Client)\s*\(/u.test(text) || /\bDATABASE_URL\b/u.test(text)) {
    failures.push(`${label}: descriptor consumer must remain pure contract logic`);
  }
}

if (failures.length > 0) throw new Error(`Architecture boundary violations:\n${failures.join("\n")}`);
console.log("ARCHITECTURE_BOUNDARY_PASS no_sdar=true no_a2a=true no_smpp=true no_gowm_db=true gateway_only=true no_direct_gdps=true no_prefix_auth=true planner_operation_free=true descriptor_consumer_pure=true finding_runtime_importer_locked=true no_langgraph=true");

