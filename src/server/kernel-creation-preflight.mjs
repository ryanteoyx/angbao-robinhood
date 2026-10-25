/** Fixed pre-sign creation route verification. No SDK, signer, quotes or provider activation. */
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {validateKernelInitializationIntent,KERNEL_INITIALIZATION_ROUTE as R} from '../domain/kernel-initialization.mjs';
import {parseAbi,encodeFunctionData,decodeFunctionResult} from '../vendor/kernel-identity-codecs.mjs';
import {encodeAbiParameters} from '../vendor/goal-transfer-viem.mjs';
if(typeof window!=='undefined')throw Error('Creation preflight is server-only.');
export const KERNEL_CREATION_PREFLIGHT_LIMITS=Object.freeze({requests:15,packetRequests:12,responseBytes:131072,packetBytes:1048576,requestTimeoutMs:5000,scopeTimeoutMs:30000});
export const KERNEL_CREATION_SOURCE_FORMAT='angbao-kernel-creation-source@1';
export const KERNEL_CREATION_INITIALIZER_POLICY='kernel-0.3.1-ecdsa-index0-no-hook-empty-config@1';
const PURPOSE='kernel-creation-route-preflight',ROLES=['implementation','validator','entryPoint','kernelFactory','factory'];
const EMPTY_SHA='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',ZERO_ADDRESS='0x'+'0'.repeat(40),RAW_SALT='0x'+'0'.repeat(64);
const ABI=parseAbi(['function approved(address) view returns(bool)','function implementation() view returns(address)','function entrypoint() view returns(address)','function getAddress(bytes,bytes32) view returns(address)']);
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),hash=v=>typeof v==='string'&&/^0x[a-f0-9]{64}$/.test(v);
const exact=(v,keys)=>v&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable&&Object.hasOwn(d,'value');});
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export class KernelCreationPreflightError extends Error{constructor(code){super(`Account setup verification stopped: ${code}.`);this.name='KernelCreationPreflightError';this.code=code;}}
const fail=code=>{throw new KernelCreationPreflightError(code);};
function quantity(v){if(typeof v!=='string'||!/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(v))fail('malformed_result');return BigInt(v);}
function iso(v){return typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;}
function bytesSha(v){if(typeof v!=='string'||!/^0x(?:[a-f0-9]{2})*$/.test(v))fail('malformed_result');return createHash('sha256').update(Buffer.from(v.slice(2),'hex')).digest('hex');}
function endpoint(v){let u;try{if(typeof v!=='string'||v.length>2048||v!==v.trim())throw Error();u=new URL(v);}catch{fail('configuration');}const h=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');const local=h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.internal')||/^(0|10|127)\./.test(h)||/^169\.254\./.test(h)||/^192\.168\./.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h)||h==='::1'||h==='::'||/^(fc|fd|fe80):/.test(h)||h.startsWith('::ffff:');if(u.protocol!=='https:'||!h||local||u.username||u.password||u.hash)fail('configuration');return u.href;}
function header(v){if(!v||!hash(v.hash))fail('malformed_result');return {chainId:46630,blockNumber:quantity(v.number).toString(),blockHash:v.hash,blockTimestamp:quantity(v.timestamp).toString()};}
function source(v,intent){
 if(!exact(v,['format','chainId','routeEvidenceDigest','sourceRegistryDigest','initializerPolicy','codeHashes'])||v.format!==KERNEL_CREATION_SOURCE_FORMAT||v.chainId!==46630||v.routeEvidenceDigest!==intent.routeEvidenceDigest||!sha(v.sourceRegistryDigest)||v.initializerPolicy!==KERNEL_CREATION_INITIALIZER_POLICY||!exact(v.codeHashes,ROLES)||Object.values(v.codeHashes).some(v=>!sha(v)||v===EMPTY_SHA))fail('source_not_accepted');return freeze(structuredClone(v));
}
function decode(name,v){try{const outputs=ABI.find(f=>f.name===name).outputs;const result=decodeFunctionResult({abi:ABI,functionName:name,data:v});if(encodeAbiParameters(outputs,[result])!==v)fail('malformed_result');return result;}catch{fail('malformed_result');}}
const proofDigest=body=>digest({domain:'angbao.kernel-creation-preflight.v1',observation:body});
/** Historical integrity only; never restores original executor branding or permission. */
export function validateKernelCreationPreflightObservation(value,observation){
 let intent;try{intent=validateKernelInitializationIntent(value);}catch{fail('invalid_intent');}
 const keys=['format','purpose','intentDigest','routeEvidenceDigest','owner','account','checkpoint','sourceRegistryDigest','codeHashes','relations','initialization','service','observedAt','expiresAt','readCount','verificationSource','ownerKeyPossessionEstablished','accountDeployed','tokenFundingEstablished','sponsorshipEntitlementEstablished','signingAllowed','deploymentAllowed','submissionAllowed','observationDigest'];
 const o=observation;if(!exact(o,keys)||o.format!=='angbao-kernel-creation-preflight@1'||o.purpose!=='kernel-account-initialization'||o.intentDigest!==intent.intentDigest||o.routeEvidenceDigest!==intent.routeEvidenceDigest||o.owner!==intent.owner||o.account!==intent.account||!sha(o.sourceRegistryDigest)||!exact(o.codeHashes,ROLES)||Object.values(o.codeHashes).some(v=>!sha(v)||v===EMPTY_SHA))fail('invalid_observation');
 if(!exact(o.checkpoint,['chainId','blockNumber','blockHash','blockTimestamp'])||o.checkpoint.chainId!==46630||!hash(o.checkpoint.blockHash)||!['blockNumber','blockTimestamp'].every(k=>typeof o.checkpoint[k]==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(o.checkpoint[k])&&BigInt(o.checkpoint[k])<(1n<<256n)))fail('invalid_observation');
 if(!exact(o.relations,['factoryApproved','factoryImplementation','implementationEntryPoint','factoryPredictedAccount','predictedAccountCodeEmpty'])||o.relations.factoryApproved!==true||o.relations.factoryImplementation!==R.implementation||o.relations.implementationEntryPoint!==R.entryPoint||o.relations.factoryPredictedAccount!==intent.account||o.relations.predictedAccountCodeEmpty!==true)fail('invalid_observation');
 const expectedInitialization={index:'0',rootValidator:intent.rootValidator,owner:intent.owner,hookInput:ZERO_ADDRESS,hookData:'0x',initConfigCount:0,initializationDataSha256:bytesSha(intent.initializationData),factoryDataSha256:bytesSha(intent.factoryData),callDataSha256:bytesSha(intent.callData)};
 if(!exact(o.initialization,Object.keys(expectedInitialization))||canonical(o.initialization)!==canonical(expectedInitialization)||!exact(o.service,['chainId','entryPoint','entryPointSupported'])||o.service.chainId!==46630||o.service.entryPoint!==R.entryPoint||o.service.entryPointSupported!==true||o.readCount!==15||o.verificationSource!=='fixed-server-provider-read'||['ownerKeyPossessionEstablished','accountDeployed','tokenFundingEstablished','sponsorshipEntitlementEstablished','signingAllowed','deploymentAllowed','submissionAllowed'].some(k=>o[k]!==false))fail('invalid_observation');
 const start=Date.parse(o.observedAt),end=Date.parse(o.expiresAt),blockTime=Number(o.checkpoint.blockTimestamp)*1000;if(!iso(o.observedAt)||!iso(o.expiresAt)||start<Date.parse(intent.createdAt)||end<=start||end-start>300000||end>Date.parse(intent.expiresAt)||blockTime>start+30000||start-blockTime>300000)fail('invalid_observation');
 const {observationDigest,...body}=o;if(!sha(observationDigest)||proofDigest(body)!==observationDigest)fail('invalid_observation');return freeze(structuredClone(o));
}
/** The selected mode always includes its own two bundler reads:15 total, never inherited authorization. */
export function createKernelCreationPreflightExecutor({resolveSourceArtifacts=async()=>null,chainRpcUrl=null,bundlerRpcUrl=null,authorizePlan=async()=>false,reserveRequest=async()=>false,fetchImpl=globalThis.fetch,now=()=>new Date()}={}){
 if([resolveSourceArtifacts,authorizePlan,reserveRequest,fetchImpl,now].some(v=>typeof v!=='function'))fail('configuration');
 const attempts=new Set(),trusted=new WeakSet();
 const time=()=>{const d=now();if(!(d instanceof Date)||!Number.isFinite(d.getTime()))fail('configuration');return d.getTime();};
 async function verify(value){
  let intent;try{intent=validateKernelInitializationIntent(value);}catch{fail('invalid_intent');}if(time()<Date.parse(intent.createdAt)||time()>=Date.parse(intent.expiresAt))fail('intent_expired');if(attempts.has(intent.intentDigest)||attempts.size>=64)fail('scope_used');attempts.add(intent.intentDigest);
  let artifacts;try{artifacts=source(await resolveSourceArtifacts(freeze(structuredClone(intent))),intent);}catch{fail('source_not_accepted');}
  const chain=endpoint(chainRpcUrl),bundler=endpoint(bundlerRpcUrl),started=performance.now();let count=0,phase=null,packetBytes=0;
  const current=()=>{if(performance.now()-started>=30000||time()>=Date.parse(intent.expiresAt))fail('scope_expired');};
  async function read(nextPhase,role,method,params){
   current();if(count>=15)fail('scope_used');if(nextPhase!==phase){phase=nextPhase;packetBytes=0;}
   const index=count+1,proposal=freeze({format:'angbao-kernel-creation-preflight-read-plan@1',purpose:PURPOSE,intentDigest:intent.intentDigest,routeEvidenceDigest:intent.routeEvidenceDigest,sourceRegistryDigest:artifacts.sourceRegistryDigest,index,phase,role,method,params:structuredClone(params),requestCount:1,alreadyAttempted:count,limits:KERNEL_CREATION_PREFLIGHT_LIMITS});
   let authorized=false;try{authorized=await authorizePlan(proposal)===true;}catch{}if(!authorized)fail('authorization_denied');current();
   const requestKey=digest(proposal),reservation=freeze({purpose:PURPOSE,intentDigest:intent.intentDigest,routeEvidenceDigest:intent.routeEvidenceDigest,sourceRegistryDigest:artifacts.sourceRegistryDigest,index,phase,role,method,requestKey});
   let reserved=false;try{reserved=await reserveRequest(reservation)===true;}catch{}if(!reserved)fail('reservation_denied');count++;current();
   const controller=new AbortController();let timer;
   try{return await Promise.race([(async()=>{
    const response=await fetchImpl(role==='execution'?chain:bundler,{method:'POST',redirect:'error',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:index,method,params}),signal:controller.signal});if(!response?.ok||response.status!==200)fail('provider_rejected');
    if(!response.body?.getReader)fail('malformed_rpc');const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0;
    try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>131072||packetBytes+bytes>1048576){controller.abort();await reader.cancel();fail('response_too_large');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}packetBytes+=bytes;current();
    let rpc;try{rpc=JSON.parse(text);}catch{fail('malformed_rpc');}if(!exact(rpc,['jsonrpc','id','result'])||rpc.jsonrpc!=='2.0'||rpc.id!==index)fail('malformed_rpc');return rpc.result;
   })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new KernelCreationPreflightError('timeout'));},Math.max(1,Math.min(5000,30000-(performance.now()-started))));})]);}
   catch(error){if(error instanceof KernelCreationPreflightError)throw error;fail('provider_unavailable');}finally{clearTimeout(timer);controller.abort();}
  }
  if(quantity(await read('discovery','execution','eth_chainId',[]))!==46630n)fail('wrong_chain');
  const checkpoint=header(await read('discovery','execution','eth_getBlockByNumber',['latest',false]));if(time()-Number(checkpoint.blockTimestamp)*1000>300000||Number(checkpoint.blockTimestamp)*1000>time()+30000)fail('stale_checkpoint');
  const pin={blockHash:checkpoint.blockHash,requireCanonical:true},codeHashes={};for(const role of ROLES){const runtime=await read('code','execution','eth_getCode',[R[role],pin]);if(runtime==='0x'||(codeHashes[role]=bytesSha(runtime))!==artifacts.codeHashes[role])fail('source_mismatch');}
  const call=async(to,name,args=[])=>decode(name,await read('state','execution','eth_call',[{to,data:encodeFunctionData({abi:ABI,functionName:name,args})},pin]));
  if(await call(R.factory,'approved',[R.kernelFactory])!==true)fail('factory_not_approved');
  if((await call(R.kernelFactory,'implementation')).toLowerCase()!==R.implementation)fail('implementation_mismatch');
  if((await call(R.implementation,'entrypoint')).toLowerCase()!==R.entryPoint)fail('entrypoint_mismatch');
  if((await call(R.kernelFactory,'getAddress',[intent.initializationData,RAW_SALT])).toLowerCase()!==intent.account)fail('prediction_mismatch');
  if(await read('state','execution','eth_getCode',[intent.account,pin])!=='0x')fail('existing_account_requires_verification');
  const recheck=header(await read('canonical-recheck','execution','eth_getBlockByNumber',[`0x${BigInt(checkpoint.blockNumber).toString(16)}`,false]));if(canonical(checkpoint)!==canonical(recheck))fail('snapshot_changed');
  if(quantity(await read('service','bundler','eth_chainId',[]))!==46630n)fail('wrong_bundler_chain');
  const supported=await read('service','bundler','eth_supportedEntryPoints',[]);if(!Array.isArray(supported)||supported.length>32||!supported.every(a=>typeof a==='string'&&/^0x[a-f0-9]{40}$/.test(a))||!supported.includes(R.entryPoint))fail('bundler_entrypoint_unsupported');
  current();const observedAt=new Date(time()).toISOString(),expiresAt=new Date(Math.min(time()+300000,Date.parse(intent.expiresAt))).toISOString();
  const body={format:'angbao-kernel-creation-preflight@1',purpose:'kernel-account-initialization',intentDigest:intent.intentDigest,routeEvidenceDigest:intent.routeEvidenceDigest,owner:intent.owner,account:intent.account,checkpoint,sourceRegistryDigest:artifacts.sourceRegistryDigest,codeHashes,relations:{factoryApproved:true,factoryImplementation:R.implementation,implementationEntryPoint:R.entryPoint,factoryPredictedAccount:intent.account,predictedAccountCodeEmpty:true},initialization:{index:'0',rootValidator:intent.rootValidator,owner:intent.owner,hookInput:ZERO_ADDRESS,hookData:'0x',initConfigCount:0,initializationDataSha256:bytesSha(intent.initializationData),factoryDataSha256:bytesSha(intent.factoryData),callDataSha256:bytesSha(intent.callData)},service:{chainId:46630,entryPoint:R.entryPoint,entryPointSupported:true},observedAt,expiresAt,readCount:count,verificationSource:'fixed-server-provider-read',ownerKeyPossessionEstablished:false,accountDeployed:false,tokenFundingEstablished:false,sponsorshipEntitlementEstablished:false,signingAllowed:false,deploymentAllowed:false,submissionAllowed:false};
  const result=validateKernelCreationPreflightObservation(intent,{...body,observationDigest:proofDigest(body)});trusted.add(result);return result;
 }
 return Object.freeze({verify,isTrustedResult:value=>trusted.has(value)});
}
