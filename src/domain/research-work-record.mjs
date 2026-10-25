/** Bounded server-owned research work snapshots. Checksums are not authenticity proofs. */
import {createHash} from 'node:crypto';
import {validateResearchMethodMemorySync} from './research-method.mjs';
export class ResearchWorkError extends Error {constructor(message,code='invalid_research_work',status=400){super(message);this.name='ResearchWorkError';this.code=code;this.status=status;}}
export const RESEARCH_WORK_LIMIT=8;
export const researchCanonical=v=>Array.isArray(v)?`[${v.map(researchCanonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${researchCanonical(v[k])}`).join(',')}}`:JSON.stringify(v);
export const researchDigest=v=>createHash('sha256').update(researchCanonical(v)).digest('hex');
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const fail=message=>{throw new ResearchWorkError(message);};
function safe(value,seen=new Set(),depth=0){
 if(depth>11)fail('Research work is too complex.');
 if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;
 if(typeof value==='string'){if(/-----BEGIN .*PRIVATE KEY|\bBearer\s+\S+|\babp_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}|\bsk-[A-Za-z0-9_-]{16,}|\bsb_secret_[A-Za-z0-9_-]+|(?:api[_-]?key|access[_-]?token|secret|authorization)\s*[=:]\s*\S+/i.test(value))fail('Remove credentials from research work.');return;}
 if((!plain(value)&&!Array.isArray(value))||seen.has(value))fail('Use plain, non-cyclic research JSON.');seen.add(value);
 for(const k of Reflect.ownKeys(value)){if(k==='length'&&Array.isArray(value))continue;const p=Object.getOwnPropertyDescriptor(value,k);if(typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)||!p?.enumerable||!Object.hasOwn(p,'value'))fail('Research work cannot contain executable or hidden properties.');safe(p.value,seen,depth+1);}seen.delete(value);
}
export function checkRetainableMemory(memory){safe({memory});if(Buffer.byteLength(JSON.stringify(memory.run))>12288)throw new ResearchWorkError('This prepared method exceeds the 12 KiB retained-run limit. Reduce evidence; nothing was saved.','research_work_too_large',413);}
export function stampResearchWork(record){const {digest,...body}=record;return {...body,digest:researchDigest(body)};}
export function validateResearchWorkRecord(record){
 safe(record);if(Buffer.byteLength(JSON.stringify(record))>28672)throw new ResearchWorkError('This method run exceeds the saved-work limit. Reduce the supplied evidence before preparing again.','research_work_too_large',413);
 if(!plain(record)||Object.keys(record).sort().join(',')!=='briefId,completedAt,createdAt,digest,format,id,memory,source'||record.format!=='angbao-research-work@1'||!uuid(record.id)||!['manual-gui','headless-cli','personal-agent-token'].includes(record.source))fail('This saved method work has invalid details. Keep the original export.');
 for(const date of [record.createdAt,...(record.completedAt===null?[]:[record.completedAt])])if(typeof date!=='string'||!Number.isFinite(Date.parse(date))||new Date(date).toISOString()!==date)fail('The saved method timestamp is invalid.');
 if(record.briefId!==null&&!uuid(record.briefId)||Boolean(record.briefId)!==Boolean(record.completedAt))fail('The method completion reference is invalid.');
 if(stampResearchWork(record).digest!==record.digest)fail('The saved method work changed. Restore the original snapshot.');
 const memory=record.memory,run=memory?.run;
 if(!plain(memory)||Object.keys(memory).sort().join(',')!=='authoredOutput,format,run'||memory.format!=='angbao-research-method-memory@1'||!plain(run)||run.format!=='angbao-research-method-run@1')fail('Keep the complete method memory envelope.');
 if(Buffer.byteLength(JSON.stringify(run))>12288)throw new ResearchWorkError('This prepared method exceeds the 12 KiB retained-run limit. Reduce the supplied evidence; nothing was saved.','research_work_too_large',413);
 const {runId,runDigest,...payload}=run;if(runId!==`research-run-${runDigest}`||!/^[a-f0-9]{64}$/.test(runDigest)||researchDigest(payload)!==runDigest)fail('The original method run digest no longer matches.');
 if(record.briefId===null&&memory.authoredOutput!==null||record.briefId!==null&&(!plain(memory.authoredOutput)||memory.authoredOutput.runReference?.runId!==runId||memory.authoredOutput.runReference?.runDigest!==runDigest))fail('The authored result must refer to this exact method run.');
 if(!run.truth||Object.entries(run.truth).some(([key,value])=>key==='sourceContentIsUntrustedData'?value!==true:value!==false))fail('Research work cannot grant authority or claim independent verification.');
 validateResearchMethodMemorySync(memory);
 return structuredClone(record);
}
export function retainedResearchWork(state){const works=state.researchMethodWorks??[];if(!Array.isArray(works)||works.length>RESEARCH_WORK_LIMIT)fail('The saved method-work list is invalid.');const checked=works.map(validateResearchWorkRecord);if(new Set(checked.map(v=>v.id)).size!==checked.length)fail('Saved method work IDs must be unique.');return checked;}
export function readResearchWork(state,id){if(!uuid(id))fail('Choose the exact saved method work.');const record=retainedResearchWork(state).find(item=>item.id===id);if(!record)throw new ResearchWorkError('This method work is no longer retained. Another run was not substituted.','research_work_not_found',404);return record;}
export function researchWorkReference(record){return {workId:record.id,runId:record.memory.run.runId,runDigest:record.memory.run.runDigest};}
export function checkResearchWorkReference(ref){if(!plain(ref)||Object.keys(ref).sort().join(',')!=='runDigest,runId,workId'||!uuid(ref.workId)||!/^[a-f0-9]{64}$/.test(ref.runDigest)||ref.runId!==`research-run-${ref.runDigest}`)fail('This brief has an invalid method reference.');return structuredClone(ref);}

export function assertResearchPortableCapacity(state){
 const keys=['workspace','inputMode','goals','cash','rules','agentConnected','onboardingDone','installedStrategies','strategyDrafts','schedule','reviewRuns','reviewDecisions','reviewFeedback','researchBriefs','researchMethodWorks','portfolioWorks'];
 if(Buffer.byteLength(JSON.stringify(Object.fromEntries(keys.map(key=>[key,state[key]]))))>1024*1024-2048)throw new ResearchWorkError('This save would exceed the portable-workspace limit. Export and review retained work before adding more.','research_work_full',413);
}
