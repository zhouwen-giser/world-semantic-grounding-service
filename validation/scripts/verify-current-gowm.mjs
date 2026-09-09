import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.resolve(process.argv[2] ?? 'contracts/upstream/gowm-current');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const hash = p => createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex');
const snapshot = read('SNAPSHOT.json');
for(const [file,expected] of [['ALIGNMENT.json',snapshot.alignmentSha256],['PROVIDER_INPUTS.json',snapshot.providerInputsSha256],['OPERATION_LOCK.json',snapshot.operationalLockSha256],['CATALOG.json',snapshot.catalogSha256],['analysis/source.json',snapshot.analysisSourceSha256]]){
 if(hash(file)!==expected) throw Error('CURRENT_DERIVED_ARTIFACT_DRIFT');
}
for(const entry of read('analysis/source.json').files) if('sha256:'+hash('analysis/'+entry.path)!==entry.sha256) throw Error('CURRENT_ANALYSIS_ARTIFACT_DRIFT');
for(const [file,expected] of Object.entries(snapshot.gdpsArtifacts)) if(hash('gdps/'+file)!==expected) throw Error('CURRENT_GDPS_ARTIFACT_DRIFT');
if(hash('bundle/MANIFEST.json') !== snapshot.manifestSha256 || hash(snapshot.lockPath) !== snapshot.lockSha256) throw Error('CURRENT_SNAPSHOT_DRIFT');
const ajv = new Ajv({strict:true, strictRequired:false, strictTypes:false, strictTuples:false, allErrors:true});
addFormats(ajv);
// Schema identity belongs to the bundle, not the host filesystem. In particular,
// Ajv normalizes %7E to ~ when resolving references in Windows short temp paths.
// This namespace is an in-memory registry only; schemas are never fetched.
const schemaUri = relative => new URL(relative, 'https://wsgs.invalid/consumer/').href;
const schemas = [];
for(const entry of [...read('bundle/MANIFEST.json').files, ...Object.entries(snapshot.supportingSchemas).map(([p,v])=>({path:p,sha256:v.sha256}))]){
  if(hash('bundle/'+entry.path) !== entry.sha256) throw Error('CURRENT_MANIFEST_DRIFT');
  if(!entry.path.startsWith('schemas/') || !entry.path.endsWith('.schema.json')) continue;
  const uri = schemaUri('bundle/' + entry.path);
  ajv.addSchema({...read('bundle/'+entry.path), $id:uri},uri);
  schemas.push(uri);
}
for(const uri of schemas) ajv.getSchema(uri);
const validate = ajv.getSchema(schemaUri(snapshot.lockSchemaPath));
if(!validate(read(snapshot.lockPath))) throw Error('CURRENT_LOCK_SCHEMA_MISMATCH');
if(!validate(read(snapshot.operationalLockPath))) throw Error('CURRENT_COMBINED_LOCK_SCHEMA_MISMATCH');
console.log(JSON.stringify({status:'PASS', packageVersion:snapshot.packageVersion, schemas:schemas.length}));
