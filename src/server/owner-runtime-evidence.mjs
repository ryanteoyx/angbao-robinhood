/** Private identity-evidence ingestion. Not a workspace import or provider activation endpoint. */
import {randomUUID} from 'node:crypto';
import {readFile,open,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {absolute,ownedDirectory,physical,withSetupLock} from '../../cli/setup-state.mjs';
import {validateGoalTransferIntent} from '../domain/goal-transfer.mjs';
import {validateOwnerIdentityObservation} from './owner-identity-preflight.mjs';
import {ZERO_DEV_OWNER_BRIDGE_VERSIONS} from '../integrations/zerodev-owner-bridge.mjs';
const GAS=['callGasLimit','verificationGasLimit','preVerificationGas','paymasterVerificationGasLimit','paymasterPostOpGasLimit'];
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw Error();const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]?.enumerable||!Object.hasOwn(ds[k],'value')))throw Error();};
const integer=(v,max,zero=false)=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(v)||BigInt(v)>max||!zero&&v==='0')throw Error();return BigInt(v);};
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
function privateConfiguration(config,intent){
 exact(config,['paymaster','endpoints','sponsorshipEvidence','limits','preparationAuthorization','submissionAuthorization','readAuthorization']);
 if(typeof config.paymaster!=='string'||!/^0x[a-f0-9]{40}$/.test(config.paymaster)||/^0x0{40}$/.test(config.paymaster))throw Error();
 exact(config.endpoints,['execution','chain','bundler','paymaster']);for(const value of Object.values(config.endpoints)){if(typeof value!=='string'||value.length>2048)throw Error();const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error();}
 const s=config.sponsorshipEvidence;exact(s,['id','digest','coverage','expiresAt']);if(typeof s.id!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(s.id)||typeof s.digest!=='string'||!/^[a-f0-9]{64}$/.test(s.digest)||s.coverage!=='accepted-no-card-all-gas-premium-usage-zero-paid-fallback'||!iso(s.expiresAt)||Date.parse(s.expiresAt)>Date.parse(intent.expiresAt))throw Error();
 exact(config.limits,[...GAS,'maxFeePerGas','maxPriorityFeePerGas','maxTotalCostWei']);GAS.forEach(k=>integer(config.limits[k],1000000n));const fee=integer(config.limits.maxFeePerGas,1000000000n);integer(config.limits.maxPriorityFeePerGas,fee,true);if(GAS.reduce((n,k)=>n+BigInt(config.limits[k]),0n)*fee>integer(config.limits.maxTotalCostWei,1000000000000000n))throw Error();
 for(const [key,policy,max]of [['preparationAuthorization','fixed-owner-preparation-seven-requests@1',7],['submissionAuthorization','single-reviewed-owner-submission@1',1],['readAuthorization','receipt-only-recovery',12]]){const grant=config[key];if(grant===null)continue;const read=key==='readAuthorization';exact(grant,['intentDigest',read?'scope':'policy','expiresAt','maxRequests']);if(grant.intentDigest!==intent.intentDigest||grant[read?'scope':'policy']!==policy||grant.maxRequests!==max||!iso(grant.expiresAt)||!read&&Date.parse(grant.expiresAt)>Date.parse(intent.expiresAt))throw Error();}
 return structuredClone(config);
}
/** Only a private executor brand may ingest a snapshot. Reading a saved snapshot does not recreate that brand. */
export function createOwnerRuntimeEvidenceStore({directory,identityExecutor=null,resolvePrivateConfiguration=null,now=()=>new Date()}={}){
 absolute(directory);if(identityExecutor!==null&&typeof identityExecutor.isTrustedResult!=='function'||resolvePrivateConfiguration!==null&&typeof resolvePrivateConfiguration!=='function'||typeof now!=='function')throw Error('The private evidence store is not configured.');
 const time=()=>{const d=now();if(!(d instanceof Date)||!Number.isFinite(d.getTime()))throw Error();return d.getTime();};
 async function privateDirectory(){const info=await ownedDirectory(directory);if(info.mode&0o077)throw Error();}
 const fileFor=intent=>path.join(directory,`identity-${intent.intentDigest}.json`);
 async function read(intent){await privateDirectory();const file=fileFor(intent),info=await physical(file,{missing:true});if(!info)return null;if(!info.isFile()||info.uid!==process.getuid()||info.mode&0o077||info.size>65536)throw Error();const body=JSON.parse(await readFile(file,'utf8'));exact(body,['format','intentDigest','observation']);if(body.format!=='angbao-private-owner-identity@1'||body.intentDigest!==intent.intentDigest)throw Error();return validateOwnerIdentityObservation(intent,body.observation);}
 async function acceptIdentity(value,observation){
  try{const intent=validateGoalTransferIntent(value);if(!identityExecutor||identityExecutor.isTrustedResult(observation)!==true)throw Error();const checked=validateOwnerIdentityObservation(intent,observation);if(Date.parse(checked.observedAt)>time()||Date.parse(checked.expiresAt)<=time())throw Error();await privateDirectory();
   return await withSetupLock(directory,async()=>{const old=await read(intent);if(old&&old.observationDigest!==checked.observationDigest)throw Error();if(!old){const body=JSON.stringify({format:'angbao-private-owner-identity@1',intentDigest:intent.intentDigest,observation:checked});if(Buffer.byteLength(body)>65536)throw Error();const temporary=path.join(directory,`.identity-evidence-${randomUUID()}.tmp`);let handle;
    try{handle=await open(temporary,'wx',0o600);await handle.writeFile(body);await handle.sync();await handle.close();handle=null;await rename(temporary,fileFor(intent));const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}}finally{await handle?.close();await unlink(temporary).catch(()=>{});}}
    return Object.freeze({accepted:true,intentDigest:intent.intentDigest,observationDigest:checked.observationDigest,expiresAt:checked.expiresAt,ownerPossessionEstablished:false,sponsorshipEstablished:false});});
  }catch{throw Error('The identity snapshot could not be accepted. Keep the saved evidence and review the exact prerequisites.');}
 }
 async function acceptedEvidence(value,{purpose}={}){
  try{if(!['prepare','submit','observe'].includes(purpose)||!resolvePrivateConfiguration)return null;const intent=validateGoalTransferIntent(value),identity=await read(intent);if(!identity||Date.parse(identity.observedAt)>time()||purpose!=='observe'&&Date.parse(identity.expiresAt)<=time())return null;
   const config=privateConfiguration(await resolvePrivateConfiguration(Object.freeze({intent:structuredClone(intent),identity:structuredClone(identity)}),Object.freeze({purpose})),intent);
   const expiresAt=new Date(Math.min(Date.parse(identity.expiresAt),Date.parse(config.sponsorshipEvidence.expiresAt),Date.parse(intent.expiresAt))).toISOString();
   const selected=purpose==='prepare'?config.preparationAuthorization:purpose==='submit'?config.submissionAuthorization:config.readAuthorization;
   if(!selected||Date.parse(selected.expiresAt)<=time()||purpose!=='observe'&&Date.parse(expiresAt)<=time())return null;
   return Object.freeze({format:'angbao-accepted-owner-runtime@1',versions:{...ZERO_DEV_OWNER_BRIDGE_VERSIONS},runtime:{contextId:`identity:${identity.observationDigest}`,intentDigest:intent.intentDigest,chainId:46630,account:identity.account,owner:identity.owner,paymaster:config.paymaster,expiresAt,deployment:'existing-account-and-token-source-verified',ownerValidation:'ecdsa-root-no-hook-verified',tokenVerification:'test-token-recipient-and-balance-verified',sponsorshipEvidence:config.sponsorshipEvidence,limits:config.limits},endpoints:config.endpoints,preparationAuthorization:config.preparationAuthorization,submissionAuthorization:config.submissionAuthorization,readAuthorization:config.readAuthorization});
  }catch{return null;}
 }
 return Object.freeze({acceptIdentity,acceptedEvidence});
}
