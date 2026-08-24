import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("../..", import.meta.url)));
const sourceRoots = [join(root, "packages"), join(root, "services")];
const allowedExtensions = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"]);
const forbiddenDependency = /(?:^|[/@_-])(sdar|a2a|smpp|langgraph)(?:$|[/@_.-])/iu;
const forbiddenConfiguration = /\b(?:PROVIDER_BASE_URL|PROVIDER_URL|GOWM_DATABASE_URL|MCP_SERVER_URL|MCP_TOOL)\b/u;
const forbiddenAgentCode = /\b(?:bindTools|tool_choice|function_call)\b/u;

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
  }
  if (forbiddenConfiguration.test(text)) failures.push(`${label}: forbidden direct provider/GOWM DB/MCP configuration`);
  if (forbiddenAgentCode.test(text)) failures.push(`${label}: free tool-calling agent surface is forbidden`);
  if (path.endsWith("package.json")) {
    const manifest = JSON.parse(text);
    for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const dependency of Object.keys(manifest[section] ?? {})) {
        if (forbiddenDependency.test(dependency)) failures.push(`${label}: forbidden package ${dependency}`);
      }
    }
  }
}

if (failures.length > 0) throw new Error(`Architecture boundary violations:\n${failures.join("\n")}`);
console.log("ARCHITECTURE_BOUNDARY_PASS no_sdar=true no_a2a=true no_smpp=true no_gowm_db=true gateway_only=true no_langgraph=true");

