/** Private durable Kernel-creation request reservations. No URLs, RPC payloads, signatures or grant records. */
import {createHash,randomUUID} from 'node:crypto';
import {readFile,open,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {absolute,ownedDirectory,physical,withSetupLock} from '../../cli/setup-state.mjs';
import {KERNEL_RUNTIME_LIMITS,KERNEL_RUNTIME_CEILINGS} from './kernel-runtime-adapter.mjs';

const PURPOSE='kernel-account-initialization';
const MAX_RECORDS=64*KERNEL_RUNTIME_LIMITS.totalRequests,MAX_BYTES=512*1024;
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw Error();const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]?.enumerable||!Object.hasOwn(ds[k],'value')))throw Error();}
function validate(record){
 exact(record,['format','purpose','contextId','intentDigest','phase','role','method','occurrence','maximumOccurrences','requestKey','limits']);exact(record.limits,Object.keys(KERNEL_RUNTIME_LIMITS));
 const maximum=KERNEL_RUNTIME_CEILINGS[record.phase]?.[`${record.role}:${record.method}`];
 if(record.format!=='angbao-kernel-runtime-request-reservation@1'||record.purpose!==PURPOSE||typeof record.contextId!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(record.contextId)||typeof record.intentDigest!=='string'||!/^[a-f0-9]{64}$/.test(record.intentDigest)||!maximum||record.maximumOccurrences!==maximum||!Number.isSafeInteger(record.occurrence)||record.occurrence<1||record.occurrence>maximum||canonical(record.limits)!==canonical(KERNEL_RUNTIME_LIMITS))throw Error();
 const key=createHash('sha256').update(canonical({purpose:PURPOSE,contextId:record.contextId,intentDigest:record.intentDigest,phase:record.phase,role:record.role,method:record.method,occurrence:record.occurrence})).digest('hex');if(record.requestKey!==key)throw Error();
 return structuredClone(record);
}
function history(records){
 if(!Array.isArray(records)||records.length>MAX_RECORDS)throw Error();const counts=new Map(),keys=new Set(),contexts=new Map();
 for(const record of records){
  validate(record);if(keys.has(record.requestKey))throw Error();keys.add(record.requestKey);
  const scope=record.intentDigest;if(contexts.has(scope)&&contexts.get(scope)!==record.contextId)throw Error();contexts.set(scope,record.contextId);if(contexts.size>64)throw Error();
  const method=`${scope}:${record.phase}:${record.role}:${record.method}`,occurrence=(counts.get(method)||0)+1;if(occurrence!==record.occurrence)throw Error();counts.set(method,occurrence);
  const phaseCap=record.phase==='prepare'?KERNEL_RUNTIME_LIMITS.preparationRequests:record.phase==='submit'?KERNEL_RUNTIME_LIMITS.submissionRequests:KERNEL_RUNTIME_LIMITS.observationRequests;
  for(const [key,cap]of [[scope,KERNEL_RUNTIME_LIMITS.totalRequests],[`${scope}:${record.phase}`,phaseCap]]){const used=(counts.get(key)||0)+1;if(used>cap)throw Error();counts.set(key,used);}
 }
 return keys;
}
/** Factory performs no I/O. Directory must already be private, owned and physical.
 * This journal is a same-UID server trust boundary, not protection against its owner rewriting files.
 * A failed request retains its reservation; replay is never fresh network permission.
 */
export function createKernelRuntimeBudget({directory}={}){
 absolute(directory);const file=path.join(directory,'kernel-request-budget.json');
 return Object.freeze({async reserveRequest(input){
  try{
   const record=validate(input),info=await ownedDirectory(directory);if(info.mode&0o077)return false;
   return await withSetupLock(directory,async()=>{
    let records=[];const saved=await physical(file,{missing:true});
    if(saved){if(!saved.isFile()||saved.uid!==process.getuid()||saved.mode&0o077||saved.size>MAX_BYTES)return false;const body=JSON.parse(await readFile(file,'utf8'));exact(body,['format','records']);if(body.format!=='angbao-kernel-runtime-budget@1')return false;records=body.records;}
    const keys=history(records);if(keys.has(record.requestKey))return false;
    const next=[...records,record];history(next);const bytes=JSON.stringify({format:'angbao-kernel-runtime-budget@1',records:next});if(Buffer.byteLength(bytes)>MAX_BYTES)return false;
    const temporary=path.join(directory,`.kernel-budget-${randomUUID()}.tmp`);let handle;
    try{handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await rename(temporary,file);const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}}
    finally{await handle?.close();await unlink(temporary).catch(()=>{});}
    return true;
   });
  }catch{return false;}
 }});
}
