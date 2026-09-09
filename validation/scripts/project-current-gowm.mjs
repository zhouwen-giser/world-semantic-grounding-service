import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(process.argv[2]);
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n');
const canonical=v=>JSON.stringify(v,(_k,x)=>x && typeof x==='object' && !Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a<b?-1:a>b?1:0)):x);
const hash=v=>'sha256:'+createHash('sha256').update(canonical(v)).digest('hex');
const snapshot=read('SNAPSHOT.json'), base=read(snapshot.lockPath), inputs=read('PROVIDER_INPUTS.json');
const ordered=inputs.providers.sort((a,b)=>a.registration.providerId<b.registration.providerId?-1:1);
const capabilities=[];
for(const {registration:r,manifest:m} of ordered){
 if(hash(m)!==r.manifestHash || m.provider.providerId!==r.providerId || m.provider.providerVersion!==r.providerVersion || m.provider.implementationDigest!==r.implementationDigest) throw Error('FORMAL_PROVIDER_MANIFEST_MISMATCH');
 capabilities.push(...m.capabilities);
}
capabilities.sort((a,b)=>`${a.operationId}@${a.operationVersion}`<`${b.operationId}@${b.operationVersion}`?-1:1);
if(new Set(capabilities.map(c=>`${c.operationId}@${c.operationVersion}`)).size!==capabilities.length) throw Error('DUPLICATE_FORMAL_OPERATION');
const contracts=ordered.map(({manifest:m})=>({providerId:m.provider.providerId,providerVersion:m.provider.providerVersion,manifestSchemaVersion:m.manifestSchemaVersion??'1.0',capabilities:[...m.capabilities].sort((a,b)=>`${a.operationId}@${a.operationVersion}`<`${b.operationId}@${b.operationVersion}`?-1:1).map(c=>({operationId:c.operationId,operationVersion:c.operationVersion,contractHash:hash(c)}))}));
const profiles=capabilities.map(c=>({operationId:c.operationId,operationVersion:c.operationVersion,semanticProfile:c.semanticProfile,semanticProfileHash:hash(c.semanticProfile)}));
const operations=capabilities.map(c=>({operationId:c.operationId,operationVersion:c.operationVersion,inputSchemaHash:c.inputSchemaHash,outputSchemaHash:c.outputSchemaHash,semanticProfileHash:hash(c.semanticProfile),maturity:c.maturity,requiredPermissions:[c.scopePolicy==='DATASET_SCOPE_REQUIRED'?'dataset:read':c.scopePolicy==='DATA_SCOPE_REQUIRED'?'data:read':'gateway:execute'],snapshotSupport:c.snapshotPolicy.dataSnapshot==='REQUIRED'?'CONSISTENT_AT_START':c.snapshotPolicy.dataSnapshot==='OPTIONAL'?'BEST_EFFORT':'NONE'}));
const lock={...base,contractCatalogRevision:hash({vocabularyHash:hash(inputs.vocabularies),providers:contracts}),semanticCatalogHash:hash(profiles),defaultOperations:operations.filter(c=>c.maturity==='STABLE'),previewOperations:operations.filter(c=>c.maturity==='PREVIEW')};
if(operations.some(c=>!['STABLE','PREVIEW','EXPERIMENTAL','DEPRECATED'].includes(c.maturity))) throw Error('UNSUPPORTED_FORMAL_MATURITY');
snapshot.excludedOperations=operations.filter(c=>!['STABLE','PREVIEW'].includes(c.maturity)).map(c=>({operationId:c.operationId,operationVersion:c.operationVersion,maturity:c.maturity}));
for(const entry of [...base.defaultOperations,...base.previewOperations]){
 const actual=operations.find(c=>c.operationId===entry.operationId && c.operationVersion===entry.operationVersion);
 if(!actual || canonical(actual)!==canonical(entry)) throw Error('BASE_PROVIDER_CONTRACT_DRIFT:'+entry.operationId);
}
write('OPERATION_LOCK.json',lock);
write('CATALOG.json',{capabilities,profiles});
snapshot.operationalLockPath='OPERATION_LOCK.json';
snapshot.operationalLockSha256=createHash('sha256').update(fs.readFileSync(path.join(root,'OPERATION_LOCK.json'))).digest('hex');
snapshot.catalogSha256=createHash('sha256').update(fs.readFileSync(path.join(root,'CATALOG.json'))).digest('hex');
write('SNAPSHOT.json',snapshot);
// Keep the established metadata interface, populated from this release only.
const alignment=JSON.parse(fs.readFileSync('contracts/upstream/gowm-runtime-contract-alignment-lock-v1.json','utf8'));
alignment.alignmentId='wsgs-gowm-published-'+snapshot.source.sha256.slice(0,16);
alignment.requiredTuple.gowmRuntimeVersion=snapshot.runtimeVersion;
alignment.requiredTuple.gatewayContractVersion=snapshot.gatewayContractVersion;
alignment.requiredTuple.gatewayConsumerPackageVersion=snapshot.packageVersion;
Object.assign(alignment.gowmRuntime,{sourceCommit:snapshot.source.sourceLock.sourceCommit,softwareVersion:snapshot.runtimeVersion,versionAuthority:'SNAPSHOT.json/source'});
Object.assign(alignment.gatewayContract,{packageVersion:snapshot.packageVersion,gatewayContractVersion:snapshot.gatewayContractVersion,
 consumerLogicalIntegrity:base.consumerContractPackage.integrity,contractCatalogRevision:lock.contractCatalogRevision,semanticCatalogHash:lock.semanticCatalogHash,
 availabilityContractHash:base.availabilityContractHash,snapshotContractHash:base.snapshotContractHash,delegationContractHash:base.delegationContractHash,
 southboundLockFileSha256:'sha256:'+snapshot.operationalLockSha256,packageVersionAuthority:'package.json/version',gatewayContractVersionAuthority:snapshot.lockPath});
alignment.criticalOperationFingerprints=alignment.criticalOperationFingerprints.map(old=>{
 const actual=operations.find(c=>c.operationId===old.operationId&&c.operationVersion===old.operationVersion);
 if(!actual)throw Error('CRITICAL_OPERATION_REMOVED:'+old.operationId);
 return actual;
});
alignment.declaredSemanticProfileMigrations=[];
alignment.compatibilityPolicy.classification='VERIFIED_PUBLISHED_CONSUMER_SNAPSHOT';
write('ALIGNMENT.json',alignment);

snapshot.alignmentSha256=createHash('sha256').update(fs.readFileSync(path.join(root,'ALIGNMENT.json'))).digest('hex');
const recipeTemplatePath='contracts/generated/gdps-v0.2.1/wsgs-gdps-recipe-lock.json';
const recipeTemplate=JSON.parse(fs.readFileSync(recipeTemplatePath,'utf8'));
const previous=JSON.parse(fs.readFileSync('contracts/generated/gdps-v0.2.1/gdps-consumer-snapshot.json','utf8'));
const gdps=ordered.find(p=>p.registration.providerId==='gdps.geospatial-products');
if(!gdps)throw Error('GDPS_FORMAL_PROVIDER_MISSING');
const descriptors=read('gdps/product-type-descriptors.json');
const recipeLock={...recipeTemplate,providerVersion:gdps.registration.providerVersion,
 productTypeCount:new Set(descriptors.descriptors.map(d=>d.productType)).size,profileCount:descriptors.descriptors.length,
 descriptorRegistryHash:hash(descriptors),capabilityLockHash:hash(gdps.manifest.capabilities)};
recipeLock.recipes=recipeLock.recipes.map(recipe=>({...recipe,
 descriptorConstraint:recipe.descriptorConstraint?{descriptorId:recipe.descriptorConstraint.descriptorId,descriptorHash:hash(descriptors.descriptors.find(d=>d.descriptorId===recipe.descriptorConstraint.descriptorId)??(()=>{throw Error('GDPS_RECIPE_DESCRIPTOR_REMOVED')})())}:null,
 allowedOperations:recipe.allowedOperations.map(old=>{
  const c=operations.find(c=>c.operationId===old.operationId&&c.operationVersion===old.operationVersion);
  if(!c||c.outputSchemaHash!==old.outputSchemaHash||c.semanticProfileHash!==old.semanticProfileHash)throw Error('GDPS_RECIPE_SEMANTIC_MIGRATION_REQUIRED');
  return {operationId:c.operationId,operationVersion:c.operationVersion,inputSchemaHash:c.inputSchemaHash,outputSchemaHash:c.outputSchemaHash,semanticProfileHash:c.semanticProfileHash};
 })}));
write('gdps/wsgs-gdps-recipe-lock.json',recipeLock);
const extension={...previous,providerVersion:gdps.registration.providerVersion,consumerLockHash:hash({provider:gdps.registration,recipeTemplate:hash(recipeTemplate)}),
 capabilityLockHash:recipeLock.capabilityLockHash,descriptorLockHash:recipeLock.descriptorRegistryHash,
 recipeLockHash:'sha256:'+createHash('sha256').update(fs.readFileSync(path.join(root,'gdps/wsgs-gdps-recipe-lock.json'))).digest('hex'),
 productTypeCount:recipeLock.productTypeCount,descriptorProfileCount:recipeLock.profileCount};
delete extension.capabilitySnapshotHash;
extension.capabilitySnapshotHash=hash(extension);
write('gdps/gdps-consumer-snapshot.json',extension);
snapshot.gdpsArtifacts=Object.fromEntries(['product-type-descriptors.json','product-vocabularies.json','wsgs-gdps-recipe-lock.json','gdps-consumer-snapshot.json'].map(n=>[n,createHash('sha256').update(fs.readFileSync(path.join(root,'gdps',n))).digest('hex')]));
snapshot.gdpsRecipeTemplateSha256=createHash('sha256').update(fs.readFileSync(recipeTemplatePath)).digest('hex');
write('SNAPSHOT.json',snapshot);
