import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const clean = { PATH: process.env["PATH"] };
let compose = true;
try { execFileSync("docker", ["compose", "version"], { env: clean, stdio: "ignore" }); } catch { compose = false; }

it("inventories every runtime and Compose configuration option", () => {
  expect(() => execFileSync(process.execPath, ["validation/scripts/check-env-coverage.mjs"], { stdio: "ignore" })).not.toThrow();
});

it("initializes fresh anonymous development secrets once and refuses overwrites", () => {
  const dir = mkdtempSync(join(tmpdir(), "wsgs-init-"));
  const file = join(dir, "dev.env");
  try {
    execFileSync("bash", ["deploy-dev.sh", "--init", "--env-file", file], { stdio: ["ignore", "pipe", "pipe"] });
    const first = readFileSync(file, "utf8");
    expect(first).toContain("WSGS_AUTH_MODE=STATIC_TRUSTED");
    expect(first).toContain("WSGS_API_BIND_ADDRESS=0.0.0.0");
    expect(first).not.toContain("REPLACE_WITH_BASE64_OF_32_RANDOM_BYTES");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(() => execFileSync("bash", ["deploy-dev.sh", "--init", "--env-file", file], { stdio: ["ignore", "pipe", "pipe"] })).toThrow();
    expect(readFileSync(file, "utf8")).toBe(first);
  } finally { rmSync(dir, { recursive: true }); }
});

describe.skipIf(!compose)("configuration loading", () => {
  it("loads optional runtime settings, JSON, native env and port bindings from the selected file", () => {
    const dir = mkdtempSync(join(tmpdir(), "wsgs-env-"));
    const file = join(dir, "custom.env");
    const additions = {
      WSGS_ENV_FILE: file, WSGS_AUTH_MODE: "STATIC_TRUSTED", WSGS_API_BIND_ADDRESS: "0.0.0.0", PORT: "9090",
      WSGS_API_PORT: "19090", WSGS_STATIC_SERVICE_PRINCIPAL_ID: "dev-service", WSGS_STATIC_ACTOR_ID: "dev-actor",
      WSGS_STATIC_DATA_SCOPES: "scope-a,scope-b", WSGS_WORKER_LEASE_MS: "45000", WSGS_API_DATABASE_POOL_SIZE: "13",
      WSGS_MIGRATION_CONNECT_TIMEOUT_MS: "20000", WSGS_PIPELINE_SEMANTIC_MODEL_PARSE_ATTEMPT_TIMEOUT_MS: "180000",
      WSGS_WORLD_ANALYSIS_CONSUMER_PRINCIPALS_JSON: '["dev-service"]'
    };
    try {
      const original = readFileSync(".env.example", "utf8").split("\n").filter(line => !Object.keys(additions).some(k => line.startsWith(k + "="))).join("\n");
      writeFileSync(file, original + "\n" + Object.entries(additions).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
      const config = JSON.parse(execFileSync("docker", ["compose", "--env-file", file, "-f", resolve("compose.yaml"), "config", "--format", "json"], { env: clean, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
      expect(config.services["grounding-api"].environment).toMatchObject(additions);
      expect(config.services["grounding-worker"].environment.WSGS_WORKER_LEASE_MS).toBe("45000");
      expect(config.services["wsgs-migrate"].environment.WSGS_MIGRATION_CONNECT_TIMEOUT_MS).toBe("20000");
      expect(config.services["grounding-api"].ports[0]).toMatchObject({ host_ip: "0.0.0.0", published: "19090", target: 9090 });
      const captured = join(dir, "native.json");
      execFileSync(process.execPath, ["--env-file=" + file, "-e", "require('node:fs').writeFileSync(process.argv[1],JSON.stringify(process.env))", captured], { env: clean, stdio: "ignore" });
      const native = JSON.parse(readFileSync(captured, "utf8"));
      expect(native).toMatchObject(additions);
      execFileSync(process.execPath, ["--env-file=" + file, "-e", "require('node:fs').writeFileSync(process.argv[1],process.env.PORT)", captured], { env: { ...clean, PORT: "7777" }, stdio: "ignore" });
      expect(readFileSync(captured, "utf8")).toBe("7777");
    } finally { rmSync(dir, { recursive: true }); }
  });
});
