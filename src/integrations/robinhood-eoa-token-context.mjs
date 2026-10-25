/** Source-reviewed token identity/gates only. No transport, source approval, signer or asset activation. */
import {createHash} from 'node:crypto';
import {keccak256,encodeFunctionData,parseAbi} from '../vendor/kernel-identity-codecs.mjs';
import {validateGoalTransferIntent} from '../domain/goal-transfer.mjs';
import {kernelInitializationInternals as U} from '../domain/kernel-initialization.mjs';

if(typeof window!=='undefined')throw Error('Reviewed token context is server-only.');
export const ROBINHOOD_EOA_TOKEN_READ_COUNTS=U.freeze({nonproxy:{preflight:2,'receipt-identity':2},'beacon-proxy':{preflight:9,'receipt-identity':6}});
export const ROBINHOOD_EIP1967_BEACON_SLOT='0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
const PURPOSE='robinhood-eoa-goal-transfer',BODY=['format','chainId','kind','address','decimals','symbol','evidenceDigest','sourcePolicy','roles','gates'];
const {bounded,exact,canonical,digest,freeze}=U;
const same=(a,b)=>canonical(a)===canonical(b),EMPTY_SHA='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const CODES=new Set(['invalid_asset','wrong_asset','invalid_checkpoint','invalid_phase','read_not_configured','asset_not_accepted','accepted_asset_changed','invalid_rpc_result','code_changed','beacon_changed','implementation_changed','decimals_changed','token_paused','sender_blocked','recipient_blocked','read_failed','read_budget']);
export class RobinhoodEoaTokenContextError extends Error{
 constructor(code){code=CODES.has(code)?code:'invalid_asset';super(`Reviewed test-token context stopped: ${code}.`);this.name='RobinhoodEoaTokenContextError';this.code=code;}
 toJSON(){return {name:this.name,code:this.code,message:this.message};}
}
const fail=code=>{throw new RobinhoodEoaTokenContextError(code);};
function guard(work,code='invalid_asset'){try{return work();}catch(e){if(e instanceof RobinhoodEoaTokenContextError)throw e;fail(code);}}
const hex=(v,n)=>{if(typeof v!=='string'||!(n?new RegExp(`^0x[a-f0-9]{${n*2}}$`):/^0x(?:[a-f0-9]{2})*$/).test(v))fail('invalid_rpc_result');return v;};
const address=v=>{hex(v,20);if(/^0x0{40}$/.test(v))fail('invalid_asset');return v;};
const sha=v=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v)||v===EMPTY_SHA||/^0{64}$/.test(v))fail('invalid_asset');return v;};
const shaBytes=v=>createHash('sha256').update(Buffer.from(v.slice(2),'hex')).digest('hex');
const selector=signature=>keccak256('0x'+Buffer.from(signature,'utf8').toString('hex')).slice(0,10);
const STANDARD=parseAbi(['function decimals() view returns(uint8)','function implementation() view returns(address)']);
function gate(v,argument,targetRole,sourceEvidenceDigest){exact(v,['targetRole','sourceEvidenceDigest','signature','selector']);if(v.targetRole!==targetRole||v.sourceEvidenceDigest!==sourceEvidenceDigest)fail('invalid_asset');if(typeof v.signature!=='string'||!new RegExp(`^[A-Za-z_][A-Za-z0-9_]{0,63}\\(${argument}\\)$`).test(v.signature)||hex(v.selector,4)!==selector(v.signature))fail('invalid_asset');}
/** Shape/digest validation ONLY. This never accepts sources, ABI semantics or onchain deployment. */
export function validateRobinhoodEoaReviewedAsset(value){return guard(()=>{
 bounded(value,16384);const stamped=Object.hasOwn(value,'assetDigest');exact(value,stamped?[...BODY,'assetDigest']:BODY);
 if(value.format!=='angbao-robinhood-eoa-reviewed-asset@1'||value.chainId!==46630||!Object.hasOwn(ROBINHOOD_EOA_TOKEN_READ_COUNTS,value.kind)||!Number.isInteger(value.decimals)||value.decimals<0||value.decimals>18||typeof value.symbol!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,11}$/.test(value.symbol))fail('invalid_asset');
 address(value.address);sha(value.evidenceDigest);const names=value.kind==='nonproxy'?['token']:['proxy','beacon','implementation'];exact(value.roles,names);
 for(const name of names){const r=value.roles[name];exact(r,['address','codeSha256','sourceEvidenceDigest']);address(r.address);sha(r.codeSha256);sha(r.sourceEvidenceDigest);}
 if(value.roles[names[0]].address!==value.address||new Set(names.map(k=>value.roles[k].address)).size!==names.length)fail('invalid_asset');
 if(value.kind==='nonproxy'){if(value.sourcePolicy!=='reviewed-nonproxy-no-gates@1'||value.gates!==null)fail('invalid_asset');}
 else{if(value.sourcePolicy!=='reviewed-beacon-transfer-gates@1')fail('invalid_asset');exact(value.gates,['pause','blocked']);gate(value.gates.pause,'','proxy',value.roles.implementation.sourceEvidenceDigest);gate(value.gates.blocked,'address','beacon',value.roles.beacon.sourceEvidenceDigest);}
 const body=structuredClone(Object.fromEntries(BODY.map(k=>[k,value[k]]))),assetDigest=digest({domain:'angbao.robinhood-eoa-reviewed-asset.v1',asset:body});if(stamped&&value.assetDigest!==assetDigest)fail('invalid_asset');return freeze({...body,assetDigest});
});}
function checkpoint(v){bounded(v,1024);exact(v,['chainId','blockHash']);if(v.chainId!==46630)fail('invalid_checkpoint');hex(v.blockHash,32);return freeze(structuredClone(v));}
function word(v){return hex(v,32).slice(2);}
function wordAddress(v){const w=word(v);if(!/^0{24}/.test(w))fail('invalid_rpc_result');return address('0x'+w.slice(24));}
function bool(v){const n=BigInt('0x'+word(v));if(n!==0n&&n!==1n)fail('invalid_rpc_result');return n===1n;}
/**
 * resolveAcceptedAsset({assetDigest,phase}) is a private source-acceptance boundary, default denied.
 * It must return an independently source-reviewed matching config, never a boolean, imported file,
 * HTTP body or auto-approval of a shape-valid candidate. Digests are references, not source proofs.
 * Beacon policy requires independently reproduced proxy immutables/EIP1967/IBeacon semantics and
 * implementation transfer/gate ABI semantics. This policy reads combined local/global pause
 * through the proxy and address-block status on its source-bound beacon/access registry. There are NO guessed pause/blocked selectors.
 * requestChain is a private callback that durably reserves EACH exact request and enforces bounds.
 * The host verifies checkpoint freshness/canonical header/recheck and grants the NEW finite scope.
 * No default network, retry, approval, wallet or paid-provider capability is installed here.
 */
export function createRobinhoodEoaTokenContextReader({resolveAcceptedAsset=async()=>null}={}){
 if(typeof resolveAcceptedAsset!=='function')fail('asset_not_accepted');const trusted=new WeakSet();
 async function read(input){
  try{
   exact(input,Object.hasOwn(input,'phase')?['asset','intent','checkpoint','requestChain','phase']:['asset','intent','checkpoint','requestChain']);
   const asset=validateRobinhoodEoaReviewedAsset(input.asset),intent=validateGoalTransferIntent(input.intent),pin=guard(()=>checkpoint(input.checkpoint),'invalid_checkpoint'),phase=input.phase??'preflight',requestChain=input.requestChain;
   if(!['preflight','receipt-identity'].includes(phase))fail('invalid_phase');if(typeof requestChain!=='function')fail('read_not_configured');
   if(asset.address!==intent.token.address||asset.decimals!==intent.token.decimals||asset.symbol!==intent.token.symbol)fail('wrong_asset');
   const query=freeze({assetDigest:asset.assetDigest,phase});
   async function accepted(){let raw;try{raw=await resolveAcceptedAsset(query);}catch{fail('asset_not_accepted');}if(raw===null||raw===undefined||typeof raw==='boolean')fail('asset_not_accepted');const selected=guard(()=>validateRobinhoodEoaReviewedAsset(raw),'asset_not_accepted');if(!same(selected,asset))fail('accepted_asset_changed');}
   await accepted();let count=0;const maximum=ROBINHOOD_EOA_TOKEN_READ_COUNTS[asset.kind][phase],block=freeze({blockHash:pin.blockHash,requireCanonical:true}),codeHashes={};
   async function rpc(method,params){
    if(count>=maximum)fail('read_budget');await accepted();const request=freeze({service:'chain',method,params});count++;let result;try{result=await requestChain(request);}catch{fail('read_failed');}guard(()=>bounded(result,131072),'invalid_rpc_result');await accepted();return result;
   }
   const call=(to,data)=>rpc('eth_call',[{to,data},block]);
   async function code(role){const expected=asset.roles[role],bytes=hex(await rpc('eth_getCode',[expected.address,block]));if(bytes==='0x'||shaBytes(bytes)!==expected.codeSha256)fail('code_changed');codeHashes[role]=expected.codeSha256;}
   await code(asset.kind==='nonproxy'?'token':'proxy');
   const decimals=BigInt('0x'+word(await call(asset.address,encodeFunctionData({abi:STANDARD,functionName:'decimals'}))));if(decimals!==BigInt(asset.decimals))fail('decimals_changed');
   let resolvedBeacon=null,resolvedImplementation=null,gates=null;
   if(asset.kind==='beacon-proxy'){
    resolvedBeacon=wordAddress(await rpc('eth_getStorageAt',[asset.address,ROBINHOOD_EIP1967_BEACON_SLOT,block]));if(resolvedBeacon!==asset.roles.beacon.address)fail('beacon_changed');await code('beacon');
    resolvedImplementation=wordAddress(await call(resolvedBeacon,encodeFunctionData({abi:STANDARD,functionName:'implementation'})));if(resolvedImplementation!==asset.roles.implementation.address)fail('implementation_changed');await code('implementation');
    if(phase==='preflight'){
     const paused=bool(await call(asset.roles[asset.gates.pause.targetRole].address,asset.gates.pause.selector));if(paused)fail('token_paused');
     const blockedData=a=>asset.gates.blocked.selector+a.slice(2).padStart(64,'0');
     const senderBlocked=bool(await call(asset.roles[asset.gates.blocked.targetRole].address,blockedData(intent.account)));if(senderBlocked)fail('sender_blocked');
     const recipientBlocked=bool(await call(asset.roles[asset.gates.blocked.targetRole].address,blockedData(intent.recipient)));if(recipientBlocked)fail('recipient_blocked');
     gates={paused,senderBlocked,recipientBlocked,pauseSourceEvidenceDigest:asset.gates.pause.sourceEvidenceDigest,blockedSourceEvidenceDigest:asset.gates.blocked.sourceEvidenceDigest};
    }
   }
   if(count!==maximum)fail('read_budget');await accepted();
   const result=freeze({format:'angbao-robinhood-eoa-token-context@1',purpose:PURPOSE,phase,intentDigest:intent.intentDigest,assetDigest:asset.assetDigest,evidenceDigest:asset.evidenceDigest,kind:asset.kind,address:asset.address,decimals:asset.decimals,symbol:asset.symbol,sourcePolicy:asset.sourcePolicy,checkpoint:pin,codeHashes,resolvedBeacon,resolvedImplementation,gates,requestCount:count,verificationSource:'private-accepted-asset-and-supplied-reads',checkpointIdentityEstablished:true,executionTimeImplementationEstablished:false,tokenBalanceEstablished:false,economicValueEstablished:false,ownerApprovalEstablished:false,signingAllowed:false,deploymentAllowed:false,submissionAllowed:false,financialAuthority:false});trusted.add(result);return result;
  }catch(e){if(e instanceof RobinhoodEoaTokenContextError)throw e;fail('invalid_asset');}
 }
 return Object.freeze({read,isTrustedResult:value=>trusted.has(value)});
}
