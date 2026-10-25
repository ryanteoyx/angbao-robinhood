/** Direct owner EOA ERC20 receipt correlation. No signer, sender, faucet or default transport. */
import {createHash} from 'node:crypto';
import {decodeEventLog,encodeAbiParameters,encodeEventTopics,parseAbi} from '../vendor/goal-transfer-viem.mjs';
import {validateGoalTransferIntent} from '../domain/goal-transfer.mjs';
import {kernelInitializationInternals as U} from '../domain/kernel-initialization.mjs';

if(typeof window!=='undefined')throw Error('Direct transfer observations are server-only.');
export const ROBINHOOD_EOA_TRANSFER_PURPOSE='robinhood-eoa-goal-transfer';
/** Explicit chain46630 receipt policy; no inference about the chain-wide tip configuration. */
export const ROBINHOOD_TESTNET_FEE_POLICY='robinhood-testnet-nitro-base-or-tip@1';
const PURPOSE=ROBINHOOD_EOA_TRANSFER_PURPOSE,MAX=(1n<<256n)-1n;
const {bounded,exact,freeze,canonical,digest}=U;
const same=(a,b)=>canonical(a)===canonical(b),pick=(v,keys)=>Object.fromEntries(keys.map(k=>[k,v[k]]));
const TRANSFER=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const TRANSFER_TOPIC=encodeEventTopics({abi:TRANSFER,eventName:'Transfer'})[0];
const ENVELOPE=['from','to','chainId','type','nonce','value','gas','maxFeePerGas','maxPriorityFeePerGas','data'];
const TX=['hash','from','to','chainId','type','nonce','value','gas','maxFeePerGas','maxPriorityFeePerGas','blockHash','blockNumber','transactionIndex'];
const META=['transactionHash','blockHash','blockNumber','transactionIndex'];
const BLOCK=['number','hash','parentHash','timestamp','baseFeePerGas','transactions'];
const FACTS=['transaction','receipt','canonicalBlock','latestBlockNumber','envelopeMatched'];
const SUMMARY=['status','reason','transferStatus','transactionHash','blockHash','blockNumber','confirmations','fee','executionAfterIntentExpiry'];
const LIMITS=freeze({maxResponseBytes:131072,maxScopeResponseBytes:786432,requestTimeoutMs:5000,scopeTimeoutMs:30000,maxRequests:6,retries:0,polling:false});
const ERROR_CODES=new Set(["block_bounds", "configuration", "confirmation_limit", "evidence_scope", "facts_invalid", "head_bounds", "input_bounds", "invalid_evidence", "invalid_hex", "invalid_integer", "invalid_quantity", "invalid_time", "log_bounds", "log_metadata", "observation_already_attempted", "options_invalid", "previous_scope", "provider_read_failed", "read_authorization_denied", "read_budget", "read_not_configured", "read_timeout", "receipt_bounds", "redaction_invalid", "reorg_uncertain", "response_bounds", "retained_changed", "retained_scope", "retained_summary_changed", "submission_mismatch", "submission_scope", "untrusted_observation", "wrong_chain"]);
export class RobinhoodEoaTransferReconciliationError extends Error{
 constructor(code){code=ERROR_CODES.has(code)?code:'invalid_evidence';super(`Direct test-token receipt check stopped: ${code}.`);this.name='RobinhoodEoaTransferReconciliationError';this.code=code;}
 toJSON(){return {name:this.name,code:this.code,message:this.message};}
}
const fail=code=>{throw new RobinhoodEoaTransferReconciliationError(code);};
function guard(work){try{return work();}catch(e){if(e instanceof RobinhoodEoaTransferReconciliationError)throw e;fail('invalid_evidence');}}
const hex=(v,n)=>{if(typeof v!=='string'||!(n?new RegExp(`^0x[a-fA-F0-9]{${n*2}}$`):/^0x(?:[a-fA-F0-9]{2})*$/).test(v))fail('invalid_hex');return v.toLowerCase();};
const q=v=>{if(typeof v!=='string'||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(v))fail('invalid_quantity');return BigInt(v);};
const quantity=v=>'0x'+q(v).toString(16),hash=v=>hex(v,32),address=v=>hex(v,20);
const integer=v=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(v)||BigInt(v)>MAX)fail('invalid_integer');return BigInt(v);};
const iso=v=>{if(typeof v!=='string'||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)fail('invalid_time');return Date.parse(v);};
const authority=()=>({ownerApprovalEstablished:false,signingAllowed:false,deploymentAllowed:false,submissionAllowed:false,financialAuthority:false});
const bytesHash=v=>createHash('sha256').update(Buffer.from(v.slice(2),'hex')).digest('hex');
function unsigned(i,t){
 exact(t,ENVELOPE);for(const k of ['from','to'])address(t[k]);for(const k of ['chainId','type','nonce','value','gas','maxFeePerGas','maxPriorityFeePerGas'])q(t[k]);hex(t.data);
 if(t.from!==i.account||t.to!==i.token.address||t.chainId!=='0xb626'||t.type!=='0x2'||t.value!=='0x0'||t.data!==i.call.data||q(t.nonce)>(1n<<64n)-2n||q(t.gas)<21000n||q(t.gas)>2000000n||q(t.maxFeePerGas)===0n||q(t.maxFeePerGas)>1000000000n||q(t.maxPriorityFeePerGas)>q(t.maxFeePerGas))fail('submission_mismatch');
 // Canonical lower-case quantities prevent multiple journal identities for the same nonce.
 if(ENVELOPE.some(k=>['from','to','data'].includes(k)?t[k]!==t[k].toLowerCase():t[k]!==quantity(t[k])))fail('submission_mismatch');
 return freeze(structuredClone(t));
}
/** Historical binding only. A caller-supplied transaction hash or JSON never proves wallet approval. */
export function validateRobinhoodEoaTransferSubmission(value,input){return guard(()=>{
 const i=validateGoalTransferIntent(value);bounded(input,16384);exact(input,['purpose','intentDigest','transactionHash','transaction']);
 if(input.purpose!==PURPOSE||input.intentDigest!==i.intentDigest||hash(input.transactionHash)!==input.transactionHash)fail('submission_scope');
 return freeze({...input,transaction:unsigned(i,input.transaction)});
});}
function project(i,e){
 bounded(e,1048576);exact(e,['format','chainId','observedAt','submission','transaction','receipt','canonicalBlock','latestBlockNumber']);
 if(e.format!=='angbao-robinhood-eoa-transfer-chain-evidence@1'||e.chainId!==46630)fail('evidence_scope');iso(e.observedAt);
 const submission=validateRobinhoodEoaTransferSubmission(i,e.submission),raw=e.transaction;
 let tx=null,envelopeMatched=false,inputAudit={originalInputSha256:null,inputByteLength:null,rawTransactionRetained:false,transactionSignatureFieldsDiscarded:0,opaqueReceiptLogsDiscarded:0};
 if(raw!==null){
  const input=hex(raw.input);if(input.length>131074)fail('input_bounds');
  tx=Object.fromEntries(TX.map(k=>[k,['hash','blockHash'].includes(k)?raw[k]===null?null:hash(raw[k]):['from','to'].includes(k)?address(raw[k]):raw[k]===null?null:quantity(raw[k])]));
  inputAudit={...inputAudit,originalInputSha256:bytesHash(input),inputByteLength:(input.length-2)/2,transactionSignatureFieldsDiscarded:['r','s','v','yParity'].filter(k=>Object.hasOwn(raw,k)).length};
  envelopeMatched=input===submission.transaction.data&&ENVELOPE.filter(k=>k!=='data').every(k=>tx[k]===submission.transaction[k])&&(!Object.hasOwn(raw,'accessList')||Array.isArray(raw.accessList)&&raw.accessList.length===0)&&!Object.hasOwn(raw,'authorizationList');
 }
 let receipt=null;
 if(e.receipt!==null){
  const r=e.receipt;receipt={...Object.fromEntries(META.map(k=>[k,k.endsWith('Hash')?hash(r[k]):quantity(r[k])])),status:quantity(r.status),gasUsed:quantity(r.gasUsed),effectiveGasPrice:quantity(r.effectiveGasPrice),events:[],malformedTransferLog:false};
  if(!Array.isArray(r.logs)||r.logs.length>256)fail('receipt_bounds');let previous=-1n;
  for(const log of r.logs){
   if(log.removed!==false||!META.every(k=>(k.endsWith('Hash')?hash(log[k]):quantity(log[k]))===receipt[k])||q(log.logIndex)<=previous)fail('log_metadata');previous=q(log.logIndex);address(log.address);hex(log.data);if(!Array.isArray(log.topics)||log.topics.length>4)fail('log_bounds');log.topics.forEach(hash);
   if(address(log.address)!==i.token.address||log.topics[0]?.toLowerCase()!==TRANSFER_TOPIC){inputAudit.opaqueReceiptLogsDiscarded++;continue;}
   try{
    const d=decodeEventLog({abi:TRANSFER,data:log.data,topics:log.topics,strict:true}),a=d.args;
    if(d.eventName!=='Transfer'||!same(encodeEventTopics({abi:TRANSFER,eventName:'Transfer',args:a}).map(v=>v.toLowerCase()),log.topics.map(v=>v.toLowerCase()))||encodeAbiParameters([{type:'uint256'}],[a.value])!==hex(log.data))throw Error();
    receipt.events.push({logIndex:quantity(log.logIndex),from:address(a.from),to:address(a.to),value:a.value.toString()});
   }catch{receipt.malformedTransferLog=true;inputAudit.opaqueReceiptLogsDiscarded++;}
  }
 }
 const b=e.canonicalBlock,block=b===null?null:{...Object.fromEntries(BLOCK.filter(k=>k!=='transactions').map(k=>[k,['hash','parentHash'].includes(k)?hash(b[k]):quantity(b[k])])),transactions:b.transactions?.map(hash)};
 return {submission,facts:{transaction:tx,receipt,canonicalBlock:block,latestBlockNumber:e.latestBlockNumber===null?null:quantity(e.latestBlockNumber),envelopeMatched},inputAudit};
}
function validateFacts(f){
 bounded(f,262144);exact(f,FACTS);if(typeof f.envelopeMatched!=='boolean')fail('facts_invalid');
 if(f.transaction!==null){exact(f.transaction,TX);for(const k of TX){const v=f.transaction[k];if(['blockHash','blockNumber','transactionIndex'].includes(k)&&v===null)continue;if(['hash','blockHash'].includes(k))hash(v);else if(['from','to'].includes(k))address(v);else q(v);}}
 if(f.receipt!==null){const r=f.receipt;exact(r,[...META,'status','gasUsed','effectiveGasPrice','events','malformedTransferLog']);META.forEach(k=>k.endsWith('Hash')?hash(r[k]):q(r[k]));if(!['0x0','0x1'].includes(r.status)||typeof r.malformedTransferLog!=='boolean'||!Array.isArray(r.events)||r.events.length>256)fail('facts_invalid');q(r.gasUsed);q(r.effectiveGasPrice);let previous=-1n;for(const e of r.events){exact(e,['logIndex','from','to','value']);if(q(e.logIndex)<=previous)fail('facts_invalid');previous=q(e.logIndex);address(e.from);address(e.to);integer(e.value);}}
 if(f.canonicalBlock!==null){const b=f.canonicalBlock;exact(b,BLOCK);hash(b.hash);hash(b.parentHash);for(const k of ['number','timestamp','baseFeePerGas'])q(b[k]);if(!Array.isArray(b.transactions)||b.transactions.length>2048)fail('block_bounds');b.transactions.forEach(hash);}
 if(f.latestBlockNumber!==null)q(f.latestBlockNumber);
}
function verificationContext(i,s,options){
 bounded(options,4096);exact(options,Object.keys(options));if(Object.keys(options).some(k=>!['minimumConfirmations','previous','feePolicy'].includes(k)))fail('options_invalid');
 if(Object.hasOwn(options,'feePolicy')&&options.feePolicy!==ROBINHOOD_TESTNET_FEE_POLICY)fail('options_invalid');
 const minimumConfirmations=options.minimumConfirmations??1;if(!Number.isSafeInteger(minimumConfirmations)||minimumConfirmations<1||minimumConfirmations>1024)fail('confirmation_limit');
 const p=options.previous??null;if(p!==null){exact(p,['intentDigest','transactionHash','blockHash']);if(p.intentDigest!==i.intentDigest||p.transactionHash!==s.transactionHash)fail('previous_scope');if(p.blockHash!==null)hash(p.blockHash);}
 return {minimumConfirmations,previousBlockHash:p?.blockHash??null,...(Object.hasOwn(options,'feePolicy')?{feePolicy:options.feePolicy}:{})};
}
function evaluate(i,s,f,observedAt,c){
 validateFacts(f);const observed=iso(observedAt),tx=f.transaction,r=f.receipt,b=f.canonicalBlock;
 const result={status:'uncertain',reason:'receipt-not-observed',transferStatus:'not-established',transactionHash:s.transactionHash,blockHash:null,blockNumber:null,confirmations:0,fee:null,executionAfterIntentExpiry:null};
 const finish=(reason,extra={})=>freeze({...result,reason,...extra});
 if(tx===null||r===null)return finish(c.previousBlockHash?'reorg-uncertain':'receipt-not-observed');
 if(tx.hash!==s.transactionHash||r.transactionHash!==s.transactionHash||!f.envelopeMatched||ENVELOPE.filter(k=>k!=='data').some(k=>tx[k]!==s.transaction[k]))return finish('transaction-envelope-mismatch');
 if(tx.blockHash===null||tx.blockNumber===null||tx.transactionIndex===null||b===null||f.latestBlockNumber===null)return finish('canonicality-not-established');
 if(tx.blockHash!==r.blockHash||tx.blockNumber!==r.blockNumber||tx.transactionIndex!==r.transactionIndex||b.hash!==r.blockHash||b.number!==r.blockNumber||q(r.transactionIndex)>=BigInt(b.transactions.length)||b.transactions[Number(q(r.transactionIndex))]!==tx.hash||q(f.latestBlockNumber)<q(b.number)||c.previousBlockHash!==null&&c.previousBlockHash!==b.hash)return finish('reorg-uncertain');
 const count=q(f.latestBlockNumber)-q(b.number)+1n;if(count>BigInt(Number.MAX_SAFE_INTEGER))fail('head_bounds');result.confirmations=Number(count);result.blockHash=b.hash;result.blockNumber=q(b.number).toString();
 if(observed<iso(i.createdAt)||BigInt(observed)<q(b.timestamp)*1000n||q(b.timestamp)*1000n+999n<BigInt(iso(i.createdAt)))return finish('observation-time-mismatch');
 const feeCap=q(s.transaction.maxFeePerGas),base=q(b.baseFeePerGas),market=base+q(s.transaction.maxPriorityFeePerGas),tipPrice=feeCap<market?feeCap:market,used=q(r.gasUsed),gas=q(s.transaction.gas);
 // Legacy observations retain the exact Ethereum formula. New policy accepts only the two Nitro endpoints.
 const price=q(r.effectiveGasPrice),priceMatches=price===tipPrice||(c.feePolicy===ROBINHOOD_TESTNET_FEE_POLICY&&price===base);
 if(base>feeCap||used<21000n||used>gas||!priceMatches)return finish('gas-cost-mismatch-or-cap-exceeded');
 result.fee={payer:i.account,gasUsed:used.toString(),effectiveGasPriceWei:price.toString(),gasCostWei:(used*price).toString(),maximumGasCostWei:(gas*feeCap).toString(),nativeValueWei:'0',providerBilling:'unverified',gasCoverage:'owner-funded-testnet'};
 const start=q(b.timestamp)*1000n,expiry=BigInt(iso(i.expiresAt));result.executionAfterIntentExpiry=start>=expiry?true:start+999n<expiry?false:null;
 if(r.status==='0x0')return finish('transaction-reverted',{status:'failed',transferStatus:'failed'});
 const matches=r.events.filter(e=>e.from===i.account&&e.to===i.recipient&&e.value===i.amountAtomic);
 if(r.malformedTransferLog||matches.length!==1||r.events.some(e=>[e.from,e.to].some(a=>[i.account,i.recipient].includes(a))&&e!==matches[0]))return finish('token-transfer-event-missing-or-ambiguous');
 if(result.confirmations<c.minimumConfirmations)return finish('confirmation-threshold-not-met',{transferStatus:'included-success'});
 return finish('exact-direct-transfer-correlated',{status:'offline-verified',transferStatus:'confirmation-threshold-met'});
}
/** Pure consistency only. Raw transaction input/signatures and opaque logs never appear in the result. */
export function verifyRobinhoodEoaTransferReceipt(value,evidence,options={}){return guard(()=>{
 const i=validateGoalTransferIntent(value),p=project(i,evidence),context=verificationContext(i,p.submission,options);
 return freeze({format:context.feePolicy?'angbao-robinhood-eoa-transfer-observation@2':'angbao-robinhood-eoa-transfer-observation@1',purpose:PURPOSE,intentDigest:i.intentDigest,verificationSource:'supplied-evidence',...evaluate(i,p.submission,p.facts,evidence.observedAt,context),observedAt:evidence.observedAt,submission:p.submission,facts:p.facts,inputAudit:p.inputAudit,verificationContext:context,finality:'not-established',nativeBalanceDeltasEstablished:false,tokenSemanticsAssurance:'Exact receipt events under independently reviewed token semantics; no token-source or net balance proof is created by this module.',intentExpiryMeaning:'Local review window only; this standard ERC20 call has no onchain deadline. Historical checks grant no fresh approval or retry.',...authority()});
});}

/**
 * Private requestChain is an approved bounded chain RPC adapter, never imported JSON or a browser body.
 * authorizePlan must atomically persist exact read reservations across restarts BEFORE returning true.
 * There is no default network transport. Each observation consumes its hash once, has <=6 reads, no retries.
 */
export function createRobinhoodEoaTransferReadAdapter({requestChain=null,authorizePlan=async()=>false,now=()=>new Date()}={}){
 if(requestChain!==null&&typeof requestChain!=='function'||typeof authorizePlan!=='function'||typeof now!=='function')fail('configuration');
 const attempted=new Set(),trusted=new WeakSet();let reservedRequests=0;
 async function observe(value,input,options={}){
  try{
   const i=validateGoalTransferIntent(value),s=validateRobinhoodEoaTransferSubmission(i,input);verificationContext(i,s,options);const safeOptions=freeze(structuredClone(options)),key=i.intentDigest+':'+s.transactionHash;
   if(requestChain===null)fail('read_not_configured');if(attempted.has(key)||attempted.size>=64)fail('observation_already_attempted');attempted.add(key);
   const started=performance.now();let count=0,bytes=0;
   async function packet(phase,requests){
    const plan=freeze({format:'angbao-robinhood-eoa-transfer-read-plan@1',purpose:PURPOSE,intentDigest:i.intentDigest,transactionHash:s.transactionHash,chainId:46630,phase,maximumScopeRequests:6,alreadyAttemptedRequests:count,requests,limits:LIMITS,authority:'read-only-exact-packet',signingAllowed:false,deploymentAllowed:false,submissionAllowed:false});
    let allowed=false;try{allowed=await authorizePlan(plan)===true;}catch{}if(!allowed)fail('read_authorization_denied');count+=requests.length;reservedRequests+=requests.length;if(count>6)fail('read_budget');
    const results=[];for(const request of requests){
     const remaining=LIMITS.scopeTimeoutMs-(performance.now()-started);if(remaining<=0)fail('read_timeout');const controller=new AbortController();let timer;
     try{const value=await Promise.race([requestChain(request,{signal:controller.signal,limits:LIMITS}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new RobinhoodEoaTransferReconciliationError('read_timeout'));},Math.min(remaining,LIMITS.requestTimeoutMs));})]);bounded(value,LIMITS.maxResponseBytes);if(request.method==='eth_chainId'&&q(value)!==46630n)fail('wrong_chain');bytes+=Buffer.byteLength(JSON.stringify(value));if(bytes>LIMITS.maxScopeResponseBytes)fail('response_bounds');results.push(structuredClone(value));}
     finally{clearTimeout(timer);controller.abort();}
    }return results;
   }
   const request=(method,params)=>({service:'chain',method,params});
   const [chain,tx,receipt]=await packet('transaction',[request('eth_chainId',[]),request('eth_getTransactionByHash',[s.transactionHash]),request('eth_getTransactionReceipt',[s.transactionHash])]);if(q(chain)!==46630n)fail('wrong_chain');
   const e={format:'angbao-robinhood-eoa-transfer-chain-evidence@1',chainId:46630,observedAt:null,submission:s,transaction:tx,receipt,canonicalBlock:null,latestBlockNumber:null};
   if(tx!==null&&receipt!==null){const number=quantity(receipt.blockNumber);const [block,head,recheck]=await packet('checkpoint',[request('eth_getBlockByNumber',[number,false]),request('eth_blockNumber',[]),request('eth_getBlockByNumber',[number,false])]);e.canonicalBlock=block;e.latestBlockNumber=head;if(block===null||recheck===null||hash(block.hash)!==hash(recheck.hash))fail('reorg_uncertain');}
   const date=now();if(!(date instanceof Date)||!Number.isFinite(date.getTime()))fail('configuration');e.observedAt=date.toISOString();const verified=verifyRobinhoodEoaTransferReceipt(i,e,safeOptions),result=freeze({...verified,status:verified.status==='offline-verified'?'confirmed':verified.status,verificationSource:'fixed-server-provider-read',readCount:count});trusted.add(result);return result;
  }catch(e){if(e instanceof RobinhoodEoaTransferReconciliationError)throw e;fail('provider_read_failed');}
 }
 return Object.freeze({observe,isTrustedResult:value=>trusted.has(value),usage:()=>freeze({reservedRequests})});
}
function audit(value){
 exact(value,['originalInputSha256','inputByteLength','rawTransactionRetained','transactionSignatureFieldsDiscarded','opaqueReceiptLogsDiscarded']);
 if(value.rawTransactionRetained!==false||!Number.isSafeInteger(value.transactionSignatureFieldsDiscarded)||value.transactionSignatureFieldsDiscarded<0||value.transactionSignatureFieldsDiscarded>4||!Number.isSafeInteger(value.opaqueReceiptLogsDiscarded)||value.opaqueReceiptLogsDiscarded<0||value.opaqueReceiptLogsDiscarded>256)fail('redaction_invalid');
 if(value.originalInputSha256===null){if(value.inputByteLength!==null)fail('redaction_invalid');}else if(!/^[a-f0-9]{64}$/.test(value.originalInputSha256)||!Number.isSafeInteger(value.inputByteLength)||value.inputByteLength<0||value.inputByteLength>65536)fail('redaction_invalid');
}
/** A trusted original reader result is projected to a history record containing no signed transaction. */
export function retainVerifiedRobinhoodEoaTransferObservation(value,result,reader){return guard(()=>{
 const i=validateGoalTransferIntent(value),descriptor=reader&&Object.getOwnPropertyDescriptor(reader,'isTrustedResult');if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='function'||descriptor.value.call(reader,result)!==true||result.verificationSource!=='fixed-server-provider-read'||result.intentDigest!==i.intentDigest)fail('untrusted_observation');
 const summary={...pick(result,SUMMARY),status:result.status==='confirmed'?'offline-verified':result.status};
 const version=result.verificationContext?.feePolicy===ROBINHOOD_TESTNET_FEE_POLICY?2:1;
 const body={format:`angbao-retained-robinhood-eoa-transfer@${version}`,purpose:PURPOSE,intentDigest:i.intentDigest,observedAt:result.observedAt,recordedStatus:result.status+'-at-observation',submission:result.submission,facts:result.facts,inputAudit:result.inputAudit,verificationContext:result.verificationContext,summary};
 const retained=freeze({...body,retainedDigest:digest({domain:`angbao.retained-robinhood-eoa-transfer.v${version}`,observation:body})});verifyRetainedRobinhoodEoaTransferObservation(i,retained);return retained;
});}
/** Digest and replay validate historical consistency, never provider provenance or current confirmation. */
export function verifyRetainedRobinhoodEoaTransferObservation(value,input){return guard(()=>{
 const i=validateGoalTransferIntent(value);bounded(input,262144);exact(input,['format','purpose','intentDigest','observedAt','recordedStatus','submission','facts','inputAudit','verificationContext','summary','retainedDigest']);
 const version=input.format==='angbao-retained-robinhood-eoa-transfer@1'?1:input.format==='angbao-retained-robinhood-eoa-transfer@2'?2:null;
 if(version===null||input.purpose!==PURPOSE||input.intentDigest!==i.intentDigest)fail('retained_scope');const {retainedDigest,...body}=input;if(retainedDigest!==digest({domain:`angbao.retained-robinhood-eoa-transfer.v${version}`,observation:body}))fail('retained_changed');
 const s=validateRobinhoodEoaTransferSubmission(i,input.submission);audit(input.inputAudit);exact(input.verificationContext,['minimumConfirmations','previousBlockHash',...(version===2?['feePolicy']:[])]);const c=input.verificationContext;
 const checked=verificationContext(i,s,{...(version===2?{feePolicy:c.feePolicy}:{}),minimumConfirmations:c.minimumConfirmations,previous:c.previousBlockHash===null?null:{intentDigest:i.intentDigest,transactionHash:s.transactionHash,blockHash:c.previousBlockHash}});exact(input.summary,SUMMARY);
 const expected=evaluate(i,s,input.facts,input.observedAt,checked);if(!same(expected,input.summary)||input.recordedStatus!==(expected.status==='offline-verified'?'confirmed':expected.status)+'-at-observation')fail('retained_summary_changed');
 return freeze({...structuredClone(input),verification:'historical-consistency-only',currentConfirmationEstablished:false,transactionInputAuthentication:'discarded-not-reconstructed',...authority()});
});}
