/** Offline consistency checks for independently reviewed compiler bundles. No network or compiler execution. */
import {createHash} from 'node:crypto';
import {keccak256} from '../vendor/kernel-identity-codecs.mjs';
import {KERNEL_INITIALIZATION_ROUTE as ROUTE,validateKernelInitializationIntent} from '../domain/kernel-initialization.mjs';

export const KERNEL_CREATION_REGISTRY_FORMAT='angbao-kernel-creation-source-registry@1';
export const KERNEL_CREATION_REGISTRY_POLICY='kernel-0.3.1-ecdsa-index0-no-hook-empty-config@1';
const ROLES=['implementation','validator','entryPoint','kernelFactory','factory'];
const MAX_BYTES=8388608;
const sha=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v!==null&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const digest=v=>sha(canonical(v));
const fail=()=>{throw Error('The account setup source registry is incomplete or inconsistent.');};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const exact=(v,keys)=>{if(!plain(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();};
const hash=v=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail();return v;};
const label=v=>{if(typeof v!=='string'||!v.length||v.length>256||/[\x00-\x1f]/.test(v))fail();};
const address=v=>{if(typeof v!=='string'||!/^0x[a-f0-9]{40}$/.test(v)||/^0x0{40}$/.test(v))fail();return v;};
const bytes=v=>{if(typeof v!=='string'||!/^0x(?:[a-f0-9]{2})+$/.test(v))fail();return Buffer.from(v.slice(2),'hex');};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function snapshot(value){
 let nodes=0;const seen=new Set();
 function walk(v,depth){
  if(++nodes>150000||depth>32)fail();
  if(v===null||typeof v==='boolean')return;
  if(typeof v==='string'){if(v.length>MAX_BYTES)fail();return;}
  if(typeof v==='number'){if(!Number.isSafeInteger(v))fail();return;}
  if((!plain(v)&&!Array.isArray(v))||seen.has(v))fail();seen.add(v);
  if(Array.isArray(v)&&Object.keys(v).length!==v.length)fail();
  for(const k of Reflect.ownKeys(v)){if(Array.isArray(v)&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||['__proto__','prototype','constructor'].includes(k)||!d.enumerable||!Object.hasOwn(d,'value'))fail();walk(d.value,depth+1);}
  seen.delete(v);
 }
 walk(value,0);if(Buffer.byteLength(JSON.stringify(value))>MAX_BYTES)fail();return structuredClone(value);
}
function checkBuild(build){
 exact(build,['compiler','standardInput','standardOutput','sourceHashes','provenance']);
 exact(build.compiler,['version','binarySha256']);hash(build.compiler.binarySha256);
 if(typeof build.compiler.version!=='string'||!/^0\.8\.[0-9]+\+commit\.[a-f0-9]{8}$/.test(build.compiler.version))fail();
 exact(build.provenance,['repository','revision','buildId','reviewVersion']);
 for(const v of Object.values(build.provenance))label(v);
 if(!/^https:\/\//.test(build.provenance.repository)||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(build.provenance.revision))fail();
 const input=build.standardInput,output=build.standardOutput;
 exact(input,['language','sources','settings']);if(input.language!=='Solidity'||!plain(input.sources)||!Object.keys(input.sources).length||!plain(input.settings))fail();
 exact(build.sourceHashes,Object.keys(input.sources));
 for(const [name,source]of Object.entries(input.sources)){label(name);exact(source,['content']);if(typeof source.content!=='string'||hash(build.sourceHashes[name])!==sha(source.content))fail();}
 if(!plain(output)||!plain(output.contracts)||!plain(output.sources)||Object.keys(output.sources).some(name=>!Object.hasOwn(input.sources,name)))fail();
 if(input.settings.libraries!==undefined){if(!plain(input.settings.libraries))fail();for(const libraries of Object.values(input.settings.libraries)){if(!plain(libraries)||Object.values(libraries).some(v=>!ROLES.some(role=>ROUTE[role]===v)))fail();}}
 if(output.errors!==undefined&&(!Array.isArray(output.errors)||output.errors.some(e=>!plain(e)||e.severity!=='warning'&&e.severity!=='info')))fail();
 for(const [name,contracts]of Object.entries(output.contracts)){if(!Object.hasOwn(input.sources,name)||!plain(contracts))fail();}
}
function resolveRuntime(entry,build){
 exact(entry,['address','build','sourceName','contractName','links','immutables','runtimeSha256']);
 label(entry.sourceName);label(entry.contractName);hash(entry.runtimeSha256);
 const contract=build.standardOutput.contracts[entry.sourceName]?.[entry.contractName];
 if(!plain(contract)||!plain(contract.evm)||!plain(contract.evm.deployedBytecode))fail();
 const deployed=contract.evm.deployedBytecode;
 if(typeof deployed.object!=='string'||!deployed.object.length||deployed.object.length%2||!plain(deployed.linkReferences)||!plain(deployed.immutableReferences))fail();
 // Metadata also binds the selected compiler and every embedded source. Its settings remain committed in the reviewed bundle.
 let metadata;try{metadata=JSON.parse(contract.metadata);}catch{fail();}
 if(metadata?.compiler?.version!==build.compiler.version||!plain(metadata.sources)||!Object.keys(metadata.sources).length||Object.keys(metadata.sources).some(k=>!Object.hasOwn(build.standardInput.sources,k)))fail();
 if(metadata.language!=='Solidity'||!plain(metadata.settings)||!plain(metadata.settings.compilationTarget)||Object.keys(metadata.settings.compilationTarget).length!==1||metadata.settings.compilationTarget[entry.sourceName]!==entry.contractName)fail();
 // Solc metadata names the selected target's used sources. Unused aliases in a full standard input remain SHA256-bound by checkBuild.
 if(!Object.hasOwn(metadata.sources,entry.sourceName))fail();
 for(const [name,source]of Object.entries(metadata.sources)){if(!plain(source)||source.keccak256!==keccak256('0x'+Buffer.from(build.standardInput.sources[name].content,'utf8').toString('hex')))fail();}
 if(Object.hasOwn(build.standardInput.settings,'evmVersion')&&metadata.settings.evmVersion!==build.standardInput.settings.evmVersion)fail();
 // Solc omits the default viaIR=false from metadata even when the standard input states it explicitly.
 const inputViaIR=Object.hasOwn(build.standardInput.settings,'viaIR')?build.standardInput.settings.viaIR:false,metadataViaIR=Object.hasOwn(metadata.settings,'viaIR')?metadata.settings.viaIR:false;
 if(typeof inputViaIR!=='boolean'||typeof metadataViaIR!=='boolean'||inputViaIR!==metadataViaIR)fail();
 if(build.standardInput.settings.optimizer){for(const key of ['enabled','runs'])if(Object.hasOwn(build.standardInput.settings.optimizer,key)&&metadata.settings.optimizer?.[key]!==build.standardInput.settings.optimizer[key])fail();}
 if(!plain(entry.links)||!plain(entry.immutables))fail();
 const data=deployed.object.split(''),used=new Set(),linkKeys=[],immutableKeys=[];
 function substitute(refs,value,length){
  if(!Array.isArray(refs)||!refs.length)fail();const raw=bytes(value).toString('hex');
  for(const slot of refs){exact(slot,['start','length']);if(!Number.isSafeInteger(slot.start)||slot.start<0||!Number.isSafeInteger(slot.length)||slot.length!==length||slot.start+slot.length>data.length/2||raw.length!==slot.length*2)fail();
   for(let i=slot.start*2;i<(slot.start+slot.length)*2;i++){if(used.has(i))fail();used.add(i);data[i]=raw[i-slot.start*2];}
  }
 }
 for(const [file,libraries]of Object.entries(deployed.linkReferences)){
  if(!plain(libraries))fail();for(const [name,refs]of Object.entries(libraries)){
   const key=`${file}:${name}`;linkKeys.push(key);const value=address(entry.links[key]);
   // External graphs need a separate review contract. This format covers the five fixed direct roles only.
   if(!ROLES.some(role=>ROUTE[role]===value)||build.standardInput.settings.libraries?.[file]?.[name]!==value)fail();substitute(refs,value,20);
  }
 }
 exact(entry.links,linkKeys);
 for(const [id,refs]of Object.entries(deployed.immutableReferences)){immutableKeys.push(id);if(!/^(0|[1-9][0-9]*)$/.test(id))fail();substitute(refs,entry.immutables[id],32);}
 exact(entry.immutables,immutableKeys);
 const runtime=bytes('0x'+data.join(''));if(sha(runtime)!==entry.runtimeSha256)fail();return entry.runtimeSha256;
}
/** Structural consistency only. Reviewers must independently reproduce builds and inspect source/graph before pinning this digest. */
export function inspectKernelCreationSourceRegistry(value){
 const registry=snapshot(value);exact(registry,['format','chainId','initializerPolicy','builds','roles']);
 if(registry.format!==KERNEL_CREATION_REGISTRY_FORMAT||registry.chainId!==46630||registry.initializerPolicy!==KERNEL_CREATION_REGISTRY_POLICY||!plain(registry.builds)||!Object.keys(registry.builds).length||Object.keys(registry.builds).length>5)fail();
 exact(registry.roles,ROLES);for(const [id,build]of Object.entries(registry.builds)){label(id);checkBuild(build);}
 const used=new Set(),codeHashes={};for(const role of ROLES){const entry=registry.roles[role];if(!plain(entry)||entry.address!==ROUTE[role]||typeof entry.build!=='string'||!Object.hasOwn(registry.builds,entry.build))fail();used.add(entry.build);codeHashes[role]=resolveRuntime(entry,registry.builds[entry.build]);}
 if(used.size!==Object.keys(registry.builds).length)fail();
 const sourceRegistryDigest=digest({domain:'angbao.kernel-creation-source-registry.v1',registry});
 const routeEvidenceDigest=digest({domain:'angbao.kernel-creation-route.v1',chainId:46630,initializerPolicy:registry.initializerPolicy,sourceRegistryDigest,roles:Object.fromEntries(ROLES.map(role=>[role,ROUTE[role]]))});
 return freeze({sourceRegistryDigest,routeEvidenceDigest,codeHashes,initializerPolicy:registry.initializerPolicy});
}
/** Only trusted private code supplies reviewedRegistryDigests. Imported registry JSON cannot accept itself. Empty pins deny all. */
export function createKernelCreationSourceRegistry({registry=null,reviewedRegistryDigests=[]}={}){
 if(!Array.isArray(reviewedRegistryDigests)||reviewedRegistryDigests.length>64)fail();const pins=new Set(reviewedRegistryDigests.map(hash));
 const checked=registry===null?null:inspectKernelCreationSourceRegistry(registry);
 const accepted=checked&&pins.has(checked.sourceRegistryDigest);
 const resolveSourceArtifacts=Object.freeze(async value=>{
  if(!accepted)return null;let intent;try{intent=validateKernelInitializationIntent(value);}catch{return null;}
  if(intent.routeEvidenceDigest!==checked.routeEvidenceDigest)return null;
  return freeze({format:'angbao-kernel-creation-source@1',chainId:46630,routeEvidenceDigest:checked.routeEvidenceDigest,sourceRegistryDigest:checked.sourceRegistryDigest,initializerPolicy:checked.initializerPolicy,codeHashes:{...checked.codeHashes}});
 });
 return Object.freeze({routeEvidenceDigest:accepted?checked.routeEvidenceDigest:null,resolveSourceArtifacts});
}
