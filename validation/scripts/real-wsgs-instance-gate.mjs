import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {SignJWT} from 'jose';
import pg from 'pg';
import {createWorldAnalysisValidator} from '../../packages/contracts/dist/index.js';
import {GowmGatewayClient} from '../../packages/gowm-gateway-client/dist/index.js';
import {GowmDelegationSigner,createGroundingIdentity} from '../../packages/delegated-identity/dist/index.js';
import {currentGowmPath,currentGowmSnapshot} from '../../packages/gowm-contract-intake/dist/index.js';
const e=process.env;
const base=e.WSGS_TEST_API_URL??'http://grounding-api:8080';
const site=JSON.parse(readFileSync(new URL('../live-site-references.json',import.meta.url),'utf8'));
const subjectSeed=site.subject;
const taskSeed=site.task;
const lock=JSON.parse(readFileSync(currentGowmPath(currentGowmSnapshot.operationalLockPath),'utf8'));
const referenceDescriptor=JSON.parse(readFileSync(currentGowmPath('CATALOG.json'),'utf8')).capabilities.find(o=>o.operationId==='reference.get');
const referenceLock=lock.defaultOperations.find(o=>o.operationId==='reference.get');
if(!referenceLock)throw Error('LIVE_REFERENCE_LOCK_MISSING');
const identity=createGroundingIdentity({servicePrincipalId:e.GOWM_DELEGATION_SERVICE_PRINCIPAL_ID,actorId:'wsgs-instance-test',
 dataScopes:[e.WSGS_READINESS_DATA_SCOPE],datasetScopes:(e.WSGS_READINESS_DATASET_SCOPES??'').split(',').filter(Boolean),permissions:['data:read','dataset:read','gateway:execute']});
const signer=new GowmDelegationSigner({issuer:e.GOWM_DELEGATION_ISSUER,audience:e.GOWM_DELEGATION_AUDIENCE,
 servicePrincipalId:identity.servicePrincipalId,privateKeyPkcs8:readFileSync(e.GOWM_DELEGATION_PRIVATE_KEY_FILE,'utf8'),trustedOperationKeys:[`reference.get@${referenceLock.operationVersion}`]});
const gateway=new GowmGatewayClient({baseUrl:e.GOWM_GATEWAY_BASE_URL,credential:()=>e.GOWM_GATEWAY_TOKEN,maxRetries:0,timeoutMs:20000});
async function currentReference(subjectSeed){
 const requestId='live-'+randomUUID(),signed=await signer.sign({identity,requestId,kind:'DIRECT_OPERATION',operation:{operationId:'reference.get',operationVersion:referenceLock.operationVersion}});
 const response=await gateway.executeOperation(referenceLock,{requestVersion:'1.0',requestId,idempotencyKey:randomUUID(),
  operationVersion:referenceLock.operationVersion,inputSchemaHash:referenceLock.inputSchemaHash,outputSchemaHash:referenceLock.outputSchemaHash,
  input:{schemaVersion:'1.0',referenceKey:subjectSeed},executionPolicy:{deadlineAt:new Date(Date.now()+20000).toISOString(),maximumResultBytes:1048576,maximumCostClass:referenceDescriptor.execution.costClass,preferredExecution:'SYNC'}},
  {requestId,delegationToken:signed.token});
 const key=response.value?.output?.value?.referenceKey;
 if(response.status!==200||response.value?.status!=='COMPLETED'||!key||key.id!==subjectSeed.id||key.kind!==subjectSeed.kind||key.namespace!==subjectSeed.namespace||typeof key.version!=='string')throw Error('LIVE_CURRENT_REFERENCE_UNAVAILABLE');
 return key;
}
const sign=async (overrides={})=>new SignJWT({actorId:'wsgs-instance-test',dataScopes:[e.WSGS_READINESS_DATA_SCOPE],
 datasetScopes:(e.WSGS_READINESS_DATASET_SCOPES??'').split(',').filter(Boolean),permissions:['grounding.read','data:read','dataset:read','gateway:execute'],...overrides})
 .setProtectedHeader({alg:'HS256'}).setSubject('wsgs-consumer').setIssuer(e.WSGS_JWT_ISSUER).setAudience(e.WSGS_JWT_AUDIENCE??'wsgs')
 .setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(e.WSGS_JWT_HS256_SECRET));
const token=await sign();
const headers={authorization:'Bearer '+token,'content-type':'application/json','WSGS-Contract-Version':'sacs-wsgs-grounding/1.2','WSGS-Result-Profile':'wsgs-world-analysis-findings/1.0'};
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const validate=createWorldAnalysisValidator();
const chosen=process.argv[2];
const cases=[['BASIC','2号车在哪里？'],['TRACE','2号车本次任务的轨迹是什么'],['MAP','2号车本次任务经过哪些道路'],
 ['STOP','2号车本次任务在哪里停车'],['CROSS','2号车最后经过哪个路口'],['RANK','2号车本次任务通信信号最好的三个位置在哪里'],['GDPS','2号车所在位置的地表覆盖类型是什么'],['CANCEL','2号车本次任务的轨迹是什么']];
const report={observedAt:new Date().toISOString(),status:'PASS',cases:[]};
if(chosen&&chosen!=='ALL'&&chosen!=='FUNCTIONAL'&&!cases.some(([name])=>name===chosen))throw Error('UNKNOWN_LIVE_CASE');
for(const [name,text] of cases.filter(([name])=>!chosen||chosen==='ALL'||(chosen==='FUNCTIONAL'&&['TRACE','MAP','STOP','CROSS','RANK','GDPS'].includes(name))||chosen===name)){
 const subject=await currentReference(subjectSeed);
 const task=await currentReference(taskSeed);
 const body={schemaVersion:'1.0',requestId:'live-'+randomUUID(),operation:'EXECUTE_WORLD_QUERY',
  source:{conversationRef:'wsgs-live-'+randomUUID(),messageId:randomUUID(),originalText:text,originalTextSha256:'sha256:'+hash(text),locale:'zh-CN',createdAt:new Date().toISOString()},
  requestedProducts:['WORLD_EVIDENCE'],contextCapsule:{knownWorldReferences:[{referenceKey:subject,referenceType:'WORLD_OBJECT',alias:'2号车',sourceMessageId:'site-subject'},
   {referenceKey:task,referenceType:'OPERATIONAL_TASK',alias:'任务',sourceMessageId:'site-task'}],priorGroundings:[],mapSelections:[],externalCorrelationHints:[],externalPredicates:[]},
  executionPolicy:{readOnly:true,deadlineMs:120000,maxQueryOperations:16,maxCandidatesPerMention:5,maxResultBytes:1048576,allowApproximation:false}};
 if(!validate('request',body).valid)throw Error('LIVE_TEST_REQUEST_INVALID');
 const key=randomUUID(),started=Date.now();
 const r=await fetch(base+'/v1/groundings',{method:'POST',headers:{...headers,'idempotency-key':key,prefer:'respond-async'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
 let value=await r.json(),groundingId=value.groundingId,terminal=value;
 if(name==='CANCEL'&&r.status===202){
  const cancel=await fetch(base+'/v1/groundings/'+groundingId+':cancel',{method:'POST',headers:{authorization:headers.authorization,'WSGS-Contract-Version':headers['WSGS-Contract-Version'],'WSGS-Result-Profile':headers['WSGS-Result-Profile']}});
  if(cancel.status!==200&&cancel.status!==202)throw Error('CANCELLATION_REJECTED');
 }
 if(r.status===202){
  while(Date.now()-started<135000){
   await new Promise(resolve=>setTimeout(resolve,1000));
   const poll=await fetch(base+'/v1/groundings/'+groundingId,{headers,signal:AbortSignal.timeout(15000)});
   value=await poll.json();terminal=value.result??value;
   if(!['ACCEPTED','RUNNING'].includes(value.status))break;
  }
 }
 if(name==='CANCEL'){
  const denied=await fetch(base+'/v1/groundings/'+groundingId,{headers:{...headers,authorization:'Bearer '+await sign({dataScopes:['ungranted']})}});
  const bad=await fetch(base+'/v1/groundings/'+groundingId,{headers:{...headers,authorization:'Bearer '+token.slice(0,-16)+'AAAAAAAAAAAAAAAA'}});
  const item={name,groundingId,status:value.status,cancelled:value.status==='CANCELLED',deniedScope:denied.status,badSignature:bad.status};
  report.cases.push(item);if(!item.cancelled||![403,404].includes(item.deniedScope)||item.badSignature!==401)report.status='FAILED';console.log(JSON.stringify({case:item}));continue;
 }
 const valid=terminal.resultHash && validate('result',terminal).valid;
 const beforeReplay=JSON.stringify(terminal);
 const replay=await fetch(base+'/v1/groundings',{method:'POST',headers:{...headers,'idempotency-key':key},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const replayValue=await replay.json();
 const pool=new pg.Pool({connectionString:e.DATABASE_URL,max:1});
 let executions;
 try{executions=(await pool.query(`SELECT operation_id,upstream_status,normalized_status,
   jsonb_array_length(receipt_ids) AS receipt_count FROM wsgs.gowm_execution
   WHERE grounding_id=$1 AND execution_kind='WORLD_QUERY_NODE' ORDER BY operation_id`,[groundingId])).rows;}
 finally{await pool.end();}
 const item={name,http:r.status,groundingId,status:terminal.status??value.status,validResult:Boolean(valid),
  resultHash:terminal.resultHash,elapsedMs:Date.now()-started,replayIdentical:JSON.stringify(replayValue)===beforeReplay,
  findings:terminal.worldAnalysisFindings?.findings?.map(f=>({kind:f.findingKind,status:f.status})),
  operations:terminal.evidenceItems?.map(i=>i.sourceOperation),gaps:terminal.worldAnalysisFindings?.gaps??terminal.capabilityGaps,
  executions,gdpsWarnings:terminal.warnings?.filter(w=>typeof w==='string'&&/^GDPS_[A-Z_:]+$/.test(w)),error:value.error??terminal.error};
 if(name==='GDPS'){
  item.expectation='NO_DATA';
  item.providerNoData=executions.some(entry=>entry.operation_id==='landcover.get-class'&&entry.upstream_status==='NO_DATA'&&entry.receipt_count>0);
  item.publicNoData=terminal.evidenceItems?.some(entry=>entry.sourceOperation==='landcover.get-class'&&entry.upstreamStatus==='NO_DATA'&&entry.receiptIds?.length>0&&entry.unknowns?.includes('NO_DATA'))??false;
  item.businessDataAvailable=item.providerNoData?false:null;
 }
 report.cases.push(item);
 const expectedOutcome=name==='GDPS'?item.providerNoData&&item.publicNoData
  :item.operations?.length&&!item.gaps?.some(g=>g.severity==='BLOCKING');
 if(!valid||['FAILED','CANCELLED'].includes(item.status)||!item.replayIdentical||!expectedOutcome)report.status='FAILED';
 console.log(JSON.stringify({case:item}));
}
console.log(JSON.stringify(report));
if(report.status!=='PASS')process.exitCode=1;
