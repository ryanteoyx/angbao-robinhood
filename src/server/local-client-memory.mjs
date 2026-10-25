/** Exact free-local reads, independent from hosted PAT scopes and financial authority. */
import {LocalClientAccessError} from './local-client-access.mjs';
import {collectMemoryCandidates} from './financial-memory-binding.mjs';
import {financialWorkspaceId} from '../domain/financial-handoff.mjs';
import {adaptFinancialRecord,validateFinancialMemoryReference} from '../domain/financial-memory-contract.mjs';
import {createFinancialMemoryResolver} from '../domain/financial-memory-resolver.mjs';
import {canonicalLocalJson} from '../domain/local-continuity.mjs';
const fail=(code,status=403)=>{throw new LocalClientAccessError(code,status);};
export async function createLocalClientMemoryBinding({access,readState,historyStore,now=()=>new Date()}){
  if(typeof access?.authorize!=='function'||typeof readState!=='function'||typeof historyStore?.isUncertain!=='function'||typeof now!=='function')fail('local_memory_configuration',503);
  const binding=access.binding;
  const scope={ownerId:binding.ownerId,workspaceId:await financialWorkspaceId('local',binding.installationId)};
  const time=()=>{const date=now();if(!(date instanceof Date)||!Number.isFinite(date.getTime()))fail('local_memory_clock_invalid',503);return date;};
  const certainty=()=>{if(historyStore.isUncertain())fail('archive_commit_uncertain',503);};
  return Object.freeze({async resolveExact(token,reference,options={}){
    // Authenticate before inspecting or resolving record data; supplied scope never authorizes.
    access.authorize(token);
    const ref=validateFinancialMemoryReference(reference);
    const required=[ref.kind==='portfolio'?'portfolio:read':'research:read'];
    access.authorize(token,required);
    if(ref.ownerId!==scope.ownerId||ref.workspaceId!==scope.workspaceId)fail('local_memory_scope_mismatch',403);
    if(!options||typeof options!=='object'||Array.isArray(options)||![Object.prototype,null].includes(Object.getPrototypeOf(options)))fail('invalid_local_memory_options',400);
    const descriptors=Object.getOwnPropertyDescriptors(options);
    if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string'||!['maxAgeMs','expectedETag'].includes(key)||!descriptors[key].enumerable||!Object.hasOwn(descriptors[key],'value')))fail('invalid_local_memory_options',400);
    // Capture own data scalars before the first await; never consult the caller object again.
    const maxAgeMs=descriptors.maxAgeMs?.value,expectedETag=descriptors.expectedETag?.value;
    if(maxAgeMs!==undefined&&(!Number.isSafeInteger(maxAgeMs)||maxAgeMs<0)||expectedETag!==undefined&&(typeof expectedETag!=='string'||!/^"(?:0|[1-9]\d*)"$/.test(expectedETag)))fail('invalid_local_memory_options',400);
    async function snapshot(){
      access.authorize(token,required);certainty();
      const state=await readState();
      certainty();access.authorize(token,required);
      if(state.localInstallation?.id!==binding.installationId||!Number.isSafeInteger(state.localRevision)||state.localRevision<0)fail('local_memory_workspace_changed',409);
      const etag=`"${state.localRevision}"`;
      if(expectedETag!==undefined&&expectedETag!==etag)fail('revision_conflict',412);
      const records=collectMemoryCandidates(state,{kind:ref.kind,recordId:ref.recordId});
      return {etag,candidates:records.map(record=>adaptFinancialRecord(ref.kind,record,scope))};
    }
    const first=await snapshot();
    access.authorize(token,required);certainty();
    const resolver=createFinancialMemoryResolver({scope,lookup:async()=>first.candidates});
    const result=await resolver.resolveExact(ref,maxAgeMs===undefined?{}:{now:time().toISOString(),maxAgeMs});
    access.authorize(token,required);certainty();
    const final=await snapshot();
    const changed=canonicalLocalJson(first.candidates)!==canonicalLocalJson(final.candidates);
    if(Buffer.byteLength(JSON.stringify(result))>300*1024)fail('local_memory_response_too_large',413);
    // Last checks are synchronous, after all awaits. No hidden save or validateResult effect.
    certainty();access.authorize(token,required);
    const current=time().getTime();
    if(changed)return {status:'mismatch',reason:'retained-record-changed',etag:final.etag};
    if(result.freshness==='fresh'&&(current<Date.parse(result.freshnessWindow.validFrom)||current>Date.parse(result.freshnessWindow.validThrough)))return {status:'mismatch',reason:'freshness-window-elapsed',etag:final.etag};
    return {...result,etag:final.etag};
  }});
}
