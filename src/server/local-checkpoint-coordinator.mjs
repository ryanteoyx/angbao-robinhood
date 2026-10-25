/** Default-denied trusted local preparation. No wallet invocation, route, provision or second journal. */
import {randomUUID} from 'node:crypto';
import {isLocalOwnerTransactionJournal,OwnerTransactionJournalError} from './local-owner-transaction-journal.mjs';
import {createRobinhoodCheckpointReadAdapter,assertTrustedCheckpointOwnerContext,assertTrustedCheckpointPreflight,checkpointDeploymentReferenceFromObservation,retainCheckpointObservation} from '../integrations/robinhood-checkpoint-read.mjs';
import {CheckpointExecutionError,CHECKPOINT_CREATE_PURPOSE as CREATE,CHECKPOINT_COMMIT_PURPOSE as COMMIT,createCheckpointOwnerContextRequest,createCheckpointDeploymentIntent,createCheckpointCommitIntent,validateCheckpointObservationOptions,assertCheckpointExecutionCurrent,checkpointExecutionInternals as U} from '../domain/decision-checkpoint-execution.mjs';
import {validateOpeningWorkspace,validateOpeningSelection,validateOpeningBuildReference,validateDecisionOpeningEntry,decisionOpeningHandle,openingSynchronous} from '../domain/decision-opening-record.mjs';
import {createCheckpointOperation,validateCheckpointOperation,stampCheckpointOperation,checkpointOperationRequestDigest,checkpointWalletChallenge,checkpointOperationStatus,CheckpointOperationError,checkpointOperationFail as fail} from '../domain/decision-checkpoint-operation.mjs';
const {K,copy,same,authority}=U;
if(typeof window!=='undefined')throw Error('Checkpoint coordinator is server-only.');
export function createLocalCheckpointCoordinator({journal,canonicalDirectory,custodyService,readOpeningEntry,readSelectedRecord,readWorkspaceBinding,requestChain=null,resolveAcceptedBuild=async()=>null,authorizePreparation=async()=>false,authorizeObservation=async()=>false,authorizeReadPacket=async()=>false,authorizeWalletReturn=()=>false,now=()=>new Date(),checkpoint=async()=>{}}={}){
 if(!isLocalOwnerTransactionJournal(journal,canonicalDirectory)||['prepare','verifyOpening','readLocalCheckpoint'].some(k=>typeof custodyService?.[k]!=='function')||[readOpeningEntry,readSelectedRecord,readWorkspaceBinding,resolveAcceptedBuild,authorizePreparation,authorizeObservation,authorizeReadPacket,authorizeWalletReturn,now,checkpoint].some(f=>typeof f!=='function'))fail('configuration');
 let closed=false;const active=new Map(),deploymentResults=new Map();
 const time=()=>{const d=now(),ms=Date.prototype.getTime.call(d);if(!Number.isFinite(ms))fail('configuration');return new Date(ms);};
 const identity=()=>validateOpeningWorkspace(openingSynchronous(readWorkspaceBinding()));
 const available=()=>{if(closed)fail('closed');};
 async function bounded(fn){let timer;try{return await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new CheckpointOperationError('expired')),5000);})]);}finally{clearTimeout(timer);}}
 const safe=async fn=>{try{available();return await fn();}catch(error){if(error instanceof CheckpointOperationError)throw new CheckpointOperationError(Object.getOwnPropertyDescriptor(error,'code')?.value);if(error instanceof CheckpointExecutionError)throw new CheckpointExecutionError(Object.getOwnPropertyDescriptor(error,'code')?.value);if(error instanceof OwnerTransactionJournalError)fail(error.code==='journal_conflict'||error.code==='direct_nonce_reserved'?'conflict':'storage_uncertain');fail('invalid_operation');}};
 function args(value,keys){K.bounded(value,8192);K.exact(value,keys);return copy(value);}
 async function load(purpose,id){available();return validateCheckpointOperation(await journal.read({purpose,id}));}
 const subject=(action,row)=>copy({action,purpose:row.purpose,id:row.id,workspace:row.workspace,requestDigest:row.requestDigest,intentDigest:row.intent?.intentDigest??null,transactionHash:row.transactionHash});
 async function grant(action,row,observation=false){
  available();const before=identity();if(!same(before,row.workspace))fail('scope_changed');
  const allowed=await bounded(()=>(observation?authorizeObservation:authorizePreparation)(subject(action,row)));
  if(allowed!==true)fail('denied');available();if(!same(identity(),before))fail('scope_changed');return true;
 }
 async function source(row){const before=identity();validateOpeningBuildReference(await bounded(()=>resolveAcceptedBuild(copy({intentDigest:row.intent?.intentDigest??row.contextRequest.requestDigest,purpose:row.intent?.purpose??row.contextRequest.purpose,buildReference:U.buildReference}))));available();if(!same(before,identity())||!same(before,row.workspace))fail('scope_changed');}
 async function change(row,reducer){available();return validateCheckpointOperation(await journal.change({purpose:row.purpose,id:row.id,expectedDigest:row.digest},current=>stampCheckpointOperation({...reducer(current),updatedAt:time().toISOString()})));}
 function opening(row){
  if(!row.custody)fail('not_prepared');const entry=validateDecisionOpeningEntry(openingSynchronous(readOpeningEntry(row.custody.handle)));
  if(!same(decisionOpeningHandle(row.custody.handle.vaultId,entry),row.custody.handle)||!same(entry.checkpoint,row.custody.checkpoint)||!same(entry.workspace,identity())||entry.record.digest!==row.selection.digest)fail('scope_changed');
  const checked=openingSynchronous(custodyService.verifyOpening(row.custody.handle));if(checked.suppliedOpeningMatches!==true||checked.checkpointDigest!==entry.checkpoint.checkpointDigest)fail('scope_changed');return entry;
 }
 function packetScope(row,slot,plan,reserved){
  available();if(active.get(plan.operationKey)!==slot||!same(identity(),row.workspace)||plan.scope!==slot.kind||plan.intentDigest!==slot.subjectDigest)fail('scope_changed');
  const entry=row.readScopes.find(s=>s.operationKey===plan.operationKey);
  if(!entry||entry.kind!==slot.kind||entry.subjectDigest!==slot.subjectDigest||entry.resultDigest!==null||entry.packets.length!==plan.packetIndex+(reserved?1:0)||reserved&&!same(entry.packets.at(-1),plan))fail('read_attempt_uncertain');
  const ms=time().getTime();if(slot.kind==='discovery'&&ms>=Date.parse(row.contextRequest.expiresAt))fail('expired');
  if(slot.kind==='preflight'){assertCheckpointExecutionCurrent(row.intent,new Date(ms));if(slot.phase==='before-wallet'&&(!row.review||ms>=Date.parse(row.review.expiresAt)))fail('expired');}
 }
 function packetUsage(row){
  const scopes=row.readScopes.map(s=>({operationKey:s.operationKey,kind:s.kind,reservedPackets:s.packets.length,reservedRequests:s.packets.reduce((n,p)=>n+p.requests.length,0),complete:s.resultDigest!==null}));
  return copy({reservedScopes:scopes.length,reservedPackets:scopes.reduce((n,s)=>n+s.reservedPackets,0),reservedRequests:scopes.reduce((n,s)=>n+s.reservedRequests,0),scopes});
 }
 async function packetPolicy(row,slot,plan,reserved){
  packetScope(row,slot,plan,reserved);const ms=time().getTime();
  const allowed=await bounded(()=>authorizeReadPacket(Object.freeze({plan,subject:subject('reserve-read-packet',row),phase:slot.phase,usage:packetUsage(row)})));
  if(allowed!==true)fail('denied');packetScope(row,slot,plan,reserved);if(time().getTime()<ms)fail('expired');
 }
 const reader=createRobinhoodCheckpointReadAdapter({requestChain:requestChain===null?null:(request,context)=>{available();return requestChain(request,context);},resolveAcceptedBuild:async value=>{available();const ref=await resolveAcceptedBuild(value);available();return ref;},now,authorizePlan:async plan=>{
  const slot=active.get(plan.operationKey);if(!slot)return false;let row=await load(slot.purpose,slot.id);packetScope(row,slot,plan,false);await grant('reserve-read-packet',row,slot.kind==='observation');await packetPolicy(row,slot,plan,false);
  row=await change(row,current=>{const next=structuredClone(current),scope=next.readScopes.find(s=>s.operationKey===plan.operationKey);packetScope(current,slot,plan,false);scope.packets.push(structuredClone(plan));return next;});
  await grant('reserve-read-packet',row,slot.kind==='observation');await packetPolicy(row,slot,plan,true);
  const current=await load(slot.purpose,slot.id);if(current.digest!==row.digest)fail('conflict');packetScope(current,slot,plan,true);return true;
 }});
 async function scope(row,kind,operationKey,work,complete,phase=kind){
  K.uuid(operationKey);if(active.has(operationKey)||row.readScopes.some(s=>s.operationKey===operationKey))fail('read_attempt_uncertain');
  const subjectDigest=kind==='discovery'?row.contextRequest.requestDigest:row.intent?.intentDigest;if(!subjectDigest)fail('not_prepared');
  active.set(operationKey,{purpose:row.purpose,id:row.id,kind,subjectDigest,phase});
  try{row=await change(row,current=>({...current,readScopes:[...current.readScopes,{operationKey,kind,subjectDigest,packets:[],resultDigest:null,audit:null}]}));const result=await work();row=await load(row.purpose,row.id);row=await change(row,current=>{const next=structuredClone(current),slot=next.readScopes.find(s=>s.operationKey===operationKey);if(!slot||slot.resultDigest!==null)fail('read_attempt_uncertain');slot.resultDigest=K.digest(result);slot.audit=structuredClone(result.requestAudit);return complete(next,result);});return {row,result};}finally{active.delete(operationKey);}
 }
 function dependency(row){if(row.purpose===CREATE)return null;const result=deploymentResults.get(row.parentCreationId);if(!result)fail('dependency_recheck_required');return result;}
 async function selectedInput(input,purpose){
  const value=args(input,['id','expectedRecord','owner','caps','parentCreationId','discoveryKey']);K.uuid(value.discoveryKey);const request={id:value.id,purpose,expectedRecord:value.expectedRecord,owner:value.owner,caps:value.caps,parentCreationId:value.parentCreationId},workspace=identity(),digest=checkpointOperationRequestDigest(request,workspace);
  await grant('select-operation',{id:value.id,purpose,workspace,requestDigest:digest,intent:null,transactionHash:null});
  let row;try{row=await load(purpose,value.id);}catch(error){if(error?.code!=='journal_not_found')throw error;}
  if(row){if(row.requestDigest!==digest||row.discoveryKey!==value.discoveryKey)fail('conflict');await grant('prepare',row);return row;}
  let record;
  if(purpose===COMMIT){const parent=await load(CREATE,value.parentCreationId);await grant('prepare-commit',parent);if(parent.owner!==value.owner||!same(parent.workspace,workspace)||!same(value.expectedRecord,Object.fromEntries(['kind','recordId','format','digest'].map(k=>[k,parent.selection[k]]))))fail('scope_changed');dependency({purpose:COMMIT,parentCreationId:parent.id});record=opening(parent).record;}
  else record=validateOpeningSelection(openingSynchronous(readSelectedRecord(value.expectedRecord)),value.expectedRecord);
  const createdAt=time().toISOString(),contextRequest=createCheckpointOwnerContextRequest({id:value.id,operationPurpose:purpose,workspace,record,expectedRecord:value.expectedRecord,owner:value.owner,caps:value.caps,createdAt,expiresAt:new Date(Date.parse(createdAt)+900000).toISOString(),buildReference:U.buildReference},{now:time()});
  const candidate=createCheckpointOperation({request,contextRequest,discoveryKey:value.discoveryKey});await grant('prepare',candidate);
  try{row=validateCheckpointOperation(await journal.create({purpose,record:candidate}));}catch(error){if(error?.code!=='journal_conflict')throw error;row=await load(purpose,value.id);if(row.requestDigest!==digest||row.discoveryKey!==value.discoveryKey)fail('conflict');}
  await checkpoint('selected');return row;
 }
 async function prepare(input,purpose){
  let row=await selectedInput(input,purpose);if(row.intent){opening(row);await grant('prepare-return',row);return row;}
  if(!row.discovery){await grant('discover-owner',row);const outcome=await scope(row,'discovery',row.discoveryKey,async()=>{const result=await reader.discoverOwnerContext(row.contextRequest,{operationKey:row.discoveryKey});return assertTrustedCheckpointOwnerContext(reader,row.contextRequest,result,{now:time()});},(next,result)=>({...next,discovery:result}));row=outcome.row;await checkpoint('discovery-durable');}
  await grant('retain-opening',row);await source(row);const nonce=BigInt(row.discovery.ownerNonce).toString(),context=row.contextRequest;let intent,custody;
  if(purpose===CREATE){
   const record=validateOpeningSelection(openingSynchronous(readSelectedRecord(Object.fromEntries(['kind','recordId','format','digest'].map(k=>[k,row.selection[k]])))),Object.fromEntries(['kind','recordId','format','digest'].map(k=>[k,row.selection[k]])));
   intent=createCheckpointDeploymentIntent({id:row.id,workspace:row.workspace,record,expectedRecord:Object.fromEntries(['kind','recordId','format','digest'].map(k=>[k,row.selection[k]])),owner:row.owner,payer:{nonce,...row.caps},createdAt:context.createdAt,expiresAt:context.expiresAt,buildReference:U.buildReference},{now:time()});
   const handle=openingSynchronous(custodyService.prepare({requestId:row.id,expectedRecord:Object.fromEntries(['kind','recordId','format','digest'].map(k=>[k,row.selection[k]])),chainId:46630,owner:row.owner,contract:intent.contract}));custody={handle,checkpoint:openingSynchronous(custodyService.readLocalCheckpoint(handle))};
  }else{const parent=await load(CREATE,row.parentCreationId),entry=opening(parent),dep=dependency(row),reference=checkpointDeploymentReferenceFromObservation(reader,parent.intent,dep);custody=parent.custody;intent=createCheckpointCommitIntent({id:row.id,openingEntry:entry,openingHandle:custody.handle,deploymentIntent:parent.intent,deploymentReference:reference,payer:{nonce,...row.caps},createdAt:context.createdAt,expiresAt:context.expiresAt},{now:time()});}
  await checkpoint('custody-retained');await grant('persist-intent',row);await source(row);row=await load(purpose,row.id);if(row.intent){opening(row);await grant('prepare-return',row);return row;}row=await change(row,current=>({...current,intent,custody}));opening(row);await checkpoint('intent-durable');await grant('prepare-return',row);return row;
 }
 async function preflight(row,operationKey,phase,keepReview){
  if(!row.intent||row.nonceReserved)fail('not_prepared');opening(row);await grant('preflight',row);assertCheckpointExecutionCurrent(row.intent,time());const prior=dependency(row);
  return scope(row,'preflight',operationKey,async()=>{const result=await reader.preflight(row.intent,{operationKey,phase,deploymentObservation:prior});return assertTrustedCheckpointPreflight(reader,row.intent,result,{now:time()});},(next,result)=>({...next,review:keepReview?next.review:{intentDigest:row.intent.intentDigest,contextDigest:K.digest(result),observedAt:result.observedAt,expiresAt:result.expiresAt,transaction:row.intent.transaction,checkpoint:result.checkpoint}}),phase);
 }
 async function checkedPreflightReturn(row,result){opening(row);await grant('preflight-return',row);assertTrustedCheckpointPreflight(reader,row.intent,result,{now:time()});return row;}
 return Object.freeze({
  prepareDeployment:input=>safe(()=>prepare(input,CREATE)),prepareCommit:input=>safe(()=>prepare(input,COMMIT)),
  read:input=>safe(async()=>{const v=args(input,['purpose','id']),row=await load(v.purpose,v.id);await grant('read',row,true);return row;}),
  list:input=>safe(async()=>{const v=args(input,['purpose']);if(![CREATE,COMMIT].includes(v.purpose))fail('scope_changed');const workspace=identity();await grant('list',{id:null,purpose:v.purpose,workspace,requestDigest:null,intent:null,transactionHash:null},true);const rows=await journal.list(v);for(const row of rows)await grant('read',validateCheckpointOperation(row),true);await grant('list',{id:null,purpose:v.purpose,workspace,requestDigest:null,intent:null,transactionHash:null},true);return copy(rows);}),
  refreshPreflight:input=>safe(async()=>{const v=args(input,['purpose','id','expectedDigest','operationKey']),row=await load(v.purpose,v.id);if(row.digest!==v.expectedDigest)fail('conflict');const result=await preflight(row,v.operationKey,'review',false);return checkedPreflightReturn(result.row,result.result);}),
  beginWalletReview:input=>safe(async()=>{
   const v=args(input,['purpose','id','reviewDigest','operationKey']);let row=await load(v.purpose,v.id);if(row.nonceReserved)fail('already_reserved');if(!row.review||K.digest(row.review)!==v.reviewDigest)fail('conflict');await grant('wallet-review',row);
   const result=await preflight(row,v.operationKey,'before-wallet',true);row=await checkedPreflightReturn(result.row,result.result);if(time().getTime()>=Date.parse(row.review.expiresAt)||K.digest(row.review)!==v.reviewDigest)fail('expired');
   await checkpoint('before-nonce-reserve');await grant('reserve-wallet-review',row);await source(row);opening(row);assertTrustedCheckpointPreflight(reader,row.intent,result.result,{now:time()});row=await change(row,current=>{if(current.nonceReserved||K.digest(current.review)!==v.reviewDigest||time().getTime()>=Date.parse(current.review.expiresAt))fail('expired');return {...current,nonceReserved:true,challengeId:randomUUID()};});
   await checkpoint('nonce-durable');await grant('wallet-review-return',row);await source(row);await grant('wallet-review-return',row);opening(row);assertTrustedCheckpointPreflight(reader,row.intent,result.result,{now:time()});if(time().getTime()>=Date.parse(row.review.expiresAt))fail('expired');const challenge=checkpointWalletChallenge(row);if(openingSynchronous(authorizeWalletReturn(copy({subject:subject('wallet-review-return',row),buildReference:row.intent.buildReference})))!==true)fail('denied');available();return challenge;
  }),
  reportHash:input=>safe(async()=>{const v=args(input,['purpose','id','challengeId','transactionHash']);U.hash(v.transactionHash);let row=await load(v.purpose,v.id);await grant('report-hash',row,true);if(!row.nonceReserved||row.challengeId!==v.challengeId||row.transactionHash!==null&&row.transactionHash!==v.transactionHash)fail('conflict');if(row.transactionHash===v.transactionHash)return row;row=await change(row,current=>({...current,transactionHash:v.transactionHash}));await checkpoint('hash-durable');await grant('report-hash-return',row,true);return row;}),
  recordExactReference:input=>safe(async()=>{const v=args(input,['purpose','id','reviewDigest','transactionHash']);U.hash(v.transactionHash);let row=await load(v.purpose,v.id);await grant('record-reference',row,true);if(!row.nonceReserved||K.digest(row.review)!==v.reviewDigest||row.transactionHash!==null&&row.transactionHash!==v.transactionHash)fail('conflict');if(row.transactionHash===v.transactionHash)return row;row=await change(row,current=>({...current,transactionHash:v.transactionHash}));await grant('record-reference-return',row,true);return row;}),
  observe:input=>safe(async()=>{
   const v=args(input,['purpose','id','operationKey','minimumConfirmations','previousBlockHash']);K.uuid(v.operationKey);const options=validateCheckpointObservationOptions({minimumConfirmations:v.minimumConfirmations,previousBlockHash:v.previousBlockHash});let row=await load(v.purpose,v.id);await grant('observe',row,true);const old=row.observations.find(o=>o.operationKey===v.operationKey);if(old){if(!same(old.value.options,options))fail('conflict');return row;}if(!row.transactionHash||!row.nonceReserved)fail('not_prepared');if(row.purpose===CREATE)deploymentResults.delete(row.id);const prior=dependency(row),submission={format:'angbao-checkpoint-execution-submission@1',intentDigest:row.intent.intentDigest,transactionHash:row.transactionHash,transaction:row.intent.transaction};let live;
   const result=await scope(row,'observation',v.operationKey,async()=>{live=await reader.observe(row.intent,submission,{operationKey:v.operationKey,minimumConfirmations:v.minimumConfirmations,previousBlockHash:v.previousBlockHash,deploymentObservation:prior});return retainCheckpointObservation(reader,row.intent,live);},(next,value)=>({...next,observations:[...next.observations,{operationKey:v.operationKey,value}]}));row=result.row;await checkpoint('observation-durable');await grant('observe-return',row,true);if(row.purpose===CREATE&&live.correlation.status==='offline-correlated')deploymentResults.set(row.id,live);return row;
  }),
  publicReceipt:input=>safe(async()=>{const v=args(input,['deploymentId','commitId']),parent=await load(CREATE,v.deploymentId),child=await load(COMMIT,v.commitId);await grant('export-public',child,true);if(child.parentCreationId!==parent.id||child.intent?.contract!==parent.intent?.contract||!same(child.custody,parent.custody))fail('scope_changed');opening(child);const a=parent.observations.at(-1)?.value,b=child.observations.at(-1)?.value;if(a?.correlation.status!=='offline-correlated'||b?.correlation.status!=='offline-correlated')fail('not_prepared');if(child.intent.deploymentReference.transactionHash!==parent.transactionHash||child.intent.deploymentReference.blockHash!==a.correlation.blockHash)fail('scope_changed');return copy({format:'angbao-public-checkpoint-receipt@1',chainId:46630,contract:parent.intent.contract,buildReference:U.buildReference,anchor:child.custody.checkpoint.anchor,deployment:{transactionHash:parent.transactionHash,blockHash:a.correlation.blockHash,blockNumber:a.correlation.blockNumber,observedAt:a.evidence.observedAt,fee:a.correlation.fee},commit:{transactionHash:child.transactionHash,blockHash:b.correlation.blockHash,blockNumber:b.correlation.blockNumber,observedAt:b.evidence.observedAt,fee:b.correlation.fee},historical:true,currentConfirmationEstablished:false,inputTruthEstablished:false,...authority()});}),
  status:input=>safe(async()=>{const v=args(input,['purpose','id']),row=await load(v.purpose,v.id);await grant('read-status',row,true);let status=checkpointOperationStatus(row);const ms=time().getTime();if(!row.nonceReserved){if(ms>=Date.parse(row.contextRequest.expiresAt))status='preparation-expired';else if(row.review&&ms>=Date.parse(row.review.expiresAt))status='review-expired';}return copy({purpose:row.purpose,id:row.id,status,nonceReserved:row.nonceReserved,transactionHash:row.transactionHash,reviewExpiresAt:row.review?.expiresAt??null,intentExpiresAt:row.contextRequest.expiresAt,...authority()});}),
  close(){closed=true;active.clear();deploymentResults.clear();},
 });
}
