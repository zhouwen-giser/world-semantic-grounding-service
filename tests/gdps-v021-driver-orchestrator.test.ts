import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GdpsV021DriverExternalContractError,
  type DriverDigest,
  type GdpsV021DriverOrchestratorInput,
  type GdpsV021DriverSqlClient,
  type GdpsV021NaturalLanguageDriverRequest,
  type JsonObject,
} from "../validation/drivers/contracts.js";
import { canonicalHash, sha256 } from "../validation/drivers/shared.js";
import { runGdpsV021DriverOrchestrator } from
  "../validation/scripts/gdps-v021-driver-orchestrator.js";

const repositoryRoot = process.cwd();
const operationLockHash = `sha256:${"1".repeat(64)}` as DriverDigest;
const sourceCommit = "a".repeat(40);
const runtimeIdentity = {
  schemaVersion: "wsgs-gdps-driver-runtime-identity/1.0" as const,
  gateRunId: "driver-test-run",
  databaseIdentityHash: `sha256:${"2".repeat(64)}` as DriverDigest,
  wsgsRuntimeHash: `sha256:${"3".repeat(64)}` as DriverDigest,
  gowmGatewayRuntimeHash: `sha256:${"4".repeat(64)}` as DriverDigest,
  gdpsProviderRuntimeHash: `sha256:${"5".repeat(64)}` as DriverDigest,
};
const runtimeIdentityHash = canonicalHash(runtimeIdentity);
const sharedRuntimeHash = `sha256:${"6".repeat(64)}` as DriverDigest;
const descriptorHash = `sha256:${"7".repeat(64)}` as DriverDigest;
const slopeAHash = `sha256:${"8".repeat(64)}` as DriverDigest;
const slopeBHash = `sha256:${"9".repeat(64)}` as DriverDigest;

interface StoredFixture {
  request: JsonObject;
  job: JsonObject;
  result: JsonObject;
  events: JsonObject[];
  queries: JsonObject[];
  executions: JsonObject[];
  snapshot: JsonObject;
}

const createdRoots: string[] = [];

afterEach(() => {
  for (const path of createdRoots.splice(0)) {
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  }
});

function jsonFile(path: string, value: unknown): { path: string; hash: DriverDigest } {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, bytes, { flag: "wx" });
  return { path, hash: sha256(bytes) };
}

function runtimeFiles(root: string): {
  recipeLockPath: string;
  snapshotPath: string;
  providerPath: string;
  providerHash: DriverDigest;
  recipeLockHash: DriverDigest;
  consumerSnapshotFileHash: DriverDigest;
  capabilitySnapshotHash: DriverDigest;
} {
  const recipeLock = {
    schemaVersion: "wsgs-gdps-recipe-lock/2.0",
    recipes: Array.from({ length: 14 }, (_unused, index) => index === 0 ? {
      recipeId: "recipe-gdps-generic-find-range",
      semanticPattern: "GDPS_GENERIC_FIND_RANGE",
      descriptorConstraint: { descriptorId: "SLOPE/DEGREE", descriptorHash },
      allowedOperations: [{
        operationId: "geo-raster.find-by-range",
        operationVersion: "1.0",
        semanticProfileHash: `sha256:${"a".repeat(64)}`,
      }],
    } : {
      recipeId: `recipe-unused-${index}`,
      semanticPattern: `UNUSED_${index}`,
      descriptorConstraint: { descriptorId: `UNUSED/${index}`, descriptorHash },
      allowedOperations: [{
        operationId: `unused.operation-${index}`,
        operationVersion: "1.0",
        semanticProfileHash: `sha256:${"a".repeat(64)}`,
      }],
    }),
  };
  const recipeLockFile = jsonFile(resolve(root, "input", "recipe-lock.json"), recipeLock);
  const snapshotBody = {
    schemaVersion: "wsgs-gdps-consumer-snapshot/2.0",
    recipeLockHash: recipeLockFile.hash,
    capabilityKeys: Array.from({ length: 30 }, (_unused, index) => `capability-${index}`),
  };
  const snapshot = { ...snapshotBody, capabilitySnapshotHash: canonicalHash(snapshotBody) };
  const operations = [
    ["geo-vector.find-in-area", "recipe-gdps-generic-vector-in-area"],
    ["geo-raster.find-by-range", "recipe-gdps-generic-find-range"],
    ["geo-product.check-current", "recipe-gdps-product-check-current"],
    ...Array.from({ length: 27 }, (_unused, index) =>
      [`unused.provider-operation-${index}`, `recipe-unused-provider-${index}`]),
  ];
  const provider = {
    schemaVersion: "wsgs-gdps-recipe-lock/1.0",
    recipes: operations.map(([operationId, recipeId], index) => ({
      recipeId,
      operationId,
      operationVersion: "1.0",
      inputSchemaHash: `sha256:${(index % 10).toString(16).repeat(64)}`,
      outputSchemaHash: `sha256:${((index + 1) % 10).toString(16).repeat(64)}`,
      semanticProfileHash: `sha256:${((index + 2) % 10).toString(16).repeat(64)}`,
    })),
  };
  const snapshotFile = jsonFile(resolve(root, "input", "consumer-snapshot.json"), snapshot);
  const providerFile = jsonFile(resolve(root, "input", "provider-recipe-lock.json"), provider);
  return {
    recipeLockPath: recipeLockFile.path,
    snapshotPath: snapshotFile.path,
    providerPath: providerFile.path,
    providerHash: providerFile.hash,
    recipeLockHash: recipeLockFile.hash,
    consumerSnapshotFileHash: snapshotFile.hash,
    capabilitySnapshotHash: snapshot.capabilitySnapshotHash as DriverDigest,
  };
}

function plan(descriptorId: string, operations: readonly string[]): JsonObject {
  return {
    descriptorId,
    descriptorHash,
    nodes: operations.map((operationKey, index) => ({
      nodeId: `node-${index + 1}`,
      operationId: operationKey.split("@")[0],
      operationVersion: "1.0",
    })),
  };
}

function sourceEvidence(values: {
  descriptorId: string;
  recipeId: string;
  recipeLockHash: DriverDigest;
  productId: string;
  contentHash: DriverDigest;
  truncated: boolean;
}): JsonObject {
  const operationId = values.descriptorId.includes("SLOPE")
    ? "geo-raster.find-by-range" : "geo-vector.find-in-area";
  const normalizedStatus = values.truncated ? "PARTIAL" : "COMPLETED";
  return {
    schemaVersion: "wsgs-gdps-source-evidence/1.0",
    operationId,
    operationVersion: "1.0",
    upstreamStatus: normalizedStatus,
    normalizedStatus,
    descriptorId: values.descriptorId,
    descriptorHash,
    productType: values.descriptorId.split("/")[0],
    productProfile: values.descriptorId.split("/")[1],
    queryProfile: values.descriptorId.includes("SLOPE") ? "FIND_VALUE_RANGE" : "VECTOR_IN_AREA",
    recipeId: values.recipeId,
    recipeLockHash: values.recipeLockHash,
    productId: values.productId,
    contentHash: values.contentHash,
    truncated: values.truncated,
    dataSnapshot: { snapshotId: "snapshot-current" },
    computeSnapshot: { implementation: "gdps-v0.2.1" },
    quality: { classification: "AUTHORITATIVE_SAMPLE" },
    receiptIds: ["receipt-product"],
    evidenceIds: ["evidence-product"],
    warnings: [],
  };
}

function executionRows(
  operationKeys: readonly string[],
  statuses: readonly string[],
  finalSnapshot?: JsonObject,
): JsonObject[] {
  return operationKeys.map((operationKey, index) => ({
    execution_kind: "WORLD_QUERY_NODE",
    operation_id: operationKey.split("@")[0],
    operation_version: "1.0",
    request_hash: `sha256:${((index + 1) % 10).toString(16).repeat(64)}`,
    result_hash: `sha256:${((index + 2) % 10).toString(16).repeat(64)}`,
    normalized_status: statuses[index],
    upstream_status: statuses[index] === "STALE" ? "COMPLETED" : statuses[index],
    gateway_query_id: `gateway-query-${index}`,
    gateway_job_id: `gateway-job-${index}`,
    data_snapshot: index === operationKeys.length - 1 && finalSnapshot ? finalSnapshot : {},
    compute_snapshot: {},
    snapshot_adherence: {},
    receipt_ids: [`receipt-${index}`],
    evidence_ids: [`evidence-${index}`],
  }));
}

function fixtureFor(
  request: GdpsV021NaturalLanguageDriverRequest,
  recipeLockHash: DriverDigest,
  capabilitySnapshotHash: DriverDigest,
): StoredFixture {
  let status = "UNRESOLVED";
  let resultBody: JsonObject = { normalizationGaps: [] };
  let operations: string[] = [];
  let statuses: string[] = [];
  let descriptorId = "SLOPE/DEGREE";
  let finalSnapshot: JsonObject | undefined;
  if (request.caseId === "NEG-DATA-GAP") {
    operations = ["reference.resolve@1.0", "world.get-geometry@1.0", "geo-vector.find-in-area@1.0"];
    statuses = ["COMPLETED", "COMPLETED", "NO_DATA"];
    descriptorId = "UAV_RESTRICTION/RESTRICTION_ZONES";
    finalSnapshot = { gdpsSourceEvidence: {
      schemaVersion: "wsgs-gdps-source-evidence/1.0",
      operationId: "geo-vector.find-in-area",
      operationVersion: "1.0",
      upstreamStatus: "NO_DATA",
      normalizedStatus: "UNRESOLVED",
      gapKind: "DATA_GAP",
      recipeId: "recipe-gdps-generic-vector-in-area",
      recipeLockHash,
      descriptorId,
      descriptorHash,
      productType: "UAV_RESTRICTION",
      productProfile: "RESTRICTION_ZONES",
      queryProfile: "VECTOR_IN_AREA",
      truncated: false,
      emptyCurrentResult: false,
      receiptIds: [],
      evidenceIds: [],
      warnings: [],
    } };
    resultBody = { normalizationGaps: [{ details: { code: "DATA_GAP" } }] };
  } else if (request.caseId === "NEG-RECIPE-DRIFT") {
    resultBody = { normalizationGaps: [{ details: { code: "RECIPE_LOCK_DRIFT" } }] };
  } else if (request.caseId === "NEG-TRUNCATED") {
    status = "PARTIAL";
    operations = ["reference.resolve@1.0", "world.get-geometry@1.0", "geo-vector.find-in-area@1.0"];
    statuses = ["COMPLETED", "COMPLETED", "PARTIAL"];
    descriptorId = "DRAINAGE_NETWORK/DRAINAGE_FEATURES";
    const source = sourceEvidence({
      descriptorId,
      recipeId: "recipe-gdps-generic-vector-in-area",
      recipeLockHash,
      productId: "gdps-product-drainage",
      contentHash: `sha256:${"d".repeat(64)}`,
      truncated: true,
    });
    finalSnapshot = { gdpsSourceEvidence: source };
    resultBody = { evidenceItems: [], warnings: ["RESULT_TRUNCATED"] };
  } else if (request.phase === "CURRENTNESS_SEED") {
    status = "COMPLETED";
    operations = ["reference.resolve@1.0", "world.get-geometry@1.0", "geo-raster.find-by-range@1.0"];
    statuses = ["COMPLETED", "COMPLETED", "COMPLETED"];
    const source = sourceEvidence({
      descriptorId,
      recipeId: "recipe-gdps-generic-find-range",
      recipeLockHash,
      productId: "gdps-product-slope-a",
      contentHash: slopeAHash,
      truncated: false,
    });
    finalSnapshot = { gdpsSourceEvidence: source };
    resultBody = {
      evidenceItems: [{
        evidenceProductId: "evidence-slope-a",
        productKind: "CAPABILITY_RESULT",
        sourceOperation: "geo-raster.find-by-range",
        safePayload: { productId: "gdps-product-slope-a", contentHash: slopeAHash },
      }],
    };
  } else {
    operations = ["geo-product.check-current@1.0"];
    statuses = ["STALE"];
    const prior = request.body["contextCapsule"] as JsonObject;
    const pointers = prior["priorGroundings"] as JsonObject[];
    const decision = {
      schemaVersion: "wsgs-gdps-currentness-decision/1.0",
      status: "SNAPSHOT_MISMATCHED",
      currentness: "CHANGED",
      executionBlocked: true,
      source: { productId: "gdps-product-slope-a", contentHash: slopeAHash },
      currentContentHash: slopeBHash,
      sourceGroundingId: pointers[0]!["groundingId"],
      sourceResultHash: pointers[0]!["resultHash"],
      selectedEvidenceProductId: (pointers[0]!["selectedProductIds"] as string[])[0],
    };
    finalSnapshot = { gdpsCurrentnessDecision: decision };
    resultBody = {
      gdpsCurrentnessDecision: decision,
      normalizationGaps: [{ details: { code: "SNAPSHOT_MISMATCHED", executionBlocked: true } }],
    };
  }
  const resultHash = canonicalHash({ requestHash: canonicalHash(request.body), status, resultBody });
  const resultDocument = { schemaVersion: "1.0", status, ...resultBody, resultHash };
  const events = [{
    stage: "RESULT_PERSIST",
    status: "COMPLETED",
    input_hash: `sha256:${"e".repeat(64)}`,
    output_hash: resultHash,
    record_hash: `sha256:${"f".repeat(64)}`,
    error_code: null,
    elapsed_ms: 2,
  }];
  const requestSource = request.body["source"] as JsonObject;
  return {
    request: {
      payload_hash: canonicalHash(request.body),
      source_text_sha256: sha256(requestSource["originalText"] as string),
      request_metadata: { gateRunId: request.gateRunId, phase: request.phase },
      gowm_operation_lock_hash: operationLockHash,
    },
    job: { status, error: null },
    result: { status, result_hash: resultHash, result_bytes: Buffer.from(JSON.stringify(resultDocument), "utf8") },
    events,
    queries: operations.length === 0 ? [] : [{
      plan: plan(descriptorId, operations),
      plan_hash: canonicalHash(plan(descriptorId, operations)),
      upstream_result_hash: null,
    }],
    executions: executionRows(operations, statuses, finalSnapshot),
    snapshot: {
      operation_lock_hash: operationLockHash,
      gdps_recipe_lock_hash: recipeLockHash,
      gdps_descriptor_lock_hash: `sha256:${"0".repeat(64)}`,
      gdps_capability_snapshot_hash: capabilitySnapshotHash,
    },
  };
}

class FixtureSql implements GdpsV021DriverSqlClient {
  readonly fixtures = new Map<string, StoredFixture>();

  async query<Row extends object>(statement: string, values: readonly unknown[] = []): Promise<{
    rows: readonly Row[];
  }> {
    const id = String(values[0]);
    const fixture = this.fixtures.get(id);
    if (!fixture) throw new Error(`FIXTURE_NOT_FOUND_${id}`);
    let rows: readonly JsonObject[];
    if (statement.includes("wsgs.grounding_request")) rows = [fixture.request];
    else if (statement.includes("wsgs.grounding_job")) rows = [fixture.job];
    else if (statement.includes("wsgs.grounding_result")) rows = [fixture.result];
    else if (statement.includes("wsgs.pipeline_event")) rows = fixture.events;
    else if (statement.includes("wsgs.world_query")) rows = fixture.queries;
    else if (statement.includes("wsgs.gowm_execution")) rows = fixture.executions;
    else if (statement.includes("wsgs.capability_snapshot")) rows = [fixture.snapshot];
    else throw new Error(`UNEXPECTED_SQL_${statement}`);
    return { rows: rows as readonly Row[] };
  }
}

function harness(kind: "SUCCESS" | "NO_PREPARE" | "NO_BARRIER" | "BAD_BARRIER_RUN" |
  "BAD_SEED_SELECTION" | "BAD_DECISION_BLOCK") {
  const outputRoot = resolve(repositoryRoot, "reports", "wsgs-v0.2-gdps-v0.2.1", "drivers",
    `test-${kind.toLowerCase()}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  createdRoots.push(outputRoot);
  mkdirSync(outputRoot, { recursive: true });
  const files = runtimeFiles(outputRoot);
  const sql = new FixtureSql();
  const requests: GdpsV021NaturalLanguageDriverRequest[] = [];
  const input: GdpsV021DriverOrchestratorInput = {
    repositoryRoot,
    outputDirectory: outputRoot,
    manifestPath: resolve(outputRoot, "manifest.json"),
    gateRunId: runtimeIdentity.gateRunId,
    sourceCommit,
    handoffBundleHash: `sha256:${"b".repeat(64)}`,
    operationLockHash,
    provenanceHash: `sha256:${"c".repeat(64)}`,
    runtimeIdentity,
    runtimeRecipeLockPath: files.recipeLockPath,
    runtimeRecipeLockHash: files.recipeLockHash,
    runtimeConsumerSnapshotPath: files.snapshotPath,
    runtimeConsumerSnapshotHash: files.consumerSnapshotFileHash,
    providerRecipeLockPath: files.providerPath,
    providerRecipeLockHash: files.providerHash,
    sql,
    sampleSharedRuntimeHash: async () => sharedRuntimeHash,
    executeNaturalLanguageCase: async (request) => {
      requests.push(structuredClone(request));
      const id = `grounding-${request.caseId.toLowerCase()}-${request.phase.toLowerCase()}`;
      const drift = request.runtimeVariant.kind === "ISOLATED_RECIPE_LOCK_DRIFT";
      const recipeHash = drift ? request.runtimeVariant.recipeLockHash : files.recipeLockHash;
      const capabilityHash = drift
        ? (JSON.parse(readFileSync(request.runtimeVariant.consumerSnapshotPath, "utf8")) as JsonObject)[
          "capabilitySnapshotHash"] as DriverDigest
        : files.capabilitySnapshotHash;
      const fixture = fixtureFor(request, recipeHash, capabilityHash);
      if (kind === "BAD_SEED_SELECTION" && request.phase === "CURRENTNESS_SEED") {
        const document = JSON.parse(Buffer.from(fixture.result["result_bytes"] as Uint8Array).toString("utf8")) as JsonObject;
        const evidenceItems = document["evidenceItems"] as JsonObject[];
        (evidenceItems[0]!["safePayload"] as JsonObject)["productId"] = "unrelated-product";
        fixture.result["result_bytes"] = Buffer.from(JSON.stringify(document), "utf8");
      }
      if (kind === "BAD_DECISION_BLOCK" && request.phase === "CURRENTNESS_REPLAY") {
        const document = JSON.parse(Buffer.from(fixture.result["result_bytes"] as Uint8Array).toString("utf8")) as JsonObject;
        (document["gdpsCurrentnessDecision"] as JsonObject)["executionBlocked"] = false;
        fixture.result["result_bytes"] = Buffer.from(JSON.stringify(document), "utf8");
        const snapshot = fixture.executions.at(-1)!["data_snapshot"] as JsonObject;
        (snapshot["gdpsCurrentnessDecision"] as JsonObject)["executionBlocked"] = false;
      }
      sql.fixtures.set(id, fixture);
      return { groundingId: id, requestHash: canonicalHash(request.body) };
    },
    ...(kind === "NO_PREPARE" ? {} : {
      prepareIsolatedRuntime: async (request) => {
        const document = {
          schemaVersion: "wsgs-gdps-isolated-driver-runtime/1.0",
          gateRunId: request.gateRunId,
          caseId: request.caseId,
          targetState: request.targetState,
          runtimeIdentityHash: request.runtimeIdentityHash,
          sharedRuntimeBeforeHash: request.sharedRuntimeBeforeHash,
          ready: true,
          requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY",
          isolatedRuntime: true,
          sharedRuntimeMutated: false,
          directProviderCalls: 0,
          gatewayRuntimeHash: `sha256:${"d".repeat(64)}`,
          gdpsProviderRuntimeHash: `sha256:${"e".repeat(64)}`,
        };
        const artifact = jsonFile(resolve(outputRoot, `${request.caseId}-${request.targetState}.runtime.json`), document);
        return { attestationPath: artifact.path, attestationHash: artifact.hash };
      },
    }),
    ...(kind === "NO_BARRIER" ? {} : {
      crossCurrentnessBarrier: async (request) => {
        const document = {
          schemaVersion: "wsgs-gdps-currentness-epoch-barrier/1.0",
          gateRunId: kind === "BAD_BARRIER_RUN" ? "wrong-gate-run" : request.gateRunId,
          caseId: request.caseId,
          fromEpoch: "INITIAL_A",
          toEpoch: "CURRENT_B",
          productId: request.productId,
          fromContentHash: request.initialContentHash,
          toContentHash: slopeBHash,
          sourceGroundingIdHash: request.sourceGroundingIdHash,
          sourceResultHash: request.sourceResultHash,
          initialEpochAttestationHash: request.initialEpochAttestationHash,
          requiredExecutionPath: "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY",
          isolatedRuntime: true,
          sharedRuntimeMutated: false,
          directProviderCalls: 0,
        };
        const artifact = jsonFile(resolve(outputRoot, "currentness-barrier.json"), document);
        return { attestationPath: artifact.path, attestationHash: artifact.hash };
      },
    }),
  };
  return { input, outputRoot, requests };
}

describe("GDPS v0.2.1 same-run driver orchestrator", () => {
  it("re-reads persisted SQL facts and injects only the persisted INITIAL_A prior after a verified barrier", async () => {
    const { input, outputRoot, requests } = harness("SUCCESS");
    const result = await runGdpsV021DriverOrchestrator(input);
    expect(result.runtimeIdentityHash).toBe(runtimeIdentityHash);
    expect(result.drivers.map((entry) => entry.caseId)).toEqual([
      "NEG-DATA-GAP", "NEG-RECIPE-DRIFT", "NEG-TRUNCATED", "NEG-CURRENTNESS",
    ]);
    expect(existsSync(resolve(outputRoot, "manifest.json"))).toBe(true);
    const replay = requests.find((entry) => entry.phase === "CURRENTNESS_REPLAY")!;
    expect(replay.runtimeVariant.kind).toBe("ISOLATED_CURRENTNESS_EPOCH_B");
    expect((replay.body["contextCapsule"] as JsonObject)["priorGroundings"]).toEqual([{
      groundingId: "grounding-neg-currentness-currentness_seed",
      resultHash: sqlResultHash(input, "grounding-neg-currentness-currentness_seed"),
      selectedProductIds: ["evidence-slope-a"],
    }]);
    const evidence = JSON.parse(readFileSync(resolve(outputRoot, "NEG-CURRENTNESS.evidence.json"), "utf8")) as JsonObject;
    const facts = evidence["persistedFacts"] as JsonObject;
    expect(facts["normalizedStatus"]).toBe("STALE");
    expect(facts["semanticCode"]).toBe("SNAPSHOT_MISMATCHED");
    expect(facts["originalQueryExecutions"]).toEqual([]);
    expect((facts["executionEvidence"] as JsonObject[]).map((entry) => entry["operationKey"]))
      .toEqual(["geo-product.check-current@1.0"]);
  });

  it("fails closed as NOT_RUN without an isolated truncated runtime contract and writes no manifest", async () => {
    const { input, outputRoot } = harness("NO_PREPARE");
    await expect(runGdpsV021DriverOrchestrator(input)).rejects.toMatchObject({
      caseId: "NEG-TRUNCATED",
      code: "ISOLATED_TRUNCATED_RUNTIME_UNAVAILABLE",
    } satisfies Partial<GdpsV021DriverExternalContractError>);
    expect(existsSync(resolve(outputRoot, "manifest.json"))).toBe(false);
    const blocked = JSON.parse(readFileSync(resolve(outputRoot, "driver-orchestration-blocked.json"), "utf8")) as JsonObject;
    expect(blocked).toMatchObject({ status: "NOT_RUN", validDriverManifestWritten: false });
  });

  it("does not persist INITIAL_A or a replay when the A-to-B barrier contract is absent", async () => {
    const { input, outputRoot, requests } = harness("NO_BARRIER");
    await expect(runGdpsV021DriverOrchestrator(input)).rejects.toMatchObject({
      caseId: "NEG-CURRENTNESS",
      code: "INITIAL_A_TO_CURRENT_B_BARRIER_UNAVAILABLE",
    } satisfies Partial<GdpsV021DriverExternalContractError>);
    expect(requests.some((entry) => entry.caseId === "NEG-CURRENTNESS")).toBe(false);
    expect(existsSync(resolve(outputRoot, "manifest.json"))).toBe(false);
  });

  it("rejects a barrier bound to another gate run before replay", async () => {
    const { input, requests } = harness("BAD_BARRIER_RUN");
    await expect(runGdpsV021DriverOrchestrator(input)).rejects.toMatchObject({
      code: "CURRENTNESS_BARRIER_GATE_RUN_DRIFT",
    });
    expect(requests.filter((entry) => entry.caseId === "NEG-CURRENTNESS").map((entry) => entry.phase))
      .toEqual(["CURRENTNESS_SEED"]);
  });

  it("rejects a selected evidence item that is not the persisted GDPS source product", async () => {
    const { input, requests } = harness("BAD_SEED_SELECTION");
    await expect(runGdpsV021DriverOrchestrator(input)).rejects.toMatchObject({
      code: "CURRENTNESS_SEED_EVIDENCE_PRODUCT_NOT_EXACT",
    });
    expect(requests.some((entry) => entry.phase === "CURRENTNESS_REPLAY")).toBe(false);
  });

  it("requires executionBlocked=true even when the currentness status and code are allowed", async () => {
    const { input } = harness("BAD_DECISION_BLOCK");
    await expect(runGdpsV021DriverOrchestrator(input)).rejects.toMatchObject({
      code: "CURRENTNESS_FAIL_CLOSED_DECISION_MISSING",
    });
  });
});

function sqlResultHash(input: GdpsV021DriverOrchestratorInput, id: string): DriverDigest {
  const fixture = (input.sql as FixtureSql).fixtures.get(id);
  if (!fixture) throw new Error("TEST_FIXTURE_RESULT_MISSING");
  return fixture.result["result_hash"] as DriverDigest;
}
