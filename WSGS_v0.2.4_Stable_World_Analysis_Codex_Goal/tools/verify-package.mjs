#!/usr/bin/env node
// Read-only, zero-dependency validation of this task package, NOT WSGS.
import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const json = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
async function walk(dir, prefix = '') {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    const stat = await lstat(full);
    assert(!stat.isSymbolicLink(), `Symlink is not a package artifact: ${relative}`);
    if (stat.isDirectory()) files.push(...await walk(full, relative));
    else { assert(stat.isFile(), `Unsupported artifact: ${relative}`); files.push(relative); }
  }
  return files.sort();
}
function csvParse(text) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { row.push(value); value = ''; }
    else if (ch === '\n' && !quoted) { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
    else value += ch;
  }
  assert(!quoted, 'Unterminated CSV quote');
  if (row.length || value) { row.push(value); rows.push(row); }
  const headers = rows.shift();
  return rows.filter(r => r.some(Boolean)).map(r => {
    assert(r.length === headers.length, 'CSV column count mismatch');
    return Object.fromEntries(headers.map((h, i) => [h, r[i]]));
  });
}
try {
  const checksums = await json('CHECKSUMS.json');
  assert(checksums.algorithm === 'sha256-file-bytes', 'Unexpected checksum algorithm');
  const actual = (await walk(root)).filter(p => p !== 'CHECKSUMS.json');
  const expected = Object.keys(checksums.files).sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), 'Missing or unexpected package files');
  for (const relative of expected) {
    assert(!path.isAbsolute(relative) && !relative.split('/').includes('..'), `Unsafe path: ${relative}`);
    assert(digest(await readFile(path.join(root, relative))) === checksums.files[relative], `Checksum mismatch: ${relative}`);
  }
  const manifest = await json('PACKAGE_MANIFEST.json');
  assert(manifest.status === 'TASK_SPEC_READY' && manifest.implementationStatus === 'NOT_EXECUTED', 'Package must not claim implementation completion');
  assert(manifest.contractStatus === 'NOT_YET_FROZEN', 'Task package must not claim a frozen public contract');
  assert(JSON.stringify(manifest.allowedWriteRepositories) === JSON.stringify(['zhouwen-giser/world-semantic-grounding-service']), 'Write scope must be WSGS only');
  assert(manifest.freezeGate.phase === 'W01' && manifest.freezeGate.mustPrecedeNewRuntimeImplementation, 'Missing contract-first gate');
  assert([manifest.autoMerge, manifest.release, manifest.tag, manifest.deploy, manifest.defaultDockerRequired].every(x => x === false), 'Unsafe or expanded task boundary');
  const matrix = await json('acceptance/required-requirements.json');
  const csv = csvParse(await readFile(path.join(root, 'acceptance/acceptance-matrix.csv'), 'utf8'));
  assert(matrix.total === 72 && matrix.requirements.length === 72 && manifest.requiredAcceptanceCount === 72, 'Required count mismatch');
  assert(JSON.stringify(csv) === JSON.stringify(matrix.requirements), 'CSV and JSON requirements differ');
  const ids = matrix.requirements.map(r => r.id);
  assert(new Set(ids).size === ids.length, 'Duplicate acceptance IDs');
  assert(ids.every((id, i) => id === `WA-${String(i+1).padStart(3, '0')}`), 'Non-contiguous acceptance IDs');
  assert(matrix.requirements.every(r => r.priority === 'REQUIRED'), 'Required requirement downgraded');
  assert(manifest.phases.length === 8, 'Phase count mismatch');
  const seen = new Set(), assigned = [];
  for (const [i, phase] of manifest.phases.entries()) {
    assert(phase.id === `W0${i}`, 'Phase order mismatch');
    assert(phase.dependsOn.every(d => seen.has(d)), `Unresolved/cyclic phase dependency: ${phase.id}`);
    assert(actual.includes(phase.spec), `Missing phase spec: ${phase.spec}`);
    const owned = matrix.requirements.filter(r => r.phase === phase.id).map(r => r.id);
    assert(owned.length === 9 && JSON.stringify(owned) === JSON.stringify(phase.acceptanceIds), `Wrong phase ownership: ${phase.id}`);
    assigned.push(...owned); seen.add(phase.id);
  }
  assert(JSON.stringify(assigned) === JSON.stringify(ids), 'Requirements not fully assigned');
  const cases = await json('acceptance/development-cases.json');
  assert(cases.kind === 'TEST_DESIGN_NOT_EXECUTED' && cases.cases.length === 24, 'Case-design count/status mismatch');
  assert(new Set(cases.cases.map(c => c.id)).size === 24, 'Duplicate case IDs');
  for (const c of cases.cases) {
    assert(c.executionStatus === 'NOT_RUN', 'Unexecuted test design claims success');
    assert(c.acceptanceIds.every(id => ids.includes(id)), `Unknown acceptance ID in ${c.id}`);
  }
  const report = await json('templates/FINAL_REPORT.template.json');
  assert(report.status === 'NOT_RUN' && report.completionMarker === null, 'Report template must not claim success');
  assert(report.acceptance.length === 72 && report.acceptance.every(r => r.status === 'NOT_RUN' && r.evidence.length === 0), 'Report template contains fake evidence');
  console.log(JSON.stringify({ status: 'TASK_PACKAGE_VALID', checkedFiles: actual.length, phases: 8, requiredAcceptance: 72, caseDesigns: 24, wsgsImplementationExecuted: false, publicContractFrozen: false }, null, 2));
} catch (error) {
  console.error(`TASK_PACKAGE_INVALID: ${error.message}`); process.exitCode = 1;
}
