import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { findingSetHash, resultHash, canonicalHash, createPublicValidator } from "../../contracts/wsgs-v0.2.4-world-analysis/validator.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const directory = join(root, "contracts/wsgs-v0.2.4-world-analysis");
const check = process.argv.includes("--check");
const validate = createPublicValidator();
const clone = structuredClone;
const now = "2026-09-06T10:00:00.000+08:00";
const until = "2026-09-06T10:01:00.000+08:00";
const period = { start: "2026-09-05T10:00:00.123+08:00", end: "2026-09-05T10:10:00.456+08:00", bounds: "UNSPECIFIED" };
const point = { type: "Point", coordinates: [116.3913, 39.9075] };
const digest = text => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const hash = digest("PUBLIC_ARTIFICIAL_CONTRACT_SAMPLE_NOT_LIVE");
const base = (findingId, findingKind, returnedCount = 1) => ({ findingId, findingKind, semanticConcept: findingKind, status: "COMPLETED", subjectReferenceProductIds: ["ugv1"], evidenceIds: ["evidence-1"], unknowns: [], warnings: [], display: { truncated: false, returnedCount }, validUntil: until });
const series = { sourceKey: "radio-1", datastreamKey: "wifi0", measurementKey: "rssi", observedProperty: "RSSI", measurementStage: "NORMALIZED", valueUnit: "dBm" };
const ranking = {
  ...base("finding-ranking", "METRIC_RANKING", 2), trajectoryReferenceProductId: "trajectory-1", candidateDomain: "PAST_OBSERVED_LOCATIONS",
  metric: { conceptId: "radio.rssi", observedProperty: "RSSI", measurementStage: "NORMALIZED", unit: "dBm", optimizationDirection: "MAXIMIZE" }, selectedSeries: series,
  candidates: [
    { candidateId: "candidate-1", rank: 1, representativeVisitedPosition: point, representativeObservedAt: period.start, representativeMeasurementId: "measurement-7", representativeValue: -42, sampleCount: 5, statistics: { sampleCount: 5, minimum: -50, maximum: -40, mean: -42.4, median: -40 }, rankingBasis: { primaryStatistic: "MEDIAN", optimizationDirection: "MAXIMIZE", rankingValue: -40, tieBreakers: ["sampleCount DESC", "h3Index ASC"] }, reasonCodes: [] },
    { candidateId: "candidate-2", rank: 2, representativeVisitedPosition: { type: "Point", coordinates: [116.392, 39.908] }, representativeObservedAt: period.end, representativeMeasurementId: "measurement-8", representativeValue: -45, sampleCount: 5, statistics: { sampleCount: 5, minimum: -55, maximum: -43, mean: -48.6, median: -50 }, rankingBasis: { primaryStatistic: "MEDIAN", optimizationDirection: "MAXIMIZE", rankingValue: -50, tieBreakers: ["sampleCount DESC", "h3Index ASC"] }, reasonCodes: [] }
  ], coverage: { metricTemporalCompletenessKnown: false, trajectory: { finalizationState: "SEALED", temporalCoverageRatio: 1 }, trajectoryGaps: [], excludedPeriods: [] }
};
const trace = { ...base("finding-trace", "HISTORICAL_TRACE"), taskReferenceProductId: "task-1", trajectoryReferenceProductId: "trajectory-1", executionIntervalReferenceProductId: "interval-1", executionNo: 2, lifecycleState: "COMPLETED", phaseScope: "ACTIVE_PHASES_ONLY", selectedPeriods: [period], activePeriods: [period], pausedPeriods: [], requestedPeriods: [period], definedPeriods: [period], excludedPeriods: [], trajectoryGaps: [], coverage: { prefixComplete: true, suffixComplete: true, finalizationState: "SEALED", sampleCount: 3 } };
const road = { ...base("finding-road", "ROAD_ASSOCIATION"), trajectoryReferenceProductId: "trajectory-1", networkRole: "REFERENCE_MODEL_NOT_PHYSICAL_TRUTH", network: { graphVersionId: "xord-network-1", graphVersion: "v1", topologyHash: hash, timeBasis: "CURRENT_ACTIVE_TOPOLOGY" }, roadVisits: [{ visitId: "visit-1", sourceFeatureId: "road-A", period, sampleCount: 3 }], offNetworkSegments: [], ambiguousSegments: [], networkDataIssues: [], associationPrefixComplete: true, associationSuffixComplete: true, blockingPeriods: [], lastConfirmedRoad: { visitId: "visit-1", confirmationScope: "CONFIRMED_IN_AVAILABLE_DATA", absoluteFinalRoadClaimed: false } };
const event = { ...base("finding-event", "TEMPORAL_EVENT"), trajectoryReferenceProductId: "trajectory-1", eventTypes: ["CROSS"], events: [{ eventId: "event-1", eventType: "CROSS", extent: { kind: "INSTANT", timeWindow: period, estimatedAt: period.start }, position: point, target: { kind: "NETWORK_JUNCTION", graphVersionId: "xord-network-1", graphVersion: "v1", nodeId: "node-1", position: point, incomingFeatureId: "road-A", outgoingFeatureId: "road-B" }, certainty: "CONFIRMED_IN_AVAILABLE_DATA", reasonCodes: [], evidenceIds: ["evidence-1"] }], selection: { kind: "LAST", confirmed: true, selectedEventId: "event-1", confirmationScope: "REQUESTED_SCOPE_PROVEN", reasonCode: "LAST_EVENT_CONFIRMED", blockingPeriods: [] }, sourcePrefixComplete: true, sourceSuffixComplete: true, completeForAllEvents: true, blockingPeriods: [] };
const action = { ...base("finding-action", "ACTION_TARGET_CANDIDATE"), actionKind: "MOVE_TO_LOCATION", sourceKind: "HISTORICAL_METRIC_CANDIDATE", target: point, crs: "EPSG:4326", axisOrder: "LONGITUDE_LATITUDE", sourceFindingId: ranking.findingId, sourceCandidateId: "candidate-1", sourceRank: 1, representativeObservedAt: period.start, representativeMeasurementId: "measurement-7", requirements: { currentValidationRequired: true, routePlanningRequired: true, executionConfirmationRequired: true }, executionAuthorized: false };
const choice = (choiceId, choiceKind, candidates, sourceFindingId) => ({ choiceId, choiceKind, promptCode: choiceKind, validUntil: until, candidates, ...(sourceFindingId ? { sourceFindingId } : {}) });
const choices = [
  choice("choice-reference", "REFERENCE_SELECTION", [{ candidateId: "ref-candidate", displayName: "Vehicle ugv1", referenceProductId: "ugv1" }]),
  choice("choice-task", "TASK_SELECTION", [{ candidateId: "task-candidate", displayName: "Task 1", referenceProductId: "task-1" }]),
  choice("choice-series", "METRIC_SERIES_SELECTION", [{ candidateId: "series-1", displayName: "wifi0", series }]),
  choice("choice-rank", "RANKED_LOCATION_SELECTION", ranking.candidates.map(candidate => ({ candidateId: candidate.candidateId, displayName: `Rank ${candidate.rank}`, findingId: ranking.findingId, rank: candidate.rank })), ranking.findingId),
  choice("choice-event", "EVENT_SELECTION", [{ candidateId: "event-candidate", displayName: "Last crossing", findingId: event.findingId, eventId: "event-1" }], event.findingId)
];
const products = ["ugv1", "task-1", "interval-1", "trajectory-1"].map((id, index) => ({ productId: id, productKind: "RESOLVED_REFERENCE", referenceKey: { namespace: "gowm", kind: ["entity", "operational-task", "execution-interval", "trajectory"][index], id: `wrf_${String(index + 1).padStart(32, "0")}`, version: "1" }, referenceType: ["ENTITY", "OPERATIONAL_TASK", "EXECUTION_INTERVAL", "TRAJECTORY"][index], displayName: id, sourceOperation: ["entity.get", "operational-task.get", "operational-task.get-execution-intervals", "history.get-trajectory"][index], sourceWorldVersion: 1, validUntil: until }));
const evidence = { evidenceProductId: "evidence-1", productKind: "CAPABILITY_RESULT", authority: "GOWM", sourceOperation: "spatiotemporal-metric.rank-locations", upstreamStatus: "COMPLETED", payloadSchemaUri: "urn:artificial:contract-sample:result", payloadSchemaHash: hash, receiptIds: ["receipt-sample-1"], evidenceIds: ["upstream-evidence-sample-1"], unknowns: [], warnings: [], dataSnapshot: { snapshotHash: hash }, computeSnapshot: { snapshotHash: hash } };
function seal(result) {
  result.worldAnalysisFindings.findingSetHash = findingSetHash(result.worldAnalysisFindings);
  result.resultHash = resultHash(result);
  return result;
}
function result(findings, suppliedChoices = [], status = "COMPLETED", gaps = []) {
  return seal({ schemaVersion: "1.0", requestId: "request-1", groundingId: "grounding-1", status, source: { messageId: "message-1", originalTextSha256: hash }, mentions: [], referenceProducts: clone(products), evidenceItems: [clone(evidence)], ambiguities: [], unresolvedMentions: [], capabilityGaps: [], warnings: [], execution: { parserVersion: "contract-sample", semanticModelReceiptIds: [], queryCompilerVersion: "contract-sample", normalizerVersion: "contract-sample", elapsedMs: 1, runFingerprint: hash }, validUntil: until, worldAnalysisFindings: { profile: "wsgs-world-analysis-findings/1.0", findings: clone(findings), choices: clone(suppliedChoices), gaps: clone(gaps), findingSetHash: hash }, resultHash: hash });
}
const samples = [];
function emit(name, kind, payload, expected = true, expectedCode) {
  const validation = validate(kind, payload);
  if (validation.valid !== expected || (expectedCode && !validation.errors.some(error => error.code === expectedCode))) throw new Error(`${name}: unexpected validation ${JSON.stringify(validation)}`);
  const file = `examples/${name}.json`;
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  const destination = join(directory, file);
  if (check) {
    if (!existsSync(destination) || readFileSync(destination, "utf8") !== text) throw new Error(`Example drift: ${name}`);
  } else {
    mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, text);
  }
  samples.push({ path: file, schema: kind, valid: expected, ...(expectedCode ? { expectedCode } : {}) });
}
const rankingResult = result([ranking], [choices[3]], "AMBIGUOUS");
emit("ranking", "result", rankingResult);
emit("trace", "result", result([trace]));
emit("road", "result", result([road]));
emit("event", "result", result([event]));
emit("action", "result", result([ranking, action]));
emit("all-choices", "result", result([trace, road, event, ranking], choices, "AMBIGUOUS"));
emit("empty", "result", result([]));
const noData = { ...base("finding-empty", "HISTORICAL_TRACE", 0), status: "NO_DATA", subjectReferenceProductIds: [], evidenceIds: [], phaseScope: "EXECUTION_ENVELOPE", selectedPeriods: [], activePeriods: [], pausedPeriods: [], requestedPeriods: [period], definedPeriods: [], excludedPeriods: [], trajectoryGaps: [], coverage: {} };
emit("trace-no-data", "result", result([noData]));
const gap = (gapKind, severity = "BLOCKING") => ({ gapId: `gap-${gapKind}`, gapKind, severity, messageCode: gapKind, findingIds: [], evidenceIds: [], detail: {} });
emit("projection-pending", "result", result([], [], "PARTIAL", [gap("HISTORICAL_PROJECTION_PENDING")]));
emit("provider-failure", "result", result([], [], "FAILED", [gap("UPSTREAM_FAILURE")]));
emit("action-requirements", "result", result([ranking, action], [], "COMPLETED", [gap("CURRENT_VALIDATION_REQUIRED", "INFO"), gap("ROUTE_PLANNING_REQUIRED", "INFO"), gap("EXECUTION_CONFIRMATION_REQUIRED", "INFO"), gap("EXECUTION_NOT_AUTHORIZED", "INFO")]));
const incompleteEvent = clone(event);
incompleteEvent.status = "PARTIAL";
incompleteEvent.sourceSuffixComplete = false;
incompleteEvent.completeForAllEvents = false;
incompleteEvent.selection.confirmed = false;
incompleteEvent.selection.confirmationScope = "NOT_CONFIRMED";
incompleteEvent.selection.reasonCode = "LAST_EVENT_NOT_CERTAIN";
incompleteEvent.selection.blockingPeriods = [{ period, kind: "UNKNOWN_GAP", reasonCodes: ["SOURCE_SUFFIX_INCOMPLETE"] }];
emit("event-incomplete", "result", result([incompleteEvent], [], "PARTIAL", [gap("ANALYSIS_INCOMPLETE", "WARNING")]));
const truncatedEvent = clone(event); truncatedEvent.display = { returnedCount: 1, sourceCount: 8, truncated: true };
emit("event-display-truncated-proof-retained", "result", result([truncatedEvent]));
const coexist = result([]);
coexist.geospatialFindings = { profile: "sacs-wsgs-geospatial-findings/1.0", profileSchemaHash: digest(readFileSync(join(directory, "dependencies/geospatial/geospatial-findings.schema.json"))), findings: [], sourceProducts: [], gaps: [], findingSetHash: canonicalHash([]), sourceProductSetHash: canonicalHash([]) };
emit("coexist", "result", seal(coexist));
const request = JSON.parse(readFileSync(join(root, "contracts/wsgs-v0.1/examples/05-prior-grounding-reference.json"), "utf8"));
request.source.originalText = "Use the second location.";
request.source.originalTextSha256 = digest(request.source.originalText);
request.source.createdAt = now;
request.contextCapsule.priorGroundings = [{ groundingId: rankingResult.groundingId, resultHash: rankingResult.resultHash, selectedProductIds: [] }];
request.analysisSelections = [{ priorGroundingId: rankingResult.groundingId, priorResultHash: rankingResult.resultHash, findingSetHash: rankingResult.worldAnalysisFindings.findingSetHash, choiceId: "choice-rank", candidateId: "candidate-2" }];
emit("request-selection", "request", request);
const firstRequest = clone(request); delete firstRequest.analysisSelections; firstRequest.contextCapsule.priorGroundings = [];
emit("request-first", "request", firstRequest);
const job = { schemaVersion: "1.0", jobId: "job-1", groundingId: rankingResult.groundingId, requestId: rankingResult.requestId, status: "ACCEPTED", createdAt: now, updatedAt: now };
emit("job-accepted", "job", job);
emit("job-get", "job", { ...job, status: rankingResult.status, result: rankingResult, finishedAt: now });
emit("job-cancel", "job", { ...job, status: "CANCELLED", finishedAt: now });
const capsSchema = JSON.parse(readFileSync(join(directory, "capabilities-1.2.schema.json"), "utf8"));
const caps = {};
for (const [key, property] of Object.entries(capsSchema.properties)) if (property.const !== undefined) caps[key] = property.const;
caps.supportedOperations = capsSchema.properties.supportedOperations.items.enum;
caps.supportedResultProfiles = capsSchema.properties.supportedResultProfiles.items.enum;
caps.resultComponents = { worldAnalysisFindings: "REQUIRED", geospatialFindings: "OPTIONAL" };
const world = capsSchema.properties.worldAnalysis.properties;
caps.worldAnalysis = { supportedFindingKinds: world.supportedFindingKinds.items.enum, supportedChoiceKinds: world.supportedChoiceKinds.items.enum, structuredSelection: true, supportedActionSources: ["HISTORICAL_METRIC_CANDIDATE"], capabilities: world.capabilities.items.properties.capability.enum.map(capability => ({ capability, supported: true, available: false, reasonCodes: ["FEATURE_DISABLED"] })), checkedAt: now, validUntil: until };
caps.limits = JSON.parse(readFileSync(join(directory, "limits.json"), "utf8"));
delete caps.limits.schemaVersion;
delete caps.limits.profile;
caps.requiredCapabilitiesReady = true;
emit("capabilities", "capabilities", caps);
const mutations = [
  ["unknown-kind", value => value.worldAnalysisFindings.findings[0].findingKind = "UNKNOWN", "SCHEMA_INVALID"],
  ["missing-series", value => delete value.worldAnalysisFindings.findings[0].selectedSeries, "SCHEMA_INVALID"],
  ["wrong-profile", value => value.worldAnalysisFindings.profile = "sacs-wsgs-geospatial-findings/1.0", "SCHEMA_INVALID"],
  ["dangling-rp", value => value.worldAnalysisFindings.findings[0].trajectoryReferenceProductId = "candidate-2", "DANGLING_REFERENCE"],
  ["dangling-evidence", value => value.worldAnalysisFindings.findings[0].evidenceIds = ["upstream-evidence-sample-1"], "DANGLING_REFERENCE"],
  ["duplicate-finding", value => value.worldAnalysisFindings.findings.push(clone(value.worldAnalysisFindings.findings[0])), "DUPLICATE_ID"],
  ["rank-order", value => value.worldAnalysisFindings.findings[0].candidates.reverse(), "RANK_ORDER_MISMATCH"],
  ["wrong-median", value => value.worldAnalysisFindings.findings[0].candidates[0].rankingBasis.rankingValue = -42, "RANKING_BASIS_MISMATCH"],
  ["wrong-statistics", value => value.worldAnalysisFindings.findings[0].candidates[0].statistics.minimum = 0, "STATISTICS_INCONSISTENT"],
  ["wrong-unit", value => value.worldAnalysisFindings.findings[0].selectedSeries.valueUnit = "percent", "METRIC_SERIES_MISMATCH"],
  ["bad-coordinate", value => value.worldAnalysisFindings.findings[0].candidates[0].representativeVisitedPosition.coordinates[0] = 181, "SCHEMA_INVALID"],
  ["altitude", value => value.worldAnalysisFindings.findings[0].candidates[0].representativeVisitedPosition.coordinates.push(0), "SCHEMA_INVALID"],
  ["raw-payload", value => value.evidenceItems[0].safePayload = { internal: "not-public" }, "SCHEMA_INVALID"],
  ["wrong-choice-rank", value => value.worldAnalysisFindings.choices[0].candidates[0].rank = 2, "CHOICE_SOURCE_MISMATCH"]
];
for (const [name, mutate, code] of mutations) { const value = clone(rankingResult); mutate(value); emit(`invalid-${name}`, "result", seal(value), false, code); }
const badAction = result([ranking, action]); badAction.worldAnalysisFindings.findings[1].target = { type: "Point", coordinates: [116.3923, 39.9075] };
emit("invalid-action-position", "result", seal(badAction), false, "ACTION_SOURCE_MISMATCH");
const reversed = result([trace]); reversed.worldAnalysisFindings.findings[0].selectedPeriods[0].end = "2025-01-01T00:00:00Z";
emit("invalid-time-range", "result", seal(reversed), false, "REVERSED_TIME_RANGE");
const badTime = result([event]); badTime.worldAnalysisFindings.findings[0].events[0].extent.estimatedAt = now;
emit("invalid-event-window", "result", seal(badTime), false, "TIME_OUTSIDE_WINDOW");
const subMillis = result([trace]); subMillis.worldAnalysisFindings.findings[0].selectedPeriods = [{ start: "2026-09-05T10:00:00.1239+08:00", end: "2026-09-05T10:00:00.1231+08:00", bounds: "UNSPECIFIED" }];
emit("invalid-sub-millisecond-range", "result", seal(subMillis), false, "REVERSED_TIME_RANGE");
const badProof = result([event]); badProof.worldAnalysisFindings.findings[0].sourceSuffixComplete = false;
emit("invalid-selection-proof", "result", seal(badProof), false, "SELECTION_PROOF_MISSING");
const tampered = clone(rankingResult); tampered.worldAnalysisFindings.findings[0].semanticConcept = "TAMPERED";
emit("invalid-hash", "result", tampered, false, "FINDING_SET_HASH_MISMATCH");
const duplicate = clone(request); duplicate.analysisSelections.push(clone(duplicate.analysisSelections[0]));
emit("invalid-duplicate-selection", "request", duplicate, false, "DUPLICATE_CHOICE_SELECTION");
const missingAnchor = clone(request); missingAnchor.contextCapsule.priorGroundings = [];
emit("invalid-prior-anchor", "request", missingAnchor, false, "PRIOR_ANCHOR_MISMATCH");
const badJob = { ...job, status: "COMPLETED", result: rankingResult };
emit("invalid-job-state", "job", badJob, false, "JOB_RESULT_MISMATCH");
const badCaps = clone(caps); badCaps.worldAnalysis.capabilities[0].available = true;
emit("invalid-capability-reason", "capabilities", badCaps, false, "AVAILABILITY_REASON_MISMATCH");
const manifest = `${JSON.stringify({ schemaVersion: "1.0", source: "ARTIFICIAL_PUBLIC_CONTRACT_SAMPLES_NOT_LIVE_EVIDENCE", examples: samples }, null, 2)}\n`;
const manifestPath = join(directory, "examples/manifest.json");
if (check) { if (readFileSync(manifestPath, "utf8") !== manifest) throw new Error("Example manifest drift"); }
else writeFileSync(manifestPath, manifest);
console.log(`WORLD_ANALYSIS_EXAMPLES_${check ? "CHECK" : "GENERATE"}_PASS cases=${samples.length} positive=${samples.filter(item => item.valid).length} negative=${samples.filter(item => !item.valid).length}`);
