// Read-only replay of an existing model input. No public job or result is changed.
import { createHash } from 'node:crypto';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { Aes256GcmPayloadCodec, canonicalSha256 } from '../../packages/grounding-pipeline/dist/index.js';
import { OpenAICompatibleSemanticModel, semanticModelConfigFromEnvironment, compileWorldSemanticFrameSchema } from '../../packages/semantic-model/dist/index.js';

const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const emit = value => console.log(JSON.stringify({ observedAt: new Date().toISOString(), ...value }));
const groundingId = process.argv[2];
const budgetMs = Number(process.argv[3] ?? 180000);
if (!/^grounding-[a-z0-9-]+$/.test(groundingId ?? '') || !Number.isSafeInteger(budgetMs) || budgetMs < 1000 || budgetMs > 300000)
  throw new Error('DIAGNOSTIC_ARGUMENT_INVALID');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
let input;
try {
  await pool.query("BEGIN READ ONLY");
  await pool.query("SET LOCAL statement_timeout='3s'");
  const { rows } = await pool.query(
    'SELECT r.request_id, r.source_expires_at, r.source_text_ciphertext, c.job_id, c.run_fingerprint, c.state_ciphertext, c.state_hash FROM wsgs.grounding_request r JOIN wsgs.pipeline_checkpoint c USING(grounding_id) WHERE r.grounding_id=$1', [groundingId]);
  const row = rows[0];
  if (!row?.source_text_ciphertext || !row.state_ciphertext) throw new Error('DIAGNOSTIC_SOURCE_ALREADY_CLEANED');
  if (new Date(row.source_expires_at).getTime() <= Date.now()) throw new Error('DIAGNOSTIC_SOURCE_EXPIRED');
  const codec = Aes256GcmPayloadCodec.fromBase64(process.env.WSGS_REQUEST_ENCRYPTION_KEY_BASE64);
  const request = JSON.parse(Buffer.from(await codec.openRequest(row.source_text_ciphertext, { groundingId, requestId: row.request_id })).toString());
  const state = JSON.parse(Buffer.from(await codec.openCheckpoint(row.state_ciphertext, { jobId: row.job_id, runFingerprint: row.run_fingerprint })).toString());
  if (canonicalSha256(state) !== row.state_hash) throw new Error('DIAGNOSTIC_CHECKPOINT_HASH_MISMATCH');
  const deterministic = state.DETERMINISTIC_PARSE;
  if (!deterministic?.mentions || typeof request.source?.originalText !== 'string') throw new Error('DIAGNOSTIC_INPUT_MISSING');
  if (hash(request.source.originalText) !== request.source.originalTextSha256) throw new Error('DIAGNOSTIC_SOURCE_HASH_MISMATCH');
  input = { sourceText: request.source.originalText,
    ...(typeof request.source.locale === 'string' ? { locale: request.source.locale } : {}),
    excludedSpans: deterministic.mentions.map(mention => mention.span) };
} catch (error) {
  emit({ event: 'diagnostic_setup_failed', code: /^DIAGNOSTIC_[A-Z_]+$/.test(error.message) ? error.message : 'DIAGNOSTIC_SETUP_FAILED' });
  process.exitCode = 1;
} finally { await pool.query('ROLLBACK').catch(() => undefined); await pool.end(); }
if (!input) process.exit(1);
const config = semanticModelConfigFromEnvironment({ ...process.env, MODEL_TIMEOUT_MS: String(budgetMs) });
let attempts = 0;
const began = Date.now();
const measuredFetch = async (url, init) => {
  const attempt = ++attempts, started = Date.now();
  emit({ event: 'model_attempt_started', attempt, elapsedMs: started - began, requestHash: hash(String(init.body)) });
  try {
    const response = await fetch(url, init);
    const headersMs = Date.now() - started;
    const upstreamId = response.headers.get('x-request-id') ?? response.headers.get('request-id');
    emit({ event: 'model_headers', attempt, status: response.status, headersMs,
      ...(upstreamId ? { requestIdHash: hash(upstreamId) } : {}) });
    if (!response.body) return response;
    let bytes = 0, firstByteMs;
    const chunks = [];
    const stream = response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        firstByteMs ??= Date.now() - started;
        bytes += chunk.byteLength;
        if (bytes <= 1048576) chunks.push(Buffer.from(chunk));
        controller.enqueue(chunk);
      },
      flush() {
        const metrics = {};
        if (bytes <= 1048576) {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens'])
              if (Number.isSafeInteger(body.usage?.[key])) metrics[key] = body.usage[key];
            const reasoning = body.usage?.completion_tokens_details?.reasoning_tokens;
            if (Number.isSafeInteger(reasoning)) metrics.reasoning_tokens = reasoning;
          } catch { /* Adapter remains responsible for validation. */ }
        }
        emit({ event: 'model_body_complete', attempt, headersMs, firstByteMs, elapsedMs: Date.now() - started, bytes, metrics });
      }
    }));
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch {
    emit({ event: 'model_transport_ended', attempt, elapsedMs: Date.now() - started,
      code: init.signal?.aborted ? 'ABORTED' : 'TRANSPORT_ERROR' });
    throw new Error('DIAGNOSTIC_TRANSPORT_ENDED');
  }
};
emit({ event: 'model_diagnostic_started', groundingId, budgetMs, maxRetries: config.maxRetries,
  outputMode: config.outputMode, modelHash: hash(config.model), inputHash: canonicalSha256(input) });
try {
  const compiled = compileWorldSemanticFrameSchema(
    JSON.parse(readFileSync('contracts/wsgs-v0.1/contracts/world-semantic-frame.schema.json', 'utf8')),
    JSON.parse(readFileSync('contracts/wsgs-v0.1/contracts/common.schema.json', 'utf8')));
  const result = await new OpenAICompatibleSemanticModel({ ...config, fetch: measuredFetch }, compiled.schema, compiled.validate).parse(input);
  emit({ event: 'model_diagnostic_finished', status: 'SUCCEEDED', elapsedMs: Date.now() - began, receipt: result.receipt });
} catch (error) {
  emit({ event: 'model_diagnostic_finished', status: 'FAILED', elapsedMs: Date.now() - began,
    code: /^[A-Z_0-9]+$/.test(error.code ?? '') ? error.code : 'MODEL_DIAGNOSTIC_FAILED', receipt: error.receipt });
  process.exitCode = 2;
}
