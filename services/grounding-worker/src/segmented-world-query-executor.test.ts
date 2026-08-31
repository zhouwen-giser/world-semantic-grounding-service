import {
  authorizationContextHash,
  type DelegationRequest,
  type GroundingIdentityV2,
  type SignedDelegation
} from "@wsgs/delegated-identity";
import type { CapabilityDescriptor, GatewayRequestContext, OperationLock } from "@wsgs/gowm-gateway-client";
import { canonicalSha256 } from "@wsgs/gowm-execution-evidence";
import type { WorldQueryNode, WorldQuerySubmission } from "@wsgs/query-compiler";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  SegmentedWorldQueryError,
  executeSegmentedWorldQuery,
  type AcceptedSegmentCheckpoint,
  type SegmentedGatewayClient
} from "./segmented-world-query-executor.js";
import { loadSegmentedScopeAuthority } from "./segmented-scope-authority.js";

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const foundationScope = "wsgs-demo";
const selectedScope = "scope-gdps-v021-baseline";
const port = (name: string, hash: `sha256:${string}`, path?: string) => ({
  schemaUri: `urn:test:${name}`,
  schemaHash: hash,
  valueKind: "ANY" as const,
  unitSemantics: "UNSPECIFIED" as const,
  ...(path === undefined ? {} : { path })
});

const foundationLock: OperationLock = {
  operationId: "reference.resolve",
  operationVersion: "1.0",
  maturity: "STABLE",
  inputSchemaHash: digest("1"),
  outputSchemaHash: digest("2"),
  semanticProfileHash: digest("3")
};

const gdpsLock: OperationLock = {
  operationId: "landcover.get-class",
  operationVersion: "1.0",
  maturity: "PREVIEW",
  inputSchemaHash: digest("4"),
  outputSchemaHash: digest("5"),
  semanticProfileHash: digest("6")
};

function descriptor(
  lock: OperationLock,
  output: CapabilityDescriptor["ports"]["outputs"][number]
): CapabilityDescriptor {
  return {
    operationId: lock.operationId,
    operationVersion: lock.operationVersion,
    semanticRole: lock.maturity === "STABLE" ? "FOUNDATION_PRIMITIVE" : "DOMAIN_ANALYSIS",
    dataBinding: "CALLER_DATA_BOUND",
    resultSemantics: "DATA_QUERY",
    executionBindings: ["SYNC_HTTP"],
    criticalPathPolicy: "REMOTE_ALLOWED",
    maturity: lock.maturity,
    inputSchemaUri: `urn:test:${lock.operationId}:input`,
    inputSchemaHash: lock.inputSchemaHash,
    outputSchemaUri: `urn:test:${lock.operationId}:output`,
    outputSchemaHash: lock.outputSchemaHash,
    scopePolicy: "DATA_SCOPE_REQUIRED",
    ports: {
      inputs: lock.operationId === foundationLock.operationId
        ? [{ name: "request", ...port("resolve-input", foundationLock.inputSchemaHash) }]
        : [
            { name: "referenceKey", ...port("reference-key-input", digest("7")) },
            { name: "confidence", ...port("confidence-input", digest("8")) }
          ],
      outputs: [output]
    },
    execution: { costClass: "LOW", mode: "SYNC_OR_ASYNC", defaultTimeoutMs: 1_000, maximumTimeoutMs: 2_000 },
    limits: { maximumOutputBytes: 8_192, maximumRows: 4, maximumCandidates: 4 },
    snapshotPolicy: { dataSnapshot: "REQUIRED", computeSnapshot: "REQUIRED" }
  };
}

function capabilities(): CapabilityDescriptor[] {
  return [
    descriptor(foundationLock, {
      name: "result",
      ...port("reference-key", foundationLock.outputSchemaHash, "/candidate/referenceKey")
    }),
    descriptor(gdpsLock, {
      name: "result",
      ...port("classification", gdpsLock.outputSchemaHash, "/classification")
    })
  ];
}

const authorityFixtureRoot = mkdtempSync(join(tmpdir(), "wsgs-segmented-executor-authority-"));
const foundationHandoff = join(authorityFixtureRoot, "gowm");
const gdpsHandoff = join(authorityFixtureRoot, "gdps");
mkdirSync(foundationHandoff);
mkdirSync(gdpsHandoff);
const lockProjection = (value: OperationLock, availability = false) => ({
  operationId: value.operationId,
  operationVersion: value.operationVersion,
  inputSchemaHash: value.inputSchemaHash,
  outputSchemaHash: value.outputSchemaHash,
  semanticProfileHash: value.semanticProfileHash,
  maturity: value.maturity,
  ...(availability ? { availability: "AVAILABLE" } : {})
});
writeFileSync(join(foundationHandoff, "INSTANCE_MANIFEST.json"), JSON.stringify({
  schemaVersion: "1.0", runtimeInstanceId: "runtime-test", instanceId: "instance",
  fixtureId: "fixture", fixtureVersion: "1.0.0",
  authMode: "SIGNED_DELEGATION_V1", dataScope: foundationScope,
  operationLockHash: digest("a"), stableOperations: ["reference.resolve@1.0"]
}));
writeFileSync(join(foundationHandoff, "INSTANCE_BINDING.json"), JSON.stringify({
  schemaVersion: "1.0", runtimeInstanceId: "runtime-test", instanceId: "instance",
  fixtureId: "fixture", fixtureVersion: "1.0.0",
  operationContracts: [lockProjection(foundationLock)]
}));
const datasetBytes = Buffer.from(JSON.stringify({
  schemaVersion: "gdps-v021-sample-dataset-lock/1.0", scope: selectedScope, products: []
}));
const capabilityBytes = Buffer.from(JSON.stringify({
  schemaVersion: "gdps-v021-capability-lock/1.0", providerId: "gdps.geospatial-products",
  operations: [lockProjection(gdpsLock, true)]
}));
writeFileSync(join(gdpsHandoff, "GDPS_SAMPLE_DATASET_LOCK.json"), datasetBytes);
writeFileSync(join(gdpsHandoff, "GDPS_CAPABILITY_LOCK.json"), capabilityBytes);
const exactHash = (bytes: Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
writeFileSync(join(gdpsHandoff, "CHECKSUMS.json"), JSON.stringify({
  schemaVersion: "wsgs-gdps-v021-checksums/1.0",
  algorithm: "SHA-256",
  files: [
    ["GDPS_CAPABILITY_LOCK.json", exactHash(capabilityBytes)],
    ["GDPS_CONSUMER_LOCK.json", digest("b")],
    ["GDPS_PRODUCT_DESCRIPTOR_LOCK.json", digest("c")],
    ["GDPS_RECIPE_LOCK.json", digest("d")],
    ["GDPS_SAMPLE_DATASET_LOCK.json", exactHash(datasetBytes)],
    ["GOWM_GATEWAY_BINDING_LOCK.json", digest("e")],
    ["WSGS_QUERY_CORPUS.json", digest("f")],
    ["WSGS_TEST_BASELINE.json", digest("0")]
  ].map(([path, sha256]) => ({ path, sha256 })),
  bundleHash: digest("9")
}));
const loadedAuthority = loadSegmentedScopeAuthority({
  foundationHandoffDirectory: foundationHandoff,
  gdpsHandoffDirectory: gdpsHandoff,
  foundationOperations: [foundationLock],
  selectedDatasetOperations: [gdpsLock]
}).authority;
const authority = () => loadedAuthority;

afterAll(() => rmSync(authorityFixtureRoot, { recursive: true, force: true }));

function identity(scopes = [foundationScope, selectedScope]): GroundingIdentityV2 {
  const value = {
    servicePrincipalId: "wsgs",
    actorId: "test-actor",
    dataScopes: [...scopes].sort(),
    datasetScopes: ["wsgs-demo-main"],
    permissions: ["world.read"]
  };
  return { ...value, authorizationContextHash: authorizationContextHash(value) };
}

function sourceSubmission(
  nodes?: WorldQueryNode[],
  snapshotPolicy: WorldQuerySubmission["snapshotPolicy"] = { mode: "BEST_EFFORT", allowDowngrade: false }
): WorldQuerySubmission {
  const resolve: WorldQueryNode = {
    nodeId: "resolve",
    operation: {
      operationId: foundationLock.operationId,
      operationVersion: foundationLock.operationVersion,
      inputSchemaHash: foundationLock.inputSchemaHash,
      outputSchemaHash: foundationLock.outputSchemaHash
    },
    inputs: {
      request: {
        kind: "REQUEST_PATH",
        port: port("resolve-input", foundationLock.inputSchemaHash),
        path: "/resolveRequest"
      }
    },
    failurePolicy: "FAIL_FAST",
    budget: {
      maximumRows: 4,
      maximumCandidates: 4,
      maximumOutputBytes: 8_192,
      maximumExecutionMs: 2_000
    }
  };
  const classify: WorldQueryNode = {
    nodeId: "classify",
    operation: {
      operationId: gdpsLock.operationId,
      operationVersion: gdpsLock.operationVersion,
      inputSchemaHash: gdpsLock.inputSchemaHash,
      outputSchemaHash: gdpsLock.outputSchemaHash
    },
    inputs: {
      referenceKey: {
        kind: "NODE_OUTPUT",
        port: port("reference-key", foundationLock.outputSchemaHash),
        nodeId: "resolve",
        outputPort: "result",
        path: "/candidate/referenceKey",
        targetPath: "/referenceKey"
      },
      confidence: {
        kind: "LITERAL",
        port: port("confidence", digest("7")),
        value: 0.9,
        targetPath: "/minimumConfidence"
      }
    },
    failurePolicy: "FAIL_FAST",
    budget: {
      maximumRows: 4,
      maximumCandidates: 4,
      maximumOutputBytes: 8_192,
      maximumExecutionMs: 2_000
    }
  };
  return {
    requestId: "request-segmented-1",
    idempotencyKey: "idem-segmented-1",
    plan: {
      queryPlanVersion: "2.0",
      queryId: "query-segmented-1",
      // Deliberately not dependency-ordered: the executor must sort the DAG.
      nodes: nodes ?? [classify, resolve],
      outputs: [{
        name: "classification",
        binding: {
          kind: "NODE_OUTPUT",
          port: port("classification", gdpsLock.outputSchemaHash),
          nodeId: "classify",
          outputPort: "result",
          path: "/classification"
        }
      }, {
        // The same source selector is also consumed downstream with a targetPath.
        // Segmentation must not confuse the consumer target with source identity.
        name: "areaReference",
        binding: {
          kind: "NODE_OUTPUT",
          port: port("reference-key", foundationLock.outputSchemaHash),
          nodeId: "resolve",
          outputPort: "result",
          path: "/candidate/referenceKey"
        }
      }],
      budgets: {
        maximumNodes: 2,
        maximumDepth: 2,
        maximumRows: 8,
        maximumCandidates: 8,
        maximumOutputBytes: 16_384,
        maximumExecutionMs: 4_000
      }
    },
    parameters: {
      resolveRequest: {
        schemaVersion: "1.0",
        mentions: [{ mentionId: "m1", surfaceText: "A区" }]
      }
    },
    parameterSchemaHash: digest("8"),
    snapshotPolicy
  };
}

function pinnedSnapshotPolicy(): WorldQuerySubmission["snapshotPolicy"] {
  const body = {
    querySnapshotId: "snapshot-pinned-cross-scope",
    mode: "PINNED" as const,
    consistency: "PINNED" as const,
    capturedAt: "2026-08-31T00:00:00.000Z",
    resources: [
      {
        resourceKind: "WORLD_OBJECT",
        resourceId: foundationLock.operationId,
        version: "1.0.0",
        pinning: "PINNED"
      },
      {
        resourceKind: "DATASET",
        resourceId: gdpsLock.operationId,
        version: "1.0.0",
        pinning: "PINNED"
      }
    ]
  };
  return {
    mode: "PINNED",
    allowDowngrade: false,
    pinnedSnapshot: { ...body, manifestHash: canonicalSha256(body) }
  };
}

function envelope(lock: OperationLock, value: unknown, receiptId: string, inputHash: `sha256:${string}`) {
  const provider = { providerId: "test.provider", providerVersion: "1", implementationDigest: digest("9") };
  const computeSnapshot = {
    operation: { operationId: lock.operationId, operationVersion: lock.operationVersion },
    schemas: { inputSchemaHash: lock.inputSchemaHash, outputSchemaHash: lock.outputSchemaHash },
    provider
  };
  const resultHash = canonicalSha256(value);
  return {
    providerProtocolVersion: "1.0",
    requestId: "upstream-request",
    operation: { operationId: lock.operationId, operationVersion: lock.operationVersion },
    status: "COMPLETED",
    computeSnapshot,
    output: { schemaUri: `urn:test:${lock.operationId}:output`, schemaHash: lock.outputSchemaHash, value },
    receipts: [{
      receiptId,
      operationId: lock.operationId,
      operationVersion: lock.operationVersion,
      providerId: provider.providerId,
      providerVersion: provider.providerVersion,
      inputHash,
      outputHash: resultHash,
      computeSnapshotHash: canonicalSha256(computeSnapshot)
    }],
    evidenceReferences: [],
    warnings: [],
    consumption: { outputBytes: 1 },
    execution: { providerId: provider.providerId, providerVersion: provider.providerVersion, elapsedMs: 1, resultHash }
  };
}

function testPointer(value: unknown, path: string | undefined): unknown {
  if (path === undefined) return value;
  let current = value;
  for (const encoded of path.slice(1).split("/")) {
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function testNodeInput(submission: WorldQuerySubmission): unknown {
  const node = submission.plan.nodes[0]!;
  const entries = Object.entries(node.inputs);
  if (entries.length === 1 && entries[0]![0] === "request" && entries[0]![1].targetPath === undefined) {
    return (entries[0]![1] as { value: unknown }).value;
  }
  const result: Record<string, unknown> = {};
  for (const [name, raw] of entries) {
    const binding = raw as { value: unknown; targetPath?: string };
    const target = (binding.targetPath ?? `/${name}`).slice(1);
    result[target] = binding.value;
  }
  return result;
}

function worldResult(submission: WorldQuerySubmission, lock: OperationLock, value: unknown, receiptId: string) {
  const node = submission.plan.nodes[0]!;
  const outputs = Object.fromEntries(submission.plan.outputs.map((output) => [
    output.name,
    testPointer(value, output.binding.path)
  ]));
  const inputHash = canonicalSha256(testNodeInput(submission));
  const resultEnvelope = envelope(lock, value, receiptId, inputHash);
  const manifestBody = {
    querySnapshotId: `snapshot-${node.nodeId}`,
    mode: "BEST_EFFORT" as const,
    consistency: "BEST_EFFORT" as const,
    capturedAt: "2026-08-31T00:00:00.000Z",
    resources: [{
      resourceKind: lock.maturity === "STABLE" ? "WORLD_OBJECT" : "DATASET",
      resourceId: lock.operationId,
      version: "1.0.0",
      pinning: "BEST_EFFORT"
    }]
  };
  const snapshotManifest = submission.snapshotPolicy.mode === "PINNED"
    ? submission.snapshotPolicy.pinnedSnapshot
    : { ...manifestBody, manifestHash: canonicalSha256(manifestBody) };
  return {
    queryPlanVersion: "2.0",
    queryId: submission.plan.queryId,
    jobId: `job-${node.nodeId}`,
    status: "COMPLETED",
    nodes: [{
      nodeId: node.nodeId,
      operation: { operationId: lock.operationId, operationVersion: lock.operationVersion },
      status: "COMPLETED",
      attempt: 1,
      inputHash,
      outputHash: canonicalSha256(resultEnvelope),
      result: resultEnvelope
    }],
    outputs,
    warnings: [],
    snapshotManifest,
    snapshotAdherence: [{
      nodeId: node.nodeId,
      status: "MATCHED",
      checkedResources: submission.snapshotPolicy.mode === "PINNED" ? 2 : 1,
      mismatches: []
    }],
    startedAt: "2026-08-31T00:00:00.000Z",
    finishedAt: "2026-08-31T00:00:01.000Z",
    outputHash: canonicalSha256(outputs)
  };
}

function signed(request: DelegationRequest): SignedDelegation {
  return {
    token: "signed.segment.token",
    jtiHash: digest(request.dataScopes?.[0] === foundationScope ? "f" : "0"),
    authorizationContextHash: request.identity.authorizationContextHash,
    allowedOperations: request.kind === "WORLD_QUERY"
      ? [(request.plan as { nodes: Array<{ operation: { operationId: string; operationVersion: string } }> })
        .nodes.map(({ operation }) => `${operation.operationId}@${operation.operationVersion}`)[0]!]
      : [`${request.operation.operationId}@${request.operation.operationVersion}`],
    dataScopes: request.dataScopes ?? request.identity.dataScopes,
    datasetScopes: request.datasetScopes ?? request.identity.datasetScopes,
    issuedAt: 1,
    expiresAt: 2
  };
}

describe("segmented world-query executor", () => {
  it("executes dependency-ordered single-node Gateway queries under exact trusted scopes", async () => {
    const requests: Array<{ submission: WorldQuerySubmission; context: GatewayRequestContext }> = [];
    const events: string[] = [];
    const signer = { sign: vi.fn(async (request: DelegationRequest) => signed(request)) };
    const gateway: SegmentedGatewayClient = {
      submitWorldQuery: vi.fn(async (request, context = {}) => {
        const submission = request as unknown as WorldQuerySubmission;
        requests.push({ submission, context });
        const node = submission.plan.nodes[0]!;
        if (node.nodeId === "resolve") {
          return {
            status: 200,
            value: worldResult(submission, foundationLock, {
              candidate: { referenceKey: { namespace: "gowm", kind: "LAYER_FEATURE", id: "area", version: "1.0.0" } }
            }, "receipt-resolve")
          };
        }
        events.push("submit-classify");
        return {
          status: 202,
          value: {
            jobId: "job-classify",
            requestId: submission.requestId,
            kind: "WORLD_QUERY",
            queryId: submission.plan.queryId,
            status: "QUEUED"
          }
        };
      }),
      pollJob: vi.fn(async () => {
        events.push("poll-classify");
        const submission = requests.at(-1)!.submission;
        return {
          jobId: "job-classify",
          requestId: submission.requestId,
          kind: "WORLD_QUERY",
          queryId: submission.plan.queryId,
          status: "COMPLETED",
          result: worldResult(submission, gdpsLock, { classification: "FOREST" }, "receipt-classify")
        };
      }),
      cancelWorldQuery: vi.fn()
    };
    let clock = 0;
    const execution = await executeSegmentedWorldQuery({
      submission: sourceSubmission(),
      authority: authority(),
      capabilities: capabilities(),
      identity: identity(),
      deadlineAt: new Date(Date.now() + 60_000),
      runtime: {
        gateway,
        signer,
        now: () => new Date(Date.UTC(2026, 7, 31, 0, 0, clock++)),
        onAccepted: async ({ nodeId }) => { events.push(`accepted-${nodeId}`); },
        onCompleted: async ({ nodeId }) => { events.push(`completed-${nodeId}`); }
      }
    });

    expect(requests.map(({ submission }) => submission.plan.nodes[0]!.nodeId)).toEqual(["resolve", "classify"]);
    expect(signer.sign.mock.calls.map(([request]) => request.dataScopes)).toEqual([
      [foundationScope],
      [selectedScope]
    ]);
    expect(requests[0]!.submission.plan.nodes[0]!.inputs["request"]).toMatchObject({
      kind: "LITERAL",
      value: { schemaVersion: "1.0", mentions: [{ mentionId: "m1", surfaceText: "A区" }] }
    });
    expect(requests[1]!.submission.plan.nodes[0]!.inputs).toMatchObject({
      referenceKey: {
        kind: "LITERAL",
        value: { namespace: "gowm", kind: "LAYER_FEATURE", id: "area", version: "1.0.0" },
        targetPath: "/referenceKey"
      },
      confidence: { kind: "LITERAL", value: 0.9, targetPath: "/minimumConfidence" }
    });
    expect(requests.every(({ submission }) => submission.plan.nodes.length === 1)).toBe(true);
    expect(requests.every(({ submission }) => submission.snapshotPolicy.mode === "BEST_EFFORT")).toBe(true);
    expect(new Set(requests.map(({ submission }) => submission.plan.queryId)).size).toBe(2);
    expect(events).toEqual([
      "completed-resolve",
      "submit-classify",
      "accepted-classify",
      "poll-classify",
      "completed-classify"
    ]);
    expect(execution).toMatchObject({
      schemaVersion: "wsgs-segmented-world-query-execution/1.0",
      executionMode: "GATEWAY_SEGMENTED_BY_TRUSTED_DATA_SCOPE",
      sourceQueryId: "query-segmented-1",
      status: "COMPLETED",
      outputs: { classification: "FOREST" }
    });
    expect(execution.segments.map(({ responseStatus }) => responseStatus)).toEqual([200, 202]);
    expect(execution.segments[0]!.worldResult.nodes).toHaveLength(1);
    expect(execution.segments[0]!.nodeResult.result).toMatchObject({
      receipts: [{ receiptId: "receipt-resolve" }]
    });
    expect(execution.segments[1]!.terminal).toMatchObject({ status: "COMPLETED" });
    expect(execution.segmentedExecutionHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(execution)).not.toContain("signed.segment.token");
  });

  it("preserves an authoritative PINNED snapshot across every segment", async () => {
    const requests: WorldQuerySubmission[] = [];
    const gateway: SegmentedGatewayClient = {
      submitWorldQuery: vi.fn(async (request) => {
        const submission = request as unknown as WorldQuerySubmission;
        requests.push(submission);
        const node = submission.plan.nodes[0]!;
        return node.nodeId === "resolve"
          ? {
              status: 200,
              value: worldResult(submission, foundationLock, {
                candidate: {
                  referenceKey: { namespace: "gowm", kind: "LAYER_FEATURE", id: "area", version: "1.0.0" }
                }
              }, "receipt-resolve")
            }
          : {
              status: 200,
              value: worldResult(submission, gdpsLock, { classification: "FOREST" }, "receipt-classify")
            };
      }),
      pollJob: vi.fn(),
      cancelWorldQuery: vi.fn()
    };

    await expect(executeSegmentedWorldQuery({
      submission: sourceSubmission(undefined, pinnedSnapshotPolicy()),
      authority: authority(),
      capabilities: capabilities(),
      identity: identity(),
      deadlineAt: new Date(Date.now() + 60_000),
      runtime: {
        gateway,
        signer: { sign: async (request) => signed(request) },
        onAccepted: async () => undefined
      }
    })).resolves.toMatchObject({ status: "COMPLETED" });
    expect(requests).toHaveLength(2);
    expect(requests.every(({ snapshotPolicy }) => snapshotPolicy.mode === "PINNED")).toBe(true);
    expect(new Set(requests.map(({ snapshotPolicy }) =>
      snapshotPolicy.mode === "PINNED" ? snapshotPolicy.pinnedSnapshot.manifestHash : undefined
    ))).toEqual(new Set([pinnedSnapshotPolicy().pinnedSnapshot.manifestHash]));
  });

  it("rejects LATEST_AT_START before signing or submitting any segment", async () => {
    const signer = { sign: vi.fn() };
    const submitWorldQuery = vi.fn();
    await expect(executeSegmentedWorldQuery({
      submission: sourceSubmission(undefined, { mode: "LATEST_AT_START", allowDowngrade: false }),
      authority: authority(),
      capabilities: capabilities(),
      identity: identity(),
      deadlineAt: new Date(Date.now() + 60_000),
      runtime: {
        signer,
        gateway: { submitWorldQuery, pollJob: vi.fn(), cancelWorldQuery: vi.fn() },
        onAccepted: async () => undefined
      }
    })).rejects.toMatchObject({ code: "SEGMENT_LATEST_AT_START_UNSUPPORTED" });
    expect(signer.sign).not.toHaveBeenCalled();
    expect(submitWorldQuery).not.toHaveBeenCalled();
  });

  it("reissues exact idempotent segments after a transient async poll failure", async () => {
    const classifySubmissions: WorldQuerySubmission[] = [];
    let pollAttempt = 0;
    const gateway: SegmentedGatewayClient = {
      submitWorldQuery: vi.fn(async (request) => {
        const submission = request as unknown as WorldQuerySubmission;
        const node = submission.plan.nodes[0]!;
        if (node.nodeId === "resolve") {
          return {
            status: 200,
            value: worldResult(submission, foundationLock, {
              candidate: { referenceKey: { namespace: "gowm", kind: "LAYER_FEATURE", id: "area", version: "1.0.0" } }
            }, "receipt-resolve")
          };
        }
        classifySubmissions.push(submission);
        return {
          status: 202,
          value: {
            jobId: "job-classify-stable",
            requestId: submission.requestId,
            kind: "WORLD_QUERY",
            queryId: submission.plan.queryId,
            status: "RUNNING"
          }
        };
      }),
      pollJob: vi.fn(async () => {
        pollAttempt += 1;
        if (pollAttempt === 1) throw Object.assign(new Error("transient"), { retryable: true });
        const submission = classifySubmissions.at(-1)!;
        return {
          jobId: "job-classify-stable",
          requestId: submission.requestId,
          kind: "WORLD_QUERY",
          queryId: submission.plan.queryId,
          status: "COMPLETED",
          result: {
            ...worldResult(submission, gdpsLock, { classification: "FOREST" }, "receipt-classify"),
            jobId: "job-classify-stable"
          }
        };
      }),
      cancelWorldQuery: vi.fn()
    };
    const accepted: AcceptedSegmentCheckpoint[] = [];
    const execute = () => executeSegmentedWorldQuery({
      submission: sourceSubmission(),
      authority: authority(),
      capabilities: capabilities(),
      identity: identity(),
      deadlineAt: new Date(Date.now() + 60_000),
      runtime: {
        gateway,
        signer: { sign: async (request) => signed(request) },
        onAccepted: async (checkpoint) => { accepted.push(checkpoint); }
      }
    });
    await expect(execute()).rejects.toMatchObject({ retryable: true });
    await expect(execute()).resolves.toMatchObject({ status: "COMPLETED" });
    expect(classifySubmissions).toHaveLength(2);
    expect(classifySubmissions[0]!.plan.queryId).toBe(classifySubmissions[1]!.plan.queryId);
    expect(classifySubmissions[0]!.idempotencyKey).toBe(classifySubmissions[1]!.idempotencyKey);
    expect(accepted.map(({ acceptance }) => acceptance["jobId"])).toEqual([
      "job-classify-stable",
      "job-classify-stable"
    ]);
    expect(gateway.cancelWorldQuery).not.toHaveBeenCalled();
  });

  it("uses a fresh bounded delegation to cancel an accepted segment after caller abort", async () => {
    const controller = new AbortController();
    let classifySubmission: WorldQuerySubmission | undefined;
    const cancelWorldQuery = vi.fn(async () => ({ status: "CANCELLED" }));
    const gateway: SegmentedGatewayClient = {
      submitWorldQuery: vi.fn(async (request) => {
        const submission = request as unknown as WorldQuerySubmission;
        const node = submission.plan.nodes[0]!;
        if (node.nodeId === "resolve") {
          return {
            status: 200,
            value: worldResult(submission, foundationLock, {
              candidate: { referenceKey: { namespace: "gowm", kind: "LAYER_FEATURE", id: "area", version: "1.0.0" } }
            }, "receipt-resolve")
          };
        }
        classifySubmission = submission;
        return {
          status: 202,
          value: {
            jobId: "job-classify-abort",
            requestId: submission.requestId,
            kind: "WORLD_QUERY",
            queryId: submission.plan.queryId,
            status: "QUEUED"
          }
        };
      }),
      pollJob: vi.fn(async () => { throw new Error("aborted"); }),
      cancelWorldQuery
    };
    const signer = { sign: vi.fn(async (request: DelegationRequest) => signed(request)) };
    await expect(executeSegmentedWorldQuery({
      submission: sourceSubmission(),
      authority: authority(),
      capabilities: capabilities(),
      identity: identity(),
      signal: controller.signal,
      deadlineAt: new Date(Date.now() + 60_000),
      runtime: {
        gateway,
        signer,
        onAccepted: async ({ nodeId }) => { if (nodeId === "classify") controller.abort(); }
      }
    })).rejects.toThrow("aborted");
    expect(cancelWorldQuery).toHaveBeenCalledWith(
      classifySubmission!.plan.queryId,
      expect.objectContaining({ delegationToken: "signed.segment.token" })
    );
    expect(signer.sign).toHaveBeenCalledTimes(3);
  });

  it("rejects missing identity authority before signing or submitting", async () => {
    const signer = { sign: vi.fn() };
    const submitWorldQuery = vi.fn();
    await expect(executeSegmentedWorldQuery({
      submission: sourceSubmission(),
      authority: authority(),
      capabilities: capabilities(),
      identity: identity([foundationScope]),
      deadlineAt: new Date(Date.now() + 60_000),
      runtime: {
        signer,
        gateway: { submitWorldQuery, pollJob: vi.fn(), cancelWorldQuery: vi.fn() },
        onAccepted: async () => undefined
      }
    })).rejects.toMatchObject({ code: "IDENTITY_MISSING_REQUIRED_DATA_SCOPE" });
    expect(signer.sign).not.toHaveBeenCalled();
    expect(submitWorldQuery).not.toHaveBeenCalled();
  });

  it("rejects deserialized authority lookalikes and over-broad signed scopes", async () => {
    const submitWorldQuery = vi.fn();
    await expect(executeSegmentedWorldQuery({
      submission: sourceSubmission(),
      authority: structuredClone(authority()),
      capabilities: capabilities(),
      identity: identity(),
      deadlineAt: new Date(Date.now() + 60_000),
      runtime: {
        signer: { sign: vi.fn() },
        gateway: { submitWorldQuery, pollJob: vi.fn(), cancelWorldQuery: vi.fn() },
        onAccepted: async () => undefined
      }
    })).rejects.toMatchObject({ code: "SEGMENTED_SCOPE_AUTHORITY_NOT_LOADED" });
    const broadSigner = {
      sign: vi.fn(async (request: DelegationRequest) => ({
        ...signed(request),
        dataScopes: [foundationScope, selectedScope]
      }))
    };
    await expect(executeSegmentedWorldQuery({
      submission: sourceSubmission(),
      authority: authority(),
      capabilities: capabilities(),
      identity: identity(),
      deadlineAt: new Date(Date.now() + 60_000),
      runtime: {
        signer: broadSigner,
        gateway: { submitWorldQuery, pollJob: vi.fn(), cancelWorldQuery: vi.fn() },
        onAccepted: async () => undefined
      }
    })).rejects.toMatchObject({ code: "SEGMENT_DELEGATION_AUTHORITY_MISMATCH" });
    expect(submitWorldQuery).not.toHaveBeenCalled();
  });

  it("rejects operation hash drift and cycles before any Gateway call", async () => {
    const drifted = sourceSubmission();
    drifted.plan.nodes.find(({ nodeId }) => nodeId === "classify")!.operation.outputSchemaHash = digest("9");
    const cyclic = sourceSubmission();
    const resolve = cyclic.plan.nodes.find(({ nodeId }) => nodeId === "resolve")!;
    resolve.inputs["request"] = {
      kind: "NODE_OUTPUT",
      port: port("cycle", gdpsLock.outputSchemaHash),
      nodeId: "classify",
      outputPort: "result"
    };
    for (const [submission, code] of [
      [drifted, "OPERATION_SCOPE_LOCK_DRIFT"],
      [cyclic, "CYCLIC_PLAN"]
    ] as const) {
      const submitWorldQuery = vi.fn();
      await expect(executeSegmentedWorldQuery({
        submission,
        authority: authority(),
        capabilities: capabilities(),
        identity: identity(),
        deadlineAt: new Date(Date.now() + 60_000),
        runtime: {
          signer: { sign: vi.fn() },
          gateway: { submitWorldQuery, pollJob: vi.fn(), cancelWorldQuery: vi.fn() },
          onAccepted: async () => undefined
        }
      })).rejects.toEqual(expect.objectContaining<Partial<SegmentedWorldQueryError>>({ code }));
      expect(submitWorldQuery).not.toHaveBeenCalled();
    }
  });

  it("fails closed when a REQUEST_PATH cannot be resolved", async () => {
    const submission = sourceSubmission();
    submission.parameters = {};
    const submitWorldQuery = vi.fn();
    await expect(executeSegmentedWorldQuery({
      submission,
      authority: authority(),
      capabilities: capabilities(),
      identity: identity(),
      deadlineAt: new Date(Date.now() + 60_000),
      runtime: {
        signer: { sign: vi.fn(async (request: DelegationRequest) => signed(request)) },
        gateway: { submitWorldQuery, pollJob: vi.fn(), cancelWorldQuery: vi.fn() },
        onAccepted: async () => undefined
      }
    })).rejects.toMatchObject({ code: "REQUEST_PATH_BINDING_UNRESOLVED" });
    expect(submitWorldQuery).not.toHaveBeenCalled();
  });
});
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
