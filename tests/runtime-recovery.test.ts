import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Aes256GcmPayloadCodec, canonicalSha256, utf8Sha256 } from '@wsgs/grounding-pipeline';
import { createGroundingIdentity } from '@wsgs/delegated-identity';
import { GowmGatewayClient, GatewayProtocolError } from '@wsgs/gowm-gateway-client';
import { TypedWorldQueryCompiler } from '../packages/query-compiler/src/compiler.js';
import { compileInput } from '../packages/query-compiler/src/test-fixtures.js';
import { createPipelineStageExecutor, mergeKnownReferenceProducts } from '../services/grounding-worker/src/production-module.js';

// These cases test control flow after authority validation, not authority correctness.
vi.mock('@wsgs/trusted-capability-snapshot', async (importOriginal) => ({
  ...await importOriginal<typeof import('@wsgs/trusted-capability-snapshot')>(),
  verifyPersistedTrustedCapabilitySnapshot: vi.fn()
}));

const hash = (char: string) => `sha256:${char.repeat(64)}`;
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  .export({ type: 'pkcs8', format: 'pem' }).toString();
const identity = {
  ...createGroundingIdentity({ servicePrincipalId: 'review-service', actorId: 'review-actor',
    dataScopes: ['review-scope'], datasetScopes: [], permissions: ['grounding.read'] }),
  dataScope: 'review-scope'
};
const key = { namespace: 'gowm', kind: 'SPATIAL_OBJECT', id: `wrf_${'a'.repeat(32)}`, version: 'v1' };
const lock = { operationId: 'reference.validate', operationVersion: '1.0',
  maturity: 'STABLE', inputSchemaHash: hash('1'), outputSchemaHash: hash('2'),
  semanticProfileHash: hash('3'), snapshotSupport: 'CONSISTENT_AT_START', requiredPermissions: [] };
const authority = {
  schemaVersion: '1.0', trustedCapabilitySnapshot: {},
  capabilityCatalog: { capabilities: [{ ...lock, limits: {}, execution: {
    mode: 'SYNC', maximumTimeoutMs: 10_000, costClass: 'LOW' } }] },
  semanticCatalog: {}, availability: {}, southboundLock: { defaultOperations: [lock], previewOperations: [] }
};
const sourceText = 'review text';
const request = {
  schemaVersion: '1.0', requestId: 'request-review', operation: 'EXECUTE_WORLD_QUERY',
  source: { originalText: sourceText, originalTextSha256: utf8Sha256(sourceText), messageId: 'message-review' },
  executionPolicy: { readOnly: true, deadlineMs: 5_000, maxResultBytes: 1_048_576 },
  requestedProducts: ['WORLD_EVIDENCE'], contextCapsule: { knownWorldReferences: [] }
};

function context(state: Record<string, unknown> = {}) {
  return {
    jobId: 'job-review', groundingId: 'grounding-review', leaseToken: 'lease-review', generation: 1,
    operation: 'EXECUTE_WORLD_QUERY', deadlineAt: new Date(Date.now() + 60_000),
    signal: new AbortController().signal, immutableLocks: authority,
    state: { identity, request, idempotencyKey: 'idem-review', ...state }
  } as any;
}

async function stageExecutor() {
  const client = { query: vi.fn(async () => ({ rowCount: 1, rows: [{}] })), release: vi.fn() };
  const pool = { connect: vi.fn(async () => client) };
  return createPipelineStageExecutor({ pool: pool as any });
}

beforeEach(() => {
  // Never read deployment credentials or issue a real network call.
  for (const name of ['GOWM_SOUTHBOUND_LOCK_FILE', 'GOWM_SOUTHBOUND_LOCK_SHA256',
    'WSGS_GDPS_RECIPE_LOCK_FILE', 'WSGS_GDPS_RECIPE_LOCK_SHA256', 'WSGS_GDPS_PREVIEW_RECIPE_ALLOWLIST',
    'WSGS_CROSS_SCOPE_GATEWAY_ROUTING', 'WSGS_GDPS_CONSUMER_SNAPSHOT_FILE',
    'WSGS_GDPS_DESCRIPTOR_REGISTRY_FILE', 'MODEL_BASE_URL', 'MODEL_API_KEY', 'MODEL_NAME']) vi.stubEnv(name, '');
  vi.stubEnv('WSGS_MODEL_POLICY', 'MODEL_OPTIONAL');
  vi.stubEnv('GOWM_GATEWAY_BASE_URL', 'http://127.0.0.1:1');
  vi.stubEnv('GOWM_GATEWAY_TOKEN', 'review-only-placeholder');
  vi.stubEnv('GOWM_DELEGATION_ISSUER', 'review-issuer');
  vi.stubEnv('GOWM_DELEGATION_AUDIENCE', 'review-audience');
  vi.stubEnv('GOWM_DELEGATION_SERVICE_PRINCIPAL_ID', identity.servicePrincipalId);
  vi.stubEnv('GOWM_DELEGATION_PRIVATE_KEY_PKCS8', privateKey);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('REVIEW_NETWORK_FORBIDDEN'); }));
  vi.spyOn(GowmGatewayClient.prototype, 'validateTrustedContracts').mockReturnValue({ requiredReady: true } as any);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('production stage checkpoint recovery and upstream retry', () => {
  it('deduplicates equivalent recovered reference keys while retaining distinct versions', () => {
    const resolved = mergeKnownReferenceProducts(undefined, [{ referenceKey: key, referenceType: 'WORLD_OBJECT' }]);
    const recovered = JSON.parse(JSON.stringify(resolved));
    recovered.referenceProducts[0].referenceKey = { id: key.id, version: key.version, kind: key.kind, namespace: key.namespace };
    const merged = mergeKnownReferenceProducts(recovered, [
      { referenceKey: key, referenceType: 'WORLD_OBJECT' },
      { referenceKey: { ...key, version: 'v2' }, referenceType: 'WORLD_OBJECT' }
    ]);
    expect(merged.referenceProducts).toHaveLength(2);
    expect(merged.referenceProducts.map((item) => item.referenceKey.version)).toEqual(['v1', 'v2']);
  });

  it('different idempotency keys must not collide in globally keyed world_query rows', () => {
    const input = compileInput('REFERENCE_CURRENT_STATE');
    const first = new TypedWorldQueryCompiler().compile({ ...input, idempotencyKey: 'actor-a-key' });
    const second = new TypedWorldQueryCompiler().compile({ ...input, idempotencyKey: 'actor-b-key' });
    expect(first.status).toBe('COMPILED');
    expect(second.status).toBe('COMPILED');
    if (first.status === 'COMPILED' && second.status === 'COMPILED') {
      expect(first.submission.plan.queryId).not.toBe(second.submission.plan.queryId);
    }
  });

  it('REFERENCE_VALIDATE should also match references recovered through the actual checkpoint codec', async () => {
    const resolved = mergeKnownReferenceProducts(undefined, [{ referenceKey: key, referenceType: 'WORLD_OBJECT', alias: 'vehicle' }]);
    vi.spyOn(GowmGatewayClient.prototype, 'executeOperation').mockResolvedValue({ status: 200, value: {
      operation: { operationId: lock.operationId, operationVersion: lock.operationVersion },
      status: 'COMPLETED', computeSnapshot: { operation: lock, schemas: lock },
      output: { schemaHash: lock.outputSchemaHash, value: { schemaVersion: '1.0', results: [{
        referenceKey: key, existence: 'AVAILABLE', freshness: 'CURRENT', usable: 'YES', snapshot: 'CURRENT', reasons: []
      }] } }
    } });
    const executor = await stageExecutor();
    const normal = context({ REFERENCE_RESOLVE: resolved });
    await expect(executor.execute('REFERENCE_VALIDATE', normal)).resolves.toHaveProperty('referenceProducts');
    const codec = new Aes256GcmPayloadCodec(new Uint8Array(32).fill(23));
    const cipherContext = { jobId: normal.jobId, runFingerprint: hash('f') };
    const ciphertext = await codec.sealCheckpoint({ ...cipherContext, state: normal.state } as any);
    const recoveredState = JSON.parse(new TextDecoder().decode(await codec.openCheckpoint(ciphertext, cipherContext)));
    expect(canonicalSha256(recoveredState)).toBe(canonicalSha256(normal.state));
    const recovered = await executor.execute('REFERENCE_VALIDATE', { ...normal, state: recoveredState })
      .then((value) => ({ value, errorCode: undefined }), (error) => ({ errorCode: error.code }));
    expect(recovered.errorCode).toBeUndefined();
  });

  it('a transient async polling failure must not cancel the upstream job before retry', async () => {
    const compiled = new TypedWorldQueryCompiler().compile(compileInput('REFERENCE_CURRENT_STATE'));
    expect(compiled.status).toBe('COMPILED');
    if (compiled.status !== 'COMPILED') return;
    vi.spyOn(GowmGatewayClient.prototype, 'submitWorldQuery').mockResolvedValue({ status: 202, value: {
      jobId: 'gateway-job-review', queryId: compiled.submission.plan.queryId, status: 'QUEUED'
    } });
    vi.spyOn(GowmGatewayClient.prototype, 'pollJob').mockRejectedValue(new GatewayProtocolError('HTTP_503', 503, true));
    const cancel = vi.spyOn(GowmGatewayClient.prototype, 'cancelWorldQuery').mockResolvedValue({});
    const executor = await stageExecutor();
    await expect(executor.execute('GOWM_EXECUTE', context({ WORLD_QUERY_COMPILE: { compiled: [compiled] } })))
      .rejects.toMatchObject({ code: 'HTTP_503', retryable: true });
    expect(cancel.mock.calls.length).toBe(0);
  });

  it.each([
    ['WORKER_JOB_CANCELLED', true],
    ['WORKER_LEASE_LOST', false],
    ['WORKER_SHUTDOWN', false],
    ['PIPELINE_STAGE_ATTEMPT_TIMEOUT', false],
    ['PIPELINE_CANCELLED', true]
  ])('handles %s after async acceptance without destroying resumable work', async (code, shouldCancel) => {
    const compiled = new TypedWorldQueryCompiler().compile(compileInput('REFERENCE_CURRENT_STATE'));
    expect(compiled.status).toBe('COMPILED');
    if (compiled.status !== 'COMPILED') return;
    vi.spyOn(GowmGatewayClient.prototype, 'submitWorldQuery').mockResolvedValue({ status: 202, value: {
      jobId: 'gateway-job-review', queryId: compiled.submission.plan.queryId, status: 'QUEUED'
    } });
    const controller = new AbortController();
    const interruption = Object.assign(new Error(code), { code });
    vi.spyOn(GowmGatewayClient.prototype, 'pollJob').mockImplementation(async () => {
      controller.abort(interruption);
      throw interruption;
    });
    const cancel = vi.spyOn(GowmGatewayClient.prototype, 'cancelWorldQuery').mockResolvedValue({});
    const executor = await stageExecutor();
    await expect(executor.execute('GOWM_EXECUTE', {
      ...context({ WORLD_QUERY_COMPILE: { compiled: [compiled] } }), signal: controller.signal
    })).rejects.toBe(interruption);
    expect(cancel).toHaveBeenCalledTimes(shouldCancel ? 1 : 0);
  });

});
