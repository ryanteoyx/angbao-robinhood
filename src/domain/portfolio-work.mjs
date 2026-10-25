/** Explicit local-only proposal preview/save. No financial context or settings mutation. */
import {preparePortfolioDecisionSync,validatePortfolioDecisionSync,createPortfolioSourceSync,portfolioInstrumentReferenceSync} from './portfolio-decision.mjs';
import {PortfolioWorkError,portfolioExact,portfolioCanonical,stampPortfolioWork,validatePortfolioWorkRecord,retainedPortfolioWork,readPortfolioWork,PORTFOLIO_WORK_LIMIT,comparePortfolioWork,copyPortfolioArchive,allPortfolioWork} from './portfolio-work-record.mjs';
import {createLocalManifest} from './local-continuity.mjs';
export const LOCAL_PORTFOLIO_FACTS=Object.freeze({localOnly:true,signupRequired:false,providerCalls:false,modelCalls:false,financialAuthority:false,ownerApprovalObtained:false,ordersSubmitted:false,scheduled:false,fundsReserved:false,inputsVerified:false});
export function previewPortfolioWork(state,args){
 portfolioExact(args,['input','previousWorkId'],['input']);
 if(args.previousWorkId){const previous=readPortfolioWork(state,args.previousWorkId);if(portfolioCanonical(args.input?.policy)!==portfolioCanonical(previous.decision.snapshots.policy))throw new PortfolioWorkError('Allocation targets or limits changed. Keep the earlier proposal; a separate owner policy review is required before sizing.','portfolio_policy_change_pending',409);}
 const decision=preparePortfolioDecisionSync(args.input);
 // Validate the complete retained wrapper before returning a preview we could not save.
 const probe=stampPortfolioWork({format:'angbao-local-portfolio-work@1',id:'00000000-0000-4000-8000-000000000001',createdAt:new Date().toISOString(),source:'headless-cli',previousWorkRef:null,decision});validatePortfolioWorkRecord(probe);
 return {decision,...(args.previousWorkId?{previousWorkId:args.previousWorkId}:{}),saved:false,capabilityTruth:LOCAL_PORTFOLIO_FACTS};
}
export function savePortfolioWork(current,args,now=new Date(),context={}){
 portfolioExact(args,['decision','previousWorkId'],['decision']);const decision=validatePortfolioDecisionSync(args.decision,{expectedDigest:args.decision?.decisionDigest}),works=retainedPortfolioWork(current);
 if(works.length>=PORTFOLIO_WORK_LIMIT)throw new PortfolioWorkError('Saved portfolio proposals are full. Archive an older proposal to keep saving for free. Your history remains available.','portfolio_work_full',409);
 let previousWorkRef=null;if(args.previousWorkId){const previous=readPortfolioWork(current,args.previousWorkId);previewPortfolioWork(current,{input:{method:{id:decision.method.id,version:decision.method.version},asOf:decision.asOf,...decision.snapshots},previousWorkId:previous.id});previousWorkRef={id:previous.id,decisionDigest:previous.decision.decisionDigest};}
 if(allPortfolioWork(current).some(work=>work.decision.decisionDigest===decision.decisionDigest))throw new PortfolioWorkError('This exact proposal is already saved. Open it instead of adding a duplicate.','portfolio_work_exists',409);
 const work=validatePortfolioWorkRecord(stampPortfolioWork({format:context.researchHandoff?'angbao-local-portfolio-work@2':'angbao-local-portfolio-work@1',...(context.researchHandoff?{researchHandoff:structuredClone(context.researchHandoff)}:{}),id:crypto.randomUUID(),createdAt:now.toISOString(),source:context.transport==='headless-cli'?'headless-cli':'manual-gui',previousWorkRef,decision:structuredClone(decision)}));
 const state=copyPortfolioArchive(current,structuredClone(current));state.portfolioWorks=[work,...works];state.updatedAt=now.toISOString();
 if(!state.portfolioArchive?.entries.length)createLocalManifest(state,now); // Exact full portable wrapper/schema/1 MiB budget, before commit.
 const ledgerProbe={...state,localReplayReceipts:[{result:{workId:work.id,workDigest:work.digest}},...(state.localReplayReceipts??[])]};if(Buffer.byteLength(JSON.stringify(ledgerProbe))>1900*1024)throw new PortfolioWorkError('This save would fill the local workspace. Export and review retained work first.','portfolio_work_full',413);
 return {state,workId:work.id,workDigest:work.digest,comparison:comparePortfolioWork(state,work)};
}
export function readPortfolioWorkResult(state,id){if(!id)return {works:retainedPortfolioWork(state).map(work=>({id:work.id,createdAt:work.createdAt,status:work.decision.status,reason:work.decision.reason,source:work.decision.snapshots.portfolio?.source??'missing',currency:work.decision.snapshots.portfolio?.currency??null,previousWorkRef:work.previousWorkRef})),capabilityTruth:LOCAL_PORTFOLIO_FACTS};const work=readPortfolioWork(state,id);return {work,comparison:comparePortfolioWork(state,work),capabilityTruth:LOCAL_PORTFOLIO_FACTS};}
export function intakePortfolioSource(input){return {source:createPortfolioSourceSync(input),saved:false,capabilityTruth:LOCAL_PORTFOLIO_FACTS};}
export function identifyPortfolioInstrument(input){return {reference:portfolioInstrumentReferenceSync(input),saved:false,capabilityTruth:LOCAL_PORTFOLIO_FACTS};}
