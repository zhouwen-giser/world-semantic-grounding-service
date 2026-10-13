import { pathToFileURL } from 'node:url';
import { createWorldAnalysisValidator } from '../../packages/contracts/dist/index.js';

export function developmentReadinessTimeoutMs(environment = process.env) {
  if ((environment.WSGS_MODEL_POLICY || 'MODEL_REQUIRED') !== 'MODEL_REQUIRED') return 15_000;
  const modelBudget = Number(environment.MODEL_TIMEOUT_MS || '30000');
  if (!Number.isSafeInteger(modelBudget) || modelBudget < 100 || modelBudget > 300_000) throw new Error('DEVELOPMENT_MODEL_READINESS_CONFIG_INVALID');
  // The adapter's total budget already includes retries; retain time for DB/Gateway checks.
  return modelBudget + 15_000;
}

/** Readiness and capability access only; this never submits a business query. */
export async function verifyDevelopmentRuntime({ environment = process.env, fetcher = fetch, now = Date.now } = {}) {
  const base = `http://127.0.0.1:${environment.PORT || '8080'}`;
  const readinessTimeout = developmentReadinessTimeoutMs(environment);
  const get = async (path, headers = {}) => {
    const response = await fetcher(base + path, { headers, signal: AbortSignal.timeout(readinessTimeout) });
    if (!response.ok) throw new Error(`DEVELOPMENT_PROBE_HTTP_FAILURE ${path} HTTP ${response.status}`);
    return response.json();
  };
  await get('/health/ready');
  const ordinary = await get('/v1/capabilities');
  if (ordinary.requiredCapabilitiesReady !== true) throw new Error('DEVELOPMENT_REQUIRED_CAPABILITIES_UNAVAILABLE');
  if (!['YES', 'true'].includes(environment.WSGS_ADVANCED_HISTORY_ENABLED)) return { serviceReady: true, advancedCapabilities: 'DISABLED', businessAcceptance: 'NOT_RUN' };
  const capabilities = await get('/v1/capabilities', { 'WSGS-Contract-Version': 'sacs-wsgs-grounding/1.2', 'WSGS-Result-Profile': 'wsgs-world-analysis-findings/1.0' });
  if (!createWorldAnalysisValidator()('capabilities', capabilities).valid) throw new Error('DEVELOPMENT_ANALYSIS_CAPABILITIES_INVALID');
  if (capabilities.requiredCapabilitiesReady !== true || Date.parse(capabilities.worldAnalysis.validUntil) <= now()) throw new Error('DEVELOPMENT_ANALYSIS_SNAPSHOT_UNAVAILABLE');
  const required = ['HISTORICAL_TRACE', 'ROAD_ASSOCIATION', 'TEMPORAL_EVENT', 'CROSS', 'METRIC_RANKING', 'ACTION_TARGET_CANDIDATE'];
  const unavailable = required.filter(name => !capabilities.worldAnalysis.capabilities.some(entry => entry.capability === name && entry.supported === true && entry.available === true));
  if (unavailable.length) throw new Error('DEVELOPMENT_ANALYSIS_CAPABILITIES_UNAVAILABLE ' + unavailable.join(','));
  return { serviceReady: true, advancedCapabilities: 'READY', businessAcceptance: 'NOT_RUN' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyDevelopmentRuntime().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
