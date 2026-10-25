/** Separate standard Kernel creation intent. No clients, keys, transport or authority. */
import {createHash} from 'node:crypto';
import {encodeFunctionData,parseAbi,getContractAddress,keccak256} from '../vendor/kernel-identity-codecs.mjs';

export const KERNEL_INITIALIZATION_ROUTE=Object.freeze({chainId:46630,kernelVersion:'0.3.1',entryPointVersion:'0.7',entryPoint:'0x0000000071727de22e5e9d8baf0edac6f37da032',validator:'0x845adb2c711129d4f3966735ed98a9f09fc4ce57',implementation:'0xbac849bb641841b44e965fb01a4bf5f074f84b4d',kernelFactory:'0xaac5d4240af87249b3f71bc8e4a2cae074a3e419',factory:'0xd703aae79538628d27099b8c4f621be4ccd142d5',index:'0'});
export const KERNEL_PROXY_RUNTIME='0x363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3';
export const KERNEL_IMPLEMENTATION_SLOT='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
export const KERNEL_INIT_GAS_FIELDS=Object.freeze(['callGasLimit','verificationGasLimit','preVerificationGas','paymasterVerificationGasLimit','paymasterPostOpGasLimit']);
export const KERNEL_INIT_OPERATION_FIELDS=Object.freeze(['sender','nonce','factory','factoryData','callData',...KERNEL_INIT_GAS_FIELDS,'maxFeePerGas','maxPriorityFeePerGas','paymaster','paymasterData']);
const INPUT=['id','owner','chainId','workspaceId','workspaceETag','review','routeEvidenceDigest','createdAt','expiresAt'];
const zero='0x'+'0'.repeat(40),salt='0x'+'0'.repeat(64);
const abi=parseAbi(['function initialize(bytes21,address,bytes,bytes,bytes[])','function deployWithFactory(address,bytes,bytes32) payable returns(address)','function execute(bytes32,bytes) payable']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
export class KernelInitializationError extends Error{constructor(code='invalid_initialization'){super(`Kernel initialization refused: ${code}.`);this.name='KernelInitializationError';this.code=code;}}
const fail=code=>{throw new KernelInitializationError(code);};
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:plain(v)?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function bounded(v,bytes=262144){let count=0;const seen=new Set();function walk(x,depth){if(++count>20000||depth>20)fail('input_bounds');if(x===null||typeof x==='boolean')return;if(typeof x==='string'){if(x.length>bytes)fail('input_bounds');return;}if(typeof x==='number'){if(!Number.isSafeInteger(x))fail('invalid_number');return;}if((!plain(x)&&!Array.isArray(x))||seen.has(x))fail('invalid_json');seen.add(x);if(Array.isArray(x)&&Object.keys(x).length!==x.length)fail('invalid_json');for(const k of Reflect.ownKeys(x)){if(Array.isArray(x)&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(x,k);if(typeof k!=='string'||['__proto__','prototype','constructor'].includes(k)||!d.enumerable||!Object.hasOwn(d,'value'))fail('invalid_json');walk(d.value,depth+1);}seen.delete(x);}walk(v,0);if(Buffer.byteLength(JSON.stringify(v))>bytes)fail('input_bounds');}
function exact(v,keys){if(!plain(v))fail();const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]?.enumerable||!Object.hasOwn(ds[k],'value')))fail();}
function hex(v,bytes){if(typeof v!=='string'||!(bytes?new RegExp(`^0x[0-9a-f]{${bytes*2}}$`):/^0x(?:[0-9a-f]{2})*$/).test(v))fail('invalid_hex');return v;}
function address(v){hex(v,20);if(v===zero)fail('zero_address');return v;}
function integer(v,max=(1n<<120n)-1n,allowZero=false){if(typeof v==='bigint')v=v.toString();if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(v))fail('invalid_integer');const n=BigInt(v);if(n>max||!allowZero&&n===0n)fail('invalid_integer');return n;}
function quantity(v){if(typeof v!=='string'||!/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(v))fail('invalid_quantity');return BigInt(v);}
function iso(v){if(typeof v!=='string'||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)fail('invalid_time');return v;}
function sha(v){if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail('invalid_digest');return v;}
const uuid=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))fail('invalid_id');return v;};
const typed=op=>Object.fromEntries(Object.entries(op).map(([k,v])=>[k,['nonce',...KERNEL_INIT_GAS_FIELDS,'maxFeePerGas','maxPriorityFeePerGas'].includes(k)?BigInt(v):v]));
function body(input){
 bounded(input,16384);exact(input,INPUT);exact(input.review,['id','digest']);
 if(input.chainId!==46630||!/^local:[a-f0-9]{64}$/.test(input.workspaceId)||!/^"(?:0|[1-9][0-9]{0,15})"$/.test(input.workspaceETag))fail('invalid_scope');
 const owner=address(input.owner),createdAt=iso(input.createdAt),expiresAt=iso(input.expiresAt);
 if(Date.parse(expiresAt)<=Date.parse(createdAt)||Date.parse(expiresAt)-Date.parse(createdAt)>900000)fail('invalid_time');
 const route={...KERNEL_INITIALIZATION_ROUTE};for(const key of ['entryPoint','validator','implementation','kernelFactory','factory'])address(route[key]);const rootValidator='0x01'+route.validator.slice(2);
 const initializationData=encodeFunctionData({abi,functionName:'initialize',args:[rootValidator,zero,owner,'0x',[]]});
 const factoryData=encodeFunctionData({abi,functionName:'deployWithFactory',args:[route.kernelFactory,initializationData,salt]});
 const creationCode='0x603d3d8160223d3973'+route.implementation.slice(2)+'60095155f3'+KERNEL_PROXY_RUNTIME.slice(2);
 const initCodeHash=keccak256(creationCode),addressSalt=keccak256(initializationData+salt.slice(2));
 const account=getContractAddress({opcode:'CREATE2',from:route.kernelFactory,salt:addressSalt,bytecodeHash:initCodeHash}).toLowerCase();
 const callData=encodeFunctionData({abi,functionName:'execute',args:[salt,'0x'+'0'.repeat(104)]});
 if(account===owner)fail('invalid_account');
 return {format:'angbao-kernel-initialization-intent@1',kind:'standard-kernel-account-initialization',id:uuid(input.id),owner,chainId:46630,workspaceId:input.workspaceId,workspaceETag:input.workspaceETag,review:{id:uuid(input.review.id),digest:sha(input.review.digest)},routeEvidenceDigest:sha(input.routeEvidenceDigest),createdAt,expiresAt,route,account,initializationData,factoryData,rootValidator,initCodeHash,addressSalt,call:{to:zero,data:'0x',valueWei:'0'},callData};
}
const stamp=b=>freeze({...b,intentDigest:digest({domain:'angbao.kernel-initialization-intent.v1',intent:b})});
export function createKernelInitializationIntent(input,{now=new Date()}={}){const b=body(input);if(!(now instanceof Date)||!Number.isFinite(now.getTime())||Date.parse(b.createdAt)>now.getTime()||Date.parse(b.expiresAt)<=now.getTime())fail('intent_expired');return stamp(b);}
/** Historical integrity only. Local JSON never authorizes source acceptance, owner control or deployment. */
export function validateKernelInitializationIntent(intent){bounded(intent,16384);exact(intent,[...INPUT,'format','kind','route','account','initializationData','factoryData','rootValidator','initCodeHash','addressSalt','call','callData','intentDigest']);const expected=stamp(body(Object.fromEntries(INPUT.map(k=>[k,intent[k]]))));if(canonical(intent)!==canonical(expected))fail('intent_changed');return expected;}
export const kernelInitializationInternals=Object.freeze({fail,bounded,exact,hex,address,integer,quantity,iso,sha,uuid,canonical,digest,freeze,typed,zero});
