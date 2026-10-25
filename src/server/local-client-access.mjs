/** Optional protected-local capability authority. No financial data or financial authority. */
import {DatabaseSync} from 'node:sqlite';
import {openSync,closeSync,lstatSync,realpathSync,readFileSync} from 'node:fs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';
export class LocalClientAccessError extends Error {
  constructor(code,status=403){super('Local client access was not accepted.');this.name='LocalClientAccessError';this.code=code;this.status=status;}
}
const fail=(code,status)=>{throw new LocalClientAccessError(code,status);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const scopesAllowed=Object.freeze(['research:read','research:write','portfolio:read']);
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))fail('invalid_local_client_input',400);}
function scopes(value){if(!Array.isArray(value)||!value.length||new Set(value).size!==value.length||value.some(v=>!scopesAllowed.includes(v))||value.includes('research:write')&&!value.includes('research:read'))fail('invalid_local_client_scopes',400);return [...value];}
function physical(file,directory=false){
  const stat=lstatSync(file);
  if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile())||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)fail('local_client_private_location_required',503);
  if(realpathSync(file)!==file)fail('local_client_physical_location_required',503);
  return stat;
}
function tokenParts(token){const match=typeof token==='string'&&/^alc_([oc])_([a-f0-9-]{36})_([A-Za-z0-9_-]{43})$/.exec(token);if(!match||!uuid(match[2]))fail('local_client_unauthorized',401);return {role:match[1]==='o'?'owner':'client',id:match[2],digest:hash(token)};}
/** Explicitly invoked by protected-mode composition only. Bootstrap token returned once, never stored. */
const bounded=operation=>{try{return operation();}catch(error){if(error instanceof LocalClientAccessError)throw error;fail('local_client_storage_unavailable',503);}};
export function openLocalClientAccess(options){return bounded(()=>openAccess(options));}
function openAccess({registryFile,dataFile,installationId,now=()=>new Date()}){
  if(typeof process.getuid!=='function'||!path.isAbsolute(registryFile??'')||!path.isAbsolute(dataFile??'')||registryFile===dataFile||!uuid(installationId)||typeof now!=='function')fail('local_client_configuration',503);
  physical(path.dirname(registryFile),true);physical(dataFile);
  const workspace=JSON.parse(readFileSync(dataFile,'utf8'));
  if(workspace.localInstallation?.id!==installationId)fail('local_client_workspace_mismatch',409);
  const binding=Object.freeze({installationId,dataLocationFingerprint:hash(realpathSync(dataFile)),ownerId:`local-operator:${installationId}`});
  let created=false;
  try{const fd=openSync(registryFile,'wx',0o600);closeSync(fd);created=true;}catch(error){if(error.code!=='EEXIST')throw error;}
  const fileIdentity=physical(registryFile),db=new DatabaseSync(registryFile);let closed=false,bootstrapOwnerToken;
  const time=()=>{const value=now();if(!(value instanceof Date)||!Number.isFinite(value.getTime()))fail('local_client_clock_invalid',503);return value;};
  try{
    db.exec('PRAGMA busy_timeout=0; PRAGMA synchronous=FULL;');
    if(created){
      const id=randomUUID();bootstrapOwnerToken=`alc_o_${id}_${randomBytes(32).toString('base64url')}`;
      db.exec('BEGIN IMMEDIATE; CREATE TABLE binding (singleton INTEGER PRIMARY KEY CHECK(singleton=1), installation TEXT NOT NULL, location TEXT NOT NULL); CREATE TABLE grants (id TEXT PRIMARY KEY, digest TEXT UNIQUE NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL, scopes TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, revoked_at TEXT);');
      db.prepare('INSERT INTO binding VALUES (1,?,?)').run(installationId,binding.dataLocationFingerprint);
      db.prepare('INSERT INTO grants VALUES (?,?,?,?,?,?,?,?)').run(id,hash(bootstrapOwnerToken),'owner','Local owner','[]',time().toISOString(),null,null);
      db.exec('COMMIT');
    }
    const stored=db.prepare('SELECT * FROM binding WHERE singleton=1').get();
    if(stored?.installation!==installationId||stored?.location!==binding.dataLocationFingerprint)fail('local_client_workspace_mismatch',409);
  }catch(error){db.close();throw error;}
  function ready(){
    if(closed)fail('local_client_closed',503);
    const stat=physical(registryFile);physical(dataFile);
    if(stat.ino!==fileIdentity.ino||stat.dev!==fileIdentity.dev)fail('local_client_registry_changed',503);
    // The physical path is bound; a replacement with another installation never inherits grants.
    if(JSON.parse(readFileSync(dataFile,'utf8')).localInstallation?.id!==installationId)fail('local_client_workspace_mismatch',409);
  }
  function authorize(token,required=[],{ownerOnly=false}={}){
    ready();if(!Array.isArray(required)||required.some(s=>!scopesAllowed.includes(s)))fail('invalid_local_client_scopes',400);
    const parsed=tokenParts(token),row=db.prepare('SELECT * FROM grants WHERE id=? AND digest=?').get(parsed.id,parsed.digest);
    const current=time().getTime();
    if(!row||row.role!==parsed.role||row.revoked_at!==null||row.expires_at!==null&&(!iso(row.expires_at)||Date.parse(row.expires_at)<=current))fail('local_client_unauthorized',401);
    const granted=JSON.parse(row.scopes);
    if(row.role==='client')scopes(granted);else if(row.role!=='owner'||granted.length)fail('local_client_registry_invalid',503);
    if(ownerOnly&&row.role!=='owner'||row.role!=='owner'&&required.some(s=>!granted.includes(s)))fail('local_client_scope_denied',403);
    return {id:row.id,role:row.role,...binding,scopes:[...granted],expiresAt:row.expires_at};
  }
  function transaction(operation){ready();db.exec('BEGIN IMMEDIATE');try{const result=operation();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
  const publicGrant=row=>({id:row.id,name:row.name,scopes:JSON.parse(row.scopes),createdAt:row.created_at,expiresAt:row.expires_at,revokedAt:row.revoked_at});
  const access=Object.freeze({
    binding,authorize,
    issue(ownerToken,input){return transaction(()=>{
      authorize(ownerToken,[],{ownerOnly:true});exact(input,['name','scopes','expiresAt']);const granted=scopes(input.scopes),current=time();
      if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80||/[\x00-\x1f]|alc_[oc]_|abp_|Bearer\s/i.test(input.name)||!iso(input.expiresAt)||Date.parse(input.expiresAt)<=current.getTime()||Date.parse(input.expiresAt)-current.getTime()>30*86400000)fail('invalid_local_client_input',400);
      if(db.prepare("SELECT count(*) AS count FROM grants WHERE role='client'").get().count>=64)fail('local_client_capacity',409);
      const id=randomUUID(),token=`alc_c_${id}_${randomBytes(32).toString('base64url')}`;
      db.prepare('INSERT INTO grants VALUES (?,?,?,?,?,?,?,?)').run(id,hash(token),'client',input.name,JSON.stringify(granted),current.toISOString(),input.expiresAt,null);
      return {token,grant:publicGrant(db.prepare('SELECT * FROM grants WHERE id=?').get(id))};
    });},
    revoke(ownerToken,id){return transaction(()=>{authorize(ownerToken,[],{ownerOnly:true});if(!uuid(id))fail('invalid_local_client_input',400);const row=db.prepare("SELECT * FROM grants WHERE id=? AND role='client'").get(id);if(!row)fail('local_client_not_found',404);db.prepare('UPDATE grants SET revoked_at=coalesce(revoked_at,?) WHERE id=?').run(time().toISOString(),id);return publicGrant(db.prepare('SELECT * FROM grants WHERE id=?').get(id));});},
    list(ownerToken){authorize(ownerToken,[],{ownerOnly:true});return db.prepare("SELECT * FROM grants WHERE role='client' ORDER BY created_at,id").all().map(publicGrant);},
    close(){if(!closed){db.close();closed=true;}},
  });
  const guarded=Object.freeze({binding,...Object.fromEntries(['authorize','issue','revoke','list','close'].map(name=>[name,(...args)=>bounded(()=>access[name](...args))]))});
  return {access:guarded,...(bootstrapOwnerToken?{bootstrapOwnerToken}:{})};
}
/** Global protected-mode guard: unknown endpoints default to owner, never anonymous.
 * Map keys are exact 'METHOD /path' strings. Composition owns the narrow route allowlist. */
export function authorizeLocalRequest(request,{access,origin,clientRoutes={}}){
  let url,expected;try{url=new URL(request.url);expected=new URL(origin);}catch{fail('local_client_origin_denied',403);}
  if(expected.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(expected.hostname)||expected.origin!==origin||url.origin!==origin||url.username||url.password||url.hash)fail('local_client_origin_denied',403);
  const host=request.headers.get('host');
  if(host!==null&&host!==expected.host)fail('local_client_origin_denied',403);
  const incoming=request.headers.get('origin');
  if(incoming!==null&&incoming!==origin||request.headers.get('sec-fetch-site')==='cross-site')fail('local_client_origin_denied',403);
  const authorization=request.headers.get('authorization');
  if(typeof authorization!=='string'||!authorization.startsWith('Bearer '))fail('local_client_unauthorized',401);
  const token=authorization.slice(7),key=`${request.method} ${url.pathname}`;
  const clientPath=['/api/local/client/memory','/api/local/client/tools','/api/local/client/mcp'].includes(url.pathname);
  const required=clientPath&&Object.hasOwn(clientRoutes,key)?clientRoutes[key]:null;
  if(required!==null)scopes(required);
  return access.authorize(token,required??[],{ownerOnly:required===null});
}
