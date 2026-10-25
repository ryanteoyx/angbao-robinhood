/** Private request reservations only. No endpoint, RPC parameter, wallet or workspace data. */
import {createHash,randomUUID} from 'node:crypto';
import {readFile,open,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {absolute,ownedDirectory,physical,withSetupLock} from '../../cli/setup-state.mjs';
const LIMITS={totalRequests:20,preparationRequests:7,submissionRequests:1,observationRequests:12,responseBytes:131072,observationPacketBytes:1048576,requestTimeoutMs:5000,packetTimeoutMs:30000};
const METHODS={prepare:{'execution:eth_chainId':1,'execution:eth_getCode':1,'execution:eth_call':1,'bundler:zd_getUserOperationGasPrice':1,'bundler:eth_estimateUserOperationGas':1,'paymaster:zd_sponsorUserOperation':2},submit:{'bundler:eth_sendUserOperation':1},observe:{'bundler:eth_getUserOperationReceipt':1,'chain:eth_chainId':1,'chain:eth_getTransactionByHash':1,'chain:eth_getTransactionReceipt':1,'chain:eth_getBlockByNumber':2,'chain:eth_blockNumber':1,'chain:eth_call':3,'chain:eth_getBalance':1,'chain:eth_getLogs':1}};
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw Error();const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]?.enumerable||!Object.hasOwn(ds[k],'value')))throw Error();};
function validate(record){
 exact(record,['format','contextId','intentDigest','phase','role','method','occurrence','maximumOccurrences','requestKey','limits']);exact(record.limits,Object.keys(LIMITS));
 const maximum=METHODS[record.phase]?.[`${record.role}:${record.method}`];
 if(record.format!=='angbao-owner-runtime-request-reservation@1'||typeof record.contextId!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(record.contextId)||typeof record.intentDigest!=='string'||!/^[a-f0-9]{64}$/.test(record.intentDigest)||!maximum||record.maximumOccurrences!==maximum||!Number.isInteger(record.occurrence)||record.occurrence<1||record.occurrence>maximum||canonical(record.limits)!==canonical(LIMITS))throw Error();
 const key=createHash('sha256').update(canonical({contextId:record.contextId,intentDigest:record.intentDigest,phase:record.phase,role:record.role,method:record.method,occurrence:record.occurrence})).digest('hex');if(record.requestKey!==key)throw Error();
 return structuredClone(record);
}
function checkHistory(records){
 if(!Array.isArray(records)||records.length>1280)throw Error();const counts=new Map(),keys=new Set(),scopes=new Set(),contexts=new Map();
 for(const record of records){validate(record);if(keys.has(record.requestKey))throw Error();keys.add(record.requestKey);const scope=record.intentDigest; if(contexts.has(scope)&&contexts.get(scope)!==record.contextId)throw Error();contexts.set(scope,record.contextId);const method=`${scope}:${record.phase}:${record.role}:${record.method}`;scopes.add(scope);if(scopes.size>64)throw Error();
  const n=(counts.get(method)||0)+1;if(n!==record.occurrence)throw Error();counts.set(method,n);
  for(const [key,cap] of [[scope,20],[`${scope}:${record.phase}`,record.phase==='prepare'?7:record.phase==='submit'?1:12]]){const used=(counts.get(key)||0)+1;if(used>cap)throw Error();counts.set(key,used);}
 }return keys;
}
/** Directory must already be a dedicated private owned physical directory. Factory performs no I/O. */
export function createOwnerRuntimeBudget({directory}={}){
 absolute(directory);const file=path.join(directory,'owner-request-budget.json');
 return Object.freeze({async reserveRequest(input){
  // Denial deliberately reveals neither file paths nor supplied metadata.
  try{
   const record=validate(input),info=await ownedDirectory(directory);if(info.mode&0o077)return false;
   return await withSetupLock(directory,async()=>{
    let records=[];const saved=await physical(file,{missing:true});
    if(saved){if(!saved.isFile()||saved.uid!==process.getuid()||saved.mode&0o077||saved.size>512*1024)return false;const body=JSON.parse(await readFile(file,'utf8'));exact(body,['format','records']);if(body.format!=='angbao-owner-runtime-budget@1')return false;records=body.records;}
    const keys=checkHistory(records);if(keys.has(record.requestKey))return false;
    const next=[...records,record];checkHistory(next);const bytes=JSON.stringify({format:'angbao-owner-runtime-budget@1',records:next});if(Buffer.byteLength(bytes)>512*1024)return false;
    const temporary=path.join(directory,`.owner-budget-${randomUUID()}.tmp`);let handle;
    try{handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await rename(temporary,file);const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}}
    finally{await handle?.close();await unlink(temporary).catch(()=>{});}
    return true;
   });
  }catch{return false;}
 }});
}
