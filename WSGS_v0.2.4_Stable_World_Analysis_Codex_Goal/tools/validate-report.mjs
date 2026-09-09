#!/usr/bin/env node
// Evidence-file/format checker only. It does not execute WSGS or attest log truth.
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const hashPattern = /^sha256:[0-9a-f]{64}$/;
const shaPattern = /^[0-9a-f]{40}$/;
const requiredCommands = ['npm run check','npm test','npm run build','npm run verify:world-analysis-contract','npm run smoke:world-analysis:fixture','npm run test:world-analysis:http','npm run verify:world-analysis:handoff'];
const allowedStatus = new Set(['PASS','FAIL','BLOCKED','NOT_RUN']);
const argv = process.argv.slice(2);
let reportPath, repoRoot = process.cwd(), requireReady = false;
try {
  for (let i=0; i<argv.length; i++) {
    if (argv[i] === '--repo-root') { assert(argv[i+1], 'Missing --repo-root value'); repoRoot = argv[++i]; }
    else if (argv[i] === '--require-ready') requireReady = true;
    else if (!reportPath && !argv[i].startsWith('--')) reportPath = argv[i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  assert(reportPath, 'Usage: validate-report.mjs REPORT.json [--repo-root ROOT] [--require-ready]');
  const root = await realpath(path.resolve(repoRoot));
  const report = JSON.parse(await readFile(path.resolve(reportPath), 'utf8'));
  const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const matrix = JSON.parse(await readFile(path.join(pkgRoot,'acceptance/required-requirements.json'),'utf8'));
  const manifest = JSON.parse(await readFile(path.join(pkgRoot,'PACKAGE_MANIFEST.json'),'utf8'));
  async function evidence(item) {
    assert(item && typeof item.path === 'string' && !path.isAbsolute(item.path) && !item.path.split(/[\\/]/).includes('..'), 'Unsafe/missing evidence path');
    assert(hashPattern.test(item.sha256), `Invalid evidence SHA256: ${item.path}`);
    const p = await realpath(path.resolve(root,item.path));
    const relative = path.relative(root,p);
    assert(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Evidence escapes repo root');
    assert((await stat(p)).isFile(), 'Evidence is not a file');
    const digest = `sha256:${createHash('sha256').update(await readFile(p)).digest('hex')}`;
    assert(digest === item.sha256, `Evidence hash mismatch: ${item.path}`);
    assert(typeof item.locator === 'string' && item.locator.trim(), `Missing evidence locator: ${item.path}`);
  }
  assert(report.schemaVersion === '1.0' && report.taskId === manifest.packageId, 'Wrong report identity');
  assert(report.repository === manifest.allowedWriteRepositories[0], 'Wrong repository');
  assert(['NOT_RUN','PARTIAL','BLOCKED','DEV_READY'].includes(report.status), 'Unknown report status');
  assert(Array.isArray(report.acceptance) && report.acceptance.length === matrix.total, 'Missing Required results');
  const map = new Map();
  for (const row of report.acceptance) {
    assert(!map.has(row.id), `Duplicate result: ${row.id}`); map.set(row.id,row);
    assert(allowedStatus.has(row.status), `Invalid result status: ${row.id}`);
    assert(Array.isArray(row.evidence), `Missing evidence array: ${row.id}`);
    if (row.status === 'PASS') {
      assert(row.evidence.length, `PASS without evidence: ${row.id}`);
      for (const e of row.evidence) await evidence(e);
    }
  }
  for (const row of matrix.requirements) assert(map.has(row.id), `Unknown/missing Required: ${row.id}`);
  assert(Array.isArray(report.commands), 'Missing commands');
  for (const c of report.commands) {
    assert(typeof c.command === 'string' && allowedStatus.has(c.status), 'Invalid command record');
    if (c.status === 'PASS') {
      assert(c.exitCode === 0 && Array.isArray(c.evidence) && c.evidence.length, `Command PASS without execution evidence: ${c.command}`);
      for (const e of c.evidence) await evidence(e);
    }
  }
  assert(report.claims && ['productionReady','releaseQualified','strictReplayReady','deviceExecutionAuthorized'].every(k => report.claims[k] === false), 'Disallowed completion claims');
  const passed = [...map.values()].filter(r => r.status === 'PASS').length;
  const claimReady = report.status === 'DEV_READY' || report.completionMarker !== null;
  if (requireReady || claimReady) {
    assert(report.status === 'DEV_READY' && report.completionMarker === manifest.completionMarker, 'NOT_READY: missing qualified DEV_READY status');
    assert(passed === 72, `NOT_READY: Required ${passed}/72`);
    assert(Array.isArray(report.blockers) && report.blockers.length === 0, 'NOT_READY: blocking defects remain');
    assert(report.verificationLevels?.L0_CONTRACT_UNIT === 'PASS' && report.verificationLevels?.L1_HTTP_DEVELOPMENT_CONTROLLED_DEPENDENCIES === 'PASS', 'NOT_READY: Required validation level not passed');
    for (const required of requiredCommands) assert(report.commands.some(c => (c.command === required || c.command.startsWith(required+' ')) && c.status === 'PASS'), `NOT_READY: missing command ${required}`);
    assert(shaPattern.test(report.source?.testedCommit), 'NOT_READY: missing tested commit');
    assert(typeof report.source.testedWorkingTreeDirty === 'boolean', 'NOT_READY: missing tested dirty state');
    if (report.source.testedWorkingTreeDirty) assert(hashPattern.test(report.source.testedDiffSha256), 'NOT_READY: missing tested diff hash');
    assert(report.contract?.state === 'FROZEN' && shaPattern.test(report.contract.freezeCommit), 'NOT_READY: public contract not frozen');
    assert(report.contract.contractVersion === manifest.targetContract.contractVersion && report.contract.resultProfile === manifest.targetContract.resultProfile, 'Wrong contract/profile');
    await evidence({path:report.contract.freezeManifestPath,sha256:report.contract.freezeManifestSha256,locator:'freeze-manifest'});
    assert(report.handoff?.status === 'PASS', 'NOT_READY: handoff not verified');
    await evidence({path:report.handoff.manifestPath,sha256:report.handoff.manifestSha256,locator:'handoff-manifest'});
    assert(['DRAFT_PR','LOCAL_ONLY','BLOCKED'].includes(report.remoteDelivery?.status), 'NOT_READY: remote delivery status unresolved');
    if (report.remoteDelivery.status === 'DRAFT_PR') assert(/^https:\/\/github\.com\/zhouwen-giser\/world-semantic-grounding-service\/pull\/\d+$/.test(report.remoteDelivery.draftPrUrl), 'Invalid Draft PR link');
    console.log('DEV_REPORT_EVIDENCE_FORMAT_VALID — actual test execution and review still require independent confirmation');
  } else {
    assert(report.completionMarker === null, 'Non-ready report contains a completion marker');
    console.log(`REPORT_FORMAT_VALID_NOT_READY: Required ${passed}/72; this is not service qualification`);
  }
} catch (error) { console.error(`REPORT_INVALID: ${error.message}`); process.exitCode = 1; }
