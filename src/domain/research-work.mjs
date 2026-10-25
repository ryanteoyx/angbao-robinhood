/** Complete supplied-evidence work loop. No fetch, inference, schedule or financial action. */
import {prepareResearchMethodRun,repeatResearchMethodRun,createResearchMethodMemory,validateResearchMethodMemory} from './research-method.mjs';
import {saveResearchBrief,validateResearchBriefInput,retainedResearchBriefs} from './research-briefs.mjs';
import {readResearchWork,retainedResearchWork,validateResearchWorkRecord,stampResearchWork,researchWorkReference,ResearchWorkError,RESEARCH_WORK_LIMIT,assertResearchPortableCapacity,checkRetainableMemory} from './research-work-record.mjs';
const fail=(message,code='invalid_research_work',status=400)=>{throw new ResearchWorkError(message,code,status);};
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('Use only the documented method-work fields.');}
export async function prepareResearchWork(state,args){exact(args,['input','previousWorkId']);let run;if(args.previousWorkId!==undefined){const previous=readResearchWork(state,args.previousWorkId);if(!previous.briefId)fail('Finish the selected answer before repeating its method.','research_work_incomplete',409);run=await repeatResearchMethodRun(previous.memory.run,args.input);}else run=await prepareResearchMethodRun(args.input);if(Buffer.byteLength(JSON.stringify(run))>12288)fail('This prepared method exceeds the 12 KiB retained-run limit. Reduce the supplied evidence; nothing was saved.','research_work_too_large',413);const memory=await createResearchMethodMemory(run);checkRetainableMemory(memory);return {memory,saved:false,providerCalls:false,modelCalls:false,financialAuthority:false};}
export async function savePreparedResearchWork(current,args,now=new Date(),context={}){
 exact(args,['memory']);const memory=await validateResearchMethodMemory(args.memory);if(memory.authoredOutput!==null)fail('Save the prepared run first, then preview a separate answer.');
 const works=retainedResearchWork(current);if(works.length>=RESEARCH_WORK_LIMIT)fail('Saved method work is full. Export and review retained work before adding more.','research_work_full',409);
 if(works.some(item=>item.memory.run.runDigest===memory.run.runDigest))fail('This exact method run is already saved. Open that work instead of creating a duplicate.','research_work_exists',409);
 const record=validateResearchWorkRecord(stampResearchWork({format:'angbao-research-work@1',id:crypto.randomUUID(),createdAt:now.toISOString(),completedAt:null,source:context.transport==='personal-agent'?'personal-agent-token':context.transport==='headless-cli'?'headless-cli':'manual-gui',memory:structuredClone(memory),briefId:null}));
 const state=structuredClone(current);state.researchMethodWorks=[record,...works];state.updatedAt=now.toISOString();assertResearchPortableCapacity(state);return {state,workId:record.id,workDigest:record.digest};
}
export async function previewResearchWorkBrief(state,args){
 exact(args,['workId','brief']);const work=readResearchWork(state,args.workId);if(work.briefId!==null)fail('This work already has a saved answer. Prepare a repeat for a new version.','research_work_completed',409);
 const input=validateResearchBriefInput(args.brief),{previousVersionId,baselineId,...authored}=input;
 const memory=await createResearchMethodMemory(work.memory.run,authored,{expectedRunDigest:work.memory.run.runDigest});
 const baseline=work.memory.run.baseline;
 if(!baseline&&(previousVersionId||baselineId))fail('Prepare a repeat of the selected work before linking an earlier answer.','research_work_baseline_mismatch',409);
 if(baseline){const matches=retainedResearchWork(state).filter(item=>item.memory.run.runId===baseline.runId&&item.memory.run.runDigest===baseline.runDigest);const previous=matches.length===1?matches[0]:null;if(!previous?.briefId)fail('The selected earlier method answer is unavailable. Keep that missing baseline explicit.','research_work_baseline_missing',409);if(previousVersionId!==previous.briefId||baselineId!==previous.briefId)fail('A repeat must retain the selected earlier answer and baseline.','research_work_baseline_mismatch',409);}
 return {workId:work.id,runDigest:work.memory.run.runDigest,briefInput:input,memory,saved:false,verification:'unverified'};
}
export async function completeResearchWork(current,args,now=new Date(),context={}){
 const preview=await previewResearchWorkBrief(current,args),work=readResearchWork(current,args.workId);
 const result=saveResearchBrief(current,preview.briefInput,now,{...context,methodWorkId:work.id});result.brief.methodRunRef=researchWorkReference(work);retainedResearchBriefs(result.state);
 const completed=validateResearchWorkRecord(stampResearchWork({...work,memory:structuredClone(preview.memory),briefId:result.brief.id,completedAt:now.toISOString()}));
 result.state.researchMethodWorks=retainedResearchWork(current).map(item=>item.id===work.id?completed:item);assertResearchPortableCapacity(result.state);return {...result,workId:completed.id,workDigest:completed.digest};
}
