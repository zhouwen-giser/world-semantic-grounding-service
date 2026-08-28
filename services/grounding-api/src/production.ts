import {
  Aes256GcmPayloadCodec,
  PostgresProductionGroundingStore,
  ProductionGroundingBackend,
  type ProductionAdmissionSnapshot,
  type ScopedGroundingIdentity
} from "@wsgs/grounding-pipeline";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

import type { GroundingApiBackend } from "./types.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function integerEnvironment(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

export interface ProductionBackendResources {
  backend: GroundingApiBackend;
  close(): Promise<void>;
}

export interface ProductionReadinessProbe {
  checkReadiness(): Promise<{ ready: boolean; reasons: string[] }>;
  captureAdmissionSnapshot(context: {
    identity: ScopedGroundingIdentity;
    request: Readonly<Record<string, unknown>>;
    groundingId: string;
    jobId: string;
  }): Promise<ProductionAdmissionSnapshot>;
}

export interface ProductionBackendEnvironmentOptions {
  readinessProbe?: ProductionReadinessProbe;
}

function readinessProbeFromEnvironment(): ProductionReadinessProbe {
  const moduleSpecifier = process.env["WSGS_READINESS_MODULE"] ??
    new URL("../../grounding-worker/dist/production-module.js", import.meta.url).href;
  const importSpecifier = isAbsolute(moduleSpecifier) || moduleSpecifier.startsWith(".")
    ? pathToFileURL(resolve(moduleSpecifier)).href
    : moduleSpecifier;
  const loaded = import(importSpecifier) as Promise<Record<string, unknown>>;
  return {
    checkReadiness: async () => {
      try {
        const moduleValue = await loaded;
        const check = moduleValue["checkReadiness"];
        if (typeof check !== "function") {
          return { ready: false, reasons: ["REQUIRED_READINESS_PROBE_INVALID"] };
        }
        const result = await (check as () => unknown | Promise<unknown>)();
        if (!result || typeof result !== "object" ||
          typeof (result as Record<string, unknown>)["ready"] !== "boolean" ||
          !Array.isArray((result as Record<string, unknown>)["reasons"]) ||
          ((result as Record<string, unknown>)["reasons"] as unknown[])
            .some((reason) => typeof reason !== "string" || !reason)) {
          return { ready: false, reasons: ["REQUIRED_READINESS_PROBE_INVALID"] };
        }
        return result as { ready: boolean; reasons: string[] };
      } catch {
        return { ready: false, reasons: ["REQUIRED_READINESS_PROBE_FAILED"] };
      }
    },
    captureAdmissionSnapshot: async (context) => {
      const moduleValue = await loaded;
      const capture = moduleValue["captureAdmissionSnapshot"];
      if (typeof capture !== "function") throw new Error("Readiness module does not export captureAdmissionSnapshot()");
      return await (capture as (value: typeof context) => ProductionAdmissionSnapshot | Promise<ProductionAdmissionSnapshot>)(
        context
      );
    }
  };
}

export function createProductionBackendFromEnvironment(
  options: ProductionBackendEnvironmentOptions = {}
): ProductionBackendResources {
  const pool = new Pool({
    connectionString: required("DATABASE_URL"),
    max: integerEnvironment("WSGS_API_DATABASE_POOL_SIZE", 8, 1, 100),
    application_name: "wsgs-grounding-api"
  });
  const codec = Aes256GcmPayloadCodec.fromBase64(required("WSGS_REQUEST_ENCRYPTION_KEY_BASE64"));
  const store = new PostgresProductionGroundingStore(pool, {
    pollIntervalMs: integerEnvironment("WSGS_SYNC_POLL_INTERVAL_MS", 50, 1, 5_000)
  });
  const requiredReadiness = options.readinessProbe ?? readinessProbeFromEnvironment();
  const readiness = async (): Promise<{ ready: boolean; reasons: string[] }> => {
    const [database, capabilities] = await Promise.all([
      store.readiness(),
      requiredReadiness.checkReadiness()
    ]);
    const reasons = [...new Set([...database.reasons, ...capabilities.reasons])].sort();
    return { ready: database.ready && capabilities.ready, reasons };
  };
  const backend = new ProductionGroundingBackend({
    store,
    sealer: codec,
    readiness,
    captureAdmissionSnapshot: (context) => requiredReadiness.captureAdmissionSnapshot(context),
    capabilities: async () => {
      const currentReadiness = await readiness();
      // These values are the immutable v0.1 northbound capability contract.
      // WSGS v0.2's GOWM 0.6.3 lock is persisted inside execution records and
      // must not silently rewrite the frozen public response schema.
      return {
        service: "world-semantic-grounding-service",
        version: "0.1.0",
        contractVersion: "sacs-wsgs-grounding/1.0",
        supportedOperations: [
          "GROUND_REFERENCES",
          "COMPILE_WORLD_QUERY",
          "EXECUTE_WORLD_QUERY",
          "VALIDATE_REFERENCES"
        ],
        supportedProducts: [
          "MENTIONS",
          "REFERENCE_PRODUCTS",
          "WORLD_EVIDENCE",
          "AMBIGUITIES",
          "CAPABILITY_GAPS"
        ],
        gowmContract: {
          softwareVersion: "0.4.0",
          commit: "db575f79c874a69f65a2043a7e463338524b713d",
          sourcePackageArtifacts: 33
        },
        requiredCapabilitiesReady: currentReadiness.ready,
        optionalCapabilities: []
      };
    },
    sourceRetentionMs: integerEnvironment("WSGS_SOURCE_RETENTION_MS", 3_600_000, 1_000, 604_800_000)
  });
  return { backend, close: () => pool.end() };
}
