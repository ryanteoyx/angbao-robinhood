import {copyPortfolioArchive} from './portfolio-work-record.mjs';
/** Separate bounded local Kernel creation history. It never establishes token funding or transfer readiness. */
import {randomUUID} from 'node:crypto';
import {ApiError,assertSafeJson} from './angbao.mjs';
import {portfolioExact,portfolioDigest} from './portfolio-work-record.mjs';
import {financialWorkspaceId} from './financial-handoff.mjs';
import {createKernelInitializationIntent,validateKernelInitializationIntent,KERNEL_INIT_GAS_FIELDS} from './kernel-initialization.mjs';
import {validateKernelInitializationSubmission,retainVerifiedKernelInitializationObservation,verifyRetainedKernelInitializationObservation} from '../integrations/kernel-initialization-reconciliation.mjs';
import {encodeFunctionData,parseAbi} from '../vendor/goal-transfer-viem.mjs';

export const KERNEL_INITIALIZATION_LIMIT=5;
export const KERNEL_INITIALIZATION_BYTES=96*1024;
const PURPOSE='kernel-account-initialization';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const hash=v=>typeof v==='string'&&/^0x[a-f0-9]{64}$/.test(v)&&!/^0x0{64}$/.test(v);
const address=v=>typeof v==='string'&&/^0x[a-f0-9]{40}$/.test(v)&&!/^0x0{40}$/.test(v);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const quantity=v=>typeof v==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(v);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const equal=(a,b)=>portfolioDigest(a)===portfolioDigest(b);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const fail=(message='This saved initialization is invalid or changed.',code='invalid_kernel_initialization',status=400)=>{throw new ApiError(status,code,message);};
const clock=now=>{if(!(now instanceof Date)||!Number.isFinite(now.getTime()))fail('Use a valid local initialization time.');return now.toISOString();};
const INIT_ABI=parseAbi(['function rootValidator() view returns(bytes21)','function validationConfig(bytes21) view returns(uint32 nonce,address hook)','function ecdsaValidatorStorage(address) view returns(address owner)','function entrypoint() view returns(address)','function approved(address) view returns(bool)','function implementation() view returns(address)']);
const codeRoles=['implementation','validator','entryPoint','kernelFactory','factory'];
const opFields=['format','purpose','status','intent','intentDigest','owner','chainId','kernelVersion','entryPoint','userOperation','userOperationHash','nonce','maximumGasCostWei','runtimeContextDigest','sponsorshipEvidence','expiresAt','authority','ownerApprovalObtained','signingAllowed','deploymentAllowed','submissionAllowed','accountDeploymentEstablished','requests','limitations','initializationReviewDigest'];
const recordFields=['format','purpose','id','review','intent','createdAt','updatedAt','state','preparationStatus','initializationOperation','submission','userOperationHash','transactionHash','verification','observationStarted','readPlanReservations','readRequestsReserved','observations','imported','provenance','financialAuthority','tokenFundingEstablished','transferReady','digest'];
function bounded(value,bytes=KERNEL_INITIALIZATION_BYTES){
 let count=0;const seen=new Set();function walk(v,depth){if(++count>20000||depth>18)fail();if(v===null||typeof v==='boolean')return;if(typeof v==='string'){if(v.length>40000)fail();return;}if(typeof v==='number'){if(!Number.isSafeInteger(v))fail();return;}if((!plain(v)&&!Array.isArray(v))||seen.has(v))fail();seen.add(v);const ds=Object.getOwnPropertyDescriptors(v);if(Array.isArray(v)&&(Object.keys(v).length!==v.length||v.length>1000))fail();for(const k of Reflect.ownKeys(ds)){if(Array.isArray(v)&&k==='length')continue;const d=ds[k];if(typeof k!=='string'||['__proto__','prototype','constructor'].includes(k)||!d.enumerable||!Object.hasOwn(d,'value'))fail();walk(d.value,depth+1);}seen.delete(v);}walk(value,0);if(Buffer.byteLength(JSON.stringify(value))>bytes)fail('This initialization history exceeds its bounded size.');
}
export function stampLocalKernelInitialization(record){const {digest,...body}=record;return {...body,digest:portfolioDigest(body)};}
function reviewStamp(value){const {digest,...body}=value;return {...body,digest:portfolioDigest({domain:'angbao.local-kernel-initialization-review.v1',review:body})};}
function validateReview(value,intent){
 portfolioExact(value,['format','purpose','id','createdAt','expiresAt','owner','routeEvidenceDigest','origin','authentication','financialAuthority','digest']);portfolioExact(value.origin,['installationId','workspaceId','workspaceETag']);
 if(value.format!=='angbao-local-kernel-initialization-review@1'||value.purpose!==PURPOSE||!uuid(value.id)||!uuid(value.origin.installationId)||!address(value.owner)||!sha(value.routeEvidenceDigest)||!/^local:[a-f0-9]{64}$/.test(value.origin.workspaceId)||!/^"(?:0|[1-9][0-9]{0,15})"$/.test(value.origin.workspaceETag)||!iso(value.createdAt)||!iso(value.expiresAt)||Date.parse(value.expiresAt)-Date.parse(value.createdAt)!==900000||value.authentication!=='unverified-local-review-intent'||value.financialAuthority!==false||reviewStamp(value).digest!==value.digest)fail('Keep the complete standalone initialization review.');
 if(value.origin.workspaceId!==`local:${portfolioDigest(value.origin.installationId)}`)fail('The original initialization workspace identity changed.');
 if(intent&&(!equal(intent.review,{id:value.id,digest:value.digest})||intent.owner!==value.owner||intent.routeEvidenceDigest!==value.routeEvidenceDigest||intent.workspaceId!==value.origin.workspaceId||intent.workspaceETag!==value.origin.workspaceETag||intent.createdAt!==value.createdAt||intent.expiresAt!==value.expiresAt))fail('This initialization no longer matches its exact standalone review.');
}
function validateOperation(intent,value){
 bounded(value,32768);portfolioExact(value,opFields);const {initializationReviewDigest,...body}=value;
 if(value.format!=='angbao-zerodev-kernel-initialization-review@1'||value.purpose!==PURPOSE||value.status!=='unsigned-owner-review-required'||value.intentDigest!==intent.intentDigest||!equal(value.intent,intent)||value.owner!==intent.owner||value.chainId!==46630||value.kernelVersion!=='0.3.1'||value.authority!=='none'||['ownerApprovalObtained','signingAllowed','deploymentAllowed','submissionAllowed','accountDeploymentEstablished'].some(k=>value[k]!==false)||!sha(value.runtimeContextDigest)||!sha(initializationReviewDigest)||portfolioDigest({domain:'angbao.zerodev-kernel-initialization-review.v1',review:body})!==initializationReviewDigest||!iso(value.expiresAt)||value.expiresAt>intent.expiresAt)fail('This complete unsigned initialization review changed.');
 portfolioExact(value.entryPoint,['address','version']);if(value.entryPoint.address!==intent.route.entryPoint||value.entryPoint.version!=='0.7')fail();
 const submitted={purpose:PURPOSE,intentDigest:intent.intentDigest,entryPoint:value.entryPoint.address,userOperationHash:value.userOperationHash,userOperation:value.userOperation};validateKernelInitializationSubmission(intent,submitted);
 const gas=KERNEL_INIT_GAS_FIELDS.reduce((sum,k)=>sum+BigInt(value.userOperation[k]),0n);if(value.nonce!==value.userOperation.nonce||value.maximumGasCostWei!==(gas*BigInt(value.userOperation.maxFeePerGas)).toString())fail('The reviewed initialization maximum fee changed.');
 portfolioExact(value.sponsorshipEvidence,['id','digest','coverage','expiresAt']);const s=value.sponsorshipEvidence;if(typeof s.id!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(s.id)||!sha(s.digest)||s.coverage!=='accepted-no-card-creation-gas-premium-usage-zero-paid-fallback'||!iso(s.expiresAt)||s.expiresAt>intent.expiresAt)fail('Keep only the reviewed creation sponsorship evidence reference.');
 portfolioExact(value.requests,['prepare:execution:eth_chainId','prepare:execution:eth_getCode','prepare:execution:eth_call','prepare:bundler:zd_getUserOperationGasPrice','prepare:bundler:eth_estimateUserOperationGas','prepare:paymaster:zd_sponsorUserOperation'],[]);
 for(const [key,count]of Object.entries(value.requests))if(!Number.isSafeInteger(count)||count<1||count>(key.endsWith('eth_getCode')||key.endsWith('zd_sponsorUserOperation')?2:1))fail();
 if(!Array.isArray(value.limitations)||value.limitations.length>8||value.limitations.some(v=>typeof v!=='string'||v.length>500))fail();return structuredClone(value);
}
const call=(to,functionName,args=[])=>({to,data:encodeFunctionData({abi:INIT_ABI,functionName,args})});
function validateReadPlan(record,plan,reserved,reservations){
 bounded(plan,16384);portfolioExact(plan,['format','purpose','intentDigest','phase','scope','maximumScopeRequests','alreadyAttemptedRequests','requests','limits','authority','signingAllowed','deploymentAllowed','submissionAllowed']);
 const phases={discovery:{prior:0,methods:['bundler:eth_getUserOperationReceipt']},transaction:{prior:1,methods:['chain:eth_chainId','chain:eth_getTransactionByHash','chain:eth_getTransactionReceipt']},checkpoint:{prior:4,methods:['chain:eth_getBlockByNumber','chain:eth_blockNumber']},'account-state':{prior:6,methods:['chain:eth_getCode','chain:eth_getStorageAt','chain:eth_call','chain:eth_call','chain:eth_call',...codeRoles.map(()=>'chain:eth_getCode')]},'account-config-and-recheck':{prior:16,methods:['chain:eth_call','chain:eth_call','chain:eth_call','chain:eth_getBlockByNumber']}};
 const phase=phases[plan.phase],intent=record.intent;
 if(!phase||plan.format!=='angbao-kernel-initialization-read-plan@1'||plan.purpose!==PURPOSE||plan.intentDigest!==intent.intentDigest||plan.scope!=='creation-receipt-and-state'||plan.maximumScopeRequests!==20||plan.alreadyAttemptedRequests!==reserved||reserved!==phase.prior||plan.authority!=='read-only-exact-packet'||['signingAllowed','deploymentAllowed','submissionAllowed'].some(k=>plan[k]!==false)||!Array.isArray(plan.requests)||plan.requests.length!==phase.methods.length||reserved+plan.requests.length>20||reservations.some(p=>p.phase===plan.phase))fail('This exact initialization receipt packet exceeds its retained scope.');
 if(!equal(plan.limits,{maxResponseBytes:131072,maxPacketBytes:1048576,requestTimeoutMs:5000,scopeTimeoutMs:30000}))fail('Keep the fixed initialization read limits.');
 let txHash=null,blockNumber=null,pin=null;
 for(let i=0;i<plan.requests.length;i++){
  const r=plan.requests[i];portfolioExact(r,['service','method','params']);if(`${r.service}:${r.method}`!==phase.methods[i]||!Array.isArray(r.params))fail('This is not the selected read-only initialization packet.');const p=r.params;
  if(plan.phase==='discovery'){if(!equal(p,[record.submission.userOperationHash]))fail();}
  else if(plan.phase==='transaction'){if(i===0){if(p.length)fail();}else{if(p.length!==1||!hash(p[0])||txHash!==null&&txHash!==p[0])fail();txHash=p[0];}}
  else if(plan.phase==='checkpoint'){if(i===0){if(p.length!==2||!quantity(p[0])||p[1]!==false)fail();}else if(p.length)fail();}
  else if(plan.phase==='account-state'){
   if(!plain(p.at(-1)))fail();portfolioExact(p.at(-1),['blockHash','requireCanonical']);if(!hash(p.at(-1).blockHash)||p.at(-1).requireCanonical!==true||pin!==null&&!equal(pin,p.at(-1)))fail();pin=p.at(-1);
   const expected=i===0?[intent.account,pin]:i===1?[intent.account,'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',pin]:i===2?[call(intent.account,'rootValidator'),pin]:i===3?[call(intent.route.validator,'ecdsaValidatorStorage',[intent.account]),pin]:i===4?[call(intent.account,'entrypoint'),pin]:[intent.route[codeRoles[i-5]],pin];if(!equal(p,expected))fail();
  }else{
   if(i===3){if(p.length!==2||!quantity(p[0])||p[1]!==false)fail();blockNumber=p[0];}
   else{portfolioExact(p.at(-1),['blockHash','requireCanonical']);if(!hash(p.at(-1).blockHash)||p.at(-1).requireCanonical!==true||pin!==null&&!equal(pin,p.at(-1)))fail();pin=p.at(-1);const expected=i===0?call(intent.account,'validationConfig',[intent.rootValidator]):i===1?call(intent.route.factory,'approved',[intent.route.kernelFactory]):call(intent.route.kernelFactory,'implementation');if(!equal(p,[expected,pin]))fail();}
  }
 }
 const digest=portfolioDigest(plan);if(reservations.some(p=>p.digest===digest))fail('This initialization receipt packet was already reserved.');
 return {digest,requestCount:plan.requests.length,phase:plan.phase,scope:plan.scope};
}
function replay(record){
 let state='awaiting-wallet',preparationStatus=null,initializationOperation=null,submission=null,userOperationHash=null,transactionHash=null,verification=null,observationStarted=false,readPlanReservations=[],readRequestsReserved=0,at=record.createdAt;
 if(!Array.isArray(record.observations)||record.observations.length>32)fail('This initialization history exceeds its event limit.');
 for(const event of record.observations){
  portfolioExact(event,['type','at','evidence']);if(!iso(event.at)||event.at<at)fail('Initialization history dates must stay in order.');at=event.at;
  if(event.type==='kernel-preparation-started'){
   portfolioExact(event.evidence,[]);if(state!=='awaiting-wallet'||preparationStatus!==null||initializationOperation||submission||event.at>=record.intent.expiresAt)fail('This initialization preparation was already attempted or expired.');preparationStatus='started';
  }else if(event.type==='kernel-preparation-failed'){
   portfolioExact(event.evidence,['code']);if(event.evidence.code!=='kernel_preparation_stopped'||preparationStatus!=='started'||initializationOperation)fail();preparationStatus='failed';
  }else if(event.type==='kernel-operation-prepared'){
   portfolioExact(event.evidence,['initializationOperation']);if(preparationStatus!=='started'||state!=='awaiting-wallet'||initializationOperation||submission)fail('Preserve the original initialization preparation.');initializationOperation=validateOperation(record.intent,event.evidence.initializationOperation);if(event.at>=initializationOperation.expiresAt)fail('This unsigned initialization review expired.');preparationStatus='prepared';
  }else if(event.type==='kernel-submission-reserved'){
   portfolioExact(event.evidence,['initializationReviewDigest','submission']);if(!initializationOperation||preparationStatus!=='prepared'||state!=='awaiting-wallet'||submission||event.evidence.initializationReviewDigest!==initializationOperation.initializationReviewDigest||event.at>=initializationOperation.expiresAt)fail('Reserve the exact current reviewed initialization once.');
   submission=validateKernelInitializationSubmission(record.intent,event.evidence.submission);if(submission.userOperationHash!==initializationOperation.userOperationHash||!equal(submission.userOperation,initializationOperation.userOperation))fail('This submitted initialization differs from its unsigned review.');userOperationHash=submission.userOperationHash;state='uncertain';
  }else if(event.type==='kernel-submission-acknowledged'){
   portfolioExact(event.evidence,['userOperationHash']);if(!submission||state!=='uncertain'||verification||event.evidence.userOperationHash!==userOperationHash)fail();state='pending';
  }else if(event.type==='kernel-observation-started'){
   portfolioExact(event.evidence,[]);if(!submission||observationStarted||verification)fail('This initialization observation scope was already attempted.');observationStarted=true;
  }else if(event.type==='kernel-read-plan-reserved'){
   portfolioExact(event.evidence,['plan']);if(!observationStarted||verification)fail();const retained=validateReadPlan({...record,submission},event.evidence.plan,readRequestsReserved,readPlanReservations);readPlanReservations.push(retained);readRequestsReserved+=retained.requestCount;
  }else if(event.type==='kernel-provider-observed'){
   portfolioExact(event.evidence,['retained']);if(!submission||!observationStarted||readRequestsReserved<1||verification)fail();const retained=event.evidence.retained;
   let checked;try{checked=verifyRetainedKernelInitializationObservation(record.intent,retained);}catch{fail('This retained initialization observation changed.');}
   if(!equal(checked.facts.submission,submission)||!['deployed-unfunded','failed','uncertain'].includes(checked.summary.status)||checked.observedAt>event.at)fail('This retained observation belongs to another initialization.');
   verification={...structuredClone(checked.summary),verificationSource:'historical-provider-observation',recordedStatus:checked.recordedStatus,retainedDigest:checked.retainedDigest,verification:'historical-consistency-only',currentConfirmationEstablished:false,tokenFundingEstablished:false,transferReady:false,transactionInputAuthentication:'discarded-not-reconstructed',authority:{ownerApprovalEstablished:false,signingAllowed:false,deploymentAllowed:false,submissionAllowed:false,tokenFundingEstablished:false,financialSuccessEstablished:false}};
   state=checked.summary.status;transactionHash=checked.summary.transactionHash??transactionHash;
  }else fail('This initialization history event is unsupported.');
 }
 return {state,preparationStatus,initializationOperation,submission,userOperationHash,transactionHash,verification,observationStarted,readPlanReservations,readRequestsReserved,updatedAt:at};
}
export function validateLocalKernelInitialization(record){
 bounded(record);portfolioExact(record,recordFields);
 if(record.format!=='angbao-local-kernel-initialization@1'||record.purpose!==PURPOSE||!uuid(record.id)||typeof record.imported!=='boolean'||record.provenance!=='local-unverified-initialization-review-and-history'||record.financialAuthority!==false||record.tokenFundingEstablished!==false||record.transferReady!==false||!iso(record.createdAt)||!record.imported&&record.id!==record.intent?.id||stampLocalKernelInitialization(record).digest!==record.digest)fail();
 validateKernelInitializationIntent(record.intent);validateReview(record.review,record.intent);if(record.createdAt!==record.intent.createdAt)fail();
 const expected=replay(record);for(const key of Object.keys(expected))if(!equal(record[key],expected[key]))fail('The initialization state differs from its saved history.');
 assertSafeJson(record,1);return structuredClone(record);
}
export function retainedLocalKernelInitializations(state){
 const values=state.kernelInitializations??[];if(!Array.isArray(values)||values.length>KERNEL_INITIALIZATION_LIMIT)fail('Initialization history is full.','kernel_initialization_full',409);
 const records=values.map(validateLocalKernelInitialization);for(const get of [r=>r.id,r=>r.review.id,r=>r.intent.intentDigest])if(new Set(records.map(get)).size!==records.length)fail('Keep the original unique initialization identities.');
 const accounts=new Map();for(const record of records){const group=accounts.get(record.intent.account)??[];group.push(record);accounts.set(record.intent.account,group);}
 for(const group of accounts.values()){
  if(new Set(group.map(r=>r.imported)).size!==1||new Set(group.map(r=>`${r.review.origin.installationId}:${r.review.origin.workspaceId}`)).size!==1)fail('Keep initialization reviews in their original workspace and import lineage.');
  const ordered=[...group].sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  for(let index=0;index<ordered.length-1;index++){
   const prior=ordered[index],next=ordered[index+1];
   // An imported chain is readable only as wholly imported historical content.
   // New native reviews are authorized separately by save, never by an import.
   if(prior.userOperationHash!==null||prior.submission!==null||Date.parse(prior.intent.expiresAt)>Date.parse(next.createdAt))fail('Keep the original submitted operation, or wait for an unsubmitted review to expire.');
  }
 }
 return records;
}
export function readLocalKernelInitialization(state,id){const record=retainedLocalKernelInitializations(state).find(r=>r.id===id);if(!record)fail('This exact initialization is unavailable.','kernel_initialization_not_found',404);return record;}
async function source(current){
 if(!uuid(current.localInstallation?.id)||!Number.isSafeInteger(current.localRevision)||current.localRevision<0)fail('Open the current local installation before preparing initialization.');
 return {installationId:current.localInstallation.id,workspaceId:await financialWorkspaceId('local',current.localInstallation.id),workspaceETag:`"${current.localRevision}"`};
}
async function draft(current,args,now){
 portfolioExact(args,['owner','routeEvidenceDigest']);if(!address(args.owner)||!sha(args.routeEvidenceDigest))fail('Use the exact owner EOA and trusted route evidence reference.');
 const at=clock(now),origin=await source(current),review=reviewStamp({format:'angbao-local-kernel-initialization-review@1',purpose:PURPOSE,id:randomUUID(),createdAt:at,expiresAt:new Date(now.getTime()+900000).toISOString(),owner:args.owner,routeEvidenceDigest:args.routeEvidenceDigest,origin,authentication:'unverified-local-review-intent',financialAuthority:false});
 const intent=createKernelInitializationIntent({id:randomUUID(),owner:args.owner,chainId:46630,workspaceId:origin.workspaceId,workspaceETag:origin.workspaceETag,review:{id:review.id,digest:review.digest},routeEvidenceDigest:args.routeEvidenceDigest,createdAt:at,expiresAt:review.expiresAt},{now});return {review,intent,origin};
}
/** Predicts only public standard-route terms; it performs no provider/SDK/wallet action. */
export async function previewLocalKernelInitialization(current,args,now=new Date()){
 const {review,intent,origin}=await draft(current,args,now),body={format:'angbao-local-kernel-initialization-preview@1',purpose:PURPOSE,intent,review,account:intent.account,workspaceId:origin.workspaceId,workspaceETag:origin.workspaceETag,authority:'none',signingAllowed:false,deploymentAllowed:false,submissionAllowed:false,tokenFundingEstablished:false,transferReady:false};return freeze({...body,previewDigest:portfolioDigest(body)});
}
export async function saveLocalKernelInitialization(current,args,now=new Date()){
 portfolioExact(args,['owner','routeEvidenceDigest','workspaceId','workspaceETag']);const origin=await source(current);if(args.workspaceId!==origin.workspaceId||args.workspaceETag!==origin.workspaceETag)fail('This workspace changed. Reopen the initialization preview.','kernel_initialization_stale',409);
 const records=retainedLocalKernelInitializations(current);if(records.length>=KERNEL_INITIALIZATION_LIMIT)fail('Initialization history is full. Export it before creating more.','kernel_initialization_full',409);
 const {review,intent}=await draft(current,{owner:args.owner,routeEvidenceDigest:args.routeEvidenceDigest},now);
 if(records.some(r=>r.intent.account===intent.account&&(r.imported||r.userOperationHash!==null||r.submission!==null||Date.parse(r.intent.expiresAt)>Date.parse(intent.createdAt)||r.review.origin.installationId!==review.origin.installationId||r.review.origin.workspaceId!==review.origin.workspaceId)))fail('Open the original setup. Only an expired native review with no submitted operation can be reviewed again.','kernel_initialization_exists',409);
 const record=validateLocalKernelInitialization(stampLocalKernelInitialization({format:'angbao-local-kernel-initialization@1',purpose:PURPOSE,id:intent.id,review,intent,createdAt:intent.createdAt,updatedAt:intent.createdAt,state:'awaiting-wallet',preparationStatus:null,initializationOperation:null,submission:null,userOperationHash:null,transactionHash:null,verification:null,observationStarted:false,readPlanReservations:[],readRequestsReserved:0,observations:[],imported:false,provenance:'local-unverified-initialization-review-and-history',financialAuthority:false,tokenFundingEstablished:false,transferReady:false}));
 const state=copyPortfolioArchive(current,structuredClone(current));state.kernelInitializations=[record,...records];state.updatedAt=clock(now);retainedLocalKernelInitializations(state);return {state,initializationId:record.id,initializationDigest:record.digest};
}
export const saveLocalKernelInitializationReview=saveLocalKernelInitialization;
function selected(current,args){const record=readLocalKernelInitialization(current,args.initializationId);if(record.imported||record.digest!==args.initializationDigest)fail('Reopen this initialization. Imported history cannot be resumed.','kernel_initialization_changed',409);return record;}
function append(current,record,type,evidence,now){const event={type,at:clock(now),evidence:structuredClone(evidence)},next={...record,observations:[...record.observations,event]};Object.assign(next,replay(next));const updated=validateLocalKernelInitialization(stampLocalKernelInitialization(next)),state=copyPortfolioArchive(current,structuredClone(current));state.kernelInitializations=state.kernelInitializations.map(r=>r.id===record.id?updated:r);state.updatedAt=clock(now);return {state,initializationId:updated.id,initializationDigest:updated.digest};}
export function startLocalKernelPreparation(current,args,now=new Date()){portfolioExact(args,['initializationId','initializationDigest']);return append(current,selected(current,args),'kernel-preparation-started',{},now);}
export function failLocalKernelPreparation(current,args,now=new Date()){portfolioExact(args,['initializationId','initializationDigest','code']);return append(current,selected(current,args),'kernel-preparation-failed',{code:args.code},now);}
export function saveLocalKernelOwnerOperation(current,args,now=new Date()){portfolioExact(args,['initializationId','initializationDigest','initializationOperation']);const record=selected(current,args),initializationOperation=validateOperation(record.intent,args.initializationOperation);return append(current,record,'kernel-operation-prepared',{initializationOperation},now);}
/** Caller must atomically commit this full unsigned submission before allowing a send. */
export function reserveLocalKernelSubmission(current,args,now=new Date()){portfolioExact(args,['initializationId','initializationDigest','initializationReviewDigest','submission']);return append(current,selected(current,args),'kernel-submission-reserved',{initializationReviewDigest:args.initializationReviewDigest,submission:args.submission},now);}
export function acknowledgeLocalKernelSubmission(current,args,now=new Date()){portfolioExact(args,['initializationId','initializationDigest','userOperationHash']);return append(current,selected(current,args),'kernel-submission-acknowledged',{userOperationHash:args.userOperationHash},now);}
export function startLocalKernelObservation(current,args,now=new Date()){portfolioExact(args,['initializationId','initializationDigest']);return append(current,selected(current,args),'kernel-observation-started',{},now);}
export function reserveLocalKernelReadPlan(current,args,now=new Date()){portfolioExact(args,['initializationId','initializationDigest','plan']);return append(current,selected(current,args),'kernel-read-plan-reserved',{plan:args.plan},now);}
/** Only the configured reader's original private brand can enter durable history. */
export function saveLocalKernelProviderObservation(current,args,reader,now=new Date()){
 portfolioExact(args,['initializationId','initializationDigest','observation']);const record=selected(current,args);
 const checker=reader&&Object.getOwnPropertyDescriptor(reader,'isTrustedResult');if(!checker||!Object.hasOwn(checker,'value')||typeof checker.value!=='function'||checker.value.call(reader,args.observation)!==true)fail('This is not the configured initialization reader result.','untrusted_kernel_observation',403);
 bounded(args.observation,262144);if(args.observation.readCount!==record.readRequestsReserved)fail('This initialization observation differs from its saved request scope.');
 const retained=retainVerifiedKernelInitializationObservation(record.intent,args.observation,reader);return append(current,record,'kernel-provider-observed',{retained},now);
}
