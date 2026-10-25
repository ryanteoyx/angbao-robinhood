#!/usr/bin/env node
/** Offline development tooling only. Never fetches, signs, broadcasts or activates a registry. */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DECISION_CHECKPOINT_CONTRACT_SOURCE_SHA256} from '../src/domain/decision-checkpoint.mjs';
import {COMMITMENT_SELECTOR} from '../src/domain/chain-operation.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const toolingSource=join(root,'scripts/checkpoint-tooling');
export const COMMITMENT_ARTIFACT_PATH=join(root,'contracts/angbao-commitment.build.json');
export const CHECKPOINT_COMPILER_VERSION='0.8.30+commit.73712a01.Emscripten.clang';
export const CHECKPOINT_EVM_MODEL='shanghai';
const sourceName='contracts/AngbaoCommitment.sol',contractName='AngbaoCommitment';
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const fail=code=>{throw new Error(`Checkpoint build stopped: ${code}.`);};
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
export function checkpointToolingDirectory(){return resolve(process.env.ANGBAO_CHECKPOINT_TOOLING_DIR??toolingSource);}
export function checkpointToolingInstalled(){return existsSync(join(checkpointToolingDirectory(),'node_modules/solc/index.js'));}
/** The optional directory must contain exact copies of the tracked isolated manifests. No npm invocation here. */
export function loadCheckpointTooling(){
 const directory=checkpointToolingDirectory();
 if(!checkpointToolingInstalled())fail('isolated_tooling_not_installed');
 const manifestBytes=readFileSync(join(toolingSource,'package.json')),lockBytes=readFileSync(join(toolingSource,'package-lock.json'));
 for(const [name,expected] of [['package.json',manifestBytes],['package-lock.json',lockBytes]])if(!readFileSync(join(directory,name)).equals(expected))fail('tooling_manifest_changed');
 const manifest=JSON.parse(manifestBytes),lock=JSON.parse(lockBytes);
 if(lock.lockfileVersion!==3 || JSON.stringify(lock.packages[''].dependencies)!==JSON.stringify(manifest.dependencies))fail('tooling_lock_changed');
 for(const [path,pkg] of Object.entries(lock.packages))if(path && (typeof pkg.resolved!=='string'||!pkg.resolved.startsWith('https://registry.npmjs.org/')||typeof pkg.integrity!=='string'||!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(pkg.integrity)))fail('tooling_registry_or_integrity');
 for(const [name,version] of Object.entries(manifest.dependencies)){
  if(readJson(join(directory,'node_modules',name,'package.json')).version!==version || lock.packages['node_modules/'+name]?.version!==version)fail('tooling_version_changed');
 }
 const require=createRequire(join(directory,'package.json')),solc=require('solc');
 if(solc.version()!==CHECKPOINT_COMPILER_VERSION)fail('compiler_version_changed');
 return {solc,require,directory,provenance:{registry:'https://registry.npmjs.org/',packages:manifest.dependencies,
  packageJsonSha256:sha(manifestBytes),packageLockSha256:sha(lockBytes),compilerVersion:solc.version(),
  compilerSoljsonSha256:sha(readFileSync(require.resolve('solc/soljson.js')))}};
}
export function commitmentCompilerInput(){
 const bytes=readFileSync(join(root,sourceName));
 if(sha(bytes)!==DECISION_CHECKPOINT_CONTRACT_SOURCE_SHA256)fail('contract_source_changed');
 return {language:'Solidity',sources:{[sourceName]:{content:bytes.toString('utf8')}},settings:{
  optimizer:{enabled:true,runs:200},evmVersion:CHECKPOINT_EVM_MODEL,viaIR:false,
  metadata:{bytecodeHash:'ipfs',appendCBOR:true,useLiteralContent:true},libraries:{},remappings:[],
  outputSelection:{'*':{'*':['abi','metadata','storageLayout','evm.bytecode.object','evm.bytecode.linkReferences','evm.deployedBytecode.object','evm.deployedBytecode.linkReferences','evm.deployedBytecode.immutableReferences','evm.methodIdentifiers']}}
 }};
}
export function compileAngbaoCommitment(){
 const {solc,provenance}=loadCheckpointTooling(),input=commitmentCompilerInput(),serialized=JSON.stringify(input);
 // All sources are literal. There is no import callback or remote compiler loading.
 const raw=solc.compile(serialized),output=JSON.parse(raw);
 if((output.errors??[]).length)fail('compiler_diagnostic');
 if(Object.keys(output.contracts??{}).join()!==sourceName || Object.keys(output.contracts[sourceName]).join()!==contractName)fail('unexpected_contracts');
 const built=output.contracts[sourceName][contractName],evm=built.evm;
 if(evm.methodIdentifiers['commit(bytes32,bytes32)']!==COMMITMENT_SELECTOR.slice(2))fail('selector_changed');
 for(const code of [evm.bytecode,evm.deployedBytecode])if(!/^[0-9a-f]+$/.test(code.object)||code.object.length%2||Object.keys(code.linkReferences).length)fail('bytecode_or_linking');
 if(Object.keys(evm.deployedBytecode.immutableReferences).length)fail('unexpected_immutables');
 const body={format:'angbao-commitment-build@1',purpose:'offline-contract-foundation',
  contract:{sourceName,contractName,sourceSha256:DECISION_CHECKPOINT_CONTRACT_SOURCE_SHA256},
  toolchain:provenance,standardInput:input,standardInputSha256:sha(serialized),standardOutputSha256:sha(raw),diagnostics:[],
  abi:built.abi,abiSha256:sha(JSON.stringify(built.abi)),methodIdentifiers:evm.methodIdentifiers,
  creationBytecode:{hex:'0x'+evm.bytecode.object,bytes:evm.bytecode.object.length/2,sha256:sha(Buffer.from(evm.bytecode.object,'hex')),linkReferences:evm.bytecode.linkReferences},
  runtimeBytecode:{hex:'0x'+evm.deployedBytecode.object,bytes:evm.deployedBytecode.object.length/2,sha256:sha(Buffer.from(evm.deployedBytecode.object,'hex')),linkReferences:evm.deployedBytecode.linkReferences,immutableReferences:evm.deployedBytecode.immutableReferences},
  metadata:JSON.parse(built.metadata),metadataSha256:sha(built.metadata),storageLayout:built.storageLayout,
  authority:{liveChainCompatibilityEstablished:false,deployed:false,sourceRegistryActivated:false,ownerApprovalEstablished:false,signingAllowed:false,submissionAllowed:false,financialAuthority:false}};
 return {...body,buildDigest:sha(JSON.stringify(body))};
}
/** Byte-for-byte reference comparison, including compiler, source/settings and all retained output. */
export function checkAngbaoCommitmentArtifact(){
 const artifact=compileAngbaoCommitment();
 if(readFileSync(COMMITMENT_ARTIFACT_PATH,'utf8')!==json(artifact))fail('artifact_changed');
 return artifact;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);
 if(args.length>1||args.length===1&&!['--check','--write'].includes(args[0]))fail('usage_check_or_write');
 const artifact=args[0]==='--write'?compileAngbaoCommitment():checkAngbaoCommitmentArtifact();
 if(args[0]==='--write')writeFileSync(COMMITMENT_ARTIFACT_PATH,json(artifact));
 console.log(JSON.stringify({mode:args[0]??'--check',format:artifact.format,buildDigest:artifact.buildDigest,creationBytes:artifact.creationBytecode.bytes,runtimeBytes:artifact.runtimeBytecode.bytes,sourceSha256:artifact.contract.sourceSha256,runtimeSha256:artifact.runtimeBytecode.sha256,liveChainActions:false}));
}
