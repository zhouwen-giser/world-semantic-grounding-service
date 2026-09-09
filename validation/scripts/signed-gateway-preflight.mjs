import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {GowmGatewayClient} from '../../packages/gowm-gateway-client/dist/index.js';
import {GowmDelegationSigner,createGroundingIdentity} from '../../packages/delegated-identity/dist/index.js';
import {currentGowmPath,currentGowmSnapshot} from '../../packages/gowm-contract-intake/dist/index.js';
const e=process.env;
const lock=JSON.parse(readFileSync(currentGowmPath(currentGowmSnapshot.operationalLockPath),'utf8'));
const identity=createGroundingIdentity({servicePrincipalId:e.GOWM_DELEGATION_SERVICE_PRINCIPAL_ID,actorId:'wsgs-contract-preflight',
 dataScopes:[e.WSGS_READINESS_DATA_SCOPE],datasetScopes:(e.WSGS_READINESS_DATASET_SCOPES??'').split(',').filter(Boolean),permissions:['data:read','dataset:read','gateway:execute']});
const signer=new GowmDelegationSigner({issuer:e.GOWM_DELEGATION_ISSUER,audience:e.GOWM_DELEGATION_AUDIENCE,
 servicePrincipalId:identity.servicePrincipalId,privateKeyPkcs8:readFileSync(e.GOWM_DELEGATION_PRIVATE_KEY_FILE,'utf8'),trustedOperationKeys:['reference.get@1.0']});
const client=new GowmGatewayClient({baseUrl:e.GOWM_GATEWAY_BASE_URL,credential:()=>e.GOWM_GATEWAY_TOKEN,maxRetries:0,timeoutMs:20000});
const [catalog,semantics]=await Promise.all([client.listCapabilities(),client.listCapabilitySemantics()]);
if(catalog.contractCatalogRevision!==lock.contractCatalogRevision||semantics.catalogHash!==lock.semanticCatalogHash)throw Error('DEPLOYED_FORMAL_CATALOG_MISMATCH');
const requestId=randomUUID();
const signed=await signer.sign({identity,requestId,kind:'DIRECT_OPERATION',operation:{operationId:'reference.get',operationVersion:'1.0'}});
const available=await client.listOperationAvailability({requestId,delegationToken:signed.token});
if(!available.operations.some(o=>o.operationId==='reference.get'&&o.availability==='AVAILABLE'))throw Error('SIGNED_REFERENCE_OPERATION_UNAVAILABLE');
async function deny(token){
 const r=await fetch(new URL('/v1/operation-availability',e.GOWM_GATEWAY_BASE_URL),{headers:{authorization:'Bearer '+e.GOWM_GATEWAY_TOKEN,'x-gowm-delegation':token,'x-request-id':requestId},signal:AbortSignal.timeout(10000)});
 if(![401,403].includes(r.status))throw Error('DELEGATION_NEGATIVE_NOT_REJECTED');
 return r.status;
}
const wrongSignature=await deny(signed.token.slice(0,-16)+'AAAAAAAAAAAAAAAA');
const wrongScope=await signer.sign({identity:createGroundingIdentity({...identity,dataScopes:['wsgs-ungranted-preflight']}),requestId,
 kind:'DIRECT_OPERATION',operation:{operationId:'reference.get',operationVersion:'1.0'}});
const deniedScope=await deny(wrongScope.token);
console.log(JSON.stringify({status:'PASS',gatewayContractVersion:currentGowmSnapshot.gatewayContractVersion,
 capabilities:catalog.capabilities.length,semanticProfiles:semantics.profiles.length,contractCatalogRevision:catalog.contractCatalogRevision,
 semanticCatalogHash:semantics.catalogHash,signedAvailability:'PASS',wrongSignature,deniedScope}));
