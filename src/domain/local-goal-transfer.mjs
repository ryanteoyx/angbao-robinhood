import {copyPortfolioArchive} from './portfolio-work-record.mjs';
/** Durable local intent and reported identities. No wallet, RPC, signer or submission. */
import {retainVerifiedGoalTransferObservation,verifyRetainedGoalTransferObservation} from './goal-transfer-retention.mjs';
import {validateGoalTransferSubmission} from '../integrations/goal-transfer-reconciliation.mjs';
import {randomUUID} from 'node:crypto';
import {ApiError,assertSafeJson} from './angbao.mjs';
import {portfolioExact,portfolioDigest,readPortfolioWork} from './portfolio-work-record.mjs';
import {selectedActionReview,readSubmissionReview} from './submission-review.mjs';
import {createGoalTransferIntent,validateGoalTransferIntent} from './goal-transfer.mjs';
const fail=(message,code='invalid_goal_transfer',status=400)=>{throw new ApiError(status,code,message);};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const hash=value=>typeof value==='string'&&/^0x[a-f0-9]{64}$/.test(value)&&!/^0x0{64}$/.test(value);
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export const GOAL_TRANSFER_LIMIT=10;
export function stampLocalGoalTransfer(record){const {digest,...body}=record;return {...body,digest:portfolioDigest(body)};}
function replayObservations(record){
 let state='awaiting-wallet',userOperationHash=null,transactionHash=null,ownerOperation=null,submission=null,verification=null,preparationStatus=null,observationStarted=false,readPlanReservations=[],readRequestsReserved=0,at=record.createdAt;
 if(!Array.isArray(record.observations)||record.observations.length>32)fail('This transfer history exceeds its limit.');
 for(const event of record.observations){
  portfolioExact(event,['type','at','evidence']);if(!iso(event.at)||event.at<at)fail('This transfer history has invalid dates.');at=event.at;
  if(event.type==='submission-reported'){
   portfolioExact(event.evidence,['userOperationHash','transactionHash']);
   if(!['awaiting-wallet','uncertain'].includes(state)||userOperationHash!==null||!hash(event.evidence.userOperationHash)||event.evidence.transactionHash!==null&&!hash(event.evidence.transactionHash))fail('Keep the original submitted operation identity. Do not send a replacement.');
   userOperationHash=event.evidence.userOperationHash;transactionHash=event.evidence.transactionHash;state='pending';
  }else if(event.type==='owner-preparation-started'){
   portfolioExact(event.evidence,[]);if(preparationStatus!==null||ownerOperation!==null||userOperationHash!==null||state!=='awaiting-wallet')fail('This owner preparation was already attempted. Read its existing outcome.');preparationStatus='started';
  }else if(event.type==='owner-preparation-failed'){
   portfolioExact(event.evidence,['code']);if(event.evidence.code!=='wallet_preparation_stopped'||preparationStatus!=='started'||ownerOperation!==null)fail('This preparation failure is not current.');preparationStatus='failed';
  }else if(event.type==='observation-started'){
   portfolioExact(event.evidence,[]);if(!submission||observationStarted)fail('This observation scope was already attempted. Read its saved outcome.');observationStarted=true;
  }else if(event.type==='read-plan-reserved'){
   portfolioExact(event.evidence,['plan']);const plan=event.evidence.plan;portfolioExact(plan,['format','phase','scope','maximumScopeRequests','alreadyAttemptedRequests','intentDigest','chainId','requests','limits','authority','signingAllowed','deploymentAllowed','submissionAllowed']);
   if(!observationStarted||plan.format!=='angbao-goal-transfer-read-plan@1'||plan.scope!=='receipt-only-recovery'||plan.maximumScopeRequests!==12||plan.alreadyAttemptedRequests!==readRequestsReserved||plan.intentDigest!==record.intent.intentDigest||plan.chainId!==46630||plan.authority!=='read-only-exact-packet'||['signingAllowed','deploymentAllowed','submissionAllowed'].some(key=>plan[key]!==false)||!Array.isArray(plan.requests)||plan.requests.length<1||plan.requests.length>12||readRequestsReserved+plan.requests.length>12||Buffer.byteLength(JSON.stringify(plan))>16384)fail('This exact receipt-read packet exceeds its retained scope.');
   for(const request of plan.requests){portfolioExact(request,['service','method','params','optionalContext'],['service','method','params']);if(!['chain','bundler'].includes(request.service)||!['eth_chainId','eth_getBlockByNumber','eth_getUserOperationReceipt','eth_getTransactionByHash','eth_getTransactionReceipt','eth_blockNumber','eth_call','eth_getBalance','eth_getLogs'].includes(request.method)||!Array.isArray(request.params)||request.optionalContext!==undefined&&typeof request.optionalContext!=='boolean')fail('This is not an exact read-only receipt packet.');}
   const planDigest=portfolioDigest(plan);if(readPlanReservations.some(item=>item.digest===planDigest))fail('This receipt packet is already reserved.');readPlanReservations.push({digest:planDigest,requestCount:plan.requests.length,phase:plan.phase,scope:plan.scope});readRequestsReserved+=plan.requests.length;
  }else if(event.type==='owner-operation-prepared'){

   portfolioExact(event.evidence,['ownerOperation']);if(ownerOperation!==null||userOperationHash!==null||state!=='awaiting-wallet')fail('This transfer already has an owner operation.');ownerOperation=validateOwnerOperation(record.intent,event.evidence.ownerOperation);preparationStatus='prepared';
  }else if(event.type==='submission-reserved'){
   portfolioExact(event.evidence,['ownerReviewDigest','submission']);if(!ownerOperation||event.evidence.ownerReviewDigest!==ownerOperation.ownerReviewDigest||submission!==null||userOperationHash!==null)fail('Keep the original owner operation and its reservation.');
   submission=validateGoalTransferSubmission(record.intent,event.evidence.submission);if(submission.userOperationHash!==ownerOperation.userOperationHash||portfolioDigest(submission.userOperation)!==portfolioDigest(ownerOperation.userOperation))fail('The submitted operation differs from the reviewed operation.');userOperationHash=submission.userOperationHash;state='uncertain';
  }else if(event.type==='submission-acknowledged'){
   portfolioExact(event.evidence,['userOperationHash']);if(!submission||state!=='uncertain'||event.evidence.userOperationHash!==userOperationHash)fail('This acknowledgement does not match the reserved operation.');state='pending';
  }else if(event.type==='provider-observed'){
   portfolioExact(event.evidence,['retained']);const retained=event.evidence.retained;
   if(!submission||!retained?.submission||portfolioDigest(retained.submission)!==portfolioDigest(submission))fail('The retained observation differs from the saved submitted operation.');
   let checked;try{checked=verifyRetainedGoalTransferObservation(record.intent,retained);}catch{fail('This retained observation is incomplete or changed. Keep the original history.');}const summary=checked.summary;
   verification={...structuredClone(summary),verificationSource:'historical-provider-observation',recordedStatus:checked.recordedStatus,retainedDigest:checked.retainedDigest,currentConfirmationEstablished:false,transactionInputAuthentication:'discarded-not-reconstructed',authority:{ownerApprovalEstablished:false,signingAllowed:false,submissionAllowed:false}};
   state=summary.status;transactionHash=summary.transactionHash??transactionHash;
  }else if(event.type==='outcome-uncertain'){

   portfolioExact(event.evidence,[]);if(!['awaiting-wallet','pending','uncertain'].includes(state))fail('This transfer cannot be marked uncertain.');state='uncertain';
  }else fail('This transfer observation is unsupported.');
 }
 return {state,userOperationHash,transactionHash,ownerOperation,submission,verification,preparationStatus,observationStarted,readPlanReservations,readRequestsReserved,updatedAt:at};
}
export function validateLocalGoalTransfer(record){
 portfolioExact(record,['format','id','localWorkId','localReviewId','intent','createdAt','updatedAt','state','userOperationHash','transactionHash','observations','imported','provenance','financialAuthority','digest','ownerOperation','submission','verification','preparationStatus','observationStarted','readPlanReservations','readRequestsReserved'],['format','id','localWorkId','localReviewId','intent','createdAt','updatedAt','state','userOperationHash','transactionHash','observations','imported','provenance','financialAuthority','digest']);
 if(record.format!=='angbao-local-goal-transfer@1'||!uuid(record.id)||!uuid(record.localWorkId)||!uuid(record.localReviewId)||typeof record.imported!=='boolean'||record.provenance!=='local-unverified-intent-and-reports'||record.financialAuthority!==false||!iso(record.createdAt)||!record.imported&&record.intent?.id!==record.id||stampLocalGoalTransfer(record).digest!==record.digest)fail('This saved transfer changed or is incomplete. Keep the original record.');
 validateGoalTransferIntent(record.intent);if(record.createdAt!==record.intent.createdAt)fail('Keep the original transfer preparation time.');
 const expected=replayObservations(record),defaults={ownerOperation:null,submission:null,verification:null,preparationStatus:null,observationStarted:false,readPlanReservations:[],readRequestsReserved:0};for(const key of Object.keys(expected))if(!(record[key]===undefined&&Object.hasOwn(defaults,key)&&portfolioDigest(expected[key])===portfolioDigest(defaults[key]))&&(record[key]===undefined||portfolioDigest(expected[key])!==portfolioDigest(record[key])))fail('The transfer state does not match its saved history.');
 assertSafeJson(record,3);if(Buffer.byteLength(JSON.stringify(record))>64*1024)fail('This saved transfer exceeds 64 KiB.');return structuredClone(record);
}
export function retainedLocalGoalTransfers(state){
 const values=state.goalTransfers??[];if(!Array.isArray(values)||values.length>GOAL_TRANSFER_LIMIT)fail('Saved transfer history is full.');const records=values.map(validateLocalGoalTransfer);
 if(new Set(records.map(record=>record.id)).size!==records.length||new Set(records.map(record=>record.localReviewId)).size!==records.length)fail('A review can prepare only one transfer.');
 for(const record of records){const review=readSubmissionReview(state,record.localReviewId),work=readPortfolioWork(state,record.localWorkId);if(review.localWorkId!==work.id||review.choice!=='prepare-test-transfer'||record.intent.source.workId!==review.origin.workId||record.intent.source.workDigest!==review.origin.workDigest||record.intent.source.decisionDigest!==work.decision.decisionDigest||record.intent.source.workspaceId!==review.origin.workspaceId||record.intent.source.workspaceETag!==review.origin.workspaceETag||!record.imported&&(record.intent.review.id!==review.id||record.intent.review.digest!==review.digest))fail('This transfer does not match its saved review and proposal.');
  const details=review.transferDetails;for(const key of ['goalId','chainId','account','token','recipient','amountAtomic'])if(portfolioDigest(record.intent[key])!==portfolioDigest(details[key]))fail('The exact reviewed transfer terms changed.');
 }
 return records;
}
export function readLocalGoalTransfer(state,id){const record=retainedLocalGoalTransfers(state).find(item=>item.id===id);if(!record)fail('This transfer is unavailable. Another transfer was not substituted.','goal_transfer_not_found',404);return record;}
export async function prepareLocalGoalTransfer(current,args,now=new Date()){
 portfolioExact(args,['reviewId','reviewDigest']);const review=await selectedActionReview(current,args,now),records=retainedLocalGoalTransfers(current);
 if(records.length>=GOAL_TRANSFER_LIMIT)fail('Transfer history is full. Export it before preparing more.','goal_transfer_full',409);
 if(records.some(record=>record.localReviewId===review.id))fail('This review already has a transfer. Open that exact transfer instead.','goal_transfer_exists',409);
 const intent=createGoalTransferIntent({id:randomUUID(),...structuredClone(review.transferDetails),source:{workId:review.origin.workId,workDigest:review.origin.workDigest,decisionDigest:review.origin.decisionDigest,workspaceId:review.origin.workspaceId,workspaceETag:review.origin.workspaceETag},review:{id:review.id,digest:review.digest},createdAt:now.toISOString(),expiresAt:review.expiresAt},{now});
 const record=validateLocalGoalTransfer(stampLocalGoalTransfer({format:'angbao-local-goal-transfer@1',id:intent.id,localWorkId:review.localWorkId,localReviewId:review.id,intent,createdAt:now.toISOString(),updatedAt:now.toISOString(),state:'awaiting-wallet',preparationStatus:null,observationStarted:false,readPlanReservations:[],readRequestsReserved:0,ownerOperation:null,submission:null,verification:null,userOperationHash:null,transactionHash:null,observations:[],imported:false,provenance:'local-unverified-intent-and-reports',financialAuthority:false}));
 const state=copyPortfolioArchive(current,structuredClone(current));state.goalTransfers=[record,...records];state.updatedAt=now.toISOString();retainedLocalGoalTransfers(state);return {state,transferId:record.id,transferDigest:record.digest};
}
export function reportLocalGoalTransfer(current,args,now=new Date()){
 portfolioExact(args,['transferId','transferDigest','type','evidence']);if(!['submission-reported','outcome-uncertain'].includes(args.type))fail('This endpoint retains only an unverified submission reference or uncertain outcome.');const record=readLocalGoalTransfer(current,args.transferId);
 if(record.imported||record.digest!==args.transferDigest)fail('Reopen this transfer. Imported history cannot be resumed.','goal_transfer_changed',409);
 return appendInternalObservation(current,record,args.type,args.evidence,now);
}

function validateOwnerOperation(intent,value){
 portfolioExact(value,['format','status','intent','intentDigest','owner','chainId','kernelVersion','entryPoint','userOperation','userOperationHash','nonce','maximumGasCostWei','runtimeContextDigest','sponsorshipEvidence','expiresAt','authority','ownerApprovalObtained','signingAllowed','deploymentAllowed','submissionAllowed','financialSuccessEstablished','requests','limitations','ownerReviewDigest']);
 const {ownerReviewDigest,...body}=value;if(value.format!=='angbao-zerodev-owner-operation-review@1'||value.status!=='unsigned-owner-review-required'||value.intentDigest!==intent.intentDigest||portfolioDigest(value.intent)!==portfolioDigest(intent)||portfolioDigest({domain:'angbao.zerodev-owner-review.v1',review:body})!==ownerReviewDigest||value.authority!=='none'||['ownerApprovalObtained','signingAllowed','deploymentAllowed','submissionAllowed','financialSuccessEstablished'].some(key=>value[key]!==false)||(!/^0x[a-f0-9]{40}$/.test(value.owner)||/^0x0{40}$/.test(value.owner))||typeof value.maximumGasCostWei!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(value.maximumGasCostWei)||!iso(value.expiresAt)||Date.parse(value.expiresAt)>Date.parse(intent.expiresAt)||value.chainId!==46630||value.kernelVersion!=='0.3.1')fail('The full owner operation review is invalid or changed.');
 portfolioExact(value.entryPoint,['address','version']);if(value.entryPoint.version!=='0.7')fail('Keep the reviewed EntryPoint version.');
 validateGoalTransferSubmission(intent,{intentDigest:intent.intentDigest,entryPoint:value.entryPoint.address,userOperationHash:value.userOperationHash,userOperation:value.userOperation});
 const operation=value.userOperation;const gas=['callGasLimit','verificationGasLimit','preVerificationGas','paymasterVerificationGasLimit','paymasterPostOpGasLimit'].reduce((sum,key)=>sum+BigInt(operation[key]),0n);if(gas*BigInt(operation.maxFeePerGas)!==BigInt(value.maximumGasCostWei)||value.nonce!==operation.nonce)fail('The displayed maximum network cost differs from the reviewed operation.');return structuredClone(value);
}
function appendInternalObservation(current,record,type,evidence,now){const event={type,at:now.toISOString(),evidence:structuredClone(evidence)},updated=stampLocalGoalTransfer({...record,observations:[...record.observations,event]});Object.assign(updated,replayObservations(updated));const checked=validateLocalGoalTransfer(stampLocalGoalTransfer(updated));const state=copyPortfolioArchive(current,structuredClone(current));state.goalTransfers=state.goalTransfers.map(item=>item.id===record.id?checked:item);state.updatedAt=now.toISOString();return {state,transferId:checked.id,transferDigest:checked.digest};}
function mutableTransfer(current,args){const record=readLocalGoalTransfer(current,args.transferId);if(record.imported||record.digest!==args.transferDigest)fail('Reopen this transfer. Imported history cannot be resumed.','goal_transfer_changed',409);return record;}
/** Internal server wiring only. No HTTP route accepts an owner-operation JSON body. */
export function saveLocalOwnerOperation(current,args,now=new Date()){portfolioExact(args,['transferId','transferDigest','ownerOperation']);const record=mutableTransfer(current,args);const ownerOperation=validateOwnerOperation(record.intent,args.ownerOperation);if(Date.parse(ownerOperation.expiresAt)<=now.getTime())fail('This owner review expired. Nothing was sent.');return appendInternalObservation(current,record,'owner-operation-prepared',{ownerOperation},now);}
/** Must be committed atomically BEFORE the bridge is allowed to broadcast. No signatures. */
export function reserveLocalOwnerSubmission(current,args,now=new Date()){portfolioExact(args,['transferId','transferDigest','ownerReviewDigest','submission']);const record=mutableTransfer(current,args);return appendInternalObservation(current,record,'submission-reserved',{ownerReviewDigest:args.ownerReviewDigest,submission:args.submission},now);}
export function acknowledgeLocalOwnerSubmission(current,args,now=new Date()){portfolioExact(args,['transferId','transferDigest','userOperationHash']);const record=mutableTransfer(current,args);return appendInternalObservation(current,record,'submission-acknowledged',{userOperationHash:args.userOperationHash},now);}
/** Supplied/imported JSON cannot satisfy the adapter's private result brand. */
export function saveLocalProviderObservation(current,args,reader,now=new Date()){portfolioExact(args,['transferId','transferDigest','observation']);if(!reader||typeof reader.isTrustedResult!=='function'||reader.isTrustedResult(args.observation)!==true)fail('This is not a result from the configured independent reader.','untrusted_transfer_observation',403);const record=mutableTransfer(current,args);const retained=retainVerifiedGoalTransferObservation(record.intent,args.observation,reader);return appendInternalObservation(current,record,'provider-observed',{retained},now);}

export function startLocalOwnerPreparation(current,args,now=new Date()){portfolioExact(args,['transferId','transferDigest']);const record=mutableTransfer(current,args);if(Date.parse(record.intent.expiresAt)<=now.getTime())fail('This transfer preparation expired. Review it again.');return appendInternalObservation(current,record,'owner-preparation-started',{},now);}
export function failLocalOwnerPreparation(current,args,now=new Date()){portfolioExact(args,['transferId','transferDigest','code']);const record=mutableTransfer(current,args);return appendInternalObservation(current,record,'owner-preparation-failed',{code:args.code},now);}
export function startLocalGoalObservation(current,args,now=new Date()){portfolioExact(args,['transferId','transferDigest']);const record=mutableTransfer(current,args);return appendInternalObservation(current,record,'observation-started',{},now);}
export function reserveLocalGoalReadPlan(current,args,now=new Date()){portfolioExact(args,['transferId','transferDigest','plan']);const record=mutableTransfer(current,args);return appendInternalObservation(current,record,'read-plan-reserved',{plan:args.plan},now);}
