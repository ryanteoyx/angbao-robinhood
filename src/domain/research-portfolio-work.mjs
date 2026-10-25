/** Free one-shot manual flow over exact saved research. No fetch/model or changed financial context. */
import {readResearchBrief} from './research-briefs.mjs';
import {readResearchWork,researchCanonical} from './research-work-record.mjs';
import {prepareResearchPortfolioHandoff,ResearchPortfolioBridgeError} from './research-portfolio-bridge.mjs';
import {validateRetainedResearchPortfolio} from './research-portfolio-retention.mjs';
import {portfolioExact,stampPortfolioWork,validatePortfolioWorkRecord,readPortfolioWork,comparePortfolioWork} from './portfolio-work-record.mjs';
import {previewPortfolioWork,savePortfolioWork,LOCAL_PORTFOLIO_FACTS} from './portfolio-work.mjs';
const sourceKeys=['sourceId','version','channel','capture','contentKind','url','text','publishedAt','observedAt'];
export function previewSavedResearchPortfolio(state,args){
 portfolioExact(args,['briefId','expectedBriefDigest','researchWorkId','expectedResearchWorkDigest','evidenceBindings','assessment','portfolio','policy','asOf','previousWorkId'],['briefId','expectedBriefDigest','evidenceBindings','assessment','portfolio','policy','asOf']);
 const brief=readResearchBrief(state,args.briefId),hasWork=args.researchWorkId!==undefined||args.expectedResearchWorkDigest!==undefined,work=hasWork?readResearchWork(state,args.researchWorkId):null;
 const handoff=prepareResearchPortfolioHandoff({brief,expectedBriefDigest:args.expectedBriefDigest,evidenceBindings:args.evidenceBindings,assessment:args.assessment,portfolio:args.portfolio,policy:args.policy,asOf:args.asOf,...(hasWork?{researchWork:work,expectedResearchWorkDigest:args.expectedResearchWorkDigest}:{})});
 let previousWorkRef=null,comparison={status:'first-proposal',changes:[],amounts:null};
 if(args.previousWorkId){previewPortfolioWork(state,{input:handoff.input,previousWorkId:args.previousWorkId});const previous=readPortfolioWork(state,args.previousWorkId);previousWorkRef={id:previous.id,decisionDigest:previous.decision.decisionDigest};comparison=comparePortfolioWork(state,{previousWorkRef,decision:handoff.decision});}
 validatePortfolioWorkRecord(stampPortfolioWork({format:'angbao-local-portfolio-work@2',id:'00000000-0000-4000-8000-000000000001',createdAt:new Date().toISOString(),source:'headless-cli',previousWorkRef,decision:handoff.decision,researchHandoff:handoff}));
 return {handoff,decision:handoff.decision,comparison,...(args.previousWorkId?{previousWorkId:args.previousWorkId}:{}),saved:false,capabilityTruth:LOCAL_PORTFOLIO_FACTS};
}
export function saveResearchPortfolio(current,args,now=new Date(),context={}){
 portfolioExact(args,['handoff','previousWorkId'],['handoff']);const h=validateRetainedResearchPortfolio(args.handoff,args.handoff?.decision);
 const evidenceBindings=h.sourceMapping.map(m=>{const source=h.input.sources.find(s=>s.sourceId===m.sourceRef.sourceId);return {evidenceId:m.evidenceId,source:Object.fromEntries(sourceKeys.map(k=>[k,source[k]])),...(m.workCardRef?{workCardRef:Object.fromEntries(['packDigest','provider','recordId'].map(k=>[k,m.workCardRef[k]]))}:{})};});
 const rebuilt=previewSavedResearchPortfolio(current,{briefId:h.researchRef.recordId,expectedBriefDigest:h.researchRef.digest,...(h.researchWorkRef?{researchWorkId:h.researchWorkRef.recordId,expectedResearchWorkDigest:h.researchWorkRef.digest}:{}),evidenceBindings,assessment:h.input.assessment,portfolio:h.input.portfolio,policy:h.input.policy,asOf:h.input.asOf,...(args.previousWorkId?{previousWorkId:args.previousWorkId}:{})});
 if(researchCanonical(rebuilt.handoff)!==researchCanonical(h))throw new ResearchPortfolioBridgeError('The linked research preview changed. Reopen its exact saved version before saving.','research_portfolio_snapshot_changed',409);
 return savePortfolioWork(current,{decision:h.decision,...(args.previousWorkId?{previousWorkId:args.previousWorkId}:{})},now,{...context,researchHandoff:h});
}
