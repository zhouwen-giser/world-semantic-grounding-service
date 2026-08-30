import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  GdpsV021W43RuntimeBinding,
  GdpsV021W43ScenarioId,
} from "./produce-gdps-v021-w43-evidence.js";

type JsonObject = Record<string, unknown>;

export interface W43SqlResult<Row extends JsonObject = JsonObject> {
  readonly rows: readonly Row[];
}

export interface W43ReadOnlySqlClient {
  query<Row extends JsonObject = JsonObject>(sql: string, parameters?: readonly unknown[]): Promise<W43SqlResult<Row>>;
  release(): void;
}

export interface W43ReadOnlySqlPool {
  connect(): Promise<W43ReadOnlySqlClient>;
}

export interface GdpsV021W43ScenarioPointer {
  readonly scenarioId: GdpsV021W43ScenarioId;
  readonly sourceGroundingId: string;
  readonly replayGroundingId: string;
  readonly sourceRequest: GdpsV021W43RecordedRequest;
  readonly replayRequest: GdpsV021W43RecordedRequest;
  readonly replayBarrierArm: GdpsV021W43ArtifactReference | null;
  readonly barrierTransitionHashes: readonly `sha256:${string}`[];
  readonly causalBindingHash: `sha256:${string}`;
}

export interface GdpsV021W43RecordedRequest {
  readonly requestId: string;
  readonly requestHash: `sha256:${string}`;
  readonly sourceTextHash: `sha256:${string}`;
  readonly barrierTransitionHash: `sha256:${string}`;
  readonly replayBarrierArmHash: `sha256:${string}` | null;
}

export interface GdpsV021W43ArtifactReference {
  readonly path: string;
  readonly hash: `sha256:${string}`;
  readonly byteLength: number;
}

export interface GdpsV021W43AuthorityTuple {
  readonly dataScope: string;
  readonly actorId: string;
  readonly principalId: string;
  readonly datasetScopes: readonly string[];
  readonly authorizationContextHash: `sha256:${string}`;
  readonly operationLockHash: `sha256:${string}`;
}

export interface GdpsV021W43RequestOpenContext {
  readonly groundingId: string;
  readonly requestId: string;
}

export interface GdpsV021W43DatabaseProbe {
  readonly databaseIdentityHash: `sha256:${string}`;
  readonly serverVersion: string;
}

export interface GdpsV021W43RuntimeReceiptCaptureInput {
  readonly pool: W43ReadOnlySqlPool;
  readonly binding: GdpsV021W43RuntimeBinding;
  readonly authority: GdpsV021W43AuthorityTuple;
  readonly scenarios: readonly GdpsV021W43ScenarioPointer[];
  readonly barrierAttestationBytes: Uint8Array;
  readonly barrierAttestationHash: `sha256:${string}`;
  readonly barrierAttestationReference: {
    readonly path: string;
    readonly hash: `sha256:${string}`;
    readonly byteLength: number;
  };
  readonly replayBarrierArmArtifact?: {
    readonly bytes: Uint8Array;
    readonly reference: GdpsV021W43ArtifactReference;
  };
  readonly openPersistedRequest: (
    ciphertext: Uint8Array,
    context: GdpsV021W43RequestOpenContext,
  ) => Promise<Uint8Array>;
  readonly generatedAt: string;
}

export interface GdpsV021W43RuntimeReceiptCaptureResult {
  readonly currentnessDocument: JsonObject;
  readonly postgresDocument: JsonObject;
  readonly currentnessBytes: Buffer;
  readonly postgresBytes: Buffer;
  readonly migrationReceiptHash: `sha256:${string}`;
  readonly queryTranscriptHash: `sha256:${string}`;
}

export class GdpsV021W43RuntimeReceiptError extends Error {
  public readonly code: string;

  public constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "GdpsV021W43RuntimeReceiptError";
    this.code = code;
  }
}

const scenarioIds = Object.freeze([
  "CURRENT_STRICT",
  "CHANGED_STRICT",
  "NOT_AVAILABLE_STRICT",
  "CHANGED_BEST_EFFORT",
  "SOURCE_CHANGED_ONCE",
  "SOURCE_CHANGED_TWICE",
] as const);
const expectedMigrationVersions = Object.freeze([
  "001_wsgs_core.sql",
  "002_wsgs_gowm_063_runtime.sql",
  "003_wsgs_gdps_descriptor_runtime.sql",
] as const);
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const currentnessWarnings = new Set([
  "CURRENT_SOURCE_IDENTITY_CONFIRMED",
  "SOURCE_CHANGED",
  "SOURCE_NOT_AVAILABLE",
  "SOURCE_ADVANCED",
  "CURRENT_SOURCE_QUERY_RETRIED",
  "INDETERMINATE",
]);
const barrierSteps = Object.freeze([
  ["CURRENT_STRICT", "W43-STRICT-CURRENT", "PREPARE_A"],
  ["CHANGED_STRICT", "W43-STRICT-CHANGED", "PREPARE_A"],
  ["CHANGED_STRICT", "W43-STRICT-CHANGED", "AFTER_PRIOR_GROUNDING:A_TO_B"],
  ["NOT_AVAILABLE_STRICT", "W43-STRICT-NOT-AVAILABLE", "PREPARE_A"],
  ["NOT_AVAILABLE_STRICT", "W43-STRICT-NOT-AVAILABLE", "AFTER_PRIOR_GROUNDING:DISABLE_CURRENT_PRODUCT"],
  ["NOT_AVAILABLE_STRICT", "W43-STRICT-NOT-AVAILABLE", "AFTER_SCENARIO:RESTORE_A"],
  ["CHANGED_BEST_EFFORT", "W43-BEST-EFFORT-CHANGED", "PREPARE_A"],
  ["CHANGED_BEST_EFFORT", "W43-BEST-EFFORT-CHANGED", "AFTER_PRIOR_GROUNDING:A_TO_B"],
  ["SOURCE_CHANGED_ONCE", "W43-SOURCE-CHANGED-ONCE-THEN-SUCCESS", "PREPARE_A"],
  ["SOURCE_CHANGED_ONCE", "W43-SOURCE-CHANGED-ONCE-THEN-SUCCESS", "BEFORE_REPLAY_QUERY:A_TO_B"],
  ["SOURCE_CHANGED_TWICE", "W43-SOURCE-CHANGED-TWICE-INDETERMINATE", "PREPARE_A"],
  ["SOURCE_CHANGED_TWICE", "W43-SOURCE-CHANGED-TWICE-INDETERMINATE", "BEFORE_REPLAY_QUERY:A_TO_B"],
  ["SOURCE_CHANGED_TWICE", "W43-SOURCE-CHANGED-TWICE-INDETERMINATE", "AFTER_FIRST_SOURCE_CHANGED:B_TO_A"],
  ["SOURCE_CHANGED_TWICE", "W43-SOURCE-CHANGED-TWICE-INDETERMINATE", "FINALIZE_B"],
] as const);
const barrierStates = Object.freeze([
  ["INITIAL_A", "INITIAL_A"], ["INITIAL_A", "INITIAL_A"], ["INITIAL_A", "FINAL_B"],
  ["FINAL_B", "INITIAL_A"], ["INITIAL_A", "NOT_AVAILABLE"], ["NOT_AVAILABLE", "INITIAL_A"],
  ["INITIAL_A", "INITIAL_A"], ["INITIAL_A", "FINAL_B"], ["FINAL_B", "INITIAL_A"],
  ["INITIAL_A", "FINAL_B"], ["FINAL_B", "INITIAL_A"], ["INITIAL_A", "FINAL_B"],
  ["FINAL_B", "INITIAL_A"], ["INITIAL_A", "FINAL_B"],
] as const);
const replayBarrierIndex: Readonly<Record<GdpsV021W43ScenarioId, number>> = Object.freeze({
  CURRENT_STRICT: 0,
  CHANGED_STRICT: 1,
  NOT_AVAILABLE_STRICT: 1,
  CHANGED_BEST_EFFORT: 1,
  SOURCE_CHANGED_ONCE: 1,
  SOURCE_CHANGED_TWICE: 1,
});
const receiptPrefix = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/";

function fail(code: string, detail?: string): never {
  throw new GdpsV021W43RuntimeReceiptError(code, detail);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown, code: string): JsonObject {
  if (!isObject(value)) fail(code);
  return value;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}

function integer(value: unknown, code: string): number {
  const number = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || (number as number) < 0) fail(code);
  return number as number;
}

function digest(value: unknown, code: string): `sha256:${string}` {
  const result = text(value, code);
  if (!digestPattern.test(result)) fail(code);
  return result as `sha256:${string}`;
}

function sha256(value: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  return `{${Object.entries(value as JsonObject).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseJsonBytes(value: unknown, code: string): JsonObject {
  const bytes = Buffer.isBuffer(value) ? value : value instanceof Uint8Array ? Buffer.from(value) : undefined;
  if (!bytes) fail(code);
  try {
    return object(JSON.parse(bytes.toString("utf8")), code);
  } catch (error) {
    if (error instanceof GdpsV021W43RuntimeReceiptError) throw error;
    fail(code, error instanceof Error ? error.message : String(error));
  }
}

function collectNamedObjects(value: unknown, name: string, output: JsonObject[] = []): JsonObject[] {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectNamedObjects(entry, name, output));
    return output;
  }
  if (!isObject(value)) return output;
  for (const [key, entry] of Object.entries(value)) {
    if (key === name && isObject(entry)) output.push(entry);
    collectNamedObjects(entry, name, output);
  }
  return output;
}

function collectNamedArrays(value: unknown, name: string, output: unknown[][] = []): unknown[][] {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectNamedArrays(entry, name, output));
    return output;
  }
  if (!isObject(value)) return output;
  for (const [key, entry] of Object.entries(value)) {
    if (key === name && Array.isArray(entry)) output.push(entry);
    collectNamedArrays(entry, name, output);
  }
  return output;
}

function containsForbiddenProductVersion(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenProductVersion);
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, entry]) =>
    /^(?:productVersion|product_version|productVersionId|product_version_id)$/iu.test(key) ||
      containsForbiddenProductVersion(entry));
}

function barrierConversationRef(requestId: string, hash: `sha256:${string}`): string {
  return `${requestId}.barrier.${hash}`;
}

function armMessageId(requestId: string, hash: `sha256:${string}` | null): string {
  return hash === null ? `${requestId}.arm.none` : `${requestId}.arm.${hash}`;
}

function assertArtifactReference(value: GdpsV021W43ArtifactReference, code: string): void {
  if (!value.path.startsWith(receiptPrefix) || value.path.includes("..") || /^[A-Za-z]:|^\//u.test(value.path) ||
      !digestPattern.test(value.hash) || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1) {
    fail(code);
  }
}

function validateReplayBarrierArmArtifact(
  input: NonNullable<GdpsV021W43RuntimeReceiptCaptureInput["replayBarrierArmArtifact"]>,
  binding: GdpsV021W43RuntimeBinding,
): GdpsV021W43ArtifactReference {
  assertArtifactReference(input.reference, "W43_REPLAY_BARRIER_ARM_REFERENCE_INVALID");
  if (input.reference.hash !== sha256(input.bytes) || input.reference.byteLength !== input.bytes.byteLength) {
    fail("W43_REPLAY_BARRIER_ARM_HASH_DRIFT");
  }
  const document = parseJsonBytes(input.bytes, "W43_REPLAY_BARRIER_ARM_JSON_INVALID");
  const expectedKeys = ["barrier", "candidateSha", "challengeHash", "controllerIdHash", "gateRunId",
    "runtimeIdentityHash", "scenarioId", "schemaVersion", "sidecarContractHash"];
  if (JSON.stringify(Object.keys(document).sort()) !== JSON.stringify(expectedKeys.sort()) ||
      document["schemaVersion"] !== "wsgs-gdps-v021-w43-barrier-arm/1.0" ||
      document["candidateSha"] !== binding.candidateSha || document["gateRunId"] !== binding.gateRunId ||
      document["runtimeIdentityHash"] !== binding.runtimeIdentityHash ||
      document["scenarioId"] !== "W43-SOURCE-CHANGED-TWICE-INDETERMINATE" ||
      document["barrier"] !== "AFTER_FIRST_SOURCE_CHANGED:B_TO_A") {
    fail("W43_REPLAY_BARRIER_ARM_BINDING_INVALID");
  }
  for (const field of ["challengeHash", "controllerIdHash", "sidecarContractHash"] as const) {
    digest(document[field], "W43_REPLAY_BARRIER_ARM_DIGEST_INVALID");
  }
  return input.reference;
}

function uniqueObject(value: unknown, name: string, code: string): JsonObject {
  const objects = collectNamedObjects(value, name);
  const unique = new Map(objects.map((entry) => [canonicalJson(entry), entry]));
  if (unique.size !== 1) fail(code, `count=${unique.size}`);
  return [...unique.values()][0]!;
}

function relevantWarnings(result: JsonObject): string[] {
  return [...new Set(collectNamedArrays(result, "warnings").flat()
    .filter((entry): entry is string => typeof entry === "string" && currentnessWarnings.has(entry)))].sort();
}

function assertBinding(binding: GdpsV021W43RuntimeBinding): void {
  if (!/^[0-9a-f]{40}$/u.test(binding.candidateSha) ||
      !/^wsgs-gdps-v021-[a-z0-9][a-z0-9-]{7,95}$/u.test(binding.gateRunId) ||
      binding.providerId !== "gdps.geospatial-products" || binding.providerVersion !== "0.2.1" ||
      binding.capabilityCount !== 30 ||
      binding.requiredExecutionPath !== "RUNNING_GOWM_WORLD_CAPABILITY_GATEWAY" ||
      binding.gatewayOnly !== true || binding.directProviderCalls !== 0 || binding.mockTransportUsed !== false ||
      binding.databaseClass !== "REAL_ISOLATED_POSTGRESQL" || binding.sharedRuntimeMutated !== false) {
    fail("W43_RUNTIME_BINDING_INVALID");
  }
  for (const value of [
    binding.runtimeIdentityHash, binding.gowmGatewayIdentityHash, binding.wsgsRuntimeIdentityHash,
    binding.databaseIdentityHash, binding.handoffBundleHash, binding.operationLockHash,
    binding.providerRecipeLockHash,
  ]) digest(value, "W43_RUNTIME_BINDING_HASH_INVALID");
}

function assertAuthority(authority: GdpsV021W43AuthorityTuple, binding: GdpsV021W43RuntimeBinding): void {
  const scopes = [...authority.datasetScopes];
  if (!authority.dataScope || authority.dataScope.includes("*") || !authority.actorId || !authority.principalId ||
      scopes.some((entry) => !entry || entry.includes("*")) || new Set(scopes).size !== scopes.length ||
      JSON.stringify(scopes) !== JSON.stringify([...scopes].sort()) ||
      digest(authority.authorizationContextHash, "W43_AUTHORIZATION_CONTEXT_HASH_INVALID") === undefined ||
      authority.operationLockHash !== binding.operationLockHash) {
    fail("W43_AUTHORITY_TUPLE_INVALID");
  }
}

function authorityTupleHash(authority: GdpsV021W43AuthorityTuple): `sha256:${string}` {
  return sha256(canonicalJson(authority));
}

function transitionHash(value: JsonObject): `sha256:${string}` {
  return sha256(canonicalJson(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "transitionHash"))));
}

export function validateGdpsV021W43BarrierAttestation(
  bytes: Uint8Array,
  claimedHash: `sha256:${string}`,
  binding: GdpsV021W43RuntimeBinding,
): {
  readonly hash: `sha256:${string}`;
  readonly byScenario: ReadonlyMap<GdpsV021W43ScenarioId, readonly `sha256:${string}`[]>;
  readonly transitionsByScenario: ReadonlyMap<GdpsV021W43ScenarioId, readonly JsonObject[]>;
} {
  if (sha256(bytes) !== claimedHash) fail("W43_BARRIER_ATTESTATION_HASH_DRIFT");
  const document = parseJsonBytes(bytes, "W43_BARRIER_ATTESTATION_JSON_INVALID");
  const transitions = document["transitions"];
  if (document["schemaVersion"] !== "gdps-v021-w43-barrier-attestation/1.0" ||
      document["status"] !== "PASS" || document["candidateSha"] !== binding.candidateSha ||
      document["gateRunIdHash"] !== sha256(canonicalJson({ gateRunId: binding.gateRunId })) ||
      document["runtimeIdentityHash"] !== sha256(canonicalJson({ runtimeIdentity: binding.runtimeIdentityHash })) ||
      document["qualificationScope"] !== "FIXTURE_TRANSITIONS_ONLY" ||
      document["w43RuntimeQualificationStatus"] !== "NOT_RUN" ||
      document["runtimeEvidenceIncluded"] !== false || document["directProviderCalls"] !== 0 ||
      document["credentialMaterialRecorded"] !== false || document["transitionCount"] !== barrierSteps.length ||
      document["currentState"] !== "FINAL_B" || document["finalFixtureState"] !== "FINAL_B" ||
      !Array.isArray(transitions) || transitions.length !== barrierSteps.length) {
    fail("W43_BARRIER_ATTESTATION_BINDING_INVALID");
  }
  const providerRuntimeHash = digest(document["providerRuntimeIdentityHash"], "W43_BARRIER_PROVIDER_HASH_INVALID");
  const providerManifestHash = digest(document["providerManifestHash"], "W43_BARRIER_MANIFEST_HASH_INVALID");
  digest(document["contractHash"], "W43_BARRIER_CONTRACT_HASH_INVALID");
  digest(document["journalBindingHash"], "W43_BARRIER_JOURNAL_HASH_INVALID");
  const grouped = new Map<GdpsV021W43ScenarioId, `sha256:${string}`[]>();
  const transitionGroups = new Map<GdpsV021W43ScenarioId, JsonObject[]>();
  let previous: `sha256:${string}` | null = null;
  transitions.forEach((raw, index) => {
    const item = object(raw, "W43_BARRIER_TRANSITION_INVALID");
    const [internalId, externalId, barrier] = barrierSteps[index]!;
    const [expectedFrom, targetState] = barrierStates[index]!;
    const actual = digest(item["transitionHash"], "W43_BARRIER_TRANSITION_HASH_INVALID");
    if (item["sequence"] !== index + 1 || item["scenarioId"] !== externalId || item["barrier"] !== barrier ||
        item["status"] !== "PASS" || item["previousTransitionHash"] !== previous || actual !== transitionHash(item) ||
        item["expectedFrom"] !== expectedFrom || item["targetState"] !== targetState ||
        item["beforeState"] !== expectedFrom || item["afterState"] !== targetState ||
        item["foundationSchemaFingerprintBefore"] !== item["foundationSchemaFingerprintAfter"] ||
        item["foundationDataFingerprintBefore"] !== item["foundationDataFingerprintAfter"] ||
        item["nonTargetFingerprintBefore"] !== item["nonTargetFingerprintAfter"] ||
        item["providerRuntimeIdentityHashBefore"] !== providerRuntimeHash ||
        item["providerRuntimeIdentityHashAfter"] !== providerRuntimeHash ||
        item["providerManifestHashBefore"] !== providerManifestHash ||
        item["providerManifestHashAfter"] !== providerManifestHash ||
        item["providerRuntimeInvariant"] !== true || item["foundationInvariant"] !== true ||
        item["nonTargetInvariant"] !== true || item["directProviderCalls"] !== 0 ||
        item["credentialMaterialRecorded"] !== false ||
        !instantPattern.test(text(item["recordedAt"], "W43_BARRIER_TIME_INVALID"))) {
      fail("W43_BARRIER_TRANSITION_CHAIN_INVALID", String(index + 1));
    }
    for (const field of ["beforeContentHash", "afterContentHash", "journalIntentHash"] as const) {
      digest(item[field], "W43_BARRIER_TRANSITION_DIGEST_INVALID");
    }
    for (const field of [
      "foundationSchemaFingerprintBefore", "foundationSchemaFingerprintAfter",
      "foundationDataFingerprintBefore", "foundationDataFingerprintAfter",
      "nonTargetFingerprintBefore", "nonTargetFingerprintAfter",
    ] as const) digest(item[field], "W43_BARRIER_INVARIANT_HASH_INVALID");
    const values = grouped.get(internalId) ?? [];
    values.push(actual);
    grouped.set(internalId, values);
    const scenarioTransitions = transitionGroups.get(internalId) ?? [];
    scenarioTransitions.push(item);
    transitionGroups.set(internalId, scenarioTransitions);
    previous = actual;
  });
  return { hash: claimedHash, byScenario: grouped, transitionsByScenario: transitionGroups };
}

function expectedCausalBindingHash(
  binding: GdpsV021W43RuntimeBinding,
  authority: GdpsV021W43AuthorityTuple,
  pointer: GdpsV021W43ScenarioPointer,
  barrierAttestationHash: `sha256:${string}`,
): `sha256:${string}` {
  return sha256(canonicalJson({
    candidateSha: binding.candidateSha,
    gateRunId: binding.gateRunId,
    runtimeIdentityHash: binding.runtimeIdentityHash,
    authorityTupleHash: authorityTupleHash(authority),
    barrierAttestationHash,
    scenarioId: pointer.scenarioId,
    sourceGroundingIdHash: sha256(pointer.sourceGroundingId),
    replayGroundingIdHash: sha256(pointer.replayGroundingId),
    sourceRequest: pointer.sourceRequest,
    replayRequest: pointer.replayRequest,
    replayBarrierArm: pointer.replayBarrierArm,
    barrierTransitionHashes: pointer.barrierTransitionHashes,
  }));
}

interface IdentityRow extends JsonObject {
  readonly database_name: string;
  readonly database_user: string;
  readonly server_address: string | null;
  readonly server_port: number | null;
  readonly server_version: string;
}

async function databaseProbe(client: W43ReadOnlySqlClient): Promise<GdpsV021W43DatabaseProbe> {
  const result = await client.query<IdentityRow>(
    `SELECT current_database()::text AS database_name,
            current_user::text AS database_user,
            inet_server_addr()::text AS server_address,
            inet_server_port()::int AS server_port,
            current_setting('server_version')::text AS server_version`,
  );
  if (result.rows.length !== 1) fail("W43_DATABASE_IDENTITY_MISSING");
  const row = result.rows[0]!;
  const identity = {
    databaseName: text(row.database_name, "W43_DATABASE_NAME_MISSING"),
    databaseUser: text(row.database_user, "W43_DATABASE_USER_MISSING"),
    serverAddress: row.server_address ?? null,
    serverPort: row.server_port ?? null,
    serverVersion: text(row.server_version, "W43_DATABASE_VERSION_MISSING"),
  };
  if (!/^1[7-9](?:\.[0-9]+){0,2}$/u.test(identity.serverVersion)) fail("W43_DATABASE_VERSION_UNSUPPORTED");
  return { databaseIdentityHash: sha256(canonicalJson(identity)), serverVersion: identity.serverVersion };
}

export async function probeGdpsV021W43DatabaseIdentity(
  pool: W43ReadOnlySqlPool,
): Promise<GdpsV021W43DatabaseProbe> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const probe = await databaseProbe(client);
    await client.query("ROLLBACK");
    return probe;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* best-effort rollback */ }
    throw error;
  } finally {
    client.release();
  }
}

interface GroundingRow extends JsonObject {
  readonly request_id: string;
  readonly payload_hash: string;
  readonly source_text_sha256: string;
  readonly source_text_ciphertext: Buffer;
  readonly job_status: string;
  readonly result_status: string;
  readonly result_hash: string;
  readonly result_bytes: Buffer;
}

interface PersistedRequestEvidence {
  readonly row: GroundingRow;
  readonly result: JsonObject;
  readonly request: JsonObject;
  readonly requestEvidenceHash: `sha256:${string}`;
}

interface ExecutionRow extends JsonObject {
  readonly execution_kind: string;
  readonly operation_id: string | null;
  readonly operation_version: string | null;
  readonly gateway_query_id: string | null;
  readonly normalized_status: string;
  readonly data_snapshot: unknown;
}

async function groundingRow(
  client: W43ReadOnlySqlClient,
  groundingId: string,
  recorded: GdpsV021W43RecordedRequest,
  authority: GdpsV021W43AuthorityTuple,
  openPersistedRequest: GdpsV021W43RuntimeReceiptCaptureInput["openPersistedRequest"],
  kind: "SOURCE" | "REPLAY",
): Promise<PersistedRequestEvidence> {
  const found = await client.query<GroundingRow>(
    `SELECT request.request_id, request.payload_hash, request.source_text_sha256,
            request.source_text_ciphertext, job.status AS job_status,
            result.status AS result_status, result.result_hash, result.result_bytes
       FROM wsgs.grounding_request AS request
       JOIN wsgs.grounding_job AS job
         ON job.grounding_id = request.grounding_id AND job.data_scope = request.data_scope
        AND job.actor_id = request.actor_id
       JOIN wsgs.grounding_result AS result
         ON result.grounding_id = request.grounding_id AND result.data_scope = request.data_scope
        AND result.actor_id = request.actor_id
      WHERE request.grounding_id = $1 AND request.request_id = $2
        AND request.payload_hash = $3 AND request.source_text_sha256 = $4
        AND request.data_scope = $5 AND request.actor_id = $6 AND request.principal_id = $7
        AND request.authorization_context_hash = $8 AND request.gowm_operation_lock_hash = $9
        AND request.dataset_scopes @> $10::jsonb AND request.dataset_scopes <@ $10::jsonb
        AND jsonb_array_length(request.dataset_scopes) = $11`,
    [
      groundingId, recorded.requestId, recorded.requestHash, recorded.sourceTextHash,
      authority.dataScope, authority.actorId, authority.principalId, authority.authorizationContextHash,
      authority.operationLockHash, JSON.stringify(authority.datasetScopes), authority.datasetScopes.length,
    ],
  );
  if (found.rows.length !== 1) fail(`W43_${kind}_GROUNDING_ROW_INVALID`);
  const row = found.rows[0]!;
  if (row.request_id !== recorded.requestId || row.payload_hash !== recorded.requestHash ||
      row.source_text_sha256 !== recorded.sourceTextHash || row.job_status !== row.result_status ||
      digest(row.result_hash, `W43_${kind}_RESULT_HASH_INVALID`) === undefined) {
    fail(`W43_${kind}_GROUNDING_IDENTITY_INVALID`);
  }
  const result = parseJsonBytes(row.result_bytes, `W43_${kind}_RESULT_BYTES_INVALID`);
  if (result["groundingId"] !== groundingId || result["resultHash"] !== row.result_hash ||
      result["status"] !== row.result_status) fail(`W43_${kind}_RESULT_BINDING_INVALID`);
  if (!(row.source_text_ciphertext instanceof Uint8Array)) fail(`W43_${kind}_REQUEST_CIPHERTEXT_MISSING`);
  let opened: Uint8Array;
  try {
    opened = await openPersistedRequest(row.source_text_ciphertext, { groundingId, requestId: row.request_id });
  } catch (error) {
    fail(`W43_${kind}_REQUEST_DECRYPTION_FAILED`, error instanceof Error ? error.name : "UNKNOWN");
  }
  const request = parseJsonBytes(opened, `W43_${kind}_REQUEST_BYTES_INVALID`);
  const source = object(request["source"], `W43_${kind}_REQUEST_SOURCE_INVALID`);
  if (request["requestId"] !== recorded.requestId || request["operation"] !== "EXECUTE_WORLD_QUERY" ||
      sha256(canonicalJson(request)) !== recorded.requestHash ||
      sha256(text(source["originalText"], `W43_${kind}_REQUEST_TEXT_MISSING`)) !== recorded.sourceTextHash ||
      source["originalTextSha256"] !== recorded.sourceTextHash ||
      source["conversationRef"] !== barrierConversationRef(recorded.requestId, recorded.barrierTransitionHash) ||
      source["messageId"] !== armMessageId(recorded.requestId, recorded.replayBarrierArmHash)) {
    fail(`W43_${kind}_REQUEST_PLAINTEXT_BINDING_INVALID`);
  }
  return {
    row,
    result,
    request,
    requestEvidenceHash: sha256(canonicalJson({
      requestId: row.request_id,
      requestHash: row.payload_hash,
      sourceTextHash: row.source_text_sha256,
      plaintextHash: sha256(canonicalJson(request)),
    })),
  };
}

async function executions(
  client: W43ReadOnlySqlClient,
  groundingId: string,
  authority: GdpsV021W43AuthorityTuple,
): Promise<ExecutionRow[]> {
  const found = await client.query<ExecutionRow>(
    `SELECT execution_kind, operation_id, operation_version, gateway_query_id,
            normalized_status, data_snapshot
       FROM wsgs.gowm_execution
      WHERE grounding_id = $1 AND data_scope = $2 AND actor_id = $3
      ORDER BY created_at, execution_id`,
    [groundingId, authority.dataScope, authority.actorId],
  );
  return [...found.rows];
}

function semanticState(decision: JsonObject, sourceChanges: number): {
  groundingStatus: string;
  terminalStatus: string;
  normalizedStatus: string;
  semanticCode: string;
} {
  const currentness = text(decision["currentness"], "W43_DECISION_CURRENTNESS_MISSING");
  const replayMode = text(decision["replayMode"], "W43_DECISION_MODE_MISSING");
  if (sourceChanges >= 2) {
    return {
      groundingStatus: "UNRESOLVED",
      terminalStatus: "INDETERMINATE",
      normalizedStatus: "INDETERMINATE",
      semanticCode: "SOURCE_CHANGED",
    };
  }
  if (currentness === "CURRENT") {
    return {
      groundingStatus: "COMPLETED", terminalStatus: "COMPLETED", normalizedStatus: "CURRENT", semanticCode: "OK",
    };
  }
  if (currentness === "NOT_AVAILABLE") {
    return {
      groundingStatus: "UNRESOLVED", terminalStatus: "UNRESOLVED", normalizedStatus: "DATA_GAP",
      semanticCode: "DATA_GAP",
    };
  }
  if (currentness === "CHANGED" && replayMode === "STRICT") {
    return {
      groundingStatus: "UNRESOLVED", terminalStatus: "UNRESOLVED", normalizedStatus: "STALE",
      semanticCode: "SNAPSHOT_MISMATCHED",
    };
  }
  if (currentness === "CHANGED" && replayMode === "BEST_EFFORT") {
    return {
      groundingStatus: "COMPLETED", terminalStatus: "COMPLETED", normalizedStatus: "CURRENT",
      semanticCode: "SOURCE_ADVANCED",
    };
  }
  fail("W43_DECISION_STATE_UNSUPPORTED");
}

function assertRuntimeDecisionSemantics(
  pointer: GdpsV021W43ScenarioPointer,
  decision: JsonObject,
  replayResult: JsonObject,
  checkRows: readonly ExecutionRow[],
  sourceChanges: number,
): void {
  const expected = ({
    CURRENT_STRICT: {
      status: "REPLAY_ALLOWED", blocked: false, policy: "IDENTITY_CONFIRMED_NO_HISTORICAL_PAYLOAD",
      checkStatus: "COMPLETED", gapCode: null, gapReason: null,
    },
    CHANGED_STRICT: {
      status: "SNAPSHOT_MISMATCHED", blocked: true, policy: "NO_SOURCE_QUERY_ALLOWED",
      checkStatus: "STALE", gapCode: "SNAPSHOT_MISMATCHED", gapReason: "UNSUPPORTED_EXPRESSION",
    },
    NOT_AVAILABLE_STRICT: {
      status: "UNRESOLVED", blocked: true, policy: "NO_SOURCE_QUERY_ALLOWED",
      checkStatus: "NO_DATA", gapCode: "DATA_GAP", gapReason: "PROVIDER_UNAVAILABLE",
    },
    CHANGED_BEST_EFFORT: {
      status: "REPLAY_ALLOWED", blocked: false, policy: "NEW_CURRENT_SOURCE_QUERY_REQUIRED",
      checkStatus: "COMPLETED", gapCode: null, gapReason: null,
    },
    SOURCE_CHANGED_ONCE: {
      status: "REPLAY_ALLOWED", blocked: false, policy: "NEW_CURRENT_SOURCE_QUERY_REQUIRED",
      checkStatus: "COMPLETED", gapCode: null, gapReason: null,
    },
    SOURCE_CHANGED_TWICE: {
      status: "REPLAY_ALLOWED", blocked: false, policy: "NEW_CURRENT_SOURCE_QUERY_REQUIRED",
      checkStatus: "COMPLETED", gapCode: "SOURCE_CHANGED", gapReason: "UNSUPPORTED_EXPRESSION",
    },
  } as const)[pointer.scenarioId];
  if (decision["status"] !== expected.status || decision["executionBlocked"] !== expected.blocked ||
      decision["currentIdentityPolicy"] !== expected.policy || checkRows.length !== 1 ||
      checkRows[0]!.normalized_status !== expected.checkStatus) {
    fail("W43_RUNTIME_DECISION_SEMANTICS_INVALID", pointer.scenarioId);
  }
  const gaps = replayResult["capabilityGaps"];
  if (!Array.isArray(gaps)) fail("W43_RUNTIME_CAPABILITY_GAPS_MISSING", pointer.scenarioId);
  const currentnessGaps = gaps.filter((entry) => isObject(entry) && isObject(entry["details"]) &&
    ["SNAPSHOT_MISMATCHED", "DATA_GAP", "SOURCE_CHANGED"].includes(String(entry["details"]["code"])))
    .map((entry) => entry as JsonObject);
  if (expected.gapCode === null) {
    if (currentnessGaps.length !== 0) fail("W43_RUNTIME_CAPABILITY_GAP_UNEXPECTED", pointer.scenarioId);
    return;
  }
  if (currentnessGaps.length !== 1) fail("W43_RUNTIME_CAPABILITY_GAP_COUNT_INVALID", pointer.scenarioId);
  const gap = currentnessGaps[0]!;
  const details = object(gap["details"], "W43_RUNTIME_CAPABILITY_GAP_DETAILS_INVALID");
  if (gap["semanticCapability"] !== "PRIOR_RESULT_REVALIDATION" || gap["reason"] !== expected.gapReason ||
      gap["blocking"] !== true || details["code"] !== expected.gapCode ||
      details["historicalPayloadRead"] !== false) {
    fail("W43_RUNTIME_CAPABILITY_GAP_SEMANTICS_INVALID", pointer.scenarioId);
  }
  if (expected.gapCode === "SOURCE_CHANGED") {
    if (sourceChanges !== 2 || details["upstreamCondition"] !== "SOURCE_CHANGED_DURING_QUERY" ||
        details["normalizedStatus"] !== "INDETERMINATE" || details["currentSourceQueryAttempts"] !== 2 ||
        details["historicalQueryReplayed"] !== false) {
      fail("W43_RUNTIME_SOURCE_CHANGED_GAP_INVALID", pointer.scenarioId);
    }
  } else if (details["executionBlocked"] !== true || details["originalQueryExecuted"] !== false) {
    fail("W43_RUNTIME_BLOCKED_GAP_INVALID", pointer.scenarioId);
  }
}

async function captureScenario(client: W43ReadOnlySqlClient, pointer: GdpsV021W43ScenarioPointer,
  binding: GdpsV021W43RuntimeBinding, authority: GdpsV021W43AuthorityTuple,
  openPersistedRequest: GdpsV021W43RuntimeReceiptCaptureInput["openPersistedRequest"],
  barrierTransitions: readonly JsonObject[],
  barrierAttestationHash: `sha256:${string}`,
): Promise<{ scenario: JsonObject; postgres: JsonObject }> {
  const barrierTransitionHashes = barrierTransitions
    .map((entry) => digest(entry["transitionHash"], "W43_BARRIER_TRANSITION_HASH_INVALID"));
  const expectedReplayTransition = barrierTransitionHashes[replayBarrierIndex[pointer.scenarioId]];
  const expectedArmTransition = pointer.scenarioId === "SOURCE_CHANGED_TWICE" ? barrierTransitionHashes[2] : undefined;
  if (pointer.sourceRequest.barrierTransitionHash !== barrierTransitionHashes[0] ||
      pointer.replayRequest.barrierTransitionHash !== expectedReplayTransition ||
      pointer.sourceRequest.replayBarrierArmHash !== null ||
      pointer.replayRequest.replayBarrierArmHash !== (pointer.replayBarrierArm?.hash ?? null) ||
      (pointer.scenarioId === "SOURCE_CHANGED_TWICE"
        ? pointer.replayBarrierArm === null || expectedArmTransition === undefined
        : pointer.replayBarrierArm !== null)) {
    fail("W43_SCENARIO_REQUEST_BARRIER_BINDING_INVALID", pointer.scenarioId);
  }
  if (pointer.causalBindingHash !== expectedCausalBindingHash(binding, authority, pointer, barrierAttestationHash) ||
      JSON.stringify(pointer.barrierTransitionHashes) !== JSON.stringify(barrierTransitionHashes)) {
    fail("W43_SCENARIO_CAUSAL_BINDING_INVALID", pointer.scenarioId);
  }
  const source = await groundingRow(client, pointer.sourceGroundingId, pointer.sourceRequest,
    authority, openPersistedRequest, "SOURCE");
  const replay = await groundingRow(client, pointer.replayGroundingId, pointer.replayRequest,
    authority, openPersistedRequest, "REPLAY");
  const sourceExecutions = await executions(client, pointer.sourceGroundingId, authority);
  const replayExecutions = await executions(client, pointer.replayGroundingId, authority);
  const decisions = replayExecutions.flatMap((row) => collectNamedObjects(row.data_snapshot, "gdpsCurrentnessDecision"));
  const uniqueDecisions = new Map(decisions.map((entry) => [canonicalJson(entry), entry]));
  if (uniqueDecisions.size !== 1) fail("W43_PERSISTED_CURRENTNESS_DECISION_INVALID", pointer.scenarioId);
  const decision = [...uniqueDecisions.values()][0]!;
  const sourceIdentity = object(decision["source"], "W43_DECISION_SOURCE_INVALID");
  const selectedEvidenceProductId = text(decision["selectedEvidenceProductId"],
    "W43_DECISION_SELECTED_PRODUCT_MISSING");
  const sourceOperation = text(decision["sourceOperation"], "W43_DECISION_SOURCE_OPERATION_MISSING");
  const sourceOperationVersion = text(decision["sourceOperationVersion"],
    "W43_DECISION_SOURCE_OPERATION_VERSION_MISSING");
  const sourceCapsule = object(source.request["contextCapsule"], "W43_SOURCE_CONTEXT_CAPSULE_INVALID");
  const replayCapsule = object(replay.request["contextCapsule"], "W43_REPLAY_CONTEXT_CAPSULE_INVALID");
  const sourcePriors = sourceCapsule["priorGroundings"];
  const replayPriors = replayCapsule["priorGroundings"];
  if (!Array.isArray(sourcePriors) || sourcePriors.length !== 0 ||
      !Array.isArray(replayPriors) || replayPriors.length !== 1) {
    fail("W43_PERSISTED_PRIOR_GROUNDING_COUNT_INVALID", pointer.scenarioId);
  }
  const replayPrior = object(replayPriors[0], "W43_PERSISTED_PRIOR_GROUNDING_INVALID");
  const expectedPrior = {
    groundingId: pointer.sourceGroundingId,
    resultHash: source.row.result_hash,
    selectedProductIds: [selectedEvidenceProductId],
  };
  const priorGroundingLoaded = canonicalJson(replayPrior) === canonicalJson(expectedPrior);
  const productVersionPresent = containsForbiddenProductVersion(source.result) ||
    containsForbiddenProductVersion(replay.result) || containsForbiddenProductVersion(decision) ||
    containsForbiddenProductVersion(replayPrior) || containsForbiddenProductVersion(source.request) ||
    containsForbiddenProductVersion(replay.request);
  const historicalPayloadRead = Object.keys(replayPrior)
    .some((key) => !["groundingId", "resultHash", "selectedProductIds"].includes(key));
  if (decision["sourceGroundingId"] !== pointer.sourceGroundingId ||
      decision["sourceResultHash"] !== source.row.result_hash ||
      decision["productId"] !== undefined ||
      !priorGroundingLoaded || historicalPayloadRead || productVersionPresent ||
      text(sourceIdentity["productId"], "W43_DECISION_PRODUCT_ID_MISSING").length > 128) {
    fail("W43_DECISION_PRIOR_GROUNDING_BINDING_INVALID", pointer.scenarioId);
  }
  const priorContentHash = digest(sourceIdentity["contentHash"], "W43_DECISION_PRIOR_HASH_INVALID");
  const currentness = text(decision["currentness"], "W43_DECISION_CURRENTNESS_MISSING");
  const currentContentHash = decision["currentContentHash"] === undefined
    ? null : digest(decision["currentContentHash"], "W43_DECISION_CURRENT_HASH_INVALID");
  if ((currentness === "NOT_AVAILABLE") !== (currentContentHash === null)) {
    fail("W43_DECISION_CURRENT_HASH_SEMANTICS_INVALID", pointer.scenarioId);
  }
  const prepare = barrierTransitions[0];
  if (!prepare || prepare["barrier"] !== "PREPARE_A" || prepare["afterContentHash"] !== priorContentHash) {
    fail("W43_BARRIER_PRIOR_CONTENT_BINDING_INVALID", pointer.scenarioId);
  }
  const advances = barrierTransitions.filter((entry) =>
    entry["barrier"] === "AFTER_PRIOR_GROUNDING:A_TO_B" || entry["barrier"] === "BEFORE_REPLAY_QUERY:A_TO_B");
  if (currentness === "CHANGED" && (advances.length !== 1 || advances[0]!["afterContentHash"] !== currentContentHash)) {
    fail("W43_BARRIER_CURRENT_CONTENT_BINDING_INVALID", pointer.scenarioId);
  }
  if (currentness === "CURRENT" && currentContentHash !== priorContentHash) {
    fail("W43_BARRIER_CURRENT_CONTENT_BINDING_INVALID", pointer.scenarioId);
  }
  if (currentness === "NOT_AVAILABLE" && !barrierTransitions.some((entry) =>
    entry["barrier"] === "AFTER_PRIOR_GROUNDING:DISABLE_CURRENT_PRODUCT" &&
    entry["afterState"] === "NOT_AVAILABLE" && entry["afterContentHash"] === priorContentHash)) {
    fail("W43_BARRIER_NOT_AVAILABLE_BINDING_INVALID", pointer.scenarioId);
  }
  const matchingEvidence = (Array.isArray(source.result["evidenceItems"]) ? source.result["evidenceItems"] : [])
    .filter((entry) => isObject(entry) && entry["evidenceProductId"] === selectedEvidenceProductId)
    .map((entry) => entry as JsonObject);
  if (matchingEvidence.length !== 1) fail("W43_SOURCE_SELECTED_EVIDENCE_INVALID", pointer.scenarioId);
  const safePayload = object(matchingEvidence[0]!["safePayload"], "W43_SOURCE_SAFE_PAYLOAD_INVALID");
  if (safePayload["productId"] !== sourceIdentity["productId"] || safePayload["contentHash"] !== priorContentHash) {
    fail("W43_SOURCE_PRODUCT_IDENTITY_MISMATCH", pointer.scenarioId);
  }
  const selectedProduct = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM wsgs.result_product
      WHERE grounding_id = $1 AND data_scope = $3 AND product_id = $1 || ':' || $2`,
    [pointer.sourceGroundingId, selectedEvidenceProductId, authority.dataScope],
  );
  const selectedProductRows = integer(selectedProduct.rows[0]?.count, "W43_SELECTED_PRODUCT_COUNT_INVALID");
  if (selectedProductRows !== 1) fail("W43_SELECTED_PRODUCT_NOT_PERSISTED", pointer.scenarioId);
  const sourceGatewayQueryIds = new Set(sourceExecutions
    .filter((row) => row.operation_id === sourceOperation && row.operation_version === sourceOperationVersion)
    .map((row) => row.gateway_query_id).filter((entry): entry is string => typeof entry === "string"));
  if (sourceGatewayQueryIds.size !== 1) fail("W43_SOURCE_EXECUTION_IDENTITY_INVALID", pointer.scenarioId);
  const sourceGatewayQueryId = [...sourceGatewayQueryIds][0]!;
  const sourceQuery = await client.query<{ query_id: string; gateway_query_id: string | null; plan_hash: string }>(
    `SELECT query_id, gateway_query_id, plan_hash
       FROM wsgs.world_query
      WHERE grounding_id = $1 AND data_scope = $2 AND query_id = $3 AND gateway_query_id = $3`,
    [pointer.sourceGroundingId, authority.dataScope, sourceGatewayQueryId],
  );
  if (sourceQuery.rows.length !== 1 || !digestPattern.test(sourceQuery.rows[0]!.plan_hash)) {
    fail("W43_SOURCE_QUERY_PERSISTENCE_BINDING_INVALID", pointer.scenarioId);
  }
  const replaySourceExecutions = replayExecutions.filter((row) =>
    row.operation_id === sourceOperation && row.operation_version === sourceOperationVersion);
  const originalSourceExecutionCount = replaySourceExecutions.filter((row) =>
    row.gateway_query_id !== null && sourceGatewayQueryIds.has(row.gateway_query_id)).length;
  const newCurrentSourceExecutionCount = replaySourceExecutions.length - originalSourceExecutionCount;
  const changedExecutions = replayExecutions.filter((row) =>
    collectNamedObjects(row.data_snapshot, "gdpsBestEffortCurrentSource")
      .some((entry) => entry["upstreamCondition"] === "SOURCE_CHANGED_DURING_QUERY"));
  const sourceChangedDuringQueryCount = changedExecutions.length;
  const checkRows = replayExecutions.filter((row) =>
    row.operation_id === "geo-product.check-current" && row.operation_version === "1.0");
  assertRuntimeDecisionSemantics(pointer, decision, replay.result, checkRows, sourceChangedDuringQueryCount);
  const operationKeys = [...new Set(replayExecutions.flatMap((row) =>
    row.operation_id && row.operation_version ? [`${row.operation_id}@${row.operation_version}`] : []))].sort();
  const semantics = semanticState(decision, sourceChangedDuringQueryCount);
  if (replay.row.result_status !== semantics.groundingStatus || checkRows.length !== 1 ||
      originalSourceExecutionCount !== 0 || productVersionPresent || !priorGroundingLoaded || historicalPayloadRead) {
    fail("W43_PERSISTED_SCENARIO_TRUTH_INVALID", pointer.scenarioId);
  }
  const terminalEvents = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM wsgs.pipeline_event
      WHERE grounding_id = $1 AND status <> 'STARTED'
        AND EXISTS (SELECT 1 FROM wsgs.grounding_request AS request
                     WHERE request.grounding_id = pipeline_event.grounding_id
                       AND request.data_scope = $2 AND request.actor_id = $3)`,
    [pointer.replayGroundingId, authority.dataScope, authority.actorId],
  );
  const stageRows = integer(terminalEvents.rows[0]?.count, "W43_STAGE_COUNT_INVALID");
  if (stageRows < 1) fail("W43_STAGE_EVIDENCE_MISSING", pointer.scenarioId);
  const scenario: JsonObject = {
    scenarioId: pointer.scenarioId,
    replayMode: text(decision["replayMode"], "W43_DECISION_MODE_MISSING"),
    groundingStatus: semantics.groundingStatus,
    terminalStatus: semantics.terminalStatus,
    normalizedStatus: semantics.normalizedStatus,
    currentness,
    semanticCode: semantics.semanticCode,
    warnings: relevantWarnings(replay.result),
    priorContentHash,
    currentContentHash,
    sourceOperationKey: `${sourceOperation}@${sourceOperationVersion}`,
    executedOperationKeys: operationKeys,
    checkCurrentExecutionCount: checkRows.length,
    originalSourceExecutionCount,
    newCurrentSourceExecutionCount,
    sourceChangedDuringQueryCount,
    retryCount: Math.max(0, newCurrentSourceExecutionCount - 1),
    historicalPayloadRead,
    productVersionPresent,
    priorGroundingLoaded,
    currentnessEvidencePersisted: uniqueDecisions.size === 1,
    authorityTupleHash: authorityTupleHash(authority),
    currentnessDecisionHash: sha256(canonicalJson(decision)),
    sourceRequestEvidenceHash: source.requestEvidenceHash,
    replayRequestEvidenceHash: replay.requestEvidenceHash,
    sourcePlanHash: digest(sourceQuery.rows[0]!.plan_hash, "W43_SOURCE_PLAN_HASH_INVALID"),
    sourceBarrierTransitionHash: pointer.sourceRequest.barrierTransitionHash,
    replayBarrierTransitionHash: pointer.replayRequest.barrierTransitionHash,
    replayBarrierArm: pointer.replayBarrierArm,
    barrierTransitionHashes,
    causalBindingHash: pointer.causalBindingHash,
    sourceGroundingIdHash: sha256(pointer.sourceGroundingId),
    replayGroundingIdHash: sha256(pointer.replayGroundingId),
    persistedResultHash: digest(replay.row.result_hash, "W43_REPLAY_RESULT_HASH_INVALID"),
  };
  const postgres: JsonObject = {
    scenarioId: pointer.scenarioId,
    groundingStatus: scenario["groundingStatus"],
    sourceGroundingIdHash: scenario["sourceGroundingIdHash"],
    replayGroundingIdHash: scenario["replayGroundingIdHash"],
    persistedResultHash: scenario["persistedResultHash"],
    currentnessDecisionHash: scenario["currentnessDecisionHash"],
    transactionMode: "READ_ONLY",
    sourceGroundingRows: 1,
    replayGroundingRows: 1,
    resultRows: 1,
    stageRows,
    executionRows: replayExecutions.length,
    currentnessEvidenceRows: uniqueDecisions.size,
    selectedProductRows,
    priorGroundingLinkRows: decision["sourceGroundingId"] === pointer.sourceGroundingId ? 1 : 0,
    checkCurrentExecutionRows: checkRows.length,
    originalSourceExecutionRows: originalSourceExecutionCount,
    newCurrentSourceExecutionRows: newCurrentSourceExecutionCount,
    sourceChangedDuringQueryRows: sourceChangedDuringQueryCount,
    sourceRequestEvidenceHash: source.requestEvidenceHash,
    replayRequestEvidenceHash: replay.requestEvidenceHash,
    sourcePlanHash: scenario["sourcePlanHash"],
    sourceBarrierTransitionHash: pointer.sourceRequest.barrierTransitionHash,
    replayBarrierTransitionHash: pointer.replayRequest.barrierTransitionHash,
    replayBarrierArm: pointer.replayBarrierArm,
    barrierTransitionHashes,
    causalBindingHash: pointer.causalBindingHash,
  };
  return { scenario, postgres };
}

async function captureNegativeAssertions(
  client: W43ReadOnlySqlClient,
  pointer: GdpsV021W43ScenarioPointer,
  authority: GdpsV021W43AuthorityTuple,
): Promise<JsonObject> {
  const probes = [
    {
      id: "FOREIGN_SCOPE",
      sql: `SELECT count(*)::text AS count FROM wsgs.grounding_result AS result
             JOIN wsgs.grounding_request AS request USING (grounding_id)
            WHERE result.grounding_id = $1 AND result.data_scope = $2 AND result.actor_id = $3
              AND request.principal_id = $4 AND request.authorization_context_hash = $5`,
      parameters: [pointer.sourceGroundingId, `${authority.dataScope}:foreign`, authority.actorId,
        authority.principalId, authority.authorizationContextHash],
    },
    {
      id: "FOREIGN_PRINCIPAL",
      sql: `SELECT count(*)::text AS count FROM wsgs.grounding_result AS result
             JOIN wsgs.grounding_request AS request USING (grounding_id)
            WHERE result.grounding_id = $1 AND result.data_scope = $2 AND result.actor_id = $3
              AND request.principal_id = $4 AND request.authorization_context_hash = $5`,
      parameters: [pointer.sourceGroundingId, authority.dataScope, authority.actorId,
        `${authority.principalId}:foreign`, authority.authorizationContextHash],
    },
    {
      id: "PRIOR_RESULT_HASH_MISMATCH",
      sql: `SELECT count(*)::text AS count FROM wsgs.grounding_result AS result
             JOIN wsgs.grounding_request AS request USING (grounding_id)
            WHERE result.grounding_id = $1 AND result.data_scope = $2 AND result.actor_id = $3
              AND result.result_hash = $4 AND request.principal_id = $5
              AND request.authorization_context_hash = $6`,
      parameters: [pointer.sourceGroundingId, authority.dataScope, authority.actorId,
        sha256(`${pointer.sourceRequest.requestHash}:mismatch`), authority.principalId,
        authority.authorizationContextHash],
    },
  ] as const;
  const assertions: JsonObject = {};
  for (const probe of probes) {
    const result = await client.query<{ count: string }>(probe.sql, probe.parameters);
    const count = integer(result.rows[0]?.count, `W43_NEGATIVE_${probe.id}_COUNT_INVALID`);
    if (count !== 0) fail(`W43_NEGATIVE_${probe.id}_DISCLOSURE`);
    const key = ({ FOREIGN_SCOPE: "foreignScope", FOREIGN_PRINCIPAL: "foreignPrincipal",
      PRIOR_RESULT_HASH_MISMATCH: "priorResultHashMismatch" } as const)[probe.id];
    assertions[key] = { status: "DENIED", matchingRows: 0 };
  }
  return assertions;
}

export async function captureGdpsV021W43RuntimeReceipts(
  input: GdpsV021W43RuntimeReceiptCaptureInput,
): Promise<GdpsV021W43RuntimeReceiptCaptureResult> {
  assertBinding(input.binding);
  assertAuthority(input.authority, input.binding);
  const barrier = validateGdpsV021W43BarrierAttestation(
    input.barrierAttestationBytes,
    input.barrierAttestationHash,
    input.binding,
  );
  const barrierReference = input.barrierAttestationReference;
  if (!barrierReference.path.startsWith("reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/") ||
      barrierReference.path.includes("..") || /^[A-Za-z]:|^\//u.test(barrierReference.path) ||
      barrierReference.hash !== barrier.hash || barrierReference.byteLength !== input.barrierAttestationBytes.byteLength) {
    fail("W43_BARRIER_ATTESTATION_REFERENCE_INVALID");
  }
  const replayBarrierArmReference = input.replayBarrierArmArtifact === undefined
    ? undefined
    : validateReplayBarrierArmArtifact(input.replayBarrierArmArtifact, input.binding);
  if (!instantPattern.test(input.generatedAt) || Number.isNaN(Date.parse(input.generatedAt))) {
    fail("W43_RECEIPT_GENERATED_AT_INVALID");
  }
  if (input.scenarios.length !== scenarioIds.length ||
      new Set(input.scenarios.map((entry) => entry.scenarioId)).size !== scenarioIds.length ||
      input.scenarios.some((entry) => !scenarioIds.includes(entry.scenarioId) ||
        !entry.sourceGroundingId || !entry.replayGroundingId || entry.sourceGroundingId === entry.replayGroundingId ||
        !entry.sourceRequest.requestId || !entry.replayRequest.requestId ||
        !digestPattern.test(entry.sourceRequest.requestHash) || !digestPattern.test(entry.replayRequest.requestHash) ||
        !digestPattern.test(entry.sourceRequest.sourceTextHash) || !digestPattern.test(entry.replayRequest.sourceTextHash) ||
        !digestPattern.test(entry.sourceRequest.barrierTransitionHash) ||
        !digestPattern.test(entry.replayRequest.barrierTransitionHash) ||
        entry.sourceRequest.replayBarrierArmHash !== null ||
        (entry.replayRequest.replayBarrierArmHash !== null &&
          !digestPattern.test(entry.replayRequest.replayBarrierArmHash)) ||
        !digestPattern.test(entry.causalBindingHash))) {
    fail("W43_SCENARIO_POINTER_INVENTORY_INVALID");
  }
  const armed = input.scenarios.filter((entry) => entry.replayBarrierArm !== null);
  if (armed.length !== 1 || armed[0]!.scenarioId !== "SOURCE_CHANGED_TWICE" ||
      replayBarrierArmReference === undefined ||
      canonicalJson(armed[0]!.replayBarrierArm) !== canonicalJson(replayBarrierArmReference) ||
      input.scenarios.some((entry) => entry.scenarioId !== "SOURCE_CHANGED_TWICE" &&
        entry.replayRequest.replayBarrierArmHash !== null)) {
    fail("W43_REPLAY_BARRIER_ARM_INVENTORY_INVALID");
  }
  const client = await input.pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const probe = await databaseProbe(client);
    if (probe.databaseIdentityHash !== input.binding.databaseIdentityHash) {
      fail("W43_DATABASE_RUNTIME_IDENTITY_MISMATCH");
    }
    const migrationRows = await client.query<{ version: string; checksum_sha256: string | null }>(
      "SELECT version, checksum_sha256 FROM wsgs.schema_migration ORDER BY version",
    );
    if (migrationRows.rows.length !== expectedMigrationVersions.length ||
        migrationRows.rows.some((row, index) => row.version !== expectedMigrationVersions[index] ||
          !digestPattern.test(row.checksum_sha256 ?? ""))) {
      fail("W43_DATABASE_MIGRATION_RECEIPT_INVALID");
    }
    const migrationReceiptHash = sha256(canonicalJson(migrationRows.rows));
    const captured = [] as Array<{ scenario: JsonObject; postgres: JsonObject }>;
    for (const scenarioId of scenarioIds) {
      const pointer = input.scenarios.find((entry) => entry.scenarioId === scenarioId)!;
      captured.push(await captureScenario(client, pointer, input.binding, input.authority,
        input.openPersistedRequest, barrier.transitionsByScenario.get(scenarioId) ?? [], barrier.hash));
    }
    const negativeAssertions = await captureNegativeAssertions(client, input.scenarios[0]!, input.authority);
    const queryTranscriptHash = sha256(canonicalJson(captured.map((entry) => entry.postgres)));
    await client.query("ROLLBACK");
    const currentnessDocument: JsonObject = {
      schemaVersion: "wsgs-gdps-v021-currentness-runner-receipt/1.0",
      generatedAt: input.generatedAt,
      binding: input.binding,
      authorityTupleHash: authorityTupleHash(input.authority),
      barrierAttestation: barrierReference,
      scenarios: captured.map((entry) => entry.scenario),
    };
    const postgresDocument: JsonObject = {
      schemaVersion: "wsgs-gdps-v021-real-postgres-currentness-receipt/1.0",
      generatedAt: input.generatedAt,
      binding: input.binding,
      authorityTupleHash: authorityTupleHash(input.authority),
      barrierAttestation: barrierReference,
      database: {
        engine: "PostgreSQL",
        serverVersion: probe.serverVersion,
        executionClass: "REAL_ISOLATED_POSTGRESQL",
        mockUsed: false,
        connectionIdentityHash: probe.databaseIdentityHash,
        migrationReceiptHash,
        queryTranscriptHash,
      },
      negativeAssertions,
      observations: captured.map((entry) => entry.postgres),
    };
    const combined = `${canonicalJson(currentnessDocument)}\n${canonicalJson(postgresDocument)}`;
    if (input.scenarios.some((entry) => combined.includes(entry.sourceGroundingId) ||
      combined.includes(entry.replayGroundingId))) fail("W43_RAW_GROUNDING_ID_LEAK");
    return {
      currentnessDocument,
      postgresDocument,
      currentnessBytes: jsonBytes(currentnessDocument),
      postgresBytes: jsonBytes(postgresDocument),
      migrationReceiptHash,
      queryTranscriptHash,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* best-effort rollback */ }
    throw error;
  } finally {
    client.release();
  }
}

export function writeGdpsV021W43RuntimeReceipts(options: {
  readonly repositoryRoot: string;
  readonly currentnessPath: string;
  readonly postgresPath: string;
  readonly receipt: GdpsV021W43RuntimeReceiptCaptureResult;
}): void {
  const prefix = "reports/wsgs-v0.2-gdps-v0.2.1/w43-receipts/";
  const paths = [options.currentnessPath, options.postgresPath].map((path) => path.replaceAll("\\", "/"));
  if (paths[0] === paths[1] || paths.some((path) => !path.startsWith(prefix) ||
    path.includes("..") || /^[A-Za-z]:|^\//u.test(path))) fail("W43_RECEIPT_OUTPUT_PATH_INVALID");
  for (const [path, bytes] of [
    [paths[0]!, options.receipt.currentnessBytes],
    [paths[1]!, options.receipt.postgresBytes],
  ] as const) {
    const absolute = resolve(options.repositoryRoot, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, bytes, { flag: "wx" });
  }
}
