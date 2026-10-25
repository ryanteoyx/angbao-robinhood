/** Explicit same-process local host composition. No HTTP/PAT authority or worker startup. */
import {validateFinancialMemoryScope,validateFinancialMemoryReference,adaptFinancialRecord} from '../domain/financial-memory-contract.mjs';
import {createFinancialMemoryResolver} from '../domain/financial-memory-resolver.mjs';
import {collectMemoryCandidates} from './financial-memory-binding.mjs';
import {copyPortfolioArchive,portfolioExact} from '../domain/portfolio-work-record.mjs';
import {localDigest} from '../domain/local-continuity.mjs';
import {jobDigest,rejectJob} from '../domain/managed-job-ledger.mjs';
import {createManagedJobResultCoordinator} from './managed-job-result-coordinator.mjs';
import {hasLocalSynchronousCommitGuard} from './local-history-store.mjs';
import {createManagedJobRunner} from './managed-job-runner.mjs';
const same=(a,b)=>localDigest(a)===localDigest(b);
const routes={portfolio:'/api/local/portfolio-work','research-completion':'/api/research/methods/complete'};
const MAX_AGE=300000;
const sync=value=>{if(value&&typeof value.then==='function')rejectJob('local_job_async_authority');return value;};
export function createLocalManagedJobBinding({jobs,trustedScope,readHydratedState,historyStore,enqueueNativeMutation,clock=Date.now,checkpoint=async()=>{},runner=null}){
 const scope=validateFinancialMemoryScope(trustedScope);
 if(!hasLocalSynchronousCommitGuard(historyStore)||!scope.workspaceId.startsWith('local:')||![jobs?.get,jobs?.command,jobs?.guardWindow,readHydratedState,historyStore?.isUncertain,enqueueNativeMutation,clock,checkpoint].every(fn=>typeof fn==='function'))rejectJob('local_job_configuration');
 const now=()=>{const at=clock();if(!Number.isSafeInteger(at)||at<0)rejectJob('clock');return at;};
 function read(){
  if(sync(historyStore.isUncertain()))rejectJob('archive_commit_uncertain');
  const snapshot=sync(readHydratedState());
  if(!snapshot?.localInstallation?.id||scope.workspaceId!==`local:${localDigest(snapshot.localInstallation.id)}`)rejectJob('local_job_workspace');
  return copyPortfolioArchive(snapshot,structuredClone(snapshot));
 }
 const installation=read().localInstallation.id;
 function row(){const state=read();if(state.localInstallation.id!==installation)rejectJob('local_job_workspace');return {scope:structuredClone(scope),identity:installation,etag:`"${state.localRevision}"`,state};}
 const resolver=createFinancialMemoryResolver({scope,lookup:async ref=>collectMemoryCandidates(read(),{kind:ref.kind,recordId:ref.recordId}).map(record=>adaptFinancialRecord(ref.kind,record,scope))});
 function scopedJob(id){const job=sync(jobs.get(id,scope));if(job.spec.ownerId!==scope.ownerId||job.spec.workspaceId!==scope.workspaceId)rejectJob('scope');return job;}
 function guard(proof){scopedJob(proof.jobId);return sync(jobs.command({type:'guard',proof}));}
 function nativePlan(job){
  if(!job.inbox||jobDigest(job.inbox.result)!==job.inbox.digest||Buffer.byteLength(JSON.stringify(job.inbox.result))>16384)rejectJob('local_job_inbox');
  portfolioExact(job.inbox.result,['nativeSave']);const plan=job.inbox.result.nativeSave;portfolioExact(plan,['kind','body','expectedETag','workspaceIdentity']);
  if(plan.kind==='research-completion'&&job.spec.refs.some(ref=>ref.kind==='research-method'&&ref.recordId===plan.body?.workId))rejectJob('local_job_self_replacing_reference');
  if(!Object.hasOwn(routes,plan.kind)||plan.workspaceIdentity!==installation||!/^"(?:0|[1-9]\d*)"$/.test(plan.expectedETag))rejectJob('local_job_plan');
  const route=routes[plan.kind],idempotencyKey=`job-save:${jobDigest([scope,job.id,job.runId,job.inbox.id,job.inbox.digest])}`;
  return {route,body:structuredClone(plan.body),expectedETag:plan.expectedETag,idempotencyKey};
 }
 function receiptContext(job){return {format:'angbao-local-job-native-commit@1',jobId:job.id,runId:job.runId,inboxId:job.inbox.id,inboxDigest:job.inbox.digest,scopeDigest:localDigest(scope)};}
 function managedRow(job){const result=row(),plan=nativePlan(job),receipt=result.state.localReplayReceipts.find(r=>r.key===plan.idempotencyKey);if(receipt&&!same(receipt.result?.managedJobCommit??null,receiptContext(job)))rejectJob('local_job_receipt_authority');return result;}
 async function commitInbox(args){
  portfolioExact(args,['proof']);portfolioExact(args.proof,['jobId','workerId','fence']);const proof=structuredClone(args.proof);
  const selected=scopedJob(proof.jobId),inbox=selected.inbox&&{id:selected.inbox.id,digest:selected.inbox.digest},windows=new Map();
  if(!inbox)rejectJob('local_job_inbox');
  const refs=selected.spec.refs.map(validateFinancialMemoryReference),specDigest=jobDigest(selected.spec);
  const resolveExact=async(ref,options)=>{const value=await resolver.resolveExact(ref,options);if(value.status==='resolved'&&value.freshness==='fresh')windows.set(jobDigest(ref),structuredClone(value));return value;};
  function beforeCommit(args){
   const sameInbox=job=>job.inbox?.id===inbox.id&&job.inbox.digest===inbox.digest&&jobDigest(job.spec)===specDigest&&same(nativePlan(job),args);
   if(!sameInbox(guard(proof)))rejectJob('local_job_inbox_changed');
   const state=read(),bounds=[];
   for(const ref of refs){
    const value=windows.get(jobDigest(ref)),w=value?.freshnessWindow,from=Date.parse(w?.validFrom),through=Date.parse(w?.validThrough);
    if(!w||w.maxAgeMs!==MAX_AGE||!Number.isSafeInteger(from)||!Number.isSafeInteger(through))rejectJob('local_job_freshness');
    const currentRecords=collectMemoryCandidates(state,{kind:ref.kind,recordId:ref.recordId}).map(record=>adaptFinancialRecord(ref.kind,record,scope)).filter(e=>same(e.reference,ref));
    if(currentRecords.length!==1||!same(currentRecords[0],value.envelope))rejectJob('local_job_reference_changed');
    bounds.push({from,through});
   }
   // Recheck authoritative Jobs state AFTER canonical validation. The returned
   // exclusive bound includes mandate/approval expiry, not merely lease/deadline.
   const authority=sync(jobs.guardWindow(proof));
   if(!sameInbox(authority.job))rejectJob('local_job_inbox_changed');
   const at=now();
   if(!Number.isSafeInteger(authority.evaluatedAt)||!Number.isSafeInteger(authority.validUntil)||at<authority.evaluatedAt||at>=authority.validUntil)rejectJob('local_job_expired');
   if(bounds.some(w=>at<w.from||at>w.through))rejectJob('local_job_freshness');
   // No await or further clock sample: this single final point intersects ALL
   // authority and input windows immediately before the native synchronous rename.
  }
  const nativeWorkspace={read:async()=>managedRow(selected),saveExact:async args=>{
   const expected=nativePlan(guard(proof));if(!same(args,expected))rejectJob('local_job_request_changed');
   const authorize=()=>beforeCommit(expected);authorize();
   return enqueueNativeMutation({...expected,beforeCommit:authorize,managedJobCommit:receiptContext(selected)});
  }};
  return createManagedJobResultCoordinator({jobs,trustedScope:scope,nativeWorkspace,resolveExact,clock,checkpoint}).commitInbox({proof});
 }
 function inspect({jobId}){return createManagedJobResultCoordinator({jobs,trustedScope:scope,nativeWorkspace:{read:async()=>managedRow(scopedJob(jobId)),saveExact:async()=>rejectJob('local_job_no_authority')},resolveExact:resolver.resolveExact,clock,checkpoint}).inspect({jobId});}
 async function acceptPending(pending){
  portfolioExact(pending,['status','proof','inboxId','inboxDigest']);if(pending.status!=='pending-inbox')rejectJob('local_job_pending');
  const job=guard(pending.proof);if(job.inbox?.id!==pending.inboxId||job.inbox.digest!==pending.inboxDigest)rejectJob('local_job_inbox_changed');
  return commitInbox({proof:pending.proof});
 }
 let nativeRunner=null;
 if(runner!==null){
  portfolioExact(runner,['reservations','executeTool','checkpoint'],['reservations','executeTool']);
  nativeRunner=createManagedJobRunner({store:jobs,resolveExact:resolver.resolveExact,referenceScope:ref=>{const r=validateFinancialMemoryReference(ref);return {ownerId:r.ownerId,workspaceId:r.workspaceId};},reservations:runner.reservations,executeTool:runner.executeTool,validateResult:()=>rejectJob('local_job_validator_side_effect'),clock,checkpoint:runner.checkpoint??checkpoint,completion:'pending-inbox'});
 }
 return Object.freeze({resolveExact:resolver.resolveExact,inspect,commitInbox,acceptPending,async run(jobId,workerId){if(!nativeRunner)rejectJob('local_job_runner_unavailable');const result=await nativeRunner.run(jobId,workerId);return result.status==='pending-inbox'?acceptPending(result):result;}});
}
