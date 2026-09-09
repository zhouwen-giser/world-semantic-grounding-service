// Run inside the diagnostic API image with its private environment.
// Only identifiers, status/error codes and validation outcomes are printed.
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import pg from 'pg';
import { createWorldAnalysisValidator } from '../../packages/contracts/dist/index.js';
import { utf8Sha256 } from '../../packages/grounding-pipeline/dist/index.js';

const e = process.env, base = e.WSGS_TEST_API_URL ?? 'http://grounding-api:8080';
const validate = createWorldAnalysisValidator(), cases = [];
const sign = async (overrides = {}) => new SignJWT({
  actorId: 'wsgs-instance-test', dataScopes: [e.WSGS_READINESS_DATA_SCOPE],
  datasetScopes: (e.WSGS_READINESS_DATASET_SCOPES ?? '').split(',').filter(Boolean),
  permissions: ['grounding.read', 'data:read', 'dataset:read', 'gateway:execute'], ...overrides
}).setProtectedHeader({ alg: 'HS256' }).setSubject('wsgs-consumer')
  .setIssuer(e.WSGS_JWT_ISSUER).setAudience(e.WSGS_JWT_AUDIENCE ?? 'wsgs')
  .setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(e.WSGS_JWT_HS256_SECRET));
const token = await sign();
const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json',
  'WSGS-Contract-Version': 'sacs-wsgs-grounding/1.2', 'WSGS-Result-Profile': 'wsgs-world-analysis-findings/1.0' };
const emit = item => { cases.push(item); console.log(JSON.stringify({ case: item })); };
async function call(path, options = {}) {
  const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(15000), ...options });
  const bytes = await response.text();
  let value;
  try { value = JSON.parse(bytes); } catch { value = {}; }
  return { status: response.status, value, bytes };
}
// Candidate discovery reads public results only, never decrypts historical text.
const pool = new pg.Pool({ connectionString: e.DATABASE_URL, max: 1, connectionTimeoutMillis: 3000 });
let candidates;
try {
  await pool.query('BEGIN READ ONLY');
  await pool.query("SET LOCAL statement_timeout='3s'");
  candidates = (await pool.query(
    "SELECT result.grounding_id, result.result_bytes, request.source_expires_at FROM wsgs.grounding_result result JOIN wsgs.grounding_request request USING(grounding_id) WHERE request.actor_id=$1 AND request.principal_id=$2 AND request.data_scope=$3 ORDER BY request.created_at DESC LIMIT 100",
    ['wsgs-instance-test', 'wsgs-consumer', e.WSGS_READINESS_DATA_SCOPE])).rows
    .flatMap(row => {
      const result = JSON.parse(Buffer.from(row.result_bytes).toString());
      return (result.worldAnalysisFindings?.choices ?? []).map(choice => ({ row, result, choice,
        expired: Math.min(new Date(row.source_expires_at).getTime(), Date.parse(choice.validUntil)) <= Date.now() }));
    });
} finally { await pool.query('ROLLBACK').catch(() => undefined); await pool.end(); }

for (const expired of [false]) {
  const name = expired ? 'EXPIRED_SELECTION' : 'LIVE_SELECTION';
  const prior = candidates.find(item => item.expired === expired &&
    ['RANKED_LOCATION_SELECTION', 'EVENT_SELECTION'].includes(item.choice.choiceKind) && item.choice.candidates.length > 0);
  if (!prior) { emit({ name, outcome: 'NOT_RUN', reason: expired ? 'NO_STORED_EXPIRED_CHOICE' : 'NO_LIVE_ANALYSIS_CHOICE' }); continue; }
  const fetched = await call('/v1/groundings/' + prior.result.groundingId);
  const result = fetched.value.result ?? fetched.value;
  if (fetched.status !== 200 || !validate('result', result).valid || result.resultHash !== prior.result.resultHash) {
    emit({ name, outcome: 'FAIL', reason: 'PRIOR_RESULT_NOT_READABLE', status: fetched.status }); continue;
  }
  const choice = result.worldAnalysisFindings.choices.find(value => value.choiceId === prior.choice.choiceId);
  const candidate = choice.candidates[0];
  const sourceText = choice.choiceKind === 'RANKED_LOCATION_SELECTION' ? '返回刚才第一个信号较好的位置' : '返回刚才第一个停车位置';
  const request = { schemaVersion: '1.0', requestId: 'boundary-' + randomUUID(), operation: 'EXECUTE_WORLD_QUERY',
    source: { conversationRef: 'boundary-' + randomUUID(), messageId: randomUUID(), originalText: sourceText,
      originalTextSha256: utf8Sha256(sourceText), locale: 'zh-CN', createdAt: new Date().toISOString() },
    requestedProducts: ['WORLD_EVIDENCE'],
    contextCapsule: { knownWorldReferences: [], priorGroundings: [{ groundingId: result.groundingId,
      resultHash: result.resultHash, selectedProductIds: [] }], mapSelections: [], externalCorrelationHints: [], externalPredicates: [] },
    executionPolicy: { readOnly: true, deadlineMs: 120000, maxQueryOperations: 16, maxCandidatesPerMention: 5, maxResultBytes: 1048576, allowApproximation: false },
    analysisSelections: [{ priorGroundingId: result.groundingId, priorResultHash: result.resultHash,
      findingSetHash: result.worldAnalysisFindings.findingSetHash, choiceId: choice.choiceId, candidateId: candidate.candidateId }] };
  if (!validate('request', request).valid) throw new Error('BOUNDARY_REQUEST_INVALID');
  const key = randomUUID(), started = Date.now();
  let response = await call('/v1/groundings', { method: 'POST',
    headers: { ...headers, 'idempotency-key': key, prefer: 'respond-async' }, body: JSON.stringify(request) });
  const groundingId = response.value.groundingId;
  while (groundingId && ['ACCEPTED', 'RUNNING'].includes(response.value.status) && Date.now() - started < 135000) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    response = await call('/v1/groundings/' + groundingId);
  }
  const terminal = response.value.result ?? response.value;
  const code = terminal.error?.code;
  const replay = await call('/v1/groundings', { method: 'POST', headers: { ...headers, 'idempotency-key': key }, body: JSON.stringify(request) });
  const replayMatches = JSON.stringify(replay.value) === JSON.stringify(terminal);
  const gaps = terminal.worldAnalysisFindings?.gaps ?? [];
  const validResult = Boolean(terminal.resultHash && validate('result', terminal).valid);
  const passed = expired ? code === 'SELECTION_EXPIRED'
    : validResult && !gaps.some(gap => gap.severity === 'BLOCKING') && terminal.worldAnalysisFindings.findings.length > 0;
  emit({ name, groundingId, priorGroundingId: result.groundingId, status: terminal.status,
    code, elapsedMs: Date.now() - started, validResult, replayMatches, outcome: passed && replayMatches ? 'PASS' : 'FAIL' });

}
console.log(JSON.stringify({ outcome: cases.every(item => item.outcome === 'PASS') ? 'PASS' : 'INCOMPLETE', cases }));
if (cases.some(item => item.outcome === 'FAIL')) process.exitCode = 1;
