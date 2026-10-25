/** Explicit owner-only composition. Never a signer, general RPC tool or implicit grant. */
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {createLocalCheckpointCoordinator} from './local-checkpoint-coordinator.mjs';
import {createLocalDecisionOpeningStore} from './local-decision-opening-store.mjs';
import {createLocalDecisionCheckpointService} from './local-decision-checkpoint-service.mjs';
import {readPrivateJson,privateJsonTransaction,privateDirectory} from './local-elfa-private-files.mjs';
import {validateOpeningWorkspace,validateOpeningBuildReference,validateOpeningSelection,createEmptyDecisionOpeningVault,DECISION_OPENING_BUILD_REFERENCE} from '../domain/decision-opening-record.mjs';
import {validateCheckpointCaps,checkpointExecutionInternals as U} from '../domain/decision-checkpoint-execution.mjs';
import {checkpointOperationRequestDigest} from '../domain/decision-checkpoint-operation.mjs';
import {CHECKPOINT_CHAIN_ENDPOINT} from '../integrations/robinhood-checkpoint-read.mjs';
const {K,copy,same}=U;
export const CREATE='angbao-commitment-create',COMMIT='angbao-decision-checkpoint-commit';
const ACTIONS=['read','read-status','list','report-hash','report-hash-return','record-reference','record-reference-return','export-public'];
export class CheckpointControllerError extends Error{constructor(code='checkpoint_denied',status=409){super('This checkpoint action stopped. Inspect the saved operation before continuing.');this.code=code;this.status=status;}}
const fail=(code,status)=>{throw new CheckpointControllerError(code,status);};
const iso=v=>{K.iso(v);return Date.parse(v);};
const exact=(v,keys)=>K.exact(v,keys);
function ownedFile(file,max=1048576){
 if(typeof file!=='string'||!path.isAbsolute(file))fail('checkpoint_private_path');
 privateDirectory(path.dirname(file));const s=fs.lstatSync(file);
 if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||s.mode&0o077||s.nlink!==1||s.size>max||fs.realpathSync(file)!==file)fail('checkpoint_private_path');return s;
}
export function validateCheckpointOwnerGrant(value,{now=new Date()}={}){
 K.bounded(value,65536);exact(value,['format','profile','grantId','revision','chainId','dataFile','journalDirectory','port','workspace','owner','selection','buildReference','custody','operations','readPolicy','preparationAccess','recoveryAccess','revocationFile','expiresAt']);
 const g=copy(value),ms=now.getTime();K.uuid(g.grantId);if(g.format!=='angbao-reviewed-owner-funded-run@2'||g.profile!=='checkpoint-owner'||g.chainId!==46630||!Number.isSafeInteger(g.revision)||g.revision<0||!Number.isInteger(g.port)||g.port<1024||g.port>65535||!Number.isFinite(ms)||iso(g.expiresAt)>ms+1800000)fail('checkpoint_invalid_grant');
 validateOpeningWorkspace(g.workspace);K.address(g.owner);validateOpeningBuildReference(g.buildReference);if(!same(g.buildReference,DECISION_OPENING_BUILD_REFERENCE))fail('checkpoint_build_changed');
 exact(g.selection,['kind','recordId','format','digest','decisionDigest']);K.uuid(g.selection.recordId);K.sha(g.selection.digest);K.sha(g.selection.decisionDigest);if(g.selection.kind!=='portfolio'||!['angbao-local-portfolio-work@1','angbao-local-portfolio-work@2'].includes(g.selection.format))fail('checkpoint_invalid_selection');
 for(const f of ['dataFile','journalDirectory','revocationFile'])if(typeof g[f]!=='string'||!path.isAbsolute(g[f]))fail('checkpoint_private_path');
 exact(g.custody,['directory','vaultFile','vaultId']);K.uuid(g.custody.vaultId);
 if(typeof g.custody.directory!=='string'||!path.isAbsolute(g.custody.directory)||path.dirname(g.custody.vaultFile)!==g.custody.directory||g.custody.vaultFile===g.dataFile||g.custody.directory===g.journalDirectory||g.custody.directory===path.dirname(g.dataFile))fail('checkpoint_private_path');
 if(!Array.isArray(g.operations)||g.operations.length!==2)fail('checkpoint_invalid_grant');
 const keys=new Set();for(const [i,o]of g.operations.entries()){
  exact(o,['id','purpose','parentCreationId','discoveryKey','caps']);K.uuid(o.id);K.uuid(o.discoveryKey);validateCheckpointCaps(o.caps);
  if(o.purpose!==(i===0?CREATE:COMMIT)||o.parentCreationId!==(i===0?null:g.operations[0].id)||o.id===o.discoveryKey||keys.has(o.id)||keys.has(o.discoveryKey))fail('checkpoint_invalid_grant');keys.add(o.id);keys.add(o.discoveryKey);
 }
 exact(g.preparationAccess,['enabled','expiresAt']);if(typeof g.preparationAccess.enabled!=='boolean'||iso(g.preparationAccess.expiresAt)>iso(g.expiresAt))fail('checkpoint_invalid_grant');
 exact(g.recoveryAccess,['expiresAt','actions']);if(iso(g.recoveryAccess.expiresAt)>ms+86400000||!Array.isArray(g.recoveryAccess.actions)||new Set(g.recoveryAccess.actions).size!==g.recoveryAccess.actions.length||g.recoveryAccess.actions.some(a=>!ACTIONS.includes(a)))fail('checkpoint_invalid_grant');
 exact(g.readPolicy,['endpoint','operations','maxResponseBytes','maxScopeBytes','requestTimeoutMs','scopeTimeoutMs','retries','polling']);
 if(g.readPolicy.endpoint!==CHECKPOINT_CHAIN_ENDPOINT||g.readPolicy.maxResponseBytes!==131072||g.readPolicy.maxScopeBytes!==1048576||g.readPolicy.requestTimeoutMs!==5000||g.readPolicy.scopeTimeoutMs!==30000||g.readPolicy.retries!==0||g.readPolicy.polling!==false||!Array.isArray(g.readPolicy.operations)||g.readPolicy.operations.length!==2)fail('checkpoint_invalid_grant');
 for(const [i,p]of g.readPolicy.operations.entries()){
  exact(p,['id','maximumScopes','maximumRequests','phases']);if(p.id!==g.operations[i].id||!Number.isInteger(p.maximumScopes)||p.maximumScopes<0||p.maximumScopes>8||!Number.isInteger(p.maximumRequests)||p.maximumRequests<0||p.maximumRequests>80||!Array.isArray(p.phases)||p.phases.length>8)fail('checkpoint_invalid_grant');
  let sum=0;const phaseKeys=new Set();for(const ph of p.phases){exact(ph,['phase','operationKey','maximumRequests']);K.uuid(ph.operationKey);if(phaseKeys.has(ph.operationKey))fail('checkpoint_invalid_grant');phaseKeys.add(ph.operationKey);if(keys.has(ph.operationKey)&&ph.operationKey!==g.operations[i].discoveryKey||!['discovery','review','before-wallet','observation'].includes(ph.phase))fail('checkpoint_invalid_grant');keys.add(ph.operationKey);const max=ph.phase==='discovery'?8:ph.phase==='observation'?8:i===0?10:11;if(ph.maximumRequests!==max||ph.phase==='discovery'&&ph.operationKey!==g.operations[i].discoveryKey||ph.phase!=='discovery'&&ph.operationKey===g.operations[i].discoveryKey)fail('checkpoint_invalid_grant');sum+=max;}
  if(p.phases.length>p.maximumScopes||sum>p.maximumRequests)fail('checkpoint_invalid_grant');
 }
 return K.freeze(g);
}
/** Current-file checks only; no provision and no network. */
export function assertCheckpointOwnerFiles(grant){
 ownedFile(grant.dataFile,2*1048576);privateDirectory(grant.journalDirectory);ownedFile(path.join(grant.journalDirectory,'owner-funded-transfers.json'));privateDirectory(grant.custody.directory);ownedFile(grant.custody.vaultFile);ownedFile(grant.revocationFile,4096);
}
function privateStore(g,readWorkspaceBinding){return createLocalDecisionOpeningStore({readPrivateState:()=>readPrivateJson(g.custody.vaultFile,1048576),transactPrivateState:work=>privateJsonTransaction(g.custody.vaultFile,work),readWorkspaceBinding,expectedVaultId:g.custody.vaultId});}
export function createLocalCheckpointController({grant,journal,readSelectedRecord,readWorkspaceBinding,requestChain=null,now=()=>new Date()}={}){
 const g=validateCheckpointOwnerGrant(grant,{now:now()});assertCheckpointOwnerFiles(g);let closed=false,last=now().getTime();const token=randomBytes(32).toString('hex'),origin=`http://127.0.0.1:${g.port}`;
 const time=()=>{const n=now().getTime();if(!Number.isFinite(n)||n<last)fail('checkpoint_clock_changed');last=n;return n;};
 function current(kind){
  if(closed)fail('checkpoint_closed');const ms=time();if(!same(readWorkspaceBinding(),g.workspace))fail('checkpoint_workspace_changed');
  const r=readPrivateJson(g.revocationFile,4096);exact(r,['format','grantId','revision','preparationRevoked','readsRevoked','recoveryRevoked']);if(r.format!=='angbao-checkpoint-owner-revocation@1'||r.grantId!==g.grantId||r.revision!==g.revision||['preparationRevoked','readsRevoked','recoveryRevoked'].some(k=>typeof r[k]!=='boolean'))fail('checkpoint_revoked');
  if(kind==='recovery'){if(r.recoveryRevoked||ms>=iso(g.recoveryAccess.expiresAt))fail('checkpoint_recovery_denied');}
  else if(ms>=iso(g.expiresAt)||ms>=iso(g.preparationAccess.expiresAt)||!g.preparationAccess.enabled||r.preparationRevoked||kind==='read'&&r.readsRevoked)fail('checkpoint_grant_expired');return true;
 }
 const op=(purpose,id)=>{const o=g.operations.find(o=>o.id===id&&o.purpose===purpose);if(!o)fail('checkpoint_scope_changed');return o;};
 function binding(subject){const o=op(subject.purpose,subject.id);const expected=checkpointOperationRequestDigest({id:o.id,purpose:o.purpose,expectedRecord:Object.fromEntries(['kind','recordId','format','digest'].map(k=>[k,g.selection[k]])),owner:g.owner,caps:o.caps,parentCreationId:o.parentCreationId},g.workspace);if(subject.requestDigest!==expected||!same(subject.workspace,g.workspace))fail('checkpoint_scope_changed');return o;}
 function selected(ref){const record=readSelectedRecord(ref);validateOpeningSelection(record,ref);if(record.digest!==g.selection.digest||record.decision.decisionDigest!==g.selection.decisionDigest)fail('checkpoint_selection_changed');return record;}
 const selectionCurrent=()=>{try{selected(Object.fromEntries(['kind','recordId','format','digest'].map(k=>[k,g.selection[k]])));return true;}catch{return false;}};
 const store=privateStore(g,readWorkspaceBinding),custody=createLocalDecisionCheckpointService({openingStore:store,readSelectedRecord:selected,readWorkspaceBinding,buildReference:g.buildReference,now});
 const subjectAllowed=(subject,recovery)=>{
  current(recovery?'recovery':'read');if(!same(subject.workspace,g.workspace))return false;
  if(subject.action==='list')return g.operations.some(o=>o.purpose===subject.purpose)&&g.recoveryAccess.actions.includes('list');
  binding(subject);return !recovery||g.recoveryAccess.actions.includes(subject.action);
 };
 function authorizeReadPacket({plan,subject,phase,usage}){
  current('read');binding(subject);if(!same(subject.workspace,g.workspace)||plan.endpoint!==CHECKPOINT_CHAIN_ENDPOINT||plan.chainId!==46630||subject.intentDigest!==null&&plan.intentDigest!==subject.intentDigest)return false;
  const policy=g.readPolicy.operations.find(p=>p.id===subject.id),p=policy.phases.find(p=>p.phase===phase&&p.operationKey===plan.operationKey);if(!p)return false;
  const scope=usage.scopes.find(s=>s.operationKey===plan.operationKey);
  if(!scope)return false;
  const included=scope.reservedPackets===plan.packetIndex+1;
  if(!included&&scope.reservedPackets!==plan.packetIndex)return false;
  const added=included?0:plan.requests.length;
  const recipes={identity:['eth_chainId','eth_getBlockByNumber'],
    'owner-state':['eth_getCode','eth_getBalance','eth_getTransactionCount','eth_getTransactionCount'],
    state:['eth_getCode','eth_getBalance','eth_getTransactionCount','eth_getTransactionCount','eth_getCode','eth_estimateGas',...(subject.purpose===COMMIT?['eth_call']:[])],
    'canonical-recheck':['eth_getBlockByNumber','eth_getTransactionCount'],
    transaction:['eth_chainId','eth_getTransactionByHash','eth_getTransactionReceipt'],
    'receipt-checkpoint':['eth_getBlockByNumber','eth_blockNumber','eth_getCode','eth_getBlockByNumber']};
  if(!same(plan.requests.map(r=>r.method),recipes[plan.stage]))return false;
  if(usage.reservedRequests+added>policy.maximumRequests||usage.reservedScopes>policy.maximumScopes||plan.alreadyReservedRequests+plan.requests.length>p.maximumRequests)return false;
  return true;
 }
 const coordinator=createLocalCheckpointCoordinator({journal,canonicalDirectory:g.journalDirectory,custodyService:custody,readOpeningEntry:h=>store.readEntry(h),readSelectedRecord:selected,readWorkspaceBinding,now,authorizePreparation:s=>subjectAllowed(s,false),authorizeObservation:s=>s.action==='reserve-read-packet'||s.action==='observe'||s.action==='observe-return'?(current('read'),binding(s),true):subjectAllowed(s,true),authorizeReadPacket,authorizeWalletReturn:({subject,buildReference})=>{binding(subject);selected(Object.fromEntries(['kind','recordId','format','digest'].map(k=>[k,g.selection[k]])));if(!same(subject.workspace,g.workspace)||!same(buildReference,g.buildReference))return false;current('read');return true;},
 resolveAcceptedBuild:async()=>{current('read');return g.buildReference;},requestChain:requestChain===null?null:async(request,context)=>{current('read');if(context.endpoint!==CHECKPOINT_CHAIN_ENDPOINT)fail('checkpoint_endpoint_denied');const result=await requestChain(request,context);current('read');return result;}});
 function expected(row){if(!row.review||!row.intent)return null;return copy({purpose:row.purpose,recordId:row.id,intentDigest:row.intent.intentDigest,reviewDigest:K.digest(row.review),expectedOwner:row.owner,chainId:46630,contract:row.intent.contract,buildReference:g.buildReference,payer:row.intent.payer,costs:{minimumIntrinsicGas:row.intent.costs.minimumIntrinsicGas,maximumGasFeeWei:row.intent.costs.maximumGasFeeWei,nativeValueWei:'0'},anchor:row.purpose===CREATE?null:{operationRef:row.intent.checkpoint.anchor.operationRef,commitment:row.intent.checkpoint.anchor.commitment},observedAt:row.review.observedAt,expiresAt:row.review.expiresAt});}
 async function projection(purpose,id){op(purpose,id);const row=await coordinator.read({purpose,id}),status=await coordinator.status({purpose,id});return {...status,selectionAvailable:selectionCurrent(),readAttempts:row.readScopes.map(s=>({operationKey:s.operationKey,complete:s.resultDigest!==null})),expected:expected(row),opening:row.custody?custody.readRecoveryStatus(row.custody.handle):null};}
 const keyFor=(id,phase,key)=>{const p=g.readPolicy.operations.find(p=>p.id===id)?.phases.find(p=>p.phase===phase&&p.operationKey===key);if(!p)fail('checkpoint_read_key_denied');return key;};
 async function action(name,body){
  K.bounded(body,8192);if(name==='list'){exact(body,[]);current('recovery');if(!g.recoveryAccess.actions.includes('list'))fail('checkpoint_recovery_denied');const result=[];for(const o of g.operations){const exists=(await journal.list({purpose:o.purpose})).some(r=>r.id===o.id);if(exists)result.push(await projection(o.purpose,o.id));else result.push({id:o.id,purpose:o.purpose,status:'not-prepared',nonceReserved:false,transactionHash:null,expected:null,opening:null});}return {operations:result,selection:{recordId:g.selection.recordId},signupRequired:false};}
  if(name==='public-receipt'){exact(body,[]);return coordinator.publicReceipt({deploymentId:g.operations[0].id,commitId:g.operations[1].id});}
  exact(body,name==='prepare'?['purpose','id']:name==='refresh-review'?['purpose','id','operationKey']:name==='begin-wallet'?['purpose','id','reviewDigest','operationKey']:name==='report'?['purpose','id','challengeId','transactionHash']:name==='recover-reference'?['purpose','id','reviewDigest','transactionHash']:name==='observe'?['purpose','id','operationKey']:['purpose','id']);
  const o=op(body.purpose,body.id);
  if(name==='prepare'){current('prepare');selected(Object.fromEntries(['kind','recordId','format','digest'].map(k=>[k,g.selection[k]])));keyFor(o.id,'discovery',o.discoveryKey);const input={...o,expectedRecord:Object.fromEntries(['kind','recordId','format','digest'].map(k=>[k,g.selection[k]])),owner:g.owner};delete input.purpose;await coordinator[o.purpose===CREATE?'prepareDeployment':'prepareCommit'](input);}
  else if(name==='refresh-review'){current('read');selected(Object.fromEntries(['kind','recordId','format','digest'].map(k=>[k,g.selection[k]])));keyFor(o.id,'review',body.operationKey);const row=await coordinator.read({purpose:o.purpose,id:o.id});await coordinator.refreshPreflight({purpose:o.purpose,id:o.id,expectedDigest:row.digest,operationKey:body.operationKey});}
  else if(name==='begin-wallet'){current('read');keyFor(o.id,'before-wallet',body.operationKey);return {challenge:await coordinator.beginWalletReview(body)};}
  else if(name==='report'){await coordinator.reportHash(body);}
  else if(name==='recover-reference'){await coordinator.recordExactReference(body);}
  else if(name==='observe'){current('read');keyFor(o.id,'observation',body.operationKey);await coordinator.observe({...body,minimumConfirmations:3,previousBlockHash:null});}
  else if(name!=='read')fail('checkpoint_route_unavailable',404);
  return {operation:await projection(o.purpose,o.id)};
 }
 function guard(request,server,{bootstrap=false}={}){
  const a=server.address();if(!a||typeof a==='string'||a.address!=='127.0.0.1'||a.port!==g.port||!['127.0.0.1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress)||request.headers.host!==new URL(origin).host)fail('checkpoint_origin_denied',403);
  if(bootstrap){if(request.method!=='GET'||request.headers['x-angbao-checkpoint-bootstrap']!=='1'||request.headers['sec-fetch-site']&&request.headers['sec-fetch-site']!=='same-origin')fail('checkpoint_origin_denied',403);}
  else{if(request.method!=='POST'||request.headers.origin!==origin||request.headers['sec-fetch-site']&&request.headers['sec-fetch-site']!=='same-origin'||!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??''))fail('checkpoint_origin_denied',403);const value=request.headers['x-angbao-checkpoint-token'];if(typeof value!=='string'||value.length!==token.length||!timingSafeEqual(Buffer.from(value),Buffer.from(token)))fail('checkpoint_session_expired',403);}
 }
 return Object.freeze({origin,guard,bootstrap(){current('recovery');return {checkpointOwner:true,token,operations:g.operations.map(o=>({id:o.id,purpose:o.purpose,parentCreationId:o.parentCreationId,phases:g.readPolicy.operations.find(p=>p.id===o.id).phases.map(p=>({phase:p.phase,operationKey:p.operationKey}))})),selection:{recordId:g.selection.recordId},expiresAt:g.expiresAt};},action,close(){closed=true;coordinator.close();}});
}
/** Explicit operator modes. These never start the server or access a provider. */
export async function checkpointOwnerOperator({mode,grant,journal,readSelectedRecord,readWorkspaceBinding,inputFile,outputFile,handle}){
 const g=grant;if(mode==='provision'){
  privateDirectory(g.journalDirectory);privateDirectory(g.custody.directory);if(fs.existsSync(path.join(g.journalDirectory,'owner-funded-transfers.json'))||fs.existsSync(g.custody.vaultFile))fail('checkpoint_existing_storage');
  await journal.provision();privateJsonTransaction(g.custody.vaultFile,()=>({value:createEmptyDecisionOpeningVault({vaultId:g.custody.vaultId,workspace:g.workspace}),result:null}),{createOnly:true});return {provisioned:true};
 }
 const store=privateStore(g,readWorkspaceBinding),service=createLocalDecisionCheckpointService({openingStore:store,readSelectedRecord,readWorkspaceBinding,buildReference:g.buildReference});
 if(mode==='backup'){
  if(handle?.requestId!==g.operations[0].id)fail('checkpoint_scope_changed');
  const bundle=service.exportPrivateOpening(handle,{disclosure:'include-private-opening'});
  if(typeof outputFile!=='string'||!path.isAbsolute(outputFile))fail('checkpoint_private_path');
  const directory=path.dirname(outputFile),before=privateDirectory(directory);let fd,parent,created=false;
  try{
   fd=fs.openSync(outputFile,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);created=true;
   fs.writeFileSync(fd,JSON.stringify(bundle));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
   parent=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
   const actual=fs.fstatSync(parent);if(actual.dev!==before.dev||actual.ino!==before.ino)fail('checkpoint_backup_uncertain');
   fs.fsyncSync(parent);fs.closeSync(parent);parent=undefined;
   ownedFile(outputFile);if(!same(readPrivateJson(outputFile,1048576),bundle))fail('checkpoint_backup_uncertain');
   const after=privateDirectory(directory);if(after.dev!==before.dev||after.ino!==before.ino)fail('checkpoint_backup_uncertain');
   return {backupWritten:true};
  }catch{fail(created?'checkpoint_backup_uncertain':'checkpoint_backup_unavailable');}
  finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}if(parent!==undefined)try{fs.closeSync(parent);}catch{}}
 }
 if(mode==='restore'){ownedFile(inputFile);const bundle=readPrivateJson(inputFile,1048576);if(bundle.entry?.request?.requestId!==g.operations[0].id||bundle.entry?.record?.digest!==g.selection.digest)fail('checkpoint_scope_changed');service.restorePrivateOpening(bundle,{expectedVaultId:g.custody.vaultId,expectedRequestId:bundle.entry.request.requestId});return {restored:true,clearForUse:false};}
 fail('checkpoint_operator_mode');
}
/** Fixed endpoint, finite request/result transport. Authorization/reservation stays in B. */
export function createCheckpointChainTransport(fetchImpl=globalThis.fetch){
 if(typeof fetchImpl!=='function')fail('checkpoint_transport');let serial=0;
 return async(request,{endpoint,signal,limits})=>{
  if(endpoint!==CHECKPOINT_CHAIN_ENDPOINT||request.service!=='chain')fail('checkpoint_endpoint_denied');
  const id=++serial,response=await fetchImpl(endpoint,{method:'POST',redirect:'error',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method:request.method,params:request.params}),signal});
  if(!response?.ok||!response.body?.getReader)fail('checkpoint_read_failed');const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>limits.maxResponseBytes){await reader.cancel();fail('checkpoint_response_bounds');}chunks.push(p.value);}}finally{reader.releaseLock();}
  const reply=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));exact(reply,['jsonrpc','id','result']);if(reply.jsonrpc!=='2.0'||reply.id!==id)fail('checkpoint_read_failed');return reply.result;
 };
}
