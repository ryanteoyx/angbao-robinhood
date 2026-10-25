/** Separate account-initialization purpose. Inactive by default; signatures stay in RAM. */
const PURPOSE='kernel-account-initialization';
import {ApiError} from '../domain/angbao.mjs';
import {portfolioExact} from '../domain/portfolio-work-record.mjs';
import * as domain from '../domain/local-kernel-initialization.mjs';
import {createLocalWalletChallenges} from './local-wallet-challenges.mjs';
import {validateKernelInitializationSubmission} from '../integrations/kernel-initialization-reconciliation.mjs';

const fail=(code,message='Reopen the saved initialization before continuing.',status=409)=>{throw new ApiError(status,code,message);};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function createLocalKernelFlow({readState,write,bridgeFactory=null,readerFactory=null,authorizeReadPlan=async()=>false,now=()=>new Date()}={}){
 if(typeof readState!=='function'||typeof write!=='function'||typeof now!=='function'||typeof authorizeReadPlan!=='function'||bridgeFactory!==null&&typeof bridgeFactory!=='function'||readerFactory!==null&&typeof readerFactory!=='function')fail('kernel_flow_configuration','The local account setup flow is not configured.',503);
 function publicChallenge(value){const {transferId,ownerReviewDigest,...rest}=value;return {...rest,purpose:PURPOSE,initializationId:transferId,initializationReviewDigest:ownerReviewDigest};}
 const sessions=new Map(),jobs=new Map(),observations=new Map(),challengeRefs=new Map();let closed=false;
 const available=()=>!closed&&typeof bridgeFactory==='function'&&typeof readerFactory==='function';
 const active=()=>{if(!available())fail('kernel_flow_unavailable','The trusted local account setup flow is unavailable. Nothing was sent.',503);};
 const time=()=>{const date=now();if(!(date instanceof Date)||!Number.isFinite(date.getTime()))fail('kernel_flow_clock');return date;};
 function args(value,keys){portfolioExact(value,keys);if(!uuid(value.initializationId)||keys.includes('initializationDigest')&&!digest(value.initializationDigest)||keys.includes('initializationReviewDigest')&&!digest(value.initializationReviewDigest))fail('kernel_flow_selection');}
 async function record(id){return domain.readLocalKernelInitialization(await readState(),id);}
 function mutable(selected,expected,{fresh=false}={}){if(selected.imported||selected.digest!==expected)fail('kernel_flow_selection');if(fresh&&Date.parse(selected.intent.expiresAt)<=time().getTime())fail('kernel_flow_expired','This initialization review expired. Prepare and review a new initialization.');return selected;}
 async function persist(key,body,updater){if(closed)fail('kernel_flow_closed');return write(key,structuredClone(body),updater);}
 async function read(input){args(input,['initializationId']);const initialization=await record(input.initializationId);let walletChallenge=null;
  if(!closed&&!initialization.imported&&initialization.userOperationHash===null&&sessions.get(initialization.id)?.digest===initialization.digest){for(const [id,reference] of challengeRefs){if(reference.initializationId===initialization.id&&reference.initializationDigest===initialization.digest&&reference.initializationReviewDigest===initialization.initializationOperation?.initializationReviewDigest){try{walletChallenge=publicChallenge(challenges.read(id));}catch{walletChallenge=null;}break;}}}
  return {purpose:PURPOSE,initialization,available:available(),sessionAvailable:!closed&&sessions.has(initialization.id),walletChallenge,preparationStatus:initialization.preparationStatus??null,observationStarted:initialization.observationStarted===true};}
 async function exactSession(input){
  active();args(input,['initializationId','initializationDigest','initializationReviewDigest']);const selected=mutable(await record(input.initializationId),input.initializationDigest,{fresh:true}),session=sessions.get(selected.id);
  if(!session||session.digest!==selected.digest||!selected.initializationOperation||selected.initializationOperation.initializationReviewDigest!==input.initializationReviewDigest||session.initializationReviewDigest!==input.initializationReviewDigest||selected.userOperationHash!==null||Date.parse(selected.initializationOperation.expiresAt)<=time().getTime())fail('kernel_flow_session_unavailable','This prepared wallet session is unavailable. Read saved history; do not reconstruct a signature.');
  return {selected,session};
 }
 const challenges=createLocalWalletChallenges({now:()=>time().getTime(),bridge:{async requestWalletSignature(initializationReviewDigest,wallet){const session=[...sessions.values()].find(item=>item.initializationReviewDigest===initializationReviewDigest);if(!session)fail('kernel_flow_session_unavailable');await exactSession({initializationId:session.id,initializationDigest:session.digest,initializationReviewDigest});return session.bridge.requestWalletSignature(initializationReviewDigest,wallet);}},resolveOwnerReview:async internal=>{const input={initializationId:internal.transferId,initializationDigest:internal.transferDigest,initializationReviewDigest:internal.ownerReviewDigest};const {selected}=await exactSession(input);const operation=selected.initializationOperation;return {ownerReviewDigest:operation.initializationReviewDigest,owner:operation.owner,chainId:46630,userOperationHash:operation.userOperationHash,expiresAt:operation.expiresAt};}});
 async function prepare(input){
  active();args(input,['initializationId','initializationDigest']);
  if(jobs.has(input.initializationId)){const job=jobs.get(input.initializationId);if(input.initializationDigest!==job.initialDigest&&(await record(input.initializationId)).digest!==input.initializationDigest)fail('kernel_flow_selection');return job.promise;}
  const selected=mutable(await record(input.initializationId),input.initializationDigest,{fresh:true});
  if(jobs.has(selected.id))return jobs.get(selected.id).promise;
  if(selected.initializationOperation||selected.preparationStatus&&selected.preparationStatus!=='not-started')return read({initializationId:selected.id});
  if(jobs.size>=10)fail('kernel_flow_session_limit');
  const job={initialDigest:input.initializationDigest,promise:null};jobs.set(selected.id,job);
  job.promise=(async()=>{
   await persist(`kernel-prepare-start:${selected.id}`,input,current=>domain.startLocalKernelPreparation(current,input,time()));
   try{
    if(closed)fail('kernel_flow_closed');
    const started=await record(selected.id);let session;
    const reserveSubmission=async payload=>{
     portfolioExact(payload,['purpose','initializationReviewDigest','intentDigest','userOperationHash','entryPoint','userOperation']);
     if(payload.purpose!==PURPOSE||!session||session.initializationReviewDigest!==payload.initializationReviewDigest||payload.intentDigest!==started.intent.intentDigest)fail('kernel_flow_selection');
     if(session.reservationAttempted)fail('kernel_submission_already_attempted');session.reservationAttempted=true;
     const submission=validateKernelInitializationSubmission(started.intent,{purpose:PURPOSE,intentDigest:payload.intentDigest,entryPoint:payload.entryPoint,userOperationHash:payload.userOperationHash,userOperation:payload.userOperation});
     const body={initializationId:selected.id,initializationDigest:session.digest,initializationReviewDigest:payload.initializationReviewDigest,submission};
     await persist(`kernel-submit-reserve:${selected.id}`,body,current=>domain.reserveLocalKernelSubmission(current,body,time()));
     session.digest=(await record(selected.id)).digest;return true;
    };
    const bridge=await bridgeFactory({intent:structuredClone(started.intent),reserveSubmission});
    if(!bridge||['prepare','requestWalletSignature','submitSigned'].some(name=>typeof bridge[name]!=='function'))fail('kernel_flow_configuration');
    const initializationOperation=await bridge.prepare(structuredClone(started.intent));
    const body={initializationId:selected.id,initializationDigest:started.digest,initializationOperation};
    await persist(`kernel-prepare-save:${selected.id}`,{initializationId:selected.id,initializationDigest:started.digest,initializationReviewDigest:initializationOperation.initializationReviewDigest},current=>domain.saveLocalKernelOwnerOperation(current,body,time()));
    const saved=await record(selected.id);session={id:selected.id,bridge,digest:saved.digest,initializationReviewDigest:saved.initializationOperation.initializationReviewDigest};
    if(!closed)sessions.set(selected.id,session);return read({initializationId:selected.id});
   }catch{
    if(!closed){const current=await record(selected.id);const body={initializationId:selected.id,initializationDigest:current.digest,code:'kernel_preparation_stopped'};try{await persist(`kernel-prepare-fail:${selected.id}`,body,state=>domain.failLocalKernelPreparation(state,body,time()));}catch{/* Preserve the original durable started state if failure cannot be saved. */}}
    fail('kernel_preparation_failed','The account initialization operation could not be prepared. Read saved status before continuing.');
   }
  })();return job.promise;
 }
 async function beginWallet(input){await exactSession(input);const result=await challenges.begin({transferId:input.initializationId,transferDigest:input.initializationDigest,ownerReviewDigest:input.initializationReviewDigest});challengeRefs.set(result.id,structuredClone(input));return publicChallenge(result);}
 async function currentChallenge(id){if(!uuid(id))fail('wallet_challenge_refused');const input=challengeRefs.get(id);if(!input)fail('wallet_challenge_refused');await exactSession(input);return input;}
 async function readWallet(id){await currentChallenge(id);return publicChallenge(challenges.read(id));}
 async function respondWallet(id,body){await currentChallenge(id);return publicChallenge(await challenges.respond(id,body));}
 function cancelWallet(id){if(!uuid(id))fail('wallet_challenge_refused');const reference=challengeRefs.get(id);if(reference)sessions.delete(reference.initializationId);const result=challenges.cancel(id);return {...publicChallenge(result),phase:'cancelled'};}
 async function submit(input){
  const {session}=await exactSession(input);
  if(session.submitting)fail('kernel_submission_already_attempted');session.submitting=true;
  try{
   const result=await session.bridge.submitSigned(input.initializationReviewDigest);
   const reserved=await record(input.initializationId);if(!reserved.submission||result?.userOperationHash!==reserved.submission.userOperationHash)fail('kernel_flow_submission_uncertain');
   const body={initializationId:reserved.id,initializationDigest:reserved.digest,userOperationHash:result.userOperationHash};
   await persist(`kernel-submit-ack:${reserved.id}`,body,current=>domain.acknowledgeLocalKernelSubmission(current,body,time()));
   sessions.delete(reserved.id);return read({initializationId:reserved.id});
  }catch{sessions.delete(input.initializationId);fail('kernel_submission_uncertain','Submission was not confirmed. Read the saved operation and check its receipt; do not send another operation.');}
 }
 async function observe(input){
  active();args(input,['initializationId','initializationDigest']);const selected=mutable(await record(input.initializationId),input.initializationDigest);
  if(!selected.submission)fail('kernel_observation_unavailable','A full saved submission is required before checking its receipt.');
  if(observations.has(selected.id))return observations.get(selected.id);
  if(selected.observationStarted)return read({initializationId:selected.id});
  if(observations.size>=10)fail('kernel_flow_session_limit');
  const job=(async()=>{
   await persist(`kernel-observe-start:${selected.id}`,input,current=>domain.startLocalKernelObservation(current,input,time()));
   const started=await record(selected.id);
   try{
    const authorizePlan=async plan=>{
     if(closed||await authorizeReadPlan(plan,{intent:structuredClone(started.intent),initializationId:started.id})!==true)return false;
     const current=await record(started.id);const body={initializationId:started.id,initializationDigest:current.digest,plan};
     await persist(`kernel-read-plan:${started.id}:${current.readPlanReservations?.length??0}`,body,state=>domain.reserveLocalKernelReadPlan(state,body,time()));return true;
    };
    const reader=await readerFactory({intent:structuredClone(started.intent),authorizePlan});
    if(!reader||typeof reader.observe!=='function'||typeof reader.isTrustedResult!=='function')fail('kernel_flow_configuration');
    const observation=await reader.observe(structuredClone(started.intent),structuredClone(started.submission));
    const current=await record(started.id),body={initializationId:started.id,initializationDigest:current.digest,observation};
    await persist(`kernel-observe-save:${started.id}`,{initializationId:started.id,initializationDigest:current.digest},state=>domain.saveLocalKernelProviderObservation(state,body,reader,time()));return read({initializationId:started.id});
   }catch{fail('kernel_observation_failed','The receipt check was not confirmed. Its saved read budget will not be reset automatically.');}
  })();observations.set(selected.id,job);return job;
 }
 function close(){if(closed)return;closed=true;challenges.close();sessions.clear();challengeRefs.clear();}
 return Object.freeze({available,prepare,read,beginWallet,readWallet,respondWallet,cancelWallet,submit,observe,close});
}
