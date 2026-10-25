import {lstatSync} from 'node:fs';
import path from 'node:path';
/** Durable disclosure/consent only: never a provider admission or budget engine. */
import { readPrivateJson, privateJsonTransaction, privateDirectory, LocalElfaFilesError } from './local-elfa-private-files.mjs';
import { localElfaPolicyDigest } from './local-elfa-operator.mjs';
const fail=(code='local_consent_unavailable')=>{throw new LocalElfaFilesError(code);};
const copy=value=>{localElfaPolicyDigest(value);return structuredClone(value);};
export function createLocalElfaConsentStore({file,binding,readWorkspaceBinding,now=()=>new Date()}={}) {
  if(typeof binding?.preview!=='function'||typeof readWorkspaceBinding!=='function'||typeof now!=='function')fail();
  const currentTime=()=>{const t=new Date(now()).getTime();if(!Number.isFinite(t))fail();return t;};
  const identity=()=>copy(readWorkspaceBinding());
  const state=(raw,owner)=>{
    if(raw===null)return {format:'angbao-local-elfa-consents@1',workspace:owner,revision:0,records:[]};
    if(!raw||Object.keys(raw).sort().join(',')!=='format,records,revision,workspace'||raw.format!=='angbao-local-elfa-consents@1'||localElfaPolicyDigest(raw.workspace)!==localElfaPolicyDigest(owner)||!Number.isSafeInteger(raw.revision)||raw.revision<0||!Array.isArray(raw.records)||raw.records.length>256)fail();
    const ids=new Set();for(const row of raw.records){if(!row||Object.keys(row).sort().join(',')!=='digest,preview,status'||!['preview','approved','revoked'].includes(row.status)||localElfaPolicyDigest(row.preview)!==row.digest||ids.has(row.preview.operationId))fail();ids.add(row.preview.operationId);}
    return raw;
  };
  const fresh=p=>{if(p?.format!=='angbao-local-elfa-preview@1'||p.consent?.approved!==false||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=currentTime())fail();};
  const mutate=(owner,fn)=>privateJsonTransaction(file,raw=>{const s=state(raw,owner);const result=fn(s);if(s.revision>=Number.MAX_SAFE_INTEGER)fail();s.revision++;return {value:s,result};});
  function readStatus({operationId,expectedDigest}={}){
    if(typeof operationId!=='string'||typeof expectedDigest!=='string')fail();
    const owner=identity();privateDirectory(path.dirname(file));let raw;
    try{lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;fail();}
    raw=readPrivateJson(file,1048576);
    const row=state(raw,owner).records.find(r=>r.preview.operationId===operationId);
    if(!row)return null;if(row.digest!==expectedDigest)fail('local_consent_reference_mismatch');
    return {...copy(row),expired:!Number.isFinite(Date.parse(row.preview.expiresAt))||Date.parse(row.preview.expiresAt)<=currentTime()};
  }
  function assertApproved(args){const row=readStatus(args);if(!row||row.status!=='approved')fail();fresh(row.preview);return {expiresAt:row.preview.expiresAt};}
  return Object.freeze({
    readStatus,assertApproved,
    guardDispatch({operationId,expectedDigest}={},fetchImpl){
      if(typeof operationId!=='string'||typeof expectedDigest!=='string'||typeof fetchImpl!=='function')fail();
      const owner=identity();
      return (...args)=>{
        if(localElfaPolicyDigest(owner)!==localElfaPolicyDigest(identity()))fail();
        assertApproved({operationId,expectedDigest});
        // No await between the final durable approval check and transport invocation.
        return fetchImpl(...args);
      };
    },
    async recordPreview(args){
      const input=copy(args), owner=identity();
      const preview=copy(await binding.preview(input));fresh(preview);
      if(localElfaPolicyDigest(owner)!==localElfaPolicyDigest(identity()))fail();
      const digest=localElfaPolicyDigest(preview);
      return mutate(owner,s=>{const old=s.records.find(r=>r.preview.operationId===preview.operationId);if(old){if(old.digest!==digest||old.status==='revoked')fail();return {preview:copy(old.preview),digest,status:old.status};}if(s.records.length>=256)fail();s.records.push({preview,digest,status:'preview'});return {preview:copy(preview),digest,status:'preview'};});
    },
    async approve({operationId,expectedDigest}={}){
      if(typeof operationId!=='string'||typeof expectedDigest!=='string')fail();
      const owner=identity(), before=state(readPrivateJson(file,1048576),owner), row=before.records.find(r=>r.preview.operationId===operationId);
      if(!row||row.digest!==expectedDigest||row.status==='revoked')fail();
      const preview=copy(await binding.preview({operationId,query:copy(row.preview.query)}));fresh(preview);
      if(localElfaPolicyDigest(preview)!==expectedDigest||localElfaPolicyDigest(owner)!==localElfaPolicyDigest(identity()))fail();
      return mutate(owner,s=>{const live=s.records.find(r=>r.preview.operationId===operationId);if(!live||live.digest!==expectedDigest||live.status==='revoked')fail();fresh(live.preview);live.status='approved';return {operationId,digest:expectedDigest,status:'approved'};});
    },
    revoke({operationId,expectedDigest}={}){
      if(typeof operationId!=='string'||typeof expectedDigest!=='string')fail();
      return mutate(identity(),s=>{const row=s.records.find(r=>r.preview.operationId===operationId);if(!row||row.digest!==expectedDigest)fail();row.status='revoked';return {operationId,digest:expectedDigest,status:'revoked'};});
    },
    async readApproved({operationId,expectedDigest}={}){
      if(typeof operationId!=='string'||typeof expectedDigest!=='string')fail();
      const owner=identity(), old=state(readPrivateJson(file,1048576),owner).records.find(r=>r.preview.operationId===operationId);
      if(!old||old.status!=='approved'||old.digest!==expectedDigest)fail();
      const preview=copy(await binding.preview({operationId,query:copy(old.preview.query)}));
      if(localElfaPolicyDigest(preview)!==expectedDigest||localElfaPolicyDigest(owner)!==localElfaPolicyDigest(identity()))fail();
      const row=state(readPrivateJson(file,1048576),owner).records.find(r=>r.preview.operationId===operationId);
      if(!row||row.status!=='approved'||row.digest!==expectedDigest)fail();fresh(row.preview);
      return {operationId,query:copy(row.preview.query),consent:{...copy(row.preview.consent),approved:true}};
    },
  });
}
