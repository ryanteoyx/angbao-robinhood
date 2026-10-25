/** Creation-specific verification/read/retention. No broadcast, signer or faucet capability. */
import {createHash} from 'node:crypto';
import {decodeEventLog,decodeFunctionData,encodeAbiParameters,encodeEventTopics,encodeFunctionData,parseAbi} from '../vendor/goal-transfer-viem.mjs';
import {entryPoint07Abi,getUserOperationHash,toPackedUserOperation} from '../vendor/goal-transfer-viem.mjs';
import {validateKernelInitializationIntent,KERNEL_INITIALIZATION_ROUTE as R,KERNEL_PROXY_RUNTIME,KERNEL_IMPLEMENTATION_SLOT,KERNEL_INIT_GAS_FIELDS as GAS,KERNEL_INIT_OPERATION_FIELDS as FIELDS,kernelInitializationInternals as U} from '../domain/kernel-initialization.mjs';
const {fail,bounded,exact,hex,address,integer,quantity:q,iso,sha,canonical,digest,freeze,typed}=U;
const hash=v=>hex(v,32),shaBytes=v=>createHash('sha256').update(Buffer.from(hex(v).slice(2),'hex')).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b),pick=(v,keys)=>Object.fromEntries(keys.map(k=>[k,v[k]]));
const META=['transactionHash','blockHash','blockNumber','transactionIndex'];
const TX=['hash','to','value','blockHash','blockNumber','transactionIndex'];
const BLOCK=['number','hash','parentHash','timestamp','baseFeePerGas','transactions'];
const CODE_ROLES=['implementation','validator','entryPoint','kernelFactory','factory'];
const STATE=['blockHash','blockNumber','accountCodeHash','implementation','rootValidator','validationNonce','hook','owner','entryPoint','factoryApproved','factoryImplementation','codeHashes'];
const FACTS=['submission','transaction','receipt','canonicalBlock','latestBlockNumber','bundle','accountState','expectedRoute'];
const INITIALIZATION_AUTHORITY=Object.freeze({ownerApprovalEstablished:false,signingAllowed:false,deploymentAllowed:false,submissionAllowed:false,tokenFundingEstablished:false,financialSuccessEstablished:false});
const abi=parseAbi(['function rootValidator() view returns(bytes21)','function validationConfig(bytes21) view returns(uint32 nonce,address hook)','function ecdsaValidatorStorage(address) view returns(address owner)','function entrypoint() view returns(address)','function approved(address) view returns(bool)','function implementation() view returns(address)']);

export function validateKernelInitializationSubmission(value,input){
 const intent=validateKernelInitializationIntent(value);bounded(input,32768);exact(input,['purpose','intentDigest','entryPoint','userOperationHash','userOperation']);
 if(input.purpose!=='kernel-account-initialization'||input.intentDigest!==intent.intentDigest||input.entryPoint!==R.entryPoint)fail('submission_scope');
 exact(input.userOperation,FIELDS);const op=input.userOperation;address(op.sender);address(op.factory);address(op.paymaster);hex(op.factoryData);hex(op.callData);hex(op.paymasterData);
 if(op.sender!==intent.account||op.factory!==R.factory||op.factoryData!==intent.factoryData||op.callData!==intent.callData||op.paymasterData==='0x')fail('operation_mismatch');
 for(const k of ['nonce',...GAS,'maxFeePerGas','maxPriorityFeePerGas']){if(typeof op[k]!=='string')fail('invalid_integer');integer(op[k],k==='nonce'?(1n<<256n)-1n:(1n<<120n)-1n,['nonce','maxPriorityFeePerGas'].includes(k));}
 if(BigInt(op.maxPriorityFeePerGas)>BigInt(op.maxFeePerGas)||(BigInt(op.nonce)>>64n)!==BigInt('0x0000'+R.validator.slice(2)+'0000'))fail('nonce_or_fee_mismatch');
 const expected=getUserOperationHash({chainId:46630,entryPointAddress:R.entryPoint,entryPointVersion:'0.7',userOperation:typed(op)}).toLowerCase();
 if(hash(input.userOperationHash)!==expected)fail('user_operation_hash');return freeze(structuredClone(input));
}
function route(value,intent){exact(value,['digest','codeHashes']);if(sha(value.digest)!==intent.routeEvidenceDigest)fail('route_evidence_changed');exact(value.codeHashes,CODE_ROLES);CODE_ROLES.forEach(k=>{sha(value.codeHashes[k]);if(value.codeHashes[k]===shaBytes('0x'))fail('empty_route_code');});return value;}
function event(log){
 if(log.address?.toLowerCase()!==R.entryPoint)return null;
 try{
  const d=decodeEventLog({abi:entryPoint07Abi,topics:log.topics,data:log.data,strict:true});
  if(!['BeforeExecution','UserOperationEvent','AccountDeployed'].includes(d.eventName))return null;
  const a=d.args,topics=encodeEventTopics({abi:entryPoint07Abi,eventName:d.eventName,args:a});
  const data=d.eventName==='BeforeExecution'?'0x':d.eventName==='AccountDeployed'?encodeAbiParameters([{type:'address'},{type:'address'}],[a.factory,a.paymaster]):encodeAbiParameters([{type:'uint256'},{type:'bool'},{type:'uint256'},{type:'uint256'}],[a.nonce,a.success,a.actualGasCost,a.actualGasUsed]);
  if(!same(topics.map(v=>v.toLowerCase()),log.topics.map(v=>v.toLowerCase()))||data!==log.data.toLowerCase())return null;
  const keys=d.eventName==='BeforeExecution'?[]:d.eventName==='AccountDeployed'?['userOpHash','sender','factory','paymaster']:['userOpHash','sender','paymaster','nonce','success','actualGasCost','actualGasUsed'];
  return {type:d.eventName,...pick(log,[...META,'logIndex','removed']),args:Object.fromEntries(keys.map(k=>[k,typeof a[k]==='bigint'?a[k].toString():typeof a[k]==='string'?a[k].toLowerCase():a[k]]))};
 }catch{return null;}
}
function project(intent,evidence){
 bounded(evidence,1048576);exact(evidence,['format','chainId','observedAt','submission','transaction','receipt','canonicalBlock','latestBlockNumber','accountState','expectedRoute']);
 if(evidence.format!=='angbao-kernel-initialization-chain-evidence@1'||evidence.chainId!==46630)fail('evidence_scope');iso(evidence.observedAt);
 const submission=validateKernelInitializationSubmission(intent,evidence.submission);route(evidence.expectedRoute,intent);
 const tx=evidence.transaction===null?null:pick(evidence.transaction,TX),receipt=evidence.receipt===null?null:{...pick(evidence.receipt,[...META,'status']),events:[]};
 if(receipt){if(!Array.isArray(evidence.receipt.logs)||evidence.receipt.logs.length>256)fail('receipt_bounds');let prior=-1n;for(const log of evidence.receipt.logs){if(log.removed!==false||!META.every(k=>log[k]===receipt[k])||q(log.logIndex)<=prior)fail('log_metadata');prior=q(log.logIndex);const e=event(log);if(e)receipt.events.push(e);}}
 let bundle=null,inputAudit={originalInputSha256:null,inputByteLength:null,packedSignaturesDiscarded:0};
 if(evidence.transaction?.input!==undefined){const input=hex(evidence.transaction.input.toLowerCase());if(input.length>131074)fail('input_bounds');inputAudit={originalInputSha256:shaBytes(input),inputByteLength:(input.length-2)/2,packedSignaturesDiscarded:0};
  try{const d=decodeFunctionData({abi:entryPoint07Abi,data:input});if(d.functionName==='handleOps'&&d.args[0].length<=32&&encodeFunctionData({abi:entryPoint07Abi,functionName:d.functionName,args:d.args}).toLowerCase()===input){const packed=d.args[0],expected=toPackedUserOperation(typed(submission.userOperation)),indices=packed.map((op,i)=>Object.keys(expected).every(k=>k==='signature'||String(op[k]).toLowerCase()===String(expected[k]).toLowerCase())?i:-1).filter(i=>i>=0);bundle={operations:packed.map(op=>({sender:op.sender.toLowerCase(),nonce:op.nonce.toString()})),selectedIndex:indices.length===1?indices[0]:null};inputAudit.packedSignaturesDiscarded=packed.length;}}catch{/* Unsupported envelope never establishes deployment. */}
 }
 const facts={submission,transaction:tx,receipt,canonicalBlock:evidence.canonicalBlock===null?null:pick(evidence.canonicalBlock,BLOCK),latestBlockNumber:evidence.latestBlockNumber,bundle,accountState:evidence.accountState===null?null:pick(evidence.accountState,STATE),expectedRoute:structuredClone(evidence.expectedRoute)};
 return {facts:structuredClone(facts),inputAudit};
}
function validateFacts(intent,f){
 bounded(f,131072);exact(f,FACTS);validateKernelInitializationSubmission(intent,f.submission);route(f.expectedRoute,intent);
 if(f.transaction!==null){exact(f.transaction,TX);hash(f.transaction.hash);address(f.transaction.to);q(f.transaction.value);['blockHash'].forEach(k=>{if(f.transaction[k]!==null)hash(f.transaction[k]);});for(const k of ['blockNumber','transactionIndex'])if(f.transaction[k]!==null)q(f.transaction[k]);}
 if(f.receipt!==null){exact(f.receipt,[...META,'status','events']);hash(f.receipt.transactionHash);hash(f.receipt.blockHash);q(f.receipt.blockNumber);q(f.receipt.transactionIndex);if(!['0x0','0x1'].includes(f.receipt.status)||!Array.isArray(f.receipt.events)||f.receipt.events.length>256)fail('receipt_invalid');let prior=-1n;for(const e of f.receipt.events){exact(e,['type',...META,'logIndex','removed','args']);if(e.removed!==false||!META.every(k=>e[k]===f.receipt[k])||q(e.logIndex)<=prior)fail('event_metadata');prior=q(e.logIndex);const fields=e.type==='BeforeExecution'?[]:e.type==='AccountDeployed'?['userOpHash','sender','factory','paymaster']:e.type==='UserOperationEvent'?['userOpHash','sender','paymaster','nonce','success','actualGasCost','actualGasUsed']:null;if(!fields)fail('event_type');exact(e.args,fields);for(const [k,v]of Object.entries(e.args)){if(k==='success'){if(typeof v!=='boolean')fail('event_boolean');}else if(['nonce','actualGasCost','actualGasUsed'].includes(k))integer(v,(1n<<256n)-1n,true);else if(k==='userOpHash')hash(v);else hex(v,20);}}}
 if(f.canonicalBlock!==null){const b=f.canonicalBlock;exact(b,BLOCK);hash(b.hash);hash(b.parentHash);for(const k of ['number','timestamp','baseFeePerGas'])q(b[k]);if(!Array.isArray(b.transactions)||b.transactions.length>2048)fail('block_bounds');b.transactions.forEach(hash);}
 if(f.latestBlockNumber!==null)q(f.latestBlockNumber);
 if(f.bundle!==null){exact(f.bundle,['operations','selectedIndex']);if(!Array.isArray(f.bundle.operations)||f.bundle.operations.length<1||f.bundle.operations.length>32||f.bundle.selectedIndex!==null&&(!Number.isInteger(f.bundle.selectedIndex)||f.bundle.selectedIndex<0||f.bundle.selectedIndex>=f.bundle.operations.length))fail('bundle_invalid');for(const op of f.bundle.operations){exact(op,['sender','nonce']);address(op.sender);integer(op.nonce,(1n<<256n)-1n,true);}}
 if(f.accountState!==null){const s=f.accountState;exact(s,STATE);hash(s.blockHash);q(s.blockNumber);sha(s.accountCodeHash);address(s.implementation);hex(s.rootValidator,21);integer(s.validationNonce,(1n<<32n)-1n,true);address(s.hook);address(s.owner);address(s.entryPoint);address(s.factoryImplementation);if(typeof s.factoryApproved!=='boolean')fail('factory_approval');exact(s.codeHashes,CODE_ROLES);CODE_ROLES.forEach(k=>sha(s.codeHashes[k]));}
}
function evaluate(intent,f,observedAt,{minimumConfirmations=1,previous=null}={}){
 validateFacts(intent,f);iso(observedAt);if(!Number.isSafeInteger(minimumConfirmations)||minimumConfirmations<1||minimumConfirmations>1000)fail('confirmation_limit');
 const op=f.submission.userOperation,tx=f.transaction,r=f.receipt,b=f.canonicalBlock;
 const finish=(status,reason,extra={})=>freeze({status,reason,purpose:'kernel-account-initialization',intentDigest:intent.intentDigest,userOperationHash:f.submission.userOperationHash,transactionHash:tx?.hash??null,account:intent.account,confirmations:0,accountDeploymentEstablished:false,verificationSource:'supplied-evidence',billingAssurance:'unverified-provider-billing',authority:INITIALIZATION_AUTHORITY,...extra});
 if(!tx||!r)return finish('uncertain',previous?.blockHash?'reorg-uncertain':'receipt-not-observed');
 if(tx.to!==R.entryPoint||q(tx.value)!==0n||tx.hash!==r.transactionHash)return finish('uncertain','transaction-mismatch');
 if(!b||f.latestBlockNumber===null||!META.slice(1).every(k=>tx[k]===r[k])||b.number!==r.blockNumber||b.hash!==r.blockHash||previous?.blockHash&&previous.blockHash!==b.hash||q(f.latestBlockNumber)<q(b.number)||q(r.transactionIndex)>=BigInt(b.transactions.length)||b.transactions[Number(q(r.transactionIndex))]!==tx.hash)return finish('uncertain','reorg-uncertain');
 const confirmations=Number(q(f.latestBlockNumber)-q(b.number)+1n);if(!Number.isSafeInteger(confirmations))fail('head_bounds');const context={confirmations,blockHash:b.hash,blockNumber:q(b.number).toString()};
 if(r.status==='0x0')return finish('failed','bundle-reverted',context);
 const bundle=f.bundle;if(!bundle||bundle.selectedIndex===null)return finish('uncertain','creation-envelope-mismatch',context);
 const operations=r.events.filter(e=>e.type==='UserOperationEvent'),selected=operations[bundle.selectedIndex],matching=operations.filter(e=>e.args.userOpHash===f.submission.userOperationHash);
 if(operations.length!==bundle.operations.length||!operations.every((e,i)=>e.args.sender===bundle.operations[i].sender&&e.args.nonce===bundle.operations[i].nonce)||matching.length!==1||selected!==matching[0]||selected.args.sender!==op.sender||selected.args.nonce!==op.nonce||selected.args.paymaster!==op.paymaster||bundle.operations[bundle.selectedIndex].sender!==op.sender||bundle.operations[bundle.selectedIndex].nonce!==op.nonce)return finish('uncertain','creation-operation-event-mismatch',context);
 const deployments=r.events.filter(e=>e.type==='AccountDeployed'&&e.args.userOpHash===f.submission.userOperationHash),boundaries=r.events.filter(e=>e.type==='BeforeExecution');
 if(deployments.length!==1||deployments[0].args.sender!==intent.account||deployments[0].args.factory!==op.factory||deployments[0].args.paymaster!==op.paymaster||boundaries.length!==1||q(deployments[0].logIndex)>=q(boundaries[0].logIndex)||q(boundaries[0].logIndex)>=q(selected.logIndex))return finish('uncertain','account-deployed-event-mismatch',context);
 const declared=GAS.reduce((n,k)=>n+BigInt(op[k]),0n),price=BigInt(op.maxFeePerGas)<q(b.baseFeePerGas)+BigInt(op.maxPriorityFeePerGas)?BigInt(op.maxFeePerGas):q(b.baseFeePerGas)+BigInt(op.maxPriorityFeePerGas),used=BigInt(selected.args.actualGasUsed),cost=BigInt(selected.args.actualGasCost);
 if(used===0n||used>declared||cost!==used*price||cost>declared*BigInt(op.maxFeePerGas))return finish('uncertain','gas-cap-or-cost-mismatch',context);
 const fee={actualGasUsed:used.toString(),actualGasCostWei:cost.toString(),maximumCostWei:(declared*BigInt(op.maxFeePerGas)).toString()};
 if(!selected.args.success)return finish('failed','creation-user-operation-failed',{...context,fee});
 const s=f.accountState;if(!s||s.blockHash!==b.hash||s.blockNumber!==b.number||s.accountCodeHash!==shaBytes(KERNEL_PROXY_RUNTIME)||s.implementation!==R.implementation||s.rootValidator!==intent.rootValidator||s.validationNonce==='0'||s.hook!=='0x'+'0'.repeat(39)+'1'||s.owner!==intent.owner||s.entryPoint!==R.entryPoint||!s.factoryApproved||s.factoryImplementation!==R.implementation||!same(s.codeHashes,f.expectedRoute.codeHashes))return finish('uncertain','created-account-state-unverified',{...context,fee});
 if(Date.parse(observedAt)<Date.parse(intent.createdAt)||BigInt(Date.parse(observedAt))<q(b.timestamp)*1000n||q(b.timestamp)*1000n+999n<BigInt(Date.parse(intent.createdAt)))return finish('uncertain','observation-time-mismatch',context);
 if(confirmations<minimumConfirmations)return finish('uncertain','confirmation-threshold-not-met',{...context,fee});
 return finish('offline-deployed-unfunded','creation-and-state-correlated',{...context,fee,accountDeploymentEstablished:true});
}
/** Pure supplied evidence can never establish provider provenance or funding. */
export function verifyKernelInitializationReceipt(value,evidence,options={}){bounded(options,4096);exact(options,Object.keys(options));if(Object.keys(options).some(k=>!['minimumConfirmations','previous'].includes(k)))fail('invalid_options');const intent=validateKernelInitializationIntent(value),{facts,inputAudit}=project(intent,evidence),verificationContext={minimumConfirmations:options.minimumConfirmations??1,previousBlockHash:options.previous?.blockHash??null};if(verificationContext.previousBlockHash!==null)hash(verificationContext.previousBlockHash);return freeze({...evaluate(intent,facts,evidence.observedAt,options),observedAt:evidence.observedAt,facts,inputAudit,verificationContext});}

const call=(to,functionName,args=[])=>({to,data:encodeFunctionData({abi,functionName,args})});
function word(v){hex(v,32);return v.slice(2);}
function wordAddress(v){const w=word(v);if(!/^0{24}/.test(w))fail('address_padding');return '0x'+w.slice(24);}
function rootWord(v){const w=word(v);if(!/^0{22}$/.test(w.slice(42)))fail('root_padding');return '0x'+w.slice(0,42);}
function configWord(v){hex(v,64);const first=v.slice(2,66);if(!/^0{56}/.test(first))fail('nonce_padding');return {validationNonce:BigInt('0x'+first).toString(),hook:wordAddress('0x'+v.slice(66))};}
/** Fixed trusted configuration, default denied. Exact resolved packets reserved by outer persistent policy. */
export function createKernelInitializationReadAdapter({chainRpcUrl,bundlerRpcUrl,fetchImpl=globalThis.fetch,authorizePlan=async()=>false,resolveAcceptedRoute=async()=>null}={}){
 for(const u of [chainRpcUrl,bundlerRpcUrl]){let url;try{url=new URL(u);}catch{fail('invalid_read_configuration');}if(url.protocol!=='https:'||url.username||url.password||url.hash)fail('invalid_read_configuration');}
 if([fetchImpl,authorizePlan,resolveAcceptedRoute].some(v=>typeof v!=='function'))fail('invalid_read_configuration');
 const attempts=new Set(),trusted=new WeakSet();let reserved=0;
 const request=(service,method,params)=>({service,method,params});
 async function observe(value,submitted,options={}){
  bounded(options,4096);exact(options,Object.keys(options));const safeOptions=structuredClone(options);
  const intent=validateKernelInitializationIntent(value),submission=validateKernelInitializationSubmission(intent,submitted);
  if(attempts.has(intent.intentDigest)||attempts.size>=16)fail('observation_already_attempted');attempts.add(intent.intentDigest);
  async function acceptedRoute(){try{const value=await resolveAcceptedRoute(intent);bounded(value,4096);route(value,intent);return freeze(structuredClone(value));}catch{fail('route_not_accepted');}}
  const expectedRoute=await acceptedRoute();let count=0;const started=performance.now();
  async function packet(phase,requests){
   if(requests.length>12||count+requests.length>20)fail('read_budget');const plan=freeze({format:'angbao-kernel-initialization-read-plan@1',purpose:'kernel-account-initialization',intentDigest:intent.intentDigest,phase,scope:'creation-receipt-and-state',maximumScopeRequests:20,alreadyAttemptedRequests:count,requests,limits:{maxResponseBytes:131072,maxPacketBytes:1048576,requestTimeoutMs:5000,scopeTimeoutMs:30000},authority:'read-only-exact-packet',signingAllowed:false,deploymentAllowed:false,submissionAllowed:false});
   if(await authorizePlan(plan)!==true)fail('read_authorization_denied');count+=requests.length;reserved+=requests.length;let packetBytes=0;
   const results=[];
   for(const r of requests){
    const remaining=30000-(performance.now()-started);if(remaining<=0)fail('read_timeout');
    const controller=new AbortController();let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('bounded read timeout'));},Math.min(5000,remaining));});
    try{
     const data=await Promise.race([timeout,(async()=>{
      const response=await fetchImpl(r.service==='chain'?chainRpcUrl:bundlerRpcUrl,{method:'POST',redirect:'error',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:r.method,params:r.params}),signal:controller.signal});
      if(!response.ok||response.status!==200||Number(response.headers.get('content-length')??0)>131072)fail('provider_read_failed');
      const reader=response.body?.getReader();if(!reader)fail('provider_read_failed');const chunks=[];let bytes=0;
      while(true){const part=await reader.read();if(controller.signal.aborted)fail('read_timeout');if(part.done)break;bytes+=part.value.length;packetBytes+=part.value.length;if(bytes>131072||packetBytes>1048576){await reader.cancel();fail('read_response_bounds');}chunks.push(part.value);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));bounded(body,131072);
      if(body.jsonrpc!=='2.0'||body.id!==1||body.error||!Object.hasOwn(body,'result'))fail('provider_read_failed');return body.result;
     })()]);results.push(data);
    }catch{fail('provider_read_failed');}finally{clearTimeout(timer);}
   }
   return results;
  }
  const base={format:'angbao-kernel-initialization-chain-evidence@1',chainId:46630,observedAt:new Date().toISOString(),submission,transaction:null,receipt:null,canonicalBlock:null,latestBlockNumber:null,accountState:null,expectedRoute};
  const [located]=await packet('discovery',[request('bundler','eth_getUserOperationReceipt',[submission.userOperationHash])]);
  async function finish(e){const verified=verifyKernelInitializationReceipt(intent,e,safeOptions);if(!same(await acceptedRoute(),expectedRoute))fail('route_evidence_changed');const result=freeze({...verified,status:verified.status==='offline-deployed-unfunded'?'deployed-unfunded':verified.status,verificationSource:'fixed-server-provider-read',readCount:count});trusted.add(result);return result;}
  if(located===null)return finish(base);if(located.userOpHash?.toLowerCase()!==submission.userOperationHash)fail('bundler_hash_mismatch');const txHash=hash(located.receipt?.transactionHash?.toLowerCase());
  const [chainId,transaction,receipt]=await packet('transaction',[request('chain','eth_chainId',[]),request('chain','eth_getTransactionByHash',[txHash]),request('chain','eth_getTransactionReceipt',[txHash])]);if(q(chainId)!==46630n)fail('wrong_chain');if(!receipt||!transaction)return finish({...base,transaction,receipt});
  const [block,head]=await packet('checkpoint',[request('chain','eth_getBlockByNumber',[receipt.blockNumber,false]),request('chain','eth_blockNumber',[])]);if(!block||block.hash!==receipt.blockHash)return finish({...base,transaction,receipt,canonicalBlock:block,latestBlockNumber:head});
  const beforeState={...base,transaction,receipt,canonicalBlock:block,latestBlockNumber:head};const preflight=verifyKernelInitializationReceipt(intent,beforeState,safeOptions);if(preflight.status==='failed'||preflight.reason!=='created-account-state-unverified')return finish(beforeState);
  const pin={blockHash:hash(block.hash),requireCanonical:true};
  const values=await packet('account-state',[request('chain','eth_getCode',[intent.account,pin]),request('chain','eth_getStorageAt',[intent.account,KERNEL_IMPLEMENTATION_SLOT,pin]),request('chain','eth_call',[call(intent.account,'rootValidator'),pin]),request('chain','eth_call',[call(R.validator,'ecdsaValidatorStorage',[intent.account]),pin]),request('chain','eth_call',[call(intent.account,'entrypoint'),pin]),...CODE_ROLES.map(k=>request('chain','eth_getCode',[R[k],pin]))]);
  const observedRoot=rootWord(values[2]);const [config,approved,implementation,recheck]=await packet('account-config-and-recheck',[request('chain','eth_call',[call(intent.account,'validationConfig',[observedRoot]),pin]),request('chain','eth_call',[call(R.factory,'approved',[R.kernelFactory]),pin]),request('chain','eth_call',[call(R.kernelFactory,'implementation'),pin]),request('chain','eth_getBlockByNumber',[block.number,false])]);
  if(recheck?.hash!==block.hash)fail('reorg_uncertain');const approval=BigInt(approved);if(approval!==0n&&approval!==1n)fail('approval_boolean');word(approved);
  const accountState={blockHash:block.hash,blockNumber:block.number,accountCodeHash:shaBytes(values[0]),implementation:wordAddress(values[1]),rootValidator:observedRoot,...configWord(config),hook:configWord(config).hook,owner:wordAddress(values[3]),entryPoint:wordAddress(values[4]),factoryApproved:approval===1n,factoryImplementation:wordAddress(implementation),codeHashes:Object.fromEntries(CODE_ROLES.map((k,i)=>[k,shaBytes(values[5+i])]))};
  return finish({...base,observedAt:new Date().toISOString(),transaction,receipt,canonicalBlock:block,latestBlockNumber:head,accountState});
 }
 return Object.freeze({observe,isTrustedResult:value=>trusted.has(value),usage:()=>freeze({reservedRequests:reserved})});
}
const RETAINED=['format','intentDigest','observedAt','recordedStatus','summary','facts','inputAudit','verificationContext','retainedDigest'];
function retainedBody(intent,result){return {format:'angbao-retained-kernel-initialization@1',intentDigest:intent.intentDigest,observedAt:result.observedAt,recordedStatus:result.status==='deployed-unfunded'?'deployed-unfunded-at-observation':result.status+'-at-observation',summary:pick(result,['status','reason','userOperationHash','transactionHash','account','confirmations','accountDeploymentEstablished']),facts:result.facts,inputAudit:result.inputAudit,verificationContext:result.verificationContext};}
export function retainVerifiedKernelInitializationObservation(value,result,reader){const intent=validateKernelInitializationIntent(value);if(!reader||typeof reader.isTrustedResult!=='function'||reader.isTrustedResult(result)!==true||result.verificationSource!=='fixed-server-provider-read')fail('untrusted_initialization_observation');const body=retainedBody(intent,result),retained={...body,retainedDigest:digest({domain:'angbao.retained-kernel-initialization.v1',observation:body})};verifyRetainedKernelInitializationObservation(intent,retained);return freeze(retained);}
export function verifyRetainedKernelInitializationObservation(value,input){
 const intent=validateKernelInitializationIntent(value);bounded(input,131072);exact(input,RETAINED);if(input.format!=='angbao-retained-kernel-initialization@1'||input.intentDigest!==intent.intentDigest)fail('retained_scope');const {retainedDigest,...body}=input;if(retainedDigest!==digest({domain:'angbao.retained-kernel-initialization.v1',observation:body}))fail('retained_changed');
 exact(input.inputAudit,['originalInputSha256','inputByteLength','packedSignaturesDiscarded']);const a=input.inputAudit;if(a.originalInputSha256===null){if(a.inputByteLength!==null||a.packedSignaturesDiscarded!==0)fail('audit_invalid');}else{sha(a.originalInputSha256);if(!Number.isSafeInteger(a.inputByteLength)||a.inputByteLength<0||a.inputByteLength>65536||!Number.isSafeInteger(a.packedSignaturesDiscarded)||a.packedSignaturesDiscarded<0||a.packedSignaturesDiscarded>32)fail('audit_invalid');}
 exact(input.verificationContext,['minimumConfirmations','previousBlockHash']);const context=input.verificationContext;if(a.packedSignaturesDiscarded!==(input.facts.bundle?.operations.length??0))fail('audit_invalid');if(context.previousBlockHash!==null)hash(context.previousBlockHash);const checked=evaluate(intent,input.facts,input.observedAt,{minimumConfirmations:context.minimumConfirmations,previous:context.previousBlockHash===null?null:{blockHash:context.previousBlockHash}});const summary={...pick(checked,['status','reason','userOperationHash','transactionHash','account','confirmations','accountDeploymentEstablished']),status:checked.status==='offline-deployed-unfunded'?'deployed-unfunded':checked.status};if(!same(summary,input.summary)||input.recordedStatus!==(summary.status==='deployed-unfunded'?'deployed-unfunded-at-observation':summary.status+'-at-observation'))fail('retained_summary_changed');
 return freeze({...structuredClone(input),verification:'historical-consistency-only',currentConfirmationEstablished:false,transactionInputAuthentication:'discarded-not-reconstructed',authority:INITIALIZATION_AUTHORITY});
}
