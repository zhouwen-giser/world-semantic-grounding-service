import pg from 'pg';
import {createHash} from 'node:crypto';
import {Aes256GcmPayloadCodec} from '/app/packages/grounding-pipeline/dist/crypto.js';
import {canonicalSha256} from '/app/packages/grounding-pipeline/dist/canonical.js';
import {createWorldAnalysisValidator,worldAnalysisResultHash} from '/app/packages/contracts/dist/index.js';
import {assembleProductionWorldAnalysis} from '/app/services/grounding-worker/dist/world-analysis-result.js';
const target='db91c4f43f2fc06676bf03fc924c0e07355617674987bc3c79cc9edc37183c5f';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const client=await pool.connect();
try {
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout='5s'");
  const rows=(await client.query("SELECT cp.* FROM wsgs.pipeline_checkpoint cp JOIN wsgs.grounding_request r USING(grounding_id) WHERE r.created_at BETWEEN '2026-09-09T08:29:20Z' AND '2026-09-09T08:30:23Z'")).rows;
  const codec=Aes256GcmPayloadCodec.fromBase64(process.env.WSGS_REQUEST_ENCRYPTION_KEY_BASE64);
  let matched=0;
  for(const row of rows) {
    if(createHash('sha256').update(row.grounding_id).digest('hex')!==target)continue;
    matched++;
    const state=JSON.parse(Buffer.from(await codec.openCheckpoint(row.state_ciphertext,{jobId:row.job_id,runFingerprint:row.run_fingerprint})).toString());
    if(canonicalSha256(state)!==row.state_hash)throw Error('CHECKPOINT_INTEGRITY_FAILED');
    const base=state.PRODUCT_ASSEMBLE;
    const historicalExecution=state.GOWM_EXECUTE.historicalExecution;
    const result=assembleProductionWorldAnalysis({base,historicalExecution,runFingerprint:row.run_fingerprint,
      validUntil:'2026-09-09T08:31:00.000Z',maxResultBytes:1048576,foundationEvidenceIds:[]});
    const validation=createWorldAnalysisValidator()('result',result);
    const gaps=result.worldAnalysisFindings.gaps.map(g=>g.gapKind);
    if(!validation.valid||result.status!=='PARTIAL'||gaps.length!==1||gaps[0]!=='HISTORICAL_PROJECTION_PENDING'||result.worldAnalysisFindings.findings.length!==0||result.resultHash!==worldAnalysisResultHash(result))throw Error('REPLAY_ASSERTION_FAILED');
    console.log(JSON.stringify({verification:'READ_ONLY_SAVED_CHECKPOINT_ASSEMBLY_NOT_E2E',groundingIdHash:target,
      checkpointIntegrity:true,originalGapCount:base.worldAnalysisFindings.gaps.length,historicalStatus:historicalExecution.status,
      historicalReasonCode:historicalExecution.reasonCode,status:result.status,gapKinds:gaps,
      findingCount:result.worldAnalysisFindings.findings.length,referenceKeysUnchanged:canonicalSha256(result.referenceProducts.map(p=>p.referenceKey))===canonicalSha256(base.referenceProducts.map(p=>p.referenceKey)),
      schemaValid:validation.valid,resultHashValid:true,resultHash:result.resultHash,originalResultNotModified:true}));
  }
  if(matched!==1)throw Error('CHECKPOINT_NOT_UNIQUE');
  await client.query('ROLLBACK');
} finally {client.release();await pool.end();}
