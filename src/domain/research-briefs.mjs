import {checkResearchWorkReference} from './research-work-record.mjs';
/** Private authored synthesis only. No fetching, model inference, execution or provider verification. */
export const RESEARCH_BRIEF_LIMITS = Object.freeze({ versions:20,bytes:12288,question:500,answer:3000,evidence:12,claims:12,inferences:8,gaps:8 });
export const RESEARCH_MEMORY_FACTS = Object.freeze({ structuredMemory:true,verification:'unverified',providerVerified:false,hostedModel:false,providerCalls:false,financialAuthority:false,financialExecution:false,onchain:false,retention:'Keeps the latest 20 saved versions. Retry records may contain older copies; this is not a complete history or proof ledger.' });
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
export class ResearchBriefError extends Error { constructor(message,code='invalid_research_brief',status=400){super(message);this.name='ResearchBriefError';this.code=code;this.status=status;} }
const reject=(message,code,status)=>{throw new ResearchBriefError(message,code,status);};
function exact(value,keys){if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key)||['__proto__','constructor','prototype'].includes(key)))reject('This brief includes an unsupported field. Use only the documented brief fields.');}
function text(value,max,empty=false){
 if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))reject('Research text must fit the field limit and use plain text.');
 if(/-----BEGIN .*PRIVATE KEY|\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{16,}|\bsb_secret_[A-Za-z0-9_-]+|\babp_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}|(?:api[_-]?key|access[_-]?token|secret|authorization)\s*[=:]\s*\S+/i.test(value))reject('Remove passwords, access tokens and keys before saving this brief.');
 return value.trim();
}
function id(value){if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value))reject('Give each source and claim an ID of 1 to 64 letters, numbers, hyphens or underscores, starting with a letter or number.');return value;}
function uuid(value){if(typeof value!=='string'||!UUID.test(value))reject('Use the exact UUID of a saved research version for this reference.');return value;}
function date(value){if(value===undefined||value===null)return null;if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)reject('Use an ISO source timestamp, such as 2026-10-24T00:00:00.000Z, or null if the time is unknown.');return value;}
function list(value,max){if(!Array.isArray(value)||value.length>max)reject('A list in this brief exceeds its item limit. Shorten it before saving.');return value;}
function citation(value){
 text(value,2000);let url;try{url=new URL(value);}catch{reject('Add a public HTTPS link for each source.');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.')||/^\d+(?:\.\d+){3}$/.test(url.hostname)||url.hostname.includes(':')||/\.(?:localhost|local|internal)$/i.test(url.hostname)||[...url.searchParams.keys()].some(key=>/token|key|secret|auth|signature|credential/i.test(key)))reject('Use public HTTPS source links without passwords, tokens or access keys.');
 return url.href;
}
function content(input){
 exact(input,['question','answer','authorship','evidence','claims','inferences','gaps','previousVersionId','baselineId']);
 if(!['agent-authored','imported'].includes(input.authorship))reject('Set authorship to agent-authored or imported. Either choice remains unverified.');
 const evidence=list(input.evidence,12).map(item=>{exact(item,['id','title','url','publishedAt','observedAt','excerpt']);return{id:id(item.id),title:text(item.title,160),url:citation(item.url),publishedAt:date(item.publishedAt),observedAt:date(item.observedAt),excerpt:text(item.excerpt??'',600,true),provenance:'imported-unverified'};});
 const evidenceIds=new Set(evidence.map(item=>item.id));if(evidenceIds.size!==evidence.length)reject('Give each source a different ID.');
 const claims=list(input.claims,12).map(item=>{exact(item,['id','stance','text','evidenceIds']);if(!['supporting','contradicting'].includes(item.stance))reject('Mark each claim as supporting or contradicting.');const refs=list(item.evidenceIds,12).map(id);if(!refs.length||new Set(refs).size!==refs.length||refs.some(ref=>!evidenceIds.has(ref)))reject('Link each claim to one or more source IDs in this brief. Do not repeat an ID.');return{id:id(item.id),stance:item.stance,text:text(item.text,700),evidenceIds:refs};});
 const claimIds=new Set(claims.map(item=>item.id));if(claimIds.size!==claims.length)reject('Give each claim a different ID.');
 const inferences=list(input.inferences,8).map(item=>{exact(item,['text','claimIds']);const refs=list(item.claimIds,12).map(id);if(new Set(refs).size!==refs.length||refs.some(ref=>!claimIds.has(ref)))reject('Link inferences only to claim IDs in this brief. Do not repeat an ID.');return{text:text(item.text,700),claimIds:refs};});
 return{question:text(input.question,500),answer:text(input.answer,3000),authorship:input.authorship,evidence,claims,inferences,gaps:list(input.gaps,8).map(value=>text(value,500))};
}
function reference(brief){return{kind:'research-brief',id:brief.id,seriesId:brief.seriesId,version:brief.version};}
function checkedRef(value){exact(value,['kind','id','seriesId','version']);if(value.kind!=='research-brief'||!Number.isSafeInteger(value.version)||value.version<1)reject('This saved brief reference is invalid. Use its original version ID and number.');uuid(value.id);uuid(value.seriesId);return value;}
function checkBytes(value){if(new TextEncoder().encode(JSON.stringify(value)).length>12288)reject('This research brief exceeds 12 KiB. Shorten it before saving.','research_brief_too_large',413);}
export function validateResearchBriefInput(input){content(input);if(input.previousVersionId!==undefined)uuid(input.previousVersionId);if(input.baselineId!==undefined)uuid(input.baselineId);checkBytes(input);return structuredClone(input);}
export function retainedResearchBriefs(state){
 const values=state.researchBriefs;if(values===undefined)return[];list(values,20);const ids=new Set();
 for(const brief of values){
  exact(brief,['id','seriesId','version','createdAt','question','answer','authorship','evidence','claims','inferences','gaps','verification','source','agentAccess','previousVersionRef','baseline','methodRunRef']);
  uuid(brief.id);uuid(brief.seriesId);if(ids.has(brief.id)||!Number.isSafeInteger(brief.version)||brief.version<1||!date(brief.createdAt)||brief.verification!=='unverified'||!['manual-gui','personal-agent-token','headless-cli'].includes(brief.source))reject('This saved research version has invalid details and cannot be opened. Keep your original export for recovery.');ids.add(brief.id);
  const evidence=brief.evidence.map(item=>{exact(item,['id','title','url','publishedAt','observedAt','excerpt','provenance']);if(item.provenance!=='imported-unverified')reject('Imported sources must stay marked as unverified.');const {provenance,...fields}=item;return fields;});
  content({question:brief.question,answer:brief.answer,authorship:brief.authorship,evidence,claims:brief.claims,inferences:brief.inferences,gaps:brief.gaps});
  if(brief.previousVersionRef!==null)checkedRef(brief.previousVersionRef);
  if(brief.baseline!==null){exact(brief.baseline,['reference','snapshot']);checkedRef(brief.baseline.reference);exact(brief.baseline.snapshot,['question','answerPreview','createdAt','verification']);text(brief.baseline.snapshot.question,500);text(brief.baseline.snapshot.answerPreview,500);date(brief.baseline.snapshot.createdAt);if(brief.baseline.snapshot.verification!=='unverified')reject('The comparison version must stay marked as unverified.');}
  if(brief.source==='personal-agent-token'){exact(brief.agentAccess,['grantId','harnessIdentity']);uuid(brief.agentAccess.grantId);if(brief.agentAccess.harnessIdentity!=='unverified')reject('The agent\'s identity must stay marked as unverified.');}else if(brief.agentAccess!==undefined)reject('Agent access details can only be added by the authenticated agent connection. Remove them from imported briefs.');
  if(brief.methodRunRef!==undefined)checkResearchWorkReference(brief.methodRunRef);
  checkBytes(brief);
 }
 return structuredClone(values);
}
export function listResearchBriefs(state){return retainedResearchBriefs(state).map(brief=>({id:brief.id,seriesId:brief.seriesId,version:brief.version,createdAt:brief.createdAt,question:brief.question,answerPreview:brief.answer.slice(0,240),authorship:brief.authorship,verification:brief.verification,source:brief.source,evidenceCount:brief.evidence.length,claimCounts:{supporting:brief.claims.filter(c=>c.stance==='supporting').length,contradicting:brief.claims.filter(c=>c.stance==='contradicting').length}}));}
export function readResearchBrief(state,briefId){uuid(briefId);const brief=retainedResearchBriefs(state).find(item=>item.id===briefId);if(!brief)reject('This research version is no longer saved in your workspace. Choose one from the saved versions.','research_brief_not_found',404);return brief;}
export function saveResearchBrief(current,input,now=new Date(),context={}){
 const normalized=content(input),retained=retainedResearchBriefs(current);
 if(retained.length>=20)reject('This workspace reached its 20-version research safety bound. Export and keep this workspace before continuing elsewhere. Nothing was removed; no paid plan is required.','research_memory_full',409);
 const previous=input.previousVersionId===undefined?null:readResearchBrief(current,input.previousVersionId);
 if(previous&&retained.some(item=>item.seriesId===previous.seriesId&&item.version>previous.version))reject('A newer version is already saved. Open the latest version before saving another update.','research_version_conflict',409);
 if(previous?.methodRunRef&&!context.methodWorkId)reject('Repeat the saved research approach before creating its next answer.','research_method_required',409);
 const baseline=input.baselineId===undefined?null:readResearchBrief(current,input.baselineId);
 const personalAgent=context.transport==='personal-agent'&&typeof context.grantId==='string'&&UUID.test(context.grantId);
 const brief={id:crypto.randomUUID(),seriesId:previous?.seriesId??crypto.randomUUID(),version:(previous?.version??0)+1,createdAt:now.toISOString(),...normalized,verification:'unverified',source:personalAgent?'personal-agent-token':context.transport==='headless-cli'?'headless-cli':'manual-gui',...(personalAgent?{agentAccess:{grantId:context.grantId,harnessIdentity:'unverified'}}:{}),previousVersionRef:previous?reference(previous):null,baseline:baseline?{reference:reference(baseline),snapshot:{question:baseline.question,answerPreview:baseline.answer.slice(0,500),createdAt:baseline.createdAt,verification:'unverified'}}:null};
 checkBytes(brief);const state=structuredClone(current);state.researchBriefs=[brief,...retained];state.updatedAt=now.toISOString();return{brief,state,capabilityTruth:RESEARCH_MEMORY_FACTS};
}
