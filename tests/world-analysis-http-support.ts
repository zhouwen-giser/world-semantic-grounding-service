import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  Aes256GcmPayloadCodec, canonicalSha256, PostgresGroundingContractMismatchError, PostgresIdempotencyConflictError,
  type DurableGroundingSubmission, type GroundingContractSelection, type GroundingReplayLookup,
  type PipelineCheckpoint, type PipelineEventRecord, type PipelineJournal, type ProductionGroundingStore, type ScopedGroundingIdentity
} from "@wsgs/grounding-pipeline";
import { buildTrustedCapabilitySnapshot, hashCanonicalJson } from "@wsgs/trusted-capability-snapshot";
import type { CapabilityCatalog, CapabilitySemanticCatalog, OperationAvailabilityList } from "@wsgs/gowm-gateway-client";
import type { OperationalGowmLock } from "@wsgs/gowm-contract-intake";
import { AnalysisProviderContracts, analysisHash, defaultGowmConsumerSchemaRegistry } from "@wsgs/gowm-contract-intake";
import { selectProductionSouthboundLock } from "../services/grounding-worker/src/production-module.js";
import { assertNegotiatedGroundingResult } from "../services/grounding-worker/src/result-schema.js";
import type { GroundingWorkerStore, WorkerExecutionFence, WorkerSettlement } from "../services/grounding-worker/src/types.js";

export function admissionFixture() {
  const fullLock: OperationalGowmLock = JSON.parse(readFileSync(new URL("../contracts/upstream/gowm-0.6.3/extracted/package/bundle/locks/wsgs-southbound-operation-lock-v2.json", import.meta.url), "utf8"));
  const fixture = JSON.parse(readFileSync(new URL("../validation/fixtures/world-analysis-http/gateway-catalog.json", import.meta.url), "utf8"));
  const source = JSON.parse(readFileSync(new URL("../validation/fixtures/world-analysis-http/SOURCE.json", import.meta.url), "utf8"));
  if (hashCanonicalJson(fixture.profiles) !== source.semanticCatalogHash || source.semanticCatalogHash !== fullLock.semanticCatalogHash) throw new Error("HTTP_FIXTURE_SEMANTIC_DRIFT");
  const southboundLock = selectProductionSouthboundLock(fullLock, []);
  const bindingRevision = canonicalSha256("controlled-http-binding");
  const capabilityCatalog: CapabilityCatalog = { registryVersion: "registry-1", contractCatalogRevision: fullLock.contractCatalogRevision,
    bindingRevision, capabilities: fixture.capabilities };
  const semanticCatalog: CapabilitySemanticCatalog = { schemaVersion: "1.1", contractCatalogRevision: fullLock.contractCatalogRevision,
    bindingRevision, catalogHash: source.semanticCatalogHash, profiles: fixture.profiles };
  const checkedAt = new Date().toISOString();
  const availability: OperationAvailabilityList = { schemaVersion: "1.0", checkedAt,
    operations: [...fullLock.defaultOperations, ...fullLock.previewOperations].map(operation => ({
      operationId: operation.operationId, operationVersion: operation.operationVersion, maturity: operation.maturity,
      availability: "AVAILABLE", reasonCodes: ["AVAILABLE"], checkedAt, validUntil: new Date(Date.now() + 60_000).toISOString(),
      contractCatalogRevision: fullLock.contractCatalogRevision, bindingRevision
    })) };
  const trustedCapabilitySnapshot = buildTrustedCapabilitySnapshot({ catalog: capabilityCatalog as never, semantics: semanticCatalog,
    availability, southboundLock, southboundLockHash: canonicalSha256(southboundLock), capturedAt: new Date() });
  const schemas = defaultGowmConsumerSchemaRegistry();
  schemas.validate("platform/capability-list-response.schema.json", capabilityCatalog);
  schemas.validate("gowm-v0.6.2/capability-semantic-catalog-v1.schema.json", semanticCatalog);
  schemas.validate("gowm-v0.6.3/operation-availability-list.schema.json", availability);
  return { immutableLocks: { schemaVersion: "1.0", trustedCapabilitySnapshot, capabilityCatalog, semanticCatalog, availability, southboundLock },
    gowmContractCatalogRevision: fullLock.contractCatalogRevision, gowmSemanticCatalogHash: fullLock.semanticCatalogHash,
    gowmConsumerPackageIntegrity: fullLock.consumerContractPackage.integrity, gowmOperationLockHash: canonicalSha256(southboundLock) };
}

export function analysisAdmissionFixture() {
  const read = (path: string) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
  const base = read("validation/fixtures/world-analysis-http/gateway-catalog.json");
  const bytes = readFileSync(new URL("../validation/fixtures/world-analysis-http/history-metadata.json", import.meta.url));
  if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== read("validation/fixtures/world-analysis-http/HISTORY_SOURCE.json").fixtureSha256) throw new Error("HISTORY_FIXTURE_DRIFT");
  const history = JSON.parse(bytes.toString("utf8"));
  const contracts = new AnalysisProviderContracts();
  const replacements = [...history.capabilities, ...["map-matching", "temporal-events", "metric-ranking"].flatMap(name =>
    read(`contracts/upstream/gowm-analysis-providers-current/contracts/manifests/${name}-provider.json`).capabilities)];
  const capabilities = [...base.capabilities.filter((entry: any) => !replacements.some(value => value.operationId === entry.operationId)), ...replacements]
    .sort((a, b) => `${a.operationId}@${a.operationVersion}` < `${b.operationId}@${b.operationVersion}` ? -1 : 1);
  const profiles = capabilities.map(entry => ({ operationId: entry.operationId, operationVersion: entry.operationVersion,
    semanticProfile: entry.semanticProfile, semanticProfileHash: analysisHash(entry.semanticProfile) }));
  const lock = read("contracts/upstream/gowm-0.6.3/extracted/package/bundle/locks/wsgs-southbound-operation-lock-v2.json");
  lock.previewOperations = [...lock.previewOperations.filter((entry: any) => !replacements.some(value => value.operationId === entry.operationId)),
    ...history.operations, ...contracts.authorizations.map(auth => ({ operationId: auth.operationId, operationVersion: auth.operationVersion,
      inputSchemaHash: auth.inputSchemaHash, outputSchemaHash: auth.outputSchemaHash, semanticProfileHash: auth.semanticProfileHash,
      maturity: "PREVIEW", requiredPermissions: ["data:read"], snapshotSupport: "CONSISTENT_AT_START" }))];
  lock.contractCatalogRevision = analysisHash(capabilities); lock.semanticCatalogHash = analysisHash(profiles);
  const bindingRevision = analysisHash("controlled-discovery-binding");
  const catalog = { registryVersion: "registry-1", contractCatalogRevision: lock.contractCatalogRevision, bindingRevision, capabilities };
  const semantics = { schemaVersion: "1.1", contractCatalogRevision: lock.contractCatalogRevision, bindingRevision, profiles, catalogHash: lock.semanticCatalogHash };
  const southboundLock = selectProductionSouthboundLock(lock, [], true, contracts.authorizations);
  const checkedAt = new Date().toISOString();
  const availability = { schemaVersion: "1.0", checkedAt, operations: [...southboundLock.defaultOperations, ...southboundLock.previewOperations].map(entry => ({
    operationId: entry.operationId, operationVersion: entry.operationVersion, maturity: entry.maturity, availability: "AVAILABLE", reasonCodes: ["AVAILABLE"],
    checkedAt, validUntil: new Date(Date.now() + 60_000).toISOString(), contractCatalogRevision: lock.contractCatalogRevision, bindingRevision })) };
  const trustedCapabilitySnapshot = buildTrustedCapabilitySnapshot({ catalog: catalog as never, semantics: semantics as never,
    availability: availability as never, southboundLock, southboundLockHash: canonicalSha256(southboundLock), capturedAt: new Date() });
  return { metadata: { lock, catalog, semantics, availability }, admission: {
    immutableLocks: { schemaVersion: "1.0", trustedCapabilitySnapshot, capabilityCatalog: catalog, semanticCatalog: semantics, availability, southboundLock },
    gowmContractCatalogRevision: lock.contractCatalogRevision, gowmSemanticCatalogHash: lock.semanticCatalogHash,
    gowmConsumerPackageIntegrity: lock.consumerContractPackage.integrity, gowmOperationLockHash: canonicalSha256(southboundLock) } };
}

interface MemoryJob {
  submission: DurableGroundingSubmission;
  status: string;
  createdAt: string;
  resultBytes?: Uint8Array;
  error?: { code: string; message: string; retryable: false; stage: "PERSISTENCE" };
  fence?: WorkerExecutionFence;
}

/** Test-only persistence. Exercises actual codecs/validation, not PostgreSQL durability. */
export class HttpMemoryStore implements ProductionGroundingStore, GroundingWorkerStore, PipelineJournal {
  readonly codec = new Aes256GcmPayloadCodec(randomBytes(32));
  readonly jobs = new Map<string, MemoryJob>();
  readonly records: PipelineEventRecord[] = [];
  readonly checkpoints = new Map<string, { metadata: Omit<PipelineCheckpoint, "state">; ciphertext: Uint8Array }>();
  readonly sql: string[] = [];
  runWorker: (() => Promise<unknown>) | undefined;

  owns(fence: WorkerExecutionFence) {
    const job = [...this.jobs.values()].find(value => value.submission.jobId === fence.jobId);
    return job?.status === "RUNNING" && job.fence?.leaseToken === fence.leaseToken && job.fence.generation === fence.generation;
  }
  private scoped(identity: ScopedGroundingIdentity, id: string, selection: GroundingContractSelection) {
    const job = this.jobs.get(id);
    if (!job || canonicalSha256(job.submission.identity) !== canonicalSha256(identity)) return undefined;
    if (canonicalSha256(selection) !== canonicalSha256(job.submission.contractSelection)) throw new PostgresGroundingContractMismatchError();
    return job;
  }
  private presentation(job: MemoryJob) {
    return { schemaVersion: "1.0", jobId: job.submission.jobId, groundingId: job.submission.groundingId,
      requestId: job.submission.requestId, status: job.status, createdAt: job.createdAt, updatedAt: job.createdAt,
      ...(job.resultBytes ? { result: JSON.parse(Buffer.from(job.resultBytes).toString("utf8")) } : {}), ...(job.error ? { error: job.error } : {}) };
  }
  async replay(lookup: GroundingReplayLookup) {
    const job = [...this.jobs.values()].find(value => value.submission.idempotencyKey === lookup.idempotencyKey &&
      canonicalSha256(value.submission.identity) === canonicalSha256(lookup.identity));
    if (!job) return null;
    if (job.submission.payloadHash !== lookup.payloadHash) throw new PostgresIdempotencyConflictError();
    this.scoped(lookup.identity, job.submission.groundingId, lookup.contractSelection);
    return job.resultBytes ? { kind: "REPLAY_RESULT" as const, groundingId: job.submission.groundingId,
      result: JSON.parse(Buffer.from(job.resultBytes).toString("utf8")) } :
      { kind: "REPLAY_JOB" as const, groundingId: job.submission.groundingId, jobId: job.submission.jobId, job: this.presentation(job) };
  }
  async submit(submission: DurableGroundingSubmission) {
    const replay = await this.replay(submission);
    if (replay) return replay;
    const job = { submission, status: "ACCEPTED", createdAt: new Date().toISOString() };
    this.jobs.set(submission.groundingId, job);
    return { kind: "CREATED" as const, groundingId: submission.groundingId, jobId: submission.jobId, job: this.presentation(job) };
  }
  async waitForTerminal(identity: ScopedGroundingIdentity, id: string, _deadline: Date, selection: GroundingContractSelection) {
    await this.runWorker?.();
    const job = this.scoped(identity, id, selection)!;
    return job.resultBytes ? { kind: "RESULT" as const, value: JSON.parse(Buffer.from(job.resultBytes).toString("utf8")) } :
      { kind: "JOB" as const, value: this.presentation(job) };
  }
  async get(identity: ScopedGroundingIdentity, id: string, selection: GroundingContractSelection) {
    const job = this.scoped(identity, id, selection); return job ? this.presentation(job) : null;
  }
  async cancel(identity: ScopedGroundingIdentity, id: string, selection: GroundingContractSelection) {
    const job = this.scoped(identity, id, selection); if (!job) return null;
    if (["ACCEPTED", "RUNNING"].includes(job.status)) job.status = "CANCELLED";
    return { jobId: job.submission.jobId, value: this.presentation(job) };
  }
  async claimNext() {
    const job = [...this.jobs.values()].find(value => value.status === "ACCEPTED");
    if (!job) return null;
    const input = job.submission;
    job.status = "RUNNING"; job.fence = { jobId: input.jobId, leaseToken: randomUUID(), generation: 1 };
    const request = JSON.parse(Buffer.from(await this.codec.openRequest(input.sealedRequest,
      { groundingId: input.groundingId, requestId: input.requestId })).toString("utf8"));
    return { ...job.fence, groundingId: input.groundingId, operation: input.operation, attempt: 1,
      deadlineAt: input.deadlineAt, maxResultBytes: input.maxResultBytes, immutableLocks: input.immutableLocks,
      initialState: { identity: input.identity, request, idempotencyKey: input.idempotencyKey, contractSelection: input.contractSelection } };
  }
  async heartbeat(fence: WorkerExecutionFence) { return { owned: this.owns(fence), cancelRequested: false }; }
  async settle(fence: WorkerExecutionFence, settlement: WorkerSettlement) {
    if (!this.owns(fence)) return "FENCE_REJECTED" as const;
    const job = [...this.jobs.values()].find(value => value.submission.jobId === fence.jobId)!;
    if (settlement.kind === "RESULT") {
      if (job.submission.deadlineAt.getTime() <= Date.now()) return "FENCE_REJECTED" as const;
      const result = JSON.parse(Buffer.from(settlement.resultBytes).toString("utf8"));
      assertNegotiatedGroundingResult(result, job.submission.contractSelection);
      if (result.resultHash !== settlement.resultHash || settlement.resultBytes.byteLength > job.submission.maxResultBytes) throw new Error("HTTP_RESULT_SETTLEMENT_MISMATCH");
      job.resultBytes = Uint8Array.from(settlement.resultBytes); job.status = settlement.status;
    } else {
      job.status = settlement.kind === "CANCELLED" ? "CANCELLED" : "FAILED";
      job.error = { code: settlement.errorCode, message: settlement.errorCode, retryable: false, stage: "PERSISTENCE" };
    }
    return "APPLIED" as const;
  }
  async loadLatestCheckpoint(jobId: string, runFingerprint: string) {
    const stored = this.checkpoints.get(jobId);
    if (!stored || stored.metadata.runFingerprint !== runFingerprint) return null;
    return { ...stored.metadata, state: JSON.parse(Buffer.from(await this.codec.openCheckpoint(stored.ciphertext, { jobId, runFingerprint })).toString("utf8")) };
  }
  async recordStarted(fence: WorkerExecutionFence, record: PipelineEventRecord) {
    if (!this.owns(fence)) return false; this.records.push(structuredClone(record)); return true;
  }
  async recordTerminal(fence: WorkerExecutionFence, record: PipelineEventRecord, checkpoint?: PipelineCheckpoint) {
    if (!this.owns(fence)) return false;
    this.records.push(structuredClone(record));
    if (checkpoint) {
      const { state: _state, ...metadata } = checkpoint;
      this.checkpoints.set(fence.jobId, { metadata, ciphertext: await this.codec.sealCheckpoint(checkpoint) });
    }
    return true;
  }
  private readonly query = async (sql: string, values: unknown[] = []) => {
    this.sql.push(sql);
    if (sql.includes("FROM wsgs.grounding_result AS result") && sql.includes("JOIN wsgs.grounding_request AS request") && sql.includes("JOIN wsgs.grounding_job AS job")) {
      if (values.length !== 5) throw new Error("INVALID_PRIOR_AUTHORITY_QUERY");
      const job = this.jobs.get(String(values[0]));
      const identity = job?.submission.identity;
      if (!job?.resultBytes || !identity || identity.dataScope !== values[1] || identity.actorId !== values[2] ||
        identity.servicePrincipalId !== values[3] || identity.authorizationContextHash !== values[4]) return { rowCount: 0, rows: [] };
      const result = JSON.parse(Buffer.from(job.resultBytes).toString("utf8"));
      return { rowCount: 1, rows: [{ grounding_id: job.submission.groundingId, job_id: job.submission.jobId,
        principal_id: identity.servicePrincipalId, actor_id: identity.actorId, data_scope: identity.dataScope,
        dataset_scopes: identity.datasetScopes, authorization_context_hash: identity.authorizationContextHash,
        result_hash: result.resultHash, result_bytes: Buffer.from(job.resultBytes), source_expires_at: job.submission.sourceExpiresAt }] };
    }
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rowCount: 0, rows: [] };
    if (sql.includes("SELECT 1 FROM wsgs.grounding_job")) return { rowCount: this.owns({ jobId: String(values[0]), leaseToken: String(values[1]), generation: Number(values[2]) }) ? 1 : 0, rows: [] };
    if (/INSERT INTO wsgs\.(capability_snapshot|model_receipt|semantic_frame|grounding_graph)/u.test(sql)) return { rowCount: 1, rows: [] };
    throw new Error(`UNIMPLEMENTED_TEST_SQL:${sql.slice(0, 90)}`);
  };
  readonly pool = { query: this.query, connect: async () => ({ release() {}, query: this.query }) };
}
