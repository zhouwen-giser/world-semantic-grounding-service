import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createGroundingIdentity, GowmDelegationSigner } from "@wsgs/delegated-identity";
import {
  GowmGatewayClient,
  GatewayProtocolError,
  type CapabilityDescriptor,
  type GatewayRequestContext,
  type OperationLock
} from "@wsgs/gowm-gateway-client";

type JsonObject = Record<string, unknown>;
type CheckStatus = "PASS" | "BLOCKED";

interface GateCheck {
  id: string;
  status: CheckStatus;
  evidence: JsonObject;
}

interface ConsumerLock {
  contractCatalogRevision: `sha256:${string}`;
  semanticCatalogHash: `sha256:${string}`;
  defaultOperations: OperationLock[];
  previewOperations: OperationLock[];
}

const expectedOperationKeys = [
  "reference.resolve@1.0",
  "world.get-current-state@1.0",
  "world.get-geometry@1.0",
  "spatial.find-in-area@1.0",
  "spatial.find-nearby@1.0"
] as const;
const expectedOperationIds = expectedOperationKeys.map((key) => key.slice(0, key.lastIndexOf("@")));
const terminalStatuses = new Set(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]);
const foreignReferenceId = "wrf_02ffffffffffffffffffffffffffffff";
const outsideReferenceId = "wrf_02000000000000000000000000000003";
let failureStage = "startup";
let failureEvidence: JsonObject | undefined;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function assertion(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function object(value: unknown, code: string): JsonObject {
  assertion(value !== null && typeof value === "object" && !Array.isArray(value), code);
  return value as JsonObject;
}

function array(value: unknown, code: string): unknown[] {
  assertion(Array.isArray(value), code);
  return value;
}

function text(value: unknown, code: string): string {
  assertion(typeof value === "string" && value.length > 0, code);
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as JsonObject;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// The published 0.6.3 bundle builder used localeCompare while the live
// contract runtime uses the code-point ordering above. Keep this function
// diagnostic-only so the real gate can prove that exact upstream mismatch;
// it is never used to validate a request or response.
function bundleBuildCanonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right)));
  });
}

function bundleBuildSha256(value: unknown): `sha256:${string}` {
  return sha256(bundleBuildCanonical(value));
}

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalSha256(value: unknown): `sha256:${string}` {
  return sha256(canonical(value));
}

function safeReferenceEvidence(referenceKey: JsonObject): JsonObject {
  return {
    kind: text(referenceKey["kind"], "REFERENCE_KIND_MISSING"),
    idHash: sha256(text(referenceKey["id"], "REFERENCE_ID_MISSING")),
    version: text(referenceKey["version"], "REFERENCE_VERSION_MISSING")
  };
}

function outputValue(envelope: unknown, code: string): JsonObject {
  const record = object(envelope, `${code}_ENVELOPE`);
  const output = object(record["output"], `${code}_OUTPUT`);
  return object(output["value"], `${code}_VALUE`);
}

function receiptIds(envelope: unknown): string[] {
  return array(object(envelope, "RECEIPT_ENVELOPE")["receipts"], "RECEIPTS_MISSING")
    .map((item) => text(object(item, "RECEIPT_INVALID")["receiptId"], "RECEIPT_ID_MISSING"));
}

function schemaPort(port: unknown): JsonObject {
  const value = object(port, "PORT_INVALID");
  return {
    schemaUri: text(value["schemaUri"], "PORT_SCHEMA_URI_MISSING"),
    schemaHash: text(value["schemaHash"], "PORT_SCHEMA_HASH_MISSING"),
    valueKind: text(value["valueKind"], "PORT_VALUE_KIND_MISSING"),
    unitSemantics: text(value["unitSemantics"], "PORT_UNIT_MISSING")
  };
}

async function schemaHash(relativePath: string): Promise<`sha256:${string}`> {
  const url = new URL(`../../contracts/upstream/gowm-0.6.3/extracted/package/bundle/schemas/${relativePath}`, import.meta.url);
  return canonicalSha256(JSON.parse(await readFile(url, "utf8")) as unknown);
}

async function upstreamSchemaHash(relativePath: string): Promise<`sha256:${string}`> {
  const url = new URL(`../../contracts/upstream/${relativePath}`, import.meta.url);
  return canonicalSha256(JSON.parse(await readFile(url, "utf8")) as unknown);
}

function literalSchemaName(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

async function literalBinding(value: unknown, targetPath?: string): Promise<JsonObject> {
  const kind = literalSchemaName(value);
  assertion(["array", "boolean", "null", "number", "object", "string"].includes(kind), "LITERAL_KIND_UNSUPPORTED");
  return {
    kind: "LITERAL",
    value,
    ...(targetPath === undefined ? {} : { targetPath }),
    port: {
      schemaUri: `urn:gowm:v0.2:value:${kind}`,
      schemaHash: await schemaHash(`platform/value-${kind}.schema.json`),
      valueKind: "ANY",
      unitSemantics: "UNSPECIFIED"
    }
  };
}

function operationRef(descriptor: CapabilityDescriptor): JsonObject {
  return {
    operationId: descriptor.operationId,
    operationVersion: descriptor.operationVersion,
    inputSchemaHash: descriptor.inputSchemaHash,
    outputSchemaHash: descriptor.outputSchemaHash
  };
}

function nodeBudget(descriptor: CapabilityDescriptor): JsonObject {
  return {
    maximumRows: descriptor.limits.maximumRows ?? 100_000,
    maximumCandidates: descriptor.limits.maximumCandidates ?? 100_000,
    maximumOutputBytes: descriptor.limits.maximumOutputBytes ?? 16_777_216,
    maximumExecutionMs: Math.min(descriptor.execution.maximumTimeoutMs, 120_000)
  };
}

async function main(): Promise<void> {
  assertion(required("ALLOW_REAL_GOWM_GATE") === "YES", "REAL_GOWM_GATE_NOT_ALLOWED");
  const baseUrl = new URL(required("GOWM_BASE_URL"));
  assertion(baseUrl.protocol === "https:" || ["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname), "INSECURE_REMOTE_GATEWAY_FORBIDDEN");
  const credential = required("GOWM_GATEWAY_CREDENTIAL");
  const privateKeyPath = required("GOWM_DELEGATION_PRIVATE_KEY_PATH");
  const dataScope = required("GOWM_DATA_SCOPE");
  const datasetScope = required("GOWM_DATASET_SCOPE");
  const runId = `wsgs-v02-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const checks: GateCheck[] = [];
  const timings: Record<string, number> = {};
  const time = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    failureStage = name;
    const started = performance.now();
    try {
      return await work();
    } finally {
      timings[name] = Math.round((performance.now() - started) * 100) / 100;
    }
  };

  const lock = JSON.parse(await readFile(
    new URL("../../contracts/upstream/gowm-0.6.3/extracted/package/bundle/locks/wsgs-southbound-operation-lock-v2.json", import.meta.url),
    "utf8"
  )) as ConsumerLock;
  const allLocks = [...lock.defaultOperations, ...lock.previewOperations];
  const requiredLocks = expectedOperationIds.map((operationId) => {
    const operation = allLocks.find((entry) => entry.operationId === operationId && entry.operationVersion === "1.0");
    assertion(operation !== undefined, `LOCK_MISSING_${operationId}`);
    return operation;
  });

  const identity = createGroundingIdentity({
    servicePrincipalId: required("GOWM_SERVICE_PRINCIPAL_ID"),
    actorId: "wsgs-real-gowm-gate",
    dataScopes: [dataScope],
    datasetScopes: [datasetScope],
    permissions: ["data:read", "dataset:read", "reference:read", "world:read"]
  });
  const signer = new GowmDelegationSigner({
    issuer: required("GOWM_DELEGATION_ISSUER"),
    audience: required("GOWM_DELEGATION_AUDIENCE"),
    servicePrincipalId: identity.servicePrincipalId,
    privateKeyPkcs8: await readFile(privateKeyPath, "utf8"),
    trustedOperationKeys: expectedOperationKeys,
    maximumTtlSeconds: 300,
    defaultTtlSeconds: 120
  });
  await signer.ready();

  const client = new GowmGatewayClient({
    baseUrl,
    credential: () => credential,
    timeoutMs: 30_000,
    maxRetries: 1,
    maxRequestBytes: 2 * 1024 * 1024,
    maxResponseBytes: 16 * 1024 * 1024,
    retryBaseDelayMs: 100,
    retryMaxDelayMs: 1_000
  });

  const catalog = await time("catalog", () => client.listCapabilities());
  const semantics = await time("semantics", () => client.listCapabilitySemantics());
  const descriptors = new Map(catalog.capabilities.map((entry) => [`${entry.operationId}@${entry.operationVersion}`, entry]));
  const descriptor = (operationId: string): CapabilityDescriptor => {
    const value = descriptors.get(`${operationId}@1.0`);
    assertion(value !== undefined, `CAPABILITY_MISSING_${operationId}`);
    return value;
  };
  const operationLock = (operationId: string): OperationLock => {
    const value = requiredLocks.find((entry) => entry.operationId === operationId);
    assertion(value !== undefined, `OPERATION_LOCK_MISSING_${operationId}`);
    return value;
  };

  const availabilityRequestId = `${runId}-availability`;
  const availabilityPlanAuthority = {
    nodes: expectedOperationIds.map((operationId, index) => ({
      nodeId: `authority_${index}`,
      operation: { operationId, operationVersion: "1.0" }
    }))
  };
  const availabilityDelegation = await signer.sign({
    kind: "WORLD_QUERY",
    identity,
    requestId: availabilityRequestId,
    dataScopes: [dataScope],
    datasetScopes: [datasetScope],
    plan: availabilityPlanAuthority
  });
  assertion(JSON.stringify(availabilityDelegation.allowedOperations) === JSON.stringify([...expectedOperationKeys].sort()), "AVAILABILITY_AUTHORITY_NOT_MINIMAL");
  const availability = await time("availability", () => client.listOperationAvailability({
    requestId: availabilityRequestId,
    delegationToken: availabilityDelegation.token
  }));
  const unavailable = availability.operations.filter((entry) => entry.availability !== "AVAILABLE");
  assertion(unavailable.length === 0, "REQUIRED_OPERATION_UNAVAILABLE");
  checks.push({
    id: "live-contract-endpoints",
    status: "PASS",
    evidence: {
      capabilityCount: catalog.capabilities.length,
      contractCatalogRevision: catalog.contractCatalogRevision,
      bindingRevision: catalog.bindingRevision,
      semanticCatalogHash: semantics.catalogHash,
      authorizedAvailabilityCount: availability.operations.length,
      availability: Object.fromEntries(availability.operations.map((entry) => [
        `${entry.operationId}@${entry.operationVersion}`,
        entry.availability
      ]))
    }
  });
  let trustedReady = false;
  try {
    const trusted = client.validateTrustedContracts({
      catalog,
      semantics,
      availability,
      required: requiredLocks,
      expectedContractCatalogRevision: lock.contractCatalogRevision,
      expectedSemanticCatalogHash: lock.semanticCatalogHash
    });
    assertion(trusted.requiredReady, "TRUSTED_CONTRACTS_NOT_READY");
    trustedReady = true;
    checks.push({
      id: "consumer-semantic-lock",
      status: "PASS",
      evidence: { expected: lock.semanticCatalogHash, observed: semantics.catalogHash }
    });
  } catch (error) {
    if (!(error instanceof GatewayProtocolError) || error.code !== "SEMANTIC_CATALOG_HASH_MISMATCH") throw error;
    const runtimeCanonicalHash = canonicalSha256(semantics.profiles);
    const bundleProjection = semantics.profiles.map((entry) => ({
      operationId: entry.operationId,
      operationVersion: entry.operationVersion,
      semanticProfile: entry.semanticProfile,
      semanticProfileHash: bundleBuildSha256(entry.semanticProfile)
    }));
    const bundleCanonicalHash = bundleBuildSha256(bundleProjection);
    const perProfileHashDifferences = semantics.profiles.filter((entry) =>
      entry.semanticProfileHash !== bundleBuildSha256(entry.semanticProfile)
    ).length;
    assertion(runtimeCanonicalHash === semantics.catalogHash, "LIVE_SEMANTIC_HASH_SELF_INCONSISTENT");
    assertion(bundleCanonicalHash === lock.semanticCatalogHash, "BUNDLE_SEMANTIC_HASH_CAUSE_UNCONFIRMED");
    checks.push({
      id: "consumer-semantic-lock",
      status: "BLOCKED",
      evidence: {
        reason: "UPSTREAM_0_6_3_SEMANTIC_CATALOG_CANONICALIZATION_MISMATCH",
        expectedConsumerBundleHash: lock.semanticCatalogHash,
        observedLiveRuntimeHash: semantics.catalogHash,
        runtimeCanonicalHash,
        bundleBuilderCanonicalHash: bundleCanonicalHash,
        perProfileHashDifferences,
        wsgsReadiness: "FAIL_CLOSED",
        subsequentTransportChecks: "DIAGNOSTIC_ONLY"
      }
    });
  }

  async function direct(operationId: string, input: JsonObject, label: string): Promise<unknown> {
    const operationDescriptor = descriptor(operationId);
    const requestId = `${runId}-${label}`;
    const delegation = await signer.sign({
      kind: "DIRECT_OPERATION",
      identity,
      requestId,
      dataScopes: [dataScope],
      datasetScopes: [datasetScope],
      operation: { operationId, operationVersion: "1.0" }
    });
    assertion(
      delegation.allowedOperations.length === 1 && delegation.allowedOperations[0] === `${operationId}@1.0`,
      `DIRECT_AUTHORITY_NOT_MINIMAL_${operationId}`
    );
    const maximumTimeoutMs = operationDescriptor.execution.maximumTimeoutMs;
    const request = {
      requestVersion: "1.0",
      requestId,
      idempotencyKey: `${runId}:${label}`,
      operationVersion: "1.0",
      inputSchemaHash: operationDescriptor.inputSchemaHash,
      outputSchemaHash: operationDescriptor.outputSchemaHash,
      input,
      executionPolicy: {
        deadlineAt: new Date(Date.now() + Math.min(maximumTimeoutMs, 25_000)).toISOString(),
        maximumResultBytes: operationDescriptor.limits.maximumOutputBytes ?? 16_777_216,
        ...(operationDescriptor.limits.maximumRows === undefined ? {} : { maximumRows: operationDescriptor.limits.maximumRows }),
        ...(operationDescriptor.limits.maximumCandidates === undefined ? {} : { maximumCandidates: operationDescriptor.limits.maximumCandidates }),
        maximumCostClass: operationDescriptor.execution.costClass,
        preferredExecution: "SYNC"
      }
    };
    let response;
    try {
      response = await time(`direct:${label}`, () => client.executeOperation(operationLock(operationId), request, {
        requestId,
        delegationToken: delegation.token,
        deadlineAt: new Date(Date.now() + 30_000)
      }));
    } catch (error) {
      if (!(error instanceof GatewayProtocolError) || error.status !== 422) throw error;
      const diagnosticResponse = await fetch(new URL(`/v1/operations/${encodeURIComponent(operationId)}:execute`, baseUrl), {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${credential}`,
          "content-type": "application/json",
          "x-request-id": requestId,
          "x-gowm-delegation": delegation.token
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(10_000)
      });
      const diagnosticBody = object(await diagnosticResponse.json(), "GOWM_PUBLIC_ERROR_INVALID");
      const publicError = object(diagnosticBody["error"], "GOWM_PUBLIC_ERROR_MISSING");
      failureEvidence = {
        gatewayStage: publicError["stage"],
        details: publicError["details"]
      };
      throw new Error(`GOWM_${text(publicError["code"], "GOWM_PUBLIC_ERROR_CODE_MISSING")}`);
    }
    assertion(response.status === 200, `DIRECT_NOT_SYNCHRONOUS_${operationId}`);
    return response.value;
  }

  const mention = (surfaceText: string, expectedKinds: string[]): JsonObject => ({
    schemaVersion: "1.0",
    mentions: [{ mentionId: `m-${sha256(surfaceText).slice(-12)}`, surfaceText, expectedKinds }],
    context: { anchorReferenceKeys: [], language: "zh-CN" },
    limitPerMention: 10
  });

  const vehicleResolutionEnvelope = await direct("reference.resolve", mention("2号车", ["WORLD_OBJECT"]), "resolve-vehicle-2");
  const vehicleResolution = outputValue(vehicleResolutionEnvelope, "VEHICLE_RESOLUTION");
  const vehicleResolutionItem = object(array(vehicleResolution["resolutions"], "VEHICLE_RESOLUTIONS_MISSING")[0], "VEHICLE_RESOLUTION_MISSING");
  const vehicleCandidates = array(vehicleResolutionItem["candidates"], "VEHICLE_CANDIDATES_MISSING");
  assertion(vehicleResolutionItem["status"] === "RESOLVED_EXACT" && vehicleCandidates.length === 1, "VEHICLE_NOT_UNIQUE");
  const vehicleDescriptor = object(object(vehicleCandidates[0], "VEHICLE_CANDIDATE_INVALID")["candidate"], "VEHICLE_DESCRIPTOR_INVALID");
  const vehicleReference = object(vehicleDescriptor["referenceKey"], "VEHICLE_REFERENCE_INVALID");

  const vehicleStateEnvelope = await direct("world.get-current-state", {
    schemaVersion: "1.0",
    referenceKey: vehicleReference
  }, "vehicle-current-state");
  const vehicleState = outputValue(vehicleStateEnvelope, "VEHICLE_STATE");
  const vehicleFact = object(array(vehicleState["facts"], "VEHICLE_FACTS_MISSING")[0], "VEHICLE_FACT_MISSING");
  const position = object(vehicleFact["position"], "VEHICLE_POSITION_MISSING");
  const coordinates = array(position["coordinates"], "VEHICLE_COORDINATES_MISSING");
  assertion(coordinates[0] === 121.4737 && coordinates[1] === 31.2304, "VEHICLE_POSITION_MISMATCH");
  checks.push({
    id: "business-2号车-current-state",
    status: "PASS",
    evidence: {
      resolution: vehicleResolutionItem["status"],
      candidateCount: vehicleCandidates.length,
      reference: safeReferenceEvidence(vehicleReference),
      position: { type: position["type"], coordinateCount: coordinates.length },
      envelopeStatus: object(vehicleStateEnvelope, "VEHICLE_STATE_ENVELOPE_INVALID")["status"],
      diagnosticOnly: !trustedReady
    }
  });

  const roadResolutionEnvelope = await direct("reference.resolve", mention("滨河路", ["WORLD_OBJECT"]), "resolve-ambiguous-road");
  const roadResolution = outputValue(roadResolutionEnvelope, "ROAD_RESOLUTION");
  const roadResolutionItem = object(array(roadResolution["resolutions"], "ROAD_RESOLUTIONS_MISSING")[0], "ROAD_RESOLUTION_MISSING");
  const roadCandidates = array(roadResolutionItem["candidates"], "ROAD_CANDIDATES_MISSING");
  assertion(roadResolutionItem["status"] === "AMBIGUOUS" && roadCandidates.length === 2, "ROAD_AMBIGUITY_NOT_PRESERVED");
  checks.push({
    id: "business-滨河路-ambiguity",
    status: "PASS",
    evidence: {
      resolution: roadResolutionItem["status"],
      candidateCount: roadCandidates.length,
      downstreamSpatialExecutions: 0,
      diagnosticOnly: !trustedReady
    }
  });

  const areaResolutionEnvelope = await direct("reference.resolve", mention("A区", ["WORLD_OBJECT"]), "resolve-area-a");
  const areaResolution = outputValue(areaResolutionEnvelope, "AREA_RESOLUTION");
  const areaResolutionItem = object(array(areaResolution["resolutions"], "AREA_RESOLUTIONS_MISSING")[0], "AREA_RESOLUTION_MISSING");
  const areaCandidates = array(areaResolutionItem["candidates"], "AREA_CANDIDATES_MISSING");
  assertion(areaResolutionItem["status"] === "RESOLVED_EXACT" && areaCandidates.length === 1, "AREA_NOT_UNIQUE");
  const areaReference = object(object(object(areaCandidates[0], "AREA_CANDIDATE_INVALID")["candidate"], "AREA_DESCRIPTOR_INVALID")["referenceKey"], "AREA_REFERENCE_INVALID");
  const areaGeometryEnvelope = await direct("world.get-geometry", {
    schemaVersion: "1.0",
    referenceKey: areaReference
  }, "area-geometry");
  const areaGeometryOutput = outputValue(areaGeometryEnvelope, "AREA_GEOMETRY");
  const areaFact = object(array(areaGeometryOutput["facts"], "AREA_FACTS_MISSING")[0], "AREA_FACT_MISSING");
  const areaGeometry = object(areaFact["geometry"], "AREA_GEOMETRY_MISSING");
  assertion(areaGeometry["type"] === "Polygon", "AREA_GEOMETRY_NOT_POLYGON");
  const inAreaEnvelope = await direct("spatial.find-in-area", {
    geometry: areaGeometry,
    objectTypes: ["VEHICLE"],
    limit: 20,
    crs: "EPSG:4326"
  }, "vehicles-in-area");
  const inArea = outputValue(inAreaEnvelope, "IN_AREA");
  const inAreaObjects = array(inArea["objects"], "IN_AREA_OBJECTS_MISSING").map((entry) => object(entry, "IN_AREA_OBJECT_INVALID"));
  const inAreaIds = inAreaObjects.map((entry) => text(object(entry["referenceKey"], "IN_AREA_REFERENCE_INVALID")["id"], "IN_AREA_REFERENCE_ID_MISSING"));
  assertion(inAreaIds.length === 2, "IN_AREA_COUNT_MISMATCH");
  assertion(inAreaIds.includes(text(vehicleReference["id"], "VEHICLE_REFERENCE_ID_MISSING")), "IN_AREA_VEHICLE_2_MISSING");
  assertion(!inAreaIds.includes(outsideReferenceId) && !inAreaIds.includes(foreignReferenceId), "IN_AREA_SCOPE_LEAK");
  checks.push({
    id: "business-A区-exact-in-area",
    status: "PASS",
    evidence: {
      areaResolution: areaResolutionItem["status"],
      areaReference: safeReferenceEvidence(areaReference),
      vehicleCount: inAreaIds.length,
      scopedReferenceSetHash: canonicalSha256([...inAreaIds].sort()),
      outsideExcluded: true,
      foreignScopeExcluded: true,
      diagnosticOnly: !trustedReady
    }
  });

  const worldDescriptor = descriptor("world.get-current-state");
  const nearbyDescriptor = descriptor("spatial.find-nearby");
  const positionPort = worldDescriptor.ports.outputs.find((port) => port.name === "positionCoordinates");
  const resultPort = nearbyDescriptor.ports.outputs.find((port) => port.name === "result");
  assertion(positionPort !== undefined && resultPort !== undefined, "TYPED_PORTS_MISSING");
  const worldInputPort = worldDescriptor.ports.inputs.find((port) => port.name === "request");
  assertion(worldInputPort !== undefined, "WORLD_REQUEST_PORT_MISSING");
  const referenceKeyPort = {
    schemaUri: "urn:gowm:v0.4:reference-key",
    schemaHash: await upstreamSchemaHash("gowm-v0.4/reference-key.schema.json"),
    valueKind: "REFERENCE_KEY",
    unitSemantics: "UNSPECIFIED"
  };
  const typedPlan = {
    queryPlanVersion: "2.0",
    queryId: `${runId}-nearby-query`,
    nodes: [
      {
        nodeId: "vehicle_state",
        operation: operationRef(worldDescriptor),
        inputs: {
          schemaVersion: await literalBinding("1.0", "/schemaVersion"),
          referenceKey: {
            kind: "REFERENCE_KEY",
            port: referenceKeyPort,
            targetPath: "/referenceKey",
            referenceKey: vehicleReference
          }
        },
        failurePolicy: "FAIL_FAST",
        budget: nodeBudget(worldDescriptor)
      },
      {
        nodeId: "nearby_areas",
        operation: operationRef(nearbyDescriptor),
        inputs: {
          location: {
            kind: "NODE_OUTPUT",
            nodeId: "vehicle_state",
            outputPort: "positionCoordinates",
            path: positionPort.path,
            targetPath: "/location",
            port: schemaPort(positionPort)
          },
          radiusM: await literalBinding(1000, "/radiusM"),
          objectTypes: await literalBinding(["AREA"], "/objectTypes"),
          limit: await literalBinding(20, "/limit"),
          crs: await literalBinding("EPSG:4326", "/crs")
        },
        failurePolicy: "FAIL_FAST",
        budget: nodeBudget(nearbyDescriptor)
      }
    ],
    outputs: [{
      name: "nearby",
      binding: {
        kind: "NODE_OUTPUT",
        nodeId: "nearby_areas",
        outputPort: "result",
        ...(resultPort.path === undefined ? {} : { path: resultPort.path }),
        port: schemaPort(resultPort)
      }
    }],
    budgets: {
      maximumNodes: 2,
      maximumDepth: 2,
      maximumRows: 1_000_000,
      maximumCandidates: 5_000_000,
      maximumOutputBytes: 128_000_000,
      maximumExecutionMs: 300_000
    }
  };
  const worldQueryRequestId = `${runId}-nearby-submit`;
  const worldQuerySubmission = {
    requestId: worldQueryRequestId,
    idempotencyKey: `${runId}:nearby-world-query`,
    plan: typedPlan,
    parameters: {},
    parameterSchemaHash: await schemaHash("platform/world-query-parameters.schema.json"),
    snapshotPolicy: { mode: "BEST_EFFORT", allowDowngrade: true }
  };
  const queryDelegation = await signer.sign({
    kind: "WORLD_QUERY",
    identity,
    requestId: worldQueryRequestId,
    dataScopes: [dataScope],
    datasetScopes: [datasetScope],
    plan: typedPlan
  });
  assertion(
    JSON.stringify(queryDelegation.allowedOperations) === JSON.stringify(["spatial.find-nearby@1.0", "world.get-current-state@1.0"]),
    "WORLD_QUERY_AUTHORITY_NOT_MINIMAL"
  );
  let submitted;
  try {
    submitted = await time("world-query:submit", () => client.submitWorldQuery(worldQuerySubmission, {
      requestId: worldQueryRequestId,
      delegationToken: queryDelegation.token,
      preferAsync: true,
      deadlineAt: new Date(Date.now() + 30_000)
    }));
  } catch (error) {
    if (!(error instanceof GatewayProtocolError) || error.status !== 422) throw error;
    const diagnosticResponse = await fetch(new URL("/v1/world-queries", baseUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
        prefer: "respond-async",
        "x-request-id": worldQueryRequestId,
        "x-gowm-delegation": queryDelegation.token
      },
      body: JSON.stringify(worldQuerySubmission),
      signal: AbortSignal.timeout(10_000)
    });
    const diagnosticBody = object(await diagnosticResponse.json(), "WORLD_QUERY_PUBLIC_ERROR_INVALID");
    const publicError = object(diagnosticBody["error"], "WORLD_QUERY_PUBLIC_ERROR_MISSING");
    failureEvidence = {
      gatewayStage: publicError["stage"],
      nodeId: publicError["nodeId"],
      details: publicError["details"]
    };
    throw new Error(`GOWM_WORLD_QUERY_${text(publicError["code"], "WORLD_QUERY_PUBLIC_ERROR_CODE_MISSING")}`);
  }
  assertion(submitted.status === 202, "WORLD_QUERY_NOT_ACCEPTED_ASYNC");
  const submittedJob = object(submitted.value, "WORLD_QUERY_JOB_INVALID");
  const worldQueryJobId = text(submittedJob["jobId"], "WORLD_QUERY_JOB_ID_MISSING");
  const pollRequestId = `${runId}-nearby-poll`;
  const pollDelegation = await signer.sign({
    kind: "WORLD_QUERY",
    identity,
    requestId: pollRequestId,
    dataScopes: [dataScope],
    datasetScopes: [datasetScope],
    plan: typedPlan
  });
  const terminalJob = await time("world-query:poll", () => client.pollJob(worldQueryJobId, {
    requestId: pollRequestId,
    delegationToken: pollDelegation.token,
    deadlineAt: new Date(Date.now() + 60_000)
  }, 100));
  if (terminalJob["status"] !== "COMPLETED") {
    const terminalResult = terminalJob["result"] === undefined
      ? undefined
      : object(terminalJob["result"], "WORLD_QUERY_FAILED_RESULT_INVALID");
    const failedNodes = terminalResult === undefined
      ? []
      : array(terminalResult["nodes"], "WORLD_QUERY_FAILED_NODES_INVALID").map((entry) => {
          const node = object(entry, "WORLD_QUERY_FAILED_NODE_INVALID");
          const errorEnvelope = node["error"] === undefined ? undefined : object(node["error"], "WORLD_QUERY_FAILED_NODE_ERROR_INVALID");
          const error = errorEnvelope === undefined ? undefined : object(errorEnvelope["error"], "WORLD_QUERY_FAILED_NODE_ERROR_BODY_INVALID");
          return {
            nodeId: node["nodeId"],
            status: node["status"],
            ...(error === undefined
              ? {}
              : { errorCode: error["code"], errorStage: error["stage"], errorDetails: error["details"] })
          };
        });
    failureEvidence = {
      jobStatus: terminalJob["status"],
      resultStatus: terminalResult?.["status"],
      nodes: failedNodes
    };
  }
  assertion(terminalJob["status"] === "COMPLETED", "WORLD_QUERY_NOT_COMPLETED");
  const worldQueryResult = object(terminalJob["result"], "WORLD_QUERY_RESULT_MISSING");
  const nearbyOutput = object(object(worldQueryResult["outputs"], "WORLD_QUERY_OUTPUTS_MISSING")["nearby"], "WORLD_QUERY_NEARBY_MISSING");
  const nearbyObjects = array(nearbyOutput["objects"], "WORLD_QUERY_NEARBY_OBJECTS_MISSING").map((entry) => object(entry, "WORLD_QUERY_NEARBY_OBJECT_INVALID"));
  const nearbyIds = nearbyObjects.map((entry) => text(object(entry["referenceKey"], "WORLD_QUERY_NEARBY_REFERENCE_INVALID")["id"], "WORLD_QUERY_NEARBY_ID_MISSING"));
  const areaId = text(areaReference["id"], "AREA_REFERENCE_ID_MISSING");
  assertion(nearbyIds.includes(areaId), "NEARBY_AREA_MISSING");
  assertion(nearbyObjects.every((entry) => typeof entry["distanceM"] === "number" && (entry["distanceM"] as number) <= 1000), "NEARBY_DISTANCE_LIMIT_BROKEN");
  assertion(!nearbyIds.includes(foreignReferenceId), "NEARBY_SCOPE_LEAK");
  checks.push({
    id: "async-world-query-nearby-1km",
    status: "PASS",
    evidence: {
      submitStatus: submitted.status,
      terminalStatus: terminalJob["status"],
      snapshotPolicy: "BEST_EFFORT",
      snapshotAdherenceCount: array(worldQueryResult["snapshotAdherence"], "SNAPSHOT_ADHERENCE_MISSING").length,
      allowedOperations: queryDelegation.allowedOperations,
      radiusM: 1000,
      resultCount: nearbyObjects.length,
      areaPresent: true,
      foreignScopeExcluded: true,
      jobIdHash: sha256(worldQueryJobId),
      diagnosticOnly: !trustedReady
    }
  });

  const directReceiptId = receiptIds(vehicleStateEnvelope)[0];
  assertion(directReceiptId !== undefined, "DIRECT_RECEIPT_MISSING");
  const receiptRequestId = `${runId}-receipt`;
  const receiptDelegation = await signer.sign({
    kind: "DIRECT_OPERATION",
    identity,
    requestId: receiptRequestId,
    dataScopes: [dataScope],
    datasetScopes: [datasetScope],
    operation: { operationId: "world.get-current-state", operationVersion: "1.0" }
  });
  const receipt = object(await time("receipt:get", () => client.getReceipt(directReceiptId, {
    requestId: receiptRequestId,
    delegationToken: receiptDelegation.token,
    deadlineAt: new Date(Date.now() + 10_000)
  })), "RECEIPT_INVALID");
  assertion(receipt["receiptId"] === directReceiptId, "RECEIPT_ID_MISMATCH");
  checks.push({
    id: "bounded-receipt-fetch",
    status: "PASS",
    evidence: {
      receiptIdHash: sha256(directReceiptId),
      operationId: receipt["operationId"],
      operationVersion: receipt["operationVersion"],
      status: receipt["status"],
      diagnosticOnly: !trustedReady
    }
  });

  let cancelledJob: JsonObject | undefined;
  let cancellationAttempts = 0;
  for (let attempt = 1; attempt <= 3 && cancelledJob === undefined; attempt += 1) {
    cancellationAttempts = attempt;
    const cancelPlan = structuredClone(typedPlan);
    cancelPlan.queryId = `${runId}-cancel-query-${attempt}`;
    const cancelSubmitRequestId = `${runId}-cancel-submit-${attempt}`;
    const cancelSubmission = {
      requestId: cancelSubmitRequestId,
      idempotencyKey: `${runId}:cancel:${attempt}`,
      plan: cancelPlan,
      parameters: {},
      parameterSchemaHash: worldQuerySubmission.parameterSchemaHash,
      snapshotPolicy: { mode: "BEST_EFFORT", allowDowngrade: true }
    };
    const cancelSubmitDelegation = await signer.sign({
      kind: "WORLD_QUERY",
      identity,
      requestId: cancelSubmitRequestId,
      dataScopes: [dataScope],
      datasetScopes: [datasetScope],
      plan: cancelPlan
    });
    const cancelSubmitted = await client.submitWorldQuery(cancelSubmission, {
      requestId: cancelSubmitRequestId,
      delegationToken: cancelSubmitDelegation.token,
      preferAsync: true,
      deadlineAt: new Date(Date.now() + 15_000)
    });
    assertion(cancelSubmitted.status === 202, "CANCEL_QUERY_NOT_ASYNC");
    const cancelRequestId = `${runId}-cancel-request-${attempt}`;
    const cancelDelegation = await signer.sign({
      kind: "WORLD_QUERY",
      identity,
      requestId: cancelRequestId,
      dataScopes: [dataScope],
      datasetScopes: [datasetScope],
      plan: cancelPlan
    });
    const cancellation = object(await client.cancelWorldQuery(cancelPlan.queryId, {
      requestId: cancelRequestId,
      delegationToken: cancelDelegation.token,
      deadlineAt: new Date(Date.now() + 15_000)
    }), "CANCEL_RESPONSE_INVALID");
    if (cancellation["status"] === "CANCELLED") cancelledJob = cancellation;
    else if (!terminalStatuses.has(String(cancellation["status"]))) {
      const cancelJobId = text(object(cancelSubmitted.value, "CANCEL_SUBMISSION_INVALID")["jobId"], "CANCEL_JOB_ID_MISSING");
      const cancelPollRequestId = `${runId}-cancel-poll-${attempt}`;
      const cancelPollDelegation = await signer.sign({
        kind: "WORLD_QUERY",
        identity,
        requestId: cancelPollRequestId,
        dataScopes: [dataScope],
        datasetScopes: [datasetScope],
        plan: cancelPlan
      });
      const terminal = await client.pollJob(cancelJobId, {
        requestId: cancelPollRequestId,
        delegationToken: cancelPollDelegation.token,
        deadlineAt: new Date(Date.now() + 30_000)
      }, 100);
      if (terminal["status"] === "CANCELLED") cancelledJob = terminal;
    }
  }
  checks.push(cancelledJob === undefined ? {
    id: "world-query-cancel",
    status: "BLOCKED",
    evidence: { reason: "CANCELLATION_RACE_NOT_OBSERVED", attempts: cancellationAttempts, diagnosticOnly: !trustedReady }
  } : {
    id: "world-query-cancel",
    status: "PASS",
    evidence: { terminalStatus: cancelledJob["status"], attempts: cancellationAttempts, diagnosticOnly: !trustedReady }
  });

  checks.push({
    id: "direct-operation-202",
    status: "BLOCKED",
    evidence: {
      reason: "GOWM_0_6_3_DIRECT_ROUTE_HAS_NO_ASYNC_JOB_RESPONSE",
      observedDirectStatus: 200,
      testedOperationMode: descriptor("world.get-current-state").execution.mode,
      asyncLifecycleVerifiedBy: "world-query",
      diagnosticOnly: !trustedReady
    }
  });

  const blocked = checks.filter((check) => check.status === "BLOCKED");
  process.stdout.write(`${JSON.stringify({
    status: blocked.length === 0 ? "PASS" : "PARTIAL",
    runtime: {
      gatewayContractVersion: "0.6.3",
      transport: baseUrl.protocol,
      exactConsumerRevision: lock.contractCatalogRevision,
      privateKeyPathHash: sha256(privateKeyPath),
      executionClassification: trustedReady ? "TRUSTED" : "DIAGNOSTIC_ONLY_AFTER_FAIL_CLOSED_CONTRACT_DRIFT"
    },
    checks,
    timingsMs: timings,
    summary: {
      pass: checks.length - blocked.length,
      blocked: blocked.length,
      failed: 0
    }
  }, null, 2)}\n`);
  if (blocked.length > 0) process.exitCode = 2;
}

main().catch((error: unknown) => {
  const safeMessage = error instanceof Error
    ? error.message.replace(/[A-Za-z0-9_./+=:-]{40,}/gu, "[REDACTED]").slice(0, 512)
    : undefined;
  const errorCode = error instanceof GatewayProtocolError
    ? error.code
    : error instanceof Error && /^[A-Z0-9_.:-]+$/u.test(error.message)
      ? error.message
      : error instanceof Error
        ? error.name
        : "UNKNOWN_ERROR";
  process.stderr.write(`${JSON.stringify({
    status: "FAIL",
    errorCode,
    stage: failureStage,
    ...(failureEvidence === undefined && safeMessage === undefined
      ? {}
      : { evidence: { ...(failureEvidence ?? {}), ...(safeMessage === undefined ? {} : { message: safeMessage }) } })
  })}\n`);
  process.exitCode = 1;
});
