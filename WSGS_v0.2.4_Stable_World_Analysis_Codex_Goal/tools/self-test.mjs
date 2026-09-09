#!/usr/bin/env node
// Runs only package-validator tests in a temporary directory. No repo/network writes.
import { mkdtemp, cp, rm, readFile, writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(tmpdir(),'wsgs-task-package-'));
const work = path.join(temporary,'package');
const results = [];
function test(name,args,expectZero) {
  const r = spawnSync(process.execPath,args,{encoding:'utf8',timeout:15000});
  const passed = !r.error && (expectZero ? r.status === 0 : Number.isInteger(r.status) && r.status !== 0);
  results.push({name,passed,exitCode:r.status,output:(r.stdout+r.stderr).trim()});
  if (!passed) throw new Error(`Self-test failed: ${name}`);
}
try {
  await cp(root,work,{recursive:true});
  const verify=path.join(work,'tools/verify-package.mjs');
  const validate=path.join(root,'tools/validate-report.mjs');
  test('valid package accepted',[verify,work],true);
  const readme=path.join(work,'README_CN.md');
  const original=await readFile(readme,'utf8');
  await writeFile(readme,original+'TAMPER\n');
  test('tampered artifact rejected',[verify,work],false);
  await writeFile(readme,original);
  await writeFile(path.join(work,'unexpected.txt'),'unexpected');
  test('unexpected artifact rejected',[verify,work],false);
  await unlink(path.join(work,'unexpected.txt'));
  await unlink(readme);
  test('missing artifact rejected',[verify,work],false);
  await writeFile(readme,original);
  const template=path.join(root,'templates/FINAL_REPORT.template.json');
  test('NOT_RUN template valid but not ready',[validate,template,'--repo-root',root],true);
  test('NOT_RUN template cannot claim ready',[validate,template,'--repo-root',root,'--require-ready'],false);
  const forged=JSON.parse(await readFile(template,'utf8'));
  forged.status='DEV_READY';forged.completionMarker='WSGS_STABLE_GENERIC_WORLD_ANALYSIS_SERVICE_DEV_READY';
  forged.acceptance.forEach(r=>r.status='PASS');
  const forgedFile=path.join(temporary,'forged.json');
  await writeFile(forgedFile,JSON.stringify(forged));
  test('all-PASS without evidence rejected',[validate,forgedFile,'--repo-root',root,'--require-ready'],false);
  console.log(JSON.stringify({status:'PACKAGE_VALIDATOR_SELF_TEST_PASS',tests:results.length,results,wsgsTestsExecuted:false},null,2));
} catch(error) { console.error(error.message);process.exitCode=1; }
finally { await rm(temporary,{recursive:true,force:true}); }
