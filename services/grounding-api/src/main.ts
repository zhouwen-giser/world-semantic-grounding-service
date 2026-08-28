import { readFileSync, readdirSync } from "node:fs";
import { createGroundingIdentity } from "@wsgs/delegated-identity";
import { createProductionBackendFromEnvironment } from "./production.js";
import { createGroundingApi } from "./server.js";
import type { ApiAuthConfig } from "./types.js";

const schemaDirectory = new URL("../../../contracts/wsgs-v0.1/contracts/", import.meta.url);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function requiredEither(preferred: string, legacy: string): string {
  return process.env[preferred] ?? process.env[legacy] ?? required(preferred);
}

function environmentList(plural: string, singular: string, allowMissing: boolean): string[] {
  const pluralValue = process.env[plural];
  const singularValue = process.env[singular];
  if (pluralValue !== undefined && singularValue !== undefined) {
    throw new Error(`${plural} and ${singular} cannot both be set`);
  }
  if (pluralValue !== undefined) return pluralValue.split(",").map((value) => value.trim());
  if (singularValue !== undefined) return [singularValue];
  if (allowMissing) return [];
  return [required(plural)];
}

export function authFromEnvironment(): ApiAuthConfig {
  const mode = process.env["WSGS_AUTH_MODE"] ?? "JWT_SERVICE";
  if (mode === "STATIC_TRUSTED") {
    return {
      mode,
      identity: createGroundingIdentity({
        servicePrincipalId: requiredEither("WSGS_STATIC_SERVICE_PRINCIPAL_ID", "WSGS_STATIC_PRINCIPAL_ID"),
        actorId: requiredEither("WSGS_STATIC_ACTOR_ID", "WSGS_STATIC_ACTOR"),
        dataScopes: environmentList("WSGS_STATIC_DATA_SCOPES", "WSGS_STATIC_DATA_SCOPE", false),
        datasetScopes: environmentList("WSGS_STATIC_DATASET_SCOPES", "WSGS_STATIC_DATASET_SCOPE", true),
        permissions: process.env["WSGS_STATIC_PERMISSIONS"]?.split(/[ ,]+/u).filter(Boolean) ?? ["grounding.read"]
      })
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

const port = Number(process.env["PORT"] ?? "8080");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be an integer from 1 through 65535");

const production = createProductionBackendFromEnvironment();
const app = await createGroundingApi({
  auth: authFromEnvironment(),
  backend: production.backend,
  schemas: loadFrozenSchemas(),
  logger: true
});

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, "shutdown requested");
  await app.close();
  await production.close();
}

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });

await app.listen({ host: "0.0.0.0", port });
