import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createGroundingIdentity, GowmDelegationSigner } from "@wsgs/delegated-identity";
import {
  executeHistoricalTrace,
  historicalTraceConfigurationFromEnvironment,
  type HistoricalReferenceKey
} from "@wsgs/historical-trace-consumer";
import { loadOperationalGowmLock } from "@wsgs/gowm-contract-intake";
import {
  GowmGatewayClient,
  type CapabilityDescriptor,
  type GatewayRequestContext,
  type OperationLock
} from "@wsgs/gowm-gateway-client";

type JsonObject = Record<string, unknown>;

const operationIds = [
  "operational-task.get",
  "operational-task.get-execution-intervals",
  "history.get-trajectory"
] as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonObject;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function reference(name: string, kind: string): HistoricalReferenceKey {
  const value = object(JSON.parse(required(name)) as unknown, `${name}_INVALID`);
  if (value["namespace"] !== "gowm" || value["kind"] !== kind) throw new Error(`${name}_INVALID`);
  return {
    namespace: "gowm",
    kind,
    id: text(value["id"], `${name}_ID_INVALID`),
    version: text(value["version"], `${name}_VERSION_INVALID`)
  };
}

function list(name: string): string[] {
  return process.env[name]?.split(/[ ,]+/u).map((entry) => entry.trim()).filter(Boolean) ?? [];
}

if (process.argv.includes("--help")) {
  process.stdout.write([
    "Runs one latest execution-interval query and one historical-trajectory query against GOWM.",
    "Required: GOWM_GATEWAY_BASE_URL, GOWM_GATEWAY_TOKEN, GOWM_SOUTHBOUND_LOCK_FILE,",
    "GOWM_SOUTHBOUND_LOCK_SHA256, GOWM_DELEGATION_ISSUER, GOWM_DELEGATION_AUDIENCE,",
    "GOWM_DELEGATION_SERVICE_PRINCIPAL_ID, GOWM_DELEGATION_PRIVATE_KEY_FILE,",
    "WSGS_READINESS_DATA_SCOPE, WSGS_HISTORY_SMOKE_TASK_REFERENCE_JSON,",
    "WSGS_HISTORY_SMOKE_SUBJECT_REFERENCE_JSON.",
    "Optional: WSGS_READINESS_DATASET_SCOPES, WSGS_READINESS_PERMISSIONS and WSGS_HISTORY_* tuning.",
    ""
  ].join("\n"));
  process.exit(0);
}

async function main(): Promise<void> {
  const taskReferenceKey = reference("WSGS_HISTORY_SMOKE_TASK_REFERENCE_JSON", "OPERATIONAL_TASK");
  const subjectReferenceKey = reference("WSGS_HISTORY_SMOKE_SUBJECT_REFERENCE_JSON", "WORLD_OBJECT");
  const loaded = loadOperationalGowmLock({
    lockPath: required("GOWM_SOUTHBOUND_LOCK_FILE"),
    expectedSha256: required("GOWM_SOUTHBOUND_LOCK_SHA256") as `sha256:${string}`,
    hashMode: "EXACT_BYTES",
    operationCountPolicy: "HASH_LOCKED_EXTENSION"
  });
  const allLocks = [...loaded.lock.defaultOperations, ...loaded.lock.previewOperations] as OperationLock[];
  const locks = new Map(operationIds.map((operationId) => {
    const lock = allLocks.find((entry) => entry.operationId === operationId && entry.operationVersion === "1.0");
    if (!lock || lock.maturity !== "PREVIEW") throw new Error(`HISTORY_SMOKE_LOCK_MISSING_${operationId}`);
    return [operationId, lock] as const;
  }));
  const dataScope = required("WSGS_READINESS_DATA_SCOPE");
  const servicePrincipalId = required("GOWM_DELEGATION_SERVICE_PRINCIPAL_ID");
  const identity = createGroundingIdentity({
    servicePrincipalId,
    actorId: process.env["WSGS_HISTORY_SMOKE_ACTOR_ID"]?.trim() || "wsgs-history-smoke",
    dataScopes: [dataScope],
    datasetScopes: list("WSGS_READINESS_DATASET_SCOPES"),
    permissions: list("WSGS_READINESS_PERMISSIONS").length > 0
      ? list("WSGS_READINESS_PERMISSIONS")
      : ["data:read", "dataset:read"]
  });
  const signer = new GowmDelegationSigner({
    issuer: required("GOWM_DELEGATION_ISSUER"),
    audience: required("GOWM_DELEGATION_AUDIENCE"),
    servicePrincipalId,
    privateKeyPkcs8: await readFile(required("GOWM_DELEGATION_PRIVATE_KEY_FILE"), "utf8"),
    trustedOperationKeys: operationIds.map((operationId) => `${operationId}@1.0`)
  });
  await signer.ready();
  const client = new GowmGatewayClient({
    baseUrl: required("GOWM_GATEWAY_BASE_URL"),
    credential: () => required("GOWM_GATEWAY_TOKEN"),
    timeoutMs: 30_000,
    maxRetries: 1
  });
  const catalog = await client.listCapabilities();
  const descriptors = new Map(catalog.capabilities.map((entry) => [`${entry.operationId}@${entry.operationVersion}`, entry]));
  const runId = `history-smoke-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  let callNo = 0;

  async function execute(operationId: string, input: JsonObject): Promise<unknown> {
    const lock = locks.get(operationId as typeof operationIds[number]);
    const descriptor = descriptors.get(`${operationId}@1.0`) as CapabilityDescriptor | undefined;
    if (!lock || !descriptor) throw new Error(`HISTORY_SMOKE_CAPABILITY_MISSING_${operationId}`);
    callNo += 1;
    const requestId = `${runId}-${callNo}`;
    const delegation = await signer.sign({
      kind: "DIRECT_OPERATION",
      identity,
      requestId,
      operation: { operationId, operationVersion: "1.0" },
      dataScopes: [dataScope],
      datasetScopes: identity.datasetScopes
    });
    const deadlineAt = new Date(Date.now() + Math.min(descriptor.execution.maximumTimeoutMs, 25_000));
    const context: GatewayRequestContext = { requestId, delegationToken: delegation.token, deadlineAt };
    const response = await client.executeOperation(lock, {
      requestVersion: "1.0",
      requestId,
      idempotencyKey: `${runId}:${callNo}:${operationId}`,
      operationVersion: "1.0",
      inputSchemaHash: lock.inputSchemaHash,
      outputSchemaHash: lock.outputSchemaHash,
      input,
      executionPolicy: {
        deadlineAt: deadlineAt.toISOString(),
        maximumResultBytes: descriptor.limits.maximumOutputBytes ?? 16_777_216,
        ...(descriptor.limits.maximumRows === undefined ? {} : { maximumRows: descriptor.limits.maximumRows }),
        ...(descriptor.limits.maximumCandidates === undefined ? {} : { maximumCandidates: descriptor.limits.maximumCandidates }),
        maximumCostClass: descriptor.execution.costClass,
        preferredExecution: descriptor.execution.mode === "SYNC" ? "SYNC" : "AUTO"
      }
    }, context);
    let envelope: JsonObject;
    if (response.status === 200) {
      envelope = object(response.value, "HISTORY_SMOKE_ENVELOPE_INVALID");
    } else {
      const accepted = object(response.value, "HISTORY_SMOKE_JOB_INVALID");
      const terminal = await client.pollJob(text(accepted["jobId"], "HISTORY_SMOKE_JOB_ID_MISSING"), context);
      envelope = object(terminal["result"], "HISTORY_SMOKE_JOB_RESULT_MISSING");
    }
    const output = object(envelope["output"], `HISTORY_SMOKE_OUTPUT_MISSING_${operationId}`);
    if (output["schemaHash"] !== lock.outputSchemaHash) throw new Error(`HISTORY_SMOKE_OUTPUT_SCHEMA_MISMATCH_${operationId}`);
    return output["value"];
  }

  const configuration = historicalTraceConfigurationFromEnvironment({
    ...process.env,
    WSGS_HISTORY_TRACE_ENABLED: "YES"
  });
  const interval = await executeHistoricalTrace({
    configuration,
    gateway: { execute },
    taskReferenceKeys: [taskReferenceKey],
    intent: {
      queryKind: "EXECUTION_INTERVAL",
      taskReferenceKey,
      executionSelection: { kind: "LATEST" },
      phaseScope: "EXECUTION_ENVELOPE",
      sourceSelection: { mode: "ONLY_CANDIDATE" },
      maximumInlinePoints: configuration.maximumInlinePoints
    }
  });
  const trajectory = await executeHistoricalTrace({
    configuration,
    gateway: { execute },
    taskReferenceKeys: [taskReferenceKey],
    subjectReferenceKeys: [subjectReferenceKey],
    intent: {
      queryKind: "HISTORICAL_TRAJECTORY",
      taskReferenceKey,
      subjectReferenceKey,
      executionSelection: { kind: "LATEST" },
      phaseScope: "EXECUTION_ENVELOPE",
      sourceSelection: { mode: "ONLY_CANDIDATE" },
      maximumInlinePoints: configuration.maximumInlinePoints
    }
  });
  process.stdout.write(`${JSON.stringify({
    marker: "WSGS_HISTORY_SMOKE_PASS",
    interval: { status: interval.status, reasonCode: interval.reasonCode, operations: interval.operations },
    trajectory: { status: trajectory.status, reasonCode: trajectory.reasonCode, operations: trajectory.operations }
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "HISTORY_SMOKE_FAILED";
  process.stderr.write(`${JSON.stringify({ marker: "WSGS_HISTORY_SMOKE_FAIL", error: message })}\n`);
  process.exitCode = 1;
});
