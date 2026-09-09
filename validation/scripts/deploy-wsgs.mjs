import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

const host=process.env.WSGS_DEPLOY_HOST ?? 'sz-gowm';
const prepareOnly=process.argv.includes('--prepare-only');
const diagnosticCase=process.argv.find(arg=>arg.startsWith('--diagnostic-case='))?.split('=')[1];
if(diagnosticCase!==undefined&&!['ALL','FUNCTIONAL','BASIC','TRACE','MAP','STOP','CROSS','RANK','GDPS','CANCEL'].includes(diagnosticCase))throw Error('UNKNOWN_DIAGNOSTIC_CASE');
const run=(bin,args,options={})=>execFileSync(bin,args,{stdio:options.input===undefined?'inherit':['pipe','inherit','inherit'],...options});
run('npm',['run','gowm:refresh']);
if(!prepareOnly) run('npm',['run','check']);
const selectedSnapshot=fs.realpathSync('contracts/upstream/gowm-current');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'wsgs-release-'));
try{
 const snapshot=JSON.parse(fs.readFileSync(path.join(selectedSnapshot,'SNAPSHOT.json'),'utf8'));
 const formal=fs.readFileSync(path.join(process.env.WSGS_GOWM_RELEASE_DIR??path.resolve('../geospatial-operational-world-model/output/deployment'),snapshot.source.package));
 if(createHash('sha256').update(formal).digest('hex')!==snapshot.source.sha256)throw Error('FORMAL_RELEASE_CHANGED_BEFORE_PACKAGING');
 fs.writeFileSync(path.join(temporary,'gowm-formal.tar.gz'),formal);
 const archive=path.join(temporary,'source.tar.gz');
 run('tar',['--exclude=**/node_modules','--exclude=**/dist','--exclude=**/__pycache__','-czf',archive,
   'package.json','package-lock.json','tsconfig.json','tsconfig.base.json','vitest.config.ts','Dockerfile','compose.yaml',
   'packages','services','contracts','database','validation','deployment','config','-C',temporary,'gowm-formal.tar.gz']);
 const releaseId=createHash('sha256').update(fs.readFileSync(archive)).digest('hex').slice(0,20);
 const release='/mnt/data/wsgs-live/releases/'+releaseId;
 const ssh=(script,options={})=>run('ssh',['-o','BatchMode=yes',host,script],options);
 ssh(`mkdir -p '${release}' && tar -xzf - -C '${release}'`,{input:fs.readFileSync(archive)});
 process.loadEnvFile('.env');
 const model=Object.fromEntries(['MODEL_BASE_URL','MODEL_API_KEY','MODEL_NAME','MODEL_OUTPUT_MODE','MODEL_TIMEOUT_MS','MODEL_MAX_RETRIES'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 ssh(`python3 '${release}/deployment/prepare-instance.py' '${release}'`,{input:JSON.stringify({model,upstreamDeploymentRoot:process.env.WSGS_UPSTREAM_DEPLOYMENT_ROOT})});
 const compose=`docker compose --project-name wsgs-live --project-directory '${release}' --env-file '${release}/.env' -f '${release}/compose.yaml' -f '${release}/compose.instance.json'`;
 ssh(`${compose} config --quiet`);
 if(!prepareOnly){
  ssh(`python3 '${release}/deployment/build-instance-gateway.py' '${release}'`);
  ssh(`${compose} build`);
  run('npm',['run','gowm:refresh']);
  if(fs.realpathSync('contracts/upstream/gowm-current')!==selectedSnapshot)throw Error('FORMAL_RELEASE_CHANGED_DURING_BUILD');
  ssh(`python3 '${release}/deployment/ensure-instance-databases.py' '${release}'`);
  // Only an existing instance has work to drain.
  const existing=execFileSync('ssh',['-o','BatchMode=yes',host,"docker ps -q --filter label=com.docker.compose.project=wsgs-live --filter label=com.docker.compose.service=grounding-worker"],{encoding:'utf8'}).trim();
  ssh(`${compose} stop grounding-api`);
  if(existing)ssh(`${compose} run --rm --no-deps --entrypoint node grounding-api validation/scripts/drain-wsgs.mjs`);
  ssh(`${compose} stop grounding-worker`);
  ssh(`${compose} run --rm --no-deps gateway-bootstrap`);
  ssh(`${compose} run --rm --no-deps wsgs-migrate`);
  ssh(`${compose} up -d --no-deps signed-gateway`);
  ssh(`${compose} run --rm --no-deps --entrypoint node grounding-api validation/scripts/signed-gateway-preflight.mjs`);
  try {
   ssh(`${compose} up -d --no-deps --wait --wait-timeout 180 grounding-api grounding-worker`);
   ssh(`${compose} run --rm --no-deps --entrypoint node grounding-api validation/scripts/real-wsgs-instance-gate.mjs ${diagnosticCase??''} > '${release}/acceptance.jsonl'`);
   run('npm',['run','gowm:refresh']);
   if(fs.realpathSync('contracts/upstream/gowm-current')!==selectedSnapshot)throw Error('FORMAL_RELEASE_CHANGED_DURING_ACCEPTANCE');
   if(diagnosticCase)ssh(`${compose} stop grounding-api grounding-worker`);
   else ssh(`ln -sfn '${release}' /mnt/data/wsgs-live/current-next && mv -Tf /mnt/data/wsgs-live/current-next /mnt/data/wsgs-live/current`);
  } catch(error) {
   ssh(`${compose} stop grounding-api grounding-worker`);
   throw error;
  }
 }
 console.log(JSON.stringify({status:prepareOnly?'PREPARED':diagnosticCase?'DIAGNOSTIC_PASSED':'ACCEPTED',release,project:'wsgs-live',activated:!prepareOnly&&!diagnosticCase,...(diagnosticCase?{diagnosticCase}:{})}));
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
