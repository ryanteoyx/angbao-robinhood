import { createHash } from 'node:crypto';
import { validateGoalTransferIntent } from '../domain/goal-transfer.mjs';
import { parseAbi, encodeFunctionData, decodeFunctionResult } from '../vendor/kernel-identity-codecs.mjs';
import { encodeAbiParameters } from '../vendor/goal-transfer-viem.mjs';

if (typeof window !== 'undefined') throw new Error('Owner identity verification is server-only.');
const IMPLEMENTATION = '0xbac849bb641841b44e965fb01a4bf5f074f84b4d';
const VALIDATOR = '0x845adb2c711129d4f3966735ed98a9f09fc4ce57';
const ENTRY = '0x0000000071727de22e5e9d8baf0edac6f37da032';
const ROOT = `0x01${VALIDATOR.slice(2)}`;
const HOOK = '0x0000000000000000000000000000000000000001';
const SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const NONCE_KEY = BigInt(`0x0000${VALIDATOR.slice(2)}0000`);
const LIMITS = Object.freeze({ requests:20, packetRequests:12, responseBytes:131072, packetBytes:1048576, requestTimeoutMs:5000, packetTimeoutMs:30000 });
const ABI = parseAbi([
  'function entrypoint() view returns (address)', 'function rootValidator() view returns (bytes21)',
  'function validationConfig(bytes21) view returns ((uint32 nonce,address hook))',
  'function eip712Domain() view returns (bytes1 fields,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt,uint256[] extensions)',
  'function ecdsaValidatorStorage(address) view returns (address)', 'function getNonce(address,uint192) view returns (uint256)',
  'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)',
]);
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const digest = v => createHash('sha256').update(canonical(v)).digest('hex');
const hexHash = v => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v);
const sha = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const addr = v => typeof v === 'string' && /^0x[0-9a-f]{40}$/.test(v) && v !== `0x${'0'.repeat(40)}`;
const exact = (v, keys) => v && Object.getPrototypeOf(v) === Object.prototype && Reflect.ownKeys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k) && Object.getOwnPropertyDescriptor(v,k).enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
export class OwnerIdentityError extends Error { constructor(code) { super(`Owner identity verification stopped: ${code}.`); this.name='OwnerIdentityError'; this.code=code; } }
const fail = code => { throw new OwnerIdentityError(code); };
const quantity = v => { if (typeof v !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(v)) fail('malformed_result'); return BigInt(v); };
function endpoint(v) { let u; try { u=new URL(v); } catch { fail('configuration'); } if (u.protocol!=='https:' || u.username || u.password || u.hash || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[|.*\.(local|internal)$)/i.test(u.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)) fail('configuration'); return u.href; }
function source(v,intent) {
  if (!exact(v,['format','chainId','tokenAddress','provenanceDigest','codeHashes']) || v.format!=='angbao-owner-identity-source@1' || v.chainId!==46630 || v.tokenAddress!==intent.token.address || !sha(v.provenanceDigest) || !exact(v.codeHashes,['account','implementation','validator','entryPoint','token']) || !Object.values(v.codeHashes).every(sha)) fail('source_not_accepted');
  return structuredClone(v);
}
function checkInput(v,now) { if (!exact(v,['intent','expectedOwner'])) fail('invalid_input'); try { validateGoalTransferIntent(v.intent); } catch { fail('invalid_intent'); } if (!addr(v.expectedOwner) || v.expectedOwner===v.intent.account || Date.parse(v.intent.createdAt)>now || Date.parse(v.intent.expiresAt)<=now) fail('intent_not_current'); return structuredClone(v); }
function header(v) { if (!v || !hexHash(v.hash)) fail('malformed_result'); return {number:quantity(v.number).toString(),hash:v.hash,timestamp:quantity(v.timestamp).toString()}; }
function code(v) { if (typeof v!=='string' || !/^0x(?:[0-9a-f]{2})+$/.test(v)) fail('source_mismatch'); return createHash('sha256').update(Buffer.from(v.slice(2),'hex')).digest('hex'); }
function unpack(name,v) { try { const result=decodeFunctionResult({abi:ABI,functionName:name,data:v}); if (encodeResultLengthInvalid(name,v)) fail('malformed_result'); const outputs=ABI.find(item=>item.type==='function' && item.name===name).outputs; if(encodeAbiParameters(outputs,outputs.length===1?[result]:result)!==v) fail('malformed_result'); return result; } catch { fail('malformed_result'); } }
function encodeResultLengthInvalid(name,v) { return typeof v!=='string' || !/^0x[0-9a-f]+$/.test(v) || (name!=='eip712Domain' && v.length!==(name==='validationConfig'?130:66)); }

/** Integrity of historical facts only. Never recreates a live observation brand. */
export function validateOwnerIdentityObservation(intent, value) {
  try { validateGoalTransferIntent(intent); } catch { fail('invalid_intent'); }
  const keys=['format','intentDigest','chainId','account','owner','implementation','validator','entryPoint','rootValidator','validationNonce','hook','nonceKey','nonce','domain','token','recipient','block','sourceProvenanceDigest','codeHashes','observedAt','expiresAt','requests','ownerPossessionEstablished','sponsorshipEstablished','authority','observationDigest'];
  if (!exact(value,keys) || value.format!=='angbao-owner-identity-observation@1' || !sha(value.intentDigest) || value.chainId!==46630 || !addr(value.account) || !addr(value.owner) || value.account===value.owner || value.implementation!==IMPLEMENTATION || value.validator!==VALIDATOR || value.entryPoint!==ENTRY || value.rootValidator!==ROOT || value.hook!==HOOK || !/^[1-9][0-9]*$/.test(value.validationNonce) || BigInt(value.validationNonce)>0xffffffffn || value.nonceKey!==NONCE_KEY.toString() || !/^(0|[1-9][0-9]*)$/.test(value.nonce) || BigInt(value.nonce)>=(1n<<256n) || BigInt(value.nonce)>>64n!==NONCE_KEY) fail('invalid_observation');
  if (!exact(value.domain,['fields','name','version','chainId','verifyingContract','salt','extensions']) || value.domain.fields!=='0x0f' || value.domain.name!=='Kernel' || value.domain.version!=='0.3.1' || value.domain.chainId!==46630 || value.domain.verifyingContract!==value.account || value.domain.salt!==`0x${'0'.repeat(64)}` || !Array.isArray(value.domain.extensions) || value.domain.extensions.length) fail('invalid_observation');
  if (!exact(value.token,['address','decimals','balanceAtomic','requiredAtomic']) || !addr(value.token.address) || !Number.isInteger(value.token.decimals) || value.token.decimals<0 || value.token.decimals>18 || !/^(0|[1-9][0-9]*)$/.test(value.token.balanceAtomic) || !/^[1-9][0-9]*$/.test(value.token.requiredAtomic) || BigInt(value.token.balanceAtomic)<BigInt(value.token.requiredAtomic) || BigInt(value.token.balanceAtomic)>=(1n<<256n) || !exact(value.recipient,['address','code']) || !addr(value.recipient.address) || value.recipient.code!=='0x' || [value.account,value.token.address].includes(value.recipient.address)) fail('invalid_observation');
  if (!exact(value.block,['number','hash','timestamp']) || !/^(0|[1-9][0-9]*)$/.test(value.block.number) || !/^(0|[1-9][0-9]*)$/.test(value.block.timestamp) || !hexHash(value.block.hash) || !sha(value.sourceProvenanceDigest) || !exact(value.codeHashes,['account','implementation','validator','entryPoint','token']) || !Object.values(value.codeHashes).every(sha) || value.requests!==20 || value.ownerPossessionEstablished!==false || value.sponsorshipEstablished!==false || value.authority!=='none') fail('invalid_observation');
  const start=Date.parse(value.observedAt),end=Date.parse(value.expiresAt); if (!Number.isFinite(start) || new Date(start).toISOString()!==value.observedAt || !Number.isFinite(end) || new Date(end).toISOString()!==value.expiresAt || end<=start || end-start>300000 || Number(value.block.timestamp)*1000>start+30000 || start-Number(value.block.timestamp)*1000>300000) fail('invalid_observation');
  if (value.intentDigest!==intent.intentDigest || value.account!==intent.account || value.token.address!==intent.token.address || value.token.decimals!==intent.token.decimals || value.token.requiredAtomic!==intent.amountAtomic || value.recipient.address!==intent.recipient || end>Date.parse(intent.expiresAt) || start<Date.parse(intent.createdAt)) fail('invalid_observation');
  const {observationDigest,...body}=value; if (!sha(observationDigest) || digest(body)!==observationDigest) fail('invalid_observation');
  return freeze(structuredClone(value));
}

/** Construction and planning perform no I/O. Authorization and durable reservation are required for every request. */
export function createOwnerIdentityExecutor({resolveSourceArtifacts=async()=>null,chainRpcUrl=null,bundlerRpcUrl=null,fetchImpl=globalThis.fetch,authorizePlan=async()=>false,reserveRequest=async()=>false,now=()=>new Date()}={}) {
  const trusted=new WeakSet(),attempted=new Set();
  const clock=()=>{const v=now();const n=v instanceof Date?v.getTime():NaN;if(!Number.isFinite(n))fail('configuration');return n;};
  async function resolve(input) { const checked=checkInput(input,clock()); let artifacts;try{artifacts=source(await resolveSourceArtifacts(structuredClone(checked)),checked.intent);}catch{fail('source_not_accepted');}return {...checked,artifacts}; }
  async function plan(input) { const c=await resolve(input);return freeze({format:'angbao-owner-identity-plan@1',scope:'existing-owner-identity',intentDigest:c.intent.intentDigest,sourceProvenanceDigest:c.artifacts.provenanceDigest,requests:20,packets:[12,8],limits:LIMITS}); }
  async function execute(input) {
    const {intent,expectedOwner,artifacts}=await resolve(input); if(attempted.has(intent.intentDigest))fail('scope_used');attempted.add(intent.intentDigest);
    const chain=endpoint(chainRpcUrl),bundler=endpoint(bundlerRpcUrl);let count=0,packetBytes=0,packetStart=clock(),snapshot;
    async function read(role,method,params) {
      if(count>=20 || clock()-packetStart>30000 || Date.parse(intent.expiresAt)<=clock())fail('scope_expired');
      const index=count+1,packet=index<=12?'A':'B'; if(index===13){packetBytes=0;packetStart=clock();}
      const proposal=freeze({format:'angbao-owner-identity-read-plan@1',scope:'existing-owner-identity',intentDigest:intent.intentDigest,sourceProvenanceDigest:artifacts.provenanceDigest,requestCount:1,alreadyAttempted:count,index,packet,role,method,params:structuredClone(params),limits:LIMITS});
      const requestKey=digest(proposal);let accepted=false;try{accepted=await authorizePlan(proposal)===true;}catch{}if(!accepted)fail('authorization_denied');
      let reserved=false;try{reserved=await reserveRequest(freeze({scope:'existing-owner-identity',intentDigest:intent.intentDigest,sourceProvenanceDigest:artifacts.provenanceDigest,index,packet,role,method,requestKey}))===true;}catch{}if(!reserved)fail('reservation_denied');
      count++; if(clock()-packetStart>30000 || Date.parse(intent.expiresAt)<=clock())fail('scope_expired'); const controller=new AbortController(); let timer;
      try {
        const result=await Promise.race([(async()=>{
          const response=await fetchImpl(role==='execution'?chain:bundler,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:index,method,params}),signal:controller.signal});
          if(!response?.ok)fail('transport');let text='',size=0;
          if(!response.body?.getReader)fail('malformed_rpc');const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
          try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>131072 || packetBytes+size>1048576){controller.abort();await reader.cancel();fail('response_too_large');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
          packetBytes+=size;let rpc;try{rpc=JSON.parse(text);}catch{fail('malformed_rpc');}if(!exact(rpc,['jsonrpc','id','result']) || rpc.jsonrpc!=='2.0' || rpc.id!==index)fail('malformed_rpc');return rpc.result;
        })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new OwnerIdentityError('timeout'));},Math.min(5000,Math.max(1,30000-(clock()-packetStart))));})]);
        if(clock()-packetStart>30000 || Date.parse(intent.expiresAt)<=clock())fail('scope_expired');return result;
      }catch(error){if(error instanceof OwnerIdentityError)throw error;fail('transport');}finally{clearTimeout(timer);controller.abort();}
    }
    const state=()=>({blockHash:snapshot.hash,requireCanonical:true});
    const call=(to,name,args=[])=>read('execution','eth_call',[{to,data:encodeFunctionData({abi:ABI,functionName:name,args})},state()]).then(v=>unpack(name,v));
    if(quantity(await read('execution','eth_chainId',[]))!==46630n)fail('wrong_chain');
    snapshot=header(await read('execution','eth_getBlockByNumber',['latest',false]));
    if(clock()-Number(snapshot.timestamp)*1000>300000 || Number(snapshot.timestamp)*1000>clock()+30000)fail('stale_block');
    const hashes={account:code(await read('execution','eth_getCode',[intent.account,state()]))};if(hashes.account!==artifacts.codeHashes.account)fail('source_mismatch');
    const slot=await read('execution','eth_getStorageAt',[intent.account,SLOT,state()]);if(slot!==`0x${IMPLEMENTATION.slice(2).padStart(64,'0')}`)fail('implementation_mismatch');
    for(const [key,address] of [['implementation',IMPLEMENTATION],['validator',VALIDATOR],['entryPoint',ENTRY],['token',intent.token.address]]){hashes[key]=code(await read('execution','eth_getCode',[address,state()]));if(hashes[key]!==artifacts.codeHashes[key])fail('source_mismatch');}
    if((await call(intent.account,'entrypoint')).toLowerCase()!==ENTRY)fail('entrypoint_mismatch');
    if((await call(intent.account,'rootValidator')).toLowerCase()!==ROOT)fail('root_mismatch');
    const config=await call(intent.account,'validationConfig',[ROOT]);if(config.nonce<=0 || config.hook.toLowerCase()!==HOOK)fail('hook_or_config_mismatch');
    const domain=await call(intent.account,'eip712Domain');if(domain[0]!=='0x0f' || domain[1]!=='Kernel' || domain[2]!=='0.3.1' || domain[3]!==46630n || domain[4].toLowerCase()!==intent.account || domain[5]!==`0x${'0'.repeat(64)}` || domain[6].length)fail('domain_mismatch');
    if((await call(VALIDATOR,'ecdsaValidatorStorage',[intent.account])).toLowerCase()!==expectedOwner)fail('owner_mismatch');
    const nonce=await call(ENTRY,'getNonce',[intent.account,NONCE_KEY]);if(nonce>>64n!==NONCE_KEY)fail('nonce_mismatch');
    const decimals=await call(intent.token.address,'decimals');if(Number(decimals)!==intent.token.decimals)fail('decimals_mismatch');
    const balance=await call(intent.token.address,'balanceOf',[intent.account]);if(balance<BigInt(intent.amountAtomic))fail('insufficient_balance');
    if(await read('execution','eth_getCode',[intent.recipient,state()])!=='0x')fail('contract_recipient_unsupported');
    if(quantity(await read('bundler','eth_chainId',[]))!==46630n)fail('wrong_chain');
    const supported=await read('bundler','eth_supportedEntryPoints',[]);if(!Array.isArray(supported) || supported.length>32 || !supported.every(addr) || !supported.includes(ENTRY))fail('bundler_entrypoint_mismatch');
    const final=header(await read('execution','eth_getBlockByNumber',[`0x${BigInt(snapshot.number).toString(16)}`,false]));if(canonical(final)!==canonical(snapshot))fail('snapshot_changed');
    const observedAt=new Date(clock()).toISOString(),expiresAt=new Date(Math.min(clock()+300000,Date.parse(intent.expiresAt))).toISOString();
    const body={format:'angbao-owner-identity-observation@1',intentDigest:intent.intentDigest,chainId:46630,account:intent.account,owner:expectedOwner,implementation:IMPLEMENTATION,validator:VALIDATOR,entryPoint:ENTRY,rootValidator:ROOT,validationNonce:String(config.nonce),hook:HOOK,nonceKey:NONCE_KEY.toString(),nonce:nonce.toString(),domain:{fields:'0x0f',name:'Kernel',version:'0.3.1',chainId:46630,verifyingContract:intent.account,salt:domain[5],extensions:[]},token:{address:intent.token.address,decimals:intent.token.decimals,balanceAtomic:balance.toString(),requiredAtomic:intent.amountAtomic},recipient:{address:intent.recipient,code:'0x'},block:snapshot,sourceProvenanceDigest:artifacts.provenanceDigest,codeHashes:hashes,observedAt,expiresAt,requests:count,ownerPossessionEstablished:false,sponsorshipEstablished:false,authority:'none'};
    const observation=validateOwnerIdentityObservation(intent,{...body,observationDigest:digest(body)});trusted.add(observation);return observation;
  }
  return Object.freeze({plan,execute,isTrustedResult:value=>trusted.has(value)});
}
