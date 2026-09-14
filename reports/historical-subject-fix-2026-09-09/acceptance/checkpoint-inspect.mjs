import pg from 'pg';
import {createHash} from 'node:crypto';
import {Aes256GcmPayloadCodec} from '/app/packages/grounding-pipeline/dist/crypto.js';
import {canonicalSha256} from '/app/packages/grounding-pipeline/dist/canonical.js';
import {createWorldAnalysisValidator,worldAnalysisResultHash} from '/app/packages/contracts/dist/index.js';
const target='49870c823bb25fbab500cbb5871f862ee760dd569bfe2d662618da62a0f7807c';
const h=x=>createHash('sha256').update(x).digest('hex');
const canon=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canon).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canon(x[k])).join(',')+'}';
const digest=x=>'sha256:'+h(canon(x));
const logical=x=>({namespace:x.namespace,kind:x.kind,id:x.id});
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});const c=await pool.connect();
try {
 await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='5s'");
 const rows=(await c.query("SELECT cp.* FROM wsgs.pipeline_checkpoint cp JOIN wsgs.grounding_request r USING(grounding_id) WHERE r.created_at BETWEEN '2026-09-09T12:42:18Z' AND '2026-09-09T12:43:31Z'")).rows;
 const codec=Aes256GcmPayloadCodec.fromBase64(process.env.WSGS_REQUEST_ENCRYPTION_KEY_BASE64);
 let matched=0;
 for(const row of rows){
  if(h(row.grounding_id)!==target)continue;matched++;
  const s=JSON.parse(Buffer.from(await codec.openCheckpoint(row.state_ciphertext,{jobId:row.job_id,runFingerprint:row.run_fingerprint})).toString());
  if(canonicalSha256(s)!==row.state_hash)throw Error('CHECKPOINT_INTEGRITY_FAILED');
  const result=s.PRODUCT_ASSEMBLE, execution=s.GOWM_EXECUTE?.historicalExecution,f=execution?.finding;
  const validation=createWorldAnalysisValidator()('result',result);
  const refSummary=(key)=>key?{kind:key.kind,hash:digest(key),fullMatch:result.referenceProducts.some(p=>digest(p.referenceKey)===digest(key)),logicalMatch:result.referenceProducts.some(p=>digest(logical(p.referenceKey))===digest(logical(key)))}:null;
  const codes=[];function walk(v,p=''){if(!v||typeof v!=='object')return;for(const[k,x]of Object.entries(v)){const q=p+'.'+k;if(['status','reasonCode','revalidationRequired','validUntil','validatedAt'].includes(k)&&(typeof x==='boolean'||typeof x==='string'&&(/^[A-Z][A-Z0-9_:-]{0,100}$/.test(x)||/^2026-/.test(x))))codes.push({path:q,value:x});else if(x&&typeof x==='object')walk(x,q);}}
  walk(s.REFERENCE_VALIDATE,'REFERENCE_VALIDATE');
  const terminal=s.GOWM_EXECUTE?.outcomes?.[0]?.encryptedCheckpointEvidenceMaterial?.terminal?.result;
  const node=terminal?.nodes?.[1];const bindings=s.GOWM_EXECUTE?.outcomes?.[0]?.submission?.plan?.nodes?.[1]?.inputs;
  let semanticRequestHash;
  if(bindings?.subjectReferenceKey?.value&&f?.executionInterval?.executionIntervalReferenceKey){
   semanticRequestHash=digest({subjectReferenceKey:logical(bindings.subjectReferenceKey.value),executionIntervalReferenceKey:logical(f.executionInterval.executionIntervalReferenceKey),phaseScope:bindings.phaseScope.value,sourceSelection:bindings.sourceSelection.value,sourceSelectionProfileReferenceKey:bindings.sourceSelectionProfileReferenceKey.value});
  }
  console.log(JSON.stringify({groundingIdHash:'sha256:'+target,checkpointIntegrity:true,schemaValid:validation.valid,schemaErrorCount:validation.errors?.length,resultHashValid:result.resultHash===worldAnalysisResultHash(result),resultHash:result.resultHash,status:result.status,
   findingCount:result.worldAnalysisFindings.findings.length,gapKinds:result.worldAnalysisFindings.gaps.map(g=>g.gapKind),validation:codes,
   references:result.referenceProducts.map(p=>({kind:p.referenceKey.kind,hash:digest(p.referenceKey),revalidationRequired:p.revalidationRequired,validUntil:p.validUntil})),
   historical:{status:execution?.status,reasonCode:execution?.reasonCode,findingStatus:f?.status,subject:refSummary(f?.subjectReferenceKey),task:refSummary(f?.taskReferenceKey),interval:refSummary(f?.executionInterval?.executionIntervalReferenceKey),trajectory:refSummary(f?.trajectory?.trajectoryReferenceKey),finalization:f?.trajectory?.finalization?.state,sampleCount:f?.trajectory?.completeness?.sampleCount,gapCount:f?.trajectory?.gaps?.length},
   nodes:terminal?.nodes?.map(n=>({status:n.status,startedAt:n.startedAt,finishedAt:n.finishedAt,upstreamStatus:n.result?.status,reasonCode:n.result?.output?.value?.reasonCode})),semanticRequestHash,nodeEffectiveSnapshotBeforeHash:node?.effectiveSnapshotBeforeHash,
   evidenceCount:result.evidenceItems.length,
   subjectAdmission: {status:s.GOWM_EXECUTE.historicalSubjectAdmission?.status,validationStatus:s.GOWM_EXECUTE.historicalSubjectAdmission?.validation?.status,revalidationRequired:s.GOWM_EXECUTE.historicalSubjectAdmission?.validation?.revalidationRequired,validUntil:s.GOWM_EXECUTE.historicalSubjectAdmission?.product?.validUntil},
   findings:result.worldAnalysisFindings.findings.map(f=>({kind:f.findingKind,status:f.status,subjectCount:f.subjectReferenceProductIds.length,subjectLinkedToAdmitted:f.subjectReferenceProductIds.length===1&&f.subjectReferenceProductIds[0]===s.GOWM_EXECUTE.historicalSubjectAdmission?.product?.productId,evidenceLinked:f.evidenceIds.length>0&&f.evidenceIds.every(id=>result.evidenceItems.some(e=>e.evidenceProductId===id)),coverage:f.coverage,trajectoryGapCount:f.trajectoryGaps?.length,validUntil:f.validUntil}))
  }));
 }
 if(matched!==1)throw Error('CHECKPOINT_NOT_UNIQUE');await c.query('ROLLBACK');
}finally{c.release();await pool.end();}
