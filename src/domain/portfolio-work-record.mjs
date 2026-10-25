import {validateRetainedResearchPortfolio} from './research-portfolio-retention.mjs';
/** Local portfolio proposals are immutable unverified snapshots, never approval. */
import {createHash} from 'node:crypto';
import {assertSafeJson} from './angbao.mjs';
import {validatePortfolioDecisionSync} from './portfolio-decision.mjs';
export const PORTFOLIO_WORK_LIMIT=5;
const ARCHIVE_CACHE=Symbol.for('angbao.local.portfolio.archive');
/** Private hydrated records; never serialized into the active workspace or trusted from clients. */
export function attachPortfolioArchive(state,records=[]){Object.defineProperty(state,ARCHIVE_CACHE,{value:records,configurable:true});return state;}
export function copyPortfolioArchive(from,to){return attachPortfolioArchive(to,from?.[ARCHIVE_CACHE]??[]);}
export function archivedPortfolioWork(state){return (state[ARCHIVE_CACHE]??[]).map(validatePortfolioWorkRecord);}
export function allPortfolioWork(state){const all=[...retainedPortfolioWork(state),...archivedPortfolioWork(state)];if(new Set(all.map(r=>r.id)).size!==all.length||new Set(all.map(r=>r.decision.decisionDigest)).size!==all.length)fail('Active and archived proposals conflict. Keep the original files.','archive_conflict',409);return all;}
export const PORTFOLIO_WORK_BYTES=48*1024;
export class PortfolioWorkError extends Error {constructor(message,code='invalid_portfolio_work',status=400){super(message);this.name='PortfolioWorkError';this.code=code;this.status=status;}}
const fail=(message,code,status)=>{throw new PortfolioWorkError(message,code,status);};
export const portfolioCanonical=value=>Array.isArray(value)?`[${value.map(portfolioCanonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${portfolioCanonical(value[key])}`).join(',')}}`:JSON.stringify(value);
export const portfolioDigest=value=>createHash('sha256').update(portfolioCanonical(value)).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export function portfolioExact(value,keys,required=keys){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('Use the documented portfolio-work fields.');
 const desc=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(desc).some(key=>typeof key!=='string'||!keys.includes(key)||!desc[key].enumerable||!Object.hasOwn(desc[key],'value'))||required.some(key=>!Object.hasOwn(desc,key)))fail('Keep the complete portfolio-work schema without hidden or executable fields.');
}
export function stampPortfolioWork(record){const {digest,...body}=record;return {...body,digest:portfolioDigest(body)};}
export function validatePortfolioWorkRecord(record){
 portfolioExact(record,['format','id','createdAt','source','previousWorkRef','decision','digest',...(record.format==='angbao-local-portfolio-work@2'?['researchHandoff']:[])]);
 if(!['angbao-local-portfolio-work@1','angbao-local-portfolio-work@2'].includes(record.format)||!uuid(record.id)||!['manual-gui','headless-cli'].includes(record.source)||typeof record.createdAt!=='string'||!Number.isFinite(Date.parse(record.createdAt))||new Date(record.createdAt).toISOString()!==record.createdAt)fail('The saved portfolio proposal has invalid details. Keep the original export.');
 if(record.previousWorkRef!==null){portfolioExact(record.previousWorkRef,['id','decisionDigest']);if(!uuid(record.previousWorkRef.id)||record.previousWorkRef.id===record.id||!/^[a-f0-9]{64}$/.test(record.previousWorkRef.decisionDigest))fail('Choose the exact earlier saved portfolio proposal.');}
 validatePortfolioDecisionSync(record.decision,{expectedDigest:record.decision?.decisionDigest});
 if(record.format==='angbao-local-portfolio-work@2')validateRetainedResearchPortfolio(record.researchHandoff,record.decision);
 assertSafeJson(record,record.format==='angbao-local-portfolio-work@2'?0:3);
 if(Buffer.byteLength(JSON.stringify(record))>PORTFOLIO_WORK_BYTES)fail('This proposal exceeds the 48 KiB saved-work limit. Create a smaller research version or assessment and preview it again. Keep the original sources; nothing was saved.','portfolio_work_too_large',413);
 if(stampPortfolioWork(record).digest!==record.digest)fail('The saved portfolio proposal changed. Keep its original snapshot.');
 return structuredClone(record);
}
export function retainedPortfolioWork(state){
 const works=state.portfolioWorks??[];if(!Array.isArray(works)||works.length>PORTFOLIO_WORK_LIMIT)fail('The saved portfolio-work list is invalid.');const checked=works.map(validatePortfolioWorkRecord);if(new Set(checked.map(item=>item.id)).size!==checked.length)fail('Saved portfolio-work IDs must be unique.');if(new Set(checked.map(item=>item.decision.decisionDigest)).size!==checked.length)fail('An identical portfolio proposal is already retained. Inspect it instead of duplicating it.','portfolio_work_exists',409);
 for(const work of checked){const previous=work.previousWorkRef&&checked.find(item=>item.id===work.previousWorkRef.id);if(previous){if(previous.decision.decisionDigest!==work.previousWorkRef.decisionDigest)fail('The retained portfolio baseline differs from its selected reference.');if(portfolioCanonical(previous.decision.snapshots.policy)!==portfolioCanonical(work.decision.snapshots.policy))fail('Changed owner targets cannot silently become a repeat.','portfolio_policy_change_pending',409);}}
 for(const work of checked){const visited=new Set([work.id]);let next=work.previousWorkRef;while(next){if(visited.has(next.id))fail('Portfolio history cannot contain a cycle.');visited.add(next.id);next=checked.find(item=>item.id===next.id)?.previousWorkRef;}}
 return checked;
}
export function readPortfolioWork(state,id){if(!uuid(id))fail('Choose an exact saved portfolio proposal.');const work=allPortfolioWork(state).find(item=>item.id===id);if(!work)fail('This proposal is no longer retained. A different proposal was not substituted.','portfolio_work_not_found',404);return work;}
export function comparePortfolioWork(state,work){
 if(!work.previousWorkRef)return {status:'first-proposal',changes:[],amounts:null};
 const previous=allPortfolioWork(state).find(item=>item.id===work.previousWorkRef.id);if(!previous)return {status:'baseline-unavailable',changes:[],amounts:null};
 const before=previous.decision,after=work.decision,changes=[];
 for(const [key,label] of [['sources','Supplied sources'],['assessment','Agent assessment'],['portfolio','Portfolio values'],['policy','Allocation targets and limits']])if(portfolioCanonical(before.snapshots[key])!==portfolioCanonical(after.snapshots[key]))changes.push({key,label});
 const comparable=before.method.id===after.method.id&&before.method.version===after.method.version&&before.plan&&after.plan&&before.plan.currency===after.plan.currency&&before.plan.minorUnitExponent===after.plan.minorUnitExponent;
 return {status:comparable?'comparable':'inputs-require-review',baselineId:previous.id,changes,amounts:comparable?{currency:after.plan.currency,minorUnitExponent:after.plan.minorUnitExponent,before:before.plan.investmentMinor,after:after.plan.investmentMinor,change:after.plan.investmentMinor-before.plan.investmentMinor}:null};
}
