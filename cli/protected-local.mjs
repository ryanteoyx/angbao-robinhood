/** Source-only protected local adapter. Paths, never credentials, enter process arguments. */
import path from 'node:path';
import {lstat,realpath,readFile} from 'node:fs/promises';
import {localOrigin} from './local.mjs';
import {RemoteError} from './remote.mjs';
import net from 'node:net';
import {readdir} from 'node:fs/promises';
const fail=message=>{throw new RemoteError(message);};
const credential=/alc_[oc]_[a-f0-9-]{36}_[A-Za-z0-9_-]{43}|abp_[a-f0-9-]{36}_[A-Za-z0-9_-]{43}|\bBearer\s+\S+/i;
export async function prepareProtectedStart({directory,port}){
  // Read existing resumable setup receipts without changing their schema or taking over a process.
  const{readSetup}=await import('./setup-state.mjs');
  for(const project of [directory,path.dirname(directory)]){
    let versions;try{versions=await readdir(path.join(project,'.angbao-setup'));}catch(error){if(error.code==='ENOENT')continue;fail('Inspect the existing setup checkpoint before starting a protected copy.');}
    if(versions.length>32)fail('Inspect the existing setup checkpoints before starting a protected copy.');
    for(const version of versions.filter(v=>/^\d+\.\d+\.\d+$/.test(v))){
      const saved=await readSetup(project,version);
      if(!saved?.server||saved.server.dataDir!==directory&&path.join(project,'data')!==directory)continue;
      if(!Number.isSafeInteger(saved.server.pid)||saved.server.pid<1)fail('A recorded start needs explicit recovery. Keep it separate from this protected copy.');
      try{process.kill(saved.server.pid,0);}catch(error){if(error.code==='ESRCH')continue;fail('The recorded process could not be checked. Keep it separate from this protected copy.');}
      fail('A recorded workspace process is still present. Use a separate private copy for protected acceptance.');
    }
  }
  if(port!==0){const occupied=await new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port});let done=false;const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value);};socket.once('connect',()=>finish(true));socket.once('error',error=>finish(error.code!=='ECONNREFUSED'));socket.setTimeout(1000,()=>finish(true));});if(occupied)fail('The selected port is occupied or could not be checked. Keep the existing runtime and choose a separate private copy and free port.');}
}
export function protectedPrint(value){const text=JSON.stringify(value);if(credential.test(text))fail('The reply contains a credential and was withheld.');return text;}
async function privateJson(file){
  try{
    if(!path.isAbsolute(file??'')||await realpath(file)!==file)throw Error();
    for(const[location,directory]of [[path.dirname(file),true],[file,false]]){const s=await lstat(location);if(s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)!==0||(directory?!s.isDirectory():!s.isFile())||!directory&&s.size>16384)throw Error();}
    return JSON.parse(await readFile(file,'utf8'));
  }catch{fail('Open the original private credential file on this computer. Its folder and file must be private to you.');}
}
async function transport({origin,token,fetchImpl=globalThis.fetch}){
  origin=localOrigin(origin);
  if(typeof fetchImpl!=='function')fail('The local connection is unavailable.');
  return async(route,payload)=>{
    const text=payload===undefined?undefined:protectedPrint(payload);
    if(text!==undefined&&Buffer.byteLength(text)>16384)fail('The exact request exceeds the local limit.');
    let reader;
    try{
      const response=await fetchImpl(origin+route,{method:payload===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,...(text===undefined?{}:{'content-type':'application/json'})},body:text,credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!response.ok){await response.body?.cancel();fail(`Protected local request refused (${response.status}). Check access, the exact reference and the saved revision. No fallback or retry was sent.`);}
      if(response.redirected||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')&&response.status!==202)throw Error();
      reader=response.body?.getReader();let size=0;const chunks=[];if(reader)while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576)throw Error();chunks.push(value);}
      const body=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));if(response.status===202){if(body||route!=='/api/local/client/mcp'||payload?.method!=='notifications/initialized')throw Error();return null;}
      const value=JSON.parse(body);protectedPrint(value);return value;
    }catch(error){try{await reader?.cancel();}catch{}if(error instanceof RemoteError)throw error;fail('The protected local connection could not be confirmed. No fallback or retry was sent.');}
  };
}
export async function createProtectedLocalClient({file,origin,fetchImpl}={}){
  const saved=await privateJson(file);
  if(saved.format!=='angbao-local-client@1'||typeof saved.token!=='string'||!/^alc_c_[a-f0-9-]{36}_[A-Za-z0-9_-]{43}$/.test(saved.token)||!saved.grant||!Array.isArray(saved.grant.scopes)||!saved.grant.scopes.length||saved.grant.scopes.some(s=>!['research:read','portfolio:read'].includes(s)))fail('Use a read-only client credential issued by this local workspace.');
  if(origin!==undefined&&origin!==saved.origin)fail('The client file and ANGBAO_API_URL select different workspaces.');
  const send=await transport({origin:saved.origin,token:saved.token,fetchImpl});
  return Object.freeze({print:protectedPrint,read:args=>send('/api/local/client/memory',args),tools:()=>send('/api/local/client/tools'),mcp:message=>send('/api/local/client/mcp',message)});
}
export function protectedSelection(args,env){
  if(!args.includes('--protected-local-client'))return null;
  if(args.filter(x=>x==='--protected-local-client').length!==1||args.some(x=>['--hosted','--origin'].includes(x))||env.ANGBAO_AGENT_TOKEN||env.ANGBAO_REMOTE_ORIGIN)fail('Choose protected local access separately from hosted access.');
  if(!env.ANGBAO_LOCAL_CLIENT_FILE)fail('Set ANGBAO_LOCAL_CLIENT_FILE to the private client file path.');
  return args.filter(x=>x!=='--protected-local-client');
}
function flags(args,allowed){const result={};while(args.length){const key=args.shift(),value=args.shift();if(!allowed.includes(key)||Object.hasOwn(result,key)||typeof value!=='string'||value.startsWith('--'))fail('Use complete, unique options for this protected local command.');result[key]=value;}return result;}
async function dataJson(file){try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>16384)throw Error();return JSON.parse(await readFile(file,'utf8'));}catch{fail('Open the exact reference JSON file, under 16 KiB.');}}
export async function runProtectedAgent(args,{env=process.env,write=console.log,fetchImpl}={}){
  const remaining=protectedSelection(args,env);if(remaining===null)return false;
  if(remaining.shift()!=='memory'||remaining.shift()!=='read')fail('Use agent memory read --protected-local-client --reference FILE [--etag ETAG] [--max-age-ms AGE].');
  const opts=flags(remaining,['--reference','--etag','--max-age-ms']);if(!opts['--reference'])fail('Select an exact reference file.');
  const supplied=await dataJson(opts['--reference']),reference=supplied.reference??supplied;
  const maxAgeMs=opts['--max-age-ms']===undefined?undefined:Number(opts['--max-age-ms']);if(maxAgeMs!==undefined&&(!Number.isSafeInteger(maxAgeMs)||maxAgeMs<0))fail('Use a nonnegative whole age in milliseconds.');
  const client=await createProtectedLocalClient({file:env.ANGBAO_LOCAL_CLIENT_FILE,origin:env.ANGBAO_API_URL,fetchImpl});
  const result=await client.read({reference,...(opts['--etag']===undefined?{}:{expectedETag:opts['--etag']}),...(maxAgeMs===undefined?{}:{maxAgeMs})});write(client.print(result));return true;
}
export async function runProtectedOwner(command,args,{env=process.env,write=console.log,fetchImpl}={}){
  const action=command==='clients'?args.shift():command;
  const opts=flags(args,['--owner-file','--name','--scopes','--expires-at','--credential-out','--id','--out','--kind']);
  const allowed={issue:['--owner-file','--name','--scopes','--expires-at','--credential-out'],list:['--owner-file'],revoke:['--owner-file','--id'],'browser-pair':['--owner-file','--out'],'memory-reference':['--owner-file','--kind','--id','--out']}[action];
  if(!allowed||Object.keys(opts).some(k=>!allowed.includes(k))||allowed.some(k=>!opts[k]))fail('Provide the complete owner command options. Owner credentials must stay in a private file.');
  const saved=await privateJson(opts['--owner-file']);if(saved.format!=='angbao-local-owner@1'||typeof saved.token!=='string'||!/^alc_o_[a-f0-9-]{36}_[A-Za-z0-9_-]{43}$/.test(saved.token))fail('Use the original owner credential file.');
  const send=await transport({origin:env.ANGBAO_API_URL,token:saved.token,fetchImpl});let result;
  if(action==='issue')result=await send('/api/local/owner/clients/issue',{name:opts['--name'],scopes:opts['--scopes'].split(','),expiresAt:opts['--expires-at'],credentialOut:opts['--credential-out']});
  else if(action==='list')result=await send('/api/local/owner/clients');
  else if(action==='revoke')result=await send('/api/local/owner/clients/revoke',{id:opts['--id']});
  else if(action==='browser-pair')result=await send('/api/local/owner/browser-pair',{out:opts['--out']});
  else{
    result=await send('/api/local/owner/reference',{kind:opts['--kind'],recordId:opts['--id']});
    const{writePrivateLocalFile}=await import('../src/server/protected-local-runtime.mjs');writePrivateLocalFile(opts['--out'],result);result={referenceSaved:true,etag:result.etag};
  }
  write(protectedPrint(result));
}
