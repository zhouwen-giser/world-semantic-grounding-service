import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import {
  GDPS_V021_HANDOFF_FILES,
  LiveOperationLockProjectionError,
  WSGS_GROUNDING_CORE_OPERATION_KEYS,
  projectLiveGdpsOperationLock,
  sha256,
  type JsonObject,
} from "./live-gdps-operation-lock-projector.js";
import {
  createGroundingIdentity,
  GowmDelegationSigner,
} from "@wsgs/delegated-identity";

const root = resolve(import.meta.dirname, "..", "..");

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requiredPath(path: string, code: string): string {
  if (!existsSync(path)) throw new LiveOperationLockProjectionError(code);
  return path;
}

function parseJson(path: string, code: string): JsonObject {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error(code);
    return parsed as JsonObject;
  } catch {
    throw new LiveOperationLockProjectionError(code);
  }
}

async function getJson(
  baseUrl: string,
  path: string,
  headers?: Headers,
): Promise<JsonObject> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new LiveOperationLockProjectionError("LIVE_GATEWAY_UNREACHABLE");
  }
  if (!response.ok)
    throw new LiveOperationLockProjectionError(
      `LIVE_GATEWAY_HTTP_${response.status}`,
    );
  try {
    const value = (await response.json()) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("invalid");
    return value as JsonObject;
  } catch {
    throw new LiveOperationLockProjectionError("LIVE_GATEWAY_RESPONSE_INVALID");
  }
}

function assertOutput(path: string, expected: Uint8Array, code: string): void {
  if (
    !existsSync(path) ||
    !Buffer.from(readFileSync(path)).equals(Buffer.from(expected))
  ) {
    throw new LiveOperationLockProjectionError(`${code}_${basename(path)}`);
  }
}

function csv(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  );
}

async function gatewayHeaders(capabilityLock: JsonObject): Promise<Headers> {
  const headers = new Headers({ accept: "application/json" });
  const credential =
    process.env["GOWM_GATEWAY_BEARER_TOKEN"] ??
    process.env["GOWM_WSGS_SAMPLE_TOKEN"];
  if (credential) headers.set("authorization", `Bearer ${credential}`);
  const suppliedDelegation = process.env["GOWM_GATEWAY_DELEGATION_TOKEN"];
  if (suppliedDelegation) {
    headers.set("x-gowm-delegation", suppliedDelegation);
    return headers;
  }
  const privateKeyPath = process.env["GOWM_WSGS_DELEGATION_PRIVATE_KEY_PATH"];
  const issuer =
    process.env["GATEWAY_DELEGATION_ISSUER"] ??
    process.env["GOWM_DELEGATION_ISSUER"];
  const audience =
    process.env["GATEWAY_DELEGATION_AUDIENCE"] ??
    process.env["GOWM_DELEGATION_AUDIENCE"];
  const servicePrincipalId =
    process.env["GATEWAY_RUNTIME_PRINCIPAL_REF"] ??
    process.env["GOWM_DELEGATION_SERVICE_PRINCIPAL_ID"];
  const signingRequested = [
    privateKeyPath,
    issuer,
    audience,
    servicePrincipalId,
  ].some(Boolean);
  if (!signingRequested) return headers;
  if (
    !credential ||
    !privateKeyPath ||
    !issuer ||
    !audience ||
    !servicePrincipalId
  ) {
    throw new LiveOperationLockProjectionError(
      "SIGNED_AVAILABILITY_CONFIGURATION_INCOMPLETE",
    );
  }
  const dataScope =
    argument("--data-scope") ??
    process.env["GDPS_V021_DATA_SCOPE"] ??
    process.env["WSGS_READINESS_DATA_SCOPE"];
  if (!dataScope || dataScope.includes("*"))
    throw new LiveOperationLockProjectionError(
      "SIGNED_AVAILABILITY_DATA_SCOPE_INVALID",
    );
  const datasetScopes = csv(
    process.env["WSGS_READINESS_DATASET_SCOPES"] ??
      process.env["GATEWAY_DATASET_SCOPE_CLAIM"],
  );
  const permissions = csv(
    process.env["WSGS_READINESS_PERMISSIONS"] ?? "data:read,dataset:read",
  );
  const operations = capabilityLock["operations"];
  if (!Array.isArray(operations))
    throw new LiveOperationLockProjectionError(
      "GDPS_CAPABILITY_OPERATIONS_INVALID",
    );
  const operationKeys = [
    ...WSGS_GROUNDING_CORE_OPERATION_KEYS,
    ...operations.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new LiveOperationLockProjectionError(
          "GDPS_CAPABILITY_ENTRY_INVALID",
        );
      }
      const operation = entry as JsonObject;
      return `${String(operation["operationId"])}@${String(operation["operationVersion"])}`;
    }),
  ].sort();
  if (operationKeys.length !== 42 || new Set(operationKeys).size !== 42) {
    throw new LiveOperationLockProjectionError(
      "SIGNED_AVAILABILITY_OPERATION_SET_INVALID",
    );
  }
  const identity = createGroundingIdentity({
    servicePrincipalId,
    actorId: "wsgs-gdps-v021-lock-projector",
    dataScopes: [dataScope],
    datasetScopes,
    permissions,
  });
  const signer = new GowmDelegationSigner({
    issuer,
    audience,
    servicePrincipalId,
    privateKeyPkcs8: readFileSync(privateKeyPath, "utf8"),
    trustedOperationKeys: operationKeys,
    maximumTtlSeconds: 300,
    defaultTtlSeconds: 120,
  });
  await signer.ready();
  const signed = await signer.sign({
    kind: "WORLD_QUERY",
    identity,
    requestId: `wsgs-gdps-lock-${randomUUID()}`,
    dataScopes: [dataScope],
    datasetScopes,
    plan: {
      nodes: operationKeys.map((key, index) => {
        const separator = key.lastIndexOf("@");
        return {
          nodeId: `lock_${index}`,
          operation: {
            operationId: key.slice(0, separator),
            operationVersion: key.slice(separator + 1),
          },
        };
      }),
    },
  });
  if (signed.allowedOperations.join("\n") !== operationKeys.join("\n")) {
    throw new LiveOperationLockProjectionError(
      "SIGNED_AVAILABILITY_AUTHORITY_DRIFT",
    );
  }
  headers.set("x-gowm-delegation", signed.token);
  return headers;
}

try {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  if (write === check)
    throw new LiveOperationLockProjectionError(
      "MODE_MUST_BE_EXACTLY_WRITE_OR_CHECK",
    );

  const handoffDirectory = resolve(
    argument("--handoff") ??
      process.env["GDPS_V021_HANDOFF_DIR"] ??
      join(root, "contracts", "upstream", "gdps-v0.2.1"),
  );
  const generatedDirectory = resolve(
    argument("--output-directory") ??
      join(root, "contracts", "generated", "gdps-v0.2.1"),
  );
  const operationLockPath = resolve(
    generatedDirectory,
    "wsgs-southbound-operation-lock-v2.json",
  );
  const provenancePath = resolve(
    generatedDirectory,
    "wsgs-southbound-operation-lock-v2.provenance.json",
  );
  const contractBasisPath = resolve(
    argument("--contract-basis") ??
      join(
        root,
        "contracts",
        "upstream",
        "gowm-0.6.3",
        "extracted",
        "package",
        "bundle",
        "locks",
        "wsgs-southbound-operation-lock-v2.json",
      ),
  );
  const baseUrl = (
    argument("--gateway-base-url") ??
    process.env["GOWM_GATEWAY_BASE_URL"] ??
    "http://127.0.0.1:18063"
  ).replace(/\/$/u, "");

  const handoffFiles = Object.fromEntries(
    GDPS_V021_HANDOFF_FILES.map((name) => {
      const path = requiredPath(
        join(handoffDirectory, name),
        `HANDOFF_FILE_MISSING_${name}`,
      );
      return [name, readFileSync(path)];
    }),
  );
  const checksumsPath = requiredPath(
    join(handoffDirectory, "CHECKSUMS.json"),
    "HANDOFF_CHECKSUMS_MISSING",
  );
  const checksumsBytes = readFileSync(checksumsPath);
  const gdpsCapabilityLock = parseJson(
    join(handoffDirectory, "GDPS_CAPABILITY_LOCK.json"),
    "GDPS_CAPABILITY_LOCK_INVALID",
  );
  const availabilityHeaders = await gatewayHeaders(gdpsCapabilityLock);

  const [catalog, semantics, availability] = await Promise.all([
    getJson(baseUrl, "/v1/capabilities"),
    getJson(baseUrl, "/v1/capability-semantics"),
    getJson(baseUrl, "/v1/operation-availability", availabilityHeaders),
  ]);
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const result = projectLiveGdpsOperationLock({
    catalog,
    semantics,
    availability,
    gatewayBindingLock: parseJson(
      join(handoffDirectory, "GOWM_GATEWAY_BINDING_LOCK.json"),
      "GATEWAY_BINDING_LOCK_INVALID",
    ),
    gdpsCapabilityLock,
    consumerLock: parseJson(
      join(handoffDirectory, "GDPS_CONSUMER_LOCK.json"),
      "CONSUMER_LOCK_INVALID",
    ),
    checksums: parseJson(checksumsPath, "HANDOFF_CHECKSUMS_INVALID"),
    handoffFiles,
    checksumsBytes,
    contractBasis: parseJson(
      requiredPath(contractBasisPath, "CONTRACT_BASIS_MISSING"),
      "CONTRACT_BASIS_INVALID",
    ),
    sourceCommit,
    observedAt: new Date().toISOString(),
  });
  if (write) {
    mkdirSync(dirname(operationLockPath), { recursive: true });
    writeFileSync(operationLockPath, result.operationLockBytes);
    writeFileSync(provenancePath, result.provenanceBytes);
  } else {
    assertOutput(
      operationLockPath,
      result.operationLockBytes,
      "LIVE_OPERATION_LOCK_OUTPUT_DRIFT",
    );
    assertOutput(
      provenancePath,
      result.provenanceBytes,
      "LIVE_OPERATION_LOCK_PROVENANCE_DRIFT",
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      marker: "WSGS_GDPS_V021_LIVE_OPERATION_LOCK_PASS",
      mode: write ? "write" : "check",
      gatewayBaseUrlHash: sha256(baseUrl),
      selectedStableOperations: 12,
      selectedPreviewOperations: 30,
      contractCatalogRevision: result.operationLock["contractCatalogRevision"],
      semanticCatalogHash: result.operationLock["semanticCatalogHash"],
      operationLockHash: result.operationLockHash,
    })}\n`,
  );
} catch (error) {
  const code =
    error instanceof LiveOperationLockProjectionError
      ? error.code
      : "UNEXPECTED_FAILURE";
  process.stderr.write(
    `WSGS_GDPS_V021_LIVE_OPERATION_LOCK_BLOCKED code=${code}\n`,
  );
  process.exitCode = 2;
}
