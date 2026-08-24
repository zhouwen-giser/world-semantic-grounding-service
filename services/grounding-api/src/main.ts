import { readFileSync, readdirSync } from "node:fs";
import { createGroundingApi } from "./server.js";
import type { ApiAuthConfig, GroundingApiBackend, GroundingIdentity } from "./types.js";

const schemaDirectory = new URL("../../../contracts/wsgs-v0.1/contracts/", import.meta.url);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function authFromEnvironment(): ApiAuthConfig {
  const mode = process.env["WSGS_AUTH_MODE"] ?? "JWT_SERVICE";
  if (mode === "STATIC_TRUSTED") {
    return {
      mode,
      identity: {
        principalId: required("WSGS_STATIC_PRINCIPAL_ID"),
        actor: required("WSGS_STATIC_ACTOR"),
        dataScope: required("WSGS_STATIC_DATA_SCOPE"),
        permissions: ["grounding.read"]
      }
    };
  }
  if (mode !== "JWT_SERVICE") throw new Error("WSGS_AUTH_MODE must be JWT_SERVICE or STATIC_TRUSTED");
  const secret = new TextEncoder().encode(required("WSGS_JWT_HS256_SECRET"));
  if (secret.byteLength < 32) throw new Error("WSGS_JWT_HS256_SECRET must contain at least 32 UTF-8 bytes");
  return {
    mode,
    key: secret,
    issuer: required("WSGS_JWT_ISSUER"),
    audience: process.env["WSGS_JWT_AUDIENCE"] ?? "wsgs"
  };
}

export function loadFrozenSchemas(): Record<string, unknown> {
  return Object.fromEntries(readdirSync(schemaDirectory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name, JSON.parse(readFileSync(new URL(name, schemaDirectory), "utf8")) as unknown]));
}

class FailClosedDeploymentBackend implements GroundingApiBackend {
  async readiness(): Promise<{ ready: boolean; reasons: string[] }> {
    return { ready: false, reasons: ["GROUNDING_PIPELINE_NOT_CONFIGURED"] };
  }

  async capabilities(_identity: GroundingIdentity): Promise<unknown> {
    return {
      service: "world-semantic-grounding-service",
      version: "0.1.0",
      contractVersion: "sacs-wsgs-grounding/1.0",
      supportedOperations: ["GROUND_REFERENCES", "COMPILE_WORLD_QUERY", "EXECUTE_WORLD_QUERY", "VALIDATE_REFERENCES"],
      supportedProducts: ["MENTIONS", "REFERENCE_PRODUCTS", "WORLD_EVIDENCE", "AMBIGUITIES", "CAPABILITY_GAPS"],
      gowmContract: {
        softwareVersion: "0.4.0",
        commit: "db575f79c874a69f65a2043a7e463338524b713d",
        sourcePackageArtifacts: 33
      },
      requiredCapabilitiesReady: false,
      optionalCapabilities: []
    };
  }

  async create(): Promise<never> {
    throw new Error("Grounding pipeline is not configured");
  }

  async get(): Promise<null> {
    return null;
  }

  async cancel(): Promise<null> {
    return null;
  }
}

const port = Number(process.env["PORT"] ?? "8080");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be an integer from 1 through 65535");

const app = await createGroundingApi({
  auth: authFromEnvironment(),
  backend: new FailClosedDeploymentBackend(),
  schemas: loadFrozenSchemas(),
  logger: true
});

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, "shutdown requested");
  await app.close();
}

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });

await app.listen({ host: "0.0.0.0", port });
