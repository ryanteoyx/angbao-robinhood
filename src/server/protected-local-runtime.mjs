/** Opt-in private read-only composition. Never turns a legacy listener into a protected one. */
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {lstatSync,realpathSync,readFileSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import path from 'node:path';
import {openLocalClientAccess,authorizeLocalRequest,LocalClientAccessError} from './local-client-access.mjs';
import {createLocalClientMemoryBinding} from './local-client-memory.mjs';
import {collectMemoryCandidates} from './financial-memory-binding.mjs';
import {adaptFinancialRecord,validateFinancialMemoryReference} from '../domain/financial-memory-contract.mjs';
import {financialWorkspaceId} from '../domain/financial-handoff.mjs';

export const PROTECTED_EGRESS=Symbol.for('angbao.protected.egress');
const fail=(code,status=403)=>{throw new LocalClientAccessError(code,status);};
const digest=value=>createHash('sha256').update(value).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const credentialPattern=/alc_[oc]_[a-f0-9-]{36}_[A-Za-z0-9_-]{43}|abp_[a-f0-9-]{36}_[A-Za-z0-9_-]{43}|\bBearer\s+\S+|-----BEGIN .*PRIVATE KEY|\bsk-[A-Za-z0-9_-]{16,}|\bsb_secret_|(?:api[_-]?key|access[_-]?token|secret|authorization)\s*[=:]\s*\S+/i;
export function rejectLocalCredentials(serialized){if(credentialPattern.test(serialized))fail('local_credential_in_data',400);}
function exact(value,allowed,required=allowed){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('invalid_local_input',400);
  const fields=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(fields).some(k=>typeof k!=='string'||!allowed.includes(k)||!fields[k].enumerable||!Object.hasOwn(fields[k],'value'))||required.some(k=>!Object.hasOwn(fields,k)))fail('invalid_local_input',400);
}
function toolParameters(value){
  exact(value,['name','arguments','_meta'],['name','arguments']);
  if(Object.hasOwn(value,'_meta')){
    const meta=value._meta;
    if(!meta||typeof meta!=='object'||Array.isArray(meta)||![Object.prototype,null].includes(Object.getPrototypeOf(meta)))fail('invalid_local_mcp_metadata',400);
    let nodes=0;
    const check=(item,depth)=>{
      if(++nodes>128||depth>4)fail('invalid_local_mcp_metadata',400);
      if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return;
      if(!item||typeof item!=='object'||!(Array.isArray(item)?Object.getPrototypeOf(item)===Array.prototype:[Object.prototype,null].includes(Object.getPrototypeOf(item))))fail('invalid_local_mcp_metadata',400);
      for(const key of Reflect.ownKeys(item)){
        if(Array.isArray(item)&&key==='length')continue;
        const field=Object.getOwnPropertyDescriptor(item,key);
        if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key)||!field.enumerable||!Object.hasOwn(field,'value'))fail('invalid_local_mcp_metadata',400);
        check(field.value,depth+1);
      }
    };
    check(meta,0);
    if(Buffer.byteLength(JSON.stringify(meta))>2048||Object.hasOwn(meta,'progressToken')&&!(typeof meta.progressToken==='string'&&meta.progressToken.length<=200||typeof meta.progressToken==='number'&&Number.isFinite(meta.progressToken)))fail('invalid_local_mcp_metadata',400);
  }
  // Transport hints never enter arguments, record identity, authorization or output.
  return {name:value.name,arguments:value.arguments};
}
export function readPrivateLocalFile(file){
  if(!path.isAbsolute(file??'')||realpathSync(file)!==file)fail('local_private_file_required',503);
  for(const [location,directory]of [[path.dirname(file),true],[file,false]]){
    const s=lstatSync(location);
    if(s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)!==0||(directory?!s.isDirectory():!s.isFile()))fail('local_private_file_required',503);
  }
  if(lstatSync(file).size>16384)fail('local_private_file_required',503);
  return JSON.parse(readFileSync(file,'utf8'));
}
export function writePrivateLocalFile(file,value){
  if(!path.isAbsolute(file??'')||realpathSync(path.dirname(file))!==path.dirname(file))fail('local_private_file_required',503);
  const s=lstatSync(path.dirname(file));if(!s.isDirectory()||s.uid!==process.getuid()||(s.mode&0o077)!==0)fail('local_private_file_required',503);
  const fd=openSync(file,'wx',0o600);
  try{writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  const parent=openSync(path.dirname(file),'r');try{fsyncSync(parent);}finally{closeSync(parent);}
}
const TOOL=Object.freeze({name:'angbao_read_exact_memory',description:'Read one exact saved research or portfolio record, including its original method, settings, sources and gaps. No writes or automatic latest-version selection.',inputSchema:{type:'object',properties:{reference:{type:'object'},maxAgeMs:{type:'integer',minimum:0},expectedETag:{type:'string'}},required:['reference'],additionalProperties:false}});
const OWNER_READS=new Set(['/api/health','/api/state','/api/export','/api/handoff','/api/local/capabilities','/api/local/context','/api/local/history','/api/local/manifest','/api/local/portfolio-work','/api/local/history-archive','/api/local/history-archive/export','/api/research/methods','/api/research/briefs']);
const SHELL=new Set(['/','/index.html','/app.js','/styles.css','/brand-fonts.css','/favicon.svg','/wallet-provider.mjs','/catalog.mjs','/review-comparison.mjs','/research-authoring.mjs','/assets/angbao-wordmark-69b8f2e3.svg','/assets/fonts/inter-latin.woff2','/assets/fonts/eb-garamond-latin.woff2']);
const CONNECT=new Set(['/local-connect.html','/local-connect.mjs']);
export async function createProtectedLocalRuntime({registryFile,ownerCredentialFile,dataFile,installationId,readState,historyStore,now=()=>new Date(),pairLifetimeMs=90000,sessionLifetimeMs=15*60000}){
  if(!Number.isSafeInteger(pairLifetimeMs)||pairLifetimeMs<1||pairLifetimeMs>90000||!Number.isSafeInteger(sessionLifetimeMs)||sessionLifetimeMs<1||sessionLifetimeMs>15*60000)fail('local_protected_configuration',503);
  const dataDirectory=path.dirname(dataFile);
  if(!path.isAbsolute(ownerCredentialFile??'')||ownerCredentialFile===registryFile||[registryFile,ownerCredentialFile].some(f=>!path.isAbsolute(f??'')||f===dataDirectory||f.startsWith(dataDirectory+path.sep)))fail('local_access_outside_workspace_required',503);
  const {access,bootstrapOwnerToken}=openLocalClientAccess({registryFile,dataFile,installationId,now});
  let owner;
  try{
    if(bootstrapOwnerToken)writePrivateLocalFile(ownerCredentialFile,{format:'angbao-local-owner@1',token:bootstrapOwnerToken,installationId});
    const saved=readPrivateLocalFile(ownerCredentialFile);exact(saved,['format','token','installationId']);
    if(saved.format!=='angbao-local-owner@1'||saved.installationId!==installationId)fail('local_owner_recovery_required',503);
    access.authorize(saved.token,[],{ownerOnly:true});owner=saved.token;
  }catch{access.close();fail('local_owner_recovery_required',503);}
  function outputFile(file,value){if(typeof file!=='string'||file===dataDirectory||file.startsWith(dataDirectory+path.sep))fail('local_access_outside_workspace_required',400);writePrivateLocalFile(file,value);}
  const memory=await createLocalClientMemoryBinding({access,readState,historyStore,now});
  const scope={ownerId:access.binding.ownerId,workspaceId:await financialWorkspaceId('local',installationId)};
  const pairs=new Map(),sessions=new Map();let closed=false;
  const time=()=>{const d=now();if(!(d instanceof Date)||!Number.isFinite(d.getTime()))fail('local_clock_invalid',503);return d.getTime();};
  function transport(request,origin){
    const url=new URL(request.url,origin),expected=new URL(origin);
    if(expected.protocol!=='http:'||!['127.0.0.1','[::1]','localhost'].includes(expected.hostname)||expected.origin!==origin||url.origin!==origin||url.hash||url.username||url.password||request.headers.host!==expected.host||request.headers.origin!==undefined&&request.headers.origin!==origin||request.headers['sec-fetch-site']==='cross-site')fail('local_client_origin_denied');
    return url;
  }
  function requestWithToken(request,origin,token){return new Request(new URL(request.url,origin),{method:request.method,headers:{...request.headers,authorization:`Bearer ${token}`}});}
  function bearer(request){const auth=request.headers.authorization;if(typeof auth!=='string'||!/^Bearer \S+$/.test(auth))fail('local_client_unauthorized',401);return auth.slice(7);}
  function session(request,origin,proofRequired=true){
    const matches=(request.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith('angbao_local='));
    if(matches.length!==1)fail('local_browser_connect_required',401);
    const id=matches[0].slice('angbao_local='.length),s=sessions.get(digest(id));
    if(!s||s.origin!==origin||time()>=s.expiresAt){sessions.delete(digest(id));fail('local_browser_connect_required',401);}
    if(proofRequired&&!same(request.headers['x-angbao-local-proof'],s.proof))fail('local_browser_connect_required',401);
    access.authorize(owner,[],{ownerOnly:true});return s;
  }
  function requireAuth(request,origin,required=null,ownerOnly=false){
    const hasCookie=(request.headers.cookie??'').split(';').some(c=>c.trim().startsWith('angbao_local='));
    if(request.headers.authorization!==undefined&&hasCookie)fail('local_mixed_credentials');
    if(request.headers.authorization!==undefined){
      const token=bearer(request),routes=required?{[`${request.method} ${new URL(request.url,origin).pathname}`]:required}:{};
      const grant=authorizeLocalRequest(requestWithToken(request,origin,token),{access,origin,clientRoutes:routes});
      if(ownerOnly&&grant.role!=='owner')fail('local_client_scope_denied');
      return {token,grant,recheck:()=>access.authorize(token,required??[],{ownerOnly:ownerOnly||required===null})};
    }
    if(required)fail('local_client_unauthorized',401);
    session(request,origin);return {token:owner,grant:access.authorize(owner,[],{ownerOnly:true}),recheck:()=>session(request,origin)};
  }
  async function body(request){
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??''))fail('local_json_required',415);
    let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>16384)fail('local_request_too_large',413);chunks.push(chunk);}
    const text=Buffer.concat(chunks).toString('utf8');rejectLocalCredentials(text);
    try{return JSON.parse(text);}catch{fail('invalid_local_json',400);}
  }
  const security={'cache-control':'no-store','referrer-policy':'no-referrer','x-frame-options':'DENY','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
  function guard(response,auth,result){
    response[PROTECTED_EGRESS]=serialized=>{
      if(closed||historyStore.isUncertain())fail('local_protected_unavailable',503);
      if(serialized!==undefined){if(Buffer.byteLength(serialized)>1048576)fail('local_response_too_large',413);rejectLocalCredentials(serialized);}
      const g=auth.recheck(),current=time();
      if(typeof g?.expiresAt==='string'&&current>=Date.parse(g.expiresAt))fail('local_client_unauthorized',401);
      // Session recheck returns a numeric expiry; intersect at the same final egress clock.
      if(typeof g?.expiresAt==='number'&&current>=g.expiresAt)fail('local_browser_connect_required',401);
      if(result?.freshness==='fresh'&&(current<Date.parse(result.freshnessWindow.validFrom)||current>Date.parse(result.freshnessWindow.validThrough)))fail('local_freshness_elapsed',409);
    };
  }
  function json(response,status,value,headers={}){const text=JSON.stringify(value);response[PROTECTED_EGRESS]?.(text);response.writeHead(status,{'content-type':'application/json; charset=utf-8',...security,...headers});response.end(text);}
  function prune(map){const current=time();for(const[k,v]of map)if(v.expiresAt<=current)map.delete(k);if(map.size>=32)fail('local_session_capacity',429);}
  async function readExact(auth,args){exact(args,['reference','maxAgeMs','expectedETag'],['reference']);const ref=validateFinancialMemoryReference(args.reference);const required=[ref.kind==='portfolio'?'portfolio:read':'research:read'];access.authorize(auth.token,required);return memory.resolveExact(auth.token,ref,{...(args.maxAgeMs!==undefined?{maxAgeMs:args.maxAgeMs}:{}),...(args.expectedETag!==undefined?{expectedETag:args.expectedETag}:{})});}
  return Object.freeze({close(){closed=true;pairs.clear();sessions.clear();access.close();},async handle(request,response,origin){
    if(closed)fail('local_protected_unavailable',503);
    for(const[k,v]of Object.entries(security))response.setHeader(k,v);
    const url=transport(request,origin),route=url.pathname;
    if(url.search&&!(request.method==='GET'&&['/api/local/history','/api/handoff'].includes(route)))fail('local_query_not_allowed',400);
    if(CONNECT.has(route)&&request.method==='GET')return false;
    if(route==='/api/local/browser/redeem'&&request.method==='POST'){
      if(request.headers.authorization!==undefined||request.headers.origin!==origin)fail('local_pairing_denied');
      const input=await body(request);exact(input,['format','nonce','origin','expiresAt']);
      if(input.format!=='angbao-local-browser-pair@1'||input.origin!==origin||typeof input.nonce!=='string')fail('local_pairing_denied');
      const key=digest(input.nonce),pair=pairs.get(key);pairs.delete(key);
      if(!pair||pair.origin!==origin||pair.expiresAt<=time()||input.expiresAt!==new Date(pair.expiresAt).toISOString())fail('local_pairing_denied',401);
      const old=(request.headers.cookie??'').split(';').find(c=>c.trim().startsWith('angbao_local='));if(old)sessions.delete(digest(old.trim().slice('angbao_local='.length)));
      prune(sessions);const id=secret(),proof=secret(),expiresAt=time()+sessionLifetimeMs;sessions.set(digest(id),{origin,proof,expiresAt});
      return json(response,200,{proof,expiresAt:new Date(expiresAt).toISOString(),readOnly:true},{'set-cookie':`angbao_local=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionLifetimeMs/1000)}`}),true;
    }
    if(!route.startsWith('/api/')){
      if(!SHELL.has(route))fail('local_page_unavailable',404);
      if(request.method!=='GET'&&request.method!=='HEAD')fail('local_read_only',405);
      try{if(request.headers.authorization!==undefined)requireAuth(request,origin,null,true);else session(request,origin,false);}catch(e){if((route==='/'||route==='/index.html')&&e.status===401){response.writeHead(303,{...security,location:'/local-connect.html'});response.end();return true;}throw e;}
      // Static shell/assets contain no private data; a valid cookie may load them without proof.
      guard(response,{recheck:()=>request.headers.authorization!==undefined?requireAuth(request,origin,null,true).recheck():session(request,origin,false)});return false;
    }
    const clientRoutes=['/api/local/client/memory','/api/local/client/tools','/api/local/client/mcp'];
    if(clientRoutes.includes(route)){
      // Authenticate before parsing any record/reference input. Discovery uses one actual read scope.
      const token=bearer(request),granted=access.authorize(token),scope=granted.scopes.find(s=>['research:read','portfolio:read'].includes(s))??(granted.role==='owner'?'research:read':null);
      if(!scope)fail('local_client_scope_denied');
      let auth=requireAuth(request,origin,[scope]);
      if(route==='/api/local/client/tools'&&request.method==='GET'){guard(response,auth);json(response,200,{tools:[TOOL],readOnly:true});return true;}
      if(request.method!=='POST'||route==='/api/local/client/tools')fail('local_client_scope_denied');
      const input=await body(request);let result,reply;
      if(route==='/api/local/client/memory'){
        exact(input,['reference','maxAgeMs','expectedETag'],['reference']);const ref=validateFinancialMemoryReference(input.reference);auth=requireAuth(request,origin,[ref.kind==='portfolio'?'portfolio:read':'research:read']);result=await readExact(auth,input);reply=result;
      }else{
        exact(input,['jsonrpc','id','method','params'],['jsonrpc','method']);
        if(input.jsonrpc!=='2.0'||!['initialize','notifications/initialized','ping','tools/list','tools/call'].includes(input.method)||Object.hasOwn(input,'id')&&!(Number.isSafeInteger(input.id)||typeof input.id==='string'&&input.id.length<=100))fail('invalid_local_mcp',400);
        if(input.method==='notifications/initialized'){if(Object.hasOwn(input,'id'))fail('invalid_local_mcp',400);guard(response,auth);response[PROTECTED_EGRESS]('');response.writeHead(202,security);response.end();return true;}
        if(!Object.hasOwn(input,'id'))fail('invalid_local_mcp',400);
        if(input.method==='tools/call'){
          input.params=toolParameters(input.params);if(input.params.name!==TOOL.name)fail('local_tool_denied');
          const ref=validateFinancialMemoryReference(input.params.arguments?.reference);auth=requireAuth(request,origin,[ref.kind==='portfolio'?'portfolio:read':'research:read']);result=await readExact(auth,input.params.arguments);reply={content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:result.status!=='resolved'};
        }else reply=input.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'angbao-protected-local',version:'source-only'}}:input.method==='tools/list'?{tools:[TOOL]}:{};
        reply={jsonrpc:'2.0',id:input.id,result:reply};
      }
      guard(response,auth,result);json(response,200,reply,result?.etag?{etag:result.etag}:{});return true;
    }
    const auth=requireAuth(request,origin,null,true);guard(response,auth);
    if(route==='/api/local/browser/logout'&&request.method==='POST'){
      if(request.headers.authorization!==undefined)fail('local_browser_connect_required',401);
      const s=session(request,origin);for(const[k,v]of sessions)if(v===s)sessions.delete(k);delete response[PROTECTED_EGRESS];json(response,200,{disconnected:true},{'set-cookie':'angbao_local=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});return true;
    }
    if(route.startsWith('/api/local/owner/')){
      if(request.headers.authorization===undefined)fail('local_owner_cli_required');
      if(route==='/api/local/owner/clients'&&request.method==='GET'){json(response,200,{clients:access.list(auth.token)});return true;}
      if(request.method!=='POST')fail('local_read_only',405);
      const input=await body(request);
      if(route==='/api/local/owner/clients/issue'){
        exact(input,['name','scopes','expiresAt','credentialOut']);if(!Array.isArray(input.scopes)||input.scopes.some(s=>!['research:read','portfolio:read'].includes(s)))fail('local_read_only');
        // A failed delivery does not silently reissue or replace a capability.
        const issued=access.issue(auth.token,{name:input.name,scopes:input.scopes,expiresAt:input.expiresAt});
        outputFile(input.credentialOut,{format:'angbao-local-client@1',origin,installationId,token:issued.token,grant:issued.grant});json(response,201,{grant:issued.grant,credentialSaved:true});return true;
      }
      if(route==='/api/local/owner/clients/revoke'){exact(input,['id']);json(response,200,{grant:access.revoke(auth.token,input.id)});return true;}
      if(route==='/api/local/owner/browser-pair'){
        exact(input,['out']);prune(pairs);const nonce=secret(),expiresAt=time()+pairLifetimeMs;pairs.set(digest(nonce),{origin,expiresAt});
        outputFile(input.out,{format:'angbao-local-browser-pair@1',origin,nonce,expiresAt:new Date(expiresAt).toISOString()});json(response,201,{pairingSaved:true,expiresAt:new Date(expiresAt).toISOString()});return true;
      }
      if(route==='/api/local/owner/reference'){
        exact(input,['kind','recordId']);const snapshot=await readState();auth.recheck();if(historyStore.isUncertain())fail('archive_commit_uncertain',503);
        const candidates=collectMemoryCandidates(snapshot,input);if(candidates.length!==1)fail('local_exact_selection_required',409);
        const ref=adaptFinancialRecord(input.kind,candidates[0],scope).reference;json(response,200,{reference:ref,etag:`"${snapshot.localRevision}"`});return true;
      }
      fail('local_page_unavailable',404);
    }
    const recordRead=/^\/api\/(?:research\/(?:briefs|methods)|local\/portfolio-work)\/[a-f0-9-]{36}$/.test(route);
    if(request.method!=='GET'||!OWNER_READS.has(route)&&!recordRead)fail('local_read_only');
    if(route==='/api/health'){json(response,200,{ok:true,service:'angbao-local-demo',protectedLocal:true,readOnly:true,accountRequired:false,researchPortfolio:true});return true;}
    return false;
  }});
}
