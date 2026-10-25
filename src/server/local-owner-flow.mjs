/** Inactive by default. Trusted factories only; wallet signatures remain in RAM. */
import {ApiError} from '../domain/angbao.mjs';
import {portfolioExact} from '../domain/portfolio-work-record.mjs';
import * as domain from '../domain/local-goal-transfer.mjs';
import {createLocalWalletChallenges} from './local-wallet-challenges.mjs';
import {validateGoalTransferSubmission} from '../integrations/goal-transfer-reconciliation.mjs';

const fail=(code,message='Reopen the saved transfer before continuing.',status=409)=>{throw new ApiError(status,code,message);};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function createLocalOwnerFlow({readState,write,bridgeFactory=null,readerFactory=null,authorizeReadPlan=async()=>false,now=()=>new Date()}={}){
 if(typeof readState!=='function'||typeof write!=='function'||typeof now!=='function'||typeof authorizeReadPlan!=='function'||bridgeFactory!==null&&typeof bridgeFactory!=='function'||readerFactory!==null&&typeof readerFactory!=='function')fail('owner_flow_configuration','The local owner flow is not configured.',503);
 const sessions=new Map(),jobs=new Map(),observations=new Map(),challengeRefs=new Map();let closed=false;
 const available=()=>!closed&&typeof bridgeFactory==='function'&&typeof readerFactory==='function';
 const active=()=>{if(!available())fail('owner_flow_unavailable','The trusted local owner flow is unavailable. Nothing was sent.',503);};
 const time=()=>{const date=now();if(!(date instanceof Date)||!Number.isFinite(date.getTime()))fail('owner_flow_clock');return date;};
 function args(value,keys){portfolioExact(value,keys);if(!uuid(value.transferId)||keys.includes('transferDigest')&&!digest(value.transferDigest)||keys.includes('ownerReviewDigest')&&!digest(value.ownerReviewDigest))fail('owner_flow_selection');}
 async function record(id){return domain.readLocalGoalTransfer(await readState(),id);}
 function mutable(selected,expected,{fresh=false}={}){if(selected.imported||selected.digest!==expected)fail('owner_flow_selection');if(fresh&&Date.parse(selected.intent.expiresAt)<=time().getTime())fail('owner_flow_expired','This transfer review expired. Prepare and review a new transfer.');return selected;}
 async function persist(key,body,updater){if(closed)fail('owner_flow_closed');return write(key,structuredClone(body),updater);}
 async function read(input){args(input,['transferId']);const transfer=await record(input.transferId);let walletChallenge=null;
  if(!closed&&!transfer.imported&&transfer.userOperationHash===null&&sessions.get(transfer.id)?.digest===transfer.digest){for(const [id,reference] of challengeRefs){if(reference.transferId===transfer.id&&reference.transferDigest===transfer.digest&&reference.ownerReviewDigest===transfer.ownerOperation?.ownerReviewDigest){try{walletChallenge=challenges.read(id);}catch{walletChallenge=null;}break;}}}
  return {transfer,available:available(),sessionAvailable:!closed&&sessions.has(transfer.id),walletChallenge,preparationStatus:transfer.preparationStatus??null,observationStarted:transfer.observationStarted===true};}
 async function exactSession(input){
  active();args(input,['transferId','transferDigest','ownerReviewDigest']);const selected=mutable(await record(input.transferId),input.transferDigest,{fresh:true}),session=sessions.get(selected.id);
  if(!session||session.digest!==selected.digest||!selected.ownerOperation||selected.ownerOperation.ownerReviewDigest!==input.ownerReviewDigest||session.ownerReviewDigest!==input.ownerReviewDigest||selected.userOperationHash!==null||Date.parse(selected.ownerOperation.expiresAt)<=time().getTime())fail('owner_flow_session_unavailable','This prepared wallet session is unavailable. Read saved history; do not reconstruct a signature.');
  return {selected,session};
 }
 const challenges=createLocalWalletChallenges({now:()=>time().getTime(),bridge:{async requestWalletSignature(ownerReviewDigest,wallet){const session=[...sessions.values()].find(item=>item.ownerReviewDigest===ownerReviewDigest);if(!session)fail('owner_flow_session_unavailable');await exactSession({transferId:session.id,transferDigest:session.digest,ownerReviewDigest});return session.bridge.requestWalletSignature(ownerReviewDigest,wallet);}},resolveOwnerReview:async input=>{const {selected}=await exactSession(input);const operation=selected.ownerOperation;return {ownerReviewDigest:operation.ownerReviewDigest,owner:operation.owner,chainId:46630,userOperationHash:operation.userOperationHash,expiresAt:operation.expiresAt};}});
 async function prepare(input){
  active();args(input,['transferId','transferDigest']);
  if(jobs.has(input.transferId)){const job=jobs.get(input.transferId);if(input.transferDigest!==job.initialDigest&&(await record(input.transferId)).digest!==input.transferDigest)fail('owner_flow_selection');return job.promise;}
  const selected=mutable(await record(input.transferId),input.transferDigest,{fresh:true});
  if(jobs.has(selected.id))return jobs.get(selected.id).promise;
  if(selected.ownerOperation||selected.preparationStatus&&selected.preparationStatus!=='not-started')return read({transferId:selected.id});
  if(jobs.size>=10)fail('owner_flow_session_limit');
  const job={initialDigest:input.transferDigest,promise:null};jobs.set(selected.id,job);
  job.promise=(async()=>{
   await persist(`owner-prepare-start:${selected.id}`,input,current=>domain.startLocalOwnerPreparation(current,input,time()));
   try{
    if(closed)fail('owner_flow_closed');
    const started=await record(selected.id);let session;
    const reserveSubmission=async payload=>{
     portfolioExact(payload,['ownerReviewDigest','intentDigest','userOperationHash','entryPoint','userOperation']);
     if(!session||session.ownerReviewDigest!==payload.ownerReviewDigest||payload.intentDigest!==started.intent.intentDigest)fail('owner_flow_selection');
     if(session.reservationAttempted)fail('owner_submission_already_attempted');session.reservationAttempted=true;
     const submission=validateGoalTransferSubmission(started.intent,{intentDigest:payload.intentDigest,entryPoint:payload.entryPoint,userOperationHash:payload.userOperationHash,userOperation:payload.userOperation});
     const body={transferId:selected.id,transferDigest:session.digest,ownerReviewDigest:payload.ownerReviewDigest,submission};
     await persist(`owner-submit-reserve:${selected.id}`,body,current=>domain.reserveLocalOwnerSubmission(current,body,time()));
     session.digest=(await record(selected.id)).digest;return true;
    };
    const bridge=await bridgeFactory({intent:structuredClone(started.intent),reserveSubmission});
    if(!bridge||['prepare','requestWalletSignature','submitSigned'].some(name=>typeof bridge[name]!=='function'))fail('owner_flow_configuration');
    const ownerOperation=await bridge.prepare(structuredClone(started.intent));
    const body={transferId:selected.id,transferDigest:started.digest,ownerOperation};
    await persist(`owner-prepare-save:${selected.id}`,{transferId:selected.id,transferDigest:started.digest,ownerReviewDigest:ownerOperation.ownerReviewDigest},current=>domain.saveLocalOwnerOperation(current,body,time()));
    const saved=await record(selected.id);session={id:selected.id,bridge,digest:saved.digest,ownerReviewDigest:saved.ownerOperation.ownerReviewDigest};
    if(!closed)sessions.set(selected.id,session);return read({transferId:selected.id});
   }catch{
    if(!closed){const current=await record(selected.id);const body={transferId:selected.id,transferDigest:current.digest,code:'wallet_preparation_stopped'};try{await persist(`owner-prepare-fail:${selected.id}`,body,state=>domain.failLocalOwnerPreparation(state,body,time()));}catch{/* Preserve the original durable started state if failure cannot be saved. */}}
    fail('owner_preparation_failed','The owner operation could not be prepared. Read saved status before continuing.');
   }
  })();return job.promise;
 }
 async function beginWallet(input){await exactSession(input);const result=await challenges.begin(input);challengeRefs.set(result.id,structuredClone(input));return result;}
 async function currentChallenge(id){if(!uuid(id))fail('wallet_challenge_refused');const input=challengeRefs.get(id);if(!input)fail('wallet_challenge_refused');await exactSession(input);return input;}
 async function readWallet(id){await currentChallenge(id);return challenges.read(id);}
 async function respondWallet(id,body){await currentChallenge(id);return challenges.respond(id,body);}
 function cancelWallet(id){if(!uuid(id))fail('wallet_challenge_refused');const reference=challengeRefs.get(id);if(reference)sessions.delete(reference.transferId);const result=challenges.cancel(id);return {...result,phase:'cancelled'};}
 async function submit(input){
  const {session}=await exactSession(input);
  if(session.submitting)fail('owner_submission_already_attempted');session.submitting=true;
  try{
   const result=await session.bridge.submitSigned(input.ownerReviewDigest);
   const reserved=await record(input.transferId);if(!reserved.submission||result?.userOperationHash!==reserved.submission.userOperationHash)fail('owner_flow_submission_uncertain');
   const body={transferId:reserved.id,transferDigest:reserved.digest,userOperationHash:result.userOperationHash};
   await persist(`owner-submit-ack:${reserved.id}`,body,current=>domain.acknowledgeLocalOwnerSubmission(current,body,time()));
   sessions.delete(reserved.id);return read({transferId:reserved.id});
  }catch{sessions.delete(input.transferId);fail('owner_submission_uncertain','Submission was not confirmed. Read the saved operation and check its receipt; do not send another operation.');}
 }
 async function observe(input){
  active();args(input,['transferId','transferDigest']);const selected=mutable(await record(input.transferId),input.transferDigest);
  if(!selected.submission)fail('owner_observation_unavailable','A full saved submission is required before checking its receipt.');
  if(observations.has(selected.id))return observations.get(selected.id);
  if(selected.observationStarted)return read({transferId:selected.id});
  if(observations.size>=10)fail('owner_flow_session_limit');
  const job=(async()=>{
   await persist(`owner-observe-start:${selected.id}`,input,current=>domain.startLocalGoalObservation(current,input,time()));
   const started=await record(selected.id);
   try{
    const authorizePlan=async plan=>{
     if(closed||await authorizeReadPlan(plan,{intent:structuredClone(started.intent),transferId:started.id})!==true)return false;
     const current=await record(started.id);const body={transferId:started.id,transferDigest:current.digest,plan};
     await persist(`owner-read-plan:${started.id}:${current.readPlanReservations?.length??0}`,body,state=>domain.reserveLocalGoalReadPlan(state,body,time()));return true;
    };
    const reader=await readerFactory({intent:structuredClone(started.intent),authorizePlan});
    if(!reader||typeof reader.observe!=='function'||typeof reader.isTrustedResult!=='function')fail('owner_flow_configuration');
    const observation=await reader.observe(structuredClone(started.intent),structuredClone(started.submission),null);
    const current=await record(started.id),body={transferId:started.id,transferDigest:current.digest,observation};
    await persist(`owner-observe-save:${started.id}`,{transferId:started.id,transferDigest:current.digest},state=>domain.saveLocalProviderObservation(state,body,reader,time()));return read({transferId:started.id});
   }catch{fail('owner_observation_failed','The receipt check was not confirmed. Its saved read budget will not be reset automatically.');}
  })();observations.set(selected.id,job);return job;
 }
 function close(){if(closed)return;closed=true;challenges.close();sessions.clear();challengeRefs.clear();}
 return Object.freeze({available,prepare,read,beginWallet,readWallet,respondWallet,cancelWallet,submit,observe,close});
}
