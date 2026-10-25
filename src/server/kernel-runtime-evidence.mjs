/** Private creation-preflight ingestion. No HTTP/CLI import, grant issuance, SDK construction or network. */
import {randomUUID} from 'node:crypto';
import {readFile,open,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {absolute,ownedDirectory,physical,withSetupLock} from '../../cli/setup-state.mjs';
import {validateKernelInitializationIntent} from '../domain/kernel-initialization.mjs';
import {validateKernelCreationPreflightObservation} from './kernel-creation-preflight.mjs';
import {ZERO_DEV_KERNEL_INITIALIZATION_VERSIONS} from '../integrations/zerodev-kernel-initialization.mjs';

const PURPOSE='kernel-account-initialization';
const GAS=['callGasLimit','verificationGasLimit','preVerificationGas','paymasterVerificationGasLimit','paymasterPostOpGasLimit'];
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw Error();const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]?.enumerable||!Object.hasOwn(ds[k],'value')))throw Error();};
const integer=(v,max,zero=false)=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(v)||BigInt(v)>max||!zero&&v==='0')throw Error();return BigInt(v);};
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function endpoint(v){
 if(typeof v!=='string'||v.length>2048||v!==v.trim())throw Error();const u=new URL(v),h=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
 const local=h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.internal')||/^(0|10|127)\./.test(h)||/^169\.254\./.test(h)||/^192\.168\./.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h)||h==='::1'||h==='::'||/^(fc|fd|fe80):/.test(h)||h.startsWith('::ffff:');
 if(u.protocol!=='https:'||!h||local||u.username||u.password||u.hash)throw Error();
}
function privateConfiguration(config,intent){
 exact(config,['paymaster','endpoints','sponsorshipEvidence','limits','preparationAuthorization','submissionAuthorization','readAuthorization']);
 if(typeof config.paymaster!=='string'||!/^0x[a-f0-9]{40}$/.test(config.paymaster)||/^0x0{40}$/.test(config.paymaster))throw Error();
 exact(config.endpoints,['execution','chain','bundler','paymaster']);Object.values(config.endpoints).forEach(endpoint);
 const s=config.sponsorshipEvidence;exact(s,['id','digest','coverage','expiresAt']);if(typeof s.id!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(s.id)||typeof s.digest!=='string'||!/^[a-f0-9]{64}$/.test(s.digest)||s.coverage!=='accepted-no-card-creation-gas-premium-usage-zero-paid-fallback'||!iso(s.expiresAt)||Date.parse(s.expiresAt)>Date.parse(intent.expiresAt))throw Error();
 exact(config.limits,[...GAS,'maxFeePerGas','maxPriorityFeePerGas','maxTotalCostWei']);GAS.forEach(k=>integer(config.limits[k],1000000n));const fee=integer(config.limits.maxFeePerGas,1000000000n);integer(config.limits.maxPriorityFeePerGas,fee,true);if(GAS.reduce((sum,k)=>sum+BigInt(config.limits[k]),0n)*fee>integer(config.limits.maxTotalCostWei,1000000000000000n))throw Error();
 for(const [key,policy,max]of [['preparationAuthorization','fixed-kernel-preparation-eight-requests@1',8],['submissionAuthorization','single-reviewed-kernel-submission@1',1],['readAuthorization','creation-receipt-and-state',20]]){
  const grant=config[key];if(grant===null)continue;const read=key==='readAuthorization';exact(grant,['purpose','intentDigest',read?'scope':'policy','expiresAt','maxRequests']);if(grant.purpose!==PURPOSE||grant.intentDigest!==intent.intentDigest||grant[read?'scope':'policy']!==policy||grant.maxRequests!==max||!iso(grant.expiresAt)||!read&&Date.parse(grant.expiresAt)>Date.parse(intent.expiresAt))throw Error();
 }
 const copy=structuredClone(config);if(Buffer.byteLength(JSON.stringify(copy))>16384)throw Error();return copy;
}
/**
 * Same-UID private server files/configuration are the explicit trust boundary.
 * Deserialization checks historical integrity; it never restores the executor WeakSet brand.
 * The source-registry/configuration resolver must return null on revocation or absent acceptance.
 * A creation-route snapshot alone never establishes gas entitlement, owner key possession,
 * account deployment, token funding, or transfer readiness.
 */
export function createKernelRuntimeEvidenceStore({directory,creationExecutor=null,resolvePrivateConfiguration=null,now=()=>new Date()}={}){
 absolute(directory);
 const checker=creationExecutor&&Object.getOwnPropertyDescriptor(creationExecutor,'isTrustedResult');
 if(creationExecutor!==null&&(!checker||!Object.hasOwn(checker,'value')||typeof checker.value!=='function')||resolvePrivateConfiguration!==null&&typeof resolvePrivateConfiguration!=='function'||typeof now!=='function')throw Error('The private creation evidence store is not configured.');
 const time=()=>{const d=now();if(!(d instanceof Date)||!Number.isFinite(d.getTime()))throw Error();return d.getTime();};
 async function privateDirectory(){const info=await ownedDirectory(directory);if(info.mode&0o077)throw Error();}
 const fileFor=intent=>path.join(directory,`creation-preflight-${intent.intentDigest}.json`);
 async function read(intent){
  await privateDirectory();const file=fileFor(intent),info=await physical(file,{missing:true});if(!info)return null;
  if(!info.isFile()||info.uid!==process.getuid()||info.mode&0o077||info.size>65536)throw Error();const body=JSON.parse(await readFile(file,'utf8'));exact(body,['format','purpose','intentDigest','provenance','observation']);
  if(body.format!=='angbao-private-kernel-creation-preflight@1'||body.purpose!==PURPOSE||body.intentDigest!==intent.intentDigest||body.provenance!=='accepted-executor-snapshot-historical-on-read')throw Error();return validateKernelCreationPreflightObservation(intent,body.observation);
 }
 async function acceptPreflight(value,observation){
  try{
   const intent=validateKernelInitializationIntent(value);if(!checker||checker.value.call(creationExecutor,observation)!==true)throw Error();const checked=validateKernelCreationPreflightObservation(intent,observation);
   if(Date.parse(checked.observedAt)>time()||Date.parse(checked.expiresAt)<=time())throw Error();await privateDirectory();
   return await withSetupLock(directory,async()=>{
    const old=await read(intent);if(old&&old.observationDigest!==checked.observationDigest)throw Error();
    if(!old){
     const body=JSON.stringify({format:'angbao-private-kernel-creation-preflight@1',purpose:PURPOSE,intentDigest:intent.intentDigest,provenance:'accepted-executor-snapshot-historical-on-read',observation:checked});if(Buffer.byteLength(body)>65536)throw Error();
     const temporary=path.join(directory,`.creation-evidence-${randomUUID()}.tmp`);let handle;
     try{handle=await open(temporary,'wx',0o600);await handle.writeFile(body);await handle.sync();await handle.close();handle=null;await rename(temporary,fileFor(intent));const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}}
     finally{await handle?.close();await unlink(temporary).catch(()=>{});}
    }
    return freeze({accepted:true,purpose:PURPOSE,intentDigest:intent.intentDigest,observationDigest:checked.observationDigest,expiresAt:checked.expiresAt,ownerKeyPossessionEstablished:false,accountDeployed:false,tokenFundingEstablished:false,sponsorshipEntitlementEstablished:false,transferReady:false});
   });
  }catch{throw Error('The creation snapshot could not be accepted. Keep the saved evidence and review the exact prerequisites.');}
 }
 async function acceptedEvidence(value,{purpose}={}){
  try{
   if(!['prepare','submit','observe'].includes(purpose)||!resolvePrivateConfiguration)return null;const intent=validateKernelInitializationIntent(value),preflight=await read(intent);
   if(!preflight||Date.parse(preflight.observedAt)>time()||purpose!=='observe'&&(Date.parse(preflight.expiresAt)<=time()||time()<Date.parse(intent.createdAt)||time()>=Date.parse(intent.expiresAt)))return null;
   const config=privateConfiguration(await resolvePrivateConfiguration(freeze({intent:structuredClone(intent),preflight:structuredClone(preflight)}),Object.freeze({purpose})),intent);
   const expiresAt=new Date(Math.min(Date.parse(preflight.expiresAt),Date.parse(config.sponsorshipEvidence.expiresAt),Date.parse(intent.expiresAt))).toISOString();
   const selected=purpose==='prepare'?config.preparationAuthorization:purpose==='submit'?config.submissionAuthorization:config.readAuthorization;
   if(!selected||Date.parse(selected.expiresAt)<=time()||purpose!=='observe'&&Date.parse(expiresAt)<=time())return null;
   return freeze({format:'angbao-accepted-kernel-runtime@1',versions:{...ZERO_DEV_KERNEL_INITIALIZATION_VERSIONS},runtime:{contextId:`creation:${preflight.observationDigest}`,intentDigest:intent.intentDigest,chainId:46630,account:preflight.account,owner:preflight.owner,paymaster:config.paymaster,expiresAt,deployment:'counterfactual-standard-factory-source-verified',ownerValidation:'ecdsa-root-no-hook-initializer-verified',routeEvidenceDigest:preflight.routeEvidenceDigest,sponsorshipEvidence:config.sponsorshipEvidence,limits:config.limits},route:{digest:preflight.routeEvidenceDigest,codeHashes:structuredClone(preflight.codeHashes)},endpoints:config.endpoints,preparationAuthorization:config.preparationAuthorization,submissionAuthorization:config.submissionAuthorization,readAuthorization:config.readAuthorization});
  }catch{return null;}
 }
 return Object.freeze({acceptPreflight,acceptedEvidence});
}
