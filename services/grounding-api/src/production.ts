import {
  Aes256GcmPayloadCodec,
  isSacsGeospatialContract,
  PostgresProductionGroundingStore,
  ProductionGroundingBackend,
  SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION,
  type GroundingContractSelection,
  type ProductionAdmissionSnapshot,
  type ScopedGroundingIdentity
} from "@wsgs/grounding-pipeline";
import {
  StructuredSelectionTokenCodec,
  StructuredWorldSelectionResolver,
  type PriorGroundingResult,
  type ResolveWorldSelectionRequest
} from "@wsgs/structured-world-selection";
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

function structuredSelectionResolverFromEnvironment(): StructuredWorldSelectionResolver | undefined {
  const activeKeyId = process.env["WSGS_SELECTION_ACTIVE_KEY_ID"];
  const keysJson = process.env["WSGS_SELECTION_KEYS_JSON"];
  const configured = activeKeyId !== undefined || keysJson !== undefined;
  if (!configured) return undefined;
  if (!activeKeyId || !keysJson) {
    throw new Error("Structured selection key configuration is incomplete");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(keysJson) as unknown;
  } catch {
    throw new Error("WSGS_SELECTION_KEYS_JSON must contain a JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("WSGS_SELECTION_KEYS_JSON must contain a JSON object");
  }
  const keys = Object.entries(parsed).map(([keyId, encoded]) => {
    if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]{43}=$/u.test(encoded)) {
      throw new Error("WSGS_SELECTION_KEYS_JSON contains an invalid key");
    }
    const key = Buffer.from(encoded, "base64");
    if (key.byteLength !== 32 || key.toString("base64") !== encoded) {
      throw new Error("WSGS_SELECTION_KEYS_JSON contains an invalid key");
    }
    return { keyId, key };
  });
  if (keys.length < 1 || keys.length > 16) throw new Error("Structured selection key ring size is invalid");
  return new StructuredWorldSelectionResolver(new StructuredSelectionTokenCodec({
    activeKeyId,
    keys,
    ttlMs: integerEnvironment("WSGS_SELECTION_TTL_MS", 300_000, 1_000, 86_400_000)
  }));
}

function priorGroundingResult(value: unknown): PriorGroundingResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const presentation = value as Record<string, unknown>;
  const result = presentation["result"];
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const record = result as Record<string, unknown>;
  const extension = record["geospatialFindings"];
  if (!extension || typeof extension !== "object" || Array.isArray(extension)) return null;
  const geospatial = extension as Record<string, unknown>;
  if (typeof record["groundingId"] !== "string" || typeof record["resultHash"] !== "string" ||
    !Array.isArray(geospatial["findings"]) || !Array.isArray(geospatial["sourceProducts"])) return null;
  return {
    groundingId: record["groundingId"],
    resultHash: record["resultHash"],
    geospatialFindings: {
      findings: geospatial["findings"] as Readonly<Record<string, unknown>>[],
      sourceProducts: geospatial["sourceProducts"] as Readonly<Record<string, unknown>>[]
    }
  };
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

const authorityIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;

/**
 * Reads the server-owned primary data scope used when an authenticated
 * principal carries more than one authorized scope. The request body never
 * participates in this selection.
 */
export function primaryDataScopeFromEnvironment(
  environment: Readonly<NodeJS.ProcessEnv> = process.env
): string | undefined {
  const value = environment["WSGS_PRIMARY_DATA_SCOPE"];
  if (value === undefined) return undefined;
  if (!authorityIdentifierPattern.test(value)) {
    throw new Error("WSGS_PRIMARY_DATA_SCOPE must be one exact authority identifier");
  }
  return value;
}

/**
 * Builds the exact public capability projection selected at the authenticated
 * API boundary. Keeping this pure makes both the legacy freeze and the staged
 * 1.1 readiness boundary independently testable without a database.
 */
export function groundingCapabilitiesForSelection(
  contractSelection: GroundingContractSelection,
  currentReadiness: Readonly<{ ready: boolean; reasons: readonly string[] }>,
  phaseReadiness: Readonly<{ structuredSelection: boolean; currentness: boolean }> = {
    structuredSelection: false,
    currentness: false
  }
): Readonly<Record<string, unknown>> {
  if (isSacsGeospatialContract(contractSelection)) {
    return Object.freeze({
      service: "world-semantic-grounding-service",
      version: "0.2.1",
      contractVersion: "sacs-wsgs-grounding/1.1",
      supportedOperations: Object.freeze([
        "GROUND_REFERENCES",
        "COMPILE_WORLD_QUERY",
        "EXECUTE_WORLD_QUERY",
        "VALIDATE_REFERENCES",
        "RESOLVE_WORLD_SELECTION",
        "VALIDATE_SOURCE_CURRENTNESS"
      ]),
      supportedProducts: Object.freeze([
        "MENTIONS",
        "REFERENCE_PRODUCTS",
        "WORLD_EVIDENCE",
        "AMBIGUITIES",
        "CAPABILITY_GAPS",
        "GEOSPATIAL_FINDINGS",
        "SOURCE_PRODUCTS",
        "TYPED_GAPS"
      ]),
      supportedResultProfiles: Object.freeze(["sacs-wsgs-geospatial-findings/1.0"]),
      geospatialTransportMode: "RESULT_EXTENSION",
      currentness: Object.freeze({
        mode: "DEDICATED_OPERATION",
        operation: "VALIDATE_SOURCE_CURRENTNESS"
      }),
      gowmContract: Object.freeze({
        softwareVersion: "0.6.4",
        gatewayContractVersion: "0.6.3",
        commit: "c49bf415fdb4cbe19a09f341c34b6dd825e3ca14",
        sourcePackageArtifacts: 58,
        contractCatalogRevision: "sha256:efd0395dbd05c884c781f964b22147efcb38c4cef91704597706ec4b8332075a",
        semanticCatalogHash: "sha256:418fc328861e846801c6e8109bf6d48b876c7814c650a391b84076f71e588b61",
        operationLockHash: "sha256:765714690fc2192138f925526cc6bf0215c2481fa234c566756c26b891649686"
      }),
      requiredCapabilitiesReady: phaseReadiness.structuredSelection && phaseReadiness.currentness,
      optionalCapabilities: Object.freeze([
        Object.freeze({
          operationId: "RESOLVE_WORLD_SELECTION",
          available: phaseReadiness.structuredSelection,
          ...(phaseReadiness.structuredSelection ? {} : { reason: "IMPLEMENTATION_PENDING_N05" })
        }),
        Object.freeze({
          operationId: "VALIDATE_SOURCE_CURRENTNESS",
          available: phaseReadiness.currentness,
          ...(phaseReadiness.currentness ? {} : { reason: "IMPLEMENTATION_PENDING_N06" })
        })
      ])
    });
  }
  // These values are the immutable v0.1 northbound capability contract.
  // WSGS v0.2's GOWM lock is persisted inside execution records and must not
  // silently rewrite the frozen public response schema.
  return Object.freeze({
    service: "world-semantic-grounding-service",
    version: "0.1.0",
    contractVersion: "sacs-wsgs-grounding/1.0",
    supportedOperations: Object.freeze([
      "GROUND_REFERENCES",
      "COMPILE_WORLD_QUERY",
      "EXECUTE_WORLD_QUERY",
      "VALIDATE_REFERENCES"
    ]),
    supportedProducts: Object.freeze([
      "MENTIONS",
      "REFERENCE_PRODUCTS",
      "WORLD_EVIDENCE",
      "AMBIGUITIES",
      "CAPABILITY_GAPS"
    ]),
    gowmContract: Object.freeze({
      softwareVersion: "0.4.0",
      commit: "db575f79c874a69f65a2043a7e463338524b713d",
      sourcePackageArtifacts: 33
    }),
    requiredCapabilitiesReady: currentReadiness.ready,
    optionalCapabilities: Object.freeze([])
  });
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
  const selectionResolver = structuredSelectionResolverFromEnvironment();
  const requiredReadiness = options.readinessProbe ?? readinessProbeFromEnvironment();
  const primaryDataScope = primaryDataScopeFromEnvironment();
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
    ...(selectionResolver === undefined ? {} : {
      resolveWorldSelection: async (
        identity: ScopedGroundingIdentity,
        request: Readonly<Record<string, unknown>>
      ) => selectionResolver.resolve({
        identity,
        request: request as unknown as ResolveWorldSelectionRequest,
        priorResult: priorGroundingResult(await store.get(
          identity,
          String(request["priorGroundingId"] ?? ""),
          SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION
        ))
      })
    }),
    capabilities: async (_identity, contractSelection) => groundingCapabilitiesForSelection(
      contractSelection,
      await readiness(),
      { structuredSelection: selectionResolver !== undefined, currentness: false }
    ),
    ...(primaryDataScope === undefined ? {} : { selectDataScope: () => primaryDataScope }),
    sourceRetentionMs: integerEnvironment("WSGS_SOURCE_RETENTION_MS", 3_600_000, 1_000, 604_800_000)
  });
  return { backend, close: () => pool.end() };
}
