/** Trusted startup object. Contains secret-bearing internal methods: never expose as a tool/API. */
import {validateOpeningWorkspace,validateOpeningRequest,decisionOpeningRequestDigest,validateDecisionOpeningVault,createRecoveryDecisionOpeningVault,validateDecisionOpeningEntry,appendDecisionOpeningEntry,decisionOpeningHandle,validateDecisionOpeningHandle,validateDecisionOpeningBackup,decisionOpeningAuthority,openingSame,openingFail,openingGuard,openingSynchronous,DecisionOpeningError} from '../domain/decision-opening-record.mjs';
import {kernelInitializationInternals as K} from '../domain/kernel-initialization.mjs';

if(typeof window!=='undefined')throw Error('Decision opening custody is server-only.');
export function createLocalDecisionOpeningStore({readPrivateState,transactPrivateState,readWorkspaceBinding,expectedVaultId}={}){
 if([readPrivateState,transactPrivateState,readWorkspaceBinding].some(fn=>typeof fn!=='function'))openingFail('custody_configuration');
 openingGuard(()=>K.uuid(expectedVaultId));
 const identity=()=>openingGuard(()=>validateOpeningWorkspace(openingSynchronous(readWorkspaceBinding())));
 const state=(raw,workspace)=>{
  const vault=validateDecisionOpeningVault(raw);
  if(vault.vaultId!==expectedVaultId||!openingSame(vault.workspace,workspace))openingFail('workspace_or_vault_changed');return vault;
 };
 function durable(work,{restoreMissing=false}={}){return openingGuard(()=>{
  const workspace=identity();let committed;
  try {
   committed=openingSynchronous(transactPrivateState(raw=>{
    // Invalid/corrupt custody or a changed workspace remains an uncertain hold.
    let vault;
    if(raw===null&&restoreMissing){
     // The primitive uses null for missing state AND for a JSON null file. Never reset the latter.
     let readable=false;try{openingSynchronous(readPrivateState());readable=true;}catch(error){if(error instanceof DecisionOpeningError)throw error;}
     if(readable)openingFail('invalid_vault');
     vault=createRecoveryDecisionOpeningVault({vaultId:expectedVaultId,workspace});
    }else vault=state(raw,workspace);
    if(!openingSame(identity(),workspace))openingFail('workspace_changed');
    try {
     const {value,entry}=work(vault,workspace);state(value,workspace);validateDecisionOpeningEntry(entry);
     return {value,result:{ok:true,entry}};
    } catch(error){
     // Known semantic failure must not poison the primitive's crash lock.
     return {value:raw===null?vault:raw,result:{ok:false,code:error instanceof DecisionOpeningError?error.code:'custody_request_rejected'}};
    }
   }));
  } catch(error){openingFail(error?.code==='private_commit_uncertain'?'custody_commit_uncertain':'custody_storage_unavailable');}
  K.bounded(committed,196608);
  if(committed?.ok!==true)openingFail(['request_conflict','not_found','recovery_inventory_incomplete'].includes(committed?.code)?committed.code:'custody_request_rejected');
  const expected=validateDecisionOpeningEntry(committed.entry);
  // Do not release even a local handle until the original opening is durably read back.
  const saved=state(openingSynchronous(readPrivateState()),workspace),entry=saved.entries.find(e=>e.request.requestId===expected.request.requestId);
  if(!entry||!openingSame(entry,expected))openingFail('custody_readback_changed');
  if(!openingSame(identity(),workspace))openingFail('workspace_changed');
  return validateDecisionOpeningEntry(entry);
 });}
 const checkedHandle=value=>{const handle=validateDecisionOpeningHandle(value);if(handle.vaultId!==expectedVaultId)openingFail('workspace_or_vault_changed');return handle;};
 const find=(vault,handle)=>{
  const entry=vault.entries.find(e=>e.request.requestId===handle.requestId);if(!entry)openingFail('not_found');
  if(!openingSame(decisionOpeningHandle(expectedVaultId,entry),handle))openingFail('request_conflict');return entry;
 };
 return Object.freeze({
  /** The callback runs synchronously only after exact-repeat lookup inside the private lock. */
  retain(requestValue,createEntry){
   const request=validateOpeningRequest(requestValue);if(typeof createEntry!=='function')openingFail('custody_configuration');
   const entry=durable((vault,workspace)=>{
    const existing=vault.entries.find(e=>e.request.requestId===request.requestId),digest=decisionOpeningRequestDigest(request,workspace);
    if(existing){if(existing.requestDigest!==digest)openingFail('request_conflict');return {value:vault,entry:existing};}
    if(vault.recoveryOnly)openingFail('recovery_inventory_incomplete');
    const fresh=validateDecisionOpeningEntry(openingSynchronous(createEntry(workspace)));
    if(fresh.requestDigest!==digest||!openingSame(fresh.request,request)||!openingSame(fresh.workspace,workspace))openingFail('request_conflict');
    return {value:appendDecisionOpeningEntry(vault,fresh),entry:fresh};
   });
   return decisionOpeningHandle(expectedVaultId,entry);
  },
  /** Secret-bearing internal read; obtains the existing cooperative lock and verifies durable readback. */
  readEntry(value){const handle=checkedHandle(value);return durable(vault=>({value:vault,entry:find(vault,handle)}));},
  restorePrivateOpening(bundleValue,options){
   const bundle=validateDecisionOpeningBackup(bundleValue);
   openingGuard(()=>{K.bounded(options,1024);K.exact(options,['expectedVaultId','expectedRequestId']);});
   if(options.expectedVaultId!==expectedVaultId||options.expectedVaultId!==bundle.originVaultId||options.expectedRequestId!==bundle.entry.request.requestId)openingFail('recovery_binding_changed');
   if(!openingSame(identity(),bundle.workspace))openingFail('workspace_changed');
   const entry=durable(vault=>({value:appendDecisionOpeningEntry(vault,bundle.entry),entry:bundle.entry}),{restoreMissing:true});return decisionOpeningHandle(expectedVaultId,entry);
  },
  /** Readback is diagnostic only. It never clears a lock, returns a plan, or asserts a usable store. */
  readRecoveryStatus(value){
   const handle=checkedHandle(value);let status='not-found-or-unreadable';
   try {find(state(openingSynchronous(readPrivateState()),identity()),handle);status='matching-opening-retained';} catch{}
   return K.freeze({format:'angbao-decision-opening-recovery-status@1',status,clearForUse:false,authority:decisionOpeningAuthority()});
  },
 });
}
