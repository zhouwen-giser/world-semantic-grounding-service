import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const path = fileURLToPath(new URL("../compose.yaml", import.meta.url));
const source = readFileSync(path, "utf8");
// Never inherit credentials or the developer's .env when expanding Compose.
const environment: NodeJS.ProcessEnv = { PATH: process.env["PATH"] };
for (const match of source.matchAll(/\$\{([A-Z0-9_]+):\?/gu)) environment[match[1]!] = "review-placeholder";
let available = true;
try { execFileSync("docker", ["compose", "version"], { env: environment, stdio: "ignore", timeout: 10_000 }); }
catch { available = false; }

function expand(overrides: Record<string, string> = {}) {
  return JSON.parse(execFileSync("docker", ["compose", "--env-file", "/dev/null", "-f", path, "config", "--format", "json"], {
    env: { ...environment, ...overrides }, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"]
  })).services as Record<string, { environment: Record<string, string> }>;
}

describe.skipIf(!available)("Compose runtime configuration (requires Docker Compose CLI only)", () => {
  it("keeps the new contract opt-in and sets retention defaults", () => {
    const services = expand();
    expect(services["grounding-api"]!.environment).toMatchObject({
      WSGS_WORLD_ANALYSIS_CONSUMER_PRINCIPALS_JSON: "[]", WSGS_PRIMARY_DATA_SCOPE: "", WSGS_SOURCE_RETENTION_MS: "3600000"
    });
    expect(services["grounding-worker"]!.environment).toMatchObject({
      WSGS_SOURCE_CLEANUP_INTERVAL_MS: "60000", WSGS_SOURCE_CLEANUP_BATCH_SIZE: "100"
    });
  });

  it("passes explicit allowlists, primary scope and cleanup settings into the correct service", () => {
    const services = expand({ WSGS_WORLD_ANALYSIS_CONSUMER_PRINCIPALS_JSON: '["review-consumer"]',
      WSGS_PRIMARY_DATA_SCOPE: "scope-review", WSGS_SOURCE_RETENTION_MS: "7200000",
      WSGS_SOURCE_CLEANUP_INTERVAL_MS: "30000", WSGS_SOURCE_CLEANUP_BATCH_SIZE: "25" });
    expect(services["grounding-api"]!.environment).toMatchObject({
      WSGS_WORLD_ANALYSIS_CONSUMER_PRINCIPALS_JSON: '["review-consumer"]', WSGS_PRIMARY_DATA_SCOPE: "scope-review",
      WSGS_SOURCE_RETENTION_MS: "7200000"
    });
    expect(services["grounding-worker"]!.environment).toMatchObject({
      WSGS_SOURCE_CLEANUP_INTERVAL_MS: "30000", WSGS_SOURCE_CLEANUP_BATCH_SIZE: "25"
    });
  });
});
