import {copyPortfolioArchive} from './portfolio-work-record.mjs';
/** Local review intent is not authenticated consent. Wallet signatures remain authority. */
import {randomUUID} from 'node:crypto';
import {ApiError,assertSafeJson} from './angbao.mjs';
import {readPortfolioWork,portfolioExact,portfolioDigest} from './portfolio-work-record.mjs';
import {financialWorkspaceId} from './financial-handoff.mjs';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const fail=(message,code='invalid_submission_review',status=400)=>{throw new ApiError(status,code,message);};
export const SUBMISSION_REVIEW_LIMIT=10;
export const REVIEW_INTENT_CHOICES=Object.freeze(['prepare-test-transfer','decline']);
export function stampSubmissionReview(value){const {digest,...body}=value;return {...body,digest:portfolioDigest(body)};}
export function validateTransferDetails(value){
 portfolioExact(value,['goalId','chainId','account','token','recipient','amountAtomic']);portfolioExact(value.token,['address','decimals','symbol']);
 const address=v=>typeof v==='string'&&/^0x[a-f0-9]{40}$/.test(v)&&!/^0x0{40}$/.test(v);
 if(typeof value.goalId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value.goalId)||value.chainId!==46630||!address(value.account)||!address(value.recipient)||!address(value.token.address)||value.account===value.recipient||value.token.address===value.account||value.token.address===value.recipient||!Number.isInteger(value.token.decimals)||value.token.decimals<0||value.token.decimals>18||typeof value.token.symbol!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,11}$/.test(value.token.symbol)||typeof value.amountAtomic!=='string'||!/[1-9]/.test(value.amountAtomic)||!/^[1-9][0-9]{0,77}$/.test(value.amountAtomic)||BigInt(value.amountAtomic)>2n**256n-1n)fail('Enter the exact test token, sending account, recipient and positive amount in its smallest units.');
 return structuredClone(value);
}
export function validateSubmissionReview(value){
 portfolioExact(value,['format','id','createdAt','expiresAt','origin','localWorkId','choice','transferDetails','imported','authentication','financialAuthority','digest']);
 portfolioExact(value.origin,['installationId','workspaceId','workspaceETag','workId','workDigest','decisionDigest']);
 if(value.format!=='angbao-local-submission-review@1'||!uuid(value.id)||!uuid(value.localWorkId)||!uuid(value.origin.installationId)||!uuid(value.origin.workId)||!hash(value.origin.workDigest)||!hash(value.origin.decisionDigest)||!/^local:[a-f0-9]{64}$/.test(value.origin.workspaceId)||!/^"(?:0|[1-9]\d*)"$/.test(value.origin.workspaceETag)||!iso(value.createdAt)||!iso(value.expiresAt)||Date.parse(value.expiresAt)-Date.parse(value.createdAt)!==15*60*1000||!REVIEW_INTENT_CHOICES.includes(value.choice)||typeof value.imported!=='boolean'||value.authentication!=='unverified-local-review-intent'||value.financialAuthority!==false||stampSubmissionReview(value).digest!==value.digest)fail('This review record is incomplete or changed. Keep the original saved work.');
 if(value.choice==='decline'){if(value.transferDetails!==null)fail('A declined review cannot contain a transfer.');}else validateTransferDetails(value.transferDetails);
 assertSafeJson(value,3);if(Buffer.byteLength(JSON.stringify(value))>8192)fail('This review record exceeds the local limit.');return structuredClone(value);
}
export function retainedSubmissionReviews(state){
 const records=state.submissionReviews??[];if(!Array.isArray(records)||records.length>SUBMISSION_REVIEW_LIMIT)fail('The saved review list exceeds its limit.');
 const checked=records.map(validateSubmissionReview);if(new Set(checked.map(item=>item.id)).size!==checked.length)fail('Saved review IDs must be unique.');
 for(const record of checked){const work=readPortfolioWork(state,record.localWorkId);if(work.decision.decisionDigest!==record.origin.decisionDigest||!record.imported&&(work.id!==record.origin.workId||work.digest!==record.origin.workDigest))fail('This review no longer matches its complete saved proposal.');}return checked;
}
export function readSubmissionReview(state,id){const record=retainedSubmissionReviews(state).find(item=>item.id===id);if(!record)fail('This saved review is unavailable. Another review was not substituted.','submission_review_not_found',404);return record;}
export async function saveSubmissionReview(current,args,now=new Date()){
 portfolioExact(args,['workId','workDigest','decisionDigest','choice','transferDetails']);const work=readPortfolioWork(current,args.workId);
 if(work.digest!==args.workDigest||work.decision.decisionDigest!==args.decisionDigest)fail('The selected proposal changed. Reopen it before reviewing.','submission_review_selection_changed',409);
 if(!REVIEW_INTENT_CHOICES.includes(args.choice))fail('Choose whether to prepare a test transfer or decline.');
 const transferDetails=args.choice==='decline'?null:validateTransferDetails(args.transferDetails);if(args.choice==='decline'&&args.transferDetails!==null)fail('Decline without preparing a transfer.');if(transferDetails&&!current.goals.some(goal=>goal.id===transferDetails.goalId))fail('Choose a current goal before reviewing this test transfer.');
 const records=retainedSubmissionReviews(current);if(records.length>=SUBMISSION_REVIEW_LIMIT)fail('Saved review history is full. Export it before adding more.','submission_review_full',409);
 const record=validateSubmissionReview(stampSubmissionReview({format:'angbao-local-submission-review@1',id:randomUUID(),createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+15*60*1000).toISOString(),origin:{installationId:current.localInstallation.id,workspaceId:await financialWorkspaceId('local',current.localInstallation.id),workspaceETag:`"${current.localRevision}"`,workId:work.id,workDigest:work.digest,decisionDigest:work.decision.decisionDigest},localWorkId:work.id,choice:args.choice,transferDetails,imported:false,authentication:'unverified-local-review-intent',financialAuthority:false}));
 const state=copyPortfolioArchive(current,structuredClone(current));state.submissionReviews=[record,...records];state.updatedAt=now.toISOString();return {state,reviewId:record.id,reviewDigest:record.digest};
}
/** An imported/expired/declined review can be read, but can never prepare another action. */
export async function selectedActionReview(state,{reviewId,reviewDigest},now=new Date()){
 const record=readSubmissionReview(state,reviewId);
 if(record.digest!==reviewDigest||record.imported||record.choice!=='prepare-test-transfer'||Date.parse(record.expiresAt)<=now.getTime()||record.origin.installationId!==state.localInstallation.id||record.origin.workspaceId!==await financialWorkspaceId('local',state.localInstallation.id)||state.localRevision!==Number(record.origin.workspaceETag.slice(1,-1))+1)fail('Reopen the current proposal and review it again before preparing a transfer.','submission_review_stale',409);
 return record;
}
