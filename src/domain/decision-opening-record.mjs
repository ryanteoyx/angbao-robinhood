/** Private recovery records only. Imported JSON, hashes and openings confer no authority. */
import build from '../../contracts/angbao-commitment.build.json' with {type:'json'};
import {types} from 'node:util';
import {kernelInitializationInternals as K} from './kernel-initialization.mjs';
import {portfolioCanonical,portfolioDigest,validatePortfolioWorkRecord} from './portfolio-work-record.mjs';
import {prepareDecisionCheckpoint,verifyDecisionCheckpointOpening} from './decision-checkpoint.mjs';

export const DECISION_OPENING_MAX_BYTES=1048576;
export const DECISION_OPENING_BUILD_REFERENCE=K.freeze({sourceSha256:build.contract.sourceSha256,buildDigest:build.buildDigest,runtimeSha256:build.runtimeBytecode.sha256});
export const decisionOpeningAuthority=()=>({ownerApprovalEstablished:false,signingAllowed:false,deploymentAllowed:false,submissionAllowed:false,financialAuthority:false});
const CODES=new Set(['invalid_custody_record','invalid_selection','build_reference_changed','invalid_request_scope','selection_changed','opening_changed','invalid_vault','vault_binding_changed','vault_changed','workspace_changed','request_conflict','custody_capacity','invalid_handle','backup_changed','custody_configuration','workspace_or_vault_changed','custody_commit_uncertain','custody_storage_unavailable','custody_request_rejected','not_found','custody_readback_changed','recovery_binding_changed','recovery_inventory_incomplete','entropy_unavailable','explicit_disclosure_required']);
export class DecisionOpeningError extends Error {
 constructor(code='invalid_custody_record'){code=CODES.has(code)?code:'invalid_custody_record';super(`Decision opening stopped: ${code}.`);this.name='DecisionOpeningError';this.code=code;}
}
export const openingFail=code=>{throw new DecisionOpeningError(code);};
export const openingGuard=fn=>{try{return fn();}catch(error){if(error instanceof DecisionOpeningError)throw error;openingFail('invalid_custody_record');}};
/** Async startup adapters are unsupported; consume their rejection without leaking raw callback errors. */
export const openingSynchronous=value=>{if(types.isPromise(value)){Promise.prototype.catch.call(value,()=>{});openingFail('custody_configuration');}return value;};
export const openingSame=(a,b)=>portfolioCanonical(a)===portfolioCanonical(b);
const stamp=(domain,value)=>portfolioDigest({domain,value});
const copy=value=>K.freeze(structuredClone(value));
function expectedRecord(value){
 K.exact(value,['kind','recordId','format','digest']);K.uuid(value.recordId);K.sha(value.digest);
 if(value.kind!=='portfolio'||!['angbao-local-portfolio-work@1','angbao-local-portfolio-work@2'].includes(value.format))openingFail('invalid_selection');
}
export function validateOpeningWorkspace(value){return openingGuard(()=>{
 K.bounded(value,1024);K.exact(value,['installationId','dataLocationFingerprint']);K.uuid(value.installationId);K.sha(value.dataLocationFingerprint);return copy(value);
});}
export function validateOpeningBuildReference(value){return openingGuard(()=>{
 K.bounded(value,1024);if(!openingSame(value,DECISION_OPENING_BUILD_REFERENCE))openingFail('build_reference_changed');return copy(value);
});}
export function validateOpeningRequest(value){return openingGuard(()=>{
 K.bounded(value,2048);K.exact(value,['requestId','expectedRecord','chainId','owner','contract']);K.uuid(value.requestId);expectedRecord(value.expectedRecord);K.address(value.owner);K.address(value.contract);
 if(value.chainId!==46630||value.owner===value.contract)openingFail('invalid_request_scope');return copy(value);
});}
export function decisionOpeningRequestDigest(request,workspace){return openingGuard(()=>stamp('angbao.decision-opening-request.v1',{request:validateOpeningRequest(request),workspace:validateOpeningWorkspace(workspace),buildReference:DECISION_OPENING_BUILD_REFERENCE}));}
export function validateOpeningSelection(record,reference){return openingGuard(()=>{
 K.bounded(record,65536);K.bounded(reference,2048);expectedRecord(reference);const native=validatePortfolioWorkRecord(record);
 if(native.id!==reference.recordId||native.format!==reference.format||native.digest!==reference.digest)openingFail('selection_changed');return copy(native);
});}
export function createDecisionOpeningEntry(input){return openingGuard(()=>{
 K.bounded(input,131072);K.exact(input,['request','workspace','record','privateSalt','operationRef','createdAt']);
 const request=validateOpeningRequest(input.request),workspace=validateOpeningWorkspace(input.workspace),record=validateOpeningSelection(input.record,request.expectedRecord);
 const checkpoint=prepareDecisionCheckpoint({record,expectedRecord:request.expectedRecord,chainId:request.chainId,owner:request.owner,contract:request.contract,operationRef:input.operationRef,createdAt:input.createdAt},{privateSalt:input.privateSalt});
 const body={format:'angbao-private-decision-opening@1',request,workspace,buildReference:DECISION_OPENING_BUILD_REFERENCE,record,privateSalt:input.privateSalt,checkpoint,requestDigest:decisionOpeningRequestDigest(request,workspace)};
 return copy({...body,entryDigest:stamp('angbao.private-decision-opening.v1',body)});
});}
export function validateDecisionOpeningEntry(value){return openingGuard(()=>{
 K.bounded(value,131072);K.exact(value,['format','request','workspace','buildReference','record','privateSalt','checkpoint','requestDigest','entryDigest']);
 validateOpeningBuildReference(value.buildReference);
 const rebuilt=createDecisionOpeningEntry({request:value.request,workspace:value.workspace,record:value.record,privateSalt:value.privateSalt,operationRef:value.checkpoint.anchor.operationRef,createdAt:value.checkpoint.createdAt});
 if(!openingSame(rebuilt,value))openingFail('opening_changed');
 verifyDecisionCheckpointOpening(value.checkpoint,{record:value.record,expectedRecord:value.request.expectedRecord,privateSalt:value.privateSalt});return rebuilt;
});}
function vaultBody(value){
 K.exact(value,['format','vaultId','workspace','revision','recoveryOnly','entries']);K.uuid(value.vaultId);const workspace=validateOpeningWorkspace(value.workspace);
 if(value.format!=='angbao-decision-opening-vault@1'||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.recoveryOnly!=='boolean'||!Array.isArray(value.entries)||value.entries.length>16)openingFail('invalid_vault');
 const ids=new Set(),refs=new Set();
 for(const entry of value.entries){validateDecisionOpeningEntry(entry);const ref=entry.checkpoint.anchor.operationRef;if(!openingSame(entry.workspace,workspace)||ids.has(entry.request.requestId)||refs.has(ref))openingFail('vault_binding_changed');ids.add(entry.request.requestId);refs.add(ref);}
 return value;
}
function stampVault(body){return copy({...body,vaultDigest:stamp('angbao.decision-opening-vault.v1',body)});}
/** Pure preprovisioning value only; the trusted integrator explicitly writes it with the accepted primitive. */
export function createEmptyDecisionOpeningVault(input){return openingGuard(()=>{K.bounded(input,2048);K.exact(input,['vaultId','workspace']);return stampVault(vaultBody({format:'angbao-decision-opening-vault@1',vaultId:input.vaultId,workspace:validateOpeningWorkspace(input.workspace),revision:0,recoveryOnly:false,entries:[]}));});}
/** A single-entry backup cannot establish a lost inventory is complete. No promotion API exists. */
export function createRecoveryDecisionOpeningVault(input){return openingGuard(()=>{const {vaultDigest,...body}=createEmptyDecisionOpeningVault(input);return stampVault({...body,recoveryOnly:true});});}
export function validateDecisionOpeningVault(value){return openingGuard(()=>{
 K.bounded(value,DECISION_OPENING_MAX_BYTES);K.exact(value,['format','vaultId','workspace','revision','recoveryOnly','entries','vaultDigest']);const {vaultDigest,...body}=value;vaultBody(body);
 if(vaultDigest!==stamp('angbao.decision-opening-vault.v1',body))openingFail('vault_changed');return copy(value);
});}
export function appendDecisionOpeningEntry(vaultValue,entryValue){return openingGuard(()=>{
 const vault=validateDecisionOpeningVault(vaultValue),entry=validateDecisionOpeningEntry(entryValue);
 if(!openingSame(vault.workspace,entry.workspace))openingFail('workspace_changed');const existing=vault.entries.find(e=>e.request.requestId===entry.request.requestId);
 if(existing){if(!openingSame(existing,entry))openingFail('request_conflict');return vault;}
 if(vault.entries.length>=16||vault.revision>=Number.MAX_SAFE_INTEGER)openingFail('custody_capacity');
 return validateDecisionOpeningVault(stampVault({format:vault.format,vaultId:vault.vaultId,workspace:vault.workspace,revision:vault.revision+1,recoveryOnly:vault.recoveryOnly,entries:[...vault.entries,entry]}));
});}
export function decisionOpeningHandle(vaultId,entryValue){return openingGuard(()=>{
 K.uuid(vaultId);const entry=validateDecisionOpeningEntry(entryValue);return copy({format:'angbao-local-decision-opening-handle@1',vaultId,requestId:entry.request.requestId,requestDigest:entry.requestDigest,checkpointDigest:entry.checkpoint.checkpointDigest,entryDigest:entry.entryDigest,authority:decisionOpeningAuthority()});
});}
export function validateDecisionOpeningHandle(value){return openingGuard(()=>{
 K.bounded(value,2048);K.exact(value,['format','vaultId','requestId','requestDigest','checkpointDigest','entryDigest','authority']);K.uuid(value.vaultId);K.uuid(value.requestId);for(const key of ['requestDigest','checkpointDigest','entryDigest'])K.sha(value[key]);
 if(value.format!=='angbao-local-decision-opening-handle@1'||!openingSame(value.authority,decisionOpeningAuthority()))openingFail('invalid_handle');return copy(value);
});}
export function createDecisionOpeningBackup(vaultId,entryValue){return openingGuard(()=>{
 K.uuid(vaultId);const entry=validateDecisionOpeningEntry(entryValue),body={format:'angbao-sensitive-decision-opening-backup@1',originVaultId:vaultId,workspace:entry.workspace,entry,authority:decisionOpeningAuthority()};
 return copy({...body,bundleDigest:stamp('angbao.sensitive-decision-opening-backup.v1',body)});
});}
export function validateDecisionOpeningBackup(value){return openingGuard(()=>{
 K.bounded(value,196608);K.exact(value,['format','originVaultId','workspace','entry','authority','bundleDigest']);const rebuilt=createDecisionOpeningBackup(value.originVaultId,value.entry);
 if(!openingSame(value,rebuilt))openingFail('backup_changed');return rebuilt;
});}
