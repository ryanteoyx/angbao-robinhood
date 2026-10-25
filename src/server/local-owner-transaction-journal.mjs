/** One canonical local EOA journal. No wallet, RPC, salt, scheduler or nonce allocator. */
import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {absolute,ownedDirectory,physical,withSetupLock} from '../../cli/setup-state.mjs';
import {portfolioExact,portfolioCanonical} from '../domain/portfolio-work-record.mjs';
import {bounded,DIRECT_PURPOSE,robinhoodEoaTransferRecordAdapter} from './robinhood-eoa-transfer-record.mjs';
const V1='angbao-owner-funded-transfers@1',V2='angbao-owner-transactions@2',MAX=1048576,brands=new WeakMap();
const same=(a,b)=>portfolioCanonical(a)===portfolioCanonical(b),copy=v=>{bounded(v,MAX);return structuredClone(v);};
const sha=v=>createHash('sha256').update(v).digest('hex');
const unchanged=(a,b)=>['dev','ino','mode','uid','gid','nlink','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/.test(v);
export class OwnerTransactionJournalError extends Error{constructor(code){super('The owner transaction journal stopped. Preserve its original state for recovery.');this.name='OwnerTransactionJournalError';this.code=code;}}
const fail=code=>{throw new OwnerTransactionJournalError(code);};
const sync=value=>{if(value&&typeof value.then==='function'){value.catch?.(()=>{});fail('journal_async_reducer');}return value;};
export const isLocalOwnerTransactionJournal=(value,directory)=>brands.get(value)===directory;
export function createLocalOwnerTransactionJournal({directory,purposeAdapters=[],checkpoint=async()=>{}}={}){
 absolute(directory);if(!Array.isArray(purposeAdapters)||typeof checkpoint!=='function')fail('journal_configuration');
 const adapters=new Map();
 for(const adapter of [robinhoodEoaTransferRecordAdapter,...purposeAdapters]){
  if(!adapter||!id(adapter.purpose)||adapters.has(adapter.purpose)||['validateRecord','reservationOf','assertTransition'].some(k=>typeof adapter[k]!=='function'))fail('journal_configuration');
  adapters.set(adapter.purpose,Object.freeze({validateRecord:adapter.validateRecord,reservationOf:adapter.reservationOf,assertTransition:adapter.assertTransition}));
 }
 const file=path.join(directory,'owner-funded-transfers.json');let closed=false,uncertain=false,queue=Promise.resolve();
 const ready=(write=false)=>{if(closed)fail('journal_closed');if(write&&uncertain)fail('journal_commit_uncertain');};
 const adapterFor=purpose=>adapters.get(purpose)??fail('journal_unknown_purpose');
 function reservation(record){
  const value=sync(adapterFor(record.purpose).reservationOf(copy(record)));if(value===null)return null;
  const r=copy(value);portfolioExact(r,['chainId','owner','nonce','transactionDigest','challengeId']);
  if(r.chainId!==46630||typeof r.owner!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(r.owner)||/^0x0{40}$/.test(r.owner)||typeof r.nonce!=='string'||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(r.nonce)||BigInt(r.nonce)>(1n<<64n)-2n||!/^([a-f0-9]{64})$/.test(r.transactionDigest)||!id(r.challengeId))fail('journal_invalid_reservation');
  return {...r,owner:r.owner.toLowerCase(),nonce:BigInt(r.nonce).toString()};
 }
 function validateRecord(record){
  bounded(record,MAX);if(!id(record.id)||!id(record.purpose)||typeof record.digest!=='string'||!/^[a-f0-9]{64}$/.test(record.digest))fail('journal_invalid_record');
  sync(adapterFor(record.purpose).validateRecord(copy(record)));return record;
 }
 function validate(data){
  bounded(data,MAX);portfolioExact(data,['format','records']);
  if(![V1,V2].includes(data.format)||!Array.isArray(data.records)||data.records.length>20)fail('journal_invalid');
  const ids=new Set(),slots=new Set();
  for(const row of data.records){validateRecord(row);if(ids.has(row.id)||data.format===V1&&row.purpose!==DIRECT_PURPOSE)fail('journal_invalid');ids.add(row.id);const r=reservation(row);if(r){const key=`${r.chainId}:${r.owner}:${r.nonce}`;if(slots.has(key))fail('direct_nonce_reserved');slots.add(key);}}
  return data;
 }
 async function privateDirectory(){const s=await ownedDirectory(directory);if((s.mode&0o777)!==0o700)fail('journal_private_directory');return s;}
 async function snapshot(){
  ready();const parent=await privateDirectory();let handle;
  try{
   const named=await physical(file,{missing:true});if(!named)fail('journal_missing');
   const valid=s=>s.isFile()&&s.nlink===1&&s.uid===process.getuid()&&(s.mode&0o777)===0o600&&s.size<=MAX;
   if(!valid(named))fail('journal_private_file');
   handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const before=await handle.stat();if(!valid(before)||!unchanged(named,before))fail('journal_changed');
   const buffer=Buffer.alloc(MAX+1);let size=0;while(size<buffer.length){const {bytesRead}=await handle.read(buffer,size,buffer.length-size,null);if(!bytesRead)break;size+=bytesRead;}
   const after=await handle.stat(),end=await fs.lstat(file),endParent=await privateDirectory();
   if(size>MAX||size!==after.size||!valid(after)||!valid(end)||!unchanged(before,after)||!unchanged(after,end)||parent.dev!==endParent.dev||parent.ino!==endParent.ino)fail('journal_changed');
   const bytes=buffer.subarray(0,size),data=validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
   return {data,sha:sha(bytes),stat:end,parent:endParent};
  }catch(error){if(error instanceof OwnerTransactionJournalError||error?.code==='direct_nonce_reserved')throw error;fail('journal_invalid');}finally{await handle?.close();}
 }
 function transition(previous,next){
  validateRecord(next);
  if(previous){
   if(previous.id!==next.id||previous.purpose!==next.purpose)fail('journal_identity_changed');
   const held=reservation(previous);if(held&&!same(held,reservation(next)))fail('direct_nonce_reserved');
   if(Object.hasOwn(previous,'transactionHash')&&previous.transactionHash!==null&&next.transactionHash!==previous.transactionHash)fail('journal_hash_changed');
  }
  sync(adapterFor(next.purpose).assertTransition(previous&&copy(previous),copy(next)));
 }
 async function persist(previous,data){
  validate(data);const bytes=Buffer.from(JSON.stringify(data));if(bytes.length>MAX)fail('journal_capacity');
  const tmp=path.join(directory,'.direct-'+randomUUID()+'.tmp');let handle,renamed=false;
  try{
   await checkpoint('before-temp');ready(true);
   handle=await fs.open(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await handle.writeFile(bytes);
   await checkpoint('before-temp-fsync');await handle.sync();await handle.close();handle=null;
   await checkpoint('temp-durable');ready(true);
   const current=await snapshot();if(current.sha!==previous.sha||!unchanged(current.stat,previous.stat)||current.parent.dev!==previous.parent.dev||current.parent.ino!==previous.parent.ino)fail('journal_changed');
   ready(true);await fs.rename(tmp,file);renamed=true;await checkpoint('renamed');
   const parent=await fs.open(directory,constants.O_RDONLY);try{await parent.sync();}finally{await parent.close();}
   await checkpoint('parent-durable');
   const saved=await snapshot();if(!same(saved.data,data))fail('journal_changed');await checkpoint('before-return');return saved.data;
  }catch(error){if(renamed){uncertain=true;fail('journal_commit_uncertain');}throw error;}finally{await handle?.close();await fs.unlink(tmp).catch(()=>{});}
 }
 function enqueue(work){ready(true);const run=queue.then(async()=>{ready(true);await privateDirectory();return withSetupLock(directory,async()=>{ready(true);return work();});});queue=run.catch(()=>{});return run;}
 function selected(value,keys){const input=copy(value);portfolioExact(input,keys);adapterFor(input.purpose);if(Object.hasOwn(input,'id')&&!id(input.id))fail('journal_invalid_record');return input;}
 const journal=Object.freeze({
  // Explicit provisioning creates only an absent file, never repairs or clears one.
  provision(){return enqueue(async()=>{await privateDirectory();if(await physical(file,{missing:true}))fail('journal_exists');let handle,created=false;try{handle=await fs.open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;await handle.writeFile(JSON.stringify({format:V1,records:[]}));await handle.sync();await handle.close();handle=null;const parent=await fs.open(directory,constants.O_RDONLY);try{await parent.sync();}finally{await parent.close();}await snapshot();}catch(error){if(created){uncertain=true;fail('journal_commit_uncertain');}throw error;}finally{await handle?.close();}});},
  async list(value){const {purpose}=selected(value,['purpose']);return copy((await snapshot()).data.records.filter(r=>r.purpose===purpose));},
  async read(value){const {purpose,id}=selected(value,['purpose','id']),row=(await snapshot()).data.records.find(r=>r.id===id&&r.purpose===purpose);if(!row)fail('journal_not_found');return copy(row);},
  create(value){const {purpose,record}=selected(value,['purpose','record']);if(record.purpose!==purpose)fail('journal_identity_changed');validateRecord(record);return enqueue(async()=>{
   const before=await snapshot(),old=before.data.records.find(r=>r.id===record.id);if(old){if(!same(old,record))fail('journal_conflict');return copy(old);}transition(null,record);
   if(before.data.records.length>=20)fail('journal_capacity');const data={format:before.data.format===V2||purpose!==DIRECT_PURPOSE?V2:V1,records:[copy(record),...before.data.records]};await persist(before,data);return copy(record);
  });},
  // Compatibility seam for existing local reducers. The reducer sees only this
  // purpose, cannot delete/reorder existing records or change more than one row.
  updatePurpose(value,reducer){const {purpose}=selected(value,['purpose']);if(typeof reducer!=='function')fail('journal_configuration');return enqueue(async()=>{
   const before=await snapshot(),original=before.data.records.filter(r=>r.purpose===purpose),rows=copy(original),rawResult=sync(reducer(rows)),result=rawResult===undefined?undefined:copy(rawResult);
   if(rows.length<original.length||rows.length>original.length+1||new Set(rows.map(r=>r.id)).size!==rows.length||rows.some(r=>r.purpose!==purpose)||original.some(r=>!rows.some(n=>n.id===r.id)))fail('journal_identity_changed');
   const retainedOrder=rows.filter(r=>original.some(o=>o.id===r.id)).map(r=>r.id);if(!same(retainedOrder,original.map(r=>r.id)))fail('journal_identity_changed');
   const changed=rows.filter(r=>!same(r,original.find(o=>o.id===r.id)??null));if(changed.length>1)fail('journal_multiple_changes');
   if(!changed.length)return result;
   const next=copy(changed[0]),old=original.find(r=>r.id===next.id)??null;transition(old,next);
   const data=copy(before.data);
   if(old)data.records[data.records.findIndex(r=>r.id===old.id)]=next;
   else {if(data.records.some(r=>r.id===next.id))fail('journal_conflict');if(data.records.length>=20)fail('journal_capacity');data.records.unshift(next);if(purpose!==DIRECT_PURPOSE)data.format=V2;}
   await persist(before,data);return result;
  });},
  change(value,reducer){const {purpose,id,expectedDigest}=selected(value,['purpose','id','expectedDigest']);if(typeof reducer!=='function'||typeof expectedDigest!=='string'||!/^[a-f0-9]{64}$/.test(expectedDigest))fail('journal_configuration');return enqueue(async()=>{
   const before=await snapshot(),index=before.data.records.findIndex(r=>r.id===id&&r.purpose===purpose);if(index<0)fail('journal_not_found');const old=before.data.records[index];if(old.digest!==expectedDigest)fail('journal_conflict');
   const next=copy(sync(reducer(copy(old))));transition(old,next);if(same(old,next))return copy(old);const data=copy(before.data);data.records[index]=next;await persist(before,data);return copy(next);
  });},
  close(){closed=true;}
 });brands.set(journal,directory);return journal;
}
