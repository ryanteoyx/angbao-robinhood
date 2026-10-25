/** Server-only binding. Neither references nor local candidate helpers grant access. */
import {bearerDigest,agentOrigin} from './personal-agent-access.mjs';
import {AgentAccessError} from './personal-agent-store.mjs';
import {financialWorkspaceId} from '../domain/financial-handoff.mjs';
import {adaptFinancialRecord,validateFinancialMemoryReference} from '../domain/financial-memory-contract.mjs';
import {createFinancialMemoryResolver} from '../domain/financial-memory-resolver.mjs';
import {retainedResearchWork} from '../domain/research-work-record.mjs';
import {retainedResearchBriefs} from '../domain/research-briefs.mjs';
import {allPortfolioWork,archivedPortfolioWork,copyPortfolioArchive} from '../domain/portfolio-work-record.mjs';
import {hydrateArchive} from '../domain/local-history-archive.mjs';
import {canonicalLocalJson} from '../domain/local-continuity.mjs';
const fail=(code,status=503)=>{throw new AgentAccessError(code,status);};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
// PostgreSQL timestamptz JSON uses offsets and may retain microseconds.
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
function exact(value,allowed,required=allowed){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('invalid_arguments',400);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string'||!allowed.includes(key)||!descriptors[key].enumerable||!Object.hasOwn(descriptors[key],'value'))||required.some(key=>!Object.hasOwn(descriptors,key)))fail('invalid_arguments',400);
}
function selection(value){exact(value,['kind','recordId']);if(!['research-method','research-brief','portfolio'].includes(value.kind)||!uuid(value.recordId))fail('invalid_arguments',400);}
/** Trusted runtime snapshot only; callers must enforce the local owner boundary first. */
export function collectMemoryCandidates(runtimeSnapshot,selected){
  selection(selected);
  // Archive records are nonenumerable and are lost by structuredClone alone.
  const snapshot=copyPortfolioArchive(runtimeSnapshot,structuredClone(runtimeSnapshot));
  let records;
  if(selected.kind==='portfolio'){
    hydrateArchive(snapshot,archivedPortfolioWork(snapshot)); // index/cache correspondence and graph
    records=allPortfolioWork(snapshot);
  }else records=selected.kind==='research-method'?retainedResearchWork(snapshot):retainedResearchBriefs(snapshot);
  return records.filter(record=>record.id===selected.recordId);
}
/** No new reader/writer: consume the existing runtime's hydrated snapshot and uncertainty flag. */
export async function readLocalMemoryCandidates({readState,historyStore},selected){
  selection(selected);
  if(typeof readState!=='function'||typeof historyStore?.isUncertain!=='function')fail('access_unavailable');
  const check=()=>{if(historyStore.isUncertain())fail('archive_commit_uncertain');};
  check();const snapshot=await readState();check();
  return collectMemoryCandidates(snapshot,selected);
}
function rowState(row){
  if(!Number.isSafeInteger(row?.revision)||row.revision<0||!row.envelope?.state||typeof row.envelope.state!=='object')fail('access_unavailable');
  return row.envelope.state;
}
function clock(now){const date=now();if(!(date instanceof Date)||!Number.isFinite(date.getTime()))fail('access_unavailable');return date;}
/** `store`, config and clock are trusted server composition, never request parameters.
 * Owns exactly one authorize accounting call; do not wrap with a second authorize. */
export function createPersonalAgentMemoryBinding({store,config,now=()=>new Date()}){
  if(typeof store?.authorize!=='function'||typeof store?.read!=='function'||typeof now!=='function')fail('access_unavailable');
  const trustedConfig=Object.freeze({...config}),origin=agentOrigin(trustedConfig);
  return Object.freeze({async resolveRequest(request,args){
    const digest=bearerDigest(request,trustedConfig);
    if(new URL(request.url).origin!==origin)fail('origin_rejected',403);
    const grant=await store.authorize(digest);
    if(!uuid(grant?.id)||!uuid(grant?.ownerId)||!timestamp(grant?.expiresAt)||grant.revokedAt!==null||!Array.isArray(grant.scopes))fail('invalid_token',401);
    if(!grant.scopes.includes('research:read'))fail('insufficient_scope',403);
    if(Date.parse(grant.expiresAt)<=clock(now).getTime())fail('invalid_token',401);
    exact(args,['reference','maxAgeMs'],['reference']);
    const ref=validateFinancialMemoryReference(args.reference);
    if(!['research-method','research-brief'].includes(ref.kind))fail('insufficient_scope',403);
    if(args.maxAgeMs!==undefined&&(!Number.isSafeInteger(args.maxAgeMs)||args.maxAgeMs<0))fail('invalid_arguments',400);
    const scope={ownerId:grant.ownerId,workspaceId:await financialWorkspaceId('hosted',`${origin}:${grant.ownerId}`)};
    if(ref.ownerId!==scope.ownerId||ref.workspaceId!==scope.workspaceId)fail('insufficient_scope',403);
    const selected={kind:ref.kind,recordId:ref.recordId};
    const firstRow=await store.read(digest,'research:read');
    const candidates=collectMemoryCandidates(rowState(firstRow),selected).map(record=>adaptFinancialRecord(ref.kind,record,scope));
    const resolver=createFinancialMemoryResolver({scope,lookup:async()=>candidates});
    const result=await resolver.resolveExact(ref,args.maxAgeMs===undefined?{}:{now:clock(now).toISOString(),maxAgeMs:args.maxAgeMs});
    // RPC read revalidates revocation, expiry, audience and scope without another request debit.
    const finalRow=await store.read(digest,'research:read');
    const finalCandidates=collectMemoryCandidates(rowState(finalRow),selected).map(record=>adaptFinancialRecord(ref.kind,record,scope));
    // No await after the final read. A replaced/removed record cannot escape on an old snapshot.
    const changed=canonicalLocalJson(candidates)!==canonicalLocalJson(finalCandidates);
    const currentTime=clock(now).getTime();
    if(currentTime>=Date.parse(grant.expiresAt))fail('invalid_token',401);
    const etag=`"${finalRow.revision}"`;
    if(changed)return {status:'mismatch',reason:'retained-record-changed',etag};
    if(result.freshness==='fresh'){
      const window=result.freshnessWindow;
      if(currentTime<Date.parse(window.validFrom)||currentTime>Date.parse(window.validThrough))return {status:'mismatch',reason:'freshness-window-elapsed',etag};
    }
    return {...result,etag};
  }});
}
