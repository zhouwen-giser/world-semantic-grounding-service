import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import {
  captureGdpsV021W43RuntimeReceipts,
  writeGdpsV021W43RuntimeReceipts,
  type GdpsV021W43AuthorityTuple,
  type GdpsV021W43ArtifactReference,
  type GdpsV021W43RequestOpenContext,
  type GdpsV021W43ScenarioPointer,
  type W43ReadOnlySqlPool,
} from "./capture-gdps-v021-w43-runtime-receipts.js";
import type {
  GdpsV021W43RuntimeBinding,
  GdpsV021W43ScenarioId,
} from "./produce-gdps-v021-w43-evidence.js";

type JsonObject = Record<string, unknown>;
type Digest = `sha256:${string}`;

const scenarios = Object.freeze([
  { id: "CURRENT_STRICT", externalId: "W43-STRICT-CURRENT", replayMode: "STRICT", afterSource: [], duringReplay: [], afterReplay: [] },
  { id: "CHANGED_STRICT", externalId: "W43-STRICT-CHANGED", replayMode: "STRICT", afterSource: ["AFTER_PRIOR_GROUNDING:A_TO_B"], duringReplay: [], afterReplay: [] },
  { id: "NOT_AVAILABLE_STRICT", externalId: "W43-STRICT-NOT-AVAILABLE", replayMode: "STRICT", afterSource: ["AFTER_PRIOR_GROUNDING:DISABLE_CURRENT_PRODUCT"], duringReplay: [], afterReplay: ["AFTER_SCENARIO:RESTORE_A"] },
  { id: "CHANGED_BEST_EFFORT", externalId: "W43-BEST-EFFORT-CHANGED", replayMode: "BEST_EFFORT", afterSource: ["AFTER_PRIOR_GROUNDING:A_TO_B"], duringReplay: [], afterReplay: [] },
  { id: "SOURCE_CHANGED_ONCE", externalId: "W43-SOURCE-CHANGED-ONCE-THEN-SUCCESS", replayMode: "BEST_EFFORT", afterSource: ["BEFORE_REPLAY_QUERY:A_TO_B"], duringReplay: [], afterReplay: [] },
  { id: "SOURCE_CHANGED_TWICE", externalId: "W43-SOURCE-CHANGED-TWICE-INDETERMINATE", replayMode: "BEST_EFFORT", afterSource: ["BEFORE_REPLAY_QUERY:A_TO_B"], duringReplay: ["AFTER_FIRST_SOURCE_CHANGED:B_TO_A"], afterReplay: ["FINALIZE_B"] },
] as const);
export const GDPS_V021_W43_RUNTIME_SCENARIO_IDS = Object.freeze(
  scenarios.map((entry) => entry.id) as readonly GdpsV021W43ScenarioId[],
);

export type GdpsV021W43BarrierName =
  | "PREPARE_A"
  | "AFTER_PRIOR_GROUNDING:A_TO_B"
  | "AFTER_PRIOR_GROUNDING:DISABLE_CURRENT_PRODUCT"
  | "AFTER_SCENARIO:RESTORE_A"
  | "BEFORE_REPLAY_QUERY:A_TO_B"
  | "AFTER_FIRST_SOURCE_CHANGED:B_TO_A"
  | "FINALIZE_B";

export interface GdpsV021W43BarrierArtifact {
  readonly bytes: Uint8Array;
  readonly hash: Digest;
}

export type GdpsV021W43BarrierArmArtifact = GdpsV021W43BarrierArtifact;

export interface GdpsV021W43ExecutionRequest {
  readonly scenarioId: GdpsV021W43ScenarioId;
  readonly phase: "SOURCE" | "REPLAY";
  readonly body: JsonObject;
  readonly requiredBarrierHash: Digest;
  readonly replayBarrierArmHash?: Digest;
}

export interface GdpsV021W43ExecutionResult {
  readonly groundingId: string;
  readonly requestHash: Digest;
}

export interface GdpsV021W43RuntimeGateInput {
  readonly repositoryRoot: string;
  readonly binding: GdpsV021W43RuntimeBinding;
  readonly authority: GdpsV021W43AuthorityTuple;
  readonly pool: W43ReadOnlySqlPool;
  readonly generatedAt: string;
  readonly currentnessReceiptPath: string;
  readonly postgresReceiptPath: string;
  readonly barrierAttestationPath: string;
  readonly replayBarrierArmAttestationPath: string;
  readonly manifestPath: string;
  readonly executeNaturalLanguageCase: (request: GdpsV021W43ExecutionRequest) => Promise<GdpsV021W43ExecutionResult>;
  readonly advanceBarrier: (request: {
    readonly scenarioId: string;
    readonly barrier: GdpsV021W43BarrierName;
    readonly candidateSha: string;
    readonly gateRunId: string;
    readonly runtimeIdentityHash: Digest;
  }) => Promise<GdpsV021W43BarrierArtifact>;
  readonly armReplayBarrier: (request: {
    readonly scenarioId: string;
    readonly barrier: "AFTER_FIRST_SOURCE_CHANGED:B_TO_A";
    readonly candidateSha: string;
    readonly gateRunId: string;
    readonly runtimeIdentityHash: Digest;
  }) => Promise<GdpsV021W43BarrierArmArtifact>;
  readonly readBarrierAttestation: () => Promise<GdpsV021W43BarrierArtifact>;
  readonly openPersistedRequest: (ciphertext: Uint8Array, context: GdpsV021W43RequestOpenContext) => Promise<Uint8Array>;
}

export interface GdpsV021W43RuntimeGateResult {
  readonly status: "PASS";
  readonly manifestPath: string;
  readonly manifestHash: Digest;
  readonly barrierAttestationHash: Digest;
  readonly scenarioCount: 6;
}

export class GdpsV021W43RuntimeGateError extends Error {
  public constructor(readonly code: string) {
    super(code);
    this.name = "GdpsV021W43RuntimeGateError";
  }
}

function fail(code: string): never { throw new GdpsV021W43RuntimeGateError(code); }
function sha256(value: Uint8Array | string): Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as JsonObject).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}
function authorityTupleHash(value: GdpsV021W43AuthorityTuple): Digest { return sha256(canonicalJson(value)); }
function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as JsonObject;
}
function requestBody(input: {
  readonly scenarioId: GdpsV021W43ScenarioId;
  readonly phase: "SOURCE" | "REPLAY";
  readonly gateRunId: string;
  readonly replayMode: "STRICT" | "BEST_EFFORT";
  readonly priorGroundings: readonly JsonObject[];
  readonly generatedAt: string;
  readonly barrierTransitionHash: Digest;
  readonly replayBarrierArmHash?: Digest;
}): JsonObject {
  const text = input.phase === "SOURCE"
    ? "A区内坡度15到30度的区域有哪些？"
    : "严格重用之前的坡度查询证据。";
  const requestId = `w43-${input.scenarioId.toLowerCase()}-${input.phase.toLowerCase()}-${input.gateRunId}`;
  return {
    schemaVersion: "1.0",
    requestId,
    operation: "EXECUTE_WORLD_QUERY",
    source: {
      // The public request schema is closed. Bind the causal barrier through
      // its existing durable identifiers so the encrypted persisted request
      // can be reopened and verified without adding an out-of-contract field.
      conversationRef: `${requestId}.barrier.${input.barrierTransitionHash}`,
      messageId: input.replayBarrierArmHash === undefined
        ? `${requestId}.arm.none` : `${requestId}.arm.${input.replayBarrierArmHash}`,
      originalText: text,
      originalTextSha256: sha256(text),
      locale: "zh-CN",
      createdAt: input.generatedAt,
    },
    requestedProducts: ["WORLD_EVIDENCE"],
    contextCapsule: {
      knownWorldReferences: [], priorGroundings: input.priorGroundings,
      mapSelections: [], externalCorrelationHints: [], externalPredicates: [],
    },
    executionPolicy: {
      readOnly: true, deadlineMs: 120_000, maxQueryOperations: 16,
      maxCandidatesPerMention: 20, maxResultBytes: 1_048_576,
      allowApproximation: input.replayMode === "BEST_EFFORT",
    },
  };
}

async function sourcePointer(
  pool: W43ReadOnlySqlPool,
  groundingId: string,
  authority: GdpsV021W43AuthorityTuple,
): Promise<{ readonly resultHash: Digest; readonly selectedProductId: string }> {
  const client = await pool.connect();
  try {
    const found = await client.query<{ result_hash: string; result_bytes: Buffer }>(
      `SELECT result.result_hash, result.result_bytes
         FROM wsgs.grounding_result AS result
         JOIN wsgs.grounding_request AS request USING (grounding_id)
        WHERE result.grounding_id = $1 AND result.data_scope = $2 AND result.actor_id = $3
          AND request.principal_id = $4 AND request.authorization_context_hash = $5
          AND request.gowm_operation_lock_hash = $6
          AND request.dataset_scopes @> $7::jsonb AND request.dataset_scopes <@ $7::jsonb
          AND jsonb_array_length(request.dataset_scopes) = $8`,
      [groundingId, authority.dataScope, authority.actorId, authority.principalId,
        authority.authorizationContextHash, authority.operationLockHash,
        JSON.stringify(authority.datasetScopes), authority.datasetScopes.length],
    );
    if (found.rows.length !== 1 || !/^sha256:[0-9a-f]{64}$/u.test(found.rows[0]!.result_hash)) {
      fail("W43_SOURCE_RESULT_AUTHORITY_BINDING_INVALID");
    }
    const result = object(JSON.parse(found.rows[0]!.result_bytes.toString("utf8")), "W43_SOURCE_RESULT_INVALID");
    const candidates = Array.isArray(result["evidenceItems"])
      ? result["evidenceItems"].filter((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
        const payload = (entry as JsonObject)["safePayload"];
        return Boolean(payload) && typeof payload === "object" && !Array.isArray(payload) &&
          typeof (payload as JsonObject)["productId"] === "string" &&
          /^sha256:[0-9a-f]{64}$/u.test(String((payload as JsonObject)["contentHash"]));
      }) as JsonObject[] : [];
    if (candidates.length !== 1 || typeof candidates[0]!["evidenceProductId"] !== "string") {
      fail("W43_SOURCE_CURRENT_PRODUCT_SELECTION_INVALID");
    }
    return { resultHash: found.rows[0]!.result_hash as Digest, selectedProductId: candidates[0]!["evidenceProductId"] as string };
  } finally { client.release(); }
}

function recorded(body: JsonObject, barrierTransitionHash: Digest, replayBarrierArmHash?: Digest): {
  readonly requestId: string;
  readonly requestHash: Digest;
  readonly sourceTextHash: Digest;
  readonly barrierTransitionHash: Digest;
  readonly replayBarrierArmHash: Digest | null;
} {
  const source = object(body["source"], "W43_REQUEST_SOURCE_INVALID");
  if (typeof body["requestId"] !== "string" || typeof source["originalText"] !== "string" ||
      source["conversationRef"] !== `${body["requestId"]}.barrier.${barrierTransitionHash}` ||
      source["messageId"] !== (replayBarrierArmHash === undefined
        ? `${body["requestId"]}.arm.none` : `${body["requestId"]}.arm.${replayBarrierArmHash}`)) {
    fail("W43_REQUEST_IDENTITY_INVALID");
  }
  return {
    requestId: body["requestId"], requestHash: sha256(canonicalJson(body)),
    sourceTextHash: sha256(source["originalText"]), barrierTransitionHash,
    replayBarrierArmHash: replayBarrierArmHash ?? null,
  };
}

function lastTransitionHash(artifact: GdpsV021W43BarrierArtifact): Digest {
  const document = object(JSON.parse(Buffer.from(artifact.bytes).toString("utf8")), "W43_BARRIER_ATTESTATION_INVALID");
  const transitions = document["transitions"];
  if (!Array.isArray(transitions) || transitions.length === 0) fail("W43_BARRIER_TRANSITIONS_MISSING");
  const value = object(transitions.at(-1), "W43_BARRIER_TRANSITION_INVALID")["transitionHash"];
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail("W43_BARRIER_TRANSITION_HASH_INVALID");
  }
  return value as Digest;
}

function transitionHashes(bytes: Uint8Array): ReadonlyMap<GdpsV021W43ScenarioId, readonly Digest[]> {
  const document = object(JSON.parse(Buffer.from(bytes).toString("utf8")), "W43_BARRIER_ATTESTATION_INVALID");
  const transitions = document["transitions"];
  if (!Array.isArray(transitions)) fail("W43_BARRIER_TRANSITIONS_MISSING");
  const map = new Map<GdpsV021W43ScenarioId, Digest[]>();
  for (const scenario of scenarios) {
    const values = transitions.filter((entry) => object(entry, "W43_BARRIER_TRANSITION_INVALID")["scenarioId"] === scenario.externalId)
      .map((entry) => object(entry, "W43_BARRIER_TRANSITION_INVALID")["transitionHash"])
      .filter((entry): entry is Digest => typeof entry === "string" && /^sha256:[0-9a-f]{64}$/u.test(entry));
    map.set(scenario.id, values);
  }
  return map;
}

function assertIntermediateBarrier(
  artifact: GdpsV021W43BarrierArtifact,
  input: GdpsV021W43RuntimeGateInput,
  expectedCount: number,
  expectedScenarioId: string,
  expectedBarrier: GdpsV021W43BarrierName,
): void {
  if (sha256(artifact.bytes) !== artifact.hash) fail("W43_INTERMEDIATE_BARRIER_HASH_DRIFT");
  const document = object(JSON.parse(Buffer.from(artifact.bytes).toString("utf8")),
    "W43_INTERMEDIATE_BARRIER_INVALID");
  const transitions = document["transitions"];
  if (document["schemaVersion"] !== "gdps-v021-w43-barrier-attestation/1.0" ||
      document["candidateSha"] !== input.binding.candidateSha ||
      document["gateRunIdHash"] !== sha256(canonicalJson({ gateRunId: input.binding.gateRunId })) ||
      document["runtimeIdentityHash"] !== sha256(canonicalJson({ runtimeIdentity: input.binding.runtimeIdentityHash })) ||
      document["transitionCount"] !== expectedCount || !Array.isArray(transitions) ||
      transitions.length !== expectedCount ||
      object(transitions.at(-1), "W43_INTERMEDIATE_BARRIER_LAST_TRANSITION_INVALID")["scenarioId"] !== expectedScenarioId ||
      object(transitions.at(-1), "W43_INTERMEDIATE_BARRIER_LAST_TRANSITION_INVALID")["barrier"] !== expectedBarrier ||
      (expectedCount === 14 ? document["status"] !== "PASS" : document["status"] !== "IN_PROGRESS")) {
    fail("W43_INTERMEDIATE_BARRIER_CAUSAL_ORDER_INVALID");
  }
}

export async function runGdpsV021W43RuntimeGate(input: GdpsV021W43RuntimeGateInput): Promise<GdpsV021W43RuntimeGateResult> {
  const pointers: GdpsV021W43ScenarioPointer[] = [];
  let latest: GdpsV021W43BarrierArtifact | undefined;
  let replayBarrierArmArtifact: GdpsV021W43BarrierArmArtifact | undefined;
  let replayBarrierArmReference: GdpsV021W43ArtifactReference | undefined;
  const partial: Array<Omit<GdpsV021W43ScenarioPointer, "barrierTransitionHashes" | "causalBindingHash">> = [];
  let expectedBarrierCount = 0;
  for (const scenario of scenarios) {
    latest = await input.advanceBarrier({ scenarioId: scenario.externalId, barrier: "PREPARE_A",
      candidateSha: input.binding.candidateSha, gateRunId: input.binding.gateRunId,
      runtimeIdentityHash: input.binding.runtimeIdentityHash });
    expectedBarrierCount += 1;
    assertIntermediateBarrier(latest, input, expectedBarrierCount, scenario.externalId, "PREPARE_A");
    const sourceBarrierTransitionHash = lastTransitionHash(latest);
    const sourceBody = requestBody({ scenarioId: scenario.id, phase: "SOURCE", gateRunId: input.binding.gateRunId,
      replayMode: scenario.replayMode, priorGroundings: [], generatedAt: input.generatedAt,
      barrierTransitionHash: sourceBarrierTransitionHash });
    const sourceExecution = await input.executeNaturalLanguageCase({
      scenarioId: scenario.id, phase: "SOURCE", body: sourceBody,
      requiredBarrierHash: sourceBarrierTransitionHash,
    });
    const sourceRecorded = recorded(sourceBody, sourceBarrierTransitionHash);
    if (sourceExecution.requestHash !== sourceRecorded.requestHash) fail("W43_SOURCE_EXECUTION_REQUEST_HASH_DRIFT");
    const source = await sourcePointer(input.pool, sourceExecution.groundingId, input.authority);
    for (const barrier of scenario.afterSource) {
      latest = await input.advanceBarrier({ scenarioId: scenario.externalId, barrier,
        candidateSha: input.binding.candidateSha, gateRunId: input.binding.gateRunId,
        runtimeIdentityHash: input.binding.runtimeIdentityHash });
      expectedBarrierCount += 1;
      assertIntermediateBarrier(latest, input, expectedBarrierCount, scenario.externalId, barrier);
    }
    let armArtifact: GdpsV021W43BarrierArmArtifact | undefined;
    for (const barrier of scenario.duringReplay) {
      armArtifact = await input.armReplayBarrier({ scenarioId: scenario.externalId, barrier,
        candidateSha: input.binding.candidateSha, gateRunId: input.binding.gateRunId,
        runtimeIdentityHash: input.binding.runtimeIdentityHash });
      if (sha256(armArtifact.bytes) !== armArtifact.hash || replayBarrierArmArtifact !== undefined) {
        fail("W43_REPLAY_BARRIER_ARM_ARTIFACT_INVALID");
      }
      replayBarrierArmArtifact = armArtifact;
    }
    const replayBarrierTransitionHash = lastTransitionHash(latest);
    const replayBody = requestBody({ scenarioId: scenario.id, phase: "REPLAY", gateRunId: input.binding.gateRunId,
      replayMode: scenario.replayMode, generatedAt: input.generatedAt,
      barrierTransitionHash: replayBarrierTransitionHash,
      ...(armArtifact ? { replayBarrierArmHash: armArtifact.hash } : {}), priorGroundings: [{
        groundingId: sourceExecution.groundingId, resultHash: source.resultHash,
        selectedProductIds: [source.selectedProductId],
      }] });
    const replayExecution = await input.executeNaturalLanguageCase({
      scenarioId: scenario.id, phase: "REPLAY", body: replayBody,
      requiredBarrierHash: replayBarrierTransitionHash,
      ...(armArtifact ? { replayBarrierArmHash: armArtifact.hash } : {}),
    });
    const replayRecorded = recorded(replayBody, replayBarrierTransitionHash, armArtifact?.hash);
    if (replayExecution.requestHash !== replayRecorded.requestHash) fail("W43_REPLAY_EXECUTION_REQUEST_HASH_DRIFT");
    latest = await input.readBarrierAttestation();
    if (scenario.duringReplay.length > 0) {
      expectedBarrierCount += scenario.duringReplay.length;
      assertIntermediateBarrier(latest, input, expectedBarrierCount, scenario.externalId, scenario.duringReplay.at(-1)!);
    } else {
      const expectedLast = scenario.afterSource.at(-1) ?? "PREPARE_A";
      assertIntermediateBarrier(latest, input, expectedBarrierCount, scenario.externalId, expectedLast);
    }
    for (const barrier of scenario.afterReplay) {
      latest = await input.advanceBarrier({ scenarioId: scenario.externalId, barrier,
        candidateSha: input.binding.candidateSha, gateRunId: input.binding.gateRunId,
        runtimeIdentityHash: input.binding.runtimeIdentityHash });
      expectedBarrierCount += 1;
      assertIntermediateBarrier(latest, input, expectedBarrierCount, scenario.externalId, barrier);
    }
    partial.push({
      scenarioId: scenario.id,
      sourceGroundingId: sourceExecution.groundingId,
      replayGroundingId: replayExecution.groundingId,
      sourceRequest: sourceRecorded,
      replayRequest: replayRecorded,
      replayBarrierArm: null,
    });
  }
  if (!latest) fail("W43_BARRIER_ATTESTATION_MISSING");
  if (expectedBarrierCount !== 14) fail("W43_BARRIER_STEP_INVENTORY_INCOMPLETE");
  const barrierAbsolute = resolve(input.repositoryRoot, input.barrierAttestationPath);
  const barrierRelative = relative(resolve(input.repositoryRoot), barrierAbsolute).replaceAll("\\", "/");
  if (barrierRelative !== input.barrierAttestationPath.replaceAll("\\", "/") ||
      !barrierRelative.startsWith("reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/") ||
      barrierRelative.includes("..") || sha256(latest.bytes) !== latest.hash) {
    fail("W43_BARRIER_ATTESTATION_OUTPUT_INVALID");
  }
  mkdirSync(dirname(barrierAbsolute), { recursive: true });
  writeFileSync(barrierAbsolute, latest.bytes, { flag: "wx" });
  const barrierReference = { path: barrierRelative, hash: latest.hash, byteLength: latest.bytes.byteLength };
  if (!replayBarrierArmArtifact) fail("W43_REPLAY_BARRIER_ARM_ARTIFACT_MISSING");
  const armAbsolute = resolve(input.repositoryRoot, input.replayBarrierArmAttestationPath);
  const armRelative = relative(resolve(input.repositoryRoot), armAbsolute).replaceAll("\\", "/");
  if (armRelative !== input.replayBarrierArmAttestationPath.replaceAll("\\", "/") ||
      !armRelative.startsWith("reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/") ||
      armRelative.includes("..") || armRelative === barrierRelative) {
    fail("W43_REPLAY_BARRIER_ARM_OUTPUT_INVALID");
  }
  mkdirSync(dirname(armAbsolute), { recursive: true });
  writeFileSync(armAbsolute, replayBarrierArmArtifact.bytes, { flag: "wx" });
  replayBarrierArmReference = {
    path: armRelative, hash: replayBarrierArmArtifact.hash,
    byteLength: replayBarrierArmArtifact.bytes.byteLength,
  };
  const hashes = transitionHashes(latest.bytes);
  for (const entry of partial) {
    const barrierTransitionHashes = hashes.get(entry.scenarioId) ?? [];
    const replayBarrierArm = entry.scenarioId === "SOURCE_CHANGED_TWICE"
      ? replayBarrierArmReference : null;
    const causalBindingHash = sha256(canonicalJson({
      candidateSha: input.binding.candidateSha, gateRunId: input.binding.gateRunId,
      runtimeIdentityHash: input.binding.runtimeIdentityHash, scenarioId: entry.scenarioId,
      authorityTupleHash: authorityTupleHash(input.authority), barrierAttestationHash: latest.hash,
      sourceGroundingIdHash: sha256(entry.sourceGroundingId), replayGroundingIdHash: sha256(entry.replayGroundingId),
      sourceRequest: entry.sourceRequest, replayRequest: entry.replayRequest,
      replayBarrierArm, barrierTransitionHashes,
    }));
    pointers.push({ ...entry, replayBarrierArm, barrierTransitionHashes, causalBindingHash });
  }
  const receipt = await captureGdpsV021W43RuntimeReceipts({
    pool: input.pool, binding: input.binding, authority: input.authority, scenarios: pointers,
    barrierAttestationBytes: latest.bytes, barrierAttestationHash: latest.hash,
    barrierAttestationReference: barrierReference,
    replayBarrierArmArtifact: {
      bytes: replayBarrierArmArtifact.bytes,
      reference: replayBarrierArmReference,
    },
    openPersistedRequest: input.openPersistedRequest, generatedAt: input.generatedAt,
  });
  writeGdpsV021W43RuntimeReceipts({ repositoryRoot: input.repositoryRoot,
    currentnessPath: input.currentnessReceiptPath, postgresPath: input.postgresReceiptPath, receipt });
  const manifest = {
    schemaVersion: "wsgs-gdps-v021-w43-runtime-manifest/1.0", status: "PASS",
    candidateSha: input.binding.candidateSha, gateRunId: input.binding.gateRunId,
    runtimeIdentityHash: input.binding.runtimeIdentityHash, barrierAttestation: barrierReference,
    authorityTupleHash: authorityTupleHash(input.authority),
    currentnessReceipt: { path: input.currentnessReceiptPath, hash: sha256(receipt.currentnessBytes),
      byteLength: receipt.currentnessBytes.byteLength },
    postgresReceipt: { path: input.postgresReceiptPath, hash: sha256(receipt.postgresBytes),
      byteLength: receipt.postgresBytes.byteLength },
    scenarios: pointers.map((entry) => ({ scenarioId: entry.scenarioId,
      causalBindingHash: entry.causalBindingHash, barrierTransitionHashes: entry.barrierTransitionHashes,
      replayBarrierArm: entry.replayBarrierArm,
      sourceGroundingIdHash: sha256(entry.sourceGroundingId), replayGroundingIdHash: sha256(entry.replayGroundingId),
      sourceRequest: entry.sourceRequest, replayRequest: entry.replayRequest })),
    directProviderCalls: 0, mockTransportUsed: false, credentialMaterialRecorded: false,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const absoluteManifest = resolve(input.repositoryRoot, input.manifestPath);
  const relativeManifest = relative(resolve(input.repositoryRoot), absoluteManifest).replaceAll("\\", "/");
  if (relativeManifest.startsWith("../") || !relativeManifest.startsWith("reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/")) {
    fail("W43_MANIFEST_PATH_INVALID");
  }
  mkdirSync(dirname(absoluteManifest), { recursive: true });
  writeFileSync(absoluteManifest, manifestBytes, { flag: "wx" });
  return { status: "PASS", manifestPath: relativeManifest, manifestHash: sha256(manifestBytes),
    barrierAttestationHash: latest.hash, scenarioCount: 6 };
}
