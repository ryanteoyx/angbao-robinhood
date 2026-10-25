/** Unwired, zero-value owner EOA intents and offline correlation. No permission or execution authority. */
import {createHash} from 'node:crypto';
import build from '../../contracts/angbao-commitment.build.json' with {type:'json'};
import {getContractAddress} from '../vendor/kernel-identity-codecs.mjs';
import {kernelInitializationInternals as K} from './kernel-initialization.mjs';
import {portfolioDigest,portfolioCanonical} from './portfolio-work-record.mjs';
import {validateOpeningWorkspace,validateOpeningSelection,validateOpeningBuildReference,DECISION_OPENING_BUILD_REFERENCE,validateDecisionOpeningEntry,validateDecisionOpeningHandle,decisionOpeningHandle,decisionOpeningRequestDigest,decisionOpeningAuthority} from './decision-opening-record.mjs';
import {validateDecisionCheckpoint} from './decision-checkpoint.mjs';
import {verifyDecisionCheckpointObservation} from '../integrations/decision-checkpoint-reconciliation.mjs';
import {ROBINHOOD_TESTNET_FEE_POLICY} from '../integrations/robinhood-eoa-transfer-reconciliation.mjs';

export const CHECKPOINT_CREATE_PURPOSE='angbao-commitment-create';
export const CHECKPOINT_COMMIT_PURPOSE='angbao-decision-checkpoint-commit';
export const CHECKPOINT_OWNER_CONTEXT_PURPOSE='angbao-checkpoint-owner-context';
export const CHECKPOINT_EXECUTION_LIMITS=K.freeze({chainId:46630,maximumGas:500000,maximumFeePerGasWei:'1000000000',maximumLifetimeMs:900000,maximumContextAgeMs:300000,reviewLifetimeMs:60000});
const CREATE=CHECKPOINT_CREATE_PURPOSE,COMMIT=CHECKPOINT_COMMIT_PURPOSE;
K.freeze(build);
const CODES=new Set(['invalid_execution','wrong_purpose','wrong_chain','selection_changed','scope_changed','cost_bounds','expired','submission_changed','invalid_evidence','reorg_uncertain','configuration','read_not_configured','source_not_accepted','read_authorization_denied','read_budget','read_timeout','response_bounds','provider_read_failed','already_attempted','untrusted_result','deployment_not_observed','state_mismatch','context_stale','retained_changed']);
export class CheckpointExecutionError extends Error {constructor(code){code=CODES.has(code)?code:'invalid_execution';super(`Checkpoint execution stopped: ${code}.`);this.name='CheckpointExecutionError';this.code=code;}}
const fail=code=>{throw new CheckpointExecutionError(code);};
const guard=work=>{try{return work();}catch(e){if(e instanceof CheckpointExecutionError)throw new CheckpointExecutionError(Object.getOwnPropertyDescriptor(e,'code')?.value);fail('invalid_execution');}};
const same=(a,b)=>portfolioCanonical(a)===portfolioCanonical(b),sha=v=>createHash('sha256').update(v).digest('hex');
const copy=v=>K.freeze(structuredClone(v)),hash=v=>{K.hex(v,32);if(v==='0x'+'0'.repeat(64))fail('invalid_evidence');return v;},q=v=>K.quantity(v);
const stamp=(domain,value)=>portfolioDigest({domain,value});
const SELECTION=['kind','recordId','format','digest','decisionDigest'];
const COMMON=['format','purpose','id','chainId','owner','workspace','selection','buildReference','payer','createdAt','expiresAt','contract','transaction','costs','authority'];
const CREATE_KEYS=[...COMMON,'intentDigest'],COMMIT_KEYS=[...COMMON,'checkpoint','openingHandle','deploymentIntent','deploymentReference','intentDigest'];
function selection(v){K.exact(v,SELECTION);K.uuid(v.recordId);K.sha(v.digest);K.sha(v.decisionDigest);if(v.kind!=='portfolio'||!['angbao-local-portfolio-work@1','angbao-local-portfolio-work@2'].includes(v.format))fail('selection_changed');return structuredClone(v);}
const selected=record=>({kind:'portfolio',recordId:record.id,format:record.format,digest:record.digest,decisionDigest:record.decision.decisionDigest});
export function validateCheckpointCaps(value){return guard(()=>{K.bounded(value,1024);K.exact(value,['gasLimit','maxFeePerGas','maxPriorityFeePerGas']);const gas=K.integer(value.gasLimit,500000n),fee=K.integer(value.maxFeePerGas,1000000000n),priority=K.integer(value.maxPriorityFeePerGas,fee,true);if(gas<21000n)fail('cost_bounds');return copy({gasLimit:gas.toString(),maxFeePerGas:fee.toString(),maxPriorityFeePerGas:priority.toString()});});}
function contextBody(value){
 K.uuid(value.id);K.address(value.owner);K.iso(value.createdAt);K.iso(value.expiresAt);if(![CREATE,COMMIT].includes(value.operationPurpose)||Date.parse(value.expiresAt)<=Date.parse(value.createdAt)||Date.parse(value.expiresAt)-Date.parse(value.createdAt)>900000)fail('scope_changed');
 return {format:'angbao-checkpoint-owner-context-request@1',purpose:CHECKPOINT_OWNER_CONTEXT_PURPOSE,operationPurpose:value.operationPurpose,id:value.id,chainId:46630,owner:value.owner,workspace:validateOpeningWorkspace(value.workspace),selection:selection(value.selection),caps:validateCheckpointCaps(value.caps),createdAt:value.createdAt,expiresAt:value.expiresAt,buildReference:validateOpeningBuildReference(value.buildReference),authority:decisionOpeningAuthority()};
}
const stampContext=body=>copy({...body,requestDigest:stamp('angbao.checkpoint-owner-context-request.v1',body)});
export function validateCheckpointOwnerContextRequest(value){return guard(()=>{K.bounded(value,8192);K.exact(value,['format','purpose','operationPurpose','id','chainId','owner','workspace','selection','caps','createdAt','expiresAt','buildReference','authority','requestDigest']);const expected=stampContext(contextBody(value));if(!same(value,expected))fail('scope_changed');return expected;});}
export function assertCheckpointOwnerContextCurrent(value,now=new Date()){return guard(()=>{const request=validateCheckpointOwnerContextRequest(value),ms=Date.prototype.getTime.call(now);if(!Number.isFinite(ms)||ms<Date.parse(request.createdAt)||ms>=Date.parse(request.expiresAt))fail('expired');return ms;});}
export function createCheckpointOwnerContextRequest(input,options={now:new Date()}){return guard(()=>{K.bounded(input,131072);K.exact(input,['id','operationPurpose','workspace','record','expectedRecord','owner','caps','createdAt','expiresAt','buildReference']);K.exact(options,['now']);const record=validateOpeningSelection(input.record,input.expectedRecord);if(input.createdAt<record.createdAt)fail('scope_changed');const request=stampContext(contextBody({...input,selection:selected(record)}));assertCheckpointOwnerContextCurrent(request,options.now);return request;});}
function payer(v){
 K.exact(v,['nonce','gasLimit','maxFeePerGas','maxPriorityFeePerGas']);const nonce=K.integer(v.nonce,(1n<<64n)-2n,true),gas=K.integer(v.gasLimit,500000n),fee=K.integer(v.maxFeePerGas,1000000000n),priority=K.integer(v.maxPriorityFeePerGas,fee,true);
 return {nonce:nonce.toString(),gasLimit:gas.toString(),maxFeePerGas:fee.toString(),maxPriorityFeePerGas:priority.toString()};
}
function common(v,purpose){
 K.uuid(v.id);K.address(v.owner);K.iso(v.createdAt);K.iso(v.expiresAt);const start=Date.parse(v.createdAt),end=Date.parse(v.expiresAt);
 if(end<=start||end-start>900000)fail('expired');
 return {format:purpose===CREATE?'angbao-commitment-deployment-intent@1':'angbao-decision-checkpoint-commit-intent@1',purpose,id:v.id,chainId:46630,owner:v.owner,workspace:validateOpeningWorkspace(v.workspace),selection:selection(v.selection),buildReference:validateOpeningBuildReference(v.buildReference),payer:payer(v.payer),createdAt:v.createdAt,expiresAt:v.expiresAt};
}
const quantity=n=>'0x'+BigInt(n).toString(16);
function envelope(base,contract,data){
 const creation=base.purpose===CREATE,tx={from:base.owner,...(creation?{}:{to:contract}),chainId:'0xb626',type:'0x2',nonce:quantity(base.payer.nonce),value:'0x0',gas:quantity(base.payer.gasLimit),maxFeePerGas:quantity(base.payer.maxFeePerGas),maxPriorityFeePerGas:quantity(base.payer.maxPriorityFeePerGas),data};
 const bytes=Buffer.from(data.slice(2),'hex'),intrinsic=21000n+(creation?32000n+2n*BigInt(Math.ceil(bytes.length/32)):0n)+bytes.reduce((n,b)=>n+(b===0?4n:16n),0n);
 if(BigInt(base.payer.gasLimit)<intrinsic)fail('cost_bounds');
 return {contract,transaction:tx,costs:{minimumIntrinsicGas:intrinsic.toString(),maximumGasFeeWei:(BigInt(base.payer.gasLimit)*BigInt(base.payer.maxFeePerGas)).toString(),nativeValueWei:'0'},authority:decisionOpeningAuthority()};
}
function creationBody(v){const base=common(v,CREATE),contract=getContractAddress({from:base.owner,nonce:BigInt(base.payer.nonce)}).toLowerCase();K.address(contract);if(contract===base.owner)fail('scope_changed');return {...base,...envelope(base,contract,build.creationBytecode.hex)};}
const stamped=body=>copy({...body,intentDigest:stamp('angbao.checkpoint-execution-intent.v1',body)});
export function assertCheckpointExecutionCurrent(value,now=new Date()){return guard(()=>{const intent=validateCheckpointExecutionIntent(value),ms=Date.prototype.getTime.call(now);if(!Number.isFinite(ms)||Date.parse(intent.createdAt)>ms||Date.parse(intent.expiresAt)<=ms)fail('expired');return ms;});}
export function createCheckpointDeploymentIntent(input,options={now:new Date()}){return guard(()=>{
 K.bounded(input,131072);K.exact(input,['id','workspace','record','expectedRecord','owner','payer','createdAt','expiresAt','buildReference']);K.exact(options,['now']);
 const record=validateOpeningSelection(input.record,input.expectedRecord);if(input.createdAt<record.createdAt)fail('scope_changed');
 const intent=stamped(creationBody({...input,selection:selected(record)}));assertCheckpointExecutionCurrent(intent,options.now);return intent;
});}
export function validateCheckpointDeploymentReference(value,intentValue){return guard(()=>{
 const intent=validateCheckpointExecutionIntent(intentValue);if(intent.purpose!==CREATE)fail('wrong_purpose');K.bounded(value,2048);K.exact(value,['format','creationIntentDigest','transactionHash','blockHash','contract','buildReference']);hash(value.transactionHash);hash(value.blockHash);
 if(value.format!=='angbao-checkpoint-deployment-reference@1'||value.creationIntentDigest!==intent.intentDigest||value.contract!==intent.contract||!same(value.buildReference,intent.buildReference))fail('scope_changed');return copy(value);
});}
function commitBody(v){
 const creation=validateCheckpointExecutionIntent(v.deploymentIntent);if(creation.purpose!==CREATE)fail('wrong_purpose');const checkpoint=validateDecisionCheckpoint(v.checkpoint),handle=validateDecisionOpeningHandle(v.openingHandle),base=common(v,COMMIT);
 const ref=validateCheckpointDeploymentReference(v.deploymentReference,creation),s=checkpoint.selection;
 if(!same(base.selection,selection(Object.fromEntries(SELECTION.map(k=>[k,s[k]]))))||!same(base.selection,creation.selection)||!same(base.workspace,creation.workspace)||base.owner!==creation.owner||base.owner!==checkpoint.anchor.owner||checkpoint.anchor.contract!==creation.contract||handle.checkpointDigest!==checkpoint.checkpointDigest||handle.requestDigest!==decisionOpeningRequestDigest({requestId:handle.requestId,expectedRecord:Object.fromEntries(['kind','recordId','format','digest'].map(k=>[k,s[k]])),chainId:46630,owner:base.owner,contract:creation.contract},base.workspace)||base.createdAt<checkpoint.createdAt||base.createdAt<creation.createdAt||BigInt(base.payer.nonce)<=BigInt(creation.payer.nonce))fail('scope_changed');
 return {...base,...envelope(base,creation.contract,checkpoint.anchor.call.data),checkpoint,openingHandle:handle,deploymentIntent:creation,deploymentReference:ref};
}
export function createCheckpointCommitIntent(input,options={now:new Date()}){return guard(()=>{
 K.bounded(input,196608);K.exact(input,['id','openingEntry','openingHandle','deploymentIntent','deploymentReference','payer','createdAt','expiresAt']);K.exact(options,['now']);
 const entry=validateDecisionOpeningEntry(input.openingEntry),handle=validateDecisionOpeningHandle(input.openingHandle);if(!same(decisionOpeningHandle(handle.vaultId,entry),handle))fail('scope_changed');
 const intent=stamped(commitBody({...input,owner:entry.request.owner,workspace:entry.workspace,selection:selected(entry.record),buildReference:entry.buildReference,checkpoint:entry.checkpoint}));assertCheckpointExecutionCurrent(intent,options.now);return intent;
});}
/** Historical consistency only. This cannot prove a private opening is currently durably retained. */
export function validateCheckpointExecutionIntent(value){return guard(()=>{
 K.bounded(value,32768);if(![CREATE,COMMIT].includes(value?.purpose))fail('wrong_purpose');K.exact(value,value.purpose===CREATE?CREATE_KEYS:COMMIT_KEYS);
 const expected=stamped(value.purpose===CREATE?creationBody(value):commitBody(value));if(!same(value,expected))fail('scope_changed');return expected;
});}
export function validateCheckpointExecutionSubmission(intentValue,value){return guard(()=>{
 const intent=validateCheckpointExecutionIntent(intentValue);K.bounded(value,8192);K.exact(value,['format','intentDigest','transactionHash','transaction']);hash(value.transactionHash);
 if(value.format!=='angbao-checkpoint-execution-submission@1'||value.intentDigest!==intent.intentDigest||!same(value.transaction,intent.transaction))fail('submission_changed');return copy(value);
});}
export function validateCheckpointObservationOptions(value){return guard(()=>{
 K.bounded(value,1024);K.exact(value,['minimumConfirmations','previousBlockHash']);if(!Number.isSafeInteger(value.minimumConfirmations)||value.minimumConfirmations<1||value.minimumConfirmations>1024)fail('invalid_evidence');if(value.previousBlockHash!==null)hash(value.previousBlockHash);return copy(value);
});}
export function verifyCheckpointExecutionEvidence(intentValue,submissionValue,evidence,optionValue){return guard(()=>{
 const intent=validateCheckpointExecutionIntent(intentValue),submission=validateCheckpointExecutionSubmission(intent,submissionValue),options=validateCheckpointObservationOptions(optionValue);
 K.bounded(evidence,262144);K.exact(evidence,['format','chainId','observedAt','transaction','receipt','canonicalBlock','latestBlockNumber','contractCodeAtReceipt']);K.iso(evidence.observedAt);
 if(evidence.format!=='angbao-checkpoint-execution-evidence@1'||evidence.chainId!==46630)fail('wrong_chain');
 if(Date.parse(evidence.observedAt)<Date.parse(intent.createdAt)||evidence.canonicalBlock!==null&&q(evidence.canonicalBlock.timestamp)*1000n<BigInt(Date.parse(intent.createdAt)-30000))fail('invalid_evidence');
 if(intent.purpose===COMMIT){
  if(evidence.receipt!==null&&!['0x0','0x1'].includes(evidence.receipt.status))fail('invalid_evidence');
  // Reject impossible receipt gas before the legacy verifier can accept fees, events or runtime.
  const belowIntrinsic=evidence.receipt!==null&&q(evidence.receipt.gasUsed)<BigInt(intent.costs.minimumIntrinsicGas);
  // Reuse its non-correlated envelope summary while withholding the rejected receipt.
  const result=verifyDecisionCheckpointObservation(intent.checkpoint.anchor,{format:'angbao-decision-checkpoint-submission@1',purpose:'owner-attested-decision-checkpoint',anchorDigest:intent.checkpoint.anchor.anchorDigest,transactionHash:submission.transactionHash,transaction:submission.transaction},{...evidence,format:'angbao-decision-checkpoint-chain-evidence@1',...(belowIntrinsic?{receipt:null}:{})},{...options,runtimeReference:{chainId:46630,contract:intent.contract,sourceSha256:build.contract.sourceSha256,runtimeSha256:build.runtimeBytecode.sha256}});
  return belowIntrinsic?copy({...result,status:'uncertain',reason:'gas-cost-mismatch-or-cap-exceeded'}):result;
 }
 const result={format:'angbao-checkpoint-deployment-correlation@1',intentDigest:intent.intentDigest,transactionHash:submission.transactionHash,observedAt:evidence.observedAt,status:'uncertain',reason:'transaction-not-observed',contract:intent.contract,blockHash:null,blockNumber:null,confirmations:0,fee:null,feePolicy:ROBINHOOD_TESTNET_FEE_POLICY,exactEnvelopeMatched:false,runtimeMatchesSuppliedReference:false,verificationSource:'supplied-evidence-only',providerProvenanceEstablished:false,currentConfirmationEstablished:false,onchainAttestationEstablished:false,finality:'not-established',...decisionOpeningAuthority()};
 const finish=reason=>copy({...result,reason}),tx=evidence.transaction;if(tx===null)return finish('transaction-not-observed');
 hash(tx.hash);const actual=Object.fromEntries(Object.keys(intent.transaction).map(k=>[k,k==='data'?tx.input:tx[k]]));
 if(tx.hash!==submission.transactionHash||tx.to!==null||!same(actual,intent.transaction)||Object.hasOwn(tx,'authorizationList')||Object.hasOwn(tx,'accessList')&&(!Array.isArray(tx.accessList)||tx.accessList.length))return finish('transaction-envelope-mismatch');result.exactEnvelopeMatched=true;
 const receipt=evidence.receipt;if(receipt===null)return finish('receipt-not-observed');
 if(!['0x0','0x1'].includes(receipt.status))fail('invalid_evidence');if(receipt.from!==intent.owner||receipt.to!==null||receipt.contractAddress!==(receipt.status==='0x1'?intent.contract:null))return finish('receipt-scope-mismatch');
 for(const row of [tx,receipt]){hash(row.blockHash);q(row.blockNumber);q(row.transactionIndex);}hash(receipt.transactionHash);q(receipt.gasUsed);q(receipt.effectiveGasPrice);
 if(receipt.transactionHash!==submission.transactionHash||tx.blockHash!==receipt.blockHash||tx.blockNumber!==receipt.blockNumber||tx.transactionIndex!==receipt.transactionIndex)return finish('receipt-transaction-mismatch');
 const block=evidence.canonicalBlock;if(block===null||evidence.latestBlockNumber===null)return finish('canonicality-not-established');K.exact(block,['number','hash','parentHash','timestamp','baseFeePerGas','transactions']);hash(block.hash);hash(block.parentHash);for(const key of ['number','timestamp','baseFeePerGas'])q(block[key]);if(!Array.isArray(block.transactions)||block.transactions.length>1024)fail('invalid_evidence');block.transactions.forEach(hash);
 const head=q(evidence.latestBlockNumber),number=q(block.number),index=q(receipt.transactionIndex);
 if(block.hash!==receipt.blockHash||block.number!==receipt.blockNumber||index>=BigInt(block.transactions.length)||block.transactions[Number(index)]!==submission.transactionHash||head<number||options.previousBlockHash!==null&&options.previousBlockHash!==block.hash)return finish('reorg-uncertain');
 const confirmations=head-number+1n;if(confirmations>BigInt(Number.MAX_SAFE_INTEGER))fail('invalid_evidence');result.blockHash=block.hash;result.blockNumber=number.toString();result.confirmations=Number(confirmations);
 if(BigInt(Date.parse(evidence.observedAt))<q(block.timestamp)*1000n)return finish('observation-time-mismatch');
 const base=q(block.baseFeePerGas),cap=BigInt(intent.payer.maxFeePerGas),tip=BigInt(intent.payer.maxPriorityFeePerGas),full=base+tip<cap?base+tip:cap,price=q(receipt.effectiveGasPrice),used=q(receipt.gasUsed);
 if(base>cap||used<BigInt(intent.costs.minimumIntrinsicGas)||used>BigInt(intent.payer.gasLimit)||price!==base&&price!==full)return finish('gas-cost-mismatch-or-cap-exceeded');
 result.fee={payer:intent.owner,gasUsed:used.toString(),effectiveGasPriceWei:price.toString(),gasCostWei:(used*price).toString(),maximumGasCostWei:intent.costs.maximumGasFeeWei,nativeValueWei:'0',gasCoverage:'owner-funded-testnet',providerBilling:'unverified'};
 if(receipt.status==='0x0'){result.status='reverted-in-supplied-evidence';return finish('transaction-reverted');}
 const code=evidence.contractCodeAtReceipt;if(code===null)return finish('runtime-not-observed');K.exact(code,['chainId','address','blockHash','code']);K.hex(code.code);
 if(code.chainId!==46630||code.address!==intent.contract||code.blockHash!==block.hash||code.code!==build.runtimeBytecode.hex)return finish('runtime-reference-mismatch');result.runtimeMatchesSuppliedReference=true;
 if(!Array.isArray(receipt.logs)||receipt.logs.length!==0)return finish('unexpected-creation-events');if(result.confirmations<options.minimumConfirmations)return finish('confirmation-threshold-not-met');result.status='offline-correlated';return finish('exact-creation-correlated-in-supplied-evidence');
});}
export const checkpointExecutionInternals=Object.freeze({K,fail,guard,same,sha,hash,q,copy,build,authority:decisionOpeningAuthority,buildReference:DECISION_OPENING_BUILD_REFERENCE});
