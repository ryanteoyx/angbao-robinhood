/** Trusted startup dependencies only. Never expose this object as a tool result. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createLocalElfaEvidenceBinding, localElfaPolicyDigest } from './local-elfa-operator.mjs';
export class LocalElfaFilesError extends Error {
  constructor(code = 'private_files_unavailable') { super('Private Elfa configuration could not be verified.'); this.name = 'LocalElfaFilesError'; this.code = code; }
}
const fail = code => { throw new LocalElfaFilesError(code); };
export const privateDigest = value => createHash('sha256').update(value).digest('hex');
const same = (a,b) => a.dev === b.dev && a.ino === b.ino;
const unchanged = (a,b) => same(a,b) && ['mode','uid','gid','nlink','size','mtimeMs','ctimeMs'].every(key => a[key] === b[key]);
const uid = () => { if (typeof process.getuid !== 'function') fail(); return process.getuid(); };
export function privateDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory || fs.realpathSync(directory) !== directory) fail();
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.uid !== uid() || (stat.mode & 0o777) !== 0o700) fail();
  return stat;
}
/** Bounded descriptor read; reject path/descriptor identity changes and link aliases. */
export function readPrivateJson(file, maxBytes = 65536) {
  let fd;
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16777216) fail();
    const dir = path.dirname(file), parent = privateDirectory(dir);
    if (path.resolve(file) !== file || fs.realpathSync(file) !== file) fail();
    const before = fs.lstatSync(file);
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    const valid = s => s.isFile() && s.nlink === 1 && s.uid === uid() && (s.mode & 0o777) === 0o600 && s.size <= maxBytes;
    if (!valid(before) || !valid(stat) || !unchanged(stat,before)) fail();
    const buffer = Buffer.alloc(maxBytes + 1); let size = 0, n;
    while (size < buffer.length && (n = fs.readSync(fd,buffer,size,buffer.length-size,null))) size += n;
    const after = fs.fstatSync(fd), named = fs.lstatSync(file), finalParent = privateDirectory(dir);
    if (size > maxBytes || size !== after.size || !valid(after) || !valid(named) || !unchanged(stat,after) || !unchanged(after,named) || !unchanged(parent,finalParent)) fail();
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size)));
  } catch { fail(); } finally { if (fd !== undefined) fs.closeSync(fd); }
}
/** Explicit single-host transaction primitive. A crash lock is never auto-cleared. */
export function privateJsonTransaction(file, work, {createOnly=false}={}) {
  let lock, temp, fd; let renamed = false;
  try {
    if(typeof createOnly!=='boolean')fail();
    const dir = path.dirname(file), parent = privateDirectory(dir);
    lock = `${file}.lock`; fs.mkdirSync(lock,{mode:0o700});
    let current=null; try { fs.lstatSync(file); current=readPrivateJson(file,1048576); } catch(error) { if(error.code!=='ENOENT')throw error; }
    if(createOnly&&current!==null)fail();
    const original=JSON.stringify(current);
    const { value, result } = work(current);
    const bytes = Buffer.from(JSON.stringify(value)); if (bytes.length > 1048576) fail('private_capacity');
    temp = path.join(dir,`.elfa-${randomUUID()}.tmp`);
    fd = fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd=undefined;
    if (!same(parent,privateDirectory(dir))) fail();
    // Reject a newly introduced alias or changed target before replacement.
    let latest=null; try { fs.lstatSync(file); latest=readPrivateJson(file,1048576); } catch(error) { if(error.code!=='ENOENT')throw error; }
    if(JSON.stringify(latest)!==original)fail();
    if(createOnly){
      // Atomic no-replace publication: a late competing file is never overwritten.
      fs.linkSync(temp,file);renamed=true;fs.unlinkSync(temp);temp=undefined;
    }else{fs.renameSync(temp,file);renamed=true;temp=undefined;}
    fd=fs.openSync(dir,fs.constants.O_RDONLY); fs.fsyncSync(fd); fs.closeSync(fd); fd=undefined;
    fs.rmdirSync(lock); lock=undefined;
    return result;
  } catch { fail(renamed ? 'private_commit_uncertain' : 'private_write_unavailable'); }
  finally { if(fd!==undefined)fs.closeSync(fd); if(temp)try{fs.unlinkSync(temp);}catch{} /* Preserve lock after any failure for explicit reconciliation. */ }
}
export function createLocalElfaPrivateFiles({ dataFile, configurationFile, credentialFile } = {}) {
  // No mkdir, implicit initialization, credential access or activation at construction.
  let initial;
  const workspace = () => {
    const state = readPrivateJson(dataFile,16*1024*1024);
    if (typeof state.localInstallation?.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(state.localInstallation?.id)) fail();
    const value={installationId:state.localInstallation?.id,dataLocationFingerprint:privateDigest(fs.realpathSync(dataFile))};
    if(initial && JSON.stringify(initial)!==JSON.stringify(value))fail();
    initial ??= value; return value;
  };
  const snapshot = () => {
    const identity=workspace(), config=readPrivateJson(configurationFile);
    if(!config || Object.keys(config).sort().join(',')!=='format,grant,policy,revision' || config.format!=='angbao-local-elfa-files@1' || !Number.isSafeInteger(config.revision) || config.revision<0)fail();
    if(config.grant===null && config.policy===null)return {identity,...config};
    if(!config.grant || !config.policy || config.grant.installationId!==identity.installationId || config.grant.dataLocationFingerprint!==identity.dataLocationFingerprint || config.grant.policyDigest!==localElfaPolicyDigest(config.policy))fail();
    return {identity,...config};
  };
  return Object.freeze({
    readWorkspaceBinding:()=>snapshot().identity,
    readOperatorGrant:()=>snapshot().grant,
    readPolicy:()=>snapshot().policy,
    readRevision:()=>snapshot().revision,
    createBinding({repository,fetchImpl,now}={}) {
      const start=snapshot(); if(start.policy?.enabled!==true || start.grant?.revoked!==false)fail('private_disabled');
      const credential=readPrivateJson(credentialFile,8192);
      if(!credential || Object.keys(credential).sort().join(',')!=='apiKey,format,keySlot' || credential.format!=='angbao-local-elfa-key@1' || credential.keySlot!==start.policy.keySlot || typeof credential.apiKey!=='string' || credential.apiKey.length<16 || credential.apiKey.length>4096 || /\s/.test(credential.apiKey))fail();
      const configDigest=localElfaPolicyDigest(start), keyDigest=localElfaPolicyDigest(credential);
      const checked=()=>{const s=snapshot();if(localElfaPolicyDigest(s)!==configDigest||localElfaPolicyDigest(readPrivateJson(credentialFile,8192))!==keyDigest)fail();return s;};
      const binding=createLocalElfaEvidenceBinding({repository,fetchImpl,now,apiKey:credential.apiKey,readWorkspaceBinding:()=>checked().identity,readOperatorGrant:()=>checked().grant,readPolicy:()=>checked().policy});
      return Object.freeze({...binding,assertCurrent(){checked();}});
    },
  });
}
