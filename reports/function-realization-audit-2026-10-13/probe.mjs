import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseAdvancedHistoricalIntent, advancedAnalysisRequests, advancedHistoryConfigurationFromEnvironment,
  MetricSemanticCatalog, resolveAdvancedFollowup } from '@wsgs/historical-trace-consumer';
import { verifyDevelopmentRuntime } from '../../validation/scripts/verify-development-runtime.mjs';

const config = advancedHistoryConfigurationFromEnvironment({ WSGS_ADVANCED_HISTORY_ENABLED: 'YES' });
const catalog = new MetricSemanticCatalog();
const parse = (text, prior) => parseAdvancedHistoricalIntent(text, catalog, config, prior);
const key = (kind, id) => ({ namespace: 'gowm', kind, id, version: '1' });
const priorIntent = parse('2号车经过哪些道路，排除暂停').intent;
const trajectoryKey = key('HISTORICAL_TRAJECTORY', 'wrf_audit_trajectory');
const foundation = {
  intent: { ...priorIntent.historicalScope, taskReferenceKey: key('OPERATIONAL_TASK', 'wrf_audit_task'),
    subjectReferenceKey: key('WORLD_OBJECT', 'wrf_audit_subject') },
  reference: { referenceKey: trajectoryKey, referenceType: 'HISTORICAL_TRAJECTORY', revalidationRequired: false,
    validUntil: new Date(Date.now() + 60_000).toISOString() },
  finding: { findingKind: 'HISTORICAL_TRAJECTORY', status: 'COMPLETED', reasonCode: 'TRAJECTORY_AVAILABLE', warnings: [],
    trajectory: { trajectoryReferenceKey: trajectoryKey, finalization: { state: 'SEALED' } } },
};
const followupText = '包含暂停，重新查询经过哪些道路';
const followup = resolveAdvancedFollowup(followupText, { intent: priorIntent, foundation, evidenceItems: [],
  sourceGroundingId: 'controlled-audit', sourceResultHash: 'sha256:' + '0'.repeat(64) }, catalog, config);
const multiSubject = parse('2号车、3号车经过哪些道路');
const multiExecution = parse('第1次任务、第2次任务经过哪些道路');
const missingClause = parse('2号车经过哪些道路，以及行驶是否超速');
const parkingTarget = parse('2号车首次进入停车区是什么时候');

const capabilityDocument = JSON.parse(readFileSync(new URL('../../contracts/wsgs-v0.2.4-world-analysis/examples/capabilities.json', import.meta.url)));
const now = Date.now();
capabilityDocument.requiredCapabilitiesReady = true;
capabilityDocument.worldAnalysis.checkedAt = new Date(now).toISOString();
capabilityDocument.worldAnalysis.validUntil = new Date(now + 5_000).toISOString();
for (const entry of capabilityDocument.worldAnalysis.capabilities) Object.assign(entry, {
  supported: true, available: entry.capability !== 'CROSS', reasonCodes: [entry.capability === 'CROSS' ? 'DEPENDENCY_UNAVAILABLE' : 'AVAILABLE'],
});
const fetcher = async (_url, options = {}) => new Response(JSON.stringify(options.headers?.['WSGS-Contract-Version']
  ? capabilityDocument : { requiredCapabilitiesReady: true }), { status: 200 });
const unifiedSource = readFileSync(new URL('../../deployment/deploy-unified.mjs', import.meta.url), 'utf8');
const probeLiteral = /const probe = ("(?:[^"\\]|\\.)*");/u.exec(unifiedSource)?.[1];
if (!probeLiteral) throw new Error('Current unified deployment probe not found');
const actualProbe = JSON.parse(probeLiteral);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let unifiedPassed = false;
await new AsyncFunction('fetch', 'process', actualProbe)(fetcher, { env: { PORT: '8080' } });
unifiedPassed = true;
let currentVerifierRejected;
try { await verifyDevelopmentRuntime({ environment: { PORT: '8080', WSGS_ADVANCED_HISTORY_ENABLED: 'YES' }, fetcher, now: () => now }); }
catch (error) { currentVerifierRejected = error.message; }

const compound = parse('2号车任务T1第一次进入A区、最后离开B区、在C区停留多久，以及经过哪些道路，通信信号最好的三个位置');
const report = {
  gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  evidenceScope: 'LOCAL_COMPONENT_AND_CONTROLLED_FETCH_ONLY', realModel: 'NOT_RUN', liveBusiness: 'NOT_RUN',
  cases: [
    { id: 'A01', text: followupText, expectedPhaseScope: 'EXECUTION_ENVELOPE',
      actualPhaseScope: followup.resolution.intent?.historicalScope.phaseScope,
      reusablePriorFoundation: Boolean(followup.reusableFoundation), compare: followup.compare },
    { id: 'A02-subject', text: '2号车、3号车经过哪些道路', expected: 'REJECT_MULTI_SUBJECT', actual: multiSubject },
    { id: 'A02-execution', text: '第1次任务、第2次任务经过哪些道路', expected: 'REJECT_MULTI_EXECUTION', actual: multiExecution },
    { id: 'A03', text: '2号车经过哪些道路，以及行驶是否超速', expected: 'UNSUPPORTED_CLAUSE_GAP_OR_REJECT', actual: missingClause },
    { id: 'A04', text: '2号车首次进入停车区是什么时候', expected: 'SINGLE_ENTER_ANALYSIS', actual: parkingTarget },
    { id: 'A05', input: 'HTTP 200 basic readiness/capabilities with CROSS unavailable in 1.2',
      unifiedProbePassed: unifiedPassed, currentDevelopmentVerifierRejected: currentVerifierRejected,
      sourceProbeSha256: createHash('sha256').update(actualProbe).digest('hex') },
  ],
  controls: { supportedSeparatedCompound: compound.status,
    supportedSeparatedCompoundAnalysisCount: compound.status === 'PARSED' ? advancedAnalysisRequests(compound.intent).length : 0,
    absoluteTimeWindow: parse('2号车经过哪些道路，仅限2026-09-01T08:03:00Z至2026-09-01T08:04:00Z'),
    allExecutions: parse('2号车所有任务经过哪些道路'),
    gnssMetric: catalog.resolve('定位质量最好'), vibrationMetric: catalog.resolve('震动最小'),
    combinedMetricScore: catalog.resolve('信号和丢包率最好') },
  credentialsIncluded: false,
};
writeFileSync(new URL('./probe-output.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
