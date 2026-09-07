import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { schemaDocuments } from "./generated/schema-documents.mjs";

export const contractVersion = "sacs-wsgs-grounding/1.2";
export const resultProfile = "wsgs-world-analysis-findings/1.0";

export function isWorldAnalysisTransport(version, profile, authorized) {
  return authorized === true && version === contractVersion && profile === resultProfile;
}

export function aggregateAnalysisStatus(component, cancelled = false) {
  if (cancelled) return "CANCELLED";
  if (component.choices.length) return "AMBIGUOUS";
  const usable = component.findings.some(finding => ["COMPLETED", "PARTIAL", "NO_DATA"].includes(finding.status));
  const blocking = component.gaps.filter(gap => gap.severity !== "INFO");
  if (blocking.some(gap => ["UPSTREAM_CONTRACT_MISMATCH", "UPSTREAM_TIMEOUT", "UPSTREAM_FAILURE"].includes(gap.gapKind))) return usable ? "PARTIAL" : "FAILED";
  if (blocking.some(gap => ["CAPABILITY_UNAVAILABLE", "REFERENCE_MISSING", "REFERENCE_AMBIGUOUS", "TASK_CONTEXT_REQUIRED", "SUBJECT_CONTEXT_REQUIRED", "TARGET_CONTEXT_REQUIRED", "METRIC_UNSUPPORTED", "METRIC_SERIES_AMBIGUOUS", "SELECTION_INVALID", "SELECTION_EXPIRED", "SELECTION_SCOPE_MISMATCH", "SELECTION_AMBIGUOUS", "MULTI_EXECUTION_UNSUPPORTED"].includes(gap.gapKind))) return usable ? "PARTIAL" : "UNRESOLVED";
  if (blocking.length || component.findings.some(finding => ["PARTIAL", "INDETERMINATE"].includes(finding.status))) return "PARTIAL";
  return "COMPLETED";
}

export function canonicalJson(value) {
  const ancestors = new Set();
  function visit(item, inArray = false) {
    if (item === null || typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (item === undefined && !inArray) return undefined;
    if (!item || typeof item !== "object" || ancestors.has(item)) throw new TypeError("Non-JSON canonical input");
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new TypeError("Non-JSON object");
    if (Object.getOwnPropertySymbols(item).length) throw new TypeError("Symbol keys are not JSON");
    ancestors.add(item);
    let text;
    if (Array.isArray(item)) {
      text = `[${Array.from(item, child => visit(child, true)).join(",")}]`;
    } else {
      text = `{${Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => `${JSON.stringify(key)}:${visit(item[key])}`).join(",")}}`;
    }
    ancestors.delete(item);
    return text;
  }
  const text = visit(value);
  if (text === undefined) throw new TypeError("Undefined root");
  return text;
}

export function canonicalHash(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function findingSetHash(component) {
  const { profile, findings, choices, gaps } = component;
  return canonicalHash({ profile, findings, choices, gaps });
}

export function resultHash(result) {
  const { resultHash: omitted, ...value } = result;
  const { elapsedMs: elapsed, ...execution } = value.execution;
  return canonicalHash({ runFingerprint: execution.runFingerprint, status: value.status, value: { ...value, execution } });
}

export function createPublicValidator() {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  addFormats(ajv);
  for (const document of schemaDocuments) ajv.addSchema(document);
  const validators = new Map(schemaDocuments.map(document => [document.$id, ajv.getSchema(document.$id)]));
  return function validate(kind, value, options = {}) {
    const id = kind.startsWith("urn:") ? kind : `urn:wsgs:grounding:1.2:${kind}`;
    const validator = validators.get(id);
    if (!validator) return { valid: false, errors: [{ code: "UNKNOWN_SCHEMA", path: "" }] };
    if (!validator(value)) return { valid: false, errors: validator.errors.map(error => ({ code: "SCHEMA_INVALID", path: error.instancePath, keyword: error.keyword })) };
    const errors = [];
    const fail = (code, path) => errors.push({ code, path });
    try {
      canonicalJson(value);
      if (kind === "request" || id.endsWith(":1.2:request")) validateRequest(value, fail);
      if (kind === "result" || id.endsWith(":1.2:result")) validateResult(value, fail, options);
      if (kind === "job" || id.endsWith(":1.2:job")) {
        if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) fail("REVERSED_JOB_TIME", "/updatedAt");
        if (value.result) {
          const nested = validate("result", value.result, options);
          errors.push(...nested.errors.map(error => ({ ...error, path: `/result${error.path}` })));
          if (value.result.groundingId !== value.groundingId || value.result.requestId !== value.requestId || value.result.status !== value.status) fail("JOB_RESULT_MISMATCH", "/result");
        }
      }
      if (kind === "capabilities" || id.endsWith(":1.2:capabilities")) {
        unique(value.worldAnalysis.capabilities, "capability", "/worldAnalysis/capabilities", fail);
        for (const [index, capability] of value.worldAnalysis.capabilities.entries()) {
          const available = capability.reasonCodes.length === 1 && capability.reasonCodes[0] === "AVAILABLE";
          if (available !== capability.available || (!capability.available && capability.reasonCodes.includes("AVAILABLE"))) fail("AVAILABILITY_REASON_MISMATCH", `/worldAnalysis/capabilities/${index}`);
        }
        if (Date.parse(value.worldAnalysis.validUntil) < Date.parse(value.worldAnalysis.checkedAt)) fail("REVERSED_TIME_RANGE", "/worldAnalysis/validUntil");
      }
    } catch {
      fail("NON_JSON_VALUE", "");
    }
    return { valid: errors.length === 0, errors };
  };
}

function unique(items, key, path, fail) {
  const seen = new Set();
  for (const [index, item] of items.entries()) {
    if (seen.has(item[key])) fail("DUPLICATE_ID", `${path}/${index}/${key}`);
    seen.add(item[key]);
  }
  return new Map(items.map(item => [item[key], item]));
}

function validateRequest(request, fail) {
  const selected = new Set();
  for (const [index, selection] of (request.analysisSelections ?? []).entries()) {
    const path = `/analysisSelections/${index}`;
    const key = `${selection.priorGroundingId}\0${selection.choiceId}`;
    if (selected.has(key)) fail("DUPLICATE_CHOICE_SELECTION", path);
    selected.add(key);
    const anchors = (request.contextCapsule.priorGroundings ?? []).filter(prior => prior.groundingId === selection.priorGroundingId);
    if (anchors.length !== 1 || anchors[0].resultHash !== selection.priorResultHash) fail("PRIOR_ANCHOR_MISMATCH", path);
  }
}

function validateResult(result, fail, options) {
  if (Buffer.byteLength(JSON.stringify(result)) > Math.min(options.maxResultBytes ?? 1048576, 1048576)) fail("RESULT_TOO_LARGE", "");
  const component = result.worldAnalysisFindings;
  const products = unique(result.referenceProducts, "productId", "/referenceProducts", fail);
  const evidence = unique(result.evidenceItems, "evidenceProductId", "/evidenceItems", fail);
  const findings = unique(component.findings, "findingId", "/worldAnalysisFindings/findings", fail);
  unique(component.choices, "choiceId", "/worldAnalysisFindings/choices", fail);
  unique(component.gaps, "gapId", "/worldAnalysisFindings/gaps", fail);
  if (component.findingSetHash !== findingSetHash(component)) fail("FINDING_SET_HASH_MISMATCH", "/worldAnalysisFindings/findingSetHash");
  if (result.resultHash !== resultHash(result)) fail("RESULT_HASH_MISMATCH", "/resultHash");
  function reference(id, map, path) {
    if (id !== undefined && !map.has(id)) fail("DANGLING_REFERENCE", path);
  }
  function walk(item, path) {
    if (!item || typeof item !== "object") return;
    if (typeof item.start === "string" && typeof item.end === "string" && instant(item.start) > instant(item.end)) fail("REVERSED_TIME_RANGE", path);
    if (item.estimatedAt && item.timeWindow && (instant(item.estimatedAt) < instant(item.timeWindow.start) || instant(item.estimatedAt) > instant(item.timeWindow.end))) fail("TIME_OUTSIDE_WINDOW", path);
    if (item.sourceCount !== undefined && item.returnedCount !== undefined && (item.sourceCount < item.returnedCount || (!item.truncated && item.sourceCount !== item.returnedCount))) fail("DISPLAY_COUNT_MISMATCH", path);
    for (const [key, child] of Object.entries(item)) walk(child, `${path}/${key}`);
  }
  walk(component, "/worldAnalysisFindings");
  for (const [index, finding] of component.findings.entries()) {
    const path = `/worldAnalysisFindings/findings/${index}`;
    for (const id of finding.subjectReferenceProductIds) reference(id, products, `${path}/subjectReferenceProductIds`);
    for (const id of finding.evidenceIds) reference(id, evidence, `${path}/evidenceIds`);
    for (const key of ["taskReferenceProductId", "executionIntervalReferenceProductId", "trajectoryReferenceProductId"]) reference(finding[key], products, `${path}/${key}`);
    if (finding.findingKind === "ROAD_ASSOCIATION") {
      const visits = unique(finding.roadVisits, "visitId", `${path}/roadVisits`, fail);
      if (finding.lastConfirmedRoad) reference(finding.lastConfirmedRoad.visitId, visits, `${path}/lastConfirmedRoad/visitId`);
    }
    if (finding.findingKind === "TEMPORAL_EVENT") {
      const events = unique(finding.events, "eventId", `${path}/events`, fail);
      for (const event of finding.events) {
        if (!finding.eventTypes.includes(event.eventType)) fail("EVENT_TYPE_MISMATCH", path);
        for (const id of event.evidenceIds) reference(id, evidence, `${path}/events/evidenceIds`);
        reference(event.target?.referenceProductId, products, `${path}/events/target/referenceProductId`);
      }
      if (finding.selection) {
        reference(finding.selection.selectedEventId, events, `${path}/selection/selectedEventId`);
        if (finding.selection.confirmed && !finding.selection.selectedEventId) fail("SELECTION_PROOF_MISSING", `${path}/selection`);
        const expectedReason = `${finding.selection.kind}_EVENT_${finding.selection.confirmed ? "CONFIRMED" : "NOT_CERTAIN"}`;
        if (finding.selection.reasonCode !== expectedReason && !(finding.selection.reasonCode === "NO_EVENT_FOUND" && !finding.selection.confirmed && !finding.selection.selectedEventId)) fail("SELECTION_REASON_MISMATCH", `${path}/selection`);
        if (finding.selection.confirmed !== (finding.selection.confirmationScope !== "NOT_CONFIRMED")) fail("SELECTION_SCOPE_MISMATCH", `${path}/selection`);
        if (finding.selection.confirmationScope === "REQUESTED_SCOPE_PROVEN" && (finding.selection.blockingPeriods.length || (finding.selection.kind === "FIRST" ? !finding.sourcePrefixComplete : !finding.sourceSuffixComplete))) fail("SELECTION_PROOF_MISSING", `${path}/selection`);
      }
    }
    if (finding.findingKind === "METRIC_RANKING") {
      unique(finding.candidates, "candidateId", `${path}/candidates`, fail);
      unique(finding.candidates, "rank", `${path}/candidates`, fail);
      if (finding.selectedSeries && (finding.selectedSeries.observedProperty !== finding.metric.observedProperty || finding.selectedSeries.measurementStage !== finding.metric.measurementStage || finding.selectedSeries.valueUnit !== finding.metric.unit)) fail("METRIC_SERIES_MISMATCH", `${path}/selectedSeries`);
      let prior;
      for (const candidate of finding.candidates) {
        const stats = candidate.statistics;
        if (candidate.sampleCount !== stats.sampleCount || candidate.rankingBasis.rankingValue !== stats.median || candidate.rankingBasis.optimizationDirection !== finding.metric.optimizationDirection) fail("RANKING_BASIS_MISMATCH", `${path}/candidates`);
        if (stats.minimum > stats.maximum || [stats.mean, stats.median, stats.p25, stats.p75, candidate.representativeValue].some(value => value !== undefined && (value < stats.minimum || value > stats.maximum)) || (stats.p25 !== undefined && stats.p25 > stats.median) || (stats.p75 !== undefined && stats.p75 < stats.median)) fail("STATISTICS_INCONSISTENT", `${path}/candidates`);
        if (prior && (candidate.rank <= prior.rank || (finding.metric.optimizationDirection === "MAXIMIZE" ? stats.median > prior.statistics.median : stats.median < prior.statistics.median))) fail("RANK_ORDER_MISMATCH", `${path}/candidates`);
        prior = candidate;
      }
    }
    if (finding.findingKind === "ACTION_TARGET_CANDIDATE") {
      const source = findings.get(finding.sourceFindingId);
      const candidate = source?.findingKind === "METRIC_RANKING" && source.candidates.find(item => item.candidateId === finding.sourceCandidateId);
      if (!candidate || candidate.rank !== finding.sourceRank || canonicalJson(candidate.representativeVisitedPosition) !== canonicalJson(finding.target) || candidate.representativeObservedAt !== finding.representativeObservedAt || candidate.representativeMeasurementId !== finding.representativeMeasurementId || canonicalJson(source.subjectReferenceProductIds) !== canonicalJson(finding.subjectReferenceProductIds) || source.evidenceIds.some(id => !finding.evidenceIds.includes(id))) fail("ACTION_SOURCE_MISMATCH", path);
    }
  }
  for (const [index, choice] of component.choices.entries()) {
    const path = `/worldAnalysisFindings/choices/${index}`;
    reference(choice.sourceFindingId, findings, `${path}/sourceFindingId`);
    unique(choice.candidates, "candidateId", `${path}/candidates`, fail);
    for (const candidate of choice.candidates) {
      reference(candidate.referenceProductId, products, `${path}/candidates/referenceProductId`);
      reference(candidate.findingId, findings, `${path}/candidates/findingId`);
      const finding = findings.get(candidate.findingId);
      if (choice.choiceKind === "RANKED_LOCATION_SELECTION" && (finding?.findingKind !== "METRIC_RANKING" || !finding.candidates.some(item => item.candidateId === candidate.candidateId && item.rank === candidate.rank))) fail("CHOICE_SOURCE_MISMATCH", path);
      if (choice.choiceKind === "EVENT_SELECTION" && (finding?.findingKind !== "TEMPORAL_EVENT" || !finding.events.some(item => item.eventId === candidate.eventId))) fail("CHOICE_SOURCE_MISMATCH", path);
    }
  }
  for (const gap of component.gaps) {
    if (gap.gapKind !== gap.messageCode) fail("GAP_MESSAGE_MISMATCH", "/worldAnalysisFindings/gaps/messageCode");
    if (["CURRENT_VALIDATION_REQUIRED", "ROUTE_PLANNING_REQUIRED", "EXECUTION_CONFIRMATION_REQUIRED", "EXECUTION_NOT_AUTHORIZED"].includes(gap.gapKind) && gap.severity !== "INFO") fail("ACTION_LIMIT_SEVERITY", "/worldAnalysisFindings/gaps/severity");
    for (const id of gap.findingIds) reference(id, findings, "/worldAnalysisFindings/gaps/findingIds");
    for (const id of gap.evidenceIds) reference(id, evidence, "/worldAnalysisFindings/gaps/evidenceIds");
  }
}

// Compare all retained fractional digits instead of rounding both instants to ms.
function instant(value) {
  const fraction = value.match(/\.(\d+)(?=Z|[+-]\d{2}:\d{2}$)/)?.[1] ?? "";
  const seconds = Date.parse(value.replace(/\.\d+(?=Z|[+-]\d{2}:\d{2}$)/, "")) / 1000;
  if (!Number.isFinite(seconds)) throw new TypeError("Unsupported instant");
  return BigInt(seconds) * 10n ** 64n + BigInt(fraction.padEnd(64, "0"));
}
