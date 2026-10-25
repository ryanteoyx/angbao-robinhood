/** Default-denied trusted startup adapter. No default transport, writes, signer or authority ledger. */
import {encodeFunctionData,parseAbi} from '../vendor/kernel-identity-codecs.mjs';
import {COMMITTED_EVENT_TOPIC} from '../domain/chain-operation.mjs';
import {validateOpeningBuildReference} from '../domain/decision-opening-record.mjs';
import {CheckpointExecutionError as UError,CHECKPOINT_CREATE_PURPOSE as CREATE,CHECKPOINT_COMMIT_PURPOSE as COMMIT,validateCheckpointOwnerContextRequest,assertCheckpointOwnerContextCurrent,validateCheckpointExecutionIntent,validateCheckpointExecutionSubmission,validateCheckpointObservationOptions,validateCheckpointDeploymentReference,verifyCheckpointExecutionEvidence,assertCheckpointExecutionCurrent,checkpointExecutionInternals as U} from '../domain/decision-checkpoint-execution.mjs';

if(typeof window!=='undefined')throw Error('Checkpoint chain reads are server-only.');
export const CHECKPOINT_CHAIN_ENDPOINT='https://rpc.testnet.chain.robinhood.com';
export const CHECKPOINT_READ_LIMITS=Object.freeze({maxResponseBytes:131072,maxScopeBytes:1048576,requestTimeoutMs:5000,scopeTimeoutMs:30000,maxPreflightRequests:12,maxObservationRequests:8,maxScopes:64,retries:0,polling:false});
const {K,fail,guard,same,sha,hash,q,copy,build,authority}=U,L=CHECKPOINT_READ_LIMITS,ZERO='0x'+'0'.repeat(64);
const ABI=parseAbi(['function commitments(address,bytes32) view returns(bytes32)']);
const registry=new WeakSet(),brands=new WeakMap();
const req=(method,params)=>({service:'chain',method,params});
const boundedError=error=>{if(error instanceof UError)throw new UError(Object.getOwnPropertyDescriptor(error,'code')?.value);fail('provider_read_failed');};
function metadata(reader,result){const m=brands.get(result);if(!registry.has(reader)||!m||m.reader!==reader)fail('untrusted_result');return m;}
function priorDeployment(intent,value,ms,reader){
 if(intent.purpose===CREATE){if(value!==null)fail('scope_changed');return;}
 const m=brands.get(value);
 if(!m||m.reader!==reader||m.kind!=='observation'||m.intent.purpose!==CREATE||m.intent.intentDigest!==intent.deploymentIntent.intentDigest||value.correlation.status!=='offline-correlated'||value.submission.transactionHash!==intent.deploymentReference.transactionHash||value.correlation.blockHash!==intent.deploymentReference.blockHash)fail('deployment_not_observed');
 if(Date.parse(value.evidence.observedAt)>ms||ms-Date.parse(value.evidence.observedAt)>300000)fail('context_stale');
}
function snapshotOptions(intent,value,kind,ms,reader){
 K.exact(value,kind==='preflight'?['operationKey','phase','deploymentObservation']:['operationKey','minimumConfirmations','previousBlockHash','deploymentObservation']);K.uuid(value.operationKey);
 priorDeployment(intent,value.deploymentObservation,ms,reader);
 if(kind==='preflight'){if(!['review','before-wallet'].includes(value.phase))fail('scope_changed');return copy({operationKey:value.operationKey,phase:value.phase});}
 return copy({operationKey:value.operationKey,...validateCheckpointObservationOptions({minimumConfirmations:value.minimumConfirmations,previousBlockHash:value.previousBlockHash})});
}
function projectBlock(value){if(value===null)return null;hash(value.hash);hash(value.parentHash);for(const k of ['number','timestamp','baseFeePerGas'])q(value[k]);if(!Array.isArray(value.transactions)||value.transactions.length>1024)fail('response_bounds');value.transactions.forEach(hash);return Object.fromEntries(['number','hash','parentHash','timestamp','baseFeePerGas','transactions'].map(k=>[k,structuredClone(value[k])]));}
function projectTransaction(value){
 if(value===null)return null;const keys=['hash','from','to','chainId','type','nonce','value','gas','maxFeePerGas','maxPriorityFeePerGas','input','blockHash','blockNumber','transactionIndex'];
 const out=Object.fromEntries(keys.map(k=>[k,value[k]]));
 if(Object.hasOwn(value,'accessList'))out.accessList=Array.isArray(value.accessList)?value.accessList.length?[{}]:[]:null;
 if(Object.hasOwn(value,'authorizationList'))out.authorizationList=[];
 return out;
}
function projectReceipt(value,intent){
 if(value===null)return null;const keys=['from','to','contractAddress','transactionHash','blockHash','blockNumber','transactionIndex','status','gasUsed','effectiveGasPrice'];const out=Object.fromEntries(keys.map(k=>[k,value[k]]));
 if(!Array.isArray(value.logs)||value.logs.length>128)fail('response_bounds');
 out.logs=value.logs.map(log=>{
  K.address(log.address);hash(log.transactionHash);hash(log.blockHash);for(const k of ['blockNumber','transactionIndex','logIndex'])q(log[k]);K.hex(log.data);
  if(!Array.isArray(log.topics)||log.topics.length>4)fail('response_bounds');log.topics.forEach(t=>K.hex(t,32));
  const keep=intent.purpose===COMMIT&&log.address===intent.contract&&log.topics[0]===COMMITTED_EVENT_TOPIC;
  return {address:log.address,transactionHash:log.transactionHash,blockHash:log.blockHash,blockNumber:log.blockNumber,transactionIndex:log.transactionIndex,logIndex:log.logIndex,removed:log.removed,topics:keep?structuredClone(log.topics):[],data:keep?log.data:'0x'};
 });return out;
}
/** requestChain must be a private result-only adapter fixed to CHECKPOINT_CHAIN_ENDPOINT. */
export function createRobinhoodCheckpointReadAdapter({requestChain=null,authorizePlan=async()=>false,resolveAcceptedBuild=async()=>null,now=()=>new Date()}={}){
 if(requestChain!==null&&typeof requestChain!=='function'||[authorizePlan,resolveAcceptedBuild,now].some(fn=>typeof fn!=='function'))fail('configuration');
 const attempts=new Set();let reservedRequests=0,completedRequests=0,reader;
 const time=()=>{const d=now(),ms=Date.prototype.getTime.call(d);if(!Number.isFinite(ms))fail('configuration');return ms;};
 function begin(intent,options,kind,prior){
  if(requestChain===null)fail('read_not_configured');if(attempts.has(options.operationKey)||attempts.size>=L.maxScopes)fail('already_attempted');attempts.add(options.operationKey);
  const started=performance.now(),startTime=time(),maximum=kind==='observation'?L.maxObservationRequests:L.maxPreflightRequests;let count=0,bytes=0,index=0,lastTime=startTime;const audit=[];
  const clock=()=>{const ms=time();if(ms<lastTime)fail('context_stale');lastTime=ms;if(kind==='discovery')assertCheckpointOwnerContextCurrent(intent,new Date(ms));else priorDeployment(intent,prior,ms,reader);if(kind==='preflight')assertCheckpointExecutionCurrent(intent,new Date(ms));return ms;};
  async function boundedAwait(fn,signalController=null){
   const remaining=L.scopeTimeoutMs-(performance.now()-started);if(remaining<=0)fail('read_timeout');let timer;
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{signalController?.abort();reject(new UError('read_timeout'));},Math.min(remaining,L.requestTimeoutMs));});
   // Invoke immediately after the final clock/source check, without a deferred microtask gap.
   try{return await Promise.race([fn(),timeout]);}finally{clearTimeout(timer);}
  }
  async function accepted(){const ref=await boundedAwait(()=>resolveAcceptedBuild(copy({intentDigest:intent.intentDigest??intent.requestDigest,purpose:intent.purpose,buildReference:intent.buildReference})));try{validateOpeningBuildReference(ref);}catch{fail('source_not_accepted');}clock();}
  async function packet(stage,requests){
   // Capture before the first await; authorization, transport, predicates and audit share these objects.
   const captured=copy(requests);if(count+captured.length>maximum)fail('read_budget');
   const plan=K.freeze({format:'angbao-checkpoint-chain-read-plan@1',endpoint:CHECKPOINT_CHAIN_ENDPOINT,chainId:46630,intentDigest:intent.intentDigest??intent.requestDigest,purpose:intent.purpose,operationKey:options.operationKey,scope:kind,stage,packetIndex:index++,alreadyReservedRequests:count,maximumScopeRequests:maximum,requests:captured,limits:L,authority:'read-only-exact-packet',...authority()});
   await accepted();const allowed=await boundedAwait(()=>authorizePlan(plan));if(allowed!==true)fail('read_authorization_denied');count+=captured.length;reservedRequests+=captured.length;
   await accepted();const values=[];
   for(const request of plan.requests){
    await accepted();clock();const controller=new AbortController();
    try {const result=await boundedAwait(()=>requestChain(request,{endpoint:CHECKPOINT_CHAIN_ENDPOINT,signal:controller.signal,limits:L}),controller);K.bounded(result,L.maxResponseBytes);const length=Buffer.byteLength(JSON.stringify(result));bytes+=length;if(bytes>L.maxScopeBytes)fail('response_bounds');
     if(request.method==='eth_chainId'&&q(result)!==46630n)fail('wrong_chain');audit.push({method:request.method,requestDigest:K.digest(request),responseSha256:sha(JSON.stringify(result)),responseBytes:length});completedRequests++;values.push(structuredClone(result));
    }finally{controller.abort();}
   }return values;
  }
  const finish=async(body)=>{await accepted();const ms=clock();if(kind!=='observation'&&Date.parse(body.expiresAt)<=ms)fail('context_stale');const result=copy({...body,requestAudit:audit,readCount:audit.length,reservedReadCount:count,endpoint:CHECKPOINT_CHAIN_ENDPOINT,verificationSource:'configured-server-chain-reader',...authority(),currentConfirmationEstablished:false});brands.set(result,{reader,kind,intent});return result;};
  return {packet,clock,finish};
 }
 async function discoverOwnerContext(requestValue,optionValue){try{
  const request=validateCheckpointOwnerContextRequest(requestValue);K.exact(optionValue,['operationKey']);K.uuid(optionValue.operationKey);const options=copy(optionValue);assertCheckpointOwnerContextCurrent(request,new Date(time()));const run=begin(request,options,'discovery',null);
  const [,raw]=await run.packet('identity',[req('eth_chainId',[]),req('eth_getBlockByNumber',['latest',false])]);if(raw===null)fail('state_mismatch');const block=projectBlock(raw);
  const [code,balance,nonce,pending]=await run.packet('owner-state',[req('eth_getCode',[request.owner,block.number]),req('eth_getBalance',[request.owner,block.number]),req('eth_getTransactionCount',[request.owner,block.number]),req('eth_getTransactionCount',[request.owner,'pending'])]);K.hex(code);q(balance);q(nonce);q(pending);
  if(code!=='0x'||nonce!==pending||q(nonce)>(1n<<64n)-2n||q(balance)<BigInt(request.caps.gasLimit)*BigInt(request.caps.maxFeePerGas)||q(block.baseFeePerGas)>BigInt(request.caps.maxFeePerGas))fail('state_mismatch');
  const [recheck,finalNonce]=await run.packet('canonical-recheck',[req('eth_getBlockByNumber',[block.number,false]),req('eth_getTransactionCount',[request.owner,'pending'])]);if(recheck===null||!same(projectBlock(recheck),block)||finalNonce!==nonce)fail('reorg_uncertain');const ms=run.clock();if(q(block.timestamp)*1000n>BigInt(ms+30000)||BigInt(ms)-q(block.timestamp)*1000n>300000n)fail('context_stale');
  return await run.finish({format:'angbao-checkpoint-owner-context@1',requestDigest:request.requestDigest,operationKey:options.operationKey,chainId:46630,owner:request.owner,buildReference:request.buildReference,observedAt:new Date(ms).toISOString(),expiresAt:new Date(Math.min(ms+60000,Date.parse(request.expiresAt))).toISOString(),checkpoint:block,ownerNonce:nonce,pendingNonce:pending,ownerBalanceWei:q(balance).toString(),ownerCodeEmpty:true});
 }catch(error){boundedError(error);}}
 async function preflight(intentValue,optionValue){try{
  const intent=validateCheckpointExecutionIntent(intentValue),options=snapshotOptions(intent,optionValue,'preflight',time(),reader),prior=optionValue.deploymentObservation;assertCheckpointExecutionCurrent(intent,new Date(time()));const run=begin(intent,options,'preflight',prior);
  const [,rawBlock]=await run.packet('identity',[req('eth_chainId',[]),req('eth_getBlockByNumber',['latest',false])]);if(rawBlock===null)fail('state_mismatch');const block=projectBlock(rawBlock);hash(block.hash);hash(block.parentHash);for(const k of ['number','timestamp','baseFeePerGas'])q(block[k]);
  const requests=[req('eth_getCode',[intent.owner,block.number]),req('eth_getBalance',[intent.owner,block.number]),req('eth_getTransactionCount',[intent.owner,block.number]),req('eth_getTransactionCount',[intent.owner,'pending']),req('eth_getCode',[intent.contract,block.number]),req('eth_estimateGas',[intent.transaction,block.number])];
  if(intent.purpose===COMMIT)requests.push(req('eth_call',[{to:intent.contract,data:encodeFunctionData({abi:ABI,functionName:'commitments',args:[intent.owner,intent.checkpoint.anchor.operationRef]})},block.number]));
  const [ownerCode,balance,nonce,pending,code,estimate,storedCommitment]=await run.packet('state',requests);K.hex(ownerCode);K.hex(code);q(balance);q(nonce);q(pending);q(estimate);
  if(ownerCode!=='0x'||q(nonce)!==BigInt(intent.payer.nonce)||q(pending)!==BigInt(intent.payer.nonce)||q(balance)<BigInt(intent.costs.maximumGasFeeWei)||q(block.baseFeePerGas)>BigInt(intent.payer.maxFeePerGas)||q(estimate)<BigInt(intent.costs.minimumIntrinsicGas)||q(estimate)>BigInt(intent.payer.gasLimit)||code!==(intent.purpose===CREATE?'0x':build.runtimeBytecode.hex)||intent.purpose===COMMIT&&storedCommitment!==ZERO)fail('state_mismatch');
  const [recheck,finalNonce]=await run.packet('canonical-recheck',[req('eth_getBlockByNumber',[block.number,false]),req('eth_getTransactionCount',[intent.owner,'pending'])]);
  if(recheck===null||!same(projectBlock(recheck),block)||q(finalNonce)!==BigInt(intent.payer.nonce))fail('reorg_uncertain');
  const ms=run.clock(),blockMs=q(block.timestamp)*1000n;if(blockMs>BigInt(ms+30000)||BigInt(ms)-blockMs>300000n)fail('context_stale');
  return await run.finish({format:'angbao-checkpoint-preflight@1',intentDigest:intent.intentDigest,purpose:intent.purpose,operationKey:options.operationKey,phase:options.phase,chainId:46630,owner:intent.owner,contract:intent.contract,buildReference:intent.buildReference,observedAt:new Date(ms).toISOString(),expiresAt:new Date(Math.min(ms+60000,Date.parse(intent.expiresAt))).toISOString(),checkpoint:block,ownerNonce:nonce,pendingNonce:pending,ownerBalanceWei:q(balance).toString(),estimatedGas:q(estimate).toString(),targetCodeSha256:sha(Buffer.from(code.slice(2),'hex'))});
 }catch(error){boundedError(error);}}
 async function observe(intentValue,submissionValue,optionValue){try{
  const intent=validateCheckpointExecutionIntent(intentValue),submission=validateCheckpointExecutionSubmission(intent,submissionValue),options=snapshotOptions(intent,optionValue,'observation',time(),reader),prior=optionValue.deploymentObservation,run=begin(intent,options,'observation',prior);
  const [,tx,receipt]=await run.packet('transaction',[req('eth_chainId',[]),req('eth_getTransactionByHash',[submission.transactionHash]),req('eth_getTransactionReceipt',[submission.transactionHash])]);
  let block=null,head=null,code=null;
  if(tx!==null&&receipt!==null){q(receipt.blockNumber);hash(receipt.blockHash);const [raw,number,runtime,recheck]=await run.packet('receipt-checkpoint',[req('eth_getBlockByNumber',[receipt.blockNumber,false]),req('eth_blockNumber',[]),req('eth_getCode',[intent.contract,{blockHash:receipt.blockHash,requireCanonical:true}]),req('eth_getBlockByNumber',[receipt.blockNumber,false])]);
   if(raw===null||recheck===null||!same(projectBlock(raw),projectBlock(recheck)))fail('reorg_uncertain');K.hex(runtime);block=projectBlock(raw);head=number;code={chainId:46630,address:intent.contract,blockHash:receipt.blockHash,code:runtime};
  }
  const evidence=copy({format:'angbao-checkpoint-execution-evidence@1',chainId:46630,observedAt:new Date(run.clock()).toISOString(),transaction:projectTransaction(tx),receipt:projectReceipt(receipt,intent),canonicalBlock:block,latestBlockNumber:head,contractCodeAtReceipt:code});
  const correlation=verifyCheckpointExecutionEvidence(intent,submission,evidence,{minimumConfirmations:options.minimumConfirmations,previousBlockHash:options.previousBlockHash});
  return await run.finish({format:'angbao-checkpoint-observation@1',intentDigest:intent.intentDigest,purpose:intent.purpose,operationKey:options.operationKey,submission,evidence,options:{minimumConfirmations:options.minimumConfirmations,previousBlockHash:options.previousBlockHash},correlation});
 }catch(error){boundedError(error);}}
 reader=Object.freeze({discoverOwnerContext,preflight,observe,isTrustedResult:value=>brands.get(value)?.reader===reader,usage:()=>copy({reservedRequests,completedRequests,attemptedScopes:attempts.size})});registry.add(reader);return reader;
}
export function validateCheckpointOwnerContextRecord(requestValue,value){return guard(()=>{
 const request=validateCheckpointOwnerContextRequest(requestValue);K.bounded(value,16384);K.exact(value,['format','requestDigest','operationKey','chainId','owner','buildReference','observedAt','expiresAt','checkpoint','ownerNonce','pendingNonce','ownerBalanceWei','ownerCodeEmpty','requestAudit','readCount','reservedReadCount','endpoint','verificationSource',...Object.keys(authority()),'currentConfirmationEstablished']);K.uuid(value.operationKey);K.iso(value.observedAt);K.iso(value.expiresAt);
 if(value.format!=='angbao-checkpoint-owner-context@1'||value.requestDigest!==request.requestDigest||value.chainId!==46630||value.owner!==request.owner||!same(value.buildReference,request.buildReference)||value.endpoint!==CHECKPOINT_CHAIN_ENDPOINT||value.verificationSource!=='configured-server-chain-reader'||value.ownerCodeEmpty!==true||value.currentConfirmationEstablished!==false||Object.keys(authority()).some(k=>value[k]!==false)||value.ownerNonce!==value.pendingNonce||q(value.ownerNonce)>(1n<<64n)-2n||K.integer(value.ownerBalanceWei,(1n<<256n)-1n,true)<BigInt(request.caps.gasLimit)*BigInt(request.caps.maxFeePerGas)||Date.parse(value.expiresAt)<=Date.parse(value.observedAt)||Date.parse(value.expiresAt)>Math.min(Date.parse(value.observedAt)+60000,Date.parse(request.expiresAt))||Date.parse(value.observedAt)<Date.parse(request.createdAt))fail('scope_changed');
 if(!same(value.checkpoint,projectBlock(value.checkpoint))||q(value.checkpoint.baseFeePerGas)>BigInt(request.caps.maxFeePerGas)||!Array.isArray(value.requestAudit)||value.requestAudit.length!==8||value.readCount!==8||value.reservedReadCount!==8||q(value.checkpoint.timestamp)*1000n>BigInt(Date.parse(value.observedAt)+30000)||BigInt(Date.parse(value.observedAt))-q(value.checkpoint.timestamp)*1000n>300000n)fail('scope_changed');const methods=['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_getBalance','eth_getTransactionCount','eth_getTransactionCount','eth_getBlockByNumber','eth_getTransactionCount'];for(const [i,a]of value.requestAudit.entries()){K.exact(a,['method','requestDigest','responseSha256','responseBytes']);K.sha(a.requestDigest);K.sha(a.responseSha256);if(a.method!==methods[i]||!Number.isSafeInteger(a.responseBytes)||a.responseBytes<1||a.responseBytes>L.maxResponseBytes)fail('scope_changed');}return copy(value);
});}
export function assertTrustedCheckpointOwnerContext(reader,requestValue,value,options={now:new Date()}){return guard(()=>{K.exact(options,['now']);const request=validateCheckpointOwnerContextRequest(requestValue),m=metadata(reader,value);if(m.kind!=='discovery'||m.intent.requestDigest!==request.requestDigest)fail('untrusted_result');const ms=assertCheckpointOwnerContextCurrent(request,options.now);if(ms<Date.parse(value.observedAt)||ms>=Date.parse(value.expiresAt))fail('context_stale');return validateCheckpointOwnerContextRecord(request,value);});}
export function assertTrustedCheckpointPreflight(reader,intentValue,result,options={now:new Date()}){return guard(()=>{
 K.exact(options,['now']);const intent=validateCheckpointExecutionIntent(intentValue),m=metadata(reader,result);if(m.kind!=='preflight'||m.intent.intentDigest!==intent.intentDigest)fail('untrusted_result');const ms=assertCheckpointExecutionCurrent(intent,options.now);
 if(Date.parse(result.observedAt)>ms||Date.parse(result.expiresAt)<=ms)fail('context_stale');return result;
});}
export function checkpointDeploymentReferenceFromObservation(reader,intentValue,result){return guard(()=>{
 const intent=validateCheckpointExecutionIntent(intentValue),m=metadata(reader,result);if(m.kind!=='observation'||intent.purpose!==CREATE||m.intent.intentDigest!==intent.intentDigest||result.correlation.status!=='offline-correlated')fail('deployment_not_observed');
 return validateCheckpointDeploymentReference({format:'angbao-checkpoint-deployment-reference@1',creationIntentDigest:intent.intentDigest,transactionHash:result.submission.transactionHash,blockHash:result.correlation.blockHash,contract:intent.contract,buildReference:intent.buildReference},intent);
});}
export function retainCheckpointObservation(reader,intentValue,result){return guard(()=>{
 const intent=validateCheckpointExecutionIntent(intentValue),m=metadata(reader,result);if(m.kind!=='observation'||m.intent.intentDigest!==intent.intentDigest)fail('untrusted_result');
 const body={format:'angbao-retained-checkpoint-observation@1',intentDigest:intent.intentDigest,submission:result.submission,evidence:result.evidence,options:result.options,correlation:result.correlation,requestAudit:result.requestAudit,recordedEndpoint:CHECKPOINT_CHAIN_ENDPOINT,verificationSource:'historical-record-only',currentProviderProvenanceEstablished:false,...authority()};
 return copy({...body,retainedDigest:K.digest(body)});
});}
export function validateRetainedCheckpointObservation(intentValue,value){return guard(()=>{
 const intent=validateCheckpointExecutionIntent(intentValue);K.bounded(value,393216);K.exact(value,['format','intentDigest','submission','evidence','options','correlation','requestAudit','recordedEndpoint','verificationSource','currentProviderProvenanceEstablished',...Object.keys(authority()),'retainedDigest']);
 const {retainedDigest,...body}=value;if(value.format!=='angbao-retained-checkpoint-observation@1'||value.intentDigest!==intent.intentDigest||value.recordedEndpoint!==CHECKPOINT_CHAIN_ENDPOINT||value.verificationSource!=='historical-record-only'||value.currentProviderProvenanceEstablished!==false||!Object.keys(authority()).every(k=>value[k]===false)||retainedDigest!==K.digest(body))fail('retained_changed');
 if(!Array.isArray(value.requestAudit)||value.requestAudit.length>8)fail('retained_changed');for(const audit of value.requestAudit){K.exact(audit,['method','requestDigest','responseSha256','responseBytes']);K.sha(audit.requestDigest);K.sha(audit.responseSha256);if(!Number.isSafeInteger(audit.responseBytes)||audit.responseBytes<1||audit.responseBytes>L.maxResponseBytes||!['eth_chainId','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getBlockByNumber','eth_blockNumber','eth_getCode'].includes(audit.method))fail('retained_changed');}
 if(!same(projectTransaction(value.evidence.transaction),value.evidence.transaction)||!same(projectReceipt(value.evidence.receipt,intent),value.evidence.receipt)||!same(projectBlock(value.evidence.canonicalBlock),value.evidence.canonicalBlock))fail('retained_changed');
 if(value.evidence.contractCodeAtReceipt!==null){const code=value.evidence.contractCodeAtReceipt;K.exact(code,['chainId','address','blockHash','code']);K.hex(code.code);if(code.code.length>131074)fail('retained_changed');}
 if((value.evidence.transaction===null||value.evidence.receipt===null)&&(value.evidence.canonicalBlock!==null||value.evidence.latestBlockNumber!==null||value.evidence.contractCodeAtReceipt!==null))fail('retained_changed');
 if(!same(verifyCheckpointExecutionEvidence(intent,value.submission,value.evidence,value.options),value.correlation))fail('retained_changed');return copy(value);
});}
