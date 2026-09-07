import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalysisProviderContracts, GowmConsumerSchemaRegistry, analysisHash } from "@wsgs/gowm-contract-intake";
import { createGroundingIdentity } from "@wsgs/delegated-identity";
import { createWorldAnalysisValidator } from "@wsgs/contracts";
import { GroundingPipeline, ProductionGroundingBackend, utf8Sha256 } from "@wsgs/grounding-pipeline";
import { createGroundingApi } from "../services/grounding-api/src/server.js";
import { groundingCapabilitiesForSelection } from "../services/grounding-api/src/production.js";
import { createPipelineStageExecutor } from "../services/grounding-worker/src/production-module.js";
import { GroundingWorker } from "../services/grounding-worker/src/worker.js";
import { HttpMemoryStore, analysisAdmissionFixture } from "./world-analysis-http-support.js";

const hashBytes = (bytes: string | Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const reference = (kind: string, name: string) => ({ namespace: "gowm", kind, id: `wrf_${analysisHash(name).slice(7, 39)}`, version: "1" });
const subject = reference("WORLD_OBJECT", "vehicle-2"), task = reference("OPERATIONAL_TASK", "task-2");
const interval = reference("TASK_EXECUTION_INTERVAL", "interval-2"), trajectory = reference("HISTORICAL_TRAJECTORY", "trajectory-2");
const period = { start: "2026-09-01T00:00:00.000Z", end: "2026-09-01T00:03:05.001Z", bounds: "[)" };
const identity = createGroundingIdentity({ servicePrincipalId: "business-http-consumer", actorId: "business-http-actor", dataScopes: ["business-http-scope"], datasetScopes: [], permissions: ["grounding.read", "data:read"] });
const headers = { "content-type": "application/json", "WSGS-Contract-Version": "sacs-wsgs-grounding/1.2", "WSGS-Result-Profile": "wsgs-world-analysis-findings/1.0" };

describe("nonempty historical production HTTP", () => {
  let api: Awaited<ReturnType<typeof createGroundingApi>>;
  let gateway: ReturnType<typeof Fastify>;
  let worker: GroundingWorker;
  let store: HttpMemoryStore;
  let directory: string;
  let baseUrl: string;
  const calls: string[] = [];
  const gatewayErrors: string[] = [];
  async function start(advanced: boolean, failure?: "HASH_DRIFT" | "MAP_UNAVAILABLE", metric = false, ambiguousSeries = false) {
    calls.length = 0;
    gatewayErrors.length = 0;
    const fixture = analysisAdmissionFixture();
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const registry = new GowmConsumerSchemaRegistry({ analysisContracts: new AnalysisProviderContracts() });
    const schemaBytes = readFileSync(new URL("../validation/fixtures/world-analysis-http/history-schemas.json", import.meta.url));
    const source = JSON.parse(readFileSync(new URL("../validation/fixtures/world-analysis-http/HISTORY_SOURCE.json", import.meta.url), "utf8"));
    expect(hashBytes(schemaBytes)).toBe(source.schemaSha256);
    const ajv = new Ajv2020({ strict: true, strictRequired: false, strictTuples: false, allErrors: true }); addFormats(ajv);
    for (const [path, schema] of Object.entries(JSON.parse(schemaBytes.toString("utf8")) as Record<string, any>))
      ajv.addSchema({ ...schema, $id: `https://fixture.invalid/${path}` });
    const outputs: Record<string, any> = {
      "operational-task.get": { schemaVersion: "1.0", referenceKey: task, actorReferenceKeys: [subject], activityState: "ACTIVE", controlState: "RUNNING" },
      "operational-task.get-execution-intervals": { schemaVersion: "1.1", status: "COMPLETED", reasonCode: "EXECUTION_INTERVAL_AVAILABLE", requestedPhaseScope: "ACTIVE_PHASES_ONLY", truncated: false,
        intervals: [{ executionIntervalReferenceKey: interval, executionNo: 1, revisionNo: 1, lifecycleState: "CLOSED", selectedPeriods: [period], activePeriods: [period], pausedPeriods: [], derivationKind: "OBSERVED", stabilityState: "SEALED", reasonCodes: [] }] },
      "history.get-trajectory": { schemaVersion: "1.0", status: "COMPLETED", reasonCode: "TRAJECTORY_AVAILABLE", subjectReferenceKey: subject,
        executionIntervalReferenceKey: interval, trajectoryReferenceKey: trajectory, requestedPeriods: [period], definedPeriods: [period], excludedPeriods: [], gaps: [], inputTrackletVersions: [],
        completeness: { temporalCoverageRatio: 1, sampleCount: 3, sequenceCount: 1, gapCount: 0, prefixComplete: true, suffixComplete: true }, finalization: { state: "SEALED" }, warnings: [],
        preview: [["08:00:00", 116.30, 39.90], ["08:05:00", 116.31, 39.91], ["08:09:59", 116.32, 39.92]].map(([time, lon, lat]) => ({ observedAt: `2026-09-01T${time}.000Z`, position: { type: "Point", coordinates: [lon, lat] } })) }
    };
    const mapEnvelope = JSON.parse(readFileSync(new URL("../validation/fixtures/advanced-history/map-match.json", import.meta.url), "utf8"));
    const rewrite = (value: any): void => {
      if (!value || typeof value !== "object") return;
      if (value.namespace === "gowm" && value.kind === "HISTORICAL_TRAJECTORY") Object.assign(value, trajectory);
      if (value.namespace === "gowm" && value.kind === "WORLD_OBJECT") Object.assign(value, subject);
      Object.values(value).forEach(rewrite);
    };
    rewrite(mapEnvelope);
    const crossEnvelope = JSON.parse(readFileSync(new URL("../validation/fixtures/advanced-history/cross-last.json", import.meta.url), "utf8"));
    rewrite(crossEnvelope);
    const metricEnvelope = JSON.parse(readFileSync(new URL("../validation/fixtures/advanced-history/metric-shared-campus.json", import.meta.url), "utf8"));
    rewrite(metricEnvelope);
    const ambiguousEnvelope = JSON.parse(readFileSync(new URL("../validation/fixtures/advanced-history/metric-ambiguous-series.json", import.meta.url), "utf8"));
    rewrite(ambiguousEnvelope);
    Object.assign(ambiguousEnvelope.output.value, {
      analysisPeriods: metricEnvelope.output.value.analysisPeriods,
      excludedPeriods: metricEnvelope.output.value.excludedPeriods,
      metricSeriesCandidates: [metricEnvelope.output.value.metricSeriesCandidates[0], ambiguousEnvelope.output.value.metricSeriesCandidates[1]]
    });
    for (const key of ["trajectoryTemporalCoverageRatio", "trajectoryPrefixComplete", "trajectorySuffixComplete", "trajectoryGapPeriods", "trajectoryQualityBreakPeriods", "excludedPeriods"])
      ambiguousEnvelope.output.value.completeness[key] = metricEnvelope.output.value.completeness[key];
    crossEnvelope.output.value.source.mapMatchResultHash = analysisHash(mapEnvelope.output.value);
    if (failure === "HASH_DRIFT") crossEnvelope.output.value.source.mapMatchResultHash = analysisHash("unrelated-map-result");
    const history = outputs["history.get-trajectory"];
    const { finalizationState: _state, ...completeness } = mapEnvelope.output.value.inputCompleteness;
    history.completeness = completeness;
    history.preview = mapEnvelope.output.value.pointAssociationPreview.map((point: any) => ({ observedAt: point.observedAt, position: point.position }));
    history.definedPeriods = [{ ...period, end: "2026-09-01T00:01:00.000Z" }, { ...period, start: "2026-09-01T00:02:00.000Z" }];
    history.gaps = [{ range: { start: "2026-09-01T00:01:00.000Z", end: "2026-09-01T00:02:00.000Z", bounds: "[)" }, reason: "SOURCE_COVERAGE_GAP" }];
    if (metric) {
      const ranking = metricEnvelope.output.value;
      const ranges = ranking.analysisPeriods.map((range: any) => ({ ...range, bounds: "[)" }));
      history.requestedPeriods = ranges;
      history.definedPeriods = [
        { start: ranges[0].start, end: "2026-09-01T00:00:40.000Z", bounds: "[)" },
        { start: "2026-09-01T00:00:50.000Z", end: "2026-09-01T00:01:10.000Z", bounds: "[)" },
        { start: "2026-09-01T00:01:20.000Z", end: ranges[0].end, bounds: "[)" }
      ];
      history.gaps = ranking.completeness.trajectoryGapPeriods.map((range: any) => ({ range: { ...range, bounds: "[)" }, reason: "SOURCE_COVERAGE_GAP" }));
      history.excludedPeriods = ranking.excludedPeriods.map(({ start, end, exclusionKind }: any) => ({ range: { start, end, bounds: "[)" }, reason: exclusionKind }));
      history.preview = ranking.alignedSamplePreview.map(({ observedAt, position }: any) => ({ observedAt, position }));
      history.preview.push({ observedAt: "2026-09-01T00:01:59.999Z", position: history.preview.at(-1).position });
      history.completeness = { temporalCoverageRatio: ranking.completeness.trajectoryTemporalCoverageRatio, sampleCount: history.preview.length,
        sequenceCount: 4, gapCount: history.gaps.length, prefixComplete: true, suffixComplete: true };
      Object.assign(outputs["operational-task.get-execution-intervals"].intervals[0], {
        selectedPeriods: ranges,
        activePeriods: [{ start: ranges[0].start, end: "2026-09-01T00:01:10.000Z", bounds: "[)" }, { start: "2026-09-01T00:01:20.000Z", end: ranges[0].end, bounds: "[)" }],
        pausedPeriods: history.excludedPeriods.map(({ range }: any) => range)
      });
    }
    for (const [id, name] of [["history.get-trajectory", "historical-trajectory-result"], ["operational-task.get-execution-intervals", "task-execution-interval-result"]]) {
      const validate = ajv.getSchema(`https://fixture.invalid/contracts/gowm-v0.7.1/${name}.schema.json`)!;
      expect(validate(outputs[id!]), JSON.stringify(validate.errors)).toBe(true);
    }
    gateway = Fastify();
    gateway.setErrorHandler((error, _request, reply) => { gatewayErrors.push(JSON.stringify({ message: error.message, issues: (error as any).issues })); return reply.code(500).send({ error: "CONTROLLED_GATEWAY_TEST_FAILURE" }); });
    gateway.post("/v1/operations/:operation", async (request, reply) => {
      const body = request.body as any;
      const operationId = String((request.params as any).operation).replace(/:execute$/, "");
      const { payload } = await jwtVerify(String(request.headers["x-gowm-delegation"]), keys.publicKey, { issuer: "business-issuer", audience: "business-audience", algorithms: ["RS256"] });
      expect(payload["allowedOperations"]).toEqual([`${operationId}@${body.operationVersion}`]);
      calls.push(operationId);
      const descriptor = fixture.metadata.catalog.capabilities.find(entry => entry.operationId === operationId)!;
      expect(body.inputSchemaHash).toBe(descriptor.inputSchemaHash); expect(body.outputSchemaHash).toBe(descriptor.outputSchemaHash);
      if (operationId === "trajectory.map-match" || operationId === "temporal-spatial.find-events" || operationId === "spatiotemporal-metric.rank-locations") {
        if (operationId === "trajectory.map-match" && failure === "MAP_UNAVAILABLE") return reply.code(503).send({ error: "CONTROLLED_PROVIDER_UNAVAILABLE" });
        if (operationId === "trajectory.map-match") expect(body.input.trajectoryReferenceKey).toEqual(trajectory);
        else if (operationId === "temporal-spatial.find-events") {
          expect(body.input.source.mapMatchResult).toEqual(mapEnvelope.output.value);
          expect(body.input.selection).toEqual({ kind: "LAST" });
        } else {
          expect(body.input.trajectoryReferenceKey).toEqual(trajectory);
          expect(body.input.metricSelector).toMatchObject({ observedProperty: "radio.rssi", measurementStage: "NORMALIZED", optimizationDirection: "MAXIMIZE" });
          expect(body.input.ranking).toEqual({ topK: 3 });
          expect(body.input.aggregation).toEqual({ mode: "H3", resolution: 12 });
          if (body.input.metricSeriesSelection.mode === "EXPLICIT_SERIES") expect(body.input.metricSeriesSelection).toEqual({ mode: "EXPLICIT_SERIES", sourceKey: "campus-radio", datastreamKey: "cellular-rssi", measurementKey: "rssi" });
        }
        const envelope = structuredClone(operationId === "trajectory.map-match" ? mapEnvelope : operationId === "temporal-spatial.find-events" ? crossEnvelope :
          ambiguousSeries && body.input.metricSeriesSelection.mode !== "EXPLICIT_SERIES" ? ambiguousEnvelope : metricEnvelope); envelope.requestId = body.requestId;
        envelope.execution.resultHash = analysisHash(envelope.output.value);
        for (const receipt of envelope.receipts) { receipt.inputHash = analysisHash(body.input); receipt.outputHash = envelope.execution.resultHash; receipt.computeSnapshotHash = analysisHash(envelope.computeSnapshot); }
        new AnalysisProviderContracts().validateEnvelope(operationId, envelope, body.input);
        registry.validate("platform/capability-result-envelope.schema.json", envelope);
        return envelope;
      }
      let output = outputs[operationId];
      if (operationId === "operational-task.get-execution-intervals") output = { ...output, requestedPhaseScope: body.input.phaseScope };
      if (operationId === "reference.validate") output = { schemaVersion: "1.0", results: body.input.references.map(({ referenceKey }: any) => ({ referenceKey, existence: "AVAILABLE", freshness: "CURRENT", usable: "YES", snapshot: "CURRENT", reasons: [] })) };
      if (!output) return reply.code(500).send({ error: `UNEXPECTED_OPERATION:${operationId}` });
      const operation = { operationId, operationVersion: descriptor.operationVersion };
      const provider = { providerId: "controlled.history", providerVersion: "1.0", implementationDigest: analysisHash("controlled-history-http") };
      const computeSnapshot = { provider, operation, engine: { name: "CONTROLLED_FIXTURE", version: "1.0" }, policy: { version: "controlled-fixture/1.0", digest: analysisHash("controlled-fixture-policy") }, schemas: { inputSchemaHash: descriptor.inputSchemaHash, outputSchemaHash: descriptor.outputSchemaHash } };
      const envelope = { providerProtocolVersion: "1.0", requestId: body.requestId, operation, status: "COMPLETED", output: { schemaUri: descriptor.outputSchemaUri, schemaHash: descriptor.outputSchemaHash, value: output },
        computeSnapshot, dataSnapshot: { consistency: "CONSISTENT_AT_START", capturedAt: new Date().toISOString(), scopeDigest: analysisHash(identity.dataScopes), resources: [{ referenceKey: subject, authority: "controlled.history", pinning: "PINNED", digest: analysisHash(output) }] },
        receipts: [], evidenceReferences: [], warnings: [], consumption: { outputBytes: Buffer.byteLength(JSON.stringify(output)) }, execution: { providerId: provider.providerId, providerVersion: provider.providerVersion, elapsedMs: 1, resultHash: analysisHash(output) } };
      registry.validate("platform/capability-result-envelope.schema.json", envelope);
      return envelope;
    });
    const gatewayUrl = await gateway.listen({ host: "127.0.0.1", port: 0 });
    directory = mkdtempSync(join(tmpdir(), "wsgs-business-http-"));
    const bytes = JSON.stringify(fixture.metadata.lock); const lockPath = join(directory, "lock.json"); writeFileSync(lockPath, bytes);
    for (const name of ["WSGS_GDPS_RECIPE_LOCK_FILE", "WSGS_GDPS_RECIPE_LOCK_SHA256", "WSGS_GDPS_PREVIEW_RECIPE_ALLOWLIST", "WSGS_CROSS_SCOPE_GATEWAY_ROUTING", "WSGS_GDPS_CONSUMER_SNAPSHOT_FILE", "WSGS_GDPS_DESCRIPTOR_REGISTRY_FILE", "MODEL_BASE_URL", "MODEL_API_KEY", "MODEL_NAME", "GOWM_DELEGATION_PRIVATE_KEY_FILE"]) vi.stubEnv(name, "");
    for (const [name, value] of Object.entries({ GOWM_SOUTHBOUND_LOCK_FILE: lockPath, GOWM_SOUTHBOUND_LOCK_SHA256: hashBytes(bytes), WSGS_HISTORY_TRACE_ENABLED: "YES", WSGS_ADVANCED_HISTORY_ENABLED: advanced ? "YES" : "NO", WSGS_ALLOW_PREVIEW_CAPABILITIES: advanced ? "NO" : "YES", WSGS_MODEL_POLICY: "MODEL_OPTIONAL", GOWM_GATEWAY_BASE_URL: gatewayUrl, GOWM_GATEWAY_TOKEN: "controlled-test-only", GOWM_GATEWAY_MAX_RETRIES: "0", GOWM_DELEGATION_ISSUER: "business-issuer", GOWM_DELEGATION_AUDIENCE: "business-audience", GOWM_DELEGATION_SERVICE_PRINCIPAL_ID: identity.servicePrincipalId, GOWM_DELEGATION_PRIVATE_KEY_PKCS8: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() })) vi.stubEnv(name, value);
    store = new HttpMemoryStore();
    const executor = await createPipelineStageExecutor({ pool: store.pool as any, priorAnalysisJournal: store });
    worker = new GroundingWorker({ workerId: "business-http-worker", store, pipeline: new GroundingPipeline({ executor, journal: store }), leaseMs: 30_000, heartbeatMs: 100, maxJobAttempts: 1 });
    store.runWorker = () => worker.runOnce();
    const backend = new ProductionGroundingBackend({ store, sealer: store.codec, readiness: async () => ({ ready: true, reasons: [] }), captureAdmissionSnapshot: async () => fixture.admission,
      capabilities: async (_identity, selection) => groundingCapabilitiesForSelection(selection, { ready: true, reasons: [] }) });
    const schemaDirectory = new URL("../contracts/wsgs-v0.1/contracts/", import.meta.url);
    const schemas = Object.fromEntries(readdirSync(schemaDirectory).filter(name => name.endsWith(".json")).map(name => [name, JSON.parse(readFileSync(new URL(name, schemaDirectory), "utf8"))]));
    api = await createGroundingApi({ auth: { mode: "STATIC_TRUSTED", identity }, backend, schemas, contractNegotiation: { sacsGeospatialServicePrincipals: [], worldAnalysisServicePrincipals: [identity.servicePrincipalId] } });
    baseUrl = await api.listen({ host: "127.0.0.1", port: 0 });
  }
  afterEach(async () => { await worker?.stop(0); await api?.close(); await gateway?.close(); vi.unstubAllEnvs(); if (directory) rmSync(directory, { recursive: true, force: true }); });
  it.each(["TRACE", "MAP", "CROSS", "CROSS_HASH_DRIFT", "CROSS_MAP_UNAVAILABLE", "RANK", "SERIES_RANK_ACTION"])("queries nonempty %s over Gateway HTTP", async scenario => {
    const advanced = scenario !== "TRACE";
    const cross = scenario.startsWith("CROSS");
    const metric = scenario === "RANK" || scenario === "SERIES_RANK_ACTION";
    await start(advanced, scenario === "CROSS_HASH_DRIFT" ? "HASH_DRIFT" : scenario === "CROSS_MAP_UNAVAILABLE" ? "MAP_UNAVAILABLE" : undefined, metric, scenario === "SERIES_RANK_ACTION");
    const text = metric ? "2号车本次任务通信信号最好的三个位置在哪里" : cross ? "2号车最后经过哪个路口" : advanced ? "2号车本次任务经过了哪些道路？" : "2号车最近一次任务的历史轨迹";
    const body = { schemaVersion: "1.0", requestId: `request-${randomUUID()}`, operation: "EXECUTE_WORLD_QUERY", source: { conversationRef: "business-conversation", messageId: `message-${randomUUID()}`, originalText: text, originalTextSha256: utf8Sha256(text), locale: "zh-CN", createdAt: new Date().toISOString() }, requestedProducts: ["WORLD_EVIDENCE"],
      contextCapsule: { knownWorldReferences: [{ referenceKey: subject, referenceType: "WORLD_OBJECT", alias: "2号车", sourceMessageId: "known-subject-message" }, { referenceKey: task, referenceType: "OPERATIONAL_TASK", alias: "任务", sourceMessageId: "known-task-message" }], priorGroundings: [], mapSelections: [], externalCorrelationHints: [], externalPredicates: [] },
      executionPolicy: { readOnly: true, deadlineMs: 15_000, maxQueryOperations: 16, maxCandidatesPerMention: 5, maxResultBytes: 1_048_576, allowApproximation: false } };
    const validate = createWorldAnalysisValidator(); expect(validate("request", body)).toEqual({ valid: true, errors: [] });
    async function submitSelection(prior: any, choice: any, selected: any, nextText: string) {
      const next = { ...body, requestId: `request-${randomUUID()}`,
        source: { ...body.source, messageId: `message-${randomUUID()}`, originalText: nextText, originalTextSha256: utf8Sha256(nextText), createdAt: new Date().toISOString() },
        contextCapsule: { ...body.contextCapsule, knownWorldReferences: [], priorGroundings: [{ groundingId: prior.groundingId, resultHash: prior.resultHash, selectedProductIds: [] }] },
        analysisSelections: [{ priorGroundingId: prior.groundingId, priorResultHash: prior.resultHash, findingSetHash: prior.worldAnalysisFindings.findingSetHash,
          choiceId: choice.choiceId, candidateId: selected.candidateId }] };
      expect(validate("request", next)).toEqual({ valid: true, errors: [] });
      const response = await fetch(`${baseUrl}/v1/groundings`, { method: "POST", headers: { ...headers, "idempotency-key": randomUUID() }, body: JSON.stringify(next) });
      const value = await response.json();
      expect(response.status, JSON.stringify({ value, calls, gatewayErrors, errors: [...store.jobs.values()].map(job => job.error) })).toBe(200);
      expect(validate("result", value)).toEqual({ valid: true, errors: [] });
      const saved = await (await fetch(`${baseUrl}/v1/groundings/${value.groundingId}`, { headers })).json();
      expect(saved.result).toEqual(value);
      return value;
    }
    const response = await fetch(`${baseUrl}/v1/groundings`, { method: "POST", headers: { ...headers, "idempotency-key": randomUUID() }, body: JSON.stringify(body) });
    const result = await response.json();
    expect(response.status, JSON.stringify({ result, calls, gatewayErrors, errors: [...store.jobs.values()].map(job => job.error), events: store.records.map(record => record.event).filter(event => event.status === "FAILED") })).toBe(200);
    expect(validate("result", result)).toEqual({ valid: true, errors: [] });
    expect(calls).toContain("history.get-trajectory");
    const finding = result.worldAnalysisFindings.findings.find((entry: any) => entry.findingKind === "HISTORICAL_TRACE");
    expect(finding, JSON.stringify(result)).toBeDefined();
    expect(finding.coverage).toMatchObject(metric ? { temporalCoverageRatio: 0.8333333333, sampleCount: 14 } : { temporalCoverageRatio: 0.67, sampleCount: 10 });
    expect(result.referenceProducts.some((product: any) => product.productId === finding.executionIntervalReferenceProductId && product.referenceKey.id === interval.id)).toBe(true);
    expect(calls).toEqual(["reference.validate", "operational-task.get", "operational-task.get-execution-intervals", "history.get-trajectory", ...(metric ? ["spatiotemporal-metric.rank-locations"] : advanced ? ["trajectory.map-match"] : []), ...(cross && scenario !== "CROSS_MAP_UNAVAILABLE" ? ["temporal-spatial.find-events"] : [])]);
    if (advanced && !metric && scenario !== "CROSS_MAP_UNAVAILABLE") {
      const roads = result.worldAnalysisFindings.findings.find((entry: any) => entry.findingKind === "ROAD_ASSOCIATION");
      expect(roads, JSON.stringify(result)).toBeDefined();
      expect(roads.roadVisits).toHaveLength(4); expect(roads.offNetworkSegments).toHaveLength(2);
      expect(roads.networkRole).toBe("REFERENCE_MODEL_NOT_PHYSICAL_TRUTH");
      expect(roads.associationSuffixComplete).toBe(false);
    }
    if (scenario === "CROSS") {
      const events = result.worldAnalysisFindings.findings.find((entry: any) => entry.findingKind === "TEMPORAL_EVENT");
      expect(events, JSON.stringify(result)).toBeDefined();
      expect(events.events).toHaveLength(1);
      expect(events.selection).toMatchObject({ kind: "LAST", confirmed: false, confirmationScope: "NOT_CONFIRMED", reasonCode: "LAST_EVENT_NOT_CERTAIN" });
      expect(events.sourceSuffixComplete).toBe(false);
      expect(events.selection.blockingPeriods).toHaveLength(3);
    } else if (cross) {
      expect(result.worldAnalysisFindings.findings.some((entry: any) => entry.findingKind === "TEMPORAL_EVENT")).toBe(false);
      expect(result.worldAnalysisFindings.gaps.length).toBeGreaterThan(0);
      expect(result.worldAnalysisFindings.gaps.some((gap: any) => gap.gapKind === (scenario === "CROSS_HASH_DRIFT" ? "UPSTREAM_CONTRACT_MISMATCH" : "UPSTREAM_FAILURE"))).toBe(true);
      expect(JSON.stringify(result)).not.toContain("CONTROLLED_PROVIDER_UNAVAILABLE");
    }
    if (metric) {
      let rankedResult = result;
      if (scenario === "SERIES_RANK_ACTION") {
        const seriesChoice = result.worldAnalysisFindings.choices.find((entry: any) => entry.choiceKind === "METRIC_SERIES_SELECTION");
        expect(seriesChoice, JSON.stringify(result)).toBeDefined();
        expect(seriesChoice.candidates).toHaveLength(2);
        expect(result.worldAnalysisFindings.findings.find((entry: any) => entry.findingKind === "METRIC_RANKING").candidates).toEqual([]);
        const selectedSeries = seriesChoice.candidates.find((candidate: any) => candidate.series.sourceKey === "campus-radio");
        const before = calls.length;
        rankedResult = await submitSelection(result, seriesChoice, selectedSeries, "使用所选数据序列");
        expect(calls.slice(before)).toContain("spatiotemporal-metric.rank-locations");
        expect(calls.slice(before)).not.toContain("history.get-trajectory");
      }
      const ranking = rankedResult.worldAnalysisFindings.findings.find((entry: any) => entry.findingKind === "METRIC_RANKING");
      expect(ranking, JSON.stringify(rankedResult)).toBeDefined();
      expect(ranking.candidateDomain).toBe("PAST_OBSERVED_LOCATIONS");
      expect(ranking.metric).toMatchObject({ observedProperty: "radio.rssi", measurementStage: "NORMALIZED", unit: "dBm", optimizationDirection: "MAXIMIZE" });
      expect(ranking.selectedSeries).toMatchObject({ sourceKey: "campus-radio", datastreamKey: "cellular-rssi", measurementKey: "rssi" });
      expect(ranking.candidates.map((candidate: any) => candidate.rank)).toEqual([1, 2, 3]);
      const upstream = JSON.parse(readFileSync(new URL("../validation/fixtures/advanced-history/metric-shared-campus.json", import.meta.url), "utf8")).output.value;
      for (const [index, candidate] of ranking.candidates.entries()) {
        expect(candidate.representativeVisitedPosition).toEqual(upstream.candidates[index].representativeVisitedPosition);
        expect(candidate.representativeVisitedPosition).not.toEqual(upstream.candidates[index].spatialUnit.cellCenter);
        expect(candidate.rankingBasis.rankingValue).toBe(upstream.candidates[index].statistics.median);
        expect(candidate.representativeValue).toBe(upstream.candidates[index].representativeValue);
      }
      expect(ranking.coverage).toMatchObject({ metricTemporalCompletenessKnown: false, sourceMetricSampleCount: 15, alignedMetricSampleCount: 13, unalignedMetricSampleCount: 2 });
      expect(rankedResult.worldAnalysisFindings.findings.some((entry: any) => entry.findingKind === "ACTION_TARGET_CANDIDATE")).toBe(false);
      const choice = rankedResult.worldAnalysisFindings.choices.find((entry: any) => entry.choiceKind === "RANKED_LOCATION_SELECTION");
      expect(choice).toBeDefined();
      const selected = choice.candidates.find((candidate: any) => candidate.rank === 2);
      expect(selected).toBeDefined();
      if (scenario === "RANK") {
        for (const invalid of ["CANDIDATE", "HASH", "EXPIRED"] as const) {
          const previousCalls = calls.length;
          const submission = store.jobs.get(rankedResult.groundingId)!.submission;
          const sourceExpiry = submission.sourceExpiresAt;
          if (invalid === "EXPIRED") submission.sourceExpiresAt = new Date(0);
          try {
            const rejected = await submitSelection(invalid === "HASH" ? { ...rankedResult, resultHash: analysisHash("wrong-prior-result") } : rankedResult,
              choice, invalid === "CANDIDATE" ? { ...selected, candidateId: "candidate-not-in-stored-choice" } : selected, "前往所选位置");
            expect(rejected.worldAnalysisFindings.findings.some((entry: any) => entry.findingKind === "ACTION_TARGET_CANDIDATE"), invalid).toBe(false);
            expect(rejected.worldAnalysisFindings.gaps.some((gap: any) => gap.gapKind === (invalid === "EXPIRED" ? "SELECTION_EXPIRED" : "SELECTION_INVALID")), JSON.stringify(rejected)).toBe(true);
            expect(calls.slice(previousCalls), invalid).toEqual([]);
          } finally { submission.sourceExpiresAt = sourceExpiry; }
        }
      }
      const previousCallCount = calls.length;
      const nextResult = await submitSelection(rankedResult, choice, selected, "前往所选位置");
      const action = nextResult.worldAnalysisFindings.findings.find((entry: any) => entry.findingKind === "ACTION_TARGET_CANDIDATE");
      expect(action, JSON.stringify(nextResult)).toBeDefined();
      expect(action.executionAuthorized).toBe(false);
      expect(action.target).toEqual(ranking.candidates[1].representativeVisitedPosition);
      expect(action).toMatchObject({ sourceRank: 2, representativeObservedAt: ranking.candidates[1].representativeObservedAt,
        representativeMeasurementId: ranking.candidates[1].representativeMeasurementId,
        requirements: { currentValidationRequired: true, routePlanningRequired: true, executionConfirmationRequired: true } });
      const restoredRanking = nextResult.worldAnalysisFindings.findings.find((entry: any) => entry.findingId === action.sourceFindingId);
      expect(restoredRanking.candidates.find((candidate: any) => candidate.candidateId === action.sourceCandidateId)).toMatchObject({ rank: 2, representativeVisitedPosition: action.target });
      expect(calls.slice(previousCallCount)).not.toContain("spatiotemporal-metric.rank-locations");
      expect(store.sql.some(sql => sql.includes("FROM wsgs.grounding_result AS result"))).toBe(true);
    }
    for (const key of [trajectory, interval]) expect(result.referenceProducts.filter((product: any) => product.referenceKey.id === key.id)).toHaveLength(1);
    expect(store.jobs.get(result.groundingId)!.resultBytes).toBeDefined();
    const saved = await (await fetch(`${baseUrl}/v1/groundings/${result.groundingId}`, { headers })).json();
    expect(saved.result).toEqual(result);
  }, 30_000);
});
