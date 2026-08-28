import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createGroundingIdentity, GowmDelegationSigner } from "@wsgs/delegated-identity";
import { evaluateGdpsCurrentOnlyReplay } from "@wsgs/gowm-execution-evidence";
import { GowmGatewayClient, type CapabilityDescriptor, type OperationLock } from "@wsgs/gowm-gateway-client";

type JsonObject = Record<string, unknown>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonObject;
}

function list(name: string): string[] {
  return required(name).split(/[ ,]+/u).map((entry) => entry.trim()).filter(Boolean);
}

const reportPath = resolve(process.env["WSGS_GDPS_W29_REPORT"] ?? "reports/wsgs-v0.2-gdps/development-closure-gate.json");
const report = object(JSON.parse(readFileSync(reportPath, "utf8")), "W29_REPORT_INVALID");
const gdps = object(report["gdps"], "W29_GDPS_INVALID");
const cases = Array.isArray(gdps["cases"]) ? gdps["cases"].map((entry) => object(entry, "W29_CASE_INVALID")) : [];
const sourceCase = cases.find((entry) => Array.isArray(entry["contentHashes"]) && entry["contentHashes"].length > 0);
if (!sourceCase) throw new Error("W29_CURRENT_SOURCE_IDENTITY_MISSING");
const productId = (sourceCase["productIds"] as unknown[]).find((entry) => typeof entry === "string" && entry.startsWith("gdps-"));
const contentHash = (sourceCase["contentHashes"] as unknown[]).find((entry) => typeof entry === "string" && /^sha256:[0-9a-f]{64}$/u.test(entry));
if (typeof productId !== "string" || typeof contentHash !== "string") throw new Error("W29_CURRENT_SOURCE_IDENTITY_INVALID");

const operationId = "geo-product.check-current";
const operationVersion = "1.0";
const baseUrl = required("GOWM_GATEWAY_BASE_URL");
const credential = required("GOWM_GATEWAY_TOKEN");
const client = new GowmGatewayClient({ baseUrl, credential: () => credential, timeoutMs: 30_000, maxRetries: 1 });
const catalog = await client.listCapabilities();
const semantics = await client.listCapabilitySemantics();
const descriptor = catalog.capabilities.find((entry) => entry.operationId === operationId && entry.operationVersion === operationVersion);
const semantic = semantics.profiles.find((entry) => entry.operationId === operationId && entry.operationVersion === operationVersion);
if (!descriptor || !semantic || descriptor.maturity !== "PREVIEW") throw new Error("CHECK_CURRENT_CAPABILITY_MISSING");
const lock: OperationLock = {
  operationId,
  operationVersion,
  maturity: "PREVIEW",
  inputSchemaHash: descriptor.inputSchemaHash,
  outputSchemaHash: descriptor.outputSchemaHash,
  semanticProfileHash: semantic.semanticProfileHash
};
const identity = createGroundingIdentity({
  servicePrincipalId: required("GOWM_DELEGATION_SERVICE_PRINCIPAL_ID"),
  actorId: required("WSGS_READINESS_ACTOR_ID"),
  dataScopes: [required("WSGS_READINESS_DATA_SCOPE")],
  datasetScopes: list("WSGS_READINESS_DATASET_SCOPES"),
  permissions: list("WSGS_READINESS_PERMISSIONS")
});
const signer = new GowmDelegationSigner({
  issuer: required("GOWM_DELEGATION_ISSUER"),
  audience: required("GOWM_DELEGATION_AUDIENCE"),
  servicePrincipalId: identity.servicePrincipalId,
  privateKeyPkcs8: readFileSync(required("GOWM_DELEGATION_PRIVATE_KEY_FILE"), "utf8"),
  trustedOperationKeys: [`${operationId}@${operationVersion}`],
  maximumTtlSeconds: 300,
  defaultTtlSeconds: 120
});
await signer.ready();

async function check(label: string, requestedProductId: string, requestedHash: string): Promise<JsonObject> {
  const requestId = `wsgs-gdps-current-${label}-${createHash("sha256").update(`${Date.now()}:${label}`).digest("hex").slice(0, 16)}`;
  const delegation = await signer.sign({
    kind: "DIRECT_OPERATION",
    identity,
    requestId,
    dataScopes: identity.dataScopes,
    datasetScopes: identity.datasetScopes,
    operation: { operationId, operationVersion }
  });
  const request = {
    requestVersion: "1.0",
    requestId,
    idempotencyKey: `${requestId}:check`,
    operationVersion,
    inputSchemaHash: descriptor.inputSchemaHash,
    outputSchemaHash: descriptor.outputSchemaHash,
    input: { productId: requestedProductId, contentHash: requestedHash },
    executionPolicy: {
      deadlineAt: new Date(Date.now() + Math.min(descriptor.execution.maximumTimeoutMs, 25_000)).toISOString(),
      maximumResultBytes: descriptor.limits.maximumOutputBytes ?? 1_048_576,
      maximumCostClass: descriptor.execution.costClass,
      preferredExecution: "SYNC"
    }
  };
  const response = await client.executeOperation(lock, request, {
    requestId,
    delegationToken: delegation.token,
    deadlineAt: new Date(Date.now() + 30_000)
  });
  const envelope = response.status === 200
    ? object(response.value, "CHECK_CURRENT_ENVELOPE_INVALID")
    : object((await client.pollJob(String(object(response.value, "CHECK_CURRENT_JOB_INVALID")["jobId"]), {
        requestId,
        delegationToken: delegation.token,
        deadlineAt: new Date(Date.now() + 30_000)
      }))["result"], "CHECK_CURRENT_JOB_RESULT_INVALID");
  if (envelope["status"] !== "COMPLETED") throw new Error(`CHECK_CURRENT_${label}_NOT_COMPLETED`);
  const operation = object(envelope["operation"], "CHECK_CURRENT_OPERATION_INVALID");
  const output = object(envelope["output"], "CHECK_CURRENT_OUTPUT_INVALID");
  if (operation["operationId"] !== operationId || operation["operationVersion"] !== operationVersion ||
    output["schemaHash"] !== descriptor.outputSchemaHash) throw new Error("CHECK_CURRENT_AUTHORITY_MISMATCH");
  return object(output["value"], "CHECK_CURRENT_VALUE_INVALID");
}

const changedInputHash = `sha256:${"0".repeat(64)}`;
const current = await check("current", productId, contentHash);
const changed = await check("changed", productId, changedInputHash);
const missing = await check("missing", "wsgs-missing-product", contentHash);
if (current["currentness"] !== "CURRENT" || current["currentContentHash"] !== contentHash ||
  changed["currentness"] !== "CHANGED" || changed["currentContentHash"] !== contentHash ||
  missing["currentness"] !== "NOT_AVAILABLE" || missing["currentContentHash"] !== undefined) {
  throw new Error("CHECK_CURRENT_TRUTH_MISMATCH");
}

const prior = { productId, contentHash: contentHash as `sha256:${string}` };
const actual = { productId, currentness: "CURRENT" as const, currentContentHash: contentHash as `sha256:${string}` };
const changedPrior = { productId, contentHash: changedInputHash as `sha256:${string}` };
const changedCheck = { productId, currentness: "CHANGED" as const, currentContentHash: contentHash as `sha256:${string}` };
const missingPrior = { productId: "wsgs-missing-product", contentHash: contentHash as `sha256:${string}` };
const missingCheck = { productId: missingPrior.productId, currentness: "NOT_AVAILABLE" as const };
const decisions = {
  current: ["PINNED", "STRICT", "BEST_EFFORT"].map((mode) => evaluateGdpsCurrentOnlyReplay(mode as "PINNED" | "STRICT" | "BEST_EFFORT", prior, actual)),
  changed: ["PINNED", "STRICT", "BEST_EFFORT"].map((mode) => evaluateGdpsCurrentOnlyReplay(mode as "PINNED" | "STRICT" | "BEST_EFFORT", changedPrior, changedCheck)),
  notAvailable: ["PINNED", "STRICT", "BEST_EFFORT"].map((mode) => evaluateGdpsCurrentOnlyReplay(mode as "PINNED" | "STRICT" | "BEST_EFFORT", missingPrior, missingCheck))
};

const evidence = {
  schemaVersion: "wsgs-gdps-current-only-replay/1.0",
  status: "PASS",
  executionClassification: "REAL_EXTERNAL_DEPENDENCIES",
  gatewayOnly: true,
  directProviderCalls: false,
  sourceCaseId: sourceCase["caseId"],
  productId,
  contentHash,
  operation: `${operationId}@${operationVersion}`,
  liveChecks: {
    current: { currentness: current["currentness"], currentContentHash: current["currentContentHash"], status: "PASS" },
    changed: { currentness: changed["currentness"], currentContentHash: changed["currentContentHash"], status: "PASS" },
    notAvailable: { currentness: missing["currentness"], status: "PASS" }
  },
  decisions,
  productVersionSemanticsPresent: false,
  credentialsIncluded: false,
  marker: "GDPS_CURRENT_ONLY_REPLAY_READY"
};
if (process.argv.includes("--write")) {
  writeFileSync(resolve("reports/wsgs-v0.2-gdps/w30-current-only-replay.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}
process.stdout.write(`${JSON.stringify({
  marker: "WSGS_GDPS_CURRENT_ONLY_GATE_PASS",
  operation: evidence.operation,
  currentness: [current["currentness"], changed["currentness"], missing["currentness"]],
  decisionCount: decisions.current.length + decisions.changed.length + decisions.notAvailable.length
}, null, 2)}\n`);
