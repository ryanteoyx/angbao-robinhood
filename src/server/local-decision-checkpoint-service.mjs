/** Optional trusted local service, deliberately unwired. No execution/nonce/signing authority. */
import {randomBytes} from 'node:crypto';
import {kernelInitializationInternals as K} from '../domain/kernel-initialization.mjs';
import {verifyDecisionCheckpointOpening,publicDecisionCheckpointAnchor} from '../domain/decision-checkpoint.mjs';
import {DECISION_OPENING_BUILD_REFERENCE,validateOpeningBuildReference,validateOpeningWorkspace,validateOpeningRequest,validateOpeningSelection,createDecisionOpeningEntry,validateDecisionOpeningEntry,decisionOpeningHandle,validateDecisionOpeningHandle,createDecisionOpeningBackup,decisionOpeningAuthority,openingSame,openingFail,openingGuard,openingSynchronous} from '../domain/decision-opening-record.mjs';

if(typeof window!=='undefined')throw Error('Decision checkpoint custody is server-only.');
export function createLocalDecisionCheckpointService({openingStore,readSelectedRecord,readWorkspaceBinding,buildReference,now=()=>new Date()}={}){
 if(['retain','readEntry','restorePrivateOpening','readRecoveryStatus'].some(key=>typeof openingStore?.[key]!=='function')||typeof readSelectedRecord!=='function'||typeof readWorkspaceBinding!=='function'||typeof now!=='function')openingFail('custody_configuration');
 validateOpeningBuildReference(buildReference);
 const identity=()=>validateOpeningWorkspace(openingSynchronous(readWorkspaceBinding()));
 const read=value=>openingGuard(()=>{
  const handle=validateDecisionOpeningHandle(value),before=identity(),entry=validateDecisionOpeningEntry(openingSynchronous(openingStore.readEntry(handle)));
  if(!openingSame(decisionOpeningHandle(handle.vaultId,entry),handle))openingFail('request_conflict');
  if(!openingSame(before,entry.workspace)||!openingSame(identity(),before))openingFail('workspace_changed');return {entry,handle};
 });
 const randomWord=()=>{for(let i=0;i<4;i++){const value='0x'+randomBytes(32).toString('hex');if(value!=='0x'+'0'.repeat(64))return value;}openingFail('entropy_unavailable');};
 return Object.freeze({
  prepare(value){return openingGuard(()=>{
   const request=validateOpeningRequest(value),before=identity();
   const handle=openingSynchronous(openingStore.retain(request,workspace=>{
    if(!openingSame(before,workspace)||!openingSame(identity(),before))openingFail('workspace_changed');
    const record=validateOpeningSelection(openingSynchronous(readSelectedRecord(request.expectedRecord)),request.expectedRecord),createdAt=new Date(openingSynchronous(now())).toISOString();
    return createDecisionOpeningEntry({request,workspace,record,privateSalt:randomWord(),operationRef:randomWord(),createdAt});
   }));
   // This second locked read is intentional: lost acknowledgement never substitutes a fresh opening.
   const retained=read(handle);if(!openingSame(retained.entry.workspace,before)||!openingSame(identity(),before))openingFail('workspace_changed');return retained.handle;
  });},
  readLocalCheckpoint(handle){return read(handle).entry.checkpoint;},
  readPublicAnchor(handle){return publicDecisionCheckpointAnchor(read(handle).entry.checkpoint);},
  verifyOpening(handle){const {entry:e}=read(handle);return verifyDecisionCheckpointOpening(e.checkpoint,{record:e.record,expectedRecord:e.request.expectedRecord,privateSalt:e.privateSalt});},
  journalReference(handle){
   const {entry:e,handle:normalized}=read(handle);return K.freeze({format:'angbao-local-checkpoint-journal-reference@1',purpose:'custody-retained-only',openingHandle:normalized,workspace:e.workspace,buildReference:DECISION_OPENING_BUILD_REFERENCE,anchorDigest:e.checkpoint.anchor.anchorDigest,authority:decisionOpeningAuthority()});
  },
  exportPrivateOpening(handle,options){return openingGuard(()=>{
   K.bounded(options,1024);K.exact(options,['disclosure']);if(options.disclosure!=='include-private-opening')openingFail('explicit_disclosure_required');
   const {entry,handle:normalized}=read(handle);return createDecisionOpeningBackup(normalized.vaultId,entry);
  });},
  restorePrivateOpening(bundle,options){return openingGuard(()=>{const handle=openingSynchronous(openingStore.restorePrivateOpening(bundle,options));return read(handle).handle;});},
  readRecoveryStatus(handle){return openingGuard(()=>{
   const value=openingSynchronous(openingStore.readRecoveryStatus(validateDecisionOpeningHandle(handle)));K.bounded(value,2048);K.exact(value,['format','status','clearForUse','authority']);
   if(value.format!=='angbao-decision-opening-recovery-status@1'||!['matching-opening-retained','not-found-or-unreadable'].includes(value.status)||value.clearForUse!==false||!openingSame(value.authority,decisionOpeningAuthority()))openingFail('invalid_custody_record');return K.freeze(structuredClone(value));
  });},
 });
}
