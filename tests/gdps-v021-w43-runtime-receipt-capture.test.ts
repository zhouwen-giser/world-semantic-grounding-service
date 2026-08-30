import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  captureGdpsV021W43RuntimeReceipts,
  type GdpsV021W43AuthorityTuple,
  type GdpsV021W43ScenarioPointer,
  type W43ReadOnlySqlClient,
  type W43ReadOnlySqlPool,
} from "../validation/scripts/capture-gdps-v021-w43-runtime-receipts.js";
import type { GdpsV021W43RuntimeBinding } from
  "../validation/scripts/produce-gdps-v021-w43-evidence.js";

type JsonObject = Record<string, unknown>;

const digest = (value: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  return `{${Object.entries(value as JsonObject).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

const databaseIdentity = {
  databaseName: "wsgs_w43",
  databaseUser: "wsgs_test",
  serverAddress: "127.0.0.1",
  serverPort: 5432,
  serverVersion: "17.10",
};

const binding: GdpsV021W43RuntimeBinding = {
  candidateSha: "a".repeat(40),
  gateRunId: "wsgs-gdps-v021-runtime-0001",
  runtimeIdentityHash: digest("runtime"),
  gowmGatewayIdentityHash: digest("gateway"),
  wsgsRuntimeIdentityHash: digest("wsgs"),
  databaseIdentityHash: digest(canonicalJson(databaseIdentity)),
  handoffBundleHash: digest("handoff"),
  operationLockHash: digest("operation"),
  providerRecipeLockHash: digest("recipe"),
  providerId: "gdps.geospatial-products",
  providerVersion: "0.2.1",
  capabilityCount: 30,
  requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY",
  gatewayOnly: true,
  directProviderCalls: 0,
  mockTransportUsed: false,
  databaseClass: "REAL_ISOLATED_POSTGRESQL",
  sharedRuntimeMutated: false,
};
const authority: GdpsV021W43AuthorityTuple = {
  dataScope: "scope-gdps-v021-baseline",
  actorId: "wsgs-w43-gate",
  principalId: "wsgs-gate-principal",
  datasetScopes: ["gdps-v021-baseline"],
  authorizationContextHash: digest("authorization"),
  operationLockHash: binding.operationLockHash,
};

const truth = {
  CURRENT_STRICT: {
    replayMode: "STRICT", groundingStatus: "COMPLETED", terminalStatus: "COMPLETED", currentness: "CURRENT",
    warnings: ["CURRENT_SOURCE_IDENTITY_CONFIRMED"], newExecutions: 0, sourceChanges: 0,
  },
  CHANGED_STRICT: {
    replayMode: "STRICT", groundingStatus: "UNRESOLVED", terminalStatus: "UNRESOLVED", currentness: "CHANGED",
    warnings: ["SOURCE_CHANGED"], newExecutions: 0, sourceChanges: 0,
  },
  NOT_AVAILABLE_STRICT: {
    replayMode: "STRICT", groundingStatus: "UNRESOLVED", terminalStatus: "UNRESOLVED",
    currentness: "NOT_AVAILABLE",
    warnings: ["SOURCE_NOT_AVAILABLE"], newExecutions: 0, sourceChanges: 0,
  },
  CHANGED_BEST_EFFORT: {
    replayMode: "BEST_EFFORT", groundingStatus: "COMPLETED", terminalStatus: "COMPLETED", currentness: "CHANGED",
    warnings: ["SOURCE_ADVANCED"], newExecutions: 1, sourceChanges: 0,
  },
  SOURCE_CHANGED_ONCE: {
    replayMode: "BEST_EFFORT", groundingStatus: "COMPLETED", terminalStatus: "COMPLETED", currentness: "CHANGED",
    warnings: ["CURRENT_SOURCE_QUERY_RETRIED", "SOURCE_ADVANCED", "SOURCE_CHANGED"],
    newExecutions: 2, sourceChanges: 1,
  },
  SOURCE_CHANGED_TWICE: {
    replayMode: "BEST_EFFORT", groundingStatus: "UNRESOLVED", terminalStatus: "INDETERMINATE",
    currentness: "CHANGED",
    warnings: ["CURRENT_SOURCE_QUERY_RETRIED", "INDETERMINATE", "SOURCE_ADVANCED", "SOURCE_CHANGED"],
    newExecutions: 2, sourceChanges: 2,
  },
} as const;

type ScenarioId = keyof typeof truth;

interface ScenarioFixture {
  readonly pointer: Pick<GdpsV021W43ScenarioPointer, "scenarioId" | "sourceGroundingId" | "replayGroundingId">;
  readonly sourceResult: JsonObject;
  readonly replayResult: JsonObject;
  readonly sourceExecutions: JsonObject[];
  readonly replayExecutions: JsonObject[];
  readonly sourceBody: JsonObject;
  readonly replayBody: JsonObject;
}

const completeMigrations: readonly JsonObject[] = [
  { version: "001_wsgs_core.sql", checksum_sha256: digest("001") },
  { version: "002_wsgs_gowm_063_runtime.sql", checksum_sha256: digest("002") },
  { version: "003_wsgs_gdps_descriptor_runtime.sql", checksum_sha256: digest("003") },
];

const barrierPlan = [
  ["CURRENT_STRICT", "W43-STRICT-CURRENT", "PREPARE_A", "INITIAL_A", "INITIAL_A"],
  ["CHANGED_STRICT", "W43-STRICT-CHANGED", "PREPARE_A", "INITIAL_A", "INITIAL_A"],
  ["CHANGED_STRICT", "W43-STRICT-CHANGED", "AFTER_PRIOR_GROUNDING:A_TO_B", "INITIAL_A", "FINAL_B"],
  ["NOT_AVAILABLE_STRICT", "W43-STRICT-NOT-AVAILABLE", "PREPARE_A", "FINAL_B", "INITIAL_A"],
  ["NOT_AVAILABLE_STRICT", "W43-STRICT-NOT-AVAILABLE", "AFTER_PRIOR_GROUNDING:DISABLE_CURRENT_PRODUCT", "INITIAL_A", "NOT_AVAILABLE"],
  ["NOT_AVAILABLE_STRICT", "W43-STRICT-NOT-AVAILABLE", "AFTER_SCENARIO:RESTORE_A", "NOT_AVAILABLE", "INITIAL_A"],
  ["CHANGED_BEST_EFFORT", "W43-BEST-EFFORT-CHANGED", "PREPARE_A", "INITIAL_A", "INITIAL_A"],
  ["CHANGED_BEST_EFFORT", "W43-BEST-EFFORT-CHANGED", "AFTER_PRIOR_GROUNDING:A_TO_B", "INITIAL_A", "FINAL_B"],
  ["SOURCE_CHANGED_ONCE", "W43-SOURCE-CHANGED-ONCE-THEN-SUCCESS", "PREPARE_A", "FINAL_B", "INITIAL_A"],
  ["SOURCE_CHANGED_ONCE", "W43-SOURCE-CHANGED-ONCE-THEN-SUCCESS", "BEFORE_REPLAY_QUERY:A_TO_B", "INITIAL_A", "FINAL_B"],
  ["SOURCE_CHANGED_TWICE", "W43-SOURCE-CHANGED-TWICE-INDETERMINATE", "PREPARE_A", "FINAL_B", "INITIAL_A"],
  ["SOURCE_CHANGED_TWICE", "W43-SOURCE-CHANGED-TWICE-INDETERMINATE", "BEFORE_REPLAY_QUERY:A_TO_B", "INITIAL_A", "FINAL_B"],
  ["SOURCE_CHANGED_TWICE", "W43-SOURCE-CHANGED-TWICE-INDETERMINATE", "AFTER_FIRST_SOURCE_CHANGED:B_TO_A", "FINAL_B", "INITIAL_A"],
  ["SOURCE_CHANGED_TWICE", "W43-SOURCE-CHANGED-TWICE-INDETERMINATE", "FINALIZE_B", "INITIAL_A", "FINAL_B"],
] as const;

function barrierFixture(): { document: JsonObject; bytes: Buffer; hash: `sha256:${string}` } {
  const a = digest("slope-A");
  const b = digest("slope-B");
  const provider = digest("provider");
  const manifest = digest("provider-manifest");
  let previous: `sha256:${string}` | null = null;
  const transitions = barrierPlan.map(([, externalId, barrier, from, to], index) => {
    const content = (state: string): `sha256:${string}` => state === "FINAL_B" ? b : a;
    const value: JsonObject = {
      sequence: index + 1, scenarioId: externalId, barrier, status: "PASS", expectedFrom: from,
      targetState: to, beforeState: from, afterState: to,
      beforeContentHash: content(from), afterContentHash: content(to),
      foundationSchemaFingerprintBefore: digest("foundation-schema"),
      foundationSchemaFingerprintAfter: digest("foundation-schema"),
      foundationDataFingerprintBefore: digest("foundation-data"),
      foundationDataFingerprintAfter: digest("foundation-data"),
      nonTargetFingerprintBefore: digest("non-target"), nonTargetFingerprintAfter: digest("non-target"),
      providerRuntimeIdentityHashBefore: provider, providerRuntimeIdentityHashAfter: provider,
      providerManifestHashBefore: manifest, providerManifestHashAfter: manifest,
      providerRuntimeInvariant: true, journalIntentHash: digest(`intent-${index}`),
      foundationInvariant: true, nonTargetInvariant: true, directProviderCalls: 0,
      credentialMaterialRecorded: false, recordedAt: `2026-08-29T15:00:${String(index).padStart(2, "0")}.000Z`,
      previousTransitionHash: previous,
    };
    const transitionHash = digest(canonicalJson(value));
    previous = transitionHash;
    return { ...value, transitionHash };
  });
  const document: JsonObject = {
    schemaVersion: "gdps-v021-w43-barrier-attestation/1.0", status: "PASS",
    contractHash: digest("contract"), fixtureId: "GDPS_SLOPE_A_B_CURRENTNESS",
    scope: authority.dataScope, productId: "gdps-baseline-slope", candidateSha: binding.candidateSha,
    gateRunIdHash: digest(canonicalJson({ gateRunId: binding.gateRunId })),
    runtimeIdentityHash: digest(canonicalJson({ runtimeIdentity: binding.runtimeIdentityHash })),
    providerRuntimeIdentityHash: provider, providerManifestHash: manifest, journalBindingHash: digest("journal"),
    qualificationScope: "FIXTURE_TRANSITIONS_ONLY", w43RuntimeQualificationStatus: "NOT_RUN",
    runtimeEvidenceIncluded: false, transitionCount: 14, transitions, currentState: "FINAL_B",
    finalFixtureState: "FINAL_B", directProviderCalls: 0, credentialMaterialRecorded: false,
  };
  const bytes = Buffer.from(JSON.stringify(document), "utf8");
  return { document, bytes, hash: digest(bytes.toString("utf8")) };
}

const armPath = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/source-changed-twice-arm.json";

function armFixture(): { document: JsonObject; bytes: Buffer; hash: `sha256:${string}` } {
  const document: JsonObject = {
    schemaVersion: "wsgs-gdps-v021-w43-barrier-arm/1.0",
    candidateSha: binding.candidateSha,
    gateRunId: binding.gateRunId,
    runtimeIdentityHash: binding.runtimeIdentityHash,
    scenarioId: "W43-SOURCE-CHANGED-TWICE-INDETERMINATE",
    barrier: "AFTER_FIRST_SOURCE_CHANGED:B_TO_A",
    challengeHash: digest("challenge"),
    controllerIdHash: digest("controller"),
    sidecarContractHash: digest("sidecar"),
  };
  const bytes = Buffer.from(JSON.stringify(document), "utf8");
  return { document, bytes, hash: digest(bytes.toString("utf8")) };
}

function scenario(scenarioId: ScenarioId): ScenarioFixture {
  const expected = truth[scenarioId];
  const sourceGroundingId = `source-${scenarioId.toLowerCase()}`;
  const replayGroundingId = `replay-${scenarioId.toLowerCase()}`;
  const sourceResultHash = digest(`source-result:${scenarioId}`);
  const replayResultHash = digest(`replay-result:${scenarioId}`);
  const priorContentHash = digest("slope-A");
  const currentContentHash = expected.currentness === "NOT_AVAILABLE" ? undefined :
    expected.currentness === "CURRENT" ? priorContentHash : digest("slope-B");
  const evidenceProductId = `evidence-${scenarioId.toLowerCase()}`;
  const sourceGatewayQueryId = `source-query-${scenarioId.toLowerCase()}`;
  const decision = {
    schemaVersion: "wsgs-gdps-currentness-decision/1.0",
    status: expected.currentness === "CURRENT" || expected.replayMode === "BEST_EFFORT"
      ? "REPLAY_ALLOWED" : expected.currentness === "NOT_AVAILABLE" ? "UNRESOLVED" : "SNAPSHOT_MISMATCHED",
    currentness: expected.currentness,
    replayMode: expected.replayMode,
    source: { productId: "gdps-slope-main", contentHash: priorContentHash },
    ...(currentContentHash ? { currentContentHash } : {}),
    executionBlocked: expected.replayMode === "STRICT" && expected.currentness !== "CURRENT",
    sourceGroundingId,
    sourceResultHash,
    selectedEvidenceProductId: evidenceProductId,
    sourceOperation: "geo-raster.sample",
    sourceOperationVersion: "1.0",
    sourceRecipeId: "recipe-gdps-generic-sample-value",
    sourceRecipeLockHash: binding.providerRecipeLockHash,
    descriptorId: "SLOPE/DEGREE",
    descriptorHash: digest("descriptor"),
    productType: "SLOPE",
    productProfile: "SLOPE_DEGREE",
    queryProfile: "SAMPLE_VALUE",
    currentnessRecipeId: "gdps-check-current-geo-product",
    providerRecipeLockHash: binding.providerRecipeLockHash,
    operationLockHash: binding.operationLockHash,
    historicalPayloadRead: false,
    currentIdentityPolicy: expected.currentness === "CURRENT"
      ? "IDENTITY_CONFIRMED_NO_HISTORICAL_PAYLOAD"
      : expected.replayMode === "BEST_EFFORT" ? "NEW_CURRENT_SOURCE_QUERY_REQUIRED" : "NO_SOURCE_QUERY_ALLOWED",
  };
  const sourceResult = {
    groundingId: sourceGroundingId,
    status: "COMPLETED",
    resultHash: sourceResultHash,
    warnings: [],
    evidenceItems: [{
      evidenceProductId,
      safePayload: { productId: "gdps-slope-main", contentHash: priorContentHash },
    }],
  };
  const replayResult = {
    groundingId: replayGroundingId,
    status: expected.groundingStatus,
    resultHash: replayResultHash,
    warnings: expected.warnings,
    evidenceItems: [],
    capabilityGaps: scenarioId === "CHANGED_STRICT" ? [{
      semanticCapability: "PRIOR_RESULT_REVALIDATION", reason: "UNSUPPORTED_EXPRESSION", blocking: true,
      details: { code: "SNAPSHOT_MISMATCHED", executionBlocked: true, originalQueryExecuted: false,
        historicalPayloadRead: false },
    }] : scenarioId === "NOT_AVAILABLE_STRICT" ? [{
      semanticCapability: "PRIOR_RESULT_REVALIDATION", reason: "PROVIDER_UNAVAILABLE", blocking: true,
      details: { code: "DATA_GAP", executionBlocked: true, originalQueryExecuted: false,
        historicalPayloadRead: false },
    }] : scenarioId === "SOURCE_CHANGED_TWICE" ? [{
      semanticCapability: "PRIOR_RESULT_REVALIDATION", reason: "UNSUPPORTED_EXPRESSION", blocking: true,
      details: { code: "SOURCE_CHANGED", upstreamCondition: "SOURCE_CHANGED_DURING_QUERY",
        normalizedStatus: "INDETERMINATE", currentSourceQueryAttempts: 2,
        historicalPayloadRead: false, historicalQueryReplayed: false },
    }] : [],
  };
  const sourceExecutions = [{
    execution_kind: "WORLD_QUERY_NODE",
    operation_id: "geo-raster.sample",
    operation_version: "1.0",
    gateway_query_id: sourceGatewayQueryId,
    normalized_status: "COMPLETED",
    data_snapshot: {},
  }];
  const replayExecutions: JsonObject[] = [{
    execution_kind: "WORLD_QUERY_NODE",
    operation_id: "geo-product.check-current",
    operation_version: "1.0",
    gateway_query_id: `check-query-${scenarioId.toLowerCase()}`,
    normalized_status: expected.currentness === "CHANGED" && expected.replayMode === "STRICT" ? "STALE" :
      expected.currentness === "NOT_AVAILABLE" ? "NO_DATA" : "COMPLETED",
    data_snapshot: { gdpsCurrentnessDecision: decision },
  }];
  for (let index = 0; index < expected.newExecutions; index += 1) {
    replayExecutions.push({
      execution_kind: "WORLD_QUERY_NODE",
      operation_id: "geo-raster.sample",
      operation_version: "1.0",
      gateway_query_id: `new-query-${scenarioId.toLowerCase()}-${index + 1}`,
      normalized_status: index < expected.sourceChanges ? "INDETERMINATE" : "COMPLETED",
      data_snapshot: index < expected.sourceChanges ? {
        gdpsBestEffortCurrentSource: { upstreamCondition: "SOURCE_CHANGED_DURING_QUERY" },
      } : {},
    });
  }
  const barrier = barrierFixture().document;
  const external = barrierPlan.find(([internal]) => internal === scenarioId)![1];
  const scenarioTransitions = (barrier["transitions"] as JsonObject[])
    .filter((entry) => entry["scenarioId"] === external);
  const sourceBarrierHash = scenarioTransitions[0]!["transitionHash"] as `sha256:${string}`;
  const replayBarrierHash = scenarioTransitions[
    ({ CURRENT_STRICT: 0, CHANGED_STRICT: 1, NOT_AVAILABLE_STRICT: 1,
      CHANGED_BEST_EFFORT: 1, SOURCE_CHANGED_ONCE: 1, SOURCE_CHANGED_TWICE: 1 } as const)[scenarioId]
  ]!["transitionHash"] as `sha256:${string}`;
  const replayArmHash = scenarioId === "SOURCE_CHANGED_TWICE" ? armFixture().hash : null;
  const body = (phase: "source" | "replay", priorGroundings: JsonObject[]): JsonObject => {
    const originalText = phase === "source" ? "A区内坡度15到30度的区域有哪些？" : "严格重用之前的坡度查询证据。";
    const barrierHash = phase === "source" ? sourceBarrierHash : replayBarrierHash;
    const armHash = phase === "replay" ? replayArmHash : null;
    const requestId = `${phase}-${scenarioId.toLowerCase()}-${binding.gateRunId}`;
    return {
      schemaVersion: "1.0",
      requestId,
      operation: "EXECUTE_WORLD_QUERY",
      source: {
        conversationRef: `${requestId}.barrier.${barrierHash}`,
        messageId: armHash === null ? `${requestId}.arm.none` : `${requestId}.arm.${armHash}`,
        originalText, originalTextSha256: digest(originalText),
      },
      contextCapsule: { priorGroundings },
      executionPolicy: { allowApproximation: expected.replayMode === "BEST_EFFORT" },
    };
  };
  const sourceBody = body("source", []);
  const replayBody = body("replay", [{
    groundingId: sourceGroundingId, resultHash: sourceResultHash, selectedProductIds: [evidenceProductId],
  }]);
  return {
    pointer: { scenarioId, sourceGroundingId, replayGroundingId },
    sourceResult,
    replayResult,
    sourceExecutions,
    replayExecutions,
    sourceBody,
    replayBody,
  };
}

class FakeClient implements W43ReadOnlySqlClient {
  public readonly queries: string[] = [];
  public readonly selectedProductQueries: Array<readonly unknown[]> = [];
  public released = false;
  public readonly fixtures = new Map<string, ScenarioFixture>();

  public constructor(private readonly migrationRows: readonly JsonObject[] = completeMigrations) {
    Object.keys(truth).forEach((id) => {
      const value = scenario(id as ScenarioId);
      this.fixtures.set(value.pointer.sourceGroundingId, value);
      this.fixtures.set(value.pointer.replayGroundingId, value);
    });
  }

  public async query<Row extends JsonObject = JsonObject>(sql: string,
    parameters: readonly unknown[] = []): Promise<{ rows: readonly Row[] }> {
    this.queries.push(sql);
    if (sql.startsWith("BEGIN") || sql === "ROLLBACK") return { rows: [] };
    if (sql.includes("current_database()")) {
      return { rows: [{
        database_name: databaseIdentity.databaseName,
        database_user: databaseIdentity.databaseUser,
        server_address: databaseIdentity.serverAddress,
        server_port: databaseIdentity.serverPort,
        server_version: databaseIdentity.serverVersion,
      } as unknown as Row] };
    }
    if (sql.includes("wsgs.schema_migration")) {
      return { rows: this.migrationRows as readonly Row[] };
    }
    if (sql.includes("SELECT count(*)::text AS count FROM wsgs.grounding_result")) {
      return { rows: [{ count: "0" } as unknown as Row] };
    }
    const groundingId = String(parameters[0]);
    const fixture = this.fixtures.get(groundingId);
    if (!fixture) throw new Error(`unknown grounding ${groundingId}`);
    const source = groundingId === fixture.pointer.sourceGroundingId;
    if (sql.includes("JOIN wsgs.grounding_job")) {
      const result = source ? fixture.sourceResult : fixture.replayResult;
      const body = source ? fixture.sourceBody : fixture.replayBody;
      return { rows: [{
        request_id: body["requestId"],
        payload_hash: digest(canonicalJson(body)),
        source_text_sha256: (body["source"] as JsonObject)["originalTextSha256"],
        source_text_ciphertext: Buffer.from(JSON.stringify(body), "utf8"),
        job_status: result["status"],
        result_status: result["status"],
        result_hash: result["resultHash"],
        result_bytes: Buffer.from(JSON.stringify(result), "utf8"),
      } as unknown as Row] };
    }
    if (sql.includes("wsgs.gowm_execution")) {
      return { rows: (source ? fixture.sourceExecutions : fixture.replayExecutions) as unknown as Row[] };
    }
    if (sql.includes("wsgs.result_product")) {
      if (!sql.includes("product_id = $1 || ':' || $2") || parameters.length !== 3) {
        throw new Error("selected product query did not bind the persisted composite ID");
      }
      this.selectedProductQueries.push(parameters);
      return { rows: [{ count: "1" } as unknown as Row] };
    }
    if (sql.includes("wsgs.world_query")) {
      return { rows: [{ query_id: fixture.sourceExecutions[0]!["gateway_query_id"],
        gateway_query_id: fixture.sourceExecutions[0]!["gateway_query_id"], plan_hash: digest("source-plan") } as unknown as Row] };
    }
    if (sql.includes("wsgs.pipeline_event")) return { rows: [{ count: "14" } as unknown as Row] };
    throw new Error(`unhandled SQL ${sql}`);
  }

  public release(): void {
    this.released = true;
  }
}

class FakePool implements W43ReadOnlySqlPool {
  public constructor(public readonly client: FakeClient) {}
  public async connect(): Promise<W43ReadOnlySqlClient> { return this.client; }
}

function pointers(client: FakeClient, barrier: JsonObject): GdpsV021W43ScenarioPointer[] {
  const transitions = barrier["transitions"] as JsonObject[];
  return Object.keys(truth).map((scenarioId) => {
    const fixture = client.fixtures.get(`source-${scenarioId.toLowerCase()}`)!;
    const external = barrierPlan.find(([internal]) => internal === scenarioId)![1];
    const barrierTransitionHashes = transitions.filter((entry) => entry["scenarioId"] === external)
      .map((entry) => entry["transitionHash"] as `sha256:${string}`);
    const sourceBarrierTransitionHash = barrierTransitionHashes[0]!;
    const replayBarrierTransitionHash = barrierTransitionHashes[
      ({ CURRENT_STRICT: 0, CHANGED_STRICT: 1, NOT_AVAILABLE_STRICT: 1,
        CHANGED_BEST_EFFORT: 1, SOURCE_CHANGED_ONCE: 1, SOURCE_CHANGED_TWICE: 1 } as const)[scenarioId as ScenarioId]
    ]!;
    const replayBarrierArm = scenarioId === "SOURCE_CHANGED_TWICE" ? {
      path: armPath, hash: armFixture().hash, byteLength: armFixture().bytes.byteLength,
    } : null;
    const sourceRequest = {
      requestId: fixture.sourceBody["requestId"] as string,
      requestHash: digest(canonicalJson(fixture.sourceBody)),
      sourceTextHash: (fixture.sourceBody["source"] as JsonObject)["originalTextSha256"] as `sha256:${string}`,
      barrierTransitionHash: sourceBarrierTransitionHash,
      replayBarrierArmHash: null,
    };
    const replayRequest = {
      requestId: fixture.replayBody["requestId"] as string,
      requestHash: digest(canonicalJson(fixture.replayBody)),
      sourceTextHash: (fixture.replayBody["source"] as JsonObject)["originalTextSha256"] as `sha256:${string}`,
      barrierTransitionHash: replayBarrierTransitionHash,
      replayBarrierArmHash: replayBarrierArm?.hash ?? null,
    };
    const value = { ...fixture.pointer, sourceRequest, replayRequest, replayBarrierArm, barrierTransitionHashes };
    return { ...value, causalBindingHash: digest(canonicalJson({
      candidateSha: binding.candidateSha, gateRunId: binding.gateRunId,
      runtimeIdentityHash: binding.runtimeIdentityHash, scenarioId: value.scenarioId,
      authorityTupleHash: digest(canonicalJson(authority)),
      barrierAttestationHash: digest(Buffer.from(JSON.stringify(barrier), "utf8").toString("utf8")),
      sourceGroundingIdHash: digest(value.sourceGroundingId), replayGroundingIdHash: digest(value.replayGroundingId),
      sourceRequest, replayRequest, replayBarrierArm, barrierTransitionHashes,
    })) };
  });
}

function captureInput(client: FakeClient, overrides: Partial<Parameters<typeof captureGdpsV021W43RuntimeReceipts>[0]> = {}) {
  const barrier = barrierFixture();
  const arm = armFixture();
  return {
    pool: new FakePool(client), binding, authority, scenarios: pointers(client, barrier.document),
    barrierAttestationBytes: barrier.bytes, barrierAttestationHash: barrier.hash,
    barrierAttestationReference: {
      path: "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/barrier-attestation.json",
      hash: barrier.hash, byteLength: barrier.bytes.byteLength,
    },
    replayBarrierArmArtifact: {
      bytes: arm.bytes,
      reference: { path: armPath, hash: arm.hash, byteLength: arm.bytes.byteLength },
    },
    openPersistedRequest: async (bytes: Uint8Array) => bytes,
    generatedAt: "2026-08-29T15:00:00.000Z",
    ...overrides,
  };
}

describe("GDPS v0.2.1 W43 real runtime receipt capture", () => {
  it("derives both receipts inside one READ ONLY transaction and emits no raw grounding IDs", async () => {
    const client = new FakeClient();
    const captured = await captureGdpsV021W43RuntimeReceipts(captureInput(client));
    expect(client.queries[0]).toBe("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(client.queries.at(-1)).toBe("ROLLBACK");
    expect(client.released).toBe(true);
    expect((captured.currentnessDocument["scenarios"] as unknown[])).toHaveLength(6);
    expect((captured.postgresDocument["observations"] as unknown[])).toHaveLength(6);
    const twice = (captured.currentnessDocument["scenarios"] as JsonObject[])
      .find((entry) => entry["scenarioId"] === "SOURCE_CHANGED_TWICE");
    expect(twice).toMatchObject({ groundingStatus: "UNRESOLVED", terminalStatus: "INDETERMINATE" });
    const twicePersisted = (captured.postgresDocument["observations"] as JsonObject[])
      .find((entry) => entry["scenarioId"] === "SOURCE_CHANGED_TWICE");
    expect(twicePersisted).toMatchObject({ groundingStatus: "UNRESOLVED" });
    expect(client.selectedProductQueries).toHaveLength(6);
    expect(client.selectedProductQueries.every(([groundingId, publicId]) =>
      typeof groundingId === "string" && typeof publicId === "string" &&
      !String(publicId).startsWith(`${groundingId}:`))).toBe(true);
    const bytes = Buffer.concat([captured.currentnessBytes, captured.postgresBytes]).toString("utf8");
    for (const pointer of captureInput(client).scenarios) {
      expect(bytes).not.toContain(pointer.sourceGroundingId);
      expect(bytes).not.toContain(pointer.replayGroundingId);
      expect(bytes).toContain(digest(pointer.sourceGroundingId));
      expect(bytes).toContain(digest(pointer.replayGroundingId));
    }
  });

  it("fails closed when the exact authority tuple drifts", async () => {
    const client = new FakeClient();
    await expect(captureGdpsV021W43RuntimeReceipts(captureInput(client, {
      authority: { ...authority, operationLockHash: digest("foreign-lock") },
    }))).rejects.toMatchObject({
      code: "W43_AUTHORITY_TUPLE_INVALID",
    });
    expect(client.queries).toHaveLength(0);
  });

  it("rejects a rehashed but causally altered barrier chain", async () => {
    const client = new FakeClient();
    const input = captureInput(client);
    const altered = JSON.parse(Buffer.from(input.barrierAttestationBytes).toString("utf8")) as JsonObject;
    ((altered["transitions"] as JsonObject[])[5]!["foundationInvariant"] as unknown) = false;
    const bytes = Buffer.from(JSON.stringify(altered), "utf8");
    const hash = digest(bytes.toString("utf8"));
    await expect(captureGdpsV021W43RuntimeReceipts({ ...input, barrierAttestationBytes: bytes,
      barrierAttestationHash: hash, barrierAttestationReference: {
        ...input.barrierAttestationReference, hash, byteLength: bytes.byteLength,
      } })).rejects.toMatchObject({ code: "W43_BARRIER_TRANSITION_CHAIN_INVALID" });
  });

  it("opens the persisted ciphertext and rejects a replay body without the exact prior pointer", async () => {
    const client = new FakeClient();
    await expect(captureGdpsV021W43RuntimeReceipts(captureInput(client, {
      openPersistedRequest: async (bytes, context) => {
        if (!context.requestId.startsWith("replay-")) return bytes;
        const body = JSON.parse(Buffer.from(bytes).toString("utf8")) as JsonObject;
        (body["contextCapsule"] as JsonObject)["priorGroundings"] = [];
        return Buffer.from(JSON.stringify(body), "utf8");
      },
    }))).rejects.toMatchObject({ code: "W43_REPLAY_REQUEST_PLAINTEXT_BINDING_INVALID" });
  });

  it("rejects a persisted currentness decision whose executionBlocked flag contradicts runtime truth", async () => {
    const client = new FakeClient();
    const fixture = client.fixtures.get("replay-changed_strict")!;
    const check = fixture.replayExecutions[0]!;
    const snapshot = check["data_snapshot"] as JsonObject;
    (snapshot["gdpsCurrentnessDecision"] as JsonObject)["executionBlocked"] = false;
    await expect(captureGdpsV021W43RuntimeReceipts(captureInput(client))).rejects.toMatchObject({
      code: "W43_RUNTIME_DECISION_SEMANTICS_INVALID",
    });
  });

  it("rejects a SOURCE_CHANGED_TWICE result without its exact blocking capability gap", async () => {
    const client = new FakeClient();
    const fixture = client.fixtures.get("replay-source_changed_twice")!;
    fixture.replayResult["capabilityGaps"] = [];
    await expect(captureGdpsV021W43RuntimeReceipts(captureInput(client))).rejects.toMatchObject({
      code: "W43_RUNTIME_CAPABILITY_GAP_COUNT_INVALID",
    });
  });
});
