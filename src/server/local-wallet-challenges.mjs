/** Memory-only wallet handoff. All signable messages originate in the trusted bridge. */
import {randomUUID} from 'node:crypto';
import {ApiError} from '../domain/angbao.mjs';
const fail=(message,code='wallet_challenge_refused',status=409)=>{throw new ApiError(status,code,message);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});return {promise,resolve,reject};};
export function createLocalWalletChallenges({bridge,resolveOwnerReview,now=()=>Date.now()}={}){
 if(!bridge||typeof bridge.requestWalletSignature!=='function'||typeof resolveOwnerReview!=='function'||typeof now!=='function')throw Error('Wire a trusted owner bridge and saved-review resolver.');
 const entries=new Map();
 const descriptor=entry=>({id:entry.id,transferId:entry.transferId,ownerReviewDigest:entry.selected.ownerReviewDigest,expectedOwner:entry.selected.owner,chainId:46630,operationHash:entry.selected.userOperationHash,phase:entry.phase,expiresAt:new Date(entry.expiresAt).toISOString(),walletMessageMeaning:'The wallet signs an operation hash. Read the exact transfer and maximum cost in Angbao before continuing.',signatureRetained:false});
 function current(id){const entry=entries.get(id);if(!entry)fail('This wallet request is unavailable. Reopen the saved transfer.');if(now()>=entry.expiresAt){cancelEntry(entry);fail('This wallet request expired. Nothing new was submitted.','wallet_challenge_expired',410);}return entry;}
 function cancelEntry(entry){if(entry.phase==='signed'||entry.phase==='cancelled'||entry.phase==='failed')return;entry.phase='cancelled';const error=new Error('Wallet request cancelled or expired.');entry.context.reject(error);entry.signature.reject(error);entry.first.reject(error);clearTimeout(entry.timer);}
 return Object.freeze({
  async begin(args){
   if(!exact(args,['transferId','transferDigest','ownerReviewDigest'])||!digest(args.transferDigest)||!digest(args.ownerReviewDigest))fail('Select the exact saved owner review.');
   const selected=await resolveOwnerReview(structuredClone(args));
   if(!plain(selected)||selected.ownerReviewDigest!==args.ownerReviewDigest||!hash(selected.userOperationHash)||selected.chainId!==46630||typeof selected.owner!=='string'||!/^0x[a-f0-9]{40}$/.test(selected.owner)||!Number.isFinite(Date.parse(selected.expiresAt))||Date.parse(selected.expiresAt)<=now())fail('Reopen the current transfer review before requesting a wallet signature.');
   if([...entries.values()].some(entry=>entry.selected.ownerReviewDigest===selected.ownerReviewDigest))fail('This wallet review was already requested. Read its existing outcome; do not start another request.');
   if(entries.size>=20)fail('This session has reached its wallet-request limit. Read saved history before starting a new session.');
   const entry={id:randomUUID(),transferId:args.transferId,selected:structuredClone(selected),phase:'starting',expiresAt:Math.min(Date.parse(selected.expiresAt),now()+120000),context:defer(),signature:defer(),first:defer(),timer:null};entries.set(entry.id,entry);
   const facade={account:{address:selected.owner},async getChainId(){entry.phase='check-wallet';entry.first.resolve(descriptor(entry));return entry.context.promise;},async signMessage(input){
    if(entry.phase!=='wallet-checked'||!exact(input,['account','message'])||input.account!==selected.owner||!exact(input.message,['raw'])||input.message.raw!==selected.userOperationHash)fail('The wallet message does not match this saved operation.');
    entry.phase='sign-operation-hash';return entry.signature.promise;
   }};
   entry.timer=setTimeout(()=>cancelEntry(entry),Math.max(1,entry.expiresAt-now()));entry.timer.unref?.();
   entry.completion=Promise.resolve().then(()=>bridge.requestWalletSignature(selected.ownerReviewDigest,facade)).then(result=>{if(entry.phase==='cancelled')return;entry.phase='signed';entry.result={status:result.status,ownerSignatureVerified:result.ownerSignatureVerified===true,userOperationHash:result.userOperationHash};clearTimeout(entry.timer);},()=>{if(entry.phase!=='cancelled')entry.phase='failed';entry.first.reject(new Error('The wallet request was not completed.'));clearTimeout(entry.timer);});
   try{return await entry.first.promise;}catch{fail('The wallet request could not begin. Nothing new was submitted.');}
  },
  read(id){return descriptor(current(id));},
  async respond(id,input){const entry=current(id);
   if(entry.phase==='check-wallet'){
    if(!exact(input,['account','chainId'])||input.account!==entry.selected.owner||input.chainId!==46630)fail('Choose the expected owner wallet on Robinhood Testnet.');entry.phase='wallet-checked';entry.context.resolve(46630);await Promise.resolve();await Promise.resolve();return descriptor(entry);
   }
   if(entry.phase!=='sign-operation-hash'||!exact(input,['signature'])||typeof input.signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(input.signature))fail('Respond only to the current wallet request.');
   entry.phase='checking-signature';entry.signature.resolve(input.signature);await entry.completion;entry.signature=null;
   // The resolved signature promise is released and the raw signature is never returned. The bridge owns its private verified-signature state.
   return descriptor(entry);
  },
  cancel(id){const entry=current(id);cancelEntry(entry);return descriptor(entry);},
  close(){for(const entry of entries.values())cancelEntry(entry);entries.clear();}
 });
}
