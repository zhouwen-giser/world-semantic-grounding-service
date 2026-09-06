import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createGroundingIdentity, GowmDelegationSigner } from "@wsgs/delegated-identity";
import { AnalysisProviderContracts, analysisHash, loadOperationalGowmLock, loadWorldQueryParameterSchemaHash } from "@wsgs/gowm-contract-intake";
import { GowmGatewayClient, type OperationLock } from "@wsgs/gowm-gateway-client";
import { advancedHistoryConfigurationFromEnvironment, historicalTraceConfigurationFromEnvironment, MetricSemanticCatalog,
  parseAdvancedHistoricalIntent, executeAdvancedHistoricalAnalysis, type HistoricalReferenceKey } from "@wsgs/historical-trace-consumer";

const help = `Advanced historical analysis development smoke.
Default / --help: help only; no network or Docker.
--fixture: committed Provider envelopes, mock Gateway and regression tests.
--live: four Gateway scenarios: roads, last CROSS, ENTER, metric ranking.
Required live settings:
GOWM_GATEWAY_BASE_URL (or GOWM_GATEWAY_URL), GOWM_GATEWAY_TOKEN,
GOWM_SOUTHBOUND_LOCK_FILE, GOWM_SOUTHBOUND_LOCK_SHA256,
GOWM_DELEGATION_ISSUER, GOWM_DELEGATION_AUDIENCE,
GOWM_DELEGATION_SERVICE_PRINCIPAL_ID, GOWM_DELEGATION_PRIVATE_KEY_FILE,
WSGS_READINESS_DATA_SCOPE, WSGS_READINESS_PERMISSIONS,
WSGS_HISTORY_SMOKE_TASK_REFERENCE_JSON, WSGS_HISTORY_SMOKE_SUBJECT_REFERENCE_JSON,
WSGS_ADVANCED_HISTORY_SMOKE_TARGET_REFERENCE_JSON.
Metric mapping uses the configured WSGS metric catalog. No direct Provider calls.
Missing live configuration is NOT_RUN, never PASS. No deployment or execution.
`;
const requiredNames = ["GOWM_GATEWAY_TOKEN", "GOWM_SOUTHBOUND_LOCK_FILE", "GOWM_SOUTHBOUND_LOCK_SHA256", "GOWM_DELEGATION_ISSUER",
  "GOWM_DELEGATION_AUDIENCE", "GOWM_DELEGATION_SERVICE_PRINCIPAL_ID", "GOWM_DELEGATION_PRIVATE_KEY_FILE", "WSGS_READINESS_DATA_SCOPE",
  "WSGS_READINESS_PERMISSIONS", "WSGS_HISTORY_SMOKE_TASK_REFERENCE_JSON", "WSGS_HISTORY_SMOKE_SUBJECT_REFERENCE_JSON", "WSGS_ADVANCED_HISTORY_SMOKE_TARGET_REFERENCE_JSON"];
function required(key: string): string { const value = process.env[key]; if (!value) throw new Error("SMOKE_CONFIGURATION_UNAVAILABLE"); return value; }
function reference(key: string, kind?: string): HistoricalReferenceKey {
  const value = JSON.parse(required(key)) as HistoricalReferenceKey;
  if (value.namespace !== "gowm" || !value.id || !value.version || (kind && value.kind !== kind)) throw new Error("SMOKE_REFERENCE_INVALID");
  return value;
}
async function live(): Promise<void> {
  const url = process.env["GOWM_GATEWAY_BASE_URL"] ?? process.env["GOWM_GATEWAY_URL"];
  if (!url || requiredNames.some(key => !process.env[key])) {
    process.stdout.write(`${JSON.stringify({ status: "NOT_RUN", reason: !url ? "GOWM_GATEWAY_URL_UNAVAILABLE" : "LIVE_SMOKE_CONFIGURATION_UNAVAILABLE" })}\n`); return;
  }
  const configuration = advancedHistoryConfigurationFromEnvironment({ ...process.env, WSGS_ADVANCED_HISTORY_ENABLED: "YES" });
  const history = historicalTraceConfigurationFromEnvironment({ ...process.env, WSGS_HISTORY_TRACE_ENABLED: "YES" });
  const contracts = new AnalysisProviderContracts(configuration.contractRoot);
  const catalog = MetricSemanticCatalog.load(configuration.metricCatalogPath);
  const loaded = loadOperationalGowmLock({ lockPath: required("GOWM_SOUTHBOUND_LOCK_FILE"), expectedSha256: required("GOWM_SOUTHBOUND_LOCK_SHA256") as `sha256:${string}`,
    hashMode: "EXACT_BYTES", operationCountPolicy: "HASH_LOCKED_EXTENSION" });
  const allowedKeys = new Set(["operational-task.find@1.0", "operational-task.get@1.0", "operational-task.get-execution-intervals@1.0", "history.get-trajectory@1.0",
    "world.get-geometry@1.0", ...contracts.authorizations.map(a => `${a.operationId}@${a.operationVersion}`)]);
  const locks = [...loaded.lock.defaultOperations, ...loaded.lock.previewOperations].filter(lock => allowedKeys.has(`${lock.operationId}@${lock.operationVersion}`)) as OperationLock[];
  const dataScope = required("WSGS_READINESS_DATA_SCOPE");
  const identity = createGroundingIdentity({ servicePrincipalId: required("GOWM_DELEGATION_SERVICE_PRINCIPAL_ID"), actorId: "wsgs-advanced-history-smoke",
    dataScopes: [dataScope], datasetScopes: (process.env["WSGS_READINESS_DATASET_SCOPES"] ?? "").split(/[ ,]+/).filter(Boolean),
    permissions: required("WSGS_READINESS_PERMISSIONS").split(/[ ,]+/).filter(Boolean) });
  const signer = new GowmDelegationSigner({ issuer: required("GOWM_DELEGATION_ISSUER"), audience: required("GOWM_DELEGATION_AUDIENCE"),
    servicePrincipalId: identity.servicePrincipalId, privateKeyPkcs8: readFileSync(required("GOWM_DELEGATION_PRIVATE_KEY_FILE"), "utf8"), trustedOperationKeys: [...allowedKeys] });
  await signer.ready();
  const client = new GowmGatewayClient({ baseUrl: url, credential: () => required("GOWM_GATEWAY_TOKEN"), timeoutMs: 30000, maxRetries: 1 });
  const capabilities = await client.listCapabilities();
  const semantics = await client.listCapabilitySemantics();
  const token = await signer.sign({ kind: "WORLD_QUERY", identity, requestId: "advanced-smoke-availability",
    plan: { nodes: locks.map((lock, i) => ({ nodeId: `smoke-${i}`, operation: { operationId: lock.operationId, operationVersion: lock.operationVersion } })) },
    dataScopes: [dataScope], datasetScopes: identity.datasetScopes });
  const availability = await client.listOperationAvailability({ requestId: "advanced-smoke-availability", delegationToken: token.token, deadlineAt: new Date(Date.now() + 30000) });
  const task = reference("WSGS_HISTORY_SMOKE_TASK_REFERENCE_JSON", "OPERATIONAL_TASK");
  const subject = reference("WSGS_HISTORY_SMOKE_SUBJECT_REFERENCE_JSON", "WORLD_OBJECT");
  const target = reference("WSGS_ADVANCED_HISTORY_SMOKE_TARGET_REFERENCE_JSON");
  const results = [];
  for (const text of ["2号车本次任务经过哪些道路", "2号车最后经过哪个路口", "2号车什么时候进入A区", "2号车任务期间通信信号最好的位置"]) {
    const parsed = parseAdvancedHistoricalIntent(text, catalog, configuration);
    if (parsed.status !== "PARSED") throw new Error("SMOKE_INTENT_INVALID");
    parsed.intent.historicalScope.taskReferenceKey = task; parsed.intent.historicalScope.subjectReferenceKey = subject;
    const requestId = `advanced-smoke-${randomUUID()}`;
    const deadlineAt = new Date(Date.now() + 30000);
    const execute = async (operationId: string, input: Record<string, unknown>, key: string, maxOutput = 1048576) => {
      const lock = locks.find(entry => entry.operationId === operationId);
      if (!lock) throw new Error("SMOKE_CAPABILITY_NOT_REGISTERED");
      const signed = await signer.sign({ kind: "DIRECT_OPERATION", identity, requestId,
        operation: { operationId, operationVersion: lock.operationVersion }, dataScopes: [dataScope], datasetScopes: identity.datasetScopes });
      const context = { requestId, delegationToken: signed.token, deadlineAt };
      const response = await client.executeOperation(lock, { requestVersion: "1.0", requestId, idempotencyKey: `${requestId}:${key}`,
        operationVersion: lock.operationVersion, inputSchemaHash: lock.inputSchemaHash, outputSchemaHash: lock.outputSchemaHash, input,
        executionPolicy: { deadlineAt: deadlineAt.toISOString(), maximumResultBytes: maxOutput, maximumRows: 250000, maximumCandidates: 250000,
          maximumCostClass: "MEDIUM", preferredExecution: "SYNC" } }, context);
      if (response.status !== 200) throw new Error("SMOKE_SYNC_RESULT_REQUIRED");
      return response.value as Record<string, unknown>;
    };
    const result = await executeAdvancedHistoricalAnalysis({ intent: parsed.intent, configuration, history, contracts, catalog, deadlineAt,
      taskReferenceKeys: [task], subjectReferenceKeys: [subject],
      compileContext: { requestId, idempotencyKey: requestId, capabilities: capabilities.capabilities, semanticProfiles: semantics.profiles,
        availability: availability.operations, operationLocks: locks, grantedPermissions: identity.permissions, parameterSchemaHash: loadWorldQueryParameterSchemaHash(),
        budgets: { maximumNodes: 2, maximumDepth: 2, maximumRows: 250000, maximumCandidates: 250000, maximumOutputBytes: 1048576, maximumExecutionMs: 30000 } },
      foundationGateway: { execute: async (id, input) => {
        const envelope = await execute(id, input, `${id}:${analysisHash(input)}`);
        return (envelope["output"] as { value: unknown }).value;
      } },
      gateway: { execute: (id, input, options) => execute(id, input, options.idempotencyKey, options.budget.maximumOutputBytes) },
      resolveTarget: async () => {
        const envelope = await execute("world.get-geometry", { schemaVersion: "1.0", referenceKey: target }, `target:${analysisHash(target)}`);
        const value = (envelope["output"] as { value: { referenceKey: unknown; facts: Array<Record<string, unknown>> } }).value;
        const fact = value.facts.find(entry => entry["factKind"] === "CURRENT_GEOMETRY");
        if (!fact || analysisHash(value.referenceKey) !== analysisHash(target)) return { reasonCode: "TARGET_GEOMETRY_UNAVAILABLE" };
        return contracts.validateTarget({ targetId: target.id, referenceKey: target, displayName: "A区", targetType: "AREA", geometry: fact["geometry"], crs: fact["crs"] });
      } });
    results.push({ status: result.status, reasonCode: result.reasonCode, operations: result.operations, evidenceCount: result.analysisEvidence.length });
  }
  const passed = results.every(result => ["COMPLETED", "PARTIAL"].includes(result.status) && result.evidenceCount > 0);
  process.stdout.write(`${JSON.stringify({ status: passed ? "PASS" : "FAIL", results }, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
}
if (process.argv.includes("--fixture")) {
  execFileSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "packages/historical-trace-consumer/src/advanced-historical.test.ts", "packages/query-compiler/src/advanced-history.test.ts", "packages/gowm-contract-intake/src/analysis-provider-contracts.test.ts", "services/grounding-worker/src/advanced-history-integration.test.ts"], { stdio: "inherit" });
} else if (process.argv.includes("--live")) {
  live().catch(() => { process.stderr.write('{"status":"FAIL","reason":"ADVANCED_HISTORY_SMOKE_FAILED"}\n'); process.exitCode = 1; });
} else { process.stdout.write(help); }
