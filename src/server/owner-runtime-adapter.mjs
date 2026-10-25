/** Optional server-only runtime. Importing or constructing it performs no reads, SDK construction, or network I/O. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createZeroDevOwnerBridge, ZeroDevOwnerBridgeError, ZERO_DEV_OWNER_BRIDGE_VERSIONS } from '../integrations/zerodev-owner-bridge.mjs';
import { createGoalTransferReadAdapter } from '../integrations/goal-transfer-read.mjs';
import { validateGoalTransferIntent } from '../domain/goal-transfer.mjs';

if (typeof window !== 'undefined') throw new Error('Owner runtime is server-only.');
const EP = '0x0000000071727de22e5e9d8baf0edac6f37da032';
const GAS = ['callGasLimit','verificationGasLimit','preVerificationGas','paymasterVerificationGasLimit','paymasterPostOpGasLimit'];
const SDK_NAMES = ['createKernelAccount','createKernelAccountClient','createZeroDevPaymasterClient','signerToEcdsaValidator'];
const PRIMITIVE_NAMES = ['createPublicClient','custom','toAccount','getUserOperationHash','recoverMessageAddress'];
const CEILINGS = Object.freeze({prepare:Object.freeze({'execution:eth_chainId':1,'execution:eth_getCode':1,'execution:eth_call':1,'bundler:zd_getUserOperationGasPrice':1,'bundler:eth_estimateUserOperationGas':1,'paymaster:zd_sponsorUserOperation':2}),submit:Object.freeze({'bundler:eth_sendUserOperation':1}),observe:Object.freeze({'bundler:eth_getUserOperationReceipt':1,'chain:eth_chainId':1,'chain:eth_getTransactionByHash':1,'chain:eth_getTransactionReceipt':1,'chain:eth_getBlockByNumber':2,'chain:eth_blockNumber':1,'chain:eth_call':3,'chain:eth_getBalance':1,'chain:eth_getLogs':1})});
const LIMITS = Object.freeze({totalRequests:20,preparationRequests:7,submissionRequests:1,observationRequests:12,responseBytes:131072,observationPacketBytes:1048576,requestTimeoutMs:5000,packetTimeoutMs:30000});
const READ_LIMITS = Object.freeze({responseBytes:131072,packetBytes:1048576,requestTimeoutMs:5000,packetTimeoutMs:30000,packetRequests:12,baselineRequests:7,observationRequests:13,receiptOnlyRecoveryRequests:12,baselineRestoreRequests:6,freshWorkflowRequests:20,restoredContextRecoveryRequests:19,logBlockSpan:1});
const TOKEN_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v));
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : plain(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const equal = (a,b) => canonical(a) === canonical(b);
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const pick = (v,keys) => Object.fromEntries(keys.map(k => [k,v[k]]));
export class OwnerRuntimeAdapterError extends Error {
  constructor(code) { super(`The optional owner runtime stopped: ${code}.`); this.name='OwnerRuntimeAdapterError'; this.code=code; }
  toJSON() { return {name:this.name,code:this.code,message:this.message}; }
}
const fail = code => { throw new OwnerRuntimeAdapterError(code); };
function exact(v,keys) {
  if (!plain(v)) fail('invalid_configuration');
  const ds=Object.getOwnPropertyDescriptors(v);
  if (Reflect.ownKeys(ds).length!==keys.length || keys.some(k=>!Object.hasOwn(ds,k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value'))) fail('invalid_configuration');
}
function bounded(v,max=16384) {
  let count=0; const seen=new Set();
  function visit(x,depth) {
    if (++count>15000||depth>18) fail('invalid_configuration');
    if(x===null||typeof x==='boolean')return;
    if(typeof x==='string'){if(x.length>max)fail('invalid_configuration');return;}
    if(typeof x==='number'){if(!Number.isSafeInteger(x))fail('invalid_configuration');return;}
    if((!plain(x)&&!Array.isArray(x))||seen.has(x))fail('invalid_configuration');
    seen.add(x); const ds=Object.getOwnPropertyDescriptors(x);
    if(Array.isArray(x)&&Object.keys(x).length!==x.length)fail('invalid_configuration');
    for(const k of Reflect.ownKeys(ds)){if(Array.isArray(x)&&k==='length')continue;const d=ds[k];if(typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)||!d.enumerable||!Object.hasOwn(d,'value'))fail('invalid_configuration');visit(d.value,depth+1);}
    seen.delete(x);
  }
  visit(v,0);if(Buffer.byteLength(JSON.stringify(v))>max)fail('invalid_configuration');
}
const address=v=>{if(typeof v!=='string'||!/^0x[0-9a-f]{40}$/.test(v)||/^0x0{40}$/.test(v))fail('evidence_not_accepted');return v;};
const quantity=v=>{if(typeof v!=='string'||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(v))fail('read_plan_denied');return BigInt(v);};
const hash=v=>{if(typeof v!=='string'||!/^0x[0-9a-f]{64}$/.test(v))fail('read_plan_denied');return v;};
const integer=(v,max,zero=false)=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(v)||BigInt(v)>max||!zero&&v==='0')fail('evidence_not_accepted');return BigInt(v);};
function endpoint(v) {
  if(typeof v!=='string'||v.length>2048||v!==v.trim())fail('invalid_endpoint');
  let u;try{u=new URL(v);}catch{fail('invalid_endpoint');}
  const host=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  const local=host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||/^(?:0|10|127)\./.test(host)||/^169\.254\./.test(host)||/^192\.168\./.test(host)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)||host==='::1'||host==='::'||/^(?:fc|fd|fe80):/i.test(host)||host.startsWith('::ffff:');
  if(u.protocol!=='https:'||!host||local||u.username||u.password||u.hash)fail('invalid_endpoint');return u.href;
}

async function installedVersion(name) {
  const require=createRequire(import.meta.url);let directory;
  try{directory=path.dirname(require.resolve(name));}catch{fail('runtime_modules_unavailable');}
  for(let i=0;i<12;i++){
    try{const pkg=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));if(pkg.name===name)return pkg.version;}catch{/* Continue to the package root; never discover credentials or install packages. */}
    const parent=path.dirname(directory);if(parent===directory)break;directory=parent;
  }
  fail('runtime_modules_unavailable');
}
/** Test-injectable official loader; no import or filesystem read occurs before its returned function is called. */
export function createOfficialOwnerRuntimeLoader({importModule=specifier=>import(specifier),packageVersion=installedVersion}={}) {
  if(typeof importModule!=='function'||typeof packageVersion!=='function')fail('invalid_configuration');
  return async()=>{
    try{
      for(const [name,expected] of [['@zerodev/sdk','5.5.11'],['@zerodev/ecdsa-validator','5.4.9'],['viem','2.57.11']])if(await packageVersion(name)!==expected)fail('runtime_version_mismatch');
      const base=await importModule('@zerodev/sdk'),ecdsa=await importModule('@zerodev/ecdsa-validator'),viem=await importModule('viem'),accounts=await importModule('viem/accounts'),aa=await importModule('viem/account-abstraction');
      const sdk={...pick(base,SDK_NAMES.filter(k=>k!=='signerToEcdsaValidator')),signerToEcdsaValidator:ecdsa.signerToEcdsaValidator};
      const primitives={...pick(viem,['createPublicClient','custom','recoverMessageAddress']),toAccount:accounts.toAccount,getUserOperationHash:aa.getUserOperationHash};
      if([...Object.values(sdk),...Object.values(primitives)].some(v=>typeof v!=='function'))fail('runtime_exports_unavailable');
      return Object.freeze({sdk:Object.freeze(sdk),primitives:Object.freeze(primitives),versions:ZERO_DEV_OWNER_BRIDGE_VERSIONS});
    }catch(e){if(e instanceof OwnerRuntimeAdapterError)throw e;fail('runtime_modules_unavailable');}
  };
}

/**
 * acceptedEvidence is a private server resolver, never an HTTP body or an environment search.
 * sdk may be exact injected exports, or a lazy loader returning {sdk,primitives,versions}.
 * reserveRequest MUST atomically persist unique requestKey and enforce limits across restarts
 * before returning true. A permissive/RAM-only callback does not establish durable acceptance.
 * The seven preparation requests include mutable sponsorship/estimate APIs; a read grant
 * never authorizes them. No activation or capability changes are performed by this module.
 */
export function createOwnerRuntimeAdapter({acceptedEvidence=null,sdk=null,primitives=null,fetchImpl=null,now=()=>new Date(),reserveRequest=null}={}) {
  if(acceptedEvidence!==null&&typeof acceptedEvidence!=='function'||reserveRequest!==null&&typeof reserveRequest!=='function'||fetchImpl!==null&&typeof fetchImpl!=='function'||typeof now!=='function')fail('invalid_configuration');
  if(sdk!==null&&typeof sdk!=='function'&&!plain(sdk)||primitives!==null&&!plain(primitives)||typeof sdk==='function'&&primitives!==null)fail('invalid_configuration');
  const counters=new Map(),planScopes=new Map();let sequence=0,loaded=null;
  function time(){const d=now();if(!(d instanceof Date)||!Number.isFinite(d.getTime()))fail('invalid_clock');return d.getTime();}
  function grant(value,intent,phase){
    const keys=phase==='observe'?['intentDigest','scope','expiresAt','maxRequests']:['intentDigest','policy','expiresAt','maxRequests'];exact(value,keys);
    const max=phase==='observe'?12:phase==='prepare'?7:1,policy=phase==='observe'?'receipt-only-recovery':phase==='prepare'?'fixed-owner-preparation-seven-requests@1':'single-reviewed-owner-submission@1';
    if(value.intentDigest!==intent.intentDigest||value[phase==='observe'?'scope':'policy']!==policy||value.maxRequests!==max||typeof value.expiresAt!=='string'||!Number.isFinite(Date.parse(value.expiresAt))||new Date(Date.parse(value.expiresAt)).toISOString()!==value.expiresAt||Date.parse(value.expiresAt)<=time()||phase!=='observe'&&Date.parse(value.expiresAt)>Date.parse(intent.expiresAt))fail('request_policy_not_accepted');
  }
  async function accepted(intent,phase){
    if(typeof acceptedEvidence!=='function'||typeof reserveRequest!=='function')fail('runtime_not_configured');
    validateGoalTransferIntent(intent);let value;
    try{value=await acceptedEvidence(freeze(structuredClone(intent)),Object.freeze({purpose:phase}));}catch{fail('evidence_not_accepted');}
    bounded(value);exact(value,['format','versions','runtime','endpoints','preparationAuthorization','submissionAuthorization','readAuthorization']);
    if(value.format!=='angbao-accepted-owner-runtime@1'||!equal(value.versions,ZERO_DEV_OWNER_BRIDGE_VERSIONS))fail('evidence_not_accepted');
    const r=value.runtime;exact(r,['contextId','intentDigest','chainId','account','owner','paymaster','expiresAt','deployment','ownerValidation','tokenVerification','sponsorshipEvidence','limits']);
    if(typeof r.contextId!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(r.contextId)||r.intentDigest!==intent.intentDigest||r.chainId!==46630||r.account!==intent.account||r.deployment!=='existing-account-and-token-source-verified'||r.ownerValidation!=='ecdsa-root-no-hook-verified'||r.tokenVerification!=='test-token-recipient-and-balance-verified')fail('evidence_not_accepted');
    address(r.account);address(r.owner);address(r.paymaster);exact(r.sponsorshipEvidence,['id','digest','coverage','expiresAt']);
    const s=r.sponsorshipEvidence;
    if(typeof s.id!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(s.id)||typeof s.digest!=='string'||!/^[a-f0-9]{64}$/.test(s.digest)||s.coverage!=='accepted-no-card-all-gas-premium-usage-zero-paid-fallback')fail('evidence_not_accepted');
    for(const expires of [r.expiresAt,s.expiresAt])if(typeof expires!=='string'||!Number.isFinite(Date.parse(expires))||new Date(expires).toISOString()!==expires||Date.parse(expires)>Date.parse(intent.expiresAt)||phase!=='observe'&&Date.parse(expires)<=time())fail('evidence_expired');
    exact(r.limits,[...GAS,'maxFeePerGas','maxPriorityFeePerGas','maxTotalCostWei']);GAS.forEach(k=>integer(r.limits[k],1000000n));
    const fee=integer(r.limits.maxFeePerGas,1000000000n);integer(r.limits.maxPriorityFeePerGas,fee,true);const cap=integer(r.limits.maxTotalCostWei,1000000000000000n);if(GAS.reduce((sum,k)=>sum+BigInt(r.limits[k]),0n)*fee>cap)fail('evidence_not_accepted');
    exact(value.endpoints,['execution','chain','bundler','paymaster']);Object.values(value.endpoints).forEach(endpoint);
    const selected=phase==='observe'?value.readAuthorization:phase==='submit'?value.submissionAuthorization:value.preparationAuthorization;
    if(selected===null)fail('request_policy_not_accepted');grant(selected,intent,phase);
    if(phase!=='observe'&&(time()<Date.parse(intent.createdAt)||time()>=Date.parse(intent.expiresAt)))fail('evidence_expired');
    return freeze(structuredClone(value));
  }
  async function dependencies(){
    if(!loaded)loaded=(async()=>{
      const value=typeof sdk==='function'?await sdk():sdk===null?await createOfficialOwnerRuntimeLoader()():{sdk,primitives,versions:ZERO_DEV_OWNER_BRIDGE_VERSIONS};
      exact(value,['sdk','primitives','versions']);if(!equal(value.versions,ZERO_DEV_OWNER_BRIDGE_VERSIONS))fail('runtime_version_mismatch');
      exact(value.sdk,SDK_NAMES);exact(value.primitives,PRIMITIVE_NAMES);if([...Object.values(value.sdk),...Object.values(value.primitives)].some(v=>typeof v!=='function'))fail('runtime_exports_unavailable');
      return {sdk:Object.freeze({...value.sdk}),primitives:Object.freeze({...value.primitives})};
    })();
    try{return await loaded;}catch(e){if(e instanceof OwnerRuntimeAdapterError)throw e;fail('runtime_modules_unavailable');}
  }
  async function reserve(context,intent,phase,role,method){
    const methodKey=`${role}:${method}`,max=CEILINGS[phase]?.[methodKey];if(!max)fail('request_denied');
    const scope=`${context.runtime.contextId}:${intent.intentDigest}`,countKey=`${scope}:${phase}:${methodKey}`;
    const occurrence=(counters.get(countKey)??0)+1;counters.set(countKey,occurrence);
    const totalKey=`${scope}:total`,total=(counters.get(totalKey)??0)+1;counters.set(totalKey,total);
    if(occurrence>max||total>20)fail('request_budget_used');
    const requestKey=createHash('sha256').update(canonical({contextId:context.runtime.contextId,intentDigest:intent.intentDigest,phase,role,method,occurrence})).digest('hex');
    const record=freeze({format:'angbao-owner-runtime-request-reservation@1',contextId:context.runtime.contextId,intentDigest:intent.intentDigest,phase,role,method,occurrence,maximumOccurrences:max,requestKey,limits:LIMITS});
    let result;try{result=await reserveRequest(record);}catch{fail('durable_reservation_required');}if(result!==true)fail('durable_reservation_required');
  }
  async function rpc(context,intent,phase,role,request,externalSignal=null){
    bounded(request,131072);exact(request,['method','params']);
    const controller=new AbortController(),abort=()=>controller.abort();externalSignal?.addEventListener('abort',abort,{once:true});
    let timer;
    const work=async()=>{
      await reserve(context,intent,phase,role,request.method);
      const fresh=await accepted(intent,phase);if(!equal(fresh,context))fail('accepted_context_changed');
      if(controller.signal.aborted||externalSignal?.aborted)fail('provider_timeout');
      let response;const id=++sequence;
      try{response=await (fetchImpl??globalThis.fetch)(endpoint(context.endpoints[role]),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,...request}),signal:controller.signal,redirect:'error',cache:'no-store'});}catch{fail(controller.signal.aborted?'provider_timeout':'provider_unavailable');}
      if(!response?.ok){controller.abort();try{await response?.body?.cancel();}catch{}fail('provider_rejected');}
      let text='',bytes=0;
      try{
        if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>131072){controller.abort();await reader.cancel();fail('response_too_large');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
        else{text=await response.text();bytes=Buffer.byteLength(text);if(bytes>131072)fail('response_too_large');}
      }catch(e){if(e instanceof OwnerRuntimeAdapterError)throw e;fail(controller.signal.aborted?'provider_timeout':'provider_unavailable');}
      let parsed;try{parsed=JSON.parse(text);}catch{fail('invalid_provider_response');}
      bounded(parsed,131072);if(!plain(parsed)||parsed.jsonrpc!=='2.0'||parsed.id!==id||!Object.hasOwn(parsed,'result')||Object.hasOwn(parsed,'error'))fail('invalid_provider_response');
      return parsed.result;
    };
    try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new OwnerRuntimeAdapterError('provider_timeout'));},5000);})]);}
    catch(e){if(e instanceof OwnerRuntimeAdapterError)throw e;fail('provider_unavailable');}
    finally{clearTimeout(timer);externalSignal?.removeEventListener('abort',abort);}
  }
  function checkPlan(plan,intent){
    bounded(plan,32768);exact(plan,['format','phase','scope','maximumScopeRequests','alreadyAttemptedRequests','intentDigest','chainId','requests','limits','authority','signingAllowed','deploymentAllowed','submissionAllowed']);
    if(plan.format!=='angbao-goal-transfer-read-plan@1'||plan.intentDigest!==intent.intentDigest||plan.chainId!==46630||plan.scope!=='receipt-only-recovery'||plan.maximumScopeRequests!==12||!equal(plan.limits,READ_LIMITS)||plan.authority!=='read-only-exact-packet'||[plan.signingAllowed,plan.deploymentAllowed,plan.submissionAllowed].some(v=>v!==false)||!Array.isArray(plan.requests))fail('read_plan_denied');
    const sequence=plan.phase==='observation-discovery'?[['bundler','eth_getUserOperationReceipt']]:plan.phase==='observation-transaction'?[['chain','eth_chainId'],['chain','eth_getTransactionByHash'],['chain','eth_getTransactionReceipt']]:plan.phase==='observation-snapshot'?[['chain','eth_getBlockByNumber'],['chain','eth_blockNumber'],['chain','eth_call'],['chain','eth_call'],['chain','eth_getBalance'],['chain','eth_call'],['chain','eth_getLogs'],['chain','eth_getBlockByNumber']]:null;
    const prior=plan.phase==='observation-discovery'?0:plan.phase==='observation-transaction'?1:4;
    if(!sequence||plan.requests.length!==sequence.length||plan.alreadyAttemptedRequests!==prior)fail('read_plan_denied');
    let transactionHash=null,blockNumber=null,blockHash=null;
    for(let i=0;i<sequence.length;i++){
      const request=plan.requests[i],optional=plan.phase==='observation-snapshot'&&i>=2&&i<=6;
      exact(request,optional?['service','method','params','optionalContext']:['service','method','params']);
      if(!equal([request.service,request.method],sequence[i])||optional&&request.optionalContext!==true||!Array.isArray(request.params))fail('read_plan_denied');
      const p=request.params,m=request.method;
      if(m==='eth_chainId'||m==='eth_blockNumber'){if(p.length)fail('read_plan_denied');}
      else if(m==='eth_getUserOperationReceipt'){if(p.length!==1)fail('read_plan_denied');hash(p[0]);}
      else if(['eth_getTransactionByHash','eth_getTransactionReceipt'].includes(m)){if(p.length!==1)fail('read_plan_denied');hash(p[0]);if(transactionHash!==null&&transactionHash!==p[0])fail('read_plan_denied');transactionHash=p[0];}
      else if(m==='eth_getBlockByNumber'){if(p.length!==2||p[1]!==false)fail('read_plan_denied');quantity(p[0]);if(blockNumber!==null&&blockNumber!==p[0])fail('read_plan_denied');blockNumber=p[0];}
      else if(m==='eth_getLogs'){if(p.length!==1)fail('read_plan_denied');exact(p[0],['address','fromBlock','toBlock','topics']);if(p[0].address!==intent.token.address||p[0].fromBlock!==blockNumber||p[0].toBlock!==blockNumber||!equal(p[0].topics,[TOKEN_TOPIC]))fail('read_plan_denied');}
      else{
        if(p.length!==2)fail('read_plan_denied');exact(p[1],['blockHash','requireCanonical']);hash(p[1].blockHash);if(p[1].requireCanonical!==true||blockHash!==null&&blockHash!==p[1].blockHash)fail('read_plan_denied');blockHash=p[1].blockHash;
        if(m==='eth_getBalance'){if(p[0]!==intent.account)fail('read_plan_denied');}
        else{exact(p[0],['to','data']);const account=i===3?intent.recipient:intent.account;const to=i===5?EP:intent.token.address;const data=`0x70a08231${account.slice(2).padStart(64,'0')}`;if(p[0].to!==to||p[0].data!==data)fail('read_plan_denied');}
      }
    }
  }
  async function authorizeReadPlan(plan,{intent}={}){
    try{const selected=validateGoalTransferIntent(intent);await accepted(selected,'observe');checkPlan(plan,selected);return true;}catch{return false;}
  }
  async function bridgeFactory({intent,reserveSubmission}={}){
    const selected=freeze(structuredClone(validateGoalTransferIntent(intent))),context=await accepted(selected,'prepare');
    if(typeof reserveSubmission!=='function')fail('durable_submission_required');
    const deps=await dependencies();
    const bridge=createZeroDevOwnerBridge({...deps,now,reserveSubmission,resolveAcceptedRuntime:async(value,{phase})=>{
      if(value.intentDigest!==selected.intentDigest)fail('intent_mismatch');
      const current=await accepted(value,['submission','broadcast'].includes(phase)?'submit':'prepare');if(!equal(current,context))fail('accepted_context_changed');return current.runtime;
    },requestRpc:(role,request,{signal})=>rpc(context,selected,request.method==='eth_sendUserOperation'?'submit':'prepare',role,request,signal)});
    // SDK errors can contain RPC URLs or signatures. Keep only our own static errors.
    const redact=error=>{if(error instanceof OwnerRuntimeAdapterError||error instanceof ZeroDevOwnerBridgeError)throw error;fail('bridge_unavailable');};
    return Object.freeze({
      prepare:async(...args)=>{try{return await bridge.prepare(...args);}catch(e){redact(e);}},
      requestWalletSignature:async(...args)=>{try{return await bridge.requestWalletSignature(...args);}catch(e){redact(e);}},
      submitSigned:async(...args)=>{try{return await bridge.submitSigned(...args);}catch(e){redact(e);}},
      status:(...args)=>{try{return bridge.status(...args);}catch(e){redact(e);}},
    });
  }
  async function readerFactory({intent,authorizePlan}={}){
    const selected=freeze(structuredClone(validateGoalTransferIntent(intent))),context=await accepted(selected,'observe');
    if(typeof authorizePlan!=='function')fail('read_plan_denied');
    const scopeKey=`${context.runtime.contextId}:${selected.intentDigest}`;if(planScopes.has(scopeKey))fail('read_scope_already_created');
    const scope={packets:new Set(),tickets:[],totalBytes:0};planScopes.set(scopeKey,scope);
    return createGoalTransferReadAdapter({chainRpcUrl:context.endpoints.chain,bundlerRpcUrl:context.endpoints.bundler,authorizePlan:async plan=>{
      checkPlan(plan,selected);const current=await accepted(selected,'observe');if(!equal(current,context)||scope.packets.has(plan.phase)||await authorizePlan(plan)!==true)return false;
      scope.packets.add(plan.phase);scope.tickets.push(...plan.requests.map(r=>({role:r.service,method:r.method,params:r.params})));return true;
    },fetchImpl:async(url,options)=>{
      let body;try{body=JSON.parse(options.body);}catch{fail('request_denied');}
      const ticket=scope.tickets.shift();if(!ticket||url!==endpoint(context.endpoints[ticket.role])||body.method!==ticket.method||!equal(body.params,ticket.params))fail('request_denied');
      const result=await rpc(context,selected,'observe',ticket.role,{method:ticket.method,params:ticket.params},options.signal);
      const encoded=JSON.stringify({jsonrpc:'2.0',id:body.id,result});scope.totalBytes+=Buffer.byteLength(encoded);if(scope.totalBytes>1048576)fail('packet_response_too_large');
      return new Response(encoded,{status:200,headers:{'content-type':'application/json'}});
    }});
  }
  return Object.freeze({bridgeFactory,readerFactory,authorizeReadPlan});
}
