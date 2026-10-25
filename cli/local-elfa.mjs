import {readFileSync} from 'node:fs';
/** Explicit owner-local provider profile. No HTTP inheritance or raw credential options. */
import {readPrivateJson} from '../src/server/local-elfa-private-files.mjs';
import {createLocalElfaRuntime,provisionLocalElfa,localElfaJson} from '../src/server/local-elfa-runtime.mjs';
import {RemoteError,MCP_VERSION} from './remote.mjs';
const fail=()=>{throw new RemoteError('Local evidence access was not confirmed. Inspect the original operation status and retained files before trying again. No retry, fallback or workspace save was sent.');};
export const LOCAL_ELFA_TOOLS=Object.freeze([
  {name:'angbao_preview_elfa_events',description:'Preview one exact source query, receiving agent, limits and private evidence retention. Does not approve or fetch.',inputSchema:{type:'object',properties:{operationId:{type:'string',minLength:1,maxLength:200},query:{type:'object',properties:{q:{type:'string'},entityIds:{type:'array',items:{type:'string'},maxItems:10},from:{type:'integer'},to:{type:'integer'},limit:{type:'integer',minimum:1,maximum:10}},required:['from','to','limit'],additionalProperties:false}},required:['operationId','query'],additionalProperties:false}},
  ...['angbao_fetch_elfa_events','angbao_read_elfa_operation','angbao_read_elfa_evidence'].map(name=>({name,description:name==='angbao_fetch_elfa_events'?'Fetch once using a previously owner-approved disclosure. Retains exact evidence privately; does not synthesize or save a brief/portfolio.':name==='angbao_read_elfa_operation'?'Inspect exact consent, conservative provider hold and artifact status without fetching.':'Read one exact retained historical evidence artifact, not current provider truth. No fetch.',inputSchema:{type:'object',properties:{operationId:{type:'string',minLength:1,maxLength:200},expectedDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['operationId','expectedDigest'],additionalProperties:false}})),
]);
function profile(env){if(env.ANGBAO_AGENT_TOKEN||env.ANGBAO_REMOTE_ORIGIN||env.ANGBAO_LOCAL_CLIENT_FILE)throw new RemoteError('Choose the owner-local evidence profile separately from hosted or protected read-only client credentials.');}
function metadata(params){
  if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(k=>!['name','arguments','_meta'].includes(k))||typeof params.name!=='string'||!Object.hasOwn(params,'arguments'))fail();
  if(Object.hasOwn(params,'_meta')){
    const meta=params._meta;if(!meta||typeof meta!=='object'||Array.isArray(meta)||![Object.prototype,null].includes(Object.getPrototypeOf(meta))||Buffer.byteLength(JSON.stringify(meta))>2048)fail();
    let count=0;const check=(v,d)=>{if(++count>128||d>4)fail();if(v===null||['string','boolean'].includes(typeof v)||typeof v==='number'&&Number.isFinite(v))return;if(!v||typeof v!=='object')fail();for(const key of Object.keys(v)){if(['__proto__','prototype','constructor'].includes(key))fail();check(v[key],d+1);}};check(meta,0);
    if(Object.hasOwn(meta,'progressToken')&&!(typeof meta.progressToken==='string'&&meta.progressToken.length<=200||typeof meta.progressToken==='number'&&Number.isFinite(meta.progressToken)))fail();
  }
  return {name:params.name,arguments:params.arguments};
}
export function createLocalElfaClient({operatorFile,fetchImpl,now,checkpoint}={}){
  let runtime;try{runtime=createLocalElfaRuntime({operatorFile,fetchImpl,now,checkpoint});}catch{fail();}
  const replies=new WeakMap();
  return Object.freeze({
    close:()=>runtime.close(),
    print(value){try{const text=localElfaJson(value),nested=replies.get(value);if(nested)runtime.print(nested);return text;}catch{fail();}},
    async mcp(message){
      try{
        if(message.method==='initialize')return {jsonrpc:'2.0',id:message.id,result:{protocolVersion:MCP_VERSION,capabilities:{tools:{}},serverInfo:{name:'angbao-local-elfa-operator',version:'source-candidate'},instructions:'Explicit same-OS-user evidence profile. Approval is a separate owner CLI action; no tool can approve itself. No workspace write, model or financial authority.'}};
        if(message.method==='notifications/initialized')return null;
        if(message.method==='tools/list')return {jsonrpc:'2.0',id:message.id,result:{tools:structuredClone(LOCAL_ELFA_TOOLS)}};
        if(message.method==='ping')return {jsonrpc:'2.0',id:message.id,result:{}};
        if(message.method!=='tools/call')fail();const params=metadata(message.params),args=params.arguments;
        const methods={angbao_preview_elfa_events:'preview',angbao_fetch_elfa_events:'fetchEvidence',angbao_read_elfa_operation:'status',angbao_read_elfa_evidence:'readEvidence'};if(!Object.hasOwn(methods,params.name))fail();
        const value=await runtime[methods[params.name]](args),text=localElfaJson(value),reply={jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text}],structuredContent:value,isError:false}};
        replies.set(reply,value);return reply;
      }catch{fail();}
    },
  });
}
export function selectLocalElfa(args,env){
  if(!args.includes('--local-elfa-operator'))return false;
  if(args.length!==1||!env.ANGBAO_LOCAL_ELFA_OPERATOR_FILE)throw new RemoteError('Use mcp --local-elfa-operator with ANGBAO_LOCAL_ELFA_OPERATOR_FILE set to the private descriptor path.');profile(env);return true;
}
export async function runLocalElfaCommand(args,{env=process.env,write=(value,{raw=false}={})=>raw?process.stdout.write(value):console.log(value),fetchImpl,now,checkpoint}={}){
  let command=args.shift();
  if(command==='guide'){
    const topics={setup:'docs/product/local-elfa-operator-handoff.md',connection:'CLI-DISTRIBUTION.md','research-memory':'docs/product/research-work-memory.md',portfolio:'docs/product/manual-research-portfolio.md'};
    const topic=args.length===0?'setup':args.length===2&&args[0]==='--topic'?args[1]:null;
    if(!Object.hasOwn(topics,topic??''))throw new RemoteError('Use elfa guide [--topic setup|connection|research-memory|portfolio]. No setup or credential is needed.');
    write(readFileSync(new URL('../'+topics[topic],import.meta.url),'utf8'),{raw:true});return;
  }
  profile(env);if(command==='evidence'){if(args.shift()!=='read')fail();command='readEvidence';}
  const options={};while(args.length){const k=args.shift(),v=args.shift();if(!['--operator-file','--data-file','--private-dir','--operation','--preview-digest','--query-file'].includes(k)||Object.hasOwn(options,k)||typeof v!=='string'||v.startsWith('--'))fail();options[k]=v;}
  const allowed={provision:['--operator-file','--data-file','--private-dir'],preview:['--operator-file','--operation','--query-file'],approve:['--operator-file','--operation','--preview-digest'],fetch:['--operator-file','--operation','--preview-digest'],status:['--operator-file','--operation','--preview-digest'],revoke:['--operator-file','--operation','--preview-digest'],readEvidence:['--operator-file','--operation','--preview-digest']}[command];
  if(!allowed||Object.keys(options).length!==allowed.length||allowed.some(k=>!options[k]))fail();
  let runtime;try{
    if(command==='provision'){write(localElfaJson(provisionLocalElfa({operatorFile:options['--operator-file'],dataFile:options['--data-file'],privateDir:options['--private-dir']})));return;}
    runtime=createLocalElfaRuntime({operatorFile:options['--operator-file'],fetchImpl,now,checkpoint});
    const input=command==='preview'?{operationId:options['--operation'],query:readPrivateJson(options['--query-file'],16384)}:{operationId:options['--operation'],expectedDigest:options['--preview-digest']};
    const result=await runtime[command==='fetch'?'fetchEvidence':command](input);write(runtime.print(result));
  }catch{fail();}finally{runtime?.close();}
}
