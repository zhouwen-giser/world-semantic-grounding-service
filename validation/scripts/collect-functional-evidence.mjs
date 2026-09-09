import pg from 'pg';
import { Aes256GcmPayloadCodec, PostgresPipelineJournal } from '../../packages/grounding-pipeline/dist/index.js';
const ids = process.argv.slice(2);
if (!ids.length || ids.some(id => !/^grounding-[a-z0-9-]+$/.test(id))) throw new Error('INVALID_DIAGNOSTIC_IDS');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 3000 });
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const counts = value => Object.fromEntries(Object.entries(value ?? {}).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]));
try {
  await pool.query('BEGIN READ ONLY');
  await pool.query("SET LOCAL statement_timeout='5s'");
  const journal = new PostgresPipelineJournal(pool, Aes256GcmPayloadCodec.fromBase64(process.env.WSGS_REQUEST_ENCRYPTION_KEY_BASE64));
  for (const id of ids) {
    const stages = (await pool.query("SELECT stage,status,attempt,elapsed_ms,error_code,created_at FROM wsgs.pipeline_event WHERE grounding_id=$1 AND status<>'STARTED' ORDER BY sequence", [id])).rows;
    const executions = (await pool.query("SELECT execution_kind,operation_id,upstream_status,normalized_status,request_hash,result_hash,receipt_ids,snapshot_adherence,gateway_query_id,gateway_job_id FROM wsgs.gowm_execution WHERE grounding_id=$1 ORDER BY created_at", [id])).rows;
    const rows = (await pool.query('SELECT job_id,run_fingerprint FROM wsgs.pipeline_checkpoint WHERE grounding_id=$1', [id])).rows;
    const state = rows[0] ? (await journal.loadLatestCheckpoint(rows[0].job_id, rows[0].run_fingerprint))?.state : undefined;
    const advanced = state?.GOWM_EXECUTE?.advancedExecution;
    const result = state?.PRODUCT_ASSEMBLE;
    console.log(JSON.stringify({ groundingId: id, stages, executions, checkpointAvailable: Boolean(state),
      model: pick(state?.SEMANTIC_MODEL_PARSE?.receipt, ['status', 'attempts', 'elapsedMs', 'failureCode']),
      findings: result?.worldAnalysisFindings?.findings?.map(f => ({ ...pick(f, ['findingKind','status','reasonCode']),
        counts: counts(f), coverage: f.coverage, selection: pick(f.selection, ['confirmed','reasonCode','confirmationScope']) })),
      choiceCount: result?.worldAnalysisFindings?.choices?.length,
      choices: result?.worldAnalysisFindings?.choices?.map(c => ({ choiceKind: c.choiceKind, validUntil: c.validUntil, candidateCount: c.candidates.length })),
      advanced: advanced ? { ...pick(advanced, ['status','reasonCode','planHash','operations']),
        foundation: { ...pick(advanced.foundation?.finding, ['status','reasonCode']), subject: advanced.foundation?.intent?.subjectReferenceKey, reference: advanced.foundation?.reference?.referenceKey,
          trajectory: pick(advanced.foundation?.finding?.trajectory, ['completeness','finalization']) },
        observations: advanced.executionAvailabilityObservations?.map(o => pick(o, ['observedAt','observationHash','authorityHash'])),
        evidence: advanced.analysisEvidence?.map(e => ({ operationId: e.operationId,
          status: e.envelope.status, resultHash: e.envelope.execution?.resultHash,
          consumption: e.envelope.consumption,
          value: { ...pick(e.envelope.output?.value, ['status','reasonCode','subjectReferenceKey','trajectoryReferenceKey']), sourceTrajectory: e.envelope.output?.value?.source?.trajectoryReferenceKey, counts: counts(e.envelope.output?.value) },
          receipts: e.envelope.receipts?.map(r => pick(r, ['receiptId','operationId','inputHash','outputHash','durationMs'])) }))
      } : undefined }));
  }
} finally { await pool.query('ROLLBACK').catch(() => undefined); await pool.end(); }
